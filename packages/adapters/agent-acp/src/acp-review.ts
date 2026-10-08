import {
  methods,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionModeState,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import type { ReviewEvent, Verdict } from '@ibitsa/protocol';
import { REVIEW_INSTRUCTIONS, type ReviewSession, reviewBrief } from '@ibitsa/runtime';
import type { AcpReviewInit } from './acp-review.types';
import { AgentConnection } from './agent-connection';
import { GoldMeter } from './gold';
import { SUBMIT_VERDICT, VERDICT_TOOL_NOTE, verdictResult } from './review-tools.ts';
import type { OpenTools, ToolResult } from './tool-bridge.types.ts';

/** Enough to look around a diff, as for a Claude reviewer (§5.5); the cap usually ends it first. */
export const REVIEW_STEPS = 20;
/** A filed review may finish its last turn, so its cost still arrives, for this long. */
export const FINISH_MS = 5_000;
/** The tool kinds a reviewer may use when its agent asks (§5.5): reading, never changing. */
const READ_KINDS = ['read', 'search', 'think'];

export const NO_BRIDGE = 'This agent can’t file a verdict: there is no tool bridge.';
export const NO_VERDICT = 'The reviewer finished without a verdict.';
export const TOO_MANY_STEPS = 'The reviewer took too many steps without a verdict.';
export const OUT_OF_GOLD = 'The reviewer ran out of gold before its verdict.';

/**
 * One councillor's review of one task on an ACP agent (spec §5.5, §11.5, #201): its own agent process
 * in the worktree, in the agent's read-only mode when it has one, refusing anything but reads when the
 * agent asks. ACP has no system prompt, so the reviewers' instructions open the first message, before
 * the brief. It files `submit_verdict` through the tool bridge; core rules on it and the ruling is the
 * tool's result. Ending without an accepted verdict is an error, as for a Claude reviewer. Its gold is
 * the cost the agent reports in USD, else unknown: a review event carries no estimate.
 */
export class AcpReview implements ReviewSession {
  private readonly init: AcpReviewInit;
  private readonly connection: AgentConnection;
  private readonly gold: GoldMeter;
  /** `submit_verdict` calls waiting for core's ruling, by tool use id. */
  private readonly verdicts = new Map<string, (result: ToolResult) => void>();
  private tools: OpenTools | null = null;
  private sessionId: string | null = null;
  private calls = 0;
  private steps = 0;
  private filed = false;
  private failed = false;
  private closed = false;
  /** Settles when the prompt turn ends, however it ends. */
  private turnEnded: Promise<void> = Promise.resolve();

  constructor(init: AcpReviewInit) {
    this.init = init;
    this.gold = new GoldMeter(undefined);
    // Inside Ibitsa's sandbox (#200) the worktree is read-only for it, and with no network handler a
    // new domain is refused: a reviewer reads the code and the diff it was given, nothing more.
    this.connection = new AgentConnection({
      options: init.options,
      cwd: init.start.cwd,
      handlers: {
        permission: (request) => Promise.resolve(this.permission(request.params)),
        update: (notification) => this.update(notification),
        exited: (message) => this.fail(message),
      },
      readOnly: true,
    });
    void this.run();
  }

  completeTool({
    toolUseId,
    accepted,
    reason,
  }: {
    toolUseId: string;
    accepted: boolean;
    reason?: string;
  }): void {
    // Marked now: the runtime closes the review in the same step.
    if (accepted && this.verdicts.has(toolUseId)) this.filed = true;
    const resolve = this.verdicts.get(toolUseId);
    this.verdicts.delete(toolUseId);
    resolve?.(verdictResult(reason === undefined ? { accepted } : { accepted, reason }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.verdicts.values())
      resolve(verdictResult({ accepted: false, reason: 'The review has ended.' }));
    this.verdicts.clear();
    if (!this.filed) {
      this.end();
      return;
    }
    // A filed review finishes its last turn first, so the agent's last cost report still arrives.
    const timer = setTimeout(() => this.end(), FINISH_MS);
    void this.turnEnded.then(() => {
      clearTimeout(timer);
      this.end();
    });
  }

  // ---------- internals ----------

  private async run(): Promise<void> {
    const { start, options } = this.init;
    let ended: () => void = () => {};
    this.turnEnded = new Promise((resolve) => {
      ended = resolve;
    });
    try {
      if (!options.tools) {
        this.fail(NO_BRIDGE);
        this.end();
        return;
      }
      await this.connection.initialize();
      const tools = await options.tools.open({
        tools: [SUBMIT_VERDICT],
        call: (call) => this.toolCall(call),
      });
      if (this.closed) {
        tools.close();
        return;
      }
      this.tools = tools;
      const created = await this.connection.agent.request(methods.agent.session.new, {
        cwd: start.cwd,
        mcpServers: [
          tools.server,
          ...(options.mcpServers?.({ heroId: `review:${start.councillorId}`, cwd: start.cwd }) ??
            []),
        ],
      });
      if (this.closed) return;
      this.sessionId = created.sessionId;
      this.emit({ type: 'sessionStarted', sessionId: created.sessionId });
      await this.readOnly(created.modes);
      await this.connection.chooseModel({
        sessionId: created.sessionId,
        model: start.model,
        configOptions: created.configOptions,
      });
      await this.connection.agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [
          { type: 'text', text: `${REVIEW_INSTRUCTIONS}\n\n${VERDICT_TOOL_NOTE}` },
          { type: 'text', text: reviewBrief({ start, guidance: start.guidance ?? null }) },
        ],
      });
      // An early stop has said why already; any other end without a verdict fails here.
      if (!this.filed && !this.closed) this.fail(NO_VERDICT);
    } catch (error) {
      if (!this.filed) this.fail(await this.connection.failure(error));
    } finally {
      ended();
    }
  }

  /** The agent's own read-only mode, when it lists one (Codex's `read-only`). */
  private async readOnly(modes: SessionModeState | null | undefined): Promise<void> {
    const mode = modes?.availableModes.find((m) =>
      [m.id, m.name].some((n) => /read[-_ ]?only/i.test(n)),
    );
    if (!mode || !this.sessionId || modes?.currentModeId === mode.id) return;
    await this.connection.agent.request(methods.agent.session.setMode, {
      sessionId: this.sessionId,
      modeId: mode.id,
    });
  }

  /** `submit_verdict` waits for core's ruling, which becomes the tool's result. */
  private toolCall({
    name,
    arguments: args,
  }: {
    name: string;
    arguments: unknown;
  }): Promise<ToolResult> {
    if (name !== SUBMIT_VERDICT.name)
      return Promise.resolve({ text: `Unknown tool: ${name}`, isError: true });
    if (this.closed)
      return Promise.resolve(verdictResult({ accepted: false, reason: 'The review has ended.' }));
    const toolUseId = `verdict-${++this.calls}`;
    return new Promise((resolve) => {
      this.verdicts.set(toolUseId, resolve);
      // Core checks the verdict's shape (`checkVerdict`), as it does a Claude reviewer's.
      this.emit({
        type: 'verdictSubmitted',
        toolUseId,
        verdict: JSON.parse(JSON.stringify(args ?? {})) as Verdict,
      });
    });
  }

  /** A reviewer only reads: anything else the agent asks to do is refused. */
  private permission(params: RequestPermissionRequest): RequestPermissionResponse {
    const reads = READ_KINDS.includes(params.toolCall.kind ?? 'other');
    const kinds: PermissionOption['kind'][] = reads
      ? ['allow_once']
      : ['reject_once', 'reject_always'];
    const option = params.options.find((o) => kinds.includes(o.kind));
    return {
      outcome: option
        ? { outcome: 'selected', optionId: option.optionId }
        : { outcome: 'cancelled' },
    };
  }

  private update({ sessionId, update }: SessionNotification): void {
    if (sessionId !== this.sessionId || this.filed || this.closed) return;
    if (update.sessionUpdate === 'usage_update') {
      const cost = this.gold.reported(update.cost);
      if (!cost) return;
      this.emit({ type: 'usage', totalCost: cost.totalCost });
      if (cost.totalCost > this.init.start.maxBudgetMicroUsd) this.stop(OUT_OF_GOLD);
      return;
    }
    // A verdict waiting for core isn't a step: the reviewer is done looking.
    if (update.sessionUpdate === 'tool_call' && this.verdicts.size === 0) {
      if (++this.steps > REVIEW_STEPS) this.stop(TOO_MANY_STEPS);
    }
  }

  /** Ends the turn early: the review can't finish. */
  private stop(message: string): void {
    this.fail(message);
    if (this.sessionId)
      void this.connection.agent
        .notify(methods.agent.session.cancel, { sessionId: this.sessionId })
        .catch(() => {});
  }

  private end(): void {
    this.tools?.close();
    this.connection.close();
  }

  /** One error per review: a dying agent fails its request and exits, which is one problem. */
  private fail(message: string): void {
    if (this.closed || this.failed || this.filed) return;
    this.failed = true;
    this.emit({ type: 'error', message });
  }

  private emit(event: ReviewEvent): void {
    this.init.onEvent(event);
  }
}
