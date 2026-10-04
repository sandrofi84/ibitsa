import * as Phaser from 'phaser';
import { type Diagnostics, reportDiagnostics } from './host';
import { HEIGHT, PlaceholderScene, WIDTH } from './placeholder-scene';

const root = document.getElementById('game');
if (!root) throw new Error('missing #game element');

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
    `${e.violatedDirective} ${e.blockedURI} from ${e.sourceFile || '?'}:${e.lineNumber} sample=${e.sample}`,
  );
  reportDiagnostics(diagnostics);
});

function hasWebGL(): boolean {
  if (root?.dataset.forceNoWebgl === 'true') return false;
  const canvas = document.createElement('canvas');
  return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
}

if (!hasWebGL()) {
  root.innerHTML =
    '<p class="notice">Ibitsa needs WebGL, and it isn’t available here, so the game can’t start. ' +
    'Your agents are not affected.</p>';
  reportDiagnostics(diagnostics);
} else {
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
    scene: [PlaceholderScene],
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
    // Scale.NONE does not recompute MAX_ZOOM by itself when the panel changes size.
    new ResizeObserver(() => {
      game.scale.setMaxZoom();
      report();
    }).observe(root);
  });
}
