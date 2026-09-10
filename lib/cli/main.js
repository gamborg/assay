/**
 * CLI command dispatch.
 *
 * Exit codes are part of the interface: 0 clean, 1 failing gates or regressions,
 * 2 the harness itself could not run. CI needs to tell "the agent got worse" apart
 * from "the config file has a typo", and a single non-zero code cannot.
 */

import { loadScenarios } from '../scenarios/load.js';
import { loadConfig, selectTargets } from '../config/config.js';
import { runSuite } from '../runner.js';
import { listTools } from '../agent/tools.js';
import { assertionTypes } from '../gates/assertions.js';
import { availableProviders } from '../providers/index.js';
import { printSuite, printResult, printTrace } from '../report/console.js';
import { saveRun, saveBaseline, loadBaseline } from '../regression/store.js';
import { compareRuns } from '../regression/compare.js';
import { parseArgs, asList } from './args.js';

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_HARNESS_ERROR = 2;

async function runCli(argv) {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0] ?? 'help';

  try {
    switch (command) {
      case 'run':
        return await commandRun(positional.slice(1), flags);
      case 'compare':
        return await commandCompare(flags);
      case 'baseline':
        return await commandBaseline(flags);
      case 'list':
        return await commandList(flags);
      case 'help':
      case '--help':
        printHelp();
        return EXIT_OK;
      default:
        console.error(`unknown command "${command}"\n`);
        printHelp();
        return EXIT_HARNESS_ERROR;
    }
  } catch (error) {
    console.error(`assay: ${error.message}`);
    if (flags.debug) console.error(error.stack);
    return EXIT_HARNESS_ERROR;
  }
}

/**
 * `assay run [scenario-path]` -- the command everything else exists to support.
 */
async function commandRun(positional, flags) {
  const config = await loadConfig(flags.config);
  const targets = selectTargets(config, asList(flags.target));
  const scenarios = filterScenarios(
    await loadScenarios(positional[0] ?? flags.scenarios ?? config.scenarios),
    flags,
  );

  if (scenarios.length === 0) {
    console.error('assay: no scenarios matched the given filters');
    return EXIT_HARNESS_ERROR;
  }

  const streaming = !flags.json;
  const suite = await runSuite({
    scenarios,
    targets,
    concurrency: Number(flags.concurrency ?? 4),
    onResult: streaming ? (result) => printResult(result) : undefined,
  });

  if (flags.json) {
    console.log(JSON.stringify(suite, null, 2));
  } else {
    printSuite(suite);
    if (flags.trace) {
      for (const result of suite.results) {
        console.log('');
        printTrace(result);
      }
    }
  }

  if (flags.save !== false) {
    const file = await saveRun(suite, { includeTraces: Boolean(flags.trace) });
    if (!flags.json) console.log(`\nrun saved to ${file}`);
  }

  if (flags.baseline) {
    const file = await saveBaseline(suite);
    if (!flags.json) console.log(`baseline updated: ${file}`);
    return EXIT_OK;
  }

  // Comparing against the baseline in the same command is what makes this usable
  // as a CI gate rather than as a dashboard.
  if (flags.gate) {
    const baseline = await loadBaseline();
    if (!baseline) {
      console.error('assay: --gate needs a baseline; run once with --baseline first');
      return EXIT_HARNESS_ERROR;
    }
    const diff = compareRuns(baseline, suite);
    printComparison(diff);
    return diff.hasRegressions ? EXIT_FAILED : EXIT_OK;
  }

  return suite.summary.passed === suite.summary.total ? EXIT_OK : EXIT_FAILED;
}

async function commandCompare(flags) {
  const baseline = await loadBaseline();
  if (!baseline) {
    console.error('assay: no baseline found; run `assay run --baseline` first');
    return EXIT_HARNESS_ERROR;
  }

  const config = await loadConfig(flags.config);
  const targets = selectTargets(config, asList(flags.target));
  const scenarios = filterScenarios(await loadScenarios(flags.scenarios ?? config.scenarios), flags);

  const suite = await runSuite({ scenarios, targets, concurrency: Number(flags.concurrency ?? 4) });
  const diff = compareRuns(baseline, suite);

  if (flags.json) {
    console.log(JSON.stringify(diff, null, 2));
  } else {
    printSuite(suite);
    printComparison(diff);
  }

  return diff.hasRegressions ? EXIT_FAILED : EXIT_OK;
}

