import type { ActionDraft } from '@ibitsa/protocol';

/** Where the two scopes keep skills: the user's home and the workspace repo. */
export interface SkillRoots {
  personal: string;
  project: string;
}

export interface SkillWriteRequest {
  draft: ActionDraft;
  /** Replace an existing skill of the same name. */
  overwrite: boolean;
}

export type SkillWriteResult =
  | { ok: true; path: string }
  | { ok: false; reason: string; clash: boolean };
