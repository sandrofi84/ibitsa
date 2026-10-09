import { expect, type Page, test } from '@playwright/test';
import { openWelcome } from './home';

// The New Quest form, the onboarding card and the hero pane (#37), against the real core and a
// scripted fake runtime (`?fixture=live`).

interface Probe {
  snapshot(): {
    campaign: {
      status: string;
      branching: string;
      stackedStart: string | null;
      capMicroUsd: number | null;
    } | null;
    heroes: {
      id: string;
      name: string;
      classId: string;
      state: { kind: string };
      queuedMessages: number;
    }[];
    islands: {
      id: string;
      basedOn: string | null;
      worktree: string;
      taskPoints: { state: string }[];
    }[];
    sitting: { mode: string; comparisonOf: string | null; rating: unknown } | null;
  } | null;
  hut(): { decisions: number } | null;
  map(): { startScreen?: boolean; sunk?: boolean } | null;
  sent(): { type: string; parties?: unknown }[];
  hostRequests(): { type: string; key?: string }[];
  hero: {
    onPage(): { x: number; y: number } | null;
    speech(): string | null;
    icon(): string | null;
  };
  zoom(): number;
  camera(): { zoom: number } | null;
  hut(): { mode: string; stage: string } | null;
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
  await openWelcome(page);
  const form = page.getByRole('dialog', { name: 'Welcome' });
  await form.getByLabel('Task').fill('Fix the login redirect\nIt loops forever.');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
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
  // A quest runs: Home Village no longer shows the start screen's labels (#180).
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen)).toBe(false);
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
  // The quest's island has sunk and Home Village is ready for the next search (#180).
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen)).toBe(true);
  await expect.poll(() => probe(page, (p) => p.map()?.sunk)).toBe(true);
  expect(errors).toEqual([]);
});

test('the form and the pane work from the keyboard alone', async ({ page }) => {
  await page.goto('/?fixture=live');
  // "Ibitsa: New Quest" from the Command Palette opens the council's welcome (#180).
  await page.evaluate(() =>
    (window as unknown as { __ibitsa: { hostEvent(e: unknown): void } }).__ibitsa.hostEvent({
      channel: 'host',
      type: 'openNewQuest',
    }),
  );
  await expect(page.getByLabel('Task')).toBeFocused();
  await page.keyboard.type('Tidy the README');
  // Task → Ask the elder to research it first → Start a quick quest now, which moves on to the hero's class; then name → branch → Start.
  for (let i = 0; i < 2; i++) await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Start a quick quest now' })).toBeFocused();
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
  await openWelcome(page);
  const dialog = page.getByRole('dialog', { name: 'Welcome' });
  await dialog.getByLabel('Task').fill('Fix the login redirect');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
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
  // The sound board reads the volumes at start-up (#184); the credentials' requests are these.
  const requests = await probe(page, (p) => p.hostRequests().map((r) => r.type));
  expect(requests.filter((r) => r !== 'readSettings')).toEqual([
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
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
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
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
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
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
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

test('a reply after "Ready for review!" shows over the bubble and in full in the pane (#262)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  const speech = () => probe(page, (p) => p.hero.speech());
  const pane = page.getByRole('region', { name: 'Hero' });
  const reply = pane.locator('.reply');
  await expect.poll(() => heroState(page)).toBe('idle');
  // Nothing asked yet, so no reply block.
  await expect(reply).toBeHidden();

  await pane.getByLabel('Message to the hero').fill('Looks good, submit it');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect.poll(speech).toBe('Ready for review!');

  // Asked after submitting, the hero's answer shows over "Ready for review!", which then comes back.
  await pane.getByLabel('Message to the hero').fill('What did you do?');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect.poll(speech).toBe('Done: What did you do?');
  await expect(reply).toContainText('Ranger Ilse replied');
  await expect(reply).toContainText('Done: What did you do?');
  await page.screenshot({ path: 'test-results/ui-reply-submitted.png' });
  await expect.poll(speech, { timeout: 8_000 }).toBe('Ready for review!');

  // Collapsed, the pane's tab marks a new reply until it's opened.
  const tab = pane.getByRole('button', { name: /hero pane/ });
  await tab.click();
  const mark = pane.getByLabel('new reply');
  await expect(mark).toBeHidden();
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.fill('And why?');
  await page.keyboard.press('Alt+Enter');
  await expect(mark).toBeVisible();
  await tab.click();
  await expect(reply).toContainText('Done: And why?');
  await expect(reply).not.toContainText('Done: What did you do?');
  await expect(mark).toBeHidden();
});

test('the journal lists what happened, newest last, and stays open across collapses (#58)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
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
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
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
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
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
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
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
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
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
  await openWelcome(page);
  const form = page.getByRole('dialog', { name: 'Welcome' });
  await expect(form.getByLabel('Hero class')).toBeHidden();
  await form.getByLabel('Task').fill('Fix the login redirect\nIt loops forever.');
  await form.getByRole('button', { name: 'Ask the elder to research it first' }).click();
  await expect(form).toBeHidden();

  // While it works the panel says "The elder searches the old charts…" (checked in the failed-brief
  // test: this scripted research can finish before a look).
  const elder = page.getByRole('region', { name: 'Elder' });
  await expect(elder).toContainText("The elder's findings");
  await expect(elder.getByRole('heading', { name: 'Files' })).toBeVisible();
  await expect(elder).toContainText('A quick quest will do. One small, clear change.');
  await expect(elder).toContainText('src/app.ts:1-40 where the change goes');
  await expect(elder).toContainText('tester The change needs a test.');
  await expect(elder).toContainText('Gold spent: $0.04');
  await expect(elder.getByRole('button', { name: 'Convene council' })).toBeEnabled();
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
  await openWelcome(page);
  await page.getByLabel('Task').fill('Make it fail');
  await page.getByRole('button', { name: 'Ask the elder to research it first' }).click();
  const elder = page.getByRole('region', { name: 'Elder' });
  await expect(elder.getByRole('alert')).toHaveText(
    'The elder ran out of gold before finishing the brief.',
  );
  await elder.getByRole('button', { name: 'Ask again' }).click();
  await expect(elder).toContainText('The elder searches the old charts…');
  await expect(elder.getByRole('alert')).toBeVisible();
  await elder.getByRole('button', { name: 'Abandon' }).click();
  await expect(elder).toBeHidden();
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen)).toBe(true);
});

