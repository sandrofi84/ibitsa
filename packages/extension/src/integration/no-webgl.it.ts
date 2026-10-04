import * as assert from 'node:assert/strict';
import { openGameAndWait } from './helpers';

suite('without WebGL (#13)', () => {
  test('the panel shows the notice instead of the game', async () => {
    const d = await openGameAndWait((d) => d.renderer === 'none');
    assert.equal(d.ready, false);
    assert.deepEqual(d.cspViolations, []);
  });
});
