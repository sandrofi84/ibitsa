import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CampaignRecordData } from '@ibitsa/core';
import type { Plan } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { CampaignDocuments, planMarkdown, recordMarkdown } from './campaign-documents';

const plan: Plan = {
  summary: 'Sign-in',
  goal: 'Let users sign in',
  scope: 'Email only',
  tasks: [
    {
      id: 'T1',
      title: 'Auth',
      description: 'Add auth.',
      files: ['src/auth.ts'],
      dependsOn: [],
      heroClass: 'rogue',
      criteria: [{ councillorId: 'security', items: ['Hashed'] }],
      decisions: ['D1'],
    },
    {
      id: 'T2',
      title: 'Form',
      description: 'Add the form.',
      files: [],
      dependsOn: ['T1'],
      criteria: [],
      decisions: [],
    },
  ],
  decisions: [
    {
      id: 'D1',
      title: 'Methods',
      raisedBy: 'security',
      chosen: 'Email',
      alternatives: [{ option: 'Google', rejectedBecause: 'OAuth' }],
      tradeoffs: 'No social sign-in',
      why: 'Ship first',
      discussion: 'Short',
      affects: ['T1'],
    },
  ],
  islands: [
    { id: 'I1', title: 'Backend', tasks: ['T1'] },
    { id: 'I2', title: 'Frontend', tasks: ['T2'] },
  ],
  branching: 'stacked',
};

describe('planMarkdown (#104, #120)', () => {
  it('writes the goal, the tasks, the islands and the decisions as records', () => {
    const md = planMarkdown({ version: 2, plan });
    expect(md).toContain(
      '# Plan v2\n\nSign-in\n\n## Goal\n\nLet users sign in\n\n## Scope\n\nEmail only',
    );
    expect(md).toContain('### T1 · Auth');
    expect(md).toContain('**Suggested hero:** rogue');
    expect(md).toContain('**Acceptance criteria (security):**\n- Hashed');
    expect(md).toContain('**Depends on:** T1');
    expect(md).toContain('## Islands (stacked)\n\n- **I1 · Backend:** T1\n- **I2 · Frontend:** T2');
    expect(md).toContain(
      '### D1 · Methods (raised by security)\n**Chosen:** Email\n**Alternatives:** Google. Rejected: OAuth',
    );
    expect(md).toContain('**Trade-offs accepted:** No social sign-in');
    expect(md).toContain('**Affects tasks:** T1');
  });

  it('says when there are no decisions, and leaves islands out of a plan without them', () => {
    const md = planMarkdown({
      version: 1,
      plan: { summary: plan.summary, goal: plan.goal, tasks: plan.tasks, decisions: [] },
    });
    expect(md).toContain('## Book of Decisions\n\n(none)');
    expect(md).not.toContain('## Islands');
  });
});

const RECORD: CampaignRecordData = {
  title: 'Sign-in',
  status: 'finished',
  summary: 'Email sign-in.',
  decisions: [
    {
      id: 'D1',
      title: 'Methods',
      raisedBy: 'security',
      chosen: 'Email',
      alternatives: [],
      why: 'Simple',
      affects: ['T1'],
    },
  ],
  islands: [
    {
      name: 'Backend',
      branch: 'ibitsa/backend',
      tasks: [
        { title: 'Auth', state: 'done' },
        { title: 'Form', state: 'active' },
      ],
      pullRequest: { number: 12, url: 'https://github.com/o/r/pull/12', state: 'merged' },
    },
    { name: 'Docs', branch: 'ibitsa/docs', tasks: [], pullRequest: null },
  ],
  deferred: {
    unfinished: ['Backend: Form'],
    suggestions: [
      { councillorId: 'tester', message: 'Add a fuzz test', file: 'src/a.ts', line: 4 },
    ],
    revisits: [{ councillorId: 'security', decisionId: 'D1', message: 'Consider passkeys' }],
  },
  gold: { kind: 'exact', value: 1_234_567 },
  tallies: [
    {
      sittingId: 's1',
      mode: 'roundTable',
      councilVersion: null,
      comparisonOf: null,
      outcome: 'approved',
      startedAt: 0,
      durationMs: 180_000,
      cost: { totalMicroUsd: 400_000, byModel: [], byCouncillor: [] },
      effort: 'standard',
      elderEffort: null,
      roster: [
        { councillorId: 'security', effort: 'standard', elderEffort: null, recommended: true },
      ],
      changedElderPicks: null,
    } as unknown as CampaignRecordData['tallies'][number],
  ],
  lessons: ['Brief the hero on hashing.'],
};

