import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkVerdict, type ReviewEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';

// A live check of a reviewer (#138): Ibitsa's built-in Security councillor reviews a planted XSS on
// Haiku. Spends up to $0.10, so it only runs on request:
//   IBITSA_SMOKE=1 pnpm exec vitest run --project @ibitsa/agent-claude-sdk review-smoke
// The events are written to <tmpdir>/ibitsa-review-smoke.json.
const DIFF = `diff --git a/src/greet.ts b/src/greet.ts
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,4 @@
 export function greet(root: HTMLElement, name: string): void {
-  root.textContent = 'Hello';
+  // Show the visitor's name, straight from the query string.
+  root.innerHTML = \`Hello, \${name}!\`;
 }
`;

describe.skipIf(process.env.IBITSA_SMOKE !== '1')('live review (smoke)', () => {
  it('asks for changes on an unescaped name, and the verdict passes the check', async () => {
    const repo = join(__dirname, '..', '..', '..', '..');
    const adapter = new ClaudeAdapter({
      env: () => ({ ...process.env }),
      pluginDirs: () => [join(repo, 'packages', 'extension', 'plugin')],
    });
    const events: ReviewEvent[] = [];
    await new Promise<void>((resolve) => {
      const session = adapter.startReview(
        {
          cwd: repo,
          councillorId: 'security',
          model: 'haiku',
          maxBudgetMicroUsd: 100_000,
          round: 1,
          diff: DIFF,
          task: { title: 'Greet the visitor by name', description: 'Read ?name= and greet them.' },
          criteria: ['Text from the visitor is never rendered as HTML'],
          decisions: [],
          checks: [{ command: 'pnpm test', ok: true, output: '' }],
        },
        (event) => {
          events.push(event);
          if (event.type === 'verdictSubmitted') {
            const ruled = checkVerdict({ input: event.verdict, decisions: [] });
            session.completeTool({
              toolUseId: event.toolUseId,
              accepted: ruled.ok,
              ...(ruled.ok ? {} : { reason: ruled.problems.join('; ') }),
            });
            // Closed at once, as the runtime does: the cost must still arrive.
            if (ruled.ok) session.close();
          }
          if (event.type === 'usage' || event.type === 'error') resolve();
        },
      );
    });
    writeFileSync(join(tmpdir(), 'ibitsa-review-smoke.json'), JSON.stringify(events, null, 2));
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.at(-1)?.type).toBe('usage');
    const filed = events.findLast((e) => e.type === 'verdictSubmitted');
    expect(filed?.type === 'verdictSubmitted' && filed.verdict.verdict).toBe('changes');
  }, 300_000);
});
