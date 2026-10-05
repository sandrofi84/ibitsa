import type { Manifest } from '@ibitsa/assets';
import type { Cue, HeroView, Reading, Snapshot, TaskPointState } from '@ibitsa/protocol';
import * as Phaser from 'phaser';
import type { GameClient } from './client';
import { heroSpot, layoutWorld, pathTo } from './layout';
import type { Point, WorldLayout } from './layout.types';
import { PACK_KEY } from './pack-scene';

export const WIDTH = 480;
export const HEIGHT = 270;
const TRAVEL_MS = 3_000;
const CATCH_UP_MS = 1_000;

const TASK_FRAME: Record<TaskPointState, number> = {
  locked: 0,
  active: 1,
  underReview: 3,
  done: 2,
  doneUnreviewed: 2,
};

const textStyle = (color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: 'monospace',
  fontSize: '8px',
  color,
});

/** The world map (spec §7.2), drawn only from snapshots. */
export class WorldScene extends Phaser.Scene {
  private manifest!: Manifest;
  private layout: WorldLayout = layoutWorld(null);
  private water!: Phaser.GameObjects.TileSprite;
  private questLayer!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Text;
  private empty!: Phaser.GameObjects.Text;
  private readonly heroes = new Map<string, HeroToken>();
  private islandKey = '';

  constructor() {
    super('world');
  }

  /** Where the first hero's sprite is, in canvas pixels (for tests and probes). */
  heroPosition(): { x: number; y: number } | null {
    const token = this.heroes.values().next().value;
    return token ? token.position() : null;
  }

  create(): void {
    this.manifest = this.cache.json.get(PACK_KEY) as Manifest;
    const waterIndex = this.manifest.tiles.tiles.water?.index ?? 0;
    this.water = this.add.tileSprite(0, 0, WIDTH, HEIGHT, 'tiles', waterIndex).setOrigin(0);
    let waterFrame = 0;
    this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => {
        waterFrame = (waterFrame + 1) % (this.manifest.tiles.tiles.water?.frames ?? 1);
        this.water.setFrame(waterIndex + waterFrame);
      },
    });

    const v = this.layout.village;
    this.drawIsland(this.add.container(0, 0), v);
    this.add.image(v.hut.x, v.hut.y, 'building:hut').setOrigin(0);
    this.add.text(v.x + 22, v.y + 70, 'HOME VILLAGE', textStyle());

    this.questLayer = this.add.container(0, 0);
    this.hud = this.add.text(6, 4, '', textStyle()).setDepth(10);
    this.empty = this.add
      .text(330, 120, 'No quest yet', textStyle('#d8ecff'))
      .setOrigin(0.5)
      .setDepth(10);

    const client = this.registry.get('client') as GameClient;
    client.onSnapshot((s) => this.render(s));
    client.onCue((c) => this.cue(c));
  }

  private drawIsland(
    into: Phaser.GameObjects.Container,
    { x, y, middles }: { x: number; y: number; middles: number },
  ): void {
    const i = this.manifest.island;
    into.add(this.add.image(x, y, 'island', 'left').setOrigin(0));
    for (let m = 0; m < middles; m++) {
      into.add(this.add.image(x + i.leftCap + m * i.middle, y, 'island', 'middle').setOrigin(0));
    }
    into.add(this.add.image(x + i.leftCap + middles * i.middle, y, 'island', 'right').setOrigin(0));
  }

  private dots(into: Phaser.GameObjects.Container, points: Point[]): void {
    const g = this.add.graphics();
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k] as Point;
      const b = points[k + 1] as Point;
      const steps = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 5);
      for (let s = 1; s < steps; s++) {
        const x = Math.round(a.x + ((b.x - a.x) * s) / steps);
        const y = Math.round(a.y + ((b.y - a.y) * s) / steps);
        g.fillStyle(0x1f4a7c).fillRect(x, y + 1, 2, 2);
        g.fillStyle(0xf3ead2).fillRect(x, y, 2, 2);
      }
    }
    into.add(g);
  }

  render(snapshot: Snapshot): void {
    this.layout = layoutWorld(snapshot);
    this.empty.setVisible(snapshot.campaign === null);
    this.hud.setText(
      snapshot.campaign
        ? `${snapshot.campaign.title.toUpperCase()}   GOLD ${gold(snapshot.campaign.gold)}`
        : '',
    );

    // Islands and task points are cheap to rebuild; heroes persist so their movement continues.
    const key = JSON.stringify(snapshot.islands);
    if (key !== this.islandKey) {
      this.islandKey = key;
      this.questLayer.removeAll(true);
      snapshot.islands.forEach((island, k) => {
        const l = this.layout.islands[k];
        if (!l) return;
        this.drawIsland(this.questLayer, l);
        this.questLayer.add(
          this.add.text(l.x + 8, l.y + 70, island.name.toUpperCase().slice(0, 28), textStyle()),
        );
        const first = island.taskPoints[0];
        if (first) this.dots(this.questLayer, pathTo(this.layout, first.id));
        island.taskPoints.forEach((tp, i) => {
          const p = l.taskPoints[i];
          if (!p) return;
          const next = l.taskPoints[i + 1];
          if (next)
            this.dots(this.questLayer, [
              { x: p.x + 16, y: p.y + 8 },
              { x: next.x, y: next.y + 8 },
            ]);
          this.questLayer.add(
            this.add.sprite(p.x, p.y, 'taskPoints', TASK_FRAME[tp.state]).setOrigin(0),
          );
          if (tp.state === 'doneUnreviewed') {
            // done, but no councillor has reviewed it yet (M1): a small marker, not colour alone
            this.questLayer.add(this.add.rectangle(p.x + 12, p.y + 1, 3, 3, 0xffffff).setOrigin(0));
          }
        });
      });
    }

    const seen = new Set<string>();
    for (const hero of snapshot.heroes) {
      seen.add(hero.id);
      let token = this.heroes.get(hero.id);
      if (!token) {
        token = new HeroToken({
          scene: this,
          hero,
          character: this.characterKey(hero.classId),
          layout: this.layout,
        });
        this.heroes.set(hero.id, token);
      }
      token.update(hero, this.layout);
    }
    for (const [id, token] of this.heroes) {
      if (!seen.has(id)) {
        token.destroy();
        this.heroes.delete(id);
      }
    }
  }

  private characterKey(classId: string): string {
    const key = `hero.${classId}`;
    return this.manifest.characters[key] ? key : 'hero.ranger';
  }

  private cue(cue: Cue): void {
    if (cue.type === 'activityFinished') this.heroes.get(cue.heroId)?.flash(cue.outcome);
    if (cue.type === 'retrying') this.heroes.get(cue.heroId)?.flash('failed');
  }
}

