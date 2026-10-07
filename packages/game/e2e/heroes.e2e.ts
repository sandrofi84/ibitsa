import { expect, type Page, test } from '@playwright/test';

interface Probe {
  snapshot(): {
    heroes: { id: string; name: string; state: { kind: string } }[];
  } | null;
  selected(): string | null;
  map(): { following?: string | null } | null;
  hero: { onPage(): { x: number; y: number } | null };
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

const states = (page: Page) =>
  probe(page, (p) => p.snapshot()?.heroes.map((h) => `${h.name}:${h.state.kind}`) ?? []);
const selectedName = (page: Page) =>
  probe(page, (p) => p.snapshot()?.heroes.find((h) => h.id === p.selected())?.name ?? null);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test("two heroes: choose whom the pane shows, message one, message all, and each one's / menu (#125)", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live&heroes=2');
  await expect
    .poll(() => states(page), { timeout: 15_000 })
    .toEqual(['Ranger Ilse:idle', 'Rogue Vex:idle']);

  // The pane lists both heroes; the first one that needs you is selected.
  const pane = page.getByRole('region', { name: 'Hero' });
  const heroes = pane.getByRole('navigation', { name: 'Heroes' });
  await expect(heroes.getByRole('button')).toHaveCount(2);
  await expect(pane.getByRole('heading', { name: 'Ranger Ilse' })).toBeVisible();
  expect(await selectedName(page)).toBe('Ranger Ilse');

  // Choosing Rogue Vex shows it, and the bar speaks to it.
  await heroes.getByRole('button', { name: /^Rogue Vex/ }).click();
  await expect(pane.getByRole('heading', { name: 'Rogue Vex' })).toBeVisible();
  await expect(heroes.getByRole('button', { name: /^Rogue Vex/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await expect(bar).toHaveAttribute('placeholder', /Message Rogue Vex/);
  // The map camera follows the chosen hero (#124's selectHero, driven by #125's selection).
  const rogue = await probe(page, (p) => p.snapshot()?.heroes[1]?.id);
  await expect.poll(() => probe(page, (p) => p.map()?.following)).toBe(rogue);
  await page.screenshot({ path: 'test-results/two-heroes.png' });

  await bar.fill('Add a test');
  await bar.press('Enter');
  await expect.poll(() => states(page)).toEqual(['Ranger Ilse:idle', 'Rogue Vex:working']);
  await expect
    .poll(() => states(page), { timeout: 10_000 })
    .toEqual(['Ranger Ilse:idle', 'Rogue Vex:idle']);

  // @ names one hero; @all reaches both.
  await bar.fill('@ranger-ilse look again');
  await bar.press('Enter');
  await expect.poll(() => states(page)).toEqual(['Ranger Ilse:working', 'Rogue Vex:idle']);
  await expect
    .poll(() => states(page), { timeout: 10_000 })
    .toEqual(['Ranger Ilse:idle', 'Rogue Vex:idle']);
  await bar.fill('@all wrap up');
  await bar.press('Enter');
  await expect.poll(() => states(page)).toEqual(['Ranger Ilse:working', 'Rogue Vex:working']);
  await expect
    .poll(() => states(page), { timeout: 10_000 })
    .toEqual(['Ranger Ilse:idle', 'Rogue Vex:idle']);

  // The / menu works for the second hero's worktree too.
  await bar.fill('@rogue-vex /');
  await expect(page.getByRole('option', { name: /\/test/ })).toBeVisible();
  await bar.press('Escape');
  await bar.fill('');

  // Clicking a hero's "Needs you" item shows that hero.
  await page
    .locator('.needs-you .item')
    .filter({ hasText: 'Ranger Ilse' })
    .first()
    .locator('p')
    .first()
    .click();
  await expect(pane.getByRole('heading', { name: 'Ranger Ilse' })).toBeVisible();

  // So does clicking a hero on the map.
  await heroes.getByRole('button', { name: /^Rogue Vex/ }).click();
  await expect(pane.getByRole('heading', { name: 'Rogue Vex' })).toBeVisible();
  // The camera follows Rogue Vex now (#124), so Ranger Ilse may be off screen: show the whole map,
  // then click Ilse's token, reading its place again on each try while the camera settles.
  await page.locator('body').press('0');
  await expect(async () => {
    const at = await probe(page, (p) => p.hero.onPage());
    expect(at).not.toBeNull();
    if (!at) return;
    const under = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName ?? null,
      at,
    );
    expect(under, `something covers Ranger Ilse at ${at.x},${at.y}`).toBe('CANVAS');
    await page.mouse.click(at.x, at.y);
    expect(await selectedName(page)).toBe('Ranger Ilse');
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
  expect(errors).toEqual([]);
});

test('one hero looks as before: no hero list (#125)', async ({ page }) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Skip the elder' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  const pane = page.getByRole('region', { name: 'Hero' });
  await expect(pane.getByRole('heading', { name: /Ranger/ })).toBeVisible();
  await expect(pane.getByRole('navigation', { name: 'Heroes' })).toBeHidden();
});
