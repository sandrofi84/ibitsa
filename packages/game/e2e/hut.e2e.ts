import { crc32, deflateSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';

interface Rendered {
  mode: string;
  step: string;
  stage: string;
  speaker: string | null;
  decisions: number;
  room: 'pack' | 'drawn';
  table: 'pack' | 'drawn';
  councillors: {
    id: string;
    x: number;
    at: number;
    walking: boolean;
    animation: string | null;
    scale: number;
    mark: string | null;
    hand: boolean;
    book: boolean;
  }[];
}
interface Probe {
  hut(): Rendered | null;
  sitting: { advance(): boolean };
}

const hut = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ibitsa: Probe }).__ibitsa.hut());
const advance = (page: Page, times = 1) =>
  page.evaluate((n) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    for (let i = 0; i < n; i++) p.sitting.advance();
  }, times);
const seat = (r: Rendered | null, id: string) => r?.councillors.find((c) => c.id === id);
/** Until everyone has walked in from the door and stands at their seat (#219). */
const seated = (page: Page) =>
  expect
    .poll(async () => (await hut(page))?.councillors.every((c) => !c.walking && c.at === c.x), {
      timeout: 15_000,
    })
    .toBe(true);

/** A solid 480×270 PNG, as a pack's scene picture would be. */
function scenePng({ rgba, below }: { rgba: number[]; below?: number }): Buffer {
  const width = 480;
  const height = 270;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const colour = below === undefined || y >= below ? rgba : [0, 0, 0, 0];
    for (let x = 0; x < width; x++) raw.set(colour, y * (width * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('separate chambers: councillors study, look up as reports arrive, then talk (#99)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?scene=hut&mode=chambers');
  await expect.poll(async () => (await hut(page))?.councillors.length, { timeout: 20_000 }).toBe(6);
  await seated(page);

  let r = await hut(page);
  expect(r).toMatchObject({ mode: 'chambers', stage: 'study', speaker: null });
  // The elder sits in the middle of the table, drawn from its 48×48 council sheet.
  const xs = r?.councillors.map((c) => c.x) ?? [];
  expect(seat(r, 'elder')?.x).toBe([...xs].sort((a, b) => a - b)[3]);
  for (const c of r?.councillors ?? []) {
    expect(c.animation).toMatch(/:council:think$/);
    expect(c.scale).toBe(1);
    expect(c.book).toBe(true);
    expect(c.mark).toMatch(/^•+$/);
  }

  await advance(page, 2); // research, then the tester's report
  r = await hut(page);
  expect(r?.step).toBe('research');
  expect(seat(r, 'tester')).toMatchObject({ mark: '✓', book: false });
  expect(seat(r, 'tester')?.animation).toMatch(/:council:idle$/);
  expect(seat(r, 'security')?.animation).toMatch(/:council:think$/);
  await page.screenshot({ path: 'test-results/hut-chambers-study.png' });

  await advance(page, 5); // the remaining reports
  r = await hut(page);
  expect(r?.stage).toBe('dialogue');
  for (const c of r?.councillors ?? []) expect(c).toMatchObject({ mark: null, book: false });
  expect(errors).toEqual([]);
});

test('round table: a raised hand, then the floor moves from speaker to speaker (#99)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?scene=hut&mode=roundTable');
  await expect.poll(async () => (await hut(page))?.councillors.length, { timeout: 20_000 }).toBe(6);
  await seated(page);
  expect(await hut(page)).toMatchObject({ mode: 'roundTable', stage: 'dialogue', step: 'goal' });

  await advance(page, 9); // research, six reports, questions, Security raises a hand
  let r = await hut(page);
  expect(r?.step).toBe('questions');
  expect(seat(r, 'security')).toMatchObject({ hand: true });
  expect(seat(r, 'security')?.animation).toMatch(/:council:raiseHand$/);

  await advance(page); // Security has the floor
  r = await hut(page);
  expect(r?.speaker).toBe('security');
  expect(seat(r, 'security')?.hand).toBe(false);
  expect(seat(r, 'security')?.animation).toMatch(/:council:talk$/);

  await advance(page, 2); // Architect raises a hand; the Tester speaks
  r = await hut(page);
  expect(r?.speaker).toBe('tester');
  expect(seat(r, 'security')?.animation).toMatch(/:council:idle$/);
  expect(seat(r, 'architect')?.hand).toBe(true);
  await page.screenshot({ path: 'test-results/hut-round-table.png' });

  await advance(page, 5); // decisions, then the plan: the elder writes in the Book of Decisions
  r = await hut(page);
  expect(r).toMatchObject({ step: 'plan', speaker: null, decisions: 2 });
  expect(seat(r, 'elder')?.animation).toMatch(/:council:write$/);
  expect(errors).toEqual([]);
});

