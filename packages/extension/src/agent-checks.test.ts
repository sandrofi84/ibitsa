import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentProbe } from '@ibitsa/agent-acp';
import type { AgentDefinition } from '@ibitsa/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentChecks, CHECK_HOLDS_MS, commandLine } from './agent-checks';
import type { AgentChecksDeps } from './agent-checks.types';
import { HeroAgents } from './hero-agents';

const FAKE_AGENT = fileURLToPath(
  new URL('../../adapters/agent-acp/test/fake-agent.mjs', import.meta.url),
);
vi.setConfig({ testTimeout: 30_000 });
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const codex: AgentDefinition = {
  id: 'codex',
  name: 'Codex',
  command: 'codex-acp',
  args: ['--quiet'],
  env: { CODEX_HOME: '/home/me/.codex' },
  stateFolders: [],
  domains: [],
  signIn: 'codex login',
  preset: true,
};

function setup({
  agents = [codex],
  probes = [],
  installed = true,
}: {
  agents?: AgentDefinition[];
  probes?: AgentProbe[];
  installed?: boolean;
} = {}) {
  let now = 1_000;
  const tmp = mkdtempSync(join(tmpdir(), 'ibitsa-checks-'));
  dirs.push(tmp);
  const check = vi.fn(
    async (_request: { cwd: string }): Promise<AgentProbe> =>
      probes.shift() ?? { kind: 'ready', models: null },
  );
  const deps: AgentChecksDeps = {
    agents: () => agents,
    checker: () => ({ check }),
    tmp: () => tmp,
    env: () => ({ PATH: '/bin' }),
    platform: 'linux',
    isFile: () => installed,
    now: () => now,
  };
  return {
    checks: new AgentChecks(deps),
    check,
    tmp,
    later: (ms: number) => {
      now += ms;
    },
  };
}

