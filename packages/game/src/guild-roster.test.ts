import { describe, expect, it } from 'vitest';
import { draftProblem, modesText, sourceLabel, withField } from './guild-roster';

describe('the Roster (#181)', () => {
  it('says what a councillor does and where it comes from', () => {
    expect(modesText({ planning: true, review: true })).toBe('Plans and reviews');
    expect(modesText({ planning: false, review: true })).toBe('Reviews only');
    expect(modesText({ planning: true, review: false })).toBe('Plans only');
    expect(sourceLabel('builtin')).toBe('Built-in');
    expect(sourceLabel('user')).toBe('Yours');
    expect(sourceLabel('project')).toBe('This project');
  });

  it('changes one override field, and drops it, or the whole override, when emptied', () => {
    expect(withField({ override: undefined, field: 'title', value: ' Guardian ' })).toEqual({
      title: 'Guardian',
    });
    expect(
      withField({ override: { title: 'Guardian', model: 'opus' }, field: 'title', value: '' }),
    ).toEqual({ model: 'opus' });
    expect(withField({ override: { title: 'Guardian' }, field: 'title', value: ' ' })).toBeNull();
    // The agent a councillor reviews on is one more field (#201).
    expect(withField({ override: { model: 'opus' }, field: 'agent', value: 'codex' })).toEqual({
      model: 'opus',
      agent: 'codex',
    });
  });

  it("says why a new councillor can't be written yet", () => {
    const draft = { id: 'performance', title: 'Performance', description: 'Speed.' };
    expect(draftProblem({ draft, taken: ['security'] })).toBeNull();
    expect(draftProblem({ draft: { ...draft, id: 'Perf!' }, taken: [] })).toBe(
      'The id is lowercase letters, digits and hyphens, e.g. performance.',
    );
    expect(draftProblem({ draft, taken: ['performance'] })).toBe(
      "There's already a councillor called performance.",
    );
    expect(draftProblem({ draft: { ...draft, title: ' ' }, taken: [] })).toBe('Give it a title.');
    expect(draftProblem({ draft: { ...draft, description: '' }, taken: [] })).toBe(
      'Say what its field is.',
    );
  });
});
