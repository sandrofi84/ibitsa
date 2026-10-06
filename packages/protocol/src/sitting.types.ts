import type { Effort, SittingMode } from './commands.schema';
import type { Plan } from './plan.schema';
import type { MicroUsd, Reading } from './values.types';

/** A concern in a councillor's report (spec §4.3). */
export interface Concern {
  summary: string;
  severity: 'low' | 'medium' | 'high' | 'serious';
  reason: string;
}

/**
 * What a councillor files through the `report` tool (spec §4.3). A councillor with nothing to add
 * files a bow-out: `bowOut` says why, and the lists may be empty. It still counts as reported.
 */
export interface CouncilReport {
  concerns: Concern[];
  /** Questions it wants put to the user; the sitting asks them with `ask_user`. */
  questions: string[];
  recommendations: string[];
  /** What it didn't check (a cap, a turn limit, out of its slice). Shown under "Why?". */
  notChecked: string[];
  bowOut?: string;
}

/** One question in an `ask_user` batch (spec §4.4). */
export interface CouncilQuestion {
  /** Must be a councillor on the roster: drives speaker, portrait and voice. */
  councillorId: string;
  /** The report it comes from (separate chambers); must be one of that councillor's reports. */
  reportId?: string;
  question: string;
  options: { id: string; label: string; tradeoff: string }[];
  recommendation?: { optionId: string; reason: string };
  allowFreeText: boolean;
}

/** The plan `propose_plan` submits (spec §4.5, #104): checked by core before the user sees it. */
export type PlanProposal = Plan;

/**
 * Normalized output of a sitting's lead session (round table, or the elder in separate chambers).
 * Core input only, like `AgentEvent`. Tool calls carry `toolUseId`: core answers each one with a
 * `completeSittingTool` or `answerSittingQuestions` effect, accepting or rejecting it.
 */
export type CouncilEvent =
  | { type: 'sessionStarted'; sessionId: string }
  | { type: 'reportFiled'; toolUseId: string; councillorId: string; report: CouncilReport }
  | { type: 'questionsAsked'; toolUseId: string; questions: CouncilQuestion[] }
  | { type: 'planProposed'; toolUseId: string; plan: PlanProposal }
  /**
   * A councillor (or the elder) speaking to the user outside a question, e.g. answering "Why?" (§4.4).
   * `questionId` ties it to the question it explains; other councillors chiming in say so too.
   */
  | { type: 'said'; councillorId: string; text: string; questionId?: string }
  /** Running total for the sitting, never a delta. */
  | { type: 'usage'; totalCost: MicroUsd }
  /** The session cannot continue. */
  | { type: 'error'; message: string };

export type SittingStatus =
  /** Convened; the session is starting. */
  | 'convening'
  | 'deliberating'
  /** A plan is waiting for Approve, Change or Dismiss. */
  | 'awaitingApproval'
  | 'approved'
  | 'dismissed'
  | 'failed';

/** The sitting as front ends see it (spec §4.3–4.6): who is at the table and what they've said. */
export interface SittingView {
  id: string;
  task: string;
  mode: SittingMode;
  status: SittingStatus;
  /** The sitting's effort; in separate chambers each councillor also has its own. */
  effort: Effort;
  roster: { councillorId: string; effort: Effort; reported: boolean }[];
  reports: { id: string; councillorId: string; revision: number; report: CouncilReport }[];
  /** The batch waiting for the user, if any; answered with `answerCouncil`. */
  questions: {
    batchId: string;
    items: (CouncilQuestion & { id: string })[];
  } | null;
  /** What was said outside reports and questions, oldest first: "Why?" and its answers (§4.4). */
  dialogue: DialogueLine[];
  /** Every version proposed, oldest first; the last one is current. */
  plans: { version: number; plan: PlanProposal; outcome: PlanOutcome }[];
  /** Number of change requests so far. */
  revision: number;
  /** A councillor reporting again after a change request (spec §4.6). */
  reconsultations: { councillorId: string; revision: number; reportId: string }[];
  gold: Reading<MicroUsd>;
  error: string | null;
}

/** One line of the sitting's dialogue. `speaker` is a councillor on the roster, the elder, or `you`. */
export interface DialogueLine {
  id: string;
  speaker: string;
  text: string;
  questionId?: string;
}

export type PlanOutcome =
  | { kind: 'proposed' }
  | { kind: 'approved' }
  | { kind: 'changeRequested'; text: string }
  | { kind: 'dismissed' };

/** Something the user did that a sitting's lead session must hear about (spec §4.4–4.6). */
export type SittingMessage =
  | { kind: 'changeRequested'; version: number; text: string }
  | { kind: 'councillorAdded'; councillorId: string; effort: Effort }
  /** "Why?" (§4.4): the councillor who asked `question` explains; `text` is the user's follow-up. */
  | { kind: 'why'; questionId: string; councillorId: string; question: string; text?: string };
