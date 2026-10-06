// Standalone development entry (spec §13): the real core plus an agent-fake replay, in the browser.
import '../game.css';
import { parseLog, type ReplayOptions } from '@ibitsa/agent-fake';
import m0Walk from '@ibitsa/agent-fake/fixtures/m0-walk.jsonl?raw';
import m1Demo from '@ibitsa/agent-fake/fixtures/m1-demo.jsonl?raw';
import m1Real from '@ibitsa/agent-fake/fixtures/m1-real.jsonl?raw';
import m1Trouble from '@ibitsa/agent-fake/fixtures/m1-trouble.jsonl?raw';
import { startGame } from '../boot';
import { DevHost } from './dev-host';
import { LiveDevHost } from './live-dev-host';
import { mountOverlay } from './overlay';

const fixtures: Record<string, string> = {
  'm0-walk': m0Walk,
  'm1-trouble': m1Trouble,
  'm1-real': m1Real,
  'm1-demo': m1Demo,
};

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

const root = document.getElementById('game');
if (!root) throw new Error('missing #game element');
// Read by the Playwright tests.
const w = window as unknown as { __ibitsa?: unknown };

if (name === 'live') {
  // The real core and a scripted fake runtime, for playing the UI end to end (#37).
  const host = new LiveDevHost({
    credentialsReady: params.get('credentials') !== 'none',
    sandboxed: params.get('sandbox') !== 'none',
    repo:
      params.get('repo') === 'none'
        ? null
        : { defaultBranch: 'main', branches: ['main', 'feature/x'], uncommittedChanges: 2 },
  });
  const { client, zoom, hero, camera } = startGame(root, host);
  w.__ibitsa = {
    snapshot: () => client.snapshot,
    hostRequests: () => host.channel.requests,
    zoom,
    hero,
    camera,
  };
} else {
  const host = new DevHost(parseLog(text), options);
  const { client, zoom, hero, camera } = startGame(root, host);
  mountOverlay({ host, fixtures: [...Object.keys(fixtures), 'live'], current: name });
  w.__ibitsa = {
    snapshot: () => client.snapshot,
    status: () => host.replay.status,
    zoom,
    hero,
    camera,
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
}
