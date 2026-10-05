import {
  type Command,
  type CoreMessage,
  type Cue,
  PROTOCOL_VERSION,
  type Snapshot,
} from '@ibitsa/protocol';
import type { CommandIntent } from './client.types';
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

  receive(message: CoreMessage): void {
    switch (message.type) {
      case 'welcome':
        this.versionMismatch = message.protocolVersion !== PROTOCOL_VERSION;
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
}
