/**
 * NEWO MCP server (stdio transport).
 *
 * Boots an `@modelcontextprotocol/sdk` server, registers every tool from
 * `./tools/index.ts`, and listens on stdio. Designed to be invoked as
 * `newo mcp serve`. Stdio is the right transport because:
 *
 *   - Claude Code / Cowork install local plugins via stdio out of the box
 *   - No port management, no hosting, no auth on top of the existing CLI
 *     auth (the server reuses NEWO_API_KEY from the user's .env)
 *   - Each MCP client gets its own server process so we never multiplex
 *     customer credentials across users
 *
 * Stdout is reserved for JSON-RPC frames. All diagnostic output goes to
 * stderr. The console.log shim guards against accidental stdout writes from
 * shared CLI code.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ALL_TOOLS } from './tools/index.js';

/**
 * Redirect any stray stdout writes to stderr so a noisy library can't
 * corrupt the JSON-RPC stream. Tools should never `console.log`, but the
 * existing CLI auth / API client modules sometimes do.
 */
function guardStdout(): void {
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    process.stderr.write(`[newo mcp] ${args.map(String).join(' ')}\n`);
  };
  // Also guard against direct process.stdout.write outside the SDK. We can't
  // intercept that without breaking the transport, so we just rely on shared
  // code using console.log (which is now redirected).
  void origLog;
}

export async function startMcpServer(): Promise<void> {
  guardStdout();

  // Suppress verbose auth logs by default; users get errors via stderr.
  process.env.NEWO_QUIET_MODE = process.env.NEWO_QUIET_MODE ?? 'true';

  const server = new McpServer(
    {
      name: 'newo-mcp',
      version: '3.8.0',
    },
    {
      capabilities: {
        tools: { listChanged: false },
      },
    }
  );

  for (const tool of ALL_TOOLS) {
    // The SDK's `registerTool` wants a raw Zod shape, not a wrapped object.
    // Each of our tools defines `inputSchema: z.object({ ... })`, so we unwrap
    // via `.shape`. Tools with no inputs use an empty object literal.
    const shape = (tool.inputSchema as any).shape ?? {};

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: shape,
      },
      tool.handler as any
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // The transport blocks until the parent closes stdin; nothing to do here.
  process.stderr.write(`[newo mcp] server ready - ${ALL_TOOLS.length} tools registered\n`);
}
