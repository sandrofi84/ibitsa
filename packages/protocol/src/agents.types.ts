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
