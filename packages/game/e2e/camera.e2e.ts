import { expect, type Page, test } from '@playwright/test';

// The focus camera (#59): zooms in on the working hero, zooms out to the whole map, comes back when
// something needs you, and leaves the DOM panels where they are.

interface Probe {
  snapshot(): { heroes: { state: { kind: string } }[] } | null;
  status(): { waitingFor: string | null };
  hero: {
    onPage(): { x: number; y: number } | null;
    speech(): string | null;
    speechWidth(): number | null;
  };
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
  // 1×: about 16 s between work starting and the permission request, so slow runners' polls fit.
  await page.goto('/?autoplay=1&speed=1&mode=interactive');
  await expect.poll(() => heroState(page), { timeout: 20_000 }).toBe('working');
  await expect.poll(() => cameraZoom(page)).toBe(2);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => cameraZoom(page)).toBe(1);
  // The hero keeps working: the camera stays out.
  await page.waitForTimeout(1_000);
  expect(await cameraZoom(page)).toBe(1);
  // The permission request needs you: the camera comes back to the hero.
  await expect.poll(() => heroState(page), { timeout: 30_000 }).toBe('waitingOnYou');
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

test('while following, the hero sits in the middle of the map you can see, left of the open pane', async ({
  page,
}) => {
  await page.goto('/?autoplay=1&speed=2');
  await expect.poll(() => heroState(page), { timeout: 20_000 }).toBe('working');
  await expect.poll(() => cameraZoom(page)).toBe(2);
  const heroX = () => probe(page, (p) => p.hero.onPage()?.x ?? 0);
  const pane = page.getByRole('region', { name: 'Hero' });

  const box = await pane.boundingBox();
  const visibleMiddle = (box?.x ?? 1000) / 2;
  await expect.poll(async () => Math.abs((await heroX()) - visibleMiddle)).toBeLessThan(24);

  // Collapsed, the pane covers almost nothing: the hero moves back to the middle of the panel.
  await pane.getByRole('button', { name: /hero pane/ }).click();
  const tab = await pane.boundingBox();
  const middle = (tab?.x ?? 1000) / 2;
  await expect.poll(async () => Math.abs((await heroX()) - middle)).toBeLessThan(24);
  await page.screenshot({ path: 'test-results/camera-collapsed.png' });
});

test('bubbles keep their size when the map zooms (#75)', async ({ page }) => {
  await page.goto('/?fixture=live');
  await page.getByRole('button', { name: 'New quest' }).click();
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => heroState(page)).toBe('idle');
  const pane = page.getByRole('region', { name: 'Hero' });
  const say = async () => {
    await pane.getByLabel('Message to the hero').fill('Once more');
    await pane.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => probe(page, (p) => p.hero.speech())).toBe('Done: Once more');
  };
  const width = () => probe(page, (p) => p.hero.speechWidth() ?? 0);

  // Each finished turn waits for orders, which brings the camera back: zoom only after the reply.
  await say();
  await expect.poll(() => heroState(page)).toBe('idle');
  await page.locator('body').press('0');
  await expect.poll(() => cameraZoom(page)).toBe(1);
  const atOne = await width();
  expect(atOne).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/bubble-zoom-1.png' });

  await page.locator('body').press('+');
  await expect.poll(() => cameraZoom(page)).toBe(2);
  expect(Math.abs((await width()) - atOne)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'test-results/bubble-zoom-2.png' });
});
