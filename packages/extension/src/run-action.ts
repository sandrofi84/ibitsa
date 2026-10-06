import * as vscode from 'vscode';
import { GamePanel } from './game-panel';
import type { RunActionOptions } from './run-action.types';

/**
 * "Ibitsa: Run Action…" (#87): a quick pick of the `/` actions, then their arguments, then the game
 * with `/action args` in the command bar, where its preview shows before you send.
 */
export async function runAction({ host, picked, open }: RunActionOptions): Promise<void> {
  let choice = picked;
  if (!choice) {
    const actions = host ? await host.actions() : [];
    if (actions.length === 0) {
      void vscode.window.showInformationMessage('No actions yet: start a quest first.');
      return;
    }
    const item = await vscode.window.showQuickPick(
      actions.map((a) => ({
        label: `/${a.aliases[0] ?? a.name}`,
        description: a.argumentHint,
        detail: a.description,
        action: a,
      })),
      { title: 'Run Action', placeHolder: 'Pick an action for the hero' },
    );
    if (!item) return;
    const args = item.action.argumentHint
      ? await vscode.window.showInputBox({ title: item.label, prompt: item.action.argumentHint })
      : '';
    if (args === undefined) return;
    choice = { name: item.label.slice(1), args };
  }
  open();
  GamePanel.postHost({
    channel: 'host',
    type: 'fillCommandBar',
    text: `/${choice.name} ${choice.args}`.trim(),
  });
}
