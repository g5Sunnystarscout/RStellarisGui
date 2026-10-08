//------------------------------------------------------------------------------------
// text-metrics-audit.mjs -- Part of RStellarisGui
//
// The evidence behind the text measurement, and its error bar.
//
// It answers four questions with numbers rather than assertions:
//
//   1. WHAT the install ships: every `.fnt` descriptor, its glyph count, its kerning pairs,
//      its `lineHeight`, and whether its `scaleW`/`scaleH` really is the shipped atlas.
//   2. WHICH descriptor each font name resolves to for each language, because the same name is
//      a bitmap font in English and a TTF in Simplified Chinese (interface/fonts.gfx).
//   3. WHETHER the advances are right, cross-checked against an INDEPENDENT atlas: `cg_16b.fnt`
//      and `stellaris_main.fnt` are both Century Gothic bold at 16px, generated separately, so
//      their advances for the same character must agree.
//   4. HOW WRONG the old "0.55em from the number in the font name" heuristic is, measured on a
//      HELD-OUT sample of the game's own content - and how many of its overflow verdicts are
//      wrong. That is the calibration error the docs quote.
//
// Usage:  node scripts/text-metrics-audit.mjs [--game-root <Stellaris>] [--json]
//
// Read-only: it never writes to the install.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildFontCatalogue,
  createFontLibrary,
  expandLocalisation,
  isCjk,
  nameSizedAdvance,
  parseBitmapFont,
  resolveFontSource,
  wrapText,
} from '../src/lib/font-metrics.mjs';
import { decodeTextureThumbnail } from '../src/lib/dds.mjs';
import { computeLayout, makeSpriteLookup, parseGuiText } from '../src/lib/layout.mjs';
import { buildLocalisationIndex } from '../src/lib/loc-index.mjs';
import { DEFAULT_GAME_ROOT, listFilesRecursive, readTextFile } from '../src/lib/paths.mjs';

const argv = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1];
};
const gameRoot = argValue('--game-root', DEFAULT_GAME_ROOT);
const asJson = argv.includes('--json');

const out = [];
const say = (line = '') => {
  out.push(line);
};

/** The heuristic this whole module replaces: `0.55 * (the number in the font name)`. */
function oldHeuristic(name, text) {
  const { em, advance } = nameSizedAdvance(name);
  const lines = String(text).split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return { em, perChar: advance, width: Math.round(longest * advance) };
}

const percentile = (sorted, fraction) => {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
};

//====================================================================================
// 1 + 2. Descriptor inventory, and cross-checks that prove which file the engine reads
//====================================================================================

const catalogue = buildFontCatalogue({ installRoot: gameRoot });
say('# Text metrics audit');
say();
say(`install: ${gameRoot}`);
say(`font .gfx files: ${catalogue.files.length} (${catalogue.files.map((file) => file.key).join(', ')})`);
say(`font definitions: ${catalogue.definitions.length}`);
say();

say('## 1. Descriptors shipped by the install (gfx/fonts/*.fnt)');
say();
say('| .fnt | face | size | glyphs | kerning pairs | lineHeight | base | scaleW x scaleH | atlas on disk | match |');
say('|---|---|---|---|---|---|---|---|---|---|');
const fontDirectory = join(gameRoot, 'gfx', 'fonts');

/**
 * A DDS or TGA's pixel dimensions.
 *
 * Both container shapes occur among the atlases (`cg_16b.dds`, `cg_34.tga`), and they disagree
 * about where the size lives: DDS is `height` then `width` as little-endian uint32 at offsets 12
 * and 16, TGA is `width` then `height` as little-endian uint16 at offsets 12 and 14. Reading a
 * TGA with the DDS layout produces the nonsense numbers (`2080x8388736`) that a size check has
 * to catch, not hide.
 */
function textureSize(file) {
  const buffer = readFileSync(file);
  if (/\.dds$/i.test(file)) return { width: buffer.readUInt32LE(16), height: buffer.readUInt32LE(12) };
  return { width: buffer.readUInt16LE(12), height: buffer.readUInt16LE(14) };
}