function gold(reading: Reading<number>): string {
  if (reading.kind === 'unknown') return '?';
  const g = Math.round(reading.value / 10_000); // 1 gold = 1 cent
  return reading.kind === 'estimated' ? `~${g}` : String(g);
}

/** Emitted on `game.events` with the hero's id when the hero is clicked on the map (#61). */
export const HERO_SELECTED = 'heroSelected';

/** A hero on the map: round token base, sprite, HP bar and status bubble (spec §7.2). */
class HeroToken {
  private readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly bubble: Phaser.GameObjects.Text;
  private travel: Phaser.Tweens.Tween | null = null;
  private traveled = false;
  private state: HeroView['state']['kind'] = 'traveling';

  private readonly scene: Phaser.Scene;
  private readonly character: string;

  constructor({
    scene,
    hero,
    character,
    layout,
  }: {
    scene: Phaser.Scene;
    hero: HeroView;
    character: string;
    layout: WorldLayout;
  }) {
    this.scene = scene;
    this.character = character;
    const start =
      hero.state.kind === 'traveling'
        ? pathTo(layout, hero.taskPointId)[0]
        : heroSpot(layout, hero.taskPointId);
    const base = scene.add.graphics();
    base.fillStyle(0x000000, 0.35).fillEllipse(0, 0, 12, 4);
    base.lineStyle(1, 0xf3ead2).strokeEllipse(0, 0, 12, 4);
    this.sprite = scene.add.sprite(0, 1, character).setOrigin(0.5, 1);
    this.sprite
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => scene.game.events.emit(HERO_SELECTED, hero.id));
    this.hpBar = scene.add.graphics();
    this.bubble = scene.add
      .text(0, -26, '', { ...textStyle('#1a1420'), backgroundColor: '#f2c230' })
      .setOrigin(0.5);
    this.container = scene.add.container(start?.x ?? 0, start?.y ?? 0, [
      base,
      this.sprite,
      this.hpBar,
      this.bubble,
    ]);
    this.container.setDepth(5);
  }

  /** The middle of the sprite, in canvas pixels. */
  position(): { x: number; y: number } {
    return { x: this.container.x, y: this.container.y - this.sprite.height / 2 };
  }

  update(hero: HeroView, layout: WorldLayout): void {
    const previous = this.state;
    this.state = hero.state.kind;
    const s = hero.state;

    if (s.kind === 'traveling' && !this.traveled && !this.travel)
      this.walk(pathTo(layout, hero.taskPointId));
    if (s.kind !== 'traveling') {
      if (this.travel) {
        // Arrived for real: finish the walk within a second instead of showing work mid-path.
        const remaining = (1 - this.travel.progress) * TRAVEL_MS;
        this.travel.timeScale = Math.max(1, remaining / CATCH_UP_MS);
      } else {
        const spot = heroSpot(layout, hero.taskPointId);
        this.container.setPosition(spot.x, spot.y);
      }
    }

    const working = s.kind === 'working' && hero.activity && hero.activity.kind !== 'think';
    const animation = s.kind === 'traveling' || this.travel ? 'walk' : working ? 'work' : 'idle';
    this.play(animation);

    this.sprite.clearTint();
    if (s.kind === 'unknown') {
      this.sprite.setTint(0x888888);
      this.sprite.anims.pause();
    } else if (s.kind === 'error') {
      this.sprite.setTint(0xff8888);
    }

    const bubbles: Partial<Record<HeroView['state']['kind'], [string, string]>> = {
      waitingOnYou: ['?', '#f2c230'],
      unknown: ['?', '#9a9a9a'],
      error: ['!', '#e8483a'],
      stalled: ['!', '#f2c230'],
      outOfGold: ['$', '#cdb56a'],
      resting: ['z', '#d8ecff'],
    };
    const bubble = bubbles[s.kind];
    this.bubble.setVisible(Boolean(bubble));
    if (bubble) {
      this.bubble.setText(` ${bubble[0]} `).setBackgroundColor(bubble[1]);
      if (previous !== s.kind) {
        this.scene.tweens.add({ targets: this.bubble, scale: { from: 1.6, to: 1 }, duration: 200 });
      }
    }

    this.drawHp(hero.hp);
  }

  private play(animation: 'walk' | 'work' | 'idle'): void {
    const key = `${this.character}:${animation}`;
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key);
    else if (this.sprite.anims.isPaused) this.sprite.anims.resume();
  }

  private walk(path: Point[]): void {
    const lengths = path
      .slice(1)
      .map((p, i) => Math.hypot(p.x - (path[i] as Point).x, p.y - (path[i] as Point).y));
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    this.travel = this.scene.tweens.addCounter({
      from: 0,
      to: total,
      duration: TRAVEL_MS,
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
        this.travel = null;
        this.traveled = true;
        this.sprite.setFlipX(false);
        if (this.state !== 'traveling') this.play('idle');
      },
    });
  }

  private drawHp(hp: HeroView['hp']): void {
    const g = this.hpBar.clear();
    const w = 12;
    const x = -w / 2;
    const y = -19;
    g.fillStyle(0x1a1420).fillRect(x - 1, y - 1, w + 2, 4);
    if (hp.kind === 'unknown') {
      g.fillStyle(0x6a6a6a).fillRect(x, y, w, 2);
      return;
    }
    const left = Math.max(0, 1 - hp.value.used / hp.value.max);
    const color = left > 0.5 ? 0x4fd16a : left > 0.25 ? 0xf2c230 : 0xe8483a;
    g.fillStyle(0x3a2a2a).fillRect(x, y, w, 2);
    g.fillStyle(color, hp.kind === 'estimated' ? 0.6 : 1).fillRect(x, y, Math.round(w * left), 2);
  }

  flash(outcome: 'ok' | 'failed'): void {
    if (outcome === 'failed') {
      this.scene.tweens.add({
        targets: this.sprite,
        alpha: { from: 0.3, to: 1 },
        duration: 120,
        repeat: 2,
        onStart: () => this.sprite.setTint(0xff5040),
        onComplete: () => this.sprite.clearTint(),
      });
      return;
    }
    const spark = this.scene.add
      .rectangle(this.container.x + 6, this.container.y - 14, 2, 2, 0xf2c230)
      .setDepth(6);
    this.scene.tweens.add({
      targets: spark,
      y: spark.y - 8,
      alpha: 0,
      duration: 500,
      onComplete: () => spark.destroy(),
    });
  }

  destroy(): void {
    this.travel?.stop();
    this.container.destroy();
  }
}
