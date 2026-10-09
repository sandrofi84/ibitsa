import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import {
  type CoreInput,
  type CoreState,
  DEFAULT_SETTINGS,
  type Effect,
  type GameMasterEvent,
  initialState,
  Journal,
  type LogRecord,
  step,
  view,
} from '@ibitsa/core';
import {
  type ActionInfo,
  type CheckResult,
  CLAUDE_AGENT,
  type Command,
  type CoreMessage,
  type CouncilContextChoice,
  type CouncilEvent,
  type CouncillorInfo,
  type Cue,
  DEFAULT_CLASSES,
  type ElderEvent,
  type GitHostView,
  type HeroClassView,
  type LessonsEvent,
  PROTOCOL_VERSION,
  parseCommand,
  type RepoView,
  type ReviewEvent,
  type Snapshot,
} from '@ibitsa/protocol';
import { CampaignDocuments } from './campaign-documents';
import { councilVersion, reviewModel, seatable, sittingPlan } from './council';
import { CouncilTallies } from './council-tallies';
import { KeptCouncil } from './kept-council';
import type {
  AgentAdapter,
  AgentSession,
  FrontEnd,
  ReviewSession,
  SittingSession,
} from './ports.types';
import { ProjectRules } from './project-rules';
import { PullRequests } from './pull-requests';
import type { Connection, RuntimeOptions, SessionCaps } from './runtime.types';
import { SkillCatalog, watchFolder } from './skill-catalog';
import { type CampaignLog, CampaignStore } from './storage';

/** Snapshots go out at most this often (spec §11.2.1: throttled, ~10/s). */
/** The elder's defaults (spec §4.1): the smallest model, and no cap unless the user sets one (#272). */
const DEFAULT_ELDER = { model: 'haiku', budgetMicroUsd: null };
/** The elder's lessons at a campaign's end (§4.9): on Haiku. */
const LESSONS_MODEL = 'haiku';
/** No caps unless the user sets them (#272). */
const NO_CAPS: SessionCaps = { sittingMicroUsd: null, reviewMicroUsd: null, lessonsMicroUsd: null };

/** A session's `maxBudgetMicroUsd` when the user set a cap, else nothing: it runs uncapped (#272). */
const capOf = (microUsd: number | null | undefined): { maxBudgetMicroUsd?: number } =>
  microUsd == null ? {} : { maxBudgetMicroUsd: microUsd };

export const SNAPSHOT_INTERVAL_MS = 100;

/**
 * Carries out core effects, writes every input to the event log before stepping, and rebuilds state from
 * the log on start (spec §11.2, §12; ADR 0001). Node, no vscode imports.
 */
export class Runtime {
  private state: CoreState = initialState();
  /** The latest repo scan; undefined until the first one finishes. */
  private repo: RepoView | null | undefined;
  /** What the git host allows here (#162), refreshed with the repo scan and after each PR result. */
  private gitHost: GitHostView | undefined;
  /** What the last reload resumed, until a front end has been told (#166). */
  private resumedCue: Extract<Cue, { type: 'resumed' }> | null = null;
  private log: CampaignLog | null = null;
  /** The running campaign's journal, built from its log (#58); front ends page through it. */
  private journal = new Journal();
  private seq = 0;
  private readonly frontEnds = new Set<FrontEnd>();
  private readonly sessions = new Map<string, AgentSession>();
  private elderSession: { close(): void } | null = null;
  private sitting: { id: string; session: SittingSession } | null = null;
  private readonly reviews = new Map<string, ReviewSession>();
  /** The workspace's councillors, kept for the snapshot (#103). */
  private councillorList: CouncillorInfo[] = [];
  /** Every councillor, turned-off ones included, for the Guild Hall's Roster (#181). */
  private rosterList: CouncillorInfo[] = [];
  private readonly timers = new Map<string, unknown>();
  private snapshotTimer: unknown = null;
  private lastSnapshotAt = Number.NEGATIVE_INFINITY;
  private snapshotDirty = false;
  private readonly store: CampaignStore;
  private readonly projectRules: ProjectRules;
  private readonly actions: SkillCatalog<ActionInfo> | null;
  private readonly councillors: SkillCatalog<CouncillorInfo> | null;
  private readonly newId: () => string;
  private readonly pullRequests: PullRequests;
  /** The council's lead session kept for the next campaign (#167). */
  private readonly keptCouncil: KeptCouncil;
  private lessonsSession: { close(): void } | null = null;

