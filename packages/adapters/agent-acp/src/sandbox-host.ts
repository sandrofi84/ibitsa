import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import * as v from 'valibot';
import { ParentMessageSchema, type SandboxPlan, SandboxPlanSchema } from './sandbox.schema.ts';
import { SANDBOX_PLAN_ENV } from './sandbox.ts';
import type { SandboxHostIo } from './sandbox-host.types';

/** Where the sandbox runtime points the agent's TMPDIR; it has to exist before the agent starts. */
const SANDBOX_TMP = '/tmp/claude';

/**
 * One hero's sandbox host (§11.5, #200), in its own process: sets up Anthropic's sandbox runtime for
 * the plan in its environment, starts the agent inside it on the host's own stdio, and relays the
 * runtime's asks for new domains to Ibitsa over IPC. Ends with the agent's exit code, or 2 without a
 * plan and 3 when the sandbox can't start, saying why on stderr: never a silent unsandboxed run.
 */
export async function runSandboxHost(io: SandboxHostIo): Promise<number> {
  const plan = readPlan(io.env[SANDBOX_PLAN_ENV]);
  if (!plan) {
    io.error('The sandbox host was started without a plan.');
    return 2;
  }
  // ESM-only, so it stays out of the CommonJS bundle and loads here (as the Claude SDK does, §13).
  const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
  const missing = SandboxManager.checkDependencies().errors;
  if (missing.length > 0) {
    io.error(dependencyProblem(missing));
    return 3;
  }
  const asks = new Map<number, (allow: boolean) => void>();
  let nextAsk = 0;
  io.onMessage((raw) => {
    const message = v.safeParse(ParentMessageSchema, raw);
    if (!message.success) return;
    asks.get(message.output.id)?.(message.output.allow);
    asks.delete(message.output.id);
  });
  let agent: ChildProcess;
  try {
    mkdirSync(SANDBOX_TMP, { recursive: true });
    await SandboxManager.initialize(
      plan.config,
      ({ host, port }) =>
        new Promise<boolean>((resolve) => {
          const id = ++nextAsk;
          asks.set(id, resolve);
          io.send({ type: 'ask', id, host, port: port ?? null });
        }),
    );
    const wrapped = await SandboxManager.wrapWithSandbox(shellCommand(plan));
    const env = { ...io.env };
    for (const name of plan.unset) delete env[name];
    agent = spawn(wrapped, {
      cwd: plan.cwd,
      env,
      shell: true,
      stdio: io.stdio ?? 'inherit',
      // Its own process group, so stopping the hero stops everything the agent started.
      detached: true,
    });
  } catch (error) {
    await SandboxManager.reset().catch(() => {});
    io.error(`The hero sandbox could not start: ${error instanceof Error ? error.message : error}`);
    return 3;
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      for (const answer of asks.values()) answer(false);
      asks.clear();
      void SandboxManager.reset()
        .catch(() => {})
        .then(() => resolve(code));
    };
    io.onStop(() => stopGroup(agent));
    agent.once('error', (error) => {
      io.error(`Couldn't start the agent (${plan.command}): ${error.message}`);
      finish(3);
    });
    agent.once('exit', (code, signal) => finish(code ?? (signal ? 1 : 0)));
  });
}

/** The plan from the host's environment, or null when there is none or it doesn't check out. */
function readPlan(raw: string | undefined): SandboxPlan | null {
  if (!raw) return null;
  try {
    const parsed = v.safeParse(SandboxPlanSchema, JSON.parse(raw));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}

/** The agent's command line for the sandbox's shell, every word quoted as POSIX shells read it. */
export function shellCommand({ command, args }: { command: string; args: string[] }): string {
  return [command, ...args]
    .map((word) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`))
    .join(' ');
}

/** What a hero's error says when the sandbox's tools are missing (Linux: bubblewrap, socat, ripgrep). */
export function dependencyProblem(missing: string[]): string {
  return `The hero sandbox can’t start: ${missing.join('; ')}. Install bubblewrap, socat and ripgrep with your package manager, e.g. \`sudo apt-get install bubblewrap socat ripgrep\`, then resume.`;
}

function stopGroup(agent: ChildProcess): void {
  if (agent.pid === undefined) return;
  try {
    process.kill(-agent.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}
