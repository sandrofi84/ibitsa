import * as v from 'valibot';

// ACP agents in settings (spec §11.5, #198): `ibitsa.agents`. They come from user files, so they're
// checked before use.

const text = v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(200));
const price = v.pipe(v.number(), v.minValue(0), v.maxValue(10_000));

/** An agent id: a lowercase word. `claude` is the native adapter's and can't be configured here. */
export const AgentIdSchema = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,30}$/));

/** One agent as `ibitsa.agents` sets it; missing fields keep the preset's. */
export const AgentSettingSchema = v.strictObject({
  name: v.optional(v.pipe(text, v.maxLength(60))),
  /** The program to run, found on PATH or given as a path. */
  command: v.optional(text),
  args: v.optional(v.pipe(v.array(text), v.maxLength(20))),
  /** Added to the hero's environment. */
  env: v.optional(v.record(v.pipe(v.string(), v.regex(/^[A-Za-z_][A-Za-z0-9_]*$/)), v.string())),
  /** For the sandbox (#200): folders the agent keeps its state in, written besides the worktree. */
  stateFolders: v.optional(v.pipe(v.array(text), v.maxLength(20))),
  /** For the sandbox (#200): domains the agent reaches without asking, e.g. its API. */
  domains: v.optional(v.pipe(v.array(text), v.maxLength(50))),
  /** USD per million tokens, for estimated gold when the agent reports tokens but no cost. */
  prices: v.optional(v.strictObject({ inputPerMillion: price, outputPerMillion: price })),
});
export type AgentSetting = v.InferOutput<typeof AgentSettingSchema>;

/** Agent id → its settings. */
export const AgentsSettingSchema = v.record(AgentIdSchema, AgentSettingSchema);
