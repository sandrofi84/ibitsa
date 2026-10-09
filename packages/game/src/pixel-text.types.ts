/** Where text in the pixel font starts, what it says, its colour and any background (CSS `#rrggbb`). */
export interface PixelTextConfig {
  x: number;
  y: number;
  text: string;
  color: string;
  background?: string;
}
