import { describe, expect, it } from 'vitest';
import { ANTHROPIC_UNREACHABLE, anthropicKeyValidator, KEY_REJECTED } from './key-validator';

const respond = (status: number) => async () =>
  new Response(
    JSON.stringify(
      status === 200
        ? { data: [], has_more: false }
        : { type: 'error', error: { type: 'x', message: 'x' } },
    ),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );

describe('anthropicKeyValidator', () => {
  it('accepts a key Anthropic accepts', async () => {
    expect(await anthropicKeyValidator({ fetch: respond(200) })('sk-ant-good')).toEqual({
      ok: true,
    });
  });

  it.each([401, 403])('rejects a key on %i', async (status) => {
    expect(await anthropicKeyValidator({ fetch: respond(status) })('sk-ant-bad')).toEqual({
      ok: false,
      reason: KEY_REJECTED,
    });
  });

  it('says when Anthropic cannot be reached', async () => {
    const offline = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await anthropicKeyValidator({ fetch: offline })('sk-ant-good')).toEqual({
      ok: false,
      reason: ANTHROPIC_UNREACHABLE,
    });
  });
});
