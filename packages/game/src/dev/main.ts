// Standalone development entry (spec §13): the real core plus an agent-fake replay, in the browser.
import '../game.css';
import { parseLog, type ReplayOptions } from '@ibitsa/agent-fake';
import m0Walk from '@ibitsa/agent-fake/fixtures/m0-walk.jsonl?raw';
import m1Demo from '@ibitsa/agent-fake/fixtures/m1-demo.jsonl?raw';
import m1Real from '@ibitsa/agent-fake/fixtures/m1-real.jsonl?raw';
import m1Trouble from '@ibitsa/agent-fake/fixtures/m1-trouble.jsonl?raw';
import m3RoundTable from '@ibitsa/agent-fake/fixtures/m3-round-table.jsonl?raw';
import { startGame } from '../boot';
import { DevHost } from './dev-host';
import { ScriptedSitting } from './dev-sitting';
import { LiveDevHost } from './live-dev-host';
import { mountOverlay } from './overlay';

const fixtures: Record<string, string> = {
  'm0-walk': m0Walk,
  'm1-trouble': m1Trouble,
  'm1-real': m1Real,
  'm1-demo': m1Demo,
  'm3-round-table': m3RoundTable,
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
    ...(params.get('campaignCap') ? { campaignBudgetUsd: Number(params.get('campaignCap')) } : {}),
  });
  const { client, zoom, hero, camera, hut, selectHero, map } = startGame(root, host);
  w.__ibitsa = {
    snapshot: () => client.snapshot,
    // Lets a test act for a hero the UI can't select yet.
    send: (intent: Parameters<typeof client.send>[0]) => client.send(intent),
    hostRequests: () => host.channel.requests,
    hostEvent: (event: Parameters<typeof host.channel.send>[0]) => host.channel.send(event),
    zoom,
    hero,
    camera,
    hut,
    selectHero,
    map,
  };
  // `&campaign=separate|stacked`: straight into a three-island campaign, to see the map (#124).
  const campaign = params.get('campaign');
  if (campaign === 'separate' || campaign === 'stacked') host.demoCampaign(campaign);
} else if (params.get('scene') === 'hut') {
  // The council hut from a scripted sitting (#99): every animation, without a replay. The real sitting
  // shows the hut by itself, e.g. `?fixture=m3-round-table` (#102).
  const host = new DevHost(parseLog(text), options);
  const { client, zoom, showHut, hut } = startGame(root, host);
  const sitting = new ScriptedSitting(
    params.get('mode') === 'chambers' ? 'chambers' : 'roundTable',
  );
  showHut(sitting);
  w.__ibitsa = {
    snapshot: () => client.snapshot,
    zoom,
    hut,
    sitting: { advance: () => sitting.advance(), view: () => sitting.view },
  };
  if (params.get('autoplay') === '1') {
    const timer = setInterval(
      () => {
        if (!sitting.advance()) clearInterval(timer);
      },
      1500 / Number(speedParam ?? 1),
    );
  }
} else {
  const host = new DevHost(parseLog(text), options);
  const { client, zoom, hero, camera, hut } = startGame(root, host);
  mountOverlay({ host, fixtures: [...Object.keys(fixtures), 'live'], current: name });
  w.__ibitsa = {
    snapshot: () => client.snapshot,
    status: () => host.replay.status,
    zoom,
    hero,
    camera,
    hut,
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
