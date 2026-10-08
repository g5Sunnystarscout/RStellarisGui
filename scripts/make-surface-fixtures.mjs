#!/usr/bin/env node
//------------------------------------------------------------------------------------
// make-surface-fixtures.mjs -- Part of RStellarisGui
//
// THE TWO ROUTES A MOD UI HAS, as fixtures. `script-routes-to-a-window` establishes that there
// are exactly two: an event that names a window via `custom_gui`, and a mod's elements living
// inside a `.gui` file the engine already shows. The project's own shipped mod uses the first and
// only the first, so until these fixtures existed nothing in the suite exercised the second.
//
// What this script writes, both from the plugin's own emitter so the fixtures cannot drift from
// the code (they are re-generated and compared by `scripts/selftest.mjs`):
//
//   scripts/fixtures/matrix_window.gui
//       A standalone file whose FIRST top-level element is a `windowType` - NOT a
//       `containerWindowType`, and therefore NOT reachable through `custom_gui`, which names a
//       containerWindowType. It holds the whole new kind surface (matrix, dropDownBox with
//       `expandedWindow`/`expandButton`, spinner with two named `guiButtonType` children, checkbox,
//       editBox) plus an EMPTY `gridBoxType` beside the matrix, so the contrast the
//       `engine-populated-containers` topic states is visible in one file.
//
//   scripts/fixtures/host_override/vanilla_host.gui
//       The synthetic "vanilla" host the override is built on.
//   scripts/fixtures/host_override/planet_view_mini.gui
//       The OVERRIDE, produced by `planOverride` (the code behind `gui_emit_override`): the host's
//       own bytes plus a matrix spliced into its container, with the host's sha256 in the header so
//       a stale copy is detectable. This is the path the working mod uses for `planet_view.gui`,
//       end to end, on a file small enough to read.
//
// Both fixtures are UTF-8 WITHOUT a BOM, like every `.gui` the engine reads.
//
//   node scripts/make-surface-fixtures.mjs            rewrite both fixtures
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License as published by the Free Software Foundation, either version 3
// of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planOverride, emitGui, hashFile } from './../src/lib/emit.mjs';

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_DIR = join(projectRoot, 'scripts', 'fixtures');
export const MATRIX_WINDOW_PATH = join(FIXTURE_DIR, 'matrix_window.gui');
export const OVERRIDE_DIR = join(FIXTURE_DIR, 'host_override');
export const HOST_PATH = join(OVERRIDE_DIR, 'vanilla_host.gui');
export const OVERRIDE_PATH = join(OVERRIDE_DIR, 'planet_view_mini.gui');
/**
 * THE NEXT PATCH. The same host as the next game version would ship it: one element ADDED and the
 * container's own `size` changed. This is what "the base moved" looks like from a mod's side, and
 * `gui_override_drift` is asserted on it - without it, the project would have a drift report that
 * had never been run against a base that actually moved.
 */
export const HOST_V2_PATH = join(OVERRIDE_DIR, 'vanilla_host_v2.gui');
/** The patch AFTER that: the container the mod splices into has been RENAMED. */
export const HOST_V3_PATH = join(OVERRIDE_DIR, 'vanilla_host_v3_renamed.gui');
/**
 * THE CASE THE SLOT-EXPANDING MODS LIVE IN: an override that ADDS NOTHING and changes ONE NUMBER.
 *
 * The classic "more ascension perk slots" mods do not add elements to
 * `interface/ascension_perks_view.gui` - they change the sizes and the grid's
 * `max_slots_horizontal` in it, because the screen's capacity is those numbers and the ITEMS are
 * engine-populated (`:85` `perks_list_box` 500x448, `:95` `ascension_perks_list` 480x433, `:127`
 * `ascension_perks_grid` `max_slots_horizontal = 1` / `slotsize` 470x86). An anti-drift report that
 * only counted ADDED elements would say "no changes" about a mod whose entire purpose is one
 * number, so this fixture exists to keep that case asserted.
 */
export const NUMBER_CHANGE_PATH = join(OVERRIDE_DIR, 'number_change_only.gui');

/**
 * The model behind `matrix_window.gui`.
 *
 * Every sprite and font named here exists in 4.4.6 and is used by vanilla, so the fixture is a
 * file the engine would accept rather than a shape that merely parses. The root is a
 * `kind: 'container'` with `syntheticRoot`, which is how the emitter writes several top-level
 * elements as siblings under one `guiTypes`.
 */
