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
import { boundaryOf, heroSettings, offeredRules, sandboxProblem } from './hero-settings';
import type { HeroSettings } from './hero-settings.types';
import { InputQueue } from './input-queue';
import { Worktree } from './worktree';

/**
 * The built-in classes → SDK model aliases (spec §5.2, §14.1), for when the runtime names no model;
 * unknown classes get Sonnet. The classes in play come from `ibitsa.classes` (#182).
 */
export const CLASS_MODELS: Record<string, string> = {
  paladin: 'fable',
  barbarian: 'opus',
  ranger: 'sonnet',
  rogue: 'haiku',
};

export const SUBMIT_TOOL = 'mcp__ibitsa__submit_task';
/** The hero says review findings contradict each other or a decision (M5); the user decides. */
export const DISPUTE_TOOL = 'mcp__ibitsa__dispute_finding';

/** Appended to Claude Code's own system prompt; identical for every hero so it caches (spec §10). */
export const HERO_INSTRUCTIONS = `You are working on one task in your own git worktree.
Commit your work with clear messages as you go.
When the task is complete and every change is committed, call the submit_task tool with a short summary of what you did. If the submission is rejected, fix what it says and submit again.
If you need a decision from the user, ask with the AskUserQuestion tool instead of guessing.
Run tests so their exit status reaches you: don't pipe a test command through tail, head or grep; use the runner's own options to shorten its output.`;

// The SDK ships ESM only and finds its native binary next to its own module, so it stays external to
// the extension bundle and is loaded with import() (spec §13).
export const loadSdk = async (): Promise<SdkModule> => {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return { query: sdk.query, createSdkMcpServer: sdk.createSdkMcpServer, tool: sdk.tool };
};

/** Ibitsa's built-in actions and any other local plugins, as SDK plugin configs (#84). */
export function plugins(dirs: string[]): { plugins?: { type: 'local'; path: string }[] } {
  return dirs.length > 0 ? { plugins: dirs.map((path) => ({ type: 'local' as const, path })) } : {};
}

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
  private mapper: EventMapper | null = null;
  private closed = false;
  private busy = false;
  private submitToolUseId: string | null = null;
  private readonly worktree: Worktree;

  constructor(init: ClaudeSessionInit) {
    this.onEvent = init.onEvent;
    this.worktree = new Worktree({
      dir: init.cwd,
      ...(init.adapter.platform ? { platform: init.adapter.platform } : {}),
    });
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

  /**
   * Rest (#82): Claude Code's own `/compact`, queued like any message. The SDK reports it as
   * `status: 'compacting'` then a `compact_boundary`, which map to `resting` and `compacted`.
   */
  compact(): void {
    this.input.push(userMessage({ text: '/compact', priority: 'next' }));
  }

  /** A full stop: interrupt and drop everything still held. */
  interrupt(): void {
    this.held.length = 0;
    this.mapper?.interrupted();
    void this.query?.interrupt();
  }

  respondToPermission({
    requestId,
    decision,
    note,
    always,
  }: { requestId: string } & PermissionAnswer): void {
    const pending = this.pending.get(requestId);
    if (pending?.kind !== 'permission') return;
    this.pending.delete(requestId);
    pending.resolve({
      decision,
      ...(note === undefined ? {} : { note }),
      ...(always ? { always } : {}),
    });
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
      const platform = init.adapter.platform ?? process.platform;
      const problem = sandboxProblem({
        platform,
        ...(init.adapter.hasCommand ? { hasCommand: init.adapter.hasCommand } : {}),
      });
      if (problem) {
        this.emit({ type: 'error', message: problem });
        return;
      }
      const sdk = await (init.adapter.loadSdk ?? loadSdk)();
      const tests = new TestDetector(init.cwd);
      const mapper = new EventMapper({ worktree: this.worktree, tests });
      this.mapper = mapper;
      const hero = heroSettings({
        platform,
        settingSources: init.adapter.settingSources?.() ?? ['project'],
        testScripts: tests.scriptNames,
        allowRules: init.allowRules,
      });
      const query = sdk.query({
        prompt: this.input,
        options: this.options({ init, sdk, mapper, hero }),
      });
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
    hero,
  }: {
    init: ClaudeSessionInit;
    sdk: SdkModule;
    mapper: EventMapper;
    hero: HeroSettings;
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
          // Loaded up front: otherwise the hero must find it with ToolSearch first (seen in the live check).
          { alwaysLoad: true },
        ),
        sdk.tool(
          'dispute_finding',
          'Tell the user that review findings contradict each other or a recorded decision. Give the review ids from the findings you were sent, and why.',
          {
            reviewIds: z
              .array(z.string())
              .describe('The reviews whose findings you dispute, e.g. r12.'),
            reason: z.string().describe('Why they contradict each other or a decision.'),
          },
          async ({ reviewIds, reason }) => this.disputeFinding({ reviewIds, reason }),
          { alwaysLoad: true },
        ),
      ],
    });
    const claudeCodePath = init.adapter.claudeCodePath?.()?.trim();
    return {
      cwd: init.cwd,
      model: init.model ?? CLASS_MODELS[init.classId] ?? 'sonnet',
      ...init.session,
      env: init.adapter.env(),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: HERO_INSTRUCTIONS },
      ...hero,
      mcpServers: { ibitsa },
      ...plugins(init.adapter.pluginDirs?.() ?? []),
      allowedTools: [SUBMIT_TOOL, DISPUTE_TOOL, ...(hero.allowedTools ?? [])],
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
    { signal, toolUseID, title, description, suggestions, blockedPath },
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
      const request = { toolName, input, worktree: this.worktree, suggestions, blockedPath };
      const offered = offeredRules(request);
      const boundary = boundaryOf(request);
      this.pending.set(toolUseID, {
        kind: 'permission',
        input,
        updates: offered.updates,
        resolve: ({ decision, note, always }) => {
          signal.removeEventListener('abort', onAbort);
          resolve(
            decision !== 'allow'
              ? { behavior: 'deny', message: note?.trim() || 'The user declined this.' }
              : always && offered.updates.length > 0
                ? { behavior: 'allow', updatedInput: input, updatedPermissions: offered.updates }
                : { behavior: 'allow', updatedInput: input },
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
        ...(offered.rules.length > 0 ? { alwaysAllow: offered.rules } : {}),
        ...(boundary ? { boundary } : {}),
      });
    });

  /** The dispute_finding handler (M5): it goes to the user; the hero hears back as a message. */
  private disputeFinding({ reviewIds, reason }: { reviewIds: string[]; reason: string }) {
    this.emit({ type: 'findingDisputed', reviewIds, reason });
    return {
      content: [
        {
          type: 'text' as const,
          text: 'The user will decide and you will hear back as a message. Work on any other findings meanwhile, or end your turn.',
        },
      ],
    };
  }

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

export function userMessage({
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
