import type { HostEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { FakeHostChannel } from './fake-host-channel';

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(credentialsReady: boolean) {
  const channel = new FakeHostChannel({ credentialsReady });
  const events: HostEvent[] = [];
  channel.onHostEvent((e) => events.push(e));
  return { channel, events };
}

describe('FakeHostChannel', () => {
  it('reports credentials as configured', async () => {
    const { channel, events } = setup(false);
    channel.request({ channel: 'host', type: 'credentialsStatus' });
    await flush();
    expect(events).toEqual([{ channel: 'host', type: 'credentials', ready: false }]);
  });

  it('rejects a bad key, then accepts a good one and becomes ready', async () => {
    const { channel, events } = setup(false);
    channel.request({ channel: 'host', type: 'saveApiKey', key: 'sk-ant-bad' });
    channel.request({ channel: 'host', type: 'saveApiKey', key: 'sk-ant-good' });
    channel.request({ channel: 'host', type: 'credentialsStatus' });
    await flush();
    expect(events.map((e) => e.type)).toEqual(['apiKeyRejected', 'apiKeyAccepted', 'credentials']);
    expect(events.at(-1)).toEqual({ channel: 'host', type: 'credentials', ready: true });
  });

  it('records editor actions without answering', async () => {
    const { channel, events } = setup(true);
    channel.request({ channel: 'host', type: 'openApiKeyPage' });
    channel.request({ channel: 'host', type: 'openWorktree' });
    await flush();
    expect(events).toEqual([]);
    expect(channel.requests.map((r) => r.type)).toEqual(['openApiKeyPage', 'openWorktree']);
  });
});
