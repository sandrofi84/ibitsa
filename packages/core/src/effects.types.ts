import type { CouncilAnswer, Effort, SittingMode } from '@ibitsa/protocol';

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
  /** Start a sitting's lead session (spec §4.3); its output comes back as `council` inputs. */
  | {
      type: 'startSitting';
      sittingId: string;
      mode: SittingMode;
      task: string;
      effort: Effort;
      roster: { councillorId: string; effort: Effort }[];
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
  | { type: 'setTimer'; timerId: string; at: number }
  | { type: 'cancelTimer'; timerId: string };

export type SittingMessage =
  | { kind: 'changeRequested'; version: number; text: string }
  | { kind: 'councillorAdded'; councillorId: string; effort: Effort }
  /** "Why?" (§4.4): the councillor who asked `question` explains; `text` is the user's follow-up. */
  | { kind: 'why'; questionId: string; councillorId: string; question: string; text?: string };
