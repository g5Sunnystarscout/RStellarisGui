//------------------------------------------------------------------------------------
// components.mjs -- Part of RStellarisGui
//
// THE BAR. A `kind: 'bar'` component that expands into the EXACT construction the working mod's
// power-projection ranking bars use, field for field.
//
// THIS IS A CLONING PROBLEM, NOT A DESIGN PROBLEM
//
// A bar is not an engine element. There is no `bar` window keyword and no bar window element kind
// anywhere in the install. The complete set of block keywords that can appear inside a `.gui` file's
// `guiTypes` block, measured over all 177 of Stellaris 4.4.6's own `.gui` files, is
//
//   background  borderSize  buttonType  checkboxType  containerWindowType  cursor
//   default_ime_text_color  dropDownBoxType  editBoxType  effectbuttonType  expandButton
//   expandedWindow  extendedScrollbarType  gridBoxType  guiButtonType  guiTypes  hide_position
//   iconType  if_resolution  if_scaled_resolution  instantTextBoxType  listBoxType  margin  offset
//   OverlappingElementsBoxType  overlay  padding  pdx_tooltip_anchor_offset  position  positionType
//   scrollbartype  show_position  size  slider  slotSize  smoothListBoxType  spinnerType  text_offset
//   textboxType  track  windowType
//
// (`slider`, `track`, `overlay`, `cursor`, `size`, `position`, `borderSize`, `margin`, `padding`,
// `offset`, `slotSize`, `show_position`, `hide_position`, `pdx_tooltip_anchor_offset` and
// `text_offset` are SUB-BLOCKS; `guiTypes` is the file root.) None of them is a bar.
//
// `progressbarType` / `progressbartype` / `progressBarType` - the three spellings the engine's
// `.gfx` parser accepts - occur 195 times in the install, and EVERY one is inside a `.gfx` file.
// Measured: 0 occurrences in any of the 177 `.gui` files or in any `.txt` (a search of
// `interface/**/*.gui` and `interface/**/*.txt` returns nothing). Vanilla's 25 `progress_bar`
// elements are `iconType`s drawing an engine-driven `progressBarType` sprite, named by the engine
// and filled with engine state (`interface/anomaly_view.gui:339-343`, `archaeology_view.gui:365`,
// `astral_rift_view.gui:345`). A sprite kind is not a window element: a mod cannot ask for one for
// an arbitrary value, and there is no `bar = { }` block to write.
//
// So every bar is DRAWN, and the only thing that makes a drawn bar read as a bar is the
// construction. The construction is not invented here: it is TRANSCRIBED from the six ranking bars
// that already work, at
//
//   <mods>\geocentric_origin\interface\zz_geocentric_unga.gui
//   rows 0-5, :228-384 (row 0) and :311-384 (row 1), each row five siblings
//
// transcribed again as data in `REFERENCE_BAND_ELEMENTS` (every field of every element of the whole
// `unga_chart_main` subtree, with its exact source line range) and in `REFERENCE_RANKING_ROW` (one
// row, the spec the expansion is written against). `scripts/selftest.mjs` asserts three things, and
// the third is what makes the other two mean something:
//
//   * "the bar component clones the reference construction, field for field" - the expansion of a
//     bar built from the reference's own numbers is field-identical to the transcription;
//   * "the bar transcription still matches the file it was read from" - EVERY line range and EVERY
//     literal in the transcription is re-read from the mod file and compared, so a fabricated entry
//     (which an earlier revision of this module had: two `unga_att_*_value_nato` elements that do
//     not exist anywhere in the file, at line ranges that hold something else) fails the suite;
//   * "the bar expansion refuses to be gutted" - the emitted text must contain the track's tile
//     sprite, the fill's white tile, the inset arithmetic, the five element kinds and the label's
//     font; blanking any one of them makes the test fail.
//
// THE ELEMENTS, AND WHY EACH ONE IS THERE
//
// The reference row is FIVE SIBLINGS - nothing is nested:
//
//   1. `instantTextBoxType`  the row's NAME,  left-aligned, `maxWidth = 202 maxHeight = 18`, at y = -2
//   2. `containerWindowType` the TRACK: 400x20, `background.quadTextureSprite = GFX_tiles_dark_area_cut_8`
//   3. `containerWindowType` the FILL: +2,+2 relative to the track, 12 tall (= track height - 4),
//      `background.quadTextureSprite = gfx_transparency_white`
//   4. `instantTextBoxType`  the VALUE, right-aligned, `maxWidth = 70 maxHeight = 18`, at y = -2
//   5. `instantTextBoxType`  the SEATS, right-aligned, `maxWidth = 118 maxHeight = 18`, at y = -2
//
// WHAT MAKES IT READ AS A BAR AND NOT AS A TINTED BOX. The fill is INSET 2 px on all four sides, so
// the track's own dark background remains visible around it as a border; and the two elements carry
// DIFFERENT sprites (a dark 9-slice tile under a white 3x3 tile). Both parts are load-bearing.
//
// THE CONSTRAINT THIS PRIMITIVE ENCODES: THE LENGTH IS STATIC, THE NUMBER IS LIVE
//
// The fill's length is `size.width` - a layout number the engine reads once, at load time. The only
// measured live-TEXT channel inside a `custom_gui` window is `effectbuttonType.buttonText`
// (localisation -> common/scripted_loc -> common/script_values, which is how every live figure in
// the working mod reaches the screen). A bracket data function in PAINTED text renders LITERALLY
// (measured, docs/gui-pitfalls.md section 11). TEXT CANNOT MOVE A RECTANGLE, so:
//
//   * the fill width is DERIVED from `value / max` and written as a PIXEL NUMBER. There is no way
//     to ask for a live fill, and no `100%`/`@var` form for it: a percentage there is a fraction of
//     the TRACK and would silently break the inset invariant.
//   * `value > max` is REFUSED, not clamped silently. The reference itself has one such row - the
//     rank-0 fill at :257-271 is 400 px wide inside a 400 px track at x = 242, a 4 px overhang over
//     the track's right border, while every other ranking fill respects the 396 px cap. Copying the
//     defect is not cloning.
//   * the live NUMBER, when asked for, becomes an `effectbuttonType` with `buttonText` - and
//     `labelEffect`/`effect` are the field names that say so.
//   * `trackColour`/`fillColour` do not exist. A container has no colour field (the engine tints
//     TEXT through `text_color_code`, and a `spriteType` may name an `effectFile` shader; a window
//     element has neither). Rather than accept a hex string and drop it, `bar-colour-not-exist`
//     refuses it and names the two things that do work.
//
// This program is free software: you can redistribute it and/or modify it under the terms of
// the GNU Affero General Public License as published by the Free Software Foundation, either
// version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

/** The file every measurement in this module was read from. Read-only evidence; never written. */
export const REFERENCE_FILE = '<mods>\\geocentric_origin\\interface\\zz_geocentric_unga.gui';

/**
 * THE TRANSCRIPTION of the whole `unga_chart_main` subtree: every element, every field, every
 * source line range. This is the specification, and `scripts/selftest.mjs` re-reads the file and
 * checks every line range and every literal in it, so it cannot drift and cannot be invented.
 *
 * `lines` are inclusive 1-based line numbers of the element's `keyword = {` line through its closing
 * `}`. `fields` is every field the element carries, verbatim; `nested` records the fields of a
 * sub-block (a `background`, a `position`, a `size`), because those are part of the construction
 * too. `extra` records the fields this plugin's model does not carry for the kind, so the table is
 * complete even where the emitter would normalise something away.
 */
export const REFERENCE_BAND_ELEMENTS = [
  {
    role: 'band',
    keyword: 'containerWindowType',
    name: 'unga_chart_main',
    lines: [190, 203],
    fields: { position: { x: 228, y: 160 }, size: { width: 868, height: 312 } },
    background: { name: 'unga_chart_main_bg', quadTextureSprite: 'GFX_tiles_dark_area_cut_8' },
    note: 'the band the six rows live in. Its own background is the same dark 9-slice tile the tracks use.',
  },
  {
    role: 'heading',
    keyword: 'instantTextBoxType',
    name: 'unga_chart_rank_caption_main',
    lines: [204, 218],
    fields: {
      position: { x: 22, y: 8 },
      maxWidth: 420,
      maxHeight: 24,
      alwaysTransparent: true,
      font: 'malgun_goth_24',
      text: 'unga_chart_rank_caption',
      fixedSize: true,
      format: 'left',
      text_color_code: 'W',
    },
    note: "the heading over the NAME column, not over the track. It starts at x = 22 where the name column starts, which is why a track that starts at the band's left edge is misaligned against it.",
  },
  {
    role: 'legend',
    keyword: 'iconType',
    name: 'unga_leg_0_main',
    lines: [219, 227],
    fields: { position: { x: 22, y: 42 }, alwaysTransparent: true, spriteType: 'GFX_unga_neutral_marker' },
    note: 'the first of six legend markers, one per row, in the NAME column at x = 22. Not part of a bar; recorded because it is in the subtree.',
  },
  {
    role: 'name',
    keyword: 'instantTextBoxType',
    name: 'unga_power_name_0_main',
    lines: [228, 241],
    fields: {
      position: { x: 26, y: 40 },
      maxWidth: 202,
      maxHeight: 18,
      alwaysTransparent: true,
      font: 'cg_16b',
      text: 'unga_faction_earth',
      fixedSize: true,
      format: 'left',
    },
    note: 'the row label. `maxHeight = 18` with the track 20 tall at y = 42 puts the text 2 px ABOVE the track top (y = 40).',
  },
  {
    role: 'track',
    keyword: 'containerWindowType',
    name: 'unga_power_track_0_main',
    lines: [242, 256],
    fields: { position: { x: 240, y: 42 }, size: { width: 400, height: 20 } },
    background: { name: 'bg', quadTextureSprite: 'GFX_tiles_dark_area_cut_8' },
  },
  {
    role: 'fill',
    keyword: 'containerWindowType',
    name: 'unga_power_fill_0_main',
    lines: [257, 271],
    fields: { position: { x: 242, y: 46 }, size: { width: 400, height: 12 } },
    background: { name: 'bg', quadTextureSprite: 'gfx_transparency_white' },
    note: 'THE DEFECT. A 400 px fill inside a 400 px track at +2 leaves a 4 px overhang over the track\'s right border. Every other row caps at 396. Reported by `bar-fill-overflows-track`, never reproduced.',
  },
  {
    role: 'value',
    keyword: 'instantTextBoxType',
    name: 'unga_power_value_0_main',
    lines: [272, 286],
    fields: {
      position: { x: 646, y: 40 },
      maxWidth: 70,
      maxHeight: 18,
      alwaysTransparent: true,
      font: 'cg_16b',
      text: 'unga_power_value_1',
      fixedSize: true,
      format: 'right',
      text_color_code: 'Y',
    },
  },
  {
    role: 'seats',
    keyword: 'instantTextBoxType',
    name: 'unga_power_seats_0_main',
    lines: [287, 301],
    fields: {
      position: { x: 728, y: 40 },
      maxWidth: 118,
      maxHeight: 18,
      alwaysTransparent: true,
      font: 'cg_16b',
      text: 'unga_power_seats_1',
      fixedSize: true,
      format: 'right',
      text_color_code: 'E',
    },
  },
];

/** The `i`th row of the ranking band, read from the file: five siblings at their own y. */
export const REFERENCE_ROWS = [
  { row: 0, legend: 'unga_leg_0_main', name: 'unga_power_name_0_main', track: 'unga_power_track_0_main', fill: 'unga_power_fill_0_main', value: 'unga_power_value_0_main', seats: 'unga_power_seats_0_main', nameLines: [228, 241], trackLines: [242, 256], fillLines: [257, 271], valueLines: [272, 286], seatsLines: [287, 301], y: { name: 40, track: 42, fill: 46, value: 40, seats: 40 }, fillWidth: 400, proportionality: 'DEFECT: a 400 px fill in a 400 px track - 4 px over the border' },
  { row: 1, legend: 'unga_leg_1_main', name: 'unga_power_name_1_main', track: 'unga_power_track_1_main', fill: 'unga_power_fill_1_main', value: 'unga_power_value_1_main', seats: 'unga_power_seats_1_main', nameLines: [311, 324], trackLines: [325, 339], fillLines: [340, 354], valueLines: [355, 369], seatsLines: [370, 384], y: { name: 64, track: 66, fill: 70, value: 64, seats: 64 }, fillWidth: 383 },
  { row: 2, legend: 'unga_leg_2_main', name: 'unga_power_name_2_main', track: 'unga_power_track_2_main', fill: 'unga_power_fill_2_main', value: 'unga_power_value_2_main', seats: 'unga_power_seats_2_main', nameLines: [394, 407], trackLines: [408, 423], fillLines: [424, 438], valueLines: [439, 453], seatsLines: [454, 468], y: { name: 88, track: 90, fill: 94, value: 88, seats: 88 }, fillWidth: 350 },
  { row: 3, legend: 'unga_leg_3_main', name: 'unga_power_name_3_main', track: 'unga_power_track_3_main', fill: 'unga_power_fill_3_main', value: 'unga_power_value_3_main', seats: 'unga_power_seats_3_main', nameLines: [477, 491], trackLines: [492, 506], fillLines: [507, 521], valueLines: [522, 536], seatsLines: [537, 551], y: { name: 112, track: 114, fill: 118, value: 112, seats: 112 }, fillWidth: 233 },
  { row: 4, legend: 'unga_leg_4_main', name: 'unga_power_name_4_main', track: 'unga_power_track_4_main', fill: 'unga_power_fill_4_main', value: 'unga_power_value_4_main', seats: 'unga_power_seats_4_main', nameLines: [560, 574], trackLines: [575, 589], fillLines: [590, 604], valueLines: [605, 619], seatsLines: [620, 634], y: { name: 136, track: 138, fill: 142, value: 136, seats: 136 }, fillWidth: 183 },
  { row: 5, legend: 'unga_leg_5_main', name: 'unga_power_name_5_main', track: 'unga_power_track_5_main', fill: 'unga_power_fill_5_main', value: 'unga_power_value_5_main', seats: 'unga_power_seats_5_main', nameLines: [643, 657], trackLines: [658, 672], fillLines: [673, 687], valueLines: [688, 702], seatsLines: [703, 717], y: { name: 160, track: 162, fill: 166, value: 160, seats: 160 }, fillWidth: 150 },
];

