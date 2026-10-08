//------------------------------------------------------------------------------------
// emit.mjs -- Part of RStellarisGui
//
// The emitter: a layout tree in, Stellaris-readable files out.
//
// Emitting code is the easy last step, but it has five hard constraints that this module
// exists to enforce. All five are verified in the install or in the engine's own error log
// (see docs/sources.md):
//
// 1. STANDALONE FILES ONLY, UNLESS OVERRIDING IS THE POINT. Everything is written under an
//    explicit output directory that the caller passes. `assertOutputRoot` refuses a root that
//    looks like an install, the user-data folder, or that already contains a `descriptor.mod`
//    (i.e. a mod workspace), because a half-written file there breaks the user's mod.
//    Overriding a vanilla file is a real job (there is no other way to add a button to the
//    planet panel), so it has ONE deliberate door: `planOverride` / `emitOverride`, which takes
//    the vanilla file's path, records its sha256, refuses without an explicit confirmation, and
//    still writes only inside the caller's own output root.
//
// 2. THE SIZE KEYWORD IS PER-KIND, AND THE ENGINE ERRORS ON THE WRONG ONE. An earlier revision
//    wrote `size = { width = .. height = .. }` everywhere. The engine answered, in
//    Documents/Paradox Interactive/Stellaris/logs/error.log:
//      Error: "Unexpected token: size, near line: 56"        <- an iconType
//      Error: "Malformed token: width / Malformed token: height" near line: 98
//      [instanttextboxtype.cpp:138]: Not used, use maxWidth and maxHeight   <- line 95
//    So `text` writes `maxWidth`/`maxHeight`, `button`/`listBox`/`scrollbar`/... write
//    `size = { x y }`, `containerWindowType`/`gridBoxType` write `size = { width height }`, and
//    `icon`/`checkbox` write no size at all. The table in kinds.mjs carries the measured form
//    for every kind; this module just obeys it. `maxWidth`/`maxHeight` and the x/y form accept
//    only integers and `@variables` in vanilla, so a percentage or negative declaration is
//    resolved to absolute pixels through the layout engine and reported as
//    `size-value-resolved` rather than written as a form the engine will not read.
//
// 3. UTF-8 ENCODING DIFFERS BY FILE TYPE. Script files (`.gui`, `.txt`) are UTF-8 WITHOUT a
//    BOM. Localisation `.yml` files are UTF-8 WITH a BOM. A localisation file without the BOM
//    is silently ignored by the engine.
//
// 4. `@variable` HOISTING. `@name = value` lines are collected and written once at the top of
//    the `.gui` file, before `guiTypes`, because they cannot traverse element nesting
//    (30 of 177 vanilla files do exactly this).
//
// 5. THE `option_button` / `OPTION_TEXT` RULE. A `custom_gui_option` row is filled by a button
//    that must be named `option_button` and carry `text = "OPTION_TEXT"`. Verified against
//    vanilla: interface/diplomacy_caravaneer_event_view.gui:11-16. And an event that shows a
//    `custom_gui` window still needs at least one `option`, or the engine logs
//    "Event <id> has no options" - so the stub always writes one per window.
//
// Field order follows the dominant vanilla order for each element kind (name, position, size,
// orientation, then kind-specific fields), indentation is a tab, matching vanilla.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { kindSpec, sizeFormFor, SIZE_FORMS, emittableKinds, canonicalFieldName, isKnownField, isEngineRejectedField, isFieldRejectedForKind, kindAcceptsField, translateFieldForKind } from './kinds.mjs';
import { applyToFile, bindEmit, describeFile } from './apply.mjs';
import { BASE_RESOLUTION, computeLayout, topLevelContainers as layoutTopLevelContainers, walkLayout } from './layout.mjs';
import { analyseEventWindows, checkParkedElements } from './contract.mjs';
import { canonicalPositionToEngine } from './coords.mjs';
import { ensureDir, insideGameInstall, safeJoin } from './paths.mjs';
import { checkGuiSyntax } from './syntax.mjs';

const TAB = '\t';

/** Boolean fields the engine expects as `yes`/`no`. */
const BOOLEAN_FIELDS = new Set([
  'moveable',
  'clipping',
  'alwaysTransparent',
  'fixedSize',
  'centerPosition',
  'multiline',
  'mirror',
  'add_horizontal',
  'first_on_top',
  'horizontal',
  'autohide_scrollbar',
  'resizeparent',
  'is_dynamic',
  'truncate',
  'wraparound',
  'no_clicksound',
  'tooltip_mode_enabled',
  'smooth_scrolling',
  'click_to_front',
  'dontrender',
  'fullscreen',
  'respect_parent_boundaries',
  'click_to_front',
  // NOTE: `verticalscrollbar` / `horizontalscrollbar` are NOT here. They read like flags but they
  // are scrollbar NAMES - `verticalScrollBar = "right_vertical_slider"`
  // (`interface/additional_content/additional_content.gui:277`) - and treating them as booleans
  // wrote `verticalScrollBar = no`, which is why `kinds.mjs` types them `string`. Measured across
  // the install: every one of their uses is a quoted name, 0 are `yes`/`no`.
  'allow_multi_line',
  'limited_height',
  'wrap_text',
  // `editBoxType.instantTextBoxType` is a BOOLEAN FLAG on that kind, not the text element kind of
  // the same name (42 of the 85 vanilla blocks write it, `interface/browser_dialog.gui:82`).
  'instantTextBoxType',
  'instanttextboxtype',
  'use_special_chars',
]);

/**
 * Field order per kind: the dominant vanilla order, so output diffs cleanly against vanilla.
 * `SIZE` is a placeholder replaced by `size` or `maxSize` (or dropped) according to the kind's
 * measured size form - see kinds.mjs.
 */
const FIELD_ORDER = {
  common: ['name', 'position', 'SIZE', 'orientation', 'origo', 'moveable', 'clipping', 'alwaysTransparent'],
  container: ['background', 'scale', 'rotation', 'pdx_tooltip', 'pdx_tooltip_delayed', 'pdx_tooltip_anchor_orientation', 'pdx_tooltip_anchor_offset', 'shortcut', 'margin', 'verticalscrollbar', 'horizontalscrollbar', 'scroll_wheel_factor', 'smooth_scrolling', 'clipping', 'fade_type', 'fade_time', 'animation_type', 'animation_time', 'show_animation_type', 'hide_animation_type', 'dynamic_extra_y', 'dynamic_extra_height', 'dynamic_extra_height_max', 'respect_parent_boundaries', 'click_to_front', 'dontrender', 'upsound', 'engineId'],
  text: ['font', 'text', 'appendText', 'fixedSize', 'format', 'vertical_alignment', 'text_color_code', 'multiline', 'borderSize', 'texturefile', 'truncate', 'tooltip', 'tooltip_mode_enabled', 'scrollbartype', 'dynamic_extra_height', 'pdx_tooltip', 'pdx_tooltip_delayed'],
  icon: ['spriteType', 'quadTextureSprite', 'frame', 'scale', 'rotation', 'centerPosition', 'mirror', 'tooltip', 'tooltip_mode_enabled', 'pdx_tooltip', 'pdx_tooltip_delayed', 'engineId'],
  button: ['spriteType', 'quadTextureSprite', 'frame', 'scale', 'buttonFont', 'font', 'text', 'buttonText', 'format', 'vertical_alignment', 'multiline', 'shortcut', 'navUp', 'navDown', 'clicksound', 'oversound', 'no_clicksound', 'web_link', 'actionShortcut', 'tooltip', 'pdx_tooltip', 'pdx_tooltip_delayed', 'engineId'],
  effectbutton: ['spriteType', 'quadTextureSprite', 'frame', 'scale', 'buttonFont', 'font', 'text', 'buttonText', 'effect', 'format', 'vertical_alignment', 'multiline', 'shortcut', 'clicksound', 'oversound', 'no_clicksound', 'custom_tooltip', 'tooltipText', 'delayedTooltipText', 'fail_text'],
  gridBox: ['scale', 'background', 'format', 'max_slots_horizontal', 'max_slots_vertical', 'slotSize', 'padding', 'add_horizontal', 'resizeparent', 'is_dynamic', 'defaultSelection', 'pdx_tooltip'],
  listBox: ['scale', 'background', 'scrollbartype', 'borderSize', 'spacing', 'priority', 'autohide_scrollbar', 'horizontal', 'pdx_tooltip'],
  smoothListBox: ['scale', 'background', 'scrollbartype', 'borderSize', 'spacing', 'offset', 'defaultSelection', 'priority', 'autohide_scrollbar', 'horizontal', 'wraparound', 'dynamic_extra_height', 'navUp', 'navDown', 'pdx_tooltip', 'engineId'],
  overlappingElementsBox: ['scale', 'background', 'format', 'spacing', 'first_on_top', 'horizontal', 'direction', 'pdx_tooltip'],
  guiButton: ['spriteType', 'quadTextureSprite', 'frame', 'scale', 'buttonFont', 'font', 'buttonText', 'text', 'tooltip', 'tooltipText', 'delayedTooltipText', 'parent', 'clicksound', 'no_clicksound', 'shortcut', 'web_link', 'pdx_tooltip'],
  scrollbar: ['scale', 'background', 'slider', 'track', 'leftbutton', 'rightbutton', 'engineId', 'priority', 'borderSize', 'maxValue', 'minValue', 'stepSize', 'startValue', 'horizontal', 'navUp', 'navDown', 'snappoint', 'snappoint_center', 'pdx_tooltip'],
  // THE FIVE KINDS THAT WERE PARSED BUT NOT WRITABLE. Field order per kind is the dominant vanilla
  // order, measured over every block of that kind in the install; each list is checked against the
  // kind's own declared field set by `scripts/selftest.mjs` (a FIELD_ORDER entry the kind does not
  // accept is dead code, and a declared field with no order entry is never written).
  editBox: ['font', 'text', 'texturefile', 'instantTextBoxType', 'max_characters', 'allow_multi_line', 'use_special_chars', 'limited_height', 'wrap_text', 'text_color_code', 'multiline', 'borderSize', 'cursor', 'tooltip', 'pdx_tooltip', 'pdx_tooltip_delayed'],
  checkbox: ['spriteType', 'quadTextureSprite', 'scale', 'pdx_tooltip', 'pdx_tooltip_delayed', 'clicksound', 'oversound', 'no_clicksound', 'shortcut', 'tooltip_mode_enabled'],
  spinner: ['borderSize', 'overlay', 'leftbutton', 'rightbutton', 'priority', 'maxValue', 'minValue', 'startValue', 'stepSize', 'defaultSelection', 'horizontal', 'navUp', 'navDown', 'engineId', 'clicksound', 'no_clicksound'],
  dropDownBox: ['scale', 'clipping', 'background', 'pdx_tooltip'],
  window: ['scale', 'background', 'moveable', 'dontrender', 'fullscreen', 'horizontalborder', 'verticalborder', 'clicksound', 'oversound', 'no_clicksound', 'pdx_tooltip'],
  // A bar is a COMPONENT and never reaches the emitter as a `bar` node - `computeLayout` has
  // already expanded it into the containers and text below - so this entry exists to keep the
  // table complete, not to write anything. The shape it expands to is the container shape.
  bar: ['background'],
};

/** Fields that are localisation keys, emitted as quoted strings and stubbed in the .yml. */
const LOC_FIELDS = ['text', 'buttonText', 'pdx_tooltip', 'pdx_tooltip_delayed', 'custom_tooltip', 'fail_text', 'tooltipText', 'delayedTooltipText', 'tooltip'];

/**
 * Fields whose value is a bare engine keyword or a named reference the engine parses without
 * quotes. Everything else is quoted, because vanilla quotes `name`, loc keys and sound names
 * (`clicksound = "back_click"`) and a quoted scalar is valid everywhere.
 */
const BARE_VALUE_FIELDS = new Set([
  'orientation',
  'origo',
  'pdx_tooltip_anchor_orientation',
  'format',
  'vertical_alignment',
  'text_color_code',
  'effect',
  'shortcut',
  'actionShortcut',
  'direction',
  'fade_type',
  'animation_type',
  'show_animation_type',
  'hide_animation_type',
]);

