import type * as Phaser from 'phaser';
import type { HutMode, HutStep } from './hut-view.types';

/** The game objects for one seat at the table. */
export interface SeatObjects {
  x: number;
  appearance: string;
  sprite: Phaser.GameObjects.Sprite;
  glow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  hand: Phaser.GameObjects.Container;
  mark: Phaser.GameObjects.Text;
  book: Phaser.GameObjects.Rectangle;
}

/** What the hut scene is actually showing, read from its game objects, for tests. */
export interface HutRendered {
  mode: HutMode;
  /** The step the tracker highlights. */
  step: HutStep;
  stage: 'study' | 'dialogue';
  /** The councillor under the speaker's light. */
  speaker: string | null;
  decisions: number;
  councillors: {
    id: string;
    x: number;
    animation: string | null;
    scale: number;
    /** The mark above the head while studying: dots, or ✓ once the report is in. */
    mark: string | null;
    hand: boolean;
    book: boolean;
  }[];
}
