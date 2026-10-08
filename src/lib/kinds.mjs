//------------------------------------------------------------------------------------
// kinds.mjs -- Part of RStellarisGui
//
// The table-driven element-kind registry. This one table drives the parser, the layout
// engine, the validator and the emitter, so adding a kind means adding a row here and
// flipping `emitter: true` - not touching four modules.
//
// THE SIZE FIELD IS PER-KIND, AND GETTING IT WRONG IS A PARSE ERROR
//
// An earlier revision wrote `size = { width = ... height = ... }` for every kind. That is
// wrong for most of them, and the engine says so out loud. Running the trial's emitted file
// in Stellaris 4.4.6 produced, in Documents/Paradox Interactive/Stellaris/logs/error.log:
//
//   [persistent.cpp:41]: Error: "Unexpected token: size, near line: 56" in file:
//     "interface/zz_geocentric_unga.gui" near line: 59
//   [persistent.cpp:41]: Error: "Malformed token: width, near line: 96 / Malformed token:
//     height, near line: 97" in file: "interface/zz_geocentric_unga.gui" near line: 98
//   [instanttextboxtype.cpp:138]: Not used, use maxWidth and maxHeight
//     file: interface/zz_geocentric_unga.gui line: 95
//
// So `sizeField` below is not cosmetic. It is measured, per kind, across all 177 vanilla
// `.gui` files of the verified 4.4.6 install:
//
//   kind                        uses   size = { width height }   size = { x y }   size
//   containerWindowType         3305   2903 (+8 width-only)     0                0
//   gridBoxType                  260    156                     0                0
//   dropDownBoxType               13     13                     0                0
//   extendedScrollbarType          5      5                     0                0
//   instantTextBoxType          3218      0                     0        3218 (maxWidth/maxHeight)
//   iconType                    2779      0                     0        2779
//   checkboxType                  77      0                     0          77
//   buttonType                  2067      0                   450         1617
//   effectbuttonType               2      0                     2            0
//   guiButtonType                198      0                     5          193
//   scrollbarType                 18      0                    18            0
//   listBoxType                   43      0                    43            0
//   smoothListBoxType            243      0                   242            0
//   OverlappingElementsBoxType   188      0                   188            0
//   spinnerType                   40      0                    40            0
//   editBoxType                   85      0                    85            0
//   windowType                    24      0                    23            0
//
// Every number in this file is checked against a fresh census of the install by
// scripts/selftest.mjs (`kinds.mjs agrees with the install census`), and the README and
// docs/sources.md number tables are generated from the same census by
// `node scripts/generate-docs.mjs`. Nothing here is typed twice.
//
// `maxWidth`/`maxHeight` are the text element's size: 3138 of 3202 `instantTextBoxType`
// blocks carry `maxWidth` and 2890 carry `maxHeight`, and NOT ONE carries `size`. They take a
// plain integer or an `@variable` (221 `size.width = 100%` forms exist, but 0 in maxWidth), so
// the emitter resolves any percentage/negative form into an absolute pixel value before
// writing it - see emit.mjs.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

/** Scalar field descriptors, shared between the validator and the emitter. */
export const FIELD_TYPES = {
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  string: 'string',
  enum: 'enum',
  sprite: 'sprite',
  font: 'font',
  locKey: 'locKey',
  sound: 'sound',
  position: 'position',
  size: 'size',
};

/**
 * The four legal ways an element can express its own size in vanilla 4.4.6.
 *
 * - `size-width-height`  `size = { width = .. height = .. }` (containers, grid boxes)
 * - `size-x-y`           `size = { x = .. y = .. }` where x is the WIDTH (buttons, lists)
 * - `maxWidth/maxHeight` text: the `size` keyword is rejected outright by the engine
 * - `none`               the element draws at its sprite's natural size; `size` is not accepted
 */
export const SIZE_FORMS = {
  widthHeight: 'size-width-height',
  xY: 'size-x-y',
  maxWidthHeight: 'maxWidth/maxHeight',
  none: 'none',
};

/**
 * Nine-point anchor names. Vanilla writes these in mixed case and with several misspellings
 * (`LOWER_LEfT` appears twice, `CENTERUP` once, `TOP`/`LEFT`/`RIGHT` are used as synonyms),
 * so every spelling maps onto one of nine canonical anchors.
 */
export const ANCHORS = {
  upperleft: { x: 0, y: 0, label: 'upper_left' },
  topleft: { x: 0, y: 0, label: 'upper_left' },
  leftup: { x: 0, y: 0, label: 'upper_left' },
  top: { x: 0.5, y: 0, label: 'center_up' },
  uppercenter: { x: 0.5, y: 0, label: 'center_up' },
  centerup: { x: 0.5, y: 0, label: 'center_up' },
  upperright: { x: 1, y: 0, label: 'upper_right' },
  topright: { x: 1, y: 0, label: 'upper_right' },
  rightup: { x: 1, y: 0, label: 'upper_right' },
  leftcenter: { x: 0, y: 0.5, label: 'center_left' },
  centerleft: { x: 0, y: 0.5, label: 'center_left' },
  left: { x: 0, y: 0.5, label: 'center_left' },
  center: { x: 0.5, y: 0.5, label: 'center' },
  centre: { x: 0.5, y: 0.5, label: 'center' },
  centercenter: { x: 0.5, y: 0.5, label: 'center' },
  middle: { x: 0.5, y: 0.5, label: 'center' },
  rightcenter: { x: 1, y: 0.5, label: 'center_right' },
  centerright: { x: 1, y: 0.5, label: 'center_right' },
  right: { x: 1, y: 0.5, label: 'center_right' },
  lowerleft: { x: 0, y: 1, label: 'lower_left' },
  bottomleft: { x: 0, y: 1, label: 'lower_left' },
  leftdown: { x: 0, y: 1, label: 'lower_left' },
  centerdown: { x: 0.5, y: 1, label: 'center_down' },
  bottom: { x: 0.5, y: 1, label: 'center_down' },
  lowercenter: { x: 0.5, y: 1, label: 'center_down' },
  lowerright: { x: 1, y: 1, label: 'lower_right' },
  bottomright: { x: 1, y: 1, label: 'lower_right' },
  rightdown: { x: 1, y: 1, label: 'lower_right' },
};

/** Canonical orientation values the emitter will write. */
export const ORIENTATION_VALUES = [
  'upper_left',
  'center_up',
  'upper_right',
  'center_left',
  'center',
  'center_right',
  'lower_left',
  'center_down',
  'lower_right',
];

/** Canonical origo values. `origo` uses a slightly smaller documented set than `orientation`. */
export const ORIGO_VALUES = [
  'upper_left',
  'center_up',
  'upper_right',
  'center_left',
  'center',
  'center_right',
  'lower_left',
  'center_down',
  'lower_right',
];

/** Normalise an anchor spelling to a canonical name, or return null. */
export function normaliseAnchor(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/[\s_-]/g, '');
  const anchor = ANCHORS[key];
  return anchor ? anchor.label : null;
}

/**
 * Fields that are NOT per-kind: position, size, orientation and the input/sound flags, which
 * every element shares. Everything whose legality the engine's parsers decide per kind - the
 * tooltip family, `alwaysTransparent`, `origo` - lives in the per-kind lists below, because the
 * engine answers "Unexpected token: <field>" when one lands on the wrong kind.
 */
const COMMON_LAYOUT_FIELDS = {
  position: FIELD_TYPES.position,
  size: FIELD_TYPES.size,
  orientation: FIELD_TYPES.enum,
  moveable: FIELD_TYPES.boolean,
  clipping: FIELD_TYPES.boolean,
  scale: FIELD_TYPES.number,
  rotation: FIELD_TYPES.number,
  centerPosition: FIELD_TYPES.boolean,
  shortcut: FIELD_TYPES.string,
  clicksound: FIELD_TYPES.sound,
  oversound: FIELD_TYPES.sound,
  show_sound: FIELD_TYPES.sound,
  no_clicksound: FIELD_TYPES.boolean,
  tooltip_mode_enabled: FIELD_TYPES.boolean,
};

