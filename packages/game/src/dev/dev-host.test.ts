import { parseLog } from '@ibitsa/agent-fake';
import m0Walk from '@ibitsa/agent-fake/fixtures/m0-walk.jsonl?raw';
import type { CoreMessage } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { DevHost } from './dev-host';

async function collect(host: DevHost): Promise<CoreMessage[]> {
  const messages: CoreMessage[] = [];
  host.onMessage((m) => messages.push(m));
  return messages;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('DevHost', () => {
  it('answers hello with welcome and a snapshot', async () => {
    const host = new DevHost(parseLog(m0Walk), {});
    const messages = await collect(host);
    host.send({ type: 'hello', protocolVersion: 1 });
    await flush();
    expect(messages.map((m) => m.type)).toEqual(['welcome', 'snapshot']);
    expect(messages.map((m) => m.seq)).toEqual([1, 2]);
  });

  it('runs the replay through the real core, ending submitted', async () => {
    const host = new DevHost(parseLog(m0Walk), { speed: 'instant' });
    const messages = await collect(host);
    host.replay.play();
    await flush();
    const last = messages.filter((m) => m.type === 'snapshot').at(-1);
    expect(last?.type === 'snapshot' && last.snapshot.heroes[0]?.state.kind).toBe('submitted');
    const seqs = messages.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('rejects live commands in auto mode', async () => {
    const host = new DevHost(parseLog(m0Walk), {});
    const messages = await collect(host);
    host.send({ type: 'stopHero', commandId: 'ui-1', heroId: 'h4' });
    await flush();
    expect(messages).toEqual([
      expect.objectContaining({
        type: 'cue',
        cue: expect.objectContaining({ type: 'commandRejected', commandId: 'ui-1' }),
      }),
    ]);
  });

  it('answers host requests as if credentials were set', async () => {
    const host = new DevHost(parseLog(m0Walk), {});
    const events: string[] = [];
    host.onHostEvent((e) => events.push(e.type));
    host.request({ channel: 'host', type: 'credentialsStatus' });
    await flush();
    expect(events).toEqual(['credentials']);
  });

  it('keeps the journal as it replays, answers pages, and starts over when it loops (#58)', async () => {
    const host = new DevHost(parseLog(m0Walk), { speed: 'instant' });
    const messages = await collect(host);
    host.replay.play();
    await flush();
    const appends = messages.filter((m) => m.type === 'journalAppend');
    expect(appends[0]).toMatchObject({ start: 0 });
    host.send({ type: 'requestJournal', limit: 3 });
    await flush();
    const page = messages.filter((m) => m.type === 'journal').at(-1);
    expect(page?.type === 'journal' && page.entries).toHaveLength(3);
    expect(page?.type === 'journal' && page.start + 3).toBe(page?.type === 'journal' && page.total);

    const looping = new DevHost(parseLog(m0Walk), { speed: 'instant', loop: true });
    const again = await collect(looping);
    looping.replay.play();
    await flush();
    looping.replay.pause();
    expect(
      again.some((m) => m.type === 'journalAppend' && m.start === 0 && m.entries.length === 0),
    ).toBe(true);
  });

  it('ignores forgetting a project rule: the replay keeps none (#62)', async () => {
    const host = new DevHost(parseLog(m0Walk), {});
    const messages = await collect(host);
    host.send({ type: 'forgetProjectRule', rule: 'Bash(x)' });
    await flush();
    expect(messages).toEqual([]);
  });

  it('answers requestFiles with the demo worktree (#83)', async () => {
    const host = new DevHost(parseLog(m0Walk), {});
    const messages = await collect(host);
    host.send({ type: 'requestFiles', islandId: 'i2' });
    await flush();
    expect(messages).toEqual([
      expect.objectContaining({
        type: 'files',
        islandId: 'i2',
        paths: expect.arrayContaining(['README.md']),
      }),
    ]);
  });

  it('answers the / menu with the built-ins (#84)', async () => {
    const host = new DevHost(parseLog(m0Walk), {});
    const messages = await collect(host);
    host.send({ type: 'requestActions' });
    await flush();
    const actions = messages.find((m) => m.type === 'actions');
    expect(actions?.type === 'actions' && actions.actions.map((a) => a.name)).toContain(
      'ibitsa:test',
    );
  });

  it('previews the built-ins, and has none for unknown actions (#85)', async () => {
    const host = new DevHost(parseLog(m0Walk), {});
    const messages = await collect(host);
    host.send({ type: 'requestPreview', name: 'ibitsa:test', args: 'unit' });
    host.send({ type: 'requestPreview', name: 'other', args: '' });
    await flush();
    const previews = messages.flatMap((m) => (m.type === 'preview' ? [m.preview] : []));
    expect(previews[0]?.text).toContain('Only these tests if given: unit');
    expect(previews[1]?.text).toBeNull();
  });

  it('keeps new actions in memory, refusing a taken name unless overwriting (#86)', async () => {
    const host = new DevHost(parseLog(m0Walk), {});
    const messages = await collect(host);
    const draft = {
      name: 'pr-summary',
      description: 'Summarize',
      argumentHint: '',
      prompt: 'p',
      target: 'any' as const,
      scope: 'personal' as const,
    };
    host.send({ type: 'createAction', ...draft });
    host.send({ type: 'createAction', ...draft });
    host.send({ type: 'createAction', ...draft, scope: 'project', overwrite: true });
    host.send({ type: 'createAction', ...draft, name: 'test' });
    await flush();
    expect(messages.map((m) => m.type)).toEqual([
      'actionCreated',
      'actions',
      'actionRejected',
      'actionCreated',
      'actions',
      'actionRejected',
    ]);
    const last = messages.filter((m) => m.type === 'actions').at(-1);
    expect(last?.type === 'actions' && last.actions.filter((a) => a.name === 'pr-summary')).toEqual(
      [expect.objectContaining({ source: 'project', target: 'any' })],
    );
  });
});
