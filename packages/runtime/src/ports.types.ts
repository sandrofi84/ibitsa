import type { GameMasterEvent } from '@ibitsa/core';
import type {
  ActionDraft,
  ActionInfo,
  AgentEvent,
  CheckResult,
  CoreMessage,
  CouncilAnswer,
  CouncilEvent,
  CouncillorInfo,
  Decision,
  Effort,
  ElderEvent,
  LessonsEvent,
  PolledPullRequest,
  PullRequestComment,
  PullRequestState,
  RepoView,
  ResearchBrief,
  ReviewEvent,
  SittingMessage,
  SittingMode,
} from '@ibitsa/protocol';

/** Starting one hero's agent session (spec §11.3). The adapter reports everything through `onEvent`. */
export interface SessionStart {
  heroId: string;
  /** Chosen up front so it is logged before the first event (§12). */
  sessionId: string;
  cwd: string;
  classId: string;
  prompt: string;
  /** For adapters with a native cap: what is left of the gold pouch (spec §7.3). */
  maxBudgetMicroUsd?: number;
  /** Rules allowed without asking: this quest's and the project's "Always allow" (#62). */
  allowRules?: string[];
}

export interface SessionResume {
  heroId: string;
  sessionId: string;
  cwd: string;
  classId: string;
  /** Sent after resuming when interrupted work should continue. */
  prompt?: string;
  maxBudgetMicroUsd?: number;
  allowRules?: string[];
}

export interface AgentSession {
  send(text: string, priority: 'now' | 'next'): void;
  /** Interrupt and drop anything the adapter is holding (a full stop). */
  interrupt(): void;
  /** Compact the session to free context (Rest, #82). */
  compact(): void;
  /** `always`: also allow the request's suggested rules for the rest of the session (#62). */
  respondToPermission(answer: {
    requestId: string;
    decision: 'allow' | 'deny';
    note?: string;
    always?: boolean;
  }): void;
  answerQuestion(requestId: string, answers: Record<string, string | string[]>): void;
  completeSubmit(result: { toolUseId: string; accepted: boolean; reason?: string }): void;
  close(): void;
}

export interface AgentAdapter {
  /** What the agent can do about cost (spec §7.3, §11.3). */
  capabilities: { budgetCap: boolean; costReported: boolean };
  startSession(start: SessionStart, onEvent: (event: AgentEvent) => void): AgentSession;
  resumeSession(resume: SessionResume, onEvent: (event: AgentEvent) => void): AgentSession;
  /** The `/` menu's actions for a folder (#84); adapters without skills leave it out. */
  listActions?(request: { cwd: string }): Promise<ActionInfo[]>;
  /** An action's expanded prompt for the preview (#85); null when its file can't be read. */
  previewAction?(request: {
    cwd: string;
    name: string;
    args: string;
  }): Promise<{ text: string; notes: string[] } | null>;
  /** The elder's research session (spec §4.1, #101); adapters that can't run it leave it out. */
  startElder?(start: ElderStart, onEvent: (event: ElderEvent) => void): { close(): void };
  /** The elder's lessons at a campaign's end (§4.9, #167); without it the record has no lessons. */
  startLessons?(start: LessonsStart, onEvent: (event: LessonsEvent) => void): { close(): void };
  /**
   * Compact a council's lead session so the next campaign can resume it lighter (§4.9, #167).
   * Adapters that can't leave it out; Compact then keeps the session as it is.
   */
  compactCouncil?(request: { cwd: string; sessionId: string }): Promise<void>;
  /** A reviewer's session (§5.5, M5); #138 adds it to the Claude adapter. */
  startReview?(start: ReviewStart, onEvent: (event: ReviewEvent) => void): ReviewSession;
  /** A short hash of the adapter's council prompts, part of the council version (§4.10, #106). */
  councilPromptVersion?: string;
  /** A sitting's lead session (spec §4.3, #103); adapters that can't run one leave it out. */
  startSitting?(start: SittingStart, onEvent: (event: CouncilEvent) => void): SittingSession;
  /** The councillors a folder can seat (§4.7, #98); adapters without skills leave it out. */
  listCouncillors?(request: { cwd: string }): Promise<CouncillorInfo[]>;
  /** Writes a new action (#86); adapters without skills leave it out. */
  createAction?(request: CreateActionRequest): Promise<CreateActionResult>;
}