  constructor(private readonly options: RuntimeOptions) {
    this.store = new CampaignStore(options.storageDir);
    this.projectRules = new ProjectRules(options.storageDir);
    const list = options.adapter.listActions?.bind(options.adapter);
    this.actions = list
      ? new SkillCatalog<ActionInfo>({
          list,
          home: options.home ?? homedir(),
          watch: options.watchFolder ?? watchFolder,
          // A skill changed: every front end gets the fresh list for the hero's folder.
          onChange: () => {
            for (const frontEnd of this.frontEnds) this.postActions({ frontEnd });
          },
        })
      : null;
    const listCouncillors = options.adapter.listCouncillors?.bind(options.adapter);
    this.councillors = listCouncillors
      ? new SkillCatalog<CouncillorInfo>({
          list: listCouncillors,
          home: options.home ?? homedir(),
          watch: options.watchFolder ?? watchFolder,
          // A councillor changed: the snapshot's list follows (#103).
          onChange: () => this.refreshCouncillors(),
        })
      : null;
    this.newId = options.newId ?? randomUUID;
    this.keptCouncil = new KeptCouncil(options.storageDir);
    this.pullRequests = new PullRequests({
      gameMaster: options.gameMaster,
      gitHost: options.gitHost,
      clock: options.clock,
      pollSeconds: options.pullRequestPollSeconds ?? (() => 60),
      report: (event) => {
        this.input({ kind: 'gm', t: this.t(), event });
        // A push or PR action may have signed the user in, or shown the remote is gone.
        if (event.type !== 'pullRequestsPolled') this.checkGitHost();
      },
    });
  }

  /**
   * Rebuild the active campaign, if any, by replaying its log without carrying out effects, then tell core
   * the old process is gone (spec §12). Core decides what survives: M1 marks sessions as not resumed.
   */
  start(): void {
    this.rescanRepo();
    this.refreshCouncillors();
    const id = this.store.activeId();
    if (!id) return;
    const { header, records } = this.store.read(id);
    this.log = this.store.open(id, header);
    for (const { mark: _mark, ...input } of records) {
      this.state = step(this.state, input).state;
      this.journal.add({ record: input, state: this.state });
    }
    if (this.live()) {
      this.input({ kind: 'gm', t: this.t(), event: { type: 'runtimeRestarted' } });
    }
  }

  get snapshotState(): CoreState {
    return this.state;
  }

  connect(frontEnd: FrontEnd): Connection {
    this.frontEnds.add(frontEnd);
    return {
      receive: (raw) => this.receive(frontEnd, raw),
      close: () => this.frontEnds.delete(frontEnd),
    };
  }

  dispose(): void {
    for (const handle of this.timers.values()) this.options.clock.clearTimeout(handle);
    this.timers.clear();
    if (this.snapshotTimer !== null) this.options.clock.clearTimeout(this.snapshotTimer);
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
    this.actions?.dispose();
    this.elderSession?.close();
    this.sitting?.session.close();
    for (const review of this.reviews.values()) review.close();
    this.lessonsSession?.close();
    this.pullRequests.dispose();
    this.councillors?.dispose();
    this.frontEnds.clear();
  }

  // ---------- inputs ----------

  private receive(frontEnd: FrontEnd, raw: unknown): void {
    const parsed = parseCommand(raw);
    if (!parsed.ok) {
      const commandId = (raw as { commandId?: unknown } | null)?.commandId;
      this.postTo(frontEnd, {
        type: 'commandRejected',
        commandId: typeof commandId === 'string' ? commandId : '',
        reason: `Invalid command: ${parsed.issues.join('; ')}`,
      });
      return;
    }
    const command = parsed.command;
    if (command.type === 'hello') {
      frontEnd.post({ type: 'welcome', seq: ++this.seq, protocolVersion: PROTOCOL_VERSION });
      frontEnd.post({ type: 'snapshot', seq: ++this.seq, snapshot: this.snapshot() });
      if (this.resumedCue) this.postTo(frontEnd, this.resumedCue);
      this.resumedCue = null;
      this.rescanRepo();
      return;
    }
    if (command.type === 'requestPreview') {
      this.postPreview({
        frontEnd,
        name: command.name,
        args: command.args,
        ...(command.heroId ? { heroId: command.heroId } : {}),
      });
      return;
    }
    if (command.type === 'createAction') {
      this.createAction({ frontEnd, command });
      return;
    }
    if (command.type === 'requestActions') {
      this.postActions({ frontEnd, ...(command.heroId ? { heroId: command.heroId } : {}) });
      return;
    }
    if (command.type === 'forgetProjectRule') {
      if (this.projectRules.remove(command.rule)) this.scheduleSnapshot();
      return;
    }
    if (command.type === 'requestFiles') {
      this.sendFiles({ frontEnd, islandId: command.islandId });
      return;
    }
    if (command.type === 'requestChronicle') {
      const repo = this.options.repoDir;
      const campaigns = repo ? new CampaignDocuments(repo).pastRecords() : [];
      frontEnd.post({ type: 'chronicle', seq: ++this.seq, campaigns });
      return;
    }
    if (command.type === 'requestJournal') {
      const page = this.journal.page({ before: command.before, limit: command.limit });
      frontEnd.post({ type: 'journal', seq: ++this.seq, ...page });
      return;
    }
    const opens = ['startQuest', 'consultElder', 'conveneCouncil'].includes(command.type);
    if (opens && !this.live()) {
      // A new quest, or asking the elder, is a new campaign with its own log, a fresh core and journal.
      // A quick quest after the elder's brief continues the planning campaign instead (#101).
      this.state = initialState();
      this.journal = new Journal();
      this.log = this.store.create(this.newId(), new Date(this.options.clock.now()));
      this.input({
        kind: 'gm',
        t: this.t(),
        event: { type: 'questSettings', ...this.questSettings() },
      });
    }
    this.input({ kind: 'command', t: this.t(), command });
  }

