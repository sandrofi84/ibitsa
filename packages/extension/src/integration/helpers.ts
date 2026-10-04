import * as vscode from 'vscode';
import type { GameDiagnostics } from '../game-panel';

export async function openGameAndWait(
  predicate: (d: GameDiagnostics) => boolean,
): Promise<GameDiagnostics> {
  await vscode.commands.executeCommand('ibitsa.openGame');
  return waitForDiagnostics(predicate);
}

export async function waitForDiagnostics(
  predicate: (d: GameDiagnostics) => boolean,
): Promise<GameDiagnostics> {
  const deadline = Date.now() + 20_000;
  let last: GameDiagnostics | undefined;
  while (Date.now() < deadline) {
    last = await vscode.commands.executeCommand<GameDiagnostics | undefined>(
      'ibitsa.internal.diagnostics',
    );
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`game did not report in time; last diagnostics: ${JSON.stringify(last)}`);
}
