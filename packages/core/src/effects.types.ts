import type {
  CouncilAnswer,
  Effort,
  Plan,
  ResearchBrief,
  SittingMessage,
  SittingMode,
} from '@ibitsa/protocol';

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
  /** Remove a finished quest's worktree if it is clean. */
  | { type: 'removeWorktree'; islandId: string; worktreePath: string; commandId: string }
  | { type: 'sendMessage'; heroId: string; text: string; priority: 'now' | 'next' }
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
  /** Stacked, all at once (#121): rebase the island's worktree onto the branch it builds on. */
  | { type: 'rebaseWorktree'; islandId: string; worktreePath: string; onto: string }
  | { type: 'setTimer'; timerId: string; at: number }
  | { type: 'cancelTimer'; timerId: string };
