import type { HostEvent } from '@ibitsa/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { Credentials } from './credentials.types';
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
    expect(deps.openFile).toHaveBeenCalledWith('/ws/.ibitsa/campaigns/c1/record.md');
  });

  it('checks paths against every allowed folder', () => {
    const roots = ['/home/me/.claude/skills'];
    expect(
      openablePath({ path: '/home/me/.claude/skills/x/SKILL.md', workspace: '/ws', roots }),
    ).toBe('/home/me/.claude/skills/x/SKILL.md');
    expect(openablePath({ path: '/home/me/.claude/skills', workspace: '/ws', roots })).toBeNull();
    expect(openablePath({ path: 'a.md', workspace: undefined, roots })).toBeNull();
    expect(openablePath({ path: '/ws/../ws2/a.md', workspace: '/ws', roots })).toBeNull();
  });
});
