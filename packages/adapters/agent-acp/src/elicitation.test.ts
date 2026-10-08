import type { ElicitationSchema } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { formContent, formQuestions } from './elicitation';

const schema = (properties: Record<string, unknown>) =>
  ({ type: 'object', properties }) as unknown as ElicitationSchema;

describe('formQuestions (§11.5)', () => {
  it('asks each field of a form with choices, under the form’s message', () => {
    const form = formQuestions({
      message: 'Set up the release',
      schema: schema({
        channel: { type: 'string', title: 'Channel', enum: ['beta', 'stable'] },
        notify: { type: 'boolean', title: 'Notify' },
        targets: {
          type: 'array',
          title: 'Targets',
          items: {
            anyOf: [
              { const: 'mac', title: 'macOS' },
              { const: 'win', title: 'Windows' },
            ],
          },
        },
      }),
    });
    expect(form?.questions).toEqual([
      {
        question: 'Channel',
        header: 'Set up the release',
        options: [
          { label: 'beta', description: '' },
          { label: 'stable', description: '' },
        ],
        multiSelect: false,
      },
      {
        question: 'Notify',
        header: 'Set up the release',
        options: [
          { label: 'Yes', description: '' },
          { label: 'No', description: '' },
        ],
        multiSelect: false,
      },
      {
        question: 'Targets',
        header: 'Set up the release',
        options: [
          { label: 'macOS', description: '' },
          { label: 'Windows', description: '' },
        ],
        multiSelect: true,
      },
    ]);
  });

  it('keeps two fields with the same title apart by their keys', () => {
    const form = formQuestions({
      message: 'Pick',
      schema: schema({
        first: { type: 'string', title: 'Size', enum: ['s', 'm'] },
        second: { type: 'array', title: 'Size', items: { type: 'string', enum: ['l'] } },
      }),
    });
    expect(form?.questions.map((q) => q.question)).toEqual(['Size', 'second']);
  });

  it('gives up on a form the game cannot answer', () => {
    for (const properties of [
      {},
      { name: { type: 'string' } },
      { count: { type: 'integer' } },
      { tags: { type: 'array', items: { type: 'string', enum: [] } } },
      { odd: { type: 'array', items: { type: '_custom' } } },
    ]) {
      expect(formQuestions({ message: 'm', schema: schema(properties) })).toBeNull();
    }
    expect(formQuestions({ message: 'm', schema: { type: 'object' } })).toBeNull();
  });
});

describe('formContent', () => {
  const form = formQuestions({
    message: 'Set up the release',
    schema: schema({
      channel: { type: 'string', title: 'Channel', oneOf: [{ const: 'b', title: 'Beta' }] },
      notify: { type: 'boolean', title: 'Notify' },
      targets: { type: 'array', title: 'Targets', items: { type: 'string', enum: ['mac', 'win'] } },
      region: { type: 'string', title: 'Region', enum: ['eu'] },
    }),
  });

  it('sends back the values behind the chosen labels, leaving out what wasn’t answered', () => {
    expect(
      formContent({
        fields: form?.fields ?? [],
        answers: { Channel: 'Beta', Notify: 'No', Targets: ['mac', 'win'] },
      }),
    ).toEqual({ channel: 'b', notify: false, targets: ['mac', 'win'] });
  });

  it('takes a single label for a multi-select, and skips labels it never offered', () => {
    expect(
      formContent({
        fields: form?.fields ?? [],
        answers: { Targets: 'win', Channel: 'Gamma', Notify: 'Yes', Region: 'eu' },
      }),
    ).toEqual({ targets: ['win'], notify: true, region: 'eu' });
  });
});