async function commandBaseline(flags) {
  const config = await loadConfig(flags.config);
  const targets = selectTargets(config, asList(flags.target));
  const scenarios = filterScenarios(await loadScenarios(flags.scenarios ?? config.scenarios), flags);

  const suite = await runSuite({ scenarios, targets, onResult: (r) => printResult(r) });
  const file = await saveBaseline(suite);

  printSuite(suite);
  console.log(`\nbaseline written to ${file}`);
  console.log('commit it -- a baseline only on your laptop is not a regression suite');
  return EXIT_OK;
}

async function commandList(flags) {
  if (flags.tools) {
    for (const tool of listTools()) console.log(`${tool.name.padEnd(20)} ${tool.description}`);
    return EXIT_OK;
  }
  if (flags.assertions) {
    for (const type of assertionTypes()) console.log(type);
    return EXIT_OK;
  }
  if (flags.providers) {
    for (const provider of availableProviders()) console.log(provider);
    return EXIT_OK;
  }

  const config = await loadConfig(flags.config);
  const scenarios = await loadScenarios(flags.scenarios ?? config.scenarios);
  for (const scenario of scenarios) {
    const tags = scenario.tags.length ? ` [${scenario.tags.join(', ')}]` : '';
    console.log(`${scenario.id.padEnd(32)} ${scenario.expect.length} gate(s)${tags}`);
  }
  return EXIT_OK;
}

function filterScenarios(scenarios, flags) {
  const only = asList(flags.only);
  const tags = asList(flags.tag);

  return scenarios.filter((scenario) => {
    if (only.length && !only.includes(scenario.id)) return false;
    if (tags.length && !tags.some((tag) => scenario.tags.includes(tag))) return false;
    return true;
  });
}

function printComparison(diff) {
  console.log('');

  for (const entry of diff.regressions) {
    console.log(`REGRESSION  ${entry.scenarioId} @ ${entry.target} (${entry.failedChecks.join(', ')})`);
  }
  for (const entry of diff.fixes) {
    console.log(`FIXED       ${entry.scenarioId} @ ${entry.target}`);
  }
  for (const entry of diff.added) {
    console.log(`NEW         ${entry.scenarioId} @ ${entry.target}`);
  }
  for (const entry of diff.removed) {
    console.log(`GONE        ${entry.scenarioId} @ ${entry.target}`);
  }

  console.log(
    `${diff.regressions.length} regression(s), ${diff.fixes.length} fix(es), ` +
      `${diff.unchanged.length} unchanged`,
  );
}

function printHelp() {
  console.log(`assay -- an evaluation harness for tool-using agents

Usage
  assay run [path]        Run scenarios against every configured target
  assay compare           Run scenarios and diff the result against the baseline
  assay baseline          Run scenarios and record the result as the new baseline
  assay list              List scenarios (or --tools, --assertions, --providers)

Options
  --config <file>         Config file (default: built-in single Anthropic target)
  --scenarios <path>      Scenario file or directory
  --target <name>         Only this target; repeatable
  --only <id>             Only this scenario; repeatable
  --tag <tag>             Only scenarios with this tag; repeatable
  --concurrency <n>       Scenarios in flight per target (default 4)
  --trace                 Print the full trace for every run
  --json                  Machine-readable output, nothing else on stdout
  --baseline              Record this run as the new baseline
  --gate                  Compare against the baseline and fail on regressions
  --debug                 Print stack traces for harness errors

Exit codes
  0  everything passed
  1  a gate failed, or a regression was found
  2  the harness could not run (bad config, missing scenarios, unknown target)
`);
}

export { runCli };
