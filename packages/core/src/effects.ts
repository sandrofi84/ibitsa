/** Requests core makes of the runtime. Core never performs them itself (ADR 0001). */
export type Effect =
  | { type: 'createWorktree'; islandId: string; branch: string; baseRef: string }
  | { type: 'startSession'; heroId: string; cwd: string; classId: string; prompt: string }
  | { type: 'sendMessage'; heroId: string; text: string; priority: 'now' | 'next' }
  /** Interrupt the turn and drop the adapter's queued messages. */
  | { type: 'interrupt'; heroId: string }
  | {
      type: 'answerPermission';
      heroId: string;
      requestId: string;
      decision: 'allow' | 'deny';
      note?: string;
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
  | { type: 'setTimer'; timerId: string; at: number }
  | { type: 'cancelTimer'; timerId: string };
