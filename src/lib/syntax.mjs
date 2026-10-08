//------------------------------------------------------------------------------------
// syntax.mjs -- Part of RStellarisGui
//
// The ENGINE SYNTAX CHECKER: it reads a `.gui` file the way the engine's own parsers do and
// reports the constructs the engine will reject, with the engine's wording and line numbers.
//
// Why this module exists, in the engine's own words. Running an earlier revision's output in
// Stellaris 4.4.6 produced this in `Documents/Paradox Interactive/Stellaris/logs/error.log`:
//
//   [persistent.cpp:41]: Error: "Unexpected token: size, near line: 56
//   " in file: "interface/zz_geocentric_unga.gui" near line: 59
//   [persistent.cpp:41]: Error: "Malformed token: width, near line: 96
//   Malformed token: height, near line: 97
//   " in file: "interface/zz_geocentric_unga.gui" near line: 98
//   [instanttextboxtype.cpp:138]: Not used, use maxWidth and maxHeight
//     file: interface/zz_geocentric_unga.gui line: 95
//
// Line 56 there is `size = {` inside an `iconType`, and line 95 is the same inside an
// `instantTextBoxType`. Neither kind accepts `size` at all: across all 177 vanilla `.gui` files
// in the verified 4.4.6 install there are 2779 `iconType` and 3218 text blocks and ZERO of them
// declare a `size`. Text uses `maxWidth`/`maxHeight` (3138 / 2890 uses) and icons draw at their
// sprite's natural size.
//
// A validator that only looked at its own layout tree could never have caught this: the tree
// is internally consistent and the geometry is correct. The mistake is pure file SYNTAX, so it
// is checked against the file text, and this checker runs on files the tool did not write.
//
// The `.log` fixture at scripts/fixtures/engine-error-baseline.log holds those verbatim engine
// lines, and selftest.mjs asserts that every error in it produces a finding here. That is the
// regression guard: this class of bug cannot come back silently.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import {
  BACKGROUND_FIELDS,
  equivalentForKind,
  isEnginePopulated,
  isEngineRejectedField,
  isFieldRejectedForKind,
  isKindRejectedFieldName,
  isKnownField,
  isUnmodelledCorpusField,
  kindAcceptsField,
  kindRejectedFieldNote,
  kindSpecByKeyword,
  sizeFormFor,
  suggestFields,
  SIZE_FORMS,
} from './kinds.mjs';
import { firstConstruct, parseParadox } from './paradox.mjs';

/** Kinds whose `size` the engine hard-rejects, with the engine's own message. */
const SIZE_REJECTED_MESSAGE = {
  text:
    'the engine parses `instantTextBoxType` with its own text parser, which has no `size` token: it reports ' +
    '`Unexpected token: size` and then `Not used, use maxWidth and maxHeight`. Use `maxWidth`/`maxHeight`.',
  icon:
    'the engine parses `iconType` without a `size` token and reports `Unexpected token: size` for this block; the ' +
    'icon draws at its sprite texture\'s natural size instead.',
};

/**
 * Check a `.gui` file's text against the engine's per-kind syntax.
 *
 * @param {string} text
 * @param {string} fileKey used in `where`
 * @returns {{ok: boolean, findings: object[], rootKeyword: string|null, elementBlocks: number}}
 */
