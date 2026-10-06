import type { AgentEvent, Command, Cue, HeroView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { Effect } from './effects.types';
import { CONTINUE_PROMPT } from './hero';
import type { CoreInput, GameMasterEvent } from './inputs.types';
import { DEFAULT_SETTINGS, initialState } from './state';
import type { CoreState, QuestSettings } from './state.types';
import { step } from './step';
import { view } from './view';

type InputWithoutTime = CoreInput extends infer I
  ? I extends unknown
    ? Omit<I, 't'>
    : never
  : never;

/** Feeds inputs in order and collects cues and effects since the last drain. */
class Harness {
  state: CoreState = initialState();
  cues: Cue[] = [];
  effects: Effect[] = [];
  t = 0;

  input(input: InputWithoutTime): this {
    this.t += 10;
    const result = step(this.state, { ...input, t: this.t } as CoreInput);
    this.state = result.state;
    this.cues.push(...result.cues);
    this.effects.push(...result.effects);
    return this;
  }
  command(command: Command) {
    return this.input({ kind: 'command', command });
  }
  gm(event: GameMasterEvent) {
    return this.input({ kind: 'gm', event });
  }
  agent(event: AgentEvent) {
    return this.input({ kind: 'agent', heroId: 'h4', event });
  }
  tool({
    kind,
    detail,
    ok = true,
    id,
  }: {
    kind: 'test' | 'edit';
    detail: string;
    ok?: boolean;
    id: string;
  }) {
    return this.agent({ type: 'activityStarted', toolUseId: id, kind, detail }).agent({
      type: 'activityFinished',
      toolUseId: id,
      outcome: ok ? 'ok' : 'failed',
    });
  }
  hero(): HeroView {
    const hero = view(this.state).heroes[0];
    if (!hero) throw new Error('no hero');
    return hero;
  }
  items() {
    return view(this.state).needsYou;
  }
  drain() {
    const out = { cues: this.cues, effects: this.effects };
    this.cues = [];
    this.effects = [];
    return out;
  }
}

function quest(settings: Partial<QuestSettings> = {}): Harness {
  const h = new Harness()
    .gm({ type: 'questSettings', ...DEFAULT_SETTINGS, ...settings })
    .command({
      type: 'startQuest',
      commandId: 'q1',
      description: 'Fix the login redirect',
      heroName: 'Ranger Ilse',
      classId: 'ranger',
      baseRef: 'main',
    })
    .gm({ type: 'worktreeCreated', islandId: 'i2', path: '/wt', branch: 'ibitsa/fix' })
    .agent({ type: 'sessionStarted', sessionId: 's1' });
  return h;
}

describe('speech', () => {
  it('passes what the hero says to the game as a cue (#57)', () => {
    const h = quest().agent({ type: 'message', text: 'Done! The tests pass now.' });
    expect(h.cues).toContainEqual({
      type: 'heroSaid',
      heroId: 'h4',
      text: 'Done! The tests pass now.',
    });
  });
});

describe('always allow (#62)', () => {
  const ask = (h: Harness, alwaysAllow?: string[]) =>
    h.agent({
      type: 'permission',
      requestId: 'r1',
      tool: 'Bash',
      input: { command: 'npm run lint' },
      ...(alwaysAllow ? { alwaysAllow } : {}),
    });

  it('shows the offered rules on the item', () => {
    const h = ask(quest(), ['Bash(npm run lint:*)']);
    expect(h.items()[0]).toMatchObject({
      kind: 'permission',
      alwaysAllow: ['Bash(npm run lint:*)'],
    });
  });

  it('for this quest: allows, keeps the rules on the hero, and passes them when the session resumes', () => {
    const h = ask(quest(), ['Bash(npm run lint:*)']);
    h.drain();
    h.command({
      type: 'answerPermission',
      commandId: 'a',
      itemId: 'n5',
      decision: 'allow',
      always: 'quest',
    });
    expect(h.effects).toContainEqual({
      type: 'answerPermission',
      heroId: 'h4',
      requestId: 'r1',
      decision: 'allow',
      always: 'quest',
      rules: ['Bash(npm run lint:*)'],
    });
    expect(h.state.heroes[0]?.allowRules).toEqual(['Bash(npm run lint:*)']);

    // The same rule again is not added twice.
    ask(h, ['Bash(npm run lint:*)']);
    h.command({
      type: 'answerPermission',
      commandId: 'b',
      itemId: 'n6',
      decision: 'allow',
      always: 'quest',
    });
    expect(h.state.heroes[0]?.allowRules).toEqual(['Bash(npm run lint:*)']);

    h.gm({ type: 'runtimeRestarted' });
    h.drain();
    const error = h.items().find((i) => i.kind === 'error');
    h.command({ type: 'resumeHero', commandId: 'r', heroId: 'h4' });
    expect(error).toBeDefined();
    expect(h.effects).toContainEqual(
      expect.objectContaining({ type: 'resumeSession', allowRules: ['Bash(npm run lint:*)'] }),
    );
  });

  it('for the project: the effect carries the rules for the runtime; the hero keeps none', () => {
    const h = ask(quest(), ['Bash(npm test:*)']);
    h.drain();
    h.command({
      type: 'answerPermission',
      commandId: 'a',
      itemId: 'n5',
      decision: 'allow',
      always: 'project',
    });
    expect(h.effects).toContainEqual(
      expect.objectContaining({ always: 'project', rules: ['Bash(npm test:*)'] }),
    );
    expect(h.state.heroes[0]?.allowRules).toEqual([]);
  });

  it('refuses always when nothing was offered, or with deny, and leaves the request waiting', () => {
    const h = ask(quest());
    h.command({
      type: 'answerPermission',
      commandId: 'a',
      itemId: 'n5',
      decision: 'allow',
      always: 'quest',
    });
    expect(h.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'a',
      reason: 'This request can’t be always allowed.',
    });
    const offered = ask(quest(), ['Bash(x)']);
    offered.command({
      type: 'answerPermission',
      commandId: 'b',
      itemId: 'n5',
      decision: 'deny',
      always: 'quest',
    });
    expect(offered.items().map((i) => i.kind)).toEqual(['permission']);
  });
});

