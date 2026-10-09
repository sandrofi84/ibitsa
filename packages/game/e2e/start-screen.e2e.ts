import { expect, type Page, test } from '@playwright/test';
import { openWelcome } from './home';

interface Probe {
  snapshot(): { islands: { id: string }[]; campaign: { status: string } | null } | null;
  map(): { startScreen?: boolean; charted?: string[]; sunk?: boolean } | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

test('the start screen: the hut welcomes you, "Start a quick quest now" charts an island, and it sinks after (#180)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  // Home Village with its two buildings, and no "New quest" button.
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen)).toBe(true);
  await expect(page.getByRole('button', { name: 'New quest' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/start-screen.png' });

  // The council hut opens the elder's welcome.
  await openWelcome(page);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome).toContainText('We heard you are looking for Ibitsa…');
  await expect(welcome).toContainText('…what do you want to do there?');
  await expect(
    welcome.getByRole('button', { name: 'Ask the elder to research it first' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/welcome.png' });

  // Start a quick quest now: a quick quest, with the hero's fields.
  await welcome.getByLabel('Task').fill('Tidy the README');
  await welcome.getByRole('button', { name: 'Start a quick quest now' }).click();
  await expect(welcome.getByLabel('Hero class')).toBeFocused();
  await welcome.getByRole('button', { name: 'Start quest' }).click();
  await expect(welcome).toBeHidden();

  // Its island is charted out of the fog, and the start screen's labels go.
  const islandId = await probe(page, (p) => p.snapshot()?.islands[0]?.id);
  await expect.poll(() => probe(page, (p) => p.map()?.charted)).toEqual([islandId]);
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen)).toBe(false);

  // Abandoned: the island sinks, and Home Village is ready for the next search.
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByRole('button', { name: 'Abandon quest' }).click();
  await pane.getByRole('button', { name: 'Really abandon?' }).click();
  await expect.poll(() => probe(page, (p) => p.map()?.sunk)).toBe(true);
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen)).toBe(true);
  // The campaign's end opens over the map once its record is written (#255): close it, as a player would.
  const ended = page.getByRole('dialog').filter({ hasText: 'The campaign was abandoned' });
  await ended.getByRole('button', { name: 'Close' }).click();
  await expect(ended).toBeHidden();
  // Nothing waits on a hero whose quest is over.
  await expect(page.getByRole('region', { name: 'Needs you' })).toBeHidden();
  await openWelcome(page);
});

interface HutProbe {
  hut(): {
    mode: string | null;
    step: string;
    councillors: { id: string; walking: boolean }[];
  } | null;
  hutOnPage(): { x: number; y: number } | null;
}

const hut = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ibitsa: HutProbe }).__ibitsa.hut());

test('the hut opens on the elder alone, who walks in before the welcome; the work stays in the hut (#244)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen)).toBe(true);

  // The hut opens with the elder walking in; the welcome waits until it's seated.
  await openWelcome(page);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  const seen = await hut(page);
  expect(seen?.mode).toBeNull();
  expect(seen?.step).toBe('goal');
  expect(seen?.councillors).toEqual([expect.objectContaining({ id: 'elder', walking: false })]);
  await page.screenshot({ path: 'test-results/hut-welcome.png' });

  // Cancel: back to the map.
  await welcome.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(() => hut(page)).toBeNull();
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen)).toBe(true);

  // Asking the elder keeps the user in the hut, with its findings.
  await openWelcome(page);
  await welcome.getByLabel('Task').fill('Fix the login redirect');
  await welcome.getByRole('button', { name: 'Ask the elder to research it first' }).click();
  const elder = page.getByRole('region', { name: 'Elder' });
  await expect(elder).toContainText("The elder's findings");
  await expect.poll(async () => (await hut(page))?.step).toBe('research');

  // Out by the door, the elder's panel stays on the map; the hut leads back in (#245).
  await page.getByRole('button', { name: 'Back to the map' }).click();
  await expect.poll(() => hut(page)).toBeNull();
  await expect(elder).toBeVisible();
  await expect(async () => {
    const at = await page.evaluate(() =>
      (window as unknown as { __ibitsa: HutProbe }).__ibitsa.hutOnPage(),
    );
    if (at) await page.mouse.click(at.x, at.y);
    expect(await hut(page)).not.toBeNull();
  }).toPass({ timeout: 10_000 });

  // Convening: the councillors walk in to join the elder, who stays in its seat.
  await elder.getByRole('button', { name: 'Convene council' }).click();
  const convene = page.getByRole('dialog', { name: 'Convene the council' });
  await convene.getByRole('button', { name: 'Convene' }).click();
  await expect
    .poll(async () => (await hut(page))?.councillors.filter((c) => c.walking).length ?? 0)
    .toBeGreaterThan(0);
  const joining = await hut(page);
  expect(joining?.councillors.find((c) => c.id === 'elder')?.walking).toBe(false);
});
