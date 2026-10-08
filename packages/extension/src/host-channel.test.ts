import { resolve } from 'node:path';
import type { HostEvent } from '@ibitsa/protocol';
import { describe, expect, it, vi } from 'vitest';
import { AgentChecks } from './agent-checks';
import { Armory } from './armory';
import type { Credentials } from './credentials.types';
import { GuildCouncil } from './guild-council';
import { GuildSettings } from './guild-settings';
import { HostChannel, isHostMessage, openablePath } from './host-channel';
import type { HostChannelDeps } from './host-channel.types';

function setup(overrides: Partial<HostChannelDeps> = {}) {
  const posted: HostEvent[] = [];
  const deps: HostChannelDeps = {
    credentials: async (): Promise<Credentials> => ({ source: 'none' }),
    development: false,
    storeApiKey: vi.fn(async () => {}),
    validateKey: () => async (key) =>
      key === 'sk-ant-good' ? { ok: true } : { ok: false, reason: 'rejected' },
    openApiKeyPage: vi.fn(),
    openWorktree: vi.fn(),
    post: (event) => posted.push(event),
    settings: new GuildSettings({
      schema: { 'ibitsa.review.loopLimit': { type: 'integer', default: 3, minimum: 1 } },
      inspect: () => ({ defaultValue: 3 }),
      update: async () => {},
    }),
    openSettings: vi.fn(),
    openFile: vi.fn(),
    openable: { workspace: '/ws', roots: ['/home/me/.claude/skills'] },
    packs: {
      list: () => [
        { id: 'default', name: 'Default', scope: 'builtin', errors: [], preview: null },
        { id: 'user:retro', name: 'Retro', scope: 'user', errors: [], preview: null },
      ],
      dir: (id: string) => (id === 'user:retro' ? '/home/me/.ibitsa/packs/retro' : null),
    } as unknown as HostChannelDeps['packs'],
    activePack: () => 'default',
    setActivePack: vi.fn(async () => {}),
    packBase: (dir) => `webview:${dir}/`,
    council: new GuildCouncil({
      inspect: () => undefined,
      update: async () => {},
      files: { exists: () => false, read: () => '', write: () => {} },
      roots: { home: '/home/me', workspace: '/ws', plugin: '/ext/plugin' },
      open: () => {},
    }),
    armory: new Armory({ inspect: () => undefined, update: async () => {} }),
    agentChecks: new AgentChecks({
      agents: () => [],
      checker: () => undefined,
      cwd: () => '/ws',
      env: () => ({}),
    }),
    openTerminal: vi.fn(),
    ...overrides,
  };
  return { channel: new HostChannel(deps), deps, posted };
}

describe('HostChannel', () => {
  it('reports missing credentials', async () => {
    const { channel, posted } = setup();
    await channel.receive({ channel: 'host', type: 'credentialsStatus' });
    expect(posted).toEqual([{ channel: 'host', type: 'credentials', ready: false }]);
  });

  it('is ready with a key, or in development', async () => {
    const withKey = setup({ credentials: async () => ({ source: 'secret', apiKey: 'k' }) });
    await withKey.channel.receive({ channel: 'host', type: 'credentialsStatus' });
    const dev = setup({ development: true });
    await dev.channel.receive({ channel: 'host', type: 'credentialsStatus' });
    expect([...withKey.posted, ...dev.posted]).toEqual([
      { channel: 'host', type: 'credentials', ready: true },
      { channel: 'host', type: 'credentials', ready: true },
    ]);
  });

  it('stores a key only after Anthropic accepts it', async () => {
    const { channel, deps, posted } = setup();
    await channel.receive({ channel: 'host', type: 'saveApiKey', key: ' sk-ant-bad ' });
    expect(deps.storeApiKey).not.toHaveBeenCalled();
    await channel.receive({ channel: 'host', type: 'saveApiKey', key: ' sk-ant-good ' });
    expect(deps.storeApiKey).toHaveBeenCalledWith('sk-ant-good');
    expect(posted).toEqual([
      { channel: 'host', type: 'apiKeyRejected', reason: 'rejected' },
      { channel: 'host', type: 'apiKeyAccepted' },
    ]);
  });

  it('opens the key page and the worktree', async () => {
    const { channel, deps } = setup();
    await channel.receive({ channel: 'host', type: 'openApiKeyPage' });
    await channel.receive({ channel: 'host', type: 'openWorktree' });
    expect(deps.openApiKeyPage).toHaveBeenCalledOnce();
    expect(deps.openWorktree).toHaveBeenCalledOnce();
  });

  it('ignores malformed requests', async () => {
    const { channel, posted } = setup();
    await channel.receive({ channel: 'host', type: 'saveApiKey', key: '' });
    await channel.receive({ channel: 'host', type: 'nope' });
    expect(posted).toEqual([]);
  });
});

describe('isHostMessage', () => {
  it('recognises the host channel', () => {
    expect(isHostMessage({ channel: 'host', type: 'x' })).toBe(true);
    expect(isHostMessage({ type: 'hello' })).toBe(false);
    expect(isHostMessage(null)).toBe(false);
  });
});