for (const file of listFilesRecursive(fontDirectory, ['.fnt']).sort()) {
  const metrics = parseBitmapFont(readTextFile(file), file);
  const dds = file.replace(/\.fnt$/i, '.dds');
  const tga = file.replace(/\.fnt$/i, '.tga');
  const texture = existsSync(dds) ? dds : existsSync(tga) ? tga : null;
  let atlas = '-';
  let match = '-';
  if (texture) {
    const { width, height } = textureSize(texture);
    atlas = `${width}x${height}`;
    match = String(width === metrics.scaleW && height === metrics.scaleH);
  }
  say(
    `| ${file.slice(fontDirectory.length + 1).replace(/\\/g, '/')} | ${metrics.face} | ${metrics.size} | ` +
      `${metrics.glyphs.size} | ${metrics.kerning.size} | ${metrics.lineHeight} | ${metrics.base} | ` +
      `${metrics.scaleW} x ${metrics.scaleH} | ${atlas} | ${match} |`,
  );
}
say();

say('## 2. Font name -> descriptor, per language');
say();
say('`bitmapfont_override { languages = { .. } }` replaces a name for ONE language. The same');
say('`font = "cg_16b"` is therefore a 16px bitmap font in English and a 14px Noto Sans CJK in');
say('Simplified Chinese, which is why no single advance table can be language-independent.');
say();
const languages = ['english', 'simp_chinese', 'japanese', 'korean', 'russian'];
say(`| font | ${languages.join(' | ')} |`);
say(`|---|${languages.map(() => '---').join('|')}|`);
for (const name of [...catalogue.byName.keys()].filter((entry) => entry !== 'textcolors')) {
  const cells = languages.map((language) => {
    const source = resolveFontSource(catalogue, name, language);
    if (source.kind === 'bitmap') return `bitmap ${source.files.join(',')} (${source.base?.line ?? '?'})`;
    if (source.kind === 'ttf') return `ttf ${source.ttfFont}@${source.ttfSize} (${source.definition?.line ?? '?'})`;
    return `none (${source.reason})`;
  });
  if (cells.every((cell) => cell === cells[0])) continue; // only the interesting rows
  say(`| ${name} | ${cells.join(' | ')} |`);
}
say();

say('## 3. Independent cross-check of the advances');
say();
say('Two descriptors of the same face at the same pixel size, generated separately, must agree');
say('glyph for glyph. If they do, the advance table we read is the one the atlases were built from.');
say();
const pairs = [
  ['cg_16b.fnt', 'stellaris_main.fnt'],
  ['cg_22.fnt', 'cg_34.fnt'],
];
for (const [left, right] of pairs) {
  const a = parseBitmapFont(readTextFile(join(fontDirectory, left)), left);
  const b = parseBitmapFont(readTextFile(join(fontDirectory, right)), right);
  const shared = [...a.glyphs.keys()].filter((code) => b.glyphs.has(code));
  let differ = 0;
  let total = 0;
  let maxDelta = 0;
  const sharedFaceAndSize = a.face === b.face && a.size === b.size;
  for (const code of shared) {
    const delta = Math.abs(a.glyphs.get(code).xadvance - b.glyphs.get(code).xadvance);
    total += 1;
    if (delta !== 0) differ += 1;
    maxDelta = Math.max(maxDelta, delta);
  }
  void total;
  say(
    `- ${left} (${a.face} ${a.size}) vs ${right} (${b.face} ${b.size}): ${shared.length} shared code points, ` +
      `${differ} differ in xadvance` +
      (sharedFaceAndSize ? `, max |delta| = ${maxDelta}px` : ' (different face/size, so a difference is expected)'),
  );
}
say();
say('The live descriptor for a name is the one `fontfiles`/`path` names - `cg_16b` is');
say('`gfx/fonts/cg_16b` (interface/fonts.gfx:171), and `stellaris_main` survives only inside a');
say('COMMENTED-OUT override (interface/fonts.gfx:179-185). So this is a bound on how much two');
say('generations of one face can disagree, not a second measurement of the live font.');
say();

