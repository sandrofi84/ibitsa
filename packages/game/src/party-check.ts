import { type AgentCheck, agentName, CLAUDE_AGENT } from '@ibitsa/protocol';
import { button, el } from './dom';
import { heroClasses } from './heroes';
import type { HeroClass } from './heroes.types';
import type { Host } from './host.types';
import type { ClassReadiness, PartyCheck } from './party-check.types';

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
  if (!heroClass || heroClass.agent === CLAUDE_AGENT) return READY;
  const agent = heroClass.agent;
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
      const model = heroClass.modelId;
      if (model && result.models && !result.models.includes(model)) {
        return blocked(`${name} doesn't offer ${model}. It offers ${result.models.join(', ')}.`);
      }
      const picks = model && !result.models ? ` It picks its own model, not ${model}.` : '';
      return {
        ready: true,
        text: `${name} is ready.${picks}`,
        warning: check.costReported
          ? null
          : `${name} reports no cost: the gold pouch can't stop this hero.`,
        signIn: null,
        recheck: null,
      };
    }
  }
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
  return {
    check: (classIds) => {
      const agents = classIds
        .map((id) => classOf(id)?.agent)
        .filter((a): a is string => !!a && a !== CLAUDE_AGENT && !checking.has(a));
      ask({ agents: [...new Set(agents)], force: false });
    },
    readiness,
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
 * A class's line under its select (#199): the agent's state, Sign in and Check again when they help,
 * and the gold-pouch warning. Empty for a Claude class.
 */
export function readinessLine({
  partyCheck,
  classId,
}: {
  partyCheck: PartyCheck;
  classId: string;
}): HTMLElement {
  const r = partyCheck.readiness(classId);
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
