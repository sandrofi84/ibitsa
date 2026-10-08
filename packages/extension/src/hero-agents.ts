import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import {
  AcpAdapter,
  type AgentProcess,
  type AgentSpec,
  type SpawnRequest,
  spawnAgent,
} from '@ibitsa/agent-acp';
import type { AgentDefinition, AgentView } from '@ibitsa/protocol';
import type { AgentAdapter } from '@ibitsa/runtime';
import type { CommandLookup, HeroAgentsDeps } from './hero-agents.types';

/**
 * The ACP agents heroes run on (§11.5, #198): one adapter per agent in `ibitsa.agents`, made when a
 * class first needs it and remade when its entry changes. The Claude adapter is the runtime's own.
 */
export class HeroAgents {
  private readonly adapters = new Map<string, { entry: string; adapter: AcpAdapter }>();

  constructor(private readonly deps: HeroAgentsDeps) {}

  /** The adapter for an agent id, why it can't be used, or undefined when there's no such agent. */
  adapterFor(id: string): AgentAdapter | { error: string } | undefined {
    const agent = this.deps.agents().find((a) => a.id === id);
    if (!agent) return undefined;
    if (agent.refused) return { error: agent.refused };
    const entry = JSON.stringify(agent);
    const known = this.adapters.get(id);
    if (known?.entry === entry) return known.adapter;
    const spec: AgentSpec = {
      command: expandHome({ path: agent.command, home: homedir() }),
      args: agent.args,
      env: agent.env,
      ...(agent.prices ? { prices: agent.prices } : {}),
    };
    const adapter = new AcpAdapter({
      agent: spec,
      env: this.deps.env,
      ...((this.deps.platform ?? process.platform) === 'win32' ? { spawn: spawnOnWindows } : {}),
    });
    this.adapters.set(id, { entry, adapter });
    return adapter;
  }

  /** The agents for the Armory: no environment (it may hold keys), and whether each is installed. */
  views(): AgentView[] {
    const env = this.deps.env();
    const platform = this.deps.platform ?? process.platform;
    return this.deps.agents().map((agent) => ({
      id: agent.id,
      name: agent.name,
      command: agent.command,
      args: agent.args,
      preset: agent.preset,
      found: findCommand({ command: agent.command, env, platform }) !== null,
      ...(agent.refused ? { refused: agent.refused } : {}),
    }));
  }
}

/**
 * Where a command runs from, as a shell would find it: its own path when it has one (`~` is the home
 * folder), else the first match on PATH, with PATHEXT's extensions on Windows. Null when missing.
 */
export function findCommand({
  command,
  env,
  platform = process.platform,
  isFile = fileExists,
  home = homedir(),
}: CommandLookup): string | null {
  const windows = platform === 'win32';
  const path = windows ? win32 : posix;
  const read = (name: string) =>
    Object.entries(env).find(([key]) => (windows ? key.toUpperCase() === name : key === name))?.[1];
  const extensions = windows
    ? ['', ...(read('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : [''];
  const candidates = (base: string) => extensions.map((ext) => `${base}${ext}`);
  const expanded = expandHome({ path: command, home });
  if (expanded.includes('/') || (windows && expanded.includes('\\'))) {
    return candidates(expanded).find(isFile) ?? null;
  }
  for (const dir of (read('PATH') ?? '').split(path.delimiter).filter(Boolean)) {
    const found = candidates(path.join(dir, expanded)).find(isFile);
    if (found) return found;
  }
  return null;
}

/**
 * Starts an agent on Windows (#198). npm installs agents as `.cmd` shims, which Node only starts
 * through cmd.exe, so those go through a shell with their arguments quoted; anything else starts as
 * usual.
 */
export function spawnOnWindows(request: SpawnRequest): AgentProcess {
  const path = findCommand({ command: request.command, env: request.env, platform: 'win32' });
  if (!path || !/\.(cmd|bat)$/i.test(path)) {
    return spawnAgent({ ...request, command: path ?? request.command });
  }
  return spawn([path, ...request.args].map(quoteForCmd).join(' '), {
    cwd: request.cwd,
    env: request.env,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/** One argument for cmd.exe: quoted when it has spaces or cmd's special characters. */
function quoteForCmd(arg: string): string {
  return /[\s"&|<>^()%!]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

function expandHome({ path, home }: { path: string; home: string }): string {
  return path === '~' || path.startsWith('~/') ? `${home}${path.slice(1)}` : path;
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
