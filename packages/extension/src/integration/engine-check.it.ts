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

  test('the game re-scales when the panel grows and shrinks', async () => {
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
    const doc = await vscode.workspace.openTextDocument({ content: '' });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    const small = await waitForDiagnostics((d) => d.ready && d.zoom < big.zoom);
    for (const d of [big, small]) {
      assert.deepEqual(d.canvas, { width: 480 * d.zoom, height: 270 * d.zoom });
    }
    assert.deepEqual(small.cspViolations, []);
  });
});
