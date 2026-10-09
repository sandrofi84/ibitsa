import type { Manifest } from '@ibitsa/assets';
import * as Phaser from 'phaser';
import { councilLook } from './council-look';
import type { CouncilPose } from './council-look.types';
import type { BubbleKind, HutRendered, PlateBox, SeatObjects } from './hut-scene.types';
import {
  councilPose,
  DECISIONS_Y,
  fitTitle,
  HUT_DOOR_X,
  HUT_FEED,
  HUT_SEATED,
  HUT_STEPS,
  PLATE_PAD,
  placeNames,
  STATUS_BUBBLE,
  STUDY_DOT_STEPS,
  seatHut,
  statusMark,
  TABLE_TOP,
  walkIns,
} from './hut-view';
import type { HutFeed, HutView, NamePlate, WalkIn } from './hut-view.types';
import { PACK_KEY, SCENE_KEYS } from './pack-scene';
import { addPixelText, type PixelText } from './pixel-text';
import { recoloredCharacter, recolorOf } from './recolor';
import { packLook } from './sitting-hut';

const W = 480;
const H = 270;
/** Where a councillor's feet are: 16 px below the table's edge, so it hides their lower third. */
const FOOT = TABLE_TOP + 16;
const TABLE_DEPTH = 10;
/** A status bubble's box (#267), in room pixels: room for "•••" or "✓" in the pixel font. */
const BUBBLE_W = 14;
const BUBBLE_H = 10;
/** The bubble's colours as Phaser numbers. */
const bubbleColour = (hex: string) => Number.parseInt(hex.slice(1), 16);
/** How the council sits, under the tracker; nothing while the elder is alone (#244). */
const MODE_LABELS = { roundTable: 'Round table', chambers: 'Separate chambers', none: '' };

const CREAM = '#f3ead2';
const DIM = '#8a7a66';
const GOLD = '#f2c230';
/** Name plates (#233): dark letters on a cream plate with a dark rim, gold for the speaker. */
const INK = '#3e2731';
const PLATE = 0xf3ead2;
const PLATE_LIT = 0xf2c230;
const PLATE_RIM = 0x3e2731;
const PLATE_HEIGHT = 11;

/** A plate's box, rounded to room pixels (#233). */
const box = (plate: Phaser.GameObjects.Rectangle): PlateBox => {
  const b = plate.getBounds();
  return {
    left: Math.round(b.left),
    top: Math.round(b.top),
    right: Math.round(b.right),
    bottom: Math.round(b.bottom),
  };
};

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The council hut interior (§7.1 screen 2), drawn only from a `HutView`. */
export class HutScene extends Phaser.Scene {
  private manifest!: Manifest;
  private view!: HutView;
  private readonly seats = new Map<string, SeatObjects>();
  private steps: { step: string; label: PixelText }[] = [];
  private modeLabel!: PixelText;
  private decisionsLabel!: PixelText;
  private decisionsPlate!: Phaser.GameObjects.Rectangle;
  /** Measures titles in the plates' font, to size and place the plates (#233). */
  private measurer!: PixelText;
  private dots = 0;
  /** Until the first view is drawn: a hut opened mid-sitting shows everyone seated (#219). */
  private first = true;

  constructor() {
    super('hut');
  }

