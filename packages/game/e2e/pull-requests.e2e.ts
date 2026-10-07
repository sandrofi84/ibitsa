import { expect, type Page, test } from '@playwright/test';

interface Probe {
  snapshot(): {
    campaign: { shipped: boolean } | null;
    heroes: { id: string; state: { kind: string } }[];
    islands: { id: string; worktree: string; taskPoints: { state: string }[] }[];
  } | null;
  send(intent: unknown): void;
  map(): { islands: { pr?: string | null }[]; shipped?: boolean; atIbitsa?: string[] } | null;
  pullRequestOnPage(islandId: string): { x: number; y: number } | null;
  pullRequestPanel(): string | null;
  pullRequestPreview(): string | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

const badge = (page: Page) => probe(page, (p) => p.map()?.islands[0]?.pr ?? null);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** A hero hands in its current task (the demo hero submits when told to). */
async function submit(page: Page, hero = 0): Promise<void> {
  await page.evaluate((n) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    p.send({
      type: 'sendMessage',
      heroId: p.snapshot()?.heroes[n]?.id,
      text: 'submit it',
      priority: 'now',
    });
  }, hero);
}

/** Clicks an island's PR badge on the map, with the whole map showing and nothing over it. */
async function clickBadge(page: Page, island = 0): Promise<void> {
  await page.locator('body').press('0');
  // "Needs you" cards and the hero pane can lie over a badge: they step aside for the click.
  const aside = (visibility: string) =>
    page.evaluate((v) => {
      for (const panel of document.querySelectorAll<HTMLElement>('.needs-you, .hero-pane')) {
        panel.style.visibility = v;
      }
    }, visibility);
  await aside('hidden');
  await expect(async () => {
    const at = await page.evaluate((n) => {
      const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
      return p.pullRequestOnPage(p.snapshot()?.islands[n]?.id ?? '');
    }, island);
    expect(at).not.toBeNull();
    if (!at) return;
    const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at);
    expect(under, `something covers the badge at ${at.x},${at.y}`).toBe('CANVAS');
    await page.mouse.click(at.x, at.y);
    expect(await probe(page, (p) => p.pullRequestPanel())).not.toBeNull();
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
  await aside('');
}

test('a PR from draft to merged: the badge, the card, the preview, Update, Mark ready, and Ibitsa (#153)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live&pr=demo&prPoll=off');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 15_000 })
    .toBe('idle');
  await expect.poll(() => badge(page)).toBe('none');

  // The task panel carries its island's PR card.
  await page
    .getByRole('region', { name: 'Hero' })
    .getByRole('button', { name: 'Open task' })
    .click();
  const taskPanel = page.getByRole('region', { name: /^Strip accents in slugify/ });
  await expect(
    taskPanel.getByRole('region', { name: 'Pull request' }).getByText('No pull request yet.'),
  ).toBeVisible();
  await taskPanel.getByRole('button', { name: 'Close' }).click();

  // The badge opens the card on its own.
  await clickBadge(page);
  const card = page.getByRole('region', { name: 'Pull request card' });
  await expect(card.getByRole('heading', { name: 'Accent-free slugs' })).toBeVisible();
  await card.getByRole('button', { name: 'Open PR' }).click();

  // The preview: built from the record, a draft until both tasks pass, into main.
  const preview = page.getByRole('form', { name: 'Open a pull request' });
  await expect(preview.getByLabel('Title')).toHaveValue('Accent-free slugs');
  await expect(preview.getByLabel('Description')).toHaveValue(/Unicode normalisation/);
  await expect(preview.getByLabel('Draft')).toBeChecked();
  await expect(preview.getByLabel('Draft')).toBeDisabled();
  await expect(preview.getByText('main', { exact: true })).toBeVisible();
  await preview.getByLabel('Title').fill('Slugs without accents');
  await preview.getByRole('button', { name: 'Open PR' }).click();
  await expect(preview).toBeHidden();

  await expect(card.getByText('Draft, into main')).toBeVisible({ timeout: 10_000 });
  await expect(card.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/ibitsa/demo/pull/1',
  );
  await expect.poll(() => badge(page)).toBe('draft');
  const markReady = card.getByRole('button', { name: 'Mark ready for review' });
  await expect(markReady).toBeDisabled();
  await expect(card.getByText('Every task on the island has to pass first.')).toBeVisible();
  // The badge, with the card closed and the whole map showing; then back to the card.
  await card.press('Escape');
  await page.locator('body').press('0');
  await page.screenshot({ path: 'test-results/pr-badges.png' });
  await clickBadge(page);

  await card.getByRole('button', { name: 'Update PR' }).click();
  await expect(card.getByText('Pushing…')).toBeVisible();
  await expect(card.getByText('Pushing…')).toBeHidden({ timeout: 10_000 });

  // Both tasks handed in: the draft can be marked ready.
  await submit(page);
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.islands[0]?.taskPoints[0]?.state), {
      timeout: 10_000,
    })
    .toBe('doneUnreviewed');
  await submit(page);
  await expect(markReady).toBeEnabled({ timeout: 10_000 });
  await markReady.click();
  await expect(card.getByText('Open, into main')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'test-results/pr-card.png' });

  // Someone approves and merges it on GitHub; Refresh polls.
  await card.getByRole('button', { name: 'Refresh' }).click();
  await expect(card.getByText('Approved, into main')).toBeVisible({ timeout: 10_000 });
  await card.getByRole('button', { name: 'Refresh' }).click();
  await expect(card.getByText('Merged, into main')).toBeVisible({ timeout: 10_000 });
  await expect(card.getByRole('button')).toHaveText(['Remove worktree', 'Close']);
  await expect.poll(() => probe(page, (p) => p.map()?.shipped)).toBe(true);
  const heroId = await probe(page, (p) => p.snapshot()?.heroes[0]?.id);
  await expect.poll(() => probe(page, (p) => p.map()?.atIbitsa)).toEqual([heroId]);

  // Merged: its worktree and local branch can go, mid-campaign, after a second click (#154).
  await card.getByRole('button', { name: 'Remove worktree' }).click();
  await card.getByRole('button', { name: 'Remove the worktree and local branch?' }).click();
  await expect(card.getByRole('button')).toHaveText(['Close'], { timeout: 10_000 });
  expect(await probe(page, (p) => p.snapshot()?.islands[0]?.worktree)).toBe('removed');
  await card.press('Escape');
  await expect(card).toBeHidden();
  await page.screenshot({ path: 'test-results/pr-ibitsa.png' });
  expect(errors).toEqual([]);
});

