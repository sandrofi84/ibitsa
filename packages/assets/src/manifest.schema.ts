import * as v from 'valibot';
import {
  ACTIVITY_KINDS,
  COUNCIL_ANIMATIONS,
  OPTIONAL_ANIMATIONS,
  REQUIRED_ANIMATIONS,
  TASK_POINT_STATES,
} from './manifest.ts';

const file = v.pipe(
  v.string(),
  v.regex(/^(?!\/)(?!.*\.\.)[\w./-]+\.png$/, 'must be a relative .png path inside the pack'),
);
const size = v.pipe(v.number(), v.integer(), v.minValue(1));

const Animation = v.strictObject({
  row: v.pipe(v.number(), v.integer(), v.minValue(0)),
  frames: size,
  fps: size,
});

const Character = v.strictObject({
  /** Display role; heroes stand on round tokens, councillors on square ones (§7.2). */
  role: v.picklist(['hero', 'councillor']),
  sheet: file,
  frame: v.strictObject({ width: size, height: size }),
  /** One row per animation, facing right; the game mirrors for left (§9.2). */
  animations: v.record(v.picklist([...REQUIRED_ANIMATIONS, ...OPTIONAL_ANIMATIONS]), Animation),
  portrait: v.optional(file),
  /** Optional 32×32 sheet for the council hut; without one the hut scales `sheet` up 2× (§9.2). */
  council: v.optional(
    v.strictObject({
      sheet: file,
      frame: v.strictObject({ width: size, height: size }),
      animations: v.record(v.picklist(COUNCIL_ANIMATIONS), Animation),
    }),
  ),
});

export const ManifestSchema = v.strictObject({
  name: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)),
  version: v.string(),
  characters: v.record(v.pipe(v.string(), v.regex(/^[a-z0-9.-]+$/)), Character),
  tiles: v.strictObject({
    image: file,
    tileSize: size,
    /** Named tiles by index in the strip; animated tiles take `frames` consecutive slots. */
    tiles: v.record(
      v.string(),
      v.strictObject({
        index: v.pipe(v.number(), v.integer(), v.minValue(0)),
        frames: v.optional(size),
      }),
    ),
  }),
  island: v.strictObject({
    image: file,
    height: size,
    leftCap: size,
    middle: size,
    rightCap: size,
  }),
  taskPoints: v.strictObject({ image: file, size, states: v.array(v.picklist(TASK_POINT_STATES)) }),
  /** One square icon per activity kind, left to right in `kinds` order, shown beside the hero (#60). */
  activityIcons: v.strictObject({ image: file, size, kinds: v.array(v.picklist(ACTIVITY_KINDS)) }),
  buildings: v.record(v.string(), v.strictObject({ image: file, width: size, height: size })),
  ui: v.strictObject({
    dialogueFrame: v.strictObject({ image: file, size, inset: size }),
  }),
});

export type Manifest = v.InferOutput<typeof ManifestSchema>;
