import { writeFileSync } from 'node:fs';
import { CampaignStore, CouncilTallies } from '@ibitsa/runtime';
import * as vscode from 'vscode';
import type { ExportTalliesArgs } from './export-tallies.types';

/**
 * "Ibitsa: Export Council Tallies" (spec §4.10, #106): every sitting in this workspace's campaigns, with
 * what it cost and produced and its rating, as JSON or CSV, to compare how the council sits.
 */
export async function exportTallies({
  storageDir,
  workspaceDir,
  args,
}: {
  storageDir: string | undefined;
  workspaceDir: string | undefined;
  args?: ExportTalliesArgs | undefined;
}): Promise<string | undefined> {
  const tallies = storageDir ? new CouncilTallies(new CampaignStore(storageDir)) : null;
  if (!tallies || !workspaceDir || tallies.all().length === 0) {
    void vscode.window.showInformationMessage(
      'The council has not sat yet: there is nothing to export.',
    );
    return undefined;
  }
  const format = args?.format ?? (await askFormat());
  if (!format) return undefined;
  const target =
    args?.target ??
    (
      await vscode.window.showSaveDialog({
        title: 'Export Council Tallies',
        defaultUri: vscode.Uri.joinPath(vscode.Uri.file(workspaceDir), `council-tallies.${format}`),
        filters: format === 'csv' ? { CSV: ['csv'] } : { JSON: ['json'] },
      })
    )?.fsPath;
  if (!target) return undefined;
  writeFileSync(target, format === 'csv' ? tallies.csv() : tallies.json());
  if (!args) void vscode.window.showTextDocument(vscode.Uri.file(target));
  return target;
}

async function askFormat(): Promise<'json' | 'csv' | undefined> {
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: 'CSV',
        description: 'One row per sitting, for a spreadsheet',
        format: 'csv' as const,
      },
      {
        label: 'JSON',
        description: 'Everything, including tokens per model',
        format: 'json' as const,
      },
    ],
    { title: 'Export Council Tallies' },
  );
  return choice?.format;
}