/**
 * ONE ROW OF THE REFERENCE, as the spec the expansion is written against.
 *
 * The four elements the primitive reproduces, in the reference's own field shape. `parent` and
 * `rowSpacing` describe the band; `secondUses` and `thirdUse` are the same construction measured
 * again elsewhere in the same file, which is what makes it the project's idiom rather than one
 * author's accident. `defect` is the one row that breaks the invariant - reported, not copied.
 */
export const REFERENCE_RANKING_ROW = {
  file: REFERENCE_FILE,
  /** The container the five siblings live in, and its own fields. */
  parent: { name: 'unga_chart_main', kind: 'container', lines: '190-203', position: { x: 228, y: 160 }, size: { width: 868, height: 312 }, background: { name: 'unga_chart_main_bg', quadTextureSprite: 'GFX_tiles_dark_area_cut_8' } },
  /** The heading over the NAME column, which the tracks are NOT aligned to (`unga_chart_rank_caption_main`). */
  heading: { name: 'unga_chart_rank_caption_main', kind: 'text', lines: '204-218', position: { x: 22, y: 8 }, maxWidth: 420, maxHeight: 24, format: 'left' },
  /** The y step between consecutive rows: track rows 0..5 are at y = 42, 66, 90, 114, 138, 162. */
  rowSpacing: 24,
  /** Every row of the band, so the primitive can be checked against all six, not just one. */
  rows: REFERENCE_ROWS,
  /**
   * The five elements of row 1, the row the primitive is asserted against. Row 0 is the same with
   * its own y (40/42/46) and the fill defect; rows 2-5 differ only in y and fill width.
   */
  elements: [
    {
      role: 'name',
      kind: 'text',
      keyword: 'instantTextBoxType',
      name: 'unga_power_name_1_main',
      lines: '311-324',
      fields: {
        position: { x: 26, y: 64 },
        maxWidth: 202,
        maxHeight: 18,
        alwaysTransparent: true,
        font: 'cg_16b',
        text: 'unga_faction_nato',
        fixedSize: true,
        format: 'left',
      },
      /** Fields the emitter does not model, kept so the transcription is complete. */
      unmodelled: {},
    },
    {
      role: 'track',
      kind: 'container',
      keyword: 'containerWindowType',
      name: 'unga_power_track_1_main',
      lines: '325-339',
      fields: {
        position: { x: 240, y: 66 },
        size: { width: 400, height: 20 },
        background: { name: 'bg', quadTextureSprite: 'GFX_tiles_dark_area_cut_8' },
      },
      unmodelled: {},
    },
    {
      role: 'fill',
      kind: 'container',
      keyword: 'containerWindowType',
      name: 'unga_power_fill_1_main',
      lines: '340-354',
      fields: {
        position: { x: 242, y: 70 },
        size: { width: 383, height: 12 },
        background: { name: 'bg', quadTextureSprite: 'gfx_transparency_white' },
      },
      unmodelled: {},
    },
    {
      role: 'value',
      kind: 'text',
      keyword: 'instantTextBoxType',
      name: 'unga_power_value_1_main',
      lines: '355-369',
      fields: {
        position: { x: 646, y: 64 },
        maxWidth: 70,
        maxHeight: 18,
        alwaysTransparent: true,
        font: 'cg_16b',
        text: 'unga_power_value_2',
        fixedSize: true,
        format: 'right',
        text_color_code: 'Y',
      },
      unmodelled: {},
    },
    {
      role: 'seats',
      kind: 'text',
      keyword: 'instantTextBoxType',
      name: 'unga_power_seats_1_main',
      lines: '370-384',
      fields: {
        position: { x: 728, y: 64 },
        maxWidth: 118,
        maxHeight: 18,
        alwaysTransparent: true,
        font: 'cg_16b',
        text: 'unga_power_seats_2',
        fixedSize: true,
        format: 'right',
        text_color_code: 'E',
      },
      unmodelled: {},
    },
  ],
  /**
   * The same construction measured again in the same file, with the exact line ranges this time.
   * Both respect the inset: track height 18, fill height 14, fill at +2/+4 and +2/+2.
   */
  secondUses: [
    {
      what: 'vote tally',
      trackName: 'unga_tally_yes_track_main',
      fillName: 'unga_tally_yes_fill_main',
      trackLines: '853-867',
      fillLines: '868-882',
      track: { width: 400, height: 18, sprite: 'GFX_tiles_dark_area_cut_8' },
      fill: { inset: { x: 2, y: 4 }, size: { width: 248, height: 14 }, sprite: 'gfx_transparency_white' },
    },
    {
      what: 'bloc standing (the AU window)',
      trackName: 'unga_bloc_track_bg_au',
      fillName: 'unga_bloc_track_fill_au',
      trackLines: '5802-5816',
      fillLines: '5817-5831',
      track: { width: 1116, height: 18, sprite: 'GFX_tiles_dark_area_cut_8' },
      fill: { inset: { x: 2, y: 2 }, size: { width: 801, height: 14 }, sprite: 'gfx_transparency_white' },
    },
  ],
  /**
   * A third use, at full width. Same two sprites, same 2 px inset - which is what makes the inset
   * an invariant rather than a coincidence of one band.
   */
  thirdUse: {
    what: 'bloc standing (the NATO window)',
    trackName: 'unga_bloc_track_bg_nato',
    fillName: 'unga_bloc_track_fill_nato',
    trackLines: '2853-2867',
    fillLines: '2868-2882',
    track: { width: 1116, height: 18, sprite: 'GFX_tiles_dark_area_cut_8' },
    fill: { inset: { x: 2, y: 2 }, size: { width: 712, height: 14 }, sprite: 'gfx_transparency_white' },
  },
  /** The row that does NOT respect the inset invariant. Reported, not copied. */
  defect: {
    role: 'fill',
    name: 'unga_power_fill_0_main',
    lines: '257-271',
    trackAt: { x: 240, width: 400 },
    fillAt: { x: 242, width: 400 },
    cap: 396,
    overhang: 4,
    note:
      "the rank-0 fill is 400 px wide inside a 400 px track at x = 242, so it paints 4 px over the track's right " +
      'border and the inset invariant is broken. Every other row caps at 396. The primitive REFUSES this rather than ' +
      'reproducing it.',
  },
  /**
   * There is NO sprite-less counter-example in this file, and an earlier revision of this module
   * claimed one: `unga_att_un_value_nato` and `unga_att_stab_value_nato`, "at :3236-3264 and
   * :3283-3311". Neither name occurs anywhere in `zz_geocentric_unga.gui` (measured: 0 matches for
   * `unga_att`), and those line ranges hold `leader_details`/`empire_traits_box` (a 210x28
   * container with a `GFX_tiles_dark_area_cut_8` background) and `opinion_window` respectively. The
   * names were invented. The structural claim they were there to support - that a fill and a track
   * with no sprite paint nothing - is true of the ENGINE (a container's `background` needs a
   * `spriteType`/`quadTextureSprite` to draw anything) but was NOT measured in this file, so this
   * module states it as engine knowledge and not as a transcription.
   *
   * What the file does contain is the positive form of the same fact: 142 `containerWindowType`
   * elements, of which exactly 6 have no sprite at all, and all 6 are parked `EVENT_DIPLO`
   * containers at @16,128 (one per window). No drawing container in the file lacks a sprite.
   */
  noSpriteContainers: {
    measured: '142 containerWindowType elements in zz_geocentric_unga.gui; 6 carry no spriteType/quadTextureSprite',
    theSix: ['EVENT_DIPLO @16,128 200x630 (lines 2380, 3363, 4346, 5329, 6312, 7295)'],
    note: 'all six are parked event containers, not drawing elements. The engine draws a background only when the background names a sprite.',
  },
  /** The install's own definitions of the two sprites, so neither is a mod-local invention. */
  sprites: {
    track: { name: 'GFX_tiles_dark_area_cut_8', kind: 'corneredTileSpriteType', definedAt: '<Stellaris>\\interface\\fleet_view.gfx:2824-2830', borderSize: { x: 8, y: 8 } },
    fill: { name: 'gfx_transparency_white', kind: 'corneredTileSpriteType', definedAt: '<Stellaris>\\interface\\core.gfx:119-124', size: { x: 3, y: 3 }, borderSize: { x: 1, y: 1 } },
  },
  /**
   * The install's counter-example to a "progress bar" HOPE. Vanilla's `progress_bar` elements are
   * `iconType`s drawing an engine-driven `progressBarType` sprite, named by the engine and filled
   * with engine state. Not available to a mod for an arbitrary value.
   */
  engineBarIsAnIcon: { file: '<Stellaris>\\interface\\anomaly_view.gui', lines: '339-343', uses: 25, note: 'progressBarType occurs 195 times in the install and only inside .gfx files' },
};

/** Kept as the name the first revision of this module used; the transcription is the authority. */
export const BAR_CONSTRUCTION = REFERENCE_RANKING_ROW;

/**
 * FIELDS THE PLUGIN ADDS, which are therefore allowed to differ from the transcription - and the
 * only thing that is. Everything here is engine-level behaviour of this emitter, not of the bar:
 *
 *   `orientation`  - `emit.mjs` writes `orientation = upper_left` with every declared position
 *                    (`chooseOrientationFor` + `writePair`), because the engine literal it computes
 *                    is measured against that anchor. The reference does not write it and does not
 *                    need to: `upper_left` is the engine's default. Position-identical.
 *   `id`, `component`, `componentOf`, `componentLive`, `barGeometry` - model plumbing, filtered out
 *                    of the emitted file by `NON_FIELD_KEYS`.
 *
 * The field-identity assertion subtracts exactly this set, so it cannot quietly widen.
 */
export const BAR_EMIT_ADDITIONS = ['orientation', 'id', 'component', 'componentOf', 'componentLive', 'barGeometry', 'headingName', 'role'];

/** The palette a `track` / `fill` field may name, with the install line each comes from. */
export const BAR_SPRITE_PALETTE = {
  track: { name: 'GFX_tiles_dark_area_cut_8', label: 'dark inset 9-slice tile', kind: 'corneredTileSpriteType', evidence: 'fleet_view.gfx:2824-2830; the reference track background' },
  trackSolid: { name: 'GFX_subwindow_tile_plain_solid', label: 'flat solid tile', kind: 'corneredTileSpriteType', evidence: 'the mod uses GFX_subwindow_tile_plain_solid_separator at :5847 for a 1 px rule' },
  fill: { name: 'gfx_transparency_white', label: 'white 3x3 tile', kind: 'corneredTileSpriteType', evidence: 'core.gfx:119-124; the reference fill background' },
};

const PALETTE_ALIASES = {
  track: BAR_SPRITE_PALETTE.track.name,
  dark: BAR_SPRITE_PALETTE.track.name,
  inset: BAR_SPRITE_PALETTE.track.name,
  solid: BAR_SPRITE_PALETTE.trackSolid.name,
  fill: BAR_SPRITE_PALETTE.fill.name,
  white: BAR_SPRITE_PALETTE.fill.name,
  tint: BAR_SPRITE_PALETTE.fill.name,
};

/**
 * Rules the bar primitive enforces, with stable ids, in the style of `RULE_SEVERITY` in
 * validate.mjs (which folds these in, so the README's generated rule table carries them).
 */
export const COMPONENT_RULE_SEVERITY = {
  'bar-fill-overflows-track': 'error',
  'bar-track-width-not-static': 'error',
  'bar-track-height-not-static': 'error',
  'bar-proportion-invalid': 'error',
  'bar-frame-too-small': 'error',
  'bar-label-effect-missing': 'error',
  'bar-colour-not-exist': 'error',
  'bar-clone-source-missing': 'error',
  'bar-label-overflows-track': 'warning',
  'bar-label-too-wide': 'warning',
  'bar-track-misaligned-with-heading': 'warning',
  'bar-label-not-offered-as-button': 'info',
};

export const COMPONENT_RULE_DESCRIPTIONS = {
  'bar-fill-overflows-track':
    "the bar's `value` exceeds its `max`, so the fill would be longer than the track less its inset. REFUSED and clamped, never reproduced: the reference itself has one such row (a 400 px fill in a 400 px track, :257-271), and copying it is not cloning",
  'bar-track-width-not-static':
    "a bar's track width is not a plain pixel number. The fill's length is derived from it and written into the file as a literal, so the track has to be a size this plugin can resolve statically",
  'bar-track-height-not-static': "a bar's track height is not a plain pixel number, so the fill inset cannot be subtracted from it",
  'bar-proportion-invalid': '`value` / `max` is not a finite pair with `max > 0`, so the fill length is undefined',
  'bar-frame-too-small': 'the declared bar `width`/`height` leaves no room for the track plus the value column and the label, so no legal construction exists inside it',
  'bar-label-effect-missing':
    'the scripted label channel was asked for (`labelEffect`/`effect`) but the other half of the pair is missing, so the button would carry no script or no text',
  'bar-colour-not-exist':
    '`trackColour` / `fillColour`: a `.gui` container has NO colour field. The two things that do work are a different tile sprite (`track`/`fill`) or the sprite\'s own `effectFile` shader - a hex colour cannot be written and is refused rather than dropped',
  'bar-clone-source-missing':
    '`cloneOf` names a bar that is not in the tree (or not above this one), so there is nothing to clone. The source must be a `kind: "bar"` node that appears EARLIER in document order',
  'bar-label-overflows-track':
    "the bar's label needs more room than the bar gives it (vertically for an inside label, or than the column a left/right label was allotted)",
  'bar-label-too-wide': "the label's measured text is wider than the box the bar gave it, so the engine would wrap or clip it inside a bar",
  'bar-track-misaligned-with-heading':
    "the bar's track does not start at the same x as the heading that labels its column, so the column reads as broken",
  'bar-label-not-offered-as-button':
    'this bar shows a static label while the only measured live-text channel inside a custom_gui window is `effectbuttonType.buttonText`; pass `effect` (and `labelEffect`) if the number should be live',
};

