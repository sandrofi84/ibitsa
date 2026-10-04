import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { openGameAndWait, waitForDiagnostics } from './helpers';

suite('engine check (#13)', () => {
  test('the game panel renders with WebGL, integer zoom and no CSP violations', async () => {
    const d = await openGameAndWait((d) => d.ready);
    assert.equal(d.renderer, 'webgl');
    assert.ok(Number.isInteger(d.zoom) && d.zoom >= 1, `zoom ${d.zoom}`);
    assert.deepEqual(d.canvas, { width: 480 * d.zoom, height: 270 * d.zoom });
    // give late resource loads a moment to trip the CSP
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(d.cspViolations, []);
  });

  // Shrinking is covered deterministically by the standalone Playwright test; splitting editors
  // here depends on window-manager timing and was flaky.
  test('the game re-scales when the panel grows', async () => {
    await openGameAndWait((d) => d.ready);
    for (const command of [
      'workbench.action.closeSidebar',
      'workbench.action.closePanel',
      'workbench.action.closeAuxiliaryBar',
      'workbench.action.toggleFullScreen',
    ]) {
      await vscode.commands.executeCommand(command);
    }
    const big = await waitForDiagnostics((d) => d.ready && d.zoom >= 2);
    assert.deepEqual(big.canvas, { width: 480 * big.zoom, height: 270 * big.zoom });
    assert.deepEqual(big.cspViolations, []);
  });
});
