import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SANDBOX_PLAN_ENV, sandboxConfig, sandboxSupported } from './sandbox';
import type { HostMessage, SandboxPlan } from './sandbox.schema';
import { dependencyProblem, runSandboxHost, shellCommand } from './sandbox-host';

/**
 * Whether this machine can run the sandbox: macOS, or Linux with bubblewrap, socat and ripgrep. CI
 * sets IBITSA_REQUIRE_SANDBOX so a missing tool fails there instead of skipping.
 */
function canSandbox(): boolean {
  if (!sandboxSupported(process.platform)) return false;
  if (process.platform === 'darwin' || process.env.IBITSA_REQUIRE_SANDBOX === '1') return true;
  return ['bwrap', 'socat', 'rg'].every((tool) => spawnSync('which', [tool]).status === 0);
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function folder(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ibitsa-sandbox-host-')));
  dirs.push(dir);
  return dir;
}

/** Runs the host in this process with a plan; `answer` decides each ask for a new domain. */
function host({
  plan,
  answer,
}: {
  plan: SandboxPlan | null;
  answer?: (ask: HostMessage) => boolean;
}) {
  const asked: HostMessage[] = [];
  const errors: string[] = [];
  let reply: (message: unknown) => void = () => {};
  const stops: (() => void)[] = [];
  const done = runSandboxHost({
    env: { ...process.env, ...(plan ? { [SANDBOX_PLAN_ENV]: JSON.stringify(plan) } : {}) },
    stdio: 'ignore',
    send: (message) => {
      asked.push(message);
      // Something else first: the host ignores what isn't an answer.
      reply({ type: 'nonsense' });
      reply({ type: 'answer', id: message.id, allow: answer?.(message) ?? false });
    },
    onMessage: (listener) => {
      reply = listener;
    },
    onStop: (listener) => stops.push(listener),
    error: (text) => errors.push(text),
  });
  return {
    done,
    asked,
    errors,
    stop: () => {
      for (const s of stops) s();
    },
  };
}

/** A plan for one hero: its worktree is `cwd`; `tmp` stands in for temp. */
function planFor({ cwd, run, tmp }: { cwd: string; run: string; tmp: string }): SandboxPlan {
  return {
    command: 'sh',
    args: ['-c', run],
    cwd,
    unset: [SANDBOX_PLAN_ENV],
    config: sandboxConfig({
      cwd,
      profile: { stateFolders: [], domains: [] },
      platform: process.platform,
      home: homedir(),
      tmp,
      sharedGit: null,
    }),
  };
}

describe('runSandboxHost (§11.5, #200)', () => {
  it('needs a plan, and says so', async () => {
    const run = host({ plan: null });
    expect(await run.done).toBe(2);
    expect(run.errors).toEqual(['The sandbox host was started without a plan.']);
  });

  it('refuses a plan that does not check out', async () => {
    const errors: string[] = [];
    const code = await runSandboxHost({
      env: { [SANDBOX_PLAN_ENV]: '{"command": 1}' },
      send: () => {},
      onMessage: () => {},
      onStop: () => {},
      error: (text) => errors.push(text),
    });
    expect(code).toBe(2);
    expect(errors[0]).toContain('without a plan');
  });

  it.skipIf(!canSandbox())(
    'writes only in the worktree, and asks before a new domain',
    async () => {
      const cwd = folder();
      const outside = folder();
      const run = host({
        plan: planFor({
          cwd,
          tmp: join(cwd, '.tmp'),
          run: [
            'echo in > in.txt',
            `echo out > ${outside}/out.txt 2>/dev/null; echo $? > write-outside.txt`,
            "curl -s -o /dev/null -w '%{http_code}' http://example.test/ > status.txt",
          ].join('; '),
        }),
        answer: () => false,
      });
      expect(await run.done).toBe(0);
      expect(readFileSync(join(cwd, 'in.txt'), 'utf8').trim()).toBe('in');
      expect(existsSync(join(outside, 'out.txt'))).toBe(false);
      expect(readFileSync(join(cwd, 'write-outside.txt'), 'utf8').trim()).not.toBe('0');
      expect(run.asked).toEqual([{ type: 'ask', id: 1, host: 'example.test', port: 80 }]);
      expect(readFileSync(join(cwd, 'status.txt'), 'utf8').trim()).toBe('403');
    },
    30_000,
  );

  it.skipIf(!canSandbox())(
    'stops the agent when the hero stops',
    async () => {
      const cwd = folder();
      const run = host({ plan: planFor({ cwd, tmp: join(cwd, '.tmp'), run: 'sleep 30' }) });
      setTimeout(run.stop, 1_000);
      const started = Date.now();
      expect(await run.done).not.toBe(0);
      expect(Date.now() - started).toBeLessThan(15_000);
    },
    30_000,
  );

  it.skipIf(!canSandbox())(
    'says when the agent cannot start',
    async () => {
      const cwd = folder();
      const plan = {
        ...planFor({ cwd, tmp: join(cwd, '.tmp'), run: '' }),
        command: 'no-such-agent-x',
      };
      const run = host({ plan: { ...plan, args: [] } });
      expect(await run.done).not.toBe(0);
    },
    30_000,
  );
});

describe('the host’s helpers', () => {
  it('quotes the command line for a POSIX shell', () => {
    expect(shellCommand({ command: 'codex-acp', args: [] })).toBe('codex-acp');
    expect(shellCommand({ command: '/opt/my agent/run', args: ['--acp', "it's"] })).toBe(
      `'/opt/my agent/run' --acp 'it'\\''s'`,
    );
  });

  it('names what is missing and how to install it', () => {
    expect(dependencyProblem(['bubblewrap (bwrap) not installed', 'socat not installed'])).toBe(
      'The hero sandbox can’t start: bubblewrap (bwrap) not installed; socat not installed. Install bubblewrap, socat and ripgrep with your package manager, e.g. `sudo apt-get install bubblewrap socat ripgrep`, then resume.',
    );
  });

  it('runs only where Seatbelt or bubblewrap exist', () => {
    expect(sandboxSupported('darwin')).toBe(true);
    expect(sandboxSupported('linux')).toBe(true);
    expect(sandboxSupported('win32')).toBe(false);
  });
});

describe('runSandboxHost when the sandbox itself fails', () => {
  afterEach(() => {
    vi.doUnmock('@anthropic-ai/sandbox-runtime');
    vi.resetModules();
  });

  /** The host with a stand-in sandbox runtime, and a plan it never gets to run. */
  async function failing(manager: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock('@anthropic-ai/sandbox-runtime', () => ({ SandboxManager: manager }));
    const { runSandboxHost: run } = await import('./sandbox-host');
    const errors: string[] = [];
    const plan = planFor({ cwd: folder(), tmp: tmpdir(), run: 'true' });
    const code = await run({
      env: { [SANDBOX_PLAN_ENV]: JSON.stringify(plan) },
      send: () => {},
      onMessage: () => {},
      onStop: () => {},
      error: (text) => errors.push(text),
    });
    return { code, errors };
  }

  it('refuses to start the agent without its tools: never a silent unsandboxed run', async () => {
    const initialize = vi.fn();
    const { code, errors } = await failing({
      checkDependencies: () => ({ errors: ['socat not installed'], warnings: [] }),
      initialize,
    });
    expect(code).toBe(3);
    expect(errors).toEqual([dependencyProblem(['socat not installed'])]);
    expect(initialize).not.toHaveBeenCalled();
  });

  it('says why when the sandbox cannot be set up, and cleans up', async () => {
    const reset = vi.fn(() => Promise.resolve());
    const { code, errors } = await failing({
      checkDependencies: () => ({ errors: [], warnings: [] }),
      initialize: () => Promise.reject(new Error('user namespaces are restricted')),
      reset,
    });
    expect(code).toBe(3);
    expect(errors).toEqual(['The hero sandbox could not start: user namespaces are restricted']);
    expect(reset).toHaveBeenCalled();
  });
});
