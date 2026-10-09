import type { AgentEvent, Command, Cue, HeroView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { Effect } from './effects.types';
import { CONTINUE_PROMPT, RESTART_PROMPT } from './hero';
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

    // The hero was working, so a reload resumes it on its own, with its rules (#166).
    h.drain();
    h.gm({ type: 'runtimeRestarted' });
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

  it("keeps an ACP agent's always to this quest: never the project (#200)", () => {
    const h = quest().agent({
      type: 'permission',
      requestId: 'r1',
      tool: 'Run npm install',
      input: { command: 'npm install' },
      alwaysAllow: ['Run npm install'],
      alwaysQuestOnly: true,
    });
    expect(h.items()[0]).toMatchObject({ kind: 'permission', questOnly: true });
    h.command({
      type: 'answerPermission',
      commandId: 'a',
      itemId: 'n5',
      decision: 'allow',
      always: 'project',
    });
    expect(h.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'a',
      reason: 'This request can be always allowed for this quest only.',
    });
    expect(h.items().map((i) => i.kind)).toEqual(['permission']);
    h.command({
      type: 'answerPermission',
      commandId: 'b',
      itemId: 'n5',
      decision: 'allow',
      always: 'quest',
    });
    expect(h.state.heroes[0]?.allowRules).toEqual(['Run npm install']);
  });
});

describe('a hero without Ibitsa’s sandbox (#200)', () => {
  it('auto mode leaves its requests to "Needs you"', () => {
    const h = quest();
    h.command({ type: 'setAutoApprove', commandId: 'auto', on: true });
    h.agent({
      type: 'permission',
      requestId: 'r1',
      tool: 'Run npm install',
      input: {},
      boundary: 'unsandboxed',
    });
    expect(h.items().map((i) => i.kind)).toEqual(['permission']);
  });

  it('shows a network ask as the domain it wants', () => {
    const h = quest().agent({
      type: 'permission',
      requestId: 'r1',
      tool: 'Network',
      input: { host: 'example.com:443' },
    });
    expect(h.items()[0]).toMatchObject({ action: 'Connect to', target: 'example.com:443' });
  });
});

describe('runtime-only commands', () => {
  it('leave core untouched: no effects, no cues, no state change', () => {
    const h = quest();
    h.drain();
    const before = JSON.stringify(h.state);
    for (const command of [
      { type: 'requestActions' },
      { type: 'requestJournal' },
      { type: 'forgetProjectRule', rule: 'Bash(x)' },
    ] as Command[]) {
      h.command(command);
    }
    expect(h.effects).toEqual([]);
    expect(h.cues).toEqual([]);
    expect(JSON.stringify(h.state)).toBe(before);
  });
});

describe('auto mode (#63)', () => {
  const ask = (h: Harness, boundary?: 'sandboxEscape' | 'outsideWorktree') =>
    h.agent({
      type: 'permission',
      requestId: 'r1',
      tool: 'Bash',
      input: { command: 'npm install' },
      ...(boundary ? { boundary } : {}),
    });

  it('allows permissions at once while on, without asking you', () => {
    const h = quest().command({ type: 'setAutoApprove', commandId: 'a', on: true });
    h.drain();
    ask(h);
    expect(h.effects).toContainEqual(
      expect.objectContaining({ type: 'answerPermission', requestId: 'r1', decision: 'allow' }),
    );
    expect(h.items()).toEqual([]);
    expect(h.hero().state.kind).not.toBe('waitingOnYou');
    expect(view(h.state).campaign?.autoApprove).toBe(true);
  });

  it('still asks across a hard limit, and asks again once turned off', () => {
    const h = quest().command({ type: 'setAutoApprove', commandId: 'a', on: true });
    ask(h, 'sandboxEscape');
    expect(h.items().map((i) => i.kind)).toEqual(['permission']);
    const off = quest().command({ type: 'setAutoApprove', commandId: 'a', on: true });
    off.command({ type: 'setAutoApprove', commandId: 'b', on: false });
    ask(off);
    expect(off.items().map((i) => i.kind)).toEqual(['permission']);
  });

  it('only while a quest runs', () => {
    const h = new Harness().command({ type: 'setAutoApprove', commandId: 'a', on: true });
    expect(h.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'a',
      reason: 'There is no quest running.',
    });
  });
});

