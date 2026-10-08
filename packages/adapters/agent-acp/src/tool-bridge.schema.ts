import * as v from 'valibot';

// The tool bridge's local socket (spec §11.5, #197): one JSON message per line between the MCP
// bridge process an agent launched and the runtime. Both ends validate what they read: anything on
// this machine can try to connect.

/** A tool the bridge offers, as MCP lists it. */
export const BridgeToolSchema = v.strictObject({
  name: v.string(),
  description: v.string(),
  /** JSON Schema for the tool's arguments. */
  inputSchema: v.record(v.string(), v.unknown()),
});
export type BridgeTool = v.InferOutput<typeof BridgeToolSchema>;

/** Bridge → runtime: the first message proves which session the bridge belongs to. */
export const BridgeHelloSchema = v.strictObject({ type: v.literal('hello'), token: v.string() });

/** Bridge → runtime: the agent called a tool. */
export const BridgeCallSchema = v.strictObject({
  type: v.literal('call'),
  id: v.number(),
  name: v.string(),
  arguments: v.unknown(),
});
export type BridgeCall = v.InferOutput<typeof BridgeCallSchema>;

/** Runtime → bridge: the session's tools, the answer to `hello`. */
export const BridgeToolsSchema = v.strictObject({
  type: v.literal('tools'),
  tools: v.array(BridgeToolSchema),
});

/** Runtime → bridge: a tool call's result, as text the agent reads. */
export const BridgeResultSchema = v.strictObject({
  type: v.literal('result'),
  id: v.number(),
  text: v.string(),
  isError: v.boolean(),
});
export type BridgeResult = v.InferOutput<typeof BridgeResultSchema>;

/** What the runtime may send the bridge. */
export const RuntimeMessageSchema = v.variant('type', [BridgeToolsSchema, BridgeResultSchema]);
export type RuntimeMessage = v.InferOutput<typeof RuntimeMessageSchema>;

/** What a bridge may send the runtime. */
export const BridgeMessageSchema = v.variant('type', [BridgeHelloSchema, BridgeCallSchema]);
export type BridgeMessage = v.InferOutput<typeof BridgeMessageSchema>;

/** An MCP JSON-RPC message from the agent, as much as the bridge reads of it. */
export const McpMessageSchema = v.object({
  id: v.optional(v.union([v.string(), v.number()])),
  method: v.optional(v.string()),
  params: v.optional(v.record(v.string(), v.unknown())),
});
export type McpMessage = v.InferOutput<typeof McpMessageSchema>;

/** `tools/call`'s parameters. */
export const McpToolCallSchema = v.object({
  name: v.string(),
  arguments: v.optional(v.unknown()),
});