/** Defaults, every one of them the reference's own number. */
export const BAR_DEFAULTS = {
  /** `unga_power_track_N_main` is 400x20 (zz_geocentric_unga.gui:242-256, :325-339). */
  width: 400,
  /** The reference track height. */
  height: 20,
  /** The reference fill inset: fill at +2,+2 with the track 20 tall and the fill 12 tall. */
  inset: 2,
  /**
   * THE FILL'S HEIGHT AS A LINE THROUGH THE TWO MEASURED CASES, `fillSlope * trackHeight + fillBase`.
   * The two cases in this file are a 20 px track with a 12 px fill (the six ranking rows) and an
   * 18 px track with a 14 px fill (the vote tally and both bloc bars), which solve to -1 and 32.
   * The slope is negative because a taller track carries a proportionally shorter fill: the track's
   * 8 px nine-slice border is what the fill has to stay out of.
   */
  fillSlope: -1,
  fillBase: 32,
  /** The reference label font: every row's text is `cg_16b`. */
  font: 'cg_16b',
  /** What a bare `value` means when `max` is omitted: a percentage. */
  max: 100,
  /**
   * The reference's row columns, which the defaults reproduce exactly: the name column is
   * `maxWidth = 202` at x = 26 with the track at x = 240 (gap 12); the value column is
   * `maxWidth = 70` at x = 646, 6 px right of the track's right edge 640; the seats column is
   * `maxWidth = 118` at x = 728, 12 px right of the value's right edge 716.
   */
  rowLabelWidth: 202,
  rowLabelGap: 12,
  valueWidth: 70,
  valueGap: 6,
  seatsWidth: 118,
  seatsGap: 12,
  /** The reference's text columns are 18 px tall in a 20 px track: 2 px ABOVE the track's top. */
  textOverlap: 2,
  /** A `left`/`right` label's column when `labelWidth` is not declared. */
  labelWidth: 120,
  /** Gap between the track and a row/column label. */
  labelGap: 2,
  /** How far above a track its column's heading may sit and still be that column's heading. */
  headingGap: 40,
  /** How far apart the heading's x and the track's x may be before the column reads as broken. */
  headingTolerance: 1,
};

/** Is this node a bar component (as opposed to an already-expanded element)? */
export function isBarNode(node) {
  return Boolean(node) && String(node.kind ?? node.type ?? '').toLowerCase() === 'bar';
}

/**
 * The name a bar's element takes, in the working mod's own convention. The reference's row is named
 * `unga_power_1_main` and its five elements are `unga_power_NAME_1_main`, `unga_power_TRACK_1_main`,
 * `unga_power_FILL_1_main`, `unga_power_VALUE_1_main` and `unga_power_SEATS_1_main` - the role goes
 * in the MIDDLE, between the element's stem and its row index. That is not cosmetic: it keeps the
 * row index in the same place in every name, which is what makes a clone's names sort and read
 * together, and it is the form every ranking row, the tally and both bloc bars use.
 *
 *   `unga_power_1_main` + `track` -> `unga_power_track_1_main`
 *   `unga_bloc_track`   + `fill`  -> `unga_bloc_track_fill`
 *   `mybar`             + `value` -> `mybar_value`
 *
 * @param {string} base the bar node's own name
 * @param {string} role `name`, `track`, `fill`, `value`, `seats` or `label`
 */
export function barElementName(base, role) {
  const stem = String(base ?? 'bar');
  const indexed = /^(.*?)_([0-9]+)(_[A-Za-z0-9]+)$/.exec(stem);
  if (indexed) return `${indexed[1]}_${role}_${indexed[2]}${indexed[3]}`;
  return `${stem}_${role}`;
}

