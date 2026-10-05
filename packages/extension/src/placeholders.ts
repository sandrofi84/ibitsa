import type { GameMasterEvent } from '@ibitsa/core';
import type { AgentAdapter, AgentSession, GameMaster } from '@ibitsa/runtime';

// Stand-ins until the Claude adapter (#33) and the git game master (#32) exist. They fail loudly, so a
// quest started now shows an error item instead of hanging.

const noSession: AgentSession = {
  send: () => {},
  interrupt: () => {},
  respondToPermission: () => {},
  answerQuestion: () => {},
  completeSubmit: () => {},
  close: () => {},
};

export const unavailableAdapter: AgentAdapter = {
  capabilities: { budgetCap: true, costReported: true },
  startSession: (_start, onEvent) => {
    queueMicrotask(() =>
      onEvent({ type: 'error', message: "The Claude adapter isn't built yet (#33)." }),
    );
    return noSession;
  },
  resumeSession: (_resume, onEvent) => {
    queueMicrotask(() =>
      onEvent({ type: 'error', message: "The Claude adapter isn't built yet (#33)." }),
    );
    return noSession;
  },
};

export const unavailableGameMaster: GameMaster = {
  createWorktree: async ({ islandId }): Promise<GameMasterEvent> => ({
    type: 'worktreeFailed',
    islandId,
    message: "the git game master isn't built yet (#32)",
  }),
  checkSubmit: async ({ heroId, toolUseId }): Promise<GameMasterEvent> => ({
    type: 'submitChecked',
    heroId,
    toolUseId,
    ok: false,
    reason: "The git game master isn't built yet (#32).",
  }),
  observeDiff: async () => {
    throw new Error("the git game master isn't built yet (#32)");
  },
  removeWorktree: async () => ({ ok: false, reason: "The git game master isn't built yet (#32)." }),
};
