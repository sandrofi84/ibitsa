import { expect, type Page, test } from '@playwright/test';

interface Probe {
  snapshot(): {
    heroes: { id: string; name: string; islandId: string }[];
    islands: {
      id: string;
      name: string;
      awaitingParty?: boolean;
      taskPoints: { title: string }[];
    }[];
    sitting: {
      status: string;
      amendments: { number: number; outcome: { kind: string } }[];
    } | null;
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

test('the council amends the plan: the change set, changes asked for, approval and a new island’s party (#170)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live&campaign=separate');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.sitting?.status), { timeout: 15_000 })
    .toBe('approved');
  const islands = await probe(page, (p) => p.snapshot()?.islands.length ?? 0);

  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.fill('@council please amend the plan: the slugs need docs');
  await bar.press('Enter');
  const review = page.getByRole('region', { name: "The council's amendment" });
  await expect(
    review.getByRole('heading', { name: 'The council proposes Amendment 1' }),
  ).toBeVisible({
    timeout: 10_000,
  });
  await expect(review.getByText(/a docs task here, and a docs site/)).toBeVisible();
  await expect(review.locator('.changes li')).toHaveText([
    /\+ Add T\d+ Document the slugs/,
    /\+ Add T\d+ Build the docs site \(Docs site\)/,
    /\+ New island I\d+ Docs site: T\d+/,
  ]);
  // Needs you points to it too.
  await expect(
    page.locator('.needs-you .item').filter({ hasText: 'The council proposes Amendment 1' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/amendment-review.png' });

  // Sent back with a note: the council proposes again, and the first is marked as sent back.
  await review.getByLabel('What should change?').fill('Keep the docs short');
  await review.getByRole('button', { name: 'Request changes' }).click();
  await expect(
    review.getByRole('heading', { name: 'The council proposes Amendment 2' }),
  ).toBeVisible({
    timeout: 10_000,
  });
  expect(
    await probe(page, (p) => p.snapshot()?.sitting?.amendments.map((a) => a.outcome.kind)),
  ).toEqual(['changeRequested', 'proposed']);

  await review.getByRole('button', { name: 'Approve' }).click();
  await expect(review).toBeHidden();
  await expect.poll(() => probe(page, (p) => p.snapshot()?.islands.length ?? 0)).toBe(islands + 1);
  expect(
    await probe(page, (p) =>
      p
        .snapshot()
        ?.islands[0]?.taskPoints.map((t) => t.title)
        .at(-1),
    ),
  ).toBe('Document the slugs');

  // The new island waits for its party.
  const item = page.locator('.needs-you .item').filter({ hasText: 'Docs site needs its party.' });
  await item.getByRole('button', { name: 'Assemble' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assemble the new party' });
  await expect(dialog.getByRole('heading', { name: 'A party for Docs site' })).toBeVisible();
  await dialog.getByLabel('Hero name').fill('Bard Lyra');
  await page.screenshot({ path: 'test-results/new-party.png' });
  await dialog.getByRole('button', { name: 'Assemble' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes.map((h) => h.name)))
    .toContain('Bard Lyra');
  await expect(item).toHaveCount(0);
  expect(await probe(page, (p) => p.snapshot()?.islands.at(-1)?.awaitingParty ?? false)).toBe(
    false,
  );
  expect(errors).toEqual([]);
});
