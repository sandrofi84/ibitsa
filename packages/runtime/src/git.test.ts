import { describe, expect, it } from 'vitest';
import { shell } from './git';

describe.skipIf(process.platform === 'win32')('shell', () => {
  it('stops a command that runs too long, children included, and says so', async () => {
    // Two commands, so the shell can't hand over to sleep: the timeout must stop the whole group.
    const started = Date.now();
    const result = await shell({ command: 'sleep 30; echo late', cwd: '.', timeoutMs: 100 });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('(stopped after 0 s)');
  });

  it('fails cleanly when the folder does not exist', async () => {
    const result = await shell({ command: 'echo hi', cwd: '/no/such/folder', timeoutMs: 5_000 });
    expect(result.ok).toBe(false);
  });
});
