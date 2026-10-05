import { describe, expect, it } from 'vitest';
import m0Walk from '../fixtures/m0-walk.jsonl?raw';
import m1Real from '../fixtures/m1-real.jsonl?raw';
import m1RealLive from '../fixtures/m1-real.live.json';
import m1Trouble from '../fixtures/m1-trouble.jsonl?raw';
import { parseLog } from './log';
import { replayThroughCore } from './run';

// Every committed fixture replays through the real core; its protocol output is compared with a golden
// file. A rule change that alters the output fails here until the golden files are updated (vitest -u).
const fixtures = { 'm0-walk': m0Walk, 'm1-trouble': m1Trouble, 'm1-real': m1Real };

describe.each(Object.entries(fixtures))('fixture %s', (name, text) => {
  const output = replayThroughCore(parseLog(text));

  it('matches its golden file', async () => {
    await expect(`${JSON.stringify(output, null, 2)}\n`).toMatchFileSnapshot(
      `../fixtures/${name}.golden.json`,
    );
  });
});

describe('m0-walk', () => {
  const output = replayThroughCore(parseLog(m0Walk));
  const at = (mark: string) => output.marks.find((m) => m.mark === mark)?.snapshot.heroes[0];

  it('walks a hero through every M0 state', () => {
    expect(at('traveling')?.state.kind).toBe('traveling');
    expect(at('arrived')?.activity).toEqual({ kind: 'think' });
    expect(at('waiting-on-you')?.state.kind).toBe('waitingOnYou');
    expect(at('submitted')?.state).toEqual({
      kind: 'submitted',
      summary: 'Logout now clears the stored return URL; added a regression test.',
    });
    expect(output.final.islands[0]?.taskPoints[0]?.state).toBe('doneUnreviewed');
    expect(output.final.campaign?.gold).toEqual({ kind: 'exact', value: 108_000 });
  });

  it('emits the failing and passing test cues and the needs-you cue', () => {
    const cues = output.cues.map((c) => c.cue);
    expect(cues).toContainEqual({
      type: 'activityFinished',
      heroId: 'h4',
      kind: 'test',
      outcome: 'failed',
    });
    expect(cues).toContainEqual({
      type: 'activityFinished',
      heroId: 'h4',
      kind: 'test',
      outcome: 'ok',
    });
    expect(cues).toContainEqual({ type: 'needsYouAdded', itemId: 'n5' });
    expect(cues.some((c) => c.type === 'commandRejected')).toBe(false);
  });
});

describe('m1-trouble', () => {
  const output = replayThroughCore(parseLog(m1Trouble));
  const at = (mark: string) => output.marks.find((m) => m.mark === mark)?.snapshot;

  it('stalls on a test failing 4 times, then runs out of gold, then finishes after a raise', () => {
    expect(at('stalled')?.heroes[0]?.state).toEqual({
      kind: 'stalled',
      reason: 'The same test failed 4 times in a row: pnpm test date',
    });
    expect(at('stalled')?.needsYou.map((i) => i.kind)).toEqual(['stalled']);
    expect(at('out-of-gold')?.heroes[0]?.state).toEqual({ kind: 'outOfGold' });
    expect(at('out-of-gold')?.needsYou).toEqual([
      { kind: 'outOfGold', id: 'n6', heroId: 'h4', cap: 300_000, capEnforcement: 'native' },
    ]);
    expect(at('submitted')?.heroes[0]?.state.kind).toBe('submitted');
    expect(output.final.needsYou).toEqual([]);
    expect(output.cues.some((c) => c.cue.type === 'commandRejected')).toBe(false);
  });
});

describe('m1-real', () => {
  // Recorded from a real quest (#38): see agent-claude-sdk/src/record.test.ts.
  const output = replayThroughCore(parseLog(m1Real));

  it('replays to the same final state as the live run', () => {
    expect(output.final).toEqual(m1RealLive);
  });

  it('ends finished, with the task submitted and nothing waiting', () => {
    expect(output.final.campaign?.status).toBe('finished');
    expect(output.final.islands[0]?.taskPoints[0]?.state).toBe('doneUnreviewed');
    expect(output.cues.some((c) => c.cue.type === 'commandRejected')).toBe(false);
  });
});
