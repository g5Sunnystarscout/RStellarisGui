//------------------------------------------------------------------------------------
// tools/index.mjs -- Part of RStellarisGui
//
// The MCP tool registry. Every tool declares a full JSON schema, because an agent that cannot
// see a parameter guesses it, and every tool result states where any file was written, because
// the hard constraint on this project is that emitted files go to an explicit output directory
// and nowhere else.
//
// Tool names follow the sibling project's `verb_subject` convention with `gui` as the subject:
//
//   gui_assets_search        search the sprite index by name, size and kind
//   gui_assets_inventory     the IMAGE FILES under a path, and whether any .gfx registers each
//   gui_assets_sprite_info   one sprite's full metadata, with near-miss suggestions
//   gui_assets_defaults      the verified "part box" (5 sprites, 2 fonts)
//   gui_assets_refresh       force an asset-index rebuild and report build time and size
//   gui_layout_new           a new layout tree, optionally from a template
//   gui_layout_edit          apply add/remove/move/set/unset edits to a stored layout
//   gui_layout_add           append elements to a stored layout (the usual way to add a BAR)
//   gui_bar_spec             the canonical bar construction, its API and its rules, as data
//   gui_layout_import        parse an existing .gui file into a layout tree
//   gui_layout_get           read a stored layout tree back
//   gui_layout_validate      the geometry/loc/sprite/effect report
//   gui_layout_preview       SVG + PNG preview (can return an MCP image block)
//   gui_emit_files           write .gui / button_effects / event stub / localisation
//   gui_check_files          inspect files this tool did not write (incl. the custom_gui contract)
//   gui_log_scan             the engine's own log: which option was selected, and what it complained about
//   gui_web_ui_start         start the local drag-and-drop page
//   gui_web_ui_stop          stop it
//   gui_web_ui_status        report its URL and state
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { buildAssetIndex, defaultParts, getAssetIndex, searchSprites, spriteInfo } from '../lib/asset-index.mjs';
import { inventoryImageFiles } from '../lib/asset-files.mjs';
import { applyToFile, assertHandoffRoot, assertOutputRoot, emitFiles, emitOverride, inspectEncoding, planOverride } from '../lib/emit.mjs';
import { analyseOverrideDrift } from '../lib/override-drift.mjs';
import { extractEvents } from '../lib/events.mjs';
import { checkFiles } from '../lib/filecheck.mjs';
import {
  GUARD_DESCRIPTIONS,
  PROTECTED_NAMES,
  describeViolationDelta,
  evaluateEdits,
  guardedEdit,
  protectionList,
  scanContractViolations,
} from '../lib/handoff-guard.mjs';
import { HANDOFF_ROOT, handoffStats, listHandoffs, loadHandoff, loadHandoffLayout, markPicked, pendingHandoffs, submitHandoff } from '../lib/handoff.mjs';
import { diffLayouts, formatDiffMarkdown, summariseDiff } from '../lib/layout-diff.mjs';
import { applyEdits, computeLayout, defaultLayout, findNode, makeSpriteLookup, mergeLayouts, normaliseLayoutForKinds, parseGuiText, topLevelContainers, walkLayout, BASE_RESOLUTION } from '../lib/layout.mjs';
import {
  BAR_CONSTRUCTION,
  BAR_DEFAULTS,
  BAR_FIELD_HELP,
  BAR_SPRITE_PALETTE,
  COMPONENT_RULE_DESCRIPTIONS,
  COMPONENT_RULE_SEVERITY,
  MATRIX_DEFAULTS,
  MATRIX_RULE_DESCRIPTIONS,
  MATRIX_RULE_SEVERITY,
  REFERENCE_BAND_ELEMENTS,
  collectBars,
  describeMatrix,
  matrixCellBox,
  referenceOffsets,
} from '../lib/components.mjs';
import { CANONICAL_SYSTEM_SENTENCE } from '../lib/coords.mjs';
import { KNOWLEDGE_URI_SCHEME, topicToMarkdown } from '../lib/knowledge.mjs';
import { buildLocalisationIndex, describeLocalisationIndex } from '../lib/loc-index.mjs';
import { scanEngineLogs } from '../lib/logscan.mjs';
import { ToolError, requireObject, requireString } from '../lib/mcp.mjs';
import { topLevelKeys } from '../lib/paradox.mjs';
import {
  DEFAULT_GAME_ROOT,
  GAME_ROOT_ENV,
  TARGET_VERSION,
  cacheRoot,
  defaultDocumentsRoot,
  defaultOutputRoot,
  ensureDir,
  listFilesRecursive,
  readTextFile,
  resolveGameRoot,
} from '../lib/paths.mjs';
import { renderPng, renderSvg, rectTableCsv, rectTableMarkdown, ThumbnailCache, writePreview } from '../lib/preview.mjs';
import { checkGuiSyntax } from '../lib/syntax.mjs';
import { validateGuiText, validateLayout } from '../lib/validate.mjs';
import { startWebUi } from '../lib/web.mjs';

const string = (description) => ({ type: 'string', description });
const boolean = (description) => ({ type: 'boolean', description });
const number = (description) => ({ type: 'number', description });
const integer = (description, minimum, maximum) => ({
  type: 'integer',
  description,
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {}),
});
const array = (description, items) => ({ type: 'array', description, items });
const strings = (description) => array(description, { type: 'string' });
const object = (description) => ({ type: 'object', description, additionalProperties: true });

const GAME_ROOT = {
  game_root: string(
    'Optional absolute path of the Stellaris install. When omitted, STELLARIS_GAME_ROOT is used, then a search of '
      + 'the usual install locations. launcher-settings.json is read and a build whose version is not '
      + `${TARGET_VERSION}.x is refused rather than answered from, because a different version has different field `
      + 'names and every constant here was measured against this one.',
  ),
};

/** Extra asset roots: a mod ships its own `interface/*.gfx`, and without its root every one of
 * those sprites is reported `unknown-sprite` and drawn as a placeholder. */
const EXTRA_ROOTS = {
  extra_roots: strings(
    'Extra asset roots to index alongside the install, in precedence order after it - normally the mod folder. ' +
      'Its interface/**/*.gfx (sprites, fonts), common/button_effects/*.txt and interface/**/*.gui ' +
      '(containerWindowType names) are all merged into the index.',
  ),
};

const ENGLISH = ['english'];

const LAYOUT_ARGUMENTS = {
  layout: object(
    'A layout tree (schema rstellarisgui/layout@1): {name, baseResolution, variables, root, effects, ' +
      'localisation, event}. Pass this to work statelessly; otherwise pass layout_id to use a stored one. ' +
      CANONICAL_SYSTEM_SENTENCE,
  ),
  layout_id: string('Id of a layout previously created by gui_layout_new or gui_layout_import.'),
};

/**
 * `{path, name, kind, parentPath, parentName, depth}` for every element of a layout, in document
 * order.
 *
 * Why this exists: a patcher that rewrites a file's text can produce something that still parses,
 * still validates and still contains every element, while having moved one of them into a different
 * container. That is invisible to every geometric check, because the element keeps its declared
 * position and is simply measured against a different parent. Comparing this list between two
 * revisions makes the move a one-line diff.
 */
function elementParentPaths(layout) {
  const rows = [];
  const visit = (node, parentPath, parentName, depth) => {
    const path = parentPath ? `${parentPath}/${node.name ?? node.id ?? '?'}` : node.name ?? 'root';
    rows.push({
      path,
      name: node.name ?? null,
      kind: node.kind ?? null,
      parentPath: parentPath ?? null,
      parentName: parentName ?? null,
      depth,
    });
    for (const child of node.children ?? []) visit(child, path, node.name ?? node.id ?? null, depth + 1);
  };
  for (const root of topLevelContainers(layout)) visit(root, null, layout.root?.syntheticRoot ? layout.root.name ?? null : null, 1);
  return rows;
}

/**
 * Compare two `elementParentPaths` lists by element path, reporting every element whose PARENT
 * changed, plus the added/removed sets. Elements are matched by their full path (`a/b/c`), because
 * that is what the rect table and the validator use.
 */
function compareParentPaths(before, after) {
  const beforeByPath = new Map(before.map((row) => [row.path, row]));
  const afterByPath = new Map(after.map((row) => [row.path, row]));
  const movedParent = [];
  for (const [path, row] of afterByPath) {
    const previous = beforeByPath.get(path);
    if (!previous || previous.parentPath === row.parentPath) continue;
    movedParent.push({ path, from: previous.parentPath, to: row.parentPath });
  }
  const added = [...afterByPath.keys()].filter((path) => !beforeByPath.has(path));
  const removed = [...beforeByPath.keys()].filter((path) => !afterByPath.has(path));
  return {
    movedParent,
    added,
    removed,
    unchanged: movedParent.length === 0 && added.length === 0 && removed.length === 0,
    verdict:
      movedParent.length > 0
        ? `${movedParent.length} element(s) changed parent. A parent change is invisible to every geometric check: diff the paths above.`
        : 'no element changed parent',
  };
}

/** Resolve the layout a tool should operate on, or throw a ToolError. */
function resolveLayout(args, context) {
  if (args.layout) return { layout: args.layout, id: args.layout_id ?? null, stored: false };
  const id = args.layout_id ?? context.lastLayoutId;
  if (!id) {
    throw new ToolError(
      'no layout given: pass `layout` (a tree) or `layout_id` (after gui_layout_new). ' +
        'Call gui_layout_new first to get a starting tree.',
    );
  }
  const entry = context.layouts.get(id);
  if (!entry) {
    throw new ToolError(`unknown layout_id \`${id}\`; known ids: ${[...context.layouts.keys()].join(', ') || '(none)'}`);
  }
  context.lastLayoutId = id;
  return { layout: entry.layout, id, stored: true };
}

/** Load assets, honouring `refresh` and any extra roots (a mod's own `interface/*.gfx`). */
function assets(context, args = {}) {
  return getAssetIndex({
    root: args.game_root ?? context.gameRoot,
    extraRoots: args.extra_roots ?? args.extraRoots ?? [],
    refresh: Boolean(args.refresh),
  });
}

/**
 * Load the localisation keyset, which is slow, so it is opt-in and cached.
 *
 * `localisation_root` (singular) and `localisation_roots` (plural) both work; several roots are
 * the normal case, because a mod's keys and the install's keys both matter. `with_values` also
 * keeps the resolved strings, which is what lets the preview draw real text (B9) AND what lets
 * the validator MEASURE it (the rendered width/height of a string is only knowable once the
 * string is known).
 */
function localisation(context, args, extraWithValues = false) {
  if (args.check_localisation === false && args.render_localisation !== true) return context.localisation;
  const directories = [...(args.localisation_roots ?? []), ...(args.localisation_root ? [args.localisation_root] : [])];
  const withValues = extraWithValues || args.render_localisation === true || args.with_loc_values === true;
  const cacheKey = `${directories.join('|')}|${(args.languages ?? ['english']).join(',')}|${withValues}`;
  if (context.localisation && context.localisation.cacheKey === cacheKey) return context.localisation;
  const index = buildLocalisationIndex({
    languages: args.languages ?? ['english'],
    roots: [args.game_root ?? context.gameRoot],
    directories,
    withValues,
  });
  index.cacheKey = cacheKey;
  context.localisation = index;
  return index;
}

/** Extra button-effect keysets: a mod's common/button_effects/*.txt files. */
function buttonEffectsFrom(context, args) {
  const roots = [...(args.button_effects_roots ?? []), ...(args.button_effects_root ? [args.button_effects_root] : [])];
  const keys = new Set();
  const sources = [];
  for (const root of roots) {
    // Accept either the `common/button_effects` folder itself or a file inside it.
    const directories = [root];
    if (/\.txt$/i.test(root)) directories[0] = dirname(root);
    for (const file of listFilesRecursive(directories[0], ['.txt'])) {
      sources.push(file);
      for (const entry of topLevelKeys(readTextFile(file))) keys.add(entry.key);
    }
  }
  return { keys, sources, roots };
}

/** Build the validation context and run the report. */
function runValidation(context, layout, args, { text, fileKey, customGuiWindows } = {}) {
  const wantAssets = args.check_assets !== false;
  const index = wantAssets ? assets(context, args) : null;
  // Measuring the RENDERED text extent needs the resolved strings, so the values are loaded for
  // a validate call (not just for a preview). The measurement language follows the localisation
  // language the caller asked for, because the same font name is a bitmap font in English and a
  // TTF in Simplified Chinese (interface/fonts.gfx) - measuring Chinese text with the English
  // font's advances would be wrong by a wide margin.
  const measureText = args.measure_text !== false;
  const locIndex = localisation(context, args, measureText);
  const languages = args.languages ?? ENGLISH;
  const language = languages[0] ?? 'english';
  const extra = buttonEffectsFrom(context, args);
  // The keyset survives: an earlier revision built a fresh context holding only
  // `{assets, localisation, options}` and silently dropped `context.buttonEffects`, so a driver
  // that injected the mod's keys still got `effect-unresolved` for every one of them.
  const inherited = [];
  if (context.buttonEffects) inherited.push(context.buttonEffects);
  if (extra.keys.size > 0) inherited.push(extra.keys);
  const options = {
    ...(args.overlap_tolerance !== undefined ? { overlapTolerance: args.overlap_tolerance } : {}),
    ...(args.overlap_area_ratio !== undefined ? { overlapAreaRatio: args.overlap_area_ratio } : {}),
    ...(args.flag_transparent_overlaps !== undefined ? { flagTransparentOverlaps: args.flag_transparent_overlaps } : {}),
    ...(args.check_localisation !== undefined ? { checkLocalisation: args.check_localisation } : {}),
    ...(args.allow_offscreen_animated !== undefined ? { allowOffscreenAnimated: args.allow_offscreen_animated } : {}),
    ...(args.check_container_names !== undefined ? { checkContainerNames: args.check_container_names } : {}),
    ...(args.check_custom_gui_contract !== undefined ? { checkCustomGuiContract: args.check_custom_gui_contract } : {}),
    ...(args.check_all_windows !== undefined ? { checkAllWindows: args.check_all_windows } : {}),
    ...(args.check_visibility !== undefined ? { checkVisibility: args.check_visibility } : {}),
    ...(args.park_margin !== undefined ? { parkMargin: args.park_margin } : {}),
    measureText,
    language,
    ...(customGuiWindows && customGuiWindows.length > 0 ? { customGuiWindows } : {}),
  };
  const validationContext = {
    assets: index,
    localisation: locIndex,
    options,
    // The install root, so the validator can find the engine's own font descriptors and measure
    // the rendered text (`text-overflow`, `text-collision`, and the measured `sibling-overlap`).
    gameRoot: args.game_root ?? context.gameRoot,
    extraButtonEffects: inherited,
    extraButtonEffectRoots: extra.roots,
    // GAP-12: the `common/button_effects/*.txt` FILES (not just their keys) so the visibility table
    // can read each entry's `potential`. The index already collected their absolute paths; the
    // caller-supplied roots are read here because they may not be in the asset index.
    buttonEffectFiles: extra.sources,
    buttonEffectRoots: extra.roots,
    ...(args.visibility_scope_guarantees ? { visibilityScopeGuarantees: args.visibility_scope_guarantees } : {}),
    sourceFiles: fileKey ? [fileKey] : args.path ? [args.path] : undefined,
  };
  if (text !== undefined) {
    return validateGuiText(text, fileKey, { ...validationContext, rootKeyword: args.root_keyword });
  }
  return validateLayout(layout, validationContext);
}

/**
 * Which windows are real `custom_gui` windows?
 *
 * This is the input that decides whether a missing contract element is an ERROR (the mod's own
 * event opens this window, so a missing element is the crash class) or a WARNING (a window the
 * checker merely inferred - a shipped vanilla file must never be reported as broken).
 *
 * The names are read from the events, because that is where `custom_gui` is written:
 *   * every `*.txt` the caller passed;
 *   * the sibling `events/` folder of the file being validated, when there is one;
 *   * `<extra_root>/events/` for each `extra_roots` entry (a mod folder).
 *
 * The result records where each name came from, so the report is falsifiable.
 */
function discoverCustomGuiWindows({ fileKey, explicit = [], roots = [] } = {}) {
  const names = new Set(explicit);
  const sources = [];
  for (const name of explicit) sources.push({ name, from: 'argument' });

  const directories = new Set();
  if (fileKey && isAbsolute(fileKey)) directories.add(join(dirname(fileKey), 'events'));
  for (const root of roots) {
    if (!root) continue;
    directories.add(join(root, 'events'));
    directories.add(root);
  }
  for (const directory of directories) {
    for (const file of listFilesRecursive(directory, ['.txt'])) {
      let text;
      try {
        text = readTextFile(file);
      } catch {
        continue;
      }
      if (!/custom_gui\s*=/.test(text)) continue;
      for (const event of extractEvents(text)) {
        for (const [name, kind] of [
          [event.customGui, 'custom_gui'],
          [event.customGuiOption, 'custom_gui_option'],
        ]) {
          if (!name || names.has(name)) continue;
          names.add(name);
          sources.push({ name, from: `${file} (${kind})` });
        }
        for (const option of event.options ?? []) {
          const rowGui = (option.children ?? []).find((child) => child.key && child.key.toLowerCase() === 'custom_gui');
          const rowName = rowGui?.value ? String(rowGui.value).replace(/^"|"$/g, '') : null;
          if (!rowName || names.has(rowName)) continue;
          names.add(rowName);
          sources.push({ name: rowName, from: `${file} (an option's custom_gui)` });
        }
      }
    }
  }
  return { names: [...names], sources };
}

