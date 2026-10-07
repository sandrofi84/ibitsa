import { expect, type Page, test } from '@playwright/test';

interface Probe {
  snapshot(): {
    heroes: { id: string }[];
    sitting: {
      status: string;
      dialogue: { speaker: string; text: string }[];
      consultations: { status: string }[];
    } | null;
  } | null;
  hutOnPage(): { x: number; y: number } | null;
  councilChamber(): boolean;
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

test('asks the council mid-campaign with @council and @tester, and in its chamber from the hut (#169)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live&campaign=separate');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.sitting?.status), { timeout: 15_000 })
    .toBe('approved');
  await expect.poll(() => probe(page, (p) => p.snapshot()?.heroes.length ?? 0)).toBeGreaterThan(0);

  // The @ menu offers the council and its councillors.
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.fill('@co');
  await expect(page.getByRole('option', { name: /@council/ })).toBeVisible();
  await bar.fill('');

  // @council: the elder answers for the council, and a notice shows it on the map.
  await bar.fill('@council how is the campaign going?');
  await bar.press('Enter');
  const notice = page.getByRole('status').filter({ hasText: 'Open the hut' });
  await expect(notice).toContainText('The campaign is on track', { timeout: 10_000 });
  await expect(notice).toContainText('Elder');
  // One question at a time: the next once this answer is over.
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.sitting?.consultations.at(-1)?.status))
    .toBe('answered');

  // @tester: that councillor answers in its own voice.
  await bar.fill('@tester anything to add?');
  await bar.press('Enter');
  await expect(notice).toContainText('tester here', { timeout: 10_000 });
  const lines = await probe(page, (p) => p.snapshot()?.sitting?.dialogue.map((d) => d.speaker));
  expect(lines?.slice(-4)).toEqual(['you', 'elder', 'you', 'tester']);

  // The hut on the map opens the chamber: the lines so far and a box to ask. The bar still has focus
  // from the question, so it lets go first, or "0" is typed into it instead of showing the whole map.
  await bar.blur();
  await page.locator('body').press('0');
  await page.evaluate(() => {
    for (const panel of document.querySelectorAll<HTMLElement>('.needs-you, .hero-pane')) {
      panel.style.visibility = 'hidden';
    }
  });
  await expect(async () => {
    const at = await probe(page, (p) => p.hutOnPage());
    expect(at).not.toBeNull();
    if (!at) return;
    await page.mouse.click(at.x, at.y);
    expect(await probe(page, (p) => p.councilChamber())).toBe(true);
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
  const chamber = page.getByRole('region', { name: 'The council' });
  await expect(chamber.getByText('tester here', { exact: false })).toBeVisible();
  await chamber.getByLabel('Ask').selectOption('tester');
  await chamber.getByLabel('Your question').fill('Should we add a test for empty input?');
  await chamber.getByRole('button', { name: 'Ask' }).click();
  await expect(chamber.getByText('The council is thinking…')).toBeVisible();
  await expect(chamber.getByText('The council is thinking…')).toBeHidden({ timeout: 10_000 });
  await expect(chamber.getByText('Should we add a test for empty input?')).toBeVisible();
  await page.screenshot({ path: 'test-results/council-chamber.png' });

  await chamber.getByRole('button', { name: 'Back to the map' }).click();
  await expect(chamber).toBeHidden();
  expect(await probe(page, (p) => p.councilChamber())).toBe(false);
  expect(errors).toEqual([]);
});
