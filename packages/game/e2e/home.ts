import { expect, type Page } from '@playwright/test';

/**
 * Opens the council's welcome by clicking the council hut on Home Village (#180), as a player starts a
 * quest: the hut opens, the elder walks in and the form follows (#244). Retries while the map settles.
 */
export async function openWelcome(page: Page): Promise<void> {
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(async () => {
    if (await welcome.isVisible()) return;
    const at = await page.evaluate(() =>
      (
        window as unknown as { __ibitsa: { hutOnPage(): { x: number; y: number } | null } }
      ).__ibitsa.hutOnPage(),
    );
    // Null once the hut has opened: the elder is still walking in.
    if (at) await page.mouse.click(at.x, at.y);
    await expect(welcome).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
}

/**
 * Waits until the first hero has arrived and ended its first turn, waiting for orders (#289). Core turns
 * away a message sent before the hero's session has started ("The hero has not arrived yet."), and
 * before it arrives a hero shows as idle just as it does after its turn, so its state alone can't tell.
 */
export async function heroAwaitsOrders(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = (
            window as unknown as {
              __ibitsa: {
                snapshot(): {
                  heroes: { id: string }[];
                  needsYou: { kind: string; heroId?: string }[];
                } | null;
              };
            }
          ).__ibitsa.snapshot();
          const heroId = s?.heroes[0]?.id;
          return s?.needsYou.some((n) => n.kind === 'reply' && n.heroId === heroId) ?? false;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
}