export function checkGuiSyntax(text, fileKey = '(inline)') {
  const findings = [];
  const add = (finding) => findings.push({ suggestedFix: null, file: fileKey, ...finding });

  const rootKeyword = firstConstruct(text);
  let parsed;
  try {
    parsed = parseParadox(text);
  } catch (thrown) {
    add({
      rule: 'gui-parse-error',
      severity: 'error',
      line: null,
      where: fileKey,
      message: `the lexer could not read this file: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    });
    return { ok: false, findings, rootKeyword, elementBlocks: 0 };
  }

  // The root rule: `guiTypes = { ... }`, compared case-insensitively (vanilla has one
  // `guitypes`, in traits.gui).
  const hasGuiTypesRoot = parsed.roots.some((entry) => entry.key && /^guitypes$/i.test(entry.key) && entry.children);
  if (!hasGuiTypesRoot) {
    add({
      rule: 'root-invalid',
      severity: 'error',
      line: 1,
      where: fileKey,
      message:
        `root construct is \`${rootKeyword}\`, not \`guiTypes\`. A .gui file's root MUST be \`guiTypes = { ... }\` ` +
        '(compared case-insensitively); a bare element at the top level is a parse error.',
      suggestedFix: 'wrap every element in `guiTypes = { ... }`. `@variable` lines may precede it.',
    });
  }

  let elementBlocks = 0;
  const visit = (block) => {
    if (block.key && block.children) {
      const spec = kindSpecByKeyword(block.key);
      if (spec) {
        elementBlocks += 1;
        checkElementSyntax(block, spec, fileKey, add);
        for (const child of block.children) {
          // A CHILD ELEMENT INSIDE AN ENGINE-POPULATED BOX IS NEVER READ (GAP-13). The engine
          // reports the child's own keyword and skips the whole subtree - the bogus scalar inside
          // the nested child of the probe's grid box is absent from a log that reports the grid
          // box's own bogus scalar and the host container's. Walking into it would put a finding in
          // the report that the engine's own reader provably never makes, so the descent stops here
          // and the parent finding says the block was skipped. Scalars and sub-blocks still walk:
          // they are `checkElementFields`' business, not a subtree.
          if (isEnginePopulated(spec) && child.children && kindSpecByKeyword(child.key)) continue;
          visit(child);
        }
        return;
      }
    }
    for (const child of block.children ?? []) visit(child);
  };
  for (const root of parsed.roots) visit(root);

  const bySeverity = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  return {
    ok: bySeverity.error === 0,
    findings,
    counts: { total: findings.length, ...bySeverity },
    rootKeyword,
    elementBlocks,
    baseNote: 'Syntax findings are line-based and independent of the 1920x1080 geometry base.',
  };
}

/** Check one element block: its `size` spelling, its per-kind fields, and a text element's max size. */
function checkElementSyntax(block, spec, fileKey, add) {
  const sizeBlocks = (block.children ?? []).filter((child) => child.key && child.children && /^size$/i.test(child.key));
  const keyword = block.key;
  // `accepted` is false for text (whose size is `maxWidth`/`maxHeight`) and for icon (which has
  // no size at all): a `size` BLOCK in either is the engine's "Unexpected token: size".
  const { form, accepted } = sizeFormFor(spec, keyword);
  const declared = sizeBlocks[0] ?? null;
  const where = `${fileKey}:${block.line}`;
  const element = nameOf(block);

  checkElementFields(block, spec, fileKey, element, add);
  checkEnginePopulatedChildren(block, spec, fileKey, element, add);
  checkUnknownTokens(block, spec, fileKey, element, add);

  if (declared && !accepted) {
    const natural = SIZE_REJECTED_MESSAGE[spec.kind] ?? `\`${keyword}\` does not accept a \`size\` block.`;
    add({
      rule: 'size-not-accepted',
      severity: 'error',
      line: declared.line,
      where: `${fileKey}:${declared.line}`,
      element,
      kind: spec.kind,
      engineMessage: `Unexpected token: size, near line: ${declared.line}`,
      message:
        `\`size = { ... }\` at line ${declared.line} is inside \`${keyword}\` (name \`${element}\`): ${natural} ` +
        'The engine reports this as a parse error, so the whole block is dropped at load time.',
      suggestedFix:
        spec.kind === 'text'
          ? 'replace `size = { width = W height = H }` with `maxWidth = W` and `maxHeight = H`.'
          : `delete the \`size\` block; pick a sprite whose texture is already the size you want, or wrap the icon in a containerWindowType and size that instead.`,
    });
    return;
  }

  if (declared && accepted) {
    const keys = (declared.children ?? []).filter((child) => child.key && !child.children).map((child) => child.key.toLowerCase());
    const widthHeight = keys.includes('width') || keys.includes('height');
    const xY = keys.includes('x') || keys.includes('y');
    if (form === SIZE_FORMS.xY && widthHeight) {
      add({
        rule: 'size-form-wrong',
        severity: 'error',
        line: declared.line,
        where: `${fileKey}:${declared.line}`,
        element,
        kind: spec.kind,
        engineMessage: `Malformed token: ${keys.join(', ')}, near line: ${declared.line}`,
        message:
          `\`${keyword}\` (name \`${element}\`) takes \`size = { x = W y = H }\`, where x is the width and y is the ` +
          `height, but line ${declared.line} writes \`${keys.join('` / `')}\`. Vanilla uses the x/y form in ` +
          `${spec.vanillaUses} of ${spec.vanillaUses} \`${keyword}\` blocks; the width/height spelling belongs to ` +
          '`containerWindowType` and `gridBoxType` only.',
        suggestedFix: `write \`size = { x = <width> y = <height> }\`.`,
      });
    } else if (form === SIZE_FORMS.widthHeight && xY) {
      add({
        rule: 'size-form-wrong',
        severity: 'error',
        line: declared.line,
        where: `${fileKey}:${declared.line}`,
        element,
        kind: spec.kind,
        message:
          `\`${keyword}\` (name \`${element}\`) takes \`size = { width = W height = H }\`, but line ${declared.line} ` +
          'uses the x/y spelling. Vanilla uses the x/y form for buttons, lists and scrollbars and the width/height ' +
          'form for containers and grid boxes.',
        suggestedFix: 'write `size = { width = <width> height = <height> }`.',
      });
    }
  }

  // A text element with neither maxWidth nor maxHeight has no size at all: 3138 of 3202 vanilla
  // text blocks carry maxWidth and 2890 carry maxHeight, so the pair is the convention, not an
  // accident. Without it the engine lays the text out at zero width.
  if (spec.kind === 'text') {
    const hasMaxWidth = (block.children ?? []).some((child) => child.key && /^maxwidth$/i.test(child.key));
    const hasMaxHeight = (block.children ?? []).some((child) => child.key && /^maxheight$/i.test(child.key));
    if (!hasMaxWidth && !hasMaxHeight) {
      add({
        rule: 'text-without-max-size',
        severity: 'warning',
        line: block.line,
        where,
        element,
        kind: 'text',
        message:
          `\`${keyword}\` (name \`${element}\`) declares neither \`maxWidth\` nor \`maxHeight\`, so the engine has no ` +
          `box to lay the text out in. 3138 of 3202 vanilla text blocks declare maxWidth and 2890 declare maxHeight.`,
        suggestedFix: 'add `maxWidth = <pixels>` and `maxHeight = <pixels>`.',
      });
    }
  }
}

