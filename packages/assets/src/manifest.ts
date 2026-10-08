// The pack manifest (`pack.json`, spec §9.3). Engine-neutral: it describes images by frame size,
// animation rows and slice insets, never by a renderer's atlas format (§9.1).

/** Sizes fixed by the visual asset spec (§9.2). Packs must match them. */
export const SPEC = {
  characterFrame: 16,
  /** Council sheets, for the council hut only: full-body figures behind the table (§9.2). */
  councilFrame: 48,
  portrait: 64,
  tile: 16,
  island: { height: 96, leftCap: 48, middle: 32, rightCap: 48 },
  taskPoint: 16,
  hut: 64,
  /** The Guild Hall (#179): optional in a pack; the game draws its own without one. */
  guildHall: 48,
  dialogueFrame: 24,
  activityIcon: 12,
  /** A drawbridge row: a left end, a repeatable segment and a right end, 24 tall (§9.2, #124). */
  bridge: { end: 8, segment: 32, height: 24 },
  /** Small map markers, e.g. the padlock over a blocked hero (#124). */
  marker: 12,
  /** Full-scene pictures, e.g. the hut interior and its table layer (§9.2, #219). */
  scene: { width: 480, height: 270 },
  /**
   * Home Village (#221): the whole village island in one picture, the island's own size at one middle
   * slice (48 + 32 + 48 wide, 96 tall). The hut and the Guild Hall stand on it as their own images.
   */
  village: { width: 128, height: 96 },
  /** Ibitsa on the horizon (#221): a far-off silhouette the game fades into its own mist. */
  ibitsa: { width: 48, height: 32 },
} as const;

/**
 * The sound slots a pack may fill (§9.4, #184): cues, and optional music loops for the scenes. A pack
 * without a slot is silent there.
 */
export const SOUND_SLOTS = [
  'needsYou',
  'councillorSpeaks',
  'taskDone',
  'reviewPassed',
  'reviewFailed',
  'prOpened',
  'prMerged',
  'hpLow',
  'resting',
  'campaignStart',
  'campaignEnd',
  'musicVillage',
  'musicMap',
  'musicHut',
] as const;
/** The longest a cue may be, and a music loop, in seconds (§9.4). */
export const SOUND_LIMITS = { cueSeconds: 3, musicSeconds: 120 } as const;

/** A drawbridge's frames, one row each, top to bottom (#124). */
export const BRIDGE_FRAMES = ['lowered', 'raised'] as const;
/**
 * Map markers, left to right: a blocked hero's padlock, a stacked island that's behind (#124), a
 * reviewer's magnifier and a hero waiting under review (#140).
 */
export const MARKER_KINDS = ['padlock', 'behind', 'magnifier', 'hourglass'] as const;
/** The markers a pack's strip must have; the review ones (#140) are drawn by the game if missing. */
export const REQUIRED_MARKERS = ['padlock', 'behind'] as const;

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
/**
 * A council sheet's animations, rows in this order (§9.2): the first five are required when a
 * character has one; `walk` (#219), coming in through the hut's door, is optional.
 */
export const COUNCIL_ANIMATIONS = ['idle', 'talk', 'think', 'raiseHand', 'write', 'walk'] as const;
export const REQUIRED_COUNCIL_ANIMATIONS = [
  'idle',
  'talk',
  'think',
  'raiseHand',
  'write',
] as const satisfies readonly (typeof COUNCIL_ANIMATIONS)[number][];
/**
 * The scene pictures a pack may fill (#219, #221), each its own fixed size; the game draws its own
 * without them.
 */
export const SCENE_SIZES = {
  hutInterior: SPEC.scene,
  hutTable: SPEC.scene,
  village: SPEC.village,
  ibitsa: SPEC.ibitsa,
} as const;
export const SCENE_SLOTS = ['hutInterior', 'hutTable', 'village', 'ibitsa'] as const;
/** The only tile the game draws (§9.2, #221); older packs may still list grass, sand, shore, pathDot. */
export const TILE_NAMES = ['water'] as const;
export const TASK_POINT_STATES = ['locked', 'active', 'done', 'underReview'] as const;
/** The protocol's `ActivityKind`s (spec §5.4); assets has no dependency on protocol, so they repeat here. */
export const ACTIVITY_KINDS = ['read', 'search', 'edit', 'test', 'run', 'think', 'other'] as const;
