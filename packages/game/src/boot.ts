import type { Manifest } from '@ibitsa/assets';
import type { SittingView, Snapshot } from '@ibitsa/protocol';
import * as Phaser from 'phaser';
import { mountAmendmentReview } from './amendment-review';
import type { Started } from './boot.types';
import { mountCameraControls } from './camera-controls';
import { mountCampaignEnd } from './campaign-end';
import { GameClient } from './client';
import { mountCommandBar } from './command-bar';
import { CommandHistory } from './command-history';
import { mountConveneForm } from './convene-form';
import { consultedSitting, mountCouncilChamber } from './council-chamber';
import { mountCouncilDialogue } from './council-dialogue-box';
import { mountCouncilPane, mountCouncilWord } from './council-pane';
import { elderHut } from './elder-hut';
import { mountElderPanel } from './elder-panel';
import { mountGuildHall } from './guild-hall';
import { mountHeroPane } from './hero-pane';
import { HeroSelection } from './hero-selection';
import { setHeroClasses } from './heroes';
import { reportDiagnostics } from './host';
import type { Diagnostics, Host } from './host.types';
import { HutDoor } from './hut-door';
import { mountHutExit } from './hut-exit';
import { HutScene } from './hut-scene';
import { HUT_FEED, HUT_SEATED } from './hut-view';
import type { HutFeed } from './hut-view.types';
import { mountNeedsYouPanel } from './needs-you-panel';
import { mountNewActionForm } from './new-action-form';
import { mountNewQuestForm } from './new-quest-form';
import { PACK_BASE, PACK_KEY, PACK_KEYS, PackScene } from './pack-scene';
import { mountNewParty, mountPartyAssembly } from './party-assembly';
import { mountPartyCheck } from './party-check';
import { mountPlanReview } from './plan-review';
import {
  mountPullRequestHover,
  mountPullRequestPanel,
  mountPullRequestPreview,
} from './pull-request-card';
import { setRecolor } from './recolor';
import { mountRestartNotice } from './restart-notice';
import { isSitting, packLook, rememberCouncillors, SittingFeed } from './sitting-hut';
import { mountSoundBoard } from './sound-board';
import { mountTaskPanel } from './task-panel';
import { ViewState } from './view-state';
import { fitViewport } from './viewport';
import {
  GUILD_HALL_SELECTED,
  HEIGHT,
  HERO_SELECTED,
  HUT_SELECTED,
  PULL_REQUEST_HOVERED,
  PULL_REQUEST_SELECTED,
  RIGHT_INSET,
  TASK_SELECTED,
  WIDTH,
  WorldScene,
} from './world-scene';

function hasWebGL(root: HTMLElement): boolean {
  if (root.dataset.forceNoWebgl === 'true') return false;
  const canvas = document.createElement('canvas');
  return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
}

const HISTORY_KEY = 'commandHistory';

