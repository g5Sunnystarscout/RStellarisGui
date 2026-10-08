#!/usr/bin/env node
//------------------------------------------------------------------------------------
// gui-census.mjs -- Part of RStellarisGui
//
// The real-input census. Parses every vanilla `.gui` file in the install and reports what the
// parser saw. This is the test that proves the parser handles real-world input rather than
// only the fixtures in selftest.mjs, and it doubles as a standalone reporting tool
// (`npm run census`).
//
// Verified baseline for Stellaris 4.4.6 (<Stellaris>):
//   177 .gui files, 176 starting with `guiTypes` and 1 with `guitypes` (traits.gui),
//   30 files with `@variable` lines before the root, 0 parser failures.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

import { findGuiFiles } from './../src/lib/asset-index.mjs';
import { computeLayout, parseGuiText } from './../src/lib/layout.mjs';
import { DEFAULT_GAME_ROOT, resolveGameRoot } from './../src/lib/paths.mjs';

/** Plausibility floors. If a refactor breaks the parser these fail loudly. */
export const CENSUS_EXPECTATIONS = {
  minFiles: 170,
  minParseable: 170,
  minElements: 11000,
  // Direct children of `guiTypes` only: 1197 in the 4.4.6 install. (The 2436 figure that also gets
  // quoted is `containerWindowType` NAMES in the asset index, and 3305 is the keyword's uses at
  // any depth, so the three numbers are not interchangeable.) A parser that ends an element early
  // - which `key { ... }` blocks used to do - inflates this count by spilling nested containers
  // out to the root, so the floor is deliberately close to the measured value.
  minTopLevelContainers: 1150,
  minDistinctRootKeywords: 1,
  maxParseFailures: 0,
};

/**
 * Parse every `.gui` file under an install's `interface/`.
 *
 * @param {{root?: string}} options
 * @returns {object} census
 */
export function runGuiCensus(options = {}) {
  const root = resolveGameRoot(options.root ?? DEFAULT_GAME_ROOT);
  const started = Date.now();
  const files = findGuiFiles(root);
  const parseFailures = [];
  const rootKeywords = new Map();
  const elementCounts = new Map();
  const issuesByRule = new Map();
  let totalElements = 0;
  let topLevelContainers = 0;
  let filesWithVariablesBeforeRoot = 0;
  let filesWithVariables = 0;
  let unresolvedSizeIssues = 0;
  const perFile = [];

  for (const file of files) {
    const key = relative(root, file).split(sep).join('/');
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (thrown) {
      parseFailures.push({ file: key, reason: `read failed: ${thrown.message}` });
      continue;
    }
    const parsed = parseGuiText(text, key);
    rootKeywords.set(parsed.rootKeyword, (rootKeywords.get(parsed.rootKeyword) ?? 0) + 1);

    // `@variable` lines before the root construct: 30 of the 177 vanilla files do this, and a
    // parser that insists the first construct is `guiTypes` would reject all 30.
    const head = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    let variablesBeforeRoot = 0;
    for (const raw of head) {
      const line = raw.replace(/#.*$/, '').trim();
      if (line === '') continue;
      if (/^\s*guiTypes\s*=/i.test(line)) break; // reached the root: stop counting
      if (line.startsWith('@')) variablesBeforeRoot += 1;
    }
    if (variablesBeforeRoot > 0) filesWithVariablesBeforeRoot += 1;
    if (Object.keys(parsed.variables).length > 0) filesWithVariables += 1;

    if (!parsed.ok) {
      parseFailures.push({ file: key, reason: parsed.reason, rootKeyword: parsed.rootKeyword });
      continue;
    }

    const { boxes, issues } = computeLayout(parsed.layout);
    let fileElements = 0;
    for (const box of boxes) {
      fileElements += 1;
      elementCounts.set(box.kind, (elementCounts.get(box.kind) ?? 0) + 1);
    }
    for (const issue of issues) {
      if (issue.rule === 'unresolved-size') unresolvedSizeIssues += 1;
      issuesByRule.set(issue.rule, (issuesByRule.get(issue.rule) ?? 0) + 1);
    }
    totalElements += fileElements;
    topLevelContainers += (parsed.layout.root?.children ?? []).length;
    perFile.push({ file: key, rootKeyword: parsed.rootKeyword, elements: fileElements, containers: (parsed.layout.root?.children ?? []).length });
  }

  const census = {
    root,
    ms: Date.now() - started,
    fileCount: files.length,
    parseableCount: files.length - parseFailures.length,
    parseFailures,
    rootKeywords: Object.fromEntries([...rootKeywords.entries()].sort((a, b) => b[1] - a[1])),
    totalElements,
    topLevelContainers,
    elementCounts: Object.fromEntries([...elementCounts.entries()].sort((a, b) => b[1] - a[1])),
    filesWithVariables,
    filesWithVariablesBeforeRoot,
    unresolvedSizeIssues,
    issuesByRule: Object.fromEntries(issuesByRule),
    perFile,
  };
  census.expectationsMet = evaluateCensus(census);
  return census;
}

/** Compare a census against the plausibility floors, returning per-check results. */
export function evaluateCensus(census, expectations = CENSUS_EXPECTATIONS) {
  const checks = [
    ['enough .gui files', census.fileCount >= expectations.minFiles, `found ${census.fileCount}`],
    ['enough parseable files', census.parseableCount >= expectations.minParseable, `parsed ${census.parseableCount}`],
    ['parser failures at or below the limit', census.parseFailures.length <= expectations.maxParseFailures, `${census.parseFailures.length} failures`],
    ['plausible total element count', census.totalElements >= expectations.minElements, `counted ${census.totalElements}`],
    ['plausible top-level container count', census.topLevelContainers >= expectations.minTopLevelContainers, `counted ${census.topLevelContainers}`],
  ];
  return {
    pass: checks.every(([, ok]) => ok),
    checks: checks.map(([name, ok, detail]) => ({ name, ok, detail })),
  };
}

/** A short human summary, for the CLI and the selftest output. */
export function summariseCensus(census) {
  const top = Object.entries(census.elementCounts)
    .slice(0, 6)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(', ');
  return (
    `${census.fileCount} .gui files parsed in ${census.ms} ms; ${census.parseableCount} parseable ` +
    `(${census.parseFailures.length} failures); roots ${JSON.stringify(census.rootKeywords)}; ` +
    `${census.totalElements} elements; ${census.topLevelContainers} top-level containers; ` +
    `${census.filesWithVariablesBeforeRoot} files with @variables before the root; top kinds: ${top}`
  );
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invokedDirectly) {
  const census = runGuiCensus({ root: process.argv[2] });
  process.stdout.write(summariseCensus(census) + '\n\n');
  for (const check of census.expectationsMet.checks) {
    process.stdout.write(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name} :: ${check.detail}\n`);
  }
  process.stdout.write(`\nroot keywords: ${JSON.stringify(census.rootKeywords)}\n`);
  process.stdout.write(`element counts: ${JSON.stringify(census.elementCounts, null, 1)}\n`);
  if (census.parseFailures.length > 0) {
    process.stdout.write(`\nparse failures:\n`);
    for (const failure of census.parseFailures) process.stdout.write(`  - ${failure.file}: ${failure.reason}\n`);
  }
  process.exitCode = census.expectationsMet.pass ? 0 : 1;
}

export default { runGuiCensus, evaluateCensus, summariseCensus, CENSUS_EXPECTATIONS };