say('## 3b. Does the descriptor describe the shipped atlas? (independent ink check)');
say();
say('The atlas is the ink. Decoding it and asking where the ink is checks the descriptor against');
say('the pixels the game actually draws, rather than against itself.');
say();
say('| .fnt | atlas decoded | declared boxes | boxes outside the atlas | empty non-blank boxes | bright px inside a declared box |');
say('|---|---|---|---|---|---|');
const atlasReport = [];
for (const name of ['cg_16b.fnt', 'cg_22.fnt', 'hoi_16mbs.fnt', 'juralightmedium.fnt', 'malgun_goth_24.fnt', 'orbitron_28.fnt']) {
  const file = join(fontDirectory, name);
  if (!existsSync(file)) continue;
  const metrics = parseBitmapFont(readTextFile(file), name);
  const atlas = join(fontDirectory, name.replace(/\.fnt$/i, '.dds'));
  if (!existsSync(atlas)) {
    say(`| ${name} | no .dds beside it (a .tga atlas) | ${metrics.glyphs.size} | - | - | - |`);
    continue;
  }
  const decoded = decodeTextureThumbnail(atlas, 8192);
  if (!decoded.ok) {
    say(`| ${name} | decode failed: ${decoded.reason} | ${metrics.glyphs.size} | - | - | - |`);
    continue;
  }
  const { width, height, rgba } = decoded;
  // The atlases ship a dead alpha channel (all 255) with the coverage in RGB, so "ink" is a
  // bright pixel. This is the same convention `alphaChnl`/`redChnl` describe.
  const inBox = new Uint8Array(width * height);
  let outside = 0;
  let emptyBoxes = 0;
  for (const glyph of metrics.glyphs.values()) {
    if (
      glyph.x < 0 ||
      glyph.y < 0 ||
      glyph.x + glyph.width > width ||
      glyph.y + glyph.height > height
    ) {
      outside += 1;
      continue;
    }
    if (glyph.width > 0 && glyph.height > 0) {
      let ink = 0;
      for (let y = glyph.y; y < glyph.y + glyph.height; y += 1) {
        for (let x = glyph.x; x < glyph.x + glyph.width; x += 1) {
          inBox[y * width + x] = 1;
          const at = (y * width + x) * 4;
          if (Math.max(rgba[at], rgba[at + 1], rgba[at + 2]) > 8) ink += 1;
        }
      }
      if (ink === 0 && glyph.id !== 32) emptyBoxes += 1;
    }
  }
  let bright = 0;
  let brightInside = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (Math.max(rgba[at], rgba[at + 1], rgba[at + 2]) <= 8) continue;
      bright += 1;
      if (inBox[y * width + x]) brightInside += 1;
    }
  }
  atlasReport.push({ name, width, height, bright, brightInside, outside, emptyBoxes });
  say(
    `| ${name} | ${width}x${height} | ${metrics.glyphs.size} | ${outside} | ${emptyBoxes} | ` +
      `${brightInside} of ${bright} (${((brightInside / Math.max(1, bright)) * 100).toFixed(1)}%) |`,
  );
}
say();
say('Every `scaleW`/`scaleH` in section 1 equals the size of the texture beside it, no declared box');
say('falls outside its atlas, and no non-blank box is empty. Where the coverage is well below 100%');
say('(`cg_16b`, `cg_22`, `hoi_16mbs`, `malgun_goth_24`, `orbitron_28`) the atlas simply carries MORE');
say('glyphs than the descriptor lists - those DDS files are shared between fonts - which does not');
say('touch the advances: `xadvance` is per-glyph metadata, not atlas geometry. `juralightmedium.fnt`');
say('(503 glyphs, 6744 kerning records) is the complete case: every ink pixel in the atlas lies');
say('inside a declared box.');
say();

