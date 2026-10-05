import { expect, type Page, test } from '@playwright/test';

// The New Quest form, the onboarding card and the hero pane (#37), against the real core and a
// scripted fake runtime (`?fixture=live`).

interface Probe {
  snapshot(): {
    campaign: { status: string } | null;
    heroes: { state: { kind: string }; queuedMessages: number }[];
  } | null;
  hostRequests(): { type: string; key?: string }[];
  heroOnPage(): { x: number; y: number } | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

const heroState = (page: Page) => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('start a quest, message the hero, stop, and finish', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  const form = page.getByRole('dialog', { name: 'New quest' });
  await expect(form.getByText('2 uncommitted changes')).toBeVisible();
  await form.getByLabel('Task').fill('Fix the login redirect\nIt loops forever.');
  await form.getByLabel('Hero class').selectOption('rogue');
  await expect(form.getByLabel('Hero name')).toHaveValue('Rogue Vex');
  await form.getByLabel('Start from branch').selectOption('feature/x');
  await page.screenshot({ path: 'test-results/ui-new-quest.png' });
  await form.getByRole('button', { name: 'Start quest' }).click();
  await expect(form).toBeHidden();

  const pane = page.getByRole('region', { name: 'Hero' });
  await expect(pane.getByRole('heading', { name: 'Rogue Vex' })).toBeVisible();
  await expect(pane).toContainText('Fix the login redirect');
  await expect(page.getByRole('button', { name: 'New quest' })).toBeHidden();
  await expect.poll(() => heroState(page)).toBe('idle');

  await pane.getByLabel('Message to the hero').fill('Add a test for it');
  await pane.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => heroState(page)).toBe('working');
  await pane.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');

  await pane.getByLabel('Message to the hero').fill('Looks good, submit it');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect.poll(() => heroState(page)).toBe('submitted');
  await page.screenshot({ path: 'test-results/ui-hero-pane.png' });
  await pane.getByRole('button', { name: 'Finish quest' }).click();
  await expect(pane.getByRole('status')).toHaveText('The quest has ended. Its branch is kept.');
  await pane.getByRole('button', { name: 'Remove worktree' }).click();
  await expect(pane.getByRole('status')).toHaveText(
    'Worktree removed. The branch ibitsa/fix-the-login-redirect is kept.',
  );
  await expect(pane.getByRole('button', { name: /worktree/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New quest' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the form and the pane work from the keyboard alone', async ({ page }) => {
  await page.goto('/?fixture=live');
  const opener = page.getByRole('button', { name: 'New quest' });
  await expect(opener).toBeVisible();
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Task')).toBeFocused();
  await page.keyboard.type('Tidy the README');
  // Task → class → name → branch → Start.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Start quest' })).toBeFocused();
  await page.keyboard.press('Enter');

  const pane = page.getByRole('region', { name: 'Hero' });
  await expect.poll(() => heroState(page)).toBe('idle');
  await pane.getByLabel('Message to the hero').focus();
  await page.keyboard.type('One more thing');
  await page.keyboard.press('Tab');
  await expect(pane.getByRole('button', { name: 'Send', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => heroState(page)).toBe('working');
  // Focus survives the re-renders that follow.
  await expect(pane.getByRole('button', { name: 'Send', exact: true })).toBeFocused();

  await expect.poll(() => heroState(page)).toBe('idle');
  const abandon = pane.getByRole('button', { name: 'Abandon quest' });
  await abandon.focus();
  await page.keyboard.press('Enter');
  await expect(pane.getByRole('button', { name: 'Really abandon?' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => probe(page, (p) => p.snapshot()?.campaign?.status)).toBe('abandoned');
});

test('without credentials the onboarding card comes first; a rejected key says why', async ({
  page,
}) => {
  await page.goto('/?fixture=live&credentials=none');
  await page.getByRole('button', { name: 'New quest' }).click();
  const dialog = page.getByRole('dialog', { name: 'New quest' });
  await dialog.getByLabel('Task').fill('Fix the login redirect');
  await dialog.getByRole('button', { name: 'Start quest' }).click();

  await expect(
    dialog.getByRole('heading', { name: 'One step before your first quest' }),
  ).toBeVisible();
  const key = dialog.getByLabel('Paste your key');
  await expect(key).toBeFocused();
  await dialog.getByRole('button', { name: 'Get an API key' }).click();
  await key.fill('sk-ant-bad');
  await dialog.getByRole('button', { name: 'Save key and start' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('That key was rejected by Anthropic.');
  expect(await probe(page, (p) => p.snapshot()?.campaign ?? null)).toBeNull();

  await key.fill('sk-ant-good');
  await dialog.getByRole('button', { name: 'Save key and start' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => probe(page, (p) => p.snapshot()?.campaign?.status)).toBe('active');
  expect(await probe(page, (p) => p.hostRequests().map((r) => r.type))).toEqual([
    'credentialsStatus',
    'openApiKeyPage',
    'saveApiKey',
    'saveApiKey',
  ]);
});

test('the hero pane docks right, collapses to a tab, and opens when you click the hero', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');

  const pane = page.getByRole('region', { name: 'Hero' });
  const tab = pane.getByRole('button', { name: /hero pane/ });
  const message = pane.getByLabel('Message to the hero');
  await expect(tab).toHaveAttribute('aria-expanded', 'true');
  const box = await pane.boundingBox();
  expect(box && box.x + box.width).toBeGreaterThan(1000 - 20);

  // Mouse.
  await tab.click();
  await expect(tab).toHaveAttribute('aria-expanded', 'false');
  await expect(message).toBeHidden();
  await expect(tab).toContainText('Ranger Ilse');
  await page.screenshot({ path: 'test-results/ui-pane-collapsed.png' });

  // Keyboard.
  await tab.focus();
  await page.keyboard.press('Enter');
  await expect(message).toBeVisible();
  await page.keyboard.press('Space');
  await expect(message).toBeHidden();

  // Clicking the hero on the map opens the pane and focuses it.
  const hero = await probe(page, (p) => p.heroOnPage());
  expect(hero).not.toBeNull();
  await page.mouse.click(hero?.x ?? 0, hero?.y ?? 0);
  await expect(message).toBeVisible();
  await expect(tab).toBeFocused();
});

test('nothing overlaps at a larger panel size', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
  await page.screenshot({ path: 'test-results/ui-pane-1400.png' });
  const box = await page.getByRole('region', { name: 'Hero' }).boundingBox();
  expect(box && box.x + box.width).toBeGreaterThan(1400 - 20);
});