  private questSettings() {
    const user = this.options.settings?.() ?? {
      budgetMicroUsd: DEFAULT_SETTINGS.budgetMicroUsd,
      stall: DEFAULT_SETTINGS.stall,
    };
    const { budgetCap, costReported } = this.options.adapter.capabilities;
    return {
      budgetMicroUsd: user.budgetMicroUsd,
      stall: user.stall,
      maxParallel: user.maxParallel ?? DEFAULT_SETTINGS.maxParallel,
      campaignBudgetMicroUsd:
        user.campaignBudgetMicroUsd ?? DEFAULT_SETTINGS.campaignBudgetMicroUsd,
      // Reviews (M5) once the game master can run checks and the adapter can start reviewers.
      reviews: Boolean(this.options.gameMaster.runChecks && this.options.adapter.startReview),
      loopLimit: user.loopLimit ?? DEFAULT_SETTINGS.loopLimit,
      consultBudgetMicroUsd: user.consultBudgetMicroUsd ?? DEFAULT_SETTINGS.consultBudgetMicroUsd,
      budget: budgetCap
        ? ('native' as const)
        : costReported
          ? ('turnEnd' as const)
          : ('none' as const),
    };
  }

  private t(): number {
    return this.log ? Math.max(0, this.options.clock.now() - this.log.startedAtMs) : 0;
  }

  /** Log first, then step, then carry out effects (ADR 0001). */
  private input(input: CoreInput): void {
    if (!this.log) {
      // Nothing is running: core would only reject this command, so answer without a log.
      const result = step(this.state, input);
      for (const cue of result.cues) this.broadcastCue(cue);
      return;
    }
    this.log.append(input as LogRecord);
    const result = step(this.state, input);
    this.state = result.state;
    const lines = this.journal.add({ record: input as LogRecord, state: this.state });
    if (lines.length > 0) {
      const start = this.journal.entries.length - lines.length;
      for (const frontEnd of this.frontEnds) {
        frontEnd.post({ type: 'journalAppend', seq: ++this.seq, entries: lines, start });
      }
    }
    for (const cue of result.cues) this.broadcastCue(cue);
    this.scheduleSnapshot();
    for (const effect of result.effects) this.perform(effect);
    if (this.state.campaign && !this.live()) {
      this.store.clearActive();
      this.rescanRepo();
    }
  }

  // ---------- effects ----------

