import type { CoreMessage } from '@ibitsa/protocol';
import type { DependencyFactory, Notifier } from './runtime-host.types';

/** Hooks for integration tests, exported only when the extension runs with IBITSA_TESTING=1. */
export interface TestingApi {
  /** Replace the agent adapter and game master; call before the runtime first starts. */
  useDependencies(factory: DependencyFactory): void;
  useNotifier(notifier: Notifier): void;
  /** Messages the runtime sent to the game panel. */
  posted(): CoreMessage[];
  /** Send a message to the runtime as if the game panel sent it. */
  receive(raw: unknown): void;
  /** Dispose the runtime and start a new one from the log, as a window reload would. */
  restartRuntime(): Promise<void>;
}

export interface IbitsaApi {
  testing?: TestingApi;
}