const ALWAYS_QUOTED_FIELDS = new Set(['name', 'spriteType', 'quadTextureSprite', 'font', 'buttonFont', 'scrollbartype', 'slider', 'track', 'leftbutton', 'rightbutton', 'snappoint', 'snappoint_center', 'parent', 'id', 'texturefile', 'background']);

/**
 * Model field -> the name the engine reads.
 *
 * `engineId` is the model's name for the engine's `id` field. The rename exists because `node.id`
 * is THIS MODEL's node identity: `applyEdits` invents a random hex id whenever a node lacks one
 * (`src/lib/layout.mjs`), so writing `node.id` as an engine field put random hex strings into
 * `.gui` files, and not writing it lost a real field on six kinds. Measured uses of the engine's
 * `id` across the install's 177 `.gui` files, attributed to the innermost enclosing element:
 * `spinnerType` 37 (of 40), `buttonType` 25 (of 2067), `scrollbartype` 12 (of 24),
 * `smoothListboxType` 10 (of 243), `iconType` 7 (of 2779), `containerWindowType` 1 (of 3305).
 */
const EMIT_FIELD_ALIAS = { engineId: 'id' };

/** Node keys that are model plumbing, never written to a file. */
const NON_FIELD_KEYS = new Set([
  'id',
  'kind',
  'type',
  'name',
  'children',
  'variables',
  'sourceFile',
  'sourceLine',
  'subBlocks',
  'conditionals',
  'extra',
  'background',
  'keywords',
  'keyword',
  'centerPositionDerived',
  // Canonical-coordinate plumbing (src/lib/coords.mjs). `position` is deliberately NOT here: it is
  // written, but from `coordinateFields.position` - the engine literal - never from the canonical
  // value the model holds.
  'coordinateFields',
  'enginePosition',
  'engineOrientation',
  'positionDeclared',
  'parsedCanonicalPosition',
  'resolutionSize',
  // ELEMENT BLOCKS WHOSE KEY IS A FIELD NAME (src/lib/kinds.mjs `AS_FIELD_ELEMENT_KINDS`).
  // `asField` is the key to write INSTEAD of the kind's keyword, so a `dropDownBoxType`'s
  // `expandedWindow`/`expandButton` bodies come out as `expandedWindow = { ... }` rather than
  // `containerWindowType = { ... }`. It is model plumbing, not an engine field: a literal
  // `asField = "..."` line would be "Unexpected token: asField".
  'asField',
  // `engineId` is written by the FIELD_ORDER pass (as the engine's `id`, see EMIT_FIELD_ALIAS), so
  // the generic pass-through must not also write it under its own name.
  'engineId',
  'generatedId',
  // COMPONENT PLUMBING (src/lib/components.mjs). A `bar` is expanded by `computeLayout` into real
  // containers and text BEFORE the emitter sees it, and these keys record that expansion so the
  // validator can measure the label's box and the report can say which piece is which. None of
  // them is an engine field: a `component = "bar-fill"` line in a `.gui` file would be
  // "Unexpected token: component".
  'component',
  'componentLive',
  'componentOf',
  // The piece's own role inside its bar (`name`, `track`, `fill`, `value`, `seats`, `label`). It is
  // what a CLONE derives its element names from (see `renameBarClone`), and it is not an engine
  // field any more than `component` is.
  'role',
  'barGeometry',
  // MATRIX PLUMBING (src/lib/components.mjs). `matrixGeometry` is the matrix's own geometry on its
  // frame; `matrixCell` is the slot a cell was placed in. Neither is an engine field.
  'matrixGeometry',
  'matrixCell',
]);

/**
 * The refusal set every output root shares: a game install, the user-data folder, or a mod
 * workspace. Returns the reason string, or null when the path is an acceptable output area.
 *
 * It is a separate function because the handoff channel needs the SAME refusals for a root it did
 * not receive from a caller (`<project>/out/handoff`, this plugin's own output area). A guard that
 * exists in two copies drifts; this one does not exist twice.
 */
export function forbiddenOutputRootReason(outputRoot) {
  if (typeof outputRoot !== 'string' || outputRoot.trim() === '') {
    return 'an explicit output_root is required; emitted files are never written without one';
  }
  if (!isAbsolute(outputRoot)) {
    return `output_root must be an absolute path, got \`${outputRoot}\``;
  }
  const root = resolve(outputRoot);
  const lowered = root.toLowerCase().replace(/\\/g, '/');
  // Cheap spelling checks first, then the one that actually decides. The spellings
  // cover Steam layouts and the developer's stale tree; neither fires for an install
  // at a plain path such as E:\Stellaris, so the CONTENT of the directory is what
  // makes "never write into a game install" true rather than merely stated.
  if (lowered.includes('/steamapps/common/stellaris') || lowered.includes('/st-new')) {
    return `refusing to write into a Stellaris install: ${root}`;
  }
  const install = insideGameInstall(root);
  if (install) {
    return (
      `refusing to write into a Stellaris install: ${root} is inside ${install}, which holds the game `
      + '(stellaris.exe / launcher-settings.json). Emitted files go to a fresh output directory instead.'
    );
  }
  if (/\/documents\/paradox interactive\/stellaris/.test(lowered)) {
    return `refusing to write into the Stellaris user-data folder (${root}): that is a game folder, not an output folder`;
  }
  if (existsSync(join(root, 'descriptor.mod'))) {
    return (
      `refusing to write into ${root}: it contains descriptor.mod, so it is a mod workspace. ` +
      'This tool emits standalone files only; pass a fresh output directory. ' +
      'To override a vanilla file on purpose, use gui_emit_override, which confirms the move explicitly.'
    );
  }
  return null;
}

/**
 * Refuse an output root that is a game install or an existing mod workspace.
 *
 * This is the hard constraint from the brief expressed as code: standalone output only, never
 * into a mod workspace or any game/mods folder.
 */
export function assertOutputRoot(outputRoot) {
  const reason = forbiddenOutputRootReason(outputRoot);
  if (reason) throw new Error(reason);
  return resolve(outputRoot);
}

/**
 * The handoff channel's own output area.
 *
 * A submission is written under `<project>/out/handoff/`, which is this plugin's own output
 * directory rather than a caller-chosen one, so it needs no "you must type a path" rule - but it
 * needs every REFUSAL the normal path has. Nothing may ever be written into a game install, the
 * user-data folder or a mod workspace, not even by accident, and this is the door that would
 * otherwise skip the check because the caller never supplied a path.
 */
export function assertHandoffRoot(outputRoot) {
  const root = resolve(outputRoot);
  const reason = forbiddenOutputRootReason(root);
  if (reason) {
    throw new Error(
      `refusing to use ${root} as the handoff root: ${reason}. The handoff area is this plugin's own ` +
        'output directory (out/handoff under the project), never a game, user-data or mod folder.',
    );
  }
  return root;
}

/**
 * The override door: the same install / user-data refusals, but a mod workspace is allowed
 * because overriding a vanilla file is the whole point of the call.
 *
 * The caller has already had to set `i_understand_this_overrides_vanilla_file: true`, so the
 * only thing left to enforce is that the write still cannot land in a game folder and that the
 * target stays inside the caller's chosen output root.
 */
export function assertOverrideRoot(outputRoot) {
  if (typeof outputRoot !== 'string' || outputRoot.trim() === '') {
    throw new Error('an explicit output_root is required for an override; it is never written without one');
  }
  if (!isAbsolute(outputRoot)) {
    throw new Error(`output_root must be an absolute path, got \`${outputRoot}\``);
  }
  const root = resolve(outputRoot);
  const lowered = root.toLowerCase().replace(/\\/g, '/');
  if (lowered.includes('/steamapps/common/stellaris')) {
    throw new Error(`refusing to write an override into a Stellaris install: ${root}`);
  }
  if (/\/documents\/paradox interactive\/stellaris(\/|$)/.test(lowered)) {
    throw new Error(`refusing to write an override into the Stellaris user-data folder: ${root}`);
  }
  if (/\/gfx\/(interface|fx|models|particles)(\/|$)/.test(lowered)) {
    throw new Error(`refusing to write an override under gfx/: ${root}`);
  }
  return root;
}

/** Format a scalar for output. */
export function formatScalar(field, value) {
  if (value === null || value === undefined) return null;
  if (BOOLEAN_FIELDS.has(field)) {
    // `yes`/`true`/`1` are true and `no`/`false`/`0` are false. The numeric spellings are not
    // hypothetical: EVERY one of the install's 40 `spinnerType` blocks writes `horizontal = 1`,
    // and a `1` used to fall through to `no` - a silently INVERTED boolean, which is the worst
    // kind of round-trip defect because the file still parses.
    if (value === true || value === 1 || value === 'yes' || value === 'true' || value === '1') return 'yes';
    return 'no';
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return String(value);
  const text = String(value);
  // `@variable` references and numeric literals are never quoted; percentages keep their
  // `%`/`%%` suffix verbatim because that suffix is the size semantics.
  if (/^@[A-Za-z0-9_]+$/.test(text)) return text;
  if (/^-?[0-9]+(%{0,2})?$/.test(text)) return text;
  if (BARE_VALUE_FIELDS.has(field) && /^[A-Za-z][A-Za-z0-9_]*$/.test(text)) return text;
  void ALWAYS_QUOTED_FIELDS;
  return `"${text}"`;
}

/**
 * Render the *inner* lines of a `position` / `size` sub-block (no braces, no key line).
 * The caller owns the indentation, which is what keeps this out of the nesting bugs that
 * arise when a helper both indents and is re-indented by its caller.
 *
 * `keyA`/`keyB` choose the axis spelling: `x`/`y` for the button/list form, `width`/`height`
 * for the container form. A model node may hold either spelling (the parser normalises both
 * onto `width`/`height`), so the fallback order covers both.
 */
function renderPairLines(value, depth, keyA = 'x', keyB = 'y') {
  const pad = TAB.repeat(depth);
  const lines = [];
  const candidatesA = keyA === 'width' ? ['width', 'x'] : [keyA, 'width'];
  const candidatesB = keyB === 'height' ? ['height', 'y'] : [keyB, 'height'];
  for (const candidate of candidatesA) {
    if (value[candidate] === undefined) continue;
    lines.push(`${pad}${keyA} = ${formatScalar(keyA, value[candidate])}`);
    break;
  }
  for (const candidate of candidatesB) {
    if (value[candidate] === undefined) continue;
    lines.push(`${pad}${keyB} = ${formatScalar(keyB, value[candidate])}`);
    break;
  }
  return lines;
}

/** Render a complete `position = { x y }` / `size = { ... }` block. */
function renderPair(key, value, depth, keyA = 'x', keyB = 'y') {
  const pad = TAB.repeat(depth);
  return [`${pad}${key} = {`, ...renderPairLines(value, depth + 1, keyA, keyB), `${pad}}`];
}

/**
 * Render a `background = { ... }` sub-block.
 *
 * EVERY field the corpus puts in a background belongs here. The first revision wrote only `name`,
 * `position`, the sprite and `alwaysTransparent` and dropped the rest SILENTLY - and
 * `kinds.mjs`'s `BACKGROUND_FIELDS` (measured: 1696 `name`, 1210 `spriteType`, plus `size`,
 * `alpha`, `frame`, `font`, `clicksound`, `no_clicksound`, the tooltip family) already knew the
 * full set. It went unnoticed because the one construction this project cloned by hand uses only
 * `quadTextureSprite`; the 13 `dropDownBoxType` blocks do not - every one of them carries a
 * `background` with `pdx_tooltip`, `no_clicksound` and (usually) a `size`.
 *
 * `spriteField` preserves WHICH spelling the source used, because the two are not interchangeable:
 * a 9-slice cornered tile must go to `quadTextureSprite` and a fixed sprite to `spriteType`
 * (the rule `gui_assets_defaults` documents). Without it, `spriteType = "GFX_dropdown_button_104"`
 * came back as `quadTextureSprite`, and the fixed sprite was drawn as a cornered tile.
 */
function renderBackground(background, depth) {
  const pad = TAB.repeat(depth);
  const inner = TAB.repeat(depth + 1);
  const lines = [`${pad}background = {`];
  if (background.name) lines.push(`${inner}name = ${formatScalar('name', background.name)}`);
  if (background.sprite) {
    const field = background.spriteField === 'spriteType' ? 'spriteType' : 'quadTextureSprite';
    lines.push(`${inner}${field} = ${formatScalar(field, background.sprite)}`);
  }
  if (background.position) lines.push(...renderPair('position', background.position, depth + 1));
  // A background's own `size` is written `size = { x = 65 y = 38 }` in the corpus
  // (`interface/diplomacy_view.gui:1450`), i.e. the x/y form, NOT the width/height container form.
  if (background.size) lines.push(...renderPair('size', background.size, depth + 1));
  if (background.alwaysTransparent !== undefined && background.alwaysTransparent !== null) {
    lines.push(`${inner}alwaysTransparent = ${formatScalar('alwaysTransparent', background.alwaysTransparent)}`);
  }
  // The rest of the measured background field set, then anything else the block carried, in a
  // stable order so two emissions of one tree are identical.
  const ordered = new Set(['name', 'spritetype', 'quadtexturesprite', 'position', 'size', 'alwaystransparent']);
  for (const [field, value] of Object.entries(background.extra ?? {})) {
    if (ordered.has(field.toLowerCase())) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      const pair = PAIR_FIELDS[field];
      if (pair) lines.push(...renderPair(field, value, depth + 1, pair[0], pair[1]));
      else lines.push(...renderScalarBlock(field, value, depth + 1));
      continue;
    }
    const formatted = formatScalar(field, value);
    if (formatted === null) continue;
    lines.push(`${inner}${field} = ${formatted}`);
  }
  lines.push(`${pad}}`);
  return lines;
}

