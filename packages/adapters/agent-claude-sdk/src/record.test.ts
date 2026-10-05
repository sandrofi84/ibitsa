import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreMessage, Snapshot } from '@ibitsa/protocol';
import { CampaignStore, GitGameMaster, ReplayExport, Runtime, systemClock } from '@ibitsa/runtime';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';

// Records the m1-real fixture (#38): one real quest on a small sample repo, run headless through the
// real runtime, Claude adapter and git game master, answering "Needs you" the way a user would. Spends
// tokens, so it only runs on request:
//   IBITSA_RECORD=1 pnpm exec vitest run --project @ibitsa/agent-claude-sdk record
// Writes agent-fake/fixtures/m1-real.jsonl (the exported log) and m1-real.live.json (the live run's
// final snapshot, which the fixture test checks the replay against).
const FIXTURES = new URL('../../agent-fake/fixtures/', import.meta.url);

const SLUG = `export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
`;
const SLUG_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from './slug.mjs';

test('joins words with dashes', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('drops punctuation', () => {
  assert.equal(slugify('Ready, set... go!'), 'ready-set-go');
});
`;

function sampleRepo(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'ibitsa-record-')), 'recipes');
  mkdirSync(dir);
  writeFileSync(join(dir, 'slug.mjs'), SLUG);
  writeFileSync(join(dir, 'slug.test.mjs'), SLUG_TEST);
  writeFileSync(
    join(dir, 'CLAUDE.md'),
    'Tests: `node --test`. No dependencies to install. Commit with a conventional commit message.\n',
  );
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('-c', 'user.name=Ibitsa', '-c', 'user.email=ibitsa@example.com', 'commit', '-qm', 'init');
  return dir;
}

describe.skipIf(process.env.IBITSA_RECORD !== '1')('record m1-real', () => {
  it('runs a real quest to the finish and exports its log', async () => {
    const repoDir = sampleRepo();
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-record-storage-'));
    const runtime = new Runtime({
      storageDir,
      adapter: new ClaudeAdapter({ env: () => ({ ...process.env }) }),
      gameMaster: new GitGameMaster({ repoDir, setupCommand: () => '' }),
      clock: systemClock,
      newId: () => 'm1-real',
    });
    runtime.start();

    let last: Snapshot | null = null;
    let commandIds = 0;
    const answered = new Set<string>();
    const finished = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('the quest took over 10 minutes')),
        600_000,
      );
      const connection = runtime.connect({
        post: (message: CoreMessage) => {
          if (message.type !== 'snapshot') return;
          const snapshot = message.snapshot;
          last = snapshot;
          const send = (command: Record<string, unknown>) =>
            connection.receive({ ...command, commandId: `rec${++commandIds}` });
          for (const item of snapshot.needsYou) {
            if (answered.has(item.id)) continue;
            answered.add(item.id);
            if (item.kind === 'permission') {
              send({ type: 'answerPermission', itemId: item.id, decision: 'allow' });
            } else if (item.kind === 'question') {
              const answers = Object.fromEntries(
                item.questions.map((q) => [q.question, q.options[0]?.label ?? '']),
              );
              send({ type: 'answerQuestion', itemId: item.id, answers });
            } else {
              clearTimeout(timeout);
              reject(new Error(`the hero needs something the recorder can't give: ${item.kind}`));
            }
          }
          const hero = snapshot.heroes[0];
          if (snapshot.campaign?.status === 'active' && hero?.state.kind === 'submitted') {
            send({ type: 'finishQuest' });
          }
          if (snapshot.campaign?.status === 'finished') {
            clearTimeout(timeout);
            resolve();
          }
        },
      });
      connection.receive({ type: 'hello', protocolVersion: 1 });
      connection.receive({
        type: 'startQuest',
        commandId: 'q1',
        description:
          'Make slugify strip accents\n"Crème Brûlée" should become "creme-brulee". Add a test for it, run the tests with `node --test`, commit, then submit.',
        heroName: 'Ranger Wren',
        classId: 'ranger',
        baseRef: 'main',
      });
    });
    await finished;
    // Let the throttled snapshot after the finish go out.
    await new Promise((r) => setTimeout(r, 500));
    runtime.dispose();

    const log = new CampaignStore(storageDir).read('m1-real');
    const exporter = new ReplayExport({ repoDir, homeDir: homedir(), blankMessages: false });
    const { repo: _repo, ...live } = last as unknown as Snapshot & { repo?: unknown };
    writeFileSync(new URL('m1-real.jsonl', FIXTURES), exporter.apply(log));
    writeFileSync(
      new URL('m1-real.live.json', FIXTURES),
      `${JSON.stringify(exporter.relativize(log, live), null, 2)}\n`,
    );
    const text = readFileSync(new URL('m1-real.jsonl', FIXTURES), 'utf8');
    expect(text).not.toContain(tmpdir());
    expect(text).not.toContain(homedir());
  }, 660_000);
});
