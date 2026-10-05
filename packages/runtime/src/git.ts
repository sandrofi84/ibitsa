import { execFile, spawn } from 'node:child_process';
import type { CommandResult } from './git.types';

/** Runs git in `cwd`. Never throws: failures come back as `ok: false` with git's message. */
export function git(cwd: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    // biome-ignore lint/complexity/useMaxParams: Node's execFile callback is (error, stdout, stderr).
    execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}${stderr}`.trim() });
    });
  });
}

/** Runs a user-configured shell command (e.g. `pnpm install`) with a time limit. */
export function shell({
  command,
  cwd,
  timeoutMs,
}: {
  command: string;
  cwd: string;
  timeoutMs: number;
}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true });
    let output = '';
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      child.kill();
      output += `\n(stopped after ${Math.round(timeoutMs / 1000)} s)`;
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: output.trim() });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: String(error) });
    });
  });
}