/** The bar's saved history; anything unreadable is no history. */
function savedHistory(view: ViewState): string[] {
  try {
    const parsed: unknown = JSON.parse(view.get(HISTORY_KEY, '[]'));
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

const NO_HERO: Started['hero'] = {
  onPage: () => null,
  speech: () => null,
  speechWidth: () => null,
  icon: () => null,
};

export function startGame(root: HTMLElement, host: Host): Started {
  const assetBase = root.dataset.assetBase ?? './';
  const cspViolations: string[] = [];
  let diagnostics: Diagnostics = {
    type: 'diagnostics',
    ready: false,
    renderer: 'none',
    zoom: 0,
    canvas: null,
    cspViolations,
  };
  document.addEventListener('securitypolicyviolation', (e) => {
    cspViolations.push(
      `${e.violatedDirective} ${e.blockedURI} from ${e.sourceFile || '?'}:${e.lineNumber}`,
    );
    reportDiagnostics(diagnostics);
  });

  const client = new GameClient(host);
  // First, so every panel's titles and portraits follow this snapshot's councillors (#103).
  client.onSnapshot((snapshot) => rememberCouncillors(snapshot.councillors));
  // The classes in play (#182), for every class list and the heroes' looks.
  client.onSnapshot((snapshot) => {
    setHeroClasses(snapshot.classes);
    setRecolor(snapshot.recolor);
  });
  if (!hasWebGL(root)) {
    root.innerHTML =
      '<p class="notice">Ibitsa needs WebGL, and it isn’t available here, so the game can’t start. ' +
      'Your agents are not affected.</p>';
    reportDiagnostics(diagnostics);
    return {
      client,
      zoom: () => 0,
      hero: NO_HERO,
      camera: () => null,
      showHut: () => {},
      hut: () => null,
      selectHero: () => {},
      taskOnPage: () => null,
      taskPanel: () => null,
      pullRequestOnPage: () => null,
      hutOnPage: () => null,
      councilChamber: () => false,
      guildHallOnPage: () => null,
      guildHall: () => null,
      packLoads: () => 0,
      sounds: () => [],
      soundsLoaded: () => [],
      pullRequestPanel: () => null,
      pullRequestPreview: () => null,
      map: () => null,
      selection: null,
    };
  }

  // The council's questions (#102): the box tells the hut whose question is up, so they take the floor.
  const sittingFeed = new SittingFeed();
  let focus: string | null = null;
  let sitting: SittingView | null = null;
  const portraits: { url: (appearance: string) => string | null } = { url: () => null };
  const councilDialogue = mountCouncilDialogue({
    client,
    portrait: (appearance) => portraits.url(appearance),
    onFocus: (questionId) => {
      focus = questionId;
      if (sitting) sittingFeed.update({ sitting, focus });
    },
    // Put away, nobody has the floor until it's opened again.
    onAway: () => {
      focus = null;
      if (sitting) sittingFeed.update({ sitting, focus });
    },
  });
  // Whether the hut shows, and for what (#244, #245); followed once the game is up.
  const door = new HutDoor();
  let placeHut: (snapshot: Snapshot | null) => void = () => {};
  /** Into the hut: the elder's welcome with no campaign planning, else back to the work (#244, #245). */
  let enterHut: (prefill?: { description: string }) => void = () => {};
  const view = new ViewState(host.viewStorage);
  // Which hero the pane shows and the bar speaks to (#125); the map follows it too.
  const selection = new HeroSelection(view);
  client.onSnapshot((snapshot) => selection.update(snapshot));
  // A task's checks and reviews (#141): from the map, the hero pane and Needs you.
  // An island's PR (#153): the preview before opening, its card from the badge, and the badge's hover.
  const pullRequests = { client, preview: mountPullRequestPreview({ client }) };
  const prPanel = mountPullRequestPanel(pullRequests);
  const prHover = mountPullRequestHover({ client });
  const taskPanel = mountTaskPanel({ client, pullRequests });
  // Changes to the approved plan (#170): the council's amendment, and the party of an island it adds.
  const amendmentReview = mountAmendmentReview({ client });
  // The party check of ACP agents (#199), shared by every panel that sends heroes out.
  const partyCheck = mountPartyCheck({ host });
  const newParty = mountNewParty({ client, partyCheck });
  mountNeedsYouPanel({
    client,
    // Answered in the hut: back in first, if the user had left it (#245).
    openCouncil: () => {
      enterHut();
      return councilDialogue.focus();
    },
    // The council waiting on the user (#242): the command bar talks to it while it sits.
    replyToCouncil: () => {
      enterHut();
      commandBar.focus();
    },
    selectHero: (heroId) => selection.select(heroId),
    openTask: (taskPointId) => taskPanel.open(taskPointId),
    reviewAmendment: () => amendmentReview.focus(),
    assembleParty: (islandId) => newParty.open(islandId),
  });
  mountRestartNotice({ client });
  const newQuest = mountNewQuestForm({
    client,
    host,
    partyCheck,
    portrait: (appearance) => portraits.url(appearance),
    onCancel: () => {
      door.endWelcome();
      placeHut(client.snapshot);
    },
  });
  const newActionForm = mountNewActionForm({ client });
  const newAction = () => newActionForm.open();
  const conveneForm = mountConveneForm({ client, view });
  const partyAssembly = mountPartyAssembly({
    client,
    options: { withCredentials: (then) => newQuest.withCredentials(then), partyCheck },
  });
  mountPlanReview({ client });
  mountCampaignEnd({ client });
  mountElderPanel({
    client,
    options: {
      quickQuest: (task) => newQuest.quickQuest(task),
      assemble: (plan) => partyAssembly.open(plan),
      convene: () => conveneForm.open(),
    },
  });
  // One ↑/↓ history for the bar and the pane's box, kept in view state (#81).
  const history = new CommandHistory({ entries: savedHistory(view) });
  const saveHistory = () => view.set(HISTORY_KEY, JSON.stringify(history.all));
  const heroPane = mountHeroPane({
    client,
    host,
    view,
    history,
    onHistoryChange: saveHistory,
    newAction,
    selection,
    openTask: (taskPointId) => taskPanel.open(taskPointId),
  });
  const commandBar = mountCommandBar({
    client,
    history,
    onHistoryChange: saveHistory,
    // The task written in, the elder hears it in the hut (#244).
    startQuest: (description) => enterHut({ description }),
    newAction,
    selection,
  });
  // While the council sits (#242): its latest word over the bar, and its pane with the journal and Dismiss.
  mountCouncilWord({ client, portrait: (a) => portraits.url(a), into: commandBar.element });
  mountCouncilPane({ client, portrait: (a) => portraits.url(a) });
  // The Command Palette's Message Hero… and Run Action… (#87).
  host.onHostEvent((event) => {
    // "Ibitsa: New Quest" walks into the hut, like clicking it (#244).
    if (event.type === 'openNewQuest') enterHut();
    if (event.type === 'focusCommandBar') commandBar.focus();
    if (event.type === 'fillCommandBar') commandBar.fill(event.text);
  });
  const panel = () => ({ width: root.clientWidth || WIDTH, height: root.clientHeight || HEIGHT });
  const initial = fitViewport({ panel: panel(), world: { width: WIDTH, height: HEIGHT } });
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: root,
    width: initial.width,
    height: initial.height,
    pixelArt: true,
    backgroundColor: '#000000',
    banner: false,
    scale: {
      mode: Phaser.Scale.NONE,
      zoom: initial.zoom,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    images: {
      default: `${assetBase}textures/default.png`,
      missing: `${assetBase}textures/missing.png`,
      white: `${assetBase}textures/white.png`,
    },
    loader: { imageLoadType: 'HTMLImageElement' },
    scene: [PackScene, WorldScene, HutScene],
  });
  game.registry.set('assetBase', assetBase);
  // The active pack's files (#183): a user's or project's pack, else the bundled default.
  game.registry.set(PACK_BASE, root.dataset.packBase ?? `${assetBase}pack/`);
  game.registry.set('client', client);
  game.registry.set('view', view);
  const cameraControls = mountCameraControls(game.events);
  // The camera keeps the followed hero left of the open hero pane.
  new ResizeObserver(() => {
    const rect = heroPane.element.getBoundingClientRect();
    const covered = rect.width > 0 ? Math.max(0, window.innerWidth - rect.left) : 0;
    game.registry.set(RIGHT_INSET, covered);
  }).observe(heroPane.element);
  game.events.on(TASK_SELECTED, (taskPointId: string) => {
    prPanel.close();
    taskPanel.open(taskPointId);
  });
  // The PR card and the task panel take the same place: one at a time.
  game.events.on(PULL_REQUEST_SELECTED, (islandId: string) => {
    prHover.hide();
    taskPanel.close();
    prPanel.open(islandId);
  });
  game.events.on(PULL_REQUEST_HOVERED, (at: { islandId: string; x: number; y: number } | null) => {
    if (!at) {
      prHover.hide();
      return;
    }
    const rect = game.canvas.getBoundingClientRect();
    prHover.show({
      islandId: at.islandId,
      x: rect.left + at.x * game.scale.zoom,
      y: rect.top + at.y * game.scale.zoom,
    });
  });
  game.events.on(HERO_SELECTED, (heroId: string) => {
    selection.select(heroId);
    heroPane.open();
  });

  const report = () => {
    diagnostics = {
      ...diagnostics,
      ready: true,
      renderer: game.renderer.type === Phaser.WEBGL ? 'webgl' : 'none',
      zoom: game.scale.zoom,
      canvas: {
        width: game.canvas.width * game.scale.zoom,
        height: game.canvas.height * game.scale.zoom,
      },
    };
    reportDiagnostics(diagnostics);
  };
  game.events.once(Phaser.Core.Events.READY, () => {
    report();
    // Fill the panel at a whole-number zoom whenever it changes size (#59).
    new ResizeObserver(() => {
      const v = fitViewport({ panel: panel(), world: { width: WIDTH, height: HEIGHT } });
      // Resize first: setZoom recomputes the on-screen size from the current game size.
      game.scale.resize(v.width, v.height);
      game.scale.setZoom(v.zoom);
      report();
    }).observe(root);
    client.start();
  });
  const world = () => game.scene.getScene('world') as WorldScene | null;
  const token = () => world()?.firstHero() ?? null;
  const hero: Started['hero'] = {
    onPage: () => {
      const t = token();
      const scene = world();
      if (!t || !scene) return null;
      const at = scene.toCanvas(t.position());
      const rect = game.canvas.getBoundingClientRect();
      return { x: rect.left + at.x * game.scale.zoom, y: rect.top + at.y * game.scale.zoom };
    },
    speech: () => token()?.speaking() ?? null,
    speechWidth: () => token()?.speechWidth(world()?.cameras.main.zoom ?? 1) ?? null,
    icon: () => token()?.showingIcon() ?? null,
  };
  const camera = () => (world()?.sys.isActive() ? (world()?.cameraState() ?? null) : null);
  portraits.url = (appearance) => {
    const manifest = game.cache.json.get(PACK_KEY) as Manifest | undefined;
    const has = (key: string) => manifest?.characters[key] !== undefined;
    // A councillor the pack has no look for wears the default's face (#220).
    const key = appearance.startsWith('councillor.') ? packLook({ appearance, has }) : appearance;
    const path = manifest?.characters[key]?.portrait;
    return path ? `${game.registry.get(PACK_BASE) as string}${path}` : null;
  };
  const showHut = (feed: HutFeed) => {
    game.registry.set(HUT_FEED, feed);
    // The map's camera buttons and the command bar have nothing to do in the hut.
    cameraControls.style.display = 'none';
    document.body.classList.add('in-hut');
    const scenes = game.scene;
    // Before the pack has loaded, the pack scene starts the hut itself.
    const loaded = scenes.isActive('world') || scenes.isSleeping('world') || scenes.isActive('hut');
    if (scenes.isActive('world')) scenes.sleep('world');
    // A hut already showing goes on with the new feed: the elder stays seated as the council joins it.
    if (loaded && !scenes.isActive('hut')) scenes.start('hut');
  };
  /**
   * A pack chosen in the Guild Hall (#183): the old pack's art goes and the new one loads, then the map
   * (or the hut) starts again from the snapshot. Nothing else is lost.
   */
  const switchPack = (base: string | null) => {
    game.registry.set(PACK_BASE, base ?? `${assetBase}pack/`);
    const scenes = game.scene;
    for (const key of ['world', 'hut']) {
      if (scenes.isActive(key) || scenes.isSleeping(key)) scenes.stop(key);
    }
    const keys = game.registry.get(PACK_KEYS) as
      | { textures: string[]; anims: string[]; sounds: string[] }
      | undefined;
    for (const k of keys?.anims ?? []) game.anims.remove(k);
    for (const k of keys?.textures ?? []) game.textures.remove(k);
    for (const k of keys?.sounds ?? []) {
      game.sound.removeByKey(k);
      game.cache.audio.remove(k);
    }
    game.cache.json.remove(PACK_KEY);
    scenes.start('pack');
  };
  host.onHostEvent((event) => {
    if (event.type === 'packChanged') switchPack(event.base);
  });
  /** Back to the map once the sitting is over. */
  const hideHut = () => {
    game.registry.remove(HUT_FEED);
    cameraControls.style.display = '';
    document.body.classList.remove('in-hut');
    const scenes = game.scene;
    const wasShowing = scenes.isActive('hut');
    if (wasShowing) scenes.stop('hut');
    if (scenes.isSleeping('world')) scenes.wake('world');
    // A hut shown before the pack loaded started instead of the map.
    else if (wasShowing && !scenes.isActive('world')) scenes.start('world');
  };
  // Mid-campaign the hut opens the council's chamber (#169): the council's lines and a box to ask.
  let chamberHut = false;
  const chamberFeed = () => {
    const consulted = consultedSitting(client.snapshot);
    if (consulted) sittingFeed.update({ sitting: consulted, focus: null });
  };
  const chamber = mountCouncilChamber({
    client,
    portrait: (appearance) => portraits.url(appearance),
    onOpen: () => {
      chamberHut = true;
      chamberFeed();
      showHut(sittingFeed);
    },
    onClose: () => {
      chamberHut = false;
      hideHut();
    },
  });
  client.onSnapshot(() => {
    if (chamberHut) chamberFeed();
  });
  // The council hut (§7.1 screen 9, #180): with no campaign running, the elder's welcome (#244);
  // mid-campaign, its chamber (#169); while a campaign plans, back in to the elder or the sitting (#245).
  game.events.on(HUT_SELECTED, () => {
    if (client.snapshot?.campaign?.status === 'active') chamber.open();
    else enterHut();
  });
  // The pack's sounds on what happens, at the user's volumes (#184).
  const soundBoard = mountSoundBoard({ game, client, host });
  // The Guild Hall in Home Village opens Ibitsa's settings (#179).
  const guildHall = mountGuildHall({ client, host, partyCheck });
  game.events.on(GUILD_HALL_SELECTED, () => guildHall.open());
  // The hut shows while a campaign plans: the elder alone, then the council while it sits (§7.1 screen
  // 2, #244). The map comes back after, or when the user leaves by the hut's door (#245).
  let doorHut = false;
  /** The welcome's form opens once the elder has walked in (#244), with the task if one was written. */
  let welcomeTask: { prefill?: { description: string } } | null = null;
  placeHut = (snapshot) => {
    if (chamberHut) return;
    const place = door.see(snapshot);
    if (place === 'sitting' && sitting) sittingFeed.update({ sitting, focus });
    else if (place === 'elder') sittingFeed.show(elderHut(snapshot));
    if (place) {
      if (!doorHut) {
        doorHut = true;
        showHut(sittingFeed);
      }
      return;
    }
    welcomeTask = null;
    if (doorHut) {
      doorHut = false;
      hideHut();
    }
  };
  game.events.on(HUT_SEATED, () => {
    const task = welcomeTask;
    if (!task || door.see(client.snapshot) !== 'elder') return;
    welcomeTask = null;
    newQuest.open(task.prefill);
  });
  client.onSnapshot((snapshot) => {
    sitting = isSitting(snapshot.sitting) ? snapshot.sitting : null;
    // The command bar talks to the council while it sits (#242).
    document.body.classList.toggle('council-sitting', sitting !== null);
    placeHut(snapshot);
  });
  enterHut = (prefill) => {
    door.enter();
    const planning = client.snapshot?.campaign?.status === 'planning';
    welcomeTask = planning ? null : prefill ? { prefill } : {};
    placeHut(client.snapshot);
  };
  mountHutExit(() => {
    if (chamber.shown()) {
      chamber.close();
      return;
    }
    door.leave(client.snapshot);
    placeHut(client.snapshot);
  });
  const hutScene = () => game.scene.getScene('hut') as HutScene | null;
  const hut = () => (hutScene()?.sys.isActive() ? (hutScene()?.rendered() ?? null) : null);
  // The scene keeps a selection made before the map is up and uses it from its first snapshot.
  const selectHero = (heroId: string | null) => world()?.selectHero(heroId);
  // Choosing a hero in the pane, on the map or in "Needs you" (#125) points the map camera at it (#124).
  selection.onSelect((heroId) => selectHero(heroId));
  const map = () => world()?.mapProbe() ?? null;
  const taskOnPage = (taskPointId: string) => {
    const scene = world();
    const spot = scene?.taskSpot(taskPointId);
    if (!scene || !spot) return null;
    const at = scene.toCanvas(spot);
    const rect = game.canvas.getBoundingClientRect();
    return { x: rect.left + at.x * game.scale.zoom, y: rect.top + at.y * game.scale.zoom };
  };
  const hutOnPage = () => {
    const scene = world();
    if (!scene?.sys.isActive()) return null;
    const at = scene.toCanvas(scene.hutSpot());
    const rect = game.canvas.getBoundingClientRect();
    return { x: rect.left + at.x * game.scale.zoom, y: rect.top + at.y * game.scale.zoom };
  };
  const guildHallOnPage = () => {
    const scene = world();
    if (!scene?.sys.isActive()) return null;
    const at = scene.toCanvas(scene.guildHallSpot());
    const rect = game.canvas.getBoundingClientRect();
    return { x: rect.left + at.x * game.scale.zoom, y: rect.top + at.y * game.scale.zoom };
  };
  const pullRequestOnPage = (islandId: string) => {
    const scene = world();
    const spot = scene?.pullRequestSpot(islandId);
    if (!scene || !spot) return null;
    const at = scene.toCanvas(spot);
    const rect = game.canvas.getBoundingClientRect();
    return { x: rect.left + at.x * game.scale.zoom, y: rect.top + at.y * game.scale.zoom };
  };
  return {
    client,
    zoom: () => diagnostics.zoom,
    hero,
    camera,
    showHut,
    hut,
    selectHero,
    map,
    selection,
    taskOnPage,
    taskPanel: () => taskPanel.shown(),
    pullRequestOnPage,
    hutOnPage,
    councilChamber: () => chamber.shown(),
    guildHallOnPage,
    guildHall: () => guildHall.shown(),
    packLoads: () => (game.registry.get('packLoads') as number | undefined) ?? 0,
    sounds: () => soundBoard.played(),
    soundsLoaded: () => game.cache.audio.getKeys(),
    pullRequestPanel: () => prPanel.shown(),
    pullRequestPreview: () => pullRequests.preview.shown(),
  };
}
