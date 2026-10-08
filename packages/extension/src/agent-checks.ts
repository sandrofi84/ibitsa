import { mkdtempSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentProbe } from '@ibitsa/agent-acp';
import type { AgentCheck, AgentCheckResult, AgentDefinition } from '@ibitsa/protocol';
import type { AgentChecksDeps, KeptCheck, SignInTerminal } from './agent-checks.types';
import { findCommand } from './hero-agents';

/** How long a party check holds before the agent is started again (§11.5): a few minutes. */
export const CHECK_HOLDS_MS = 5 * 60_000;

/**
 * The party check (§11.5, #199): before heroes set out on an ACP agent, start it once, ask it to
 * `initialize` and for a throwaway session in a fresh temp folder, and stop it. No prompt is sent, so
 * nothing is spent. A check holds a few minutes for the same entry; checks of one agent at the same
 * time share one start.
 */
export class AgentChecks {
  private readonly kept = new Map<string, KeptCheck>();

  constructor(private readonly deps: AgentChecksDeps) {}

  /** One agent's check: the one kept from the last few minutes unless `force`, else a new one. */
  check({ agent: id, force = false }: { agent: string; force?: boolean }): Promise<AgentCheck> {
    const agent = this.deps.agents().find((a) => a.id === id);
    if (!agent) {
      return Promise.resolve(
        checked({
          id,
          name: id,
          result: { kind: 'failed', message: `There's no agent "${id}" in ibitsa.agents.` },
        }),
      );
    }
    const report = (result: AgentCheckResult) => checked({ id, name: agent.name, agent, result });
    if (agent.refused) return Promise.resolve(report({ kind: 'failed', message: agent.refused }));
    const platform = this.deps.platform ?? process.platform;
    const found = findCommand({
      command: agent.command,
      env: this.deps.env(),
      platform,
      ...(this.deps.isFile ? { isFile: this.deps.isFile } : {}),
    });
    if (found === null) {
      this.kept.delete(id);
      return Promise.resolve(report({ kind: 'notInstalled', command: agent.command }));
    }
    const entry = JSON.stringify(agent);
    const now = this.now();
    const held = this.kept.get(id);
    if (!force && held?.entry === entry && now - held.at < CHECK_HOLDS_MS) return held.check;
    const keep: KeptCheck = {
      entry,
      at: now,
      terminal: null,
      check: this.start({
        agent,
        report,
        found: (terminal) => {
          keep.terminal = terminal;
        },
        // A failure isn't kept: the next look starts the agent again.
        failed: () => {
          if (this.kept.get(id) === keep) this.kept.delete(id);
        },
      }),
    };
    this.kept.set(id, keep);
    return keep.check;
  }

  /**
   * What Sign in runs in a terminal (#199): the agent's own terminal sign-in when its last check found
   * one, else its `signIn` command; null when there's neither. The next check starts afresh.
   */
  signIn(id: string): SignInTerminal | null {
    const agent = this.deps.agents().find((a) => a.id === id);
    if (!agent || agent.refused) return null;
    const terminal = this.kept.get(id)?.terminal ?? null;
    this.kept.delete(id);
    const platform = this.deps.platform ?? process.platform;
    const name = `Sign in to ${agent.name}`;
    if (terminal) {
      return {
        name,
        command: commandLine({
          parts: [agent.command, ...agent.args, ...terminal.args],
          platform,
        }),
        env: { ...agent.env, ...terminal.env },
      };
    }
    return agent.signIn ? { name, command: agent.signIn, env: agent.env } : null;
  }

  /**
   * Runs a check in a fresh, empty temp folder (#200), not the workspace: the sandbox lets an agent
   * write where it starts, and a check has no business there. The folder goes afterwards; on Windows
   * it stays busy until the stopped agent has gone, so its removal retries, without holding the check.
   */
  private async inThrowawayFolder(
    check: (cwd: string) => Promise<AgentProbe>,
  ): Promise<AgentProbe> {
    const cwd = realpathSync(mkdtempSync(join(this.deps.tmp?.() ?? tmpdir(), 'ibitsa-check-')));
    try {
      return await check(cwd);
    } finally {
      void rm(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }).catch(() => {
        // Left in temp, where the system clears it.
      });
    }
  }

  private async start({
    agent,
    report,
    found,
    failed,
  }: {
    agent: AgentDefinition;
    report: (result: AgentCheckResult) => AgentCheck;
    found: (terminal: KeptCheck['terminal']) => void;
    failed: () => void;
  }): Promise<AgentCheck> {
    const checker = this.deps.checker(agent.id);
    // Always awaited, so the check is kept before it can report.
    const probe: AgentProbe = await (checker
      ? this.inThrowawayFolder((cwd) => checker.check({ cwd }))
      : Promise.resolve({ kind: 'failed', message: "Heroes can't start on it." }));
    if (probe.kind === 'ready') return report(probe);
    if (probe.kind === 'failed') {
      failed();
      return report(probe);
    }
    found(probe.terminal);
    const platform = this.deps.platform ?? process.platform;
    if (probe.terminal) {
      return report({
        kind: 'signIn',
        message: probe.message,
        via: 'agent',
        command: commandLine({
          parts: [agent.command, ...agent.args, ...probe.terminal.args],
          platform,
        }),
      });
    }
    return report({
      kind: 'signIn',
      message: probe.message,
      via: agent.signIn ? 'command' : null,
      command: agent.signIn ?? null,
    });
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

function checked({
  id,
  name,
  agent,
  result,
}: {
  id: string;
  name: string;
  agent?: AgentDefinition;
  result: AgentCheckResult;
}): AgentCheck {
  return { agent: id, name, costReported: agent?.prices !== undefined, result };
}

/**
 * A command line to type into a terminal (#199): each part quoted when it needs it, for a POSIX
 * shell, or for PowerShell on Windows (which runs a quoted program with `&`).
 */
export function commandLine({
  parts,
  platform,
}: {
  parts: readonly string[];
  platform: NodeJS.Platform;
}): string {
  const plain = /^[\w@%+=:,./~-]+$/;
  if (platform === 'win32') {
    const quoted = parts.map((p) => (plain.test(p) ? p : `"${p.replace(/"/g, '`"')}"`));
    return quoted[0]?.startsWith('"') ? `& ${quoted.join(' ')}` : quoted.join(' ');
  }
  return parts.map((p) => (plain.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)).join(' ');
}
