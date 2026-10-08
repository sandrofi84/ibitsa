import { isAbsolute, relative, resolve } from 'node:path';
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
      case 'readSettings':
        this.postRules();
        return;
      case 'writeSetting':
        await this.deps.settings.write(request);
        this.postRules();
        return;
      case 'resetSetting':
        await this.deps.settings.reset(request);
        this.postRules();
        return;
      case 'openSettings':
        this.deps.openSettings();
        return;
      case 'readPacks':
        this.postPacks();
        return;
      case 'usePack': {
        // The default, or a pack that's there and passes the validator; anything else is ignored.
        const dir = request.id === 'default' ? null : this.deps.packs.dir(request.id);
        if (request.id !== 'default' && !dir) return;
        await this.deps.setActivePack(request.id);
        this.post({
          channel: 'host',
          type: 'packChanged',
          base: dir ? this.deps.packBase(dir) : null,
        });
        this.postPacks();
        return;
      }
      case 'openFile': {
        const path = openablePath({ path: request.path, ...this.deps.openable });
        if (path) this.deps.openFile(path);
        return;
      }
      case 'readCouncilSettings':
        this.postCouncil();
        return;
      case 'setCouncillorEnabled':
        await this.deps.council.setEnabled(request);
        this.postCouncil();
        return;
      case 'setCouncillorOverride':
        await this.deps.council.setOverride(request);
        this.postCouncil();
        return;
      case 'customiseCouncillor':
        this.deps.council.customise(request);
        return;
      case 'newCouncillor':
        this.deps.council.create(request);
        return;
      case 'readArmory':
        this.postArmory();
        return;
      case 'writeClass':
        await this.deps.armory.writeClass({
          id: request.id,
          value: request.class,
          layer: request.layer,
        });
        this.postArmory();
        return;
      case 'resetClass':
        await this.deps.armory.resetClass(request);
        this.postArmory();
        return;
      case 'writeRecolor':
        await this.deps.armory.writeRecolor(request);
        this.postArmory();
        return;
      case 'resetRecolor':
        await this.deps.armory.resetRecolor(request);
        this.postArmory();
        return;
      case 'checkAgents':
        // Each agent's answer goes out as soon as it has one.
        await Promise.all(
          request.agents.map(async (agent) => {
            const check = await this.deps.agentChecks.check({
              agent,
              force: request.force ?? false,
            });
            this.post({ channel: 'host', type: 'agentCheck', check });
          }),
        );
        return;
      case 'signInAgent': {
        const terminal = this.deps.agentChecks.signIn(request.agent);
        if (terminal) this.deps.openTerminal(terminal);
        return;
      }
    }
  }

  private postPacks(): void {
    this.post({
      channel: 'host',
      type: 'packs',
      packs: this.deps.packs.list(),
      active: this.deps.activePack(),
    });
  }

  private postCouncil(): void {
    this.post({ channel: 'host', type: 'councilSettings', council: this.deps.council.view() });
  }

  private postArmory(): void {
    this.post({ channel: 'host', type: 'armory', armory: this.deps.armory.view() });
  }

  private postRules(): void {
    this.post({ channel: 'host', type: 'settings', rules: this.deps.settings.rules() });
  }

  private post(event: HostEvent): void {
    this.deps.post(event);
  }
}

/**
 * The file the webview asked to open, if it's inside the workspace or one of the allowed folders (the
 * webview is untrusted, #179): relative paths are the workspace's. Null otherwise.
 */
export function openablePath({
  path,
  workspace,
  roots,
}: {
  path: string;
  workspace: string | undefined;
  roots: readonly string[];
}): string | null {
  const absolute = isAbsolute(path) ? resolve(path) : workspace ? resolve(workspace, path) : null;
  if (!absolute) return null;
  const inside = (root: string) => {
    const r = relative(resolve(root), absolute);
    return r !== '' && !r.startsWith('..') && !isAbsolute(r);
  };
  return [...(workspace ? [workspace] : []), ...roots].some(inside) ? absolute : null;
}
