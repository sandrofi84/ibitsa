import { expect, type Page, test } from '@playwright/test';
import { openWelcome } from './home';

// @ targets and file references in the command bar (#83), against the live standalone mode, whose
// worktree pretends to hold README.md, package.json, src/app.ts, src/auth/… and a test.

interface Probe {
  snapshot(): { heroes: { state: { kind: string } }[] } | null;
}

const heroState = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __ibitsa: Probe }).__ibitsa.snapshot()?.heroes[0]?.state.kind,
  );

async function questRunning(page: Page): Promise<void> {
  await page.goto('/?fixture=live');
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
}

const bar = (page: Page) => page.getByRole('combobox', { name: 'Command bar' });
const menu = (page: Page) =>
  page.getByRole('region', { name: 'Command bar' }).getByRole('listbox', { name: 'Suggestions' });

test('pick the recipient and two files by keyboard; the hero gets both paths', async ({ page }) => {
  await questRunning(page);
  await bar(page).click();
  await page.keyboard.type('@');
  await expect(menu(page)).toBeVisible();
  await expect(menu(page)).toContainText('Recipients');
  await expect(menu(page)).toContainText('Files');
  await expect(bar(page)).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: 'test-results/at-menu.png' });

  await page.keyboard.type('rang');
  await page.keyboard.press('Enter');
  await expect(bar(page)).toHaveValue('@ranger-ilse ');
  await expect(menu(page)).toBeHidden();

  await page.keyboard.type('look at @redir');
  await expect(menu(page).getByRole('option').first()).toContainText('src/auth/redirect.ts');
  await expect(menu(page)).not.toContainText('Recipients');
  await page.keyboard.press('Enter');
  await page.keyboard.type('and @readm');
  await page.keyboard.press('Tab');
  await expect(bar(page)).toHaveValue('@ranger-ilse look at @src/auth/redirect.ts and @README.md ');

  await page.keyboard.press('Enter');
  await expect(bar(page)).toHaveValue('');
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByRole('button', { name: 'Journal' }).click();
  await expect(pane.getByRole('list', { name: 'Journal' })).toContainText(
    'You: look at @src/auth/redirect.ts and @README.md',
  );
});

test('the menu: ↑/↓ move, a click chooses, Esc closes it before clearing', async ({ page }) => {
  await questRunning(page);
  await bar(page).click();
  await page.keyboard.type('@src/');
  const options = menu(page).getByRole('option');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  const second = await options.nth(1).getAttribute('id');
  await expect(bar(page)).toHaveAttribute('aria-activedescendant', second ?? '');
  await page.keyboard.press('ArrowUp');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(bar(page)).toHaveValue('@src/');
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveValue('');

  await page.keyboard.type('@app');
  await menu(page)
    .getByRole('option', { name: /src\/app\.ts/ })
    .click();
  await expect(bar(page)).toHaveValue('@src/app.ts ');
  await expect(bar(page)).toBeFocused();

  // An email address doesn't open the menu.
  await bar(page).fill('');
  await page.keyboard.type('mail ada@exa');
  await expect(menu(page)).toBeHidden();
});

test("the hero pane's box offers files, never recipients", async ({ page }) => {
  await questRunning(page);
  const box = page.getByRole('region', { name: 'Hero' }).getByLabel('Message to the hero');
  await box.click();
  await page.keyboard.type('@');
  const paneMenu = page.getByRole('region', { name: 'Hero' }).getByRole('listbox');
  await expect(paneMenu).toContainText('README.md');
  await expect(paneMenu).not.toContainText('Recipients');
});
