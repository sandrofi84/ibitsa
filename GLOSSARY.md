# Ibitsa

Ibitsa (Quest for Ibitsa) presents work with AI coding agents as a pixel-art RPG: a council plans with the user, parties of heros carry out the plan, and councillors review the result. Every character stands for a real agent session.

## Campaign

**Campaign**:
One goal from the user, from the first question to the final pull requests.
_Avoid_: Project, run, session

**Quick quest**:
A campaign small and clear enough to skip the council and go straight to a single hero.

**Campaign record**:
The council's closing account of a campaign: decisions, what shipped, what was deferred, lessons.

**Ibitsa**:
The destination island in the game world; reaching it means the campaign's work has shipped.

## Council

**Council**:
The group of advisors who plan a campaign with the user and later review the work.

**Elder**:
The council's first and permanent member: researches the task, recommends councillors, moderates and owns the plan.

**Councillor**:
A domain persona (Architect, Tester, Security, …) with a planning mode, a review mode, or both.
_Avoid_: Advisor, reviewer (as a noun for the persona)

**Council session**:
The single agent session in which planning happens; councillors are perspectives inside it, not separate agents.

**Research brief**:
The elder's short written handoff from research into planning.
_Avoid_: Research notes, transcript

**Plan**:
The approved, versioned document describing a campaign's tasks, islands, branching strategy, acceptance criteria and decision records.

**Plan amendment**:
A change to an approved plan, producing a new version that names the parties it affects.

**Decision record**:
A user's recorded choice, with its alternatives, trade-offs and reasons. Superseded, never overwritten.

**Book of Decisions**:
The collection of a campaign's decision records.

## Work

**Task**:
The unit of work in a plan: one thing a hero does and the councillors review.
_Avoid_: Ticket, job, story

**Ticket**:
An item in an outside ticket system (GitHub Issues, Linear, Jira) that a campaign or its tasks may come from. Not part of the game world.
_Avoid_: Task (for this meaning)

**Island**:
One branch (and its worktree) on the world map, holding that branch's task points.
_Avoid_: Level, world

**Task point**:
A task's position on its island.
_Avoid_: Node, level

**Home Village**:
The map's starting island, standing for the main branch; home of the council hut.

**Branching strategy**:
How a plan's islands relate: **separate** (each branches from main) or **stacked** (each builds on the previous, joined by bridges).

## Parties

**Party**:
One lead hero assigned to one island, plus the councillors who will review its work.
_Avoid_: Team, squad

**Hero**:
A coding agent session that carries out tasks.
_Avoid_: Warrior, worker, agent (in game-facing language)

**Hero class**:
A named pairing of agent runtime and model that a hero is created from (Paladin, Barbarian, Ranger, Rogue).
_Avoid_: Tier, role

**Execution state**:
Exactly one of a hero's current conditions (traveling, working, waiting on you, blocked, resting, submitted, stalled, error), always derived from real agent events.

**Review**:
A councillor's check of a submitted task against its acceptance criteria, ending in a verdict.

**Verdict**:
A councillor's review result: pass, or changes with findings.

**Finding**:
One issue raised in a verdict, either blocking or a suggestion.

## Interaction

**Needs you**:
The single queue of questions and permission requests waiting for the user.
_Avoid_: Inbox, notifications

**Action**:
A reusable prompt sent to a party or the council.
_Avoid_: Spell (outside the Guild Hall UI), macro

**Control**:
An operation on a session that is not a prompt: stop, rest, re-review, abandon, end campaign.

**Rest**:
Freeing up a session's context, by compaction or by restarting fresh from a summary.

**HP**:
A session's remaining context window.

**Gold**:
Money spent on agent usage.

## System

**Game master**:
The rule-keeper that runs the campaign: deterministic code, never an LLM.

**Adapter**:
A plug-in connecting the core to one outside system: an agent runtime, git host or ticket system.

**Guild Hall**:
The settings screen where councillors, classes, rules, actions and packs are customized.

**Pack**:
A folder of art or sound, described by a manifest, that fills the game's visual or audio slots.
