//------------------------------------------------------------------------------------
// text-overflow-report.mjs -- Part of RStellarisGui
//
// Measure a real `.gui` file's TEXT and report what the box model could not see.
//
// It answers, for one file and one language:
//
//   * how many `sibling-overlap` findings the box rule produces, and how many of those survive
//     once the MEASURED ink is compared instead of the box (the "box artefact" count);
//   * how many text elements' RENDERED string does not fit `maxWidth`/`maxHeight`;
//   * how many text blocks collide with another element's text while their BOXES do not
//     intersect at all - the wrap-induced case, where a block grew down onto the row below;
//   * the same counts with WRAPPING TURNED OFF, so the two effects can be told apart;
//   * a per-element table with the measured width/height, the wrapped line count and the fit.
//
//   node scripts/text-overflow-report.mjs \
//     --gui <mods>\geocentric_origin\interface\zz_geocentric_unga.gui \
//     --mod <mods>\geocentric_origin --language simp_chinese
//
// Read-only: nothing outside this project is written.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { measureElementText, sharedFontLibrary } from '../src/lib/font-metrics.mjs';
import { computeLayout, makeSpriteLookup, parseGuiText } from '../src/lib/layout.mjs';
import { buildLocalisationIndex } from '../src/lib/loc-index.mjs';
import { DEFAULT_GAME_ROOT, readTextFile } from '../src/lib/paths.mjs';
import { validateGuiText } from '../src/lib/validate.mjs';

const argv = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1];
};
const hasFlag = (flag) => argv.includes(flag);

const guiPath = argValue('--gui', '<mods>\\geocentric_origin\\interface\\zz_geocentric_unga.gui');
const modRoot = argValue('--mod', dirname(dirname(guiPath)));
const gameRoot = argValue('--game-root', DEFAULT_GAME_ROOT);
const language = argValue('--language', 'english');
const asJson = hasFlag('--json');
const elementFilter = argValue('--elements', null);

if (!existsSync(guiPath)) {
  console.error(`no such .gui file: ${guiPath}`);
  process.exit(2);
}

const out = [];
const say = (line = '') => out.push(line);

// The mod's own localisation must win over the install's, so its folder is passed as an extra
// directory (directories are read after roots, and the first definition of a key wins).
const localisation = buildLocalisationIndex({
  languages: [language],
  roots: [gameRoot],
  directories: [join(modRoot, 'localisation')],
  withValues: true,
});
const values = localisation.values;
say(`# Text overflow report`);
say();
say(`file:      ${guiPath}`);
say(`mod root:  ${modRoot}`);
say(`language:  l_${language}`);
say(`localisation: ${values.size} values in l_${language} (mod first, then the install)`);

const text = readTextFile(guiPath);
const library = sharedFontLibrary(gameRoot, language);

/**
 * Run the validator twice: once with the measured text extents in charge, once with the old
 * box-only behaviour. The difference IS the answer to "how many findings were box artefacts".
 */
const runValidate = (measureText) =>
  validateGuiText(text, guiPath, {
    assets: null,
    localisation,
    gameRoot,
    options: {
      measureText,
      language,
      checkAssets: false,
      checkContainerNames: false,
      checkCustomGuiContract: false,
    },
  });

const withText = runValidate(true);
const boxOnly = runValidate(false);
const wrapOff = validateGuiText(text, guiPath, {
  assets: null,
  localisation,
  gameRoot,
  options: {
    measureText: true,
    language,
    checkAssets: false,
    checkContainerNames: false,
    checkCustomGuiContract: false,
  },
});

const ruleCount = (report, rule) => report.byRule[rule] ?? 0;
const breakdown = withText.textMeasurement?.overlapBreakdown ?? {};

say();
say('## Finding counts: boxes vs measured text');
say();
say('| rule | with measured text | box-only (the old behaviour) |');
say('|---|---|---|');
const rules = [...new Set([...Object.keys(boxOnly.byRule), ...Object.keys(withText.byRule)])].sort();
for (const rule of rules) {
  say(`| ${rule} | ${ruleCount(withText, rule)} | ${ruleCount(boxOnly, rule)} |`);
}
say();
say(`box pairs that reached the overlap threshold:            ${breakdown.candidates ?? '-'}`);
say(`  ... of which BOTH sides had a measured string:         ${breakdown.textPairsMeasured ?? '-'}`);
say(`  ... suppressed because the measured ink does not reach: ${breakdown.suppressedByMeasurement ?? '-'}  <-- box artefacts`);
say(`  ... reported:                                           ${breakdown.reported ?? '-'}`);
say(`text-vs-text pairs whose measured ink really intersects:  ${breakdown.textPairsInkOverlapping ?? '-'}`);
say(`text collisions whose BOXES never overlapped (wrap-induced): ${breakdown.wrapInducedCollisions ?? '-'}`);
say();
say('## Wrapping on vs off');
say();
say(`measured text elements: ${withText.textMeasurement?.elements ?? 0}`);
say(`of those exact (engine descriptor): ${withText.textMeasurement?.exact ?? 0}; estimated: ${withText.textMeasurement?.estimated ?? 0}`);
say(`wrapped (more than one line):       ${withText.textMeasurement?.wrapped ?? 0}`);
say(`overflowing with wrapping modelled: ${withText.textMeasurement?.overflowing ?? 0}`);