export function matrixWindowLayout() {
  return {
    schema: 'rstellarisgui/layout@1',
    name: 'zz_surface_fixture',
    baseResolution: { width: 1920, height: 1080 },
    variables: { '@surface_window_h': '470' },
    root: {
      id: 'root',
      kind: 'container',
      syntheticRoot: true,
      children: [
        {
          // THE HOST. `windowType`, not `containerWindowType`: `custom_gui` cannot name this, and
          // the emitter writes it anyway.
          id: 'surface_window',
          kind: 'window',
          name: 'zz_surface_fixture_window',
          position: { x: 40, y: 60 },
          size: { width: 960, height: '@surface_window_h' },
          moveable: true,
          dontrender: false,
          fullscreen: false,
          horizontalborder: 12,
          verticalborder: 12,
          background: 'GFX_tiles_dark_area_cut_8',
          children: [
            {
              id: 'surface_title',
              kind: 'text',
              name: 'zz_surface_fixture_title',
              position: { x: 16, y: 10 },
              font: 'malgun_goth_24',
              text: 'zz_surface_fixture_title',
              format: 'left',
              maxWidth: 900,
              maxHeight: 30,
              fixedSize: true,
            },
            {
              // THE MATRIX. 3 rows x 5 columns with both header bands, and one cell too wide for
              // its slot on purpose: that is the finding `matrix-cell-overflow` exists for, and it
              // is the one thing about a hand-built matrix that no geometric rule can see.
              id: 'surface_matrix',
              kind: 'matrix',
              name: 'zz_surface_matrix',
              position: { x: 16, y: 48 },
              rows: 3,
              columns: 5,
              cellWidth: 150,
              cellHeight: 26,
              gapX: 6,
              gapY: 4,
              padding: 6,
              columnHeaders: ['zz_surface_col_0', 'zz_surface_col_1', 'zz_surface_col_2', 'zz_surface_col_3', 'zz_surface_col_4'],
              rowHeaders: ['zz_surface_row_0', 'zz_surface_row_1', 'zz_surface_row_2'],
              cells: [
                { row: 0, column: 0, node: { kind: 'text', name: 'zz_surface_cell_00', text: 'zz_surface_cell_00', font: 'cg_16b', maxWidth: 140, maxHeight: 20 } },
                { row: 1, column: 1, node: { kind: 'text', name: 'zz_surface_cell_11', text: 'zz_surface_cell_11', font: 'cg_16b', maxWidth: 140, maxHeight: 20 } },
                { row: 2, column: 2, node: { kind: 'text', name: 'zz_surface_cell_22', text: 'zz_surface_cell_22', font: 'cg_16b', maxWidth: 300, maxHeight: 20 } },
                { row: 0, column: 4, node: { kind: 'icon', name: 'zz_surface_cell_04', quadTextureSprite: 'GFX_arrow_left', position: { x: 0, y: 0 } } },
              ],
            },
            {
              // THE CONTRAST, in the same file: an engine-populated box. It has no children
              // because it CANNOT have mod children - measured 0 of 261 vanilla `gridBoxType`
              // blocks contain a nested element (`engine-populated-containers`).
              id: 'surface_grid',
              kind: 'gridBox',
              name: 'zz_surface_grid',
              position: { x: 16, y: 200 },
              size: { width: 400, height: 100 },
              slotSize: { width: 100, height: 25 },
              format: 'UPPER_LEFT',
              max_slots_horizontal: 4,
            },
            {
              id: 'surface_checkbox',
              kind: 'checkbox',
              name: 'zz_surface_checkbox',
              position: { x: 16, y: 320 },
              spriteType: 'GFX_checkbox_20_20_01',
              pdx_tooltip: 'zz_surface_checkbox_tip',
            },
            {
              id: 'surface_editbox',
              kind: 'editBox',
              name: 'zz_surface_editbox',
              position: { x: 60, y: 318 },
              size: { width: 320, height: 26 },
              font: 'cg_16b',
              text: 'zz_surface_edit_value',
              textureFile: '',
              instantTextBoxType: false,
              max_characters: 40,
              borderSize: { x: 4, y: 2 },
            },
            {
              id: 'surface_spinner',
              kind: 'spinner',
              name: 'zz_surface_spinner',
              position: { x: 420, y: 316 },
              size: { width: 160, height: 28 },
              borderSize: { x: 14, y: 14 },
              horizontal: 1,
              priority: 100,
              maxValue: 4,
              startValue: 2,
              id: 'zz_surface_spinner_id',
              engineId: 'zz_surface_spinner_id',
              leftbutton: 'zz_surface_spinner_up',
              rightbutton: 'zz_surface_spinner_down',
              children: [
                { id: 'surface_spinner_up', kind: 'guiButton', name: 'zz_surface_spinner_up', quadTextureSprite: 'GFX_button_light', position: { x: 0, y: 0 } },
                { id: 'surface_spinner_down', kind: 'guiButton', name: 'zz_surface_spinner_down', quadTextureSprite: 'GFX_button_light', position: { x: 140, y: 0 } },
              ],
            },
            {
              // A drop-down, whose two structural parts are ELEMENT BLOCKS WHOSE KEY IS THE FIELD.
              id: 'surface_dropdown',
              kind: 'dropDownBox',
              name: 'zz_surface_dropdown',
              position: { x: 600, y: 314 },
              size: { width: 260, height: 30 },
              orientation: 'upper_left',
              clipping: false,
              background: { name: 'zz_surface_dropdown_bg', sprite: 'GFX_subwindow_tile_plain_solid', spriteField: 'spriteType' },
              children: [
                {
                  id: 'surface_dropdown_expand',
                  kind: 'guiButton',
                  asField: 'expandButton',
                  name: 'zz_surface_expand_button',
                  position: { x: 230, y: 6 },
                  spriteType: 'GFX_button_down_arrow',
                  clicksound: 'interface',
                  oversound: 'mouse_over',
                },
                {
                  id: 'surface_dropdown_window',
                  kind: 'container',
                  asField: 'expandedWindow',
                  name: 'zz_surface_expanded_window',
                  position: { x: 0, y: 30 },
                  size: { width: 260, height: 120 },
                  verticalscrollbar: 'right_vertical_slider',
                  background: { name: 'zz_surface_expanded_bg', sprite: 'GFX_subwindow_tile_plain_solid', spriteField: 'spriteType' },
                  children: [
                    {
                      id: 'surface_expanded_list',
                      kind: 'smoothListBox',
                      name: 'zz_surface_expanded_list',
                      position: { x: 0, y: 0 },
                      size: { width: 250, height: 115 },
                      scrollbartype: 'standardlistbox_slider_small',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    effects: {},
    localisation: [],
    event: null,
  };
}

/** The synthetic "vanilla" host: two elements and a container to splice into. */
export function hostSource(options = {}) {
  const name = options.containerName ?? 'zz_surface_host';
  const width = options.width ?? 520;
  const height = options.height ?? 300;
  const extra = options.extraElement
    ? [
        '',
        '\t\ticonType = {',
        '\t\t\tname = "zz_surface_host_patch_badge"',
        '\t\t\tquadTextureSprite = "GFX_arrow_right"',
        '\t\t\tposition = { x = 40 y = 10 }',
        '\t\t}',
      ]
    : [];
  return [
    'guiTypes = {',
    '\tcontainerWindowType = {',
    `\t\tname = "${name}"`,
    `\t\tsize = { width = ${width} height = ${height} }`,
    '',
    '\t\tbackground = {',
    '\t\t\tname = "zz_surface_host_bg"',
    '\t\t\tquadTextureSprite = "GFX_tiles_dark_area_cut_8"',
    '\t\t}',
    '',
    '\t\ticonType = {',
    '\t\t\tname = "zz_surface_host_icon"',
    '\t\t\tquadTextureSprite = "GFX_arrow_left"',
    '\t\t\tposition = { x = 12 y = 10 }',
    '\t\t}',
    ...extra,
    '\t}',
    '}',
    '',
  ].join('\n');
}

/** The element the override splices into the host. */
export function overrideAddition() {
  return {
    id: 'override_matrix',
    kind: 'matrix',
    name: 'zz_surface_host_matrix',
    position: { x: 12, y: 40 },
    rows: 2,
    columns: 3,
    cellWidth: 150,
    cellHeight: 24,
    rowHeaders: ['zz_surface_host_row_0', 'zz_surface_host_row_1'],
    cells: [
      { row: 0, column: 0, node: { kind: 'text', name: 'zz_surface_host_cell_00', text: 'zz_surface_host_cell_00', font: 'cg_16b', maxWidth: 140, maxHeight: 18 } },
      { row: 1, column: 2, node: { kind: 'text', name: 'zz_surface_host_cell_12', text: 'zz_surface_host_cell_12', font: 'cg_16b', maxWidth: 140, maxHeight: 18 } },
    ],
  };
}

/**
 * Build the fixtures that do not need another fixture to exist, as `path -> text`.
 *
 * The override is NOT here: `planOverride` reads the host from DISK (that is the point of it - the
 * `sha256` in its header is the hash of a real file), so it is a second stage in `main`.
 */
export function buildSurfaceFixtures() {
  const files = new Map();
  files.set(MATRIX_WINDOW_PATH, emitGui(matrixWindowLayout(), { syntaxCheck: false }).text);
  files.set(HOST_PATH, hostSource());
  // THE MOVED BASE, twice. `v2` is the next patch: the container's size changed and one vanilla
  // element was added. `v3` is the patch after it: the container was RENAMED, so the mod's splice
  // point is gone. Both are hand-authored "vanilla" files rather than emitted ones - that is what
  // makes them a base a mod's copy can drift away from.
  files.set(HOST_V2_PATH, hostSource({ width: 560, height: 320, extraElement: true }));
  files.set(HOST_V3_PATH, hostSource({ containerName: 'zz_surface_host_renamed' }));
  return files;
}

/** The override, as text. `planOverride` reads `<OVERRIDE_DIR>/vanilla_host.gui` from disk. */
export function buildOverrideFixture() {
  return planOverride(HOST_PATH, [{ element: overrideAddition(), container: 'zz_surface_host' }]).content;
}

/**
 * An override that adds nothing and changes one number, with the same header shape the plugin
 * writes. Built by hand rather than through `planOverride`, because `planOverride` is a
 * source-plus-additions tool by design and this case has no additions.
 */
export function buildNumberChangeOverride() {
  const base = hashFile(HOST_PATH);
  const text = readFileSync(HOST_PATH, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const changed = text.replace('size = { width = 520 height = 300 }', 'size = { width = 700 height = 520 }');
  if (changed === text) throw new Error('the number-change fixture did not match the host it edits');
  const header = [
    '#------------------------------------------------------------------------------------',
    `# OVERRIDE of ${base.name} (${base.bytes} bytes, ${base.lines} lines)`,
    `# vanilla source sha256: ${base.sha256}`,
    '#',
    '# This file was produced to exercise the ASCENSION-SLOT shape: an override whose only edit is a',
    '# NUMBER in an engine-populated container. The screen\'s capacity is those numbers and nowhere',
    '# else, and the items come from common/ascension_perks/ - so a drift report that only counted',
    '# ADDED elements would say "no changes" about this file.',
    '#',
    '# Changed: zz_surface_host size 520x300 -> 700x520 (one number, no additions)',
    '#------------------------------------------------------------------------------------',
  ].join(eol);
  return `${header}${eol}${changed}`;
}

function main() {
  for (const [path, text] of buildSurfaceFixtures()) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
    process.stdout.write(`wrote ${path} (${text.length} bytes)\n`);
  }
  // SECOND STAGE, on purpose: the override is built from the host THIS RUN wrote, so the sha256 in
  // its header is the hash of the file that is on disk beside it.
  const override = buildOverrideFixture();
  mkdirSync(dirname(OVERRIDE_PATH), { recursive: true });
  writeFileSync(OVERRIDE_PATH, override, 'utf8');
  process.stdout.write(`wrote ${OVERRIDE_PATH} (${override.length} bytes)\n`);
  const numberOnly = buildNumberChangeOverride();
  writeFileSync(NUMBER_CHANGE_PATH, numberOnly, 'utf8');
  process.stdout.write(`wrote ${NUMBER_CHANGE_PATH} (${numberOnly.length} bytes)\n`);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invokedDirectly) main();

export default { buildSurfaceFixtures, buildOverrideFixture, buildNumberChangeOverride, matrixWindowLayout, hostSource, overrideAddition, HOST_V2_PATH, HOST_V3_PATH, NUMBER_CHANGE_PATH };
