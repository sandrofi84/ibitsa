import type * as Phaser from 'phaser';
import type { Point } from './layout.types';
import type { MapPose } from './poses.types';
import type { PlateBox, ReviewerView } from './reviewers.types';

/** A reviewing councillor on the map as tests and probes see it (#140). */
export interface ReviewerProbe {
  key: string;
  councillorId: string;
  /** The pack character it's drawn as (#220), e.g. `councillor.tester`. */
  character: string;
  taskPointId: string;
  /** Where its feet are, on the map. */
  x: number;
  y: number;
  /** Walking out to the task point or back to the hut. */
  walking: boolean;
  /** The magnifier shows while its review runs. */
  magnifier: boolean;
  /** The red badge's count of blocking findings when it asked for changes, else null. */
  badge: number | null;
  /** The grey "?" of a review that failed. */
  failed: boolean;
  leaving: boolean;
  /** The pose it plays (#222): `review` while its review runs. */
  pose: MapPose;
  /** Its name plate where it's drawn now, after stacking clear of the others (#234). */
  plate: PlateBox;
}

export interface CouncillorTokenOptions {
  scene: Phaser.Scene;
  /** The map layer the token lives in, so the camera zooms it. */
  layer: Phaser.GameObjects.Container;
  view: ReviewerView;
  /** The pack character it's drawn with. */
  character: string;
  title: string;
  /** The side of the hero it stands on: its name plate reaches outward, away from the hero. */
  side: 1 | -1;
  /** From the council hut's door to its place beside the task point. */
  path: Point[];
  /** Reduced motion: it appears in place and leaves without walking. */
  still: boolean;
  /** Called once it's back at the hut and off the map. */
  gone: () => void;
}
