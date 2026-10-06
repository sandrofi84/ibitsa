import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loginShellEnv } from './login-shell-env';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A stand-in shell: prints start-up noise, sets a variable like an rc file would, then runs `-c`. */
function fakeShell(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-shell-'));
  dirs.push(dir);
  const path = join(dir, 'shell');
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe.skipIf(process.platform === 'win32')('loginShellEnv (#67)', () => {
  it("returns the login shell's environment, ignoring start-up output", async () => {
    const shell = fakeShell(
      'echo "Welcome, have a nice day"\nexport NVM_BIN=/fresh/node/bin\nshift 3\neval "$1"',
    );
    const env = await loginShellEnv({ shell });
    expect(env?.NVM_BIN).toBe('/fresh/node/bin');
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
  });

  it('gives up on a shell that never answers, or prints nothing usable', async () => {
    expect(await loginShellEnv({ shell: fakeShell('sleep 5'), timeoutMs: 200 })).toBeNull();
    expect(await loginShellEnv({ shell: fakeShell('echo nothing here') })).toBeNull();
    expect(await loginShellEnv({ shell: '/no/such/shell' })).toBeNull();
    expect(await loginShellEnv({ shell: undefined })).toBeNull();
  });
});
