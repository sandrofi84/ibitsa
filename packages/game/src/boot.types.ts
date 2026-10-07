import type { CameraState } from './camera-director.types';
import type { GameClient } from './client';
import type { HutRendered } from './hut-scene.types';
import type { HutFeed } from './hut-view.types';
import type { MapProbe } from './world-scene.types';

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
    /** How wide its speech bubble's text is on the canvas, in game pixels. */
    speechWidth(): number | null;
    /** The activity icon showing beside it. */
    icon(): string | null;
  };
  /** The map camera, for tests; null before the game is ready. */
  camera(): CameraState | null;
  /** Shows the council hut, drawn from `feed` (§7.1 screen 2); the map sleeps meanwhile. */
  showHut(feed: HutFeed): void;
  /** What the hut shows, for tests; null while it isn't showing. */
  hut(): HutRendered | null;
  /**
   * The hero the map camera follows (#124); the hero pane's selection (#125) calls it. Null goes back to
   * the first hero working.
   */
  selectHero(heroId: string | null): void;
  /** What the map shows, for tests: islands, bridges and blocked heroes; null before the game is ready. */
  map(): MapProbe | null;
}
