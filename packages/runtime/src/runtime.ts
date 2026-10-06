import { randomUUID } from 'node:crypto';
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
  type CoreMessage,
  type Cue,
  PROTOCOL_VERSION,
  parseCommand,
  type RepoView,
  type Snapshot,
} from '@ibitsa/protocol';
import type { AgentSession, FrontEnd } from './ports.types';
import { ProjectRules } from './project-rules';
import type { Connection, RuntimeOptions } from './runtime.types';
import { type CampaignLog, CampaignStore } from './storage';

/** Snapshots go out at most this often (spec §11.2.1: throttled, ~10/s). */
export const SNAPSHOT_INTERVAL_MS = 100;

/**
 * Carries out core effects, writes every input to the event log before stepping, and rebuilds state from
 * the log on start (spec §11.2, §12; ADR 0001). Node, no vscode imports.
 */
export class Runtime {
  private state: CoreState = initialState();
  /** The latest repo scan; undefined until the first one finishes. */
  private repo: RepoView | null | undefined;
  private log: CampaignLog | null = null;
  /** The running campaign's journal, built from its log (#58); front ends page through it. */
  private journal = new Journal();
  private seq = 0;
  private readonly frontEnds = new Set<FrontEnd>();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly timers = new Map<string, unknown>();
  private snapshotTimer: unknown = null;
  private lastSnapshotAt = Number.NEGATIVE_INFINITY;
  private snapshotDirty = false;
  private readonly store: CampaignStore;
  private readonly projectRules: ProjectRules;
  private readonly newId: () => string;

  constructor(private readonly options: RuntimeOptions) {
    this.store = new CampaignStore(options.storageDir);
    this.projectRules = new ProjectRules(options.storageDir);
    this.newId = options.newId ?? randomUUID;
  }

  /**
   * Rebuild the active campaign, if any, by replaying its log without carrying out effects, then tell core
   * the old process is gone (spec §12). Core decides what survives: M1 marks sessions as not resumed.
   */
  start(): void {
    this.rescanRepo();
    const id = this.store.activeId();
    if (!id) return;
    const { header, records } = this.store.read(id);
    this.log = this.store.open(id, header);
    for (const { mark: _mark, ...input } of records) {
      this.state = step(this.state, input).state;
      this.journal.add({ record: input, state: this.state });
    }
    if (this.state.campaign?.status === 'active') {
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
    if (command.type === 'startQuest' && this.state.campaign?.status !== 'active') {
      // A new quest is a new campaign with its own log, a fresh core and a fresh journal.
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
      ...user,
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
    if (this.state.campaign && this.state.campaign.status !== 'active') {
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
          .removeWorktree({ worktreePath: effect.worktreePath })
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
    };
    return this.repo === undefined ? snapshot : { ...snapshot, repo: this.repo };
  }

  private rescanRepo(): void {
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

  private flushSnapshot(): void {
    if (!this.snapshotDirty) return;
    this.snapshotDirty = false;
    this.lastSnapshotAt = this.options.clock.now();
    const message: CoreMessage = { type: 'snapshot', seq: ++this.seq, snapshot: this.snapshot() };
    for (const f of this.frontEnds) f.post(message);
  }
}
