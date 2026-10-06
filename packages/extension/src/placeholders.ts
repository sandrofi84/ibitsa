import type { AgentAdapter, AgentSession } from '@ibitsa/runtime';

// Stands in for the Claude adapter when there are no credentials, so a quest shows a clear error item
// instead of the SDK falling back to a claude.ai login (spec §11.6). #37's first-run card replaces it.

const noSession: AgentSession = {
  send: () => {},
  interrupt: () => {},
  compact: () => {},
  respondToPermission: () => {},
  answerQuestion: () => {},
  completeSubmit: () => {},
  close: () => {},
};

export const NO_CREDENTIALS_MESSAGE =
  'No API key yet. Run "Ibitsa: Set API Key" (or set ANTHROPIC_API_KEY), then resume.';

export const missingCredentialsAdapter: AgentAdapter = {
  capabilities: { budgetCap: true, costReported: true },
  startSession: (_start, onEvent) => {
    queueMicrotask(() => onEvent({ type: 'error', message: NO_CREDENTIALS_MESSAGE }));
    return noSession;
  },
  resumeSession: (_resume, onEvent) => {
    queueMicrotask(() => onEvent({ type: 'error', message: NO_CREDENTIALS_MESSAGE }));
    return noSession;
  },
};