/** `null` when nothing was declared, so "absent" stays distinct from a declared 0. */
function declaredOrNull(...candidates) {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && candidate !== '') return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// CANONICAL -> ENGINE COORDINATE CONVERSION (the single code path shared by the emitter, the rect
// table and the preview)
// ---------------------------------------------------------------------------------------------
//
// The model is canonical: origin top-left, +y down, `position` is the top-left offset from the
// parent's top-left (src/lib/coords.mjs states the system and the evidence). The ENGINE is not:
// `position` there is an offset inside the parent's `orientation` anchor, and for the `lower_*`
// anchors a positive y moves AWAY from the parent, up the screen.
//
// `prepareEngineCoordinates` is where the whole tree is translated, ONCE, just before rendering:
//
//   * `node.position`      stays canonical (it is the model the preview and the rect table draw);
//   * `node.enginePosition` becomes the literal the file must carry;
//   * `node.engineOrientation` becomes the `orientation` that literal is measured against.
//
// `renderElement` then writes `position` from `piece.position` (a reserved key it copies into the
// node it serialises), so there is exactly one conversion and no chance of the preview and the
// file disagreeing about where an element is.
//
// Sizes are NOT converted here. The engine resolves `-N` and `%%` with its own arithmetic, and
// vanilla uses those forms 88 times; leaving them literal preserves byte-identical round trips of
// vanilla files. The one case where the two readings of a `%`/`%%`/negative size can differ is a
// `lower_*` element, and `sizeFormIsAnchorSafe` covers it by resolving the size to pixels and
// saying so in a warning.

/**
 * True when this declared size value means the same thing in canonical space and in the engine's
 * anchor frame, so it can be written literally: an integer or an `@variable`.
 *
 * `100%`, `100%%` and `-16` are all resolved relative to the element's `position`, and for a
 * `lower_*` anchor the engine's `position` and the canonical one differ in sign - so those forms
 * are only safe when the anchor does not flip y.
 */
export function sizeValueIsAnchorSafe(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (/^@[A-Za-z0-9_]+$/.test(trimmed)) return true;
  return /^[0-9]+$/.test(trimmed);
}

/** True when every declared size component of this node is safe to write literally. */
export function sizeFormIsAnchorSafe(node) {
  const parts = [node.size?.width, node.size?.x, node.size?.height, node.size?.y, node.maxWidth, node.maxHeight];
  return parts.filter((part) => part !== undefined && part !== null && part !== '').every(sizeValueIsAnchorSafe);
}

/**
 * Convert every node's canonical `position` into the engine literal the file must carry, and settle
 * the `orientation` that literal is measured against.
 *
 * @param {object} layout
 * @param {{baseWidth?: number, baseHeight?: number, spriteLookup?: Function|null, warnings?: object[]}} options
 * @returns {object} the same layout, mutated (callers own their copy)
 */
export function prepareEngineCoordinates(layout, options = {}) {
  const base = layout?.baseResolution ?? BASE_RESOLUTION;
  // A SANITY GUARD, not decoration. Two bugs produced a literal `NaN` in an emitted `position`
  // before this existed: a canonical position derived from an `@variable` that the first layout
  // pass could not resolve, and a `Number(...)` over a non-numeric string. Neither is representable
  // in a `.gui` file, and `NaN` there is worse than a missing line because the engine's parser sees
  // a token it does not know. Any non-finite coordinate is dropped here, and the caller gets a
  // warning telling it which element and which value.
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const guard = (point, path, label) => {
    if (!point) return null;
    if (finite(point.x) && finite(point.y)) return point;
    (options.warnings ?? []).push({
      rule: 'coordinate-not-finite',
      severity: 'error',
      path,
      message:
        `\`${label}\` for this element did not resolve to finite numbers (${JSON.stringify(point)}), so the ` +
        'engine fields could not be derived and the element was left without them. This is a bug in the ' +
        'layout model, not something a .gui file can express.',
      suggestedFix: 'give the element literal pixel coordinates, or declare the @variable it references.',
    });
    return null;
  };
  const rootRect = {
    x: 0,
    y: 0,
    width: options.baseWidth ?? base.width ?? BASE_RESOLUTION.width,
    height: options.baseHeight ?? base.height ?? BASE_RESOLUTION.height,
  };
  const boxes = new Map();
  const rects = new Map();
  try {
    const computed = computeLayout(layout, {
      baseWidth: rootRect.width,
      baseHeight: rootRect.height,
      spriteLookup: options.spriteLookup ?? null,
    });
    for (const box of computed.boxes) {
      boxes.set(box.path, { rect: box.rect, parentRect: box.parentRect });
      rects.set(box.path, box.rect);
    }
  } catch {
    /* a tree that cannot be laid out still gets positions converted against what is known */
  }

  const visit = (node, parentRect, parentPath) => {
    const path = parentPath ? `${parentPath}/${node.name ?? node.id ?? '?'}` : node.name ?? 'root';
    const box = boxes.get(path);
    const orientation = chooseOrientationFor(node);
    const canonicalPosition = node.position
      ? { x: node.position.x ?? 0, y: node.position.y ?? 0 }
      : { x: 0, y: 0 };
    // A DECLARATION THAT DOES NOT RESOLVE. `position = { x = @var y = @other }` cannot be turned
    // into a canonical offset, and it must be written back exactly as it was written - not as a
    // number, and never as `NaN`. The parser leaves such a node without an `enginePosition`, so
    // this is the branch that handles it.
    if (node.position && !Number.isFinite(Number(canonicalPosition.x)) && !Number.isFinite(Number(canonicalPosition.y))) {
      node.coordinateFields = null;
      for (const child of node.children ?? []) visit(child, box?.rect ?? parentRect, path);
      return;
    }
    const parsed = node.parsedCanonicalPosition;
    const parsedMatches =
      parsed !== undefined && Math.abs(parsed.x - canonicalPosition.x) < 1e-9 && Math.abs(parsed.y - canonicalPosition.y) < 1e-9;
    let engine = null;
    if (node.enginePosition && parsedMatches) {
      // The literal a parsed file carried is exactly what the engine read, and re-deriving it from
      // the canonical model would make the emitted file depend on this layout pass. Keeping it is
      // what makes an import -> emit round trip of a vanilla file exact. The check above is what
      // stops a stale literal surviving an edit: the moment the canonical position moves, this
      // falls through to `canonicalPositionToEngine`.
      engine = guard({ x: node.enginePosition.x ?? 0, y: node.enginePosition.y ?? 0 }, path, 'enginePosition');
    } else {
      engine = guard(canonicalPositionToEngine(canonicalPosition, orientation, parentRect), path, 'position');
    }
    if (!engine) {
      node.coordinateFields = null;
      for (const child of node.children ?? []) visit(child, box?.rect ?? parentRect, path);
      return;
    }
    // `positionDeclared` is set only by the PARSER. A parsed element writes exactly what its file
    // had, plus the `orientation`/`origo` the conversion depends on; a canonical tree - where the
    // flag is undefined - always writes the pair.
    const writePair = node.positionDeclared !== false || engine.x !== 0 || engine.y !== 0;
    node.position = { ...canonicalPosition };
    node.enginePosition = engine;
    node.coordinateFields = { orientation: node.orientation ?? orientation, position: { ...engine } };
    node.positionDeclared = true;
    if (!writePair) node.coordinateFields.orientation = null;
    const childParentRect =
      box?.rect ??
      {
        x: parentRect.x + canonicalPosition.x,
        y: parentRect.y + canonicalPosition.y,
        width: 0,
        height: 0,
      };
    for (const child of node.children ?? []) visit(child, childParentRect, path);
  };

  if (layout?.root) visit(layout.root, rootRect, layout.root.syntheticRoot ? String(layout.root.name ?? 'root') : '');
  // The caller gets the rects this pass computed, so `emitGui` does not lay the tree out a second
  // time just to resolve `maxWidth`/`maxHeight`.
  if (options.rectsOut instanceof Map) for (const [key, value] of rects) options.rectsOut.set(key, value);
  return layout;
}

/**
 * The `orientation` a node's engine literal is measured against.
 *
 * A parsed node carries its own `orientation`, and keeping it verbatim is what makes the
 * conversion exactly invertible (including vanilla's 30 spellings of the nine anchors). A
 * caller-built node normally carries none, and then `upper_left` is the right answer rather than a
 * guess: with the default anchor the engine literal IS the canonical offset, so nothing is
 * rewritten and nothing can flip. Picking `lower_*` by quadrant would be more idiomatic vanilla,
 * but it would also silently add an anchor the caller never wrote, and a wholesale change of
 * anchors is exactly the class of edit that moved a close button into the wrong container.
 */
function chooseOrientationFor(node) {
  if (node.orientation) return node.orientation;
  return 'upper_left';
}

/**
 * A value the engine reads verbatim in a `maxWidth`/`maxHeight` or `size = { x y }` slot.
 *
 * Vanilla only ever writes a plain integer or an `@variable` in those two places (measured
 * over 3218 text blocks and 450 button size blocks: 0 percentages, 0 negative values), so a
 * `100%%` or `-16` declaration has to be resolved to an absolute pixel value instead.
 */
