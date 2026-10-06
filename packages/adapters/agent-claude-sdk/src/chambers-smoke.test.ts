import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CouncilEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';

// A live sitting in separate chambers (#105) on this repository with two real built-in councillors at
// Light effort (Haiku chambers, a Haiku elder, a $0.50 cap: two $0.10 shares plus the $0.30 reserve).
// It plays core's part: accepts every call, answers each question with its recommendation (or its
// first option), and stops once a plan is proposed. Only runs on request:
//   IBITSA_SMOKE=1 pnpm exec vitest run --project @ibitsa/agent-claude-sdk chambers-smoke
// The events are written to <tmpdir>/ibitsa-chambers-smoke.json.
describe.skipIf(process.env.IBITSA_SMOKE !== '1')('live separate chambers (smoke)', () => {
  it('each councillor reports from its own chamber, then the elder asks and proposes', async () => {
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
          mode: 'chambers',
          task: 'Make scripts/coverage-summary.mjs also print a total row across all packages.',
          brief: null,
          roster: [
            { councillorId: 'architect', effort: 'light', model: 'haiku' },
            { councillorId: 'tester', effort: 'light', model: 'haiku' },
          ],
          model: 'haiku',
          maxBudgetMicroUsd: 500_000,
        },
        (event) => {
          events.push(event);
          // Wait for the turn's result (and its cost) before closing.
          const finish = () =>
            setTimeout(() => {
              session.close();
              resolve();
            }, 15_000);
          if (event.type === 'reportFiled') {
            session.completeTool({ toolUseId: event.toolUseId, accepted: true });
          }
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
    writeFileSync(join(tmpdir(), 'ibitsa-chambers-smoke.json'), JSON.stringify(events, null, 2));
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    const reported = events.flatMap((e) => (e.type === 'reportFiled' ? [e.councillorId] : []));
    expect(new Set(reported)).toEqual(new Set(['architect', 'tester']));
    expect(events.some((e) => e.type === 'planProposed')).toBe(true);
  }, 900_000);
});
