import { expect, type Page, test } from '@playwright/test';

interface Probe {
  snapshot(): {
    heroes: { state: { kind: string } }[];
    islands: { taskPoints: { state: string }[] }[];
  } | null;
  status(): { finished: boolean; diverged: boolean; waitingFor: string | null };
  zoom(): number;
  hero: { speech(): string | null; icon(): string | null };
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

test('replays m0-walk to the submitted state', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?autoplay=1&speed=16');
  await expect(page.locator('#game canvas')).toBeVisible();

  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 20_000 })
    .toBe('submitted');
  expect(await probe(page, (p) => p.snapshot()?.islands[0]?.taskPoints[0]?.state)).toBe(
    'doneUnreviewed',
  );
  expect(await probe(page, (p) => p.status().finished)).toBe(true);
  // The quest is still active, so the submitted hero says so until you finish it (#57).
  expect(await probe(page, (p) => p.hero.speech())).toBe('Ready for review!');
  await page.screenshot({ path: 'test-results/m0-walk-submitted.png' });
  expect(errors).toEqual([]);
});

test('replays the recorded real quest (m1-real) to the finish', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=m1-real&autoplay=1&speed=16');
  await expect.poll(() => probe(page, (p) => p.status().finished), { timeout: 20_000 }).toBe(true);
  expect(await probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind)).toBe('submitted');
  expect(await probe(page, (p) => p.status().diverged)).toBe(false);
  await page.screenshot({ path: 'test-results/m1-real-finished.png' });
  expect(errors).toEqual([]);
});

test('lets you answer the permission yourself in interactive mode', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?autoplay=1&speed=16&mode=interactive');

  const item = page.locator('.needs-you .item.permission');
  await expect(item).toContainText('Ranger Ilse wants to run command:', { timeout: 20_000 });
  await expect(item.locator('code')).toHaveText('git commit -am "fix: clear return URL on logout"');
  expect(await probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind)).toBe('waitingOnYou');
  // The replay starts waiting when it reaches the recorded answer, a moment after the request appears.
  await expect.poll(() => probe(page, (p) => p.status().waitingFor)).toBe('answerPermission');
  await page.screenshot({ path: 'test-results/m0-walk-waiting.png' });
  // The open hero pane and the Needs You panel never cover each other (#61).
  const pane = await page.getByRole('region', { name: 'Hero' }).boundingBox();
  const panel = await item.boundingBox();
  expect(pane && panel && panel.x + panel.width <= pane.x).toBe(true);

  await item.getByRole('button', { name: 'Allow' }).click();
  await expect(item).toHaveCount(0);
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 20_000 })
    .toBe('submitted');
  expect(await probe(page, (p) => p.status().diverged)).toBe(false);
  expect(errors).toEqual([]);
});

test('re-scales to the largest integer zoom as the viewport grows and shrinks', async ({
  page,
}) => {
  await page.goto('/');
  await expect.poll(() => probe(page, (p) => p.zoom())).toBe(2); // 1000×620
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect.poll(() => probe(page, (p) => p.zoom())).toBe(3);
  await page.setViewportSize({ width: 700, height: 500 });
  await expect.poll(() => probe(page, (p) => p.zoom())).toBe(1);
  const box = await page.locator('#game canvas').boundingBox();
  expect(box && { w: Math.round(box.width), h: Math.round(box.height) }).toEqual({
    w: 480,
    h: 270,
  });
});

test('shows what the hero is doing as an icon beside it (#60)', async ({ page }) => {
  await page.goto('/?autoplay=1&speed=4');
  // Sample the icon in the page every 30 ms: some activities last only a moment at this speed.
  await page.evaluate(() => {
    const w = window as unknown as {
      __ibitsa: { hero: { icon(): string | null } };
      __icons: string[];
    };
    w.__icons = [];
    setInterval(() => {
      const icon = w.__ibitsa.hero.icon();
      if (icon && w.__icons.at(-1) !== icon) w.__icons.push(icon);
    }, 30);
  });
  await expect
    .poll(() => probe(page, (p) => p.hero.icon()), { intervals: [30], timeout: 20_000 })
    .toBe('edit');
  await page.screenshot({ path: 'test-results/activity-icon-edit.png' });
  await expect.poll(() => probe(page, (p) => p.status().finished), { timeout: 30_000 }).toBe(true);
  const seen = await page.evaluate(() => (window as unknown as { __icons: string[] }).__icons);
  expect(seen).toEqual(expect.arrayContaining(['read', 'edit', 'test']));
  // Submitted, not working: no icon.
  expect(await probe(page, (p) => p.hero.icon())).toBeNull();
});
