# The art guide

How the art for Quest for Ibitsa is made: the look, the palette, the formats, and the workflow from a prompt in Claude Desktop to a sprite in the game. Every asset has its own entry, with a ready-to-paste prompt, in [assets.md](assets.md). The decisions behind this guide are in the spec (§9.2, §9.5).

## The look

**The setting.** A sunny Mediterranean archipelago. The sea is turquoise and clear, the islands have sandy rims and green, olive-dotted middles, and the buildings are white-washed with terracotta roofs and blue doors. Ibitsa itself is a legend: an island nobody has found.

**The crew.** A small fantasy adventuring party, cheerful rather than grim. They look like people who sail between islands: practical clothes, a little salt-worn, bright accents.

**Style rules.** They hold for every asset:

- **Palette: Endesga 32, and nothing else.** No other colour, no transparency between 0 and 100%.
- **View:** three-quarter top-down. You see the top of heads and the fronts of bodies, as in classic top-down RPGs.
- **Light:** from the top left. Highlights go top-left, shadows bottom-right.
- **Outlines:** characters get a 1 px dark outline (`p` or `6`, or a dark shade of the area it borders). Tiles, terrain and buildings don't.
- **No anti-aliasing.** Every pixel is one palette colour. No blended edges, gradients or dithering.
- **Characters face right.** The game mirrors them for left.
- **Readable at 1×.** A 16×16 sprite must read on the map at its real size: big shapes, one clear prop, strong silhouette. Detail belongs in the 48×48 council figures and the 64×64 portraits.

## The palette

Endesga 32, with the one-character code each colour has in a pixel grid. `.` is transparent.

| Code | Colour | Code | Colour | Code | Colour | Code | Colour |
|---|---|---|---|---|---|---|---|
| `0` | `#be4a2f` rust | `8` | `#e43b44` red | `g` | `#124e89` deep blue | `o` | `#262b44` night |
| `1` | `#d77643` terracotta | `9` | `#f77622` orange | `h` | `#0099db` sea blue | `p` | `#181425` near black |
| `2` | `#ead4aa` sand | `a` | `#feae34` gold | `i` | `#2ce8f5` turquoise | `q` | `#ff0044` hot red |
| `3` | `#e4a672` skin light | `b` | `#fee761` yellow | `j` | `#ffffff` white | `r` | `#68386c` plum |
| `4` | `#b86f50` skin mid | `c` | `#63c74d` leaf green | `k` | `#c0cbdc` light grey | `s` | `#b55088` magenta |
| `5` | `#733e39` brown | `d` | `#3e8948` green | `l` | `#8b9bb4` grey | `t` | `#f6757a` pink |
| `6` | `#3e2731` dark brown | `e` | `#265c42` dark green | `m` | `#5a6988` slate | `u` | `#e8b796` peach |
| `7` | `#a22633` crimson | `f` | `#193c3e` deep teal | `n` | `#3a4466` dusk blue | `v` | `#c28569` tan |

The names are only reminders. The codes and hex values are what count.

**Recolour.** The Armory recolours characters by hue shift and presets (gold, frost, ember, verdant, shadow). Hue shifts work best when a character's main colours are clearly coloured, not grey, so give every character at least one strong accent colour.

## The formats

Each asset is a text file in `art/`. The build (`pnpm --filter @ibitsa/assets generate`) turns it into the PNG the game loads, and falls back to the old code-drawn placeholder for anything not made yet.

### Pixel grid (`.grid`): sprites, tiles, icons, markers

```text
# Lines starting with # are comments.
size 16x16
frames 4
---
................
.....pppppp.....
....p333333p....
(… 16 lines of 16 characters …)
---
(frame 2: 16 more lines)
---
(frame 3)
---
(frame 4)
```

- `size WxH` is the size of **one** frame. `frames N` is optional and defaults to 1.
- Each frame starts with a line of `---`, followed by exactly H lines of exactly W characters.
- Each character is a palette code from the table, or `.` for transparent.
- Frames are laid out left to right in the order written.
- Any mistake (a wrong width, an unknown character, a missing frame) stops the build with the file, frame and line.

### SVG (`.svg`): portraits and scenes

For pieces too big to write pixel by pixel: the 64×64 portraits, the 480×270 hut interior, Home Village and Ibitsa.

