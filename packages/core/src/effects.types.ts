import type {
  CheckResult,
  CouncilAnswer,
  CouncilContextChoice,
  Decision,
  Effort,
  Plan,
  ResearchBrief,
  SittingMessage,
  SittingMode,
} from '@ibitsa/protocol';
import type { CampaignRecordData } from './campaign-record.types';

/** Requests core makes of the runtime. Core never performs them itself (ADR 0001). */
export type Effect =
  | { type: 'createWorktree'; islandId: string; branch: string; baseRef: string }
  /** `maxBudgetMicroUsd` = cap − spent, for adapters that stop natively (spec §7.3). */
  | {
      type: 'startSession';
      heroId: string;
      cwd: string;
      classId: string;
      prompt: string;
      maxBudgetMicroUsd?: number;
      /** "Always allow for this quest" rules (#62); the runtime adds the project's. */
      allowRules?: string[];
    }
  /** Resume a session by id; `prompt` restarts work that was interrupted. */
  | {
      type: 'resumeSession';
      heroId: string;
      sessionId: string;
      cwd: string;
      classId: string;
      prompt?: string;
      maxBudgetMicroUsd?: number;
      allowRules?: string[];
    }
  /** Report the worktree's diff hash; the result comes back as `diffObserved`. */
  | { type: 'observeDiff'; heroId: string; worktreePath: string }
  /** Remove a finished quest's (or a merged island's) worktree if it is clean; `branch` is deleted too (#154). */
  | {
      type: 'removeWorktree';
      islandId: string;
      worktreePath: string;
      commandId: string;
      branch?: string;
    }
  | { type: 'sendMessage'; heroId: string; text: string; priority: 'now' | 'next' }
  /** The elder's short lessons session at the campaign's end (§4.9, #167), from `material`. */
  | { type: 'startLessons'; lessonsId: string; material: string }
  /** Save `record.md` (§4.9); `recordWritten` or `recordFailed` comes back. */
  | { type: 'writeRecord'; record: CampaignRecordData }
  /** After Finish: keep the council's lead session for the next campaign, compact it first, or forget it. */
  | { type: 'councilContext'; choice: CouncilContextChoice; sessionId: string | null }
  /** Push the island's branch (§5.6); `branchPushed` or `remoteFailed` comes back. */
  | {
      type: 'pushBranch';
      islandId: string;
      worktreePath: string;
      branch: string;
      /** `--force-with-lease`: the hero rebased the branch onto a merged island's base (#154). */
      force?: boolean;
    }
  /** The PR's review comments, for the hero (#154); `pullRequestComments` or `remoteFailed` comes back. */
  | { type: 'fetchPullRequestComments'; islandId: string; number: number }
  /** Stacked: the PR it built on merged, so this one now targets `base`; `pullRequestRetargeted` comes back. */
  | { type: 'retargetPullRequest'; islandId: string; number: number; base: string }
  /**
   * Stacked: move the branch onto `origin/<onto>`, dropping commits up to `upstream` (#154), and push it
   * (forced, with lease) when it has a PR; `restacked` or `remoteFailed` comes back.
   */
  | {
      type: 'restack';
      islandId: string;
      worktreePath: string;
      branch: string;
      onto: string;
      upstream: string;
      push: boolean;
    }
  /** Push, then open the PR; `pullRequestOpened` or `remoteFailed` comes back. */
  | {
      type: 'openPullRequest';
      islandId: string;
      worktreePath: string;
      branch: string;
      base: string;
      title: string;
      body: string;
      draft: boolean;
    }
  /** Push, then mark the draft ready for review; `pullRequestReady` or `remoteFailed` comes back. */
  | {
      type: 'markPullRequestReady';
      islandId: string;
      worktreePath: string;
      branch: string;
      number: number;
    }
  /** The PRs to poll from now on (an empty list stops polling); `pullRequestsPolled` comes back. */
  | { type: 'watchPullRequests'; numbers: number[] }
  /** Poll these PRs now, as well as at the interval. */
  | { type: 'pollPullRequests'; numbers: number[] }
  /** Interrupt the turn and drop the adapter's queued messages. */
  | { type: 'interrupt'; heroId: string }
  /** Compact the session (Rest, #82); the agent reports `resting` then `compacted`. */
  | { type: 'compactSession'; heroId: string }
  | {
      type: 'answerPermission';
      heroId: string;
      requestId: string;
      decision: 'allow' | 'deny';
      note?: string;
      /** Allow the request's rules from now on (#62); for 'project' the runtime keeps them. */
      always?: 'quest' | 'project';
      rules?: string[];
    }
  | {
      type: 'answerQuestion';
      heroId: string;
      requestId: string;
      answers: Record<string, string | string[]>;
    }
  /** Run the submit check; the result comes back as a `submitChecked` game master event. */
  | { type: 'checkSubmit'; heroId: string; toolUseId: string }
  /** Return the `submit_task` tool result to the hero. */
  | {
      type: 'completeSubmit';
      heroId: string;
      toolUseId: string;
      accepted: boolean;
      reason?: string;
    }
  | { type: 'closeSession'; heroId: string }
  /** Start the elder's research session (spec §4.1); its output comes back as `elder` inputs. */
  | { type: 'startElder'; elderId: string; task: string }
  | { type: 'closeElder'; elderId: string }
  /** Write the brief to the campaign folder (`brief.json`, `brief.md`); Ibitsa never commits it. */
  | { type: 'saveBrief'; elderId: string; brief: ResearchBrief }
  /** Write the approved plan to the campaign folder (`plan.json`, `plan.md`); Ibitsa never commits it. */
  | { type: 'savePlan'; sittingId: string; version: number; plan: Plan }
  /** Start a sitting's lead session (spec §4.3); its output comes back as `council` inputs. */
  | {
      type: 'startSitting';
      sittingId: string;
      mode: SittingMode;
      task: string;
      effort: Effort;
      roster: { councillorId: string; effort: Effort }[];
      /** The elder's brief the sitting starts from (spec §4.1); null when convened without one. */
      brief: ResearchBrief | null;
      /**
       * Resume the lead session instead of opening the sitting (#166): `prompt` is its next message
       * (mid-campaign, the user's question and the campaign's status, #169).
       */
      resume?: { sessionId: string; prompt?: string };
      /** A cap of its own instead of the effort's, e.g. one question mid-campaign (#169). */
      maxBudgetMicroUsd?: number;
    }
  /** Something the user did that the sitting must hear about. */
  | { type: 'sittingMessage'; sittingId: string; message: SittingMessage }
  /** The result of a `report` or `propose_plan` call: accepted, or rejected with the reason. */
  | {
      type: 'completeSittingTool';
      sittingId: string;
      toolUseId: string;
      accepted: boolean;
      reason?: string;
    }
  /** The user's answers to an `ask_user` batch, in question order. */
  | {
      type: 'answerSittingQuestions';
      sittingId: string;
      toolUseId: string;
      answers: CouncilAnswer[];
    }
  | { type: 'closeSitting'; sittingId: string }
  /** Run the checks for a submitted task (§5.5); the result comes back as `checksRan`. */
  | { type: 'runChecks'; taskPointId: string; worktreePath: string }
  /**
   * Start a reviewer (§5.5): one councillor, one task, one round. It reviews `from..to` (the task's
   * commits), or only `since..to` on a re-review; its output comes back as `review` inputs.
   */
  | {
      type: 'startReview';
      reviewId: string;
      taskPointId: string;
      councillorId: string;
      effort: Effort;
      round: number;
      worktreePath: string;
      from: string;
      to: string | null;
      since: string | null;
      task: { title: string; description: string };
      criteria: string[];
      decisions: Decision[];
      checks: CheckResult[];
    }
  | {
      type: 'completeReviewTool';
      reviewId: string;
      toolUseId: string;
      accepted: boolean;
      reason?: string;
    }
  | { type: 'closeReview'; reviewId: string }
  /** Stacked, all at once (#121): rebase the island's worktree onto the branch it builds on. */
  | { type: 'rebaseWorktree'; islandId: string; worktreePath: string; onto: string }
  | { type: 'setTimer'; timerId: string; at: number }
  | { type: 'cancelTimer'; timerId: string };
