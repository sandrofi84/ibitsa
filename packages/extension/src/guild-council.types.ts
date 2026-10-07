import type { SettingLayers } from './guild-settings.types';

/** Where a change is written: your settings, or the project's (§8.1). */
export type Layer = 'user' | 'workspace';

/** The two settings the Roster edits (#181), without the `ibitsa.` prefix. */
export type CouncilSettingKey = 'council.disabled' | 'councillors';

/** VS Code's settings and the file system, behind what the Roster needs, so it's testable without either. */
export interface GuildCouncilDeps {
  inspect(key: CouncilSettingKey): SettingLayers | undefined;
  update(change: {
    key: CouncilSettingKey;
    value: unknown;
    layer: 'user' | 'workspace';
  }): PromiseLike<void>;
  files: {
    exists(path: string): boolean;
    read(path: string): string;
    /** Creates the folders it needs. */
    write(file: { path: string; text: string }): void;
  };
  /** Where skills live: the user's home, the workspace (none without a folder), Ibitsa's plugin. */
  roots: { home: string; workspace: string | undefined; plugin: string };
  /** Opens a file in the editor. */
  open(path: string): void;
}
