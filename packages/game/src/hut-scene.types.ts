import type * as Phaser from 'phaser';
import type { HutMode, HutStep } from './hut-view.types';
import type { PixelText } from './pixel-text';

/** The game objects for one seat at the table. */
export interface SeatObjects {
  x: number;
  appearance: string;
  /** Walking in from the door (#219): the pose waits until the councillor reaches the seat. */
  walking: boolean;
  /** The pose the councillor is in, or will be once seated. */
  pose: { texture: string; animation: string; scale: number };
  sprite: Phaser.GameObjects.Sprite;
  glow: Phaser.GameObjects.Ellipse;
  label: PixelText;
  /** The name plate behind the label, on the table's front (#233). */
  plate: Phaser.GameObjects.Rectangle;
  hand: Phaser.GameObjects.Container;
  mark: PixelText;
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
  /** Whose room and table show (#219): the pack's pictures, or the ones the game draws. */
  room: 'pack' | 'drawn';
  table: 'pack' | 'drawn';
  /** The "Book of Decisions" counter's plate (#233). */
  decisionsPlate: PlateBox;
  councillors: {
    id: string;
    /** The seat. */
    x: number;
    /** Where the councillor is now: the door while walking in, else the seat. */
    at: number;
    walking: boolean;
    animation: string | null;
    scale: number;
    /** The mark above the head while studying: dots, or ✓ once the report is in. */
    mark: string | null;
    hand: boolean;
    book: boolean;
    /** The name on its plate, and where the plate is (#233). */
    name: string;
    plate: PlateBox;
  }[];
}

/** A plate's box in room pixels: left, top, right, bottom (#233). */
export interface PlateBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
