/** One line of an amendment's change set as the review shows it: a mark as well as words (#170). */
export interface ChangeLine {
  kind: 'added' | 'edited' | 'removed';
  mark: string;
  text: string;
}

/** The amendment review; Needs you focuses it. */
export interface AmendmentReview {
  focus(): void;
}
