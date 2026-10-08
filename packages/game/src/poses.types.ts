import type { ActivityKind, HeroView } from '@ibitsa/protocol';

/** The poses a character can strike on the map (§9.2): a pack sheet's animation rows by name. */
export type MapPose =
  | 'idle'
  | 'walk'
  | 'work'
  | 'test'
  | 'ask'
  | 'blocked'
  | 'rest'
  | 'celebrate'
  | 'hurt'
  | 'review'
  | 'outOfGold';

/** What a hero's pose is chosen from: its state, what it's doing, and whether it's on the move. */
export interface HeroPoseInput {
  state: HeroView['state']['kind'];
  activity: { kind: ActivityKind } | null;
  walking: boolean;
}

/** A pose and whether the character's sheet has each one. */
export interface PoseLookup {
  pose: MapPose;
  has: (pose: MapPose) => boolean;
}

/** A hero's state before and after a snapshot, for the brief poses it strikes on a change. */
export interface HeroChange {
  previous: HeroView['state']['kind'];
  next: HeroView['state']['kind'];
}

/** An activity's end, for the brief pose it may cause. */
export interface ActivityEnd {
  kind?: string | undefined;
  outcome: 'ok' | 'failed';
}