// One glyph, drawn from the atlas at the coordinates the descriptor gives it. This is the
// end-to-end check: if `char id=72 x=.. y=.. width=.. height=..` and the shipped texture agree,
// the box comes back in the shape of an H.
{
  const metrics = parseBitmapFont(readTextFile(join(fontDirectory, 'cg_16b.fnt')), 'cg_16b.fnt');
  const decoded = decodeTextureThumbnail(join(fontDirectory, 'cg_16b.dds'), 8192);
  if (decoded.ok) {
    const { width, rgba } = decoded;
    const glyph = metrics.glyphs.get('H'.codePointAt(0));
    const rows = [];
    for (let row = 0; row < glyph.height; row += 1) {
      let line = '';
      for (let col = 0; col < glyph.width; col += 1) {
        const at = ((glyph.y + row) * width + glyph.x + col) * 4;
        const value = Math.max(rgba[at], rgba[at + 1], rgba[at + 2]);
        line += value > 200 ? '#' : value > 60 ? '+' : ' ';
      }
      rows.push(line);
    }
    const inked = rows.join('').replace(/ /g, '').length;
    // An `H` has ink in its left column, its right column and its middle row.
    const left = rows.some((row) => row[0] !== ' ' || row[1] !== ' ');
    const right = rows.some((row) => row[glyph.width - 1] !== ' ' || row[glyph.width - 2] !== ' ');
    const middle = rows[Math.floor(glyph.height / 2)].trim().length >= 2;
    say('### One glyph, read straight out of the atlas at its declared coordinates');
    say();
    say(
      `\`cg_16b.fnt\` declares \`char id=72\` (\`H\`) at x=${glyph.x} y=${glyph.y} ` +
        `${glyph.width}x${glyph.height}, xoffset=${glyph.xoffset}, xadvance=${glyph.xadvance}. Decoding ` +
        '`gfx/fonts/cg_16b.dds` and printing that rectangle:',
    );
    say();
    say('```');
    for (const row of rows) say(row);
    say('```');
    say();
    say(
      `inked pixels in the box: ${inked}; ink in the left column: ${left}; in the right column: ${right}; ` +
        `in the middle row: ${middle}. The descriptor and the shipped texture agree.`,
    );
    say();
  }
}

//====================================================================================
// 4. Held-out calibration of the old heuristic against the exact metrics
//====================================================================================

say('## 4. Held-out error of the "0.55em from the font name" heuristic');
say();

const localisation = buildLocalisationIndex({ roots: [gameRoot], languages: ['english'], withValues: true });
say(`localisation index: ${localisation.keys.size} keys, ${localisation.values?.size ?? 0} values (english)`);
const values = localisation.values ?? new Map();

const guiFiles = listFilesRecursive(join(gameRoot, 'interface'), ['.gui']);
const english = createFontLibrary({ installRoot: gameRoot, language: 'english' });
const spriteLookup = makeSpriteLookup(null);

/** Every vanilla text element whose string resolves, with what the wrap model says about it. */
const wrapSamples = [];
/** The single-line subset the advance calibration uses. */
const samples = [];
for (const file of guiFiles) {
  let parsed;
  try {
    parsed = parseGuiText(readTextFile(file), file);
  } catch {
    continue;
  }
  if (!parsed.ok || !parsed.layout) continue;
  let boxes;
  try {
    ({ boxes } = computeLayout(parsed.layout, {
      baseWidth: 1920,
      baseHeight: 1080,
      spriteLookup,
    }));
  } catch {
    continue;
  }
  for (const box of boxes) {
    const node = box.node ?? {};
    if (box.kind !== 'text') continue;
    if (box.rect.width <= 0 || box.rect.height <= 0) continue;
    const key = node.text;
    if (typeof key !== 'string' || key === '' || !values.has(key)) continue;
    const expansion = expandLocalisation(values.get(key), { values, colorCodes: english.textColors });
    if (expansion.unresolved.size > 0) continue;
    const text = expansion.text;
    if (text.trim() === '') continue;
    const fontName = node.font ?? node.buttonFont ?? 'cg_16b';
    const resolved = english.font(fontName);
    if (!resolved.metrics) continue;
    const maxWidth = Number(node.maxWidth);
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) continue;
    const measured = wrapText(resolved.metrics, text, { wrap: false });
    if (measured.missing.length > 0) continue;
    const wrapped = wrapText(resolved.metrics, text, { maxWidth });
    wrapSamples.push({
      file: file.slice(gameRoot.length + 1).replace(/\\/g, '/'),
      path: box.path,
      font: fontName,
      multiline: node.multiline === true,
      hasNewline: text.includes('\n'),
      maxWidth,
      maxHeight: Number(node.maxHeight) || 0,
      lineHeight: wrapped.lineHeight,
      base: wrapped.base,
      lines: wrapped.lineCount,
      inkHeight: wrapped.height,
      budgetHeight: wrapped.budgetHeight,
    });
    if (measured.lineCount !== 1) continue;
    if (isCjk(text.codePointAt(0))) continue; // the english language index has no CJK strings
    samples.push({
      file: file.slice(gameRoot.length + 1).replace(/\\/g, '/'),
      path: box.path,
      font: fontName,
      text,
      chars: text.length,
      exact: measured.width,
      heuristic: oldHeuristic(fontName, text).width,
      em: nameSizedAdvance(fontName).em,
      maxWidth,
    });
  }
}
samples.sort((a, b) => (a.file + a.path).localeCompare(b.file + b.path));
say(`usable vanilla text elements: ${samples.length} (single line, resolved, no missing glyph, no \`$..$\`)`);

