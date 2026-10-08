import { CHARACTERS, characterAnimations, FRAMES, TILE_INDEX } from './art.ts';
import type { ArtPiece, ArtSlot } from './art-source.types.ts';
import {
  ACTIVITY_KINDS,
  BRIDGE_FRAMES,
  COUNCIL_ANIMATIONS,
  MARKER_KINDS,
  SCENE_SIZES,
  SPEC,
  TASK_POINT_STATES,
} from './manifest.ts';

const square = (size: number) => ({ width: size, height: size });

/** Pieces side by side in a strip, one per kind, in the kinds' order (task points, icons, …). */
function strip({
  kinds,
  folder,
  size,
}: {
  kinds: readonly string[];
  folder: string;
  size: number;
}) {
  return kinds.map(
    (kind, i): ArtPiece => ({
      source: `${folder}/${kind}`,
      x: i * size,
      y: 0,
      frame: square(size),
      frames: 1,
    }),
  );
}

/** A sheet's rows, one animation each, in the manifest's row order. */
function rows({
  animations,
  folder,
  size,
}: {
  animations: readonly string[];
  folder: string;
  size: number;
}) {
  return animations.map(
    (animation, row): ArtPiece => ({
      source: `${folder}/${animation}`,
      x: 0,
      y: row * size,
      frame: square(size),
      frames: FRAMES,
    }),
  );
}

/**
 * Every pack image the art in `art/` can fill (spec §9.5, #218), and where each source goes in it.
 * The layout follows the placeholders' and the manifest's: a new slot is a new entry here, beside a
 * placeholder of the same size in `generate.ts`.
 */
/** Each scene slot's file name, in `art/scenes/` and in the pack's `scenes/` (#219, #221). */
export const SCENE_FILES = {
  hutInterior: 'hut-interior',
  hutTable: 'hut-table',
  village: 'village',
  ibitsa: 'ibitsa',
} as const;

export function artSlots(): ArtSlot[] {
  const characters = CHARACTERS.flatMap((art): ArtSlot[] => {
    const name = art.key.replace('.', '-');
    return [
      {
        output: `characters/${name}.png`,
        pieces: rows({
          animations: characterAnimations(art.role),
          folder: `characters/${name}`,
          size: SPEC.characterFrame,
        }),
      },
      {
        output: `portraits/${name}.png`,
        pieces: [
          { source: `portraits/${name}`, x: 0, y: 0, frame: square(SPEC.portrait), frames: 1 },
        ],
      },
      ...(art.role === 'councillor'
        ? [
            {
              output: `characters/${name}-council.png`,
              pieces: rows({
                animations: COUNCIL_ANIMATIONS,
                folder: `characters/${name}/council`,
                size: SPEC.councilFrame,
              }),
            },
          ]
        : []),
    ];
  });
  const island = SPEC.island;
  const bridgeWidth = SPEC.bridge.end * 2 + SPEC.bridge.segment;
  return [
    ...characters,
    {
      output: 'map/tiles.png',
      pieces: [
        {
          source: 'map/water',
          x: TILE_INDEX.water * SPEC.tile,
          y: 0,
          frame: square(SPEC.tile),
          frames: FRAMES,
        },
      ],
    },
    {
      output: 'map/island.png',
      pieces: [
        {
          source: 'map/island-left',
          x: 0,
          y: 0,
          frame: { width: island.leftCap, height: island.height },
          frames: 1,
        },
        {
          source: 'map/island-middle',
          x: island.leftCap,
          y: 0,
          frame: { width: island.middle, height: island.height },
          frames: 1,
        },
        {
          source: 'map/island-right',
          x: island.leftCap + island.middle,
          y: 0,
          frame: { width: island.rightCap, height: island.height },
          frames: 1,
        },
      ],
    },
    {
      output: 'map/task-points.png',
      pieces: strip({ kinds: TASK_POINT_STATES, folder: 'map/task-points', size: SPEC.taskPoint }),
    },
    {
      output: 'map/bridge.png',
      pieces: BRIDGE_FRAMES.map(
        (frame, row): ArtPiece => ({
          source: `map/bridge/${frame}`,
          x: 0,
          y: row * SPEC.bridge.height,
          frame: { width: bridgeWidth, height: SPEC.bridge.height },
          frames: 1,
        }),
      ),
    },
    {
      output: 'ui/markers.png',
      pieces: strip({ kinds: MARKER_KINDS, folder: 'map/markers', size: SPEC.marker }),
    },
    {
      output: 'map/hut.png',
      pieces: [{ source: 'buildings/hut', x: 0, y: 0, frame: square(SPEC.hut), frames: 1 }],
    },
    {
      output: 'map/guild-hall.png',
      pieces: [
        { source: 'buildings/guild-hall', x: 0, y: 0, frame: square(SPEC.guildHall), frames: 1 },
      ],
    },
    {
      output: 'ui/dialogue-frame.png',
      pieces: [
        { source: 'ui/dialogue-frame', x: 0, y: 0, frame: square(SPEC.dialogueFrame), frames: 1 },
      ],
    },
    {
      output: 'ui/activity-icons.png',
      pieces: strip({ kinds: ACTIVITY_KINDS, folder: 'ui/activity', size: SPEC.activityIcon }),
    },
    // The scenes (#219, #221): the hut's room and table, Home Village and Ibitsa, each in the pack
    // only once its art exists; the game draws its own without.
    ...(Object.entries(SCENE_FILES) as [keyof typeof SCENE_FILES, string][]).map(
      ([slot, name]): ArtSlot => ({
        output: `scenes/${name}.png`,
        pieces: [{ source: `scenes/${name}`, x: 0, y: 0, frame: SCENE_SIZES[slot], frames: 1 }],
        optional: SCENE_SIZES[slot],
      }),
    ),
  ];
}
