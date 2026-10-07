import type { HostEvent, HostRequest, RuleKey, SettingView } from '@ibitsa/protocol';

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