  private perform(effect: Effect): void {
    const session = 'heroId' in effect ? this.sessions.get(effect.heroId) : undefined;
    switch (effect.type) {
      case 'createWorktree':
        void this.options.gameMaster
          .createWorktree(effect)
          .catch((e: unknown) => ({
            type: 'worktreeFailed' as const,
            islandId: effect.islandId,
            message: String(e),
          }))
          .then((event) => this.input({ kind: 'gm', t: this.t(), event }));
        return;
      case 'checkSubmit': {
        const hero = this.state.heroes.find((h) => h.id === effect.heroId);
        const island = this.state.islands.find((i) => i.id === hero?.islandId);
        const fail = (reason: string) =>
          this.input({
            kind: 'gm',
            t: this.t(),
            event: {
              type: 'submitChecked',
              heroId: effect.heroId,
              toolUseId: effect.toolUseId,
              ok: false,
              reason,
            },
          });
        if (!island?.worktreePath) {
          fail('The hero has no worktree.');
          return;
        }
        void this.options.gameMaster
          .checkSubmit({ ...effect, worktreePath: island.worktreePath, baseRef: island.baseRef })
          .then((event) => this.input({ kind: 'gm', t: this.t(), event }))
          .catch((e: unknown) => fail(`The submit check could not run: ${String(e)}`));
        return;
      }
      case 'startSession': {
        const heroId = effect.heroId;
        try {
          this.sessions.get(heroId)?.close();
          this.sessions.set(
            heroId,
            this.adapterOf(effect.classId).startSession(
              {
                ...effect,
                ...this.allowRules(effect.allowRules),
                ...this.modelOf(effect.classId),
                sessionId: randomUUID(),
              },
              (event) => this.input({ kind: 'agent', t: this.t(), heroId, event }),
            ),
          );
        } catch (e) {
          this.input({
            kind: 'agent',
            t: this.t(),
            heroId,
            event: { type: 'error', message: e instanceof Error ? e.message : String(e) },
          });
        }
        return;
      }
      case 'resumeSession': {
        const heroId = effect.heroId;
        const { type: _type, ...resume } = effect;
        try {
          this.sessions.get(heroId)?.close();
          this.sessions.set(
            heroId,
            this.adapterOf(resume.classId).resumeSession(
              { ...resume, ...this.allowRules(resume.allowRules), ...this.modelOf(resume.classId) },
              (event) => this.input({ kind: 'agent', t: this.t(), heroId, event }),
            ),
          );
        } catch (e) {
          this.input({
            kind: 'agent',
            t: this.t(),
            heroId,
            event: { type: 'error', message: e instanceof Error ? e.message : String(e) },
          });
        }
        return;
      }
      case 'observeDiff':
        void this.options.gameMaster
          .observeDiff({ worktreePath: effect.worktreePath })
          .then((hash) =>
            this.input({
              kind: 'gm',
              t: this.t(),
              event: { type: 'diffObserved', heroId: effect.heroId, hash },
            }),
          )
          .catch(() => {
            // No hash, no evidence either way: the no-progress rule simply doesn't advance.
          });
        return;
      case 'removeWorktree':
        void this.options.gameMaster
          .removeWorktree({
            worktreePath: effect.worktreePath,
            ...(effect.branch ? { branch: effect.branch } : {}),
          })
          .catch((e: unknown) => ({ ok: false as const, reason: String(e) }))
          .then((result) =>
            this.input({
              kind: 'gm',
              t: this.t(),
              event: result.ok
                ? { type: 'worktreeRemoved', islandId: effect.islandId }
                : {
                    type: 'worktreeRemoveFailed',
                    islandId: effect.islandId,
                    commandId: effect.commandId,
                    reason: result.reason,
                  },
            }),
          );
        return;
      case 'sendMessage':
        session?.send(effect.text, effect.priority);
        return;
      case 'interrupt':
        session?.interrupt();
        return;
      case 'compactSession':
        session?.compact();
        return;
      case 'answerPermission':
        if (effect.always === 'project' && effect.rules && this.projectRules.add(effect.rules)) {
          this.scheduleSnapshot();
        }
        session?.respondToPermission({
          requestId: effect.requestId,
          decision: effect.decision,
          ...(effect.note === undefined ? {} : { note: effect.note }),
          ...(effect.always ? { always: true } : {}),
        });
        return;
      case 'answerQuestion':
        session?.answerQuestion(effect.requestId, effect.answers);
        return;
      case 'completeSubmit':
        session?.completeSubmit({
          toolUseId: effect.toolUseId,
          accepted: effect.accepted,
          ...(effect.reason === undefined ? {} : { reason: effect.reason }),
        });
        return;
      case 'closeSession':
        session?.close();
        this.sessions.delete(effect.heroId);
        return;
      case 'startElder':
        void this.startElder(effect);
        return;
      case 'closeElder':
        this.elderSession?.close();
        this.elderSession = null;
        return;
      case 'savePlan': {
        const campaignId = this.log?.header.campaignId;
        if (this.options.repoDir && campaignId) {
          try {
            new CampaignDocuments(this.options.repoDir).savePlan({
              campaignId,
              version: effect.version,
              plan: effect.plan,
            });
          } catch {
            // The plan is still in the log and the game; only the files are missing.
          }
        }
        return;
      }
      case 'saveAmendment': {
        const campaignId = this.log?.header.campaignId;
        if (this.options.repoDir && campaignId) {
          try {
            new CampaignDocuments(this.options.repoDir).saveAmendment({
              campaignId,
              version: effect.version,
              plan: effect.plan,
              amendments: effect.amendments,
            });
          } catch {
            // The amendment is still in the log and the game; only the files are missing.
          }
        }
        return;
      }
      case 'saveBrief': {
        const campaignId = this.log?.header.campaignId;
        if (this.options.repoDir && campaignId) {
          try {
            new CampaignDocuments(this.options.repoDir).saveBrief({
              campaignId,
              brief: effect.brief,
            });
          } catch {
            // The brief is still in the log and the game; only the files are missing.
          }
        }
        return;
      }
      case 'startSitting':
        this.startSitting(effect);
        return;
      case 'startLessons':
        this.startLessons(effect);
        return;
      case 'writeRecord': {
        const campaignId = this.log?.header.campaignId;
        const event: GameMasterEvent =
          this.options.repoDir && campaignId
            ? (() => {
                try {
                  const path = new CampaignDocuments(this.options.repoDir).saveRecord({
                    campaignId,
                    record: effect.record,
                  });
                  return { type: 'recordWritten', path };
                } catch (e) {
                  return { type: 'recordFailed', message: String(e) };
                }
              })()
            : { type: 'recordFailed', message: 'There is no workspace folder to write it to.' };
        this.input({ kind: 'gm', t: this.t(), event });
        return;
      }
      case 'councilContext':
        void this.councilContext(effect);
        return;
      case 'sittingMessage':
        this.sittingFor(effect.sittingId)?.message(effect.message);
        return;
      case 'completeSittingTool':
        this.sittingFor(effect.sittingId)?.completeTool({
          toolUseId: effect.toolUseId,
          accepted: effect.accepted,
          ...(effect.reason === undefined ? {} : { reason: effect.reason }),
        });
        return;
      case 'answerSittingQuestions':
        this.sittingFor(effect.sittingId)?.answer({
          toolUseId: effect.toolUseId,
          answers: effect.answers,
        });
        return;
      case 'closeSitting':
        this.sittingFor(effect.sittingId)?.close();
        if (this.sitting?.id === effect.sittingId) this.sitting = null;
        return;
      case 'runChecks': {
        const run = this.options.gameMaster.runChecks?.bind(this.options.gameMaster);
        const report = (results: CheckResult[]) =>
          this.input({
            kind: 'gm',
            t: this.t(),
            event: { type: 'checksRan', taskPointId: effect.taskPointId, results },
          });
        if (!run) {
          report([]);
          return;
        }
        void run({ worktreePath: effect.worktreePath })
          .catch((e: unknown) => [{ command: 'checks', ok: false, output: String(e) }])
          .then(report);
        return;
      }
      case 'startReview':
        void this.startReview(effect);
        return;
      case 'completeReviewTool':
        this.reviews.get(effect.reviewId)?.completeTool({
          toolUseId: effect.toolUseId,
          accepted: effect.accepted,
          ...(effect.reason === undefined ? {} : { reason: effect.reason }),
        });
        return;
      case 'closeReview':
        this.reviews.get(effect.reviewId)?.close();
        this.reviews.delete(effect.reviewId);
        return;
      case 'rebaseWorktree': {
        const rebase = this.options.gameMaster.rebaseWorktree?.bind(this.options.gameMaster);
        if (!rebase) return;
        void rebase({ worktreePath: effect.worktreePath, onto: effect.onto })
          .catch(() => 'conflict' as const)
          .then((outcome) =>
            this.input({
              kind: 'gm',
              t: this.t(),
              event: { type: 'worktreeRebased', islandId: effect.islandId, outcome },
            }),
          );
        return;
      }
      case 'pushBranch':
      case 'openPullRequest':
      case 'markPullRequestReady':
      case 'watchPullRequests':
      case 'pollPullRequests':
      case 'fetchPullRequestComments':
      case 'retargetPullRequest':
      case 'restack':
        this.pullRequests.perform(effect);
        return;
      case 'setTimer':
        this.arm(effect.timerId, effect.at);
        return;
      case 'cancelTimer': {
        const handle = this.timers.get(effect.timerId);
        if (handle !== undefined) this.options.clock.clearTimeout(handle);
        this.timers.delete(effect.timerId);
        return;
      }
    }
  }

