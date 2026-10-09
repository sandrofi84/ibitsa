import { describe, expect, it } from 'vitest';
import { gameClosed } from './game-closed';
import type { ClosedChoice, ClosingHost } from './game-closed.types';

function fakeHost({ live, working }: { live: boolean; working: number }) {
  const calls: string[] = [];
  const host: ClosingHost = {
    campaignLive: () => live,
    pauseHeroes: async () => {
      calls.push('pause');
      return working;
    },
    dispose: () => {
      calls.push('dispose');
    },
  };
  return { host, calls };
}

async function close({
  live,
  working = 0,
  answer = null,
}: {
  live: boolean;
  working?: number;
  answer?: ClosedChoice | null;
}) {
  const { host, calls } = fakeHost({ live, working });
  const told: string[] = [];
  let asked = 0;
  const choice = await gameClosed({
    host,
    ask: async () => {
      asked++;
      return answer;
    },
    tell: (text) => told.push(text),
  });
  return { choice, calls, told, asked };
}

describe('closing the game tab (#265)', () => {
  it('shuts Ibitsa down without asking when no campaign is running', async () => {
    const r = await close({ live: false });
    expect(r).toEqual({ choice: 'stop', calls: ['dispose'], told: [], asked: 0 });
  });

  it('does nothing without a workspace (no runtime host)', async () => {
    let asked = false;
    const choice = await gameClosed({
      host: null,
      ask: async () => {
        asked = true;
        return 'stop';
      },
      tell: () => {},
    });
    expect(choice).toBeNull();
    expect(asked).toBe(false);
  });

  it('keeps everything running when asked to', async () => {
    const r = await close({ live: true, working: 2, answer: 'keep' });
    expect(r).toEqual({ choice: 'keep', calls: [], told: [], asked: 1 });
  });

  it('keeps running when the question is dismissed, so nothing is lost', async () => {
    const r = await close({ live: true, working: 2, answer: null });
    expect(r.choice).toBe('keep');
    expect(r.calls).toEqual([]);
  });

  it('pauses the working heroes and keeps the runtime for the council and reviews', async () => {
    const r = await close({ live: true, working: 2, answer: 'pause' });
    expect(r.calls).toEqual(['pause']);
    expect(r.told).toEqual(['Paused 2 heroes: they wait for orders in the game.']);
  });

  it('says so when pausing finds no hero at work', async () => {
    const one = await close({ live: true, working: 1, answer: 'pause' });
    expect(one.told).toEqual(['Paused 1 hero: they wait for orders in the game.']);
    const none = await close({ live: true, working: 0, answer: 'pause' });
    expect(none.told).toEqual(['No hero was working. The council and reviews carry on.']);
  });

  it('stops the heroes first, so a reopened game does not resume their turns, then shuts down', async () => {
    const r = await close({ live: true, working: 1, answer: 'stop' });
    expect(r.calls).toEqual(['pause', 'dispose']);
    expect(r.told).toEqual(['Ibitsa stopped. Open the game to pick the campaign up again.']);
  });
});
