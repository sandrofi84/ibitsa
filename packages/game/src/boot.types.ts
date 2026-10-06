import type { CameraState } from './camera-director.types';
import type { GameClient } from './client';

/** Starts the game in `root`, talking to the core through `host`. Shared by the webview and standalone builds. */
export interface Started {
  client: GameClient;
  /** Current integer zoom, 0 before the game is ready or without WebGL. */
  zoom(): number;
  /** The first hero on the map, for tests; every read is null without a hero or before the game is ready. */
  hero: {
    /** The sprite's middle in page pixels. */
    onPage(): { x: number; y: number } | null;
    /** What its speech bubble says while it shows. */
    speech(): string | null;
    /** The activity icon showing beside it. */
    icon(): string | null;
  };
  /** The map camera, for tests; null before the game is ready. */
  camera(): CameraState | null;
}
