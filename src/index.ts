#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

export { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
export { search, parseResultsPage } from "./ddg.js";
export { scrapeUrl } from "./scrape.js";
export { filterResults, rankResults, topResults } from "./filter.js";
export type * from "./types.js";

const HELP = `${SERVER_NAME} v${SERVER_VERSION}

An MCP server that searches DuckDuckGo, scrapes URLs and filters/ranks results.
It speaks MCP over stdio, so it is normally launched by an MCP client rather than by hand.

Usage:
  ratduck-search-mcp            Start the stdio MCP server
  ratduck-search-mcp --version  Print the version
  ratduck-search-mcp --help     Print this help

Environment:
  RATDUCK_TIMEOUT_MS   Per-request timeout in ms (default 15000)
  RATDUCK_MAX_BYTES    Max response size in bytes (default 4000000)
  RATDUCK_USER_AGENT   Override the rotating User-Agent
  RATDUCK_ALLOW_PRIVATE=1  Allow scraping private/loopback addresses (off by default)

Tools: ddg_search, ddg_top_results, scrape_url, filter_results
Docs:  https://github.com/dixonSolutions/ratduck-search-mcp
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${SERVER_VERSION} listening on stdio\n`);

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Only run the CLI when executed directly, not when imported as a library.
// argv[1] may be a bin symlink, so compare resolved real paths.
function isDirectInvocation(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const invokedDirectly = isDirectInvocation();

if (invokedDirectly || process.env.RATDUCK_FORCE_CLI === "1") {
  main().catch((error: unknown) => {
    process.stderr.write(`Fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