describe('stall detection', () => {
  it('stalls after the same test fails 4 times in a row, pausing the hero', () => {
    const h = quest();
    for (let i = 0; i < 3; i++)
      h.tool({ kind: 'test', detail: 'pnpm test auth', ok: false, id: `t${i}` });
    expect(h.hero().state.kind).toBe('working');
    h.drain();
    h.tool({ kind: 'test', detail: 'pnpm test auth', ok: false, id: 't3' });
    const reason = 'The same test failed 4 times in a row: pnpm test auth';
    expect(h.hero().state).toEqual({ kind: 'stalled', reason });
    expect(h.effects).toContainEqual({ type: 'interrupt', heroId: 'h4' });
    expect(h.items()).toEqual([{ kind: 'stalled', id: 'n5', heroId: 'h4', reason }]);
    expect(h.cues).toContainEqual({ type: 'needsYouAdded', itemId: 'n5' });
    h.agent({ type: 'turnEnded', queuedTurns: 0 });
    expect(h.items().map((i) => i.kind)).toEqual(['stalled']); // no reply item while stalled
  });

  it('resets the failing-test count on a pass or a different command, but not on edits', () => {
    const h = quest();
    h.tool({ kind: 'test', detail: 'a', ok: false, id: '1' }).tool({
      kind: 'test',
      detail: 'a',
      ok: false,
      id: '2',
    });
    h.tool({ kind: 'edit', detail: 'x.ts', id: '3' });
    h.tool({ kind: 'test', detail: 'a', ok: false, id: '4' });
    h.tool({ kind: 'test', detail: 'b', ok: false, id: '5' }); // different command restarts at 1
    h.tool({ kind: 'test', detail: 'b', ok: true, id: '6' });
    for (let i = 0; i < 3; i++) h.tool({ kind: 'test', detail: 'b', ok: false, id: `7${i}` });
    expect(h.hero().state.kind).toBe('working');
  });

  it('stalls after one file is edited 12 times without a passing test', () => {
    const h = quest();
    for (let i = 0; i < 11; i++) h.tool({ kind: 'edit', detail: 'src/auth.ts', id: `e${i}` });
    h.tool({ kind: 'test', detail: 'pnpm test', ok: true, id: 'pass' });
    for (let i = 0; i < 11; i++) h.tool({ kind: 'edit', detail: 'src/auth.ts', id: `f${i}` });
    expect(h.hero().state.kind).toBe('working');
    h.tool({ kind: 'edit', detail: 'src/auth.ts', id: 'f11' });
    expect(h.hero().state).toEqual({
      kind: 'stalled',
      reason: 'src/auth.ts was edited 12 times without a passing test.',
    });
  });

  it('asks for the diff after each turn and stalls after 6 quiet turns', () => {
    const h = quest();
    h.drain();
    h.agent({ type: 'turnEnded', queuedTurns: 1 });
    expect(h.effects).toContainEqual({ type: 'observeDiff', heroId: 'h4', worktreePath: '/wt' });
    h.gm({ type: 'diffObserved', heroId: 'h4', hash: 'abc' });
    for (let i = 0; i < 5; i++) h.gm({ type: 'diffObserved', heroId: 'h4', hash: 'abc' });
    expect(h.hero().state.kind).toBe('working');
    h.gm({ type: 'diffObserved', heroId: 'h4', hash: 'abc' });
    expect(h.hero().state).toEqual({ kind: 'stalled', reason: 'No progress for 6 turns.' });
  });

  it('does not count a turn with a passing test or a changed diff as quiet', () => {
    const h = quest();
    h.gm({ type: 'diffObserved', heroId: 'h4', hash: 'a' });
    for (let i = 0; i < 5; i++) h.gm({ type: 'diffObserved', heroId: 'h4', hash: 'a' });
    h.tool({ kind: 'test', detail: 't', ok: true, id: 'p' });
    h.gm({ type: 'diffObserved', heroId: 'h4', hash: 'a' });
    for (let i = 0; i < 5; i++) h.gm({ type: 'diffObserved', heroId: 'h4', hash: 'a' });
    h.gm({ type: 'diffObserved', heroId: 'h4', hash: 'b' });
    expect(h.hero().state.kind).toBe('working');
  });

  it('uses the thresholds from the quest settings', () => {
    const h = quest({ stall: { testFailures: 2, fileEdits: 12, noProgressTurns: 6 } });
    h.tool({ kind: 'test', detail: 'a', ok: false, id: '1' }).tool({
      kind: 'test',
      detail: 'a',
      ok: false,
      id: '2',
    });
    expect(h.hero().state.kind).toBe('stalled');
  });

  const stalled = () => {
    const h = quest({ stall: { testFailures: 1, fileEdits: 12, noProgressTurns: 6 } });
    h.tool({ kind: 'test', detail: 'a', ok: false, id: '1' }).agent({
      type: 'turnEnded',
      queuedTurns: 0,
    });
    h.drain();
    return h;
  };

  it('continues with fresh counters on resumeHero', () => {
    const h = stalled().command({ type: 'resumeHero', commandId: 'r', heroId: 'h4' });
    expect(h.effects).toContainEqual({
      type: 'sendMessage',
      heroId: 'h4',
      text: CONTINUE_PROMPT,
      priority: 'next',
    });
    expect(h.items()).toEqual([]);
    expect(h.hero().state.kind).toBe('idle');
    h.agent({ type: 'turnStarted' });
    expect(h.hero().state.kind).toBe('working');
  });

  it('continues with the message when you answer a stall by sending one', () => {
    const h = stalled().command({
      type: 'sendMessage',
      commandId: 'm',
      heroId: 'h4',
      text: 'Try the session store.',
      priority: 'next',
    });
    expect(h.effects).toContainEqual({
      type: 'sendMessage',
      heroId: 'h4',
      text: 'Try the session store.',
      priority: 'next',
    });
    expect(h.items()).toEqual([]);
  });

  it('clears the stall on stop', () => {
    const h = stalled().command({ type: 'stopHero', commandId: 's', heroId: 'h4' });
    expect(h.items()).toEqual([]);
    expect(h.hero().state.kind).toBe('idle');
  });
});

