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
- In the game world, **Ibitsa is a legendary island nobody has found**. Settled in M8 planning, the **lore**:
  - You are searching for Ibitsa, and go to the council for help. The elder welcomes you: "We heard you are looking for Ibitsa…" and asks "…what do you want to do there?" (the task).
  - Nobody knows where it is. The elder **searches the old charts** (research), and the council's plan charts the **possible locations** (the islands).
  - When the work has shipped, the heroes sail for Ibitsa on the horizon, and it fades into mist as they near it: "Not Ibitsa. The search goes on." The next quest continues the search.
  - The lore lives in the game's words only. The spec, glossary and code keep their plain terms (campaign, island, research brief).
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
| **Sitting** | One meeting of the council to plan a campaign, held as a **round table** (one session voices every councillor) or in **separate chambers** (each councillor studies alone, then reports). |
| **Effort** | Light, Standard or Deep: which models a councillor or council uses and how much it may spend. |
| **Research brief** | Short document written by the elder's research pass, with a slice for each councillor's field; input to planning. |
| **Tally** | What a sitting cost and produced, plus the user's rating; used to compare sittings. |
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
2. **Research.** The elder (cheap/fast model) researches the codebase and writes the **research brief**: relevant files, current patterns, open questions, a slice for each councillor's field, recommended councillors with a one-line reason each, recommended effort, and whether this is a **quick quest**.
3. **Quick quest path.** If the task is small and clear, the elder offers to skip the council and dispatch a single hero directly.
4. **Convene the council.** The user picks how the council sits (**round table** or **separate chambers**, §4.3), the councillors (checkboxes, recommended ones pre-checked with reasons) and the **effort**: one for a round table, one per councillor in separate chambers (each pre-set by the elder with a reason).
5. **Planning.** The sitting starts from the brief. Every councillor files a report on its field; the elder asks the user steering questions in the voice of the councillor who raised them, and any councillor can be questioned about trade-offs ("Why?").
6. **Plan proposal.** The elder presents the plan: tasks, dependencies, branching strategy (separate or stacked), suggested hero classes, acceptance criteria per reviewing councillor, decision records.
7. **Approval.** The user approves, or requests changes with context. The plan is written to the campaign folder (§8.3); Ibitsa never commits it.
8. **Assemble parties.** One party per worktree. The user picks the hero class per party and which councillors join each party (= will review its work). All pre-filled with recommendations from the plan.
9. **Adventure.** Heroes work on the map. The user can talk to any party or to the council at any time.
10. **Review loop.** When a hero submits a task, its party's councillors review it concurrently against the agreed criteria. Blocking findings send the hero back. Loop ends when all are satisfied or the loop limit escalates to the user.
11. **PR.** One PR per island (its branch), opened by the user from the island's PR card, as a draft early or ready once the island is cleared. PR status is shown as a badge above the island (§5.6).
12. **Campaign end.** The council writes the **campaign record**. The user chooses to keep (default), compact or empty the council's context.

---

## 4. The council

