import * as Phaser from 'phaser';
import type { Started } from './boot.types';
import { mountCameraControls } from './camera-controls';
import { GameClient } from './client';
import { mountCommandBar } from './command-bar';
import { CommandHistory } from './command-history';
import { mountHeroPane } from './hero-pane';
import { reportDiagnostics } from './host';
import type { Diagnostics, Host } from './host.types';
import { mountNeedsYouPanel } from './needs-you-panel';
import { mountNewQuestForm } from './new-quest-form';
import { PackScene } from './pack-scene';
import { ViewState } from './view-state';
import { fitViewport } from './viewport';
import { HEIGHT, HERO_SELECTED, RIGHT_INSET, WIDTH, WorldScene } from './world-scene';

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
  if (!hasWebGL(root)) {
    root.innerHTML =
      '<p class="notice">Ibitsa needs WebGL, and it isn’t available here, so the game can’t start. ' +
      'Your agents are not affected.</p>';
    reportDiagnostics(diagnostics);
    return { client, zoom: () => 0, hero: NO_HERO, camera: () => null };
  }

  mountNeedsYouPanel(client);
  const newQuest = mountNewQuestForm({ client, host });
  const view = new ViewState(host.viewStorage);
  // One ↑/↓ history for the bar and the pane's box, kept in view state (#81).
  const history = new CommandHistory({ entries: savedHistory(view) });
  const saveHistory = () => view.set(HISTORY_KEY, JSON.stringify(history.all));
  const heroPane = mountHeroPane({ client, host, view, history, onHistoryChange: saveHistory });
  mountCommandBar({
    client,
    history,
    onHistoryChange: saveHistory,
    startQuest: (description) => newQuest.open({ description }),
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
    scene: [PackScene, WorldScene],
  });
  game.registry.set('assetBase', assetBase);
  game.registry.set('client', client);
  game.registry.set('view', view);
  mountCameraControls(game.events);
  // The camera keeps the followed hero left of the open hero pane.
  new ResizeObserver(() => {
    const rect = heroPane.element.getBoundingClientRect();
    const covered = rect.width > 0 ? Math.max(0, window.innerWidth - rect.left) : 0;
    game.registry.set(RIGHT_INSET, covered);
  }).observe(heroPane.element);
  game.events.on(HERO_SELECTED, () => heroPane.open());

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
  return { client, zoom: () => diagnostics.zoom, hero, camera };
}
