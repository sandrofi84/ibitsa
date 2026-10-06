import {
  type ActionDraft,
  type ActionInfo,
  type ActionPreview,
  type Command,
  type CoreMessage,
  type Cue,
  type JournalEntry,
  PROTOCOL_VERSION,
  type Snapshot,
} from '@ibitsa/protocol';
import type { ActionResult, CommandIntent } from './client.types';
import type { Host } from './host.types';

/**
 * The game's view of the core (spec §11.2.1): snapshots are the only source of state, cues are
 * effects. Messages arrive with `seq`; stale snapshots and cues older than the shown snapshot are dropped.
 */
export class GameClient {
  snapshot: Snapshot | null = null;
  versionMismatch = false;
  private snapshotSeq = -1;
  private nextCommand = 1;
  private readonly snapshotListeners: ((s: Snapshot) => void)[] = [];
  private readonly cueListeners: ((c: Cue) => void)[] = [];
  /** The journal lines held so far (#58): a run of the campaign's journal starting at `journalStart`. */
  journal: JournalEntry[] = [];
  journalStart = 0;
  private readonly journalListeners: (() => void)[] = [];
  /** The `/` menu's actions for the hero's folder (#84), as the runtime last sent them. */
  actions: ActionInfo[] = [];
  private readonly actionListeners: ((actions: ActionInfo[]) => void)[] = [];
  private readonly actionResultListeners: ((result: ActionResult) => void)[] = [];
  private actionsFor: string | null = null;
  private actionsWaiting: Promise<ActionInfo[]> | null = null;
  private actionResolvers: ((actions: ActionInfo[]) => void)[] = [];
  private readonly previewWaiters = new Map<string, ((preview: ActionPreview) => void)[]>();

  constructor(private readonly host: Host) {
    host.onMessage((m) => this.receive(m));
  }

