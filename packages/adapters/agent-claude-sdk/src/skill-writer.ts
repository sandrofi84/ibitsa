import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ActionDraft } from '@ibitsa/protocol';
import { SkillFiles } from './skill-files';
import type { SkillRoots, SkillWriteRequest, SkillWriteResult } from './skill-writer.types';

/**
 * Writes a new action as a Claude Code skill (§6.2, #86): `<root>/.claude/skills/<name>/SKILL.md`, so it
 * also works as a `/command` in plain Claude Code. A name already taken in either scope is a clash
 * unless overwriting.
 */
export class SkillWriter {
  constructor(private readonly roots: SkillRoots) {}

  write({ draft, overwrite }: SkillWriteRequest): SkillWriteResult {
    const existing = new SkillFiles({
      cwd: this.roots.project,
      home: this.roots.personal,
      pluginDirs: [],
    }).find(draft.name);
    if (existing && !overwrite) {
      return { ok: false, reason: `There is already a skill named ${draft.name}.`, clash: true };
    }
    const root = draft.scope === 'personal' ? this.roots.personal : this.roots.project;
    const path = join(root, '.claude', 'skills', draft.name, 'SKILL.md');
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, skillText(draft));
      return { ok: true, path };
    } catch (e) {
      return { ok: false, reason: `Couldn't save the action: ${String(e)}`, clash: false };
    }
  }
}

/** The skill file: Claude Code's frontmatter plus Ibitsa's target, then the prompt. */
export function skillText(draft: ActionDraft): string {
  const lines = [
    '---',
    `name: ${draft.name}`,
    `description: ${quote(draft.description)}`,
    // Quoted: an unquoted `[x]` is a YAML list and reaches the menu as `x` (seen in #84).
    ...(draft.argumentHint ? [`argument-hint: ${quote(draft.argumentHint)}`] : []),
    'disable-model-invocation: true',
    `ibitsa-target: ${draft.target}`,
    '---',
  ];
  return `${lines.join('\n')}\n${draft.prompt.trim()}\n`;
}

/** A YAML double-quoted string on one line. */
function quote(text: string): string {
  return JSON.stringify(text.replace(/\s+/g, ' ').trim());
}
