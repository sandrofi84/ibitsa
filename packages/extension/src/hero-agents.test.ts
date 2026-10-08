import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AcpAdapter, AgentSandbox, SANDBOX_PLAN_ENV } from '@ibitsa/agent-acp';
import { AGENT_PRESETS, type AgentDefinition, resolveAgents } from '@ibitsa/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findCommand, HeroAgents } from './hero-agents';

const FAKE_AGENT = fileURLToPath(
  new URL('../../adapters/agent-acp/test/fake-agent.mjs', import.meta.url),
);
// Starting a Node process can take seconds on a busy CI runner (Windows especially).
vi.setConfig({ testTimeout: 30_000 });
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-agents-'));
  dirs.push(dir);
  return dir;
}

describe('findCommand (§11.5, #198)', () => {
  const files =
    (...paths: string[]) =>
    (path: string) =>
      paths.includes(path);

  it('looks along PATH, as a shell would', () => {
    expect(
      findCommand({
        command: 'codex-acp',
        env: { PATH: '/usr/bin:/home/me/.nvm/bin' },
        platform: 'linux',
        isFile: files('/home/me/.nvm/bin/codex-acp'),
      }),
    ).toBe('/home/me/.nvm/bin/codex-acp');
    expect(
      findCommand({
        command: 'gemini',
        env: { PATH: '/usr/bin' },
        platform: 'linux',
        isFile: files(),
      }),
    ).toBeNull();
  });

  it('takes a path as it is, with ~ as the home folder', () => {
    const isFile = files('/home/me/agents/mine', '/opt/agent');
    const lookup = { env: { PATH: '' }, platform: 'darwin' as const, isFile, home: '/home/me' };
    expect(findCommand({ ...lookup, command: '~/agents/mine' })).toBe('/home/me/agents/mine');
    expect(findCommand({ ...lookup, command: '/opt/agent' })).toBe('/opt/agent');
    expect(findCommand({ ...lookup, command: '/opt/missing' })).toBeNull();
  });

  it("finds npm's .cmd shims on Windows through PATHEXT, whatever PATH's case", () => {
    expect(
      findCommand({
        command: 'codex-acp',
        env: { Path: 'C:\\Windows;C:\\Users\\me\\AppData\\Roaming\\npm', PATHEXT: '.EXE;.CMD' },
        platform: 'win32',
        isFile: files('C:\\Users\\me\\AppData\\Roaming\\npm\\codex-acp.CMD'),
      }),
    ).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\codex-acp.CMD');
    expect(
      findCommand({
        command: 'C:\\tools\\agent',
        env: {},
        platform: 'win32',
        isFile: files('C:\\tools\\agent.CMD'),
      }),
    ).toBe('C:\\tools\\agent.CMD');
  });
});

