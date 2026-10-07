import type { Manifest } from '@ibitsa/assets';
import type * as Phaser from 'phaser';
import type { Point } from './layout.types';
import type { MarkerKind } from './map-markers.types';
import { MARKERS_KEY, PACK_KEY } from './pack-scene';

/**
 * A map marker centred on `at`: a blocked hero's padlock, a stacked island that's behind (#124), a
 * reviewer's magnifier or a hero under review (#140). The pack's when its marker strip has it, else a
 * small drawn one, so a pack without markers (or without the review ones) still shows them.
 */
export function marker({
  scene,
  kind,
  at,
}: {
  scene: Phaser.Scene;
  kind: MarkerKind;
  at: Point;
}): Phaser.GameObjects.Sprite | Phaser.GameObjects.Graphics {
  const manifest = scene.cache.json.get(PACK_KEY) as Manifest | undefined;
  const frame = manifest?.markers?.kinds.indexOf(kind) ?? -1;
  if (frame >= 0 && scene.textures.exists(MARKERS_KEY)) {
    return scene.add.sprite(at.x, at.y, MARKERS_KEY, frame);
  }
  const g = scene.add.graphics({ x: at.x - 4, y: at.y - 4 });
  switch (kind) {
    case 'padlock':
      g.lineStyle(1, 0x1a1420).strokeRect(2, 0, 4, 4);
      g.fillStyle(0xf2c230).fillRect(0, 3, 8, 6);
      break;
    case 'behind':
      g.fillStyle(0xf28a30).fillTriangle(0, 4, 4, 0, 4, 8).fillTriangle(4, 4, 8, 0, 8, 8);
      break;
    case 'magnifier':
      g.lineStyle(1, 0x1a1420).fillStyle(0x9fd4f2).fillCircle(3, 3, 3).strokeCircle(3, 3, 3);
      g.lineStyle(2, 0x8a5a2a).lineBetween(5, 5, 8, 8);
      break;
    case 'hourglass':
      g.fillStyle(0xe8c87a).fillTriangle(0, 0, 8, 0, 4, 4).fillTriangle(0, 8, 8, 8, 4, 4);
      g.lineStyle(1, 0x1a1420).strokeRect(0, 0, 8, 8);
      break;
  }
  return g;
}
