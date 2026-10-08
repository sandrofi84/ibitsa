// Probes installed ACP agents (spec §11.5, #195): starts each, runs `initialize` and a throwaway
// `session/new` in an empty temp folder, and prints what it offers. It sends no prompt, so nothing is
// spent. Speaks ACP's JSON-RPC (one JSON message per line over stdio) directly, without the SDK.
//
//   pnpm acp:probe                      every preset found on PATH
//   pnpm acp:probe -- codex-acp         one command, with its arguments
//   pnpm acp:probe -- --json            the raw answers, as JSON
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** The presets of §11.5, by the command each one runs. */
const PRESETS = [
  { id: 'codex', command: 'codex-acp', args: [] },
  { id: 'gemini', command: 'gemini', args: ['--acp'] },
  { id: 'copilot', command: 'copilot', args: ['--acp'] },
  { id: 'opencode', command: 'opencode', args: ['acp'] },
];
const PROTOCOL_VERSION = 1;
const ANSWER_MS = 30_000;
/** How long to listen after `session/new` for the updates agents send straight after it. */
const SETTLE_MS = 2_000;

function onPath(command) {
  const which = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(which, [command], { stdio: 'ignore' }).status === 0;
}

/** One agent process and its JSON-RPC traffic. */
function connect(agent) {
  const child = spawn(agent.command, agent.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    // Its own process group, so stopping it also stops what it started (Gemini relaunches itself).
    detached: process.platform !== 'win32',
  });
  const pending = new Map();
  const updates = [];
  let stderr = '';
  let nextId = 1;
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-2_000);
  });
  const write = (message) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // Not ours: some agents log to stdout before the protocol starts.
    }
    if (message.id !== undefined && pending.has(message.id) && !message.method) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method === 'session/update') {
      updates.push(message.params?.update);
    } else if (message.id !== undefined && message.method) {
      // A request to the client (permission, file, terminal…): the probe offers none of them.
      write({ id: message.id, error: { code: -32601, message: 'Not offered by the probe' } });
    }
  });
  const exited = new Promise((resolve) => {
    child.on('error', (error) => resolve(`could not start: ${error.message}`));
    child.on('exit', (code) => resolve(`exited with code ${code}`));
  });
  const request = (method, params) => {
    const id = nextId++;
    write({ id, method, params });
    const answer = new Promise((resolve) => pending.set(id, resolve));
    const late = new Promise((resolve) =>
      setTimeout(
        () => resolve({ error: { message: `no answer in ${ANSWER_MS / 1000} s` } }),
        ANSWER_MS,
      ),
    );
    const gone = exited.then((why) => ({ error: { message: `${why}: ${stderr.trim()}` } }));
    return Promise.race([answer, late, gone]);
  };
  return { child, request, updates };
}

async function probe(agent) {
  const cwd = mkdtempSync(join(tmpdir(), 'ibitsa-acp-probe-'));
  const { child, request, updates } = connect(agent);
  try {
    const init = await request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { elicitation: { form: {} } },
      clientInfo: { name: 'ibitsa-acp-probe', version: '0.0.0' },
    });
    if (init.error) return { agent, error: init.error };
    const session = await request('session/new', { cwd, mcpServers: [] });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const sessionId = session.result?.sessionId;
    if (sessionId && init.result?.agentCapabilities?.sessionCapabilities?.close) {
      await request('session/close', { sessionId });
    }
    return { agent, initialize: init.result, session, updates };
  } finally {
    stop(child);
    rmSync(cwd, { recursive: true, force: true });
  }
}

function stop(child) {
  try {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

const yes = (value) => (value ? 'yes' : 'no');

function summary(result) {
  const { agent, initialize: init, session, updates } = result;
  if (result.error) return { agent: agent.id, error: result.error.message };
  const caps = init.agentCapabilities ?? {};
  const sessionCaps = caps.sessionCapabilities ?? {};
  const options = session.result?.configOptions ?? [];
  const model = options.find((option) => option.category === 'model');
  const commands = updates
    .filter((update) => update?.sessionUpdate === 'available_commands_update')
    .flatMap((update) => update.availableCommands.map((command) => command.name));
  const choices = (option) =>
    (option?.options ?? [])
      .flatMap((entry) => entry.options ?? [entry])
      .map((entry) => entry.value);
  return {
    agent: agent.id,
    version: `${init.agentInfo?.name ?? '?'} ${init.agentInfo?.version ?? ''}`.trim(),
    protocol: init.protocolVersion,
    'session/new': session.error
      ? `${session.error.code === -32000 ? 'auth_required' : 'error'}: ${session.error.message}`
      : 'ok',
    auth: (init.authMethods ?? []).map((method) => method.id).join(', ') || 'none',
    load: yes(caps.loadSession),
    resume: yes(sessionCaps.resume),
    list: yes(sessionCaps.list),
    close: yes(sessionCaps.close),
    'mcp http/sse': `${yes(caps.mcpCapabilities?.http)}/${yes(caps.mcpCapabilities?.sse)}`,
    'image/embedded': `${yes(caps.promptCapabilities?.image)}/${yes(caps.promptCapabilities?.embeddedContext)}`,
    modes:
      (session.result?.modes?.availableModes ?? []).map((mode) => mode.id).join(', ') || 'none',
    config: options.map((option) => option.category ?? option.id).join(', ') || 'none',
    models: model ? `${model.currentValue} of ${choices(model).join(', ')}` : 'not offered',
    commands: commands.join(', ') || 'none',
    'compact command': yes(commands.includes('compact')),
  };
}

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const json = argv.includes('--json');
const custom = argv.filter((arg) => arg !== '--json');
const agents = custom.length
  ? [{ id: custom[0], command: custom[0], args: custom.slice(1) }]
  : PRESETS.filter((preset) => onPath(preset.command));
if (agents.length === 0) {
  console.log(
    `No ACP agent found on PATH (looked for ${PRESETS.map((p) => p.command).join(', ')}).`,
  );
  process.exit(0);
}
const results = [];
for (const agent of agents) results.push(await probe(agent));
if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const row of results.map(summary)) {
    console.log(`\n## ${row.agent}`);
    for (const [key, value] of Object.entries(row))
      if (key !== 'agent') console.log(`- ${key}: ${value}`);
  }
}
// The answer timers would keep the process alive for up to half a minute.
process.exit(0);
