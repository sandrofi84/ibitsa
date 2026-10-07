import type { SettingKey, SettingValue } from '@ibitsa/protocol';

/** A setting's schema as the extension's manifest declares it (`contributes.configuration`). */
export interface SettingSchema {
  type?: string | string[];
  enum?: string[];
  minimum?: number;
  default?: unknown;
  markdownDescription?: string;
  description?: string;
}

/** What VS Code knows of a setting at each layer (`WorkspaceConfiguration.inspect`). */
export interface SettingLayers {
  defaultValue?: unknown;
  globalValue?: unknown;
  workspaceValue?: unknown;
}

/** VS Code's settings, behind what the Guild Hall needs, so it can be tested without VS Code. */
export interface GuildSettingsDeps {
  /** `contributes.configuration.properties` from the manifest, keys with the `ibitsa.` prefix. */
  schema: Record<string, SettingSchema>;
  inspect(key: SettingKey): SettingLayers | undefined;
  update(change: {
    key: SettingKey;
    value: SettingValue | undefined;
    layer: 'user' | 'workspace';
  }): PromiseLike<void>;
}

/** The part of the extension's own `package.json` the Guild Hall reads. */
export interface ExtensionManifest {
  contributes: { configuration: { properties: Record<string, SettingSchema> } };
}
