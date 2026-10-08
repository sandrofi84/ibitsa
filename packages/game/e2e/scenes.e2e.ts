import { crc32, deflateSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';

// Home Village and Ibitsa from a pack (#221): optional pictures that replace the game's own drawing.

interface Probe {
  map(): {
    islands: unknown[];
    art?: { village: 'pack' | 'drawn'; ibitsa: 'pack' | 'drawn' };
  } | null;
}

const art = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ibitsa: Probe }).__ibitsa.map()?.art ?? null);

/** A PNG of one colour, to stand in for a pack's picture. */
function png({ width, height, rgba }: { width: number; height: number; rgba: number[] }): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set(rgba, y * (width * 4 + 1) + 1 + x * 4);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test("Home Village and Ibitsa show a pack's own pictures, and the game draws its own without them (#221)", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // One handler for the manifest, switched below: first a pack without a village or an Ibitsa
  // of its own (the default pack has the drawn art's, #223), then one with stand-ins.
  let withScenes = false;
  await page.route('**/pack/pack.json', async (route) => {
    const manifest = await (await route.fetch()).json();
    if (withScenes)
      manifest.scenes = { village: 'scenes/village.png', ibitsa: 'scenes/ibitsa.png' };
    else {
      delete manifest.scenes?.village;
      delete manifest.scenes?.ibitsa;
    }
    await route.fulfill({ json: manifest });
  });
  // A campaign is on, so Ibitsa stands on the horizon beside the village.
  await page.goto('/?fixture=live&campaign=separate');
  await expect
    .poll(() => art(page), { timeout: 20_000 })
    .toEqual({
      village: 'drawn',
      ibitsa: 'drawn',
    });

  withScenes = true;
  // A green village island and a pale Ibitsa, at their slot sizes (128×96 and 48×32).
  await page.route('**/pack/scenes/village.png', (route) =>
    route.fulfill({
      body: png({ width: 128, height: 96, rgba: [0x63, 0xc7, 0x4d, 255] }),
      contentType: 'image/png',
    }),
  );
  await page.route('**/pack/scenes/ibitsa.png', (route) =>
    route.fulfill({
      body: png({ width: 48, height: 32, rgba: [0xc0, 0xcb, 0xdc, 255] }),
      contentType: 'image/png',
    }),
  );
  await page.reload();
  await expect
    .poll(() => art(page), { timeout: 20_000 })
    .toEqual({
      village: 'pack',
      ibitsa: 'pack',
    });
  await page.screenshot({ path: 'test-results/scenes-pack.png' });
  expect(errors).toEqual([]);
});
