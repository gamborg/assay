#!/usr/bin/env node
/**
 * assay CLI.
 *
 * Commands are thin: parse flags, call lib, print. Anything with logic worth
 * testing lives under lib/ so the tests do not have to shell out.
 */

import { runCli } from '../lib/cli/main.js';

const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