describe('HeroAgents (§11.5, #198)', () => {
  it('has no adapter for an agent nobody configured, and says why a refused one is', () => {
    const agents = new HeroAgents({
      agents: () => resolveAgents({ cc: { command: 'claude-agent-acp' } }),
      env: () => ({}),
    });
    expect(agents.adapterFor('nowhere')).toBeUndefined();
    expect(agents.adapterFor('cc')).toEqual({
      error: "Claude runs only through Ibitsa's own Claude adapter, not over ACP.",
    });
  });

  it('keeps one adapter per agent until its entry changes', () => {
    let setting: Record<string, unknown> = {};
    const agents = new HeroAgents({ agents: () => resolveAgents(setting), env: () => ({}) });
    const first = agents.adapterFor('codex');
    expect(agents.adapterFor('codex')).toBe(first);
    setting = { codex: { prices: { inputPerMillion: 1, outputPerMillion: 8 } } };
    const second = agents.adapterFor('codex');
    expect(second).not.toBe(first);
    // With prices the agent's gold can be estimated (§11.5).
    expect(second && 'capabilities' in second && second.capabilities.costReported).toBe(true);
  });

  it("runs agents with a sandbox profile inside Ibitsa's sandbox on macOS and Linux (#200)", async () => {
    const dir = folder();
    const planFile = join(dir, 'plan.json');
    // Stands in for the sandbox host: writes down its plan and stops.
    const script = join(dir, 'host.cjs');
    writeFileSync(
      script,
      `require('node:fs').writeFileSync(${JSON.stringify(planFile)}, process.env.${SANDBOX_PLAN_ENV});`,
    );
    const sandbox = new AgentSandbox({ script, node: { command: process.execPath } });
    const agents = (platform: NodeJS.Platform) =>
      new HeroAgents({
        agents: () => resolveAgents({ mine: { command: 'my-agent' } }),
        env: () => ({}),
        sandbox,
        platform,
      });
    const mac = agents('darwin');
    // Codex's preset has a profile; a custom agent without domains doesn't, and says so.
    expect(mac.sandboxed('codex')).toBe(true);
    expect(mac.sandboxed('mine')).toBe(false);
    expect(mac.sandboxed('nowhere')).toBe(false);
    expect(agents('linux').sandboxed('codex')).toBe(true);
    // No sandbox on native Windows.
    expect(agents('win32').sandboxed('codex')).toBe(false);
    expect(
      new HeroAgents({ agents: () => resolveAgents({}), env: () => ({}) }).sandboxed('codex'),
    ).toBe(false);
    const codex = mac.adapterFor('codex');
    if (!codex || 'error' in codex) throw new Error('no adapter');
    expect((codex as AcpAdapter).sandboxed).toBe(true);
    const mine = mac.adapterFor('mine');
    expect((mine as AcpAdapter).sandboxed).toBe(false);
    const session = codex.startSession(
      { heroId: 'h1', sessionId: 's1', cwd: dir, classId: 'seer', prompt: 'hi' },
      () => {},
    );
    await vi.waitFor(() => expect(existsSync(planFile)).toBe(true), { timeout: 20_000 });
    session.close();
    const plan = JSON.parse(readFileSync(planFile, 'utf8'));
    expect(plan.command).toBe('codex-acp');
    expect(plan.config.network.allowedDomains).toEqual(['chatgpt.com', '*.oaiusercontent.com']);
    // The state folder with ~ expanded, and macOS's weaker isolation for Codex's TLS.
    expect(plan.config.filesystem.allowWrite).toContain(join(homedir(), '.codex'));
    expect(plan.config.enableWeakerNetworkIsolation).toBe(true);
  });

  it('lists the agents for the Armory with whether each is installed, and no environment', () => {
    const bin = folder();
    const shim = join(bin, process.platform === 'win32' ? 'codex-acp.cmd' : 'codex-acp');
    writeFileSync(shim, '');
    chmodSync(shim, 0o755);
    const agents = new HeroAgents({
      agents: () =>
        resolveAgents({
          codex: { env: { OPENAI_API_KEY: 'sk-secret' } },
          cc: { command: 'claude-code-acp' },
        }),
      env: () => ({ PATH: bin }),
    });
    const views = agents.views();
    expect(views.map((v) => `${v.id}:${v.found}`)).toEqual([
      ...AGENT_PRESETS.map((a) => `${a.id}:${a.id === 'codex'}`),
      'cc:false',
    ]);
    expect(views.at(-1)?.refused).toBeDefined();
    expect(JSON.stringify(views)).not.toContain('sk-secret');
  });

  it("starts a hero's session on an agent found on PATH, a .cmd shim on Windows", async () => {
    const bin = folder();
    if (process.platform === 'win32') {
      writeFileSync(join(bin, 'fake-acp.cmd'), `@"${process.execPath}" "${FAKE_AGENT}" %*\r\n`);
    } else {
      const script = join(bin, 'fake-acp');
      writeFileSync(script, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_AGENT}" "$@"\n`);
      chmodSync(script, 0o755);
    }
    const fake: AgentDefinition = {
      id: 'fake',
      name: 'Fake',
      command: 'fake-acp',
      args: [],
      env: {},
      stateFolders: [],
      domains: [],
      preset: false,
    };
    const agents = new HeroAgents({
      agents: () => [fake],
      env: () => ({ ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` }),
    });
    const adapter = agents.adapterFor('fake');
    if (!adapter || 'error' in adapter) throw new Error('no adapter');
    const events: string[] = [];
    const session = adapter.startSession(
      {
        heroId: 'h1',
        sessionId: 's1',
        cwd: folder(),
        classId: 'seer',
        prompt: 'Hello there',
      },
      (event) => events.push(event.type === 'message' ? `message:${event.text}` : event.type),
    );
    await vi.waitFor(() => expect(events).toContain('turnEnded'), { timeout: 20_000 });
    expect(events[0]).toBe('sessionStarted');
    expect(events.some((e) => e.startsWith('message:') && e.includes('Hello there'))).toBe(true);
    session.close();
  });
});
