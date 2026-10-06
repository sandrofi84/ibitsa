import type { CouncillorInfo } from '@ibitsa/protocol';

/** A folder of skills, one sub-folder each, and how its councillors are named. */
export interface SkillRoot {
  dir: string;
  source: CouncillorInfo['source'];
  /** A plugin's name, which Claude Code puts before its skills' names (`ibitsa:security`). */
  prefix: string | null;
}
