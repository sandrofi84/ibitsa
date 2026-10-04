import { describe, expect, it } from 'vitest';
import { LogFormatError, type LogHeader, type LogRecord, parseLog, serializeLine } from './log';

const header: LogHeader = {
  kind: 'header',
  logVersion: 1,
  protocolVersion: 1,
  campaignId: 'c1',
  startedAt: '2026-10-04T15:00:00.000Z',
};
const records: LogRecord[] = [
  { kind: 'command', t: 0, command: { type: 'abandonQuest', commandId: 'x1' } },
  { kind: 'agent', t: 10, heroId: 'h4', event: { type: 'turnStarted' }, mark: 'start' },
  { kind: 'timer', t: 20, timerId: 'silence:h4' },
];
const text = [header, ...records].map(serializeLine).join('');

describe('parseLog', () => {
  it('round-trips serialized lines', () => {
    expect(parseLog(text)).toEqual({ header, records, tornTail: false });
  });

  it('skips a torn last line from a crash mid-write', () => {
    const torn = `${text}{"kind":"agent","t":30,"heroId":"h4","ev`;
    expect(parseLog(torn)).toEqual({ header, records, tornTail: true });
  });

  it.each([
    ['a missing header', serializeLine(records[0] as LogRecord)],
    ['an unknown logVersion', serializeLine({ ...header, logVersion: 2 })],
    ['an unknown protocolVersion', serializeLine({ ...header, protocolVersion: 9 })],
    [
      'bad JSON before the last line',
      `${serializeLine(header)}{oops\n${serializeLine(records[0] as LogRecord)}`,
    ],
    ['an unknown record kind', `${serializeLine(header)}{"kind":"noise","t":0}\n`],
    [
      'decreasing t',
      [header, { ...records[1], t: 50 }, records[2]]
        .map((e) => serializeLine(e as LogRecord))
        .join(''),
    ],
    [
      'an invalid command',
      `${serializeLine(header)}${JSON.stringify({ kind: 'command', t: 0, command: { type: 'stopHero' } })}\n`,
    ],
  ])('rejects %s', (_, input) => {
    expect(() => parseLog(input)).toThrow(LogFormatError);
  });
});
