import { type AvailableCommand, methods } from '@agentclientprotocol/sdk';
import type { ActionInfo, AgentEvent } from '@ibitsa/protocol';
import type { AgentAdapter, AgentSession, SessionResume, SessionStart } from '@ibitsa/runtime';
import type { AcpAdapterOptions } from './acp-adapter.types';
import { AcpSession } from './acp-session';
import { AgentConnection } from './agent-connection';

/** How long the `/` menu waits for an agent to list its commands. */
export const COMMANDS_WAIT_MS = 3_000;

/**
 * The generic Agent Client Protocol adapter (spec §11.5): heroes on any ACP agent, one agent process
 * each. Gold is estimated only from the prices in the agent's entry, so without them there is no
 * pouch to enforce; reviewers, the tool bridge and the sandbox come with #201, #197 and #200.
 */
export class AcpAdapter implements AgentAdapter {
  readonly capabilities: { budgetCap: boolean; costReported: boolean };
  private readonly options: AcpAdapterOptions;

  constructor(options: AcpAdapterOptions) {
    this.options = options;
    this.capabilities = { budgetCap: false, costReported: options.agent.prices !== undefined };
  }

  startSession(start: SessionStart, onEvent: (event: AgentEvent) => void): AgentSession {
    return new AcpSession({
      options: this.options,
      heroId: start.heroId,
      cwd: start.cwd,
      ...(start.model ? { model: start.model } : {}),
      prompt: start.prompt,
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
      onEvent,
    });
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
      timer = setTimeout(() => resolve([]), COMMANDS_WAIT_MS);
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
      return (await commands).map(toAction);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
      connection.close();
    }
  }
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
