import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./lib/tools.js";

// Stdio transport reserves stdout for JSON-RPC messages.
// Redirect console.log to stderr so library or debug output
// never corrupts the protocol.
const nativeLog = console.log;
console.log = (...args: unknown[]) => console.error(...args);

const server = new McpServer({
  name: "mini-terminal-mcp",
  version: "0.1.0",
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
nativeLog("[mcp] connected via stdio");
