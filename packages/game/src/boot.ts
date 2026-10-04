import * as Phaser from 'phaser';
import { GameClient } from './client';
import { type Diagnostics, type Host, reportDiagnostics } from './host';
import { mountNeedsYouPanel } from './needs-you-panel';
import { PackScene } from './pack-scene';
import { HEIGHT, WIDTH, WorldScene } from './world-scene';

function hasWebGL(root: HTMLElement): boolean {
  if (root.dataset.forceNoWebgl === 'true') return false;
  const canvas = document.createElement('canvas');
  return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
}

/** Starts the game in `root`, talking to the core through `host`. Shared by the webview and standalone builds. */
export interface Started {
  client: GameClient;
  /** Current integer zoom, 0 before the game is ready or without WebGL. */
  zoom(): number;
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
    return { client, zoom: () => 0 };
  }

  mountNeedsYouPanel(client);
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
  return { client, zoom: () => diagnostics.zoom };
}
