import { describe, expect, it } from 'vitest';
import { packSource, packStatus } from './guild-packs';

describe('the Packs tab (#183, #235)', () => {
  it('lists errors before warnings, each with its word', () => {
    expect(
      packStatus({ errors: ['characters: missing "hero.ranger"'], warnings: ['tiles: x'] }),
    ).toEqual({
      usable: false,
      notes: [
        { kind: 'error', label: 'Error', text: 'characters: missing "hero.ranger"' },
        { kind: 'warning', label: 'Warning', text: 'tiles: x' },
      ],
    });
  });

  it('lets a pack with only warnings be used, and one with an error not', () => {
    expect(packStatus({ errors: [], warnings: ['tiles: grass is no longer used'] }).usable).toBe(
      true,
    );
    expect(packStatus({ errors: ['pack.json: missing'], warnings: [] }).usable).toBe(false);
    expect(packStatus({ errors: [], warnings: [] })).toEqual({ usable: true, notes: [] });
  });

  it('says where a pack comes from', () => {
    expect(['builtin', 'user', 'project'].map((s) => packSource(s as 'builtin'))).toEqual([
      'built in',
      'yours',
      'this project',
    ]);
  });
});
