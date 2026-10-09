import * as v from 'valibot';
import { SubmitTaskInputSchema } from './hero-tools.schema.ts';
import type { BridgeTool } from './tool-bridge.schema.ts';
import type { ToolResult } from './tool-bridge.types.ts';

/** The hero's tool to hand in a finished task (§5.4), as the Claude adapter offers it. */
export const SUBMIT_TASK: BridgeTool = {
  name: 'submit_task',
  description:
    'Submit your finished, committed work for this task, with a short summary of what you did.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'What you did, in a few sentences.' },
    },
    required: ['summary'],
    additionalProperties: false,
  },
};

/**
 * Sent before a new hero's first message (§11.5): an ACP agent has no system prompt to append to, so
 * this is how it learns to hand in the task. The Claude adapter's own instructions say the same.
 */
export const HERO_TOOL_INSTRUCTIONS = `You are working on one task in your own git worktree.
Read the task first, and before you change any code: if it is ambiguous enough that reasonable readings would lead to different work, ask the user which they mean, listing the readings, and end your turn; their answer comes as the next message. Don't ask about details you can settle from the code, or that wouldn't change the outcome.
Commit your work with clear messages as you go.
When the task is complete and every change is committed, call the submit_task tool (from the ibitsa MCP server) with a short summary of what you did. If the submission is rejected, fix what it says and submit again.
Run tests so their exit status reaches you: don't pipe a test command through tail, head or grep; use the runner's own options to shorten its output.`;

export const SUBMIT_NEEDS_SUMMARY = 'Not submitted: submit_task needs a summary of what you did.';
export const SESSION_CLOSED = 'Not submitted: the session closed.';

/** The summary from `submit_task`'s arguments, or null when there is none to submit. */
export function submittedSummary(args: unknown): string | null {
  const parsed = v.safeParse(SubmitTaskInputSchema, args);
  return parsed.success ? parsed.output.summary : null;
}

/** The submit check's verdict as the hero reads it, in the Claude adapter's words. */
export function submitResult({
  accepted,
  reason,
}: {
  accepted: boolean;
  reason?: string;
}): ToolResult {
  return accepted
    ? { text: 'Submitted. Your work will be reviewed.' }
    : { text: `Not submitted: ${reason ?? 'the submit check failed.'}`, isError: true };
}