/** The inline `name = "..."` of an element block, for messages. */
function nameOf(block) {
  const entry = (block.children ?? []).find((child) => child.key && /^name$/i.test(child.key) && !child.children);
  return entry?.value ?? '(unnamed)';
}

/** `line 31` or `lines 31-38`, the span the engine's own reader quotes. */
function spanText(block) {
  return block.closeLine && block.closeLine !== block.line
    ? `lines ${block.line}-${block.closeLine}`
    : `line ${block.line}`;
}

/**
 * Keys that are the element's own IDENTITY rather than a field of its parser.
 *
 * `name` is how the engine finds an element and `id` is a real engine field on several kinds (and
 * this model's node identity besides - see kinds.mjs `ENGINE_ID_FIELD`), so neither can be judged by
 * a per-kind field list. They are the only two: everything else in a block's body is a field.
 */
const STRUCTURAL_ELEMENT_KEYS = new Set(['name', 'id']);

/**
 * A CHILD ELEMENT INSIDE AN ENGINE-POPULATED CONTAINER IS REJECTED, NOT IGNORED (GAP-13).
 *
 * `gridBoxType`, `OverlappingElementsBoxType`, `listBoxType` and `smoothListBoxType` are boxes the
 * C++ FILLS; a `.gui` cannot put an element in one. The install measures it (0 of 261 / 189 / 242 /
 * 43 vanilla blocks of those kinds contain a nested element), and the in-game probe of 2026-10-06
 * settled what the engine DOES about it - `error.log`, verbatim:
 *
 *   [23:50:06][persistent.cpp:41]: Error: "Unexpected token: instantTextBoxType, near line: 31
 *   " in file: "interface/zz_gui_probe_grid.gui" near line: 38
 *   [23:50:06][persistent.cpp:41]: Error: "Unexpected token: containerWindowType, near line: 60
 *   " in file: "interface/zz_gui_probe_grid.gui" near line: 65
 *
 * One line per child element, at FILE LOAD, naming the child's keyword and the span it skipped; and
 * nothing from INSIDE the skipped block is reported, so the reader abandoned the subtree whole. The
 * caller's descent stops for the same reason (`checkGuiSyntax`), which is why this finding, and not
 * one inside the child, is what a file in this shape gets.
 *
 * HONEST LIMIT, stated in the finding itself: only `gridBoxType` was probed. The other three kinds
 * are expected to answer the same way - the engine named the same token class - but that was NOT
 * measured, and `listBoxType name = "option_list"` is a known vanilla exception whose rows the engine
 * supplies itself. The finding says so rather than claiming four measurements it does not have.
 */
