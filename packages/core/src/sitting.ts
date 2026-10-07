import type {
  Command,
  CouncilAnswer,
  CouncilEvent,
  CouncilQuestion,
  DialogueLine,
  Plan,
  SittingMessage,
  SittingStatus,
  SittingTally,
  SittingView,
} from '@ibitsa/protocol';
import { checkPlan } from '@ibitsa/protocol';
import { Consultation } from './consultation';
import type { Effect } from './effects.types';
import { Quest } from './quest';
import { newId } from './state';
import type { CoreState, QuestionBatch, SittingRecord } from './state.types';
import type { StepContext } from './step.types';

const ENDED: readonly SittingStatus[] = ['approved', 'dismissed', 'failed'];

/**
 * The council's sitting (spec §4.2–4.6): who is at the table, their reports, the questions put to the
 * user and the plans proposed. Round table and separate chambers share these rules; only the adapter
 * differs. The rules are enforced here, not left to the model: the roster is fixed at convening, every
 * question names a councillor on it, and no plan is accepted until every councillor has reported.
 */
export class Sitting {
  private readonly ctx: StepContext;

  constructor(ctx: StepContext) {
    this.ctx = ctx;
  }

  /** The plan the user last approved, in this campaign's sittings; none for a quick quest. */
  static approvedPlan(state: CoreState): Plan | undefined {
    const sittings = [...state.pastSittings, ...(state.sitting ? [state.sitting] : [])];
    return sittings
      .flatMap((s) => s.plans)
      .filter((p) => p.outcome.kind === 'approved')
      .at(-1)?.plan;
  }

  static active(record: SittingRecord | null): record is SittingRecord {
    return record !== null && !ENDED.includes(record.status);
  }

  static view(record: SittingRecord): SittingView {
    const pending = Sitting.active(record) ? pendingBatch(record) : undefined;
    return {
      id: record.id,
      task: record.task,
      mode: record.mode,
      status: record.status,
      effort: record.effort,
      roster: record.roster.map(({ councillorId, effort }) => ({
        councillorId,
        effort,
        reported: record.reports.some((r) => r.councillorId === councillorId),
      })),
      reports: record.reports,
      questions: pending ? { batchId: pending.id, items: pending.items } : null,
      plans: record.plans,
      revision: record.revision,
      reconsultations: record.reconsultations,
      dialogue: record.dialogue,
      gold: record.gold,
      error: record.error,
      rating: record.rating,
      comparisonOf: record.comparisonOf,
      consultations: record.consultations ?? [],
    };
  }

  // ---------- the user's commands ----------

  convene(command: Extract<Command, { type: 'conveneCouncil' }>): void {
    const state = this.ctx.state;
    const problem = conveneProblem({ state, command });
    if (problem) {
      this.ctx.outbox.reject(command.commandId, problem);
      return;
    }
    const sittingId = newId(state, 's');
    // The sitting belongs to a planning campaign: the elder's, or a new one when convened directly,
    // named after the sitting so the counter (and every recorded id after it) stays as it was.
    if (state.campaign?.status !== 'planning') {
      state.campaign = {
        id: `c-${sittingId}`,
        title: Quest.title(command.task),
        status: 'planning',
        autoApprove: false,
        branching: 'separate',
        stackedStart: null,
        baseRef: null,
      };
    }
    const efforts = command.councillorEfforts ?? {};
    const roster = command.roster.map((councillorId) => ({
      councillorId,
      effort: efforts[councillorId] ?? command.effort,
    }));
    if (state.sitting) state.pastSittings.push(state.sitting);
    const brief = state.elder?.status === 'briefed' ? state.elder.brief : null;
    state.sitting = {
      id: sittingId,
      task: command.task,
      mode: command.mode,
      status: 'convening',
      effort: command.effort,
      roster,
      sessionId: null,
      reports: [],
      batches: [],
      plans: [],
      revision: 0,
      reconsultations: [],
      dialogue: [],
      gold: { kind: 'unknown' },
      error: null,
      startedAt: this.ctx.t,
      endedAt: null,
      councilVersion: null,
      comparisonOf: command.comparisonOf ?? null,
      rating: null,
      usage: { byModel: [], byCouncillor: [] },
      elderPicks: brief && {
        effort: brief.effort.level,
        councillors: brief.councillors.map(({ councillorId }) => ({
          councillorId,
          effort:
            brief.councillorEfforts.find((e) => e.councillorId === councillorId)?.level ?? null,
        })),
      },
    };
    this.ctx.outbox.effect({
      type: 'startSitting',
      sittingId,
      mode: command.mode,
      task: command.task,
      effort: command.effort,
      roster,
      brief,
    });
  }

