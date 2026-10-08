import { isAbsolute, relative } from 'node:path';
import type {
  AvailableCommand,
  PromptResponse,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
  ToolKind,
} from '@agentclientprotocol/sdk';
import type { AgentEvent } from '@ibitsa/protocol';
import type { TestDetector } from '@ibitsa/runtime';
import { GoldMeter } from './gold';
import type { Activity, UpdateMapperInit } from './update-mapper.types';

const DETAIL_MAX = 120;

/** Stop reasons that end a turn early with something the user should see (§11.5). */
const STOP_ERRORS: Record<string, string> = {
  max_tokens: 'The agent reached its output limit and stopped.',
  max_turn_requests: 'The agent reached its limit of requests in one turn and stopped.',
  refusal: 'The agent refused to continue.',
};

/**
 * ACP session updates → normalized `AgentEvent`s (spec §5.4, §7.3, §11.5; checked against
 * @agentclientprotocol/sdk 1.7.0). Pure apart from the little state the mapping needs.
 */
export class UpdateMapper {
  private readonly cwd: string;
  private readonly tests: TestDetector;
  private readonly gold: GoldMeter;
  /** The agent's message so far, sent once it ends: a new message id, a tool, or the turn's end. */
  private text = '';
  private messageId: string | null = null;
  /** Tool calls started and not yet finished, by id. */
  private readonly running = new Set<string>();
  private commands: AvailableCommand[] = [];
  private contextUsed: number | undefined;
  /** A Rest asked for by the user; any other compaction is the agent's own. */
  private compactRequested = false;

  constructor({ cwd, tests, prices }: UpdateMapperInit) {
    this.cwd = cwd;
    this.tests = tests;
    this.gold = new GoldMeter(prices);
  }

  /** The `/` commands the agent last listed (`available_commands_update`). */
  get availableCommands(): readonly AvailableCommand[] {
    return this.commands;
  }

  /** The user asked for a Rest: the compaction that follows is manual. */
  compacting(): void {
    this.compactRequested = true;
  }

  update(u: SessionUpdate): AgentEvent[] {
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        if (u.content.type !== 'text') return [];
        const id = u.messageId ?? null;
        const events =
          id !== null && this.messageId !== null && id !== this.messageId ? this.flush() : [];
        if (id !== null) this.messageId = id;
        this.text += u.content.text;
        return events;
      }
      case 'tool_call':
        return [...this.flush(), ...this.toolCall(u)];
      case 'tool_call_update':
        return this.toolCallUpdate(u);
      case 'available_commands_update':
        this.commands = u.availableCommands;
        return [];
      case 'usage_update': {
        this.contextUsed = u.used;
        return [
          {
            type: 'usage',
            contextUsed: u.used,
            contextMax: u.size,
            ...(this.gold.reported(u.cost) ?? {}),
          },
        ];
      }
      case 'compaction_update':
        return this.compaction(u.status);
      default:
        return [];
    }
  }

  /** The prompt finished: the rest of the message, the turn's estimated gold, then how it ended. */
  endTurn({ response, queued }: { response: PromptResponse; queued: number }): AgentEvent[] {
    const events: AgentEvent[] = [...this.flush(), ...this.finishRunning()];
    const estimate = this.gold.turn(response.usage);
    if (estimate) events.push({ type: 'usage', ...estimate });
    const problem = STOP_ERRORS[response.stopReason];
    events.push(
      problem ? { type: 'error', message: problem } : { type: 'turnEnded', queuedTurns: queued },
    );
    return events;
  }

  /** The turn failed outright: what was said, and the tools it left running. */
  abandon(): AgentEvent[] {
    return [...this.flush(), ...this.finishRunning()];
  }

  /** Sends the message gathered so far, if any. */
  flush(): AgentEvent[] {
    const text = this.text.trim();
    this.text = '';
    this.messageId = null;
    return text ? [{ type: 'message', text }] : [];
  }

  private toolCall(call: ToolCall): AgentEvent[] {
    if (this.running.has(call.toolCallId)) return this.toolCallUpdate(call);
    this.running.add(call.toolCallId);
    const started: AgentEvent = {
      type: 'activityStarted',
      toolUseId: call.toolCallId,
      ...this.activity(call),
    };
    return [started, ...this.finished(call)];
  }

  private toolCallUpdate(update: ToolCallUpdate): AgentEvent[] {
    if (update.status !== 'completed' && update.status !== 'failed') return [];
    // A tool reported only once it finished still shows as an activity.
    if (!this.running.has(update.toolCallId)) {
      return this.toolCall({
        toolCallId: update.toolCallId,
        title: update.title ?? '',
        kind: update.kind ?? 'other',
        status: update.status,
        ...(update.locations ? { locations: update.locations } : {}),
        rawInput: update.rawInput,
      });
    }
    return this.finished(update);
  }

  private finished(update: ToolCallUpdate): AgentEvent[] {
    if (update.status !== 'completed' && update.status !== 'failed') return [];
    this.running.delete(update.toolCallId);
    return [
      {
        type: 'activityFinished',
        toolUseId: update.toolCallId,
        outcome: update.status === 'failed' ? 'failed' : 'ok',
      },
    ];
  }

  /** Tools still running when a turn ends were stopped, which is not a failure. */
  private finishRunning(): AgentEvent[] {
    const events: AgentEvent[] = [...this.running].map((toolUseId) => ({
      type: 'activityFinished',
      toolUseId,
      outcome: 'ok',
    }));
    this.running.clear();
    return events;
  }

  private compaction(status: string): AgentEvent[] {
    if (status === 'in_progress') return [{ type: 'resting' }];
    const trigger = this.compactRequested ? 'manual' : 'auto';
    this.compactRequested = false;
    // A failed or cancelled compaction ends the rest without freeing context.
    return [{ type: 'compacted', trigger, preTokens: this.contextUsed ?? 0 }];
  }

  /** Tool call → activity kind and a short display detail (spec §5.4). Never the raw input. */
  private activity(call: ToolCall): Activity {
    const kind = call.kind ?? 'other';
    if (kind === 'execute') {
      const command = commandOf(call.rawInput) ?? call.title;
      return withDetail({ kind: this.tests.isTest(command) ? 'test' : 'run', text: command });
    }
    const where = call.locations?.[0]?.path;
    // An agent may send a kind newer than this SDK knows.
    const mapped = (KIND as Partial<Record<string, Activity['kind']>>)[kind] ?? 'other';
    return withDetail({ kind: mapped, text: where ? this.path(where) : call.title });
  }

  private path(path: string): string {
    if (!isAbsolute(path)) return path;
    const inside = relative(this.cwd, path);
    if (inside.startsWith('..') || isAbsolute(inside)) return path;
    return (inside || '.').split('\\').join('/');
  }
}

const KIND: Record<ToolKind, Activity['kind']> = {
  read: 'read',
  edit: 'edit',
  delete: 'edit',
  move: 'edit',
  search: 'search',
  // Like the Claude adapter's WebFetch: looking something up.
  fetch: 'search',
  think: 'think',
  execute: 'run',
  switch_mode: 'other',
  other: 'other',
};

/** The shell command in a tool's raw input, under the names agents use for it. */
function commandOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const r = input as Record<string, unknown>;
  for (const key of ['command', 'cmd']) {
    const value = r[key];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.every((part) => typeof part === 'string'))
      return value.join(' ');
  }
  return undefined;
}

function withDetail({ kind, text }: { kind: Activity['kind']; text: string }): Activity {
  const line = text.split('\n')[0]?.trim() ?? '';
  if (!line) return { kind };
  return { kind, detail: line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line };
}
