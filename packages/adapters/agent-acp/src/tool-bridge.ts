import { randomBytes } from 'node:crypto';
import { chmodSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import * as v from 'valibot';
import {
  type BridgeMessage,
  BridgeMessageSchema,
  type RuntimeMessage,
} from './tool-bridge.schema.ts';
import type {
  OpenTools,
  ToolBridgeOptions,
  ToolHost,
  ToolResult,
  ToolSet,
} from './tool-bridge.types.ts';

/** The environment variables that tell the bridge process where to connect, and as whom. */
export const BRIDGE_SOCKET_ENV = 'IBITSA_BRIDGE';
export const BRIDGE_TOKEN_ENV = 'IBITSA_BRIDGE_TOKEN';
/** The MCP server's name in `session/new`; agents prefix its tools with it. */
export const BRIDGE_SERVER_NAME = 'ibitsa';

/**
 * Whether an agent's tool call goes to the bridge's own server (#202): Codex names an MCP call
 * `mcp.<server>.<tool>` with `{ server, tool, arguments }`, and an approval for one `{ serverName }`.
 * Ibitsa offered those tools, so asking whether to call them needs no one's answer.
 */
export function isBridgeCall(call: { title?: string | null; rawInput?: unknown }): boolean {
  const input =
    call.rawInput && typeof call.rawInput === 'object'
      ? (call.rawInput as { server?: unknown; serverName?: unknown })
      : {};
  if (input.server === BRIDGE_SERVER_NAME || input.serverName === BRIDGE_SERVER_NAME) return true;
  return call.title?.startsWith(`mcp.${BRIDGE_SERVER_NAME}.`) ?? false;
}
/** macOS keeps a Unix socket's path under 104 bytes; past this, the socket moves to `/tmp`. */
const MAX_SOCKET_PATH = 100;

/**
 * The runtime's end of the MCP tool bridge (spec §11.5, #197). ACP lets a client offer tools only as
 * MCP servers, so each session lists a small stdio MCP server (the extension's `mcp-bridge.cjs`) that
 * the agent launches; it connects back here over one local socket (a named pipe on Windows) and
 * proves its session with a secret token, so another local process can't call a hero's tools.
 */
export class ToolBridge implements ToolHost {
  readonly socketPath: string;
  private readonly options: ToolBridgeOptions;
  private readonly sessions = new Map<string, ToolSet>();
  private readonly sockets = new Map<string, Set<Socket>>();
  private server: Server | null = null;
  private listening: Promise<void> | null = null;

  constructor(options: ToolBridgeOptions) {
    this.options = options;
    this.socketPath = socketPath(options.socketDir);
  }

  async open(tools: ToolSet): Promise<OpenTools> {
    await this.listen();
    const token = randomBytes(24).toString('hex');
    this.sessions.set(token, tools);
    const node = this.options.node ?? {
      command: process.execPath,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
    const env = { ...node.env, [BRIDGE_SOCKET_ENV]: this.socketPath, [BRIDGE_TOKEN_ENV]: token };
    return {
      server: {
        name: BRIDGE_SERVER_NAME,
        command: node.command,
        args: [this.options.script],
        env: Object.entries(env).map(([name, value]) => ({ name, value })),
      },
      close: () => {
        this.sessions.delete(token);
        for (const socket of this.sockets.get(token) ?? []) socket.destroy();
        this.sockets.delete(token);
      },
    };
  }

  /** Stops listening and removes the socket. Open sessions lose their tools. */
  close(): void {
    this.sessions.clear();
    for (const sockets of this.sockets.values()) for (const socket of sockets) socket.destroy();
    this.sockets.clear();
    this.server?.close();
    this.server = null;
    this.listening = null;
    if (process.platform !== 'win32') rmSync(this.socketPath, { force: true });
  }

  private listen(): Promise<void> {
    this.listening ??= new Promise((resolve, reject) => {
      const server = createServer((socket) => this.accept(socket));
      server.once('error', reject);
      server.listen(this.socketPath, () => {
        // Only this user may connect; the token still decides which session a bridge belongs to.
        if (process.platform !== 'win32') chmodSync(this.socketPath, 0o600);
        resolve();
      });
      this.server = server;
    });
    return this.listening;
  }

  /** A bridge connected: it must say `hello` with a live token first, or it is dropped. */
  private accept(socket: Socket): void {
    let session: { token: string; tools: ToolSet } | null = null;
    const send = (message: RuntimeMessage) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
    };
    socket.on('error', () => socket.destroy());
    createInterface({ input: socket }).on('line', (line) => {
      const message = parse(line);
      if (!message) return void socket.destroy();
      if (message.type === 'hello') {
        const tools = session ? undefined : this.sessions.get(message.token);
        if (!tools) return void socket.destroy();
        session = { token: message.token, tools };
        this.track({ token: message.token, socket });
        send({ type: 'tools', tools: tools.tools });
        return;
      }
      if (!session) return void socket.destroy();
      void answer({ tools: session.tools, call: message }).then((result) =>
        send({ type: 'result', id: message.id, text: result.text, isError: !!result.isError }),
      );
    });
  }

  private track({ token, socket }: { token: string; socket: Socket }): void {
    const sockets = this.sockets.get(token) ?? new Set();
    sockets.add(socket);
    this.sockets.set(token, sockets);
    socket.once('close', () => sockets.delete(socket));
  }
}

function parse(line: string): BridgeMessage | null {
  try {
    const parsed = v.safeParse(BridgeMessageSchema, JSON.parse(line));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}

/** One call, answered by the session; a handler that throws is the agent's failed call, not ours. */
async function answer({
  tools,
  call,
}: {
  tools: ToolSet;
  call: { name: string; arguments: unknown };
}): Promise<ToolResult> {
  try {
    return await tools.call({ name: call.name, arguments: call.arguments });
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true };
  }
}

/** A short, unguessable socket: a named pipe on Windows, else a file in the temp folder. */
function socketPath(dir: string | undefined): string {
  const name = `ibitsa-${randomBytes(6).toString('hex')}`;
  if (process.platform === 'win32') return `\\\\.\\pipe\\${name}`;
  // The real folder, not a link to it (macOS's `/var` is `/private/var`): the sandbox allows the
  // socket by path when the agent starts, before the socket exists, and only a real path matches (#202).
  const path = join(realFolder(dir ?? tmpdir()), `${name}.sock`);
  return path.length <= MAX_SOCKET_PATH ? path : join(realFolder('/tmp'), `${name}.sock`);
}

function realFolder(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}