/** Summarise a validation report for a tool result, keeping every finding. */
function summariseReport(report) {
  return {
    verdict: report.verdict,
    ok: report.ok,
    baseResolution: report.baseResolution,
    geometryAssumption: report.geometryAssumption,
    counts: report.counts,
    byRule: report.byRule,
    assetsChecked: report.assetsChecked,
    localisationChecked: report.localisationChecked,
    buttonEffectsChecked: report.buttonEffectsChecked,
    containerNamesChecked: report.containerNamesChecked,
    extraButtonEffectRoots: report.extraButtonEffectRoots ?? [],
    // Whether the overlap/overflow rules ran against MEASURED text or against boxes, and how
    // exact that measurement was. Without this a caller cannot tell a clean report from one that
    // simply could not measure anything - the failure mode that lets a text defect survive a
    // green verdict (`src/lib/font-metrics.mjs`, `textMeasurement` in validate.mjs).
    textMeasured: report.textMeasured ?? false,
    ...(report.textMeasurement ? { textMeasurement: report.textMeasurement } : {}),
    ...(report.syntax ? { syntax: report.syntax } : {}),
    // GAP-11: what the geometry rules found, split into what can and cannot be deliberate. A caller
    // reading only `byRule['out-of-bounds']` cannot tell a clean file from one whose entire count is
    // the `-3000,-3000` park idiom, which is the ambiguity that made the count meaningless.
    ...(report.geometry ? { geometry: report.geometry } : {}),
    // GAP-12: the per-element `effect` -> `potential` table, and which windows' entry scopes were
    // established. Carried on EVERY report (not only when a finding fired), because a condition that
    // is true on one route into a window and false on another cannot be shown by findings alone.
    ...(report.visibility ? { visibility: report.visibility } : {}),
    findings: report.findings.map((finding) => ({
      rule: finding.rule,
      severity: finding.severity,
      where: finding.where ?? null,
      path: finding.path ?? null,
      element: finding.element ?? null,
      kind: finding.kind ?? null,
      message: finding.message,
      suggestedFix: finding.suggestedFix ?? null,
      ...(finding.engineMessage ? { engineMessage: finding.engineMessage } : {}),
      ...(finding.collidesWith ? { collidesWith: finding.collidesWith } : {}),
      ...(finding.key ? { key: finding.key } : {}),
      ...(finding.rect ? { rect: roundRect(finding.rect) } : {}),
      ...(finding.otherRect ? { otherRect: roundRect(finding.otherRect) } : {}),
      // The measured text extent, when the rule was `text-overflow` / `text-collision` / a
      // `sibling-overlap` that was decided by ink rather than by boxes.
      ...(finding.measuredWidth !== undefined
        ? {
            measuredWidth: finding.measuredWidth,
            measuredHeight: finding.measuredHeight,
            measuredBudgetHeight: finding.measuredBudgetHeight,
            lineCount: finding.lineCount,
            maxWidth: finding.maxWidth ?? null,
            maxHeight: finding.maxHeight ?? null,
            textMethod: finding.textMethod,
            textExact: finding.textExact,
            textOverflow: finding.textOverflow,
            overflowX: finding.overflowX,
            overflowY: finding.overflowY,
            font: finding.font,
          }
        : {}),
      // GAP-5: the live tokens that made a `text-live-value` a measurement rather than ink, and the
      // string they sit in. Without these the finding cannot be audited against the localisation file.
      ...(finding.liveTokens ? { liveTokens: finding.liveTokens } : {}),
      ...(finding.text !== undefined && finding.text !== null ? { text: finding.text } : {}),
      ...(finding.textRect ? { textRect: roundRect(finding.textRect) } : {}),
      ...(finding.otherTextRect ? { otherTextRect: roundRect(finding.otherTextRect) } : {}),
      ...(finding.overlapArea !== undefined ? { overlapArea: finding.overlapArea } : {}),
      ...(finding.wrapInduced !== undefined ? { wrapInduced: finding.wrapInduced } : {}),
      ...(finding.measured !== undefined ? { measured: finding.measured, inkArea: finding.inkArea } : {}),
      // GAP-11: how far outside the root an `out-of-bounds` finding really is, and whether the
      // classification called it a park. A reader needs both numbers to judge the split.
      ...(finding.distance !== undefined
        ? { distance: finding.distance, parked: finding.parked === true, parkMargin: finding.parkMargin ?? null }
        : {}),
      // GAP-12: what the visibility rule read outside the .gui - the effect's own case, the
      // `potential` block and where it lives, and the scope the caller guaranteed for the window.
      ...(finding.effect !== undefined
        ? {
            window: finding.window ?? null,
            effect: finding.effect,
            potential: finding.potential ?? null,
            potentialAt: finding.potentialAt ?? null,
            demandedScope: finding.demandedScope ?? [],
            scopeGuarantee: finding.scopeGuarantee ?? null,
          }
        : {}),
    })),
  };
}

