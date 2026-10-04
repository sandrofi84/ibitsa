import { describe, expect, it } from 'vitest';
import m0Walk from '../fixtures/m0-walk.jsonl?raw';
import { parseLog } from './log';
import { replayThroughCore } from './run';

// Every committed fixture replays through the real core; its protocol output is compared with a golden
// file. A rule change that alters the output fails here until the golden files are updated (vitest -u).
const fixtures = { 'm0-walk': m0Walk };

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