function literalOrVariable(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^-?[0-9]+$/.test(trimmed)) return trimmed;
  if (/^@[A-Za-z0-9_]+$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Emit the size declaration a kind's own parser accepts.
 *
 * Returns lines, and records `size-value-resolved` / `size-not-accepted` / `size-unresolved`
 * warnings that name the element (an earlier revision emitted the literal string
 * `kind-not-emittable: undefined`, which told a caller nothing).
 */
function renderSizeLines(node, spec, keyword, depth, context) {
  const { form } = sizeFormFor(spec, keyword);
  const where = context.path;
  const name = node.name ?? where;

  if (form === SIZE_FORMS.none) {
    const declared = declaredOrNull(node.size?.width, node.size?.x, node.size?.height, node.size?.y);
    if (declared !== null) {
      const natural = context.spriteLookup?.(node.quadTextureSprite ?? node.spriteType) ?? null;
      const matches = natural ? natural.width === (node.size?.width ?? node.size?.x) && natural.height === (node.size?.height ?? node.size?.y) : false;
      context.warnings.push({
        rule: 'size-not-accepted',
        severity: natural && !matches ? 'error' : 'warning',
        kind: spec.kind,
        keyword,
        name,
        path: where,
        engineMessage: 'Unexpected token: size',
        message:
          `\`${keyword}\` does not accept a \`size\` block - the engine answers "Unexpected token: size" - so the ` +
          `declared ${JSON.stringify(node.size)} was NOT written. ` +
          (natural
            ? matches
              ? `The sprite's texture is already ${natural.width}x${natural.height}, so the emitted file is identical either way.`
              : `The sprite draws at its texture size, ${natural.width}x${natural.height}, NOT the declared size.`
            : 'The element draws at its sprite texture\'s natural size instead.'),
        suggestedFix:
          spec.kind === 'icon'
            ? 'pick a sprite whose texture is already the size you want, or put the icon in a containerWindowType and size the container.'
            : 'remove the size, or switch to a kind that accepts one (container/button/listBox).',
      });
    }
    return [];
  }

  if (form === SIZE_FORMS.maxWidthHeight) {
    const width = declaredOrNull(node.size?.width, node.maxWidth);
    const height = declaredOrNull(node.size?.height, node.maxHeight);
    return renderResolvedPair(node, 'maxWidth', 'maxHeight', width, height, depth, context, spec);
  }

  const width = declaredOrNull(node.size?.width, node.size?.x);
  const height = declaredOrNull(node.size?.height, node.size?.y);
  if (width === null && height === null) return [];

  if (form === SIZE_FORMS.xY) {
    return renderResolvedPair(node, 'x', 'y', width, height, depth, context, spec);
  }
  // `size = { width height }`: every legal declarative form is accepted here verbatim
  // (221 `100%`, 12 `100%%` and 64 negative values appear in vanilla).
  return renderPair('size', { width, height }, depth, 'width', 'height');
}

/**
 * Render `maxWidth`/`maxHeight` (text) or `size = { x y }` (buttons, lists, scrollbars).
 *
 * Both are integer-or-`@variable` slots in the engine's parsers, so anything else is resolved
 * against the computed layout and reported as `size-value-resolved`.
 */
function renderResolvedPair(node, keyA, keyB, rawA, rawB, depth, context, spec) {
  const wrapped = keyA === 'x';
  const pad = TAB.repeat(depth);
  const fieldPad = TAB.repeat(wrapped ? depth + 1 : depth);
  const lines = [];
  for (const [field, raw, axis] of [
    [keyA, rawA, 'width'],
    [keyB, rawB, 'height'],
  ]) {
    if (raw === null) continue;
    const literal = literalOrVariable(raw);
    if (literal !== null) {
      lines.push(`${fieldPad}${field} = ${literal}`);
      continue;
    }
    const rect = context.resolvedRects?.get(context.path) ?? null;
    const resolved = rect ? Math.round(axis === 'width' ? rect.width : rect.height) : null;
    if (resolved !== null && resolved >= 0) {
      lines.push(`${fieldPad}${field} = ${resolved}`);
      context.warnings.push({
        rule: 'size-value-resolved',
        severity: 'info',
        kind: spec.kind,
        name: node.name ?? context.path,
        path: context.path,
        message:
          `\`${field} = ${JSON.stringify(raw)}\` was resolved to ${resolved}. \`${keyA}\`/\`${keyB}\` takes only an ` +
          'integer or an `@variable`: vanilla writes 0 percentages and 0 negative values there, unlike ' +
          '`containerWindowType`, whose `size = { width height }` accepts `%`, `%%` and negative forms.',
        suggestedFix: `write \`${field} = ${resolved}\` directly, or declare \`@var = ${resolved}\` and reference it.`,
      });
      continue;
    }
    context.warnings.push({
      rule: 'size-unresolved',
      severity: 'warning',
      kind: spec.kind,
      name: node.name ?? context.path,
      path: context.path,
      message: `\`${field} = ${JSON.stringify(raw)}\` is neither an integer nor an @variable and did not resolve against the layout, so it was not written.`,
      suggestedFix: `give \`${field}\` a pixel value, or an @variable that holds one.`,
    });
  }
  if (lines.length === 0) return [];
  if (!wrapped) return lines;
  return [`${pad}size = {`, ...lines, `${pad}}`];
}

/**
 * Every field whose value is a sub-block of axis pairs, with the spelling vanilla uses for it.
 * `slotSize` is the odd one out: gridBoxType writes `slotSize = { width height }` (133 uses)
 * while everything else in this list writes x/y.
 */
const PAIR_FIELDS = {
  position: ['x', 'y'],
  borderSize: ['x', 'y'],
  offset: ['x', 'y'],
  cursor: ['x', 'y'],
  overlay: ['x', 'y'],
  pdx_tooltip_anchor_offset: ['x', 'y'],
  show_position: ['x', 'y'],
  hide_position: ['x', 'y'],
  slotSize: ['width', 'height'],
  slotsize: ['width', 'height'],
};

/** Render an arbitrary `key = { a = 1 b = 2 }` block (padding, margin, anything non-axis). */
function renderScalarBlock(key, value, depth) {
  const pad = TAB.repeat(depth);
  const inner = TAB.repeat(depth + 1);
  const lines = [`${pad}${key} = {`];
  for (const [field, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined || typeof entry === 'object') continue;
    const formatted = formatScalar(field, entry);
    if (formatted === null) continue;
    lines.push(`${inner}${field} = ${formatted}`);
  }
  lines.push(`${pad}}`);
  return lines;
}

/**
 * Serialise one element node to `.gui` lines.
 *
 * @param {object} node
 * @param {number} depth tab depth
 * @param {{warnings: object[]}} context
 * @param {string} [parentPath] matches computeLayout's dot/slash path, so text sizes resolve
 */
export function renderElement(node, depth, context, parentPath = '') {
  const spec = kindSpec(node.kind ?? node.type);
  const here = parentPath ? `${parentPath}/${node.name ?? node.id ?? '?'}` : node.name ?? 'root';
  const childContext = { ...context, path: here };
  if (!spec) {
    context.warnings.push({ rule: 'kind-unknown', kind: node.kind, name: node.name, path: here });
    return [];
  }
  if (!spec.emitter) {
    context.warnings.push({
      rule: 'kind-not-emittable',
      kind: spec.kind,
      keyword: spec.keywords[0],
      name: node.name ?? null,
      path: here,
      message: `\`${spec.keywords[0]}\` (element \`${node.name ?? '(unnamed)'}\` at ${here}) is recognised and laid out but the emitter does not write this kind, so nothing was written for it.`,
      suggestedFix: `rebuild it as one of: ${emittableKinds().join(', ')}.`,
    });
    return [];
  }

  // THE PER-KIND FIELD TRANSLATION. The engine's parsers accept a fixed field set per kind, and a
  // field outside it is "Unexpected token: <field>" - the whole block is dropped at load time.
  // So a field the kind does not accept is not written as-is: it is translated into the form that
  // kind does accept, or dropped WITH A WARNING. An earlier revision emitted whatever the model
  // carried, which is how `custom_tooltip` (a script field) and `alwaysTransparent` on a container
  // (a field only text/icon/button/list accept) reached the file and cost 98 engine errors.
  const handledFields = new Set();
  const translated = translateNodeFields(node, spec, childContext, handledFields);
  node = translated;

  // THE COORDINATE CONVERSION, consumed here. `coordinateFields` was produced by
  // `prepareEngineCoordinates` from the CANONICAL model - the same model the preview and the rect
  // table draw - so the file, the SVG and the table cannot disagree. `node.position` is canonical
  // and is never written; the engine literal lives in `coordinateFields.position`.
  const coordinates = node.coordinateFields ?? null;
  if (coordinates) {
    // The engine's `position` is an offset in the anchor frame; the model's is canonical.
    delete node.position;
    if (coordinates.orientation === null) delete node.orientation;
    else if (coordinates.orientation) node.orientation = coordinates.orientation;
    // `origo` is the element's OWN reference point on both sides of the conversion: the engine
    // subtracts it and so does computeRect, so it is written verbatim.
  }

  const pad = TAB.repeat(depth);
  // Prefer the spelling the source file used when it is one of this kind's own keywords, so a
  // round trip of a vanilla file (`listboxType`, `extendedScrollbarType`, `smoothListboxType`)
  // does not silently re-spell it. Otherwise the dominant keyword wins.
  //
  // `asField` OVERRIDES both, because it names a block that has no keyword at all: a
  // `dropDownBoxType`'s structural parts are `expandedWindow = { ... }` / `expandButton = { ... }`,
  // where the KEY is the field (see kinds.mjs `AS_FIELD_ELEMENT_KINDS`).
  const keyword = node.asField ?? (spec.keywords.includes(node.keyword) ? node.keyword : spec.keywords[0]);
  const lines = [`${pad}${keyword} = {`];

  const { form } = sizeFormFor(spec, keyword);
  // `none` still gets a `size` entry so `renderSizeLines` runs and can REPORT that the declared
  // size cannot be written. An earlier revision dropped the entry and the declaration vanished
  // without a word, which is the one thing the emitter must never do.
  const sizeEntry = form === SIZE_FORMS.maxWidthHeight ? 'maxSize' : 'size';
  const ordered = [];
  const seenField = new Set();
  for (const field of FIELD_ORDER.common) {
    const resolved = field === 'SIZE' ? sizeEntry : field;
    if (!resolved || seenField.has(resolved)) continue;
    seenField.add(resolved);
    ordered.push(resolved);
  }
  for (const field of FIELD_ORDER[spec.kind] ?? []) {
    if (seenField.has(field)) continue;
    seenField.add(field);
    ordered.push(field);
  }

  const emitted = new Set();

  for (const field of ordered) {
    const value = field === 'position' && coordinates ? coordinates.position : node[field];
    const writeAs = EMIT_FIELD_ALIAS[field] ?? field;
    if (field === 'size' || field === 'maxSize') {
      lines.push(...renderSizeLines(node, spec, keyword, depth + 1, childContext));
      continue;
    }
    if (field === 'background') {
      // BOTH spellings, for the one kind that uses both: a `windowType` carries either
      // `backGround = "GFX_..."` (a bare sprite, 18 of 24) or `background = { ... }` (a block).
      // `scalarBackground` used to `continue` unconditionally, which made the two mutually
      // exclusive and silently dropped the block on such a kind.
      if (spec.scalarBackground && typeof node.background === 'string' && node.background !== '') {
        lines.push(`${TAB.repeat(depth + 1)}background = ${formatScalar('background', node.background)}`);
        emitted.add('background');
      }
      continue; // a block background is rendered after the scalars
    }
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'object') {
      // A sub-block. Axis pairs get their vanilla spelling; anything else (padding, margin) is
      // written as a scalar block. NEVER `String(value)`: an earlier revision emitted
      // `borderSize = "[object Object]"`, which the engine cannot read at all.
      const pair = PAIR_FIELDS[field];
      if (pair) lines.push(...renderPair(writeAs, value, depth + 1, pair[0], pair[1]));
      else lines.push(...renderScalarBlock(writeAs, value, depth + 1));
      emitted.add(field);
      continue;
    }
    const formatted = formatScalar(writeAs, value);
    if (formatted === null) continue;
    lines.push(`${TAB.repeat(depth + 1)}${writeAs} = ${formatted}`);
    emitted.add(field);
  }

  // Anything the model carries that the field list does not know about is emitted verbatim
  // rather than dropped: the emitter must never silently lose a field the caller set - unless it
  // is a field this kind's parser rejects, which `translateNodeFields` has already dealt with.
  for (const [field, value] of Object.entries(node)) {
    if (emitted.has(field) || NON_FIELD_KEYS.has(field) || handledFields.has(field)) continue;
    if (field === 'size' || field === 'maxWidth' || field === 'maxHeight') continue; // handled by renderSizeLines
    if (typeof value === 'object') continue;
    const formatted = formatScalar(field, value);
    if (formatted === null) continue;
    lines.push(`${TAB.repeat(depth + 1)}${field} = ${formatted}`);
  }
  if (node.extra) {
    for (const [field, value] of Object.entries(node.extra)) {
      if (handledFields.has(field)) continue;
      const formatted = formatScalar(field, value);
      if (formatted === null) continue;
      lines.push(`${TAB.repeat(depth + 1)}${field} = ${formatted}`);
    }
  }
  if (node.subBlocks) {
    for (const [field, blocks] of Object.entries(node.subBlocks)) {
      // The axis spelling comes from PAIR_FIELDS, not from a default: `slotSize = { width height }`
      // and `overlay = { x y }` are BOTH two-key sub-blocks, and writing a `slotSize` as `x`/`y`
      // (or an `overlay` as `width`/`height`) is a different declaration. 133 + 123 vanilla
      // `slotSize` blocks and 0 of them use x/y.
      const pair = PAIR_FIELDS[field] ?? PAIR_FIELDS[Object.keys(PAIR_FIELDS).find((key) => key.toLowerCase() === field.toLowerCase())] ?? null;
      for (const block of blocks) {
        // `show_position` / `hide_position` / `borderSize` are parsed as axis blocks holding a
        // resolved `position`; anything else nested round-trips as an element.
        if (block.position) lines.push(...renderPair(field, block.position, depth + 1, pair?.[0] ?? 'x', pair?.[1] ?? 'y'));
        else if (block.size) lines.push(...renderPair(field, block.size, depth + 1, pair?.[0] ?? 'width', pair?.[1] ?? 'height'));
        else if (block.kind && kindSpec(block.kind)) lines.push(...renderElement(block, depth + 1, childContext, here));
        else lines.push(`${TAB.repeat(depth + 1)}${field} = { }`);
      }
    }
  }

  if (node.background && spec.background && typeof node.background === 'object') {
    lines.push(...renderBackground(node.background, depth + 1));
  }

  for (const child of node.children ?? []) {
    lines.push(...renderElement(child, depth + 1, childContext, here));
  }

  lines.push(`${pad}}`);
  return lines;
}