  /** A campaign is live while it plans or a quest runs: its log stays active and survives a reload. */
  private live(): boolean {
    const status = this.state.campaign?.status;
    return status === 'active' || status === 'planning';
  }

  /** The elder researches the workspace repository, knowing which councillors exist (#101). */
  private async startElder({ elderId, task }: { elderId: string; task: string }): Promise<void> {
    const report = (event: ElderEvent) =>
      this.input({ kind: 'elder', t: this.t(), elderId, event });
    const start = this.options.adapter.startElder?.bind(this.options.adapter);
    const cwd = this.options.repoDir;
    if (!start || !cwd) {
      report({
        type: 'error',
        message: 'The elder needs a workspace folder and an agent that can research.',
      });
      return;
    }
    const councillors = await this.currentCouncillors();
    // Closed or replaced while the roster was read: don't start a session nobody will close.
    if (this.state.elder?.id !== elderId || this.state.elder.status !== 'researching') return;
    const { model, budgetMicroUsd } = this.options.elder?.() ?? DEFAULT_ELDER;
    try {
      this.elderSession?.close();
      const from = this.keptCouncil.keptFrom();
      this.elderSession = start(
        {
          cwd,
          task,
          councillors,
          model,
          ...capOf(budgetMicroUsd),
          // Past campaigns' records, and a kept council's campaign, for the elder to weigh (#168).
          pastRecords: new CampaignDocuments(cwd).pastRecords(),
          keptCouncil: from ? { from } : null,
        },
        report,
      );
    } catch (e) {
      report({ type: 'error', message: String(e) });
    }
  }

  /** The elder's lessons at the campaign's end (§4.9, #167), on Haiku with a small cap. */
  private startLessons({ lessonsId, material }: { lessonsId: string; material: string }): void {
    const report = (event: LessonsEvent) =>
      this.input({ kind: 'lessons', t: this.t(), lessonsId, event });
    const start = this.options.adapter.startLessons?.bind(this.options.adapter);
    const cwd = this.options.repoDir;
    if (!start || !cwd) {
      report({ type: 'error', message: 'This agent cannot write lessons.' });
      return;
    }
    try {
      this.lessonsSession?.close();
      this.lessonsSession = start(
        {
          cwd,
          title: this.state.campaign?.title ?? 'Campaign',
          material,
          model: LESSONS_MODEL,
          ...capOf(this.caps().lessonsMicroUsd),
        },
        report,
      );
    } catch (e) {
      report({ type: 'error', message: String(e) });
    }
  }

  /** After Finish (§4.9, #167): keep the lead session for the next campaign, compact it first, or forget it. */
  private async councilContext({
    choice,
    sessionId,
  }: {
    choice: CouncilContextChoice;
    sessionId: string | null;
  }): Promise<void> {
    if (choice === 'empty' || !sessionId) {
      this.keptCouncil.forget();
      return;
    }
    const cwd = this.options.repoDir;
    if (choice === 'compact' && cwd) {
      try {
        await this.options.adapter.compactCouncil?.({ cwd, sessionId });
      } catch {
        // Kept as it is: a lighter context next time is a nicety, not a promise.
      }
    }
    this.keptCouncil.keep({ sessionId, from: this.state.campaign?.title ?? 'an earlier campaign' });
    this.scheduleSnapshot();
  }

