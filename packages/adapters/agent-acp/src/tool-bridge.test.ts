import { existsSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_SERVER_NAME, ToolBridge } from './tool-bridge';

const until = (check: () => void) => vi.waitFor(check, { timeout: 10_000, interval: 10 });
const posix = process.platform !== 'win32';
const bridges: ToolBridge[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const b of bridges.splice(0)) b.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function bridge(options: Partial<ConstructorParameters<typeof ToolBridge>[0]> = {}) {
  const b = new ToolBridge({ script: '/ext/dist/mcp-bridge.cjs', ...options });
  bridges.push(b);
  return b;
}

/** A raw client on the bridge's socket, with what it was sent and whether it was dropped. */
function client(path: string) {
  const socket: Socket = connect(path);
  const lines: Record<string, unknown>[] = [];
  let dropped = false;
  socket.on('error', () => {});
  socket.on('close', () => {
    dropped = true;
  });
  createInterface({ input: socket }).on('line', (line) => lines.push(JSON.parse(line)));
  return {
    send: (message: unknown) => socket.write(`${JSON.stringify(message)}\n`),
    raw: (text: string) => socket.write(text),
    lines,
    dropped: () => dropped,
    end: () => socket.destroy(),
  };
}

const tokenOf = (env: { name: string; value: string }[]) =>
  env.find((e) => e.name === 'IBITSA_BRIDGE_TOKEN')?.value ?? '';

