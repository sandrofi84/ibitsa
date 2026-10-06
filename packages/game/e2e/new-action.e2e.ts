import { expect, type Page, test } from '@playwright/test';

// The New action form (#86): offered last in the / menu, it saves a prompt as a skill.

interface Probe {
  snapshot(): { heroes: { state: { kind: string } }[] } | null;
  hero: { speech(): string | null };
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

async function questRunning(page: Page): Promise<void> {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Skip the elder' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind)).toBe('idle');
}

async function openForm(page: Page) {
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.click();
  await page.keyboard.type('/new');
  await expect(page.getByRole('listbox').getByRole('option').last()).toContainText('New action…');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New action' });
  await expect(dialog).toBeVisible();
  await expect(bar).toHaveValue('');
  return dialog;
}

test('create an action from the / menu, then run it', async ({ page }) => {
  await questRunning(page);
  const dialog = await openForm(page);
  await expect(dialog.getByLabel('Name')).toBeFocused();
  await dialog.getByRole('button', { name: 'Save action' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Give the action a name.');

  await dialog.getByLabel('Name').fill('pr-summary');
  await dialog.getByLabel('Description').fill('Summarize the branch for a reviewer');
  await dialog.getByLabel('Argument hint (optional)').fill('[focus]');
  await dialog.getByLabel('Prompt').fill('Summarize this branch. Focus on: $ARGUMENTS');
  await expect(dialog.getByRole('radio', { name: /Personal/ })).toBeChecked();
  await page.screenshot({ path: 'test-results/new-action-form.png' });
  await dialog.getByRole('button', { name: 'Save action' }).click();
  await expect(dialog).toBeHidden();

  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.click();
  await page.keyboard.type('/pr-s');
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText(
    '/pr-summary [focus]',
  );
  await page.keyboard.press('Enter');
  await page.keyboard.type('tests');
  await page.keyboard.press('Enter');
  await expect.poll(() => probe(page, (p) => p.hero.speech())).toBe('Done: /pr-summary tests');
});

test('a taken name offers Rename or Overwrite', async ({ page }) => {
  await questRunning(page);
  const dialog = await openForm(page);
  await dialog.getByLabel('Name').fill('pr');
  await dialog.getByLabel('Description').fill('My own PR action');
  await dialog.getByLabel('Prompt').fill('Open a PR my way.');
  await dialog.getByRole('radio', { name: /Project/ }).check();
  await dialog.getByRole('button', { name: 'Save action' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('There is already a skill named pr.');
  await expect(dialog.getByRole('button', { name: 'Overwrite' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Rename to pr-2' }).click();
  await expect(dialog).toBeHidden();

  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.click();
  await page.keyboard.type('/pr-');
  await expect(page.getByRole('listbox')).toContainText('/pr-2');
});
