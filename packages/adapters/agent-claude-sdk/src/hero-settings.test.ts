import { describe, expect, it } from 'vitest';
import { commandExists, heroSettings, sandboxProblem } from './hero-settings';

describe('heroSettings (spec §11.6)', () => {
  it('confines macOS and Linux heroes: acceptEdits, the sandbox, and asking before escaping it', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(heroSettings({ platform, settingSources: ['project'], testScripts: [] })).toEqual({
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
