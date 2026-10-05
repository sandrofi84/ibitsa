import type { CoreMessage, HostEvent } from '@ibitsa/protocol';
import type { KeyValidator } from './key-validator.types';
import type { DependencyFactory, Notifier } from './runtime-host.types';

/** Hooks for integration tests, exported only when the extension runs with IBITSA_TESTING=1. */
export interface TestingApi {
  /** Replace the agent adapter and game master; call before the runtime first starts. */
  useDependencies(factory: DependencyFactory): void;
  useNotifier(notifier: Notifier): void;
  /** Replace the Anthropic key check, so tests never call Anthropic. */
  useKeyValidator(validator: KeyValidator): void;
  /** Messages the runtime sent to the game panel. */
  posted(): CoreMessage[];
  /** Host-channel events sent to the game panel. */
  hostEvents(): HostEvent[];
  /** Workspace storage, where the campaign logs live. */
  storageDir(): string | undefined;
  /** Deletes the stored key, so a test leaves nothing in the OS keychain. */
  forgetApiKey(): PromiseLike<void>;
  /** Send a message as if the game panel sent it (host-channel messages go to the host channel). */
  receive(raw: unknown): void;
  /** Dispose the runtime and start a new one from the log, as a window reload would. */
  restartRuntime(): Promise<void>;
}

export interface IbitsaApi {
  testing?: TestingApi;
}
