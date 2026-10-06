import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/**
 * The environment a fresh login shell would have (#67), for hero sessions. VS Code reads the shell's
 * environment once, when the app starts, so a Node version switched with nvm afterwards never reaches
 * the extension host, and heroes ran an older Node than the user's terminal. Resolved the way VS Code
 * itself does it: an interactive login shell that prints its environment between markers, through
 * Node's own binary so shell start-up output can't get in the way. Null when it can't be resolved
 * (Windows, no shell, a timeout, unparsable output): callers fall back to the current environment.
 */
export function loginShellEnv({
  shell,
  timeoutMs = 10_000,
}: {
  shell: string | undefined;
  timeoutMs?: number;
}): Promise<Record<string, string> | null> {
  if (!shell || process.platform === 'win32') return Promise.resolve(null);
  const mark = randomUUID();
  const script = `process.stdout.write(${JSON.stringify(mark)} + JSON.stringify(process.env) + ${JSON.stringify(mark)})`;
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (env: Record<string, string> | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(env);
    };
    const child = spawn(shell, ['-i', '-l', '-c', `'${process.execPath}' -e '${script}'`], {
      // Electron's binary acts as Node with this set; plain Node ignores it.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: false,
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on('error', () => finish(null));
    child.on('close', () => {
      const parts = out.split(mark);
      try {
        const env =
          parts.length >= 3 ? (JSON.parse(parts[1] ?? '') as Record<string, string>) : null;
        if (env) delete env.ELECTRON_RUN_AS_NODE;
        finish(env);
      } catch {
        finish(null);
      }
    });
  });
}
