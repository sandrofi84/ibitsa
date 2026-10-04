import * as v from 'valibot';

// The pack manifest (`pack.json`, spec §9.3). Engine-neutral: it describes images by frame size,
// animation rows and slice insets, never by a renderer's atlas format (§9.1).

/** Sizes fixed by the visual asset spec (§9.2). Packs must match them. */
export const SPEC = {
  characterFrame: 16,
  portrait: 64,
  tile: 16,
  island: { height: 96, leftCap: 48, middle: 32, rightCap: 48 },
  taskPoint: 16,
  hut: 64,
  dialogueFrame: 24,
} as const;

export const REQUIRED_ANIMATIONS = ['idle', 'walk', 'work'] as const;
export const OPTIONAL_ANIMATIONS = [
  'test',
  'ask',
  'blocked',
  'rest',
  'celebrate',
  'hurt',
  'review',
  'outOfGold',
] as const;
export const TASK_POINT_STATES = ['locked', 'active', 'done', 'underReview'] as const;

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
  buildings: v.record(v.string(), v.strictObject({ image: file, width: size, height: size })),
  ui: v.strictObject({
    dialogueFrame: v.strictObject({ image: file, size, inset: size }),
  }),
});

export type Manifest = v.InferOutput<typeof ManifestSchema>;
