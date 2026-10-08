# The assets

Every asset the game needs, with what each must show and a ready-to-paste Claude Desktop prompt. Read the [art guide](README.md) first: the palette codes, the style rules, the formats and the workflow are there, and the prompts assume Claude has the guide in its project knowledge.

**Priority.** Batch 1 is the heroes' `idle`, `walk` and `work`. The order of the batches is in issue #223, and the status list is at the end.

## The prompt templates

Every prompt below starts with one of these, filled in. Paste the template, then the asset's own lines.

### Template G: a pixel grid

```text
Draw pixel art for Quest for Ibitsa, following the art guide in this project exactly
(Endesga 32 codes only, three-quarter top-down, light from the top left, 1 px dark
outline on characters, no anti-aliasing, facing right).

Asset: <ASSET>
Size: <W>x<H> per frame, <N> frames, laid out in this order: <FRAMES>
What it shows: <DESCRIPTION>
Must match: <REFERENCE>

Reply with only one code block in the guide's .grid format:
size <W>x<H>
frames <N>
then each frame as a line of --- followed by exactly <H> lines of exactly <W>
characters (palette codes or . for transparent). Nothing before or after the block.
```

Then ask: *"Render that grid as an HTML artifact at 10× scale, frames side by side on a checkerboard."*

### Template S: an SVG

```text
Draw pixel art for Quest for Ibitsa as an SVG, following the art guide in this project
exactly (Endesga 32 hex values only, three-quarter top-down, light from the top left,
no gradients, filters, images, text or masks, shape-rendering="crispEdges", shapes on
whole pixels).

Asset: <ASSET>
Size: width="<W>" height="<H>" viewBox="0 0 <W> <H>"
What it shows: <DESCRIPTION>
Must match: <REFERENCE>

Reply with only one code block containing the SVG. Nothing before or after it.
```

