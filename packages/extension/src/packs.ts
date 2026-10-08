import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePack } from '@ibitsa/assets';
import type { PackView } from '@ibitsa/protocol';
import type { PackLibraryDeps } from './packs.types';

/**
 * The asset packs Ibitsa can use (§9.3, #183): the bundled default, the user's in `~/.ibitsa/packs/`
 * and the project's in `.ibitsa/packs/`, each checked by the validator. A pack with errors is listed,
 * with them, but never used.
 */
export class PackLibrary {
  constructor(private readonly deps: PackLibraryDeps) {}

  /** The folders packs live in, so the webview may load their files. */
  roots(): string[] {
    return [
      join(this.deps.home, '.ibitsa', 'packs'),
      ...(this.deps.workspace ? [join(this.deps.workspace, '.ibitsa', 'packs')] : []),
    ];
  }

  list(): PackView[] {
    const builtin: PackView = {
      id: 'default',
      name: 'Default',
      scope: 'builtin',
      errors: [],
      warnings: [],
      preview: null,
    };
    return [builtin, ...this.found().map((p) => this.view(p))];
  }

  /** The folder of a usable pack; null for the default, an unknown id, or a pack with errors. */
  dir(id: string): string | null {
    const pack = this.found().find((p) => p.id === id);
    if (!pack) return null;
    return validatePack(pack.dir).ok ? pack.dir : null;
  }

  private found(): { id: string; scope: 'user' | 'project'; dir: string }[] {
    const [user, project] = this.roots();
    const scan = ({ root, scope }: { root: string | undefined; scope: 'user' | 'project' }) =>
      root && existsSync(root)
        ? readdirSync(root, { withFileTypes: true })
            .filter((e) => e.isDirectory() && /^[\w.-]{1,100}$/.test(e.name))
            .map((e) => ({ id: `${scope}:${e.name}`, scope, dir: join(root, e.name) }))
        : [];
    return [...scan({ root: user, scope: 'user' }), ...scan({ root: project, scope: 'project' })];
  }

  private view(pack: { id: string; scope: 'user' | 'project'; dir: string }): PackView {
    const checked = validatePack(pack.dir);
    if (!checked.ok) {
      return {
        id: pack.id,
        name: nameOf(pack.dir),
        scope: pack.scope,
        errors: checked.errors,
        warnings: [],
        preview: null,
      };
    }
    const manifest = checked.manifest;
    const [, character] = Object.entries(manifest.characters)[0] ?? [];
    const walk = character?.animations.walk;
    return {
      id: pack.id,
      name: manifest.name,
      scope: pack.scope,
      errors: [],
      warnings: checked.warnings,
      preview:
        character && walk
          ? {
              sheet: this.deps.url(join(pack.dir, character.sheet)),
              frameWidth: character.frame.width,
              frameHeight: character.frame.height,
              row: walk.row,
              frames: walk.frames,
              fps: walk.fps,
            }
          : null,
    };
  }
}

/** A broken pack's name from its manifest if that much reads, else its folder's. */
function nameOf(dir: string): string {
  try {
    const name = (JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as { name?: unknown })
      .name;
    if (typeof name === 'string' && name.trim()) return name;
  } catch {
    // Unreadable: the folder's name it is.
  }
  return dir.split(/[\\/]/).at(-1) ?? dir;
}
