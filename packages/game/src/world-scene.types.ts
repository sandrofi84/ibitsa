import type { ReviewerProbe } from './councillor-token.types';
import type { MapPose } from './poses.types';

/** What the map shows (#124), for tests and probes. */
export interface MapProbe {
  /** The pose each hero plays (#222), and the one its state asks for before any fallback. */
  poses?: { heroId: string; pose: MapPose; wants: MapPose }[];
  /** The part of the map with something on it. */
  bounds: { x: number; y: number; width: number; height: number };
  islands: {
    id: string;
    x: number;
    y: number;
    row: 'top' | 'bottom';
    dim: boolean;
    /** Its PR badge (#153): the PR's state, `none` while it could open one, or null. */
    pr?: string | null;
  }[];
  bridges: { from: string; to: string; vertical: boolean; lowered: boolean; behind: boolean }[];
  /** Heroes showing the padlock, and what they wait for. */
  blocked?: { heroId: string; reason: 'slot' | 'previousIsland' | 'dependency' }[];
  /** The hero the camera follows: the selected one (#125), else the first working, else the first. */
  following?: string | null;
  /** Heroes waiting under the hourglass while their task is reviewed (#140). */
  underReview?: string[];
  /** The councillors out reviewing (#140): where they are and what they show. */
  reviewers?: ReviewerProbe[];
  /** Every island's PR is merged (#153). */
  shipped?: boolean;
  /** Heroes at (or walking to) Ibitsa. */
  atIbitsa?: string[];
  /** Home Village shows its buildings' labels: no campaign is running (#180). */
  startScreen?: boolean;
  /** Islands charted out of the fog so far (#180). */
  charted?: string[];
  /** What the mist says once the heroes reach the horizon (#180); null before. */
  voyage?: string | null;
  /** The ended campaign's islands have sunk (#180). */
  sunk?: boolean;
}
