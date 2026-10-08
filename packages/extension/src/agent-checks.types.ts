import type { AgentProbe } from '@ibitsa/agent-acp';
import type { AgentCheck, AgentDefinition } from '@ibitsa/protocol';

/** What the party check needs, so it can be tested without VS Code or a real agent. */
export interface AgentChecksDeps {
  /** `ibitsa.agents` over the presets, read each time (§11.5). */
  agents: () => AgentDefinition[];
  /** Checks an agent the way heroes would start it (`HeroAgents.acpAdapter`); undefined if none. */
  checker: (id: string) => { check(request: { cwd: string }): Promise<AgentProbe> } | undefined;
  /**
   * Where the throwaway session's fresh folder goes (#200): the system's temp folder by default,
   * never the workspace, which the sandbox would let the agent write.
   */
  tmp?: () => string;
  /** The heroes' environment, where the agent's command is looked for on PATH. */
  env: () => Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /** Injectable for tests; defaults to the file system. */
  isFile?: (path: string) => boolean;
  now?: () => number;
}

/** A terminal to open for Sign in (#199): its title, the command line typed into it, and its env. */
export interface SignInTerminal {
  name: string;
  command: string;
  env: Record<string, string>;
}

/** One agent's last check, as the extension keeps it: what the webview saw, and how to sign in. */
export interface KeptCheck {
  /** The agent's entry when it was checked: a changed entry is checked again. */
  entry: string;
  at: number;
  check: Promise<AgentCheck>;
  /** The agent's own terminal sign-in, once the check found one. */
  terminal: { args: string[]; env: Record<string, string> } | null;
}
