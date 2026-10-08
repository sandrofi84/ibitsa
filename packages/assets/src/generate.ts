import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  activityIcons,
  bridge,
  CHARACTERS,
  characterAnimations,
  characterSheet,
  councilSheet,
  dialogueFrame,
  engineTextures,
  FRAMES,
  guildHall,
  hut,
  island,
  markers,
  portrait,
  TILE_INDEX,
  taskPoints,
  tiles,
} from './art.ts';
import { artSlots } from './art-slots.ts';
import { applyArtSources } from './art-source.ts';
import type { ArtSources } from './art-source.types.ts';
import type { Manifest } from './manifest.schema.ts';
import {
  ACTIVITY_KINDS,
  BRIDGE_FRAMES,
  COUNCIL_ANIMATIONS,
  MARKER_KINDS,
  SPEC,
  TASK_POINT_STATES,
} from './manifest.ts';
import type { Raster } from './raster.ts';
import { defaultSounds, wav } from './sound.ts';

/** A councillor's 32×32 council sheet (§9.2): writes the image and returns its manifest entry. */
function councilEntry({
  name,
  images,
  art,
}: {
  name: string;
  images: Record<string, Raster>;
  art: (typeof CHARACTERS)[number];
}): NonNullable<Manifest['characters'][string]['council']> {
  const sheet = `characters/${name}-council.png`;
  images[sheet] = councilSheet(art);
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

/** A placeholder map animation's speed: brisk for walking and the one-shots, slow for resting. */
function fpsOf(animation: string): number {
  if (animation === 'walk' || animation === 'celebrate' || animation === 'hurt') return 8;
  return animation === 'rest' ? 2 : 4;
}

/**
 * The default pack: manifest plus every file, keyed by path inside the pack. Each image is the art
 * from `art` where a source exists, else the code-drawn placeholder (§9.5); without `art`, all
 * placeholders.
 */
export function buildDefaultPack({ art }: { art?: ArtSources } = {}): {
  manifest: Manifest;
  files: Record<string, Buffer>;
} {
  const files: Record<string, Buffer> = {};
  const images: Record<string, Raster> = {};
  const characters: Manifest['characters'] = {};
  for (const art of CHARACTERS) {
    const name = art.key.replace('.', '-');
    const sheet = `characters/${name}.png`;
    const face = `portraits/${name}.png`;
    images[sheet] = characterSheet(art);
    images[face] = portrait(art);
    characters[art.key] = {
      role: art.role,
      sheet,
      frame: { width: SPEC.characterFrame, height: SPEC.characterFrame },
      animations: Object.fromEntries(
        characterAnimations(art.role).map((animation, row) => [
          animation,
          { row, frames: FRAMES, fps: fpsOf(animation) },
        ]),
      ),
      portrait: face,
      ...(art.role === 'councillor' ? { council: councilEntry({ name, images, art }) } : {}),
    };
  }
  images['map/tiles.png'] = tiles();
  images['map/island.png'] = island();
  images['map/task-points.png'] = taskPoints(TASK_POINT_STATES);
  images['map/hut.png'] = hut();
  images['map/guild-hall.png'] = guildHall();
  images['ui/activity-icons.png'] = activityIcons(ACTIVITY_KINDS);
  images['ui/dialogue-frame.png'] = dialogueFrame();
  images['map/bridge.png'] = bridge();
  images['ui/markers.png'] = markers();
  // The real art over the placeholders, piece by piece (§9.5, #218).
  if (art) applyArtSources({ images, sources: art, slots: artSlots() });
  for (const [path, image] of Object.entries(images)) files[path] = image.png();
  // The default sounds (§9.4, #184), generated like the art.
  const sounds: NonNullable<Manifest['sounds']> = {};
  for (const [slot, samples] of Object.entries(defaultSounds())) {
    const file = `sounds/${slot}.wav`;
    files[file] = Buffer.from(wav(samples));
    sounds[slot as keyof typeof sounds] = { file };
  }

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
    buildings: {
      hut: { image: 'map/hut.png', width: SPEC.hut, height: SPEC.hut },
      guildHall: { image: 'map/guild-hall.png', width: SPEC.guildHall, height: SPEC.guildHall },
    },
    ui: { dialogueFrame: { image: 'ui/dialogue-frame.png', size: SPEC.dialogueFrame, inset: 8 } },
    sounds,
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

export function writeDefaultPack(dir: string, { art }: { art?: ArtSources } = {}): void {
  const { manifest, files } = buildDefaultPack(art ? { art } : {});
  writeAll(dir, { ...files, 'pack.json': `${JSON.stringify(manifest, null, 2)}\n` });
}

export function writeEngineTextures(dir: string): void {
  writeAll(
    dir,
    Object.fromEntries(Object.entries(engineTextures()).map(([name, r]) => [name, r.png()])),
  );
}
