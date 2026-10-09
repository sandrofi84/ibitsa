import { expect, type Page, test } from '@playwright/test';
import { openWelcome } from './home';

interface Probe {
  guildHallOnPage(): { x: number; y: number } | null;
  guildHall(): string | null;
  snapshot(): {
    campaign: { status: string } | null;
    heroes: { name: string; classId: string }[];
  } | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

test('the party check: a party on Codex waits for its sign-in, then sets out (#199)', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?fixture=live');
  await expect(async () => {
    const at = await probe(page, (p) => p.guildHallOnPage());
    expect(at).not.toBeNull();
    if (!at) return;
    await page.mouse.click(at.x, at.y);
    expect(await probe(page, (p) => p.guildHall())).not.toBeNull();
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });

  // A Seer on Codex, which the dev host has installed but not signed in. The Armory checks it on
  // demand.
  const hall = page.getByRole('region', { name: 'Guild Hall' });
  await hall.getByRole('tab', { name: 'Armory' }).click();
  await hall.getByLabel('New class id').fill('seer');
  await hall.getByLabel('Its name').fill('Seer');
  await hall.getByLabel('Its agent').selectOption('codex');
  await hall.getByRole('button', { name: 'Add the class' }).click();
  const seer = hall.getByRole('group', { name: 'Seer' });
  await seer.getByRole('button', { name: 'Check the agent' }).click();
  await expect(seer.locator('.agent-check')).toContainText('Sign in to Codex first (codex login)');
  await hall.press('Escape');

  // The council's plan, and its party on the Seer.
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
  await elder.getByRole('button', { name: 'Assemble the parties' }).click();
  const assembly = page.getByRole('dialog', { name: 'Assemble the parties' });
  const start = assembly.getByRole('button', { name: 'Start the campaign' });
  // Claude classes need no check.
  await expect(start).toBeEnabled();
  const first = assembly.getByRole('group', { name: 'I1 The redirect fix' });
  await first.getByLabel('Hero class').selectOption('seer');

  // Blocked on the sign-in.
  const line = first.locator('.agent-check');
  await expect(line).toContainText('Sign in to Codex first (codex login)');
  await expect(start).toBeDisabled();
  await page.screenshot({ path: 'test-results/party-check-sign-in.png' });
  // Back on a Claude class it could set out; the Seer it is.
  await first.getByLabel('Hero class').selectOption('ranger');
  await expect(start).toBeEnabled();
  await first.getByLabel('Hero class').selectOption('seer');
  await expect(start).toBeDisabled();

  // Signed in (the extension opens a terminal on `codex login`), checked again: it sets out, with a
  // warning that nothing counts its gold.
  await line.getByRole('button', { name: 'Sign in' }).click();
  await line.getByRole('button', { name: 'Check again' }).click();
  await expect(line).toContainText('Codex is ready.');
  await expect(line).toContainText("Codex reports no cost: the gold pouch can't stop this hero.");
  await expect(start).toBeEnabled();
  await page.screenshot({ path: 'test-results/party-check-ready.png' });
  await start.click();

  await expect.poll(() => probe(page, (p) => p.snapshot()?.campaign?.status)).toBe('active');
  expect(await probe(page, (p) => p.snapshot()?.heroes.map((h) => h.classId))).toContain('seer');
  expect(errors).toEqual([]);
});

test("the party check: a quick quest on an agent that isn't installed can't start (#199)", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?fixture=live');
  await expect(async () => {
    const at = await probe(page, (p) => p.guildHallOnPage());
    expect(at).not.toBeNull();
    if (!at) return;
    await page.mouse.click(at.x, at.y);
    expect(await probe(page, (p) => p.guildHall())).not.toBeNull();
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
  const hall = page.getByRole('region', { name: 'Guild Hall' });
  await hall.getByRole('tab', { name: 'Armory' }).click();
  await hall.getByRole('group', { name: 'Rogue' }).getByLabel('Agent').selectOption('gemini');
  await expect(hall.getByRole('group', { name: 'Rogue' }).getByLabel('Agent')).toHaveValue(
    'gemini',
  );
  await hall.press('Escape');

  await openWelcome(page);
  await page.getByLabel('Task').fill('Fix the login redirect');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
  await page.getByLabel('Hero class').selectOption('rogue');
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome.locator('.agent-check')).toContainText("Gemini CLI isn't installed");
  await expect(welcome.getByRole('button', { name: 'Start quest' })).toBeDisabled();
  // A Claude class sets out as before.
  await page.getByLabel('Hero class').selectOption('ranger');
  await expect(welcome.locator('.agent-check')).toHaveText('');
  await expect(welcome.getByRole('button', { name: 'Start quest' })).toBeEnabled();
  expect(errors).toEqual([]);
});