describe('gold pouch', () => {
  const native = () => quest({ budgetMicroUsd: 1_000_000, budget: 'native' });

  it('gives a native-cap adapter the whole cap at start', () => {
    const h = new Harness()
      .gm({ type: 'questSettings', ...DEFAULT_SETTINGS, budgetMicroUsd: 1_000_000 })
      .command({
        type: 'startQuest',
        commandId: 'q',
        description: 'x',
        heroName: 'n',
        classId: 'ranger',
        baseRef: 'main',
      })
      .gm({ type: 'worktreeCreated', islandId: 'i2', path: '/wt', branch: 'b' });
    expect(h.effects).toContainEqual(
      expect.objectContaining({ type: 'startSession', maxBudgetMicroUsd: 1_000_000 }),
    );
  });

  it('runs out of gold when the adapter stops at its native cap', () => {
    const h = native()
      .agent({ type: 'usage', totalCost: 1_000_400 })
      .agent({ type: 'budgetExhausted' });
    expect(h.hero().state).toEqual({ kind: 'outOfGold' });
    expect(h.items()).toEqual([
      { kind: 'outOfGold', id: 'n5', heroId: 'h4', cap: 1_000_000, capEnforcement: 'native' },
    ]);
    h.command({
      type: 'sendMessage',
      commandId: 'm',
      heroId: 'h4',
      text: 'go on',
      priority: 'next',
    });
    expect(h.cues).toContainEqual(
      expect.objectContaining({ type: 'commandRejected', commandId: 'm' }),
    );
  });

  it('checks the total itself at turn end, even without budgetExhausted', () => {
    const h = native()
      .agent({ type: 'usage', totalCost: 1_200_000 })
      .agent({ type: 'turnEnded', queuedTurns: 0 });
    expect(h.hero().state).toEqual({ kind: 'outOfGold' });
    expect(h.items().map((i) => i.kind)).toEqual(['outOfGold']);
  });

  it('resumes with the new remainder when the cap is raised', () => {
    const h = native()
      .agent({ type: 'usage', totalCost: 1_000_400 })
      .agent({ type: 'budgetExhausted' });
    h.drain();
    h.command({ type: 'raiseBudget', commandId: 'r', heroId: 'h4', addMicroUsd: 500_000 });
    expect(h.effects).toContainEqual({
      type: 'resumeSession',
      heroId: 'h4',
      sessionId: 's1',
      cwd: '/wt',
      classId: 'ranger',
      prompt: CONTINUE_PROMPT,
      maxBudgetMicroUsd: 499_600,
    });
    expect(h.items()).toEqual([]);
    expect(h.hero().state.kind).not.toBe('outOfGold');
  });

  it('enforces the cap at usage reports when the adapter has no native cap', () => {
    const h = quest({ budgetMicroUsd: 500_000, budget: 'turnEnd' });
    h.drain();
    h.agent({ type: 'usage', totalCost: 510_000 });
    expect(h.effects).toContainEqual({ type: 'interrupt', heroId: 'h4' });
    expect(h.items()).toEqual([
      { kind: 'outOfGold', id: 'n5', heroId: 'h4', cap: 500_000, capEnforcement: 'turnEnd' },
    ]);
    h.drain();
    h.command({ type: 'raiseBudget', commandId: 'r', heroId: 'h4', addMicroUsd: 100_000 });
    expect(h.effects).toContainEqual({
      type: 'sendMessage',
      heroId: 'h4',
      text: CONTINUE_PROMPT,
      priority: 'next',
    });
  });

  it('has no pouch when no cap is set or the agent reports no cost', () => {
    for (const settings of [
      { budgetMicroUsd: null },
      { budgetMicroUsd: 100, budget: 'none' as const },
    ]) {
      const h = quest(settings)
        .agent({ type: 'usage', totalCost: 9_999_999 })
        .agent({ type: 'turnEnded', queuedTurns: 0 });
      expect(h.hero().state.kind).toBe('idle');
      h.command({ type: 'raiseBudget', commandId: 'r', heroId: 'h4', addMicroUsd: 1 });
      expect(h.cues).toContainEqual({
        type: 'commandRejected',
        commandId: 'r',
        reason: 'This hero has no gold pouch.',
      });
    }
  });
});

