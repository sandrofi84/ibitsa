import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CouncilEvent } from '@ibitsa/protocol';
import type { SittingSession, SittingStart } from '@ibitsa/runtime';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';

// A live question to the council mid-campaign (#169) on this repository: a short round table at
// Light effort (Haiku) files its reports, then is closed; its lead session is resumed with a question
// for the tester, which answers with say. Spends up to about $0.40, so it only runs on request:
//   IBITSA_SMOKE=1 pnpm exec vitest run --project @ibitsa/agent-claude-sdk consult-smoke
// The events are written to <tmpdir>/ibitsa-consult-smoke.json.
describe.skipIf(process.env.IBITSA_SMOKE !== '1')('live consultation (smoke)', () => {
  it('resumes the lead session and answers in the councillor’s voice', async () => {
    const repo = join(__dirname, '..', '..', '..', '..');
    const adapter = new ClaudeAdapter({
      env: () => ({ ...process.env }),
      pluginDirs: () => [join(repo, 'packages', 'extension', 'plugin')],
    });
    const base: SittingStart = {
      cwd: repo,
      mode: 'roundTable',
      task: 'Make scripts/coverage-summary.mjs also print a total row across all packages.',
      brief: null,
      roster: [{ councillorId: 'tester', effort: 'light' }],
      model: 'haiku',
      maxBudgetMicroUsd: 300_000,
    };
    const events: CouncilEvent[] = [];
    // Until the tester has reported: then the sitting is closed, as an approved one would be.
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
    const answers: CouncilEvent[] = [];
    await new Promise<void>((resolve) => {
      const session = adapter.startSitting(
        {
          ...base,
          maxBudgetMicroUsd: 200_000,
          resume: {
            sessionId,
            prompt:
              'The plan is approved and the heroes are at work.\n\nThe user asks tester, who answers in its own voice:\nShould the total row have its own test?\n\nAnswer with say, then end your turn.',
          },
        },
        (event) => {
          answers.push(event);
          if (event.type === 'usage' || event.type === 'error') {
            session.close();
            resolve();
          }
        },
      );
    });
    writeFileSync(
      join(tmpdir(), 'ibitsa-consult-smoke.json'),
      JSON.stringify({ sitting: events, consultation: answers }, null, 2),
    );
    expect(answers.filter((e) => e.type === 'error')).toEqual([]);
    expect(answers.some((e) => e.type === 'said' && e.councillorId === 'tester')).toBe(true);
  }, 300_000);
});
