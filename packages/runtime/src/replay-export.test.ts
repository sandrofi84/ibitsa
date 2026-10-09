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

  it('treats /var and /private/var as the same place, whichever the log used', () => {
    const viaVar = scripted('/var/folders/x/wt');
    const record = viaVar.records[3] as Extract<LogRecord, { kind: 'agent' }>;
    record.event = {
      type: 'activityStarted',
      toolUseId: 'u1',
      kind: 'read',
      detail: '/private/var/folders/x/wt/a.ts',
    };
    expect(parseLog(exportOf(viaVar)).records[3]).toMatchObject({ event: { detail: 'a.ts' } });

    const viaPrivate = scripted('/private/tmp/wt');
    const other = viaPrivate.records[3] as Extract<LogRecord, { kind: 'agent' }>;
    other.event = {
      type: 'activityStarted',
      toolUseId: 'u1',
      kind: 'read',
      detail: '/tmp/wt/b.ts',
    };
    expect(parseLog(exportOf(viaPrivate)).records[3]).toMatchObject({ event: { detail: 'b.ts' } });
  });

  it('on Windows: either separator and any case, and the rest of the path with / (#56)', () => {
    const wt = 'C:\\Users\\Ada\\shop.ibitsa\\fix';
    const log = scripted(wt);
    const record = log.records[3] as Extract<LogRecord, { kind: 'agent' }>;
    record.event = {
      type: 'activityStarted',
      toolUseId: 'u1',
      kind: 'run',
      detail:
        'type c:\\users\\ada\\SHOP.IBITSA\\FIX\\src\\a.ts && type C:/Users/Ada/shop.ibitsa/fix/b.ts',
    };
    const out = new ReplayExport({
      repoDir: 'C:\\Users\\Ada\\shop',
      homeDir: 'C:\\Users\\Ada',
      blankMessages: false,
      platform: 'win32',
    }).apply(log);
    expect(parseLog(out).records[3]).toMatchObject({
      event: { detail: 'type src/a.ts && type b.ts' },
    });
    expect(parseLog(out).records[1]).toMatchObject({ event: { path: '.' } });
  });

  it('elsewhere, case matters and other paths keep their separators', () => {
    const log = scripted();
    const record = log.records[3] as Extract<LogRecord, { kind: 'agent' }>;
    record.event = {
      type: 'activityStarted',
      toolUseId: 'u1',
      kind: 'read',
      detail: `${WT.toUpperCase()}/a.ts ${WT}/src/b.ts`,
    };
    const out = new ReplayExport({
      repoDir: REPO,
      homeDir: HOME,
      blankMessages: false,
      platform: 'linux',
    }).apply(log);
    expect(parseLog(out).records[3]).toMatchObject({
      event: { detail: `${WT.toUpperCase()}/a.ts src/b.ts` },
    });
  });

  it('rewrites paths inside arrays too', () => {
    const x = new ReplayExport({ repoDir: REPO, homeDir: HOME, blankMessages: false });
    expect(x.relativize(scripted(), { files: [`${WT}/a.ts`, `${WT}/b.ts`] })).toEqual({
      files: ['a.ts', 'b.ts'],
    });
  });
});