// The same measurements with wrapping disabled, computed here because the option only exists on
// the measurement call (the validator always wraps, which is the engine's default).
const parsed = parseGuiText(text, guiPath);
const { boxes } = computeLayout(parsed.layout, {
  baseWidth: parsed.layout.baseResolution?.width ?? 1920,
  baseHeight: parsed.layout.baseResolution?.height ?? 1080,
  spriteLookup: makeSpriteLookup(null),
});
const measured = [];
const measuredNoWrap = [];
for (const box of boxes) {
  const key = box.node?.text ?? box.node?.buttonText ?? null;
  if (typeof key !== 'string' || key === '') continue;
  const context = { library, language, values, resolveLocalisation: (name) => values.get(name) ?? null };
  const withWrap = measureElementText(box, context);
  const withoutWrap = measureElementText(box, { ...context, wrap: false });
  // A zero-area element is how this mod HIDES a control; the validator skips it for the same
  // reason, and counting it here would make the two numbers disagree.
  if (box.rect.width <= 0 || box.rect.height <= 0) continue;
  if (withWrap.measured) measured.push(withWrap);
  if (withoutWrap.measured) measuredNoWrap.push(withoutWrap);
}
const overflowOf = (list) => list.filter((entry) => entry.overflows).length;
say(`overflowing WITHOUT wrapping (single line):        ${overflowOf(measuredNoWrap)}`);
say(`  ... horizontal only:                             ${measuredNoWrap.filter((e) => !e.fitsWidth).length}`);
say(`  ... vertical only (a single line too tall):      ${measuredNoWrap.filter((e) => e.fitsWidth && !e.fitsHeight).length}`);
say(`overflowing WITH wrapping modelled:                ${overflowOf(measured)}`);
say(`  ... horizontal only (a run with no break):       ${measured.filter((e) => !e.fitsWidth).length}`);
say(`  ... vertical only (the block grew too tall):     ${measured.filter((e) => e.fitsWidth && !e.fitsHeight).length}`);
const wrapOnly = measured.filter((entry) => entry.overflows);
const singleOnly = measuredNoWrap.filter((entry) => entry.overflows);
const wrapIntroduced = wrapOnly.filter((entry) => {
  const single = measuredNoWrap.find((other) => other.path === entry.path);
  return single && !single.overflows;
});
const wrapRemoved = singleOnly.filter((entry) => {
  const wrapped = measured.find((other) => other.path === entry.path);
  return wrapped && !wrapped.overflows;
});
say(`  ... introduced BY wrapping (fits on one line, but the wrapped block does not): ${wrapIntroduced.length}`);
say(`  ... removed BY wrapping (wider than maxWidth single-line, fits once wrapped):   ${wrapRemoved.length}`);
say();

// ------------------------------------------------------------------ measured collisions
//
// The collisions are taken from the VALIDATOR's own findings rather than recomputed here. The
// validator knows what a "window" is (a merged six-window file's titles overlap each other
// perfectly in file space and are never on screen together - `inSameWindow` in validate.mjs),
// and a second implementation of that rule in a report script would eventually disagree with it.
const collisionFindings = withText.findings.filter((finding) => finding.rule === 'text-collision');
say(`## Measured text collisions (window-scoped, from the validator): ${collisionFindings.length}`);
say();
const wrapInduced = collisionFindings.filter((finding) => finding.wrapInduced);
say(`  of those, BOXES never overlapped (one string spilled onto another element): ${wrapInduced.length}`);
say(`  of those, the boxes overlapped too (real ink-vs-ink):                      ${collisionFindings.length - wrapInduced.length}`);
say();
for (const finding of collisionFindings.slice(0, 30)) {
  const [left, right] = String(finding.path).split(' + ').map((path) => path.split('/').pop());
  say(
    `- \`${left}\` x \`${right}\`: ${finding.overlapArea} px^2` +
      (finding.wrapInduced ? ' (wrap/overflow induced - boxes do not intersect)' : ' (boxes intersect as well)'),
  );
}
if (collisionFindings.length > 30) say(`- ... ${collisionFindings.length - 30} more`);
say();

