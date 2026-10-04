# Pure core with effects; the event log is the record

The core is a pure function, `step(state, input) → { state, outputs, effects }`. It never calls git, agents, the filesystem or the clock itself. It requests those things as effects, and a separate runtime carries them out and feeds their results back in as inputs (timers too: `setTimer` → `timerFired`). The runtime appends every input to a per-campaign JSONL log *before* stepping. That log is the only persisted record: recovery after a reload, `agent-fake` demos and fixture tests all replay it through the same core, without carrying out effects. We chose this so one recorded campaign can serve as a demo, a regression test and a recovery source, and so the real core runs unchanged in the browser for standalone game development. The cost is that every interaction with the outside world has to be modeled as an effect and a result input.

## Considered options

- **Core performs side effects itself, with fakes for replay.** Rejected: the log stores results, but fakes have to answer calls, so every dependency needs a recording-aware fake.
- **Separate persisted state file alongside the log.** Rejected: two records that can disagree, and recovery would be a code path that tests never exercise.
- **Logging protocol output (snapshots and cues).** Rejected: replay would skip the core's rules (states, stalls, gold pouch).

## Consequences

- `core` imports neither Node built-ins nor `vscode`; a lint rule enforces this.
- An effect that was requested but has no logged result (e.g. a crash mid-start) comes back as unknown after a rebuild, never as success.
- Trimming a log to stay under its size cap may only drop data that doesn't affect state (activity `detail` strings).
- Changing core rules changes what an old log replays to. Fixture golden files make that visible; `logVersion` handles format migrations.
