import type { HeroRecord } from '@ibitsa/core';
import type { ActionInfo } from '@ibitsa/protocol';
import { type Connection, type FrontEnd, Runtime, systemClock } from '@ibitsa/runtime';
import type { CommandIntent, RuntimeHostOptions } from './runtime-host.types';

/**
 * Hosts the runtime inside the extension (spec §11.2) and watches it for things the user must see
 * while the game tab is hidden (spec §6.4).
 */
export class RuntimeHost {
  private runtime: Runtime | null = null;
  /** The host's own connection, for commands from the Command Palette (#87). */
  private connection: Connection | null = null;
  private commands = 0;
  private starting: Promise<Runtime> | null = null;
  private readonly options: RuntimeHostOptions;

  constructor(options: RuntimeHostOptions) {
    this.options = options;
  }

  /** Connects a front end, starting the runtime on first use. */
  async connect(frontEnd: FrontEnd): Promise<Connection> {
    return (await this.ensure()).connect(frontEnd);
  }

  /** Read-only access for commands (e.g. the worktree to open). */
  async state() {
    return (await this.ensure()).snapshotState;
  }

  /** The `/` menu's actions for the running quest (#87). */
  async actions(): Promise<ActionInfo[]> {
    return (await this.ensure()).currentActions();
  }

  /** Sends a command as if from a front end, e.g. Stop Hero from the Command Palette (#87). */
  async command(intent: CommandIntent): Promise<void> {
    await this.ensure();
    this.connection?.receive({ ...intent, commandId: `palette-${++this.commands}` });
  }

  dispose(): void {
    this.runtime?.dispose();
    this.runtime = null;
    this.starting = null;
  }

  private ensure(): Promise<Runtime> {
    if (this.runtime) return Promise.resolve(this.runtime);
    this.starting ??= this.start();
    return this.starting;
  }

  private async start(): Promise<Runtime> {
    const o = this.options;
    const [credentials, env] = await Promise.all([o.credentials(), o.environment()]);
    const { adapter, gameMaster } = o.dependencies({
      credentials,
      workspaceDir: o.workspaceDir,
      env,
    });
    const runtime = new Runtime({
      storageDir: o.storageDir,
      adapter,
      gameMaster,
      clock: systemClock,
      settings: o.settings,
      repoDir: o.workspaceDir,
      ...(o.disabledCouncillors ? { disabledCouncillors: o.disabledCouncillors } : {}),
    });
    this.connection = runtime.connect(this.watcher(runtime));
    runtime.start();
    this.runtime = runtime;
    return runtime;
  }

  /** An internal front end: notifications while the game is hidden, and the waiting count. */
  private watcher(runtime: Runtime): FrontEnd {
    return {
      post: (message) => {
        if (message.type === 'snapshot')
          this.options.onWaitingChanged(message.snapshot.needsYou.length);
        if (message.type !== 'cue' || message.cue.type !== 'needsYouAdded') return;
        if (this.options.gameVisible()) return;
        const { itemId } = message.cue;
        const state = runtime.snapshotState;
        const item = state.needsYou.find((i) => i.id === itemId);
        if (!item) return;
        const hero = state.heroes.find((h) => h.id === item.heroId);
        void this.options.notify(describe(item, hero)).then((open) => {
          if (open) this.options.openGame();
        });
      },
    };
  }
}

function describe(
  item: Runtime['snapshotState']['needsYou'][number],
  hero: HeroRecord | undefined,
): string {
  const name = hero?.name ?? 'A hero';
  switch (item.kind) {
    case 'permission':
      return `${name} wants to ${item.action.toLowerCase()}: ${item.target}`;
    case 'question':
      return `${name} asks: ${item.questions[0]?.question ?? 'a question'}`;
    case 'stalled':
      return `${name} seems stuck: ${item.reason}`;
    case 'outOfGold':
      return `${name} is out of gold.`;
    case 'error':
      return `${name} needs you: ${item.message}`;
    case 'reply':
      return `${name} is waiting for orders.`;
  }
}