  /**
   * VS Code reloaded: the lead session is gone (spec §12). Reports and questions so far are kept, and
   * the session resumes (#166): at once if the council was deliberating, else when the user next acts.
   * A sitting whose session never started starts again. Returns whether it resumed now.
   */
  restarted(): boolean {
    const record = this.ctx.state.sitting;
    if (!Sitting.active(record)) return false;
    if (!record.sessionId) {
      this.ctx.outbox.effect(startOf({ state: this.ctx.state, record }));
      return true;
    }
    record.dormant = true;
    if (record.status !== 'deliberating' || pendingBatch(record)) return false;
    this.wake({ record, prompt: RESUME_PROMPT });
    return true;
  }

  /** Ends an active sitting as failed, e.g. when its campaign is abandoned. */
  stop(reason: string): void {
    const record = this.ctx.state.sitting;
    if (!Sitting.active(record)) return;
    record.error = reason;
    this.end({ record, status: 'failed' });
  }

  addCouncillor(command: Extract<Command, { type: 'addCouncillor' }>): void {
    const record = this.current(command.commandId);
    if (!record) return;
    const problem =
      record.status === 'awaitingApproval'
        ? 'A plan is waiting: ask for changes to add a councillor.'
        : onRoster(record, command.councillorId)
          ? `${command.councillorId} is already on the roster.`
          : undefined;
    if (problem) {
      this.ctx.outbox.reject(command.commandId, problem);
      return;
    }
    record.roster.push({ councillorId: command.councillorId, effort: command.effort });
    this.message({
      record,
      message: {
        kind: 'councillorAdded',
        councillorId: command.councillorId,
        effort: command.effort,
      },
    });
  }

  answer(command: Extract<Command, { type: 'answerCouncil' }>): void {
    const record = this.current(command.commandId);
    if (!record) return;
    const batch = pendingBatch(record);
    if (batch?.id !== command.batchId) {
      this.ctx.outbox.reject(command.commandId, 'Those questions are no longer open.');
      return;
    }
    const answers: CouncilAnswer[] = [];
    for (const item of batch.items) {
      const answer = command.answers[item.id];
      const problem = answer
        ? answerProblem({ item, answer })
        : `"${item.question}" has no answer.`;
      if (problem) {
        this.ctx.outbox.reject(command.commandId, problem);
        return;
      }
      if (answer) answers.push(answer);
    }
    batch.answers = answers;
    if (record.dormant) {
      // Asked before the reload: the resumed session lost that tool call, so the answers go as words.
      this.message({
        record,
        message: {
          kind: 'answered',
          answers: batch.items.map((item, k) => ({
            question: item.question,
            answer: wordsOf({ item, answer: answers[k] }),
          })),
        },
      });
      return;
    }
    this.ctx.outbox.effect({
      type: 'answerSittingQuestions',
      sittingId: record.id,
      toolUseId: batch.toolUseId,
      answers: batch.answers,
    });
  }