describe('errors', () => {
  it('asks for a retry when the session fails, and resumes it', () => {
    const h = quest().agent({ type: 'error', message: 'Authentication failed' });
    expect(h.hero().state).toEqual({ kind: 'error', message: 'Authentication failed' });
    expect(h.items()).toEqual([
      { kind: 'error', id: 'n5', heroId: 'h4', message: 'Authentication failed' },
    ]);
    h.drain();
    h.command({ type: 'resumeHero', commandId: 'r', heroId: 'h4' });
    expect(h.effects).toContainEqual({
      type: 'resumeSession',
      heroId: 'h4',
      sessionId: 's1',
      cwd: '/wt',
      classId: 'ranger',
      prompt: CONTINUE_PROMPT,
    });
    expect(h.items()).toEqual([]);
  });

  it('retries the worktree when it could not be created', () => {
    const h = new Harness()
      .command({
        type: 'startQuest',
        commandId: 'q',
        description: 'x',
        heroName: 'n',
        classId: 'ranger',
        baseRef: 'main',
      })
      .gm({ type: 'worktreeFailed', islandId: 'i2', message: 'branch exists' });
    expect(h.items()).toEqual([
      {
        kind: 'error',
        id: 'n5',
        heroId: 'h4',
        message: 'Could not create the worktree: branch exists',
      },
    ]);
    h.drain();
    h.command({ type: 'resumeHero', commandId: 'r', heroId: 'h4' });
    expect(h.effects).toEqual([
      { type: 'createWorktree', islandId: 'i2', branch: 'ibitsa/x', baseRef: 'main' },
    ]);
  });

  it('rejects resumeHero when there is nothing to resume', () => {
    const h = quest().command({ type: 'resumeHero', commandId: 'r', heroId: 'h4' });
    expect(h.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'r',
      reason: 'Nothing to resume.',
    });
  });
});

