import type {
  CanUseTool,
  HookCallback,
  Options,
  PermissionResult,
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  PreToolUseHookInput,
  Query,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, AskUserQuestion } from '@ibitsa/protocol';
import type { AgentSession } from '@ibitsa/runtime';
import { z } from 'zod';
import { TestDetector } from './activity';
import type { SdkModule } from './claude-adapter.types';
import type { ClaudeSessionInit, Pending, PermissionAnswer } from './claude-session.types';
import { EventMapper } from './event-mapper';
import { InputQueue } from './input-queue';

/** Hero classes → SDK model aliases (spec §5.2, §14.1). Unknown classes get Sonnet. */
export const CLASS_MODELS: Record<string, string> = {
  paladin: 'fable',
  barbarian: 'opus',
  ranger: 'sonnet',
  rogue: 'haiku',
};

export const SUBMIT_TOOL = 'mcp__ibitsa__submit_task';

/** Appended to Claude Code's own system prompt; identical for every hero so it caches (spec §10). */
export const HERO_INSTRUCTIONS = `You are working on one task in your own git worktree.
Commit your work with clear messages as you go.
When the task is complete and every change is committed, call the submit_task tool with a short summary of what you did. If the submission is rejected, fix what it says and submit again.
If you need a decision from the user, ask with the AskUserQuestion tool instead of guessing.`;

// The SDK ships ESM only and finds its native binary next to its own module, so it stays external to
// the extension bundle and is loaded with import() (spec §13).
const loadSdk = async (): Promise<SdkModule> => {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return { query: sdk.query, createSdkMcpServer: sdk.createSdkMcpServer, tool: sdk.tool };
};

/**
 * One hero's session: a long-lived `query()` in streaming input mode, which every control method
 * requires (#2). Permissions and questions wait for "Needs you"; `next` messages are held here so a
 * stop can drop them (the SDK's own queue survives an interrupt).
 */
export class ClaudeSession implements AgentSession {
  private readonly input = new InputQueue<SDKUserMessage>();
  private readonly onEvent: (event: AgentEvent) => void;
  private readonly pending = new Map<string, Pending>();
  private readonly submits = new Map<
    string,
    (result: { accepted: boolean; reason?: string }) => void
  >();
  private readonly held: string[] = [];
  private query: Query | null = null;
  private closed = false;
  private busy = false;
  private submitToolUseId: string | null = null;

  constructor(init: ClaudeSessionInit) {
    this.onEvent = init.onEvent;
    void this.run(init);
  }

  send(text: string, priority: 'now' | 'next'): void {
    if (priority === 'now') {
      // With a human origin, 'now' moves background-able work aside instead of hard-interrupting (#2).
      this.input.push(userMessage({ text, priority: 'now', human: true }));
      return;
    }
    this.held.push(text);
    if (!this.busy) this.release();
  }

  /** A full stop: interrupt and drop everything still held. */
  interrupt(): void {
    this.held.length = 0;
    void this.query?.interrupt();
  }

  respondToPermission({
    requestId,
    decision,
    note,
  }: { requestId: string } & PermissionAnswer): void {
    const pending = this.pending.get(requestId);
    if (pending?.kind !== 'permission') return;
    this.pending.delete(requestId);
    pending.resolve(note === undefined ? { decision } : { decision, note });
  }

  answerQuestion(requestId: string, answers: Record<string, string | string[]>): void {
    const pending = this.pending.get(requestId);
    if (pending?.kind !== 'question') return;
    this.pending.delete(requestId);
    // The SDK takes one label per question; several picks are joined.
    pending.resolve(
      Object.fromEntries(
        Object.entries(answers).map(([q, a]) => [q, Array.isArray(a) ? a.join(', ') : a]),
      ),
    );
  }

  completeSubmit({
    toolUseId,
    accepted,
    reason,
  }: {
    toolUseId: string;
    accepted: boolean;
    reason?: string;
  }): void {
    const resolve = this.submits.get(toolUseId);
    this.submits.delete(toolUseId);
    resolve?.(reason === undefined ? { accepted } : { accepted, reason });
  }

