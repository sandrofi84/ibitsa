# Phaser vs PixiJS in a VS Code webview

Research for [#5](https://github.com/sandrofi84/ibitsa/issues/5). Researched 2026-10-04 against `phaser@4.2.1` and `pixi.js@8.22.0`, the latest stable releases on npm on that date.

## Answer

**Use Phaser 4.** It has built-in support for every engine feature §9.1, §9.2 and §7 need: integer zoom with centering (letterboxing), Tiled tilemaps, sprite-sheet animation, and a scene manager that can run scenes in parallel. It also runs under a strict CSP without `unsafe-eval` and needs no extra setup for that. PixiJS is a renderer, not a game framework. With Pixi we would write the scaling and scene management ourselves, and we would rely on a community tilemap package (`@pixi/tilemap`) and on Pixi's opt-in `unsafe-eval` shim, which has open CSP bugs. Pixi's advantages are a smaller bundle (about half the size) and more frequent releases. The bundle size barely matters here because the webview loads it from local disk. The release cadence is the main risk with Phaser: v4.0.0 shipped only in April 2026.

## Comparison

| Criterion | Phaser 4.2.1 | PixiJS 8.22.0 |
|---|---|---|
| Strict CSP, no `unsafe-eval` | Works with no setup. The single `new Function` call in the bundle can't run in a modern browser (see below). | You must `import 'pixi.js/unsafe-eval'`, or `init()` throws. Open bugs exist in that shim. |
| Other CSP needs | `data:` images for built-in textures and feature checks (can be overridden) | A `blob:` worker for texture loading (can be turned off) |
| Bundle (minified / gzip) | 1,395 KB / 369 KB (the whole engine; tree-shaking doesn't reduce it) | 636 KB / 185 KB for what we'd use, `@pixi/tilemap` included |
| 480×270 integer scale + letterbox | Built in: `scale.mode NONE` + `zoom: MAX_ZOOM` + `autoCenter: CENTER_BOTH` + `pixelArt: true` | Write it yourself (about 20 lines): compute the integer factor, size the canvas, use `scaleMode 'nearest'` and `roundPixels` |
| Tilemaps | Built in: Tiled JSON, `TilemapLayer`, `TilemapGPULayer` | Community `@pixi/tilemap@5.0.2` (last published July 2025); no Tiled parser |
| Sprite-sheet animation | Built in (`anims.create`, Aseprite import) | Built in (`Spritesheet`, `AnimatedSprite`) |
| Scene management | Built in `SceneManager` (start, stop, sleep, launch in parallel) | None; use `Container`s and your own state machine |
| Vite standalone + HMR | Official `phaserjs/template-vite-ts` (Phaser 4.0.0, Vite 6) | `create-pixi.js` scaffolder |
| Maintenance | 4 stable releases in the last 12 months; v4.0.0 on 2026-04-10; 160 open issues and PRs | 15 stable releases in the last 12 months; 376 open issues and PRs |

## Findings by criterion

### 1. Strict CSP under `asWebviewUri`, no `unsafe-eval`

VS Code's webview guide recommends `default-src 'none'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource}; style-src ${webview.cspSource};`. It also says that by default a webview can load local resources only from the extension's install directory and the open workspace; `localResourceRoots` widens or narrows that. Workers "can only be loaded using either a `data:` or `blob:` URI" ([VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)).

**Phaser**
- I searched `dist/phaser.esm.js` (4.2.1 tarball) and found one `new Function`, inside webpack's global shim. That code runs only when `globalThis` is missing, so it never runs in a modern browser. Two `eval(` matches are inside comments.
- The Texture Manager creates its `__DEFAULT`, `__MISSING` and `__WHITE` textures from `data:image/png;base64` URIs. `CanvasFeatures` probes the browser with a `data:` PNG too. Under `img-src ${cspSource}` alone, those loads are blocked. Two fixes:
  - add `data:` to `img-src` (low risk, because scripts still need the nonce or `cspSource`), or
  - set `images.default`, `images.missing` and `images.white` in the game config to bundled files.

  The second option came out of [phaserjs/phaser#6835](https://github.com/phaserjs/phaser/issues/6835) (closed 2024-07, "implemented"). The maintainer's comment there says the values can be set to `null` or to relative paths.
- The loader accepts any URL that starts with `https://` as-is, so `asWebviewUri` URLs work. The loader uses XHR, so `connect-src ${webview.cspSource}` is needed when `default-src 'none'`.
- The only CSP issue in Phaser's tracker is [#1494](https://github.com/phaserjs/phaser/issues/1494), from 2014 and closed. I found no open issue about CSP or `unsafe-eval`.

**PixiJS**
- By default Pixi 8 builds shader, uniform and UBO sync functions with `new Function`. At startup `AbstractRenderer._unsafeEvalCheck()` throws `"Current environment does not allow unsafe-eval, please use pixi.js/unsafe-eval module to enable support."` (see `lib/rendering/renderers/shared/system/AbstractRenderer.mjs`).
- `import 'pixi.js/unsafe-eval'` swaps in polyfills that don't need eval (`lib/unsafe-eval/init.mjs`). The code generators that use `new Function` still ship in the bundle; 5 occurrences remain in the tree-shaken build.
- Open issues in that path:
  - [#12117](https://github.com/pixijs/pixijs/issues/12117): the UBO polyfill has the wrong arity and uploads all-zero UBOs under a strict CSP, which gives blank WebGPU rendering.
  - [#11388](https://github.com/pixijs/pixijs/issues/11388): BitmapText doesn't render with `unsafe-eval` on WebGPU.
  - [#12059](https://github.com/pixijs/pixijs/issues/12059): request for a CSP-compatible `libktx` build.

  Both rendering bugs are on WebGPU, so we would force `preference: 'webgl'`.
- Texture loading uses a `Worker` built from a `blob:` URL (`WorkerManager`, `preferWorkers: true` by default). Either allow `worker-src blob:` or call `Assets.setPreferences({ preferWorkers: false })`.

### 2. Bundle size

The numbers come from the published tarballs and from bundling a minimal app with esbuild (`--bundle --minify --format=esm`) and gzip -9.

| | min | gzip |
|---|---|---|
| `phaser/dist/phaser.esm.min.js` | 1,377,611 B | 353 KB |
| Phaser app (`new Phaser.Game({pixelArt:true})`) | 1,395,151 B | 369 KB |
| `pixi.js/dist/pixi.min.mjs` (everything) | 841,319 B | 237 KB |
| Pixi app: unsafe-eval, Application, Assets, Sprite, AnimatedSprite, BitmapText, `@pixi/tilemap` | 635,601 B | 185 KB |

Phaser's `exports` point at a single prebuilt webpack bundle, so the bundler can't drop unused modules. Pixi publishes per-module ESM with `sideEffects` declared, so it can. The VSIX loads the bundle from disk through `asWebviewUri`, so the extra ~0.75 MB costs a bit of VSIX size and parse time, not download time.

### 3. Pixel-perfect integer scaling of 480×270 with letterboxing

**Phaser:** use `scale: { mode: Phaser.Scale.NONE, zoom: Phaser.Scale.MAX_ZOOM, autoCenter: Phaser.Scale.CENTER_BOTH }` with `pixelArt: true`.
- `pixelArt` sets nearest-neighbour filtering and turns off antialiasing.
- `getMaxZoom()` in `src/scale/ScaleManager.js` returns `max(min(floor(parentW/480), floor(parentH/270)), 1)`. The result is always an integer, and centering produces the letterbox.
- Catch: `MAX_ZOOM` is calculated only once, in `boot`. On a panel resize, call `scale.setMaxZoom()` again from a `ResizeObserver`.
- v4 turned `roundPixels` off by default and limits it to axis-aligned, unscaled objects (v4.0.0 changelog, "Round Pixels"). Turn it on for camera and sprites.
- There is also `snap` (added in v3.80).

**Pixi:** there is no scale manager. Render at 480×270 and set:
- `TextureSource.defaultOptions.scaleMode = 'nearest'`
- `roundPixels: true`
- canvas CSS size = 480·k × 270·k, with k = the integer factor, centred, plus `image-rendering: pixelated`

That is a small amount of code, but we would own it.

### 4. Tilemaps and sprite-sheet animation

**Phaser:**
- Built-in `Tilemaps.Tilemap` with Tiled JSON and CSV support.
- `TilemapLayer`, plus the new v4 `TilemapGPULayer`, which renders a whole layer as one quad.
- Animations via `anims.create`, `generateFrameNumbers` and `createFromAseprite`.
- Phaser has no runtime support for animated tiles (our 4-frame water loop). Either animate the tile layer by hand or draw water with a sprite or `TileSprite`. I didn't check for a v4-compatible plugin.

**Pixi:**
- `Spritesheet` (TexturePacker JSON) and `AnimatedSprite` are in core.
- Tilemaps need `@pixi/tilemap@5.0.2`: peer dependency `pixi.js >=8.5.0`, last published 2025-07-14, repo `pixijs-userland/tilemap` with 331 stars and 51 open issues.
- No Tiled loader is included.

### 5. Scene management (village, world map, hut interior)

**Phaser:** `SceneManager` and `ScenePlugin` (`start`, `stop`, `sleep`, `wake`, `launch` to run in parallel). This matches §7.1's screens directly: the world map as one scene, the hut interior as another, and a UI and dialogue overlay launched in parallel.

**Pixi:** there are no scenes. The usual pattern is one `Container` per screen plus a small state machine of our own.

### 6. Vite HMR for standalone development (§13)

Both work with Vite. The game module's state isn't hot-swapped in either engine: an edit reloads the page, or you call `game.destroy(true)` and `app.destroy()` in `import.meta.hot.dispose` and recreate. That fits §13's plan, because state comes back from the fake core's replayed event log.

- **Phaser:** maintains `phaserjs/template-vite-ts`. It pins `phaser 4.0.0` and `vite ^6.3.1`; the repo was last pushed 2026-04-21.
- **Pixi:** ships the `create-pixi.js` scaffolder (1.4.0).

### 7. Maintenance health

From `npm view <pkg> time` and the GitHub API on 2026-10-04:

| | Phaser | PixiJS |
|---|---|---|
| Latest | 4.2.1 (2026-07-09) | 8.22.0 (2026-10-01) |
| Stable releases, last 12 months | 4 (4.0.0, 4.1.0, 4.2.0, 4.2.1) | 15 |
| Gap before v4 | 3.90.0 (2025-05) → 4.0.0 (2026-04): about 11 months with no stable release | n/a |
| Stars / open issues and PRs | 40.4k / 160 | 48.3k / 376 |
| Last push | 2026-08-21 | 2026-10-03 |
| License | MIT | MIT |

Phaser v4 replaced the whole renderer ("render nodes"), deprecated the Canvas renderer, and unified FX and masks into filters. Most community examples and plugins target v3, so expect gaps in docs and ecosystem. Pixi 8 is mature and ships about monthly.

## Recommendation

Use **Phaser 4**: `packages/game` with Vite, WebGL renderer, `pixelArt: true`, `Scale.NONE` + `MAX_ZOOM` + `CENTER_BOTH`, and `setMaxZoom()` re-run on resize. The webview CSP would be:

```
default-src 'none';
img-src ${cspSource} data:;
script-src 'nonce-…' ${cspSource};
style-src ${cspSource};
connect-src ${cspSource};
media-src ${cspSource};
font-src ${cspSource}
```

Alternatively, drop `data:` from `img-src` and point `images.default`, `images.missing` and `images.white` at bundled PNGs.

The reason: Phaser covers scaling, tilemaps, animation and scenes out of the box, and it runs eval-free with no setup. With Pixi we would write a scene system, a scaler and Tiled loading ourselves, and we would depend on a CSP shim with open bugs. The bundle-size difference doesn't matter for a webview that loads from local disk.

Switch to Pixi only if the early Phaser 4 releases prove unstable in the first game spike. The engine-neutral `protocol` boundary (§11.2) keeps that swap contained to `packages/game`.

## Not verified

- Neither engine was run inside a real VS Code webview. The CSP findings come from reading the source and the issues. A one-hour spike is still needed to confirm there are no CSP violations in the console and that `asWebviewUri` loading works for both PNG and audio.
- Whether `images.*: null` (as opposed to a path) is accepted in Phaser 4.2.1. Only the maintainer comment in #6835 says so.
- Whether a CSP-blocked `data:` probe in Phaser's `CanvasFeatures` only degrades a feature flag or causes a visible error.
- Pixi's behaviour when `new Worker(blob:)` is blocked and `preferWorkers` is left on (it may throw or may fall back).
- Bundlephobia itself was not consulted. The sizes are my own esbuild and gzip measurements of the published tarballs.
- Whether any Phaser 4 plugin supports animated Tiled tiles.
