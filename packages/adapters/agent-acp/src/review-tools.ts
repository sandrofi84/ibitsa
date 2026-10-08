import type { BridgeTool } from './tool-bridge.schema.ts';
import type { ToolResult } from './tool-bridge.types.ts';

/**
 * A reviewer's tool to file its verdict (§5.5, #201): the Claude adapter's `submit_verdict`, with the
 * same arguments. Core checks what it gets (`checkVerdict`), so the schema only guides the agent.
 */
export const SUBMIT_VERDICT: BridgeTool = {
  name: 'submit_verdict',
  description: 'File your verdict on this task. Call it once, when your review is done.',
  inputSchema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['pass', 'changes'] },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['blocking', 'suggestion'] },
            criterion: {
              type: 'string',
              description: 'The acceptance criterion it fails, word for word.',
            },
            kind: {
              type: 'string',
              enum: ['bug', 'security', 'breaks'],
              description: 'Why it blocks when no criterion covers it.',
            },
            file: { type: 'string' },
            line: { type: 'integer' },
            message: { type: 'string', description: 'What is wrong and what to fix.' },
            revisit: {
              type: 'string',
              description: 'A decision id (D3) to reconsider; suggestions only.',
            },
          },
          required: ['severity', 'message'],
          additionalProperties: false,
        },
      },
    },
    required: ['verdict', 'findings'],
    additionalProperties: false,
  },
};

/** Where an ACP reviewer finds the tool: its instructions name only `submit_verdict`. */
export const VERDICT_TOOL_NOTE =
  'submit_verdict is a tool of the ibitsa MCP server. You may read files and search; nothing else.';

/** Core's ruling on a verdict as the reviewer reads it, in the Claude adapter's words. */
export function verdictResult({
  accepted,
  reason,
}: {
  accepted: boolean;
  reason?: string;
}): ToolResult {
  return accepted
    ? { text: 'Verdict filed. Your review is done.' }
    : { text: `Not accepted: ${reason ?? 'no reason given'}`, isError: true };
}
