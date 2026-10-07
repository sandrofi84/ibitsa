import type { Note } from './sound.types.ts';

/** Samples per second of every generated sound: plenty for 8-bit cues, and small files. */
export const SAMPLE_RATE = 22_050;

/**
 * A short sound from notes played one after another, sfxr-style (§9.5, #184): square, triangle, saw or
 * noise, each with a quick rise and a decay. Deterministic: the noise comes from a fixed seed, so the
 * default pack regenerates byte for byte.
 */
export function synth(notes: Note[]): Float32Array {
  const total = notes.reduce((n, note) => n + Math.round(note.seconds * SAMPLE_RATE), 0);
  const out = new Float32Array(total);
  let at = 0;
  let seed = 0x1234_5678;
  const noise = () => {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
    return (seed / 0xffff_ffff) * 2 - 1;
  };
  for (const note of notes) {
    const length = Math.round(note.seconds * SAMPLE_RATE);
    const attack = Math.max(1, Math.round((note.attack ?? 0.005) * SAMPLE_RATE));
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const freq = note.freq + ((note.slideTo ?? note.freq) - note.freq) * t;
      phase = (phase + freq / SAMPLE_RATE) % 1;
      const wave =
        note.wave === 'square'
          ? phase < 0.5
            ? 1
            : -1
          : note.wave === 'triangle'
            ? 1 - 4 * Math.abs(phase - 0.5)
            : note.wave === 'saw'
              ? 2 * phase - 1
              : noise();
      const envelope = i < attack ? i / attack : (1 - (i - attack) / (length - attack)) ** 1.5;
      out[at + i] = wave * envelope * (note.volume ?? 0.5);
    }
    at += length;
  }
  return out;
}

/** A mono 16-bit PCM WAV file of these samples. */
export function wav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32_767), true);
  });
  return bytes;
}

/** A WAV file's length in seconds, from its header; null when it isn't a PCM WAV this can read. */
export function wavSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') return byteRate > 0 ? size / byteRate : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const G4 = 392;
const E6 = 1318.51;

/** The default pack's sounds, one per slot (§9.4); no music, which stays off unless a pack brings it. */
export function defaultSounds(): Record<string, Float32Array> {
  const jingle = (freqs: number[], seconds: number) =>
    freqs.map((freq): Note => ({ wave: 'square', freq, seconds, volume: 0.3 }));
  return {
    needsYou: synth([
      { wave: 'triangle', freq: 880, seconds: 0.12, volume: 0.6 },
      { wave: 'triangle', freq: 1320, seconds: 0.25, volume: 0.6 },
    ]),
    councillorSpeaks: synth([{ wave: 'square', freq: 660, seconds: 0.04, volume: 0.25 }]),
    taskDone: synth(jingle([C5, E5, G5, C6], 0.11)),
    reviewPassed: synth(jingle([G5, C6], 0.14)),
    reviewFailed: synth([
      { wave: 'saw', freq: C5, seconds: 0.14, volume: 0.3 },
      { wave: 'saw', freq: 370, slideTo: 330, seconds: 0.24, volume: 0.3 },
    ]),
    prOpened: synth([{ wave: 'square', freq: 440, slideTo: 1320, seconds: 0.35, volume: 0.25 }]),
    prMerged: synth([
      ...jingle([C5, E5, G5], 0.1),
      { wave: 'square', freq: C6, seconds: 0.5, volume: 0.3 },
    ]),
    hpLow: synth([
      { wave: 'noise', freq: 1, seconds: 0.04, volume: 0.3 },
      { wave: 'square', freq: 1, seconds: 0.08, volume: 0 },
      { wave: 'noise', freq: 1, seconds: 0.04, volume: 0.3 },
    ]),
    resting: synth([
      { wave: 'triangle', freq: E6, seconds: 0.15, volume: 0.5 },
      { wave: 'triangle', freq: C6, seconds: 0.35, volume: 0.5 },
    ]),
    campaignStart: synth([
      ...jingle([G4, C5, E5], 0.15),
      { wave: 'square', freq: G5, seconds: 0.9, volume: 0.3 },
    ]),
    campaignEnd: synth([
      ...jingle([G5, E5, C5], 0.22),
      { wave: 'square', freq: G4, seconds: 1.1, volume: 0.3 },
    ]),
  };
}
