import { expect, type Page, test } from '@playwright/test';

interface Reviewer {
  councillorId: string;
  taskPointId: string;
  x: number;
  y: number;
  walking: boolean;
  magnifier: boolean;
  badge: number | null;
  failed: boolean;
  leaving: boolean;
  plate: { x: number; y: number; width: number; height: number };
}

interface Speech {
  heroId: string;
  bottom: number;
  ceiling: number | null;
  overCharacters: boolean;
}

interface Probe {
  map(): {
    islands: unknown[];
    reviewers?: Reviewer[];
    underReview?: string[];
    speech?: Speech[];
  } | null;
  hero: { speech(): string | null };
  camera(): { zoom: number } | null;
  snapshot(): {
    heroes: { id: string }[];
    islands: { taskPoints: { state: string }[] }[];
  } | null;
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

/** The screenshots are of the map: the Needs You cards would cover the first island. */
const UNCOVER = '.needs-you { display: none !important; }';

/** Three islands with reviews on (#140), the whole map in view, and the first hero hands its task in. */
async function submitFirst(page: Page): Promise<void> {
  await page.goto('/?fixture=live&campaign=separate&review=demo');
  await expect.poll(() => probe(page, (p) => p.map()?.islands.length), { timeout: 10_000 }).toBe(3);
  const auto = page.getByRole('button', { name: 'Auto-focus' });
  if ((await auto.getAttribute('aria-pressed')) === 'true') await auto.click();
  await page.locator('body').press('0');
  await expect.poll(() => probe(page, (p) => p.camera()?.zoom)).toBe(1);
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByLabel('Message to the hero').fill('Submit it');
  await pane.getByRole('button', { name: 'Send now' }).click();
}

test('councillors walk out to review, a magnifier each, and the hero waits under an hourglass (#140)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await submitFirst(page);
  await expect
    .poll(() => probe(page, (p) => p.map()?.reviewers?.map((r) => r.councillorId)), {
      timeout: 10_000,
    })
    .toEqual(['security', 'tester', 'architect']);
  const heroId = await probe(page, (p) => p.snapshot()?.heroes[0]?.id);
  expect(await probe(page, (p) => p.map()?.underReview)).toEqual([heroId]);
  await expect
    .poll(() => probe(page, (p) => p.map()?.reviewers?.filter((r) => r.walking).length))
    .toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/reviewers-walking.png', style: UNCOVER });

  // They arrive and stand around the hero with their magnifiers, on the island's left.
  await expect
    .poll(() => probe(page, (p) => p.map()?.reviewers?.map((r) => [r.walking, r.magnifier])), {
      timeout: 10_000,
    })
    .toEqual([
      [false, true],
      [false, true],
      [false, true],
    ]);
  const placed = (await probe(page, (p) => p.map()?.reviewers)) ?? [];
  expect(new Set(placed.map((r) => `${r.x},${r.y}`)).size).toBe(3);
  expect(errors).toEqual([]);
});

test("a hero's speech shows over the councillors reviewing it, above their heads (#271)", async ({
  page,
}) => {
  await submitFirst(page);
  // They stand around the hero, magnifiers out.
  await expect
    .poll(() => probe(page, (p) => p.map()?.reviewers?.filter((r) => !r.walking).length), {
      timeout: 10_000,
    })
    .toBe(3);
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByLabel('Message to the hero').fill('What are you waiting for?');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect
    .poll(() => probe(page, (p) => p.hero.speech()))
    .toBe('Done: What are you waiting for?');
  const [speech] = (await probe(page, (p) => p.map()?.speech)) ?? [];
  expect(speech?.overCharacters).toBe(true);
  // Councillors stand above the hero, so the bubble lifts clear of their heads.
  expect(speech?.ceiling).not.toBeNull();
  expect(speech?.bottom).toBeLessThanOrEqual(speech?.ceiling ?? 0);
  await page.screenshot({ path: 'test-results/reviewers-speech.png', style: UNCOVER });
});

test('reviewers setting out together keep their names apart, and back under them once spread out (#234)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await submitFirst(page);
  const overlapping = async () => {
    const plates = ((await probe(page, (p) => p.map()?.reviewers)) ?? []).map((r) => r.plate);
    return plates.some((a, i) =>
      plates
        .slice(i + 1)
        .some(
          (b) =>
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height,
        ),
    );
  };
  // All three on their way out: watched for the whole walk, no two names ever overlap.
  await expect
    .poll(() => probe(page, (p) => p.map()?.reviewers?.filter((r) => r.walking).length), {
      timeout: 10_000,
    })
    .toBe(3);
  await page.screenshot({ path: 'test-results/reviewers-names.png', style: UNCOVER });
  for (let i = 0; i < 20; i++) {
    expect(await overlapping()).toBe(false);
    if ((await probe(page, (p) => p.map()?.reviewers?.some((r) => r.walking))) === false) break;
    await page.waitForTimeout(100);
  }
  // Arrived and spread out beside the hero: every name is back under its own token.
  await expect
    .poll(() => probe(page, (p) => p.map()?.reviewers?.every((r) => !r.walking && r.magnifier)), {
      timeout: 10_000,
    })
    .toBe(true);
  const standing = (await probe(page, (p) => p.map()?.reviewers)) ?? [];
  for (const r of standing) expect(r.plate.y - r.y).toBe(2);
  expect(await overlapping()).toBe(false);
  expect(errors).toEqual([]);
});

test('a councillor asking for changes shows its blocking findings, then they all walk home; the next round passes (#140)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await submitFirst(page);
  // Security asks for changes with two blocking findings; the others pass and show nothing. (The
  // second round's councillor may already be on its way out beside them.)
  await expect
    .poll(
      () =>
        probe(page, (p) =>
          p
            .map()
            ?.reviewers?.filter((r) => r.leaving)
            .map((r) => [r.councillorId, r.badge, r.magnifier]),
        ),
      { timeout: 15_000 },
    )
    .toEqual([
      ['security', 2, false],
      ['tester', null, false],
      ['architect', null, false],
    ]);
  await page.screenshot({ path: 'test-results/reviewers-badges.png', style: UNCOVER });

  // The hero fixes it and resubmits: only security comes back, and this time it passes.
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.islands[0]?.taskPoints[0]?.state), {
      timeout: 30_000,
    })
    .toBe('done');
  await expect
    .poll(() => probe(page, (p) => p.map()?.reviewers?.length), { timeout: 15_000 })
    .toBe(0);
  expect(await probe(page, (p) => p.map()?.underReview)).toEqual([]);
  expect(errors).toEqual([]);
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('councillors appear in place instead of walking (#140)', async ({ page }) => {
    const errors = watchErrors(page);
    await submitFirst(page);
    await expect
      .poll(() => probe(page, (p) => p.map()?.reviewers?.length), { timeout: 10_000 })
      .toBe(3);
    const reviewers = (await probe(page, (p) => p.map()?.reviewers)) ?? [];
    expect(reviewers.map((r) => r.walking)).toEqual([false, false, false]);
    expect(errors).toEqual([]);
  });
});
