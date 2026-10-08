import { describe, expect, it } from 'vitest';
import { submitResult, submittedSummary } from './hero-tools';

describe('hero tools (#197)', () => {
  it("reads submit_task's summary, trimmed, and nothing else", () => {
    expect(submittedSummary({ summary: '  Fixed it.  ' })).toBe('Fixed it.');
    expect(submittedSummary({ summary: '   ' })).toBeNull();
    expect(submittedSummary({ summary: 3 })).toBeNull();
    expect(submittedSummary(null)).toBeNull();
  });

  it("words the submit check's verdict as the Claude adapter does", () => {
    expect(submitResult({ accepted: true })).toEqual({
      text: 'Submitted. Your work will be reviewed.',
    });
    expect(submitResult({ accepted: false, reason: 'a test fails.' })).toEqual({
      text: 'Not submitted: a test fails.',
      isError: true,
    });
    expect(submitResult({ accepted: false })).toEqual({
      text: 'Not submitted: the submit check failed.',
      isError: true,
    });
  });
});
