import { describe, expect, it } from 'vitest';
import {
  councilPose,
  DECISIONS_Y,
  emptyHut,
  fitTitle,
  HUT_DOOR_X,
  NAME_ROWS,
  PLATE_GAP,
  PLATE_MAX,
  PLATE_PAD,
  placeNames,
  reduceHut,
  seatHut,
  TABLE_TOP,
  walkIns,
} from './hut-view';
import type { HutEvent, HutMode, HutView, NamePlate } from './hut-view.types';

const ROSTER = [
  { id: 'elder', title: 'Elder', appearance: 'councillor.elder' },
  { id: 'architect', title: 'Architect', appearance: 'councillor.default' },
  { id: 'tester', title: 'Tester', appearance: 'councillor.default' },
  { id: 'security', title: 'Security', appearance: 'councillor.default' },
];

const run = (events: HutEvent[], from: HutView = emptyHut()) => events.reduce(reduceHut, from);
const convene = (mode: HutMode) => run([{ type: 'convened', mode, councillors: ROSTER }]);

describe('the hut view', () => {
  it('separate chambers studies until every report is in, then talks', () => {
    let view = convene('chambers');
    expect(view.stage).toBe('study');
    expect(councilPose(view, 'tester')).toBe('think');

    view = run(
      [
        { type: 'reportFiled', councillor: 'tester' },
        { type: 'reportFiled', councillor: 'elder' },
        { type: 'reportFiled', councillor: 'architect' },
      ],
      view,
    );
    // The tester looks up when its report is in; the others still study.
    expect(councilPose(view, 'tester')).toBe('idle');
    expect(councilPose(view, 'security')).toBe('think');
    expect(view.stage).toBe('study');

    view = reduceHut(view, { type: 'reportFiled', councillor: 'security' });
    expect(view.stage).toBe('dialogue');
    expect(councilPose(view, 'security')).toBe('idle');
  });

  it('a round table has no study stage', () => {
    const view = convene('roundTable');
    expect(view.stage).toBe('dialogue');
    expect(councilPose(view, 'tester')).toBe('idle');
  });

  it('a raised hand waits for the floor, and speaking lowers it', () => {
    let view = run(
      [{ type: 'handRaised', councillor: 'security', raised: true }],
      convene('roundTable'),
    );
    expect(councilPose(view, 'security')).toBe('raiseHand');

    view = reduceHut(view, { type: 'speaking', councillor: 'security' });
    expect(view.speaker).toBe('security');
    expect(councilPose(view, 'security')).toBe('talk');
    expect(view.councillors.find((c) => c.id === 'security')?.raisedHand).toBe(false);

    view = reduceHut(view, { type: 'speaking', councillor: null });
    expect(councilPose(view, 'security')).toBe('idle');
  });

  it('a hand can be lowered without speaking', () => {
    const view = run(
      [
        { type: 'handRaised', councillor: 'tester', raised: true },
        { type: 'handRaised', councillor: 'tester', raised: false },
      ],
      convene('roundTable'),
    );
    expect(councilPose(view, 'tester')).toBe('idle');
  });

  it('the elder writes while the plan is drawn up, unless speaking', () => {
    let view = run([{ type: 'step', step: 'plan' }], convene('roundTable'));
    expect(councilPose(view, 'elder')).toBe('write');
    expect(councilPose(view, 'architect')).toBe('idle');
    view = reduceHut(view, { type: 'speaking', councillor: 'elder' });
    expect(councilPose(view, 'elder')).toBe('talk');
  });

  it('counts decisions and ignores councillors not at the table', () => {
    const view = run(
      [
        { type: 'decisionRecorded' },
        { type: 'decisionRecorded' },
        { type: 'reportFiled', councillor: 'nobody' },
      ],
      convene('chambers'),
    );
    expect(view.decisions).toBe(2);
    expect(view.stage).toBe('study');
    expect(councilPose(view, 'nobody')).toBe('idle');
  });

  it('convening again starts a fresh sitting', () => {
    const view = run(
      [
        { type: 'decisionRecorded' },
        { type: 'step', step: 'questions' },
        { type: 'convened', mode: 'chambers', councillors: ROSTER.slice(0, 2) },
      ],
      convene('roundTable'),
    );
    expect(view).toMatchObject({ mode: 'chambers', step: 'goal', decisions: 0 });
    expect(view.councillors.map((c) => c.id)).toEqual(['elder', 'architect']);
  });
});

describe('seating', () => {
  it('puts the elder in the middle with the others either side, in order', () => {
    const seats = seatHut(convene('roundTable'), 480);
    expect(seats.map((s) => s.id)).toEqual(['architect', 'tester', 'elder', 'security']);
    const xs = seats.map((s) => s.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[2]).toBeGreaterThan(xs[1] as number);
  });

  it('centres an odd table on the elder, and narrows the spacing for a crowd', () => {
    const three = seatHut(
      run([{ type: 'convened', mode: 'roundTable', councillors: ROSTER.slice(0, 3) }]),
      480,
    );
    expect(three.find((s) => s.id === 'elder')?.x).toBe(240);

    const crowd = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      title: `C${i}`,
      appearance: 'x',
    }));
    const seats = seatHut(run([{ type: 'convened', mode: 'roundTable', councillors: crowd }]), 480);
    expect(seats).toHaveLength(10);
    for (const s of seats) {
      expect(s.x).toBeGreaterThanOrEqual(16);
      expect(s.x).toBeLessThanOrEqual(464);
    }
  });
});

