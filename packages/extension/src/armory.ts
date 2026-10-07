import {
  type ArmoryLayer,
  type ArmoryView,
  type ClassSetting,
  type Recolor,
  resolveClasses,
  resolveRecolor,
} from '@ibitsa/protocol';
import type { ArmoryDeps } from './armory.types';

/**
 * The Guild Hall's Armory over VS Code's settings (§5.2, §7.1, #182): the classes and recolors in play,
 * each with the layer it's set in, and one entry written or removed at a time, at your layer or the
 * project's. The rest of the setting is left as it was.
 */
export class Armory {
  constructor(private readonly deps: ArmoryDeps) {}

  view(): ArmoryView {
    const classes = this.deps.inspect('classes') ?? {};
    const recolors = this.deps.inspect('recolor') ?? {};
    // The project's settings win over yours, entry by entry.
    const merged = { ...asObject(classes.globalValue), ...asObject(classes.workspaceValue) };
    const recolor = resolveRecolor({
      ...asObject(recolors.globalValue),
      ...asObject(recolors.workspaceValue),
    });
    return {
      classes: resolveClasses(merged).map((c) => ({
        ...c,
        layer: layerOf({ key: c.id, layers: classes }),
      })),
      recolor: Object.entries(recolor).map(([target, r]) => ({
        target,
        recolor: r,
        layer: layerOf({ key: target, layers: recolors }),
      })),
    };
  }

  async writeClass({
    id,
    value,
    layer,
  }: {
    id: string;
    value: ClassSetting;
    layer: 'user' | 'workspace';
  }): Promise<void> {
    await this.set({ key: 'classes', entry: id, value, layer });
  }

  async resetClass({ id, layer }: { id: string; layer: 'user' | 'workspace' }): Promise<void> {
    await this.set({ key: 'classes', entry: id, value: undefined, layer });
  }

  async writeRecolor({
    target,
    recolor,
    layer,
  }: {
    target: string;
    recolor: Recolor;
    layer: 'user' | 'workspace';
  }): Promise<void> {
    await this.set({ key: 'recolor', entry: target, value: recolor, layer });
  }

  async resetRecolor({
    target,
    layer,
  }: {
    target: string;
    layer: 'user' | 'workspace';
  }): Promise<void> {
    await this.set({ key: 'recolor', entry: target, value: undefined, layer });
  }

  /** Sets or removes one entry of a layer's object; an emptied layer is removed altogether. */
  private async set({
    key,
    entry,
    value,
    layer,
  }: {
    key: 'classes' | 'recolor';
    entry: string;
    value: unknown;
    layer: 'user' | 'workspace';
  }): Promise<void> {
    const layers = this.deps.inspect(key) ?? {};
    const current = { ...asObject(layer === 'user' ? layers.globalValue : layers.workspaceValue) };
    if (value === undefined) delete current[entry];
    else current[entry] = value;
    await this.deps.update({
      key,
      value: Object.keys(current).length > 0 ? current : undefined,
      layer,
    });
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function layerOf({
  key,
  layers,
}: {
  key: string;
  layers: { globalValue?: unknown; workspaceValue?: unknown };
}): ArmoryLayer {
  if (key in asObject(layers.workspaceValue)) return 'workspace';
  if (key in asObject(layers.globalValue)) return 'user';
  return 'default';
}
