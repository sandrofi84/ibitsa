import type { Manifest } from '@ibitsa/assets';
import type { Cue, HeroView, Reading, Snapshot, TaskPointState } from '@ibitsa/protocol';
import * as Phaser from 'phaser';
import { CameraDirector, OVERVIEW_ZOOM } from './camera-director';
import type { CameraState } from './camera-director.types';
import type { GameClient } from './client';
import { speechExcerpt } from './heroes';
import { heroSpot, layoutWorld, pathTo } from './layout';
import type { Point, WorldLayout } from './layout.types';
import { PACK_KEY } from './pack-scene';
import type { ViewState } from './view-state';

export const WIDTH = 480;
export const HEIGHT = 270;
const TRAVEL_MS = 3_000;
/** How long the camera takes to zoom or ease back to the whole map. */
const CAMERA_MS = 400;
/** One zoom step per wheel gesture: a trackpad sends many events for one swipe. */
const WHEEL_GAP_MS = 250;
/** How far the pointer moves before a press becomes a drag, in game pixels. */
const DRAG_START = 3;
const AUTO_KEY = 'cameraAuto';

/** Game events between the camera and its on-screen controls (#59). */
export const CAMERA_EVENTS = {
  zoomIn: 'camera:zoomIn',
  zoomOut: 'camera:zoomOut',
  overview: 'camera:overview',
  toggleAuto: 'camera:toggleAuto',
  changed: 'camera:changed',
} as const;
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
  /** Everything on the map, which the main camera zooms; the HUD is drawn by a fixed UI camera. */
  private world!: Phaser.GameObjects.Container;
  private ui!: Phaser.Cameras.Scene2D.Camera;
  private director!: CameraDirector;
  private view!: ViewState;
  private lastWheel = 0;
  private dragging = false;
  private questLayer!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Text;
  private empty!: Phaser.GameObjects.Text;
  private readonly heroes = new Map<string, HeroToken>();
  private islandKey = '';

  constructor() {
    super('world');
  }

  /** The first hero's token, for tests and probes. */
  firstHero(): HeroToken | null {
    return this.heroes.values().next().value ?? null;
  }

  /** The camera as the controls and tests see it. */
  cameraState(): CameraState {
    const cam = this.cameras.main;
    const v = cam.worldView;
    return {
      zoom: cam.zoom,
      aim: this.director.current,
      auto: this.director.autoFocus,
      view: { x: v.x, y: v.y, width: v.width, height: v.height },
    };
  }

  /** A point on the map in canvas pixels, through the camera's scroll and zoom. */
  toCanvas(point: { x: number; y: number }): { x: number; y: number } {
    const cam = this.cameras.main;
    return {
      x: (point.x - cam.worldView.x) * cam.zoom,
      y: (point.y - cam.worldView.y) * cam.zoom,
    };
  }

  create(): void {
    this.manifest = this.cache.json.get(PACK_KEY) as Manifest;
    const waterIndex = this.manifest.tiles.tiles.water?.index ?? 0;
    this.world = this.add.container(0, 0);
    // The sea reaches past the map on every side, so a panel wider or taller than the world shows
    // more sea, never black (#59). A filled panel is under twice the world in each direction.
    this.water = this.add
      .tileSprite(-WIDTH, -HEIGHT, WIDTH * 3, HEIGHT * 3, 'tiles', waterIndex)
      .setOrigin(0);
    this.world.add(this.water);
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
    const village = this.add.container(0, 0);
    this.drawIsland(village, v);
    this.questLayer = this.add.container(0, 0);
    this.empty = this.add.text(330, 120, 'No quest yet', textStyle('#d8ecff')).setOrigin(0.5);
    this.world.add([
      village,
      this.add.image(v.hut.x, v.hut.y, 'building:hut').setOrigin(0),
      this.add.text(v.x + 22, v.y + 70, 'HOME VILLAGE', textStyle()),
      this.questLayer,
      this.empty,
    ]);
    this.hud = this.add.text(6, 4, '', textStyle());

    this.setUpCamera();

    const client = this.registry.get('client') as GameClient;
    client.onSnapshot((s) => this.render(s));
    client.onCue((c) => this.cue(c));
  }

  private setUpCamera(): void {
    this.view = this.registry.get('view') as ViewState;
    this.director = new CameraDirector({ auto: this.view.get(AUTO_KEY, true) });
    const cam = this.cameras.main;
    cam.setBounds(-WIDTH, -HEIGHT, WIDTH * 3, HEIGHT * 3).centerOn(WIDTH / 2, HEIGHT / 2);
    this.ui = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'ui');
    this.ui.ignore(this.world);
    cam.ignore(this.hud);
    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      cam.setSize(size.width, size.height);
      this.ui.setSize(size.width, size.height);
      if (!this.director.current.follow && this.director.current.zoom === OVERVIEW_ZOOM)
        cam.centerOn(WIDTH / 2, HEIGHT / 2);
    });

    const events = this.game.events;
    events.on(CAMERA_EVENTS.zoomIn, () => this.aimCamera(this.director.zoomIn()));
    events.on(CAMERA_EVENTS.zoomOut, () => this.aimCamera(this.director.zoomOut()));
    events.on(CAMERA_EVENTS.overview, () => this.aimCamera(this.director.overview()));
    events.on(CAMERA_EVENTS.toggleAuto, () => {
      this.director.setAuto(!this.director.autoFocus);
      this.view.set(AUTO_KEY, this.director.autoFocus);
      this.announceCamera();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const name of Object.values(CAMERA_EVENTS)) events.off(name);
    });
    // The controls show the right state from the start, not only after the first move.
    this.announceCamera();

    this.input.on('wheel', (p: Phaser.Input.Pointer) => {
      const dy = p.deltaY;
      const now = this.time.now;
      if (dy === 0 || now - this.lastWheel < WHEEL_GAP_MS) return;
      this.lastWheel = now;
      this.aimCamera(dy > 0 ? this.director.zoomOut() : this.director.zoomIn());
    });
    this.input.on('pointerup', () => {
      this.dragging = false;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      if (!this.dragging && p.getDistance() < DRAG_START) return;
      if (!this.dragging) {
        this.dragging = true;
        cam.stopFollow();
        this.director.pan();
        this.announceCamera();
      }
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    // Phaser listens on the window; typing in the hero pane or a form must not zoom.
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === '+' || e.key === '=') this.aimCamera(this.director.zoomIn());
      else if (e.key === '-' || e.key === '_') this.aimCamera(this.director.zoomOut());
      else if (e.key === '0') this.aimCamera(this.director.overview());
    });
  }

  /** Moves the main camera to the director's aim: zoom, follow the hero, or ease back to the map. */
  private aimCamera(aim: { zoom: number; follow: boolean }): void {
    const cam = this.cameras.main;
    cam.zoomTo(aim.zoom, CAMERA_MS, 'Sine.easeInOut', true);
    const hero = this.firstHero();
    if (aim.follow && hero) {
      cam.startFollow(hero.target(), true, 0.15, 0.15);
    } else {
      cam.stopFollow();
      if (aim.zoom === OVERVIEW_ZOOM)
        cam.pan(WIDTH / 2, HEIGHT / 2, CAMERA_MS, 'Sine.easeInOut', true);
    }
    this.announceCamera();
  }

  private announceCamera(): void {
    this.game.events.emit(CAMERA_EVENTS.changed, this.cameraState());
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
          layer: this.world,
          hero,
          iconKinds: this.manifest.activityIcons.kinds,
          character: this.characterKey(hero.classId),
          layout: this.layout,
        });
        this.heroes.set(hero.id, token);
      }
      token.update({
        hero,
        layout: this.layout,
        questActive: snapshot.campaign?.status === 'active',
      });
    }
    for (const [id, token] of this.heroes) {
      if (!seen.has(id)) {
        token.destroy();
        this.heroes.delete(id);
      }
    }
    if (this.director.observe(snapshot)) this.aimCamera(this.director.current);
  }

  private characterKey(classId: string): string {
    const key = `hero.${classId}`;
    return this.manifest.characters[key] ? key : 'hero.ranger';
  }

  private cue(cue: Cue): void {
    if (cue.type === 'activityFinished') this.heroes.get(cue.heroId)?.flash(cue);
    if (cue.type === 'retrying') this.heroes.get(cue.heroId)?.flash({ outcome: 'failed' });
    if (cue.type === 'heroSaid') this.heroes.get(cue.heroId)?.say(cue.text);
  }
}

