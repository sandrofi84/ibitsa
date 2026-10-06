import type { Plan } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { planMarkdown } from './campaign-documents';

const plan: Plan = {
  summary: 'Sign-in',
  goal: 'Let users sign in',
  scope: 'Email only',
  tasks: [
    {
      id: 'T1',
      title: 'Auth',
      description: 'Add auth.',
      files: ['src/auth.ts'],
      dependsOn: [],
      heroClass: 'rogue',
      criteria: [{ councillorId: 'security', items: ['Hashed'] }],
      decisions: ['D1'],
    },
    {
      id: 'T2',
      title: 'Form',
      description: 'Add the form.',
      files: [],
      dependsOn: ['T1'],
      criteria: [],
      decisions: [],
    },
  ],
  decisions: [
    {
      id: 'D1',
      title: 'Methods',
      raisedBy: 'security',
      chosen: 'Email',
      alternatives: [{ option: 'Google', rejectedBecause: 'OAuth' }],
      tradeoffs: 'No social sign-in',
      why: 'Ship first',
      discussion: 'Short',
      affects: ['T1'],
    },
  ],
  islands: [
    { id: 'I1', title: 'Backend', tasks: ['T1'] },
    { id: 'I2', title: 'Frontend', tasks: ['T2'] },
  ],
  branching: 'stacked',
};

describe('planMarkdown (#104, #120)', () => {
  it('writes the goal, the tasks, the islands and the decisions as records', () => {
    const md = planMarkdown({ version: 2, plan });
    expect(md).toContain(
      '# Plan v2\n\nSign-in\n\n## Goal\n\nLet users sign in\n\n## Scope\n\nEmail only',
    );
    expect(md).toContain('### T1 · Auth');
    expect(md).toContain('**Suggested hero:** rogue');
    expect(md).toContain('**Acceptance criteria (security):**\n- Hashed');
    expect(md).toContain('**Depends on:** T1');
    expect(md).toContain('## Islands (stacked)\n\n- **I1 · Backend:** T1\n- **I2 · Frontend:** T2');
    expect(md).toContain(
      '### D1 · Methods (raised by security)\n**Chosen:** Email\n**Alternatives:** Google. Rejected: OAuth',
    );
    expect(md).toContain('**Trade-offs accepted:** No social sign-in');
    expect(md).toContain('**Affects tasks:** T1');
  });

  it('says when there are no decisions, and leaves islands out of a plan without them', () => {
    const md = planMarkdown({
      version: 1,
      plan: { summary: plan.summary, goal: plan.goal, tasks: plan.tasks, decisions: [] },
    });
    expect(md).toContain('## Book of Decisions\n\n(none)');
    expect(md).not.toContain('## Islands');
  });
});
