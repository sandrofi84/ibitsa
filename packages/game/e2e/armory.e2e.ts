import { expect, type Page, test } from '@playwright/test';
import { openWelcome } from './home';

interface Probe {
  guildHallOnPage(): { x: number; y: number } | null;
  guildHall(): string | null;
  snapshot(): {
    campaign: { status: string } | null;
    heroes: { name: string; classId: string }[];
    classes?: { id: string; model: string }[];
    recolor?: Record<string, { hue: number; preset: string }>;
  } | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('the Armory: a new class used in party assembly, and a recolored hero (#182)', async ({
  page,
}) => {
  const errors = watchErrors(page);
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
  await expect(hall.getByRole('group', { name: 'Ranger' })).toBeVisible();

  // A new class, on Opus.
  await hall.getByLabel('New class id').fill('bard');
  await hall.getByLabel('Its name').fill('Bard');
  await hall.getByLabel('Its model').fill('opus');
  await hall.getByRole('button', { name: 'Add the class' }).click();
  const bard = hall.getByRole('group', { name: 'Bard' });
  await expect(bard.locator('.layer').first()).toHaveText('You');

  // The Ranger turned to frost.
  await hall.getByLabel('Palette of class:ranger').selectOption('frost');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.recolor?.['class:ranger']?.preset))
    .toBe('frost');
  await page.screenshot({ path: 'test-results/armory.png' });
  await hall.press('Escape');

  // Party assembly offers the new class.
  await openWelcome(page);
  await page.getByLabel('Task').fill('Fix the login redirect');
  await page.getByRole('button', { name: 'Help me find it' }).click();
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
  const first = assembly.getByRole('group', { name: 'I1 The redirect fix' });
  await expect(first.getByLabel('Hero class').locator('option')).toContainText([
    'Bard (Claude Opus)',
  ]);
  await first.getByLabel('Hero class').selectOption('bard');
  await expect(first.getByLabel('Hero name')).toHaveValue('Bard');
  await assembly.getByRole('button', { name: 'Start the campaign' }).click();

  await expect.poll(() => probe(page, (p) => p.snapshot()?.campaign?.status)).toBe('active');
  expect(await probe(page, (p) => p.snapshot()?.heroes.map((h) => [h.name, h.classId]))).toEqual([
    ['Bard', 'bard'],
    ['Ranger Rowan', 'ranger'],
  ]);
  // The ranger walks the map in frost: chosen in the hero pane, the camera follows it.
  await page
    .getByRole('region', { name: 'Hero' })
    .getByRole('navigation', { name: 'Heroes' })
    .getByRole('button', { name: /^Ranger Rowan/ })
    .click();
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: 'test-results/recolored-hero.png' });
  expect(errors).toEqual([]);
});
