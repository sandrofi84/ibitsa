import { type EventLog, Replay, type ReplayOptions, type ReplayStatus } from '@ibitsa/agent-fake';
import { type CoreInput, type CoreState, initialState, Journal, step, view } from '@ibitsa/core';
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
import { DevActions, devPreview } from './dev-actions';
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
  'answerCouncil',
];

/**
 * Standalone development host (spec §13): the real core running in the browser, fed by an
 * `agent-fake` replay. Effects are not carried out; the log already holds their results (ADR 0001).
 */
export class DevHost implements Host {
  readonly replay: Replay;
  readonly viewStorage = new MemoryViewStorage();
  private readonly devActions = new DevActions();
  readonly channel = new FakeHostChannel({ credentialsReady: true });
  private state: CoreState = initialState();
  /** Core time of the last input, for inputs the dev host makes itself. */
  private t = 0;
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
          this.apply(input);
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
    if (command.type === 'requestPreview') {
      this.emit({
        type: 'preview',
        seq: ++this.seq,
        preview: devPreview(command),
        ...(command.heroId ? { heroId: command.heroId } : {}),
      });
      return;
    }
    if (command.type === 'requestActions') {
      this.emit({
        type: 'actions',
        seq: ++this.seq,
        actions: this.devActions.list,
        ...(command.heroId ? { heroId: command.heroId } : {}),
      });
      return;
    }
    if (command.type === 'createAction') {
      const { type: _type, overwrite = false, ...draft } = command;
      for (const reply of this.devActions.create({ draft, overwrite })) {
        this.emit({ ...reply, seq: ++this.seq });
      }
      return;
    }
    if (command.type === 'requestChronicle') {
      // A replay has no past campaigns (#179).
      this.emit({ type: 'chronicle', seq: ++this.seq, campaigns: [] });
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
    if (command.type === 'askCouncilWhy') {
      this.why(command);
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

  /** Steps the core with one input, as the runtime would, and shows the result. */
  private apply(input: CoreInput): void {
    this.t = input.t;
    const result = step(this.state, input);
    this.state = result.state;
    for (const cue of result.cues) this.emit({ type: 'cue', seq: ++this.seq, cue });
    this.appendJournal(this.journal.add({ record: input, state: this.state }));
    this.emitSnapshot();
  }

  /**
   * "Why?" (#102). The log can't hold an answer to a question asked now, so the dev host plays the
   * lead session: the asking councillor explains with the reason behind its recommendation.
   */
  private why(command: Extract<Command, { type: 'askCouncilWhy' }>): void {
    const before = this.state.sitting?.dialogue.length ?? 0;
    this.apply({ kind: 'command', t: this.t, command });
    const sitting = this.state.sitting;
    if (!sitting || sitting.dialogue.length === before) return;
    const question = sitting.batches.at(-1)?.items.find((q) => q.id === command.questionId);
    if (!question) return;
    const reason = (
      question.recommendation?.reason ??
      question.options[0]?.tradeoff ??
      'It shapes the plan'
    ).replace(/\.$/, '');
    const text = command.text ? `Good question. ${reason}.` : `${reason}. That is why I ask.`;
    this.apply({
      kind: 'council',
      t: this.t,
      sittingId: sitting.id,
      event: { type: 'said', councillorId: question.councillorId, text, questionId: question.id },
    });
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
