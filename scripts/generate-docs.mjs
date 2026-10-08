#!/usr/bin/env node
//------------------------------------------------------------------------------------
// generate-docs.mjs -- Part of RStellarisGui
//
// The documentation generator. Every number and table this project advertises is DERIVED, not
// typed: this script reads `docs/kind-census.json` (a measurement of the install, produced by
// scripts/kind-census.mjs), the kind table in src/lib/kinds.mjs, the rule table in
// src/lib/validate.mjs and the tool registry in src/tools/index.mjs, and rewrites the blocks
// between `<!-- GENERATED:name -->` and `<!-- /GENERATED -->` in README.md and docs/sources.md.
//
// Why: two of the project's advertised numbers were wrong in different files at the same time
// (`OverlappingElementsBoxType` was 188 in docs/sources.md and 185 in kinds.mjs, and the README
// advertised a selftest assertion count that no longer matched). A generated block cannot drift,
// and `scripts/selftest.mjs` asserts these blocks are current, so drift is a test failure.
//
//   node scripts/kind-census.mjs     measure, and rewrite docs/kind-census.json
//   node scripts/generate-docs.mjs   rewrite the generated blocks
//
// Without `--write` it only reports whether the files are current (`--check`), which is what the
// selftest uses.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ELEMENT_KINDS, SIZE_FORMS } from './../src/lib/kinds.mjs';
import { PROJECT_ROOT } from './../src/lib/paths.mjs';
import { RULE_DESCRIPTIONS, RULE_SEVERITY } from './../src/lib/validate.mjs';
import { TOOL_SPECS } from './../src/tools/index.mjs';
import { CENSUS_PATH } from './kind-census.mjs';

const README = join(PROJECT_ROOT, 'README.md');
const SOURCES = join(PROJECT_ROOT, 'docs', 'sources.md');

/** Every generated block, by name. Each returns markdown WITHOUT the markers. */
export function buildBlocks(census) {
  const byKind = new Map(census.kinds.map((entry) => [entry.kind, entry]));
  const uses = (kind) => byKind.get(kind)?.uses ?? 0;
  const emittable = ELEMENT_KINDS.filter((spec) => spec.emitter);
  const parsedOnly = ELEMENT_KINDS.filter((spec) => !spec.emitter);

  const sizeFormLabel = {
    [SIZE_FORMS.widthHeight]: '`size = { width height }`',
    [SIZE_FORMS.xY]: '`size = { x y }`',
    [SIZE_FORMS.maxWidthHeight]: '`maxWidth` / `maxHeight`',
    [SIZE_FORMS.none]: 'no size at all',
  };

  const blocks = {};

  blocks['emittable-kinds'] = [
    `| kind | keyword | size the engine accepts | vanilla uses |`,
    `| --- | --- | --- | --- |`,
    ...emittable.map(
      (spec) => `| \`${spec.kind}\` | \`${spec.keywords[0]}\` | ${sizeFormLabel[spec.sizeForm]} | ${uses(spec.kind)} |`,
    ),
    ``,
    `That is ${emittable.reduce((total, spec) => total + uses(spec.kind), 0)} of the install's ` +
      `${census.elementUses} element uses (${((emittable.reduce((total, spec) => total + uses(spec.kind), 0) / census.elementUses) * 100).toFixed(1)}%).`,
  ].join('\n');

  blocks['parsed-only-kinds'] = [
    ...parsedOnly.map(
      (spec) =>
        `\`${spec.kind}\` (${uses(spec.kind)})${spec.keywords[0] !== spec.kind ? ` - \`${spec.keywords[0]}\`` : ''}`,
    ),
  ].join(', ');

  blocks['unknown-keywords'] = Object.keys(census.unknownElementKeywords ?? {}).length > 0
    ? Object.entries(census.unknownElementKeywords)
        .map(([keyword, count]) => `\`${keyword}\` (${count})`)
        .join(', ')
    : '(none)';

  const forms = census.sizeValueForms ?? {};
  blocks['size-forms'] = [
    `| form | meaning | value slots in vanilla \`containerWindowType\` |`,
    `| --- | --- | --- |`,
    `| \`width = 850\` | static pixels | ${forms.static ?? 0} |`,
    `| \`width = 100%\` | percent of the **parent** | ${forms.percent ?? 0} |`,
    `| \`width = 100%%\` | percent of the parent **minus this element's position** | ${forms.doublePercent ?? 0} |`,
    `| \`width = -16\` | parent **minus position minus 16** | ${forms.negative ?? 0} |`,
    `| \`width = @var\` | an \`@variable\` declaration | ${forms.variable ?? 0} |`,
    ``,
    `An earlier revision flagged the last two as errors. It was wrong; the wiki documents all four,`,
    `the install uses them, and only a *negative resolved* size is reported (as a warning). The x/y`,
    `spelling used by buttons and lists accepts only an integer or an \`@variable\` - the emitter`,
    `resolves anything else into pixels and says so.`,
  ].join('\n');

  blocks['validation-rules'] = [
    `| rule | severity | notes |`,
    `| --- | --- | --- |`,
    ...Object.keys(RULE_SEVERITY)
      .sort((a, b) => {
        const order = { error: 0, warning: 1, info: 2 };
        return order[RULE_SEVERITY[a]] - order[RULE_SEVERITY[b]] || a.localeCompare(b);
      })
      .map((rule) => `| \`${rule}\` | ${RULE_SEVERITY[rule]} | ${RULE_DESCRIPTIONS[rule] ?? ''} |`),
  ].join('\n');

  blocks['tool-surface'] = [
    `${TOOL_SPECS.length} tools. Names follow the sibling project's \`verb_subject\` convention; every one declares a full`,
    `JSON schema because an agent that cannot see a parameter guesses it.`,
    ``,
    `| Tool | Purpose |`,
    `| --- | --- |`,
    ...TOOL_SPECS.map((spec) => {
      const purpose = String(spec.description).split(/(?<=\.)\s/)[0].replace(/\s+/g, ' ');
      return `| \`${spec.name}\` | ${purpose} |`;
    }),
  ].join('\n');

  blocks['census-summary'] = [
    `Measured on ${census.fileCount} vanilla \`.gui\` files of Stellaris ${census.version} ` +
      `(\`${census.root}\`, ${census.parseFailures.length} parse failures):`,
    ``,
    `- **${census.elementUses} element uses** at any nesting depth, of which ${census.topLevelContainers} are top-level ` +
      `\`containerWindowType\`s across the files;`,
    `- ${census.filesWithVariables} of the ${census.fileCount} files declare \`@variables\`;`,
    census.assets
      ? `- the asset index sees **${census.assets.spriteCount} sprites**, ${census.assets.fontCount} bitmap fonts, ` +
        `${census.assets.distinctTextureCount} distinct textures and ${census.assets.containerCount} \`containerWindowType\` names.`
      : `- (asset census not recorded in this revision of docs/kind-census.json)`,
    ``,
    `Regenerate with \`node scripts/kind-census.mjs && node scripts/generate-docs.mjs\`.`,
  ].join('\n');

  return blocks;
}

