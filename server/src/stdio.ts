#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { ShellError } from './errors.js';
import { createServer, formatLogEntry, loadInstructions } from './server.js';
import { GitHubStore } from './store/github.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  // One read at startup: the store's CONTEXT.md becomes the MCP instructions.
  const instructions = await loadInstructions(new GitHubStore(config));
  const server = createServer({
    config,
    instructions,
    log: (entry) => process.stderr.write(`${formatLogEntry(entry)}\n`)
  });
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message =
    error instanceof ShellError
      ? error.message
      : `openstore: ${error instanceof Error ? error.message : String(error)}`;
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
