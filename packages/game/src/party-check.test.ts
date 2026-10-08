import {
  type AgentCheck,
  type HostEvent,
  type HostRequest,
  resolveClasses,
  type Snapshot,
} from '@ibitsa/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { heroClasses, setHeroClasses } from './heroes';
import type { Host } from './host.types';
import { classReadiness, mountPartyCheck, partyReady, reviewerAgentOf } from './party-check';

afterEach(() => setHeroClasses(undefined));

const seer = () => {
  setHeroClasses(
    resolveClasses({
      seer: { name: 'Seer', agent: 'codex', model: 'gpt-6-sol' },
      // No model of its own: the agent chooses.
      oracle: { name: 'Oracle', agent: 'codex' },
    }),
  );
  return {
    seer: heroClasses().find((c) => c.id === 'seer'),
    oracle: heroClasses().find((c) => c.id === 'oracle'),
  };
};

const codex = (result: AgentCheck['result'], costReported = false): AgentCheck => ({
  agent: 'codex',
  name: 'Codex',
  costReported,
  result,
});

describe('classReadiness (§11.5, #199)', () => {
  it('needs no check for a Claude class', () => {
    expect(
      classReadiness({ heroClass: heroClasses().find((c) => c.id === 'ranger'), check: undefined }),
    ).toEqual({ ready: true, text: null, warning: null, signIn: null, recheck: null });
  });

  it('waits while the agent is checked', () => {
    expect(classReadiness({ heroClass: seer().seer, check: undefined })).toMatchObject({
      ready: false,
      text: 'Checking Codex…',
    });
  });

  it("is ready when the agent offers the class's model, warning that the pouch can't stop it", () => {
    const { seer: heroClass } = seer();
    expect(
      classReadiness({ heroClass, check: codex({ kind: 'ready', models: ['gpt-6-sol'] }) }),
    ).toEqual({
      ready: true,
      text: 'Codex is ready.',
      warning: "Codex reports no cost: the gold pouch can't stop this hero.",
      signIn: null,
      recheck: null,
    });
    expect(
      classReadiness({ heroClass, check: codex({ kind: 'ready', models: null }, true) }),
    ).toMatchObject({
      ready: true,
      text: 'Codex is ready. It picks its own model, not gpt-6-sol.',
      warning: null,
    });
  });

  it("blocks a model the agent doesn't offer, naming the ones it does", () => {
    const { seer: heroClass, oracle } = seer();
    const offers = codex({ kind: 'ready', models: ['gpt-6.1-sol', 'gpt-6-luna'] });
    expect(classReadiness({ heroClass, check: offers })).toEqual({
      ready: false,
      text: "Codex doesn't offer gpt-6-sol. It offers gpt-6.1-sol, gpt-6-luna.",
      warning: null,
      signIn: null,
      recheck: 'codex',
    });
    // No model of its own: the agent chooses.
    expect(classReadiness({ heroClass: oracle, check: offers }).ready).toBe(true);
  });

  it('asks for a sign-in, offering Sign in only when Ibitsa can open one', () => {
    const { seer: heroClass } = seer();
    expect(
      classReadiness({
        heroClass,
        check: codex({
          kind: 'signIn',
          message: 'Authentication required',
          via: 'command',
          command: 'codex login',
        }),
      }),
    ).toEqual({
      ready: false,
      text: 'Sign in to Codex first (codex login). Authentication required',
      warning: null,
      signIn: 'codex',
      recheck: 'codex',
    });
    expect(
      classReadiness({
        heroClass,
        check: codex({ kind: 'signIn', message: 'Log in', via: null, command: null }),
      }),
    ).toMatchObject({
      text: 'Sign in to Codex in a terminal first, then check again. Log in',
      signIn: null,
      recheck: 'codex',
    });
  });

  it("blocks an agent that isn't installed or couldn't start", () => {
    const { seer: heroClass } = seer();
    expect(
      classReadiness({ heroClass, check: codex({ kind: 'notInstalled', command: 'codex-acp' }) }),
    ).toMatchObject({
      ready: false,
      text: "Codex isn't installed: `codex-acp` isn't on your PATH. Install it and sign in yourself.",
    });
    expect(
      classReadiness({ heroClass, check: codex({ kind: 'failed', message: 'It crashed.' }) }),
    ).toMatchObject({ ready: false, text: "Codex couldn't start a session: It crashed." });
  });
});

