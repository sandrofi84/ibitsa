import type { Manifest } from '@ibitsa/assets';
import * as Phaser from 'phaser';
import { councilLook } from './council-look';
import type { HutRendered, SeatObjects } from './hut-scene.types';
import { councilPose, HUT_FEED, HUT_STEPS, seatHut } from './hut-view';
import type { HutFeed, HutView } from './hut-view.types';
import { PACK_KEY } from './pack-scene';

const W = 480;
const H = 270;
/** The table's top edge; councillors stand behind it, hidden from the waist down. */
const TABLE_TOP = 168;
const FOOT = TABLE_TOP + 6;
const TABLE_DEPTH = 10;
const STUDY_DOTS = ['•', '••', '•••'];

const text = (color: string): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: 'monospace',
  fontSize: '8px',
  color,
});
const CREAM = '#f3ead2';
const DIM = '#8a7a66';
const GOLD = '#f2c230';

/** The council hut interior (§7.1 screen 2), drawn only from a `HutView`. */
export class HutScene extends Phaser.Scene {
  private manifest!: Manifest;
  private view!: HutView;
  private readonly seats = new Map<string, SeatObjects>();
  private steps: { step: string; label: Phaser.GameObjects.Text }[] = [];
  private modeLabel!: Phaser.GameObjects.Text;
  private decisionsLabel!: Phaser.GameObjects.Text;
  private dots = 0;

  constructor() {
    super('hut');
  }

  create(): void {
    this.manifest = this.cache.json.get(PACK_KEY) as Manifest;
    this.drawRoom();
    this.drawTracker();
    const feed = this.registry.get(HUT_FEED) as HutFeed;
    const off = feed.onChange((view) => this.render(view));
    this.render(feed.view);
    this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        this.dots = (this.dots + 1) % STUDY_DOTS.length;
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
    const step = this.steps.find((s) => s.label.style.color === GOLD)?.step ?? 'goal';
    return {
      mode: this.view.mode,
      step: step as HutRendered['step'],
      stage: this.view.stage,
      speaker: lit,
      decisions: this.view.decisions,
      councillors: [...this.seats].map(([id, s]) => ({
        id,
        x: s.x,
        animation: s.sprite.anims.currentAnim?.key ?? null,
        scale: s.sprite.scaleX,
        mark: s.mark.visible ? s.mark.text : null,
        hand: s.hand.visible,
        book: s.book.visible,
      })),
    };
  }

  private drawRoom(): void {
    const g = this.add.graphics();
    // Back wall in planks, a floor below the table.
    g.fillStyle(0x4a3020).fillRect(-W, -H, W * 3, H * 3);
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
    this.decisionsLabel = this.add
      .text(W / 2, TABLE_TOP + 30, '', text(CREAM))
      .setOrigin(0.5)
      .setDepth(TABLE_DEPTH + 2);
  }

  private drawTracker(): void {
    this.add.rectangle(0, 0, W, 26, 0x1a1420, 0.85).setOrigin(0);
    // Centred, clear of the DOM buttons in the panel's corners.
    const row = this.add.container(0, 4);
    let x = 0;
    this.steps = HUT_STEPS.map(({ step, label }, i) => {
      const t = this.add.text(x, 0, label, text(DIM));
      row.add(t);
      x += t.width + 4;
      if (i < HUT_STEPS.length - 1) {
        const sep = this.add.text(x, 0, '›', text(DIM));
        row.add(sep);
        x += sep.width + 4;
      }
      return { step, label: t };
    });
    row.setX(Math.round((W - (x - 4)) / 2));
    this.modeLabel = this.add.text(W / 2, 15, '', text(CREAM)).setOrigin(0.5, 0);
  }

  private render(view: HutView): void {
    this.view = view;
    const current = HUT_STEPS.findIndex((s) => s.step === view.step);
    this.steps.forEach((s, i) => {
      s.label.setColor(i === current ? GOLD : i < current ? CREAM : DIM);
    });
    this.modeLabel.setText(view.mode === 'chambers' ? 'Separate chambers' : 'Round table');
    this.decisionsLabel.setText(`Book of Decisions · ${view.decisions}`);

    const seats = seatHut(view, W);
    const wanted = new Set(seats.map((s) => s.id));
    for (const [id, s] of this.seats) {
      if (wanted.has(id)) continue;
      for (const o of [s.sprite, s.glow, s.label, s.hand, s.mark, s.book]) o.destroy();
      this.seats.delete(id);
    }
    for (const seat of seats) {
      const c = view.councillors.find((x) => x.id === seat.id);
      if (!c) continue;
      const existing = this.seats.get(seat.id);
      const objects =
        existing && existing.x === seat.x && existing.appearance === c.appearance
          ? existing
          : this.seat(
              { id: seat.id, x: seat.x, appearance: c.appearance, title: c.title },
              existing,
            );
      const look = councilLook(this.character(c.appearance), councilPose(view, c.id));
      if (objects.sprite.texture.key !== look.texture) objects.sprite.setTexture(look.texture);
      objects.sprite.setScale(look.scale).play(look.animation, true);
      const speaking = view.speaker === c.id;
      objects.glow.setVisible(speaking);
      objects.label.setColor(speaking ? GOLD : CREAM);
      objects.hand.setVisible(c.raisedHand);
      objects.book.setVisible(view.stage === 'study' && c.report === 'pending');
    }
    this.renderMarks();
  }

  private renderMarks(): void {
    for (const [id, s] of this.seats) {
      const c = this.view.councillors.find((x) => x.id === id);
      const show = this.view.stage === 'study' && c !== undefined;
      const filed = c?.report === 'filed';
      s.mark
        .setVisible(show)
        .setText(filed ? '✓' : (STUDY_DOTS[this.dots] as string))
        .setColor(filed ? '#4fd16a' : CREAM);
    }
  }

  /** The pack character for an appearance, else the default councillor's. */
  private character(appearance: string) {
    const character = this.manifest.characters[appearance];
    if (character) return { key: appearance, character };
    const key = 'councillor.default';
    return { key, character: this.manifest.characters[key] as Manifest['characters'][string] };
  }

  private seat(
    { id, x, appearance, title }: { id: string; x: number; appearance: string; title: string },
    replacing: SeatObjects | undefined,
  ): SeatObjects {
    if (replacing) {
      for (const o of [
        replacing.sprite,
        replacing.glow,
        replacing.label,
        replacing.hand,
        replacing.mark,
        replacing.book,
      ])
        o.destroy();
    }
    const look = councilLook(this.character(appearance), 'idle');
    const bubble = this.add.container(x + 11, FOOT - 42, [
      this.add.rectangle(0, 0, 9, 11, 0xfdfaf0).setStrokeStyle(1, 0x1a1420),
      this.add.text(0, 0, '!', text('#1a1420')).setOrigin(0.5),
    ]);
    const objects: SeatObjects = {
      x,
      appearance,
      glow: this.add.ellipse(x, FOOT - 18, 44, 52, 0xfff2b0, 0.3).setVisible(false),
      sprite: this.add.sprite(x, FOOT, look.texture).setOrigin(0.5, 1).setDepth(1),
      label: this.add
        .text(x, TABLE_TOP + 14, title, text(CREAM))
        .setOrigin(0.5)
        .setDepth(TABLE_DEPTH + 2),
      hand: bubble.setDepth(TABLE_DEPTH + 3).setVisible(false),
      mark: this.add
        .text(x, FOOT - 39, '', text(CREAM))
        .setOrigin(0.5)
        .setDepth(TABLE_DEPTH + 3)
        .setVisible(false),
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
