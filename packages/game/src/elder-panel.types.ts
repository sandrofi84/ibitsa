import type { Plan } from '@ibitsa/protocol';

/** What the elder panel needs from the rest of the game. */
export interface ElderPanelOptions {
  /** Opens the New Quest form for a quick quest with this task (spec §4.1). */
  quickQuest: (task: string) => void;
  /** Opens the New Quest form to carry out the approved plan (spec §14.2). */
  startPlan: (plan: Plan) => void;
  /** Opens the convene form (spec §4.2). */
  convene: () => void;
}
