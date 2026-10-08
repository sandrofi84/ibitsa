import { type AgentCheck, agentName, CLAUDE_AGENT, type Snapshot } from '@ibitsa/protocol';
import { button, el } from './dom';
import { heroClasses } from './heroes';
import type { HeroClass } from './heroes.types';
import type { Host } from './host.types';
import type { ClassReadiness, PartyCheck, ReviewerAgent } from './party-check.types';

/** Said when Start is pressed before every ACP agent has passed its party check (#199). */
export const AGENTS_NOT_READY = 'Wait until every agent has passed its check.';

const READY: ClassReadiness = {
  ready: true,
  text: null,
  warning: null,
  signIn: null,
  recheck: null,
};

/**
 * Whether heroes of a class can set out (§11.5, #199), from its agent's last check: started, signed
 * in, and offering the class's model when it offers a choice. A Claude class needs no check.
 */
export function classReadiness({
  heroClass,
  check,
}: {
  heroClass: HeroClass | undefined;
  check: AgentCheck | undefined;
}): ClassReadiness {
  if (!heroClass) return READY;
  return agentReadiness({
    agent: heroClass.agent,
    model: heroClass.modelId,
    check,
    noCost: "the gold pouch can't stop this hero.",
  });
}

/**
 * Whether a reviewing councillor's agent can review (§11.5, #201), from its last check, as for a
 * class: started, signed in, and offering the councillor's own model when it has one.
 */
export function reviewerReadiness({
  reviewer,
  check,
}: {
  reviewer: ReviewerAgent;
  check: AgentCheck | undefined;
}): ClassReadiness {
  return agentReadiness({
    agent: reviewer.agent,
    model: reviewer.model,
    check,
    noCost: "its review's cap can't stop it.",
  });
}

/** An agent's readiness for a model (empty: its own choice); `noCost` ends the no-cost warning. */
function agentReadiness({
  agent,
  model,
  check,
  noCost,
}: {
  agent: string;
  model: string;
  check: AgentCheck | undefined;
  noCost: string;
}): ClassReadiness {
  if (agent === CLAUDE_AGENT) return READY;
  if (!check) {
    const checking = `Checking ${agentName(agent)}…`;
    return { ready: false, text: checking, warning: null, signIn: null, recheck: null };
  }
  const { name, result } = check;
  const blocked = (text: string, signIn: string | null = null): ClassReadiness => ({
    ready: false,
    text,
    warning: null,
    signIn,
    recheck: agent,
  });
  switch (result.kind) {
    case 'notInstalled':
      return blocked(
        `${name} isn't installed: \`${result.command}\` isn't on your PATH. Install it and sign in yourself.`,
      );
    case 'signIn':
      return blocked(
        result.via
          ? `Sign in to ${name} first (${result.command}). ${result.message}`
          : `Sign in to ${name} in a terminal first, then check again. ${result.message}`,
        result.via ? agent : null,
      );
    case 'failed':
      return blocked(`${name} couldn't start a session: ${result.message}`);
    case 'ready': {
      if (model && result.models && !result.models.includes(model)) {
        return blocked(`${name} doesn't offer ${model}. It offers ${result.models.join(', ')}.`);
      }
      const picks = model && !result.models ? ` It picks its own model, not ${model}.` : '';
      return {
        ready: true,
        text: `${name} is ready.${picks}`,
        warning: check.costReported ? null : `${name} reports no cost: ${noCost}`,
        signIn: null,
        recheck: null,
      };
    }
  }
}

/** A reviewing councillor's ACP agent from the snapshot's councillors (#201); null on Claude. */
export function reviewerAgentOf(
  snapshot: Snapshot | null | undefined,
): (councillorId: string) => ReviewerAgent | null {
  return (councillorId) => {
    const councillor = snapshot?.councillors?.find((c) => c.id === councillorId);
    if (!councillor?.agent || councillor.agent === CLAUDE_AGENT) return null;
    return { councillorId, agent: councillor.agent, model: councillor.model ?? '' };
  };
}

