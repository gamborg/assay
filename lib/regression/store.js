/**
 * Run storage and baselines.
 *
 * Every suite run is written to `.assay/runs/<timestamp>.json`; promoting one to
 * the baseline copies it to `.assay/baseline.json`. Committing the baseline is
 * the intended workflow -- a regression suite whose expected state lives only on
 * someone's laptop is not a regression suite.
 *
 * Traces are stripped from stored runs by default. They are the largest part of a
 * result by an order of magnitude, and a baseline is a record of outcomes, not of
 * every token that produced them.
 */

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ASSAY_DIR = '.assay';
const RUNS_DIR = join(ASSAY_DIR, 'runs');
const BASELINE_FILE = join(ASSAY_DIR, 'baseline.json');

async function saveRun(suite, { dir = ASSAY_DIR, includeTraces = false } = {}) {
  const runsDir = join(dir, 'runs');
  await mkdir(runsDir, { recursive: true });

  const stamp = suite.startedAt.replace(/[:.]/g, '-');
  const file = join(runsDir, `${stamp}.json`);

  await writeFile(file, JSON.stringify(forStorage(suite, includeTraces), null, 2));
  return file;
}

async function saveBaseline(suite, { dir = ASSAY_DIR } = {}) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'baseline.json');
  await writeFile(file, JSON.stringify(forStorage(suite, false), null, 2));
  return file;
}

async function loadBaseline({ dir = ASSAY_DIR } = {}) {
  const file = join(dir, 'baseline.json');
  const source = await readFile(file, 'utf8').catch(() => null);
  return source ? JSON.parse(source) : null;
}

/** Most recent first, so "compare against the last run" is a head operation. */
async function listRuns({ dir = ASSAY_DIR } = {}) {
  const runsDir = join(dir, 'runs');
  const entries = await readdir(runsDir).catch(() => []);
  return entries
    .filter((name) => name.endsWith('.json'))
    .sort()
    .reverse()
    .map((name) => join(runsDir, name));
}

async function loadRun(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function forStorage(suite, includeTraces) {
  return {
    ...suite,
    results: suite.results.map(({ trace, ...result }) =>
      includeTraces ? { ...result, trace } : result,
    ),
  };
}

export { saveRun, saveBaseline, loadBaseline, listRuns, loadRun, ASSAY_DIR, RUNS_DIR, BASELINE_FILE };