test('the brief convenes a round table; its approved plan becomes a quest, task by task (#103, #104)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live');
  await openWelcome(page);
  await page.getByLabel('Task').fill('Fix the login redirect');
  await page.getByRole('button', { name: 'Ask the elder to research it first' }).click();
  const elder = page.getByRole('region', { name: 'Elder' });
  await elder.getByRole('button', { name: 'Convene council' }).click();

  const convene = page.getByRole('dialog', { name: 'Convene the council' });
  await expect(convene.getByRole('radio', { name: /Round table/ })).toBeChecked();
  await expect(convene.getByRole('radio', { name: /Separate chambers/ })).not.toBeChecked();
  const tester = convene.getByRole('checkbox', { name: /Tester/ });
  await expect(tester).toBeChecked();
  await expect(convene).toContainText('The elder: The change needs a test.');
  await expect(convene.getByRole('checkbox', { name: /Architect/ })).not.toBeChecked();
  await expect(convene.getByLabel('Effort', { exact: true })).toHaveValue('light');
  await page.screenshot({ path: 'test-results/convene.png' });
  await tester.uncheck();
  await expect(convene.getByRole('button', { name: 'Convene' })).toBeDisabled();
  await tester.check();
  await convene.getByRole('checkbox', { name: /Security/ }).check();
  await convene.getByRole('button', { name: 'Convene' }).click();

  // The hut takes over; the elder panel steps aside.
  await expect(elder).toBeHidden();
  const box = page.getByRole('dialog', { name: 'The council asks' });
  await expect(box).toContainText('Tester asks');
  await expect(box).toContainText('Should the change come with a test?');
  await box.getByRole('button', { name: 'Why?' }).click();
  await expect(box.getByRole('list', { name: 'Discussion' })).toContainText(
    'Because nothing else checks this code.',
  );
  await box.getByRole('radio', { name: /Yes/ }).click();
  await box.getByRole('button', { name: 'Send answers' }).click();

  const plan = page.getByRole('region', { name: "The council's plan" });
  await expect(plan).toContainText('Two tasks: make the change, then cover it with a test.');
  // The plan review (#104): tasks in order with their criteria, and the Book of Decisions.
  await expect(plan.getByRole('list', { name: 'Tasks' }).getByRole('listitem')).toHaveCount(2);
  await expect(plan).toContainText('Signing in lands on the page you asked for.');
  await expect(plan.getByRole('list', { name: 'Book of Decisions' })).toContainText(
    'D1 Test the fix Yes.',
  );
  await expect(plan.getByRole('list', { name: 'Islands' })).toContainText(
    'I1 The redirect fix: T1',
  );
  await expect(plan.getByRole('list', { name: 'Islands' })).toContainText(
    'I2 The redirect test: T2',
  );
  await expect(plan).toContainText('Separate: every island branches from the base.');
  await expect.poll(() => probe(page, (p) => p.hut()?.decisions)).toBe(1);
  await page.screenshot({ path: 'test-results/round-table-plan.png' });
  await plan.getByRole('button', { name: 'Ask for changes' }).click();
  await plan.getByLabel('What should change?').fill('Two tasks');
  await plan.getByRole('button', { name: 'Ask for changes' }).click();
  await expect(plan).toContainText('Revised: Two tasks');
  await plan.getByRole('button', { name: 'Approve' }).click();
  await expect(plan).toBeHidden();

  // The approved plan waits in the elder panel; party assembly carries it out (#104, #123).
  await expect(elder.getByRole('heading', { name: "The council's plan" })).toBeVisible();
  await expect(elder).toContainText('Approved. Revised: Two tasks');
  await elder.getByRole('button', { name: 'Assemble the parties' }).click();
  const assembly = page.getByRole('dialog', { name: 'Assemble the parties' });
  await expect(assembly.getByRole('group', { name: 'I1 The redirect fix' })).toBeVisible();
  const second = assembly.getByRole('group', { name: 'I2 The redirect test' });
  await expect(second.getByLabel('Hero name')).toHaveValue('Ranger Rowan');
  // One review effort per reviewing councillor, Light by default (#139).
  const effort = second.getByLabel('Tester, review effort');
  await expect(effort).toHaveValue('light');
  await effort.selectOption('standard');
  await expect(assembly).toContainText('Up to 2 parties work at once');
  await page.screenshot({ path: 'test-results/party-assembly-reviews.png' });
  await assembly.getByRole('button', { name: 'Start the campaign' }).click();
  const started = await probe(page, (p) =>
    p.sent().find((c: { type: string }) => c.type === 'startCampaign'),
  );
  expect(started).toMatchObject({
    parties: [
      { islandId: 'I1', reviewEfforts: { tester: 'light' } },
      { islandId: 'I2', reviewEfforts: { tester: 'standard' } },
    ],
  });
  await expect(assembly).toBeHidden();
  await expect.poll(() => heroState(page)).toBe('idle');
  // The second island waits for the first island's task (#121).
  expect(await probe(page, (p) => p.snapshot()?.heroes.map((h) => h.state.kind))).toEqual([
    'idle',
    'blocked',
  ]);
  // Asked to submit, hero 1 hands in task 1; island 2 starts and its hero gets to work.
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByLabel('Message to the hero').fill('Submit it');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect.poll(() => heroState(page), { timeout: 10_000 }).toBe('submitted');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[1]?.state.kind), { timeout: 10_000 })
    .toBe('idle');

  // The campaign finishes once every island is in (#126).
  const finish = pane.getByRole('button', { name: 'Finish campaign' });
  await expect(finish).toBeDisabled();
  await expect(finish).toHaveAttribute('title', '1 of 2 islands submitted');
  await expect(pane.getByRole('button', { name: 'Abandon campaign' })).toBeVisible();
  const secondHero = await probe(page, (p) => p.snapshot()?.heroes[1]?.id);
  await page.evaluate((heroId) => {
    (window as unknown as { __ibitsa: { send(i: unknown): void } }).__ibitsa.send({
      type: 'markDone',
      heroId,
    });
  }, secondHero);
  await expect(finish).toBeEnabled();
  await finish.click();
  await expect.poll(() => probe(page, (p) => p.snapshot()?.campaign?.status)).toBe('finished');
  await pane.getByRole('button', { name: 'Remove worktree' }).click();
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.islands.map((i) => i.worktree)))
    .toEqual(['removed', 'ready']);
  expect(errors).toEqual([]);
});

