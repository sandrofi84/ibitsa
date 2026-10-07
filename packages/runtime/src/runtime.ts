import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import {
  type CoreInput,
  type CoreState,
  DEFAULT_SETTINGS,
  type Effect,
  initialState,
  Journal,
  type LogRecord,
  step,
  view,
} from '@ibitsa/core';
import {
  type ActionInfo,
  type CheckResult,
  type Command,
  type CoreMessage,
  type CouncilEvent,
  type CouncillorInfo,
  type Cue,
  type ElderEvent,
  type GitHostView,
  PROTOCOL_VERSION,
  parseCommand,
  type RepoView,
  type ReviewEvent,
  type Snapshot,
} from '@ibitsa/protocol';
import { CampaignDocuments } from './campaign-documents';
import { councilVersion, reviewPlan, seatable, sittingPlan } from './council';
import { CouncilTallies } from './council-tallies';
import type { AgentSession, FrontEnd, ReviewSession, SittingSession } from './ports.types';
import { ProjectRules } from './project-rules';
import { PullRequests } from './pull-requests';
import type { Connection, RuntimeOptions } from './runtime.types';
import { SkillCatalog, watchFolder } from './skill-catalog';
import { type CampaignLog, CampaignStore } from './storage';

/** Snapshots go out at most this often (spec §11.2.1: throttled, ~10/s). */
/** The elder's defaults (spec §4.1): the smallest model, a quarter of a dollar. */
const DEFAULT_ELDER = { model: 'haiku', budgetMicroUsd: 250_000 };

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
            this.options.adapter.startSession(
              { ...effect, ...this.allowRules(effect.allowRules), sessionId: randomUUID() },
              (event) => this.input({ kind: 'agent', t: this.t(), heroId, event }),
            ),
          );
        } catch (e) {
          this.input({
            kind: 'agent',
            t: this.t(),
            heroId,
            event: { type: 'error', message: String(e) },
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
            this.options.adapter.resumeSession(
              { ...resume, ...this.allowRules(resume.allowRules) },
              (event) => this.input({ kind: 'agent', t: this.t(), heroId, event }),
            ),
          );
        } catch (e) {
          this.input({
            kind: 'agent',
            t: this.t(),
            heroId,
            event: { type: 'error', message: String(e) },
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
      this.elderSession = start(
        { cwd, task, councillors, model, maxBudgetMicroUsd: budgetMicroUsd },
        report,
      );
    } catch (e) {
      report({ type: 'error', message: String(e) });
    }
  }

  /** A reviewer on its effort's model and cap (or its councillor's own model), given its diff (M5). */
  private async startReview(effect: Extract<Effect, { type: 'startReview' }>): Promise<void> {
    const { reviewId } = effect;
    const report = (event: ReviewEvent) =>
      this.input({ kind: 'review', t: this.t(), reviewId, event });
    const start = this.options.adapter.startReview?.bind(this.options.adapter);
    if (!start) {
      report({ type: 'error', message: 'This agent cannot review.' });
      return;
    }
    try {
      const diff =
        (await this.options.gameMaster.taskDiff?.({
          worktreePath: effect.worktreePath,
          from: effect.from,
          to: effect.to,
          since: effect.since,
        })) ?? '';
      const effort = reviewPlan(effect.effort);
      const own = this.councillorList.find((c) => c.id === effect.councillorId)?.model;
      this.reviews.set(
        reviewId,
        start(
          {
            cwd: effect.worktreePath,
            councillorId: effect.councillorId,
            model: own ?? effort.model,
            maxBudgetMicroUsd: effort.budgetMicroUsd,
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
          maxBudgetMicroUsd: plan.maxBudgetMicroUsd,
        },
        report,
      );
      this.sitting = { id: sittingId, session };
    } catch (e) {
      report({ type: 'error', message: String(e) });
      return;
    }
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

  private refreshCouncillors(): void {
    void this.currentCouncillors().then((list) => {
      this.councillorList = list;
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
   * there is; none without one or on failure.
   */
  currentActions(heroId?: string): Promise<ActionInfo[]> {
    const cwd = this.worktreeOf(heroId);
    if (!cwd || !this.actions || this.state.campaign?.status !== 'active')
      return Promise.resolve([]);
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
      councilMode: this.options.councilMode?.() ?? 'ask',
    };
    return {
      ...snapshot,
      ...(this.repo === undefined ? {} : { repo: this.repo }),
      ...(this.gitHost ? { gitHost: this.gitHost } : {}),
    };
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
