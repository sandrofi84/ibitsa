import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { CampaignStore, ReplayExport } from '@ibitsa/runtime';
import * as vscode from 'vscode';
import type { ExportReplayArgs } from './export-replay.types';

/**
 * "Ibitsa: Export Replay" (spec §12): writes a copy of the latest campaign log as a fixture, with paths
 * relative to the worktree and, if asked, message text blanked. Nothing is uploaded or committed.
 */
export async function exportReplay({
  storageDir,
  workspaceDir,
  args,
}: {
  storageDir: string | undefined;
  workspaceDir: string | undefined;
  args?: ExportReplayArgs | undefined;
}): Promise<string | undefined> {
  const store = storageDir ? new CampaignStore(storageDir) : null;
  const id = store?.latestId();
  if (!store || !id || !workspaceDir) {
    void vscode.window.showInformationMessage('There is no quest to export yet.');
    return undefined;
  }
  const blankMessages = args?.blankMessages ?? (await askBlank());
  if (blankMessages === undefined) return undefined;
  const target =
    args?.target ??
    (
      await vscode.window.showSaveDialog({
        title: 'Export Replay',
        defaultUri: vscode.Uri.joinPath(vscode.Uri.file(workspaceDir), `${id}.jsonl`),
        filters: { 'Ibitsa replay': ['jsonl'] },
      })
    )?.fsPath;
  if (!target) return undefined;

  const text = new ReplayExport({ repoDir: workspaceDir, homeDir: homedir(), blankMessages }).apply(
    store.read(id),
  );
  writeFileSync(target, text);
  if (!args) {
    void vscode.window
      .showInformationMessage(
        'Replay exported. Read it before sharing: commands and file names are still in it.',
        'Open',
      )
      .then((choice) => {
        if (choice === 'Open') void vscode.window.showTextDocument(vscode.Uri.file(target));
      });
  }
  return target;
}

async function askBlank(): Promise<boolean | undefined> {
  const keep = 'Keep message text';
  const blank = 'Remove message text';
  const choice = await vscode.window.showQuickPick(
    [
      { label: keep, detail: 'Everything you and the hero said stays in the replay.' },
      {
        label: blank,
        detail: 'Messages, notes and the summary are replaced; the quest keeps its title line.',
      },
    ],
    { title: 'Export Replay', placeHolder: 'Paths are made relative to the worktree either way.' },
  );
  return choice ? choice.label === blank : undefined;
}
