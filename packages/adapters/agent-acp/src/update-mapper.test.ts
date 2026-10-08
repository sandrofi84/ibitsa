import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { TestDetector } from '@ibitsa/runtime';
import { describe, expect, it } from 'vitest';
import { UpdateMapper } from './update-mapper';

const CWD = '/work/wt';
const mapper = () => new UpdateMapper({ cwd: CWD, tests: new TestDetector('/nowhere') });
const update = (u: Record<string, unknown>) => u as unknown as SessionUpdate;
const call = (fields: Record<string, unknown>) =>
  update({
    sessionUpdate: 'tool_call',
    toolCallId: 't',
    title: '',
    status: 'in_progress',
    ...fields,
  });

describe('UpdateMapper: activities (spec §5.4)', () => {
  it.each([
    [
      { kind: 'edit', locations: [{ path: `${CWD}/src/a.ts` }] },
      { kind: 'edit', detail: 'src/a.ts' },
    ],
    [
      { kind: 'delete', locations: [{ path: 'b.ts' }] },
      { kind: 'edit', detail: 'b.ts' },
    ],
    [
      { kind: 'move', locations: [{ path: '/elsewhere/c.ts' }] },
      { kind: 'edit', detail: '/elsewhere/c.ts' },
    ],
    [
      { kind: 'read', locations: [{ path: CWD }] },
      { kind: 'read', detail: '.' },
    ],
    [
      { kind: 'search', title: 'grep logout' },
      { kind: 'search', detail: 'grep logout' },
    ],
    [
      { kind: 'fetch', title: 'https://x.dev' },
      { kind: 'search', detail: 'https://x.dev' },
    ],
    [{ kind: 'think', title: '' }, { kind: 'think' }],
    [
      { kind: 'switch_mode', title: 'Plan mode' },
      { kind: 'other', detail: 'Plan mode' },
    ],
    [
      { kind: 'teleport', title: 'Newer kind' },
      { kind: 'other', detail: 'Newer kind' },
    ],
    [{ title: 'No kind' }, { kind: 'other', detail: 'No kind' }],
    [
      { kind: 'execute', title: 'git status', rawInput: 'git status' },
      { kind: 'run', detail: 'git status' },
    ],
    [
      { kind: 'execute', title: 'Run', rawInput: { command: 'go test ./...' } },
      { kind: 'test', detail: 'go test ./...' },
    ],
  ])('%j → %j', (fields, activity) => {
    expect(mapper().update(call(fields))).toEqual([
      { type: 'activityStarted', toolUseId: 't', ...activity },
    ]);
  });

  it('keeps details short and to one line', () => {
    const [started] = mapper().update(
      call({ kind: 'execute', title: `echo ${'x'.repeat(200)}\nsecond line` }),
    );
    expect(started?.type === 'activityStarted' && started.detail?.length).toBe(120);
  });

  it('shows a tool reported only once finished, and ignores progress before the end', () => {
    const m = mapper();
    expect(
      m.update(
        update({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'in_progress' }),
      ),
    ).toEqual([]);
    expect(
      m.update(
        update({
          sessionUpdate: 'tool_call_update',
          toolCallId: 't',
          status: 'completed',
          kind: 'read',
        }),
      ),
    ).toEqual([
      { type: 'activityStarted', toolUseId: 't', kind: 'read' },
      { type: 'activityFinished', toolUseId: 't', outcome: 'ok' },
    ]);
  });

  it('treats a repeated tool_call as an update of the same tool', () => {
    const m = mapper();
    m.update(call({ kind: 'read' }));
    expect(m.update(call({ kind: 'read', status: 'completed' }))).toEqual([
      { type: 'activityFinished', toolUseId: 't', outcome: 'ok' },
    ]);
  });
});

describe('UpdateMapper: messages', () => {
  it('ignores what is not the agent’s text', () => {
    const m = mapper();
    expect(
      m.update(
        update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'image', data: '', mimeType: 'image/png' },
        }),
      ),
    ).toEqual([]);
    expect(
      m.update(
        update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }),
      ),
    ).toEqual([]);
    expect(m.flush()).toEqual([]);
  });
});

describe('UpdateMapper: rests the agent takes itself', () => {
  it('reports an agent-started compaction as automatic, and a failed one as ended', () => {
    const m = mapper();
    m.update(update({ sessionUpdate: 'usage_update', used: 90_000, size: 100_000 }));
    expect(
      m.update(
        update({ sessionUpdate: 'compaction_update', compactionId: 'c', status: 'in_progress' }),
      ),
    ).toEqual([{ type: 'resting' }]);
    expect(
      m.update(update({ sessionUpdate: 'compaction_update', compactionId: 'c', status: 'failed' })),
    ).toEqual([{ type: 'compacted', trigger: 'auto', preTokens: 90_000 }]);
  });
});
