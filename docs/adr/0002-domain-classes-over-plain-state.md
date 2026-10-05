# Domain classes wrap plain-data state for one step

Core's behaviour lives in domain classes (`Quest`, `Hero`, `NeedsYou`, with an `Outbox` for cues and effects), but the state they act on stays plain JSON records (`CoreState`, `HeroRecord`). `step` deep-clones the state, wraps the relevant records in domain objects for the length of that one input, and returns the mutated draft. We chose this so each domain owns its rules in one place (a hero's stall watch, gold pouch and pause/resume used to be spread across a 500-line `Context` class and small helper files), while keeping what ADR 0001 relies on: state that can be cloned, logged, replayed and compared byte-for-byte in golden files.

## Considered options

- **Classes as the state** (hydrate on load, serialize on save). Rejected: every step would need a serialization boundary, and a missed field or a method closing over stale data would break replay determinism silently.
- **Keep one step context with free helper functions.** Rejected: the rules for one concept ended up in several files with no owner, and the context grew with every milestone.

## Consequences

- Domain objects are short-lived and never stored; anything that must survive a step goes into the record.
- Records stay plain data with no methods, so the golden files and the event log are unaffected by refactors of the classes.
- `view(state)` builds read-only domain objects with a throwaway outbox to derive what front ends see.