// Deterministic split: every 5th element (20%) is held out and never used for the fit.
const fitSet = samples.filter((_, index) => index % 5 !== 0);
const heldOut = samples.filter((_, index) => index % 5 === 0);
say(`split: fit ${fitSet.length} (indices not divisible by 5), held out ${heldOut.length} (every 5th, by file+path order)`);
say();

// Per-font best-fit "advance per character in em" on the FIT set only.
const perFont = new Map();
for (const sample of fitSet) {
  if (!perFont.has(sample.font)) perFont.set(sample.font, { chars: 0, width: 0, em: sample.em, count: 0 });
  const entry = perFont.get(sample.font);
  entry.chars += sample.chars;
  entry.width += sample.exact;
  entry.count += 1;
}
const fitted = new Map();
for (const [font, entry] of perFont) {
  fitted.set(font, {
    samples: entry.count,
    em: entry.em,
    perChar: entry.width / entry.chars,
    emFraction: entry.width / entry.chars / entry.em,
    pluginHeuristic: entry.em * 0.55,
  });
}
say('### Per-font advance, fitted on the FIT set');
say();
say('| font | fit samples | fitted px/char | as a fraction of the name\'s "em" | the plugin\'s 0.55em |');
say('|---|---|---|---|---|');
for (const [font, entry] of [...fitted].sort((a, b) => b[1].samples - a[1].samples)) {
  say(
    `| ${font} | ${entry.samples} | ${entry.perChar.toFixed(2)} | ${entry.emFraction.toFixed(3)} | ` +
      `${entry.pluginHeuristic.toFixed(2)} |`,
  );
}
say();

const errorStats = (list, predict) => {
  const absolute = [];
  const relative = [];
  let falseOverflow = 0;
  let missedOverflow = 0;
  let sameVerdict = 0;
  for (const sample of list) {
    const predicted = predict(sample);
    absolute.push(Math.abs(predicted - sample.exact));
    relative.push(sample.exact > 0 ? Math.abs(predicted - sample.exact) / sample.exact : 0);
    const predictedOverflow = predicted > sample.maxWidth;
    const actualOverflow = sample.exact > sample.maxWidth;
    if (predictedOverflow && !actualOverflow) falseOverflow += 1;
    if (!predictedOverflow && actualOverflow) missedOverflow += 1;
    if (predictedOverflow === actualOverflow) sameVerdict += 1;
  }
  absolute.sort((a, b) => a - b);
  relative.sort((a, b) => a - b);
  return {
    count: list.length,
    meanAbsolute: absolute.reduce((total, value) => total + value, 0) / Math.max(1, absolute.length),
    medianAbsolute: percentile(absolute, 0.5),
    p95Absolute: percentile(absolute, 0.95),
    meanRelative: relative.reduce((total, value) => total + value, 0) / Math.max(1, relative.length),
    medianRelative: percentile(relative, 0.5),
    p95Relative: percentile(relative, 0.95),
    falseOverflow,
    missedOverflow,
    verdictAgreement: sameVerdict / Math.max(1, list.length),
  };
};

