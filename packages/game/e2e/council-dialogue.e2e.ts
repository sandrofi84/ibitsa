import { expect, type Page, test } from '@playwright/test';

interface Probe {
  hut(): { speaker: string | null; step: string } | null;
  hutOnPage(): { x: number; y: number } | null;
  status(): { waitingFor: string | null };
  snapshot(): { sitting: { status: string } | null } | null;
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

test('answers the council from the keyboard, asks "Why?", and returns to the map (#102)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=m3-round-table&autoplay=1&speed=16&mode=interactive');

  // The hut shows by itself while the council sits, without the command bar.
  await expect.poll(() => probe(page, (p) => p.hut()?.step), { timeout: 20_000 }).toBe('questions');
  await expect(page.locator('.command-bar')).toBeHidden();

  // "Needs you" offers the questions too, and opens the dialogue box.
  const box = page.getByRole('dialog', { name: 'The council asks' });
  await expect(box).toContainText('Architect asks · 1 of 2');
  await expect(box).toContainText('Which sign-in methods?');
  await expect(box.locator('.portrait')).toBeVisible();
  expect(await probe(page, (p) => p.hut()?.speaker)).toBe('architect');
  const option = box.getByRole('radio', { name: /Email and password/ });
  await expect(option).toContainText('Recommended:');

  // "Why?" and the councillor's answer.
  await box.getByRole('button', { name: 'Why?' }).click();
  const talk = box.getByRole('list', { name: 'Discussion' });
  await expect(talk).toContainText('You Why?');
  await expect(talk).toContainText('Architect');
  await expect(talk).toContainText('That is why I ask.');
  await page.screenshot({ path: 'test-results/council-dialogue-why.png' });

  // Keyboard only: a number key picks the option, Tab to Next, Enter.
  const next = box.getByRole('button', { name: 'Next' });
  await expect(next).toBeDisabled();
  await option.focus();
  await page.keyboard.press('1');
  await expect(option).toHaveAttribute('aria-checked', 'true');
  await next.focus();
  await page.keyboard.press('Enter');

  // The second question, answered in the user's own words; its councillor takes the floor.
  await expect(box).toContainText('Security asks · 2 of 2');
  await expect.poll(() => probe(page, (p) => p.hut()?.speaker)).toBe('security');
  const send = box.getByRole('button', { name: 'Send answers' });
  await expect(send).toBeDisabled();
  await box.getByRole('textbox', { name: 'Your own answer' }).focus();
  await page.keyboard.type('A week, with sign out everywhere');
  // Back keeps the first answer.
  await box.getByRole('button', { name: 'Back' }).focus();
  await page.keyboard.press('Enter');
  await expect(box.getByRole('radio', { name: /Email and password/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await box.getByRole('button', { name: 'Next' }).focus();
  await page.keyboard.press('Enter');
  await expect(box.getByRole('textbox', { name: 'Your own answer' })).toHaveValue(
    'A week, with sign out everywhere',
  );
  await page.screenshot({ path: 'test-results/council-dialogue-free-text.png' });
  await send.focus();
  await page.keyboard.press('Enter');

  // The replay carries on to the approved plan; the map and the command bar come back.
  await expect(box).toBeHidden();
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.sitting?.status), { timeout: 20_000 })
    .toBe('approved');
  await expect.poll(() => probe(page, (p) => p.hut())).toBeNull();
  await expect(page.locator('.command-bar')).toBeVisible();
  expect(errors).toEqual([]);
});

test('"Later" puts the questions in "Needs you", and "Answer" brings them back (#102)', async ({
  page,
}) => {
  await page.goto('/?fixture=m3-round-table&autoplay=1&speed=16&mode=interactive');
  await expect
    .poll(() => probe(page, (p) => p.status().waitingFor), { timeout: 20_000 })
    .toBe('answerCouncil');
  const box = page.getByRole('dialog', { name: 'The council asks' });
  const item = page.locator('.needs-you .item.council');
  await expect(box).toBeVisible();
  // While the box is open, "Needs you" stays out of its way.
  await expect(item).toBeHidden();

  await box.getByRole('button', { name: 'Later' }).click();
  await expect(box).toBeHidden();
  await expect(item).toBeVisible();
  await expect(item).toContainText('The council asks you 2 questions (Architect, Security).');
  await expect.poll(() => probe(page, (p) => p.hut()?.speaker)).toBeNull();
  // With the box away, the command bar talks to the council (#242).
  await expect(page.getByRole('combobox', { name: 'Command bar' })).toHaveAttribute(
    'placeholder',
    /Tell the council/,
  );

  await item.getByRole('button', { name: 'Answer' }).click();
  await expect(box).toBeVisible();
  await expect(box.getByRole('radio', { name: /Email and password/ })).toBeFocused();
  await expect.poll(() => probe(page, (p) => p.hut()?.speaker)).toBe('architect');
});

