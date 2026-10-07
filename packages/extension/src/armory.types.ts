import type { SettingLayers } from './guild-settings.types';

/** VS Code's `ibitsa.classes` and `ibitsa.recolor`, behind what the Armory needs (#182). */
export interface ArmoryDeps {
  inspect(key: 'classes' | 'recolor'): SettingLayers | undefined;
  update(change: {
    key: 'classes' | 'recolor';
    value: Record<string, unknown> | undefined;
    layer: 'user' | 'workspace';
  }): PromiseLike<void>;
}