  /** "Why?" on a waiting question (§4.4): asks its councillor to explain, through the lead session. */
  why(command: Extract<Command, { type: 'askCouncilWhy' }>): void {
    const record = this.current(command.commandId);
    if (!record) return;
    const batch = pendingBatch(record);
    const item =
      batch && batch.id === command.batchId
        ? batch.items.find((q) => q.id === command.questionId)
        : undefined;
    if (!item) {
      this.ctx.outbox.reject(command.commandId, 'That question is no longer open.');
      return;
    }
    addLine({
      record,
      line: { speaker: YOU, text: command.text ?? 'Why?', questionId: item.id },
    });
    this.message({
      record,
      message: {
        kind: 'why',
        questionId: item.id,
        councillorId: item.councillorId,
        question: item.question,
        ...(command.text !== undefined && { text: command.text }),
      },
    });
  }

  approve(command: Extract<Command, { type: 'approvePlan' }>): void {
    const plan = this.waitingPlan(command);
    if (!plan) return;
    plan.entry.outcome = { kind: 'approved' };
    this.end({ record: plan.record, status: 'approved' });
    this.ctx.outbox.effect({
      type: 'savePlan',
      sittingId: plan.record.id,
      version: plan.entry.version,
      plan: plan.entry.plan,
    });
  }

  requestChange(command: Extract<Command, { type: 'requestPlanChange' }>): void {
    const plan = this.waitingPlan(command);
    if (!plan) return;
    plan.entry.outcome = { kind: 'changeRequested', text: command.text };
    plan.record.revision++;
    plan.record.status = 'deliberating';
    this.message({
      record: plan.record,
      message: { kind: 'changeRequested', version: command.version, text: command.text },
    });
  }

  dismiss(commandId: string): void {
    const record = this.current(commandId);
    if (!record) return;
    const last = record.plans.at(-1);
    if (last?.outcome.kind === 'proposed') last.outcome = { kind: 'dismissed' };
    this.end({ record, status: 'dismissed' });
  }

  /** "How useful was the council?" (§4.10): only for a sitting that has ended with a plan or a dismissal. */
  rate(command: Extract<Command, { type: 'rateSitting' }>): void {
    const record = this.ctx.state.sitting;
    if (
      record?.id !== command.sittingId ||
      (record.status !== 'approved' && record.status !== 'dismissed')
    ) {
      this.ctx.outbox.reject(command.commandId, 'Only a sitting that has ended can be rated.');
      return;
    }
    record.rating =
      command.note === undefined
        ? { score: command.score }
        : { score: command.score, note: command.note };
  }

  /** The runtime noted the council version as the session started (§4.10). */
  versionNoted({ sittingId, version }: { sittingId: string; version: string }): void {
    const record = this.ctx.state.sitting;
    if (record?.id === sittingId) record.councilVersion = version;
  }

  /** What a sitting cost and produced (§4.10, #106). */
  static tally(record: SittingRecord): SittingTally {
    const reports = record.reports.map((r) => r.report);
    const concerns = reports.flatMap((r) => r.concerns);
    const plan = record.plans.at(-1)?.plan;
    const picks = record.elderPicks;
    const roster = record.roster.map(({ councillorId, effort }) => {
      const pick = picks?.councillors.find((c) => c.councillorId === councillorId);
      return {
        councillorId,
        effort,
        elderEffort: pick?.effort ?? null,
        recommended: pick !== undefined,
      };
    });
    const changedElderPicks =
      picks === null
        ? null
        : roster.length !== picks.councillors.length ||
          roster.some((c) => !c.recommended) ||
          (record.mode === 'roundTable'
            ? record.effort !== picks.effort
            : roster.some((c) => c.elderEffort !== null && c.elderEffort !== c.effort));
    return {
      sittingId: record.id,
      mode: record.mode,
      councilVersion: record.councilVersion,
      comparisonOf: record.comparisonOf,
      outcome: record.status,
      startedAt: record.startedAt,
      durationMs: record.endedAt === null ? null : record.endedAt - record.startedAt,
      cost: {
        totalMicroUsd: record.gold.kind === 'unknown' ? null : record.gold.value,
        byModel: record.usage.byModel,
        byCouncillor: record.usage.byCouncillor,
      },
      effort: record.effort,
      elderEffort: picks?.effort ?? null,
      roster,
      changedElderPicks,
      reports: reports.length,
      bowOuts: reports.filter((r) => r.bowOut !== undefined).length,
      concerns: concerns.length,
      seriousConcerns: concerns.filter((c) => c.severity === 'serious' || c.severity === 'high')
        .length,
      questionsAsked: record.batches.reduce((n, b) => n + b.items.length, 0),
      whys: record.dialogue.filter((d) => d.speaker === YOU).length,
      revisions: record.revision,
      reconsultations: record.reconsultations.length,
      plansProposed: record.plans.length,
      planTasks: plan?.tasks.length ?? 0,
      planDecisions: plan?.decisions.length ?? 0,
      planCriteria:
        plan?.tasks.reduce((n, t) => n + t.criteria.reduce((m, c) => m + c.items.length, 0), 0) ??
        0,
      rating: record.rating,
    };
  }

