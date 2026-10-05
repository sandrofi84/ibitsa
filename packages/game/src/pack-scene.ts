import type { Manifest } from '@ibitsa/assets';
import * as Phaser from 'phaser';

export const PACK_KEY = 'pack';

/** Loads the art pack described by its engine-neutral manifest (spec §9.3), then starts the world. */
export class PackScene extends Phaser.Scene {
  constructor() {
    super('pack');
  }

  private url(path: string): string {
    return `${this.registry.get('assetBase') as string}pack/${path}`;
  }

  preload(): void {
    this.load.json(PACK_KEY, this.url('pack.json'));
  }

  create(): void {
    const manifest = this.cache.json.get(PACK_KEY) as Manifest;
    for (const [key, c] of Object.entries(manifest.characters)) {
      this.load.spritesheet(key, this.url(c.sheet), {
        frameWidth: c.frame.width,
        frameHeight: c.frame.height,
      });
    }
    const t = manifest.tiles;
    this.load.spritesheet('tiles', this.url(t.image), {
      frameWidth: t.tileSize,
      frameHeight: t.tileSize,
    });
    this.load.image('island', this.url(manifest.island.image));
    const tp = manifest.taskPoints;
    this.load.spritesheet('taskPoints', this.url(tp.image), {
      frameWidth: tp.size,
      frameHeight: tp.size,
    });
    for (const [key, b] of Object.entries(manifest.buildings))
      this.load.image(`building:${key}`, this.url(b.image));

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.defineFrames(manifest);
      this.scene.start('world');
    });
    this.load.start();
  }

  private defineFrames(manifest: Manifest): void {
    for (const [key, c] of Object.entries(manifest.characters)) {
      const columns = this.textures.get(key).getSourceImage().width / c.frame.width;
      for (const [name, a] of Object.entries(c.animations)) {
        this.anims.create({
          key: `${key}:${name}`,
          frames: this.anims.generateFrameNumbers(key, {
            start: a.row * columns,
            end: a.row * columns + a.frames - 1,
          }),
          frameRate: a.fps,
          repeat: -1,
        });
      }
    }
    const i = manifest.island;
    const island = this.textures.get('island');
    island.add('left', 0, 0, 0, i.leftCap, i.height);
    island.add('middle', 0, i.leftCap, 0, i.middle, i.height);
    island.add('right', 0, i.leftCap + i.middle, 0, i.rightCap, i.height);
  }
}
