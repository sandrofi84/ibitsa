import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ANIMATIONS,
  activityIcons,
  bridge,
  CHARACTERS,
  characterSheet,
  councilSheet,
  dialogueFrame,
  engineTextures,
  FRAMES,
  hut,
  island,
  markers,
  portrait,
  TILE_INDEX,
  taskPoints,
  tiles,
} from './art.ts';
import type { Manifest } from './manifest.schema.ts';
import {
  ACTIVITY_KINDS,
  BRIDGE_FRAMES,
  COUNCIL_ANIMATIONS,
  MARKER_KINDS,
  SPEC,
  TASK_POINT_STATES,
} from './manifest.ts';

/** A councillor's 32×32 council sheet (§9.2): writes the image and returns its manifest entry. */
function councilEntry({
  name,
  files,
  art,
}: {
  name: string;
  files: Record<string, Buffer>;
  art: (typeof CHARACTERS)[number];
}): NonNullable<Manifest['characters'][string]['council']> {
  const sheet = `characters/${name}-council.png`;
  files[sheet] = councilSheet(art).png();
  return {
    sheet,
    frame: { width: SPEC.councilFrame, height: SPEC.councilFrame },
    animations: Object.fromEntries(
      COUNCIL_ANIMATIONS.map((animation, row) => [
        animation,
        { row, frames: FRAMES, fps: animation === 'idle' || animation === 'think' ? 3 : 6 },
      ]),
    ),
  };
}

/** The default pack: manifest plus every image, keyed by path inside the pack. */
export function buildDefaultPack(): { manifest: Manifest; files: Record<string, Buffer> } {
  const files: Record<string, Buffer> = {};
  const characters: Manifest['characters'] = {};
  for (const art of CHARACTERS) {
    const name = art.key.replace('.', '-');
    const sheet = `characters/${name}.png`;
    const face = `portraits/${name}.png`;
    files[sheet] = characterSheet(art).png();
    files[face] = portrait(art).png();
    characters[art.key] = {
      role: art.role,
      sheet,
      frame: { width: SPEC.characterFrame, height: SPEC.characterFrame },
      animations: Object.fromEntries(
        ANIMATIONS.map((animation, row) => [
          animation,
          { row, frames: FRAMES, fps: animation === 'walk' ? 8 : 4 },
        ]),
      ),
      portrait: face,
      ...(art.role === 'councillor' ? { council: councilEntry({ name, files, art }) } : {}),
    };
  }
  files['map/tiles.png'] = tiles().png();
  files['map/island.png'] = island().png();
  files['map/task-points.png'] = taskPoints(TASK_POINT_STATES).png();
  files['map/hut.png'] = hut().png();
  files['ui/activity-icons.png'] = activityIcons(ACTIVITY_KINDS).png();
  files['ui/dialogue-frame.png'] = dialogueFrame().png();
  files['map/bridge.png'] = bridge().png();
  files['ui/markers.png'] = markers().png();

  const manifest: Manifest = {
    name: 'default',
    version: '0.1.0',
    characters,
    tiles: {
      image: 'map/tiles.png',
      tileSize: SPEC.tile,
      tiles: {
        water: { index: TILE_INDEX.water, frames: 4 },
        grass: { index: TILE_INDEX.grass },
        sand: { index: TILE_INDEX.sand },
        shore: { index: TILE_INDEX.shore },
        pathDot: { index: TILE_INDEX.pathDot },
      },
    },
    island: { image: 'map/island.png', ...SPEC.island },
    taskPoints: {
      image: 'map/task-points.png',
      size: SPEC.taskPoint,
      states: [...TASK_POINT_STATES],
    },
    activityIcons: {
      image: 'ui/activity-icons.png',
      size: SPEC.activityIcon,
      kinds: [...ACTIVITY_KINDS],
    },
    bridge: { image: 'map/bridge.png', ...SPEC.bridge, frames: [...BRIDGE_FRAMES] },
    markers: { image: 'ui/markers.png', size: SPEC.marker, kinds: [...MARKER_KINDS] },
    buildings: { hut: { image: 'map/hut.png', width: SPEC.hut, height: SPEC.hut } },
    ui: { dialogueFrame: { image: 'ui/dialogue-frame.png', size: SPEC.dialogueFrame, inset: 8 } },
  };
  return { manifest, files };
}

function writeAll(dir: string, files: Record<string, Buffer | string>): void {
  rmSync(dir, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

export function writeDefaultPack(dir: string): void {
  const { manifest, files } = buildDefaultPack();
  writeAll(dir, { ...files, 'pack.json': `${JSON.stringify(manifest, null, 2)}\n` });
}

export function writeEngineTextures(dir: string): void {
  writeAll(
    dir,
    Object.fromEntries(Object.entries(engineTextures()).map(([name, r]) => [name, r.png()])),
  );
}
