// Standalone development entry (spec §13): the real core plus an agent-fake replay, in the browser.
import '../game.css';
import { parseLog, type ReplayOptions } from '@ibitsa/agent-fake';
import m0Walk from '@ibitsa/agent-fake/fixtures/m0-walk.jsonl?raw';
import m1Demo from '@ibitsa/agent-fake/fixtures/m1-demo.jsonl?raw';
import m1Real from '@ibitsa/agent-fake/fixtures/m1-real.jsonl?raw';
import m1Trouble from '@ibitsa/agent-fake/fixtures/m1-trouble.jsonl?raw';
import m3RoundTable from '@ibitsa/agent-fake/fixtures/m3-round-table.jsonl?raw';
import type { GitHostView } from '@ibitsa/protocol';
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
    // Dev only (#125): `heroes=2` starts a campaign with that many heroes on their own islands.
    heroes: Number(params.get('heroes') ?? 0),
    repo:
      params.get('repo') === 'none'
        ? null
        : { defaultBranch: 'main', branches: ['main', 'feature/x'], uncommittedChanges: 2 },
    ...(params.get('campaignCap') ? { campaignBudgetUsd: Number(params.get('campaignCap')) } : {}),
    // Dev only (#140): `review=demo` turns reviews on, with paced scripted checks and verdicts.
    ...(params.get('review') === 'demo' ? { review: 'demo' as const } : {}),
    // `reviews=1`: submitted tasks are checked and reviewed by scripted councillors (#141).
    reviews: params.get('reviews') === '1',
    // `pr=demo` (#153): the fake GitHub polls every few seconds, unless `prPoll=off` (tests use Refresh).
    // `gitHost=noOrigin|gitlab|signedOut` (#162): what the git host allows, as the runtime reports it.
    ...gitHostParam(params.get('gitHost')),
    pullRequestPollMs:
      (params.get('pr') === 'demo' || params.get('pr') === 'stacked') &&
      params.get('prPoll') !== 'off'
        ? 4_000
        : null,
  });
  const started = startGame(root, host);
  const { client, zoom, hero, camera, hut, selectHero, map, selection, taskOnPage, taskPanel } =
    started;
  w.__ibitsa = {
    snapshot: () => client.snapshot,
    // Lets a test act for a hero the UI can't select yet.
    send: (intent: Parameters<typeof client.send>[0]) => client.send(intent),
    hostRequests: () => host.channel.requests,
    // The commands the game sent (#139).
    sent: () => host.sent,
    hostEvent: (event: Parameters<typeof host.channel.send>[0]) => host.channel.send(event),
    zoom,
    hero,
    camera,
    hut,
    selectHero,
    map,
    // The selected hero's id (#125).
    selected: () => selection?.selected(client.snapshot)?.id ?? null,
    taskOnPage,
    taskPanel,
    // An island's PR badge, card and preview (#153).
    pullRequestOnPage: started.pullRequestOnPage,
    pullRequestPanel: started.pullRequestPanel,
    pullRequestPreview: started.pullRequestPreview,
  };
  // `&campaign=separate|stacked`: straight into a three-island campaign, to see the map (#124).
  const campaign = params.get('campaign');
  if (campaign === 'separate' || campaign === 'stacked') host.demoCampaign(campaign);
  // `&pr=demo`: a one-island campaign to play a PR from draft to merged, and on to Ibitsa (#153).
  if (params.get('pr') === 'demo') host.pullRequestDemo();
  // `&pr=stacked`: two stacked islands, to merge the first PR and restack the second (#154).
  if (params.get('pr') === 'stacked') host.pullRequestDemo('stacked');
  // `&reviewScript=pass|stubborn|revisit|dispute|failing|broken`: straight into a reviewed task (#141).
  const reviewScript = params.get('reviewScript');
  if (reviewScript) host.scriptedReviews(reviewScript);
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

/** Dev only (#162): the git host states the runtime can report, by name. */
function gitHostParam(name: string | null): { gitHost?: GitHostView } {
  const noOrigin = 'The repository has no origin remote.';
  const states: Record<string, GitHostView> = {
    noOrigin: { push: noOrigin, pullRequests: noOrigin, signedIn: false },
    gitlab: {
      push: null,
      pullRequests: "Pull requests need a GitHub remote, and origin isn't on github.com.",
      signedIn: false,
    },
    signedOut: { push: null, pullRequests: null, signedIn: false },
  };
  const state = name ? states[name] : undefined;
  return state ? { gitHost: state } : {};
}
