import type { AgentView } from '@ibitsa/protocol';
import type { SettingLayers } from './guild-settings.types';

/** VS Code's `ibitsa.classes` and `ibitsa.recolor`, behind what the Armory needs (#182). */
export interface ArmoryDeps {
  /** The agents a class can run on (§11.5, #198), and whether each is installed. */
  agents?: () => AgentView[];
  inspect(key: 'classes' | 'recolor'): SettingLayers | undefined;
  update(change: {
    key: 'classes' | 'recolor';
    value: Record<string, unknown> | undefined;
    layer: 'user' | 'workspace';
  }): PromiseLike<void>;
}