function emittableKindsForHelp() {
  return emittableKinds();
}

/**
 * Rewrite a node's fields into the set its kind's engine parser accepts.
 *
 * Returns a shallow copy (the caller's tree is never mutated) plus, in `context.warnings`, one
 * `field-translated` (info) or `field-dropped` (warning) entry per change, so nothing is silent.
 * `handled` collects the original field names so the generic pass-through cannot re-emit them.
 */
export function translateNodeFields(node, spec, context, handled = new Set()) {
  const copy = { ...node };
  const own = [...Object.keys(node), ...Object.keys(node.extra ?? {})];
  for (const field of own) {
    if (NON_FIELD_KEYS.has(field)) continue;
    // TWO SOURCES OF "REJECTED": the global set (proven on a kind where vanilla never writes the
    // field) and the per-kind one (GAP-15: `visible` on a `containerWindowType`). A field the engine
    // rejects is not written into the file, whatever the caller set it to - the alternative is
    // emitting a file the engine drops at load.
    const rejected = isEngineRejectedField(field) || isFieldRejectedForKind(spec, field);
    if (!isKnownField(field) && !rejected) continue; // not a GUI field this project models
    if (kindAcceptsField(spec, field)) {
      // Normalise the spelling to the vanilla one (`tooltiptext` -> `tooltipText`).
      const canonical = canonicalFieldName(field);
      if (canonical !== field) {
        const value = node.extra?.[field] ?? node[field];
        delete copy[field];
        if (copy.extra) delete copy.extra[field];
        copy[canonical] = value;
        handled.add(field);
      }
      continue;
    }
    // A field some OTHER kind accepts but this one does not, where the engine has not been
    // observed rejecting it, is left exactly as the caller wrote it: this table is a summary of
    // the corpus, not a proof, and silently dropping a field a caller set would be worse than
    // writing one vanilla happens never to use. The validator reports it as a warning.
    if (!rejected) continue;
    const value = node.extra?.[field] ?? node[field];
    const result = translateFieldForKind(spec, field, value);
    handled.add(field);
    if (copy.extra) delete copy.extra[field];
    delete copy[field];
    const path = context.path;
    if (result.moveToBackground) {
      const background = typeof node.background === 'object' && node.background ? { ...node.background } : null;
      if (background) {
        background.alwaysTransparent = value === true || value === 'yes' || value === 'true';
        copy.background = background;
        context.warnings.push({
          rule: 'field-translated',
          severity: 'info',
          kind: spec.kind,
          name: node.name ?? path,
          path,
          message: `\`${field} = ${value}\` on a ${spec.keywords[0]} was moved into its \`background\` block. ${result.reason}.`,
          suggestedFix: 'put `alwaysTransparent` inside the `background` block, or use a kind that accepts it directly.',
        });
      } else {
        context.warnings.push({
          rule: 'field-dropped',
          severity: 'warning',
          kind: spec.kind,
          name: node.name ?? path,
          path,
          message: `\`${field} = ${value}\` was NOT written: ${result.reason}, and this element has no ` + '`background` block to move it into.',
          suggestedFix: 'give the container a `background` block and put `alwaysTransparent` inside it.',
        });
      }
      continue;
    }
    if (result.field) {
      copy[result.field] = result.value;
      context.warnings.push({
        rule: 'field-translated',
        severity: 'info',
        kind: spec.kind,
        name: node.name ?? path,
        path,
        message: `\`${field}\` was written as \`${result.field}\`: ${result.reason}.`,
        suggestedFix: `write \`${result.field}\` directly to keep the tree and the file in step.`,
      });
    } else {
      context.warnings.push({
        rule: 'field-dropped',
        severity: 'warning',
        kind: spec.kind,
        name: node.name ?? path,
        path,
        message: `\`${field} = ${value}\` was NOT written: ${result.reason}. The engine would answer "Unexpected token: ${field}".`,
        suggestedFix: `remove the field, or move the intent to a kind that accepts it.`,
      });
    }
  }
  return copy;
}

/**
 * Collect `@variable` declarations for a layout (or for several, merged).
 *
 * Only variables the tree actually references are emitted, and unused declarations are reported
 * separately. This matters for rule 4: an `@name = value` line is only valid BEFORE `guiTypes`,
 * so a declared-but-unused variable must not be stamped into the variable block. (An earlier
 * revision emitted every variable in `layout.variables`, which put an unused one after the root
 * and produced a `.gui` file the engine would not parse.)
 */
export function collectVariableDeclarations(layout) {
  const declarations = new Map();
  const declared = new Map();
  for (const [name, value] of Object.entries(layout.variables ?? {})) {
    if (typeof name !== 'string' || !name.startsWith('@')) continue;
    if (value === undefined || value === null || value === '') continue;
    declared.set(name, String(value));
  }

  // Walk the tree in document order so the emitted order matches the first use.
  const referenced = new Set();
  const scan = (value) => {
    if (typeof value !== 'string') return;
    for (const match of value.matchAll(/@[A-Za-z0-9_]+/g)) referenced.add(match[0]);
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'variables' || key === 'children') continue;
      if (typeof value === 'string') scan(value);
      else if (value && typeof value === 'object') {
        for (const inner of Object.values(value)) {
          if (typeof inner === 'string') scan(inner);
          else if (inner && typeof inner === 'object') for (const deep of Object.values(inner)) scan(deep);
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  if (layout.root) visit(layout.root);

  for (const name of referenced) {
    if (!declared.has(name)) continue;
    declarations.set(name, declared.get(name));
  }

  const unused = [...declared.keys()].filter((name) => !referenced.has(name));
  return { declarations, unused, declared };
}

/**
 * The top-level containerWindowTypes of a layout, in document order. Re-exported from
 * layout.mjs, where the validator's name-collision check also reads it.
 */
export function topLevelContainers(layout) {
  return layoutTopLevelContainers(layout);
}

/**
 * Emit a `.gui` file body.
 *
 * @returns {{text: string, warnings: object[], rootKeyword: string, variableDeclarations: object}}
 */
export function emitGui(layout, options = {}) {
  const warnings = [];
  const { declarations, unused } = collectVariableDeclarations(layout);
  const lines = [];
  // The roots are read AGAIN after `prepareEngineCoordinates` (see below), because that pass lays
  // the tree out and the layout engine's component expansion (`src/lib/components.mjs`) replaces a
  // `kind: 'bar'` node with the five elements it expands to. `topLevelContainers` returns a SHALLOW
  // COPY of a non-synthetic root, so a snapshot taken before the pass would hand `renderElement` the
  // pre-expansion children and the emitted file would carry a `bar` node with `valueText`/`seats`
  // written as unknown fields. The copy is still what `windows` names, so the report is unchanged.
  let roots = topLevelContainers(layout);

  lines.push(
    '#------------------------------------------------------------------------------------',
  );
  lines.push(`# ${options.fileStem ?? layout.name ?? 'custom_gui'}.gui`);
  lines.push(
    options.override
      ? '# Generated by RStellarisGui as a DELIBERATE override of a vanilla .gui file.'
      : '# Generated by RStellarisGui. Standalone file: it does not override any vanilla .gui.',
  );
  lines.push(
    `# Geometry assumes a ${BASE_RESOLUTION.width}x${BASE_RESOLUTION.height} base resolution; the game scales the UI.`,
  );
  if (options.note) for (const noteLine of String(options.note).split('\n')) lines.push(`# ${noteLine}`);
  lines.push(
    '#------------------------------------------------------------------------------------',
  );
  lines.push('');

  // Rule 4: `@variable` lines go before `guiTypes` and cannot traverse element nesting.
  if (declarations.size > 0) {
    lines.push('# Variables must be declared before guiTypes and cannot cross element nesting.');
    for (const [name, value] of declarations) lines.push(`${name} = ${value}`);
    lines.push('');
  }
  for (const name of unused) {
    warnings.push({
      rule: 'unused-variable',
      name,
      severity: 'info',
      message:
        `\`${name}\` is declared but never referenced, so it was not emitted. An unused declaration would have to ` +
        'sit before `guiTypes` to be legal, and dead variables make the file harder to read.',
    });
  }

  lines.push('guiTypes = {');
  const resolvedRects = options.resolvedRects ?? new Map();
  const context = {
    warnings,
    resolvedRects,
    spriteLookup: options.spriteLookup ?? null,
    path: '',
  };
  // THE CONVERSION, in the one place the file is written. After this the tree carries, for every
  // element, the engine literal a `.gui` file needs - and the emitted file is derived from the same
  // canonical geometry the preview draws and the rect table reports. The pass also supplies the
  // resolved rects that `renderSizeLines` needs, so the tree is laid out once.
  prepareEngineCoordinates(layout, {
    baseWidth: BASE_RESOLUTION.width,
    baseHeight: BASE_RESOLUTION.height,
    spriteLookup: context.spriteLookup,
    rectsOut: resolvedRects,
  });
  if (options.resolvedRects && options.resolvedRects.size > 0 && resolvedRects !== options.resolvedRects) {
    for (const [key, value] of options.resolvedRects) resolvedRects.set(key, value);
  }
  // Re-read the roots: the pass above may have EXPANDED a component (a `bar` becomes five
  // elements), and for a non-synthetic root `topLevelContainers` hands back a copy taken before.
  roots = topLevelContainers(layout);
  if (roots.length === 0) {
    warnings.push({
      rule: 'nothing-to-emit',
      severity: 'error',
      message: 'the layout has no root element, so the emitted file would have an empty guiTypes block.',
    });
  }
  for (const rootNode of roots) {
    // The path base must match `computeLayout` exactly, because that is how `resolvedRects` is
    // keyed: for a synthetic root the window's path is `(stem)/<window>`, for a plain layout it
    // is just the root's name.
    lines.push(...renderElement(rootNode, 1, context, layout.root?.syntheticRoot ? String(layout.root.name ?? 'root') : ''));
  }
  lines.push('}');
  lines.push('');

  return {
    text: lines.join('\n'),
    warnings,
    rootKeyword: 'guiTypes',
    windows: roots.map((node) => node.name ?? null),
    variableDeclarations: Object.fromEntries(declarations),
  };
}

/**
 * Resolve a layout to absolute rectangles, keyed by the same path `renderElement` threads.
 *
 * Why the emitter needs this: `maxWidth`/`maxHeight` and `size = { x y }` are integer slots in
 * the engine's parsers, so a `100%%` or `-16` declaration cannot be written verbatim; it has to
 * become the pixel value the layout engine computed. Doing it here (rather than in a caller)
 * means the emitted file and the preview can never disagree about what the size is.
 */
export function computeResolvedRects(layout, options = {}) {
  const base = layout?.baseResolution ?? BASE_RESOLUTION;
  const spriteLookup = options.spriteLookup ?? null;
  const map = new Map();
  try {
    const { boxes } = computeLayout(layout, { baseWidth: base.width, baseHeight: base.height, spriteLookup });
    for (const box of boxes) map.set(box.path, box.rect);
  } catch {
    /* a layout that cannot be laid out simply yields no resolved sizes */
  }
  return map;
}

/**
 * Emit `common/button_effects/<stem>.txt` for the effects a layout references.
 *
 * A button effect is a top-level key whose body carries `potential` / `allow` / `effect`
 * blocks (verified shape from vanilla: common/button_effects/example.txt). `pdx_tooltip` does
 * not work on an `effectbuttonType`, which is why the failure text goes in `custom_tooltip`.
 */
export function emitButtonEffects(layout, options = {}) {
  const effects = layout.effects ?? {};
  if (Object.keys(effects).length === 0) return { text: null, warnings: [], keys: [] };

  const stem = options.fileStem ?? layout.name ?? 'custom_gui';
  const lines = [
    '#------------------------------------------------------------------------------------',
    `# ${stem}_button_effects.txt`,
    '# Generated by RStellarisGui. Standalone file; it does not override any vanilla button effect.',
    '#',
    '# An effectbuttonType.effect names a top-level key in this file. Verified against vanilla',
    '# 4.4.6 common/button_effects/example.txt.',
    '#------------------------------------------------------------------------------------',
    '',
  ];
  const warnings = [];
  const keys = [];

  for (const [key, definition] of Object.entries(effects)) {
    keys.push(key);
    lines.push(`${key} = {`);
    const potential = definition.potential ?? { always: true };
    lines.push(`${TAB}potential = {`);
    for (const line of renderScriptBlock(potential, 2)) lines.push(line);
    lines.push(`${TAB}}`);
    if (definition.allow) {
      lines.push(`${TAB}allow = {`);
      for (const line of renderScriptBlock(definition.allow, 2)) lines.push(line);
      lines.push(`${TAB}}`);
    }
    const effect = definition.effect ?? {};
    lines.push(`${TAB}effect = {`);
    for (const line of renderScriptBlock(effect, 2)) lines.push(line);
    lines.push(`${TAB}}`);
    lines.push('}');
    lines.push('');
  }

  return { text: lines.join('\n'), warnings, keys };
}

/**
 * Render a nested Paradox script value (object/array/scalar) as indented lines.
 * Used for button-effect bodies, where the caller supplies real script.
 */
export function renderScriptBlock(value, depth) {
  const lines = [];
  const pad = TAB.repeat(depth);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object') lines.push(...renderScriptBlock(item, depth));
      else lines.push(`${pad}${formatScriptScalar(item)}`);
    }
    return lines;
  }
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      // Paradox represents repeated blocks as repeated keys.
      for (const entry of item) {
        if (entry && typeof entry === 'object') {
          lines.push(`${pad}${key} = {`);
          lines.push(...renderScriptBlock(entry, depth + 1));
          lines.push(`${pad}}`);
        } else {
          lines.push(`${pad}${key} = ${formatScriptScalar(entry)}`);
        }
      }
      continue;
    }
    if (item && typeof item === 'object') {
      lines.push(`${pad}${key} = {`);
      lines.push(...renderScriptBlock(item, depth + 1));
      lines.push(`${pad}}`);
      continue;
    }
    lines.push(`${pad}${key} = ${formatScriptScalar(item)}`);
  }
  return lines;
}

