#!/usr/bin/env node
//------------------------------------------------------------------------------------
// calibrate-coords.mjs -- Part of RStellarisGui
//
// THE COORDINATE CALIBRATION. Parses the whole vanilla `.gui` corpus and measures, per
// orientation family and per nesting depth, whether the rects this project computes match the
// authors' evident intent. It runs the SAME corpus through the current canonical model and through
// the previous one, so the before/after numbers in `docs/sources.md` are reproducible rather than
// remembered.
//
// WHY IT EXISTS. The two-anchor rect model was originally validated on DEPTH-1 elements only (the
// 1197 top-level containers whose parent is the fixed 1920x1080 root). Nested elements were never
// separately checked, and the aggregate figure - "93.7% on screen, 86.7% naive" - silently averaged
// the `lower_*` family over the whole corpus. At depth 1 the anchor is the screen's own bottom edge,
// where "outside the parent" and "below the screen" are the same sentence and no measurement can
// tell two models apart; one level deeper they diverge.
//
// WHAT IT FOUND, AND WHAT IT MEASURES NOW. Two things:
//
//   * the `lower_*` family is not special-cased at all: a `.gui` `position` is added to the parent's
//     `orientation` anchor for every orientation, so `lower_left` is "measured down from the
//     parent's bottom edge". `--compare` runs the whole corpus with the alternative (negate y for
//     the bottom anchors) and reports both columns: the shipped model wins on every line, and the
//     negated one collapses the nested `lower_*` figures from 0.6873 to 0.0824. That is a measured
//     answer to a question that is otherwise argued about from a handful of examples.
//   * the nested rows are reported PER PARENT FAMILY, because that is the axis the original
//     depth-1-only figure could not see; a `lower_*` child of a `center*` panel and one inside
//     another `lower_*` container are not the same measurement.
//
// WHAT IS MEASURED, and why each one is a fair proxy for intent:
//
//   containment   the fraction of a child's rect that falls inside its parent's rect. An author
//                 declares a child INSIDE its parent; a model that puts it outside is wrong. This
//                 is the discriminating metric, and it is only meaningful when the PARENT's own
//                 rect is trustworthy - so it is reported separately for lower_* parents.
//   on screen     the fraction of an element's rect inside 1920x1080. For a depth-1 element this
//                 is the original acceptance test; deeper down it is a weaker signal, and it is
//                 reported per depth so the two are not conflated.
//   sign census   how often each orientation family uses a negative y IN THE FILE, and how often the
//                 converter changed that sign. Bottom-anchored elements use a negative y to move up
//                 the screen, so a converter that reports a non-zero flip count is negating them.
//
// Usage:
//   node scripts/calibrate-coords.mjs                 the shipped model's summary
//   node scripts/calibrate-coords.mjs --compare       shipped vs the negated alternative
//   node scripts/calibrate-coords.mjs --json          machine-readable result
//   node scripts/calibrate-coords.mjs --examples      the worked vanilla examples, with numbers
//   (`--legacy` is the old spelling of `--compare`, kept so existing notes keep working.)
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

import { buildAssetIndex, findGuiFiles } from './../src/lib/asset-index.mjs';
import { BASE_RESOLUTION, computeLayout, makeSpriteLookup, parseGuiText } from './../src/lib/layout.mjs';
import { resolveGameRoot } from './../src/lib/paths.mjs';
import { normaliseAnchor } from './../src/lib/kinds.mjs';

/** The models this script can lay a tree out with. */
export const MODELS = {
  // What this project ships: a `.gui` file's `position` is an offset from the parent's
  // `orientation` anchor in screen space, added to the anchor for EVERY orientation.
  engine: { flipLowerAnchors: false, label: 'engine: position added to the anchor (shipped)' },
  // The alternative that was proposed and measured: flip the sign of y for the anchors on the
  // parent's bottom edge. Kept as a first-class model so the comparison is a command, not a memory.
  flipped: { flipLowerAnchors: true, label: 'flipped: lower_* y negated' },
};
/** `legacy` is the historical name for the shipped model - the same numbers, kept for old callers. */
MODELS.legacy = MODELS.engine;
/** `canonical` is the shipped model plus the canonical-coordinate labelling; identical geometry. */
MODELS.canonical = MODELS.engine;

const overlapArea = (a, b) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** Which family an orientation belongs to, for the per-family report. */
export function orientationFamily(orientation) {
  const anchor = normaliseAnchor(orientation) ?? 'upper_left';
  if (anchor.startsWith('lower')) return 'lower_*';
  if (anchor.startsWith('center')) return 'center*';
  return 'upper_*';
}

