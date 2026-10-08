import {
  type AuthMethod,
  type AvailableCommand,
  methods,
  RequestError,
} from '@agentclientprotocol/sdk';
import type { ActionInfo, AgentEvent, ReviewEvent } from '@ibitsa/protocol';
import type {
  AgentAdapter,
  AgentSession,
  ReviewSession,
  ReviewStart,
  SessionResume,
  SessionStart,
} from '@ibitsa/runtime';
import type { AcpAdapterOptions, AgentProbe } from './acp-adapter.types';
import { AcpReview } from './acp-review';
import { AcpSession } from './acp-session';
import { AgentConnection, offeredModels } from './agent-connection';

/** How long the `/` menu waits for an agent to list its commands. */
export const COMMANDS_WAIT_MS = 3_000;
/** How long the party check waits for an agent to start a session (#199). */
export const CHECK_TIMEOUT_MS = 30_000;
/** ACP's `auth_required` error code. */
const AUTH_REQUIRED = -32_000;

/**
 * The generic Agent Client Protocol adapter (spec §11.5): heroes on any ACP agent, one agent process
 * each. Gold is estimated only from the prices in the agent's entry, so without them there is no
 * pouch to enforce. Councillors review on it too (#201).
 */
export class AcpAdapter implements AgentAdapter {
  readonly capabilities: { budgetCap: boolean; costReported: boolean };
  private readonly options: AcpAdapterOptions;

  constructor(options: AcpAdapterOptions) {
    this.options = options;
    this.capabilities = { budgetCap: false, costReported: options.agent.prices !== undefined };
  }

  /** Whether heroes run inside Ibitsa's sandbox (§11.5, #200); their class says so when not. */
  get sandboxed(): boolean {
    return this.options.sandboxed === true;
  }

  startSession(start: SessionStart, onEvent: (event: AgentEvent) => void): AgentSession {
    return new AcpSession({
      options: this.options,
      heroId: start.heroId,
      cwd: start.cwd,
      ...(start.model ? { model: start.model } : {}),
      prompt: start.prompt,
      ...(start.allowRules ? { allowRules: start.allowRules } : {}),
      onEvent,
    });
  }

  resumeSession(resume: SessionResume, onEvent: (event: AgentEvent) => void): AgentSession {
    return new AcpSession({
      options: this.options,
      heroId: resume.heroId,
      cwd: resume.cwd,
      ...(resume.model ? { model: resume.model } : {}),
      ...(resume.prompt === undefined ? {} : { prompt: resume.prompt }),
      resume: resume.sessionId,
      ...(resume.allowRules ? { allowRules: resume.allowRules } : {}),
      onEvent,
    });
  }

  /** A councillor's review on this agent (§5.5, #201): read-only, filing `submit_verdict`. */
  startReview(start: ReviewStart, onEvent: (event: ReviewEvent) => void): ReviewSession {
    return new AcpReview({ options: this.options, start, onEvent });
  }

  /**
   * The party check (§11.5, #199): starts the agent in the folder, asks it to `initialize` and for a
   * throwaway session, then closes that and stops it. No prompt is sent, so nothing is spent.
   */
  async check({
    cwd,
    timeoutMs = CHECK_TIMEOUT_MS,
  }: {
    cwd: string;
    timeoutMs?: number;
  }): Promise<AgentProbe> {
    let gone: (message: string) => void = () => {};
    const exited = new Promise<never>((_, reject) => {
      gone = (message) => reject(new Error(message));
    });
    const connection = new AgentConnection({
      options: this.options,
      cwd,
      handlers: { exited: (message) => gone(message) },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`The agent didn't answer in ${Math.round(timeoutMs / 1000)} s.`)),
        timeoutMs,
      );
    });
    const answer = <T>(request: Promise<T>) => Promise.race([request, exited, late]);
    try {
      const init = await answer(connection.initialize());
      try {
        const created = await answer(
          connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] }),
        );
        if (init.agentCapabilities?.sessionCapabilities?.close) {
          // Only to be tidy: the process stops next either way.
          await answer(
            connection.agent.request(methods.agent.session.close, {
              sessionId: created.sessionId,
            }),
          ).catch(() => {});
        }
        return { kind: 'ready', models: offeredModels(created.configOptions) };
      } catch (error) {
        if (!(error instanceof RequestError) || error.code !== AUTH_REQUIRED) throw error;
        return {
          kind: 'signIn',
          message: error.message,
          terminal: terminalSignIn(init.authMethods ?? []),
        };
      }
    } catch (error) {
      return { kind: 'failed', message: await connection.failure(error) };
    } finally {
      clearTimeout(timer);
      connection.close();
    }
  }

  /**
   * The `/` menu's actions (#84): the commands the agent lists for a new session in the folder. No
   * prompt is sent, so nothing is spent; an agent that can't start or lists nothing gives none.
   */
  async listActions({ cwd }: { cwd: string }): Promise<ActionInfo[]> {
    let listed: (commands: AvailableCommand[]) => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const commands = new Promise<AvailableCommand[]>((resolve) => {
      listed = resolve;
    });
    const connection = new AgentConnection({
      options: this.options,
      cwd,
      handlers: {
        update: ({ update }) => {
          if (update.sessionUpdate === 'available_commands_update')
            listed(update.availableCommands);
        },
        exited: () => listed([]),
      },
    });
    try {
      await connection.initialize();
      await connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] });
      // Agents list their commands just after the session starts, if at all.
      timer = setTimeout(() => listed([]), COMMANDS_WAIT_MS);
      return (await commands).map(toAction);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
      connection.close();
    }
  }
}

/** The agent's own terminal sign-in, if it lists one (ACP's terminal auth method). */
function terminalSignIn(
  authMethods: AuthMethod[],
): { args: string[]; env: Record<string, string> } | null {
  const method = authMethods.find((m) => 'type' in m && m.type === 'terminal');
  if (!method || !('type' in method) || method.type !== 'terminal') return null;
  return { args: method.args ?? [], env: method.env ?? {} };
}

function toAction(command: AvailableCommand): ActionInfo {
  return {
    name: command.name,
    description: command.description,
    argumentHint: command.input && 'hint' in command.input ? command.input.hint : '',
    aliases: [],
    source: 'other',
    target: 'any',
  };
}
