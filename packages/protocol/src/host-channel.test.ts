import { describe, expect, it } from 'vitest';
import { parseHostRequest } from './host-channel';

describe('parseHostRequest', () => {
  it('accepts the host requests, trimming the key', () => {
    expect(parseHostRequest({ channel: 'host', type: 'credentialsStatus' })).toEqual({
      channel: 'host',
      type: 'credentialsStatus',
    });
    expect(parseHostRequest({ channel: 'host', type: 'saveApiKey', key: '  sk-ant-x  ' })).toEqual({
      channel: 'host',
      type: 'saveApiKey',
      key: 'sk-ant-x',
    });
    expect(parseHostRequest({ channel: 'host', type: 'openApiKeyPage' })?.type).toBe(
      'openApiKeyPage',
    );
    expect(parseHostRequest({ channel: 'host', type: 'openWorktree' })?.type).toBe('openWorktree');
  });

  it('rejects anything else', () => {
    for (const input of [
      null,
      { type: 'credentialsStatus' },
      { channel: 'host', type: 'deleteEverything' },
      { channel: 'host', type: 'saveApiKey', key: '   ' },
      { channel: 'host', type: 'saveApiKey', key: 'x'.repeat(600) },
      { channel: 'host', type: 'openWorktree', path: '/etc' },
      { type: 'stopHero', commandId: 'c', heroId: 'h' },
    ]) {
      expect(parseHostRequest(input)).toBeNull();
    }
  });
});