test('the council walks in through the door to its seats, the farthest first (#219)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?scene=hut&mode=roundTable');
  await expect
    .poll(async () => (await hut(page))?.councillors.some((c) => c.walking), { timeout: 20_000 })
    .toBe(true);
  const r = await hut(page);
  const walker = r?.councillors.find((c) => c.walking);
  expect(walker?.animation).toMatch(/:council:walk$/);
  expect(walker?.at).toBeLessThan(walker?.x as number);
  await page.screenshot({ path: 'test-results/hut-walk-in.png' });
  await seated(page);
  for (const c of (await hut(page))?.councillors ?? []) {
    expect(c.animation).toMatch(/:council:idle$/);
    expect(c.scale).toBe(1);
  }
  expect(errors).toEqual([]);
});

test('with reduced motion the council is seated at once (#219)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scene=hut&mode=roundTable');
  await expect.poll(async () => (await hut(page))?.councillors.length, { timeout: 20_000 }).toBe(6);
  for (const c of (await hut(page))?.councillors ?? []) expect(c).toMatchObject({ walking: false });
});

test('nine councillors fit along the table, shoulder to shoulder (#219)', async ({ page }) => {
  await page.goto('/?scene=hut&mode=roundTable&crowd=1');
  await expect.poll(async () => (await hut(page))?.councillors.length, { timeout: 20_000 }).toBe(9);
  await seated(page);
  const xs = ((await hut(page))?.councillors.map((c) => c.x) ?? []).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) expect((xs[i] as number) - (xs[i - 1] as number)).toBe(48);
  expect((xs[0] as number) - 24).toBeGreaterThanOrEqual(24);
  expect((xs.at(-1) as number) + 24).toBeLessThanOrEqual(456);
  await page.screenshot({ path: 'test-results/hut-nine.png' });
});

test("the hut shows a pack's own room and table, and draws its own without them (#219)", async ({
  page,
}) => {
  const errors = watchErrors(page);
  // A pack without a room or a table (the default pack has the drawn art's, #223).
  await page.route('**/pack/pack.json', async (route) => {
    const manifest = await (await route.fetch()).json();
    delete manifest.scenes?.hutInterior;
    delete manifest.scenes?.hutTable;
    await route.fulfill({ json: manifest });
  });
  await page.goto('/?scene=hut&mode=roundTable');
  await expect.poll(async () => (await hut(page))?.councillors.length, { timeout: 20_000 }).toBe(6);
  expect(await hut(page)).toMatchObject({ room: 'drawn', table: 'drawn' });

  // The same pack with a room and a table: sand walls, and a brown table from y=176 down.
  await page.unroute('**/pack/pack.json');
  await page.route('**/pack/pack.json', async (route) => {
    const manifest = await (await route.fetch()).json();
    manifest.scenes = { hutInterior: 'scenes/hut-interior.png', hutTable: 'scenes/hut-table.png' };
    await route.fulfill({ json: manifest });
  });
  await page.route('**/pack/scenes/hut-interior.png', (route) =>
    route.fulfill({ body: scenePng({ rgba: [0xea, 0xd4, 0xaa, 255] }), contentType: 'image/png' }),
  );
  await page.route('**/pack/scenes/hut-table.png', (route) =>
    route.fulfill({
      body: scenePng({ rgba: [0x73, 0x3e, 0x39, 255], below: 176 }),
      contentType: 'image/png',
    }),
  );
  await page.reload();
  await expect.poll(async () => (await hut(page))?.councillors.length, { timeout: 20_000 }).toBe(6);
  expect(await hut(page)).toMatchObject({ room: 'pack', table: 'pack' });
  await seated(page);
  await page.screenshot({ path: 'test-results/hut-pack-room.png' });
  expect(errors).toEqual([]);
});
