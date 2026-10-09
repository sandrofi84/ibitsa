import type {
  AgentDefinition,
  Options,
  PermissionResult,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  CodePointer,
  CouncilReport,
  Effort,
  ResearchBrief,
  SittingMessage,
} from '@ibitsa/protocol';
import { briefMarkdown } from '@ibitsa/runtime';
import type { Chamber } from './chambers-session.types';
import type { ToolReply } from './elder-session.types';
import {
  answeredText,
  READ_TOOLS,
  RoundTableSession,
  reply,
  seat,
  TOOL,
  toldText,
} from './round-table-session';

const REPORT = TOOL('report');
/** The tool that starts a subagent; `Task` is its older name. */
const AGENT_TOOLS = ['Agent', 'Task'];
/** A chamber's steps by effort: what holds each councillor to its share (spec §4.2). */
export const CHAMBER_TURNS: Record<Effort, number> = { light: 8, standard: 15, deep: 25 };
/** The deeper pass on a serious concern (Deep only) runs on Opus with its own small step budget. */
const DEEP_PASS = { model: 'opus', maxTurns: 12 };
const SUFFIX = '-deep';

/** Appended to Claude Code's system prompt; the same for every chambers sitting, so it caches. */
export const CHAMBERS_INSTRUCTIONS = `You are the elder of Ibitsa's council, chairing a sitting in separate chambers to plan a task with the user before anyone writes code. Each councillor is a subagent with its own briefing; you dispatch them with the Agent tool, using the councillor's id as subagent_type. You only read: never edit files or run commands.

Work in this order:
1. Dispatch every councillor on the roster, in parallel where you can, with a short request naming the task. Each files its own report from its chamber with the report tool; you never file reports yourself. A councillor with nothing to add bows out in one line.
2. Read their reports (the Agent tool returns each one). For a councillor at Deep effort whose report has a serious concern, you may dispatch <id>-deep for a deeper pass on that concern; it files a further report for the same councillor.
3. Put the questions that matter to the user with ask_user, in one batch where you can: each names the councillor whose question it is (from their report), offers options with their trade-offs, recommends one with a reason, and allows free text when useful. When ask_user accepts the batch, end your turn: the answers arrive as a message.
4. While you wait, the user may ask a councillor "Why?", or write to the council. Answer in that councillor's voice with say, from its report; if the report doesn't cover it, dispatch the councillor again with the question. Then end your turn.
5. When every councillor has reported and the answers are in, call propose_plan with the plan, its islands and branching, and the decisions taken. If it is accepted, end your turn. On changes, dispatch again only the councillors the change affects (with the change in your request); they report again, then propose again.

Speak to the user only through say and ask_user; anything else you write is not shown. If a tool rejects a call, fix what it says and call it again. Only the user can end the sitting, with Dismiss the council in the council's pane: you can't. If the user asks you to stop, end or dismiss the council, tell them to use that button, and never say the council is dismissed.`;

/**
 * Separate chambers (spec §4.3, #105): the elder chairs one session and each councillor runs as an
 * SDK subagent with its own briefing (its skill's planning guidance, its slice of the brief, the shared
 * findings and the file map), model and step budget. A report is filed under the councillor whose
 * chamber called the tool, as the SDK names it in the hook (`agent_type`), not as the model claims.
 * Everything else (core's verdicts, questions, "Why?", plans) works as at the round table.
 */
export class ChambersSession extends RoundTableSession {
  /** Which subagent made each council tool call, by tool-use id; absent for the elder's own calls. */
  private readonly callers = new Map<string, string>();

