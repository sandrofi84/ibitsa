import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { GameDiagnostics } from '../game-panel.types';
import { openGameAndWait, waitForDiagnostics } from './helpers';

/** The canvas fills the panel at its whole-number zoom, holding at least the 480×270 world (#59). */
function assertFills(d: GameDiagnostics): void {
  assert.ok(d.canvas, 'the canvas exists');
  assert.ok(
    d.canvas.width >= 480 * d.zoom && d.canvas.height >= 270 * d.zoom,
    `canvas ${d.canvas.width}×${d.canvas.height} at zoom ${d.zoom}`,
  );
}

suite('engine check (#13)', () => {
  test('the game panel renders with WebGL, integer zoom and no CSP violations', async () => {
    const d = await openGameAndWait((d) => d.ready);
    assert.equal(d.renderer, 'webgl');
    assert.ok(Number.isInteger(d.zoom) && d.zoom >= 1, `zoom ${d.zoom}`);
    assertFills(d);
    // give late resource loads a moment to trip the CSP
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(d.cspViolations, []);
  });

  // Shrinking is covered deterministically by the standalone Playwright test; splitting editors
  // here depends on window-manager timing and was flaky.
  test('the game re-scales when the panel grows', async function () {
    // Depends on the OS's full-screen animation, which occasionally outlasts the wait.
    this.retries(2);
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
    assertFills(big);
    assert.deepEqual(big.cspViolations, []);
  });
});
