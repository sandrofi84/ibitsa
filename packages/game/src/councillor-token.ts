import type * as Phaser from 'phaser';
import type { CouncillorTokenOptions, ReviewerProbe } from './councillor-token.types';
import type { Point } from './layout.types';
import { marker } from './map-markers';
import { addPixelText, type PixelText } from './pixel-text';
import { availablePose } from './poses';
import type { MapPose } from './poses.types';
import type { PlateBox, ReviewerView } from './reviewers.types';

/** A councillor's walk between the hut and a task point; a little quicker than a hero's. */
const WALK_MS = 2_400;
/** How long a councillor stays by the hero once the review is over, before walking home. */
export const LINGER_MS = 1_500;
const PARCHMENT = 0xf3ead2;
/** A plate's offset under its token. */
const PLATE_Y = 2;

/**
 * A reviewing councillor on the map (§7.2, #140): a square token with a parchment border and a name
 * plate, no HP bar. It walks from the council hut to the task point, holds a magnifier while its review
 * runs, then shows a red badge with its blocking findings when it asks for changes (nothing for a pass)
 * or a grey "?" when the review failed, and walks back once the phase is over.
 */
export class CouncillorToken {
  private readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly plate: PixelText;
  private readonly magnifier: Phaser.GameObjects.Sprite | Phaser.GameObjects.Graphics;
  private readonly badge: PixelText;
  private readonly scene: Phaser.Scene;
  private readonly character: string;
  private readonly path: Point[];
  private readonly still: boolean;
  private view: ReviewerView;
  private walk: Phaser.Tweens.Tween | null = null;
  private linger: Phaser.Time.TimerEvent | null = null;
  private readonly gone: () => void;
  private leaving = false;
  private playing: MapPose = 'idle';

  constructor(options: CouncillorTokenOptions) {
    const { scene, layer, view, character, title, side, path, still, gone } = options;
    this.scene = scene;
    this.gone = gone;
    this.character = character;
    this.path = path;
    this.still = still;
    this.view = view;
    const base = scene.add.graphics();
    base.fillStyle(0x1a1420, 0.45).fillRect(-9, -17, 18, 18);
    base.lineStyle(1, PARCHMENT).strokeRect(-9, -17, 18, 18);
    this.sprite = scene.add.sprite(0, 0, character).setOrigin(0.5, 1);
    // Under the token, reaching away from the hero so it never covers it.
    const plate = addPixelText(scene, {
      x: -9 * side,
      y: PLATE_Y,
      text: title.slice(0, 9),
      color: '#1a1420',
      background: '#f3ead2',
    }).setOrigin(side === 1 ? 0 : 1, 0);
    this.plate = plate;
    // The magnifier, badge or "?" on the token's outer top corner.
    const corner = { x: 8 * side, y: -16 };
    this.magnifier = marker({ scene, kind: 'magnifier', at: corner });
    this.badge = addPixelText(scene, { x: corner.x, y: corner.y, text: '', color: '#ffffff' })
      .setOrigin(0.5)
      .setVisible(false);
    const start = (still ? path.at(-1) : path[0]) ?? { x: 0, y: 0 };
    this.container = scene.add.container(start.x, start.y, [
      base,
      this.sprite,
      plate,
      this.magnifier,
      this.badge,
    ]);
    layer.add(this.container);
    if (still) this.play('idle');
    else this.walkAlong({ path, arrive: () => this.arrived() });
    this.show(view);
  }

  /** The review moved on: a verdict came in, the review failed, or the phase is over. */
  update(view: ReviewerView): void {
    this.view = view;
    this.show(view);
    if (view.leaving) this.leave();
  }

