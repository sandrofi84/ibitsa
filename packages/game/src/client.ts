import {
  type ActionDraft,
  type ActionInfo,
  type ActionPreview,
  type ChronicleEntry,
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
  /** Past campaigns for the Guild Hall's Chronicle (#179), once asked for. */
  chronicle: ChronicleEntry[] | null = null;
  private readonly chronicleListeners: ((campaigns: ChronicleEntry[]) => void)[] = [];
  /** The campaign the held lists are for; a new one starts afresh. */
  private actionsFor: string | null = null;
  /** Per hero (#125; `''` for the default): the list, or the ones waiting for it. */
  private readonly actionLists = new Map<
    string,
    { list: Promise<ActionInfo[]>; waiting: ((actions: ActionInfo[]) => void)[] }
  >();
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
  requestActions(heroId?: string): void {
    this.host.send({ type: 'requestActions', ...(heroId ? { heroId } : {}) });
  }

  /**
   * The `/` menu's actions for a hero's worktree (#84, #125; the first hero's without one): asked for
   * once per hero, then kept until a skill changes (the runtime's push drops them all). A new campaign
   * asks again.
   */
  actionsReady(heroId?: string | null): Promise<ActionInfo[]> {
    const campaign = this.snapshot?.campaign?.id ?? null;
    if (this.actionsFor !== campaign) {
      this.actionsFor = campaign;
      this.actionLists.clear();
    }
    const key = heroId ?? '';
    const held = this.actionLists.get(key);
    if (held) return held.list;
    const entry = {
      list: Promise.resolve<ActionInfo[]>([]),
      waiting: [] as ((a: ActionInfo[]) => void)[],
    };
    entry.list = new Promise((resolve) => entry.waiting.push(resolve));
    this.actionLists.set(key, entry);
    this.requestActions(heroId ?? undefined);
    return entry.list;
  }

  /** An action's expanded prompt for the preview (#85), in a hero's worktree (#125), from the runtime. */
  preview({
    name,
    args,
    heroId,
  }: {
    name: string;
    args: string;
    heroId?: string | null;
  }): Promise<ActionPreview> {
    const key = `${name}\u0000${args}\u0000${heroId ?? ''}`;
    return new Promise((resolve) => {
      const waiting = this.previewWaiters.get(key);
      if (waiting) {
        waiting.push(resolve);
        return;
      }
      this.previewWaiters.set(key, [resolve]);
      this.host.send({ type: 'requestPreview', name, args, ...(heroId ? { heroId } : {}) });
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

  /** Asks the runtime for past campaigns (#179); the answer arrives through `onChronicle`. */
  requestChronicle(): void {
    this.host.send({ type: 'requestChronicle' });
  }

  onChronicle(listener: (campaigns: ChronicleEntry[]) => void): void {
    this.chronicleListeners.push(listener);
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
      case 'chronicle':
        this.chronicle = message.campaigns;
        for (const l of this.chronicleListeners) l(message.campaigns);
        return;
      case 'actions': {
        this.actions = message.actions;
        const key = message.heroId ?? '';
        const entry = this.actionLists.get(key);
        const answering = entry !== undefined && entry.waiting.length > 0;
        // Not an answer: a skill changed, so every held list is stale (a request still out keeps its place).
        if (!answering) {
          for (const [k, held] of this.actionLists) {
            if (held.waiting.length === 0) this.actionLists.delete(k);
          }
        }
        for (const resolve of entry?.waiting.splice(0) ?? []) resolve(message.actions);
        this.actionLists.set(key, { list: Promise.resolve(message.actions), waiting: [] });
        for (const l of this.actionListeners) l(message.actions);
        return;
      }
      case 'preview': {
        const key = `${message.preview.name}\u0000${message.preview.args}\u0000${message.heroId ?? ''}`;
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