  /**
   * A reviewer on its effort's model and cap (or its councillor's own model), given its diff (M5). A
   * councillor whose override names an ACP agent reviews on it (#201): briefed with the guidance
   * Claude's adapter finds in its skill, on its own model if it has one, else the agent's default.
   */
  private async startReview(effect: Extract<Effect, { type: 'startReview' }>): Promise<void> {
    const { reviewId } = effect;
    const report = (event: ReviewEvent) =>
      this.input({ kind: 'review', t: this.t(), reviewId, event });
    const councillor = this.councillorList.find((c) => c.id === effect.councillorId);
    let adapter: AgentAdapter;
    try {
      adapter = this.agentNamed(councillor?.agent ?? CLAUDE_AGENT);
    } catch (e) {
      report({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    const start = adapter.startReview?.bind(adapter);
    if (!start) {
      report({ type: 'error', message: 'This agent cannot review.' });
      return;
    }
    const elsewhere = adapter !== this.options.adapter;
    try {
      const diff =
        (await this.options.gameMaster.taskDiff?.({
          worktreePath: effect.worktreePath,
          from: effect.from,
          to: effect.to,
          since: effect.since,
        })) ?? '';
      // The effort's models are Claude's; another agent keeps its own default unless one is named.
      const model = councillor?.model ?? (elsewhere ? '' : reviewModel(effect.effort));
      const guidance = elsewhere
        ? (this.options.adapter.reviewGuidance?.({
            cwd: effect.worktreePath,
            councillorId: effect.councillorId,
          }) ?? null)
        : undefined;
      this.reviews.set(
        reviewId,
        start(
          {
            cwd: effect.worktreePath,
            councillorId: effect.councillorId,
            model,
            ...(guidance === undefined ? {} : { guidance }),
            ...capOf(this.caps().reviewMicroUsd),
            round: effect.round,
            diff,
            task: effect.task,
            criteria: effect.criteria,
            decisions: effect.decisions,
            checks: effect.checks,
          },
          report,
        ),
      );
    } catch (e) {
      report({ type: 'error', message: String(e) });
    }
  }

  /** The round table plans in the workspace repository on its effort's model and cap (#103). */
  private startSitting(effect: Extract<Effect, { type: 'startSitting' }>): void {
    const { sittingId } = effect;
    const report = (event: CouncilEvent) =>
      this.input({ kind: 'council', t: this.t(), sittingId, event });
    const start = this.options.adapter.startSitting?.bind(this.options.adapter);
    const cwd = this.options.repoDir;
    if (!start || !cwd) {
      report({
        type: 'error',
        message: 'The council needs a workspace folder and an agent that can plan.',
      });
      return;
    }
    const plan = sittingPlan(effect);
    // The council's context kept from the last campaign (#167): this sitting resumes it, once.
    // A kept council (#167) is taken by the next new sitting, not by a resume (#169), unless the user
    // chose to start fresh (#168), which forgets it.
    if (effect.fresh) this.keptCouncil.forget();
    const kept = effect.resume || effect.fresh ? null : this.keptCouncil.take();
    try {
      this.sitting?.session.close();
      const session = start(
        {
          cwd,
          mode: effect.mode,
          task: effect.task,
          brief: effect.brief,
          roster: plan.roster,
          model: plan.model,
          // A question's own cap (#169), else the user's cap for a sitting, if any (#272).
          ...capOf(effect.maxBudgetMicroUsd ?? this.caps().sittingMicroUsd),
          ...(effect.resume
            ? { resume: effect.resume }
            : kept
              ? { resume: { sessionId: kept, kept: true } }
              : {}),
        },
        report,
      );
      this.sitting = { id: sittingId, session };
      // A resumed session's council version was noted when it first started.
      if (effect.resume) return;
    } catch (e) {
      report({ type: 'error', message: String(e) });
      return;
    }
    // A resumed session is the council that already sat: its version was noted then.
    if (effect.resume) return;
    // Which council sat (§4.10): the mode, the roster's skill files and the adapter's prompts.
    const seats = effect.roster.map(
      ({ councillorId }) =>
        this.councillorList.find((c) => c.id === councillorId) ?? { id: councillorId, hash: '?' },
    );
    this.input({
      kind: 'gm',
      t: this.t(),
      event: {
        type: 'councilVersionNoted',
        sittingId,
        version: councilVersion({
          mode: effect.mode,
          councillors: seats,
          promptVersion: this.options.adapter.councilPromptVersion ?? 'unknown',
        }),
      },
    });
  }

  private sittingFor(sittingId: string): SittingSession | undefined {
    return this.sitting?.id === sittingId ? this.sitting.session : undefined;
  }

  /**
   * Reads the councillors again for the snapshot: those the council can seat, and the whole roster,
   * turned-off ones included, for the Guild Hall (#181). Also called when their settings change.
   */
  refreshCouncillors(): void {
    const cwd = this.options.repoDir;
    if (!cwd || !this.councillors) return;
    void this.councillors
      .list(cwd)
      .catch(() => [])
      .then((all) => {
        this.rosterList = all;
        this.councillorList = seatable(all, this.options.disabledCouncillors?.() ?? []);
        this.scheduleSnapshot();
      });
  }

  /** `at` is in log time (ms since the header). */
  private arm(timerId: string, at: number): void {
    const existing = this.timers.get(timerId);
    if (existing !== undefined) this.options.clock.clearTimeout(existing);
    const delay = Math.max(0, at - this.t());
    this.timers.set(
      timerId,
      this.options.clock.setTimeout(() => {
        this.timers.delete(timerId);
        this.input({ kind: 'timer', t: this.t(), timerId });
      }, delay),
    );
  }

  // ---------- output ----------

  private broadcastCue(cue: Cue): void {
    // What a reload resumed is decided before any front end connects: kept for the first hello (#166).
    if (cue.type === 'resumed' && this.frontEnds.size === 0) this.resumedCue = cue;
    const message: CoreMessage = { type: 'cue', seq: ++this.seq, cue };
    for (const f of this.frontEnds) f.post(message);
  }

  private postTo(frontEnd: FrontEnd, cue: Cue): void {
    frontEnd.post({ type: 'cue', seq: ++this.seq, cue });
  }

  /** Leading edge right away, then at most one snapshot per interval with the latest state. */
  private scheduleSnapshot(): void {
    this.snapshotDirty = true;
    if (this.snapshotTimer !== null) return;
    const wait = this.lastSnapshotAt + SNAPSHOT_INTERVAL_MS - this.options.clock.now();
    if (wait <= 0) {
      this.flushSnapshot();
      return;
    }
    this.snapshotTimer = this.options.clock.setTimeout(() => {
      this.snapshotTimer = null;
      this.flushSnapshot();
    }, wait);
  }

  /** Core's view plus the repo scan, which the New Quest form needs before any quest exists. */
  /**
   * Lists an island's worktree for @ file references (#83), fresh on each request: front ends cache it.
   * No worktree (yet, or any more) means no files.
   */
  private sendFiles({ frontEnd, islandId }: { frontEnd: FrontEnd; islandId: string }): void {
    const path = this.state.islands.find((i) => i.id === islandId)?.worktreePath;
    const post = (paths: string[]) =>
      frontEnd.post({ type: 'files', seq: ++this.seq, islandId, paths });
    if (!path) {
      post([]);
      return;
    }
    void this.options.gameMaster.listFiles({ worktreePath: path }).then(post, () => post([]));
  }

  /** An action's expanded prompt (#85); no text without a quest, a reader, or a readable file. */
  private postPreview({
    frontEnd,
    name,
    args,
    heroId,
  }: {
    frontEnd: FrontEnd;
    name: string;
    args: string;
    heroId?: string;
  }): void {
    const cwd = this.worktreeOf(heroId);
    const send = (found: { text: string; notes: string[] } | null) =>
      frontEnd.post({
        type: 'preview',
        seq: ++this.seq,
        preview: { name, args, text: found?.text ?? null, notes: found?.notes ?? [] },
        ...(heroId ? { heroId } : {}),
      });
    const preview = this.options.adapter.previewAction;
    if (!cwd || !preview || this.state.campaign?.status !== 'active') {
      send(null);
      return;
    }
    preview.call(this.options.adapter, { cwd, name, args }).then(send, () => send(null));
  }

  /** The `/` menu's actions for the hero's worktree; none without a quest or if listing fails (#84). */
  /** Writes a new action as a skill, then refreshes every front end's `/` menu (#86). */
  private createAction({
    frontEnd,
    command,
  }: {
    frontEnd: FrontEnd;
    command: Extract<Command, { type: 'createAction' }>;
  }): void {
    const { type: _type, overwrite = false, ...draft } = command;
    const reject = (reason: string, clash = false) =>
      frontEnd.post({ type: 'actionRejected', seq: ++this.seq, name: draft.name, reason, clash });
    const create = this.options.adapter.createAction?.bind(this.options.adapter);
    if (!create) {
      reject('This agent has no actions.');
      return;
    }
    if (draft.scope === 'project' && !this.options.repoDir) {
      reject('There is no project folder to save it in.');
      return;
    }
    const roots = {
      personal: this.options.home ?? homedir(),
      project: this.options.repoDir ?? '',
    };
    create({ draft, overwrite, roots }).then(
      (result) => {
        if (!result.ok) {
          reject(result.reason, result.clash);
          return;
        }
        frontEnd.post({ type: 'actionCreated', seq: ++this.seq, name: draft.name });
        this.actions?.refresh();
      },
      (e: unknown) => reject(`Couldn't save the action: ${String(e)}`),
    );
  }

  private postActions({ frontEnd, heroId }: { frontEnd: FrontEnd; heroId?: string }): void {
    void this.currentActions(heroId).then((actions) =>
      frontEnd.post({ type: 'actions', seq: ++this.seq, actions, ...(heroId ? { heroId } : {}) }),
    );
  }

  /**
   * The `/` menu's actions for a hero's worktree (#84, #87, #125): that hero's, else the first one
   * there is. With no hero at work, the repository's, for the Guild Hall's Spell book (#179). None on
   * failure.
   */
  currentActions(heroId?: string): Promise<ActionInfo[]> {
    const worktree = this.state.campaign?.status === 'active' ? this.worktreeOf(heroId) : null;
    const cwd = worktree ?? this.options.repoDir;
    if (!cwd || !this.actions) return Promise.resolve([]);
    return this.actions.list(cwd).catch(() => []);
  }

  /** A hero's worktree, else the first island's that exists (#125). */
  private worktreeOf(heroId: string | undefined): string | null {
    const hero = this.state.heroes.find((h) => h.id === heroId);
    const own = this.state.islands.find((i) => i.id === hero?.islandId)?.worktreePath;
    return own ?? this.state.islands.find((i) => i.worktreePath)?.worktreePath ?? null;
  }

  /**
   * The councillors the workspace repository can seat (§4.7, #98), without the ones turned off; none
   * without a repository or on failure.
   */
  currentCouncillors(): Promise<CouncillorInfo[]> {
    const cwd = this.options.repoDir;
    if (!cwd || !this.councillors) return Promise.resolve([]);
    const disabled = this.options.disabledCouncillors?.() ?? [];
    return this.councillors
      .list(cwd)
      .then((all) => seatable(all, disabled))
      .catch(() => []);
  }

  /** Every sitting's tally across this workspace's campaigns, as JSON or CSV (§4.10, #106). */
  exportTallies(format: 'json' | 'csv'): string {
    const tallies = new CouncilTallies(this.store);
    return format === 'csv' ? tallies.csv() : tallies.json();
  }

  /** A session's allow rules: the quest's from core plus the project's kept here (#62). */
  private allowRules(quest: string[] | undefined): { allowRules?: string[] } {
    const all = [...new Set([...(quest ?? []), ...this.projectRules.list()])];
    return all.length > 0 ? { allowRules: all } : {};
  }

  private snapshot(): Snapshot {
    const snapshot = {
      ...view(this.state),
      projectRules: this.projectRules.list(),
      sandboxed: (this.options.platform ?? process.platform) !== 'win32',
      councillors: this.councillorList,
      roster: this.rosterList,
      councilMode: this.options.councilMode?.() ?? 'ask',
    };
    return {
      ...snapshot,
      ...(this.repo === undefined ? {} : { repo: this.repo }),
      ...(this.gitHost ? { gitHost: this.gitHost } : {}),
      keptCouncil: this.keptCouncilView(),
      classes: this.classes().map((c) => (this.unsandboxed(c) ? { ...c, sandboxed: false } : c)),
      recolor: this.options.recolor?.() ?? {},
    };
  }

  /** The hero classes in play (§5.2, #182): the built-ins with `ibitsa.classes` over them. */
  private classes(): HeroClassView[] {
    return this.options.classes?.() ?? [...DEFAULT_CLASSES];
  }

  /**
   * The adapter heroes of this class run on (§11.5, #198): Claude's, or the ACP agent the class names.
   * Throws when that agent can't be used; the caller turns it into the hero's error.
   */
  private adapterOf(classId: string): AgentAdapter {
    return this.agentNamed(this.classes().find((c) => c.id === classId)?.agent ?? CLAUDE_AGENT);
  }

  /** Claude's adapter, or the ACP agent's of that id; throws when it can't be used (§11.5). */
  private agentNamed(agent: string): AgentAdapter {
    if (agent === CLAUDE_AGENT) return this.options.adapter;
    const found = this.options.agentAdapter?.(agent);
    if (!found) throw new Error(`No agent "${agent}" in ibitsa.agents.`);
    if ('error' in found) throw new Error(found.error);
    return found;
  }

  /** Whether heroes of this class run without Ibitsa's sandbox (§11.5, #200): an ACP agent's say. */
  private unsandboxed(heroClass: HeroClassView): boolean {
    if (heroClass.agent === CLAUDE_AGENT || !this.options.agentSandboxed) return false;
    return !this.options.agentSandboxed(heroClass.agent);
  }

  /** The user's caps as they are now (#272): read at each session's start, none by default. */
  private caps(): SessionCaps {
    return this.options.caps?.() ?? NO_CAPS;
  }

  /** The model a hero of this class runs on (#182); none for a class nobody knows. */
  private modelOf(classId: string): { model?: string } {
    const model = this.classes().find((c) => c.id === classId)?.model;
    return model ? { model } : {};
  }

  private rescanRepo(): void {
    this.checkGitHost();
    this.options.gameMaster
      .scanRepo()
      .then((repo) => {
        this.repo = repo;
        this.scheduleSnapshot();
      })
      .catch(() => {
        // No scan, no repo field: the form shows what it knows.
      });
  }

  /** The council's context kept from an earlier campaign (#168), for the convene form. */
  private keptCouncilView(): { from: string } | null {
    const from = this.keptCouncil.keptFrom();
    return from ? { from } : null;
  }

  /** What stands in the way of pushing and PRs here, before any click (#162). */
  private checkGitHost(): void {
    void this.pullRequests
      .status()
      .then((gitHost) => {
        if (JSON.stringify(gitHost) === JSON.stringify(this.gitHost)) return;
        this.gitHost = gitHost;
        this.scheduleSnapshot();
      })
      .catch(() => {
        // Unknown: the card says what went wrong after a click instead.
      });
  }

  private flushSnapshot(): void {
    if (!this.snapshotDirty) return;
    this.snapshotDirty = false;
    this.lastSnapshotAt = this.options.clock.now();
    const message: CoreMessage = { type: 'snapshot', seq: ++this.seq, snapshot: this.snapshot() };
    for (const f of this.frontEnds) f.post(message);
  }
}
