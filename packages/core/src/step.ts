import type { Command } from '@ibitsa/protocol';
import { Hero } from './hero';
import type { CoreInput, GameMasterEvent } from './inputs.types';
import { NeedsYou } from './needs-you';
import { Outbox } from './outbox';
import { Quest } from './quest';
import type { CoreState } from './state.types';
import type { StepContext, StepResult } from './step.types';

/** The whole game master: pure, deterministic, no I/O (ADR 0001). Domain rules live in Quest, Hero and NeedsYou (ADR 0002). */
export function step(state: CoreState, input: CoreInput): StepResult {
  const draft = JSON.parse(JSON.stringify(state)) as CoreState;
  const outbox = new Outbox();
  const ctx: StepContext = {
    state: draft,
    outbox,
    needsYou: new NeedsYou({ state: draft, outbox }),
    t: input.t,
  };
  switch (input.kind) {
    case 'command':
      command(ctx, input.command);
      break;
    case 'agent':
      hero(ctx, input.heroId)?.handle(input.event);
      break;
    case 'gm':
      gameMaster(ctx, input.event);
      break;
    case 'timer': {
      const record = draft.heroes.find((h) => Hero.silenceTimer(h.id) === input.timerId);
      if (record) new Hero({ record, ctx }).lostContact();
      break;
    }
  }
  return { state: draft, cues: outbox.cues, effects: outbox.effects };
}

function hero(ctx: StepContext, heroId: string): Hero | undefined {
  const record = ctx.state.heroes.find((h) => h.id === heroId);
  return record && new Hero({ record, ctx });
}

function heroes(ctx: StepContext): Hero[] {
  return ctx.state.heroes.map((record) => new Hero({ record, ctx }));
}

function command(ctx: StepContext, command: Command): void {
  const quest = new Quest(ctx);
  switch (command.type) {
    case 'hello':
    case 'requestJournal':
    case 'requestFiles':
    case 'forgetProjectRule':
    case 'requestActions':
      return; // handled by the runtime (welcome + snapshot; journal pages; project rules; actions), never logged
    case 'startQuest':
      quest.start(command);
      return;
    case 'finishQuest':
      quest.finish(command.commandId);
      return;
    case 'abandonQuest':
      quest.abandon(command.commandId);
      return;
    case 'removeWorktree':
      quest.removeWorktree(command);
      return;
    case 'setAutoApprove':
      quest.setAutoApprove(command);
      return;
    case 'answerPermission':
    case 'answerQuestion': {
      const answered = ctx.needsYou.answer(command);
      if (!answered) return;
      const target = hero(ctx, answered.heroId);
      if (answered.questRules.length > 0) target?.allowForQuest(answered.questRules);
      target?.watchSilence();
      return;
    }
  }
  const target = hero(ctx, command.heroId);
  if (!target) {
    ctx.outbox.reject(command.commandId, 'No such hero.');
    return;
  }
  switch (command.type) {
    case 'sendMessage':
      target.sendMessage(command);
      return;
    case 'stopHero':
      target.stop();
      return;
    case 'restHero':
      target.rest(command.commandId);
      return;
    case 'resumeHero':
      target.resume(command.commandId);
      return;
    case 'raiseBudget':
      target.raiseCap(command);
      return;
    case 'markDone':
      target.markDone(command.commandId);
      return;
  }
}

function gameMaster(ctx: StepContext, event: GameMasterEvent): void {
  const quest = new Quest(ctx);
  switch (event.type) {
    case 'questSettings': {
      const { type: _type, ...settings } = event;
      ctx.state.settings = settings;
      return;
    }
    case 'worktreeCreated':
      quest.worktreeCreated(event);
      for (const h of heroes(ctx).filter((h) => h.record.islandId === event.islandId)) {
        h.worktreeCreated(event.path);
      }
      return;
    case 'worktreeFailed':
      for (const h of heroes(ctx).filter((h) => h.record.islandId === event.islandId)) {
        h.worktreeFailed(event.message);
      }
      return;
    case 'submitChecked':
      hero(ctx, event.heroId)?.submitChecked(event);
      return;
    case 'diffObserved':
      hero(ctx, event.heroId)?.diffObserved(event.hash);
      return;
    case 'worktreeRemoved':
      quest.worktreeRemoved(event.islandId);
      return;
    case 'worktreeRemoveFailed':
      ctx.outbox.reject(event.commandId, event.reason);
      return;
    case 'runtimeRestarted':
      if (ctx.state.campaign?.status !== 'active') return;
      ctx.needsYou.dropRequests();
      for (const h of heroes(ctx)) h.restarted();
      return;
  }
}
