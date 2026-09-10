#!/usr/bin/env node
/**
 * assay as an MCP server over stdio.
 *
 * Nothing may be written to stdout except protocol frames -- stdout is the
 * transport. Diagnostics go to stderr.
 *
 *   assay-mcp [--config assay.config.yaml]
 */

import { parseArgs } from '../lib/cli/args.js';
import { startStdioServer } from '../lib/mcp/server.js';

const { flags } = parseArgs(process.argv.slice(2));

await startStdioServer({ configFile: typeof flags.config === 'string' ? flags.config : undefined });
console.error('assay MCP server listening on stdio');
