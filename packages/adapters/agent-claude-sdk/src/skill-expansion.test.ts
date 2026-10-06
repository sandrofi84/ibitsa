import { describe, expect, it } from 'vitest';
import { expandSkill } from './skill-expansion';

/** A skill's own `${NAME}` syntax, written without tripping the template-string lint. */
const ref = (name: string) => `\${${name}}`;

const expand = ({
  body,
  args = '',
  fields = {},
}: {
  body: string;
  args?: string;
  fields?: Record<string, string>;
}) => expandSkill({ body, fields, args, variables: { CLAUDE_PROJECT_DIR: '/wt' } });

describe('expandSkill (#85)', () => {
  it('fills in $ARGUMENTS, positions and variables', () => {
    expect(
      expand({ body: `Review $ARGUMENTS in ${ref('CLAUDE_PROJECT_DIR')}.`, args: 'alice bob' })
        .text,
    ).toBe('Review alice bob in /wt.');
    expect(
      expand({ body: 'First $0, second $ARGUMENTS[1], third $2.', args: 'a "b c"' }).text,
    ).toBe('First a, second b c, third .');
    const unknown = `Unknown ${ref('SOMETHING_ELSE')} stays.`;
    expect(expand({ body: unknown }).text).toBe(unknown);
  });

  it('fills in arguments named in the frontmatter', () => {
    expect(
      expand({
        body: 'Fix issue $issue on $branch.',
        args: '42 main',
        fields: { arguments: '[issue, branch]' },
      }).text,
    ).toBe('Fix issue 42 on main.');
    expect(expand({ body: 'Fix $issue.', args: '7', fields: { arguments: 'issue' } }).text).toBe(
      'Fix 7.',
    );
  });

  it('appends the arguments when the prompt never uses them, as Claude Code does', () => {
    expect(expand({ body: 'Run the tests.', args: 'unit' })).toEqual({
      text: 'Run the tests.\n\nARGUMENTS: unit',
      notes: [],
    });
    expect(expand({ body: 'Run the tests.' }).text).toBe('Run the tests.');
  });

  it('leaves shell lines as written and says Claude Code runs them', () => {
    const { text, notes } = expand({ body: 'Status:\n!`git status --short`\nNow fix it.' });
    expect(text).toContain('!`git status --short`');
    expect(notes).toEqual([
      'Claude Code runs `git status --short` when this is sent; its output takes its place.',
    ]);
  });
});