test('Push branch only pushes without a PR, and the preview can be cancelled (#153)', async ({
  page,
}) => {
  await page.goto('/?fixture=live&pr=demo&prPoll=off');
  await expect.poll(() => badge(page), { timeout: 15_000 }).toBe('none');
  await clickBadge(page);
  const card = page.getByRole('region', { name: 'Pull request card' });
  await card.getByRole('button', { name: 'Push branch only' }).click();
  await expect(card.getByText('Branch pushed; no pull request yet.')).toBeVisible({
    timeout: 10_000,
  });
  await card.getByRole('button', { name: 'Open PR' }).click();
  const preview = page.getByRole('form', { name: 'Open a pull request' });
  await preview.getByRole('button', { name: 'Cancel' }).click();
  await expect(preview).toBeHidden();
  expect(await probe(page, (p) => p.pullRequestPreview())).toBeNull();
  await expect.poll(() => badge(page)).toBe('none');
});

test('brings the PR comments to the hero, who goes back to the last task (#154)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live&pr=demo&prPoll=off');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 15_000 })
    .toBe('idle');
  await submit(page);
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.islands[0]?.taskPoints[0]?.state), {
      timeout: 10_000,
    })
    .toBe('doneUnreviewed');
  await submit(page);
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.islands[0]?.taskPoints[1]?.state), {
      timeout: 10_000,
    })
    .toBe('doneUnreviewed');
  await clickBadge(page);
  const card = page.getByRole('region', { name: 'Pull request card' });
  await card.getByRole('button', { name: 'Open PR' }).click();
  const preview = page.getByRole('form', { name: 'Open a pull request' });
  await expect(preview.getByLabel('Draft')).not.toBeChecked();
  await preview.getByRole('button', { name: 'Open PR' }).click();
  await expect(card.getByText('Open, into main')).toBeVisible({ timeout: 10_000 });

  expect(await probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind)).toBe('submitted');
  await card.getByRole('button', { name: 'Bring the comments to the hero' }).click();
  await expect(card.getByText('Fetching the review comments…')).toBeVisible();
  // The hero goes back to work on the comments (its session resumed) and, being the scripted
  // hero, hands the task in again straight away.
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 10_000 })
    .toBe('working');
  await expect(card.getByText('Fetching the review comments…')).toBeHidden();
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 15_000 })
    .toBe('submitted');
  expect(await probe(page, (p) => p.snapshot()?.islands[0]?.taskPoints[1]?.state)).toBe(
    'doneUnreviewed',
  );
  expect(errors).toEqual([]);
});

test('stacked: once the first PR merges, the second is retargeted and restacked (#154)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=live&pr=stacked&prPoll=off');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 15_000 })
    .toBe('idle');
  await submit(page);
  // The first island cleared: the second starts on its branch.
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[1]?.state.kind), { timeout: 15_000 })
    .toBe('idle');

  const card = page.getByRole('region', { name: 'Pull request card' });
  const preview = page.getByRole('form', { name: 'Open a pull request' });
  await clickBadge(page, 0);
  await card.getByRole('button', { name: 'Open PR' }).click();
  await preview.getByRole('button', { name: 'Open PR' }).click();
  await expect(card.getByText('Open, into main')).toBeVisible({ timeout: 10_000 });
  await card.press('Escape');

  await clickBadge(page, 1);
  await card.getByRole('button', { name: 'Open PR' }).click();
  await expect(preview.getByText('ibitsa/accent-free-slugs', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Open PR' }).click();
  await expect(card.getByText('Draft, into ibitsa/accent-free-slugs')).toBeVisible({
    timeout: 10_000,
  });

  // Someone approves and merges the first PR on GitHub.
  await card.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => badge(page), { timeout: 10_000 }).toBe('approved');
  await card.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => badge(page), { timeout: 10_000 }).toBe('merged');

  await expect(card.getByText('Draft, into main')).toBeVisible({ timeout: 10_000 });
  await expect(card.getByText(/Restack moves this branch onto main/)).toBeVisible();
  await page.screenshot({ path: 'test-results/pr-restack.png' });
  await card.getByRole('button', { name: 'Restack onto main' }).click();
  await card.getByRole('button', { name: 'Restack and force-push?' }).click();
  await expect(card.getByText(/Restack moves this branch/)).toBeHidden({ timeout: 10_000 });
  await expect(card.getByRole('button', { name: /Restack/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
