# Quest for Ibitsa: Product & Technical Spec

> Name: **Quest for Ibitsa** (short form: **Ibitsa**). See §1.1.
> Status: design agreed, pre-implementation. Last updated 2026-10-04.
> Visual mockups (owner-only link, for the human reader): https://claude.ai/artifact/FVeCVCTreexV5MeJQzk2zH

## 0. Notes for the implementer

- Build in the milestone order of **§14**. Each milestone must be usable on its own.
- Where this spec names Claude Agent SDK APIs, **verify them against the current SDK docs** before relying on them: the SDK evolves quickly. Docs: https://code.claude.com/docs/en/agent-sdk/typescript
- Items marked **[OPEN]** are undecided; pick the simplest option that keeps the decision reversible and note it in `docs/decisions.md`.
- The game is a **view of real state**. Never let the UI invent or guess agent state. If state is unknown, show it as unknown.

---

## 1. Overview

Quest for Ibitsa is a VS Code extension that turns working with AI coding agents (Claude Code first) into a 2D pixel-art RPG. The user leads a **campaign**: a **council** of advisors researches and plans the work with the user, then **parties** of **heroes** (coding agents) carry out the plan on a Super Mario World–style overworld map. Councillors return to review the heroes' work before a pull request is opened.

Every character is backed by a real agent session. The game layer makes multi-agent work visible (who is working, waiting, stuck, or low on context), keeps the human in charge of every key decision, and makes cost visible.

### 1.1 Name and naming conventions
- **Quest for Ibitsa.** "Ibitsa" is a pun on Ibiza, the *party* island: the game sends *parties* across *islands*. It also hides "**bits**", and "Quest for…" nods to classic adventure titles.
- In the game world, **Ibitsa is the destination island**. A campaign is the quest to reach it; when a campaign ends with its work shipped, the party celebrates on Ibitsa (end-of-campaign scene, §7.1).
- Naming rules:

| Use | Form |
|---|---|
| Display name, title screen, Marketplace listing | Quest for Ibitsa |
| Everything else (prose, settings, UI labels) | Ibitsa |
| Extension ID / package names | `ibitsa` (e.g. `<publisher>.ibitsa`, `@ibitsa/core`) |
| Command IDs | `ibitsa.<command>` (e.g. `ibitsa.startCampaign`) |
| Project folder / user folder | `.ibitsa/`, `~/.ibitsa/` |
| Optional chat participant | `@ibitsa` |

- Marketplace keywords should include common misspellings ("ibiza", "ibitza") so search still finds it.

### Goals
1. Make agent work visible at a glance, without reading logs.
2. Keep the human in charge: planning, approval, party choice, interruptions, merges.
3. Hear domain concerns (architecture, testing, accessibility, security, …) before code is written, and check them after.
4. Make parallel and stacked work manageable.
5. Be token-efficient by design and make spend visible.
6. Be agent- and model-agnostic through adapters.
7. Be fully customizable: councillors, actions, models, rules, art, sound.
8. Be fun, never at the expense of clarity.

### Non-goals (v1)
- Multiplayer or shared live campaigns.
- Game systems that don't reflect real work (loot, XP grinding, combat).
- Automatic merging to the main branch.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Campaign** | One goal from the user, from first question to final PRs. |
| **Elder** | The council's first and permanent member. Does initial research, recommends councillors, moderates and owns the plan. |
| **Councillor** | A domain persona (Architect, Tester, Accessibility, Security, Designer, …) defined as a skill with a **planning mode** and/or a **review mode**. |
| **Council session** | The single agent session in which planning happens. Councillors are perspectives inside it, not separate agents. |
| **Research brief** | Short document written by the elder's research pass; input to planning. |
| **Plan** | Saved document: tasks, branches, acceptance criteria, decision records. |
| **Decision record** | A recorded user choice with its alternatives, trade-offs and reasons. |
| **Hero** | A coding agent session that executes tasks. Its **class** maps to an adapter + model. |
| **Party** | One lead hero assigned to one worktree/branch, plus the councillors who will review its work. |
| **Island** | A worktree/branch on the map. **Task points** on it are tasks. |
| **Game master** | Deterministic TypeScript code that runs the rules. It is **not** an LLM. |
| **Adapter** | Plug-in that connects the core to an agent runtime, model vendor, git host or ticket system. |
| **Action** | A reusable prompt sent to a party or the council (stored as a Claude Code skill). |
| **Control** | A game-master operation that is not a prompt (stop, rest, re-review, end campaign). |

---

## 3. Campaign lifecycle

