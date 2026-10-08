import * as v from 'valibot';
import {
  ACTIVITY_KINDS,
  BRIDGE_FRAMES,
  COUNCIL_ANIMATIONS,
  MARKER_KINDS,
  OPTIONAL_ANIMATIONS,
  REQUIRED_ANIMATIONS,
  SOUND_SLOTS,
  TASK_POINT_STATES,
} from './manifest.ts';

const file = v.pipe(
  v.string(),
  v.regex(/^(?!\/)(?!.*\.\.)[\w./-]+\.png$/, 'must be a relative .png path inside the pack'),
);
/** A sound file inside the pack (#184). */
const audio = v.pipe(
  v.string(),
  v.regex(
    /^(?!\/)(?!.*\.\.)[\w./-]+\.(ogg|mp3|wav)$/,
    'must be a relative .ogg, .mp3 or .wav path inside the pack',
  ),
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
  /** Optional 48×48 full-body sheet for the council hut; without one the hut scales `sheet` up 3× (§9.2). */
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
  /**
   * Stacked islands' drawbridges (§9.2, #124): one row per frame in `frames` order, each a left end, a
   * repeatable segment and a right end. Optional: without it the game draws plain planks.
   */
  bridge: v.optional(
    v.strictObject({
      image: file,
      height: size,
      end: size,
      segment: size,
      frames: v.array(v.picklist(BRIDGE_FRAMES)),
    }),
  ),
  /** Small map markers, left to right in `kinds` order (#124). Optional: the game draws its own. */
  markers: v.optional(
    v.strictObject({ image: file, size, kinds: v.array(v.picklist(MARKER_KINDS)) }),
  ),
  buildings: v.record(v.string(), v.strictObject({ image: file, width: size, height: size })),
  ui: v.strictObject({
    dialogueFrame: v.strictObject({ image: file, size, inset: size }),
  }),
  /**
   * Scene pictures (#219, #221), each its fixed size (SCENE_SIZES): the hut interior behind the
   * councillors and the table in front of them (480×270 each, the table transparent above it), Home
   * Village's island (128×96) and Ibitsa's silhouette (48×32). Optional: the game draws its own.
   */
  scenes: v.optional(
    v.strictObject({
      hutInterior: v.optional(file),
      hutTable: v.optional(file),
      village: v.optional(file),
      ibitsa: v.optional(file),
    }),
  ),
  /** Sounds by slot (§9.4, #184): OGG, MP3 or WAV; music loops when `loop` is set. Optional. */
  sounds: v.optional(
    v.record(
      v.picklist(SOUND_SLOTS),
      v.strictObject({ file: audio, loop: v.optional(v.boolean()) }),
    ),
  ),
});

export type Manifest = v.InferOutput<typeof ManifestSchema>;