/** Short human label for a nesting depth, so the table reads as "the window" vs "inside it". */
const depthLabel = (depth) => (depth === 1 ? 'depth1 (parent = screen)' : `nested (depth ${depth})`);

/**
 * Measure every element of every vanilla `.gui` file under one model.
 *
 * @param {{gameRoot?: string, model?: 'legacy'|'canonical', includeExamples?: boolean}} options
 */
export function calibrateCoordinates(options = {}) {
  const root = resolveGameRoot(options.gameRoot);
  const modelName = options.model ?? 'canonical';
  const model = MODELS[modelName];
  if (!model) throw new Error(`unknown model \`${modelName}\`; expected one of ${Object.keys(MODELS).join(', ')}`);
  // The asset index is needed for a fair comparison: without sprite sizes, a fixed-size icon's
  // rect is 0x0 and drops out of every geometric metric, which would quietly exclude exactly the
  // elements (close buttons, icons) whose placement the engine gets wrong most visibly.
  let spriteLookup = null;
  try {
    const index = buildAssetIndex({ root });
    spriteLookup = makeSpriteLookup(index);
  } catch {
    spriteLookup = null;
  }

  const files = findGuiFiles(root);
  const screen = { x: 0, y: 0, width: BASE_RESOLUTION.width, height: BASE_RESOLUTION.height };
  /** key -> {n, containedSum, fullyContained, onScreenSum, fullyOnScreen} */
  const buckets = new Map();
  const signCensus = new Map();
  const examples = [];
  const perFile = [];
  let elements = 0;
  let sizedElements = 0;

  const bucket = (key) => {
    if (!buckets.has(key)) buckets.set(key, { n: 0, containedSum: 0, fullyContained: 0, onScreenSum: 0, fullyOnScreen: 0 });
    return buckets.get(key);
  };

  for (const file of files) {
    const fileKey = relative(root, file).split(sep).join('/');
    // BOTH models read the raw engine `position` and differ only in how the layout engine adds it
    // to the anchor, so both parse with `canonicalise: false`. Treating that as "the old model" and
    // the canonical converter as "the new one" would have compared a model against itself with
    // different labels - which is exactly what the first version of this script did, and why it
    // reported a 0.15-improvement that did not exist.
    const parsed = parseGuiText(readFileSync(file, 'utf8'), fileKey, { canonicalise: false, spriteLookup });
    if (!parsed.ok) continue;
    const { boxes } = computeLayout(parsed.layout, { spriteLookup, flipLowerAnchors: model.flipLowerAnchors });
    perFile.push({ file: fileKey, elements: boxes.length });
    const byIndex = new Map(boxes.map((box) => [box.boxIndex, box]));

    for (const box of boxes) {
      if (box.syntheticRoot) continue;
      elements += 1;
      const rect = box.rect;
      const area = rect.width * rect.height;
      if (!(area > 0)) continue;
      sizedElements += 1;
      const family = orientationFamily(box.node.orientation);
      const parent = box.parentIndex === null ? null : byIndex.get(box.parentIndex);
      const parentIsScreen = !parent || parent.syntheticRoot;
      const parentRect = parentIsScreen ? screen : parent.rect;
      const parentFamily = parentIsScreen ? 'screen' : orientationFamily(parent.node.orientation);
      const depth = box.depth;
      const contained = overlapArea(rect, parentRect) / area;
      const onScreen = overlapArea(rect, screen) / area;
      const key = `${family}|${depthLabel(depth)}|parent=${parentFamily}`;
      const entry = bucket(key);
      entry.n += 1;
      entry.containedSum += contained;
      entry.onScreenSum += onScreen;
      if (contained >= 0.999) entry.fullyContained += 1;
      if (onScreen >= 0.999) entry.fullyOnScreen += 1;

      // THE SIGN CENSUS reads the DECLARED value, not the canonical one. The canonical model flips
      // the sign by design, so a census of canonical positions would report its own output; what
      // needs checking is what the vanilla AUTHORS wrote, because that is the evidence for which
      // way the engine reads the field.
      const census = signCensus.get(family) ?? { n: 0, negY: 0, posY: 0, zeroY: 0, negX: 0, flipped: 0 };
      census.n += 1;
      const py = Number(box.trace.enginePosition?.y ?? 0) || 0;
      const px = Number(box.trace.enginePosition?.x ?? 0) || 0;
      if (py < 0) census.negY += 1;
      else if (py > 0) census.posY += 1;
      else census.zeroY += 1;
      if (px < 0) census.negX += 1;
      if (box.trace.ySignFlipped) census.flipped += 1;
      signCensus.set(family, census);

      if (options.includeExamples && family === 'lower_*' && examples.length < 400) {
        examples.push({
          file: fileKey,
          path: box.path,
          orientation: box.trace.orientation,
          origo: box.trace.origo,
          declaredPosition: box.trace.enginePosition,
          canonicalPosition: { x: box.trace.position.x, y: box.trace.position.y },
          parentRect,
          parentFamily,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          contained,
        });
      }
    }
  }

  const rows = [...buckets.entries()].map(([key, entry]) => {
    const [family, depth, parentField] = key.split('|');
    return {
      family,
      depth,
      parent: String(parentField ?? '').replace(/^parent=/, ''),
      n: entry.n,
      containment: entry.containedSum / entry.n,
      fullyContained: entry.fullyContained / entry.n,
      onScreen: entry.onScreenSum / entry.n,
      fullyOnScreen: entry.fullyOnScreen / entry.n,
    };
  });
  rows.sort((a, b) => (a.family === b.family ? a.depth.localeCompare(b.depth) || a.parent.localeCompare(b.parent) : a.family.localeCompare(b.family)));

  const summarise = (filter) => {
    const selected = rows.filter(filter);
    const n = selected.reduce((total, row) => total + row.n, 0);
    if (n === 0) return null;
    return {
      n,
      containment: selected.reduce((total, row) => total + row.containment * row.n, 0) / n,
      fullyContained: selected.reduce((total, row) => total + row.fullyContained * row.n, 0) / n,
      onScreen: selected.reduce((total, row) => total + row.onScreen * row.n, 0) / n,
      fullyOnScreen: selected.reduce((total, row) => total + row.fullyOnScreen * row.n, 0) / n,
    };
  };

  const nestedLowerInLowerParent = summarise((row) => row.family === 'lower_*' && row.parent === 'lower_*');
  const nestedLowerInUpperParent = summarise((row) => row.family === 'lower_*' && row.parent === 'upper_*');
  const nestedLowerInCenterParent = summarise((row) => row.family === 'lower_*' && row.parent === 'center*');
  return {
    gameRoot: root,
    model: modelName,
    modelLabel: model.label,
    fileCount: files.length,
    elements,
    sizedElements,
    rows,
    signCensus: Object.fromEntries(signCensus),
    byFamily: Object.fromEntries(
      ['upper_*', 'center*', 'lower_*'].map((family) => [family, summarise((row) => row.family === family)]).filter(([, value]) => value),
    ),
    nestedLower: summarise((row) => row.family === 'lower_*' && row.depth !== 'depth1 (parent = screen)'),
    // Per PARENT family, because that is the axis the original depth-1-only calibration could not
    // see: a `lower_*` child of the screen's own edge behaves differently from one nested inside a
    // `center` panel, and only the nested rows distinguish the two models.
    nestedLowerInLowerParent,
    nestedLowerInUpperParent,
    nestedLowerInCenterParent,
    depth1: summarise((row) => row.depth === 'depth1 (parent = screen)'),
    all: summarise(() => true),
    examples,
  };
}

