import type { HeroView, NeedsYouItem, Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { HeroSelection } from './hero-selection';
import { MemoryViewStorage, ViewState } from './view-state';

const hero = (id: string, kind: HeroView['state']['kind'] = 'idle') =>
  ({ id, name: id, state: { kind } }) as HeroView;
const snapshot = (heroes: HeroView[], needsYou: Pick<NeedsYouItem, 'heroId'>[] = []) =>
  ({ heroes, needsYou }) as Snapshot;

describe('HeroSelection (#125)', () => {
  it('defaults to the first hero that needs you, else the first working, else the first', () => {
    const selection = new HeroSelection(new ViewState(new MemoryViewStorage()));
    const heroes = [hero('a'), hero('b', 'working'), hero('c')];
    expect(selection.selected(snapshot(heroes, [{ heroId: 'c' }]))?.id).toBe('c');
    expect(selection.selected(snapshot(heroes))?.id).toBe('b');
    expect(selection.selected(snapshot([hero('a'), hero('c')]))?.id).toBe('a');
    expect(selection.selected(snapshot([]))).toBeNull();
    expect(selection.selected(null)).toBeNull();
  });

  it('settles on the default once, then stays put as states change, and tells its listeners', () => {
    const selection = new HeroSelection(new ViewState(new MemoryViewStorage()));
    const heard: string[] = [];
    selection.onSelect((id) => heard.push(id));
    selection.update(snapshot([hero('a'), hero('b', 'working')]));
    expect(heard).toEqual(['b']);
    // b stops working and a starts: the selection doesn't jump.
    selection.update(snapshot([hero('a', 'working'), hero('b')]));
    expect(selection.selected(snapshot([hero('a', 'working'), hero('b')]))?.id).toBe('b');
    selection.select('a');
    selection.select('a');
    expect(heard).toEqual(['b', 'a']);
    selection.update(snapshot([]));
    expect(heard).toEqual(['b', 'a']);
  });

  it('keeps the choice in view state, and drops one from an earlier campaign', () => {
    const storage = new MemoryViewStorage();
    new HeroSelection(new ViewState(storage)).select('b');
    const again = new HeroSelection(new ViewState(storage));
    expect(again.selected(snapshot([hero('a'), hero('b')]))?.id).toBe('b');
    const heard: string[] = [];
    again.onSelect((id) => heard.push(id));
    again.update(snapshot([hero('x'), hero('y')]));
    expect(heard).toEqual(['x']);
  });
});
