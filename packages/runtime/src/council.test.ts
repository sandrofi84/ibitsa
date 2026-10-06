import type { CouncillorInfo } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { councilVersion, seatable } from './council';

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
    promptVersion: 1,
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
      { ...base, promptVersion: 2 },
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
