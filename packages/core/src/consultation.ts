import type { Command, CouncilEvent } from '@ibitsa/protocol';
import { Hero } from './hero';
import { NeedsYou } from './needs-you';
import { Outbox } from './outbox';
import { PlanAmendment } from './plan-amendment';
import { newId } from './state';
import type { ConsultationRecord, CoreState, Island, SittingRecord } from './state.types';
import type { StepContext } from './step.types';

/** The elder chairs every sitting and may always speak. */
const ELDER = 'elder';
/** The user's lines in the dialogue. */
const YOU = 'you';

/**
 * Talking to the council mid-campaign (spec §4.8, #169): a question resumes the approved sitting's lead
 * session for one turn, told the question and a compact status of the campaign that core builds (never
 * heroes' transcripts). Its replies are dialogue lines in councillors' voices; the turn's usage ends it
 * and counts toward the campaign's gold. One question at a time; heroes keep working.
 */
export class Consultation {
  private readonly ctx: StepContext;

  constructor(ctx: StepContext) {
    this.ctx = ctx;
  }

  /** What every question to the council has spent, for the campaign's gold. */
  static spenders(state: CoreState): ConsultationRecord[] {
    return [...state.pastSittings, ...(state.sitting ? [state.sitting] : [])].flatMap(
      (s) => s.consultations ?? [],
    );
  }

  /** The question waiting for its answer, if any. */
  static running(record: SittingRecord | null): ConsultationRecord | undefined {
    return record?.consultations?.find((c) => c.status === 'asking');
  }

  /**
   * The campaign as the council hears it: each island's tasks and PR, the blocking findings still
   * open, and what holds a hero up. Facts from core's state only, never heroes' transcripts.
   */
  static status(state: CoreState): string {
    const islands = state.islands.map((island) => {
      const pr = island.remote?.pullRequest;
      const head = `- ${island.name} (${island.branch})${pr ? `, PR #${pr.number} ${pr.state}` : ''}`;
      const tasks = island.taskPoints.map((tp) => {
        const findings = openFindings(tp).map((f) => `; blocking from ${f}`);
        return `  - ${tp.title}: ${tp.state}${findings.join('')}`;
      });
      return [head, ...tasks].join('\n');
    });
    const heroes = state.heroes.map((record) => {
      const view = new Hero({ record, ctx: readOnly(state) }).view();
      const why = 'reason' in view.state ? ` (${view.state.reason})` : '';
      return `- ${view.name} on ${islandName(state, record.islandId)}: ${view.state.kind}${why}`;
    });
    const waiting = state.needsYou.map((item) => item.kind);
    return [
      `Islands and tasks:\n${islands.join('\n') || '(none)'}`,
      `Heroes:\n${heroes.join('\n') || '(none)'}`,
      `Waiting on the user: ${waiting.length > 0 ? waiting.join(', ') : 'nothing'}`,
    ].join('\n\n');
  }

  /** What the resumed lead session is told: the question, who it's for, and the campaign's status. */
  static prompt({
    text,
    councillorId,
    status,
  }: {
    text: string;
    councillorId: string | null;
    status: string;
  }): string {
    const who = councillorId
      ? `The user asks ${councillorId}, who answers in its own voice (others may add a line if their concern is affected):`
      : 'The user asks the council (whoever it concerns answers, in their own voice):';
    return [
      'The plan is approved and the heroes are at work. Nothing you do here stops them.',
      `${who}\n${text}`,
      `Where the campaign stands:\n${status}`,
      "Answer with say, in the voice of each councillor who speaks; read the code if you must. In separate chambers you may dispatch a councillor's chamber with the question: ask it to answer in its final message, not with a report. Don't file reports, ask questions or propose a whole plan. If the plan should change, call propose_amendment with the change and say why: only work not started may change (rework is a new task), and the user approves it. Then end your turn.",
    ].join('\n\n---\n\n');
  }

  ask(command: Extract<Command, { type: 'consultCouncil' }>): void {
    const state = this.ctx.state;
    const record = state.sitting;
    const problem =
      state.campaign?.status !== 'active'
        ? 'The council can be asked once its plan is under way.'
        : record?.status !== 'approved' || !record.sessionId
          ? 'There is no council with an approved plan to ask.'
          : Consultation.running(record)
            ? 'The council is still answering the last question.'
            : command.councillorId !== undefined && !onRoster(record, command.councillorId)
              ? `${command.councillorId} isn't on this council.`
              : undefined;
    if (problem || !record?.sessionId) {
      this.ctx.outbox.reject(command.commandId, problem ?? 'There is no council to ask.');
      return;
    }
    const to = command.councillorId ? `@${command.councillorId} ` : '';
    this.resume({
      record,
      councillorId: command.councillorId ?? null,
      line: `${to}${command.text}`,
      prompt: Consultation.prompt({
        text: command.text,
        councillorId: command.councillorId ?? null,
        status: Consultation.status(state),
      }),
    });
  }

