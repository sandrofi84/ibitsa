import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { LessonsEvent } from '@ibitsa/protocol';
import { z } from 'zod';
import { loadSdk } from './claude-session';
import { FINISH_MS } from './elder-session';
import type { ToolReply } from './elder-session.types';
import type { LessonsSessionInit } from './lessons-session.types';

export const LESSONS_TOOL = 'mcp__ibitsa__submit_lessons';
/** It reads only what it's given: a turn to think, one to file, one to recover from a rejection. */
const MAX_TURNS = 4;
const MOST_LESSONS = 6;

/** Appended to Claude Code's system prompt; the same for every campaign, so it caches (spec §10). */
export const LESSONS_INSTRUCTIONS = `You are the elder of Ibitsa's council. A campaign has ended, and you are given what happened in its reviews: how many rounds each task took, what blocked it, reviews that failed, findings dropped after a dispute, and pull request comments that reopened work.

Write a few lessons for the next campaign in this repository: what to plan, check or brief differently. Each lesson is one or two plain sentences, specific to what happened, never generic advice. Skip anything that went smoothly.

Call submit_lessons once with between 1 and ${MOST_LESSONS} lessons. Use no other tools.`;

const LESSONS_SHAPE = {
  lessons: z.array(z.string()).describe(`1 to ${MOST_LESSONS} lessons, one or two sentences each.`),
};

/**
 * The elder's lessons at a campaign's end (spec §4.9, #167): a short session on a cheap model with a
 * small cap and no tools but `submit_lessons`, from the reviews' material. Once the lessons are filed
 * the session finishes its last turn, so its cost still arrives, then ends on its own.
 */
export class LessonsSession {
  private readonly init: LessonsSessionInit;
  private query: Query | null = null;
  private closed = false;
  private filed = false;
  private failed = false;

  constructor(init: LessonsSessionInit) {
    this.init = init;
    void this.run();
  }

  close(): void {
    this.closed = true;
    if (!this.filed) {
      this.query?.close();
      return;
    }
    const query = this.query;
    setTimeout(() => query?.close(), FINISH_MS).unref?.();
  }

  /** The submit_lessons handler: empty or too many lessons go back to be fixed. */
  private submit(input: { lessons: string[] }): ToolReply {
    const lessons = input.lessons.map((l) => l.trim()).filter((l) => l !== '');
    if (lessons.length === 0 || lessons.length > MOST_LESSONS) {
      return {
        content: [{ type: 'text', text: `Give between 1 and ${MOST_LESSONS} lessons.` }],
        isError: true,
      };
    }
    this.filed = true;
    this.emit({ type: 'lessonsSubmitted', lessons });
    return { content: [{ type: 'text', text: 'Lessons filed. You are done.' }] };
  }

  private async run(): Promise<void> {
    try {
      const sdk = await (this.init.adapter.loadSdk ?? loadSdk)();
      const ibitsa = sdk.createSdkMcpServer({
        name: 'ibitsa',
        version: '1.0.0',
        tools: [
          sdk.tool(
            'submit_lessons',
            'File the lessons from this campaign. Call it once.',
            LESSONS_SHAPE,
            async (input) => this.submit(input),
            { alwaysLoad: true },
          ),
        ],
      });
      const { title, material } = this.init.start;
      const query = sdk.query({
        prompt: `The campaign "${title}" has ended. What happened in its reviews:\n\n${material}`,
        options: this.options(ibitsa),
      });
      this.query = query;
      if (this.closed) query.close();
      for await (const message of query) this.message(message);
      if (!this.filed && !this.closed && !this.failed) {
        this.emit({ type: 'error', message: 'The elder finished without filing lessons.' });
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

  private options(ibitsa: NonNullable<Options['mcpServers']>[string]): Options {
    const { adapter, start } = this.init;
    const claudeCodePath = adapter.claudeCodePath?.()?.trim();
    return {
      cwd: start.cwd,
      model: start.model,
      env: adapter.env(),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: LESSONS_INSTRUCTIONS },
      tools: [],
      mcpServers: { ibitsa },
      allowedTools: [LESSONS_TOOL],
      canUseTool: async () => ({ behavior: 'deny', message: 'Only submit_lessons is allowed.' }),
      maxTurns: MAX_TURNS,
      maxBudgetUsd: start.maxBudgetMicroUsd / 1_000_000,
      ...(claudeCodePath ? { pathToClaudeCodeExecutable: claudeCodePath } : {}),
    };
  }

  private message(m: SDKMessage): void {
    if (m.type === 'system' && m.subtype === 'init') {
      this.emit({ type: 'sessionStarted', sessionId: m.session_id });
      return;
    }
    if (m.type !== 'result') return;
    this.emit({ type: 'usage', totalCost: Math.round(m.total_cost_usd * 1_000_000) });
    // A success without lessons is reported when the stream ends.
    if (this.filed || this.closed || m.subtype === 'success') return;
    this.emit({
      type: 'error',
      message:
        m.subtype === 'error_max_budget_usd'
          ? 'The elder ran out of gold before filing lessons.'
          : `The lessons stopped: ${m.subtype.replaceAll('_', ' ')}.`,
    });
  }

  private emit(event: LessonsEvent): void {
    if (event.type === 'error') {
      if (this.failed) return;
      this.failed = true;
    }
    this.init.onEvent(event);
  }
}
