import type { HostEvent, HostRequest } from '@ibitsa/protocol';

/**
 * The extension's host channel, faked for the standalone build (#37): credentials are ready unless the
 * page says otherwise; a key is accepted if it starts with `sk-ant-` and isn't `sk-ant-bad`.
 */
export class FakeHostChannel {
  readonly requests: HostRequest[] = [];
  private ready: boolean;
  private readonly listeners: ((event: HostEvent) => void)[] = [];

  constructor({ credentialsReady }: { credentialsReady: boolean }) {
    this.ready = credentialsReady;
  }

  onHostEvent(listener: (event: HostEvent) => void): void {
    this.listeners.push(listener);
  }

  request(request: HostRequest): void {
    this.requests.push(request);
    switch (request.type) {
      case 'credentialsStatus':
        this.emit({ channel: 'host', type: 'credentials', ready: this.ready });
        return;
      case 'saveApiKey':
        if (request.key.startsWith('sk-ant-') && request.key !== 'sk-ant-bad') {
          this.ready = true;
          this.emit({ channel: 'host', type: 'apiKeyAccepted' });
        } else {
          this.emit({
            channel: 'host',
            type: 'apiKeyRejected',
            reason: 'That key was rejected by Anthropic.',
          });
        }
        return;
      case 'openApiKeyPage':
      case 'openWorktree':
        return;
    }
  }

  private emit(event: HostEvent): void {
    queueMicrotask(() => {
      for (const l of this.listeners) l(event);
    });
  }
}
