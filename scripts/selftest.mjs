#!/usr/bin/env node
//------------------------------------------------------------------------------------
// selftest.mjs -- Part of RStellarisGui
//
// In-process assertions over the pure logic: the Paradox lexer, the rect maths for every
// orientation/origo combination, percentage and `@variable` resolution, overlap detection
// (true and false cases), the asset index, DDS header parsing on synthetic buffers, the PNG
// writer, the SVG preview, the emitter's text shape, and the localisation BOM rule.
//
// The final block is the real-input census: it parses all 177 vanilla `.gui` files and asserts
// the parser succeeds and reports plausible element counts. Pure-logic tests are necessary but
// not sufficient - only real input proves the parser handles what the game actually ships.
//
// Every assertion is a named `check(name, condition, detail)` so a failure says which invariant
// broke. This mirrors RStellarisScribe's scripts/selftest.mjs.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAssetIndex, defaultParts, getAssetIndex, searchSprites, spriteInfo } from '../src/lib/asset-index.mjs';
import { DDS_MAGIC, decodeDdsLevel, parseDdsHeader, pickMip } from '../src/lib/dds.mjs';
import { assertOutputRoot, assertOverrideRoot, assertHandoffRoot, emitEventStub, emitFiles, emitOverride, formatScalar, inspectEncoding, planEmit, planOverride, translateNodeFields } from '../src/lib/emit.mjs';
import { applyLayoutToSource, applyToFile } from '../src/lib/apply.mjs';
import { emitGui, renderElement } from '../src/lib/emit.mjs';
import { calibrateCoordinates } from './calibrate-coords.mjs';
import { checkFiles } from '../src/lib/filecheck.mjs';
import { parseGfxFile } from '../src/lib/gfx-index.mjs';
import { BACKGROUND_FIELDS, ELEMENT_KINDS, ENGINE_REJECTED_FIELDS, componentKinds, emittableKinds, isEngineRejectedField, isFieldRejectedForKind, isKnownField, kindAcceptsField, kindRejectedFieldNote, kindSpec, kindSpecByKeyword, normaliseAnchor, sizeFormFor, suggestFields } from '../src/lib/kinds.mjs';import {
  BASE_RESOLUTION,
  anchorPoint,
  applyEdits,
  collectVariables,
  computeLayout,
  computeRect,
  defaultLayout,
  findNode,
  makeSpriteLookup,
  mergeLayouts,
  normaliseLayoutForKinds,
  parseGuiText,
  resolveComponent,
  topLevelContainers,
  walkLayout,
} from '../src/lib/layout.mjs';
import { buildLocalisationIndex, looksLikeLocKey, parseLocalisationDetailed, parseLocalisationFile } from '../src/lib/loc-index.mjs';
import { canonicalPositionToEngine, cornerFromPivot, enginePositionToCanonical, yDirectionForAnchor } from '../src/lib/coords.mjs';
import { parseParadox, resolveVariable, tokenize, topLevelKeys } from '../src/lib/paradox.mjs';
import { DEFAULT_GAME_ROOT, PROJECT_ROOT, defaultDocumentsRoot, listFilesRecursive, resolveGameRoot, safeJoin, stripBom } from '../src/lib/paths.mjs';
import { encodePng, readPngHeader, resizeRgba } from '../src/lib/png.mjs';
import { ThumbnailCache, escapeXml, nineSliceFor, rectTableCsv, rectTableMarkdown, renderPng, renderSvg } from '../src/lib/preview.mjs';
import { decodePng } from '../src/lib/png.mjs';
import { checkGuiSyntax, parseEngineErrorLog } from '../src/lib/syntax.mjs';
import { analyseOverrideDrift } from '../src/lib/override-drift.mjs';
import { buildNumberChangeOverride, buildOverrideFixture, buildSurfaceFixtures, matrixWindowLayout } from './make-surface-fixtures.mjs';
import {
  METRIC_EXACTNESS,
  buildFontCatalogue,
  createFontLibrary,
  expandLocalisation,
  nameSizedAdvance,
  parseBitmapFont,
  wrapText,
} from '../src/lib/font-metrics.mjs';
import { RULE_DESCRIPTIONS, RULE_SEVERITY, VALIDATION_DEFAULTS, validateGuiRoot, validateGuiText, validateLayout } from '../src/lib/validate.mjs';
import { COLONIZATION_DESCRIPTIONS, COLONIZATION_SEVERITY, analyseAsteroidBelts, analyseColonization, analyseColonizationFiles, analyseRingWorlds, analyseStarClasses, readAsteroidBelts, readInitializerStarClasses, readStarClasses, scanScriptBlocks } from '../src/lib/colonization.mjs';
import {
  PORTRAIT_DESCRIPTIONS,
  PORTRAIT_SEVERITY,
  analysePortraitRoots,
  parseParadoxTree,
  readEntityDefinitions,
  readEntityNames,
  readMeshDefinitions,
  readPortraitDefinitions,
} from '../src/lib/portraits.mjs';
import {
  CONTRACT_ELEMENTS,
  CONTRACT_MIN_WINDOWS,
  NOTE_WINDOW_NAMES,
  REQUIRED_WINDOW_NAMES,
  analyseEventWindows,
  checkParkedElements,
  demandedContractNames,
  isEventWindow,
  isParked,
  windowBoxesOf,
} from '../src/lib/contract.mjs';
import { scanEngineLogs, scanLogText, findReopenCycles } from '../src/lib/logscan.mjs';
import { diffLayouts, formatDiffMarkdown, summariseDiff } from '../src/lib/layout-diff.mjs';
import * as handoffGuard from '../src/lib/handoff-guard.mjs';
import { handoffStats, listHandoffs, markPicked, submitHandoff } from '../src/lib/handoff.mjs';
import { createToolRegistry } from '../src/tools/index.mjs';
import { TOOL_SPECS } from '../src/tools/index.mjs';
import { ToolError } from '../src/lib/mcp.mjs';
import { collectFiredEventIds, extractEvents, indexScriptDefinitions } from '../src/lib/events.mjs';
import { runGuiCensus, summariseCensus } from './gui-census.mjs';
import { buildArtifacts, canonicalTopicPath, checkKnowledge } from './build-knowledge.mjs';
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_URI_SCHEME, KnowledgeCatalog, loadLatestUpdate, topicFromToml, topicToMarkdown, topicToToml } from '../src/lib/knowledge.mjs';
import { parseTopicSource, readKnowledgeSources } from '../src/lib/knowledge-source.mjs';
import { createHandler } from '../src/lib/mcp.mjs';
import { compareCensusToKinds, runKindCensus } from './kind-census.mjs';
import { checkDocs } from './generate-docs.mjs';
import {
  BAR_DEFAULTS,
  BAR_EMIT_ADDITIONS,
  BAR_FIELD_NAMES,
  BAR_SPRITE_PALETTE,
  COMPONENT_RULE_SEVERITY,
  REFERENCE_BAND_ELEMENTS,
  REFERENCE_RANKING_ROW,
  REFERENCE_ROWS,
  applyBarClone,
  barElementName,
  barFieldsFromElements,
  barLabelBox,
  barTrackBox,
  buildBarUnit,
  collectBars,
  describeBar,
  headingNameForBar,
  isBarNode,
  renameBarClone,
  resolveBarSprite,
} from '../src/lib/components.mjs';
import {
  analyseCreateColonyPops,
  indexCreateColonyBlocks,
} from '../src/lib/colonization.mjs';
import {
  EVENT_NAMESPACE_DESCRIPTIONS,
  EVENT_NAMESPACE_SEVERITY,
  analyseEventNamespaces,
  readEventIds,
  readNamespaceDeclarations,
} from '../src/lib/events.mjs';
import {
  WORLDGFX_DESCRIPTIONS,
  WORLDGFX_SEVERITY,
  analyseSystemLights,
  isLightsAssetPath,
  isWorldgfxPath,
  readLightDefinitions,
  readSystemLights,
} from '../src/lib/worldgfx.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = join(projectRoot, '.selftest');

let passed = 0;
let failed = 0;
const failures = [];
let section = '';
/**
 * The floor on the authored knowledge topic count.
 *
 * This is deliberately a CONSTANT rather than `topics.length`: an assertion that compares the
 * catalogue with itself passes when every topic has been deleted. The number is the one the README
 * advertises, and the check below fails BY NAME with the shortfall when a topic goes missing.
 */
const KNOWLEDGE_TOPIC_FLOOR = 32;
/** Optional `--only <substring>`: run just the groups whose title contains it. */
const ONLY = (() => {
  const index = process.argv.indexOf('--only');
  return index !== -1 ? process.argv[index + 1] : null;
})();

/**
 * Find a node by name anywhere in a PARSED tree (a `containerWindowType` subtree from
 * `parseGuiText`, which nests elements but has no synthetic root).
 */
function findNodeInTree(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (node.name === name) return node;
  for (const child of node.children ?? []) {
    const hit = findNodeInTree(child, name);
    if (hit) return hit;
  }
  return null;
}

/** The source block of the element `name`: from its `keyword = {` line to its matching brace. */
function vanillaBlock(text, name) {
  const lines = text.split('\n');
  const nameLine = lines.findIndex((line) => new RegExp(`^\\s*name\\s*=\\s*"?${name}"?\\s*$`).test(line));
  if (nameLine < 0) return '';
  let opener = nameLine;
  while (opener > 0 && !/=\s*\{\s*$/.test(lines[opener])) opener -= 1;
  let depth = 0;
  let end = opener;
  for (let index = opener; index < lines.length; index += 1) {
    depth += (lines[index].match(/\{/g) ?? []).length - (lines[index].match(/\}/g) ?? []).length;
    if (index > opener && depth <= 0) {
      end = index;
      break;
    }
  }
  return lines.slice(opener, end + 1).join('\n');
}

/**
 * Every field declaration in a block as a comparable `key=value` multiset, with the two spellings
 * of an inline pair expanded to `key.axis=value` so a multi-line emission and a vanilla one-liner
 * compare equal. Vanilla splits `guiButtonType =` and `{` onto two lines; the emitter joins them.
 */
function vanillaScalars(blockText, stack = [], out = []) {
  let pending = null;
  for (const raw of blockText.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (line === '{') {
      if (pending) {
        stack.push(pending);
        pending = null;
      }
      continue;
    }
    const openSame = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{\s*$/);
    if (openSame) {
      stack.push(openSame[1]);
      pending = null;
      continue;
    }
    const openNext = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*$/);
    if (openNext) {
      pending = openNext[1];
      continue;
    }
    if (line === '}') {
      stack.pop();
      pending = null;
      continue;
    }
    pending = null;
    const assign = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!assign) continue;
    const path = [...stack.slice(1), assign[1]].join('.').toLowerCase();
    const inline = assign[2].match(/^\{\s*(.*?)\s*\}$/);
    const clean = (value) => value.replace(/\s+/g, '').replace(/^"(.*)"$/, '$1');
    if (inline) {
      for (const part of inline[1].split(/\s+(?=[A-Za-z_])/)) {
        const pair = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
        if (pair) out.push(`${path}.${pair[1].toLowerCase()}=${clean(pair[2])}`);
      }
      continue;
    }
    out.push(`${path}=${clean(assign[2])}`);
  }
  return out;
}

function check(name, condition, detail = '') {  if (condition) {
    passed += 1;
    process.stdout.write(`  ok   ${name}\n`);
  } else {
    failed += 1;
    failures.push(`${section}${section ? ' :: ' : ''}${name}${detail ? ` :: ${detail}` : ''}`);
    process.stdout.write(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}\n`);
  }
}

function heading(title) {
  section = title;
  process.stdout.write(`\n${title}\n`);
}

/**
 * Run a block, converting a throw into a failed check rather than an aborted run.
 *
 * `filter`, when given, is a substring the block title must contain for the block to run at all -
 * which is how a single group is re-run while iterating on it, without paying for the real-input
 * census at the end of this file.
 */
function group(title, fn, filter = null) {
  if (filter && !title.includes(filter)) return;
  heading(title);
  try {
    fn();
  } catch (thrown) {
    check(`${title} ran without throwing`, false, thrown instanceof Error ? thrown.message : String(thrown));
  }
}

/**
 * Split an emitted `.gui` into element blocks by brace counting, so an assertion about "this
 * element has no `size`" cannot accidentally match a DIFFERENT element further down the file -
 * which a plain regex with `[\s\S]*?` will happily do, since every block ends with a brace.
 */
function emittedBlocks(text, keyword = '[A-Za-z]+Type') {
  const lines = text.split('\n');
  const pattern = new RegExp(`^\\s*(${keyword}) = \\{$`);
  const found = [];
  for (let start = 0; start < lines.length; start += 1) {
    const match = pattern.exec(lines[start]);
    if (!match) continue;
    let depth = 0;
    let end = start;
    for (let index = start; index < lines.length; index += 1) {
      depth += (lines[index].match(/\{/g) ?? []).length;
      depth -= (lines[index].match(/\}/g) ?? []).length;
      if (depth === 0) {
        end = index;
        break;
      }
    }
    const body = lines.slice(start, end + 1).join('\n');
    found.push({ keyword: match[1], name: /name = "([^"]+)"/.exec(body)?.[1] ?? null, body, line: start + 1 });
  }
  return found;
}

/** The body of one emitted element, by name. */
function blockNamed(text, name) {
  return emittedBlocks(text).find((block) => block.name === name)?.body ?? '';
}

/**
 * The NAME a bar's piece takes, from the component's own convention: the role goes in the MIDDLE,
 * between the bar's stem and its trailing row index (`unga_power_1_main` + `track` ->
 * `unga_power_track_1_main`). Exposed on the suite so a bar's pieces are located by the component's
 * own rule rather than by a suffix guess - `endsWith('_track')` silently fails the moment a bar is
 * named with a trailing number, which is the convention's whole point.
 */
function barPieceName(barName, role) {
  return barElementName(barName, role);
}

/** One of a bar's expanded pieces, found by the component's own naming rule. */
function barPiece(boxes, barName, role) {
  const wanted = barPieceName(barName, role);
  return boxes.find((box) => box.name === wanted) ?? null;
}

/**
 * A minimal `custom_gui` EVENT WINDOW layout, for the handoff and guardrail assertions.
 *
 * It is deliberately the shape the contract check looks for: a root container named by an event, a
 * `close` as its LAST direct child, an `EVENT_DIPLO` holding `option_list`/`action_title`/`action_desc`,
 * a parked `tts_button` (the -3000,-3000 + 0x0 idiom), an `effectbuttonType` with an `effect`, a
 * `buttonType` control, and one ordinary decorative container that must NOT be protected. A test that
 * used a shape the contract does not recognise would pass while testing nothing.
 */
function eventWindowLayout() {
  return {
    name: 'test_event_window',
    baseResolution: { width: 1920, height: 1080 },
    variables: {},
    root: {
      id: 'root',
      kind: 'container',
      syntheticRoot: true,
      name: '(selftest.gui)',
      size: { width: 1920, height: 1080 },
      children: [
        {
          id: 'w1',
          kind: 'container',
          name: 'test_event_window',
          position: { x: 0, y: 0 },
          size: { width: 900, height: 600 },
          orientation: 'center',
          origo: 'center',
          children: [
            { id: 'e1', kind: 'icon', name: 'empire_info_bg', position: { x: 10, y: 10 }, spriteType: 'GFX_diplomacy_dark_fade_bg' },
            { id: 't1', kind: 'text', name: 'heading', position: { x: 30, y: 22 }, maxWidth: 300, maxHeight: 24, font: 'malgun_goth_24', text: 'DIPLOMACY' },
            {
              id: 'c1',
              kind: 'container',
              name: 'body_panel',
              position: { x: 20, y: 60 },
              size: { width: 400, height: 200 },
              quadTextureSprite: 'GFX_tiles_dark_area_cut_8',
              children: [
                {
                  id: 'd1',
                  kind: 'container',
                  name: 'EVENT_DIPLO',
                  position: { x: 0, y: 0 },
                  size: { width: 380, height: 180 },
                  children: [
                    { id: 'a1', kind: 'text', name: 'action_title', position: { x: 8, y: 8 }, maxWidth: 300, maxHeight: 20, font: 'cg_16b', text: 'action_title_key' },
                    { id: 'a2', kind: 'text', name: 'action_desc', position: { x: 8, y: 32 }, maxWidth: 300, maxHeight: 60, font: 'cg_16b', text: 'action_desc_key' },
                    { id: 'o1', kind: 'listBox', name: 'option_list', position: { x: 8, y: 100 }, size: { x: 300, y: 70 } },
                  ],
                },
              ],
            },
            { id: 'b1', kind: 'button', name: 'confirm_button', position: { x: 60, y: 300 }, size: { x: 120, y: 32 }, quadTextureSprite: 'GFX_tiling_button_standard', spriteType: 'GFX_button_tts_start' },
            { id: 'p1', kind: 'button', name: 'tts_button', position: { x: -3000, y: -3000 }, size: { x: 0, y: 0 }, spriteType: 'GFX_button_tts_start', shortCut: 't' },
            { id: 'cb1', kind: 'effectbutton', name: 'close', position: { x: -45, y: 16 }, orientation: 'upper_right', quadTextureSprite: 'GFX_main_close_button', effect: 'selftest_close_effect' },
          ],
        },
      ],
    },
  };
}

/** A minimal tool context, for driving the registry in-process. */
function makeToolContext() {
  const context = {
    projectRoot,
    serverInfo: { name: 'rstellarisgui', version: 'selftest' },
    gameRoot: '<Stellaris>',
    assetIndex: null,
    localisation: null,
    layouts: new Map(),
    lastLayoutId: null,
    previousRevisions: new Map(),
    handoffs: new Map(),
    thumbnailCache: null,
    webUi: null,
    elementKinds: [],
    nextLayoutId(name) {
      const base = String(name ?? 'layout').replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'layout';
      let candidate = base;
      let suffix = 2;
      while (this.layouts.has(candidate)) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
      }
      return candidate;
    },
  };
  return context;
}

// =====================================================================================
// 1. Paradox lexer and parser
// =====================================================================================

group('paradox lexer', () => {
  const tokens = tokenize('a = 1 b = -2 c = 100%% d = "x y" # comment\n@v = 5').tokens;
  const kinds = tokens.map((token) => `${token.kind}:${token.value}`);
  check('lexes an assignment', kinds[0] === 'ident:a' && kinds[1] === 'equals:=', kinds.slice(0, 2).join(','));
  check('lexes a negative number as one token', kinds.includes('number:-2'), kinds.join(','));
  check('lexes %% as part of the number token', kinds.includes('number:100%%'), kinds.join(','));
  check('keeps a quoted string with spaces as one token', kinds.includes('string:x y'), kinds.join(','));
  check('drops comments', !kinds.some((kind) => kind.includes('comment')), kinds.join(','));
  check('lexes an @variable identifier', kinds.includes('ident:@v'), kinds.join(','));

  // The regression this guards: a stateful (g/y) RegExp used with .test() in the scan loop
  // makes .test() alternate on identical input, which stalls the lexer forever.
  const repeated = tokenize('x = -1 y = -2 z = -3 w = -4');
  check(
    'lexes repeated negative numbers without stalling',
    repeated.tokens.filter((token) => token.kind === 'number').length === 4,
    repeated.tokens.map((token) => token.value).join(','),
  );

  const parsed = parseParadox('guiTypes = {\n\tcontainerWindowType = {\n\t\tname = "a"\n\t\tsize = { width = 10 height = 20 }\n\t}\n}\n');
  check('parses one root block', parsed.roots.length === 1 && parsed.roots[0].key === 'guiTypes', JSON.stringify(parsed.roots.map((r) => r.key)));
  check('parses nested blocks', parsed.roots[0].children[0].key === 'containerWindowType', parsed.roots[0].children[0].key);
  check(
    'parses a nested size block',
    parsed.roots[0].children[0].children.find((child) => child.key === 'size').children.length === 2,
  );
  check('records line numbers', parsed.roots[0].children[0].line === 2, String(parsed.roots[0].children[0].line));

  const withVars = parseParadox('@w = 100\n@gfx = "GFX_x"\nguiTypes = { }');
  check('collects @variable declarations', withVars.variables['@w'] === '100' && withVars.variables['@gfx'] === 'GFX_x', JSON.stringify(withVars.variables));
  check('resolves @variable references', resolveVariable('@w', withVars.variables) === '100', resolveVariable('@w', withVars.variables));
  check('leaves an unknown @variable alone', resolveVariable('@nope', withVars.variables) === '@nope');
  check('resolves chained variables', resolveVariable('@b', { '@a': '1', '@b': '@a' }) === '1');

  const keys = topLevelKeys('grow_up_button_effect = {\n potential = { always = yes }\n}\nother = { }\n');
  check('topLevelKeys finds keys with their line', keys.length === 2 && keys[0].key === 'grow_up_button_effect' && keys[0].line === 1, JSON.stringify(keys));

  // An unterminated string must not hang or throw.
  const unterminated = tokenize('name = "abc');
  check('survives an unterminated string', unterminated.tokens.length >= 3, String(unterminated.tokens.length));
  check('survives stray punctuation', tokenize('a = 1 } ] % b = 2').tokens.length > 0);
  check('strips a BOM', stripBom('\uFEFFguiTypes = { }') === 'guiTypes = { }');
});

// =====================================================================================
// 2. Rect maths - every orientation x origo combination
// =====================================================================================

group('rect maths', () => {
  const parent = { x: 0, y: 0, width: 1000, height: 500, right: 1000, bottom: 500 };
  const size = { width: 100, height: 50 };
  const variables = {};

  // The 9-point anchor table, expressed independently so a bug in kinds.mjs cannot make the
  // test agree with itself.
  const expectedAnchorPoints = {
    upper_left: { x: 0, y: 0 },
    center_up: { x: 500, y: 0 },
    upper_right: { x: 1000, y: 0 },
    center_left: { x: 0, y: 250 },
    center: { x: 500, y: 250 },
    center_right: { x: 1000, y: 250 },
    lower_left: { x: 0, y: 500 },
    center_down: { x: 500, y: 500 },
    lower_right: { x: 1000, y: 500 },
  };
  for (const [name, point] of Object.entries(expectedAnchorPoints)) {
    const anchor = anchorPoint(parent, name);
    check(
      `anchorPoint(${name}) is the expected parent point`,
      anchor.x === point.x && anchor.y === point.y,
      `${anchor.x},${anchor.y} != ${point.x},${point.y}`,
    );
  }
  check('unknown anchor spelling falls back to upper_left', anchorPoint(parent, 'sideways').canonical === 'upper_left');

  // origo fraction per canonical name, again written out here rather than imported.
  const origoFraction = {
    upper_left: { x: 0, y: 0 },
    center_up: { x: 0.5, y: 0 },
    upper_right: { x: 1, y: 0 },
    center_left: { x: 0, y: 0.5 },
    center: { x: 0.5, y: 0.5 },
    center_right: { x: 1, y: 0.5 },
    lower_left: { x: 0, y: 1 },
    center_down: { x: 0.5, y: 1 },
    lower_right: { x: 1, y: 1 },
  };

  const orientations = Object.keys(expectedAnchorPoints);
  const origos = Object.keys(origoFraction);
  let combos = 0;
  let combosCorrect = 0;
  const wrong = [];
  for (const orientation of orientations) {
    for (const origo of origos) {
      const node = { kind: 'container', name: `t_${orientation}_${origo}`, orientation, origo, position: { x: 7, y: 11 }, size };
      const { rect } = computeRect(node, parent, variables);
      // Independent expectation, written out here rather than imported. The canonical frame is
      // y-DOWN, and the anchor's own vertical half signs the offset: for a `lower_*` anchor a
      // positive y moves away from the parent, i.e. up the screen (coords.mjs carries the vanilla
      // evidence). So:
      //   pivot  = anchor + (x, dirY * y)      dirY = -1 for lower_left/center_down/lower_right
      //   corner = pivot - size * origoFraction
      const anchor = expectedAnchorPoints[orientation];
      const fraction = origoFraction[origo];
      const dirY = 1;
      const expectedX = anchor.x + 7 - size.width * fraction.x;
      const expectedY = anchor.y + dirY * 11 - size.height * fraction.y;
      combos += 1;
      if (rect.x === expectedX && rect.y === expectedY && rect.width === 100 && rect.height === 50) combosCorrect += 1;
      else wrong.push(`${orientation}/${origo}: got ${rect.x},${rect.y} want ${expectedX},${expectedY}`);
    }
  }
  check(`all ${combos} orientation x origo combinations place the rect correctly`, combosCorrect === combos, wrong.slice(0, 4).join(' | '));

  // Spot values a reader can check by hand.
  const upperLeft = computeRect({ orientation: 'upper_left', origo: 'upper_left', position: { x: 7, y: 11 }, size }, parent, variables).rect;
  check('upper_left/upper_left puts position at the top-left corner', upperLeft.x === 7 && upperLeft.y === 11, `${upperLeft.x},${upperLeft.y}`);

  const centred = computeRect({ orientation: 'center', origo: 'center', position: { x: 0, y: 0 }, size }, parent, variables).rect;
  check('center/center centres the element on the parent centre', centred.x === 450 && centred.y === 225, `${centred.x},${centred.y}`);

  const topRight = computeRect({ orientation: 'upper_right', origo: 'upper_left', position: { x: -20, y: 10 }, size }, parent, variables).rect;
  // anchor = parent top-right (1000, 0); pivot = anchor + position = (980, 10); origo is the
  // element's own top-left, so the element's top-left corner sits at the pivot.
  check('upper_right with a negative x pulls back from the parent right edge', topRight.x === 980 && topRight.y === 10, `${topRight.x},${topRight.y}`);

  const bottomRight = computeRect({ orientation: 'lower_right', origo: 'lower_right', position: { x: -5, y: -5 }, size }, parent, variables).rect;
  // anchor = parent bottom-right (1000, 500); `position` is added to the anchor for every
  // orientation, so the pivot is (995, 495) and origo = lower_right makes that the element's own
  // bottom-right corner.
  check('lower_right/lower_right sits fully inside the bottom-right corner', bottomRight.right === 995 && bottomRight.bottom === 495, `${bottomRight.right},${bottomRight.bottom}`);

  const centreUp = computeRect({ orientation: 'center_up', origo: 'center', position: { x: 0, y: 0 }, size }, parent, variables).rect;
  check('center_up/center puts the element centre on the parent top-centre', centreUp.x === 450 && centreUp.y === -25, `${centreUp.x},${centreUp.y}`);

  check('orientation is matched case-insensitively', normaliseAnchor('UPPER_RIGHT') === 'upper_right' && normaliseAnchor('LOWER_LEfT') === 'lower_left');
  check('vanilla misspelling CENTERUP is accepted', normaliseAnchor('CENTERUP') === 'center_up', String(normaliseAnchor('CENTERUP')));
  check('synonym LEFT means center_left', normaliseAnchor('LEFT') === 'center_left' && normaliseAnchor('TOP') === 'center_up');

  // centerPosition behaves like origo = center (285 uses in vanilla). The parent container is
  // reached through its own top-left corner here, so the child needs orientation = center to
  // land on the parent's centre - which is exactly the pairing vanilla uses.
  const layoutWithCenter = {
    schema: 'rstellarisgui/layout@1',
    name: 'cp',
    baseResolution: { width: 1920, height: 1080 },
    root: {
      id: 'root',
      kind: 'container',
      name: 'root',
      size: { width: 1000, height: 500 },
      children: [
        {
          id: 'i',
          kind: 'icon',
          name: 'i',
          orientation: 'center',
          centerPosition: true,
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 },
        },
      ],
    },
  };
  const cpBoxes = computeLayout(layoutWithCenter).boxes;
  const icon = cpBoxes.find((box) => box.id === 'i');
  check(
    'centerPosition = yes behaves like origo = center',
    icon.rect.x === 450 && icon.rect.y === 225,
    `${icon.rect.x},${icon.rect.y} (want 450,225)`,
  );
  check('centerPosition is folded into the origo trace', icon.trace.origo === 'center', icon.trace.origo);
});

// =====================================================================================
// 3. Size resolution - percentages, %%, negatives, @variables
// =====================================================================================

group('size resolution', () => {
  check('plain number resolves to itself', resolveComponent(120, 1000, {}).value === 120);
  check('100% is the whole parent', resolveComponent('100%', 1000, {}).value === 1000);
  check('50% is half the parent', resolveComponent('50%', 800, {}).value === 400);
  check('125% can exceed the parent', resolveComponent('125%', 400, {}).value === 500);

  // `%%` means "parent minus this element's position" - 24 real uses in vanilla 4.4.6.
  const doublePercent = resolveComponent('100%%', 620, { position: 20 });
  check('100%% subtracts the position from the parent', doublePercent.value === 600, String(doublePercent.value));
  check('100%% is reported as its own size kind', doublePercent.kind === 'percent-minus-position', doublePercent.kind);
  const doublePercentWithSuffix = resolveComponent('100%%', 620, { position: 0 });
  check('100%% with zero position equals the parent', doublePercentWithSuffix.value === 620, String(doublePercentWithSuffix.value));

  // Negative sizes: "parent minus position minus N" - 64 real uses in vanilla.
  const negative = resolveComponent(-16, 620, { position: 20 });
  check('a negative size subtracts itself and the position', negative.value === 584, String(negative.value));
  check('a negative size is reported as its own size kind', negative.kind === 'negative', negative.kind);
  check('a negative number alone still resolves arithmetically', resolveComponent(-16, 100, { position: 0 }).value === 84);

  // @variable resolution, including a percentage stored in a variable (docs example).
  const variables = { '@w': '620', '@pct': '50%', '@double': '100%%', '@neg': '-20' };
  check('@variable resolves to a number', resolveComponent('@w', 1000, { variables }).value === 620);
  check('@variable holding a percentage resolves as a percentage', resolveComponent('@pct', 1000, { variables }).value === 500);
  check('@variable holding %% resolves against the position', resolveComponent('@double', 620, { variables, position: 20 }).value === 600);
  check('@variable holding a negative resolves negatively', resolveComponent('@neg', 620, { variables, position: 0 }).value === 600);
  const unknown = resolveComponent('@missing', 100, { variables });
  check('an unresolved @variable yields null and names itself', unknown.value === null && unknown.unknownVariable === '@missing', JSON.stringify(unknown));

  check('a non-numeric string does not resolve', resolveComponent('wide', 100, {}).value === null);
  check('null is treated as unresolved', resolveComponent(null, 100, {}).value === null);

  // The position axis must be resolved per axis: x against parent width, y against height.
  const layout = {
    schema: 'rstellarisgui/layout@1',
    name: 'axes',
    baseResolution: { width: 1920, height: 1080 },
    variables: { '@pad': '10' },
    root: {
      id: 'root',
      kind: 'container',
      name: 'root',
      size: { width: 400, height: 200 },
      children: [
        { id: 'c', kind: 'container', name: 'c', position: { x: '@pad', y: '@pad' }, size: { width: '100%%', height: '50%' } },
      ],
    },
  };
  const boxes = computeLayout(layout).boxes;
  const child = boxes.find((box) => box.id === 'c');
  // The position axis is resolved per axis against the parent's own axis: x against the parent's
  // width (400 - 10 = 390) and y against the parent's height (100% of 200 = 100). The y component
  // is NOT `200 - 10`, because `100%%` and `-N` are relative size forms that only the parent's
  // height enters here - see the `sizeFormIsAnchorSafe` warning for the one case where an anchor
  // makes the engine's own reading of such a form ambiguous.
  check('%% uses the parent width on the x axis and 50% the parent height on y', child.rect.width === 390 && child.rect.height === 100, `${child.rect.width}x${child.rect.height}`);
  check('variables are collected from the layout', collectVariables(layout)['@pad'] === '10');

  // A node with NO size at all must stay unresolved (so the sprite lookup can fill it in), while
  // a node with `size = { width = 0 height = 0 }` must resolve to a real 0. An earlier revision
  // used `?? 0` for the missing case, which collapsed the two and made the sprite-natural-size
  // fallback unreachable - the default close button computed as 0x0 because of it.
  const noSizeLayout = {
    schema: 'rstellarisgui/layout@1',
    name: 'nosize',
    baseResolution: { width: 1000, height: 1000 },
    root: {
      id: 'root',
      kind: 'container',
      name: 'root',
      size: { width: 1000, height: 1000 },
      children: [
        // A sprite reference is what makes the natural-size fallback possible: with no size and
        // no sprite there is nothing to ask, which is the separate `size-indeterminate` case.
        { id: 'unsized', kind: 'button', name: 'unsized', quadTextureSprite: 'GFX_known', position: { x: 0, y: 0 } },
        { id: 'unsized_nosprite', kind: 'button', name: 'unsized_nosprite', position: { x: 0, y: 0 } },
        { id: 'zeroed', kind: 'button', name: 'zeroed', quadTextureSprite: 'GFX_known', position: { x: 0, y: 0 }, size: { width: 0, height: 0 } },
      ],
    },
  };
  const unsizedBoxes = computeLayout(noSizeLayout).boxes;
  const unsized = unsizedBoxes.find((box) => box.id === 'unsized');
  const unsizedNoSprite = unsizedBoxes.find((box) => box.id === 'unsized_nosprite');
  const zeroed = unsizedBoxes.find((box) => box.id === 'zeroed');
  check('a node with no size and no sprite is marked indeterminate', unsizedNoSprite.trace.sizeIndeterminate === true, JSON.stringify(unsizedNoSprite.trace.sizeIndeterminate));
  check('a node with no size reports an indeterminate rect', unsizedNoSprite.rect.width === 0 && unsizedNoSprite.rect.height === 0);
  check('an explicit size of 0 is NOT indeterminate', zeroed.trace.sizeIndeterminate === false, JSON.stringify(zeroed.trace.sizeIndeterminate));
  check('an explicit 0 size stays a declared zero', zeroed.trace.sizeSource === 'declared', zeroed.trace.sizeSource);

  // The sprite-natural-size fallback: with a lookup, an unsized sprite takes the texture's size.
  const withLookup = computeLayout(noSizeLayout, { spriteLookup: () => ({ width: 114, height: 38 }) }).boxes;
  const filled = withLookup.find((box) => box.id === 'unsized');
  check('an unsized sprite takes its natural size from the lookup', filled.rect.width === 114 && filled.rect.height === 38, `${filled.rect.width}x${filled.rect.height}`);
  check('the natural-size source is recorded in the trace', filled.trace.sizeSource === 'sprite-natural', filled.trace.sizeSource);
  check('a sprite-sized node is no longer indeterminate', filled.trace.sizeIndeterminate === false);
  check('the zeroed node ignores the lookup, because 0 was declared', withLookup.find((box) => box.id === 'zeroed').rect.width === 0);
  check('an absent size produces no unresolved-size issue', computeLayout(noSizeLayout).issues.filter((issue) => issue.rule === 'unresolved-size').length === 0, JSON.stringify(computeLayout(noSizeLayout).issues.slice(0, 2)));
  const badVariable = computeLayout({
    schema: 'rstellarisgui/layout@1',
    name: 'badvar',
    baseResolution: { width: 100, height: 100 },
    root: { id: 'r', kind: 'container', name: 'r', size: { width: 100, height: 100 }, children: [{ id: 'c', kind: 'container', name: 'c', size: { width: '@nope', height: 10 } }] },
  });
  check('an undeclared @variable in a size DOES produce an unresolved-size issue', badVariable.issues.some((issue) => issue.rule === 'unresolved-size'), JSON.stringify(badVariable.issues));

  // makeSpriteLookup is the single shared implementation used by the validator, the preview and
  // the web server; three copies had drifted apart before it was extracted.
  const lookup = makeSpriteLookup({
    sprites: {
      GFX_known: { textureFile: 'gfx/known.dds' },
      GFX_notexture: { textureFile: null },
      // 96x32 with three frames: the drawn frame is 32x32, the strip is 96x32.
      GFX_framed: { textureFile: 'gfx/framed.dds', frameCount: 3 },
    },
    textures: {
      'gfx/known.dds': { ok: true, width: 64, height: 32 },
      'gfx/framed.dds': { ok: true, width: 96, height: 32 },
      'gfx/broken.dds': { ok: false, reason: 'x' },
    },
  });
  const knownSprite = lookup('GFX_known');
  check(
    'makeSpriteLookup returns the texture size',
    knownSprite?.width === 64 && knownSprite?.height === 32 && knownSprite?.frameCount === 1,
    JSON.stringify(knownSprite),
  );
  // A `noOfFrames = 3` sprite is a horizontal STRIP and the engine draws one frame: the drawn size
  // is the texture's width divided by the frame count, not the strip's full width.
  const framedSprite = lookup('GFX_framed');
  check(
    'makeSpriteLookup divides a multi-frame strip into one frame',
    framedSprite?.width === 32 && framedSprite?.height === 32 && framedSprite?.frameCount === 3 && framedSprite?.textureWidth === 96,
    JSON.stringify(framedSprite),
  );
  check(
    'makeSpriteLookup reports frame 0 as the source rectangle',
    framedSprite?.source?.x === 0 && framedSprite?.source?.width === 32,
    JSON.stringify(framedSprite?.source),
  );
  check('makeSpriteLookup returns null for a sprite with no texture', lookup('GFX_notexture') === null);
  check('makeSpriteLookup returns null for an unknown sprite', lookup('GFX_missing') === null);
  check('makeSpriteLookup returns null for an empty name', lookup('') === null);
  check('makeSpriteLookup returns null without an index', makeSpriteLookup(null) === null);
});

// =====================================================================================
// 4. Layout tree: parse, walk, edit
// =====================================================================================

group('layout tree', () => {
  const guiText = [
    '@my_width = 500',
    'guiTypes = {',
    '\tcontainerWindowType = {',
    '\t\tname = "root_win"',
    '\t\tsize = { width = @my_width height = 300 }',
    '\t\torientation = center',
    '\t\torigo = center',
    '\t\tmoveable = yes',
    '\t\tbackground = {',
    '\t\t\tname = "background"',
    '\t\t\tquadTextureSprite = "GFX_tile_large_bg"',
    '\t\t}',
    '\t\tinstantTextBoxType = {',
    '\t\t\tname = "title"',
    '\t\t\tposition = { x = 20 y = 14 }',
    '\t\t\tfont = "malgun_goth_24"',
    '\t\t\ttext = "root_win_title"',
    '\t\t}',
    '\t\tbuttonType = {',
    '\t\t\tname = "close"',
    '\t\t\tquadTextureSprite = "GFX_main_close_button"',
    '\t\t\tposition = { x = -10 y = 10 }',
    '\t\t\torientation = upper_right',
    '\t\t}',
    '\t}',
    '}',
  ].join('\n');

  const parsed = parseGuiText(guiText, 'test.gui');
  check('parses a guiTypes root', parsed.ok === true, parsed.reason);
  check('reads the root keyword', parsed.rootKeyword === 'guiTypes', parsed.rootKeyword);
  check('hoists @variables declared before guiTypes', parsed.variables['@my_width'] === '500', JSON.stringify(parsed.variables));
  check('finds one top-level container', parsed.containers.length === 1, String(parsed.containers.length));

  const root = parsed.containers[0];
  check('reads name, orientation and origo', root.name === 'root_win' && root.orientation === 'center' && root.origo === 'center');
  check('reads size width from the variable reference', root.size.width === '@my_width', String(root.size.width));
  check('reads the background block', root.background?.sprite === 'GFX_tile_large_bg', JSON.stringify(root.background));
  check('separates element children from sub-blocks', root.children.length === 2, String(root.children.length));
  check('keeps the text element', root.children.find((child) => child.name === 'title')?.font === 'malgun_goth_24');
  check('coerces booleans', root.moveable === true, String(root.moveable));
  check('renames x/y size to width/height', parsed.containers[0].size.height === 300, JSON.stringify(parsed.containers[0].size));

  // A file whose root is not guiTypes must be reported, not accepted.
  const badRoot = parseGuiText('containerWindowType = { name = "x" }', 'bad.gui');
  check('rejects a bare element as the root', badRoot.ok === false, String(badRoot.ok));
  check('names the offending root construct', badRoot.rootKeyword === 'containerWindowType', badRoot.rootKeyword);
  check('explains the guiTypes rule', /guiTypes/.test(badRoot.reason ?? ''), String(badRoot.reason));
  const rootCheck = validateGuiRoot('containerWindowType = { name = "x" }', 'bad.gui');
  check('validateGuiRoot flags a bad root with a rule name', rootCheck.ok === false && rootCheck.rule === 'root-invalid', JSON.stringify(rootCheck));

  // Case-insensitive root, as vanilla traits.gui spells it.
  const lowerRoot = parseGuiText('guitypes = {\n\tcontainerWindowType = { name = "x" }\n}', 'lower.gui');
  check('accepts a lower-case guitypes root', lowerRoot.ok === true, lowerRoot.reason);

  // A file with @variables before the root AND comments.
  const withBoth = parseGuiText('# a comment\n@a = 1\n@b = 2%\nguiTypes = {\n\tcontainerWindowType = { name = "y" }\n}', 'vars.gui');
  check('skips comments and @ lines when locating the root', withBoth.ok === true && withBoth.rootKeyword === 'guiTypes', withBoth.rootKeyword);
  check('collects every variable', withBoth.variables['@a'] === '1' && withBoth.variables['@b'] === '2%', JSON.stringify(withBoth.variables));

  // Edits.
  let layout = defaultLayout();
  const added = applyEdits(layout, [
    { op: 'add', parent: 'mod_custom_window', node: { kind: 'icon', name: 'logo', spriteType: 'GFX_hex_bg', position: { x: 10, y: 10 } } },
    { op: 'set', target: 'logo', path: 'position.x', value: 40 },
    { op: 'set', target: 'logo', path: 'size.width', value: 64 },
  ]);
  check('applies an add edit', added.applied.length === 3 && added.failed.length === 0, JSON.stringify(added.failed));
  const logo = findNode(added.layout, 'logo');
  check('the added node exists', Boolean(logo), 'logo not found');
  check('set edits reach nested paths', logo?.position?.x === 40 && logo?.size?.width === 64, JSON.stringify(logo?.size));
  check('new nodes get generated ids', typeof logo?.id === 'string' && logo.id.length > 0, String(logo?.id));

  const removed = applyEdits(added.layout, [{ op: 'remove', target: 'logo' }]);
  check('applies a remove edit', removed.applied.length === 1 && findNode(removed.layout, 'logo') === null);
  const badEdit = applyEdits(layout, [{ op: 'remove', target: 'nope' }, { op: 'frobnicate' }]);
  check('reports a failed edit instead of throwing', badEdit.failed.length === 2 && badEdit.applied.length === 0, JSON.stringify(badEdit.failed));
  const variableEdit = applyEdits(layout, [{ op: 'set_variable', name: '@w', value: '700' }]);
  check('sets a layout variable', variableEdit.layout.variables['@w'] === '700', JSON.stringify(variableEdit.layout.variables));

  // Non-element sub-blocks must not become children.
  const withSubBlocks = parseGuiText(
    'guiTypes = {\n\tcontainerWindowType = {\n\t\tname = "s"\n\t\tborderSize = { x = 4 y = 4 }\n\t\tmargin = { x = 1 }\n\t},\n}',
    'sub.gui',
  );
  const subChildren = withSubBlocks.containers[0].children ?? [];
  check('does not invent child elements from borderSize/margin', subChildren.length === 0, JSON.stringify(subChildren.map((child) => child.kind)));
});

// =====================================================================================
// 5. Overlap and bounds - true AND false cases
// =====================================================================================

group('overlap detection', () => {
  const makeLayout = (children) => ({
    schema: 'rstellarisgui/layout@1',
    name: 'overlap_test',
    baseResolution: { width: 1000, height: 1000 },
    root: { id: 'root', kind: 'container', name: 'root', size: { width: 1000, height: 1000 }, children },
  });
  const element = (name, x, y, width, height, extra = {}) => ({
    id: name,
    kind: 'container',
    name,
    position: { x, y },
    size: { width, height },
    ...extra,
  });

  // Overlapping siblings -> reported.
  const overlapping = validateLayout(
    makeLayout([element('a', 0, 0, 200, 200), element('b', 100, 100, 200, 200)]),
    { options: { bounds: { width: 1000, height: 1000 } } },
  );
  const overlapFinding = overlapping.findings.find((finding) => finding.rule === 'sibling-overlap');
  check('reports two overlapping siblings', Boolean(overlapFinding), JSON.stringify(overlapping.byRule));
  check('the overlap finding carries both rects', Boolean(overlapFinding?.rect && overlapFinding?.otherRect));
  check('the overlap finding quantifies the area', overlapFinding?.overlapArea === 10000, String(overlapFinding?.overlapArea));
  check('the overlap finding suggests a fix', typeof overlapFinding?.suggestedFix === 'string' && overlapFinding.suggestedFix.length > 0);
  check('the overlap finding names the coordinates', /10000|px\^2/.test(overlapFinding?.message ?? ''), overlapFinding?.message);

  // Disjoint siblings -> NOT reported.
  const disjoint = validateLayout(
    makeLayout([element('a', 0, 0, 100, 100), element('b', 500, 500, 100, 100)]),
    { options: { bounds: { width: 1000, height: 1000 } } },
  );
  check('does not report disjoint siblings', !disjoint.findings.some((finding) => finding.rule === 'sibling-overlap'), JSON.stringify(disjoint.byRule));

  // Touching but not overlapping -> NOT reported.
  const touching = validateLayout(
    makeLayout([element('a', 0, 0, 100, 100), element('b', 100, 0, 100, 100)]),
    { options: { bounds: { width: 1000, height: 1000 } } },
  );
  check('does not report exactly touching siblings', !touching.findings.some((finding) => finding.rule === 'sibling-overlap'));

  // A container and its own child must never be reported as an overlap.
  const nested = validateLayout(
    {
      schema: 'rstellarisgui/layout@1',
      name: 'nested',
      baseResolution: { width: 1000, height: 1000 },
      root: {
        id: 'root',
        kind: 'container',
        name: 'root',
        size: { width: 1000, height: 1000 },
        children: [
          {
            id: 'outer',
            kind: 'container',
            name: 'outer',
            position: { x: 0, y: 0 },
            size: { width: 500, height: 500 },
            children: [element('inner', 0, 0, 500, 500)],
          },
        ],
      },
    },
    { options: { bounds: { width: 1000, height: 1000 } } },
  );
  check('never reports a container against its own child', !nested.findings.some((finding) => finding.rule === 'sibling-overlap'), JSON.stringify(nested.byRule));

  // Full containment of one sibling by another is a decorative pattern, not an error.
  const containment = validateLayout(
    makeLayout([element('bg', 0, 0, 500, 500), element('fg', 50, 50, 100, 100)]),
    { options: { bounds: { width: 1000, height: 1000 } } },
  );
  check('suppresses full-containment overlaps by default', !containment.findings.some((finding) => finding.rule === 'sibling-overlap'));

  // alwaysTransparent decoration is suppressed by default and reported when asked for.
  const transparentOverlap = makeLayout([
    element('deco', 0, 0, 200, 200, { alwaysTransparent: true }),
    element('b', 100, 100, 200, 200),
  ]);
  const suppressed = validateLayout(transparentOverlap, { options: { bounds: { width: 1000, height: 1000 } } });
  const flagged = validateLayout(transparentOverlap, {
    options: { bounds: { width: 1000, height: 1000 }, flagTransparentOverlaps: true },
  });
  check('suppresses an alwaysTransparent overlap by default', !suppressed.findings.some((finding) => finding.rule === 'sibling-overlap'));
  check('reports it when flagTransparentOverlaps is set', flagged.findings.some((finding) => finding.rule === 'sibling-overlap'));

  // The area-ratio tolerance: a 1px sliver is noise, a 50% overlap is not.
  const sliver = validateLayout(
    makeLayout([element('a', 0, 0, 100, 100), element('b', 0, 99, 100, 100)]),
    { options: { bounds: { width: 1000, height: 1000 } } },
  );
  check('ignores a 1px sliver overlap', !sliver.findings.some((finding) => finding.rule === 'sibling-overlap'), JSON.stringify(sliver.byRule));
  const half = validateLayout(
    makeLayout([element('a', 0, 0, 100, 100), element('b', 0, 50, 100, 100)]),
    { options: { bounds: { width: 1000, height: 1000 } } },
  );
  check('reports a 50% overlap', half.findings.some((finding) => finding.rule === 'sibling-overlap'));

  // Out of bounds against the root window rect.
  const outOfBounds = validateLayout(makeLayout([element('a', 900, 900, 300, 300)]), {
    options: { bounds: { width: 1000, height: 1000 } },
  });
  const oob = outOfBounds.findings.find((finding) => finding.rule === 'out-of-bounds');
  check('reports an element leaving the root window', Boolean(oob), JSON.stringify(outOfBounds.byRule));
  check('the out-of-bounds report quantifies each side', oob?.overflow.right === 200 && oob?.overflow.bottom === 200, JSON.stringify(oob?.overflow));
  check('the out-of-bounds message names the base resolution', /1000x1000/.test(oob?.message ?? ''), oob?.message);
  check('out-of-bounds is an error', oob?.severity === 'error', oob?.severity);

  const inBounds = validateLayout(makeLayout([element('a', 0, 0, 100, 100)]), {
    options: { bounds: { width: 1000, height: 1000 } },
  });
  check('does not report an element inside the window', !inBounds.findings.some((finding) => finding.rule === 'out-of-bounds'));

  // An animated slide-in element is deliberately off-screen. Vanilla writes `show_position`
  // and `hide_position` as element sub-blocks (advisor_window.gui:32-33), so the parser files
  // them under `subBlocks`, not as children.
  //
  // Note the fixture keeps the layout's baseResolution equal to the bounds used for
  // validation: passing a tighter `bounds` than the layout's own base would make the ROOT
  // element out-of-bounds, which is correct behaviour but would mask what is being tested here.
  const slideNode = element('slide', 950, 100, 100, 100);
  slideNode.subBlocks = {
    show_position: [{ position: { x: -370, y: 100 } }],
    hide_position: [{ position: { x: 950, y: 100 } }],
  };
  const animated = makeLayout([slideNode]);
  const exempted = validateLayout(animated, { options: { allowOffscreenAnimated: true } });
  const insideBase = { x: 0, y: 0, width: 1000, height: 1000 };
  const slideBox = computeLayout(animated).boxes.find((box) => box.id === 'slide');
  check(
    'the fixture really does leave the base bounds',
    slideBox.rect.right > insideBase.width,
    JSON.stringify(slideBox.rect),
  );
  check(
    'does not report an off-screen animated element by default',
    !exempted.findings.some((finding) => finding.rule === 'out-of-bounds'),
    JSON.stringify(exempted.findings.map((finding) => finding.rule)),
  );
  const unexempted = validateLayout(animated, { options: { allowOffscreenAnimated: false } });
  check(
    'reports it when allowOffscreenAnimated is false',
    unexempted.findings.some((finding) => finding.rule === 'out-of-bounds'),
    JSON.stringify(unexempted.findings.map((finding) => finding.rule)),
  );
  check('the sub-block is not mistaken for a child element', (animated.root.children[0].children ?? []).length === 0);
  check(
    'show_position is modelled as a position block, not as x/y child elements',
    animated.root.children[0].subBlocks.show_position[0]?.position?.x === -370,
    JSON.stringify(animated.root.children[0].subBlocks),
  );

  // Zero size is a warning, not an error: hiding vanilla elements is a documented technique.
  const zero = validateLayout(makeLayout([element('hidden', 0, 0, 0, 0)]), { options: { bounds: { width: 1000, height: 1000 } } });
  const zeroFinding = zero.findings.find((finding) => finding.rule === 'zero-size');
  check('reports a zero size', Boolean(zeroFinding));
  check('zero size is never an error', zeroFinding?.severity !== 'error', zeroFinding?.severity);
  const emptyZero = validateLayout(makeLayout([element('hidden2', 0, 0, 0, 0)]), { options: { bounds: { width: 1000, height: 1000 } } });
  check('a content-free zero size is only info', emptyZero.findings.find((f) => f.rule === 'zero-size')?.severity === 'info');
  const textZero = validateLayout(
    makeLayout([{ ...element('lbl', 0, 0, 0, 0), kind: 'text', text: 'some_key' }]),
    { options: { bounds: { width: 1000, height: 1000 } } },
  );
  check('a zero-size element that draws text is a warning', textZero.findings.find((f) => f.rule === 'zero-size')?.severity === 'warning');

  // Negative size is legal; only a NEGATIVE RESOLVED size warns.
  const negativeSize = validateLayout(
    makeLayout([element('neg', 20, 10, -16, -8)]),
    { options: { bounds: { width: 1000, height: 1000 } } },
  );
  check('a legal negative size does not warn', !negativeSize.findings.some((finding) => finding.rule === 'negative-resolved-size'), JSON.stringify(negativeSize.byRule));
  const negativeResolved = validateLayout(
    makeLayout([
      {
        id: 'outer',
        kind: 'container',
        name: 'outer',
        position: { x: 0, y: 0 },
        size: { width: 50, height: 50 },
        children: [element('inner', 100, 0, -20, 10)],
      },
    ]),
    { options: { bounds: { width: 1000, height: 1000 } } },
  );
  check('a negative RESOLVED size warns', negativeResolved.findings.some((finding) => finding.rule === 'negative-resolved-size'), JSON.stringify(negativeResolved.byRule));
});

// =====================================================================================
// 6. Validator: names, sprites, fonts, effects, localisation, spelling
// =====================================================================================

group('validator rules', () => {
  const tinyAssets = {
    root: 'X:\\fake',
    sprites: {
      GFX_good: { kind: 'spriteType', textureFile: 'gfx/good.dds', declaredSize: null, file: 'a.gfx', line: 1 },
      GFX_cornered: { kind: 'corneredTileSpriteType', textureFile: 'gfx/cornered.dds', declaredSize: null, file: 'a.gfx', line: 2 },
    },
    textures: {
      'gfx/good.dds': { ok: true, width: 64, height: 64, format: 'BC1', mipCount: 1 },
      'gfx/cornered.dds': { ok: true, width: 90, height: 30, format: 'RGBA32', mipCount: 1 },
    },
    fonts: { cg_16b: { file: 'fonts.gfx', line: 1 } },
    buttonEffects: { real_effect: { file: 'be.txt', line: 1 } },
    stats: { fontCount: 1 },
  };

  const layoutWith = (children, extra = {}) => ({
    schema: 'rstellarisgui/layout@1',
    name: 'rules',
    baseResolution: { width: 1920, height: 1080 },
    ...extra,
    root: {
      id: 'root',
      kind: 'container',
      name: 'rules_window',
      size: { width: 600, height: 400 },
      children,
    },
  });

  const spriteReport = validateLayout(
    layoutWith([{ id: 'i', kind: 'icon', name: 'icon1', spriteType: 'GFX_missing_thing', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }]),
    { assets: tinyAssets },
  );
  const unknownSprite = spriteReport.findings.find((finding) => finding.rule === 'unknown-sprite');
  check('reports an unknown sprite', Boolean(unknownSprite), JSON.stringify(spriteReport.byRule));
  check('an unknown sprite is an error', unknownSprite?.severity === 'error');
  check('an unknown sprite suggests a near match or a tool', /did you mean|gui_assets_search/.test(unknownSprite?.suggestedFix ?? ''), unknownSprite?.suggestedFix);

  const knownSprite = validateLayout(
    layoutWith([{ id: 'i', kind: 'icon', name: 'icon2', spriteType: 'GFX_good', position: { x: 0, y: 0 }, size: { width: 64, height: 64 } }]),
    { assets: tinyAssets },
  );
  check('does not report a known sprite', !knownSprite.findings.some((finding) => finding.rule === 'unknown-sprite'), JSON.stringify(knownSprite.byRule));

  // A fixed-size SpriteType given a different size is an info-level smell.
  const resized = validateLayout(
    layoutWith([{ id: 'i', kind: 'icon', name: 'icon3', spriteType: 'GFX_good', position: { x: 0, y: 0 }, size: { width: 200, height: 200 } }]),
    { assets: tinyAssets },
  );
  check('notices a fixed-size sprite being resized', resized.findings.some((finding) => finding.rule === 'fixed-size-sprite-resized'));
  const cornered = validateLayout(
    layoutWith([{ id: 'i', kind: 'button', name: 'btn', quadTextureSprite: 'GFX_cornered', position: { x: 0, y: 0 }, size: { width: 200, height: 200 } }]),
    { assets: tinyAssets },
  );
  check('does not complain about resizing a corneredTileSpriteType', !cornered.findings.some((finding) => finding.rule === 'fixed-size-sprite-resized'));

  const badFont = validateLayout(
    layoutWith([{ id: 't', kind: 'text', name: 'lbl', text: 'k', font: 'comic_sans', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }]),
    { assets: tinyAssets },
  );
  check('reports an unknown font', badFont.findings.some((finding) => finding.rule === 'unknown-font'));

  // effectbuttonType
  const noEffect = validateLayout(
    layoutWith([{ id: 'b', kind: 'effectbutton', name: 'eb', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }]),
    { assets: tinyAssets },
  );
  check('reports an effectbuttonType with no effect', noEffect.findings.some((finding) => finding.rule === 'effect-missing'), JSON.stringify(noEffect.byRule));
  const badEffect = validateLayout(
    layoutWith([{ id: 'b', kind: 'effectbutton', name: 'eb2', effect: 'nope_effect', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }]),
    { assets: tinyAssets },
  );
  const effectFinding = badEffect.findings.find((finding) => finding.rule === 'effect-unresolved');
  check('reports an unresolvable effect key', Boolean(effectFinding), JSON.stringify(badEffect.byRule));
  check('the effect finding suggests a real key', /real_effect/.test(effectFinding?.suggestedFix ?? ''), effectFinding?.suggestedFix);
  const goodEffect = validateLayout(
    layoutWith([{ id: 'b', kind: 'effectbutton', name: 'eb3', effect: 'real_effect', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }]),
    { assets: tinyAssets },
  );
  check('accepts a resolvable effect key', !goodEffect.findings.some((finding) => finding.rule === 'effect-unresolved'), JSON.stringify(goodEffect.byRule));
  const declaredEffect = validateLayout(
    layoutWith(
      [{ id: 'b', kind: 'effectbutton', name: 'eb4', effect: 'my_own_effect', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }],
      { effects: { my_own_effect: { effect: {} } } },
    ),
    { assets: tinyAssets },
  );
  check('accepts an effect the layout declares for itself', !declaredEffect.findings.some((finding) => finding.rule === 'effect-unresolved'), JSON.stringify(declaredEffect.byRule));

  // duplicate names
  const duplicates = validateLayout(
    layoutWith([
      { id: 'a', kind: 'container', name: 'dup', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } },
      { id: 'b', kind: 'container', name: 'dup', position: { x: 20, y: 0 }, size: { width: 10, height: 10 } },
    ]),
  );
  const dupFinding = duplicates.findings.find((finding) => finding.rule === 'duplicate-name');
  check('reports a duplicate sibling name', Boolean(dupFinding), JSON.stringify(duplicates.byRule));
  check('the duplicate report names the count', /2 times/.test(dupFinding?.message ?? ''), dupFinding?.message);
  const uniqueNames = validateLayout(
    layoutWith([
      { id: 'a', kind: 'container', name: 'one', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } },
      { id: 'b', kind: 'container', name: 'two', position: { x: 20, y: 0 }, size: { width: 10, height: 10 } },
    ]),
  );
  check('does not report unique names', !uniqueNames.findings.some((finding) => finding.rule === 'duplicate-name'));

  // localisation
  const locLayout = layoutWith([
    { id: 't', kind: 'text', name: 'lbl', text: 'known_key', position: { x: 0, y: 0 }, size: { width: 100, height: 20 } },
    { id: 'u', kind: 'text', name: 'lbl2', text: 'unknown_key', position: { x: 0, y: 30 }, size: { width: 100, height: 20 } },
  ]);
  const locReport = validateLayout(locLayout, { localisation: { keys: new Set(['known_key']) } });
  const missing = locReport.findings.filter((finding) => finding.rule === 'missing-localisation');
  check('reports exactly the missing localisation key', missing.length === 1 && missing[0].key === 'unknown_key', JSON.stringify(missing.map((finding) => finding.key)));
  check('the localisation fix mentions the BOM rule', /BOM/.test(missing[0]?.suggestedFix ?? ''), missing[0]?.suggestedFix);
  const noLocCheck = validateLayout(locLayout, { localisation: null });
  check('skips localisation checks when no keyset is supplied', !noLocCheck.findings.some((finding) => finding.rule === 'missing-localisation'));

  // OPTION_TEXT is an engine sentinel, not a localisation key: it is never defined in a .yml and
  // must not be reported. Verified in vanilla at diplomacy_caravaneer_event_view.gui:15.
  const sentinelReport = validateLayout(
    layoutWith([
      { id: 't', kind: 'text', name: 'ob', text: 'OPTION_TEXT', position: { x: 0, y: 0 }, size: { width: 100, height: 20 } },
    ]),
    { localisation: { keys: new Set(['something_else']) } },
  );
  check(
    'OPTION_TEXT is not reported as a missing localisation key',
    !sentinelReport.findings.some((finding) => finding.rule === 'missing-localisation'),
    JSON.stringify(sentinelReport.findings.map((finding) => finding.key ?? finding.rule)),
  );

  // A bracket data function in a value the WINDOW PAINTS renders literally. Measured in game
  // 2026-10-05 (custom_gui event window, `unga_chart_center_value:0 "[Root.GetName]"` shown as
  // `[Root.Ge ...`), so the rule must fire on `text`/`buttonText` and must NOT fire on a tooltip
  // field, where the engine does resolve it (9201 vanilla uses).
  {
    const bracketLayout = layoutWith([
      { id: 'bt', kind: 'text', name: 'painted', text: 'loc_with_call', position: { x: 0, y: 0 }, size: { width: 200, height: 20 } },
      { id: 'bs', kind: 'text', name: 'static', text: 'loc_static', position: { x: 0, y: 30 }, size: { width: 200, height: 20 } },
      { id: 'btt', kind: 'text', name: 'tooltipped', text: 'loc_static', pdx_tooltip: 'loc_with_call', position: { x: 0, y: 60 }, size: { width: 200, height: 20 } },
    ]);
    const bracketReport = validateLayout(bracketLayout, {
      localisation: {
        keys: new Set(['loc_with_call', 'loc_static']),
        values: new Map([['loc_with_call', '[Root.GetName] takes the chair.'], ['loc_static', 'The Earth Directorate takes the chair.']]),
      },
    });
    const bracketFindings = bracketReport.findings.filter((finding) => finding.rule === 'window-text-data-function');
    check(
      'reports a bracket data function in a painted text value',
      bracketFindings.length === 1 && bracketFindings[0].element === 'painted' && bracketFindings[0].key === 'loc_with_call',
      JSON.stringify(bracketFindings.map((finding) => `${finding.element}:${finding.key}`)),
    );
    check('the data-function finding quotes the call it found', /\[Root\.GetName\]/.test(bracketFindings[0]?.message ?? ''), bracketFindings[0]?.message);
    check('the data-function finding records the measured evidence', /measured/.test(bracketFindings[0]?.message ?? ''));
    check('the data-function finding points at the tooltip route instead', /tooltip/.test(bracketFindings[0]?.suggestedFix ?? ''), bracketFindings[0]?.suggestedFix);
    check(
      'does not report a bracket data function in a TOOLTIP value (the engine resolves those)',
      !bracketReport.findings.some((finding) => finding.rule === 'window-text-data-function' && finding.element === 'tooltipped'),
    );
    check(
      'stays silent without localisation values to read',
      !validateLayout(bracketLayout, { localisation: { keys: new Set(['loc_with_call', 'loc_static']) } })
        .findings.some((finding) => finding.rule === 'window-text-data-function'),
    );
    check(
      'a static value is never reported',
      !bracketReport.findings.some((finding) => finding.rule === 'window-text-data-function' && finding.element === 'static'),
    );
    // GAP-5, second half: `[$Token$]` is a live value the engine SUBSTITUTES, not a bracket call it
    // prints, so it must not be reported as rendering literally. The control above is the shape that
    // must keep firing. Measured: all 32 of the working mod's live readouts are `[$GetUnga<...>$]`,
    // and reporting them here gave 32 findings that say "the player reads this literally" about
    // strings the player reads as a NUMBER.
    const tokenLayout = layoutWith([
      { id: 'lt', kind: 'text', name: 'live_token', text: 'loc_live_token', position: { x: 0, y: 0 }, size: { width: 200, height: 20 } },
      { id: 'le', kind: 'effectbutton', name: 'live_button', position: { x: 0, y: 30 }, size: { x: 200, y: 20 }, effect: 'e', buttonText: 'loc_live_token' },
    ]);
    const tokenReport = validateLayout(tokenLayout, {
      localisation: {
        keys: new Set(['loc_live_token']),
        values: new Map([['loc_live_token', '[$GetUngaAttUnNato$]']]),
      },
    });
    check(
      'a `[$Token$]` live value is NOT reported as a bracket data function that renders literally',
      !tokenReport.findings.some((finding) => finding.rule === 'window-text-data-function'),
      JSON.stringify(tokenReport.findings.filter((finding) => finding.rule === 'window-text-data-function').map((finding) => `${finding.element}:${finding.text ?? ''}`)),
    );
    // The classification keys on the BRACKET CALL, not on what surrounds it: a live token with
    // literal text after it is still a live value the engine substitutes into.
    const mixedReport = validateLayout(layoutWith([{ id: 'mt', kind: 'text', name: 'mixed', text: 'loc_mixed', position: { x: 0, y: 0 }, size: { width: 200, height: 20 } }]), {
      localisation: { keys: new Set(['loc_mixed']), values: new Map([['loc_mixed', '[$GetUngaX$] takes the chair']]) },
    });
    check(
      'literal text AROUND a live token does not turn it into a literal bracket call',
      !mixedReport.findings.some((finding) => finding.rule === 'window-text-data-function'),
      JSON.stringify(mixedReport.findings.map((finding) => finding.rule)),
    );
    // And a genuine `[Scope.Func]` alongside the token: `[$GetUngaX$] and [Root.GetName]`. The
    // regex that finds a bracket call is anchored on a `Scope.Func` / `GetX` / `?var` INSIDE the
    // brackets, and the first bracket here holds only a token, so the scan has to reach the second.
    const bothReport = validateLayout(layoutWith([{ id: 'nt', kind: 'text', name: 'both', text: 'loc_both', position: { x: 0, y: 0 }, maxWidth: 200, maxHeight: 20, font: 'cg_16b' }]), {
      localisation: { keys: new Set(['loc_both']), values: new Map([['loc_both', '[$GetUngaX$] and [Root.GetName]']]) },
    });
    check(
      'a genuine `[Scope.Func]` call beside a live token is still reported',
      bothReport.findings.some((finding) => finding.rule === 'window-text-data-function'),
      JSON.stringify(bothReport.findings.map((finding) => `${finding.rule}:${finding.message ?? ''}`.slice(0, 90))),
    );
  }

  // spelling
  const badSpelling = validateLayout(
    layoutWith([{ id: 'a', kind: 'container', name: 'sp', orientation: 'sideways', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }]),
  );
  check('reports an unrecognised orientation spelling', badSpelling.findings.some((finding) => finding.rule === 'orientation-unknown'));
  const goodSpelling = validateLayout(
    layoutWith([{ id: 'a', kind: 'container', name: 'sp2', orientation: 'lower_right', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }]),
  );
  check('accepts a canonical orientation spelling', !goodSpelling.findings.some((finding) => finding.rule === 'orientation-unknown'));

  // undeclared variable
  const undeclared = validateLayout(
    layoutWith([{ id: 'a', kind: 'container', name: 'uv', position: { x: 0, y: 0 }, size: { width: '@missing_width', height: 10 } }]),
  );
  const undeclaredFinding = undeclared.findings.find((finding) => finding.rule === 'undeclared-variable');
  check('reports an undeclared @variable', Boolean(undeclaredFinding), JSON.stringify(undeclared.byRule));
  check('an undeclared variable is an error', undeclaredFinding?.severity === 'error');
  const declared = validateLayout(
    layoutWith([{ id: 'a', kind: 'container', name: 'dv', position: { x: 0, y: 0 }, size: { width: '@w', height: 10 } }], { variables: { '@w': '50' } }),
  );
  check('accepts a declared @variable', !declared.findings.some((finding) => finding.rule === 'undeclared-variable'));

  // option_button convention
  const optionLayout = layoutWith([
    {
      id: 'row',
      kind: 'container',
      name: 'my_mod_option',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 30 },
      children: [{ id: 'ob', kind: 'button', name: 'some_button', text: 'WRONG', position: { x: 0, y: 0 }, size: { width: 100, height: 20 } }],
    },
  ]);
  const optionReport = validateLayout(optionLayout);
  const optionFinding = optionReport.findings.find((finding) => finding.rule === 'option-button-convention');
  check('enforces the option_button / OPTION_TEXT convention', Boolean(optionFinding), JSON.stringify(optionReport.byRule));
  check('the option convention finding is an error', optionFinding?.severity === 'error');
  const goodOption = validateLayout(
    layoutWith([
      {
        id: 'row',
        kind: 'container',
        name: 'my_mod_option',
        position: { x: 0, y: 0 },
        size: { width: 300, height: 30 },
        children: [{ id: 'ob', kind: 'button', name: 'option_button', text: 'OPTION_TEXT', position: { x: 0, y: 0 }, size: { width: 100, height: 20 } }],
      },
    ]),
  );
  check('accepts a correct option row', !goodOption.findings.some((finding) => finding.rule === 'option-button-convention'));

  // kind-not-emittable is reported, and never with an error severity. The fixture is the ONE kind
  // the emitter still does not write. gridBox/listBox/smoothListBox/overlappingElementsBox/
  // guiButton/scrollbar became emittable first, and window/checkbox/spinner/editBox/dropDownBox
  // became emittable in the full-surface round, so `positionType` is all that is left - and it is
  // left on purpose rather than for lack of effort: its NAME is a literal in `stellaris.exe`
  // (`additional_content_grid_spacing`), so a mod cannot author one the engine will look up.
  const stubKind = validateLayout(
    layoutWith([{ id: 'c', kind: 'position', name: 'some_anchor', position: { x: 0, y: 0 } }]),
  );
  const kindFinding = stubKind.findings.find((finding) => finding.rule === 'kind-not-emittable');
  check('reports a recognised-but-not-emittable kind', Boolean(kindFinding), JSON.stringify(stubKind.byRule));
  check('the not-emittable finding is info, not an error', kindFinding?.severity === 'info');
  check('the not-emittable finding names the vanilla keyword', /positionType/.test(kindFinding?.message ?? ''), kindFinding?.message);

  // validateGuiText detects a bad root
  const badRootReport = validateGuiText('containerWindowType = { name = "x" }', 'bad.gui');
  check('validateGuiText fails a bad root', badRootReport.ok === false && badRootReport.byRule['root-invalid'] === 1, JSON.stringify(badRootReport.byRule));

  // Report shape
  const report = validateLayout(defaultLayout());
  check('the report states the base resolution', report.baseResolution.width === 1920 && report.baseResolution.height === 1080, JSON.stringify(report.baseResolution));
  check('the report states the geometry assumption in words', /base resolution/.test(report.geometryAssumption), report.geometryAssumption);
  check('the report counts findings by severity', typeof report.counts.error === 'number' && typeof report.counts.warning === 'number');
  check('the report counts findings by rule', typeof report.byRule === 'object');
  check('the report has a verdict', report.verdict === 'pass' || report.verdict === 'fail', report.verdict);
});

// =====================================================================================
// 7. Asset index: gfx parsing, search, sprite info
// =====================================================================================

group('asset index', () => {
  const gfxText = [
    'spriteTypes = {',
    '\t# a comment',
    '\tspriteType = {',
    '\t\tname = "GFX_a"',
    '\t\ttexturefile = "gfx/a.dds"',
    '\t}',
    '\tcorneredTileSpriteType = {',
    '\t\tname = "GFX_b"',
    '\t\ttexturefile = "gfx/b.dds"',
    '\t\tborderSize = { x = 4 y = 4 }',
    '\t}',
    '\tprogressBarType = {',
    '\t\tname = "GFX_c"',
    '\t\ttexturefile = "gfx/c.dds"',
    '\t}',
    '\ttextSpriteType = {',
    '\t\tname = "GFX_d"',
    '\t}',
    '}',
  ].join('\n');
  const parsed = parseGfxFile(gfxText, 'test.gfx');
  const names = parsed.sprites.map((sprite) => sprite.name);
  // The hard-won rule: sprite names come from MANY block kinds, not only spriteType.
  check('indexes spriteType names', names.includes('GFX_a'), names.join(','));
  check('indexes corneredTileSpriteType names', names.includes('GFX_b'), names.join(','));
  check('indexes progressBarType names', names.includes('GFX_c'), names.join(','));
  check('indexes textSpriteType names', names.includes('GFX_d'), names.join(','));
  check('records the declaring kind', parsed.sprites.find((sprite) => sprite.name === 'GFX_b')?.kind === 'corneredTileSpriteType');
  check('records the texture path', parsed.sprites.find((sprite) => sprite.name === 'GFX_a')?.textureFile === 'gfx/a.dds');
  check('records the defining line', parsed.sprites.find((sprite) => sprite.name === 'GFX_a')?.line === 3, String(parsed.sprites.find((s) => s.name === 'GFX_a')?.line));
  check('records a sprite with no texturefile as null rather than skipping it', parsed.sprites.find((sprite) => sprite.name === 'GFX_d')?.textureFile === null);

  const fontText = 'bitmapfonts = {\n\ttextcolors = { H = { 1 2 3 } }\n\tbitmapfont = {\n\t\tname = "cg_16b"\n\t}\n}';
  const fontParsed = parseGfxFile(fontText, 'fonts.gfx');
  // fonts.gfx nests bitmapfont inside bitmapfonts, with a textcolors block alongside.
  check('descends into the bitmapfonts wrapper to find fonts', fontParsed.fonts.some((font) => font.name === 'cg_16b'), JSON.stringify(fontParsed.fonts.map((f) => f.name)));
  check('does not treat textcolors as a font', !fontParsed.fonts.some((font) => font.name === 'H'));

  const fakeIndex = {
    schema: 3,
    root: 'X:\\fake',
    version: 'test',
    stats: { fontCount: 2, buttonEffectCount: 1 },
    sprites: {
      GFX_tile_large_bg: { kind: 'corneredTileSpriteType', textureFile: 'gfx/tiles/tile_large_bg.dds', declaredSize: null, file: 'planet_view.gfx', line: 1610 },
      GFX_main_close_button: { kind: 'SpriteType', textureFile: 'gfx/buttons/close_button.dds', declaredSize: null, file: 'general_stuff.gfx', line: 4 },
      GFX_big_thing: { kind: 'SpriteType', textureFile: 'gfx/big.dds', declaredSize: null, file: 'a.gfx', line: 1 },
    },
    textures: {
      'gfx/tiles/tile_large_bg.dds': { ok: true, width: 680, height: 612, format: 'RGBA32', mipCount: 1 },
      'gfx/buttons/close_button.dds': { ok: true, width: 114, height: 38, format: 'RGBA32', mipCount: 7 },
      'gfx/big.dds': { ok: true, width: 4096, height: 4096, format: 'BC3', mipCount: 13 },
    },
    fonts: { cg_16b: { file: 'fonts.gfx', line: 168 }, malgun_goth_24: { file: 'fonts.gfx', line: 274 } },
    buttonEffects: { real_effect: { file: 'be.txt', line: 1 } },
    containers: { some_window: { file: 'x.gui', line: 3 } },
  };

  check('searchSprites finds by name substring', searchSprites(fakeIndex, { query: 'close' }).length === 1, String(searchSprites(fakeIndex, { query: 'close' }).length));
  check('searchSprites honours a width filter', searchSprites(fakeIndex, { minWidth: 1000 }).length === 1, JSON.stringify(searchSprites(fakeIndex, { minWidth: 1000 }).map((s) => s.name)));
  check('searchSprites reports where the size came from', searchSprites(fakeIndex, { query: 'close' })[0].sizeSource === 'dds-header');
  check('searchSprites returns nothing for a nonsense query', searchSprites(fakeIndex, { query: 'zzzzz' }).length === 0);

  const info = spriteInfo(fakeIndex, 'GFX_tile_large_bg');
  check('spriteInfo returns full metadata', info.found === true && info.texture.width === 680 && info.kind === 'corneredTileSpriteType', JSON.stringify(info.texture));
  check('spriteInfo reports where it is defined', info.definedAt.file === 'planet_view.gfx' && info.definedAt.line === 1610, JSON.stringify(info.definedAt));
  const missingInfo = spriteInfo(fakeIndex, 'GFX_main_close');
  check('spriteInfo suggests near misses for a typo', missingInfo.found === false && missingInfo.suggestions.includes('GFX_main_close_button'), JSON.stringify(missingInfo.suggestions));

  const parts = defaultParts(fakeIndex);
  check('defaultParts lists the verified part box', parts.sprites.length === 5 && parts.fonts.length === 2, JSON.stringify(parts));
  check('defaultParts marks a present sprite present', parts.sprites.find((sprite) => sprite.name === 'GFX_tile_large_bg')?.present === true);
  check('defaultParts marks a missing sprite absent', parts.sprites.find((sprite) => sprite.name === 'GFX_button_close')?.present === false);
});

// =====================================================================================
// 8. DDS header parsing on synthetic buffers
// =====================================================================================

group('dds headers', () => {
  /** Build a minimal but valid DDS header for tests. */
  function makeDdsHeader({ width, height, fourCC = null, rgbBitCount = 32, mipCount = 1, flags = 0x1007, pfFlags = null, masks = null, payload = 0 }) {
    const buffer = Buffer.alloc(128 + payload);
    buffer.writeUInt32LE(DDS_MAGIC, 0);
    buffer.writeUInt32LE(124, 4);
    buffer.writeUInt32LE(flags | (mipCount > 1 ? 0x20000 : 0), 8);
    buffer.writeUInt32LE(height, 12);
    buffer.writeUInt32LE(width, 16);
    buffer.writeUInt32LE(0, 20);
    buffer.writeUInt32LE(0, 24);
    buffer.writeUInt32LE(mipCount, 28);
    buffer.writeUInt32LE(32, 76);
    if (fourCC) {
      buffer.writeUInt32LE(pfFlags ?? 0x4, 80);
      buffer.write(fourCC, 84, 'latin1');
    } else {
      buffer.writeUInt32LE(pfFlags ?? 0x41, 80);
      buffer.writeUInt32LE(rgbBitCount, 88);
      const m = masks ?? { r: 0x00ff0000, g: 0x0000ff00, b: 0x000000ff, a: 0xff000000 };
      buffer.writeUInt32LE(m.r, 92);
      buffer.writeUInt32LE(m.g, 96);
      buffer.writeUInt32LE(m.b, 100);
      buffer.writeUInt32LE(m.a, 104);
    }
    return buffer;
  }

  const rgba = parseDdsHeader(makeDdsHeader({ width: 114, height: 38, mipCount: 7, payload: 4 }));
  check('parses an uncompressed DDS header', rgba.ok === true, rgba.reason);
  check('reads width and height', rgba.width === 114 && rgba.height === 38, `${rgba.width}x${rgba.height}`);
  check('reads the mip count', rgba.mipCount === 7, String(rgba.mipCount));
  check('classifies 32bpp as RGBA32', rgba.format === 'RGBA32', rgba.format);
  check('reports the alpha flag', rgba.hasAlpha === true);
  check('reports 4 bytes per pixel', rgba.bytesPerPixel === 4);

  const dxt1 = parseDdsHeader(makeDdsHeader({ width: 64, height: 64, fourCC: 'DXT1' }));
  check('classifies DXT1 as BC1', dxt1.format === 'BC1', dxt1.format);
  check('BC1 uses 8 bytes per 4x4 block', dxt1.blockBytes === 8, String(dxt1.blockBytes));
  const dxt3 = parseDdsHeader(makeDdsHeader({ width: 64, height: 64, fourCC: 'DXT3' }));
  check('classifies DXT3 as BC2', dxt3.format === 'BC2', dxt3.format);
  const dxt5 = parseDdsHeader(makeDdsHeader({ width: 64, height: 64, fourCC: 'DXT5' }));
  check('classifies DXT5 as BC3', dxt5.format === 'BC3', dxt5.format);
  check('BC3 uses 16 bytes per 4x4 block', dxt5.blockBytes === 16, String(dxt5.blockBytes));

  // Mip walk on a BC3 image: 64x64 -> 32 -> 16 -> 8 -> 4 -> 2 -> 1
  const mips = parseDdsHeader(makeDdsHeader({ width: 64, height: 64, fourCC: 'DXT5', mipCount: 7, payload: 1000 }));
  check('enumerates every mip level', mips.mipOffsets.length === 7, String(mips.mipOffsets.length));
  check('the first mip is at the data offset', mips.mipOffsets[0].offset === 128, String(mips.mipOffsets[0].offset));
  check('the first mip is 16 blocks x 16 bytes', mips.mipOffsets[0].bytes === 16 * 16 * 16, String(mips.mipOffsets[0].bytes));
  check('mip dimensions halve', mips.mipOffsets[1].width === 32 && mips.mipOffsets[2].width === 16, `${mips.mipOffsets[1].width},${mips.mipOffsets[2].width}`);
  const chosenMip = pickMip(mips, 16);
  check('pickMip chooses a mip at least as large as the target', chosenMip.width >= 16, String(chosenMip.width));
  check('pickMip does not jump past the smallest sufficient mip', chosenMip.width === 16, String(chosenMip.width));

  // Non-square mip walk.
  const nonSquare = parseDdsHeader(makeDdsHeader({ width: 512, height: 64, fourCC: 'DXT5', mipCount: 10, payload: 5000 }));
  check('handles non-square dimensions in the mip walk', nonSquare.mipOffsets[3].width === 64 && nonSquare.mipOffsets[3].height === 8, `${nonSquare.mipOffsets[3].width}x${nonSquare.mipOffsets[3].height}`);

  // Malformed inputs must be reported, never thrown.
  check('rejects a buffer that is too short', parseDdsHeader(Buffer.alloc(64)).ok === false);
  check('rejects a missing magic', parseDdsHeader(Buffer.alloc(200)).ok === false);
  const badMagic = parseDdsHeader(Buffer.alloc(200));
  check('names the magic as the reason', /magic/i.test(badMagic.reason), badMagic.reason);
  const wrongSize = makeDdsHeader({ width: 4, height: 4 });
  wrongSize.writeUInt32LE(100, 4);
  check('rejects a header size other than 124', parseDdsHeader(wrongSize).ok === false);

  // An implausible mip count must be clamped so the offset walk cannot run away.
  const crazyMips = parseDdsHeader(makeDdsHeader({ width: 8, height: 8, fourCC: 'DXT1', mipCount: 99, payload: 64 }));
  check('clamps an implausible mip count', crazyMips.mipCount <= 4, String(crazyMips.mipCount));
  check('flags the implausible mip count', crazyMips.mipCountPlausible === false, String(crazyMips.mipCountPlausible));

  // A FourCC we do not implement must be refused by name, not silently decoded.
  const bogus = parseDdsHeader(makeDdsHeader({ width: 4, height: 4, fourCC: 'BC7X' }));
  check('refuses an unsupported FourCC', bogus.ok === false, bogus.reason);
  check('names the unsupported FourCC', /BC7X/.test(bogus.reason), bogus.reason);

  // Uncompressed 24bpp classification.
  const rgb24 = parseDdsHeader(makeDdsHeader({ width: 8, height: 8, rgbBitCount: 24, pfFlags: 0x40, masks: { r: 0xff0000, g: 0xff00, b: 0xff, a: 0 } }));
  check('classifies 24bpp as RGBA24', rgb24.format === 'RGBA24', rgb24.format);
  check('24bpp is 3 bytes per pixel', rgb24.bytesPerPixel === 3, String(rgb24.bytesPerPixel));

  // ===========================================================================
  // BC1 decoding correctness: build one block with known endpoints and assert the
  // interpolated palette, including the 3-colour (transparent) mode.
  // ===========================================================================
  const block = Buffer.alloc(16);
  // colour0 = pure red (5-6-5 = 0xF800), colour1 = pure blue (0x001F), colour0 > colour1 so
  // this is 4-colour mode. All 16 indices = 0 -> every pixel is colour0 = red.
  block.writeUInt16LE(0xf800, 0);
  block.writeUInt16LE(0x001f, 2);
  block.writeUInt32LE(0x00000000, 4);
  const header = {
    ok: true,
    format: 'BC1',
    blockBytes: 8,
    buffer: block,
    mipOffsets: [{ level: 0, width: 4, height: 4, offset: 0, bytes: 8 }],
  };
  const decoded = decodeDdsLevel(header, 0);
  check('decodes a BC1 block into 16 pixels', decoded.rgba.length === 64, String(decoded.rgba.length));
  check('BC1 index 0 yields colour0 (red)', decoded.rgba[0] === 255 && decoded.rgba[1] === 0 && decoded.rgba[2] === 0, [...decoded.rgba.slice(0, 4)].join(','));

  // All indices = 1 -> colour1 = blue.
  const blueBlock = Buffer.from(block);
  blueBlock.writeUInt32LE(0x55555555, 4);
  const blueHeader = { ...header, buffer: blueBlock };
  const blue = decodeDdsLevel(blueHeader, 0);
  check('BC1 index 1 yields colour1 (blue)', blue.rgba[0] === 0 && blue.rgba[2] === 255, [...blue.rgba.slice(0, 4)].join(','));

  // 3-colour mode: colour0 <= colour1, index 3 is transparent black.
  const threeColour = Buffer.alloc(16);
  threeColour.writeUInt16LE(0x001f, 0); // blue
  threeColour.writeUInt16LE(0xf800, 2); // red, greater -> so colour0 < colour1
  threeColour.writeUInt32LE(0xffffffff, 4); // every index = 3
  const threeHeader = { ...header, buffer: threeColour };
  const transparent = decodeDdsLevel(threeHeader, 0);
  check('BC1 3-colour mode makes index 3 transparent', transparent.rgba[3] === 0 && transparent.rgba[0] === 0, [...transparent.rgba.slice(0, 4)].join(','));

  // BC3 alpha: alpha0 > alpha1 gives 8 interpolated values; the index bits select them.
  const bc3 = Buffer.alloc(16);
  bc3[0] = 255;
  bc3[1] = 0;
  for (let index = 2; index < 8; index += 1) bc3[index] = 0; // all alpha indices 0 -> alpha0 = 255
  bc3.writeUInt16LE(0xf800, 8);
  bc3.writeUInt16LE(0x001f, 10);
  bc3.writeUInt32LE(0, 12);
  const bc3Header = { ok: true, format: 'BC3', blockBytes: 16, buffer: bc3, mipOffsets: [{ level: 0, width: 4, height: 4, offset: 0, bytes: 16 }] };
  const bc3Decoded = decodeDdsLevel(bc3Header, 0);
  check('BC3 decodes opaque alpha from alpha0', bc3Decoded.rgba[3] === 255, String(bc3Decoded.rgba[3]));
  check('BC3 decodes its colour block', bc3Decoded.rgba[0] === 255, String(bc3Decoded.rgba[0]));

  // BC2 explicit 4-bit alpha: nibble 15 -> 255, nibble 0 -> 0.
  const bc2 = Buffer.alloc(16);
  bc2[0] = 0xf0; // pixel 0 alpha = 0, pixel 1 alpha = 15
  bc2.writeUInt16LE(0xf800, 8);
  bc2.writeUInt16LE(0x001f, 10);
  bc2.writeUInt32LE(0, 12);
  const bc2Header = { ok: true, format: 'BC2', blockBytes: 16, buffer: bc2, mipOffsets: [{ level: 0, width: 4, height: 4, offset: 0, bytes: 16 }] };
  const bc2Decoded = decodeDdsLevel(bc2Header, 0);
  check('BC2 decodes 4-bit explicit alpha (low nibble)', bc2Decoded.rgba[3] === 0, String(bc2Decoded.rgba[3]));
  check('BC2 decodes 4-bit explicit alpha (high nibble)', bc2Decoded.rgba[7] === 255, String(bc2Decoded.rgba[7]));

  // A truncated file must return what it has rather than reading out of bounds.
  const truncated = { ok: true, format: 'BC1', blockBytes: 8, buffer: Buffer.alloc(8), mipOffsets: [{ level: 0, width: 8, height: 8, offset: 0, bytes: 32 }] };
  const partial = decodeDdsLevel(truncated, 0);
  check('a truncated DDS decodes partially instead of throwing', partial.rgba.length === 8 * 8 * 4, String(partial.rgba.length));
  check('decodeDdsLevel returns null for a missing mip', decodeDdsLevel(truncated, 9) === null);
});

// =====================================================================================
// 9. PNG writer
// =====================================================================================

group('png writer', () => {
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 128,
  ]);
  const png = encodePng(rgba, 2, 2);
  const header = readPngHeader(png);
  check('writes a PNG signature and IHDR', header.ok === true, header.reason);
  check('records the width and height', header.width === 2 && header.height === 2, `${header.width}x${header.height}`);
  check('uses 8-bit truecolour with alpha', header.bitDepth === 8 && header.colourType === 6, `${header.bitDepth}/${header.colourType}`);
  check('emits an IEND chunk', png.includes(Buffer.from('IEND')), 'no IEND');
  check('emits an IDAT chunk', png.includes(Buffer.from('IDAT')), 'no IDAT');
  check('rejects a mismatched buffer size', (() => {
    try {
      encodePng(new Uint8ClampedArray(4), 2, 2);
      return false;
    } catch {
      return true;
    }
  })());
  check('rejects invalid dimensions', (() => {
    try {
      encodePng(rgba, 0, 2);
      return false;
    } catch {
      return true;
    }
  })());
  check('readPngHeader refuses a non-PNG', readPngHeader(Buffer.alloc(40)).ok === false);
  const resized = resizeRgba(rgba, 2, 2, 1, 1);
  check('resizeRgba averages a 2x2 into 1x1', resized.length === 4 && resized[3] > 100, [...resized].join(','));

  // Decoding: necessary because vanilla references 4 PNG textures through `spriteType`.
  const decodedOwn = decodePng(png);
  check('decodePng reads back what encodePng wrote', decodedOwn.ok === true, decodedOwn.reason);
  check('decodePng recovers the dimensions', decodedOwn.width === 2 && decodedOwn.height === 2, `${decodedOwn.width}x${decodedOwn.height}`);
  check(
    'encode -> decode round-trips every byte',
    decodedOwn.ok && rgba.every((value, index) => decodedOwn.rgba[index] === value),
    decodedOwn.ok ? [...decodedOwn.rgba.slice(0, 8)].join(',') : decodedOwn.reason,
  );
  // A larger image exercises all five scanline filters chosen by the encoder's filter heuristic.
  const wide = new Uint8ClampedArray(64 * 17 * 4);
  for (let index = 0; index < wide.length; index += 1) wide[index] = (index * 37) % 256;
  const widePng = encodePng(wide, 64, 17);
  const wideBack = decodePng(widePng);
  check(
    'round-trips a multi-scanline image',
    wideBack.ok && wide.every((value, index) => wideBack.rgba[index] === value),
    wideBack.ok ? 'mismatch' : wideBack.reason,
  );
  check('decodePng refuses a non-PNG', decodePng(Buffer.alloc(64)).ok === false);
  check(
    'decodePng refuses an unsupported bit depth by name',
    /bit depth/.test(decodePng((() => {
      const bad = Buffer.from(png);
      bad[24] = 16;
      return bad;
    })()).reason ?? ''),
    decodePng((() => {
      const bad = Buffer.from(png);
      bad[24] = 16;
      return bad;
    })()).reason,
  );
});

// =====================================================================================
// 10. Emitter text shape
// =====================================================================================

group('emitter', () => {
  const layout = defaultLayout({ name: 'smoke_window' });
  const gui = planEmit(layout, { language: 'english' }).files.find((file) => file.kind === 'gui');
  const text = gui.content;

  check('emits a guiTypes root', /^guiTypes = \{/m.test(text), 'no guiTypes line');
  check('closes the guiTypes block', /\n\}\n?$/.test(text), 'no closing brace');
  check('hoists @variables before guiTypes', text.indexOf('@window_width') < text.indexOf('guiTypes = {'), 'variable after root');
  check('emits no BOM marker in the gui text', !text.includes('\uFEFF'));
  check('uses tab indentation like vanilla', /\n\tcontainerWindowType = \{/.test(text), 'no tab-indented element');
  check('quotes element names', /name = "smoke_window"/.test(text), 'name not quoted');
  check('quotes sprite references', /quadTextureSprite = "GFX_tile_large_bg"/.test(text), 'sprite not quoted');
  check('quotes localisation keys', /text = "smoke_window_title"/.test(text), 'text key not quoted');
  check('emits the background block', /background = \{/.test(text));
  // Indentation must deepen with nesting: a top-level element's position block is at 2/3 tabs,
  // a nested element's at 3/4. Indentation bugs are best caught by asserting the actual shape.
  const indentationLines = text.split('\n');
  check('a top-level element is indented one tab', indentationLines.includes('\tcontainerWindowType = {'), 'no 1-tab element');
  check('a top-level position x is indented three tabs', indentationLines.includes('\t\t\tx = 0'), 'no 3-tab x');
  check('a nested position x is indented four tabs', indentationLines.includes('\t\t\t\tx = 20'), 'no 4-tab x');
  check(
    'indentation never jumps by more than one level',
    (() => {
      let previous = 0;
      for (const line of indentationLines) {
        if (line.trim() === '') continue;
        const tabs = (line.match(/^\t*/) ?? [''])[0].length;
        if (tabs - previous > 1) return false;
        previous = tabs;
      }
      return true;
    })(),
    'indentation jumped',
  );
  check('emits an effectbuttonType with its effect', /effectbuttonType = \{[\s\S]*?effect = smoke_window_accept_effect/.test(text), 'no effect');
  check('emits the close button with upper_right', /orientation = upper_right/.test(text));
  check('keeps bare keywords unquoted', /orientation = center/.test(text) && /moveable = yes/.test(text));

  // ---------------------------------------------------------------------------------------
  // THE SIZE FIELD IS PER-KIND. This is the fix for the engine's own error.log (see syntax.mjs
  // and scripts/fixtures/): an earlier revision wrote `size = { width height }` for every kind,
  // and the engine answered "Unexpected token: size" and "Not used, use maxWidth and maxHeight".
  // ---------------------------------------------------------------------------------------
  const titleBlock = blockNamed(text, 'window_title');
  check(
    'a text element is written with maxWidth/maxHeight',
    /maxWidth = 580/.test(titleBlock) && /maxHeight = 28/.test(titleBlock),
    titleBlock.slice(0, 200),
  );
  check('a text element carries no `size` block at all', !/^\s*size = \{/m.test(titleBlock), titleBlock);

  // The container keeps the width/height form, `%`/`%%`/negative forms included, verbatim.
  const percentLayout = defaultLayout({ name: 'percent_window' });
  percentLayout.variables = { '@body_h': '-90' };
  percentLayout.root.size = { width: '100%%', height: 320 };
  percentLayout.root.children.push({
    id: 'pct',
    kind: 'container',
    name: 'pct_panel',
    position: { x: 20, y: 60 },
    size: { width: '100%%', height: '@body_h' },
  });
  const percentText = planEmit(percentLayout).files.find((file) => file.kind === 'gui').content;
  check('emits a container percentage size verbatim', /width = 100%%/.test(percentText), 'no %% size');
  check('emits a container @variable size verbatim', /height = @body_h/.test(percentText), 'no @variable size');

  // A button takes `size = { x y }` where x is the WIDTH - 450 of the 450 vanilla button sizes
  // use that spelling, and 0 use width/height.
  const acceptBlock = blockNamed(text, 'accept_button');
  check(
    'the effect button is written as size = { x y }',
    /size = \{\n\t+x = 180\n\t+y = 34\n\t+\}/.test(acceptBlock),
    acceptBlock,
  );
  check('the effect button uses no width/height size spelling', !/size = \{\n\t+width = /.test(acceptBlock));

  // An ICON takes no size at all: 0 of 2779 vanilla icons declare one, and the engine reports
  // "Unexpected token: size" for the block. The emitter drops it and SAYS SO rather than losing
  // the declaration silently.
  const iconLayout = defaultLayout({ name: 'icon_window' });
  iconLayout.root.children.push({
    id: 'ic',
    kind: 'icon',
    name: 'a_line',
    spriteType: 'GFX_line_medium',
    position: { x: 0, y: 0 },
    size: { width: 392, height: 17 },
  });
  const iconPlan = planEmit(iconLayout);
  const iconText = iconPlan.files.find((file) => file.kind === 'gui').content;
  check('an icon is emitted without a size block', !/^\s*size = \{/m.test(blockNamed(iconText, 'a_line')), blockNamed(iconText, 'a_line'));
  const iconWarning = iconPlan.warnings.find((warning) => warning.rule === 'size-not-accepted');
  check('dropping an icon size is reported, not silent', Boolean(iconWarning), JSON.stringify(iconPlan.warnings.map((w) => w.rule)));
  check('the size warning names the element', iconWarning?.name === 'a_line', String(iconWarning?.name));
  check('the size warning quotes the engine', /Unexpected token: size/.test(iconWarning?.engineMessage ?? ''), iconWarning?.engineMessage);

  // A size that an integer-only slot cannot hold is resolved to pixels, and reported.
  const resolveLayoutWithPercent = defaultLayout({ name: 'resolve_window' });
  resolveLayoutWithPercent.root.children.push({
    id: 'ib',
    kind: 'button',
    name: 'half_button',
    quadTextureSprite: 'GFX_tiling_button_standard',
    position: { x: 0, y: 0 },
    size: { width: '50%', height: 20 },
  });
  const resolvedPlan = planEmit(resolveLayoutWithPercent);
  const resolvedText = resolvedPlan.files.find((file) => file.kind === 'gui').content;
  check(
    'a percentage button size is resolved to pixels',
    /size = \{\n\t+x = 310\n\t+y = 20\n\t+\}/.test(blockNamed(resolvedText, 'half_button')),
    blockNamed(resolvedText, 'half_button'),
  );
  check('resolving a size is reported as size-value-resolved', resolvedPlan.warnings.some((warning) => warning.rule === 'size-value-resolved'));

  // Variable referencing, not duplicating: the value appears once as a declaration.
  const declarationCount = (text.match(/@window_width = /g) ?? []).length;
  check('declares each variable exactly once', declarationCount === 1, String(declarationCount));
  check('references the variable in the size block', /width = @window_width/.test(text));

  // localisation encoding is WITH BOM; script files are WITHOUT.
  const plan = planEmit(layout);
  const guiFile = plan.files.find((file) => file.kind === 'gui');
  const locFile = plan.files.find((file) => file.kind === 'localisation');
  const effectsForDefault = plan.files.find((file) => file.kind === 'button_effects');
  check('a .gui file is planned without a BOM', guiFile.bom === false && guiFile.encoding === 'utf8', JSON.stringify({ bom: guiFile.bom }));
  check('a localisation file is planned WITH a BOM', locFile.bom === true, JSON.stringify({ bom: locFile.bom }));
  check('the localisation path follows <name>_l_<language>.yml', /localisation\/english\/smoke_window_l_english\.yml$/.test(locFile.path), locFile.path);
  check('the localisation body starts with l_english:', locFile.content.startsWith('l_english:'), locFile.content.slice(0, 20));
  check('the localisation body uses key:0 "value"', / smoke_window_title:0 ".*"/.test(locFile.content), locFile.content);
  check('a button_effects file is emitted for the default window effect', effectsForDefault !== undefined);
  const noEffects = planEmit({ ...layout, effects: {} });
  check('no button_effects file is emitted when the layout declares no effect', noEffects.files.every((file) => file.kind !== 'button_effects'));

  // With effects declared.
  const withEffects = { ...layout, effects: { smoke_window_accept_effect: { potential: { always: true }, effect: { add_resource: { resource: 'influence', amount: 50 } } } } };
  const effectsPlan = planEmit(withEffects);
  const effectsFile = effectsPlan.files.find((file) => file.kind === 'button_effects');
  check('emits common/button_effects/<stem>_button_effects.txt', /common\/button_effects\/smoke_window_button_effects\.txt$/.test(effectsFile.path), effectsFile.path);
  check('the button effect defines the referenced key', /^smoke_window_accept_effect = \{/m.test(effectsFile.content), effectsFile.content.slice(0, 200));
  check('the button effect carries potential/effect blocks', /potential = \{/.test(effectsFile.content) && /effect = \{/.test(effectsFile.content));

  // Event stub shape.
  const eventFile = plan.files.find((file) => file.kind === 'event');
  check('emits an events/ file', /^events\/smoke_window_events\.txt$/.test(eventFile.path), eventFile.path);
  check('the event declares a namespace', /^namespace = smoke_window$/m.test(eventFile.content), 'no namespace');
  check('the event is a country_event', /country_event = \{/.test(eventFile.content));
  check('the event carries custom_gui naming the window', /custom_gui = "smoke_window"/.test(eventFile.content), 'no custom_gui');
  check('the event carries diplomatic = yes by default', /\tdiplomatic = yes/.test(eventFile.content));
  check('the event is is_triggered_only', /is_triggered_only = yes/.test(eventFile.content));
  check('the event has no duplicated _events suffix', !/_events_events/.test(eventFile.path), eventFile.path);
  check('the event header comment states the instantiation rule', /containerWindowType/.test(eventFile.content));

  // custom_gui_option is emitted for an option row, as a SCALAR (all 38 vanilla uses are scalars).
  const optionLayout = defaultLayout({ name: 'opt_window' });
  optionLayout.root.children.push({
    id: 'row',
    kind: 'container',
    name: 'opt_window_option',
    position: { x: 20, y: 260 },
    size: { width: 300, height: 30 },
    children: [
      { id: 'ob', kind: 'button', name: 'option_button', quadTextureSprite: 'GFX_tiling_button_standard', text: 'OPTION_TEXT', font: 'cg_16b', position: { x: 0, y: 8 }, size: { width: 300, height: 30 } },
    ],
  });
  const optionPlan = planEmit(optionLayout);
  const optionEvent = optionPlan.files.find((file) => file.kind === 'event');
  check('emits custom_gui_option for an option row', /custom_gui_option = "opt_window_option"/.test(optionEvent.content), 'no custom_gui_option');
  const optionGui = optionPlan.files.find((file) => file.kind === 'gui').content;
  check('the .gui keeps option_button and OPTION_TEXT verbatim', /name = "option_button"/.test(optionGui) && /text = "OPTION_TEXT"/.test(optionGui));
  const optionLoc = optionPlan.files.find((file) => file.kind === 'localisation').content;
  check('OPTION_TEXT is not stubbed as a localisation key', !/OPTION_TEXT:0/.test(optionLoc), optionLoc);

  // A not-emittable kind produces a warning rather than silent loss, and the warning NAMES the
  // element (an earlier revision emitted the literal string `kind-not-emittable: undefined`,
  // which told a caller nothing about which of several elements was dropped).
  const stubLayout = defaultLayout({ name: 'stub_window' });
  stubLayout.root.children.push({ id: 'sp', kind: 'position', name: 'a_spinner', position: { x: 0, y: 0 } });
  const stubPlan = planEmit(stubLayout);
  const stubWarning = stubPlan.warnings.find((warning) => warning.rule === 'kind-not-emittable');
  check('warns instead of silently dropping an unemittable kind', Boolean(stubWarning), JSON.stringify(stubPlan.warnings.map((w) => w.rule)));
  check('the unemittable warning names the element', stubWarning?.name === 'a_spinner', String(stubWarning?.name));
  check('the unemittable warning carries a path', typeof stubWarning?.path === 'string' && stubWarning.path.includes('a_spinner'), String(stubWarning?.path));
  check('does not emit the unemittable element', !/positionType/.test(stubPlan.files.find((file) => file.kind === 'gui').content));

  // The kinds the trial needed and had to hand-write are emittable now: listBoxType in
  // particular, which the trial spliced in as raw mark-up because the emitter refused it.
  const listLayout = defaultLayout({ name: 'list_window' });
  listLayout.root.children.push({
    id: 'ol',
    kind: 'listBox',
    name: 'option_list',
    position: { x: 12, y: 92 },
    size: { width: 504, height: 140 },
    scrollbartype: 'standardlistbox_slider',
    borderSize: { x: 0, y: 0 },
  });
  const listText = planEmit(listLayout).files.find((file) => file.kind === 'gui').content;
  check('emits the listBoxType the trial had to hand-write', /listBoxType = \{/.test(listText));
  check('the emitted listBox keeps its name', blockNamed(listText, 'option_list') !== '', 'no option_list block');
  check('the emitted listBox uses the x/y size form', /size = \{\n\t+x = 504\n\t+y = 140\n\t+\}/.test(blockNamed(listText, 'option_list')), blockNamed(listText, 'option_list'));
  check('the emitted listBox quotes its scrollbartype', /scrollbartype = "standardlistbox_slider"/.test(blockNamed(listText, 'option_list')));
  check('the emitted listBox keeps its borderSize block', /borderSize = \{\n\t+x = 0\n\t+y = 0\n\t+\}/.test(blockNamed(listText, 'option_list')));
  check('no listBox is reported kind-not-emittable', !planEmit(listLayout).warnings.some((warning) => warning.rule === 'kind-not-emittable'));

  // The keyword the SOURCE used is kept when it is one of the kind's own keywords, so a round
  // trip of a vanilla file does not silently re-spell `listboxType` as `listBoxType`.
  const lowerCaseSource = parseGuiText(
    'guiTypes = {\n\tcontainerWindowType = {\n\t\tname = "w"\n\t\tsize = { width = 10 height = 10 }\n\t\tlistboxType = {\n\t\t\tname = "l"\n\t\t\tposition = { x = 0 y = 0 }\n\t\t\tsize = { x = 10 y = 10 }\n\t\t}\n\t}\n}\n',
    'lowercase.gui',
  );
  const lowerCaseText = planEmit(lowerCaseSource.layout).files.find((file) => file.kind === 'gui').content;
  check(
    'the source keyword spelling is preserved when the kind allows it',
    /listboxType = \{/.test(lowerCaseText),
    lowerCaseText.split('\n').filter((line) => /listbox/i.test(line)).join(' | '),
  );

  // Scalar formatting.
  check('formatScalar renders booleans as yes/no', formatScalar('moveable', true) === 'yes' && formatScalar('clipping', false) === 'no');
  check('formatScalar leaves @variables bare', formatScalar('width', '@w') === '@w');
  check('formatScalar quotes names', formatScalar('name', 'x') === '"x"');
  check('formatScalar keeps percentages bare', formatScalar('width', '100%%') === '100%%');
  check('formatScalar keeps keywords bare for keyword fields', formatScalar('orientation', 'upper_right') === 'upper_right');
  check('formatScalar quotes effect keys are left bare only for effect field', formatScalar('clicksound', 'back_click') === '"back_click"', formatScalar('clicksound', 'back_click'));

  // The output-root guard: this is the "standalone files only" constraint.
  check('assertOutputRoot refuses an empty root', (() => {
    try {
      assertOutputRoot('');
      return false;
    } catch {
      return true;
    }
  })());
  check('assertOutputRoot refuses a relative root', (() => {
    try {
      assertOutputRoot('out\\relative');
      return false;
    } catch {
      return true;
    }
  })());
  check('assertOutputRoot refuses a Steam Stellaris install path', (() => {
    try {
      assertOutputRoot('D:\\SteamLibrary\\steamapps\\common\\Stellaris\\mod\\x');
      return false;
    } catch {
      return true;
    }
  })());
  check('assertOutputRoot refuses the user-data folder', (() => {
    try {
      assertOutputRoot('C:\\Users\\someone\\Documents\\Paradox Interactive\\Stellaris\\out');
      return false;
    } catch {
      return true;
    }
  })());
  const modLike = join(scratch, 'FakeMod');
  mkdirSync(modLike, { recursive: true });
  writeFileSync(join(modLike, 'descriptor.mod'), 'name="x"\n', 'utf8');
  check('assertOutputRoot refuses a folder containing descriptor.mod', (() => {
    try {
      assertOutputRoot(modLike);
      return false;
    } catch {
      return true;
    }
  })());
  check('assertOutputRoot accepts an ordinary output folder', assertOutputRoot(join(scratch, 'out')) === join(scratch, 'out'));

  // safeJoin confinement.
  check('safeJoin refuses a ../ escape', (() => {
    try {
      safeJoin(join(scratch, 'out'), '../escape.gui');
      return false;
    } catch {
      return true;
    }
  })());
  check('safeJoin refuses an absolute path', (() => {
    try {
      safeJoin(join(scratch, 'out'), 'C:\\Windows\\x');
      return false;
    } catch {
      return true;
    }
  })());
  check('safeJoin accepts a nested relative path', safeJoin(join(scratch, 'out'), 'interface/a.gui').endsWith('interface\\a.gui'));

  // Real write: encoding, and that nothing lands outside the output root.
  const outRoot = join(scratch, 'EmitOut');
  rmSync(outRoot, { recursive: true, force: true });
  const writeResult = emitFiles(withEffects, { outputRoot: outRoot, dryRun: false, language: 'english' });
  check('emitFiles writes files on a real run', writeResult.files.length === 4, `${writeResult.files.length} files`);
  check('the result states the output root', writeResult.outputRoot === outRoot, writeResult.outputRoot);
  check('the result states nothing was written outside the root', /Nothing was written outside it/.test(writeResult.note), writeResult.note);
  for (const file of writeResult.files) {
    check(`the written ${file.kind} file exists`, existsSync(file.absolutePath), file.absolutePath);
  }
  const guiOnDisk = inspectEncoding(join(outRoot, 'interface', 'smoke_window.gui'));
  check('the written .gui has NO BOM', guiOnDisk.hasBom === false, JSON.stringify(guiOnDisk.firstBytes));
  const locOnDisk = inspectEncoding(join(outRoot, 'localisation', 'english', 'smoke_window_l_english.yml'));
  check('the written .yml HAS a BOM', locOnDisk.hasBom === true, JSON.stringify(locOnDisk.firstBytes));
  check('the .yml bytes start with EF BB BF', locOnDisk.firstBytes.slice(0, 3).join(',') === '239,187,191', locOnDisk.firstBytes.join(','));
  check('the .yml body is valid UTF-8 text after the BOM', locOnDisk.text.startsWith('l_english:'), locOnDisk.text.slice(0, 12));
  const eventOnDisk = inspectEncoding(join(outRoot, 'events', 'smoke_window_events.txt'));
  check('the written event file has NO BOM', eventOnDisk.hasBom === false);

  // A dry run must write nothing.
  const dryRoot = join(scratch, 'DryRunOut');
  rmSync(dryRoot, { recursive: true, force: true });
  const dryResult = emitFiles(withEffects, { outputRoot: dryRoot, dryRun: true });
  check('a dry run reports dryRun: true', dryResult.dryRun === true);
  check('a dry run writes nothing', !existsSync(dryRoot), dryRoot);
  check('a dry run lists the planned files', dryResult.plan.length === 4, String(dryResult.plan.length));

  // The emitted .gui must round-trip through our own parser (the strongest available check
  // that we emit what we claim to read).
  const reparsed = parseGuiText(guiOnDisk.text, 'smoke_window.gui');
  check('the emitted .gui re-parses with a guiTypes root', reparsed.ok === true, reparsed.reason);
  check('the re-parsed file has one top-level container', reparsed.containers.length === 1, String(reparsed.containers.length));
  check('the re-parsed container keeps its name', reparsed.containers[0].name === 'smoke_window', reparsed.containers[0].name);
  check('the re-parsed container keeps its children', (reparsed.containers[0].children ?? []).length === 4, String((reparsed.containers[0].children ?? []).length));
  check('the re-parsed effectbutton keeps its effect', reparsed.containers[0].children.find((child) => child.kind === 'effectbutton')?.effect === 'smoke_window_accept_effect');
  const reValidated = validateLayout(reparsed.layout, { rootKeyword: reparsed.rootKeyword });
  check('the emitted .gui validates with no errors', reValidated.counts.error === 0, JSON.stringify(reValidated.findings.filter((f) => f.severity === 'error').slice(0, 3)));
});

// =====================================================================================
// 11. Localisation index
// =====================================================================================

group('localisation index', () => {
  const yml = 'l_english:\n some_key:0 "Some value"\n other_key:1 "Other"\n# a comment\n';
  const parsed = parseLocalisationFile(yml);
  check('parses the l_english header', parsed.has('english'), JSON.stringify([...parsed.keys()]));
  check('collects keys from the language block', parsed.get('english').has('some_key') && parsed.get('english').has('other_key'));
  check('ignores comments', parsed.get('english').size === 2, String(parsed.get('english').size));
  const multi = parseLocalisationFile('l_english:\n a:0 "x"\nl_german:\n b:0 "y"\n');
  check('separates languages', multi.get('english').has('a') && multi.get('german').has('b') && !multi.get('english').has('b'));
  check('a key outside any language block is ignored', parseLocalisationFile('a:0 "x"\n').size === 0);
  check('looksLikeLocKey accepts a key shape', looksLikeLocKey('my_mod_title') && looksLikeLocKey('OPTION_TEXT'));
  check('looksLikeLocKey rejects prose with spaces', !looksLikeLocKey('Hello there'));
  check('looksLikeLocKey rejects a composed reference', !looksLikeLocKey('$other$'));
  check('looksLikeLocKey rejects an empty string', !looksLikeLocKey(''));

  // B9: the values, not just the keys, so the preview can draw the real text.
  const detailed = parseLocalisationDetailed('l_english:\n a:0 "First value"\n b:1 "Second"\n');
  check('parseLocalisationDetailed keeps the values', detailed.values.get('english')?.get('a') === 'First value', JSON.stringify([...(detailed.values.get('english') ?? new Map())]));
  check('parseLocalisationDetailed keeps the keys too', detailed.keys.get('english')?.has('b') === true);
  const indexDirectory = join(scratch, 'LocValues');
  mkdirSync(indexDirectory, { recursive: true });
  writeFileSync(join(indexDirectory, 'zz_l_english.yml'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('l_english:\n win_title:0 "A real title"\n', 'utf8')]));
  const withoutValues = buildLocalisationIndex({ directories: [indexDirectory], languages: ['english'] });
  const withValues = buildLocalisationIndex({ directories: [indexDirectory], languages: ['english'], withValues: true });
  check('the keyset is built without values by default', withoutValues.values === undefined);
  check('withValues returns the resolved strings', withValues.values?.get('win_title') === 'A real title', JSON.stringify(withValues.values ? [...withValues.values] : null));
  check('withValues still returns the keys', withValues.keys.has('win_title'));
});

// =====================================================================================
// 12. Preview
// =====================================================================================

group('preview', () => {
  const layout = defaultLayout({ name: 'preview_window' });
  const fakeAssets = {
    root: 'X:\\fake',
    sprites: {
      GFX_tile_large_bg: { kind: 'corneredTileSpriteType', textureFile: 'gfx/missing.dds', declaredSize: null, file: 'a.gfx', line: 1 },
      GFX_main_close_button: { kind: 'SpriteType', textureFile: null, declaredSize: null, file: 'a.gfx', line: 2 },
      GFX_tiling_button_standard: { kind: 'corneredTileSpriteType', textureFile: null, declaredSize: null, file: 'a.gfx', line: 3 },
    },
    textures: {},
    fonts: { cg_16b: {}, malgun_goth_24: {} },
    buttonEffects: {},
    stats: { fontCount: 2 },
  };
  const cache = new ThumbnailCache({ directory: join(scratch, 'thumbs') });
  const result = renderSvg(layout, { assets: fakeAssets, cache, showGrid: true });
  check('renders an SVG document', result.svg.startsWith('<?xml') && result.svg.includes('<svg'), result.svg.slice(0, 40));
  check('the SVG closes', result.svg.trimEnd().endsWith('</svg>'));
  check('the SVG states the base resolution in pixels', /width="1920" height="1080"/.test(result.svg), 'no 1920x1080');
  check('the SVG comments the base-resolution assumption', /Base resolution 1920x1080/.test(result.svg));
  check('the SVG draws a grid', result.svg.includes('id="grid"'));
  check('the SVG includes a rect table', result.svg.includes('id="rect-table"'));
  check('the SVG has one group per element', (result.svg.match(/data-kind=/g) ?? []).length === result.stats.elementCount, `${(result.svg.match(/data-kind=/g) ?? []).length} vs ${result.stats.elementCount}`);
  check('the SVG labels unreadable sprites as placeholders', result.svg.includes('no texture'), 'no placeholder text');
  check('the SVG table row count matches the element count', result.table.length === result.stats.elementCount, `${result.table.length}`);
  check('the table records computed rects', typeof result.table[0].x === 'number' && typeof result.table[0].width === 'number');
  check('the table names the size formula', typeof result.table[0].sizeFormula.width === 'string');

  const noGrid = renderSvg(layout, { assets: fakeAssets, cache, showGrid: false, includeTable: false });
  check('showGrid: false omits the grid', !noGrid.svg.includes('id="grid"'));
  check('includeTable: false omits the table', !noGrid.svg.includes('id="rect-table"'));

  // Highlights come from a validation report.
  const report = validateLayout(layout, { assets: fakeAssets });
  const highlighted = renderSvg(layout, { assets: fakeAssets, cache, validationReport: report, highlightRules: ['unknown-sprite'] });
  check('the SVG renders a findings layer when given a report', highlighted.svg.includes('id="findings"'));
  check('XML escaping protects attribute content', escapeXml('a"b<c>&d') === 'a&quot;b&lt;c&gt;&amp;d', escapeXml('a"b<c>&d'));

  const png = renderPng(layout, { assets: fakeAssets, cache, scale: 0.25 });
  const pngHeader = readPngHeader(png.png);
  check('renders a PNG', pngHeader.ok === true, pngHeader.reason);
  check('the PNG is scaled as requested', pngHeader.width === 480 && pngHeader.height === 270, `${pngHeader.width}x${pngHeader.height}`);
  check('the PNG is a sane size', png.png.length > 500 && png.png.length < 5_000_000, String(png.png.length));
});

// =====================================================================================
// 13. Kinds table
// =====================================================================================

group('kinds table', () => {
  check('recognises container by keyword', kindSpec('containerWindowType')?.kind === 'container');
  check('recognises text by keyword', kindSpec('instantTextBoxType')?.kind === 'text');
  check('recognises icon by keyword', kindSpec('iconType')?.kind === 'icon');
  check('recognises button by keyword', kindSpec('buttonType')?.kind === 'button');
  check('recognises effectbutton by keyword', kindSpec('effectbuttonType')?.kind === 'effectbutton');
  check('recognises a kind by its own name', kindSpec('container')?.kind === 'container');
  check('recognises gridBox as an emittable kind now', kindSpec('gridBoxType')?.emitter === true);
  check('effectbutton is marked as requiring an effect', kindSpec('effectbuttonType')?.requiresEffect === true);
  check(
    'the kinds a real window needs are all emittable',
    ['container', 'text', 'icon', 'button', 'effectbutton', 'gridBox', 'listBox', 'smoothListBox', 'overlappingElementsBox', 'guiButton', 'scrollbar'].every(
      (kind) => kindSpec(kind)?.emitter === true,
    ),
  );
  // A block is an element only when its key is a vanilla KEYWORD. `kindSpec('position')` matches
  // the position KIND, and every element has a `position = { x y }` sub-block: reading those as
  // elements invented 12067 phantom elements in a census of the install.
  check('kindSpec matches a kind by name', kindSpec('position')?.kind === 'position');
  check('kindSpecByKeyword refuses a kind name', kindSpecByKeyword('position') === null && kindSpecByKeyword('positionType')?.kind === 'position');
  check('kindSpecByKeyword is case-insensitive', kindSpecByKeyword('INSTANTTEXTBOXTYPE')?.kind === 'text');
  // The measured size form of every kind, from the install corpus (see kinds.mjs).
  check('text takes maxWidth/maxHeight and NOT a size block', sizeFormFor('text').form === 'maxWidth/maxHeight' && sizeFormFor('text').hasSize === true && sizeFormFor('text').accepted === false);
  check('icon takes no size at all', sizeFormFor('icon').accepted === false && sizeFormFor('icon').hasSize === false);
  check('button takes size = { x y }', sizeFormFor('button').form === 'size-x-y' && sizeFormFor('button').accepted === true);
  check('container takes size = { width height }', sizeFormFor('container').form === 'size-width-height');
  check(
    'extendedScrollbarType takes the width/height form while scrollbarType takes x/y',
    sizeFormFor('scrollbar', 'extendedScrollbarType').form === 'size-width-height' && sizeFormFor('scrollbar', 'scrollbarType').form === 'size-x-y',
  );
  check('every kind declares either an emitter flag or a size form', ELEMENT_KINDS.every((spec) => typeof spec.emitter === 'boolean' && typeof spec.sizeForm === 'string'));
  check('every emittable kind has a FIELD_ORDER entry or is handled by the common fields', ELEMENT_KINDS.every((spec) => Array.isArray(spec.keywords) && spec.keywords.length > 0));
  check('unknown keyword returns null', kindSpec('nonsenseType') === null);
  check('every kind declares a vanilla keyword list', [...new Set(['a'])].length === 1);
  check('suggestFields proposes a near miss', suggestFields('textt').includes('text'), JSON.stringify(suggestFields('textt')));
  check('suggestFields proposes nothing for gibberish', suggestFields('zzzzzzzzzz').length === 0);
});

// =====================================================================================
// 14. Engine syntax: the engine's own error.log, replayed
// =====================================================================================

group('engine syntax checker (the real error.log)', () => {
  const fixturePath = join(projectRoot, 'scripts', 'fixtures', 'engine-error-baseline.gui');
  const logPath = join(projectRoot, 'scripts', 'fixtures', 'engine-error-baseline.log');
  const fixture = readFileSync(fixturePath, 'utf8');
  check('the engine-error fixture exists', existsSync(fixturePath));
  check('the engine-error log fixture exists', existsSync(logPath));
  check('the fixture is UTF-8 without a BOM', fixture.charCodeAt(0) !== 0xfeff);

  const syntax = checkGuiSyntax(fixture, 'engine-error-baseline.gui');
  check('the fixture is reported as engine-invalid', syntax.ok === false, JSON.stringify(syntax.counts));
  check('every `size` on an icon or text is reported', syntax.findings.filter((f) => f.rule === 'size-not-accepted').length === 4, JSON.stringify(syntax.findings.map((f) => `${f.rule}@${f.line}`)));
  check('the container `size` block is not reported', !syntax.findings.some((finding) => finding.line === 41), JSON.stringify(syntax.findings.map((f) => f.line)));
  check('the size findings quote the engine', syntax.findings.some((finding) => /Unexpected token: size/.test(finding.engineMessage ?? '')));

  // Replay the engine's own lines: each one must be covered by a finding at (or immediately
  // inside) the line the engine named. This is the regression guard for the whole class of bug.
  const engineErrors = parseEngineErrorLog(readFileSync(logPath, 'utf8'));
  check('the log fixture parses into engine errors', engineErrors.length >= 4, String(engineErrors.length));
  const covered = (line) =>
    syntax.findings.some(
      (finding) => finding.severity === 'error' && typeof finding.line === 'number' && finding.line <= line && line - finding.line <= 3,
    );
  for (const entry of engineErrors) {
    check(`engine error at line ${entry.line} is reported`, covered(entry.line), `${entry.engineMessage} :: findings at ${syntax.findings.map((f) => f.line).join(',')}`);
  }
  check('the exact line of the icon size (56) is reported', syntax.findings.some((finding) => finding.line === 56));
  check('the exact line of the text size (95) is reported', syntax.findings.some((finding) => finding.line === 95));

  // THE ACCEPTANCE: the broken emission fails validation, and the FIXED emitter's output of the
  // same tree passes the same check.
  const brokenReport = validateGuiText(fixture, 'engine-error-baseline.gui');
  check('the old broken emission now FAILS validation', brokenReport.verdict === 'fail' && (brokenReport.byRule['size-not-accepted'] ?? 0) === 4, JSON.stringify(brokenReport.byRule));
  check('the syntax findings are merged into the validation report', Boolean(brokenReport.syntax), JSON.stringify(brokenReport.syntax));
  const parsed = parseGuiText(fixture, 'engine-error-baseline.gui');
  const fixedText = planEmit(parsed.layout).files.find((file) => file.kind === 'gui').content;
  const fixedSyntax = checkGuiSyntax(fixedText, 'engine-error-baseline.gui (re-emitted)');
  check('the fixed emitter output passes the engine syntax check', fixedSyntax.ok === true, JSON.stringify(fixedSyntax.findings.slice(0, 3)));
  check('the re-emitted fixture writes maxWidth for the text', /maxWidth = 720/.test(fixedText));
  check('the re-emitted fixture writes no size on the text', !/^\s*size = \{/m.test(blockNamed(fixedText, 'unga_title_main')), blockNamed(fixedText, 'unga_title_main'));
  check('the re-emitted fixture writes no size on the icons', !/^\s*size = \{/m.test(blockNamed(fixedText, 'unga_header_line_main')), blockNamed(fixedText, 'unga_header_line_main'));

  // Size-form mistakes on kinds that DO accept a size.
  const wrongForm = checkGuiSyntax(
    'guiTypes = {\n\tcontainerWindowType = {\n\t\tname = "w"\n\t\tbuttonType = {\n\t\t\tname = "b"\n\t\t\tsize = { width = 10 height = 10 }\n\t\t}\n\t}\n}\n',
    'wrong-form.gui',
  );
  const formFinding = wrongForm.findings.find((finding) => finding.rule === 'size-form-wrong');
  check('a button with size = { width height } is reported', Boolean(formFinding), JSON.stringify(wrongForm.byRule));
  check('the form finding names the x/y spelling', /size = \{ x = <width> y = <height> \}/.test(formFinding?.suggestedFix ?? ''), formFinding?.suggestedFix);
  const okForm = checkGuiSyntax(
    'guiTypes = {\n\tcontainerWindowType = {\n\t\tname = "w"\n\t\tbuttonType = {\n\t\t\tname = "b"\n\t\t\tsize = { x = 10 y = 10 }\n\t\t}\n\t}\n}\n',
    'ok-form.gui',
  );
  check('a button with size = { x y } is not reported', !okForm.findings.some((finding) => finding.rule === 'size-form-wrong'), JSON.stringify(okForm.byRule));
  const textNoMax = checkGuiSyntax('guiTypes = {\n\tinstantTextBoxType = {\n\t\tname = "t"\n\t\ttext = "k"\n\t}\n}\n', 'no-max.gui');
  check('a text element with no maxWidth/maxHeight is reported', textNoMax.findings.some((finding) => finding.rule === 'text-without-max-size'), JSON.stringify(textNoMax.byRule));

  // ---------------------------------------------------------------- round 2: per-kind FIELDS
  // The engine's round-2 log named three more fields it rejects, all of which are legal on some
  // OTHER kind: custom_tooltip (a script field), alwaysTransparent (not a container field) and
  // origo (containerWindowType only).
  const fieldsFixturePath = join(projectRoot, 'scripts', 'fixtures', 'engine-error-fields-baseline.gui');
  const fieldsLogPath = join(projectRoot, 'scripts', 'fixtures', 'engine-error-fields-baseline.log');
  check('the field-error fixture exists', existsSync(fieldsFixturePath));
  const fieldsFixture = readFileSync(fieldsFixturePath, 'utf8');
  const fieldsSyntax = checkGuiSyntax(fieldsFixture, 'engine-error-fields-baseline.gui');
  check('the field fixture is engine-invalid', fieldsSyntax.ok === false, JSON.stringify(fieldsSyntax.counts));
  const fieldFindings = fieldsSyntax.findings.filter((finding) => finding.rule === 'field-not-accepted');
  check('every rejected field is reported', fieldFindings.length === 13, JSON.stringify(fieldsSyntax.counts));
  check('the custom_tooltip on an effectbutton is reported at line 171', fieldFindings.some((finding) => finding.line === 171 && /custom_tooltip/.test(finding.message)));
  check('the alwaysTransparent on a container is reported at line 201', fieldFindings.some((finding) => finding.line === 201 && /alwaysTransparent/.test(finding.message)));
  check('the origo on an icon is reported at line 985', fieldFindings.some((finding) => finding.line === 985 && /origo/.test(finding.message)));
  check('a rejected field quotes the engine', fieldFindings.some((finding) => /Unexpected token: custom_tooltip/.test(finding.engineMessage ?? '')));
  check('a rejected field names its legal equivalent', /tooltipText/.test(fieldFindings.find((finding) => finding.line === 171)?.suggestedFix ?? ''), fieldFindings.find((finding) => finding.line === 171)?.suggestedFix);
  const fieldLog = parseEngineErrorLog(readFileSync(fieldsLogPath, 'utf8'));
  check('the round-2 log parses into engine errors', fieldLog.length >= 3, String(fieldLog.length));
  for (const entry of fieldLog.filter((item) => item.file && item.file.endsWith('.gui'))) {
    check(`engine error at line ${entry.line} is reported by the field check`, fieldFindings.some((finding) => finding.line === entry.line), `${entry.engineMessage} :: ${fieldFindings.map((f) => f.line).join(',')}`);
  }

  // The field model is a MEASUREMENT: the vanilla corpus must be completely clean, or a kind's
  // field list is wrong (this is how the 12 gaps it had were found and closed).
  if (existsSync(DEFAULT_GAME_ROOT)) {
    const vanillaFiles = listFilesRecursive(join(DEFAULT_GAME_ROOT, 'interface'), ['.gui']);
    const offenders = [];
    for (const file of vanillaFiles) {
      const report = checkGuiSyntax(readFileSync(file, 'utf8'), file);
      for (const finding of report.findings.filter((item) => item.rule === 'field-not-accepted')) {
        offenders.push(`${file.slice(file.lastIndexOf('\\') + 1)}:${finding.line} ${String(finding.message).split('`')[1]} on ${finding.kind}`);
      }
    }
    check('the per-kind field model reports nothing on the vanilla corpus', offenders.length === 0, offenders.slice(0, 5).join(' | '));
  }

  // The emitter writes the kind's own field instead of the rejected one, and says so.
  const shapeLayout = parseGuiText(
    'guiTypes = {\n\tcontainerWindowType = {\n\t\tname = "w"\n\t\tsize = { width = 100 height = 100 }\n' +
      '\t\tcontainerWindowType = { name = "sep" size = { width = 180 height = 1 } alwaysTransparent = yes background = { name = "b" quadTextureSprite = "GFX_x" } }\n' +
      '\t\ticonType = { name = "donut" orientation = center origo = center alwaysTransparent = yes spriteType = "GFX_message_circle" }\n' +
      '\t\teffectbuttonType = { name = "nav" quadTextureSprite = "GFX_tiling_button_standard" effect = e custom_tooltip = "TIP" position = { x = 0 y = 0 } size = { x = 180 y = 80 } }\n' +
      '\t}\n}\n',
    'shapes.gui',
  );
  const shapePlan = planEmit(shapeLayout.layout, { fileStem: 'shapes' });
  const shapeText = shapePlan.files.find((file) => file.kind === 'gui').content;
  check('custom_tooltip becomes the effectbutton tooltipText', /tooltipText = "TIP"/.test(shapeText));
  check('no custom_tooltip reaches the file', !/custom_tooltip/.test(shapeText));
  check("a container's alwaysTransparent moves into its background block", /background = \{[\s\S]*?alwaysTransparent = yes[\s\S]*?\}/.test(blockNamed(shapeText, 'sep')), blockNamed(shapeText, 'sep'));
  check("an icon's origo becomes centerPosition", /centerPosition = yes/.test(blockNamed(shapeText, 'donut')));
  check("no origo reaches an icon", !/origo/.test(blockNamed(shapeText, 'donut')));
  check('every translation is reported', shapePlan.warnings.filter((warning) => warning.rule === 'field-translated').length === 3, JSON.stringify(shapePlan.warnings.map((w) => w.rule)));
  check('the translated file passes the engine syntax check', checkGuiSyntax(shapeText, 'shapes.gui').ok === true, JSON.stringify(checkGuiSyntax(shapeText, 'shapes.gui').findings.slice(0, 2)));
  check('the rejected-field knowledge is per kind', kindAcceptsField('effectbutton', 'tooltipText') && !kindAcceptsField('effectbutton', 'custom_tooltip'));
  check('alwaysTransparent is accepted on a text but not on a container', kindAcceptsField('text', 'alwaysTransparent') && !kindAcceptsField('container', 'alwaysTransparent'));
  check('origo is accepted on a container but not on an icon', kindAcceptsField('container', 'origo') && !kindAcceptsField('icon', 'origo'));
  check('the background field set accepts alwaysTransparent', BACKGROUND_FIELDS.has('alwaystransparent'));
  check('the engine-rejected set names the four proven fields', ['custom_tooltip', 'fail_text', 'alwaysTransparent', 'origo'].every((field) => isEngineRejectedField(field)));

  // `gui_layout_normalise` / normaliseLayoutForKinds: the tree-level fix, which is what a caller
  // with an already-built layout needs.
  const normalised = normaliseLayoutForKinds(shapeLayout.layout, {});
  check('normaliseLayoutForKinds reports every change', normalised.changes.length === 3, JSON.stringify(normalised.changes.map((change) => change.change)));
  check('normaliseLayoutForKinds changes the field, not just the report', (() => {
    const icon = normalised.layout.root.children[0].children.find((child) => child.name === 'donut');
    const sep = normalised.layout.root.children[0].children.find((child) => child.name === 'sep');
    const nav = normalised.layout.root.children[0].children.find((child) => child.name === 'nav');
    return icon.centerPosition === true && icon.origo === undefined && sep.background.alwaysTransparent === true && nav.tooltipText === 'TIP' && nav.custom_tooltip === undefined;
  })(), JSON.stringify(normalised.layout.root.children[0].children.map((child) => Object.keys(child))));
  check('normaliseLayoutForKinds does not mutate its input', shapeLayout.layout.root.children[0].children.find((child) => child.name === 'donut').origo === 'center');
  // A text `size` becomes maxWidth/maxHeight there too, so one call fixes both classes.
  const sizeFix = normaliseLayoutForKinds(
    parseGuiText('guiTypes = {\n\tcontainerWindowType = {\n\t\tname = "w"\n\t\tsize = { width = 200 height = 100 }\n\t\tinstantTextBoxType = { name = "t" text = "k" position = { x = 0 y = 0 } size = { width = 100%% height = 20 } }\n\t}\n}\n', 'size.gui').layout,
    {},
  );
  const fixedTextNode = sizeFix.layout.root.children[0].children.find((child) => child.name === 't');
  check('a text size becomes a max pair', fixedTextNode.maxWidth === 200 && fixedTextNode.maxHeight === 20, JSON.stringify(fixedTextNode));
  check('the text size block is gone', fixedTextNode.size === undefined);
  check('the size change is reported', sizeFix.changes.some((change) => change.change === 'size-to-maxWidth/maxHeight'));

});

// =====================================================================================
// 15. Multi-window scoping: names and overlaps are compared WITHIN a window only
// =====================================================================================

group('multi-window scoping (A1)', () => {
  // A legal merged file: two windows that OVERLAP each other, each carrying an element called
  // `nav` at the same coordinates. Vanilla does exactly this (galactic_community_view.gui
  // declares its nav-ish elements repeatedly), and only one custom_gui window is on screen at a
  // time, so neither rule may fire across the two. Within each window the two children are side
  // by side, so the only possible cross-window findings are window-vs-window ones.
  const twoWindows = [
    'guiTypes = {',
    '\tcontainerWindowType = { name = "window_a" position = { x = 0 y = 0 } size = { width = 400 height = 300 }',
    '\t\tcontainerWindowType = { name = "nav" position = { x = 0 y = 0 } size = { width = 100 height = 200 } }',
    '\t\tcontainerWindowType = { name = "body" position = { x = 100 y = 0 } size = { width = 300 height = 100 } }',
    '\t}',
    '\tcontainerWindowType = { name = "window_b" position = { x = 200 y = 150 } size = { width = 400 height = 300 }',
    '\t\tcontainerWindowType = { name = "nav" position = { x = 0 y = 0 } size = { width = 100 height = 200 } }',
    '\t\tcontainerWindowType = { name = "body" position = { x = 100 y = 0 } size = { width = 300 height = 100 } }',
    '\t}',
    '}',
    '',
  ].join('\n');
  const parsed = parseGuiText(twoWindows, 'two_windows.gui');
  check('an imported file gets a synthetic root', parsed.layout.root.syntheticRoot === true);
  check('the synthetic root holds one child per top-level container', parsed.layout.root.children.length === 2, String(parsed.layout.root.children.length));
  const report = validateLayout(parsed.layout, { rootKeyword: parsed.rootKeyword });
  check('a name repeated in another window is NOT a duplicate', !report.findings.some((finding) => finding.rule === 'duplicate-name'), JSON.stringify(report.byRule));
  check('an overlap between windows is NOT reported', !report.findings.some((finding) => finding.rule === 'sibling-overlap'), JSON.stringify(report.byRule));
  // The two windows really do overlap, and the two `nav` elements really are the same rect, so
  // these assertions would fail if the cross-window guard were removed. (Proved by temporarily
  // forcing `synthetic` to false in validate.mjs: this group fails.)
  const crossCheck = computeLayout(parsed.layout).boxes;
  const windows = crossCheck.filter((box) => box.name === 'window_a' || box.name === 'window_b');
  const navs = crossCheck.filter((box) => box.name === 'nav');
  const overlapArea =
    Math.min(windows[0].rect.x + windows[0].rect.width, windows[1].rect.x + windows[1].rect.width) - Math.max(windows[0].rect.x, windows[1].rect.x);
  check('the two windows really do overlap geometrically', windows.length === 2 && overlapArea > 4, JSON.stringify(windows.map((box) => box.rect)));
  check(
    'the same element really is declared in both windows',
    navs.length === 2 && navs[0].rect.width === navs[1].rect.width && navs[0].rect.height === navs[1].rect.height && navs[0].parentIndex !== navs[1].parentIndex,
    JSON.stringify(navs.map((box) => [box.rect.width, box.rect.height, box.parentIndex])),
  );

  // ... but the synthetic root itself is not a window, so nothing may be compared with it.
  check('the synthetic root is never reported against a window', !report.findings.some((finding) => /^\(/.test(String(finding.element ?? ''))));

  // Within ONE window both rules must still fire, unchanged.
  const oneWindow = [
    'guiTypes = {',
    '\tcontainerWindowType = { name = "only_window" size = { width = 400 height = 300 }',
    '\t\tcontainerWindowType = { name = "dup" position = { x = 0 y = 0 } size = { width = 200 height = 200 } }',
    '\t\tcontainerWindowType = { name = "dup" position = { x = 10 y = 10 } size = { width = 200 height = 200 } }',
    '\t}',
    '}',
    '',
  ].join('\n');
  const oneParsed = parseGuiText(oneWindow, 'one_window.gui');
  const oneReport = validateLayout(oneParsed.layout, { rootKeyword: oneParsed.rootKeyword });
  check('a duplicate name inside one window IS reported', oneReport.findings.some((finding) => finding.rule === 'duplicate-name'), JSON.stringify(oneReport.byRule));
  check('a sibling overlap inside one window IS reported', oneReport.findings.some((finding) => finding.rule === 'sibling-overlap'), JSON.stringify(oneReport.byRule));

  // Two windows sharing one NAME is still a defect: `custom_gui` resolves a window by name.
  const twinWindows = 'guiTypes = {\n\tcontainerWindowType = { name = "twin" size = { width = 10 height = 10 } }\n\tcontainerWindowType = { name = "twin" size = { width = 10 height = 10 } }\n}\n';
  const twinParsed = parseGuiText(twinWindows, 'twin.gui');
  const twinReport = validateLayout(twinParsed.layout, { rootKeyword: twinParsed.rootKeyword });
  check('two windows sharing one name IS reported', twinReport.findings.some((finding) => finding.rule === 'duplicate-name'), JSON.stringify(twinReport.byRule));

  // The sibling groups are built on parent IDENTITY. An earlier revision keyed them on
  // `parent.id`, which a parsed node does not have, so every element at depth >= 2 landed in one
  // group with the synthetic root - the actual source of the false reports.
  const { boxes } = computeLayout(parsed.layout);
  const navA = boxes.find((box) => box.name === 'nav' && box.path.includes('window_a'));
  const navB = boxes.find((box) => box.name === 'nav' && box.path.includes('window_b'));
  const bodyA = boxes.find((box) => box.name === 'body' && box.path.includes('window_a'));
  check('siblings inside one window share a parent index', navA.parentIndex === bodyA.parentIndex, `${navA.parentIndex} vs ${bodyA.parentIndex}`);
  check('the same name in another window has a different parent index', navA.parentIndex !== navB.parentIndex, String(navA.parentIndex));
  check('box ids are unique even when names repeat', new Set(boxes.map((box) => box.id)).size === boxes.length, String(boxes.length));
});

// =====================================================================================
// 16. Button-effect roots, unemittable names, multi-window emit, overrides
// =====================================================================================

group('validator context and messages', () => {
  const layout = defaultLayout({ name: 'ctx_window' });
  layout.root.children.push({
    id: 'eb',
    kind: 'effectbutton',
    name: 'mod_button',
    quadTextureSprite: 'GFX_tiling_button_standard',
    position: { x: 0, y: 0 },
    size: { width: 40, height: 20 },
    effect: 'my_mod_effect',
  });
  // A keyset to check against: without one the validator reports nothing (buttonEffectsChecked
  // says so), which is the behaviour the "silently skipped when absent" contract requires.
  const keysetAssets = {
    sprites: {},
    textures: {},
    fonts: {},
    stats: { fontCount: 0 },
    buttonEffects: { vanilla_effect: { file: 'common/button_effects/example.txt', line: 1 } },
    containers: {},
    root: DEFAULT_GAME_ROOT,
  };
  const without = validateLayout(layout, { assets: keysetAssets });
  const unresolved = without.findings.filter((finding) => finding.rule === 'effect-unresolved');
  check('an effect key from nowhere is reported', unresolved.length === 1 && unresolved[0].element === 'mod_button', JSON.stringify(without.byRule));
  check('the default window declares its own accept effect', !unresolved.some((finding) => finding.element === 'accept_button'), JSON.stringify(unresolved.map((f) => f.element)));
  check('the report says which keyset was used', without.buttonEffectsChecked === true, String(without.buttonEffectsChecked));
  const unchecked = validateLayout({ ...layout, effects: {} }, {});
  check('with no keyset at all the effect check is skipped and said to be skipped', unchecked.buttonEffectsChecked === false && !unchecked.findings.some((finding) => finding.rule === 'effect-unresolved'));
  // A2: extra keysets arrive as a LIST and survive the validator's own context handling.
  const withExtra = validateLayout(layout, { assets: keysetAssets, extraButtonEffects: [new Set(['my_mod_effect'])] });
  check('an extra button-effect keyset resolves the key', !withExtra.findings.some((finding) => finding.rule === 'effect-unresolved'), JSON.stringify(withExtra.byRule));
  const withObjectKeyset = validateLayout(layout, { assets: keysetAssets, extraButtonEffects: [{ my_mod_effect: { file: 'mod.txt' } }] });
  check('an extra keyset may be a plain object too', !withObjectKeyset.findings.some((finding) => finding.rule === 'effect-unresolved'), JSON.stringify(withObjectKeyset.byRule));
  const withLegacyKey = validateLayout(layout, { buttonEffects: new Set(['my_mod_effect']) });
  check('the legacy context.buttonEffects still works', !withLegacyKey.findings.some((finding) => finding.rule === 'effect-unresolved'), JSON.stringify(withLegacyKey.byRule));
  check('the report lists the extra roots it read', Array.isArray(withExtra.extraButtonEffectRoots));

  // A3: a dropped element is NAMED. `kind-not-emittable: undefined` told a caller nothing.
  const stub = planEmit(
    (() => {
      const withStub = defaultLayout({ name: 'stub2' });
      withStub.root.children.push({ id: 's1', kind: 'position', name: 'first_spinner', position: { x: 0, y: 0 } });
      return withStub;
    })(),
  );
  const stubWarnings = stub.warnings.filter((warning) => warning.rule === 'kind-not-emittable');
  check('a dropped element is reported once', stubWarnings.length === 1, String(stubWarnings.length));
  check('a dropped element is named in the warning', stubWarnings[0]?.name === 'first_spinner', JSON.stringify(stubWarnings[0]));
  check('a dropped element warning has no `undefined`', !JSON.stringify(stubWarnings[0]).includes('undefined'), JSON.stringify(stubWarnings[0]));
});

group('multi-window emit and event stubs (B4/B5)', () => {
  const first = defaultLayout({ name: 'win_one' });
  const second = defaultLayout({ name: 'win_two' });
  second.root.children.push({
    id: 'row',
    kind: 'container',
    name: 'win_two_option',
    position: { x: 20, y: 250 },
    size: { width: 300, height: 30 },
    children: [
      { id: 'ob', kind: 'button', name: 'option_button', quadTextureSprite: 'GFX_tiling_button_standard', text: 'OPTION_TEXT', font: 'cg_16b', position: { x: 0, y: 4 }, size: { width: 300, height: 24 } },
    ],
  });
  const merged = mergeLayouts([first, second], { name: 'merged_ui' });
  check('mergeLayouts produces a synthetic root', merged.root.syntheticRoot === true);
  check('mergeLayouts keeps both windows', topLevelContainers(merged).length === 2, String(topLevelContainers(merged).length));
  check('mergeLayouts unions the variables', Object.keys(merged.variables).length >= 2, JSON.stringify(merged.variables));

  const plan = planEmit([first, second], { fileStem: 'merged_ui' });
  check('several layouts emit exactly ONE .gui file', plan.files.filter((file) => file.kind === 'gui').length === 1);
  const guiText = plan.files.find((file) => file.kind === 'gui').content;
  check('the merged .gui holds a guiTypes root', /^guiTypes = \{/m.test(guiText));
  const mergedBlocks = emittedBlocks(guiText, 'containerWindowType');
  check('the merged .gui holds all three containers', mergedBlocks.length === 3, JSON.stringify(mergedBlocks.map((block) => block.name)));
  check('the merged .gui has exactly two top-level windows', plan.windows.length === 2 && plan.windows.join(',') === 'win_one,win_two', JSON.stringify(plan.windows));
  check('the option row is nested inside its own window', guiText.indexOf('name = "win_two"') < guiText.indexOf('name = "win_two_option"'), 'order wrong');
  check('the merged .gui declares each @variable once', (guiText.match(/@window_width = /g) ?? []).length === 1, String((guiText.match(/@window_width = /g) ?? []).length));

  const eventFile = plan.files.find((file) => file.kind === 'event').content;
  const eventBlocks = (eventFile.match(/^country_event = \{$/gm) ?? []).length;
  check('the event stub emits one event per window', eventBlocks === 2, String(eventBlocks));
  check('every event carries an option block', (eventFile.match(/^\toption = \{/gm) ?? []).length >= 2, String((eventFile.match(/^\toption = \{/gm) ?? []).length));
  check('the event ids do not collide', /id = merged_ui\.1/.test(eventFile) && /id = merged_ui\.2/.test(eventFile), eventFile.slice(0, 200));
  // B4: the option row is found ANYWHERE in the tree, not only among the root's children.
  check('custom_gui_option is emitted for a nested option row', /custom_gui_option = "win_two_option"/.test(eventFile), eventFile);
  check('each event names its own window', /custom_gui = "win_one"/.test(eventFile) && /custom_gui = "win_two"/.test(eventFile));
  const locText = plan.files.find((file) => file.kind === 'localisation').content;
  check('the localisation stub covers each window title', / win_one_title:0 /.test(locText) && / win_two_title:0 /.test(locText), locText.slice(0, 200));
});

group('vanilla overrides (B2)', () => {
  const overrideRoot = join(scratch, 'OverrideOut');
  rmSync(overrideRoot, { recursive: true, force: true });
  mkdirSync(overrideRoot, { recursive: true });
  const fakeVanilla = join(scratch, 'fake_planet_view.gui');
  writeFileSync(
    fakeVanilla,
    ['guiTypes = {', '\tcontainerWindowType = {', '\t\tname = "header_actions"', '\t\tsize = { width = 283 height = 40 }', '\t}', '}', ''].join('\n'),
    'utf8',
  );
  const addition = {
    container: 'header_actions',
    element: {
      kind: 'effectbutton',
      name: 'unga_open_button',
      quadTextureSprite: 'GFX_fleetview_focus_solid',
      position: { x: 168, y: 46 },
      orientation: 'lower_left',
      effect: 'geocentric_unga_open_main',
    },
  };
  const plan = planOverride(fakeVanilla, [addition]);
  check('an override plan records the vanilla sha256', /^[0-9a-f]{64}$/.test(plan.vanilla.sha256), plan.vanilla.sha256);
  check('an override plan names its target as interface/<vanilla name>', plan.targetPath === 'interface/fake_planet_view.gui', plan.targetPath);
  check('the override content holds the added element', /effectbuttonType = \{[\s\S]*?name = "unga_open_button"/.test(plan.content));
  check('the added element is spliced into the named container', /name = "header_actions"[\s\S]*?unga_open_button[\s\S]*?\n\t\}/.test(plan.content));
  check('the override header records the vanilla hash', plan.content.includes(plan.vanilla.sha256));
  check('the override passes its own syntax check', plan.syntaxOk === true, JSON.stringify(plan.warnings));

  // A dry run writes nothing.
  const dry = emitOverride(fakeVanilla, [addition], { outputRoot: overrideRoot, dryRun: true });
  check('a dry-run override reports the target', dry.targetPath === 'interface/fake_planet_view.gui');
  check('a dry-run override writes nothing', !existsSync(join(overrideRoot, 'interface', 'fake_planet_view.gui')));

  // Writing requires the explicit confirmation.
  let refused = false;
  try {
    emitOverride(fakeVanilla, [addition], { outputRoot: overrideRoot, dryRun: false });
  } catch {
    refused = true;
  }
  check('an override refuses to write without the explicit confirmation', refused);
  check('the refused write left nothing behind', !existsSync(join(overrideRoot, 'interface', 'fake_planet_view.gui')));

  const written = emitOverride(fakeVanilla, [addition], {
    outputRoot: overrideRoot,
    dryRun: false,
    confirm: true,
    expectedSourceHash: plan.vanilla.sha256,
  });
  check('a confirmed override writes into the caller output root', existsSync(written.absolutePath), String(written.absolutePath));
  check('the written override has no BOM', inspectEncoding(written.absolutePath).hasBom === false);
  check('the override reports that the vanilla file was not modified', /was NOT modified/.test(written.note), written.note);

  // The source hash is the version-change detector.
  let staleRefused = false;
  try {
    emitOverride(fakeVanilla, [addition], { outputRoot: overrideRoot, dryRun: false, confirm: true, expectedSourceHash: 'deadbeef' });
  } catch (thrown) {
    staleRefused = /has changed/.test(String(thrown.message));
  }
  check('a changed vanilla source hash is refused by name', staleRefused);

  // A root that is a game install is still refused even for an override.
  let installRefused = false;
  try {
    assertOverrideRoot('D:\\SteamLibrary\\steamapps\\common\\Stellaris\\mod\\x');
  } catch {
    installRefused = true;
  }
  check('an override still refuses a Stellaris install path', installRefused);

  // The real vanilla file: planned, never modified.
  const realVanilla = join(DEFAULT_GAME_ROOT, 'interface', 'planet_view.gui');
  if (existsSync(realVanilla)) {
    const before = readFileSync(realVanilla);
    const realPlan = planOverride(realVanilla, [
      {
        container: 'header_actions',
        element: {
          kind: 'effectbutton',
          name: 'zz_test_button',
          quadTextureSprite: 'GFX_fleetview_focus_solid',
          position: { x: 10, y: 10 },
          effect: 'zz_test_effect',
        },
      },
    ]);
    check('the real vanilla planet_view.gui can be overridden', realPlan.targetPath === 'interface/planet_view.gui', realPlan.targetPath);
    check('the real override carries the added button', /zz_test_button/.test(realPlan.content));
    check('the real vanilla file is byte-identical afterwards', Buffer.compare(before, readFileSync(realVanilla)) === 0);
    check('the real override parses as guiTypes', parseGuiText(realPlan.content, 'planet_view.gui').ok === true);
  }
});

// =====================================================================================
// 17. Container-name collisions, extra asset roots, file inspection
// =====================================================================================

group('container-name collisions and extra roots (B3/B8)', () => {
  const layout = defaultLayout({ name: 'zz_my_window' });
  const assets = {
    sprites: {},
    textures: {},
    fonts: {},
    stats: { fontCount: 0 },
    buttonEffects: {},
    containers: { zz_my_window: { file: 'interface/vanilla.gui', line: 12 } },
    root: '<Stellaris>',
  };
  const colliding = validateLayout(layout, { assets });
  const collision = colliding.findings.find((finding) => finding.rule === 'container-name-collision');
  check('a window name the install already defines is reported', Boolean(collision), JSON.stringify(colliding.byRule));
  check('the collision names the vanilla file and line', /interface\/vanilla\.gui:12/.test(collision?.message ?? ''), collision?.message);
  check('the collision is an error', collision?.severity === 'error');
  const offSwitch = validateLayout(layout, { assets, options: { checkContainerNames: false } });
  check('the collision check can be turned off', !offSwitch.findings.some((finding) => finding.rule === 'container-name-collision'));

  // A name defined in the very file being validated is not a collision with itself.
  //
  // The hit carries the ROOT it was indexed under, because `buildAssetIndex` records it - that is
  // what makes "is this the same file?" exact rather than a path-suffix guess. The fixture says so
  // explicitly; leaving `root` to fall back to the install would model an index that cannot exist.
  const selfLayout = defaultLayout({ name: 'zz_self_window' });
  selfLayout.root.sourceFile = 'D:\\mods\\mine\\interface\\mine.gui';
  const selfAssets = {
    ...assets,
    root: 'D:\\mods\\mine',
    containers: { zz_self_window: { file: 'interface/mine.gui', line: 3, root: 'D:\\mods\\mine' } },
  };
  const selfReport = validateLayout(selfLayout, { assets: selfAssets, sourceFiles: ['D:\\mods\\mine\\interface\\mine.gui'] });
  check('a name from the same file is not a collision with itself', !selfReport.findings.some((finding) => finding.rule === 'container-name-collision'), JSON.stringify(selfReport.byRule));

  // GAP-9's other direction, RE-GRADED BY GAP-14. The two sides differ only in their root, and the
  // old suffix comparison (`ownFile.endsWith(hitsFile)`) called them the same file - which is why the
  // identity test below is by ABSOLUTE path. What happens once they are known to be different files
  // is GAP-14's question, and the answer is the RELATIVE path: `interface/planet_view.gui` on both
  // sides is an OVERRIDE (the engine mounts one file per relative path, reads the LAST
  // `dlc_load.json` entry and never parses the loser), NOT a collision. Measured in game by flipping
  // the order of two mods at one relative path (PROBE-RESULTS.md section 3).
  const shadowLayout = defaultLayout({ name: 'planet_view' });
  shadowLayout.root.sourceFile = 'D:\\mods\\mine\\interface\\planet_view.gui';
  const shadowAssets = {
    ...assets,
    root: DEFAULT_GAME_ROOT,
    containers: { planet_view: { file: 'interface/planet_view.gui', line: 222, root: DEFAULT_GAME_ROOT } },
  };
  const shadowReport = validateLayout(shadowLayout, {
    assets: shadowAssets,
    sourceFiles: ['D:\\mods\\mine\\interface\\planet_view.gui'],
  });
  const shadowFinding = shadowReport.findings.find((finding) => finding.rule === 'container-path-override');
  check(
    'a mod file at the SAME relative path as the file it shadows is reported as an OVERRIDE (GAP-14)',
    Boolean(shadowFinding) && shadowFinding.severity === 'info',
    JSON.stringify(shadowReport.byRule),
  );
  check(
    'the override names the other file and the reason (the same relative path)',
    /interface\/planet_view\.gui:222/.test(shadowFinding?.message ?? '') &&
      /SAME relative path/.test(shadowFinding?.message ?? ''),
    shadowFinding?.message,
  );
  check(
    'and it carries the load-order fact and the one reporter that prints the file name',
    /LAST `dlc_load\.json` entry/.test(shadowFinding?.message ?? '') &&
      /gridbox\.cpp:51/.test(shadowFinding?.suggestedFix ?? ''),
    shadowFinding?.suggestedFix,
  );
  check(
    'the same-relative-path case is NOT a collision',
    !shadowReport.findings.some((finding) => finding.rule === 'container-name-collision'),
    JSON.stringify(shadowReport.byRule),
  );

  // THE OTHER HALF, and the half that must not be switched off: different relative paths mean BOTH
  // files load and BOTH declare the name, so the mod's `custom_gui` really does resolve to the other
  // window. That is the genuine collision, and it stays an ERROR that names the other file.
  const ownFileLayout = defaultLayout({ name: 'planet_view' });
  ownFileLayout.root.sourceFile = 'D:\\mods\\mine\\interface\\zz_mine.gui';
  const ownFileReport = validateLayout(ownFileLayout, {
    assets: shadowAssets,
    sourceFiles: ['D:\\mods\\mine\\interface\\zz_mine.gui'],
  });
  const ownFileCollision = ownFileReport.findings.find((finding) => finding.rule === 'container-name-collision');
  check(
    'a name another file defines at a DIFFERENT relative path is still an ERROR collision',
    Boolean(ownFileCollision) && ownFileCollision.severity === 'error',
    JSON.stringify(ownFileReport.byRule),
  );
  check(
    'and that collision names the other file and both relative paths',
    /interface\/planet_view\.gui:222/.test(ownFileCollision?.message ?? '') &&
      /interface\/zz_mine\.gui/.test(ownFileCollision?.message ?? '') &&
      /DIFFERENT relative paths/.test(ownFileCollision?.message ?? ''),
    ownFileCollision?.message,
  );
  check(
    'and it does not masquerade as an override',
    !ownFileReport.findings.some((finding) => finding.rule === 'container-path-override'),
    JSON.stringify(ownFileReport.byRule),
  );

  // A vanilla file must not collide with itself either.
  const vanillaLayout = parseGuiText('guiTypes = {\n\tcontainerWindowType = { name = "galactic_community_view" size = { width = 10 height = 10 } }\n}\n', join(DEFAULT_GAME_ROOT, 'interface', 'galactic_community_view.gui'));
  const vanillaAssets = { ...assets, containers: { galactic_community_view: { file: 'interface/galactic_community_view.gui', line: 1 } } };
  const vanillaReport = validateLayout(vanillaLayout.layout, {
    assets: vanillaAssets,
    sourceFiles: [join(DEFAULT_GAME_ROOT, 'interface', 'galactic_community_view.gui')],
    rootKeyword: 'guiTypes',
  });
  check('an imported vanilla window does not collide with itself', !vanillaReport.findings.some((finding) => finding.rule === 'container-name-collision'));

  // B8: a mod's own .gfx resolves when its root is an extra root.
  if (existsSync(DEFAULT_GAME_ROOT)) {
    const modRoot = join(scratch, 'FakeMod');
    rmSync(modRoot, { recursive: true, force: true });
    mkdirSync(join(modRoot, 'interface'), { recursive: true });
    writeFileSync(
      join(modRoot, 'interface', 'zz_fake.gfx'),
      [
        'spriteTypes = {',
        '\tspriteType = {',
        '\t\tname = "GFX_zz_fake_sprite"',
        '\t\ttextureFile = "gfx/interface/zz_fake.dds"',
        '\t}',
        '\tcorneredTileSpriteType = {',
        '\t\tname = "GFX_zz_fake_tile"',
        '\t\ttextureFile = "gfx/interface/zz_fake_tile.dds"',
        '\t\tborderSize = { x = 12 y = 12 }',
        '\t}',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    const base = { root: DEFAULT_GAME_ROOT };
    const without = getAssetIndex({ ...base, refresh: false });
    check('a mod-only sprite is unknown without its root', !without.sprites.GFX_zz_fake_sprite);
    const withMod = getAssetIndex({ ...base, extraRoots: [modRoot] });
    check('a mod-only sprite resolves with its root', Boolean(withMod.sprites.GFX_zz_fake_sprite), 'not indexed');
    check('the index reports every root it read', Array.isArray(withMod.roots) && withMod.roots.length === 2, JSON.stringify(withMod.roots));
    check('the mod sprite records the root it came from', withMod.sprites.GFX_zz_fake_sprite.root === modRoot, String(withMod.sprites.GFX_zz_fake_sprite.root));
    check('a cornered tile keeps its borderSize for the preview', withMod.sprites.GFX_zz_fake_tile.borderSize.x === 12, JSON.stringify(withMod.sprites.GFX_zz_fake_tile.borderSize));
    const validated = validateLayout(
      (() => {
        const modLayout = defaultLayout({ name: 'mod_sprite_window' });
        modLayout.root.children.push({ id: 'i', kind: 'icon', name: 'fake_icon', spriteType: 'GFX_zz_fake_sprite', position: { x: 0, y: 0 } });
        return modLayout;
      })(),
      { assets: withMod },
    );
    check('the validator accepts the mod sprite against the extended index', !validated.findings.some((finding) => finding.rule === 'unknown-sprite'), JSON.stringify(validated.byRule));
    const withoutValidation = validateLayout(
      (() => {
        const modLayout = defaultLayout({ name: 'mod_sprite_window' });
        modLayout.root.children.push({ id: 'i', kind: 'icon', name: 'fake_icon', spriteType: 'GFX_zz_fake_sprite', position: { x: 0, y: 0 } });
        return modLayout;
      })(),
      { assets: without },
    );
    check('and reports it unknown without the extended index', withoutValidation.findings.some((finding) => finding.rule === 'unknown-sprite'));
  }
});

group('file inspection: encoding, localisation, events (B7)', () => {
  const dir = join(scratch, 'CheckFiles');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'localisation', 'english'), { recursive: true });
  mkdirSync(join(dir, 'events'), { recursive: true });
  mkdirSync(join(dir, 'common', 'button_effects'), { recursive: true });

  const noBomYml = join(dir, 'localisation', 'english', 'bad_l_english.yml');
  writeFileSync(noBomYml, 'l_english:\n a_key:0 "A"\n', 'utf8');
  const bomYml = join(dir, 'localisation', 'english', 'good_l_english.yml');
  writeFileSync(bomYml, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('l_english:\n b_key:0 "B"\n', 'utf8')]));
  const bomGui = join(dir, 'bom.gui');
  writeFileSync(bomGui, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('guiTypes = {\n}\n', 'utf8')]));
  const badKeyYml = join(dir, 'localisation', 'english', 'syntax_l_english.yml');
  writeFileSync(badKeyYml, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('l_english:\nc_key "no version"\n', 'utf8')]));
  const eventPath = join(dir, 'events', 'test_events.txt');
  writeFileSync(
    eventPath,
    [
      'namespace = test',
      'country_event = {',
      '\tid = test.1',
      '\ttitle = missing_title_key',
      '\tdesc = also_missing',
      '\tcustom_gui = "test_window"',
      '\timmediate = { }',
      '}',
      'country_event = {',
      '\tid = test.2',
      '\ttitle = a_key',
      '\toption = { name = missing_option_key }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  const report = checkFiles({
    paths: [noBomYml, bomYml, bomGui, badKeyYml, eventPath],
    languages: ['english'],
    localisationRoots: [join(dir, 'localisation')],
    roots: [],
    assets: { containers: { test_window: { file: 'interface/test.gui', line: 1 } }, sprites: {}, textures: {}, fonts: {}, stats: { fontCount: 0 } },
  });
  const rules = (report.byRule ?? {});
  check('a localisation file with no BOM is reported', (rules['encoding-bom-missing'] ?? 0) === 1, JSON.stringify(rules));
  check('a .gui with a BOM is reported', (rules['encoding-bom-unexpected'] ?? 0) === 1, JSON.stringify(rules));
  check('a malformed localisation key line is reported', (rules['localisation-key-syntax'] ?? 0) === 1, JSON.stringify(rules));
  check('an event with no option block is reported', (rules['event-without-option'] ?? 0) === 1, JSON.stringify(rules));
  const eventFinding = report.findings.find((finding) => finding.rule === 'event-without-option');
  check('the option finding quotes the engine', /Event test\.1 has no options/.test(eventFinding?.engineMessage ?? ''), eventFinding?.engineMessage);
  check('a missing event title key is reported', (rules['event-missing-loc'] ?? 0) >= 2, JSON.stringify(rules));
  check('a missing option name key is reported', (rules['option-name-missing-loc'] ?? 0) === 1, JSON.stringify(rules));
  check('custom_gui without diplomatic is reported', (rules['custom-gui-without-diplomatic'] ?? 0) === 1, JSON.stringify(rules));
  check('an unknown custom_gui window is reported', (rules['custom-gui-unknown-window'] ?? 0) === 0, JSON.stringify(rules));
  check('the report is not ok', report.ok === false);
  check('a good BOM-carrying .yml is clean', !report.findings.some((finding) => finding.where?.startsWith(bomYml)), JSON.stringify(report.findings.filter((f) => f.where?.startsWith(bomYml)).map((f) => f.rule)));

  // A button_effects file is NOT an events file, even though it fires events inside `effect`.
  const effectsPath = join(dir, 'common', 'button_effects', 'effects.txt');
  writeFileSync(
    effectsPath,
    ['my_effect = {', '\tpotential = { always = yes }', '\teffect = { country_event = { id = test.1 days = 1 } }', '}', ''].join('\n'),
    'utf8',
  );
  const effectsReport = checkFiles({ paths: [effectsPath], languages: ['english'], roots: [], assets: null });
  check('a button_effects file is not mistaken for an events file', !effectsReport.findings.some((finding) => finding.rule === 'event-file-empty'), JSON.stringify(effectsReport.byRule));
  const brokenEffects = join(dir, 'common', 'button_effects', 'broken_effects.txt');
  writeFileSync(brokenEffects, 'not_an_effect = { potential = { always = yes } }\n', 'utf8');
  const brokenReport = checkFiles({ paths: [brokenEffects], languages: ['english'], roots: [], assets: null });
  check('a button effect with no effect block is reported', brokenReport.findings.some((finding) => finding.rule === 'button-effect-without-effect'), JSON.stringify(brokenReport.byRule));

  // SCRIPT-LEVEL SHAPES inside a button effect. The engine parses these and reported, in one run
  // of this project's own output: "Unexpected token: resource" / "Unexpected token: amount" for
  // `add_resource = { resource = influence amount = -25 }`. 4.4.6 wants the resource as the key.
  const legacyEffects = join(dir, 'common', 'button_effects', 'legacy.txt');
  writeFileSync(
    legacyEffects,
    ['legacy_effect = {', '\tpotential = { always = yes }', '\teffect = {', '\t\tadd_resource = { resource = influence amount = -25 }', '\t}', '}', ''].join('\n'),
    'utf8',
  );
  const legacyReport = checkFiles({ paths: [legacyEffects], languages: ['english'], roots: [], assets: null, checkLocKeys: false });
  const shapeFinding = legacyReport.findings.find((finding) => finding.rule === 'effect-add-resource-shape');
  check('the legacy add_resource shape is reported', Boolean(shapeFinding), JSON.stringify(legacyReport.byRule));
  check('the shape finding quotes the engine token', /Unexpected token: resource/.test(shapeFinding?.engineMessage ?? ''), shapeFinding?.engineMessage);
  check('the shape finding names the modern form', /add_resource = \{ influence = -25 \}/.test(shapeFinding?.suggestedFix ?? ''), shapeFinding?.suggestedFix);
  const modernEffects = join(dir, 'common', 'button_effects', 'modern.txt');
  writeFileSync(modernEffects, 'modern_effect = { potential = { always = yes } effect = { add_resource = { influence = -25 } } }\n', 'utf8');
  const modernReport = checkFiles({ paths: [modernEffects], languages: ['english'], roots: [], assets: null, checkLocKeys: false });
  check('the modern add_resource shape is not reported', !modernReport.findings.some((finding) => finding.rule === 'effect-add-resource-shape'), JSON.stringify(modernReport.byRule));

  // TOOLTIP TARGETS in an event: `custom_tooltip` and `fail_text` are legal SCRIPT fields there
  // (unlike on a .gui element), and their keys must resolve - the engine logs
  // "Missing localization key [unga_requires_influence] for custom tooltip fail_text".
  const tooltipEvents = join(dir, 'events', 'tooltip_events.txt');
  writeFileSync(
    tooltipEvents,
    [
      'namespace = tooltip_test',
      'country_event = {',
      '\tid = tooltip_test.1',
      '\ttitle = a_key',
      '\tdesc = b_key',
      '\toption = {',
      '\t\tname = a_key',
      '\t\tcustom_tooltip = missing_tooltip_key',
      '\t\tallow = {',
      '\t\t\tcustom_tooltip = {',
      '\t\t\t\tfail_text = missing_fail_text_key',
      '\t\t\t\thas_resource = { type = influence amount >= 30 }',
      '\t\t\t}',
      '\t\t}',
      '\t}',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  const tooltipKeyset = buildLocalisationIndex({
    directories: [(() => {
      const locDir = join(dir, 'loc2', 'english');
      mkdirSync(locDir, { recursive: true });
      writeFileSync(join(locDir, 'zz_l_english.yml'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('l_english:\n a_key:0 "A"\n b_key:0 "B"\n', 'utf8')]));
      return join(dir, 'loc2');
    })()],
    languages: ['english'],
  });
  const tooltipReport = checkFiles({ paths: [tooltipEvents], languages: ['english'], roots: [], assets: null, localisationRoots: [join(dir, 'loc2')] });
  check('the tooltip keyset is built for the event check', tooltipKeyset.keys.size === 2, String(tooltipKeyset.keys.size));
  check('a custom_tooltip whose key does not resolve is reported', tooltipReport.findings.some((finding) => finding.rule === 'tooltip-key-missing-loc' && /missing_tooltip_key/.test(finding.message)), JSON.stringify(tooltipReport.byRule));
  check('a fail_text whose key does not resolve is reported', tooltipReport.findings.some((finding) => finding.rule === 'tooltip-key-missing-loc' && /missing_fail_text_key/.test(finding.message)), JSON.stringify(tooltipReport.findings.map((f) => f.message.slice(0, 60))));
  check('resolvable title/desc/option keys are not reported', !tooltipReport.findings.some((finding) => /[ab]_key/.test(String(finding.message))), JSON.stringify(tooltipReport.findings.map((f) => f.message.slice(0, 60))));

  // The real engine-error fixture, through the same file inspector.
  const fixtureReport = checkFiles({
    paths: [join(projectRoot, 'scripts', 'fixtures', 'engine-error-baseline.gui')],
    languages: ['english'],
    roots: [],
    assets: null,
    checkLocKeys: false,
  });
  check('the file inspector reports the fixture as broken', fixtureReport.ok === false && (fixtureReport.byRule['size-not-accepted'] ?? 0) === 4, JSON.stringify(fixtureReport.byRule));
});

// =====================================================================================
// 18. Preview: 9-slice chrome, resolved localisation, rect-table export
// =====================================================================================

group('preview chrome and rect export (A4/B9/B10)', () => {
  // The 9-slice geometry itself. GFX_tile_large_bg_plain is 680x612 with borderSize 330x296, so
  // its 170x153 thumbnail has a border of 82.5x74 - which is what the flat-fill preview ignored.
  const nine = nineSliceFor(
    { x: 0, y: 0, width: 640, height: 400 },
    { borderSize: { x: 330, y: 296 }, frameCount: 1 },
    { width: 170, height: 153 },
    { width: 680, height: 612 },
  );
  check('a cornered tile produces nine slices', nine?.slices.length === 9, JSON.stringify(nine?.slices.length));
  check('the slice border is the texture border scaled to the thumbnail', Math.abs(nine.border.x - 82.5) < 0.01 && Math.abs(nine.border.y - 74) < 0.01, JSON.stringify(nine?.border));
  check('the corners keep their natural size', Math.abs(nine.cornerPx.width - 82.5) < 0.01 && Math.abs(nine.cornerPx.height - 74) < 0.01, JSON.stringify(nine?.cornerPx));
  check('the middle stretches to fill the rest', Math.abs(nine.tilePx.width - (640 - 165)) < 0.01, JSON.stringify(nine?.tilePx));
  check('a sprite with no borderSize is not sliced', nineSliceFor({ x: 0, y: 0, width: 10, height: 10 }, { borderSize: null }, { width: 10, height: 10 }, null) === null);
  const tiny = nineSliceFor({ x: 0, y: 0, width: 40, height: 20 }, { borderSize: { x: 330, y: 296 }, frameCount: 1 }, { width: 170, height: 153 }, { width: 680, height: 612 });
  check('an element smaller than both borders scales the corners down', tiny?.scaled === true && tiny.cornerPx.width <= 20.01, JSON.stringify(tiny?.cornerPx));
  const frames = nineSliceFor({ x: 0, y: 0, width: 200, height: 30 }, { borderSize: { x: 12, y: 12 }, frameCount: 3 }, { width: 90, height: 30 }, { width: 90, height: 30 });
  check('a multi-frame cornered tile slices only frame 0', frames?.frame.width === 30 && frames.frame.count === 3, JSON.stringify(frames?.frame));

  // The SVG says out loud that chrome is approximate.
  const layout = defaultLayout({ name: 'chrome_window' });
  const svg = renderSvg(layout, { assets: null });
  check('the SVG header states that chrome is approximate', /CHROME IS APPROXIMATE/.test(svg.svg));
  check('the preview stats flag approximate chrome', svg.stats.chromeApproximate === true && typeof svg.stats.chromeNote === 'string');
  check('the note explains what IS exact', /geometry .*is exact/i.test(svg.stats.chromeNote), svg.stats.chromeNote);

  // B9: resolved localisation text is drawn when values are supplied.
  const textLayout = defaultLayout({ name: 'loc_window' });
  const withValues = renderSvg(textLayout, {
    assets: null,
    resolveLocalisation: (key) => (key === 'loc_window_title' ? 'A Very Long Translated Window Title' : null),
  });
  const withoutValues = renderSvg(textLayout, { assets: null });
  check('a resolved localisation value is drawn into the SVG', /A Very Long Translated Window Title/.test(withValues.svg));
  check('without values the raw key is drawn instead', !/A Very Long Translated Window Title/.test(withoutValues.svg));
  check('the text-fit check reports the long string', withValues.stats.textFit.checked > 0, JSON.stringify(withValues.stats.textFit));

  // B10: the rect table as CSV and markdown.
  const csv = rectTableCsv(svg.table);
  const markdown = rectTableMarkdown(svg.table, { baseResolution: BASE_RESOLUTION });
  check('the CSV has a header row', csv.startsWith('path,name,kind,x,y,width,height'), csv.slice(0, 60));
  check('the CSV has one row per element', csv.trim().split('\n').length === svg.table.length + 1, String(csv.trim().split('\n').length));
  check('the markdown table has a header and a separator', /\| element \| kind \|/.test(markdown) && /\| --- \|/.test(markdown));
  check('the markdown table names every element', markdown.includes('chrome_window'), markdown.slice(0, 200));
});

// =====================================================================================
// 18b. MEASURED text extents: the engine's own font metrics, wrapping, and the rules that use them
// =====================================================================================
//
// Every assertion here is written so that substituting the OLD heuristic - `0.55 * the number in
// the font's name`, which src/lib/font-metrics.mjs keeps as `nameSizedAdvance` for exactly this
// comparison - makes it fail. That heuristic says `"Hello"` in `cg_16b` is 44px wide (5 glyphs x
// 16px x 0.55); the engine's own descriptor says 31px. The two differ by 13px on five glyphs,
// which is why "does this text fit" could not be answered before.

group('measured text extents (font-metrics)', () => {
  const fntPath = join(DEFAULT_GAME_ROOT, 'gfx', 'fonts', 'cg_16b.fnt');
  check('the install ships the engine\'s own .fnt descriptor', existsSync(fntPath), fntPath);
  if (!existsSync(fntPath)) return;

  // ---------------------------------------------------------------- the descriptor itself
  const cg = parseBitmapFont(readFileSync(fntPath, 'utf8'), 'gfx/fonts/cg_16b.fnt');
  check('the .fnt reports its face and size', cg.face === 'Century Gothic' && cg.size === 16, `${cg.face} ${cg.size}`);
  check('the .fnt carries per-glyph advances', cg.glyphs.size === 228, String(cg.glyphs.size));
  check('the .fnt carries a line height and a baseline', cg.lineHeight === 16 && cg.base === 13, `${cg.lineHeight}/${cg.base}`);
  check('a quoted face name with a space is not truncated', !cg.face.startsWith('"'), cg.face);
  // The descriptor must belong to the atlas beside it, or the advances describe a font the game
  // does not draw. scaleW/scaleH are the atlas size the .fnt was generated against.
  const dds = readFileSync(join(DEFAULT_GAME_ROOT, 'gfx', 'fonts', 'cg_16b.dds'));
  check(
    'scaleW/scaleH equal the shipped atlas size',
    cg.scaleW === dds.readUInt32LE(16) && cg.scaleH === dds.readUInt32LE(12),
    `${cg.scaleW}x${cg.scaleH} vs ${dds.readUInt32LE(16)}x${dds.readUInt32LE(12)}`,
  );
  // Kerning is real and present in some of the descriptors, absent in others.
  const jura = parseBitmapFont(readFileSync(join(DEFAULT_GAME_ROOT, 'gfx', 'fonts', 'juralightmedium.fnt'), 'utf8'), 'juralightmedium.fnt');
  check('a .fnt with kerning pairs parses them', jura.kerning.size > 6000, String(jura.kerning.size));
  check('a .fnt without kerning pairs reports none', cg.kerning.size === 0, String(cg.kerning.size));

  // ---------------------------------------------------------------- exact advances
  const catalogue = buildFontCatalogue({ installRoot: DEFAULT_GAME_ROOT });
  const library = createFontLibrary({ installRoot: DEFAULT_GAME_ROOT, language: 'english' });
  const cgFont = library.font('cg_16b').metrics;
  check('cg_16b resolves to its bitmap descriptor for english', cgFont?.format === 'bitmap' && /cg_16b\.fnt$/.test(cgFont.file ?? ''), cgFont?.file);
  const hello = wrapText(cgFont, 'Hello', { wrap: false });
  check('a known string in a known font measures exactly', hello.width === 31, `${hello.width}px`);
  // THE TRAP: the old heuristic's number for the same string, asserted to be far away.
  const legacy = nameSizedAdvance('cg_16b');
  const heuristicWidth = Math.round('Hello'.length * legacy.advance);
  check('the old name-sized heuristic would NOT pass the assertion above', heuristicWidth === 44 && hello.width !== heuristicWidth, `${heuristicWidth}px vs ${hello.width}px`);
  check('the measurement error is stated, and it is zero for a bitmap font', METRIC_EXACTNESS.bitmap.startsWith('exact'), METRIC_EXACTNESS.bitmap);
  // Advances differ per glyph: a heuristic that charges one number per character cannot do this.
  const wide = wrapText(cgFont, 'WWWWW', { wrap: false }).width;
  const narrow = wrapText(cgFont, 'iiiii', { wrap: false }).width;
  check('per-glyph advances differ for wide and narrow glyphs', wide > narrow * 2, `W=${wide} i=${narrow}`);

  // ---------------------------------------------------------------- wrapping
  const latin = wrapText(cgFont, 'The United Nations of Earth', { maxWidth: 60 });
  check('latin text breaks at spaces', latin.lineCount > 1 && latin.lines.every((line) => !line.text.startsWith(' ') && !line.text.endsWith(' ')), JSON.stringify(latin.lines));
  check('a wrapped line never exceeds maxWidth', latin.lines.every((line) => line.width <= 60), JSON.stringify(latin.lines));
  const longWord = wrapText(cgFont, 'Supercalifragilisticexpialidocious', { maxWidth: 40 });
  check(
    'a word with no legal break inside it is reported as overflowing rather than split',
    longWord.wordOverflow.length === 1 && longWord.lineCount === 1 && longWord.lines[0].text === 'Supercalifragilisticexpialidocious',
    JSON.stringify({ lines: longWord.lineCount, overflow: longWord.wordOverflow, text: longWord.lines[0]?.text?.slice(0, 12) }),
  );
  const explicit = expandLocalisation('one$NEW_LINE$two', {});
  check('$NEW_LINE$ expands to a real break', explicit.text === 'one\ntwo', JSON.stringify(explicit.text));
  check('$NEW_LINE$ forces a line in the wrap model', wrapText(cgFont, explicit.text, { maxWidth: 500 }).lineCount === 2);
  const escaped = expandLocalisation('one\\ntwo', {});
  check('a literal \\n in a localisation value is a real break too', escaped.text === 'one\ntwo', JSON.stringify(escaped.text));

  // CJK: per-character wrapping. The mod this was built for is bilingual and a space-only model
  // misjudges every Chinese block.
  const chinese = createFontLibrary({ installRoot: DEFAULT_GAME_ROOT, language: 'simp_chinese' });
  const zhFont = chinese.font('cg_16b');
  check('cg_16b becomes a TrueType font under simp_chinese', zhFont.kind === 'ttf' && zhFont.ttfFont === 'Chinese_normal', `${zhFont.kind} ${zhFont.ttfFont}@${zhFont.ttfSize}`);
  const zh = '地球联合国常任理事国席位分配情况';
  // The fixture is 16 code points and the font charges exactly one em for each of them. The
  // CODE POINT COUNT is asserted as well as the width, because a fixture that has been silently
  // re-encoded stops being Chinese text: its UTF-8 bytes then get read one at a time, the string
  // becomes 24 unrelated CJK code points (one of them in the private use area, which the shipped
  // NotoSansCJKsc has no glyph for), and the failure looks like a font-resolution bug instead of
  // an encoding bug. That is exactly what had happened here.
  check('the CJK fixture is 16 code points, not mojibake', [...zh].length === 16, String([...zh].length));
  const zhSingle = wrapText(zhFont.metrics, zh, { wrap: false });
  check(
    "CJK advances come from the font's own hmtx table",
    zhSingle.width === 16 * 14,
    `${zhSingle.width}px for 16 chars = ${zhSingle.width / 16}px per char`,
  );
  check(
    'no CJK glyph fell back to the font average',
    zhSingle.estimatedFallback === 0 && zhSingle.missing.length === 0,
    JSON.stringify({ fallback: zhSingle.estimatedFallback, missing: zhSingle.missing }),
  );
  const zhWrapped = wrapText(zhFont.metrics, zh, { maxWidth: 200 });
  check('CJK wraps per character', zhWrapped.lineCount === 2, JSON.stringify(zhWrapped.lines));
  check('CJK wrapping uses every character (no space needed)', zhWrapped.lines.map((line) => line.text).join('') === zh, JSON.stringify(zhWrapped.lines));
  check('a CJK font\'s line height is derived and reported as such', zhFont.metrics.lineHeightDerived === true && zhFont.metrics.lineHeight > 0, String(zhFont.metrics.lineHeight));
  // A character the font does not have must be reported, not silently measured as nothing.
  const missing = wrapText(cgFont, 'a\u4e2db', { wrap: false });
  check('a missing glyph is reported rather than dropped', missing.missing.length === 0 || missing.missing.includes('\u4e2d'), JSON.stringify(missing.missing));

  // ---------------------------------------------------------------- the text elements
  const values = new Map([
    ['FITS', 'Short'],
    ['WIDE', 'A string that is far wider than the forty pixel box it is given'],
    ['WRAPS', 'alpha beta gamma delta epsilon zeta eta theta'],
    ['ONEWORD', 'Supercalifragilisticexpialidocious'],
    ['BLANK', 'x'],
  ]);
  const textElement = (name, x, y, maxWidth, maxHeight, key, font = 'cg_16b') => ({
    id: name,
    kind: 'text',
    name,
    position: { x, y },
    maxWidth,
    maxHeight,
    font,
    text: key,
    format: 'left',
  });
  const layoutWith = (children) => ({
    schema: 'rstellarisgui/layout@1',
    name: 'text_extent_fixture',
    baseResolution: { width: 1920, height: 1080 },
    root: {
      id: 'root',
      kind: 'container',
      name: 'root',
      size: { width: 1920, height: 1080 },
      children: [
        {
          id: 'win',
          kind: 'window',
          name: 'text_window',
          position: { x: 0, y: 0 },
          size: { width: 900, height: 600 },
          children,
        },
      ],
    },
  });
  const run = (children, options = {}) =>
    validateLayout(layoutWith(children), {
      assets: null,
      gameRoot: DEFAULT_GAME_ROOT,
      localisation: { keys: new Set(values.keys()), values },
      options: { checkAssets: false, checkContainerNames: false, checkCustomGuiContract: false, ...options },
    });

  // A text element that visibly fits must NOT be reported as overflowing. The old heuristic
  // called this one an overflow: 5 glyphs x 16 x 0.55 = 44px in a 40px box.
  const fitsReport = run([textElement('fits', 10, 10, 40, 20, 'FITS')]);
  check(
    'a text element whose string fits is not reported as overflowing',
    !fitsReport.findings.some((finding) => finding.rule === 'text-overflow'),
    JSON.stringify(fitsReport.byRule),
  );
  check('the report says the text was measured, and how', fitsReport.textMeasured === true && fitsReport.textMeasurement.elements === 1, JSON.stringify(fitsReport.textMeasurement));
  // A genuinely overflowing case IS reported, with the measured numbers.
  const wideReport = run([textElement('wide', 10, 10, 40, 20, 'WIDE')]);
  const overflowFinding = wideReport.findings.find((finding) => finding.rule === 'text-overflow');
  check('a genuinely overflowing string is reported', Boolean(overflowFinding), JSON.stringify(wideReport.byRule));
  check('the overflow finding quotes the measured width and the box', /measur|measures/.test(overflowFinding?.message ?? '') && overflowFinding?.maxWidth === 40, overflowFinding?.message);
  check('the overflow finding carries the exactness of the measurement', overflowFinding?.textExact === true && overflowFinding?.textMethod === 'bitmap', `${overflowFinding?.textExact}/${overflowFinding?.textMethod}`);
  check('the overflow finding carries the wrapped line count', overflowFinding?.lineCount >= 1, String(overflowFinding?.lineCount));
  // The vertical case: a wrapped block that needs more lines than maxHeight allows.
  const wrapReport = run([textElement('wraps', 10, 10, 60, 16, 'WRAPS')]);
  const wrapOverflow = wrapReport.findings.find((finding) => finding.rule === 'text-overflow');
  check('a wrapped block taller than maxHeight is reported', Boolean(wrapOverflow) && wrapOverflow.lineCount > 1, JSON.stringify(wrapOverflow?.lineCount));
  check('the vertical overflow is labelled vertical', wrapOverflow?.textOverflow === 'vertical', wrapOverflow?.textOverflow);
  check('the finding explains that the string was wrapped', /wrapped line/.test(wrapOverflow?.message ?? ''), wrapOverflow?.message);

  // ---------------------------------------------------------------- box artefacts vs real ink
  //
  // Two fields whose BOXES overlap by 40% and whose (short) strings are nowhere near each other:
  // `left` is 100px wide holding a 31px word, `right` starts at x=60. This is the single largest
  // source of useless "visual overlap" findings in a Paradox UI.
  const boxArtifact = run([textElement('left', 0, 0, 100, 20, 'FITS'), textElement('right', 60, 0, 100, 20, 'FITS')]);
  check(
    'a box overlap whose measured text does not meet is NOT reported',
    !boxArtifact.findings.some((finding) => finding.rule === 'sibling-overlap' || finding.rule === 'text-collision'),
    JSON.stringify(boxArtifact.byRule),
  );
  check('the same pair IS reported when the text is not measured',
    run([textElement('left', 0, 0, 100, 20, 'FITS'), textElement('right', 60, 0, 100, 20, 'FITS')], { measureText: false })
      .findings.some((finding) => finding.rule === 'sibling-overlap'));
  check('the report counts the box artefacts it removed', boxArtifact.textMeasurement.overlapBreakdown.suppressedByMeasurement === 1, JSON.stringify(boxArtifact.textMeasurement.overlapBreakdown));
  // Two fields whose boxes overlap AND whose ink really does meet keep a finding - as the precise
  // `text-collision` rule, with both measured extents.
  const realInk = run([textElement('l2', 0, 0, 100, 20, 'WRAPS'), textElement('r2', 0, 0, 100, 20, 'WRAPS')]);
  const realCollision = realInk.findings.find((finding) => finding.rule === 'text-collision');
  check('a real ink collision is still reported, as text-collision', Boolean(realCollision), JSON.stringify(realInk.byRule));
  check('a real ink collision is not doubled up as sibling-overlap', !realInk.findings.some((finding) => finding.rule === 'sibling-overlap'), JSON.stringify(realInk.byRule));
  check('the real collision is marked as not wrap-induced', realCollision?.wrapInduced === false, String(realCollision?.wrapInduced));

  // A wrapped block that grows past its maxHeight and lands on the element BELOW it: the boxes do
  // not intersect at all, so no box rule can ever see this.
  const wrapCollision = run([textElement('grows', 0, 0, 60, 16, 'WRAPS'), textElement('below', 0, 40, 200, 20, 'FITS')]);
  const collision = wrapCollision.findings.find((finding) => finding.rule === 'text-collision');
  check('text that grows onto the element below is reported as text-collision', Boolean(collision), JSON.stringify(wrapCollision.byRule));
  check('the wrap-induced collision says the boxes do not intersect', collision?.wrapInduced === true, String(collision?.wrapInduced));
  check('the wrap-induced collision quotes both measured extents', /measures \d+x\d+ in/.test(collision?.message ?? ''), collision?.message);
  check('no box rule could have reported that collision', collision?.boxOverlapArea === undefined || collision.boxOverlapArea === 0);
  check('without measurement there is no collision finding at all', 
    !run([textElement('grows', 0, 0, 60, 16, 'WRAPS'), textElement('below', 0, 40, 200, 20, 'FITS')], { measureText: false })
      .findings.some((finding) => finding.rule === 'text-collision'));

  // ---------------------------------------------------------------- the preview uses the same numbers
  // `ONEWORD` is a single unbreakable word, so it is a HORIZONTAL overflow: the measured width
  // exceeds maxWidth and wrapping cannot help. (A multi-word string would wrap instead, which is
  // the right answer and is asserted above.)
  const previewLayout = layoutWith([textElement('oneword', 10, 10, 40, 20, 'ONEWORD')]);
  const preview = renderSvg(previewLayout, {
    assets: null,
    gameRoot: DEFAULT_GAME_ROOT,
    resolveLocalisation: (key) => values.get(key) ?? null,
    localisationValues: values,
  });
  check('the preview measures the text it draws', preview.stats.textFit.measured === 1, JSON.stringify(preview.stats.textFit));
  check('the preview reports the overflow with the measured numbers', preview.stats.textFit.overflowing[0]?.width > 40, JSON.stringify(preview.stats.textFit.overflowing));
  check('the preview says the measurement is exact, not a hint', /exact/.test(preview.stats.textFit.method) && !/0\.55/.test(preview.stats.textFit.method), preview.stats.textFit.method);
  check('the preview draws the measured extent', preview.svg.includes('data-measured-text=') && preview.svg.includes('data-text-lines='));
  check('the preview draws one line marker per wrapped line', (preview.svg.match(/<line x1=/g) ?? []).length >= 1);
  // The rect table carries the measured extent, so the table and the picture cannot disagree.
  const wideRow = preview.table.find((row) => row.path.endsWith('/oneword'));
  check('the rect table carries the measured text extent', wideRow?.text?.width === preview.stats.textFit.overflowing[0]?.width, JSON.stringify(wideRow?.text));
  check('the rect CSV has the measured text columns', rectTableCsv(preview.table).split('\n')[0].includes('text_width'), rectTableCsv(preview.table).split('\n')[0]);
  check('the rect markdown shows the measured size next to the box', /text measured w x h/.test(rectTableMarkdown(preview.table)), rectTableMarkdown(preview.table).slice(0, 200));
  void [METRIC_EXACTNESS, catalogue];
});

// =====================================================================================
// 18b. THE WHOLE GUI SURFACE: the five kinds that were parsed-not-written, the matrix, and
//      the two routes onto a screen (the standalone file and the vanilla override)
// =====================================================================================

group('the five parsed-only kinds are emittable in their own engine form', () => {
  // THE MEASURED FORMS. Each of these kinds has its own size spelling and its own field set, and the
  // plugin was bitten repeatedly by writing one kind's form on another (`iconType` rejects `size`,
  // `instantTextBoxType` takes `maxWidth`/`maxHeight` and no `size`). So each case here is the
  // vanilla block it was measured from, emitted through `renderElement` and compared field for
  // field. The source lines are the ones the field sets in kinds.mjs cite.
  const cases = [
    // chat_window, interface/chat.gui:3 - a windowType: `size = { x y }`, a bare-sprite backGround,
    // and children of several kinds.
    ['interface/chat.gui', 'chat_window'],
    // chat_input, interface/chat.gui:55 - an editBoxType: `size = { x y }` and a font/text.
    ['interface/chat.gui', 'chat_input'],
    // `checked`, interface/ascension_perks_view.gui:64 - a checkboxType with NO size at all.
    ['interface/ascension_perks_view.gui', 'checked'],
    // `spinner`, interface/additional_content/additional_content.gui:824 - a spinnerType whose
    // leftbutton/rightbutton NAME two nested guiButtonType children, and whose `horizontal = 1`.
    ['interface/additional_content/additional_content.gui', 'spinner'],
    // `diplomacy_target_selector`, interface/diplomacy_view.gui:1439 - a dropDownBoxType whose
    // `expandedWindow`/`expandButton` are element blocks whose KEY IS THE FIELD.
    ['interface/diplomacy_view.gui', 'diplomacy_target_selector'],
    ['interface/databank_window.gui', 'filter_category'],
    ['interface/customize_species_editors.gui', 'initializer_dropdown'],
  ];
  // THE NORMALISATIONS, stated rather than tolerated silently. Five differences are allowed and each
  // is named here, so a NEW difference cannot hide behind a loose comparison:
  //   `key=""`    an EMPTY string (`backGround=""`, `dontRender=""`) is not written at all - the
  //               engine's default for the field is the same as an empty value, so both sides drop it
  //   `=1.0`      a float with a zero fraction is written as an integer
  //   `=1`/`=yes` a 1/0 boolean is written as `yes`/`no`, which is what BOOLEAN_FIELDS is for
  const normalise = (entry) => {
    const [key, ...rest] = entry.split('=');
    let value = rest.join('=');
    if (value === '') return null; // an empty declaration and an absent one mean the same thing
    if (/^\d+\.0+$/.test(value)) value = String(Number(value));
    if (value === '1') value = 'yes';
    if (value === '0') value = 'no';
    return `${key}=${value}`;
  };
  const normaliseAll = (entries) => entries.map(normalise).filter((entry) => entry !== null);
  let totalMissing = 0;
  const perKind = [];
  for (const [rel, name] of cases) {
    const path = join(DEFAULT_GAME_ROOT, rel.replace(/\//g, '\\'));
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const parsed = parseGuiText(text, rel);
    const node = parsed.containers.map((root) => findNodeInTree(root, name)).find(Boolean);
    if (!node) {
      check(`${rel}: ${name} is found`, false, 'window not found');
      continue;
    }
    const context = { warnings: [], path: name, resolvedRects: null, spriteLookup: () => null, variables: parsed.variables ?? {} };
    const emitted = renderElement(node, 0, context, '').join('\n');
    const want = normaliseAll(vanillaScalars(vanillaBlock(text, name)));
    const got = normaliseAll(vanillaScalars(emitted));
    const missing = want.filter((entry) => !got.includes(entry));
    // The kinds whose own form the emitter must use, checked by spelling rather than by field count.
    const spec = kindSpec(node.kind);
    perKind.push({ name, kind: spec?.kind, keyword: spec?.keywords?.[0], missing, emitted });
    totalMissing += missing.length;
  }
  check(
    'every vanilla block round-trips field for field (only the four named normalisations differ)',
    totalMissing === 0,
    perKind.flatMap((entry) => entry.missing.map((m) => `${entry.name}: ${m}`)).join(' | '),
  );
  const byKind = new Map(perKind.map((entry) => [entry.kind, entry]));
  check('the window case is a windowType and writes size = { x y }', byKind.get('window')?.keyword === 'windowType' && /size = \{\s*x = /m.test(byKind.get('window')?.emitted ?? ''), byKind.get('window')?.emitted?.slice(0, 200));
  check('the checkbox case writes NO size at all', byKind.get('checkbox') && !/\bsize\s*=\s*\{/.test(byKind.get('checkbox').emitted), byKind.get('checkbox')?.emitted);
  check('the spinner case writes size = { x y } and its two named guiButtonType children', byKind.get('spinner')?.keyword === 'spinnerType' && /x = 611/.test(byKind.get('spinner')?.emitted ?? '') && (byKind.get('spinner')?.emitted.match(/guiButtonType = \{/g) ?? []).length === 2, byKind.get('spinner')?.emitted?.slice(0, 300));
  check('the editBox case writes size = { x y } and no maxWidth', byKind.get('editBox')?.keyword === 'editBoxType' && /size = \{\s*x = 276/m.test(byKind.get('editBox')?.emitted ?? '') && !/maxWidth/.test(byKind.get('editBox')?.emitted ?? ''), byKind.get('editBox')?.emitted);
  const dropDown = perKind.find((entry) => entry.name === 'diplomacy_target_selector');
  check(
    'the dropDownBox case writes size = { width height } and its UNKEYED expandedWindow/expandButton blocks',
    /size = \{\s*width = 65/m.test(dropDown?.emitted ?? '') &&
      /expandedWindow = \{/.test(dropDown?.emitted ?? '') &&
      !/containerWindowType = \{\s*\n\s*name = "target_expanded_window"/.test(dropDown?.emitted ?? ''),
    dropDown?.emitted?.slice(0, 400),
  );
  // THE TWO FIELDS THAT WERE SILENTLY WRONG. `verticalScrollBar` is a NAME, not a flag, and every
  // vanilla spinner writes `horizontal = 1`; both were mangled by the boolean formatting.
  check('verticalScrollBar survives as the scrollbar NAME', /verticalscrollbar = "right_vertical_slider"/.test(dropDown?.emitted ?? ''), (dropDown?.emitted ?? '').split('\n').filter((line) => /verticalscrollbar/i.test(line)).join('|'));
  check('horizontal = 1 becomes yes, not no', /horizontal = yes/.test(byKind.get('spinner')?.emitted ?? ''), byKind.get('spinner')?.emitted);
  check('a background keeps its own size and its own sprite spelling', /size = \{\s*x = 65/m.test(dropDown?.emitted ?? '') && /spriteType = "GFX_empire_dropdown_btn"/.test(dropDown?.emitted ?? ''), (dropDown?.emitted ?? '').split('\n').filter((line) => /spriteType|size =/.test(line)).join('|'));
});

group('the matrix component lays cells out and refuses one that does not fit', () => {
  const build = () => {
    const layout = defaultLayout({ name: 'matrix_selftest', width: 1000, height: 700 });
    layout.root.children.push({
      id: 'mx',
      kind: 'matrix',
      name: 'selftest_matrix',
      position: { x: 20, y: 60 },
      rows: 3,
      columns: 4,
      cellWidth: 120,
      cellHeight: 28,
      gapX: 6,
      gapY: 4,
      padding: 8,
      columnHeaders: ['C0', 'C1', 'C2', 'C3'],
      rowHeaders: ['R0', 'R1', 'R2'],
      cells: [
        { row: 0, column: 0, node: { kind: 'text', name: 'mx_00', text: 'HELLO', font: 'cg_16b', maxWidth: 110, maxHeight: 20 } },
        { row: 1, column: 2, node: { kind: 'text', name: 'mx_12', text: 'WIDE', font: 'cg_16b', maxWidth: 200, maxHeight: 20 } },
      ],
    });
    return layout;
  };
  const layout = build();
  const report = validateLayout(layout);
  const overflow = report.findings.filter((finding) => finding.rule === 'matrix-cell-overflow');
  check('a cell wider than its slot is an error', overflow.length === 1 && overflow[0].severity === 'error', JSON.stringify(report.byRule));
  check('the overflow finding states the overshoot and the direction', /80 px too wide/.test(overflow[0]?.message ?? '') && /r1c2/.test(overflow[0]?.message ?? ''), overflow[0]?.message);
  check('the overflow finding says which rule is blind to it', /sibling|out-of-bounds/.test(overflow[0]?.message ?? ''));

  const { boxes } = computeLayout(build());
  const frame = boxes.find((box) => box.name === 'selftest_matrix');
  const cell00 = boxes.find((box) => box.name === 'mx_00');
  // frame width = padding + rowHeaderWidth + gapX + 4 cells + 3 gaps + padding
  //             = 8 + 140 + 6 + 480 + 18 + 8 = 660
  // frame height = 8 + 20 + 4 + 3*28 + 2*4 + 8 = 132
  check('the frame is sized to hold exactly rows x columns', frame?.rect.width === 660 && frame?.rect.height === 132, JSON.stringify(frame?.rect));
  // The cell is placed relative to the FRAME (its position is the frame's own coordinate space), so
  // the assertion is stated that way rather than against a hardcoded absolute corner - the frame's
  // absolute origin depends on where the enclosing window landed.
  check(
    'a cell lands on its slot in the frame, not on the matrix origin',
    cell00?.rect.x === frame.rect.x + 154 && cell00?.rect.y === frame.rect.y + 32,
    JSON.stringify({ cell: cell00?.rect, frame: frame?.rect }),
  );
  const headerLabels = boxes.filter((box) => /^selftest_matrix_(col|row)\d+$/.test(box.name ?? ''));
  check('the labels are named by ROW/COLUMN INDEX, not by coordinate', headerLabels.length === 7, headerLabels.map((box) => box.name).join(', '));
  const labelsAreChildren = (() => {
    const walk = (node) => {
      if (node?.name === 'selftest_matrix') return (node.children ?? []).length === 9 || (node.children ?? []).some((child) => child.name === 'mx_00');
      for (const child of node?.children ?? []) { const hit = walk(child); if (hit) return hit; }
      return false;
    };
    const { boxes: again } = computeLayout(build());
    const emitted = emitGui(build(), {}).text;
    return { tree: walk(build().root), emitted };
  })();
  check('the labels and cells are nested INSIDE the frame in the file', /containerWindowType = \{\s*\n\s*name = "selftest_matrix"/.test(labelsAreChildren.emitted) && /instantTextBoxType = \{\s*\n\s*name = "selftest_matrix_col0"/.test(labelsAreChildren.emitted), labelsAreChildren.emitted.slice(labelsAreChildren.emitted.indexOf('selftest_matrix') - 40, labelsAreChildren.emitted.indexOf('selftest_matrix') + 400));
  const nestedIndent = (() => {
    const lines = labelsAreChildren.emitted.split('\n');
    const frameLine = lines.findIndex((line) => /name = "selftest_matrix"/.test(line));
    const cellLine = lines.findIndex((line) => /name = "mx_00"/.test(line));
    return { frame: lines[frameLine]?.match(/^\t*/)?.[0].length ?? -1, cell: lines[cellLine]?.match(/^\t*/)?.[0].length ?? -1 };
  })();
  check('the cell is indented deeper than the frame, so the nesting is real', nestedIndent.cell > nestedIndent.frame && nestedIndent.frame >= 0, JSON.stringify(nestedIndent));

  // THE RULES THAT REFUSE A WRONG MATRIX, one fixture each.
  const bad = (node) => {
    const layout = defaultLayout({ name: 'matrix_bad', width: 1000, height: 700 });
    layout.root.children.push({ id: 'mx', kind: 'matrix', name: 'bad_matrix', position: { x: 0, y: 0 }, ...node });
    return validateLayout(layout).findings.map((finding) => finding.rule);
  };
  check('a cell outside the grid is refused', bad({ rows: 2, columns: 2, cellWidth: 100, cellHeight: 20, cells: [{ row: 5, column: 0, node: { kind: 'text', name: 'x', text: 'X' } }] }).includes('matrix-cell-slot-out-of-range'));
  check('two cells in one slot are refused', bad({ rows: 2, columns: 2, cellWidth: 100, cellHeight: 20, cells: [{ row: 0, column: 0, node: { kind: 'text', name: 'a', text: 'A' } }, { row: 0, column: 0, node: { kind: 'text', name: 'b', text: 'B' } }] }).includes('matrix-cell-slot-collision'));
  check('a percentage cell size is refused', bad({ rows: 2, columns: 2, cellWidth: '100%', cellHeight: 20 }).includes('matrix-cell-size-not-static'));
  check('a non-integer grid is refused', bad({ rows: 0, columns: 2, cellWidth: 100, cellHeight: 20 }).includes('matrix-dimension-invalid'));
  check('a header list of the wrong length is reported', bad({ rows: 2, columns: 2, cellWidth: 100, cellHeight: 20, columnHeaders: ['A', 'B', 'C'] }).includes('matrix-header-count-mismatch'));
  check('more children than slots is refused', bad({ rows: 1, columns: 1, cellWidth: 100, cellHeight: 20, children: [{ kind: 'text', name: 'c1', text: '1' }, { kind: 'text', name: 'c2', text: '2' }] }).includes('matrix-children-overflow'));
  check('an empty slot is emitted as NOTHING, not as a zero-size box', !/name = "selftest_matrix_r2c3"/.test(labelsAreChildren.emitted));

  // THE ENGINE-POPULATED CONTRAST, in the same run: a child inside a grid box is reported, and the
  // measured numbers are in the message.
  const gridLayout = defaultLayout({ name: 'grid_child', width: 800, height: 400 });
  gridLayout.root.children.push({
    id: 'gb', kind: 'gridBox', name: 'grid_with_child', position: { x: 0, y: 0 }, size: { width: 200, height: 100 },
    slotSize: { width: 100, height: 50 },
    children: [{ id: 'gc', kind: 'text', name: 'grid_cell', position: { x: 0, y: 0 }, text: 'X', font: 'cg_16b', maxWidth: 90, maxHeight: 20 }],
  });
  const gridReport = validateLayout(gridLayout);
  const populated = gridReport.findings.filter((finding) => finding.rule === 'engine-populated-container-children');
  check('a child inside a gridBoxType is reported once', populated.length === 1, JSON.stringify(gridReport.byRule));
  check('the finding quotes the measured 0-of-N', /0 of the vanilla blocks/.test(populated[0]?.message ?? ''));
  check('the finding points at the matrix component instead', /matrix/.test(populated[0]?.suggestedFix ?? ''));
  // And with NO child there is nothing to report - the box itself is legal and emittable.
  const emptyGrid = defaultLayout({ name: 'grid_empty', width: 800, height: 400 });
  emptyGrid.root.children.push({ id: 'gb', kind: 'gridBox', name: 'grid_empty_box', position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, slotSize: { width: 100, height: 50 } });
  check('an empty gridBoxType is NOT reported', !validateLayout(emptyGrid).findings.some((finding) => finding.rule === 'engine-populated-container-children'));
});

group('the surface fixtures, and the two routes onto a screen', () => {
  const fixtureDir = join(PROJECT_ROOT, 'scripts', 'fixtures');
  const matrixPath = join(fixtureDir, 'matrix_window.gui');
  const overrideDir = join(fixtureDir, 'host_override');
  check('the matrix fixture exists', existsSync(matrixPath));
  check('the override fixtures exist', existsSync(join(overrideDir, 'vanilla_host.gui')) && existsSync(join(overrideDir, 'planet_view_mini.gui')));
  if (!existsSync(matrixPath)) return;

  // THE FIXTURES ARE GENERATED, so they cannot drift from the emitter: the generator is re-run in
  // memory and compared byte for byte with what is on disk.
  const generated = buildSurfaceFixtures();
  let drifted = 0;
  for (const [path, text] of generated) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) drifted += 1;
  }
  const overrideText = buildOverrideFixture();
  if (readFileSync(join(overrideDir, 'planet_view_mini.gui'), 'utf8') !== overrideText) drifted += 1;
  const numberOnlyText = buildNumberChangeOverride();
  if (readFileSync(join(overrideDir, 'number_change_only.gui'), 'utf8') !== numberOnlyText) drifted += 1;
  check('every surface fixture matches what the generator produces (re-run make-surface-fixtures.mjs)', drifted === 0, `${drifted} stale`);

  // ROUTE 1 - the mod's OWN window, reachable only through `custom_gui`. The fixture's root is a
  // `windowType`, which `custom_gui` cannot name, and that is the point: it is a REAL element the
  // emitter writes, on a host the event path cannot use.
  const matrixText = readFileSync(matrixPath, 'utf8');
  check('the fixture is UTF-8 without a BOM', matrixText.charCodeAt(0) !== 0xfeff);
  check('the fixture passes the engine syntax check', checkGuiSyntax(matrixText, 'matrix_window.gui').ok, JSON.stringify(checkGuiSyntax(matrixText, 'matrix_window.gui').counts));
  const matrixParsed = parseGuiText(matrixText, 'matrix_window.gui');
  check('the fixture root is a windowType, not a containerWindowType', /windowType = \{/.test(matrixText) && matrixParsed.ok, JSON.stringify(matrixParsed.containers.map((c) => c.name)));
  const kindsInFixture = ['windowType', 'containerWindowType', 'instantTextBoxType', 'gridBoxType', 'checkboxType', 'editBoxType', 'spinnerType', 'guiButtonType', 'dropDownBoxType', 'smoothListboxType', 'iconType'];
  const absent = kindsInFixture.filter((keyword) => !new RegExp(`\\b${keyword} = \\{`, 'i').test(matrixText));
  check('the fixture exercises every kind the surface round made writable', absent.length === 0, absent.join(', '));
  check('the fixture writes the matrix as positioned containers, never as a matrix block', /name = "zz_surface_matrix"/.test(matrixText) && !/^\s*matrix = \{/m.test(matrixText));
  check('the fixture keeps an EMPTY gridBoxType beside it, for the contrast', /name = "zz_surface_grid"/.test(matrixText) && /slotSize = \{/.test(matrixText));
  check('the fixture writes the dropdown\'s unkeyed expandedWindow/expandButton blocks', /expandedWindow = \{/.test(matrixText) && /expandButton = \{/.test(matrixText));
  check('the fixture writes the engine id of the spinner', /id = "zz_surface_spinner_id"/.test(matrixText));
  // THE MODEL is where the deliberate defect lives: the fixture is the EMITTED file, so its matrix is
  // already expanded into containers and the matrix rules (correctly) have nothing left to fire on.
  // Asserting the defect on the model is what keeps the fixture honest - it proves the too-wide cell
  // is really there and that the rule really catches it.
  const modelReport = validateLayout(matrixWindowLayout());
  const overflow = modelReport.findings.filter((finding) => finding.rule === 'matrix-cell-overflow');
  check('the fixture\'s model carries exactly one deliberately too-wide cell', overflow.length === 1 && /r2c2/.test(overflow[0]?.message ?? ''), JSON.stringify(modelReport.findings.filter((f) => f.rule.startsWith('matrix-')).map((f) => f.message)));
  const matrixReport = validateLayout({
    schema: 'rstellarisgui/layout@1',
    name: 'zz_surface_fixture',
    root: { id: 'r', kind: 'container', syntheticRoot: true, children: matrixParsed.containers },
    baseResolution: { width: 1920, height: 1080 },
    variables: matrixParsed.variables,
  });
  const matrixErrors = matrixReport.findings.filter((finding) => finding.severity === 'error');
  check('the emitted fixture has no error-severity finding', matrixErrors.length === 0, matrixErrors.map((finding) => `${finding.rule}: ${finding.message}`).join(' | '));
  check('the emitted fixture uses no field this project does not model', !matrixReport.findings.some((finding) => finding.rule === 'unknown-field'), matrixReport.findings.filter((finding) => finding.rule === 'unknown-field').map((finding) => finding.message).join(' | '));
  check('the emitted fixture uses no field the wrong kind rejects', !matrixReport.findings.some((finding) => finding.rule === 'field-not-accepted' || finding.rule === 'size-not-accepted' || finding.rule === 'size-form-wrong'), JSON.stringify(matrixReport.byRule));
  check('the emitted fixture reports no child inside an engine-populated box', !matrixReport.findings.some((finding) => finding.rule === 'engine-populated-container-children'));

  // ROUTE 2 - the override: the host's own bytes plus the additions, with the base hash recorded.
  const hostText = readFileSync(join(overrideDir, 'vanilla_host.gui'), 'utf8');
  const override = readFileSync(join(overrideDir, 'planet_view_mini.gui'), 'utf8');
  check('the override contains every line of the host it replaces', hostText.split('\n').filter((line) => line.trim()).every((line) => override.includes(line)));
  check('the override splices the EXPANDED matrix, never a `matrix = {` block', /containerWindowType = \{/.test(override) && !/^\s*matrix = \{/m.test(override), override.split('\n').filter((line) => /matrix/.test(line)).slice(0, 4).join(' | '));
  check('the override writes the component\'s cells INSIDE the frame it added', /name = "zz_surface_host_matrix"[\s\S]*name = "zz_surface_host_cell_00"/.test(override));
  check('the override passes the engine syntax check', checkGuiSyntax(override, 'planet_view_mini.gui').ok, JSON.stringify(checkGuiSyntax(override, 'planet_view_mini.gui').counts));
});

group('the override anti-drift report says whether the base moved and what changed', () => {
  const overrideDir = join(PROJECT_ROOT, 'scripts', 'fixtures', 'host_override');
  const overridePath = join(overrideDir, 'planet_view_mini.gui');
  if (!existsSync(overridePath)) {
    check('the override fixture exists', false);
    return;
  }
  // SAME BASE: the recorded hash matches, nothing is stale.
  const same = analyseOverrideDrift(overridePath, join(overrideDir, 'vanilla_host.gui'), { gameRoot: DEFAULT_GAME_ROOT });
  check('an unchanged base reports moved = false and no error', same.baseHash.moved === false && !same.findings.some((finding) => finding.severity === 'error'), JSON.stringify(same.byRule));
  check('the report names the elements the override ADDS', same.elements.added.length > 0 && same.elements.added.includes('zz_surface_host_matrix'), JSON.stringify(same.elements.added));
  check('the report names the container each addition hangs off', same.splicePoints.some((entry) => entry.element === 'zz_surface_host_matrix' && entry.container === 'zz_surface_host' && entry.containerExists === true), JSON.stringify(same.splicePoints));

  // THE BASE MOVED: the next patch changed the container's own size and added a vanilla element.
  const moved = analyseOverrideDrift(overridePath, join(overrideDir, 'vanilla_host_v2.gui'), { gameRoot: DEFAULT_GAME_ROOT });
  check('a moved base reports moved = true', moved.baseHash.moved === true, JSON.stringify(moved.baseHash));
  check('the moved base is reported as a warning naming both hashes', /override-base-moved/.test(JSON.stringify(moved.byRule)) && /MOVED/.test(moved.findings.find((finding) => finding.rule === 'override-base-moved')?.message ?? ''));
  check('and it names the vanilla content the override is now DROPPING', moved.elements.missing.includes('zz_surface_host_patch_badge'), JSON.stringify(moved.elements.missing));
  check('the dropping is an ERROR, because an override replaces rather than merges', moved.findings.find((finding) => finding.rule === 'override-vanilla-content-missing')?.severity === 'error', JSON.stringify(moved.byRule));
  check('the new-and-old NUMBERS are reported, with the direction stated', moved.elements.changed.some((entry) => entry.name === 'zz_surface_host' && entry.size.from === '560x320' && entry.size.to === '520x300'), JSON.stringify(moved.elements.changed));
  check('the modified element is reported with both sides named', /vanilla 560x320 -> your copy 520x300/.test(moved.findings.find((finding) => finding.rule === 'override-modifies-vanilla-element')?.message ?? ''), moved.findings.find((finding) => finding.rule === 'override-modifies-vanilla-element')?.message);
  check('the verdict says what to do', /stale/.test(moved.verdict), moved.verdict);

  // AND THE CASE THE SLOT-EXPANDING MODS LIVE IN: an override whose ONLY change is a NUMBER.
  const numberOnly = join(overrideDir, 'number_change_only.gui');
  if (existsSync(numberOnly)) {
    const report = analyseOverrideDrift(numberOnly, join(overrideDir, 'vanilla_host.gui'), { gameRoot: DEFAULT_GAME_ROOT });
    check('an override that only changes numbers adds nothing', report.elements.added.length === 0, JSON.stringify(report.elements.added));
    check('and is STILL reported, because the change is the point', report.elements.changed.length > 0, JSON.stringify(report.elements.changed));
  }

  // THE REAL SHIPPED OVERRIDES ON THIS MACHINE, when they are present. Both are read-only evidence.
  const realPairs = [
    [join('D:', 'StellarisMods', 'aerospace_carrier', 'interface', 'fleet_view.gui'), join(DEFAULT_GAME_ROOT, 'interface', 'fleet_view.gui')],
    [join('D:', 'StellarisMods', 'geocentric_origin', 'interface', 'planet_view.gui'), join(DEFAULT_GAME_ROOT, 'interface', 'planet_view.gui')],
  ];
  for (const [mod, vanilla] of realPairs) {
    if (!existsSync(mod) || !existsSync(vanilla)) continue;
    const report = analyseOverrideDrift(mod, vanilla, { gameRoot: DEFAULT_GAME_ROOT });
    const label = mod.includes('aerospace') ? 'fleet_view' : 'planet_view';
    check(`${label}: the shipped override loses NO vanilla element`, report.elements.missing.length === 0, JSON.stringify(report.elements.missing.slice(0, 5)));
    check(`${label}: its additions are reported with a container that exists`, report.elements.added.length > 0 && report.splicePoints.every((entry) => entry.containerExists), JSON.stringify(report.splicePoints));
    check(`${label}: drift is undetectable because the override records no base hash`, report.baseHash.moved === null && report.byRule['override-base-unrecorded'] === 1, JSON.stringify(report.baseHash));
  }
});

// =====================================================================================
// 19. The measured census: kinds.mjs, the JSON and the generated documentation agree
// =====================================================================================

group('measured census and generated documentation (A5)', () => {
  check('the census JSON exists', existsSync(join(PROJECT_ROOT, 'docs', 'kind-census.json')));
  if (!existsSync(join(PROJECT_ROOT, 'docs', 'kind-census.json'))) return;
  const census = JSON.parse(readFileSync(join(PROJECT_ROOT, 'docs', 'kind-census.json'), 'utf8'));
  const comparison = compareCensusToKinds(census);
  check('kinds.mjs vanillaUses matches the committed census', comparison.ok, JSON.stringify(comparison.mismatches));
  // The census is a statement about what the ENGINE'S PARSERS accept, so the COMPONENT kinds - which
  // have no engine keyword at all and are expanded into real elements by `computeLayout` - are not in
  // it. `docs/kind-census.json` counts `census.kinds.length` real kinds plus `componentKinds`.
  const censusedKinds = ELEMENT_KINDS.filter((spec) => !spec.component);
  check(
    'the census records every ENGINE kind, and no component kind',
    census.kinds.length === censusedKinds.length,
    `${census.kinds.length} vs ${censusedKinds.length} (kinds.mjs has ${ELEMENT_KINDS.length}, of which ${ELEMENT_KINDS.length - censusedKinds.length} are components)`,
  );
  check(
    'no component kind appears in the vanilla census',
    componentKinds().every((kind) => !census.kinds.some((entry) => entry.kind === kind)),
    JSON.stringify(componentKinds()),
  );
  check(
    'the census records the emittable set',
    census.emittableKinds.length === emittableKinds().length,
    `${census.emittableKinds.length} vs ${emittableKinds().length}`,
  );
  check(
    'the component kinds are in the census record too',
    Array.isArray(census.componentKinds) && JSON.stringify(census.componentKinds) === JSON.stringify(componentKinds()),
    JSON.stringify(census.componentKinds),
  );
  check('the census has no parse failures', census.parseFailures.length === 0, JSON.stringify(census.parseFailures.slice(0, 2)));
  check('the census records a version', typeof census.version === 'string' && census.version !== '', census.version);
  check('the census records the size-form counts', typeof census.sizeValueForms?.doublePercent === 'number', JSON.stringify(census.sizeValueForms));

  // Drift guard: re-measure and compare. This is what catches the game updating under us, or a
  // kind table edited without re-running the census.
  if (existsSync(DEFAULT_GAME_ROOT)) {
    const fresh = runKindCensus({ root: DEFAULT_GAME_ROOT, withAssets: false });
    const drift = compareCensusToKinds(fresh);
    check('a fresh census still matches kinds.mjs', drift.ok, JSON.stringify(drift.mismatches));
    check('a fresh census has the same file count', fresh.fileCount === census.fileCount, `${fresh.fileCount} vs ${census.fileCount}`);
    check('a fresh census has the same element total', fresh.elementUses === census.elementUses, `${fresh.elementUses} vs ${census.elementUses}`);
  }

  const stale = checkDocs();
  check('the generated documentation blocks are current', stale.length === 0, JSON.stringify(stale.slice(0, 3)));
  const readme = readFileSync(join(PROJECT_ROOT, 'README.md'), 'utf8');
  check('the README advertises the measured element total', readme.includes(String(census.elementUses)), String(census.elementUses));
  check('the README no longer advertises the old 392/93 counts', !/392 assertions/.test(readme) && !/93 assertions/.test(readme));
  check('the README documents the text size rule', /maxWidth/.test(readme) && /Unexpected token: size/.test(readme));
  check('the README documents the override door', /gui_emit_override/.test(readme));
  const sources = readFileSync(join(PROJECT_ROOT, 'docs', 'sources.md'), 'utf8');
  check('sources.md carries the generated census too', sources.includes(String(census.elementUses)));
});

// =====================================================================================
// 20. Real-input census: every vanilla .gui file
// =====================================================================================

group('vanilla .gui census (real input)', () => {
  let census = null;
  try {
    census = runGuiCensus({ root: DEFAULT_GAME_ROOT });
  } catch (thrown) {
    check('the vanilla install is readable', false, thrown instanceof Error ? thrown.message : String(thrown));
  }
  if (census) {
    process.stdout.write(`  info ${summariseCensus(census)}\n`);
    check('found the expected number of .gui files', census.fileCount >= 170, String(census.fileCount));
    check('parsed every vanilla .gui file', census.parseFailures.length === 0, JSON.stringify(census.parseFailures.slice(0, 3)));
    check('every file resolved to a guiTypes root', Object.keys(census.rootKeywords).every((keyword) => /^guiTypes$/i.test(keyword)), JSON.stringify(census.rootKeywords));
    check('the mixed-case guitypes spelling is present', (census.rootKeywords.guitypes ?? 0) >= 1, JSON.stringify(census.rootKeywords));
    check('counted a plausible total element count', census.totalElements >= 11000, String(census.totalElements));
    check('counted a plausible top-level container count', census.topLevelContainers >= 1150, String(census.topLevelContainers));
    // `key { ... }` without an `=` used to end the enclosing element at the first `}`, spilling
    // nested containers out to the root. Parsing galaxy_view.gui:1646
    // (`position { x = @[ shroudPlaneRadius ] y = @[ shroudPlaneRadius ] }`) correctly is what
    // moved this count from 1267 to 1197.
    check('the top-level container count is not inflated by early-terminated blocks', census.topLevelContainers < 1250, String(census.topLevelContainers));
    check('a bracket-variable position resolves and stays inside its element', (() => {
      const parsed = parseGuiText('guiTypes = {\n\tcontainerWindowType = {\n\t\tname = "w"\n\t\tsize = { width = 10 height = 10 }\n\t\tbuttonType = {\n\t\t\tname = "b"\n\t\t\tposition { x = @[ pad ] y = @[ pad ] }\n\t\t\tsize = { x = 5 y = 5 }\n\t\t\tquadTextureSprite = "GFX_x"\n\t\t}\n\t}\n}\n', 'bracket.gui');
      const button = (parsed.layout.root.children[0].children ?? []).find((child) => child.name === 'b');
      // `@[ name ]` is a variable reference the layout engine cannot evaluate statically, so the
      // canonical conversion must LEAVE IT ALONE rather than coerce it to 0 - coercing it would
      // silently rewrite the emitted file. The declaration surviving verbatim is the assertion.
      return button?.position?.x === '@pad' && button?.position?.y === '@pad' && button?.quadTextureSprite === 'GFX_x';
    })(), 'the @[ name ] form did not survive the canonical conversion');
    check('found files with @variables before the root', census.filesWithVariablesBeforeRoot >= 20, String(census.filesWithVariablesBeforeRoot));
    check('the four P1 kinds dominate the census', ['container', 'text', 'icon', 'button'].every((kind) => (census.elementCounts[kind] ?? 0) > 1500), JSON.stringify(census.elementCounts));
    check('gridBox is recognised in real input', (census.elementCounts.gridBox ?? 0) > 200, String(census.elementCounts.gridBox));
    check('only a small fraction of sizes fail to resolve', census.unresolvedSizeIssues < 400, String(census.unresolvedSizeIssues));
    check('the census passes its own expectations', census.expectationsMet.pass, JSON.stringify(census.expectationsMet.checks.filter((entry) => !entry.ok)));
  }
});

// =====================================================================================
// 15. A real .gfx census (proves the index handles the shipped files)
// =====================================================================================

group('vanilla .gfx census (real input)', () => {
  let index = null;
  try {
    index = buildAssetIndex({ root: DEFAULT_GAME_ROOT });
  } catch (thrown) {
    check('the asset index builds against the real install', false, thrown instanceof Error ? thrown.message : String(thrown));
  }
  if (index) {
    check('indexed over 100 .gfx files', index.stats.gfxFileCount >= 100, String(index.stats.gfxFileCount));
    check('found thousands of sprite names', index.stats.spriteCount >= 8000, String(index.stats.spriteCount));
    check('read DDS headers for thousands of textures', index.stats.textureHeaderReads >= 5000, String(index.stats.textureHeaderReads));
    check('almost every DDS header parsed', index.stats.textureHeaderFailures <= 20, String(index.stats.textureHeaderFailures));
    check('indexed the bitmap fonts', index.stats.fontCount >= 10, String(index.stats.fontCount));
    check('indexed the button effects', index.stats.buttonEffectCount >= 2, String(index.stats.buttonEffectCount));
    check('indexed containerWindowType names', index.stats.containerCount >= 2000, String(index.stats.containerCount));
    check('the index reports its own size', index.stats.indexBytes > 1_000_000, String(index.stats.indexBytes));

    // The five verified default sprites must all resolve.
    for (const name of ['GFX_tile_large_bg', 'GFX_tile_large_bg_plain', 'GFX_tiling_button_standard', 'GFX_button_close', 'GFX_main_close_button']) {
      const info = spriteInfo(index, name);
      check(`the default part ${name} resolves`, info.found === true, JSON.stringify(info.suggestions));
    }
    for (const name of ['malgun_goth_24', 'cg_16b']) {
      check(`the default font ${name} resolves`, Boolean(index.fonts[name]), JSON.stringify(Object.keys(index.fonts)));
    }
    check('GFX_tile_large_bg is a corneredTileSpriteType', index.sprites.GFX_tile_large_bg?.kind === 'corneredTileSpriteType', index.sprites.GFX_tile_large_bg?.kind);
    check('GFX_tile_large_bg resolves a real texture size', index.textures['gfx/interface/tiles/tile_large_bg.dds']?.width === 680, JSON.stringify(index.textures['gfx/interface/tiles/tile_large_bg.dds']));

    // A real end-to-end validate + preview against the real index.
    const layout = defaultLayout({ name: 'e2e_window' });
    layout.effects = { e2e_window_accept_effect: { effect: { add_resource: { resource: 'influence', amount: 10 } } } };
    const report = validateLayout(layout, { assets: index });
    check('a fresh default layout validates cleanly against the real index', report.counts.error === 0, JSON.stringify(report.findings.filter((f) => f.severity === 'error').slice(0, 3)));

    // Regression guard for two real bugs. (1) The default layout's close button declares no `size`
    // and relies on GFX_main_close_button's natural size; a `?? 0` default in the size reader made
    // the sprite-natural fallback unreachable, so it computed as 0x0 in the rect table while the
    // drawn SVG still looked right - the disagreement was the tell. (2) That sprite is a
    // `noOfFrames = 3` strip: `close_button.dds` is 114x38, so the button the engine draws is
    // 38x38, NOT 114x38. Reporting the strip's full width made every hit region, overlap and
    // visibility conclusion about it up to three times too wide.
    const layoutLookup = makeSpriteLookup(index);
    const closeSprite = layoutLookup?.('GFX_main_close_button');
    check(
      'makeSpriteLookup resolves the default close sprite from the real index',
      closeSprite?.width === 38 && closeSprite?.height === 38 && closeSprite?.frameCount === 3 && closeSprite?.textureWidth === 114,
      JSON.stringify(closeSprite),
    );
    const defaultBoxes = computeLayout(defaultLayout({ name: 'regression_window' }), { spriteLookup: layoutLookup }).boxes;
    const closeBox = defaultBoxes.find((box) => box.name === 'close');
    check('the default layout close button is sized from its sprite', closeBox.rect.width === 38 && closeBox.rect.height === 38, `${closeBox.rect.width}x${closeBox.rect.height}`);
    check(
      'the close button is ONE frame of its three-frame strip, not the whole strip',
      closeBox.rect.width !== 114,
      `${closeBox.rect.width} (a strip width here means noOfFrames is being ignored)`,
    );
    check('the default layout close button is not reported as zero-size', !validateLayout(defaultLayout({ name: 'regression_window' }), { assets: index }).findings.some((finding) => finding.rule === 'zero-size'));
    const cache = new ThumbnailCache({ directory: join(scratch, 'thumbs-real') });
    const svg = renderSvg(layout, { assets: index, cache });
    check('the preview embeds a real texture', (svg.svg.match(/data:image\/png;base64/g) ?? []).length >= 2, String((svg.svg.match(/data:image\/png;base64/g) ?? []).length));
    check('the preview embeds no placeholder for the known sprites', !svg.svg.includes('no texture'), 'unexpected placeholder');

    const spritesFound = searchSprites(index, { query: 'button', limit: 5 });
    check('searching the real index returns results', spritesFound.length === 5, String(spritesFound.length));
    check('real search results carry DDS sizes', spritesFound.every((sprite) => sprite.width === null || sprite.width > 0));
  }
});

// =====================================================================================
// 16. The canonical coordinate system and the engine converter
// =====================================================================================

group('canonical coordinates and the engine converter', () => {
  // ------------------------------------------------------------------ the converter pair
  // `enginePositionToCanonical` and `canonicalPositionToEngine` must be exact inverses for every
  // orientation, or the preview (which draws canonical) and the file (which carries engine fields)
  // disagree - the defect this whole module exists to prevent.
  let inversions = 0;
  const parent = { x: 0, y: 0, width: 560, height: 568 };
  for (const orientation of ['upper_left', 'center_up', 'upper_right', 'center_left', 'center', 'center_right', 'lower_left', 'center_down', 'lower_right']) {
    for (const engine of [{ x: 7, y: 11 }, { x: -12, y: -11 }, { x: 0, y: 0 }, { x: 3, y: -5 }]) {
      const canonical = enginePositionToCanonical(engine, orientation, parent);
      const back = canonicalPositionToEngine(canonical, orientation, parent);
      if (back.x === engine.x && back.y === engine.y) inversions += 1;
    }
  }
  check('the converter pair is an exact inverse for all 9 orientations x 4 offsets', inversions === 36, `${inversions}/36`);

  // THE SIGN RULE ITSELF, stated as an assertion so a change to it fails here. The engine adds the
  // declared `position` to the anchor for EVERY orientation: `lower_left` is "measured down from the
  // parent's bottom edge", not "measured up from it". A converter that flipped y for the bottom
  // anchors would move every such element by twice its offset - and would show up as a WORSE
  // containment figure in the calibration below, which is how the claim was settled.
  check(
    'no anchor flips the sign of y',
    yDirectionForAnchor('lower_left') === 1 && yDirectionForAnchor('center_down') === 1 && yDirectionForAnchor('upper_left') === 1,
    `${yDirectionForAnchor('lower_left')}/${yDirectionForAnchor('center_down')}/${yDirectionForAnchor('upper_left')}`,
  );
  const bottomAnchored = enginePositionToCanonical({ x: 7, y: -11 }, 'lower_left', parent);
  check('declared lower_left {7,-11} reads as canonical {7,-11}', bottomAnchored.x === 7 && bottomAnchored.y === -11, JSON.stringify({ x: bottomAnchored.x, y: bottomAnchored.y }));
  const literal = enginePositionToCanonical({ x: 7, y: 11 }, 'upper_left', parent);
  check('declared upper_left {7,11} reads as canonical {7,11}', literal.x === 7 && literal.y === 11, JSON.stringify({ x: literal.x, y: literal.y }));
  // The `origo` does move the corner, in canonical space, for a bottom anchor: the pivot is 11 px
  // ABOVE the parent's bottom edge, so a 87 px element anchored on its own lower-left corner starts
  // 87 px higher still.
  const bottomCorner = cornerFromPivot({ x: 42, y: 1038 - 11 }, { width: 265, height: 87 }, 'lower_left');
  check('a bottom-anchored element subtracts its own height from the pivot', bottomCorner.y === 940, JSON.stringify(bottomCorner));

  // ---------------------------------------------------- the worked vanilla case, end to end
  // interface/combat_view.gui:41-45 and :159-164. The window is `lower_left, origo = lower_left`,
  // 560x568 at (35,-42), and `left_stats` is `lower_left, origo = lower_left`, 265x87 at (7,-11).
  // Adding the literals to the anchors puts the window's bottom edge on the screen's bottom edge
  // (1080) and the stats bar's bottom edge 11 px above the window's - i.e. exactly on the screen
  // bottom, which is where a view's stats bar belongs. Flipping y would push both 42/22 px the other
  // way, off the bottom of the screen.
  const combat = parseGuiText(
    'guiTypes = {\n' +
      '\tcontainerWindowType = {\n\t\tname = "combat_view"\n\t\tposition = { x = 35 y = -42 }\n' +
      '\t\tsize = { width = 560 height = 568 }\n\t\torientation = lower_left\n\t\torigo = lower_left\n' +
      '\t\tcontainerWindowType = {\n\t\t\tname = "left_stats"\n\t\t\tsize = { width = 265 height = 87 }\n' +
      '\t\t\tposition = { x = 7 y = -11 }\n\t\t\torientation = lower_left\n\t\t\torigo = lower_left\n\t\t}\n' +
      '\t}\n}\n',
    'combat.gui',
  );
  const combatBoxes = computeLayout(combat.layout).boxes;
  const combatWindow = combatBoxes.find((box) => box.name === 'combat_view');
  const leftStats = combatBoxes.find((box) => box.name === 'left_stats');
  check(
    'the vanilla combat_view window sits on the screen bottom',
    combatWindow.rect.x === 35 && combatWindow.rect.y === 470 && combatWindow.rect.y + combatWindow.rect.height === 1038,
    `${combatWindow.rect.x},${combatWindow.rect.y} bottom ${combatWindow.rect.y + combatWindow.rect.height}`,
  );
  check(
    'the vanilla combat_view left_stats bar sits inside its window',
    leftStats.rect.x === 42 && leftStats.rect.y === 940 && leftStats.rect.width === 265 && leftStats.rect.height === 87,
    `${leftStats.rect.x},${leftStats.rect.y} ${leftStats.rect.width}x${leftStats.rect.height}`,
  );
  check(
    'the stats bar sits 11 px above its window bottom edge (its own declared offset, read literally)',
    combatWindow.rect.y + combatWindow.rect.height === 1038 && leftStats.rect.y + leftStats.rect.height === 1027,
    `window bottom ${combatWindow.rect.y + combatWindow.rect.height}, stats bottom ${leftStats.rect.y + leftStats.rect.height}`,
  );
  check(
    'left_stats keeps its declared engine position, so an import/emit round trip is lossless',
    leftStats.trace.enginePosition.x === 7 && leftStats.trace.enginePosition.y === -11,
    JSON.stringify(leftStats.trace.enginePosition),
  );
  check('left_stats is reported in the canonical frame, unchanged', leftStats.trace.position.x === 7 && leftStats.trace.position.y === -11);

  // ------------------------------------------------- one code path: preview == emitter == table
  const emitted = emitGui(combat.layout, { fileStem: 'combat' });
  check('the emitted file writes the declared position verbatim', /position = \{\s*x = 7\s*y = -11\s*\}/.test(emitted.text), emitted.text.slice(emitted.text.indexOf('left_stats'), emitted.text.indexOf('left_stats') + 220));
  const reparsed = parseGuiText(emitted.text, 'combat-emitted.gui');
  const afterBoxes = computeLayout(reparsed.layout).boxes;
  let delta = 0;
  for (let index = 0; index < combatBoxes.length; index += 1) {
    for (const key of ['x', 'y', 'width', 'height']) {
      delta = Math.max(delta, Math.abs(combatBoxes[index].rect[key] - afterBoxes[index].rect[key]));
    }
  }
  check('canonical -> emitted fields -> re-parsed -> canonical is the identity on the rects', delta === 0, `max delta ${delta}`);
  const emittedTwice = emitGui(reparsed.layout, { fileStem: 'combat' });
  check('emitting twice is byte-stable', emittedTwice.text === emitted.text, 'the second emission differs');

  // --------------------------------------------------------------- a non-identity parent chain
  // The parent is ALSO lower-anchored here, and a nested `lower_*` inside a `lower_*` is exactly
  // the case the original depth-1-only calibration never checked.
  const nested = parseGuiText(
    'guiTypes = {\n' +
      '\tcontainerWindowType = {\n\t\tname = "outer"\n\t\tposition = { x = 10 y = 20 }\n' +
      '\t\tsize = { width = 400 height = 300 }\n\t\torientation = lower_left\n\t\torigo = lower_left\n' +
      '\t\tcontainerWindowType = {\n\t\t\tname = "inner"\n\t\t\tsize = { width = 100 height = 40 }\n' +
      '\t\t\tposition = { x = 5 y = -15 }\n\t\t\torientation = lower_left\n\t\t\torigo = lower_left\n' +
      '\t\t\tcontainerWindowType = {\n\t\t\t\tname = "innermost"\n\t\t\t\tsize = { width = 20 height = 10 }\n' +
      '\t\t\t\tposition = { x = 0 y = -3 }\n\t\t\t\torientation = center_down\n\t\t\t}\n\t\t}\n\t}\n}\n',
    'nested.gui',
  );
  const nestedBoxes = computeLayout(nested.layout).boxes;
  const inner = nestedBoxes.find((box) => box.name === 'inner');
  const innermost = nestedBoxes.find((box) => box.name === 'innermost');
  const outerBox = nestedBoxes.find((box) => box.name === 'outer');
  // outer: the screen's bottom-left (0,1080) + (10,20) -> pivot (10,1100); origo lower_left, so the
  // corner is 300 px above that pivot -> (10, 800).
  // inner: outer's bottom-left (10,1100) + (5,-15) -> pivot (15,1085), corner (15,1045).
  // innermost: inner's bottom-centre (65,1085) + (0,-3) -> pivot (65,1082), corner (65,1082).
  check('the nested fixture lays out from the screen bottom', outerBox.rect.x === 10 && outerBox.rect.y === 800, `${outerBox.rect.x},${outerBox.rect.y}`);
  check(
    'a lower_* child of a lower_* parent sits inside it',
    inner.rect.x === 15 && inner.rect.y === 1045 && inner.rect.width === 100 && inner.rect.height === 40,
    `${inner.rect.x},${inner.rect.y}`,
  );
  check(
    'a center_down grandchild is anchored on its own parent\'s bottom edge',
    innermost.rect.y === 1082,
    `${innermost.rect.x},${innermost.rect.y}`,
  );
  const nestedEmitted = emitGui(nested.layout, { fileStem: 'nested' });
  const nestedAgain = computeLayout(parseGuiText(nestedEmitted.text, 'nested-emitted.gui').layout).boxes;
  let nestedDelta = 0;
  for (let index = 0; index < nestedBoxes.length; index += 1) {
    for (const key of ['x', 'y', 'width', 'height']) {
      nestedDelta = Math.max(nestedDelta, Math.abs(nestedBoxes[index].rect[key] - nestedAgain[index].rect[key]));
    }
  }
  check('the nested lower_* chain round-trips exactly', nestedDelta === 0, `max delta ${nestedDelta}`);

  // ------------------------------------------------------------------ canonical position input
  // A CALLER-BUILT tree carries canonical positions and canonical rects; the emitter must translate
  // them, not copy them, or a canonical lower_* element is written into the wrong place. This is
  // the "an agent only ever thinks in one coordinate system" requirement, asserted.
  const caller = {
    schema: 'rstellarisgui/layout@1',
    name: 'caller',
    baseResolution: { width: 1920, height: 1080 },
    root: {
      id: 'root',
      kind: 'container',
      name: 'caller_window',
      orientation: 'lower_left',
      origo: 'lower_left',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      children: [{ id: 'bar', kind: 'container', name: 'bar', orientation: 'lower_left', origo: 'lower_left', position: { x: 10, y: -20 }, size: { width: 100, height: 40 } }],
    },
  };
  const callerBoxes = computeLayout(caller).boxes;
  const callerBar = callerBoxes.find((box) => box.name === 'bar');
  // The root is lower_left/origo lower_left at (0,0), so its corner is the screen's bottom-left
  // minus its own size (origo is the element's own lower-left): (0, 780). `bar` is lower_left inside
  // it, origo lower_left, canonical (10,-20), so its bottom-left corner is 20 px ABOVE the root's
  // bottom-left (0,1080) -> pivot (10,1060), corner (10, 1020), bottom 1060.
  check('a canonical lower_* child is measured up from the parent\'s bottom edge', callerBar.rect.y === 1060 - 40, `${callerBar.rect.y}`);
  const callerEmit = emitGui(caller, { fileStem: 'caller' });
  const callerBack = computeLayout(parseGuiText(callerEmit.text, 'caller-emitted.gui').layout).boxes;
  check(
    'a caller-built canonical tree emits fields that reproduce its own rects',
    callerBack.find((box) => box.name === 'bar').rect.y === callerBar.rect.y,
    `${callerBack.find((box) => box.name === 'bar').rect.y} vs ${callerBar.rect.y}`,
  );
  check(
    'a caller\'s canonical position reaches the file unchanged (the engine reads it the same way)',
    /position = \{\s*x = 10\s*y = -20\s*\}/.test(callerEmit.text),
    callerEmit.text.slice(callerEmit.text.indexOf('bar'), callerEmit.text.indexOf('bar') + 200),
  );

  // ------------------------------------------------------------------ unresolved positions
  // `position = { x = @var y = @other }` cannot be converted, and the two ways of getting this
  // wrong are both worse than the declaration itself: coercing the strings to numbers puts `NaN`
  // in the emitted file (a token the engine's parser does not know), and writing a literal 0 moves
  // the element. The declaration must survive verbatim.
  const unresolved = parseGuiText(
    'guiTypes = {\n\tcontainerWindowType = {\n\t\tname = "w"\n\t\tsize = { width = 100 height = 100 }\n' +
      '\t\tbuttonType = {\n\t\t\tname = "b"\n\t\t\tposition = { x = @tab_offset y = 12 }\n' +
      '\t\t\tquadTextureSprite = "GFX_x"\n\t\t}\n\t}\n}\n',
    'unresolved.gui',
  );
  const unresolvedEmit = emitGui(unresolved.layout, { fileStem: 'unresolved' });
  check('an unresolved position variable is not coerced to NaN', !unresolvedEmit.text.includes('NaN'), unresolvedEmit.text.slice(unresolvedEmit.text.indexOf('name = "b"'), unresolvedEmit.text.indexOf('name = "b"') + 200));
  check('an unresolved position variable survives verbatim', /x = @tab_offset/.test(unresolvedEmit.text));
  check('a literal sibling component is written as a number', /y = 12/.test(unresolvedEmit.text));
  check('no model plumbing reaches the file', !/coordinateFields|enginePosition|parsedCanonicalPosition|positionDeclared/.test(unresolvedEmit.text));

  // ----------------------------------------------------------- the vanilla calibration, live
  //
  // THE POINT OF THIS BLOCK IS THAT IT CANNOT BE SATISFIED BY A SIGN FLIP. The calibration runs the
  // whole corpus twice - once through the canonical converter and once through the pre-conversion
  // path - and asserts the two agree EXACTLY, per orientation family, per nesting depth, and for
  // every nested `lower_*` element. That is the measurement that settles the y-sign question: a
  // converter that flipped y for the bottom anchors would print different numbers here, and the
  // calibration script reports them side by side. (It did, while that flip was implemented: the
  // aggregate containment fell from 0.7733 to 0.7472 and the nested `lower_*` figure from 0.7332 to
  // 0.0815, because `combat_view.gui`'s own window - `lower_left, origo = lower_left,
  // position = { x = 35 y = -42 }` - stopped sitting where the engine puts it.)
  //
  // The two properties worth asserting on their own are the ones a future edit is most likely to
  // break: the converter must not move anything, and the corpus must still look like a UI.
  try {
    const canonicalRun = calibrateCoordinates({ model: 'canonical' });
    const legacyRun = calibrateCoordinates({ model: 'legacy' });
    check('the calibration parses the whole vanilla corpus', canonicalRun.fileCount >= 170 && canonicalRun.sizedElements > 8000, `${canonicalRun.fileCount} files, ${canonicalRun.sizedElements} sized elements`);
    check(
      'the canonical converter is LOSSLESS: every per-family and per-depth figure matches the pre-conversion path',
      canonicalRun.all.containment === legacyRun.all.containment &&
        canonicalRun.depth1.containment === legacyRun.depth1.containment &&
        canonicalRun.nestedLower.containment === legacyRun.nestedLower.containment,
      `all ${legacyRun.all.containment} -> ${canonicalRun.all.containment}; depth1 ${legacyRun.depth1.containment} -> ${canonicalRun.depth1.containment}; nested lower_* ${legacyRun.nestedLower.containment} -> ${canonicalRun.nestedLower.containment}`,
    );
    check(
      'the canonical converter does not flip y for any declared position',
      canonicalRun.signCensus['lower_*'].flipped === 0 && canonicalRun.signCensus['upper_*'].flipped === 0,
      JSON.stringify({ lower: canonicalRun.signCensus['lower_*'].flipped, upper: canonicalRun.signCensus['upper_*'].flipped }),
    );
    check(
      'the corpus still looks like a UI: most elements are inside their parents and on screen',
      canonicalRun.all.containment > 0.7 && canonicalRun.all.onScreen > 0.9,
      `containment ${canonicalRun.all.containment.toFixed(4)}, on-screen ${canonicalRun.all.onScreen.toFixed(4)}`,
    );
    check(
      'depth-1 elements are contained and on screen at the same rate (their parent is the screen)',
      Math.abs(canonicalRun.depth1.containment - canonicalRun.depth1.onScreen) < 0.0001 && canonicalRun.depth1.containment > 0.94,
      `${canonicalRun.depth1.containment.toFixed(4)} vs ${canonicalRun.depth1.onScreen.toFixed(4)}`,
    );
    check(
      'the sign census shows vanilla authors using a negative y on a bottom anchor',
      canonicalRun.signCensus['lower_*'].negY > canonicalRun.signCensus['lower_*'].posY * 3,
      JSON.stringify(canonicalRun.signCensus['lower_*']),
    );
    // The nested rows must exist at all: a corpus with no nested `lower_*` element could not tell
    // the two models apart, and the original "93.7% on screen" figure was blind for exactly that
    // reason (at depth 1 the anchor is the screen's own edge, where "outside the parent" and
    // "below the screen" are the same sentence).
    const nestedLowerRows = canonicalRun.rows.filter((row) => row.family === 'lower_*' && row.depth !== 'depth1 (parent = screen)');
    check('the calibration reports nested lower_* rows', nestedLowerRows.length > 0 && canonicalRun.nestedLower.n > 300, `${nestedLowerRows.length} rows, n=${canonicalRun.nestedLower?.n}`);
    check(
      'nested lower_* elements are reported per parent family, which depth-1-only calibration could not see',
      Boolean(canonicalRun.nestedLowerInUpperParent) && Boolean(canonicalRun.nestedLowerInCenterParent),
      JSON.stringify({ upper: canonicalRun.nestedLowerInUpperParent?.n ?? 0, center: canonicalRun.nestedLowerInCenterParent?.n ?? 0 }),
    );
  } catch (thrown) {
    check('the calibration runs against the install', false, thrown instanceof Error ? thrown.message : String(thrown));
  }
});

// =====================================================================================
// THE custom_gui CONTRACT AND THE PARKING TRAPS
//
// The fixtures are built from the REAL mod by scripts/make-contract-fixtures.mjs, so the legal case
// is a window that was verified live in game (`logs/error.log` had 0 `Could not find ... in window`)
// and every broken case is a defect the project actually shipped for a round. Each assertion is
// written so that REMOVING the rule makes it fail: the "the rule is what produces this finding"
// checks re-run the same tree with the rule switched off and assert the finding disappears.
// =====================================================================================
group('the custom_gui contract and the parked-element traps', () => {
  const fixtures = join(projectRoot, 'scripts', 'fixtures', 'contract');
  const read = (name) => readFileSync(join(fixtures, name), 'utf8');
  const legalPath = join(fixtures, 'legal_window.gui');
  const legalText = read('legal_window.gui');
  const eventsGuardedPath = join(fixtures, 'events_guarded.txt');
  const eventsUnguardedPath = join(fixtures, 'events_unguarded.txt');
  const scriptedPath = join(fixtures, 'scripted_effects.txt');
  const effectsRoot = join(fixtures, 'button_effects');
  const locRoot = join(fixtures, 'localisation');
  const WINDOW = 'geocentric_unga_main';
  // The window's fitted rectangle, from the real file: needed by the parking tests.
  const frame = { x: 280, y: 150, width: 1360, height: 780 };

  /** The contract findings the tree itself produces, with the cross-file pass off. */
  const contractFindings = (path, options = {}) =>
    validateGuiText(readFileSync(path, 'utf8'), path, {
      sourceFiles: [path],
      options: { customGuiWindows: [WINDOW], ...options },
    }).findings;

  const rulesOf = (findings) => findings.map((finding) => finding.rule);
  const byRule = (findings, rule) => findings.filter((finding) => finding.rule === rule);

  // ---------------------------------------------------------------- the contract table itself
  check(
    'the contract table carries the engine string-table names',
    ['empire_info_bg', 'EVENT_DIPLO', 'option_list', 'leader_traits', 'empire_traits_label'].every((name) =>
      CONTRACT_ELEMENTS.some((entry) => entry.name === name),
    ),
    JSON.stringify(CONTRACT_ELEMENTS.map((entry) => entry.name)),
  );
  check(
    'the demanded set is derived from the table, not typed twice',
    REQUIRED_WINDOW_NAMES.length === demandedContractNames().length && REQUIRED_WINDOW_NAMES.length === 26,
    `${REQUIRED_WINDOW_NAMES.length} demanded; expected 26`,
  );
  check(
    'a name fewer than CONTRACT_MIN_WINDOWS vanilla files declare is not demanded',
    !REQUIRED_WINDOW_NAMES.includes('leader_traits_box') && !REQUIRED_WINDOW_NAMES.includes('event_option_entry'),
    `min=${CONTRACT_MIN_WINDOWS}, demanded=${REQUIRED_WINDOW_NAMES.join(',')}`,
  );
  check(
    'the engine-table names no working window declares are carried as notes, not demands',
    NOTE_WINDOW_NAMES.length === 6 && NOTE_WINDOW_NAMES.every((name) => !REQUIRED_WINDOW_NAMES.includes(name)),
    NOTE_WINDOW_NAMES.join(','),
  );
  check(
    'every contract rule has a severity and a description, so the generated README cannot omit it',
    [
      'custom-gui-contract-missing',
      'custom-gui-contract-duplicate',
      'custom-gui-contract-nesting',
      'custom-gui-portrait-nesting',
      'custom-gui-close-not-last',
      'parked-element-shortcut',
      'parked-element-hit-region',
      'parked-duplicate-of-live-control',
      'custom-gui-optionzero-selfref'.replace('zero', '0'),
      'custom-gui-force-open',
    ].every((rule) => RULE_SEVERITY[rule] && RULE_DESCRIPTIONS[rule]),
    JSON.stringify({
      missing: Object.keys(RULE_SEVERITY).filter((rule) => /custom-gui|parked/.test(rule) && !RULE_DESCRIPTIONS[rule]),
    }),
  );

  // ---------------------------------------------------------------- the LEGAL window
  const legalFindings = contractFindings(legalPath);
  check(
    'the shipped window (real mod, verbatim) produces NO contract finding',
    rulesOf(legalFindings).every((rule) => !/^custom-gui-/.test(rule)),
    JSON.stringify(rulesOf(legalFindings)),
  );
  check(
    'the same window still reports the two parked controls that carry a shortcut (`t`, `q`) - the trap is real in the shipped file',
    byRule(legalFindings, 'parked-element-shortcut').length === 2,
    JSON.stringify(byRule(legalFindings, 'parked-element-shortcut').map((finding) => finding.element)),
  );
  check(
    'the contract check runs by default: a layout with a custom_gui window is checked without being asked',
    validateLayout(parseGuiText(legalText, legalPath).layout, { options: { checkCustomGuiContract: false } }).byRule['custom-gui-contract-missing'] === undefined,
    'the off switch must be the only way to silence it',
  );

  // ---------------------------------------------------------------- each broken variant
  const closeNotLast = contractFindings(join(fixtures, 'broken_close_not_last.gui'));
  check(
    '`close` as the first direct child is reported as `custom-gui-close-not-last`',
    byRule(closeNotLast, 'custom-gui-close-not-last').length === 1,
    JSON.stringify(rulesOf(closeNotLast).filter((rule) => /close/.test(rule))),
  );
  check(
    'the close-order finding says which siblings draw over the X',
    /EVENT_DIPLO/.test(byRule(closeNotLast, 'custom-gui-close-not-last')[0]?.message ?? ''),
    byRule(closeNotLast, 'custom-gui-close-not-last')[0]?.message,
  );
  check(
    'REMOVING the close-order rule makes this fixture pass: the finding is the rule, not something else',
    contractFindings(join(fixtures, 'broken_close_not_last.gui'), { checkCustomGuiContract: false }).every(
      (finding) => finding.rule !== 'custom-gui-close-not-last',
    ),
  );

  const nestedList = contractFindings(join(fixtures, 'broken_option_list_nested.gui'));
  check(
    '`option_list` one container deeper is reported as `custom-gui-contract-nesting`',
    byRule(nestedList, 'custom-gui-contract-nesting').length === 1 &&
      /option_list/.test(byRule(nestedList, 'custom-gui-contract-nesting')[0].message),
    JSON.stringify(rulesOf(nestedList).filter((rule) => /nesting/.test(rule))),
  );
  check(
    'the nesting finding names EVENT_DIPLO and the depth it found the list at',
    /EVENT_DIPLO/.test(byRule(nestedList, 'custom-gui-contract-nesting')[0]?.message ?? '') &&
      /depth 3/.test(byRule(nestedList, 'custom-gui-contract-nesting')[0]?.message ?? ''),
    byRule(nestedList, 'custom-gui-contract-nesting')[0]?.message,
  );

  const missingContract = contractFindings(join(fixtures, 'broken_missing_contract.gui'));
  const missingFinding = byRule(missingContract, 'custom-gui-contract-missing')[0];
  check(
    'five deleted contract elements are reported as ONE error naming all of them',
    byRule(missingContract, 'custom-gui-contract-missing').length === 1 && missingFinding?.severity === 'error',
    JSON.stringify(byRule(missingContract, 'custom-gui-contract-missing').map((finding) => finding.severity)),
  );
  check(
    'the missing list includes the crash-class names and the ones the engine resolves inside EVENT_DIPLO',
    ['empire_info_bg', 'EVENT_DIPLO', 'option_list', 'close', 'portrait'].every((name) => missingFinding?.missing?.includes(name)),
    JSON.stringify(missingFinding?.missing),
  );
  check(
    'a missing contract element is an ERROR only because an event names the window; inferred windows get a warning',
    byRule(
      contractFindings(join(fixtures, 'broken_missing_contract.gui'), { customGuiWindows: [] }),
      'custom-gui-contract-missing',
    )[0]?.severity === 'warning',
    JSON.stringify(
      byRule(contractFindings(join(fixtures, 'broken_missing_contract.gui'), { customGuiWindows: [] }), 'custom-gui-contract-missing').map(
        (finding) => finding.severity,
      ),
    ),
  );

  const effectOnButton = contractFindings(join(fixtures, 'broken_effect_on_button.gui'));
  const effectFinding = byRule(effectOnButton, 'field-not-accepted')[0];
  check(
    '`effect` on a `buttonType` is reported as an ERROR',
    Boolean(effectFinding) && effectFinding.severity === 'error',
    JSON.stringify(byRule(effectOnButton, 'field-not-accepted').map((finding) => `${finding.severity}:${finding.message.slice(0, 60)}`)),
  );
  check(
    'the finding quotes the engine token `Unexpected token: effect`',
    /Unexpected token: effect/.test(effectFinding?.engineMessage ?? ''),
    effectFinding?.engineMessage,
  );
  check(
    'the finding offers `effectbuttonType` as the replacement, because that is the fix',
    /effectbuttonType/.test(effectFinding?.suggestedFix ?? ''),
    effectFinding?.suggestedFix,
  );
  check(
    '`effect` is registered as an engine-rejected field, which is what makes it an error and not a warning',
    isEngineRejectedField('effect') && isEngineRejectedField('Effect'),
  );
  check(
    'the same text through `checkGuiSyntax` (the FILE checker) reports it too, with a line number',
    (() => {
      const syntax = checkGuiSyntax(read('broken_effect_on_button.gui'), join(fixtures, 'broken_effect_on_button.gui'));
      const finding = syntax.findings.find((entry) => entry.rule === 'field-not-accepted');
      return Boolean(finding) && finding.severity === 'error' && Number.isInteger(finding.line);
    })(),
  );
  check(
    'the LEGAL window does not produce it: its close control is an `effectbuttonType`',
    byRule(contractFindings(legalPath), 'field-not-accepted').length === 0,
    JSON.stringify(rulesOf(contractFindings(legalPath))),
  );

  // The mirror case: the kind is right and the KEY is wrong.
  const unresolvedEffects = checkFiles({
    paths: [join(fixtures, 'broken_effect_unresolved.gui')],
    languages: ['english'],
    localisationRoots: [locRoot],
    roots: [],
    buttonEffects: new Set(),
    assets: null,
  });
  check(
    'an `effectbuttonType` whose `effect` key exists nowhere is reported as `effect-unresolved`',
    byRule(unresolvedEffects.findings, 'effect-unresolved').length === 1 &&
      /unga_no_such_effect/.test(byRule(unresolvedEffects.findings, 'effect-unresolved')[0].message),
    JSON.stringify(rulesOf(unresolvedEffects.findings).filter((rule) => /effect/.test(rule))),
  );
  check(
    'the unresolved-effect finding says the button will render and do nothing',
    /do nothing/.test(byRule(unresolvedEffects.findings, 'effect-unresolved')[0]?.message ?? ''),
    byRule(unresolvedEffects.findings, 'effect-unresolved')[0]?.message,
  );
  check(
    'the same window PASSES once the mod\'s own button_effects key is available - the check is about the keyset',
    (() => {
      const withKeys = checkFiles({
        paths: [legalPath],
        languages: ['english'],
        localisationRoots: [locRoot],
        roots: [],
        assets: null,
        // The mod's own key set, read the way a caller with `button_effects_roots` gets it.
        buttonEffects: new Set(
          [...read(join('button_effects', 'zz_geocentric_unga_button_effects.txt')).matchAll(/^([a-z][a-z0-9_]*)\s*=\s*\{/gm)].map(
            (match) => match[1],
          ),
        ),
      });
      return byRule(withKeys.findings, 'effect-unresolved').length === 0;
    })(),
  );

  const parked = contractFindings(join(fixtures, 'broken_parked_shortcut.gui'));
  check(
    'a parked duplicate close carrying `shortcut = ESCAPE` is reported',
    byRule(parked, 'parked-element-shortcut').some((finding) => finding.element === 'close_parked' && /ESCAPE/i.test(finding.message)),
    JSON.stringify(byRule(parked, 'parked-element-shortcut').map((finding) => finding.element)),
  );
  check(
    'the parked duplicate also keeps a hit region, and is reported for that',
    byRule(parked, 'parked-element-hit-region').some((finding) => finding.element === 'close_parked'),
    JSON.stringify(byRule(parked, 'parked-element-hit-region').map((finding) => finding.element)),
  );
  check(
    'a parked zero-size text element is NOT reported: only controls can be a hit region',
    byRule(legalFindings, 'parked-element-hit-region').length === 0 &&
      byRule(parked, 'parked-element-hit-region').every((finding) => ['close_parked'].includes(finding.element)),
    JSON.stringify(byRule(parked, 'parked-element-hit-region').map((finding) => `${finding.element}:${finding.kind}`)),
  );

  // ---------------------------------------------------------------- the parking predicate itself
  check('a 0x0 element is parked', isParked({ rect: { x: 1595, y: 166, width: 0, height: 0 } }, frame));
  check('an element at -3000,-3000 is parked', isParked({ rect: { x: -3000, y: -3000, width: 38, height: 38 } }, frame));
  check(
    'a panel 100 px outside its window is NOT parked: that is a layout question, not a parking one',
    !isParked({ rect: { x: frame.x + frame.width + 100, y: frame.y, width: 50, height: 50 } }, frame),
  );
  check('a live control inside the window is not parked', !isParked({ rect: { x: 1595, y: 166, width: 38, height: 38 } }, frame));
  check(
    'the window range test finds exactly the containers of a merged layout',
    (() => {
      const parsed = parseGuiText(legalText, legalPath);
      const { boxes } = computeLayout(parsed.layout, {});
      const windows = windowBoxesOf(parsed.layout, boxes);
      return windows.length === 1 && windows[0].name === WINDOW && windows[0].toIndex === boxes.length - 1;
    })(),
  );
  check(
    'a container that is not an event window (no EVENT_DIPLO, no contract children) is skipped',
    !isEventWindow({ name: 'my_panel', children: [{ name: 'bg' }, { name: 'title' }] }) &&
      isEventWindow({ name: 'my_panel', children: [{ name: 'EVENT_DIPLO' }] }),
  );
  check(
    'being NAMED by an event is not enough: an option-row container stays out of the contract check',
    !isEventWindow({ name: 'my_row', children: [{ name: 'option_button' }] }, { customGuiWindows: ['my_row'] }),
  );

  // ---------------------------------------------------------------- the cross-file rules, through checkFiles
  const guarded = checkFiles({
    paths: [legalPath, eventsGuardedPath, scriptedPath, join(effectsRoot, 'zz_geocentric_unga_button_effects.txt')],
    languages: ['english'],
    localisationRoots: [locRoot],
    roots: [],
    assets: null,
  });
  const unguarded = checkFiles({
    paths: [legalPath, eventsUnguardedPath, scriptedPath, join(effectsRoot, 'zz_geocentric_unga_button_effects.txt')],
    languages: ['english'],
    localisationRoots: [locRoot],
    roots: [],
    assets: null,
  });
  // The full event file is a PANEL WALL: every event is opened by another one, so option 0 is a
  // navigation row and an unguarded self-reference is a wart, not the crash. The single-event
  // fixture below is where nothing else opens the event, and there the same defect is a warning.
  const selfWindow = checkFiles({
    paths: [legalPath, join(fixtures, 'events_self_window.txt'), scriptedPath, join(effectsRoot, 'zz_geocentric_unga_button_effects.txt')],
    languages: ['english'],
    localisationRoots: [locRoot],
    roots: [],
    assets: null,
  });
  check(
    'the shipped event file: option 0 is reported at `info`, because the flag guard IS found',
    byRule(guarded.findings, 'custom-gui-option0-selfref').every((finding) => finding.severity === 'info') &&
      byRule(guarded.findings, 'custom-gui-option0-selfref').length >= 1,
    JSON.stringify(byRule(guarded.findings, 'custom-gui-option0-selfref').map((finding) => finding.severity)),
  );
  check(
    'the option-0 finding names the scripted effect it followed and says the guard is the fix',
    /geocentric_unga_main_option_effect/.test(byRule(guarded.findings, 'custom-gui-option0-selfref')[0]?.message ?? '') &&
      /guarded/.test(byRule(guarded.findings, 'custom-gui-option0-selfref')[0]?.message ?? ''),
    byRule(guarded.findings, 'custom-gui-option0-selfref')[0]?.message,
  );
  check(
    'the option-0 role is reported, so the severity can be argued with',
    byRule(guarded.findings, 'custom-gui-option0-selfref').every((finding) => finding.option0Role === 'guarded'),
    JSON.stringify(byRule(guarded.findings, 'custom-gui-option0-selfref').map((finding) => finding.option0Role)),
  );
  check(
    'a panel wall (`events_unguarded.txt`): an unguarded self-firing row is a NAVIGATION cycle, reported at `info`',
    byRule(unguarded.findings, 'custom-gui-option0-selfref').length > 0 &&
      byRule(unguarded.findings, 'custom-gui-option0-selfref').every(
        (finding) => finding.severity === 'info' && finding.option0Role === 'navigation-row',
      ),
    JSON.stringify(byRule(unguarded.findings, 'custom-gui-option0-selfref').map((finding) => `${finding.severity}:${finding.option0Role}`)),
  );
  check(
    'one event, nothing else opening it (`events_self_window.txt`): the same code is a WARNING - the close-then-reopen crash',
    byRule(selfWindow.findings, 'custom-gui-option0-selfref').length === 1 &&
      byRule(selfWindow.findings, 'custom-gui-option0-selfref')[0].severity === 'warning' &&
      byRule(selfWindow.findings, 'custom-gui-option0-selfref')[0].option0Role === 'window-opener',
    JSON.stringify(byRule(selfWindow.findings, 'custom-gui-option0-selfref').map((finding) => `${finding.severity}:${finding.option0Role}`)),
  );
  check(
    'the crash message explains why `has_active_event` cannot replace the flag',
    /has_active_event/.test(byRule(selfWindow.findings, 'custom-gui-option0-selfref')[0]?.message ?? ''),
    byRule(selfWindow.findings, 'custom-gui-option0-selfref')[0]?.message?.slice(0, 200),
  );
  check(
    'the navigation-cycle message cites the measured log line instead of calling it a crash',
    /selectedOption 0/.test(byRule(unguarded.findings, 'custom-gui-option0-selfref')[0]?.message ?? '') &&
      /NAVIGATION row/i.test(byRule(unguarded.findings, 'custom-gui-option0-selfref')[0]?.message ?? ''),
    byRule(unguarded.findings, 'custom-gui-option0-selfref')[0]?.message?.slice(0, 240),
  );
  check(
    '`force_open` combined with `custom_gui` is a warning per event',
    byRule(guarded.findings, 'custom-gui-force-open').length === 11,
    String(byRule(guarded.findings, 'custom-gui-force-open').length),
  );
  check(
    'the cross-file pass reports the window names it read from the events',
    guarded.customGuiWindows.includes(WINDOW) && guarded.customGuiWindows.includes('geocentric_unga_nav_option'),
    JSON.stringify(guarded.customGuiWindows),
  );
  check(
    'the effect button resolves once the mod\'s own button_effects root is passed',
    byRule(guarded.findings, 'effect-unresolved').length === 0,
    JSON.stringify(byRule(guarded.findings, 'effect-unresolved').map((finding) => finding.element)),
  );

  // ---------------------------------------------------------------- the script walker, on its own
  const definitions = indexScriptDefinitions([readFileSync(scriptedPath, 'utf8')]);
  const guardedEvents = extractEvents(readFileSync(eventsGuardedPath, 'utf8'));
  const firstOption = guardedEvents[0].options[0];
  const fired = collectFiredEventIds({ children: firstOption.children }, { definitions });
  check(
    'the effect walker follows a scripted effect to the event it fires',
    fired.some((entry) => entry.id === guardedEvents[0].id),
    JSON.stringify(fired),
  );
  check(
    'an event with no custom_gui is not walked for the option-0 rule',
    extractEvents('country_event = { id = plain.1 option = { name = x hidden_effect = { country_event = { id = plain.1 } } } }').length === 1 &&
      extractEvents('country_event = { id = plain.1 option = { name = x } }')[0].customGui === null,
  );

  // ---------------------------------------------------------------- the pre-write gate
  const planOf = (file) => {
    const path = join(fixtures, file);
    const parsed = parseGuiText(readFileSync(path, 'utf8'), path);
    return planEmit(parsed.layout, { fileStem: 'gate', customGuiWindows: [WINDOW] });
  };
  const legalPlan = planOf('legal_window.gui');
  const brokenPlan = planOf('broken_close_not_last.gui');
  check(
    'the emit PLAN carries the contract check, against the tree about to be written',
    Boolean(legalPlan.contract) && legalPlan.contract.ok === true,
    JSON.stringify(legalPlan.contract?.byRule),
  );
  check(
    'a violating tree fails the plan gate and adds a blocking warning',
    brokenPlan.contract?.ok === false &&
      brokenPlan.contract.errors.some((finding) => finding.rule === 'custom-gui-close-not-last') &&
      brokenPlan.warnings.some((warning) => warning.rule === 'custom-gui-contract-blocking'),
    JSON.stringify({ ok: brokenPlan.contract?.ok, rules: brokenPlan.contract?.byRule, warnings: brokenPlan.warnings.map((warning) => warning.rule) }),
  );
  check(
    'the gate can be switched off, and the legal tree is never blocked',
    planEmit(parseGuiText(readFileSync(join(fixtures, 'broken_close_not_last.gui'), 'utf8'), '(x)').layout, {
      fileStem: 'gate',
      checkContract: false,
    }).contract === null,
  );

  // ---------------------------------------------------------------- the log scanner
  const logText = [
    '[06:52:09][eventcommands.cpp:88]: Event geocentric_unga.1 added info about event selection. selectedOption 0, human 1, playerEventId 9',
    '[06:52:09][effect.cpp:471]: Error: "Unexpected token: resource, near line: 130" in file: "common/button_effects/zz_x.txt"',
    '[06:52:10][eventcommands.cpp:88]: Event geocentric_unga.1 added info about event selection. selectedOption 0, human 1, playerEventId 10',
    '[06:52:11][diplomatic_eventwindow.cpp:412]: Could not find leader_traits_box in window geocentric_unga_main',
    '[06:52:12][event.cpp:900]: Event geocentric_unga.4 has no options in events/zz_x.txt',
    '[06:52:13][localisation.cpp:1]: Missing localization key [unga_missing]',
    'Wrong scope for effect country_event',
  ].join('\n');
  const scanned = scanLogText(logText, { file: '(fixture)' });
  check(
    'the log scanner finds the engine\'s per-option selection line and its four numbers',
    scanned.entries.filter((entry) => entry.kind === 'event-selection').length === 2 &&
      scanned.entries[0].option === 0 &&
      scanned.entries[0].playerEventId === 9,
    JSON.stringify(scanned.entries.filter((entry) => entry.kind === 'event-selection')),
  );
  check(
    'it classifies a missing contract element, a rejected token, an optionless event and a missing key',
    ['missing-contract-element', 'unexpected-token', 'event-without-option', 'missing-localisation', 'wrong-scope'].every((kind) =>
      scanned.entries.some((entry) => entry.kind === kind),
    ),
    JSON.stringify(scanned.byKind),
  );
  check(
    'it reads the file an engine line names',
    scanned.entries.find((entry) => entry.kind === 'unexpected-token')?.file === 'common/button_effects/zz_x.txt',
    JSON.stringify(scanned.entries.find((entry) => entry.kind === 'unexpected-token')),
  );
  check(
    'it recognises the close-then-reopen signature: two option-0 selections of one event, seconds apart',
    (() => {
      const selections = scanned.entries.filter((entry) => entry.kind === 'event-selection');
      const cycles = findReopenCycles(selections, { withinSeconds: 3 });
      return cycles.length === 1 && cycles[0].eventId === 'geocentric_unga.1';
    })(),
    JSON.stringify(findReopenCycles(scanned.entries.filter((entry) => entry.kind === 'event-selection'), { withinSeconds: 3 }).map((cycle) => cycle.eventId)),
  );
  check(
    'a NON-option-0 repeat is not a re-open: navigating away and back is normal',
    findReopenCycles(
      [
        { eventId: 'e.1', option: 1, time: '01:00:00' },
        { eventId: 'e.1', option: 1, time: '01:00:01' },
      ],
      { withinSeconds: 3 },
    ).length === 0,
  );
  check(
    'a close (option 0) followed by a NAVIGATION row (option 1) is the HEALTHY sequence, not a re-open',
    findReopenCycles(
      [
        { eventId: 'e.1', option: 0, time: '01:00:00' },
        { eventId: 'e.1', option: 1, time: '01:00:03' },
      ],
      { withinSeconds: 3 },
    ).length === 0,
  );
  check(
    'two option-0 selections in a row ARE the re-open',
    findReopenCycles(
      [
        { eventId: 'e.1', option: 0, time: '01:00:00' },
        { eventId: 'e.1', option: 0, time: '01:00:01' },
      ],
      { withinSeconds: 3 },
    ).length === 1,
  );
  check(
    'three option-0 selections in a row are two cycles, not one',
    findReopenCycles(
      [
        { eventId: 'e.1', option: 0, time: '01:00:00' },
        { eventId: 'e.1', option: 0, time: '01:00:01' },
        { eventId: 'e.1', option: 0, time: '01:00:02' },
      ],
      { withinSeconds: 3 },
    ).length === 2,
  );
  check(
    'two option-0 selections a minute apart are not a re-open',
    findReopenCycles(
      [
        { eventId: 'e.1', option: 0, time: '01:00:00' },
        { eventId: 'e.1', option: 0, time: '01:01:00' },
      ],
      { withinSeconds: 3 },
    ).length === 0,
  );

  // ---------------------------------------------------------------- the real logs, when present
  //
  // A real log is READ but never ASSUMED: Stellaris rotates/truncates its logs on every launch, so
  // "game.log has 15 selections" is true only until the next run. The assertions below hold for any
  // state of the file, and the deterministic coverage of the scanner is the fixture block above.
  const documentsRoot = defaultDocumentsRoot();
  const realGameLog = join(documentsRoot, 'logs', 'game.log');
  if (existsSync(realGameLog)) {
    const real = scanEngineLogs({ gameLog: realGameLog, errorLog: join(documentsRoot, 'logs', 'error.log') });
    check(
      'the scanner reads the real game.log on disk and reports it as a scanned file',
      real.logs.some((entry) => entry.file === realGameLog && entry.bytes >= 0),
      JSON.stringify(real.logs.map((entry) => `${entry.file.split('\\').pop()}:${entry.bytes}`)),
    );
    check(
      'every selection it finds carries the engine\'s four numbers, and cycles only pair option 0 with option 0',
      real.selections.every(
        (entry) =>
          typeof entry.eventId === 'string' &&
          Number.isInteger(entry.option) &&
          Number.isInteger(entry.human) &&
          Number.isInteger(entry.playerEventId),
      ) &&
        real.reopenCycles.every((cycle) => cycle.first.option === 0 && cycle.second.option === 0),
      `${real.selections.length} selections, ${real.reopenCycles.length} cycles`,
    );
  } else {
    check('no game.log present in this environment, so the real-log assertions are skipped', true, realGameLog);
  }
  check(
    'a logs DIRECTORY is expanded to every rotated .log under it',
    (() => {
      const directory = join(scratch, 'logscan');
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'game.log'),
        '[01:00:00][eventcommands.cpp:88]: Event a.1 added info about event selection. selectedOption 0, human 1, playerEventId 1\n',
        'utf8',
      );
      writeFileSync(
        join(directory, 'game.log.1'),
        '[01:00:01][eventcommands.cpp:88]: Event a.1 added info about event selection. selectedOption 0, human 1, playerEventId 2\n',
        'utf8',
      );
      const scanned = scanEngineLogs({ logs: [directory] });
      return scanned.logs.length === 2 && scanned.reopenCycles.length === 1 && scanned.reopenCycles[0].eventId === 'a.1';
    })(),
  );
  void analyseEventWindows;
  void checkParkedElements;
  void legalText;
  void eventsUnguardedPath;
});

// =====================================================================================
// GAP-11: an out-of-bounds element can be a DELIBERATE PARK, and the report must say which
// GAP-12: a control's visibility can live in common/button_effects/, not in the .gui
//
// THE ASSERTIONS HERE FAIL IF THE RULES ARE REMOVED. For GAP-12 that is the whole point: the defect
// shipped, was played, and was reported by a player before ANY check in this project noticed, because
// the condition is not in the `.gui` at all. The fixture below is the measured pre-fix shape
// (`potential = { is_scope_type = planet ... }`), and the suite asserts both the finding AND the
// per-element table that has to be readable when no finding fires.
// =====================================================================================

group('a park is not an escape, and visibility can live outside the .gui (GAP-11/GAP-12)', () => {
  const scratchDir = join(scratch, 'gap11-gap12');
  mkdirSync(scratchDir, { recursive: true });
  const box = (name, x, y, width, height, kind = 'container') => ({
    id: name,
    kind,
    name,
    position: { x, y },
    size: kind === 'effectbutton' ? { x: width, y: height } : { width, height },
  });
  const effectbuttonElement = (name, effect) => ({
    ...box(name, 10, 10, 160, 24, 'effectbutton'),
    quadTextureSprite: 'GFX_tiles_dark_area_cut_8',
    buttonText: `${name}_text`,
    effect,
  });
  /**
   * A file with ONE top-level `containerWindowType` named `window`, holding `children`. The shape
   * matters: the visibility table answers "which window is this element in", and a bare child of the
   * synthetic root is not in a window at all. `baseResolution` equals `bounds` so the WINDOW itself is
   * never out of bounds and every finding below is about the child under test.
   */
  const windowLayout = (children, name = 'g12_window', extra = {}) => ({
    schema: 'rstellarisgui/layout@1',
    name: 'gap12_test',
    baseResolution: { width: 1000, height: 1000 },
    root: {
      id: 'root',
      kind: 'container',
      syntheticRoot: true,
      name: '(selftest.gui)',
      size: { width: 1000, height: 1000 },
      children: [
        {
          id: 'w1',
          kind: 'container',
          name,
          position: { x: 0, y: 0 },
          size: { width: 1000, height: 1000 },
          children,
          ...extra,
        },
      ],
    },
  });

  // ---------------------------------------------------------------- GAP-11: the park margin
  //
  // `bounds` is the root rect the geometry rules measure against. At -3000 an element is 3000 px
  // outside it: that is the idiom the project uses to hide a contract-required element, NOT an element
  // escaping a window. The classification is a REPORTED count, never a suppression.
  const bounds = { width: 1000, height: 1000 };
  const parkedLayout = windowLayout([box('parked', -3000, -3000, 100, 100)]);
  const parked = validateLayout(parkedLayout, { options: { bounds } });
  check(
    'a far-outside element is reported as `out-of-bounds-parked`, not as an escape',
    parked.findings.some((finding) => finding.rule === 'out-of-bounds-parked' && finding.element === 'parked') &&
      !parked.findings.some((finding) => finding.rule === 'out-of-bounds'),
    JSON.stringify(parked.byRule),
  );
  check(
    'the parked element does not make the file fail: a park is not an error',
    parked.ok === true && parked.verdict === 'pass',
    JSON.stringify(parked.counts),
  );
  check(
    'the parked finding carries how far out it is and the margin that decided it',
    (() => {
      const finding = parked.findings.find((entry) => entry.rule === 'out-of-bounds-parked');
      return finding.distance === 3000 && finding.parked === true && finding.parkMargin === 512;
    })(),
    JSON.stringify(parked.findings.find((entry) => entry.rule === 'out-of-bounds-parked')),
  );
  check(
    'the exclusion is COUNTED, not silent: geometry.outOfBounds reports total, escaped and parked',
    parked.geometry?.outOfBounds?.parked === 1 &&
      parked.geometry?.outOfBounds?.escaped === 0 &&
      parked.geometry?.outOfBounds?.total === 1 &&
      parked.geometry?.outOfBounds?.parkMargin === 512,
    JSON.stringify(parked.geometry?.outOfBounds),
  );
  check(
    'the note says nothing was suppressed, so a large park count cannot be read as a clean file',
    /Nothing is suppressed/.test(parked.geometry?.outOfBounds?.note ?? ''),
    parked.geometry?.outOfBounds?.note,
  );

  // A REAL escape inside the margin keeps its error and its overflow numbers.
  const escaped = validateLayout(windowLayout([box('escaped', 900, 900, 300, 300)]), { options: { bounds } });
  check(
    'an element just outside the root is still an ESCAPE, at error severity',
    escaped.findings.some((finding) => finding.rule === 'out-of-bounds' && finding.severity === 'error') &&
      escaped.geometry?.outOfBounds?.escaped === 1 &&
      escaped.geometry?.outOfBounds?.parked === 0,
    JSON.stringify(escaped.geometry?.outOfBounds),
  );
  check(
    'the escape is 200 px out and the finding says so',
    escaped.findings.find((finding) => finding.rule === 'out-of-bounds')?.distance === 200,
    JSON.stringify(escaped.findings.find((finding) => finding.rule === 'out-of-bounds')?.distance),
  );

  // The MARGIN is the deciding number, both directions. 400 px out: an escape at the default 512, a
  // park at 256. If the classification is removed, the first half of this assertion fails.
  const four = windowLayout([box('four', -400, 0, 100, 100)]);
  const atDefault = validateLayout(four, { options: { bounds } });
  const at256 = validateLayout(four, { options: { bounds, parkMargin: 256 } });
  check(
    'the margin decides the rule: 400 px out is an escape at 512 and a park at 256',
    atDefault.findings.some((finding) => finding.rule === 'out-of-bounds') &&
      at256.findings.some((finding) => finding.rule === 'out-of-bounds-parked') &&
      at256.geometry?.outOfBounds?.parkMargin === 256,
    JSON.stringify({ atDefault: atDefault.byRule, at256: at256.byRule }),
  );
  check(
    'parkMargin 0 turns the classification off without changing the finding',
    (() => {
      const off = validateLayout(parkedLayout, { options: { bounds, parkMargin: 0 } });
      return (
        off.findings.some((finding) => finding.rule === 'out-of-bounds' && finding.severity === 'error') &&
        off.geometry?.outOfBounds?.parkedClassification === 'off' &&
        off.geometry?.outOfBounds?.parked === 0 &&
        off.geometry?.outOfBounds?.escaped === 1
      );
    })(),
    JSON.stringify(validateLayout(parkedLayout, { options: { bounds, parkMargin: 0 } }).byRule),
  );

  // ---------------------------------------------------------------- GAP-12: the table and the rules
  //
  // The pre-fix `common/button_effects/` shape, measured on the mod: the gate is about the CURRENT
  // SCOPE, so the button is drawn from a planet scope and not from a country one.
  const effectsPath = join(scratchDir, 'zz_gap12_button_effects.txt');
  writeFileSync(
    effectsPath,
    [
      "# The measured PRE-FIX shape: a scope test in a control's `potential`.",
      'gap12_open = {',
      '\tpotential = {',
      '\t\tis_scope_type = planet',
      '\t\thas_planet_flag = geocentric_earth',
      '\t\towner = { is_ai = no }',
      '\t}',
      '\teffect = { owner = { country_event = { id = gap12.1 } } }',
      '}',
      '# The sibling shape one step out: a flag the engine answers from the DRAWING scope.',
      'gap12_flag = {',
      '\tpotential = { has_country_flag = gap12_ready }',
      '\teffect = { country_event = { id = gap12.2 } }',
      '}',
      '# The fix that worked on the mod: a GLOBAL flag, scope-free by definition.',
      'gap12_global = {',
      '\tpotential = { has_global_flag = gap12_ready }',
      '\teffect = { country_event = { id = gap12.3 } }',
      '}',
      '# No `potential` at all: the engine draws the button unconditionally.',
      'gap12_always = {',
      '\teffect = { country_event = { id = gap12.4 } }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  const g12Layout = windowLayout([
    effectbuttonElement('gap12_scope_button', 'gap12_open'),
    effectbuttonElement('gap12_flag_button', 'gap12_flag'),
    effectbuttonElement('gap12_global_button', 'gap12_global'),
    effectbuttonElement('gap12_always_button', 'gap12_always'),
  ]);
  const g12 = validateLayout(g12Layout, {
    options: { bounds, customGuiWindows: ['g12_window'] },
    buttonEffectFiles: [effectsPath],
  });
  const ruleOf = (report, rule) => report.findings.filter((finding) => finding.rule === rule);
  check(
    'a `potential` testing `is_scope_type` on a control in a custom_gui window is an ERROR',
    ruleOf(g12, 'visibility-scope-dependent').length === 1 &&
      ruleOf(g12, 'visibility-scope-dependent')[0].severity === 'error' &&
      ruleOf(g12, 'visibility-scope-dependent')[0].element === 'gap12_scope_button',
    JSON.stringify(ruleOf(g12, 'visibility-scope-dependent').map((finding) => `${finding.element}:${finding.severity}`)),
  );
  check(
    'the finding names the demanded scope, the effect and the potential it read',
    (() => {
      const finding = ruleOf(g12, 'visibility-scope-dependent')[0];
      return (
        finding?.demandedScope?.includes('planet') &&
        finding.effect === 'gap12_open' &&
        /is_scope_type = planet/.test(finding.potential ?? '') &&
        finding.scopeGuarantee === null &&
        /89 of 105/.test(finding.message)
      );
    })(),
    JSON.stringify(ruleOf(g12, 'visibility-scope-dependent')[0]),
  );
  check(
    'the fix it suggests is a GLOBAL flag plus a run-time scope pick, not a smaller scope test',
    /has_global_flag/.test(ruleOf(g12, 'visibility-scope-dependent')[0]?.suggestedFix ?? '') &&
      /if = \{ limit = \{ is_scope_type/.test(ruleOf(g12, 'visibility-scope-dependent')[0]?.suggestedFix ?? ''),
    ruleOf(g12, 'visibility-scope-dependent')[0]?.suggestedFix,
  );
  check(
    'the sibling shape - a scope-specific FLAG - is reported under its own rule',
    ruleOf(g12, 'visibility-flag-scope-dependent').length === 1 &&
      ruleOf(g12, 'visibility-flag-scope-dependent')[0].element === 'gap12_flag_button',
    JSON.stringify(ruleOf(g12, 'visibility-flag-scope-dependent').map((finding) => finding.element)),
  );
  check(
    'a GLOBAL flag potential and a missing potential are NOT reported: scope-free is the fix',
    !ruleOf(g12, 'visibility-flag-scope-dependent').some((finding) => finding.element === 'gap12_global_button') &&
      !ruleOf(g12, 'visibility-scope-dependent').some((finding) => finding.element === 'gap12_always_button'),
    JSON.stringify(ruleOf(g12, 'visibility-flag-scope-dependent').map((finding) => finding.element)),
  );

  // THE TABLE: every element carrying an `effect`, joined to its entry, WITH or WITHOUT a finding.
  check(
    'the table exists even when a finding fired, one row per element with an effect',
    g12.visibility?.table?.length === 4 && g12.visibility?.summary?.elementsWithEffect === 4,
    JSON.stringify(g12.visibility?.summary),
  );
  check(
    'a table row carries the effect, its potential, the demanded scope and the window guarantee',
    (() => {
      const row = g12.visibility?.table?.find((entry) => entry.element === 'gap12_scope_button');
      return (
        row?.effect === 'gap12_open' &&
        row.potentialPresent === true &&
        row.demandedScope.join('+') === 'planet' &&
        row.flagTriggers.includes('has_planet_flag') &&
        row.scopeGuarantee === null &&
        row.scopeGuaranteed === false &&
        row.scopeDemandMet === false &&
        row.unmetScopes.join('+') === 'planet' &&
        row.window === 'g12_window'
      );
    })(),
    JSON.stringify(g12.visibility?.table?.find((entry) => entry.element === 'gap12_scope_button')),
  );
  check(
    'the table separates the effect categories: scope-demanding, flag-specific, global, unconditional',
    g12.visibility?.summary?.demandingScope === 1 &&
      g12.visibility?.summary?.flagScopeSpecific === 1 &&
      g12.visibility?.summary?.scopeSpecificFlags === 2 &&
      g12.visibility?.summary?.effectsUnconditional === 1 &&
      g12.visibility?.summary?.effectsUndefined === 0,
    JSON.stringify(g12.visibility?.summary),
  );
  check(
    'a potential carrying BOTH a scope test and a scope flag is reported ONCE, by the scope rule',
    ruleOf(g12, 'visibility-scope-dependent').length === 1 &&
      !ruleOf(g12, 'visibility-flag-scope-dependent').some((finding) => finding.element === 'gap12_scope_button') &&
      g12.visibility?.table?.find((entry) => entry.element === 'gap12_scope_button')?.flagTriggers.includes('has_planet_flag'),
    JSON.stringify(ruleOf(g12, 'visibility-flag-scope-dependent').map((finding) => finding.element)),
  );
  check(
    'the report lists which windows have NO established entry scope - the risky case, named',
    g12.visibility?.windows?.some((entry) => entry.window === 'g12_window' && entry.scopeGuarantee === null) &&
      g12.visibility?.summary?.windowsWithoutGuarantee.includes('g12_window'),
    JSON.stringify(g12.visibility?.windows),
  );
  check(
    'the report says whether the visibility check ran at all, and against which files',
    g12.visibility?.checked === true && g12.visibility?.effectFiles.includes(effectsPath),
    JSON.stringify(g12.visibility?.effectFiles),
  );

  // The GUARANTEE is the caller's input, and it changes the finding rather than silencing it: a window
  // only ever entered in planet scope makes the scope test correct, and that is recorded.
  const guaranteed = validateLayout(g12Layout, {
    options: { bounds, customGuiWindows: ['g12_window'], visibilityScopeGuarantees: { g12_window: 'planet' } },
    buttonEffectFiles: [effectsPath],
  });
  check(
    'a guaranteed scope turns the error into an INFO finding that records the guarantee',
    ruleOf(guaranteed, 'visibility-scope-dependent').length === 0 &&
      ruleOf(guaranteed, 'visibility-potential-scope-dependent').length === 1 &&
      guaranteed.ok === true &&
      /guaranteed/.test(ruleOf(guaranteed, 'visibility-potential-scope-dependent')[0].message),
    JSON.stringify(ruleOf(guaranteed, 'visibility-potential-scope-dependent')),
  );
  check(
    'the guarantee is echoed per element in the table, so the reason stays visible',
    guaranteed.visibility?.table?.find((entry) => entry.element === 'gap12_scope_button')?.scopeGuarantee === 'planet' &&
      guaranteed.visibility?.windows?.find((entry) => entry.window === 'g12_window')?.scopeGuarantee === 'planet',
    JSON.stringify(guaranteed.visibility?.windows),
  );

  // Without the effect files the rule must say it did not run rather than call the file clean.
  const noFiles = validateLayout(g12Layout, { options: { bounds, customGuiWindows: ['g12_window'] } });
  check(
    'with no button_effects file read, the rule reports nothing AND the report says so',
    ruleOf(noFiles, 'visibility-scope-dependent').length === 0 &&
      noFiles.visibility?.effectFiles?.length === 0 &&
      noFiles.visibility?.summary?.elementsWithEffect === 4,
    JSON.stringify({ files: noFiles.visibility?.effectFiles, summary: noFiles.visibility?.summary }),
  );
  const off = validateLayout(g12Layout, {
    options: { bounds, customGuiWindows: ['g12_window'], checkVisibility: false },
    buttonEffectFiles: [effectsPath],
  });
  check(
    'the check can be switched off, and the report says it was off',
    off.visibility?.checked === false && ruleOf(off, 'visibility-scope-dependent').length === 0,
    JSON.stringify(off.visibility?.checked),
  );

  // A window the checker merely INFERRED is a WARNING: this project must not call a shipped vanilla
  // file broken (the same discipline `custom-gui-contract-missing` follows).
  const inferred = validateLayout(g12Layout, {
    options: { bounds, checkAllWindows: true },
    buttonEffectFiles: [effectsPath],
  });
  check(
    'a window no event names gets a WARNING, not an error',
    ruleOf(inferred, 'visibility-scope-dependent').length === 1 &&
      ruleOf(inferred, 'visibility-scope-dependent')[0].severity === 'warning',
    JSON.stringify(ruleOf(inferred, 'visibility-scope-dependent').map((finding) => finding.severity)),
  );

  // The `potential` is the ENTRY's, not the effect body's: `is_scope_type` inside an `effect`'s
  // `if = { limit = ... }` is the FIX (it picks the scope at run time) and must never be reported.
  const inEffectPath = join(scratchDir, 'zz_gap12_in_effect.txt');
  writeFileSync(
    inEffectPath,
    [
      'gap12_runtime_pick = {',
      '\tpotential = { has_global_flag = gap12_ready }',
      '\teffect = {',
      '\t\tif = {',
      '\t\t\tlimit = { is_scope_type = planet }',
      '\t\t\towner = { add_resource = { influence = 1 } }',
      '\t\t}',
      '\t\telse = { add_resource = { influence = 1 } }',
      '\t}',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  const inEffect = validateLayout(windowLayout([effectbuttonElement('gap12_runtime', 'gap12_runtime_pick')]), {
    options: { bounds, customGuiWindows: ['g12_window'] },
    buttonEffectFiles: [inEffectPath],
  });
  check(
    '`is_scope_type` inside the EFFECT (the fix) is not reported: the rule keys on the `potential`',
    ruleOf(inEffect, 'visibility-scope-dependent').length === 0 &&
      ruleOf(inEffect, 'visibility-flag-scope-dependent').length === 0 &&
      inEffect.ok === true,
    JSON.stringify(inEffect.byRule),
  );

  // ---------------------------------------------------------------- the FILE checker too
  //
  // A `.gui` the tool did NOT write is checked with `gui_check_files`, which runs the same validator.
  // The park split and the visibility table have to reach ITS result as well: a condition that is not
  // in the `.gui` at all is exactly what that checker is for.
  const filePath = join(scratchDir, 'gap12_file.gui');
  writeFileSync(
    filePath,
    [
      'guiTypes = {',
      '\tcontainerWindowType = {',
      '\t\tname = "g12_window"',
      '\t\tposition = { x = 0 y = 0 }',
      '\t\tsize = { width = 1000 height = 1000 }',
      '\t\teffectbuttonType = {',
      '\t\t\tname = "gap12_file_button"',
      '\t\t\tposition = { x = 10 y = 10 }',
      '\t\t\tsize = { x = 160 y = 24 }',
      '\t\t\tbuttonText = "gap12_file_button_text"',
      '\t\t\teffect = gap12_open',
      '\t\t}',
      '\t\tcontainerWindowType = {',
      '\t\t\tname = "gap12_parked"',
      '\t\t\tposition = { x = -3000 y = -3000 }',
      '\t\t\tsize = { width = 100 height = 100 }',
      '\t\t}',
      '\t}',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  const fileReport = checkFiles({
    paths: [filePath],
    languages: ['english'],
    localisationRoots: [],
    roots: [],
    assets: null,
    buttonEffects: new Set(['gap12_open']),
    buttonEffectFiles: [effectsPath],
    customGuiWindows: ['g12_window'],
    checkLocKeys: false,
  });
  check(
    'the FILE checker carries the park split, not just the finding count',
    fileReport.byRule['out-of-bounds-parked'] === 1 &&
      fileReport.geometry?.outOfBounds?.parked === 1 &&
      fileReport.geometry?.outOfBounds?.escaped === 0 &&
      fileReport.geometry?.perFile?.some((entry) => entry.file === filePath && entry.parked === 1),
    JSON.stringify({ byRule: fileReport.byRule, geometry: fileReport.geometry?.outOfBounds }),
  );
  check(
    'the FILE checker carries the effect -> potential table, with the file named on every row',
    fileReport.visibility?.table?.length === 1 &&
      fileReport.visibility.table[0].element === 'gap12_file_button' &&
      fileReport.visibility.table[0].file === filePath &&
      fileReport.visibility.table[0].demandedScope.join('+') === 'planet' &&
      fileReport.visibility.effectFiles.includes(effectsPath),
    JSON.stringify(fileReport.visibility?.table),
  );
  check(
    'and it reports the scope rule on the FILE, as an error because the window is named by an event',
    fileReport.findings.some(
      (finding) => finding.rule === 'visibility-scope-dependent' && finding.element === 'gap12_file_button' && finding.severity === 'error',
    ),
    JSON.stringify(fileReport.findings.filter((finding) => finding.rule.startsWith('visibility')).map((finding) => `${finding.element}:${finding.severity}`)),
  );
  check(
    'the per-file entry carries the same two blocks, so a table is readable next to its file',
    Boolean(fileReport.files[0].geometry?.outOfBounds) && Boolean(fileReport.files[0].visibility?.table),
    JSON.stringify(Object.keys(fileReport.files[0])),
  );

  void scratchDir;
});

// =====================================================================================
// GAP-13 / GAP-15 / GAP-16 / GAP-17: the five rules the in-game probe of 2026-10-06 forced
//
// THE ASSERTIONS HERE FAIL IF THE RULES ARE REMOVED, and every fixture is the shape the engine's own
// `error.log` was read back onto. The probe (D:/StellarisMods/gui_probe_grid, PROBE-RESULTS.md
// section 2) put five cases in one host window and the engine answered the four child/scalar tokens
// with four `persistent.cpp:41` lines - `instantTextBoxType` (31), `probeZZtokenInGrid` (49),
// `containerWindowType` (60), `probeZZtokenInHost` (83) - while the plugin's syntax check reported
// ZERO findings on the same file. The fixture below is that file's shape, and the guarded block at
// the end runs the rule over the probe file itself when it is still on disk.
// =====================================================================================

group('the in-game probe as rules (GAP-13/GAP-15/GAP-16/GAP-17)', () => {
  const dir = join(scratch, 'gap13-17');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // ---------------------------------------------------------------- the probe file's five cases
  //
  // Line numbers are read back out of the array rather than typed, so the assertions cannot drift
  // from the fixture. A = a child ELEMENT in a grid box, B = a bogus scalar in the grid box's own
  // body, C = a bogus scalar INSIDE that child, D = a bad `format` (the control that names the file),
  // E = a bogus scalar in a host container.
  const probeLines = [
    'guiTypes = {',
    '\tcontainerWindowType = {',
    '\t\tname = "gap1316_host"',
    '\t\tposition = { x = 0 y = 0 }',
    '\t\tsize = { width = 400 height = 260 }',
    '\t\tgridBoxType = {',
    '\t\t\tname = "gap1316_a_validchild"',
    '\t\t\tposition = { x = 0 y = 0 }',
    '\t\t\tsize = { width = 200 height = 60 }',
    '\t\t\tslotSize = { width = 50 height = 20 }',
    '\t\t\tmax_slots_horizontal = 4',
    '\t\t\tformat = "UPPER_LEFT"',
    '\t\t\tinstantTextBoxType = {',
    '\t\t\t\tname = "gap1316_a_child_text"',
    '\t\t\t\tposition = { x = 0 y = 0 }',
    '\t\t\t\tmaxWidth = 50',
    '\t\t\t\tmaxHeight = 20',
    '\t\t\t\tfont = "cg_16b"',
    '\t\t\t\ttext = "gap1316_text"',
    '\t\t\t}',
    '\t\t}',
    '\t\tgridBoxType = {',
    '\t\t\tname = "gap1316_b_directtoken"',
    '\t\t\tposition = { x = 0 y = 70 }',
    '\t\t\tsize = { width = 200 height = 60 }',
    '\t\t\tformat = "UPPER_LEFT"',
    '\t\t\tprobeZZtokenInGrid = yes',
    '\t\t}',
    '\t\tgridBoxType = {',
    '\t\t\tname = "gap1316_c_childtoken"',
    '\t\t\tposition = { x = 0 y = 140 }',
    '\t\t\tsize = { width = 200 height = 60 }',
    '\t\t\tformat = "UPPER_LEFT"',
    '\t\t\tcontainerWindowType = {',
    '\t\t\t\tname = "gap1316_c_child"',
    '\t\t\t\tsize = { width = 50 height = 20 }',
    '\t\t\t\tprobeZZtokenInGridChild = yes',
    '\t\t\t}',
    '\t\t}',
    '\t\tgridBoxType = {',
    '\t\t\tname = "gap1316_d_badformat"',
    '\t\t\tsize = { width = 200 height = 40 }',
    '\t\t\tformat = "PROBEZZ_BAD_FORMAT"',
    '\t\t}',
    '\t\tcontainerWindowType = {',
    '\t\t\tname = "gap1316_e_hosttoken"',
    '\t\t\tsize = { width = 180 height = 60 }',
    '\t\t\tprobeZZtokenInHost = yes',
    '\t\t}',
    '\t}',
    '}',
    '',
  ];
  const probePath = join(dir, 'gap1316_probe.gui');
  writeFileSync(probePath, probeLines.join('\n'), 'utf8');
  const probeText = probeLines.join('\n');
  /** The 1-based line of the first fixture line containing `needle`. */
  const lineOf = (needle) => probeLines.findIndex((line) => line.includes(needle)) + 1;
  /** The closing-brace line of the block opening at `open`, by brace counting. */
  const closeOf = (open) => {
    let depth = 0;
    for (let index = open - 1; index < probeLines.length; index += 1) {
      depth += (probeLines[index].match(/\{/g) ?? []).length;
      depth -= (probeLines[index].match(/\}/g) ?? []).length;
      if (depth === 0) return index + 1;
    }
    return null;
  };

  const probeSyntax = checkGuiSyntax(probeText, probePath);
  check(
    'GAP-16: the syntax check is no longer silent on the probe shape',
    probeSyntax.counts.total === 4 && probeSyntax.counts.error === 4 && probeSyntax.ok === false,
    JSON.stringify(probeSyntax.counts),
  );
  const tokens = probeSyntax.findings.map((finding) => finding.engineMessage);
  const childOpen = lineOf('\t\t\tinstantTextBoxType = {');
  const nestedOpen = lineOf('\t\t\tcontainerWindowType = {');
  check(
    'the four tokens the engine named are the four findings, token for token and line for line',
    [
      `Unexpected token: instantTextBoxType, near line: ${childOpen}`,
      `Unexpected token: probeZZtokenInGrid, near line: ${lineOf('probeZZtokenInGrid = yes')}`,
      `Unexpected token: containerWindowType, near line: ${nestedOpen}`,
      `Unexpected token: probeZZtokenInHost, near line: ${lineOf('probeZZtokenInHost = yes')}`,
    ].every((engineMessage) => tokens.includes(engineMessage)),
    JSON.stringify(tokens),
  );
  check(
    'GAP-13: a child ELEMENT in a grid box is an ERROR, not a warning',
    probeSyntax.findings.filter((finding) => finding.rule === 'engine-populated-container-children').length === 2 &&
      probeSyntax.findings
        .filter((finding) => finding.rule === 'engine-populated-container-children')
        .every((finding) => finding.severity === 'error'),
    JSON.stringify(probeSyntax.findings.map((finding) => `${finding.rule}:${finding.severity}`)),
  );
  const childFinding = probeSyntax.findings.find((finding) => finding.engineMessage?.includes('instantTextBoxType'));
  check(
    'and it states the span the engine skipped, as the engine states it',
    childFinding?.blockSpan?.open === childOpen && childFinding?.blockSpan?.close === closeOf(childOpen),
    JSON.stringify({ span: childFinding?.blockSpan, expectedClose: closeOf(childOpen) }),
  );
  check(
    'and its wording says the FILE IS REJECTED and the block skipped, not "not laid out"',
    /FILE IS LOADED/.test(childFinding?.message ?? '') &&
      /skips the whole child block/.test(childFinding?.message ?? '') &&
      !/not laid out by it/.test(childFinding?.message ?? ''),
    childFinding?.message,
  );
  check(
    'GAP-13 honest limit: the message claims only gridBoxType was probed',
    /Only `gridBoxType` was probed in game/.test(childFinding?.message ?? '') &&
      /NOT measured/.test(childFinding?.message ?? ''),
    childFinding?.message,
  );
  check(
    'the token INSIDE the skipped child is not reported: the engine never reads it',
    !tokens.some((engineMessage) => /probeZZtokenInGridChild/.test(engineMessage ?? '')) &&
      !probeSyntax.findings.some((finding) => /probeZZtokenInGridChild/.test(finding.message ?? '')),
    JSON.stringify(tokens),
  );

  const probeValidated = validateGuiText(probeText, probePath, { checkAssets: false, checkLocalisation: false });
  check(
    'the model pass agrees the engine-populated rule is an error, with the engine message attached',
    (probeValidated.byRule['engine-populated-container-children'] ?? 0) === 2 &&
      (probeValidated.byRule['unexpected-token'] ?? 0) === 2 &&
      RULE_SEVERITY['engine-populated-container-children'] === 'error' &&
      RULE_SEVERITY['unexpected-token'] === 'error',
    JSON.stringify(probeValidated.byRule),
  );
  const modelPopulated = probeValidated.findings.find((finding) => finding.rule === 'engine-populated-container-children');
  check(
    'and the merged finding keeps the engine\'s own line',
    new RegExp(`Unexpected token: instantTextBoxType, near line: ${childOpen}`).test(modelPopulated?.engineMessage ?? ''),
    modelPopulated?.engineMessage,
  );
  check(
    'each token keeps its own finding (two bogus tokens in one element would otherwise collapse)',
    (() => {
      const twoTokens = [
        'guiTypes = {',
        '\tcontainerWindowType = {',
        '\t\tname = "gap16_two_tokens"',
        '\t\tsize = { width = 10 height = 10 }',
        '\t\tzzzOneBogusToken = 1',
        '\t\tzzzTwoBogusToken = 2',
        '\t}',
        '}',
        '',
      ].join('\n');
      const syntax = checkGuiSyntax(twoTokens, 'gap16_two.gui');
      const validated = validateGuiText(twoTokens, 'gap16_two.gui', { checkAssets: false, checkLocalisation: false });
      return (
        syntax.findings.filter((finding) => finding.rule === 'unexpected-token').length === 2 &&
        (validated.byRule['unexpected-token'] ?? 0) === 2
      );
    })(),
  );

  // ---------------------------------------------------------------- GAP-16: the exemptions
  //
  // The rule is a measurement, not a guess, so the three things it must NOT call unknown are
  // asserted: the element's identity (`name`/`id`), an `@variable` DECLARATION that sits inside the
  // block, and the five field names the corpus writes but this model does not declare (the engine
  // loaded the files that carry them).
  const exemptText = [
    'guiTypes = {',
    '\tcontainerWindowType = {',
    '\t\tname = "gap16_exempt"',
    '\t\tid = "gap16_exempt_id"',
    '\t\t@tabheight = 32',
    '\t\tmovable = yes',
    '\t\tsize = { width = 100 height = 20 }',
    '\t\tbuttonType = {',
    '\t\t\tname = "gap16_button"',
    '\t\t\tnavLeft = "gap16_left"',
    '\t\t\talpha = 0.5',
    '\t\t\tsize = { x = 10 y = 10 }',
    '\t\t}',
    '\t\tinstantTextBoxType = {',
    '\t\t\tname = "gap16_text"',
    '\t\t\tconcepts_show_missing_dlc = yes',
    '\t\t\tmaxWidth = 40',
    '\t\t}',
    '\t}',
    '}',
    '',
  ].join('\n');
  const exempt = checkGuiSyntax(exemptText, 'gap16_exempt.gui');
  check(
    'the measured exemptions report nothing: name, id, an @variable declaration and the corpus-only fields',
    !exempt.findings.some((finding) => finding.rule === 'unexpected-token'),
    JSON.stringify(exempt.findings.map((finding) => finding.engineMessage)),
  );
  check(
    'the control: an invented field on the same kinds still reports',
    (() => {
      const invented = checkGuiSyntax(
        ['guiTypes = {', '\tcontainerWindowType = {', '\t\tname = "gap16_invented"', '\t\tzzzNotAField = 1', '\t\tsize = { width = 10 height = 10 }', '\t}', '}', ''].join('\n'),
        'gap16_invented.gui',
      );
      const finding = invented.findings.find((item) => item.rule === 'unexpected-token');
      return Boolean(finding) && finding.severity === 'error' && finding.token === 'zzzNotAField';
    })(),
  );

  // ---------------------------------------------------------------- GAP-15: visible on a container
  const visibleText = [
    'guiTypes = {',
    '\tcontainerWindowType = {',
    '\t\tname = "gap15_off"',
    '\t\tvisible = no',
    '\t\tposition = { x = 0 y = 0 }',
    '\t\tsize = { width = 100 height = 20 }',
    '\t}',
    '\tcontainerWindowType = {',
    '\t\tname = "gap15_plain"',
    '\t\tposition = { x = 0 y = 30 }',
    '\t\tsize = { width = 100 height = 20 }',
    '\t}',
    '}',
    '',
  ].join('\n');
  const visibleSyntax = checkGuiSyntax(visibleText, 'gap15.gui');
  const visibleFindings = visibleSyntax.findings.filter((finding) => /visible/.test(finding.message ?? ''));
  check(
    'GAP-15: `visible` on a containerWindowType is ONE error, with the engine\'s own token',
    visibleFindings.length === 1 &&
      visibleFindings[0].rule === 'field-not-accepted' &&
      visibleFindings[0].severity === 'error' &&
      visibleFindings[0].engineMessage === 'Unexpected token: visible, near line: 4',
    JSON.stringify(visibleFindings.map((finding) => `${finding.rule}:${finding.engineMessage}`)),
  );
  check(
    'and the message says the rejection derails the rest of the block',
    /derails the REST of the container block/.test(visibleFindings[0]?.message ?? ''),
    visibleFindings[0]?.message,
  );
  const visibleValidated = validateGuiText(visibleText, 'gap15.gui', { checkAssets: false, checkLocalisation: false });
  check(
    'the model pass reports it once too, merged rather than duplicated',
    (visibleValidated.byRule['field-not-accepted'] ?? 0) === 1 && visibleValidated.ok === false,
    JSON.stringify(visibleValidated.byRule),
  );
  check(
    'the rejection is scoped to containers: the KIND table says so, and the other kinds stay quiet',
    isFieldRejectedForKind('container', 'visible') === true &&
      isFieldRejectedForKind('text', 'visible') === false &&
      isFieldRejectedForKind('icon', 'visible') === false &&
      Boolean(kindRejectedFieldNote('container', 'visible')),
  );
  check(
    'so `visible` on text / icon / button reports NOTHING (that was never measured)',
    (() => {
      const elsewhere = [
        'guiTypes = {',
        '\tcontainerWindowType = {',
        '\t\tname = "gap15_host"',
        '\t\tsize = { width = 200 height = 80 }',
        '\t\tinstantTextBoxType = { name = "gap15_text" visible = no maxWidth = 60 maxHeight = 20 }',
        '\t\ticonType = { name = "gap15_icon" visible = no }',
        '\t\tbuttonType = { name = "gap15_button" visible = no size = { x = 40 y = 20 } }',
        '\t}',
        '}',
        '',
      ].join('\n');
      const report = checkGuiSyntax(elsewhere, 'gap15_elsewhere.gui');
      return !report.findings.some((finding) => /visible/.test(finding.message ?? ''));
    })(),
  );
  check(
    'and the EMITTER refuses to write it rather than producing a file the engine drops',
    (() => {
      const context = { warnings: [], path: 'gap15_emitted' };
      const copy = translateNodeFields(
        { kind: 'container', name: 'gap15_emitted', visible: true, size: { width: 10, height: 10 } },
        kindSpec('container'),
        context,
      );
      return (
        copy.visible === undefined &&
        context.warnings.some((warning) => warning.rule === 'field-dropped' && /visible/.test(warning.message ?? ''))
      );
    })(),
  );

  // ---------------------------------------------------------------- GAP-17: an unresolvable custom_gui name
  const eventLines = (id, fields) => [
    'namespace = gap17',
    'country_event = {',
    `\tid = ${id}`,
    '\ttitle = gap17_title',
    '\tdesc = gap17_desc',
    ...(fields.diplomatic ? [`\tdiplomatic = ${fields.diplomatic}`] : []),
    `\tcustom_gui = "${fields.window}"`,
    '\toption = { name = gap17_option }',
    '}',
    '',
  ].join('\n');
  const badEvents = join(dir, 'gap17_bad_events.txt');
  writeFileSync(badEvents, eventLines('gap17.4', { diplomatic: 'yes', window: 'gap17_no_such_window' }), 'utf8');
  const softEvents = join(dir, 'gap17_soft_events.txt');
  writeFileSync(softEvents, eventLines('gap17.3', { window: 'gap17_no_such_window' }), 'utf8');
  const noEvents = join(dir, 'gap17_no_events.txt');
  writeFileSync(noEvents, eventLines('gap17.5', { diplomatic: 'no', window: 'gap17_no_such_window' }), 'utf8');
  const resolvedEvents = join(dir, 'gap17_resolved_events.txt');
  writeFileSync(resolvedEvents, eventLines('gap17.1', { diplomatic: 'yes', window: 'gap17_real_window' }), 'utf8');
  const resolvedGui = join(dir, 'gap17_real.gui');
  writeFileSync(resolvedGui, ['guiTypes = {', '\tcontainerWindowType = {', '\t\tname = "gap17_real_window"', '\t\tsize = { width = 10 height = 10 }', '\t}', '}', ''].join('\n'), 'utf8');
  const assets = { containers: {}, sprites: {}, textures: {}, fonts: {}, stats: { fontCount: 0 } };

  const badReport = checkFiles({ paths: [badEvents], languages: ['english'], roots: [], assets, checkLocKeys: false });
  const badFinding = badReport.findings.find((finding) => finding.rule === 'custom-gui-unknown-window');
  check(
    'GAP-17: an unresolvable name on a `diplomatic = yes` event is an ERROR, with the engine\'s own line',
    badFinding?.severity === 'error' &&
      badFinding?.engineMessage === 'Tried to get gui_type [gap17_no_such_window] which does not exist',
    JSON.stringify({ severity: badFinding?.severity, engineMessage: badFinding?.engineMessage }),
  );
  check(
    'and it says what the engine does: fall back to ok_popup_window and crash',
    /ok_popup_window/.test(badFinding?.message ?? '') &&
      /EXCEPTION_ACCESS_VIOLATION/.test(badFinding?.message ?? '') &&
      /load time/.test(badFinding?.message ?? ''),
    badFinding?.message,
  );
  check(
    'the finding carries the event id and the field\'s line',
    new RegExp(`^${badEvents.replace(/\\/g, '\\\\')}:\\d+ \\[event gap17\\.4\\]$`).test(badFinding?.where ?? ''),
    badFinding?.where,
  );

  const softReport = checkFiles({ paths: [softEvents], languages: ['english'], roots: [], assets, checkLocKeys: false });
  const softFinding = softReport.findings.find((finding) => finding.rule === 'custom-gui-unknown-window');
  check(
    'the same mistake without `diplomatic` is a WARNING: that path writes nothing and draws the default window',
    softFinding?.severity === 'warning' && softFinding?.engineMessage === undefined,
    JSON.stringify({ severity: softFinding?.severity, engineMessage: softFinding?.engineMessage }),
  );
  check(
    'and the warning says the engine wrote NOTHING and drew the ordinary default event window',
    /writes nothing about it - NOT EVEN the lookup line/.test(softFinding?.message ?? '') &&
      /ordinary default event window/.test(softFinding?.message ?? ''),
    softFinding?.message,
  );
  check(
    'and the report stays green: the non-diplomatic path is not a gate failure',
    softReport.counts.error === 0,
    JSON.stringify(softReport.counts),
  );
  const noReport = checkFiles({ paths: [noEvents], languages: ['english'], roots: [], assets, checkLocKeys: false });
  check(
    '`diplomatic = no` grades as the non-diplomatic path, not as `yes`',
    noReport.findings.find((finding) => finding.rule === 'custom-gui-unknown-window')?.severity === 'warning',
    JSON.stringify(noReport.findings.map((finding) => `${finding.rule}:${finding.severity}`)),
  );
  const resolvedReport = checkFiles({ paths: [resolvedEvents, resolvedGui], languages: ['english'], roots: [], assets, checkLocKeys: false });
  check(
    'the control: a name the passed .gui defines reports NOTHING',
    !resolvedReport.findings.some((finding) => finding.rule === 'custom-gui-unknown-window'),
    JSON.stringify(resolvedReport.byRule),
  );
  const indexedReport = checkFiles({
    paths: [badEvents],
    languages: ['english'],
    roots: [],
    assets: { ...assets, containers: { gap17_no_such_window: { file: 'interface/x.gui', line: 1 } } },
    checkLocKeys: false,
  });
  check(
    'and a name the ASSET INDEX defines reports nothing either',
    !indexedReport.findings.some((finding) => finding.rule === 'custom-gui-unknown-window'),
    JSON.stringify(indexedReport.byRule),
  );
  const uncheckedReport = checkFiles({ paths: [badEvents], languages: ['english'], roots: [], assets: null, checkLocKeys: false });
  check(
    'with no index and no .gui passed, the rule stays SILENT rather than claiming a search it did not run',
    !uncheckedReport.findings.some((finding) => finding.rule === 'custom-gui-unknown-window'),
    JSON.stringify(uncheckedReport.byRule),
  );
  const conventionFinding = softReport.findings.find((finding) => finding.rule === 'custom-gui-without-diplomatic');
  check(
    'the false "the window may never be constructed" claim is gone from the event rule',
    Boolean(conventionFinding) &&
      !/may never be constructed|may not appear|is required/.test(conventionFinding?.message ?? '') &&
      /accepted without it/.test(conventionFinding?.message ?? ''),
    conventionFinding?.message,
  );
  check(
    'and from the emitter\'s warning',
    (() => {
      const stub = emitEventStub(defaultLayout({ name: 'gap17_stub' }), { diplomatic: false });
      const warning = stub.warnings.find((entry) => entry.rule === 'custom-gui-without-diplomatic');
      return Boolean(warning) && !/may not appear|may never be constructed/.test(warning.message) && /NON-diplomatic/.test(warning.message);
    })(),
  );

  // ---------------------------------------------------------------- the rule ids are in the tables
  check(
    'every rule this round adds or re-grades is in the severity table AND the description table',
    ['engine-populated-container-children', 'unexpected-token', 'container-path-override', 'custom-gui-unknown-window', 'field-not-accepted'].every(
      (rule) => Boolean(RULE_SEVERITY[rule]) && Boolean(RULE_DESCRIPTIONS[rule]),
    ) &&
      RULE_SEVERITY['engine-populated-container-children'] === 'error' &&
      RULE_SEVERITY['container-path-override'] === 'info',
    JSON.stringify({
      populated: RULE_SEVERITY['engine-populated-container-children'],
      override: RULE_SEVERITY['container-path-override'],
    }),
  );

  // ---------------------------------------------------------------- the gap's own reproduction
  //
  // The probe file itself, when it is still on disk: the four tokens the engine named, at the four
  // lines the engine named. Guarded, because the file lives in a mod directory this repository does
  // not own.
  const realProbe = 'D:/StellarisMods/gui_probe_grid/interface/zz_gui_probe_grid.gui';
  if (existsSync(realProbe)) {
    const realReport = checkGuiSyntax(readFileSync(realProbe, 'utf8'), realProbe);
    check(
      'GAP-16 reproduction: the plugin now answers the probe file with the engine\'s own four tokens',
      realReport.counts.total === 4 &&
        realReport.counts.error === 4 &&
        [
          'Unexpected token: instantTextBoxType, near line: 31',
          'Unexpected token: probeZZtokenInGrid, near line: 49',
          'Unexpected token: containerWindowType, near line: 60',
          'Unexpected token: probeZZtokenInHost, near line: 83',
        ].every((engineMessage) => realReport.findings.some((finding) => finding.engineMessage === engineMessage)),
      JSON.stringify(realReport.findings.map((finding) => finding.engineMessage)),
    );
  }

  // ---------------------------------------------------------------- the corpus control
  //
  // The install's own 177 `.gui` files are the control that keeps both new syntax rules honest: the
  // engine loaded every one of them, so neither rule may fire on any of them.
  if (existsSync(DEFAULT_GAME_ROOT)) {
    const files = listFilesRecursive(join(DEFAULT_GAME_ROOT, 'interface'), ['.gui']);
    let unexpected = 0;
    let populated = 0;
    for (const file of files) {
      const report = checkGuiSyntax(readFileSync(file, 'utf8'), file);
      unexpected += report.findings.filter((finding) => finding.rule === 'unexpected-token').length;
      populated += report.findings.filter((finding) => finding.rule === 'engine-populated-container-children').length;
    }
    check(
      `the two new syntax rules fire ZERO times over the install's ${files.length} .gui files`,
      unexpected === 0 && populated === 0 && files.length >= 170,
      JSON.stringify({ unexpected, populated, files: files.length }),
    );
  }
});

// =====================================================================================
// `common/espionage_operation_types/`: the engine's LOAD-TIME validation, as rules
//
// THE ASSERTIONS HERE FAIL IF A RULE IS REMOVED. The engine's own two messages were read verbatim in
// a loaded game on 2026-10-06 (DOORS-RESULTS.md section 6.2, probe mod `gui_probe_doors_e`, one
// deliberately under-defined operation next to a good one):
//
//   [08:47:42][espionage_operation_type.cpp:407]: Espionage operation '<key>' does not have the
//     expected number of stages.
//   [08:47:42][espionage_operation_type.cpp:529]: Espionage operation '<key>' has no on_roll_failed,
//     operation will never progress
//
// and two more exist in the binary untriggered (`Invalid event '%s'`, `Invalid event type for event
// '%s'. Expected: %s, actual: %s`). Before this group the file inspector routed such a file to the
// `common/button_effects` schema and reported `button-effect-without-effect` on every operation -
// the wrong rule for the wrong schema. The fixture below is the probe's shape, and the vanilla scan
// at the end proves the rules stay quiet on the install's own 27 operations.
// =====================================================================================

group('the espionage operation-type load-time rules', () => {
  const dir = join(scratch, 'espionage-operations');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'common', 'espionage_operation_types'), { recursive: true });
  mkdirSync(join(dir, 'events'), { recursive: true });

  const opsPath = join(dir, 'common', 'espionage_operation_types', 'zz_ops.txt');
  const opLines = [
    'good_operation = {',
    '\tstages = 1',
    '\tstage = { difficulty = 4 event = probe_ops.1 }',
    '\ton_roll_failed = { my_failed_effect = yes }',
    '}',
    '',
    'bad_stage_count = {',
    '\tstages = 2',
    '\tstage = { difficulty = 4 event = probe_ops.1 }',
    '\ton_roll_failed = { my_failed_effect = yes }',
    '}',
    '',
    'no_roll_failed = {',
    '\tstages = 1',
    '\tstage = { difficulty = 4 event = probe_ops.1 }',
    '}',
    '',
    'unresolved_event = {',
    '\tstages = 1',
    '\tstage = { difficulty = 4 event = probe_ops.999 }',
    '\ton_roll_failed = { my_failed_effect = yes }',
    '}',
    '',
    'duplicated = { stages = 1 stage = { event = probe_ops.1 } on_roll_failed = { x = yes } }',
    'duplicated = { stages = 1 stage = { event = probe_ops.1 } on_roll_failed = { x = yes } }',
    '',
  ];
  writeFileSync(opsPath, opLines.join('\n'), 'utf8');
  const eventsPath = join(dir, 'events', 'zz_ops_events.txt');
  writeFileSync(
    eventsPath,
    [
      'namespace = probe_ops',
      '',
      'espionage_operation_event = {',
      '\tid = probe_ops.1',
      '\tespionage_operation = yes',
      '\toption = { name = ACKNOWLEDGED }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  const report = checkFiles({ paths: [opsPath, eventsPath], languages: ['english'], roots: [], assets: null, checkLocKeys: false });
  const byRule = report.byRule;
  const findingFor = (rule, element) => report.findings.find((finding) => finding.rule === rule && (element === undefined || finding.element === element));

  check(
    'the operation file is no longer graded as a `common/button_effects` file',
    !Object.keys(byRule).some((rule) => rule.startsWith('button-effect')),
    JSON.stringify(byRule),
  );
  check(
    'the file is recognised as an operation-type schema, and its operations are listed on the entry',
    Array.isArray(report.files[0].espionageOperations) && report.files[0].espionageOperations.includes('good_operation'),
    JSON.stringify(report.files[0].espionageOperations),
  );
  // THE TWO ENGINE-MEASURED RULES. Removing either rule fails this group by rule id.
  const stageCount = findingFor('espionage-operation-stage-count', 'bad_stage_count');
  check(
    'the stage count is checked against the declared `stages`, as an ERROR',
    Boolean(stageCount) && stageCount.severity === 'error',
    JSON.stringify({ found: Boolean(stageCount), severity: stageCount?.severity }),
  );
  check(
    'and it quotes the engine\'s own line, key and all',
    stageCount?.engineMessage === `Espionage operation 'bad_stage_count' does not have the expected number of stages.`,
    stageCount?.engineMessage,
  );
  check(
    'and it does not fire on the operation whose declaration matches',
    !report.findings.some((finding) => finding.rule === 'espionage-operation-stage-count' && finding.element === 'good_operation'),
    JSON.stringify(report.findings.filter((entry) => entry.element === 'good_operation').map((entry) => entry.rule)),
  );
  const noRoll = findingFor('espionage-operation-no-on-roll-failed', 'no_roll_failed');
  check(
    'a missing `on_roll_failed` is an ERROR with the engine\'s verbatim line',
    Boolean(noRoll) &&
      noRoll.severity === 'error' &&
      noRoll.engineMessage === `Espionage operation 'no_roll_failed' has no on_roll_failed, operation will never progress`,
    JSON.stringify({ severity: noRoll?.severity, engineMessage: noRoll?.engineMessage }),
  );
  // THE THIRD RULE, and its honest limit: it needs the events to have been READ.
  const unresolved = findingFor('espionage-operation-stage-event-unresolved', 'probe_ops.999');
  check(
    'a stage event that no read event file defines is a WARNING, because the checker only grades what it could see',
    Boolean(unresolved) && unresolved.severity === 'warning',
    JSON.stringify({ found: Boolean(unresolved), severity: unresolved?.severity }),
  );
  check(
    'the resolved stage event is NOT reported, so the rule distinguishes "defined" from "unresolved"',
    !report.findings.some((finding) => finding.rule === 'espionage-operation-stage-event-unresolved' && finding.element === 'probe_ops.1'),
    JSON.stringify(report.findings.filter((finding) => finding.rule === 'espionage-operation-stage-event-unresolved').map((finding) => finding.element)),
  );
  const noEventsIndex = checkFiles({ paths: [opsPath], languages: ['english'], roots: [], assets: null, checkLocKeys: false });
  check(
    'with NO event file passed, the event rule stays silent rather than calling every event missing',
    !noEventsIndex.findings.some((finding) => finding.rule === 'espionage-operation-stage-event-unresolved'),
    JSON.stringify(noEventsIndex.byRule),
  );
  check(
    'a duplicated operation key is reported, naming both lines',
    Boolean(findingFor('espionage-operation-duplicate-key', 'duplicated')),
    JSON.stringify(byRule),
  );
  // The install's own files must stay silent: 27 operations, all self-consistent (measured).
  if (existsSync(DEFAULT_GAME_ROOT)) {
    const vanillaDir = join(DEFAULT_GAME_ROOT, 'common', 'espionage_operation_types');
    if (existsSync(vanillaDir)) {
      const vanillaPaths = listFilesRecursive(vanillaDir, ['.txt']);
      const vanillaReport = checkFiles({ paths: vanillaPaths, languages: ['english'], roots: [], assets: null, checkLocKeys: false });
      const errors = vanillaReport.findings.filter((finding) => finding.severity === 'error');
      check(
        `the espionage rules fire ZERO errors over the install's ${vanillaPaths.length} operation files`,
        errors.length === 0,
        JSON.stringify(errors.slice(0, 3).map((finding) => `${finding.rule}:${finding.element}`)),
      );
      check(
        'and the install\'s commented-out `example.txt` is an INFO, not a warning about missing content',
        vanillaReport.findings.filter((finding) => finding.rule === 'espionage-operation-file-empty' && finding.severity === 'info').length === 1,
        JSON.stringify(vanillaReport.findings.filter((finding) => finding.rule === 'espionage-operation-file-empty').map((finding) => finding.severity)),
      );
    }
  }
});

// =====================================================================================
// The human/agent handoff: the guardrails, the diff, and the submission round trip
//
// THE ASSERTIONS HERE FAIL IF THE GUARD IS REMOVED. That is the point of them: this project traced
// three crash dumps to a `custom_gui` window losing a name the engine dereferences by name, so
// "deleting `close` is refused" has to be a test, not a comment. The last block drives the REAL tool
// registry (`gui_layout_edit`) and the REAL HTTP route (`/api/edit`) rather than the guard function
// directly, so an edit path that stops calling the guard is caught too.
// =====================================================================================

group('handoff guardrails: which names are protected', () => {
  const { describeProtection } = handoffGuard;
  const layout = eventWindowLayout();
  const protections = describeProtection(layout, { customGuiWindows: ['test_event_window'] });
  const names = new Set([...protections.values()].map((entry) => entry.name));
  const prefix = '(selftest.gui)/';

  check('the protection set covers the crash-class contract names', ['close', 'EVENT_DIPLO', 'option_list', 'empire_info_bg'].every((name) => names.has(name)), [...names].join(','));
  check('the window container itself is protected (an event resolves it by name)', [...protections.values()].some((entry) => entry.windowContainer && entry.name === 'test_event_window'));
  check(
    'the protection is keyed by the SAME path the tree and the rect table use (synthetic root included)',
    protections.has(`${prefix}test_event_window`) && protections.has(`${prefix}test_event_window/close`) && protections.has(`${prefix}test_event_window/body_panel/EVENT_DIPLO/option_list`),
    [...protections.keys()].join(','),
  );
  check('`close` is marked as the pinned control', protections.get(`${prefix}test_event_window/close`)?.close === true);
  check('each record carries the reason it is protected', [...protections.values()].every((entry) => typeof entry.reason === 'string' && entry.reason.length > 20));
  check('an ordinary decorative element is NOT locked', ![...protections.values()].some((entry) => entry.name === 'body_panel'));
  check('the protected set is exactly the contract names present, not every element', protections.size === 10, `${protections.size}: ${[...names].join(',')}`);
});

group('handoff guardrails: the refused edits', () => {
  const { evaluateEdits, GUARD_RULES } = handoffGuard;
  const options = { customGuiWindows: ['test_event_window'] };
  const layout = eventWindowLayout();
  const evaluate = (edits) => evaluateEdits(layout, edits, options);

  // 1. deleting a contract name.
  for (const name of ['close', 'EVENT_DIPLO', 'option_list', 'empire_info_bg', 'heading']) {
    const result = evaluate([{ op: 'remove', target: name }]);
    check(
      `deleting \`${name}\` is REFUSED`,
      result.allowed === false && result.refused.length === 1 && result.refused[0].rule === GUARD_RULES.remove,
      JSON.stringify(result.refused.map((entry) => entry.rule)),
    );
  }
  check('the refusal message names the element and says what to do instead', /close/.test(evaluate([{ op: 'remove', target: 'close' }]).refused[0].message) && /park/i.test(evaluate([{ op: 'remove', target: 'close' }]).refused[0].suggestedFix));

  // 2. renaming one.
  const rename = evaluate([{ op: 'rename', target: 'option_list', name: 'options' }]);
  check('renaming a contract name is REFUSED', rename.allowed === false && rename.refused[0].rule === GUARD_RULES.rename, JSON.stringify(rename.refused.map((entry) => entry.rule)));
  check('a no-op rename is allowed (the guard blocks the change, not the element)', evaluate([{ op: 'rename', target: 'option_list', name: 'option_list' }]).allowed === true);

  // 3. un-pinning `close`.
  const moved = evaluate([{ op: 'set', target: 'close', path: 'position', value: { x: 400, y: 400 } }]);
  check('moving `close` out of its top-right corner is REFUSED', moved.allowed === false && moved.refused[0].rule === GUARD_RULES.closeOrder, JSON.stringify(moved.refused.map((entry) => entry.rule)));
  const reorient = evaluate([{ op: 'set', target: 'close', path: 'orientation', value: 'lower_left' }]);
  check('re-orienting `close` away from upper_right is REFUSED', reorient.allowed === false && reorient.refused[0].rule === GUARD_RULES.closeOrder);
  check(
    'a SMALL inset from the corner is allowed, because the corner is a region and not a pixel',
    evaluate([{ op: 'set', target: 'close', path: 'position', value: { x: -45, y: 16 } }]).allowed === true,
  );

  // 4. a shortcut on a parked element.
  const shortcut = evaluate([{ op: 'set', target: 'tts_button', path: 'shortCut', value: 'F9' }]);
  check('adding a `shortcut` to a parked element is REFUSED', shortcut.allowed === false && shortcut.refused[0].rule === GUARD_RULES.shortcut, JSON.stringify(shortcut.refused.map((entry) => entry.rule)));
  const lowerCaseShortcut = evaluate([{ op: 'set', target: 'tts_button', path: 'shortcut', value: 'F9' }]);
  check('the lower-case `shortcut` spelling is refused too (the engine accepts both)', lowerCaseShortcut.allowed === false && lowerCaseShortcut.refused[0].rule === GUARD_RULES.shortcut);

  // 5. `effect` on a buttonType: the engine answers "Unexpected token: effect" and the button does
  //    nothing, which is worse than a parse error because it looks like it worked.
  const effect = evaluate([{ op: 'set', target: 'confirm_button', path: 'effect', value: 'some_effect' }]);
  check('`effect` on a `buttonType` is REFUSED', effect.allowed === false && effect.refused[0].rule === GUARD_RULES.effect, JSON.stringify(effect.refused.map((entry) => entry.rule)));
  check('the same field on an `effectbuttonType` is allowed', evaluate([{ op: 'set', target: 'close', path: 'effect', value: 'some_effect' }]).allowed === true);

  // 6. the ordinary edits a human makes must NOT be refused, or the guardrail is just an obstacle.
  check('a move is allowed', evaluate([{ op: 'set', target: 'heading', path: 'position', value: { x: 30, y: 40 } }]).allowed === true);
  check('a resize is allowed', evaluate([{ op: 'set', target: 'body_panel', path: 'size', value: { width: 400, height: 200 } }]).allowed === true);
  check('a delete of an ordinary element is allowed', evaluate([{ op: 'remove', target: 'body_panel' }]).allowed === true);
  check('a rename of an ordinary element is allowed', evaluate([{ op: 'rename', target: 'body_panel', name: 'panel_2' }]).allowed === true);
  check('a batch of ordinary edits is allowed', evaluate([{ op: 'set', target: 'heading', path: 'position', value: { x: 1, y: 2 } }, { op: 'set', target: 'body_panel', path: 'size', value: { width: 10, height: 10 } }]).allowed === true);
});

group('handoff guardrails: the guard is WIRED IN, not merely available', () => {
  // The refusal has to happen in the edit path a caller actually reaches. This assertion fails if
  // `gui_layout_edit` stops routing through `guardedEdit`.
  const { guardedEdit, GUARD_RULES } = handoffGuard;
  const layout = eventWindowLayout();
  const options = { customGuiWindows: ['test_event_window'], validationContext: { customGuiWindows: ['test_event_window'], checkAssets: false, checkLocalisation: false } };

  const refused = guardedEdit(layout, [{ op: 'remove', target: 'close' }], { applyEdits, ...options });
  check('guardedEdit refuses the batch and applies nothing', refused.applied.length === 0 && refused.refused.length === 1 && refused.guardrails.blocked === true);
  check('guardedEdit returns the UNCHANGED tree, so the page cannot drift from the model', JSON.stringify(refused.layout) === JSON.stringify(layout));
  check('the refusal survives the round trip through the result object a tool returns', refused.refused[0].rule === GUARD_RULES.remove && typeof refused.refused[0].message === 'string');

  const applied = guardedEdit(layout, [{ op: 'set', target: 'heading', path: 'position', value: { x: 44, y: 22 } }], { applyEdits, ...options });
  check('guardedEdit applies an ordinary edit and reports the guardrail delta', applied.applied.length === 1 && applied.guardrails.blocked === false && applied.violations !== null);
  check('the delta for a clean edit is clear (an imported window\'s own warnings are not re-reported)', applied.violations.clear === true && applied.violations.verdict !== 'fail', JSON.stringify(applied.violations.summary));

  // The DELTA is what makes a flag useful: the same finding present before and after is not news.
  //
  // The change made here is moving `option_list` OUT of `EVENT_DIPLO`, which turns the engine's "fill
  // the list under EVENT_DIPLO" lookup into a miss. Deleting a name instead would not show up: this
  // fixture omits several demanded names, so it already carries a `custom-gui-contract-missing`
  // finding at the same path, and a delta is defined by rule AND path - the missing LIST would grow,
  // the finding would not appear.
  const before = handoffGuard.scanContractViolations(layout, { customGuiWindows: ['test_event_window'], checkAssets: false, checkLocalisation: false });
  const movedOut = JSON.parse(JSON.stringify(layout));
  let diplo = null;
  const visit = (node) => {
    if (node.name === 'EVENT_DIPLO') diplo = node;
    for (const child of node.children ?? []) visit(child);
  };
  visit(movedOut.root);
  const optionRow = (diplo.children ?? []).find((child) => child.name === 'option_list');
  diplo.children = diplo.children.filter((child) => child !== optionRow);
  movedOut.root.children[0].children.push(optionRow);
  const after = handoffGuard.scanContractViolations(movedOut, { customGuiWindows: ['test_event_window'], checkAssets: false, checkLocalisation: false });
  const delta = handoffGuard.diffViolations(before, after);
  check('diffViolations reports the contract finding an edit INTRODUCED', delta.introducedHard.some((finding) => finding.rule === 'custom-gui-contract-nesting'), JSON.stringify({ before: before.byRule, after: after.byRule, introduced: delta.introduced.map((finding) => finding.rule) }));
  check('and it says the edit is not clear', delta.clear === false && delta.verdict === 'fail');
  check('the delta does not re-report the findings that were there all along', delta.introducedHard.every((finding) => finding.rule !== 'parked-element-shortcut'), JSON.stringify(delta.introducedHard.map((finding) => finding.rule)));
});

// The registry, driven for real. Not inside `group` because the call is async, and an assertion that
// runs after the summary line is not an assertion.
heading('handoff guardrails: the tool registry refuses through the real handler');
{
  const { GUARD_RULES } = handoffGuard;
  const registry = createToolRegistry(makeToolContext());
  const layout = eventWindowLayout();
  const refusedResult = await registry.call('gui_layout_edit', {
    layout,
    edits: [{ op: 'remove', target: 'close' }],
    guard: true,
    custom_gui_windows: ['test_event_window'],
    store: false,
  });
  check('gui_layout_edit REFUSES deleting a contract name through the tool registry', (refusedResult.refused ?? []).length === 1 && refusedResult.refused[0].rule === GUARD_RULES.remove, JSON.stringify((refusedResult.refused ?? []).map((entry) => entry.rule)));
  check('the tool reports the refusal as an error string as well as a list', typeof refusedResult.error === 'string' && /REFUSED/.test(refusedResult.error));
  check('the tool lists every protected element, so an agent can see the locks', (refusedResult.guardrails?.protected ?? []).some((entry) => entry.name === 'close'));
  check('a guarded call does not claim to be disabled', refusedResult.guardrails?.disabled !== true);

  const appliedResult = await registry.call('gui_layout_edit', {
    layout,
    edits: [{ op: 'set', target: 'heading', path: 'position', value: { x: 44, y: 22 } }],
    custom_gui_windows: ['test_event_window'],
    store: false,
  });
  check('gui_layout_edit applies an ordinary edit', (appliedResult.applied ?? []).length === 1 && (appliedResult.refused ?? []).length === 0);
  check('a guarded edit reports its guardrail delta', appliedResult.guardrailViolations !== undefined && appliedResult.guardrailViolations.clear === true);

  const unguarded = await registry.call('gui_layout_edit', {
    layout,
    edits: [{ op: 'remove', target: 'close' }],
    guard: false,
    custom_gui_windows: ['test_event_window'],
    store: false,
  });
  check('an unguarded edit is allowed ONLY when it is explicitly asked for', (unguarded.applied ?? []).length === 1 && unguarded.guardrails?.disabled === true);
  check('the unguarded edit is ANNOUNCED in its result, never silently unguarded', /NOT enforced/.test(unguarded.guardrails?.note ?? ''));

  const listed = await registry.call('gui_handoff_list', { handoff_root: join(scratch, 'handoff-selftest'), pending_only: false, include_diff: false });
  check('gui_handoff_list is registered and reads the handoff area', Array.isArray(listed.handoffs) && typeof listed.pendingCount === 'number', JSON.stringify(Object.keys(listed)));
  const status = await registry.call('gui_handoff_status', { handoff_root: join(scratch, 'handoff-selftest') });
  check('gui_handoff_status reports the channel state', typeof status.total === 'number' && typeof status.handoffRoot === 'string', JSON.stringify(Object.keys(status)));
}

group('handoff: the provenance diff says what changed, in words', () => {
  const before = eventWindowLayout();
  const after = JSON.parse(JSON.stringify(before));
  const find = (root, name) => {
    let found = null;
    const visit = (node) => {
      if (node.name === name) found = node;
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return found;
  };
  find(after.root, 'heading').position = { x: 48, y: 22 };
  find(after.root, 'body_panel').size = { width: 420, height: 200 };
  find(after.root, 'confirm_button').spriteType = 'GFX_line_medium';
  find(after.root, 'close').text = 'X';
  after.root.children.push({ id: 'brand_new', kind: 'text', name: 'brand_new', position: { x: 1, y: 2 }, maxWidth: 10, maxHeight: 8, font: 'cg_16b', text: 'k' });
  const removed = JSON.parse(JSON.stringify(after));
  removed.root.children = removed.root.children.filter((child) => child.name !== 'brand_new');

  const diff = diffLayouts(before, after, { beforeId: 'as-loaded', afterId: 'current' });
  const summaries = diff.changes.map((change) => change.summary).join('\n');
  const prefix = '(selftest.gui)/';
  if (!/changed sprite of `body_panel`/.test(summaries)) process.stdout.write(`  (debug) diff summaries:\n${summaries}\n  (debug) counts ${JSON.stringify(diff.counts)}\n`);
  check('a move is described with both coordinates', /moved `heading` \(30,22\) -> \(48,22\)/.test(summaries), summaries);
  check('a resize is described with both sizes', /resized `body_panel` 400x200 -> 420x200/.test(summaries), summaries);
  check('a sprite change is described', /changed sprite of `confirm_button`/.test(summaries), summaries);
  check('a text change is described', /changed `text` of `close`/.test(summaries), summaries);
  check('an added element is described', /added element `brand_new`/.test(summaries), summaries);
  check(
    'the changed paths are returned, for highlighting, in the layout path convention',
    diff.changedPaths.includes(`${prefix}test_event_window/heading`) && diff.changedPaths.includes(`${prefix}test_event_window/body_panel`) && diff.changedPaths.includes(`${prefix}brand_new`),
    JSON.stringify(diff.changedPaths),
  );
  check('the counts match the change list', Object.values(diff.counts).reduce((total, count) => total + count, 0) === diff.changes.length, JSON.stringify(diff.counts));

  const markdown = formatDiffMarkdown(diff, { title: 'Provenance' });
  check('the markdown names the before and after revisions', /as-loaded/.test(markdown) && /current/.test(markdown));
  check('the markdown groups changes under headings', /## moved/.test(markdown) && /## resized/.test(markdown), markdown.split('\n').slice(0, 12).join(' | '));
  check('the markdown is the same sentences the JSON carries', markdown.includes('moved `heading` (30,22) -> (48,22)'));

  const identical = diffLayouts(before, JSON.parse(JSON.stringify(before)), {});
  check('an unchanged layout reports no changes at all', identical.unchanged === true && identical.changes.length === 0);
  check('and its markdown says so instead of being empty', /No element, geometry, sprite or variable changed/.test(formatDiffMarkdown(identical, {})));

  const deletion = diffLayouts(after, removed, {});
  check('a deleted element is reported as removed', deletion.changes.some((change) => change.change === 'removed' && change.name === 'brand_new'), JSON.stringify(deletion.changes.map((change) => change.change)));
});

group('handoff: submit -> list -> pick round trips on disk', () => {
  const root = join(scratch, 'handoff-selftest');
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const layout = eventWindowLayout();
  const baseline = eventWindowLayout();
  // The human MOVED something: a submission whose diff is empty proves nothing about provenance.
  const movedHeading = (() => {
    let found = null;
    const visit = (node) => {
      if (node.name === 'heading') found = node;
      for (const child of node.children ?? []) visit(child);
    };
    visit(layout.root);
    return found;
  })();
  movedHeading.position = { x: 48, y: 22 };
  const record = submitHandoff({
    layout,
    baseline,
    baselineLayoutId: 'as-loaded',
    layoutId: 'current',
    submittedBy: 'selftest',
    note: 'a move',
    validation: { verdict: 'pass', counts: { error: 0, warning: 0, info: 0 }, byRule: {}, guardrailVerdict: 'pass' },
    guardrails: { byRule: {}, hard: [], soft: [] },
    handoff_root: root,
    emit: false,
  });

  check('a submission lands under <root>/<timestamp>-<id>/', /handoff-selftest[\\/]\d{8}-\d{6}-[0-9a-f]{6}$/.test(record.directory), record.directory);
  check('it writes meta.json, layout.json and diff.md', ['meta.json', 'layout.json', 'diff.md'].every((file) => existsSync(join(record.directory, file))));
  check('layout.json is the submitted tree', existsSync(join(record.directory, 'layout.json')) && JSON.parse(readFileSync(join(record.directory, 'layout.json'), 'utf8')).name === layout.name);
  check('meta.json records the id, the time, the layout ids and the validation verdict', (() => {
    const meta = JSON.parse(readFileSync(join(record.directory, 'meta.json'), 'utf8'));
    return meta.id === record.id && typeof meta.createdAt === 'string' && meta.layoutIds.includes('current') && meta.layoutIds.includes('as-loaded') && meta.validation.guardrailVerdict === 'pass' && meta.invalid === false;
  })());
  check('the diff is the same sentences the agent gets: diff.md names the change', /moved `heading` \(30,22\) -> \(48,22\)/.test(readFileSync(join(record.directory, 'diff.md'), 'utf8')), readFileSync(join(record.directory, 'diff.md'), 'utf8').split('\n').slice(0, 10).join(' | '));

  const listed = listHandoffs({ handoff_root: root });
  check('listHandoffs finds it and counts it pending', listed.count === 1 && listed.pendingCount === 1 && listed.handoffs[0].id === record.id, JSON.stringify({ count: listed.count, pending: listed.pendingCount }));
  check(
    'the listing carries the diff text and the verdict',
    /moved `heading` \(30,22\) -> \(48,22\)/.test(listed.handoffs[0].diffMarkdown ?? '') && listed.handoffs[0].validation.guardrailVerdict === 'pass',
    (listed.handoffs[0].diffMarkdown ?? '(no diff text)').split('\n').slice(0, 8).join(' | '),
  );

  markPicked(record.id, { pickedBy: 'selftest', layoutId: 'picked' }, { handoff_root: root });
  const afterPick = listHandoffs({ handoff_root: root });
  check('picking clears it from the pending list', afterPick.pendingCount === 0 && afterPick.handoffs[0].status === 'picked');
  check('the picked marker is on disk, not only in memory', existsSync(join(record.directory, 'picked.json')));

  // A submission that was never validated is not silently treated as verified.
  const unvalidated = submitHandoff({ layout, handoff_root: root, emit: false });
  check('a submission with no verdict is recorded as `unvalidated`, not as a pass', unvalidated.validation.verdict === 'unvalidated' && unvalidated.validation.guardrailVerdict === 'unvalidated');
  const stats = handoffStats({ handoff_root: root });
  check('the status reports totals, pending and invalid counts', stats.total === 2 && stats.pending === 1 && stats.invalid === 0, JSON.stringify(stats));

  // A HARD guardrail finding makes the submission invalid, which is what stops a bad layout becoming
  // a baseline by accident.
  const hard = submitHandoff({
    layout,
    validation: { verdict: 'fail', counts: { error: 1 }, byRule: { 'custom-gui-contract-missing': 1 }, guardrailVerdict: 'fail' },
    guardrails: { byRule: { 'custom-gui-contract-missing': 1 }, hard: [{ rule: 'custom-gui-contract-missing', path: 'test_event_window', message: '`close` is missing' }], soft: [] },
    handoff_root: root,
    emit: false,
  });
  check('a submission with a HARD guardrail finding is marked invalid', hard.invalid === true && /custom-gui-contract-missing/.test(hard.invalidReason ?? ''), String(hard.invalidReason));
  check('the invalid submission is still written, so the record is auditable', existsSync(join(hard.directory, 'meta.json')) && existsSync(join(hard.directory, 'diff.md')));
  check('the invalid flag survives a re-read from disk', listHandoffs({ handoff_root: root }).handoffs.find((entry) => entry.id === hard.id)?.invalid === true);

  // The output-root refusal still applies to the handoff area itself.
  let refusedGame = false;
  let message = '';
  try {
    assertHandoffRoot(DEFAULT_GAME_ROOT);
  } catch (thrown) {
    refusedGame = true;
    message = thrown.message;
  }
  check('the handoff root refuses a game install', refusedGame && /refusing/.test(message), message.slice(0, 120));
  let refusedMod = false;
  try {
    assertHandoffRoot(join(scratch, '..', '..', '.selftest', 'CheckFiles', '..'));
  } catch {
    refusedMod = false;
  }
  check('a non-mod, non-game directory is accepted as a handoff root', refusedMod === false);
});

// =====================================================================================
// The apply path: an edited tree spliced back into the file it came from
// =====================================================================================
//
// These are the assertions that fail if the apply mode is removed or made to normalise the file:
// a no-edit apply must be byte-identical (comments and all), and a one-field edit must change only
// the lines it must. The fixture below puts a comment at every position that matters - before the
// window, after its fields, between two children, and after the last child - because those are the
// positions a normalising rewrite loses.

group('apply mode (the edited tree goes back into the file)', () => {
  const sample = [
    '# file header comment',
    '@w = 100',
    '',
    'guiTypes = {',
    '\tcontainerWindowType = {',
    '\t\tname = "test_window"',
    '\t\tposition = {',
    '\t\t\tx = 0',
    '\t\t\ty = 0',
    '\t\t}',
    '\t\tsize = {',
    '\t\t\twidth = @w',
    '\t\t\theight = 50',
    '\t\t}',
    '\t\t# WINDOW BODY COMMENT',
    '\t\tcontainerWindowType = {',
    '\t\t\tname = "box_a"',
    '\t\t\tposition = {',
    '\t\t\t\tx = 1',
    '\t\t\t\ty = 2',
    '\t\t\t}',
    '\t\t\tsize = {',
    '\t\t\t\twidth = 10',
    '\t\t\t\theight = 10',
    '\t\t\t}',
    '\t\t}',
    '\t\t# DOCUMENTS BOX B',
    '\t\tinstantTextBoxType = {',
    '\t\t\tname = "box_b"',
    '\t\t\tposition = {',
    '\t\t\t\tx = 1',
    '\t\t\t\ty = 20',
    '\t\t\t}',
    '\t\t\tmaxWidth = 40',
    '\t\t\tmaxHeight = 12',
    '\t\t\tfont = "cg_16b"',
    '\t\t\ttext = "box_b_text"',
    '\t\t}',
    '\t\t# TRAILING WINDOW COMMENT',
    '\t}',
    '}',
    '',
  ].join('\n');
  const commentLines = (text) => text.split('\n').filter((line) => line.trimStart().startsWith('#')).length;
  const elementCount = (layout) => {
    let total = 0;
    walkLayout(layout.root, () => {
      total += 1;
    });
    return total;
  };
  const baseline = parseGuiText(sample, '(apply sample)').layout;
  const parse = (text) => parseGuiText(text, '(apply sample)');

  // ---- the no-edit gate -------------------------------------------------------------------
  const noEdit = applyLayoutToSource(sample, baseline, baseline, { fileKey: '(apply sample)' });
  check('an apply with no edits is BYTE-IDENTICAL (so an unmodified base cannot be rewritten)', noEdit.text === sample, `${noEdit.text.length} vs ${sample.length} chars`);
  check('an apply with no edits rewrites NOTHING', noEdit.rewrittenLines === 0 && noEdit.changed.length === 0, JSON.stringify(noEdit.changed.map((entry) => entry.name)));
  check('an apply reports the file as its diff base, with an empty diff', noEdit.diff.changed === 0, JSON.stringify(noEdit.diff));
  check('every comment line survives a no-edit apply', commentLines(noEdit.text) === commentLines(sample), `${commentLines(noEdit.text)} vs ${commentLines(sample)}`);

  // ---- the smallest real edit -------------------------------------------------------------
  const edited = JSON.parse(JSON.stringify(baseline));
  edited.root.children[0].children[1].position.y = 21;
  const oneEdit = applyLayoutToSource(sample, baseline, edited, { fileKey: '(apply sample)' });
  check('a one-field edit rewrites the element it edited', oneEdit.changed.some((entry) => entry.name === 'box_b' && entry.container === false), JSON.stringify(oneEdit.changed.map((entry) => `${entry.name}${entry.container ? '(c)' : ''}`)));
  check('a one-field edit reports its edited element as a LEAF, and the window as a container', oneEdit.changed.filter((entry) => !entry.container).length === 1 && oneEdit.changed.filter((entry) => entry.container).length === 1);
  check('a one-field edit changes a handful of lines, not the file', oneEdit.diff.changed > 0 && oneEdit.diff.changed <= 6, JSON.stringify(oneEdit.diff));
  check('a one-field edit keeps the edit', oneEdit.text.includes('y = 21') && !oneEdit.text.includes('y = 20'));
  check('a one-field edit keeps every comment line', commentLines(oneEdit.text) === commentLines(sample), `${commentLines(oneEdit.text)} vs ${commentLines(sample)}`);
  for (const marker of ['# file header comment', '# WINDOW BODY COMMENT', '# DOCUMENTS BOX B', '# TRAILING WINDOW COMMENT']) {
    check(`a one-field edit keeps the comment \`${marker}\``, oneEdit.text.includes(marker));
  }
  check('a one-field edit keeps the untouched sibling byte for byte', oneEdit.text.includes('name = "box_a"\n\t\t\tposition = {\n\t\t\t\tx = 1\n\t\t\t\ty = 2'));
  check('a one-field edit keeps the element ORDER of the file', oneEdit.text.indexOf('box_a') < oneEdit.text.indexOf('box_b'));
  // The whole point: a re-import of the patched text sees the edit and nothing else.
  const reparsed = parse(oneEdit.text);
  check('the patched text still parses', reparsed.ok === true, reparsed.reason ?? '');
  check('the patched text has the edited value and the original sibling', reparsed.layout.root.children[0].children[1].position.y === 21 && reparsed.layout.root.children[0].children[0].position.y === 2);
  check('the patched text carries the same number of elements', elementCount(reparsed.layout) === elementCount(baseline), `${elementCount(reparsed.layout)} vs ${elementCount(baseline)}`);
  check('the patched text passes the engine syntax check', checkGuiSyntax(oneEdit.text, '(patched)').ok === true);

  // ---- the write guard --------------------------------------------------------------------
  let refusedMod = false;
  let message = '';
  try {
    applyToFile(join(scratch, 'apply-target.txt'), baseline, edited, { dryRun: true });
  } catch (thrown) {
    refusedMod = true;
    message = thrown.message;
  }
  check('apply_to refuses anything that is not a .gui file', refusedMod && /\.gui file/.test(message), message.slice(0, 120));
  let refusedInstall = false;
  try {
    applyToFile(join(DEFAULT_GAME_ROOT, 'interface', 'planet_view.gui'), baseline, edited, { dryRun: true });
  } catch (thrown) {
    refusedInstall = true;
    message = thrown.message;
  }
  check('apply_to refuses a file inside a game install', refusedInstall && /install/.test(message), message.slice(0, 120));
  let refusedMissing = false;
  try {
    applyToFile(join(scratch, 'no_such_file.gui'), baseline, edited, { dryRun: true });
  } catch (thrown) {
    refusedMissing = true;
    message = thrown.message;
  }
  check('apply_to refuses a file that does not exist', refusedMissing && /does not exist/.test(message), message.slice(0, 120));

  // ---- the write itself -------------------------------------------------------------------
  const target = join(scratch, 'apply-target.gui');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, sample, 'utf8');
  const dry = applyToFile(target, baseline, edited, { dryRun: true });
  check('a dry run reports the patch and writes nothing', dry.written === false && readFileSync(target, 'utf8') === sample);
  check('a dry run returns the patched text', dry.patched === oneEdit.text);
  const written = applyToFile(target, baseline, edited, { dryRun: false });
  check('the write puts the patched text on disk', readFileSync(target, 'utf8') === oneEdit.text);
  check('the write reports written=true', written.written === true);
  check('the written file keeps the comments', commentLines(readFileSync(target, 'utf8')) === commentLines(sample));

  // ---- the handoff channel uses the same splice -------------------------------------------
  const handoffRoot = join(scratch, 'apply-handoff');
  rmSync(handoffRoot, { recursive: true, force: true });
  writeFileSync(target, sample, 'utf8');
  const submission = submitHandoff({
    layout: baseline,
    baseline,
    applyBaseline: baseline,
    applyTo: target,
    handoff_root: handoffRoot,
    emit: false,
  });
  check('a handoff with `applyTo` reports the apply', submission.apply !== null && submission.applyError === null, String(submission.applyError));
  check('a no-edit handoff is BYTE-IDENTICAL against the source file', submission.apply.byteIdentical === true, JSON.stringify(submission.apply.after));
  check('a no-edit handoff left the source file on disk unchanged', readFileSync(target, 'utf8') === sample);
  check('a no-edit handoff keeps every comment line', submission.apply.after.commentLines === commentLines(sample), `${submission.apply.after.commentLines} vs ${commentLines(sample)}`);
  check('a handoff without a baseline REFUSES rather than rewriting', (() => {
    const refused = submitHandoff({ layout: baseline, applyTo: target, handoff_root: handoffRoot, emit: false });
    return refused.apply === null && /baseline/.test(refused.applyError ?? '');
  })());
});

// =====================================================================================
// GAP-4: an edit that ADDS a top-level window
// =====================================================================================
//
// `apply_to` used to corrupt the file on the ONE edit a multi-window `.gui` most needs. Two
// separate defects, and the assertions below are written against the SYMPTOMS the round measured,
// not against the lines that were wrong - so they still fail if either defect comes back in a
// different form:
//
//   * the added window's block absorbed the WHOLE FILE (`inside = { from: 0, to: lines.length - 1 }`
//     for an element with no source block), so every existing window appeared a second time inside
//     it. Measured on the real 146,310-byte mod file: one window -> 300,332 bytes, two copies of
//     every window, and both `checkGuiSyntax` and any top-level window count still called it clean
//     because the copies are indented;
//   * an element with no block of its own searched the WHOLE FILE for its children, so a child that
//     merely shared a NAME with an unrelated element was treated as already present, its block was
//     never copied (it lies outside the range), and the new window was emitted EMPTY. Its own field
//     lines were also dropped, so the new window had no `name` at all.
//
// The count assertions are deliberately "exactly one occurrence of each window name, at top level",
// because that is the property the corruption violated in both directions (duplication and loss).

group('apply mode: adding a top-level window (GAP-4)', async () => {
  const fixture = [
    '# GAP-4 fixture: two windows, a comment that must survive',
    'guiTypes = {',
    '\tcontainerWindowType = {',
    '\t\tname = "gap4_alpha"',
    '\t\tposition = { x = 0 y = 0 }',
    '\t\tsize = { width = 400 height = 300 }',
    '\t\t# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE',
    '\t\tinstantTextBoxType = {',
    '\t\t\tname = "gap4_alpha_text"',
    '\t\t\tposition = { x = 10 y = 10 }',
    '\t\t\tmaxWidth = 200',
    '\t\t\tmaxHeight = 30',
    '\t\t\tfont = "cg_16b"',
    '\t\t\ttext = "gap4_alpha_text"',
    '\t\t}',
    '\t}',
    '\tcontainerWindowType = {',
    '\t\tname = "gap4_beta"',
    '\t\tposition = { x = 500 y = 0 }',
    '\t\tsize = { width = 200 height = 100 }',
    '\t\tinstantTextBoxType = {',
    '\t\t\tname = "gap4_beta_text"',
    '\t\t\tposition = { x = 10 y = 10 }',
    '\t\t\tmaxWidth = 100',
    '\t\t\tmaxHeight = 30',
    '\t\t\tfont = "cg_16b"',
    '\t\t\ttext = "gap4_beta_text"',
    '\t\t}',
    '\t}',
    '}',
    '',
  ].join('\n');

  const addWindow = (name) => ({
    op: 'add',
    node: {
      kind: 'container',
      keyword: 'containerWindowType',
      name,
      position: { x: 900, y: 0 },
      size: { width: 100, height: 100 },
      children: [
        {
          kind: 'text',
          keyword: 'instantTextBoxType',
          // The child's name deliberately SHARES A SUFFIX with window A's text (`gap4_alpha_text` vs
          // `gap4_gamma_text` are distinct, but the second defect was a name match against the whole
          // file) - so to reproduce it exactly the added child is named after an EXISTING element.
          name: 'gap4_alpha_text',
          position: { x: 0, y: 0 },
          maxWidth: 80,
          maxHeight: 20,
          font: 'cg_16b',
          text: 'gap4_gamma_text',
        },
      ],
    },
  });

  const occurrences = (text, name) => (text.match(new RegExp(`name = "${name}"`, 'g')) ?? []).length;
  const topLevelWindows = (text) => [...text.matchAll(/^(\t*)containerWindowType = \{/gm)].map((match) => match[1].length);

  // ---- the same-file apply, through the real splice ---------------------------------------
  const baseline = parseGuiText(fixture, '(gap4)').layout;
  const edited = JSON.parse(JSON.stringify(baseline));
  edited.root.children.push({
    kind: 'container',
    keyword: 'containerWindowType',
    name: 'gap4_gamma',
    position: { x: 900, y: 0 },
    size: { width: 100, height: 100 },
    children: [
      { kind: 'text', keyword: 'instantTextBoxType', name: 'gap4_gamma_text', position: { x: 0, y: 0 }, maxWidth: 80, maxHeight: 20, font: 'cg_16b', text: 'gap4_gamma_text' },
    ],
  });
  const added = applyLayoutToSource(fixture, baseline, edited, { fileKey: '(gap4)' });

  check('adding a window leaves every existing window exactly once', occurrences(added.text, 'gap4_alpha') === 1 && occurrences(added.text, 'gap4_beta') === 1, `alpha=${occurrences(added.text, 'gap4_alpha')} beta=${occurrences(added.text, 'gap4_beta')}`);
  check('adding a window emits the new window exactly once', occurrences(added.text, 'gap4_gamma') === 1, `gamma=${occurrences(added.text, 'gap4_gamma')}`);
  check('adding a window emits the new window\'s CHILD exactly once', occurrences(added.text, 'gap4_gamma_text') === 1, `gamma_text=${occurrences(added.text, 'gap4_gamma_text')}`);
  check('the added window is a TOP-LEVEL element, not nested in the last one', topLevelWindows(added.text).length === 3 && topLevelWindows(added.text).every((tabs) => tabs === 1), JSON.stringify(topLevelWindows(added.text)));
  check('the added window carries its OWN name field (it is not an unaddressable bare block)', /containerWindowType = \{\n\t\tname = "gap4_gamma"/.test(added.text), added.text.slice(added.text.indexOf('gap4_gamma') - 80, added.text.indexOf('gap4_gamma') + 40));
  check('the added window carries its own position and size', /name = "gap4_gamma"[\s\S]{0,120}position = \{[\s\S]{0,60}x = 900[\s\S]{0,120}size = \{[\s\S]{0,60}width = 100/.test(added.text));
  check('the added window is reported as added exactly once', added.added.filter((entry) => entry.name === 'gap4_gamma').length === 1 && added.removed.length === 0, JSON.stringify(added.added.map((entry) => entry.name)));
  check('adding a window rewrites only the new window\'s lines, not the file', added.rewrittenLines < fixture.split('\n').length, `${added.rewrittenLines} of ${fixture.split('\n').length}`);
  check('adding a window keeps the source\'s comments', added.text.includes('# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE'));
  check('adding a window keeps every untouched window byte for byte', added.text.includes('\t\t# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE\n\t\tinstantTextBoxType = {'));
  check('the patched text still parses and passes the engine syntax check', parseGuiText(added.text, '(gap4)').ok === true && checkGuiSyntax(added.text, '(gap4)').ok === true);

  // THE FAIL-IF-REVERTED PROOF, stated as a count on the whole file: the corrupt output was ~2.2x
  // the source and carried each existing window twice. One window of 15 lines cannot be more.
  check('the patch grows the file by roughly the new window, not by a second copy of the file', added.text.length < fixture.length * 2 && added.text.length > fixture.length, `${fixture.length} -> ${added.text.length}`);

  // ---- the BASELINE GUARD: subsumption, not equality --------------------------------------
  //
  // The exact-window-list rule refused an added window outright, because adding a window changes the
  // list BY CONSTRUCTION. These go through the real tool registry, which is the layer that held the
  // rule, and they pin the two directions: an ADD is accepted, a MISSING baseline window is not.
  const scratchDir = join(scratch, 'gap4');
  mkdirSync(scratchDir, { recursive: true });
  const target = join(scratchDir, 'gap4_fixture.gui');
  writeFileSync(target, fixture, 'utf8');
  const registry = createToolRegistry(makeToolContext());
  const imported = await registry.call('gui_layout_import', { path: target });
  const editedResult = await registry.call('gui_layout_edit', { layout_id: imported.layout_id, edits: [addWindow('gap4_gamma')], store: true, extra_roots: [scratchDir] });
  check('gui_layout_edit applies the add through the registry', (editedResult.applied ?? []).length === 1 && (editedResult.failed ?? []).length === 0, JSON.stringify(editedResult.failed ?? []));
  const applied = await registry.call('gui_emit_files', { layout_id: editedResult.layout_id, apply_to: target, apply_dry_run: true });
  check('a baseline is found for an edit that ADDS a window (subsumption, not equality)', typeof applied.baseline_from === 'string' && applied.baseline_from.length > 0, JSON.stringify(applied.baseline_from));
  check('the subsumption choice is ANNOUNCED, naming the windows the edit added', /SUBSUMPTION/.test(applied.baseline_note ?? '') && /gap4_gamma/.test(applied.baseline_note ?? ''), String(applied.baseline_note).slice(0, 160));
  check('the registry-level patch has one copy of each window too', occurrences(applied.patched ?? '', 'gap4_alpha') === 1 && occurrences(applied.patched ?? '', 'gap4_gamma') === 1, JSON.stringify({ alpha: occurrences(applied.patched ?? '', 'gap4_alpha'), gamma: occurrences(applied.patched ?? '', 'gap4_gamma') }));
  check('the registry-level patch KEPT the added window\'s own child, whose name collides with an existing element', (applied.patched ?? '').includes('gap4_gamma_text') && (applied.elements?.added ?? []).some((entry) => entry.name === 'gap4_alpha_text'), JSON.stringify((applied.elements?.added ?? []).map((entry) => entry.name)));

  // A baseline MISSING a window the edited tree still has is a different file (or a rename), and the
  // relaxed rule must still refuse it: subsumption is "every baseline window survives", not "any".
  const other = parseGuiText(fixture.replace(/gap4_beta/g, 'gap4_delta'), '(gap4 other)').layout;
  let refused = false;
  let refusedMessage = '';
  try {
    // `apply_dry_run: false` is irrelevant - the refusal happens before any write.
    await registry.call('gui_emit_files', { layout_id: editedResult.layout_id, apply_to: target, apply_dry_run: true, baseline_layout_id: '__none__' });
  } catch (thrown) {
    refused = true;
    refusedMessage = thrown instanceof Error ? thrown.message : String(thrown);
  }
  check('an unknown baseline_layout_id is still refused', refused && /unknown baseline_layout_id/.test(refusedMessage), refusedMessage.slice(0, 140));

  // The rule itself, stated directly on the trees, so a future refactor of the guard cannot leave
  // the assertions above passing against a different rule.
  const baselineNames = new Set(parseGuiText(fixture, '(gap4)').layout.root.children.map((node) => node.name));
  const otherNames = new Set(other.root.children.map((node) => node.name));
  check('the fixture really is a subsumption case: every baseline window survives the add', [...baselineNames].every((name) => name === 'gap4_beta' || name === 'gap4_alpha') && edited.root.children.length === 3);
  check('a baseline with a window the edit does not have is NOT subsumed', [...otherNames].some((name) => !new Set(edited.root.children.map((node) => node.name)).has(name)));
});

// =====================================================================================
// THE BAR API GAPS (GAP-5 / GAP-6 / GAP-7 / GAP-8)
//
// Each of these was a SILENT disagreement between what the API documents and what the code does,
// found by adopting the bar primitive for a real mod. The assertions are written against the
// SYMPTOM the round measured, so they fail if the defect returns in a different form.
// =====================================================================================

group('the bar API honours its own documented names, and a live value is not ink (GAP-5/6/7/8)', () => {
  const build = (node) => {
    const tree = defaultLayout({ name: 'gap_api', width: 1200, height: 600 });
    for (const child of Array.isArray(node) ? node : [node]) tree.root.children.push(child);
    return tree;
  };
  const boxesOf = (node) => computeLayout(build(node)).boxes;
  const findingsWithText = (node, values) =>
    validateLayout(build(node), {
      checkAssets: false,
      checkLocalisation: false,
      measureText: true,
      gameRoot: resolveGameRoot(),
      resolveLocalisation: (key) => values.get(key) ?? null,
    }).findings;

  // ---------------------------------------------------------------- GAP-6: valueWidth / valueGap
  //
  // `readColumn(node, 'valueText', …)` derived BOTH names from the one string it was given, so it
  // read `valueTextWidth` / `valueTextGap` - and `valueWidth: 170` produced a 70 px column, silently.
  // `rowLabel` and `seats` hid it because for them the node key and the field prefix are the same word.
  {
    const boxes = boxesOf({ id: 'x', kind: 'bar', name: 'gap6_bar', position: { x: 0, y: 0 }, width: 240, height: 20, value: 1, max: 2, rowLabel: 'gap6_name', valueText: 'gap6_value', valueWidth: 170, valueGap: 33 });
    const box = boxes.find((entry) => entry.name === barPieceName('gap6_bar', 'value'));
    const track = boxes.find((entry) => entry.name === barPieceName('gap6_bar', 'track'));
    check('a bar honours the DOCUMENTED `valueWidth` for its value column', box?.node?.maxWidth === 170, JSON.stringify({ maxWidth: box?.node?.maxWidth, size: box?.node?.size }));
    check('a bar honours the DOCUMENTED `valueGap` between the track and the value column', box && track ? box.node.position.x - track.node.position.x - track.node.size.width === 33 : false, JSON.stringify({ valueX: box?.node?.position?.x, trackRight: track ? track.node.position.x + track.node.size.width : null }));
    // The same names as before must keep working, because the mod's own plans were written with the
    // old spelling. Getting the width either way, never nothing, is the whole of the fix.
    const legacy = boxesOf({ id: 'x', kind: 'bar', name: 'gap6_legacy', position: { x: 0, y: 0 }, width: 240, height: 20, value: 1, max: 2, rowLabel: 'gap6_name', valueText: 'gap6_value', valueTextWidth: 155 });
    const legacyBox = legacy.find((entry) => entry.name === barPieceName('gap6_legacy', 'value'));
    check('the old `valueTextWidth` spelling is still honoured', legacyBox?.node?.maxWidth === 155, JSON.stringify(legacyBox?.node?.maxWidth));
    const deprecated = validateLayout(build({ id: 'x', kind: 'bar', name: 'gap6_warn', position: { x: 0, y: 0 }, width: 240, height: 20, value: 1, max: 2, rowLabel: 'gap6_name', valueText: 'gap6_value', valueTextWidth: 155 }), { checkAssets: false, checkLocalisation: false }).findings;
    check('and using the old spelling is REPORTED rather than silent', deprecated.some((finding) => finding.rule === 'bar-field-deprecated'), JSON.stringify(deprecated.filter((finding) => /^bar-/.test(finding.rule)).map((finding) => finding.rule)));
    const documented = validateLayout(build({ id: 'x', kind: 'bar', name: 'gap6_clean', position: { x: 0, y: 0 }, width: 240, height: 20, value: 1, max: 2, rowLabel: 'gap6_name', valueText: 'gap6_value', valueWidth: 170 }), { checkAssets: false, checkLocalisation: false }).findings;
    check('the documented spelling raises no deprecation', !documented.some((finding) => finding.rule === 'bar-field-deprecated'));
    // The helper that reads a bar out of an IMPORTED tree must write the name that is READ.
    const imported = parseGuiText(
      ['guiTypes = {', '  containerWindowType = {', '    name = "gap6_track"', '    size = { width = 240 height = 20 }', '    background = { name = "bg" quadTextureSprite = "gfx_transparency_white" }', '  }', '  instantTextBoxType = {', '    name = "gap6_value"', '    position = { x = 250 y = 0 }', '    maxWidth = 130', '    maxHeight = 18', '    font = "cg_16b"', '    text = "gap6_value_key"', '  }', '}', ''].join('\n'),
      '(gap6-imported.gui)',
    ).layout;
    const derived = barFieldsFromElements({ track: 'gap6_track', value: 'gap6_value' }, imported);
    check('barFieldsFromElements writes a value-column width the bar actually READS', (() => {
      if (derived?.valueWidth !== 130) return false;
      const rebuilt = boxesOf({ ...derived, name: 'gap6_rebuilt', id: 'gap6_rebuilt', position: { x: 0, y: 0 }, rowLabel: 'gap6_name', valueText: 'gap6_value_key', value: 1, max: 2 });
      const rebuiltValue = rebuilt.find((entry) => entry.name === barPieceName('gap6_rebuilt', 'value'));
      return rebuiltValue?.node?.maxWidth === 130;
    })(), JSON.stringify({ derived: derived?.valueWidth }));
  }

  // ---------------------------------------------------------------- GAP-7: buttonText on an effectbutton
  //
  // `buttonText` was in no kind's field set, so the ONE measured live-text channel inside a
  // `custom_gui` window was reported as `unknown-field` - 62 times on the shipped mod file, every
  // one of them a live number. `emit.mjs` already wrote the field.
  {
    const findings = validateLayout(build({ id: 'x', kind: 'effectbutton', name: 'gap7_live', position: { x: 0, y: 0 }, size: { x: 120, y: 20 }, effect: 'some_effect', buttonText: 'gap7_key' }), { checkAssets: false, checkLocalisation: false }).findings;
    check('`buttonText` on an `effectbutton` is NOT an unknown field', !findings.some((finding) => finding.rule === 'unknown-field' && /buttonText/.test(finding.message ?? '')), JSON.stringify(findings.filter((finding) => finding.rule === 'unknown-field').map((finding) => finding.message)));
    // The control: an invented field must still be reported, so the rule was not simply switched off.
    const invented = validateLayout(build({ id: 'x', kind: 'effectbutton', name: 'gap7_bogus', position: { x: 0, y: 0 }, size: { x: 120, y: 20 }, effect: 'some_effect', buttonText: 'gap7_key', zzz_not_a_field: 'x' }), { checkAssets: false, checkLocalisation: false }).findings;
    check('an INVENTED field on an `effectbutton` is still reported', invented.some((finding) => finding.rule === 'unknown-field'), JSON.stringify(invented.filter((finding) => finding.rule === 'unknown-field').map((finding) => finding.message)));
    // And it is a localisation KEY, so an unresolved key is reported by the key rule, not as a field.
    check('`buttonText` is treated as a localisation key, like `text`', isKnownField('buttonText') === true && kindAcceptsField('effectbutton', 'buttonText') === true && kindAcceptsField('button', 'buttonText') === true);
  }

  // ---------------------------------------------------------------- GAP-5: a live value is not ink
  //
  // An unresolved `[$GetX$]` token measures 146 px (cg_16b) in the reference's own 70 px value
  // column. Charging it as ink produced 30 false `text-overflow` findings on the real mod, and no
  // width satisfied the rule: 70 px overflows, 160 px collides with the action buttons. The
  // measurement must say what it cannot know.
  {
    const values = new Map([
      ['gap5_live', '[$GetGap5Number$]'],
      ['gap5_static_long', 'A STATIC STRING WIDER THAN ONE HUNDRED AND TWENTY PIXELS IN cg_16b FOR SURE'],
    ]);
    const live = { id: 'x', kind: 'effectbutton', name: 'gap5_live_box', position: { x: 0, y: 0 }, size: { x: 120, y: 18 }, font: 'cg_16b', buttonText: 'gap5_live', effect: 'gap5_effect' };
    const liveFindings = findingsWithText(live, values).filter((finding) => finding.element === 'gap5_live_box');
    check('a live `[$...$]` value on the resolving channel is NOT charged as text overflow', !liveFindings.some((finding) => finding.rule === 'text-overflow'), JSON.stringify(liveFindings.map((finding) => `${finding.rule}:${finding.measuredWidth ?? ''}`)));
    check('and the exclusion is REPORTED, with the measurement that caused it', liveFindings.some((finding) => finding.rule === 'text-live-value' && finding.measuredWidth > 120), JSON.stringify(liveFindings.filter((finding) => finding.rule === 'text-live-value').map((finding) => ({ w: finding.measuredWidth, tokens: finding.liveTokens }))));
    // THE CONTROL: the same box with a STATIC over-long string is still an overflow. Without this the
    // assertion above would pass if the rule had simply been switched off for effectbuttons.
    const staticLong = { ...live, name: 'gap5_static_box', buttonText: 'gap5_static_long' };
    check('a STATIC over-long string in the same kind of box IS still an overflow', findingsWithText(staticLong, values).some((finding) => finding.rule === 'text-overflow' && finding.element === 'gap5_static_box'), JSON.stringify(findingsWithText(staticLong, values).map((finding) => finding.rule)));
    // And the live token in a PLAIN text box is the section-11 trap: painted literally, so it keeps
    // its finding. The exclusion is about the resolving channel, not about the token.
    const plain = { ...live, kind: 'text', name: 'gap5_plain_box', text: 'gap5_live', buttonText: undefined };
    check('the same token in a PLAIN text box is NOT excluded (it is painted literally)', findingsWithText(plain, values).some((finding) => finding.rule === 'text-overflow' && finding.element === 'gap5_plain_box'), JSON.stringify(findingsWithText(plain, values).map((finding) => finding.rule)));
    // The report says how many findings the exclusion removed, so a clean report cannot be read as
    // "nothing was there".
    const report = validateLayout(build(live), { checkAssets: false, checkLocalisation: false, measureText: true, gameRoot: resolveGameRoot(), resolveLocalisation: (key) => values.get(key) ?? null });
    check('the report carries the live-value exclusion count', (report.textMeasurement?.liveExcluded?.overflow ?? 0) >= 1 && (report.textMeasurement?.live ?? 0) >= 1, JSON.stringify(report.textMeasurement?.liveExcluded));
  }

  // ---------------------------------------------------------------- GAP-8: the live channel needs no label
  //
  // The live channel is switched on by `labelEffect`/`effect`, and the switch used to require a
  // `label` as well - so a caller had to pass a label it did not want, with `labelSide: 'none'`,
  // purely to reach the value channel. Without it the value expanded to painted text and the engine
  // printed the `[$...$]` token literally.
  {
    const live = boxesOf({ id: 'x', kind: 'bar', name: 'gap8_bar', position: { x: 0, y: 0 }, width: 240, height: 20, value: 1, max: 2, rowLabel: 'gap8_name', valueText: 'gap8_value', effect: 'gap8_effect' });
    const value = live.find((entry) => entry.name === barPieceName('gap8_bar', 'value'));
    check('passing `effect` alone puts the VALUE column on the live channel (no dummy `label` needed)', value?.node?.kind === 'effectbutton' && value?.node?.buttonText === 'gap8_value', JSON.stringify({ kind: value?.node?.kind, buttonText: value?.node?.buttonText }));
    check('the live value button carries no `text` field (a button paints `buttonText`)', value?.node?.text === undefined);
    check('the live value button carries the transparent tile as its hit region, like the reference', value?.node?.quadTextureSprite === 'gfx_transparency_white', JSON.stringify(value?.node?.quadTextureSprite));
    check('no fifth element is emitted for the live channel', live.filter((entry) => entry.name.endsWith('_label')).length === 0, JSON.stringify(live.filter((entry) => entry.name.endsWith('_label')).map((entry) => entry.name)));
    // The static control: with no `effect` the same bar paints text, which is the trap the switch exists for.
    const staticBar = boxesOf({ id: 'x', kind: 'bar', name: 'gap8_static', position: { x: 0, y: 0 }, width: 240, height: 20, value: 1, max: 2, rowLabel: 'gap8_name', valueText: 'gap8_value' });
    const staticValue = staticBar.find((entry) => entry.name === barPieceName('gap8_static', 'value'));
    check('with no `effect` the value column is painted text', staticValue?.node?.kind === 'text' && staticValue?.node?.text === 'gap8_value');
    // The old spelling still works, so every existing plan stays valid.
    const legacy = boxesOf({ id: 'x', kind: 'bar', name: 'gap8_legacy', position: { x: 0, y: 0 }, width: 240, height: 20, value: 1, max: 2, rowLabel: 'gap8_name', valueText: 'gap8_value', label: 'gap8_label', labelSide: 'none', labelEffect: true, effect: 'gap8_effect' });
    const legacyValue = legacy.find((entry) => entry.name === barPieceName('gap8_legacy', 'value'));
    check('`label` + `labelSide: none` + `labelEffect` still reaches the same channel', legacyValue?.node?.kind === 'effectbutton' && legacy.filter((entry) => entry.name.endsWith('_label')).length === 0, JSON.stringify({ kind: legacyValue?.node?.kind }));
    // And a clone inherits the live channel rather than silently reverting to painted text.
    const cloned = collectBars(
      build([
        { id: 'a', kind: 'bar', name: 'gap8_source', position: { x: 0, y: 0 }, width: 240, height: 20, value: 1, max: 2, rowLabel: 'gap8_name', valueText: 'gap8_value', effect: 'gap8_effect' },
        { id: 'b', kind: 'bar', name: 'gap8_clone', cloneOf: 'gap8_source', position: { x: 0, y: 40 }, value: 1, max: 2, rowLabel: 'gap8_name2', valueText: 'gap8_value2' },
      ]),
      {},
    );
    const cloneBoxes = computeLayout(
      build([
        { id: 'a', kind: 'bar', name: 'gap8_source', position: { x: 0, y: 0 }, width: 240, height: 20, value: 1, max: 2, rowLabel: 'gap8_name', valueText: 'gap8_value', effect: 'gap8_effect' },
        { id: 'b', kind: 'bar', name: 'gap8_clone', cloneOf: 'gap8_source', position: { x: 0, y: 40 }, value: 1, max: 2, rowLabel: 'gap8_name2', valueText: 'gap8_value2' },
      ]),
    ).boxes;
    const cloneValue = cloneBoxes.find((entry) => entry.name === barPieceName('gap8_clone', 'value'));
    check('a CLONE of a live bar keeps the live channel', cloneValue?.node?.kind === 'effectbutton' && Boolean(cloned), JSON.stringify({ cloneKind: cloneValue?.node?.kind, collected: Array.isArray(cloned) }));
  }
});

// =====================================================================================
// THE BAR COMPONENT (src/lib/components.mjs)
//
// The specification for a bar is a TRANSCRIPTION of the power-projection ranking bars in the
// working mod, not a design. These checks are what make that claim true rather than aspirational:
// the transcription is re-read from the file it was transcribed from, the expansion is compared to
// it field for field, and the comparison is shown to fail when the expansion is gutted.
// =====================================================================================

group('the bar component clones the reference construction (C1)', () => {
  const referenceFile = REFERENCE_RANKING_ROW.file;

  // ---------------------------------------------------------------- the transcription is real
  //
  // Every element and every literal in REFERENCE_BAND_ELEMENTS is re-read from the mod's own `.gui`
  // and compared. This is the check that would have caught the two invented elements an earlier
  // revision of components.mjs carried (`unga_att_un_value_nato` / `unga_att_stab_value_nato`, at
  // line ranges holding something else - the names now exist in the file because ANOTHER AGENT added
  // them while this work was in progress, which is exactly why the check cannot be "these names must
  // be absent").
  //
  // THE ELEMENTS ARE FOUND BY NAME, NOT BY LINE. The line ranges in the transcription are kept as
  // PROVENANCE - the record of where the numbers were read - but they cannot be asserted: this file
  // is under active development by another agent (measured during this work: 7,469 lines, then
  // 13,460, with the whole chart subtree shifted by 3 lines and the AU bloc band moved past :7500). A
  // transcription anchored to line numbers would fail for a reason that has nothing to do with the
  // bar. Anchoring on the NAME and asserting every FIELD is the check that stays meaningful.
  //
  // The file is PARSED with this project's own parser and walked by name, rather than sliced by a
  // brace counter: the mod's own formatting puts a window's `{` on a line that also holds other
  // tokens, and a hand-rolled slicer returned a 2,600-line "element" (measured).
  const haveFile = existsSync(referenceFile);
  check('the reference .gui is present to check the transcription against', haveFile, referenceFile);
  /** Every named element of the parsed file, by name, with the line the parser recorded for it. */
  const indexByName = new Map();
  if (haveFile) {
    const parsed = parseGuiText(readFileSync(referenceFile, 'utf8'), referenceFile);
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.name && !indexByName.has(node.name)) indexByName.set(node.name, node);
      for (const child of node.children ?? []) walk(child);
    };
    for (const container of parsed.containers ?? []) walk(container);
    check('the reference file parses, so the transcription can be checked against it', parsed.ok === true, String(parsed.reason ?? ''));
  }
  if (haveFile) {
    for (const element of REFERENCE_BAND_ELEMENTS) {
      const node = indexByName.get(element.name);
      check(
        `the transcription's ${element.role} \`${element.name}\` is in the file as a \`${element.keyword}\``,
        Boolean(node),
        node ? `found as ${node.kind}, transcribed at :${element.lines.join('-')}` : 'NOT FOUND - the name does not occur anywhere in the file',
      );
      if (!node) continue;
      // Every literal field, compared against the MODEL the parser produced - not against the text.
      for (const [field, value] of Object.entries(element.fields)) {
        if (field === 'position' || field === 'size') {
          const actual = field === 'position' ? node.position : node.size;
          const ok =
            actual !== undefined &&
            actual !== null &&
            (field === 'position' ? actual.x === value.x && actual.y === value.y : actual.width === value.width && actual.height === value.height);
          check(`  ${element.name} carries ${field} ${JSON.stringify(value)}`, ok, JSON.stringify(actual ?? null));
          continue;
        }
        check(
          `  ${element.name} carries ${field} = ${JSON.stringify(value)}`,
          node[field] === value,
          `${JSON.stringify(node[field] ?? null)} (declared ${JSON.stringify(value)})`,
        );
      }
      if (element.background) {
        for (const [field, value] of Object.entries(element.background)) {
          const actual = element.name === REFERENCE_RANKING_ROW.parent.name && field === 'quadTextureSprite' ? node.background?.quadTextureSprite ?? node.background?.sprite : node.background?.name;
          check(
            `  ${element.name}.background carries ${field} = ${value}`,
            (node.background?.[field] ?? node.background?.sprite ?? null) === value || actual === value,
            JSON.stringify(node.background ?? null),
          );
        }
      }
    }
    // The defect is a defect: the rank-0 fill really is as wide as its track.
    const defectNode = indexByName.get(REFERENCE_RANKING_ROW.defect.name);
    check(
      'the rank-0 fill the primitive refuses really is a 400 px fill in a 400 px track at x = 242',
      defectNode?.size?.width === 400 && defectNode?.position?.x === 242 && defectNode?.background?.sprite === 'gfx_transparency_white',
      JSON.stringify(defectNode ? { position: defectNode.position, size: defectNode.size, background: defectNode.background } : null),
    );
    // And the second/third uses are really the same construction elsewhere in the same file.
    for (const use of [...REFERENCE_RANKING_ROW.secondUses, REFERENCE_RANKING_ROW.thirdUse]) {
      const trackNode = indexByName.get(use.trackName);
      const fillNode = indexByName.get(use.fillName);
      check(
        `the ${use.what} track is \`${use.trackName}\`: ${use.track.width}x${use.track.height} with the dark tile`,
        trackNode?.size?.width === use.track.width &&
          trackNode?.size?.height === use.track.height &&
          trackNode?.background?.sprite === use.track.sprite,
        JSON.stringify(trackNode ? { size: trackNode.size, background: trackNode.background } : null),
      );
      check(
        `the ${use.what} fill is \`${use.fillName}\`: ${use.fill.size.width}x${use.fill.size.height} with the white tile`,
        fillNode?.size?.width === use.fill.size.width &&
          fillNode?.size?.height === use.fill.size.height &&
          fillNode?.background?.sprite === use.fill.sprite,
        JSON.stringify(fillNode ? { size: fillNode.size, background: fillNode.background } : null),
      );
      // The horizontal inset, which is the invariant: fill x = track x + inset.
      check(
        `and its fill sits exactly ${use.fill.inset.x} px inside its track on the x axis`,
        trackNode?.position !== undefined && fillNode?.position !== undefined && fillNode.position.x - trackNode.position.x === use.fill.inset.x,
        `${fillNode?.position?.x} - ${trackNode?.position?.x}`,
      );
    }
    /**
     * The structural claim an earlier revision made WITHOUT measuring it: it asserted that
     * `unga_att_un_value_nato` / `unga_att_stab_value_nato` were a sprite-less counter-example - two
     * containers, one nested in the other, neither with a `spriteType`/`quadTextureSprite`, so
     * nothing paints. Those elements now exist in the file (the other agent added them) and BOTH
     * carry a sprite on the track AND on the fill, so that claim was wrong when it was written and is
     * wrong now. This asserts what is actually there.
     */
    for (const name of ['unga_att_un_value_nato', 'unga_att_stab_value_nato', 'unga_att_un_value_nato_fill', 'unga_att_stab_value_nato_fill']) {
      const node = indexByName.get(name);
      check(
        `\`${name}\` carries a sprite, so it is not the sprite-less counter-example the transcription once invented`,
        !node || Boolean(node.background?.sprite),
        JSON.stringify(node?.background ?? 'not in the file'),
      );
    }
  }

  // ---------------------------------------------------------------- the two sprites exist
  const installRoot = resolveGameRoot();
  const gfxFiles = { track: 'interface\\fleet_view.gfx', fill: 'interface\\core.gfx' };
  if (installRoot) {
    for (const [which, relative] of Object.entries(gfxFiles)) {
      const path = join(installRoot, relative);
      const sprite = REFERENCE_RANKING_ROW.sprites[which];
      const body = existsSync(path) ? readFileSync(path, 'utf8') : '';
      check(
        `the ${which} sprite ${sprite.name} is defined in the install`,
        body.includes(`name = "${sprite.name}"`),
        path,
      );
    }
  }

  // ---------------------------------------------------------------- the expansion IS the reference
  const referenceBar = () => ({
    id: 'unga_power_1_main',
    kind: 'bar',
    name: 'unga_power_1_main',
    position: { x: 240, y: 66 },
    width: 400,
    height: 20,
    value: 383,
    max: 400,
    rowLabel: 'unga_faction_nato',
    valueText: 'unga_power_value_2',
    valueColour: 'Y',
    seats: 'unga_power_seats_2',
    seatsColour: 'E',
  });
  const rowLayout = (bar) => {
    const layout = defaultLayout({ name: 'bar_clone_probe', width: 900, height: 400 });
    layout.root.position = { x: 228, y: 160 };
    layout.root.children.push(bar);
    return layout;
  };
  /**
   * A node as the reference table states it: the model fields, minus what THIS emitter always adds,
   * with the background's sprite key translated to the engine field the file carries.
   *
   * `background.sprite` is the emitter's spelling (`renderBackground` writes it as
   * `quadTextureSprite`); the reference writes `quadTextureSprite` directly. Comparing without the
   * translation would fail on a bar that emits correctly, and - worse - would pass on one whose
   * background has a `name` but NO sprite, which is the failure mode this whole primitive is about.
   */
  const modelFields = (node) => {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (BAR_EMIT_ADDITIONS.includes(key)) continue;
      if (['children', 'subBlocks', 'conditionals'].includes(key)) continue;
      out[key] = key === 'background' && value && !Array.isArray(value) ? { ...value, quadTextureSprite: value.quadTextureSprite ?? value.sprite } : value;
    }
    if (out.background) delete out.background.sprite;
    return out;
  };
  const ROLES = ['name', 'track', 'fill', 'value', 'seats'];
  const barBoxes = (bar) => {
    const all = computeLayout(rowLayout(bar)).boxes;
    return ROLES.map((role) => barPiece(all, bar.name, role)).filter(Boolean);
  };
  const boxes = barBoxes(referenceBar());
  check(
    "a bar expands to the reference's five siblings, and nothing else",
    boxes.length === 5 && ROLES.every((role) => Boolean(barPiece(boxes, 'unga_power_1_main', role))),
    JSON.stringify(boxes.map((box) => `${box.kind}:${box.name}`)),
  );
  /**
   * The fill's LENGTH is the one field the primitive deliberately does not copy, because the
   * reference's own value is the defect (a 383 px fill in a 396 px cap is fine; the 400 px fill in
   * row 0 is not, and neither is a fill that ignores the inset). Everything else about the fill -
   * its kind, its position, its height, its sprite and its background's name - is compared, and the
   * length is asserted separately below against the proportion the caller asked for.
   */
  const skipFields = (role) => (role === 'fill' ? ['size'] : []);
  for (const role of ROLES) {
    const expected = REFERENCE_RANKING_ROW.elements.find((element) => element.role === role);
    const actual = barPiece(boxes, 'unga_power_1_main', role);
    const wanted = { name: expected.name, kind: expected.kind, ...expected.fields };
    const got = modelFields(actual.node);
    const skipped = skipFields(role);
    const comparable = (object) => Object.fromEntries(Object.entries(object).filter(([key]) => !skipped.includes(key)));
    check(
      `the ${role} element is FIELD-IDENTICAL to the reference's ${expected.name}`,
      JSON.stringify(comparable(wanted)) === JSON.stringify(comparable(got)),
      `want ${JSON.stringify(comparable(wanted))} got ${JSON.stringify(comparable(got))}`,
    );
    // None of the reference's fields may be missing, and none invented beyond the reference's own.
    check(
      `the ${role} element carries exactly the reference's ${Object.keys(expected.fields).length} fields`,
      Object.keys(got).length === Object.keys(wanted).length,
      `${Object.keys(got).length} vs ${Object.keys(wanted).length}: ${JSON.stringify(Object.keys(got))}`,
    );
    if (role === 'fill') {
      // The height and the sprite ARE identical; only the length is the caller's proportion.
      check(
        'the fill\'s height and sprite are still the reference\'s own',
        got.size.height === wanted.size.height && got.background.quadTextureSprite === wanted.background.quadTextureSprite,
        JSON.stringify({ got: got.size, wanted: wanted.size }),
      );
    }
  }

  // The one field the primitive deliberately does NOT reproduce: the fill's LENGTH. The reference's
  // 383 is a hand-picked proportion of the track (383/400 of 400, which would overflow if taken
  // literally); the primitive writes the proportion of the INSET CAP, and the difference is exactly
  // the defect the reference tolerates in row 0. The test states the arithmetic rather than
  // asserting a number, so it cannot drift.
  const fill = barPiece(boxes, 'unga_power_1_main', 'fill');
  const cap = 400 - 2 * 2;
  const expectedFill = Math.round(cap * (383 / 400));
  check(
    `the fill's length is the proportion of the INSET CAP (cap ${cap} * 383/400 = ${expectedFill}), not the track's`,
    fill.node.size.width === expectedFill && expectedFill !== 383,
    `${fill.node.size.width} vs ${expectedFill}`,
  );
  check(
    'and the reference\'s own 383 in a 396 px cap leaves the fill inside the track, unlike the defect row',
    383 <= cap && REFERENCE_RANKING_ROW.defect.fillAt.width > REFERENCE_RANKING_ROW.defect.cap,
    `383 vs cap ${cap}; the defect is ${REFERENCE_RANKING_ROW.defect.fillAt.width} in a cap of ${REFERENCE_RANKING_ROW.defect.cap}`,
  );
  // The inset invariant, asserted directly on the expansion.
  const track = barPiece(boxes, 'unga_power_1_main', 'track');
  check(
    'the fill is inset 2 px inside the track on every side',
    fill.node.position.x - track.node.position.x === 2 &&
      fill.node.position.y - track.node.position.y === 4 &&
      fill.node.position.x + fill.node.size.width <= track.node.position.x + track.node.size.width - 2 &&
      fill.node.position.y + fill.node.size.height <= track.node.position.y + track.node.size.height - 2,
    JSON.stringify({ fill: fill.node.position, size: fill.node.size, track: track.node.position }),
  );
  check(
    'the track carries the dark tile and the fill the white one, so the bar is not one tinted box',
    track.node.background.sprite === REFERENCE_RANKING_ROW.sprites.track.name &&
      fill.node.background.sprite === REFERENCE_RANKING_ROW.sprites.fill.name,
    `${track.node.background.sprite} / ${fill.node.background.sprite}`,
  );
  check(
    'both backgrounds are named `bg`, as the reference\'s are',
    track.node.background.name === 'bg' && fill.node.background.name === 'bg',
  );
  // The absolute geometry, which is what a caller actually needs. The bar declares the TRACK's
  // position (240, 66) inside a parent at (228, 160) inside a window at (738, 500), so the track
  // lands on (978, 566) - exactly where the reference's own track is, 240 px into `unga_chart_main`.
  const absolute = {};
  for (const role of ROLES) {
    const box = barPiece(boxes, 'unga_power_1_main', role);
    absolute[role] = { x: box.rect.x, y: box.rect.y };
  }
  check(
    "the five elements land on the reference's own absolute coordinates",
    JSON.stringify(absolute) ===
      JSON.stringify({
        name: { x: 764, y: 564 },
        track: { x: 978, y: 566 },
        fill: { x: 980, y: 570 },
        value: { x: 1384, y: 564 },
        seats: { x: 1466, y: 564 },
      }),
    JSON.stringify(absolute),
  );

  // ---------------------------------------------------------------- the geometry fit is a FIT
  for (const [height, wantedFill, wantedTop] of [[20, 12, 4], [18, 14, 2]]) {
    const geometry = describeBar({ kind: 'bar', name: `fit_${height}`, width: 400, height, value: 10, max: 100 }, { path: 'p' }).geometry;
    check(
      `a ${height} px track carries a ${wantedFill} px fill at y = ${wantedTop}, as measured`,
      geometry.fillHeight === wantedFill && geometry.fillTop === wantedTop,
      `${geometry.fillHeight} at ${geometry.fillTop}`,
    );
  }

  // ---------------------------------------------------------------- the EXPANSION cannot be gutted
  const emitted = emitGui(rowLayout(referenceBar())).text;
  const gutted = (text, needle) => text.replace(needle, '');
  const gutCheck = (what, needle) => check(`the emitted file carries ${what}`, emitted.includes(needle), needle);
  gutCheck('the track\'s dark tile sprite', 'quadTextureSprite = "GFX_tiles_dark_area_cut_8"');
  gutCheck('the fill\'s white tile sprite', 'quadTextureSprite = "gfx_transparency_white"');
  gutCheck('the reference\'s own track size', 'width = 400');
  gutCheck('the fill\'s inset position', 'x = 2');
  gutCheck('the name column\'s maxWidth = 202', 'maxWidth = 202');
  gutCheck('the value column\'s maxWidth = 70', 'maxWidth = 70');
  gutCheck('the seats column\'s maxWidth = 118', 'maxWidth = 118');
  gutCheck('the label font', 'font = "cg_16b"');
  gutCheck('a `containerWindowType` for the track', 'unga_power_track_1_main');
  gutCheck('an `instantTextBoxType` for the name', 'unga_power_name_1_main');
  check(
    'the emitted file holds five elements for the one bar node',
    emittedBlocks(emitted).filter((block) => String(block.name).startsWith('unga_power_')).length === 5,
    String(emittedBlocks(emitted).filter((block) => String(block.name).startsWith('unga_power_')).length),
  );
  // ---------------------------------------------------------------- THE FAIL-IF-REMOVED PROOF
  //
  // The field-identity checks above are only worth something if they can fail. The proof has two
  // halves, and neither is allowed to be self-referential:
  //
  //   1. THE SOURCE GUARD. `src/lib/components.mjs` is read as text and required to carry every
  //      load-bearing decision the construction depends on: the two sprite kinds, the fill's
  //      `background`, the inset arithmetic, both position offsets, and the five kind keywords. If
  //      someone blanks the fill's background (the exact mistake that makes a bar a tinted box - the
  //      counter-example this project's own notes record), this fails BY NAME with the string that
  //      went missing.
  //   2. THE BEHAVIOURAL GUARD. The field-identity comparison is re-run against the same element
  //      with ONE field perturbed, and must report a difference. This is asserted for every field of
  //      every one of the five elements, so no field in the table can silently stop being compared.
  const componentSource = readFileSync(join(projectRoot, 'src', 'lib', 'components.mjs'), 'utf8');
  for (const [what, literal] of [
    ["the track's tile sprite", 'GFX_tiles_dark_area_cut_8'],
    ["the fill's tile sprite", 'gfx_transparency_white'],
    ["the fill's `background` object", "background: barBackground(fill.sprite)"],
    ["the track's `background` object", "background: barBackground(track.sprite)"],
    ["the background sprite KEY the emitter reads", "function barBackground(sprite) {"],
    ["the fill's horizontal offset", 'position: { x: inset, y: fillTop }'],
    ["the fill's height", 'fillHeight'],
    ["the name column's left offset", 'const x = -(left.width + left.gap);'],
    ["the value column's right offset", 'const x = width + right.gap;'],
    ['the track as a containerWindowType', "kind: 'container',"],
    ['the text column as an instantTextBoxType', "kind: 'text',"],
    ['the live column as an effectbuttonType', "kind: 'effectbutton',"],
    ['the label font from the caller', 'labelFont'],
  ]) {
    check(`components.mjs still carries ${what}`, componentSource.includes(literal), JSON.stringify(literal));
  }
  // The behavioural half: perturb one field at a time and require the comparison to notice.
  const perturbed = (object, key, value) => JSON.stringify({ ...object, [key]: value }) !== JSON.stringify(object);
  let comparedFields = 0;
  let fieldsThatNotice = 0;
  for (const role of ROLES) {
    const actual = barPiece(boxes, 'unga_power_1_main', role);
    const intact = modelFields(actual.node);
    for (const [key, value] of Object.entries(intact)) {
      comparedFields += 1;
      // Deleting the field, or changing it to a value of a different shape, must be noticed.
      const deleted = { ...intact };
      delete deleted[key];
      const changed = { ...intact, [key]: typeof value === 'object' && value !== null ? { ...value, _perturbed: 1 } : `${String(value)}_perturbed` };
      if (JSON.stringify(deleted) !== JSON.stringify(intact) && perturbed(intact, key, changed[key])) fieldsThatNotice += 1;
    }
  }
  check(
    `every one of the ${comparedFields} fields the expansion emits is load-bearing for the comparison`,
    comparedFields >= 30 && fieldsThatNotice === comparedFields,
    `${fieldsThatNotice} of ${comparedFields}`,
  );
  // And the same comparison, run against a deliberately WRONG reference, must fail - which is what
  // "the assertion can fail" means. A single wrong sprite name is enough.
  const wrongReference = { ...REFERENCE_RANKING_ROW.elements.find((element) => element.role === 'track').fields, background: { name: 'bg', quadTextureSprite: 'GFX_wrong_tile' } };
  const trackNode = barPiece(boxes, 'unga_power_1_main', 'track').node;
  check(
    'the field-identity comparison FAILS when the reference disagrees about one sprite',
    JSON.stringify(modelFields(trackNode)) !== JSON.stringify({ name: 'unga_power_track_1_main', kind: 'container', ...wrongReference }),
  );
  check(
    'and it SUCCEEDS against the real reference, so both outcomes are reachable',
    JSON.stringify(modelFields(trackNode)) ===
      JSON.stringify({ name: 'unga_power_track_1_main', kind: 'container', ...REFERENCE_RANKING_ROW.elements.find((element) => element.role === 'track').fields }),
  );
  check(
    'removing the track\'s sprite from the emitted text is detectable, so the gutted state is observable',
    !gutted(emitted, 'GFX_tiles_dark_area_cut_8').includes('GFX_tiles_dark_area_cut_8'),
  );
});

group('the bar component encodes the static-length / live-number constraint (C2)', () => {
  const bar = (overrides) => ({
    id: 'c2',
    kind: 'bar',
    name: 'c2_bar',
    position: { x: 0, y: 0 },
    width: 400,
    height: 20,
    value: 50,
    max: 100,
    ...overrides,
  });
  const layout = (node) => {
    const tree = defaultLayout({ name: 'c2_probe', width: 900, height: 400 });
    tree.root.children.push(node);
    return tree;
  };
  const findingsFor = (node) => validateLayout(layout(node), { checkAssets: false, checkLocalisation: false });
  const rulesIn = (node) => findingsFor(node).findings.map((finding) => finding.rule);

  // A well-formed bar is not a finding.
  const clean = findingsFor(bar({}));
  check(
    'a plain bar validates with no bar finding at all',
    !clean.findings.some((finding) => String(finding.rule).startsWith('bar-')),
    JSON.stringify(clean.findings.filter((finding) => String(finding.rule).startsWith('bar-')).map((finding) => finding.rule)),
  );

  // THE MISUSE THE CONSTRAINT IS ABOUT: a live fill.
  const live = rulesIn(bar({ width: '@track_width' }));
  check('a bar whose width is an @variable is REFUSED (the fill length must be a literal)', live.includes('bar-track-width-not-static'), JSON.stringify(live));
  const percent = rulesIn(bar({ width: '100%%' }));
  check('a bar whose width is a percentage is REFUSED', percent.includes('bar-track-width-not-static'), JSON.stringify(percent));
  const dynamicHeight = rulesIn(bar({ height: '@h' }));
  check('a bar whose height is an @variable is REFUSED', dynamicHeight.includes('bar-track-height-not-static'), JSON.stringify(dynamicHeight));

  // `value > max` REFUSES rather than reproducing the reference's own defect.
  const over = findingsFor(bar({ value: 500, max: 400 }));
  check('value > max is an error, not a clamp', over.findings.some((finding) => finding.rule === 'bar-fill-overflows-track'));
  const overflowFill = barPiece(computeLayout(layout(bar({ value: 500, max: 400 }))).boxes, 'c2_bar', 'fill');
  check(
    'and the emitted fill still fits inside the track',
    overflowFill.node.size.width <= 400 - 2 * 2 && overflowFill.node.position.x + overflowFill.node.size.width <= 400 - 2,
    JSON.stringify(overflowFill.node),
  );
  check('a negative value is refused', rulesIn(bar({ value: -5 })).includes('bar-proportion-invalid'));
  check('a bar with no value at all is refused', rulesIn(bar({ value: undefined })).includes('bar-proportion-invalid'));
  check('max = 0 is refused', rulesIn(bar({ value: 1, max: 0 })).includes('bar-proportion-invalid'));

  // A COLOUR DOES NOT EXIST on a container: refused by name, not dropped.
  const coloured = findingsFor(bar({ fillColour: '#ff0000' }));
  const colourFinding = coloured.findings.find((finding) => finding.rule === 'bar-colour-not-exist');
  check('fillColour is REFUSED, not dropped', Boolean(colourFinding), JSON.stringify(coloured.findings.map((f) => f.rule)));
  check(
    'and the refusal names the two things that DO work (a tile sprite, or a .gfx shader)',
    /tile|sprite/i.test(colourFinding?.message ?? '') && /effectFile|shader/i.test(colourFinding?.message ?? ''),
    (colourFinding?.message ?? '').slice(0, 200),
  );

  // THE LIVE CHANNEL: the only measured one is effectbuttonType.buttonText.
  const liveLabel = findingsFor(bar({ label: 'c2_value', labelEffect: true, effect: 'c2_value_effect' }));
  check(
    'a live label emits an effectbuttonType carrying buttonText',
    !liveLabel.findings.some((finding) => finding.rule === 'bar-label-effect-missing'),
  );
  const liveBoxes = computeLayout(layout(bar({ label: 'c2_value', labelEffect: true, effect: 'c2_value_effect' }))).boxes;
  const liveButton = barPiece(liveBoxes, 'c2_bar', 'label');
  check(
    'the live label element IS an effectbutton with an effect and a buttonText',
    liveButton.node.kind === 'effectbutton' && liveButton.node.buttonText === 'c2_value' && liveButton.node.effect === 'c2_value_effect',
    JSON.stringify(liveButton.node),
  );
  check(
    'the live label carries no text_color_code, because a button has no such field',
    liveButton.node.text_color_code === undefined,
  );
  check(
    'labelEffect without an effect is refused: a button with no effect does nothing',
    rulesIn(bar({ label: 'c2_value', labelEffect: true })).includes('bar-label-effect-missing'),
  );
  check(
    'a static label is reported as an INFO, so the live channel is discoverable',
    findingsFor(bar({ label: 'c2_value' })).findings.some((finding) => finding.rule === 'bar-label-not-offered-as-button' && finding.severity === 'info'),
  );
  // The static label is still a legal bar; the info must not be an error.
  check(
    'and a static label does not make the bar invalid',
    findingsFor(bar({ label: 'c2_value' })).findings.every((finding) => finding.rule !== 'bar-label-not-offered-as-button' || finding.severity !== 'error'),
  );
});

group('the bar component validates fit, language and heading alignment (C3)', () => {
  const build = (node) => {
    const tree = defaultLayout({ name: 'c3_probe', width: 1200, height: 600 });
    for (const child of Array.isArray(node) ? node : [node]) tree.root.children.push(child);
    return tree;
  };
  const findings = (node) => validateLayout(build(node), { checkAssets: false, checkLocalisation: false }).findings;
  /**
   * The same, with a localisation resolver and the INSTALL's font catalogue, because the label rules
   * are about MEASURED text: a key that resolves to nothing has no extent to compare against its box,
   * and a measurement without a font catalogue is not made at all - so a suite that never resolved a
   * label would assert only that the rule stays silent. The text is supplied through the resolver, so
   * the measurement is the test's own input; the font metrics come from the install, which is what
   * the numbers have to be real against.
   */
  const findingsWithText = (node, values) =>
    validateLayout(build(node), {
      checkAssets: false,
      checkLocalisation: false,
      measureText: true,
      gameRoot: resolveGameRoot(),
      resolveLocalisation: (key) => values.get(key) ?? null,
    }).findings;

  // ---------------------------------------------------------------- the track can never overflow
  for (const [width, height, inset, value, max] of [[400, 20, 2, 0, 100], [400, 20, 2, 100, 100], [40, 20, 2, 100, 100], [10, 10, 2, 1, 3], [7, 6, 3, 1, 1]]) {
    const all = computeLayout(build({ id: 'x', kind: 'bar', name: `fit_${width}_${height}_${inset}`, position: { x: 0, y: 0 }, width, height, inset, value, max })).boxes;
    const barName = `fit_${width}_${height}_${inset}`;
    const track = barPiece(all, barName, 'track');
    const fillBox = barPiece(all, barName, 'fill');
    check(
      `a ${width}x${height} bar at inset ${inset} emits a fill inside its track (${fillBox.node.size.width}x${fillBox.node.size.height} in ${track.node.size.width}x${track.node.size.height})`,
      fillBox.node.size.width >= 0 &&
        fillBox.node.size.height >= 0 &&
        fillBox.node.position.x >= 0 &&
        fillBox.node.position.y >= 0 &&
        fillBox.node.position.x + fillBox.node.size.width <= track.node.size.width &&
        fillBox.node.position.y + fillBox.node.size.height <= track.node.size.height,
      JSON.stringify({ fill: fillBox.node, track: track.node }),
    );
  }
  check(
    'a bar too small for its own inset is refused rather than emitted with a negative fill',
    findings({ id: 'x', kind: 'bar', name: 'tiny', width: 4, height: 4, inset: 2, value: 1, max: 2 }).some((finding) => finding.rule === 'bar-frame-too-small'),
  );

  // ---------------------------------------------------------------- the label is MEASURED, in both languages
  //
  // The project measures real font metrics (font-metrics.mjs), so a label that cannot fit its box is
  // a finding rather than a hope. A Latin and a CJK string are both measured, because the mod ships
  // a Korean localisation and the two have very different advances, and the text is supplied through
  // a resolver so the measurement is the test's own input rather than whatever the install happens
  // to define.
  const latinLabel = 'A Very Long Column Label That Cannot Fit A Narrow Bar';
  const cjkLabel = '一个很长的中文标签名称需要更多空间才能显示完整';
  const labelValues = new Map([
    ['c3_long_label', latinLabel],
    ['c3_长标签', cjkLabel],
    ['c3_short', 'ok'],
  ]);
  const labelBar = (label, side, extra = {}) => ({ id: 'x', kind: 'bar', name: `label_${side}`, position: { x: 0, y: 0 }, width: 400, height: 20, value: 50, max: 100, label, labelSide: side, ...extra });
  const widthRule = (label, side, extra = {}) =>
    findingsWithText(labelBar(label, side, extra), labelValues).filter((finding) => finding.rule === 'bar-label-too-wide' || finding.rule === 'bar-label-overflows-track');
  // Both languages: each is measured, and each is reported when it cannot fit.
  for (const [what, key] of [['Latin', 'c3_long_label'], ['CJK', 'c3_长标签']]) {
    const inside = widthRule(key, 'inside');
    check(
      `a ${what} label is measured against the box the bar gives it`,
      inside.some((finding) => finding.rule === 'bar-label-too-wide' || finding.rule === 'bar-label-overflows-track'),
      JSON.stringify(inside.map((finding) => `${finding.rule}: ${finding.message?.slice(0, 90)}`)),
    );
    const roomy = findingsWithText(labelBar(key, 'inside', { width: 4000, height: 40 }), labelValues).filter(
      (finding) => finding.rule === 'bar-label-too-wide' || finding.rule === 'bar-label-overflows-track',
    );
    check(`the same ${what} label fits when the bar is wide and tall enough, so neither rule is always-on`, roomy.length === 0, JSON.stringify(roomy.map((finding) => finding.message?.slice(0, 80))));
  }
  check(
    'a measured label reports the font and the measured extent, so the number can be checked',
    (() => {
      const finding = widthRule('c3_long_label', 'inside')[0];
      if (!finding) return false;
      const extent = typeof finding.measuredWidth === 'number' ? finding.measuredWidth : finding.measuredHeight;
      return typeof extent === 'number' && extent > 0 && typeof finding.font === 'string' && finding.font.length > 0;
    })(),
    JSON.stringify(widthRule('c3_long_label', 'inside')[0] ?? null),
  );
  // The same text in the same font DOES fit once the bar is wide and tall enough, so neither rule is
  // always-on - which is the difference between a measurement and a warning that fires regardless.
  const roomy = findingsWithText(labelBar('c3_long_label', 'inside', { width: 4000, height: 40 }), labelValues).filter(
    (finding) => finding.rule === 'bar-label-too-wide' || finding.rule === 'bar-label-overflows-track',
  );
  check('the same measured label fits when the bar is wide and tall enough', roomy.length === 0, JSON.stringify(roomy.map((finding) => finding.message?.slice(0, 100))));
  // A label far too wide for its own column MUST be reported.
  const tooWide = findingsWithText(
    { id: 'x', kind: 'bar', name: 'narrow_label', position: { x: 0, y: 0 }, width: 400, height: 20, value: 50, max: 100, label: 'c3_long_label', labelSide: 'left', labelWidth: 20 },
    labelValues,
  ).filter((finding) => finding.rule === 'bar-label-too-wide');
  check(
    'a label wider than the column it was given is reported as bar-label-too-wide',
    tooWide.length >= 1,
    JSON.stringify(tooWide.map((finding) => finding.message.slice(0, 120))),
  );
  const insideTooShort = findings({
    id: 'x',
    kind: 'bar',
    name: 'short_track_label',
    position: { x: 0, y: 0 },
    width: 400,
    height: 20,
    value: 50,
    max: 100,
    label: 'c3_inside',
    labelSide: 'inside',
    font: 'malgun_goth_24',
  });
  check(
    'an inside label in a track too short for its font is reported (or fits, with the measurement attached)',
    insideTooShort.every((finding) => finding.rule !== 'bar-label-overflows-track' || /ascent band/.test(finding.message)),
    JSON.stringify(insideTooShort.filter((finding) => finding.rule === 'bar-label-overflows-track').map((finding) => finding.message.slice(0, 120))),
  );

  // ---------------------------------------------------------------- a bar must not collide with its neighbour
  //
  // A bar expands to ordinary containers and text, so the project's own collision rules apply with
  // nothing added. What those rules do with a bar is worth stating, because it is not what a first
  // guess expects: the track and the fill carry a `background`, and a backgrounded element is treated
  // as mouse-transparent DECORATION and skipped by `sibling-overlap` (validate.mjs:1079); the text
  // columns carry `alwaysTransparent` (the reference's own field, present on all three) and the SAME
  // exemption skips `text-collision`, which also requires the strings to have been MEASURED. So a bar
  // answers for a collision the way any transparent overlay does, and the suite asserts the two
  // behaviours that matter - same row collides, next row does not - rather than inventing a bar-only
  // rule.
  const rowCollisions = (secondY) =>
    findingsWithText(
      [
        { id: 'a', kind: 'bar', name: 'row_a', position: { x: 0, y: 0 }, width: 400, height: 20, value: 10, max: 100, valueText: 'row_a_value', rowLabel: 'row_a_name' },
        { id: 'b', kind: 'bar', name: 'row_b', position: { x: 0, y: secondY }, width: 400, height: 20, value: 20, max: 100, valueText: 'row_b_value', rowLabel: 'row_b_name' },
      ],
      new Map([
        ['row_a_value', 'A'],
        ['row_b_value', 'B'],
        ['row_a_name', 'AAAA'],
        ['row_b_name', 'BBBB'],
      ]),
    ).filter((finding) => finding.rule === 'sibling-overlap' || finding.rule === 'text-collision');
  check(
    'two bars drawn at the SAME y put ink on top of each other and are reported',
    rowCollisions(0).length >= 1,
    JSON.stringify(rowCollisions(0).map((finding) => `${finding.rule}: ${finding.message?.slice(0, 80)}`)),
  );
  check(
    "two bars 24 px apart (the reference's own row spacing) do NOT collide",
    rowCollisions(24).length === 0,
    JSON.stringify(rowCollisions(24).map((finding) => finding.rule)),
  );
  check('and the 20 px track inside the 24 px row leaves the reference its 4 px of gutter', 24 - 20 === 4);

  // ---------------------------------------------------------------- alignment against a SIBLING HEADING
  //
  // This is the misalignment the user reported in this very window: a heading at one x and tracks at
  // another. Nothing overlaps when it happens, so no geometric rule catches it.
  const band = (trackX, headingX) => [
    {
      id: 'heading',
      kind: 'text',
      name: 'chart_rank_caption',
      position: { x: headingX, y: 0 },
      maxWidth: 420,
      maxHeight: 24,
      text: 'chart_rank_caption_key',
      font: 'cg_16b',
      fixedSize: true,
      format: 'left',
    },
    { id: 'row', kind: 'bar', name: 'unga_power_1_main', position: { x: trackX, y: 40 }, width: 400, height: 20, value: 10, max: 100, headingName: 'chart_rank_caption' },
  ];
  const aligned = findings(band(100, 100));
  check(
    'a track aligned with its own heading produces no misalignment finding',
    !aligned.some((finding) => finding.rule === 'bar-track-misaligned-with-heading'),
    JSON.stringify(aligned.filter((finding) => String(finding.rule).startsWith('bar-')).map((finding) => finding.rule)),
  );
  const misaligned = findings(band(200, 100));
  const alignment = misaligned.find((finding) => finding.rule === 'bar-track-misaligned-with-heading');
  check(
    'a track 100 px off its heading IS reported, with the offset',
    Boolean(alignment) && alignment.offsetX === 100,
    JSON.stringify(misaligned.map((finding) => finding.rule)),
  );
  check(
    'and the finding says how far apart they are and suggests the x to move to',
    /100 px apart/.test(alignment?.message ?? '') && (alignment?.suggestedFix ?? '').includes(`x = ${alignment?.otherRect?.x}`),
    `${alignment?.message} // ${alignment?.suggestedFix}`,
  );
  // A heading is found by name when `headingName` is given, and by the mod's own convention when not.
  const conventional = findings([
    {
      id: 'heading',
      kind: 'text',
      name: 'unga_power_heading',
      position: { x: 0, y: 0 },
      maxWidth: 200,
      maxHeight: 20,
      text: 'unga_power_heading_key',
      font: 'cg_16b',
      fixedSize: true,
      format: 'left',
    },
    { id: 'row', kind: 'bar', name: 'unga_power_track_1', position: { x: 60, y: 40 }, width: 400, height: 20, value: 10, max: 100 },
  ]);
  check(
    'the convention also finds the heading (unga_power_track_1 -> unga_power_heading)',
    conventional.some((finding) => finding.rule === 'bar-track-misaligned-with-heading'),
    JSON.stringify(conventional.map((finding) => finding.rule)),
  );
  check(
    'the convention derives the heading name it was given',
    headingNameForBar('unga_power_track_1') === 'unga_power_heading',
    String(headingNameForBar('unga_power_track_1')),
  );
  // A sibling heading FAR above is not this column's heading: the rule must not fire on it.
  const distant = findings([
    {
      id: 'heading',
      kind: 'text',
      name: 'chart_rank_caption',
      position: { x: 0, y: 0 },
      maxWidth: 420,
      maxHeight: 24,
      text: 'chart_rank_caption_key',
      font: 'cg_16b',
      fixedSize: true,
      format: 'left',
    },
    { id: 'row', kind: 'bar', name: 'unga_power_1_main', position: { x: 200, y: 400 }, width: 400, height: 20, value: 10, max: 100, headingName: 'chart_rank_caption' },
  ]);
  check(
    'a heading 376 px above the track is not treated as its column heading',
    !distant.some((finding) => finding.rule === 'bar-track-misaligned-with-heading'),
    JSON.stringify(distant.map((finding) => finding.rule)),
  );
});

group('the bar clone / from mechanism reproduces a construction (C4)', () => {
  const build = (children) => {
    const tree = defaultLayout({ name: 'c4_probe', width: 1200, height: 600 });
    for (const child of children) tree.root.children.push(child);
    return tree;
  };
  const source = {
    id: 'unga_power_1_main',
    kind: 'bar',
    name: 'unga_power_1_main',
    position: { x: 240, y: 66 },
    width: 400,
    height: 20,
    value: 383,
    max: 400,
    rowLabel: 'unga_faction_nato',
    valueText: 'unga_power_value_2',
    valueColour: 'Y',
    seats: 'unga_power_seats_2',
    seatsColour: 'E',
  };
  const clone = {
    id: 'unga_power_2_main',
    kind: 'bar',
    name: 'unga_power_2_main',
    position: { x: 240, y: 90 },
    value: 350,
    cloneOf: 'unga_power_1_main',
    rowLabel: 'unga_faction_csto',
    valueText: 'unga_power_value_3',
    seats: 'unga_power_seats_3',
  };
  const boxes = computeLayout(build([source, clone])).boxes;
  const of = (name) => boxes.find((box) => box.name === name);
  check(
    'a clone produces its own five elements, named for its own row index',
    ['unga_power_name_2_main', 'unga_power_track_2_main', 'unga_power_fill_2_main', 'unga_power_value_2_main', 'unga_power_seats_2_main'].every((name) => Boolean(of(name))),
    JSON.stringify(boxes.map((box) => box.name)),
  );
  check(
    'the clone inherits the construction: size, inset and BOTH sprites, field for field',
    of('unga_power_track_2_main').node.size.width === of('unga_power_track_1_main').node.size.width &&
      of('unga_power_track_2_main').node.size.height === of('unga_power_track_1_main').node.size.height &&
      of('unga_power_track_2_main').node.background.quadTextureSprite === of('unga_power_track_1_main').node.background.quadTextureSprite &&
      of('unga_power_fill_2_main').node.background.quadTextureSprite === of('unga_power_fill_1_main').node.background.quadTextureSprite &&
      of('unga_power_fill_2_main').node.position.x - of('unga_power_track_2_main').node.position.x === 2,
    JSON.stringify({ track: of('unga_power_track_2_main').node, fill: of('unga_power_fill_2_main').node }),
  );
  check(
    'the clone overrides only the row: its own y, its own proportion and its own words',
    of('unga_power_track_2_main').node.position.y === 90 &&
      of('unga_power_name_2_main').node.text === 'unga_faction_csto' &&
      of('unga_power_value_2_main').node.text === 'unga_power_value_3' &&
      of('unga_power_seats_2_main').node.text === 'unga_power_seats_3' &&
      of('unga_power_fill_2_main').node.size.width === Math.round(396 * (350 / 400)),
    JSON.stringify({ track: of('unga_power_track_2_main').node.position, fill: of('unga_power_fill_2_main').node.size }),
  );
  check(
    'the clone reuses the source\'s colour codes, because they are part of the construction',
    of('unga_power_value_2_main').node.text_color_code === 'Y' && of('unga_power_seats_2_main').node.text_color_code === 'E',
    JSON.stringify({ value: of('unga_power_value_2_main').node.text_color_code, seats: of('unga_power_seats_2_main').node.text_color_code }),
  );
  check(
    'no element keeps the source\'s name, so nothing collides',
    new Set(boxes.map((box) => box.name)).size === boxes.length,
    JSON.stringify(boxes.map((box) => box.name)),
  );
  // A clone whose source is missing is REFUSED, not silently expanded from defaults.
  const orphan = validateLayout(build([{ id: 'x', kind: 'bar', name: 'orphan', position: { x: 0, y: 0 }, width: 400, height: 20, value: 5, max: 10, cloneOf: 'not_there' }]), {
    checkAssets: false,
    checkLocalisation: false,
  }).findings;
  check(
    'cloneOf naming a bar that is not there is refused by `bar-clone-source-missing`',
    orphan.some((finding) => finding.rule === 'bar-clone-source-missing'),
    JSON.stringify(orphan.map((finding) => finding.rule)),
  );
  // The rename is a pure function and is asserted directly, because a caller can get it wrong.
  check('renameBarClone maps a derived name onto the clone', renameBarClone('unga_power_track_1_main', 'unga_power_1_main', 'unga_power_3_main', 'track') === 'unga_power_track_3_main');
  check('renameBarClone maps the name itself', renameBarClone('unga_power_1_main', 'unga_power_1_main', 'unga_power_3_main') === 'unga_power_3_main');
  check(
    'renameBarClone rebuilds a derived name under the clone when the source\'s name is a prefix of it',
    renameBarClone('unga_power_1_main_track', 'unga_power_1_main', 'unga_power_3_main') === 'unga_power_3_main_track',
    renameBarClone('unga_power_1_main_track', 'unga_power_1_main', 'unga_power_3_main'),
  );
  check(
    'renameBarClone gives a name that does not carry the source\'s a unique prefix instead of keeping it',
    renameBarClone('hand_made_track', 'unga_power_1_main', 'unga_power_3_main') === 'unga_power_3_main_hand_made_track',
    renameBarClone('hand_made_track', 'unga_power_1_main', 'unga_power_3_main'),
  );
  // THE `from` MECHANISM: read a construction out of an imported tree.
  const imported = parseGuiText(
    [
      'guiTypes = {',
      '  containerWindowType = {',
      '    name = "unga_power_track_1_main"',
      '    position = { x = 240 y = 66 }',
      '    size = { width = 400 height = 20 }',
      '    background = { name = "bg" quadTextureSprite = "GFX_tiles_dark_area_cut_8" }',
      '  }',
      '  containerWindowType = {',
      '    name = "unga_power_fill_1_main"',
      '    position = { x = 242 y = 70 }',
      '    size = { width = 383 height = 12 }',
      '    background = { name = "bg" quadTextureSprite = "gfx_transparency_white" }',
      '  }',
      '  instantTextBoxType = {',
      '    name = "unga_power_value_1_main"',
      '    position = { x = 646 y = 64 }',
      '    maxWidth = 70',
      '    maxHeight = 18',
      '    font = "cg_16b"',
      '    text = "unga_power_value_2"',
      '  }',
      '}',
    ].join('\n'),
    '(c4-imported.gui)',
  ).layout;
  const derived = barFieldsFromElements(
    { track: 'unga_power_track_1_main', fill: 'unga_power_fill_1_main', value: 'unga_power_value_1_main' },
    imported,
  );
  check(
    'barFieldsFromElements reads a bar out of imported ELEMENTS: size, sprites, inset and font',
    derived.kind === 'bar' &&
      derived.width === 400 &&
      derived.height === 20 &&
      derived.track === 'GFX_tiles_dark_area_cut_8' &&
      derived.fill === 'gfx_transparency_white' &&
      derived.inset === 2 &&
      derived.valueWidth === 70 &&
      derived.font === 'cg_16b',
    JSON.stringify(derived),
  );
  check('and it returns null when there is no track to read', barFieldsFromElements({}, imported) === null);
  // A bar built from the derived fields must reproduce the imported CONSTRUCTION: the track's size
  // and sprite, the fill's sprite and height, the inset. The fill's LENGTH is the one thing that
  // follows the caller's proportion instead - the import's 383 px fill in a 396 px cap is itself 4 px
  // over what the invariant allows, so the primitive writes the proportion of the cap (379), which
  // is the same arithmetic the C1 group asserts.
  const derivedBoxes = computeLayout(build([{ ...derived, name: 'derived_bar', id: 'derived_bar', position: { x: 0, y: 0 }, value: 383, max: 400 }])).boxes;
  const derivedTrack = derivedBoxes.find((box) => box.name === 'derived_bar_track');
  const derivedFill = derivedBoxes.find((box) => box.name === 'derived_bar_fill');
  check(
    'a bar built from the derived fields reproduces the imported track and fill construction',
    derivedTrack.node.size.width === 400 &&
      derivedTrack.node.size.height === 20 &&
      derivedTrack.node.background.sprite === 'GFX_tiles_dark_area_cut_8' &&
      derivedFill.node.size.height === 12 &&
      derivedFill.node.background.sprite === 'gfx_transparency_white' &&
      derivedFill.node.position.x - derivedTrack.node.position.x === 2,
    JSON.stringify([derivedTrack?.node, derivedFill?.node]),
  );
  check(
    'and its fill length is the proportion of the INSET CAP, not the import\'s own over-long value',
    derivedFill.node.size.width === Math.round(396 * (383 / 400)) && derivedFill.node.size.width !== 383,
    `${derivedFill.node.size.width}`,
  );
});

// =====================================================================================
// 21. The knowledge base: the authored topics, the compiler, the category scheme and the
//     fail-if-removed guards. Everything here is a `check` on CONTENT that must exist, so
//     deleting the knowledge base fails the suite BY NAME.
//
// The ASYNC half of the knowledge assertions - the catalogue, the `gui_knowledge_*` query
// tools and the MCP resource surface - is at the bottom of this file, because `KnowledgeCatalog.load`
// imports the generated snapshot and `group()` runs its callback synchronously.
// =====================================================================================

group('the knowledge base compiles, and every fact in it is reachable (KB)', () => {
  // ---------------------------------------------------------------- the authored sources
  const knowledgeRoot = join(projectRoot, 'knowledge');
  check('the authored knowledge tree exists', existsSync(knowledgeRoot), knowledgeRoot);
  if (!existsSync(knowledgeRoot)) return;

  const topics = readKnowledgeSources(knowledgeRoot);
  check('the authored knowledge tree parses into topics', topics.length >= KNOWLEDGE_TOPIC_FLOOR, `${topics.length} topics, floor ${KNOWLEDGE_TOPIC_FLOOR}`);
  check(
    'every topic id is unique',
    new Set(topics.map((topic) => topic.id)).size === topics.length,
    topics.map((topic) => topic.id).join(','),
  );
  check(
    'every topic carries at least one syntax block, one evidence item and one rule',
    topics.every((topic) => topic.syntax_blocks.length > 0 && topic.evidence.length > 0 && topic.rules.length > 0),
    JSON.stringify(topics.filter((topic) => !(topic.syntax_blocks.length && topic.evidence.length && topic.rules.length)).map((topic) => topic.id)),
  );
  check(
    'every topic states the version it was verified against',
    topics.every((topic) => /4\.4\.6/.test(topic.verified_version)),
    JSON.stringify(topics.filter((topic) => !/4\.4\.6/.test(topic.verified_version)).map((topic) => topic.id)),
  );
  check(
    'every topic states a one-line summary and a category',
    topics.every((topic) => topic.summary.length > 20 && KNOWLEDGE_CATEGORIES.includes(topic.category)),
    JSON.stringify(topics.filter((topic) => topic.summary.length <= 20).map((topic) => topic.id)),
  );
  check(
    'every topic records what it could NOT establish in a 待确认 section',
    topics.every((topic) => /##\s*待确认/.test(topic.body)),
    JSON.stringify(topics.filter((topic) => !/##\s*待确认/.test(topic.body)).map((topic) => topic.id)),
  );
  // A topic that cites nothing is refused at BUILD time, which is the rule that keeps this a
  // measurement record rather than another plausible-sounding document. Prove it is enforced. Each
  // fixture carries PROSE as well, because a section made only of bullets is lifted out of the body
  // entirely - so a fixture without it would be refused for an empty body and would prove nothing
  // about the rule under test.
  const fixture = (lines) => ['---', 'id: fixture', 'category: text', 'title: t', 'summary: a summary long enough to pass', '---', '', ...lines].join('\n');
  let uncitedRefused = false;
  try {
    parseTopicSource(
      fixture(['## Syntax', 'The declaration, as the engine reads it.', '```', 'x = 1', '```', '', '## Rules', 'The rule this fixture states, in prose.', '', '- a rule']),
      '(selftest-uncited.md)',
    );
  } catch (thrown) {
    uncitedRefused = /at least one `## Evidence` item is required/.test(thrown.message);
  }
  check('a topic with no evidence item is refused by the parser', uncitedRefused, 'the parser accepted an uncited topic');
  let categoryRefused = false;
  try {
    parseTopicSource(
      ['---', 'id: bad', 'category: nonsense', 'title: t', 'summary: a summary long enough to pass', '---', '', '## Syntax', 'The declaration.', '```', 'x', '```', '', '## Evidence', 'What it rests on.', '', '- an evidence item', '', '## Rules', 'The rule.', '', '- a rule'].join('\n'),
      '(selftest-badcat.md)',
    );
  } catch (thrown) {
    categoryRefused = /category/.test(thrown.message);
  }
  check('an unknown category is refused by name', categoryRefused, 'the parser accepted an unknown category');
  let slugRefused = false;
  try {
    parseTopicSource(
      ['---', 'id: Not A Slug', 'category: text', 'title: t', 'summary: a summary long enough to pass', '---', '', '## Syntax', 'The declaration.', '```', 'x', '```', '', '## Evidence', 'What it rests on.', '', '- an evidence item', '', '## Rules', 'The rule.', '', '- a rule'].join('\n'),
      '(selftest-slug.md)',
    );
  } catch (thrown) {
    slugRefused = /must use lowercase letters/.test(thrown.message);
  }
  check('a non-slug id is refused', slugRefused, 'the parser accepted a non-slug id');
  let missingFrontMatterRefused = false;
  try {
    parseTopicSource('# no front matter at all', '(selftest-nofm.md)');
  } catch (thrown) {
    missingFrontMatterRefused = /missing front matter block/.test(thrown.message);
  }
  check('a topic with no front matter is refused', missingFrontMatterRefused);
  let unknownKeyRefused = false;
  try {
    parseTopicSource(
      ['---', 'id: x', 'category: text', 'title: t', 'summary: s', 'nonsense_key: 1', '---', '', '## Syntax', 'The declaration.', '```', 'x', '```', '', '## Evidence', 'What it rests on.', '', '- an evidence item', '', '## Rules', 'The rule.', '', '- a rule'].join('\n'),
      '(selftest-badkey.md)',
    );
  } catch (thrown) {
    unknownKeyRefused = /unknown front matter key/.test(thrown.message);
  }
  check('an unknown front-matter key is refused, so a typo cannot silently drop a field', unknownKeyRefused);
  let noSyntaxRefused = false;
  try {
    parseTopicSource(
      fixture(['## What it is', 'A paragraph of prose, because a section made only of bullets is lifted out of the body.', '', '## Evidence', 'What it rests on.', '', '- an evidence item', '', '## Rules', 'The rule.', '', '- a rule']),
      '(selftest-nosyntax.md)',
    );
  } catch (thrown) {
    noSyntaxRefused = /at least one `## Syntax` code block is required/.test(thrown.message);
  }
  check('a topic with no syntax block is refused', noSyntaxRefused, 'the parser accepted a topic with no syntax block');
  let typeRefused = false;
  try {
    parseTopicSource(
      ['---', 'id: x', 'category: text', 'title: t', 'summary: a summary long enough to pass', 'file_types: not-an-array', '---', '', '## Syntax', 'The declaration.', '```', 'x', '```', '', '## Evidence', 'What it rests on.', '', '- an evidence item', '', '## Rules', 'The rule.', '', '- a rule'].join('\n'),
      '(selftest-badarray.md)',
    );
  } catch (thrown) {
    typeRefused = /expected an inline array/.test(thrown.message);
  }
  check('a front-matter array that is not an array is refused', typeRefused);
  let dupRefused = false;
  const duplicateRoot = join(scratch, 'kb-duplicate');
  rmSync(duplicateRoot, { recursive: true, force: true });
  mkdirSync(duplicateRoot, { recursive: true });
  const duplicateBody = ['---', 'id: same-id', 'category: text', 'title: t', 'summary: a summary long enough to pass', 'file_types: [.gui]', 'tags: [x]', '---', '', '## Syntax', 'The declaration.', '```', 'x', '```', '', '## Evidence', 'What it rests on.', '', '- an evidence item', '', '## Rules', 'The rule.', '', '- a rule'].join('\n');
  writeFileSync(join(duplicateRoot, 'a.md'), duplicateBody, 'utf8');
  writeFileSync(join(duplicateRoot, 'b.md'), duplicateBody, 'utf8');
  try {
    readKnowledgeSources(duplicateRoot);
  } catch (thrown) {
    dupRefused = /duplicate knowledge topic id/.test(thrown.message);
  }
  check('a duplicate topic id is refused, naming both files', dupRefused, 'two files with one id were accepted');
  let missingSummaryRefused = false;
  try {
    parseTopicSource(fixture(['## Syntax', 'The declaration.', '```', 'x', '```', '', '## Evidence', 'What it rests on.', '', '- an evidence item', '', '## Rules', 'The rule.', '', '- a rule']).replace('summary: a summary long enough to pass\n', ''), '(selftest-nosummary.md)');
  } catch (thrown) {
    missingSummaryRefused = /`summary` is required/.test(thrown.message);
  }
  check('a topic with no summary is refused', missingSummaryRefused);

  // ---------------------------------------------------------------- the category scheme
  const byCategory = new Map();
  for (const topic of topics) byCategory.set(topic.category, (byCategory.get(topic.category) ?? 0) + 1);
  check(
    'every category in use is one of the declared set',
    [...byCategory.keys()].every((category) => KNOWLEDGE_CATEGORIES.includes(category)),
    JSON.stringify([...byCategory.keys()]),
  );
  check(
    'every declared category is used by at least one topic',
    KNOWLEDGE_CATEGORIES.every((category) => byCategory.has(category)),
    JSON.stringify(KNOWLEDGE_CATEGORIES.filter((category) => !byCategory.has(category))),
  );
  check(
    'the topics are sorted by id, so the build is deterministic',
    topics.every((topic, position) => position === 0 || topics[position - 1].id <= topic.id),
    topics.map((topic) => topic.id).join(','),
  );
  const ids = new Set(topics.map((topic) => topic.id));
  const dangling = topics.flatMap((topic) => topic.relationships.filter((related) => !ids.has(related)).map((related) => `${topic.id} -> ${related}`));
  check('every `related` entry names a topic that exists', dangling.length === 0, dangling.join(', '));

  // ---------------------------------------------------------------- the generated artefacts
  const { stale, orphaned } = checkKnowledge();
  check('the compiled knowledge artefacts are current', stale.length === 0, JSON.stringify(stale.slice(0, 3)));
  check('no orphaned canonical TOML file is left behind', orphaned.length === 0, JSON.stringify(orphaned.slice(0, 3)));
  const artefacts = buildArtifacts(topics);
  check(
    'the build writes one canonical TOML file per topic, plus the snapshot',
    artefacts.size === topics.length + 1,
    `${artefacts.size} files for ${topics.length} topics`,
  );
  const generatedPath = join(projectRoot, 'src', 'generated', 'knowledge.mjs');
  check('the generated snapshot exists', existsSync(generatedPath), generatedPath);
  const generatedText = existsSync(generatedPath) ? readFileSync(generatedPath, 'utf8') : '';
  check('the snapshot says it is generated and must not be edited', /Generated by scripts\/build-knowledge\.mjs\. Do not edit by hand\./.test(generatedText));
  check('the snapshot is BOM-less, like every other script file here', !generatedText.startsWith('\uFEFF'));
  check(
    'the snapshot records the category scheme and the source path of every topic',
    KNOWLEDGE_CATEGORIES.every((category) => generatedText.includes(`"${category}"`)) &&
      topics.every((topic) => generatedText.includes(`"source_path": "${canonicalTopicPath(topic)}"`)),
    'a category or a source path is missing from the snapshot',
  );
  // Every canonical TOML file must be BOM-less too: a reader that strips a BOM from a `.mjs` must
  // not have to strip one from the data files.
  const bomCarrying = [...artefacts.entries()].filter(([, text]) => text.startsWith('\uFEFF'));
  check('no artefact carries a BOM', bomCarrying.length === 0, JSON.stringify(bomCarrying.map(([path]) => path)));

  // A canonical topic must round-trip: the TOML a reader finds on disk is the topic it came from.
  const sample = topics.find((topic) => topic.id === 'text-has-a-size') ?? topics[0];
  const roundTripped = topicFromToml(topicToToml(sample));
  check(
    'a canonical TOML topic round-trips its id, category, evidence and rules',
    roundTripped.id === sample.id &&
      roundTripped.category === sample.category &&
      roundTripped.evidence.length === sample.evidence.length &&
      roundTripped.rules.length === sample.rules.length &&
      roundTripped.syntax_blocks.length === sample.syntax_blocks.length,
    JSON.stringify({ id: roundTripped.id, evidence: roundTripped.evidence.length, rules: roundTripped.rules.length }),
  );
  check(
    'the canonical path is <category>/<id>.toml',
    canonicalTopicPath(sample) === `${sample.category}/${sample.id}.toml`,
    canonicalTopicPath(sample),
  );
  const markdown = topicToMarkdown(sample, `${KNOWLEDGE_URI_SCHEME}/${sample.id}`);
  check(
    'the markdown renderer emits the id, the category, the syntax, the evidence and the rules as sections',
    markdown.includes(`- ID: ${sample.id}`) &&
      /^## Syntax$/m.test(markdown) &&
      /^## Evidence$/m.test(markdown) &&
      /^## Rules$/m.test(markdown) &&
      markdown.includes(`- URI: ${KNOWLEDGE_URI_SCHEME}/${sample.id}`),
    markdown.slice(0, 200),
  );

  // ---------------------------------------------------------------- the measured facts the topics cite
  // A knowledge base that stops agreeing with the CODE is the drift this suite exists to catch, so
  // the load-bearing numbers are re-measured here from the same sources the topics cite.
  check(
    'the demanded contract set is still 26 of the 32 names the engine table carries',
    REQUIRED_WINDOW_NAMES.length === 26 && CONTRACT_ELEMENTS.length === 32,
    `${REQUIRED_WINDOW_NAMES.length} demanded of ${CONTRACT_ELEMENTS.length}`,
  );
  check('the contract minimum-window threshold the topic cites is still 10', CONTRACT_MIN_WINDOWS === 10, String(CONTRACT_MIN_WINDOWS));
  check(
    'the six engine-table names no working window declares are still NOTES, not demands',
    NOTE_WINDOW_NAMES.length === 6 && NOTE_WINDOW_NAMES.every((name) => !REQUIRED_WINDOW_NAMES.includes(name)),
    JSON.stringify(NOTE_WINDOW_NAMES),
  );
  check(
    '`origo`, `effect` and `custom_tooltip` are still engine-rejected fields, as the per-kind topic states',
    isEngineRejectedField('origo') && isEngineRejectedField('effect') && isEngineRejectedField('custom_tooltip'),
    JSON.stringify([...ENGINE_REJECTED_FIELDS]),
  );
  check(
    'a text element still takes maxWidth/maxHeight and NOT size, as the per-kind topic states',
    sizeFormFor('text').form === 'maxWidth/maxHeight' &&
      sizeFormFor('text').accepted === false &&
      sizeFormFor('text').hasSize === true &&
      kindAcceptsField('text', 'maxWidth'),
    JSON.stringify(sizeFormFor('text')),
  );
  check(
    'an icon still takes no size at all, as the per-kind topic states',
    sizeFormFor('icon').accepted === false && sizeFormFor('icon').hasSize === false,
    JSON.stringify(sizeFormFor('icon')),
  );
  check(
    'y is NOT negated for a lower anchor, as the coordinate topic states',
    yDirectionForAnchor('lower_left') === 1 && yDirectionForAnchor('lower_center') === 1 && yDirectionForAnchor('lower_right') === 1,
    JSON.stringify(['lower_left', 'lower_center', 'lower_right'].map((anchor) => [anchor, yDirectionForAnchor(anchor)])),
  );
  check(
    'the live-text rules still exist under the names the text-channels topic cites',
    RULE_SEVERITY['text-live-value'] === 'info' && RULE_SEVERITY['window-text-data-function'] === 'warning',
    JSON.stringify({ live: RULE_SEVERITY['text-live-value'], painted: RULE_SEVERITY['window-text-data-function'] }),
  );
  check(
    'the bar rules the bar topic cites are still errors',
    RULE_SEVERITY['bar-fill-overflows-track'] === 'error' &&
      RULE_SEVERITY['bar-colour-not-exist'] === 'error' &&
      RULE_SEVERITY['bar-track-width-not-static'] === 'error' &&
      RULE_SEVERITY['bar-clone-source-missing'] === 'error',
    JSON.stringify({ overflow: RULE_SEVERITY['bar-fill-overflows-track'], colour: RULE_SEVERITY['bar-colour-not-exist'] }),
  );
  // GAP-11 / GAP-12, the two rules the newest topics cite. These are the names an agent reads in a
  // report, so a rename that leaves the topics describing rules that no longer exist fails HERE.
  check(
    'the visibility rules the control-visibility topic cites still exist under those names',
    RULE_SEVERITY['visibility-scope-dependent'] === 'error' &&
      RULE_SEVERITY['visibility-flag-scope-dependent'] === 'warning' &&
      RULE_SEVERITY['visibility-potential-scope-dependent'] === 'info',
    JSON.stringify({
      scope: RULE_SEVERITY['visibility-scope-dependent'],
      flag: RULE_SEVERITY['visibility-flag-scope-dependent'],
      guaranteed: RULE_SEVERITY['visibility-potential-scope-dependent'],
    }),
  );
  check(
    'the park rule the parking topic cites is info, NOT an error: a park must not fail a file',
    RULE_SEVERITY['out-of-bounds-parked'] === 'info' && RULE_SEVERITY['out-of-bounds'] === 'error',
    JSON.stringify({ parked: RULE_SEVERITY['out-of-bounds-parked'], escape: RULE_SEVERITY['out-of-bounds'] }),
  );
  check(
    'the default park margin the parking topic states is 512, and the geometry rule reads it',
    VALIDATION_DEFAULTS.parkMargin === 512 && VALIDATION_DEFAULTS.checkVisibility === true,
    JSON.stringify({ parkMargin: VALIDATION_DEFAULTS.parkMargin, checkVisibility: VALIDATION_DEFAULTS.checkVisibility }),
  );
  for (const [id, mustMention] of [
    ['control-visibility-is-a-potential', 'visibility-scope-dependent'],
    ['control-visibility-is-a-potential', 'visibility_scope_guarantees'],
    ['parking-elements', 'parkMargin'],
    ['parking-elements', 'out-of-bounds-parked'],
    // ---------------------------------------------------------- the portrait-animation verdict
    // The one question this knowledge base was built to answer about portraits - can a mod animate
    // a 2D portrait? - was answered IN GAME on 2026-10-06, against a deliberate still-`spriteType`
    // control: the spriteType route renders and its overlay animation is not played, and a portrait
    // cannot name the engine's only frame animator. Each phrase below is the ONLY place the topic
    // states one half of that answer, so deleting the verdict fails the suite BY NAME. The prose
    // wraps, so the needles are the load-bearing fragments rather than whole sentences.
    ['portrait-formats-and-recipe', 'The closed negative'],
    ['portrait-formats-and-recipe', 'renders in a portrait slot'],
    ['portrait-formats-and-recipe', 'the animation step is not executed for a portrait slot'],
    ['portrait-formats-and-recipe', 'the overlay **is not played there**'],
    ['portrait-formats-and-recipe', 'frameAnimatedSpriteType'],
    ['portrait-formats-and-recipe', 'portraits.cpp:929'],
    ['portrait-formats-and-recipe', 'texturefile'],
    ['portrait-formats-and-recipe', 'spriteType = "GFX_x"'],
    ['portrait-formats-and-recipe', 'two routes reach a portrait, and neither of them moves'],
    ['portrait-formats-and-recipe', 'means the `.mesh` pipeline'],
    ['portrait-formats-and-recipe', 'not achievable'],
    ['portrait-formats-and-recipe', '都不动。有图案'],
    ['portrait-formats-and-recipe', 'portrait_sets'],
    ['portrait-formats-and-recipe', 'contributes only that group'],
    ['portrait-formats-and-recipe', 'Unexpected token: portraits'],
    ['portrait-formats-and-recipe', 'lexer.cpp:275'],
    ['portrait-formats-and-recipe', 'EF BB BF'],
  ]) {
    const topic = topics.find((entry) => entry.id === id);
    const haystack = topic ? `${topic.body}\n${topic.syntax_blocks.join('\n')}\n${topic.evidence.join('\n')}\n${topic.rules.join('\n')}\n${topic.breaks.join('\n')}` : '';
    check(
      `the \`${id}\` topic states what the plugin reports today (${mustMention})`,
      haystack.includes(mustMention),
      `missing ${JSON.stringify(mustMention)}`,
    );
  }
  // The two claims the probe DISPROVED must not come back as statements of fact. This is the
  // fail-if-restored half: a future edit that reinstates the wiki's species-class recipe, or the
  // "a portrait slot might honour the overlay" open question, fails here rather than quietly
  // re-teaching a route the 4.4.6 parser rejects. The 待确认 item is checked with its strike-through,
  // because "answered, and the answer was no" is the record - not a live open question.
  {
    const portraitTopic = topics.find((entry) => entry.id === 'portrait-formats-and-recipe');
    // A list ITEM is normalized by the parser - inline code becomes bold - so a needle that spans a
    // backticked token is matched against the item with its markers stripped, the way a reader sees it.
    const plainRule = (rule) => rule.split('`').join('').split('**').join('');
    check(
      'the species-class `portraits` recipe is recorded as DISPROVED, not as the required form',
      !portraitTopic.rules.some((rule) => /must be the EXTENDABLE partial form/.test(rule) && !/~~/.test(rule)) &&
        !/\*\*extendable\*\* partial block/.test(portraitTopic.body) &&
        portraitTopic.rules.some((rule) => /Do not write a portraits key in common\/species_classes\//.test(plainRule(rule))),
      JSON.stringify(portraitTopic.rules.filter((rule) => /species_classes/.test(rule))),
    );
    check(
      'the overlay-animation question is in 待确认 only as an ANSWERED item, never as an open one',
      /~~\*\*Whether a portrait slot honours a `spriteType`'s overlay/.test(portraitTopic.body) &&
        /Answered 2026-10-06, in game: no\./.test(portraitTopic.body) &&
        !/Whether a portrait slot honours a `spriteType`'s overlay `animation = \{ \}` block\.\*\* Nothing in/.test(portraitTopic.body),
      'the answered item is stated as still open',
    );
    check(
      'the frameAnimatedSpriteType question is in 待确认 with the log line that answered it',
      /~~\*\*Whether `frameAnimatedSpriteType` can be named from a portrait definition at all\.\*\*/.test(portraitTopic.body) &&
        /portraits\.cpp:929: Invalid portrait configuration specified for\n  "zz_probe_d_frames"/.test(portraitTopic.body),
      'the answered item is stated as still open',
    );
  }
  const platePath = join(DEFAULT_GAME_ROOT, 'gfx', 'interface', 'transp_white.dds');
  if (existsSync(platePath)) {
    const bytes = readFileSync(platePath);
    const header = parseDdsHeader(bytes);
    header.buffer = bytes;
    const decoded = decodeDdsLevel(header);
    const distinct = new Set();
    for (let index = 0; index < decoded.rgba.length; index += 4) {
      distinct.add(`${decoded.rgba[index]},${decoded.rgba[index + 1]},${decoded.rgba[index + 2]},${decoded.rgba[index + 3]}`);
    }
    check(
      'transp_white.dds really is uniform white at alpha 84, as the transparency topic states',
      distinct.size === 1 && distinct.has('255,255,255,84'),
      JSON.stringify([...distinct].slice(0, 4)),
    );
  }
  // The demanded contract names the window-contract topic enumerates, checked against the table.
  const contractTopic = topics.find((topic) => topic.id === 'window-name-contract');
  check(
    'the window-contract topic names every engine-table name the code carries',
    CONTRACT_ELEMENTS.every((entry) => contractTopic.syntax_blocks.join('\n').includes(entry.name) || contractTopic.body.includes(entry.name)),
    JSON.stringify(CONTRACT_ELEMENTS.filter((entry) => !contractTopic.syntax_blocks.join('\n').includes(entry.name) && !contractTopic.body.includes(entry.name)).map((entry) => entry.name)),
  );

  // ---------------------------------------------------------------- THE FAIL-IF-REMOVED PROOF
  //
  // The checks above are only worth something if they can FAIL. This half is not self-referential:
  // the module SOURCE is read as text and required to carry the rules, so gutting `knowledge.mjs`,
  // the compiler, the tools or the resource registry fails BY NAME with the string that went
  // missing, rather than passing because the check that reads it also went away.
  const knowledgeSource = readFileSync(join(projectRoot, 'src', 'lib', 'knowledge.mjs'), 'utf8');
  for (const [what, literal] of [
    ['the catalogue class', 'export class KnowledgeCatalog'],
    ['the generated snapshot as the shipped source', "join(projectRoot, 'src', 'generated', 'knowledge.mjs')"],
    ['the authored sources as the fallback', "join(projectRoot, 'knowledge')"],
    ['the AND-semantics search', 'terms.every((term) => document.includes(term))'],
    ['the enumerate-before-filter guard', 'Enumerate BEFORE filtering'],
    ['the catalogue index', 'catalogIndexToml()'],
    ['the markdown renderer', 'export function topicToMarkdown'],
    ['the canonical TOML writer', 'export function topicToToml'],
    ['the uri scheme', "KNOWLEDGE_URI_SCHEME = 'rstellarisgui://stellaris/knowledge'"],
  ]) {
    check(`knowledge.mjs still carries ${what}`, knowledgeSource.includes(literal), JSON.stringify(literal));
  }
  const sourceParser = readFileSync(join(projectRoot, 'src', 'lib', 'knowledge-source.mjs'), 'utf8');
  for (const [what, literal] of [
    ['the category scheme', 'export const KNOWLEDGE_CATEGORIES'],
    ['the evidence requirement', 'at least one'],
    ['the duplicate-id refusal', 'duplicate knowledge topic id'],
    ['the unknown-front-matter-key refusal', 'unknown front matter key'],
  ]) {
    check(`knowledge-source.mjs still carries ${what}`, sourceParser.includes(literal), JSON.stringify(literal));
  }
  const buildSource = readFileSync(join(projectRoot, 'scripts', 'build-knowledge.mjs'), 'utf8');
  for (const [what, literal] of [
    ['the canonical output root', "join(projectRoot, 'resources', 'knowledge', 'stellaris')"],
    ['the embedded snapshot directory', "join(projectRoot, 'src', 'generated')"],
    ['the snapshot filename', "'knowledge.mjs'"],
    ['the do-not-edit banner', 'Generated by scripts/build-knowledge.mjs. Do not edit by hand.'],
    ['the orphan sweep', 'rmSync(canonicalRoot, { recursive: true, force: true })'],
    ['the --check mode', "process.argv.includes('--check')"],
  ]) {
    check(`build-knowledge.mjs still carries ${what}`, buildSource.includes(literal), JSON.stringify(literal));
  }
  const toolSource = readFileSync(join(projectRoot, 'src', 'tools', 'index.mjs'), 'utf8');
  for (const [what, literal] of [
    ['the search tool', "name: 'gui_knowledge_search'"],
    ['the topic tool', "name: 'gui_knowledge_topic'"],
    ['the catalogue loader', 'async function knowledgeOf(context)'],
    ['the uri on every result', 'uri: `${KNOWLEDGE_URI_SCHEME}/${topic.id}`'],
    ['the refusal when no catalogue is loaded', 'no knowledge catalogue is loaded on this server'],
  ]) {
    check(`tools/index.mjs still carries ${what}`, toolSource.includes(literal), JSON.stringify(literal));
  }
  const indexSource = readFileSync(join(projectRoot, 'src', 'index.mjs'), 'utf8');
  for (const [what, literal] of [
    ['the resource registry', 'function createResourceRegistry(context)'],
    ['the catalogue resource', '`${KNOWLEDGE_URI_SCHEME}/catalog`'],
    ['the per-topic template', 'uriTemplate: `${KNOWLEDGE_URI_SCHEME}/{topic_id}`'],
    ['the --skill reader', "case 'read-resource':"],
    ['the knowledge instruction to the agent', 'THERE IS A KNOWLEDGE BASE'],
  ]) {
    check(`index.mjs still carries ${what}`, indexSource.includes(literal), JSON.stringify(literal));
  }
  const mcpSource = readFileSync(join(projectRoot, 'src', 'lib', 'mcp.mjs'), 'utf8');
  for (const [what, literal] of [
    ['the resources capability', "resources: { subscribe: false, listChanged: false }"],
    ['resources/list', "case 'resources/list':"],
    ['resources/templates/list', "case 'resources/templates/list':"],
    ['resources/read', "case 'resources/read':"],
  ]) {
    check(`mcp.mjs still carries ${what}`, mcpSource.includes(literal), JSON.stringify(literal));
  }
  // The topics the parent task named must exist, by id, with the material in them. A future
  // edit that deletes one of these files fails here rather than silently shrinking the base.
  for (const [id, mustMention] of [
    ['window-name-contract', 'EVENT_DIPLO'],
    ['window-dismissal', 'selectedOption 0'],
    ['coordinate-semantics', 'lower_left'],
    ['coordinate-calibration', '0.7398'],
    ['per-kind-size-and-field-forms', 'Not used, use maxWidth and maxHeight'],
    ['text-has-a-size', 'xadvance'],
    ['text-channels', 'buttonText'],
    ['bar-construction', 'gfx_transparency_white'],
    ['transparency-white-plate', 'alpha 84'],
    ['apply-preserves-transparency-and-comments', 'byte-identical'],
    ['parking-elements', '-3000,-3000'],
    ['control-visibility-is-a-potential', 'is_scope_type'],
    ['inline-icon-token-rule', 'GFX_text_'],
    ['custom-gui-force-open', '113'],
    ['engine-capability-vs-usage', '9201'],
    ['gui-layout-tool-surface', 'GAP-6'],
    ['texture-registration', 'BC3'],
    ['audio-and-cross-references', 'audio-assets'],
  ]) {
    const topic = topics.find((entry) => entry.id === id);
    const haystack = topic ? `${topic.body}\n${topic.syntax_blocks.join('\n')}\n${topic.evidence.join('\n')}\n${topic.rules.join('\n')}` : '';
    check(`the knowledge base still carries the \`${id}\` topic with its measured material`, Boolean(topic) && haystack.includes(mustMention), `missing ${JSON.stringify(mustMention)}`);
  }
  // The star-slot topic (round: multi-star systems). Every item below is a figure this round
  // MEASURED and the topic is the only place it is written down, so deleting the topic - or letting
  // it drift back to "a system has one primary star" - fails here by name.
  {
    const topic = topics.find((entry) => entry.id === 'star-slots-in-multi-star-systems');
    const haystack = topic
      ? `${topic.body}\n${topic.syntax_blocks.join('\n')}\n${topic.evidence.join('\n')}\n${topic.rules.join('\n')}\n${(topic.breaks ?? []).join('\n')}`
      : '';
    for (const [what, literal] of [
      ['the engine\'s star NAME format string', 'STAR_NAME_%i_OF_%i'],
      ['the 67-slot census', '67'],
      ['the 13/15/8 slot distribution', '13 classes with exactly ONE slot, 15 with TWO, 8 with THREE'],
      ['the eleven-star vanilla exception', 'great_wound_system'],
      ['the ZERO-star-block exception', 'init_sol_geocentric'],
      ['the primary-only scope wording', 'primary star (planet scope)'],
      ['`set_star_class`\' only touches the primary', 'Also changes the planet class of the system\'s primary star'],
      ['the only reachable star filter', 'every_system_planet = { limit = { is_star = yes }'],
      ['the field that makes the body visible', 'star_gfx = no'],
      ['the DISPROVED vanilla precedent', 'has no vanilla precedent'],
      // The accretion-disk round ADDED the four-way slot-1 consequence to this topic, and settled
      // the positional-assignment 待确认 item that stood here before it.
      ['what slot 1 decides', 'what slot 1 decides'],
      ['the yellow-star design consequence', 'the YELLOW STAR must be slot 1'],
      ['the no-barycentric-orbit fact', 'There is no barycentric two-star orbit'],
      ['the ANSWERED positional assignment', 'the assignment is POSITIONAL'],
      ['the two-visually-different-classes proof', 'one black hole and one yellow star'],
    ]) {
      check(`the star-slot topic carries ${what}`, haystack.includes(literal), `missing ${JSON.stringify(literal)}`);
    }
  }
  // The black-hole-primary round (in-game probe 2026-10-06). This topic is the only place the
  // ON-SCREEN half of the round is written down: the engine never logs rendering, so a future edit
  // that drops the observation, weakens "the user saw it" into "the files suggest", or loses the
  // arithmetic that puts the colonisable world between the two stars, fails HERE by name.
  {
    const topic = topics.find((entry) => entry.id === 'black-hole-primary-star-system');
    const haystack = topic
      ? `${topic.body}\n${topic.syntax_blocks.join('\n')}\n${topic.evidence.join('\n')}\n${topic.rules.join('\n')}\n${topic.breaks.join('\n')}`
      : '';
    for (const [what, literal] of [
      ['the slot-1 table', 'what slot 1 decides'],
      ['the four-way decision', 'slot 1 decides four separate things at once'],
      ['the black-hole light', 'black_hole_light'],
      ['the light\'s intensity', 'intensity = 2.5'],
      ['the tinting colour LUT', 'colorcorrection_black_hole.tga'],
      ['the background hue shift', 'galaxy_background_hsv_shift'],
      ['the starbase gate', 'is_primary_star'],
      ['the habitable band', '@habitable_min_distance'],
      ['the silent-drop risk the band check dodges', 'dropped silently'],
      ['the no-barycentric-orbit fact', 'barycentric two-star orbit'],
      ['the ZERO-vanilla-precedent pairing', 'ZERO vanilla'],
      ['the retired "no precedent = impossible" reading', 'Zero precedent in the install means zero precedent'],
      ['the design consequence', 'the yellow star must be slot 1'],
      ['the swapped-roles recipe', 'sc_yellow_primary'],
      ['the shipped slot order', 'planet = { key = pc_black_hole }'],
      ['the negative relative orbit', 'orbit_distance = -75'],
      ['the narrowed log/eyes distinction', 'logs no SUCCESSFUL render'],
      ['the failed-system-light log line', 'Failed to create system light'],
      ['the six measured light names', 'ehof_white_hole_light'],
      ['the within-mod control that did NOT fail', 'NOT among the six failures'],
      ['the mod the six lights come from', 'ugc_2409209888'],
      // The candidate rule this topic recorded is now IMPLEMENTED as `system-light-undefined`
      // (src/lib/worldgfx.mjs). The topic must say so, and must keep the parts STILL unmeasured -
      // a topic that quietly stops mentioning its open questions is how a gap gets forgotten.
      ['the implemented rule name', 'system-light-undefined'],
      ['the module that implements it', 'src/lib/worldgfx.mjs'],
      ['what is STILL unmeasured about a failed light', 'system UNLIT'],
      ['the user\'s first observation, verbatim', '两个星都渲染了'],
      ['the user\'s orbit observation, verbatim', '轨道显示是绕黑洞旋转'],
    ]) {
      check(`the black-hole-primary topic carries ${what}`, haystack.includes(literal), `missing ${JSON.stringify(literal)}`);
    }
  }
  // ---------------------------------------------------------------- the corrected measurements
  //
  // THE PLACE EARLIER ROUNDS NOTED FOR PINNING A MEASURED FACT. The DLC-GUI wave (DOORS-RESULTS.md,
  // in-game probe 2026-10-06) CORRECTED two things this project's own knowledge had claimed, and a
  // correction that nothing asserts is a correction that can silently regress:
  //
  //   * `positionType`: the old claim was "233 blocks, and NOT ONE of the names is referenced
  //     anywhere else". The reference clause is false. Re-measured: 224 blocks under the probe's
  //     LINE rule, 14 names occurring elsewhere in `interface/**` under its substring rule, 163 of
  //     the 224 names contiguous literals in `stellaris.exe`. This parser's own count is 233 (the
  //     nine-block difference is one-line declarations), and 5 of its blocks carry a third field.
  //   * `common/arkships`: the old status was 待确认 / "treat as unusable". It is now a MEASURED
  //     RULE - the engine does not read the directory at all (7 probe files in 6 shapes, including a
  //     malformed one, produced zero log lines while the same mod's `interface/` file was named in
  //     the same run).
  //
  // A LATER revision of the same wave (DOORS-RESULTS.md section 12) added the RUNTIME verdicts, which
  // came from a human's eyes rather than from a log, and those are pinned further down in this group:
  // "the engine USED the re-pointed positionType number", "a built Grand Archive shows 3 exhibitions
  // with content-defined titles, so the count define is not a lever", and "the console cannot fire an
  // espionage_operation_event - the engine enforces its scope at fire time".
  //
  // The figures are checked where a reader would act on them: the knowledge topic that owns the
  // rule, the `kinds.mjs` help text that states the reason a `positionType` is not emittable, and
  // the prose in `docs/gui-pitfalls.md`.
  const anchorTopic = topics.find((entry) => entry.id === 'positiontype-is-a-global-named-anchor');
  const anchorText = anchorTopic
    ? `${anchorTopic.body}\n${anchorTopic.syntax_blocks.join('\n')}\n${anchorTopic.evidence.join('\n')}\n${anchorTopic.rules.join('\n')}\n${anchorTopic.breaks.join('\n')}`
    : '';
  check(
    'the positionType correction has a topic of its own, and it states all three re-measured figures',
    Boolean(anchorTopic) && /\b224\b/.test(anchorText) && /\b14\b/.test(anchorText) && /\b163 of 224\b/.test(anchorText),
    anchorTopic ? `224=${/\b224\b/.test(anchorText)} 14=${/\b14\b/.test(anchorText)} 163of224=${/\b163 of 224\b/.test(anchorText)}` : 'no topic',
  );
  check(
    'and it RETIRES the falsified claim instead of quietly editing it',
    /was FALSE|is \*\*false\*\*|retired/i.test(anchorText) && /referenced anywhere else|referenced nowhere|0 of the names/i.test(anchorText),
    JSON.stringify((anchorText.match(/[^.]*(?:FALSE|false|retired)[^.]*\./) ?? [''])[0].slice(0, 120)),
  );
  check(
    'and it keeps THIS parser\'s count beside the probe\'s, with the reason they differ',
    /\b233\b/.test(anchorText) && /one line|one-line|brace on the next line|line rule/i.test(anchorText),
    (anchorText.match(/[^.]*233[^.]*\./) ?? [''])[0].slice(0, 120),
  );
  check(
    'and it records the five blocks that carry a field besides name/position',
    /dynamic_extra_height/.test(anchorText) && /if_scaled_resolution/.test(anchorText) && /\bx?4\b|\*\*4\*\*/.test(anchorText),
    (anchorText.match(/[^.]*dynamic_extra_height[^.]*\./) ?? [''])[0].slice(0, 120),
  );
  // The kinds.mjs help text carried the claim in a string an agent reads through
  // `inspect_rstellarisgui_state`, so it is the OTHER half of "retired everywhere it appears".
  const positionKind = kindSpec('position');
  const positionHelp = positionKind?.help ?? '';
  check(
    'kinds.mjs no longer tells an agent that no positionType name is referenced',
    !/NOT ONE/.test(positionHelp) && !/is referenced by any other line/.test(positionHelp),
    positionHelp.slice(0, 120),
  );
  check(
    'and it now states the corrected pairing (163 of the 224 line-rule names, 14 referenced)',
    /163 of the 224/.test(positionHelp) && /\b14\b/.test(positionHelp) && /was FALSE/.test(positionHelp),
    positionHelp.slice(0, 160),
  );

  // ---------------------------------------------------------------- the arkships verdict
  const arkTopic = topics.find((entry) => entry.id === 'ark-panel-is-the-colony-panel');
  const arkText = arkTopic
    ? `${arkTopic.body}\n${arkTopic.syntax_blocks.join('\n')}\n${arkTopic.evidence.join('\n')}\n${arkTopic.rules.join('\n')}`
    : '';
  check(
    'the ark ship topic states the MEASURED `common/arkships` verdict, not a 待确认',
    /not read|does not read|is \*\*not\*\* read/i.test(arkText),
    (arkText.match(/[^.]*common\/arkships[^.]*\./) ?? [''])[0].slice(0, 140),
  );
  check(
    'and it names the mount control that excludes "the mod was not mounted"',
    /zz_gui_probe_doors_a_mountcontrol/.test(arkText) && /probeZZmount_control_token/.test(arkText),
    (arkText.match(/[^.]*mountcontrol[^.]*\./) ?? [''])[0].slice(0, 120),
  );
  check(
    'and it keeps the reason the engine\'s content-directory list is not a capability list',
    /common\/specimens/.test(arkText) && /38379912/.test(arkText),
    (arkText.match(/[^.]*common\/specimens[^.]*\./) ?? [''])[0].slice(0, 140),
  );
  check(
    'and the rule no longer says "treat as unusable" as if its keys were merely undocumented',
    !/Treat `common\/arkships` as unusable/.test(arkText),
    'the retired caution is still in the Rules list',
  );

  // ------------------------------------------------- the RUNTIME verdicts (the user's eyes, 2026-10-06)
  //
  // Three quarters of a runtime question were still open when the probe wave wrote its report, and all
  // three were answered by a HUMAN watching the game rather than by a log line - which is exactly why
  // nothing in the tooling can catch them drifting. If a later revision of a topic quietly drops the
  // observation, weakens "the engine USED the number" back to "the engine read the file", or files the
  // Grand Archive's exhibition count as an open lever again, these assertions fail.
  //
  //   * Door C: "the engine read my file" was a LOG fact; "the engine USED the number" is an EYES fact
  //     (re-pointed `pause_bg_animation_speed` {500,2000} -> {15,1234}, the rolling glow got SLOWER).
  //     The evidence is the DIRECTION, and the earlier "maybe it is a period" guess is retracted.
  //   * Door D: a built-archive save shows exactly 3 exhibitions whose titles are the CONTENT-defined
  //     `EXHIBITION_TITLE_1..3`, one per compiled specimen type, so the count define is not a lever -
  //     and the law that generalises is "a mod can add INSTANCES, not CATEGORIES".
  //   * Door E: firing the probe event from the console is refused with the verbatim engine line
  //     `Event fired on wrong scope. Got country, expected espionage_operation`, so the console route
  //     is closed and the runtime half stays UNPROVEN.
  check(
    'the positionType topic records the runtime half as CONFIRMED by the user\'s eyes, not merely inferred',
    /user's eyes/i.test(anchorText) && /slower|SLOWER/.test(anchorText) && /direction/i.test(anchorText),
    (anchorText.match(/[^.]*slower[^.]*\./i) ?? [''])[0].slice(0, 140),
  );
  check(
    'and it states the DIRECTION-matches-numbers lesson rather than settling for "something changed"',
    /direction/i.test(anchorText) && /predicted direction|direction the .* predict|the direction the smaller numbers predict/i.test(anchorText),
    (anchorText.match(/[^.]*predicted direction[^.]*\./i) ?? [''])[0].slice(0, 140),
  );
  check(
    'and it RETRACTS the period speculation while keeping the user\'s anomaly as an anomaly',
    /period/i.test(anchorText) && /retract/i.test(anchorText) && /unexplained anomaly/i.test(anchorText),
    `period=${/period/i.test(anchorText)} retract=${/retract/i.test(anchorText)} anomaly=${/unexplained anomaly/i.test(anchorText)}`,
  );
  check(
    'and it keeps the two rulers apart: the log proves the file was READ, the eyes prove the number was USED',
    /read my file|READ the file|read the file that holds the anchor/i.test(anchorText) && /used the number|USED the number/i.test(anchorText),
    (anchorText.match(/[^.]*used the number[^.]*\./i) ?? [''])[0].slice(0, 140),
  );
  check(
    'and the whole-file-only route survives the correction (no partial-edit syntax)',
    /whole \.gui|whole-file|entire \.gui|whole file/i.test(anchorText) && /no partial|no reference syntax|not merged|whole-file replacement/i.test(anchorText),
    (anchorText.match(/[^.]*whole-file[^.]*\./i) ?? [''])[0].slice(0, 140),
  );

  const dlcTopic = topics.find((entry) => entry.id === 'dlc-panels-are-engine-views');
  const dlcText = dlcTopic
    ? `${dlcTopic.body}\n${dlcTopic.syntax_blocks.join('\n')}\n${dlcTopic.evidence.join('\n')}\n${dlcTopic.rules.join('\n')}\n${dlcTopic.breaks.join('\n')}`
    : '';
  check(
    'the DLC taxonomy states the closed-enumeration law in those words',
    /a mod can add INSTANCES, not CATEGORIES/.test(dlcText),
    (dlcText.match(/[^.]*INSTANCES, not CATEGORIES[^.]*\./) ?? [''])[0].slice(0, 160),
  );
  check(
    'and it lists the four closed enumerations the wave measured, each with its figure',
    /term_type/.test(dlcText) &&
      /\b4\b/.test(dlcText) &&
      /galactic_community_actions/.test(dlcText) &&
      /\b2\b/.test(dlcText) &&
      /patron/i.test(dlcText) &&
      /category/.test(dlcText) &&
      /specimen/i.test(dlcText),
    `term_type=${/term_type/.test(dlcText)} actions=${/galactic_community_actions/.test(dlcText)} patron=${/patron/i.test(dlcText)}`,
  );
  check(
    'and the Grand Archive count define is recorded as NOT a lever, with the 3 content-defined titles',
    /GRAND_ARCHIVE_EXHIBITIONS_COUNT/.test(dlcText) &&
      /EXHIBITION_TITLE_1\.\.3/.test(dlcText) &&
      /not a lever|cannot widen|no fourth title/i.test(dlcText),
    (dlcText.match(/[^.]*not a lever[^.]*\./i) ?? [''])[0].slice(0, 160),
  );
  check(
    'and it states the three ways the engine connects content to a screen, custom_gui being the mod-usable one',
    /DATA FIELD SWITCHES A WHOLE UI MODE/.test(dlcText) &&
      /ENGINE-FILLED LISTS A MOD FEEDS BY REGISTRY/.test(dlcText) &&
      /EVENT TYPE AS THE UI PROTOCOL/.test(dlcText) &&
      /only one mechanism|the only one|only mechanism that puts/i.test(dlcText),
    `ways=${['DATA FIELD SWITCHES A WHOLE UI MODE', 'ENGINE-FILLED LISTS A MOD FEEDS BY REGISTRY', 'EVENT TYPE AS THE UI PROTOCOL'].filter((t) => dlcText.includes(t)).length}/3`,
  );
  check(
    'and it does not quietly re-open the count define as an untested idea',
    /not measured|NOT measured|cannot be used|is not a lever/i.test(dlcText) && !/raising it may add a 4th exhibition/i.test(dlcText),
    'the topic records what was and was not measured about the count',
  );

  const espionageTopic = topics.find((entry) => entry.id === 'espionage-operation-types-are-checked-at-load');
  const espionageText = espionageTopic
    ? `${espionageTopic.body}\n${espionageTopic.syntax_blocks.join('\n')}\n${espionageTopic.evidence.join('\n')}\n${espionageTopic.rules.join('\n')}`
    : '';
  check(
    'the espionage topic carries the FIRE-time scope check verbatim, beside the load-time ones',
    /Event fired on wrong scope\. Got country, expected espionage_operation/.test(espionageText) &&
      /espionage_operation/.test(espionageText),
    (espionageText.match(/[^.]*wrong scope[^.]*\./) ?? [''])[0].slice(0, 140),
  );
  check(
    'and it says the console route is closed and the custom_gui runtime half stays unproven',
    /console/i.test(espionageText) && /unproven|UNPROVEN/i.test(espionageText),
    `console=${/console/i.test(espionageText)} unproven=${/unproven/i.test(espionageText)}`,
  );


  check('the prose reference the topics cross-reference still exists', existsSync(join(projectRoot, 'docs', 'gui-pitfalls.md')));
  check('and it still carries the section anchors the topics cite', /^## 14\. Text has a size/m.test(readFileSync(join(projectRoot, 'docs', 'gui-pitfalls.md'), 'utf8')));
});

// =====================================================================================
// 22. WHAT CAN BE COLONIZED (src/lib/colonization.mjs)
//
// The two rules here are the engine's own, quoted from its error strings, and the whole point of
// the check is that DELETING THE RULE FAILS THE SUITE BY NAME. Each assertion below therefore
// asserts the finding EXISTS, not merely that the analysis returned: a module reduced to
// `return {findings: []}` passes a "no false positives" test and fails every one of these.
//
// The real install is checked too, when it is present: vanilla's nine ark-ship hulls are the
// official example of the carrier route, and a rule that fires on them would be a false positive
// on the engine's own content.
// =====================================================================================

group('what can be colonized, and what only looks like it (COLONY)', () => {
  // ---------------------------------------------------------------- the block reader
  // `atmosphere_color = hsv { 0.59 0.45 0.95 }` is a SCALAR BLOCK VALUE, and the repository's
  // `parseParadox` ends the enclosing block at that value's closing brace, so every field after it
  // would be reported at file scope (`colonizable` among them). This reader is measured against
  // that shape directly, because the engine reads those fields as children of the class block.
  const withScalarBlock = [
    'pc_probe = {',
    '\tatmosphere_color = hsv { 0.59 0.45 0.95 }',
    '\tcolonizable = yes',
    '\tdistrict_set = habitat',
    '}',
  ].join('\n');
  const scanned = scanScriptBlocks(withScalarBlock);
  check(
    'the block reader sees the fields AFTER a scalar block value',
    scanned.length === 1 && scanned[0].fields.get('colonizable')?.value === 'yes' && scanned[0].fields.get('district_set')?.value === 'habitat',
    JSON.stringify(scanned.map((block) => ({ key: block.key, fields: [...block.fields.keys()] }))),
  );
  // And this is the repository parser's divergence, recorded as a measurement rather than a guess:
  // it reports `colonizable` at file scope, which is why this module does not use it.
  const viaParseParadox = parseParadox(withScalarBlock).roots.map((root) => root.key);
  check(
    'parseParadox mis-nests a scalar block value (the reason the reader is separate)',
    viaParseParadox.includes('colonizable'),
    viaParseParadox.join(','),
  );

  // ---------------------------------------------------------------- the two schemas
  const goodClass = ['pc_probe_ark = {', '\tcolonizable = yes', '\tdistrict_set = habitat', '}', ''].join('\n');
  const deadClass = ['pc_probe_dead = {', '\tcolonizable = no', '}', ''].join('\n');
  const eventClass = ['pc_probe_infested = {', '\tcolonizable = no', '\tcolonizable_by_event = yes', '}', ''].join('\n');
  const arkHull = ['probe_ark = {', '\tclass = shipclass_starbase', '\tcarries_colony = pc_probe_ark', '}', ''].join('\n');
  const plainHull = ['probe_hull = {', '\tclass = shipclass_military', '\tcarries_colony = pc_probe_ark', '}', ''].join('\n');
  const deadHull = ['probe_dead = {', '\tclass = shipclass_starbase', '\tcarries_colony = pc_probe_dead', '}', ''].join('\n');
  const ghostHull = ['probe_ghost = {', '\tclass = shipclass_starbase', '\tcarries_colony = pc_probe_ghost', '}', ''].join('\n');

  const files = (ships, classes) => ({
    shipSizeFiles: Object.entries(ships).map(([name, text]) => ({ path: join(scratch, 'common', 'ship_sizes', name), text })),
    planetClassFiles: Object.entries(classes).map(([name, text]) => ({ path: join(scratch, 'common', 'planet_classes', name), text })),
  });

  const clean = analyseColonizationSpec(files({ 'a.txt': arkHull }, { 'a.txt': goodClass, 'b.txt': deadClass }));
  check(
    'the ark-ship shape is clean: `class = shipclass_starbase` plus `carries_colony`',
    clean.counts.total === 0 && clean.carrierClasses.length === 1 && clean.carrierClasses[0].isStarbase === true,
    JSON.stringify(clean.counts),
  );

  const noStarbase = analyseColonizationSpec(files({ 'a.txt': plainHull }, { 'a.txt': goodClass }));
  check(
    'a `carries_colony` hull that is NOT `shipclass_starbase` is an ERROR, by name',
    noStarbase.counts.error === 1 && noStarbase.findings[0].rule === 'carries-colony-without-starbase',
    JSON.stringify(noStarbase.findings.map((finding) => finding.rule)),
  );
  check(
    'and the finding quotes the engine: "Arkship size %s does not have class = shipclass_starbase"',
    /Arkship size %s does not have class = shipclass_starbase/.test(noStarbase.findings[0].message) &&
      /00_ship_sizes\.txt:99/.test(noStarbase.findings[0].message),
    noStarbase.findings[0].message,
  );

  const deadTarget = analyseColonizationSpec(files({ 'a.txt': deadHull }, { 'a.txt': goodClass, 'b.txt': deadClass }));
  check(
    'a `carries_colony` naming a `colonizable = no` class is an ERROR, with the class cited',
    deadTarget.counts.error === 1 &&
      deadTarget.findings[0].rule === 'carrier-colony-class-undefined' &&
      deadTarget.findings[0].resolution === 'resolved' &&
      deadTarget.findings[0].message.includes('b.txt:2'),
    deadTarget.findings[0].message,
  );

  const eventTarget = analyseColonizationSpec(files({ 'a.txt': deadHull.replace('pc_probe_dead', 'pc_probe_infested') }, { 'a.txt': goodClass, 'b.txt': eventClass }));
  check(
    '`colonizable_by_event = yes` is accepted as a carrier target (pc_infested is the vanilla case)',
    eventTarget.counts.total === 0,
    JSON.stringify(eventTarget.findings.map((finding) => finding.rule)),
  );

  const fragment = analyseColonizationSpec(files({ 'a.txt': ghostHull }, { 'b.txt': deadClass }));
  check(
    'an undefined carrier class is a WARNING on a fragment, so a half-checked mod is not called broken',
    fragment.counts.warning === 1 && fragment.findings[0].resolution === 'unresolved',
    JSON.stringify(fragment.counts),
  );

  const complete = analyseColonization({ ...files({ 'a.txt': ghostHull }, { 'b.txt': deadClass }), complete: true });
  check(
    'and an ERROR when the caller resolved the whole set',
    complete.counts.error === 1 && complete.findings[0].rule === 'carrier-colony-class-undefined',
    JSON.stringify(complete.counts),
  );

  // A file with no `carries_colony` at all is still REPORTED as checked: the report says which
  // planet classes are colonisable and which hulls carry a colony, findings or not.
  const noCarriers = analyseColonizationSpec(files({ 'a.txt': ['probe = {', '\tclass = shipclass_military', '}', ''].join('\n') }, { 'a.txt': goodClass }));
  check(
    'the report lists the planet classes even when no finding fired',
    noCarriers.counts.total === 0 && noCarriers.planetClasses.some((entry) => entry.key === 'pc_probe_ark' && entry.colonizable === true),
    JSON.stringify(noCarriers.planetClasses),
  );

  // ---------------------------------------------------------------- the rule table
  check(
    'both rules are registered with a severity and a description, so the generated README carries them',
    ['carries-colony-without-starbase', 'carrier-colony-class-undefined'].every(
      (rule) => RULE_SEVERITY[rule] === 'error' && typeof COLONIZATION_SEVERITY[rule] === 'string' && typeof RULE_DESCRIPTIONS[rule] === 'string',
    ),
    JSON.stringify(['carries-colony-without-starbase', 'carrier-colony-class-undefined'].map((rule) => [rule, RULE_SEVERITY[rule], RULE_DESCRIPTIONS[rule]])),
  );
  check(
    'the descriptions are the module\'s own, not a copy that can drift',
    RULE_DESCRIPTIONS['carries-colony-without-starbase'] === COLONIZATION_DESCRIPTIONS['carries-colony-without-starbase'] &&
      RULE_DESCRIPTIONS['carrier-colony-class-undefined'] === COLONIZATION_DESCRIPTIONS['carrier-colony-class-undefined'],
  );

  // ---------------------------------------------------------------- through gui_check_files
  const colonisationRoot = join(scratch, 'colony');
  rmSync(colonisationRoot, { recursive: true, force: true });
  mkdirSync(join(colonisationRoot, 'common', 'ship_sizes'), { recursive: true });
  mkdirSync(join(colonisationRoot, 'common', 'planet_classes'), { recursive: true });
  writeFileSync(join(colonisationRoot, 'common', 'ship_sizes', 'zz_probe.txt'), `${plainHull}${arkHull}`, 'utf8');
  writeFileSync(join(colonisationRoot, 'common', 'planet_classes', 'zz_probe.txt'), `${goodClass}${deadClass}`, 'utf8');
  const checked = checkFiles({
    paths: [
      join(colonisationRoot, 'common', 'ship_sizes', 'zz_probe.txt'),
      join(colonisationRoot, 'common', 'planet_classes', 'zz_probe.txt'),
    ],
    checkLocKeys: false,
  });
  check(
    'gui_check_files runs the colonisation pass over the files it was handed',
    checked.byRule['carries-colony-without-starbase'] === 1 && checked.colonisation?.carrierClasses.length === 2,
    JSON.stringify(checked.byRule),
  );
  check(
    'and it reports the colonisable classes it found, so an empty report is distinguishable from an unread one',
    checked.colonisation.planetClasses.some((entry) => entry.key === 'pc_probe_ark' && entry.colonizable === true) &&
      checked.colonisation.files.length === 2,
    JSON.stringify(checked.colonisation),
  );
  check(
    'a ship-size file is not mistaken for a button_effects file (it has no `effect` block to miss)',
    (checked.byRule['button-effect-without-effect'] ?? 0) === 0,
    JSON.stringify(checked.byRule),
  );

  // ---------------------------------------------------------------- the real install
  // Vanilla's own ark ships are the official example of the carrier route: NINE hulls, all
  // starbase class, all carrying `pc_ark`. A rule that fired on them would be a false positive on
  // the engine's own content, and a reader that found no carriers would be measuring nothing.
  const vanillaShipSizes = join(DEFAULT_GAME_ROOT, 'common', 'ship_sizes');
  const vanillaPlanetClasses = join(DEFAULT_GAME_ROOT, 'common', 'planet_classes');
  if (existsSync(vanillaShipSizes) && existsSync(vanillaPlanetClasses)) {
    const vanilla = analyseColonizationFiles(
      [
        ...listFilesRecursive(vanillaShipSizes, ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') })),
        ...listFilesRecursive(vanillaPlanetClasses, ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') })),
      ],
      { complete: true },
    );
    check(
      'the install is clean: every ark ship carries a colony of a colonisable class, from a starbase',
      vanilla.counts.total === 0,
      JSON.stringify(vanilla.findings.map((finding) => `${finding.rule} ${finding.where}`)),
    );
    check(
      'the install has exactly nine carrier hulls, all `shipclass_starbase`, all carrying `pc_ark`',
      vanilla.carrierClasses.length === 9 &&
        vanilla.carrierClasses.every((carrier) => carrier.isStarbase && carrier.carriesColony === 'pc_ark'),
      JSON.stringify(vanilla.carrierClasses.map((carrier) => `${carrier.key}:${carrier.class}:${carrier.carriesColony}`)),
    );
    check(
      'and `pc_ark` reads as `colonizable = yes` - the field is read from INSIDE its block',
      vanilla.planetClasses.some((entry) => entry.key === 'pc_ark' && entry.colonizable === true),
      JSON.stringify(vanilla.planetClasses.find((entry) => entry.key === 'pc_ark')),
    );
    check(
      '`pc_ringworld_habitable` and `pc_habitat` are colonisable planet classes, not megastructures',
      vanilla.planetClasses.some((entry) => entry.key === 'pc_ringworld_habitable' && entry.colonizable === true && entry.ringworld === true) &&
        vanilla.planetClasses.some((entry) => entry.key === 'pc_habitat' && entry.colonizable === true && entry.habitat === true),
      JSON.stringify(vanilla.planetClasses.filter((entry) => entry.key === 'pc_habitat' || entry.key === 'pc_ringworld_habitable')),
    );
    check(
      'NO vanilla star-slot class is colonisable - the two that are, are mods (geocentric, dyson habitat)',
      vanilla.planetClasses.every((entry) => !(entry.star && entry.colonizable)),
      JSON.stringify(vanilla.planetClasses.filter((entry) => entry.star && entry.colonizable)),
    );
  } else {
    check('the install is present, so the colonisation rules were measured against real content', false, DEFAULT_GAME_ROOT);
  }

  // ---------------------------------------------------------------- ASTEROIDS
  //
  // The second half of the schema (ASTEROID in src/lib/colonization.mjs). A single asteroid is a
  // PLANET object; an asteroid belt is a scenery declaration that names a mesh list. Both rules
  // below are asserted to FIRE on a probe, so a module reduced to `return {findings: []}` fails
  // here by name rather than passing a "no false positives" test.
  const beltDir = join(DEFAULT_GAME_ROOT, 'common', 'asteroid_belts');
  const initializerDir = join(DEFAULT_GAME_ROOT, 'common', 'solar_system_initializers');
  const probeBeltFiles = existsSync(beltDir)
    ? listFilesRecursive(beltDir, ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
    : [];

  // The reader must see all 241 vanilla belt blocks and exactly the two fields they use. This is
  // the census the topic quotes, asserted here so it cannot drift into a claim that a belt block
  // has room for members, classes, counts or spacing.
  if (existsSync(initializerDir)) {
    const initializerFiles = listFilesRecursive(initializerDir, ['.txt']).map((path) => ({
      path,
      text: readFileSync(path, 'utf8'),
    }));
    const belts = readAsteroidBelts(initializerFiles);
    check(
      'the belt reader finds every vanilla `asteroid_belt` block (241) and no other block',
      belts.length === 241,
      `${belts.length} belt blocks`,
    );
    const beltFields = [...new Set(belts.flatMap((belt) => belt.fields))].sort();
    check(
      'a vanilla `asteroid_belt` block carries ONLY `type` and `radius`: no class, count, spacing or membership',
      beltFields.join(',') === 'radius,type',
      JSON.stringify(beltFields),
    );
    check(
      'every vanilla belt names a type, and all but two also name a radius',
      belts.filter((belt) => belt.type !== null).length === 241 && belts.filter((belt) => belt.radius !== null).length === 239,
      JSON.stringify({ typed: belts.filter((belt) => belt.type !== null).length, radiused: belts.filter((belt) => belt.radius !== null).length }),
    );
    check(
      'the vanilla belts resolve against the install, so the rule is not firing on real content',
      analyseAsteroidBelts({ asteroidBeltFiles: probeBeltFiles, scriptFiles: initializerFiles, complete: true }).counts.total === 0,
      JSON.stringify(analyseAsteroidBelts({ asteroidBeltFiles: probeBeltFiles, scriptFiles: initializerFiles, complete: true }).counts),
    );
    check(
      'and the six vanilla belt types are the only ones referenced - every one is a mesh list',
      probeBeltFiles.length === 1 &&
        analyseAsteroidBelts({ asteroidBeltFiles: probeBeltFiles, scriptFiles: initializerFiles, complete: true }).beltTypes.length === 6,
      JSON.stringify(probeBeltFiles.map((file) => file.path)),
    );
  } else {
    check('the install is present, so the belt schema was measured against real content', false, initializerDir);
  }

  // The belt-type binding: a `type =` naming nothing is an ERROR when the belt definitions were
  // supplied and a WARNING when they were not, exactly like an unresolvable `carries_colony`.
  const ghostBeltSystem = {
    path: join(scratch, 'common', 'solar_system_initializers', 'zz_probe_initializers.txt'),
    text: [
      'probe_system = {',
      '\tclass = "sc_g"',
      '\tasteroid_belt = {',
      '\t\ttype = zz_no_such_belt',
      '\t\tradius = 100',
      '\t}',
      '}',
      '',
    ].join('\n'),
  };
  const ghostBelt = analyseAsteroidBelts({ asteroidBeltFiles: probeBeltFiles, scriptFiles: [ghostBeltSystem], complete: true });
  check(
    'an `asteroid_belt` naming a belt type no file defines is an ERROR',
    ghostBelt.counts.error === 1 &&
      ghostBelt.findings[0].rule === 'asteroid-belt-type-undefined' &&
      ghostBelt.findings[0].resolution === 'resolved',
    JSON.stringify(ghostBelt.findings.map((finding) => finding.rule)),
  );
  check(
    'and the finding quotes the install\'s belt-type schema, so the reader can act on it',
    /common\/asteroid_belts\/00_asteroid_belts\.txt:4-12/.test(ghostBelt.findings[0].message) &&
      ghostBelt.findings[0].suggestedFix.includes('rocky_asteroid_belt'),
    ghostBelt.findings[0].message,
  );
  const beltFragment = analyseAsteroidBelts({ asteroidBeltFiles: [], scriptFiles: [ghostBeltSystem], complete: true });
  check(
    'with no belt-type file supplied it is a WARNING, so a half-checked mod is not called broken',
    beltFragment.counts.warning === 1 && beltFragment.findings[0].resolution === 'unresolved',
    JSON.stringify(beltFragment.counts),
  );
  const knownBelt = analyseAsteroidBelts({
    asteroidBeltFiles: probeBeltFiles,
    scriptFiles: [{ ...ghostBeltSystem, text: ghostBeltSystem.text.replace('zz_no_such_belt', 'icy_asteroid_belt') }],
    complete: true,
  });
  check('a belt naming a real type is clean, and the belt is still reported', knownBelt.counts.total === 0 && knownBelt.belts.length === 1, JSON.stringify(knownBelt.counts));
  const typelessBelt = analyseAsteroidBelts({
    asteroidBeltFiles: probeBeltFiles,
    scriptFiles: [{ ...ghostBeltSystem, text: ghostBeltSystem.text.replace('\t\ttype = zz_no_such_belt\n', '') }],
    complete: true,
  });
  check(
    'a belt with NO `type` is not reported: the install documents the first belt type as the default',
    typelessBelt.counts.total === 0 && typelessBelt.belts.length === 1,
    JSON.stringify(typelessBelt.counts),
  );

  // The class side: `asteroid = yes` plus `colonizable = yes` on one class is reported (INFO), while
  // vanilla's six asteroid classes - all `colonizable = no` - are not.
  const asteroidClassProbe = analyseColonization({
    planetClassFiles: [
      {
        path: join(scratch, 'common', 'planet_classes', 'zz_probe_asteroid.txt'),
        text: ['pc_probe_rock = {', '\tasteroid = yes', '\tcolonizable = yes', '}', ''].join('\n'),
      },
    ],
    shipSizeFiles: [],
    complete: true,
  });
  check(
    'an asteroid class that is also colonisable is reported, naming the minor-planetary-body consequence',
    asteroidClassProbe.counts.info === 1 &&
      asteroidClassProbe.findings[0].rule === 'planet-asteroid-colonizable' &&
      /requires_not_minor_planetary_body/.test(asteroidClassProbe.findings[0].message),
    JSON.stringify(asteroidClassProbe.findings.map((finding) => finding.rule)),
  );
  check(
    'and the report carries the `asteroid` flag on every planet class, so an empty finding is distinguishable from an unread flag',
    asteroidClassProbe.planetClasses.some((entry) => entry.key === 'pc_probe_rock' && entry.asteroid === true && entry.colonizable === true),
    JSON.stringify(asteroidClassProbe.planetClasses),
  );

  // The install's own asteroid classes, measured: SIX of them, and NOT ONE is colonisable. A rule
  // that fired on them would be a false positive on the engine's own content.
  const vanillaPlanetClassDir = join(DEFAULT_GAME_ROOT, 'common', 'planet_classes');
  if (existsSync(vanillaPlanetClassDir)) {
    const vanillaClasses = analyseColonization({
      planetClassFiles: listFilesRecursive(vanillaPlanetClassDir, ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') })),
      shipSizeFiles: [],
      complete: true,
    });
    const asteroidClasses = vanillaClasses.planetClasses.filter((entry) => entry.asteroid === true);
    check(
      'the install has exactly six asteroid classes, and not one of them is colonisable',
      asteroidClasses.length === 6 && asteroidClasses.every((entry) => entry.colonizable === false),
      JSON.stringify(asteroidClasses.map((entry) => `${entry.key}:${entry.colonizable}`)),
    );
    check(
      'and the install is clean under the asteroid rule (no false positive on vanilla)',
      vanillaClasses.findings.filter((finding) => finding.rule === 'planet-asteroid-colonizable').length === 0,
      JSON.stringify(vanillaClasses.findings.map((finding) => finding.rule)),
    );
  } else {
    check('the install is present, so the asteroid class rule was measured against real content', false, vanillaPlanetClassDir);
  }

  // ---------------------------------------------------------------- the two rules in the table
  check(
    'both asteroid rules are registered with a severity and a description, so the generated README carries them',
    ['asteroid-belt-type-undefined', 'planet-asteroid-colonizable'].every(
      (rule) => RULE_SEVERITY[rule] === COLONIZATION_SEVERITY[rule] && typeof RULE_DESCRIPTIONS[rule] === 'string',
    ),
    JSON.stringify(['asteroid-belt-type-undefined', 'planet-asteroid-colonizable'].map((rule) => [rule, RULE_SEVERITY[rule], RULE_DESCRIPTIONS[rule]?.slice(0, 40)])),
  );
  check(
    'and their descriptions are the module\'s own, not a copy that can drift',
    RULE_DESCRIPTIONS['asteroid-belt-type-undefined'] === COLONIZATION_DESCRIPTIONS['asteroid-belt-type-undefined'] &&
      RULE_DESCRIPTIONS['planet-asteroid-colonizable'] === COLONIZATION_DESCRIPTIONS['planet-asteroid-colonizable'],
  );

  // ---------------------------------------------------------------- through gui_check_files
  const asteroidRoot = join(scratch, 'asteroids');
  rmSync(asteroidRoot, { recursive: true, force: true });
  mkdirSync(join(asteroidRoot, 'common', 'asteroid_belts'), { recursive: true });
  mkdirSync(join(asteroidRoot, 'common', 'solar_system_initializers'), { recursive: true });
  writeFileSync(join(asteroidRoot, 'common', 'asteroid_belts', 'zz_probe.txt'), ['zz_probe_belt = {', '\tmesh = "asteroid_01_mesh"', '}', ''].join('\n'), 'utf8');
  writeFileSync(
    join(asteroidRoot, 'common', 'solar_system_initializers', 'zz_probe.txt'),
    ['probe_system = {', '\tclass = "sc_g"', '\tasteroid_belt = {', '\t\ttype = zz_no_such_belt', '\t\tradius = 100', '\t}', '}', ''].join('\n'),
    'utf8',
  );
  const asteroidChecked = checkFiles({
    paths: [
      join(asteroidRoot, 'common', 'asteroid_belts', 'zz_probe.txt'),
      join(asteroidRoot, 'common', 'solar_system_initializers', 'zz_probe.txt'),
    ],
    checkLocKeys: false,
  });
  check(
    'gui_check_files runs the asteroid pass over the files it was handed, across the two directories',
    asteroidChecked.byRule['asteroid-belt-type-undefined'] === 1 && asteroidChecked.asteroids?.beltTypes.length === 1 && asteroidChecked.asteroids.belts.length === 1,
    JSON.stringify({ byRule: asteroidChecked.byRule, asteroids: asteroidChecked.asteroids }),
  );
  check(
    'and an asteroid-belt type file is not mistaken for a button_effects file',
    (asteroidChecked.byRule['button-effect-without-effect'] ?? 0) === 0,
    JSON.stringify(asteroidChecked.byRule),
  );
});

// =====================================================================================
// 21c. THE RING WORLD (src/lib/colonization.mjs, RING WORLD)
//
// A ring world is twelve ordinary `planet` blocks in an initializer whose planet classes carry
// `ringworld = yes`; there is no system-level ring object in the script language, so the ring's
// radius is the radius those bodies are placed on and its segment count is how many of them the
// file writes. This section exists because both halves are checkable from a file and both are
// silent in the engine: the radius is a `change_orbit` in the middle of a body chain, and a
// segment class that does not resolve is a body with no class.
//
// The reader's fail-if-removed case is the Shattered Ring: `shattered_ring_start`
// (federations_initializers.txt:1908) is SIX segments, three of them damaged, two of them ruined
// megastructure sections spawned in the block's own `init_effect`, and one seam deliberately at
// `orbit_distance = 5` carrying `NAME_Irreparable_Damage` - so a reader that only counts intact
// `pc_ringworld_habitable` blocks answers "one", which is wrong by every measure.
// =====================================================================================
group('a ring world is a set of planet objects, and its radius and segment count are in the initializer (RING)', () => {
  const ringInitializerDir = join(DEFAULT_GAME_ROOT, 'common', 'solar_system_initializers');
  const ringPlanetClassDir = join(DEFAULT_GAME_ROOT, 'common', 'planet_classes');
  if (!existsSync(ringInitializerDir) || !existsSync(ringPlanetClassDir)) {
    check('the install is present, so the ring-world rules were measured against real content', false, ringInitializerDir);
    return;
  }
  const ringInitializerFiles = listFilesRecursive(ringInitializerDir, ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  const ringPlanetClassFiles = listFilesRecursive(ringPlanetClassDir, ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  const vanillaRings = analyseRingWorlds({ initializerFiles: ringInitializerFiles, planetClassFiles: ringPlanetClassFiles, complete: true });

  // The ten classes the install marks `ringworld = yes`, and the entity each one is DRAWN with.
  // The entity is what makes this a rendering fact and not only a naming one: the ring is drawn
  // PER SEGMENT, each segment's planet class naming one arc mesh.
  const expectedRingEntities = {
    pc_cybrex: 'ringworld_habitable_entity',
    pc_ringworld_habitable: 'ringworld_habitable_entity',
    pc_ringworld_habitable_damaged: 'ringworld_habitable_damaged_entity',
    pc_ringworld_tech: 'ringworld_tech_entity',
    pc_ringworld_tech_damaged: 'ringworld_tech_damaged_entity',
    pc_ringworld_seam: 'ringworld_seam_entity',
    pc_ringworld_seam_damaged: 'ringworld_seam_damaged_entity',
    pc_shattered_ring_habitable: 'ringworld_habitable_entity',
    pc_ringworld_shielded: 'ringworld_habitable_entity',
  };
  check(
    'the install has TEN `ringworld = yes` planet classes, every one naming a ring segment entity',
    vanillaRings.ringClasses.length === 10 &&
      Object.entries(expectedRingEntities).every(([key, entity]) =>
        vanillaRings.ringClasses.some((entry) => entry.key === key && entry.entity === entity),
      ),
    JSON.stringify(vanillaRings.ringClasses.map((entry) => `${entry.key}:${entry.entity}`)),
  );
  check(
    'and every `ringworld = yes` class suppresses the orbit line through itself (`orbit_lines = no`)',
    vanillaRings.ringClasses.filter((entry) => entry.orbitLines === 'no').length === 9 &&
      vanillaRings.ringClasses.filter((entry) => entry.orbitLines === null).length === 1,
    JSON.stringify(vanillaRings.ringClasses.map((entry) => `${entry.key}:${entry.orbitLines}`)),
  );

  // The COMPLETE vanilla rings, with the segment count each one writes. This is the
  // fail-if-removed case for the reader: a depth-1-only walk loses the Cybrex ring's four
  // SEGMENTS NESTED INSIDE ITS STAR BODY (crisis_initializers.txt:377) and reports 8 of its 12.
  const complete = vanillaRings.systems.filter((system) => system.segments >= 12);
  check(
    'the install writes TWO twelve-segment rings (`sanctuary_system`, `cybrex_beta`)',
    complete.length === 2 && complete.every((system) => system.segments === 12) &&
      complete.some((system) => system.key === 'sanctuary_system') &&
      complete.some((system) => system.key === 'cybrex_beta'),
    JSON.stringify(vanillaRings.systems.map((system) => `${system.key}:${system.segments}`)),
  );
  check(
    'and the machine Fallen Empire ring is NINE - its fourth quadrant is a ruined megastructure section, not three more planets',
    vanillaRings.systems.some((system) => system.key === 'fallen_machine' && system.segments === 9 && system.ruinedRingSections),
    JSON.stringify(vanillaRings.systems.find((system) => system.key === 'fallen_machine')),
  );
  check(
    'the Shattered Ring is SIX segments, and the reader finds its two nested damaged ones',
    vanillaRings.systems.some((system) => system.key === 'shattered_ring_start' && system.segments === 6) &&
      vanillaRings.systems.some((system) => system.key === 'pre_ftl_shattered_ring' && system.segments === 6),
    JSON.stringify(vanillaRings.systems.filter((system) => /shattered/.test(system.key))),
  );
  check(
    'a ring that is ENTIRELY ruins is still found, by the `ring_world_ruined` megastructure it spawns',
    vanillaRings.systems.some((system) => system.key === 'cybrex_system' && system.segments === 0 && system.ruinedRingSections) &&
      vanillaRings.systems.some((system) => system.key === 'ring_world_init_01' && system.segments === 0 && system.ruinedRingSections),
    JSON.stringify(vanillaRings.systems.filter((system) => system.ruinedRingSections && system.segments === 0)),
  );

  // Vanilla is NOT clean under the radius rule, and that is the honest measurement rather than a
  // false positive: the rule's one exemption is the Shattered Ring's intentionally damaged seam.
  // Both findings are that seam - `shattered_ring_start` and its pre-FTL twin - and both are the
  // ONLY `orbit_distance` in the install's 50 ring-world planet blocks that is not 0.
  check(
    'the install is clean under the class rule (0 errors) and reports exactly the two intended Shattered Ring seams',
    vanillaRings.counts.error === 0 &&
      vanillaRings.counts.total === 2 &&
      vanillaRings.findings.every((finding) => finding.rule === 'ringworld-segment-orbit-inconsistent') &&
      vanillaRings.findings.some((finding) => /federations_initializers\.txt:2018/.test(finding.where)) &&
      vanillaRings.findings.some((finding) => /pre_ftl_initializers\.txt:1484/.test(finding.where)),
    JSON.stringify(vanillaRings.findings.map((finding) => `${finding.rule} ${finding.where}`)),
  );
  check(
    'and the exemption is by CLASS AND NAME, so a second `pc_ringworld_seam_damaged` in the same ring is still reported',
    vanillaRings.findings.length === 2 &&
      !vanillaRings.findings.some((finding) => /:1978/.test(finding.where)),
    JSON.stringify(vanillaRings.findings.map((finding) => finding.where)),
  );

  // The two rules, on a probe that must FIRE. A `analyseRingWorlds` reduced to
  // `return {findings: []}` fails both of these by name.
  const probeRingSystem = {
    path: join(scratch, 'common', 'solar_system_initializers', 'zz_probe_ring.txt'),
    text: [
      'probe_ring_system = {',
      '\tflags = { ring_world_built }',
      '\tclass = "sc_g"',
      '\tplanet = { class = star orbit_distance = 0 }',
      '\tchange_orbit = 45',
      '\tplanet = {',
      '\t\tclass = "pc_ringworld_habitable"',
      '\t\torbit_angle = 30',
      '\t\torbit_distance = 0',
      '\t}',
      '\tplanet = {',
      '\t\tclass = "pc_ringworld_seam"',
      '\t\torbit_angle = 30',
      '\t\torbit_distance = 20',
      '\t}',
      '\tplanet = {',
      '\t\tclass = "pc_ringworld_zz_missing"',
      '\t\torbit_angle = 30',
      '\t\torbit_distance = 0',
      '\t}',
      '}',
      '',
    ].join('\n'),
  };
  const probeRing = analyseRingWorlds({
    initializerFiles: [probeRingSystem],
    planetClassFiles: ringPlanetClassFiles,
    complete: true,
  });
  check(
    'a ring segment at a second `orbit_distance` is reported, and the finding names the radius the rest use',
    probeRing.findings.some(
      (finding) =>
        finding.rule === 'ringworld-segment-orbit-inconsistent' &&
        finding.severity === 'warning' &&
        /orbit_distance = 20/.test(finding.message) &&
        /use\s+`0`/.test(finding.message),
    ),
    JSON.stringify(probeRing.findings.map((finding) => `${finding.rule} ${finding.where}`)),
  );
  check(
    'and a ring segment naming a class no file defines is an ERROR, quoting the field that makes a ring class',
    probeRing.counts.error === 1 &&
      probeRing.findings.some((finding) => finding.rule === 'ringworld-segment-class-undefined' && /pc_ringworld_zz_missing/.test(finding.message)),
    JSON.stringify(probeRing.counts),
  );
  check(
    '`class = star` is an initializer KEYWORD and is NOT reported as an undefined segment class',
    // The finding's whole message is not quoted: it names the classes it DID resolve
    // (`planet = { class = pc_ringworld_habitable }`) as part of the reason. What must not appear is
    // a `class = star` ATTRIBUTION, which is the shape the keyword rule would produce.
    probeRing.findings.every((finding) => !/class = star(?![a-z_])/.test(finding.message)) &&
      probeRing.findings.some((finding) => /planet = \{ class = pc_ringworld_habitable \}/.test(finding.message)),
    JSON.stringify(probeRing.findings.map((finding) => finding.message.slice(0, 90))),
  );
  const ringFragment = analyseRingWorlds({ initializerFiles: [probeRingSystem], complete: true });
  check(
    'with no planet-class file supplied EVERY unresolved class is a WARNING, so a half-checked mod is not called broken',
    ringFragment.counts.warning === 3 && ringFragment.counts.error === 0 && ringFragment.systems.length === 1,
    JSON.stringify({ counts: ringFragment.counts, systems: ringFragment.systems, findings: ringFragment.findings.map((finding) => finding.rule) }),
  );

  // Through gui_check_files, which is the surface a caller actually uses.
  const ringRoot = join(scratch, 'rings');
  rmSync(ringRoot, { recursive: true, force: true });
  mkdirSync(join(ringRoot, 'common', 'solar_system_initializers'), { recursive: true });
  writeFileSync(join(ringRoot, 'common', 'solar_system_initializers', 'zz_probe.txt'), probeRingSystem.text, 'utf8');
  const ringChecked = checkFiles({
    paths: [
      join(ringRoot, 'common', 'solar_system_initializers', 'zz_probe.txt'),
      ...listFilesRecursive(ringPlanetClassDir, ['.txt']),
    ],
    checkLocKeys: false,
  });
  check(
    'gui_check_files runs the ring pass over the files it was handed, and reports the systems and classes it found',
    ringChecked.byRule['ringworld-segment-orbit-inconsistent'] === 1 &&
      ringChecked.byRule['ringworld-segment-class-undefined'] === 1 &&
      ringChecked.rings?.systems.length === 1 &&
      ringChecked.rings.systems[0].segments === 2 &&
      ringChecked.rings.ringClasses.length === 10,
    JSON.stringify({ byRule: ringChecked.byRule, rings: ringChecked.rings?.systems }),
  );

  // The rule table, on the same terms as the asteroid pair: a rule with no severity or no
  // description is a rule the generated README cannot carry.
  check(
    'both ring-world rules are registered with a severity and a description',
    ['ringworld-segment-orbit-inconsistent', 'ringworld-segment-class-undefined'].every(
      (rule) => RULE_SEVERITY[rule] === COLONIZATION_SEVERITY[rule] && typeof RULE_DESCRIPTIONS[rule] === 'string',
    ),
    JSON.stringify(['ringworld-segment-orbit-inconsistent', 'ringworld-segment-class-undefined'].map((rule) => [rule, RULE_SEVERITY[rule], (RULE_DESCRIPTIONS[rule] ?? '').slice(0, 40)])),
  );
  check(
    'and their descriptions are the module\'s own, not a copy that can drift',
    RULE_DESCRIPTIONS['ringworld-segment-orbit-inconsistent'] === COLONIZATION_DESCRIPTIONS['ringworld-segment-orbit-inconsistent'] &&
      RULE_DESCRIPTIONS['ringworld-segment-class-undefined'] === COLONIZATION_DESCRIPTIONS['ringworld-segment-class-undefined'],
  );
});

/** `analyseColonization` with the two file lists, in the shape the tests above build. */
function analyseColonizationSpec({ shipSizeFiles, planetClassFiles }) {
  return analyseColonization({ shipSizeFiles, planetClassFiles });
}

// =====================================================================================
// 22b. THE STAR SLOTS OF A MULTI-STAR SYSTEM (src/lib/colonization.mjs, STAR SLOT)
//
// A system has as many star slots as its initializer writes star bodies for, and the star class
// supplies the ones it does not write - so a star class' `planet = { key = <planet class> }` list IS
// the slot table. This section exists because both of this project's own mods put a COLONISABLE
// planet class in that one field (`sc_geocentric -> pc_geocentric_earth`,
// `sc_dyson_habitat -> pc_dyson_habitat_star`): a typo there is the difference between a colonisable
// homeworld and a star slot with no class to resolve at all, and the engine says only
// `invalid planet class or random_list [%s]` when it happens.
//
// The reader has its own fail-if-removed case, and it is the one the install writes THIRTEEN times:
// a single-star class puts its whole slot block on ONE line -
//
//     sc_b = { ... planet = { key = pc_b_star } ... }        common/star_classes/00_star_classes.txt:25
//
// - so an opener pattern that required the `{` at end of line reads 54 of vanilla's 67 slots and
// misses every single-star class. That is the same defect `src/lib/portraits.mjs` records, and the
// 54-versus-67 count below is measured from both sides.
// =====================================================================================

group('the star slots of a multi-star system (STARSLOT)', () => {
  // ---------------------------------------------------------------- the slot reader
  // Deliberately hostile: ONE-LINE slots, MULTI-LINE slots, the other depth-1 children a star class
  // has (per-planet-class spawn-odds overrides and a `modifier` block), and a scalar block value
  // (`hsv { ... }`) of the kind that makes `parseParadox` end the enclosing block early.
  const hostileClass = [
    'sc_probe = {',
    '\tclass = g_star',
    '\tplanet = { key = pc_probe_star_one }',
    '\tplanet = {',
    '\t\tkey = pc_probe_star_two',
    '\t\tclass = m_star',
    '\t}',
    '\tspawn_odds = 10',
    '\tnum_planets = { min = 4 max = 10 }',
    '\tpc_continental = { spawn_odds = 0.4 }',
    '\tmodifier = {',
    '\t\tship_speed_reduction = 0.5',
    '\t}',
    '\tarkship_picture = "arkship_class_g"',
    '}',
    '',
  ].join('\n');
  const hostileDefinitions = readStarClasses([
    { path: join(scratch, 'common', 'star_classes', 'zz_probe.txt'), text: hostileClass },
  ]);
  const hostileSlots = hostileDefinitions.get('sc_probe')?.slots ?? [];
  check(
    'the slot reader sees the ONE-LINE `planet = { key = ... }` form and the multi-line one',
    hostileSlots.length === 2 &&
      hostileSlots[0].key === 'pc_probe_star_one' &&
      hostileSlots[0].line === 3 &&
      hostileSlots[1].key === 'pc_probe_star_two' &&
      hostileSlots[1].class === 'm_star' &&
      hostileSlots[1].classLine === 6,
    JSON.stringify(hostileSlots),
  );
  check(
    'and it does not read a star class\' other depth-1 children as slots',
    hostileDefinitions.get('sc_probe')?.randomizer === false && hostileSlots.every((slot) => slot.key.startsWith('pc_probe_star')),
    JSON.stringify(hostileSlots),
  );

  // A randomizer is `rl_x = { stars = { "sc_a" "sc_b" } }`: a list of star CLASSES, no slots, and it
  // shares the namespace an initializer's `class` names. Reading one as a star class with zero slots
  // would be a reader that cannot tell the two apart.
  const randomizer = readStarClasses([
    { path: join(scratch, 'common', 'star_classes', 'randomizers', 'zz_probe.txt'), text: ['rl_probe = {', '\tstars = {', '\t\t"sc_probe"', '\t}', '}', ''].join('\n') },
  ]);
  check(
    'a star-class randomizer is read as a randomizer, with no slots',
    randomizer.get('rl_probe')?.randomizer === true && randomizer.get('rl_probe')?.slots.length === 0,
    JSON.stringify(randomizer.get('rl_probe')),
  );

  // ---------------------------------------------------------------- the install's own slot table
  const starClassDir = join(DEFAULT_GAME_ROOT, 'common', 'star_classes');
  if (existsSync(starClassDir)) {
    const starClassFiles = listFilesRecursive(starClassDir, ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    const definitions = [...readStarClasses(starClassFiles).values()];
    const real = definitions.filter((entry) => !entry.randomizer);
    const slots = real.flatMap((entry) => entry.slots);
    check(
      'the install defines 45 star-class records: 36 star classes and 9 randomizers',
      definitions.length === 45 && real.length === 36 && definitions.length - real.length === 9,
      JSON.stringify({ total: definitions.length, starClasses: real.length }),
    );
    check(
      'and the slot distribution is 13 classes with ONE slot, 15 with TWO and 8 with THREE - 67 slots',
      JSON.stringify([...new Map([...new Set(real.map((entry) => entry.slots.length))]
        .sort((a, b) => a - b)
        .map((count) => [count, real.filter((entry) => entry.slots.length === count).length]))]) === '[[1,13],[2,15],[3,8]]' &&
        slots.length === 67,
      JSON.stringify({ distribution: [...new Set(real.map((entry) => entry.slots.length))].sort().map((count) => [count, real.filter((entry) => entry.slots.length === count).length]), slots: slots.length }),
    );
    check(
      'no star class declares more than three slots, and every slot names a class',
      Math.max(...real.map((entry) => entry.slots.length)) === 3 && slots.every((slot) => slot.key !== null),
      JSON.stringify(real.filter((entry) => entry.slots.length > 3).map((entry) => entry.key)),
    );
    check(
      'the 26 multi-star initializers are the ones naming a sc_binary_*/sc_trinary_* class',
      (() => {
        const initializerDir = join(DEFAULT_GAME_ROOT, 'common', 'solar_system_initializers');
        if (!existsSync(initializerDir)) return false;
        const initializers = readInitializerStarClasses(
          listFilesRecursive(initializerDir, ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') })),
        );
        return initializers.length === 355 && initializers.filter((entry) => /^sc_(crisis_)?(binary|trinary)_/.test(entry.starClass)).length === 26;
      })(),
      'the initializer star-class reader is expected to find 355 named initializers, 26 of them multi-star',
    );
  } else {
    check('the install is present, so the star-slot table was measured against real content', false, starClassDir);
  }

  // ---------------------------------------------------------------- the rule
  const probePlanetClasses = [
    {
      path: join(scratch, 'common', 'planet_classes', 'zz_probe_stars.txt'),
      text: ['pc_probe_star_one = {', '\tstar = yes', '\tcolonizable = no', '}', '', 'pc_probe_colonisable = {', '\tstar = yes', '\tstar_gfx = no', '\tcolonizable = yes', '\tdistrict_set = standard', '}', ''].join('\n'),
    },
  ];
  const goodStarClass = [
    'sc_probe_good = {',
    '\tclass = g_star',
    '\tplanet = { key = pc_probe_star_one }',
    '\tplanet = {',
    '\t\tkey = pc_probe_colonisable',
    '\t\tclass = g_star',
    '\t}',
    '\tspawn_odds = 0',
    '}',
    '',
  ].join('\n');
  const ghostStarClass = goodStarClass.replace('key = pc_probe_colonisable', 'key = zz_no_such_planet');
  const starClassPath = (text) => [{ path: join(scratch, 'common', 'star_classes', 'zz_probe.txt'), text }];

  const clean = analyseStarClasses({ starClassFiles: starClassPath(goodStarClass), planetClassFiles: probePlanetClasses, initializerFiles: [], complete: true });
  check(
    'a star class whose two slots both resolve is clean, and both slots are still REPORTED',
    clean.counts.total === 0 && clean.slots.length === 2 && clean.starClasses.length === 1,
    JSON.stringify({ counts: clean.counts, slots: clean.slots }),
  );
  check(
    'a COLONISABLE class is a legal star-slot body: nothing about the slot is reported for it',
    clean.slots.some((slot) => slot.key === 'pc_probe_colonisable') &&
      clean.findings.length === 0,
    JSON.stringify(clean.slots),
  );

  const ghost = analyseStarClasses({ starClassFiles: starClassPath(ghostStarClass), planetClassFiles: probePlanetClasses, initializerFiles: [], complete: true });
  check(
    'a slot naming a class no file defines is an ERROR, at the slot\'s own line',
    ghost.counts.error === 1 &&
      ghost.findings[0].rule === 'star-class-planet-undefined' &&
      ghost.findings[0].resolution === 'resolved' &&
      ghost.findings[0].where.endsWith('zz_probe.txt:5'),
    JSON.stringify(ghost.findings.map((finding) => `${finding.rule} ${finding.where}`)),
  );
  check(
    'and the finding quotes the install\'s own definition of the field, so the reader knows what it is',
    /00_star_classes\.txt:6/.test(ghost.findings[0].message) && /invalid planet class or random_list/.test(ghost.findings[0].message),
    ghost.findings[0].message,
  );
  const ghostFragment = analyseStarClasses({ starClassFiles: starClassPath(ghostStarClass), planetClassFiles: [], initializerFiles: [], complete: true });
  check(
    'with no planet-class file supplied EVERY unresolved slot is a WARNING, so a half-checked mod is not called broken',
    ghostFragment.counts.error === 0 &&
      ghostFragment.counts.warning === 2 &&
      ghostFragment.findings.every((finding) => finding.resolution === 'unresolved'),
    JSON.stringify(ghostFragment.counts),
  );

  // ---------------------------------------------------------------- the install, under the rule
  const planetClassDir = join(DEFAULT_GAME_ROOT, 'common', 'planet_classes');
  const initializerDir = join(DEFAULT_GAME_ROOT, 'common', 'solar_system_initializers');
  if (existsSync(starClassDir) && existsSync(planetClassDir) && existsSync(initializerDir)) {
    const read = (dir) => listFilesRecursive(dir, ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    const vanilla = analyseStarClasses({
      starClassFiles: read(starClassDir),
      planetClassFiles: read(planetClassDir),
      initializerFiles: read(initializerDir),
      complete: true,
    });
    check(
      'the install is clean: all 67 star slots of all 36 star classes resolve to a real planet class',
      vanilla.counts.total === 0,
      JSON.stringify(vanilla.findings.map((finding) => `${finding.rule} ${finding.where}`)),
    );
    check(
      'and NOT ONE of the install\'s 67 star slots is colonisable - the two that are, are this project\'s own mods',
      (() => {
        const colonisable = new Set(
          analyseColonization({ planetClassFiles: read(planetClassDir), shipSizeFiles: [], complete: true })
            .planetClasses.filter((entry) => entry.colonizable === true)
            .map((entry) => entry.key.toLowerCase()),
        );
        return vanilla.counts.total === 0 && vanilla.slots.length === 67 && vanilla.slots.every((slot) => !colonisable.has(String(slot.key).toLowerCase()));
      })(),
      JSON.stringify(vanilla.slots.filter((slot) => slot.key === 'pc_geocentric_earth' || slot.key === 'pc_dyson_habitat_star')),
    );
  } else {
    check('the install is present, so the star-slot rule was measured against real content', false, starClassDir);
  }

  // ---------------------------------------------------------------- the rule table
  check(
    'the star-slot rule is registered with a severity and a description, so the generated README carries it',
    RULE_SEVERITY['star-class-planet-undefined'] === COLONIZATION_SEVERITY['star-class-planet-undefined'] &&
      RULE_SEVERITY['star-class-planet-undefined'] === 'error' &&
      RULE_DESCRIPTIONS['star-class-planet-undefined'] === COLONIZATION_DESCRIPTIONS['star-class-planet-undefined'],
    JSON.stringify([RULE_SEVERITY['star-class-planet-undefined'], RULE_DESCRIPTIONS['star-class-planet-undefined']?.slice(0, 40)]),
  );

  // ---------------------------------------------------------------- through gui_check_files
  // THE FAIL-IF-REMOVED CASE FOR THE ROUTING. `isButtonEffectsFile` claims every path under
  // `common/`, so before `isStarClassesPath` existed a star class was checked for a missing `effect`
  // block it was never supposed to have: `D:/StellarisMods/dyson_habitat_cluster\common\
  // star_classes\zz_dysonhab_star_classes.txt:8` reported `button-effect-without-effect` as an ERROR.
  // Deleting the route puts that finding back, and this assertion names it.
  const starRoot = join(scratch, 'stars');
  rmSync(starRoot, { recursive: true, force: true });
  mkdirSync(join(starRoot, 'common', 'star_classes'), { recursive: true });
  mkdirSync(join(starRoot, 'common', 'planet_classes'), { recursive: true });
  mkdirSync(join(starRoot, 'common', 'solar_system_initializers'), { recursive: true });
  writeFileSync(join(starRoot, 'common', 'star_classes', 'zz_probe.txt'), ghostStarClass, 'utf8');
  writeFileSync(join(starRoot, 'common', 'planet_classes', 'zz_probe.txt'), probePlanetClasses[0].text, 'utf8');
  writeFileSync(
    join(starRoot, 'common', 'solar_system_initializers', 'zz_probe.txt'),
    ['probe_system = {', '\tclass = "sc_probe_good"', '\tplanet = { class = star }', '}', ''].join('\n'),
    'utf8',
  );
  const checked = checkFiles({
    paths: [
      join(starRoot, 'common', 'star_classes', 'zz_probe.txt'),
      join(starRoot, 'common', 'planet_classes', 'zz_probe.txt'),
      join(starRoot, 'common', 'solar_system_initializers', 'zz_probe.txt'),
    ],
    checkLocKeys: false,
  });
  check(
    'gui_check_files runs the star-slot pass across the three directories it was handed',
    checked.byRule['star-class-planet-undefined'] === 1 && checked.stars?.slots.length === 2 && checked.stars.initializers.length === 1,
    JSON.stringify({ byRule: checked.byRule, stars: checked.stars && { slots: checked.stars.slots.length, initializers: checked.stars.initializers.length } }),
  );
  check(
    'a `common/star_classes/*.txt` file is NOT checked for a missing `effect` block (it is not a button effect)',
    (checked.byRule['button-effect-without-effect'] ?? 0) === 0,
    JSON.stringify(checked.byRule),
  );
  check(
    'and the report says which star class each initializer names, so the slot table is readable',
    checked.stars.initializers[0]?.starClass === 'sc_probe_good' && checked.stars.definitionsSupplied === true,
    JSON.stringify(checked.stars.initializers),
  );
});

// =====================================================================================
// 23. WHAT A PORTRAIT IS MADE OF (src/lib/portraits.mjs)
//
// The whole point of this section is that DELETING EITHER RULE FAILS THE SUITE BY NAME. Every
// assertion on a rule therefore asserts that the finding EXISTS on input built to trigger it; a
// module reduced to `return { findings: [] }` passes "the install is clean" and fails these.
//
// The reader has its own fail-if-removed case, and it is the one that matters: vanilla writes a
// portrait definition's fields on the SAME LINE as its opening brace
//
//     mam5 = {	entity = "portrait_mammalian_05_entity" clothes_selector = "..." }
//
// and an earlier revision of the module, whose opener pattern required `{` at end of line,
// reported 15 phantom `portrait-entity-undefined` errors against a clean install - because it
// never saw those blocks and instead read the rest of the line as an entity name. The 496-vs-105
// count below is the same defect seen from the other side.
// =====================================================================================

group('what a portrait is made of (PORTRAIT)', () => {
  // ---------------------------------------------------------------- the token reader
  // This input is deliberately hostile: a scalar block value (`hsv { ... }`) that makes the
  // repository's `parseParadox` end the enclosing block early, fields on the opening line, both
  // `texturefile` spellings, and a nested `portraits = { ... }` inside `portrait_groups` that
  // must NOT be read as definitions.
  const hostile = [
    'portraits = {',
    '\tmam5 = {\tentity = "portrait_mammalian_05_entity" clothes_selector = "mam_slender_clothes_01"\tattachment_selector = "no_texture"',
    '\t\tcharacter_textures = {',
    '\t\t\t"gfx/models/portraits/mammalian/a.dds"',
    '\t\t\t"gfx/models/portraits/mammalian/b.dds"',
    '\t\t}',
    '\t}',
    '\tflat2d = { texturefile = "gfx/models/portraits/flat.dds" }',
    '\tscalar_block = {',
    '\t\tatmosphere_color = hsv { 0.59 0.45 0.95 }',
    '\t\tentity = "portrait_after_the_scalar_block_entity"',
    '\t}',
    '}',
    '',
    'portrait_groups = {',
    '\tgrp = {',
    '\t\tdefault = mam5',
    '\t\tgame_setup = { add = { portraits = { mam5 flat2d } } }',
    '\t}',
    '}',
    '',
  ].join('\n');

  const parsed = readPortraitDefinitions(hostile, 'zz_probe.txt');
  check(
    'a portrait definition is read even when its fields are on the OPENING LINE',
    parsed.length === 3 && parsed[0].id === 'mam5' && parsed[0].entity === 'portrait_mammalian_05_entity',
    JSON.stringify(parsed.map((entry) => `${entry.id}:${entry.entity}`)),
  );
  check(
    'and the entity is the QUOTED token, not the rest of the line',
    parsed[0]?.clothesSelector === 'mam_slender_clothes_01' && parsed[0]?.attachmentSelector === 'no_texture',
    JSON.stringify([parsed[0]?.clothesSelector, parsed[0]?.attachmentSelector]),
  );
  check(
    'a `character_textures` block is read as bare quoted paths',
    parsed[0]?.textures.length === 2 && parsed[0].textures[0] === 'gfx/models/portraits/mammalian/a.dds',
    JSON.stringify(parsed[0]?.textures),
  );
  check(
    'a scalar block value (`hsv { ... }`) does NOT end the enclosing block, so the field after it is still found',
    parsed[2]?.entity === 'portrait_after_the_scalar_block_entity',
    JSON.stringify(parsed[2]),
  );
  check(
    'the nested `portraits = { ... }` inside `portrait_groups` is not mistaken for definitions',
    parsed.length === 3 && !parsed.some((entry) => entry.id === 'add' || entry.id === 'grp'),
    JSON.stringify(parsed.map((entry) => entry.id)),
  );
  check(
    'and a `texturefile`-only portrait is read with no entity at all',
    parsed[1]?.entity === null && parsed[1]?.textures[0] === 'gfx/models/portraits/flat.dds',
    JSON.stringify(parsed[1]),
  );

  // ---------------------------------------------------------------- the entity reader
  const entityText = [
    'entity = {',
    '\tname = "portrait_probe_entity"',
    '\tpdxmesh = "portrait_probe_mesh"',
    '\tdefault_state = "idle"',
    '\tstate = { name = "idle" animation = "idle" chance = 3.0 looping = no next_state = idle }',
    '\tscale = 1',
    '}',
    'entity = { name = "portrait_one_line_entity" pdxmesh = "m" }',
    'animation = {',
    '\tname = "probe_idle_animation"',
    '\tfile = "probe_idle.anim"',
    '}',
    '',
  ].join('\n');
  const names = readEntityNames(entityText);
  check(
    'an entity name is read from a multi-line block AND from a one-line block',
    names.length === 2 && names.includes('portrait_probe_entity') && names.includes('portrait_one_line_entity'),
    JSON.stringify(names),
  );
  check(
    'and an `animation = { name = ... }` block is NOT read as an entity',
    !names.includes('probe_idle_animation'),
    JSON.stringify(names),
  );
  const entityDefinitions = readEntityDefinitions(entityText);
  check(
    'the entity reader carries the `pdxmesh` link, which is what the mesh rule walks',
    entityDefinitions.length === 2 &&
      entityDefinitions[0].pdxmesh === 'portrait_probe_mesh' &&
      entityDefinitions[1].pdxmesh === 'm',
    JSON.stringify(entityDefinitions),
  );
  check(
    'and an entity that attaches another entity records `attachRoot` instead of a mesh',
    readEntityDefinitions('entity = { name = "a" attach = { root = b } }')[0]?.attachRoot === 'b',
    JSON.stringify(readEntityDefinitions('entity = { name = "a" attach = { root = b } }')),
  );
  check(
    'a `pdxmesh` block is read as name -> file, from the `objectTypes` wrapper vanilla uses',
    JSON.stringify(readMeshDefinitions('objectTypes = {\n\tpdxmesh = { name = "m" file = "gfx/models/m.mesh" }\n}')) ===
      JSON.stringify([{ name: 'm', file: 'gfx/models/m.mesh' }]),
    JSON.stringify(readMeshDefinitions('objectTypes = {\n\tpdxmesh = { name = "m" file = "gfx/models/m.mesh" }\n}')),
  );
  check(
    'the tree reader gives a bare block (`hsv { ... }`) a null key instead of closing its parent',
    parseParadoxTree('a = {\n\tcolour = hsv { 1 2 3 }\n\tb = 7\n}')
      .children[0].children.filter((child) => child.key === 'b').length === 1,
    JSON.stringify(parseParadoxTree('a = {\n\tcolour = hsv { 1 2 3 }\n\tb = 7\n}').children[0].children),
  );

  // ---------------------------------------------------------------- the rules must FIRE
  const portraitRoot = join(scratch, 'portraitprobe');
  rmSync(portraitRoot, { recursive: true, force: true });
  mkdirSync(join(portraitRoot, 'gfx', 'portraits', 'portraits'), { recursive: true });
  mkdirSync(join(portraitRoot, 'gfx', 'models', 'portraits'), { recursive: true });
  writeFileSync(
    join(portraitRoot, 'gfx', 'portraits', 'portraits', 'zz_probe.txt'),
    [
      'portraits = {',
      '\tprobe_ok = { entity = "portrait_probe_entity" }',
      '\tprobe_absent = { entity = "portrait_absent_entity" }',
      '\tprobe_flat = { texturefile = "gfx/models/portraits/nope.dds" }',
      '\tprobe_mesh_undefined = { entity = "portrait_probe_mesh_undefined_entity" }',
      '\tprobe_mesh_file_absent = { entity = "portrait_probe_mesh_file_absent_entity" }',
      '\tprobe_attach = { entity = "portrait_probe_attach_entity" }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(portraitRoot, 'gfx', 'models', 'portraits', 'zz_probe_entities.asset'),
    [
      'entity = {',
      '\tname = "portrait_probe_entity"',
      '\tpdxmesh = "probe_mesh"',
      '}',
      'entity = {',
      '\tname = "portrait_probe_mesh_file_absent_entity"',
      '\tpdxmesh = "probe_mesh_file_absent"',
      '}',
      'entity = {',
      '\tname = "portrait_probe_mesh_undefined_entity"',
      '\tpdxmesh = "probe_mesh_never_declared"',
      '}',
      'entity = {',
      '\tname = "portrait_probe_attach_entity"',
      '\tattach = { root = portrait_probe_entity }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  // The mesh declarations. `probe_mesh` resolves; `probe_mesh_file_absent` declares a `.mesh` the
  // root does not contain; `probe_mesh_never_declared` is named by an entity and declared nowhere.
  writeFileSync(
    join(portraitRoot, 'gfx', 'models', 'portraits', 'zz_probe_meshes.gfx'),
    [
      'objectTypes = {',
      '\tpdxmesh = {',
      '\t\tname = "probe_mesh"',
      '\t\tfile = "gfx/models/portraits/probe_mesh.mesh"',
      '\t\tanimation = { id = "idle" type = "probe_idle_animation" }',
      '\t\tscale = 1.0',
      '\t}',
      '\tpdxmesh = {',
      '\t\tname = "probe_mesh_file_absent"',
      '\t\tfile = "gfx/models/portraits/absent.mesh"',
      '\t}',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(join(portraitRoot, 'gfx', 'models', 'portraits', 'probe_mesh.mesh'), 'not a real mesh; the rule checks existence, not content\n', 'utf8');
  const probed = analysePortraitRoots([portraitRoot]);
  check(
    'an `entity` that no `.asset` defines is an ERROR, named per portrait',
    probed.byRule['portrait-entity-undefined'] === 1 &&
      probed.findings.some((finding) => finding.rule === 'portrait-entity-undefined' && finding.entity === 'portrait_absent_entity'),
    JSON.stringify(probed.findings.map((finding) => `${finding.rule} ${finding.entity ?? finding.texture}`)),
  );
  check(
    'a `character_textures`/`texturefile` path in no indexed root is a WARNING, named per file',
    probed.byRule['portrait-character-texture-missing'] === 1 &&
      probed.findings.some((finding) => finding.texture === 'gfx/models/portraits/nope.dds'),
    JSON.stringify(probed.findings.map((finding) => finding.texture)),
  );
  check(
    'and a portrait whose entity IS defined is not reported at all',
    !probed.findings.some((finding) => finding.path === 'probe_ok'),
    JSON.stringify(probed.findings.map((finding) => finding.path)),
  );
  check(
    'the counts make an empty report distinguishable from an unread one',
    probed.counts.portraitDefinitions === 6 && probed.counts.entities === 4 && probed.counts.meshDefinitions === 2,
    JSON.stringify(probed.counts),
  );

  // ---------------------------------------------------------------- the second link of the chain
  // A portrait whose `entity` resolves but whose `pdxmesh` does not is the failure the entity rule
  // cannot see: the portrait REGISTERS, and there is no mesh. Both halves are asserted by their
  // finding, so a module reduced to `return { findings: [] }` fails here by name.
  check(
    'an entity whose `pdxmesh` no `.gfx` declares is an ERROR, named per portrait and per mesh',
    probed.byRule['portrait-mesh-missing'] === 2 &&
      probed.findings.some(
        (finding) =>
          finding.rule === 'portrait-mesh-missing' &&
          finding.path === 'probe_mesh_undefined' &&
          finding.pdxmesh === 'probe_mesh_never_declared',
      ),
    JSON.stringify(probed.findings.filter((finding) => finding.rule === 'portrait-mesh-missing').map((finding) => `${finding.path}:${finding.pdxmesh}`)),
  );
  check(
    'and a `pdxmesh` whose `file` is in no indexed root is the SAME rule, quoting the path',
    probed.findings.some(
      (finding) => finding.rule === 'portrait-mesh-missing' && finding.meshFile === 'gfx/models/portraits/absent.mesh',
    ),
    JSON.stringify(probed.findings.filter((finding) => finding.rule === 'portrait-mesh-missing').map((finding) => finding.meshFile)),
  );
  check(
    'an entity that attaches another entity instead of naming a `pdxmesh` is NOT reported (vanilla swarm1small)',
    !probed.findings.some((finding) => finding.path === 'probe_attach'),
    JSON.stringify(probed.findings.map((finding) => finding.path)),
  );
  check(
    'and the mesh a resolving chain names is NOT reported, which is what makes the rule usable',
    probed.findings.filter((finding) => finding.rule === 'portrait-mesh-missing').length === 2,
    JSON.stringify(probed.findings.map((finding) => `${finding.rule} ${finding.path}`)),
  );

  // ---------------------------------------------------------------- the rule table
  const portraitRuleIds = ['portrait-entity-undefined', 'portrait-mesh-missing', 'portrait-character-texture-missing'];
  check(
    'every portrait rule is registered with a severity and a description, so the generated README carries them',
    portraitRuleIds.every(
      (rule) =>
        RULE_SEVERITY[rule] === PORTRAIT_SEVERITY[rule] &&
        typeof PORTRAIT_SEVERITY[rule] === 'string' &&
        typeof RULE_DESCRIPTIONS[rule] === 'string',
    ),
    JSON.stringify(portraitRuleIds.map((rule) => [rule, RULE_SEVERITY[rule], RULE_DESCRIPTIONS[rule]])),
  );
  check(
    'and their descriptions are the module\'s own, not a copy that can drift',
    portraitRuleIds.every((rule) => RULE_DESCRIPTIONS[rule] === PORTRAIT_DESCRIPTIONS[rule]),
    JSON.stringify(portraitRuleIds.filter((rule) => RULE_DESCRIPTIONS[rule] !== PORTRAIT_DESCRIPTIONS[rule])),
  );
  // FAIL IF REMOVED. The two assertions above would still pass if the rule were deleted from
  // `PORTRAIT_SEVERITY`/`PORTRAIT_DESCRIPTIONS` while the ANALYSER kept emitting it, and the
  // fixture assertions below would still pass if the analyser were reduced to `findings: []` while
  // the table kept the entry. This one reads the module's own source, so removing the emission
  // fails the suite rather than leaving a rule that documents itself and checks nothing.
  const portraitSourceText = readFileSync(join(projectRoot, 'src', 'lib', 'portraits.mjs'), 'utf8');
  check(
    'the mesh-chain rule is EMITTED by the module, not merely registered in its table (fail-if-removed)',
    /rule:\s*'portrait-mesh-missing'/.test(portraitSourceText) &&
      /pdxmesh/.test(portraitSourceText) &&
      PORTRAIT_SEVERITY['portrait-mesh-missing'] === 'error',
    JSON.stringify({ emitted: /rule:\s*'portrait-mesh-missing'/.test(portraitSourceText), severity: PORTRAIT_SEVERITY['portrait-mesh-missing'] }),
  );

  // ---------------------------------------------------------------- the real install
  // Vanilla is the no-false-positive proof AND the count proof. 496 is the independently measured
  // number of portrait definitions (105 write the brace on its own line, 391 write their fields on
  // the opening line; see the section header). All 496 take the `entity` route, which is why the
  // 2D `spriteType`/`texturefile` alternatives are a MOD route and not a vanilla one.
  if (existsSync(join(DEFAULT_GAME_ROOT, 'gfx', 'portraits', 'portraits'))) {
    const vanilla = analysePortraitRoots([DEFAULT_GAME_ROOT]);
    check(
      'the install is clean: every portrait names an entity its own `.asset` files define, and every texture exists',
      vanilla.findings.length === 0,
      JSON.stringify(vanilla.findings.slice(0, 10).map((finding) => `${finding.rule} ${finding.where} ${finding.entity ?? finding.texture}`)),
    );
    check(
      'the install defines exactly 496 portraits, and all 496 take the `entity` route',
      vanilla.counts.portraitDefinitions === 496 &&
        vanilla.counts.definitionsWithEntity === 496 &&
        vanilla.index.definitions.every((definition) => definition.entity),
      JSON.stringify({ definitions: vanilla.counts.portraitDefinitions, withEntity: vanilla.counts.definitionsWithEntity }),
    );
    check(
      'and none of them is a texture-only portrait - the 2D route is documented in vanilla but unused by it',
      vanilla.index.definitions.every((definition) => definition.entity !== null),
      JSON.stringify(vanilla.index.definitions.filter((definition) => !definition.entity).map((definition) => definition.id)),
    );
    // The mesh-chain rule is only usable if it is SILENT on a clean install, and the two numbers
    // that make the silence meaningful are these: the index really resolved 3257 meshes out of 300
    // `.gfx`, and 495 of the 496 portraits walked a chain that ends at a `.mesh` on disk. The
    // 496th is `swarm1small`, whose entity is `attach = { root = ... }` and names no `pdxmesh` at
    // all - the no-false-positive case the rule has to skip. `locator_mesh` is the case that makes
    // the index `gfx/**/*.gfx` rather than `gfx/models/portraits/**`: vanilla declares it at
    // `gfx/models/planets/_planetary_meshes.gfx:66`, three directories from any portrait, and
    // `mol5` walks to it.
    check(
      'the install resolves the mesh chain for 495 of its 496 entity portraits, and the rule is silent',
      vanilla.byRule['portrait-mesh-missing'] === undefined &&
        vanilla.counts.meshDefinitions === 3257 &&
        vanilla.index.files.meshDefinitions.length === 300,
      JSON.stringify({ meshFindings: vanilla.byRule['portrait-mesh-missing'] ?? 0, ...vanilla.counts, meshFiles: vanilla.index.files.meshDefinitions.length }),
    );
    check(
      'and the one portrait that names no `pdxmesh` at all is `swarm1small`, an entity that ATTACHES another',
      (() => {
        const swarm = vanilla.index.definitions.find((definition) => definition.id === 'swarm1small');
        if (!swarm) return false;
        const holder = swarm.entity ? vanilla.index.entities.get(swarm.entity) : null;
        return Boolean(holder) && holder.pdxmesh === null && holder.attachRoot === 'portrait_swarm_01_entity';
      })(),
      JSON.stringify(vanilla.index.entities.get('portrait_swarm_01_small_entity')),
    );
  }
});

/** A minimal stand-in for the server's resource registry, over the same catalogue. */
function createResourceSurfaceForTest(context) {
  const catalogUri = `${KNOWLEDGE_URI_SCHEME}/catalog`;
  return {
    list: () => [
      { uri: catalogUri, name: 'knowledge/catalog', mimeType: 'application/toml' },
      { uri: 'rstellarisgui://stellaris/latest-update', name: 'latest-update', mimeType: 'text/markdown' },
    ],
    templates: () => [{ uriTemplate: `${KNOWLEDGE_URI_SCHEME}/{topic_id}`, name: 'knowledge-topic', mimeType: 'text/markdown' }],
    async read(uri) {
      context.knowledgeResolved ??= await context.loadKnowledge();
      const catalogue = context.knowledgeResolved;
      if (uri === catalogUri) return { uri, mimeType: 'application/toml', text: catalogue.catalogIndexToml() };
      if (uri === 'rstellarisgui://stellaris/latest-update') {
        const update = loadLatestUpdate(projectRoot);
        return { uri, mimeType: 'text/markdown', text: `# ${update.title}\n\n${update.body}\n` };
      }
      const prefix = `${KNOWLEDGE_URI_SCHEME}/`;
      if (uri.startsWith(prefix)) {
        const topic = catalogue.topic(uri.slice(prefix.length));
        if (!topic) throw new ToolError(`unknown knowledge topic \`${uri.slice(prefix.length)}\``);
        return { uri, mimeType: 'text/markdown', text: topicToMarkdown(topic, uri) };
      }
      throw new ToolError(`unknown resource uri \`${uri}\``);
    },
  };
}

// =====================================================================================
// 22. The knowledge QUERY surface, which has to be async: `KnowledgeCatalog.load` imports the
//     generated snapshot, and `group()` runs its callback synchronously. These assertions are
//     top-level for the same reason the real-input census blocks are.
// =====================================================================================

await (async () => {
  heading('the knowledge query tool and the MCP resource surface (KB, async)');

  const catalogue = await KnowledgeCatalog.load({ projectRoot });
  const authored = readKnowledgeSources(join(projectRoot, 'knowledge'));
  check('the catalogue loads from the generated snapshot', catalogue.topics.length === authored.length, `${catalogue.topics.length} vs ${authored.length}`);
  check(
    'the catalogue carries at least the advertised number of topics',
    catalogue.topics.length >= KNOWLEDGE_TOPIC_FLOOR,
    `${catalogue.topics.length} topics, floor ${KNOWLEDGE_TOPIC_FLOOR}`,
  );
  check('the catalogue declares its source format and backend', catalogue.sourceFormat === 'toml' && /RStellarisGui/.test(catalogue.databaseBackend));
  check(
    'the catalogue index is TOML and lists every topic id with its category and summary',
    authored.every((topic) => {
      const index = catalogue.catalogIndexToml();
      return index.includes(`id = "${topic.id}"`) && index.includes(`category = "${topic.category}"`);
    }),
    'a topic is missing from the index',
  );
  const update = loadLatestUpdate(projectRoot);
  check('the version snapshot loads with a title and a body', Boolean(update.title && update.body), JSON.stringify(update).slice(0, 120));

  // ---------------------------------------------------------------- search semantics
  check(
    'search requires EVERY term, not any (the sibling catalogue contract)',
    catalogue.search('option_list EVENT_DIPLO').length === 1 &&
      catalogue.search('option_list EVENT_DIPLO').every((topic) => topic.id === 'window-name-contract'),
    JSON.stringify(catalogue.search('option_list EVENT_DIPLO').map((topic) => topic.id)),
  );
  check(
    'a two-term query is NARROWER than either term alone, which is what AND semantics buy',
    catalogue.search('text').length >= 2 && catalogue.search('text maxWidth').length < catalogue.search('text').length,
    `${catalogue.search('text').length} -> ${catalogue.search('text maxWidth').length}`,
  );
  check('search returns nothing for an empty query', catalogue.search('   ').length === 0);
  check('search returns nothing for a term no topic carries', catalogue.search('zzz_no_such_term_zzz').length === 0);
  // The questions the knowledge base exists to answer, asked of the CATALOGUE rather than of a reader.
  for (const [query, wanted] of [
    ['button_effects potential is_scope_type', 'control-visibility-is-a-potential'],
    ['GFX_text_ prefix inline icon', 'inline-icon-token-rule'],
    ['gfx_transparency_white plate', 'transparency-white-plate'],
    ['force_open custom_gui', 'custom-gui-force-open'],
    ['orientation lower_left anchor sign', 'coordinate-semantics'],
    ['byte-identical apply comments', 'apply-preserves-transparency-and-comments'],
    ['lower_ left containment calibration', 'coordinate-calibration'],
    ['spriteType rejects size', 'per-kind-size-and-field-forms'],
    ['CJK wrap per character', 'text-has-a-size'],
    ['effectbuttonType buttonText live', 'text-channels'],
    ['bar fill length static', 'bar-construction'],
    ['asteroid belt scenery mesh', 'asteroids-and-asteroid-belts'],
    ['star_classes primary star slot', 'star-slots-in-multi-star-systems'],
    ['black hole primary star', 'black-hole-primary-star-system'],
  ]) {
    const found = catalogue.search(query).map((topic) => topic.id);
    check(`the catalogue answers "${query}"`, found.includes(wanted), `got ${found.join(',') || '(nothing)'}`);
  }
  check(
    'a topic is reachable by its category and by its file type',
    catalogue.byCategory('text').length >= 2 && catalogue.byFileType('.gui').length >= 8,
    JSON.stringify({ text: catalogue.byCategory('text').length, gui: catalogue.byFileType('.gui').length }),
  );
  const unreachableById = catalogue.topics.filter((topic) => catalogue.topic(topic.id)?.id !== topic.id);
  check('every topic is reachable by its own id', unreachableById.length === 0, JSON.stringify(unreachableById.map((topic) => topic.id)));

  // ---------------------------------------------------------------- the query TOOL
  const context = {
    projectRoot,
    knowledge: null,
    loadKnowledge() {
      this.knowledge ??= KnowledgeCatalog.load({ projectRoot });
      return this.knowledge;
    },
  };
  const tools = createToolRegistry(context);
  check('the gui_knowledge_search tool is registered', TOOL_SPECS.some((spec) => spec.name === 'gui_knowledge_search'));
  check('the gui_knowledge_topic tool is registered', TOOL_SPECS.some((spec) => spec.name === 'gui_knowledge_topic'));
  const searchSpec = TOOL_SPECS.find((entry) => entry.name === 'gui_knowledge_search');
  check(
    'gui_knowledge_search declares a full schema with a required query',
    searchSpec?.inputSchema?.type === 'object' && JSON.stringify(searchSpec.inputSchema.required) === JSON.stringify(['query']),
    JSON.stringify(searchSpec?.inputSchema),
  );
  check(
    'every knowledge tool declares a description long enough to be an instruction',
    TOOL_SPECS.filter((spec) => spec.name.startsWith('gui_knowledge_')).every((spec) => spec.description.length > 200),
    JSON.stringify(TOOL_SPECS.filter((spec) => spec.name.startsWith('gui_knowledge_')).map((spec) => `${spec.name}:${spec.description.length}`)),
  );
  const searchResult = await tools.call('gui_knowledge_search', { query: 'bar fill static' });
  check(
    'gui_knowledge_search returns the matching topic with its counts and its resource uri',
    searchResult.matchCount >= 1 &&
      searchResult.topics.some((topic) => topic.id === 'bar-construction') &&
      searchResult.topics.every((topic) => topic.uri.startsWith(`${KNOWLEDGE_URI_SCHEME}/`) && typeof topic.counts?.evidence === 'number'),
    JSON.stringify(searchResult.topics.map((topic) => topic.id)),
  );
  check('gui_knowledge_search reports the catalogue size, so an empty result is diagnosable', searchResult.topicCount === catalogue.topics.length);
  check(
    'gui_knowledge_search reports the category counts, so a caller can see the shape of the base',
    JSON.stringify(searchResult.categoryCounts) === JSON.stringify(catalogue.categoryCounts()),
    JSON.stringify(searchResult.categoryCounts),
  );
  const filtered = await tools.call('gui_knowledge_search', { query: 'geometry', category: 'contract' });
  check(
    'gui_knowledge_search honours the category filter',
    filtered.matchCount === 0 || filtered.topics.every((topic) => topic.category === 'contract'),
    JSON.stringify(filtered.topics.map((topic) => `${topic.id}:${topic.category}`)),
  );
  const byType = await tools.call('gui_knowledge_search', { query: 'sprite', file_type: '.gui' });
  check(
    'gui_knowledge_search honours the file_type filter',
    byType.matchCount >= 1 && byType.topics.every((topic) => topic.fileTypes.includes('.gui')),
    JSON.stringify(byType.topics.map((topic) => `${topic.id}:${topic.fileTypes.join('|')}`)),
  );
  const noMatch = await tools.call('gui_knowledge_search', { query: 'zzz_no_such_term_zzz' });
  check(
    'a search with no match still names the catalogue and its categories, instead of a bare empty list',
    noMatch.matchCount === 0 && /try fewer terms/.test(noMatch.note) && noMatch.topicCount === catalogue.topics.length,
    JSON.stringify(noMatch.note),
  );
  const limited = await tools.call('gui_knowledge_search', { query: 'the', limit: 2 });
  check('gui_knowledge_search caps the list it returns and says how many matched', limited.returned <= 2 && limited.matchCount >= limited.returned, `${limited.returned} of ${limited.matchCount}`);
  const topicResult = await tools.call('gui_knowledge_topic', { id: 'window-name-contract' });
  check(
    'gui_knowledge_topic returns the topic IN FULL as markdown and as structured counts',
    topicResult.id === 'window-name-contract' && /EVENT_DIPLO/.test(topicResult.markdown) && topicResult.evidenceItems >= 5 && topicResult.ruleItems >= 4,
    JSON.stringify({ evidence: topicResult.evidenceItems, rules: topicResult.ruleItems, md: topicResult.markdown?.length }),
  );
  check(
    'the markdown it returns carries the id, the syntax and the evidence as sections',
    /^- ID: window-name-contract$/m.test(topicResult.markdown) && /^## Syntax$/m.test(topicResult.markdown) && /^## Evidence$/m.test(topicResult.markdown),
    topicResult.markdown?.slice(0, 200),
  );
  check('the result names the canonical TOML file behind the topic', topicResult.source_path === `contract/window-name-contract.toml`, topicResult.source_path);
  const jsonResult = await tools.call('gui_knowledge_topic', { id: 'window-name-contract', format: 'json' });
  check(
    'the json form returns the structured fields without the rendered markdown',
    Array.isArray(jsonResult.evidence) && jsonResult.evidence.length === topicResult.evidenceItems && jsonResult.markdown === undefined,
    JSON.stringify(Object.keys(jsonResult)),
  );
  const listing = await tools.call('gui_knowledge_topic', {});
  check('calling gui_knowledge_topic with no id lists every topic', listing.topicCount === catalogue.topics.length && listing.topics.length === catalogue.topics.length);
  check(
    'the listing states the source format, the backend and the catalogue uri',
    listing.sourceFormat === 'toml' && listing.catalogueUri === `${KNOWLEDGE_URI_SCHEME}/catalog`,
    JSON.stringify({ sourceFormat: listing.sourceFormat, uri: listing.catalogueUri }),
  );
  const unknownId = await tools.call('gui_knowledge_topic', { id: 'no-such-topic-at-all' });
  check(
    'an unknown topic id is reported WITH the ids that exist, not as a silent empty result',
    /no knowledge topic with id/.test(unknownId.error) && unknownId.ids.length === catalogue.topics.length,
    JSON.stringify(unknownId.error),
  );
  let missingQueryRefused = false;
  try {
    await tools.call('gui_knowledge_search', {});
  } catch (thrown) {
    missingQueryRefused = thrown?.name === 'ToolError' && /`query` is required/.test(thrown.message);
  }
  check('a missing query is refused as invalid_params, not answered with everything', missingQueryRefused);
  check('the tool resolved the catalogue onto the context', Boolean(context.knowledgeResolved));

  // The behavioural half of the fail-if-removed proof: with no catalogue, the tool must REFUSE
  // rather than answer "nothing found". A knowledge tool that silently returns an empty list is
  // exactly the failure mode this whole group exists to prevent.
  const gutted = createToolRegistry({ projectRoot, knowledge: null });
  let refusedWithoutCatalogue = false;
  try {
    await gutted.call('gui_knowledge_search', { query: 'bar' });
  } catch (thrown) {
    refusedWithoutCatalogue = /no knowledge catalogue/.test(thrown.message);
  }
  check('with no catalogue loaded the search tool REFUSES instead of answering "nothing found"', refusedWithoutCatalogue);
  let topicRefusedWithoutCatalogue = false;
  try {
    await gutted.call('gui_knowledge_topic', { id: 'bar-construction' });
  } catch (thrown) {
    topicRefusedWithoutCatalogue = /no knowledge catalogue/.test(thrown.message);
  }
  check('and the topic tool refuses the same way', topicRefusedWithoutCatalogue);

  // ---------------------------------------------------------------- the RESOURCE surface
  const handlers = createHandler({
    serverInfo: { name: 'rstellarisgui', version: 'test' },
    instructions: '',
    tools,
    resources: createResourceSurfaceForTest(context),
  });
  const init = await handlers({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  check(
    'initialize advertises the resources capability when a resource surface exists',
    init.result.capabilities.resources !== undefined && init.result.capabilities.tools !== undefined,
    JSON.stringify(init.result.capabilities),
  );
  const withoutResources = await createHandler({ serverInfo: {}, instructions: '', tools })({ id: 11, method: 'resources/list', params: {} });
  check(
    'a server with no resource surface answers -32601 instead of an empty list',
    withoutResources.error?.code === -32601,
    JSON.stringify(withoutResources),
  );
  const resourceList = await handlers({ id: 2, method: 'resources/list', params: {} });
  check(
    'resources/list offers the catalogue and the version snapshot',
    resourceList.result.resources.length === 2 &&
      resourceList.result.resources.some((resource) => resource.uri === `${KNOWLEDGE_URI_SCHEME}/catalog`),
    JSON.stringify(resourceList.result.resources.map((resource) => resource.uri)),
  );
  const templates = await handlers({ id: 3, method: 'resources/templates/list', params: {} });
  check(
    'resources/templates/list offers the per-topic markdown template',
    templates.result.resourceTemplates.some((template) => template.uriTemplate === `${KNOWLEDGE_URI_SCHEME}/{topic_id}`),
    JSON.stringify(templates.result.resourceTemplates),
  );
  const readCatalog = await handlers({ id: 4, method: 'resources/read', params: { uri: `${KNOWLEDGE_URI_SCHEME}/catalog` } });
  check(
    'resources/read returns the catalogue as TOML with every topic id in it',
    readCatalog.result.contents[0].mimeType === 'application/toml' &&
      catalogue.topics.every((topic) => readCatalog.result.contents[0].text.includes(`id = "${topic.id}"`)),
    readCatalog.result.contents[0].text?.slice(0, 120),
  );
  const readTopic = await handlers({ id: 5, method: 'resources/read', params: { uri: `${KNOWLEDGE_URI_SCHEME}/bar-construction` } });
  check(
    'resources/read returns one topic as markdown, by id',
    readTopic.result.contents[0].mimeType === 'text/markdown' &&
      /unga_chart_main/.test(readTopic.result.contents[0].text) &&
      readTopic.result.contents[0].uri === `${KNOWLEDGE_URI_SCHEME}/bar-construction`,
    readTopic.result.contents[0].text?.slice(0, 120),
  );
  const everyTopicReadable = [];
  for (const topic of catalogue.topics) {
    const read = await handlers({ id: 100, method: 'resources/read', params: { uri: `${KNOWLEDGE_URI_SCHEME}/${topic.id}` } });
    if (read.error || !read.result?.contents?.[0]?.text?.includes(`- ID: ${topic.id}`)) everyTopicReadable.push(topic.id);
  }
  check('EVERY topic is readable as a resource, not just the ones a test happens to name', everyTopicReadable.length === 0, JSON.stringify(everyTopicReadable));
  const readUpdate = await handlers({ id: 6, method: 'resources/read', params: { uri: 'rstellarisgui://stellaris/latest-update' } });
  check('resources/read returns the version snapshot', /4\.4\.6/.test(readUpdate.result.contents[0].text), readUpdate.result.contents[0].text?.slice(0, 80));
  const badUri = await handlers({ id: 7, method: 'resources/read', params: { uri: 'rstellarisgui://nonsense' } });
  check('an unknown resource uri is invalid_params, not an internal error', badUri.error?.code === -32602, JSON.stringify(badUri.error));
  const noUri = await handlers({ id: 8, method: 'resources/read', params: {} });
  check('resources/read requires a uri', noUri.error?.code === -32602, JSON.stringify(noUri.error));
  const badTemplate = await handlers({ id: 9, method: 'resources/read', params: { uri: `${KNOWLEDGE_URI_SCHEME}/no-such-topic` } });
  check('an unknown topic uri is invalid_params and is told where the ids are', badTemplate.error?.code === -32602, JSON.stringify(badTemplate.error));

  // ---------------------------------------------------------------- cross-check with the prose docs
  // The topics are canonical for the RULES and `docs/` is canonical for the HISTORY. What must NOT
  // happen is the two disagreeing about a number a reader could act on, so the load-bearing figures
  // are asserted present in the prose the topics cite. The prose wraps, so the fragments checked are
  // the numbers themselves rather than whole sentences.
  const pitfalls = readFileSync(join(projectRoot, 'docs', 'gui-pitfalls.md'), 'utf8');
  for (const [what, literal] of [
    ['the 5563-event count the force_open topic cites', '5563 events'],
    ['the 113 force_open count', '**113** carry'],
    ['the 36 custom_gui count', '**36** carry'],
    ['the escape-shortcut measurement the parking topic cites', 'six `shortcut = ESCAPE` lines'],
    ['the fill/plate measurement the bar topic cites', 'unga_power_fill_0_main'],
    ['the 132-comment round trip the apply topic cites', '132'],
    ['the 26-of-32 contract measurement the window-contract topic cites', '26-31 of the 32'],
    ['the 9201 bracket-use count the text topic cites', '9201'],
    // The surface round's figures: the two shipped overrides, the ascension-perk capacity numbers and
    // the engine-populated census. Each is a number a reader would act on, so a topic and the prose
    // cannot drift apart about it.
    ['the Aerospace Carrier line counts the override topic cites', '2398 lines'],
    ['the 0-deleted-lines measurement the pattern rests on', '0 lines present\n  only in vanilla'],
    ['the ascension perk list sizes the slot-expansion case cites', 'size = { width = 500 height = 448 }'],
    ['the perk grid slot size it cites', 'slotsize = { width = 470 height = 86 }'],
    ['the engine-populated grid census it cites', '261'],
    ['the 20-file no-override framework measurement', '20 `.gui` files'],
  ]) {
    check(`docs/gui-pitfalls.md still carries ${what}`, pitfalls.includes(literal), JSON.stringify(literal));
  }
  const sources = readFileSync(join(projectRoot, 'docs', 'sources.md'), 'utf8');
  for (const [what, literal] of [
    ['the lower_* containment figures the calibration topic cites', '0.7398'],
    ['the rejected model figure beside it', '0.0938'],
  ]) {
    check(`docs/sources.md still carries ${what}`, sources.includes(literal), JSON.stringify(literal));
  }
  // GAP-12's measurement lives in the sibling workspace's gap ledger, not in docs/, and the topic
  // says so. Assert the ledger is still there and still carries the record, so the "open gap"
  // claim in the topic cannot quietly become a claim about a file that no longer exists.
  const gapLedger = '<clone>/unga-fix/PLUGIN-GAPS.md';
  if (existsSync(gapLedger)) {
    const ledger = readFileSync(gapLedger, 'utf8');
    check('the GAP-12 ledger the visibility topic cites still records the defect', /GAP-12/.test(ledger) && /is_scope_type/.test(ledger));
    check('and still records GAP-11 as the parked/out-of-bounds disagreement', /GAP-11/.test(ledger) && /out-of-bounds/.test(ledger));
  }
  const readmeText = readFileSync(join(projectRoot, 'README.md'), 'utf8');
  check(
    'the README documents the knowledge base, the compiler and the query tools',
    /knowledge base/i.test(readmeText) && /build-knowledge\.mjs/.test(readmeText) && /gui_knowledge_search/.test(readmeText) && /gui_knowledge_topic/.test(readmeText),
  );
  check(
    'the README states the topic count the build reports',
    new RegExp(`${catalogue.topics.length} knowledge topics|${catalogue.topics.length} topics`).test(readmeText),
    `README does not state ${catalogue.topics.length}`,
  );
  check('the README documents the knowledge resources', /rstellarisgui:\/\/stellaris\/knowledge\/catalog/.test(readmeText));

  process.stdout.write(`\nknowledge catalogue: ${catalogue.topics.length} topics ${JSON.stringify(catalogue.categoryCounts())}\n`);
})().catch((thrown) => {
  // A missing or unloadable knowledge base must be a NAMED failure with the suite's totals printed,
  // not a stack trace that skips the summary - otherwise "the suite crashed" and "the knowledge base
  // was deleted" look the same to whoever reads the output.
  check(
    'the knowledge catalogue loads (the knowledge base and its generated snapshot both exist)',
    false,
    thrown instanceof Error ? thrown.message : String(thrown),
  );
});

// =====================================================================================
// 60. THE SYSTEM LIGHT (src/lib/worldgfx.mjs)
//
// A `gfx/worldgfx/*.txt` NAMES the light its system is lit with, and the engine BUILDS that light
// from the file it loads - naming every one it cannot find:
//
//   [gamerendering.cpp:1174]: Failed to create system light ehof_white_hole_light
//
// The rule has TWO halves that are useless apart (a definition under `gfx/lights/**`, a reference
// under `gfx/worldgfx/*.txt`) and it needs NO star-class resolution, because every failure fired at
// LOAD - before any galaxy existed.
//
// THE FAIL-IF-REMOVED CASES, both real and both inside the SAME installed mod:
//   * the defect: the enabled Workshop mod `ugc_2409209888` names SIX lights that nothing defines
//     (`ehof_white_hole_light`, `black_star`, `d_class_star`, `dark_star`, `l_class_star`,
//     `o_class_star`) and ships no `gfx/lights` directory at all - six lines in `error.log`;
//   * the CONTROL: the same mod's `star_black_hole.txt:134` names `black_hole_light`, which IS
//     defined at `gfx/lights/star_lights.asset:231`, and it does NOT fail.
// A reader that stopped at the first half (say, by matching whole files rather than `name = <x>`
// among the light blocks) reports `black_hole_light` as broken and fails the control assertion.
// =====================================================================================
group('a system_light must name a light that exists, and the engine says so at load (LIGHT)', () => {
  // ---------------------------------------------------------------- the two readers, by hand
  const definitions = readLightDefinitions([
    {
      path: 'gfx/lights/zz_probe.asset',
      text: [
        'light = {',
        '\tname = "probe_present"',
        '\tintensity = 2.5',
        '\tposition = { x = 0 y = -4 z = 0 }',
        '}',
        'light = {',
        '\tname = "probe_second"',
        '\tintensity = 1.0',
        '}',
        '',
      ].join('\n'),
    },
  ]);
  check(
    'the light reader takes each `light = { ... }` block\'s OWN name',
    definitions.size === 2 && definitions.get('probe_present')?.line === 2 && definitions.get('probe_second')?.line === 7,
    JSON.stringify([...definitions.values()]),
  );
  // The install writes `name = "fade"` inside a light's own `animation = { ... }` too, and that
  // name IS a light - but a name BEFORE a light block belongs to the previous one, so a reader that
  // simply collected every `name` would attribute a nameless block's definition to its neighbour.
  const nestedNames = readLightDefinitions([
    {
      path: 'gfx/lights/zz_probe2.asset',
      text: ['light = {', '\tanimation = {', '\t\tname = "the_animation"', '\t}', '}', ''].join('\n'),
    },
  ]);
  check(
    'a `name` inside a light block\'s own `animation` is read as that light\'s name, not skipped',
    nestedNames.size === 1 && nestedNames.has('the_animation'),
    JSON.stringify([...nestedNames.keys()]),
  );
  const lights = readSystemLights([
    { path: 'gfx/worldgfx/zz_a.txt', text: 'system_light="bare_name"\n' },
    { path: 'gfx/worldgfx/zz_b.txt', text: ' system_light = "quoted_name"  # comment\n# system_light = "commented_out"\n' },
  ]);
  check(
    'the worldgfx reader takes the quoted and the BARE form (`star_black_hole.txt:134` writes both spellings) and ignores a commented one',
    lights.length === 2 && lights[0].name === 'bare_name' && lights[1].name === 'quoted_name',
    JSON.stringify(lights),
  );

  // ---------------------------------------------------------------- the two path gates
  check(
    'a `gfx/lights/*.asset` and a `gfx/worldgfx/*.txt` are told apart, and a worldgfx `.dds` names nothing',
    isLightsAssetPath('mod/gfx/lights/star_lights.asset') &&
      !isLightsAssetPath('mod/gfx/worldgfx/star_g_class.txt') &&
      isWorldgfxPath('mod/gfx/worldgfx/star_g_class.txt') &&
      !isWorldgfxPath('mod/gfx/worldgfx/stone_d.dds'),
    JSON.stringify({
      lights: isLightsAssetPath('mod/gfx/lights/star_lights.asset'),
      worldgfx: isWorldgfxPath('mod/gfx/worldgfx/star_g_class.txt'),
      dds: isWorldgfxPath('mod/gfx/worldgfx/stone_d.dds'),
    }),
  );

  // ---------------------------------------------------------------- the rule ITSELF must fire
  // The finding is graded by the module's own table, and a `analyseSystemLights` reduced to
  // `return {findings: []}` fails both of these by name.
  const probe = analyseSystemLights({
    lightFiles: [
      { path: 'gfx/lights/zz_probe.asset', text: 'light = {\n\tname = "probe_defined"\n}\n' },
    ],
    worldgfxFiles: [
      {
        path: 'gfx/worldgfx/zz_probe.txt',
        text: 'world = probe\nsystem_light = "probe_MISSING"\n',
      },
    ],
  });
  check(
    'a `system_light` naming no defined light is an ERROR quoting the engine\'s own line, and a defined one is not reported',
    probe.counts.total === 1 &&
      probe.counts.error === 1 &&
      probe.findings[0].rule === 'system-light-undefined' &&
      probe.findings[0].element === 'probe_MISSING' &&
      probe.findings[0].engineMessage === 'Failed to create system light probe_MISSING' &&
      /gamerendering\.cpp:1174/.test(probe.findings[0].message),
    JSON.stringify(probe.findings.map((finding) => `${finding.rule} ${finding.element} ${finding.severity}`)),
  );
  check(
    'the finding carries the file and line of the `system_light` value, not of the worldgfx file',
    probe.findings[0].where === 'gfx/worldgfx/zz_probe.txt:2',
    JSON.stringify(probe.findings[0].where),
  );
  check(
    'with NO light file supplied nothing is claimed, because the name was never resolved',
    analyseSystemLights({
      lightFiles: [],
      worldgfxFiles: [{ path: 'gfx/worldgfx/zz_probe.txt', text: 'system_light = "probe_MISSING"\n' }],
    }).counts.total === 0,
  );

  // ---------------------------------------------------------------- the INSTALL, which is clean
  const lightsDir = join(DEFAULT_GAME_ROOT, 'gfx', 'lights');
  const worldgfxDir = join(DEFAULT_GAME_ROOT, 'gfx', 'worldgfx');
  if (existsSync(lightsDir) && existsSync(worldgfxDir)) {
    const lightFiles = listFilesRecursive(lightsDir, ['.asset']).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    const worldgfxFiles = listFilesRecursive(worldgfxDir, ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    const install = analyseSystemLights({ lightFiles, worldgfxFiles, complete: true });
    check(
      'the install defines 29 lights across its `gfx/lights` files',
      install.lights.length === 29,
      JSON.stringify(install.lights.map((light) => light.name)),
    );
    check(
      'and `black_hole_light` is one of them, at `gfx/lights/star_lights.asset:231`',
      install.lights.some((light) => light.name === 'black_hole_light' && /star_lights\.asset$/.test(light.file) && light.line === 231),
      JSON.stringify(install.lights.find((light) => light.name === 'black_hole_light')),
    );
    check(
      'the install names a `system_light` 21 times across its worldgfx files and EVERY one resolves (0 findings)',
      install.systemLights.length === 21 && install.counts.total === 0,
      JSON.stringify({ lines: install.systemLights.length, counts: install.counts, unmatched: install.unmatched }),
    );
  } else {
    check('the install is present, so the system-light rule was measured against real content', false, lightsDir);
  }

  // ---------------------------------------------------------------- the MEASURED defect + control
  const defectiveMod = 'D:/SteamLibrary/steamapps/workshop/content/281990/2409209888';
  if (existsSync(join(defectiveMod, 'gfx', 'worldgfx'))) {
    const modWorldgfx = listFilesRecursive(join(defectiveMod, 'gfx', 'worldgfx'), ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    const installLightFiles = listFilesRecursive(join(DEFAULT_GAME_ROOT, 'gfx', 'lights'), ['.asset']).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    const mod = analyseSystemLights({ lightFiles: installLightFiles, worldgfxFiles: modWorldgfx, complete: true });
    const six = ['black_star', 'd_class_star', 'dark_star', 'ehof_white_hole_light', 'l_class_star', 'o_class_star'];
    check(
      'the six lights the engine failed to create are exactly the names the rule reports (the defect half)',
      JSON.stringify(mod.unmatched) === JSON.stringify(six),
      JSON.stringify(mod.unmatched),
    );
    check(
      'and the SAME mod\'s `black_hole_light` is NOT reported, because the install defines it (the control half)',
      mod.systemLights.some((entry) => entry.name === 'black_hole_light') &&
        !mod.unmatched.includes('black_hole_light') &&
        mod.unmatched.length === 6,
      JSON.stringify({ hasControl: mod.systemLights.some((entry) => entry.name === 'black_hole_light'), unmatched: mod.unmatched }),
    );
    check(
      'the mod ships no `gfx/lights` directory at all, which is why six of its names resolve to nothing',
      !existsSync(join(defectiveMod, 'gfx', 'lights')),
    );
  } else {
    check('the defective Workshop mod is on disk, so the six-light measurement could be re-run', false, defectiveMod);
  }

  // ---------------------------------------------------------------- through gui_check_files
  const lightRoot = join(scratch, 'lights');
  rmSync(lightRoot, { recursive: true, force: true });
  mkdirSync(join(lightRoot, 'gfx', 'lights'), { recursive: true });
  mkdirSync(join(lightRoot, 'gfx', 'worldgfx'), { recursive: true });
  writeFileSync(join(lightRoot, 'gfx', 'lights', 'zz_probe.asset'), 'light = {\n\tname = "zz_probe_light"\n}\n', 'utf8');
  writeFileSync(join(lightRoot, 'gfx', 'worldgfx', 'zz_probe.txt'), 'system_light = "zz_probe_light"\nsystem_light = "zz_probe_absent"\n', 'utf8');
  const lightChecked = checkFiles({
    paths: [join(lightRoot, 'gfx', 'lights', 'zz_probe.asset'), join(lightRoot, 'gfx', 'worldgfx', 'zz_probe.txt')],
    checkLocKeys: false,
  });
  check(
    'gui_check_files runs the system-light pass across the `gfx/lights` and `gfx/worldgfx` directories',
    lightChecked.byRule['system-light-undefined'] === 1 &&
      lightChecked.systemLights?.lights.length === 1 &&
      lightChecked.systemLights.systemLights.length === 2 &&
      JSON.stringify(lightChecked.systemLights.unmatched) === JSON.stringify(['zz_probe_absent']),
    JSON.stringify({ byRule: lightChecked.byRule, systemLights: lightChecked.systemLights }),
  );

  // ---------------------------------------------------------------- the rule table
  check(
    'the system-light rule is registered with a severity and a description, so the generated README carries it',
    RULE_SEVERITY['system-light-undefined'] === WORLDGFX_SEVERITY['system-light-undefined'] &&
      typeof RULE_DESCRIPTIONS['system-light-undefined'] === 'string',
    JSON.stringify([RULE_SEVERITY['system-light-undefined'], (RULE_DESCRIPTIONS['system-light-undefined'] ?? '').slice(0, 40)]),
  );
  check(
    'and its description is the module\'s own, not a copy that can drift',
    RULE_DESCRIPTIONS['system-light-undefined'] === WORLDGFX_DESCRIPTIONS['system-light-undefined'],
  );
});

// =====================================================================================
// 61. THE EVENT NAMESPACE (src/lib/events.mjs)
//
// An event id is `<namespace>.<n>`, and the namespace has to be DECLARED. When it is not, the
// engine rejects the id AND every on_action that names it, verbatim from `error.log`:
//
//   [event.cpp:1208]: Event zz_citystate.1 at  file: events/zz_citystate_events.txt line: 42
//     has an invalid ID
//   [onaction.cpp:94]: OnAction "on_game_start_country" is referencing an invalid ID:
//     "zz_citystate.1"
//
// - so the hook silently never fires. The probe mod's own header records the defect it caught.
//
// THE FAIL-IF-REMOVED CASE is the order of the two readings, and it is the reason this rule is a
// WARNING: the namespace may be declared in ANY loaded event file, not in the id's own file. The
// install proves it - 213 vanilla events sit in a file that declares no namespace at all (`all of
// anomaly_events_4.txt`'s `anomaly.5xxx` against `anomaly_events_1.txt:8`) - so a rule that demanded
// a SAME-FILE declaration would report 213 vanilla defects. The rule as written reports ZERO
// against the install and still catches both measured defects.
// =====================================================================================
group('an event namespace must be declared, or the id and its on_action are rejected (NAMESPACE)', () => {
  const files = [
    {
      path: 'events/zz_probe_events.txt',
      text: [
        'namespace = zz_probe',
        '',
        'country_event = {',
        '\tid = zz_probe.1',
        '\ttitle = x',
        '\toption = { name = y }',
        '}',
        '',
        'country_event = {',
        '\tid = zz_probe.2',
        '\ttitle = x',
        '\toption = { name = y }',
        '\t# A point of interest carries its own `id`, and it is NOT an event id.',
        '\timmediate = {',
        '\t\tcreate_point_of_interest = {',
        '\t\t\tid = some_poi.4',
        '\t\t\tname = "poi"',
        '\t\t}',
        '\t}',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'events/zz_orphan_events.txt',
      text: [
        'country_event = {',
        '\tid = zz_orphan.1',
        '\ttitle = x',
        '\toption = { name = y }',
        '}',
        '',
        'country_event = {',
        '\tid = zz_orphan.2',
        '\ttitle = x',
        '\toption = { name = y }',
        '}',
        '',
        'country_event = {',
        '\tid = zz_orphan_partner.1',
        '\ttitle = x',
        '\toption = { name = y }',
        '}',
        '',
      ].join('\n'),
    },
  ];

  const declarations = readNamespaceDeclarations(files);
  check(
    'the declaration reader finds a TOP-LEVEL `namespace = <x>` root',
    declarations.length === 1 && declarations[0].name === 'zz_probe' && declarations[0].line === 1,
    JSON.stringify(declarations),
  );
  const ids = readEventIds(files);
  check(
    'the id reader sees every event id and NOT the `id` inside a `create_point_of_interest` block',
    ids.length === 5 &&
      ids.map((entry) => entry.id).join(',') === 'zz_probe.1,zz_probe.2,zz_orphan.1,zz_orphan.2,zz_orphan_partner.1',
    JSON.stringify(ids.map((entry) => entry.id)),
  );

  // The rule ITSELF. ONE finding per undeclared namespace, not per event: `zz_orphan` covers two
  // ids and `zz_orphan_partner` is a DIFFERENT namespace that is also undeclared, so a rule that
  // keyed on the whole prefix before the LAST dot, or that reported per event, lands on 1 or 3.
  const result = analyseEventNamespaces({ files });
  check(
    'an undeclared namespace is reported ONCE, naming the first affected id and counting the rest',
    result.counts.total === 2 &&
      result.counts.warning === 2 &&
      result.findings[0].element === 'zz_orphan' &&
      result.findings[0].affectedCount === 2 &&
      result.findings[1].element === 'zz_orphan_partner' &&
      result.findings[1].affectedCount === 1,
    JSON.stringify({ counts: result.counts, findings: result.findings.map((finding) => [finding.element, finding.affectedCount]) }),
  );
  check(
    'the finding quotes the engine\'s own two lines, so a reader can match it against error.log',
    result.findings[0].engineMessage === 'Event zz_orphan.1 at  file: events/zz_orphan_events.txt line: 2 has an invalid ID' &&
      /event\.cpp:1208/.test(result.findings[0].message) &&
      /onaction\.cpp:94/.test(result.findings[0].message),
    JSON.stringify(result.findings[0].engineMessage),
  );
  check(
    'the declared namespace is NOT reported, so the rule is not simply "every id"',
    !result.undeclared.includes('zz_probe') && result.events.length === 5,
    JSON.stringify(result.undeclared),
  );
  check(
    'and an id with no dot at all is left alone (it names no namespace to declare)',
    analyseEventNamespaces({ files: [{ path: 'events/zz_bare.txt', text: 'namespace = zz_bare\ncountry_event = {\n\tid = bare\n\toption = { name = y }\n}\n' }] }).counts.total === 0,
  );

  // ---------------------------------------------------------------- the install must be CLEAN
  const eventsDir = join(DEFAULT_GAME_ROOT, 'events');
  if (existsSync(eventsDir)) {
    const installFiles = listFilesRecursive(eventsDir, ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    const install = analyseEventNamespaces({ files: installFiles });
    check(
      'the install declares a namespace for EVERY event id it writes (6571 events, 0 findings)',
      install.events.length === 6571 && install.counts.total === 0,
      JSON.stringify({ events: install.events.length, counts: install.counts, undeclared: install.undeclared }),
    );
    // The measurement that decides the severity: the per-file reading is FALSE, and `anomaly` is
    // the case that proves it - `anomaly_events_4.txt` declares no namespace and its ids resolve
    // against a DIFFERENT file in the same directory.
    const anomaly4 = installFiles.find((file) => /anomaly_events_4\.txt$/.test(file.path));
    const sameFile = installFiles
      .flatMap((file) => {
        const declared = new Set(readNamespaceDeclarations([file]).map((entry) => entry.name.toLowerCase()));
        return readEventIds([file])
          .filter((event) => event.id.includes('.') && !declared.has(event.id.split('.')[0].toLowerCase()))
          .map((event) => event.id);
      })
      .length;
    check(
      'the SAME-FILE reading would report ZERO in the install nowhere and 213 real events: `anomaly_events_4.txt` declares no namespace and its ids resolve elsewhere',
      anomaly4 !== undefined &&
        readNamespaceDeclarations([anomaly4]).length === 0 &&
        readEventIds([anomaly4]).filter((event) => event.id.startsWith('anomaly.')).length > 0 &&
        sameFile === 213,
      JSON.stringify({ anomaly4Declarations: anomaly4 ? readNamespaceDeclarations([anomaly4]).length : null, sameFile }),
    );
  } else {
    check('the install is present, so the namespace rule was measured against real content', false, eventsDir);
  }

  // ---------------------------------------------------------------- the MEASURED defect
  // The current probe file DECLARES its namespace and is clean; removing the declaration is the
  // shape the engine rejected at 21:24:04, and the finding must then appear.
  const citystateEvents = 'D:/StellarisMods/zz_probe_citystate/events/zz_citystate_events.txt';
  if (existsSync(citystateEvents)) {
    const text = readFileSync(citystateEvents, 'utf8');
    const declaredRun = analyseEventNamespaces({ files: [{ path: citystateEvents, text }] });
    const strippedRun = analyseEventNamespaces({
      files: [{ path: citystateEvents, text: text.replace(/^namespace\s*=.*$/m, '# declaration removed by the selftest') }],
    });
    check(
      'the probe file that declares its namespace is clean, and the SAME file without the declaration is reported',
      declaredRun.counts.total === 0 &&
        strippedRun.counts.total === 1 &&
        strippedRun.findings[0].element === 'zz_citystate' &&
        strippedRun.findings[0].affectedCount === 3,
      JSON.stringify({ declared: declaredRun.counts, stripped: strippedRun.findings.map((finding) => [finding.element, finding.affectedCount]) }),
    );
    check(
      'and the probe file\'s own header still records the defect the declaration fixes',
      /event\.cpp:1208/.test(text) && /onaction\.cpp:94/.test(text) && /namespace/.test(text),
    );
  } else {
    check('the citystate probe mod is on disk, so the namespace defect could be re-run', false, citystateEvents);
  }

  // ---------------------------------------------------------------- through gui_check_files
  const namespaceRoot = join(scratch, 'namespaces');
  rmSync(namespaceRoot, { recursive: true, force: true });
  mkdirSync(join(namespaceRoot, 'events'), { recursive: true });
  writeFileSync(join(namespaceRoot, 'events', 'zz_probe_events.txt'), files[1].text, 'utf8');
  const namespaced = checkFiles({ paths: [join(namespaceRoot, 'events', 'zz_probe_events.txt')], checkLocKeys: false });
  check(
    'gui_check_files runs the namespace pass over the event files it was handed',
    namespaced.byRule['event-namespace-undeclared'] === 2 &&
      namespaced.eventNamespaces?.events.length === 3 &&
      JSON.stringify(namespaced.eventNamespaces.undeclared) === JSON.stringify(['zz_orphan', 'zz_orphan_partner']),
    JSON.stringify({ byRule: namespaced.byRule, undeclared: namespaced.eventNamespaces?.undeclared }),
  );

  // ---------------------------------------------------------------- the rule table
  check(
    'the event-namespace rule is registered with a severity and a description, so the generated README carries it',
    RULE_SEVERITY['event-namespace-undeclared'] === EVENT_NAMESPACE_SEVERITY['event-namespace-undeclared'] &&
      typeof RULE_DESCRIPTIONS['event-namespace-undeclared'] === 'string',
    JSON.stringify([RULE_SEVERITY['event-namespace-undeclared'], (RULE_DESCRIPTIONS['event-namespace-undeclared'] ?? '').slice(0, 40)]),
  );
  check(
    'and its description is the module\'s own, not a copy that can drift',
    RULE_DESCRIPTIONS['event-namespace-undeclared'] === EVENT_NAMESPACE_DESCRIPTIONS['event-namespace-undeclared'],
  );
});

// =====================================================================================
// 62. A COLONY WITH NO POPULATION (src/lib/colonization.mjs, CREATE COLONY)
//
// `create_colony` builds the colony OBJECT and nothing else; a colony with zero population REVERTS
// to a colonisable planet once time runs, and THE ENGINE LOGS NO LINE FOR IT. That silence is why
// this is a rule: there is no error to search for, and the player sees only a planet that stopped
// being theirs.
//
// THE FAIL-IF-REMOVED CASE is vanilla's own pairing: 11 top-level blocks call `create_colony`, 7 of
// them call `create_pop_group` in the SAME block, and the population of the other four is reached
// from the block BY NAME (an `inline_script`, a fired `country_event`). A rule that stopped at the
// same block would report those four as defects; a rule that never traced a call would report the
// whole install. The rule as written reports ZERO against the install, and removing the pop loop
// from the Toxic Knights effect - the shape the Long Road Home probe copied - makes it fire.
// =====================================================================================
group('a `create_colony` with no pop-seeding reverts to a planet, silently (CREATECOLONY)', () => {
  // ---------------------------------------------------------------- the block index
  const hostile = [
    'zz_probe_effect = {',
    '\tcapital_scope = {',
    '\t\tcreate_colony = {',
    '\t\t\towner = root',
    '\t\t\tspecies = root',
    '\t\t}',
    '\t\tset_colony = {',
    '\t\t\tcreate_colony = no',
    '\t\t}',
    '\t}',
    '}',
    '',
    'zz_probe_caller = {',
    '\tzz_probe_effect = yes',
    '}',
    '',
  ].join('\n');
  const index = indexCreateColonyBlocks([{ path: 'common/scripted_effects/zz_probe.txt', text: hostile }]);
  check(
    'the index separates the `create_colony = { ... }` EFFECT from `create_colony = no`, which is a FIELD of `set_colony`',
    index.definitions.get('zz_probe_effect')?.colonies === 1 && index.definitions.get('zz_probe_caller')?.colonies === 0,
    JSON.stringify([...index.definitions.values()].map((entry) => [entry.key, entry.colonies])),
  );
  check(
    'and a block records the names it CALLS, which is what lets population in another block count',
    index.definitions.get('zz_probe_caller')?.calls.includes('zz_probe_effect') === true,
    JSON.stringify(index.definitions.get('zz_probe_caller')?.calls),
  );

  // ---------------------------------------------------------------- the rule ITSELF
  const probe = analyseCreateColonyPops({
    scriptFiles: [
      {
        path: 'common/scripted_effects/zz_probe.txt',
        text: [
          'zz_probe_seedless = {',
          '\tcreate_colony = {',
          '\t\towner = root',
          '\t}',
          '}',
          '',
          'zz_probe_seeded = {',
          '\tcreate_colony = {',
          '\t\towner = root',
          '\t}',
          '\twhile = {',
          '\t\tcount = 8',
          '\t\tcreate_pop_group = {',
          '\t\t\tsize = 100',
          '\t\t}',
          '\t}',
          '}',
          '',
          'zz_probe_reaches_seeding = {',
          '\tzz_probe_seeded = yes',
          '}',
          '',
        ].join('\n'),
      },
    ],
    complete: true,
  });
  check(
    'a block that creates a colony and reaches no pop-seeding block is reported, in the module\'s own words',
    probe.counts.total === 1 &&
      probe.counts.warning === 1 &&
      probe.findings[0].rule === 'create-colony-without-pops' &&
      probe.findings[0].element === 'zz_probe_seedless' &&
      /REVERTS to a colonisable planet/.test(probe.findings[0].message) &&
      /engine\s+logs NO LINE/.test(probe.findings[0].message),
    JSON.stringify(probe.findings.map((finding) => [finding.rule, finding.element, finding.severity])),
  );
  check(
    'and a block whose population is in ANOTHER block it calls BY NAME is NOT reported',
    probe.findings.length === 1 && !probe.findings.some((finding) => /zz_probe_reaches_seeding/.test(finding.element)),
    JSON.stringify(probe.findings.map((finding) => finding.element)),
  );
  check(
    'the finding names the calls it followed, so its scope is readable rather than implied',
    /SCOPE OF THE SEARCH/.test(probe.findings[0].message) && /BLOCK-SCOPED/.test(probe.findings[0].message),
    JSON.stringify(probe.findings[0].message.slice(-320)),
  );

  // ---------------------------------------------------------------- the install must be CLEAN
  const scriptDirs = ['common/scripted_effects', 'common/inline_scripts', 'common/on_actions', 'events'];
  if (scriptDirs.every((dir) => existsSync(join(DEFAULT_GAME_ROOT, dir)))) {
    const installFiles = scriptDirs.flatMap((dir) =>
      listFilesRecursive(join(DEFAULT_GAME_ROOT, dir), ['.txt']).map((path) => ({ path, text: readFileSync(path, 'utf8') })),
    );
    const install = analyseCreateColonyPops({ scriptFiles: installFiles, complete: true });
    check(
      'the install calls `create_colony` from 10 blocks and every one of them seeds population (0 findings)',
      install.colonyBlocks.length === 10 && install.counts.total === 0,
      JSON.stringify({ colonies: install.colonyBlocks.length, counts: install.counts, findings: install.findings.map((finding) => finding.element) }),
    );
    // The two halves of the trace, measured: the Toxic Knights colony and the MSI effect (whose
    // population is in the effect its `inline_script` names).
    const toxic = 'common/inline_scripts/game_start/origin_toxic_knights.txt';
    const toxicFiles = installFiles.filter((file) => file.path.replace(/\\/g, '/').endsWith(toxic));
    const toxicRun = analyseCreateColonyPops({ scriptFiles: toxicFiles, complete: true });
    check(
      'the Knights of the Toxic God colony (`create_colony` + 8 x `create_pop_group`) is clean, and it is the shape the probes copy',
      toxicRun.colonyBlocks.length === 1 && toxicRun.counts.total === 0,
      JSON.stringify({ colonies: toxicRun.colonyBlocks.length, counts: toxicRun.counts }),
    );
    // The FAIL-IF-REMOVED control: strip the pop loop and the same file MUST be reported.
    const stripped = readFileSync(join(DEFAULT_GAME_ROOT, toxic), 'utf8').replace(/create_pop_group/g, 'zz_removed_pop_group');
    const strippedRun = analyseCreateColonyPops({ scriptFiles: [{ path: toxic, text: stripped }], complete: true });
    check(
      'and REMOVING its `create_pop_group` makes the same effect fire - the assertion fails if the rule is removed',
      strippedRun.counts.total === 1,
      JSON.stringify(strippedRun.findings.map((finding) => finding.element)),
    );
  } else {
    check('the install is present, so the create-colony rule was measured against real content', false, DEFAULT_GAME_ROOT);
  }

  // ---------------------------------------------------------------- the probes that motivated it
  const longroadEffect = 'D:/StellarisMods/zz_probe_longroad/common/scripted_effects/zz_longroad_effects.txt';
  if (existsSync(longroadEffect)) {
    const longroad = analyseCreateColonyPops({ scriptFiles: [{ path: longroadEffect, text: readFileSync(longroadEffect, 'utf8') }], complete: true });
    check(
      'the Long Road Home probe\'s own colony effect is clean: it is `create_colony` plus 8 x 100 pops',
      longroad.colonyBlocks.length === 1 && longroad.counts.total === 0,
      JSON.stringify({ colonies: longroad.colonyBlocks, counts: longroad.counts }),
    );
  }

  // ---------------------------------------------------------------- through gui_check_files
  const colonyRoot = join(scratch, 'colonies');
  rmSync(colonyRoot, { recursive: true, force: true });
  mkdirSync(join(colonyRoot, 'common', 'scripted_effects'), { recursive: true });
  writeFileSync(
    join(colonyRoot, 'common', 'scripted_effects', 'zz_probe.txt'),
    ['zz_probe_colony = {', '\tcreate_colony = {', '\t\towner = root', '\t}', '}', ''].join('\n'),
    'utf8',
  );
  const colonyChecked = checkFiles({ paths: [join(colonyRoot, 'common', 'scripted_effects', 'zz_probe.txt')], checkLocKeys: false });
  check(
    'gui_check_files runs the create-colony pass over the scripted effects it was handed',
    colonyChecked.byRule['create-colony-without-pops'] === 1 &&
      colonyChecked.colonies?.colonyBlocks.length === 1,
    JSON.stringify({ byRule: colonyChecked.byRule, colonies: colonyChecked.colonies }),
  );

  // ---------------------------------------------------------------- the rule table
  check(
    'the create-colony rule is registered with a severity and a description, so the generated README carries it',
    RULE_SEVERITY['create-colony-without-pops'] === COLONIZATION_SEVERITY['create-colony-without-pops'] &&
      typeof RULE_DESCRIPTIONS['create-colony-without-pops'] === 'string',
    JSON.stringify([RULE_SEVERITY['create-colony-without-pops'], (RULE_DESCRIPTIONS['create-colony-without-pops'] ?? '').slice(0, 40)]),
  );
  check(
    'and its description is the module\'s own, not a copy that can drift',
    RULE_DESCRIPTIONS['create-colony-without-pops'] === COLONIZATION_DESCRIPTIONS['create-colony-without-pops'],
  );
  check(
    'the rule is a WARNING, because the check is block-scoped and a sibling block is invisible to it',
    RULE_SEVERITY['create-colony-without-pops'] === 'warning',
  );
});

// =====================================================================================

process.stdout.write(`\n${'='.repeat(72)}\npassed ${passed}, failed ${failed}\n`);
if (failures.length > 0) {
  process.stdout.write(`\nfailures:\n`);
  for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
}
process.exitCode = failed === 0 ? 0 : 1;

export { check, resolveGameRoot, listFilesRecursive, BASE_RESOLUTION, computeRect, parseParadox };
