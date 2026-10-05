import { describe, expect, it } from 'vitest';
import { API_KEY_SECRET, resolveCredentials } from './credentials';

const secrets = (stored?: string) => ({
  get: async (key: string) => (key === API_KEY_SECRET ? stored : undefined),
});

describe('resolveCredentials', () => {
  it('prefers the stored key', async () => {
    expect(
      await resolveCredentials(secrets(' sk-stored '), { ANTHROPIC_API_KEY: 'sk-env' }),
    ).toEqual({
      source: 'secret',
      apiKey: 'sk-stored',
    });
  });

  it('falls back to the environment key', async () => {
    expect(await resolveCredentials(secrets(), { ANTHROPIC_API_KEY: 'sk-env' })).toEqual({
      source: 'environment',
      apiKey: 'sk-env',
    });
  });

  it('passes a cloud provider through', async () => {
    expect(await resolveCredentials(secrets(), { CLAUDE_CODE_USE_BEDROCK: '1' })).toEqual({
      source: 'provider',
      provider: 'bedrock',
    });
  });

  it('reports when there are no credentials', async () => {
    expect(await resolveCredentials(secrets('  '), {})).toEqual({ source: 'none' });
  });
});