describe('nine at the table (#219)', () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({
    id: i === 4 ? 'elder' : `c${i}`,
    title: `C${i}`,
    appearance: 'x',
  }));

  it('seats nine 48-wide figures shoulder to shoulder, all on the table', () => {
    const seats = seatHut(run([{ type: 'convened', mode: 'roundTable', councillors: nine }]), 480);
    const xs = seats.map((s) => s.x);
    for (let i = 1; i < xs.length; i++) expect((xs[i] as number) - (xs[i - 1] as number)).toBe(48);
    // The table runs from x=24 to x=456: every figure's 48 px stand on it.
    expect((xs[0] as number) - 24).toBeGreaterThanOrEqual(24);
    expect((xs.at(-1) as number) + 24).toBeLessThanOrEqual(456);
  });
});

describe('walking in (#219)', () => {
  const convened = convene('roundTable');
  const seats = seatHut(convened, 480);

  it('brings a just-convened council in from the door, the farthest first, one after another', () => {
    const walks = walkIns({
      seats,
      seated: new Set(),
      first: true,
      view: convened,
      reducedMotion: false,
    });
    expect(walks.map((w) => w.id)).toEqual([...seats].sort((a, b) => b.x - a.x).map((s) => s.id));
    for (const w of walks) {
      expect(w.fromX).toBe(HUT_DOOR_X);
      expect(w.toX).toBe(seats.find((s) => s.id === w.id)?.x);
      expect(w.durationMs).toBeGreaterThan(0);
    }
    expect(walks.map((w) => w.delayMs)).toEqual([0, 250, 500, 750]);
    // Farther seats take longer to reach.
    expect(walks[0]?.durationMs).toBeGreaterThan(walks.at(-1)?.durationMs as number);
  });

  it('shows everyone seated when the hut opens mid-sitting, so nothing replays on reopen', () => {
    const studied = reduceHut(convened, { type: 'step', step: 'research' });
    expect(
      walkIns({ seats, seated: new Set(), first: true, view: studied, reducedMotion: false }),
    ).toEqual([]);
    const spoken = reduceHut(convened, { type: 'speaking', councillor: 'tester' });
    expect(
      walkIns({ seats, seated: new Set(), first: true, view: spoken, reducedMotion: false }),
    ).toEqual([]);
  });

  it('walks in only who is new to the table, and nobody with reduced motion', () => {
    const seated = new Set(seats.map((s) => s.id).filter((id) => id !== 'security'));
    const later = reduceHut(convened, { type: 'step', step: 'research' });
    expect(
      walkIns({ seats, seated, first: false, view: later, reducedMotion: false }).map((w) => w.id),
    ).toEqual(['security']);
    expect(
      walkIns({ seats, seated: new Set(), first: true, view: convened, reducedMotion: true }),
    ).toEqual([]);
  });
});

describe('name plates on the table (#233)', () => {
  const seats = (xs: number[]) => xs.map((x, i) => ({ id: `c${i}`, x }));
  // 8px monospace: about 5 px a letter.
  const measure = (t: string) => t.length * 5;

  it('puts every plate on the table front, below its top, so a drawn book or candle stays clear', () => {
    for (const y of [...NAME_ROWS, DECISIONS_Y]) expect(y).toBeGreaterThanOrEqual(TABLE_TOP + 16);
  });

  it('keeps roomy plates on one row, centred under their seats', () => {
    const plates = placeNames({ seats: seats([176, 240, 304]), widths: [30, 25, 30], room: 480 });
    expect(plates.map((p) => p.y)).toEqual([NAME_ROWS[0], NAME_ROWS[0], NAME_ROWS[0]]);
    expect(plates.map((p) => p.x)).toEqual([176, 240, 304]);
    expect(plates[1]?.width).toBe(25 + 2 * PLATE_PAD);
  });

  it('staggers every other plate when any two neighbours would touch, and none touch on a row', () => {
    const xs = [48, 96, 144, 192, 240, 288, 336, 384, 432];
    const titles = ['Architect', 'Tester', 'Accessibility', 'Security', 'Elder', 'Designer'];
    const widths = [...titles, 'Navigator', 'Scribe', 'Herald'].map(measure);
    const plates = placeNames({ seats: seats(xs), widths, room: 480 });
    expect(plates.filter((_, i) => i % 2 === 1).every((p) => p.y === NAME_ROWS[1])).toBe(true);
    for (const row of NAME_ROWS) {
      const on = plates.filter((p) => p.y === row);
      for (let i = 1; i < on.length; i++) {
        const [a, b] = [on[i - 1], on[i]] as [NamePlate, NamePlate];
        expect(b.x - b.width / 2 - (a.x + a.width / 2)).toBeGreaterThanOrEqual(PLATE_GAP);
      }
    }
  });

  it('keeps a plate inside the room, and caps its width', () => {
    const [left, right] = placeNames({ seats: seats([10, 470]), widths: [200, 60], room: 480 });
    expect(left?.width).toBe(PLATE_MAX);
    expect(left?.x).toBe(PLATE_MAX / 2 + 2);
    expect((right?.x ?? 0) + (right?.width ?? 0) / 2).toBeLessThanOrEqual(478);
  });

  it('shortens only a title too long for a plate, with an ellipsis', () => {
    expect(fitTitle({ title: 'Accessibility', measure })).toBe('Accessibility');
    const long = fitTitle({ title: 'The Keeper of Very Long Councillor Names', measure });
    expect(long.endsWith('…')).toBe(true);
    expect(measure(long)).toBeLessThanOrEqual(PLATE_MAX - 2 * PLATE_PAD);
    expect(long.startsWith('The Keeper of')).toBe(true);
  });
});
