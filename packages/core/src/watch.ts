import type { QuestSettings, StallWatch } from './state';

// The stall rules (spec §10 item 11), as pure updates of a hero's counters. Each returns a reason when
// the hero has stalled.

type Thresholds = QuestSettings['stall'];

export function afterTest({
  watch,
  command,
  ok,
  limits,
}: {
  watch: StallWatch;
  command: string;
  ok: boolean;
  limits: Thresholds;
}): string | null {
  if (ok) {
    watch.failingTest = null;
    watch.editsSincePass = {};
    watch.passedThisTurn = true;
    return null;
  }
  // Edits in between don't reset the count; only a pass (or a different failing command) does.
  watch.failingTest =
    watch.failingTest?.command === command
      ? { command, count: watch.failingTest.count + 1 }
      : { command, count: 1 };
  return watch.failingTest.count >= limits.testFailures
    ? `The same test failed ${watch.failingTest.count} times in a row: ${command}`
    : null;
}

export function afterEdit({
  watch,
  file,
  limits,
}: {
  watch: StallWatch;
  file: string;
  limits: Thresholds;
}): string | null {
  const count = (watch.editsSincePass[file] ?? 0) + 1;
  watch.editsSincePass[file] = count;
  return count >= limits.fileEdits
    ? `${file} was edited ${count} times without a passing test.`
    : null;
}

export function afterTurn({
  watch,
  diffHash,
  limits,
}: {
  watch: StallWatch;
  diffHash: string;
  limits: Thresholds;
}): string | null {
  const quiet = watch.lastDiff === diffHash && !watch.passedThisTurn;
  watch.quietTurns = quiet ? watch.quietTurns + 1 : 0;
  watch.lastDiff = diffHash;
  watch.passedThisTurn = false;
  return watch.quietTurns >= limits.noProgressTurns
    ? `No progress for ${watch.quietTurns} turns.`
    : null;
}