  create(): void {
    this.manifest = this.cache.json.get(PACK_KEY) as Manifest;
    this.first = true;
    this.drawRoom();
    this.drawTracker();
    const feed = this.registry.get(HUT_FEED) as HutFeed;
    const off = feed.onChange((view) => this.render(view));
    this.render(feed.view);
    this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        this.dots = (this.dots + 1) % STUDY_DOT_STEPS;
        this.renderMarks();
      },
    });
    const centre = () => this.cameras.main.centerOn(W / 2, H / 2);
    centre();
    this.scale.on(Phaser.Scale.Events.RESIZE, centre);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      off();
      this.scale.off(Phaser.Scale.Events.RESIZE, centre);
      this.seats.clear();
    });
  }

  /** What the scene shows, read back from its objects. */
  rendered(): HutRendered {
    const lit = [...this.seats].find(([, s]) => s.glow.visible)?.[0] ?? null;
    const step = this.steps.find((s) => s.label.color === GOLD)?.step ?? 'goal';
    return {
      mode: this.view.mode,
      step: step as HutRendered['step'],
      stage: this.view.stage,
      speaker: lit,
      decisions: this.view.decisions,
      room: this.textures.exists(SCENE_KEYS.hutInterior) ? 'pack' : 'drawn',
      table: this.textures.exists(SCENE_KEYS.hutTable) ? 'pack' : 'drawn',
      decisionsPlate: box(this.decisionsPlate),
      councillors: [...this.seats].map(([id, s]) => ({
        id,
        x: s.x,
        at: Math.round(s.sprite.x),
        walking: s.walking,
        animation: s.sprite.anims.currentAnim?.key ?? null,
        scale: s.sprite.scaleX,
        mark: s.mark.visible ? s.markText.text : null,
        hand: s.hand.visible,
        book: s.book.visible,
        name: s.label.text,
        plate: box(s.plate),
      })),
    };
  }

  private drawRoom(): void {
    const g = this.add.graphics();
    // Beyond the room, whichever room it is.
    g.fillStyle(0x4a3020).fillRect(-W, -H, W * 3, H * 3);
    if (this.textures.exists(SCENE_KEYS.hutInterior)) {
      // The pack's room (#219).
      this.add.image(0, 0, SCENE_KEYS.hutInterior).setOrigin(0);
    } else {
      // Back wall in planks, a floor below the table.
      g.fillStyle(0x3a2416);
      for (let y = 12; y < 220; y += 12) g.fillRect(0, y, W, 1);
      g.fillStyle(0x5e3b1c).fillRect(0, 216, W, H - 216);
      // A window with sky, and shelves of books either side.
      g.fillStyle(0x2a1a10).fillRect(204, 34, 72, 54);
      g.fillStyle(0x8fc1ef).fillRect(208, 38, 64, 46);
      g.fillStyle(0x2a1a10).fillRect(239, 38, 2, 46).fillRect(208, 60, 64, 2);
      const books = [0xb8392b, 0x3a6ac0, 0x3f8a3a, 0xf2c230, 0x6e4aa8, 0xe86a3a];
      for (const x0 of [40, 360]) {
        for (const y of [56, 90]) {
          g.fillStyle(0x2a1a10).fillRect(x0, y + 16, 80, 4);
          for (let i = 0; i < 9; i++) {
            g.fillStyle(books[(i + y) % books.length] as number).fillRect(
              x0 + 4 + i * 8,
              y + 2 + (i % 3),
              6,
              14 - (i % 3),
            );
          }
        }
      }
      // The door on the left, where the councillors come in (#219).
      g.fillStyle(0x2a1a10).fillRect(HUT_DOOR_X - 14, FOOT - 60, 28, 60);
      g.fillStyle(0x6b4423).fillRect(HUT_DOOR_X - 11, FOOT - 57, 22, 57);
      g.fillStyle(0xf2c230).fillRect(HUT_DOOR_X + 6, FOOT - 30, 2, 2);
    }
    if (this.textures.exists(SCENE_KEYS.hutTable)) {
      // The pack's table, in front of the councillors (#219).
      this.add.image(0, 0, SCENE_KEYS.hutTable).setOrigin(0).setDepth(TABLE_DEPTH);
    } else {
      // The long table, in front of the councillors.
      const table = this.add.graphics().setDepth(TABLE_DEPTH);
      table.fillStyle(0xa0703a).fillRect(24, TABLE_TOP, W - 48, 8);
      table.fillStyle(0xc89a5a).fillRect(24, TABLE_TOP, W - 48, 1);
      table.fillStyle(0x7a4a24).fillRect(28, TABLE_TOP + 8, W - 56, 36);
      table.fillStyle(0x5e3818).fillRect(28, TABLE_TOP + 43, W - 56, 1);
      table
        .fillStyle(0x5e3818)
        .fillRect(36, TABLE_TOP + 44, 6, 14)
        .fillRect(W - 42, TABLE_TOP + 44, 6, 14);
      // The Book of Decisions, open in front of the elder's seat.
      const book = this.add.graphics().setDepth(TABLE_DEPTH + 1);
      book.fillStyle(0x5a2a1a).fillRect(W / 2 - 11, TABLE_TOP - 2, 22, 8);
      book
        .fillStyle(0xfdfaf0)
        .fillRect(W / 2 - 10, TABLE_TOP - 3, 9, 6)
        .fillRect(W / 2 + 1, TABLE_TOP - 3, 9, 6);
    }
    this.decisionsPlate = this.plate({ x: W / 2, y: DECISIONS_Y });
    this.decisionsLabel = addPixelText(this, { x: W / 2, y: DECISIONS_Y, text: '', color: INK })
      .setOrigin(0.5)
      .setDepth(TABLE_DEPTH + 3);
    this.measurer = addPixelText(this, { x: 0, y: 0, text: '', color: INK }).setVisible(false);
  }

  private drawTracker(): void {
    this.add.rectangle(0, 0, W, 26, 0x1a1420, 0.85).setOrigin(0);
    // Centred, clear of the DOM buttons in the panel's corners.
    const row = this.add.container(0, 4);
    let x = 0;
    this.steps = HUT_STEPS.map(({ step, label }, i) => {
      const t = addPixelText(this, { x: x, y: 0, text: label, color: DIM });
      row.add(t);
      x += t.width + 4;
      if (i < HUT_STEPS.length - 1) {
        const sep = addPixelText(this, { x: x, y: 0, text: '›', color: DIM });
        row.add(sep);
        x += sep.width + 4;
      }
      return { step, label: t };
    });
    row.setX(Math.round((W - (x - 4)) / 2));
    this.modeLabel = addPixelText(this, { x: W / 2, y: 15, text: '', color: CREAM }).setOrigin(
      0.5,
      0,
    );
  }

  private render(view: HutView): void {
    this.view = view;
    const current = HUT_STEPS.findIndex((s) => s.step === view.step);
    this.steps.forEach((s, i) => {
      s.label.setColor(i === current ? GOLD : i < current ? CREAM : DIM);
    });
    this.modeLabel.setText(MODE_LABELS[view.mode ?? 'none']);
    this.decisionsLabel.setText(`Book of Decisions · ${view.decisions}`);
    this.decisionsPlate.setSize(this.decisionsLabel.width + 2 * PLATE_PAD, PLATE_HEIGHT);
    this.decisionsPlate.setOrigin(0.5);

    const seats = seatHut(view, W);
    const walks = walkIns({
      seats,
      seated: new Set(this.seats.keys()),
      first: this.first,
      view,
      reducedMotion: reducedMotion(),
    });
    this.first = false;
    const measure = (t: string) => this.measurer.setText(t).width;
    const titles = seats.map((seat) =>
      fitTitle({ title: view.councillors.find((c) => c.id === seat.id)?.title ?? '', measure }),
    );
    const plates = placeNames({ seats, widths: titles.map(measure), room: W });
    const wanted = new Set(seats.map((s) => s.id));
    for (const [id, s] of this.seats) {
      if (wanted.has(id)) continue;
      for (const o of [s.sprite, s.glow, s.label, s.plate, s.hand, s.mark, s.book]) o.destroy();
      this.seats.delete(id);
    }
    seats.forEach((seat, i) => {
      const c = view.councillors.find((x) => x.id === seat.id);
      if (!c) return;
      const existing = this.seats.get(seat.id);
      const title = titles[i] ?? c.title;
      const plate = plates[i] ?? { id: seat.id, x: seat.x, y: DECISIONS_Y, width: 0 };
      const objects =
        existing &&
        existing.x === seat.x &&
        existing.appearance === c.appearance &&
        existing.label.text === title &&
        existing.label.x === plate.x &&
        existing.label.y === plate.y
          ? existing
          : this.seat({ id: seat.id, x: seat.x, appearance: c.appearance, title, plate }, existing);
      const walk = walks.find((w) => w.id === seat.id);
      if (walk) this.walkIn(objects, walk);
      const pose = this.animation(c, councilPose(view, c.id));
      objects.pose = pose;
      if (!objects.walking) this.play(objects, pose);
      const speaking = view.speaker === c.id;
      objects.glow.setVisible(speaking && !objects.walking);
      objects.label.setVisible(!objects.walking);
      objects.plate.setFillStyle(speaking ? PLATE_LIT : PLATE).setVisible(!objects.walking);
      objects.hand.setVisible(c.raisedHand && !objects.walking);
      objects.book.setVisible(view.stage === 'study' && c.report === 'pending' && !objects.walking);
    });
    this.renderMarks();
    // The welcome's form waits for the elder to reach its seat (#244).
    if (![...this.seats.values()].some((s) => s.walking)) this.game.events.emit(HUT_SEATED);
  }

  /** A councillor's texture and animation for a pose, recolored as its settings say (#182). */
  private animation(c: { id: string; appearance: string }, pose: CouncilPose): SeatObjects['pose'] {
    const look = councilLook(this.character(c.appearance), pose);
    // A copy of its sheet, with its animations.
    const texture = recoloredCharacter({
      scene: this,
      key: look.texture,
      recolor: recolorOf(`councillor:${c.id}`),
    });
    return {
      texture,
      animation: `${texture}${look.animation.slice(look.texture.length)}`,
      scale: look.scale,
    };
  }

  private play(objects: SeatObjects, look: SeatObjects['pose']): void {
    if (objects.sprite.texture.key !== look.texture) objects.sprite.setTexture(look.texture);
    objects.sprite.setScale(look.scale).play(look.animation, true);
  }

  /** In through the door to the seat (#219), then the pose it should be in by then. */
  private walkIn(objects: SeatObjects, walk: WalkIn): void {
    const c = this.view.councillors.find((x) => x.id === walk.id);
    if (!c) return;
    objects.walking = true;
    objects.sprite.setX(walk.fromX);
    this.play(objects, this.animation(c, 'walk'));
    this.tweens.add({
      targets: objects.sprite,
      x: walk.toX,
      delay: walk.delayMs,
      duration: walk.durationMs,
      onComplete: () => {
        objects.walking = false;
        this.render(this.view);
      },
    });
  }

  private renderMarks(): void {
    for (const [id, s] of this.seats) {
      const mark = statusMark({ view: this.view, id, dots: this.dots });
      s.mark.setVisible(mark !== null && !s.walking);
      if (mark)
        s.markText.setText(mark.text).setColor(mark.done ? STATUS_BUBBLE.done : STATUS_BUBBLE.ink);
    }
  }

  /**
   * A status bubble over a head (#267): a light box with a dark, rounded rim, drawn in whole pixels so
   * it stays crisp at every zoom, with a tail down to the head: two trailing dots for a thought, a
   * point for speech. Its origin is the box's middle.
   */
  private bubble(kind: BubbleKind): Phaser.GameObjects.Graphics {
    const rim = bubbleColour(STATUS_BUBBLE.rim);
    const fill = bubbleColour(STATUS_BUBBLE.fill);
    const [w, h] = [BUBBLE_W, BUBBLE_H];
    const [x, y] = [-w / 2, -h / 2];
    const g = this.add.graphics();
    // The rim with its corners cut, then the fill one pixel in.
    g.fillStyle(rim)
      .fillRect(x + 1, y, w - 2, h)
      .fillRect(x, y + 1, w, h - 2);
    g.fillStyle(fill)
      .fillRect(x + 2, y + 1, w - 4, h - 2)
      .fillRect(x + 1, y + 2, w - 2, h - 4);
    if (kind === 'thought') {
      // Two trailing dots, down and left towards the head.
      g.fillStyle(rim)
        .fillRect(x + 3, y + h + 1, 4, 4)
        .fillRect(x + 1, y + h + 5, 2, 2);
      g.fillStyle(fill).fillRect(x + 4, y + h + 2, 2, 2);
    } else {
      // A point under the box, rim either side.
      g.fillStyle(rim)
        .fillRect(x + 3, y + h - 1, 5, 1)
        .fillRect(x + 3, y + h, 4, 1)
        .fillRect(x + 3, y + h + 1, 3, 1)
        .fillRect(x + 3, y + h + 2, 2, 1);
      g.fillStyle(fill)
        .fillRect(x + 4, y + h - 1, 3, 1)
        .fillRect(x + 4, y + h, 2, 1);
    }
    return g;
  }

  /** The pack character for an appearance, else the default councillor's (#220). */
  private character(appearance: string) {
    const key = packLook({ appearance, has: (k) => this.manifest.characters[k] !== undefined });
    return { key, character: this.manifest.characters[key] as Manifest['characters'][string] };
  }

  /** A name plate, on the table's front (#233); sized by its caller. */
  private plate({ x, y }: { x: number; y: number }): Phaser.GameObjects.Rectangle {
    return this.add
      .rectangle(x, y, 0, PLATE_HEIGHT, PLATE)
      .setStrokeStyle(1, PLATE_RIM)
      .setDepth(TABLE_DEPTH + 2);
  }

  private seat(
    {
      id,
      x,
      appearance,
      title,
      plate,
    }: { id: string; x: number; appearance: string; title: string; plate: NamePlate },
    replacing: SeatObjects | undefined,
  ): SeatObjects {
    if (replacing) {
      for (const o of [
        replacing.sprite,
        replacing.glow,
        replacing.label,
        replacing.plate,
        replacing.hand,
        replacing.mark,
        replacing.book,
      ])
        o.destroy();
    }
    const look = councilLook(this.character(appearance), 'idle');
    const hand = this.add.container(x + 12, FOOT - 58, [
      this.bubble('speech'),
      addPixelText(this, { x: 0, y: 0, text: '!', color: STATUS_BUBBLE.ink }).setOrigin(0.5),
    ]);
    const markText = addPixelText(this, { x: 0, y: 0, text: '', color: STATUS_BUBBLE.ink });
    markText.setOrigin(0.5);
    const mark = this.add.container(x + 6, FOOT - 60, [this.bubble('thought'), markText]);
    const objects: SeatObjects = {
      x,
      appearance,
      walking: false,
      pose: { texture: look.texture, animation: look.animation, scale: look.scale },
      glow: this.add.ellipse(x, FOOT - 26, 58, 66, 0xfff2b0, 0.3).setVisible(false),
      sprite: this.add.sprite(x, FOOT, look.texture).setOrigin(0.5, 1).setDepth(1),
      label: addPixelText(this, { x: plate.x, y: plate.y, text: title, color: INK })
        .setOrigin(0.5)
        .setDepth(TABLE_DEPTH + 3),
      plate: this.plate({ x: plate.x, y: plate.y })
        .setSize(plate.width, PLATE_HEIGHT)
        .setOrigin(0.5),
      hand: hand.setDepth(TABLE_DEPTH + 3).setVisible(false),
      mark: mark.setDepth(TABLE_DEPTH + 3).setVisible(false),
      markText,
      book: this.add
        .rectangle(x, TABLE_TOP - 1, 12, 5, 0xfdfaf0)
        .setStrokeStyle(1, 0x3a6ac0)
        .setDepth(TABLE_DEPTH + 1)
        .setVisible(false),
    };
    this.seats.set(id, objects);
    return objects;
  }
}
