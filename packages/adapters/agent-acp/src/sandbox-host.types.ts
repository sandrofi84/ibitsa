import type { StdioOptions } from 'node:child_process';
import type { HostMessage } from './sandbox.schema';

/** The sandbox host's process, as `runSandboxHost` uses it; injectable for tests. */
export interface SandboxHostIo {
  env: Record<string, string | undefined>;
  /** For the agent: the host's own stdio by default, so the agent speaks ACP straight to the runtime. */
  stdio?: StdioOptions;
  send(message: HostMessage): void;
  /** Messages from the runtime, unchecked: the host checks them (answers to its asks). */
  onMessage(listener: (message: unknown) => void): void;
  /** Called when the runtime stops the hero: the host's SIGTERM, or its IPC channel closing. */
  onStop(listener: () => void): void;
  /** Says why the agent can't start (stderr; stdout belongs to ACP). */
  error(text: string): void;
}
