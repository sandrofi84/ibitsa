// The tool bridge's MCP server for the adapter's tests (#197), run straight from source: Node strips
// the types. The extension ships the same code bundled as `dist/mcp-bridge.cjs`.
import { runMcpBridge } from '../src/mcp-bridge.ts';

process.exitCode = await runMcpBridge({
  input: process.stdin,
  output: process.stdout,
  env: process.env,
});
