import { describe, expect, it, vi } from 'vitest';
import { councilPose } from '../hut-view';
import { ScriptedSitting } from './dev-sitting';

describe('ScriptedSitting', () => {
  it('starts convened, studies in separate chambers, and reaches dispatch', () => {
    const sitting = new ScriptedSitting('chambers');
    expect(sitting.view.councillors).toHaveLength(6);
    expect(sitting.view.stage).toBe('study');

    const seen: string[] = [];
    const off = sitting.onChange((v) => seen.push(v.stage));
    while (sitting.advance()) {
      // play it through
    }
    off();
    expect(seen).toContain('study');
    expect(sitting.view).toMatchObject({
      stage: 'dialogue',
      step: 'dispatch',
      decisions: 2,
      speaker: null,
    });
    expect(sitting.advance()).toBe(false);
  });

  it('a round table never studies', () => {
    const sitting = new ScriptedSitting('roundTable');
    const stages = new Set<string>([sitting.view.stage]);
    sitting.onChange((v) => stages.add(v.stage));
    while (sitting.advance()) {
      // play it through
    }
    expect([...stages]).toEqual(['dialogue']);
  });

  it('gives the floor to a councillor who raised a hand', () => {
    const sitting = new ScriptedSitting('roundTable');
    const listener = vi.fn();
    sitting.onChange(listener);
    let raised = false;
    while (sitting.advance()) {
      if (councilPose(sitting.view, 'security') === 'raiseHand') raised = true;
      if (sitting.view.speaker === 'security') break;
    }
    expect(raised).toBe(true);
    expect(councilPose(sitting.view, 'security')).toBe('talk');
    expect(listener).toHaveBeenCalled();
  });
});