  /** Every councillor the workspace has gets a chamber, so one added mid-sitting can be dispatched. */
  chambers(): Chamber[] {
    const { start } = this.init;
    const seated = new Map(start.roster.map((c) => [c.councillorId, c]));
    const ids = new Set([
      ...start.roster.map((c) => c.councillorId),
      ...this.skills()
        .list()
        .map((c) => c.id),
    ]);
    return [...ids].flatMap((councillorId) => {
      const entry = seated.get(councillorId);
      const effort = entry?.effort ?? 'standard';
      const guidance = this.guidance(councillorId);
      const prompt = chamberPrompt({
        councillorId,
        guidance,
        brief: start.brief,
        steps: CHAMBER_TURNS[effort],
      });
      const chamber: Chamber = {
        name: councillorId,
        councillorId,
        effort,
        model: entry?.model ?? start.model,
        maxTurns: CHAMBER_TURNS[effort],
        prompt,
      };
      if (effort !== 'deep') return [chamber];
      const deep: Chamber = {
        ...chamber,
        name: `${councillorId}${SUFFIX}`,
        ...DEEP_PASS,
        prompt: `${chamberPrompt({ councillorId, guidance, brief: start.brief, steps: DEEP_PASS.maxTurns })}\n\nYou are ${councillorId}'s deeper pass: the elder names one serious concern in its request. Look into that concern only, thoroughly, and file a report for ${councillorId}.`,
      };
      return [chamber, deep];
    });
  }

  protected override async report(
    input: { councillorId: string; bowOut?: string | undefined } & Omit<CouncilReport, 'bowOut'>,
    callId?: string,
  ): Promise<ToolReply> {
    // The call's own id (from Claude Code's metadata) says which chamber made it, even when several
    // chambers report at once; without one, the oldest call the hook saw.
    const toolUseId = callId ?? this.toolUseIds.get(REPORT)?.[0];
    const caller = toolUseId === undefined ? undefined : this.callers.get(toolUseId);
    const councillorId = caller?.endsWith(SUFFIX) ? caller.slice(0, -SUFFIX.length) : caller;
    const refuse = (text: string): ToolReply => {
      this.claim({ tool: 'report', callId: toolUseId });
      return { ...reply(`Not accepted: ${text}`), isError: true };
    };
    if (!councillorId) {
      return refuse(
        `councillors file their own reports from their chambers: dispatch ${input.councillorId} with the Agent tool.`,
      );
    }
    if (input.councillorId !== councillorId) {
      return refuse(`this is ${councillorId}'s chamber; file the report as ${councillorId}.`);
    }
    return super.report(input, toolUseId);
  }

  protected override noteToolUse(input: PreToolUseHookInput): void {
    if (input.agent_id !== undefined && input.agent_type !== undefined) {
      this.callers.set(input.tool_use_id, input.agent_type);
    }
    super.noteToolUse(input);
  }

  protected override opening(): string {
    const { start } = this.init;
    const roster = start.roster
      .map((c) => {
        const title = this.seats.find((s) => s.id === c.councillorId)?.title ?? c.councillorId;
        const deep = c.effort === 'deep' ? ` (deeper pass: ${c.councillorId}${SUFFIX})` : '';
        return `- ${c.councillorId} (${title}), ${c.effort} effort${deep}`;
      })
      .join('\n');
    return [
      `Plan this task with the user.\n\nTask:\n${start.task}`,
      start.brief
        ? `The elder's research brief (each councillor has its own slice of it):\n\n${briefMarkdown(start.brief)}`
        : 'There is no research brief: the councillors read what they need.',
      `The roster (dispatch every one; each must report before you propose a plan):\n${roster}`,
      `The sitting's budget is $${(start.maxBudgetMicroUsd / 1_000_000).toFixed(2)}, shared by every chamber and you: keep requests short.`,
    ].join('\n\n---\n\n');
  }

  protected override wording(message: SittingMessage): string {
    switch (message.kind) {
      case 'changeRequested':
        return `The user asked for changes to plan v${message.version}:\n${message.text}\n\nDispatch again only the councillors this change affects, with the change in your request; they report again. Then call propose_plan again.`;
      case 'councillorAdded':
        this.seats.push(seat({ skills: this.skills(), councillorId: message.councillorId }));
        return `The user added ${message.councillorId} to the council at ${message.effort} effort. Dispatch it (subagent_type ${message.councillorId}); it must report before the next plan.`;
      case 'why': {
        const followUp =
          message.text && message.text !== 'Why?' ? `\nThey added: ${message.text}` : '';
        return `The user asked ${message.councillorId} "Why?" about: "${message.question}" (questionId ${message.questionId}).${followUp}\n\nAnswer in ${message.councillorId}'s voice with say, using that questionId, from its report; if the report doesn't cover it, dispatch ${message.councillorId} again with the question first. Then end your turn: the questions are still open.`;
      }
      case 'told':
        return toldText(message);
      case 'answered':
        return answeredText(message.answers);
    }
  }

