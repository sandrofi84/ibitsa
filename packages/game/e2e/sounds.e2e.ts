import { expect, type Page, test } from '@playwright/test';
import { openWelcome } from './home';

interface Probe {
  sounds(): { slot: string; volume: number }[];
  guildHallOnPage(): { x: number; y: number } | null;
  guildHall(): string | null;
  snapshot(): { needsYou: unknown[]; heroes: { state: { kind: string } }[] } | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

const startQuest = async (page: Page, task: string) => {
  // Through the council hut's welcome (#180).
  await openWelcome(page);
  await page.getByLabel('Task').fill(task);
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
};

test('sounds play on what happens, at the volumes set in the Packs tab (#184)', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await startQuest(page, 'Tidy the README');
  // The hero works, then waits for orders: "Needs you" chimes, at the default volume (50% of 100%).
  await expect
    .poll(() => probe(page, (p) => p.sounds().filter((s) => s.slot === 'needsYou').length), {
      timeout: 15_000,
    })
    .toBe(1);
  expect((await probe(page, (p) => p.sounds())).find((s) => s.slot === 'needsYou')?.volume).toBe(
    0.5,
  );

  // Turned down to nothing in the Guild Hall's Packs tab, the next chime is silent.
  await page.locator('body').press('0');
  await expect(async () => {
    const at = await probe(page, (p) => p.guildHallOnPage());
    expect(at).not.toBeNull();
    if (!at) return;
    await page.mouse.click(at.x, at.y);
    expect(await probe(page, (p) => p.guildHall())).not.toBeNull();
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
  const hall = page.getByRole('region', { name: 'Guild Hall' });
  await hall.getByRole('tab', { name: 'Packs' }).click();
  const volume = hall.getByLabel('Volume', { exact: true });
  await expect(volume).toHaveValue('50');
  await volume.fill('0');
  await volume.dispatchEvent('change');
  await expect(hall.getByLabel('Volume', { exact: true })).toHaveValue('0');
  await page.screenshot({ path: 'test-results/sounds.png' });
  await hall.press('Escape');
  const before = (await probe(page, (p) => p.sounds())).length;
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.fill('One more thing');
  await bar.press('Enter');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 15_000 })
    .toBe('working');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 15_000 })
    .not.toBe('working');
  expect((await probe(page, (p) => p.sounds())).length).toBe(before);
});
