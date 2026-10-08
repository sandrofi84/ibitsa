// One hero's sandbox host (spec §11.5, #200), bundled as `dist/sandbox-host.cjs`: the runtime starts
// it for each ACP agent with a sandbox profile, and it runs the agent inside Anthropic's sandbox
// runtime on its own stdio, asking the runtime over IPC before the agent reaches a new domain.
import { runSandboxHost } from '@ibitsa/agent-acp';

const stops: (() => void)[] = [];
const stop = () => {
  for (const listener of stops) listener();
};
process.on('SIGTERM', stop);
process.on('disconnect', stop);
void runSandboxHost({
  env: process.env,
  send: (message) => process.send?.(message),
  onMessage: (listener) => process.on('message', listener),
  onStop: (listener) => stops.push(listener),
  error: (text) => process.stderr.write(`${text}\n`),
}).then((code) => {
  process.exitCode = code;
  process.disconnect?.();
});
