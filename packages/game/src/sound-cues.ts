import type { Snapshot } from '@ibitsa/protocol';
import type { SoundCategory, SoundCue, SoundLevels, SoundSlot } from './sound-cues.types';

/** Effects at 50%, music off (§9.4, M8 planning). */
export const DEFAULT_LEVELS: SoundLevels = {
  master: 50,
  alerts: 100,
  voices: 100,
  effects: 100,
  music: 0,
  focus: false,
};

const CATEGORY: Record<SoundSlot, SoundCategory> = {
  needsYou: 'alerts',
  hpLow: 'alerts',
  councillorSpeaks: 'voices',
  taskDone: 'effects',
  reviewPassed: 'effects',
  reviewFailed: 'effects',
  prOpened: 'effects',
  prMerged: 'effects',
  resting: 'effects',
  campaignStart: 'effects',
  campaignEnd: 'effects',
};

/** A hero's HP is low from here (used over max). */
const HP_LOW = 0.8;

/**
 * The sounds a new snapshot calls for, against the one before (§9.4, #184): a campaign starting or
 * ending, a task done, a review passed or sent back, a PR opened or merged, a hero low on HP or resting,
 * a councillor speaking. Each at most once per snapshot; nothing for the first snapshot.
 */
export function soundsFor({
  before,
  after,
}: {
  before: Snapshot | null;
  after: Snapshot;
}): SoundCue[] {
  if (!before) return [];
  const cues: SoundCue[] = [];
  const add = (cue: SoundCue) => {
    if (!cues.some((c) => c.slot === cue.slot)) cues.push(cue);
  };
  // Anything new waiting in "Needs you", whatever its kind: not every one comes with a cue.
  const waiting = new Set(before.needsYou.map((i) => i.id));
  if (after.needsYou.some((i) => !waiting.has(i.id))) add({ slot: 'needsYou' });
  const was = before.campaign?.status;
  const is = after.campaign?.status;
  if (is === 'active' && was !== 'active') add({ slot: 'campaignStart' });
  if ((is === 'finished' || is === 'abandoned') && was !== is) add({ slot: 'campaignEnd' });

  const tasksBefore = new Map(before.islands.flatMap((i) => i.taskPoints).map((t) => [t.id, t]));
  for (const task of after.islands.flatMap((i) => i.taskPoints)) {
    const old = tasksBefore.get(task.id);
    const done = (s: string | undefined) => s === 'done' || s === 'doneUnreviewed';
    if (done(task.state) && !done(old?.state)) add({ slot: 'taskDone' });
    const phase = task.review?.phase;
    if (phase !== old?.review?.phase) {
      if (phase === 'passed') add({ slot: 'reviewPassed' });
      if (phase === 'changes' || phase === 'escalated') add({ slot: 'reviewFailed' });
    }
  }

  const islandsBefore = new Map(before.islands.map((i) => [i.id, i]));
  for (const island of after.islands) {
    const old = islandsBefore.get(island.id)?.remote?.pullRequest;
    const pr = island.remote?.pullRequest;
    if (pr && !old) add({ slot: 'prOpened' });
    if (pr?.state === 'merged' && old?.state !== 'merged') add({ slot: 'prMerged' });
  }

  const heroesBefore = new Map(before.heroes.map((h) => [h.id, h]));
  for (const hero of after.heroes) {
    const old = heroesBefore.get(hero.id);
    if (hero.state.kind === 'resting' && old?.state.kind !== 'resting') add({ slot: 'resting' });
    if (ratio(hero.hp) >= HP_LOW && ratio(old?.hp) < HP_LOW) add({ slot: 'hpLow' });
  }

  const spoken = (after.sitting?.dialogue ?? []).slice(before.sitting?.dialogue.length ?? 0);
  const speaker = spoken.find((line) => line.speaker !== 'you')?.speaker;
  if (speaker && after.sitting?.id === before.sitting?.id)
    add({ slot: 'councillorSpeaks', speaker });
  return cues;
}

/** How loud a sound plays, 0–1, or 0 when Focus mode keeps it quiet. */
export function volumeOf({ slot, levels }: { slot: SoundSlot; levels: SoundLevels }): number {
  if (levels.focus && slot !== 'needsYou') return 0;
  return (levels.master / 100) * (levels[CATEGORY[slot]] / 100);
}

/** A councillor's voice pitch, in cents: the same for one councillor, different between them. */
export function voiceDetune(speaker: string): number {
  let h = 0;
  for (const c of speaker) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 9) * 100 - 400;
}

function ratio(hp: Snapshot['heroes'][number]['hp'] | undefined): number {
  return hp && hp.kind !== 'unknown' && hp.value.max > 0 ? hp.value.used / hp.value.max : 0;
}
