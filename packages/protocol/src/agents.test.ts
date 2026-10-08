import { describe, expect, it } from 'vitest';
import { AGENT_PRESETS, agentName, CODEX_CONFIG, resolveAgents } from './agents';

describe('resolveAgents (§11.5, #198)', () => {
  it('is the presets without settings, Codex with the sandbox profile the spike measured', () => {
    expect(resolveAgents(undefined)).toEqual(AGENT_PRESETS);
    expect(resolveAgents({}).map((a) => `${a.id}: ${[a.command, ...a.args].join(' ')}`)).toEqual([
      'codex: codex-acp',
      'copilot: copilot --acp',
      'opencode: opencode acp',
      'antigravity: agy_acp_server.par',
      'gemini: gemini --acp',
    ]);
    expect(resolveAgents({}).find((a) => a.id === 'codex')).toMatchObject({
      stateFolders: ['~/.codex'],
      domains: ['chatgpt.com', '*.oaiusercontent.com'],
      weakerNetworkIsolation: true,
      sandboxedMode: 'agent-full-access',
    });
  });

  it('starts Codex without its ChatGPT connectors (#214)', () => {
    const codex = resolveAgents({}).find((a) => a.id === 'codex');
    expect(JSON.parse(codex?.env.CODEX_CONFIG ?? '{}')).toEqual({ features: { apps: false } });
  });

  it('overrides a preset field by field and adds agents with a command', () => {
    const agents = resolveAgents({
      codex: {
        env: { CODEX_HOME: '/tmp/codex' },
        prices: { inputPerMillion: 1, outputPerMillion: 8 },
      },
      gemini: { command: '/opt/gemini/bin/gemini' },
      local: { name: 'Local model', command: 'my-agent', args: ['--acp'], domains: ['localhost'] },
      nameless: { args: ['--acp'] },
    });
    expect(agents.find((a) => a.id === 'codex')).toEqual({
      ...AGENT_PRESETS[0],
      // The preset's own settings stay: a user's env adds to them.
      env: { CODEX_CONFIG, CODEX_HOME: '/tmp/codex' },
      prices: { inputPerMillion: 1, outputPerMillion: 8 },
    });
    expect(agents.find((a) => a.id === 'gemini')).toMatchObject({
      command: '/opt/gemini/bin/gemini',
      args: ['--acp'],
      preset: true,
    });
    expect(agents.at(-1)).toEqual({
      id: 'local',
      name: 'Local model',
      command: 'my-agent',
      args: ['--acp'],
      env: {},
      stateFolders: [],
      domains: ['localhost'],
      preset: false,
    });
    // An added agent needs a command to run.
    expect(agents.map((a) => a.id)).not.toContain('nameless');
  });

  it('knows how to sign in to each preset, and takes a sign-in command from the setting (#199)', () => {
    expect(resolveAgents({}).map((a) => `${a.id}: ${a.signIn}`)).toEqual([
      'codex: codex login',
      'copilot: copilot',
      'opencode: opencode auth login',
      'antigravity: agy',
      'gemini: gemini',
    ]);
    const agents = resolveAgents({
      codex: { signIn: 'codex login --device-auth' },
      local: { command: 'my-agent', signIn: 'my-agent auth' },
      bare: { command: 'bare-agent' },
    });
    expect(agents.find((a) => a.id === 'codex')?.signIn).toBe('codex login --device-auth');
    expect(agents.find((a) => a.id === 'local')?.signIn).toBe('my-agent auth');
    expect(agents.find((a) => a.id === 'bare')).not.toHaveProperty('signIn');
  });

  it('drops an entry that does not check out, keeping the rest', () => {
    const agents = resolveAgents({
      Bad: { command: 'x' },
      broken: { command: 42 },
      mine: { command: 'mine-acp' },
    });
    expect(agents.map((a) => a.id)).toEqual([...AGENT_PRESETS.map((a) => a.id), 'mine']);
    expect(resolveAgents('nonsense')).toEqual(AGENT_PRESETS);
  });

  it('refuses Claude over ACP, keeping the entry so the Armory can say why (§11.6)', () => {
    const agents = resolveAgents({
      cc: { command: 'npx', args: ['@agentclientprotocol/claude-agent-acp@0.87.0'] },
      old: { command: 'claude-code-acp' },
      claude: { command: 'anything' },
    });
    expect(agents.find((a) => a.id === 'cc')?.refused).toBe(
      "Claude runs only through Ibitsa's own Claude adapter, not over ACP.",
    );
    expect(agents.find((a) => a.id === 'old')?.refused).toBeDefined();
    expect(agents.find((a) => a.id === 'claude')?.refused).toBe(
      'The id "claude" is the native Claude adapter.',
    );
    expect(resolveAgents({}).every((a) => a.refused === undefined)).toBe(true);
  });

  it('names agents for the class lists', () => {
    expect(agentName('claude')).toBe('Claude');
    expect(agentName('copilot')).toBe('Copilot CLI');
    expect(agentName('mine')).toBe('Mine');
  });
});