/** Resolve a `track` / `fill` field: a palette alias, or the sprite name as written. */
export function resolveBarSprite(value, fallback) {
  const paletteNameFor = (sprite) => Object.entries(BAR_SPRITE_PALETTE).find(([, entry]) => entry.name === sprite)?.[0] ?? null;
  if (value === undefined || value === null || value === '') {
    const entry = paletteNameFor(fallback);
    return { sprite: fallback, paletteName: entry, fromPalette: entry !== null };
  }
  const key = String(value).trim();
  const alias = PALETTE_ALIASES[key.toLowerCase()];
  const sprite = alias ?? key;
  return { sprite, paletteName: alias ? paletteNameFor(alias) : null, fromPalette: Boolean(alias) };
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (text === '' || !/^-?[0-9]+(\.[0-9]+)?$/.test(text)) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

/** A plain non-negative integer the emitter can write verbatim, or null. */
function staticPixel(value) {
  const numeric = finiteNumber(value);
  if (numeric === null) return null;
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

const LABEL_SIDES = ['inside', 'above', 'below', 'left', 'right', 'none'];

/** Field names a bar takes as INPUTS, never as emitted fields. */
export const BAR_FIELD_NAMES = [
  'width',
  'height',
  'value',
  'valueText',
  'max',
  'inset',
  'label',
  'labelSide',
  'labelWidth',
  'labelGap',
  'labelEffect',
  'effect',
  'track',
  'trackSprite',
  'fill',
  'fillSprite',
  'trackColour',
  'fillColour',
  'rowLabel',
  'rowLabelWidth',
  'rowLabelGap',
  'rowLabelColour',
  'valueWidth',
  'valueGap',
  'valueColour',
  'seats',
  'seatsWidth',
  'seatsGap',
  'seatsColour',
  'headingName',
  'cloneOf',
  'font',
  'buttonFont',
  'text_color_code',
];

/**
 * The `text_color_code` key each column reads. The key is named for the ROLE, not for the field
 * that carries the text: the value column's text is `valueText` (because `value` is the bar's own
 * proportion), but its colour is `valueColour`, and a caller who wrote `valueTextColour` would
 * silently lose the colour. Both spellings are accepted, the role's own first.
 */
const COLUMN_COLOUR_KEYS = {
  rowLabel: ['rowLabelColour', 'rowLabelColor', 'nameColour', 'nameColor'],
  valueText: ['valueColour', 'valueColor', 'valueTextColour', 'valueTextColor'],
  seats: ['seatsColour', 'seatsColor'],
};

/** The first colour code a bar node declares for a column, or null. */
function columnColour(node, field) {
  for (const key of COLUMN_COLOUR_KEYS[field] ?? [`${field}Colour`, `${field}Color`]) {
    const value = node[key];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return null;
}

/**
 * The two names a column has, kept together so they cannot drift.
 *
 * This is the fix for GAP-6, and the drift is exactly what happened: a column's TEXT is read from
 * the bar node under a role key (`valueText`, because `value` is the bar's own proportion), while
 * its WIDTH and GAP were documented under the SHORTER role prefix (`valueWidth`, `valueGap`).
 * `readColumn` derived both names from the ONE string it was given, so it read `valueTextWidth` and
 * `valueTextGap` - neither of which the API description mentions - and a caller who passed
 * `valueWidth: 170` got the 70 px default with no error at all. `rowLabel` and `seats` hid the bug
 * because for them the node key and the prefix are the same word.
 *
 * So the two names are separate parameters now, and a field that has an ALIAS is accepted under
 * both spellings with a deprecation warning rather than silently ignored: a caller must never get
 * nothing.
 */
const COLUMN_FIELDS = {
  rowLabel: { nodeKey: 'rowLabel', prefix: 'rowLabel' },
  valueText: { nodeKey: 'valueText', prefix: 'value' },
  seats: { nodeKey: 'seats', prefix: 'seats' },
};

/** The spellings a column's width/gap field has ever had, the documented one first. */
function columnFieldAliases(prefix, suffix) {
  const documented = `${prefix}${suffix}`;
  if (prefix === 'value') return [documented, `valueText${suffix}`];
  return [documented];
}

/**
 * One column field, under its documented name or a deprecated alias.
 *
 * @returns {{value: *, used: string|null, deprecated: string|null}}
 */
function columnField(node, prefix, suffix) {
  const names = columnFieldAliases(prefix, suffix);
  for (const [index, name] of names.entries()) {
    const value = node[name];
    if (value === undefined || value === null || value === '') continue;
    return { value, used: name, deprecated: index === 0 ? null : name };
  }
  return { value: undefined, used: null, deprecated: null };
}

/** Read a `kind: 'bar'` node as a column: its text, its width, its gap and its colour code. */
function readColumn(node, role, defaults, warnings = null) {
  const fields = COLUMN_FIELDS[role] ?? { nodeKey: role, prefix: role };
  const text = node[fields.nodeKey];
  if (text === undefined || text === null || text === '') return { text: null, width: 0, gap: 0, colour: null };
  const width = columnField(node, fields.prefix, 'Width');
  const gap = columnField(node, fields.prefix, 'Gap');
  for (const used of [width, gap]) {
    if (!used.deprecated || !warnings) continue;
    warnings.push({
      rule: 'bar-field-deprecated',
      severity: 'warning',
      name: node.name ?? null,
      element: node.name ?? null,
      field: used.deprecated,
      message:
        `\`${used.deprecated}\` is the old spelling of \`${fields.prefix}${used.deprecated.endsWith('Width') ? 'Width' : 'Gap'}\` and it was USED, ` +
        'but the API documents the shorter name. Rename it: this alias is accepted only so an existing plan cannot silently lose its width.',
      suggestedFix: `${fields.prefix}${used.deprecated.endsWith('Width') ? 'Width' : 'Gap'} = ${used.value}`,
    });
  }
  return {
    text: String(text),
    width: staticPixel(width.value) ?? defaults.width,
    gap: staticPixel(gap.value) ?? defaults.gap,
    colour: columnColour(node, role),
  };
}

/**
 * Read a bar node into the construction it expands to, and report everything wrong with it.
 *
 * This is the ONE description of a bar: the expansion, the preview and the validator all call it,
 * so a bar cannot mean one thing to the emitter and another to the report.
 *
 * @param {object} node a `kind: 'bar'` node
 * @returns {{ok: boolean, geometry: object|null, findings: object[]}}
 */
export function describeBar(node, context = {}) {
  const findings = [];
  const where = context.path ?? node?.name ?? node?.id ?? 'bar';
  const name = node?.name ?? 'bar';

  if (!isBarNode(node)) {
    return {
      ok: false,
      geometry: null,
      findings: [{ rule: 'bar-proportion-invalid', severity: 'error', path: where, name, message: `\`${where}\` is not a bar node.` }],
    };
  }

  // ---------------------------------------------------------------- colours that do not exist
  for (const field of ['trackColour', 'fillColour', 'colour', 'color']) {
    if (node[field] === undefined || node[field] === null || node[field] === '') continue;
    findings.push({
      rule: 'bar-colour-not-exist',
      severity: 'error',
      path: where,
      name,
      element: name,
      message:
        `\`${field} = ${JSON.stringify(node[field])}\` cannot be written: a `.concat('`containerWindowType` has NO colour field. ') +
        'The engine tints TEXT through `text_color_code` (which is why the reference value column carries `text_color_code = Y`), ' +
        'and a `spriteType` may name an `effectFile` shader; a window element has neither. Two real options: a different tile ' +
        'sprite (`track` / `fill`), or give the sprite its own shader in a `.gfx` file.',
      suggestedFix: 'pick another tile: `track` / `fill` take a palette name (track, solid, fill) or a sprite name',
      declared: node[field],
    });
  }

  // ---------------------------------------------------------------- the clone source
  const cloneOf = node.cloneOf === undefined || node.cloneOf === null || node.cloneOf === '' ? null : String(node.cloneOf);

  // ---------------------------------------------------------------- the frame, and the track in it
  const rawWidth = node.width === undefined || node.width === null ? null : node.width;
  const rawHeight = node.height === undefined || node.height === null ? null : node.height;
  let width = staticPixel(rawWidth);
  const declaredHeight = staticPixel(rawHeight);
  let height = declaredHeight;
  const inset = staticPixel(node.inset) ?? BAR_DEFAULTS.inset;

  if (rawWidth !== null && width === null) {
    findings.push({
      rule: 'bar-track-width-not-static',
      severity: 'error',
      path: where,
      name,
      element: name,
      message:
        `\`width = ${JSON.stringify(rawWidth)}\` on a bar is not a plain pixel number. The fill's length is derived from the track's ` +
        `width (track * value / max, less the ${inset * 2} px inset) and written into the .gui file as a literal, so the bar's width ` +
        'must be one. The reference declares 400 for the track alone.',
      suggestedFix: `width = ${BAR_DEFAULTS.width}`,
      declared: rawWidth,
    });
  }
  if (rawHeight !== null && declaredHeight === null) {
    findings.push({
      rule: 'bar-track-height-not-static',
      severity: 'error',
      path: where,
      name,
      element: name,
      message:
        `\`height = ${JSON.stringify(rawHeight)}\` on a bar is not a plain pixel number, so the fill inset cannot be subtracted ` +
        'from it. The reference declares 20 with a 12 px fill.',
      suggestedFix: `height = ${BAR_DEFAULTS.height}`,
      declared: rawHeight,
    });
  }

  const label = node.label === undefined || node.label === null || node.label === '' ? null : String(node.label);
  const sideRaw = node.labelSide === undefined || node.labelSide === null ? (label ? 'inside' : 'none') : String(node.labelSide).trim().toLowerCase();
  if (!LABEL_SIDES.includes(sideRaw)) {
    findings.push({
      rule: 'bar-label-overflows-track',
      severity: 'warning',
      path: where,
      name,
      message: `\`labelSide = ${JSON.stringify(node.labelSide)}\` is not one of ${LABEL_SIDES.join(', ')}; treated as \`inside\`.`,
      suggestedFix: 'labelSide = inside',
    });
  }
  const side = LABEL_SIDES.includes(sideRaw) ? sideRaw : 'inside';
  const labelWidth = staticPixel(node.labelWidth) ?? BAR_DEFAULTS.labelWidth;
  const labelGap = staticPixel(node.labelGap) ?? BAR_DEFAULTS.labelGap;
  const font = node.buttonFont ?? node.font ?? BAR_DEFAULTS.font;

  const labelEffectRaw = node.labelEffect;
  const labelEffect =
    labelEffectRaw === undefined || labelEffectRaw === null || labelEffectRaw === '' || labelEffectRaw === false || labelEffectRaw === 'false' || labelEffectRaw === 'none'
      ? null
      : labelEffectRaw;
  const effect = node.effect === undefined || node.effect === null || node.effect === '' ? null : String(node.effect);
  /**
   * IS THE LIVE CHANNEL ON? (GAP-8)
   *
   * The live channel is `effectbuttonType.buttonText` plus an `effect` - the ONE measured way to
   * paint a live number in a `custom_gui` window - and this used to require a `label` as well:
   *
   *   labelLive = label !== null && (labelEffect !== null || effect !== null)
   *
   * With no `label` the VALUE column therefore expanded to a plain `instantTextBoxType`, and the
   * engine paints its unresolved `[$...$]` token LITERALLY (docs/gui-pitfalls.md section 11). The
   * caller had to pass a label it did not want - `label: <the row label again>`, `labelSide: 'none'`
   * - purely to reach the value channel, and the plan had to say so at the point of use. Which
   * element the flag reaches is the next branch: a `label` goes to the label column, and with no
   * `label` it goes to the VALUE column, which is the column that carries the number.
   *
   * So the switch is the two fields that actually describe it. Passing `label` + `labelSide: 'none'`
   * still works and is still the way to add a live element of its own, which is what keeps every
   * existing plan valid.
   */
  const wantLive = labelEffect !== null || effect !== null;
  const labelLive = wantLive;
  if (label !== null && labelEffect !== null && effect === null) {
    findings.push({
      rule: 'bar-label-effect-missing',
      severity: 'error',
      path: where,
      name,
      element: name,
      message:
        'a live label was asked for but no `effect` was given. The live-text channel is `effectbuttonType.buttonText`, and an ' +
        '`effectbuttonType` needs an `effect` naming a key in common/button_effects/*.txt - without one the label is a button that ' +
        'does nothing.',
      suggestedFix: `effect = ${name}_label_effect`,
    });
  }
  if (label && !labelLive) {
    findings.push({
      rule: 'bar-label-not-offered-as-button',
      severity: 'info',
      path: where,
      name,
      element: name,
      message:
        'this bar paints a static label. A live value cannot arrive in painted text - a bracket data function renders literally in a ' +
        'window (docs/gui-pitfalls.md section 11) - so if the number should be live, pass `effect` (and `labelEffect`) to get the ' +
        '`effectbuttonType.buttonText` channel the working mod uses for every live figure.',
      suggestedFix: 'effect = <a key in common/button_effects/*.txt>, labelEffect = true',
    });
  }

  if (width === null) width = BAR_DEFAULTS.width;
  if (height === null) height = BAR_DEFAULTS.height;

  // ---------------------------------------------------------------- THE GRID
  //
  // `width` is the TRACK's width - the whole meaning of the bar, and the number the reference calls
  // 400. The reference's row is then, left to right:
  //
  //   [name 202][gap 12][TRACK `width`][gap 6][value 70][gap 12][seats 118]
  //
  // and `position` is the TRACK's own top-left corner - every element the bar expands to is placed
  // RELATIVE TO THE TRACK, so the name column lands at x = -(nameWidth + nameGap) and the value
  // column at x = width + valueGap. That is the choice that keeps "the bar is where I said it is"
  // true: the caller states where the track goes, and everything else falls out of the construction.
  //
  // It also keeps the reference's own arithmetic exactly. With the reference's numbers the offsets
  // from the track at (240, 66) are name (-214, -2), fill (+2, +2), value (+406, -2) and seats
  // (+488, -2), which is the reference's (26, 64), (242, 70), (646, 64) and (728, 64) minus
  // (240, 66). `REFERENCE_BAND_ELEMENTS` and the selftest assert exactly that.
  const left = readColumn(node, 'rowLabel', { width: BAR_DEFAULTS.rowLabelWidth, gap: BAR_DEFAULTS.rowLabelGap }, findings);
  const right = readColumn(node, 'valueText', { width: BAR_DEFAULTS.valueWidth, gap: BAR_DEFAULTS.valueGap }, findings);
  const extraRight = readColumn(node, 'seats', { width: BAR_DEFAULTS.seatsWidth, gap: BAR_DEFAULTS.seatsGap }, findings);
  const value = finiteNumber(node.value);
  const max = node.max === undefined || node.max === null || node.max === '' ? BAR_DEFAULTS.max : finiteNumber(node.max);
  // ONE DERIVATION, in `deriveBarGeometry`, so a clone and the original cannot compute the fill
  // differently. Everything below that reads `cap`, `fillWidth`, `fillHeight`, `fillTop`, `frame`,
  // `textY` or `textHeight` comes from it.
  const derived = deriveBarGeometry({ width, height, inset, value, max, side, left, right, extraRight, labelGap, fillHeight: staticPixel(node.fillHeight) });
  const { cap, fillWidth, fillHeight, fillTop, frame, textY, textHeight } = derived;
  const trackHeight = height;

  if (width < inset * 2 + 1 || trackHeight < inset * 2 + 1) {
    findings.push({
      rule: 'bar-frame-too-small',
      severity: 'error',
      path: where,
      name,
      element: name,
      message:
        `a bar of ${width}x${height} leaves a track of ${width}x${trackHeight}, which is too small for the ${inset * 2} px inset ` +
        `(the fill would be ${cap}x${fillHeight}). Raise \`width\`/\`height\`, or lower \`inset\`.`,
      suggestedFix: `width >= ${inset * 2 + 1}, height >= ${inset * 2 + 1}`,
    });
  }

  // ---------------------------------------------------------------- value / max -> the fill length
  if (value === null || max === null || max <= 0) {
    findings.push({
      rule: 'bar-proportion-invalid',
      severity: 'error',
      path: where,
      name,
      element: name,
      message:
        `a bar needs \`value\` and a positive \`max\` to derive its fill length from. Got value = ${JSON.stringify(node.value ?? null)}, ` +
        `max = ${JSON.stringify(node.max ?? null)}. A bar cannot track a live value - the fill length is a layout number - so the ` +
        'proportion has to be stated here and written into the file.',
      suggestedFix: 'value = 50, max = 100',
    });
  } else if (value < 0) {
    findings.push({
      rule: 'bar-proportion-invalid',
      severity: 'error',
      path: where,
      name,
      element: name,
      message: `\`value = ${value}\` is negative. A fill cannot be shorter than nothing.`,
      suggestedFix: 'value = 0',
    });
  } else if (value > max) {
    findings.push({
      rule: 'bar-fill-overflows-track',
      severity: 'error',
      path: where,
      name,
      element: name,
      message:
        `\`value = ${value}\` exceeds \`max = ${max}\`, so the fill would be ${Math.round((value / max) * cap)} px wide in a track whose ` +
        `inset leaves ${cap} px. It was clamped to ${cap} px so nothing overflows, but the proportion asked for is not expressible. ` +
        'This is a defect in the REFERENCE, not a rule invented here: zz_geocentric_unga.gui:257-271 declares the rank-0 fill 400 px ' +
        "wide inside a 400 px track at x = 242, a 4 px overhang over the track's right border, while every other ranking fill " +
        'caps at 396. Copying that would not be cloning.',
      suggestedFix: `max = ${value}`,
      value,
      max,
      cap,
    });
  }

  const geometry = buildSpecGeometry(node, {
    name,
    path: where,
    width,
    height,
    ...derived,
    inset,
    left,
    right,
    extraRight,
    value,
    max,
    label,
    labelSide: label ? side : 'none',
    labelWidth,
    labelGap,
    labelFont: font,
    labelLive,
    effect,
    textColour: node.text_color_code ? String(node.text_color_code) : null,
    headingName: node.headingName ? String(node.headingName) : null,
    cloneOf,
  });
  return { ok: findings.every((finding) => finding.severity !== 'error'), geometry, findings };
}

// ---------------------------------------------------------------------------------------------
// EXPANSION: a bar node -> the elements the engine actually reads
// ---------------------------------------------------------------------------------------------

/**
 * THE DERIVED GEOMETRY, in one place.
 *
 * Everything a bar's construction needs that follows from `width`, `height`, `inset` and the
 * `value`/`max` proportion is computed HERE, so the three things that need it cannot disagree:
 * `describeBar` (the reading of a node the caller wrote), `applyBarClone` (which inherits the
 * SOURCE's track and recomputes only the proportion for the clone's own value) and the fallback a
 * bar that cannot be read statically falls back to. An earlier revision computed the fill length
 * inside `describeBar` only, so a clone silently used ITS OWN default width - `cloneOf` then changed
 * the row's text but not its track, which is the opposite of cloning.
 *
 * @param {{width: number, height: number, inset: number, value: number|null, max: number|null, side?: string, left: object, right: object, extraRight: object}} spec
 * @returns {object} the derived fields, ready to spread into a geometry
 */
export function deriveBarGeometry(spec) {
  const { width, height, inset, left, right, extraRight } = spec;
  const side = spec.side ?? 'none';
  const trackLine = side === 'above' || side === 'below' ? Math.max(1, Math.round(height * 0.8)) + (spec.labelGap ?? BAR_DEFAULTS.labelGap) : 0;
  const textY = trackLine - BAR_DEFAULTS.textOverlap;
  const textHeight = Math.max(1, height - BAR_DEFAULTS.textOverlap);
  const leftSpan = left.text ? left.width + left.gap : 0;
  // Only the column that is actually used contributes its own span: a `seats` column with no
  // `value` column before it starts right after the track, not after a phantom 70 px gap.
  const rightSpan = (right.text ? right.gap + right.width : 0) + (extraRight.text ? extraRight.gap + extraRight.width : 0);
  const cap = Math.max(0, width - inset * 2);
  // THE FILL'S HEIGHT, MEASURED. The reference insets the fill by 2 px HORIZONTALLY in every case
  // (fill x = track x + 2, and the fill is 4 px inside the track's right border in the defect row
  // and 396 px in every other). Its HEIGHT follows the track's, but by a margin that GROWS with the
  // track rather than staying fixed:
  //
  //   track 18 -> fill 14 at top 2   margin 2   (the vote tally :853-882, both bloc bars :2868, :5817)
  //   track 20 -> fill 12 at top 4   margin 4   (:242-256 / :257-271, the six ranking rows)
  //
  // The two measured points are the ONLY bar heights the file has, and no constant margin explains
  // both (4 px gives 16 where the reference has 12; 2 px gives 16 where it has 14). They do lie on
  // one straight line, so the primitive uses the line through them and says so:
  //
  //   fillHeight = round(fillSlope * height + fillBase)   with 12 = 20a + b and 14 = 18a + b
  //
  // i.e. a = -1, b = 32, which is `BAR_DEFAULTS.fillSlope` and `BAR_DEFAULTS.fillBase`. The slope is
  // negative: a TALLER track carries a PROPORTIONALLY shorter fill, because the track's own 8 px
  // nine-slice border is what the fill has to stay out of. `inset` stays a floor on the margin, so
  // the fill can never leave the track at any height. The selftest asserts the fit against both
  // measured pairs, so a change to either constant that stops reproducing the reference fails.
  const fillMaxHeight = Math.max(0, height - inset * 2);
  const fillMinHeight = Math.max(0, height - inset * 4);
  const filled = BAR_DEFAULTS.fillSlope * height + BAR_DEFAULTS.fillBase;
  // An explicit `fillHeight` wins: it is how a bar CLONED from an imported construction reproduces
  // the fill box that construction had (see `barFieldsFromElements`), which the slope fit below
  // cannot promise for heights the reference does not contain.
  const declaredFillHeight = staticPixel(spec.fillHeight);
  const fillHeight =
    declaredFillHeight === null ? Math.max(0, Math.min(fillMaxHeight, Math.max(fillMinHeight, Math.round(filled)))) : Math.max(0, Math.min(fillMaxHeight, declaredFillHeight));
  const fillTop = inset + Math.floor(Math.max(0, fillMaxHeight - fillHeight) / 2);
  /** The whole row's extent relative to the track's own top-left corner. */
  const frame = {
    left: left.text ? -left.width : 0,
    top: trackLine - textHeight > 0 ? trackLine : Math.min(0, textY),
    right: width + rightSpan,
    bottom: trackLine + height,
    width: (left.text ? left.width + left.gap : 0) + width + rightSpan,
    height: trackLine + height,
  };
  frame.width = frame.right - frame.left;
  const { value, max } = spec;
  const ratio = value !== null && max !== null && max > 0 && value >= 0 ? Math.min(1, value / max) : 0;
  const fillWidth = Math.max(0, Math.min(cap, Math.round(cap * ratio)));
  return { frame, textY, textHeight, cap, fillHeight, fillTop, fillWidth, ratio, frameWidth: frame.width };
}

/**
 * WHAT EACH FIELD MEANS, in one place, so the tool schema, the docs and the module cannot drift from
 * each other or from the implementation. Keys are the input field names in `BAR_FIELD_NAMES` (the
 * ones a caller writes); `BAR_DEFAULTS` supplies the number where there is one.
 */
export const BAR_FIELD_HELP = {
  name: "the bar's own name. Every element it expands to is named from it by inserting the role: `unga_power_1_main` becomes `unga_power_name_1_main`, `unga_power_track_1_main`, `unga_power_fill_1_main`, `unga_power_value_1_main`, `unga_power_seats_1_main` - the reference's own convention.",
  position: "the TRACK's top-left corner, exactly like any container's position. The name column lands to its left (x = -(rowLabelWidth + rowLabelGap)) and the value/seats columns to its right, so a bar placed where the old code put its track stays where it was.",
  width: `the TRACK's width in base-resolution pixels (the reference's 400). STATIC: a plain integer or an \`@variable\`; a percentage is REFUSED, because the fill's length is derived from it and written as a literal. Defaults to ${BAR_DEFAULTS.width}.`,
  height: `the TRACK's height (the reference's 20). STATIC. Defaults to ${BAR_DEFAULTS.height}.`,
  value: "the value the bar shows. Turned into a STATIC fill length; the engine never reads it.",
  max: `the value that fills the track. Defaults to ${BAR_DEFAULTS.max}. \`value > max\` is REFUSED rather than clamped, because that is the reference's OWN defect (the 400 px fill in a 400 px track) and copying it is not cloning.`,
  inset: `the fill's inset in pixels: its x offset from the track's, and a floor on its vertical margin. Defaults to ${BAR_DEFAULTS.inset}, the reference's own.`,
  fillHeight: "the fill's own height, when a construction that was IMPORTED has to be reproduced exactly; otherwise it follows the track (see the measured fit in the module header).",
  label: "the bar's own label - a localisation key or any static text, separate from the row columns. Optional.",
  labelSide: "where the label goes: inside (default, centred over the track), above, below, left, right, none.",
  labelWidth: `the column a left/right label is given. Defaults to ${BAR_DEFAULTS.labelWidth}.`,
  labelGap: `gap between the track and a row/column label. Defaults to ${BAR_DEFAULTS.labelGap}.`,
  labelEffect:
    'NAMES THE LIVE CHANNEL. `true` makes the label an `effectbuttonType` whose `buttonText` carries the script-set number - the only measured live-text channel inside a custom_gui window. Requires `effect`.',
  effect: 'a key in common/button_effects/*.txt, for the label button. Present without `labelEffect` also asks for a live label.',
  track: `the TRACK's tile sprite: a palette name (${Object.keys(BAR_SPRITE_PALETTE).join('/')}) or a sprite name. Defaults to ${BAR_SPRITE_PALETTE.track.name}.`,
  fill: `the FILL's tile sprite: a palette name (${Object.keys(BAR_SPRITE_PALETTE).join('/')}) or a sprite name. Defaults to ${BAR_SPRITE_PALETTE.fill.name}.`,
  rowLabel: `the row's NAME column - the reference's \`unga_power_name_N_main\`. Optional; without it the row is track + value + seats only. Width defaults to ${BAR_DEFAULTS.rowLabelWidth}.`,
  rowLabelWidth: `the name column's \`maxWidth\`. Defaults to ${BAR_DEFAULTS.rowLabelWidth} (the reference's own).`,
  rowLabelGap: `the gap between the name column and the track. Defaults to ${BAR_DEFAULTS.rowLabelGap}.`,
  rowLabelColour: "the name column's `text_color_code` (a single letter; the reference's value column uses `Y`). Also accepted as `nameColour`.",
  valueText: `the row's VALUE column - the reference's \`unga_power_value_N_main\`. This is TEXT, not the number: the bar's number is \`value\`. Width defaults to ${BAR_DEFAULTS.valueWidth}.`,
  valueWidth: `the value column's \`maxWidth\`. Defaults to ${BAR_DEFAULTS.valueWidth}. NOTE the asymmetry with the column's TEXT, which is \`valueText\` (because \`value\` is the bar's own proportion): the WIDTH and the GAP are named for the shorter role \`value\`, and that is what this key is. \`valueTextWidth\` is accepted as a deprecated alias and reports \`bar-field-deprecated\`.`,
  valueGap: `the gap between the track's right edge and the value column. Defaults to ${BAR_DEFAULTS.valueGap}. Named for the role \`value\`, like \`valueWidth\`; \`valueTextGap\` is a deprecated alias.`,
  valueColour: "the value column's `text_color_code`. The reference's is `Y`. A LIVE label cannot carry one, because a button has no such field.",
  seats: `the row's SEATS column - the reference's \`unga_power_seats_N_main\`. Optional. Width defaults to ${BAR_DEFAULTS.seatsWidth}.`,
  seatsWidth: `the seats column's \`maxWidth\`. Defaults to ${BAR_DEFAULTS.seatsWidth}.`,
  seatsGap: `the gap between the value column's right edge and the seats column. Defaults to ${BAR_DEFAULTS.seatsGap}.`,
  seatsColour: "the seats column's `text_color_code` (the reference's is `E`).",
  headingName: "the name of the heading element over this bar's column, for the alignment rule; otherwise the convention derives it from the bar's name.",
  cloneOf:
    'the name of a bar EARLIER in the tree whose construction this one reproduces. The clone inherits the track, the inset, both sprites and the columns, and overrides only its own position, proportion and text. Pass `rowLabel`/`valueText`/`seats` to replace a column, or `false` to drop one.',
  font: `the font for every text element the bar emits. Defaults to ${BAR_DEFAULTS.font}, the reference's own.`,
  text_color_code: "a `text_color_code` applied to the bar's own label.",
  trackColour: 'REJECTED, and the rejection says why: a `.gui` container has no colour field. Use `track`/`fill` to pick a different tile, or give the sprite an `effectFile` shader in a `.gfx` file.',
  fillColour: 'REJECTED, for the same reason as `trackColour`.',
};

/**
 * One row of the construction is a SQUAD of five elements at fixed offsets from the track's
 * top-left corner, and these are those offsets with the reference's own numbers substituted. Printed
 * by `gui_bar_spec` so a caller can see the whole shape without reading the module.
 */
export function referenceOffsets() {
  const right = REFERENCE_RANKING_ROW.elements.find((element) => element.role === 'value');
  const seats = REFERENCE_RANKING_ROW.elements.find((element) => element.role === 'seats');
  const name = REFERENCE_RANKING_ROW.elements.find((element) => element.role === 'name');
  const track = REFERENCE_RANKING_ROW.elements.find((element) => element.role === 'track');
  const fill = REFERENCE_RANKING_ROW.elements.find((element) => element.role === 'fill');
  const rel = (element, role) => ({
    role,
    from: element.name,
    dx: element.fields.position.x - track.fields.position.x,
    dy: element.fields.position.y - track.fields.position.y,
    width: element.fields.size?.width ?? element.fields.maxWidth,
    height: element.fields.size?.height ?? element.fields.maxHeight,
  });
  return [
    rel(name, 'name'),
    rel(track, 'track'),
    rel(fill, 'fill'),
    rel(right, 'value'),
    rel(seats, 'seats'),
  ];
}

/**
 * The sprite a bar's `track` / `fill` names, resolved through the palette. Kept next to the
 * geometry so every producer of a bar geometry (the expansion, the clone and the fallback) resolves
 * the sprites the same way.
 */
function barSprites(node) {
  return {
    track: resolveBarSprite(node.track ?? node.trackSprite, BAR_SPRITE_PALETTE.track.name),
    fill: resolveBarSprite(node.fill ?? node.fillSprite, BAR_SPRITE_PALETTE.fill.name),
  };
}

/** Finish a bar geometry: the two resolved sprites, in one place so no producer can forget them. */
function buildSpecGeometry(node, spec) {
  return { ...spec, ...barSprites(node) };
}

/**
 * READ A BAR'S CONSTRUCTION OUT OF AN IMPORTED TREE.
 *
 * `cloneOf` clones a bar the CALLER declared. This reads one that already exists as ELEMENTS - the
 * shape `gui_layout_import` produces from a real `.gui` file - so a construction this plugin did not
 * invent can still be reproduced. It is the `from` mechanism: point it at an imported track/fill/
 * name/value/seats (five sibling nodes, or the names to find them by) and it returns the `kind: 'bar'`
 * fields that reproduce that construction, which the normal layout path then expands as usual.
 *
 * The fields it recovers are exactly the ones the construction encodes: the track's size and tile
 * sprite, the fill's tile sprite and its inset (measured as the fill's own offset from the track),
 * the text columns' widths, and the font. A caller then supplies only `value`/`max`, and a bar
 * cloned from a bar that works is field-identical to it by construction instead of by transcription.
 *
 * @param {object} source `{ track, fill, name, value, seats }`, either nodes or element names
 * @param {object} [tree] the layout (or any node) to resolve names against; omit if nodes are given
 * @returns {object|null} the bar fields, or null when no track could be read
 */
export function barFieldsFromElements(source = {}, tree = null) {
  const findByPath = (target) => {
    if (!target) return null;
    if (typeof target === 'object') return target;
    const wanted = String(target);
    let found = null;
    const visit = (node) => {
      if (!node || typeof node !== 'object' || found) return;
      if (node.name === wanted || node.id === wanted) { found = node; return; }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree?.root ?? tree);
    return found;
  };
  const spriteOf = (element) => element?.background?.sprite ?? element?.background?.quadTextureSprite ?? element?.background?.spriteType ?? element?.sprite ?? element?.quadTextureSprite ?? element?.spriteType ?? null;
  const sizeOf = (element) => {
    const size = element?.size ?? null;
    if (!size) return null;
    return { width: size.width ?? size.x ?? null, height: size.height ?? size.y ?? null };
  };
  const track = findByPath(source.track ?? source.trackNode);
  if (!track) return null;
  const fill = findByPath(source.fill ?? source.fillNode);
  const nameText = findByPath(source.name ?? source.rowLabel);
  const valueText = findByPath(source.value ?? source.valueText);
  const seats = findByPath(source.seats);
  const trackSize = sizeOf(track);
  const trackPos = track.position ?? { x: 0, y: 0 };
  const fillPos = fill?.position ?? null;
  const fields = { kind: 'bar' };
  if (trackSize?.width !== null && trackSize?.width !== undefined) fields.width = trackSize.width;
  if (trackSize?.height !== null && trackSize?.height !== undefined) fields.height = trackSize.height;
  if (spriteOf(track)) fields.track = spriteOf(track);
  if (fill && spriteOf(fill)) fields.fill = spriteOf(fill);
  if (fillPos) {
    // THE INSET IS THE HORIZONTAL ONE. That is the axis the construction's invariant is about (the
    // fill never crosses the track's right border), and it is the axis the reference keeps constant
    // at 2 px across all eight measured uses. The vertical offset is measured too, and returned as
    // `insetY` for the report, but it is NOT the inset: the reference's own vertical offset is 2 px
    // in the 18 px tracks and 4 px in the 20 px ones, and the fill's height is what the construction
    // derives from the track (see `deriveBarGeometry`). Reporting `inset = max(dx, dy)` here would
    // silently turn the reference's 2 px inset into a 4 px one.
    fields.inset = Math.abs((fillPos.x ?? 0) - (trackPos.x ?? 0));
    fields.insetY = Math.abs((fillPos.y ?? 0) - (trackPos.y ?? 0));
  }
  // The fill's own height, so a bar built from an imported construction reproduces the fill box the
  // import had rather than the one the slope formula would give for that track height.
  const fillSize = sizeOf(fill);
  if (fillSize?.height !== null && fillSize?.height !== undefined) fields.fillHeight = fillSize.height;
  if (nameText?.maxWidth !== undefined) fields.rowLabelWidth = nameText.maxWidth;
  if (valueText?.maxWidth !== undefined) fields.valueWidth = valueText.maxWidth;
  if (seats?.maxWidth !== undefined) fields.seatsWidth = seats.maxWidth;
  if (valueText?.font) fields.font = valueText.font;
  if (valueText?.text_color_code) fields.text_color_code = valueText.text_color_code;
  return fields;
}

/**
 * A `background = { ... }` block as the MODEL holds it: the emitter's `renderBackground` writes
 * `background.sprite` as the engine's `quadTextureSprite` field (the engine accepts both
 * `quadTextureSprite` and the fixed-size `spriteType`, and the reference uses the former), so the
 * construction names it `sprite`. Getting this wrong is silent - the block is still written and
 * still has its `name`, and only the sprite line is missing, which is exactly the "tinted box that
 * does not read as a bar" this primitive exists to prevent - so the selftest asserts the emitted
 * TEXT carries both sprite names, not just the model.
 */
function barBackground(sprite) {
  return { name: 'bg', sprite };
}

/**
 * The five elements of a bar UNIT, at the reference's own local coordinates: the track's top-left
 * corner is (0, 0) for the TRACK and the FILL, and the three text columns sit at x offsets from it.
 * Nothing is nested - the five are siblings, exactly as the reference's are - so the caller positions
 * them all by one offset, and there is no invented wrapper element in the emitted file.
 *
 * @param {object} node the `kind: 'bar'` node (for `id`)
 * @param {object} geometry from `describeBar`
 * @returns {object[]} the elements, in the reference's own order: name, track, fill, value, seats
 */
export function buildBarUnit(node, geometry) {
  const { name, inset, left, right, extraRight, width, height, fillWidth, fillHeight, fillTop, label, labelSide, labelWidth, labelGap, labelFont, labelLive, effect, textColour, track, fill, frame } = geometry;
  const base = name;
  // The bar's declared position IS the track's top-left corner, so the track is at (0, 0) and the
  // text columns sit at the reference's own offsets from it: `textY` = -2 (the reference writes
  // `maxHeight = 18` for a 20 tall track at y = 66, i.e. the text box starts 2 px ABOVE the track);
  // `textHeight` = 18. A bar with no own row above it (an `above`/`below` label) sits at y = 0
  // instead, so a text column can never escape its own frame upward.
  const textY = frame.top === 0 && geometry.labelSide === 'above' ? 0 : -BAR_DEFAULTS.textOverlap;
  const textTop = textY < 0 ? textY : 0;
  const textHeight = geometry.textHeight ?? Math.max(1, height - BAR_DEFAULTS.textOverlap);
  /**
   * A text column, in the reference's own field shape. This is the shape transcribed in
   * `REFERENCE_RANKING_ROW.elements[role=name|value|seats]`, field for field:
   * `position`, `maxWidth`, `maxHeight`, `alwaysTransparent`, `font`, `text`, `fixedSize`, `format`
   * (+ `text_color_code` when a colour is given).
   */
  const textElement = (suffix, text, boxWidth, position, format, colour) => ({
    id: `${node.id ?? base}__${suffix}`,
    name: barElementName(base, suffix),
    // `role` is the piece's own name (`name`, `track`, `fill`, `value`, `seats`, `label`), kept on
    // the node as model plumbing (`NON_FIELD_KEYS` drops it from the emitted file). It is what lets
    // a CLONE derive its own element names from its own bar name without string surgery on the
    // source's names - see `expandBarsInTree`.
    role: suffix,
    kind: 'text',
    position,
    maxWidth: Math.max(0, Math.round(boxWidth)),
    maxHeight: textHeight,
    alwaysTransparent: true,
    font: labelFont,
    text: String(text),
    fixedSize: true,
    format,
    ...(colour ? { text_color_code: String(colour) } : {}),
    component: 'bar-label',
  });

  /**
   * The LIVE column: an `effectbuttonType` whose `buttonText` is the script-set number. Same box as
   * the text column, and the sprite is the palette's white tile so the button's hit region covers
   * the cell and paints nothing over it. `text_color_code` is deliberately absent: a
   * `buttonType`/`effectbuttonType` has no such field, and this is the one field the clone drops.
   */
  const liveElement = (suffix, text, boxWidth, boxHeight, position, format) => ({
    id: `${node.id ?? base}__${suffix}`,
    name: barElementName(base, suffix),
    role: suffix,
    kind: 'effectbutton',
    position,
    size: { x: Math.max(0, Math.round(boxWidth)), y: Math.max(1, Math.round(boxHeight)) },
    quadTextureSprite: BAR_SPRITE_PALETTE.fill.name,
    buttonFont: labelFont,
    buttonText: String(text),
    effect,
    format,
    component: 'bar-label',
    componentLive: true,
  });

  const elements = [];

  // 1. the NAME column, LEFT of the track (the reference's `unga_power_name_N_main`). The bar's
  // `position` is the track, so this is the only negative x in the construction: the reference's
  // own (26, 64) is (240, 66) + (-(202 + 12), -2).
  if (left.text) {
    const x = -(left.width + left.gap);
    elements.push(textElement('name', left.text, left.width, { x, y: textTop }, 'left', left.colour));
  }

  // 2. the TRACK (the reference's `unga_power_track_N_main`) - `containerWindowType`
  elements.push({
    id: `${node.id ?? base}__track`,
    name: barElementName(base, 'track'),
    role: 'track',
    kind: 'container',
    position: { x: 0, y: 0 },
    size: { width, height },
    background: barBackground(track.sprite),
    component: 'bar-track',
  });

  // 3. the FILL (the reference's `unga_power_fill_N_main`) - the same kind, inset by `inset`
  elements.push({
    id: `${node.id ?? base}__fill`,
    name: barElementName(base, 'fill'),
    role: 'fill',
    kind: 'container',
    position: { x: inset, y: fillTop },
    size: { width: Math.min(fillWidth, Math.max(0, width - inset * 2)), height: fillHeight },
    background: barBackground(fill.sprite),
    component: 'bar-fill',
  });

  // 4. the VALUE column, right of the track (the reference's `unga_power_value_N_main`)
  if (right.text) {
    const x = width + right.gap;
    elements.push(
      labelLive
        ? liveElement('value', right.text, right.width, textHeight, { x, y: textTop }, 'right')
        : textElement('value', right.text, right.width, { x, y: textTop }, 'right', right.colour),
    );
  }

  // 5. the SEATS column, right of the value (the reference's `unga_power_seats_N_main`)
  if (extraRight.text) {
    const x = width + (right.text ? right.gap + right.width : 0) + extraRight.gap;
    elements.push(textElement('seats', extraRight.text, extraRight.width, { x, y: textTop }, 'right', extraRight.colour));
  }

  // 6. the BAR's own LABEL, separate from the row columns above: `inside` centres it over the
  // track's inner box, and `left`/`right` give it its own column beside the track.
  if (label && (labelSide === 'inside' || labelSide === 'left' || labelSide === 'right')) {
    const boxWidth = labelSide === 'inside' ? Math.max(0, width - inset * 2) : Math.max(1, labelWidth);
    const boxHeight = labelSide === 'inside' ? Math.max(1, fillHeight) : textHeight;
    const position =
      labelSide === 'inside'
        ? { x: inset, y: 0 }
        : labelSide === 'left'
          ? { x: -labelGap - boxWidth, y: fillTop }
          : { x: width + labelGap, y: fillTop };
    const format = labelSide === 'inside' ? 'center' : labelSide === 'left' ? 'right' : 'left';
    elements.push(
      labelLive
        ? liveElement('label', label, boxWidth, boxHeight, position, format)
        : textElement('label', label, boxWidth, position, format, textColour),
    );
  }

  // 7. a ROW label: `above`/`below` puts the label on its own line of the FRAME, so it is the only
  // element that reaches outside the track's box vertically. Vanilla's own row idiom, and what the
  // reference does with its separate `unga_power_name_*` line.
  if (label && (labelSide === 'above' || labelSide === 'below')) {
    const y = labelSide === 'above' ? -labelGap - textHeight : height + labelGap;
    elements.push(
      labelLive
        ? liveElement('label', label, width, textHeight, { x: 0, y }, 'left')
        : textElement('label', label, width, { x: 0, y }, 'left', textColour),
    );
  }

  return elements;
}

/** Kept as the name the first revision of this module used. */
export const buildBarElements = buildBarUnit;

/**
 * THE CLONE MECHANISM.
 *
 * `cloneOf` names a bar that already exists earlier in the tree, and the clone reproduces it
 * element for element - every field of every element, not just the ones the caller happens to
 * repeat - with its generated names renumbered onto the clone and its position moved to the
 * clone's own. This is how the problem is solved in practice: a band of six rows is ONE
 * construction plus five clones, and a row should not be re-derived by hand five times (which is
 * exactly where the reference's rows 2-5 got their drifting fill widths: 383, 350, 233, 183, 150 -
 * each one a hand-computed proportion, none of them reproducible from the others).
 *
 * A clone inherits the construction and overrides the ROW: `rowLabel`, `value`/`max`, `seats` and
 * `label` come from the clone's own node, because the whole point of a second row is different words
 * and a different proportion. Omit one and the source's is inherited; omit `rowLabel` on purpose
 * with `rowLabel: false` to get a bar with no row label at all.
 *
 * @param {object} sourceGeometry the `barGeometry` of the bar named by `cloneOf`
 * @param {object} cloneGeometry the clone's own geometry (its position, proportion and text)
 * @param {object} [cloneNode] the clone's node, read for the fields that say "no column, on purpose"
 * @returns {object} the geometry the clone's elements are built from
 */
export function applyBarClone(sourceGeometry, cloneGeometry, cloneNode = {}) {
  const dropped = (value) => value === false || value === 'none' || value === '' || value === null;
  const own = (field) => cloneNode[field] !== undefined && cloneNode[field] !== null;
  const column = (ownNode, ownColumn, sourceColumn, field) => {
    if (dropped(ownNode[field])) return { text: null, width: 0, gap: 0, colour: null };
    if (!ownColumn.text) return sourceColumn;
    // A column the clone REPLACES keeps the source's colour unless the clone carries one of its own -
    // a colour code is part of the construction (`text_color_code = Y` is the reference's value
    // column), so a second row of the same band is the same colour unless it says otherwise.
    return { ...ownColumn, colour: ownColumn.colour ?? sourceColumn.colour };
  };
  // ---------------------------------------------------------------- the CONSTRUCTION
  //
  // Inherited from the source unless the caller states its own: the track's size, the inset, the
  // two sprites, the label metrics and the row's columns. This is what "clone" means - the clone
  // reproduces the source's construction and overrides only its row. A clone that had to restate
  // `width` would not be a clone, it would be a second bar that happens to look similar, which is
  // the drift the reference's own rows 2-5 show (383, 350, 233, 183, 150 - five hand-computed
  // proportions, none reproducible from the others).
  const width = own('width') ? cloneGeometry.width : sourceGeometry.width;
  const height = own('height') ? cloneGeometry.height : sourceGeometry.height;
  const inset = own('inset') ? cloneGeometry.inset : sourceGeometry.inset;
  const left = column(cloneNode, cloneGeometry.left, sourceGeometry.left, 'rowLabel');
  const right = column(cloneNode, cloneGeometry.right, sourceGeometry.right, 'valueText');
  const extraRight = column(cloneNode, cloneGeometry.extraRight, sourceGeometry.extraRight, 'seats');
  const label = dropped(cloneNode.label) ? null : own('label') ? String(cloneNode.label) : sourceGeometry.label;
  const side = label ? (own('labelSide') ? cloneGeometry.labelSide : sourceGeometry.labelSide) : 'none';
  const value = own('value') ? cloneGeometry.value : sourceGeometry.value;
  const max = own('max') ? cloneGeometry.max : sourceGeometry.max;
  // GAP-8: with no `label` the live channel is the VALUE column's, so a clone keeps whatever live
  // `effect` the construction has - its own if it states one, otherwise the SOURCE's, because
  // `cloneOf` means "reproduce this construction and override only my row". `effect` is what
  // switches the channel on, and dropping it (which is what happened) silently reverted a cloned
  // readout's value column to painted text.
  const labelLive = label
    ? Boolean(own('labelEffect') || own('effect') ? cloneGeometry.labelLive : sourceGeometry.labelLive)
    : Boolean(own('effect') ? cloneGeometry.effect : sourceGeometry.effect);
  // THE ONE RECOMPUTATION: the proportion follows the clone's own value, over the INHERITED track.
  const derived = deriveBarGeometry({
    width,
    height,
    inset,
    value,
    max,
    side,
    left,
    right,
    extraRight,
    labelGap: own('labelGap') ? cloneGeometry.labelGap : sourceGeometry.labelGap,
    fillHeight: own('fillHeight') ? cloneGeometry.fillHeight ?? BAR_DEFAULTS.fillSlope * height + BAR_DEFAULTS.fillBase : sourceGeometry.fillHeight,
  });
  return {
    ...sourceGeometry,
    // the clone's own identity
    name: cloneGeometry.name,
    path: cloneGeometry.path,
    cloneOf: cloneGeometry.cloneOf,
    headingName: own('headingName') ? cloneGeometry.headingName : sourceGeometry.headingName,
    // the inherited construction, with the caller's own overrides
    width,
    height,
    inset,
    left,
    right,
    extraRight,
    track: own('track') || own('trackSprite') ? cloneGeometry.track : sourceGeometry.track,
    fill: own('fill') || own('fillSprite') ? cloneGeometry.fill : sourceGeometry.fill,
    labelWidth: own('labelWidth') ? cloneGeometry.labelWidth : sourceGeometry.labelWidth,
    labelGap: own('labelGap') ? cloneGeometry.labelGap : sourceGeometry.labelGap,
    labelFont: own('font') || own('buttonFont') ? cloneGeometry.labelFont : sourceGeometry.labelFont,
    // the clone's own row
    value,
    max,
    label,
    labelSide: side,
    labelLive,
    effect: own('effect') ? cloneGeometry.effect : sourceGeometry.effect,
    textColour: own('text_color_code') ? cloneGeometry.textColour : sourceGeometry.textColour,
    // and the geometry recomputed over the inherited track
    ...derived,
  };
}

/**
 * A CLONE'S ELEMENT NAME.
 *
 * The element names are derived from the bar's name by inserting the piece's ROLE
 * (`barElementName`), so a clone cannot be renamed by string-replacing the source's name inside a
 * derived one - `unga_power_name_1_main` does not contain `unga_power_1_main` as a prefix, and a
 * naive replace produced `unga_power_2_main_unga_power_name_1_main` (measured; an earlier revision
 * of this module did exactly that). The role is what is stable across a rename, so the clone's
 * element is named from the CLONE's bar name and the SOURCE element's role.
 *
 * Falling back to the whole name keeps the function total: an element with no role (one built by
 * hand rather than by `buildBarUnit`) still gets a unique name under the clone.
 *
 * @param {string} elementName the name the construction was built under
 * @param {string} sourceName the source bar's name
 * @param {string} cloneName the clone bar's name
 * @param {string|null} role the piece's role, from the node's own `role`
 */
export function renameBarClone(elementName, sourceName, cloneName, role = null) {
  if (!cloneName) return elementName;
  if (role) return barElementName(cloneName, role);
  if (!elementName || !sourceName) return elementName;
  if (elementName === sourceName) return cloneName;
  // The role's position inside a derived name is fixed: it follows the source bar's name and
  // precedes whatever tail the bar name had. `unga_power_1_main` + `name` -> `unga_power_name_1_main`,
  // so a derived name whose head is the source's name is rebuilt with the clone's head.
  if (elementName.startsWith(sourceName)) return `${cloneName}${elementName.slice(sourceName.length)}`;
  return `${cloneName}_${elementName.replace(/^_+/, '')}`;
}

/**
 * Resolve every bar component in a tree into the elements the engine reads.
 *
 * CALLED FROM `computeLayout`, which is the one function the layout engine, the rect table, the
 * preview, the validator and the emitter all go through. A bar therefore cannot mean one thing to
 * the file and another to the report, and no caller has to remember to expand it. The pass is
 * idempotent (an expanded parent carries no `bar` children afterwards) and it does not mutate the
 * bar node itself, so a stored tree stays exactly as the caller wrote it.
 *
 * @param {object} root the tree's root (mutated in place)
 * @param {{resolvedRectsByPath?: Map}} [context]
 * @returns {object[]} the findings from every bar in the tree
 */
export function expandBarsInTree(root, context = {}) {
  const findings = [];
  /** Every bar this pass has expanded, by name, so `cloneOf` can be resolved. */
  const expanded = new Map();
  const usableGeometry = (child, geometry, childPath) => {
    if (geometry && geometry.width >= geometry.inset * 2 + 1 && geometry.height >= geometry.inset * 2 + 1) return geometry;
    const fallbackWidth = BAR_DEFAULTS.width;
    const fallbackHeight = BAR_DEFAULTS.height;
    const fallbackMaxHeight = Math.max(0, fallbackHeight - BAR_DEFAULTS.inset * 2);
    return {
      ...BAR_DEFAULTS,
      name: child.name ?? child.id ?? 'bar',
      path: childPath,
      frame: { left: 0, top: 0, right: fallbackWidth, bottom: fallbackHeight, width: fallbackWidth, height: fallbackHeight },
      textY: -BAR_DEFAULTS.textOverlap,
      textHeight: fallbackHeight - BAR_DEFAULTS.textOverlap,
      width: fallbackWidth,
      height: fallbackHeight,
      left: { text: null, width: 0, gap: 0, colour: null },
      right: { text: null, width: 0, gap: 0, colour: null },
      extraRight: { text: null, width: 0, gap: 0, colour: null },
      fillWidth: 0,
      fillHeight: Math.max(0, Math.min(fallbackMaxHeight, Math.max(fallbackHeight - BAR_DEFAULTS.inset * 4, BAR_DEFAULTS.fillSlope * fallbackHeight + BAR_DEFAULTS.fillBase))),
      fillTop: BAR_DEFAULTS.inset,
      cap: fallbackWidth - BAR_DEFAULTS.inset * 2,
      ratio: 0,
      value: finiteNumber(child.value),
      max: finiteNumber(child.max) ?? BAR_DEFAULTS.max,
      label: child.label !== undefined && child.label !== null ? String(child.label) : null,
      labelSide: child.label ? String(child.labelSide ?? 'inside').toLowerCase() : 'none',
      labelWidth: BAR_DEFAULTS.labelWidth,
      labelGap: BAR_DEFAULTS.labelGap,
      labelFont: child.font ?? child.buttonFont ?? BAR_DEFAULTS.font,
      labelLive: false,
      effect: child.effect ? String(child.effect) : null,
      textColour: child.text_color_code ? String(child.text_color_code) : null,
      headingName: child.headingName ? String(child.headingName) : null,
      cloneOf: child.cloneOf ? String(child.cloneOf) : null,
      track: resolveBarSprite(child.track ?? child.trackSprite, BAR_SPRITE_PALETTE.track.name),
      fill: resolveBarSprite(child.fill ?? child.fillSprite, BAR_SPRITE_PALETTE.fill.name),
      // THE FALLBACK MARKER. describeBar already reported why this bar could not be read (an
      // unresolvable width, a non-numeric proportion); the construction below keeps the emitted file
      // legal rather than emitting a zero-width track. The validator uses this to say so once.
      geometrySubstituted: true,
    };
  };

  const expandOne = (child, childPath) => {
    const { geometry, findings: barFindings } = describeBar(child, { path: childPath, resolvedRectsByPath: context.resolvedRectsByPath });
    findings.push(...barFindings);
    const usable = usableGeometry(child, geometry, childPath);
    // ---------------------------------------------------------------- the clone
    let effective = usable;
    let sourceName = null;
    if (usable.cloneOf) {
      const source = expanded.get(usable.cloneOf);
      if (!source) {
        findings.push({
          rule: 'bar-clone-source-missing',
          severity: 'error',
          path: childPath,
          name: usable.name,
          element: usable.name,
          message:
            `\`cloneOf = ${JSON.stringify(usable.cloneOf)}\` names a bar this pass did not expand before this one. A clone source ` +
            'must be a `kind: "bar"` node EARLIER in document order - the clone copies its construction and only overrides the ' +
            'position, the proportion and the text.',
          suggestedFix: 'move the source bar above this one, or give the clone its own `width`/`height`/`inset`',
        });
      } else {
        effective = applyBarClone(source, usable, child);
        sourceName = usable.cloneOf;
      }
    }
    // The frame's own origin: the bar's declared position becomes the origin of every element it
    // expands to, so the caller's coordinates mean what they say.
    const origin = child.position ?? { x: 0, y: 0 };
    // A CLONE BUILDS UNDER ITS SOURCE'S NAME AND IS RENAMED AFTERWARDS. The element names are
    // derived from the bar's own name (`unga_power_track_1_main` from `unga_power_1_main`), so
    // building a clone directly under its own name would derive `unga_power_track_2_main` from the
    // CLONE's name and then have nothing to rename - the source's name is what `renameBarClone`
    // needs to find and replace. `nameFor` below is the name the construction is built under.
    const nameFor = sourceName ?? usable.name;
    const elements = buildBarUnit(child, { ...effective, name: nameFor });
    for (const element of elements) {
      if (sourceName) {
        element.name = renameBarClone(element.name, sourceName, usable.name, element.role);
        element.id = `${usable.id ?? usable.name}__${element.role ?? element.name}`;
      }
      element.position = { x: Number(origin.x ?? 0) + element.position.x, y: Number(origin.y ?? 0) + element.position.y };
      element.componentOf = child.name ?? child.id ?? null;
      element.barGeometry = effective;
    }
    if (child.name) expanded.set(String(child.name), effective);
    return elements;
  };

  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return;
    const here = path ? `${path}/${node.name ?? node.id ?? '?'}` : node.name ?? node.id ?? 'root';
    if (Array.isArray(node.children) && node.children.some((child) => isBarNode(child))) {
      const replacement = [];
      for (const child of node.children) {
        if (!isBarNode(child)) {
          replacement.push(child);
          continue;
        }
        replacement.push(...expandOne(child, `${here}/${child.name ?? child.id ?? '?'}`));
      }
      node.children = replacement;
    }
    for (const child of node.children ?? []) visit(child, path ? `${path}/${node.name ?? node.id ?? '?'}` : node.name ?? node.id ?? 'root');
  };
  visit(root, '');
  return findings;
}

/** Every expanded bar in a tree, found by the `barGeometry` marker the expansion leaves behind. */
export function collectBars(layout) {
  const byName = new Map();
  const order = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const geometry = node.barGeometry;
    if (geometry?.name) {
      const key = `${geometry.path}#${geometry.name}`;
      if (!byName.has(key)) {
        byName.set(key, { name: geometry.name, geometry, group: null, track: null, fill: null, label: null, value: null, name_: null, seats: null });
        order.push(key);
      }
      const entry = byName.get(key);
      // The piece's own `role`, set by `buildBarUnit`, so this does not have to guess from the
      // generated name - a clone's names are derived from ITS name, and a suffix match would be
      // fragile the moment a caller names a bar something the convention does not cover.
      switch (node.role ?? (node.component === 'bar-track' ? 'track' : node.component === 'bar-fill' ? 'fill' : null)) {
        case 'track': entry.track = node; break;
        case 'fill': entry.fill = node; break;
        case 'name': entry.name_ = node; break;
        case 'value': entry.value = node; break;
        case 'seats': entry.seats = node; break;
        case 'label': if (entry.label === null) entry.label = node; break;
        default: break;
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  if (layout?.root) visit(layout.root);
  return order.map((key) => byName.get(key));
}

/**
 * The label's box, as the construction gives it, for the validator's own measurement, and the
 * track's box for the alignment rule. Both come from the same `geometry` the emitter used, so the
 * emitter and the validator cannot disagree about how much room a bar's label gets.
 */
export function barLabelBox(geometry) {
  if (!geometry || !geometry.label) return null;
  const { inset, width, height, fillHeight, labelSide, labelWidth, textHeight } = geometry;
  if (labelSide === 'inside') return { width: Math.max(0, width - inset * 2), height: Math.max(1, fillHeight) };
  if (labelSide === 'left' || labelSide === 'right') return { width: Math.max(1, labelWidth), height: Math.max(1, textHeight ?? height) };
  if (labelSide === 'above' || labelSide === 'below') return { width: Math.max(1, width), height: Math.max(1, textHeight ?? height) };
  return null;
}

/** The track's box, in the BAR's own coordinates: the track is always at the bar's own origin. */
export function barTrackBox(geometry) {
  if (!geometry) return null;
  return { x: 0, y: 0, width: geometry.width, height: geometry.height };
}

/**
 * The heading a bar's column belongs to, from the naming convention the working mod and vanilla
 * both use: `unga_bloc_track_*` sits under `unga_bloc_actions_heading_*`, `unga_tally_*` under
 * `unga_tally_caption_*`. Returns null when the name carries no such infix; `headingName` on the
 * bar is the explicit form.
 */
export function headingNameForBar(barName) {
  if (!barName) return null;
  // GREEDY, deliberately: `unga_power_track_1` must yield `unga_power_heading`, and a non-greedy
  // `(.*?)` matched only up to the FIRST marker (`unga`), which then matched no heading anywhere and
  // silently disabled the alignment rule for every bar the convention applies to.
  const match = /^(.*)_(?:track|power|bar|fill)_/.exec(barName);
  if (match) return `${match[1]}_heading`;
  const suffix = /^(.*)_[0-9]+_/.exec(barName);
  if (suffix) return `${suffix[1]}_caption`;
  return null;
}

// =================================================================================================
// THE MATRIX. A `kind: 'matrix'` component that expands into nested `containerWindowType` cells.
//
// WHY THIS IS NOT A `gridBoxType`, AND WHY THAT MATTERS
//
// The obvious way to express a matrix is `gridBoxType`, and it does not work for a mod's own
// content. Measured over all 177 vanilla `.gui` files, counting the blocks that contain at least
// one nested ELEMENT keyword:
//
//   gridBoxType                 261 blocks   0 with a nested element
//   OverlappingElementsBoxType  189 blocks   0 with a nested element
//   smoothListBoxType           242 blocks   0 with a nested element
//   listBoxType                  43 blocks   0 with a nested element
//   containerWindowType        3305 blocks 2710 with a nested element
//
// Those four are ENGINE-POPULATED: the `.gui` declares an empty box with a slot size and the C++
// fills it. `interface/additional_content/additional_content.gui:331-345` is the proof in the
// install's own words - two empty grid boxes annotated "Use the positionTypes at the top of the
// file to change the slot size" / "...the max slots", i.e. the engine reads a `positionType` NAME
// (a literal in `stellaris.exe`: `additional_content_grid_spacing`) and sizes the grid from it. A
// mod's cells do not go in there. So a mod's matrix is one positioned container per cell, and the
// value this component adds is that the arithmetic is DONE rather than hand-typed: the reference
// construction in the working mod is a hand-built matrix whose row/column coordinates were
// computed by hand, which is exactly the class of edit that put a panel 150 px into the agenda
// group.
//
// WHAT IT EXPANDS TO
//
// ONE `containerWindowType` (the matrix frame, so the caller's `position` means what it says) whose
// children are, in document order: the optional column labels, the optional row labels, and one
// `containerWindowType` per occupied slot at
//
//   x = padding + (rowHeaderWidth ? rowHeaderWidth + gapX : 0) + column * (cellWidth + gapX)
//   y = padding + (columnHeaderHeight ? columnHeaderHeight + gapY : 0) + row * (cellHeight + gapY)
//
// and the frame is sized to hold exactly `rows` x `columns` of them. A slot may be left empty; an
// empty slot is not emitted at all, so a matrix of four corner cells does not put two invisible
// containers over the middle of something else.
//
// THE RULE THAT MAKES IT WORTH HAVING. `matrix-cell-overflow` is the defect a hand-built matrix
// actually ships: a cell whose content is wider or taller than its slot, which does not overlap
// anything (so `sibling-overlap` is silent) and does not leave the window (so `out-of-bounds` is
// silent) - it just draws over the next column. See `docs/gui-pitfalls.md` section 18.

export const MATRIX_RULE_SEVERITY = {
  'matrix-dimension-invalid': 'error',
  'matrix-cell-size-not-static': 'error',
  'matrix-cell-slot-out-of-range': 'error',
  'matrix-cell-slot-collision': 'error',
  'matrix-cell-overflow': 'error',
  'matrix-children-overflow': 'error',
  'matrix-header-count-mismatch': 'warning',
  'matrix-header-font-unknown': 'warning',
  // GAP-13: the engine REJECTS the file (`Unexpected token: <child keyword>` at load, whole child
  // block skipped), so this is an error rather than a layout nuance.
  'engine-populated-container-children': 'error',
};

export const MATRIX_RULE_DESCRIPTIONS = {
  'matrix-dimension-invalid': '`rows` / `columns` are not positive integers, so there is no grid to place cells in',
  'matrix-cell-size-not-static':
    '`cellWidth` / `cellHeight` is not a positive static pixel number. Every cell coordinate is derived from it and written into the file as a literal, so a `%`/`@var` cell size cannot be laid out',
  'matrix-cell-slot-out-of-range': "a cell's `row`/`column` is outside the declared `rows` x `columns` grid",
  'matrix-cell-slot-collision': 'two cells claim the same slot, so whichever the engine instantiates last wins and the other silently never appears',
  'matrix-cell-overflow':
    'a cell\'s content is larger than the slot it was placed in. It does not overlap a sibling or leave the window, so no other rule sees it - it simply draws over the next column',
  'matrix-children-overflow': 'more `children` were given than there are free slots, so the surplus has nowhere to go',
  'matrix-header-count-mismatch': '`columnHeaders` / `rowHeaders` is a different length from `columns` / `rows`, so some labels belong to no row or column',
  'matrix-header-font-unknown': 'a header font is not a `bitmapfont` the install defines',
  'engine-populated-container-children':
    'a child element inside `gridBoxType` / `OverlappingElementsBoxType` / `listBoxType` / `smoothListBoxType`. Measured: 0 of 261 / 189 / 43 / 242 vanilla blocks of those kinds contain a nested element - the ENGINE fills them - and the engine answers a child element with `Unexpected token: <keyword>` at FILE LOAD and skips the whole child block, so the file is rejected (probed in game on `gridBoxType`, 2026-10-06)',
};

/** Defaults for a matrix, chosen so the smallest legal matrix is a usable one. */
export const MATRIX_DEFAULTS = {
  /** A cell the size of the working mod's own matrix cells, whose rows are 18 px text. */
  cellWidth: 120,
  cellHeight: 24,
  gapX: 4,
  gapY: 2,
  padding: 6,
  /** The header font every list-like heading in the working mod uses. */
  headerFont: 'cg_16b',
  columnHeaderHeight: 20,
  rowHeaderWidth: 140,
};

/** Is this node a matrix component rather than an engine element? */
export function isMatrixNode(node) {
  const kind = node?.kind ?? node?.type;
  return typeof kind === 'string' && kind.toLowerCase() === 'matrix';
}

/** A static, positive pixel number, or null. `%`, `%%`, `@var` and negatives are NOT static. */
function staticPositive(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function firstStatic(...candidates) {
  for (const candidate of candidates) {
    const resolved = staticPositive(candidate);
    if (resolved !== null) return resolved;
  }
  return null;
}

/** The element name a slot's container gets. Stable, so an edit does not rename the matrix. */
export function matrixCellName(matrixName, row, column) {
  return `${matrixName ?? 'matrix'}_r${row}_c${column}`;
}

/**
 * Read a matrix node into geometry, or collect the reasons it cannot be laid out.
 *
 * @returns {{geometry: object|null, findings: object[]}}
 */
export function describeMatrix(node, context = {}) {
  const findings = [];
  const path = context.path ?? node?.name ?? node?.id ?? 'matrix';
  const name = node?.name ?? node?.id ?? 'matrix';
  const push = (rule, message, suggestedFix, extra = {}) => findings.push({
    rule,
    severity: MATRIX_RULE_SEVERITY[rule] ?? 'error',
    name,
    element: name,
    path,
    message,
    suggestedFix,
    ...extra,
  });

  const rows = Number.isInteger(node?.rows) ? node.rows : firstStatic(node?.rows);
  const columns = Number.isInteger(node?.columns) ? node.columns : firstStatic(node?.columns);
  if (!(rows >= 1) || !(columns >= 1)) {
    push(
      'matrix-dimension-invalid',
      `\`rows = ${JSON.stringify(node?.rows)}\` / \`columns = ${JSON.stringify(node?.columns)}\` is not a positive integer pair, so there is no grid.`,
      'pass `rows` and `columns` as positive integers, e.g. `rows: 6, columns: 5`.',
    );
    return { geometry: null, findings };
  }

  const cellWidth = firstStatic(node?.cellWidth, node?.cell?.width, node?.size?.width);
  const cellHeight = firstStatic(node?.cellHeight, node?.cell?.height, node?.size?.height);
  if (cellWidth === null || cellHeight === null || cellWidth < 1 || cellHeight < 1) {
    push(
      'matrix-cell-size-not-static',
      `\`cellWidth\`/\`cellHeight\` resolved to ${JSON.stringify(cellWidth)} x ${JSON.stringify(cellHeight)}. Every cell coordinate is written into the file as a literal, so the cell size has to be a static pixel number.`,
      'give `cellWidth`/`cellHeight` plain pixel numbers; a `%`/`%%`/`@variable` cell cannot be placed.',
    );
    return { geometry: null, findings };
  }

  const gapX = firstStatic(node?.gapX, node?.gap?.x) ?? MATRIX_DEFAULTS.gapX;
  const gapY = firstStatic(node?.gapY, node?.gap?.y) ?? MATRIX_DEFAULTS.gapY;
  const padding = firstStatic(node?.padding, node?.margin?.left) ?? MATRIX_DEFAULTS.padding;
  const columnHeaderHeight = firstStatic(node?.columnHeaderHeight) ?? (Array.isArray(node?.columnHeaders) && node.columnHeaders.length ? MATRIX_DEFAULTS.columnHeaderHeight : 0);
  const rowHeaderWidth = firstStatic(node?.rowHeaderWidth) ?? (Array.isArray(node?.rowHeaders) && node.rowHeaders.length ? MATRIX_DEFAULTS.rowHeaderWidth : 0);
  const headerFont = node?.headerFont ?? MATRIX_DEFAULTS.headerFont;

  if (Array.isArray(node?.columnHeaders) && node.columnHeaders.length !== columns) {
    push(
      'matrix-header-count-mismatch',
      `\`columnHeaders\` has ${node.columnHeaders.length} entries for ${columns} column(s).`,
      `give exactly ${columns} entries, or drop \`columnHeaders\`.`,
    );
  }
  if (Array.isArray(node?.rowHeaders) && node.rowHeaders.length !== rows) {
    push(
      'matrix-header-count-mismatch',
      `\`rowHeaders\` has ${node.rowHeaders.length} entries for ${rows} row(s).`,
      `give exactly ${rows} entries, or drop \`rowHeaders\`.`,
    );
  }

  const gridX = padding + (rowHeaderWidth > 0 ? rowHeaderWidth + gapX : 0);
  const gridY = padding + (columnHeaderHeight > 0 ? columnHeaderHeight + gapY : 0);
  const width = gridX + columns * cellWidth + (columns - 1) * gapX + padding;
  const height = gridY + rows * cellHeight + (rows - 1) * gapY + padding;

  return {
    geometry: {
      name,
      path,
      rows,
      columns,
      cellWidth,
      cellHeight,
      gapX,
      gapY,
      padding,
      columnHeaderHeight,
      rowHeaderWidth,
      headerFont,
      gridX,
      gridY,
      width,
      height,
      headersTextColour: node?.text_color_code ? String(node.text_color_code) : null,
      background: node?.background ?? null,
      backgroundSpriteField: node?.backgroundSpriteField ?? null,
    },
    findings,
  };
}

/** The box a slot occupies inside the matrix frame, in the frame's own coordinates. */
export function matrixCellBox(geometry, row, column) {
  if (!geometry) return null;
  return {
    x: geometry.gridX + column * (geometry.cellWidth + geometry.gapX),
    y: geometry.gridY + row * (geometry.cellHeight + geometry.gapY),
    width: geometry.cellWidth,
    height: geometry.cellHeight,
  };
}

/** Which cells a matrix node asked for, keyed `row:column`, plus the placement findings. */
function matrixSlots(node, geometry, findings, path, name) {
  const slots = new Map();
  const push = (rule, message, suggestedFix, extra = {}) => findings.push({
    rule,
    severity: MATRIX_RULE_SEVERITY[rule] ?? 'error',
    name,
    element: name,
    path,
    message,
    suggestedFix,
    ...extra,
  });
  const place = (row, column, child) => {
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= geometry.rows || column >= geometry.columns) {
      push(
        'matrix-cell-slot-out-of-range',
        `a cell was placed at row ${JSON.stringify(row)}, column ${JSON.stringify(column)}, outside the declared ${geometry.rows} x ${geometry.columns} grid (valid rows 0..${geometry.rows - 1}, columns 0..${geometry.columns - 1}).`,
        'widen `rows`/`columns`, or re-place the cell.',
      );
      return;
    }
    const key = `${row}:${column}`;
    if (slots.has(key)) {
      push(
        'matrix-cell-slot-collision',
        `two cells claim row ${row}, column ${column} (\`${slots.get(key).name ?? '(unnamed)'}\` and \`${child?.name ?? '(unnamed)'}\`). Only one can be on screen.`,
        'give one of them a different `row`/`column`.',
      );
      return;
    }
    slots.set(key, child ?? {});
  };

  // `cells: [{ row, column, node }]` - explicit placement.
  const explicit = Array.isArray(node?.cells) ? node.cells : [];
  for (const cell of explicit) {
    place(Number(cell?.row), Number(cell?.column), cell?.node ?? cell);
  }
  // `children` - row-major into the slots the explicit list did not take.
  const total = geometry.rows * geometry.columns;
  let free = 0;
  let surplus = 0;
  for (const child of node?.children ?? []) {
    let placed = false;
    while (free < total) {
      const row = Math.floor(free / geometry.columns);
      const column = free % geometry.columns;
      free += 1;
      if (!slots.has(`${row}:${column}`)) {
        place(row, column, child);
        placed = true;
        break;
      }
    }
    if (!placed) surplus += 1;
  }
  // THE SURPLUS IS REPORTED, not silently dropped. `free > total` was the wrong test: the loop
  // above stops with `free === total`, so the condition could never be true and the finding was
  // unreachable - a matrix with more children than slots lost them in silence.
  if (surplus > 0) {
    push(
      'matrix-children-overflow',
      `${surplus} of the ${(node.children ?? []).length} \`children\` have nowhere to go: the ${geometry.rows} x ${geometry.columns} grid has ` +
        `${total} slot(s) and the rest are taken (${slots.size} occupied).`,
      'raise `rows`/`columns`, or move the surplus into `cells` with an explicit slot.',
      { surplus, slots: total, occupied: slots.size },
    );
  }

  // A cell whose content is bigger than its slot. This is the defect the component exists to catch.
  for (const [key, child] of slots) {
    const [row, column] = key.split(':').map(Number);
    const box = matrixCellBox(geometry, row, column);
    const contentWidth = firstStatic(child?.size?.width, child?.size?.x, child?.width, child?.maxWidth);
    const contentHeight = firstStatic(child?.size?.height, child?.size?.y, child?.height, child?.maxHeight);
    const overX = contentWidth !== null ? contentWidth - box.width : 0;
    const overY = contentHeight !== null ? contentHeight - box.height : 0;
    if (overX > 0 || overY > 0) {
      push(
        'matrix-cell-overflow',
        `cell r${row}c${column} (\`${child?.name ?? '(unnamed)'}\`) is ${contentWidth ?? '?'}x${contentHeight ?? '?'} in a ${box.width}x${box.height} slot` +
          `${overX > 0 ? `, ${overX} px too wide` : ''}${overY > 0 ? `, ${overY} px too tall` : ''}. The content draws over the next ` +
          `${overX > 0 && overY > 0 ? 'column and row' : overX > 0 ? 'column' : 'row'} - without overlapping a sibling or leaving the window, so no other rule sees it.`,
        `raise \`cellWidth\`/\`cellHeight\` to at least ${Math.max(contentWidth ?? 0, box.width)}x${Math.max(contentHeight ?? 0, box.height)}, or shrink the cell's content.`,
        { row, column, cellBox: box, contentSize: { width: contentWidth, height: contentHeight } },
      );
    }
  }
  return slots;
}

/**
 * Turn one matrix node into the engine elements it stands for.
 *
 * @returns {object[]} the elements to splice in where the matrix node was
 */
export function buildMatrixUnit(node, geometry) {
  const findings = [];
  const name = geometry.name;
  const elements = [];
  const slots = matrixSlots(node, geometry, findings, geometry.path, name);

  // The frame. `size = { width height }` because the frame is a `containerWindowType`, which is the
  // only kind that takes the `%`/`%%`/negative size forms - and this one takes a computed literal.
  const frame = {
    kind: 'container',
    id: `${node.id ?? name}__matrix`,
    name,
    position: node.position ? { ...node.position } : { x: 0, y: 0 },
    orientation: node.orientation,
    origo: node.origo,
    size: { width: geometry.width, height: geometry.height },
    component: 'matrix',
    matrixGeometry: geometry,
    children: [],
  };
  if (node.background) {
    frame.background = typeof node.background === 'object' && node.background.sprite
      ? { ...node.background }
      : { name: `${name}_bg`, sprite: String(node.background), spriteField: node.backgroundSpriteField ?? 'quadTextureSprite' };
  }

  const textFor = (key, suffix, x, y, width, height, align) => ({
    kind: 'text',
    id: `${node.id ?? name}__${suffix}`,
    name: `${name}_${suffix}`,
    position: { x, y },
    font: geometry.headerFont,
    text: String(key),
    format: align,
    vertical_alignment: 'center',
    maxWidth: width,
    maxHeight: height,
    fixedSize: true,
    alwaysTransparent: true,
    ...(geometry.headersTextColour ? { text_color_code: geometry.headersTextColour } : {}),
    component: 'matrix',
    componentOf: name,
  });

  // Column labels sit in the header band; row labels in the header column. The name suffix is the
  // ROW/COLUMN INDEX, never the coordinate: a name that encodes a pixel position changes the moment
  // a cell size is tuned, and every edit would look like a rename in `gui_layout_diff`.
  (Array.isArray(node.columnHeaders) ? node.columnHeaders : []).slice(0, geometry.columns).forEach((key, column) => {
    elements.push(textFor(key, `col${column}`, geometry.gridX + column * (geometry.cellWidth + geometry.gapX), geometry.padding, geometry.cellWidth, geometry.columnHeaderHeight || geometry.cellHeight, 'center'));
  });
  (Array.isArray(node.rowHeaders) ? node.rowHeaders : []).slice(0, geometry.rows).forEach((key, row) => {
    elements.push(textFor(key, `row${row}`, geometry.padding, geometry.gridY + row * (geometry.cellHeight + geometry.gapY), geometry.rowHeaderWidth || geometry.cellWidth, geometry.cellHeight, 'left'));
  });

  // One container per OCCUPIED slot. An empty slot emits nothing at all.
  for (let row = 0; row < geometry.rows; row += 1) {
    for (let column = 0; column < geometry.columns; column += 1) {
      const child = slots.get(`${row}:${column}`);
      if (!child) continue;
      const box = matrixCellBox(geometry, row, column);
      const cell = { ...child };
      cell.kind = cell.kind ?? 'container';
      cell.id = cell.id ?? `${node.id ?? name}__r${row}c${column}`;
      cell.name = cell.name ?? matrixCellName(name, row, column);
      cell.position = { x: box.x, y: box.y };
      cell.component = 'matrix';
      cell.componentOf = name;
      cell.matrixCell = { row, column, box };
      elements.push(cell);
    }
  }
  // The placement findings ride on the frame so `expandMatricesInTree` can collect them.
  frame.matrixFindings = findings;
  // THE LABELS AND CELLS GO INSIDE THE FRAME. They are positioned in the frame's own coordinates
  // (`gridX`, `gridY`, the cell arithmetic), so emitting them as SIBLINGS of the frame would place
  // every one of them relative to the frame's PARENT and put the whole matrix in the wrong place -
  // and the frame would ship as an empty box with its contents floating beside it.
  frame.children = elements;
  return [frame];
}

/**
 * Expand every `kind: 'matrix'` node in a tree, in place.
 *
 * Runs AFTER the bar pass in `computeLayout`, so a matrix cell may contain a bar and the bar's own
 * expansion has already happened. Findings come back the way the bar pass returns them, and
 * `validate.mjs` folds them in (see `COMPONENT_RULE_SEVERITY`).
 */
export function expandMatricesInTree(root) {
  const findings = [];
  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return;
    const here = path ? `${path}/${node.name ?? node.id ?? '?'}` : node.name ?? node.id ?? 'root';
    if (Array.isArray(node.children)) {
      const replacement = [];
      for (const child of node.children) {
        if (!isMatrixNode(child)) {
          replacement.push(child);
          continue;
        }
        const childPath = `${here}/${child.name ?? child.id ?? '?'}`;
        const { geometry, findings: describeFindings } = describeMatrix(child, { path: childPath });
        findings.push(...describeFindings);
        if (!geometry) continue; // nothing legal can be written; the findings say why
        const unit = buildMatrixUnit(child, geometry);
        const frame = unit[0];
        findings.push(...(frame.matrixFindings ?? []));
        delete frame.matrixFindings;
        frame.matrixGeometry = geometry;
        replacement.push(...unit);
      }
      node.children = replacement;
    }
    for (const child of node.children ?? []) visit(child, path ? `${path}/${node.name ?? node.id ?? '?'}` : node.name ?? node.id ?? 'root');
  };
  visit(root, '');
  return findings;
}

/** Every expanded matrix in a tree, found by the `component: 'matrix'` marker the expansion leaves. */
export function collectMatrices(layout) {
  const frames = new Map();
  const cells = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.component === 'matrix') {
      if (node.matrixGeometry) frames.set(node.name, { node, geometry: node.matrixGeometry });
      else if (node.matrixCell) cells.push({ node, cell: node.matrixCell, of: node.componentOf });
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(layout?.root);
  return { frames: [...frames.values()], cells };
}

export default {
  REFERENCE_FILE,
  BAR_CONSTRUCTION,
  REFERENCE_RANKING_ROW,
  REFERENCE_BAND_ELEMENTS,
  REFERENCE_ROWS,
  BAR_DEFAULTS,
  BAR_FIELD_HELP,
  BAR_FIELD_NAMES,
  BAR_SPRITE_PALETTE,
  BAR_EMIT_ADDITIONS,
  COMPONENT_RULE_SEVERITY,
  COMPONENT_RULE_DESCRIPTIONS,
  referenceOffsets,
  barElementName,
  isBarNode,
  resolveBarSprite,
  describeBar,
  deriveBarGeometry,
  buildBarUnit,
  buildBarElements,
  barFieldsFromElements,
  applyBarClone,
  renameBarClone,
  expandBarsInTree,
  collectBars,
  barLabelBox,
  barTrackBox,
  headingNameForBar,
  MATRIX_DEFAULTS,
  MATRIX_RULE_SEVERITY,
  MATRIX_RULE_DESCRIPTIONS,
  isMatrixNode,
  matrixCellName,
  matrixCellBox,
  describeMatrix,
  buildMatrixUnit,
  expandMatricesInTree,
  collectMatrices,
};