  start(): void {
    this.host.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION });
  }

  /** Sends a user intent. The UI waits for the next snapshot; it never updates state itself. */
  send(intent: CommandIntent): string {
    const commandId = `ui-${this.nextCommand++}`;
    this.host.send({ ...intent, commandId } as Command);
    return commandId;
  }

  onSnapshot(listener: (s: Snapshot) => void): void {
    this.snapshotListeners.push(listener);
    if (this.snapshot) listener(this.snapshot);
  }

  onCue(listener: (c: Cue) => void): void {
    this.cueListeners.push(listener);
  }

  /** Asks the runtime for the `/` menu's actions; the answer, and any later change, arrive as `actions`. */
  requestActions(): void {
    this.host.send({ type: 'requestActions' });
  }

  /**
   * The `/` menu's actions for the running quest: asked for once, then kept up to date by the runtime's
   * pushes. A new quest (another worktree) asks again.
   */
  actionsReady(): Promise<ActionInfo[]> {
    const campaign = this.snapshot?.campaign?.id ?? null;
    if (this.actionsFor !== campaign || !this.actionsWaiting) {
      this.actionsFor = campaign;
      this.actionsWaiting = new Promise((resolve) => this.actionResolvers.push(resolve));
      this.requestActions();
    }
    return this.actionsWaiting;
  }

  /** An action's expanded prompt for the preview (#85), from the runtime. */
  preview({ name, args }: { name: string; args: string }): Promise<ActionPreview> {
    const key = `${name}\u0000${args}`;
    return new Promise((resolve) => {
      const waiting = this.previewWaiters.get(key);
      if (waiting) {
        waiting.push(resolve);
        return;
      }
      this.previewWaiters.set(key, [resolve]);
      this.host.send({ type: 'requestPreview', name, args });
    });
  }

  onActions(listener: (actions: ActionInfo[]) => void): void {
    this.actionListeners.push(listener);
  }

  /** Saves a new action as a skill (#86); the answer arrives through `onActionResult`. */
  createAction({ draft, overwrite }: { draft: ActionDraft; overwrite: boolean }): void {
    this.host.send({ type: 'createAction', ...draft, ...(overwrite ? { overwrite } : {}) });
  }

  onActionResult(listener: (result: ActionResult) => void): void {
    this.actionResultListeners.push(listener);
  }

  /** Called whenever the held journal lines change. */
  onJournal(listener: () => void): void {
    this.journalListeners.push(listener);
  }

  /** Removes an "Always allow in this project" rule (#62). Runtime-only: no command id, never logged. */
  forgetProjectRule(rule: string): void {
    this.host.send({ type: 'forgetProjectRule', rule });
  }

  /**
   * The files in an island's worktree, for @ references (#83). Fetched on first use and again once
   * they're older than `FILES_TTL_MS`, so new files show up; the runtime lists them fresh each time.
   */
  files(islandId: string): Promise<string[]> {
    const held = this.fileLists.get(islandId);
    if (held && Date.now() - held.at < GameClient.FILES_TTL_MS) return held.paths;
    const paths = new Promise<string[]>((resolve) => {
      this.fileWaiters.set(islandId, [...(this.fileWaiters.get(islandId) ?? []), resolve]);
    });
    this.fileLists.set(islandId, { at: Date.now(), paths });
    this.host.send({ type: 'requestFiles', islandId });
    return paths;
  }

  static readonly FILES_TTL_MS = 30_000;
  private readonly fileLists = new Map<string, { at: number; paths: Promise<string[]> }>();
  private readonly fileWaiters = new Map<string, ((paths: string[]) => void)[]>();

  /** Asks for the page before the earliest line held. */
  loadEarlierJournal(): void {
    if (this.journalStart > 0)
      this.host.send({ type: 'requestJournal', before: this.journalStart });
  }

  receive(message: CoreMessage): void {
    switch (message.type) {
      case 'welcome':
        this.versionMismatch = message.protocolVersion !== PROTOCOL_VERSION;
        if (!this.versionMismatch) this.host.send({ type: 'requestJournal' });
        return;
      case 'files': {
        const waiters = this.fileWaiters.get(message.islandId) ?? [];
        this.fileWaiters.delete(message.islandId);
        for (const resolve of waiters) resolve(message.paths);
        return;
      }
      case 'journal':
        // The latest page replaces what is held; an earlier one joins the front.
        if (message.start + message.entries.length === message.total) {
          this.setJournal({ entries: message.entries, start: message.start });
        } else if (message.start + message.entries.length === this.journalStart) {
          this.setJournal({ entries: [...message.entries, ...this.journal], start: message.start });
        }
        return;
      case 'actionCreated':
        for (const l of this.actionResultListeners) l({ ok: true, name: message.name });
        return;
      case 'actionRejected':
        for (const l of this.actionResultListeners) {
          l({ ok: false, name: message.name, reason: message.reason, clash: message.clash });
        }
        return;
      case 'actions':
        this.actions = message.actions;
        this.actionsWaiting = Promise.resolve(message.actions);
        for (const resolve of this.actionResolvers.splice(0)) resolve(message.actions);
        for (const l of this.actionListeners) l(message.actions);
        return;
      case 'preview': {
        const key = `${message.preview.name}\u0000${message.preview.args}`;
        for (const resolve of this.previewWaiters.get(key) ?? []) resolve(message.preview);
        this.previewWaiters.delete(key);
        return;
      }
      case 'journalAppend':
        if (message.start === 0) {
          this.setJournal({ entries: message.entries, start: 0 });
        } else if (message.start === this.journalStart + this.journal.length) {
          this.setJournal({
            entries: [...this.journal, ...message.entries],
            start: this.journalStart,
          });
        } else {
          // A gap (e.g. lines written before this view connected): fetch the latest page instead.
          this.host.send({ type: 'requestJournal' });
        }
        return;
      case 'snapshot':
        if (this.versionMismatch || message.seq <= this.snapshotSeq) return;
        this.snapshotSeq = message.seq;
        this.snapshot = message.snapshot;
        for (const l of this.snapshotListeners) l(message.snapshot);
        return;
      case 'cue':
        if (this.versionMismatch || message.seq < this.snapshotSeq) return;
        for (const l of this.cueListeners) l(message.cue);
        return;
    }
  }

  private setJournal({ entries, start }: { entries: JournalEntry[]; start: number }): void {
    this.journal = entries;
    this.journalStart = start;
    for (const l of this.journalListeners) l();
  }
}
