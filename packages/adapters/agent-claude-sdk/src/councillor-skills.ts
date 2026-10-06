import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CouncillorInfo } from '@ibitsa/protocol';
import type { SkillRoot } from './councillor-skills.types';
import { pluginName, readSkillFile } from './skill-files';
import type { SkillFilesOptions } from './skill-files.types';

/** Tools a councillor may have: a sitting only reads (§4.3). */
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'];
const DEFAULT_TOOLS = ['Read', 'Grep', 'Glob'];

/**
 * The councillors a folder can seat (§4.7, #98): skills marked `ibitsa-councillor: true` among Ibitsa's
 * built-ins, the user's skills and the project's. A councillor's id is its skill's name without a plugin
 * prefix, and a later source replaces an earlier one with the same id: project over user over built-in.
 */
export class CouncillorSkills {
  constructor(private readonly options: SkillFilesOptions) {}

  list(): CouncillorInfo[] {
    return [...this.byId().values()]
      .map(({ info }) => info)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * What a councillor brings to planning (#103): its skill's opening lines (who it is, how it speaks)
   * and its `## Planning` section, or the whole body when it has no sections. Null for an unknown id.
   */
  planning(id: string): { info: CouncillorInfo; guidance: string } | null {
    const found = this.byId().get(id);
    if (!found) return null;
    const { body } = readSkillFile(found.path);
    const sections = body.split(/^(?=##\s)/m);
    const opening = sections[0] ?? '';
    const planning = sections.find((part) => /^##\s+Planning\b/i.test(part));
    const review = sections.some((part) => /^##\s+Review\b/i.test(part));
    const guidance = planning || !review ? `${opening}${planning ?? ''}` : opening;
    return { info: found.info, guidance: guidance.trim() };
  }

  private byId(): Map<string, { info: CouncillorInfo; path: string }> {
    const byId = new Map<string, { info: CouncillorInfo; path: string }>();
    for (const root of this.roots()) {
      for (const found of councillorsIn(root)) byId.set(found.info.id, found);
    }
    return byId;
  }

  private roots(): SkillRoot[] {
    const { cwd, home, pluginDirs } = this.options;
    return [
      ...pluginDirs.map((dir) => ({
        dir: join(dir, 'skills'),
        source: 'builtin' as const,
        prefix: pluginName(dir),
      })),
      { dir: join(home, '.claude', 'skills'), source: 'user', prefix: null },
      { dir: join(cwd, '.claude', 'skills'), source: 'project', prefix: null },
    ];
  }
}

function councillorsIn(root: SkillRoot): { info: CouncillorInfo; path: string }[] {
  if (!existsSync(root.dir)) return [];
  return readdirSync(root.dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root.dir, entry.name, 'SKILL.md'))
    .filter((path) => existsSync(path))
    .flatMap((path) => {
      const info = toCouncillor({ path, root });
      return info ? [{ info, path }] : [];
    });
}

function toCouncillor({ path, root }: { path: string; root: SkillRoot }): CouncillorInfo | null {
  const { fields, body } = readSkillFile(path);
  if (fields['ibitsa-councillor'] !== 'true') return null;
  const id = fields.name || path.split(/[\\/]/).at(-2) || '';
  if (!id) return null;
  const planning = /^##\s+Planning\b/im.test(body);
  const review = /^##\s+Review\b/im.test(body);
  return {
    id,
    skill: root.prefix ? `${root.prefix}:${id}` : id,
    title: fields['ibitsa-title'] || titleOf(id),
    description: fields.description ?? '',
    source: root.source,
    portrait: fields['ibitsa-portrait'] || null,
    model: fields['ibitsa-model'] || null,
    tools: toolsOf(fields['ibitsa-tools']),
    // A skill without either section is all planning advice.
    modes: { planning: planning || !review, review },
    hash: createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12),
  };
}

/** `security` → `Security`, `api-design` → `Api design`. */
function titleOf(id: string): string {
  const words = id.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `[Read, Grep]` or `Read, Grep`, kept to the read-only tools; the default when none are left. */
function toolsOf(field: string | undefined): string[] {
  if (!field) return DEFAULT_TOOLS;
  const tools = field
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim().replace(/^(["'])(.*)\1$/, '$2'))
    .filter((t) => READ_ONLY_TOOLS.includes(t));
  return tools.length > 0 ? [...new Set(tools)] : DEFAULT_TOOLS;
}
