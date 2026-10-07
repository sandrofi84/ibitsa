import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CouncilEvent, checkAmendment, type Plan } from '@ibitsa/protocol';
import type { SittingSession, SittingStart } from '@ibitsa/runtime';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';

// A live amendment (#170) on this repository: a short round table at Light effort (Haiku) files its
// report and is closed; its lead session is resumed, told the approved plan, and asked to add a task
// with propose_amendment, which core's check must accept. Spends up to about $0.40, so it only runs
// on request:
//   IBITSA_SMOKE=1 pnpm exec vitest run --project @ibitsa/agent-claude-sdk amendment-smoke
// The events are written to <tmpdir>/ibitsa-amendment-smoke.json.
const PLAN: Plan = {
  summary: 'A total row in the coverage summary.',
  goal: 'Make scripts/coverage-summary.mjs print a total row.',
  tasks: [
    {
      id: 'T1',
      title: 'Total row',
      description: 'Print a total row across all packages.',
      files: ['scripts/coverage-summary.mjs'],
      dependsOn: [],
      criteria: [],
      decisions: [],
    },
  ],
  decisions: [],
  islands: [{ id: 'I1', title: 'Coverage summary', tasks: ['T1'] }],
  branching: 'separate',
};

describe.skipIf(process.env.IBITSA_SMOKE !== '1')('live amendment (smoke)', () => {
  it('proposes an amendment that passes core’s check', async () => {
    const repo = join(__dirname, '..', '..', '..', '..');
    const adapter = new ClaudeAdapter({
      env: () => ({ ...process.env }),
      pluginDirs: () => [join(repo, 'packages', 'extension', 'plugin')],
    });
    const base: SittingStart = {
      cwd: repo,
      mode: 'roundTable',
      task: PLAN.goal,
      brief: null,
      roster: [{ councillorId: 'tester', effort: 'light' }],
      model: 'haiku',
      maxBudgetMicroUsd: 300_000,
    };
    const events: CouncilEvent[] = [];
    const sessionId = await new Promise<string>((resolve) => {
      let id = '';
      const session: SittingSession = adapter.startSitting(base, (event) => {
        events.push(event);
        if (event.type === 'sessionStarted') id = event.sessionId;
        if (event.type === 'reportFiled') {
          session.completeTool({ toolUseId: event.toolUseId, accepted: true });
          setTimeout(() => {
            session.close();
            resolve(id);
          }, 2_000);
        }
        if (event.type === 'error') resolve(id);
      });
    });
    expect(sessionId).not.toBe('');
    const turn: CouncilEvent[] = [];
    const verdicts: string[] = [];
    await new Promise<void>((resolve) => {
      const session = adapter.startSitting(
        {
          ...base,
          maxBudgetMicroUsd: 200_000,
          resume: {
            sessionId,
            prompt: `The plan is approved and the heroes are at work. T1 has started.\n\nThe approved plan:\n${JSON.stringify(PLAN)}\n\nThe user asks tester: the total row needs its own test. Call propose_amendment adding that as a new task T2 at the end of island I1 (only work not started may change), then say why and end your turn.`,
          },
        },
        (event) => {
          turn.push(event);
          if (event.type === 'amendmentProposed') {
            const checked = checkAmendment({
              input: event.amendment,
              plan: PLAN,
              roster: ['tester'],
              started: ['T1'],
            });
            verdicts.push(checked.ok ? 'ok' : checked.problems.join('; '));
            session.completeTool({
              toolUseId: event.toolUseId,
              accepted: checked.ok,
              ...(checked.ok ? {} : { reason: checked.problems.join('\n') }),
            });
          }
          if (event.type === 'usage' || event.type === 'error') {
            session.close();
            resolve();
          }
        },
      );
    });
    writeFileSync(
      join(tmpdir(), 'ibitsa-amendment-smoke.json'),
      JSON.stringify({ sitting: events, turn, verdicts }, null, 2),
    );
    expect(turn.filter((e) => e.type === 'error')).toEqual([]);
    expect(verdicts).toContain('ok');
  }, 300_000);
});