### 4.1 Elder and research pass
- A new quest's description goes to the elder first (#101). The New Quest form opens on the task alone: **Ask the elder**, or **Skip the elder** for a quick quest straight away (the hero's fields appear). Asking the elder starts the campaign in a **planning** phase: it is logged and survives a reload like a quest, but has no hero yet. Research cut short by a reload is marked failed and can be asked again; **Abandon** ends the planning campaign.
- The elder runs a **separate, short research session** on a cheap/fast model (`ibitsa.elder.model`, default Haiku), with only `Read`, `Grep` and `Glob` (every other tool is denied), at most 40 turns, capped at **$0.25** (`ibitsa.elder.budgetUsd`). It is told the task and the councillors it may recommend. It ends by calling a custom `submit_brief` tool; the adapter checks the brief against the schema and that it names only councillors who exist, and hands any problems back to the elder to fix. Ending any other way (out of gold, out of turns, no brief) is an error shown in the elder panel, with **Ask again**, **Quick quest anyway** and **Abandon**.
- The brief is written to `.ibitsa/campaigns/<id>/brief.json` and `brief.md` (`<id>` is the campaign's log id).
- Checked live (#101, opt-in smoke): Haiku researched a small task in this repository with the built-in councillors and filed a valid brief in about 30 s.
- **Quick quest** from the brief continues the same campaign; the hero's first message is the task followed by the brief's files and findings, so it needn't explore (§10 rule 2).
- The **research brief** has a fixed structure:
  - Task restatement
  - File map: relevant files and areas (paths + one line each)
  - Shared findings: existing patterns, conventions, risks and unknowns
  - **Field slices:** for each recommended councillor, what in this task touches its field (paths with line ranges, a short summary). Pointers, not file contents.
  - Recommended councillors (id, reason) and effort: one for a round table, and one per councillor for separate chambers (level, reason)
  - Quick-quest verdict (yes/no + reason)
- The brief is written **before** the user chooses a quick quest or a sitting, and both kinds of sitting start from it, so the two differ only in how councillors work (§4.3).
- **Past campaigns** (M7 planning): the elder's research gets an index of past records (title, date, one-line summary, path to `record.md`) and reads only those that look related. The brief gains **Related campaigns**, shown in the elder panel. When the council's context was kept (§4.9) and the new task looks unrelated, the elder says so and suggests starting fresh. (#168:) The index is the 20 newest `record.md` files under `.ibitsa/campaigns` (title, status and summary read from the record's top), and the brief may only name campaigns from it. The brief's `keptContext` says whether the task relates to the kept council's work; the convene form then offers **Start fresh instead of resuming the council kept from …**, ticked when the elder found it unrelated. Starting fresh forgets the kept session.
- The raw research transcript is **not** carried into planning. The brief is the handoff. It is kept in the campaign folder and reused by reviews (M5).

### 4.2 Choosing the council
- UI (#103): the **convene form**, opened from the elder panel's **Convene council**. How the council sits (**Round table** / **Separate chambers**; asked each time while `ibitsa.council.mode` is `ask`, the default, else stated); list of available councillors with checkboxes, recommended ones pre-checked with the elder's reason; effort (one selector for a round table, one per councillor in separate chambers, each set to the elder's pick with its reason, and the sitting's effort then sets the chairing elder's model); the most it can cost, as you change them.
- **Effort levels** (models and caps configurable; starting defaults, tuned from tallies, §4.10):

| Effort | Models | Round table cap | Per councillor in chambers |
|---|---|---|---|
| Light | Haiku | $0.50 | $0.10 |
| Standard | Sonnet; Haiku for a councillor with nothing to add | $2 | $0.40 |
| Deep | Opus for serious concerns, Sonnet otherwise | $6 | $1.20 |

  In separate chambers the elder also keeps a $0.30 reserve for summing up. Reaching a cap is not an error: the councillor or sitting wraps up with what it has and says what it didn't check.
- The last selection is remembered per project as the default for next time, used when the elder recommends no councillors ("Reset to defaults" available later, M8).
- Convening without the elder's campaign starts a planning campaign of its own. While the council sits the elder panel steps aside; when the sitting ends it comes back, to convene again or start a quick quest.
- While the game tab is hidden, each new batch of questions and each plan waiting for approval raises a VS Code notification (with "Open Game").
- Councillors can also be added during planning.

### 4.3 The sitting: round table or separate chambers
Both kinds of sitting are built, so they can be measured against each other on real tasks (§4.10). They share everything except how reports are produced:

- **Shared:**
  - The **roster** is fixed when the council convenes (the user can drop a councillor; adding one mid-sitting adds it to the roster).
  - Each councillor files a **report** through a custom `report` tool, in a fixed short schema: concerns (each with severity and reason), questions for the user, recommendations, and **what it didn't check**.
  - A councillor with nothing to add files a one-line report saying why ("nothing in my field, because …"). That still counts.
  - The elder proposes the plan with `propose_plan` (§4.5), which is **rejected until every councillor on the roster has filed a report**.
  - Every `ask_user` question names a councillor on the roster (§4.4).
  - Read-only tools only.
  - **Talking to the sitting (#242):** the user can write to the council at any time, to all of it or to one councillor on the roster, with `consultCouncil { text, councillorId? }` (the command that asks an approved council, §4.8; while the council sits it goes to the sitting instead). Core records the user's line in the dialogue and sends the lead session a `told` message; the council answers with `say` and carries on. Refused while a plan waits for approval (approve it or ask for changes).
  - **A council that waits (#242):** when the lead session ends a turn with no chamber still at work, the adapter says so with an `idle` event (it tracks the SDK's running tasks: `task_started`, `task_notification`, `background_tasks_changed`; a chamber can outlive the elder's turn). If no question is open and no plan waits, core marks the sitting **waiting** (`SittingView.waiting`) until the session takes another turn. Found in a playtest: the elder learned the task couldn't go ahead, said so and ended its turn, and the hut showed nothing more. A waiting sitting isn't woken after a reload: it waits for the user.
- **Round table** (#103): one session on the chosen effort's model and cap (Light Haiku $0.50, Standard Sonnet $2, Deep Opus $6), read-only (`Read`, `Grep`, `Glob`; everything else denied). Its first message carries the task, the whole brief, and each councillor's opening lines and `## Planning` section from its skill; the system prompt is the same for every round table, so it caches. It voices each councillor, filing a report per councillor. Attribution is the model's word.
  - A tool handler knows which call it serves from Claude Code's request metadata (`_meta["claudecode/toolUseId"]`), not from the order hooks ran in: calls made at the same time (chambers reporting in parallel) can reach their handlers in any order. Found by the first live separate-chambers run (#105), where one report was filed out of turn.
  - Tools: `report`, `ask_user`, `propose_plan` and `say` (a line from a councillor or the elder, e.g. answering "Why?"). Core rules on every call and its verdict is the tool's result, so a rejection ("Waiting for: security") reaches the model to fix.
  - `ask_user` returns as soon as core accepts the batch and the session ends its turn: the answers, "Why?", change requests and added councillors all arrive later as messages. A tool call that waited for the user would block the model from answering "Why?".
  - Checked live (#103, opt-in smoke, Haiku): with Architect and Tester on a small task in this repository it filed both reports, asked one question with options and a recommendation, took the answer as a message and proposed a plan, every call accepted first time.
  - Reaching the cap ends the sitting as failed ("ran out of gold"), keeping the reports so far; a softer wrap-up before the cap is left for later (the session only learns its cost at the end of a turn).
- **Separate chambers** (#105): the elder chairs a session (on the sitting effort's model) and each councillor runs as an SDK **subagent** (`agents` option, dispatched with the `Agent` tool) with its own context, model and step budget from its effort: Light Haiku 8 steps, Standard Sonnet 15, Deep Sonnet 25. Every councillor the workspace has gets a chamber, so one added mid-sitting can be dispatched; the elder may dispatch only these (`canUseTool` denies anything else).
  - Each chamber is told its step budget and to report two steps before it runs out, listing what it didn't reach under "not checked"; folders are listed with Glob, not Read. Checked live (#105, Haiku, $0.31): both chambers reported and a valid plan came back, but before this a Tester chamber spent its 8 steps reading and the elder dispatched it five times (about three quarters of the cost).
  - A chamber's prompt carries everything it needs: its skill's opening lines and `## Planning` section, its field slice of the brief, the shared findings and the file map. It isn't preloaded from the skill (`AgentDefinition.skills`), because a user skill may not be loaded under `settingSources: ['project']`, and it needs no dispatch hook because the slices are known when the sitting starts.
  - The councillor reads more only when its slice isn't enough, within its steps.
  - **Attribution comes from the SDK:** a `report` call is filed under the chamber that made it, as the PreToolUse hook names it (`agent_type`, present inside a subagent), not as the model claims. A report claiming another councillor, or filed by the elder itself, is turned down through the tool result without reaching core.
  - Subagents can't talk to the user mid-run; their questions go into their reports, and the elder asks them. "Why?" is answered from the councillor's report, or by dispatching it again.
  - On a change request the elder dispatches again only the councillors the change affects.
  - At Deep effort a councillor also has a deeper pass, `<id>-deep` (Opus, 12 steps), which the elder may dispatch on a serious concern; its report counts for the same councillor.
  - **Caps:** the session's `maxBudgetUsd` is every chamber's share (Light $0.10, Standard $0.40, Deep $1.20) plus the elder's $0.30 reserve. The SDK enforces only that total; each chamber is held to its share by its step budget, not by dollars, so one chamber can spend more than its share if the others spend less.
- **Fallback if separate chambers proves unreliable:** Ibitsa runs each councillor as its own session in code-controlled rounds, which also lets prompts put the brief first so it can be a cache hit for every councillor.

### 4.4 Questions, "Why?" and voices
- The sitting asks the user questions only through a custom tool (in separate chambers, only the elder calls it):

```ts
ask_user({
  councillor: string,          // id of a councillor on the roster; drives speaker, portrait, voice
  report?: string,             // the report the question comes from (separate chambers)
  question: string,
  options: { id: string; label: string; tradeoff: string }[],
  recommendation?: { optionId: string; reason: string },
  allowFreeText: boolean
})
```

- Questions are **batched** where possible. Ibitsa rejects a question whose councillor isn't on the roster.
- The dialogue box shows the councillor's portrait and offers the options with their trade-offs, the recommendation, free text, and **"Why?"**. "Why?" opens a short back-and-forth with that councillor (in a round table, the same session; in separate chambers, the elder answers from the councillor's report and can consult it again); other councillors may chime in when their concern is affected.
- **How "Why?" flows (#102):** the user sends `askCouncilWhy { batchId, questionId, text? }` (`text` is their own follow-up, else just "Why?"). Core records the user's line in the sitting's **dialogue** and sends the lead session a `why` message naming the question and its councillor. The answer comes back as `said { councillorId, text, questionId? }` events: the asking councillor explains; others chime in with further `said` events. Only councillors on the roster and the elder can speak. The question stays open throughout, and the dialogue box shows the lines about the current question.
- **In the game (#102):** the hut shows by itself while the council sits and the map returns when the sitting ends. New quest is hidden in the hut. The command bar talks to the council there (#242): everything typed goes to the sitting, `@<councillor>` to one of them (the `@` menu offers `@council` and the roster); the dialogue box and the plan review take its place while they're open. The council's latest line that isn't about an open question (say, the elder ending its turn) shows just above the bar. The box steps through a batch one question at a time (Back, Next), number keys pick an option, and all answers go back in one `answerCouncil`. The asking councillor has the floor; others with questions in the batch raise their hands. **Later** puts the box away, and the questions wait in "Needs you" (one item, counted in the tab title) until **Answer** reopens it.
- **The council's pane (#242):** docked top right in the hut like the hero pane, collapsed to a tab that says what the council is doing (gathering, studying with how many reports are in, deliberating, asking, waiting on you, a plan waiting). Open, it lists each councillor's report in brief, the **journal** of everything said at the sitting, the gold spent, and **Dismiss the council**, offered at any point of the sitting (it asks once more). A council waiting on the user is one "Needs you" item (**Reply** puts the keyboard in the command bar), counted in the tab title, and a notification when the game is hidden.

### 4.5 Plan document and decision records
- The plan is proposed with a custom `propose_plan` tool. **Core** checks it (`checkPlan`, #104), whatever session proposed it: the schema (`PlanSchema`: summary, goal, scope, tasks `T1…` with description, files likely touched, dependencies, suggested hero class, criteria per reviewing councillor and the decisions they depend on; decisions `D1…`), unique ids, dependencies and decisions that exist without a cycle, criteria only from councillors on the roster, decisions raised by someone at the table. Problems go back to the council as the tool's result, one per line. The every-councillor-reported rule (§4.3) comes first.
- On approval Ibitsa writes `.ibitsa/campaigns/<id>/plan.json` (the game reads it), `plan-v<n>.json` (each approved version kept) and `plan.md` (for people, decisions in the record format below). Ibitsa writes campaign documents but never commits them; the user decides whether they belong in the repo.
- Plan contents:
  - Goal and scope
  - Tasks (id, title, description, files likely touched, dependencies, suggested hero class, estimated effort, optional source ticket).
  - **Islands** (#120): `I1…`, each a title and its tasks in the order its hero works them, and **branching** `separate` or `stacked`; stacked islands stack in the order listed. Core checks every task is on exactly one island, each island's order keeps its own dependencies, a stacked task depends only on its own or earlier islands, and separate islands don't wait on each other in a circle. A plan without islands is one island with every task, separate. A **ticket** is an item in an outside ticket system; it is not part of the game world. See `GLOSSARY.md`.
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
- **Approve**, **Change** with free-text context, or **Dismiss the council**, in the **plan review** in the hut (#104): the summary and goal, the tasks in the order the hero will work them (files, dependencies, criteria per councillor, decisions kept to) and the Book of Decisions. The hut's Book of Decisions shows how many decisions the plan records.
- A change goes to the elder, who revises. In separate chambers the elder consults again only the councillors the change affects; each consultation is recorded and costed, and the every-councillor-reported rule still holds. No cap on revisions; each shows what it cost.
- Each approved version is saved; amendments later in the campaign create new versions with a visible diff.
- The elder panel shows the approved plan with **Assemble the parties** (§7.1 screen 4, #123), which sends `startCampaign`: a party per island, each hero working its island's tasks in order.

### 4.7 Councillor definitions
- Each councillor is **one class with two modes**:
  - **Planning mode:** what concerns to raise, what to research, how to write acceptance criteria.
  - **Review mode:** how to review a diff against criteria, what counts as blocking vs suggestion, output format.
  - A councillor may be planning-only (e.g. Product).
- Stored as Claude Code skill files with Ibitsa's own frontmatter fields: `ibitsa-councillor: true`, and optionally `ibitsa-title` (else the name capitalised), `ibitsa-portrait`, `ibitsa-model` and `ibitsa-tools`. Tools are kept to read-only ones (`Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`); without any, `Read`, `Grep`, `Glob`. The body has a `## Planning` and/or `## Review` section; a body with neither is all planning advice. A councillor's id is its skill name without a plugin prefix (#98).
- Built-ins ship in Ibitsa's plugin (`ibitsa:architect`, …); users add their own in `~/.claude/skills/` and projects in `.claude/skills/` (§8.3), found the same way as actions (§6.2). A councillor with the same id **replaces** an earlier one: project over user over built-in. `ibitsa.council.disabled` lists ids the council never seats. (M8 planning:) In the Guild Hall's Roster, **Customise** copies a councillor's skill file to your or the project's `.claude/skills/<id>/SKILL.md` and opens it in the editor (replace); **Extend** overrides fields only (title, model, tools, portrait) through `ibitsa.councillors.<id>`; **New councillor** writes a skill from a template. (#181:) The Roster lists every councillor (the snapshot's `roster`, turned-off ones included) with its source, modes and model, a **Sits on the council** switch, Title and Model overrides with their layer and Reset, and Customise. Changes go to your settings or the project's. The adapter applies overrides whenever it lists councillors, so sittings and reviews see them too, and a changed override gives a new council version (§4.10). Customise copies only a `SKILL.md` from a skills folder and never overwrites an existing copy, which it opens instead; the same goes for a new councillor, whose id must be a skill folder's name (lowercase words and hyphens). Turning a councillor off writes the whole list to the chosen layer, since VS Code doesn't merge lists across layers.
- Default roster (v1): Elder, Architect, Tester, Accessibility, Security, Designer, by role title, each with a one-line manner of speaking. Names and personas wait for the commissioned art (§9.5, phase 2).
- Councillor skills must not be auto-invoked by the model in normal Claude Code use (`disable-model-invocation: true`), and carry `ibitsa-target: council` so the hero's `/` menu leaves them out. `disable-model-invocation` doesn't stop a skill being preloaded into a subagent: Claude Code 0.3.289 skips a preloaded skill only when it's missing, not prompt-based, disabled by policy, or account-synced with sync off (read from the bundled CLI, #98).

### 4.8 Talking to the council mid-campaign
- `@council` messages go to the sitting's lead session (the round table's session, or the elder's in separate chambers; resumed). It does **not** stop heroes.
- The game master gives the council a **compact status report** (tasks done, current findings, blockers, PR states), never heroes' transcripts.
- Plan changes become a **plan amendment** naming affected parties and potential rework. The user confirms. Affected parties receive it as a **queued** message (delivered after their current step).
- Settled in M7 planning:
  - **Reaching it:** `@council` in the command bar, or `@<councillor id>` (same lead session, naming who's asked), or clicking the council hut, which opens the sitting view with a message box. Each consultation is capped (`ibitsa.council.consultBudgetUsd`, $0.50).
  - **Replies** are dialogue lines in the hut in the voice of the councillor who speaks, as with "Why?" answers; a short notice appears while the hut is closed.
  - **Separate chambers:** the elder answers, and may send a question to a councillor's chamber (a subagent, as in planning) when it's in that field, within the cap.
  - **Amendments** come from a `propose_amendment` tool. They may add tasks to an island, edit or remove tasks not started yet, add islands and add decisions. Done or active tasks never change: rework is a new task. The plan review screen shows the change set (added, edited and removed tasks marked) with **Approve**, **Request changes** (with a note) and **Discard**. An approved amendment adds an "Amendment N" section to `plan.md` and `plan.json`, and affected heroes get it as a queued message.
  - **How it runs** (#169): `consultCouncil` resumes the approved sitting's lead session for one turn (a `startSitting` effect with `resume`, #166), told the question and a status core builds from its state: each island's tasks and PR, the blocking findings still open, each hero's state and what waits on the user. The turn's usage ends it, its cost joins the campaign's gold, and the session closes. One question at a time; asking again while the council answers is refused. Reports, questions and plans the session tries are refused ("answer the user with say"). A reload, or the quest ending, drops an open question.
  - **A new island** gets a small party assembly of its own (hero class and name, reviewers, review efforts, gold cap). A separate island fans out from the village; a stacked one joins the end of the line. It waits for a slot like any other.
  - (#170:) The council proposes an amendment while it answers a question (`propose_amendment` is offered with every one). Core checks it like a plan, against what has started: a task past `locked`, or a hero's current task. A new proposal supersedes one still waiting. **Approve** checks it again, since work may have started meanwhile. **Request changes** is a turn of the council's own, capped like a question, in which it proposes again. The amendment stays on the sitting, so the approved plan is always the plan with its approved amendments applied: reviews take criteria and decisions from it.
  - Applying it: task points not started are edited or removed in place, new tasks go to the end of their island, and new islands wait for their party (a Needs you item, **Assemble**). A hero whose island was done gets the new work at once, resuming its session. Other heroes on a changed island are told what changed, after their current step. The amendment review shows over the map while one waits, with a Needs you item pointing to it.

### 4.9 Campaign end
Settled in M7 planning (it changes the earlier draft: the record is built, not written by the council, and the default is Empty).
- Every campaign gets a **campaign record** (`record.md`), on **Finish** (offered once the campaign has shipped, §5.6, and available any time) and on **Abandon** (marked abandoned). It is built from the log, with no tokens: the decisions, each island with its PR (link and state), what was deferred (unfinished tasks, suggestions kept but not done, dismissed "revisit" requests), the gold spent and the sittings' tallies. A short **Lessons** section is written by the elder on Haiku (about $0.05 cap) from the review rounds, escalations and disputes.
- After the record, **Finish** asks what to do with the council's context, showing its size:
  - **Empty** (default): the next campaign starts fresh; the record keeps the knowledge, and the elder reads the past records that look related (§4.1).
  - **Compact**: the lead session is resumed and compacted there and then, so the next campaign starts quickly.
  - **Keep**: the lead session's id is kept in workspace storage, and the next campaign's first sitting resumes it.
- **Abandon** writes the record and empties the context without asking.
- (#167:) A dialog follows the end: the record being written ("The elder is writing the lessons…", then where `record.md` is), then, after Finish with a council that sat, Empty / Compact / Keep with Empty focused and the context's rough size (what was written into it, not each turn's re-reads). The lessons run only when something was reviewed; they get the reviews' rounds, blocking findings, failed reviews, dropped findings and PR comments, and nothing else (no tools). Their cost counts in the campaign's gold, and the record waits for it. Compact runs Claude Code's `/compact` on the resumed lead session. The kept session id lives in workspace storage (`council.json`) and is taken once, by the next campaign's first sitting.
- A hero's session ends when its island's PR is marked ready for review (or the work is abandoned). Bringing PR comments to the hero resumes that session (§5.6).

### 4.10 Measuring sittings
Built so round table and separate chambers, and later changes to either, can be compared on real tasks (#106).
- Each sitting's **tally** is computed by core (`Sitting.tally`) from what the event log already holds, so it survives reloads and replays; earlier sittings in a campaign are kept (`pastSittings`) for theirs.
  - **Cost:** the total; input, output and cache tokens and cost **per model** (the SDK's `modelUsage`); in separate chambers, **tokens per councillor** (each chamber's messages carry the id of the call that started it). Per-councillor dollars aren't known: the SDK prices the session, not each subagent. Time taken from core's clock.
  - **Output:** reports, bow-outs, concerns (and how many high or serious), questions asked, "Why?"s, revisions, re-consultations, plans proposed, and the last plan's tasks, decisions and criteria. *Concerns that made it into the plan* aren't counted: nothing links a concern to a plan task yet; the plan's size stands in.
  - **Effort:** the sitting's and each councillor's effort, the elder's recommendations, and whether the user changed them.
  - **Rating:** after a plan is approved (or the council dismissed), the elder panel asks "How useful was the council?" 1–5 with an optional note; optional, and can be changed.
  - **Council version:** noted by the runtime when the session starts: a hash of the mode, the roster's skill-file hashes and the adapter's `councilPromptVersion` (itself a hash of the council's instruction texts), so editing a councillor or a prompt starts a new group without anyone bumping a number.
  - Quest outcomes (tasks redone, review findings, whether a raised concern mattered) are added once reviews exist (M5).
- **Convene the other way:** after a sitting, the elder panel offers the same task and councillors in the other mode, marked as a comparison (`comparisonOf`). It costs a second sitting, so it asks first. **Assemble the parties** carries out the latest approved plan.
- **"Ibitsa: Export Council Tallies"** (Command Palette) replays every campaign log in the workspace and writes JSON (everything) or CSV (one row per sitting). An in-game view can follow once there is data worth showing.

---

## 5. Parties and heroes

### 5.1 Composition
- One party per worktree/branch. The plan groups its tasks into **islands** (one worktree each) and picks the **branching** strategy (§5.3, M4 planning).
- **Parallel parties:** at most `ibitsa.parties.maxParallel` (default 2) work at once; further islands wait for a free slot and start by themselves, in plan order. A party holds its slot from its worktree until its last task is submitted.
- **Blocked** (#121), with a reason: waiting for a slot, for the island before it (stacked), or for a **task** on another island to be done (until reviews, M5: submitted). An island whose first task waits doesn't start; a hero whose next task waits is held after submitting the one before and gets it, as a message, once the other task is done. Blocked heroes have no session running and spend nothing. Core schedules this after every step, so nothing that frees a slot or finishes a task is missed.
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

- Users can remap classes and add new classes (new model → new class with an appearance). (M8 planning:) through `ibitsa.classes` (id → name, model, appearance: a character sprite), edited in the Guild Hall's Armory; the adapter stays Claude until M9. **Recolor:** a hue shift and a few palette presets per class and per councillor, kept in settings and applied by the game when it draws. (#182:) The runtime puts the classes in play in the snapshot (`classes`) and starts each hero on its class's model; a class id nobody knows runs on Sonnet. A class in `ibitsa.classes` overrides a built-in by id, field by field; a new one gets Sonnet and a ranger's look unless it says otherwise, and a hero is named after it when it has no suggested names. `ibitsa.recolor` maps `class:<id>` or `councillor:<id>` to `{ hue: -180…180, preset }`, the presets being none, gold, frost, ember, verdant and shadow; an entry that doesn't check out is dropped alone. The game recolors a copy of the character's sheet pixel by pixel (map tokens and the hut's council sheets) and gives portraits the nearest CSS filter. The Armory writes one class or recolor at a time through the host (`writeClass`, `resetClass`, `writeRecolor`, `resetRecolor`), at your layer or the project's, with the layer each comes from and Reset (Remove for an added class). Appearances offered are the built-ins' characters and any in use; a pack's own characters join with #183. (M9 planning:) a class also names its `agent`: `claude` by default, or an ACP agent from `ibitsa.agents` (§11.5).

### 5.3 Branching strategies
- **Separate:** each island is an independent branch off `main`. Islands are spread around the map. There is no merge step: each task/branch gets its own PR.
- **Stacked:** islands are **in a line, connected by bridges**. Each branch is based on the previous one. Each PR targets the previous branch. In party assembly you choose how they start (M4 planning):
  - **Each island when the one before is cleared** (default): a raised, locked drawbridge until then; the next branch starts from the previous branch's head at that moment. Until reviews exist (M5), cleared = every task submitted.
  - **All at once:** later branches start from the earlier branch's current head. Between a later hero's turns the game master rebases it onto the earlier branch (`git rebase`, #122): already containing it does nothing; a conflict is aborted, leaving the worktree as it was, and the hero is told (queued message) to rebase and resolve; uncommitted work is never rebased or stashed, and goes to the hero the same way. The bridge shows "behind" until it catches up.
  - Each island branches from the island before **as git named it** (a taken name gets a suffix, §5.3 branch names), read when that island starts.
  - Either way, if an earlier branch moves on after a later one started, M4 doesn't restack beyond that; the island shows it's behind.
- The council proposes the strategy in the plan; the user approves it.
- Worktrees are created by the game master (`git worktree add`), default location: a sibling folder `../<repo>.ibitsa/<branch>` (configurable).
- **Base:** chosen when the work starts, defaulting to the repo's default branch (`origin/HEAD`, else `main`/`master`). If the workspace has uncommitted changes, warn that they won't be in the worktree.
- **Branch name:** `ibitsa/<slug of island title>` (a quick quest: of the task title), suffixed `-2`, `-3`… if taken. Separate islands start from the chosen base; stacked island 1 from the base, island N from island N−1's branch.
- **Repo scan:** the git game master reports the default branch, local branches and the workspace's uncommitted changes. The runtime adds it to snapshots as `repo` (it is not core state: it's needed before any quest exists), rescanning on start, on each `hello` and when a quest ends.
- **Setup:** an optional project setting `worktree.setup` (e.g. `"pnpm install --frozen-lockfile"`, empty by default) that the game master runs right after `git worktree add`, while the hero is still traveling. A failure puts the hero in `error` with the command output. No lockfile guessing.

### 5.4 Execution states
Each hero is always in exactly one state, mapped from agent events (settled in [#10](https://github.com/sandrofi84/ibitsa/issues/10)). When several conditions hold, the highest row wins; every pending "Needs you" item stays queued regardless.

| State | Source (Claude SDK adapter) | Map display |
|---|---|---|
| unknown | core has lost contact: session not yet confirmed resumed after a reload, adapter died without a terminal event, or no events for 5 min with no tool running | grey "?" over a frozen token; tooltip gives the reason |
| error | the session cannot continue: crash, auth failure, `error_during_execution` (except right after a stop, which just ends the turn), non-retryable API error, the session cut off by a reload. Not a failing tool | hurt animation + log; "Needs you": resume / stop |
| out of gold | core's gold pouch rule (§7.3) | `outOfGold` animation (empty pouch); "Needs you": raise cap / stop |
| stalled | stall detection (§10.11); core auto-pauses (interrupt + hold queue) | warning bubble; "Needs you": continue / message / stop |
| waiting on you | a pending `canUseTool` call (permission or AskUserQuestion) | gold "?" bubble + "Needs you" entry |
| resting | `status: 'compacting'` until `compact_result` | rest animation |
| working: *kind* | `PreToolUse` until `PostToolUse`/`PostToolUseFailure`; `think` while mid-turn with no tool running | animation per kind (below) |
| blocked | dependency not done (M4) | padlock; at drawbridge if stacked |
| under review | its task is being checked or reviewed (M5) | idle at task point under an hourglass; councillors there with magnifiers |
| submitted | hero called `submit_task({ summary })` | idle at task point; councillors walk out |
| idle | turn ended without `submit_task`, or after a stop | idle at task point; last message as a "Needs you" `reply` |
| traveling | dispatched, until the session's `system`/`init` message | walking along path; the game may speed the walk so the token arrives within ~1 s, never shows work before `init` |

**Activity kinds** (from the tool, including tools run by subagents):

| Kind | Tools |
|---|---|
| read | Read, NotebookRead |
| search | Grep, Glob, WebSearch, WebFetch |
| edit | Write, Edit, MultiEdit, NotebookEdit |
| test | Bash whose command matches a test pattern: defaults (`test`, `vitest`, `jest`, `pytest`, `go test`, `cargo test`, `pnpm`/`npm`/`yarn test`, `playwright`) plus the worktree `package.json` `test*` scripts |
| run | any other Bash command |
| think | no tool running mid-turn (text or thinking) |
| other | anything else (MCP tools, TodoWrite, Skill, …): generic work animation |

- A tool failure is not an error: it emits `activityFinished { outcome: 'failed' }` (hurt cue) and the hero stays working. "Failed" = `PostToolUseFailure` or a tool result with `is_error` (verified live on 2026-10-05 with SDK 0.3.289: a Bash command with a non-zero exit arrives as failed). API retries keep the current state and emit a `retrying` cue.
- Subagent activity animates the character the subagent stands for: a hero's own helpers animate the hero; review subagents (M5) animate their councillor.
- **`submit_task`** is an in-process MCP tool (`mcp__ibitsa__submit_task`) the hero's system prompt tells it to call when finished. For an agent without custom tools, the turn ends in `idle` and the user marks the task done from the `reply` item.

### 5.5 Review loop (run by the game master, never by the hero)
1. Hero declares the task done by calling `submit_task`. The game master first checks that the worktree has no uncommitted changes and at least one commit beyond its base; otherwise the tool call is rejected with the reason ("commit your changes first") and the hero keeps working. Heroes commit their own work as they go.
2. Game master runs **free deterministic checks** in the worktree (tests, lint, typecheck, and configured tools such as axe, npm audit, semgrep). Failures go straight back to the hero. (M5 planning:) the commands come from `ibitsa.checks`; without it, the worktree's `package.json` scripts named `test`, `lint`, `typecheck` or `check`; an empty list turns checks off. They run one at a time, stopping at the first failure, 10 minutes each; the hero gets the last ~4,000 characters. They run again on every resubmission. A failure spends no councillor. (#137:) detected scripts run with the package manager the worktree's lockfile names (`pnpm run`, `yarn run`, else `npm run`), and every check runs with `CI=1` so test runners run once instead of watching. A reviewer's diff is a stat then the patch, cut at 60,000 characters with a note to read the files for the rest.
3. Game master launches each of the party's reviewing councillors **concurrently**: read-only, review-mode prompt, councillor's own model (per-councillor effort applies here), given the diff, check outputs, the task's acceptance criteria and relevant decision records. (M5 planning:) one short session per reviewer, its instructions from the councillor skill's `## Review` section, ending with a `submit_verdict` tool. Its **review effort** is set per councillor in party assembly: Light (Haiku, $0.10 a review, the default), Standard (Sonnet, $0.40), Deep (Opus, $1.20); a councillor's `ibitsa-model` overrides the model. (#201:) a councillor's override can name an ACP agent its reviews run on (§11.5). It sees **only this task's commits** (core records the branch head when the task starts and when it's submitted). (#138:) The reviewer may Read, Grep and Glob around the diff, nothing else, within 20 steps and its effort's cap. Its brief is the skill's opening lines plus its `## Review` section (a skill without one gets its opening alone), the task, its criteria, the decisions it may not block on, the checks and the diff, which from round 2 is only what changed since its last review. Core rules on each `submit_verdict` (`checkVerdict`), and a rejected verdict goes back to the reviewer to fix. A reviewer that ends without an accepted verdict counts as failed.
4. Each returns a structured verdict:

```ts
{ councillor: string, verdict: 'pass' | 'changes',
  findings: { severity: 'blocking' | 'suggestion', criterion?: string,
              file?: string, line?: number, message: string }[] }
```

5. Blocking findings are sent into the hero's session; it fixes and resubmits. (M5 planning:) a blocking finding must say why: the acceptance criterion it fails, or `bug`, `security` or `breaks` (something that worked); core rejects one that doesn't. A reviewer can't block against a recorded decision: it files **"revisit D…?"**, which goes to the user, not the hero. While its task is reviewed the hero waits (**under review**) and gets its next task once every reviewer passes.
6. Re-review: only councillors who raised blocking findings, only on the delta since their last review.
7. **Loop limit** (default 3 rounds, `ibitsa.review.loopLimit`) → escalate to the user with the open findings: **Accept anyway**, **Send back with a note**, or **Stop**.
8. **Conflicting findings** between councillors → escalate to the user. (M5 planning:) not detected automatically: the hero calls a `dispute_finding` tool when two findings contradict each other or a recorded decision, and it goes to the user straight away. The findings the hero is sent carry their review ids (`[review r3]`), which `dispute_finding` names. (Asking the elder first may come later.)
9. Suggestions are collected into the PR description.
10. All pass → task is cleared; the PR can be opened.

On the map, councillors walk out of the council hut to the task point, show a magnifier while reviewing, and a red count badge when they have findings. Clicking a task point (or **Open task** in the hero pane or on a review's Needs you item) opens the **task panel** (#141): the task's state, the check results (command, pass or fail, output collapsible and open on a failure), each reviewer's verdict and findings per round (councillor, severity, the criterion or kind, file:line, message; the error for a review that couldn't finish), and the suggestions, kept for the PR description (M6). Esc closes it.
- **Needs you items** (#141): a review escalation says why (the loop limit, or a reviewer that couldn't finish) with the open findings: **Accept anyway**, **Send back** with an optional note, **Stop**. A "revisit D…?" reads "‹Councillor› asks to revisit D3: …" with **Dismiss**; the decision stands, and changing it means talking to the council. A dispute shows the hero's reason and the disputed findings: **Drop the findings** or **Keep them**, with an optional note.
- **"Done" means passed review** (M5): dependencies between tasks and stacked bridges wait for it; until M5 it meant submitted.
- **Quick quests** have no councillors: checks run, and the task is done once they pass.

**Settings** (#139): `ibitsa.checks` (commands; `[]` for none; unset detects the `package.json` scripts) and `ibitsa.review.loopLimit` (3).

**Turning it on** (#136): reviews are a campaign setting (`reviews`, logged with the quest settings). The runtime turns them on once the game master can run checks and the agent can start reviewers; logs from before M5 replay without them, a submitted task going straight to done (unreviewed).

### 5.6 Pull requests
Settled in M6 planning.
- **One PR per island** (one island is one branch). A quick quest's branch gets one too. Merging is always a human action on the git host; Ibitsa only watches.
- **Git host:** GitHub only in M6, behind a `GitHost` port (GitLab and others later). The repository is `origin`'s; fork workflows come later. Sign-in is VS Code's built-in GitHub authentication (`repo` scope); the token stays in the extension host, never in core or the log. No GitHub remote, or not signed in: the buttons are disabled with the reason, and **Push branch only** works for any remote. (#162:) The runtime tells the game before any click, with the repo scan and after each push or PR result: no origin disables everything; origin not on GitHub disables only the PR actions. Being signed out disables nothing, since the click is what asks to sign in; the card says it will.
- **Opening is always a click**, from the island's **PR card**. A preview form shows the title (the island's title), the body, a **Draft** checkbox (ticked until the island is cleared) and the base branch (not editable), then **Open PR**. (#153:) While the island isn't cleared, Draft is ticked and can't be unticked.
- **The PR card** (#153) shows the PR's number, state and base, a link to it on GitHub, what's under way (pushing, opening, marking ready) and the last failure. It has a button for each action available now: Open PR and Push branch only before a PR exists; then Update PR, Mark ready for review (drafts) and Refresh. A disabled button gives its reason, from core's rules (the island before has no PR, a push is under way, not every task has passed) or, with #152, from the git host. A merged or closed PR has no buttons.
- **The body is built from the record, with no tokens:** the plan's summary, the island's tasks, their acceptance criteria and who reviewed against them, the decisions the island follows, the suggestions kept for the pull request, the check results and a summary of the review rounds. Editable in the preview.
- **Pushing** (`git push -u origin <branch>`, the user's own git credentials) happens only on a click: Open PR, **Update PR** (pushes later commits), **Mark ready for review** (pushes first). Nothing leaves the machine otherwise.
- **Drafts:** a draft may open before the island is cleared; later tasks reach it through Update PR. Once the island is cleared the card offers Mark ready for review. The hero's session ends when the PR is ready (§4.9) and its party slot frees.
- **PR comments:** **Bring the comments to the hero** fetches the PR's review comments and sends them, as one message, to the hero's resumed session. Its commits go through the review loop again (§5.5), and Update PR pushes them. (#154:) The comments reopen the island's last task; at its next submit every councillor with criteria reviews what changed since its passing review, and the loop limit counts from that round. No comments yet: the card says so and nothing reaches the hero.
- **Stacked:** island N's PR has island N−1's branch as its base and can open only once N−1's PR exists (the button says why until then). When polling sees N−1 merged, Ibitsa retargets N's PR to N−1's base, then offers **Restack**: `git rebase --onto <new base> <N−1's old head>` in N's worktree and `git push --force-with-lease`, after the user confirms. A conflict goes to the hero, as with #122. (#154:) The island's next PR base skips merged islands, so an island with no PR yet is offered Restack too (without a push, so without the confirmation). After a conflict the hero runs the rebase itself, and the next Update PR pushes with `--force-with-lease`. Restack's button asks to confirm with a second click (a webview has no dialogs).
- **Badges:** draft, open, approved, changes requested, checks failing, merged, closed, floating above the island's top right (both layouts) as the state in words on its colour, with the PR's number (`#12 DRAFT`); a plain `PR` while the island could open one (#153). Hovering a badge shows a one-line summary; clicking it opens the PR card on its own. One GraphQL query covers the campaign's open PRs, every 60 s while any is open (`ibitsa.pullRequests.pollSeconds`), plus a refresh on demand from the card; polling stops when all are merged or closed.
- **In the runtime** (#152): pushes never wait on a terminal prompt (`GIT_TERMINAL_PROMPT=0`), so missing git credentials fail with git's message on the card. Polling runs while the campaign is active (finishing or abandoning stops it), at least every 15 s, and only a poll that changed a badge is logged. A failed poll (offline, signed out) keeps the last badge and tries again at the next interval.
- **After a merge:** the island's card offers **Remove worktree**, which also deletes the local branch (never the remote one), during an active campaign too. (#154:) It asks to confirm with a second click, and the island's hero session ends with it.
- **Reaching Ibitsa:** the campaign's work is shipped when every island's PR is merged. The heroes walk to Ibitsa on the horizon, and the campaign offers Finish (its record comes in M7). (#153:) Ibitsa is a far-off castle, drawn by the game, in the sea between the rows at the map's far end. When the campaign ships, its banner turns gold and each hero walks to its gate and cheers "Ibitsa!".
- **Testing:** a fake GitHub in the dev host and unit tests; an opt-in live smoke test opens a draft PR on a private sandbox repository (`sandrofi84/ibitsa-sandbox`), reads its badge and closes it.

---

## 6. Interaction

### 6.1 Command bar
- A text input along the bottom of the game panel, focused with `/` or ⌘K (#81); Needs you stacks above it. The hero pane's message box is the same input, aimed at that hero, and they share one ↑/↓ history (view state). Later the same input serves party and council dialogue boxes.
- **Command Palette** (#87): **Ibitsa: Message Hero…** opens the game with the bar focused; **Ibitsa: Run Action…** offers a quick pick of the `/` actions, asks for their arguments, then puts `/action args` in the bar with its preview; **Ibitsa: Stop Hero** stops the hero. Not one command per action: VS Code needs every Palette command declared in `package.json`.
- **Keys:** Enter sends after the current step (queued), ⌥Enter sends now, ⇧Enter adds a line, ↑/↓ recall earlier messages, Esc clears and then leaves the input.
- **No quest running:** Enter offers "Start a quest" with the text as its task, opening the New Quest form filled in.
- **`@` autocomplete**, two groups:
  - **Targets:** `@council`, each party by name (`@atelier`, `@brann`), `@all`; shown with current status.
  - **Files/folders:** fuzzy search (in the target party's worktree when addressing a party). Sent as paths the model reads itself.
  - The first `@` target is the recipient; later `@` mentions are file references.
  - **As built (#83):** a hero's handle is its name in lower case with dashes (`@ranger-ilse`); M2 offers the hero and `@all` (the council arrives with M3, parties with M4). The recipient mention is taken out of the message; file mentions stay as written (`@src/app.ts`), so the hero reads the path. Without a recipient the message goes to the only hero. The hero pane's box offers files only. Files come from `git ls-files --cached --others --exclude-standard` in the worktree (at most 20 000), through the runtime-only `requestFiles` command answered by a `files` message; the game caches each list for 30 s. Ranking: name starts with the query, then name contains it, then path contains it, then the query's letters in order (fewer gaps first); shorter paths win ties.
  - **Menus:** a token starting with a trigger (`@`, `/`) at the start of the input or after whitespace opens a combobox listbox of suggestions, grouped under headings. ↑/↓ move, Enter or Tab chooses, a click chooses, Esc closes the menu before clearing the input.
- **`/` autocomplete** (#84): for a message's first word (after the recipient, if named), the actions Claude Code itself would run in the hero's folder: the SDK's `supportedCommands()` from a short session that sends no message, without Claude Code's own commands, grouped by source (Ibitsa, Project, Personal, Plugins). Only actions for heroes or anyone show until the council exists (M3). The runtime caches the list per worktree and pushes a fresh one when a `.claude` folder (the project's or the user's) changes. Choosing inserts the short name (`/test`); the message is sent as `/name args`, which the SDK runs as the skill (checked live).
- **While the council sits** (#242) the bar talks to it, in the hut (§4.4).
- **Ibitsa's built-in actions** ship as a local plugin in the extension (`dist/plugin`, passed to every session): `/test [filter]`, `/tidy`, `/explain [focus]`, all `disable-model-invocation: true`, `ibitsa-target: hero`. They appear as `ibitsa:test` with the alias `test`.
- **Preview** (#85): while the message is `/action args` (after a recipient, if named), a panel above the input shows the prompt Claude Code would get: Ibitsa reads the skill's file (project, user, legacy `commands`, plugins) and expands `$ARGUMENTS`, `$ARGUMENTS[N]`/`$N` (0-based), arguments named in the frontmatter's `arguments`, and `${CLAUDE_PROJECT_DIR}`/`${CLAUDE_SKILL_DIR}`; a prompt without `$ARGUMENTS` gets `ARGUMENTS: …` appended, as Claude Code does. Shell lines (`` !`cmd` ``) are shown with a note and never run for a preview. Left alone, the message goes as `/action args`, so Claude Code applies the skill's own settings; **Edit this message** puts the expanded prompt in the input to change and send as plain text. An action whose file can't be read says it's sent as `/action args`, with no preview.
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
- **New action** (#86): offered last in the `/` menu, a form (name, description, argument hint, prompt, for heroes or anyone, scope) that writes `<root>/.claude/skills/<name>/SKILL.md` with `disable-model-invocation: true`, `ibitsa-target`, and the argument hint quoted (an unquoted `[x]` is a YAML list). Written by the Claude adapter's `SkillWriter` through the runtime-only `createAction` (answered by `actionCreated` or `actionRejected`); the `/` menu refreshes after.
- Scope chosen at creation: personal (`~/.claude/skills/`, the default) or project (the workspace repository's `.claude/skills/`, to commit and share). A hero already on a quest runs in its worktree, so it sees a new project action only once that's in its branch; personal actions work at once.
- Game-only metadata (e.g. `target: party | council | any`) lives in frontmatter if Claude Code tolerates extra fields, otherwise in a sidecar `actions.json` keyed by skill name. **[OPEN]** verify.
- Name collisions with existing skills are detected and the user chooses rename/overwrite.
- The SDK delivers `/name args` prompts to custom skills (checked live, #84).

### 6.3 Controls (not prompts)
Shown in the same hover menu, visually distinct:
- **Stop:** interrupt the session now.
- **Rest:** compact the session (M2, #82): the `restHero` command, carried out as Claude Code's own `/compact` sent to the session, which reports `resting` then `compacted` (the z bubble, then HP back up). Refused while the hero has no live session, is already resting, or no quest runs. Restarting fresh from a handoff summary comes later.
- **Re-review:** game master relaunches reviewers (all or chosen).
- **Abandon task.**
- **End campaign** (§4.9).

### 6.4 "Needs you" queue
- All questions and permission requests from any session go into one queue (panel + map bubbles).
- VS Code notification (with "Open Game") when the game tab is not visible, and the waiting count in the tab title ("Ibitsa · 2 waiting"): editor tabs have no badge API.
- Focus mode: only "needs you" makes sound.

---

## 7. Screens and visuals

### 7.1 Screens
1. **Elder's recommendation:** the **elder panel**, docked where the hero pane goes while the campaign plans: research progress and gold, then the brief's summary (task, quick-quest verdict, files, findings, recommended councillors) with **Quick quest** and **Convene council** (the recommended one in bold), or the error and what to do. Convening (§4.2: round table or separate chambers, councillor checkboxes with reasons, effort) follows from it.
2. **Council hut (interior):** side-on room (Alex Kidd shop style), councillors as **32×32** characters behind a long table (§9.2), active speaker highlighted, "!" for who wants to speak, RPG dialogue box with portrait, options, "Why?", free text. The command bar to talk to the council, its latest word above it, and the council's pane with the journal and Dismiss (#242). Step tracker: Goal › Research › Questions › Plan › Dispatch. Book of Decisions on the table. In separate chambers, councillors first **study** at the table (think animation, a small book, a progress mark above each) and look up when their report is in; then the dialogue starts. A round table skips the study stage.
3. **Plan review:** in the hut (#104): plan, tasks in order with criteria, Book of Decisions; Approve / Ask for changes / Dismiss.
4. **Party assembly** (M4, #123): a dialog from the elder panel's **Assemble the parties**: one row per island with its tasks, hero class and name (from the island's first task's suggested class; names unique across rows), the reviewing councillors (whoever wrote criteria for its tasks), each with a **review effort** (#139: Light, Haiku, up to $0.10 a review, by default; Standard, Sonnet, $0.40; Deep, Opus, $1.20), sent as the party's `reviewEfforts` and the hero's gold cap in dollars (empty keeps the default pouch; "No cap" for none); the base branch with the uncommitted-changes note; for stacked plans, how islands start (§5.3); how many parties work at once. No cost forecast yet. Then **Start the campaign** (after the API-key card, if there's no key yet).
5. **World map (overworld):** see §7.2.
6. **Party panel:** compact lineup usable as a bottom panel next to the terminal (a `WebviewView`, from M4).

**Placement (M0–M3):** the game is a single editor tab (`WebviewPanel`), restored after a window reload with `registerWebviewPanelSerializer` (it reconnects via `hello` → snapshot). When the tab is hidden, the "Needs you" VS Code notification (§6.4) covers it.
7. **Guild Hall (settings, M8):** a building in Home Village. Its panel has tabs: **Roster** (councillors), **Armory** (classes, models, recolor), **Rule book** (rules), **Spell book** (actions), **Packs** (art and sound, volume) and **Chronicle** (past campaigns). Every value shows its layer (built-in / you / this project) with **Reset**, and an edit picks the layer; a link opens VS Code's settings filtered to Ibitsa. It edits VS Code's settings and skill files, never a store of its own. (#179:) The game reads and writes the rules over the host channel (`readSettings`, `writeSetting`, `resetSetting`; only the Rule book's keys can be written), and `openFile` opens a record or skill only inside the workspace, `~/.claude/skills` or Ibitsa's plugin. The Spell book lists the actions (the repository's when no hero is at work); the Chronicle reads the records index, with each record's PRs and gold. The tabs Roster, Armory and Packs join with #181, #182 and #183. The building sits left of the hut on Home Village (48×48, `building:guildHall`, drawn by the game when a pack has none).
8. **Campaign end (M8 lore):** once every PR has merged, the heroes sail toward Ibitsa on the horizon and it fades into mist: "Not Ibitsa. The search goes on." (Reduced motion: the line alone.) Then Finish: the record and keep/compact/empty (§4.9). Afterwards the islands sink back into the sea and the map returns to Home Village. Abandoning does the same, without the voyage.
9. **Start screen (M8):** with no campaign, the map opens on Home Village with two labelled buildings, the **Guild Hall** and the **council hut**; they replace the "New quest" button (the Command Palette's **Ibitsa: New Quest** opens the hut). The hut opens the council's welcome in the dialogue frame: the elder's two lines, a box for the task, and **Help me find it** (ask the elder; while it works, "the elder searches the old charts") or **I know the way** (a quick quest, one island charted at once). Mid-campaign the hut opens the chamber (#169); while planning, the sitting. (#180:) The welcome is the New Quest dialog in the council's dialogue frame, named "Welcome"; the command bar's "Start a quest" still opens it with the task written in. Over Home Village, "GUILD HALL" and "COUNCIL HUT" label the buildings while no campaign runs. Charted islands rise one after another (350 ms apart) out of fog; the hero at the horizon asks "Is that Ibitsa?" before the mist rises and the line appears above the castle.
10. **Charting (M8):** once the plan is approved, the possible locations rise out of the fog one by one as their parties are assembled (reduced motion: they appear).

### 7.2 World map rules (Super Mario World overworld)
- **Home Village** island with the **council hut**; it represents `main` and the campaign start.
- Each worktree/branch is an **island**; tasks are **task points** connected by dotted paths, colored by state (locked, active, done, under review).
- Islands are 96 px tall, so the 480×270 world holds two rows (#124): Home Village sits on the bottom row at the left. **Separate** islands fan out from it column by column, bottom then top, the first beside the village; each has its own dotted path, through the sea channel between the rows. Four fit the world; beyond that it widens and the camera pans (the overview shows it from the village's side). **Stacked** islands run along the bottom row joined by **drawbridges** (raised with a padlock until the island before is cleared, or, all at once, until the island has started; lowered after; an orange "behind" mark when a later branch must catch up), then up a bridge and back along the top row after four. A stacked hero walks across the islands and bridges before its own. Task points run along a path on each island.
- An island still waiting to start is dimmed, and its hero waits in a line at Home Village with a padlock (what it waits for shows on hover); a hero held mid-island (#121) shows the padlock at its task point. The camera follows the selected hero (#125), else the first one working.
- Heroes are **round tokens** with HP bars; councillors are **square tokens** with a parchment border and name plate, no HP bar.
- Councillors walk from the hut to a task point when a review starts and return when done (#140): one for each review of the round, standing around the hero (right above, right below, left above, left below, then a step further out), the name plate reaching away from it. A magnifier while the review runs; then a red badge with its blocking findings when it asks for changes (nothing for a pass), or a grey "?" when the review failed. They walk back a moment after the round is over (passed, sent back or escalated); a re-review brings its councillors out again. The hero waits idle at its task point under an hourglass. With reduced motion they appear and leave in place.
- PR badges float above islands: one PR per island (§5.6).
- **Ibitsa** sits on the map's horizon as the campaign's destination: visible but out of reach until the campaign's work is shipped.
- Map tokens (heroes, task points, PR badges) answer only presses on the map itself: a click on a panel lying over them (a card's button, a "Needs you" item) doesn't reach them (#154).
- Clicking a task point opens the **task panel** (§5.5); a hero standing on it covers most of it, so a click just below still reaches it. The "Needs you" queue sits at the bottom. An island's **PR card** (§5.6) shows at the foot of the task panel, and on its own from the island's PR badge (the two take turns in the same place).

### 7.3 HP and gold
- **HP** = remaining context window (from adapter context usage; estimated if unavailable). Resting (compaction) restores HP.
- **Gold** = spend. Shown per hero, per party and per campaign. Budget caps act as a hero's "gold pouch".
- **HP source:** the last assistant message's `usage` (input + cache-read + cache-creation tokens) ÷ the model's `contextWindow`, exact as of the last request; reset from `compact_boundary.post_tokens` after a rest. Before the first request, or if the adapter reports no usage, HP is `unknown`.
- **Gold source:** the cumulative `total_cost_usd` on each turn's `result`, exact, updated at turn end. No price table in M1 (a forecast table may return for M4's estimated cost).
- **Gold pouch rule (core, adapter-agnostic):** a hero is out of gold when its exact gold reaches its cap. Enforcement depends on adapter capabilities: with a native cap (`budgetCap`, Claude SDK) core passes `maxBudgetUsd = cap − spent` on every start and resume (so restarts can't reset it), the adapter reports `budgetExhausted`, and core also checks its own total at each turn end; with reported cost but no native cap, core checks at each usage event and interrupts (may overshoot by one turn; the UI says "cap checked at turn end"); with no reported cost, gold is `unknown` and no cap is possible (party assembly says so). Raising the cap updates core's cap and, with a native cap, resumes with the new remainder.
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

Settled in M8 planning: these are **VS Code's own layers**. User settings are the user layer; workspace settings (`.vscode/settings.json`, committable) are the project layer; VS Code already tells where a value comes from and resets it. Campaign overrides are what a campaign chooses for itself (quest settings, convening, party assembly). There is no `~/.ibitsa/settings.json` or `.ibitsa/settings.json`.

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
| User settings | VS Code user settings (`ibitsa.*`) |
| Project settings | VS Code workspace settings (`.vscode/settings.json`) |
| Campaign documents | `.ibitsa/campaigns/<id>/{brief.md, plan.md, plan.json, record.md}` |
| Runtime state, session ids, event logs | VS Code workspace storage (not committed) |
| Asset/sound packs | `~/.ibitsa/packs/<pack>/`, `.ibitsa/packs/<pack>/` |

---

## 9. Assets and audio

### 9.1 Rendering
- Pixel art at internal resolution **480×270**, integer-scaled (letterboxed) to the panel.
- Base tile **16×16 px**.
- **Engine: Phaser 4**, pinned to an exact version (`4.2.1`, no `^`) and upgraded deliberately. Pixel-perfect and filling the panel (#59): `Scale.NONE` + `CENTER_BOTH` + `pixelArt`, at the largest whole zoom where the 480×270 world fits, with the canvas sized to `floor(panel / zoom)` so extra space shows more sea instead of black bands (recomputed on resize). A world camera zooms and pans the map; a fixed UI camera draws the HUD.
- **Focus camera** (#59): while the hero works the camera zooms to 2× on its island and follows it, keeping the hero in the middle of the map left of the open hero pane. Mouse wheel, `+`/`-`, `0` (whole map), dragging, and on-screen buttons on the left edge control it. After you zoom or pan, it stays put until something needs you or the hero arrives somewhere new, then focuses again, unless auto-focus is off. Auto-focus on/off is view state. Renderer is `Phaser.WEBGL` only: without WebGL the panel shows a plain HTML notice and the game does not start; core and agents are unaffected. See [research](https://github.com/sandrofi84/ibitsa/blob/research/phaser-vs-pixijs/docs/research/phaser-vs-pixijs.md).
- **The engine stays inside `game`.** No other package imports Phaser. `game` renders from `protocol` snapshots and events and sends `protocol` commands; nothing engine-specific crosses that boundary. Pack formats (§9.3) are engine-neutral (frame size, animation rows, 9-slice insets), not Phaser atlases or Tiled maps. Tiled may be used inside `game` for fixed scenes (village, hut interior) as an internal detail; dynamic layouts (islands, task points) are built in code.

### 9.2 Visual asset spec (draft)

| Asset | Size | Contents |
|---|---|---|
| Character sprite sheet | 16×16 px per frame (settled in [#7](https://github.com/sandrofi84/ibitsa/issues/7): one tile per character keeps tokens on the 16px grid, a councillor fits beside a hero at a task point, more CC0 art exists; expression lives in portraits) | One row per animation; facing right, mirrored for left |
| Council sheet (optional per character) | 48×48 px per frame (art planning: was 32×32) | The council hut scene only, so the bigger size doesn't touch the 16px map grid. A **full-body** figure, head to feet, a more detailed version of the character's 16×16 sprite (same colours, outfit and props), never a torso: the hut's table is a separate foreground layer that hides the lower body, so a councillor can walk in and step up to it. Animations: idle, talk, think, raiseHand, write (required), and walk (optional: to come in through the door; without it the councillor slides in standing), 4 frames each. Without a council sheet, the 16×16 sheet is scaled up 3× (nearest neighbour). Nine fit along the table (9 × 48 = 432), shoulder to shoulder. (#219:) a council sheet with any other frame size, such as an older pack's 32×32, is rejected with that reason, rather than scaled: one size keeps the seating and the table line right, and a pack can drop the sheet to fall back to its map sprite. |
| Portrait | 64×64 px | Neutral; optional 2-frame talking loop |
| Map tileset | 16×16 tiles | Water: a 4-frame loop that tiles seamlessly on every side, repeated across the sea. (Art planning:) the grass, sand, shore and path-dot tiles, which the game never drew, leave the format. (#221:) an older pack that still lists them validates, with a warning (`validatePack` returns `warnings` beside an accepted manifest). |
| Island pieces | 96 px tall: left cap 48w, repeatable middle 32w, right cap 48w | Islands stretch to fit task count |
| Bridge | 24 tall: a 32-wide repeatable segment and two 8-wide ends; rows `lowered`, `raised` (#124) | Optional; without it the game draws plain planks. A bridge between rows is the same turned a quarter. |
| Map markers | 12×12, left to right: `padlock`, `behind` (#124), then `magnifier`, `hourglass` (#140) | Optional; without them the game draws its own. A strip needs `padlock` and `behind`; the review markers may be left out |
| Task point | 16×16 | locked, active, done, under review |
| Buildings | multiples of 16 (hut 64×64, Guild Hall 48×48) | Council hut, Guild Hall |
| Hut interior (art planning) | 480×270 background, plus a table foreground layer the same size (transparent above the table) | Optional (`scenes.hutInterior`, `scenes.hutTable`); without them the game draws its own. (#219:) the table line is y = 176, and councillors stand with their feet 16 px below it, so the table hides each figure's lower third; they come in through a door at the left (x ≈ 16) and walk to their seats. A sitting opened just convened plays the walk-in, farthest seat first; a hut opened mid-sitting, or with reduced motion, shows everyone seated. With more than six at the table, the titles under the seats take two staggered rows. |
| Home Village (#221) | 128×96: the whole village island in one picture, the size of an island with one middle piece (ground rows 0–63, a sandy shore 64–72 and a turquoise foam line 73–74 like the island pieces, transparent below); props are part of it | Optional; it replaces the plain island the village stands on, and the hut and the Guild Hall stand on it as their own images. `docs/art/assets.md` gives the spots to keep clear (the buildings, the hero line, the paths, the village's name) |
| Ibitsa (#221) | 48×32: a silhouette on the horizon, its base on the bottom row | Optional; it replaces the game's castle, at the same base line, and the game shows it at 70% and fades it into its own mist. The fog and the mist stay drawn by the game |
| Dialogue frame | 24×24, 9-slice | |

Character animations:
- **Required:** idle (4 frames), walk (4), work (4).
- **Optional:** test, ask, blocked, rest, celebrate, hurt, review (councillors), outOfGold. Missing optional animations fall back (e.g. test → work, outOfGold → idle). (Art planning:) until now the map only played idle, walk and work; it now plays each optional one in its moment (a test running, a question for you, blocked, resting, a task done, a failed test, a councillor reviewing, out of gold), falling back as before.
- Walking is sideways only, mirrored for left; paths up and down reuse it.
- **Built-in councillors each get their own look** (art planning): `councillor.<id>` for the five built-ins (accessibility, architect, designer, security, tester), beside the elder; `councillor.default` stays for councillors without one. (#220:) a councillor is drawn as its skill's `ibitsa-portrait`, else as `councillor.<id>`, and as `councillor.default` when the pack has no such character. That holds on the map (reviewers included), in the hut and for portraits. So a pack can give a custom councillor a look just by naming a character `councillor.<id>`. Recolor stays keyed by `councillor:<id>`.

### 9.3 Packs
- A pack = folder with `pack.json` manifest + PNG images + audio. **No scripts.** Size limits enforced.
- The manifest is engine-neutral: characters by frame size and animation rows (16×16, `idle`/`walk`/`work` required), a tile strip by index, island pieces by cap/middle widths, task point states left to right, activity icons (12×12, one per activity kind, left to right; shown beside a working hero, the flask green or red after a test run, #60), buildings by size, the dialogue frame by 9-slice inset, and optionally the drawbridge and map markers (#124). Schema and validator in `packages/assets` (allowed: `.png`, `.ogg`, `.mp3`, `.wav`, `pack.json`; limits 4 MB per file, 32 MB per pack; image sizes checked against §9.2).
- The **default pack** is placeholder art drawn in code: `packages/assets/default-pack/`, regenerated byte-for-byte by `pnpm --filter @ibitsa/assets generate` (which also writes the game's bundled engine textures). Real art replaces it piece by piece (§9.5).
- Manifest declares: files, frame size, animations (row, frame count, fps), foot anchor point, slot assignments (which character/class/tile each file fills).
- The built-in pack loads through the same loader and validator as user packs.
- **Upload validator:** checks dimensions, grid, required animations; shows specific errors; live animation preview and "try in scene".
- **Recolor:** tint/palette-swap of default sprites without drawing.
- New characters = appearance attached to a hero class or councillor.
- (M8 planning:) Packs are found in `~/.ibitsa/packs/` and `.ibitsa/packs/`; one is active at a time (chosen in the Guild Hall) and switches without a reload. Missing optional parts fall back to the default pack. The extension serves the active pack's files to the webview. The Packs tab runs the validator with its specific errors and previews animations. Packs may fill an optional `building:guildHall`; the game draws a fallback, and draws the fog and the mist itself. (#183:) The active pack is `ibitsa.pack` (`default`, `user:<folder>` or `project:<folder>`), written to your settings by **Use this pack**; one that's missing or fails the validator is never used (the default draws instead). Both pack folders are among the webview's resource roots, so a switch needs no new webview: the game drops the old pack's textures and animations and loads the new one, and the map (or the hut) starts again from the snapshot. The Packs tab previews a character's walk from the pack's own sheet.

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
- (M8 planning:) Sounds come in the same pack format, in an optional `sounds` section filling these slots. The default sounds are generated in code (sfxr-style, deterministic), like the placeholder art. Effects are on at 50% by default; music is off. (#184:) The default sounds are 22 kHz mono WAVs from a small synthesiser in `packages/assets` (square, triangle, saw and seeded noise with envelopes and slides). The validator checks each sound is there, and that a WAV cue lasts at most 3 s (music 120 s). The game plays a sound when a snapshot shows it happened: something new in Needs you, a campaign starting or ending, a task done, a review passed or sent back, a PR opened or merged, a hero resting or crossing 80% HP, a councillor's new line (pitched per councillor). The volumes are `ibitsa.sound.*` (master 50, alerts, voices, effects 100, music 0, focus), on sliders in the Packs tab.

### 9.5 Producing assets
1. **Phase 0 (done):** script-generated placeholder pack that matches the spec exactly; generated sounds; proves loader, manifest and validator.
2. **Phase 1 (art planning, before the M10 preview):** the user makes the art with Claude Desktop from a detailed spec, and the placeholders stay until each piece lands.
   - **The look:** a sunny Mediterranean archipelago (turquoise sea, white-washed huts with terracotta roofs, olive trees) and a fantasy adventuring crew. Palette **Endesga 32**, and only it; three-quarter top-down view; light from the top left; a 1 px dark outline on characters only; no anti-aliasing.
   - **Sizes:** as §9.2: map sprites 16×16, council figures 48×48 full-body, portraits 64×64.
   - **How:** Claude draws by writing code, not by painting images. Sprites, tiles, icons and markers come as **pixel grids in text**, one character per pixel naming a palette colour (`.` for transparent), so they are exact. Portraits and the big pieces (hut interior, Home Village, Ibitsa) come as **SVG**, rendered and snapped to the palette.
   - **Importing:** the sources live in the repo (`art/`), and `pnpm --filter @ibitsa/assets generate` builds the default pack from them, falling back to the code-drawn placeholder for any piece not made yet, still byte for byte. The validator checks the result.
   - **Docs:** `docs/art/` holds the art guide (palette codes, style rules, setting, character briefs, how to keep a character consistent across prompts) and one entry per asset (file, sizes, frame order and anchor, what each frame shows, a ready-to-paste prompt, what it must match, an acceptance checklist), with a status list of every asset.
   - **Order:** idle, walk and work for every character and the council poses first; then the council walk-in and the eight optional map poses; sounds and music after the preview, in a later phase.
   - **Licence:** the tool's terms must allow commercial use and redistribution; recorded with the art (`ATTRIBUTION.md`), separate from the code's licence.
3. **Later:** commissioned or contributed art can replace any piece through the same sources and validator.
---

## 10. Token efficiency rules

1. **Game master is code, not an LLM.** State transitions are free and deterministic.
2. **Research once.** The elder's brief is shared; heroes get the plan's "files likely touched" list instead of exploring.
3. **One brief, shared by the council.** The elder searches once; councillors start from their field's slice and read more only within a cap (§4.3). Councillors with nothing to add bow out in one line. Questions batched.
4. **Fresh contexts over bloated ones.** Research transcript is dropped after the brief; new tasks start new sessions; low-HP "rest" may restart from a handoff summary.
5. **Model tiering.** Cheap models for research, summaries, simple tasks and first-pass reviews; strong models for planning and hard tasks.
6. **Lean sessions.** Per-role tool allowlists (reviewers read-only); load only equipped skills (never "all"); only needed MCP servers.
7. **Cache-friendly prompts.** Identical system prompt per role; variable content at the end; never put changing values (timestamps, HP) in system prompts.
8. **Free checks before LLM reviews**; reviewers get the diff + check output, not the repo; only relevant reviewers; re-reviews only by flaggers on the delta.
9. **Structured, short outputs** (JSON verdicts, plans); the game renders flavor text itself.
10. **Budgets:** per-hero caps and a per-campaign cap, enforced by core (§7.3).
11. **Stall detection** (defaults, configurable): the same test command fails 4 times in a row (a pass resets it); one file edited 12 times with no passing test between; 6 turns in a row with an unchanged worktree diff (hash of `git diff HEAD`) and no passing test → auto-pause and raise a `stalled` "Needs you" item (continue resets the counters / send a message / stop). Defaults are guesses, to be tuned against replayed sessions.
12. **Estimate vs actual logging** per task type and model, used to improve effort estimates.

---

## 11. Architecture

### 11.1 Language and packages
TypeScript throughout. pnpm workspaces monorepo:

```
packages/
  core/         game master, campaign state machine, rules, plan/decision model; pure (no vscode or Node imports, ADR 0001)
  protocol/     shared types: commands, events, state snapshots (used by core, game, extension)
  adapters/
    agent-claude-sdk/   native Claude Agent SDK adapter (first-class)
    agent-acp/          generic Agent Client Protocol adapter
    agent-fake/         replays recorded sessions (tests, demos, game dev)
    git-github/         PRs, badges (gh / GitHub API)
    tickets-*/          later: GitHub Issues, Linear, Jira
  game/         webview renderer (Vite + Phaser 4)
  runtime/      carries out core effects (git, adapters, timers), writes the event log, rebuilds state on start (Node, no vscode imports)
  extension/    VS Code shell: panels, commands, storage, wiring; hosts runtime in v1 (esbuild)
  assets/       default pack, manifest schema, validator
```

### 11.2 Process model
- v1: core and runtime run inside the extension host.
- **Pure core** ([ADR 0001](adr/0001-pure-core-event-sourced.md)): `step(state, input) → { state, cues, effects }`; the runtime builds snapshots with `view(state)` and assigns `seq`. Inputs are normalized `AgentEvent`s, commands, game master results (worktree created, setup finished, `submit_task` check) and `timerFired`. Each input's `t` is the core's "now". Effects are requests (create worktree, start session, send message, interrupt, `setTimer`/`cancelTimer`). The **runtime** carries out effects, feeds results back as inputs, and appends each input to the event log before stepping. The standalone game runs the real core in the browser with a small browser runtime (agent-fake + replay controls).
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

Exact shapes live in `packages/protocol` (authoritative); this is the outline.

```ts
type Reading<T> =
  | { kind: 'exact'; value: T }
  | { kind: 'estimated'; value: T; basis: string }   // e.g. "tokens × price table"
  | { kind: 'unknown' };
type MicroUsd = number;                              // integer

interface Snapshot {                                 // seq lives on the CoreMessage
  campaign: CampaignView | null;                     // { id, title, status: 'active' | 'finished' | 'abandoned', gold: Reading<MicroUsd> }
  sitting: SittingView | null;                       // §4.3: mode, status, roster (effort, reported), reports, open question batch, plans, revision, re-consultations, gold
  islands: IslandView[];                             // { id, name, branch, taskPoints: TaskPointView[] }
  heroes: HeroView[];
  needsYou: NeedsYouItem[];                          // oldest first
  repo?: { defaultBranch; branches; uncommittedChanges } | null;  // added by the runtime from the git game master's scan (New Quest form); null = not a git repo
}
interface TaskPointView { id: string; title: string; state: 'locked' | 'active' | 'underReview' | 'done' | 'doneUnreviewed' }

type ExecutionState =                                // §5.4
  | { kind: 'unknown'; reason: string } | { kind: 'error'; message: string } | { kind: 'outOfGold' }
  | { kind: 'stalled'; reason: string } | { kind: 'waitingOnYou' } | { kind: 'resting' }
  | { kind: 'working' }                              // what: HeroView.activity
  | { kind: 'blocked' }                              // M4
  | { kind: 'submitted'; summary: string } | { kind: 'idle' } | { kind: 'traveling' };
type ActivityKind = 'read' | 'search' | 'edit' | 'test' | 'run' | 'think' | 'other';

interface HeroView {
  id: string; name: string; classId: string;
  islandId: string; taskPointId: string | null;
  state: ExecutionState;
  activity: { kind: ActivityKind; detail?: string } | null;
  hp: Reading<{ used: number; max: number }>;
  gold: Reading<MicroUsd>;
  queuedMessages: number;
}

type NeedsYouItem =                                  // answered by:
  | { kind: 'permission'; id; heroId; action: string; target: string; cwd: string }   // answerPermission
  | { kind: 'question'; id; heroId; questions: AskUserQuestion[] }                     // answerQuestion
  | { kind: 'reply'; id; heroId; text: string }                                        // sendMessage / markDone
  | { kind: 'stalled'; id; heroId; reason: string }                                    // resumeHero / sendMessage / stopHero
  | { kind: 'outOfGold'; id; heroId; cap: MicroUsd; capEnforcement: 'native' | 'turnEnd' }  // raiseBudget / stopHero
  | { kind: 'error'; id; heroId; message: string };                                   // resumeHero / stopHero
// AskUserQuestion mirrors the Claude SDK: { question, header, options: { label, description, preview? }[], multiSelect }

type Command =                                       // Valibot strict objects, validated at core
  | { type: 'hello'; protocolVersion: number }
  | { type: 'sendMessage'; commandId; heroId; text: string; priority: 'now' | 'next' }
  | { type: 'stopHero'; commandId; heroId }          // interrupt + clear adapter queue
  | { type: 'answerPermission'; commandId; itemId; decision: 'allow' | 'deny'; note?: string }
  | { type: 'answerQuestion'; commandId; itemId; answers: Record<string, string | string[]> }
  | { type: 'resumeHero'; commandId; heroId }        // continue after stall, retry after error, resume after reload
  | { type: 'raiseBudget'; commandId; heroId; addMicroUsd: MicroUsd }
  | { type: 'markDone'; commandId; heroId }          // user marks the task submitted
  | { type: 'startQuest'; commandId; description; heroName; classId; baseRef }  // M1 quick quest (§14.1)
  | { type: 'finishQuest'; commandId } | { type: 'abandonQuest'; commandId }
  | { type: 'removeWorktree'; commandId; islandId }  // refused unless the worktree is clean
  // M3, the sitting (§4.2–4.6, #100):
  | { type: 'conveneCouncil'; commandId; task; mode: 'roundTable' | 'chambers'; roster: string[]; effort: Effort; councillorEfforts?: Record<string, Effort> }
  | { type: 'addCouncillor'; commandId; councillorId; effort: Effort }
  | { type: 'answerCouncil'; commandId; batchId; answers: Record<questionId, { optionId } | { text }> }
  | { type: 'approvePlan'; commandId; version } | { type: 'requestPlanChange'; commandId; version; text }
  | { type: 'dismissCouncil'; commandId };
// The sitting's lead session reports to core as `council` inputs (CouncilEvent: sessionStarted, reportFiled,
// questionsAsked, planProposed, usage, error); core answers each tool call with an effect that accepts it or
// rejects it with a reason (`completeSittingTool`, `answerSittingQuestions`).

type CoreMessage =
  | { type: 'welcome'; seq: number; protocolVersion: number }
  | { type: 'snapshot'; seq: number; snapshot: Snapshot }
  | { type: 'cue'; seq: number; cue: Cue };

type Cue =
  | { type: 'commandRejected'; commandId: string; reason: string }
  | { type: 'needsYouAdded'; itemId: string }
  | { type: 'activityFinished'; heroId: string; kind: ActivityKind; outcome: 'ok' | 'failed' }
  | { type: 'retrying'; heroId: string; reason: string }
  | { type: 'heroSaid'; heroId: string; text: string };   // a speech bubble with an excerpt (#57)
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
  role: 'elder' | 'council' | 'councillor' | 'hero' | 'reviewer';
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

// Normalized adapter output (packages/protocol; #2 and #10 corrections applied). Core input only.
type AgentEvent =
  | { type: 'sessionStarted'; sessionId: string }    // ends traveling
  | { type: 'turnStarted' }
  | { type: 'turnEnded'; queuedTurns: number }
  | { type: 'activityStarted'; toolUseId: string; kind: ActivityKind; detail?: string }
  | { type: 'activityFinished'; toolUseId: string; outcome: 'ok' | 'failed' }
  | { type: 'message'; text: string }
  | { type: 'question'; requestId: string; questions: AskUserQuestion[] }
  | { type: 'permission'; requestId: string; tool: string; input: unknown; title?: string; description?: string }
  | { type: 'usage'; contextUsed?: number; contextMax?: number; totalCost?: MicroUsd }  // running totals; omitted = unknown
  | { type: 'resting' }
  | { type: 'compacted'; trigger: 'manual' | 'auto'; preTokens: number; postTokens?: number }
  | { type: 'taskSubmitted'; toolUseId: string; summary: string }  // submit_task; core runs the submit check
  | { type: 'budgetExhausted' }
  | { type: 'retrying'; reason: string }
  | { type: 'error'; message: string };               // the session cannot continue
```

- **#10 additions** (see §5.4, §7.3): activity comes from tool start/end (Claude SDK: `PreToolUse`/`PostToolUse`/`PostToolUseFailure` hooks) and carries an outcome; `submit_task` is a custom tool the core supplies to heroes; the adapter maps its native budget stop to a generic `budgetExhausted` event; retries surface as a `retrying` event. The full event union is finalized with the #2 corrections when the adapter is built.
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

Settled in M9 planning, checked on 2026-10-07 against `@agentclientprotocol/sdk@1.7.0` and the [ACP registry](https://agentclientprotocol.com/registry):
- **Roles.** ACP runs **heroes and reviewers**; a party may mix agents, and a reviewer on another vendor is a second opinion. The elder, the council's sittings, lessons and council compaction stay on the Claude adapter (later, once the tool bridge has proven itself).
- **Custom tools** (`submit_task`, the reviewer's verdict) reach the agent as an **MCP server**, the only way ACP allows: a small stdio MCP bridge bundled with the extension, listed in `session/new`'s `mcpServers`, which the agent launches and which talks back to the runtime over a local socket (a named pipe on Windows). Every ACP agent must support stdio MCP. An agent that never calls the tool still has **Mark done**. ACP-transport MCP replaces the bridge once it is stable. (#197:)
  - **The bridge** is `dist/mcp-bridge.cjs`, run by the extension host's own executable with `ELECTRON_RUN_AS_NODE=1` (VS Code's is Electron). It is a hand-written MCP server (`initialize`, `tools/list`, `tools/call`, `ping`), 26 KB with only Node built-ins, rather than the MCP SDK and zod for three methods. It holds no tools of its own: the runtime tells it the session's tools and answers each call.
  - **The socket:** one per runtime, `$TMPDIR/ibitsa-<12 hex>.sock` (`/tmp/…` if that path would pass 100 bytes; macOS allows 104), mode 600; on Windows the named pipe `\\.\pipe\ibitsa-<12 hex>`. The sandbox (#200) must let agents reach it. Each session's server entry carries the socket (`IBITSA_BRIDGE`) and a fresh secret (`IBITSA_BRIDGE_TOKEN`); a connection that doesn't open with a live token is dropped, and a session's bridges are cut off when it closes.
  - **`submit_task`** has the Claude adapter's description and answers ("Submitted. Your work will be reviewed." / "Not submitted: <reason>" as a tool error). ACP has no system prompt, so a new hero's first prompt starts with a block of instructions on submitting; a resumed hero already had them.
  - The tool set is per session, so reviewers (#201) get their verdict tool through the same bridge.
- **Agents** come from the setting `ibitsa.agents` (id → command, args, env, and for the sandbox its state folders and network domains). Built-in presets run agents you have installed yourself: Codex (`codex-acp`, the registry's adapter, with the `codex` CLI for `codex login`), Copilot CLI (`copilot --acp`), OpenCode (`opencode acp`), Antigravity (the registry's `agy` ACP server) and Gemini CLI (`gemini --acp`). (#195:) since June 2026 Gemini CLI no longer serves personal Google accounts (`auth_required`: "no longer supported for Gemini Code Assist for individuals"); it needs a paid Gemini API key, and individuals are sent to Antigravity. Ibitsa installs nothing; the Armory shows which presets it finds. Claude runs only through the native adapter (§11.6, claude.ai sign-in): no `claude-agent-acp` preset, and a custom entry that runs it is refused with the reason. One agent process per hero. (#198:) An entry is `{ name, command, args, env, stateFolders, domains, prices: { inputPerMillion, outputPerMillion } }`; one with a preset's id overrides it field by field, an added one needs a `command`, and an entry that doesn't check out is dropped alone. A refused entry (it runs `claude-agent-acp` or `claude-code-acp`, or takes the id `claude`) stays listed so the Armory can say why. Only Codex's preset has a sandbox profile (the spike's state folder and domains, plus `weakerNetworkIsolation` and `agent-full-access` when sandboxed); the others run unsandboxed until theirs is measured. The Antigravity preset runs the registry's `agy_acp_server.par`, which you unpack yourself (override `command` with its path). ACP agents start from the heroes' environment without Ibitsa's Anthropic credentials, which are for Claude alone. A command is found the way a shell would (PATH, and PATHEXT on Windows, where npm's `.cmd` shims start through cmd.exe).
- **Classes** gain `agent` (default `claude`, else an `ibitsa.agents` id) beside `model` (§5.2). An ACP agent's model is set through its session config option of category `model` when it offers one; otherwise it uses its own default, and the Armory says so. The built-in classes stay on Claude. (#198:) A class moved to another agent doesn't keep the old agent's model: an ACP class without one runs on the agent's default, shown as "Codex · its default model". A class naming an agent that isn't there, or is refused, gives its hero an error item naming it. The Armory picks a class's agent, lists the agents with whether each command is on PATH (no agent is started; the party check is #199), and warns on a class whose agent isn't installed.
- **Reviewers** (#201). Reviewers are councillors, not classes, so a councillor's override in `ibitsa.councillors` (#181) names the agent its reviews run on: `agent`, edited as **Reviews on** in the Roster (`claude` when empty; naming `claude` is the same). It covers reviews only: the council's sittings stay on Claude. A Claude hero's work can then be reviewed by another vendor's model, and the other way round.
  - **The party check** covers them: in party assembly (and an amendment's new party) each reviewing councillor on an ACP agent gets its agent's line under its review effort, against its own model when it has one, and Start waits for those agents too; an agent that reports no cost warns that the review's cap can't stop it.
  - **Routing:** the runtime starts the review on the councillor's agent, failing the review with the reason when that agent is missing or refused. The effort's models are Claude's, so an ACP reviewer runs on the councillor's own model when it has one and the agent offers it, else on the agent's default; the effort still sets the cap.
  - **Briefing:** ACP has no system prompt, so the reviewers' instructions (shared with the Claude adapter, now in the runtime with the brief) open the first message, with a line naming `submit_verdict` as a tool of the ibitsa MCP server; the brief follows. The councillor's guidance (its skill's opening and `## Review`) comes from Claude's adapter (`reviewGuidance`), which reads councillor skills; ACP agents don't.
  - **Read-only:** the session switches to the agent's read-only mode when it lists one (a mode whose id or name is "read only", e.g. Codex's `read-only`). Whatever the mode, a permission request is allowed once only for `read`, `search` and `think` tool calls and refused otherwise. Inside Ibitsa's sandbox (#200) the reviewer's worktree and the repository's `.git` are read-only (temp and the agent's state folders stay writable), and a new domain is refused without asking. Unsandboxed (native Windows, an agent without a sandbox profile), an agent that runs tools without asking can't be stopped from writing by the mode and the refusals alone.
  - **The verdict:** `submit_verdict` through the tool bridge, with the Claude tool's arguments; core checks it (`checkVerdict`) as for a Claude reviewer, and its ruling is the tool's result ("Verdict filed. Your review is done." / "Not accepted: …"). Ending without an accepted verdict, more than 20 tool calls before one, a reported cost past the effort's cap, a dying agent or no tool bridge each fail the review with the reason.
  - **Gold:** only a cost the agent reports in USD; a review event carries no estimate, so token prices don't count here and a subscription agent's review gold is unknown.
- **Sign-in and the party check.** Ibitsa keeps no credentials for ACP agents. When the party assembly shows the chosen classes, and in the Armory per class, Ibitsa checks each ACP agent once (cached a few minutes): it starts it, runs `initialize` and a throwaway `session/new` in a fresh, empty temp folder (no prompt, no tokens) and closes it. Outcomes: **not installed**; **needs sign-in** (`auth_required`), with **Sign in** opening a VS Code terminal on the agent's own login when it offers terminal auth, else the command to run; **model not offered**, naming the ones it offers. Start quest waits until every agent in the party passes, the reviewing councillors' agents included (#201).
  - (#199:) The check runs where heroes set out: party assembly, a quick quest's class and an amendment's new party, each Start (the campaign, the quest, Assemble) disabled until every ACP class passes; Claude classes need none. The Armory checks a class on demand (**Check the agent**). The extension answers each agent with an `agentCheck` host event (`checkAgents`, with `force` for **Check again**; `signInAgent` for **Sign in**); it starts the agent the way heroes would (`HeroAgents`, the same environment and Windows shims) in the workspace, and keeps a ready or needs-sign-in answer 5 minutes for the same `ibitsa.agents` entry, a failure never. A command not found on PATH is **not installed** without starting anything; a failed start or no answer in 30 s is **couldn't start**, with the reason, and Check again.
  - **Sign in** runs, in a VS Code terminal, the agent's own terminal sign-in when its `initialize` lists one (its command with the method's arguments and environment; Ibitsa advertises `clientCapabilities.auth.terminal`), else the entry's `signIn` command (presets: `codex login`, `copilot`, `opencode auth login`, `agy`, `gemini`), else nothing: the line says to sign in in a terminal. After signing in, **Check again** starts the agent afresh.
  - **Models:** an agent whose `model` option lacks the class's model blocks it, naming what it offers; an agent with no choice of model is ready and the line says it picks its own. A ready agent without prices in its entry also shows "<agent> reports no cost: the gold pouch can't stop this hero."
- **Confinement.** On macOS and Linux (WSL and dev containers included) each ACP agent's process runs inside Anthropic's [sandbox runtime](https://github.com/anthropic-experimental/sandbox-runtime) (`@anthropic-ai/sandbox-runtime`, Seatbelt / bubblewrap): writes only to the worktree, temp and the preset's state folders; network only through its proxy, where the preset's domains pass and any other domain asks through the runtime's ask callback as a "Needs you" item, like a Claude hero's. The agent's own `session/request_permission` requests also become "Needs you" items with its options (allow-always → "Always allow for this quest"). The sandbox keeps the hard limits, so Auto mode is offered. A missing bubblewrap, socat or ripgrep is an `error` naming it, never a silent unsandboxed run.
- **Spike findings** (#195, Codex `codex-acp` 2.1.1 on macOS, sandbox runtime 0.0.79):
  - `codex-acp` reuses the `codex login` session in `~/.codex`; reads are allowed outside `denyRead`, so the state folder only needs write access.
  - On macOS Codex needs the sandbox's `enableWeakerNetworkIsolation` (the system's certificate service, for native TLS); without it `session/new` fails ("workspace routing discovery failed"). Its domains: `chatgpt.com`, `*.oaiusercontent.com`.
  - The runtime points `TMPDIR` at `/tmp/claude`, which must exist before the agent starts.
  - Held in both runs: a write in the worktree worked, a new domain (`example.com`) went to the ask callback and was refused (the agent saw a 403), and a write to `~/Desktop` failed with "operation not permitted".
  - Codex's own sandbox can't start inside ours. In its default `agent` mode it then escalates on its own after an internal "Guardian Review", without asking the client; in `agent-full-access` it runs straight under our sandbox. Neither sends `session/request_permission`. So the Codex preset runs in `agent-full-access` when sandboxed: our sandbox is the boundary, as for a Claude hero's sandboxed shell, and new domains are its "Needs you" items. Unsandboxed, which Codex mode asks the client is left to #200.
  - Codex reports context (`usage_update`, e.g. 15,050 of 258,400) and per-turn tokens, but no cost: on a ChatGPT plan its gold is unknown.
- **Unsandboxed** on native Windows, and for an agent without a sandbox profile: the hero pane says "Not sandboxed by Ibitsa", every permission goes to "Needs you" and Auto mode is off, as for a Claude hero on Windows today. The notice points to WSL or a dev container for full sandboxing. An opt-in using the sandbox runtime's Windows mode (alpha: a dedicated local account and firewall rules installed once as admin; the account can't see per-user installs or the agents' logins) is a later issue, after a spike.
- **The sandbox, as built** (#200):
  - **One sandbox host per hero.** The sandbox runtime keeps one global config, and its ask callback is told the domain but not who asked. So the runtime starts each sandboxed agent through a small host process (`dist/sandbox-host.cjs`, run by the extension host's own executable with `ELECTRON_RUN_AS_NODE=1`, like the tool bridge): it sets up the runtime with that hero's config, starts the agent inside it on its own stdio (so the agent speaks ACP straight to the adapter, as it does unsandboxed), and relays the runtime's asks over IPC to that hero's session. Stopping the hero stops the host, which stops the agent's process group and clears the runtime's state. The runtime is ESM-only and finds its helpers in its own package, so it stays outside the bundle, like the Claude SDK (§13).
  - **Which agents.** On macOS and Linux, an agent whose entry lists the domains it needs (its sandbox profile; today only Codex's preset); its state folders (`~` expanded) are writable. Any other agent, and every agent on native Windows, runs unsandboxed (below), and its class says so in the snapshot (`sandboxed: false`).
  - **The config.** Writes: the worktree, the main repository's `.git` that a worktree's git commands write to (found from the worktree's `.git` file; the runtime itself refuses `hooks/` and `config`), the system's temp folder and the state folders; `/tmp/claude`, where the runtime points TMPDIR, is created first. Reads: everything except `~/.ssh`, `~/.aws` and `~/.gnupg`. Network: the profile's domains; any other domain is a "Needs you" item, "Connect to `host:port`", answered as the user says (a stopped turn or hero refuses it). Inside the sandbox it carries no hard-limit boundary, so auto mode answers it as it would a Claude hero's. `enableWeakerNetworkIsolation` on macOS when the entry asks for it (Codex). The MCP bridge's socket (#197) stays reachable: by path on macOS (`allowUnixSockets`); on Linux, where sockets can't be allowed one by one, by allowing sockets and hiding Docker's (`/var/run/docker.sock`, `/run/docker.sock`).
  - **The agent's own mode.** A sandboxed agent switches to its entry's `sandboxedMode` once the session starts (`session/set_mode`; Codex: `agent-full-access`, since its own sandbox can't nest in ours).
  - **Missing tools.** On Linux the host checks bubblewrap, socat and ripgrep first and exits with a message naming what's missing and how to install it, which reaches the hero as an `error`: never a silent unsandboxed run. CI installs them on Ubuntu and runs the sandbox tests for real there and on macOS.
- **Unsandboxed heroes** (#200): every permission they ask is marked `boundary: 'unsandboxed'`, so auto mode never answers it; their hero pane says "Not sandboxed by Ibitsa", pointing to WSL or a dev container on Windows and to the agent's state folders and domains elsewhere. Codex unsandboxed keeps its default mode for now. Its modes (codex-acp 2.1.1, from its source): `read-only` and `workspace-write` send approvals to the client (`on-request`, reviewed by the user), so they'd reach "Needs you"; the default `agent` sends them to Codex's own auto-review ("Guardian"), never to the client; `agent-full-access` never asks. An unsandboxed preset mode of `workspace-write` is the obvious next step.
- **The party check under the sandbox** (#200): the check starts the agent through the same adapter heroes get, so a sandboxed agent is checked inside its sandbox, with its domains allowed and any other refused (there's nobody to ask). Its throwaway session starts in a fresh, empty temp folder, removed afterwards (retrying while Windows keeps it busy), never the workspace: the sandbox lets an agent write where it starts, and a check has no business there.
- **Always allow for ACP heroes** (#200): an agent's `allow_always` is its own rule, which means nothing to other heroes' sessions (and project rules feed every Claude session). So its request offers "Always allow for this quest" only (`alwaysQuestOnly`; core refuses `always: 'project'` for it, and the game shows no project button). The rule is the request as shown (e.g. `Run npm install`); it is kept on the hero like any quest rule and passed back when its session resumes, so the adapter answers the agent's repeat asks for it at once, with its `allow_always`.
- **Fallbacks** (§11.3):

| Need | When the agent reports it | Fallback |
|---|---|---|
| HP | `usage_update` used / size → exact | unknown |
| Gold | `usage_update.cost` in USD → exact; else per-turn token usage (unstable) × the prices in its `ibitsa.agents` entry → estimated | unknown (subscription agents often have no per-token cost) |
| Gold pouch | — | turn-end enforcement when gold is known or estimated; otherwise the party check warns that the pouch can't stop this hero, and it still starts |
| Message `next` | — | the adapter holds it until the turn ends |
| Message `now` | — | `session/cancel`, then send |
| Rest | the agent lists a `compact` command → `/compact` | Rest disabled, with a tooltip |
| Resume after restart | `session/resume`, else `session/load` | an error item: this agent can't resume |
| `/` actions | `available_commands_update` | none |
| Activity | tool call kind (`execute` matching the test patterns of §5.4 → test, else run; read, edit, search, think…) | other |
| Questions | `elicitation/create` in form mode → a question item | a plain-text question → a reply item |

- **Tests.** A scripted fake ACP agent in the repo (the SDK's agent side over stdio) for unit and integration tests; `pnpm acp:probe` runs `initialize` and `session/new` against installed agents and prints their capabilities (no prompt, nothing spent), for the coverage table (§15, 8); an opt-in live smoke test, run only with approval, on Codex first.
- **Live smoke test** (#202, 2026-10-08, Codex `codex-acp` 2.1.1 on macOS): `IBITSA_SMOKE=1 pnpm exec vitest run --project @ibitsa/agent-acp codex-smoke` runs a sandboxed Codex hero on a small task in a scratch repo, which submits through the bridge, then a Codex reviewer, which files its verdict through the bridge. It passed after two fixes it found:
  - **The bridge's socket is named by its real folder** (`/private/var/…`, not macOS's `/var/…` link). The sandbox allows the socket by path when the agent starts, before the socket exists, and only a real path matches; otherwise the bridge got `connect EPERM` and Codex dropped the server ("omitting MCP server without an exact ready client").
  - **A request to call a tool on Ibitsa's own bridge is allowed at once.** In read-only mode Codex asks before every MCP tool call; the reviewer's read-only rule refused its own `submit_verdict` ("user cancelled MCP tool call"). The connection recognises calls to the `ibitsa` server (Codex names them `mcp.ibitsa.<tool>` with `{ server, tool }`, or `{ serverName }` in an approval) and answers allow-once for heroes and reviewers alike; other servers' calls are asked or refused as before.
  - **Debugging Codex:** `APP_SERVER_LOGS=<dir>` makes `codex-acp` log its traffic with Codex; Codex's own logs, MCP servers' stderr included, are in `~/.codex/logs_2.sqlite` (table `logs`).
  - **No ChatGPT connectors** (#214): Codex gives every session its ChatGPT connectors (the `codex_apps` MCP server, 66 tools here), which act on the apps connected to the user's ChatGPT account through `chatgpt.com`, a domain the sandbox must allow. The Codex preset's env sets `CODEX_CONFIG={"features":{"apps":false}}`, which `codex-acp` merges into each session's config: `codex_apps` no longer starts (`mcpServer/startupStatus` in `APP_SERVER_LOGS`), while the session's own servers, the bridge included, still do. `/mcp` lists the connectors either way: it shows the account's servers, not the session's. A user's `env` for Codex adds to the preset's, so it keeps this unless it sets `CODEX_CONFIG` itself.
- **Coverage** (`pnpm acp:probe`, 2026-10-08; agents not installed have no row yet):

| Agent | `session/new` | Sign-in methods | load / resume / list / close | MCP http / sse | Modes | Config options | Models | `compact` command |
|---|---|---|---|---|---|---|---|---|
| Codex (`codex-acp` 2.1.1) | ok | API key, ChatGPT | yes / yes / yes / yes | yes / no | read-only, workspace-write, agent, agent-full-access | mode, collaboration_mode, model, thought_level, model_config | 7 (default gpt-6.1-sol) | yes |
| Gemini CLI 0.63.0 | `auth_required` (personal account) | oauth-personal, gemini-api-key, vertex-ai, gateway | yes / no / no / no | yes / yes | none | none | not offered | no |

### 11.6 Security and permissions
- Per-role tool allowlists; reviewers and council read-only.
- A short default allowlist of safe actions (read, search, run tests); everything else becomes a permission request in "Needs you".
- Heroes are confined to their worktree. Hero session settings (Claude SDK adapter, settled in [#11](https://github.com/sandrofi84/ibitsa/issues/11); checked against the [permissions](https://code.claude.com/docs/en/agent-sdk/permissions) and [sandboxing](https://code.claude.com/docs/en/sandboxing) docs on 2026-10-04):

| Setting | Value | Effect |
|---|---|---|
| `cwd` | the hero's worktree | file reads inside it need no approval |
| `permissionMode` | `'acceptEdits'`, always passed explicitly (omitting it can start in auto mode) | edits and `mkdir`/`rm`/`mv`/`cp`/`sed` inside the worktree are auto-approved; outside → "Needs you" |
| `sandbox` | enabled, `autoAllowBashIfSandboxed: true`, `failIfUnavailable: true` (macOS, Linux, WSL2) | shell commands run without prompts but can write only to the worktree, temp, and the main repo's shared `.git` (not `hooks/` or `config`); each new network domain → "Needs you"; a missing bubblewrap/socat is an `error` naming the dependency, never a silent unsandboxed run |
| unsandboxed retry | ask rule on `Bash(dangerouslyDisableSandbox:true)` | escaping the sandbox always goes to "Needs you" |
| native Windows | no sandbox available | non-read-only shell commands → "Needs you", except commands matching the test patterns (§5.4), which get allow rules |
| `WebFetch`, `WebSearch` | not pre-approved | → "Needs you" |
| `settingSources` | setting `hero.settingSources`, default `['project']` | the repo's `CLAUDE.md`, project skills and project rules apply. Users may add `'user'` to load their own skills and `CLAUDE.md`; this also loads their personal permission rules and hooks, which can widen what a hero may do without asking, and the setting says so |

**Always allow** (M1.5, #62): a permission item offers "Always allow for this quest" and "Always allow in this project", showing the rules they add: the SDK's own `addRules` allow suggestions, never broader, sent back as `updatedPermissions` for the session. Quest rules are kept on the hero, so a resumed session gets them again as flag-level `settings.permissions.allow`. Project rules are kept by Ibitsa in workspace storage (`project-rules.json`), passed to every new session the same way, and listed in the hero pane with Remove (`forgetProjectRule`, runtime-only). Not `.claude/settings.local.json`: sessions run in worktrees, which never get the repo's git-ignored file. Nothing is offered when the request escapes the sandbox, names a blocked path, needs an extra directory, or points a file tool outside the worktree.
**Auto mode** (M1.5, #63): a per-quest switch, off by default and clearly shown (hero pane notice, AUTO on the pane's tab and in the HUD), under which core answers permission requests with allow at once, without a "Needs you" item, and the journal records each ("Auto-allowed: …"); questions still go to "Needs you". It is the logged command `setAutoApprove`, so a replay shows when it changed. The adapter marks requests that cross a hard limit (`boundary: 'sandboxEscape' | 'outsideWorktree'`) and auto mode never answers those. Not the SDK's own `'auto'` permission mode: that has a model classifier approve or deny each call, whose decisions are opaque and never reach the log, whereas Ibitsa's are deterministic, logged and replayable, with the hard limits enforced by Ibitsa itself.
**Hard limits** that neither ever covers: writing outside the worktree and escaping the sandbox always ask. On native Windows, which has no sandbox, the switch says so before it turns on. ACP heroes (§11.5, #200) keep the same limits through Anthropic's sandbox runtime around the agent's whole process; a hero without it marks every request `unsandboxed`, which auto mode never answers, and its "Always allow" is for the quest only.
**Hero environment** (#67): hero sessions start from a fresh interactive login shell's environment, resolved each time the runtime starts (VS Code's method: the shell prints its environment between markers through Node's binary; 10 s timeout; the extension host's environment as the fallback, and always on Windows). VS Code reads the shell environment only when the app starts, so without this a Node version switched with nvm later never reached heroes. A window reload now picks such changes up. Heroes are also told not to pipe test commands through `tail`/`head`/`grep`, which hides a failing exit status and with it the hurt cue.
- Pack files are images/audio/manifest only.
- **Auth:** v1 uses the user's own Anthropic API key (or a Bedrock/Vertex/Foundry credential), read from VS Code SecretStorage (command "Ibitsa: Set API Key") or the environment (`ANTHROPIC_API_KEY`; `CLAUDE_CODE_USE_BEDROCK`/`VERTEX`/`FOUNDRY` pass through). Not a plain setting: Settings Sync would copy it in clear text.
  - **First run:** when the user starts a quest and no credentials are found, the game shows one onboarding card: a **Get an API key** button that opens the Anthropic Console's API keys page in the browser, and a field to paste the key. The extension checks the key with a request that spends no tokens (listing models) and stores it in SecretStorage; a bad key fails there, not mid-quest. The key travels only between the webview and the extension, over a channel outside the protocol: it never passes through core or the event log. That **host channel** carries messages marked `channel: 'host'` (requests: `credentialsStatus`, `openApiKeyPage`, `saveApiKey`, `openWorktree`; events: `credentials`, `apiKeyAccepted`, `apiKeyRejected`, `openNewQuest`); the extension validates each request with a Valibot schema and never forwards one to the runtime. In development mode the game counts as having credentials, since the SDK may fall back to the developer's login.
  - **claude.ai sign-in:** only with Anthropic's approval, which has not been requested yet. Anthropic does not allow third-party developers to offer claude.ai login without approval, so until then the extension runs no claude.ai login and handles no claude.ai credentials. For local development the developer may use their own Pro/Max login: with no credentials, the SDK falls back to it only when the extension runs in development mode; the published extension shows an error item instead ("No API key yet"). Reusing a subscription login the user already made in Claude Code also needs Anthropic's written confirmation; recheck terms before M10. See [research](https://github.com/sandrofi84/ibitsa/blob/research/auth/docs/research/auth.md).

---

## 12. Persistence and recovery
Settled in [#9](https://github.com/sandrofi84/ibitsa/issues/9); see [ADR 0001](adr/0001-pure-core-event-sourced.md).
- **The event log is the record.** One per campaign at `<workspace storage>/campaigns/<id>/events.jsonl`: append-only JSONL of the core's inputs, written before each step. There is no separate state file. Plan and decision documents in `.ibitsa/campaigns/` (§8.3) are outputs, not recovery state.
  ```jsonc
  {"kind":"header","logVersion":1,"protocolVersion":1,"campaignId":"…","startedAt":"2026-10-04T15:02:11.120Z"}
  {"t":0,"kind":"gm","event":{"type":"worktreeCreated","islandId":"i1","path":"…","branch":"ibitsa/fix-login"}}
  {"t":1840,"kind":"agent","heroId":"h1","event":{"type":"activity","phase":"start","kind":"read","detail":"src/auth.ts"}}
  {"t":9120,"kind":"command","command":{"type":"answerPermission","itemId":"p1","decision":"allow"}}
  ```
  `t` is ms since the header. Each record is exactly a core input (`CoreInput` in `packages/core`); fixtures may add an optional `mark` naming a point where tests capture a snapshot. A torn last line (crash mid-write) is skipped on read. `logVersion` lets old logs be migrated or rejected.
- **Recovery:** `campaigns/active` names the campaign still running (removed when it finishes or is abandoned; the next quest starts a new log and a fresh core). On start, the runtime replays that log through the core at `instant` speed without carrying out effects, then feeds a `runtimeRestarted` input; core decides what survives (M1: live sessions are marked not resumed, pending permissions and questions are dropped, silence timers are cancelled). Effects with no logged result come back as unknown, never as success. Session ids are chosen up front (SDK `sessionId`) and logged before the first event, so they survive. Checkpoints (a state snapshot every N inputs) only if rebuilding gets slow.
- **M1:** after a window reload the hero is `unknown` ("session not resumed") and an `error`-kind "Needs you" item offers resume (SDK `resume`) or stop. No automatic resume until M7.
- **M7 (settled in planning): everything that was running resumes on its own.**
  - Heroes who were working resume their session with "VS Code reloaded; carry on where you left off"; idle heroes resume when they next get a message.
  - Checks that were running run again, and reviewers that were running start over (a fresh session).
  - A sitting resumes its lead session, and the elder's research restarts.
  - A permission or question that was waiting is lost; the hero asks again.
  - You're told with a journal line for each resumed hero or review and a one-time banner ("VS Code reloaded: resumed Ranger Ilse and Rogue Vex, restarted 1 review"), never a "Needs you" item.
  - (#166:) A hero you had just stopped (its interrupted turn not ended yet) isn't resumed; nor is one stopped on an error, a stall or an empty pouch. A hero whose worktree was still being made asks for it again.
  - A sitting waiting on you (open questions, a plan to approve) resumes when you next act. Answers to questions asked before the reload reach it as a message, since the resumed session lost that `ask_user` call. A sitting whose session never started starts again.
  - The runtime replays and restarts before the game connects, so it keeps the notice for the game's first `hello`. Logs recorded before M7 that already had a reload may replay differently (ids can shift); the M1 demo fixture was adjusted to the new rule.
- **Sensitive content:** logs hold message text, paths and commands, so they stay in workspace storage and are never committed or uploaded automatically. Size cap per log (default 20 MB); past it, new records are written without activity `detail` strings (the file is never rewritten, and nothing that affects state is dropped). "Ibitsa: Export Replay" writes a fixture copy of the running (else the latest) campaign's log: paths inside the worktree become relative to it, the worktree itself `.`, the repo a path relative to the worktree, anything else under the home folder `~/…`; a stripped path's remainder is written with `/`, and on Windows the match ignores case and takes either separator (#56). Blanking, if chosen, replaces messages, permission notes and the submit summary, and cuts the quest description to its title line. Every record stays, so the copy replays to the same state.
- **Journal** (#58): the hero pane's Journal section lists what the hero did and said and what you did, built from the campaign log by core's `Journal` (one line per message, finished tool, ask, answer, your message, stop/resume, stall, error, submit), never stored separately. The runtime rebuilds it when it replays the log, pushes new lines to front ends as `journalAppend`, and answers `requestJournal` (a runtime-only command, never logged) with pages of `journal`. The full transcript (tool output, reasoning) is not in it; if wanted later, it comes from Claude Code's own session file.
- **Raw SDK messages** are not logged; the Claude adapter keeps its own small SDK-message fixtures for its mapping tests.

---

## 13. Development workflow
- **Toolchain:** Node 24 LTS for development and CI (`.nvmrc`, `engines.node`); pnpm pinned via `packageManager`. `engines.vscode` is the lowest version with the APIs we use, checked at M0 against the VS Code base of current Cursor and Windsurf builds (Open VSX users).
- **Workspace:** library packages (`protocol`, `core`, `runtime`, adapters) have no build step: their `exports` point at TypeScript source. Only `extension` and `game` produce bundles. Type checking is `tsc -b` over project references, which also enforce allowed dependencies (e.g. `game` cannot import `runtime`). `pnpm -r` scripts; no Turborepo/Nx. Tests sit next to code (`*.test.ts`) under one root Vitest config with a project per package.
- **Lint and format:** Biome. `noNodejsModules` and `noRestrictedImports` keep Node built-ins and `vscode` out of `core`, `protocol` and `game` (ADR 0001).
- **Builds:** esbuild for `extension` (Node, `vscode` external); Vite for `game`.
- **Agent SDK packaging:** the Claude Agent SDK runs a native `claude` binary that it ships as per-platform optional npm dependencies. Keep the SDK external to esbuild (it locates the binary next to its own module) and load it with `import()` (ESM only). Publish **platform-specific VSIX packages** (`vsce package --target`): darwin-x64/arm64, linux-x64/arm64, alpine-x64/arm64, win32-x64/arm64, to both registries, built on one CI runner with `npm ci --os/--cpu/--libc`. Optional setting `ibitsa.claudeCodePath` → `pathToClaudeCodeExecutable`. See [research](https://github.com/sandrofi84/ibitsa/blob/research/sdk-vsix-packaging/docs/research/sdk-vsix-packaging.md).
- **Fast loops:**
  - Game: run `game` standalone in a browser with Vite HMR: the real core plus `agent-fake` replaying an event log (§12). A dev overlay (not shipped) controls speed (0.25×–16×, `instant`), gap cap (pauses over 3 s shortened to 3 s; off for exact timing), pause/step and loop (restart with a fresh core). **Auto** mode replays recorded commands; **interactive** mode pauses at each recorded command until the user sends one of the same type in the game, feeds that instead, and flags "diverged from recording" if it differs.
    - `?fixture=live` swaps the replay for the real core answered by a scripted fake runtime (worktrees, sessions and short scripted turns; asking the hero to "submit" hands the task in) and a fake host channel (`&credentials=none` starts without credentials; a key starting `sk-ant-` other than `sk-ant-bad` is accepted). It plays the New Quest form, onboarding card and hero pane end to end; Playwright's UI tests use it. `&reviews=1` turns reviews on, answered by scripted checks and reviewers (#141); `&reviewScript=pass|stubborn|revisit|dispute|failing|broken` goes straight into one reviewed task that plays that path (changes once then a pass, the loop limit, a revisit, a dispute, a failing check, a reviewer that can't finish). A fake GitHub answers pushes and PRs as the runtime would (#153), and each poll moves a ready PR along open → approved → merged. `&pr=demo` goes straight into a one-island campaign of two tasks, to play a PR from draft to merged and on to Ibitsa; it polls every 4 s (`&prPoll=off`: only on Refresh).
- Builds: `pnpm --filter @ibitsa/game build` is the webview bundle (`main.js`, `main.css`, `pack/`, `textures/`; no HTML, no overlay); `build:standalone` is the browser build with the replay harness (`index.html`, used by Playwright and demos). Both serve the default pack at `pack/`.
  - M0 fixture: a hand-written scenario, `packages/adapters/agent-fake/fixtures/m0-walk.jsonl` (travel, read, edit, failing test, edit, passing test, permission question, submit). `m1-trouble.jsonl` is hand-written too (stall, out of gold, raise). `m1-real.jsonl` is a real quest on a small sample repo, recorded headless through the real runtime, Claude adapter and git game master by an opt-in test (`IBITSA_RECORD=1`, `agent-claude-sdk/src/record.test.ts`) and exported as above; `m1-real.live.json` holds the live run's final snapshot, which the replay must match.
  - Core: Vitest with the `agent-fake` adapter. No tokens spent in tests. Each committed fixture is replayed at `instant` speed and its protocol output (cue sequence, final snapshot, snapshots at marked points) compared with golden files; behaviour changes need a deliberate `vitest -u`.
  - Full integration: F5 Extension Development Host.
- **Tests:** Vitest (unit, with one fixed coverage floor per package on unit-testable code, 90% lines/statements/functions and 80% branches, and per-package numbers in each CI run's summary; Playwright and VS Code tests cover rendering and the extension), `@vscode/test-cli` / `@vscode/test-electron` (integration, headless in CI), Playwright against the standalone game build (visual/e2e).
- **Webview:** load assets via `asWebviewUri` and `localResourceRoots` (including user pack folders); strict CSP (no `unsafe-eval`, scripts only by nonce, other resources only from `${webview.cspSource}`, plus `img-src data:`); bundle everything (no CDNs); don't rely on `retainContextWhenHidden`. Phaser's built-in textures (`__DEFAULT`, `__MISSING`, `__WHITE`) come from bundled PNGs via its `images` config, and its loader uses `imageLoadType: 'HTMLImageElement'` (the default XHR loader goes through `blob:` URLs). `img-src data:` is the agreed fallback, needed because Phaser probes Canvas blend modes with two `data:` PNGs when its module loads (`src/device/CanvasFeatures.js`), found in the M0 engine check ([#13](https://github.com/sandrofi84/ibitsa/issues/13)).
- **Engine check (first M0 work):** F5 opens the game panel; Phaser renders a 480×270 scene integer-scaled and letterboxed to the panel, re-scales on resize, with no CSP errors in the console. If this fails, reopen the engine choice before anything else builds on Phaser. **Passed** in #13 (with the `img-src data:` fallback); covered by `@vscode/test-electron` tests in `packages/extension/src/integration/`.
- **Publishing:** `vsce` to the VS Code Marketplace and `ovsx` to Open VSX (Cursor, VSCodium, Windsurf, …). GitHub Actions: build, test, package, publish on tag.
- **CI from M0:** GitHub Actions on every PR and push to `main`, except docs-only changes (`docs/**`, `*.md`; #192). On Ubuntu: install → Biome → `tsc -b` → Vitest (incl. fixture golden files) → build `extension` and `game` → extension integration tests (`@vscode/test-electron` under `xvfb`); alongside it, Playwright against the standalone game in three parallel shards, in Microsoft's Playwright container (its tag pinned to `@playwright/test`'s version, checked in the job) so no browser is installed per run, with tests spread one by one (`fullyParallel`). Each test step has a 10-minute limit and each job 20 (normal runs take under 2 minutes per step), so a stuck test fails fast. Runners have no GPU, so the test VS Code and Playwright's Chromium start with `--enable-unsafe-swiftshader` for software WebGL. Playwright's screenshots and results are uploaded on every run (artifacts `playwright-results-1` to `-3`, kept 14 days) and listed in the run summary, as visual evidence for PRs. Workflow: `.github/workflows/ci.yml`. A second job runs `tsc -b`, the unit tests and the integration tests on macOS and Windows (sandbox and platform behaviour, §11.6), with assertions that run only on the OS they concern (the Seatbelt sandbox on macOS, no sandbox on native Windows); coverage floors and Playwright stay on Ubuntu. `.gitattributes` keeps LF line endings everywhere. Locally, `pnpm test:integration:docker` runs the integration suites in a Linux container under `xvfb`, so no VS Code window takes focus; `.github/workflows/docker-integration.yml` checks that runner when its files change. Platform-specific packaging and publishing start at M10, on tags.

---

## 14. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold | Monorepo, protocol types, esbuild + Vite builds, F5 opens an empty game panel, `agent-fake` replaying a log drives a token on a map in the standalone game. Placeholder asset pack generated to spec. |
| M1 | One hero | Claude SDK adapter; one hero in one worktree, started as a hand-made quick quest (§14.1); live activity animations, HP bar, gold; stop and send message (queued/now); "Needs you" for permissions/questions. |
| M1.5 | Playability | From playing M1 (#64): speech bubbles; a focus camera that zooms in on the working hero (16×16 art stays) and a large activity icon; hero pane docked right and collapsible; a hero journal; "Always allow" and auto mode (§11.6). |
| M2 | Command bar & actions | `@` targets and files, `/` actions as skills, preview, controls, Command Palette entries. |
| M3 | Elder & council | Research brief with field slices, convening (round table or separate chambers, per-councillor effort), `report` and `ask_user` with voices and "Why?", plan + decision records saved, approval loop, quick-quest path, tallies and "convene the other way", council hut with 32×32 sheets (§14.2). |
| M4 | Parties & map | Plans with islands and branching, multiple worktrees and parallel parties, separate and stacked layouts (both stacked start modes), bridges, party assembly, blocked states, several heroes in the UI, a campaign cap (§14.3). |
| M5 | Review loop | Deterministic checks, concurrent reviewers, verdicts, loop limit, escalation, councillors walking on the map, the task panel (§5.5, §14.4). |
| M6 | PRs | A git-host port (GitHub), a PR per island with drafts and ready for review, stacked bases and restacking, badges with polling, PR comments to the hero (§5.6, §14.5). |
| M7 | Campaign lifecycle | Campaign record, keep/compact/empty, mid-campaign council and amendments, resume after restart (§4.8, §4.9, §12, §14.6). |
| M8 | Customization | Settings layers, Guild Hall, councillor editing, class/model mapping, asset & sound packs with validator and recolor, sounds. |
| M9 | Agent-agnostic | ACP adapter with capability fallbacks: heroes and reviewers on any ACP agent, sandboxed, with the party check (§11.5). |
| M10 | Release | Real art, accessibility pass, docs, Marketplace + Open VSX publishing. |

### 14.1 M1: the hand-started quick quest
Settled in [#11](https://github.com/sandrofi84/ibitsa/issues/11).
- M1 runs a real **campaign**: a quick quest with one task, one island, one party (one hero, no councillors). The elder step is skipped because it doesn't exist yet; M3 adds it in front and M5 adds councillors, without changing the model. The campaign lives in runtime state only; `brief.md`/`plan.md` arrive with M3.
- **New Quest form** in the game panel (a "New quest" button while no quest is active; Command Palette: "Ibitsa: New Quest"): multi-line description (first line, truncated, is the title), hero name (pick from a default list per class or type one), hero class (§5.2 defaults, Ranger preselected; SDK model aliases), base branch (§5.3; the form notes when the folder isn't a git repo, and how many uncommitted changes won't be in the worktree). It asks the extension for credentials first and shows the onboarding card (§11.6) if there are none, then sends `startQuest`. The form and the hero pane are plain DOM over the canvas (a native `<dialog>` and a docked section), so they work from the keyboard alone.
- **Hero pane** (docked top right while a quest exists, collapsible to a tab with the hero's name, a state dot and the "Needs you" count; clicking the hero opens it; open or collapsed is view state, #61): name, class, state, HP, gold, quest and queued messages; a message box with **Send** (`next`) and **Send now** (`now`); **Stop**; **Finish quest** once submitted, or **Mark done** while waiting for orders; **Abandon quest** (asks once more); **Open worktree**; and **Remove worktree** after the quest ends.
- The island is named after the quest title; the hero keeps the user's chosen name everywhere.
- **Speech bubbles** (#57): each hero message shows an excerpt above the hero (first sentence, at most 34 characters) for 4 s; after `submit_task`, "Ready for review!" stays until the quest is finished or the hero works again, and clicking a bubble opens the hero pane, which shows the summary. Speech and status bubbles and the activity icon keep their whole-map size while the camera zooms (#75).
- **One quest at a time:** starting another is disabled until the current one is finished or abandoned.
- **After `submit_task`:** the task point shows done (unreviewed) and the hero is `submitted`. From the hero's detail pane the user can send a message (the hero resumes work and the task point is active again) or **finish quest**: the session closes, the branch and worktree are kept, and the pane shows the branch with "open worktree in new window" and "remove worktree" (only if clean). **Abandon quest** works from any state, same outcome, marked abandoned. No celebration scene and no campaign record in M1.

---

### 14.2 M3: elder and council
Settled in M3 planning.
- The New Quest description goes to the elder; its brief offers **Quick quest** (one hero, as in M1) or **Convene council** (§4.1–4.2).
- Both kinds of sitting are built on one shared council (§4.3), in this order: round table first (the baseline), then separate chambers, then tallies and the comparison (§4.10).
- An approved plan is carried out by **one hero working its tasks in order on one branch**, until M4 brings parties and islands (#104). The island's task points are the plan's tasks, each after the tasks it depends on, otherwise as listed; the first is active, the rest locked. The hero's first message is task 1 with its place in the plan, files, criteria and the decisions it keeps to. Each accepted `submit_task` marks the task done and sends the next one as a message on the same session; after the last, the hero is submitted. (The submit check still asks only for a commit beyond the base, so a later task passes on an earlier one's commits; per-task review is M5.)
- Effort Light/Standard/Deep maps to Haiku/Sonnet/Opus (§4.2).

### 14.3 M4: parties and the map
Settled in M4 planning.
- **Islands in the plan:** `islands` (each with its tasks in order, optionally based on another island) and `branching` (`separate` | `stacked`); core checks every task is on exactly one island. A quick quest stays one island.
- **Parallel parties:** `ibitsa.parties.maxParallel`, default 2 (§5.1); blocked heroes start by themselves.
- **Stacked start:** your choice in party assembly (§5.3).
- **Several heroes in the UI** (#125): the **selected hero** (kept in view state; until you choose, the first that needs you, else the first working, else the first, then it stays put) is what the hero pane shows and whom the command bar speaks to without an `@`; clicking a hero on the map, its button in the pane's hero list (shown with two or more heroes, open or collapsed, each with its state dot and "Needs you" count), or one of its "Needs you" items selects it. `@<hero handle>` targets one hero, `@all` every hero with a session (not the blocked ones); the `/` menu and the action preview use the addressed hero's worktree (`requestActions`/`requestPreview` carry a `heroId`). A blocked hero says why: waiting for a free slot, for the island before, or for a task on another island. The Command Palette's Message Hero…, Run Action… and Stop Hero ask which hero when there are several.
- **Ending** (#126): with several parties the hero pane offers **Finish campaign** (enabled once every island is submitted, "N of M islands submitted"; core names the open islands otherwise) and **Abandon campaign** (every party, started or not; nothing starts after). **Stop** stops one party. After the end each island's worktree is opened or removed from its hero's pane. The HUD shows the campaign's gold against its cap; heroes stopped by the cap say so in "Needs you" with **Raise the campaign cap by $5**.
- **Campaign cap:** `ibitsa.campaign.budgetUsd` (empty by default): when every hero plus the elder and council together reach it, every working hero stops (interrupted) and asks, as an out-of-gold item marked as the campaign's; raising it (`raiseCampaignBudget`) lets them carry on. It counts what has been reported, so a hero that hasn't reported yet counts as nothing spent, and it's checked at each cost report (it may overshoot by a turn).
- **Starting:** `startCampaign` (#121) carries out the approved plan: one island and one hero per plan island (class, name and optional gold pouch per party), the base branch, and for stacked plans the start mode. Party assembly sends it (#123); the one-hero `startPlannedQuest` is gone. A plan without islands is one island named after the campaign.

### 14.4 M5: the review loop
Settled in M5 planning; the details are in §5.5.
- Checks from `ibitsa.checks` or detected `package.json` scripts; one at a time, stop at the first failure.
- One read-only reviewer session per councillor, in parallel, with `submit_verdict`; review effort per councillor in party assembly (Light by default).
- Reviewers see only the task's commits; re-reviews only the flaggers, on the delta.
- The hero waits under review; "done" means passed review for dependencies and bridges.
- Blocking findings cite a criterion or bug/security/breaks; "revisit D…?" goes to the user.
- Loop limit 3, then Accept anyway / Send back / Stop; the hero's `dispute_finding` escalates contradictions.
- Councillors walk out with magnifiers; the task panel shows verdicts, findings, checks and suggestions.
- Quick quests: checks only.

### 14.5 M6: pull requests
Settled in M6 planning; the details are in §5.6.
- One PR per island; drafts may open early, Mark ready once cleared; quick quests too.
- GitHub only, through VS Code's GitHub sign-in, behind a `GitHost` port; `origin`'s repository.
- Every push and PR change is a click; the body is built from the record.
- Badges above islands, polled every 60 s while a PR is open; a PR card with the actions.
- PR comments go to the hero's resumed session; its session ends when the PR is ready.
- Stacked: in order, retarget after a merge, Restack with confirmation.
- Remove worktree after a merge; every PR merged reaches Ibitsa.

### 14.6 M7: campaign lifecycle
Settled in M7 planning; the details are in §4.1, §4.8, §4.9 and §12.
- After a restart, everything that was running resumes on its own, with a banner and journal lines.
- The record is built from the log on Finish and Abandon, plus Lessons from the elder on Haiku.
- The council's context: Empty by default, or Compact or Keep; the elder reads the related past records.
- `@council`, `@<councillor>` and the hut reach the lead session, capped per consultation; heroes keep working.
- Amendments touch only work not started (rework is a new task), are reviewed as a change set, and can add islands with their own party assembly.
- Later: `#review` notes for the reviewers (#164); a Chronicle of past campaigns (M8).

### 14.7 M8: customization
Settled in M8 planning; the details are in §1.1, §4.7, §5.2, §7.1, §8.1, §9.3 and §9.4.
- Settings layers are VS Code's (user, workspace); campaign overrides stay with the campaign.
- The Guild Hall in Home Village: Roster, Armory, Rule book, Spell book, Packs, Chronicle; every value shows its layer and resets.
- Councillors: customise (copy the skill), extend (field overrides), new from a template, on/off.
- Classes in `ibitsa.classes`, new classes with an appearance; recolor by hue and presets.
- User packs, one active, falling back to the default; validator and previews; switching live.
- Generated default sounds in the pack format; volume per category, Focus mode.
- The lore: the start screen with the hut and the Guild Hall, the council's welcome, charting islands out of the fog, the voyage into the mist, islands sinking after Finish.

## 15. Open questions
1. Name registration: domains (ibitsa.com, ibitsa.dev, questforibitsa.com), GitHub org, npm scope, Marketplace/Open VSX publisher; trademark search (EUIPO TMview, USPTO). Initial checks found no conflicting software use.
2. Rogue = Haiku confirmed? Default class roster and names.
3. ~~Character sprite size: 16×16 vs 32×32.~~ Settled: 16×16 on the map; 32×32 council sheets in the council hut (§9.2).
4. ~~Game engine: Phaser vs PixiJS.~~ Settled: Phaser 4 (§9.1).
5. ~~Councillor skill location so they don't clutter the normal `/` menu.~~ Settled in M3 planning and #98: the usual skill locations, `ibitsa-target: council` keeps them out of the hero's menu, and `disable-model-invocation` doesn't block subagent preloading (§4.7).
6. ~~Whether Claude Code tolerates extra frontmatter fields (for action `target`), else sidecar.~~ Settled in M2 planning: a skill with an extra flat field loads and is listed by `supportedCommands()`; Ibitsa uses `ibitsa-target` and reads it from the file.
7. ~~Confirm SDK invocation of custom skills via `/name` prompts.~~ Settled (#84): a real session sent `/greet Wren` ran the project skill with its argument (opt-in smoke test).
8. ~~ACP capability coverage per agent.~~ Settled in M9: measured with `pnpm acp:probe` and kept as a table in §11.5, with a live smoke test on Codex (#202). Agents not installed get their row when someone runs the probe with them.
9. Subscription (claude.ai) sign-in for the published extension: possible only with Anthropic's approval; not requested yet (§11.6).
10. ~~Default max parallel parties.~~ Settled in M4 planning: 2, `ibitsa.parties.maxParallel` (§5.1).
11. ~~Specialist dives (planning subagents): add later or not.~~ Settled in M3 planning: separate chambers (§4.3), measured against the round table (§4.10).
12. Optional `@ibitsa` VS Code chat participant. Not in M2 (#88).
