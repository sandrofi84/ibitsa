import {
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ElicitationFormMode,
  type InitializeResponse,
  type LoadSessionRequest,
  methods,
  type PermissionOption,
  type RequestPermissionOutcome,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import type { AgentEvent } from '@ibitsa/protocol';
import { type AgentSession, TestDetector } from '@ibitsa/runtime';
import type { AcpSessionInit, PendingPermission, PendingQuestion } from './acp-session.types';
import { AgentConnection } from './agent-connection';
import { formContent, formQuestions } from './elicitation';
import {
  HERO_TOOL_INSTRUCTIONS,
  SESSION_CLOSED,
  SUBMIT_NEEDS_SUMMARY,
  SUBMIT_TASK,
  submitResult,
  submittedSummary,
} from './hero-tools.ts';
import type { OpenTools, ToolResult } from './tool-bridge.types.ts';
import { UpdateMapper } from './update-mapper';

export const CANT_RESUME = 'This agent can’t resume a session. Start the task over.';

/**
 * One hero's session on an ACP agent (spec §11.5): its own agent process in the worktree. ACP has no
 * input during a turn, so `next` messages wait here for the turn to end, and `now` cancels the turn
 * first. Permissions and form questions wait for "Needs you".
 */
export class AcpSession implements AgentSession {
  private readonly onEvent: (event: AgentEvent) => void;
  private readonly connection: AgentConnection;
  private readonly mapper: UpdateMapper;
  private readonly held: string[] = [];
  /** A `now` message, sent as soon as the cancelled turn ends. */
  private urgent: string | null = null;
  private readonly permissions = new Map<string, PendingPermission>();
  private readonly questions = new Map<string, PendingQuestion>();
  /** `submit_task` calls waiting for the submit check's verdict, by tool use id. */
  private readonly submits = new Map<string, (result: ToolResult) => void>();
  /** The session's tools on the bridge, while it lasts. */
  private tools: OpenTools | null = null;
  private requests = 0;
  private sessionId: string | null = null;
  /** Busy from the start until the session is ready, then while a prompt runs. */
  private busy = true;
  /** `session/load` replays the old conversation as updates, which already happened. */
  private loading = false;
  private closed = false;
  /** Set by an error, cleared when the next turn starts. */
  private failed = false;
  private agentCapabilities: InitializeResponse['agentCapabilities'] = {};

  constructor(init: AcpSessionInit) {
    this.onEvent = init.onEvent;
    this.mapper = new UpdateMapper({
      cwd: init.cwd,
      tests: new TestDetector(init.cwd),
      ...(init.options.agent.prices ? { prices: init.options.agent.prices } : {}),
    });
    this.connection = new AgentConnection({
      options: init.options,
      cwd: init.cwd,
      handlers: {
        permission: (request) => this.permission(request),
        elicit: (request) => this.elicit(request),
        update: (notification) => this.update(notification),
        exited: (message) => this.fail(message),
      },
    });
    void this.run(init);
  }

  /** Rest needs the agent to list a `compact` command (§11.5); without one the Rest button is off. */
  get canCompact(): boolean {
    return this.mapper.availableCommands.some((c) => c.name === 'compact');
  }

  send(text: string, priority: 'now' | 'next'): void {
    if (this.closed) return;
    if (!this.busy) {
      void this.turn(text);
      return;
    }
    if (priority === 'next') {
      this.held.push(text);
      return;
    }
    this.urgent = this.urgent === null ? text : `${this.urgent}\n\n${text}`;
    this.cancel();
  }

  /** A full stop: cancel the turn and drop everything still held. */
  interrupt(): void {
    this.held.length = 0;
    this.urgent = null;
    if (this.busy) this.cancel();
  }

  /** Rest through the agent's own `/compact`, when it has one; otherwise nothing happens. */
  compact(): void {
    if (!this.canCompact) return;
    this.mapper.compacting();
    this.send('/compact', 'next');
  }

  respondToPermission({
    requestId,
    decision,
    note,
    always,
  }: {
    requestId: string;
    decision: 'allow' | 'deny';
    note?: string;
    always?: boolean;
  }): void {
    const pending = this.permissions.get(requestId);
    if (!pending) return;
    this.permissions.delete(requestId);
    pending.resolve({
      outcome: chooseOption({ options: pending.options, answer: { decision, always: !!always } }),
    });
    // ACP has no note on a denial; the agent hears it as the next message.
    if (decision === 'deny' && note?.trim())
      this.send(`The user declined that: ${note.trim()}`, 'next');
  }

  answerQuestion(requestId: string, answers: Record<string, string | string[]>): void {
    const pending = this.questions.get(requestId);
    if (!pending) return;
    this.questions.delete(requestId);
    pending.resolve({
      action: 'accept',
      content: formContent({ fields: pending.fields, answers }),
    });
  }

  /** The submit check's verdict (§5.4), returned to the hero as `submit_task`'s result. */
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
    resolve?.(submitResult(reason === undefined ? { accepted } : { accepted, reason }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dropPending();
    for (const resolve of this.submits.values()) resolve({ text: SESSION_CLOSED, isError: true });
    this.submits.clear();
    this.tools?.close();
    if (this.sessionId && this.agentCapabilities?.sessionCapabilities?.close) {
      void this.connection.agent
        .request(methods.agent.session.close, { sessionId: this.sessionId })
        .catch(() => {})
        .finally(() => this.connection.close());
      return;
    }
    this.connection.close();
  }

  // ---------- internals ----------

  private async run(init: AcpSessionInit): Promise<void> {
    try {
      const initialized = await this.connection.initialize();
      this.agentCapabilities = initialized.agentCapabilities ?? {};
      const tools = await this.openTools(init);
      if (this.closed) return;
      const mcpServers = [
        ...(tools ? [tools.server] : []),
        ...(init.options.mcpServers?.({ heroId: init.heroId, cwd: init.cwd }) ?? []),
      ];
      const agent = this.connection.agent;
      let configOptions: SessionConfigOption[] | null | undefined;
      if (init.resume !== undefined) {
        const request: LoadSessionRequest = { sessionId: init.resume, cwd: init.cwd, mcpServers };
        if (this.agentCapabilities.sessionCapabilities?.resume) {
          configOptions = (await agent.request(methods.agent.session.resume, request))
            .configOptions;
        } else if (this.agentCapabilities.loadSession) {
          this.loading = true;
          configOptions = (await agent.request(methods.agent.session.load, request)).configOptions;
          this.loading = false;
        } else {
          this.fail(CANT_RESUME);
          return;
        }
        this.sessionId = init.resume;
      } else {
        const created = await agent.request(methods.agent.session.new, {
          cwd: init.cwd,
          mcpServers,
        });
        this.sessionId = created.sessionId;
        configOptions = created.configOptions;
      }
      if (this.closed) return;
      this.emit({ type: 'sessionStarted', sessionId: this.sessionId });
      await this.chooseModel({ model: init.model, configOptions });
      if (init.prompt !== undefined) {
        // A new hero with the bridge learns how to submit before its task; a resumed one knew.
        const preface = tools && init.resume === undefined ? HERO_TOOL_INSTRUCTIONS : undefined;
        void this.turn(init.prompt, { first: true, ...(preface ? { preface } : {}) });
        return;
      }
      this.busy = false;
      // A resumed hero with nothing to do waits for orders.
      this.emit({ type: 'turnEnded', queuedTurns: 0 });
      this.releaseHeld();
    } catch (error) {
      this.loading = false;
      this.fail(await this.connection.failure(error));
    }
  }

  /** The class's model, when the agent offers it as a `model` option; else the agent's default. */
  private async chooseModel({
    model,
    configOptions,
  }: {
    model: string | undefined;
    configOptions: SessionConfigOption[] | null | undefined;
  }): Promise<void> {
    if (!model || !this.sessionId) return;
    const option = configOptions?.find((o) => o.category === 'model' && o.type === 'select');
    if (option?.type !== 'select' || option.currentValue === model) return;
    const values = option.options.flatMap((o) => ('group' in o ? o.options : [o]));
    if (!values.some((v) => v.value === model)) return;
    await this.connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId: this.sessionId,
      configId: option.id,
      value: model,
    });
  }

  /** The bridge's tools for this session (#197), when the adapter has a bridge. */
  private async openTools(init: AcpSessionInit): Promise<OpenTools | null> {
    if (!init.options.tools) return null;
    const tools = await init.options.tools.open({
      tools: [SUBMIT_TASK],
      call: (call) => this.toolCall(call),
    });
    if (this.closed) tools.close();
    else this.tools = tools;
    return tools;
  }

  /** A call through the bridge: `submit_task` waits for the submit check, like the Claude adapter's. */
  private toolCall({
    name,
    arguments: args,
  }: {
    name: string;
    arguments: unknown;
  }): Promise<ToolResult> {
    if (name !== SUBMIT_TASK.name)
      return Promise.resolve({ text: `Unknown tool: ${name}`, isError: true });
    if (this.closed) return Promise.resolve({ text: SESSION_CLOSED, isError: true });
    const summary = submittedSummary(args);
    if (summary === null) return Promise.resolve({ text: SUBMIT_NEEDS_SUMMARY, isError: true });
    const toolUseId = `submit-${++this.requests}`;
    return new Promise((resolve) => {
      this.submits.set(toolUseId, resolve);
      this.emit({ type: 'taskSubmitted', toolUseId, summary });
    });
  }

  /** One prompt turn; when it ends, the next held message starts the following one. */
  private async turn(
    text: string,
    { first = false, preface }: { first?: boolean; preface?: string } = {},
  ): Promise<void> {
    if (!this.sessionId) return;
    this.busy = true;
    this.failed = false;
    if (!first) this.emit({ type: 'turnStarted' });
    try {
      const response = await this.connection.agent.request(methods.agent.session.prompt, {
        sessionId: this.sessionId,
        prompt: [
          ...(preface ? [{ type: 'text' as const, text: preface }] : []),
          { type: 'text', text },
        ],
      });
      if (this.closed) return;
      this.dropPending();
      const next = this.urgent ?? this.held[0];
      const events = this.mapper.endTurn({ response, queued: next === undefined ? 0 : 1 });
      this.busy = false;
      for (const event of events) this.emit(event);
      if (events.some((e) => e.type === 'error')) return;
      this.releaseHeld();
    } catch (error) {
      if (this.closed) return;
      for (const event of this.mapper.abandon()) this.emit(event);
      this.fail(await this.connection.failure(error));
    }
  }

  private releaseHeld(): void {
    const next = this.urgent ?? this.held.shift();
    this.urgent = null;
    if (next !== undefined) void this.turn(next);
  }

  private cancel(): void {
    this.dropPending();
    if (this.sessionId) {
      void this.connection.agent
        .notify(methods.agent.session.cancel, { sessionId: this.sessionId })
        .catch(() => {});
    }
  }

  /** ACP: a cancelled turn answers its waiting requests as cancelled. */
  private dropPending(): void {
    for (const pending of this.permissions.values())
      pending.resolve({ outcome: { outcome: 'cancelled' } });
    this.permissions.clear();
    for (const pending of this.questions.values()) pending.resolve({ action: 'cancel' });
    this.questions.clear();
  }

  private permission({
    params,
    signal,
  }: {
    params: RequestPermissionRequest;
    signal: AbortSignal;
  }): Promise<RequestPermissionResponse> {
    const requestId = `${params.toolCall.toolCallId}:${++this.requests}`;
    const call = params.toolCall;
    return new Promise((resolve) => {
      this.permissions.set(requestId, { options: params.options, resolve });
      signal.addEventListener(
        'abort',
        () => {
          if (this.permissions.delete(requestId)) resolve({ outcome: { outcome: 'cancelled' } });
        },
        { once: true },
      );
      this.emit({
        type: 'permission',
        requestId,
        tool: call.name ?? call.title ?? call.kind ?? 'tool',
        input: call.rawInput ?? {},
        ...(call.title ? { title: call.title } : {}),
      });
    });
  }

  private elicit({
    params,
    signal,
  }: {
    params: CreateElicitationRequest;
    signal: AbortSignal;
  }): Promise<CreateElicitationResponse> {
    const form =
      params.mode === 'form' && 'requestedSchema' in params
        ? formQuestions({
            message: params.message,
            schema: (params as ElicitationFormMode).requestedSchema,
          })
        : null;
    if (!form) return Promise.resolve({ action: 'decline' });
    const requestId = `q${++this.requests}`;
    return new Promise((resolve) => {
      this.questions.set(requestId, { fields: form.fields, resolve });
      signal.addEventListener(
        'abort',
        () => {
          if (this.questions.delete(requestId)) resolve({ action: 'cancel' });
        },
        { once: true },
      );
      this.emit({ type: 'question', requestId, questions: form.questions });
    });
  }

  private update(notification: SessionNotification): void {
    if (this.sessionId !== null && notification.sessionId !== this.sessionId) return;
    const u = notification.update;
    // A loaded session's history already happened; only what it can do now still matters.
    if (this.loading && u.sessionUpdate !== 'available_commands_update') return;
    for (const event of this.mapper.update(u)) this.emit(event);
  }

  /** One error per failure: a dying agent fails its request and exits, which is one problem. */
  private fail(message: string): void {
    if (this.closed || this.failed) return;
    this.failed = true;
    this.busy = false;
    this.dropPending();
    this.emit({ type: 'error', message });
  }

  private emit(event: AgentEvent): void {
    if (!this.closed) this.onEvent(event);
  }
}

/** The agent's option for the user's answer; a plain allow never widens to "always". */
function chooseOption({
  options,
  answer,
}: {
  options: readonly PermissionOption[];
  answer: { decision: 'allow' | 'deny'; always: boolean };
}): RequestPermissionOutcome {
  const kinds =
    answer.decision === 'deny'
      ? ['reject_once', 'reject_always']
      : answer.always
        ? ['allow_always', 'allow_once']
        : ['allow_once'];
  for (const kind of kinds) {
    const option = options.find((o) => o.kind === kind);
    if (option) return { outcome: 'selected', optionId: option.optionId };
  }
  return { outcome: 'cancelled' };
}
