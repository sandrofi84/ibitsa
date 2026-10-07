import type { Command } from '@ibitsa/protocol';
import { Campaign } from './campaign';
import { Elder } from './elder';
import { Hero } from './hero';
import type { CoreInput, GameMasterEvent } from './inputs.types';
import { NeedsYou } from './needs-you';
import { Outbox } from './outbox';
import { Quest } from './quest';
import { Sitting } from './sitting';
import { DEFAULT_SETTINGS } from './state';
import type { CoreState } from './state.types';
import type { StepContext, StepResult } from './step.types';

/** The whole game master: pure, deterministic, no I/O (ADR 0001). Domain rules live in Quest, Hero, NeedsYou and Sitting (ADR 0002). */
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
    case 'elder':
      new Elder(ctx).handle(input);
      break;
    case 'council':
      new Sitting(ctx).handle(input);
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
  // A campaign with several parties: start what can start, and the campaign's cap (#121).
  new Campaign(ctx).schedule();
  new Campaign(ctx).checkCap();
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
    case 'requestPreview':
    case 'createAction':
      return; // handled by the runtime (welcome + snapshot; journal pages; project rules; actions), never logged
    case 'consultElder':
      new Elder(ctx).consult(command);
      return;
    case 'startQuest':
      quest.start(command);
      return;
    case 'startPlannedQuest':
      quest.startPlanned(command);
      return;
    case 'startCampaign':
      new Campaign(ctx).start(command);
      return;
    case 'raiseCampaignBudget':
      new Campaign(ctx).raiseCap(command);
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
    case 'conveneCouncil':
      new Sitting(ctx).convene(command);
      return;
    case 'addCouncillor':
      new Sitting(ctx).addCouncillor(command);
      return;
    case 'answerCouncil':
      new Sitting(ctx).answer(command);
      return;
    case 'askCouncilWhy':
      new Sitting(ctx).why(command);
      return;
    case 'approvePlan':
      new Sitting(ctx).approve(command);
      return;
    case 'requestPlanChange':
      new Sitting(ctx).requestChange(command);
      return;
    case 'rateSitting':
      new Sitting(ctx).rate(command);
      return;
    case 'dismissCouncil':
      new Sitting(ctx).dismiss(command.commandId);
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
      // Logs from before a setting existed get its default.
      ctx.state.settings = { ...DEFAULT_SETTINGS, ...settings };
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
    case 'worktreeRebased':
      new Campaign(ctx).rebased(event);
      return;
    case 'councilVersionNoted':
      new Sitting(ctx).versionNoted(event);
      return;
    case 'runtimeRestarted':
      if (ctx.state.campaign?.status === 'planning') {
        new Elder(ctx).restarted();
        new Sitting(ctx).restarted();
      }
      if (ctx.state.campaign?.status !== 'active') return;
      ctx.needsYou.dropRequests();
      for (const h of heroes(ctx)) h.restarted();
      return;
  }
}
