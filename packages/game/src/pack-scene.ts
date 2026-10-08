import type { Manifest } from '@ibitsa/assets';
import * as Phaser from 'phaser';
import { councilTexture } from './council-look';
import { HUT_FEED } from './hut-view';

export const PACK_KEY = 'pack';
/** Texture keys of the pack's optional drawbridge and map markers (#124). */
export const BRIDGE_KEY = 'bridge';
export const MARKERS_KEY = 'markers';
/** Registry: where the active pack's files are (#183), ending in `/`. */
export const PACK_BASE = 'packBase';
/** Registry: the texture and animation keys the pack loaded, so a switch can drop them (#183). */
export const PACK_KEYS = 'packKeys';
/** Texture keys of the pack's optional hut room and table (#219); the hut draws its own without. */
export const SCENE_KEYS = { hutInterior: 'scene:hutInterior', hutTable: 'scene:hutTable' } as const;

/** Loads the art pack described by its engine-neutral manifest (spec §9.3), then starts the world. */
export class PackScene extends Phaser.Scene {
  constructor() {
    super('pack');
  }

  private url(path: string): string {
    return `${this.registry.get(PACK_BASE) as string}${path}`;
  }

  /** What was there before this pack, so the keys it adds can be told apart. */
  private before: { textures: Set<string>; anims: Set<string> } = {
    textures: new Set(),
    anims: new Set(),
  };

  preload(): void {
    this.before = {
      textures: new Set(this.textures.getTextureKeys()),
      anims: new Set(this.anims.toJSON().anims.map((a) => a.key)),
    };
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
    // Optional pieces (#124): without them the world scene draws its own planks and markers.
    if (manifest.bridge) this.load.image(BRIDGE_KEY, this.url(manifest.bridge.image));
    if (manifest.markers)
      this.load.spritesheet(MARKERS_KEY, this.url(manifest.markers.image), {
        frameWidth: manifest.markers.size,
        frameHeight: manifest.markers.size,
      });

    for (const [slot, file] of Object.entries(manifest.scenes ?? {}))
      if (file) this.load.image(SCENE_KEYS[slot as keyof typeof SCENE_KEYS], this.url(file));

    // Sounds (§9.4, #184): a pack may leave any slot silent.
    for (const [slot, sound] of Object.entries(manifest.sounds ?? {}))
      this.load.audio(`sound:${slot}`, this.url(sound.file));

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.defineFrames(manifest);
      this.registry.set(
        'packLoads',
        ((this.registry.get('packLoads') as number | undefined) ?? 0) + 1,
      );
      this.registry.set(PACK_KEYS, {
        textures: this.textures.getTextureKeys().filter((k) => !this.before.textures.has(k)),
        anims: this.anims
          .toJSON()
          .anims.map((a) => a.key)
          .filter((k) => !this.before.anims.has(k)),
        sounds: Object.keys(manifest.sounds ?? {}).map((slot) => `sound:${slot}`),
      });
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
    const b = manifest.bridge;
    if (b) {
      const bridge = this.textures.get(BRIDGE_KEY);
      b.frames.forEach((frame, row) => {
        const y = row * b.height;
        bridge.add(`${frame}:left`, 0, 0, y, b.end, b.height);
        bridge.add(`${frame}:segment`, 0, b.end, y, b.segment, b.height);
        bridge.add(`${frame}:right`, 0, b.end + b.segment, y, b.end, b.height);
      });
    }
  }
}
