import { describe, expect, it } from 'vitest';
import { shell } from './git';

describe.skipIf(process.platform === 'win32')('shell', () => {
  it('stops a command that runs too long, and says so', async () => {
    const result = await shell({ command: 'sleep 5', cwd: '.', timeoutMs: 100 });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('(stopped after 0 s)');
  });

  it('fails cleanly when the folder does not exist', async () => {
    const result = await shell({ command: 'echo hi', cwd: '/no/such/folder', timeoutMs: 5_000 });
    expect(result.ok).toBe(false);
  });
});