function checkEnginePopulatedChildren(block, spec, fileKey, element, add) {
  if (!isEnginePopulated(spec)) return;
  for (const child of block.children ?? []) {
    if (!child.key || !child.children || !kindSpecByKeyword(child.key)) continue;
    const spanned = spanText(child);
    add({
      rule: 'engine-populated-container-children',
      severity: 'error',
      line: child.line,
      where: `${fileKey}:${child.line}`,
      element,
      kind: spec.kind,
      elementLine: child.line,
      engineMessage: `Unexpected token: ${child.key}, near line: ${child.line}`,
      blockSpan: { open: child.line, close: child.closeLine ?? null },
      message:
        `\`${block.key}\` (name \`${element}\`) holds a child element \`${child.key}\` (name ` +
        `\`${nameOf(child)}\`) at ${spanned}, but this kind is FILLED BY THE ENGINE: the engine reports ` +
        `"Unexpected token: ${child.key}" when the FILE IS LOADED and skips the whole child block, so nothing ` +
        `inside ${spanned} is read - not the child's fields, and not anything wrong inside them either. Measured ` +
        `over the install's 177 .gui files, 0 of ${spec.vanillaUses} vanilla \`${block.key}\` blocks contain a ` +
        `nested element. Only \`gridBoxType\` was probed in game (2026-10-06); the other three engine-populated ` +
        `kinds measure 0 nested elements too, but the engine's answer for them was NOT measured.`,
      suggestedFix:
        'for your OWN cells use the `matrix` component (it expands into positioned `containerWindowType`s); keep ' +
        'this box only if the engine is meant to fill it.',
    });
  }
}

/**
 * AN UNKNOWN SCALAR TOKEN IS AN ENGINE PARSE ERROR (GAP-16).
 *
 * The engine's `.gui` reader is token-driven: a scalar it does not know is `Unexpected token: <token>`
 * and the enclosing block is dropped. Measured on the probe file (PROBE-RESULTS.md section 2, run B):
 * `probeZZtokenInGrid` inside a `gridBoxType` and `probeZZtokenInHost` inside a `containerWindowType`
 * each produced exactly one `persistent.cpp:41` line at file load, while the plugin's own syntax check
 * reported ZERO findings on the same 86-line file that the engine answered with four token lines.
 *
 * Three exemptions, and each one is a measurement rather than a convenience:
 *
 *   * `name` / `id` - the element's identity, not a field of its parser.
 *   * `@name = value` - a VARIABLE DECLARATION that happens to sit inside the block (169 uses of
 *     `@tabheight`-style lines in vanilla containers). It is not a token of the element's parser.
 *   * a field the CORPUS writes on this kind but this model does not declare
 *     (`kinds.mjs` `UNMODELLED_CORPUS_FIELDS`: `movable`, `navLeft`, `navRight`, `alpha`,
 *     `concepts_show_missing_dlc`). The engine loaded the files that carry them, so they are a gap in
 *     THIS MODEL, not a defect in the file, and calling them errors would report vanilla's own files
 *     broken in 39 places.
 *
 * A field that some OTHER kind declares, that the engine is known to reject, or that the engine named
 * as a token while rejecting it on some kind (`KIND_REJECTED_FIELDS`: `visible`) is not "unknown" and
 * is handled by `checkElementFields` (`field-not-accepted`), so this rule never double-reports one -
 * and it never makes the stronger claim "no parser has this name" about a name the engine itself
 * spoke. An unknown BLOCK (`foo = { ... }`) is deliberately out of scope: the corpus's non-element
 * blocks include the resolution conditionals, which are legal, and the model's block vocabulary is
 * not a closed set the way the scalar field lists are.
 */