describe('ToolBridge: the runtime end of the tool bridge (#197)', () => {
  it('lists a stdio MCP server that runs the bridge script under Node, with its socket and secret', async () => {
    const b = bridge();
    const open = await b.open({ tools: [], call: async () => ({ text: '' }) });
    expect(open.server).toEqual({
      name: BRIDGE_SERVER_NAME,
      command: process.execPath,
      args: ['/ext/dist/mcp-bridge.cjs'],
      env: [
        // VS Code's executable is Electron; this makes it plain Node.
        { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
        { name: 'IBITSA_BRIDGE', value: b.socketPath },
        { name: 'IBITSA_BRIDGE_TOKEN', value: expect.stringMatching(/^[0-9a-f]{48}$/) },
      ],
    });
    // Every session gets its own secret.
    const other = await b.open({ tools: [], call: async () => ({ text: '' }) });
    expect(tokenOf(other.server.env)).not.toBe(tokenOf(open.server.env));
  });

  it('runs the bridge with the Node it is given instead', async () => {
    const open = await bridge({ node: { command: '/usr/bin/node' } }).open({
      tools: [],
      call: async () => ({ text: '' }),
    });
    expect(open.server.command).toBe('/usr/bin/node');
    expect(open.server.env.map((e) => e.name)).toEqual(['IBITSA_BRIDGE', 'IBITSA_BRIDGE_TOKEN']);
  });

  it('keeps the socket short and private, and removes it when closed', async () => {
    const b = bridge();
    await b.open({ tools: [], call: async () => ({ text: '' }) });
    if (!posix) {
      expect(b.socketPath).toMatch(/^\\\\\.\\pipe\\ibitsa-[0-9a-f]{12}$/);
      return;
    }
    expect(b.socketPath).toMatch(/ibitsa-[0-9a-f]{12}\.sock$/);
    expect(b.socketPath.length).toBeLessThanOrEqual(100);
    expect(statSync(b.socketPath).mode & 0o777).toBe(0o600);
    b.close();
    expect(existsSync(b.socketPath)).toBe(false);
  });

  it.runIf(posix)('moves the socket to /tmp when the folder would make its path too long', () => {
    const dir = mkdtempSync(join(tmpdir(), `ibitsa-${'x'.repeat(80)}-`));
    dirs.push(dir);
    const realTmp = realpathSync('/tmp');
    expect(bridge({ socketDir: dir }).socketPath).toMatch(
      new RegExp(`^${realTmp}/ibitsa-[0-9a-f]{12}\\.sock$`),
    );
    const short = bridge({ socketDir: '/tmp' }).socketPath;
    expect(short.startsWith(`${realTmp}/ibitsa-`)).toBe(true);
  });

  it.runIf(posix)('puts the socket in the real folder, not a link to it (#202)', () => {
    // The sandbox allows the socket by path before it exists, and only a real path matches: on macOS
    // the temp folder is under `/var`, a link to `/private/var`.
    const real = mkdtempSync(join(tmpdir(), 'ibitsa-real-'));
    const link = `${real}-link`;
    symlinkSync(real, link);
    dirs.push(real, link);
    expect(bridge({ socketDir: link }).socketPath.startsWith(`${realpathSync(real)}/ibitsa-`)).toBe(
      true,
    );
  });

  it('answers a bridge that proves its session, and only with that session’s tools', async () => {
    const b = bridge();
    const tool = { name: 'submit_task', description: 'Submit.', inputSchema: {} };
    const open = await b.open({
      tools: [tool],
      call: async ({ name, arguments: args }) => ({ text: `${name} ${JSON.stringify(args)}` }),
    });
    const c = client(b.socketPath);
    c.send({ type: 'hello', token: tokenOf(open.server.env) });
    await until(() => expect(c.lines).toEqual([{ type: 'tools', tools: [tool] }]));
    c.send({ type: 'call', id: 7, name: 'submit_task', arguments: { summary: 's' } });
    await until(() =>
      expect(c.lines[1]).toEqual({
        type: 'result',
        id: 7,
        text: 'submit_task {"summary":"s"}',
        isError: false,
      }),
    );
    c.end();
  });

  it('drops a connection that calls before hello, guesses a token, says hello twice or sends junk', async () => {
    const b = bridge();
    const open = await b.open({ tools: [], call: async () => ({ text: '' }) });
    const token = tokenOf(open.server.env);

    const early = client(b.socketPath);
    early.send({ type: 'call', id: 1, name: 'submit_task', arguments: {} });
    const guess = client(b.socketPath);
    guess.send({ type: 'hello', token: 'guessed' });
    const junk = client(b.socketPath);
    junk.raw('{"type":"hello"\n');
    const twice = client(b.socketPath);
    twice.send({ type: 'hello', token });
    twice.send({ type: 'hello', token });
    await until(() => {
      for (const c of [early, guess, junk, twice]) expect(c.dropped()).toBe(true);
    });
    expect(early.lines).toEqual([]);
    expect(guess.lines).toEqual([]);
  });

  it("cuts a session's bridges off when its tools close, and every bridge when it closes", async () => {
    const b = bridge();
    const first = await b.open({ tools: [], call: async () => ({ text: '' }) });
    const second = await b.open({ tools: [], call: async () => ({ text: '' }) });
    const one = client(b.socketPath);
    one.send({ type: 'hello', token: tokenOf(first.server.env) });
    const two = client(b.socketPath);
    two.send({ type: 'hello', token: tokenOf(second.server.env) });
    await until(() => expect(one.lines.length + two.lines.length).toBe(2));
    first.close();
    await until(() => expect(one.dropped()).toBe(true));
    expect(two.dropped()).toBe(false);
    // A closed session's token no longer works.
    const again = client(b.socketPath);
    again.send({ type: 'hello', token: tokenOf(first.server.env) });
    await until(() => expect(again.dropped()).toBe(true));
    b.close();
    await until(() => expect(two.dropped()).toBe(true));
  });

  it('opens again after closing, on the same socket', async () => {
    const b = bridge();
    await b.open({ tools: [], call: async () => ({ text: '' }) });
    b.close();
    const open = await b.open({ tools: [], call: async () => ({ text: '' }) });
    const c = client(b.socketPath);
    c.send({ type: 'hello', token: tokenOf(open.server.env) });
    await until(() => expect(c.lines).toEqual([{ type: 'tools', tools: [] }]));
    c.end();
  });
});