test("the hut's door leads back to the map; the council keeps sitting, and the hut or Answer leads back in (#245)", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=m3-round-table&autoplay=1&speed=16&mode=interactive');
  await expect
    .poll(() => probe(page, (p) => p.status().waitingFor), { timeout: 20_000 })
    .toBe('answerCouncil');
  const box = page.getByRole('dialog', { name: 'The council asks' });
  const item = page.locator('.needs-you .item.council');
  const exit = page.getByRole('button', { name: 'Back to the map' });
  await expect(box).toBeVisible();
  await expect(exit).toBeVisible();
  await page.screenshot({ path: 'test-results/hut-exit.png' });

  await exit.click();
  // The map, with the questions waiting in Needs you; the sitting goes on.
  await expect.poll(() => probe(page, (p) => p.hut())).toBeNull();
  await expect(exit).toBeHidden();
  await expect(box).toBeHidden();
  await expect(item).toBeVisible();
  expect(await probe(page, (p) => p.snapshot()?.sitting?.status)).toBe('deliberating');

  // Clicking the council hut goes back in, to the same questions.
  await expect(async () => {
    const at = await probe(page, (p) => p.hutOnPage());
    expect(at).not.toBeNull();
    if (at) await page.mouse.click(at.x, at.y);
    expect(await probe(page, (p) => p.hut())).not.toBeNull();
  }).toPass({ timeout: 10_000 });
  await expect(box).toBeVisible();
  await expect(box).toContainText('Which sign-in methods?');

  // Out again, and Answer in Needs you leads back in too.
  await exit.click();
  await expect.poll(() => probe(page, (p) => p.hut())).toBeNull();
  await item.getByRole('button', { name: 'Answer' }).click();
  await expect.poll(() => probe(page, (p) => p.hut())).not.toBeNull();
  await expect(box).toBeVisible();
  await expect(box.getByRole('radio', { name: /Email and password/ })).toBeFocused();
  expect(errors).toEqual([]);
});

test('a council that waits on you says so, hears you from the command bar, and can be dismissed (#242)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?fixture=m3-council-waits&autoplay=1&speed=16&mode=interactive');
  await expect
    .poll(() => probe(page, (p) => p.status().waitingFor), { timeout: 20_000 })
    .toBe('consultCouncil');

  // The elder's last word shows in the hut, over the command bar, which talks to the council.
  const word = page.locator('.council-word');
  await expect(word).toContainText('Elder: This repo has no Gatsby');
  const bar = page.getByRole('combobox', { name: 'Command bar' });
  await expect(bar).toBeVisible();

  // Needs you says the council waits; Reply puts the keyboard in the bar.
  const item = page.locator('.needs-you .item.council');
  await expect(item).toContainText('The council is waiting on you: tell it something');
  await item.getByRole('button', { name: 'Reply' }).click();
  await expect(bar).toBeFocused();

  // The council's pane: what it is doing, its reports and the journal.
  const pane = page.getByRole('region', { name: 'The council' });
  const tab = pane.getByRole('button', { name: /^Council · / });
  await expect(tab).toContainText('waiting on you');
  await tab.click();
  await expect(pane.getByRole('list', { name: 'Reports' })).toContainText(
    'Architect: 1 concern, 1 question',
  );
  await expect(pane.getByRole('list', { name: 'Reports' })).toContainText(
    'Tester: Nothing to test',
  );
  await expect(pane.getByRole('list', { name: 'Journal' })).toContainText('Elder:');
  await page.screenshot({ path: 'test-results/council-waits.png' });

  // Telling the council something: the user's line, then the council's answer.
  await bar.fill('Add Gatsby fresh, as a recipe site.');
  await bar.press('Enter');
  await expect(pane.getByRole('list', { name: 'Journal' })).toContainText(
    'You: Add Gatsby fresh, as a recipe site.',
  );
  await expect(word).toContainText('Architect: Then it is a new site');

  // Dismiss asks once more, then the sitting ends and the map comes back.
  await expect.poll(() => probe(page, (p) => p.status().waitingFor)).toBe('dismissCouncil');
  // (By keyboard: the standalone build's replay controls sit over the pane's foot.)
  await pane.getByRole('button', { name: 'Dismiss the council' }).press('Enter');
  await pane.getByRole('button', { name: 'Dismiss', exact: true }).press('Enter');
  await expect
    .poll(() => probe(page, (p) => p.snapshot()?.sitting?.status), { timeout: 20_000 })
    .toBe('dismissed');
  await expect.poll(() => probe(page, (p) => p.hut())).toBeNull();
  await expect(pane).toBeHidden();
  expect(errors).toEqual([]);
});