function roundRect(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/**
 * THE IMPORT REGISTRY: `<lowercased path with / separators>` -> the tree as IMPORTED.
 *
 * Why this is not just `context.layouts`: a layout is stored under ONE id and every edit
 * REWRITES that entry, so after `gui_layout_edit` the stored tree is the edited one and the
 * tree the file was imported as is gone. The apply path needs that second tree - it is the
 * comparison base - and re-reading it from the file is not an option once the file on disk may
 * be the previous run's output. So the pristine import is recorded here, keyed by the path it
 * came from, and it is deliberately NEVER updated by an edit.
 */
const importedBaselines = new Map();

/** The tree a path was imported as, or null. */
function baselineForPath(path) {
  const key = String(path ?? '').replace(/\\/g, '/').toLowerCase();
  if (key === '') return null;
  return importedBaselines.get(key) ?? null;
}

/**
 * The `gui_emit_files { apply_to }` path: patch the file the layout was imported from.
 *
 * Why it needs a BASELINE, and where the baseline comes from. The operation is a diff
 * against the tree as it was IMPORTED - "which elements did the edit add, change or remove" -
 * and this process cannot re-read that tree from the file with confidence once the file on
 * disk may be the previous run's patched output. So the candidates are, in order:
 *
 *   1. `baseline_layout_id`, when the caller names one;
 *   2. the tree recorded for this path at import time (`importedBaselines`);
 *   3. the tree a stored layout remembers as its previous revision (the page and
 *      `gui_handoff_pick` both record one), which is the layout the file was imported as;
 *   4. any stored layout whose recorded source file is this path (`canonicalisedFrom`).
 *
 * The chosen baseline must define the SAME WINDOW NAMES as the edited tree, or the diff would
 * be against an unrelated file; that is checked rather than assumed. When no baseline can be
 * found the call REFUSES, because a patch without a baseline is a full rewrite wearing a
 * patch's name - which is the defect this path exists to fix.
 *
 * SUBSUMPTION, NOT EQUALITY (GAP-4). The exact window-name list cannot be the rule, because an
 * edit that ADDS a top-level window changes that list BY CONSTRUCTION - so the one edit a
 * multi-window `.gui` most needs was the one the guard refused. The property the exact-match
 * rule is a PROXY for is "every window this file had is still in the edited tree", i.e. the
 * baseline's window set is a SUBSET of the edited one; a window the baseline has and the edit
 * does not is a rename or a different file, and that is still refused. Equality stays as the
 * first choice so an edit-free apply is unaffected, and the relaxed choice is reported in
 * `baseline_note` so a caller can see which rule selected the baseline.
 */
function applyToExistingFile(args, context, layouts, id) {
  if (layouts.length !== 1) {
    throw new ToolError('`apply_to` patches ONE file from ONE layout; pass a single `layout_id` (not `layout_ids`)');
  }
  const layout = layouts[0];
  const target = String(args.apply_to);
  const key = target.replace(/\\/g, '/').toLowerCase();
  const candidates = [];
  if (args.baseline_layout_id) {
    const entry = context.layouts.get(args.baseline_layout_id);
    if (!entry) throw new ToolError(`unknown baseline_layout_id \`${args.baseline_layout_id}\``);
    candidates.push({ from: `baseline_layout_id ${args.baseline_layout_id}`, layout: entry.layout });
  }
  const recorded = importedBaselines.get(key);
  if (recorded) candidates.push({ from: 'the tree recorded when this path was imported (gui_layout_import)', layout: recorded });
  const remembered = context.previousRevisions?.get(id ?? '');
  if (remembered?.layout) candidates.push({ from: `${remembered.id ?? 'the previous revision'} (${remembered.source ?? 'recorded baseline'})`, layout: remembered.layout });
  for (const [candidateId, entry] of context.layouts) {
    if (entry.layout === layout) continue;
    const source = String(entry.layout?.canonicalisedFrom ?? '').replace(/\\/g, '/').toLowerCase();
    if (source === key) candidates.push({ from: `layout \`${candidateId}\` (imported from this file)`, layout: entry.layout });
  }

  const windowNames = (tree) => topLevelContainers(tree).map((node) => node.name ?? null).join(',');
  const windowSet = (tree) => new Set(topLevelContainers(tree).map((node) => node.name ?? null).filter(Boolean));
  const wanted = windowNames(layout);
  const wantedSet = windowSet(layout);
  let baseline = candidates.find((candidate) => windowNames(candidate.layout) === wanted) ?? null;
  let baselineNote = null;
  if (!baseline) {
    // A SUPERSET baseline: every window it declares survives in the edited tree. The added windows
    // are the difference, and they are named so the report cannot be read as "the baseline matched".
    const subsuming = candidates.find((candidate) => {
      const have = windowSet(candidate.layout);
      if (have.size === 0) return false;
      for (const name of have) if (!wantedSet.has(name)) return false;
      return true;
    });
    if (subsuming) {
      const have = windowSet(subsuming.layout);
      const addedWindows = [...wantedSet].filter((name) => !have.has(name));
      baseline = subsuming;
      baselineNote =
        `GAP-4: the baseline \`${subsuming.from}\` declares ${have.size} window(s) and the edited tree declares ` +
        `${wantedSet.size}; every baseline window survives, so the edit ADDS ${addedWindows.length} top-level ` +
        `window(s) (${addedWindows.join(', ')}) and the baseline was selected by SUBSUMPTION rather than equality.`;
    }
  }
  if (!baseline) {
    throw new ToolError(
      `no baseline was found for \`${target}\`, so an apply cannot tell an edit from the file's own content. Re-import the file ` +
        'with gui_layout_import and edit THAT layout, or pass `baseline_layout_id`. Candidates seen: ' +
        (candidates.length === 0
          ? '(none - nothing in this process was imported from that path)'
          : candidates.map((candidate) => `${candidate.from} [windows: ${windowNames(candidate.layout) || 'none'}]`).join('; ')),
    );
  }

  const dryRun = args.apply_dry_run === true;
  let report;
  try {
    report = applyToFile(target, baseline.layout, layout, { dryRun });
  } catch (thrown) {
    throw new ToolError(thrown instanceof Error ? thrown.message : String(thrown));
  }
  return {
    ok: true,
    mode: 'apply',
    layout_id: id,
    apply_to: report.targetPath,
    baseline_from: baseline.from,
    ...(baselineNote ? { baseline_note: baselineNote } : {}),
    dry_run: report.dryRun,
    written: report.written,
    before: report.before,
    after: report.after,
    byteIdentical: report.identical,
    commentLines: { before: report.before.commentLines, after: report.after.commentLines },
    elements: {
      occurrenceCount: report.occurrences,
      added: report.added,
      removed: report.removed,
      changed: report.changed,
      rewrittenLines: report.rewrittenLines,
      rewrittenBytes: report.rewrittenBytes,
    },
    diffLineCount: report.diff,
    syntaxCheck: report.syntaxCheck,
    warnings: report.warnings,
    ...(dryRun ? { patched: report.patched } : {}),
    note: dryRun
      ? `Dry run: nothing was written. ${report.identical ? 'The layout is UNCHANGED, so the apply reproduces the file byte for byte.' : `${report.changed.length} element(s) changed; repeat with apply_dry_run = false to write.`}`
      : report.identical
        ? `${report.targetPath} was rewritten with BYTE-IDENTICAL content (the layout had no edits), which is the round-trip gate on the real file.`
        : `Patched ${report.targetPath} in place: ${report.changed.length} element(s) rewritten, ${report.added.length} added, ${report.removed.length} removed. Every untouched line, comment included, is byte-identical.`,
  };
}

function applyToFileImpl(path, baselineLayout, editedLayout, options) {
  return applyToFile(path, baselineLayout, editedLayout, options);
}

function summariseLayout(layout, id) {
  const elements = [];
  walkLayout(layout.root, (node, parent, depth, path) => {
    elements.push({
      path,
      id: node.id ?? null,
      name: node.name ?? null,
      kind: node.kind ?? null,
      depth,
      parent: parent?.name ?? parent?.id ?? null,
      hasChildren: Boolean(node.children?.length),
    });
  });
  return {
    layout_id: id,
    name: layout.name,
    baseResolution: layout.baseResolution ?? BASE_RESOLUTION,
    elementCount: elements.length,
    variables: layout.variables ?? {},
    effects: Object.keys(layout.effects ?? {}),
    root: layout.root?.name ?? null,
    syntheticRoot: Boolean(layout.root?.syntheticRoot),
    windows: topLevelContainers(layout).map((node) => node.name ?? null),
    elements,
  };
}

export const TOOL_SPECS = [
  // ------------------------------------------------------------------- assets
  {
    name: 'gui_assets_search',
    description:
      'Search the Stellaris sprite index (built from interface/**/*.gfx) by name substring, kind and size range. ' +
      'Returns real DDS/PNG dimensions read from the texture headers, not the declared .gfx size. Use this to pick ' +
      'a sprite before writing `spriteType` / `quadTextureSprite`, instead of guessing a name.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        ...EXTRA_ROOTS,
        query: string('Name substring, e.g. "button_close" or "tile_large". Case-insensitive.'),
        kind: string('Optional defining block kind, e.g. spriteType, corneredTileSpriteType, progressBarType.'),
        min_width: integer('Only sprites at least this wide.', 0),
        max_width: integer('Only sprites at most this wide.', 0),
        min_height: integer('Only sprites at least this tall.', 0),
        max_height: integer('Only sprites at most this tall.', 0),
        has_texture: boolean('true = only sprites with a texture, false = only those without.'),
        limit: integer('Maximum results (1-200, default 30).', 1, 200),
        refresh: boolean('Force an asset-index rebuild instead of using the cache.'),
      },
    },
    handler: (args, context) => {
      const index = assets(context, args);
      const results = searchSprites(index, {
        query: args.query,
        kind: args.kind,
        minWidth: args.min_width,
        maxWidth: args.max_width,
        minHeight: args.min_height,
        maxHeight: args.max_height,
        hasTexture: args.has_texture,
        limit: args.limit ?? 30,
      });
      return {
        query: args.query ?? '(all)',
        resultCount: results.length,
        index: {
          root: index.root,
          roots: index.roots ?? [index.root],
          rootCount: (index.roots ?? [index.root]).length,
          version: index.version,
          spriteCount: index.stats.spriteCount,
          containerCount: index.stats.containerCount,
          fromCache: Boolean(index.fromCache),
        },
        results,
        note:
          'Every sprite here is a real name from the install. `width`/`height` come from the texture header, so a ' +
          '`spriteType` (fixed size) will draw at exactly that size.',
      };
    },
  },
  {
    name: 'gui_assets_sprite_info',
    description:
      "Full metadata for one sprite: defining block kind, texture path, real pixel size, format, mip count and the " +
      'file:line that defines it. Returns near-miss suggestions when the name is wrong, so a typo is recoverable.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        ...EXTRA_ROOTS,
        name: string('Exact sprite name, e.g. GFX_tile_large_bg. Case-sensitive.'),
        refresh: boolean('Force an asset-index rebuild.'),
      },
      required: ['name'],
    },
    handler: (args, context) => {
      const name = requireString(args, 'name');
      const index = assets(context, args);
      const info = spriteInfo(index, name);
      const hint = info.found
        ? String(index.sprites[name].kind).toLowerCase() === 'spritetype'
          ? 'This is a fixed-size spriteType: it draws at its natural size, so do not give it a different `size`.'
          : 'This is a resizable sprite kind (e.g. corneredTileSpriteType), so `size` on the element is honoured.'
        : 'No such sprite. Do not emit this name; pick one of the suggestions or search with gui_assets_search.';
      return { ...info, hint };
    },
  },
  {
    name: 'gui_assets_inventory',
    description:
      'Inventory the IMAGE FILES under a path and say whether any .gfx registers each one. The sprite index answers ' +
      '"what sprites exist"; this answers "what files are there, and is each one reachable" -- which is the half that ' +
      'fails SILENTLY, because a texture no .gfx registers is invisible to the engine with no error and no log line. ' +
      'Reports real dimensions read from each file header, the sprites that reference it, and a pasteable spriteType ' +
      'block for the ones nothing registers. Use it after adding art to a mod, before wondering why a sprite is blank.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        ...EXTRA_ROOTS,
        dirs: strings(
          'Directories to scan: a mod root, or any subtree of one (e.g. gfx/interface/mymod). Defaults to ' +
            'extra_roots, so passing the mod as extra_roots needs no dirs.',
        ),
        filter: {
          type: 'string',
          enum: ['all', 'registered', 'unregistered', 'unreadable'],
          description: 'Which files to return. Defaults to all; the stats always cover every scanned file.',
        },
        suggest: boolean('Include a pasteable spriteType block for each unregistered, readable file.'),
        refresh: boolean('Force an asset-index rebuild.'),
        limit: integer('Maximum files to walk (default 200000).', 1),
      },
    },
    handler: (args, context) => {
      const index = assets(context, args);
      const extra = args.extra_roots ?? args.extraRoots ?? [];
      const dirs = (Array.isArray(args.dirs) && args.dirs.length ? args.dirs : extra).map(String);
      if (!dirs.length) {
        throw new Error('pass `dirs` (a mod root or an image directory), or pass the mod as `extra_roots`');
      }
      // Relative paths are reported against the mod root so a suggestion is
      // pasteable into a .gfx. A directory holding interface/ or gfx/ IS a mod root.
      const resolvedDirs = dirs.map((d) => resolve(d));
      const modRoot = resolvedDirs.find((d) => existsSync(join(d, 'interface')) || existsSync(join(d, 'gfx')))
        ?? resolvedDirs.find((d) => existsSync(d))
        ?? resolvedDirs[0];
      const result = inventoryImageFiles({
        dirs: resolvedDirs,
        index,
        modRoot,
        filter: args.filter,
        suggest: Boolean(args.suggest),
        limit: args.limit,
      });
      return {
        ...result,
        modRoot,
        note:
          'Registration is measured against interface/**/*.gfx only. A texture mounted through gfx/portraits, '
          + 'gfx/models or an existing .gui is used by the engine but reads as unregistered here.',
      };
    },
  },
  {
    name: 'gui_assets_defaults',
    description:
      'The verified "part box" for new Stellaris 4.4.6 UI: five default sprites and two default fonts, with their real ' +
      'sizes. Use these as the starting palette so a layout is buildable and looks native.',
    inputSchema: { type: 'object', properties: { ...GAME_ROOT, ...EXTRA_ROOTS, refresh: boolean('Force a rebuild.') } },
    handler: (args, context) => {
      const index = assets(context, args);
      return { ...defaultParts(index), indexRoot: index.root, version: index.version };
    },
  },
  {
    name: 'gui_assets_refresh',
    description:
      'Rebuild the asset index from the install and report build time, per-stage timings, index size and the ' +
      'texture-format census. Optionally run the deep census, which reads the header of every one of the ~21k .dds ' +
      'files in gfx/ and is ~20x slower.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        ...EXTRA_ROOTS,
        deep_texture_census: boolean('Also read every .dds header under gfx/ (slow; report only).'),
      },
    },
    handler: (args, context) => {
      const started = Date.now();
      const index = buildAssetIndex({
        root: args.game_root ?? context.gameRoot,
        deepTextureCensus: Boolean(args.deep_texture_census),
      });
      context.assetIndex = index;
      return {
        root: index.root,
        version: index.version,
        wallMs: Date.now() - started,
        indexBytes: index.stats.indexBytes,
        cachePath: index.cachePath ?? null,
        stats: index.stats,
        ...(index.deepCensus ? { deepCensus: index.deepCensus } : {}),
      };
    },
  },

  // ------------------------------------------------------------------- layouts
  {
    name: 'gui_layout_new',
    description:
      'Create a new layout tree and store it under a layout_id for later tools. The default tree is a complete, ' +
      'validating custom window (background, heading, body text, close button, effect button) that you can edit. ' +
      'Every coordinate is in the 1920x1080 base resolution.',
    inputSchema: {
      type: 'object',
      properties: {
        name: string('Window name, used as the containerWindowType name and the file stem. Lower-case with underscores.'),
        width: integer('Window width in base-resolution pixels.', 1, 4096),
        height: integer('Window height in base-resolution pixels.', 1, 4096),
        background: string('Background sprite name. Defaults to GFX_tile_large_bg.'),
        heading_font: string('Font for the heading. Defaults to malgun_goth_24.'),
        body_font: string('Font for body text and buttons. Defaults to cg_16b.'),
        template: {
          type: 'string',
          description: 'Starting shape. `window` is the default; `option_list` adds a custom_gui_option row.',
          enum: ['window', 'option_list'],
        },
      },
      required: ['name'],
    },
    handler: (args, context) => {
      const name = requireString(args, 'name');
      if (!/^[a-z][a-z0-9_]*$/.test(name)) {
        throw new ToolError(
          `\`name\` must be lower-case letters, digits and underscores starting with a letter (got \`${name}\`); ` +
            'the engine uses it as an identifier.',
        );
      }
      const layout = defaultLayout({
        name,
        ...(args.width ? { width: args.width } : {}),
        ...(args.height ? { height: args.height } : {}),
        ...(args.background ? { background: args.background } : {}),
        ...(args.heading_font ? { headingFont: args.heading_font } : {}),
        ...(args.body_font ? { bodyFont: args.body_font } : {}),
      });
      if (args.template === 'option_list') {
        layout.root.size = { width: args.width ?? 620, height: args.height ?? 420 };
        layout.root.children.push({
          id: 'option_row_1',
          kind: 'container',
          name: `${name}_option`,
          position: { x: 20, y: 280 },
          size: { width: '100%%', height: 34 },
          children: [
            {
              id: 'option_button',
              kind: 'button',
              name: 'option_button',
              quadTextureSprite: 'GFX_tiling_button_standard',
              font: args.body_font ?? 'cg_16b',
              text: 'OPTION_TEXT',
              position: { x: 0, y: 6 },
              size: { width: '100%%', height: 28 },
              alwaysTransparent: true,
            },
          ],
        });
      }
      // A default effect so the emitted .gui validates without the caller inventing a key.
      // The 4.4.6 shape is `add_resource = { <resource> = <amount> }` (1161 vanilla uses); the
      // older `resource =`/`amount =` pair is rejected with "Unexpected token: resource".
      layout.effects = layout.effects ?? {};
      layout.effects[`${name}_accept_effect`] = {
        potential: { always: true },
        effect: { add_resource: { influence: 0 } },
      };
      const id = context.nextLayoutId(name);
      context.layouts.set(id, { layout, createdAt: new Date().toISOString(), source: 'gui_layout_new' });
      context.lastLayoutId = id;
      return {
        layout_id: id,
        ...summariseLayout(layout, id),
        next: 'Call gui_layout_validate, then gui_layout_preview, then gui_emit_files.',
      };
    },
  },
  {
    name: 'gui_layout_edit',
    description:
      'Apply edits to a stored layout and return the new tree. Ops: add, remove, move, set, unset, rename, ' +
      'set_variable, set_root, set_meta. `target` accepts an element id or its `name`. Failed edits are reported ' +
      'individually rather than aborting the batch. GUARDED: an edit that would delete or rename a custom_gui ' +
      'CONTRACT element (the names the engine dereferences by name - `EVENT_DIPLO`, `option_list`, `close`, ' +
      '`empire_info_bg`, ...), un-pin `close` from the window\'s top-right corner, add a `shortcut` to a parked ' +
      'element, or put `effect` on a `buttonType`, is REFUSED and reported in `refused[]` with the reason and the ' +
      'fix; a batch containing one is not applied at all. An applied edit also returns `guardrailViolations`, the ' +
      'contract/parked/field findings the edit INTRODUCED (a delta, not the whole report, so an imported window\'s ' +
      'own warnings are not re-reported after every change).',
    inputSchema: {
      type: 'object',
      properties: {
        layout_id: string('Id of a stored layout. Optional when `layout` is passed.'),
        layout: object('A layout tree to edit instead of a stored one.'),
        edits: array('Edits to apply, in order.', object('{op, target?, parent?, node?, path?, value?, name?, values?}')),
        store: boolean('Store the result under the same layout_id. Defaults to true.'),
        custom_gui_windows: strings(
          'Window names an event names with `custom_gui`. They decide which containers are treated as event windows and ' +
            'therefore which element names are protected. Discovered from `extra_roots` events when omitted.',
        ),
        extra_roots: strings('Extra asset roots (a mod folder) to discover `custom_gui` window names from, and to resolve sprites against.'),
        guard: boolean(
          'Enforce the protection rules. Defaults to true. Setting it to false is reported in the result as ' +
            '`guardrails.disabled`, so an unguarded edit is never mistaken for a guarded one.',
        ),
      },
      required: ['edits'],
    },
    handler: (args, context) => {
      const { layout, id } = resolveLayout(args, context);
      const edits = Array.isArray(args.edits) ? args.edits : [];
      if (edits.length === 0) throw new ToolError('`edits` must be a non-empty array');
      const discovered = discoverCustomGuiWindows({ explicit: args.custom_gui_windows ?? [], roots: args.extra_roots ?? [] });
      const guardEnabled = args.guard !== false;
      const result = guardEnabled
        ? guardedEdit(layout, edits, {
            applyEdits,
            customGuiWindows: discovered.names,
            validationContext: { customGuiWindows: discovered.names, checkAssets: false, checkLocalisation: false },
          })
        : { ...applyEdits(layout, edits), refused: [], guardrails: { disabled: true, allowed: true, refusedCount: 0 }, violations: null };
      const storeId = id ?? context.nextLayoutId(result.layout.name ?? 'edited');
      if (args.store !== false) {
        context.layouts.set(storeId, {
          layout: result.layout,
          createdAt: new Date().toISOString(),
          source: 'gui_layout_edit',
        });
        context.lastLayoutId = storeId;
      }
      return {
        layout_id: storeId,
        applied: result.applied,
        failed: result.failed,
        ...(guardEnabled
          ? {
              guardrails: {
                ...result.guardrails,
                protected: protectionList(result.layout, { customGuiWindows: discovered.names }).map((entry) => ({
                  path: entry.path,
                  name: entry.name,
                  window: entry.window,
                  windowContainer: Boolean(entry.windowContainer),
                  close: Boolean(entry.close),
                })),
              },
              refused: result.refused,
              ...(result.violations
                ? {
                    guardrailViolations: {
                      verdict: result.violations.verdict,
                      clear: result.violations.clear,
                      summary: result.violations.summary ?? describeViolationDelta(result.violations),
                      introduced: result.violations.introduced,
                      introducedHard: result.violations.introducedHard,
                      introducedSoft: result.violations.introducedSoft,
                      resolved: result.violations.resolved,
                      ...(result.violations.error ? { error: result.violations.error } : {}),
                    },
                  }
                : {}),
            }
          : { guardrails: { disabled: true, note: 'the guard was disabled for this call: the protection rules were NOT enforced.' }, refused: [] }),
        ...(result.refused.length > 0
          ? {
              error:
                `${result.refused.length} edit(s) REFUSED by the handoff guardrails and the batch was not applied: ` +
                result.refused.map((entry) => entry.rule).join(', '),
            }
          : {}),
        ...summariseLayout(result.layout, storeId),
        ...(result.failed.length > 0
          ? { warning: `${result.failed.length} edit(s) failed and were skipped; the rest were applied.` }
          : {}),
      };
    },
  },
  {
    name: 'gui_layout_import',
    description:
      'Parse an existing .gui file (or inline text) into a layout tree and store it. Use this to inspect, validate ' +
      'or re-preview a hand-written window, including any vanilla file. Read-only: nothing is modified on disk. ' +
      'A .gui file\'s top-level containerWindowTypes become SIBLINGS under a flagged synthetic root (they are ' +
      'alternatives in game, not children), so the validator does not compare names or overlaps across windows. ' +
      'Pass `paths` to merge several files into one multi-window layout.',
    inputSchema: {
      type: 'object',
      properties: {
        path: string('Absolute path of a .gui file to read.'),
        paths: strings('Several .gui files to read and merge into one multi-window layout.'),
        text: string('Inline .gui text instead of a path.'),
        name: string('Optional layout name; defaults to the first container name.'),
        store: boolean('Store the parsed tree for later tools. Defaults to true.'),
      },
    },
    handler: (args, context) => {
      const sources = [...(args.paths ?? []), ...(args.path ? [args.path] : [])];
      let text = args.text;
      let fileKey = args.name ?? '(inline)';
      if (sources.length > 0) {
        const layouts = [];
        const parsedFiles = [];
        for (const path of sources) {
          if (!existsSync(path)) throw new ToolError(`no such file: ${path}`);
          const parsed = parseGuiText(readFileSync(path, 'utf8'), path);
          if (!parsed.ok) {
            return {
              ok: false,
              rootKeyword: parsed.rootKeyword,
              reason: `${path}: ${parsed.reason}`,
              error_count: 1,
              findings: [
                {
                  rule: 'root-invalid',
                  severity: 'error',
                  where: path,
                  message: parsed.reason,
                  suggestedFix: 'wrap every element in `guiTypes = { ... }`. `@variable` lines may precede it.',
                },
              ],
            };
          }
          layouts.push(parsed.layout);
          parsedFiles.push({ path, containers: parsed.containers.length, rootKeyword: parsed.rootKeyword, variables: parsed.variables });
        }
        const layout = layouts.length === 1 ? layouts[0] : mergeLayouts(layouts, { name: args.name });
        if (args.name) layout.name = args.name;
        // THE PRISTINE IMPORT, as a DEEP COPY. `gui_layout_edit` rewrites the stored layout in
        // place, so a reference to it would be the edited tree by the time an apply reads it -
        // measured: the handoff reported all 512 elements changed and produced a 146,848-byte file
        // instead of the byte-identical 146,310. The copy is kept both under the path it came from
        // and as this layout's previous revision, which is the slot the page and `gui_handoff_pick`
        // use for "the layout as it was loaded".
        const pristine = JSON.parse(JSON.stringify(layout));
        // WHICH FILE THIS TREE CAME FROM. It is what makes `gui_emit_files { apply_to }` able
        // to find the tree to diff against, and it is a single path only when a single file
        // was imported - a merged layout has no one source and must name its apply target.
        if (sources.length === 1) {
          layout.canonicalisedFrom = sources[0];
          pristine.canonicalisedFrom = sources[0];
          importedBaselines.set(sources[0].replace(/\\/g, '/').toLowerCase(), pristine);
        } else {
          delete layout.canonicalisedFrom;
          delete pristine.canonicalisedFrom;
        }
        const id = context.nextLayoutId(layout.name);
        if (args.store !== false) {
          context.layouts.set(id, { layout, createdAt: new Date().toISOString(), source: 'gui_layout_import' });
          context.lastLayoutId = id;
        }
        if (sources.length === 1) {
          context.previousRevisions ??= new Map();
          context.previousRevisions.set(id, {
            id: `${id} (as imported)`,
            source: `gui_layout_import of ${sources[0]}`,
            layout: pristine,
            recordedAt: new Date().toISOString(),
          });
        }
        return {
          ok: true,
          layout_id: id,
          rootKeyword: parsedFiles[0].rootKeyword,
          variables: Object.assign({}, ...parsedFiles.map((entry) => entry.variables)),
          topLevelContainers: parsedFiles.reduce((total, entry) => total + entry.containers, 0),
          files: parsedFiles,
          windows: topLevelContainers(layout).map((node) => node.name),
          ...summariseLayout(layout, id),
          note:
            sources.length > 1
              ? `Read-only import of ${sources.length} files, merged into one multi-window layout. Nothing was written.`
              : 'Read-only import. Nothing was written.',
        };
      }
      if (!text) throw new ToolError('pass `path`, `paths` or `text`');
      const parsed = parseGuiText(text, fileKey);
      if (!parsed.ok) {
        return {
          ok: false,
          rootKeyword: parsed.rootKeyword,
          reason: parsed.reason,
          error_count: 1,
          findings: [
            {
              rule: 'root-invalid',
              severity: 'error',
              where: fileKey,
              message: parsed.reason,
              suggestedFix: 'wrap every element in `guiTypes = { ... }`. `@variable` lines may precede it.',
            },
          ],
        };
      }
      const layout = parsed.layout;
      if (args.name) layout.name = args.name;
      const id = context.nextLayoutId(layout.name);
      if (args.store !== false) {
        context.layouts.set(id, { layout, createdAt: new Date().toISOString(), source: 'gui_layout_import' });
        context.lastLayoutId = id;
      }
      return {
        ok: true,
        layout_id: id,
        rootKeyword: parsed.rootKeyword,
        variables: parsed.variables,
        topLevelContainers: parsed.containers.length,
        windows: topLevelContainers(layout).map((node) => node.name),
        ...summariseLayout(layout, id),
        note: 'Read-only import. Nothing was written.',
      };
    },
  },
  {
    name: 'gui_layout_merge',
    description:
      'Merge several stored layouts (or inline trees) into ONE multi-window layout and store it. A .gui file may ' +
      'hold as many top-level containerWindowTypes as you like - that is how multi-window mods are built - and the ' +
      'windows must be SIBLINGS under one guiTypes root, not children of a shared root. The merged layout can be ' +
      'validated, previewed and emitted as a single file, which is what used to be done by hand.',
    inputSchema: {
      type: 'object',
      properties: {
        layout_ids: strings('Ids of stored layouts to merge, in order.'),
        layouts: array('Inline layout trees to merge instead of stored ones.', object('A layout tree.')),
        name: string('Name for the merged layout and its emitted file stem.'),
        store: boolean('Store the merged layout under a new id. Defaults to true.'),
      },
    },
    handler: (args, context) => {
      const list = [];
      for (const id of args.layout_ids ?? []) {
        const entry = context.layouts.get(id);
        if (!entry) throw new ToolError(`unknown layout_id \`${id}\`; known ids: ${[...context.layouts.keys()].join(', ') || '(none)'}`);
        list.push(entry.layout);
      }
      for (const layout of args.layouts ?? []) list.push(layout);
      if (list.length === 0) throw new ToolError('pass `layout_ids` (stored layouts) or `layouts` (inline trees)');
      const merged = mergeLayouts(list, args.name ? { name: args.name } : {});
      const id = context.nextLayoutId(merged.name);
      if (args.store !== false) {
        context.layouts.set(id, { layout: merged, createdAt: new Date().toISOString(), source: 'gui_layout_merge' });
        context.lastLayoutId = id;
      }
      return {
        layout_id: id,
        mergedFrom: merged.mergedFrom,
        windows: topLevelContainers(merged).map((node) => node.name),
        variables: Object.keys(merged.variables ?? {}),
        effects: Object.keys(merged.effects ?? {}),
        ...summariseLayout(merged, id),
        next: 'gui_layout_validate, then gui_layout_preview, then gui_emit_files: one file holds every window.',
      };
    },
  },
  {
    name: 'gui_layout_normalise',
    description:
      'Rewrite a stored layout into the form each element kind\'s ENGINE PARSER accepts, and report every change. Two ' +
      'classes, both of which produced real parse errors: the `size` keyword (text wants maxWidth/maxHeight, an icon ' +
      'wants none at all, and a cornered-tile icon becomes a container with a tile background) and per-kind FIELDS ' +
      '(`custom_tooltip` is a script field and becomes the kind\'s own tooltip field, `alwaysTransparent` on a ' +
      'container moves into its `background` block, an icon\'s `origo = center` becomes `centerPosition = yes`). Use ' +
      'it on an imported or hand-built tree before emitting; the tree it returns validates and emits clean.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        ...LAYOUT_ARGUMENTS,
        ...EXTRA_ROOTS,
        resolve_sizes: boolean('Resolve percentage/negative text sizes to pixels through the layout engine. Defaults to true.'),
        include_changes: boolean('Include the full change list. Defaults to true (it is the point of the call).'),
        store: boolean('Store the normalised tree under the same layout_id. Defaults to true.'),
      },
    },
    handler: (args, context) => {
      const { layout, id } = resolveLayout(args, context);
      const index = args.check_assets === false ? null : assets(context, args);
      const result = normaliseLayoutForKinds(layout, {
        spriteLookup: index ? makeSpriteLookup(index) : null,
        resolveSizes: args.resolve_sizes !== false,
        assets: index,
      });
      const storeId = id ?? context.nextLayoutId(result.layout.name ?? 'normalised');
      if (args.store !== false) {
        context.layouts.set(storeId, { layout: result.layout, createdAt: new Date().toISOString(), source: 'gui_layout_normalise' });
        context.lastLayoutId = storeId;
      }
      const byChange = {};
      for (const change of result.changes) byChange[change.change] = (byChange[change.change] ?? 0) + 1;
      return {
        layout_id: storeId,
        changeCount: result.changes.length,
        byChange,
        ...(args.include_changes !== false ? { changes: result.changes } : {}),
        ...summariseLayout(result.layout, storeId),
        note:
          'The tree is now in the form the engine\'s own parsers accept: no rejected `size`, and no field that belongs ' +
          'to another kind. Validate it, preview it, then emit.',
      };
    },
  },
  {
    name: 'gui_layout_get',
    description:
      'Read a stored layout tree back, with its computed absolute rectangle table. The table can be returned as JSON, ' +
      'CSV or a markdown table, so a reviewer can diff or paste it. ' +
      CANONICAL_SYSTEM_SENTENCE +
      ' Sprite-sized elements are resolved against the asset index (pass `check_assets: false` only to skip that), so ' +
      'an element whose size comes from its texture is reported at its real size instead of 0x0.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        ...EXTRA_ROOTS,
        layout_id: string('Id of a stored layout. Defaults to the most recent one.'),
        include_rects: boolean('Include the computed rect table. Defaults to true.'),
        include_tree: boolean('Include the full tree JSON. Defaults to false (large).'),
        include_parent_paths: boolean(
          'Also return one `{path, parentPath, depth}` row per element, so an element that CHANGED PARENT between two ' +
            'revisions is catchable by diffing the two lists. Defaults to false.',
        ),
        check_assets: boolean(
          'Build the asset index so an element sized by its sprite is reported at its texture size. Defaults to true; ' +
            'an index failure degrades to the old 0x0 behaviour with a note rather than failing the call.',
        ),
        rect_format: {
          type: 'string',
          description: 'Shape of the rect table: json (default), csv, markdown, or both (json + csv + markdown strings).',
          enum: ['json', 'csv', 'markdown', 'both'],
        },
      },
    },
    handler: (args, context) => {
      const { layout, id } = resolveLayout(args, context);
      // THE SPRITE LOOKUP. This handler used to hardcode `assets: null`, which meant every element
      // whose size comes from its texture - the 114x38 close button among them - was reported 0x0
      // in the rect table, and therefore "intersects nothing". Two validation rounds missed an
      // unclickable close button because of it. The index is built here unless the caller opts out.
      let index = null;
      let assetNote = null;
      if (args.check_assets !== false) {
        try {
          index = assets(context, args);
        } catch (thrown) {
          assetNote = `the asset index could not be built (${thrown instanceof Error ? thrown.message : String(thrown)}), so sprite-sized elements are reported as 0x0`;
        }
      } else {
        assetNote = 'check_assets was false, so sprite-sized elements are reported as 0x0 and any intersection with them is meaningless';
      }
      const spriteLookup = index ? makeSpriteLookup(index) : null;
      const preview = renderSvg(layout, { assets: index, spriteLookup, showGrid: false, includeTable: false, showText: false });
      const format = args.rect_format ?? 'json';
      const rows = preview.table;
      const json = rows.map((row) => ({
        path: row.path,
        name: row.name,
        kind: row.kind,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
        orientation: row.orientation,
        origo: row.origo,
        canonicalPosition: row.canonicalPosition,
        enginePosition: row.enginePosition,
        widthFormula: row.sizeFormula.width,
        heightFormula: row.sizeFormula.height,
        sprite: row.sprite,
      }));
      return {
        layout_id: id,
        ...summariseLayout(layout, id),
        windows: topLevelContainers(layout).map((node) => node.name),
        ...(assetNote ? { assetNote } : {}),
        ...(args.include_parent_paths === true ? { parentPaths: elementParentPaths(layout) } : {}),
        ...(args.include_rects !== false
          ? {
              ...(format === 'json' || format === 'both' ? { rects: json } : {}),
              ...(format === 'csv' || format === 'both' ? { rectsCsv: rectTableCsv(rows) } : {}),
              ...(format === 'markdown' || format === 'both' ? { rectsMarkdown: rectTableMarkdown(rows, { baseResolution: BASE_RESOLUTION, title: `Rect table for ${layout.name}` }) } : {}),
              rectCount: rows.length,
              baseResolution: BASE_RESOLUTION,
              formulaNote:
                'CANONICAL: origin top-left, +y down. corner = anchorPoint(parentRect, orientation) + ' +
                'position * axisDirection(orientation) - size * origoFraction, where axisDirection.y is -1 for the ' +
                'lower_left/center_down/lower_right anchors (a positive y there moves away from the parent, up the ' +
                'screen). `enginePosition` is the value a .gui file carries for the same element; the emitter derives ' +
                'it from the canonical rect with src/lib/coords.mjs, so the table and the file cannot disagree. ' +
                'widthFormula/heightFormula show how each size axis resolved.',
            }
          : {}),
        ...(args.include_tree ? { tree: layout } : {}),
      };
    },
  },

  // ------------------------------------------------------------------- components
  {
    name: 'gui_layout_add',
    description:
      'Add elements to a stored layout, by name, in one call. A thin, purpose-built wrapper over gui_layout_edit\'s ' +
      '`add` op: it resolves the parent once, appends in the order given, names each new element deterministically and ' +
      'returns the rect table row for each addition so the caller can see where it landed WITHOUT a second call. ' +
      'This is the path to use for a BAR: pass a `kind: "bar"` element (see gui_bar_spec) and it is expanded into the ' +
      'canonical track/fill/label construction at layout time, exactly like every other element. ' +
      CANONICAL_SYSTEM_SENTENCE,
    inputSchema: {
      type: 'object',
      properties: {
        layout_id: string('Id of a stored layout. Defaults to the most recent one.'),
        elements: array(
          'Elements to add, in order. Each is a normal layout node: {kind, name, position, size/width/height, ...}. ' +
            '`kind: "bar"` is a COMPONENT - see gui_bar_spec for its fields (`value`, `max`, `width`, `height`, ' +
            '`label`, `labelSide`, `effect`, `labelEffect`, `track`, `fill`).',
          object('{kind, name, position, ...}'),
        ),
        parent: string('Name or id of the container to add into. Defaults to the layout root (the window).'),
        at: integer('Index among the parent\'s children. Defaults to the end (so the addition draws last).'),
        extra_roots: strings('Extra asset roots (a mod folder), so a mod\'s sprites resolve in the validation delta.'),
        guard: boolean('Enforce the handoff guardrails. Defaults to true.'),
      },
      required: ['elements'],
    },
    handler: (args, context) => {
      const { layout, id } = resolveLayout(args, context);
      const elements = Array.isArray(args.elements) ? args.elements : [];
      if (elements.length === 0) throw new ToolError('`elements` must be a non-empty array of layout nodes');
      const edits = elements.map((node, index) => ({
        op: 'add',
        ...(args.parent ? { parent: args.parent } : {}),
        ...(args.at !== undefined ? { index: Number(args.at) + index } : {}),
        node,
      }));
      const discovered = discoverCustomGuiWindows({ explicit: [], roots: args.extra_roots ?? [] });
      const result =
        args.guard === false
          ? { ...applyEdits(layout, edits), refused: [] }
          : guardedEdit(layout, edits, {
              applyEdits,
              customGuiWindows: discovered.names,
              validationContext: { customGuiWindows: discovered.names, checkAssets: false, checkLocalisation: false },
            });
      if (result.refused?.length > 0) {
        return {
          layout_id: id,
          added: [],
          refused: result.refused,
          error:
            `${result.refused.length} element(s) REFUSED by the handoff guardrails and nothing was added: ` +
            result.refused.map((entry) => entry.rule).join(', '),
        };
      }
      const storeId = id ?? context.nextLayoutId(result.layout.name ?? 'added');
      context.layouts.set(storeId, { layout: result.layout, createdAt: new Date().toISOString(), source: 'gui_layout_add' });
      context.lastLayoutId = storeId;
      // THE RECT TABLE, so "where did it land" does not need a second call. The layout engine is
      // asked directly rather than through the preview renderer: `computeLayout` is the one pass the
      // preview, the rect table and the emitter all share, and it is also what EXPANDS a component,
      // so a `kind: 'bar'` element's five pieces appear here under their generated names. (An
      // earlier revision read the table off a `renderSvg` call with `includeTable: false`, which is
      // why `added` came back empty for every caller - the field was read but never populated.)
      const { boxes } = computeLayout(result.layout, {
        baseWidth: result.layout.baseResolution?.width,
        baseHeight: result.layout.baseResolution?.height,
      });
      const addedNames = new Set(result.applied.map((entry) => entry.name).filter(Boolean));
      /**
       * The elements an addition produced.
       *
       * The expansion stamps every piece it builds with `componentOf` - the name of the bar it came
       * from - so that marker is the reliable link, not the generated names. Predicting them is
       * wrong: `barElementName` only interposes the role when the bar's name has a `_<digits>_`
       * segment (`unga_power_1_main` -> `unga_power_track_1_main`), and appends it otherwise
       * (`pipe_bar_live_main` -> `pipe_bar_live_track_main`). Matching on a predicted name therefore
       * missed half the pieces for a bar named any other way - which reads as "the tool did nothing".
       * The fallback covers a non-component addition, whose own path ends in its name.
       */
      const escape = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const addedPatterns = [...addedNames].map((name) => new RegExp(`(^|/)${escape(name)}(/|$)`));
      const underAdded = (box) =>
        (box.node?.componentOf !== undefined && box.node.componentOf !== null && addedNames.has(String(box.node.componentOf))) ||
        addedPatterns.some((pattern) => pattern.test(String(box.path)));
      const added = boxes.filter(underAdded).map((box) => ({
        path: box.path,
        name: box.name,
        kind: box.kind,
        x: box.rect.x,
        y: box.rect.y,
        width: box.rect.width,
        height: box.rect.height,
        ...(box.node?.component ? { component: box.node.component } : {}),
      }));
      const bars = collectBars(result.layout).filter((bar) => addedNames.has(bar.name));
      return {
        layout_id: storeId,
        applied: result.applied,
        failed: result.failed,
        added,
        ...(bars.length > 0
          ? {
              bars: bars.map((bar) => ({
                name: bar.name,
                track: { width: bar.geometry?.width ?? null, height: bar.geometry?.height ?? null, sprite: bar.geometry?.track?.sprite ?? null },
                fill: { width: bar.geometry?.fillWidth ?? null, height: bar.geometry?.fillHeight ?? null, sprite: bar.geometry?.fill?.sprite ?? null, inset: bar.geometry?.inset ?? null },
                proportion: `${bar.geometry?.value} / ${bar.geometry?.max}`,
                label: bar.geometry?.label ?? null,
                labelSide: bar.geometry?.labelSide ?? null,
                labelLive: Boolean(bar.geometry?.labelLive),
                note:
                  'the fill length is a STATIC layout number written into the .gui file; the label is the only live part, ' +
                  'and only when labelLive is true (effectbuttonType.buttonText).',
              })),
            }
          : {}),
        next: 'Call gui_layout_validate, then gui_layout_preview, then gui_emit_files.',
      };
    },
  },
  {
    name: 'gui_bar_spec',
    description:
      'THE canonical bar / stat-readout construction, as data: the exact elements a bar expands to, the API ' +
      '(`value`, `max`, `width`, `height`, `label`, `labelSide`, `labelEffect`, `effect`, `track`, `fill`, `inset`), the ' +
      'measured reference it comes from (the working mod\'s six power-projection ranking bars, with file:line), the ' +
      'install lines for the two sprites, and the rules that refuse a wrong bar. Call this BEFORE hand-rolling a bar: ' +
      'every bar in a .gui file is DRAWN (there is no bar window element kind anywhere in 4.4.6), so the construction ' +
      'is the whole difference between a readout and a tinted box. Optionally emit a working example layout to inspect.',
    inputSchema: {
      type: 'object',
      properties: {
        example: boolean('Also return a small layout holding one bar of each `labelSide`, ready to validate/preview/emit. Defaults to false.'),
        label_side: {
          type: 'string',
          description: 'Which example to build when `example` is true. Defaults to `inside`.',
          enum: ['inside', 'above', 'below', 'left', 'right', 'none'],
        },
      },
    },
    handler: (args) => {
      const side = args.label_side ?? 'inside';
      const payload = {
        construction: BAR_CONSTRUCTION,
        /** The whole `unga_chart_main` subtree, every field and every source line range. */
        bandElements: REFERENCE_BAND_ELEMENTS,
        api: {
          required: ['width', 'height', 'value'],
          /** Every input field, with what it means - the single table the module and the docs share. */
          fields: BAR_FIELD_HELP,
          defaults: BAR_DEFAULTS,
          labelSides: ['inside', 'above', 'below', 'left', 'right', 'none'],
          /** Where each of the five elements sits, relative to the track's top-left corner. */
          offsets: referenceOffsets(),
          /**
           * A CLONE inherits the construction and overrides only the row. This is the shape to use
           * for a band of rows: one bar, then `cloneOf` + a new `position` per row, so five of the
           * six rows cannot drift the way the reference's own hand-computed widths did.
           */
          clone: {
            cloneOf: "the source bar's name; it must appear EARLIER in the tree",
            inherits: ['width', 'height', 'inset', 'track', 'fill', 'font', 'rowLabelWidth', 'valueWidth', 'seatsWidth', 'labelWidth', 'labelGap'],
            overrides: ['position', 'value', 'max', 'rowLabel', 'valueText', 'seats', 'label', 'labelSide', 'effect'],
            missingSource: 'bar-clone-source-missing (error): the named bar was not expanded earlier in document order',
          },
        },
        rules: Object.entries(COMPONENT_RULE_SEVERITY).map(([rule, severity]) => ({
          rule,
          severity,
          description: COMPONENT_RULE_DESCRIPTIONS[rule],
        })),
        constraint: {
          fill:
            'The fill LENGTH is `size.width` - a layout number the engine reads once, at load time. Derive it from ' +
            '`value`/`max` before writing the file; do not try to make it follow a value. A percentage or an @variable ' +
            '`width` is REFUSED by `bar-track-width-not-static`, so the wrong thing cannot be expressed.',
          label:
            'The only measured live-text channel inside a custom_gui window is `effectbuttonType.buttonText` (localisation -> ' +
            'common/scripted_loc -> common/script_values). A bracket data function in PAINTED text renders literally on ' +
            'screen (docs/gui-pitfalls.md section 11), and TEXT CANNOT MOVE A RECTANGLE - so a live number and a live bar ' +
            'length are different problems, and only the first one has a solution.',
          colour:
            '`trackColour`/`fillColour` are REFUSED (`bar-colour-not-exist`): a `.gui` container has no colour field. Pass a ' +
            'different tile sprite instead, or give the sprite an `effectFile` shader in a `.gfx` file.',
        },
        docs: 'docs/gui-pitfalls.md section 16 ("A bar is drawn, not declared").',
      };
      if (args.example === true) {
        const layout = defaultLayout({ name: 'bar_example', width: 560, height: 300 });
        layout.root.children.push({
          id: 'bar_example_bar',
          kind: 'bar',
          name: `bar_example_${side}`,
          position: { x: 20, y: 100 },
          width: 400,
          height: 20,
          value: 38,
          max: 100,
          label: 'bar_example_value',
          labelSide: side,
        });
        payload.example = { layout, labelSide: side };
        payload.note =
          'The example uses no localisation key that exists; expect `missing-localisation` for `bar_example_value` and for ' +
          'the default window\'s own stubs. That is the example, not the bar.';
      }
      return payload;
    },
  },

  // ------------------------------------------------------------------- validate / preview
  {
    name: 'gui_matrix_spec',
    description:
      'The MATRIX component, as data: `rows` x `columns` of `cellWidth` x `cellHeight` cells, separated by `gapX`/`gapY` ' +
      'and inset by `padding`, with optional column and row labels. Call this BEFORE trying to build a grid of your own ' +
      'content out of `gridBoxType`: measured over all 177 vanilla .gui files, 0 of 261 `gridBoxType` blocks and 0 of 189 ' +
      '`OverlappingElementsBoxType` blocks contain a nested element, because the ENGINE fills those from C++ (the install ' +
      'annotates its own grid boxes with "Use the positionTypes at the top of the file to change the slot size"). A mod\'s ' +
      'matrix is therefore one positioned containerWindowType per cell, and this component does that arithmetic, then ' +
      'refuses a cell whose content is bigger than its slot (`matrix-cell-overflow`). Optionally return a working example layout.',
    inputSchema: {
      type: 'object',
      properties: {
        example: boolean('Also return a small layout holding one 3x4 matrix, ready to validate/preview/emit. Defaults to false.'),
        rows: { type: 'integer', description: 'Override the example matrix\'s row count. Defaults to 3.' },
        columns: { type: 'integer', description: 'Override the example matrix\'s column count. Defaults to 4.' },
      },
    },
    handler: (args) => {
      const rows = Number.isInteger(args.rows) ? args.rows : 3;
      const columns = Number.isInteger(args.columns) ? args.columns : 4;
      const payload = {
        api: {
          required: ['rows', 'columns', 'cellWidth', 'cellHeight'],
          fields: {
            rows: 'how many rows the grid has (positive integer)',
            columns: 'how many columns',
            cellWidth: 'STATIC pixel width of one cell - every cell coordinate is derived from it and written as a literal',
            cellHeight: 'STATIC pixel height of one cell',
            gapX: `horizontal gap between cells (default ${MATRIX_DEFAULTS.gapX})`,
            gapY: `vertical gap between cells (default ${MATRIX_DEFAULTS.gapY})`,
            padding: `inset of the grid inside the frame (default ${MATRIX_DEFAULTS.padding})`,
            columnHeaderHeight: 'band height reserved for column labels; a non-empty `columnHeaders` defaults it on',
            rowHeaderWidth: 'column width reserved for row labels; a non-empty `rowHeaders` defaults it on',
            headerFont: `font for every label (default \`${MATRIX_DEFAULTS.headerFont}\`)`,
            columnHeaders: `array of localisation keys, exactly \`columns\` long`,
            rowHeaders: 'array of localisation keys, exactly `rows` long',
            cells: '`[{ row, column, node }]` - explicit placement, 0-based. A cell outside the grid is refused',
            children: 'contents placed row-major into the slots `cells` did not take',
          },
          defaults: MATRIX_DEFAULTS,
          whatItIsNot:
            'A `gridBoxType` is NOT a host for your content: it is engine-populated, and a child ELEMENT there is ' +
            'rejected at file load (`Unexpected token: <the child\'s keyword>`, the whole child block skipped - ' +
            '`engine-populated-container-children`, error). This component expands into `containerWindowType`s ' +
            'instead, which is the only kind that takes the size forms a computed frame needs.',
        },
        rules: Object.entries(MATRIX_RULE_SEVERITY).map(([rule, severity]) => ({
          rule,
          severity,
          description: MATRIX_RULE_DESCRIPTIONS[rule],
        })),
        constraint: {
          cellSize:
            '`cellWidth`/`cellHeight` must be STATIC pixel numbers. Every cell coordinate is written into the file as a ' +
            'literal, so a `%`/`%%`/`@variable` cell size cannot be laid out and is refused by `matrix-cell-size-not-static`.',
          overflow:
            'A cell whose content is larger than its slot draws over the next column WITHOUT overlapping a sibling or ' +
            'leaving the window - so `sibling-overlap` and `out-of-bounds` are both silent about it. That is what ' +
            '`matrix-cell-overflow` is for.',
        },
        docs: 'docs/gui-pitfalls.md section 18 ("A matrix is laid out, because the engine will not fill a grid for you").',
      };
      const geometryProbe = describeMatrix(
        { name: 'probe', rows, columns, cellWidth: MATRIX_DEFAULTS.cellWidth, cellHeight: MATRIX_DEFAULTS.cellHeight, columnHeaders: new Array(columns).fill('K'), rowHeaders: new Array(rows).fill('K') },
        { path: 'probe' },
      );
      payload.geometry = geometryProbe.geometry;
      payload.cellPositions = geometryProbe.geometry
        ? geometryProbe.geometry.rows * geometryProbe.geometry.columns <= 40
          ? Array.from({ length: geometryProbe.geometry.rows }, (_, row) =>
              Array.from({ length: geometryProbe.geometry.columns }, (_, column) => ({
                row,
                column,
                ...matrixCellBox(geometryProbe.geometry, row, column),
              })),
            ).flat()
          : `(${rows}x${columns} is too many to list; the arithmetic is x = ${geometryProbe.geometry.gridX} + column * ${geometryProbe.geometry.cellWidth + geometryProbe.geometry.gapX}, y = ${geometryProbe.geometry.gridY} + row * ${geometryProbe.geometry.cellHeight + geometryProbe.geometry.gapY})`
        : null;
      if (args.example === true) {
        const layout = defaultLayout({ name: 'matrix_example', width: 760, height: 360 });
        layout.root.children.push({
          id: 'matrix_example_mx',
          kind: 'matrix',
          name: 'matrix_example',
          position: { x: 24, y: 80 },
          rows,
          columns,
          cellWidth: MATRIX_DEFAULTS.cellWidth,
          cellHeight: MATRIX_DEFAULTS.cellHeight,
          columnHeaders: Array.from({ length: columns }, (_, index) => `matrix_example_col_${index}`),
          rowHeaders: Array.from({ length: rows }, (_, index) => `matrix_example_row_${index}`),
          cells: Array.from({ length: Math.min(rows, columns) }, (_, index) => ({
            row: index,
            column: index,
            node: { kind: 'text', name: `matrix_example_diag_${index}`, text: `matrix_example_diag_${index}`, font: 'cg_16b', maxWidth: MATRIX_DEFAULTS.cellWidth - 10, maxHeight: 18 },
          })),
        });
        payload.example = { layout };
        payload.note =
          'The example places one labelled cell on the diagonal. Expect `missing-localisation` for the generated keys - that ' +
          'is the example, not the matrix.';
      }
      return payload;
    },
  },

  {
    name: 'gui_layout_parent_paths',
    description:
      'Report every element\'s PARENT PATH, in document order, for one or more layouts. This is the offline check for ' +
      'the class of bug a text-level patcher produces: a file that still parses, still validates, and still has every ' +
      'element - but with one of them re-parented (a close button moved inside a different container is invisible to ' +
      'every geometric check, because it only changes the reference frame). Diff two revisions\' lists to see exactly ' +
      'which elements changed parent. Pass one layout_id to describe it, or two to compare them.',
    inputSchema: {
      type: 'object',
      properties: {
        layout_id: string('The layout to describe. Defaults to the most recent one.'),
        compare_layout_id: string('A second stored layout to compare against; the result then lists every element whose parent changed.'),
        include_rects: boolean('Include each element\'s canonical rect, so a parent change can be read together with its geometry. Defaults to false.'),
      },
    },
    handler: (args, context) => {
      const first = resolveLayout(args, context);
      const entries = elementParentPaths(first.layout);
      const result = {
        layout_id: first.id,
        elementCount: entries.length,
        entries,
        note:
          'A `parentPath` that changes between two revisions means the element moved container. Geometry alone cannot ' +
          'show that: the element can keep the same declared position and simply be measured against a different parent.',
      };
      if (args.compare_layout_id) {
        const secondEntry = context.layouts.get(args.compare_layout_id);
        if (!secondEntry) {
          throw new ToolError(
            `unknown compare_layout_id \`${args.compare_layout_id}\`; known ids: ${[...context.layouts.keys()].join(', ') || '(none)'}`,
          );
        }
        const other = elementParentPaths(secondEntry.layout);
        result.comparison = compareParentPaths(entries, other);
      }
      return result;
    },
  },
  {
    name: 'gui_layout_validate',
    description:
      'Run the geometry validator over a layout (or over a .gui file/text). Reports sibling overlaps, out-of-bounds ' +
      'elements, zero and negative-resolved sizes, duplicate names, unknown sprites and fonts, unresolvable button ' +
      'effects, missing localisation keys, bad orientation spellings, undeclared @variables and the ' +
      'option_button/OPTION_TEXT convention. Every finding carries coordinates, a severity and a suggested fix. ' +
      CANONICAL_SYSTEM_SENTENCE +
      ' All coordinates in the report are in the 1920x1080 base resolution.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        ...LAYOUT_ARGUMENTS,
        path: string('Validate this .gui file instead of a layout tree.'),
        text: string('Validate this .gui text instead of a layout tree.'),
        root_keyword: string('The file\'s first construct, when validating text you already know. Defaults to guiTypes.'),
        check_assets: boolean('Check sprite and font names against the asset index. Defaults to true.'),
        check_localisation: boolean('Check text/tooltip keys against the install localisation. Defaults to true.'),
        overlap_tolerance: number('Minimum overlapping area in px^2 before an overlap is reported. Defaults to 4.'),
        overlap_area_ratio: number(
          'Minimum overlap as a fraction of the smaller element. Defaults to 0.1, which suppresses decorative ' +
            'background overlaps so the report stays usable.',
        ),
        flag_transparent_overlaps: boolean('Also report overlaps involving alwaysTransparent decoration. Defaults to false.'),
        allow_offscreen_animated: boolean('Exempt slide-in elements with show_position/hide_position. Defaults to true.'),
        measure_text: boolean(
          'Measure the RENDERED text extent from the engine\'s own font descriptors (gfx/fonts/*.fnt advances and ' +
            'kerning, or the ttf_font/ttf_size override\'s hmtx table for CJK) and use it for the overlap and overflow ' +
            'rules. Adds `text-overflow` and `text-collision`, and turns `sibling-overlap` into a comparison of the ' +
            'measured ink rather than of two boxes. Defaults to true; measurement is skipped when no font catalogue ' +
            'can be read, and the report then says textMeasured:false.',
        ),
        languages: strings(
          'Localisation languages to index and to MEASURE IN. The font a name resolves to depends on the language ' +
            '(cg_16b is a 16px bitmap font in english and a 14px Noto Sans CJK in simp_chinese), so measure a Chinese ' +
            'mod with ["simp_chinese"]. Defaults to ["english"].',
        ),
        check_container_names: boolean(
          'Report a root containerWindowType name another file already defines: a custom_gui naming someone else\'s ' +
            'window does not show yours. Graded by the RELATIVE `.gui` path - the same path in two providers is an ' +
            'OVERRIDE (info: the engine reads only the LAST `dlc_load.json` entry and never parses the loser), a ' +
            'different path is a COLLISION (error: both files load and both declare the name). Defaults to true.',
        ),
        localisation_root: string('Extra localisation folder to index, e.g. a mod\'s localisation directory.'),
        localisation_roots: strings('Several extra localisation folders to index (a mod often has more than one language folder).'),
        button_effects_root: string(
          'Extra `common/button_effects` folder to index, e.g. a mod\'s own. Without it every effectbuttonType that ' +
            'names a mod-defined key is reported `effect-unresolved`. A file path inside the folder also works.',
        ),
        button_effects_roots: strings('Several extra `common/button_effects` folders to index.'),
        extra_roots: strings(
          'Extra asset roots (a mod folder) whose interface/**/*.gfx and common/button_effects are indexed alongside ' +
            'the install, so the mod\'s own sprites resolve instead of being reported `unknown-sprite`.',
        ),
        custom_gui_windows: strings(
          'Window names that an event names with `custom_gui`, so the contract check can call a missing element an ' +
            'ERROR instead of a warning. Taken from the events when `path`/`paths` point at a mod whose events sit in a ' +
            'sibling `events/` folder; pass them explicitly otherwise.',
        ),
        check_custom_gui_contract: boolean(
          'Check `custom_gui` event windows against the engine\'s by-name contract (missing, duplicated and ' +
            'mis-nested contract elements) and check parked elements. Defaults to true.',
        ),
        check_all_windows: boolean(
          'Run the contract check on EVERY top-level container, not only the ones that declare `EVENT_DIPLO` or are ' +
            'named by an event. Defaults to false: a container that is not an event window must not be told it is ' +
            'missing elements it never needed.',
        ),
        check_visibility: boolean(
          'Read every element\'s `effect` against the `common/button_effects/` entry it names and report the patterns ' +
            'that make a control\'s VISIBILITY depend on the scope the window was opened in ' +
            '(`visibility-scope-dependent`, `visibility-flag-scope-dependent`). An `effectbuttonType` carries no ' +
            'visibility of its own: the entry\'s `potential` decides whether the button is DRAWN, so a `potential` ' +
            'testing `is_scope_type` makes the control vanish by route - it shipped and was reported by a player before ' +
            'any geometric rule noticed. The per-element `effect` -> `potential` table is returned in `visibility.table` ' +
            'whether or not a finding fired. Defaults to true.',
        ),
        visibility_scope_guarantees: {
          type: 'object',
          description:
            'Which scope each window is GUARANTEED to be entered in, as `{ "<window name>": "<scope>" }` (an array of ' +
              '`{ window, scope }` also works). The plugin does not read event `trigger` blocks, so without this the ' +
              'entry scope of a window is reported as not established - which is itself the risky case, because an ' +
              'event window\'s scope is whatever the event was fired with. A window you know is only ever opened from ' +
              'the planet panel is `{ "my_window": "planet" }`, and a scope test there is then reported as an INFO ' +
              'finding that records the guarantee rather than an error.',
          additionalProperties: true,
        },
        park_margin: number(
          'How far OUTSIDE the root rect an element is still a layout problem rather than a deliberate park, in ' +
            '1920x1080 base-resolution pixels. Defaults to 512, the smallest margin that clears every panel of a ' +
            'vanilla-shaped event window (their interiors start about 670 px above the top edge). At the margin or ' +
            'beyond, the finding is reported as `out-of-bounds-parked` (info) and counted in ' +
            '`geometry.outOfBounds.parked` instead of inflating `out-of-bounds` - the `-3000,-3000` idiom this ' +
            'project uses to hide contract-required elements. 0 turns the classification off; nothing is ever ' +
            'suppressed, both counts are reported.',
        ),
        languages: strings('Localisation languages to index. Defaults to ["english"].'),
      },
    },
    handler: (args, context) => {
      if (args.path || args.text) {
        let text = args.text;
        let fileKey = args.path ?? '(inline)';
        if (!text) {
          if (!existsSync(args.path)) throw new ToolError(`no such file: ${args.path}`);
          text = readFileSync(args.path, 'utf8');
        }
        // When the caller points at a mod's .gui, the sibling `events/` folder is what says which
        // windows are real `custom_gui` windows - that is what decides error vs warning.
        const discovered = discoverCustomGuiWindows({
          fileKey,
          explicit: args.custom_gui_windows ?? [],
          roots: args.extra_roots ?? [],
        });
        const report = runValidation(context, null, args, { text, fileKey, customGuiWindows: discovered.names });
        return { ...summariseReport(report), customGuiWindows: discovered.names, customGuiWindowSources: discovered.sources };
      }
      const { layout, id } = resolveLayout(args, context);
      const discovered = discoverCustomGuiWindows({ explicit: args.custom_gui_windows ?? [], roots: args.extra_roots ?? [] });
      const report = runValidation(context, layout, args, { customGuiWindows: discovered.names });
      return { layout_id: id, ...summariseReport(report), customGuiWindows: discovered.names, customGuiWindowSources: discovered.sources };
    },
  },
  {
    name: 'gui_layout_preview',
    description:
      'Render a layout to a self-contained SVG (grid, per-kind colours, real decoded textures, labelled placeholders, ' +
      'finding overlays and a rect table) and optionally a PNG. With `inline_image: true` the result includes an MCP ' +
      'image content block, so an agent that cannot see the game can still look at the layout.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        ...LAYOUT_ARGUMENTS,
        output_dir: string('Absolute directory to write preview.svg / preview.png into. Defaults to <project>/out/<timestamp>/preview.'),
        write_files: boolean('Write the SVG and PNG to disk. Defaults to true.'),
        inline_image: boolean('Embed the PNG as an MCP image content block. Defaults to true.'),
        inline_svg: boolean('Embed the SVG text in the result. Defaults to false (it can be large).'),
        png: boolean('Also render a PNG. Defaults to true.'),
        png_scale: number('PNG scale factor, e.g. 0.5 for a half-size image. Defaults to 0.5.'),
        show_grid: boolean('Draw the 40px grid. Defaults to true.'),
        include_table: boolean('Append the rect table to the SVG. Defaults to true.'),
        highlight_rules: strings('Only outline findings with these rules, e.g. ["out-of-bounds","sibling-overlap"].'),
        with_validation: boolean('Overlay validation findings. Defaults to true.'),
        render_localisation: boolean(
          'Draw the RESOLVED localisation text instead of the raw key (needs localisation_root(s)). This is how text ' +
            'overflow is judged: a key that fits in english can overflow in simp_chinese. Defaults to false.',
        ),
        localisation_root: string('Localisation folder to resolve text from.'),
        localisation_roots: strings('Several localisation folders to resolve text from.'),
        languages: strings('Languages to resolve text from. Defaults to ["english"].'),
        extra_roots: strings('Extra asset roots (a mod folder) whose .gfx sprites should resolve.'),
      },
    },
    handler: (args, context) => {
      const { layout, id } = resolveLayout(args, context);
      const index = args.check_assets === false ? null : assets(context, args);
      const cache = context.thumbnailCache ?? (context.thumbnailCache = new ThumbnailCache());
      const report = args.with_validation === false ? null : runValidation(context, layout, args);
      const locIndex = args.render_localisation === true ? localisation(context, args, true) : null;
      const options = {
        assets: index,
        cache,
        gameRoot: index?.root ?? null,
        // The measurement language follows the requested localisation language: the same font
        // name is a bitmap font in English and a TTF in Simplified Chinese (interface/fonts.gfx),
        // so measuring Chinese text with the English advances would be wrong by a wide margin.
        language: (args.languages ?? ENGLISH)[0] ?? 'english',
        showGrid: args.show_grid !== false,
        includeTable: args.include_table !== false,
        validationReport: report,
        ...(args.highlight_rules ? { highlightRules: args.highlight_rules } : {}),
        ...(locIndex
          ? { resolveLocalisation: (key) => locIndex.values?.get(key) ?? null, localisationValues: locIndex.values }
          : {}),
      };
      const svgResult = renderSvg(layout, options);
      const written = { svg: null, png: null, outputDir: null };
      let pngBuffer = null;
      if (args.write_files !== false) {
        const outputDir = args.output_dir
          ? ensureDir(resolve(args.output_dir))
          : ensureDir(join(defaultOutputRoot(), 'preview'));
        written.outputDir = outputDir;
        written.svg = join(outputDir, 'preview.svg');
        writeFileSync(written.svg, svgResult.svg, 'utf8');
        if (args.png !== false) {
          const pngResult = renderPng(layout, { ...options, scale: args.png_scale ?? 0.5 });
          written.png = join(outputDir, 'preview.png');
          writeFileSync(written.png, pngResult.png);
          written.pngBytes = pngResult.png.length;
          written.pngDimensions = { width: pngResult.width, height: pngResult.height };
          pngBuffer = pngResult.png;
        }
      } else if (args.png !== false && args.inline_image !== false) {
        const pngResult = renderPng(layout, { ...options, scale: args.png_scale ?? 0.5 });
        pngBuffer = pngResult.png;
        written.pngDimensions = { width: pngResult.width, height: pngResult.height };
      }

      const payload = {
        layout_id: id,
        svgPath: written.svg,
        pngPath: written.png,
        outputDir: written.outputDir,
        stats: svgResult.stats,
        baseResolution: BASE_RESOLUTION,
        assetIndexRoot: index?.root ?? null,
        assetIndexRoots: index?.roots ?? null,
        ...(written.pngBytes ? { pngBytes: written.pngBytes } : {}),
        ...(written.pngDimensions ? { pngDimensions: written.pngDimensions } : {}),
        ...(report ? { validation: { verdict: report.verdict, counts: report.counts, byRule: report.byRule } } : {}),
        chromeIsApproximate: true,
        note:
          'Preview geometry is in the 1920x1080 base resolution. Textures that decoded are embedded; anything else is a ' +
          'labelled placeholder, which is information rather than a failure. Cornered-tile chrome is drawn as a 9-slice ' +
          '(corners natural, edges and middle stretched), so CHROME COLOUR AND CORNER SIZE ARE APPROXIMATE - the game may ' +
          'scale the corners differently when an element is smaller than twice its border. Rect positions and sizes are exact.',
      };
      if (args.inline_svg) payload.svg = svgResult.svg;
      if (svgResult.stats.textFit.overflowing.length > 0) {
        payload.textOverflowEstimates = svgResult.stats.textFit.overflowing;
      }

      if (args.inline_image !== false && pngBuffer) {
        return {
          __mcpContent: [
            { type: 'text', text: JSON.stringify(payload, null, 2) },
            { type: 'image', data: pngBuffer.toString('base64'), mimeType: 'image/png' },
          ],
        };
      }
      return payload;
    },
  },

  // ------------------------------------------------------------------- emit
  {
    name: 'gui_emit_files',
    description:
      'Write standalone mod files for a layout: interface/<stem>.gui, common/button_effects/<stem>_button_effects.txt ' +
      '(when effects are declared), events/<stem>_events.txt with custom_gui/custom_gui_option (one event per window, ' +
      'each with at least one option), and localisation/<language>/<stem>_l_<language>.yml (UTF-8 WITH BOM; script ' +
      'files are UTF-8 without). Files go ONLY to `output_root`; a root that is a game install, the user-data folder, ' +
      'or contains descriptor.mod is refused - to override a vanilla file on purpose use gui_emit_override. Pass ' +
      '`layout_ids` to write ONE file holding every window. Sizes are written in the form the engine\'s own parser for ' +
      'each kind accepts (text: maxWidth/maxHeight; button/list/scrollbar: size = { x y }; container/gridBox: ' +
      'size = { width height }; icon: no size at all). Defaults to dry_run = true, which returns the file plan without ' +
      'writing, including a warning per element whose size could not be written verbatim.',
    inputSchema: {
      type: 'object',
      properties: {
        ...LAYOUT_ARGUMENTS,
        layout_ids: strings('Several stored layouts to emit as ONE .gui file (one guiTypes root, several windows).'),
        output_root: string(
          'Absolute output directory. Required when dry_run is false. Defaults to <project>/out/<timestamp>/ when ' +
            'dry_run is false and none is given.',
        ),
        dry_run: boolean('Defaults to true. Returns the file plan and writes nothing.'),
        file_stem: string('Base file name. Defaults to the layout name.'),
        language: string('Localisation language folder. Defaults to english.'),
        include_event: boolean('Emit the event stub with custom_gui. Defaults to true.'),
        include_localisation: boolean('Emit the localisation stub. Defaults to true.'),
        diplomatic: boolean(
          'Include `diplomatic = yes` in the event stub. Defaults to true: every `custom_gui` use in the 4.4.6 ' +
            'install sits in a block that declares it, and the flag selects the DIPLOMATIC event-window class. It is ' +
            'NOT required for the field to resolve - measured in game 2026-10-06, a non-diplomatic event builds the ' +
            'ordinary event window instead. Setting false emits a convention warning rather than refusing.',
        ),
        check_custom_gui_contract: boolean(
          'Run the custom_gui window contract against the tree about to be written, and report it as `contract`. ' +
            'Defaults to true: the contract is about element names the tree is MISSING, which no amount of correct ' +
            'emission can supply, and a missing one is a null dereference in the engine.',
        ),
        custom_gui_windows: strings(
          'Window names an event names with `custom_gui`. Taken from the `events/` folder of each `extra_roots` mod ' +
            'when not given, which is what decides whether a missing contract element is an error.',
        ),
        extra_roots: strings('Extra asset roots (a mod folder), so a mod\'s sprites resolve in emit warnings.'),
        apply_to: string(
          'Absolute path of the .gui file this layout was IMPORTED from, to PATCH IN PLACE instead of writing new files. ' +
            'The edited tree is diffed against the tree as it was imported and only the added/changed/removed elements are ' +
            'spliced into the ORIGINAL bytes, so every line the edit did not touch - every comment, every field order, every ' +
            'spelling - stays byte-identical, and an apply with no edits reproduces the file byte for byte. This is the only ' +
            'write path that targets an existing file, because this is the file the caller named: the install and the user-data ' +
            'folder are still refused, and the patched text must pass the engine syntax check or nothing is written. The ' +
            'baseline is taken from the layout this one was imported as (context.previousRevisions), or from any stored layout ' +
            'whose source file is the same path; pass `baseline_layout_id` to name it explicitly.',
        ),
        baseline_layout_id: string(
          'Layout id of the tree as it was IMPORTED, when `apply_to` is used and the baseline cannot be found automatically.',
        ),
        apply_dry_run: boolean(
          'For `apply_to`: when true, report the diff and the exact patched text without writing anything. Defaults to false, ' +
            'because a dry run through `dry_run` (which defaults to true) cannot return file paths and is easy to misread.',
        ),
      },
    },
    handler: (args, context) => {
      const layouts = [];
      if (args.layout_ids?.length) {
        for (const id of args.layout_ids) {
          const entry = context.layouts.get(id);
          if (!entry) throw new ToolError(`unknown layout_id \`${id}\`; known ids: ${[...context.layouts.keys()].join(', ') || '(none)'}`);
          layouts.push(entry.layout);
        }
      } else {
        layouts.push(resolveLayout(args, context).layout);
      }
      const id = args.layout_id ?? args.layout_ids?.[0] ?? context.lastLayoutId ?? null;

      // ------------------------------------------------------------------ apply mode
      if (args.apply_to) {
        return applyToExistingFile(args, context, layouts, id);
      }

      const stem = args.file_stem ?? sanitise(args.name ?? (layouts.length > 1 ? mergedStem(layouts) : layouts[0].name) ?? 'custom_gui');
      const dryRun = args.dry_run !== false;
      const outputRoot = args.output_root
        ? assertOutputRoot(args.output_root)
        : dryRun
          ? null
          : assertOutputRoot(defaultOutputRoot());
      const index = args.check_assets === false ? null : assets(context, args);
      const discoveredWindows = discoverCustomGuiWindows({ explicit: args.custom_gui_windows ?? [], roots: args.extra_roots ?? [] });
      const result = emitFiles(layouts, {
        outputRoot: outputRoot ?? join(defaultOutputRoot(), stem),
        dryRun,
        fileStem: stem,
        language: args.language ?? 'english',
        includeEvent: args.include_event !== false,
        includeLocalisation: args.include_localisation !== false,
        spriteLookup: index ? makeSpriteLookup(index) : null,
        ...(args.diplomatic !== undefined ? { diplomatic: args.diplomatic } : {}),
        // THE PRE-WRITE CONTRACT GATE. `custom_gui` windows are named by the events, and the
        // contract is about what the tree is MISSING, so it is checked against the tree that is
        // about to be written and reported as `contract` in the same result as the file list.
        checkContract: args.check_custom_gui_contract !== false,
        customGuiWindows: discoveredWindows.names,
      });
      // Report the intended path even on a dry run, so the caller knows where to look.
      const intendedRoot = outputRoot ?? join(defaultOutputRoot(), stem);
      if (dryRun) {
        return {
          layout_id: id,
          layout_ids: args.layout_ids ?? null,
          dryRun: true,
          output_root: intendedRoot,
          wouldWriteTo: intendedRoot,
          windows: result.windows,
          encodingRules: {
            'interface/*.gui': 'UTF-8, no BOM',
            'common/button_effects/*.txt': 'UTF-8, no BOM',
            'events/*.txt': 'UTF-8, no BOM',
            'localisation/**/*.yml': 'UTF-8 WITH BOM (required, or the engine ignores the file)',
          },
          sizeRules: {
            'instantTextBoxType': 'maxWidth / maxHeight (the engine rejects `size` outright)',
            'iconType': 'no size at all: it draws at its sprite texture size',
            'buttonType / effectbuttonType / listBoxType / smoothListBoxType / OverlappingElementsBoxType / guiButtonType / scrollbarType': 'size = { x = <width> y = <height> }',
            'containerWindowType / gridBoxType / dropDownBoxType / extendedScrollbarType': 'size = { width = <w> height = <h> }',
          },
          plan: result.plan,
          warnings: result.warnings,
          warningCount: result.warnings.length,
          ...(result.contract ? { contract: result.contract } : {}),
          note: `Dry run: nothing was written. Repeat with dry_run = false and output_root = "${intendedRoot}" to write these files.`,
        };
      }
      const syntax = result.files
        .filter((file) => file.kind === 'gui')
        .map((file) => checkGuiSyntax(readTextFile(file.absolutePath), file.path));
      return {
        layout_id: id,
        layout_ids: args.layout_ids ?? null,
        dryRun: false,
        output_root: result.outputRoot,
        windows: result.windows,
        fileCount: result.files.length,
        files: result.files.map((file) => ({
          kind: file.kind,
          path: file.path,
          absolutePath: file.absolutePath,
          bytes: file.bytes,
          bom: file.bom,
          encoding: file.encoding,
        })),
        syntaxCheck: syntax.map((entry) => ({ ok: entry.ok, counts: entry.counts })),
        ...(result.contract ? { contract: result.contract } : {}),
        warnings: result.warnings,
        note: result.note,
      };
    },
  },
  {
    name: 'gui_emit_override',
    description:
      'DELIBERATELY OVERRIDE a vanilla .gui file: the vanilla source plus the elements you add to it. This is the only ' +
      'way to put a button on the planet panel, and it is the one write path that is allowed to target a mod ' +
      'workspace - which is why it needs `i_understand_this_overrides_vanilla_file: true`. The vanilla file\'s sha256 ' +
      'is recorded in the result and in the output header; pass it back as `expected_source_hash` on a later run and ' +
      'the call REFUSES if the vanilla file has changed, which is the only signal that your copy has gone stale. The ' +
      'vanilla file itself is never modified, and the output still goes only into `output_root`.',
    inputSchema: {
      type: 'object',
      properties: {
        vanilla_path: string('Absolute path of the VANILLA file to override, e.g. <install>/interface/planet_view.gui.'),
        additions: array(
          'Elements to add. Each is { container?, element }: `element` is a normal layout node (kind/name/position/...), ' +
            'and `container` names an existing container in the vanilla file to append it to. Without `container` the ' +
            'element is appended after the last top-level container.',
          object('{ container?: string, element: object, indent?: string }'),
        ),
        i_understand_this_overrides_vanilla_file: boolean(
          'Required, and must be true. A full-file override replaces the vanilla file for every mod in the load order.',
        ),
        expected_source_hash: string(
          'The sha256 recorded by an earlier call. The call refuses when the vanilla file no longer matches, so a game ' +
            'update cannot silently leave you with a stale override.',
        ),
        output_root: string('Absolute directory to write into. The mod workspace is allowed here; a game install is not.'),
        dry_run: boolean('Defaults to true: returns the plan, the recorded hash and the first lines of the result.'),
        validate: boolean('Run the engine syntax check on the result. Defaults to true.'),
        extra_roots: strings('Extra asset roots, so a mod\'s sprites resolve in the emitted additions.'),
      },
      required: ['vanilla_path', 'additions'],
    },
    handler: (args, context) => {
      const vanillaPath = requireString(args, 'vanilla_path');
      if (!Array.isArray(args.additions) || args.additions.length === 0) {
        throw new ToolError('pass `additions`: at least one `{ container?, element }` to add to the vanilla file');
      }
      const dryRun = args.dry_run !== false;
      if (!dryRun && args.i_understand_this_overrides_vanilla_file !== true) {
        throw new ToolError(
          'refusing to write a vanilla override: set `i_understand_this_overrides_vanilla_file: true`. A full-file ' +
            'override replaces the vanilla file for every mod in the load order, and it goes stale whenever the game updates.',
        );
      }
      if (!args.output_root) throw new ToolError('an explicit absolute `output_root` is required (the mod\'s folder is allowed here)');
      const index = args.check_assets === false ? null : assets(context, args);
      const result = emitOverride(vanillaPath, args.additions, {
        outputRoot: args.output_root,
        dryRun,
        confirm: args.i_understand_this_overrides_vanilla_file === true,
        expectedSourceHash: args.expected_source_hash,
        spriteLookup: index ? makeSpriteLookup(index) : null,
      });
      const syntax = args.validate === false ? null : checkGuiSyntax(result.content ?? '', `${vanillaPath} (override)`);
      return {
        ...result,
        ...(syntax ? { syntaxCheck: { ok: syntax.ok, counts: syntax.counts, findings: syntax.findings.filter((f) => f.severity === 'error') } } : {}),
        vanillaNote:
          'The vanilla file was read and never modified. The output header records the vanilla sha256 so a later run ' +
          'can prove the base has not moved. Run `gui_override_drift` on the written copy at any time to see whether the ' +
          'base HAS moved and exactly what changed under you.',
      };
    },
  },
  {
    name: 'gui_override_drift',
    description:
      'THE ANTI-DRIFT REPORT for a vanilla `.gui` override: "has my base moved, and what changed under me?". Overriding a ' +
      'vanilla file is the only way to put a mod\'s elements on a screen the engine opens for its own reasons (there is no ' +
      'script effect that opens a window), and the only thing that makes it hard is that the base moves. This compares the ' +
      'mod\'s copy against the vanilla file on disk now and reports: whether the recorded `sha256` still matches; every ' +
      'element the CURRENT vanilla file declares that your copy does NOT (vanilla content you are dropping - an override ' +
      'replaces, it does not merge); every element your copy declares that vanilla never did (your additions, with the ' +
      'container each one hangs off); and every element you CHANGE, with the direction stated (vanilla 500x448 -> your copy ' +
      '700x520) - which is the case a slot-expanding mod lives in, because the capacity of an engine-populated list is a ' +
      'number in the `.gui` and nowhere else. Both files are READ, never written.',
    inputSchema: {
      type: 'object',
      properties: {
        overridden_path: string('Absolute path of the MOD\'s copy, e.g. <mod>/interface/planet_view.gui.'),
        vanilla_path: string('Absolute path of the vanilla file it replaces, e.g. <install>/interface/planet_view.gui.'),
        game_root: string('Optional: the install root, so the report can also compare the mod\'s `descriptor.mod supported_version` with the install version.'),
      },
      required: ['overridden_path', 'vanilla_path'],
    },
    handler: (args) => {
      const overriddenPath = requireString(args, 'overridden_path');
      const vanillaPath = requireString(args, 'vanilla_path');
      if (resolve(overriddenPath) === resolve(vanillaPath)) {
        throw new ToolError('`overridden_path` and `vanilla_path` are the same file; there is nothing to compare');
      }
      let gameRoot = args.game_root ?? null;
      if (!gameRoot) {
        try {
          gameRoot = resolveGameRoot();
        } catch {
          gameRoot = null;
        }
      }
      const report = analyseOverrideDrift(overriddenPath, vanillaPath, { gameRoot });
      return {
        ...report,
        // The finding an agent should ACT on, first, so the report does not have to be read to the end.
        actOn:
          report.baseHash.moved === true
            ? 'The base moved. Diff the vanilla file, then either re-copy it and re-apply your edits, or re-splice them with `gui_emit_files { apply_to }` so untouched lines stay byte-identical.'
            : report.baseHash.moved === null
              ? 'No base hash is recorded, so drift cannot be detected. Re-emit this override through `gui_emit_override`, which writes one.'
              : 'The recorded base hash matches the vanilla file on disk. Nothing to do.',
        neverWritten: 'Both files were read and neither was modified.',
      };
    },
  },
  {
    name: 'gui_check_files',
    description:
      'Inspect files the tool did NOT write: encoding (a localisation .yml without a BOM is ignored by the engine; a ' +
      '.gui with one is a parse error), the `guiTypes` root, per-kind engine syntax (a `size` block on an ' +
      'instantTextBoxType or iconType is a hard parse error), localisation key syntax and duplicates, event shape ' +
      '(an event needs at least one `option`, and every title/desc/option name must resolve to a real key) and ' +
      '`common/button_effects` key shape. Also re-runs the full layout validator on any .gui it is given.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        paths: strings('Absolute paths of files to check: .gui, event .txt, common/button_effects/*.txt, localisation .yml.'),
        localisation_roots: strings('Extra localisation folders to index, e.g. the mod\'s localisation directory.'),
        paths_root: string('Optional directory: every .gui, .txt and .yml under it (recursively) is checked.'),
        languages: strings('Localisation languages to index. Defaults to ["english"].'),
        extra_roots: strings(
          'Extra asset roots (a mod folder). Its own interface/**/*.gfx, common/button_effects/*.txt and ' +
            'interface/**/*.gui container names are indexed too, so a mod-defined `effect` resolves and a mod window ' +
            'name is not reported as unknown. Without it, `effect-unresolved` is a false positive on every ' +
            'mod-defined button effect.',
        ),
        check_loc_keys: boolean('Check localisation keys. Defaults to true.'),
        check_custom_gui_contract: boolean(
          'Check custom_gui event windows against the engine\'s by-name contract, and check parked elements. ' +
            'Defaults to true. Pass the event files alongside the .gui and a missing contract element becomes an ' +
            'error instead of a warning.',
        ),
        check_event_windows: boolean(
          'Run the cross-file rules on any event file passed (`force_open` + `custom_gui`, and an option 0 that ' +
            'fires the event whose window it just closed). Defaults to true.',
        ),
        button_effects_root: string(
          'Extra `common/button_effects` folder to READ (not just index), e.g. a mod\'s own. The `effect` -> ' +
            '`potential` visibility table needs the FILES, so without one the table is empty and the visibility rules ' +
            'say nothing. An `extra_roots` entry that contains `common/button_effects` is read too.',
        ),
        button_effects_roots: strings('Several extra `common/button_effects` folders to read.'),
        custom_gui_windows: strings(
          'Window names that an event names with `custom_gui`. Taken from the events when they are among the files ' +
            'passed or sit beside the `.gui`; pass them explicitly otherwise. They decide whether a visibility ' +
            'finding is an ERROR (an event names this window, so it is reachable from more than one scope) or a warning.',
        ),
        visibility_scope_guarantees: {
          type: 'object',
          description:
            'Which scope each window is GUARANTEED to be entered in, as `{ "<window name>": "<scope>" }`. A scope ' +
              'test in a button effect\'s `potential` is an ERROR without this and an INFO finding that records the ' +
              'guarantee with it. See `gui_layout_validate`.',
          additionalProperties: true,
        },
        park_margin: number(
          'How far outside the root rect an element is still an escape rather than a deliberate park, in 1920x1080 ' +
            'base-resolution pixels. Defaults to 512; 0 switches the classification off. Counted in `geometry`.',
        ),
      },
      required: [],
    },
    handler: (args, context) => {
      const paths = [...(args.paths ?? [])];
      if (args.paths_root) {
        paths.push(...listFilesRecursive(args.paths_root, ['.gui', '.txt', '.yml']));
      }
      if (paths.length === 0) throw new ToolError('pass `paths` (files) or `paths_root` (a directory to walk)');
      const index = assets(context, args);
      // GAP-12: the effect FILES, not just the keys - the visibility table reads each entry's
      // `potential`. The asset index carries their absolute paths; an explicit root is read here
      // because it may not be in the index.
      const effectRoots = [...(args.button_effects_roots ?? []), ...(args.button_effects_root ? [args.button_effects_root] : [])];
      const buttonEffectFiles = [
        ...(index.buttonEffectPaths ?? []),
        ...effectRoots.flatMap((root) => {
          const directory = /\.txt$/i.test(root) ? dirname(root) : root;
          if (!existsSync(directory)) return [];
          const candidates = /\.txt$/i.test(root) ? [root] : listFilesRecursive(directory, ['.txt']);
          return candidates.filter((file) => existsSync(file));
        }),
      ];
      const report = checkFiles({
        paths,
        languages: args.languages ?? ENGLISH,
        localisationRoots: args.localisation_roots ?? [],
        roots: [args.game_root ?? context.gameRoot],
        // The INSTALL root only: `assets` carries the extra roots for sprite/effect resolution, but
        // the install root is what tells `checkFiles` whether a .gui it was handed belongs to a mod
        // (findings are errors) or to the install (findings about the shipped file stay warnings).
        assetRoots: index.roots ?? [],
        assets: index,
        checkLocKeys: args.check_loc_keys !== false,
        checkCustomGuiContract: args.check_custom_gui_contract !== false,
        checkEventWindows: args.check_event_windows !== false,
        buttonEffectFiles,
        buttonEffectRoots: effectRoots,
        customGuiWindows: args.custom_gui_windows ?? [],
        ...(args.visibility_scope_guarantees ? { visibilityScopeGuarantees: args.visibility_scope_guarantees } : {}),
        ...(args.park_margin !== undefined ? { parkMargin: args.park_margin } : {}),
      });
      return {
        ...report,
        assetIndexRoots: index.roots,
        note:
          'Every finding carries `file[:line] [scope]`. `size-not-accepted`, `size-form-wrong` and ' +
          '`field-not-accepted` are engine parse errors: the file loads with that block dropped. ' +
          '`custom-gui-contract-missing` is the null-dereference class - see docs/gui-pitfalls.md.',
      };
    },
  },

  // ------------------------------------------------------------------- web UI
  {
    name: 'gui_log_scan',
    description:
      'Read the engine\'s own logs and report what the game did, in order: every event option the player selected ' +
      '(`eventcommands.cpp:88 ... selectedOption N, human H, playerEventId P`, which is the only record of which ' +
      'control was clicked), the close-then-reopen signature read from it, and the engine\'s complaints ' +
      '(`Could not find <name> in window ...` = a missing custom_gui contract element, `Unexpected token: <field>`, ' +
      '`Wrong scope for effect`, `Event <id> has no options`, `Missing localization key [key]`). Use it before ' +
      'guessing at a symptom: several rounds of a real project were spent inferring from screenshots what this one ' +
      'line states outright.',
    inputSchema: {
      type: 'object',
      properties: {
        logs: strings('Log files or folders to scan. Defaults to <user data>/logs/game.log and .../error.log.'),
        game_log: string('A specific game.log.'),
        error_log: string('A specific error.log.'),
        documents_root: string('Stellaris user-data folder. Defaults to %USERPROFILE%\\Documents\\Paradox Interactive\\Stellaris.'),
        within_seconds: integer('How close two selections of one event must be to count as a re-open. Defaults to 3.', 1, 3600),
        limit: integer('Maximum selections returned (1-2000, default 200). Older entries are dropped first.', 1, 2000),
      },
    },
    handler: (args) => {
      const result = scanEngineLogs({
        logs: args.logs ?? [],
        gameLog: args.game_log,
        errorLog: args.error_log,
        documentsRoot: args.documents_root ?? defaultDocumentsRoot(),
        withinSeconds: args.within_seconds ?? 3,
      });
      const limit = Math.min(args.limit ?? 200, 2000);
      const selections = result.selections.slice(-limit);
      return {
        ...result,
        selectionCount: result.selections.length,
        selections,
        droppedSelections: Math.max(0, result.selections.length - selections.length),
      };
    },
  },
  {
    name: 'gui_web_ui_start',
    description:
      'Start the local drag-and-drop web UI (zero-dependency Node HTTP server) that shares this same core library. ' +
      'Lets a human drag elements, edit properties, search assets with thumbnails, run validation with highlights and ' +
      'export the files. Returns the URL to open.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        port: integer('TCP port. Defaults to 8791; if busy, the next free port is used.', 1, 65535),
        host: string('Interface to bind. Defaults to 127.0.0.1 (local only).'),
        layout_id: string('Layout to open in the page. Defaults to the most recent one.'),
        handoff_root: string(
          'Where this page session reads and writes layout submissions. Defaults to <project>/out/handoff, which is the ' +
            'area gui_handoff_list and gui_handoff_pick read. A game install, the user-data folder and a mod workspace are refused.',
        ),
      },
    },
    handler: async (args, context) => {
      if (context.webUi?.server) {
        return {
          ...context.webUi.describe(),
          alreadyRunning: true,
          note: 'The web UI was already running; this is its current address.',
        };
      }
      // `--web` is the documented way to just run the page, and that path has no layout yet.
      // Requiring gui_layout_new first made `node src/index.mjs --web` fail on a fresh process,
      // so a default window is created here instead.
      let layout;
      let id;
      if (args.layout || args.layout_id) {
        ({ layout, id } = resolveLayout(args, context));
      } else if (context.lastLayoutId && context.layouts.has(context.lastLayoutId)) {
        ({ layout, id } = resolveLayout({}, context));
      } else {
        layout = defaultLayout({ name: 'web_window' });
        id = context.nextLayoutId('web_window');
        context.layouts.set(id, { layout, createdAt: new Date().toISOString(), source: 'gui_web_ui_start (default)' });
        context.lastLayoutId = id;
      }
      const webUi = await startWebUi({
        context,
        host: args.host ?? '127.0.0.1',
        port: args.port ?? 8791,
        initialLayout: { id, layout },
        ...(args.handoff_root ? { handoffRoot: assertHandoffRoot(args.handoff_root) } : {}),
      });
      context.webUi = webUi;
      return {
        ...webUi.describe(),
        layout_id: id,
        note:
          'Open the URL in a browser. This page reads layout state from this server process, so it stays in sync with ' +
          'the MCP tools. Export from the page asks for a path and writes standalone files only.',
      };
    },
  },
  {
    name: 'gui_web_ui_stop',
    description: 'Stop the local web UI started by gui_web_ui_start.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (args, context) => {
      if (!context.webUi?.server) return { stopped: false, note: 'No web UI is running in this process.' };
      const { url } = context.webUi.describe();
      await context.webUi.close();
      context.webUi = null;
      return { stopped: true, url };
    },
  },
  {
    name: 'gui_web_ui_status',
    description: 'Report whether the local web UI is running, and at which URL.',
    inputSchema: { type: 'object', properties: {} },
    handler: (args, context) => {
      if (!context.webUi?.server) return { running: false };
      return { running: true, ...context.webUi.describe() };
    },
  },

  // ------------------------------------------------------------------- handoff (human -> agent)
  {
    name: 'gui_handoff_list',
    description:
      'List layout submissions a HUMAN made in the local web UI ("鎻愪氦缁?Agent"), newest first, with the provenance ' +
      'diff against the layout as it was LOADED, the validation verdict, and the guardrail findings. Use this after ' +
      'opening the page with gui_web_ui_start: the human drags elements and clicks Submit, and this is where that ' +
      'submission appears. `pending_only` defaults to true, so a submission an agent already picked up is not ' +
      'offered twice. A submission whose verdict is `fail`, or that carries a hard guardrail finding, is marked ' +
      '`invalid: true` in the listing AND in its own `meta.json` - it is never a new baseline by accident. Read ' +
      '`diffMarkdown`, then call gui_handoff_pick to continue editing the human\'s version.',
    inputSchema: {
      type: 'object',
      properties: {
        pending_only: boolean('Only submissions no agent has picked up yet. Defaults to true.'),
        id: string('Restrict the listing to one handoff id (or a unique suffix of its directory name).'),
        include_diff: boolean('Include each submission\'s diff.md text and guardrail findings. Defaults to true.'),
        include_layout: boolean('Also include the full submitted tree. Defaults to false; gui_handoff_pick loads it instead.'),
        limit: integer('Maximum submissions returned (1-500, default 20). Newest first.', 1, 500),
        handoff_root: string('Override the handoff directory. Defaults to <project>/out/handoff.'),
      },
    },
    handler: (args) => {
      const listed = listHandoffs({
        handoff_root: args.handoff_root,
        pending_only: args.pending_only !== false,
        include_diff: args.include_diff !== false,
        include_layout: Boolean(args.include_layout),
        limit: args.limit ?? 20,
        id: args.id,
      });
      return {
        ...listed,
        handoffRoot: listed.root,
        pendingOnly: args.pending_only !== false,
        hint:
          listed.returned > 0
            ? 'Call gui_handoff_pick with `id` to load one as the current layout, then gui_layout_validate, then gui_emit_files.'
            : 'Nothing pending. Open the page (gui_web_ui_start), edit, and press the Submit-to-agent button.',
        invalidWarning: listed.invalidCount > 0 ? `${listed.invalidCount} submission(s) are marked invalid: they carry a HARD guardrail finding (a contract name missing or mis-nested, \`close\` un-pinned, a parked element with a shortcut, a field the engine's parser rejects) or were never validated. Do not treat one as a baseline without reading the findings.` : undefined,
      };
    },
  },
  {
    name: 'gui_handoff_pick',
    description:
      'Load a submission listed by gui_handoff_list as the CURRENT layout, so the agent continues editing the human\'s ' +
      'version rather than its own. Returns the loaded layout id plus the submission\'s provenance diff, its ' +
      'validation verdict and its guardrail findings, so the agent sees what the human changed before touching it. ' +
      'Picking WRITES a `picked.json` marker into the submission: that is what turns its status to `picked` and lets ' +
      'the page\'s pending indicator show that the agent has taken it. `gui_layout_validate` and `gui_emit_files` ' +
      'then work on `layout_id` exactly as for any other layout.',
    inputSchema: {
      type: 'object',
      properties: {
        id: string('The handoff id from gui_handoff_list (a unique directory-name suffix is enough). Defaults to the newest pending submission.'),
        layout_id: string('Store the picked submission under this layout id instead of the submitted name.'),
        handoff_root: string('Override the handoff directory. Defaults to <project>/out/handoff.'),
        mark_picked: boolean('Write the picked marker so the human\'s pending indicator clears. Defaults to true.'),
      },
    },
    handler: (args, context) => {
      let id = args.id ?? null;
      let record = null;
      if (id) {
        record = loadHandoff(id, { handoff_root: args.handoff_root });
      } else {
        const listed = listHandoffs({ handoff_root: args.handoff_root, pending_only: true, include_diff: false, limit: 1 });
        if (listed.handoffs.length === 0) {
          throw new ToolError(
            `no pending handoff under ${listed.root}. A human submits one by pressing the Submit-to-agent button on ` +
              'the page (gui_web_ui_start).',
          );
        }
        record = loadHandoff(listed.handoffs[0].id, { handoff_root: args.handoff_root });
      }
      const layout = loadHandoffLayout(record.id, { handoff_root: args.handoff_root });
      const storeId = args.layout_id ?? context.nextLayoutId(layout.name ?? 'handoff');
      // The UNCHANGED submitted tree becomes the new current layout. The revision it was diffed
      // AGAINST - the layout as the human loaded it - is remembered as `previousRevision` for this
      // id, which is what the reverse feedback path needs: after the agent edits, `gui_layout_diff`
      // and the page can both show what the AGENT changed, measured from the baseline the human
      // submitted, not from a revision the agent invented.
      const baselineLayout = record.baseline ? context.layouts.get(record.baseline.id)?.layout ?? null : null;
      context.layouts.set(storeId, {
        layout,
        createdAt: new Date().toISOString(),
        source: `gui_handoff_pick (${record.id})`,
      });
      context.previousRevisions ??= new Map();
      context.previousRevisions.set(storeId, {
        id: record.baseline?.id ?? `${record.id} (as loaded)`,
        source: `the baseline of handoff ${record.id}: the layout as the human loaded it`,
        layout: baselineLayout ?? layout,
        recordedAt: new Date().toISOString(),
      });
      context.handoffs ??= new Map();
      context.handoffs.set(storeId, { id: record.id, directory: record.directory, createdAt: record.createdAt, baseline: record.baseline ?? null });
      context.lastLayoutId = storeId;
      const diffMarkdown =
        record.files?.diff && existsSync(record.files.diff) ? readFileSync(record.files.diff, 'utf8') : readFileSync(join(record.directory, 'diff.md'), 'utf8');
      const picked = args.mark_picked === false ? null : markPicked(record.id, { pickedBy: 'agent', layoutId: storeId, tool: 'gui_handoff_pick' }, { handoff_root: args.handoff_root });
      return {
        layout_id: storeId,
        handoff: {
          id: record.id,
          directory: record.directory,
          createdAt: record.createdAt,
          submittedBy: record.submittedBy,
          note: record.note ?? null,
          invalid: Boolean(record.invalid),
          flagged: Boolean(record.flagged),
          baseline: record.baseline ?? null,
          diff: record.diff ?? null,
          validation: record.validation ?? null,
          guardrails: record.guardrails ?? null,
          emitted: record.files?.emitted ?? [],
          emitError: record.emitError ?? null,
          diffMarkdown,
        },
        picked,
        ...summariseLayout(layout, storeId),
        next:
          'This is the human\'s version, now the current layout. Read `handoff.diffMarkdown` for what they changed, ' +
          'then gui_layout_validate (every contract finding must be cleared) and gui_emit_files with an explicit output_root. ' +
          'The page can show the human your changes: reload it and the layout loads with the previous revision remembered.',
      };
    },
  },
  {
    name: 'gui_layout_diff',
    description:
      'Diff two revisions of a layout, in the model\'s own vocabulary ("moved `unga_title_main` (30,22) -> (48,22)", ' +
      '"resized `unga_chart_main` 1116x300 -> 1116x320", "changed sprite of X", "added element Y"), and return the ' +
      'same markdown the handoff channel records as provenance. This is the reverse feedback path: after the agent ' +
      'edits a layout the human submitted, this is how the agent shows the human exactly what it changed. Pass ' +
      '`against` to name the revision to compare with, or omit it to use the revision this layout was created from.',
    inputSchema: {
      type: 'object',
      properties: {
        layout_id: string('The layout to describe. Defaults to the most recent one.'),
        against: string('A stored layout id to compare against (the BEFORE revision).'),
        against_layout: object('A layout tree to compare against, instead of a stored one.'),
        baseline: string('Compare against the revision this layout was created from ("previous" for the stored source revision).'),
        include_rects: boolean('Include the canonical rect of every changed element. Defaults to false.'),
        markdown: boolean('Include the markdown diff text. Defaults to true.'),
      },
    },
    handler: (args, context) => {
      const { layout, id } = resolveLayout(args, context);
      let before = null;
      let beforeId = null;
      let beforeSource = null;
      if (args.against_layout) {
        before = args.against_layout;
        beforeId = '(inline)';
        beforeSource = 'argument';
      } else if (args.against) {
        const entry = context.layouts.get(args.against);
        if (!entry) throw new ToolError(`unknown \`against\` layout id \`${args.against}\`; known ids: ${[...context.layouts.keys()].join(', ') || '(none)'}`);
        before = entry.layout;
        beforeId = args.against;
        beforeSource = 'stored layout';
      } else {
        const previous = context.previousRevisions?.get(id) ?? context.layouts.get(id)?.previous ?? null;
        if (previous?.layout) {
          before = previous.layout;
          beforeId = previous.id ?? `${id} (previous revision)`;
          beforeSource = previous.source ?? 'the revision this layout was created from';
        }
      }
      if (!before) {
        return {
          layout_id: id,
          baseline: null,
          unchanged: false,
          note:
            'no previous revision is held for this layout in this process, so there is nothing to diff against. Pass ' +
            '`against` (a stored layout id) or `against_layout` (a tree).',
          changes: [],
          counts: {},
        };
      }
      const diff = diffLayouts(before, layout, { beforeId, afterId: id });
      return {
        layout_id: id,
        against: { id: beforeId, source: beforeSource, elementCount: diff.before.elementCount, name: diff.before.name },
        changeCount: diff.changeCount,
        counts: diff.counts,
        changedPaths: diff.changedPaths,
        changes: diff.changes,
        variableChanges: diff.variableChanges,
        unchanged: diff.unchanged,
        summary: summariseDiff(diff),
        ...(args.markdown !== false ? { markdown: formatDiffMarkdown(diff, { title: `Agent changes to \`${layout.name ?? id}\`` }) } : {}),
        ...(args.include_rects
          ? {
              rects: (() => {
                const index = args.check_assets === false ? null : assets(context, args);
                const preview = renderSvg(layout, { assets: index, showGrid: false, includeTable: false, showText: false });
                const wanted = new Set(diff.changedPaths);
                return preview.table.filter((row) => wanted.has(row.path));
              })(),
            }
          : {}),
        note:
          'The same diff engine produced the provenance record the human\'s submission carries, so the agent\'s account ' +
          'of its own changes and the human\'s account of theirs are the same sentences.',
      };
    },
  },
  {
    name: 'gui_handoff_submit',
    description:
      'Write a submission into the handoff channel WITHOUT the page: the agent-side entry point for a layout an agent ' +
      'or a script wants the human to review, and the tool that makes the whole flow testable headlessly. It writes ' +
      '`<project>/out/handoff/<timestamp>-<id>/{meta.json,layout.json,diff.md,emitted/}` and records provenance: the ' +
      'diff against `baseline`, the validation verdict (pass `validate: true` to run the validator here rather than ' +
      'carry a verdict), the guardrail findings, a timestamp, a stable id, and every layout id involved. The .gui is ' +
      'written under the plugin\'s OWN output area, so the game/mods/user-data refusals still apply.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        layout_id: string('A stored layout to submit. Defaults to the most recent one.'),
        layout: object('A layout tree to submit instead of a stored one.'),
        baseline_layout_id: string('The layout id the submission should be diffed AGAINST (the revision as loaded).'),
        baseline: object('A baseline tree to diff against, instead of a stored one.'),
        submitted_by: string('Who submitted it. Defaults to "agent (gui_handoff_submit)".'),
        note: string('A free-text note recorded in meta.json and the diff header.'),
        file_stem: string('Emitted file stem. Defaults to the layout name.'),
        language: string('Localisation language for the emitted .yml. Defaults to english.'),
        emit: boolean('Write the .gui (and effects/events/localisation) under the submission\'s `emitted/`. Defaults to true.'),
        validate: boolean(
          'Run gui_layout_validate here and record its verdict, rather than leaving the submission `unvalidated`. ' +
            'Defaults to false for a stored layout that was already validated, true when no verdict is supplied.',
        ),
        handoff_root: string('Override the handoff directory. Defaults to <project>/out/handoff.'),
        apply_to: string(
          'Absolute path of the existing .gui file this layout was IMPORTED from, to PATCH that file in place as part of the ' +
            'submission. This is the same splice as `gui_emit_files { apply_to }`: only the added/changed/removed elements ' +
            'change, every comment and untouched line stays byte-identical, and a submission with no edits produces a ' +
            'byte-identical file. Without it a submission only writes the normalised `emitted/` copy, which cannot carry the ' +
            'source file\'s comments - so a submission that came from a real file SHOULD pass it. The report lands in ' +
            '`meta.apply`; a failure is recorded there rather than thrown, so the submission is never lost.',
        ),
        apply_baseline_layout_id: string(
          'Layout id of the tree as it was IMPORTED, for the `apply_to` diff. Defaults to the layout\'s remembered previous ' +
            'revision, then to the `baseline`/`baseline_layout_id` the submission already uses.',
        ),
        apply_dry_run: boolean('For `apply_to`: report the patch without writing the file. Defaults to false.'),
      },
    },
    handler: (args, context) => {
      const { layout, id } = resolveLayout(args, context);
      const discovered = discoverCustomGuiWindows({ explicit: args.custom_gui_windows ?? [], roots: args.extra_roots ?? [] });
      let baseline = args.baseline ?? null;
      let baselineId = args.baseline_layout_id ?? null;
      if (!baseline && args.baseline_layout_id) {
        const entry = context.layouts.get(args.baseline_layout_id);
        if (!entry) throw new ToolError(`unknown baseline_layout_id \`${args.baseline_layout_id}\``);
        baseline = entry.layout;
      }
      const shouldValidate = args.validate === true;
      // The tree to diff the patch AGAINST: an explicitly named import revision, else the one
      // this layout remembers ("the layout as it was loaded"), else whatever the submission is
      // being diffed against. A patch without a baseline is refused by `submitHandoff` rather
      // than silently treated as a rewrite.
      const applyBaseline =
        (args.apply_baseline_layout_id ? context.layouts.get(args.apply_baseline_layout_id)?.layout : null) ??
        // The tree recorded when this path was imported. `gui_layout_import` keeps it precisely
        // because `gui_layout_edit` overwrites the stored layout, and the page does not record a
        // previous revision at all - so this is the one that is always there.
        (args.apply_to ? baselineForPath(args.apply_to) : null) ??
        context.previousRevisions?.get(id ?? '')?.layout ??
        baseline ??
        null;
      const report = shouldValidate ? runValidation(context, layout, args, { customGuiWindows: discovered.names }) : null;
      const guardrails = scanContractViolations(layout, {
        assets: assets(context, args),
        customGuiWindows: discovered.names,
        checkLocalisation: false,
      });
      const record = submitHandoff({
        layout,
        baseline,
        layoutId: id,
        baselineLayoutId: baselineId,
        submittedBy: args.submitted_by ?? 'agent (gui_handoff_submit)',
        note: args.note,
        validation: report
          ? {
              verdict: report.verdict,
              counts: report.counts,
              byRule: report.byRule,
              guardrailVerdict: (guardrails.hard ?? []).length > 0 ? 'fail' : (guardrails.soft ?? []).length > 0 ? 'warn' : 'pass',
              assetsChecked: report.assetsChecked,
              localisationChecked: report.localisationChecked,
              buttonEffectsChecked: report.buttonEffectsChecked,
            }
          : null,
        guardrails: { byRule: guardrails.byRule, hard: guardrails.hard, soft: guardrails.soft },
        layoutIds: [id, baselineId].filter(Boolean),
        fileStem: args.file_stem,
        language: args.language,
        handoff_root: args.handoff_root,
        emit: args.emit !== false,
        ...(args.apply_to
          ? { applyTo: args.apply_to, applyBaseline, applyDryRun: args.apply_dry_run === true }
          : {}),
      });
      return {
        ...record,
        handoffRoot: HANDOFF_ROOT,
        note:
          record.invalid
            ? 'RECORDED AS INVALID: the validation verdict is `fail`, so this must not be treated as a new baseline. Read meta.json\'s validation.byRule.'
            : record.flagged
              ? 'Recorded, and flagged: it carries guardrail findings. Read meta.json\'s guardrails before using it as a baseline.'
              : 'Recorded and clean. gui_handoff_list will show it.',
      };
    },
  },
  {
    name: 'gui_handoff_status',
    description:
      'Report the handoff channel\'s state: the directory, how many submissions exist, how many are still pending (no ' +
      'agent has picked them up), how many are marked invalid, and when the newest one arrived. Cheap enough to poll.',
    inputSchema: {
      type: 'object',
      properties: {
        handoff_root: string('Override the handoff directory. Defaults to <project>/out/handoff.'),
      },
    },
    handler: (args) => {
      const stats = handoffStats({ handoff_root: args.handoff_root });
      const pending = pendingHandoffs({ handoff_root: args.handoff_root, limit: 100 });
      return {
        ...stats,
        handoffRoot: stats.root,
        pendingCount: pending.pendingCount,
        // The field is `pendingSubmissions`, not `pending`: `handoffStats` already returns `pending`
        // as a NUMBER, and spreading `...pending` over it silently replaced the count with the list.
        pendingSubmissions: pending.handoffs,
        note:
          stats.pending > 0
            ? `${stats.pending} submission(s) wait for an agent. gui_handoff_list shows their diffs; gui_handoff_pick loads one.`
            : 'Nothing pending: either nothing was submitted, or every submission has been picked up.',
      };
    },
  },

  // ------------------------------------------------------------------- state
  {
    name: 'inspect_rstellarisgui_state',
    description:
      'Report server identity, game root, whether an asset index is loaded, the stored layouts, the localisation ' +
      'index and the web UI state. Use it to see what this process is holding before calling other tools.',
    inputSchema: { type: 'object', properties: {} },
    handler: (args, context) => ({
      server: context.serverInfo,
      projectRoot: context.projectRoot,
      gameRoot: context.gameRoot,
      gameVersion: context.assetIndex?.version ?? null,
      assetIndex: context.assetIndex
        ? {
            root: context.assetIndex.root,
            spriteCount: context.assetIndex.stats.spriteCount,
            fontCount: context.assetIndex.stats.fontCount,
            containerCount: context.assetIndex.stats.containerCount,
            indexBytes: context.assetIndex.stats.indexBytes,
            fromCache: Boolean(context.assetIndex.fromCache),
          }
        : null,
      layouts: [...context.layouts.entries()].map(([id, entry]) => ({
        layout_id: id,
        name: entry.layout.name,
        source: entry.source,
        createdAt: entry.createdAt,
      })),
      lastLayoutId: context.lastLayoutId ?? null,
      localisation: context.localisation ? { keys: context.localisation.keys.size, files: context.localisation.files } : null,
      webUi: context.webUi?.describe() ?? { running: false },
      handoff: handoffStats({}),
      handoffRoot: HANDOFF_ROOT,
      protectedNames: [...PROTECTED_NAMES].sort(),
      guardRules: GUARD_DESCRIPTIONS,
      cacheRoot: cacheRoot(),
      documentsRoot: defaultDocumentsRoot(),
      baseResolution: BASE_RESOLUTION,
    }),
  },
  {
    name: 'gui_interface_inventory',
    description:
      'List what the install defines in its interface layer: the .gui and .gfx file inventories, the ' +
      'containerWindowType names a `custom_gui` can name, and the button_effects keys an `effectbuttonType` can use. ' +
      'Use it before naming a window, so you do not collide with a vanilla name.',
    inputSchema: {
      type: 'object',
      properties: {
        ...GAME_ROOT,
        ...EXTRA_ROOTS,
        kind: {
          type: 'string',
          description: 'What to list.',
          enum: ['containers', 'button_effects', 'gui_files', 'gfx_files', 'files'],
          default: 'containers',
        },
        query: string('Optional case-insensitive substring filter.'),
        limit: integer('Maximum entries (1-2000, default 100).', 1, 2000),
        refresh: boolean('Force an asset-index rebuild.'),
      },
    },
    handler: (args, context) => {
      const index = assets(context, args);
      const kind = args.kind ?? 'containers';
      const filter = args.query ? args.query.toLowerCase() : null;
      const limit = Math.min(args.limit ?? 100, 2000);
      let entries;
      if (kind === 'containers') entries = Object.entries(index.containers).map(([name, at]) => ({ name, ...at }));
      else if (kind === 'button_effects') entries = Object.entries(index.buttonEffects).map(([name, at]) => ({ name, ...at }));
      else if (kind === 'gui_files') entries = index.files.gui.map((file) => ({ file }));
      else if (kind === 'gfx_files') entries = index.files.gfx.map((file) => ({ file }));
      else
        entries = [
          ...index.files.gui.map((file) => ({ kind: 'gui', file })),
          ...index.files.gfx.map((file) => ({ kind: 'gfx', file })),
          ...index.files.buttonEffects.map((file) => ({ kind: 'button_effects', file })),
        ];
      const filtered = filter
        ? entries.filter((entry) => JSON.stringify(entry).toLowerCase().includes(filter))
        : entries;
      return {
        kind,
        total: entries.length,
        returned: Math.min(filtered.length, limit),
        entries: filtered.slice(0, limit),
        note:
          kind === 'containers'
            ? 'A `custom_gui = "<name>"` must name one of these existing containerWindowType names, or your own ' +
              'top-level container name from the .gui file you emit.'
            : kind === 'button_effects'
              ? 'An `effectbuttonType.effect` must be one of these keys, or a key you emit in common/button_effects/.'
              : 'File inventories, relative to the install root.',
      };
    },
  },
  {
    name: 'gui_knowledge_search',
    description:
      'Search the bundled Stellaris 4.4.6 GUI knowledge base: the measured rules behind this plugin - the custom_gui ' +
      'name contract, the size keyword per kind, where text metrics live, how a bar is drawn, what renders a bracket ' +
      'call literally, how a control\'s visibility is decided, and what apply_to does to a file. EVERY whitespace-separated ' +
      'term must match, so prefer two or three specific terms ("option_list EVENT_DIPLO", "spriteType size", ' +
      '"text wrap CJK"). Read the matching topic IN FULL with gui_knowledge_topic before writing any .gui or script: each ' +
      'states its evidence as a vanilla file:line, an engine log line or a measured count, and its `## 寰呯‘璁 section ' +
      'says what could NOT be established. Use this instead of guessing, and instead of grepping docs/gui-pitfalls.md.',
    inputSchema: {
      type: 'object',
      properties: {
        query: string('Terms to match. All must appear in one topic. e.g. "close option 0", "bar fill static".'),
        category: {
          type: 'string',
          description: 'Restrict to one category.',
          enum: ['contract', 'layout', 'drawing', 'text', 'script', 'tooling'],
        },
        file_type: string('Restrict to topics that apply to one file extension, e.g. ".gui" or "common/button_effects".'),
        limit: integer('Maximum topics to return (1-50, default 10).', 1, 50),
      },
      required: ['query'],
    },
    handler: async (args, context) => {
      const catalogue = await knowledgeOf(context);
      const query = requireString(args, 'query');
      let matches = catalogue.search(query);
      if (args.category) matches = matches.filter((topic) => topic.category === args.category);
      if (args.file_type) matches = matches.filter((topic) => catalogue.byFileType(args.file_type).includes(topic));
      const limit = Math.min(args.limit ?? 10, 50);
      return {
        query,
        topicCount: catalogue.topics.length,
        matchCount: matches.length,
        categoryCounts: catalogue.categoryCounts(),
        returned: Math.min(matches.length, limit),
        topics: matches.slice(0, limit).map((topic) => summariseTopic(topic)),
        note:
          matches.length === 0
            ? `No topic matches every term. The catalogue holds ${catalogue.topics.length} topics in ${Object.keys(catalogue.categoryCounts()).join(', ')}; ` +
              'try fewer terms, or `gui_knowledge_topic` with an id, or read the whole catalogue at ' +
              `${KNOWLEDGE_URI_SCHEME}/catalog.`
            : 'Each entry is a summary. Read the one you need IN FULL with gui_knowledge_topic.',
      };
    },
  },
  {
    name: 'gui_knowledge_topic',
    description:
      'Read one knowledge topic in full: the rule, the syntax, the evidence (vanilla file:line, engine log line, or a ' +
      'measured count), what enforces it, the measured counter-examples, and a `## 寰呯‘璁 section listing what could NOT ' +
      'be established. Call gui_knowledge_search first to find the id, or gui_knowledge_topic with no id to list every ' +
      'topic. This is the canonical place for the RULES; docs/gui-pitfalls.md is the canonical place for the HISTORY of ' +
      'how each rule was found.',
    inputSchema: {
      type: 'object',
      properties: {
        id: string('Topic id, e.g. "window-name-contract" or "text-has-a-size". Omit to list every topic.'),
        format: {
          type: 'string',
          description: '`markdown` (default) is the readable topic; `json` returns the structured fields only.',
          enum: ['markdown', 'json'],
          default: 'markdown',
        },
      },
    },
    handler: async (args, context) => {
      const catalogue = await knowledgeOf(context);
      const id = args.id === undefined ? null : requireString(args, 'id');
      if (id === null) {
        return {
          topicCount: catalogue.topics.length,
          categoryCounts: catalogue.categoryCounts(),
          sourceFormat: catalogue.sourceFormat,
          backend: catalogue.databaseBackend,
          catalogueUri: `${KNOWLEDGE_URI_SCHEME}/catalog`,
          topics: catalogue.topics.map((topic) => summariseTopic(topic)),
          note: 'Pass `id` to read one in full.',
        };
      }
      const topic = catalogue.topic(id);
      if (!topic) {
        return {
          error: `no knowledge topic with id \`${id}\``,
          topicCount: catalogue.topics.length,
          ids: catalogue.topics.map((entry) => entry.id),
        };
      }
      const uri = `${KNOWLEDGE_URI_SCHEME}/${topic.id}`;
      if (args.format === 'json') {
        const { source_path: sourcePath, body, ...rest } = topic;
        return { ...rest, source_path: sourcePath, body, uri };
      }
      return {
        id: topic.id,
        category: topic.category,
        title: topic.title,
        uri,
        source_path: topic.source_path,
        syntaxBlocks: topic.syntax_blocks.length,
        evidenceItems: topic.evidence.length,
        ruleItems: topic.rules.length,
        breakItems: topic.breaks.length,
        markdown: topicToMarkdown(topic, uri),
      };
    },
  },
];

