// A scripted ACP agent for the adapter's tests (spec §11.5): the SDK's agent side over stdio, spending
// nothing. A prompt that is a JSON array runs those steps; any other prompt is echoed back.
//
// Environment:
//   FAKE_ACP_LOG       file to append each request to, one JSON line per request
//   FAKE_ACP_CAPS      agentCapabilities to advertise (JSON)
//   FAKE_ACP_CONFIG    configOptions for session/new (JSON)
//   FAKE_ACP_COMMANDS  availableCommands to list after session/new (JSON)
//   FAKE_ACP_AUTH      "required": session/new fails with auth_required
//
// Steps: { update } sends a session update; { permission } and { elicit } ask the client and say what
// came back; { sleep } waits that many ms; { waitCancel } ends the turn when it is cancelled; { stop, usage } ends it; { fail } fails
// the prompt; { exit } ends the process; { mcp: { tool, arguments } } starts the session's `ibitsa` MCP
// server, as a real agent would, calls that tool and says what it listed and what came back.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable, Writable } from 'node:stream';
import { agent, methods, ndJsonStream, RequestError } from '@agentclientprotocol/sdk';

const env = (name, fallback) => (process.env[name] ? JSON.parse(process.env[name]) : fallback);
const SESSION = 'fake-session-1';
let cancelled = () => {};
/** The MCP servers the client listed for the session. */
let mcpServers = [];

/** An MCP client for one call: initialize, list the tools, call one, then stop the server. */
async function callMcpTool({ tool, arguments: args }) {
  const server = mcpServers.find((s) => s.name === 'ibitsa');
  if (!server) return { error: 'no ibitsa server' };
  const child = spawn(server.command, server.args, {
    env: { ...process.env, ...Object.fromEntries(server.env.map((e) => [e.name, e.value])) },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const answers = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    answers.get(message.id)?.(message);
  });
  let id = 0;
  const request = (method, params) =>
    new Promise((resolve) => {
      answers.set(++id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const listed = await request('tools/list', {});
  const called = await request('tools/call', { name: tool, arguments: args });
  child.stdin.end();
  return { tools: listed.result.tools.map((t) => t.name), result: called.result };
}

function log(method, params) {
  if (process.env.FAKE_ACP_LOG) {
    appendFileSync(process.env.FAKE_ACP_LOG, `${JSON.stringify({ method, params })}\n`);
  }
}

const say = ({ client, sessionId }, text) =>
  client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  });

async function run({ client, sessionId, steps }) {
  for (const step of steps) {
    if (step.update) {
      await client.notify(methods.client.session.update, { sessionId, update: step.update });
    } else if (step.permission) {
      const answer = await client.request(methods.client.session.requestPermission, {
        sessionId,
        ...step.permission,
      });
      await say({ client, sessionId }, `permission: ${JSON.stringify(answer.outcome)}`);
    } else if (step.elicit) {
      const answer = await client.request(methods.client.elicitation.create, {
        sessionId,
        mode: 'form',
        ...step.elicit,
      });
      await say({ client, sessionId }, `elicit: ${JSON.stringify(answer)}`);
    } else if (step.sleep) {
      await new Promise((resolve) => setTimeout(resolve, step.sleep));
    } else if (step.waitCancel) {
      await new Promise((resolve) => {
        cancelled = resolve;
      });
      return { stopReason: 'cancelled' };
    } else if (step.stop) {
      return { stopReason: step.stop, ...(step.usage ? { usage: step.usage } : {}) };
    } else if (step.fail) {
      throw new RequestError(-32603, step.fail);
    } else if (step.mcp) {
      await say({ client, sessionId }, `mcp: ${JSON.stringify(await callMcpTool(step.mcp))}`);
    } else if (step.exit !== undefined) {
      process.exit(step.exit);
    }
  }
  return { stopReason: 'end_turn' };
}

agent({ name: 'fake-agent' })
  .onRequest(methods.agent.initialize, ({ params }) => {
    log('initialize', params);
    return { protocolVersion: 1, agentCapabilities: env('FAKE_ACP_CAPS', {}) };
  })
  .onRequest(methods.agent.session.new, ({ params, client }) => {
    log('session/new', params);
    mcpServers = params.mcpServers;
    if (process.env.FAKE_ACP_AUTH === 'required') throw RequestError.authRequired();
    const commands = env('FAKE_ACP_COMMANDS', null);
    if (commands) {
      setTimeout(() => {
        void client.notify(methods.client.session.update, {
          sessionId: SESSION,
          update: { sessionUpdate: 'available_commands_update', availableCommands: commands },
        });
      }, 10);
    }
    const configOptions = env('FAKE_ACP_CONFIG', null);
    return { sessionId: SESSION, ...(configOptions ? { configOptions } : {}) };
  })
  .onRequest(methods.agent.session.load, async ({ params, client }) => {
    log('session/load', params);
    // The old conversation, replayed as updates before the answer.
    await say({ client, sessionId: params.sessionId }, 'from before the restart');
    return {};
  })
  .onRequest(methods.agent.session.resume, ({ params }) => {
    log('session/resume', params);
    return {};
  })
  .onRequest(methods.agent.session.close, ({ params }) => {
    log('session/close', params);
    return {};
  })
  .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
    log('session/set_config_option', params);
    return { configOptions: [] };
  })
  .onNotification(methods.agent.session.cancel, ({ params }) => {
    log('session/cancel', params);
    cancelled();
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    log('session/prompt', params);
    // The last block is the message; any before it are instructions sent ahead of it.
    const last = params.prompt.at(-1);
    const text = last?.type === 'text' ? last.text : '';
    if (text.startsWith('['))
      return run({ client, sessionId: params.sessionId, steps: JSON.parse(text) });
    if (text === '/compact') {
      for (const status of ['in_progress', 'completed']) {
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: { sessionUpdate: 'compaction_update', compactionId: 'c1', status },
        });
      }
      return { stopReason: 'end_turn' };
    }
    await say({ client, sessionId: params.sessionId }, `echo: ${text}`);
    return { stopReason: 'end_turn' };
  })
  .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
