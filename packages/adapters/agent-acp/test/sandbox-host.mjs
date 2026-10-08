// The sandbox host for the adapter's tests (#200), run straight from source: Node strips the types.
// The extension ships the same code bundled as `dist/sandbox-host.cjs`.
import { runSandboxHost } from '../src/sandbox-host.ts';

const stops = [];
const stop = () => {
  for (const listener of stops) listener();
};
process.on('SIGTERM', stop);
process.on('disconnect', stop);
process.exitCode = await runSandboxHost({
  env: process.env,
  send: (message) => process.send?.(message),
  onMessage: (listener) => process.on('message', listener),
  onStop: (listener) => stops.push(listener),
  error: (text) => process.stderr.write(`${text}\n`),
});
process.disconnect?.();
