/** What the map shows (#124), for tests and probes. */
export interface MapProbe {
  /** The part of the map with something on it. */
  bounds: { x: number; y: number; width: number; height: number };
  islands: { id: string; x: number; y: number; row: 'top' | 'bottom'; dim: boolean }[];
  bridges: { from: string; to: string; vertical: boolean; lowered: boolean; behind: boolean }[];
  /** Heroes showing the padlock, and what they wait for. */
  blocked?: { heroId: string; reason: 'slot' | 'previousIsland' | 'dependency' }[];
}
