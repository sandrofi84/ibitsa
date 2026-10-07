import { join } from 'node:path';
import type {
  CouncillorOverride,
  CouncillorOverrides,
  CouncilSettingsView,
} from '@ibitsa/protocol';
import type { CouncilSettingKey, GuildCouncilDeps, Layer } from './guild-council.types';
import { openablePath } from './host-channel';

/**
 * The Guild Hall's Roster over VS Code's settings and the skill files (§4.7, #181): councillors turned
 * on or off (`ibitsa.council.disabled`), their field overrides (`ibitsa.councillors`), a councillor's
 * skill copied to customise it, and new councillors from a template.
 */
export class GuildCouncil {
  constructor(private readonly deps: GuildCouncilDeps) {}

  view(): CouncilSettingsView {
    const disabled = this.effective('council.disabled');
    const overrides = this.effective('councillors');
    return {
      disabled: stringsOf(disabled.value),
      disabledLayer: disabled.layer,
      overrides: overridesOf(overrides.value),
      overridesLayer: overrides.layer,
    };
  }

  /**
   * Turns a councillor on or off at a layer. The layer gets the whole list as it applies now, changed:
   * VS Code doesn't merge lists across layers.
   */
  async setEnabled({ id, enabled, layer }: { id: string; enabled: boolean; layer: Layer }) {
    const now = this.view().disabled.filter((d) => d !== id);
    await this.deps.update({ key: 'council.disabled', value: enabled ? now : [...now, id], layer });
  }

  /** Sets (or, with null, removes) a councillor's overrides at a layer, keeping everyone else's. */
  async setOverride({
    id,
    override,
    layer,
  }: {
    id: string;
    override: CouncillorOverride | null;
    layer: Layer;
  }) {
    const { [id]: _old, ...others } = this.view().overrides;
    const cleaned = override ? withoutBlanks(override) : null;
    const value = cleaned ? { ...others, [id]: cleaned } : others;
    await this.deps.update({
      key: 'councillors',
      value: Object.keys(value).length > 0 ? value : undefined,
      layer,
    });
  }

  /**
   * Copies a councillor's skill to your skills or the project's and opens it (replace, §4.7): only a
   * `SKILL.md` inside one of the skill folders. An existing copy is opened, never overwritten. Returns
   * the copy's path, or null when it can't.
   */
  customise({ id, path, layer }: { id: string; path: string; layer: Layer }): string | null {
    const source = openablePath({ path, workspace: undefined, roots: this.skillRoots() });
    const target = this.target({ id, layer });
    if (!source?.endsWith('SKILL.md') || !target || !this.deps.files.exists(source)) return null;
    if (!this.deps.files.exists(target))
      this.deps.files.write({ path: target, text: this.deps.files.read(source) });
    this.deps.open(target);
    return target;
  }

  /** Writes a new councillor's skill from the template and opens it; an existing one is just opened. */
  create({
    id,
    title,
    description,
    layer,
  }: {
    id: string;
    title: string;
    description: string;
    layer: Layer;
  }): string | null {
    const target = this.target({ id, layer });
    if (!target) return null;
    if (!this.deps.files.exists(target))
      this.deps.files.write({ path: target, text: councillorTemplate({ id, title, description }) });
    this.deps.open(target);
    return target;
  }

  private target({ id, layer }: { id: string; layer: Layer }): string | null {
    const { home, workspace } = this.deps.roots;
    const base = layer === 'user' ? home : workspace;
    return base ? join(base, '.claude', 'skills', id, 'SKILL.md') : null;
  }

  private skillRoots(): string[] {
    const { home, workspace, plugin } = this.deps.roots;
    return [
      join(plugin, 'skills'),
      join(home, '.claude', 'skills'),
      ...(workspace ? [join(workspace, '.claude', 'skills')] : []),
    ];
  }

  private effective(key: CouncilSettingKey): {
    value: unknown;
    layer: CouncilSettingsView['disabledLayer'];
  } {
    const layers = this.deps.inspect(key) ?? {};
    if (layers.workspaceValue !== undefined)
      return { value: layers.workspaceValue, layer: 'workspace' };
    if (layers.globalValue !== undefined) return { value: layers.globalValue, layer: 'user' };
    return { value: layers.defaultValue, layer: 'default' };
  }
}

/** A new councillor's skill (§4.7): marked for the council, kept out of the hero's `/` menu. */
export function councillorTemplate({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}): string {
  return `---
name: ${id}
description: ${description}
ibitsa-councillor: true
ibitsa-title: ${title}
ibitsa-target: council
disable-model-invocation: true
---
You are ${title}, a councillor of Ibitsa. ${description}

## Planning

What you look for when the council plans a task in your field, the questions you'd ask the user, and how
you write acceptance criteria for it.

## Review

How you review a hero's changes against your criteria: what blocks the task, and what is only a
suggestion.
`;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function overridesOf(value: unknown): CouncillorOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, o]) => typeof o === 'object' && o !== null && !Array.isArray(o),
    ),
  ) as CouncillorOverrides;
}

/** Drops empty fields; null when nothing is left. */
function withoutBlanks(override: CouncillorOverride): CouncillorOverride | null {
  const kept = Object.fromEntries(
    Object.entries(override).filter(([, v]) =>
      Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== '',
    ),
  );
  return Object.keys(kept).length > 0 ? (kept as CouncillorOverride) : null;
}
