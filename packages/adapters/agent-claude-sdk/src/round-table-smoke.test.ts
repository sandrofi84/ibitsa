import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CouncilEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';

// A live round table (#103) on this repository with two real built-in councillors, at Light effort
// (Haiku, $0.50 cap). It plays core's part: accepts every call, answers with each question's
// recommendation (or its first option), and stops once a plan is proposed. Only runs on request:
//   IBITSA_SMOKE=1 pnpm exec vitest run --project @ibitsa/agent-claude-sdk round-table-smoke
// The events are written to <tmpdir>/ibitsa-round-table-smoke.json.
describe.skipIf(process.env.IBITSA_SMOKE !== '1')('live round table (smoke)', () => {
  it('reports for every councillor, asks, hears the answers and proposes a plan', async () => {
    const repo = join(__dirname, '..', '..', '..', '..');
    const adapter = new ClaudeAdapter({
      env: () => ({ ...process.env }),
      pluginDirs: () => [join(repo, 'packages', 'extension', 'plugin')],
    });
    const events: CouncilEvent[] = [];
    await new Promise<void>((resolve) => {
      const session = adapter.startSitting(
        {
          cwd: repo,
          mode: 'roundTable',
          task: 'Make scripts/coverage-summary.mjs also print a total row across all packages.',
          brief: null,
          roster: [
            { councillorId: 'architect', effort: 'light' },
            { councillorId: 'tester', effort: 'light' },
          ],
          model: 'haiku',
          maxBudgetMicroUsd: 500_000,
        },
        (event) => {
          events.push(event);
          const finish = () =>
            setTimeout(() => {
              session.close();
              resolve();
            }, 3_000);
          if (event.type === 'reportFiled')
            session.completeTool({ toolUseId: event.toolUseId, accepted: true });
          if (event.type === 'questionsAsked') {
            session.completeTool({ toolUseId: event.toolUseId, accepted: true });
            session.answer({
              toolUseId: event.toolUseId,
              answers: event.questions.map((q) =>
                q.options.length > 0
                  ? { optionId: q.recommendation?.optionId ?? q.options[0]?.id ?? '' }
                  : { text: 'Keep it simple.' },
              ),
            });
          }
          if (event.type === 'planProposed') {
            session.completeTool({ toolUseId: event.toolUseId, accepted: true });
            finish();
          }
          if (event.type === 'error') finish();
        },
      );
    });
    writeFileSync(join(tmpdir(), 'ibitsa-round-table-smoke.json'), JSON.stringify(events, null, 2));
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    const reported = events.flatMap((e) => (e.type === 'reportFiled' ? [e.councillorId] : []));
    expect(new Set(reported)).toEqual(new Set(['architect', 'tester']));
    expect(events.some((e) => e.type === 'planProposed')).toBe(true);
  }, 600_000);
});
