import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import * as v from 'valibot';
import type { AgentProcess } from './acp-adapter.types';
import { HostMessageSchema, type ParentMessage, type SandboxPlan } from './sandbox.schema.ts';
import type { AgentSandboxOptions, SandboxConfigInput, SandboxSpawn } from './sandbox.types';

/** The environment variable that hands a sandbox host its plan. */
export const SANDBOX_PLAN_ENV = 'IBITSA_SANDBOX_PLAN';

/** Credentials no agent reads under the sandbox, on top of the runtime's own protections. */
const DENIED_READS = ['.ssh', '.aws', '.gnupg'];
/** Linux: daemons whose sockets would let a process out (sockets can't be allowed one by one there). */
const DENIED_SOCKETS = ['/var/run/docker.sock', '/run/docker.sock'];

/** Where Ibitsa's sandbox runs agents (§11.5): macOS (Seatbelt) and Linux (bubblewrap), not Windows. */
export function sandboxSupported(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'linux';
}

/**
 * The sandbox runtime's config for one hero's agent (§11.5, #200). Writes: the worktree, the main
 * repository's `.git` (the runtime itself refuses its `hooks/` and `config`), temp and the agent's
 * state folders. Reads: everything but credentials. Network: the agent's domains; any other asks.
 * The MCP tool bridge's socket stays reachable: by path on macOS; on Linux, where sockets can't be
 * allowed one by one, by allowing sockets and hiding the daemons' that would let a process out.
 */
export function sandboxConfig(input: SandboxConfigInput): SandboxRuntimeConfig {
  const { cwd, profile, platform, home, tmp, sharedGit, bridgeSocket } = input;
  const linux = platform === 'linux';
  const sockets = linux
    ? { allowAllUnixSockets: true }
    : bridgeSocket
      ? { allowUnixSockets: [bridgeSocket] }
      : {};
  return {
    network: { allowedDomains: [...profile.domains], deniedDomains: [], ...sockets },
    filesystem: {
      denyRead: [...DENIED_READS.map((d) => join(home, d)), ...(linux ? DENIED_SOCKETS : [])],
      allowWrite: [cwd, ...(sharedGit ? [sharedGit] : []), tmp, ...profile.stateFolders],
      denyWrite: [],
    },
    ...(profile.weakerNetworkIsolation && !linux ? { enableWeakerNetworkIsolation: true } : {}),
  };
}

/**
 * The main repository's `.git` for a worktree (its `.git` file says `gitdir: <repo>/.git/worktrees/<name>`),
 * which git writes objects and refs to; null for a plain repository or no repository, where the
 * worktree's own `.git` is already inside the worktree.
 */
export function sharedGitDir(cwd: string): string | null {
  let pointer: string;
  try {
    pointer = readFileSync(join(cwd, '.git'), 'utf8');
  } catch {
    return null;
  }
  const match = /^gitdir:\s*(.+)$/m.exec(pointer);
  if (!match?.[1]) return null;
  const gitdir = match[1].trim();
  const absolute = isAbsolute(gitdir) ? gitdir : resolve(cwd, gitdir);
  return dirname(absolute).endsWith('worktrees') ? dirname(dirname(absolute)) : null;
}

/**
 * Starts ACP agents under Anthropic's sandbox runtime (§11.5, #200), one sandbox host process per
 * hero. The runtime keeps one global config and an ask callback that can't tell who asked, so each
 * hero's agent gets its own host: its own worktree in the config, and its asks for new domains come
 * back here over IPC, to that hero's session. The agent inherits the host's stdio and speaks ACP
 * straight to the adapter.
 */
export class AgentSandbox {
  private readonly options: AgentSandboxOptions;

  constructor(options: AgentSandboxOptions) {
    this.options = options;
  }

  spawn({ request, profile }: SandboxSpawn): AgentProcess {
    const node = this.options.node ?? {
      command: process.execPath,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
    const nodeEnv = node.env ?? {};
    const plan: SandboxPlan = {
      command: request.command,
      args: request.args,
      cwd: request.cwd,
      unset: [
        SANDBOX_PLAN_ENV,
        ...Object.keys(nodeEnv).filter((name) => request.env[name] === undefined),
      ],
      config: sandboxConfig({
        cwd: request.cwd,
        profile,
        platform: this.options.platform ?? process.platform,
        home: this.options.home ?? homedir(),
        tmp: this.options.tmp ?? tmpdir(),
        sharedGit: sharedGitDir(request.cwd),
        ...(this.options.bridgeSocket ? { bridgeSocket: this.options.bridgeSocket } : {}),
      }),
    };
    const host = spawn(node.command, [this.options.script], {
      cwd: request.cwd,
      env: { ...request.env, ...nodeEnv, [SANDBOX_PLAN_ENV]: JSON.stringify(plan) },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    host.on('message', (raw) => {
      const parsed = v.safeParse(HostMessageSchema, raw);
      if (!parsed.success) return;
      const { id, host: name, port } = parsed.output;
      const asked = request.ask ? request.ask({ host: name, port }) : Promise.resolve(false);
      void asked
        .catch(() => false)
        .then((allow) => {
          const answer: ParentMessage = { type: 'answer', id, allow };
          // A channel closing meanwhile is the host going away, which its exit reports.
          if (host.connected) host.send(answer, () => {});
        });
    });
    return host;
  }
}
