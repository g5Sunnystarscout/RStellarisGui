//------------------------------------------------------------------------------------
// validate.mjs -- Part of RStellarisGui
//
// The geometry validator. This is the deliverable that exists because an agent writing `.gui`
// blind cannot see its own mistakes: every finding carries coordinates, a severity, and a
// suggested fix, and the report always names the 1920x1080 base it was computed against.
//
// Rules implemented (P1):
//   root-invalid              file's root construct is not `guiTypes` (case-insensitive)
//   duplicate-name            the same `name` twice among siblings (vanilla requires unique)
//   zero-size                 declared size resolves to 0 on an element that draws something
//   negative-resolved-size    size resolves negative (usually pos already > parent)
//   sibling-overlap           two sibling rects intersect, above the decorative tolerance
//   out-of-bounds             element leaves the root window rect (/ the 1920x1080 base)
//   out-of-bounds-parked      the same overflow, but past `parkMargin`: a DELIBERATE park, counted
//                             separately from the escapes instead of inflating them (GAP-11)
//   unknown-sprite            sprite name is not defined by any .gfx
//   unknown-font              font name is not a `bitmapfont` in any .gfx
//   sprite-without-texture    sprite exists but declares no texturefile (informational)
//   effect-unresolved         effectbuttonType.effect is not a key in common/button_effects
//   effect-missing            effectbuttonType with no `effect` at all
//   visibility-scope-dependent       the effect's `potential` tests is_scope_type, so the control is
//                                    DRAWN OR NOT by the scope the window was opened in (GAP-12)
//   visibility-flag-scope-dependent  the same, one step out: a scope-specific FLAG in the potential
//   visibility-potential-scope-dependent  the same test on a window whose scope a caller GUARANTEED
//   missing-localisation      a text/tooltip field references a key that does not exist
//   orientation-unknown       orientation/origo spelling the engine would not recognise
//   undeclared-variable        `@var` used but never declared
//   option-button-convention   a custom_gui_option row lacks `option_button` / `OPTION_TEXT`
//   kind-not-emittable         element kind is recognised but not writable in P1
//   fixed-size-sprite-resized  a fixed-size `spriteType` given a different `size`
//
// DECORATIVE TOLERANCE (the rule that makes the report usable): overlapping rectangles are
// normal and intentional in Paradox UI - backgrounds sit under their own container's content,
// transparent overlays cover panels, and `alwaysTransparent` elements are explicitly
// mouse-transparent decoration. A naive "any overlap is an error" report is pure noise. So an
// overlap is only reported when ALL of these hold:
//   - the two elements are siblings (never a container and its own descendant)
//   - the overlapping area exceeds `overlapTolerance` (default 4 px^2)
//   - the overlap exceeds `overlapAreaRatio` of the smaller element (default 0.10)
//   - the overlap is not full containment of one box by the other
//   - neither element is `alwaysTransparent`, unless `flagTransparentOverlaps` is set
//
// SEVERITY POLICY - which findings are errors. A finding is an ERROR only when it cannot be
// intentional:
//   error   out-of-bounds, unknown-sprite, unknown-font, effect-unresolved, effect-missing,
//           root-invalid, duplicate-name, undeclared-variable, visibility-scope-dependent
//   warning sibling-overlap, zero-size, negative-resolved-size, orientation-unknown,
//           missing-localisation, visibility-flag-scope-dependent
//   info    sprite-without-texture, kind-not-emittable, fixed-size-sprite-resized,
//           out-of-bounds-parked, visibility-potential-scope-dependent
// Sizes of 0 ARE legal and used deliberately to hide vanilla elements (the community custom-GUI
// guide tells modders to do exactly that), which is why zero-size is a warning, not an error.
//
// The deliberately-legal size forms are never reported: `N%`, `N%%`, and negative sizes all
// resolve through layout.mjs and are only mentioned if the RESULT is negative.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { resolve as resolvePath } from 'node:path';

import { kindSpec, kindAcceptsField, kindsAcceptingField, isKnownField, isEngineRejectedField, isFieldRejectedForKind, kindRejectedFieldNote, equivalentForKind, isEnginePopulated, ENGINE_POPULATED_KINDS, normaliseAnchor, sizeFormFor, suggestFields, SIZE_FORMS } from './kinds.mjs';
import { COLONIZATION_SEVERITY, COLONIZATION_DESCRIPTIONS } from './colonization.mjs';
import { EVENT_NAMESPACE_SEVERITY, EVENT_NAMESPACE_DESCRIPTIONS } from './events.mjs';
import { PORTRAIT_SEVERITY, PORTRAIT_DESCRIPTIONS } from './portraits.mjs';
import { WORLDGFX_SEVERITY, WORLDGFX_DESCRIPTIONS } from './worldgfx.mjs';
import { COMPONENT_RULE_SEVERITY, COMPONENT_RULE_DESCRIPTIONS, MATRIX_RULE_SEVERITY, MATRIX_RULE_DESCRIPTIONS, collectBars, collectMatrices, barLabelBox, BAR_DEFAULTS, headingNameForBar } from './components.mjs';
import { DRIFT_RULE_SEVERITY, DRIFT_RULE_DESCRIPTIONS } from './override-drift.mjs';
import { measureElementText, wrapText, rectIntersection, sharedFontLibrary } from './font-metrics.mjs';
import { parseGuiText, computeLayout, walkLayout, collectVariables, makeSpriteLookup, topLevelContainers, BASE_RESOLUTION } from './layout.mjs';
import { looksLikeLocKey } from './loc-index.mjs';
import { checkGuiSyntax } from './syntax.mjs';
import { analyseEventWindows, checkParkedElements, CONTRACT_SEVERITY, CONTRACT_DESCRIPTIONS } from './contract.mjs';
import {
  buildButtonEffectAnalysis,
  normaliseScopeGuarantees,
  visibilityFindings,
  visibilityTableFor,
  VISIBILITY_DESCRIPTIONS,
  VISIBILITY_SEVERITY,
} from './visibility.mjs';

export const DEFAULT_OPTIONS = {
  /** Minimum overlapping area in px^2 before a sibling overlap is reported. */
  overlapTolerance: 4,
  /** Minimum overlap as a fraction of the smaller element before it is reported. */
  overlapAreaRatio: 0.1,
  /** Report overlaps between elements marked alwaysTransparent. */
  flagTransparentOverlaps: false,
  /** Also compare elements across different subtrees (expensive, off by default). */
  crossTreeOverlap: false,
  /** Check text fields against the localisation keyset. Silently skipped when absent. */
  checkLocalisation: true,
  /** Check sprite/font references against the asset index. Silently skipped when absent. */
  checkAssets: true,
  /** Report a root `containerWindowType` name that the install already defines. */
  checkContainerNames: true,
  /** Check `custom_gui` event windows against the engine's by-name contract, and parked elements. */
  checkCustomGuiContract: true,
  /** Window names an event's `custom_gui` points at (from the events, when the caller has them). */
  customGuiWindows: null,
  /** Run the contract check on every top-level container, not only the ones that look like windows. */
  checkAllWindows: false,
  /** Root window rectangle. Defaults to the layout's base resolution (1920x1080). */
  bounds: null,
  /** Skip out-of-bounds findings for elements with this flag (slide-in animations). */
  allowOffscreenAnimated: true,
  /**
   * Measure the RENDERED text extent (src/lib/font-metrics.mjs) and use it for the overlap and
   * overflow rules. On by default; silently skipped when no font catalogue is available, in
   * which case the box rules run exactly as before and the report says `textMeasured: false`.
   */
  measureText: true,
  /** Language whose font overrides apply (`english` -> bitmap fonts, `simp_chinese` -> TTF). */
  language: 'english',
  /** Minimum measured text-vs-text overlap in px^2 before `text-collision` is reported. */
  textCollisionTolerance: 1,
  /**
   * Read every element's `effect` against the `common/button_effects/` entry it names and report the
   * patterns that make a control's VISIBILITY depend on the scope the window was opened in
   * (`visibility-scope-dependent`, `visibility-flag-scope-dependent`) - GAP-12. The per-element
   * table is built whenever the effect files can be read, findings or not.
   */
  checkVisibility: true,
  /**
   * How far OUTSIDE the root rect an element is still treated as a layout problem rather than as a
   * deliberate park (`out-of-bounds-parked`) - GAP-11. The idiom this project uses to hide a
   * contract-required element is `position = { x = -3000 y = -3000 }`, which the geometry rule
   * counts as 3000 px of overflow; at that distance the element cannot be part of the window and
   * the report should say so instead of calling it an escape. 0 disables the classification.
   */
  parkMargin: 512,
};

/**
 * Rules that come from OUTSIDE the `.gui` file and are therefore folded in rather than written as
 * geometry checks: the visibility rules (GAP-12) read `common/button_effects/*.txt`.
 */
export const VISIBILITY_RULE_SEVERITY = VISIBILITY_SEVERITY;

/**
 * Severity of every rule, in one place.
 *
 * A finding is an ERROR only when it cannot be intentional. The table is exported because the
 * README's rule list is generated from it (see scripts/generate-docs.mjs): the documentation and
 * the code cannot disagree about what is an error if there is only one list.
 */
export const RULE_SEVERITY = {
  'root-invalid': 'error',
  'gui-parse-error': 'error',
  'size-not-accepted': 'error',
  'size-form-wrong': 'error',
  'duplicate-name': 'error',
  'container-name-collision': 'error',
  'out-of-bounds': 'error',
  'unknown-sprite': 'error',
  'unknown-font': 'error',
  'effect-unresolved': 'error',
  'effect-missing': 'error',
  'undeclared-variable': 'error',
  'option-button-convention': 'error',
  'sibling-overlap': 'warning',
  'text-overflow': 'warning',
  'text-collision': 'warning',
  'text-live-value': 'info',
  'zero-size': 'warning',
  'negative-resolved-size': 'warning',
  'size-indeterminate': 'warning',
  'orientation-unknown': 'warning',
  'missing-localisation': 'warning',
  'window-text-data-function': 'warning',
  'text-without-max-size': 'warning',
  'size-value-resolved': 'info',
  'size-unresolved': 'warning',
  'size-source-converted': 'info',
  'sprite-without-texture': 'info',
  'kind-not-emittable': 'info',
  'fixed-size-sprite-resized': 'info',
  'unused-variable': 'info',
  'unknown-field': 'info',
  'field-not-accepted': 'error',
  // GAP-16: the file-syntax half of the field rules. `field-not-accepted` covers a field that
  // belongs to ANOTHER kind; this one covers a token no kind declares at all, which the engine
  // answers with `Unexpected token: <token>` and a dropped block. Its own pass lives in
  // src/lib/syntax.mjs (`checkGuiSyntax`), and the model pass folds its findings in.
  'unexpected-token': 'error',
  // GAP-14's second half: the same RELATIVE `.gui` path in two providers is an override, not a
  // collision - the engine reads only the last `dlc_load.json` entry and never parses the loser.
  'container-path-override': 'info',
  // GAP-17: a `custom_gui` name no indexed root defines. Graded by path, so the table carries the
  // worst case (a `diplomatic = yes` event, where the measurement is a crash) and the finding itself
  // is a warning without it.
  'custom-gui-unknown-window': 'error',
  'field-translated': 'info',
  'field-dropped': 'warning',
  'unresolved-size': 'error',
  // The event-window contract and the parking traps (src/lib/contract.mjs). `custom-gui-contract-missing`
  // is the one that stands between a mod and a null-dereference crash, so it is an error.
  ...CONTRACT_SEVERITY,
  // THE VISIBILITY RULES (src/lib/visibility.mjs, GAP-12). A control's visibility can live in
  // `common/button_effects/*.txt` rather than in the `.gui`, so these are folded in from the module
  // that reads that file, the same way the contract rules are folded in from contract.mjs.
  ...VISIBILITY_SEVERITY,
  // GAP-11: a deliberately parked element (`-3000,-3000`) is reported as a PARK, not as an escape.
  // It is an info finding, not a suppressed one: the count is what says the report is not silent.
  'out-of-bounds-parked': 'info',
  // The bar component (src/lib/components.mjs). Its rules live WITH the primitive, so the thing
  // that enforces them and the thing that documents them are the same file; they are folded in
  // here so the README's generated rule table and `RULE_DESCRIPTIONS` carry them like any other.
  // The MATRIX and `engine-populated-container-children` rules come from the same module.
  ...COMPONENT_RULE_SEVERITY,
  ...MATRIX_RULE_SEVERITY,
  // THE OVERRIDE ANTI-DRIFT RULES (src/lib/override-drift.mjs). They are not produced by
  // `validateLayout` - they come from comparing two FILES, so `gui_override_drift` reports them -
  // but they are folded in here so the README's generated rule table carries them like any other
  // and an agent can search for `override-base-moved` and find it.
  ...DRIFT_RULE_SEVERITY,
  // THE COLONISATION AND ASTEROID RULES (src/lib/colonization.mjs). They read `common/ship_sizes/**`,
  // `common/planet_classes/**` and `common/asteroid_belts/**` rather than a `.gui`, and they are
  // folded in here so the README's generated rule table and RULE_DESCRIPTIONS carry them like any
  // other rule.
  ...COLONIZATION_SEVERITY,
  // THE PORTRAIT RULES (src/lib/portraits.mjs). They read `gfx/portraits/portraits/**` and
  // `gfx/models/portraits/**` rather than a `.gui`, and they are folded in here so the README's
  // generated rule table and RULE_DESCRIPTIONS carry them like any other rule. Both failures are
  // silent in game: a portrait whose `entity` no `.asset` defines, and a `character_textures`
  // entry that is in no indexed root.
  ...PORTRAIT_SEVERITY,
  // THE SYSTEM-LIGHT RULE (src/lib/worldgfx.mjs). It reads `gfx/worldgfx/*.txt` and
  // `gfx/lights/**/*.asset` rather than a `.gui`, and it is folded in here so the README's
  // generated rule table and RULE_DESCRIPTIONS carry it like any other rule. The engine names this
  // one itself, at load: `[gamerendering.cpp:1174]: Failed to create system light <name>`.
  ...WORLDGFX_SEVERITY,
  // THE EVENT-NAMESPACE RULE (src/lib/events.mjs). It is not produced by `validateLayout` - it
  // compares an event id against the `namespace =` declarations of the files it was handed - but
  // it is folded in here so the README's generated rule table carries it like any other and an
  // agent can search for `event-namespace-undeclared` and find it.
  ...EVENT_NAMESPACE_SEVERITY,
};

/**
 * One line per rule, in the rule's own words. The README's rule table is generated from this and
 * RULE_SEVERITY (scripts/generate-docs.mjs), so the documentation cannot describe a rule that no
 * longer exists, or miss one that does.
 */
