import { describe, expect, it } from 'vitest';
import { commandExists, heroSettings, offeredRules, sandboxProblem } from './hero-settings';

describe('heroSettings (spec §11.6)', () => {
  it('confines macOS and Linux heroes: acceptEdits, the sandbox, and asking before escaping it', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(
        heroSettings({ platform, settingSources: ['project'], testScripts: [], allowRules: [] }),
      ).toEqual({
        permissionMode: 'acceptEdits',
        settingSources: ['project'],
        sandbox: { enabled: true, autoAllowBashIfSandboxed: true, failIfUnavailable: true },
        settings: { permissions: { ask: ['Bash(dangerouslyDisableSandbox:true)'] } },
        allowedTools: [],
      });
    }
  });

  it('on native Windows, runs without a sandbox and allows only test commands', () => {
    const settings = heroSettings({
      platform: 'win32',
      settingSources: ['project', 'user'],
      testScripts: ['test:unit'],
      allowRules: [],
    });
    expect(settings.permissionMode).toBe('acceptEdits');
    expect(settings.sandbox).toBeUndefined();
    expect(settings.settingSources).toEqual(['project', 'user']);
    expect(settings.allowedTools).toEqual(
      expect.arrayContaining([
        'Bash(pnpm test)',
        'Bash(pnpm test *)',
        'Bash(pytest *)',
        'Bash(pnpm test:unit *)',
        'Bash(npm run test:unit)',
      ]),
    );
    expect(
      settings.allowedTools?.some((rule) => rule.startsWith('Bash(git') || rule === 'Bash'),
    ).toBe(false);
  });
});

describe('sandboxProblem', () => {
  it('names what is missing on Linux', () => {
    expect(sandboxProblem({ platform: 'linux', hasCommand: () => false })).toBe(
      'The hero sandbox needs bubblewrap and socat. Install with your package manager, e.g. `sudo apt-get install bubblewrap socat`, then resume.',
    );
    expect(sandboxProblem({ platform: 'linux', hasCommand: (c) => c === 'socat' })).toContain(
      'needs bubblewrap.',
    );
  });

  it('has nothing to say when the tools are there, or off Linux', () => {
    expect(sandboxProblem({ platform: 'linux', hasCommand: () => true })).toBeNull();
    expect(sandboxProblem({ platform: 'darwin', hasCommand: () => false })).toBeNull();
    expect(sandboxProblem({ platform: 'win32', hasCommand: () => false })).toBeNull();
  });
});

describe('commandExists', () => {
  it('finds commands on PATH', () => {
    expect(commandExists('node')).toBe(true);
    expect(commandExists('ibitsa-no-such-command')).toBe(false);
  });
});

describe('always allow rules (#62)', () => {
  it('join the flag-level settings on macOS and Linux, and the allowed tools on Windows', () => {
    const rules = ['Bash(npm run lint:*)'];
    expect(
      heroSettings({
        platform: 'darwin',
        settingSources: ['project'],
        testScripts: [],
        allowRules: rules,
      }).settings,
    ).toEqual({
      permissions: { ask: ['Bash(dangerouslyDisableSandbox:true)'], allow: rules },
    });
    expect(
      heroSettings({
        platform: 'win32',
        settingSources: ['project'],
        testScripts: [],
        allowRules: rules,
      }).allowedTools,
    ).toEqual(expect.arrayContaining(rules));
  });
});

describe('offeredRules (#62)', () => {
  const cwd = '/wt';
  const lint = {
    type: 'addRules' as const,
    rules: [{ toolName: 'Bash', ruleContent: 'npm run lint:*' }],
    behavior: 'allow' as const,
    destination: 'localSettings' as const,
  };

  it("offers the SDK's allow rules, for this session only", () => {
    expect(
      offeredRules({
        toolName: 'Bash',
        input: { command: 'npm run lint' },
        cwd,
        suggestions: [lint, { type: 'setMode', mode: 'bypassPermissions', destination: 'session' }],
      }),
    ).toEqual({
      rules: ['Bash(npm run lint:*)'],
      updates: [{ ...lint, destination: 'session' }],
    });
    expect(
      offeredRules({
        toolName: 'WebFetch',
        input: { url: 'https://example.com' },
        cwd,
        suggestions: [{ ...lint, rules: [{ toolName: 'WebFetch' }] }],
      }).rules,
    ).toEqual(['WebFetch']);
  });

  it('offers nothing for the hard limits, or without suggestions', () => {
    const none = { rules: [], updates: [] };
    expect(offeredRules({ toolName: 'Bash', input: { command: 'x' }, cwd })).toEqual(none);
    expect(
      offeredRules({
        toolName: 'Bash',
        input: { command: 'curl x', dangerouslyDisableSandbox: true },
        cwd,
        suggestions: [lint],
      }),
    ).toEqual(none);
    expect(
      offeredRules({
        toolName: 'Bash',
        input: { command: 'cat ~/x' },
        cwd,
        suggestions: [lint],
        blockedPath: '/etc',
      }),
    ).toEqual(none);
    expect(
      offeredRules({
        toolName: 'Read',
        input: { file_path: '/elsewhere/a' },
        cwd,
        suggestions: [
          lint,
          { type: 'addDirectories', directories: ['/elsewhere'], destination: 'session' },
        ],
      }),
    ).toEqual(none);
    expect(
      offeredRules({
        toolName: 'Write',
        input: { file_path: '/elsewhere/a.md' },
        cwd,
        suggestions: [lint],
      }),
    ).toEqual(none);
    expect(offeredRules({ toolName: 'Edit', input: {}, cwd, suggestions: [lint] })).toEqual(none);
  });

  it('offers rules for a file tool inside the worktree, either separator', () => {
    for (const file_path of ['/wt/src/a.ts', '/wt\\src\\a.ts']) {
      expect(
        offeredRules({ toolName: 'Edit', input: { file_path }, cwd, suggestions: [lint] }).rules,
      ).toEqual(['Bash(npm run lint:*)']);
    }
  });
});