/** Starting the elder's research (spec §4.1): read-only, capped, ending with `submit_brief`. */
export interface ElderStart {
  /** The workspace repository it researches. */
  cwd: string;
  task: string;
  /** Who it may recommend; the brief may name no one else. */
  councillors: readonly CouncillorInfo[];
  /** A model alias or id; Haiku by default. */
  model: string;
  maxBudgetMicroUsd: number;
  /** An index of past campaigns' records (§4.1, #168): it reads only those that look related. */
  pastRecords: readonly PastRecord[];
  /** The council's context kept from an earlier campaign (§4.9), named by that campaign; else null. */
  keptCouncil: { from: string } | null;
}

/** One past campaign in the elder's index (#168): enough to judge it, and where its record is. */
export interface PastRecord {
  campaignId: string;
  title: string;
  /** `YYYY-MM-DD`, when its record was written. */
  date: string;
  status: 'finished' | 'abandoned';
  /** The plan's summary, when it had one. */
  summary: string | null;
  /** The record, relative to the repository. */
  path: string;
}

/** The elder's lessons (§4.9, #167): a short session on a cheap model, from the reviews' material. */
export interface LessonsStart {
  cwd: string;
  /** The campaign's title, for the prompt. */
  title: string;
  /** What happened in the reviews, one line each (core's `CampaignRecord.material`). */
  material: string;
  model: string;
  maxBudgetMicroUsd: number;
}

/** Starting a sitting's lead session (spec §4.3): read-only, capped, with the council's tools. */
export interface SittingStart {
  /** The workspace repository the council plans for. */
  cwd: string;
  mode: SittingMode;
  task: string;
  /** The elder's brief, when there is one: the sitting starts from it (§4.1). */
  brief: ResearchBrief | null;
  /** In separate chambers each councillor also has its own model, from its effort (§4.2). */
  roster: readonly { councillorId: string; effort: Effort; model?: string }[];
  /** From the sitting's effort (§4.2); in separate chambers, the chairing elder's. */
  model: string;
  maxBudgetMicroUsd: number;
  /**
   * Resume an earlier lead session instead of starting one (#166): `prompt` is its next message, e.g.
   * a question to the council mid-campaign (#169); without one nothing is sent. `kept` (#167): the
   * council's context was kept from the last campaign, so the new sitting's usual opening goes to it.
   */
  resume?: { sessionId: string; prompt?: string; kept?: boolean };
}

/** A running sitting: core's answers to its tool calls and what the user did go back through it. */
export interface SittingSession {
  /** The user asked for changes, added a councillor, or asked "Why?". */
  message(message: SittingMessage): void;
  /** Core's verdict on a `report`, `ask_user` or `propose_plan` call. */
  completeTool(result: { toolUseId: string; accepted: boolean; reason?: string }): void;
  /** The user's answers to an accepted `ask_user` batch, in question order. */
  answer(result: { toolUseId: string; answers: CouncilAnswer[] }): void;
  close(): void;
}

/** Starting a reviewer (§5.5): what it reviews and against what; its diff comes from the game master. */
export interface ReviewStart {
  cwd: string;
  councillorId: string;
  model: string;
  maxBudgetMicroUsd: number;
  round: number;
  /** The task's commits, or only what changed since this councillor's last review. */
  diff: string;
  task: { title: string; description: string };
  criteria: string[];
  decisions: Decision[];
  checks: CheckResult[];
}

/** A running review: core's verdict on `submit_verdict` goes back through it. */
export interface ReviewSession {
  completeTool(result: { toolUseId: string; accepted: boolean; reason?: string }): void;
  close(): void;
}

/** A new action to write, and where each scope keeps its skills. */
export interface CreateActionRequest {
  draft: ActionDraft;
  overwrite: boolean;
  roots: { personal: string; project: string };
}

export type CreateActionResult =
  | { ok: true; path: string }
  | { ok: false; reason: string; clash: boolean };

