import { expect, type Page, test } from '@playwright/test';

// The focus camera (#59): zooms in on the working hero, zooms out to the whole map, comes back when
// something needs you, and leaves the DOM panels where they are.

interface Probe {
  snapshot(): { heroes: { state: { kind: string } }[] } | null;
  status(): { waitingFor: string | null };
  camera(): {
    zoom: number;
    aim: { zoom: number; follow: boolean };
    auto: boolean;
    view: { x: number; y: number; width: number; height: number };
  } | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

const cameraZoom = (page: Page) => probe(page, (p) => p.camera()?.zoom ?? 0);
const heroState = (page: Page) => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind);

test('zooms in when the hero starts working; zoom out shows the whole map', async ({ page }) => {
  await page.goto('/?autoplay=1&speed=2');
  await expect.poll(() => cameraZoom(page)).toBe(1);
  await expect.poll(() => heroState(page), { timeout: 20_000 }).toBe('working');
  await expect.poll(() => cameraZoom(page)).toBe(2);
  expect(await probe(page, (p) => p.camera()?.aim.follow)).toBe(true);
  await page.screenshot({ path: 'test-results/camera-focused.png' });

  const pane = page.getByRole('region', { name: 'Hero' });
  const paneBefore = await pane.boundingBox();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => cameraZoom(page)).toBe(1);
  // The whole 480×270 map is in view.
  await expect
    .poll(() =>
      probe(page, (p) => {
        const v = p.camera()?.view;
        return v ? v.x <= 0 && v.y <= 0 && v.x + v.width >= 480 && v.y + v.height >= 270 : false;
      }),
    )
    .toBe(true);
  await page.screenshot({ path: 'test-results/camera-overview.png' });
  // The DOM panels don't move with the camera.
  expect(await pane.boundingBox()).toEqual(paneBefore);
});

test('keyboard zoom: + and - step, 0 shows the whole map; typing in the pane does not zoom', async ({
  page,
}) => {
  await page.goto('/?autoplay=1&speed=2');
  await expect.poll(() => heroState(page), { timeout: 20_000 }).not.toBe('traveling');
  await page.locator('body').press('0');
  await expect.poll(() => cameraZoom(page)).toBe(1);
  await page.locator('body').press('+');
  await expect.poll(() => cameraZoom(page)).toBe(2);
  await page.locator('body').press('+');
  await expect.poll(() => cameraZoom(page)).toBe(3);
  await page.locator('body').press('-');
  await expect.poll(() => cameraZoom(page)).toBe(2);

  const message = page.getByLabel('Message to the hero');
  await message.click();
  await page.keyboard.type('0-0');
  await page.waitForTimeout(500);
  expect(await cameraZoom(page)).toBe(2);
  await expect(message).toHaveValue('0-0');
});

test('stays where you put it until something needs you, then comes back', async ({ page }) => {
  await page.goto('/?autoplay=1&speed=4&mode=interactive');
  await expect.poll(() => heroState(page), { timeout: 20_000 }).toBe('working');
  await expect.poll(() => cameraZoom(page)).toBe(2);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => cameraZoom(page)).toBe(1);
  // The hero keeps working: the camera stays out.
  await page.waitForTimeout(1_000);
  expect(await cameraZoom(page)).toBe(1);
  // The permission request needs you: the camera comes back to the hero.
  await expect.poll(() => heroState(page), { timeout: 20_000 }).toBe('waitingOnYou');
  await expect.poll(() => cameraZoom(page)).toBe(2);
});

test('with auto-focus off the camera never moves by itself', async ({ page }) => {
  await page.goto('/?speed=2');
  const auto = page.getByRole('button', { name: 'Auto-focus' });
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => heroState(page), { timeout: 20_000 }).toBe('working');
  await page.waitForTimeout(1_000);
  expect(await cameraZoom(page)).toBe(1);
  expect(await probe(page, (p) => p.camera()?.auto)).toBe(false);
});
