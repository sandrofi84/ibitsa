import { describe, expect, it } from 'vitest';
import { checkBrief } from './elder';
import type { ResearchBrief } from './elder.schema';

const brief: ResearchBrief = {
  task: 'Strip accents',
  files: [{ path: 'src/slug.ts', lines: '10-20', note: 'slugify' }],
  findings: ['Vitest'],
  slices: [{ councillorId: 'tester', summary: 'Cases', pointers: [] }],
  councillors: [{ councillorId: 'tester', reason: 'Behaviour' }],
  effort: { level: 'light', reason: 'Small' },
  councillorEfforts: [{ councillorId: 'security', level: 'light', reason: 'Input' }],
  quickQuest: { recommended: false, reason: 'Needs a decision' },
};

describe('checkBrief (#101)', () => {
  it('accepts a brief naming only councillors who exist', () => {
    expect(checkBrief({ input: brief, councillors: ['tester', 'security'] })).toEqual({
      ok: true,
      brief,
    });
  });

  it('names every councillor who does not exist, once', () => {
    expect(checkBrief({ input: brief, councillors: ['architect'] })).toEqual({
      ok: false,
      problems: [
        '"tester" isn\'t a councillor. Choose from: architect.',
        '"security" isn\'t a councillor. Choose from: architect.',
      ],
    });
    expect(checkBrief({ input: brief, councillors: [] })).toMatchObject({
      problems: expect.arrayContaining(['"tester" isn\'t a councillor. Choose from: none.']),
    });
  });

  it('gives the schema problems with where they are', () => {
    const result = checkBrief({
      input: {
        ...brief,
        effort: { level: 'huge', reason: 'x' },
        files: [{ path: 'a', lines: 'ten', note: 'n' }],
      },
      councillors: ['tester', 'security'],
    });
    expect(result.ok).toBe(false);
    const problems = result.ok ? [] : result.problems;
    expect(problems.some((p) => p.startsWith('files.0.lines: '))).toBe(true);
    expect(problems.some((p) => p.startsWith('effort.level: '))).toBe(true);
    expect(checkBrief({ input: 'not a brief', councillors: [] })).toMatchObject({ ok: false });
  });

  it('names only past campaigns the elder was shown (#168)', () => {
    const input = {
      ...brief,
      relatedCampaigns: [{ campaignId: 'c-old', title: 'Sign-in', why: 'Same auth module' }],
      keptContext: { related: false, reason: 'Different area' },
    };
    expect(
      checkBrief({ input, councillors: ['tester', 'security'], campaigns: ['c-old'] }),
    ).toMatchObject({
      ok: true,
      brief: { keptContext: { related: false } },
    });
    expect(checkBrief({ input, councillors: ['tester', 'security'] })).toEqual({
      ok: false,
      problems: ['"c-old" isn\'t a past campaign. Choose from: none.'],
    });
  });
});