  // ---------- the lead session's output ----------

  handle({ sittingId, event }: { sittingId: string; event: CouncilEvent }): void {
    const record = this.ctx.state.sitting;
    if (record?.id !== sittingId) return;
    // Once its plan is approved the council speaks only when asked mid-campaign (#169).
    if (record.status === 'approved') {
      new Consultation(this.ctx).handle({ record, event });
      return;
    }
    if (!Sitting.active(record)) {
      if ('toolUseId' in event)
        this.complete({ record, toolUseId: event.toolUseId, reason: 'The sitting has ended.' });
      return;
    }
    switch (event.type) {
      case 'sessionStarted':
        record.sessionId = event.sessionId;
        if (record.status === 'convening') record.status = 'deliberating';
        return;
      case 'usage':
        record.gold = { kind: 'exact', value: event.totalCost };
        if (event.byModel) record.usage.byModel = event.byModel;
        if (event.byCouncillor) record.usage.byCouncillor = event.byCouncillor;
        return;
      case 'error':
        record.error = event.message;
        this.end({ record, status: 'failed' });
        return;
      case 'reportFiled':
        this.fileReport({ record, event });
        return;
      case 'questionsAsked':
        this.ask({ record, event });
        return;
      case 'planProposed':
        this.propose({ record, event });
        return;
      case 'said':
        // Only those at the table speak; anything else is dropped (there's no tool call to refuse).
        if (event.councillorId !== ELDER && !onRoster(record, event.councillorId)) return;
        addLine({
          record,
          line: {
            speaker: event.councillorId,
            text: event.text,
            ...(event.questionId !== undefined && { questionId: event.questionId }),
          },
        });
        return;
    }
  }

  private fileReport({
    record,
    event,
  }: {
    record: SittingRecord;
    event: Extract<CouncilEvent, { type: 'reportFiled' }>;
  }): void {
    const { councillorId, toolUseId } = event;
    if (!onRoster(record, councillorId)) {
      this.complete({
        record,
        toolUseId,
        reason: `${councillorId} isn't on the council's roster.`,
      });
      return;
    }
    const id = newId(this.ctx.state, 'r');
    const reportedBefore = record.reports.some(
      (r) => r.councillorId === councillorId && r.revision < record.revision,
    );
    if (reportedBefore) {
      record.reconsultations.push({ councillorId, revision: record.revision, reportId: id });
    }
    record.reports.push({ id, councillorId, revision: record.revision, report: event.report });
    this.complete({ record, toolUseId });
  }

  private ask({
    record,
    event,
  }: {
    record: SittingRecord;
    event: Extract<CouncilEvent, { type: 'questionsAsked' }>;
  }): void {
    const { toolUseId } = event;
    const problem = pendingBatch(record)
      ? 'Wait for the answers to the open questions first.'
      : event.questions.length === 0
        ? 'Ask at least one question.'
        : event.questions.map((q) => questionProblem({ record, question: q })).find(Boolean);
    if (problem) {
      this.complete({ record, toolUseId, reason: problem });
      return;
    }
    const batch: QuestionBatch = {
      id: newId(this.ctx.state, 'b'),
      toolUseId,
      items: event.questions.map((q) => ({ ...q, id: newId(this.ctx.state, 'q') })),
      answers: null,
    };
    record.batches.push(batch);
    // Accepted: the session ends its turn and hears the answers later, so it can answer "Why?" meanwhile.
    this.complete({ record, toolUseId });
  }

