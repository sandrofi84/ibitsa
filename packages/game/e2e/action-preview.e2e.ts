import { expect, type Page, test } from '@playwright/test';

// The action preview (#85): see what an action sends, and edit it for one message.

interface Probe {
  snapshot(): { heroes: { state: { kind: string } }[] } | null;
  hero: { speech(): string | null };
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

const heroState = (page: Page) => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind);

test('preview an action, edit it, and send the edited text', async ({ page }) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Skip the elder' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');

  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await bar.fill('/test unit');
  const preview = page.getByRole('region', { name: 'Action preview' });
  await expect(preview).toContainText('Preview of /test');
  await expect(preview).toContainText("Run this project's tests. Only these tests if given: unit");
  await page.screenshot({ path: 'test-results/action-preview.png' });
  // Needs you moves up with the taller bar instead of hiding behind it.
  const item = await page.locator('.needs-you .item').first().boundingBox();
  const barBox = await page.getByRole('region', { name: 'Command bar' }).boundingBox();
  expect(item && barBox && item.y + item.height <= barBox.y).toBe(true);

  await preview.getByRole('button', { name: 'Edit this message' }).click();
  await expect(bar).toHaveValue("Run this project's tests. Only these tests if given: unit");
  await expect(preview).toBeHidden();
  await bar.press('End');
  await page.keyboard.type(' and api');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => probe(page, (p) => p.hero.speech()))
    .toBe("Done: Run this project's tests.");
});

test('an action sent unedited goes as /name args; unknown ones show no preview', async ({
  page,
}) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Skip the elder' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  const preview = page.getByRole('region', { name: 'Action preview' });

  await bar.fill('/nonsense here');
  await page.waitForTimeout(400);
  await expect(preview).toBeHidden();

  await bar.fill('/pr alice');
  await expect(preview).toContainText('Request review from: alice');
  await bar.press('Enter');
  await expect.poll(() => probe(page, (p) => p.hero.speech())).toBe('Done: /pr alice');
});
