/**
 * An ACP agent heroes can run on (§11.5, #198): a preset, a preset with `ibitsa.agents` over it, or an
 * agent the setting adds. Stays in the extension and the runtime: `env` may hold keys, so front ends
 * get an `AgentView` instead.
 */
export interface AgentDefinition {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Folders the agent keeps its state in; the sandbox (#200) lets it write there. */
  stateFolders: string[];
  /** Domains it reaches without asking under the sandbox (#200). */
  domains: string[];
  /** It needs the sandbox's `enableWeakerNetworkIsolation` on macOS (native TLS; Codex, #195). */
  weakerNetworkIsolation?: boolean;
  /** The agent's own mode to run in when Ibitsa's sandbox is the boundary (Codex, #195). */
  sandboxedMode?: string;
  prices?: { inputPerMillion: number; outputPerMillion: number };
  /**
   * The command that signs you in to it by hand (#199), e.g. `codex login`: the party check's Sign in
   * runs it in a terminal when the agent offers no terminal sign-in of its own.
   */
  signIn?: string;
  /** One of the presets that ship with Ibitsa. */
  preset: boolean;
  /** Why heroes can't run on it, e.g. it runs Claude through ACP (§11.6); absent when they can. */
  refused?: string;
}

/** An agent as the Armory shows it (#198): no environment, and whether its command was found. */
export interface AgentView {
  id: string;
  name: string;
  command: string;
  args: string[];
  preset: boolean;
  /** On PATH (or at its path) when the Armory asked; heroes need it installed (§11.5). */
  found: boolean;
  refused?: string;
}

/**
 * The party check of one ACP agent (§11.5, #199): started, asked to `initialize` and for a throwaway
 * session (no prompt, nothing spent), then stopped. The game decides from it whether a class on it
 * can set out.
 */
export interface AgentCheck {
  agent: string;
  name: string;
  /** Its entry has prices, so gold can be estimated and the gold pouch enforced (§7.3). */
  costReported: boolean;
  result: AgentCheckResult;
}

export type AgentCheckResult =
  /** It started a session. `models`: the values of its `model` option; null when it offers none. */
  | { kind: 'ready'; models: string[] | null }
  /** Its command isn't on PATH (or at its path). */
  | { kind: 'notInstalled'; command: string }
  /**
   * It answered `auth_required`. `via`: what Sign in runs in a terminal, the agent's own terminal
   * sign-in or its `signIn` command, shown as `command`; null when Ibitsa knows neither.
   */
  | { kind: 'signIn'; message: string; via: 'agent' | 'command' | null; command: string | null }
  /** It couldn't start, didn't answer, or failed otherwise; also an unknown or refused agent. */
  | { kind: 'failed'; message: string };
