import type { HostEvent, HostRequest, PackView, RuleKey, SettingView } from '@ibitsa/protocol';

/** The files the standalone build's worktree pretends to hold, for @ references (#83). */
export const DEMO_FILES = [
  'README.md',
  'package.json',
  'src/app.ts',
  'src/auth/login.ts',
  'src/auth/redirect.ts',
  'test/auth/redirect.test.ts',
];

/**
 * The extension's host channel, faked for the standalone build (#37): credentials are ready unless the
 * page says otherwise; a key is accepted if it starts with `sk-ant-` and isn't `sk-ant-bad`.
 */
export class FakeHostChannel {
  readonly requests: HostRequest[] = [];
  private ready: boolean;
  private readonly listeners: ((event: HostEvent) => void)[] = [];
  /** The Guild Hall's rules (#179), as VS Code would hold them, at each layer. */
  private readonly rules: SettingView[] = DEMO_RULES.map((r) => ({ ...r }));
  /** The pack in use (#183). */
  private activePack = 'default';

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
      case 'openSettings':
      case 'openFile':
        return;
      case 'readSettings':
        this.emitRules();
        return;
      case 'readPacks':
        this.emitPacks();
        return;
      case 'usePack': {
        const pack = DEMO_PACKS.find((p) => p.id === request.id);
        if (!pack || pack.errors.length > 0) return;
        this.activePack = pack.id;
        // The demo's "retro" pack is the default's files under another name: enough to see a switch.
        this.emit({
          channel: 'host',
          type: 'packChanged',
          base: pack.id === 'default' ? null : '/pack/',
        });
        this.emitPacks();
        return;
      }
      case 'writeSetting':
      case 'resetSetting': {
        const rule = this.rules.find((r) => r.key === request.key);
        if (!rule) return;
        const value = request.type === 'writeSetting' ? request.value : undefined;
        if (value === undefined) delete rule[request.layer];
        else rule[request.layer] = value;
        rule.layer =
          rule.workspace !== undefined ? 'workspace' : rule.user !== undefined ? 'user' : 'default';
        rule.value = rule.workspace ?? rule.user ?? rule.defaultValue;
        this.emitRules();
        return;
      }
    }
  }

  /** Plays an event the extension would send, e.g. from the Command Palette (tests, #87). */
  send(event: HostEvent): void {
    this.emit(event);
  }

  private emitPacks(): void {
    this.emit({ channel: 'host', type: 'packs', packs: DEMO_PACKS, active: this.activePack });
  }

  private emitRules(): void {
    this.emit({ channel: 'host', type: 'settings', rules: this.rules.map((r) => ({ ...r })) });
  }

  private emit(event: HostEvent): void {
    queueMicrotask(() => {
      for (const l of this.listeners) l(event);
    });
  }
}

/** The Rule book as a fresh VS Code would show it: defaults everywhere, the loop limit set by you. */
const rule = (r: Omit<SettingView, 'value' | 'layer'> & { key: RuleKey }): SettingView => ({
  ...r,
  value: r.workspace ?? r.user ?? r.defaultValue,
  layer: r.workspace !== undefined ? 'workspace' : r.user !== undefined ? 'user' : 'default',
});
const DEMO_RULES: SettingView[] = [
  rule({
    key: 'review.loopLimit',
    description: 'Review rounds before a task that keeps getting blocking findings comes to you.',
    kind: 'integer',
    nullable: false,
    minimum: 1,
    defaultValue: 3,
    user: 4,
  }),
  rule({
    key: 'checks',
    description: 'Commands run as checks when a hero submits a task.',
    kind: 'list',
    nullable: true,
    defaultValue: null,
  }),
  rule({
    key: 'parties.maxParallel',
    description: 'How many parties work at the same time.',
    kind: 'integer',
    nullable: false,
    minimum: 1,
    defaultValue: 2,
  }),
  rule({
    key: 'hero.budgetUsd',
    description: "A hero's gold pouch in US dollars.",
    kind: 'number',
    nullable: true,
    defaultValue: null,
  }),
  rule({
    key: 'council.mode',
    description: 'How the council sits when you convene it.',
    kind: 'choice',
    choices: ['ask', 'roundTable', 'chambers'],
    nullable: false,
    defaultValue: 'ask',
  }),
  rule({
    key: 'worktree.setup',
    description: 'A command run in each new worktree before the hero starts.',
    kind: 'text',
    nullable: false,
    defaultValue: '',
  }),
];

/** The packs a fresh setup might find (#183): the default, one of yours, and a project's that's broken. */
const DEMO_PACKS: PackView[] = [
  { id: 'default', name: 'Default', scope: 'builtin', errors: [], preview: null },
  {
    id: 'user:retro',
    name: 'retro',
    scope: 'user',
    errors: [],
    preview: {
      sheet: '/pack/characters/hero-paladin.png',
      frameWidth: 16,
      frameHeight: 16,
      row: 1,
      frames: 4,
      fps: 8,
    },
  },
  {
    id: 'project:half-done',
    name: 'half-done',
    scope: 'project',
    errors: ['characters: missing "hero.ranger"', 'map/tiles.png: 64×16, expected 96×16'],
    preview: null,
  },
];
