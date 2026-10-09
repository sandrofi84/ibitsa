import { crc32, deflateSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { openWelcome } from './home';

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
    name: string;
    plate: Box;
  }[];
  decisionsPlate: Box;
}
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
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

test("nine names read on their plates, clear of the drawn table's book (#233)", async ({
  page,
}) => {
  await page.goto('/?scene=hut&mode=roundTable&crowd=1');
  await expect.poll(async () => (await hut(page))?.councillors.length, { timeout: 20_000 }).toBe(9);
  await seated(page);
  const r = await hut(page);
  // The default pack's table is the drawn art (#232): its Book of Decisions lies on the top.
  expect(r?.table).toBe('pack');
  const BOOK = { left: 194, top: 176, right: 287, bottom: 192 };
  const clear = (b: Box) =>
    b.right <= BOOK.left || b.left >= BOOK.right || b.bottom <= BOOK.top || b.top >= BOOK.bottom;
  const plates = (r?.councillors ?? []).map((c) => ({ ...c.plate, name: c.name }));
  for (const p of plates) {
    expect(p.name, 'shown in full').not.toContain('…');
    expect(clear(p), `${p.name} clear of the book`).toBe(true);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.right).toBeLessThanOrEqual(480);
  }
  expect(clear(r?.decisionsPlate as Box), 'the counter clear of the book').toBe(true);
  // No two plates overlap.
  for (const [i, a] of plates.entries())
    for (const b of plates.slice(i + 1)) {
      const apart =
        a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      expect(apart, `${a.name} and ${b.name}`).toBe(true);
    }
  await page.screenshot({ path: 'test-results/hut-names.png' });
});

test("the hut shows a pack's own room and table, and draws its own without them (#219)", async ({
  page,
}) => {
  const errors = watchErrors(page);
  // One handler for the manifest, switched below: first a pack without a room or a table (the
  // default pack has the drawn art's, #223), then one with stand-ins.
  let withScenes = false;
  await page.route('**/pack/pack.json', async (route) => {
    const manifest = await (await route.fetch()).json();
    if (withScenes)
      manifest.scenes = {
        hutInterior: 'scenes/hut-interior.png',
        hutTable: 'scenes/hut-table.png',
      };
    else {
      delete manifest.scenes?.hutInterior;
      delete manifest.scenes?.hutTable;
    }
    await route.fulfill({ json: manifest });
  });
  await page.goto('/?scene=hut&mode=roundTable');
  await expect.poll(async () => (await hut(page))?.councillors.length, { timeout: 20_000 }).toBe(6);
  expect(await hut(page)).toMatchObject({ room: 'drawn', table: 'drawn' });

  // The same pack with a room and a table: sand walls, and a brown table from y=176 down.
  withScenes = true;
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

test('New Quest the moment the pack has loaded, as the map starts, still opens the hut (#254)', async ({
  page,
}) => {
  // On the frame the pack scene hands over to the map, before the map is up.
  await page.addInitScript(() => {
    const watch = () => {
      const p = (
        window as unknown as {
          __ibitsa?: { packLoads(): number; hostEvent(e: unknown): void };
        }
      ).__ibitsa;
      if (p && p.packLoads() > 0) p.hostEvent({ channel: 'host', type: 'openNewQuest' });
      else requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.goto('/?fixture=live');
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome.getByLabel('Task')).toBeFocused({ timeout: 15_000 });
  // Cancel: back to the map, which was asleep under the hut.
  await welcome.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(() => hut(page)).toBeNull();
  await expect(page.getByRole('button', { name: 'Back to the map' })).toBeHidden();
});

/** Where a row of the 480×270 hut is on the page: the canvas is scaled by whole numbers. */
async function onPage(page: Page, y: number): Promise<number> {
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('No canvas.');
  return canvas.y + y * (canvas.height / 270);
}

test("the welcome docks low as the elder's dialogue box, the elder in view above it (#254)", async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await openWelcome(page);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  // The elder's portrait heads its words, as the council's do in their dialogue box.
  const face = welcome.locator('.elder-speech img.portrait');
  await expect(face).toBeVisible();
  expect(await face.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  // Docked at the bottom, below the seated elder's head and shoulders (behind the table's top at 176).
  const box = await welcome.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('No welcome.');
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 24);
  expect(box.y).toBeGreaterThan(await onPage(page, 150));
  // Opaque, so the table and the elder don't show through it.
  expect(await welcome.evaluate((d) => getComputedStyle(d).backgroundColor)).toBe(
    'rgb(239, 224, 184)',
  );
  await page.screenshot({ path: 'test-results/welcome-docked.png' });
});

test('in the smallest panel the docked welcome scrolls, and a quick quest still starts (#254)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto('/?fixture=live');
  await openWelcome(page);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  const box = await welcome.boundingBox();
  if (!box) throw new Error('No welcome.');
  // Never taller than the lower part of the panel.
  expect(box.height).toBeLessThanOrEqual(270 * 0.42 + 1);
  await welcome.getByLabel('Task').fill('Tidy the README');
  await welcome.getByRole('button', { name: 'I know the way' }).click();
  // The buttons stay whole at the box's foot while the fields scroll above them.
  const start = welcome.getByRole('button', { name: 'Start quest' });
  const button = await start.boundingBox();
  if (!button) throw new Error('No Start quest.');
  expect(button.y).toBeGreaterThanOrEqual(box.y);
  expect(button.y + button.height).toBeLessThanOrEqual(box.y + box.height);
  await welcome.getByLabel('Hero name').fill('Ranger Ilse');
  await start.click();
  await expect(welcome).toBeHidden();
});