For **References**, paste the approved grid it must match (usually the character's `idle` frame 1), and add *"keep these colours and shapes identical"*.

---

## Characters on the map

**Files:** `art/characters/<char>/<animation>.grid`, each 16×16 with 4 frames. Feet on the bottom row, centred around x = 8. The animation frames are in the guide's table.

**Who needs what:**

- **Heroes:** `hero-paladin`, `hero-barbarian`, `hero-ranger`, `hero-rogue`. Each needs `idle`, `walk`, `work`, `test`, `ask`, `blocked`, `rest`, `celebrate`, `hurt` and `outOfGold`.
- **Councillors:** `councillor-elder`, `councillor-architect`, `councillor-security`, `councillor-tester`, `councillor-accessibility`, `councillor-designer` and `councillor-default`. Each needs `idle`, `walk`, `work` (taking notes on a scroll) and `review`.

**The reference first.** Before any animation, draw each character's **reference** with Template G:

```text
Asset: <character>, map reference (the first frame of idle)
Size: 16x16 per frame, 1 frame
What it shows: <the character's row from the guide: look, colours, prop>, standing
facing right, feet on the bottom row, centred. One strong silhouette; the prop
clearly visible.
Must match: (nothing yet)
```

When it's right, keep it: it's the **Must match** of every other asset for that character.

**Then each animation**, with Template G:

```text
Asset: <character>, map animation <animation>
Size: 16x16 per frame, 4 frames, laid out in this order: <the animation's 4 frames from the guide>
What it shows: <the character> doing <animation>. Change only the pixels the motion needs.
Must match: <paste the reference grid> — keep the head, colours and outfit identical.
```

**Checklist for each animation:**

- [ ] only Endesga 32 codes, with transparent background;
- [ ] 4 frames, each 16×16;
- [ ] feet on row 15 in every frame (except in a jump);
- [ ] the head and the colours match the reference;
- [ ] it reads at 1× size;
- [ ] it loops smoothly. `celebrate` and `hurt` play once and end on a neutral pose.

## Council figures (48×48)

**Files:** `art/characters/<char>/council/<animation>.grid`, each 48×48 with 4 frames. Feet on the bottom row (y = 47), centred around x = 24.

**Who:** the seven councillors above. **Animations:** `idle`, `talk`, `think`, `raiseHand`, `write` and `walk`, with frames as in the guide.

**Full body, head to feet.** The hut's table covers the lower third in the game, but you draw the whole figure. Hands that write or gesture stay above y ≈ 30, so they show over the table.

**The council reference first**, with Template G:

```text
Asset: <councillor>, council reference (the first frame of idle)
Size: 48x48 per frame, 1 frame
What it shows: the same character as the 16x16 reference below, drawn full-body,
head to feet, three times bigger: a real face, hands and their prop, in the same
colours. Standing facing right, three-quarter view, feet on the bottom row, centred.
Must match: <paste the 16x16 map reference> — same colours, outfit and prop.
```

**Then each pose:**

```text
Asset: <councillor>, council animation <animation>
Size: 48x48 per frame, 4 frames, laid out in this order: <the pose's frames from the guide>
What it shows: <the councillor> doing <animation> at the council table (the table
hides their lower third; keep hands above y=30). Change only the pixels the motion needs.
Must match: <paste the 48x48 council reference> — keep the face, colours and outfit identical.
```

**Checklist:**

- [ ] full body in every frame (not a torso);
- [ ] feet on row 47 (`walk` steps along it);
- [ ] it matches the map sprite's colours;
- [ ] the hands for `write` and `talk` are above y = 30.

## Portraits (64×64)

**Files:** `art/portraits/<char>.svg` (or `.grid`), for the four heroes and seven councillors.

With Template S:

```text
Asset: <character>, portrait
Size: width="64" height="64" viewBox="0 0 64 64"
What it shows: head and shoulders of <the character>, turned three-quarters to the
right, neutral and friendly expression, their prop or emblem visible at the shoulder,
transparent background. The most detailed version of the character.
Must match: <paste the council reference (councillors) or the map reference (heroes)> — same colours.
```

**Checklist:**

- [ ] transparent background;
- [ ] it reads as the same character at a glance;
- [ ] after the build, still clear (check the generated PNG, not the SVG preview).

## The map

### Water

**File:** `art/map/water.grid`, 16×16, 4 frames.

With Template G:

```text
Asset: sea water tile
Size: 16x16 per frame, 4 frames: a gentle shimmer loop
What it shows: clear turquoise Mediterranean water from above (mostly h, highlights
i and j, depth g), a few small wave glints that drift between frames. It must tile
seamlessly on every side: the left column continues the right, the top row the
bottom, in every frame. No outline.
Must match: (nothing)
```

**Checklist:**

- [ ] a 3×3 grid of it shows no seams;
- [ ] it's calm: it moves 4 times a second across the whole sea, so keep the motion small.

### Island pieces

**Files:** `art/map/island-left.grid` (48×96), `island-middle.grid` (32×96), `island-right.grid` (48×96).

An island is drawn left end, then the middle repeated, then the right end. The pieces must join seamlessly: the middle's right edge continues its own left edge, and both ends meet it.

With Template G, one piece at a time, starting with the middle:

```text
Asset: island, <left end | middle | right end> piece
Size: <48|32>x96 per frame, 1 frame
What it shows: a top-down Mediterranean island strip: a sand rim (2, 3), a green
middle (c, d) with a couple of small olive trees and rocks, a soft shore line where
it meets the water. Outside the island is transparent (the sea shows through). The
middle piece repeats sideways; the left end rounds off the island's left side, the
right end its right side.
Must match: <for the ends: paste the approved middle piece> — the rows at the seam
must continue it exactly.
```

**Checklist:**

- [ ] left + middle × 3 + right forms one island with no seams;
- [ ] transparent outside;
- [ ] nothing important sits near the top middle: task points are drawn there.

### Task points

**Files:** `art/map/task-points/locked.grid`, `active.grid`, `done.grid` and `underReview.grid`, each 16×16, 1 frame.

With Template G:

```text
Asset: task point, <state>
Size: 16x16 per frame, 1 frame
What it shows: a small round stone marker set in the ground, seen from above.
locked: grey and dim (l, m). active: a lit beacon, gold glow (a, b). done: a green
pennant planted on it (c, d). underReview: amber with a small magnifier glyph (9, a).
Must match: <paste the approved locked marker> — the same stone shape for all four.
```

### Bridge

**Files:** `art/map/bridge/lowered.grid` and `raised.grid`, each 48×24, 1 frame. Each is a left post (8 px), a deck segment that repeats (32 px) and a right post (8 px), side by side.

```text
Asset: drawbridge, <lowered | raised>
Size: 48x24 per frame, 1 frame
What it shows: a wooden drawbridge between two islands, seen from above: an 8 px
post with a rope at the left, a 32 px plank deck (5, v, 6) that repeats sideways, an
8 px post at the right. lowered: the deck lies flat across. raised: the deck tilted
up, shorter, with the water (transparent) showing beneath.
Must match: <for raised: paste the approved lowered> — same posts.
```

### Markers

**Files:** `art/map/markers/padlock.grid`, `behind.grid`, `magnifier.grid` and `hourglass.grid`, each 12×12, 1 frame. They float over heroes on the map, so give them a 1 px dark outline.

```text
Asset: map marker, <kind>
Size: 12x12 per frame, 1 frame
What it shows: padlock: a gold padlock (a, b). behind: a small wave with an arrow
pointing back (h, j), for an island waiting on the one before. magnifier: a
magnifying glass (k, l with a j glint). hourglass: a sand hourglass (2, a, 5).
1 px dark outline, transparent background.
```

## Buildings

### Council hut

**File:** `art/buildings/hut.grid`, 64×64. The building in Home Village where the council meets.

```text
Asset: council hut
Size: 64x64 per frame, 1 frame
What it shows: a round white-washed hut (j, k) with a terracotta dome roof (1, 0), a
blue wooden door (g, h) facing the viewer, a small window, an olive tree beside it,
a sandy patch of ground (2). Three-quarter top-down. Transparent around it.
```

### Guild Hall

**File:** `art/buildings/guild-hall.grid`, 48×48.

```text
Asset: Guild Hall
Size: 48x48 per frame, 1 frame
What it shows: a sturdy stone hall (l, k) with a terracotta roof, a wide door, a
banner with a compass rose (h, j) hanging beside the door. Three-quarter top-down.
Transparent around it.
```

## UI

### Dialogue frame

**File:** `art/ui/dialogue-frame.grid`, 24×24. It's stretched by 9-slice with an inset of 8: the 8 px corners stay as drawn, and the edges and middle stretch.

```text
Asset: dialogue box frame (9-slice, inset 8)
Size: 24x24 per frame, 1 frame
What it shows: a parchment panel (2, u) with a dark wooden border (5, 6) and small
gold corner studs (a). The middle 8x8 is plain parchment, and the edges between the
corners are plain border, so they stretch cleanly.
```

### Activity icons

**Files:** `art/ui/activity/read.grid`, `search.grid`, `edit.grid`, `test.grid`, `run.grid`, `think.grid` and `other.grid`, each 12×12, 1 frame. They show beside a working hero.

```text
Asset: activity icon, <kind>
Size: 12x12 per frame, 1 frame
What it shows: read: an open book. search: a sailor's spyglass. edit: a quill.
test: a glass flask with liquid. run: a gear. think: a thought cloud. other: three
dots. 1 px dark outline, transparent background, readable at 1x.
```

## Scenes

### Hut interior

**Files:** `art/scenes/hut-interior.svg` and `art/scenes/hut-table.svg`, each 480×270. The council's room: the background behind the councillors, and the table drawn in front of them.

The **table line** is at y = 176. The table's top edge sits there, and the councillors stand behind it, their feet at y = 192 (confirmed in #219). They come in through the door on the left, around x = 16, so keep that part of the wall a door.

**`hut-interior.svg`** (Template S):

```text
Asset: council hut interior, background (no table)
Size: width="480" height="270" viewBox="0 0 480 270"
What it shows: inside the round white-washed hut: curved plaster wall (j, k) with
dark wooden beams (5, 6), a round window showing the turquoise sea (h, i), sea charts
and a compass rose pinned to the wall, a shelf of scrolls, a hanging lantern (a, b),
a terracotta-tiled floor (1, 0, 4) from y=176 down. The door on the left (the
councillors walk in through it). Leave the middle band around y=120-200 calm: the
councillors stand there.
```

**`hut-table.svg`** (Template S):

```text
Asset: council hut table, foreground layer
Size: width="480" height="270" viewBox="0 0 480 270"
What it shows: only the long wooden council table across the front of the room:
its top edge at y=176 from x=24 to x=456, a lighter top surface (v, 3) and a darker
front (5, 6) down to about y=230, an open Book of Decisions on it near the middle.
Everything else is transparent: the room and the councillors show through.
```

### Home Village

**File:** `art/scenes/village.svg` (or `.grid`), 128×96, 1 frame. The whole village island in one picture, at the size of an island with one middle piece: it replaces the plain island the village stands on. The council hut and the Guild Hall are their own images, drawn on top of it.

**The picture's layout.** Coordinates are inside the picture, (0, 0) at the top left:

| What | Where | So |
|---|---|---|
| Ground (sand rim, grass) | rows 0–63 | as on the island pieces, so the village matches the other islands |
| Cliff | rows 64–85 | as on the island pieces |
| Foam where it meets the sea | rows 86–95 | as on the island pieces; transparent outside the island's outline |
| Guild Hall (drawn on top) | x 6–53, rows −14 to 33 | hidden by the building; plain ground is enough |
| Council hut (drawn on top) | x 56–119, rows −30 to 33 | hidden by the building; plain ground is enough |
| The hut's door | (88, 32) | heroes come out here |
| Heroes waiting for their island | feet at x 32–68, rows 36 and 48 | keep that patch open ground, no props |
| Paths to the islands | from (88, 36) to the right edge | a sandy path there looks right; the game draws its dotted paths over it |
| "HOME VILLAGE" (drawn by the game) | rows 70–78, x 22 to about 100 | keep that band of cliff plain, so the text reads |

**Props** go in the open ground that's left: the left side (x 0–28, rows 36–62) and the right side (x 76–127, rows 40–62). For example, an olive tree or two, a stone well, a small jetty with a moored boat at the right edge, and a few flower pots.

With Template S:

```text
Asset: Home Village island
Size: width="128" height="96" viewBox="0 0 128 96"
What it shows: a small Mediterranean village island from above, three-quarter view.
Rows 0-63: ground with a sand rim (2, 3) and grass (c, d). Rows 64-85: a cliff face
(5, 4, 6). Rows 86-95: white foam (j, k) where it meets the sea. Transparent outside
the island's rounded outline. A sandy path from (88,36) to the right edge. Keep the
top band (rows 0-33 from x=6 to x=119) plain grass: two buildings stand there. Keep
x 32-76, rows 30-56 open ground: heroes wait there. Keep rows 70-78 of the cliff
plain: the game writes the village's name there. Props in the open ground: an olive
tree or two (d, e, 5), a stone well (l, k), a small jetty with a moored boat at the
right edge (5, v, h), a few terracotta flower pots (1, 0).
Must match: <paste the approved island middle piece> — the same sand, grass, cliff and foam.
```

**Checklist:**

- [ ] 128×96, transparent outside the island;
- [ ] the ground, cliff and foam rows line up with the island pieces;
- [ ] the hero patch and the label band are clear;
- [ ] in the game, the hut and the Guild Hall stand on it naturally.

### Ibitsa

**File:** `art/scenes/ibitsa.svg` (or `.grid`), 48×32, 1 frame. The legendary island on the far horizon, out of reach. The game draws its name above it, shows it at 70% opacity, and fades it to almost nothing in its own mist when the heroes sail for it. Its base sits on the bottom row, centred.

With Template S:

```text
Asset: Ibitsa, on the horizon
Size: width="48" height="32" viewBox="0 0 48 32"
What it shows: a distant island silhouette seen from far away across the sea: tall
pale cliffs rising from the water, a small white town on top catching the light, one
slender tower. Soft and pale, low contrast (k, l, j, with m for the shadowed side),
no outline, no detail smaller than 2 px. Its base on the bottom row, centred;
transparent around it.
Must match: (nothing)
```

**Checklist:**

- [ ] 48×32, transparent around it, its base on the bottom row;
- [ ] pale and soft: it should look far away, and still read at 70% opacity.
---

## Status

Tick each file as it lands (issue #223 tracks the batches). Generated from the lists above.

### Batch 1: heroes, required animations (done)

- [x] `art/characters/hero-paladin/idle.grid`
- [x] `art/characters/hero-paladin/walk.grid`
- [x] `art/characters/hero-paladin/work.grid`
- [x] `art/characters/hero-barbarian/idle.grid`
- [x] `art/characters/hero-barbarian/walk.grid`
- [x] `art/characters/hero-barbarian/work.grid`
- [x] `art/characters/hero-ranger/idle.grid`
- [x] `art/characters/hero-ranger/walk.grid`
- [x] `art/characters/hero-ranger/work.grid`
- [x] `art/characters/hero-rogue/idle.grid`
- [x] `art/characters/hero-rogue/walk.grid`
- [x] `art/characters/hero-rogue/work.grid`
- [x] `art/portraits/hero-paladin.svg`
- [x] `art/portraits/hero-barbarian.svg`
- [x] `art/portraits/hero-ranger.svg`
- [x] `art/portraits/hero-rogue.svg`

### Batch 2: the elder and councillors on the map, and their portraits (done)

- [x] `art/characters/councillor-elder/idle.grid`
- [x] `art/characters/councillor-elder/walk.grid`
- [x] `art/characters/councillor-elder/work.grid`
- [x] `art/characters/councillor-architect/idle.grid`
- [x] `art/characters/councillor-architect/walk.grid`
- [x] `art/characters/councillor-architect/work.grid`
- [x] `art/characters/councillor-security/idle.grid`
- [x] `art/characters/councillor-security/walk.grid`
- [x] `art/characters/councillor-security/work.grid`
- [x] `art/characters/councillor-tester/idle.grid`
- [x] `art/characters/councillor-tester/walk.grid`
- [x] `art/characters/councillor-tester/work.grid`
- [x] `art/characters/councillor-accessibility/idle.grid`
- [x] `art/characters/councillor-accessibility/walk.grid`
- [x] `art/characters/councillor-accessibility/work.grid`
- [x] `art/characters/councillor-designer/idle.grid`
- [x] `art/characters/councillor-designer/walk.grid`
- [x] `art/characters/councillor-designer/work.grid`
- [x] `art/characters/councillor-default/idle.grid`
- [x] `art/characters/councillor-default/walk.grid`
- [x] `art/characters/councillor-default/work.grid`
- [x] `art/portraits/councillor-elder.svg`
- [x] `art/portraits/councillor-architect.svg`
- [x] `art/portraits/councillor-security.svg`
- [x] `art/portraits/councillor-tester.svg`
- [x] `art/portraits/councillor-accessibility.svg`
- [x] `art/portraits/councillor-designer.svg`
- [x] `art/portraits/councillor-default.svg`

### Batch 3: council figures (48×48)

- [ ] `art/characters/councillor-elder/council/idle.grid`
- [ ] `art/characters/councillor-elder/council/talk.grid`
- [ ] `art/characters/councillor-elder/council/think.grid`
- [ ] `art/characters/councillor-elder/council/raiseHand.grid`
- [ ] `art/characters/councillor-elder/council/write.grid`
- [ ] `art/characters/councillor-architect/council/idle.grid`
- [ ] `art/characters/councillor-architect/council/talk.grid`
- [ ] `art/characters/councillor-architect/council/think.grid`
- [ ] `art/characters/councillor-architect/council/raiseHand.grid`
- [ ] `art/characters/councillor-architect/council/write.grid`
- [ ] `art/characters/councillor-security/council/idle.grid`
- [ ] `art/characters/councillor-security/council/talk.grid`
- [ ] `art/characters/councillor-security/council/think.grid`
- [ ] `art/characters/councillor-security/council/raiseHand.grid`
- [ ] `art/characters/councillor-security/council/write.grid`
- [ ] `art/characters/councillor-tester/council/idle.grid`
- [ ] `art/characters/councillor-tester/council/talk.grid`
- [ ] `art/characters/councillor-tester/council/think.grid`
- [ ] `art/characters/councillor-tester/council/raiseHand.grid`
- [ ] `art/characters/councillor-tester/council/write.grid`
- [ ] `art/characters/councillor-accessibility/council/idle.grid`
- [ ] `art/characters/councillor-accessibility/council/talk.grid`
- [ ] `art/characters/councillor-accessibility/council/think.grid`
- [ ] `art/characters/councillor-accessibility/council/raiseHand.grid`
- [ ] `art/characters/councillor-accessibility/council/write.grid`
- [ ] `art/characters/councillor-designer/council/idle.grid`
- [ ] `art/characters/councillor-designer/council/talk.grid`
- [ ] `art/characters/councillor-designer/council/think.grid`
- [ ] `art/characters/councillor-designer/council/raiseHand.grid`
- [ ] `art/characters/councillor-designer/council/write.grid`
- [ ] `art/characters/councillor-default/council/idle.grid`
- [ ] `art/characters/councillor-default/council/talk.grid`
- [ ] `art/characters/councillor-default/council/think.grid`
- [ ] `art/characters/councillor-default/council/raiseHand.grid`
- [ ] `art/characters/councillor-default/council/write.grid`

### Batch 4: the map

- [ ] `art/map/water.grid`
- [ ] `art/map/island-left.grid`
- [ ] `art/map/island-middle.grid`
- [ ] `art/map/island-right.grid`
- [ ] `art/map/task-points/locked.grid`
- [ ] `art/map/task-points/active.grid`
- [ ] `art/map/task-points/done.grid`
- [ ] `art/map/task-points/underReview.grid`
- [ ] `art/map/bridge/lowered.grid`
- [ ] `art/map/bridge/raised.grid`
- [ ] `art/map/markers/padlock.grid`
- [ ] `art/map/markers/behind.grid`
- [ ] `art/map/markers/magnifier.grid`
- [ ] `art/map/markers/hourglass.grid`

### Batch 5: buildings and UI

- [ ] `art/buildings/hut.grid`
- [ ] `art/buildings/guild-hall.grid`
- [ ] `art/ui/dialogue-frame.grid`
- [ ] `art/ui/activity/read.grid`
- [ ] `art/ui/activity/search.grid`
- [ ] `art/ui/activity/edit.grid`
- [ ] `art/ui/activity/test.grid`
- [ ] `art/ui/activity/run.grid`
- [ ] `art/ui/activity/think.grid`
- [ ] `art/ui/activity/other.grid`

### Batch 6: scenes

- [ ] `art/scenes/hut-interior.svg`
- [ ] `art/scenes/hut-table.svg`
- [ ] `art/scenes/village.svg`
- [ ] `art/scenes/ibitsa.svg`

### Batch 7: extra poses

- [ ] `art/characters/councillor-elder/council/walk.grid`
- [ ] `art/characters/councillor-architect/council/walk.grid`
- [ ] `art/characters/councillor-security/council/walk.grid`
- [ ] `art/characters/councillor-tester/council/walk.grid`
- [ ] `art/characters/councillor-accessibility/council/walk.grid`
- [ ] `art/characters/councillor-designer/council/walk.grid`
- [ ] `art/characters/councillor-default/council/walk.grid`
- [x] `art/characters/councillor-elder/review.grid`
- [x] `art/characters/councillor-architect/review.grid`
- [x] `art/characters/councillor-security/review.grid`
- [x] `art/characters/councillor-tester/review.grid`
- [x] `art/characters/councillor-accessibility/review.grid`
- [x] `art/characters/councillor-designer/review.grid`
- [x] `art/characters/councillor-default/review.grid`
- [x] `art/characters/hero-paladin/test.grid`
- [x] `art/characters/hero-paladin/ask.grid`
- [x] `art/characters/hero-paladin/blocked.grid`
- [x] `art/characters/hero-paladin/rest.grid`
- [x] `art/characters/hero-paladin/celebrate.grid`
- [x] `art/characters/hero-paladin/hurt.grid`
- [x] `art/characters/hero-paladin/outOfGold.grid`
- [x] `art/characters/hero-barbarian/test.grid`
- [x] `art/characters/hero-barbarian/ask.grid`
- [x] `art/characters/hero-barbarian/blocked.grid`
- [x] `art/characters/hero-barbarian/rest.grid`
- [x] `art/characters/hero-barbarian/celebrate.grid`
- [x] `art/characters/hero-barbarian/hurt.grid`
- [x] `art/characters/hero-barbarian/outOfGold.grid`
- [x] `art/characters/hero-ranger/test.grid`
- [x] `art/characters/hero-ranger/ask.grid`
- [x] `art/characters/hero-ranger/blocked.grid`
- [x] `art/characters/hero-ranger/rest.grid`
- [x] `art/characters/hero-ranger/celebrate.grid`
- [x] `art/characters/hero-ranger/hurt.grid`
- [x] `art/characters/hero-ranger/outOfGold.grid`
- [x] `art/characters/hero-rogue/test.grid`
- [x] `art/characters/hero-rogue/ask.grid`
- [x] `art/characters/hero-rogue/blocked.grid`
- [x] `art/characters/hero-rogue/rest.grid`
- [x] `art/characters/hero-rogue/celebrate.grid`
- [x] `art/characters/hero-rogue/hurt.grid`
- [x] `art/characters/hero-rogue/outOfGold.grid`

### Licence

- [ ] `ATTRIBUTION.md`: the tool and its terms