  close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      if (pending.kind === 'permission')
        pending.resolve({ decision: 'deny', note: 'The session closed.' });
      else pending.resolve({});
    }
    this.pending.clear();
    this.input.end();
    this.query?.close();
  }

  // ---------- internals ----------

  private async run(init: ClaudeSessionInit): Promise<void> {
    try {
      const sdk = await (init.adapter.loadSdk ?? loadSdk)();
      const mapper = new EventMapper({ cwd: init.cwd, tests: new TestDetector(init.cwd) });
      const query = sdk.query({ prompt: this.input, options: this.options({ init, sdk, mapper }) });
      this.query = query;
      if (this.closed) query.close();
      if (init.prompt) this.input.push(userMessage({ text: init.prompt, priority: 'next' }));
      for await (const message of query) {
        for (const event of mapper.message(message)) this.emit(event);
      }
    } catch (error) {
      if (!this.closed) {
        this.emit({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private options({
    init,
    sdk,
    mapper,
  }: {
    init: ClaudeSessionInit;
    sdk: SdkModule;
    mapper: EventMapper;
  }): Options {
    const hook =
      <I>(map: (input: I) => AgentEvent[]): HookCallback =>
      async (input) => {
        for (const event of map(input as I)) this.emit(event);
        return {};
      };
    const ibitsa = sdk.createSdkMcpServer({
      name: 'ibitsa',
      version: '1.0.0',
      tools: [
        sdk.tool(
          'submit_task',
          'Submit your finished, committed work for this task, with a short summary of what you did.',
          { summary: z.string().describe('What you did, in a few sentences.') },
          async ({ summary }) => this.submitTask(summary),
        ),
      ],
    });
    const claudeCodePath = init.adapter.claudeCodePath?.()?.trim();
    return {
      cwd: init.cwd,
      model: CLASS_MODELS[init.classId] ?? 'sonnet',
      ...init.session,
      env: init.adapter.env(),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: HERO_INSTRUCTIONS },
      // Explicit: omitting it can start a session in auto mode (#11). #35 applies the full hero settings.
      permissionMode: 'default',
      settingSources: ['project'],
      mcpServers: { ibitsa },
      allowedTools: [SUBMIT_TOOL],
      canUseTool: this.canUseTool,
      hooks: {
        PreToolUse: [
          {
            hooks: [
              hook<PreToolUseHookInput>((i) => {
                if (i.tool_name === SUBMIT_TOOL) this.submitToolUseId = i.tool_use_id;
                return mapper.preToolUse(i);
              }),
            ],
          },
        ],
        PostToolUse: [{ hooks: [hook<PostToolUseHookInput>((i) => mapper.postToolUse(i))] }],
        PostToolUseFailure: [
          { hooks: [hook<PostToolUseFailureHookInput>((i) => mapper.postToolUseFailure(i))] },
        ],
      },
      ...(init.maxBudgetMicroUsd === undefined
        ? {}
        : { maxBudgetUsd: init.maxBudgetMicroUsd / 1_000_000 }),
      ...(claudeCodePath ? { pathToClaudeCodeExecutable: claudeCodePath } : {}),
    };
  }

  /** Every call not already approved by the SDK's rules waits here for the user (spec §6.4). */
  // biome-ignore lint/complexity/useMaxParams: the SDK's canUseTool signature is (toolName, input, options).
  private readonly canUseTool: CanUseTool = (
    toolName,
    input,
    { signal, toolUseID, title, description },
  ) =>
    new Promise<PermissionResult>((resolve) => {
      const onAbort = () => {
        this.pending.delete(toolUseID);
        resolve({ behavior: 'deny', message: 'The request was cancelled.' });
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (toolName === 'AskUserQuestion') {
        this.pending.set(toolUseID, {
          kind: 'question',
          input,
          resolve: (answers) => {
            signal.removeEventListener('abort', onAbort);
            resolve({ behavior: 'allow', updatedInput: { ...input, answers } });
          },
        });
        this.emit({ type: 'question', requestId: toolUseID, questions: toQuestions(input) });
        return;
      }
      this.pending.set(toolUseID, {
        kind: 'permission',
        input,
        resolve: ({ decision, note }) => {
          signal.removeEventListener('abort', onAbort);
          resolve(
            decision === 'allow'
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: note?.trim() || 'The user declined this.' },
          );
        },
      });
      this.emit({
        type: 'permission',
        requestId: toolUseID,
        tool: toolName,
        input,
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
      });
    });

  /** The submit_task handler: core runs the submit check, then this returns its verdict to the hero. */
  private submitTask(summary: string) {
    const toolUseId = this.submitToolUseId ?? `submit-${Date.now()}`;
    this.submitToolUseId = null;
    return new Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>(
      (resolve) => {
        this.submits.set(toolUseId, ({ accepted, reason }) =>
          resolve(
            accepted
              ? { content: [{ type: 'text', text: 'Submitted. Your work will be reviewed.' }] }
              : {
                  content: [
                    {
                      type: 'text',
                      text: `Not submitted: ${reason ?? 'the submit check failed.'}`,
                    },
                  ],
                  isError: true,
                },
          ),
        );
        this.emit({ type: 'taskSubmitted', toolUseId, summary });
      },
    );
  }

  /** Releases one held message: right away when idle, otherwise at the next safe point. */
  private release(): void {
    const text = this.held.shift();
    if (text !== undefined) this.input.push(userMessage({ text, priority: 'next' }));
  }

  private emit(event: AgentEvent): void {
    if (this.closed) return;
    if (event.type === 'sessionStarted' || event.type === 'turnStarted') this.busy = true;
    if (event.type === 'turnEnded' || event.type === 'budgetExhausted' || event.type === 'error')
      this.busy = false;
    this.onEvent(event);
    // Safe points for held messages: after a tool finishes, and when the turn ends.
    if (
      event.type === 'activityFinished' ||
      (event.type === 'turnEnded' && event.queuedTurns === 0)
    )
      this.release();
  }
}

function toQuestions(input: Record<string, unknown>): AskUserQuestion[] {
  const questions = Array.isArray(input.questions)
    ? (input.questions as Record<string, unknown>[])
    : [];
  return questions.map((q) => ({
    question: String(q.question ?? ''),
    header: String(q.header ?? ''),
    options: (Array.isArray(q.options) ? (q.options as Record<string, unknown>[]) : []).map(
      (o) => ({
        label: String(o.label ?? ''),
        description: String(o.description ?? ''),
        ...(typeof o.preview === 'string' ? { preview: o.preview } : {}),
      }),
    ),
    multiSelect: q.multiSelect === true,
  }));
}

function userMessage({
  text,
  priority,
  human = false,
}: {
  text: string;
  priority: 'now' | 'next';
  human?: boolean;
}): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    priority,
    ...(human ? { origin: { kind: 'human' } } : {}),
  };
}
