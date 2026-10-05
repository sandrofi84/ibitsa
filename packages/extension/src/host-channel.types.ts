import type { HostEvent } from '@ibitsa/protocol';
import type { Credentials } from './credentials.types';
import type { KeyValidator } from './key-validator.types';

/** What the host channel needs from VS Code, so it can be tested without it. */
export interface HostChannelDeps {
  credentials(): Promise<Credentials>;
  /** In development the SDK may use the developer's own login, so a quest can start without a key. */
  development: boolean;
  storeApiKey(key: string): PromiseLike<void>;
  validateKey(): KeyValidator;
  openApiKeyPage(): void;
  openWorktree(): void;
  post(event: HostEvent): void;
}
