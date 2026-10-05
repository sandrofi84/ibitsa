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
