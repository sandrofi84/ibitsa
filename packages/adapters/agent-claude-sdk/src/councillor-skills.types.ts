import type { CouncillorInfo, CouncillorOverrides } from '@ibitsa/protocol';
import type { SkillFilesOptions } from './skill-files.types';

/** Where councillors are found, and the user's field overrides for them (#181). */
export interface CouncillorSkillsOptions extends SkillFilesOptions {
  overrides?: CouncillorOverrides;
}

/** A folder of skills, one sub-folder each, and how its councillors are named. */
export interface SkillRoot {
  dir: string;
  source: CouncillorInfo['source'];
  /** A plugin's name, which Claude Code puts before its skills' names (`ibitsa:security`). */
  prefix: string | null;
}