/** The game master's own work in the repo (spec §5.3, §5.5); results come back as core inputs. */
export interface GameMaster {
  createWorktree(request: {
    islandId: string;
    branch: string;
    baseRef: string;
  }): Promise<GameMasterEvent>;
  checkSubmit(request: {
    heroId: string;
    toolUseId: string;
    worktreePath: string;
    baseRef: string;
  }): Promise<GameMasterEvent>;
  /** A hash of the worktree's diff against HEAD, for the no-progress stall rule. */
  observeDiff(request: { worktreePath: string }): Promise<string>;
  /** Removes the worktree if it is clean, and `branch` with it when named (#154). */
  removeWorktree(request: {
    worktreePath: string;
    branch?: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Default branch, local branches and uncommitted changes of the workspace; null if not a git repo. */
  scanRepo(): Promise<RepoView | null>;
  /**
   * Stacked, all at once (#121): rebase a worktree onto the branch it builds on; aborts on a conflict.
   * Game masters that can't leave it out (#122 adds it to the git one).
   */
  rebaseWorktree?(request: {
    worktreePath: string;
    onto: string;
  }): Promise<'upToDate' | 'rebased' | 'conflict'>;
  /** Runs a submitted task's checks (§5.5, M5); #137 adds it to the git game master. */
  runChecks?(request: { worktreePath: string }): Promise<CheckResult[]>;
  /** A task's diff `from..to`, or only `since..to` on a re-review (M5); `to` null is the worktree's HEAD. */
  taskDiff?(request: {
    worktreePath: string;
    from: string;
    to: string | null;
    since: string | null;
  }): Promise<string>;
  /** The worktree's files, tracked and untracked but not ignored, for @ references (#83). */
  listFiles(request: { worktreePath: string }): Promise<string[]>;
  /** `origin`'s URL (§5.6, M6); null without one. Game masters that can't push leave these out. */
  remoteUrl?(): Promise<string | null>;
  /** Stacked (#154): move a branch onto `origin/<onto>`, dropping commits up to `upstream`. */
  restack?(request: {
    worktreePath: string;
    onto: string;
    upstream: string;
  }): Promise<'restacked' | 'conflict' | 'uncommitted'>;
  /** Pushes a worktree's branch to `origin`; `force` is `--force-with-lease`. */
  push?(request: {
    worktreePath: string;
    branch: string;
    force?: boolean;
  }): Promise<{ ok: true; head: string } | { ok: false; reason: string }>;
}

/**
 * The git host (spec §5.6, M6): GitHub first, behind this port. Each call names `origin`'s URL; a host
 * that doesn't serve it, or a user who isn't signed in, fails with a message the user can act on.
 */
export interface GitHost {
  openPullRequest(request: {
    remoteUrl: string;
    head: string;
    base: string;
    title: string;
    body: string;
    draft: boolean;
  }): Promise<{ number: number; url: string; state: PullRequestState }>;
  markReady(request: { remoteUrl: string; number: number }): Promise<void>;
  /** Before any click (#162): why this remote can't have PRs here, and whether the user is signed in. */
  status(request: {
    remoteUrl: string;
  }): Promise<{ unsupported: string | null; signedIn: boolean }>;
  /** The badge state of each PR; never asks the user to sign in. */
  poll(request: { remoteUrl: string; numbers: number[] }): Promise<PolledPullRequest[]>;
  reviewComments(request: { remoteUrl: string; number: number }): Promise<PullRequestComment[]>;
  /** Change a PR's base, after the PR it was stacked on merged (#154). */
  retarget(request: { remoteUrl: string; number: number; base: string }): Promise<void>;
}

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** A connected front end (a webview, later a daemon client). */
export interface FrontEnd {
  post(message: CoreMessage): void;
}

/** Settings the user controls; the runtime logs them before each quest starts. */
export interface UserSettings {
  budgetMicroUsd: number | null;
  stall: { testFailures: number; fileEdits: number; noProgressTurns: number };
  /** `ibitsa.parties.maxParallel` (#121). */
  maxParallel?: number;
  /** `ibitsa.campaign.budgetUsd` in micro-dollars (#121); null for none. */
  campaignBudgetMicroUsd?: number | null;
  /** `ibitsa.review.loopLimit` (M5). */
  loopLimit?: number;
  /** `ibitsa.council.consultBudgetUsd` in micro-dollars (#169): one question to the council. */
  consultBudgetMicroUsd?: number;
}
