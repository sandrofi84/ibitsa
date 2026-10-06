import { mkdtempSync, readFileSync, truncateSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CampaignStore, LOG_SIZE_CAP } from './storage';

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

describe('CampaignLog past its size cap', () => {
  it('drops activity details from new records, and nothing else', () => {
    const { dir, store: s } = store();
    const log = s.create('big', new Date());
    // A sparse file just over the cap: nothing is actually written.
    truncateSync(log.path, LOG_SIZE_CAP + 1);
    log.append({
      t: 1,
      kind: 'agent',
      heroId: 'h4',
      event: { type: 'activityStarted', toolUseId: 'u1', kind: 'read', detail: 'secret.ts' },
    });
    log.append({ t: 2, kind: 'agent', heroId: 'h4', event: { type: 'message', text: 'kept' } });
    const tail = readFileSync(join(dir, 'campaigns', 'big', 'events.jsonl'), 'utf8')
      .split('\n')
      // The sparse part reads as zero bytes, which precede the first appended line.
      .map((l) => l.replaceAll('\0', ''))
      .filter((l) => l.startsWith('{'))
      .slice(-2)
      .map((l) => JSON.parse(l));
    expect(tail[0].event).toEqual({ type: 'activityStarted', toolUseId: 'u1', kind: 'read' });
    expect(tail[1].event).toEqual({ type: 'message', text: 'kept' });
  });
});