test("the campaign's cap stops the hero and can be raised (#126)", async ({ page }) => {
  await page.goto('/?fixture=live&campaignCap=0.04');
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
  expect(await probe(page, (p) => p.snapshot()?.campaign?.capMicroUsd)).toBe(40_000);
  const pane = page.getByRole('region', { name: 'Hero' });
  for (const text of ['One more thing', 'And another']) {
    await pane.getByLabel('Message to the hero').fill(text);
    await pane.getByRole('button', { name: 'Send now' }).click();
    await page.waitForTimeout(1_200);
  }
  const item = page.locator('.needs-you .item').filter({ hasText: 'reached its cap of $0.04' });
  await expect(item).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => heroState(page)).toBe('outOfGold');
  await item.getByRole('button', { name: 'Raise the campaign cap by $5' }).click();
  await expect.poll(() => probe(page, (p) => p.snapshot()?.campaign?.capMicroUsd)).toBe(5_040_000);
  await expect.poll(() => heroState(page), { timeout: 10_000 }).not.toBe('outOfGold');
});

test('party assembly: a stacked plan, its heroes, and how its islands start (#123)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live');
  await openWelcome(page);
  await page.getByLabel('Task').fill('Fix the login redirect');
  await page.getByRole('button', { name: 'Ask the elder to research it first' }).click();
  const elder = page.getByRole('region', { name: 'Elder' });
  await elder.getByRole('button', { name: 'Convene council' }).click();
  await page
    .getByRole('dialog', { name: 'Convene the council' })
    .getByRole('button', { name: 'Convene' })
    .click();
  const box = page.getByRole('dialog', { name: 'The council asks' });
  await box.getByRole('radio', { name: /Yes/ }).click();
  await box.getByRole('button', { name: 'Send answers' }).click();
  const plan = page.getByRole('region', { name: "The council's plan" });
  await plan.getByRole('button', { name: 'Ask for changes' }).click();
  await plan.getByLabel('What should change?').fill('Stack them');
  await plan.getByRole('button', { name: 'Ask for changes' }).click();
  await expect(plan).toContainText('Stacked: each island builds on the one before it.');
  await plan.getByRole('button', { name: 'Approve' }).click();

  await elder.getByRole('button', { name: 'Assemble the parties' }).click();
  const assembly = page.getByRole('dialog', { name: 'Assemble the parties' });
  const modes = assembly.getByRole('group', { name: 'How the stacked islands start' });
  await expect(
    modes.getByRole('radio', { name: /Each island when the one before is cleared/ }),
  ).toBeChecked();
  await modes.getByRole('radio', { name: /Start them all now/ }).check();
  const first = assembly.getByRole('group', { name: 'I1 The redirect fix' });
  await first.getByLabel('Hero class').selectOption('rogue');
  await expect(first.getByLabel('Hero name')).toHaveValue('Rogue Vex');
  await first.getByLabel('Gold cap in dollars').fill('lots');
  await assembly.getByRole('button', { name: 'Start the campaign' }).click();
  await expect(assembly.getByRole('alert')).toHaveText('"lots" isn\'t an amount of dollars.');
  await first.getByLabel('Gold cap in dollars').fill('2.5');
  await assembly.getByRole('group', { name: 'I2 The redirect test' }).getByLabel('No cap').check();
  await page.screenshot({ path: 'test-results/party-assembly.png' });
  await assembly.getByRole('button', { name: 'Start the campaign' }).click();

  await expect.poll(() => probe(page, (p) => p.snapshot()?.campaign?.status)).toBe('active');
  const snapshot = await probe(page, (p) => p.snapshot());
  expect(snapshot?.campaign).toMatchObject({ branching: 'stacked', stackedStart: 'together' });
  expect(snapshot?.heroes.map((h) => [h.name, h.classId])).toEqual([
    ['Rogue Vex', 'rogue'],
    ['Ranger Rowan', 'ranger'],
  ]);
  expect(snapshot?.islands[1]?.basedOn).toBe(snapshot?.islands[0]?.id);
  expect(errors).toEqual([]);
});