function checkUnknownTokens(block, spec, fileKey, element, add) {
  for (const child of block.children ?? []) {
    if (!child.key || child.children) continue;
    if (child.key.startsWith('@')) continue;
    const lowered = child.key.toLowerCase();
    if (STRUCTURAL_ELEMENT_KEYS.has(lowered)) continue;
    if (kindAcceptsField(spec, child.key)) continue;
    // `isKnownField` / `isEngineRejectedField` / `isKindRejectedFieldName` are all "the engine (or
    // this model) knows this NAME": the first two are declared or proven somewhere, the third is a
    // name the engine itself named as a token while rejecting it on some kind (GAP-15's `visible`).
    // None of them is an UNKNOWN token, and `field-not-accepted` is the rule that reports them.
    if (isKnownField(child.key) || isEngineRejectedField(child.key) || isKindRejectedFieldName(child.key)) continue;
    if (isFieldRejectedForKind(spec, child.key)) continue;
    if (isUnmodelledCorpusField(spec, child.key)) continue;
    const near = suggestFields(child.key);
    add({
      rule: 'unexpected-token',
      severity: 'error',
      line: child.line,
      where: `${fileKey}:${child.line}`,
      element,
      kind: spec.kind,
      token: child.key,
      engineMessage: `Unexpected token: ${child.key}, near line: ${child.line}`,
      message:
        `\`${child.key}\` (line ${child.line}) is not a field of \`${block.key}\` (element \`${element}\`), not a field of ` +
        `any other kind this project models, and not a field any of the install's 177 vanilla .gui files writes on this ` +
        `kind. The engine's reader answers an unknown scalar with "Unexpected token: ${child.key}" and DROPS THE ` +
        `ENCLOSING BLOCK at file load - measured on a probe file, one \`persistent.cpp:41\` line per bogus token ` +
        `(PROBE-RESULTS.md section 2).`,
      suggestedFix: near.length > 0 ? `did you mean: ${near.join(', ')}?` : 'delete it, or move the intent to a kind that accepts it.',
    });
  }
}

/**
 * PER-KIND FIELDS. The engine parses each element kind with its own field list, and a field
 * outside it is `Unexpected token: <field>` - the block is dropped at load time. Measured
 * evidence, all from the install's 177 `.gui` files:
 *
 *   `custom_tooltip`  0 uses on any .gui element (it is a SCRIPT field: 3777 uses inside events)
 *   `alwaysTransparent` text 1234, icon 1473, button 166, guiButton 1, listBox 10, smoothListBox 21,
 *                     containerWindowType 0 - and 412 inside `background` blocks, which is where
 *                     a container's transparency belongs (interface/planet_view.gui:255)
 *   `origo`            containerWindowType 175, everything else 0 (an icon wants
 *                     `centerPosition = yes`, 285 uses)
 *   `effect`           `effectbuttonType` only. On a `buttonType` - the natural mistake, since the
 *                      two kinds share every other field - the engine answers
 *                      `Unexpected token: effect` and drops the block, so the button renders and
 *                      does NOTHING. The trial mod's six close buttons spent a round in that state
 *                      and only carried their script once converted to `effectbuttonType` with
 *                      identical name/sprite/position/orientation/clicksound. `buttonType` has no
 *                      scriptable action at all: its action is hardcoded in the engine.
 *
 * A finding for a field the engine is KNOWN to reject is an error; a field that vanilla merely
 * never writes on that kind is a warning, because this table is a measurement of the corpus
 * rather than a proof about the parser.
 */
function checkElementFields(block, spec, fileKey, element, add) {
  for (const child of block.children ?? []) {
    if (!child.key) continue;
    if (/^background$/i.test(child.key) && child.children) {
      checkBackgroundFields(child, fileKey, element, add);
      continue;
    }
    // A NESTED ELEMENT is a child, not a field: `containerWindowType { scrollbarType = { ... } }`
    // holds an element whose key looks like a field name on other kinds (14 vanilla uses).
    if (child.children && kindSpecByKeyword(child.key)) continue;
    if (kindAcceptsField(spec, child.key)) continue;
    // TWO SOURCES OF "REJECTED", and the difference between them is the measurement, not the
    // severity: `isEngineRejectedField` is global (proven on a kind where vanilla writes the field
    // nowhere), `isFieldRejectedForKind` is per kind (GAP-15: `visible` on a `containerWindowType`,
    // proven by the engine's own log, and NOT generalised to the kinds nobody probed).
    const rejectedForKind = isFieldRejectedForKind(spec, child.key);
    if (!isKnownField(child.key) && !isEngineRejectedField(child.key) && !rejectedForKind) continue;
    const rejected = isEngineRejectedField(child.key) || rejectedForKind;
    const target = translateHint(spec, child.key);
    add({
      rule: 'field-not-accepted',
      severity: rejected ? 'error' : 'warning',
      line: child.line,
      where: `${fileKey}:${child.line}`,
      element,
      kind: spec.kind,
      elementLine: block.line,
      ...(rejected ? { engineMessage: `Unexpected token: ${child.key}, near line: ${child.line}` } : {}),
      message:
        `\`${child.key}\` is not a field of \`${spec.keywords[0]}\` (element \`${element}\`)` +
        (rejected
          ? ': ' +
            (kindRejectedFieldNote(spec, child.key) ??
              `the engine reports "Unexpected token: ${child.key}" and drops the block.`) +
            ' '
          : `: vanilla never writes it on this kind (${vanillaUseNote(child.key)}). `) +
        (target ? `The equivalent here is \`${target}\`.` : ''),
      suggestedFix: target ? `replace it with \`${target}\`.` : `delete it, or move the intent to a kind that accepts it.`,
    });
  }
}

