import type {
  ElicitationContentValue,
  ElicitationPropertySchema,
  ElicitationSchema,
  EnumOption,
  MultiSelectPropertySchema,
  StringMultiSelectItems,
  StringPropertySchema,
  TitledMultiSelectItems,
} from '@agentclientprotocol/sdk';
import type { AskUserQuestion } from '@ibitsa/protocol';
import type { Choice, FormField, FormQuestions } from './elicitation.types';

const YES = 'Yes';
const NO = 'No';

/**
 * An `elicitation/create` form as questions for "Needs you" (§11.5): only when every field offers
 * choices, which is what the game can answer. A form with a free-text or number field gets null, and
 * the adapter declines it; the agent can then ask in plain words, which reaches the user as a reply.
 */
export function formQuestions({
  message,
  schema,
}: {
  message: string;
  schema: ElicitationSchema;
}): FormQuestions | null {
  const entries = Object.entries(schema.properties ?? {});
  if (entries.length === 0) return null;
  const fields: FormField[] = [];
  const questions: AskUserQuestion[] = [];
  for (const [key, property] of entries) {
    const choices = choicesOf(property);
    if (!choices) return null;
    const title = 'title' in property && typeof property.title === 'string' ? property.title : key;
    // One field: the form's own message is the question. Several: each field's title, kept apart.
    const text = entries.length === 1 ? message : title;
    const question = questions.some((q) => q.question === text) ? key : text;
    fields.push({
      key,
      question,
      shape: choices.shape,
      values: Object.fromEntries(choices.options.map((o) => [o.label, o.value])),
    });
    questions.push({
      question,
      header: entries.length === 1 ? title : message,
      options: choices.options.map(({ label, description }) => ({ label, description })),
      multiSelect: choices.shape === 'multi',
    });
  }
  return { questions, fields };
}

/** The user's answers, by question, as the form's content. Unanswered fields are left out. */
export function formContent({
  fields,
  answers,
}: {
  fields: readonly FormField[];
  answers: Record<string, string | string[]>;
}): Record<string, ElicitationContentValue> {
  const content: Record<string, ElicitationContentValue> = {};
  for (const field of fields) {
    const answer = answers[field.question];
    if (answer === undefined) continue;
    const labels = Array.isArray(answer) ? answer : [answer];
    const values = labels.flatMap((label) => {
      const value = field.values[label];
      return value === undefined ? [] : [value];
    });
    if (field.shape === 'multi') content[field.key] = values;
    else if (values[0] === undefined) continue;
    else if (field.shape === 'boolean') content[field.key] = values[0] === 'true';
    else content[field.key] = values[0];
  }
  return content;
}

function choicesOf(
  property: ElicitationPropertySchema,
): { shape: FormField['shape']; options: Choice[] } | null {
  switch (property.type) {
    case 'boolean':
      return {
        shape: 'boolean',
        options: [
          { label: YES, description: '', value: 'true' },
          { label: NO, description: '', value: 'false' },
        ],
      };
    case 'string': {
      const s = property as StringPropertySchema;
      const options = s.oneOf ? s.oneOf.map(titled) : (s.enum ?? []).map(untitled);
      return options.length > 0 ? { shape: 'single', options } : null;
    }
    case 'array': {
      const items = (property as MultiSelectPropertySchema).items;
      const options =
        'anyOf' in items
          ? (items as TitledMultiSelectItems).anyOf.map(titled)
          : 'enum' in items
            ? (items as StringMultiSelectItems).enum.map(untitled)
            : [];
      return options.length > 0 ? { shape: 'multi', options } : null;
    }
    default:
      return null;
  }
}

function titled(option: EnumOption): Choice {
  return { label: option.title, description: option.description ?? '', value: option.const };
}

function untitled(value: string): Choice {
  return { label: value, description: '', value };
}
