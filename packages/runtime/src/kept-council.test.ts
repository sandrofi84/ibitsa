import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KeptCouncil } from './kept-council';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-kept-'));
  dirs.push(dir);
  return dir;
}

describe('KeptCouncil (#167)', () => {
  it('keeps a session id for the next campaign, which takes it once', () => {
    const dir = temp();
    const kept = new KeptCouncil(dir);
    expect(kept.peek()).toBeNull();
    kept.keep({ sessionId: 'council-1', from: 'Sign-in' });
    expect(new KeptCouncil(dir).peek()).toBe('council-1');
    expect(kept.take()).toBe('council-1');
    expect(kept.take()).toBeNull();
  });

  it('forgets on Empty, and ignores a file it cannot read', () => {
    const dir = temp();
    const kept = new KeptCouncil(dir);
    kept.keep({ sessionId: 'council-1', from: 'Sign-in' });
    kept.forget();
    expect(kept.peek()).toBeNull();
    writeFileSync(join(dir, 'council.json'), 'not json');
    expect(kept.peek()).toBeNull();
    writeFileSync(join(dir, 'council.json'), '{"sessionId":3}');
    expect(kept.peek()).toBeNull();
  });
});
