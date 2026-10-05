import * as assert from 'node:assert/strict';
import type { GameMasterEvent } from '@ibitsa/core';
import type { AgentEvent, CoreMessage, Snapshot } from '@ibitsa/protocol';
import type { AgentAdapter, AgentSession, GameMaster, SessionStart } from '@ibitsa/runtime';
import * as vscode from 'vscode';
import type { IbitsaApi, TestingApi } from '../extension.types';

class FakeSession implements AgentSession {
  calls: unknown[][] = [];
  constructor(
    readonly start: SessionStart,
    readonly emit: (event: AgentEvent) => void,
  ) {}
  send(...args: unknown[]) {
    this.calls.push(['send', ...args]);
  }
  interrupt() {
    this.calls.push(['interrupt']);
  }
  respondToPermission(answer: unknown) {
    this.calls.push(['respondToPermission', answer]);
  }
  answerQuestion(...args: unknown[]) {
    this.calls.push(['answerQuestion', ...args]);
  }
  completeSubmit(result: unknown) {
    this.calls.push(['completeSubmit', result]);
  }
  close() {
    this.calls.push(['close']);
  }
}

const sessions: FakeSession[] = [];
const adapter: AgentAdapter = {
  capabilities: { budgetCap: true, costReported: true },
  startSession: (start, onEvent) => {
    const session = new FakeSession(start, onEvent);
    sessions.push(session);
    return session;
  },
  resumeSession: (resume, onEvent) => {
    const session = new FakeSession({ ...resume, prompt: resume.prompt ?? '' }, onEvent);
    sessions.push(session);
    return session;
  },
};
const gameMaster: GameMaster = {
  createWorktree: async ({ islandId, branch }): Promise<GameMasterEvent> => ({
    type: 'worktreeCreated',
    islandId,
    path: `/tmp/wt/${branch}`,
    branch,
  }),
  checkSubmit: async ({ heroId, toolUseId }): Promise<GameMasterEvent> => ({
    type: 'submitChecked',
    heroId,
    toolUseId,
    ok: true,
  }),
  observeDiff: async () => 'hash',
  removeWorktree: async () => ({ ok: true }),
  scanRepo: async () => ({ defaultBranch: 'main', branches: ['main'], uncommittedChanges: 0 }),
};

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

suite('extension wiring (#36)', () => {
  let api: TestingApi;
  const notes: string[] = [];
  const lastSnapshot = (): Snapshot | undefined =>
    (
      api
        .posted()
        .filter((m) => m.type === 'snapshot')
        .at(-1) as Extract<CoreMessage, { type: 'snapshot' }> | undefined
    )?.snapshot;
  const gameTabLabel = () =>
    vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .find((t) => t.input instanceof vscode.TabInputWebview)?.label;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<IbitsaApi>('ibitsa-dev.ibitsa');
    const testing = (await extension?.activate())?.testing;
    assert.ok(testing, 'the extension exposes its testing API with IBITSA_TESTING=1');
    api = testing;
    api.useDependencies(() => ({ adapter, gameMaster }));
    api.useNotifier(async (message) => {
      notes.push(message);
      return false;
    });
  });

  test("the game's hello gets welcome and a snapshot from the runtime", async () => {
    await vscode.commands.executeCommand('ibitsa.openGame');
    await until(
      () => api.posted().some((m) => m.type === 'welcome') && lastSnapshot() !== undefined,
      'welcome and a snapshot',
    );
  });

  test('a command round-trips through the runtime to the hero session', async () => {
    api.receive({
      type: 'startQuest',
      commandId: 'q1',
      description: 'Fix the login redirect',
      heroName: 'Ranger Ilse',
      classId: 'ranger',
      baseRef: 'main',
    });
    await until(() => sessions.length === 1, 'the hero session to start');
    const session = sessions[0] as FakeSession;
    assert.equal(session.start.cwd, '/tmp/wt/ibitsa/fix-the-login-redirect');
    session.emit({ type: 'sessionStarted', sessionId: session.start.sessionId });
    session.emit({
      type: 'permission',
      requestId: 'r1',
      tool: 'Bash',
      input: { command: 'pnpm test' },
    });
    await until(() => lastSnapshot()?.needsYou[0]?.kind === 'permission', 'the permission item');
    const itemId = lastSnapshot()?.needsYou[0]?.id;
    api.receive({ type: 'answerPermission', commandId: 'a1', itemId, decision: 'allow' });
    await until(
      () => session.calls.some((c) => c[0] === 'respondToPermission'),
      'the answer to reach the session',
    );
    assert.deepEqual(
      session.calls.find((c) => c[0] === 'respondToPermission'),
      ['respondToPermission', { requestId: 'r1', decision: 'allow' }],
    );
  });

  test('needs you while the game is hidden: a notification, and the count in the tab title', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'covering the game tab' });
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Active,
      preview: false,
    });
    (sessions[0] as FakeSession).emit({
      type: 'question',
      requestId: 'q1',
      questions: [
        {
          question: 'Which database?',
          header: 'Database',
          options: [
            { label: 'Postgres', description: '' },
            { label: 'SQLite', description: '' },
          ],
          multiSelect: false,
        },
      ],
    });
    await until(() => notes.length === 1, 'a notification');
    assert.equal(notes[0], 'Ranger Ilse asks: Which database?');
    await until(
      () => gameTabLabel() === 'Ibitsa · 1 waiting',
      'the waiting count in the tab title',
    );
  });

  test('a reload rebuilds the quest from the log and offers to resume', async () => {
    await api.restartRuntime();
    api.receive({ type: 'hello', protocolVersion: 1 });
    await until(
      () => lastSnapshot()?.heroes[0]?.state.kind === 'unknown',
      'the hero to show as not resumed',
    );
    assert.deepEqual(
      lastSnapshot()?.needsYou.map((i) => i.kind),
      ['error'],
      'the question from the old process is dropped; an error item offers resume',
    );
  });
});
