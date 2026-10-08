import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpAdapter } from './acp-adapter';

const FAKE_AGENT = fileURLToPath(new URL('../test/fake-agent.mjs', import.meta.url));
// Starting a Node process can take seconds on a busy CI runner (Windows especially).
vi.setConfig({ testTimeout: 30_000 });
const dirs: string[] = [];
afterEach(() => {
  // On Windows the folder stays busy until the killed agent has gone.
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-acp-'));
  dirs.push(dir);
  return dir;
}

const fake = (env: Record<string, string> = {}) =>
  new AcpAdapter({ agent: { command: process.execPath, args: [FAKE_AGENT], env } });

describe('AcpAdapter (§11.5)', () => {
  it('has no budget cap, and counts gold only when the agent has prices', () => {
    expect(fake().capabilities).toEqual({ budgetCap: false, costReported: false });
    expect(
      new AcpAdapter({
        agent: { command: 'x', prices: { inputPerMillion: 1, outputPerMillion: 2 } },
      }).capabilities,
    ).toEqual({ budgetCap: false, costReported: true });
  });

  it("lists the agent's own commands for the / menu, without sending a prompt", async () => {
    const commands = [
      { name: 'review', description: 'Review the changes', input: { hint: '[focus]' } },
      { name: 'compact', description: 'Compact the conversation' },
    ];
    const actions = await fake({ FAKE_ACP_COMMANDS: JSON.stringify(commands) }).listActions({
      cwd: folder(),
    });
    expect(actions).toEqual([
      {
        name: 'review',
        description: 'Review the changes',
        argumentHint: '[focus]',
        aliases: [],
        source: 'other',
        target: 'any',
      },
      {
        name: 'compact',
        description: 'Compact the conversation',
        argumentHint: '',
        aliases: [],
        source: 'other',
        target: 'any',
      },
    ]);
  });

  it('lists nothing when the agent needs a sign-in or cannot start', async () => {
    expect(await fake({ FAKE_ACP_AUTH: 'required' }).listActions({ cwd: folder() })).toEqual([]);
    const dir = folder();
    expect(
      await new AcpAdapter({ agent: { command: join(dir, 'missing') } }).listActions({ cwd: dir }),
    ).toEqual([]);
  });
});

describe('the party check (§11.5, #199)', () => {
  const MODELS = {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'gpt-6-sol',
    options: [
      {
        group: 'gpt-6',
        name: 'GPT-6',
        options: [
          { value: 'gpt-6-sol', name: 'Sol' },
          { value: 'gpt-6-luna', name: 'Luna' },
        ],
      },
      { group: 'older', name: 'Older', options: [{ value: 'gpt-5.6-terra', name: 'Terra' }] },
    ],
  };

  it('starts a session without a prompt, names the models it offers, and closes it', async () => {
    const dir = folder();
    const log = join(dir, 'requests.jsonl');
    const probe = await fake({
      FAKE_ACP_LOG: log,
      FAKE_ACP_CAPS: JSON.stringify({ sessionCapabilities: { close: {} } }),
      FAKE_ACP_CONFIG: JSON.stringify([MODELS]),
    }).check({ cwd: dir });
    expect(probe).toEqual({
      kind: 'ready',
      models: ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-terra'],
    });
    const methods = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).method);
    expect(methods).toEqual(['initialize', 'session/new', 'session/close']);
    const init = JSON.parse(readFileSync(log, 'utf8').split('\n')[0] ?? '{}');
    expect(init.params.clientCapabilities.auth).toEqual({ terminal: true });
  });

  it('says when the agent offers no choice of model', async () => {
    expect(await fake().check({ cwd: folder() })).toEqual({ kind: 'ready', models: null });
  });

  it("asks for a sign-in on auth_required, with the agent's own terminal sign-in if it has one", async () => {
    const methods = [
      { id: 'chat-gpt', name: 'ChatGPT' },
      { id: 'tui', name: 'Sign in', type: 'terminal', args: ['--login'], env: { MODE: 'tui' } },
    ];
    expect(
      await fake({
        FAKE_ACP_AUTH: 'required',
        FAKE_ACP_AUTH_METHODS: JSON.stringify(methods),
      }).check({ cwd: folder() }),
    ).toEqual({
      kind: 'signIn',
      message: 'Authentication required',
      terminal: { args: ['--login'], env: { MODE: 'tui' } },
    });
    expect(
      await fake({
        FAKE_ACP_AUTH: 'required',
        FAKE_ACP_AUTH_METHODS: JSON.stringify(methods.slice(0, 1)),
      }).check({ cwd: folder() }),
    ).toMatchObject({ kind: 'signIn', terminal: null });
  });

  it("fails when the agent can't start, exits, or doesn't answer in time", async () => {
    const dir = folder();
    const missing = await new AcpAdapter({ agent: { command: join(dir, 'missing') } }).check({
      cwd: dir,
    });
    expect(missing).toMatchObject({ kind: 'failed' });
    expect(missing.kind === 'failed' && missing.message).toMatch(/Couldn't start the agent/);

    const exits = await new AcpAdapter({
      agent: { command: process.execPath, args: ['-e', 'process.exit(3)'] },
    }).check({ cwd: folder() });
    expect(exits).toMatchObject({ kind: 'failed', message: expect.stringMatching(/code 3/) });

    const slow = await fake({ FAKE_ACP_INIT_DELAY: '20000' }).check({
      cwd: folder(),
      timeoutMs: 1_000,
    });
    expect(slow).toEqual({ kind: 'failed', message: "The agent didn't answer in 1 s." });
  });
});
