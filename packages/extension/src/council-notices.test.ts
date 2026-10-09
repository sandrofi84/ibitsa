import type { Plan, SittingView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { councilNews } from './council-notices';

const sitting = (extra: Partial<SittingView>) =>
  ({ id: 's1', status: 'deliberating', questions: null, plans: [], ...extra }) as SittingView;
const item = { id: 'q1' } as NonNullable<SittingView['questions']>['items'][number];
const none = { batch: null, plan: null };

describe('councilNews (#103)', () => {
  it('tells each new batch of questions once', () => {
    const one = councilNews({
      sitting: sitting({ questions: { batchId: 'b1', items: [item] } }),
      noticed: none,
    });
    expect(one.text).toBe('The council has a question for you.');
    expect(
      councilNews({
        sitting: sitting({ questions: { batchId: 'b1', items: [item] } }),
        noticed: one.noticed,
      }).text,
    ).toBeNull();
    const two = councilNews({
      sitting: sitting({ questions: { batchId: 'b2', items: [item, item] } }),
      noticed: one.noticed,
    });
    expect(two.text).toBe('The council has 2 questions for you.');
  });

  it('tells each plan waiting for approval once', () => {
    const plans = [
      {
        version: 1,
        plan: { summary: 'Email only' } as Plan,
        outcome: { kind: 'proposed' as const },
      },
    ];
    const first = councilNews({
      sitting: sitting({ status: 'awaitingApproval', plans }),
      noticed: none,
    });
    expect(first.text).toBe('The council proposes a plan: Email only');
    expect(
      councilNews({
        sitting: sitting({ status: 'awaitingApproval', plans }),
        noticed: first.noticed,
      }).text,
    ).toBeNull();
    expect(councilNews({ sitting: sitting({ plans }), noticed: none }).text).toBeNull();
  });

  it('tells once that the council waits on the user, with what it last said (#242)', () => {
    const said = [{ id: 'd1', speaker: 'elder', text: 'There is nothing to plan here.' }];
    const first = councilNews({
      sitting: sitting({ waiting: true, dialogue: said }),
      noticed: none,
    });
    expect(first.text).toBe('The council is waiting on you: There is nothing to plan here.');
    expect(
      councilNews({ sitting: sitting({ waiting: true, dialogue: said }), noticed: first.noticed })
        .text,
    ).toBeNull();
    const told = [...said, { id: 'd2', speaker: 'you', text: 'Plan it anyway.' }];
    expect(
      councilNews({ sitting: sitting({ waiting: true, dialogue: told }), noticed: first.noticed })
        .text,
    ).toBe('The council is waiting on you.');
  });

  it('has nothing to tell without a sitting', () => {
    expect(councilNews({ sitting: null, noticed: none })).toEqual({ text: null, noticed: none });
  });
});
