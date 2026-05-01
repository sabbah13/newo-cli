/**
 * MCP command handler.
 *
 * Subcommands:
 *   newo mcp serve            Start the NEWO MCP server on stdio.
 *   newo mcp tools            List the tools the server exposes (no boot).
 *
 * Used by Claude Code / Cowork plugins via `.mcp.json`:
 *   { "newo": { "type": "stdio", "command": "npx", "args": ["-y", "newo@latest", "mcp", "serve"] } }
 */
import type { MultiCustomerConfig, CliArgs } from '../../types.js';
import { ALL_TOOLS } from '../../mcp/tools/index.js';

export async function handleMcpCommand(
  _customerConfig: MultiCustomerConfig,
  args: CliArgs,
  _verbose: boolean
): Promise<void> {
  const sub = args._[1];

  switch (sub) {
    case 'serve': {
      // Lazy-load the server so `newo mcp tools` doesn't pull in the SDK.
      const { startMcpServer } = await import('../../mcp/server.js');
      await startMcpServer();
      // Server runs until parent closes stdio; never returns under normal use.
      return;
    }

    case 'tools': {
      const json = Boolean(args.json);
      if (json) {
        process.stdout.write(
          JSON.stringify(
            ALL_TOOLS.map((t) => ({ name: t.name, description: t.description })),
            null,
            2
          ) + '\n'
        );
        return;
      }
      console.log(`NEWO MCP server exposes ${ALL_TOOLS.length} tool(s):\n`);
      for (const tool of ALL_TOOLS) {
        console.log(`  ${tool.name}`);
        console.log(`    ${tool.description.replace(/\s+/g, ' ').slice(0, 100)}...`);
      }
      console.log(
        '\nStart the server: `newo mcp serve` (stdio). See `--help` for transport details.'
      );
      return;
    }

    case undefined:
    case 'help':
    case '-h':
    case '--help': {
      console.log(`Usage: newo mcp <subcommand>

Subcommands:
  serve         Start the NEWO MCP server on stdio (used by Claude Code / Cowork plugins).
  tools         List the tools this server exposes. --json for machine-readable output.

Wire up in a plugin's .mcp.json:
  {
    "mcpServers": {
      "newo": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "newo@latest", "mcp", "serve"]
      }
    }
  }

The server reuses the same authentication as the rest of the CLI - NEWO_API_KEY
from your .env, with automatic token refresh. No additional configuration needed.

Tools currently exposed:
${ALL_TOOLS.map((t) => `  - ${t.name}`).join('\n')}
`);
      return;
    }

    default: {
      console.error(`Unknown mcp subcommand: ${sub}`);
      console.error('Run `newo mcp --help` for usage.');
      process.exit(1);
    }
  }
}
