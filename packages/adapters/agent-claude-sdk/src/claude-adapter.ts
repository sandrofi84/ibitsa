import type { AgentEvent } from '@ibitsa/protocol';
import type { AgentAdapter, AgentSession, SessionResume, SessionStart } from '@ibitsa/runtime';
import type { ClaudeAdapterOptions } from './claude-adapter.types';
import { ClaudeSession } from './claude-session';

/** The native Claude Agent SDK adapter (spec §11.3, §11.4). */
export class ClaudeAdapter implements AgentAdapter {
  readonly capabilities = { budgetCap: true, costReported: true };
  private readonly options: ClaudeAdapterOptions;

  constructor(options: ClaudeAdapterOptions) {
    this.options = options;
  }

  startSession(start: SessionStart, onEvent: (event: AgentEvent) => void): AgentSession {
    return new ClaudeSession({
      adapter: this.options,
      cwd: start.cwd,
      classId: start.classId,
      session: { sessionId: start.sessionId },
      prompt: start.prompt,
      ...(start.maxBudgetMicroUsd === undefined
        ? {}
        : { maxBudgetMicroUsd: start.maxBudgetMicroUsd }),
      allowRules: start.allowRules ?? [],
      onEvent,
    });
  }

  resumeSession(resume: SessionResume, onEvent: (event: AgentEvent) => void): AgentSession {
    return new ClaudeSession({
      adapter: this.options,
      cwd: resume.cwd,
      classId: resume.classId,
      session: { resume: resume.sessionId },
      ...(resume.prompt === undefined ? {} : { prompt: resume.prompt }),
      ...(resume.maxBudgetMicroUsd === undefined
        ? {}
        : { maxBudgetMicroUsd: resume.maxBudgetMicroUsd }),
      allowRules: resume.allowRules ?? [],
      onEvent,
    });
  }
}
