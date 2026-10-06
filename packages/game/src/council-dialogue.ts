import type { CouncilAnswer, DialogueLine } from '@ibitsa/protocol';
import type { DialogueBatch, DialogueStep, DraftAnswer } from './council-dialogue.types';

/**
 * The council's questions as the dialogue box steps through them (§4.4, #102): one at a time, back and
 * next, an option or free text each, then every answer in one `answerCouncil`. Pure, so it's testable
 * without the DOM.
 */
export class CouncilDialogue {
  private index = 0;
  private readonly answers = new Map<string, DraftAnswer>();

  constructor(readonly batch: DialogueBatch) {}

  /** The question shown now, with its answer so far and the lines spoken about it. */
  step(dialogue: readonly DialogueLine[]): DialogueStep {
    const question = this.current;
    return {
      question,
      position: this.index + 1,
      count: this.batch.items.length,
      answer: this.answers.get(question.id) ?? null,
      lines: linesAbout({ dialogue, questionId: question.id }),
    };
  }

  get current(): DialogueBatch['items'][number] {
    const question = this.batch.items[this.index] ?? this.batch.items[0];
    if (!question) throw new Error('A question batch is never empty.');
    return question;
  }

  get isFirst(): boolean {
    return this.index === 0;
  }

  get isLast(): boolean {
    return this.index === this.batch.items.length - 1;
  }

  /** Picks one of the current question's options; unknown options are ignored. */
  choose(optionId: string): void {
    if (this.current.options.some((o) => o.id === optionId)) {
      this.answers.set(this.current.id, { optionId });
    }
  }

  /** The user's own words for the current question; empty text clears a written answer. */
  write(text: string): void {
    if (!this.current.allowFreeText) return;
    const trimmed = text.trim();
    const id = this.current.id;
    if (trimmed) this.answers.set(id, { text: trimmed });
    else if (this.wroteFor(id)) this.answers.delete(id);
  }

  private wroteFor(questionId: string): boolean {
    const answer = this.answers.get(questionId);
    return answer !== undefined && 'text' in answer;
  }

  get answered(): boolean {
    return this.answers.has(this.current.id);
  }

  next(): void {
    if (!this.isLast) this.index++;
  }

  back(): void {
    if (!this.isFirst) this.index--;
  }

  /** Every answer, keyed by question id, once all are given; null while any is missing. */
  toAnswers(): Record<string, CouncilAnswer> | null {
    const all: Record<string, CouncilAnswer> = {};
    for (const item of this.batch.items) {
      const answer = this.answers.get(item.id);
      if (!answer) return null;
      all[item.id] = answer;
    }
    return all;
  }
}

/**
 * The lines about one question: those tagged with it, plus untagged lines straight after them (other
 * councillors chiming in) until a line about another question.
 */
function linesAbout({
  dialogue,
  questionId,
}: {
  dialogue: readonly DialogueLine[];
  questionId: string;
}): DialogueLine[] {
  const lines: DialogueLine[] = [];
  let following = false;
  for (const line of dialogue) {
    if (line.questionId !== undefined) following = line.questionId === questionId;
    if (following) lines.push(line);
  }
  return lines;
}
