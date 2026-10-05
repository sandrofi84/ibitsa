import { describe, expect, it } from 'vitest';
import { agentEnvironment } from './agent-environment';

const env = { PATH: '/usr/bin', CLAUDE_CODE_USE_VERTEX: '1' };

describe('agentEnvironment', () => {
  it('passes the stored or environment key', () => {
    expect(
      agentEnvironment({
        credentials: { source: 'secret', apiKey: 'sk-1' },
        env,
        allowLogin: false,
      }),
    ).toEqual({ ...env, ANTHROPIC_API_KEY: 'sk-1' });
  });

  it('passes cloud-provider configuration through', () => {
    expect(
      agentEnvironment({
        credentials: { source: 'provider', provider: 'vertex' },
        env,
        allowLogin: false,
      }),
    ).toEqual(env);
  });

  it('refuses to start without credentials, except in development', () => {
    expect(
      agentEnvironment({ credentials: { source: 'none' }, env, allowLogin: false }),
    ).toBeNull();
    expect(agentEnvironment({ credentials: { source: 'none' }, env, allowLogin: true })).toEqual(
      env,
    );
  });
});
