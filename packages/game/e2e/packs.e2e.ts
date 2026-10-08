import { expect, type Page, test } from '@playwright/test';

interface Probe {
  guildHallOnPage(): { x: number; y: number } | null;
  guildHall(): string | null;
  packLoads(): number;
  map(): unknown;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

test('the Packs tab: packs with their errors, a preview, and switching without a reload (#183)', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?fixture=live');
  await expect.poll(() => probe(page, (p) => p.packLoads()), { timeout: 15_000 }).toBe(1);
  await expect(async () => {
    const at = await probe(page, (p) => p.guildHallOnPage());
    expect(at).not.toBeNull();
    if (!at) return;
    await page.mouse.click(at.x, at.y);
    expect(await probe(page, (p) => p.guildHall())).not.toBeNull();
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
  const hall = page.getByRole('region', { name: 'Guild Hall' });
  await hall.getByRole('tab', { name: 'Packs' }).click();

  const entry = (name: string) => hall.locator('.pack').filter({ hasText: name });
  await expect(entry('Default')).toContainText('In use');
  await expect(entry('half-done')).toContainText('characters: missing "hero.ranger"');
  await expect(entry('half-done').getByRole('button', { name: 'Use this pack' })).toBeDisabled();
  await expect(entry('retro').getByRole('img', { name: /walking/ })).toBeVisible();
  // An older pack's warning shows, marked as a warning, and doesn't stop it being used (#235).
  await expect(entry('classic').locator('.pack-warning')).toHaveText(
    'Warning: tiles: grass, sand are no longer used; only water is drawn',
  );
  await expect(entry('half-done').locator('.pack-error').first()).toContainText('Error: ');
  await expect(entry('classic').getByRole('button', { name: 'Use this pack' })).toBeEnabled();
  await page.screenshot({ path: 'test-results/packs.png' });

  // Switching loads the pack again and brings the map back, with no page reload.
  await page.evaluate(() => {
    (window as unknown as { notReloaded: boolean }).notReloaded = true;
  });
  await entry('retro').getByRole('button', { name: 'Use this pack' }).click();
  await expect(entry('retro')).toContainText('In use');
  await expect.poll(() => probe(page, (p) => p.packLoads())).toBe(2);
  await expect.poll(() => probe(page, (p) => p.map() !== null)).toBe(true);
  expect(
    await page.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded),
  ).toBe(true);
  // The pack with only a warning switches in like any other (#235).
  await entry('classic').getByRole('button', { name: 'Use this pack' }).click();
  await expect(entry('classic')).toContainText('In use');
  await expect.poll(() => probe(page, (p) => p.packLoads())).toBe(3);
  await entry('Default').getByRole('button', { name: 'Use this pack' }).click();
  await expect.poll(() => probe(page, (p) => p.packLoads())).toBe(4);
  expect(errors).toEqual([]);
});
