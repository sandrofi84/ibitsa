// Standalone development entry (spec §13): the real core plus an agent-fake replay, in the browser.
import '../game.css';
import { parseLog, type ReplayOptions } from '@ibitsa/agent-fake';
import m0Walk from '@ibitsa/agent-fake/fixtures/m0-walk.jsonl?raw';
import { startGame } from '../boot';
import { DevHost } from './dev-host';
import { mountOverlay } from './overlay';

const fixtures: Record<string, string> = { 'm0-walk': m0Walk };

const params = new URLSearchParams(location.search);
const name = params.get('fixture') ?? 'm0-walk';
const text = fixtures[name] ?? m0Walk;
const speedParam = params.get('speed');
const options: Partial<ReplayOptions> = {
  ...(speedParam ? { speed: speedParam === 'instant' ? 'instant' : Number(speedParam) } : {}),
  ...(params.get('gap') === 'off' ? { gapCapMs: null } : {}),
  ...(params.get('loop') === '1' ? { loop: true } : {}),
  ...(params.get('mode') === 'interactive' ? { mode: 'interactive' } : {}),
};

const host = new DevHost(parseLog(text), options);
const root = document.getElementById('game');
if (!root) throw new Error('missing #game element');
const { client, zoom } = startGame(root, host);
mountOverlay(host, Object.keys(fixtures), name);

// Read by the Playwright tests.
const w = window as unknown as { __ibitsa?: unknown };
w.__ibitsa = {
  snapshot: () => client.snapshot,
  status: () => host.replay.status,
  zoom,
};

client.onSnapshot(() => {
  if (
    params.get('autoplay') === '1' &&
    !host.replay.status.playing &&
    host.replay.status.position === 0
  ) {
    host.replay.play();
  }
});
