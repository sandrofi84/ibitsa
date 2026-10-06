import type { Manifest } from '@ibitsa/assets';
import * as Phaser from 'phaser';
import { councilTexture } from './council-look';
import { HUT_FEED } from './hut-view';

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
      if (c.council)
        this.load.spritesheet(councilTexture(key), this.url(c.council.sheet), {
          frameWidth: c.council.frame.width,
          frameHeight: c.council.frame.height,
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
    const ai = manifest.activityIcons;
    this.load.spritesheet('activityIcons', this.url(ai.image), {
      frameWidth: ai.size,
      frameHeight: ai.size,
    });
    for (const [key, b] of Object.entries(manifest.buildings))
      this.load.image(`building:${key}`, this.url(b.image));

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.defineFrames(manifest);
      // The hut when one was asked for before the pack loaded (`Started.showHut`), else the map.
      this.scene.start(this.registry.has(HUT_FEED) ? 'hut' : 'world');
    });
    this.load.start();
  }

  /** One looping animation per row of a sheet, keyed `<texture>:<animation>`. */
  private defineAnimations({
    texture,
    frameWidth,
    animations,
  }: {
    texture: string;
    frameWidth: number;
    animations: Record<string, { row: number; frames: number; fps: number }>;
  }): void {
    const columns = this.textures.get(texture).getSourceImage().width / frameWidth;
    for (const [name, a] of Object.entries(animations)) {
      this.anims.create({
        key: `${texture}:${name}`,
        frames: this.anims.generateFrameNumbers(texture, {
          start: a.row * columns,
          end: a.row * columns + a.frames - 1,
        }),
        frameRate: a.fps,
        repeat: -1,
      });
    }
  }

  private defineFrames(manifest: Manifest): void {
    for (const [key, c] of Object.entries(manifest.characters)) {
      this.defineAnimations({ texture: key, frameWidth: c.frame.width, animations: c.animations });
      if (c.council)
        this.defineAnimations({
          texture: councilTexture(key),
          frameWidth: c.council.frame.width,
          animations: c.council.animations,
        });
    }
    const i = manifest.island;
    const island = this.textures.get('island');
    island.add('left', 0, 0, 0, i.leftCap, i.height);
    island.add('middle', 0, i.leftCap, 0, i.middle, i.height);
    island.add('right', 0, i.leftCap + i.middle, 0, i.rightCap, i.height);
  }
}