  /**
   * A turn of the council's own about something the user did, e.g. asking for changes to an amendment
   * (#170): like a question, one at a time and capped. Returns whether it started.
   */
  followUp({
    commandId,
    line,
    prompt,
  }: {
    commandId: string;
    line: string;
    prompt: string;
  }): boolean {
    const record = this.ctx.state.sitting;
    if (!record?.sessionId || record.status !== 'approved' || Consultation.running(record)) {
      this.ctx.outbox.reject(commandId, 'The council is still answering the last question.');
      return false;
    }
    this.resume({
      record,
      councillorId: null,
      line,
      prompt: `${prompt}\n\n---\n\nWhere the campaign stands:\n${Consultation.status(this.ctx.state)}`,
    });
    return true;
  }

  /** The lead session resumes for one turn, with the user's line in the dialogue. */
  private resume({
    record,
    councillorId,
    line,
    prompt,
  }: {
    record: SittingRecord;
    councillorId: string | null;
    line: string;
    prompt: string;
  }): void {
    const state = this.ctx.state;
    if (!record.sessionId) return;
    const consultation: ConsultationRecord = {
      id: newId(state, 'q'),
      councillorId,
      status: 'asking',
      error: null,
      gold: { kind: 'unknown' },
    };
    record.consultations = [...(record.consultations ?? []), consultation];
    addLine({ record, speaker: YOU, text: line });
    this.ctx.outbox.effect({
      type: 'startSitting',
      sittingId: record.id,
      mode: record.mode,
      task: record.task,
      effort: record.effort,
      roster: record.roster.map(({ councillorId, effort }) => ({ councillorId, effort })),
      brief: state.elder?.status === 'briefed' ? state.elder.brief : null,
      resume: { sessionId: record.sessionId, prompt },
      maxBudgetMicroUsd: state.settings.consultBudgetMicroUsd,
    });
  }

  /** The lead session's output while a question is open; an approved sitting hears nothing else. */
  handle({ record, event }: { record: SittingRecord; event: CouncilEvent }): void {
    const consultation = Consultation.running(record);
    if (!consultation) {
      if ('toolUseId' in event) this.refuse({ record, toolUseId: event.toolUseId });
      return;
    }
    switch (event.type) {
      case 'said':
        if (event.councillorId !== ELDER && !onRoster(record, event.councillorId)) return;
        addLine({ record, speaker: event.councillorId, text: event.text });
        return;
      case 'usage':
        // The turn is over: its cost is in, and the session can close.
        consultation.gold = { kind: 'exact', value: event.totalCost };
        consultation.status = 'answered';
        this.ctx.outbox.effect({ type: 'closeSitting', sittingId: record.id });
        return;
      case 'error':
        this.fail({ record, message: event.message });
        return;
      case 'sessionStarted':
        return;
      case 'amendmentProposed':
        new PlanAmendment(this.ctx).propose({ record, event });
        return;
      default:
        // Reports, questions and whole plans belong to planning.
        this.refuse({ record, toolUseId: event.toolUseId });
    }
  }

  /** VS Code reloaded or the campaign ended: an open question is dropped. */
  stop(message: string): void {
    const record = this.ctx.state.sitting;
    if (record && Consultation.running(record)) this.fail({ record, message });
  }

  private fail({ record, message }: { record: SittingRecord; message: string }): void {
    const consultation = Consultation.running(record);
    if (!consultation) return;
    consultation.status = 'failed';
    consultation.error = message;
    this.ctx.outbox.effect({ type: 'closeSitting', sittingId: record.id });
  }

  private refuse({ record, toolUseId }: { record: SittingRecord; toolUseId: string }): void {
    this.ctx.outbox.effect({
      type: 'completeSittingTool',
      sittingId: record.id,
      toolUseId,
      accepted: false,
      reason: 'The plan is approved and under way: answer the user with say.',
    });
  }
}

/** Each councillor's latest finding that still blocks a task, as "councillor: message". */
function openFindings(task: Island['taskPoints'][number]): string[] {
  const latest = new Map<string, NonNullable<typeof task.review>['reviews'][number]>();
  for (const r of task.review?.reviews ?? [])
    if (r.status === 'done') latest.set(r.councillorId, r);
  return [...latest.values()]
    .filter((r) => !r.waived && r.verdict?.verdict === 'changes')
    .flatMap((r) =>
      (r.verdict?.findings ?? [])
        .filter((f) => f.severity === 'blocking')
        .map((f) => `${r.councillorId}: ${f.message}`),
    );
}

function islandName(state: CoreState, islandId: string): string {
  return state.islands.find((i) => i.id === islandId)?.name ?? islandId;
}

/** A context for reading a hero's view only, as `view` builds one: nothing it emits is kept. */
function readOnly(state: CoreState): StepContext {
  const outbox = new Outbox();
  return { state, outbox, needsYou: new NeedsYou({ state, outbox }), t: 0 };
}

function onRoster(record: SittingRecord, councillorId: string): boolean {
  return record.roster.some((c) => c.councillorId === councillorId);
}

function addLine({
  record,
  speaker,
  text,
}: {
  record: SittingRecord;
  speaker: string;
  text: string;
}): void {
  record.dialogue.push({ id: `d${record.dialogue.length + 1}`, speaker, text });
}
