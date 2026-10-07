import { expect, type Page, test } from '@playwright/test';
import { openWelcome } from './home';

interface Probe {
  snapshot(): { islands: { id: string }[]; campaign: { status: string } | null } | null;
  map(): { startScreen?: boolean; charted?: string[]; sunk?: boolean } | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

test('the start screen: the hut welcomes you, "I know the way" charts an island, and it sinks after (#180)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  // Home Village with its two buildings, and no "New quest" button.
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen)).toBe(true);
  await expect(page.getByRole('button', { name: 'New quest' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/start-screen.png' });

  // The council hut opens the elder's welcome.
  await openWelcome(page);
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(welcome).toContainText('We heard you are looking for Ibitsa…');
  await expect(welcome).toContainText('…what do you want to do there?');
  await expect(welcome.getByRole('button', { name: 'Help me find it' })).toBeVisible();
  await page.screenshot({ path: 'test-results/welcome.png' });

  // I know the way: a quick quest, with the hero's fields.
  await welcome.getByLabel('Task').fill('Tidy the README');
  await welcome.getByRole('button', { name: 'I know the way' }).click();
  await expect(welcome.getByLabel('Hero class')).toBeFocused();
  await welcome.getByRole('button', { name: 'Start quest' }).click();
  await expect(welcome).toBeHidden();

  // Its island is charted out of the fog, and the start screen's labels go.
  const islandId = await probe(page, (p) => p.snapshot()?.islands[0]?.id);
  await expect.poll(() => probe(page, (p) => p.map()?.charted)).toEqual([islandId]);
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen)).toBe(false);

  // Abandoned: the island sinks, and Home Village is ready for the next search.
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByRole('button', { name: 'Abandon quest' }).click();
  await pane.getByRole('button', { name: 'Really abandon?' }).click();
  await expect.poll(() => probe(page, (p) => p.map()?.sunk)).toBe(true);
  await expect.poll(() => probe(page, (p) => p.map()?.startScreen)).toBe(true);
  await openWelcome(page);
});
