import type { ReviewGuidance, ReviewStart } from './ports.types';

/**
 * What every reviewer is told before its brief (spec §5.5, #138), whatever agent it runs on: the Claude
 * adapter appends it to the system prompt (the same for every review, so it caches, §10); an ACP agent
 * has none, so it opens the first message (#201).
 */
export const REVIEW_INSTRUCTIONS = `You are one of Ibitsa's councillors, reviewing a hero's work on one task. You only read: never edit files or run commands.

Review the diff you are given against your acceptance criteria and your field (your guidance is in the first message). Read the files around the diff only where you must.

Then call submit_verdict once:
- verdict: pass, or changes when something must be fixed before this task is done.
- findings: blocking findings say why they block: the acceptance criterion they fail, copied word for word, or a kind (bug, security, or breaks: something that worked no longer does). Anything else is a suggestion. Give the file and line when you can, and say plainly what to fix.
- You may not block on a choice the plan's Book of Decisions records. If you think one should be reconsidered, file a suggestion with revisit set to its id (e.g. D3); the user decides.

Keep findings few and concrete. If submit_verdict rejects your verdict, fix what it says and call it again.`;

/**
 * A reviewer's first message (§5.5): who reviews, with its skill's guidance, against what, and the
 * work itself; from round 2 only what changed since its last review.
 */
export function reviewBrief({
  start,
  guidance,
}: {
  start: ReviewStart;
  guidance: ReviewGuidance | null;
}): string {
  const list = (items: string[], empty: string) =>
    items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : empty;
  const parts = [
    `You are ${start.councillorId}${guidance ? ` (${guidance.title})` : ''}, reviewing round ${start.round} of this task.\n\n${guidance?.guidance ?? '(No skill file found: review from your name and the criteria.)'}`,
    `The task: ${start.task.title}\n${start.task.description}`,
    `Your acceptance criteria for it:\n${list(start.criteria, '(none: review for bugs, security and things that broke)')}`,
    `Decisions already taken (don't block on these):\n${list(
      start.decisions.map((d) => `${d.id} ${d.title}: ${d.chosen}. ${d.why}`),
      '(none)',
    )}`,
    `The checks:\n${list(
      start.checks.map((c) => `\`${c.command}\`: ${c.ok ? 'passed' : `failed\n${c.output}`}`),
      '(none ran)',
    )}`,
    `${start.round > 1 ? 'What changed since your last review' : "The task's changes"}:\n\n${start.diff || '(empty diff)'}`,
  ];
  return parts.join('\n\n---\n\n');
}
