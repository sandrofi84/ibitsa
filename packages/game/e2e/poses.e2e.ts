import { expect, type Page, test } from '@playwright/test';
import { heroAwaitsOrders, openWelcome } from './home';

// The map's optional poses (#222): each moment asks for its own animation, and a character whose
// sheet doesn't have it yet (drawn art without that pose, §9.5) plays the fallback instead.

interface Probe {
  map(): {
    islands: unknown[];
    poses?: { heroId: string; pose: string; wants: string }[];
    blocked?: { heroId: string; reason: string }[];
    reviewers?: { walking: boolean; magnifier: boolean; pose: string }[];
  } | null;
  snapshot(): { heroes: { id: string; state: { kind: string } }[] } | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

test('a blocked hero slumps, and a reviewing councillor peers at the work (#222)', async ({
  page,
}) => {
  await page.goto('/?fixture=live&campaign=separate&review=demo');
  await expect.poll(() => probe(page, (p) => p.map()?.islands.length), { timeout: 10_000 }).toBe(3);
  // The probe runs in the page, so the blocked hero is looked up there.
  await expect
    .poll(() =>
      probe(page, (p) => {
        const map = p.map();
        const blocked = map?.blocked?.[0]?.heroId;
        const hero = map?.poses?.find((h) => h.heroId === blocked);
        return hero && `${hero.wants}:${hero.pose}`;
      }),
    )
    .toMatch(/^blocked:(blocked|idle)$/);

  await heroAwaitsOrders(page);
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByLabel('Message to the hero').fill('Submit it');
  await pane.getByRole('button', { name: 'Send now' }).click();
  // Out at the task point with its magnifier up, a councillor plays its review pose.
  await expect
    .poll(
      () =>
        probe(page, (p) =>
          p.map()?.reviewers?.some((r) => !r.walking && r.magnifier && r.pose === 'review'),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.screenshot({ path: 'test-results/poses-review.png' });
});

test('a hero waiting on your answer raises a hand (#222)', async ({ page }) => {
  await page.goto('/?fixture=live');
  await openWelcome(page);
  await page.getByLabel('Task').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start a quick quest now' }).click();
  await page.getByRole('button', { name: 'Start quest' }).click();
  await expect.poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind)).toBe('idle');
  const pane = page.getByRole('region', { name: 'Hero' });
  await pane.getByLabel('Message to the hero').fill('Please commit');
  await pane.getByRole('button', { name: 'Send now' }).click();
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind))
    .toBe('waitingOnYou');
  await expect
    .poll(() =>
      probe(page, (p) => {
        const hero = p.map()?.poses?.[0];
        return hero && `${hero.wants}:${hero.pose}`;
      }),
    )
    .toMatch(/^ask:(ask|idle)$/);
  await page.screenshot({ path: 'test-results/poses-ask.png' });
});