  private propose({
    record,
    event,
  }: {
    record: SittingRecord;
    event: Extract<CouncilEvent, { type: 'planProposed' }>;
  }): void {
    const { toolUseId } = event;
    if (record.status === 'awaitingApproval') {
      this.complete({ record, toolUseId, reason: 'A plan is already waiting for the user.' });
      return;
    }
    const roster = record.roster.map((c) => c.councillorId);
    const missing = roster.filter((id) => !record.reports.some((r) => r.councillorId === id));
    if (missing.length > 0) {
      this.complete({
        record,
        toolUseId,
        reason: `Every councillor must report before a plan is proposed. Waiting for: ${missing.join(', ')}.`,
      });
      return;
    }
    const checked = checkPlan({ input: event.plan, roster });
    if (!checked.ok) {
      this.complete({
        record,
        toolUseId,
        reason: `The plan has problems:\n- ${checked.problems.join('\n- ')}`,
      });
      return;
    }
    record.plans.push({
      version: record.plans.length + 1,
      plan: checked.plan,
      outcome: { kind: 'proposed' },
    });
    record.status = 'awaitingApproval';
    this.complete({ record, toolUseId });
  }

  // ---------- helpers ----------

  /** The active sitting, or a rejection naming why there's none. */
  private current(commandId: string): SittingRecord | undefined {
    const record = this.ctx.state.sitting;
    if (Sitting.active(record)) return record;
    this.ctx.outbox.reject(commandId, 'The council is not sitting.');
    return undefined;
  }

  private waitingPlan({
    commandId,
    version,
  }: {
    commandId: string;
    version: number;
  }): { record: SittingRecord; entry: SittingRecord['plans'][number] } | undefined {
    const record = this.current(commandId);
    if (!record) return undefined;
    const entry = record.plans.at(-1);
    if (record.status !== 'awaitingApproval' || !entry) {
      this.ctx.outbox.reject(commandId, 'No plan is waiting for approval.');
      return undefined;
    }
    if (entry.version !== version) {
      this.ctx.outbox.reject(
        commandId,
        `Plan v${version} is not the current plan (v${entry.version}).`,
      );
      return undefined;
    }
    return { record, entry };
  }

  private end({ record, status }: { record: SittingRecord; status: SittingStatus }): void {
    record.status = status;
    record.endedAt = this.ctx.t;
    this.ctx.outbox.effect({ type: 'closeSitting', sittingId: record.id });
  }

  private message({ record, message }: { record: SittingRecord; message: SittingMessage }): void {
    if (record.dormant) this.wake({ record });
    this.ctx.outbox.effect({ type: 'sittingMessage', sittingId: record.id, message });
  }

  /** Resume a dormant sitting's lead session (#166); `prompt` gets it going without the user. */
  private wake({ record, prompt }: { record: SittingRecord; prompt?: string }): void {
    record.dormant = false;
    const sessionId = record.sessionId;
    if (!sessionId) return;
    this.ctx.outbox.effect({
      ...startOf({ state: this.ctx.state, record }),
      resume: prompt === undefined ? { sessionId } : { sessionId, prompt },
    });
  }

  private complete({
    record,
    toolUseId,
    reason,
  }: {
    record: SittingRecord;
    toolUseId: string;
    reason?: string;
  }): void {
    this.ctx.outbox.effect({
      type: 'completeSittingTool',
      sittingId: record.id,
      toolUseId,
      accepted: reason === undefined,
      ...(reason !== undefined && { reason }),
    });
  }
}

/** What a sitting that was deliberating hears when its session resumes after a reload (#166). */
const RESUME_PROMPT =
  'VS Code reloaded and your session was resumed. Carry on where you left off: any reports still missing, then your questions or the plan.';

