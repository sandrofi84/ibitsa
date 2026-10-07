import type { CampaignEndView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { campaignEndOf } from './campaign-end';

const ENDING: CampaignEndView = {
  record: 'written',
  recordPath: '.ibitsa/campaigns/c1/record.md',
  recordError: null,
  councilContext: 'pending',
  councilTokens: 48_600,
  lessonsGold: { kind: 'exact', value: 20_000 },
};

describe('the end of a campaign (#167)', () => {
  it('after Finish, says where the record is and offers Empty first, then Compact and Keep', () => {
    const model = campaignEndOf({ status: 'finished', ending: ENDING });
    expect(model).toMatchObject({
      heading: 'The campaign is over',
      record: 'The campaign record is in .ibitsa/campaigns/c1/record.md.',
      question: 'What happens to the council’s context? It holds about 49k tokens.',
      chosen: null,
      closable: false,
    });
    expect(model.choices.map((c) => c.id)).toEqual(['empty', 'compact', 'keep']);
  });

  it('says what was chosen, and can then be closed', () => {
    const model = campaignEndOf({
      status: 'finished',
      ending: { ...ENDING, councilContext: 'keep' },
    });
    expect(model).toMatchObject({
      question: null,
      choices: [],
      chosen: 'The council’s context is kept for the next campaign.',
      closable: true,
    });
  });

  it('follows the record while it is written, and can close once it is (or failed)', () => {
    const quiet = { ...ENDING, councilContext: null, councilTokens: null };
    expect(
      campaignEndOf({ status: 'abandoned', ending: { ...quiet, record: 'lessons' } }),
    ).toMatchObject({
      heading: 'The campaign was abandoned',
      record: 'The elder is writing the lessons…',
      closable: false,
    });
    expect(
      campaignEndOf({ status: 'abandoned', ending: { ...quiet, record: 'writing' } }).record,
    ).toBe('Writing the campaign record…');
    expect(
      campaignEndOf({
        status: 'finished',
        ending: { ...quiet, record: 'failed', recordError: 'EACCES' },
      }),
    ).toMatchObject({ record: "The campaign record couldn't be written: EACCES", closable: true });
    // Without its size the question still comes.
    expect(
      campaignEndOf({ status: 'finished', ending: { ...ENDING, councilTokens: null } }).question,
    ).toBe('What happens to the council’s context?');
  });
});
