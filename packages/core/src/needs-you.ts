import type { AnswerCommand, NewItem } from './needs-you.types';
import type { Outbox } from './outbox';
import { newId } from './state';
import type { CoreState, PendingItem } from './state.types';

/** The single queue of things waiting for the user (spec §6.4). */
export class NeedsYou {
  private readonly state: CoreState;
  private readonly outbox: Outbox;

  constructor({ state, outbox }: { state: CoreState; outbox: Outbox }) {
    this.state = state;
    this.outbox = outbox;
  }

  /**
   * Adds an item and announces it. Permissions and questions are each their own request; every other
   * kind appears at most once per hero.
   */
  ask(item: NewItem): void {
    const repeatable = ['permission', 'question', 'revisitDecision', 'dispute'].includes(item.kind);
    if (
      !repeatable &&
      this.state.needsYou.some((i) => i.heroId === item.heroId && i.kind === item.kind)
    ) {
      return;
    }
    const id = newId(this.state, 'n');
    const { kind, ...rest } = item;
    this.state.needsYou.push({ kind, id, ...rest } as PendingItem);
    if (item.kind !== 'reply') this.outbox.cue({ type: 'needsYouAdded', itemId: id });
  }

  /** Is the hero waiting on a permission or a question? */
  isAsking(heroId: string): boolean {
    return this.state.needsYou.some(
      (i) => i.heroId === heroId && (i.kind === 'permission' || i.kind === 'question'),
    );
  }

  removeFor(heroId: string, kinds: PendingItem['kind'][]): void {
    this.state.needsYou = this.state.needsYou.filter(
      (i) => !(i.heroId === heroId && kinds.includes(i.kind)),
    );
  }

  /** Requests held by an agent process that no longer exists can't be answered. */
  dropRequests(): void {
    this.state.needsYou = this.state.needsYou.filter(
      (i) => i.kind !== 'permission' && i.kind !== 'question',
    );
  }

  clear(): void {
    this.state.needsYou = [];
  }

  /** Forwards an answer to the hero's session. Returns the hero it was for, or null if nothing was waiting. */
  /** Answers a permission or question; returns the hero, and any rules to allow for the quest (#62). */
  answer(command: AnswerCommand): { heroId: string; questRules: string[] } | null {
    const item = this.state.needsYou.find((i) => i.id === command.itemId);
    const expected = command.type === 'answerPermission' ? 'permission' : 'question';
    if (!item || item.kind !== expected) {
      this.outbox.reject(command.commandId, 'That request is no longer waiting.');
      return null;
    }
    const always = command.type === 'answerPermission' ? command.always : undefined;
    if (
      always &&
      item.kind === 'permission' &&
      (command.type !== 'answerPermission' ||
        command.decision !== 'allow' ||
        item.alwaysAllow.length === 0)
    ) {
      this.outbox.reject(command.commandId, 'This request can’t be always allowed.');
      return null;
    }
    if (always === 'project' && item.kind === 'permission' && item.questOnly) {
      // An ACP agent's rule (#200) would mean nothing to other heroes' sessions.
      this.outbox.reject(
        command.commandId,
        'This request can be always allowed for this quest only.',
      );
      return null;
    }
    this.state.needsYou = this.state.needsYou.filter((i) => i.id !== item.id);
    if (item.kind === 'permission' && command.type === 'answerPermission') {
      this.outbox.effect({
        type: 'answerPermission',
        heroId: item.heroId,
        requestId: item.requestId,
        decision: command.decision,
        ...(command.note === undefined ? {} : { note: command.note }),
        ...(always ? { always, rules: [...item.alwaysAllow] } : {}),
      });
      return { heroId: item.heroId, questRules: always === 'quest' ? [...item.alwaysAllow] : [] };
    } else if (item.kind === 'question' && command.type === 'answerQuestion') {
      this.outbox.effect({
        type: 'answerQuestion',
        heroId: item.heroId,
        requestId: item.requestId,
        answers: command.answers,
      });
    }
    return { heroId: item.heroId, questRules: [] };
  }
}

/**
 * How a permission request is shown: exact text from the tool input, never paraphrased (spec §11.2.1).
 * Tools we don't recognize fall back to their raw input so nothing is hidden.
 */
export function describePermission(
  tool: string,
  input: unknown,
): { action: string; target: string } {
  const field = (name: string): string | undefined => {
    const value = (input as Record<string, unknown> | null)?.[name];
    return typeof value === 'string' ? value : undefined;
  };
  const known: Record<string, [string, string]> = {
    Bash: ['Run command', 'command'],
    Edit: ['Edit file', 'file_path'],
    MultiEdit: ['Edit file', 'file_path'],
    Write: ['Write file', 'file_path'],
    NotebookEdit: ['Edit notebook', 'notebook_path'],
    WebFetch: ['Fetch URL', 'url'],
    WebSearch: ['Search the web', 'query'],
    // A new domain asked for under an ACP hero's sandbox (#200).
    Network: ['Connect to', 'host'],
  };
  const entry = known[tool];
  const target = entry ? field(entry[1]) : undefined;
  if (entry && target !== undefined) return { action: entry[0], target };
  return { action: tool, target: JSON.stringify(input) ?? String(input) };
}