function formatScriptScalar(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  if (value === null || value === undefined) return 'no';
  if (typeof value === 'number') return String(value);
  const text = String(value);
  if (/^[a-z][a-z0-9_]*$/.test(text)) return text;
  if (/^-?[0-9.]+$/.test(text)) return text;
  return `"${text}"`;
}

/**
 * An option row: a container whose name ends in `option` and which holds the engine-filled
 * `option_button` with `text = "OPTION_TEXT"`.
 *
 * Found anywhere in the tree, not only at the root: an earlier revision only looked at the
 * root's direct children, so an option row declared inside a window was never found and
 * `custom_gui_option` was silently omitted. Verified shape:
 * interface/diplomacy_caravaneer_event_view.gui:11-16.
 */
export function findOptionRows(layout) {
  const rows = [];
  walkLayout(layout?.root, (node, _parent, _depth, path) => {
    if (!/^[a-z0-9_]*option$/i.test(node.name ?? '')) return;
    const children = node.children ?? [];
    if (children.length === 0) return;
    const button = children.find((child) => child.name === 'option_button');
    const hasSentinel = children.some(
      (child) => child.text === 'OPTION_TEXT' || child.buttonText === 'OPTION_TEXT',
    );
    rows.push({ name: node.name, path, hasOptionButton: Boolean(button), hasOptionText: hasSentinel, node });
  });
  return rows;
}

/**
 * Emit the event stub that makes hand-written windows appear.
 *
 * VERIFIED (see docs/sources.md): a `custom_gui` is honoured on an event that declares
 * `diplomatic = yes`, and the value is the `containerWindowType` name. Measured in 4.4.6:
 * 156 `custom_gui` uses, 154 of them inside a block with `diplomatic = yes`; the two
 * exceptions are one commented-out documentation line and one line in test_events.txt. The
 * Stellaris wiki claims the same, but it was last verified for 3.7, so this is the install's
 * count that decides it. A caller can pass `diplomatic: false` to omit the flag, which is
 * emitted as a warning rather than refused, because the engine may still accept it.
 *
 * ONE STUB PER WINDOW. The engine logs "Event <id> has no options" for a `custom_gui` event
 * without an `option` block, so every event here carries at least one. A layout may hold many
 * windows (an imported file always does), and each window gets its own event with its own id,
 * because six windows sharing `${namespace}.1` is a collision, not a feature.
 */
export function emitEventStub(layout, options = {}) {
  const namespace = options.namespace ?? layout.name ?? 'custom';
  const windows = options.windows ?? topLevelContainers(layout).map((node) => node.name ?? 'custom_window');
  const warnings = [];
  const lines = [];

  lines.push('#------------------------------------------------------------------------------------');
  lines.push(`# ${options.fileStem ?? layout.name}_events.txt`);
  lines.push('# Generated by RStellarisGui. Standalone file; it does not override any vanilla event.');
  lines.push('#');
  lines.push('# Instantiation path, verified in 4.4.6: an event with `diplomatic = yes` and');
  lines.push('# `custom_gui = "<containerWindowType name>"` shows the containerWindowType of that name.');
  lines.push('# Without this event the window is never constructed, no matter how correct the .gui file is.');
  lines.push('#');
  lines.push('# Every event carries at least one `option`: the engine logs "Event <id> has no options"');
  lines.push('# otherwise, even for a hidden event that only exists to show a custom_gui window.');
  lines.push('#------------------------------------------------------------------------------------');
  lines.push('');
  lines.push('namespace = ' + namespace);
  lines.push('');

  const optionRows = findOptionRows(layout);
  const emittedIds = [];
  windows.forEach((windowName, index) => {
    const eventId = options.eventId ? (index === 0 ? options.eventId : `${options.eventId}_${index + 1}`) : `${namespace}.${index + 1}`;
    emittedIds.push(eventId);
    const row = optionRows.find((candidate) => candidate.path.includes(`/${windowName}/`) || candidate.path.startsWith(`${windowName}/`));
    const titleKey = options.titleKey ?? `${windowName}_title`;
    const descKey = options.descKey ?? `${windowName}_desc`;
    const optionKeys =
      options.optionKeys ??
      (row?.hasOptionButton
        ? [`${windowName}_option`]
        : optionRows.length > 0
          ? optionRows.map((candidate) => `${candidate.name}_action`)
          : [`${windowName}_option`]);

    lines.push(`# ${windowName}: fire with \`country_event = { id = ${eventId} days = 1 }\`.`);
    lines.push('country_event = {');
    lines.push(`${TAB}id = ${eventId}`);
    lines.push(`${TAB}title = ${titleKey}`);
    lines.push(`${TAB}desc = ${descKey}`);
    lines.push(`${TAB}picture = GFX_evt_unknown`);
    lines.push(`${TAB}hidden = yes`);
    if (options.diplomatic !== false) lines.push(`${TAB}diplomatic = yes`);
    lines.push(`${TAB}is_triggered_only = yes`);
    lines.push(`${TAB}fire_only_once = no`);
    lines.push(`${TAB}custom_gui = "${windowName}"`);
    if (row?.hasOptionButton) lines.push(`${TAB}custom_gui_option = "${row.name}"`);
    lines.push('');
    lines.push(`${TAB}immediate = {`);
    lines.push(`${TAB}${TAB}# your scripted effects here`);
    lines.push(`${TAB}}`);
    lines.push('');
    optionKeys.forEach((key, optionIndex) => {
      lines.push(`${TAB}option = {`);
      lines.push(`${TAB}${TAB}name = ${key}`);
      lines.push(`${TAB}${TAB}trigger = { always = yes }`);
      lines.push(`${TAB}}`);
      if (optionIndex < optionKeys.length - 1) lines.push('');
    });
    lines.push('}');
    lines.push('');
  });

  if (options.diplomatic === false) {
    warnings.push({
      rule: 'custom-gui-without-diplomatic',
      severity: 'warning',
      message:
        'diplomatic = yes was omitted. Over the install\'s events/*.txt, NO event that names a custom_gui omits ' +
        'it, so this departs from the convention - and from the window CLASS the engine picks: measured in game ' +
        'on 2026-10-06, the field is accepted without it and a NON-diplomatic event window is built instead (the ' +
        'engine reports "Event <id> has no pictures" for exactly those events). Keep diplomatic = yes unless the ' +
        'different class is what you want.',
    });
  }
  return { text: lines.join('\n'), warnings, windowName: windows[0] ?? null, windows, eventIds: emittedIds };
}

/**
 * Emit a localisation stub.
 *
 * UTF-8 WITH BOM, `l_<language>:` header, `key:0 "value"` lines. The BOM matters: a
 * localisation file without it is ignored by the engine, which is why this writes raw bytes
 * rather than going through a text writer.
 */
