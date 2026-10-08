import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_PRESETS, type AgentEvent, checkVerdict, type ReviewEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { AcpAdapter } from './acp-adapter';
import { AgentSandbox, sandboxSupported } from './sandbox';
import { ToolBridge } from './tool-bridge';

// A live check of M9 (#202): a Codex hero, inside Ibitsa's sandbox, does a small task in a scratch
// repo and submits it through the tool bridge; then a councillor reviews the change on Codex. Uses
// the ChatGPT plan `codex login` signed in to, so it only runs on request, on macOS or Linux:
//   IBITSA_SMOKE=1 pnpm exec vitest run --project @ibitsa/agent-acp codex-smoke
// The events are written to <tmpdir>/ibitsa-codex-smoke.json.
const BRIDGE_SCRIPT = fileURLToPath(new URL('../test/mcp-bridge.mjs', import.meta.url));
const SANDBOX_SCRIPT = fileURLToPath(new URL('../test/sandbox-host.mjs', import.meta.url));
const TASK = {
  title: 'Say goodbye',
  description:
    'Add an exported function `farewell(name)` to src/greet.js that returns `Goodbye, <name>!`, next to `greet`.',
};

/** A git repo with one commit, as a hero's worktree. */
function scratchRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'ibitsa-codex-smoke-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'smoke@ibitsa.test');
  git('config', 'user.name', 'Ibitsa smoke');
  execFileSync('mkdir', ['-p', join(repo, 'src')]);
  writeFileSync(
    join(repo, 'src', 'greet.js'),
    "export function greet(name) {\n  return 'Hello, ' + name + '!';\n}\n",
  );
  git('add', '.');
  git('commit', '-q', '-m', 'greet');
  return repo;
}

describe.skipIf(process.env.IBITSA_SMOKE !== '1' || !sandboxSupported(process.platform))(
  'live Codex hero and reviewer, sandboxed (smoke)',
  () => {
    it('submits a small change through the bridge, and a Codex reviewer rules on it', async () => {
      const preset = AGENT_PRESETS.find((agent) => agent.id === 'codex');
      if (!preset) throw new Error('no Codex preset');
      const repo = scratchRepo();
      const bridge = new ToolBridge({ script: BRIDGE_SCRIPT, node: { command: process.execPath } });
      const sandbox = new AgentSandbox({
        script: SANDBOX_SCRIPT,
        node: { command: process.execPath },
        bridgeSocket: bridge.socketPath,
      });
      const profile = {
        stateFolders: preset.stateFolders.map((path) => path.replace(/^~/, homedir())),
        domains: preset.domains,
        weakerNetworkIsolation: preset.weakerNetworkIsolation === true,
      };
      const adapter = new AcpAdapter({
        agent: {
          command: preset.command,
          args: preset.args,
          env: preset.env,
          ...(preset.sandboxedMode ? { mode: preset.sandboxedMode } : {}),
        },
        env: () => ({ ...process.env }),
        tools: bridge,
        spawn: (request) => sandbox.spawn({ request, profile }),
        sandboxed: true,
      });
      const heroEvents: AgentEvent[] = [];
      const reviewEvents: ReviewEvent[] = [];
      let heroDiff = '';
      try {
        // The hero: works in the worktree and submits through the bridge.
        await new Promise<void>((resolve) => {
          const session = adapter.startSession(
            {
              heroId: 'smoke',
              sessionId: 'codex-smoke',
              cwd: repo,
              classId: 'smoke',
              prompt: `${TASK.title}: ${TASK.description} Don't commit. When it's done, submit the task.`,
            },
            (event) => {
              heroEvents.push(event);
              if (event.type === 'taskSubmitted') {
                session.completeSubmit({ toolUseId: event.toolUseId, accepted: true });
              }
              // A new domain or anything else that asks: nobody is here to answer, so no.
              if (event.type === 'permission') {
                session.respondToPermission({ requestId: event.requestId, decision: 'deny' });
              }
              // The turn's end, submitted or not: the assertions say which.
              if (event.type === 'turnEnded' || event.type === 'error') {
                session.close();
                resolve();
              }
            },
          );
        });
        heroDiff = execFileSync('git', ['diff'], { cwd: repo, encoding: 'utf8' });

        // The reviewer: read-only, rules through `submit_verdict`.
        await new Promise<void>((resolve) => {
          const review = adapter.startReview(
            {
              cwd: repo,
              councillorId: 'tester',
              model: '',
              maxBudgetMicroUsd: 100_000,
              round: 1,
              diff: heroDiff,
              task: TASK,
              criteria: ['`farewell("Ada")` returns `Goodbye, Ada!`', '`greet` is unchanged'],
              decisions: [],
              checks: [],
              guidance: { title: 'Tester', guidance: 'Check the change does what the task asks.' },
            },
            (event) => {
              reviewEvents.push(event);
              if (event.type === 'verdictSubmitted') {
                const ruled = checkVerdict({ input: event.verdict, decisions: [] });
                review.completeTool({
                  toolUseId: event.toolUseId,
                  accepted: ruled.ok,
                  ...(ruled.ok ? {} : { reason: ruled.problems.join('; ') }),
                });
                if (ruled.ok) {
                  review.close();
                  resolve();
                }
              }
              if (event.type === 'error') {
                review.close();
                resolve();
              }
            },
          );
        });
      } finally {
        bridge.close();
        writeFileSync(
          join(tmpdir(), 'ibitsa-codex-smoke.json'),
          JSON.stringify({ heroEvents, reviewEvents }, null, 2),
        );
      }

      expect(heroEvents.filter((e) => e.type === 'error')).toEqual([]);
      expect(heroEvents.some((e) => e.type === 'taskSubmitted')).toBe(true);
      expect(readFileSync(join(repo, 'src', 'greet.js'), 'utf8')).toMatch(/farewell/);
      expect(reviewEvents.filter((e) => e.type === 'error')).toEqual([]);
      const verdicts = reviewEvents.flatMap((e) =>
        e.type === 'verdictSubmitted' ? [e.verdict.verdict] : [],
      );
      expect(['pass', 'changes']).toContain(verdicts.at(-1));
      // The reviewer only read: the worktree is as the hero left it.
      expect(execFileSync('git', ['diff'], { cwd: repo, encoding: 'utf8' })).toBe(heroDiff);
    }, 900_000);
  },
);
