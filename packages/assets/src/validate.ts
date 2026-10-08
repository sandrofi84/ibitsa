import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import * as v from 'valibot';
import { ManifestSchema } from './manifest.schema.ts';
import {
  ACTIVITY_KINDS,
  BRIDGE_FRAMES,
  REQUIRED_ANIMATIONS,
  REQUIRED_COUNCIL_ANIMATIONS,
  REQUIRED_MARKERS,
  SCENE_SLOTS,
  SOUND_LIMITS,
  SPEC,
} from './manifest.ts';
import { readPngSize } from './png.ts';
import { wavSeconds } from './sound.ts';
import type { PackValidation } from './validate.types.ts';

/** Packs hold images, audio and the manifest only: no scripts, nothing executable (spec §9.3). */
const ALLOWED_EXTENSIONS = new Set(['.png', '.ogg', '.mp3', '.wav']);
export const LIMITS = { fileBytes: 4 * 1024 * 1024, packBytes: 32 * 1024 * 1024 };

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => !e.isDirectory())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));
}

export function validatePack(dir: string): PackValidation {
  const errors: string[] = [];
  const files = listFiles(dir);

  let total = 0;
  for (const file of files) {
    const bytes = statSync(join(dir, file)).size;
    total += bytes;
    if (file !== 'pack.json' && !ALLOWED_EXTENSIONS.has(extname(file).toLowerCase())) {
      errors.push(`${file}: not allowed in a pack (images, audio and pack.json only)`);
    }
    if (bytes > LIMITS.fileBytes) errors.push(`${file}: larger than ${LIMITS.fileBytes} bytes`);
  }
  if (total > LIMITS.packBytes) errors.push(`pack is larger than ${LIMITS.packBytes} bytes`);

  if (!files.includes('pack.json'))
    return { ok: false, errors: [...errors, 'pack.json is missing'] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'));
  } catch {
    return { ok: false, errors: [...errors, 'pack.json is not valid JSON'] };
  }
  const parsed = v.safeParse(ManifestSchema, raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [
        ...errors,
        ...parsed.issues.map((i) => `pack.json ${v.getDotPath(i) ?? ''}: ${i.message}`),
      ],
    };
  }
  const manifest = parsed.output;

  const size = (file: string, label: string) => {
    if (!files.includes(file)) {
      errors.push(`${label}: ${file} is missing`);
      return null;
    }
    const s = readPngSize(readFileSync(join(dir, file)));
    if (!s) errors.push(`${label}: ${file} is not a PNG`);
    return s;
  };
  const checkImage = ({
    file,
    label,
    check,
  }: {
    file: string;
    label: string;
    check: (w: number, h: number) => string | null;
  }) => {
    const s = size(file, label);
    if (!s) return;
    const problem = check(s.width, s.height);
    if (problem) errors.push(`${label}: ${file} is ${s.width}×${s.height}, ${problem}`);
  };
  const exactly = (w: number, h: number) => (aw: number, ah: number) =>
    aw === w && ah === h ? null : `expected ${w}×${h}`;

  /** A sheet of square frames, one row per animation: frame size, required animations, image size. */
  const checkSheet = ({
    sheet,
    label,
    frameSize,
    required,
    hint = '',
  }: {
    sheet: { sheet: string; frame: { width: number; height: number }; animations: object };
    label: string;
    frameSize: number;
    required: readonly string[];
    /** Said after a wrong frame size, e.g. what changed and how to fix it. */
    hint?: string;
  }) => {
    const { frame } = sheet;
    const animations = sheet.animations as Record<string, { row: number; frames: number }>;
    if (frame.width !== frameSize || frame.height !== frameSize) {
      errors.push(
        `${label}: frame is ${frame.width}×${frame.height}, expected ${frameSize}×${frameSize}${hint}`,
      );
    }
    for (const animation of required) {
      if (!animations[animation])
        errors.push(`${label}: missing required animation "${animation}"`);
    }
    const anims = Object.values(animations);
    const cols = Math.max(0, ...anims.map((a) => a.frames));
    const rows = Math.max(0, ...anims.map((a) => a.row + 1));
    checkImage({
      file: sheet.sheet,
      label,
      check: (w, h) =>
        w >= cols * frame.width &&
        h >= rows * frame.height &&
        w % frame.width === 0 &&
        h % frame.height === 0
          ? null
          : `too small or not a whole number of ${frame.width}×${frame.height} frames for its animations`,
    });
  };

  for (const [key, c] of Object.entries(manifest.characters)) {
    const label = `character ${key}`;
    checkSheet({ sheet: c, label, frameSize: SPEC.characterFrame, required: REQUIRED_ANIMATIONS });
    if (c.council)
      checkSheet({
        sheet: c.council,
        label: `${label} council sheet`,
        frameSize: SPEC.councilFrame,
        required: REQUIRED_COUNCIL_ANIMATIONS,
        // Council figures were 32×32 torsos before the art plan (#219): one size keeps the hut's
        // seating and table line right, and a pack without the sheet falls back to its map sprite.
        hint: ' (council figures are 48×48 full-body; redraw the sheet, or remove "council" to use the map sprite scaled 3×)',
      });
    if (c.portrait)
      checkImage({
        file: c.portrait,
        label: `${label} portrait`,
        check: exactly(SPEC.portrait, SPEC.portrait),
      });
  }

  const t = manifest.tiles;
  if (t.tileSize !== SPEC.tile) errors.push(`tiles: tileSize ${t.tileSize}, expected ${SPEC.tile}`);
  const slots = Math.max(0, ...Object.values(t.tiles).map((x) => x.index + (x.frames ?? 1)));
  checkImage({
    file: t.image,
    label: 'tiles',
    check: (w, h) =>
      h === t.tileSize && w >= slots * t.tileSize && w % t.tileSize === 0
        ? null
        : `expected ${t.tileSize} tall with ${slots} tiles`,
  });

  const i = manifest.island;
  if (
    i.height !== SPEC.island.height ||
    i.leftCap !== SPEC.island.leftCap ||
    i.middle !== SPEC.island.middle ||
    i.rightCap !== SPEC.island.rightCap
  ) {
    errors.push('island: pieces must be 96 tall with caps of 48 and a middle of 32');
  }
  checkImage({
    file: i.image,
    label: 'island',
    check: exactly(i.leftCap + i.middle + i.rightCap, i.height),
  });

  const tp = manifest.taskPoints;
  if (tp.size !== SPEC.taskPoint)
    errors.push(`task points: size ${tp.size}, expected ${SPEC.taskPoint}`);
  for (const state of ['locked', 'active', 'done', 'underReview'] as const) {
    if (!tp.states.includes(state)) errors.push(`task points: missing state "${state}"`);
  }
  checkImage({
    file: tp.image,
    label: 'task points',
    check: exactly(tp.size * tp.states.length, tp.size),
  });

  const ai = manifest.activityIcons;
  if (ai.size !== SPEC.activityIcon)
    errors.push(`activity icons: size ${ai.size}, expected ${SPEC.activityIcon}`);
  for (const kind of ACTIVITY_KINDS) {
    if (!ai.kinds.includes(kind)) errors.push(`activity icons: missing "${kind}"`);
  }
  checkImage({
    file: ai.image,
    label: 'activity icons',
    check: exactly(ai.size * ai.kinds.length, ai.size),
  });

  const br = manifest.bridge;
  if (br) {
    const want = SPEC.bridge;
    if (br.height !== want.height || br.end !== want.end || br.segment !== want.segment) {
      errors.push(
        `bridge: pieces must be ${want.height} tall with ends of ${want.end} and a segment of ${want.segment}`,
      );
    }
    for (const frame of BRIDGE_FRAMES) {
      if (!br.frames.includes(frame)) errors.push(`bridge: missing frame "${frame}"`);
    }
    checkImage({
      file: br.image,
      label: 'bridge',
      check: exactly(br.end * 2 + br.segment, br.height * br.frames.length),
    });
  }

  const mk = manifest.markers;
  if (mk) {
    if (mk.size !== SPEC.marker) errors.push(`markers: size ${mk.size}, expected ${SPEC.marker}`);
    for (const kind of REQUIRED_MARKERS) {
      if (!mk.kinds.includes(kind)) errors.push(`markers: missing "${kind}"`);
    }
    checkImage({
      file: mk.image,
      label: 'markers',
      check: exactly(mk.size * mk.kinds.length, mk.size),
    });
  }

  for (const [key, b] of Object.entries(manifest.buildings)) {
    if (b.width % SPEC.tile !== 0 || b.height % SPEC.tile !== 0)
      errors.push(`building ${key}: size must be a multiple of 16`);
    checkImage({ file: b.image, label: `building ${key}`, check: exactly(b.width, b.height) });
  }
  const hutSpec = manifest.buildings.hut;
  if (!hutSpec) errors.push('buildings: missing "hut"');
  else if (hutSpec.width !== SPEC.hut || hutSpec.height !== SPEC.hut)
    errors.push('building hut: expected 64×64');

  const d = manifest.ui.dialogueFrame;
  if (d.size !== SPEC.dialogueFrame)
    errors.push(`dialogue frame: size ${d.size}, expected ${SPEC.dialogueFrame}`);
  if (d.inset * 2 >= d.size) errors.push('dialogue frame: inset leaves no middle slice');
  checkImage({ file: d.image, label: 'dialogue frame', check: exactly(d.size, d.size) });

  // Full-scene pictures (#219): optional, each exactly the scene size.
  for (const slot of SCENE_SLOTS) {
    const file = manifest.scenes?.[slot];
    if (file)
      checkImage({
        file,
        label: `scene ${slot}`,
        check: exactly(SPEC.scene.width, SPEC.scene.height),
      });
  }

  // Sounds (§9.4, #184): there, and not too long; a WAV's length is read from its header.
  for (const [slot, sound] of Object.entries(manifest.sounds ?? {})) {
    if (!files.includes(sound.file)) {
      errors.push(`sound ${slot}: ${sound.file} is missing`);
      continue;
    }
    if (!sound.file.toLowerCase().endsWith('.wav')) continue;
    const seconds = wavSeconds(new Uint8Array(readFileSync(join(dir, sound.file))));
    const limit = slot.startsWith('music') ? SOUND_LIMITS.musicSeconds : SOUND_LIMITS.cueSeconds;
    if (seconds === null) errors.push(`sound ${slot}: ${sound.file} is not a PCM WAV`);
    else if (seconds > limit)
      errors.push(`sound ${slot}: ${seconds.toFixed(1)} s, at most ${limit} s`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, manifest };
}