export function emitLocalisation(layout, options = {}) {
  const language = options.language ?? 'english';
  const prefix = layout.name ?? 'custom';
  const entries = [];

  const addEntry = (key, value) => {
    if (!key || entries.some((entry) => entry.key === key)) return;
    entries.push({ key, value });
  };

  const walk = (node) => {
    for (const field of LOC_FIELDS) {
      const value = node[field];
      if (typeof value !== 'string' || value === '') continue;
      if (field === 'text' && value === 'OPTION_TEXT') continue; // engine sentinel, not a key
      addEntry(value, options.describe ? options.describe(value) : localisationValueFor(value, layout));
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of topLevelContainers(layout)) walk(node);

  for (const entry of options.extraEntries ?? []) addEntry(entry.key, entry.value);
  if (options.includeEventKeys !== false) {
    for (const windowName of options.windows ?? topLevelContainers(layout).map((node) => node.name ?? prefix)) {
      addEntry(`${windowName}_title`, `${titleFromName(windowName)}`);
      addEntry(`${windowName}_desc`, `${titleFromName(windowName)} description. Replace this text.`);
    }
    addEntry(`${prefix}_title`, `${titleFromName(prefix)}`);
    addEntry(`${prefix}_desc`, `${titleFromName(prefix)} description. Replace this text.`);
  }

  const stem = options.fileStem ?? `${prefix}_l_${language}`;
  const lines = [`l_${language}:`, ...entries.map((entry) => ` ${entry.key}:0 "${escapeLocValue(entry.value)}"`), ''];
  return { text: lines.join('\n'), entries, language, fileStem: stem };
}

function localisationValueFor(key, layout) {
  if (key === `${layout.name}_title`) return titleFromName(layout.name);
  if (key === `${layout.name}_desc`) return `${titleFromName(layout.name)} description. Replace this text.`;
  return titleFromName(key);
}

function titleFromName(name) {
  const text = String(name).replace(/^[a-z0-9]+_/, '').replace(/_/g, ' ').trim();
  if (text === '') return String(name);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeLocValue(value) {
  return String(value).replace(/"/g, "'").replace(/\r?\n/g, '\\n');
}

/**
 * The full emit plan for ONE OR MANY layouts. Pure: it computes every file's content and path
 * but writes nothing, so a caller can inspect a plan before committing to it (`dry_run`).
 *
 * Several layouts become ONE `.gui` file whose top-level containers are the layouts' windows -
 * which is what a multi-window mod needs, because the design is inherently several
 * `containerWindowType`s under one `guiTypes` root. Each layout used to be merged by hand,
 * including its `@variable` declarations.
 *
 * @returns {{files: object[], warnings: object[], outputRoot: string|null}}
 */
export function planEmit(layoutOrLayouts, options = {}) {
  const layouts = Array.isArray(layoutOrLayouts) ? layoutOrLayouts : [layoutOrLayouts];
  const warnings = [];
  const files = [];
  const primary = layouts[0];
  const stem = options.fileStem ?? sanitiseStem(options.name ?? mergedName(layouts));
  const language = options.language ?? 'english';
  const windows = layouts.flatMap((layout) => topLevelContainers(layout).map((node) => node.name).filter(Boolean));

  // The merged tree: every layout's windows as children of one synthetic root, so a single
  // `renderElement` pass can write them and the union of the `@variable` declarations is
  // hoisted exactly once.
  const merged = {
    ...primary,
    name: stem,
    variables: Object.assign({}, ...layouts.map((layout) => layout.variables ?? {})),
    root: {
      id: 'root',
      kind: 'container',
      syntheticRoot: true,
      name: `(${stem})`,
      children: layouts.flatMap((layout) => topLevelContainers(layout)),
    },
    effects: Object.assign({}, ...layouts.map((layout) => layout.effects ?? {})),
  };

  const gui = emitGui(merged, { ...options, fileStem: stem, note: options.note });
  warnings.push(...(gui.warnings ?? []).map((warning) => ({ ...warning, file: `${stem}.gui` })));
  files.push({
    kind: 'gui',
    path: `interface/${stem}.gui`,
    content: gui.text,
    encoding: 'utf8',
    bom: false,
    bytes: Buffer.byteLength(gui.text, 'utf8'),
    windows: gui.windows,
  });

  const effects = emitButtonEffects(merged, { ...options, fileStem: stem });
  if (effects.text) {
    files.push({
      kind: 'button_effects',
      path: `common/button_effects/${stem}_button_effects.txt`,
      content: effects.text,
      encoding: 'utf8',
      bom: false,
      bytes: Buffer.byteLength(effects.text, 'utf8'),
      keys: effects.keys,
    });
  }

  const wantsEvent = options.includeEvent !== false;
  if (wantsEvent) {
    const event = emitEventStub(merged, { ...options, fileStem: stem, windows });
    warnings.push(...(event.warnings ?? []).map((warning) => ({ ...warning, file: `${stem}_events.txt` })));
    files.push({
      kind: 'event',
      path: `events/${stem}_events.txt`,
      content: event.text,
      encoding: 'utf8',
      bom: false,
      bytes: Buffer.byteLength(event.text, 'utf8'),
      eventIds: event.eventIds,
    });
  }

  if (options.includeLocalisation !== false) {
    const loc = emitLocalisation(merged, { ...options, language, windows, fileStem: `${stem}_l_${language}` });
    files.push({
      kind: 'localisation',
      path: `localisation/${language}/${stem}_l_${language}.yml`,
      content: loc.text,
      encoding: 'utf8',
      bom: true,
      bytes: Buffer.byteLength(loc.text, 'utf8') + 3,
      entries: loc.entries.length,
    });
  }

  // ---------------------------------------------------------------- the pre-write contract gate
  //
  // The emitter writes what it is given, and the engine's window contract is about what is MISSING
  // from the tree - which no amount of correct emission can supply. So the contract is checked
  // HERE, against the tree that is about to be written, and its ERRORS are reported on the plan.
  // A caller that writes anyway gets the finding in the same result as the file list, which is the
  // last moment at which the mistake is still cheap.
  let contract = null;
  if (options.checkContract !== false) {
    try {
      const { boxes } = computeLayout(merged, {});
      const contractFindings = [
        ...analyseEventWindows(merged, boxes, {
          customGuiWindows: options.customGuiWindows ?? [],
          baseResolution: merged.baseResolution,
        }).flatMap((entry) => entry.findings),
        ...checkParkedElements(merged, boxes, { baseResolution: merged.baseResolution }),
      ];
      const errors = contractFindings.filter((finding) => finding.severity === 'error');
      contract = {
        ok: errors.length === 0,
        errorCount: errors.length,
        warningCount: contractFindings.filter((finding) => finding.severity === 'warning').length,
        byRule: contractFindings.reduce((acc, finding) => ({ ...acc, [finding.rule]: (acc[finding.rule] ?? 0) + 1 }), {}),
        errors,
        // A warning is not a blocker: the shipped trial mod has 12 parked controls with shortcuts.
        warnings: contractFindings.filter((finding) => finding.severity === 'warning'),
      };
      if (!contract.ok) {
        warnings.push({
          rule: 'custom-gui-contract-blocking',
          severity: 'error',
          message:
            `the layout about to be written violates the custom_gui window contract in ${errors.length} place(s): ` +
            `${errors.map((finding) => finding.rule).join(', ')}. The engine dereferences the element names it looks up ` +
            'by name, so this file can crash the game on open. See docs/gui-pitfalls.md.',
        });
      }
    } catch {
      // A tree that cannot be laid out is the validator's problem to report, not the gate's to crash on.
      contract = null;
    }
  }

  return { files, warnings, contract, outputRoot: options.outputRoot ?? null, fileStem: stem, windows };
}

function mergedName(layouts) {
  const names = layouts.map((layout) => layout.name).filter(Boolean);
  if (names.length === 1) return names[0];
  if (names.length === 0) return 'custom_gui';
  return sanitiseStem(names[0]).replace(/_main$/, '');
}

function sanitiseStem(name) {
  const stem = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return stem === '' ? 'custom_gui' : stem;
}

/**
 * Write an emit plan to disk.
 *
 * Encoding rule 3 lives here: script files are written as UTF-8 with no BOM, localisation as
 * UTF-8 with a BOM prepended.
 *
 * `options.subdirectory` (used by the handoff channel, which keeps a submission's emitted copy
 * beside its `layout.json`) is confined under the same root by `safeJoin`, so it cannot be used to
 * escape it.
 */
export function writePlan(plan, outputRoot, options = {}) {
  const root = options.override ? assertOverrideRoot(outputRoot) : assertOutputRoot(outputRoot);
  const subdirectory = typeof options.subdirectory === 'string' && options.subdirectory.trim() !== '' ? options.subdirectory.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : null;
  const written = [];
  for (const file of plan.files) {
    const relative = subdirectory ? `${subdirectory}/${file.path}` : file.path;
    const target = safeJoin(root, relative);
    // `safeJoin` has already rejected anything that escapes the root; this creates the parent
    // directory inside it.
    ensureDir(dirname(target));
    const body = file.bom
      ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(file.content, 'utf8')])
      : Buffer.from(file.content, 'utf8');
    writeFileSync(target, body);
    written.push({
      kind: file.kind,
      path: relative,
      planPath: file.path,
      absolutePath: target,
      bytes: body.length,
      bom: Boolean(file.bom),
      encoding: 'utf8',
    });
  }
  return { outputRoot: root, subdirectory, files: written, warnings: plan.warnings, dryRun: false, ...(options.extra ?? {}) };
}

/**
 * Convenience: plan and optionally write.
 * `dryRun` defaults to true, so a caller has to opt in to writing.
 *
 * `applyTo` is REFUSED here on purpose. Patching an existing file is a different operation
 * from writing new files - it needs the tree the file was imported as, and it writes into a
 * mod rather than into an output root - so it lives in `applyToFile`, which takes the
 * baseline as an argument. Silently ignoring `apply_to` and writing a normalised copy
 * somewhere would be the exact failure this project refuses to have.
 */
export function emitFiles(layoutOrLayouts, options = {}) {
  if (options.applyTo) {
    throw new Error(
      'emitFiles does not patch existing files. Use applyToFile(applyTo, baselineLayout, editedLayout) ' +
        '(the `gui_emit_files { apply_to }` path), which needs the layout as it was IMPORTED so it can diff against it.',
    );
  }
  const plan = planEmit(layoutOrLayouts, options);
  if (options.dryRun !== false) {
    return {
      dryRun: true,
      wouldWriteTo: options.outputRoot ?? null,
      plan: plan.files.map(summariseFile),
      warnings: plan.warnings,
      contract: plan.contract,
      windows: plan.windows,
    };
  }
  const result = writePlan(plan, options.outputRoot, {
    ...(options.emitSubdirectory ? { subdirectory: options.emitSubdirectory } : {}),
  });
  return {
    dryRun: false,
    outputRoot: result.outputRoot,
    ...(result.subdirectory ? { subdirectory: result.subdirectory } : {}),
    files: result.files,
    warnings: result.warnings,
    contract: plan.contract,
    windows: plan.windows,
    note: `All files were written under ${result.outputRoot}. Nothing was written outside it, and no vanilla file was overridden.`,
  };
}

function summariseFile(file) {
  return {
    kind: file.kind,
    path: file.path,
    bytes: file.bytes,
    encoding: file.encoding,
    bom: file.bom,
    ...(file.keys ? { keys: file.keys } : {}),
    ...(file.entries !== undefined ? { entries: file.entries } : {}),
    ...(file.windows ? { windows: file.windows } : {}),
  };
}

// ---------------------------------------------------------------------------------------
// Vanilla overrides (the one deliberate door)
// ---------------------------------------------------------------------------------------

// `apply.mjs` owns the "edited tree back into the file it came from" path, and it needs THIS
// module's `renderElement`/`prepareEngineCoordinates` so an applied block is an emitted block
// rather than a second renderer. Importing them from there would be a cycle, so the emitter
// hands them over once, here, at module load.
bindEmit({ renderElement, prepareEngineCoordinates });

/**
 * THE APPLY PATH, exported from the emitter so `gui_emit_files { apply_to }` has one entry
 * point. `applyToFile` diffs the edited tree against the imported baseline and splices only
 * the added/changed/removed elements into the ORIGINAL bytes; see apply.mjs for the rules.
 */
export { applyToFile, describeFile };

/** sha256 of a file's bytes, plus its size and line count. */
export function hashFile(path) {
  const buffer = readFileSync(path);
  return {
    path,
    name: basename(path),
    sha256: createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.length,
    hasBom: buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf,
    lines: buffer.toString('utf8').split(/\r?\n/).length,
  };
}

/**
 * Plan a deliberate override of a vanilla `.gui` file: the vanilla file, plus the elements you
 * want to add to it.
 *
 * This is the ONLY way to put a button on the planet panel, and before this existed the job was
 * done by hand outside the tool - no validation, no preview, no way to notice that the vanilla
 * file had changed under you. So the plan always records the vanilla source's sha256, which the
 * caller can hand back on a later run as `expectedSourceHash` to prove the base has not moved.
 *
 * @param {string} vanillaPath absolute path of the vanilla file to override
 * @param {object[]} additions `{container?: string, element: object}` - `element` is a layout
 *   node (same schema as everywhere else); `container` names the existing container to append
 *   it to. Without `container` the element is appended after the last top-level container.
 * @param {{layout?: object, spriteLookup?: object, note?: string}} options
 * @returns {{vanilla: object, targetPath: string, content: string, additions: object[], warnings: object[]}}
 */
/**
 * Expand one override addition into the elements that will actually be written.
 *
 * A `kind: 'bar'` or `kind: 'matrix'` node is a MODEL construct: `computeLayout` replaces it with
 * the containers and text it stands for (`src/lib/components.mjs`), and there is no `matrix` or
 * `bar` window keyword in the engine. Rendering one directly wrote `matrix = { ... }` into the file
 * - a block no parser accepts, silently, because the override path never ran the layout pass.
 *
 * The expansion runs on a one-element synthetic layout, so it is the same pass, with the same
 * coordinates and the same component findings, that `emitGui` runs for a standalone file. Every
 * element the addition expands to is spliced into the SAME container, in order.
 */
function expandAdditionElements(element, options = {}) {
  const spec = kindSpec(element.kind ?? element.type);
  if (!spec?.component) return [element];
  const wrapper = {
    schema: 'rstellarisgui/layout@1',
    name: element.name ?? 'override_addition',
    baseResolution: { ...BASE_RESOLUTION },
    variables: {},
    root: { id: 'override_addition_root', kind: 'container', syntheticRoot: true, children: [element] },
  };
  const warnings = options.warnings ?? [];
  // `prepareEngineCoordinates` runs the component pass inside `computeLayout`, and then the same
  // pass again from `topLevelContainers`, which is what makes the emitted children the expanded
  // ones rather than the component node. Both are needed; this mirrors `emitGui`.
  prepareEngineCoordinates(wrapper, { ...options, warnings });
  // `topLevelContainers` returns the synthetic root's CHILDREN (that is how several elements become
  // siblings under one `guiTypes`), so the top-level elements ARE the result - walking one level
  // further would splice a matrix's CELLS into the host and drop its frame, which would place every
  // cell at the host's own origin.
  const expanded = topLevelContainers(wrapper);
  if (expanded.length === 0) {
    warnings.push({
      rule: 'field-dropped',
      severity: 'warning',
      name: element.name ?? null,
      path: element.name ?? 'override_addition',
      message:
        `the \`${spec.kind}\` addition expanded to NOTHING, so the override would have written no element for it. ` +
        'The component rules above say why (a dimension that is not a static pixel, a cell outside the grid, ...).',
      suggestedFix: 'fix the component findings, or add a plain element instead.',
    });
  }
  return expanded;
}

/**
 * Build an override: the vanilla source's own bytes plus the elements you add to it.
 *
 * @param {string} vanillaPath
 * @param {{element?: object, node?: object, container?: string, indent?: string}[]} additions
 * @param {object} [options]
 */
export function planOverride(vanillaPath, additions, options = {}) {
  if (typeof vanillaPath !== 'string' || vanillaPath.trim() === '') {
    throw new Error('an absolute path to the vanilla file being overridden is required');
  }
  if (!isAbsolute(vanillaPath)) throw new Error(`the vanilla source path must be absolute, got \`${vanillaPath}\``);
  if (!existsSync(vanillaPath)) throw new Error(`no such vanilla file: ${vanillaPath}`);
  if (!Array.isArray(additions) || additions.length === 0) {
    throw new Error('an override needs at least one addition; there is no reason to override a file byte-for-byte');
  }

  const vanilla = hashFile(vanillaPath);
  if (vanilla.hasBom) {
    throw new Error(
      `${vanillaPath} starts with a UTF-8 BOM. A vanilla .gui must not have one, so this file is not the vanilla file ` +
        'it claims to be (or something rewrote it). Refusing to build an override on it.',
    );
  }
  const text = readFileSync(vanillaPath, 'utf8');
  const syntax = checkGuiSyntax(text, vanillaPath);
  if (!syntax.ok) {
    throw new Error(
      `refusing to override ${vanillaPath}: it does not pass the engine syntax check (${syntax.findings
        .filter((finding) => finding.severity === 'error')
        .map((finding) => `${finding.rule} at line ${finding.line}`)
        .join(', ')}).`,
    );
  }

  const warnings = [];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const layout = options.layout ?? null;
  const resolvedRects = layout ? computeResolvedRects(layout, options) : new Map();
  const context = { warnings, resolvedRects, spriteLookup: options.spriteLookup ?? null, path: '' };

  let working = text;
  const applied = [];
  for (const addition of additions) {
    const element = addition.element ?? addition.node;
    if (!element) throw new Error('each addition needs an `element` (a layout node)');
    // A COMPONENT IS EXPANDED BEFORE IT IS WRITTEN. `kind: 'bar'` and `kind: 'matrix'` are model
    // constructs with no engine keyword - `computeLayout` replaces them with the elements they
    // stand for (src/lib/components.mjs). Rendering one directly wrote `matrix = { ... }` into the
    // file, which no engine parser accepts: the addition was a block the game would reject, and
    // nothing in the override path said so. The expansion is run on a one-element synthetic layout
    // so it is the SAME pass `emitGui` uses, at the same coordinates.
    const expanded = expandAdditionElements(element, { ...options, container: addition.container });
    for (const one of expanded) {
      const block = renderElement(one, 0, context, '')
        .map((line) => line.replace(/^/, ''))
        .join(eol);
      const indent = addition.indent ?? '\t\t';
      const indented = block
        .split(eol)
        .map((line) => `${indent}${line}`)
        .join(eol);
      if (addition.container) {
        const spliced = insertIntoContainer(working, addition.container, indented, eol);
        if (spliced === null) {
          throw new Error(`override: container \`${addition.container}\` was not found in ${vanillaPath}`);
        }
        working = spliced;
      } else {
        const close = working.lastIndexOf('}');
        if (close === -1) throw new Error(`override: no guiTypes root in ${vanillaPath}`);
        working = `${working.slice(0, close)}${eol}${indented}${eol}${working.slice(close)}`;
      }
      applied.push({ entity: one.name ?? one.kind, container: addition.container ?? null });
    }
  }

  const header = [
    '#------------------------------------------------------------------------------------',
    `# OVERRIDE of ${vanilla.name} (${vanilla.bytes} bytes, ${vanilla.lines} lines)`,
    `# vanilla source sha256: ${vanilla.sha256}`,
    '#',
    '# This file was produced by RStellarisGui gui_emit_override on purpose. A full-file override',
    '# replaces the vanilla file for every mod in the load order, so if the game version changes,',
    '# re-run with `expected_source_hash` set to the hash above: the call refuses when the vanilla',
    '# file no longer matches, which is the only signal that this copy is now stale.',
    '#',
    `# Added: ${applied.map((entry) => `${entry.entity}${entry.container ? ` -> ${entry.container}` : ' (top level)'}`).join(', ')}`,
    '#------------------------------------------------------------------------------------',
  ].join(eol);

  const content = `${header}${eol}${working}`;
  const post = checkGuiSyntax(content, `${vanilla.name} (override)`);
  for (const finding of post.findings.filter((item) => item.severity === 'error')) {
    warnings.push({ ...finding, rule: `override-${finding.rule}`, severity: 'error' });
  }

  return {
    vanilla: { path: vanillaPath, name: vanilla.name, sha256: vanilla.sha256, bytes: vanilla.bytes, lines: vanilla.lines },
    targetPath: `interface/${vanilla.name}`,
    content,
    additions: applied,
    warnings,
    syntaxOk: post.ok,
    bytes: Buffer.byteLength(content, 'utf8'),
  };
}

/** Insert an already-rendered, already-indented element block as the last child of a container. */
function insertIntoContainer(text, containerName, block, eol) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => line.trim() === `name = "${containerName}"`);
  if (at === -1) return null;
  let start = at;
  while (start > 0 && !/=\s*\{\s*$/.test(lines[start])) start -= 1;
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
  return [...lines.slice(0, end), ...block.split(eol), ...lines.slice(end)].join(eol);
}

