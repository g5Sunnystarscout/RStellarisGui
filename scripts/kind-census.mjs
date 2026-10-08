#!/usr/bin/env node
//------------------------------------------------------------------------------------
// kind-census.mjs -- Part of RStellarisGui
//
// THE SINGLE SOURCE for every count this project advertises.
//
// The README, docs/sources.md and kinds.mjs all used to carry their own hand-typed numbers for
// "how many times does vanilla use a gridBoxType", and they disagreed: the README said 248, the
// kind table said 260, and docs/sources.md said something else again. The numbers are the
// project's advertised evidence, so they are now MEASURED, written to `docs/kind-census.json`,
// and every other file is generated from that JSON:
//
//   node scripts/kind-census.mjs            measure the install, rewrite docs/kind-census.json
//   node scripts/generate-docs.mjs          rewrite the generated blocks in README/docs
//   node scripts/selftest.mjs               assert kinds.mjs and README still agree with the JSON
//
// The count is per KEYWORD, over every block at any nesting depth, in every `interface/**/*.gui`
// of the install - the same unit the kind table's `vanillaUses` uses. Case variants are folded
// onto one canonical kind (`listBoxType` + `listboxType`, `InstantTextBoxType` +
  // `instantTextBoxType`), because the engine's parser is case-insensitive and so is ours.
//
// Why not count the layout engine's boxes instead: that excludes anything inside an
// `if_resolution` block (the parser keeps those as conditionals) and includes the synthetic
// per-file root, so it answers a different question - "how many elements did we model", not
// "how many times does vanilla write this keyword".
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { getAssetIndex } from './../src/lib/asset-index.mjs';
import { ELEMENT_KINDS, componentKinds, emittableKinds, kindSpec, kindSpecByKeyword, sizeFormFor } from './../src/lib/kinds.mjs';
import { parseParadox } from './../src/lib/paradox.mjs';
import { DEFAULT_GAME_ROOT, PROJECT_ROOT, listFilesRecursive, readTextFile, resolveGameRoot } from './../src/lib/paths.mjs';

/** Where the measured census is written, and what everything else reads. */
export const CENSUS_PATH = join(PROJECT_ROOT, 'docs', 'kind-census.json');

/**
 * Measure every element keyword in the install's `.gui` corpus.
 *
 * @param {{root?: string, withAssets?: boolean}} options
 */