say('## Text overflow findings (from the validator)');
say();
for (const finding of withText.findings.filter((entry) => entry.rule === 'text-overflow')) {
  say(
    `- \`${finding.element ?? finding.path}\` [${finding.font}] measures ${finding.measuredWidth}x${finding.measuredHeight}px ` +
      `over ${finding.lineCount} line(s) in a ${finding.maxWidth}x${finding.maxHeight} box ` +
      `(${finding.textOverflow}; +${finding.overflowX}px wide, +${finding.overflowY}px tall)`,
  );
}
say();

// ------------------------------------------------------------------ per-element table
say('## Measured text extents (per element)');
say();
say('| element | font | method | text w x h | lines | maxW x maxH | ascent band | fits | overflow |');
say('|---|---|---|---|---|---|---|---|---|');
const interesting = elementFilter
  ? measured.filter((entry) => new RegExp(elementFilter, 'i').test(entry.name ?? entry.path))
  : measured;
for (const entry of interesting.slice(0, asJson ? 10000 : 400)) {
  say(
    `| \`${entry.name ?? entry.path}\` | ${entry.font} | ${entry.method}${entry.exact ? '' : ' (approx)'} | ` +
      `${entry.width} x ${entry.height} | ${entry.lineCount} | ${entry.maxWidth} x ${entry.maxHeight} | ` +
      `${entry.budgetHeight} | ${entry.fitsWidth && entry.fitsHeight ? 'yes' : 'NO'} | ` +
      `${entry.overflows ? `${entry.overflowX > 0 ? `+${Math.round(entry.overflowX)}px wide ` : ''}${entry.overflowY > 0 ? `+${Math.round(entry.overflowY)}px tall` : ''}` : '-'} |`,
  );
}
say();
say(`(${measured.length} measured elements; ${interesting.length} shown)`);
say();

// ------------------------------------------------------------------ the strings themselves
//
// A number a reader cannot check against the string that produced it is worth little, so the
// wrapped lines of the text elements the caller asked about are printed verbatim.
say('## The measured strings, line by line');
say();
for (const entry of interesting.slice(0, 60)) {
  say(
    `- \`${entry.name ?? entry.path}\` in \`${entry.font}\` (${entry.width}x${entry.height}, ` +
      `${entry.lineCount} line(s), box ${entry.maxWidth}x${entry.maxHeight}` +
      `${entry.overflows ? ', OVERFLOWS' : ''}):`,
  );
  for (const line of entry.lines) say(`    |${line.text}| ${line.width}px`);
  for (const note of entry.notes ?? []) say(`    note: ${note}`);
}
say();

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        guiPath,
        modRoot,
        gameRoot,
        language,
        ruleCounts: { measured: withText.byRule, boxOnly: boxOnly.byRule },
        textMeasurement: withText.textMeasurement,
        overflow: {
          withWrapping: overflowOf(measured),
          withoutWrapping: overflowOf(measuredNoWrap),
          introducedByWrapping: wrapIntroduced.map((entry) => entry.path),
          removedByWrapping: wrapRemoved.map((entry) => entry.path),
        },
        collisions: collisionFindings.map((finding) => ({
          path: finding.path,
          overlapArea: finding.overlapArea,
          wrapInduced: finding.wrapInduced,
          textMethod: finding.textMethod,
        })),
        overflowFindings: withText.findings
          .filter((finding) => finding.rule === 'text-overflow')
          .map((finding) => ({
            path: finding.path,
            element: finding.element,
            font: finding.font,
            text: finding.text,
            measuredWidth: finding.measuredWidth,
            measuredHeight: finding.measuredHeight,
            measuredBudgetHeight: finding.measuredBudgetHeight,
            lineCount: finding.lineCount,
            maxWidth: finding.maxWidth,
            maxHeight: finding.maxHeight,
            overflowX: finding.overflowX,
            overflowY: finding.overflowY,
            direction: finding.textOverflow,
          })),
        measurements: measured.map((entry) => ({
          path: entry.path,
          name: entry.name,
          font: entry.font,
          method: entry.method,
          exact: entry.exact,
          text: entry.text,
          width: entry.width,
          height: entry.height,
          budgetHeight: entry.budgetHeight,
          lineCount: entry.lineCount,
          lines: entry.lines,
          maxWidth: entry.maxWidth,
          maxHeight: entry.maxHeight,
          fitsWidth: entry.fitsWidth,
          fitsHeight: entry.fitsHeight,
          overflowX: entry.overflowX,
          overflowY: entry.overflowY,
          textRect: entry.textRect,
          notes: entry.notes,
        })),
      },
      null,
      2,
    )}\n`,
  );
} else {
  console.log(out.join('\n'));
}
