import type { GameClient } from './client';

/** Starts the game in `root`, talking to the core through `host`. Shared by the webview and standalone builds. */
export interface Started {
  client: GameClient;
  /** Current integer zoom, 0 before the game is ready or without WebGL. */
  zoom(): number;
}
