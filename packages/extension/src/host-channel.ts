import { type HostEvent, parseHostRequest } from '@ibitsa/protocol';
import type { HostChannelDeps } from './host-channel.types';

export const API_KEYS_URL = 'https://console.anthropic.com/settings/keys';

/** True for messages on the host channel, which never reach the runtime or its log. */
export function isHostMessage(raw: unknown): boolean {
  return (
    typeof raw === 'object' && raw !== null && (raw as { channel?: unknown }).channel === 'host'
  );
}

/**
 * The extension's side of the host channel (spec §11.6): credentials and editor actions, kept out of the
 * protocol so the API key never reaches core or the event log.
 */
export class HostChannel {
  constructor(private readonly deps: HostChannelDeps) {}

  async receive(raw: unknown): Promise<void> {
    const request = parseHostRequest(raw);
    if (!request) return;
    switch (request.type) {
      case 'credentialsStatus': {
        const credentials = await this.deps.credentials();
        this.post({
          channel: 'host',
          type: 'credentials',
          ready: credentials.source !== 'none' || this.deps.development,
        });
        return;
      }
      case 'openApiKeyPage':
        this.deps.openApiKeyPage();
        return;
      case 'saveApiKey': {
        const verdict = await this.deps.validateKey()(request.key);
        if (!verdict.ok) {
          this.post({ channel: 'host', type: 'apiKeyRejected', reason: verdict.reason });
          return;
        }
        await this.deps.storeApiKey(request.key);
        this.post({ channel: 'host', type: 'apiKeyAccepted' });
        return;
      }
      case 'openWorktree':
        this.deps.openWorktree();
        return;
    }
  }

  private post(event: HostEvent): void {
    this.deps.post(event);
  }
}
