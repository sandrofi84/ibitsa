import type { Command, ElderEvent, ElderView, ResearchBrief } from '@ibitsa/protocol';
import type { CoreInput } from './inputs.types';
import { Quest } from './quest';
import { Sitting } from './sitting';
import { newId } from './state';
import type { ElderRecord } from './state.types';
import type { StepContext } from './step.types';

/**
 * The elder's research (spec §4.1): a new quest's task goes to the elder first, in a campaign that is
 * still planning. Its brief offers a quick quest or the council; until then no hero exists.
 */
export class Elder {
  private readonly ctx: StepContext;

  constructor(ctx: StepContext) {
    this.ctx = ctx;
  }

  static view(record: ElderRecord): ElderView {
    const { sessionId: _sessionId, startedAt: _startedAt, endedAt: _endedAt, ...visible } = record;
    return visible;
  }

  /**
   * What a quick quest's hero is told about the brief: where to start reading and what the elder found,
   * so it needn't explore (spec §10 rule 2).
   */
  static briefing(brief: ResearchBrief): string {
    const lines = [
      'The elder researched this task first. Start from these and read others only when you need to:',
    ];
    for (const f of brief.files)
      lines.push(`- ${f.path}${f.lines ? `:${f.lines}` : ''}: ${f.note}`);
    if (brief.findings.length > 0) {
      lines.push('', 'What the elder found:');
      for (const finding of brief.findings) lines.push(`- ${finding}`);
    }
    return lines.join('\n');
  }

  consult(command: Extract<Command, { type: 'consultElder' }>): void {
    const state = this.ctx.state;
    const problem =
      state.campaign?.status === 'active'
        ? 'Finish or abandon the current quest first.'
        : state.elder?.status === 'researching'
          ? 'The elder is already researching.'
          : Sitting.active(state.sitting)
            ? 'The council is sitting.'
            : undefined;
    if (problem) {
      this.ctx.outbox.reject(command.commandId, problem);
      return;
    }
    const title = Quest.title(command.task);
    if (state.campaign?.status === 'planning') state.campaign.title = title;
    else {
      state.campaign = {
        id: newId(state, 'c'),
        title,
        status: 'planning',
        autoApprove: false,
        branching: 'separate',
        stackedStart: null,
        baseRef: null,
      };
    }
    const elderId = newId(state, 'e');
    state.elder = {
      id: elderId,
      task: command.task,
      status: 'researching',
      progress: null,
      brief: null,
      gold: { kind: 'unknown' },
      error: null,
      sessionId: null,
      startedAt: this.ctx.t,
      endedAt: null,
    };
    this.ctx.outbox.effect({ type: 'startElder', elderId, task: command.task });
  }

  handle(input: Extract<CoreInput, { kind: 'elder' }>): void {
    const record = this.ctx.state.elder;
    if (!record || record.id !== input.elderId) return;
    this.event({ record, event: input.event });
  }

  /** VS Code reloaded: the research session is gone, so it starts again (#166). Returns whether it did. */
  restarted(): boolean {
    const record = this.ctx.state.elder;
    if (record?.status !== 'researching') return false;
    record.progress = null;
    record.sessionId = null;
    this.ctx.outbox.effect({ type: 'startElder', elderId: record.id, task: record.task });
    return true;
  }

  /** The campaign ended (abandoned): stop the research if it's still going. */
  stop(): void {
    this.fail('The quest was abandoned.');
  }

  private event({ record, event }: { record: ElderRecord; event: ElderEvent }): void {
    switch (event.type) {
      case 'sessionStarted':
        record.sessionId = event.sessionId;
        return;
      case 'usage':
        record.gold = { kind: 'exact', value: event.totalCost };
        return;
      case 'activity':
        if (record.status === 'researching') record.progress = event.text;
        return;
      case 'briefSubmitted':
        if (record.status !== 'researching') return;
        record.status = 'briefed';
        record.brief = event.brief;
        this.end(record);
        this.ctx.outbox.effect({ type: 'saveBrief', elderId: record.id, brief: event.brief });
        return;
      case 'error':
        this.fail(event.message);
        return;
    }
  }

  private fail(message: string): void {
    const record = this.ctx.state.elder;
    if (record?.status !== 'researching') return;
    record.status = 'failed';
    record.error = message;
    this.end(record);
  }

  private end(record: ElderRecord): void {
    record.progress = null;
    record.endedAt = this.ctx.t;
    this.ctx.outbox.effect({ type: 'closeElder', elderId: record.id });
  }
}