/** Replace every generated block that is present in `text`. Returns `{text, applied, missing}`. */
export function applyBlocks(text, blocks) {
  const missing = [];
  const applied = [];
  let out = text;
  for (const [name, body] of Object.entries(blocks)) {
    // Global on purpose: a duplicated marker pair must be filled in (and therefore detected as
    // stale) rather than silently left empty by a first-match-only replace.
    const pattern = new RegExp(`(<!-- GENERATED:${name} -->)[\\s\\S]*?(<!-- /GENERATED -->)`, 'gm');
    if (!pattern.test(out)) {
      missing.push(name);
      continue;
    }
    out = out.replace(pattern, (_match, open, close) => `${open}\n${body}\n${close}`);
    applied.push(name);
  }
  return { text: out, applied, missing };
}

/** Which generated blocks that ARE present in a file are stale. */
export function staleBlocks(path, blocks) {
  const text = readFileSync(path, 'utf8');
  const { text: next, applied } = applyBlocks(text, blocks);
  const stale = [];
  for (const name of applied) {
    const pattern = new RegExp(`<!-- GENERATED:${name} -->([\\s\\S]*?)<!-- /GENERATED -->`, 'gm');
    const current = [...text.matchAll(pattern)].map((match) => match[1]).join('\u0000');
    const wanted = [...next.matchAll(pattern)].map((match) => match[1]).join('\u0000');
    if (current !== wanted) stale.push({ file: path, block: name, reason: 'content differs' });
  }
  return stale;
}

/** The full set of blocks, requiring the census JSON to exist. */
export function loadBlocks() {
  if (!existsSync(CENSUS_PATH)) {
    throw new Error(`no census at ${CENSUS_PATH}; run \`node scripts/kind-census.mjs\` first`);
  }
  const census = JSON.parse(readFileSync(CENSUS_PATH, 'utf8'));
  return { census, blocks: buildBlocks(census) };
}

/** Everything that is stale across both documents, plus any block that appears in neither. */
export function checkDocs() {
  const { blocks } = loadBlocks();
  const stale = [...staleBlocks(README, blocks), ...staleBlocks(SOURCES, blocks)];
  const placed = new Set();
  for (const path of [README, SOURCES]) {
    const { applied } = applyBlocks(readFileSync(path, 'utf8'), blocks);
    for (const name of applied) placed.add(name);
  }
  for (const name of Object.keys(blocks)) {
    if (!placed.has(name)) stale.push({ file: '(both)', block: name, reason: 'no marker in either document' });
  }
  return stale;
}

/** Rewrite both documents. */
export function writeDocs() {
  const { blocks } = loadBlocks();
  const written = [];
  for (const path of [README, SOURCES]) {
    const text = readFileSync(path, 'utf8');
    const { text: next } = applyBlocks(text, blocks);
    if (next !== text) {
      writeFileSync(path, next, { encoding: 'utf8' });
      written.push(path);
    }
  }
  const orphaned = checkDocs().filter((entry) => entry.reason === 'no marker in either document');
  if (orphaned.length > 0) {
    throw new Error(`no generated marker for: ${orphaned.map((entry) => entry.block).join(', ')}`);
  }
  return written;
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invokedDirectly) {
  const check = process.argv.includes('--check');
  if (check) {
    const stale = checkDocs();
    if (stale.length === 0) {
      process.stdout.write('generated documentation blocks are current.\n');
    } else {
      for (const entry of stale) process.stdout.write(`STALE ${entry.file}: ${entry.block} (${entry.reason})\n`);
      process.stdout.write('run `node scripts/generate-docs.mjs` to regenerate.\n');
      process.exitCode = 1;
    }
  } else {
    const written = writeDocs();
    process.stdout.write(written.length === 0 ? 'nothing to change.\n' : `rewrote:\n${written.map((path) => `  ${path}`).join('\n')}\n`);
  }
}

export default { buildBlocks, applyBlocks, checkDocs, writeDocs, staleBlocks };