  protected override options(ibitsa: NonNullable<Options['mcpServers']>[string]): Options {
    const base = super.options(ibitsa);
    const chambers = this.chambers();
    const names = new Set(chambers.map((c) => c.name));
    const agents: Record<string, AgentDefinition> = Object.fromEntries(
      chambers.map((c) => [
        c.name,
        {
          description: `${c.councillorId}'s chamber: files ${c.councillorId}'s report for the council.`,
          prompt: c.prompt,
          tools: [...READ_TOOLS, REPORT],
          model: c.model,
          maxTurns: c.maxTurns,
        },
      ]),
    );
    return {
      ...base,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: CHAMBERS_INSTRUCTIONS },
      tools: [...READ_TOOLS, ...AGENT_TOOLS],
      agents,
      // Only the council's own chambers may be dispatched; everything else stays denied.
      canUseTool: async (toolName, input): Promise<PermissionResult> => {
        const type = (input as { subagent_type?: unknown }).subagent_type;
        return AGENT_TOOLS.includes(toolName) && typeof type === 'string' && names.has(type)
          ? { behavior: 'allow', updatedInput: input }
          : {
              behavior: 'deny',
              message: 'The council only reads the code and dispatches its own chambers.',
            };
      },
    };
  }

  private guidance(councillorId: string): string {
    return (
      this.skills().planning(councillorId)?.guidance ??
      '(No skill file found: plan from your name.)'
    );
  }
}

/** A chamber's briefing: who it is, its slice of the brief, what everyone knows, and how to report. */
export function chamberPrompt({
  councillorId,
  guidance,
  brief,
  steps,
}: {
  councillorId: string;
  guidance: string;
  brief: ResearchBrief | null;
  /** The chamber's turn limit (`maxTurns`): it is told, so it reports before running out. */
  steps: number;
}): string {
  const slice = brief?.slices.find((s) => s.councillorId === councillorId);
  const pointer = (p: CodePointer) => `- ${p.path}${p.lines ? `:${p.lines}` : ''}: ${p.note}`;
  const parts = [
    `You are ${councillorId}, one of Ibitsa's councillors, studying a task alone in your chamber. You only read: never edit files or run commands.\n\n${guidance}`,
    slice
      ? `Your slice of the elder's brief:\n${slice.summary}${slice.pointers.length > 0 ? `\n${slice.pointers.map(pointer).join('\n')}` : ''}`
      : brief
        ? 'The elder gave you no slice: read what your field needs, briefly.'
        : 'There is no research brief: read what your field needs, briefly.',
    ...(brief && brief.findings.length > 0
      ? [`What every councillor knows:\n${brief.findings.map((f) => `- ${f}`).join('\n')}`]
      : []),
    ...(brief && brief.files.length > 0
      ? [`The file map:\n${brief.files.map(pointer).join('\n')}`]
      : []),
    `When you're done, call the report tool once with councillorId "${councillorId}": your concerns (severity and reason), the questions you want put to the user, your recommendations, and what you didn't check. If nothing in this task touches your field, file a bow-out saying why in one line.`,
    `You have at most ${steps} steps (each tool call is one), and nothing you find counts until you report it. Read what your slice points to first and beyond it only when you must. Call the report tool by step ${Math.max(1, steps - 2)} at the latest: if you run short, report what you have and list the rest under what you didn't check. Read opens files only; to see what's in a folder, use Glob.`,
  ];
  return parts.join('\n\n');
}