describe('the Guild Hall on the host channel (#179)', () => {
  it('sends the rules on request, and again after a write or a reset', async () => {
    const update = vi.fn(async () => {});
    const { channel, posted } = setup({
      settings: new GuildSettings({
        schema: { 'ibitsa.review.loopLimit': { type: 'integer', default: 3 } },
        inspect: () => ({ defaultValue: 3 }),
        update,
      }),
    });
    await channel.receive({ channel: 'host', type: 'readSettings' });
    await channel.receive({
      channel: 'host',
      type: 'writeSetting',
      key: 'review.loopLimit',
      value: 5,
      layer: 'workspace',
    });
    await channel.receive({
      channel: 'host',
      type: 'resetSetting',
      key: 'review.loopLimit',
      layer: 'workspace',
    });
    expect(posted.map((e) => e.type)).toEqual(['settings', 'settings', 'settings']);
    expect(update.mock.calls).toEqual([
      [{ key: 'review.loopLimit', value: 5, layer: 'workspace' }],
      [{ key: 'review.loopLimit', value: undefined, layer: 'workspace' }],
    ]);
  });

  it('refuses to write anything but a rule', async () => {
    const update = vi.fn(async () => {});
    const { channel } = setup({
      settings: new GuildSettings({ schema: {}, inspect: () => undefined, update }),
    });
    await channel.receive({
      channel: 'host',
      type: 'writeSetting',
      key: 'claudeCodePath',
      value: '/evil',
      layer: 'user',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('opens VS Code settings, and only files inside the workspace or the allowed folders', async () => {
    const { channel, deps } = setup();
    await channel.receive({ channel: 'host', type: 'openSettings' });
    await channel.receive({
      channel: 'host',
      type: 'openFile',
      path: '.ibitsa/campaigns/c1/record.md',
    });
    await channel.receive({ channel: 'host', type: 'openFile', path: '../secrets.txt' });
    await channel.receive({ channel: 'host', type: 'openFile', path: '/etc/passwd' });
    expect(deps.openSettings).toHaveBeenCalledOnce();
    expect(deps.openFile).toHaveBeenCalledTimes(1);
    expect(deps.openFile).toHaveBeenCalledWith(resolve('/ws', '.ibitsa/campaigns/c1/record.md'));
  });

  it('checks paths against every allowed folder', () => {
    const roots = ['/home/me/.claude/skills'];
    expect(
      openablePath({ path: '/home/me/.claude/skills/x/SKILL.md', workspace: '/ws', roots }),
      // Resolved for the platform: a drive letter on Windows.
    ).toBe(resolve('/home/me/.claude/skills/x/SKILL.md'));
    expect(openablePath({ path: '/home/me/.claude/skills', workspace: '/ws', roots })).toBeNull();
    expect(openablePath({ path: 'a.md', workspace: undefined, roots })).toBeNull();
    expect(openablePath({ path: '/ws/../ws2/a.md', workspace: '/ws', roots })).toBeNull();
  });
});

describe('asset packs on the host channel (#183)', () => {
  it('lists the packs with the one in use', async () => {
    const { channel, posted } = setup();
    await channel.receive({ channel: 'host', type: 'readPacks' });
    expect(posted).toEqual([
      expect.objectContaining({ type: 'packs', active: 'default', packs: expect.any(Array) }),
    ]);
  });

  it('uses a pack that is there and valid, telling the game where its files are', async () => {
    const { channel, posted, deps } = setup();
    await channel.receive({ channel: 'host', type: 'usePack', id: 'user:retro' });
    expect(deps.setActivePack).toHaveBeenCalledWith('user:retro');
    expect(posted[0]).toEqual({
      channel: 'host',
      type: 'packChanged',
      base: 'webview:/home/me/.ibitsa/packs/retro/',
    });
    await channel.receive({ channel: 'host', type: 'usePack', id: 'default' });
    expect(posted.at(-2)).toEqual({ channel: 'host', type: 'packChanged', base: null });
  });

  it('ignores a pack that is missing or broken', async () => {
    const { channel, posted, deps } = setup();
    await channel.receive({ channel: 'host', type: 'usePack', id: 'project:broken' });
    await channel.receive({ channel: 'host', type: 'usePack', id: '../../etc' });
    expect(deps.setActivePack).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});

describe('the Roster on the host channel (#181)', () => {
  it('sends the council settings on request and after a change, and hands file actions to the council', async () => {
    const council = {
      view: vi.fn(() => ({
        disabled: [],
        disabledLayer: 'default' as const,
        overrides: {},
        overridesLayer: 'default' as const,
      })),
      setEnabled: vi.fn(async () => {}),
      setOverride: vi.fn(async () => {}),
      customise: vi.fn(() => null),
      create: vi.fn(() => null),
    };
    const { channel, posted } = setup({ council: council as unknown as GuildCouncil });
    await channel.receive({ channel: 'host', type: 'readCouncilSettings' });
    await channel.receive({
      channel: 'host',
      type: 'setCouncillorEnabled',
      id: 'security',
      enabled: false,
      layer: 'user',
    });
    await channel.receive({
      channel: 'host',
      type: 'setCouncillorOverride',
      id: 'security',
      override: { title: 'Guardian' },
      layer: 'workspace',
    });
    await channel.receive({
      channel: 'host',
      type: 'customiseCouncillor',
      id: 'security',
      path: '/ext/plugin/skills/security/SKILL.md',
      layer: 'user',
    });
    await channel.receive({
      channel: 'host',
      type: 'newCouncillor',
      id: 'perf',
      title: 'Performance',
      description: 'Speed.',
      layer: 'workspace',
    });
    expect(posted.map((e) => e.type)).toEqual([
      'councilSettings',
      'councilSettings',
      'councilSettings',
    ]);
    expect(council.setEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'security', enabled: false, layer: 'user' }),
    );
    expect(council.customise).toHaveBeenCalledOnce();
    expect(council.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'perf', title: 'Performance' }),
    );
  });

  it("refuses an id that isn't a skill folder's name", async () => {
    const create = vi.fn(() => null);
    const { channel } = setup({ council: { create } as unknown as GuildCouncil });
    await channel.receive({
      channel: 'host',
      type: 'newCouncillor',
      id: '../../etc',
      title: 'X',
      description: 'Y',
      layer: 'user',
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('the Armory on the host channel (#182)', () => {
  it('sends the armory on request, and again after each write or reset', async () => {
    const update = vi.fn(async () => {});
    const { channel, posted } = setup({ armory: new Armory({ inspect: () => undefined, update }) });
    await channel.receive({ channel: 'host', type: 'readArmory' });
    await channel.receive({
      channel: 'host',
      type: 'writeClass',
      id: 'bard',
      class: { name: 'Bard', model: 'opus' },
      layer: 'user',
    });
    await channel.receive({ channel: 'host', type: 'resetClass', id: 'bard', layer: 'user' });
    await channel.receive({
      channel: 'host',
      type: 'writeRecolor',
      target: 'class:ranger',
      recolor: { hue: 90, preset: 'none' },
      layer: 'workspace',
    });
    await channel.receive({
      channel: 'host',
      type: 'resetRecolor',
      target: 'class:ranger',
      layer: 'workspace',
    });
    expect(posted.map((e) => e.type)).toEqual(['armory', 'armory', 'armory', 'armory', 'armory']);
    expect(update).toHaveBeenCalledTimes(4);
  });

  it('refuses a class id or recolor target that does not check out', async () => {
    const update = vi.fn(async () => {});
    const { channel } = setup({ armory: new Armory({ inspect: () => undefined, update }) });
    await channel.receive({
      channel: 'host',
      type: 'writeClass',
      id: 'Not An Id',
      class: {},
      layer: 'user',
    });
    await channel.receive({
      channel: 'host',
      type: 'writeRecolor',
      target: 'anything',
      recolor: {},
      layer: 'user',
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('the party check on the host channel (#199)', () => {
  const codex = {
    id: 'codex',
    name: 'Codex',
    command: 'codex-acp',
    args: [],
    env: {},
    stateFolders: [],
    domains: [],
    signIn: 'codex login',
    preset: true,
  };

  it('answers each agent with its check, and Sign in opens a terminal on its sign-in', async () => {
    const agentChecks = new AgentChecks({
      agents: () => [codex],
      checker: () => ({
        check: async () => ({ kind: 'signIn', message: 'Sign in first', terminal: null }),
      }),
      cwd: () => '/ws',
      env: () => ({ PATH: '/bin' }),
      platform: 'linux',
      isFile: () => true,
    });
    const { channel, deps, posted } = setup({ agentChecks });
    await channel.receive({ channel: 'host', type: 'checkAgents', agents: ['codex', 'nobody'] });
    expect(posted).toEqual([
      {
        channel: 'host',
        type: 'agentCheck',
        check: {
          agent: 'nobody',
          name: 'nobody',
          costReported: false,
          result: { kind: 'failed', message: 'There\'s no agent "nobody" in ibitsa.agents.' },
        },
      },
      {
        channel: 'host',
        type: 'agentCheck',
        check: {
          agent: 'codex',
          name: 'Codex',
          costReported: false,
          result: {
            kind: 'signIn',
            message: 'Sign in first',
            via: 'command',
            command: 'codex login',
          },
        },
      },
    ]);
    await channel.receive({ channel: 'host', type: 'signInAgent', agent: 'codex' });
    expect(deps.openTerminal).toHaveBeenCalledWith({
      name: 'Sign in to Codex',
      command: 'codex login',
      env: {},
    });
  });

  it('opens nothing for an agent without a sign-in, and drops requests that do not check out', async () => {
    const { channel, deps, posted } = setup();
    await channel.receive({ channel: 'host', type: 'signInAgent', agent: 'codex' });
    await channel.receive({ channel: 'host', type: 'checkAgents', agents: [] });
    await channel.receive({ channel: 'host', type: 'checkAgents', agents: ['Not An Id'] });
    expect(deps.openTerminal).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});