test('separate chambers: an effort per councillor, the study stage, then the questions (#105)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live');
  await openWelcome(page);
  await page.getByLabel('Task').fill('Fix the login redirect');
  await page.getByRole('button', { name: 'Ask the elder to research it first' }).click();
  const elder = page.getByRole('region', { name: 'Elder' });
  await elder.getByRole('button', { name: 'Convene council' }).click();

  const convene = page.getByRole('dialog', { name: 'Convene the council' });
  const testerEffort = convene.getByLabel("Tester's effort");
  await expect(testerEffort).toBeHidden();
  await expect(convene).toContainText('Costs up to $0.50.');
  await convene.getByRole('radio', { name: /Separate chambers/ }).check();
  // The elder's pick for the tester, with its reason; the cap is the shares plus the elder's reserve.
  await expect(testerEffort).toHaveValue('light');
  await expect(convene).toContainText('One case.');
  await expect(convene).toContainText('Costs up to $0.40.');
  await convene.getByRole('checkbox', { name: /Security/ }).check();
  await convene.getByLabel("Security's effort").selectOption('deep');
  await expect(convene).toContainText('Costs up to $1.60.');
  await expect(convene.getByText('The elder chairs at')).toBeVisible();
  await page.screenshot({ path: 'test-results/convene-chambers.png' });
  await convene.getByRole('button', { name: 'Convene' }).click();

  // The councillors study until every report is in, then the questions come.
  await expect.poll(() => probe(page, (p) => p.hut()?.stage), { timeout: 10_000 }).toBe('study');
  expect(await probe(page, (p) => p.hut()?.mode)).toBe('chambers');
  await page.screenshot({ path: 'test-results/chambers-study.png' });
  const box = page.getByRole('dialog', { name: 'The council asks' });
  await expect(box).toContainText('Should the change come with a test?', { timeout: 15_000 });
  expect(await probe(page, (p) => p.hut()?.stage)).toBe('dialogue');
  expect(errors).toEqual([]);
});

