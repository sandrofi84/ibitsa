import { expect, type Page, test } from '@playwright/test';

interface Probe {
  snapshot(): {
    heroes: { id: string; state: { kind: string } }[];
    islands: { taskPoints: { id: string; state: string }[] }[];
  } | null;
  send(intent: unknown): void;
  taskOnPage(taskPointId: string): { x: number; y: number } | null;
  taskPanel(): string | null;
}

const probe = <T>(page: Page, read: (p: Probe) => T) =>
  page.evaluate((src) => {
    const p = (window as unknown as { __ibitsa: Probe }).__ibitsa;
    return new Function('p', `return (${src})(p)`)(p);
  }, read.toString()) as Promise<T>;

const taskState = (page: Page) =>
  probe(page, (p) => p.snapshot()?.islands[0]?.taskPoints[0]?.state ?? null);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Straight into a reviewed task (#141), with its hero waiting; then it hands the task in. */
async function submit(page: Page, scenario: string): Promise<void> {
  await page.goto(`/?fixture=live&reviewScript=${scenario}`);
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.heroes[0]?.state.kind), { timeout: 15_000 })
    .toBe('idle');
  await probe(page, (p) =>
    p.send({
      type: 'sendMessage',
      heroId: p.snapshot()?.heroes[0]?.id,
      text: 'submit it',
      priority: 'now',
    }),
  );
}

test('a review asks for changes once, then passes: the task panel shows both rounds and the suggestion (#141)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await submit(page, 'pass');
  // Opened from the hero pane while the task is under way.
  await page
    .getByRole('region', { name: 'Hero' })
    .getByRole('button', { name: 'Open task' })
    .click();
  const panel = page.getByRole('region', { name: /^Fix the redirect/ });
  await expect(panel.getByRole('heading', { name: 'Fix the redirect' })).toBeVisible();
  await expect(panel.getByText('Done: Passed review')).toBeVisible({ timeout: 15_000 });

  const checks = panel.getByRole('list', { name: 'Checks' });
  await expect(checks.locator('summary')).toHaveText(['pnpm test passed', 'pnpm lint passed']);

  const round1 = panel.getByRole('region', { name: 'Round 1' });
  await expect(
    round1.getByRole('listitem').filter({ hasText: /^Tester asks for changes/ }),
  ).toBeVisible();
  await expect(
    round1.getByText(/Fails “Signing in lands on the page you asked for\.”/),
  ).toBeVisible();
  await expect(round1.getByText('src/app.ts:12')).toBeVisible();
  await expect(round1.getByText(/^Security passed/)).toBeVisible();
  const round2 = panel.getByRole('region', { name: 'Round 2' });
  await expect(round2.getByText(/^Tester passed/)).toBeVisible();

  const suggestions = panel.getByRole('list', { name: 'Suggestions' });
  await expect(
    suggestions.getByText(/Name the redirect helper after what it guards/),
  ).toBeVisible();
  await expect(panel.getByText('Kept for the pull request.')).toBeVisible();
  await page.screenshot({ path: 'test-results/task-panel.png' });

  // Esc closes it; a click on the task point on the map opens it again.
  await panel.press('Escape');
  await expect(panel).toBeHidden();
  const id = await probe(page, (p) => p.snapshot()?.islands[0]?.taskPoints[0]?.id ?? '');
  await expect(async () => {
    const at = await probe(page, (p) =>
      p.taskOnPage(p.snapshot()?.islands[0]?.taskPoints[0]?.id ?? ''),
    );
    expect(at).not.toBeNull();
    await page.mouse.click(at?.x ?? 0, at?.y ?? 0);
    expect(await probe(page, (p) => p.taskPanel())).toBe(id);
  }).toPass({ timeout: 10_000 });
  await expect(panel).toBeVisible();
  expect(errors).toEqual([]);
});

test('past the loop limit the review comes to you, and Accept anyway passes the task (#141)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await submit(page, 'stubborn');
  const needsYou = page.getByRole('region', { name: 'Needs you' });
  const item = needsYou.getByRole('article').filter({ hasText: 'went round too many times' });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await expect(item.getByText(/Tester: Fails “Signing in lands/)).toBeVisible();
  await expect(item.getByRole('textbox', { name: 'A note for the hero (optional)' })).toBeVisible();
  await expect(item.getByRole('button', { name: 'Send back' })).toBeVisible();
  await expect(item.getByRole('button', { name: 'Stop' })).toBeVisible();
  await item.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/review-escalation.png' });

  // Open task shows both rounds of changes.
  await item.getByRole('button', { name: 'Open task' }).click();
  const panel = page.getByRole('region', { name: /^Fix the redirect/ });
  await expect(panel.getByText('Under review: Waiting for you')).toBeVisible();
  await expect(
    panel.getByRole('region', { name: 'Round 2' }).getByText(/asks for changes/),
  ).toBeVisible();

  await item.getByRole('button', { name: 'Accept anyway' }).click();
  await expect.poll(() => taskState(page)).toBe('done');
  await expect(item).toBeHidden();
  expect(errors).toEqual([]);
});

test('the hero disputes a finding, and Drop the findings lets the task pass (#141)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await submit(page, 'dispute');
  const item = page
    .getByRole('region', { name: 'Needs you' })
    .getByRole('article')
    .filter({ hasText: 'disputes the review' });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await expect(item.getByText(/decision D1 settled/)).toBeVisible();
  await expect(item.getByText(/Tester: Fails “Signing in lands/)).toBeVisible();
  await expect(item.getByRole('button', { name: 'Keep them' })).toBeVisible();
  await item.getByRole('button', { name: 'Drop the findings' }).click();
  await expect(item).toBeHidden();
  await expect.poll(() => taskState(page), { timeout: 10_000 }).toBe('done');
  expect(errors).toEqual([]);
});

test('a reviewer asks to revisit a decision; it stands, and Dismiss clears it (#141)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await submit(page, 'revisit');
  const item = page
    .getByRole('region', { name: 'Needs you' })
    .getByRole('article')
    .filter({ hasText: 'asks to revisit D1' });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await expect(
    item.getByText('Tester asks to revisit D1: A test may cost more than it saves here.'),
  ).toBeVisible();
  await expect(
    item.getByText('The decision stands. To change it, talk to the council.'),
  ).toBeVisible();
  await item.getByRole('button', { name: 'Dismiss' }).click();
  await expect(item).toBeHidden();
  expect(errors).toEqual([]);
});

test('a failing check shows in the task panel with its output (#141)', async ({ page }) => {
  const errors = watchErrors(page);
  await submit(page, 'failing');
  await page
    .getByRole('region', { name: 'Hero' })
    .getByRole('button', { name: 'Open task' })
    .click();
  const panel = page.getByRole('region', { name: /^Fix the redirect/ });
  const failed = panel.getByRole('list', { name: 'Checks' }).getByRole('listitem').first();
  await expect(failed.locator('summary')).toHaveText('pnpm test failed', { timeout: 15_000 });
  // A failure opens with its output showing.
  await expect(failed.getByText(/Expected "\/settings", got "\/"/)).toBeVisible();
  await expect(panel.getByText(/^In progress: Sent back/)).toBeVisible();
  expect(errors).toEqual([]);
});