describe('rest (#82)', () => {
  it('compacts the live session', () => {
    const h = quest();
    h.drain();
    h.command({ type: 'restHero', commandId: 'r', heroId: 'h4' });
    expect(h.effects).toContainEqual({ type: 'compactSession', heroId: 'h4' });
  });

  it('refuses while the hero is already resting, has no session, or no quest runs', () => {
    const resting = quest().agent({ type: 'resting' });
    resting.command({ type: 'restHero', commandId: 'a', heroId: 'h4' });
    expect(resting.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'a',
      reason: 'The hero is already resting.',
    });

    // A hero waiting for orders keeps no live session after a reload (#166).
    const restarted = quest()
      .agent({ type: 'turnEnded', queuedTurns: 0 })
      .gm({ type: 'runtimeRestarted' });
    restarted.command({ type: 'restHero', commandId: 'b', heroId: 'h4' });
    expect(restarted.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'b',
      reason: 'The hero has no session to rest.',
    });

    const ended = quest().command({ type: 'abandonQuest', commandId: 'x' });
    ended.command({ type: 'restHero', commandId: 'c', heroId: 'h4' });
    expect(ended.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'c',
      reason: 'There is no quest running.',
    });
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

  it("asks for no reply when a hero's turn ends after its quest was abandoned (#255)", () => {
    const h = quest();
    h.command({ type: 'abandonQuest', commandId: 'a' });
    expect(h.items()).toEqual([]);
    // The session closes asynchronously: its last turn can still end afterwards.
    h.agent({ type: 'turnEnded', queuedTurns: 0 });
    expect(h.items()).toEqual([]);
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

  it('shows an estimated cost as estimated gold, and still enforces the pouch with it (§11.5)', () => {
    const h = quest({ budgetMicroUsd: 500_000, budget: 'turnEnd' });
    h.drain();
    h.agent({ type: 'usage', totalCost: 200_000, costBasis: 'tokens × agent prices' });
    expect(h.hero().gold).toEqual({
      kind: 'estimated',
      value: 200_000,
      basis: 'tokens × agent prices',
    });
    h.agent({ type: 'usage', totalCost: 510_000, costBasis: 'tokens × agent prices' });
    expect(h.effects).toContainEqual({ type: 'interrupt', heroId: 'h4' });
    expect(h.items().map((i) => i.kind)).toEqual(['outOfGold']);
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

describe('a session whose transcript is gone (#292)', () => {
  const lost = () => {
    const h = quest()
      .agent({ type: 'message', text: 'The redirect now keeps the query string.' })
      .agent({ type: 'turnEnded', queuedTurns: 0 })
      .gm({ type: 'runtimeRestarted' })
      .command({
        type: 'sendMessage',
        commandId: 'm1',
        heroId: 'h4',
        text: 'Add a test too.',
        priority: 'next',
      });
    h.agent({ type: 'sessionMissing' });
    h.drain();
    return h;
  };

  it('asks to start fresh instead of offering a resume that would fail again', () => {
    const h = lost();
    const item = h.items().find((i) => i.kind === 'error');
    expect(item).toMatchObject({ kind: 'error', heroId: 'h4', fresh: true });
    expect(item && 'message' in item ? item.message : '').toMatch(/can't be resumed/);
    expect(h.hero().state.kind).toBe('error');
  });

  it('starts a fresh session told the task, to look at the worktree, and its last message', () => {
    const h = lost().command({ type: 'resumeHero', commandId: 'r1', heroId: 'h4' });
    expect(h.effects.some((e) => e.type === 'resumeSession')).toBe(false);
    const start = h.effects.find((e) => e.type === 'startSession');
    expect(start).toMatchObject({ type: 'startSession', heroId: 'h4', cwd: '/wt' });
    const prompt = start && 'prompt' in start ? start.prompt : '';
    expect(prompt).toContain('Fix the login redirect');
    expect(prompt).toContain('git diff');
    expect(prompt).toContain('The redirect now keeps the query string.');
  });

  it('works as before once the fresh session is up', () => {
    const h = lost()
      .command({ type: 'resumeHero', commandId: 'r1', heroId: 'h4' })
      .agent({ type: 'sessionStarted', sessionId: 's2' })
      .agent({ type: 'turnEnded', queuedTurns: 0 })
      .gm({ type: 'runtimeRestarted' })
      .command({
        type: 'sendMessage',
        commandId: 'm2',
        heroId: 'h4',
        text: 'Thanks.',
        priority: 'next',
      });
    expect(h.effects).toContainEqual(
      expect.objectContaining({ type: 'resumeSession', heroId: 'h4', sessionId: 's2' }),
    );
    expect(h.items().some((i) => i.kind === 'error')).toBe(false);
  });
});

describe('after a restart', () => {
  it('resumes a hero who was working, drops requests the old process held, and says so (#166)', () => {
    const h = quest().agent({
      type: 'permission',
      requestId: 'p',
      tool: 'Bash',
      input: { command: 'ls' },
    });
    h.drain();
    h.gm({ type: 'runtimeRestarted' });
    expect(h.items()).toEqual([]);
    expect(h.effects).toContainEqual({ type: 'cancelTimer', timerId: 'silence:h4' });
    expect(h.effects).toContainEqual({
      type: 'resumeSession',
      heroId: 'h4',
      sessionId: 's1',
      cwd: '/wt',
      classId: 'ranger',
      prompt: RESTART_PROMPT,
    });
    expect(h.cues).toContainEqual({
      type: 'resumed',
      heroIds: ['h4'],
      checks: 0,
      reviews: 0,
      council: false,
      elder: false,
    });
    expect(h.hero().state.kind).not.toBe('unknown');
  });

  it('leaves a hero that was waiting for orders until its next message, and says nothing (#166)', () => {
    const h = quest().agent({ type: 'turnEnded', queuedTurns: 0 });
    h.drain();
    h.gm({ type: 'runtimeRestarted' });
    expect(h.effects.map((e) => e.type)).not.toContain('resumeSession');
    expect(h.cues.map((c) => c.type)).not.toContain('resumed');
    expect(h.items().map((i) => i.kind)).not.toContain('error');
  });

  it("doesn't resume a hero that had stopped on an error or an empty pouch", () => {
    const h = quest().agent({ type: 'error', message: 'boom' });
    h.drain();
    h.gm({ type: 'runtimeRestarted' });
    expect(h.effects.map((e) => e.type)).not.toContain('resumeSession');
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

describe('asking before resuming (#293)', () => {
  const resumes = (h: Harness) => h.effects.filter((e) => e.type === 'resumeSession');
  const reloaded = (resume: 'ask' | 'never') => {
    const h = quest().agent({ type: 'activityStarted', toolUseId: 't1', kind: 'edit' });
    h.drain();
    h.gm({ type: 'runtimeRestarted', resume });
    return h;
  };

  it('offers a hero who was working, how long since it was heard from, and resumes nothing yet', () => {
    const h = reloaded('ask');
    expect(resumes(h)).toEqual([]);
    expect(view(h.state).resumeOffer).toEqual({
      heroes: [{ heroId: 'h4', idleMs: 10 }],
      council: null,
    });
    expect(h.cues.some((c) => c.type === 'resumed')).toBe(false);
  });

  it('resumes what the user picks and says so; the offer goes', () => {
    const h = reloaded('ask').command({ type: 'answerResume', commandId: 'a1', resume: ['h4'] });
    expect(resumes(h)).toEqual([
      expect.objectContaining({ heroId: 'h4', sessionId: 's1', prompt: RESTART_PROMPT }),
    ]);
    expect(h.cues).toContainEqual(expect.objectContaining({ type: 'resumed', heroIds: ['h4'] }));
    expect(view(h.state).resumeOffer).toBeUndefined();
  });

  it("leaves what the user didn't pick waiting for its next message", () => {
    const h = reloaded('ask').command({ type: 'answerResume', commandId: 'a1', resume: [] });
    expect(resumes(h)).toEqual([]);
    expect(view(h.state).resumeOffer).toBeUndefined();
    h.command({
      type: 'sendMessage',
      commandId: 'm1',
      heroId: 'h4',
      text: 'Carry on.',
      priority: 'next',
    });
    expect(resumes(h)).toHaveLength(1);
  });

  it('refuses an answer when nothing is offered', () => {
    const h = reloaded('never');
    expect(view(h.state).resumeOffer).toBeUndefined();
    expect(resumes(h)).toEqual([]);
    h.command({ type: 'answerResume', commandId: 'a1', resume: ['h4'] });
    expect(h.cues).toContainEqual(
      expect.objectContaining({ type: 'commandRejected', commandId: 'a1' }),
    );
    expect(resumes(h)).toEqual([]);
  });

  it("doesn't resume a hero twice when its message got it going first", () => {
    const h = reloaded('ask').command({
      type: 'sendMessage',
      commandId: 'm1',
      heroId: 'h4',
      text: 'Carry on.',
      priority: 'next',
    });
    h.command({ type: 'answerResume', commandId: 'a1', resume: ['h4'] });
    expect(resumes(h)).toHaveLength(1);
  });
});

describe('removing the worktree', () => {
  it('only after the quest ends, once, reporting failures', () => {
    const h = quest().command({ type: 'removeWorktree', commandId: 'w1', islandId: 'i2' });
    expect(h.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'w1',
      reason: 'Finish or abandon the quest first, or merge its pull request.',
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
