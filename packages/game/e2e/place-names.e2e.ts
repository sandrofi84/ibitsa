import { expect, type Page, test } from '@playwright/test';

// Place names on plates (#240): Home Village's and each island's read over the drawn foam and sea.
interface Probe {
  map(): { placeNames?: string[]; islands: { dim: boolean }[]; startScreen?: boolean } | null;
  snapshot(): { islands: { name: string }[] } | null;
}
const probe = <T>(page: Page, f: (p: Probe) => T) =>
  page.evaluate(
    (src) =>
      new Function('p', `return (${src})(p)`)((window as unknown as { __ibitsa: Probe }).__ibitsa),
    f.toString(),
  ) as Promise<T>;

test('Home Village’s name is on a plate (#240)', async ({ page }) => {
  await page.goto('/?fixture=live');
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => probe(page, (p) => p.map()?.placeNames)).toEqual(['HOME VILLAGE']);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/place-names-village.png' });
});

test('every island’s name is on a plate, dim ones included (#240)', async ({ page }) => {
  await page.goto('/?fixture=live&campaign=separate');
  await expect.poll(() => probe(page, (p) => p.map()?.islands.length), { timeout: 20_000 }).toBe(3);
  const islands = await probe(page, (p) =>
    p.snapshot()?.islands.map((i) => i.name.toUpperCase().slice(0, 28)),
  );
  await expect
    .poll(() => probe(page, (p) => p.map()?.placeNames))
    .toEqual(['HOME VILLAGE', ...(islands ?? [])]);
  // The demo campaign has an island still waiting, drawn dim.
  expect(await probe(page, (p) => p.map()?.islands.some((i) => i.dim))).toBe(true);
  await page.waitForTimeout(1500);
  // The map alone: the hero pane and Needs you would cover the islands.
  await page.addStyleTag({
    content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }',
  });
  await page.screenshot({ path: 'test-results/place-names-campaign.png' });
});