describe('the campaign record (#167)', () => {
  it('says what shipped, what was decided and deferred, the gold, the council and the lessons', () => {
    expect(recordMarkdown(RECORD)).toBe(
      [
        '# Campaign record: Sign-in',
        '',
        '**Finished.**',
        '',
        'Email sign-in.',
        '',
        '## What shipped',
        '',
        '### Backend (`ibitsa/backend`)',
        '',
        'Pull request [#12](https://github.com/o/r/pull/12): merged.',
        '- [x] Auth',
        '- [ ] Form',
        '',
        '### Docs (`ibitsa/docs`)',
        '',
        'No pull request.',
        '',
        '## Decisions',
        '',
        '- **D1 Methods:** Email. Simple',
        '',
        '## Deferred',
        '',
        '**Unfinished tasks:**',
        '- Backend: Form',
        '',
        '**Suggestions kept for later:**',
        '- tester (`src/a.ts:4`): Add a fuzz test',
        '',
        '**Decisions a reviewer asked to revisit (dismissed):**',
        '- D1, security: Consider passkeys',
        '',
        '## Gold',
        '',
        '$1.23',
        '',
        '## The council',
        '',
        '- Round table, standard effort: approved, $0.40, 3 min; security.',
        '',
        '## Lessons',
        '',
        '- Brief the hero on hashing.',
        '',
      ].join('\n'),
    );
  });

  it('marks an abandoned campaign, and says when there was nothing, or the gold is unknown', () => {
    const md = recordMarkdown({
      ...RECORD,
      status: 'abandoned',
      summary: null,
      decisions: [],
      islands: [],
      deferred: { unfinished: [], suggestions: [], revisits: [] },
      gold: { kind: 'unknown' },
      tallies: [],
      lessons: null,
    });
    expect(md).toContain('**Abandoned.**');
    expect(md).toContain('(nothing: no island was started)');
    expect(md).toContain('## Decisions\n\n(none)');
    expect(md).toContain('## Deferred\n\n(nothing)');
    expect(md).toContain('Unknown: some of the work never reported its cost.');
    expect(md).not.toContain('## The council');
    expect(md).not.toContain('## Lessons');
    expect(
      recordMarkdown({ ...RECORD, gold: { kind: 'estimated', value: 500_000, basis: 'x' } }),
    ).toContain('$0.50 (estimated)');
  });
});

describe('the index of past records (#168)', () => {
  it('lists every record, newest first, with its title, status and summary', () => {
    const repo = mkdtempSync(join(tmpdir(), 'ibitsa-records-'));
    try {
      const write = ({ id, md, at }: { id: string; md: string; at: number }) => {
        const dir = join(repo, '.ibitsa', 'campaigns', id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'record.md'), md);
        utimesSync(join(dir, 'record.md'), at, at);
      };
      write({
        id: 'c-old',
        md: '# Campaign record: Sign-in\n\n**Finished.**\n\nEmail sign-in.\n\n## What shipped\n',
        at: 1_700_000_000,
      });
      write({
        id: 'c-new',
        md: '# Campaign record: Slugs\n\n**Abandoned.**\n\n## What shipped\n',
        at: 1_800_000_000,
      });
      mkdirSync(join(repo, '.ibitsa', 'campaigns', 'c-planning'), { recursive: true });
      const docs = new CampaignDocuments(repo);
      expect(docs.pastRecords().map(({ date: _date, ...r }) => r)).toEqual([
        {
          campaignId: 'c-new',
          title: 'Slugs',
          status: 'abandoned',
          summary: null,
          path: '.ibitsa/campaigns/c-new/record.md',
        },
        {
          campaignId: 'c-old',
          title: 'Sign-in',
          status: 'finished',
          summary: 'Email sign-in.',
          path: '.ibitsa/campaigns/c-old/record.md',
        },
      ]);
      expect(docs.pastRecords(1)).toHaveLength(1);
      expect(new CampaignDocuments(join(repo, 'nowhere')).pastRecords()).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
