import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CampaignRecordData } from '@ibitsa/core';
import { type CodePointer, type Plan, planIslands, type ResearchBrief } from '@ibitsa/protocol';

/**
 * A campaign's documents in the workspace repository (spec §8.3): `.ibitsa/campaigns/<id>/`. Ibitsa
 * writes them for people to read and keep, but never commits them; the user decides.
 */
export class CampaignDocuments {
  constructor(private readonly repoDir: string) {}

  /** `brief.json` for Ibitsa, `brief.md` for people (#101). Returns the folder. */
  saveBrief({ campaignId, brief }: { campaignId: string; brief: ResearchBrief }): string {
    const dir = this.folder(campaignId);
    writeFileSync(join(dir, 'brief.json'), `${JSON.stringify(brief, null, 2)}\n`);
    writeFileSync(join(dir, 'brief.md'), briefMarkdown(brief));
    return dir;
  }

  /**
   * The approved plan (#104): `plan.json` for Ibitsa and `plan.md` for people, the latest approved
   * version, plus `plan-v<n>.json` so earlier approved versions are kept. Returns the folder.
   */
  savePlan({
    campaignId,
    version,
    plan,
  }: {
    campaignId: string;
    version: number;
    plan: Plan;
  }): string {
    const dir = this.folder(campaignId);
    const json = `${JSON.stringify({ version, ...plan }, null, 2)}\n`;
    writeFileSync(join(dir, 'plan.json'), json);
    writeFileSync(join(dir, `plan-v${version}.json`), json);
    writeFileSync(join(dir, 'plan.md'), planMarkdown({ version, plan }));
    return dir;
  }

  /** `record.md` at the campaign's end (§4.9, #167). Returns its path, relative to the repository. */
  saveRecord({ campaignId, record }: { campaignId: string; record: CampaignRecordData }): string {
    writeFileSync(join(this.folder(campaignId), 'record.md'), recordMarkdown(record));
    return ['.ibitsa', 'campaigns', campaignId, 'record.md'].join('/');
  }