/** Resolve the knowledge catalogue once per process, from the generated snapshot or the sources. */
async function knowledgeOf(context) {
  if (typeof context.loadKnowledge === 'function') {
    context.knowledgeResolved ??= await context.loadKnowledge();
    return context.knowledgeResolved;
  }
  // A caller that built a bare context (a test, or a script) can hand the catalogue over directly.
  context.knowledgeResolved ??= await context.knowledge;
  if (!context.knowledgeResolved) {
    throw new ToolError(
      'no knowledge catalogue is loaded on this server; the generated snapshot and knowledge/ are both missing',
    );
  }
  return context.knowledgeResolved;
}

/** The compact form a search result or a listing carries, so a caller can pick without reading all. */
function summariseTopic(topic) {
  return {
    id: topic.id,
    title: topic.title,
    category: topic.category,
    summary: topic.summary,
    fileTypes: topic.file_types,
    tags: topic.tags,
    verifiedVersion: topic.verified_version,
    counts: {
      syntaxBlocks: topic.syntax_blocks.length,
      evidence: topic.evidence.length,
      rules: topic.rules.length,
      breaks: topic.breaks.length,
    },
    uri: `${KNOWLEDGE_URI_SCHEME}/${topic.id}`,
    markdownFile: topic.source_path,
  };
}

