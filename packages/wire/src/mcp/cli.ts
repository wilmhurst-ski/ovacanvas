#!/usr/bin/env node
/**
 * `ovacanvas-wire-mcp` - the wire MCP server over stdio.
 *
 * Register it with an MCP client, e.g. Claude Code:
 * `claude mcp add ovacanvas-wire -- node packages/wire/lib/mcp/cli.js --workspace scenes`
 */
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createWireServer} from './server.js';

async function main(): Promise<void> {
  const flag = process.argv.indexOf('--workspace');
  const workspace = flag !== -1 ? process.argv[flag + 1] : undefined;

  const {server, close} = createWireServer({workspace});
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  transport.onclose = () => void shutdown();

  await server.connect(transport);
}

await main();
