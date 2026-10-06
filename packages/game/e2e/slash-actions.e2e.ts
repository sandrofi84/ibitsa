import { expect, type Page, test } from '@playwright/test';

// The / menu (#84): actions from the hero's folder, Ibitsa's built-ins first.

interface Probe {
  snapshot(): { heroes: { state: { kind: string } }[] } | null;
  hero: { speech(): string | null };
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

const heroState = (page: Page) => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind);

test('pick /test by keyboard, add an argument, send it to the hero', async ({ page }) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Skip the elder' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');

  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.click();
  await page.keyboard.type('/');
  const menu = page.getByRole('listbox');
  await expect(menu.getByRole('option').first()).toContainText('/test [filter]');
  await expect(menu).toContainText('Ibitsa');
  await expect(menu).toContainText('/pr [reviewers]');
  await page.screenshot({ path: 'test-results/slash-menu.png' });

  await page.keyboard.type('te');
  await page.keyboard.press('Enter');
  await expect(bar).toHaveValue('/test ');
  await page.keyboard.type('unit');
  await page.keyboard.press('Enter');
  await expect.poll(() => probe(page, (p) => p.hero.speech())).toBe('Done: /test unit');
});

test('the / menu only opens for the first word, or right after the recipient', async ({ page }) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Skip the elder' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.click();
  await page.keyboard.type('please /te');
  await expect(bar).toHaveAttribute('aria-expanded', 'false');
  await bar.fill('');
  await page.keyboard.type('@ranger-ilse /ex');
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText('/explain');
});