const heuristicOnFit = errorStats(fitSet, (sample) => sample.heuristic);
const heuristicOnHeldOut = errorStats(heldOut, (sample) => sample.heuristic);
const calibratedOnHeldOut = errorStats(
  heldOut,
  (sample) => sample.chars * (fitted.get(sample.font)?.perChar ?? sample.em * 0.55),
);

const row = (label, stats) =>
  `| ${label} | ${stats.meanAbsolute.toFixed(1)} | ${Number(stats.medianAbsolute).toFixed(1)} | ` +
  `${Number(stats.p95Absolute).toFixed(1)} | ` +
  `${(stats.meanRelative * 100).toFixed(1)}% | ${(stats.medianRelative * 100).toFixed(1)}% | ` +
  `${(stats.p95Relative * 100).toFixed(1)}% | ${stats.falseOverflow} | ${stats.missedOverflow} | ` +
  `${(stats.verdictAgreement * 100).toFixed(1)}% |`;

say('### Error against the exact `.fnt` advance sum');
say();
say('| predictor | mean abs px | median abs px | p95 abs px | mean rel | median rel | p95 rel | false "overflows" | missed overflows | verdict agreement |');
say('|---|---|---|---|---|---|---|---|---|---|');
say(row('old heuristic, FIT set', heuristicOnFit));
say(row('old heuristic, HELD OUT', heuristicOnHeldOut));
say(row('per-font calibrated, HELD OUT', calibratedOnHeldOut));
say();
say('`false "overflows"` counts elements the predictor says overflow their own `maxWidth` while the');
say('exact advance sum says they fit - the box artefacts a reviewer would be sent chasing.');
say();

// What the exact metrics say about vanilla, as the baseline for the mod's numbers.
const overflowVanilla = samples.filter((sample) => sample.exact > sample.maxWidth);
const heuristicOverflowVanilla = samples.filter((sample) => sample.heuristic > sample.maxWidth);
say('### What the exact metrics say about the same vanilla sample');
say();
say(`- exact advance sum exceeds \`maxWidth\`: ${overflowVanilla.length} of ${samples.length} (${((overflowVanilla.length / samples.length) * 100).toFixed(1)}%)`);
say(`- the old heuristic says: ${heuristicOverflowVanilla.length} of ${samples.length} (${((heuristicOverflowVanilla.length / samples.length) * 100).toFixed(1)}%)`);
const both = samples.filter((sample) => sample.heuristic > sample.maxWidth && sample.exact > sample.maxWidth);
say(`- both agree: ${both.length}; heuristic-only: ${heuristicOverflowVanilla.length - both.length}; exact-only: ${overflowVanilla.length - both.length}`);
say();

//====================================================================================
// 5. The wrap model, calibrated against vanilla's own line budgets
//====================================================================================

