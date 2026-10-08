import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCP_PROTOCOL_VERSION, runMcpBridge, UNREACHABLE } from './mcp-bridge';
import { ToolBridge } from './tool-bridge';
import type { ToolSet } from './tool-bridge.types';

const until = (check: () => void) => vi.waitFor(check, { timeout: 10_000, interval: 10 });
const bridges: ToolBridge[] = [];
const inputs: PassThrough[] = [];
afterEach(() => {
  for (const i of inputs.splice(0)) i.end();
  for (const b of bridges.splice(0)) b.close();
});

const TOOL = {
  name: 'submit_task',
  description: 'Submit.',
  inputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
};

/** The bridge process in-process: an agent's MCP client on one side, a real ToolBridge on the other. */
async function connected({
  call,
  env,
}: {
  call?: ToolSet['call'];
  env?: Record<string, string>;
} = {}) {
  const bridge = new ToolBridge({ script: 'mcp-bridge.cjs' });
  bridges.push(bridge);
  const calls: unknown[] = [];
  const open = await bridge.open({
    tools: [TOOL],
    call:
      call ??
      (async (c) => {
        calls.push(c);
        return { text: `done: ${JSON.stringify(c.arguments)}` };
      }),
  });
  const input = new PassThrough();
  inputs.push(input);
  const output = new PassThrough();
  const replies: Record<string, unknown>[] = [];
  createInterface({ input: output }).on('line', (line) => replies.push(JSON.parse(line)));
  const exit = runMcpBridge({
    input,
    output,
    env: env ?? Object.fromEntries(open.server.env.map((e) => [e.name, e.value])),
  });
  const send = (message: Record<string, unknown>) =>
    input.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const reply = async (id: number) => {
    await until(() => expect(replies.find((r) => r.id === id)).toBeDefined());
    return replies.find((r) => r.id === id);
  };
  return { open, input, send, reply, replies, exit, calls, bridge };
}

describe('runMcpBridge: MCP over stdio (#197)', () => {
  it('answers initialize with the revision asked for, or its own', async () => {
    const { send, reply } = await connected();
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    expect(await reply(1)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'ibitsa', version: '1.0.0' },
      },
    });
    send({ id: 2, method: 'initialize' });
    expect((await reply(2))?.result).toMatchObject({ protocolVersion: MCP_PROTOCOL_VERSION });
  });

  it("lists the session's tools and carries a call to the runtime and back", async () => {
    const { send, reply, calls } = await connected();
    send({ id: 1, method: 'tools/list' });
    expect((await reply(1))?.result).toEqual({ tools: [TOOL] });
    send({
      id: 2,
      method: 'tools/call',
      params: { name: 'submit_task', arguments: { summary: 'x' } },
    });
    expect((await reply(2))?.result).toEqual({
      content: [{ type: 'text', text: 'done: {"summary":"x"}' }],
      isError: false,
    });
    // No arguments at all reach the runtime as an empty object.
    send({ id: 3, method: 'tools/call', params: { name: 'submit_task' } });
    expect((await reply(3))?.result).toMatchObject({ content: [{ text: 'done: {}' }] });
    expect(calls).toEqual([
      { name: 'submit_task', arguments: { summary: 'x' } },
      { name: 'submit_task', arguments: {} },
    ]);
  });

  it('holds a call made before the runtime has accepted the bridge, rather than lose it', async () => {
    // Straight away: the socket hasn't connected, let alone said hello.
    const { send, reply, calls } = await connected();
    send({
      id: 1,
      method: 'tools/call',
      params: { name: 'submit_task', arguments: { summary: 'y' } },
    });
    expect((await reply(1))?.result).toMatchObject({ isError: false });
    expect(calls).toHaveLength(1);
  });

  it('marks failed calls as errors, including a handler that throws', async () => {
    const { send, reply } = await connected({
      call: async ({ name }) => {
        if (name === 'boom') throw new Error('it broke');
        if (name === 'odd') throw 'not an error';
        return { text: 'Not submitted: no.', isError: true };
      },
    });
    send({ id: 1, method: 'tools/call', params: { name: 'submit_task' } });
    expect((await reply(1))?.result).toEqual({
      content: [{ type: 'text', text: 'Not submitted: no.' }],
      isError: true,
    });
    send({ id: 2, method: 'tools/call', params: { name: 'boom' } });
    expect((await reply(2))?.result).toEqual({
      content: [{ type: 'text', text: 'it broke' }],
      isError: true,
    });
    send({ id: 3, method: 'tools/call', params: { name: 'odd' } });
    expect((await reply(3))?.result).toMatchObject({ content: [{ text: 'not an error' }] });
  });

  it('answers ping, refuses unknown methods and bad calls, and skips notifications and junk', async () => {
    const { send, reply, input, replies } = await connected();
    send({ method: 'notifications/initialized' });
    input.write('not json\n');
    input.write('[1, 2]\n');
    send({ id: 1, method: 'ping' });
    expect((await reply(1))?.result).toEqual({});
    send({ id: 2, method: 'resources/list' });
    expect((await reply(2))?.error).toEqual({
      code: -32601,
      message: 'Method not found: resources/list',
    });
    send({ id: 3, method: 'tools/call', params: { arguments: {} } });
    expect((await reply(3))?.error).toMatchObject({ code: -32602 });
    // Only the three requests were answered.
    expect(replies.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('ends cleanly when the agent closes its stdin', async () => {
    const { input, exit } = await connected();
    input.end();
    expect(await exit).toBe(0);
  });

  it('fails a waiting call and ends when the runtime goes away', async () => {
    let hold: (() => void) | null = null;
    const { send, reply, exit, open } = await connected({
      call: () =>
        new Promise((resolve) => {
          hold = () => resolve({ text: 'too late' });
        }),
    });
    send({ id: 1, method: 'tools/list' });
    await reply(1);
    send({ id: 2, method: 'tools/call', params: { name: 'submit_task' } });
    await until(() => expect(hold).not.toBeNull());
    open.close();
    expect((await reply(2))?.result).toEqual({
      content: [{ type: 'text', text: UNREACHABLE }],
      isError: true,
    });
    expect(await exit).toBe(1);
    (hold as (() => void) | null)?.();
    // Calls after that fail at once.
    send({ id: 3, method: 'tools/call', params: { name: 'submit_task' } });
    expect((await reply(3))?.result).toMatchObject({ isError: true });
  });

  it('gets no tools with a token the runtime doesn’t know', async () => {
    const bridge = new ToolBridge({ script: 'mcp-bridge.cjs' });
    bridges.push(bridge);
    const open = await bridge.open({ tools: [TOOL], call: async () => ({ text: '' }) });
    const env = Object.fromEntries(open.server.env.map((e) => [e.name, e.value]));
    const { send, reply, exit } = await connected({
      env: { ...env, IBITSA_BRIDGE_TOKEN: 'guessed' },
    });
    expect(await exit).toBe(1);
    send({ id: 1, method: 'tools/list' });
    expect((await reply(1))?.result).toEqual({ tools: [] });
  });

  it('does nothing when started without a runtime to reach', async () => {
    const output = new PassThrough();
    const written: string[] = [];
    output.on('data', (chunk) => written.push(String(chunk)));
    expect(await runMcpBridge({ input: new PassThrough(), output, env: {} })).toBe(2);
    expect(written).toEqual([]);
  });
});
