import { expect, type Page } from '@playwright/test';

/**
 * Opens the council's welcome by clicking the council hut on Home Village (#180), as a player starts a
 * quest. Retries while the map settles.
 */
export async function openWelcome(page: Page): Promise<void> {
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  await expect(async () => {
    const at = await page.evaluate(() =>
      (
        window as unknown as { __ibitsa: { hutOnPage(): { x: number; y: number } | null } }
      ).__ibitsa.hutOnPage(),
    );
    expect(at).not.toBeNull();
    if (!at) return;
    if (!(await welcome.isVisible())) await page.mouse.click(at.x, at.y);
    await expect(welcome).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
}
