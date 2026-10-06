import { parseLog } from '@ibitsa/agent-fake';
import m3RoundTable from '@ibitsa/agent-fake/fixtures/m3-round-table.jsonl?raw';
import type { CoreMessage } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { DevHost } from './dev-host';

const flush = () => new Promise((r) => setTimeout(r, 0));

function interactive() {
  const host = new DevHost(parseLog(m3RoundTable), { speed: 'instant', mode: 'interactive' });
  const messages: CoreMessage[] = [];
  host.onMessage((m) => messages.push(m));
  const sitting = () => {
    const last = messages.filter((m) => m.type === 'snapshot').at(-1);
    return last?.type === 'snapshot' ? last.snapshot.sitting : null;
  };
  return { host, messages, sitting };
}

describe('DevHost and the council (#102)', () => {
  it('waits for your answers, plays the councillor answering "Why?", then carries on', async () => {
    const { host, sitting } = interactive();
    host.replay.play();
    await flush();
    expect(host.replay.status.waitingFor).toBe('answerCouncil');
    expect(sitting()?.questions?.items.map((q) => q.councillorId)).toEqual([
      'architect',
      'security',
    ]);

    host.send({ type: 'askCouncilWhy', commandId: 'ui-1', batchId: 'b6', questionId: 'q7' });
    host.send({
      type: 'askCouncilWhy',
      commandId: 'ui-2',
      batchId: 'b6',
      questionId: 'q8',
      text: 'What about a day?',
    });
    await flush();
    expect(sitting()?.dialogue.map((l) => [l.speaker, l.questionId])).toEqual([
      ['you', 'q7'],
      ['architect', 'q7'],
      ['you', 'q8'],
      ['security', 'q8'],
    ]);
    expect(sitting()?.dialogue[1]?.text).toMatch(/That is why I ask\.$/);
    expect(sitting()?.dialogue[3]?.text).toMatch(/^Good question\. /);

    host.send({
      type: 'answerCouncil',
      commandId: 'ui-3',
      batchId: 'b6',
      answers: { q7: { optionId: 'email' }, q8: { text: 'A week' } },
    });
    await flush();
    expect(sitting()?.status).toBe('approved');
  });

  it('says nothing for a "Why?" core refuses', async () => {
    const { host, messages, sitting } = interactive();
    host.replay.play();
    await flush();
    host.send({ type: 'askCouncilWhy', commandId: 'ui-1', batchId: 'b6', questionId: 'q99' });
    await flush();
    expect(sitting()?.dialogue).toEqual([]);
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'cue',
        cue: expect.objectContaining({ reason: 'That question is no longer open.' }),
      }),
    );
  });
});
