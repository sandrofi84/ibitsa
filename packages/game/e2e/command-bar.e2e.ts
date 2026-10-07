import { expect, type Page, test } from '@playwright/test';
import { openWelcome } from './home';

// The command bar (#81): one input at the bottom; the hero pane's box is the same input.

interface Probe {
  snapshot(): { heroes: { state: { kind: string } }[]; needsYou: unknown[] } | null;
  hero: { speech(): string | null };
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

const heroState = (page: Page) => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind);

async function questRunning(page: Page): Promise<void> {
  await page.goto('/?fixture=live');
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'I know the way' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
}

test('with no quest, / focuses the bar and Enter opens the New Quest form with the task', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await expect(page.getByRole('region', { name: 'Command bar' })).toContainText(
    'Enter starts a quest with this as its task.',
  );
  await page.locator('body').press('/');
  await expect(bar).toBeFocused();
  await page.keyboard.type('Fix the login redirect');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Welcome' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Task')).toHaveValue('Fix the login redirect');
});

test('Enter sends after the current step, ⌥Enter now, ⇧Enter adds a line', async ({ page }) => {
  await questRunning(page);
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await expect(bar).toHaveAttribute('placeholder', /Message Ranger Ilse/);
  await bar.click();
  await page.keyboard.type('First line');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second line');
  await expect(bar).toHaveValue('First line\nsecond line');
  await page.keyboard.press('Enter');
  await expect(bar).toHaveValue('');
  await expect.poll(() => probe(page, (p) => p.hero.speech())).toBe('Done: First line second line');

  await expect.poll(() => heroState(page)).toBe('idle');
  await bar.fill('Hurry up');
  await page.keyboard.press('Alt+Enter');
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByRole('button', { name: 'Journal' }).click();
  const journal = pane.getByRole('list', { name: 'Journal' });
  await expect(journal).toContainText('You: First line');
  await expect(journal).toContainText('You (now): Hurry up');
  await page.screenshot({ path: 'test-results/command-bar.png' });
});

test('↑ and ↓ recall earlier messages; Esc clears, then leaves; ⌘K comes back', async ({
  page,
}) => {
  await questRunning(page);
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.click();
  for (const text of ['one', 'two']) {
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('draft');
  await page.keyboard.press('ArrowUp');
  await expect(bar).toHaveValue('two');
  await page.keyboard.press('ArrowUp');
  await expect(bar).toHaveValue('one');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(bar).toHaveValue('draft');

  await page.keyboard.press('Escape');
  await expect(bar).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(bar).not.toBeFocused();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(bar).toBeFocused();

  // The pane's box shares the history.
  const box = page.getByRole('region', { name: 'Hero' }).getByLabel('Message to the hero');
  await box.click();
  await page.keyboard.press('ArrowUp');
  await expect(box).toHaveValue('two');
});

test('Needs you sits above the bar', async ({ page }) => {
  await questRunning(page);
  const needsYou = page.locator('.needs-you .item').first();
  await expect(needsYou).toBeVisible();
  const item = await needsYou.boundingBox();
  const bar = await page.getByRole('region', { name: 'Command bar' }).boundingBox();
  expect(item && bar && item.y + item.height <= bar.y).toBe(true);
});
