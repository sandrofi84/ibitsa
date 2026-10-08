import type { ActivityEnd, HeroChange, HeroPoseInput, MapPose, PoseLookup } from './poses.types';

/**
 * What a pose falls back to when a character's sheet doesn't have it (§9.2, #222): what the map
 * showed before it had the pose. Null ends the chain; the required idle, walk and work have none, and
 * the brief celebrate and hurt are just skipped.
 */
export const POSE_FALLBACK: Readonly<Record<MapPose, MapPose | null>> = {
  idle: null,
  walk: null,
  work: null,
  test: 'work',
  ask: 'idle',
  blocked: 'idle',
  rest: 'idle',
  celebrate: null,
  hurt: null,
  review: 'idle',
  outOfGold: 'idle',
};

/** The pose a hero holds for its state (#222); walking wins while it's on the move. */
export function heroPose({ state, activity, walking }: HeroPoseInput): MapPose {
  if (walking || state === 'traveling') return 'walk';
  switch (state) {
    case 'blocked':
      return 'blocked';
    case 'waitingOnYou':
      return 'ask';
    case 'resting':
      return 'rest';
    case 'outOfGold':
      return 'outOfGold';
    case 'working':
      if (!activity || activity.kind === 'think') return 'idle';
      return activity.kind === 'test' ? 'test' : 'work';
    default:
      return 'idle';
  }
}

/**
 * The pose a character can actually show: the one asked for, else its fallbacks in turn, else null
 * when the sheet has none of them.
 */
export function availablePose({ pose, has }: PoseLookup): MapPose | null {
  for (let p: MapPose | null = pose; p !== null; p = POSE_FALLBACK[p]) if (has(p)) return p;
  return null;
}

/** A brief pose a hero strikes as its state changes: a jump when its work is handed in. */
export function heroMoment({ previous, next }: HeroChange): MapPose | null {
  return next === 'submitted' && previous !== 'submitted' ? 'celebrate' : null;
}

/** A brief pose for an activity's end: a flinch when a test fails. */
export function activityMoment({ kind, outcome }: ActivityEnd): MapPose | null {
  return kind === 'test' && outcome === 'failed' ? 'hurt' : null;
}
