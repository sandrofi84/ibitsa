import * as Phaser from 'phaser';

export const WIDTH = 480;
export const HEIGHT = 270;
const TILE = 16;

/** Engine-check scene: a tiled 480×270 field whose edges show that nothing is cropped. */
export class PlaceholderScene extends Phaser.Scene {
  private label?: Phaser.GameObjects.Text;

  constructor() {
    super('placeholder');
  }

  create(): void {
    const g = this.add.graphics();
    for (let y = 0; y < HEIGHT; y += TILE) {
      for (let x = 0; x < WIDTH; x += TILE) {
        g.fillStyle((x + y) % (TILE * 2) === 0 ? 0x2b5f9e : 0x336db0);
        g.fillRect(x, y, TILE, TILE);
      }
    }
    g.lineStyle(1, 0xf2c230);
    g.strokeRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1);
    g.fillStyle(0x5dab3c);
    g.fillRect(TILE * 11, TILE * 6, TILE * 8, TILE * 4);

    this.label = this.add.text(TILE, TILE, '', {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#ffffff',
    });
    this.updateLabel();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.updateLabel());
  }

  updateLabel(): void {
    this.label?.setText(`IBITSA ENGINE CHECK  ${WIDTH}x${HEIGHT}  zoom x${this.scale.zoom}`);
  }
}