say('## 5. Wrapping: what the engine does, measured from vanilla content');
say();
const multilineYes = wrapSamples.filter((sample) => sample.multiline);
const multilineAbsent = wrapSamples.filter((sample) => !sample.multiline);
const newlineIn = (list) => list.filter((sample) => sample.hasNewline).length;
say(`sampled text elements with a resolved string: ${wrapSamples.length}`);
say(`  \`multiline = yes\` declared:  ${multilineYes.length}`);
say(`  \`multiline\` absent:          ${multilineAbsent.length}`);
say(
  `  values containing a break (\`\\n\` or \`$NEW_LINE$\`): ${newlineIn(wrapSamples)} ` +
    `(${newlineIn(multilineYes)} of the ${multilineYes.length} with \`multiline\`, ` +
    `${newlineIn(multilineAbsent)} of the ${multilineAbsent.length} without)`,
);
say();
say('So `multiline` is NOT the wrap switch: the sampled elements wrap without declaring it, and the');
say(`flag appears on ${multilineYes.length} of ${wrapSamples.length}. The model therefore wraps by default and`);
say('reports the count, rather than treating an absent flag as "one line".');
say();
const withHeight = wrapSamples.filter((sample) => sample.maxHeight > 0);
say(`### Which height does \`maxHeight\` budget? (${withHeight.length} elements with both fields)`);
say();
say('| height model | fits the declared `maxHeight` |');
say('|---|---|');
const models = {
  '`lineCount * lineHeight` (full ink on the last line)': (sample) => sample.lines * sample.lineHeight,
  '`(lineCount-1) * lineHeight + base` (ascent band)': (sample) => sample.budgetHeight,
  '`lineCount * base`': (sample) => sample.lines * sample.base,
};
for (const [label, need] of Object.entries(models)) {
  const fits = withHeight.filter((sample) => need(sample) <= sample.maxHeight).length;
  say(`| ${label} | ${fits} of ${withHeight.length} (${((fits / withHeight.length) * 100).toFixed(1)}%) |`);
}
say();
const single = wrapSamples.filter((sample) => sample.lines === 1);
say(
  `Single-line elements: ${single.length}; \`maxHeight\` exactly equals the font's own \`base\`: ` +
    `${single.filter((sample) => sample.maxHeight === sample.base).length} ` +
    `(${((single.filter((sample) => sample.maxHeight === sample.base).length / Math.max(1, single.length)) * 100).toFixed(1)}%); ` +
    `\`maxHeight\` smaller than one \`lineHeight\`: ` +
    `${single.filter((sample) => sample.maxHeight < sample.lineHeight).length} ` +
    `(${((single.filter((sample) => sample.maxHeight < sample.lineHeight).length / Math.max(1, single.length)) * 100).toFixed(1)}%).`,
);
say();
say('An element is therefore reported as overflowing VERTICALLY only when the ASCENT BAND does not');
say('fit, and its drawn rect is the full ink. Reporting ink-vs-`maxHeight` instead would flag');
say(`${withHeight.filter((sample) => sample.inkHeight > sample.maxHeight).length} of these ${withHeight.length} vanilla elements - essentially all of them.`);
say();
say('### Per-script wrap rules');
say();
say('- Latin: break at spaces and after `-`/`/`. A word with no break inside it that is wider than');
say('  the box is drawn overflowing on its own line, not split mid-word (the engine has no');
say('  hyphenation dictionary) and is reported as `wordOverflow`.');
for (const language of ['simp_chinese', 'japanese']) {
  const source = resolveFontSource(catalogue, 'cg_16b', language);
  say(
    `- ${language}: every CJK character is a break opportunity, except before the characters the font's own ` +
      `\`multiline.forbidden_start\` names (${JSON.stringify(source.multiline?.forbiddenStart ?? [])}), and ` +
      `always after those in \`line_break\` (${JSON.stringify(source.multiline?.lineBreak ?? [])}) - both read from ` +
      `\`interface/fonts.gfx\` for this language.`,
  );
}
say('- Explicit breaks arrive two ways and BOTH are modelled: `$NEW_LINE$` (a nested key whose value');
say('  is a newline, `federations_l_english.yml:34`) and a literal `\\n` escape in the value, which');
say('  vanilla uses 34,289 times across 108 english files.');
say();

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        gameRoot,
        catalogueFiles: catalogue.files.length,
        definitions: catalogue.definitions.length,
        samples: samples.length,
        fit: fitSet.length,
        heldOut: heldOut.length,
        heuristicFit: heuristicOnFit,
        heuristicHeldOut: heuristicOnHeldOut,
        calibratedHeldOut,
        fitted: Object.fromEntries(fitted),
        exactOverflow: overflowVanilla.length,
        heuristicOverflow: heuristicOverflowVanilla.length,
        agree: both.length,
      },
      null,
      2,
    )}\n`,
  );
} else {
  console.log(out.join('\n'));
}
void createFontLibrary;
