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
});
