import { describe, expect, it } from 'vitest';
import { systemClock } from './system-clock';

describe('systemClock', () => {
  it('tells the time, and runs or cancels a timer', async () => {
    const before = Date.now();
    expect(systemClock.now()).toBeGreaterThanOrEqual(before);
    const ran: string[] = [];
    systemClock.setTimeout(() => ran.push('kept'), 5);
    const cancelled = systemClock.setTimeout(() => ran.push('cancelled'), 5);
    systemClock.clearTimeout(cancelled);
    await new Promise((r) => setTimeout(r, 30));
    expect(ran).toEqual(['kept']);
  });
});
