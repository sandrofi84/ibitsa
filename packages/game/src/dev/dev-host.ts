import { type EventLog, Replay, type ReplayOptions, type ReplayStatus } from '@ibitsa/agent-fake';
import { type CoreState, initialState, Journal, step, view } from '@ibitsa/core';
import {
  type Command,
  type CoreMessage,
  type HostEvent,
  type HostRequest,
  type JournalEntry,
  PROTOCOL_VERSION,
} from '@ibitsa/protocol';
import type { Host } from '../host.types';
import { MemoryViewStorage } from '../view-state';
import { DEV_ACTIONS } from './dev-actions';
import { DEMO_FILES, FakeHostChannel } from './fake-host-channel';

/** Commands the game's UI can send; interactive replays wait for these and replay the rest. */
const ANSWERABLE: Command['type'][] = [
  'answerPermission',
  'answerQuestion',
  'sendMessage',
  'stopHero',
  'markDone',
  'resumeHero',
  'raiseBudget',
];

/**
 * Standalone development host (spec §13): the real core running in the browser, fed by an
 * `agent-fake` replay. Effects are not carried out; the log already holds their results (ADR 0001).
 */
export class DevHost implements Host {
  readonly replay: Replay;
  readonly viewStorage = new MemoryViewStorage();
  readonly channel = new FakeHostChannel({ credentialsReady: true });
  private state: CoreState = initialState();
  private journal = new Journal();
  private seq = 0;
  private readonly listeners: ((m: CoreMessage) => void)[] = [];
  private readonly statusListeners: ((s: ReplayStatus) => void)[] = [];

  constructor(log: EventLog, options: Partial<ReplayOptions>) {
    this.replay = new Replay({
      log,
      callbacks: {
        feed: (record) => {
          const { mark: _mark, ...input } = record;
          const result = step(this.state, input);
          this.state = result.state;
          for (const cue of result.cues) this.emit({ type: 'cue', seq: ++this.seq, cue });
          this.appendJournal(this.journal.add({ record: input, state: this.state }));
          this.emitSnapshot();
        },
        restart: () => {
          this.state = initialState();
          this.journal = new Journal();
          this.emit({ type: 'journalAppend', seq: ++this.seq, entries: [], start: 0 });
          this.emitSnapshot();
        },
        status: (s) => {
          for (const l of this.statusListeners) l(s);
        },
      },
      options: { interactiveTypes: ANSWERABLE, ...options },
    });
  }

  request(request: HostRequest): void {
    this.channel.request(request);
  }

  onHostEvent(listener: (event: HostEvent) => void): void {
    this.channel.onHostEvent(listener);
  }

  onMessage(listener: (m: CoreMessage) => void): void {
    this.listeners.push(listener);
  }

  onStatus(listener: (s: ReplayStatus) => void): void {
    this.statusListeners.push(listener);
    listener(this.replay.status);
  }

  send(command: Command): void {
    // The standalone build keeps no project rules (#62).
    if (command.type === 'forgetProjectRule') return;
    if (command.type === 'requestFiles') {
      this.emit({ type: 'files', seq: ++this.seq, islandId: command.islandId, paths: DEMO_FILES });
      return;
    }
    if (command.type === 'requestActions') {
      this.emit({ type: 'actions', seq: ++this.seq, actions: DEV_ACTIONS });
      return;
    }
    if (command.type === 'requestJournal') {
      const page = this.journal.page({ before: command.before, limit: command.limit });
      this.emit({ type: 'journal', seq: ++this.seq, ...page });
      return;
    }
    if (command.type === 'hello') {
      this.emit({ type: 'welcome', seq: ++this.seq, protocolVersion: PROTOCOL_VERSION });
      this.emitSnapshot();
      return;
    }
    if (!this.replay.submitLive(command)) {
      this.emit({
        type: 'cue',
        seq: ++this.seq,
        cue: {
          type: 'commandRejected',
          commandId: command.commandId,
          reason:
            'Replay: switch to interactive mode and wait for this command to answer it yourself.',
        },
      });
    }
  }

  private appendJournal(lines: JournalEntry[]): void {
    if (lines.length === 0) return;
    const start = this.journal.entries.length - lines.length;
    this.emit({ type: 'journalAppend', seq: ++this.seq, entries: lines, start });
  }

  private emitSnapshot(): void {
    this.emit({ type: 'snapshot', seq: ++this.seq, snapshot: view(this.state) });
  }

  private emit(message: CoreMessage): void {
    // Delivered asynchronously, as postMessage would be.
    queueMicrotask(() => {
      for (const l of this.listeners) l(message);
    });
  }
}
