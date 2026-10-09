import * as Phaser from 'phaser';
import { drawable, FONT_KEY, FONT_LINE, FONT_SIZE, tintOf } from './font';
import type { PixelTextConfig } from './pixel-text.types';

/**
 * Canvas text in the pixel font (#246), crisp at every zoom where Phaser's `Text` drew a system font
 * small and scaled its soft edges up. It keeps the few parts of `Text` the scenes use: an origin,
 * a colour, an optional background behind the whole text, its size, and a hit area that follows it.
 */
export class PixelText extends Phaser.GameObjects.Container {
  private readonly glyphs: Phaser.GameObjects.BitmapText;
  private readonly back: Phaser.GameObjects.Rectangle;
  private readonly anchor = { x: 0, y: 0 };
  private written = '';
  private shade = '';

  constructor(scene: Phaser.Scene, { x, y, text, color, background }: PixelTextConfig) {
    super(scene, x, y);
    this.back = new Phaser.GameObjects.Rectangle(scene, 0, 0, 1, 1, 0)
      .setOrigin(0)
      .setVisible(false);
    this.glyphs = new Phaser.GameObjects.BitmapText(scene, 0, 0, FONT_KEY, '', FONT_SIZE);
    this.add([this.back, this.glyphs]);
    this.setColor(color);
    if (background) this.setBackgroundColor(background);
    this.setText(text);
  }

  /** The text as it was given, before any character the font lacks was swapped. */
  get text(): string {
    return this.written;
  }

  setText(text: string): this {
    this.written = text;
    const chars = this.glyphs.fontData.chars;
    this.glyphs.setText(
      drawable({
        text,
        has: (char) => char.length === 1 && chars[char.charCodeAt(0)] !== undefined,
      }),
    );
    return this.layout();
  }

  /** Its origin, as `setOrigin` set it: a container's own `originX` is always its middle. */
  get origin(): { x: number; y: number } {
    return { ...this.anchor };
  }

  /** The text's colour, as it was given. */
  get color(): string {
    return this.shade;
  }

  setColor(color: string): this {
    this.shade = color;
    this.glyphs.setTint(tintOf(color));
    return this;
  }

  /** A background behind the whole text, or none. */
  setBackgroundColor(color: string | null): this {
    if (color) this.back.setFillStyle(tintOf(color)).setVisible(true);
    else this.back.setVisible(false);
    return this;
  }

  /** Which point of the text sits at its position, as with `Text`: 0 the left or top, 1 the right or bottom. */
  setOrigin(x: number, y = x): this {
    this.anchor.x = x;
    this.anchor.y = y;
    return this.layout();
  }

  /** Clickable over the text and its background, wherever the origin puts them. */
  override setInteractive(config: { useHandCursor?: boolean } = {}): this {
    super.setInteractive({
      ...config,
      hitArea: new Phaser.Geom.Rectangle(0, 0, 1, 1),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    });
    return this.layout();
  }

  private layout(): this {
    const lines = this.glyphs.text.split('\n').length;
    const width = Math.ceil(this.glyphs.getTextBounds().local.width);
    // A pixel above the glyphs, so a background frames capitals as evenly as descenders.
    const height = lines * FONT_LINE + 1;
    const left = -Math.round(this.anchor.x * width);
    const top = -Math.round(this.anchor.y * height);
    this.glyphs.setPosition(left, top + 1);
    this.back.setPosition(left, top).setSize(width, height);
    this.setSize(width, height);
    // The hit test adds half the size to the point (a container's origin is its middle).
    const hit = this.input?.hitArea as Phaser.Geom.Rectangle | undefined;
    hit?.setTo(left + width / 2, top + height / 2, width, height);
    return this;
  }
}

/** Adds text in the pixel font to a scene, where `scene.add.text` added a `Text`. */
export function addPixelText(scene: Phaser.Scene, config: PixelTextConfig): PixelText {
  return scene.add.existing(new PixelText(scene, config));
}
