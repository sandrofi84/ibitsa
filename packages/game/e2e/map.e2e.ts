import { expect, type Page, test } from '@playwright/test';
import { heroAwaitsOrders } from './home';

interface MapProbe {
  bounds: { x: number; y: number; width: number; height: number };
  islands: { id: string; row: 'top' | 'bottom'; dim: boolean }[];
  bridges: { from: string; to: string; vertical: boolean; lowered: boolean; behind: boolean }[];
  blocked?: { heroId: string; reason: string }[];
}

interface Probe {
  map(): MapProbe | null;
  camera(): { zoom: number } | null;
  snapshot(): { islands: { worktree: string }[] } | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** The whole map in view: auto-focus off, so the camera stays put, then the overview button key. */
async function overview(page: Page): Promise<void> {
  const auto = page.getByRole('button', { name: 'Auto-focus' });
  if ((await auto.getAttribute('aria-pressed')) === 'true') await auto.click();
  await page.locator('body').press('0');
  await expect.poll(() => probe(page, (p) => p.camera()?.zoom)).toBe(1);
}

test('separate islands fan out from the village; the third waits for a slot, its hero at the village (#124)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live&campaign=separate');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.islands.map((i) => i.worktree)), {
      timeout: 10_000,
    })
    .toEqual(['ready', 'ready', 'waiting']);
  // The map draws once the art pack has loaded, which may be a moment after the snapshot.
  await expect.poll(() => probe(page, (p) => p.map()?.islands.length)).toBe(3);
  const map = await probe(page, (p) => p.map());
  expect(map?.islands.map((i) => [i.row, i.dim])).toEqual([
    ['bottom', false],
    ['top', false],
    ['bottom', true],
  ]);
  expect(map?.bridges).toEqual([]);
  expect(map?.blocked?.map((b) => b.reason)).toEqual(['slot']);
  await overview(page);
  await page.screenshot({ path: 'test-results/map-separate.png' });
  expect(errors).toEqual([]);
});

test('stacked islands are bridged; raised until the island before is cleared, then lowered (#124)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live&campaign=stacked');
  await expect
    .poll(() => probe(page, (p) => p.map()?.bridges.map((b) => b.lowered)), { timeout: 10_000 })
    .toEqual([false, false]);
  const map = await probe(page, (p) => p.map());
  expect(map?.islands.map((i) => i.row)).toEqual(['bottom', 'bottom', 'bottom']);
  expect(map?.blocked?.map((b) => b.reason)).toEqual(['previousIsland', 'previousIsland']);
  expect(map?.bounds.width).toBeGreaterThan(480);
  await overview(page);
  await page.screenshot({ path: 'test-results/map-stacked.png' });

  // The first hero hands in its task: the island is cleared and the first bridge comes down.
  await heroAwaitsOrders(page);
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByLabel('Message to the hero').fill('Submit it');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect
    .poll(() => probe(page, (p) => p.map()?.bridges.map((b) => b.lowered)), { timeout: 10_000 })
    .toEqual([true, false]);
  await expect
    .poll(() => probe(page, (p) => p.map()?.blocked?.map((b) => b.reason)))
    .toEqual(['previousIsland']);
  await overview(page);
  await page.screenshot({ path: 'test-results/map-stacked-lowered.png' });
  expect(errors).toEqual([]);
});
