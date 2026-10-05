import {
  type CoreInput,
  type CoreState,
  type Effect,
  initialState,
  step,
  view,
} from '@ibitsa/core';
import {
  type AgentEvent,
  type Command,
  type CoreMessage,
  type HostEvent,
  type HostRequest,
  PROTOCOL_VERSION,
  type RepoView,
} from '@ibitsa/protocol';
import type { Host } from '../host.types';
import { FakeHostChannel } from './fake-host-channel';

const STEP_MS = 120;

/**
 * Standalone `live` mode (#37): the real core, answered by a scripted fake runtime instead of a replay,
 * so the UI can be played end to end (forms, messages, stop, finish) without an agent.
 */
export class LiveDevHost implements Host {
  readonly channel: FakeHostChannel;
  private state: CoreState = initialState();
  private seq = 0;
  private readonly started = Date.now();
  private readonly listeners: ((m: CoreMessage) => void)[] = [];
  private readonly repo: RepoView | null;
  private diffs = 0;

  constructor({ credentialsReady, repo }: { credentialsReady: boolean; repo: RepoView | null }) {
    this.channel = new FakeHostChannel({ credentialsReady });
    this.repo = repo;
  }

  onMessage(listener: (m: CoreMessage) => void): void {
    this.listeners.push(listener);
  }

  request(request: HostRequest): void {
    this.channel.request(request);
  }

  onHostEvent(listener: (event: HostEvent) => void): void {
    this.channel.onHostEvent(listener);
  }

  send(command: Command): void {
    if (command.type === 'hello') {
      this.emit({ type: 'welcome', seq: ++this.seq, protocolVersion: PROTOCOL_VERSION });
      this.emitSnapshot();
      return;
    }
    this.input({ kind: 'command', t: this.t(), command });
  }

  private t(): number {
    return Date.now() - this.started;
  }

  private input(input: CoreInput): void {
    const result = step(this.state, input);
    this.state = result.state;
    for (const cue of result.cues) this.emit({ type: 'cue', seq: ++this.seq, cue });
    this.emitSnapshot();
    for (const effect of result.effects) this.perform(effect);
  }

  private agent(heroId: string, events: AgentEvent[]): void {
    events.forEach((event, i) => {
      setTimeout(
        () => this.input({ kind: 'agent', t: this.t(), heroId, event }),
        STEP_MS * (i + 1),
      );
    });
  }

  /** A short scripted turn: read, edit, a reply, then waiting for orders. */
  private turn(reply: string): AgentEvent[] {
    const id = `u${++this.diffs}`;
    return [
      { type: 'activityStarted', toolUseId: `${id}r`, kind: 'read', detail: 'src/app.ts' },
      { type: 'activityFinished', toolUseId: `${id}r`, outcome: 'ok' },
      { type: 'activityStarted', toolUseId: `${id}e`, kind: 'edit', detail: 'src/app.ts' },
      { type: 'activityFinished', toolUseId: `${id}e`, outcome: 'ok' },
      { type: 'message', text: reply },
      {
        type: 'usage',
        contextUsed: 20_000 + 5_000 * this.diffs,
        contextMax: 200_000,
        totalCost: 15_000 * this.diffs,
      },
      { type: 'turnEnded', queuedTurns: 0 },
    ];
  }

  private submission(): AgentEvent[] {
    return [
      { type: 'taskSubmitted', toolUseId: `s${++this.diffs}`, summary: 'Ready for review.' },
      { type: 'turnEnded', queuedTurns: 0 },
    ];
  }

  private perform(effect: Effect): void {
    switch (effect.type) {
      case 'createWorktree':
        setTimeout(
          () =>
            this.input({
              kind: 'gm',
              t: this.t(),
              event: {
                type: 'worktreeCreated',
                islandId: effect.islandId,
                path: `/demo.ibitsa/${effect.branch}`,
                branch: effect.branch,
              },
            }),
          STEP_MS,
        );
        return;
      case 'startSession':
      case 'resumeSession':
        this.agent(effect.heroId, [
          { type: 'sessionStarted', sessionId: 'live-session' },
          ...this.turn('I looked around and made a first change. What next?'),
        ]);
        return;
      case 'sendMessage':
        // Asking it to submit hands the task in, so the Finish flow can be played too.
        this.agent(effect.heroId, [
          { type: 'turnStarted' },
          ...(/submit/i.test(effect.text) ? this.submission() : this.turn(`Done: ${effect.text}`)),
        ]);
        return;
      case 'interrupt':
        this.agent(effect.heroId, [{ type: 'turnEnded', queuedTurns: 0 }]);
        return;
      case 'observeDiff':
        this.input({
          kind: 'gm',
          t: this.t(),
          event: { type: 'diffObserved', heroId: effect.heroId, hash: `h${this.diffs}` },
        });
        return;
      case 'checkSubmit':
        this.input({
          kind: 'gm',
          t: this.t(),
          event: {
            type: 'submitChecked',
            heroId: effect.heroId,
            toolUseId: effect.toolUseId,
            ok: true,
          },
        });
        return;
      case 'removeWorktree':
        this.input({
          kind: 'gm',
          t: this.t(),
          event: { type: 'worktreeRemoved', islandId: effect.islandId },
        });
        return;
      default:
        // Timers, answers, submit verdicts and session closing need no scripted reply here.
        return;
    }
  }

  private emitSnapshot(): void {
    this.emit({
      type: 'snapshot',
      seq: ++this.seq,
      snapshot: { ...view(this.state), repo: this.repo },
    });
  }

  private emit(message: CoreMessage): void {
    queueMicrotask(() => {
      for (const l of this.listeners) l(message);
    });
  }
}