/** Every class's agent and every reviewing councillor's agent has passed its check (#199, #201). */
export function partyReady({
  partyCheck,
  classIds,
  fields,
}: {
  partyCheck: PartyCheck;
  classIds: readonly string[];
  fields: readonly { reviewers: readonly ReviewerAgent[] }[];
}): boolean {
  return (
    partyCheck.allReady(classIds) &&
    fields.every((f) => f.reviewers.every((r) => partyCheck.reviewerReadiness(r).ready))
  );
}

/**
 * The party check's store (§11.5, #199): asks the extension to check the ACP agents of the classes a
 * panel shows, keeps each agent's answer, and tells the panels when one arrives. The extension holds
 * an answer a few minutes, so asking again when a panel opens is cheap.
 */
export function mountPartyCheck({ host }: { host: Host }): PartyCheck {
  const checks = new Map<string, AgentCheck>();
  const checking = new Set<string>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  host.onHostEvent((event) => {
    if (event.type !== 'agentCheck') return;
    checks.set(event.check.agent, event.check);
    checking.delete(event.check.agent);
    changed();
  });
  const classOf = (classId: string) => heroClasses().find((c) => c.id === classId);
  const ask = ({ agents, force }: { agents: string[]; force: boolean }) => {
    if (agents.length === 0) return;
    for (const agent of agents) {
      checking.add(agent);
      checks.delete(agent);
    }
    changed();
    host.request({
      channel: 'host',
      type: 'checkAgents',
      agents: agents as [string, ...string[]],
      ...(force ? { force } : {}),
    });
  };
  const readiness = (classId: string) => {
    const heroClass = classOf(classId);
    return classReadiness({ heroClass, check: heroClass && checks.get(heroClass.agent) });
  };
  const checkAgents = (agents: readonly (string | undefined)[]) => {
    const fresh = agents.filter((a): a is string => !!a && a !== CLAUDE_AGENT && !checking.has(a));
    ask({ agents: [...new Set(fresh)], force: false });
  };
  return {
    check: (classIds) => checkAgents(classIds.map((id) => classOf(id)?.agent)),
    checkAgents,
    readiness,
    reviewerReadiness: (reviewer) =>
      reviewerReadiness({ reviewer, check: checks.get(reviewer.agent) }),
    allReady: (classIds) => classIds.every((id) => readiness(id).ready),
    signIn: (agent) => host.request({ channel: 'host', type: 'signInAgent', agent }),
    recheck: (agent) => ask({ agents: [agent], force: true }),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * A class's line under its select (#199), or a reviewing councillor's under its review effort (#201):
 * the agent's state, Sign in and Check again when they help, and the no-cost warning. Empty for
 * Claude.
 */
export function readinessLine({
  partyCheck,
  classId,
  reviewer,
}: {
  partyCheck: PartyCheck;
  classId?: string;
  reviewer?: ReviewerAgent;
}): HTMLElement {
  const r = reviewer ? partyCheck.reviewerReadiness(reviewer) : partyCheck.readiness(classId ?? '');
  const line = el('div', { className: `agent-check${r.ready ? ' ready' : ''}` });
  line.setAttribute('role', 'status');
  if (r.text) {
    line.append(el('p', { className: `agent-state${r.ready ? '' : ' blocked'}`, text: r.text }));
  }
  if (r.warning) line.append(el('p', { className: 'agent-state warning', text: r.warning }));
  const actions: HTMLButtonElement[] = [];
  const signInAgent = r.signIn;
  if (signInAgent) {
    actions.push(button({ label: 'Sign in', onClick: () => partyCheck.signIn(signInAgent) }));
  }
  const recheckAgent = r.recheck;
  if (recheckAgent) {
    actions.push(button({ label: 'Check again', onClick: () => partyCheck.recheck(recheckAgent) }));
  }
  if (actions.length > 0) {
    const row = el('div', { className: 'actions' });
    row.append(...actions);
    line.append(row);
  }
  return line;
}
