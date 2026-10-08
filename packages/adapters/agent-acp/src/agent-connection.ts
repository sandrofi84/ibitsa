import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  type ClientConnection,
  type ClientContext,
  client,
  type InitializeResponse,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import type { AgentProcess, SpawnRequest } from './acp-adapter.types';
import type { AgentConnectionInit } from './agent-connection.types';

/** How much of the agent's stderr to keep, for the error when it exits. */
const STDERR_TAIL = 2_000;
/** A request that fails as the process dies is reported as the exit, which says more. */
const EXIT_GRACE_MS = 200;

/** Starts the agent as a plain child process; the sandbox (#200) replaces this through `spawn`. */
export function spawnAgent(request: SpawnRequest): AgentProcess {
  return spawn(request.command, request.args, {
    cwd: request.cwd,
    env: request.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/**
 * One agent process and its ACP connection (spec §11.5): spawned in the worktree, spoken to over
 * stdio as newline-delimited JSON-RPC. The client advertises form elicitation, and no file system or
 * terminal: the agent uses its own tools.
 */
export class AgentConnection {
  readonly agent: ClientContext;
  private readonly process: AgentProcess;
  private readonly connection: ClientConnection;
  private stderr = '';
  private closed = false;
  private exitMessage: string | null = null;
  private readonly exitWaiters = new Set<(message: string) => void>();

  constructor({ options, cwd, handlers }: AgentConnectionInit) {
    const spec = options.agent;
    this.process = (options.spawn ?? spawnAgent)({
      command: spec.command,
      args: spec.args ?? [],
      cwd,
      env: { ...(options.env?.() ?? process.env), ...spec.env },
      ask: handlers.ask ?? (() => Promise.resolve(false)),
    });
    const exited = (message: string) => {
      if (this.closed) return;
      this.closed = true;
      this.exitMessage = message;
      for (const waiter of this.exitWaiters) waiter(message);
      this.connection.close();
      handlers.exited?.(message);
    };
    this.process.once('error', (error) =>
      exited(`Couldn't start the agent (${spec.command}): ${error.message}`),
    );
    this.process.once('exit', (code) => {
      const tail = this.stderr.trim();
      exited(
        `The agent exited${code === null ? '' : ` with code ${code}`}.${tail ? ` ${tail}` : ''}`,
      );
    });
    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-STDERR_TAIL);
    });
    const { stdin, stdout } = this.process;
    if (!stdin || !stdout) throw new Error('The agent process has no stdin or stdout.');
    const app = client({ name: 'ibitsa' }).onNotification(methods.client.session.update, (ctx) =>
      handlers.update?.(ctx.params),
    );
    app.onRequest(methods.client.session.requestPermission, (ctx) =>
      handlers.permission
        ? handlers.permission({ params: ctx.params, signal: ctx.signal })
        : { outcome: { outcome: 'cancelled' } },
    );
    app.onRequest(methods.client.elicitation.create, (ctx) =>
      handlers.elicit
        ? handlers.elicit({ params: ctx.params, signal: ctx.signal })
        : { action: 'decline' },
    );
    this.connection = app.connect(
      ndJsonStream(
        Writable.toWeb(stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(stdout) as ReadableStream<Uint8Array>,
      ),
    );
    this.agent = this.connection.agent;
  }

  initialize(): Promise<InitializeResponse> {
    return this.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      // Terminal sign-in (#199): the party check's Sign in reruns the agent in a VS Code terminal.
      clientCapabilities: { elicitation: { form: {} }, auth: { terminal: true } },
      clientInfo: { name: 'ibitsa', version: '0.1.0' },
    });
  }

  /**
   * What to tell the user about a failed request: the process's exit when it is dying (the request
   * fails first, the exit follows), else the request's own error.
   */
  async failure(error: unknown): Promise<string> {
    const own = error instanceof Error ? error.message : String(error);
    if (this.exitMessage !== null) return this.exitMessage;
    return new Promise((resolve) => {
      const done = (message: string) => {
        clearTimeout(timer);
        this.exitWaiters.delete(done);
        resolve(message);
      };
      const timer = setTimeout(() => done(own), EXIT_GRACE_MS);
      this.exitWaiters.add(done);
    });
  }

  /** Ends the connection and the process. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connection.close();
    this.process.kill();
  }
}
