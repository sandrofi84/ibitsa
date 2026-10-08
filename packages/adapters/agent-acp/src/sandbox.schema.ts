import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import * as v from 'valibot';

/**
 * What a sandbox host runs (§11.5, #200), handed over in its environment: the agent's command in the
 * hero's worktree, the sandbox runtime's config for it, and the variables the agent must not inherit
 * from the host (the plan itself, and Electron's run-as-Node switch).
 */
export const SandboxPlanSchema = v.strictObject({
  command: v.string(),
  args: v.array(v.string()),
  cwd: v.string(),
  unset: v.array(v.string()),
  config: v.custom<SandboxRuntimeConfig>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
    'The sandbox config must be an object.',
  ),
});

export type SandboxPlan = v.InferOutput<typeof SandboxPlanSchema>;

/** Host → runtime, over the IPC channel: a domain outside the agent's list wants out. */
export const HostMessageSchema = v.strictObject({
  type: v.literal('ask'),
  id: v.number(),
  host: v.string(),
  port: v.nullable(v.number()),
});

export type HostMessage = v.InferOutput<typeof HostMessageSchema>;

/** Runtime → host: the user's answer to an ask. */
export const ParentMessageSchema = v.strictObject({
  type: v.literal('answer'),
  id: v.number(),
  allow: v.boolean(),
});

export type ParentMessage = v.InferOutput<typeof ParentMessageSchema>;
