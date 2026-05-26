#!/usr/bin/env node
/**
 * CLI entry point for @betanyc/nyc-council-mcp v2
 *
 * Subcommands:
 *   serve   — start the MCP server (default if no subcommand given)
 *   index   — build or update the local SQLite index from jehiah/nyc_legislation archive
 */

import { existsSync } from "fs";
import { resolve } from "path";

const [, , subcommand, ...rest] = process.argv;

// Default to 'serve' when invoked via `npx @betanyc/nyc-council-mcp` with no args,
// or when used as an MCP server (no subcommand)
const cmd = subcommand === "index" ? "index" : "serve";

if (cmd === "serve") {
  const { startServer } = await import("./server.js");
  await startServer();
} else {
  // --- index subcommand ---
  // Parse flags: --archive <path> --db <path> --full --verbose
  const args = [subcommand, ...rest]; // subcommand might be a flag if `index` was explicit
  // re-parse from rest since subcommand === "index"
  const indexArgs = rest;

  function flag(name: string): string | null {
    const idx = indexArgs.indexOf(name);
    return idx !== -1 && idx + 1 < indexArgs.length ? indexArgs[idx + 1] : null;
  }

  function boolFlag(name: string): boolean {
    return indexArgs.includes(name);
  }

  if (boolFlag("--help") || boolFlag("-h")) {
    console.log(`
nyc-council-mcp index — build or update the local SQLite index

Usage:
  npx @betanyc/nyc-council-mcp index --archive <path> [options]

Options:
  --archive <path>    Path to jehiah/nyc_legislation clone (required)
  --db <path>         SQLite output path (default: $LEGISTAR_DB_PATH or ./legistar.db)
  --full              Full rebuild (default: incremental — only new/changed files)
  --verbose           Print progress to stderr
  --help              Show this help

First-time setup:
  # 1. Clone the archive (~700 MB, one-time)
  git clone --depth 1 https://github.com/jehiah/nyc_legislation.git ~/legistar/nyc_legislation

  # 2. Build the index (~80s)
  npx @betanyc/nyc-council-mcp index --archive ~/legistar/nyc_legislation --db ~/legistar/legistar.db --verbose

  # 3. Add to your MCP config (~/.claude.json):
  #    "LEGISTAR_DB_PATH": "/Users/you/legistar/legistar.db"

Keeping your index fresh:
  cd ~/legistar/nyc_legislation && git pull
  npx @betanyc/nyc-council-mcp index --archive ~/legistar/nyc_legislation --db ~/legistar/legistar.db

Automated daily updates (launchd / cron):
  # Add to crontab: daily at 6am
  0 6 * * * cd ~/legistar/nyc_legislation && git pull && npx @betanyc/nyc-council-mcp index --archive ~/legistar/nyc_legislation --db ~/legistar/legistar.db
`);
    process.exit(0);
  }

  const archivePath = flag("--archive");
  const dbPath = flag("--db") ?? process.env.LEGISTAR_DB_PATH ?? "./legistar.db";
  const full = boolFlag("--full");
  const verbose = boolFlag("--verbose");

  if (!archivePath) {
    console.error("Error: --archive <path> is required.\n");
    console.error("Run: npx @betanyc/nyc-council-mcp index --help");
    process.exit(1);
  }

  const resolvedArchive = resolve(archivePath);
  if (!existsSync(resolvedArchive)) {
    console.error(`Error: Archive path does not exist: ${resolvedArchive}`);
    console.error(
      "\nClone the archive first:\n  git clone --depth 1 https://github.com/jehiah/nyc_legislation.git " +
        archivePath
    );
    process.exit(1);
  }

  const resolvedDb = resolve(dbPath);

  if (verbose || true) {
    // Always print basic info — users need feedback for an 80s operation
    console.error(`Archive: ${resolvedArchive}`);
    console.error(`Database: ${resolvedDb}`);
    console.error(`Mode: ${full ? "full rebuild" : "incremental"}`);
  }

  const { buildIndex } = await import("./db/indexer.js");

  const start = Date.now();
  const stats = await buildIndex({
    archiveRoot: resolvedArchive,
    dbPath: resolvedDb,
    full,
    verbose,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(
    `Indexed: bills=${stats.bills} events=${stats.events} people=${stats.people} ` +
      `skipped=${stats.skipped} errors=${stats.errors} (${elapsed}s)`
  );
}
