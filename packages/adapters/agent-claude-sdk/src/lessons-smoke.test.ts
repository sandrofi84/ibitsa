import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LessonsEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';

// A live check of the elder's lessons (#167) from a made-up campaign's reviews, on Haiku. Spends up to
// $0.05, so it only runs on request:
//   IBITSA_SMOKE=1 pnpm exec vitest run --project @ibitsa/agent-claude-sdk lessons-smoke
// The events are written to <tmpdir>/ibitsa-lessons-smoke.json.
const MATERIAL = [
  'Task "Store passwords" (Sign-in): passed after 3 rounds.',
  '- Round 1, security blocked: Passwords are stored with SHA-1, not a slow hash.',
  '- Round 2, security blocked: The bcrypt cost factor is 4; the criterion asks for at least 12.',
  'Task "Login form" (Sign-in): passed after 1 round.',
  '- Pull request comments reopened it at round 2.',
].join('\n');

describe.skipIf(process.env.IBITSA_SMOKE !== '1')('live lessons (smoke)', () => {
  it('files a few specific lessons, then reports its cost', async () => {
    const adapter = new ClaudeAdapter({ env: () => ({ ...process.env }) });
    const events: LessonsEvent[] = [];
    await new Promise<void>((resolve) => {
      const session = adapter.startLessons(
        {
          cwd: join(__dirname, '..', '..', '..', '..'),
          title: 'Sign-in',
          material: MATERIAL,
          model: 'haiku',
          maxBudgetMicroUsd: 50_000,
        },
        (event) => {
          events.push(event);
          // Closed as soon as the lessons arrive, as the runtime would: the cost must still come.
          if (event.type === 'lessonsSubmitted') session.close();
          if (event.type === 'usage' || event.type === 'error') resolve();
        },
      );
    });
    writeFileSync(join(tmpdir(), 'ibitsa-lessons-smoke.json'), JSON.stringify(events, null, 2));
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    const filed = events.find((e) => e.type === 'lessonsSubmitted');
    expect(filed?.type === 'lessonsSubmitted' && filed.lessons.length).toBeGreaterThan(0);
    expect(events.at(-1)?.type).toBe('usage');
  }, 120_000);
});
