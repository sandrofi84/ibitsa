import type { DialogueLine, SittingView } from '@ibitsa/protocol';
import { CouncilDialogue } from './council-dialogue';
import type { CouncilDialogueBox, CouncilDialogueOptions } from './council-dialogue-box.types';
import { button, el } from './dom';
import { councillorAppearance, councillorTitle, isSitting } from './sitting-hut';

/**
 * The council's RPG dialogue box (§4.4, §7.1 screen 2, #102): plain DOM over the hut, usable from the
 * keyboard alone. It steps through the waiting batch one question at a time: the asking councillor's
 * portrait, the question, options with their trade-offs and the recommendation, free text, and "Why?".
 * All answers go back in one `answerCouncil`.
 */
export function mountCouncilDialogue({
  client,
  portrait,
  onFocus,
  onAway,
}: CouncilDialogueOptions): CouncilDialogueBox {
  const box = el('section', { className: 'council-dialogue' });
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'The council asks');
  box.hidden = true;
  document.body.appendChild(box);

  let dialogue: CouncilDialogue | null = null;
  let lines: DialogueLine[] = [];
  let sending = false;
  /** Put away with "Later"; "Needs you" brings it back. */
  let later = false;
  let shown = '';

  const close = () => {
    dialogue = null;
    shown = '';
    box.hidden = true;
    box.replaceChildren();
    onFocus(null);
  };

  client.onSnapshot((snapshot) => {
    const sitting = snapshot.sitting;
    if (!isSitting(sitting) || !sitting.questions) {
      if (dialogue) close();
      return;
    }
    if (dialogue?.batch.batchId !== sitting.questions.batchId) {
      dialogue = new CouncilDialogue(sitting.questions);
      sending = false;
      later = false;
    }
    lines = sitting.dialogue;
    const key = JSON.stringify([sitting.questions.batchId, lines]);
    if (key !== shown) render(sitting);
    shown = key;
  });
  client.onCue((cue) => {
    // A refused answer (say, the batch moved on) lets the user try again.
    if (cue.type === 'commandRejected' && sending) {
      sending = false;
      rerender();
    }
  });

  let lastSitting: SittingView | null = null;
  const rerender = () => {
    if (lastSitting) render(lastSitting);
  };

  function render(sitting: SittingView): void {
    lastSitting = sitting;
    const d = dialogue;
    if (!d) return;
    const restore = (document.activeElement as HTMLElement | null)?.dataset.key;
    const step = d.step(lines);
    const { question } = step;
    const title = councillorTitle(question.councillorId);
    if (!later) onFocus(question.id);

    const header = el('header');
    const src = portrait(councillorAppearance(question.councillorId));
    if (src) {
      const img = el('img', { className: 'portrait' });
      img.src = src;
      img.alt = '';
      header.append(img);
    }
    const who = el('p', { className: 'who' });
    who.append(el('strong', { text: title }), ' asks');
    if (step.count > 1) who.append(el('span', { text: ` · ${step.position} of ${step.count}` }));
    header.append(who);

    const asked = el('p', { className: 'question', text: question.question });
    asked.id = 'council-question';

    const options = el('div', { className: 'options' });
    options.setAttribute('role', 'radiogroup');
    options.setAttribute('aria-labelledby', 'council-question');
    const text = question.allowFreeText ? el('textarea') : null;
    question.options.forEach((option, i) => {
      const chosen =
        step.answer !== null && 'optionId' in step.answer && step.answer.optionId === option.id;
      const choice = el('button', { className: 'option' });
      choice.type = 'button';
      choice.setAttribute('role', 'radio');
      choice.setAttribute('aria-checked', String(chosen));
      choice.dataset.key = `option-${option.id}`;
      choice.append(
        el('span', { className: 'key', text: String(i + 1) }),
        el('strong', { text: option.label }),
        el('span', { className: 'tradeoff', text: option.tradeoff }),
      );
      if (question.recommendation?.optionId === option.id) {
        choice.append(
          el('span', {
            className: 'recommended',
            text: `Recommended: ${question.recommendation.reason}`,
          }),
        );
      }
      choice.onclick = () => {
        d.choose(option.id);
        if (text) text.value = '';
        render(sitting);
      };
      options.append(choice);
    });

    const parts: HTMLElement[] = [header, asked];
    if (step.lines.length > 0) {
      const talk = el('ul', { className: 'discussion' });
      talk.setAttribute('aria-label', 'Discussion');
      talk.setAttribute('aria-live', 'polite');
      for (const line of step.lines) {
        const li = el('li', { className: line.speaker === 'you' ? 'you' : 'councillor' });
        li.append(
          el('strong', { text: line.speaker === 'you' ? 'You' : councillorTitle(line.speaker) }),
          ` ${line.text}`,
        );
        talk.append(li);
      }
      parts.push(talk);
    }
    if (question.options.length > 0) parts.push(options);
    if (text) {
      text.rows = question.options.length > 0 ? 1 : 2;
      text.dataset.key = 'text';
      text.placeholder =
        question.options.length > 0 ? 'Or answer in your own words…' : 'Your answer…';
      text.setAttribute('aria-label', 'Your own answer');
      text.value = step.answer && 'text' in step.answer ? step.answer.text : '';
      text.oninput = () => {
        d.write(text.value);
        // Writing an answer replaces a chosen option.
        const answer = d.step(lines).answer;
        if (answer && 'text' in answer) {
          for (const b of options.querySelectorAll('[role="radio"]'))
            b.setAttribute('aria-checked', 'false');
        }
        updateNav();
      };
      parts.push(text);
    }

    const why = el('div', { className: 'why' });
    const whyButton = button({
      label: 'Why?',
      onClick: () =>
        client.send({ type: 'askCouncilWhy', batchId: d.batch.batchId, questionId: question.id }),
    });
    whyButton.dataset.key = 'why';
    const follow = el('input');
    follow.type = 'text';
    follow.dataset.key = 'follow';
    follow.placeholder = `Ask ${title} something else…`;
    follow.setAttribute('aria-label', `Ask ${title}`);
    const ask = () => {
      const value = follow.value.trim();
      if (!value) return;
      client.send({
        type: 'askCouncilWhy',
        batchId: d.batch.batchId,
        questionId: question.id,
        text: value,
      });
      follow.value = '';
    };
    follow.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ask();
      }
    };
    why.append(whyButton, follow);

    const nav = el('div', { className: 'nav' });
    const back = button({
      label: 'Back',
      onClick: () => {
        d.back();
        render(sitting);
      },
    });
    back.dataset.key = 'back';
    const forward = d.isLast
      ? button({
          label: 'Send answers',
          onClick: () => {
            const answers = d.toAnswers();
            if (!answers || sending) return;
            sending = true;
            client.send({ type: 'answerCouncil', batchId: d.batch.batchId, answers });
            updateNav();
          },
        })
      : button({
          label: 'Next',
          onClick: () => {
            d.next();
            render(sitting);
            box.querySelector<HTMLElement>('[data-key^="option-"], textarea')?.focus();
          },
        });
    forward.dataset.key = 'forward';
    forward.className = 'primary';
    const putAway = button({
      label: 'Later',
      onClick: () => {
        later = true;
        box.hidden = true;
        onAway();
      },
    });
    putAway.className = 'later';
    nav.append(back, forward);
    // One footer row: Later, then "Why?" and a follow-up, then Back and Next.
    const footer = el('div', { className: 'footer' });
    footer.append(putAway, why, nav);
    parts.push(footer);

    const updateNav = (): void => {
      back.disabled = d.isFirst || sending;
      forward.disabled = sending || (d.isLast ? d.toAnswers() === null : !d.answered);
    };
    updateNav();

    box.replaceChildren(...parts);
    box.hidden = later;
    if (restore) box.querySelector<HTMLElement>(`[data-key="${restore}"]`)?.focus();
  }

  // Number keys pick an option, unless the user is typing.
  box.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1) return;
    const option = box.querySelectorAll<HTMLButtonElement>('[role="radio"]')[n - 1];
    if (!option) return;
    e.preventDefault();
    option.click();
    box.querySelector<HTMLElement>(`[data-key="${option.dataset.key}"]`)?.focus();
  });

  return {
    element: box,
    focus: () => {
      if (!dialogue) return false;
      later = false;
      box.hidden = false;
      onFocus(dialogue.current.id);
      box.querySelector<HTMLElement>('[role="radio"], textarea, button')?.focus();
      return true;
    },
  };
}