/** The effect that starts a sitting's lead session, from its record. */
function startOf({
  state,
  record,
}: {
  state: CoreState;
  record: SittingRecord;
}): Extract<Effect, { type: 'startSitting' }> {
  return {
    type: 'startSitting',
    sittingId: record.id,
    mode: record.mode,
    task: record.task,
    effort: record.effort,
    roster: record.roster,
    brief: state.elder?.status === 'briefed' ? state.elder.brief : null,
  };
}

/** An answer in words: the option's label, or what the user wrote. */
function wordsOf({
  item,
  answer,
}: {
  item: QuestionBatch['items'][number];
  answer: CouncilAnswer | undefined;
}): string {
  if (!answer) return '(no answer)';
  if ('text' in answer) return answer.text;
  return item.options.find((o) => o.id === answer.optionId)?.label ?? answer.optionId;
}

/** The elder chairs every sitting without being on the roster. */
const ELDER = 'elder';
/** The user's lines in the dialogue. */
const YOU = 'you';

function addLine({
  record,
  line,
}: {
  record: SittingRecord;
  line: Omit<DialogueLine, 'id'>;
}): void {
  record.dialogue.push({ id: `d${record.dialogue.length + 1}`, ...line });
}

function onRoster(record: SittingRecord, councillorId: string): boolean {
  return record.roster.some((c) => c.councillorId === councillorId);
}

/** Why core refuses to convene, or undefined if it can (spec §4.2). */
function conveneProblem({
  state,
  command,
}: {
  state: CoreState;
  command: Extract<Command, { type: 'conveneCouncil' }>;
}): string | undefined {
  if (Sitting.active(state.sitting)) return 'The council is already sitting.';
  if (state.campaign?.status === 'active') return 'Finish or abandon the current quest first.';
  if (state.elder?.status === 'researching') return 'The elder is still researching.';
  const { roster, mode } = command;
  const efforts = command.councillorEfforts ?? {};
  const twice = roster.find((id, i) => roster.indexOf(id) !== i);
  if (twice) return `${twice} is on the roster twice.`;
  const stranger = Object.keys(efforts).find((id) => !roster.includes(id));
  if (stranger) return `${stranger} has an effort but isn't on the roster.`;
  const missing = mode === 'chambers' ? roster.filter((id) => efforts[id] === undefined) : [];
  if (missing.length > 0) return `Set an effort for ${missing.join(', ')}.`;
  return undefined;
}

/** Why one answer doesn't fit its question, or undefined if it does (spec §4.4). */
function answerProblem({
  item,
  answer,
}: {
  item: CouncilQuestion;
  answer: CouncilAnswer;
}): string | undefined {
  if ('optionId' in answer && !item.options.some((o) => o.id === answer.optionId)) {
    return `"${item.question}" has no option ${answer.optionId}.`;
  }
  if ('text' in answer && !item.allowFreeText)
    return `"${item.question}" needs one of its options.`;
  return undefined;
}

function pendingBatch(record: SittingRecord): QuestionBatch | undefined {
  const last = record.batches.at(-1);
  return last && last.answers === null ? last : undefined;
}

/** Why core refuses one `ask_user` question, or undefined if it's fine (spec §4.4). */
function questionProblem({
  record,
  question,
}: {
  record: SittingRecord;
  question: CouncilQuestion;
}): string | undefined {
  const { councillorId, reportId, options, recommendation } = question;
  if (!onRoster(record, councillorId)) return `${councillorId} isn't on the council's roster.`;
  if (reportId !== undefined) {
    const report = record.reports.find((r) => r.id === reportId);
    if (report?.councillorId !== councillorId)
      return `${reportId} is not a report by ${councillorId}.`;
  }
  if (options.length === 0 && !question.allowFreeText) {
    return `"${question.question}" needs options or free text.`;
  }
  if (recommendation && !options.some((o) => o.id === recommendation.optionId)) {
    return `"${question.question}" recommends ${recommendation.optionId}, which isn't one of its options.`;
  }
  return undefined;
}
