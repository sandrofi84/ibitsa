import { type EventLog, Replay, type ReplayOptions, type ReplayStatus } from '@ibitsa/agent-fake';
import { type CoreState, initialState, step, view } from '@ibitsa/core';
import { type Command, type CoreMessage, PROTOCOL_VERSION } from '@ibitsa/protocol';
import type { Host } from '../host';

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
  private state: CoreState = initialState();
  private seq = 0;
  private readonly listeners: ((m: CoreMessage) => void)[] = [];
  private readonly statusListeners: ((s: ReplayStatus) => void)[] = [];

  constructor(log: EventLog, options: Partial<ReplayOptions>) {
    this.replay = new Replay(
      log,
      {
        feed: (record) => {
          const { mark: _mark, ...input } = record;
          const result = step(this.state, input);
          this.state = result.state;
          for (const cue of result.cues) this.emit({ type: 'cue', seq: ++this.seq, cue });
          this.emitSnapshot();
        },
        restart: () => {
          this.state = initialState();
          this.emitSnapshot();
        },
        status: (s) => {
          for (const l of this.statusListeners) l(s);
        },
      },
      { interactiveTypes: ANSWERABLE, ...options },
    );
  }

  onMessage(listener: (m: CoreMessage) => void): void {
    this.listeners.push(listener);
  }

  onStatus(listener: (s: ReplayStatus) => void): void {
    this.statusListeners.push(listener);
    listener(this.replay.status);
  }

  send(command: Command): void {
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