/**
 * THE TOOLTIP FAMILY, PER KIND. Measured over the install's 177 `.gui` files; the numbers are
 * uses of each field on each kind, and `custom_tooltip` appears in NONE of them:
 *
 *   kind                  pdx_tooltip  tooltip  tooltipText  delayedTooltipText  anchor offset/orientation
 *   buttonType                   412        9            9                   9                9 / 9
 *   instantTextBoxType            74       48            -                   -                -
 *   iconType                      50       11            -                   -                -
 *   guiButtonType                  5       23           23                  23                -
 *   checkboxType                  18        -            -                   -                -
 *   containerWindowType            1        -            -                   -                -
 *   effectbuttonType               -        -            2                   2                -
 *
 * `custom_tooltip` is a SCRIPT field: 3777 uses inside `events/`, and 0 on any element of any
 * `.gui` file. The engine says so out loud when one is emitted on an effectbuttonType:
 *   Error: "Unexpected token: custom_tooltip, near line: 171" in
 *   interface/zz_geocentric_unga.gui
 * `fail_text` is script-only for the same reason (158 uses, all inside an event's
 * `custom_tooltip = { ... }` block).
 */
const TOOLTIP_FIELDS = {
  button: {
    pdx_tooltip: FIELD_TYPES.locKey,
    pdx_tooltip_delayed: FIELD_TYPES.locKey,
    tooltip: FIELD_TYPES.locKey,
    tooltipText: FIELD_TYPES.locKey,
    delayedTooltipText: FIELD_TYPES.locKey,
    pdx_tooltip_anchor_offset: FIELD_TYPES.position,
    pdx_tooltip_anchor_orientation: FIELD_TYPES.enum,
  },
  text: {
    pdx_tooltip: FIELD_TYPES.locKey,
    pdx_tooltip_delayed: FIELD_TYPES.locKey,
    tooltip: FIELD_TYPES.locKey,
  },
  icon: {
    pdx_tooltip: FIELD_TYPES.locKey,
    pdx_tooltip_delayed: FIELD_TYPES.locKey,
    tooltip: FIELD_TYPES.locKey,
  },
  guiButton: {
    pdx_tooltip: FIELD_TYPES.locKey,
    tooltip: FIELD_TYPES.locKey,
    tooltipText: FIELD_TYPES.locKey,
    delayedTooltipText: FIELD_TYPES.locKey,
  },
  checkbox: { pdx_tooltip: FIELD_TYPES.locKey },
  container: {
    pdx_tooltip: FIELD_TYPES.locKey,
    pdx_tooltip_delayed: FIELD_TYPES.locKey,
    pdx_tooltip_anchor_offset: FIELD_TYPES.position,
    pdx_tooltip_anchor_orientation: FIELD_TYPES.enum,
  },
  effectbutton: { tooltipText: FIELD_TYPES.locKey, delayedTooltipText: FIELD_TYPES.locKey },
  window: { pdx_tooltip: FIELD_TYPES.locKey },
};

/**
 * The tooltip field a kind uses when a caller asks for "a custom tooltip", so the emitter writes
 * the legal one instead of dropping the intent.
 */
const CUSTOM_TOOLTIP_TARGET = {
  button: 'pdx_tooltip',
  text: 'pdx_tooltip',
  icon: 'pdx_tooltip',
  checkbox: 'pdx_tooltip',
  container: 'pdx_tooltip',
  window: 'pdx_tooltip',
  guiButton: 'tooltip',
  effectbutton: 'tooltipText',
};

/**
 * `alwaysTransparent` per kind: text 1234, icon 1473, button 166, smoothListBox 21, listBox 10,
 * guiButton 1 - and **0 on containerWindowType**, where the engine answers
 * "Unexpected token: alwaysTransparent" (47 of those in one run). Inside a `background = { ... }`
 * block it is legal and common (412 uses), which is where a container's transparency belongs
 * (interface/planet_view.gui:255).
 */
const ALWAYS_TRANSPARENT_KINDS = new Set(['text', 'icon', 'button', 'guiButton', 'listBox', 'smoothListBox']);

/**
 * THE ENGINE'S `id` FIELD, UNDER A DIFFERENT NAME IN THE MODEL.
 *
 * Vanilla writes a scalar `id = "name"` inside elements, and which kinds use it is measured by
 * attributing every such line to its innermost enclosing element keyword over the install's 177
 * `.gui` files:
 *
 *   spinnerType          37 of 40      interface/additional_content/additional_content.gui:825
 *   buttonType           25 of 2067    interface/federation_view.gui:1085
 *   scrollbartype        12 of 24      (see `interface/agreement_negotiation_view.gui:1079`)
 *   smoothListboxType    10 of 243
 *   iconType              7 of 2779
 *   containerWindowType   1 of 3305
 *
 * The model cannot simply use `id` for it, because `node.id` is ALSO this model's node identity and
 * `applyEdits` invents a random hex one whenever it is missing (`src/lib/layout.mjs`). Writing
 * `node.id` as an engine field would therefore put `id = "a1b2c3d4"` into generated files; not
 * writing it lost a real field. So the engine's field is called `engineId` in the model and
 * `emit.mjs`'s `EMIT_FIELD_ALIAS` writes it out as `id`. A parsed file's `id` is recorded under
 * both, so a round trip is exact.
 */
const ENGINE_ID_FIELD = { engineId: FIELD_TYPES.string };

/**
 * THE ENGINE-POPULATED CONTAINERS. A layout container in this engine is a BOX the C++ fills; it is
 * not a parent a `.gui` file puts its own children in, and the difference matters because a modder
 * who wants a matrix of their own cells reaches for `gridBoxType` first and it does not do that.
 *
 * Measured over the install's 177 `.gui` files, counting the blocks that contain at least one
 * nested ELEMENT keyword (a text/icon/button/container/... block inside their braces):
 *
 *   gridBoxType                 261 blocks   0 with a nested element
 *   OverlappingElementsBoxType  189 blocks   0 with a nested element
 *   smoothListBoxType           242 blocks   0 with a nested element
 *   listBoxType                  43 blocks   0 with a nested element
 *   windowType                   24 blocks  24 with a nested element
 *   dropDownBoxType              13 blocks  13 with a nested element
 *   containerWindowType        3305 blocks 2710 with a nested element
 *
 * What fills them is C++, and the install says so in its own comments:
 * `interface/additional_content/additional_content.gui:331-345` declares two empty `gridBoxType`
 * boxes and annotates their `slotSize`/`max_slots_horizontal` with "Use the positionTypes at the
 * top of the file to change the slot size" / "...the max slots" - i.e. the engine reads a
 * `positionType` NAME (a string literal in `stellaris.exe`: `additional_content_grid_spacing`,
 * `additional_content_window_small_size`) and sets the grid from it.
 *
 * So these kinds are emittable - the box, its geometry and its slot size are real fields a mod can
 * write - but they are NOT hosts for a mod's own layout. `engine-populated-container-children`
 * reports a child placed in one.
 */
export const ENGINE_POPULATED_KINDS = new Set(['gridBox', 'overlappingElementsBox', 'listBox', 'smoothListBox']);

/** Fields a `background = { ... }` block accepts (measured: 1696 `name`, 1210 `spriteType`). */
export const BACKGROUND_FIELDS = new Map([
  ['name', FIELD_TYPES.string],
  ['spritetype', FIELD_TYPES.sprite],
  ['quadtexturesprite', FIELD_TYPES.sprite],
  ['alwaystransparent', FIELD_TYPES.boolean],
  ['position', FIELD_TYPES.position],
  ['clicksound', FIELD_TYPES.sound],
  ['oversound', FIELD_TYPES.sound],
  ['no_clicksound', FIELD_TYPES.boolean],
  ['alpha', FIELD_TYPES.number],
  ['frame', FIELD_TYPES.integer],
  ['size', FIELD_TYPES.size],
  ['font', FIELD_TYPES.font],
  ['pdx_tooltip', FIELD_TYPES.locKey],
  ['pdx_tooltip_delayed', FIELD_TYPES.locKey],
  ['tooltip', FIELD_TYPES.locKey],
  ['tooltiptext', FIELD_TYPES.locKey],
  ['delayedtooltiptext', FIELD_TYPES.locKey],
  ['tooltip_mode_enabled', FIELD_TYPES.boolean],
  ['centerposition', FIELD_TYPES.boolean],
]);

