/**
 * Minimal argument parsing.
 *
 * Long flags only, `--flag value` or `--flag=value`, repeated flags collect into
 * an array. Fewer than 60 lines and no dependency, versus a parsing library whose
 * entire value here would be supporting the short flags nobody would type.
 */

function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const [name, inlineValue] = splitFlag(token.slice(2));
    const next = argv[index + 1];

    let value;
    if (inlineValue !== undefined) {
      value = inlineValue;
    } else if (next !== undefined && !next.startsWith('--')) {
      value = next;
      index += 1;
    } else {
      value = true;
    }

    if (name in flags) {
      flags[name] = [].concat(flags[name], value);
    } else {
      flags[name] = value;
    }
  }

  return { positional, flags };
}

function splitFlag(token) {
  const equals = token.indexOf('=');
  return equals === -1 ? [token, undefined] : [token.slice(0, equals), token.slice(equals + 1)];
}

/** Flags that may be repeated should always be read as a list. */
function asList(value) {
  if (value === undefined || value === true) return [];
  return [].concat(value);
}

export { parseArgs, asList };
