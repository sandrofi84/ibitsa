import * as Phaser from 'phaser';
import type { Started } from './boot.types';
import { GameClient } from './client';
import { mountHeroPane } from './hero-pane';
import { reportDiagnostics } from './host';
import type { Diagnostics, Host } from './host.types';
import { mountNeedsYouPanel } from './needs-you-panel';
import { mountNewQuestForm } from './new-quest-form';
import { PackScene } from './pack-scene';
import { ViewState } from './view-state';
import { HEIGHT, HERO_SELECTED, WIDTH, WorldScene } from './world-scene';

function hasWebGL(root: HTMLElement): boolean {
  if (root.dataset.forceNoWebgl === 'true') return false;
  const canvas = document.createElement('canvas');
  return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
}

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
    return { client, zoom: () => 0, heroOnPage: () => null, heroSpeech: () => null };
  }

  mountNeedsYouPanel(client);
  mountNewQuestForm({ client, host });
  const heroPane = mountHeroPane({ client, host, view: new ViewState(host.viewStorage) });
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: root,
    width: WIDTH,
    height: HEIGHT,
    pixelArt: true,
    backgroundColor: '#000000',
    banner: false,
    scale: {
      mode: Phaser.Scale.NONE,
      zoom: Phaser.Scale.MAX_ZOOM,
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
    // Scale.NONE does not recompute MAX_ZOOM by itself when the panel changes size.
    new ResizeObserver(() => {
      game.scale.setMaxZoom();
      report();
    }).observe(root);
    client.start();
  });
  const heroOnPage = () => {
    const scene = game.scene.getScene('world') as WorldScene | null;
    const at = scene?.heroPosition();
    if (!at) return null;
    const rect = game.canvas.getBoundingClientRect();
    const zoom = game.scale.zoom;
    return { x: rect.left + at.x * zoom, y: rect.top + at.y * zoom };
  };
  const heroSpeech = () =>
    (game.scene.getScene('world') as WorldScene | null)?.heroSpeech() ?? null;
  return { client, zoom: () => diagnostics.zoom, heroOnPage, heroSpeech };
}
