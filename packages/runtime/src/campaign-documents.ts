import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CodePointer, ResearchBrief } from '@ibitsa/protocol';

/**
 * A campaign's documents in the workspace repository (spec §8.3): `.ibitsa/campaigns/<id>/`. Ibitsa
 * writes them for people to read and keep, but never commits them; the user decides.
 */
export class CampaignDocuments {
  constructor(private readonly repoDir: string) {}

  /** `brief.json` for Ibitsa, `brief.md` for people (#101). Returns the folder. */
  saveBrief({ campaignId, brief }: { campaignId: string; brief: ResearchBrief }): string {
    const dir = join(this.repoDir, '.ibitsa', 'campaigns', campaignId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'brief.json'), `${JSON.stringify(brief, null, 2)}\n`);
    writeFileSync(join(dir, 'brief.md'), briefMarkdown(brief));
    return dir;
  }
}

/** The research brief as markdown, in the brief's fixed order (spec §4.1). */
export function briefMarkdown(brief: ResearchBrief): string {
  const pointer = (p: CodePointer) => `- \`${p.path}${p.lines ? `:${p.lines}` : ''}\`: ${p.note}`;
  const list = (items: string[]) => (items.length > 0 ? items : ['- (none)']);
  const lines = [
    '# Research brief',
    '',
    brief.task,
    '',
    '## Files',
    ...list(brief.files.map(pointer)),
    '',
    '## Findings',
    ...list(brief.findings.map((f) => `- ${f}`)),
    '',
    '## Recommended councillors',
    ...list(brief.councillors.map((c) => `- **${c.councillorId}**: ${c.reason}`)),
    '',
    `**Effort (round table):** ${brief.effort.level}. ${brief.effort.reason}`,
    '',
    '**Effort per councillor (separate chambers):**',
    ...list(brief.councillorEfforts.map((e) => `- ${e.councillorId}: ${e.level}. ${e.reason}`)),
    '',
    '## Field slices',
  ];
  for (const slice of brief.slices) {
    lines.push('', `### ${slice.councillorId}`, '', slice.summary, ...slice.pointers.map(pointer));
  }
  if (brief.slices.length === 0) lines.push('- (none)');
  lines.push(
    '',
    '## Quick quest?',
    `${brief.quickQuest.recommended ? 'Yes' : 'No'}. ${brief.quickQuest.reason}`,
    '',
  );
  return lines.join('\n');
}