/**
 * Fields the engine's own parser REJECTS on a kind where vanilla never writes them - proven by
 * its error log, not inferred. A finding about one of these is an error; an unproven per-kind
 * mismatch is only a warning.
 *
 * `effect` is the fourth, and the one this project learned last: it is a real field, but only on
 * `effectbuttonType`. Written on a `buttonType` (the natural mistake - the two kinds differ by one
 * word and share every other field) the engine answers `Unexpected token: effect` and drops the
 * block, so the button is drawn and does NOTHING when clicked. The UN General Assembly window's six
 * close buttons were in exactly that state; they only carried script once each one became an
 * `effectbuttonType` with identical name/sprite/position/orientation/clicksound. `buttonType` has no
 * scriptable action at all - its action is hardcoded in the engine.
 */
export const ENGINE_REJECTED_FIELDS = new Set(['custom_tooltip', 'fail_text', 'alwaystransparent', 'origo', 'effect']);

/**
 * FIELDS THE ENGINE REJECTS ON ONE KIND, AND ONLY ON THAT KIND - PROVEN BY ITS OWN ERROR LOG (GAP-15).
 *
 * `ENGINE_REJECTED_FIELDS` above is global because each of its entries was proven on a kind where
 * vanilla writes the field NOWHERE at all, so "rejected somewhere" and "rejected here" are the same
 * question. `visible` is a different shape: the measurement covers `containerWindowType` and nothing
 * else. Probed in game, Stellaris 4.4.6 (PROBE-RESULTS.md section 2, "A flaw in the first version of
 * this probe" - run A's `error.log`, verbatim):
 *
 *   [23:46:46][persistent.cpp:41]: Error: "Unexpected token: visible, near line: 17
 *   " in file: "interface/input_blocker.gui" near line: 17
 *
 * and the consequence recorded with it: the rejected token DERAILED THE REST OF THE ENCLOSING BLOCK,
 * so every field after it in that block was lost as well. That is not a cosmetic extra token.
 *
 * The install census agrees for containers and says nothing about anywhere else: counting DIRECT
 * scalar children over all 177 vanilla `.gui` files, **0** of them write `visible` on any element
 * kind at all. The four kinds the probe's own reference calls text/icon/button fields were NOT
 * probed either way, so this table is per-kind by construction: `visible` is reported on a
 * `containerWindowType`, and the rule keeps quiet everywhere else rather than generalising an
 * unmeasured rejection to every kind. `scripts/selftest.mjs` asserts both halves.
 *
 * The value is the note the finding carries - what the engine's rejection COSTS on this kind.
 */
export const KIND_REJECTED_FIELDS = new Map([
  [
    'container',
    new Map([
      [
        'visible',
        'the engine reports "Unexpected token: visible" for it and the rejected token derails the REST of the ' +
          'container block, so the fields written after it are lost too (measured: PROBE-RESULTS.md section 2)',
      ],
    ]),
  ],
]);

/**
 * FIELDS THE CORPUS PROVES THE ENGINE ACCEPTS, WHICH THIS PROJECT'S FIELD MODEL DOES NOT DECLARE.
 *
 * The field model is a SUBSET of what the engine's parsers accept: every list in this file was
 * measured, and a handful of field names occur in vanilla often enough to be certain and rarely
 * enough that the list never grew an entry for them. Measured over all 177 vanilla `.gui` files,
 * counting DIRECT scalar children per enclosing kind (the whole corpus, 12801 element uses):
 *
 *   containerWindowType  movable 1        (the one-file misspelling of `moveable`, which vanilla
 *                                         writes 459 times - the engine loaded the file that has it)
 *   buttonType           navLeft 29, navRight 6, alpha 1
 *   instantTextBoxType   concepts_show_missing_dlc 2
 *
 * These are NOT model fields - the emitter writes none of them, and `unknown-field` (info) still
 * marks them as unmodelled on the model side. What they must never become is a claim about the
 * FILE: the engine loaded every file that carries one, so the file-syntax rule that reports an
 * unknown token (`unexpected-token`, src/lib/syntax.mjs) consults this set and stays quiet. Without
 * it that rule would call vanilla's own files broken in 39 places - the class of false positive this
 * project refuses, and the reason the rule is measured rather than guessed.
 */
export const UNMODELLED_CORPUS_FIELDS = new Map([
  ['container', new Set(['movable'])],
  ['button', new Set(['navleft', 'navright', 'alpha'])],
  ['text', new Set(['concepts_show_missing_dlc'])],
]);

/**
 * The form that means the same thing on a kind that cannot carry the field as written.
 *
 * This is the table a finding quotes, so it is stated as a REPLACEMENT the caller can apply, not as
 * prose. `kind` is the kind the field was written ON.
 */
export const FIELD_EQUIVALENTS = [
  { field: 'effect', kinds: ['button'], equivalent: 'effectbuttonType (same name/sprite/position/orientation/clicksound, plus `effect = <key>`)' },
  { field: 'effect', kinds: ['guiButton'], equivalent: 'effectbuttonType with the same geometry' },
];

/**
 * `origo` per kind: 175 uses, all on `containerWindowType`, and 0 anywhere else. An icon that
 * wanted `origo = center` gets `centerPosition = yes`, which vanilla uses 274 times on iconType
 * and which means the same thing (layout.mjs folds it into the origo).
 */
const ORIGO_KINDS = new Set(['container']);

/**
 * The text-ish fields the corpus uses on a text-bearing kind.
 *
 * `buttonText` IS ONE OF THEM (GAP-7), and its absence was the difference between a rule and noise:
 * measured over the install's 177 `.gui` files, `buttonText` appears 456 times on a `buttonType`, 14
 * on a `guiButtonType`, and **2 on an `effectbuttonType`** - and both of the last two are the project's
 * own live-text channel (`interface/fleet_view.gui:708-721`: `effectbuttonType` + `effect` +
 * `buttonText = "GROW_UP"`). Because it was in no kind's field set, the validator reported
 * `` `buttonText` is not a field this project models on `effectbutton` `` once per readout - 62
 * findings on the one shipped mod file, every one of them a live number, which is exactly the channel
 * this project documents as the ONLY measured way to paint a live value inside a `custom_gui` window
 * (docs/gui-pitfalls.md section 11). A genuine unknown field was invisible among them.
 *
 * `emit.mjs` already listed `buttonText` in its per-kind `FIELD_ORDER` for `button`, `effectbutton`
 * and `guiButton`, so the emitter wrote the field the validator called unknown. The tables now agree.
 * It is a localisation KEY, like `text`, so `formatScalar` quotes it by default - no extra rule is
 * needed, and `ALWAYS_QUOTED_FIELDS` documents that "quoted unless a bare value is measured".
 */
const TEXT_FIELDS = {
  text: FIELD_TYPES.locKey,
  buttonText: FIELD_TYPES.locKey,
  appendText: FIELD_TYPES.locKey,
  font: FIELD_TYPES.font,
  buttonFont: FIELD_TYPES.font,
  maxWidth: FIELD_TYPES.integer,
  maxHeight: FIELD_TYPES.integer,
  fixedSize: FIELD_TYPES.boolean,
  format: FIELD_TYPES.enum,
  vertical_alignment: FIELD_TYPES.enum,
  text_color_code: FIELD_TYPES.string,
  multiline: FIELD_TYPES.boolean,
  borderSize: FIELD_TYPES.position,
  dynamic_extra_height: FIELD_TYPES.number,
  scrollbartype: FIELD_TYPES.string,
};