export const RULE_DESCRIPTIONS = {
  'root-invalid': "the file's root construct is not `guiTypes` (case-insensitive)",
  'gui-parse-error': 'the lexer could not read the file at all',
  'size-not-accepted': 'a `size` block on a kind whose engine parser has no `size` token (text, icon)',
  'size-form-wrong': '`size = { width height }` on a kind that takes `size = { x y }`, or the reverse',
  'duplicate-name': 'the same `name` twice among siblings **within one window**',
  'container-name-collision': 'a root `containerWindowType` name the install already defines',
  'out-of-bounds': "leaves the root window rect; reports each side's overflow in px",
  'unknown-sprite': 'not defined by any `.gfx`; suggests near misses',
  'unknown-font': 'not a `bitmapfont`',
  'effect-unresolved': '`effectbuttonType.effect` is not a key in any indexed `common/button_effects/*.txt`',
  'effect-missing': '`effectbuttonType` with no `effect` at all',
  'undeclared-variable': '`@var` used but never declared',
  'option-button-convention': 'an `*_option` row without `option_button` / `OPTION_TEXT`',
  'sibling-overlap': 'two sibling rects intersect, above the decorative tolerance, **within one window**',
  'text-overflow':
    'the RENDERED string does not fit the element\'s `maxWidth`/`maxHeight` (measured from the engine\'s own font metrics, with wrapping modelled)',
  'text-collision':
    'two elements\' RENDERED text extents intersect, even though their boxes may not (this is what a wrapped block growing into the row below looks like)',
  'text-live-value':
    'a text element paints an UNRESOLVED `[$...$]` live value, so its measured width is what the token would need and not what the engine draws: reported ONCE instead of a false `text-overflow`, with the measurement attached (GAP-5)',
  'zero-size': 'legal (it is how modders hide vanilla elements), but worth a look',
  'negative-resolved-size': 'the declared form was legal but resolves negative',
  'size-indeterminate': 'no size and the sprite has no known natural size',
  'orientation-unknown': 'a spelling the engine would not recognise',
  'missing-localisation': 'a text/tooltip key that does not exist',
  'window-text-data-function': 'a `[Scope.Func]` / `[GetX]` bracket call inside a value a WINDOW paints as text: measured to render literally',
  'text-without-max-size': 'a text element with neither `maxWidth` nor `maxHeight`',
  'size-value-resolved': 'a percentage/negative size in an integer-only slot, resolved to pixels on emit',
  'size-unresolved': 'a size that is neither an integer nor an `@variable` and did not resolve',
  'size-source-converted': 'a size the emitter had to translate into the kind\'s own field',
  'sprite-without-texture': 'normal for generated sprites',
  'kind-not-emittable': 'recognised and laid out, but the emitter does not write this kind',
  'fixed-size-sprite-resized': 'a fixed `spriteType` given a different `size`',
  'unused-variable': 'declared but never referenced, so not emitted',
  'unknown-field': 'a field this project does not model on that kind',
  'field-not-accepted': 'a field that belongs to another element kind: the engine answers `Unexpected token: <field>`',
  'unexpected-token':
    'a scalar token NO kind declares and the install\'s 177 `.gui` files never write on that kind: the engine answers `Unexpected token: <token>` at file load and drops the enclosing block (GAP-16)',
  'container-path-override':
    'two providers of the SAME relative `.gui` path: an override, not a collision - the engine reads only the LAST entry in `dlc_load.json` and never parses the loser\'s file (GAP-14)',
  'custom-gui-unknown-window':
    '`custom_gui` names a `containerWindowType` no indexed root defines. ERROR on a `diplomatic = yes` event (the engine substitutes `ok_popup_window`, demands the diplomatic contract inside it and null-dereferences - measured), warning otherwise (the engine writes nothing at all, not even the lookup line, and draws the ordinary default event window instead) (GAP-17)',
  'field-translated': 'a field the emitter wrote in the form this kind actually accepts',
  'field-dropped': 'a field the emitter could not write on this kind at all',
  'unresolved-size': 'a size component that was written but cannot be evaluated',
  ...CONTRACT_DESCRIPTIONS,
  ...VISIBILITY_DESCRIPTIONS,
  'out-of-bounds-parked':
    'a deliberately parked element: this far outside the root it cannot be part of the window, so it is counted ' +
    'separately from a real escape (`out-of-bounds`) instead of inflating it',
  ...COMPONENT_RULE_DESCRIPTIONS,
  ...MATRIX_RULE_DESCRIPTIONS,
  ...DRIFT_RULE_DESCRIPTIONS,
  ...COLONIZATION_DESCRIPTIONS,
  ...PORTRAIT_DESCRIPTIONS,
  ...WORLDGFX_DESCRIPTIONS,
  ...EVENT_NAMESPACE_DESCRIPTIONS,
};

/**
 * Every text-bearing field, with the localisation-key semantics of each.
 *
 * `custom_tooltip` / `fail_text` are deliberately NOT here: they are SCRIPT fields (3777 and 158
 * uses inside `events/`, 0 on any .gui element). A GUI element's tooltip is `pdx_tooltip`
 * (button, text, icon, checkbox, container), `tooltipText`/`delayedTooltipText` (effectbutton,
 * button, guiButton) or `tooltip` (guiButton) - all measured, see kinds.mjs.
 */
const TEXT_FIELDS = [
  { field: 'text', kind: 'locKey' },
  { field: 'buttonText', kind: 'locKey' },
  { field: 'pdx_tooltip', kind: 'locKey' },
  { field: 'pdx_tooltip_delayed', kind: 'locKey' },
  { field: 'tooltip', kind: 'locKey' },
  { field: 'tooltipText', kind: 'locKey' },
  { field: 'delayedTooltipText', kind: 'locKey' },
];

/** Fields whose value names a sprite. */
const SPRITE_FIELDS = ['spriteType', 'quadTextureSprite'];

/**
 * Sentinel strings the engine understands in place of a localisation key. They are not defined
 * in any localisation file and must never be reported as missing keys.
 *
 * `OPTION_TEXT` is the documented one: an option row's button carries `text = "OPTION_TEXT"` and
 * the engine replaces it with the event option's own text (verified in vanilla at
 * interface/diplomacy_caravaneer_event_view.gui:15). The others are the same kind of engine
 * placeholder, kept conservative - only exact matches are exempted.
 */
const LOC_SENTINELS = new Set(['OPTION_TEXT', 'OPTION_TOOLTIP', 'NEWLINE', 'EMPTY']);

/**
 * Fields the WINDOW ITSELF paints. A tooltip field is deliberately not here: the engine resolves
 * bracket data functions in tooltips (9201 vanilla uses) but not in a window's painted text.
 *
 * MEASURED NEGATIVE, 2026-10-05, Stellaris 4.4.6: a `custom_gui` event window's
 * `instantTextBoxType.text` printed `[Root.GetName]` literally on screen (the player read
 * `[Root.Ge ...` in the middle of the donut chart; the mod's localisation value was
 * `unga_chart_center_value:0 "[Root.GetName]"`). Vanilla's own single counter-example is
 * scope-FREE - `interface/situation_log_timelines.gui` `TIMELINE_EVENT_YEAR` ->
 * `localisation/english/main_2_l_english.yml:995` `"[GetYear]"` - so the honest rule is: an
 * element that paints text must not depend on a bracket call at all. Static text, or a tooltip.
 */
const WINDOW_TEXT_FIELDS = ['text', 'buttonText'];

/**
 * The first `[Scope.Func]` / `[GetX]` / `[?var]` data function in a localisation value, or null.
 *
 * A bracket call whose entire content is ONE unexpanded localisation token
 * (`[$GetUngaAttUnNato$]`) is NOT returned (GAP-5, second half). Measured on the working mod: all
 * 32 of its live readouts are `[$GetUnga<...>$]`, where the token is a `common/scripted_loc`
 * `defined_text` name that this tool cannot resolve at load time - and each one was reported as a
 * bracket data function that "renders literally", which is the same 32 findings as the false
 * overflows under a second rule name. The distinction is real and it is the one the two channels
 * differ by: `[Root.GetName]` IS painted literally in a window's text (section 11, measured in
 * game), while `[$Token$]` is substituted before the engine reads it. Nothing here can PROVE the
 * latter for a token it cannot resolve, so the honest answer is to leave that judgement to the
 * live-value rule, which knows the channel.
 */
function bracketDataFunction(value) {
  if (typeof value !== 'string' || !value.includes('[')) return null;
  const pattern = /\[[^\]\n]*(?:[A-Za-z0-9_]\.[A-Za-z0-9_]|Get[A-Za-z0-9_]*|\?)[^\]\n]*\]/g;
  for (const match of value.matchAll(pattern)) {
    const inner = match[0].slice(1, -1);
    if (/^\s*\$[A-Za-z0-9_.\-]+\$\s*$/.test(inner)) continue;
    return match[0];
  }
  return null;
}

function rectOf(box) {
  return { x: box.rect.x, y: box.rect.y, width: box.rect.width, height: box.rect.height };
}

function intersectionArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