function gold(reading: Reading<number>): string {
  if (reading.kind === 'unknown') return '?';
  const g = Math.round(reading.value / 10_000); // 1 gold = 1 cent
  return reading.kind === 'estimated' ? `~${g}` : String(g);
}

/** How long the flask stays, green or red, after a test run. */
const TEST_LINGER_MS = 900;

/** How long a message's speech bubble stays before it fades. */
const SPEECH_MS = 4000;

/** Emitted on `game.events` with the hero's id when the hero is clicked on the map (#61). */
export const HERO_SELECTED = 'heroSelected';

/** A hero on the map: round token base, sprite, HP bar and status bubble (spec §7.2). */
export class HeroToken {
  private readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly bubble: Phaser.GameObjects.Text;
  /** Speech: a message excerpt that fades, or "Ready for review!" while submitted (#57). */
  private readonly speech: Phaser.GameObjects.Container;
  private readonly speechBox: Phaser.GameObjects.Graphics;
  private readonly speechText: Phaser.GameObjects.Text;
  private speechKind: 'none' | 'message' | 'submitted' = 'none';
  /** What the hero is doing, as an icon beside its head (#60); lingers briefly after a test. */
  private readonly icon: Phaser.GameObjects.Sprite;
  private readonly iconKinds: readonly string[];
  private iconLinger: Phaser.Time.TimerEvent | null = null;
  private speechFade: Phaser.Tweens.Tween | null = null;
  private travel: Phaser.Tweens.Tween | null = null;
  private traveled = false;
  private state: HeroView['state']['kind'] = 'traveling';

  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Container;
  private readonly character: string;

