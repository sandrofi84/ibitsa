import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CouncilEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';
import type { SdkModule } from './claude-adapter.types';
import { loadSdk } from './claude-session';

const EVENTS = join(tmpdir(), 'ibitsa-chambers-smoke.jsonl');
const TRACE = join(tmpdir(), 'ibitsa-chambers-trace.jsonl');
/** Give up after this long with nothing from the session, rather than wait for the test's timeout. */
const QUIET_MS = 180_000;

/**
 * The real SDK, with every message it streams written to the trace: which chambers the elder starts,
 * each tool call and the chamber it came from, and the tool results (refusals included).
 */
async function tracedSdk(onMessage: () => void): Promise<SdkModule> {
  const sdk = await loadSdk();
  return {
    ...sdk,
    query: (args) => {
      const query = sdk.query(args);
      const iterate = query[Symbol.asyncIterator].bind(query);
      return Object.assign(query, {
        [Symbol.asyncIterator]: () => {
          const it = iterate();
          return {
            next: async () => {
              const r = await it.next();
              if (!r.done) {
                onMessage();
                appendFileSync(TRACE, `${JSON.stringify(trim(r.value))}\n`);
              }
              return r;
            },
          };
        },
      });
    },
  };
}

/** A message without the bulky parts: text and tool calls, results, and who made them. */
function trim(m: SDKMessage): unknown {
  if (m.type === 'assistant' || m.type === 'user') {
    const content = Array.isArray(m.message.content) ? m.message.content : [m.message.content];
    return {
      type: m.type,
      parent: m.parent_tool_use_id,
      content: content.map((c) =>
        typeof c === 'string' ? c.slice(0, 300) : JSON.stringify(c).slice(0, 600),
      ),
    };
  }
  if (m.type === 'result') return { type: 'result', subtype: m.subtype, cost: m.total_cost_usd };
  return { type: m.type, subtype: (m as { subtype?: string }).subtype };
}

// A live sitting in separate chambers (#105) on this repository with two real built-in councillors at
// Light effort (Haiku chambers, a Haiku elder, a $0.50 cap: two $0.10 shares plus the $0.30 reserve).
// It plays core's part: accepts every call, answers each question with its recommendation (or its
// first option), and stops once a plan is proposed. Only runs on request:
//   IBITSA_SMOKE=1 pnpm exec vitest run --project @ibitsa/agent-claude-sdk chambers-smoke
// Events go to <tmpdir>/ibitsa-chambers-smoke.jsonl as they come, and the SDK's raw stream (trimmed)
// to <tmpdir>/ibitsa-chambers-trace.jsonl, so a failed run can still be read.
describe.skipIf(process.env.IBITSA_SMOKE !== '1')('live separate chambers (smoke)', () => {
  it('each councillor reports from its own chamber, then the elder asks and proposes', async () => {
    const repo = join(__dirname, '..', '..', '..', '..');
    writeFileSync(EVENTS, '');
    writeFileSync(TRACE, '');
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let stop: () => void = () => {};
    const heard = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => stop(), QUIET_MS);
    };
    const adapter = new ClaudeAdapter({
      env: () => ({ ...process.env }),
      pluginDirs: () => [join(repo, 'packages', 'extension', 'plugin')],
      loadSdk: () => tracedSdk(heard),
    });
    const events: CouncilEvent[] = [];
    await new Promise<void>((resolve) => {
      const session = adapter.startSitting(
        {
          cwd: repo,
          mode: 'chambers',
          task: 'Make scripts/coverage-summary.mjs also print a total row across all packages.',
          brief: null,
          roster: [
            { councillorId: 'architect', effort: 'light', model: 'haiku' },
            { councillorId: 'tester', effort: 'light', model: 'haiku' },
          ],
          model: 'haiku',
          maxBudgetMicroUsd: 500_000,
        },
        (event) => {
          events.push(event);
          appendFileSync(EVENTS, `${JSON.stringify(event)}\n`);
          // Wait for the turn's result (and its cost) before closing.
          const finish = () =>
            setTimeout(() => {
              session.close();
              resolve();
            }, 15_000);
          if (event.type === 'reportFiled') {
            session.completeTool({ toolUseId: event.toolUseId, accepted: true });
          }
          if (event.type === 'questionsAsked') {
            session.completeTool({ toolUseId: event.toolUseId, accepted: true });
            session.answer({
              toolUseId: event.toolUseId,
              answers: event.questions.map((q) =>
                q.options.length > 0
                  ? { optionId: q.recommendation?.optionId ?? q.options[0]?.id ?? '' }
                  : { text: 'Keep it simple.' },
              ),
            });
          }
          if (event.type === 'planProposed') {
            // As core does: no plan until every councillor has reported.
            const reported = new Set(
              events.flatMap((e) => (e.type === 'reportFiled' ? [e.councillorId] : [])),
            );
            const missing = ['architect', 'tester'].filter((id) => !reported.has(id));
            if (missing.length > 0) {
              session.completeTool({
                toolUseId: event.toolUseId,
                accepted: false,
                reason: `Every councillor must report before a plan is proposed. Waiting for: ${missing.join(', ')}.`,
              });
              return;
            }
            session.completeTool({ toolUseId: event.toolUseId, accepted: true });
            finish();
          }
          if (event.type === 'error') finish();
        },
      );
      stop = () => {
        session.close();
        resolve();
      };
      heard();
    });
    clearTimeout(quiet);
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    const reported = events.flatMap((e) => (e.type === 'reportFiled' ? [e.councillorId] : []));
    expect(new Set(reported)).toEqual(new Set(['architect', 'tester']));
    expect(events.some((e) => e.type === 'planProposed')).toBe(true);
  }, 900_000);
});
