import * as vscode from 'vscode';
import { GAME_VIEW_TYPE, GamePanel } from './game-panel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ibitsa.openGame', () => GamePanel.show(context.extensionUri)),
    // Not contributed to the Command Palette: lets integration tests read the engine-check diagnostics.
    vscode.commands.registerCommand('ibitsa.internal.diagnostics', () => GamePanel.lastDiagnostics),
    vscode.window.registerWebviewPanelSerializer(GAME_VIEW_TYPE, {
      async deserializeWebviewPanel(panel) {
        GamePanel.revive(panel, context.extensionUri);
      },
    }),
  );
}

export function deactivate(): void {}