describe('after a restart', () => {
  it('marks working heroes unknown, drops requests the old process held, and offers to resume', () => {
    const h = quest().agent({
      type: 'permission',
      requestId: 'p',
      tool: 'Bash',
      input: { command: 'ls' },
    });
    h.drain();
    h.gm({ type: 'runtimeRestarted' });
    expect(h.hero().state).toEqual({
      kind: 'unknown',
      reason: 'Session not resumed after a restart.',
    });
    expect(h.items()).toEqual([
      {
        kind: 'error',
        id: 'n6',
        heroId: 'h4',
        message: 'The session stopped when VS Code reloaded.',
      },
    ]);
    expect(h.effects).toContainEqual({ type: 'cancelTimer', timerId: 'silence:h4' });
    h.drain();
    h.command({ type: 'resumeHero', commandId: 'r', heroId: 'h4' });
    expect(h.effects).toContainEqual({
      type: 'resumeSession',
      heroId: 'h4',
      sessionId: 's1',
      cwd: '/wt',
      classId: 'ranger',
      prompt: CONTINUE_PROMPT,
    });
    expect(h.hero().state.kind).not.toBe('unknown');
  });

  it('leaves a submitted hero alone, but resumes its session before a message', () => {
    const h = quest()
      .agent({ type: 'turnEnded', queuedTurns: 0 })
      .command({ type: 'markDone', commandId: 'd', heroId: 'h4' })
      .gm({ type: 'runtimeRestarted' });
    expect(h.hero().state.kind).toBe('submitted');
    expect(h.items()).toEqual([]);
    h.drain();
    h.command({
      type: 'sendMessage',
      commandId: 'm',
      heroId: 'h4',
      text: 'one more thing',
      priority: 'next',
    });
    const types = h.effects.map((e) => e.type);
    expect(types).toContain('resumeSession');
    expect(types.indexOf('resumeSession')).toBeLessThan(types.indexOf('sendMessage'));
  });

  it('does nothing without an active quest', () => {
    const h = new Harness().gm({ type: 'runtimeRestarted' });
    expect(h.effects).toEqual([]);
  });
});

describe('removing the worktree', () => {
  it('only after the quest ends, once, reporting failures', () => {
    const h = quest().command({ type: 'removeWorktree', commandId: 'w1', islandId: 'i2' });
    expect(h.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'w1',
      reason: 'Finish or abandon the quest first.',
    });
    h.command({ type: 'abandonQuest', commandId: 'a' });
    h.drain();
    h.command({ type: 'removeWorktree', commandId: 'w2', islandId: 'i2' });
    expect(h.effects).toEqual([
      { type: 'removeWorktree', islandId: 'i2', worktreePath: '/wt', commandId: 'w2' },
    ]);
    h.gm({
      type: 'worktreeRemoveFailed',
      islandId: 'i2',
      commandId: 'w2',
      reason: 'The worktree has uncommitted changes.',
    });
    expect(h.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'w2',
      reason: 'The worktree has uncommitted changes.',
    });
    expect(view(h.state).islands[0]?.worktree).toBe('ready');
    h.gm({ type: 'worktreeRemoved', islandId: 'i2' });
    // The game shows the removal; the pane confirms it instead of leaving the button (#40).
    expect(view(h.state).islands[0]?.worktree).toBe('removed');
    h.command({ type: 'removeWorktree', commandId: 'w3', islandId: 'i2' });
    expect(h.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'w3',
      reason: 'There is no worktree to remove.',
    });
  });
});
