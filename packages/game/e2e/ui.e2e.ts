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
  await form.getByLabel('Task').fill('Fix the login redirect\nIt loops forever.');
  await page.getByRole('button', { name: 'Skip the elder' }).click();
  await expect(form.getByText('2 uncommitted changes')).toBeVisible();
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
  // Task → Ask the elder → Skip the elder, which moves on to the hero's class; then name → branch → Start.
  for (let i = 0; i < 2; i++) await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Skip the elder' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Hero class')).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
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
  await page.getByRole('button', { name: 'Skip the elder' }).click();
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
  await page.getByRole('button', { name: 'Skip the elder' }).click();
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
  await page.getByRole('button', { name: 'Skip the elder' }).click();
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
  await page.getByRole('button', { name: 'Skip the elder' }).click();
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
  // The bubble's bottom sits 14 map pixels above the sprite's middle and keeps its size (#75): its
  // text's middle is 8 canvas pixels higher whatever the camera zoom.
  const { base, cam } = await probe(page, (p) => ({ base: p.zoom(), cam: p.camera()?.zoom ?? 1 }));
  await page.mouse.click(hero?.x ?? 0, (hero?.y ?? 0) - (14 * cam + 8) * base);
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
  await page.getByRole('button', { name: 'Skip the elder' }).click();
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

test('always allow: for this quest, or in this project with a way to take it back (#62)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Skip the elder' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
  const pane = page.getByRole('region', { name: 'Hero' });
  const needsYou = page.locator('.needs-you .item.permission');

  await pane.getByLabel('Message to the hero').fill('Please commit');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect(needsYou).toContainText('Always allow adds: Bash(git commit:*)');
  await page.screenshot({ path: 'test-results/ui-always-allow.png' });
  await needsYou.getByRole('button', { name: 'Always allow in this project' }).click();
  await expect(needsYou).toHaveCount(0);

  const rules = pane.getByRole('region', { name: 'Project rules' });
  await expect(rules).toContainText('Bash(git commit:*)');
  await page.screenshot({ path: 'test-results/ui-project-rules.png' });
  await rules.getByRole('button', { name: 'Remove Bash(git commit:*)' }).click();
  await expect(rules).toBeHidden();

  // For this quest only: the rule never shows up among the project's.
  await expect.poll(() => heroState(page)).toBe('idle');
  await pane.getByLabel('Message to the hero').fill('commit again');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await needsYou.getByRole('button', { name: 'Always allow for this quest' }).click();
  await expect(needsYou).toHaveCount(0);
  await expect(rules).toBeHidden();
});

test('auto mode allows the hero without asking, says so, and asks again once off (#63)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Skip the elder' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
  const pane = page.getByRole('region', { name: 'Hero' });
  const needsYou = page.locator('.needs-you .item.permission');

  await pane.getByRole('button', { name: 'Turn auto mode on' }).click();
  await expect(pane.getByRole('status').filter({ hasText: 'Auto mode is on' })).toBeVisible();
  await expect(pane.getByRole('button', { name: /hero pane/ })).toContainText('AUTO');

  await pane.getByLabel('Message to the hero').fill('Please commit');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect.poll(() => probe(page, (p) => p.hero.speech())).toBe('Committed.');
  await expect(needsYou).toHaveCount(0);
  await page.screenshot({ path: 'test-results/ui-auto-mode.png' });
  await pane.getByRole('button', { name: 'Journal' }).click();
  const journal = pane.getByRole('list', { name: 'Journal' });
  await expect(journal).toContainText('You turned auto mode on.');
  await expect(journal).toContainText('Auto-allowed: run command git commit -m "demo"');

  await pane.getByRole('button', { name: 'Turn auto mode off' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
  await pane.getByLabel('Message to the hero').fill('commit again');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect(needsYou).toHaveCount(1);
});

test('without a sandbox, turning auto mode on asks once more (#63)', async ({ page }) => {
  await page.goto('/?fixture=live&sandbox=none');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Skip the elder' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByRole('button', { name: 'Turn auto mode on' }).click();
  const confirm = pane.getByRole('button', { name: 'No sandbox here: turn on anyway?' });
  await expect(confirm).toBeFocused();
  await confirm.click();
  await expect(
    pane.getByRole('status').filter({ hasText: 'There is no sandbox here' }),
  ).toBeVisible();
});

test('rest compacts the session: the hero rests, then waits for orders again (#82)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Skip the elder' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByRole('button', { name: 'Rest' }).click();
  await expect.poll(() => heroState(page), { intervals: [50] }).toBe('resting');
  await expect.poll(() => heroState(page)).toBe('idle');
  await pane.getByRole('button', { name: 'Journal' }).click();
  await expect(pane.getByRole('list', { name: 'Journal' })).toContainText('You let the hero rest.');
});

test('the elder researches first, then its brief starts a quick quest (#101)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  const form = page.getByRole('dialog', { name: 'New quest' });
  await expect(form.getByLabel('Hero class')).toBeHidden();
  await form.getByLabel('Task').fill('Fix the login redirect\nIt loops forever.');
  await form.getByRole('button', { name: 'Ask the elder' }).click();
  await expect(form).toBeHidden();

  const elder = page.getByRole('region', { name: 'Elder' });
  await expect(elder).toContainText('Researching your task…');
  await expect(page.getByRole('button', { name: 'New quest' })).toBeHidden();
  await expect(elder.getByRole('heading', { name: 'Files' })).toBeVisible();
  await expect(elder).toContainText('A quick quest will do. One small, clear change.');
  await expect(elder).toContainText('src/app.ts:1-40 where the change goes');
  await expect(elder).toContainText('tester The change needs a test.');
  await expect(elder).toContainText('Gold spent: $0.04');
  await expect(elder.getByRole('button', { name: 'Convene council' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/elder-brief.png' });

  await elder.getByRole('button', { name: 'Quick quest' }).click();
  await expect(form.getByLabel('Task')).toHaveValue('Fix the login redirect\nIt loops forever.');
  await expect(form.getByLabel('Hero class')).toBeFocused();
  await form.getByRole('button', { name: 'Start quest' }).click();
  await expect(elder).toBeHidden();
  await expect.poll(() => heroState(page)).toBe('idle');
  expect(await probe(page, (p) => p.snapshot()?.campaign?.status)).toBe('active');
  expect(errors).toEqual([]);
});

test('a failed brief offers asking again, a quick quest anyway, or abandoning (#101)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Make it fail');
  await page.getByRole('button', { name: 'Ask the elder' }).click();
  const elder = page.getByRole('region', { name: 'Elder' });
  await expect(elder.getByRole('alert')).toHaveText(
    'The elder ran out of gold before finishing the brief.',
  );
  await elder.getByRole('button', { name: 'Ask again' }).click();
  await expect(elder).toContainText('Researching your task…');
  await expect(elder.getByRole('alert')).toBeVisible();
  await elder.getByRole('button', { name: 'Abandon' }).click();
  await expect(elder).toBeHidden();
  await expect(page.getByRole('button', { name: 'New quest' })).toBeVisible();
});