test('after a sitting: rate the council, then convene it the other way to compare (#106)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live');
  await openWelcome(page);
  await page.getByLabel('Task').fill('Fix the login redirect');
  await page.getByRole('button', { name: 'Ask the elder to research it first' }).click();
  const elder = page.getByRole('region', { name: 'Elder' });
  await elder.getByRole('button', { name: 'Convene council' }).click();
  await page
    .getByRole('dialog', { name: 'Convene the council' })
    .getByRole('button', { name: 'Convene' })
    .click();
  const box = page.getByRole('dialog', { name: 'The council asks' });
  await box.getByRole('radio', { name: /Yes/ }).click();
  await box.getByRole('button', { name: 'Send answers' }).click();
  await page
    .getByRole('region', { name: "The council's plan" })
    .getByRole('button', { name: 'Approve' })
    .click();

  const rating = elder.getByRole('group', { name: 'How useful was the council?' });
  await rating.getByLabel('A note about the council (optional)').fill('Good questions');
  await rating.getByRole('button', { name: '4 of 5' }).click();
  await expect(rating).toContainText('You rated it 4 of 5.');
  expect(await probe(page, (p) => p.snapshot()?.sitting)).toMatchObject({
    rating: { score: 4, note: 'Good questions' },
  });
  await page.screenshot({ path: 'test-results/rating.png' });

  await elder.getByRole('button', { name: 'Convene the other way' }).click();
  await expect(elder).toContainText('The council sits again in separate chambers on the same task');
  await elder.getByRole('button', { name: 'Yes, sit in separate chambers' }).click();
  await expect.poll(() => probe(page, (p) => p.hut()?.decisions)).toBe(0);
  expect(await probe(page, (p) => p.snapshot()?.sitting)).toMatchObject({
    mode: 'chambers',
    rating: null,
  });
  expect(await probe(page, (p) => p.snapshot()?.sitting?.comparisonOf)).toBeTruthy();
  await expect(box).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('the elder names related campaigns and suggests starting the kept council fresh (#168)', async ({
  page,
}) => {
  await page.goto('/?fixture=live&kept=1');
  await openWelcome(page);
  await page.getByLabel('Task').fill('Fix the login redirect');
  await page.getByRole('button', { name: 'Ask the elder to research it first' }).click();
  const elder = page.getByRole('region', { name: 'Elder' });
  await expect(elder.getByRole('heading', { name: 'Related campaigns' })).toBeVisible();
  await expect(elder).toContainText('Slugs It touched the same router.');
  await expect(elder).toContainText(
    'Unrelated to the council\'s kept context: "Payments" was about payments. Start fresh when you convene.',
  );
  await elder.getByRole('button', { name: 'Convene council' }).click();
  const convene = page.getByRole('dialog', { name: 'Convene the council' });
  const fresh = convene.getByRole('checkbox', { name: /Start fresh instead of resuming/ });
  await expect(fresh).toBeChecked();
  await expect(convene).toContainText('The elder: "Payments" was about payments.');
  await page.screenshot({ path: 'test-results/convene-kept.png' });
  await convene.getByRole('button', { name: 'Convene' }).click();
  const sent = await page.evaluate(() =>
    (
      window as unknown as { __ibitsa: { sent(): { type: string; freshCouncil?: boolean }[] } }
    ).__ibitsa
      .sent()
      .filter((c) => c.type === 'conveneCouncil'),
  );
  expect(sent).toEqual([expect.objectContaining({ freshCouncil: true })]);
});
