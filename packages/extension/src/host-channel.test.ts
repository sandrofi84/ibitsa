import type { HostEvent } from '@ibitsa/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { Credentials } from './credentials.types';
import { HostChannel, isHostMessage } from './host-channel';
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
