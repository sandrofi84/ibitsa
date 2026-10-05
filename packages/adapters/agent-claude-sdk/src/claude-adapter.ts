import type {
  HookCallback,
  Options,
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  PreToolUseHookInput,
  Query,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@ibitsa/protocol';
import type { AgentAdapter, AgentSession, SessionResume, SessionStart } from '@ibitsa/runtime';
import { TestDetector } from './activity';
import type { ClaudeAdapterOptions, QueryFunction } from './claude-adapter.types';
import { EventMapper } from './event-mapper';
import { InputQueue } from './input-queue';

/** Hero classes → SDK model aliases (spec §5.2, §14.1). Unknown classes get Sonnet. */
export const CLASS_MODELS: Record<string, string> = {
  paladin: 'fable',
  barbarian: 'opus',
  ranger: 'sonnet',
  rogue: 'haiku',
};

// The SDK ships ESM only and finds its native binary next to its own module, so it stays external to
// the extension bundle and is loaded with import() (spec §13).
const loadSdkQuery = async (): Promise<QueryFunction> =>
  (await import('@anthropic-ai/claude-agent-sdk')).query;

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
      onEvent,
    });
  }
}

/** One long-lived `query()` in streaming input mode, which every control method requires (#2). */
class ClaudeSession implements AgentSession {
  private readonly input = new InputQueue<SDKUserMessage>();
  private readonly onEvent: (event: AgentEvent) => void;
  private query: Query | null = null;
  private closed = false;

  constructor({
    adapter,
    cwd,
    classId,
    session,
    prompt,
    maxBudgetMicroUsd,
    onEvent,
  }: {
    adapter: ClaudeAdapterOptions;
    cwd: string;
    classId: string;
    session: { sessionId: string } | { resume: string };
    prompt?: string;
    maxBudgetMicroUsd?: number;
    onEvent: (event: AgentEvent) => void;
  }) {
    this.onEvent = onEvent;
    const mapper = new EventMapper({ cwd, tests: new TestDetector(cwd) });
    const hook =
      <I>(map: (input: I) => AgentEvent[]): HookCallback =>
      async (input) => {
        for (const event of map(input as I)) this.emit(event);
        return {};
      };
    const claudeCodePath = adapter.claudeCodePath?.()?.trim();
    const options: Options = {
      cwd,
      model: CLASS_MODELS[classId] ?? 'sonnet',
      ...session,
      env: adapter.env(),
      // Explicit: omitting it can start a session in auto mode (#11). #35 applies the full hero settings.
      permissionMode: 'default',
      settingSources: ['project'],
      hooks: {
        PreToolUse: [{ hooks: [hook<PreToolUseHookInput>((i) => mapper.preToolUse(i))] }],
        PostToolUse: [{ hooks: [hook<PostToolUseHookInput>((i) => mapper.postToolUse(i))] }],
        PostToolUseFailure: [
          { hooks: [hook<PostToolUseFailureHookInput>((i) => mapper.postToolUseFailure(i))] },
        ],
      },
      ...(maxBudgetMicroUsd === undefined ? {} : { maxBudgetUsd: maxBudgetMicroUsd / 1_000_000 }),
      ...(claudeCodePath ? { pathToClaudeCodeExecutable: claudeCodePath } : {}),
    };
    if (prompt) this.input.push(userMessage({ text: prompt, priority: 'next' }));
    void this.run({ load: adapter.loadQuery ?? loadSdkQuery, options, mapper });
  }

  send(text: string, priority: 'now' | 'next'): void {
    this.input.push(userMessage({ text, priority }));
  }

  interrupt(): void {
    void this.query?.interrupt();
  }

  // Permissions, questions and the submit_task tool arrive with #34.
  respondToPermission(): void {}
  answerQuestion(): void {}
  completeSubmit(): void {}

  close(): void {
    this.closed = true;
    this.input.end();
    this.query?.close();
  }

  private async run({
    load,
    options,
    mapper,
  }: {
    load: () => Promise<QueryFunction>;
    options: Options;
    mapper: EventMapper;
  }): Promise<void> {
    try {
      const query = (await load())({ prompt: this.input, options });
      this.query = query;
      if (this.closed) query.close();
      for await (const message of query) {
        for (const event of mapper.message(message)) this.emit(event);
      }
    } catch (error) {
      if (!this.closed)
        this.emit({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
    }
  }

  private emit(event: AgentEvent): void {
    if (!this.closed) this.onEvent(event);
  }
}

function userMessage({
  text,
  priority,
}: {
  text: string;
  priority: 'now' | 'next';
}): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    priority,
  };
}