  private folder(campaignId: string): string {
    const dir = join(this.repoDir, '.ibitsa', 'campaigns', campaignId);
    mkdirSync(dir, { recursive: true });
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

/** The plan as markdown (spec §4.5): goal, tasks in order, and the Book of Decisions as records. */
export function planMarkdown({ version, plan }: { version: number; plan: Plan }): string {
  const lines = [`# Plan v${version}`, '', plan.summary, '', '## Goal', '', plan.goal];
  if (plan.scope) lines.push('', '## Scope', '', plan.scope);
  lines.push('', '## Tasks');
  for (const t of plan.tasks) {
    lines.push('', `### ${t.id} · ${t.title}`, '', t.description);
    if (t.dependsOn.length > 0) lines.push('', `**Depends on:** ${t.dependsOn.join(', ')}`);
    if (t.heroClass) lines.push('', `**Suggested hero:** ${t.heroClass}`);
    if (t.files.length > 0)
      lines.push('', '**Files likely touched:**', ...t.files.map((f) => `- \`${f}\``));
    for (const c of t.criteria) {
      lines.push(
        '',
        `**Acceptance criteria (${c.councillorId}):**`,
        ...c.items.map((i) => `- ${i}`),
      );
    }
    if (t.decisions.length > 0) lines.push('', `**Decisions:** ${t.decisions.join(', ')}`);
  }
  if (plan.islands) {
    const { islands, branching } = planIslands(plan);
    lines.push('', `## Islands (${branching})`, '');
    for (const island of islands)
      lines.push(`- **${island.id} · ${island.title}:** ${island.tasks.join(', ')}`);
  }
  lines.push('', '## Book of Decisions');
  if (plan.decisions.length === 0) lines.push('', '(none)');
  for (const d of plan.decisions) {
    lines.push('', `### ${d.id} · ${d.title} (raised by ${d.raisedBy})`, `**Chosen:** ${d.chosen}`);
    if (d.alternatives.length > 0) {
      lines.push(
        `**Alternatives:** ${d.alternatives.map((a) => `${a.option}. Rejected: ${a.rejectedBecause}`).join(' ')}`,
      );
    }
    if (d.tradeoffs) lines.push(`**Trade-offs accepted:** ${d.tradeoffs}`);
    lines.push(`**Why:** ${d.why}`);
    if (d.discussion) lines.push(`**Discussion:** ${d.discussion}`);
    if (d.affects.length > 0) lines.push(`**Affects tasks:** ${d.affects.join(', ')}`);
    if (d.supersedes) lines.push(`**Supersedes:** ${d.supersedes}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Micro-dollars as dollars, e.g. `$1.23`. */
function dollars(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

/**
 * The campaign record as markdown (§4.9, #167): what was decided and shipped, what was deferred, what
 * it cost, how the council sat, and the elder's lessons.
 */
export function recordMarkdown(record: CampaignRecordData): string {
  const lines = [`# Campaign record: ${record.title}`, ''];
  lines.push(record.status === 'abandoned' ? '**Abandoned.**' : '**Finished.**');
  if (record.summary) lines.push('', record.summary);
  lines.push('', '## What shipped');
  for (const island of record.islands) {
    const pr = island.pullRequest;
    const done = island.tasks.filter((t) => t.state === 'done' || t.state === 'doneUnreviewed');
    lines.push(
      '',
      `### ${island.name} (\`${island.branch}\`)`,
      '',
      pr ? `Pull request [#${pr.number}](${pr.url}): ${pr.state}.` : 'No pull request.',
      ...island.tasks.map((t) => `- [${done.includes(t) ? 'x' : ' '}] ${t.title}`),
    );
  }
  if (record.islands.length === 0) lines.push('', '(nothing: no island was started)');
  lines.push('', '## Decisions');
  if (record.decisions.length === 0) lines.push('', '(none)');
  for (const d of record.decisions)
    lines.push('', `- **${d.id} ${d.title}:** ${d.chosen}. ${d.why}`);
  const { unfinished, suggestions, revisits } = record.deferred;
  lines.push('', '## Deferred');
  if (unfinished.length + suggestions.length + revisits.length === 0) lines.push('', '(nothing)');
  if (unfinished.length > 0)
    lines.push('', '**Unfinished tasks:**', ...unfinished.map((t) => `- ${t}`));
  if (suggestions.length > 0) {
    lines.push(
      '',
      '**Suggestions kept for later:**',
      ...suggestions.map((f) => {
        const where = f.file ? ` (\`${f.file}${f.line ? `:${f.line}` : ''}\`)` : '';
        return `- ${f.councillorId}${where}: ${f.message}`;
      }),
    );
  }
  if (revisits.length > 0) {
    lines.push(
      '',
      '**Decisions a reviewer asked to revisit (dismissed):**',
      ...revisits.map((r) => `- ${r.decisionId}, ${r.councillorId}: ${r.message}`),
    );
  }
  lines.push('', '## Gold', '');
  lines.push(
    record.gold.kind === 'unknown'
      ? 'Unknown: some of the work never reported its cost.'
      : `${dollars(record.gold.value)}${record.gold.kind === 'estimated' ? ' (estimated)' : ''}`,
  );
  if (record.tallies.length > 0) {
    lines.push('', '## The council');
    for (const t of record.tallies) {
      const cost = t.cost.totalMicroUsd === null ? 'cost unknown' : dollars(t.cost.totalMicroUsd);
      const minutes = t.durationMs === null ? '' : `, ${Math.round(t.durationMs / 60_000)} min`;
      const mode = t.mode === 'roundTable' ? 'Round table' : 'Separate chambers';
      lines.push(
        '',
        `- ${mode}, ${t.effort} effort: ${t.outcome}, ${cost}${minutes}; ${t.roster.map((r) => r.councillorId).join(', ')}.`,
      );
    }
  }
  if (record.lessons && record.lessons.length > 0) {
    lines.push('', '## Lessons', '', ...record.lessons.map((l) => `- ${l}`));
  }
  lines.push('');
  return lines.join('\n');
}
