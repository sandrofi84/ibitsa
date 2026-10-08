/** What the validator said about a pack, and whether it can be used (#235). */
export interface PackStatus {
  /** Errors stop a pack; warnings don't. */
  usable: boolean;
  /** Errors first, then warnings, each with the word the tab shows before it. */
  notes: { kind: 'error' | 'warning'; label: 'Error' | 'Warning'; text: string }[];
}
