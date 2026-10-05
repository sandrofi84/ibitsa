import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type EventLog, initialState, type LogRecord, parseLog, step, view } from '@ibitsa/core';
import { describe, expect, it } from 'vitest';
import { BLANKED, ReplayExport } from './replay-export';

const HOME = '/Users/ada';
const REPO = '/Users/ada/code/shop';
const WT = '/Users/ada/code/shop.ibitsa/ibitsa/fix-login';

function scripted(worktree = WT): EventLog {
  const records: LogRecord[] = [
    {
      t: 0,
      kind: 'command',
      command: {
        type: 'startQuest',
        commandId: 'q1',
        description: 'Fix the login redirect\nThe secret customer name is Contoso.',
        heroName: 'Ranger Ilse',
        classId: 'ranger',
        baseRef: 'main',
      },
    },
    {
      t: 10,
      kind: 'gm',
      event: {
        type: 'worktreeCreated',
        islandId: 'i2',
        path: worktree,
        branch: 'ibitsa/fix-login',
      },
    },
    { t: 20, kind: 'agent', heroId: 'h4', event: { type: 'sessionStarted', sessionId: 's1' } },
    {
      t: 30,
      kind: 'agent',
      heroId: 'h4',
      event: {
        type: 'activityStarted',
        toolUseId: 'u1',
        kind: 'read',
        detail: `${worktree}/src/login.ts`,
      },
    },
    {
      t: 40,
      kind: 'agent',
      heroId: 'h4',
      event: { type: 'activityFinished', toolUseId: 'u1', outcome: 'ok' },
    },
    {
      t: 50,
      kind: 'agent',
      heroId: 'h4',
      event: {
        type: 'permission',
        requestId: 'r1',
        tool: 'Bash',
        input: {
          command: `cd ${worktree} && cat ${REPO}/.env ${HOME}/.npmrc ${worktree}-other/x`,
          cwd: worktree,
        },
      },
    },
    {
      t: 60,
      kind: 'command',
      command: {
        type: 'answerPermission',
        commandId: 'a1',
        itemId: 'n5',
        decision: 'deny',
        note: 'not the .env',
      },
    },
    {
      t: 70,
      kind: 'agent',
      heroId: 'h4',
      event: { type: 'message', text: `I read ${worktree}/src/login.ts.` },
    },
    { t: 80, kind: 'agent', heroId: 'h4', event: { type: 'turnEnded', queuedTurns: 0 } },
    {
      t: 90,
      kind: 'command',
      command: {
        type: 'sendMessage',
        commandId: 'm1',
        heroId: 'h4',
        text: 'Ship it',
        priority: 'next',
      },
    },
  ];
  return {
    header: {
      kind: 'header',
      logVersion: 1,
      protocolVersion: 1,
      campaignId: 'c1',
      startedAt: '2026-10-05T10:00:00.000Z',
    },
    records,
    tornTail: false,
  };
}

const exportOf = (log: EventLog, blankMessages = false) =>
  new ReplayExport({ repoDir: REPO, homeDir: HOME, blankMessages }).apply(log);

const finalView = (log: EventLog) =>
  view(log.records.reduce((state, input) => step(state, input).state, initialState()));

describe('ReplayExport', () => {
  it('makes paths relative to the worktree, the repo relative to it, and home ~', () => {
    const text = exportOf(scripted());
    expect(text).not.toContain('/Users/ada');
    const out = parseLog(text).records;
    expect(out[1]).toMatchObject({ event: { type: 'worktreeCreated', path: '.' } });
    expect(out[3]).toMatchObject({ event: { detail: 'src/login.ts' } });
    expect(out[5]).toMatchObject({
      event: {
        input: {
          command:
            'cd . && cat ../../../shop/.env ~/.npmrc ~/code/shop.ibitsa/ibitsa/fix-login-other/x',
          cwd: '.',
        },
      },
    });
  });

  it('keeps message text unless asked to blank it', () => {
    const kept = parseLog(exportOf(scripted())).records;
    expect(kept[7]).toMatchObject({ event: { text: 'I read src/login.ts.' } });
    expect(kept[9]).toMatchObject({ command: { text: 'Ship it' } });
  });

  it('blanks what the user and the hero said, keeping the quest title', () => {
    const text = exportOf(scripted(), true);
    expect(text).not.toContain('Contoso');
    const out = parseLog(text).records;
    expect(out[0]).toMatchObject({ command: { description: 'Fix the login redirect' } });
    expect(out[6]).toMatchObject({ command: { note: BLANKED } });
    expect(out[7]).toMatchObject({ event: { text: BLANKED } });
    expect(out[9]).toMatchObject({ command: { text: BLANKED } });
  });

  it('replays to the same state as the original, apart from paths and blanked text', () => {
    const original = finalView(scripted());
    const exported = finalView(parseLog(exportOf(scripted())));
    expect(exported.heroes.map((h) => h.state.kind)).toEqual(
      original.heroes.map((h) => h.state.kind),
    );
    expect(exported.needsYou.map((i) => i.kind)).toEqual(original.needsYou.map((i) => i.kind));
    expect(exported.campaign).toEqual(original.campaign);
    expect(exported.islands).toEqual(original.islands);
  });

  it('knows a worktree by its resolved path too (macOS /private/var)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ibitsa-export-'));
    const resolved = realpathSync(tmp);
    const log = scripted(tmp);
    const record = log.records[3] as Extract<LogRecord, { kind: 'agent' }>;
    record.event = {
      type: 'activityStarted',
      toolUseId: 'u1',
      kind: 'read',
      detail: `${resolved}/a.ts`,
    };
    expect(parseLog(exportOf(log)).records[3]).toMatchObject({ event: { detail: 'a.ts' } });
  });

  it('leaves a log without a worktree alone apart from home', () => {
    const log = scripted();
    log.records = log.records.filter((r) => r.kind === 'command');
    const text = exportOf(log);
    expect(parseLog(text).records).toHaveLength(3);
  });

  it('rewrites other values from the same campaign the same way', () => {
    const x = new ReplayExport({ repoDir: REPO, homeDir: HOME, blankMessages: false });
    expect(x.relativize(scripted(), { cwd: WT, file: `${WT}/a.ts`, n: 1 })).toEqual({
      cwd: '.',
      file: 'a.ts',
      n: 1,
    });
  });
});
