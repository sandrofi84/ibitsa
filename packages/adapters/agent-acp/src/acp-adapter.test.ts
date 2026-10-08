import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { AcpAdapter } from './acp-adapter';

const FAKE_AGENT = fileURLToPath(new URL('../test/fake-agent.mjs', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
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
