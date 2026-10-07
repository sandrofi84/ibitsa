import { expect, type Page, test } from '@playwright/test';

interface Probe {
  snapshot(): {
    heroes: { id: string; state: { kind: string } }[];
    islands: { taskPoints: { state: string }[] }[];
  } | null;
  send(intent: unknown): void;
  sent(): { type: string }[];
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

async function submit(page: Page): Promise<void> {
  await probe(page, (p) =>
    p.send({
      type: 'sendMessage',
      heroId: p.snapshot()?.heroes[0]?.id,
      text: 'submit it',
      priority: 'now',
    }),
  );
}

test('Finish writes the record, then asks what happens to the council’s context (#167)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live&pr=demo&prPoll=off');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 15_000 })
    .toBe('idle');
  await submit(page);
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.islands[0]?.taskPoints[0]?.state), {
      timeout: 10_000,
    })
    .toBe('doneUnreviewed');
  await submit(page);
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 10_000 })
    .toBe('submitted');

  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByRole('button', { name: /^Finish/ }).click();
  const dialog = page.getByRole('dialog', { name: 'The campaign is over' });
  await expect(
    dialog.getByText('The campaign record is in .ibitsa/campaigns/demo/record.md.'),
  ).toBeVisible({
    timeout: 10_000,
  });
  await expect(dialog.getByText(/What happens to the council’s context\?/)).toBeVisible();
  await expect(dialog.getByRole('button')).toHaveText(['Empty', 'Compact', 'Keep']);
  // Empty is the default: it has the focus.
  await expect(dialog.getByRole('button', { name: 'Empty' })).toBeFocused();
  await page.screenshot({ path: 'test-results/campaign-end.png' });

  await dialog.getByRole('button', { name: 'Keep' }).click();
  await expect(
    dialog.getByText('The council’s context is kept for the next campaign.'),
  ).toBeVisible();
  expect(await probe(page, (p) => p.sent().map((c) => c.type))).toContain('chooseCouncilContext');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