function sanitise(name) {
  const stem = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return stem === '' ? 'custom_gui' : stem;
}

/** A file stem for a merged multi-window emit: drop each window's `_main`/`_window` tail. */
function mergedStem(layouts) {
  const names = layouts.map((layout) => sanitise(layout.name ?? '')).filter(Boolean);
  if (names.length === 0) return 'custom_gui';
  const shortened = names.map((name) => name.replace(/_(main|window|view|root)$/, ''));
  const [first, ...rest] = shortened;
  let common = first;
  for (const name of rest) {
    while (common !== '' && !name.startsWith(common)) common = common.slice(0, -1);
  }
  common = common.replace(/_+$/, '');
  return common.length >= 3 ? common : first;
}

/** Build the callable registry around a shared context. */
export function createToolRegistry(context) {
  const byName = new Map(TOOL_SPECS.map((spec) => [spec.name, spec]));

  return {
    specs: TOOL_SPECS,
    list() {
      return TOOL_SPECS.map((spec) => ({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
      }));
    },
    async call(name, args) {
      const spec = byName.get(name);
      if (!spec) {
        throw new Error(`unknown tool \`${name}\`; call tools/list for the available tools`);
      }
      const startedAt = Date.now();
      const result = await spec.handler(args ?? {}, context);
      context.toolLog?.record({
        tool: name,
        ok: true,
        durationMs: Date.now() - startedAt,
        arguments: summariseArguments(args),
        summary: summariseResult(result),
      });
      return result;
    },
  };
}