function contains(outer, inner, epsilon = 0.01) {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

/** One line, short: for quoting a string inside a finding message. */
function shorten(value, max = 24) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}~` : text;
}

/**
 * Validate a layout tree.
 *
 * @param {object} layout the component tree (see layout.mjs)
 * @param {{assets?: object, localisation?: {keys: Set<string>}|null, buttonEffects?: Set<string>|null,
 *          sourceFiles?: string[], options?: object}} context
 * @returns {object} report
 */
export function validateLayout(layout, context = {}) {
  const options = { ...DEFAULT_OPTIONS, ...(context.options ?? {}) };
  const base = options.bounds ?? layout.baseResolution ?? BASE_RESOLUTION;
  const bounds = { x: 0, y: 0, width: base.width, height: base.height };
  const assets = options.checkAssets ? context.assets ?? null : null;
  const locKeys = options.checkLocalisation ? context.localisation?.keys ?? null : null;
  const locValues = options.checkLocalisation ? context.localisation?.values ?? null : null;
  // A layout may declare its own button effects (which the emitter will write as
  // common/button_effects/*.txt). Those keys are therefore resolvable even though the install
  // does not define them yet, so fold them in before checking `effect`.
  const declaredEffects = new Set([
    ...Object.keys(layout.effects ?? {}),
    ...Object.keys(context.pendingButtonEffects ?? {}),
  ]);
  const extraEffectKeys = [];
  // A PROVIDED keyset is authoritative even when it is EMPTY. An earlier revision fell through to
  // `null` when the caller supplied an empty set, which meant `buttonEffectsChecked` came back false
  // and `effect-unresolved` could not be triggered on purpose - so the rule could not be tested, and
  // a caller who indexed a mod's button_effects and found none got "not checked" instead of "none".
  const effectKeySources = [context.buttonEffects, ...(context.extraButtonEffects ?? [])].filter(
    (source) => source !== null && source !== undefined,
  );
  for (const source of effectKeySources) {
    if (source instanceof Set) extraEffectKeys.push(...source);
    else extraEffectKeys.push(...Object.keys(source));
  }
  const buttonEffects =
    effectKeySources.length > 0
      ? new Set([...extraEffectKeys, ...declaredEffects])
      : assets
        ? new Set([...Object.keys(assets.buttonEffects ?? {}), ...declaredEffects])
        : declaredEffects.size > 0
          ? declaredEffects
          : null;
  // Recorded on the context so `finish` can report whether the effect check actually RAN, rather
  // than whether some particular input happened to be present (an earlier version reported false
  // while checking against the install's own two keys).
  context.buttonEffectsResolved = buttonEffects !== null;

  const findings = [];
  const add = (finding) => findings.push({ suggestedFix: null, ...finding });

  // Sprites with no declared `size` draw at their texture's natural size, so the rect math
  // needs the asset index to resolve them. Without this, every unsized icon would be reported
  // as a zero-size element.
  const spriteLookup = makeSpriteLookup(assets);
  // The component expansion runs inside `computeLayout`, which is what lets the preview and the
  // rect table see a bar's pieces too; the findings it refuses a bar over come back on `issues`,
  // and they are first-class findings here. `barGeometry` (why a well-formed bar is not a finding)
  // is kept on the expanded node by components.mjs. The MATRIX pass reports on the same channel.
  const { boxes, issues } = computeLayout(layout, { baseWidth: base.width, baseHeight: base.height, spriteLookup });
  for (const issue of issues) {
    if (COMPONENT_RULE_SEVERITY[issue.rule] || issue.rule?.startsWith('bar-') || issue.rule?.startsWith('matrix-')) add({ ...issue });
  }
  const variables = collectVariables(layout);
  // box.path is already the dot path from computeLayout; an earlier revision called a helper
  // that re-walked the whole tree for every node, which is O(n^2) on a 1000-element tree.
  const pathOfBox = (box) => box.path;

  // ---------------------------------------------------------------- rendered text extents
  //
  // The rules below are about TEXT, so they are computed from the measured rendered extent, not
  // from the element's box. `maxWidth`/`maxHeight` are the box the engine lays text out IN; a
  // finding built on those numbers alone cannot tell a three-character label in a 300px field
  // from a wrapped paragraph that grew past its `maxHeight` and landed on the row below.
  //
  // The measurer is optional on purpose: without a font catalogue (a unit test with a synthetic
  // layout, or an install we could not read) nothing is measured and every box rule behaves
  // exactly as it did before, with the report saying `textMeasured: false` so the difference is
  // never silent.
  const language = options.language ?? 'english';
  const measurementRoot = context.gameRoot ?? assets?.root ?? null;
  // Nothing can be measured without the strings, so the font descriptors are only loaded when a
  // resolver or a values map is actually present. Without this, every validation would read the
  // install's font .gfx files to discover that it has no text to measure.
  const canResolve = Boolean(context.resolveLocalisation) || Boolean(locValues?.size);
  const fontLibrary =
    context.fontLibrary ??
    (options.measureText && canResolve ? sharedFontLibrary(measurementRoot, language) : null);
  const measurements = new Map();
  if (fontLibrary) {
    for (const box of boxes) {
      const key = box.node?.text ?? box.node?.buttonText ?? null;
      if (typeof key !== 'string' || key === '') continue;
      let measured;
      try {
        measured = measureElementText(box, {
          library: fontLibrary,
          language,
          values: locValues ?? null,
          resolveLocalisation: context.resolveLocalisation ?? null,
          iconWidth: context.iconWidth ?? null,
        });
      } catch {
        continue;
      }
      if (measured.measured) measurements.set(box, measured);
    }
  }
  /**
   * The rect that actually puts pixels on screen: the MEASURED text extent where the string
   * resolved, otherwise the element's own box (a background, an icon, a sprite).
   *
   * A pair of text elements whose BOXES overlap but whose GLYPHS do not is a box artefact - the
   * single largest source of noise in a hand-written Paradox UI, where a full-width label field
   * sits inside a full-width background. Only pairs where the ink really intersects keep a
   * finding, and `inkOf` returning the box for an unmeasured element makes the rule degrade to
   * exactly its old behaviour when nothing could be measured.
   *
   * A LIVE VALUE FALLS BACK TO ITS BOX (GAP-5): the measured extent is the width of an unresolved
   * `[$GetX$]` token, not of anything that will be painted, so charging it as ink reports a
   * collision between a readout and a neighbouring element that the player never sees. The box is
   * the honest extent for a string whose drawn width is unknown, which is the same rule the
   * unmeasured case already follows.
   */
  const inkOf = (box) => (measurements.get(box)?.live && measurements.get(box)?.liveOnResolvingChannel ? rectOf(box) : measurements.get(box)?.textRect ?? rectOf(box));
  /** True when this element's measured ink is an unresolved live token rather than painted text. */
  const isLiveInk = (box) => Boolean(measurements.get(box)?.live && measurements.get(box)?.liveOnResolvingChannel);
  const anyMeasured = (first, second) => measurements.has(first) || measurements.has(second);
  /**
   * How much of the box-overlap noise the measurement removed.
   *
   * This is the number that says whether `sibling-overlap` was mostly a box artefact: every pair
   * that reached the reporting threshold is counted, and `suppressedByMeasurement` counts the
   * ones whose INK does not actually reach the other element.
   */
  const overlapBreakdown = {
    candidates: 0,
    reported: 0,
    suppressedByMeasurement: 0,
    textPairsMeasured: 0,
    textPairsBoxOverlapping: 0,
    textPairsInkOverlapping: 0,
    wrapInducedCollisions: 0,
  };

  // ---------------------------------------------------------------- root validity
  const rootKeyword = context.rootKeyword;
  if (rootKeyword !== undefined && !/^guiTypes$/i.test(rootKeyword)) {
    add({
      rule: 'root-invalid',
      severity: 'error',
      where: context.sourceFiles?.[0] ?? 'layout',
      message:
        `root construct is \`${rootKeyword}\`, not \`guiTypes\`. A .gui file's root MUST be ` +
        '`guiTypes = { ... }` (compared case-insensitively); a bare element at the top level is a parse error.',
      suggestedFix: 'wrap every element in `guiTypes = { ... }`. `@variable` lines may precede it.',
    });
  }
  if (!layout.root) {
    add({
      rule: 'root-invalid',
      severity: 'error',
      where: context.sourceFiles?.[0] ?? 'layout',
      message: 'layout has no root element',
      suggestedFix: 'set `root` to a container element.',
    });
    return finish(findings, base, options, context);
  }

  const byParent = new Map();
  for (const box of boxes) {
    // Grouped by PARENT IDENTITY, not by id string: see the `parentIndex` note in layout.mjs.
    const key = box.parentIndex ?? '(none)';
    byParent.set(key, [...(byParent.get(key) ?? []), box]);
  }

  // ---------------------------------------------------------------- window scoping (A1)
  //
  // An imported `.gui` file's top-level `containerWindowType`s are SIBLINGS under a synthetic
  // root, and only one `custom_gui` window is ever on screen at a time. So:
  //   * two elements in DIFFERENT windows must never be compared - neither for a duplicate
  //     name nor for an overlap. Vanilla proves the names may repeat across windows:
  //     interface/galactic_community_view.gui declares `council_flag_bg` twice and
  //     `focus_container` three times, and a merged six-window file repeats its nav bar six
  //     times. An earlier revision reported 50 `duplicate-name` errors and 20 `sibling-overlap`
  //     warnings on such a file.
  //   * two elements in the SAME window are still compared.
  //   * the window NAMES themselves are still compared with each other, because a
  //     `custom_gui = "<name>"` resolves a window by name and two windows sharing one is a real
  //     (if rare) defect. Vanilla's 177 files contain no such duplicate.
  const synthetic = layout.root?.syntheticRoot === true;
  const rootBoxIndex = boxes.find((box) => box.syntheticRoot)?.boxIndex ?? null;
  const windowOf = (box) => {
    if (!synthetic || rootBoxIndex === null) return 0;
    let cursor = box;
    while (cursor && cursor.parentIndex !== null && cursor.parentIndex !== undefined) {
      if (cursor.parentIndex === rootBoxIndex) return cursor.boxIndex;
      cursor = boxes[cursor.parentIndex];
    }
    return -1; // the synthetic root, or a box above it: part of no window
  };
  const windowKeys = new Map(boxes.map((box) => [box.boxIndex, windowOf(box)]));
  const inSameWindow = (a, b) => windowKeys.get(a.boxIndex) === windowKeys.get(b.boxIndex) && windowKeys.get(a.boxIndex) !== -1;
  const sameNameScope = (a, b) =>
    inSameWindow(a, b) || (a.parentIndex === rootBoxIndex && b.parentIndex === rootBoxIndex);

  // ---------------------------------------------------------------- visibility (GAP-12)
  //
  // A CONTROL'S VISIBILITY CAN LIVE OUTSIDE THE .gui. An `effectbuttonType` carries no visibility of
  // its own: `effect = "<key>"` names a top-level block in `common/button_effects/*.txt`, and THAT
  // block's `potential = { ... }` decides whether the button is drawn at all. A `potential` is a
  // statement about the CURRENT SCOPE, and a `custom_gui` window's scope is decided by HOW THE PLAYER
  // GOT THERE - so a potential testing `is_scope_type` makes the control vanish by ROUTE. The mod
  // this rule came from hit it for real: 89 of 105 buttons hid outside a planet scope, and the
  // engine-drawn option sidebar stayed visible because no `button_effects` entry can reach it.
  //
  // The TABLE is the deliverable as much as the finding is: a condition that is true on one route and
  // false on another cannot be shown by a findings-only report, so every element carrying an `effect`
  // is joined to its entry's `potential` here, whether or not anything is wrong with it.
  const windowNameOf = (box) => {
    const key = windowKeys.get(box.boxIndex);
    if (key === null || key === undefined || key === -1) return box.syntheticRoot ? (box.name ?? null) : null;
    return boxes[key]?.name ?? null;
  };
  const scopeGuarantees = normaliseScopeGuarantees(context.visibilityScopeGuarantees ?? options.visibilityScopeGuarantees ?? null);
  const effectAnalysis = options.checkVisibility
    ? buildButtonEffectAnalysis({
        effectFiles: [...(context.buttonEffectFiles ?? []), ...(assets?.buttonEffectPaths ?? [])].filter(Boolean),
        effectRoots: context.buttonEffectRoots ?? [],
      })
    : { effects: new Map(), files: [] };
  const visibility = options.checkVisibility
    ? visibilityTableFor(boxes, {
        effects: effectAnalysis.effects,
        customGuiWindows: options.customGuiWindows ?? [],
        scopeGuarantees,
        windowOf: windowNameOf,
      })
    : { rows: [], summary: null };
  if (options.checkVisibility) {
    for (const finding of visibilityFindings(visibility.rows, { customGuiWindows: options.customGuiWindows ?? [] })) {
      add({ severity: VISIBILITY_SEVERITY[finding.rule] ?? 'warning', ...finding });
    }
  }
  // The per-WINDOW answer to "is this scope guaranteed here", reported for every top-level window
  // the file declares - including the ones with no `effect` at all. A window whose scope was not
  // established is the risky case, so it is listed rather than omitted, and `customGuiWindow` says
  // whether an event names it (which is what decides error vs warning above).
  if (options.checkVisibility) {
    const scopeOfWindow = new Map();
    for (const box of boxes) {
      const key = windowKeys.get(box.boxIndex);
      if (key === null || key === undefined || key === -1 || scopeOfWindow.has(key)) continue;
      scopeOfWindow.set(key, box.name ?? null);
    }
    const perWindow = [];
    for (const [key, name] of scopeOfWindow) {
      perWindow.push({
        window: name,
        kind: boxes[key]?.kind ?? null,
        scopeGuarantee: name ? scopeGuarantees[name] ?? null : null,
        customGuiWindow: name ? (options.customGuiWindows ?? []).includes(name) : false,
      });
    }
    context.visibilityWindows = perWindow;
  }
  context.visibility = visibility;
  context.visibilityEffectFiles = effectAnalysis.files;

  for (const box of boxes) {
    const where = box.node?.sourceFile
      ? `${box.node.sourceFile}:${box.node.sourceLine ?? '?'}`
      : box.path;
    const rect = rectOf(box);

    // ------------------------------------------------------------ duplicate names
    const siblings = byParent.get(box.parentIndex ?? '(none)') ?? [];
    const sameName = siblings.filter(
      (other) => other.name && other.name === box.name && (other === box || sameNameScope(box, other)),
    );
    if (box.name && sameName.length > 1 && sameName[0] === box) {
      add({
        rule: 'duplicate-name',
        severity: 'error',
        where,
        path: box.path,
        element: box.name,
        kind: box.kind,
        rect,
        message:
          `\`name = "${box.name}"\` is used ${sameName.length} times among siblings within the same window. Element ` +
          'names must be unique within a window, otherwise the engine resolves references to whichever it finds first. ' +
          '(Names may repeat across top-level windows: only one custom_gui window is on screen at a time, and vanilla ' +
          'does exactly that in interface/galactic_community_view.gui.)',
        suggestedFix: `rename to e.g. \`${box.name}_2\`.`,
        related: sameName.map((other) => ({ path: other.path, where: other.node?.sourceFile })),
      });
    }

    // ------------------------------------------------------------ kind emittability
    const spec = kindSpec(box.kind);

    // ------------------------------------------------------------ engine-populated containers
    //
    // A `gridBoxType` / `OverlappingElementsBoxType` / `listBoxType` / `smoothListBoxType` is a box
    // the C++ FILLS. Measured over the install's 177 `.gui` files, counting blocks with at least one
    // nested ELEMENT keyword inside their braces:
    //
    //   gridBoxType                 261 blocks   0 with a nested element
    //   OverlappingElementsBoxType  189 blocks   0 with a nested element
    //   smoothListBoxType           242 blocks   0 with a nested element
    //   listBoxType                  43 blocks   0 with a nested element
    //
    // The install says why in its own comments: `interface/additional_content/additional_content.gui`
    // :331-345 declares two EMPTY grid boxes and annotates their `slotSize` / `max_slots_horizontal`
    // with "Use the positionTypes at the top of the file to change the slot size" / "...the max
    // slots" - the engine reads a `positionType` NAME (a literal in `stellaris.exe`) and sizes the
    // grid itself. A mod that wants its own cells needs the `matrix` component, which expands into
    // `containerWindowType`s (src/lib/components.mjs).
    //
    // THE NAMES ARE GLOBAL, and this comment used to say they were referenced nowhere. Measured
    // 2026-10-06: 163 of the 224 line-rule `positionType` names are contiguous literals in the exe,
    // 6 are named in another `.gui` (5 of those in comments), and one of those comments is the
    // install stating the mechanism - `customize_species_shipsets.gui:21`, "Size is overriden by code
    // with the value of the positionType \"ship_browser_3d_view_size\"". Re-pointing an anchor is
    // therefore possible but means a WHOLE-FILE override of the `.gui` that declares it, with a base
    // hash: `positiontype-is-a-global-named-anchor`.
    //
    // AND THE ENGINE DOES NOT IGNORE THE CHILD, IT REJECTS THE FILE (GAP-13). The in-game probe of
    // 2026-10-06 put a real child element in a grid box; `error.log`, verbatim:
    //
    //   [23:50:06][persistent.cpp:41]: Error: "Unexpected token: instantTextBoxType, near line: 31
    //   " in file: "interface/zz_gui_probe_grid.gui" near line: 38
    //
    // one line per child element, at FILE LOAD, naming the child's keyword and the span it skipped -
    // and nothing from inside the skipped block, so the child block is discarded whole. That is why
    // this is an ERROR and why the message says the file is rejected rather than "not laid out".
    // Only `gridBoxType` was probed: the other three are expected to answer the same way (same token
    // class) and the message says they were not measured.
    if (spec && isEnginePopulated(spec) && (box.node?.children ?? []).length > 0) {
      const children = box.node.children;
      // The engine's own line, in the engine's own shape, when the tree came from a FILE (a parsed
      // node carries the keyword it used and, for a top-level container, its line). A tree a caller
      // built has neither, and the message then says the child's kind instead of inventing a line.
      const first = children[0];
      const childKeyword = first.keyword ?? kindSpec(first.kind)?.keywords?.[0] ?? spec.keywords[0];
      const childLine = first.sourceLine ?? first.line ?? null;
      add({
        rule: 'engine-populated-container-children',
        severity: 'error',
        where,
        path: box.path,
        element: box.name,
        kind: box.kind,
        rect,
        engineMessage: childLine
          ? `Unexpected token: ${childKeyword}, near line: ${childLine}`
          : `Unexpected token: ${childKeyword}`,
        message:
          `\`${spec.keywords[0]}\` has ${children.length} child element(s), but this kind is FILLED BY THE ENGINE: ` +
          `measured over the install, 0 of the vanilla blocks of this kind contain a nested element. The engine reports ` +
          `"Unexpected token: <the child's keyword>" at FILE LOAD - one line per child - and SKIPS THE WHOLE CHILD BLOCK, ` +
          `so the file is rejected rather than merely laid out differently, and nothing inside the skipped block is read. ` +
          `Only \`gridBoxType\` was probed in game (2026-10-06): \`OverlappingElementsBoxType\`, \`listBoxType\` and ` +
          `\`smoothListBoxType\` measure 0 nested elements too, but the engine's answer for them was NOT measured. ` +
          `The box's geometry and \`slotSize\` are real fields; the ITEMS are whatever C++ puts there (for a grid, sized ` +
          `from a \`positionType\` name the engine looks up - a GLOBAL anchor: 163 of the 224 line-rule names are contiguous ` +
          `literals in \`stellaris.exe\`, and re-pointing one means replacing the whole \`.gui\` that declares it).`,
        suggestedFix:
          'for your OWN cells use the `matrix` component (expands into positioned `containerWindowType`s); keep this box only ' +
          'if the engine is meant to fill it.',
        enginePopulatedKinds: [...ENGINE_POPULATED_KINDS],
      });
    }

    if (spec && !spec.emitter) {
      add({
        rule: 'kind-not-emittable',
        severity: 'info',
        where,
        path: box.path,
        element: box.name,
        kind: box.kind,
        rect,
        message:
          `\`${spec.keywords[0]}\` is recognised (${spec.vanillaUses} uses in vanilla) but the emitter does ` +
          'not write this kind yet. It is laid out and validated, and will be reported rather than emitted.',
        suggestedFix: `rebuild this element as one of: ${emittableKindNames().join(', ')}.`,
      });
    }

    // ------------------------------------------------------------ the size field the engine wants
    //
    // The engine's parsers own the size keyword per kind, and the wrong one is a parse error, not
    // a cosmetic difference. Verified against the engine's own log (see syntax.mjs) and the whole
    // vanilla corpus (see kinds.mjs):
    //   * instantTextBoxType has NO `size` token: "Unexpected token: size" then
    //     "Not used, use maxWidth and maxHeight". It is sized by maxWidth/maxHeight.
    //   * iconType has no `size` token either - the same error, measured on the trial file's
    //     line 56 - and draws at its sprite texture's natural size.
    //   * button/listBox/gridBox/scrollbar take a `size` with a specific sub-key spelling.
    if (spec) {
      const { form } = sizeFormFor(spec, spec.keywords[0]);
      const sizeSpec = box.node?.size;
      const elementSize = sizeSpec ? { value: sizeSpec, raw: box.node?.sizeRaw ?? sizeSpec } : null;
      if (elementSize && form === SIZE_FORMS.maxWidthHeight) {
        const convertible = ['width', 'height'].every((axis) => {
          const value = sizeSpec[axis];
          if (value === undefined || value === null) return true;
          return typeof value === 'number' || /^-?[0-9]+$/.test(String(value).trim()) || /^@[A-Za-z0-9_]+$/.test(String(value).trim());
        });
        add({
          rule: 'size-not-accepted',
          severity: convertible ? 'warning' : 'error',
          where,
          path: `${box.path}.size`,
          element: box.name,
          kind: box.kind,
          rect,
          engineMessage: 'Unexpected token: size / Not used, use maxWidth and maxHeight',
          message:
            `\`instantTextBoxType\` (name = "${box.name}") declares \`size = { ${Object.entries(sizeSpec)
              .map(([key, value]) => `${key} = ${value}`)
              .join(' ')} }\`, but the engine's text parser has no \`size\` token: it answers "Unexpected token: size" ` +
            'and "Not used, use maxWidth and maxHeight". 3138 of 3202 vanilla text blocks carry `maxWidth` and 2890 ' +
            'carry `maxHeight`; none carries `size`.' +
            (convertible
              ? ' The emitter writes this size as `maxWidth`/`maxHeight`, so the emitted file is legal.'
              : ' This size is not expressible as `maxWidth`/`maxHeight`, so the emitted file would have no usable width.'),
          suggestedFix: `replace it with \`maxWidth = ${sizeSpec.width ?? 0}\` and \`maxHeight = ${sizeSpec.height ?? 0}\`.`,
        });
      }
      if (elementSize && form === SIZE_FORMS.none && spec.kind === 'icon') {
        const natural = naturalSizeOf(assets, box.node);
        const matches = natural && natural.width === box.rect.width && natural.height === box.rect.height;
        add({
          rule: 'size-not-accepted',
          severity: matches || !natural ? 'warning' : 'error',
          where,
          path: `${box.path}.size`,
          element: box.name,
          kind: box.kind,
          rect,
          engineMessage: 'Unexpected token: size',
          message:
            `\`iconType\` (name = "${box.name}") declares \`size = { width = ${box.rect.width} height = ${box.rect.height} }\`, ` +
            'but the engine parses `iconType` without a `size` token and reports "Unexpected token: size" for the block. ' +
            '0 of 2779 vanilla icons declare one.' +
            (natural
              ? matches
                ? ` The sprite's texture is already ${natural.width}x${natural.height}, so the emitted file is identical either way - the emitter drops the declaration.`
                : ` The sprite \`${box.node?.spriteType ?? box.node?.quadTextureSprite}\` is ${natural.width}x${natural.height}, so the icon will draw at THAT size, not ${box.rect.width}x${box.rect.height}.`
              : ' The emitter drops the declaration; the icon draws at its sprite texture size.'),
          suggestedFix: matches
            ? 'delete the `size` block: it is redundant.'
            : 'pick a sprite whose texture is already the size you want, or put the icon inside a containerWindowType and size the container.',
        });
      }
    }

    // ------------------------------------------------------------ size sanity
    const declaredWidth = box.node?.size?.width ?? box.node?.size?.x;
    const declaredHeight = box.node?.size?.height ?? box.node?.size?.y;
    const hasDeclaredSize = declaredWidth !== undefined || declaredHeight !== undefined;
    if (box.trace.sizeIndeterminate) {
      // Most vanilla containers omit `size` and are sized by their sprite or by the engine, so an
      // indeterminate size is only worth reporting when the element is supposed to draw
      // something or has children whose geometry depends on it. Reporting every one produced
      // 17k findings on the vanilla corpus.
      const matters = Boolean(
        box.node?.text ||
          box.node?.buttonText ||
          box.node?.spriteType ||
          box.node?.quadTextureSprite ||
          box.node?.effect ||
          (box.node?.children ?? []).length > 0,
      );
      if (matters) {
        add({
          rule: 'size-indeterminate',
          severity: 'warning',
          where,
          path: box.path,
          element: box.name,
          kind: box.kind,
          rect,
          message:
            'no size is declared and the sprite supplies no natural size, so the geometry of this element ' +
            'and everything under it cannot be computed. Usually the sprite name is wrong or its texture is missing.',
          suggestedFix: hasDeclaredSize
            ? 'the declared size did not resolve; check the field names and any `@variable` references.'
            : 'declare an explicit `size = { width = N height = N }`.',
        });
      }
    }
    if (hasDeclaredSize && (box.rect.width === 0 || box.rect.height === 0) && !box.trace.sizeIndeterminate) {
      const drawsSomething = Boolean(
        box.node?.text || box.node?.buttonText || box.node?.spriteType || box.node?.quadTextureSprite,
      );
      add({
        rule: 'zero-size',
        severity: drawsSomething ? 'warning' : 'info',
        where,
        path: box.path,
        element: box.name,
        kind: box.kind,
        rect,
        message:
          `size resolves to 0 (${box.rect.width} x ${box.rect.height}) on an element that ` +
          (drawsSomething ? 'draws text or a sprite' : 'has no content') +
          '. A zero size is legal and is how modders hide vanilla elements, so this is only a warning.',
        suggestedFix: drawsSomething
          ? 'give it a positive size, or remove the now-invisible content.'
          : 'intentional if this element exists only to hide a vanilla one; otherwise remove it.',
      });
    }
    if (box.rect.width < 0 || box.rect.height < 0) {
      add({
        rule: 'negative-resolved-size',
        severity: 'warning',
        where,
        path: box.path,
        element: box.name,
        kind: box.kind,
        rect,
        message:
          `size resolves negative (${box.rect.width} x ${box.rect.height}). The declared form ` +
          `\`${box.trace.sizeRaw.width}\` / \`${box.trace.sizeRaw.height}\` is legal (negative means ` +
          '"parent minus position minus N"), but here the position already exceeds the parent.',
        suggestedFix: `shrink the position or make the parent larger (parent is ${box.parentRect.width} x ${box.parentRect.height}).`,
        trace: { sizeFormula: box.trace.sizeFormula, position: box.trace.position },
      });
    }

    // ------------------------------------------------------------ out of bounds
    // Vanilla writes slide-in/slide-out offsets as element sub-blocks (advisor_window.gui:32),
    // so the parser files them under `subBlocks`; accept either shape, plus the `animation_type`
    // that usually accompanies them and the top-level key the model would hold if a caller set
    // it directly.
    const animated = Boolean(
      box.node?.subBlocks?.show_position ||
        box.node?.subBlocks?.hide_position ||
        box.node?.subBlocks?.animation_type ||
        box.node?.show_position ||
        box.node?.hide_position ||
        box.node?.animation_type,
    );
    if (!(animated && options.allowOffscreenAnimated)) {
      if (!contains(bounds, rect) && box.rect.width > 0 && box.rect.height > 0) {
        const overflow = {
          left: Math.max(0, bounds.x - rect.x),
          top: Math.max(0, bounds.y - rect.y),
          right: Math.max(0, rect.x + rect.width - (bounds.x + bounds.width)),
          bottom: Math.max(0, rect.y + rect.height - (bounds.y + bounds.height)),
        };
        const distance = Math.max(overflow.left, overflow.top, overflow.right, overflow.bottom);
        // GAP-11: HOW FAR OUT decides WHAT IT IS. Every `out-of-bounds` finding is still produced -
        // nothing is suppressed and no rule changes shape - but at `parkMargin` or beyond, an element
        // is not "escaping" the window, it is PARKED: the idiom this project uses to satisfy the
        // engine's by-name contract without showing chrome is `-3000,-3000`, which is 3000 px of
        // overflow and swamps the real escapes in the count. Measured on the working mod: 154
        // out-of-bounds elements, of which 0 are within 512 px of the edge - the number that made the
        // mod's own gate unreadable. The classification is REPORTED (`geometry.outOfBounds.parked`
        // and one info finding per park), never silent, and `parkMargin: 0` turns it off.
        const parkMargin = Number(options.parkMargin ?? 0);
        const parked = parkMargin > 0 && distance > parkMargin;
        context.parkClassification ??= { parked: 0, escaped: 0, margin: parkMargin, parkedElements: [] };
        if (parked) {
          context.parkClassification.parked += 1;
          context.parkClassification.parkedElements.push({ element: box.name ?? null, kind: box.kind, distance });
        } else {
          context.parkClassification.escaped += 1;
        }
        add({
          rule: parked ? 'out-of-bounds-parked' : 'out-of-bounds',
          severity: parked ? 'info' : 'error',
          where,
          path: box.path,
          element: box.name,
          kind: box.kind,
          rect,
          message: parked
            ? `element is parked ${Math.round(distance)} px outside the ${bounds.width}x${bounds.height} root window ` +
              `(past the ${parkMargin} px park margin; overflow left ${overflow.left}, top ${overflow.top}, right ` +
              `${overflow.right}, bottom ${overflow.bottom} px). At this distance it cannot be part of the window that ` +
              'contains it, which is what a deliberate park looks like: the element exists so the engine\'s by-name ' +
              'contract finds it and nothing is drawn. It is counted under `geometry.outOfBounds.parked` rather than ' +
              'among the real escapes, so the escapes stay readable - the ambiguity is in the coordinate, not in the file.'
            : `element leaves the ${bounds.width}x${bounds.height} root window by ` +
              `left ${overflow.left}, top ${overflow.top}, right ${overflow.right}, bottom ${overflow.bottom} px ` +
              `(${Math.round(distance)} px, inside the ${parkMargin} px park margin, so this is an escape and not a ` +
              'park). Coordinates are in the 1920x1080 base resolution; the game scales the UI, so this is only ' +
              'meaningful at that base.',
          suggestedFix:
            overflow.right > 0
              ? `move it left by ${Math.ceil(overflow.right)} px, or set orientation = upper_right with a negative x.`
              : overflow.bottom > 0
                ? `move it up by ${Math.ceil(overflow.bottom)} px, or set orientation = lower_left/center_down with a negative y.`
                : `move it right/down by ${Math.ceil(Math.max(overflow.left, overflow.top))} px.`,
          overflow,
          distance,
          parked,
          parkMargin: parkMargin > 0 ? parkMargin : null,
        });
      }
    }

    // ------------------------------------------------------------ sprite / font refs
    if (assets) {
      for (const field of SPRITE_FIELDS) {
        const spriteName = box.node?.[field];
        if (!spriteName) continue;
        const record = assets.sprites[spriteName];
        if (!record) {
          add({
            rule: 'unknown-sprite',
            severity: 'error',
            where,
            path: box.path,
            element: box.name,
            kind: box.kind,
            rect,
            message:
              `\`${field} = "${spriteName}"\` is not defined by any .gfx in the install. The engine will draw ` +
              'nothing (or its fallback), which is invisible until a human runs the game.',
            suggestedFix: nearestSprites(assets, spriteName),
          });
          continue;
        }
        const texture = record.textureFile ? assets.textures[record.textureFile] : null;
        const isFixedSprite = String(record.kind).toLowerCase() === 'spritetype';
        if (isFixedSprite && hasDeclaredSize && texture?.ok) {
          const declared = `${box.rect.width}x${box.rect.height}`;
          const natural = `${texture.width}x${texture.height}`;
          if (Math.abs(box.rect.width - texture.width) > 1 || Math.abs(box.rect.height - texture.height) > 1) {
            add({
              rule: 'fixed-size-sprite-resized',
              severity: 'info',
              where,
              path: box.path,
              element: box.name,
              kind: box.kind,
              rect,
              message:
                `\`${field} = "${spriteName}"\` is a \`${record.kind}\` (fixed ${natural}) but the element is ` +
                `${declared}. Only \`quadTextureSprite\` (a corneredTileSpriteType) honours a custom size.`,
              suggestedFix:
                `either drop \`size\` to use the sprite's natural ${natural}, or switch to a ` +
                'corneredTileSpriteType such as GFX_tiling_button_standard.',
            });
          }
        }
        if (!record.textureFile) {
          add({
            rule: 'sprite-without-texture',
            severity: 'info',
            where,
            path: box.path,
            element: box.name,
            kind: box.kind,
            rect,
            message:
              `sprite \`${spriteName}\` declares no texturefile (it is a ${record.kind}). ` +
              'Normal for generated/procedural sprites; nothing will be drawn from a DDS.',
            suggestedFix: 'none needed unless you expected an image here.',
          });
        }
      }

      const fontName = box.node?.font ?? box.node?.buttonFont;
      if (fontName && !assets.fonts[fontName]) {
        add({
          rule: 'unknown-font',
          severity: 'error',
          where,
          path: box.path,
          element: box.name,
          kind: box.kind,
          rect,
          message:
            `font \`${fontName}\` is not declared by any \`bitmapfont\` block. The install defines ` +
            `${assets.stats?.fontCount ?? 0} fonts; text will fall back to the default font.`,
          suggestedFix: nearestFonts(assets, fontName),
        });
      }

      const backgroundSprite = box.node?.background?.sprite;
      if (backgroundSprite && !assets.sprites[backgroundSprite]) {
        add({
          rule: 'unknown-sprite',
          severity: 'error',
          where,
          path: `${box.path}/background`,
          element: box.name,
          kind: box.kind,
          rect,
          message: `\`background.spriteType = "${backgroundSprite}"\` is not defined by any .gfx.`,
          suggestedFix: nearestSprites(assets, backgroundSprite),
        });
      }
    }

    // ------------------------------------------------------------ effect buttons
    if (spec?.requiresEffect) {
      const effect = box.node?.effect;
      if (!effect) {
        add({
          rule: 'effect-missing',
          severity: 'error',
          where,
          path: box.path,
          element: box.name,
          kind: box.kind,
          rect,
          message:
            '`effectbuttonType` has no `effect`, so clicking it does nothing. `effect` names a top-level key ' +
            'in common/button_effects/*.txt.',
          suggestedFix: `add \`effect = "${box.name}_effect"\` and emit common/button_effects/<file>.txt.`,
        });
      } else if (buttonEffects && !buttonEffects.has(effect)) {
        add({
          rule: 'effect-unresolved',
          severity: 'error',
          where,
          path: box.path,
          element: box.name,
          kind: box.kind,
          rect,
          message:
            `\`effect = "${effect}"\` is not a top-level key in any common/button_effects/*.txt. The button ` +
            'will render but do nothing, which no static check inside the .gui can reveal.',
          suggestedFix:
            buttonEffects.size > 0
              ? `emit \`${effect} = { potential = { always = yes } effect = { ... } }\`, or use an existing key such as "${[...buttonEffects][0]}".`
              : `emit common/button_effects/<name>.txt defining \`${effect}\`.`,
        });
      }
    }

    // ------------------------------------------------------------ localisation
    if (locKeys) {
      for (const { field } of TEXT_FIELDS) {
        const value = box.node?.[field];
        if (typeof value !== 'string' || value === '') continue;
        if (LOC_SENTINELS.has(value)) continue;
        if (/\$[A-Za-z0-9_.\-]+\$/.test(value)) continue; // composed reference
        if (!looksLikeLocKey(value)) continue;
        if (locKeys.has(value)) continue;
        add({
          rule: 'missing-localisation',
          severity: 'warning',
          where,
          path: `${box.path}/${field}`,
          element: box.name,
          kind: box.kind,
          rect,
          message:
            `\`${field} = "${value}"\` is not a known localisation key. These fields are keys, not literal ` +
            'text; an unknown key renders as the raw string in game.',
          suggestedFix: `emit \`${value}:0 "..."\` into localisation/<language>/<file>_l_<language>.yml (UTF-8 WITH BOM).`,
          key: value,
        });
      }
    }

    // ------------------------------------------------------------ data functions in window text
    // See WINDOW_TEXT_FIELDS: a bracket call in a value this element PAINTS is printed literally.
    // Requires a keyset WITH values (`buildLocalisationIndex({ withValues: true })`); without one
    // the rule stays silent rather than guessing, the same way `missing-localisation` does.
    if (locValues) {
      for (const field of WINDOW_TEXT_FIELDS) {
        const key = box.node?.[field];
        if (typeof key !== 'string' || key === '') continue;
        if (!looksLikeLocKey(key)) continue;
        const value = locValues.get(key);
        if (typeof value !== 'string' || value === '') continue;
        const call = bracketDataFunction(value);
        if (!call) continue;
        add({
          rule: 'window-text-data-function',
          severity: 'warning',
          where,
          path: `${box.path}/${field}`,
          element: box.name,
          kind: box.kind,
          rect,
          message:
            `\`${field} = "${key}"\` resolves to ${JSON.stringify(value.length > 64 ? `${value.slice(0, 61)}...` : value)}, ` +
            `which contains the bracket data function \`${call}\`. A WINDOW's text element prints that literally - measured ` +
            '2026-10-05 in a custom_gui event window, where the player read `[Root.Ge ...` on screen. The engine resolves ' +
            'bracket calls in TOOLTIPS, not in painted text.',
          suggestedFix:
            `make \`${key}\` static text, or move the live value into a tooltip field (\`pdx_tooltip\`, \`custom_tooltip\`) ` +
            'on the same element, where the engine does resolve it.',
          key,
        });
      }
    }

    // ------------------------------------------------------------ spelling
    for (const field of ['orientation', 'origo', 'pdx_tooltip_anchor_orientation']) {
      const raw = box.node?.[field];
      if (raw === undefined || raw === null) continue;
      if (normaliseAnchor(raw) === null) {
        add({
          rule: 'orientation-unknown',
          severity: 'warning',
          where,
          path: `${box.path}/${field}`,
          element: box.name,
          kind: box.kind,
          rect,
          message:
            `\`${field} = "${raw}"\` is not a recognised anchor. The engine falls back to upper_left, which ` +
            'silently changes the layout rather than failing.',
          suggestedFix: 'use one of: upper_left, center_up, upper_right, center_left, center, center_right, lower_left, center_down, lower_right.',
        });
      }
    }

    // ------------------------------------------------------------ fields, per kind
    //
    // The engine parses each element kind with its own field list, so a field that belongs to
    // another kind is not "an unmodelled field" - it is `Unexpected token: <field>`, and the whole
    // block is dropped at load time. Four of them cost real rounds of this project:
    //   `custom_tooltip` on an effectbuttonType (it is a SCRIPT field: 0 uses on any .gui element)
    //   `alwaysTransparent` on a containerWindowType (legal on text/icon/button/list kinds and
    //     inside a `background` block, 0 uses on a container)
    //   `origo` on an iconType (containerWindowType only; an icon wants `centerPosition = yes`)
    //   `effect` on a buttonType (a REAL field, but only on `effectbuttonType` - the mistake is
    //     natural because the two kinds share every other field, and the result is a button that
    //     renders and does nothing. The trial mod's six close buttons were exactly this: writing
    //     the close handler required converting each one to an `effectbuttonType`.)
    if (spec && box.node) {
      const allowed = new Set([
        ...Object.keys(spec.fields),
        'id',
        'kind',
        'type',
        'children',
        'name',
        'background',
        'sourceFile',
        'sourceLine',
        'variables',
        'subBlocks',
        'conditionals',
        'extra',
        'keywords',
        'keyword',
        'syntheticRoot',
        'centerPositionDerived',
        // Parser METADATA, written by `parseGuiText` on every imported node: `positionDeclared`
        // records that the file carried a `position` block, and `enginePosition` /
        // `parsedCanonicalPosition` keep the engine's own reading beside the canonical one so the
        // emitter can round-trip both. They are not fields of any element kind and are never
        // emitted (there is a check for that), so `unknown-field` on them was pure noise - 1743
        // findings on the one real six-window mod file, which buried the findings that matter.
        'positionDeclared',
        'enginePosition',
        'parsedCanonicalPosition',
        // The coordinate pair `prepareEngineCoordinates` records on every node it converts
        // (`{ orientation, position }`). It is written by the EMITTER, not by a `.gui` file, but a
        // layout that has been emitted once keeps it - so validating after an emit reported an
        // `unknown-field` on EVERY element. Measured before this line: 0 findings on a fresh tree,
        // 5 on the same tree after one coordinate pass, one per node.
        'coordinateFields',
        // COMPONENT PLUMBING (src/lib/components.mjs). A bar is expanded into containers and text by
        // `computeLayout` before this rule runs, and these keys record which piece is which so the
        // bar rules below can measure the label's own box. They are not fields of any element kind
        // (a `component = "bar-fill"` line would be "Unexpected token: component"), so reporting them
        // as unmodelled fields would put three info findings on every bar.
        'component',
        'componentLive',
        'componentOf',
        // The piece's own ROLE inside its bar: the key a clone derives its element names from
        // (`renameBarClone`). Model plumbing, filtered out of the emitted file by `NON_FIELD_KEYS`.
        'role',
        'barGeometry',
        'headingName',
        // MATRIX PLUMBING. `matrixGeometry` is the matrix's own geometry, kept on its frame; and
        // `matrixCell` is the slot a cell was placed in. Neither is an engine field - a literal
        // `matrixCell = { ... }` line would be "Unexpected token: matrixCell" - and without these two
        // entries every expanded matrix reported one `unknown-field` per cell and per label, which
        // for a 6x5 matrix is 30 lines of pure noise around the two findings that matter.
        'matrixGeometry',
        'matrixCell',
        // ELEMENT BLOCKS WHOSE KEY IS A FIELD NAME (src/lib/kinds.mjs `AS_FIELD_ELEMENT_KINDS`).
        // `asField` records that a `dropDownBoxType`'s `expandedWindow`/`expandButton` block must be
        // written under that key rather than under its kind's keyword. Model plumbing, filtered out
        // of the emitted file by `NON_FIELD_KEYS` - and a parsed file SETS it, so without this entry
        // every dropdown in every file reported one `unknown-field` per structural part.
        'asField',
      ]);
      const candidates = [...Object.keys(box.node), ...Object.keys(box.node.extra ?? {}).map((key) => key)];
      for (const key of candidates) {
        if (allowed.has(key)) continue;
        // `origo` on this box was DERIVED from `centerPosition = yes` by the layout engine, not
        // written by the caller: the engine accepts `centerPosition` on an icon, so this is not a
        // finding about the file.
        if (key === 'origo' && box.node.centerPositionDerived) continue;
        if (kindAcceptsField(spec, key)) continue;
        // A field the engine was measured to reject ON THIS KIND (GAP-15: `visible` on a
        // `containerWindowType`). The set is per kind on purpose - the probe covers the container and
        // says nothing about the kinds it did not test - so this is not folded into
        // `isEngineRejectedField`, which is global.
        const rejectedForKind = isFieldRejectedForKind(spec, key);
        if (!isKnownField(key) && !isEngineRejectedField(key) && !rejectedForKind) {
          add({
            rule: 'unknown-field',
            severity: 'info',
            where,
            path: `${box.path}.${key}`,
            element: box.name,
            kind: box.kind,
            rect,
            message: `\`${key}\` is not a field this project models on \`${spec.kind}\`.`,
            suggestedFix: `did you mean: ${suggestFields(key).join(', ') || '(no close match)'}?`,
          });
          continue;
        }
        // A field some OTHER kind accepts. Proven-rejected ones are errors; a combination vanilla
        // merely never writes is a warning, because the table is a measurement, not a proof.
        const rejected = isEngineRejectedField(key) || rejectedForKind;
        const others = kindsAcceptingField(key).filter((kind) => kind !== spec.kind);
        const equivalent = equivalentFieldFor(spec, key);
        add({
          rule: 'field-not-accepted',
          severity: rejected ? 'error' : 'warning',
          where,
          path: `${box.path}.${key}`,
          element: box.name,
          kind: box.kind,
          rect,
          ...(rejected ? { engineMessage: `Unexpected token: ${key}` } : {}),
          message:
            `\`${key}\` is not a field of \`${spec.keywords[0]}\`` +
            (others.length > 0 ? ` (it belongs to ${others.map((kind) => `\`${kind}\``).join(', ')})` : '') +
            (rejected
              ? ': ' + (kindRejectedFieldNote(spec, key) ?? 'the engine reports "Unexpected token: ' + key + '" and drops the block.') + ' '
              : `: vanilla never writes it on this kind (${spec.vanillaUses} \`${spec.keywords[0]}\` blocks, 0 with \`${key}\`).`) +
            (equivalent ? ` The equivalent here is \`${equivalent}\`.` : ''),
          suggestedFix: equivalent
            ? `replace it with \`${equivalent}\`.`
            : 'delete it, or move the intent to a kind that accepts it.',
        });
      }
    }
  }

  // ------------------------------------------------------------ undeclared variables
  const declaredNames = new Set(Object.keys(variables));
  const seenVariables = new Set();
  for (const box of boxes) {
    const node = box.node ?? {};
    const path = pathOfBox(box);
    const scan = (value, field) => {
      if (typeof value !== 'string' || !value.startsWith('@')) return;
      if (declaredNames.has(value)) return;
      const key = `${path}.${field}`;
      if (seenVariables.has(key)) return;
      seenVariables.add(key);
      add({
        rule: 'undeclared-variable',
        severity: 'error',
        where: node.sourceFile ? `${node.sourceFile}:${node.sourceLine ?? '?'}` : path,
        path,
        element: node.name,
        kind: node.kind,
        message: `\`${field} = "${value}"\` references a variable that is never declared.`,
        suggestedFix: `add \`${value} = <value>\` at the top of the file, before \`guiTypes\`.`,
      });
    };
    for (const [field, value] of Object.entries(node.size ?? {})) scan(value, `size.${field}`);
    for (const [field, value] of Object.entries(node.position ?? {})) scan(value, `position.${field}`);
    for (const field of [...SPRITE_FIELDS, 'font', 'buttonFont']) scan(node[field], field);
  }

  // ------------------------------------------------------------ sibling overlap
  for (const [, group] of byParent) {
    for (let a = 0; a < group.length; a += 1) {
      for (let b = a + 1; b < group.length; b += 1) {
        const first = group[a];
        const second = group[b];
        // Never compare across windows: two top-level `containerWindowType`s are alternatives,
        // not neighbours, and a merged file's windows overlap the whole screen by design.
        if (!inSameWindow(first, second)) continue;
        if (first.rect.width <= 0 || first.rect.height <= 0) continue;
        if (second.rect.width <= 0 || second.rect.height <= 0) continue;
        const area = intersectionArea(rectOf(first), rectOf(second));
        if (area < options.overlapTolerance) continue;
        const smaller = Math.min(first.rect.width * first.rect.height, second.rect.width * second.rect.height);
        const ratio = smaller > 0 ? area / smaller : 0;
        if (ratio < options.overlapAreaRatio) continue;
        const firstRect = rectOf(first);
        const secondRect = rectOf(second);
        if (contains(firstRect, secondRect) || contains(secondRect, firstRect)) continue;
        const transparent =
          first.node?.alwaysTransparent || second.node?.alwaysTransparent ||
          first.node?.background || second.node?.background;
        if (transparent && !options.flagTransparentOverlaps) continue;
        // The MEASURED extents decide. When at least one side has a measured string and the ink
        // does not reach the other element, the box overlap is an artefact of a label field
        // being as wide as its row, and reporting it sends a reviewer chasing a defect that is
        // not on screen. Genuine ink collisions are reported as `text-collision` below, which is
        // the precise rule; this one keeps its meaning for elements with no text at all.
        overlapBreakdown.candidates += 1;
        const bothText = measurements.has(first) && measurements.has(second);
        if (bothText) {
          overlapBreakdown.textPairsMeasured += 1;
          overlapBreakdown.textPairsBoxOverlapping += 1;
        }
        if (options.measureText && anyMeasured(first, second)) {
          const inkArea = rectIntersection(inkOf(first), inkOf(second)).area;
          if (inkArea <= 0) {
            overlapBreakdown.suppressedByMeasurement += 1;
            // A pair this rule would have reported had the live token been charged as ink: counted,
            // so `sibling-overlap: 0` on a panel full of readouts is not read as "no collisions
            // were possible here" (GAP-5).
            if (isLiveInk(first) || isLiveInk(second)) liveTextExcluded.collision += 1;
            continue;
          }
          if (bothText) overlapBreakdown.textPairsInkOverlapping += 1;
        }
        overlapBreakdown.reported += 1;
        add({
          rule: 'sibling-overlap',
          severity: 'warning',
          where: `${first.node?.sourceFile ?? first.path} vs ${second.node?.sourceFile ?? second.path}`,
          path: `${first.path} + ${second.path}`,
          kind: `${first.kind}+${second.kind}`,
          rect: firstRect,
          otherRect: secondRect,
          message:
            `siblings \`${first.name ?? first.id}\` (${first.kind}) and \`${second.name ?? second.id}\` ` +
            `(${second.kind}) overlap by ${Math.round(area)} px^2 = ${(ratio * 100).toFixed(1)}% of the smaller element.`,
          suggestedFix:
            first.parentId === second.parentId
              ? `separate them, or mark the decorative one \`alwaysTransparent = yes\` (which suppresses this finding).`
              : 'reparent one of them.',
          overlapArea: Math.round(area),
          overlapRatio: Number(ratio.toFixed(3)),
          tolerance: { minArea: options.overlapTolerance, minRatio: options.overlapAreaRatio },
          measured: options.measureText && anyMeasured(first, second),
          inkArea: Math.round(rectIntersection(inkOf(first), inkOf(second)).area),
        });
      }
    }
  }

  // ------------------------------------------------------------ the bar COMPONENT
  //
  // A `kind: 'bar'` node was expanded into containers and text by `computeLayout` (see
  // src/lib/components.mjs), and the expansion reported everything it refused (`bar-proportion-
  // invalid`, `bar-fill-overflows-track`, `bar-track-width-not-static`, ...) into `issues`, which
  // `computeLayout` returns and the caller folds into the findings above. What is left is what can
  // only be judged against the WHOLE tree: does the label fit the box the construction gave it, and
  // does the track line up with the heading over its column.
  for (const bar of collectBars(layout)) {
    const geometry = bar.geometry;
    if (!geometry) continue;
    const where = bar.group?.sourceFile
      ? `${bar.group.sourceFile}:${bar.group.sourceLine ?? '?'}`
      : geometry.path;
    const common = { where, path: geometry.path, element: bar.name, kind: 'bar', component: 'bar' };

    // The heading this bar's column belongs to. `headingName` names it; otherwise the convention
    // the working mod and vanilla both use is derived from the bar's own name.
    const headingName = geometry.headingName ?? headingNameForBar(bar.name);
    // THE TRACK, from the expansion's OWN pieces. `collectBars` resolves them by the `role` the
    // construction set, so this does not have to reconstruct a generated name - and a generated name
    // is exactly what an earlier revision got wrong here: it looked for
    // `${path}/${name}_track`, but the construction's names put the role in the MIDDLE
    // (`unga_power_track_1_main`, not `unga_power_1_main_track`), so the lookup never matched, the
    // rule fell back to the bar's own box and every misalignment went unreported. The selftest's
    // "a track 100 px off its heading IS reported" is what catches that.
    const groupBox = boxes.find((box) => box.path === geometry.path) ?? null;
    const trackBox = (bar.track ? boxes.find((box) => box.node === bar.track) : null) ?? (groupBox?.node?.component === 'bar-track' ? groupBox : null) ?? groupBox;

    // The label's own box, measured against the box the construction gives it. `maxWidth` is
    // derived from the track, so this catches the case a generic `text-overflow` rule cannot: a
    // label sitting in the 16 px inner height of a 20 px track, or a label in a left/right column
    // the caller made too narrow.
    if (bar.label && geometry.label) {
      const labelBox = barLabelBox(geometry, bar.group);
      // The label's OWN element, from the expansion's pieces (`role: 'label'`), so the measurement
      // is of the element the construction actually emitted rather than of a reconstructed name.
      const labelElement = bar.label;
      const measured = measurements.get(boxes.find((box) => box.node === labelElement));
      if (labelBox && measured) {
        if (measured.width > labelBox.width + 0.5) {
          add({
            ...common,
            rule: 'bar-label-too-wide',
            severity: 'warning',
            rect: labelBox,
            textRect: measured.textRect,
            measuredWidth: measured.width,
            labelBoxWidth: labelBox.width,
            text: measured.text,
            font: measured.font,
            textMethod: measured.method,
            textExact: measured.exact,
            message:
              `the bar's label measures ${measured.width}px in the ${labelBox.width}px the bar's ${geometry.labelSide} label box ` +
              `allows (track width ${geometry.width}, inset ${geometry.inset}). The engine would wrap or clip it inside the bar. ` +
              `Measured in \`${measured.font}\`${measured.exact ? ' (exact)' : ` (${measured.method}, approx.)`}.`,
            suggestedFix:
              labelBox.width < geometry.width
                ? 'raise `labelWidth` (the column a left/right label gets), or shorten the string.'
                : 'widen the bar, or shorten the string.',
          });
        } else if (geometry.labelSide === 'inside' && measured.budgetHeight > labelBox.height + 0.5) {
          add({
            ...common,
            rule: 'bar-label-overflows-track',
            severity: 'warning',
            rect: labelBox,
            textRect: measured.textRect,
            measuredHeight: measured.height,
            budgetHeight: measured.budgetHeight,
            labelBoxHeight: labelBox.height,
            lineCount: measured.lineCount,
            text: measured.text,
            font: measured.font,
            message:
              `the bar's inside label needs ${measured.budgetHeight}px of ascent band over ${measured.lineCount} line(s), but the ` +
              `fill-height box inside a ${geometry.height}px track is ${labelBox.height}px. Raise \`height\` to at least ` +
              `${geometry.height + (measured.budgetHeight - labelBox.height)} (track = label band + ${geometry.inset * 2} px inset), ` +
              'move the label out with `labelSide`, or shorten the string.',
            suggestedFix: `height = ${geometry.height + Math.ceil(measured.budgetHeight - labelBox.height)}`,
          });
        }
      }
    }

    // THE COLUMN ALIGNMENT. A ranking band reads as a table: the heading sits at one x and every
    // row's track must start at that same x. Nothing overlaps when it does not - which is why no
    // geometric rule caught the 100 px misalignment reported in the same window - so it is checked
    // here, against the heading the bar's own name points at (or `headingName`). A heading is a
    // SIBLING that sits above the track within the same band (`bar-heading-gap` px), which is the
    // shape the reference uses: `unga_chart_rank_caption_main` above its six rows.
    if (trackBox) {
      const wanted = headingName ?? null;
      const rows = byParent.get(trackBox.parentIndex) ?? [];
      /** A heading is a TEXT element, in the same window, above the track and within `headingGap`. */
      const inBand = (box) => box !== trackBox && box.rect.bottom <= trackBox.rect.y + 1 && trackBox.rect.y - box.rect.bottom <= BAR_DEFAULTS.headingGap && inSameWindow(box, trackBox);
      const isHeading = (box) => Boolean(box.name) && (box.kind === 'text' || box.node?.kind === 'text') && (/heading|caption|label/i.test(String(box.name)) || (wanted !== null && box.name === wanted));
      // `headingName` is the caller SAYING which element is the heading, so it is preferred - but it
      // still has to be in the band. A name alone would let a heading 400 px up the window, which is
      // some other column's, be held against this track - and that is the shape the reference's own
      // captions have (one caption in a different container from the six rows it heads, 34 px above
      // the first of them), so an unguarded lookup is a false positive waiting to happen.
      const named = wanted ? (rows.find((box) => box.name === wanted && inBand(box)) ?? boxes.find((box) => box.name === wanted && inBand(box))) : null;
      const conventional = (candidates) =>
        candidates
          .filter((box) => box !== null && isHeading(box) && inBand(box))
          .sort((first, second) => second.rect.bottom - first.rect.bottom || Math.abs(first.rect.x - trackBox.rect.x) - Math.abs(second.rect.x - trackBox.rect.x))[0];
      const headingBox =
        named ??
        // A sibling first (the common shape), then a same-column heading one level up, because the
        // reference's own captions sit in a DIFFERENT container from the rows' tracks.
        conventional(rows) ??
        conventional(boxes) ??
        null;
      if (headingBox && Math.abs(headingBox.rect.x - trackBox.rect.x) > BAR_DEFAULTS.headingTolerance) {
        add({
          ...common,
          rule: 'bar-track-misaligned-with-heading',
          severity: 'warning',
          rect: trackBox.rect,
          otherRect: headingBox.rect,
          offsetX: Math.round(trackBox.rect.x - headingBox.rect.x),
          message:
            `the bar's track starts at x = ${Math.round(trackBox.rect.x)} but \`${headingBox.name}\`, the heading over its own ` +
            `column, starts at x = ${Math.round(headingBox.rect.x)}: ${Math.round(Math.abs(trackBox.rect.x - headingBox.rect.x))} px ` +
            'apart. The column reads as broken even though nothing overlaps. Align the track with the heading (the same ' +
            '`position.x`, or the same parent and `position.x = 0`).',
          suggestedFix: `move the bar to x = ${Math.round(headingBox.rect.x)} (or align the heading to the bar).`,
        });
      }
    }
  }

  // ------------------------------------------------------------ measured text overflow
  //
  // Is the RENDERED string wider or taller than the box the engine was given? This is the check
  // a human makes by looking at the window, and it cannot be made from `maxWidth`/`maxHeight`
  // alone: the box is a budget, and the question is what the text spends.
  //
  // A single line that is wider than `maxWidth` is a hard horizontal overflow. A wrapped block
  // taller than `maxHeight` is the vertical case, and it is the one that puts text on top of the
  // row below. Both carry the measured numbers, the line count, and the exactness of the
  // measurement so a reader knows whether to trust the last pixel.
  // How many text elements were EXCLUDED from `text-overflow` / text-ink collisions because they
  // paint a live value the engine resolves at draw time (GAP-5). Printed by the reporting gate so a
  // zero count cannot be read as silence - the same discipline as the mod's own `mech-gate.mjs`.
  const liveTextExcluded = { overflow: 0, collision: 0, elements: new Set() };
  for (const [box, measured] of measurements) {
    // ---- GAP-5: a RESOLVED live value replaces the overflow with a statement of the measurement --
    //
    // `measureElementText` clears `overflows` for a live value on the channel that resolves it
    // (`effectbuttonType.buttonText` + `effect`), because the `[$GetX$]` token it measures is runtime
    // data, not ink. The measurement is still worth HAVING - it is the number a reader needs to see
    // that the box is a 2-5 character budget, not a 146 px string - so it is reported once, at info
    // severity, and counted in `liveTextExcluded` so the exclusion cannot be mistaken for silence.
    if (measured.live && measured.liveOnResolvingChannel) {
      liveTextExcluded.overflow += 1;
      liveTextExcluded.elements.add(box.node?.name ?? pathOfBox(box));
      add({
        rule: 'text-live-value',
        severity: 'info',
        where: box.node?.sourceFile ? `${box.node.sourceFile}:${box.node.sourceLine ?? '?'}` : pathOfBox(box),
        path: pathOfBox(box),
        element: box.node?.name ?? null,
        kind: box.kind,
        rect: rectOf(box),
        textRect: measured.textRect,
        font: measured.font,
        textMethod: measured.method,
        textExact: false,
        text: measured.text,
        measuredWidth: measured.width,
        measuredHeight: measured.height,
        maxWidth: measured.maxWidth,
        maxHeight: measured.maxHeight,
        liveTokens: measured.liveTokens,
        message:
          `\`${box.node?.name ?? pathOfBox(box)}\` (${box.kind}) paints a LIVE value: its text is ` +
          `${JSON.stringify(measured.text)}, and \`${(measured.liveTokens ?? []).map(() => '[$...$]').join('`, `')}\` is ` +
          'runtime data (a `common/scripted_loc` `defined_text` name), so the engine replaces it with a short number at ' +
          `draw time. The measured ${measured.width}px is what the UNRESOLVED token would need in \`${measured.font}\`, not what ` +
          'is painted, so no `text-overflow` is reported for this element. What to size the box from is the 2-5 characters ' +
          'the engine will actually write.',
        suggestedFix:
          'size the box for the number the effect writes (2-5 characters), or pass `multiline = false` if the value should never wrap.',
      });
      continue;
    }
    if (!measured.overflows) continue;
    // A bar's label box is the fill height inside its track, not a text budget the caller chose:
    // `bar-label-overflows-track` / `bar-label-too-wide` above say exactly what is wrong with it and
    // what to raise, and saying it twice with a generic message helps nobody.
    if (box.node?.component === 'bar-label') continue;
    // A zero-area element is how vanilla and this mod HIDE a control (the box rules skip them
    // for the same reason). Its text is not on screen, so "the text does not fit" is not a
    // finding about anything a player can see.
    if (box.rect.width <= 0 || box.rect.height <= 0) continue;
    const node = box.node ?? {};
    const horizontal = !measured.fitsWidth;
    const vertical = !measured.fitsHeight;
    const reasons = [];
    if (horizontal) {
      reasons.push(
        `the string measures ${measured.width}px in a ${measured.maxWidth}px \`maxWidth\` (+${Math.round(measured.overflowX)}px)`,
      );
    }
    if (vertical) {
      reasons.push(
        `${measured.lineCount} wrapped line(s) need ${measured.budgetHeight}px of ascent band in a ` +
          `${measured.maxHeight}px \`maxHeight\` (+${Math.round(measured.overflowY)}px; the glyph ink covers ` +
          `${measured.height}px)` +
          `${measured.dynamicExtraHeight ? ` after ${measured.dynamicExtraHeight}px of \`dynamic_extra_height\`` : ''}`,
      );
    }
    if (measured.wordOverflow.length > 0) {
      reasons.push(
        `${measured.wordOverflow.length} run(s) have no legal break inside them ` +
          `(\`${shorten(measured.wordOverflow[0])}\`), so they are drawn overflowing rather than split`,
      );
    }
    add({
      rule: 'text-overflow',
      severity: 'warning',
      where: node.sourceFile ? `${node.sourceFile}:${node.sourceLine ?? '?'}` : pathOfBox(box),
      path: pathOfBox(box),
      element: node.name,
      kind: box.kind,
      rect: rectOf(box),
      textRect: measured.textRect,
      font: measured.font,
      textMethod: measured.method,
      textExact: measured.exact,
      text: measured.text,
      measuredWidth: measured.width,
      measuredHeight: measured.height,
      measuredBudgetHeight: measured.budgetHeight,
      lineCount: measured.lineCount,
      maxWidth: measured.maxWidth,
      maxHeight: measured.maxHeight,
      overflowX: Math.round(measured.overflowX),
      overflowY: Math.round(measured.overflowY),
      textOverflow: horizontal ? 'horizontal' : 'vertical',
      message:
        `\`${node.name ?? pathOfBox(box)}\` (${box.kind}) overflows its box when the text is ` +
        `actually rendered: the string measures ${measured.width}x${measured.height}px over ` +
        `${measured.lineCount} line(s) in a ${measured.maxWidth}x${measured.maxHeight} box, and ` +
        `${reasons.join('; ')}. ` +
        `Measured in \`${measured.font}\`${measured.exact ? ' (exact)' : ` (${measured.method}, approx.)`}` +
        `${measured.language ? `, l_${measured.language}` : ''}.`,
      suggestedFix: horizontal
        ? `widen \`maxWidth\` to at least ${measured.width}, shorten the string, or set \`format\` so the ` +
          'overflow falls where there is room.'
        : `raise \`maxHeight\` to at least ${measured.height} (${measured.lineCount} lines), or widen ` +
          '`maxWidth` so the text needs fewer lines.',
    });
  }

  // ------------------------------------------------------------ measured text collisions
  //
  // Two elements whose BOXES do not overlap can still put glyphs on top of each other: that is
  // what a wrapped block growing past its `maxHeight` looks like when the row below is a sibling
  // of a different parent, and it is exactly the defect a box model cannot express. The pass is
  // over measured text only (`textCount x elementCount`), and it never crosses a window.
  if (measurements.size > 1) {
    const measuredBoxes = [...measurements.keys()];
    for (let a = 0; a < measuredBoxes.length; a += 1) {
      for (let b = a + 1; b < measuredBoxes.length; b += 1) {
        const first = measuredBoxes[a];
        const second = measuredBoxes[b];
        if (!inSameWindow(first, second)) continue;
        const firstText = measurements.get(first);
        const secondText = measurements.get(second);
        const intersection = rectIntersection(firstText.textRect, secondText.textRect);
        if (intersection.area < options.textCollisionTolerance) continue;
        const boxIntersection = rectIntersection(rectOf(first), rectOf(second));
        // A pair whose BOXES also overlap has already been reported by `sibling-overlap` when it
        // is genuinely inked; do not say the same thing twice.
        const alreadyReported =
          first.parentId === second.parentId &&
          boxIntersection.area >= options.overlapTolerance &&
          !contains(rectOf(first), rectOf(second)) &&
          !contains(rectOf(second), rectOf(first));
        if (alreadyReported) continue;
        const wrapInduced = boxIntersection.area <= 0;
        if (wrapInduced) overlapBreakdown.wrapInducedCollisions += 1;
        add({
          rule: 'text-collision',
          severity: 'warning',
          where: `${first.node?.sourceFile ?? first.path} vs ${second.node?.sourceFile ?? second.path}`,
          path: `${first.path} + ${second.path}`,
          kind: `${first.kind}+${second.kind}`,
          rect: rectOf(first),
          otherRect: rectOf(second),
          textRect: firstText.textRect,
          otherTextRect: secondText.textRect,
          overlapArea: Math.round(intersection.area),
          textMethod: firstText.method === secondText.method ? firstText.method : `${firstText.method}/${secondText.method}`,
          textExact: firstText.exact && secondText.exact,
          wrapInduced,
          message:
            `the RENDERED text of \`${first.node?.name ?? first.path}\` and ` +
            `\`${second.node?.name ?? second.path}\` overlaps by ${intersection.width}x${intersection.height}px ` +
            `(${Math.round(intersection.area)} px^2)` +
            (wrapInduced
              ? ': their BOXES do not intersect, so this is one of the two strings spilling past its box ' +
                `(\`${first.node?.name ?? first.path}\` measures ${firstText.width}x${firstText.height} in ` +
                `${firstText.maxWidth}x${firstText.maxHeight}, ` +
                `\`${second.node?.name ?? second.path}\` ${secondText.width}x${secondText.height} in ` +
                `${secondText.maxWidth}x${secondText.maxHeight})`
              : ' (the boxes overlap too, and the ink really does intersect)') +
            `. Measured in \`${firstText.font}\` / \`${secondText.font}\`.`,
          suggestedFix: wrapInduced
            ? 'give one of them more room (`maxWidth`/`maxHeight`), or move the row below further down.'
            : 'separate them, or shorten one of the two strings.',
        });
      }
    }
  }

  // ------------------------------------------------------------ option_button convention
  const optionRows = collectOptionRows(layout);
  for (const row of optionRows) {
    if (row.hasOptionButton && row.hasOptionText) continue;
    add({
      rule: 'option-button-convention',
      severity: 'error',
      where: row.where,
      path: row.path,
      element: row.name,
      kind: row.kind,
      message:
        `option row container \`${row.name}\` must contain a button named \`option_button\` with ` +
        '`text = "OPTION_TEXT"`; the engine fills that button with each event option. ' +
        `Found: ${row.hasOptionButton ? '' : 'no `option_button` '}${row.hasOptionText ? '' : 'no `OPTION_TEXT` text'}.`,
      suggestedFix:
        'add: buttonType = { name = "option_button" quadTextureSprite = "GFX_tiling_button_standard" ' +
        'font = "cg_16b" text = "OPTION_TEXT" }',
    });
  }

  // ------------------------------------------------------------ container-name collisions against the install
  //
  // The asset index already indexes every `containerWindowType` name the install defines, so a
  // layout that picks one of those names silently merges into the other window instead of creating
  // its own - the mod's `custom_gui` then shows someone else's window, and the mod author sees their
  // own window missing with no error anywhere. Skipped when the layout IS an install file (every
  // name in it would "collide" with itself).
  //
  // TWO ANSWERS, AND THE RELATIVE PATH DECIDES WHICH (GAP-14). "This name is also defined in
  // another file" is not one situation but two, and reporting both as a collision reports a
  // non-event for the most common way to ship an override: a file that REPLACES another at the same
  // relative path is the only one the engine parses, so its declarations are the only ones in the
  // registry. See the split below, and `container-path-override` for the override half.
  if (options.checkContainerNames && assets?.containers && Object.keys(assets.containers).length > 0) {
    const installRoot = String(assets.root ?? '').toLowerCase().replace(/\\/g, '/');
    const sourceIsInstall = (context.sourceFiles ?? []).some(
      (file) => file && installRoot && String(file).toLowerCase().replace(/\\/g, '/').startsWith(installRoot),
    );
    /**
     * The two spellings of a `.gui` path: absolute for identity, root-relative for the case where
     * the root it was indexed under is not known to this caller.
     *
     * A hit's `file` is relative to the root `buildAssetIndex` indexed it under (and the root is
     * recorded). The file being validated is whatever path `gui_layout_import` was handed -
     * absolute in every real call, but only a basename when a caller names it that way, and
     * `resolvePath` on a bare name yields the process cwd, which matches nothing.
     */
    const fileShape = (root, file) => {
      const text = String(file ?? '').replace(/\\/g, '/').toLowerCase();
      if (text === '') return { abs: '', rel: '' };
      if (/^[a-z]:\//.test(text) || text.startsWith('/')) return { abs: text, rel: text };
      return { abs: root ? resolvePath(String(root), text).replace(/\\/g, '/').toLowerCase() : '', rel: text };
    };
    /**
     * Are these two spellings the same file?
     *
     * THE ABSOLUTE FORMS DECIDE WHENEVER BOTH ARE KNOWN, and that is what makes the shadowing case
     * work: a mod's `d:/mods/x/interface/planet_view.gui` and the install's
     * `d:/st-new/stellaris/interface/planet_view.gui` are different files even though one path is a
     * suffix of the other. The root-relative fallback runs ONLY when a side has no absolute form -
     * a fixture whose hit carries no root, or a node imported by basename - and then one side must
     * be a whole path-segment suffix of the other (`interface/mine.gui` against
     * `d:/mods/mine/interface/mine.gui`).
     */
    const segmentSuffix = (long, short) => Boolean(short) && (long === short || long.endsWith(`/${short}`));
    const sameFile = (sourceShape, hitShape) => {
      if (sourceShape.abs && hitShape.abs) return sourceShape.abs === hitShape.abs;
      return segmentSuffix(sourceShape.rel || sourceShape.abs, hitShape.rel || hitShape.abs);
    };
    /**
     * The ENGINE-RELATIVE path of a `.gui` file - what the engine would call it.
     *
     * `hit.file` already is one (`buildAssetIndex` keys a hit by its root). A source file arrives
     * absolute, so the root it lives under is stripped: the index's own root list first (it carries
     * every root it indexed), then the install root, then - when neither matches, e.g. a fixture
     * whose file is under a directory the index never saw - the LAST `/interface/` segment, which is
     * where a `.gui` file's engine-relative path always begins.
     */
    const engineRelativePath = (file) => {
      const text = String(file ?? '').replace(/\\/g, '/').toLowerCase();
      if (text === '') return '';
      if (!/^[a-z]:\//.test(text) && !text.startsWith('/')) return text.replace(/^\.\//, '');
      const candidates = [installRoot, ...(assets.roots ?? [])]
        .map((root) => String(root ?? '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, ''))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
      for (const root of candidates) if (text.startsWith(`${root}/`)) return text.slice(root.length + 1);
      const at = text.lastIndexOf('/interface/');
      return at >= 0 ? text.slice(at + 1) : text;
    };
    if (!sourceIsInstall) {
      for (const node of topLevelContainers(layout)) {
        if (!node.name) continue;
        const hit = assets.containers[node.name];
        if (!hit) continue;
        // A window defined in the very file being validated is not a collision, it is itself: the
        // index includes the mod's own root when the mod was passed as an extra root, and without
        // this the check fires on every window of every mod it is asked to check.
        //
        // IDENTITY IS BY PATH, WITH THE ROOT'S HELP (GAP-9). This used to be `ownFile.endsWith(hitsFile)`
        // over the two raw strings, which decided the wrong way for the one shape that matters most:
        // a mod file named like the VANILLA file it shadows. Measured - a mod's
        // `interface/planet_view.gui` redefining the vanilla `planet_view` was called the same file,
        // because `...\gap9b\interface\planet_view.gui`.endsWith('interface/planet_view.gui') is true,
        // so the comparison was skipped by the self-test. The hit carries the root it was indexed
        // under, so both sides are made absolute and "is this the very same file?" is exact; the
        // root-relative fallback only runs when a root is genuinely unknown. WHAT the answer means
        // when they are different files is the relative-path split below, not this test.
        const ownShape = fileShape(null, node.sourceFile);
        const hitShape = fileShape(hit.root ?? assets.root, hit.file);
        if (sameFile(ownShape, hitShape)) continue;
        // ---------------------------------------------------------- SAME RELATIVE PATH IS AN OVERRIDE (GAP-14)
        //
        // Two providers of ONE relative `.gui` path are not a collision in the engine at all: it
        // mounts every file it is given and the LAST `dlc_load.json` entry WINS THE WHOLE FILE, so
        // the loser is not merged, not shadowed at lookup, and never parsed. Measured in game
        // (PROBE-RESULTS.md section 3): two probe mods each shipping `interface/input_blocker.gui`
        // whose order in `dlc_load.json` was flipped - in each run exactly one copy's unique markers
        // appear in a log that demonstrably reports both kinds of marker, and the winner is the LAST
        // entry. Not alphabetical, not first-wins, and the engine's own
        // `Found duplicate containerWindowType` reporter never fires, because the loser's file never
        // reaches the loaded set.
        //
        // So the report is graded by the RELATIVE path, which is the fact the engine's mount order
        // acts on: same path -> an override (info, with the load-order fact attached), different
        // paths -> a genuine collision (error, both files load and both declare the name).
        const ownRelative = engineRelativePath(node.sourceFile);
        const hitRelative = String(hit.file ?? '').replace(/\\/g, '/').toLowerCase();
        if (ownRelative !== '' && ownRelative === hitRelative) {
          add({
            rule: 'container-path-override',
            severity: 'info',
            where: node.sourceFile ? `${node.sourceFile}:${node.sourceLine ?? '?'}` : node.name,
            path: node.name,
            element: node.name,
            kind: node.kind ?? 'container',
            overrideWith: { file: hit.file, line: hit.line, root: hit.root ?? assets.root ?? null },
            message:
              `\`custom_gui = "${node.name}"\` is also defined at ${hit.file}:${hit.line}, under the SAME relative ` +
              `path (${hitRelative}) - so this is an OVERRIDE, not a collision. The engine mounts one file per ` +
              'relative path: it reads only the LAST `dlc_load.json` entry and never parses the loser at all, so ' +
              'exactly one of the two declarations of this name reaches the engine\'s registry. The order is ' +
              '`dlc_load.json` and nothing else - not alphabetical, not first-wins. Nothing here is wrong; it is ' +
              'reported so the answer to "which copy is loaded?" is a decision and not a surprise.',
            suggestedFix:
              'nothing, if this file is the later entry in `dlc_load.json`. To find out WHICH copy the engine read, ' +
              'plant a deliberately invalid `format` in a `gridBoxType` of this file: `gridbox.cpp:51` is the one ' +
              'reporter that prints the FILE NAME (measured: `interface/input_blocker.gui: Invalid format ...`), ' +
              'where `persistent.cpp:41` ("Unexpected token") prints a line number and no file.',
          });
          continue;
        }
        add({
          rule: 'container-name-collision',
          severity: 'error',
          where: node.sourceFile ? `${node.sourceFile}:${node.sourceLine ?? '?'}` : node.name,
          path: node.name,
          element: node.name,
          kind: node.kind ?? 'container',
          message:
            `\`custom_gui = "${node.name}"\` would resolve to the window already defined at ` +
            `${hit.file}:${hit.line}, not to yours: the two files are at DIFFERENT relative paths ` +
            `(${ownRelative || '(unknown)'} vs ${hitRelative}), so BOTH load and both declare the name. Rename the ` +
            'containerWindowType (a mod prefix such as `zz_mymod_` is enough); the collision is silent in game.',
          suggestedFix: `rename to e.g. \`zz_${node.name}\`, or check for a name that is free with gui_interface_inventory { kind: "containers" }.`,
          collidesWith: { file: hit.file, line: hit.line },
        });
      }
    }
  }

  // ------------------------------------------------------------ the custom_gui window contract
  //
  // A `custom_gui` window is not a blank canvas. The engine's graphics/diplomatic_eventwindow.cpp
  // looks a fixed set of elements up BY NAME inside the container the event names and dereferences
  // each one: a missing name is a null dereference, and a misplaced one is a control that never
  // works. None of that is visible to any geometric check, because the file parses and lays out
  // perfectly. See src/lib/contract.mjs for the measured list.
  //
  // Which containers are checked, and why it is not all of them: `isEventWindow`. A container that
  // has never been an event window - an option row, a chart panel, a vanilla view that is not an
  // event window - must not be told it is missing 26 elements it never needed.
  if (options.checkCustomGuiContract !== false) {
    const installRoot = String(assets?.root ?? '').toLowerCase().replace(/\\/g, '/');
    const sourceFiles = context.sourceFiles ?? [];
    const sourceIsInstall =
      installRoot !== '' &&
      sourceFiles.length > 0 &&
      sourceFiles.every((file) => file && String(file).toLowerCase().replace(/\\/g, '/').startsWith(installRoot));
    const contractOptions = {
      customGuiWindows: options.customGuiWindows ? [...options.customGuiWindows] : [],
      checkAllWindows: options.checkAllWindows === true,
      baseResolution: base,
      sourceIsInstall,
    };
    for (const entry of analyseEventWindows(layout, boxes, contractOptions)) {
      for (const finding of entry.findings) add(finding);
    }
    for (const finding of checkParkedElements(layout, boxes, contractOptions)) add(finding);
  }

  context.measurements = measurements;
  context.overlapBreakdown = overlapBreakdown;
  context.liveTextExcluded = liveTextExcluded;
  context.textUnresolved = boxes.filter((box) => {
    const key = box.node?.text ?? box.node?.buttonText ?? null;
    return typeof key === 'string' && key !== '' && !measurements.has(box);
  }).length;
  return finish(findings, base, options, context);
}

function pathOf(layout, node) {
  let found = null;
  walkLayout(layout.root, (candidate, _parent, _depth, path) => {
    if (candidate === node) found = path;
  });
  return found ?? node.name ?? '(node)';
}

/** Find containers named `*_option` that look like custom_gui_option rows. */
export function collectOptionRows(layout) {
  const rows = [];
  walkLayout(layout.root, (node, _parent, _depth, path) => {
    if (!/^[a-z0-9_]*option$/i.test(node.name ?? '')) return;
    if (!node.children) return;
    const hasOptionButton = node.children.some((child) => child.name === 'option_button');
    const hasOptionText = node.children.some((child) => child.buttonText === 'OPTION_TEXT' || child.text === 'OPTION_TEXT');
    rows.push({
      name: node.name,
      kind: node.kind,
      path,
      where: node.sourceFile ? `${node.sourceFile}:${node.sourceLine ?? '?'}` : path,
      hasOptionButton,
      hasOptionText,
    });
  });
  return rows;
}

/** The field this kind uses for the same intent, when there is one. */
function equivalentFieldFor(spec, field) {
  const lowered = String(field).toLowerCase();
  // A kind-level replacement first (`effect` on a `buttonType` is replaced by `effectbuttonType`).
  const forKind = equivalentForKind(spec.kind, field);
  if (forKind) return forKind;
  if (lowered === 'custom_tooltip' || lowered === 'fail_text') {
    if (spec.kind === 'effectbutton') return 'tooltipText';
    if (spec.kind === 'guiButton') return 'tooltip';
    if (['button', 'text', 'icon', 'checkbox', 'container', 'window'].includes(spec.kind)) return 'pdx_tooltip';
    return null;
  }
  if (lowered === 'origo') return spec.kind === 'container' ? null : 'centerPosition';
  if (lowered === 'alwaystransparent') return 'alwaysTransparent inside the background block';
  return null;
}

/** Suggest near-miss sprite names so an agent can self-correct. */
function emittableKindNames() {
  return ['container', 'text', 'icon', 'button', 'effectbutton', 'gridBox', 'listBox', 'smoothListBox', 'overlappingElementsBox', 'guiButton', 'scrollbar'];
}

/**
 * The texture size of the sprite an element references, or null.
 *
 * Used by the `size-not-accepted` rule to say whether dropping an icon's `size` changes anything:
 * if the sprite's texture is already that size (which is how vanilla icons are built), the
 * declaration is merely redundant, and reporting it as an error would be a false alarm.
 */
function naturalSizeOf(assets, node) {
  if (!assets?.sprites || !assets?.textures) return null;
  const name = node?.quadTextureSprite ?? node?.spriteType;
  if (!name) return null;
  const record = assets.sprites[name];
  const texture = record?.textureFile ? assets.textures[record.textureFile] : null;
  if (!texture?.ok || !texture.width) return null;
  return { width: texture.width, height: texture.height };
}

function nearestSprites(assets, name) {
  const stem = String(name).toLowerCase().replace(/^gfx_/, '').replace(/[^a-z0-9]/g, '');
  const candidates = Object.keys(assets.sprites)
    .map((candidate) => {
      const target = candidate.toLowerCase().replace(/^gfx_/, '').replace(/[^a-z0-9]/g, '');
      let common = 0;
      while (common < stem.length && common < target.length && stem[common] === target[common]) common += 1;
      return { candidate, score: common / Math.max(1, Math.max(stem.length, target.length)) };
    })
    .filter((entry) => entry.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => entry.candidate);
  return candidates.length > 0
    ? `did you mean: ${candidates.join(', ')}?`
    : 'check the name with gui_assets_search (sprite names are case-sensitive).';
}

function nearestFonts(assets, name) {
  const candidates = Object.keys(assets.fonts).slice(0, 8);
  return `known fonts include: ${candidates.join(', ')}.`;
}

/** Assemble the report with counts and the stated geometry assumption. */
function finish(findings, base, options, context) {
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byRule = {};
  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
  }
  const measuredList = context.measurements ? [...context.measurements.values()] : [];
  return {
    ok: bySeverity.error === 0,
    verdict: bySeverity.error === 0 ? 'pass' : 'fail',
    baseResolution: { width: base.width, height: base.height },
    geometryAssumption:
      `All coordinates are pixels in the ${base.width}x${base.height} base resolution. The game scales the whole ` +
      'UI, so "overlap" and "out of bounds" are only meaningful relative to this base.',
    counts: { total: findings.length, ...bySeverity },
    byRule,
    options,
    assetsChecked: Boolean(context.assets),
    localisationChecked: Boolean(context.localisation?.keys),
    buttonEffectsChecked: context.buttonEffectsResolved === true,
    containerNamesChecked: Boolean(context.assets?.containers) && options.checkContainerNames,
    extraButtonEffectRoots: context.extraButtonEffectRoots ?? [],
    sourceFiles: context.sourceFiles ?? [],
    // WHAT THE GEOMETRY RULES FOUND, split into what can and cannot be deliberate (GAP-11).
    // `outOfBounds.parked` is the count the classification moved out of the error rule, and it is
    // REPORTED here and as one info finding per element, so a large exclusion can never be mistaken
    // for silence. `parkMargin` is echoed so the number is falsifiable: change the margin and the
    // split moves.
    geometry: {
      outOfBounds: {
        // `total` is every element the rule CLASSIFIED, and it can be smaller than the finding count
        // when animation offsets are exempted (`allowOffscreenAnimated`): an element with a
        // `show_position` never reaches the rule at all. Both numbers are here so the split cannot be
        // read as the whole file.
        total: (context.parkClassification?.parked ?? 0) + (context.parkClassification?.escaped ?? 0),
        classified: (context.parkClassification?.parked ?? 0) + (context.parkClassification?.escaped ?? 0),
        escaped: context.parkClassification?.escaped ?? 0,
        parked: context.parkClassification?.parked ?? 0,
        parkMargin: context.parkClassification?.margin ?? null,
        parkedClassification: (context.parkClassification?.margin ?? 0) > 0 ? 'on' : 'off',
        note:
          'an element more than `parkMargin` px outside the root is reported as `out-of-bounds-parked` (info) ' +
          'instead of `out-of-bounds` (error): at that distance it cannot be part of the window, which is what the ' +
          'deliberate `-3000,-3000` park looks like. Nothing is suppressed - the parked count is here and each one ' +
          'has its own finding. `total` is what the rule classified; an element with a `show_position`/`hide_position` ' +
          'animation is exempted before the rule runs unless `allowOffscreenAnimated` is false.',
      },
    },
    // THE VISIBILITY TABLE (GAP-12). Every element carrying an `effect`, joined to the
    // `common/button_effects/` entry it names, with that entry's `potential` and the scope it demands -
    // when the effect files could be read. It is reported even when there is no finding, because a
    // condition that is true on one route into a window and false on another cannot be shown by a
    // findings-only report.
    visibility: {
      checked: options.checkVisibility === true,
      effectFiles: context.visibilityEffectFiles ?? [],
      summary: context.visibility?.summary ?? null,
      windows: context.visibilityWindows ?? [],
      table: context.visibility?.rows ?? [],
    },
    // Whether the overlap/overflow rules ran against MEASURED text or against boxes, and how
    // exact that measurement was. Without this a reader cannot tell a clean report from one
    // that simply could not measure anything, which is the failure mode that lets a text
    // defect survive a green verdict.
    textMeasured: measuredList.length > 0,
    textMeasurement: {
      language: options.language ?? 'english',
      elements: measuredList.length,
      exact: measuredList.filter((entry) => entry.exact).length,
      estimated: measuredList.filter((entry) => !entry.exact).length,
      wrapped: measuredList.filter((entry) => entry.lineCount > 1).length,
      overflowing: measuredList.filter((entry) => entry.overflows).length,
      // Text elements whose measurement was an unresolved LIVE token rather than painted text, and
      // how many `text-overflow` / collision findings that removed (GAP-5). Reported so an excluded
      // artefact cannot be mistaken for a clean measurement.
      live: measuredList.filter((entry) => entry.live).length,
      liveOnResolvingChannel: measuredList.filter((entry) => entry.live && entry.liveOnResolvingChannel).length,
      liveExcluded: {
        elements: context.liveTextExcluded ? context.liveTextExcluded.elements?.size ?? 0 : 0,
        overflow: context.liveTextExcluded?.overflow ?? 0,
        collision: context.liveTextExcluded?.collision ?? 0,
      },
      unresolvedKeys: context.textUnresolved ?? 0,
      overlapBreakdown: context.overlapBreakdown ?? null,
      exactness: measuredList.some((entry) => entry.exact)
        ? 'advances are exact (read from the engine\'s own font descriptors); line height is exact for ' +
          'bitmap fonts and derived for TrueType overrides'
        : 'no exact descriptor was used',
      note:
        '`sibling-overlap` compares MEASURED ink wherever a string resolved, so a box that overlaps ' +
        'another box without the text reaching it is no longer reported; `text-overflow` and ' +
        '`text-collision` are computed from the measured extents with wrapping modelled.',
    },
    findings,
  };
}

/** Convenience: parse `.gui` text and validate it in one call. */
export function validateGuiText(text, fileKey, context = {}) {
  const parsed = parseGuiText(text, fileKey);
  if (!parsed.ok) {
    return {
      ok: false,
      verdict: 'fail',
      baseResolution: parsed.layout?.baseResolution ?? { ...BASE_RESOLUTION },
      counts: { total: 1, error: 1, warning: 0, info: 0 },
      byRule: { 'root-invalid': 1 },
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
  const report = validateLayout(parsed.layout, { ...context, rootKeyword: parsed.rootKeyword, sourceFiles: [fileKey] });
  // The layout tree is internally consistent even when the FILE is not: `size` on an
  // instantTextBoxType lays out and previews perfectly and the engine still refuses to parse it.
  // So the file's own syntax is checked as text as well, and the findings are merged - that is
  // the check that catches the class of bug the engine's error.log exposed.
  if (context.checkSyntax !== false) {
    const syntax = checkGuiSyntax(text, fileKey);
    mergeFindings(report, syntax.findings);
    report.syntax = { ok: syntax.ok, counts: syntax.counts, rootKeyword: syntax.rootKeyword, elementBlocks: syntax.elementBlocks };
    recomputeCounts(report);
  }
  return report;
}

const SEVERITY_RANK = { info: 0, warning: 1, error: 2 };

/**
 * Fold a second checker's findings into a report, one finding per (rule, element).
 *
 * The tree and the FILE describe the same element from two directions - the layout rule reports a
 * model path, the syntax rule reports `file:line` with the engine's own wording - so the same
 * defect would otherwise be counted twice. When both fire, the more severe description wins, and
 * the file position is always attached: a caller needs `file:line` to go and fix it.
 *
 * A finding that carries a `token` is keyed on the TOKEN as well (`unexpected-token`: one unknown
 * scalar per token, and an element may carry several). Without that, two bogus tokens in one element
 * would merge into one finding and the second one would disappear from the report.
 */
export function mergeFindings(report, incoming) {
  const keyOf = (item) =>
    item.token
      ? `${item.rule}|${item.token}|${item.where}`
      : item.element
        ? `${item.rule}|${item.element}`
        : `${item.rule}|${item.where}`;
  const index = new Map(report.findings.map((finding, position) => [keyOf(finding), position]));
  for (const finding of incoming) {
    const severity = RULE_SEVERITY[finding.rule] ?? finding.severity ?? 'warning';
    const key = keyOf(finding);
    const at = index.get(key);
    const entry = { suggestedFix: null, ...finding, severity };
    if (at === undefined) {
      report.findings.push(entry);
      index.set(key, report.findings.length - 1);
      continue;
    }
    const existing = report.findings[at];
    report.findings[at] =
      (SEVERITY_RANK[entry.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)
        ? { suggestedFix: existing.suggestedFix ?? null, ...entry }
        : { ...existing, line: entry.line ?? existing.line, engineMessage: entry.engineMessage ?? existing.engineMessage };
  }
  return report;
}

/** Recompute the counts after findings are merged in from another checker. */
function recomputeCounts(report) {
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byRule = {};
  for (const finding of report.findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
  }
  report.counts = { total: report.findings.length, ...bySeverity };
  report.byRule = byRule;
  report.ok = bySeverity.error === 0;
  report.verdict = report.ok ? 'pass' : 'fail';
}

/** Standalone root-keyword check, for a file whose tree we did not build. */
export function validateGuiRoot(text, fileKey) {
  const keyword = parseGuiText(text, fileKey).rootKeyword;
  if (/^guiTypes$/i.test(keyword)) return { ok: true, rootKeyword: keyword, file: fileKey };
  return {
    ok: false,
    rootKeyword: keyword,
    file: fileKey,
    rule: 'root-invalid',
    message: `root construct is \`${keyword}\`, not \`guiTypes\`.`,
  };
}

export { DEFAULT_OPTIONS as VALIDATION_DEFAULTS };