  /**
   * Walks back to the hut after a short stay, then is gone: once the phase is over, or when its review
   * is no longer on the map. Waits for the walk out to finish first.
   */
  leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    if (!this.walk) this.goHome();
  }

  probe(): ReviewerProbe {
    return {
      key: this.view.key,
      councillorId: this.view.councillorId,
      character: this.character,
      taskPointId: this.view.taskPointId,
      x: this.container.x,
      y: this.container.y,
      walking: this.walk !== null,
      magnifier: this.magnifier.visible,
      badge: this.badge.visible && this.view.status === 'done' ? this.view.findings : null,
      failed: this.badge.visible && this.view.status === 'failed',
      leaving: this.leaving,
      pose: this.playing,
      plate: this.plateBox({ stacked: true }),
    };
  }

  /** Its name plate's box on the map: in its own place, or where it's drawn now (#234). */
  plateBox({ stacked }: { stacked: boolean }): PlateBox {
    const width = this.plate.width;
    const left = this.plate.x - (this.plate.origin.x === 1 ? width : 0);
    const y = stacked ? this.plate.y : PLATE_Y;
    return {
      x: this.container.x + left,
      y: this.container.y + y,
      width,
      height: this.plate.height,
    };
  }

  /** Moves its name plate down from its own place, to clear the others' (#234). */
  stackPlate(dy: number): void {
    this.plate.setY(PLATE_Y + dy);
  }

  destroy(): void {
    this.walk?.stop();
    this.linger?.remove();
    this.container.destroy();
  }

  private show(view: ReviewerView): void {
    this.magnifier.setVisible(view.status === 'running');
    if (!this.walk) this.play(this.standing());
    if (view.status === 'failed') {
      this.badge.setText(' ? ').setBackgroundColor('#8a8a8a').setVisible(true);
    } else if (view.status === 'done' && view.findings > 0) {
      this.badge.setText(` ${view.findings} `).setBackgroundColor('#e8483a').setVisible(true);
    } else {
      this.badge.setVisible(false);
    }
  }

  private arrived(): void {
    this.play(this.standing());
    if (this.leaving) this.goHome();
  }

  private goHome(): void {
    this.linger = this.scene.time.delayedCall(LINGER_MS, () => {
      this.linger = null;
      if (this.still) return this.finish();
      const back = [...this.path].reverse();
      this.walkAlong({ path: back, arrive: () => this.finish() });
    });
  }

  private finish(): void {
    this.destroy();
    this.gone();
  }

  /** Peering at the work while its review runs (#222), else standing by. */
  private standing(): MapPose {
    return this.view.status === 'running' ? 'review' : 'idle';
  }

  /** Plays a pose, or the nearest one its sheet has (§9.2). */
  private play(pose: MapPose): void {
    const has = (p: MapPose) => this.scene.anims.exists(`${this.character}:${p}`);
    const shown = availablePose({ pose, has }) ?? 'idle';
    this.playing = shown;
    const key = `${this.character}:${shown}`;
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key);
  }

  /** Walks the path at an even pace, facing the way it goes. */
  private walkAlong({ path, arrive }: { path: Point[]; arrive: () => void }): void {
    const lengths = path
      .slice(1)
      .map((p, i) => Math.hypot(p.x - (path[i] as Point).x, p.y - (path[i] as Point).y));
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    this.play('walk');
    this.walk = this.scene.tweens.addCounter({
      from: 0,
      to: total,
      duration: WALK_MS,
      onUpdate: (tween) => {
        let d = tween.getValue() ?? 0;
        for (let k = 0; k < lengths.length; k++) {
          const len = lengths[k] as number;
          const a = path[k] as Point;
          const b = path[k + 1] as Point;
          if (d <= len || k === lengths.length - 1) {
            const f = len === 0 ? 1 : Math.min(1, d / len);
            this.container.setPosition(
              Math.round(a.x + (b.x - a.x) * f),
              Math.round(a.y + (b.y - a.y) * f),
            );
            this.sprite.setFlipX(b.x < a.x);
            return;
          }
          d -= len;
        }
      },
      onComplete: () => {
        this.walk = null;
        this.sprite.setFlipX(false);
        arrive();
      },
    });
  }
}
