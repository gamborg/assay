/**
 * Terminal reporting.
 *
 * Two audiences: someone watching a suite run, and someone reading CI output
 * after it failed. The second only cares about failures, so failures carry their
 * assertion detail and passes stay on one line.
 */

const ESC = String.fromCharCode(27);

const COLOURS = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  bold: `${ESC}[1m`,
};

/** Respect NO_COLOR and non-TTY output; CI logs full of escape codes help nobody. */
function supportsColour() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function paint(text, colour) {
  return supportsColour() ? `${COLOURS[colour]}${text}${COLOURS.reset}` : text;
}

function statusLabel(result) {
  if (result.stoppedBecause === 'error') return paint('ERROR', 'yellow');
  return result.passed ? paint('PASS', 'green') : paint('FAIL', 'red');
}

function formatResultLine(result) {
  const cost = result.costUsd === null ? 'cost n/a' : `$${result.costUsd.toFixed(5)}`;
  const meta = paint(`${result.durationMs}ms  ${result.steps} step(s)  ${cost}`, 'dim');

  return `  ${statusLabel(result)}  ${result.scenarioId.padEnd(28)} ${meta}`;
}

function printResult(result, write = console.log) {
  write(formatResultLine(result));

  if (result.passed) return;

  for (const check of result.checks.filter((entry) => !entry.passed)) {
    write(paint(`        x ${check.type}: ${check.detail}`, 'red'));
  }
  if (result.error) {
    write(paint(`        ! ${result.error.message}`, 'yellow'));
  }
}

/**
 * A streaming reporter: prints a header when the target changes, then one line per
 * result as it lands. Targets run sequentially, so the grouping falls out for free.
 */
function createStreamReporter(write = console.log) {
  let currentTarget = null;

  return (result) => {
    if (result.target.name !== currentTarget) {
      currentTarget = result.target.name;
      write('');
      write(paint(`${result.target.name} (${result.target.provider} / ${result.target.model})`, 'bold'));
    }
    printResult(result, write);
  };
}

/**
 * @param {object} suite
 * @param {(line: string) => void} [write]
 * @param {{results?: boolean}} [options] set `results: false` when a stream
 *   reporter already printed each line, to avoid printing everything twice.
 */
function printSuite(suite, write = console.log, { results = true } = {}) {
  if (results) {
    for (const target of suite.targets) {
      write('');
      write(paint(`${target.name} (${target.provider} / ${target.model})`, 'bold'));

      for (const result of suite.results.filter((entry) => entry.target.name === target.name)) {
        printResult(result, write);
      }
    }
  }

  const { total, passed, failed, errored, totalCostUsd, totalDurationMs } = suite.summary;
  const cost = totalCostUsd === null ? 'cost n/a' : `$${totalCostUsd.toFixed(4)}`;

  write('');
  write(
    `${passed}/${total} passed` +
      (failed ? paint(`  ${failed} failed`, 'red') : '') +
      (errored ? paint(`  ${errored} errored`, 'yellow') : '') +
      paint(`  ${(totalDurationMs / 1000).toFixed(1)}s  ${cost}`, 'dim'),
  );
}

/** A trace is only useful if you can read it without a JSON viewer. */
function printTrace(result, write = console.log) {
  write(paint(`trace: ${result.scenarioId} @ ${result.target.name}`, 'bold'));

  for (const event of result.trace) {
    const at = paint(`${String(event.atMs).padStart(6)}ms`, 'dim');

    switch (event.type) {
      case 'model_request':
        write(`${at}  -> model  step ${event.step}, ${event.messageCount} message(s)`);
        break;
      case 'model_response':
        write(
          `${at}  <- model  stop=${event.stopReason} in=${event.usage.inputTokens} out=${event.usage.outputTokens}`,
        );
        if (event.text) write(`          text: ${truncate(event.text)}`);
        for (const call of event.toolCalls) {
          write(`          wants: ${call.name}(${truncate(JSON.stringify(call.args), 120)})`);
        }
        break;
      case 'tool_call':
        write(`${at}  -> tool   ${event.name}(${truncate(JSON.stringify(event.arguments), 120)})`);
        break;
      case 'tool_result':
        write(
          `${at}  <- tool   ${event.name}${event.error ? ' [error]' : ''}: ${truncate(event.result, 160)}`,
        );
        break;
      case 'run_error':
        write(`${at}  !! ${event.message}`);
        break;
      case 'run_end':
        write(`${at}  == ${event.stoppedBecause} after ${event.steps} step(s)`);
        break;
      default:
        break;
    }
  }
}

function truncate(text, limit = 240) {
  const value = String(text ?? '').replace(/\s+/g, ' ');
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

export { printResult, printSuite, printTrace, formatResultLine, createStreamReporter };