1. **Start.** The user opens the panel and describes a task to the **elder** (free text, optionally from a ticket).
2. **Research.** The elder (cheap/fast model) researches the codebase and writes the **research brief**: relevant files, current patterns, open questions, recommended councillors with a one-line reason each, recommended council effort, and whether this is a **quick quest**.
3. **Quick quest path.** If the task is small and clear, the elder offers to skip the council and dispatch a single hero directly.
4. **Convene the council.** The user picks councillors (checkboxes, recommended ones pre-checked with reasons) and **one effort level for the whole council** (= the council session's model).
5. **Planning.** A fresh council session starts from the brief on the chosen model. Councillors contribute their domain concerns, ask the user steering questions (in their own voice), and can be questioned about trade-offs ("Why?").
6. **Plan proposal.** The elder presents the plan: tasks, dependencies, branching strategy (separate or stacked), suggested hero classes, acceptance criteria per reviewing councillor, decision records.
7. **Approval.** The user approves, or requests changes with context. The plan is saved to the repo.
8. **Assemble parties.** One party per worktree. The user picks the hero class per party and which councillors join each party (= will review its work). All pre-filled with recommendations from the plan.
9. **Adventure.** Heroes work on the map. The user can talk to any party or to the council at any time.
10. **Review loop.** When a hero submits a task, its party's councillors review it concurrently against the agreed criteria. Blocking findings send the hero back. Loop ends when all are satisfied or the loop limit escalates to the user.
11. **PR.** A passed task can open a PR from its task point. PR status is shown as a badge.
12. **Campaign end.** The council writes the **campaign record**. The user chooses to keep (default), compact or empty the council's context.

---

## 4. The council

### 4.1 Elder and research pass
- The elder runs a **separate, short research session** on a cheap/fast model (configurable; default: smallest available model).
- Read-only tools. Output is the **research brief** (`brief.md`) in a fixed structure:
  - Task restatement
  - Relevant files and areas (paths + one line each)
  - Existing patterns and conventions
  - Risks and unknowns
  - Recommended councillors (id, reason)
  - Recommended council effort (model) and why
  - Quick-quest verdict (yes/no + reason)
- The raw research transcript is **not** carried into planning. The brief is the handoff.

### 4.2 Choosing the council
- UI: list of available councillors with checkboxes; recommended ones pre-checked with the elder's reason; one effort selector for the whole council; estimated relative cost.
- The last selection is remembered per project as the default for next time ("Reset to defaults" available).
- Councillors can also be added during planning.

### 4.3 Planning session
- **One agent session, one model** (the chosen council effort). Councillors are loaded as skills/instructions and act as perspectives within that session.
- Read-only tools plus the custom `ask_user` tool (§4.4).
- Specialist councillors may read deeper into their own domain (e.g. Security reads auth code in full) but other code knowledge comes from the brief.
- **Deferred option [OPEN, not v1]:** "specialist dives": the elder may dispatch a councillor as a subagent on its own model for a focused investigation that returns a short report. Only add if planning quality in specialist domains proves thin.

### 4.4 Questions, "Why?" and voices
- The council session asks the user questions only through a custom tool:

```ts
ask_user({
  councillor: string,          // id of the councillor asking; drives speaker, portrait, voice
  question: string,
  options: { id: string; label: string; tradeoff: string }[],
  recommendation?: { optionId: string; reason: string },
  allowFreeText: boolean
})
```

- Questions are **batched** where possible.
- The dialogue box offers the options, free text, and **"Why?"**. "Why?" opens a short back-and-forth with that councillor (same session); other councillors may chime in when their concern is affected.

### 4.5 Plan document and decision records
- Saved at `.ibitsa/campaigns/<campaignId>/plan.md` (human-readable markdown with a machine-readable JSON block or sidecar `plan.json`; the game reads the JSON).
- Plan contents:
  - Goal and scope
  - Tasks (id, title, description, files likely touched, dependencies, suggested hero class, estimated effort, optional source ticket). A **ticket** is an item in an outside ticket system; it is not part of the game world. See `GLOSSARY.md`.
  - Branching strategy: `separate` or `stacked`, with branch names and bases
  - **Acceptance criteria per reviewing councillor per task**
  - Recommended party composition per worktree
  - **Book of Decisions** (decision records)
- Decision record format:

```markdown
### D3 · Sign-in methods (raised by Mira, Architect)
**Chosen:** Email and password only
**Alternatives:** Email + Google. Rejected: adds OAuth setup and a third-party dependency.
**Trade-offs accepted:** No social sign-in for now.
**Why:** <the user's reason, in their words when given>
**Discussion:** <2–3 line summary; not a transcript>
**Affects tasks:** T4, T5
```

- Rules:
  - Record the user's reason in their own words when they gave one.
  - Summarize discussions; never transcribe.
  - Tasks list the decisions they depend on.
  - Reviewers may not raise blocking findings against a recorded decision; they raise "revisit D3?" which goes to the user.
  - Changes **supersede**, never overwrite ("D7 supersedes D3", old record kept).

### 4.6 Plan approval
- Approve, or "Change" with free-text context, which sends the council back to revise. Each approved version is saved; amendments later in the campaign create new versions with a visible diff.

### 4.7 Councillor definitions
- Each councillor is **one class with two modes**:
  - **Planning mode:** what concerns to raise, what to research, how to write acceptance criteria.
  - **Review mode:** how to review a diff against criteria, what counts as blocking vs suggestion, output format.
  - A councillor may be planning-only (e.g. Product).
- Stored as Claude Code skill files (see §9.2 for locations and precedence). Defaults ship with the extension; users can **extend** (override some fields), **replace**, or **disable** them; users can create new ones.
- Default roster (v1): Elder, Architect, Tester, Accessibility, Security, Designer. **[OPEN]** final names/personas.
- Councillor skills must not be auto-invoked by the model in normal Claude Code use (`disable-model-invocation: true`; consider `user-invocable: false`). **[OPEN]** confirm best location so they don't clutter the user's normal `/` menu.

### 4.8 Talking to the council mid-campaign
- `@council` messages go to the council session (resumed). It does **not** stop heroes.
- The game master gives the council a **compact status report** (tasks done, current findings, blockers, PR states), never heroes' transcripts.
- Plan changes become a **plan amendment** naming affected parties and potential rework. The user confirms. Affected parties receive it as a **queued** message (delivered after their current step).

### 4.9 Campaign end
- The council always writes a **campaign record** (`record.md`): decisions, what shipped (PR links), what was deferred, lessons.
- The user is asked what to do with the council's context, showing its current fullness (HP):
  - **Keep** (default): next campaign resumes this session.
  - **Compact**: summarize and continue.
  - **Empty**: next campaign starts fresh (the record file preserves knowledge).
- On the next campaign, the elder compares the new task with any kept context and may suggest a different choice ("Unrelated to the accounts work. Start fresh?").
- Hero sessions are task-scoped and end when their task's PR opens or the task is abandoned.

---

## 5. Parties and heroes

### 5.1 Composition
- One party per worktree/branch.
- **One lead hero writes to a worktree.** Parallel help inside a task uses the lead's own subagents, or the plan splits it into another worktree/party.
- Councillors who "join the party" are the ones who will review that party's work. The same councillor class may join several parties (each review is its own instance).

### 5.2 Hero classes
- A class maps to **adapter + model** (configurable). Defaults:

| Class | Model |
|---|---|
| Paladin | Claude Fable |
| Barbarian | Claude Opus |
| Ranger | Claude Sonnet |
| Rogue | Claude Haiku |

- Users can remap classes and add new classes (new model → new class with an appearance).

### 5.3 Branching strategies
- **Separate:** each island is an independent branch off `main`. Islands are spread around the map. There is no merge step: each task/branch gets its own PR.
- **Stacked:** islands are **in a line, connected by bridges**. Each branch is based on the previous one. A bridge is a raised, locked drawbridge until the island before it is cleared. Each PR targets the previous branch.
- The council proposes the strategy in the plan; the user approves it.
- Worktrees are created by the game master (`git worktree add`), default location: a sibling folder `../<repo>.ibitsa/<branch>` (configurable).

### 5.4 Execution states
Each hero is always in exactly one state, mapped from agent events:

| State | Source | Map display |
|---|---|---|
| traveling | dispatched, session starting | walking along path |
| working: read/search | read/search tools | reading animation |
| working: edit | write/edit tools | work animation |
| working: run/test | shell/test tools | test animation |
| waiting on you | question or permission request | gold "?" bubble + "Needs you" entry |
| blocked | dependency not done | padlock; at drawbridge if stacked |
| resting | context compaction | rest animation |
| submitted | task declared done | idle at task point; councillors walk out |
| stalled | stall detection (§10) | warning bubble, auto-paused |
| error | adapter error | hurt animation + log |

### 5.5 Review loop (run by the game master, never by the hero)
1. Hero declares the task done.
2. Game master runs **free deterministic checks** in the worktree (tests, lint, typecheck, and configured tools such as axe, npm audit, semgrep). Failures go straight back to the hero.
3. Game master launches each of the party's reviewing councillors **concurrently**: read-only, review-mode prompt, councillor's own model (per-councillor effort applies here), given the diff, check outputs, the task's acceptance criteria and relevant decision records.
4. Each returns a structured verdict:

```ts
{ councillor: string, verdict: 'pass' | 'changes',
  findings: { severity: 'blocking' | 'suggestion', criterion?: string,
              file?: string, line?: number, message: string }[] }
```

5. Blocking findings are sent into the hero's session; it fixes and resubmits.
6. Re-review: only councillors who raised blocking findings, only on the delta since their last review.
7. **Loop limit** (default 3 rounds) → escalate to the user with disputed findings.
8. **Conflicting findings** between councillors → escalate to the user (or the elder, if configured).
9. Suggestions are collected into the PR description.
10. All pass → task is cleared; the PR can be opened.

On the map, councillors walk out of the council hut to the task point, show a magnifier while reviewing, and a red count badge when they have findings.

### 5.6 Pull requests
- PRs are opened per task point (or per branch, as the plan defines) via the git-host adapter.
- Stacked: each PR's base is the previous branch.
- Badges on the map: open, draft, approved, changes requested, checks failing, merged. Kept up to date by polling the git host (configurable interval).
- Merging is always a human action on the git host.

---

## 6. Interaction

### 6.1 Command bar
- A text input in the game panel (and in party/council dialogue boxes). Also expose actions as Command Palette commands.
- **`@` autocomplete**, two groups:
  - **Targets:** `@council`, each party by name (`@atelier`, `@brann`), `@all`; shown with current status.
  - **Files/folders:** fuzzy search (in the target party's worktree when addressing a party). Sent as paths the model reads itself.
  - The first `@` target is the recipient; later `@` mentions are file references.
- **`/` autocomplete:** actions valid for the chosen target, with description, argument hint, and source tag (built-in / user / project). Also lists the user's existing Claude Code commands/skills where valid.
- **Preview:** the expanded prompt is shown before sending and can be edited for that one message.
- Messages to a working party are delivered as **queued** by default (after the current step); a "now" option interrupts the current step.
- Note: VS Code chat participants are declared statically, so per-party `@names` are not possible in VS Code's chat view. A single `@ibitsa` chat participant is an optional later integration. **[OPEN]**

### 6.2 Actions (reusable prompts)
- An action is text handed to the model. Creating an action in the game **writes a Claude Code skill file**, so it also works as a `/command` in plain Claude Code.

```markdown
---
name: pr
description: Open a pull request for the current task
argument-hint: [reviewers]
disable-model-invocation: true
---
Open a pull request for the current task from its branch, using gh.
Include the plan's decision records for this task in the description.
Request review from: $ARGUMENTS
```

- Use Claude Code's own placeholders (`$ARGUMENTS`, `$0`, named arguments, `${CLAUDE_PROJECT_DIR}`). Refer to game context as "the current task/branch" so the prompt works outside the game.
- `disable-model-invocation: true` by default.
- Scope chosen at creation: personal (`~/.claude/skills/`) or project (`.claude/skills/`).
- Game-only metadata (e.g. `target: party | council | any`) lives in frontmatter if Claude Code tolerates extra fields, otherwise in a sidecar `actions.json` keyed by skill name. **[OPEN]** verify.
- Name collisions with existing skills are detected and the user chooses rename/overwrite.
- Verify the SDK delivers `/name args` prompts to custom skills/commands. **[OPEN]** verify.

### 6.3 Controls (not prompts)
Shown in the same hover menu, visually distinct:
- **Stop:** interrupt the session now.
- **Rest:** compact the session, or restart it fresh from a handoff summary.
- **Re-review:** game master relaunches reviewers (all or chosen).
- **Abandon task.**
- **End campaign** (§4.9).

### 6.4 "Needs you" queue
- All questions and permission requests from any session go into one queue (panel + map bubbles).
- VS Code notification and panel badge when the panel is not focused.
- Focus mode: only "needs you" makes sound.

---

## 7. Screens and visuals

### 7.1 Screens
1. **Elder's recommendation:** task input, research progress, brief summary, councillor checkboxes with reasons, council effort, quick-quest offer.
2. **Council hut (interior):** side-on room (Alex Kidd shop style), councillors behind a long table, active speaker highlighted, "!" for who wants to speak, RPG dialogue box with portrait, options, "Why?", free text. Step tracker: Goal › Research › Questions › Plan › Dispatch. Book of Decisions on the table.
3. **Plan review:** plan, decisions, criteria; Approve / Change.
4. **Party assembly:** per worktree: hero class, reviewing councillors (recommended pre-checked), estimated cost.
5. **World map (overworld):** see §7.2.
6. **Party panel:** compact lineup usable as a bottom panel next to the terminal.
7. **Guild Hall (settings):** councillor roster, class armory (models), rule book, spell book (actions), asset/sound packs.
8. **Campaign end:** the party sails to **Ibitsa**, the party island, for a short celebration scene (skippable; respects reduced motion). Then: record summary, keep/compact/empty with council HP. A campaign ended with work abandoned or unshipped skips the celebration.

### 7.2 World map rules (Super Mario World overworld)
- **Home Village** island with the **council hut**; it represents `main` and the campaign start.
- Each worktree/branch is an **island**; tasks are **task points** connected by dotted paths, colored by state (locked, active, done, under review).
- Separate strategy: islands scattered, each reached from the village. Stacked: islands in a line with **bridges**; locked drawbridges.
- Heroes are **round tokens** with HP bars; councillors are **square tokens** with a parchment border and name plate, no HP bar.
- Councillors walk from the hut to a task point when a review starts and return when done.
- PR badges float above task points (or islands, for stacked).
- **Ibitsa** sits on the map's horizon as the campaign's destination: visible but out of reach until the campaign's work is shipped.
- Bottom area: selected task detail (council verdicts, PR card) and the "Needs you" queue.

### 7.3 HP and gold
- **HP** = remaining context window (from adapter context usage; estimated if unavailable). Resting (compaction) restores HP.
- **Gold** = spend. Shown per hero, per party and per campaign. Budget caps act as a hero's "gold pouch".
- Optional end-of-campaign efficiency score.

### 7.4 Accessibility
- Never convey information by sound or color alone: every state has an icon/shape.
- Text contrast ≥ 4.5:1 in UI chrome. Keyboard access for all actions. Reduced-motion setting.

---

## 8. Settings and customization

### 8.1 Layers
Resolved in order (later wins):
1. Built-in defaults
2. User settings
3. Project settings (committed to the repo)
4. Campaign overrides

Any item can be **extended**, **replaced** or **disabled**. The UI shows where each value comes from and offers "reset to default".

### 8.2 Configurable
- Councillors (modes, criteria templates, default skills, planning-only flag).
- Models per phase: elder research, council planning, reviewers (per councillor), summaries.
- Class → adapter + model map; new classes.
- Rules: review loop limit, blocking definition, deterministic checks per project, budget caps, max parallel parties, campaign-end default, PR polling interval, worktree location.
- Actions (§6.2).
- Asset packs and sound packs (§9).

### 8.3 Storage locations

| What | Where |
|---|---|
| Councillor and action skills | `~/.claude/skills/…` (user), `.claude/skills/…` (project) |
| User settings | VS Code settings + `~/.ibitsa/settings.json` |
| Project settings | `.ibitsa/settings.json` |
| Campaign documents | `.ibitsa/campaigns/<id>/{brief.md, plan.md, plan.json, record.md}` |
| Runtime state, session ids, event logs | VS Code workspace storage (not committed) |
| Asset/sound packs | `~/.ibitsa/packs/<pack>/`, `.ibitsa/packs/<pack>/` |

---

## 9. Assets and audio

### 9.1 Rendering
- Pixel art at internal resolution **480×270**, integer-scaled (letterboxed) to the panel.
- Base tile **16×16 px**.
- **Engine: Phaser 4**, pinned to an exact version (`4.2.1`, no `^`) and upgraded deliberately. Integer zoom and letterbox via `Scale.NONE` + `MAX_ZOOM` + `CENTER_BOTH` + `pixelArt` (reapply `setMaxZoom()` on resize). Renderer is `Phaser.WEBGL` only: without WebGL the panel shows a plain HTML notice and the game does not start; core and agents are unaffected. See [research](https://github.com/sandrofi84/ibitsa/blob/research/phaser-vs-pixijs/docs/research/phaser-vs-pixijs.md).
- **The engine stays inside `game`.** No other package imports Phaser. `game` renders from `protocol` snapshots and events and sends `protocol` commands; nothing engine-specific crosses that boundary. Pack formats (§9.3) are engine-neutral (frame size, animation rows, 9-slice insets), not Phaser atlases or Tiled maps. Tiled may be used inside `game` for fixed scenes (village, hut interior) as an internal detail; dynamic layouts (islands, task points) are built in code.

### 9.2 Visual asset spec (draft)

| Asset | Size | Contents |
|---|---|---|
| Character sprite sheet | 32×32 px per frame **[OPEN: 16×16 vs 32×32]** | One row per animation; facing right, mirrored for left |
| Portrait | 64×64 px | Neutral; optional 2-frame talking loop |
| Map tileset | 16×16 tiles | Water (4-frame loop), shoreline, grass, path dots |
| Island pieces | 96 px tall: left cap 48w, repeatable middle 32w, right cap 48w | Islands stretch to fit task count |
| Bridge | 32×24 repeatable segment + 2 ends | Drawbridge raised/lowered frames |
| Task point | 16×16 | locked, active, done, under review |
| Buildings | multiples of 16 (hut 64×64) | Village, council hut |
| Hut interior | 480×270 background + table foreground layer | |
| Dialogue frame | 24×24, 9-slice | |

Character animations:
- **Required:** idle (4 frames), walk (4), work (4).
- **Optional:** test, ask, blocked, rest, celebrate, hurt, review (councillors). Missing optional animations fall back (e.g. test → work).

### 9.3 Packs
- A pack = folder with `pack.json` manifest + PNG images + audio. **No scripts.** Size limits enforced.
- Manifest declares: files, frame size, animations (row, frame count, fps), foot anchor point, slot assignments (which character/class/tile each file fills).
- The built-in pack loads through the same loader and validator as user packs.
- **Upload validator:** checks dimensions, grid, required animations; shows specific errors; live animation preview and "try in scene".
- **Recolor:** tint/palette-swap of default sprites without drawing.
- New characters = appearance attached to a hero class or councillor.

### 9.4 Sound slots

| Event | Default idea | Length |
|---|---|---|
| Needs you | distinct chime | < 1 s |
| Councillor speaks | text blip, per-character pitch | very short |
| Task done | jingle | 1–2 s |
| Review passed / failed | two-note sting | < 1 s |
| PR opened / merged | scroll / fanfare | 1–2 s |
| HP low / resting | tick / inn chime | < 1 s |
| Campaign start / end | fanfare | 2–3 s |
| Scene music (village, map, hut) | optional loop | 30–90 s |

- Formats: OGG, MP3, WAV; loop points for music; max length for cues.
- Volume: master + per category (alerts, voices, effects, music). Focus mode (only "needs you").

### 9.5 Producing assets
1. **Phase 0 (now):** script-generated placeholder pack that matches the spec exactly; sfxr-style generated sounds (jsfxr/ChipTone); proves loader, manifest and validator.
2. **Phase 1 (alpha):** adapt CC0 packs (e.g. Kenney). Only use licenses that allow redistribution inside an extension package.
3. **Phase 2 (release):** commission a pixel artist for signature characters, portraits, hut and map style. Require source files and a license allowing redistribution and modification (including user recolors). Art license separate from code license; `ATTRIBUTION.md`.

---

## 10. Token efficiency rules

1. **Game master is code, not an LLM.** State transitions are free and deterministic.
2. **Research once.** The elder's brief is shared; heroes get the plan's "files likely touched" list instead of exploring.
3. **Single council session**, one model; questions batched.
4. **Fresh contexts over bloated ones.** Research transcript is dropped after the brief; new tasks start new sessions; low-HP "rest" may restart from a handoff summary.
5. **Model tiering.** Cheap models for research, summaries, simple tasks and first-pass reviews; strong models for planning and hard tasks.
6. **Lean sessions.** Per-role tool allowlists (reviewers read-only); load only equipped skills (never "all"); only needed MCP servers.
7. **Cache-friendly prompts.** Identical system prompt per role; variable content at the end; never put changing values (timestamps, HP) in system prompts.
8. **Free checks before LLM reviews**; reviewers get the diff + check output, not the repo; only relevant reviewers; re-reviews only by flaggers on the delta.
9. **Structured, short outputs** (JSON verdicts, plans); the game renders flavor text itself.
10. **Budgets:** per-hero caps and a per-campaign cap.
11. **Stall detection:** same file edited repeatedly, same test failing in a loop, or no progress for N turns → auto-pause and raise "?".
12. **Estimate vs actual logging** per task type and model, used to improve effort estimates.

---

## 11. Architecture

### 11.1 Language and packages
TypeScript throughout. pnpm workspaces monorepo:

```
packages/
  core/         game master, campaign state machine, rules, plan/decision model (no vscode imports)
  protocol/     shared types: commands, events, state snapshots (used by core, game, extension)
  adapters/
    agent-claude-sdk/   native Claude Agent SDK adapter (first-class)
    agent-acp/          generic Agent Client Protocol adapter
    agent-fake/         replays recorded sessions (tests, demos, game dev)
    git-github/         PRs, badges (gh / GitHub API)
    tickets-*/          later: GitHub Issues, Linear, Jira
  game/         webview renderer (Vite + Phaser 4)
  extension/    VS Code shell: panels, commands, storage, wiring (esbuild)
  assets/       default pack, manifest schema, validator
```

### 11.2 Process model
- v1: core runs inside the extension host.
- Core communicates with the shell and the game **only through `protocol` messages** (commands in, events and state snapshots out), so it can later move to a background daemon (campaigns survive window reloads; other front ends possible) without rewrite.
- The webview never talks to agents. It renders state and sends user intents. On reopen, it rebuilds from the core's state snapshot.

#### 11.2.1 Protocol (M0–M1)
Settled in [#8](https://github.com/sandrofi84/ibitsa/issues/8). The webview and the extension shell (status bar, notifications while the panel is closed) consume the same messages.

- **Snapshots + cues.** State reaches a front end only as a full `Snapshot`, sent after changes and throttled (~10/s). **Cues** are fire-and-forget effects (animation, sound, toast) that carry no state; dropping any cue must be harmless.
- **Domain view only.** `AgentEvent` never leaves core. Snapshots describe the world in glossary terms with no layout or coordinates; `game` decides positions (§9.1).
- **Unknown is explicit.** Every measured value is a `Reading<T>`; front ends must render all three cases (`?` for unknown, `~` for estimated). Totals (party, campaign) are computed in core, never summed by a front end.
- **Money** is integer micro-dollars, converted once from the SDK's float in the adapter. Display as gold is a `game` concern.
- **Commands are fire-and-forget** with a `commandId`. Success shows in a later snapshot; failure arrives as a `commandRejected` cue. Front ends never update state optimistically.
- **Ordering and versioning.** Every core → front end message has a monotonic `seq`; front ends drop stale snapshots and cues older than the shown snapshot. A front end opens with `hello`; core replies `welcome` + snapshot. Version mismatch → "reload the panel".
- **Validation.** Commands are validated at core with Valibot schemas (types derived from them). Snapshots and cues are plain types.
- **Reopen.** After the handshake the game jumps to the current state; cues are not replayed. View-only state (selection, camera, open panes) lives in the webview (`setState`) and never reaches core.
- **Permissions** are shown as an exact, unparaphrased `{ action, target, cwd }` rendered by core from the tool input; unrecognized tools fall back to `{ action: tool, target: <input JSON> }`.

```ts
type Reading<T> =
  | { kind: 'exact'; value: T }
  | { kind: 'estimated'; value: T; basis: string }   // e.g. "tokens × price table"
  | { kind: 'unknown' };
type MicroUsd = number;                              // integer

interface Snapshot {                                 // seq lives on the CoreMessage
  campaign: CampaignView | null;                     // { id, title, gold: Reading<MicroUsd>, ... }; M1 shape: #11
  islands: IslandView[];                             // { id, name, branch, taskPoints: TaskPointView[] }
  heroes: HeroView[];
  needsYou: NeedsYouItem[];                          // oldest first
}

interface HeroView {
  id: string; name: string; classId: string;
  islandId: string; taskPointId: string | null;
  state: ExecutionState | { kind: 'unknown' };       // states and triggers: #10
  activity: { kind: ActivityKind; detail?: string } | null;
  hp: Reading<{ used: number; max: number }>;
  gold: Reading<MicroUsd>;
  queuedMessages: number;
}

type NeedsYouItem =
  | { kind: 'permission'; id: string; heroId: string; action: string; target: string; cwd: string }
  | { kind: 'question'; id: string; heroId: string; questions: AskUserQuestion[] };

type Command =                                       // validated at core
  | { type: 'hello'; protocolVersion: number }
  | { type: 'sendMessage'; commandId: string; heroId: string; text: string; priority: 'now' | 'next' }
  | { type: 'stopHero'; commandId: string; heroId: string }   // interrupt + clear adapter queue
  | { type: 'answerPermission'; commandId: string; itemId: string; decision: 'allow' | 'deny'; note?: string }
  | { type: 'answerQuestion'; commandId: string; itemId: string; answers: Record<string, string | string[]> };
  // starting a hero: #11

type CoreMessage =
  | { type: 'welcome'; seq: number; protocolVersion: number }
  | { type: 'snapshot'; seq: number; snapshot: Snapshot }
  | { type: 'cue'; seq: number; cue: Cue };

type Cue =                                           // #10 may add more
  | { type: 'commandRejected'; commandId: string; reason: string }
  | { type: 'needsYouAdded'; itemId: string }
  | { type: 'activityFinished'; heroId: string; kind: ActivityKind; outcome: 'ok' | 'failed' };
```

### 11.3 Agent adapter interface (sketch)

```ts
interface AgentAdapter {
  id: string;
  capabilities: AgentCapabilities;
  startSession(opts: SessionOptions): Promise<AgentSession>;
  resumeSession(sessionId: string, opts: SessionOptions): Promise<AgentSession>;
}

interface AgentCapabilities {
  contextUsage: boolean;     // else HP is estimated or hidden
  subagents: boolean;        // else reviews run as separate sessions
  nativeSkills: boolean;     // else skill text is injected into prompts
  queuedMessages: boolean;   // else messages wait for end of turn
  compaction: boolean;       // else "rest" = fresh session from summary
  interrupt: boolean;
  budgetCap: boolean;
}

interface SessionOptions {
  role: 'elder' | 'council' | 'hero' | 'reviewer';
  model: string;
  cwd: string;
  systemPrompt: string;
  skills?: string[];
  allowedTools?: string[];
  readOnly?: boolean;
  budgetUsd?: number;
  customTools?: CustomTool[];   // e.g. ask_user
}

interface AgentSession {
  id: string;
  send(text: string, opts?: { priority: 'now' | 'next' }): Promise<void>;
  interrupt(): Promise<void>;
  compact?(): Promise<void>;
  contextUsage?(): Promise<{ used: number; max: number }>;
  events: AsyncIterable<AgentEvent>;
  respondToPermission(id: string, decision: 'allow' | 'deny', note?: string): Promise<void>;
  close(): Promise<void>;
}

type AgentEvent =
  | { type: 'activity'; kind: 'read' | 'search' | 'edit' | 'run' | 'test' | 'think'; detail?: string }
  | { type: 'message'; text: string }
  | { type: 'question'; id: string; payload: AskUserPayload }
  | { type: 'permission'; id: string; tool: string; input: unknown; reason?: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; costUsd?: number; contextUsed?: number; contextMax?: number }
  | { type: 'compacted' }
  | { type: 'done'; summary?: string }
  | { type: 'error'; error: string };
```

- **Model registry:** models with adapter id, vendor model name, price info (for gold), context window. Hero classes reference registry entries.
- Other adapter families (git host, tickets) follow the same pattern: interface + capability flags.

### 11.4 Claude Agent SDK adapter: mapping (verify against current docs)

| Need | SDK feature |
|---|---|
| Start session, stream events | `query()` async generator; `includePartialMessages` |
| Model per session / change | `model` option; `setModel()` |
| Working folder | `cwd` |
| Skills | `skills` option, `settingSources` |
| Reviewers as subagents (optional) | `agents` with `AgentDefinition` (`prompt`, `tools`, `model`, `skills`) |
| Questions / permissions | `canUseTool` callback; AskUserQuestion; custom tools for `ask_user` |
| Interrupt | `interrupt()` |
| Messages while running | `streamInput()` with `priority: 'now' | 'next' | 'later'` |
| HP | `getContextUsage()` |
| Resting | `compact_boundary` messages; `PreCompact`/`PostCompact` hooks |
| Resume after restart | `resume`, `listSessions()` |
| Gold pouch | `maxBudgetUsd` |
| Activity mapping | tool-use messages; `PreToolUse`/`PostToolUse` hooks |

Verified 2026-10-04 against `@anthropic-ai/claude-agent-sdk@0.3.289` ([research](https://github.com/sandrofi84/ibitsa/blob/research/agent-sdk-m1/docs/research/agent-sdk-m1.md)). Every row exists; corrections to the table and the §11.3 sketch:
- **Compaction:** no `compact()` method; send `/compact` as a prompt and watch `status: 'compacting'` then `compact_boundary`.
- **Questions:** AskUserQuestion arrives through `canUseTool` like a permission; answered by returning `updatedInput: { questions, answers }`.
- **Priority** (`'now' | 'next' | 'later'`, default `'next'`) is a field on each streamed message, not a `streamInput` argument.
- **Cost:** `total_cost_usd` and `modelUsage` are running totals; `maxBudgetUsd` applies per call, so a resumed session starts a fresh budget.
- **`allowedTools`** only auto-approves; `tools` / `disallowedTools` restrict.
- **Stop:** `interrupt()` does not cancel messages already queued; the adapter must hold its own queue.
- All control methods require streaming input mode.

### 11.5 ACP adapter
- Generic adapter for any Agent Client Protocol agent (Codex, Gemini CLI, Copilot, OpenCode, …). Reports reduced capabilities; the core uses fallbacks (§11.3).

### 11.6 Security and permissions
- Per-role tool allowlists; reviewers and council read-only.
- A short default allowlist of safe actions (read, search, run tests); everything else becomes a permission request in "Needs you".
- Heroes are confined to their worktree.
- Pack files are images/audio/manifest only.
- **Auth:** v1 uses the user's own Anthropic API key (or a Bedrock/Vertex/Foundry credential), read from settings, VS Code SecretStorage or the environment. The extension never runs its own claude.ai login and never handles claude.ai credentials: Anthropic does not allow third-party developers to offer claude.ai login without approval. For local development the developer may use their own Pro/Max login. Reusing a subscription login the user already made in Claude Code needs written confirmation from Anthropic; recheck terms before M10. See [research](https://github.com/sandrofi84/ibitsa/blob/research/auth/docs/research/auth.md).

---

## 12. Persistence and recovery
- Every session id, campaign state and plan version is persisted so a VS Code restart resumes the campaign: sessions are resumed, map state is rebuilt from core state.
- All agent events are appended to a per-campaign event log (workspace storage). Logs double as replay fixtures for `agent-fake`.

---

## 13. Development workflow
- **Builds:** esbuild for `extension` (Node, `vscode` external); Vite for `game`.
- **Agent SDK packaging:** the Claude Agent SDK runs a native `claude` binary that it ships as per-platform optional npm dependencies. Keep the SDK external to esbuild (it locates the binary next to its own module) and load it with `import()` (ESM only). Publish **platform-specific VSIX packages** (`vsce package --target`): darwin-x64/arm64, linux-x64/arm64, alpine-x64/arm64, win32-x64/arm64, to both registries, built on one CI runner with `npm ci --os/--cpu/--libc`. Optional setting `ibitsa.claudeCodePath` → `pathToClaudeCodeExecutable`. See [research](https://github.com/sandrofi84/ibitsa/blob/research/sdk-vsix-packaging/docs/research/sdk-vsix-packaging.md).
- **Fast loops:**
  - Game: run `game` standalone in a browser with Vite HMR, driven by a fake core replaying recorded event logs.
  - Core: Vitest with the `agent-fake` adapter. No tokens spent in tests.
  - Full integration: F5 Extension Development Host.
- **Tests:** Vitest (unit), `@vscode/test-cli` / `@vscode/test-electron` (integration, headless in CI), Playwright against the standalone game build (visual/e2e).
- **Webview:** load assets via `asWebviewUri` and `localResourceRoots` (including user pack folders); strict CSP (no `unsafe-eval`, `img-src ${webview.cspSource}` only); bundle everything (no CDNs); don't rely on `retainContextWhenHidden`. Phaser's built-in textures (`__DEFAULT`, `__MISSING`, `__WHITE`) come from bundled PNGs via its `images` config rather than `data:` URIs.
- **Engine check (first M0 work):** F5 opens the game panel; Phaser renders a 480×270 scene integer-scaled and letterboxed to the panel, re-scales on resize, with no CSP errors in the console. If this fails, reopen the engine choice before anything else builds on Phaser (fallback for a `data:` need: allow `img-src data:`).
- **Publishing:** `vsce` to the VS Code Marketplace and `ovsx` to Open VSX (Cursor, VSCodium, Windsurf, …). GitHub Actions: build, test, package, publish on tag.

---

## 14. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold | Monorepo, protocol types, esbuild + Vite builds, F5 opens an empty game panel, `agent-fake` replaying a log drives a token on a map in the standalone game. Placeholder asset pack generated to spec. |
| M1 | One hero | Claude SDK adapter; one hero in one worktree; live activity animations, HP bar, gold; stop and send message (queued/now); "Needs you" for permissions/questions. |
| M2 | Command bar & actions | `@` targets and files, `/` actions as skills, preview, controls, Command Palette entries. |
| M3 | Elder & council | Research brief, council selection, single council session, `ask_user` with voices and "Why?", plan + decision records saved, approval loop, quick-quest path. |
| M4 | Parties & map | Multiple worktrees, separate and stacked layouts, bridges, party assembly, blocked states. |
| M5 | Review loop | Deterministic checks, concurrent reviewers, verdicts, loop limit, escalation, councillors walking on the map. |
| M6 | PRs | Git-host adapter, PR per task, stacked bases, badges with polling. |
| M7 | Campaign lifecycle | Campaign record, keep/compact/empty, mid-campaign council and amendments, resume after restart. |
| M8 | Customization | Settings layers, Guild Hall, councillor editing, class/model mapping, asset & sound packs with validator and recolor, sounds. |
| M9 | Agent-agnostic | ACP adapter with capability fallbacks. |
| M10 | Release | Real art, accessibility pass, docs, Marketplace + Open VSX publishing. |

---

## 15. Open questions
1. Name registration: domains (ibitsa.com, ibitsa.dev, questforibitsa.com), GitHub org, npm scope, Marketplace/Open VSX publisher; trademark search (EUIPO TMview, USPTO). Initial checks found no conflicting software use.
2. Rogue = Haiku confirmed? Default class roster and names.
3. Character sprite size: 16×16 (more CC0 art available) vs 32×32 (more readable).
4. ~~Game engine: Phaser vs PixiJS.~~ Settled: Phaser 4 (§9.1).
5. Councillor skill location so they don't clutter the normal `/` menu.
6. Whether Claude Code tolerates extra frontmatter fields (for action `target`), else sidecar.
7. Confirm SDK invocation of custom skills via `/name` prompts.
8. ACP capability coverage per agent.
9. Subscription sign-in for a published extension (terms).
10. Default max parallel parties.
11. Specialist dives (planning subagents): add later or not.
12. Optional `@ibitsa` VS Code chat participant.
