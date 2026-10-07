import { expect, type Page, test } from '@playwright/test';

interface Probe {
  guildHallOnPage(): { x: number; y: number } | null;
  guildHall(): string | null;
  hostRequests(): {
    type: string;
    id?: string;
    enabled?: boolean;
    path?: string;
    override?: unknown;
  }[];
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

const requests = (page: Page, type: string) =>
  probe(page, (p) => p.hostRequests()).then((all) => all.filter((r) => r.type === type));

test('the Roster: on and off, extending a title, customising, and a new councillor (#181)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await expect(async () => {
    const at = await probe(page, (p) => p.guildHallOnPage());
    expect(at).not.toBeNull();
    if (!at) return;
    await page.mouse.click(at.x, at.y);
    expect(await probe(page, (p) => p.guildHall())).not.toBeNull();
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });

  const hall = page.getByRole('region', { name: 'Guild Hall' });
  await hall.getByRole('tab', { name: 'Roster' }).click();
  const security = hall.getByRole('listitem', { name: 'Security' });
  await expect(security).toContainText('Built-in');
  await expect(security).toContainText('Plans and reviews');

  // Off, then the card follows the setting.
  const sits = security.getByLabel('Sits on the council');
  await expect(sits).toBeChecked();
  await sits.uncheck();
  await expect(sits).not.toBeChecked();
  expect(await requests(page, 'setCouncillorEnabled')).toEqual([
    expect.objectContaining({ id: 'security', enabled: false }),
  ]);

  // Extended with a title of your own, then reset.
  const title = security.getByLabel('Title');
  await title.fill('Guardian');
  await title.blur();
  await expect(security).toContainText('Extended: You');
  await page.screenshot({ path: 'test-results/guild-roster.png' });
  await security.getByRole('button', { name: 'Reset' }).click();
  await expect(security).not.toContainText('Extended');

  // Customise copies its skill (the extension opens the copy).
  await security.getByRole('button', { name: 'Customise' }).click();
  expect(await requests(page, 'customiseCouncillor')).toEqual([
    expect.objectContaining({ id: 'security', path: '/ibitsa/plugin/skills/security/SKILL.md' }),
  ]);

  // A new councillor: a bad id is refused with the reason, a good one is written.
  const form = hall.getByRole('form', { name: 'New councillor' });
  await form.getByLabel('Id').fill('Perf!');
  await form.getByLabel('Title').fill('Performance');
  await form.getByLabel('Field').fill('Speed and memory.');
  await form.getByRole('button', { name: 'Write the skill' }).click();
  await expect(hall.getByRole('alert')).toContainText('lowercase letters');
  await hall.getByRole('form', { name: 'New councillor' }).getByLabel('Id').fill('performance');
  await hall
    .getByRole('form', { name: 'New councillor' })
    .getByRole('button', { name: 'Write the skill' })
    .click();
  expect(await requests(page, 'newCouncillor')).toEqual([
    expect.objectContaining({ id: 'performance' }),
  ]);
});