  constructor({
    scene,
    layer,
    hero,
    iconKinds,
    character,
    layout,
  }: {
    scene: Phaser.Scene;
    /** The map layer the token lives in, so the camera zooms it. */
    layer: Phaser.GameObjects.Container;
    hero: HeroView;
    iconKinds: readonly string[];
    character: string;
    layout: WorldLayout;
  }) {
    this.scene = scene;
    this.layer = layer;
    this.iconKinds = iconKinds;
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
    this.speechBox = scene.add.graphics();
    this.speechText = scene.add.text(0, -3, '', textStyle('#1a1420')).setOrigin(0.5, 1);
    this.speechText
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => scene.game.events.emit(HERO_SELECTED, hero.id));
    this.speech = scene.add.container(0, -24, [this.speechBox, this.speechText]).setVisible(false);
    this.icon = scene.add.sprite(13, -9, 'activityIcons', 0).setVisible(false);
    this.container = scene.add.container(start?.x ?? 0, start?.y ?? 0, [
      base,
      this.sprite,
      this.hpBar,
      this.icon,
      this.bubble,
      this.speech,
    ]);
    layer.add(this.container);
  }

  /** What the camera follows. */
  target(): Phaser.GameObjects.Container {
    return this.container;
  }

  /** The middle of the sprite, on the map. */
  position(): { x: number; y: number } {
    return { x: this.container.x, y: this.container.y - this.sprite.height / 2 };
  }

  /** A message from the hero: its excerpt shows for a few seconds, unless "Ready for review!" is up. */
  say(text: string): void {
    if (this.speechKind === 'submitted') return;
    this.showSpeech({ text: speechExcerpt(text), kind: 'message' });
    this.speechFade = this.scene.tweens.add({
      targets: this.speech,
      alpha: 0,
      delay: SPEECH_MS,
      duration: 500,
      onComplete: () => this.hideSpeech(),
    });
  }

  /** The activity icon showing, else null. */
  showingIcon(): string | null {
    return this.icon.visible ? (this.iconKinds[Number(this.icon.frame.name)] ?? null) : null;
  }

  private showIcon(kind: string): boolean {
    const frame = this.iconKinds.indexOf(kind);
    if (frame < 0) return false;
    this.icon.setFrame(frame).setVisible(true);
    return true;
  }

  /** The speech bubble's text while it shows, else null. */
  speaking(): string | null {
    return this.speech.visible ? this.speechText.text : null;
  }

  private showSpeech({ text, kind }: { text: string; kind: 'message' | 'submitted' }): void {
    this.speechFade?.stop();
    this.speechFade = null;
    this.speechKind = kind;
    this.speechText.setText(text);
    const w = Math.ceil(this.speechText.width) + 8;
    const h = Math.ceil(this.speechText.height) + 4;
    const fill = kind === 'submitted' ? 0xd9f2c4 : 0xfff6dc;
    this.speechBox
      .clear()
      .fillStyle(fill)
      .fillRoundedRect(-w / 2, -h - 1, w, h, 3)
      .lineStyle(1, 0x5e3b1c)
      .strokeRoundedRect(-w / 2, -h - 1, w, h, 3)
      .fillStyle(fill)
      .fillTriangle(-3, -2, 3, -2, 0, 3)
      .lineStyle(1, 0x5e3b1c)
      .lineBetween(-3, -1, 0, 3)
      .lineBetween(3, -1, 0, 3);
    this.speech.setAlpha(1).setVisible(true);
  }

  private hideSpeech(): void {
    this.speechFade?.stop();
    this.speechFade = null;
    this.speechKind = 'none';
    this.speech.setVisible(false);
  }

  update({
    hero,
    layout,
    questActive,
  }: {
    hero: HeroView;
    layout: WorldLayout;
    questActive: boolean;
  }): void {
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

    if (!this.iconLinger) {
      const activity = s.kind === 'working' ? hero.activity : null;
      if (!activity || !this.showIcon(activity.kind)) this.icon.setVisible(false);
    }

    // "Ready for review!" stays until the quest is finished or the hero gets back to work.
    const readyForReview = s.kind === 'submitted' && questActive;
    if (readyForReview && this.speechKind !== 'submitted') {
      this.showSpeech({ text: 'Ready for review!', kind: 'submitted' });
    } else if (!readyForReview && this.speechKind === 'submitted') {
      this.hideSpeech();
    }
    // Above the status bubble when one shows, so neither covers the other or the HP bar.
    this.speech.setY(this.bubble.visible ? -32 : -22);

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

  flash({ outcome, kind }: { outcome: 'ok' | 'failed'; kind?: string }): void {
    if (kind === 'test' && this.showIcon('test')) {
      // The flask turns green or red and stays a moment, so a quick test run is still seen.
      this.icon.setTint(outcome === 'ok' ? 0x7fdc7f : 0xff6a5a);
      this.iconLinger?.remove();
      this.iconLinger = this.scene.time.delayedCall(TEST_LINGER_MS, () => {
        this.iconLinger = null;
        this.icon.clearTint().setVisible(false);
      });
    }
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
    const spark = this.scene.add.rectangle(
      this.container.x + 6,
      this.container.y - 14,
      2,
      2,
      0xf2c230,
    );
    this.layer.add(spark);
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
