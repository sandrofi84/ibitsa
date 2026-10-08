import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import * as v from 'valibot';
import {
  type BridgeMessage,
  type BridgeTool,
  type McpMessage,
  McpMessageSchema,
  McpToolCallSchema,
  type RuntimeMessage,
  RuntimeMessageSchema,
} from './tool-bridge.schema.ts';
import type { McpBridgeIo, ToolResult } from './tool-bridge.types.ts';

/** The MCP revision the bridge answers with when the agent asks for none. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const UNREACHABLE = 'Ibitsa is not reachable, so the tool could not run.';

/**
 * The tool bridge's MCP server (spec §11.5, #197), in the process an ACP agent launches from
 * `session/new`: MCP over stdio on one side (`initialize`, `tools/list`, `tools/call`), the runtime's
 * socket on the other. It holds no tools of its own: the runtime says which tools the session has and
 * answers every call. Hand-written rather than the MCP SDK, which would bundle zod and a transport
 * layer for three methods. Resolves with the exit code once the agent or the runtime goes away.
 */
export function runMcpBridge(io: McpBridgeIo): Promise<number> {
  const socketPath = io.env.IBITSA_BRIDGE;
  const token = io.env.IBITSA_BRIDGE_TOKEN;
  // Started by hand, not by an agent: nothing to connect to (stdout belongs to MCP, so no message).
  if (!socketPath || !token) return Promise.resolve(2);
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    const calls = new Map<number, (result: ToolResult) => void>();
    let gotTools: (tools: BridgeTool[]) => void = () => {};
    const tools = new Promise<BridgeTool[]>((r) => {
      gotTools = r;
    });
    let nextCall = 0;
    let done = false;

    const reply = (message: Record<string, unknown>) =>
      io.output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    const finish = (code: number) => {
      if (done) return;
      done = true;
      gotTools([]);
      for (const answer of calls.values()) answer({ text: UNREACHABLE, isError: true });
      calls.clear();
      socket.destroy();
      resolve(code);
    };
    const toRuntime = (message: BridgeMessage) => {
      if (!done && socket.writable) socket.write(`${JSON.stringify(message)}\n`);
    };

    socket.on('connect', () => toRuntime({ type: 'hello', token }));
    socket.on('error', () => finish(1));
    socket.on('close', () => finish(1));
    createInterface({ input: socket }).on('line', (line) => {
      const message = runtimeMessage(line);
      if (message?.type === 'tools') gotTools(message.tools);
      else if (message?.type === 'result') {
        calls.get(message.id)?.({ text: message.text, isError: message.isError });
        calls.delete(message.id);
      }
    });

    // A call waits for the runtime to accept `hello`: sent sooner, it would arrive first and be refused.
    const call = async (request: { name: string; arguments: unknown }) => {
      await tools;
      return new Promise<ToolResult>((answer) => {
        if (done) return answer({ text: UNREACHABLE, isError: true });
        const id = ++nextCall;
        calls.set(id, answer);
        toRuntime({ type: 'call', id, name: request.name, arguments: request.arguments });
      });
    };

    const handle = async (message: McpMessage): Promise<void> => {
      const { id, method } = message;
      // Notifications (`notifications/initialized`, cancellations) need no answer.
      if (id === undefined || method === undefined) return;
      switch (method) {
        case 'initialize': {
          const asked = message.params?.protocolVersion;
          reply({
            id,
            result: {
              protocolVersion: typeof asked === 'string' ? asked : MCP_PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: 'ibitsa', version: '1.0.0' },
            },
          });
          return;
        }
        case 'ping':
          reply({ id, result: {} });
          return;
        case 'tools/list':
          reply({ id, result: { tools: await tools } });
          return;
        case 'tools/call': {
          const params = v.safeParse(McpToolCallSchema, message.params);
          if (!params.success) {
            reply({ id, error: { code: -32602, message: 'tools/call needs a tool name' } });
            return;
          }
          const result = await call({
            name: params.output.name,
            arguments: params.output.arguments ?? {},
          });
          reply({
            id,
            result: { content: [{ type: 'text', text: result.text }], isError: !!result.isError },
          });
          return;
        }
        default:
          reply({ id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    };

    const input = createInterface({ input: io.input });
    input.on('line', (line) => {
      const message = mcpMessage(line);
      if (message) void handle(message);
    });
    // The agent closed our stdin: the session is over.
    input.on('close', () => finish(0));
  });
}

function runtimeMessage(line: string): RuntimeMessage | null {
  try {
    const parsed = v.safeParse(RuntimeMessageSchema, JSON.parse(line));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}

function mcpMessage(line: string): McpMessage | null {
  try {
    const parsed = v.safeParse(McpMessageSchema, JSON.parse(line));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}
