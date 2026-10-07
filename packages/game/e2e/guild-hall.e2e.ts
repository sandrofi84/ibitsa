import { expect, type Page, test } from '@playwright/test';

interface Probe {
  guildHallOnPage(): { x: number; y: number } | null;
  guildHall(): string | null;
  hostRequests(): { type: string; path?: string }[];
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

test('the Guild Hall: rules with their layers, saving, reset, and the Chronicle (#179)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  // The Guild Hall stands in Home Village; a click opens it.
  await expect(async () => {
    const at = await probe(page, (p) => p.guildHallOnPage());
    expect(at).not.toBeNull();
    if (!at) return;
    await page.mouse.click(at.x, at.y);
    expect(await probe(page, (p) => p.guildHall())).toBe('rules');
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });

  const hall = page.getByRole('region', { name: 'Guild Hall' });
  await expect(hall.getByRole('tab', { name: 'Rule book' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const loop = hall.getByLabel('Review rounds before you decide');
  await expect(loop).toHaveValue('4');
  const loopRow = hall.locator('.rule').filter({ hasText: 'Review rounds before you decide' });
  await expect(loopRow.locator('.layer')).toHaveText('You');
  await page.screenshot({ path: 'test-results/guild-hall.png' });

  // Saved to this project, it wins over yours; Reset puts yours back.
  await hall.getByLabel('Save changes to').selectOption('workspace');
  await loop.fill('6');
  await loop.press('Enter');
  await loop.blur();
  await expect(loopRow.locator('.layer')).toHaveText('This project');
  await expect(hall.getByLabel('Review rounds before you decide')).toHaveValue('6');
  await loopRow.getByRole('button', { name: 'Reset' }).click();
  await expect(loopRow.locator('.layer')).toHaveText('You');
  await expect(hall.getByLabel('Review rounds before you decide')).toHaveValue('4');

  // A value the rule can't take says why, and isn't saved.
  const parties = hall.getByLabel('Parties at once');
  await parties.fill('0');
  await parties.blur();
  await expect(hall.getByRole('alert')).toHaveText('At least 1.');

  // The Chronicle: past campaigns, with their PRs, and their records opened in the editor.
  await hall.getByRole('tab', { name: 'Chronicle' }).click();
  await expect(hall).toContainText('Slugs without accents 2026-10-05 · finished · $1.24');
  await expect(hall.getByRole('link', { name: '#12 merged' })).toHaveAttribute(
    'href',
    'https://github.com/ibitsa/demo/pull/12',
  );
  await hall.getByRole('button', { name: 'Open record' }).first().click();
  expect(
    (await probe(page, (p) => p.hostRequests()))
      .filter((r) => r.type === 'openFile')
      .map((r) => r.path),
  ).toEqual(['.ibitsa/campaigns/c-slugs/record.md']);

  await hall.getByRole('tab', { name: 'Spell book' }).click();
  await expect(hall.getByRole('tabpanel')).toBeVisible();
  await hall.press('Escape');
  await expect(hall).toBeHidden();
  await page.screenshot({ path: 'test-results/home-village.png' });
});