- Set `width`, `height` and `viewBox="0 0 W H"` to the exact output size. For several frames, put them side by side, so W is the frame width times the frames.
- Fill and stroke with **palette hex values only**. No gradients, filters, embedded images, text or masks.
- Add `shape-rendering="crispEdges"` on the root element.
- Prefer rectangles and simple polygons on whole pixels; curves end up as stair-steps anyway.
- The build renders it at exactly W×H and snaps every pixel to the nearest palette colour. Anything less than half opaque becomes transparent.

Any asset may be a `.grid` or an `.svg`, not both.

### Where files go

`<char>` is the character's key with a dash: `hero-paladin`, `councillor-elder`, `councillor-security`.

| What | Path | Size |
|---|---|---|
| Map animation | `art/characters/<char>/<animation>.grid` | 16×16, 4 frames |
| Council animation | `art/characters/<char>/council/<animation>.grid` | 48×48, 4 frames |
| Portrait | `art/portraits/<char>.svg` (or `.grid`) | 64×64 |
| Water | `art/map/water.grid` | 16×16, 4 frames |
| Island pieces | `art/map/island-left.grid`, `island-middle.grid`, `island-right.grid` | 48×96, 32×96, 48×96 |
| Task points | `art/map/task-points/<state>.grid` | 16×16 |
| Bridge | `art/map/bridge/lowered.grid`, `raised.grid` | 48×24 |
| Markers | `art/map/markers/<kind>.grid` | 12×12 |
| Buildings | `art/buildings/hut.grid`, `guild-hall.grid` | 64×64, 48×48 |
| Dialogue frame | `art/ui/dialogue-frame.grid` | 24×24 |
| Activity icons | `art/ui/activity/<kind>.grid` | 12×12 |
| Scenes | `art/scenes/hut-interior.svg`, `hut-table.svg`, `village-*.svg`, `ibitsa.svg` | see [assets.md](assets.md) |

## The characters

Each character has one or two colours that are *theirs*, so they stay recognisable at 16 px, in the hut and in their portrait. Skin tones vary across the crew: `u`, `3`, `4`, `v`, `5`.

### Heroes

| Class (model) | Key | Look | Their colours | Prop |
|---|---|---|---|---|
| Paladin (Fable) | `hero.paladin` | white-and-gold plate armour like a sunlit wall, short sea-blue cape, sun emblem | `j` `k` `a` `b`, cape `h` | round shield with a sun |
| Barbarian (Opus) | `hero.barbarian` | broad, bronze-skinned, fur vest, red headband, bare arms | `4` `5` `6`, band `8` | big double-headed axe (`l` `k`) |
| Ranger (Sonnet) | `hero.ranger` | green hood and cloak, leather jerkin, boots | `c` `d` `e`, leather `5` | bow over the shoulder, quiver |
| Rogue (Haiku) | `hero.rogue` | slim, dark plum cloak with a scarf over the lower face, quick | `r` `n` `o`, scarf `s` | two short daggers (`k`) |

### The council

| Councillor | Key | Look | Their colours | Prop |
|---|---|---|---|---|
| The elder | `councillor.elder` | old, long white beard, deep-blue robe with a terracotta sash, a little stooped, kind | `g` `n`, beard `j` `k`, sash `1` | tall staff, a rolled sea chart |
| Architect | `councillor.architect` | ochre work tunic, rolled sleeves, tool belt, calm | `a` `9` `5` | rolled blueprint (`h` with `j` lines) |
| Security | `councillor.security` | chainmail hood, deep-teal tabard with a keyhole emblem, watchful | `f` `e` `l` | ring of keys and a small shield with a lock |
| Tester | `councillor.tester` | lab apron over a green shirt, goggles pushed up on the head, curious | `c` `k` `j` | magnifying glass, a flask (`i`) |
| Accessibility | `councillor.accessibility` | warm orange robe, open friendly stance, a hand often held out | `9` `1` `b` | lantern giving light (`b` `a`) |
| Designer | `councillor.designer` | colourful scarf, a beret, paint-flecked smock | `s` `t` `r`, beret `8` | brush and a palette |
| Any other councillor | `councillor.default` | plain grey-blue robe and hood, neutral, recolours well | `m` `l` `k` | a scroll |