export function runKindCensus(options = {}) {
  const root = resolveGameRoot(options.root ?? DEFAULT_GAME_ROOT);
  const files = listFilesRecursive(join(root, 'interface'), ['.gui']);
  const byKind = new Map();
  const byKeyword = new Map();
  const unknownKeywords = new Map();
  let elementUses = 0;
  let topLevelContainers = 0;
  // The four legal declarative size forms, counted on `containerWindowType` (the only kind where
  // all four appear). The README's size-form table is generated from these.
  const sizeValueForms = { static: 0, percent: 0, doublePercent: 0, negative: 0, variable: 0, other: 0 };
  const parseFailures = [];
  const variablesFiles = [];
  const rootKeywords = new Map();

  for (const file of files) {
    const fileKey = relative(root, file).split(sep).join('/');
    let roots;
    let variables;
    try {
      ({ roots, variables } = parseParadox(readTextFile(file)));
    } catch (thrown) {
      parseFailures.push({ file: fileKey, reason: String(thrown?.message ?? thrown) });
      continue;
    }
    if (Object.keys(variables).length > 0) variablesFiles.push(fileKey);
    const first = roots.find((entry) => entry.key)?.key ?? '(empty)';
    rootKeywords.set(first, (rootKeywords.get(first) ?? 0) + 1);

    for (const entry of roots) {
      if (!entry.children) continue;
      topLevelContainers += entry.children.filter((child) => child.key && child.children).length;
    }

    const visit = (block) => {
      if (block.key && block.children) {
        const spec = kindSpecByKeyword(block.key);
        if (spec) {
          elementUses += 1;
          const entry = byKind.get(spec.kind) ?? { kind: spec.kind, uses: 0, keywords: new Map(), sizeForms: new Map(), fields: new Map(), examples: [] };
          entry.uses += 1;
          entry.keywords.set(block.key, (entry.keywords.get(block.key) ?? 0) + 1);
          const { form } = sizeFormFor(spec, block.key);
          const sizeBlock = (block.children ?? []).find((child) => child.key && /^size$/i.test(child.key) && child.children);
          if (sizeBlock) {
            const keys = sizeBlock.children.filter((child) => child.key && !child.children).map((child) => child.key.toLowerCase()).sort().join('+');
            const spelling = keys === 'height+width' ? 'width/height' : keys === 'x+y' ? 'x/y' : keys || '(empty)';
            entry.sizeForms.set(spelling, (entry.sizeForms.get(spelling) ?? 0) + 1);
            if (spec.kind === 'container' && /^containerwindowtype$/i.test(block.key)) {
              for (const axis of sizeBlock.children) {
                if (!axis.key || axis.children) continue;
                const value = String(axis.value ?? '');
                if (/^@/.test(value)) sizeValueForms.variable += 1;
                else if (/%%$/.test(value)) sizeValueForms.doublePercent += 1;
                else if (/%$/.test(value)) sizeValueForms.percent += 1;
                else if (/^-\d/.test(value)) sizeValueForms.negative += 1;
                else if (/^-?\d+(\.\d+)?$/.test(value)) sizeValueForms.static += 1;
                else sizeValueForms.other += 1;
              }
            }
          }
          for (const child of block.children) {
            if (!child.key) continue;
            const field = child.children ? `${child.key} = { }` : child.key.toLowerCase();
            entry.fields.set(field, (entry.fields.get(field) ?? 0) + 1);
          }
          if (entry.examples.length < 3) entry.examples.push(`${fileKey}:${block.line}`);
          void form;
          byKind.set(spec.kind, entry);
        } else if (/type$/i.test(block.key)) {
          unknownKeywords.set(block.key, (unknownKeywords.get(block.key) ?? 0) + 1);
        }
      }
      for (const child of block.children ?? []) visit(child);
    };
    for (const entry of roots) visit(entry);
  }

  const kinds = [...byKind.values()]
    .sort((a, b) => b.uses - a.uses)
    .map((entry) => {
      const spec = kindSpec(entry.kind);
      return {
        kind: entry.kind,
        keyword: spec?.keywords?.[0] ?? null,
        emitter: Boolean(spec?.emitter),
        sizeForm: spec?.sizeForm ?? null,
        acceptedSizeForms: [...entry.sizeForms.keys()],
        uses: entry.uses,
        keywords: Object.fromEntries([...entry.keywords.entries()].sort((a, b) => b[1] - a[1])),
        examples: entry.examples,
        topFields: Object.fromEntries([...entry.fields.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
      };
    });

  const census = {
    generatedBy: 'node scripts/kind-census.mjs',
    root,
    version: readGameVersionSafe(root),
    fileCount: files.length,
    parseFailures,
    rootKeywords: Object.fromEntries([...rootKeywords.entries()].sort((a, b) => b[1] - a[1])),
    filesWithVariables: variablesFiles.length,
    elementUses,
    topLevelContainers,
    sizeValueForms,
    kindCount: ELEMENT_KINDS.length,
    emittableKinds: emittableKinds(),
    // COMPONENTS are in the kind table but are NOT engine kinds: there is no bar window element
    // keyword in the install (see src/lib/components.mjs for the complete list of the 41 block
    // keywords vanilla's `.gui` files use). They are recorded separately so the element census
    // above stays a pure statement about what the engine parses.
    componentKinds: componentKinds(),
    kinds,
    unknownElementKeywords: Object.fromEntries([...unknownKeywords.entries()].sort((a, b) => b[1] - a[1])),
  };

  if (options.withAssets !== false) {
    const index = getAssetIndex({ root });
    census.assets = {
      spriteCount: index.stats.spriteCount,
      fontCount: index.stats.fontCount,
      containerCount: index.stats.containerCount,
      buttonEffectCount: index.stats.buttonEffectCount,
      gfxFileCount: index.stats.gfxFileCount,
      guiFileCount: index.stats.guiFileCount,
      distinctTextureCount: index.stats.distinctTextureCount,
      textureHeaderReads: index.stats.textureHeaderReads,
    };
  }
  return census;
}

function readGameVersionSafe(root) {
  try {
    const settings = readTextFile(join(root, 'launcher-settings.json'));
    return String(JSON.parse(settings).rawVersion ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

/**
 * Compare the census against the numbers kinds.mjs carries, and against the committed JSON.
 * Returns `{ok, mismatches: [...]}` - the selftest and the docs generator both call it.
 *
 * COMPONENTS are skipped: a component is a model construct the layout engine EXPANDS into real
 * elements (src/lib/components.mjs), so it has no vanilla use count and never appears in the
 * corpus. Comparing one against a measurement of the engine's own parsers would be a category
 * error, and reporting `kind not found in the corpus at all` for the bar made this check fail the
 * moment the primitive was added - which is how the distinction got written down here.
 */
export function compareCensusToKinds(census, kinds = ELEMENT_KINDS) {
  const measured = new Map(census.kinds.map((entry) => [entry.kind, entry.uses]));
  const mismatches = [];
  for (const spec of kinds) {
    if (spec.component) continue;
    const actual = measured.get(spec.kind);
    if (actual === undefined) {
      mismatches.push({ kind: spec.kind, declared: spec.vanillaUses, measured: 0, note: 'kind not found in the corpus at all' });
      continue;
    }
    if (actual !== spec.vanillaUses) {
      mismatches.push({ kind: spec.kind, declared: spec.vanillaUses, measured: actual });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** Write the census JSON, creating docs/ if needed. */
export function writeCensus(census, path = CENSUS_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(census, null, 2) + '\n', { encoding: 'utf8' });
  return path;
}

/** A short human summary. */
export function summariseKindCensus(census) {
  const top = census.kinds
    .slice(0, 8)
    .map((entry) => `${entry.kind} ${entry.uses}`)
    .join(', ');
  return (
    `${census.fileCount} .gui files, ${census.elementUses} element uses, ${census.topLevelContainers} top-level ` +
    `containers, ${census.filesWithVariables} files with @variables; top kinds: ${top}`
  );
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invokedDirectly) {
  const census = runKindCensus({ root: process.argv[2] });
  const comparison = compareCensusToKinds(census);
  const path = writeCensus(census);
  process.stdout.write(summariseKindCensus(census) + '\n');
  process.stdout.write(`written: ${path}\n`);
  if (comparison.ok) {
    process.stdout.write('kinds.mjs agrees with the install census.\n');
  } else {
    process.stdout.write('kinds.mjs DISAGREES with the install census:\n');
    for (const mismatch of comparison.mismatches) {
      process.stdout.write(`  ${mismatch.kind}: declared ${mismatch.declared}, measured ${mismatch.measured}${mismatch.note ? ` (${mismatch.note})` : ''}\n`);
    }
    process.exitCode = 1;
  }
  process.stdout.write('\nper-kind uses:\n');
  for (const entry of census.kinds) {
    process.stdout.write(`  ${String(entry.uses).padStart(5)}  ${entry.kind.padEnd(24)} ${entry.emitter ? 'emittable' : 'parse only'}  size=${entry.sizeForm}\n`);
  }
}

export default { runKindCensus, compareCensusToKinds, writeCensus, summariseKindCensus, CENSUS_PATH };
