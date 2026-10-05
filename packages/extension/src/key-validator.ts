import Anthropic from '@anthropic-ai/sdk';
import type { KeyValidator } from './key-validator.types';

export const KEY_REJECTED = 'Anthropic rejected that key. Check it and paste it again.';
export const ANTHROPIC_UNREACHABLE = "Couldn't reach Anthropic to check the key. Try again.";

/**
 * Checks a key with the cheapest authenticated call there is, listing one model; it spends no tokens.
 * `fetch` is for tests.
 */
export function anthropicKeyValidator(options: { fetch?: typeof fetch } = {}): KeyValidator {
  return async (key) => {
    const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 10_000, ...options });
    try {
      await client.models.list({ limit: 1 });
      return { ok: true };
    } catch (e) {
      if (
        e instanceof Anthropic.AuthenticationError ||
        e instanceof Anthropic.PermissionDeniedError
      ) {
        return { ok: false, reason: KEY_REJECTED };
      }
      return { ok: false, reason: ANTHROPIC_UNREACHABLE };
    }
  };
}
