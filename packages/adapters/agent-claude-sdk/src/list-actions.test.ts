import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';
import type { SdkModule } from './claude-adapter.types';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A stand-in SDK whose sessions only answer the command list. */
function fakeSdk(commands: SlashCommand[]) {
  const calls: { options: Options; closed: boolean }[] = [];
  const sdk = {
    query: ({ options = {} }: { options?: Options }) => {
      const call = { options, closed: false };
      calls.push(call);
      return {
        supportedCommands: async () => commands,
        close: () => {
          call.closed = true;
        },
      };
    },
  } as unknown as SdkModule;
  return { sdk, calls };
}

describe('ClaudeAdapter.listActions (#84)', () => {
  it("lists the folder's skills without Claude Code's own, with their source and target", async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ibitsa-actions-'));
    const home = mkdtempSync(join(tmpdir(), 'ibitsa-home-'));
    dirs.push(cwd, home);
    mkdirSync(join(cwd, '.claude', 'skills', 'pr'), { recursive: true });
    writeFileSync(
      join(cwd, '.claude', 'skills', 'pr', 'SKILL.md'),
      '---\nibitsa-target: council\n---\nOpen a PR.\n',
    );
    mkdirSync(join(home, '.claude', 'skills', 'odd'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'skills', 'odd', 'SKILL.md'),
      '---\nibitsa-target: everyone\n---\nx\n',
    );
    const fake = fakeSdk([
      { name: 'compact', description: 'Compact the conversation', argumentHint: '', builtin: true },
      { name: 'pr', description: 'Open a pull request (project)', argumentHint: 'reviewers' },
      { name: 'odd', description: 'Something (user)', argumentHint: '' },
      {
        name: 'ibitsa:test',
        description: '(ibitsa) Run the tests',
        argumentHint: 'filter',
        aliases: ['test'],
      },
      { name: 'mcp-thing', description: 'From an MCP server', argumentHint: '' },
    ]);
    const adapter = new ClaudeAdapter({
      env: () => ({ ANTHROPIC_API_KEY: 'k' }),
      loadSdk: async () => fake.sdk,
      pluginDirs: () => ['/plugins/ibitsa'],
      home,
    });

    expect(await adapter.listActions({ cwd })).toEqual([
      {
        name: 'pr',
        description: 'Open a pull request',
        argumentHint: 'reviewers',
        aliases: [],
        source: 'project',
        target: 'council',
      },
      {
        name: 'odd',
        description: 'Something',
        argumentHint: '',
        aliases: [],
        source: 'user',
        target: 'any',
      },
      {
        name: 'ibitsa:test',
        description: 'Run the tests',
        argumentHint: 'filter',
        aliases: ['test'],
        source: 'plugin',
        target: 'any',
      },
      {
        name: 'mcp-thing',
        description: 'From an MCP server',
        argumentHint: '',
        aliases: [],
        source: 'other',
        target: 'any',
      },
    ]);
    expect(fake.calls[0]?.options).toMatchObject({
      cwd,
      settingSources: ['project'],
      plugins: [{ type: 'local', path: '/plugins/ibitsa' }],
    });
    expect(fake.calls[0]?.closed).toBe(true);
  });

  it('closes the short session even when listing fails', async () => {
    const calls: boolean[] = [];
    const sdk = {
      query: () => ({
        supportedCommands: async () => {
          throw new Error('no CLI');
        },
        close: () => calls.push(true),
      }),
    } as unknown as SdkModule;
    const adapter = new ClaudeAdapter({
      env: () => ({}),
      loadSdk: async () => sdk,
      claudeCodePath: () => '/bin/claude',
    });
    await expect(adapter.listActions({ cwd: '/wt' })).rejects.toThrow('no CLI');
    expect(calls).toEqual([true]);
  });
});

describe('ClaudeAdapter.previewAction (#85)', () => {
  it("expands the skill's prompt with the arguments and the folder's variables", async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ibitsa-preview-'));
    dirs.push(cwd);
    mkdirSync(join(cwd, '.claude', 'skills', 'pr'), { recursive: true });
    writeFileSync(
      join(cwd, '.claude', 'skills', 'pr', 'SKILL.md'),
      '---\nname: pr\n---\nOpen a PR in $CWD_MARK. Reviewers: $ARGUMENTS\n'.replace(
        '$CWD_MARK',
        '$' + '{CLAUDE_PROJECT_DIR}',
      ),
    );
    const adapter = new ClaudeAdapter({ env: () => ({}), home: cwd });
    expect(await adapter.previewAction({ cwd, name: 'pr', args: 'alice' })).toEqual({
      text: `Open a PR in ${cwd}. Reviewers: alice`,
      notes: [],
    });
    expect(await adapter.previewAction({ cwd, name: 'missing', args: '' })).toBeNull();
  });
});
