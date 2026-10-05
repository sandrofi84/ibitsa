import type { Credentials, SecretReader } from './credentials.types';

/** SecretStorage key for the user's Anthropic API key, set with "Ibitsa: Set API Key". */
export const API_KEY_SECRET = 'ibitsa.anthropicApiKey';

const PROVIDERS = [
  ['CLAUDE_CODE_USE_BEDROCK', 'bedrock'],
  ['CLAUDE_CODE_USE_VERTEX', 'vertex'],
  ['CLAUDE_CODE_USE_FOUNDRY', 'foundry'],
] as const;

/**
 * The user's own credentials, never a claude.ai login (spec §11.6): a stored key first, then the
 * environment's key, then a cloud provider configured in the environment.
 */
export async function resolveCredentials(
  secrets: SecretReader,
  env: Record<string, string | undefined>,
): Promise<Credentials> {
  const stored = (await secrets.get(API_KEY_SECRET))?.trim();
  if (stored) return { source: 'secret', apiKey: stored };
  const fromEnv = env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return { source: 'environment', apiKey: fromEnv };
  for (const [flag, provider] of PROVIDERS) {
    if (env[flag] === '1' || env[flag] === 'true') return { source: 'provider', provider };
  }
  return { source: 'none' };
}