describe('blanking the elder and the council (#103)', () => {
  const brief = {
    task: 'Add sign-in for the Contoso portal',
    files: [{ path: 'src/auth.ts', note: 'sessions' }],
    findings: ['Contoso wants SSO later'],
    slices: [{ councillorId: 'security', summary: 'Contoso secrets', pointers: [] }],
    councillors: [{ councillorId: 'security', reason: 'Sessions' }],
    effort: { level: 'standard' as const, reason: 'Decisions' },
    councillorEfforts: [],
    quickQuest: { recommended: false, reason: 'Needs decisions' },
  };
  const question = {
    councillorId: 'security',
    question: 'Contoso session length?',
    options: [{ id: 'day', label: 'A day', tradeoff: 'Safer' }],
    recommendation: { optionId: 'day', reason: 'Contoso policy' },
    allowFreeText: true,
  };
  const records: LogRecord[] = [
    {
      t: 0,
      kind: 'command',
      command: { type: 'consultElder', commandId: 'e1', task: 'Add sign-in\nfor Contoso' },
    },
    { t: 1, kind: 'elder', elderId: 'e2', event: { type: 'briefSubmitted', brief } },
    {
      t: 2,
      kind: 'command',
      command: {
        type: 'conveneCouncil',
        commandId: 'k1',
        task: 'Add sign-in\nfor Contoso',
        mode: 'roundTable',
        roster: ['security'],
        effort: 'standard',
      },
    },
    {
      t: 3,
      kind: 'council',
      sittingId: 's3',
      event: {
        type: 'reportFiled',
        toolUseId: 'u1',
        councillorId: 'security',
        report: {
          concerns: [{ summary: 'Contoso tokens', severity: 'high', reason: 'Leaks' }],
          questions: ['Contoso?'],
          recommendations: ['Rotate'],
          notChecked: ['SSO'],
          bowOut: 'n/a',
        },
      },
    },
    {
      t: 4,
      kind: 'council',
      sittingId: 's3',
      event: { type: 'questionsAsked', toolUseId: 'u2', questions: [question] },
    },
    {
      t: 5,
      kind: 'council',
      sittingId: 's3',
      event: { type: 'said', councillorId: 'security', text: 'Contoso said so' },
    },
    {
      t: 6,
      kind: 'command',
      command: {
        type: 'askCouncilWhy',
        commandId: 'w1',
        batchId: 'b5',
        questionId: 'q6',
        text: 'Contoso?',
      },
    },
    {
      t: 7,
      kind: 'command',
      command: {
        type: 'answerCouncil',
        commandId: 'a1',
        batchId: 'b5',
        answers: { q6: { text: 'Contoso: a week' } },
      },
    },
    {
      t: 8,
      kind: 'council',
      sittingId: 's3',
      event: {
        type: 'planProposed',
        toolUseId: 'u3',
        plan: {
          summary: 'Contoso plan',
          goal: 'Contoso sign-in',
          scope: 'Contoso only',
          tasks: [
            {
              id: 'T1',
              title: 'Contoso auth',
              description: 'Build Contoso auth',
              files: ['src/auth.ts'],
              dependsOn: [],
              criteria: [{ councillorId: 'security', items: ['Contoso tokens rotate'] }],
              decisions: ['D1'],
            },
          ],
          decisions: [
            {
              id: 'D1',
              title: 'Contoso length',
              raisedBy: 'security',
              chosen: 'Contoso week',
              alternatives: [{ option: 'Contoso day', rejectedBecause: 'Contoso hates it' }],
              tradeoffs: 'Contoso risk',
              why: 'Contoso said',
              discussion: 'Contoso chat',
              affects: ['T1'],
            },
          ],
        },
      },
    },
    {
      t: 9,
      kind: 'command',
      command: {
        type: 'requestPlanChange',
        commandId: 'c1',
        version: 1,
        text: 'Contoso wants more',
      },
    },
    { t: 10, kind: 'council', sittingId: 's3', event: { type: 'usage', totalCost: 5 } },
    { t: 11, kind: 'council', sittingId: 's3', event: { type: 'idle' } },
    {
      t: 12,
      kind: 'command',
      command: { type: 'consultCouncil', commandId: 'c2', text: 'Contoso, carry on' },
    },
  ];
  const log: EventLog = {
    header: {
      kind: 'header',
      logVersion: 1,
      protocolVersion: 1,
      campaignId: 'c',
      startedAt: '2026-10-06T00:00:00.000Z',
    },
    records,
    tornTail: false,
  };

  it('keeps no user or model words, only titles, ids and paths', () => {
    const out = exportOf(log, true);
    expect(out).not.toContain('Contoso');
    expect(out).toContain('Add sign-in');
    expect(out).toContain('src/auth.ts');
    expect(out).toContain('"optionId":"day"');
  });

  it('replays to the same sitting, apart from the words', () => {
    const replay = (l: EventLog) => {
      let state = initialState();
      for (const r of l.records) state = step(state, r).state;
      return view(state);
    };
    const original = replay(log);
    expect(original.sitting?.reports).toHaveLength(1);
    const blanked = replay(parseLog(exportOf(log, true)));
    expect(blanked.sitting?.status).toBe(original.sitting?.status);
    expect(blanked.sitting?.reports.map((r) => r.councillorId)).toEqual(['security']);
    expect(blanked.sitting?.plans.map((p) => p.outcome.kind)).toEqual(
      original.sitting?.plans.map((p) => p.outcome.kind),
    );
    expect(blanked.elder?.status).toBe('briefed');
  });
});