describe('the party check store (#199)', () => {
  function fakeHost() {
    const requests: HostRequest[] = [];
    const listeners: ((event: HostEvent) => void)[] = [];
    const host = {
      request: (r: HostRequest) => requests.push(r),
      onHostEvent: (l: (event: HostEvent) => void) => listeners.push(l),
    } as unknown as Host;
    const answer = (check: AgentCheck) => {
      for (const l of listeners) l({ channel: 'host', type: 'agentCheck', check });
    };
    return { host, requests, answer };
  }

  it("asks for each ACP agent once while it's checked, and says when the answer comes", () => {
    seer();
    const { host, requests, answer } = fakeHost();
    const partyCheck = mountPartyCheck({ host });
    let changes = 0;
    const stop = partyCheck.onChange(() => {
      changes += 1;
    });
    partyCheck.check(['seer', 'oracle', 'ranger']);
    partyCheck.check(['seer']);
    expect(requests).toEqual([{ channel: 'host', type: 'checkAgents', agents: ['codex'] }]);
    expect(partyCheck.allReady(['ranger'])).toBe(true);
    expect(partyCheck.allReady(['ranger', 'seer'])).toBe(false);
    answer(codex({ kind: 'ready', models: ['gpt-6-sol'] }));
    expect(partyCheck.allReady(['ranger', 'seer', 'oracle'])).toBe(true);
    expect(partyCheck.readiness('seer').text).toBe('Codex is ready.');
    expect(changes).toBe(2);
    stop();
    answer(codex({ kind: 'ready', models: [] }));
    expect(changes).toBe(2);
  });

  it('signs in through the extension, and checks again without its recent answer', () => {
    seer();
    const { host, requests } = fakeHost();
    const partyCheck = mountPartyCheck({ host });
    partyCheck.check(['ranger']);
    partyCheck.signIn('codex');
    partyCheck.recheck('codex');
    expect(requests).toEqual([
      { channel: 'host', type: 'signInAgent', agent: 'codex' },
      { channel: 'host', type: 'checkAgents', agents: ['codex'], force: true },
    ]);
    expect(partyCheck.readiness('seer').text).toBe('Checking Codex…');
  });

  it("checks a reviewing councillor's agent, and the party waits for it too (#201)", () => {
    const { host, requests, answer } = fakeHost();
    const partyCheck = mountPartyCheck({ host });
    const reviewer = { councillorId: 'security', agent: 'codex', model: 'gpt-6-luna' };
    partyCheck.checkAgents(['codex', 'claude', 'codex']);
    partyCheck.checkAgents(['codex']);
    expect(requests).toEqual([{ channel: 'host', type: 'checkAgents', agents: ['codex'] }]);
    const party = { partyCheck, classIds: ['ranger'], fields: [{ reviewers: [reviewer] }] };
    expect(partyReady(party)).toBe(false);
    expect(partyCheck.reviewerReadiness(reviewer).text).toBe('Checking Codex…');
    // The councillor's own model has to be on offer, as a class's does.
    answer(codex({ kind: 'ready', models: ['gpt-6-sol'] }));
    expect(partyCheck.reviewerReadiness(reviewer).text).toBe(
      "Codex doesn't offer gpt-6-luna. It offers gpt-6-sol.",
    );
    expect(partyReady(party)).toBe(false);
    answer(codex({ kind: 'ready', models: ['gpt-6-sol', 'gpt-6-luna'] }));
    expect(partyCheck.reviewerReadiness(reviewer)).toMatchObject({
      ready: true,
      text: 'Codex is ready.',
      warning: "Codex reports no cost: its review's cap can't stop it.",
    });
    expect(partyReady(party)).toBe(true);
    expect(partyReady({ ...party, fields: [{ reviewers: [] }] })).toBe(true);
  });
});

describe('reviewerAgentOf (#201)', () => {
  it("finds a councillor's ACP agent and own model in the snapshot; Claude and strangers need none", () => {
    const councillor = (id: string, extra: object) => ({
      id,
      skill: id,
      title: id,
      description: '',
      source: 'builtin' as const,
      portrait: null,
      model: null,
      tools: [],
      modes: { planning: true, review: true },
      hash: 'h',
      ...extra,
    });
    const of = reviewerAgentOf({
      councillors: [
        councillor('security', { agent: 'codex', model: 'gpt-6-luna' }),
        councillor('tester', { agent: 'codex' }),
        councillor('design', {}),
        councillor('docs', { agent: 'claude' }),
      ],
    } as unknown as Snapshot);
    expect(of('security')).toEqual({
      councillorId: 'security',
      agent: 'codex',
      model: 'gpt-6-luna',
    });
    expect(of('tester')).toEqual({ councillorId: 'tester', agent: 'codex', model: '' });
    expect([of('design'), of('docs'), of('nobody')]).toEqual([null, null, null]);
    expect(reviewerAgentOf(null)('security')).toBeNull();
  });
});
