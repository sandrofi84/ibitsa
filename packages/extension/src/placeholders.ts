import type { AgentAdapter, AgentSession } from '@ibitsa/runtime';

// Stand-in until the Claude adapter (#33) exists. It fails loudly, so a quest started now shows an
// error item instead of hanging.

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
