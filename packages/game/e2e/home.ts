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
