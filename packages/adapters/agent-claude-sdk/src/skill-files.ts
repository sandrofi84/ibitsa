import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillFile, SkillFilesOptions } from './skill-files.types';

/**
 * Where Claude Code keeps a skill or command, read the way the `/` menu (#84) and the preview (#85)
 * need: `ibitsa-target` and the prompt text. The list of what exists comes from the SDK; this only finds
 * the file behind a name: the project's skills, the user's, the older `commands` folders, and plugins
 * (for `plugin:name`). Null when the file isn't in any of them, e.g. another tool's plugin.
 */
export class SkillFiles {
  constructor(private readonly options: SkillFilesOptions) {}

  find(name: string): SkillFile | null {
    for (const path of this.candidates(name)) {
      if (existsSync(path)) return read(path);
    }
    return null;
  }

  private candidates(name: string): string[] {
    const { cwd, home, pluginDirs } = this.options;
    const [plugin, base] = name.includes(':') ? name.split(':', 2) : [null, name];
    if (plugin && base) {
      return pluginDirs
        .filter((dir) => pluginName(dir) === plugin)
        .flatMap((dir) => [
          join(dir, 'skills', base, 'SKILL.md'),
          join(dir, 'commands', `${base}.md`),
        ]);
    }
    return [cwd, home].flatMap((root) => [
      join(root, '.claude', 'skills', name, 'SKILL.md'),
      join(root, '.claude', 'commands', `${name}.md`),
    ]);
  }
}

/** A plugin's name from its manifest, else its folder name. */
function pluginName(dir: string): string {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'),
    ) as {
      name?: unknown;
    };
    if (typeof manifest.name === 'string') return manifest.name;
  } catch {
    // No readable manifest: fall back to the folder's name.
  }
  return dir.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

function read(path: string): SkillFile {
  const text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { path, fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv?.[1]) fields[kv[1]] = (kv[2] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { path, fields, body: text.slice(match[0].length) };
}

/** Skill folders worth watching for changes to the `/` menu (#84). */
export function skillFolders({ cwd, home }: { cwd: string; home: string }): string[] {
  return [cwd, home]
    .flatMap((root) => [join(root, '.claude', 'skills'), join(root, '.claude', 'commands')])
    .filter((dir) => existsSync(dir));
}
