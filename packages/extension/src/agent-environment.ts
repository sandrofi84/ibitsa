import type { Credentials } from './credentials.types';

/**
 * The agent process's environment (spec §11.6): the user's key when there is one; cloud-provider
 * configuration passes through untouched. Returns null when the agent must not start.
 */
export function agentEnvironment({
  credentials,
  env,
  allowLogin,
}: {
  credentials: Credentials;
  env: Record<string, string | undefined>;
  /** Development only: with no credentials, the SDK may use the developer's own Claude Code login. */
  allowLogin: boolean;
}): Record<string, string | undefined> | null {
  switch (credentials.source) {
    case 'secret':
    case 'environment':
      return { ...env, ANTHROPIC_API_KEY: credentials.apiKey };
    case 'provider':
      return { ...env };
    case 'none':
      return allowLogin ? { ...env } : null;
  }
}
