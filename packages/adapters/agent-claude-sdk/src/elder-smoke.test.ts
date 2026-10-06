import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElderEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';

// A live check of the elder (#101) on this repository with Ibitsa's real built-in councillors. Spends
// up to $0.25 on Haiku, so it only runs on request:
//   IBITSA_SMOKE=1 pnpm exec vitest run --project @ibitsa/agent-claude-sdk elder-smoke
// The events, brief and cost are written to <tmpdir>/ibitsa-elder-smoke.json.
describe.skipIf(process.env.IBITSA_SMOKE !== '1')('live elder research (smoke)', () => {
  it('researches a small task in this repository and files a valid brief', async () => {
    const repo = join(__dirname, '..', '..', '..', '..');
    const adapter = new ClaudeAdapter({
      env: () => ({ ...process.env }),
      pluginDirs: () => [join(repo, 'packages', 'extension', 'plugin')],
    });
    const councillors = await adapter.listCouncillors({ cwd: repo });
    const events: ElderEvent[] = [];
    await new Promise<void>((resolve) => {
      const session = adapter.startElder(
        {
          cwd: repo,
          task: 'Make scripts/coverage-summary.mjs also print a total row across all packages.',
          councillors,
          model: 'haiku',
          maxBudgetMicroUsd: 250_000,
        },
        (event) => {
          events.push(event);
          if (event.type === 'briefSubmitted' || event.type === 'error') {
            // Let the result's usage arrive, as the runtime would before closing.
            setTimeout(() => {
              session.close();
              resolve();
            }, 3_000);
          }
        },
      );
    });
    // Kept for reading afterwards: the test runner hides console output.
    writeFileSync(join(tmpdir(), 'ibitsa-elder-smoke.json'), JSON.stringify(events, null, 2));
    expect(events[0]?.type).toBe('sessionStarted');
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    const brief = events.find((e) => e.type === 'briefSubmitted');
    expect(
      brief?.type === 'briefSubmitted' && brief.brief.files.map((f) => f.path).join(' '),
    ).toContain('coverage-summary');
  }, 300_000);
});