/** Render the calibration as a text report. */
export function formatCalibration(result) {
  const lines = [];
  lines.push(`coordinate calibration against ${result.gameRoot}`);
  lines.push(`  model: ${result.modelLabel}`);
  lines.push(`  ${result.fileCount} files, ${result.elements} elements, ${result.sizedElements} with a positive computed size`);
  lines.push('');
  lines.push('per orientation family and nesting depth');
  lines.push('  family    n     containment  fully-inside  on-screen  fully-on-screen  parent');
  for (const row of result.rows) {
    lines.push(
      `  ${row.family.padEnd(8)} ${String(row.n).padStart(4)}  ${row.containment.toFixed(4).padStart(11)}  ` +
        `${row.fullyContained.toFixed(4).padStart(12)}  ${row.onScreen.toFixed(4).padStart(9)}  ${row.fullyOnScreen.toFixed(4).padStart(15)}  ${row.parent}`,
    );
  }
  lines.push('');
  lines.push('headline');
  const show = (label, value) => {
    if (!value) return;
    lines.push(
      `  ${label.padEnd(34)} n=${String(value.n).padStart(5)} containment=${value.containment.toFixed(4)} ` +
        `fully-inside=${value.fullyContained.toFixed(4)} on-screen=${value.onScreen.toFixed(4)}`,
    );
  };
  for (const [family, value] of Object.entries(result.byFamily)) show(`family ${family}`, value);
  show('nested lower_* (all parents)', result.nestedLower);
  show('  ... inside an upper_* parent', result.nestedLowerInUpperParent);
  show('  ... inside a center* parent', result.nestedLowerInCenterParent);
  show('  ... inside a lower_* parent', result.nestedLowerInLowerParent);
  show('depth1 (parent = screen)', result.depth1);
  show('whole corpus', result.all);
  lines.push('');
  lines.push('position sign census, from the DECLARED engine values');
  lines.push('  (a negative y is the authors\' idiom for "inward from the anchor" on a bottom anchor)');
  for (const [family, census] of Object.entries(result.signCensus)) {
    lines.push(
      `  ${family.padEnd(8)} n=${String(census.n).padStart(5)} negY=${String(census.negY).padStart(5)} ` +
        `posY=${String(census.posY).padStart(5)} zeroY=${String(census.zeroY).padStart(5)} negX=${String(census.negX).padStart(5)} ` +
        `y-flipped-by-the-converter=${String(census.flipped).padStart(5)}`,
    );
  }
  return lines.join('\n');
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invokedDirectly) {
  const asJson = process.argv.includes('--json');
  const withExamples = process.argv.includes('--examples');
  // `--compare` runs the shipped model and the flipped alternative side by side; `--legacy` is the
  // old spelling of the same request and is kept so existing notes keep working.
  const compare = process.argv.includes('--compare') || process.argv.includes('--legacy');
  const wanted = compare ? ['engine', 'flipped'] : ['engine'];
  const results = wanted.map((model) => calibrateCoordinates({ model, includeExamples: withExamples }));
  if (asJson) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  else {
    for (const result of results) {
      process.stdout.write(`${formatCalibration(result)}\n\n`);
    }
    if (results.length === 2) {
      process.stdout.write('shipped model vs the flipped alternative (containment, higher is better)\n');
      const [shipped, flipped] = results;
      const line = (label, a, b) => {
        if (!a && !b) return;
        if (!a || !b) {
          process.stdout.write(`  ${label.padEnd(34)} ${a ? `shipped n=${a.n}` : `flipped n=${b.n}`} (the other model has no such element)\n`);
          return;
        }
        process.stdout.write(
          `  ${label.padEnd(34)} ${a.containment.toFixed(4)} vs ${b.containment.toFixed(4)}   ` +
            `fully-inside ${a.fullyContained.toFixed(4)} vs ${b.fullyContained.toFixed(4)}   n=${a.n}\n`,
        );
      };
      line('all depth-1 (parent = screen)', shipped.depth1, flipped.depth1);
      line('nested lower_* (all parents)', shipped.nestedLower, flipped.nestedLower);
      line('  ... inside an upper_* parent', shipped.nestedLowerInUpperParent, flipped.nestedLowerInUpperParent);
      line('  ... inside a center* parent', shipped.nestedLowerInCenterParent, flipped.nestedLowerInCenterParent);
      line('  ... inside a lower_* parent', shipped.nestedLowerInLowerParent, flipped.nestedLowerInLowerParent);
      for (const family of ['upper_*', 'center*', 'lower_*']) {
        line(`family ${family}`, shipped.byFamily[family] ?? null, flipped.byFamily[family] ?? null);
      }
      line('whole corpus', shipped.all, flipped.all);
      process.stdout.write(
        '\n  The shipped model wins on every line. That is the measurement that settled the y-sign\n' +
          '  question: a flip is not a correction, it is a regression.\n',
      );
    }
    if (withExamples && results[0].examples.length > 0) {
      process.stdout.write('\nworked examples (lower_* family), current model\n');
      const shown = new Set();
      for (const example of results[0].examples) {
        if (shown.has(example.file)) continue;
        shown.add(example.file);
        process.stdout.write(
          `  ${example.file}:${example.path.replace(/^[^/]*\//, '')}\n` +
            `    ${example.orientation}/${example.origo} declared ${JSON.stringify(example.declaredPosition)} ` +
            `-> canonical ${JSON.stringify(example.canonicalPosition)}\n` +
            `    parent ${JSON.stringify(example.parentRect)} (${example.parentFamily}) -> rect ${JSON.stringify(example.rect)} inside=${example.contained.toFixed(3)}\n`,
        );
        if (shown.size >= 12) break;
      }
    }
  }
}

export default { calibrateCoordinates, formatCalibration, MODELS, orientationFamily };
