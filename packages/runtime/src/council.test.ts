import type { CouncillorInfo } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { councilVersion, seatable, sittingPlan } from './council';

const councillor = (id: string, hash = 'aaa'): CouncillorInfo => ({
  id,
  skill: id,
  title: id,
  description: '',
  source: 'builtin',
  portrait: null,
  model: null,
  tools: ['Read'],
  modes: { planning: true, review: false },
  hash,
});

describe('councilVersion (#98)', () => {
  const base = {
    mode: 'roundTable',
    councillors: [councillor('security'), councillor('tester')],
    promptVersion: 'p1',
  };

  it("is the same for the same council, whatever the roster's order", () => {
    const version = councilVersion(base);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(councilVersion({ ...base, councillors: [...base.councillors].reverse() })).toBe(version);
  });

  it('changes with the mode, a councillor, its skill file, or the prompts', () => {
    const version = councilVersion(base);
    const variants = [
      { ...base, mode: 'chambers' },
      { ...base, councillors: [councillor('security')] },
      { ...base, councillors: [councillor('security', 'bbb'), councillor('tester')] },
      { ...base, promptVersion: 'p2' },
    ];
    const versions = variants.map((v) => councilVersion(v));
    expect(versions).not.toContain(version);
    expect(new Set(versions).size).toBe(variants.length);
  });
});

describe('seatable (#98)', () => {
  it('leaves out the councillors turned off', () => {
    const all = [councillor('architect'), councillor('designer'), councillor('tester')];
    expect(seatable(all, ['designer', 'nobody']).map((c) => c.id)).toEqual(['architect', 'tester']);
    expect(seatable(all, [])).toEqual(all);
  });
});

describe('sittingPlan (#103, #105)', () => {
  const roster = [
    { councillorId: 'architect', effort: 'light' as const },
    { councillorId: 'tester', effort: 'standard' as const },
    { councillorId: 'security', effort: 'deep' as const },
  ];

  it("runs a round table on its effort's model, with no cap of its own (#272)", () => {
    expect(sittingPlan({ mode: 'roundTable', effort: 'standard', roster })).toEqual({
      model: 'sonnet',
      roster,
    });
    expect(sittingPlan({ mode: 'roundTable', effort: 'light', roster })).toMatchObject({
      model: 'haiku',
    });
    expect(sittingPlan({ mode: 'roundTable', effort: 'deep', roster })).toMatchObject({
      model: 'opus',
    });
  });

  it("gives each chamber its effort's model (#105), with no cap of its own (#272)", () => {
    expect(sittingPlan({ mode: 'chambers', effort: 'light', roster })).toEqual({
      model: 'haiku',
      roster: [
        { councillorId: 'architect', effort: 'light', model: 'haiku' },
        { councillorId: 'tester', effort: 'standard', model: 'sonnet' },
        { councillorId: 'security', effort: 'deep', model: 'sonnet' },
      ],
    });
  });
});
