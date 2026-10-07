import type { Snapshot } from '@ibitsa/protocol';
import type * as Phaser from 'phaser';
import type { GameClient } from './client';
import type { Host } from './host.types';
import type { SoundBoard } from './sound-board.types';
import { DEFAULT_LEVELS, soundsFor, voiceDetune, volumeOf } from './sound-cues';
import type { SoundCue, SoundLevels } from './sound-cues.types';

/** The scene music for what's on screen; a pack without it is silent there. */
const MUSIC = { village: 'musicVillage', map: 'musicMap', hut: 'musicHut' } as const;

/**
 * The game's sounds (§9.4, #184): the pack's cues on what each snapshot changes, at the volumes in
 * `ibitsa.sound.*` (read from the extension), and the scene's music loop when the pack has one and
 * music is turned up. Audio starts once the page has had a click or key, as browsers require.
 */
export function mountSoundBoard({
  game,
  client,
  host,
}: {
  game: Phaser.Game;
  client: GameClient;
  host: Host;
}): SoundBoard {
  let levels: SoundLevels = { ...DEFAULT_LEVELS };
  let before: Snapshot | null = null;
  let music: { key: string; sound: Phaser.Sound.BaseSound } | null = null;
  const log: { slot: string; volume: number }[] = [];

  const play = (cue: SoundCue) => {
    const volume = volumeOf({ slot: cue.slot, levels });
    const key = `sound:${cue.slot}`;
    if (volume <= 0 || !game.cache.audio.exists(key)) return;
    log.push({ slot: cue.slot, volume });
    game.sound.play(key, { volume, ...(cue.speaker ? { detune: voiceDetune(cue.speaker) } : {}) });
  };

  const playMusic = (snapshot: Snapshot) => {
    const slot =
      snapshot.sitting && !snapshot.campaign?.status.match(/active/)
        ? MUSIC.hut
        : snapshot.campaign?.status === 'active'
          ? MUSIC.map
          : MUSIC.village;
    const key = `sound:${slot}`;
    const volume = levels.focus ? 0 : (levels.master / 100) * (levels.music / 100);
    if (music && (music.key !== key || volume <= 0)) {
      music.sound.stop();
      music = null;
    }
    if (music || volume <= 0 || !game.cache.audio.exists(key)) return;
    const sound = game.sound.add(key, { loop: true, volume });
    sound.play();
    music = { key, sound };
    log.push({ slot, volume });
  };

  host.onHostEvent((event) => {
    if (event.type !== 'settings') return;
    const value = (key: string) => event.rules.find((r) => r.key === `sound.${key}`)?.value;
    const level = (key: keyof Omit<SoundLevels, 'focus'>) => {
      const v = value(key);
      return typeof v === 'number' ? Math.max(0, Math.min(100, v)) : DEFAULT_LEVELS[key];
    };
    levels = {
      master: level('master'),
      alerts: level('alerts'),
      voices: level('voices'),
      effects: level('effects'),
      music: level('music'),
      focus: value('focus') === true,
    };
    if (client.snapshot) playMusic(client.snapshot);
  });
  host.request({ channel: 'host', type: 'readSettings' });
  client.onSnapshot((after) => {
    for (const cue of soundsFor({ before, after })) play(cue);
    before = after;
    playMusic(after);
  });
  return { played: () => [...log] };
}
