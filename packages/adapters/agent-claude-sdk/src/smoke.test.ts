import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';

// A live check against a real session (#33). Spends a few cents on Haiku, so it only runs on request:
//   IBITSA_SMOKE=1 pnpm exec vitest run --project @ibitsa/agent-claude-sdk smoke
// Uses ANTHROPIC_API_KEY if set, otherwise the developer's own Claude Code login (allowed for local
// development, spec §11.6).
describe.skipIf(process.env.IBITSA_SMOKE !== '1')('live Claude session (smoke)', () => {
  it('maps a real session: start, a read, a failing command, usage, turn end', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ibitsa-smoke-'));
    writeFileSync(join(cwd, 'notes.txt'), 'hello from ibitsa\n');
    const events: AgentEvent[] = [];
    const done = new Promise<void>((resolve) => {
      const session = new ClaudeAdapter({ env: () => ({ ...process.env }) }).startSession(
        {
          heroId: 'h1',
          sessionId: crypto.randomUUID(),
          cwd,
          classId: 'rogue',
          prompt:
            'Read notes.txt with the Read tool. Then run `ls no-such-folder` with the Bash tool (it will fail; that is expected). Then reply with the single word: done.',
        },
        (event) => {
          events.push(event);
          if (event.type === 'turnEnded' || event.type === 'error') {
            session.close();
            resolve();
          }
        },
      );
    });
    await done;
    rmSync(cwd, { recursive: true, force: true });
    console.log(JSON.stringify(events, null, 2));
    expect(events[0]?.type).toBe('sessionStarted');
    expect(events.some((e) => e.type === 'activityStarted' && e.kind === 'read')).toBe(true);
    expect(events.some((e) => e.type === 'usage' && e.totalCost !== undefined)).toBe(true);
    expect(events.at(-1)?.type).toBe('turnEnded');
  }, 180_000);

  it('asks permission, asks a question, and submits through submit_task', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ibitsa-smoke-'));
    const events: AgentEvent[] = [];
    const done = new Promise<void>((resolve) => {
      const session = new ClaudeAdapter({ env: () => ({ ...process.env }) }).startSession(
        {
          heroId: 'h1',
          sessionId: crypto.randomUUID(),
          cwd,
          classId: 'rogue',
          prompt:
            'First use the AskUserQuestion tool to ask whether the file should be called hello.txt or hi.txt (two options). Then create that file containing the word hi by running `echo hi > <name>` with the Bash tool. Then call the submit_task tool with a one-sentence summary. This folder is not a git repository; do not commit.',
        },
        (event) => {
          events.push(event);
          // Answer the way "Needs you" and core would.
          if (event.type === 'question') {
            const q = event.questions[0];
            session.answerQuestion(event.requestId, {
              [q?.question ?? '']: q?.options[0]?.label ?? 'hello.txt',
            });
          }
          if (event.type === 'permission')
            session.respondToPermission({ requestId: event.requestId, decision: 'allow' });
          if (event.type === 'taskSubmitted')
            session.completeSubmit({ toolUseId: event.toolUseId, accepted: true });
          if (event.type === 'turnEnded' || event.type === 'error') {
            session.close();
            resolve();
          }
        },
      );
    });
    await done;
    rmSync(cwd, { recursive: true, force: true });
    console.log(JSON.stringify(events, null, 2));
    expect(events.some((e) => e.type === 'question')).toBe(true);
    expect(events.some((e) => e.type === 'permission')).toBe(true);
    expect(events.some((e) => e.type === 'taskSubmitted')).toBe(true);
    expect(events.at(-1)?.type).toBe('turnEnded');
  }, 240_000);

  it('confines the hero: outside edits ask, sandboxed writes outside fail, escaping the sandbox asks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ibitsa-smoke-'));
    const cwd = join(root, 'worktree');
    mkdirSync(cwd);
    const outside = join(root, 'outside.txt');
    const events: AgentEvent[] = [];
    const done = new Promise<void>((resolve) => {
      const session = new ClaudeAdapter({ env: () => ({ ...process.env }) }).startSession(
        {
          heroId: 'h1',
          sessionId: crypto.randomUUID(),
          cwd,
          classId: 'rogue',
          prompt: `Do these three steps in order and report what happened after each. 1) Use the Write tool to create ${outside} containing "a". 2) Run \`echo b > ${outside}\` with the Bash tool. 3) If step 2 failed, run the same command again with the sandbox disabled. Do not try anything else.`,
        },
        (event) => {
          events.push(event);
          // Deny everything, as a careful user would here.
          if (event.type === 'permission') {
            session.respondToPermission({
              requestId: event.requestId,
              decision: 'deny',
              note: 'Not outside the worktree.',
            });
          }
          if (event.type === 'turnEnded' || event.type === 'error') {
            session.close();
            resolve();
          }
        },
      );
    });
    await done;
    const wroteOutside = existsSync(outside);
    rmSync(root, { recursive: true, force: true });
    console.log(JSON.stringify(events, null, 2));
    expect(wroteOutside).toBe(false);
    expect(events.some((e) => e.type === 'permission' && e.tool === 'Write')).toBe(true);
  }, 240_000);
});
