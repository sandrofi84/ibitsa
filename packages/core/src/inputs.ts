import type { AgentEvent, Command } from '@ibitsa/protocol';

/** Results of the game master's own work, reported by the runtime (spec §11.2). */
export type GameMasterEvent =
  | { type: 'worktreeCreated'; islandId: string; path: string; branch: string }
  | { type: 'worktreeFailed'; islandId: string; message: string }
  /** Outcome of the submit check (§5.5): clean worktree with at least one commit beyond its base. */
  | { type: 'submitChecked'; heroId: string; toolUseId: string; ok: boolean; reason?: string };

/**
 * Everything core reacts to. `t` is milliseconds since the campaign's log header and is core's only clock
 * (ADR 0001). The runtime appends each input to the event log before stepping.
 */
export type CoreInput =
  | { kind: 'agent'; t: number; heroId: string; event: AgentEvent }
  | { kind: 'command'; t: number; command: Command }
  | { kind: 'gm'; t: number; event: GameMasterEvent }
  | { kind: 'timer'; t: number; timerId: string };
