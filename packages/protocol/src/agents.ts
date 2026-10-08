import * as v from 'valibot';
import { AgentIdSchema, AgentSettingSchema } from './agents.schema';
import type { AgentDefinition } from './agents.types';

/** The native Claude adapter's id: a class without an agent runs on it (§5.2). */
export const CLAUDE_AGENT = 'claude';

/**
 * The agents Ibitsa knows how to start (§11.5). Ibitsa installs none of them. Only Codex has a
 * sandbox profile so far, measured in the #195 spike; the others run unsandboxed until theirs is.
 */
export const AGENT_PRESETS: readonly AgentDefinition[] = [
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex-acp',
    args: [],
    env: {},
    stateFolders: ['~/.codex'],
    domains: ['chatgpt.com', '*.oaiusercontent.com'],
    weakerNetworkIsolation: true,
    sandboxedMode: 'agent-full-access',
    preset: true,
  },
  {
    id: 'copilot',
    name: 'Copilot CLI',
    command: 'copilot',
    args: ['--acp'],
    env: {},
    stateFolders: [],
    domains: [],
    preset: true,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    env: {},
    stateFolders: [],
    domains: [],
    preset: true,
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    command: 'agy_acp_server.par',
    args: [],
    env: {},
    stateFolders: [],
    domains: [],
    preset: true,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: ['--acp'],
    env: {},
    stateFolders: [],
    domains: [],
    preset: true,
  },
];

/** An agent's name for the class lists: a preset's, else its id as a word. */
export function agentName(id: string): string {
  if (id === CLAUDE_AGENT) return 'Claude';
  return AGENT_PRESETS.find((a) => a.id === id)?.name ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Claude runs only through the native adapter (§11.6: claude.ai sign-in needs Anthropic's approval). */
const CLAUDE_OVER_ACP = /claude-(agent|code)-acp/;

/** Why heroes can't run on this agent, or undefined when they can. */
function refusal(agent: AgentDefinition): string | undefined {
  if (agent.id === CLAUDE_AGENT) return 'The id "claude" is the native Claude adapter.';
  if ([agent.command, ...agent.args].some((part) => CLAUDE_OVER_ACP.test(part))) {
    return "Claude runs only through Ibitsa's own Claude adapter, not over ACP.";
  }
  return undefined;
}

/**
 * The agents in play (§11.5, #198): the presets with `ibitsa.agents` laid over them by id, field by
 * field, then the agents it adds. An entry that doesn't check out is dropped alone; an added agent
 * needs a command. An agent that runs Claude over ACP stays in the list, refused, so the Armory can
 * say why.
 */
export function resolveAgents(setting: unknown): AgentDefinition[] {
  const agents = AGENT_PRESETS.map((a) => ({ ...a, args: [...a.args] }));
  const entries = setting && typeof setting === 'object' ? Object.entries(setting) : [];
  for (const [id, value] of entries) {
    const parsed = v.safeParse(AgentSettingSchema, value);
    if (!parsed.success || !v.is(AgentIdSchema, id)) continue;
    const s = parsed.output;
    const known = agents.find((a) => a.id === id);
    const command = s.command ?? known?.command;
    if (!command) continue;
    const prices = s.prices ?? known?.prices;
    const merged: AgentDefinition = {
      id,
      name: s.name ?? known?.name ?? id.charAt(0).toUpperCase() + id.slice(1),
      command,
      args: s.args ?? known?.args ?? [],
      env: { ...known?.env, ...s.env },
      stateFolders: s.stateFolders ?? known?.stateFolders ?? [],
      domains: s.domains ?? known?.domains ?? [],
      ...(known?.weakerNetworkIsolation ? { weakerNetworkIsolation: true } : {}),
      ...(known?.sandboxedMode ? { sandboxedMode: known.sandboxedMode } : {}),
      ...(prices ? { prices } : {}),
      preset: known?.preset ?? false,
    };
    const refused = refusal(merged);
    if (refused) merged.refused = refused;
    if (known) agents.splice(agents.indexOf(known), 1, merged);
    else agents.push(merged);
  }
  return agents;
}
