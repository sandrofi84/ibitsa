// The MCP tool bridge (spec §11.5, #197), bundled as `dist/mcp-bridge.cjs`: an ACP agent starts it
// from `session/new` to reach Ibitsa's tools (`submit_task`), and it talks to the runtime over the
// local socket named in its environment. stdout carries MCP, so this file prints nothing.
import { runMcpBridge } from '@ibitsa/agent-acp';

void runMcpBridge({ input: process.stdin, output: process.stdout, env: process.env }).then(
  (code) => {
    process.exitCode = code;
  },
);
