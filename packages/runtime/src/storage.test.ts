import { mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CampaignStore } from './storage';

const store = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-store-'));
  return { dir, store: new CampaignStore(dir) };
};

describe('CampaignStore.latestId', () => {
  it('is null with no campaigns', () => {
    expect(store().store.latestId()).toBeNull();
  });

  it('prefers the running campaign', () => {
    const { store: s } = store();
    s.create('old', new Date());
    s.clearActive();
    s.create('running', new Date());
    expect(s.latestId()).toBe('running');
  });

  it('otherwise picks the log that changed last', () => {
    const { dir, store: s } = store();
    s.create('a', new Date());
    s.create('b', new Date());
    s.clearActive();
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(dir, 'campaigns', 'b', 'events.jsonl'), past, past);
    expect(s.latestId()).toBe('a');
  });
});