/** The fields a kind accepts, including the per-kind decoration rules above. */
function fieldsFor(kind, extra) {
  const tooltips = TOOLTIP_FIELDS[kind] ?? {};
  return {
    ...COMMON_LAYOUT_FIELDS,
    ...tooltips,
    ...(ALWAYS_TRANSPARENT_KINDS.has(kind) ? { alwaysTransparent: FIELD_TYPES.boolean } : {}),
    ...(ORIGO_KINDS.has(kind) ? { origo: FIELD_TYPES.enum } : {}),
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------
// THE COMPONENTS. These are NOT engine kinds: there is no `bar` keyword and no bar window element
// kind anywhere in the install - the 41 block keywords vanilla's 177 `.gui` files use are listed
// in `src/lib/components.mjs`, and none of them is a bar. A component is a MODEL construct that
// `computeLayout` expands into real elements before anything is measured or written, so a caller
// asks for the intent ("a bar of this proportion") and the emitter writes the construction that
// works. `emitter: true` here means "this plugin can write it" - through its expansion, not by
// writing a `bar = { }` block, which no engine parser accepts.
//
// They live in the kind registry because that is what drives the model: the tool schemas are
// generated from this table, the validator resolves a node's kind through it, and the layout
// engine's field legality comes from it. One table, one vocabulary.
const COMPONENT_KINDS = [
  {
    kind: 'matrix',
    keywords: ['matrix'],
    emitter: true,
    component: true,
    acceptsChildren: true,
    sizeForm: SIZE_FORMS.widthHeight,
    vanillaUses: 0,
    fields: fieldsFor('container', {
      rows: FIELD_TYPES.integer,
      columns: FIELD_TYPES.integer,
      cellWidth: FIELD_TYPES.integer,
      cellHeight: FIELD_TYPES.integer,
      gapX: FIELD_TYPES.integer,
      gapY: FIELD_TYPES.integer,
      padding: FIELD_TYPES.integer,
      columnHeaderHeight: FIELD_TYPES.integer,
      rowHeaderWidth: FIELD_TYPES.integer,
      headerFont: FIELD_TYPES.font,
      columnHeaders: FIELD_TYPES.string,
      rowHeaders: FIELD_TYPES.string,
      cells: FIELD_TYPES.string,
      width: FIELD_TYPES.integer,
      height: FIELD_TYPES.integer,
    }),
    help:
      'NOT an engine kind: a MATRIX component, expanded by computeLayout into one `containerWindowType` frame holding ' +
      'one positioned `containerWindowType` per occupied cell, plus optional column/row labels. `rows` x `columns` of ' +
      '`cellWidth` x `cellHeight`, separated by `gapX`/`gapY`, inset by `padding`. Place a cell with ' +
      '`cells: [{ row, column, node }]`, or let `children` fill the free slots row-major. It is NOT a `gridBoxType`: ' +
      'measured over the install, 0 of 261 `gridBoxType` blocks contain a nested element - the engine fills those from ' +
      'C++, so a mod cannot put its own cells in one. `matrix-cell-overflow` refuses a cell whose content is bigger ' +
      'than its slot. See docs/gui-pitfalls.md section 18.',
  },
  {
    kind: 'bar',
    keywords: ['bar'],
    emitter: true,
    component: true,
    acceptsChildren: false,
    sizeForm: SIZE_FORMS.widthHeight,
    vanillaUses: 0,
    fields: fieldsFor('container', {
      // The construction. See src/lib/components.mjs for what each of these expands to.
      width: FIELD_TYPES.integer,
      height: FIELD_TYPES.integer,
      value: FIELD_TYPES.number,
      max: FIELD_TYPES.number,
      inset: FIELD_TYPES.integer,
      label: FIELD_TYPES.locKey,
      labelSide: FIELD_TYPES.enum,
      labelWidth: FIELD_TYPES.integer,
      labelGap: FIELD_TYPES.integer,
      labelEffect: FIELD_TYPES.locKey,
      track: FIELD_TYPES.sprite,
      fill: FIELD_TYPES.sprite,
      border: FIELD_TYPES.boolean,
      headingName: FIELD_TYPES.string,
    }),
    help:
      'NOT an engine kind: a bar COMPONENT, expanded by computeLayout into the canonical drawn construction ' +
      '(track container + inset fill container + label) that the working mod\'s power-projection ranking bars use. ' +
      '`value`/`max` set a STATIC proportion - the fill length is a layout number, and no .gui field makes a fill follow ' +
      'a live value; a live NUMBER arrives through `labelEffect` (effectbuttonType.buttonText), which paints text and ' +
      'cannot move the rectangle. See docs/gui-pitfalls.md section 16.',
  },
];

/**
 * The registry.
 *
 * `emitter: true` means `emit.mjs` can write this kind. Every kind with `emitter: true` has a
 * `sizeForm` and a `FIELD_ORDER` entry in emit.mjs; `sizeForm: 'none'` kinds are written
 * without any size at all, because the engine draws them at their sprite's natural size
 * (0 of 2779 vanilla `iconType` blocks declare one).
 */
export const ELEMENT_KINDS = [
  {
    kind: 'container',
    keywords: ['containerWindowType'],
    emitter: true,
    acceptsChildren: true,
    sizeForm: SIZE_FORMS.widthHeight,
    vanillaUses: 3305,
    background: true,
    fields: fieldsFor('container', {
      background: 'background',
      ...ENGINE_ID_FIELD,
      dynamic_extra_height: FIELD_TYPES.number,
      verticalscrollbar: FIELD_TYPES.string,
      horizontalscrollbar: FIELD_TYPES.string,
      scroll_wheel_factor: FIELD_TYPES.number,
      smooth_scrolling: FIELD_TYPES.boolean,
      dynamic_extra_y: FIELD_TYPES.number,
      dynamic_extra_height_max: FIELD_TYPES.number,
      respect_parent_boundaries: FIELD_TYPES.boolean,
      click_to_front: FIELD_TYPES.boolean,
      dontrender: FIELD_TYPES.boolean,
      fullscreen: FIELD_TYPES.boolean,
      horizontalborder: FIELD_TYPES.number,
      verticalborder: FIELD_TYPES.number,
      margin: FIELD_TYPES.position,
      fade_type: FIELD_TYPES.enum,
      fade_time: FIELD_TYPES.number,
      animation_type: FIELD_TYPES.enum,
      animation_time: FIELD_TYPES.number,
      show_animation_type: FIELD_TYPES.enum,
      hide_animation_type: FIELD_TYPES.enum,
      show_position: FIELD_TYPES.position,
      hide_position: FIELD_TYPES.position,
      upsound: FIELD_TYPES.sound,
    }),
    help: 'The structural workhorse: a rectangle that holds other elements. `size = { width height }` is the container form (2903 uses); no other kind uses it.',
  },
  {
    kind: 'text',
    keywords: ['instantTextBoxType', 'InstantTextBoxType', 'instantTextboxType', 'textBoxType', 'textboxType'],
    emitter: true,
    acceptsChildren: false,
    sizeForm: SIZE_FORMS.maxWidthHeight,
    vanillaUses: 3220,
    fields: fieldsFor('text', { ...TEXT_FIELDS, texturefile: FIELD_TYPES.string, truncate: FIELD_TYPES.boolean }),
    help:
      'Displays localisation text. SIZE IS `maxWidth`/`maxHeight`, NEVER `size` - the engine rejects `size` on this ' +
      'kind with "Unexpected token: size" and tells you to "use maxWidth and maxHeight".',
  },
  {
    kind: 'icon',
    keywords: ['iconType'],
    emitter: true,
    acceptsChildren: false,
    sizeForm: SIZE_FORMS.none,
    vanillaUses: 2779,
    fields: fieldsFor('icon', {
      ...ENGINE_ID_FIELD,
      spriteType: FIELD_TYPES.sprite,
      quadTextureSprite: FIELD_TYPES.sprite,
      frame: FIELD_TYPES.integer,
      mirror: FIELD_TYPES.boolean,
    }),
    help:
      'A picture. `spriteType` needs a fixed-size sprite; `quadTextureSprite` takes a 9-slice cornered tile. ' +
      'Neither accepts a `size`: 0 of 2779 vanilla icons declare one, so the icon draws at its texture size.',
  },
  {
    kind: 'button',
    keywords: ['buttonType'],
    emitter: true,
    acceptsChildren: false,
    sizeForm: SIZE_FORMS.xY,
    vanillaUses: 2067,
    fields: fieldsFor('button', {
      ...TEXT_FIELDS,
      defaultSelection: FIELD_TYPES.boolean,
      spriteType: FIELD_TYPES.sprite,
      quadTextureSprite: FIELD_TYPES.sprite,
      frame: FIELD_TYPES.integer,
      web_link: FIELD_TYPES.string,
      actionShortcut: FIELD_TYPES.string,
      // Controller/keyboard focus neighbours. Measured on `buttonType`
      // (`interface/federation_view.gui:1091`, `interface/mainmenu_view.gui:40`) and on
      // `spinnerType`; NOT modelled on every kind, because the corpus only proves these two.
      navUp: FIELD_TYPES.string,
      navDown: FIELD_TYPES.string,
      ...ENGINE_ID_FIELD,
    }),
    help:
      'A button whose action is hardcoded in the engine. `size = { x = W y = H }` (450 uses) - the x/y form where ' +
      'x is the width. For a mod-defined action use `effectbutton`.',
  },
  {
    kind: 'effectbutton',
    keywords: ['effectbuttonType', 'effectButtonType'],
    emitter: true,
    acceptsChildren: false,
    sizeForm: SIZE_FORMS.xY,
    vanillaUses: 2,
    requiresEffect: true,
    fields: fieldsFor('effectbutton', {
      ...TEXT_FIELDS,
      spriteType: FIELD_TYPES.sprite,
      quadTextureSprite: FIELD_TYPES.sprite,
      frame: FIELD_TYPES.integer,
      effect: FIELD_TYPES.string,
    }),
    help:
      'A mod-scriptable button: `effect` names a top-level key in common/button_effects/*.txt, and its tooltip is ' +
      '`tooltipText` (vanilla interface/fleet_view.gui:708) - NOT `custom_tooltip`, which is a script field. ' +
      '`size = { x y }`.',
  },

  // --- also emittable: the kinds a real window needs ----------------------------------------
  {
    kind: 'gridBox',
    keywords: ['gridBoxType', 'gridboxType'],
    emitter: true,
    acceptsChildren: true,
    enginePopulated: true,
    sizeForm: SIZE_FORMS.widthHeight,
    vanillaUses: 260,
    fields: fieldsFor('gridBox', {
      format: FIELD_TYPES.enum,
      slotSize: FIELD_TYPES.size,
      slotsize: FIELD_TYPES.size,
      max_slots_horizontal: FIELD_TYPES.integer,
      max_slots_vertical: FIELD_TYPES.integer,
      add_horizontal: FIELD_TYPES.boolean,
      padding: FIELD_TYPES.position,
      defaultselection: FIELD_TYPES.integer,
      resizeparent: FIELD_TYPES.boolean,
      is_dynamic: FIELD_TYPES.boolean,
      background: FIELD_TYPES.sprite,
    }),
    help:
      'Engine-laid-out grid (156 uses with `size = { width height }`). The engine fills the cells, so children are ' +
      'written but normally absent. `slotSize` is the cell size.',
  },
  {
    kind: 'smoothListBox',
    keywords: ['smoothListBoxType', 'smoothListboxType'],
    emitter: true,
    acceptsChildren: true,
    enginePopulated: true,
    sizeForm: SIZE_FORMS.xY,
    vanillaUses: 243,
    scalarBackground: true,
    fields: fieldsFor('smoothListBox', {
      ...ENGINE_ID_FIELD,
      dynamic_extra_height: FIELD_TYPES.number,
      borderSize: FIELD_TYPES.position,
      spacing: FIELD_TYPES.integer,
      scrollbartype: FIELD_TYPES.string,
      offset: FIELD_TYPES.position,
      defaultSelection: FIELD_TYPES.integer,
      defaultselection: FIELD_TYPES.integer,
      priority: FIELD_TYPES.integer,
      autohide_scrollbar: FIELD_TYPES.boolean,
      horizontal: FIELD_TYPES.boolean,
      wraparound: FIELD_TYPES.boolean,
      background: FIELD_TYPES.sprite,
      ...ENGINE_ID_FIELD,
      navUp: FIELD_TYPES.string,
      navDown: FIELD_TYPES.string,
    }),
    help: 'Smooth-scrolling list, `size = { x y }`. `background` here is a bare sprite NAME, not a block.',
  },
  {
    kind: 'listBox',
    keywords: ['listBoxType', 'listboxType'],
    emitter: true,
    acceptsChildren: true,
    enginePopulated: true,
    sizeForm: SIZE_FORMS.xY,
    vanillaUses: 43,
    scalarBackground: true,
    fields: fieldsFor('listBox', {
      borderSize: FIELD_TYPES.position,
      spacing: FIELD_TYPES.integer,
      scrollbartype: FIELD_TYPES.string,
      priority: FIELD_TYPES.integer,
      autohide_scrollbar: FIELD_TYPES.boolean,
      horizontal: FIELD_TYPES.boolean,
      background: FIELD_TYPES.sprite,
    }),
    help:
      'Jump-scrolling list (43 uses, all `size = { x y }`). This is the kind the trial had to hand-write as ' +
      '`listBoxType { name = "option_list" }`; it is emittable now.',
  },
  {
    kind: 'overlappingElementsBox',
    keywords: ['OverlappingElementsBoxType', 'overlappingElementsBoxType'],
    emitter: true,
    acceptsChildren: true,
    enginePopulated: true,
    sizeForm: SIZE_FORMS.xY,
    vanillaUses: 188,
    fields: fieldsFor('overlappingElementsBox', {
      format: FIELD_TYPES.enum,
      spacing: FIELD_TYPES.integer,
      first_on_top: FIELD_TYPES.boolean,
      horizontal: FIELD_TYPES.boolean,
      direction: FIELD_TYPES.enum,
    }),
    help: 'Horizontal/vertical list that overlaps when full (188 uses, all `size = { x y }`).',
  },
  {
    kind: 'guiButton',
    keywords: ['guiButtonType'],
    emitter: true,
    acceptsChildren: false,
    sizeForm: SIZE_FORMS.xY,
    vanillaUses: 198,
    fields: fieldsFor('guiButton', {
      ...TEXT_FIELDS,
      spriteType: FIELD_TYPES.sprite,
      quadTextureSprite: FIELD_TYPES.sprite,
      frame: FIELD_TYPES.integer,
      parent: FIELD_TYPES.string,
      web_link: FIELD_TYPES.string,
    }),
    help: 'The button a scrollbar/spinner is built from: referenced by name from `slider`/`track`/`leftbutton`.',
  },
  {
    kind: 'scrollbar',
    keywords: ['scrollbarType', 'extendedScrollbarType'],
    emitter: true,
    acceptsChildren: true,
    sizeForm: SIZE_FORMS.xY,
    // Vanilla disagrees with itself: 18 `scrollbarType` blocks use `size = { x y }` and 5
    // `extendedScrollbarType` blocks use `size = { width height }` (interface/core.gui:373).
    // The emitter follows the keyword, so both round-trip byte-identically.
    sizeFormByKeyword: { extendedScrollbarType: SIZE_FORMS.widthHeight },
    vanillaUses: 24,
    fields: fieldsFor('scrollbar', {
      borderSize: FIELD_TYPES.position,
      overlay: FIELD_TYPES.position,
      slider: FIELD_TYPES.string,
      track: FIELD_TYPES.string,
      leftbutton: FIELD_TYPES.string,
      rightbutton: FIELD_TYPES.string,
      ...ENGINE_ID_FIELD,
      priority: FIELD_TYPES.integer,
      maxvalue: FIELD_TYPES.number,
      minvalue: FIELD_TYPES.number,
      // Focus neighbours. Measured on `buttonType` (9 `navUp`, 7 `navDown`), `scrollbarType`
      // (5 each), `smoothListBoxType` (1 / 3) and `spinnerType` (1 each) - the ONLY four kinds that
      // use them, which is why they are declared per kind rather than shared: declaring them on one
      // kind and not the others made the engine-syntax checker report vanilla's own files.
      navUp: FIELD_TYPES.string,
      navDown: FIELD_TYPES.string,
      stepsize: FIELD_TYPES.number,
      startvalue: FIELD_TYPES.number,
      horizontal: FIELD_TYPES.boolean,
      snappoint: FIELD_TYPES.string,
      snappoint_center: FIELD_TYPES.string,
      background: FIELD_TYPES.sprite,
      ...ENGINE_ID_FIELD,
    }),
    help:
      'Scrollbar definition. The slider/track/button names refer to the nested `guiButtonType` children, which are ' +
      'modelled as child elements.',
  },

  // --- recognised, laid out and validated, but not emittable --------------------------------
  {
    kind: 'position',
    keywords: ['positionType'],
    emitter: false,
    acceptsChildren: false,
    sizeForm: SIZE_FORMS.none,
    // MEASURED TWO WAYS, AND BOTH NUMBERS ARE TRUE OF A DIFFERENT RULE.
    //
    // 233 is this project's own parse-based count of `positionType` blocks at any depth, which is the
    // unit every `vanillaUses` in this table uses and the number `docs/kind-census.json` records.
    // The in-game probe round of 2026-10-06 re-measured the same corpus with a LINE-based rule
    // ("the declaration starts its own line") and got **224**, because nine declarations are written
    // on one line or with the brace on the next one (`topbar_traditions_view.gui:22-29` is eight
    // `positionType = { name = "ap_N" position = { ... } }` one-liners; `ship_designer.gui:43` puts
    // the `{` on the following line). Both counts are recorded rather than reconciled - the
    // knowledge topic `positiontype-is-a-global-named-anchor` states why, and
    // `scripts/selftest.mjs` pins 224 beside 233 so neither can be quietly replaced by the other.
    vanillaUses: 233,
    fields: fieldsFor('position', { dynamic_extra_height: FIELD_TYPES.number }),
    help:
      'NOT emittable, and the reason is measured rather than a matter of effort: a `positionType` is a ' +
      'named constant the ENGINE owns. This parser counts 233 of them (`interface/additional_content/additional_content.gui:2`; ' +
      'the in-game probe counted 224 under a stricter line-based rule - see the source note above). Nearly every one declares ' +
      '`name` + `position` and nothing else, and no name is ever used as another element\'s FIELD: the name is looked up from ' +
      'C++, and the strings are literal in `stellaris.exe` (`additional_content_grid_spacing`, ' +
      '`additional_content_window_small_size`). 163 of the 224 line-rule names occur as contiguous literals in the exe, and 14 ' +
      'appear elsewhere in `interface/**` - comments, or a longer name containing them - so a name is GLOBAL, not file-local: ' +
      'this project\'s earlier "0 of the names are referenced elsewhere" was FALSE and is retired. A mod cannot invent an anchor ' +
      'the engine will ask for, so writing one would add a declaration nothing reads.',
  },
  {
    kind: 'editBox',
    keywords: ['editBoxType'],
    emitter: true,
    acceptsChildren: false,
    sizeForm: SIZE_FORMS.xY,
    vanillaUses: 85,
    fields: fieldsFor('editBox', {
      ...TEXT_FIELDS,
      texturefile: FIELD_TYPES.string,
      cursor: FIELD_TYPES.position,
      max_characters: FIELD_TYPES.integer,
      allow_multi_line: FIELD_TYPES.boolean,
      limited_height: FIELD_TYPES.boolean,
      wrap_text: FIELD_TYPES.boolean,
      // A BOOLEAN on this kind, and the only field in the whole kind table whose name is also
      // another kind's keyword: `editBoxType = { instantTextBoxType = no ... }`
      // (`interface/browser_dialog.gui:82`, 42 of the 85 blocks). `instantTextBoxType` is a text
      // ELEMENT name elsewhere, which is why `renderElement` must keep reading the parsed BLOCK
      // form (a `{ }`) as the text kind and this SCALAR form as the flag.
      instanttextboxtype: FIELD_TYPES.boolean,
      use_special_chars: FIELD_TYPES.boolean,
    }),
    help:
      'Editable text field. `size = { x y }` (85 of 85 blocks). `instantTextBoxType` here is a BOOLEAN flag, not the ' +
      'text element kind of the same name (42 of 85).',
  },
  {
    kind: 'checkbox',
    keywords: ['checkboxType'],
    emitter: true,
    acceptsChildren: false,
    sizeForm: SIZE_FORMS.none,
    vanillaUses: 77,
    fields: fieldsFor('checkbox', {
      spriteType: FIELD_TYPES.sprite,
      quadTextureSprite: FIELD_TYPES.sprite,
    }),
    help:
      'Yes/no box, drawn at its sprite size. Measured fields over all 77 blocks: `name`, `quadTextureSprite` (51), ' +
      '`spriteType` (26), `pdx_tooltip` (18), `clicksound` (7), `orientation` (8), `oversound` (2), `shortcut` (1), ' +
      '`scale` (1) and `position` (69). 0 of 77 declare a `size`, so the sprite picks the box - the same rule as ' +
      '`iconType`.',
  },
  {
    kind: 'spinner',
    keywords: ['spinnerType'],
    emitter: true,
    acceptsChildren: true,
    sizeForm: SIZE_FORMS.xY,
    vanillaUses: 40,
    fields: fieldsFor('spinner', {
      leftbutton: FIELD_TYPES.string,
      rightbutton: FIELD_TYPES.string,
      borderSize: FIELD_TYPES.position,
      horizontal: FIELD_TYPES.boolean,
      priority: FIELD_TYPES.integer,
      maxValue: FIELD_TYPES.number,
      startValue: FIELD_TYPES.number,
      defaultSelection: FIELD_TYPES.integer,
      navUp: FIELD_TYPES.string,
      navDown: FIELD_TYPES.string,
      overlay: FIELD_TYPES.position,
      ...ENGINE_ID_FIELD,
    }),
    help:
      'Carousel: `leftbutton`/`rightbutton` NAME two nested `guiButtonType` children (80 children across 40 blocks - ' +
      'exactly two each), which is why this kind accepts children. `size = { x y }` in all 40. The engine\'s `id` ' +
      'field is real here (37 of 40) and is written from the model\'s `engineId`; a caller-supplied `id` supplies ' +
      'node identity and is never written as an engine field.',
  },
  {
    kind: 'window',
    keywords: ['windowType'],
    emitter: true,
    acceptsChildren: true,
    sizeForm: SIZE_FORMS.xY,
    vanillaUses: 24,
    background: true,
    // `windowType` uses BOTH spellings of the background: a block
    // (`interface/ambient_object_view.gui:17`) and a bare sprite string
    // (`interface/customize_species_editors.gui:3800`, `backGround = "GFX_tiles_dark_area_cut_8"`).
    // 95 of the corpus's 1789 background lines spell it `backGround`; the key is case-insensitive.
    scalarBackground: true,
    fields: fieldsFor('window', {
      background: 'background',
      dontrender: FIELD_TYPES.boolean,
      fullscreen: FIELD_TYPES.boolean,
      horizontalborder: FIELD_TYPES.number,
      verticalborder: FIELD_TYPES.number,
    }),
    help:
      'A floating container the ENGINE puts on screen and the player can move. `size = { x y }`. The measured fields ' +
      'over all 24 blocks are `name`, `moveable` (19), `backGround` (18, block OR bare sprite), `dontRender` (18), ' +
      '`horizontalBorder` (18), `verticalBorder` (18), `fullScreen` (18), `orientation` (6), `position` (20), ' +
      '`size` (23). A `windowType` is the one non-`containerWindowType` kind a mod can fill with its own children ' +
      '(24 of 24 blocks do) - but its PLACEMENT is the engine\'s: vanilla declares these for windows the engine ' +
      'creates (chat, browser dialog), and no script effect opens one a mod declares.',
  },
  {
    kind: 'dropDownBox',
    keywords: ['dropDownBoxType'],
    emitter: true,
    acceptsChildren: true,
    sizeForm: SIZE_FORMS.widthHeight,
    vanillaUses: 13,
    background: true,
    fields: fieldsFor('dropDownBox', {
      background: 'background',
      // The two blocks that are ELEMENTS WITHOUT A KEYWORD. Vanilla writes
      //   expandedWindow = { name = ... position = ... size = { width height } ... <elements> }
      //   expandButton   = { name = ... position = ... spriteType = ... clicksound = ... }
      // - the KEY is the field name; there is no `containerWindowType`/`guiButtonType` line inside.
      // The bodies are those kinds' bodies, so the model carries them as CHILDREN with `asField` set
      // to the key that must be written (`renderElement` prefers `asField` over the keyword).
      expandedwindow: FIELD_TYPES.string,
      expandbutton: FIELD_TYPES.string,
    }),
    help:
      'Drop-down: `size = { width height }` (13 of 13). Its two structural parts are written as UNKEYED element ' +
      'blocks - `expandedWindow = { ... }` (13 of 13, a container body) and `expandButton = { ... }` (6 of 13, a ' +
      'guiButton body) - so they are modelled as children carrying `asField`.',
  },

  // --- components: model constructs the layout engine expands into real elements -------------
  ...COMPONENT_KINDS,
];

const KIND_BY_KEYWORD = new Map();
for (const spec of ELEMENT_KINDS) {
  for (const keyword of spec.keywords) KIND_BY_KEYWORD.set(keyword.toLowerCase(), spec);
}

/**
 * field (lower-cased) -> { canonical, kinds }. Built from the kind table, so a field is "known"
 * exactly when some kind declares it and "accepted" only on the kinds that do.
 */
const FIELD_INDEX = new Map();
for (const spec of ELEMENT_KINDS) {
  for (const field of Object.keys(spec.fields)) {
    const key = field.toLowerCase();
    if (!FIELD_INDEX.has(key)) FIELD_INDEX.set(key, { canonical: field, kinds: new Set() });
    FIELD_INDEX.get(key).kinds.add(spec.kind);
  }
}

/** The vanilla spelling of a field, or the input when no kind declares it. */
export function canonicalFieldName(field) {
  return FIELD_INDEX.get(String(field).toLowerCase())?.canonical ?? field;
}

/** Does this kind's parser accept this field? Case-insensitive, like the engine's. */
export function kindAcceptsField(kindOrSpec, field) {
  const spec = typeof kindOrSpec === 'string' ? kindSpec(kindOrSpec) : kindOrSpec;
  if (!spec || !field) return false;
  const lowered = String(field).toLowerCase();
  return Object.keys(spec.fields).some((candidate) => candidate.toLowerCase() === lowered);
}

/** Every kind that declares this field (vanilla evidence for where it is legal). */
export function kindsAcceptingField(field) {
  return [...(FIELD_INDEX.get(String(field).toLowerCase())?.kinds ?? [])];
}

/** Is this field one the install's corpus knows at all? */
export function isKnownField(field) {
  return FIELD_INDEX.has(String(field).toLowerCase());
}

/** Is this a field the engine has been OBSERVED to reject on at least one kind? */
export function isEngineRejectedField(field) {
  return ENGINE_REJECTED_FIELDS.has(String(field).toLowerCase());
}

/**
 * The note for a field the engine was measured to reject ON THIS KIND, or null.
 *
 * Separate from `isEngineRejectedField` on purpose: that set is global, this one is per kind, and
 * the difference is the measurement (see `KIND_REJECTED_FIELDS`). A finding about one of these is an
 * ERROR, and the note is what the finding says the rejection costs.
 *
 * @param {object|string} kindOrSpec
 * @param {string} field
 * @returns {string|null}
 */
export function kindRejectedFieldNote(kindOrSpec, field) {
  const spec = typeof kindOrSpec === 'string' ? kindSpec(kindOrSpec) : kindOrSpec;
  if (!spec || !field) return null;
  return KIND_REJECTED_FIELDS.get(spec.kind)?.get(String(field).toLowerCase()) ?? null;
}

/** Is this field one the engine was measured to reject on THIS kind? */
export function isFieldRejectedForKind(kindOrSpec, field) {
  return kindRejectedFieldNote(kindOrSpec, field) !== null;
}

/**
 * Is this field name one the engine named as a TOKEN while rejecting it on some kind?
 *
 * The union of `KIND_REJECTED_FIELDS`, i.e. "the engine's parser knows this name well enough to have
 * an opinion about it". It is what keeps the file-syntax `unexpected-token` rule (src/lib/syntax.mjs)
 * from calling `visible` a token NO parser has: the engine rejected it ON A CONTAINER, which is a
 * different claim from "no kind declares it", and where it IS reported is the per-kind table's
 * business.
 */
const KIND_REJECTED_FIELD_NAMES = new Set(
  [...KIND_REJECTED_FIELDS.values()].flatMap((fields) => [...fields.keys()]),
);

export function isKindRejectedFieldName(field) {
  return KIND_REJECTED_FIELD_NAMES.has(String(field).toLowerCase());
}

/**
 * Is this field one the corpus proves the engine accepts, on a kind whose model list lacks it?
 * See `UNMODELLED_CORPUS_FIELDS` - a MODEL gap, never a defect in the file.
 */
export function isUnmodelledCorpusField(kindOrSpec, field) {
  const spec = typeof kindOrSpec === 'string' ? kindSpec(kindOrSpec) : kindOrSpec;
  if (!spec || !field) return false;
  return UNMODELLED_CORPUS_FIELDS.get(spec.kind)?.has(String(field).toLowerCase()) ?? false;
}

/**
 * The form that means the same thing, when this kind cannot carry `field` as written.
 *
 * @param {string} kind the kind the field was written on
 * @param {string} field
 * @returns {string|null}
 */
export function equivalentForKind(kind, field) {
  const lowered = String(field).toLowerCase();
  const entry = FIELD_EQUIVALENTS.find(
    (candidate) => candidate.field.toLowerCase() === lowered && candidate.kinds.includes(kind),
  );
  return entry?.equivalent ?? null;
}

/**
 * Put a field the kind does not accept into the form that kind does accept, or explain why it
 * cannot be written.
 *
 * This is where the engine's per-kind parsers are translated into something a caller can keep
 * meaning: `custom_tooltip` (a script field) becomes the kind's own tooltip field, an icon's
 * `origo = center` becomes `centerPosition = yes`, and a container's `alwaysTransparent` moves
 * into its `background` block, which is where vanilla puts it.
 *
 * @returns {{field: string|null, value: *, moveToBackground?: boolean, reason: string, dropped: boolean}}
 */
export function translateFieldForKind(kindOrSpec, field, value) {
  const spec = typeof kindOrSpec === 'string' ? kindSpec(kindOrSpec) : kindOrSpec;
  const kind = spec?.kind ?? String(kindOrSpec ?? '');
  const lowered = String(field).toLowerCase();
  if (kindAcceptsField(spec, field)) {
    return { field: canonicalFieldName(field), value, reason: 'already accepted', dropped: false };
  }
  if (lowered === 'custom_tooltip' || lowered === 'fail_text') {
    const target = CUSTOM_TOOLTIP_TARGET[kind];
    if (target && kindAcceptsField(spec, target)) {
      return {
        field: target,
        value,
        reason:
          `\`${field}\` is a SCRIPT field (3777 uses inside events, 0 on any .gui element); ` +
          `\`${target}\` is the ${spec.keywords[0]} tooltip field`,
        dropped: false,
      };
    }
    return { field: null, value: null, reason: `\`${spec?.keywords?.[0] ?? kind}\` has no tooltip field`, dropped: true };
  }
  if (lowered === 'origo') {
    const centred = String(value).toLowerCase().replace(/[\s_-]/g, '') === 'center';
    if (centred && kindAcceptsField(spec, 'centerPosition')) {
      return {
        field: 'centerPosition',
        value: true,
        reason:
          '`origo` is accepted by `containerWindowType` only (175 uses, 0 elsewhere); `centerPosition = yes` is the ' +
          'same anchoring for this kind (285 vanilla uses)',
        dropped: false,
      };
    }
    return { field: null, value: null, reason: '`origo` is accepted by `containerWindowType` only', dropped: true };
  }
  if (lowered === 'alwaystransparent') {
    return {
      field: null,
      value: null,
      moveToBackground: true,
      reason:
        '`alwaysTransparent` is accepted by text/icon/button/guiButton/listBox/smoothListBox and inside a `background` ' +
        'block (412 uses), but not directly on `containerWindowType`',
      dropped: false,
    };
  }
  // A field the engine was measured to reject ON THIS KIND (GAP-15): nothing to translate to, and the
  // reason carries the measured cost of the rejection rather than a generic "not accepted".
  const kindNote = kindRejectedFieldNote(spec, field);
  if (kindNote) return { field: null, value: null, reason: kindNote, dropped: true };
  return {
    field: null,
    value: null,
    reason: `\`${field}\` is not accepted by \`${spec?.keywords?.[0] ?? kind}\``,
    dropped: true,
  };
}

/** Look up a kind spec by kind name or by the vanilla keyword. */
export function kindSpec(name) {
  if (!name) return null;
  const lowered = String(name).toLowerCase();
  for (const spec of ELEMENT_KINDS) {
    if (spec.kind.toLowerCase() === lowered) return spec;
  }
  return KIND_BY_KEYWORD.get(lowered) ?? null;
}

/**
 * Look up a kind spec by a VANILLA KEYWORD only.
 *
 * This is the lookup for deciding whether a parsed block IS an element, and the distinction is
 * load-bearing: `kindSpec('position')` matches the `position` KIND, and every element in vanilla
 * has a `position = { x y }` sub-block. Reading those sub-blocks as `positionType` elements
 * inflated a census of the install by 12067 phantom elements. A block is an element only when
 * its key is one of the keywords the engine's parser accepts there.
 */
export function kindSpecByKeyword(keyword) {
  if (!keyword) return null;
  return KIND_BY_KEYWORD.get(String(keyword).toLowerCase()) ?? null;
}

/** Sub-block keys that are never elements, however they are spelled. Belt and braces. */
export const NON_ELEMENT_BLOCK_KEYS = new Set([
  'position',
  'size',
  'bordersize',
  'slotsize',
  'padding',
  'margin',
  'offset',
  'overlay',
  'cursor',
  'show_position',
  'hide_position',
  'background',
  'if_resolution',
  'if_scaled_resolution',
]);

/** Every vanilla keyword this project recognises. */
export function knownKeywords() {
  return [...KIND_BY_KEYWORD.keys()];
}

/**
 * ELEMENT BLOCKS WHOSE KEY IS A FIELD NAME.
 *
 * `dropDownBoxType` is the one kind in the install whose structural parts are written as element
 * blocks with NO KEYWORD: the key IS the field. Measured over all 13 blocks:
 *
 *   expandedWindow = {            # 13 of 13 - a containerWindowType body
 *     name = "target_expanded_window" position = { } size = { width = 460 height = 343 }
 *     dynamic_extra_height = @dynamic_extra verticalScrollbar = "right_vertical_slider"
 *     background = { } <buttonType> <iconType> <smoothListBoxType> ...
 *   }
 *   expandButton = {              # 6 of 13 - a guiButtonType body
 *     name = "expand_button" position = { x = 150 y = 0 } spriteType = "GFX_button_down_arrow"
 *     clicksound = interface oversound = mouse_over pdx_tooltip = "..."
 *   }
 *
 * `interface/diplomacy_view.gui:1464-1490` (both), `interface/databank_window.gui:205-216`
 * (`expandButton`), `interface/customize_species_editors.gui:2381-2399` (`expandedWindow`).
 *
 * The BODY is the named kind's body, so the model carries these as ordinary child nodes with
 * `asField` set; the emitter writes `asField` where it would otherwise write the kind's keyword.
 * Without this, `blockToNode` filed them as opaque `subBlocks` and the emitter wrote
 * `expandedWindow = { }` - an EMPTY body, i.e. every dropdown's list silently disappeared.
 */
export const AS_FIELD_ELEMENT_KINDS = {
  expandedwindow: { kind: 'container', canonical: 'expandedWindow' },
  expandbutton: { kind: 'guiButton', canonical: 'expandButton' },
};

/**
 * The kind of an element block whose key is a field name, or null.
 * @param {string} key
 * @returns {{kind: string, canonical: string}|null}
 */
export function asFieldElementKind(key) {
  if (!key) return null;
  return AS_FIELD_ELEMENT_KINDS[String(key).toLowerCase()] ?? null;
}

/** Is this container filled by the engine rather than by its own `.gui` children? */
export function isEnginePopulated(kindOrSpec) {
  const spec = typeof kindOrSpec === 'string' ? kindSpec(kindOrSpec) : kindOrSpec;
  return spec ? ENGINE_POPULATED_KINDS.has(spec.kind) : false;
}

/** Kinds the emitter can write today. COMPONENTS are excluded: they are expanded into real
 * elements by `computeLayout` before the emitter runs, so "the emitter writes `bar`" would be
 * false - it writes the containers and text a bar becomes. */
export function emittableKinds() {
  return ELEMENT_KINDS.filter((spec) => spec.emitter && !spec.component).map((spec) => spec.kind);
}

/**
 * The COMPONENTS: model constructs with no engine keyword, which `computeLayout` expands into real
 * elements (`src/lib/components.mjs`). Exported so the census, the docs generator and the tests can
 * tell them apart from the kinds the engine's own parsers define.
 */
export function componentKinds() {
  return ELEMENT_KINDS.filter((spec) => spec.component).map((spec) => spec.kind);
}

/**
 * The size form a kind uses, and which sub-keys are legal inside `size`.
 *
 * `accepted` means "this kind's parser accepts a `size` BLOCK" - which is false for text (it
 * takes `maxWidth`/`maxHeight` instead) and for icon (it takes nothing). `hasSize` says whether
 * the kind is sized at all, by any spelling.
 *
 * @param {object|string} specOrName a kind spec (preferred) or a kind/keyword name
 * @param {string} [keyword] the keyword that will be written, when a kind varies by keyword
 * @returns {{form: string, keys: string[], accepted: boolean, hasSize: boolean}}
 */
export function sizeFormFor(specOrName, keyword) {
  const spec = typeof specOrName === 'string' ? kindSpec(specOrName) : specOrName;
  if (!spec) return { form: SIZE_FORMS.widthHeight, keys: ['width', 'height'], accepted: true, hasSize: true };
  const form = (keyword && spec.sizeFormByKeyword?.[keyword]) ?? spec.sizeForm ?? SIZE_FORMS.widthHeight;
  if (form === SIZE_FORMS.widthHeight) return { form, keys: ['width', 'height'], accepted: true, hasSize: true };
  if (form === SIZE_FORMS.xY) return { form, keys: ['x', 'y'], accepted: true, hasSize: true };
  if (form === SIZE_FORMS.maxWidthHeight) return { form, keys: ['maxWidth', 'maxHeight'], accepted: false, hasSize: true };
  return { form: SIZE_FORMS.none, keys: [], accepted: false, hasSize: false };
}

/** Table-driven field lookup used by the validator to build suggestions. */
export function suggestFields(input) {
  const lowered = String(input).toLowerCase().replace(/[^a-z0-9_]/g, '');
  const all = new Set();
  for (const spec of ELEMENT_KINDS) for (const field of Object.keys(spec.fields)) all.add(field);
  return [...all]
    .map((field) => ({ field, distance: editDistance(lowered, field.toLowerCase()) }))
    .filter((entry) => entry.distance <= 3)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map((entry) => entry.field);
}

function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = Array.from({ length: rows }, (_, row) => [row, ...new Array(cols - 1).fill(0)]);
  for (let col = 0; col < cols; col += 1) table[0][col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      table[row][col] = Math.min(table[row - 1][col] + 1, table[row][col - 1] + 1, table[row - 1][col - 1] + cost);
    }
  }
  return table[rows - 1][cols - 1];
}

export default {
  FIELD_TYPES,
  SIZE_FORMS,
  ELEMENT_KINDS,
  BACKGROUND_FIELDS,
  ENGINE_REJECTED_FIELDS,
  KIND_REJECTED_FIELDS,
  UNMODELLED_CORPUS_FIELDS,
  ENGINE_POPULATED_KINDS,
  AS_FIELD_ELEMENT_KINDS,
  ANCHORS,
  ORIENTATION_VALUES,
  ORIGO_VALUES,
  normaliseAnchor,
  kindSpec,
  kindSpecByKeyword,
  asFieldElementKind,
  isEnginePopulated,
  knownKeywords,
  emittableKinds,
  componentKinds,
  sizeFormFor,
  suggestFields,
  canonicalFieldName,
  kindAcceptsField,
  kindsAcceptingField,
  isKnownField,
  isEngineRejectedField,
  kindRejectedFieldNote,
  isFieldRejectedForKind,
  isKindRejectedFieldName,
  isUnmodelledCorpusField,
  equivalentForKind,
  FIELD_EQUIVALENTS,
  translateFieldForKind,
};
