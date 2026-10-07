// The pack manifest (`pack.json`, spec §9.3). Engine-neutral: it describes images by frame size,
// animation rows and slice insets, never by a renderer's atlas format (§9.1).

/** Sizes fixed by the visual asset spec (§9.2). Packs must match them. */
export const SPEC = {
  characterFrame: 16,
  /** Council sheets, for the council hut only (§9.2). */
  councilFrame: 32,
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
} as const;

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
/** A council sheet's animations, all required when a character has one (§9.2). */
export const COUNCIL_ANIMATIONS = ['idle', 'talk', 'think', 'raiseHand', 'write'] as const;
export const TASK_POINT_STATES = ['locked', 'active', 'done', 'underReview'] as const;
/** The protocol's `ActivityKind`s (spec §5.4); assets has no dependency on protocol, so they repeat here. */
export const ACTIVITY_KINDS = ['read', 'search', 'edit', 'test', 'run', 'think', 'other'] as const;
