import { expect, type Page, test } from '@playwright/test';

// Each built-in councillor has its own look (#220): in the council hut, and out on the map as a
// reviewer. A councillor the pack has no look for wears the default's.

interface Probe {
  hut(): { councillors: { id: string; animation: string | null; walking: boolean }[] } | null;
  map(): {
    islands: unknown[];
    reviewers?: { councillorId: string; character: string; walking: boolean }[];
  } | null;
  camera(): { zoom: number } | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

test('the council sits as itself: each councillor at the table in its own look (#220)', async ({
  page,
}) => {
  await page.goto('/?scene=hut&mode=roundTable&crowd=1');
  await expect
    .poll(() => probe(page, (p) => p.hut()?.councillors.length), { timeout: 20_000 })
    .toBe(9);
  await expect
    .poll(() =>
      probe(page, (p) =>
        Object.fromEntries(
          (p.hut()?.councillors ?? []).map((c) => [c.id, c.animation?.split(':')[0] ?? null]),
        ),
      ),
    )
    .toEqual({
      elder: 'councillor.elder',
      architect: 'councillor.architect',
      tester: 'councillor.tester',
      accessibility: 'councillor.accessibility',
      security: 'councillor.security',
      designer: 'councillor.designer',
      // The crowd's councillors have no look of their own, so they wear the default's.
      navigator: 'councillor.default',
      scribe: 'councillor.default',
      herald: 'councillor.default',
    });
  await expect
    .poll(() => probe(page, (p) => p.hut()?.councillors.every((c) => !c.walking)), {
      timeout: 15_000,
    })
    .toBe(true);
  await page.screenshot({ path: 'test-results/councillor-looks-hut.png' });
});

test('reviewers walk out in their own looks (#220)', async ({ page }) => {
  await page.goto('/?fixture=live&campaign=separate&review=demo');
  await expect.poll(() => probe(page, (p) => p.map()?.islands.length), { timeout: 10_000 }).toBe(3);
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByLabel('Message to the hero').fill('Submit it');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect
    .poll(() => probe(page, (p) => (p.map()?.reviewers ?? []).length), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const reviewers = await probe(page, (p) => p.map()?.reviewers ?? []);
  for (const r of reviewers)
    expect(r.character, r.councillorId).toBe(`councillor.${r.councillorId}`);
  await page.screenshot({ path: 'test-results/councillor-looks-reviewers.png' });
});
