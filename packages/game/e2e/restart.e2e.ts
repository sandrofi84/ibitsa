import { expect, type Page, test } from '@playwright/test';

interface Probe {
  snapshot(): { heroes: { id: string; name: string; state: { kind: string } }[] } | null;
  send(intent: unknown): void;
  reload(resume?: 'ask' | 'never'): void;
  journal(): string[];
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

const states = (page: Page) =>
  probe(page, (p) => p.snapshot()?.heroes.map((h) => `${h.name}:${h.state.kind}`) ?? []);

test('after a reload the hero who was working carries on, and a notice says so (#166)', async ({
  page,
}) => {
  await page.goto('/?fixture=live&heroes=2');
  await expect
    .poll(() => states(page), { timeout: 15_000 })
    .toEqual(['Ranger Ilse:idle', 'Rogue Vex:idle']);
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.fill('@rogue-vex add a test');
  await bar.press('Enter');
  await expect.poll(() => states(page)).toEqual(['Ranger Ilse:idle', 'Rogue Vex:working']);

  await probe(page, (p) => p.reload());
  const notice = page.getByRole('status').filter({ hasText: 'VS Code reloaded' });
  await expect(notice).toHaveText('VS Code reloaded: resumed Rogue Vex.');
  await page.screenshot({ path: 'test-results/restart-notice.png' });
  // Nothing to decide, so nothing waits in "Needs you"; the journal says what happened.
  await expect(page.locator('.needs-you .item').filter({ hasText: 'reloaded' })).toHaveCount(0);
  expect(await probe(page, (p) => p.journal())).toContain('VS Code reloaded; resumed the session.');
  await expect
    .poll(() => states(page), { timeout: 15_000 })
    .toEqual(['Ranger Ilse:idle', 'Rogue Vex:idle']);
  await notice.click();
  await expect(notice).not.toHaveClass(/visible/);
});

/** Two heroes on the map, Rogue Vex at work: what a reload interrupts. */
async function vexWorking(page: Page): Promise<void> {
  await page.goto('/?fixture=live&heroes=2');
  await expect
    .poll(() => states(page), { timeout: 15_000 })
    .toEqual(['Ranger Ilse:idle', 'Rogue Vex:idle']);
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.fill('@rogue-vex add a test');
  await bar.press('Enter');
  await expect.poll(() => states(page)).toEqual(['Ranger Ilse:idle', 'Rogue Vex:working']);
  await page.evaluate(() => (window as unknown as { __ibitsa: Probe }).__ibitsa.reload('ask'));
}

const offer = (page: Page) => page.getByRole('dialog', { name: 'Resume where things left off?' });

test('with ibitsa.resume on ask, a reload asks first, and resumes what you pick (#293)', async ({
  page,
}) => {
  await vexWorking(page);
  const dialog = offer(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByRole('listitem')).toContainText('Rogue Vex');
  await page.screenshot({ path: 'test-results/resume-offer.png' });
  // Nothing has resumed while the dialog waits: no notice says so. (The dev host's simulated
  // reload leaves the fake session running, so the hero's state can't show it.)
  const notice = page.locator('.restart-notice');
  await expect(notice).not.toHaveClass(/visible/);

  await dialog.getByRole('button', { name: 'Resume all' }).click();
  await expect(dialog).toBeHidden();
  await expect(notice).toHaveText('VS Code reloaded: resumed Rogue Vex.');
  await expect(notice).toHaveClass(/visible/);
});

test("Don't resume now leaves the hero waiting for its next message (#293)", async ({ page }) => {
  await vexWorking(page);
  const dialog = offer(page);
  await dialog.getByRole('button', { name: "Don't resume now" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => probe(page, (p) => 'resumeOffer' in (p.snapshot() ?? {}))).toBe(false);
  // Nothing resumed, so nothing says it did.
  await expect(page.locator('.restart-notice')).not.toHaveClass(/visible/);
});