## Animations

Every animation is **4 frames**, drawn facing right.

**On the map (16×16).** Feet sit on the bottom row (y = 15), centred around x = 8. Keep the head and body the same from frame to frame; move only what the animation moves.

| Animation | Frames | Notes |
|---|---|---|
| `idle` | breathe: normal, normal, body 1 px down, normal with a blink | required |
| `walk` | contact (legs apart), passing (legs together, body 1 px up), contact with the other leg forward, passing | required. Sideways only; the game uses it for every direction |
| `work` | busy with the hands in front, using their prop or a tool; the tool goes up, down, up, down | required |
| `test` | lift a flask, shake it, peer at it, lower it | optional; falls back to `work` |
| `ask` | one arm up waving to you: up, wave out, up, wave in | optional; falls back to `idle` |
| `blocked` | arms crossed, slumped, sway a pixel side to side | optional; falls back to `idle` |
| `rest` | sitting on the ground, head nodding slowly | optional; falls back to `idle` |
| `celebrate` | crouch, jump with arms up (2 px up), top of the jump, land | optional; played once when a task is done |
| `hurt` | recoil back, squint, recover, neutral | optional; played once when a test fails |
| `review` | holding a magnifier up and moving it across, as if inspecting | councillors; optional |
| `outOfGold` | pockets turned out, shrug, look down, shrug | optional; falls back to `idle` |

Councillors on the map need `idle`, `walk` and `work` (taking notes), plus `review`. Heroes need all the others.

**In the council hut (48×48).** These are **full-body** figures, head to feet: the same character as on the map, drawn three times bigger with real faces, hands and props. Feet sit on the bottom row (y = 47), centred around x = 24.

The hut's table is drawn **in front** of them as its own layer and hides roughly their lower third. So draw whole bodies, legs included, and keep anything they do with their hands (writing, gesturing) above y ≈ 30.

| Animation | Frames |
|---|---|
| `idle` | breathe and blink, as on the map |
| `talk` | mouth open, closed, open, closed, with one hand gesturing a little |
| `think` | hand to the chin, eyes up; small change between frames (eyes or a finger tap) |
| `raiseHand` | arm rising, raised, small wave, raised |
| `write` | head down, writing in a book on the table; the hand moves along the line |
| `walk` | a sideways walk cycle, as on the map, for coming in through the hut door |

**Portraits (64×64).** Head and shoulders, turned three-quarters to the right, neutral and friendly, on a transparent background. They're the most detailed version of the character.

## Making an asset with Claude Desktop

1. **Start a project for the art** in Claude Desktop and add this guide and [assets.md](assets.md) to the project's knowledge, so every chat sees the palette and the rules.
2. **Draw each character's reference first:** their map `idle` frame 1 at 16×16. Iterate until it's right. Every later prompt for that character pastes this approved grid as the reference, so the colours and shapes stay identical.
3. **Paste the asset's prompt** from [assets.md](assets.md). Each one asks for a single code block in the grid format, nothing else.
4. **Ask for a preview:** "Render that grid as an HTML artifact at 10× scale, frames side by side on a checkerboard." Look at it, and ask for fixes in words ("the cape should be 1 px shorter on frame 3") until it's right.
5. **Save the code block** to the file in `art/` that the entry names.
6. **Build and look:** run `pnpm --filter @ibitsa/assets generate`, then see it in the game (`pnpm --filter @ibitsa/game dev`, or F5 for the extension). If the build stops with an error, it names the file, frame and line: paste that back to Claude.
7. **Tick it off** in the status list at the end of [assets.md](assets.md), and open a PR per batch (spec §9.5; issue #223).

**Tips for consistency:**

- Keep one chat per character, so its reference stays in view.
- Name colours by code in your feedback: "make the cape `h`, not `g`".
- For animations, ask Claude to change *only* the pixels the motion needs, and to keep the head identical across frames.
- For SVG scenes, ask for simple shapes on whole pixels and palette colours only, and check the rendered PNG rather than the SVG preview: the snap to the palette is what the game shows.

## Licence

Record the tool and its terms in `ATTRIBUTION.md` with the first batch. The art is licensed separately from the code (spec §9.5).