/**
 * Write an override plan. Refuses without the explicit confirmation, refuses when the vanilla
 * base has changed under a recorded hash, and writes only inside the caller's output root.
 */
export function writeOverride(plan, outputRoot, options = {}) {
  if (options.confirm !== true) {
    throw new Error(
      'refusing to write a vanilla override without `i_understand_this_overrides_vanilla_file: true`. ' +
        'A full-file override replaces the vanilla file for every mod in the load order, and it goes stale ' +
        'whenever the game updates.',
    );
  }
  if (options.expectedSourceHash && options.expectedSourceHash !== plan.vanilla.sha256) {
    throw new Error(
      `the vanilla source has changed: ${plan.vanilla.path} is now sha256 ${plan.vanilla.sha256}, but the recorded ` +
        `hash was ${options.expectedSourceHash}. Re-check your additions against the new vanilla file before rebuilding ` +
        'the override: a stale copy silently drops whatever the update added.',
    );
  }
  const root = assertOverrideRoot(outputRoot);
  const target = safeJoin(root, plan.targetPath);
  ensureDir(dirname(target));
  const body = Buffer.from(plan.content, 'utf8');
  writeFileSync(target, body);
  return {
    outputRoot: root,
    path: plan.targetPath,
    absolutePath: target,
    bytes: body.length,
    bom: false,
    vanilla: plan.vanilla,
    additions: plan.additions,
    warnings: plan.warnings,
    note:
      `Wrote ${plan.targetPath}, a deliberate override of ${plan.vanilla.name} ` +
      `(vanilla sha256 ${plan.vanilla.sha256.slice(0, 12)}...). A copy of the vanilla file was NOT modified.`,
  };
}

/** Convenience: plan and optionally write an override. `dryRun` defaults to true. */
export function emitOverride(vanillaPath, additions, options = {}) {
  const plan = planOverride(vanillaPath, additions, options);
  if (options.dryRun !== false) {
    return {
      dryRun: true,
      wouldWriteTo: options.outputRoot ? safeJoin(assertOverrideRoot(options.outputRoot), plan.targetPath) : null,
      targetPath: plan.targetPath,
      vanilla: plan.vanilla,
      additions: plan.additions,
      bytes: plan.bytes,
      syntaxOk: plan.syntaxOk,
      warnings: plan.warnings,
      preview: plan.content.split(/\r?\n/).slice(0, 20),
    };
  }
  return writeOverride(plan, options.outputRoot, options);
}

/**
 * Read a file back and confirm its encoding against the rules for its extension.
 *
 * This is the B7 inspector: it runs on files the tool did not write, which is where an
 * encoding mistake actually hurts. `.yml` must have a BOM (without it the engine ignores the
 * file); `.gui` and `.txt` must not.
 */
export function inspectEncoding(path, options = {}) {
  const buffer = readFileSync(path);
  const hasBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const body = hasBom ? buffer.slice(3) : buffer;
  const text = body.toString('utf8');
  const replacementCharacters = (text.match(/\uFFFD/g) ?? []).length;
  const extension = String(path).toLowerCase().replace(/^.*(\.[a-z0-9]+)$/, '$1');
  const expectsBom = options.expectsBom ?? (extension === '.yml' || extension === '.yaml');
  const issues = [];
  if (expectsBom && !hasBom) {
    issues.push({
      rule: 'encoding-bom-missing',
      severity: 'error',
      message:
        'a localisation .yml without a UTF-8 BOM is ignored by the engine: the file exists, the keys are correct and ' +
        'nothing shows up in game.',
    });
  }
  if (!expectsBom && hasBom) {
    issues.push({
      rule: 'encoding-bom-unexpected',
      severity: 'error',
      message: `a ${extension} script file must be UTF-8 WITHOUT a BOM; the engine reads the BOM as part of the first token.`,
    });
  }
  if (replacementCharacters > 0) {
    issues.push({
      rule: 'encoding-invalid-utf8',
      severity: 'error',
      message: `${replacementCharacters} byte sequence(s) are not valid UTF-8.`,
    });
  }
  const rootKeyword = options.rootKeyword === false ? null : firstConstructOf(text);
  return {
    path,
    extension,
    hasBom,
    bytes: buffer.length,
    firstBytes: [...buffer.slice(0, 4)],
    crlf: text.includes('\r\n'),
    replacementCharacters,
    expectsBom,
    rootKeyword,
    issues,
    text,
  };
}

function firstConstructOf(text) {
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '' || line.startsWith('@')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    return match ? match[1] : `(unparsed: ${line.slice(0, 40)})`;
  }
  return '(empty)';
}

export { formatScalar as formatField, sanitiseStem, renderPair };
