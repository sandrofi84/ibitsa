import { expect, type Page, test } from '@playwright/test';

// What the Command Palette's commands do in the game (#87): the extension sends host events.

interface Probe {
  snapshot(): { heroes: { state: { kind: string } }[] } | null;
  hostEvent(event: { channel: 'host'; type: string; text?: string }): void;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

test('Message Hero… focuses the bar; Run Action… fills it, with its preview', async ({ page }) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind)).toBe('idle');
  const bar = page.getByRole('combobox', { name: 'Command bar' });

  await probe(page, (p) => p.hostEvent({ channel: 'host', type: 'focusCommandBar' }));
  await expect(bar).toBeFocused();

  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await probe(page, (p) =>
    p.hostEvent({ channel: 'host', type: 'fillCommandBar', text: '/pr alice' }),
  );
  await expect(bar).toHaveValue('/pr alice');
  await expect(bar).toBeFocused();
  await expect(page.getByRole('region', { name: 'Action preview' })).toContainText(
    'Request review from: alice',
  );
});
