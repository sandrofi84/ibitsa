import { expect, type Page, test } from '@playwright/test';

// The New Quest form, the onboarding card and the hero pane (#37), against the real core and a
// scripted fake runtime (`?fixture=live`).

interface Probe {
  snapshot(): {
    campaign: { status: string } | null;
    heroes: { state: { kind: string }; queuedMessages: number }[];
  } | null;
  hostRequests(): { type: string; key?: string }[];
  hero: {
    onPage(): { x: number; y: number } | null;
    speech(): string | null;
    icon(): string | null;
  };
  zoom(): number;
  camera(): { zoom: number } | null;
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
  const hero = await probe(page, (p) => p.hero.onPage());
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

test('speech bubbles: a message excerpt that fades, then "Ready for review!" until you finish', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start quest' }).click();
  const speech = () => probe(page, (p) => p.hero.speech());

  // The scripted reply is "I looked around and made a first change. What next?"
  await expect.poll(speech).toBe('I looked around and made a first…');
  await page.screenshot({ path: 'test-results/ui-speech-message.png' });
  await expect.poll(speech, { timeout: 8_000 }).toBeNull();

  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByLabel('Message to the hero').fill('Looks good, submit it');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect.poll(speech).toBe('Ready for review!');
  await page.screenshot({ path: 'test-results/ui-speech-ready.png' });
  // It stays: no fade while the work waits for you.
  await page.waitForTimeout(5_000);
  expect(await speech()).toBe('Ready for review!');

  // Clicking it opens the pane at the hero's summary.
  await pane.getByRole('button', { name: /hero pane/ }).click();
  await expect(pane.getByLabel('Message to the hero')).toBeHidden();
  const hero = await probe(page, (p) => p.hero.onPage());
  // The bubble sits 22 map pixels above the sprite's middle: scaled by the panel and the camera.
  const zoom = await probe(page, (p) => p.zoom() * (p.camera()?.zoom ?? 1));
  await page.mouse.click(hero?.x ?? 0, (hero?.y ?? 0) - 22 * zoom);
  await expect(pane.getByText('Ready for review.')).toBeVisible();

  await pane.getByRole('button', { name: 'Finish quest' }).click();
  await expect.poll(speech).toBeNull();
});

test('the journal lists what happened, newest last, and stays open across collapses (#58)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');

  const pane = page.getByRole('region', { name: 'Hero' });
  const toggle = pane.getByRole('button', { name: 'Journal' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // Keyboard: the toggle opens it.
  await toggle.focus();
  await page.keyboard.press('Enter');
  const journal = pane.getByRole('list', { name: 'Journal' });
  await expect(journal).toBeVisible();
  await expect(journal.getByRole('listitem').first()).toContainText(
    'Quest started: Tidy the README',
  );
  await expect(journal).toContainText(
    'Ranger Ilse: I looked around and made a first change. What next?',
  );
  await expect(journal).toContainText('edit · src/app.ts');

  await pane.getByLabel('Message to the hero').fill('Add a test');
  await pane.getByRole('button', { name: 'Send', exact: true }).click();
  await pane.getByRole('button', { name: 'Stop' }).click();
  await expect(journal.getByRole('listitem').last()).toContainText(
    /You stopped the hero|Done: Add a test/,
  );
  await expect(journal).toContainText('You: Add a test');
  await page.screenshot({ path: 'test-results/ui-journal.png' });

  // Collapsing the pane and opening it again keeps the journal open.
  const tab = pane.getByRole('button', { name: /hero pane/ });
  await tab.click();
  await tab.click();
  await expect(journal).toBeVisible();
});