function summariseArguments(args) {
  if (!args || typeof args !== 'object') return null;
  const summary = {};
  for (const [key, value] of Object.entries(args)) {
    if (Array.isArray(value)) summary[key] = `[${value.length} item(s)]`;
    else if (typeof value === 'string' && value.length > 160) summary[key] = `${value.slice(0, 160)}...`;
    else if (value && typeof value === 'object') summary[key] = `{${Object.keys(value).slice(0, 12).join(',')}}`;
    else summary[key] = value;
  }
  return summary;
}

function summariseResult(result) {
  if (result === null || result === undefined) return null;
  if (result.__mcpContent) return JSON.stringify({ mcpContentBlocks: result.__mcpContent.map((block) => block.type) });
  if (typeof result !== 'object') return String(result).slice(0, 400);
  return JSON.stringify({
    keys: Object.keys(result).slice(0, 16),
    ...(result.verdict ? { verdict: result.verdict } : {}),
    ...(result.counts ? { counts: result.counts } : {}),
    ...(result.fileCount !== undefined ? { fileCount: result.fileCount } : {}),
    ...(result.resultCount !== undefined ? { resultCount: result.resultCount } : {}),
    ...(result.layout_id ? { layout_id: result.layout_id } : {}),
    ...(result.output_root ? { output_root: result.output_root } : {}),
  });
}

export { writePreview, isAbsolute, readdirSync, statSync, findNode, describeLocalisationIndex };
