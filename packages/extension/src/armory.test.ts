import { describe, expect, it, vi } from 'vitest';
import { Armory } from './armory';
import type { SettingLayers } from './guild-settings.types';

function armory(layers: { classes?: SettingLayers; recolor?: SettingLayers } = {}) {
  const update = vi.fn(async () => {});
  return { armory: new Armory({ inspect: (key) => layers[key], update }), update };
}

describe('Armory (#182)', () => {
  it('lists the classes in play with the layer each is set in, the project over you', () => {
    const { armory: a } = armory({
      classes: {
        defaultValue: {},
        globalValue: { rogue: { model: 'sonnet' }, bard: { name: 'Bard' } },
        workspaceValue: { bard: { name: 'Skald', model: 'opus' } },
      },
      recolor: { globalValue: { 'class:ranger': { hue: 120 } } },
    });
    const view = a.view();
    expect(view.classes.map((c) => `${c.id}:${c.name}:${c.model}:${c.layer}`)).toEqual([
      'paladin:Paladin:fable:default',
      'barbarian:Barbarian:opus:default',
      'ranger:Ranger:sonnet:default',
      'rogue:Rogue:sonnet:user',
      'bard:Skald:opus:workspace',
    ]);
    expect(view.recolor).toEqual([
      { target: 'class:ranger', recolor: { hue: 120, preset: 'none' }, layer: 'user' },
    ]);
  });

  it('writes one entry into a layer, keeping the others', async () => {
    const { armory: a, update } = armory({
      classes: { globalValue: { rogue: { model: 'sonnet' } } },
    });
    await a.writeClass({ id: 'bard', value: { name: 'Bard' }, layer: 'user' });
    expect(update).toHaveBeenCalledWith({
      key: 'classes',
      value: { rogue: { model: 'sonnet' }, bard: { name: 'Bard' } },
      layer: 'user',
    });
  });

  it('removes one entry, and the whole setting from a layer once it is empty', async () => {
    const { armory: a, update } = armory({
      classes: { globalValue: { rogue: { model: 'sonnet' }, bard: { name: 'Bard' } } },
      recolor: { workspaceValue: { 'class:ranger': { hue: 120 } } },
    });
    await a.resetClass({ id: 'bard', layer: 'user' });
    await a.resetRecolor({ target: 'class:ranger', layer: 'workspace' });
    await a.writeRecolor({
      target: 'councillor:security',
      recolor: { hue: 0, preset: 'gold' },
      layer: 'workspace',
    });
    expect(update.mock.calls).toEqual([
      [{ key: 'classes', value: { rogue: { model: 'sonnet' } }, layer: 'user' }],
      [{ key: 'recolor', value: undefined, layer: 'workspace' }],
      [
        {
          key: 'recolor',
          value: {
            'class:ranger': { hue: 120 },
            'councillor:security': { hue: 0, preset: 'gold' },
          },
          layer: 'workspace',
        },
      ],
    ]);
  });
});