describe('the party check (§11.5, #199)', () => {
  it('holds a ready agent a few minutes, sharing one start between checks at the same time', async () => {
    const { checks, check, later } = setup({ probes: [{ kind: 'ready', models: ['gpt-6-sol'] }] });
    const [a, b] = await Promise.all([
      checks.check({ agent: 'codex' }),
      checks.check({ agent: 'codex' }),
    ]);
    expect(a).toEqual({
      agent: 'codex',
      name: 'Codex',
      costReported: false,
      result: { kind: 'ready', models: ['gpt-6-sol'] },
    });
    expect(b).toBe(a);
    expect(check).toHaveBeenCalledTimes(1);
    later(CHECK_HOLDS_MS - 1);
    await checks.check({ agent: 'codex' });
    expect(check).toHaveBeenCalledTimes(1);
    // Asked to check again, or once it's old, the agent starts again.
    await checks.check({ agent: 'codex', force: true });
    later(CHECK_HOLDS_MS);
    await checks.check({ agent: 'codex' });
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('checks again when the agent’s entry changes', async () => {
    const agents = [codex];
    const { checks, check } = setup({ agents });
    await checks.check({ agent: 'codex' });
    agents[0] = { ...codex, args: [] };
    await checks.check({ agent: 'codex' });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("says an agent isn't installed without starting it", async () => {
    const { checks, check } = setup({ installed: false });
    expect((await checks.check({ agent: 'codex' })).result).toEqual({
      kind: 'notInstalled',
      command: 'codex-acp',
    });
    expect(check).not.toHaveBeenCalled();
  });

  it("asks for a sign-in through the agent's own terminal sign-in, then checks afresh", async () => {
    const { checks, check } = setup({
      probes: [
        {
          kind: 'signIn',
          message: 'Authentication required',
          terminal: { args: ['--login', 'chat gpt'], env: { MODE: 'tui' } },
        },
      ],
    });
    expect((await checks.check({ agent: 'codex' })).result).toEqual({
      kind: 'signIn',
      message: 'Authentication required',
      via: 'agent',
      command: "codex-acp --quiet --login 'chat gpt'",
    });
    expect(checks.signIn('codex')).toEqual({
      name: 'Sign in to Codex',
      command: "codex-acp --quiet --login 'chat gpt'",
      env: { CODEX_HOME: '/home/me/.codex', MODE: 'tui' },
    });
    // Signed in, it starts again rather than answer from before.
    expect((await checks.check({ agent: 'codex' })).result).toEqual({
      kind: 'ready',
      models: null,
    });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('falls back to the sign-in command, or to nothing Ibitsa can run', async () => {
    const signIn: AgentProbe = { kind: 'signIn', message: 'Log in', terminal: null };
    const withCommand = setup({ probes: [signIn] });
    expect((await withCommand.checks.check({ agent: 'codex' })).result).toMatchObject({
      via: 'command',
      command: 'codex login',
    });
    expect(withCommand.checks.signIn('codex')).toEqual({
      name: 'Sign in to Codex',
      command: 'codex login',
      env: { CODEX_HOME: '/home/me/.codex' },
    });
    const { signIn: _none, ...bare } = codex;
    const without = setup({ agents: [bare], probes: [signIn] });
    expect((await without.checks.check({ agent: 'codex' })).result).toEqual({
      kind: 'signIn',
      message: 'Log in',
      via: null,
      command: null,
    });
    expect(without.checks.signIn('codex')).toBeNull();
  });

  it("doesn't hold a failure, says why an agent can't be used, and knows when gold is counted", async () => {
    const { checks, check } = setup({ probes: [{ kind: 'failed', message: 'It crashed.' }] });
    expect((await checks.check({ agent: 'codex' })).result).toEqual({
      kind: 'failed',
      message: 'It crashed.',
    });
    await checks.check({ agent: 'codex' });
    expect(check).toHaveBeenCalledTimes(2);

    const refused = setup({ agents: [{ ...codex, refused: 'It runs Claude over ACP.' }] });
    expect((await refused.checks.check({ agent: 'codex' })).result).toEqual({
      kind: 'failed',
      message: 'It runs Claude over ACP.',
    });
    expect(refused.checks.signIn('codex')).toBeNull();
    expect(refused.check).not.toHaveBeenCalled();

    const priced = setup({
      agents: [{ ...codex, prices: { inputPerMillion: 1, outputPerMillion: 4 } }],
    });
    expect((await priced.checks.check({ agent: 'codex' })).costReported).toBe(true);

    const noAdapter = new AgentChecks({
      agents: () => [codex],
      checker: () => undefined,
      env: () => ({ PATH: '/bin' }),
      platform: 'linux',
      isFile: () => true,
    });
    expect((await noAdapter.check({ agent: 'codex' })).result).toEqual({
      kind: 'failed',
      message: "Heroes can't start on it.",
    });
  });

  it('checks a real agent the way heroes start it, through HeroAgents', async () => {
    const fake = (env: Record<string, string>): AgentDefinition => ({
      ...codex,
      command: process.execPath,
      args: [FAKE_AGENT],
      env,
    });
    let agents = [fake({})];
    const heroAgents = new HeroAgents({ agents: () => agents, env: () => process.env });
    const checks = new AgentChecks({
      agents: () => agents,
      checker: (id) => heroAgents.acpAdapter(id),
      env: () => process.env,
    });
    expect((await checks.check({ agent: 'codex' })).result).toEqual({
      kind: 'ready',
      models: null,
    });
    agents = [fake({ FAKE_ACP_AUTH: 'required' })];
    expect((await checks.check({ agent: 'codex' })).result).toMatchObject({
      kind: 'signIn',
      via: 'command',
      command: 'codex login',
    });
  });
});

describe('where the check starts the agent (#200)', () => {
  it('a fresh empty temp folder each time, never the workspace, gone afterwards', async () => {
    const { checks, check, tmp } = setup();
    const seen: { cwd: string; empty: boolean }[] = [];
    check.mockImplementation(async ({ cwd }: { cwd: string }) => {
      seen.push({ cwd, empty: readdirSync(cwd).length === 0 });
      return { kind: 'ready', models: null };
    });
    await checks.check({ agent: 'codex' });
    await checks.check({ agent: 'codex', force: true });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.cwd).not.toBe(seen[1]?.cwd);
    for (const { cwd, empty } of seen) {
      expect(empty).toBe(true);
      expect(cwd.startsWith(realpathSync(tmp))).toBe(true);
    }
    await vi.waitFor(() => {
      for (const { cwd } of seen) expect(existsSync(cwd)).toBe(false);
    });
  });

  it('removes the folder when the check fails too', async () => {
    const { checks, check } = setup();
    let folder = '';
    check.mockImplementation(async ({ cwd }: { cwd: string }) => {
      folder = cwd;
      throw new Error('the agent fell over');
    });
    await expect(checks.check({ agent: 'codex' })).rejects.toThrow('the agent fell over');
    await vi.waitFor(() => expect(existsSync(folder)).toBe(false));
  });
});

describe('commandLine (#199)', () => {
  it('quotes what a POSIX shell would split or expand', () => {
    expect(commandLine({ parts: ['codex-acp', '--login'], platform: 'darwin' })).toBe(
      'codex-acp --login',
    );
    expect(
      commandLine({ parts: ['/Apps/My Agent/agent', "it's", '$HOME'], platform: 'linux' }),
    ).toBe(`'/Apps/My Agent/agent' 'it'\\''s' '$HOME'`);
  });

  it('quotes for PowerShell on Windows, running a quoted program with &', () => {
    expect(commandLine({ parts: ['codex-acp', '--login'], platform: 'win32' })).toBe(
      'codex-acp --login',
    );
    expect(
      commandLine({ parts: ['C:\\Program Files\\agent.exe', 'say "hi"'], platform: 'win32' }),
    ).toBe('& "C:\\Program Files\\agent.exe" "say `"hi`""');
  });
});