/** Fields inside a `background = { ... }` block have their own, smaller set. */
function checkBackgroundFields(block, fileKey, element, add) {
  for (const child of block.children ?? []) {
    if (!child.key) continue;
    if (BACKGROUND_FIELDS.has(child.key.toLowerCase())) continue;
    if (!isKnownField(child.key) && !isEngineRejectedField(child.key)) continue;
    add({
      rule: 'field-not-accepted',
      severity: isEngineRejectedField(child.key) ? 'error' : 'warning',
      line: child.line,
      where: `${fileKey}:${child.line}`,
      element,
      kind: 'background',
      engineMessage: `Unexpected token: ${child.key}, near line: ${child.line}`,
      message: `\`${child.key}\` is not a \`background\` block field (element \`${element}\`). See interface/planet_view.gui:252-257 for the shape vanilla uses.`,
      suggestedFix: 'delete it; a background block takes name/spriteType/quadTextureSprite/position/alwaysTransparent.',
    });
  }
}

/** Rough vanilla usage note, for the message. */
function vanillaUseNote(field) {
  const lowered = String(field).toLowerCase();
  if (lowered === 'custom_tooltip') return '0 uses on any .gui element; it is a script field';
  if (lowered === 'alwaystransparent') return 'accepted by text/icon/button/list kinds and inside a background block, not by containers';
  if (lowered === 'origo') return 'containerWindowType only';
  return 'no use on this kind in the verified install';
}

/** The field this kind uses for the same intent, when there is one. */
function translateHint(spec, field) {
  const lowered = String(field).toLowerCase();
  // The kind-specific replacement table first: `effect` on a `buttonType` is replaced by a KIND,
  // not by another field (`effectbuttonType`), and that is the shape a caller can act on.
  const forKind = equivalentForKind(spec.kind, field);
  if (forKind) return forKind;
  if (lowered === 'custom_tooltip' || lowered === 'fail_text') {
    if (spec.kind === 'effectbutton') return 'tooltipText';
    if (spec.kind === 'guiButton') return 'tooltip';
    if (['button', 'text', 'icon', 'checkbox', 'container', 'window'].includes(spec.kind)) return 'pdx_tooltip';
    return null;
  }
  if (lowered === 'origo') return spec.kind === 'container' ? 'origo' : 'centerPosition = yes';
  if (lowered === 'alwaystransparent') return 'alwaysTransparent inside the `background` block';
  return null;
}

/**
 * The engine's own error lines, parsed out of a Stellaris `error.log` excerpt.
 *
 * The engine wraps its messages: `Error: "Unexpected token: size, near line: 56\n" in file:
 * "..." near line: 59`. So the scan is over the whole text, not line by line, and the file/line
 * are read from the text that FOLLOWS the closing quote.
 *
 * Used by the regression fixture: every entry here must produce a finding.
 *
 * @param {string} logText
 * @returns {{file: string|null, line: number|null, message: string, engineMessage: string}[]}
 */
export function parseEngineErrorLog(logText) {
  const text = String(logText);
  const results = [];
  const pattern = /Error: "([^"]*)"/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 300);
    const fileMatch = /file: "([^"]+)"/.exec(after);
    const lineMatch = /near line: (\d+)/.exec(match[1]) ?? /near line: (\d+)/.exec(after);
    results.push({
      engineMessage: match[1].split('\n')[0].replace(/,\s*$/, '').trim(),
      message: match[1].trim(),
      file: fileMatch ? fileMatch[1] : null,
      line: lineMatch ? Number(lineMatch[1]) : null,
    });
  }
  const notUsedPattern = /Not used, use maxWidth and maxHeight\s+file: (\S+) line: (\d+)/g;
  while ((match = notUsedPattern.exec(text)) !== null) {
    results.push({
      engineMessage: 'Not used, use maxWidth and maxHeight',
      message: 'Not used, use maxWidth and maxHeight',
      file: match[1],
      line: Number(match[2]),
    });
  }
  return results;
}

export default { checkGuiSyntax, parseEngineErrorLog };
