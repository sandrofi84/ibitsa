import { describe, expect, it } from 'vitest';
import { MemoryViewStorage, ViewState } from './view-state';

describe('ViewState', () => {
  it('starts from fallbacks and remembers what is set', () => {
    const storage = new MemoryViewStorage();
    const view = new ViewState(storage);
    expect(view.get('heroPaneOpen', true)).toBe(true);
    view.set('heroPaneOpen', false);
    expect(new ViewState(storage).get('heroPaneOpen', true)).toBe(false);
  });

  it('ignores stored values of the wrong type, and storage that is not an object', () => {
    expect(
      new ViewState({ load: () => ({ heroPaneOpen: 'yes' }), save: () => {} }).get(
        'heroPaneOpen',
        true,
      ),
    ).toBe(true);
    expect(new ViewState({ load: () => [1], save: () => {} }).get('x', 3)).toBe(3);
    expect(new ViewState({ load: () => undefined, save: () => {} }).get('x', 'a')).toBe('a');
  });

  it('keeps other keys when one changes', () => {
    const saved: Record<string, unknown>[] = [];
    const view = new ViewState({ load: () => ({ zoom: 2 }), save: (s) => saved.push(s) });
    view.set('heroPaneOpen', true);
    expect(saved).toEqual([{ zoom: 2, heroPaneOpen: true }]);
  });
});
