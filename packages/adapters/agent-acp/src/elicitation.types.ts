import type { AskUserQuestion } from '@ibitsa/protocol';

/** One form field asked as a question: its key in the form, and each option's label → value. */
export interface FormField {
  key: string;
  question: string;
  shape: 'single' | 'multi' | 'boolean';
  values: Record<string, string>;
}

/** One choice in a field: what the user sees, and the value sent back. */
export interface Choice {
  label: string;
  description: string;
  value: string;
}

/** A form the game can ask: every field has choices. */
export interface FormQuestions {
  questions: AskUserQuestion[];
  fields: FormField[];
}
