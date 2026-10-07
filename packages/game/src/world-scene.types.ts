import type { ReviewerProbe } from './councillor-token.types';

/** What the map shows (#124), for tests and probes. */
export interface MapProbe {
  /** The part of the map with something on it. */
  bounds: { x: number; y: number; width: number; height: number };
  islands: { id: string; x: number; y: number; row: 'top' | 'bottom'; dim: boolean }[];
  bridges: { from: string; to: string; vertical: boolean; lowered: boolean; behind: boolean }[];
  /** Heroes showing the padlock, and what they wait for. */
  blocked?: { heroId: string; reason: 'slot' | 'previousIsland' | 'dependency' }[];
  /** The hero the camera follows: the selected one (#125), else the first working, else the first. */
  following?: string | null;
  /** Heroes waiting under the hourglass while their task is reviewed (#140). */
  underReview?: string[];
  /** The councillors out reviewing (#140): where they are and what they show. */
  reviewers?: ReviewerProbe[];
}
