//------------------------------------------------------------------------------------
// apply.mjs -- Part of RStellarisGui
//
// THE APPLY PATH: an edited layout tree back into the FILE IT WAS IMPORTED FROM, leaving
// every line the edit did not touch byte-identical.
//
// WHY THIS EXISTS. `emitGui` builds a file out of the tree, so the tree is the only thing
// that can survive the trip. A hand-maintained `.gui` carries something the tree does not
// model: its COMMENTS. Those are not decoration. This project's own six-window mod records
// its engine contract in them - `# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE` above the
// element names the engine dereferences by name, and a `# DIAGNOSTIC` note recording why a
// control is an `effectbuttonType`. Measured on the real 146,310-byte file: import followed
// by `gui_emit_files` preserves all 639 element `name = "..."` tokens and drops 132
// comment-bearing lines to 6. So the only thing the emit path loses is exactly the thing
// that documents which edits crash the game.
//
// THE DISCIPLINE. Two rules, both enforced here:
//
//   1. AN UNMODIFIED ELEMENT IS NOT REWRITTEN. Every element is rendered from the edited
//      tree and compared against the bytes it occupies in the original text. If they are
//      the same - and for an untouched node they are, because a parsed node keeps its
//      `enginePosition`, its keyword spelling and its field set, which is what makes an
//      import -> emit round trip exact - the ORIGINAL lines are copied verbatim, comments
//      and all. So an edit-free apply is byte-identical BY CONSTRUCTION rather than by
//      hope, and a one-field edit rewrites one element.
//
//   2. AN ELEMENT THAT DID CHANGE IS REPLACED AS A WHOLE BLOCK. Partial line-level editing
//      inside an element is not attempted: a `position` that moved is two lines, but the
//      element's field ORDER is the tree's, and a half-spliced block is how a `.gui` file
//      ends up with a duplicated field. The block that replaces it is rendered by the same
//      `renderElement` the emitter uses, so the engine acceptance rules (per-kind `size`
//      form, per-kind field set) are the ones already verified in `kinds.mjs` - and the
//      patched text goes through `checkGuiSyntax` before anything is written.
//
//   3. A CHANGED CONTAINER KEEPS ITS UNCHANGED CHILDREN. The rewrite is recursive: a
//      container whose own fields moved is re-rendered, but each of its children is again
//      tested against its own source block, so the comment inside a container survives a
//      change to the container's `position`.
//
// WHAT THIS MODULE DOES NOT DO. It is not a general-purpose text editor: the edited tree
// must be the SAME TREE SHAPE as the baseline, matched by element name within one parent.
// An element that only exists in the edit is inserted in its edited position with the
// indentation of its new siblings; an element the edit deleted is removed with the comment
// block above it. A rename is a removal plus an addition, and is reported as such, because
// "which element is this now" is not a question the model can answer.
//
// AN ADDED ELEMENT IS RENDERED, NOT SPLICED - and the three rules that make that true are the
// correction of GAP-4, where a single added top-level window took the real 146,310-byte file to
// 300,332 bytes with two copies of every window:
//
//   1. IT HAS NO INTERIOR. An element with no source block has no lines to copy, so its body is
//      exactly its children's fresh renders. The interior walk used to fall back to
//      `{ from: 0, to: lines.length - 1 }` - "search the whole file" - so the new element absorbed
//      every original line and nested it inside itself.
//   2. IT ADOPTS NO OTHER ELEMENT'S BLOCK. `matchChildrenToRanges` may only match inside a parent
//      that HAS a block. A new element cannot host a block that exists elsewhere in the file, and a
//      child that merely shares a NAME with some unrelated element (a `.gui` here has several
//      `close`, `portrait` and `*_value_num` names per file) was otherwise adopted, its block was
//      never emitted - it lies outside the new element's range - and the new window came out EMPTY.
//   3. ITS OWN FIELD LINES COME FROM THE RENDER. An element that has a block copies its interior
//      byte for byte, which is what preserves a `position` block's comment and spelling; an element
//      that does not has nothing to copy, so `split.fields` is the only source of `name`,
//      `position`, `size` and the kind-specific fields. Dropping them emits a bare
//      `containerWindowType = { ... }` with no `name` at all - unaddressable by `custom_gui`.
//
// All three were invisible to `checkGuiSyntax` (the output is balanced) and to a top-level window
// count (the duplicate copies are indented). The selftest group `apply mode: adding a top-level
// window (GAP-4)` asserts the counts on the OUTPUT - one occurrence of each window name, at one
// tab - and each defect is proven to fail it on its own.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';import { isAbsolute, resolve } from 'node:path';

import { kindSpec, kindSpecByKeyword, knownKeywords } from './kinds.mjs';
import { BASE_RESOLUTION, computeLayout, walkLayout } from './layout.mjs';
import { insideGameInstall } from './paths.mjs';
import { checkGuiSyntax } from './syntax.mjs';

/** Split text into lines without losing the file's own line ending. */
function splitLines(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  // A trailing newline yields a final empty element; it is a real (empty) line and is kept so
  // the join reproduces the file exactly.
  return { lines, eol };
}

/** The name a block declares, from its own source text (`name = "..."`, first match wins). */
function declaredNameOfRange(lines, from, to) {
  for (let index = from; index <= to; index += 1) {
    const match = /(?:^|\s)name\s*=\s*"?([^"\s{}]+)"?/.exec(lines[index] ?? '');
    if (match) return match[1];
  }
  return null;
}

/** Net brace count of one line, ignoring `#` comments and `"` strings. */
function braceDelta(line) {
  let depth = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '#') break;
    else if (!quoted && char === '{') depth += 1;
    else if (!quoted && char === '}') depth -= 1;
  }
  return depth;
}

/**
 * Every element occurrence in the source text, in document order, with the line range it
 * occupies and the comment/blank lines immediately above it.
 *
 * The shape found is `<keyword> = {` at a line start, where `<keyword>` is a keyword this
 * project models, so a `show_position = {` sub-block or an `@variable` line is not mistaken
 * for an element. The block's extent comes from brace counting rather than indentation: the
 * real file mixes indentation levels (`OverlappingElementsBoxType` inside a window is
 * indented one tab deeper than its siblings; one element's comment block is at the
 * container's depth rather than the element's).
 *
 * `leading` is the run of comment/blank lines directly above the opening line whose
 * indentation is at least the element's. That is what keeps an
 * `# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE` paragraph attached to the element it
 * documents, and what keeps a comment that closes a container from being attached to the
 * first thing after it.
 *
 * DEPTH is the number `walkLayout` reports for the same node, which is the one thing about
 * this function that is easy to get wrong and impossible to notice: `parseGuiText` hangs a
 * `.gui` file's `containerWindowType`s off a SYNTHETIC root, so it does not count `guiTypes`
 * as a level and a top-level window is depth 1. An off-by-one here makes every element
 * unmatched and turns an edit-free apply into a full rewrite - measured: 146,310 -> 531,081
 * bytes when the windows were numbered from 1.
 *
 * @returns {{occurrences: object[], guiTypesLine: number|null, lines: string[]}}
 */
export function scanElementRanges(text) {
  const { lines } = splitLines(String(text).replace(/^\uFEFF/, ''));
  const occurrences = [];
  const stack = [];
  let guiTypesLine = null;
  let triviaStart = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (stack.length === 0 && guiTypesLine === null && /^guiTypes\s*=\s*\{/i.test(trimmed)) guiTypesLine = index;

    // A new block. A block is an ELEMENT when its key is a kind this project models, and the
    // `guiTypes` root itself is tracked as a frame WITHOUT being an element. The element depth
    // is then `walkLayout`'s depth: a top-level `containerWindowType` is 1, not 0, because
    // `parseGuiText` hangs the windows off a synthetic root rather than counting `guiTypes`.
    const startMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/.exec(trimmed);
    if (startMatch) {
      if (stack.length === 0) {
        stack.push({ structural: true, balance: 0 });
      } else if (kindSpecByKeyword(startMatch[1])) {
        stack.push({
          structural: false,
          keyword: startMatch[1],
          start: index,
          leading: triviaStart,
          indent: indentOf(line),
          // `walkLayout`'s depth, which is what `renderElement`'s indentation uses: a window
          // hanging off the synthetic root is depth 1. So the enclosing elements are counted,
          // plus the synthetic root, plus this one.
          depth: stack.filter((frame) => !frame.structural).length + 1,
          balance: 0,
        });
      } else {
        stack.push({ structural: true, balance: 0 });
      }
    }

    const before = stack.length;
    const delta = braceDelta(line);
    for (let level = before; level > 0; level -= 1) {
      const frame = stack[level - 1];
      frame.balance += delta;
      if (frame.balance <= 0) {
        if (!frame.structural) {
          occurrences.push({
            keyword: frame.keyword,
            start: frame.start,
            end: index,
            leading: frame.leading,
            indent: frame.indent,
            depth: frame.depth,
            name: declaredNameOfRange(lines, frame.start, index),
          });
        }
        stack.pop();
      }
    }

    triviaStart = trimmed === '' || trimmed.startsWith('#') ? triviaStart : index + 1;
  }

  // Document order: by opening line, and for identical lines by shallower depth first.
  occurrences.sort((a, b) => a.start - b.start || a.depth - b.depth);
  return { occurrences, guiTypesLine, lines };
}

/** One normalised line, or null for a line that carries no element content. */
function contentLine(raw) {
  const line = String(raw)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/"([^"]*)"/g, '$1');
  if (line === '' || line.startsWith('#')) return null;
  return line;
}

/**
 * The content of a block: its non-comment lines, trimmed and whitespace-collapsed.
 *
 * This is the FAST PATH of the change test; `sameSubtree` is the authority (a second call site
 * uses this on its own to decide whether a child's own block needs re-emitting, and there the two
 * agree because a changed child's own lines change).
 *
 * It ignores comments, and that is the point: a re-render of an element that did not change must
 * count as "the same", or the element is rewritten and its comments are lost. Two measured ways a
 * re-render differs from an unchanged file's text are tolerated by ignoring comments and by
 * comparing line CONTENT rather than order-independent tokens: the coordinate conversion adds an
 * explicit `orientation = upper_left` and the emitter uses its own field order. An element whose
 * FIELD VALUES changed still compares unequal, which is what the fast path is for.
 */
function sameBlockText(renderedLines, sourceLines) {
  const content = (lines) =>
    lines
      .map((line) => line.trim().replace(/\s+/g, ' ').replace(/"([^"]*)"/g, '$1'))
      .filter((line) => line !== '' && !line.startsWith('#'))
      .join('\n');
  return content(renderedLines) === content(sourceLines);
}

// ---------------------------------------------------------------------------------------
// THE CHANGE TEST: baseline tree vs edited tree, node by node.
// ---------------------------------------------------------------------------------------
//
// WHY THIS IS NOT A BYTE COMPARISON. Rendering an unchanged element does not reproduce its
// source bytes, and the difference is not a bug in either side:
//
//   * the coordinate conversion writes an explicit `orientation = upper_left` where the file
//     omitted it (the round trip of this project's own 146,310-byte file gains 524 such lines);
//   * the emitter writes fields in its own order, not the file's;
//   * a field the kind's parser rejects is TRANSLATED rather than written (`spriteType` ->
//     `quadTextureSprite` on a background, `fixedsize` -> `fixedSize`), which is the whole point
//     of `kinds.mjs`.
//
// So "did this element change?" cannot be answered by comparing rendered text with source text -
// it reports ~500 of 542 elements changed on an untouched file. The question the apply has to
// answer is the one the MODEL can answer: are the BASELINE node's own fields (and its
// descendants') still the same as the EDITED node's? A field the edit added, removed or changed
// makes them differ; nothing about rendering enters into it.

/**
 * Node keys that are model plumbing or child collections, never compared as fields.
 *
 * `id` is the one that matters and the one that is easy to miss: the model assigns a node id for
 * addressing (`gui_layout_edit`'s `target`), and `applyEdits` deep-clones the tree and assigns
 * FRESH random ids to every node. Comparing ids therefore reports every element in the file as
 * changed - measured: 536 of 542 on an untouched file, and a 9,142-line diff for a one-field
 * edit. A node id never reaches the `.gui` file, so it is not content.
 */
const NON_CONTENT_KEYS = new Set([
  'id',
  'kind',
  'type',
  'children',
  'variables',
  'subBlocks',
  'conditionals',
  'keywords',
  'keyword',
  'sourceFile',
  'sourceLine',
  'syntheticRoot',
  'coordinateFields',
  'enginePosition',
  'engineOrientation',
  'positionDeclared',
  'parsedCanonicalPosition',
  'resolutionSize',
  'background',
]);

/** A stable string for the fields a node carries ITSELF, children excluded. */
function ownSignature(node) {
  const parts = [];
  const record = (prefix, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => record(`${prefix}[${index}]`, entry));
      return;
    }
    if (typeof value === 'object') {
      for (const key of Object.keys(value).sort()) record(prefix ? `${prefix}.${key}` : key, value[key]);
      return;
    }
    parts.push(`${prefix}=${String(value)}`);
  };
  for (const key of Object.keys(node).sort()) {
    if (NON_CONTENT_KEYS.has(key)) continue;
    const value = node[key];
    if (typeof value === 'function') continue;
    // The `background` sub-block is compared by its own fields rather than skipped: a changed
    // sprite is a change.
    record(key, value);
  }
  if (node.background && typeof node.background === 'object') record('background', node.background);
  if (node.subBlocks && typeof node.subBlocks === 'object') record('subBlocks', node.subBlocks);
  return parts.join('|');
}

/** True when the edited subtree is the baseline subtree - same fields, same descendants. */
function sameSubtree(baselineNode, editedNode) {
  if (!baselineNode || !editedNode) return baselineNode === editedNode;
  if (ownSignature(baselineNode) !== ownSignature(editedNode)) return false;
  const before = baselineNode.children ?? [];
  const after = editedNode.children ?? [];
  if (before.length !== after.length) return false;
  return before.every((child, index) => sameSubtree(child, after[index]));
}

/**
 * The first path at which two subtrees differ, for diagnosis.
 *
 * `sameSubtree` answers yes/no; this answers WHERE, which is what a caller needs when a change
 * is reported for an element nobody edited. It pairs children by index, the same way
 * `sameSubtree` does, so the path it returns is the path that function rejected.
 */
export function firstSubtreeDifference(baselineNode, editedNode, path = '') {
  if (!baselineNode || !editedNode) return baselineNode === editedNode ? null : `${path || '(root)'} (one side is absent)`;
  if (ownSignature(baselineNode) !== ownSignature(editedNode)) return `${path || '(root)'} (own fields differ)`;
  const before = baselineNode.children ?? [];
  const after = editedNode.children ?? [];
  if (before.length !== after.length) return `${path || '(root)'} (${before.length} vs ${after.length} children)`;
  for (let index = 0; index < before.length; index += 1) {
    const found = firstSubtreeDifference(before[index], after[index], `${path}/${after[index].name ?? index}`);
    if (found) return found;
  }
  return null;
}

/** Which edit child corresponds to which baseline child: by name, then by position. */
function matchChildren(baselineChildren, editedChildren) {
  const used = new Set();
  const pairs = editedChildren.map((node, index) => {
    let at = -1;
    if (node.name) {
      at = baselineChildren.findIndex((candidate, candidateIndex) => !used.has(candidateIndex) && candidate.name === node.name);
    }
    if (at === -1 && !used.has(index) && baselineChildren[index]) at = index;
    if (at !== -1) used.add(at);
    return { node, baseline: at === -1 ? null : baselineChildren[at], index };
  });
  const gone = baselineChildren.filter((_candidate, index) => !used.has(index));
  return { pairs, gone };
}

/** A one-line description of an element, for the change lists. */
function describeChange(node) {
  return `${node.kind ?? 'element'} \`${node.name ?? '(unnamed)'}\``;
}

/** Leading whitespace of a line. */
function indentOf(line) {
  return line.slice(0, line.length - line.trimStart().length);
}

/** One more indentation level than `indent` uses, matching the file's own style. */
function deeper(indent) {
  return /^\t*$/.test(indent) ? `${indent}\t` : `${indent}  `;
}

/**
 * Move a rendered block's own indentation onto `indent`, keeping its INTERNAL indentation.
 *
 * The block was rendered at the depth of the element it belongs to, which is not always the
 * depth the FILE uses for it (a `.gui` file mixes indentation levels - one window's
 * `OverlappingElementsBoxType` sits one tab deeper than its siblings). Stripping each line and
 * prefixing one indent would flatten the whole block, which is how a rebuilt window once came out
 * with every nested `position` block at the same level. Only the block's own indent is changed
 * here; the lines inside it keep their relative depth.
 */
function reindentBlock(blockLines, indent) {
  const own = indentOf(blockLines[0] ?? '');
  return blockLines.map((line) => (line.startsWith(own) ? `${indent}${line.slice(own.length)}` : `${indent}${line.trimStart()}`));
}

/**
 * Locate each child element's block inside a rendered element body.
 *
 * `renderElement` writes an element's OWN field lines first and its child blocks after them, so a
 * child's block is `renderElement(child)` and the body is `[fields..., child0, child1, ...]`.
 * Measured on the real six-window file: the body of `geocentric_unga_main` is 2,593 lines, its own
 * fields are the first 16, and its 35 children account for the remaining 2,577.
 *
 * The split is therefore arithmetic - `fields.length + sum(childBlockLengths) === body.length` -
 * and that identity is the VALIDATION, not an assumption: if it does not hold, `valid` is false and
 * the caller re-emits the element whole rather than writing a mis-split block.
 *
 * The two attempts that failed, and why - both measured on the real file:
 *
 *   * FINDING each block by the first `keyword = {` line after the previous one. The line after the
 *     element's own fields is its `background = {` FIELD block, not the first child, so children
 *     were shifted by one and an element's `name`/`position` lines were emitted a second time.
 *   * CLASSIFYING each brace block as child or field block, by the keyword on its opener tested
 *     against `knownKeywords()`. A child's first INNER line is `name = "..."`, and the keyword
 *     table is lower-cased, so the test needed two unrelated properties to line up at once.
 *
 * Neither is needed once the order is used: the fields come FIRST, which the earlier attempts both
 * got wrong by starting their blocks at offset 0.
 *
 * @param {string[]} body the rendered lines between the element's opener and its closer
 * @param {object[]} children the element's child nodes, in document order
 * @param {number} childRenderDepth the depth each child renders at
 * @param {(node: object, depth: number) => string[]} renderChild
 * @returns {{fields: string[], entries: {block: {start: number, end: number}, indent: string}[], valid: boolean}}
 */
function splitRenderedBody(body, children, childRenderDepth, renderChild) {
  const blocks = children.map((child) => {
    const rendered = renderChild(child, childRenderDepth);
    return { length: rendered.length, indent: indentOf(rendered[0] ?? '') };
  });
  const childLines = blocks.reduce((total, block) => total + block.length, 0);
  const fieldCount = body.length - childLines;
  if (fieldCount < 0) return { fields: body, entries: [], valid: false };
  let cursor = fieldCount;
  const entries = blocks.map((block) => {
    const entry = { block: { start: cursor, end: cursor + block.length - 1 }, indent: block.indent };
    cursor += block.length;
    return entry;
  });
  return { fields: body.slice(0, fieldCount), entries, valid: cursor === body.length };
}

/** The render context: rects resolved once, warnings collected. */
export function buildRenderContext(layout, options = {}) {
  const warnings = [];
  const resolvedRects = new Map();
  const base = layout?.baseResolution ?? BASE_RESOLUTION;
  try {
    const { boxes } = computeLayout(layout, {
      baseWidth: base.width,
      baseHeight: base.height,
      spriteLookup: options.spriteLookup ?? null,
    });
    for (const box of boxes) resolvedRects.set(box.path, box.rect);
  } catch {
    /* a tree that cannot be laid out still renders; an unresolved size is reported */
  }
  return { warnings, resolvedRects, spriteLookup: options.spriteLookup ?? null, path: '' };
}

// `renderElement` and `prepareEngineCoordinates` live in emit.mjs, and emit.mjs imports this
// module for the `gui_emit_files { apply_to }` path - so importing them the other way round
// would be a cycle. `bindEmit` is called once, at emit.mjs's module load, and installs the
// emitter's OWN renderer. There is no second renderer anywhere in this file.
const emitBindings = { renderElement: null, prepareEngineCoordinates: null };

/** Called once by emit.mjs with the emitter's own renderer. */
export function bindEmit(bindings) {
  emitBindings.renderElement = bindings.renderElement;
  emitBindings.prepareEngineCoordinates = bindings.prepareEngineCoordinates;
}

function renderBlock(node, depth, context, parentPath) {
  if (typeof emitBindings.renderElement !== 'function') {
    throw new Error('apply.mjs was used before emit.mjs bound its renderer; import emit.mjs first');
  }
  return emitBindings.renderElement(node, depth, context, parentPath);
}

/**
 * Apply an EDITED layout to the ORIGINAL text of the `.gui` file it came from.
 *
 * @param {string} originalText the file's exact text (BOM excluded; a BOM is refused upstream)
 * @param {object|null} baselineLayout the tree as IMPORTED (the comparison base)
 * @param {object} editedLayout the tree as edited
 * @param {{fileKey?: string, spriteLookup?: Function|null}} options
 */
export function applyLayoutToSource(originalText, baselineLayout, editedLayout, options = {}) {
  const source = String(originalText).replace(/^\uFEFF/, '');
  const { lines, eol } = splitLines(source);
  const scan = scanElementRanges(source);
  const occurrences = scan.occurrences;
  const warnings = [];
  const context = buildRenderContext(editedLayout, options);

  // ---- the render pass runs on a CLONE, never on the tree being compared ----------------
  //
  // `prepareEngineCoordinates` MUTATES the tree it is given: it sets `coordinateFields`, moves
  // `position` to the canonical frame and records `enginePosition`. Running it on the edited
  // tree before comparing would therefore change the very nodes the comparison reads, and it
  // does so asymmetrically - the baseline was never through it. Measured on the real file: one
  // edited element produced 13 "changes" because this pass gave every `portrait_mask` a
  // `position.x = 0` the baseline node did not have.
  //
  // So the comparison always reads the caller's trees, and the renderer reads a clone. The two
  // are tied together by identity, not by name or index, so a moved or duplicated name cannot
  // pair them wrongly.
  const clone = JSON.parse(JSON.stringify(editedLayout));
  emitBindings.prepareEngineCoordinates(clone, {
    baseWidth: clone?.baseResolution?.width ?? BASE_RESOLUTION.width,
    baseHeight: clone?.baseResolution?.height ?? BASE_RESOLUTION.height,
    spriteLookup: options.spriteLookup ?? null,
    rectsOut: new Map(),
  });
  const cloneByNode = new Map();
  {
    const pair = (original, copy) => {
      if (!original || !copy) return;
      cloneByNode.set(original, copy);
      const originalChildren = original.children ?? [];
      const copyChildren = copy.children ?? [];
      for (let index = 0; index < originalChildren.length; index += 1) pair(originalChildren[index], copyChildren[index]);
    };
    pair(editedLayout.root, clone.root);
  }
  /** The cloned twin of a node of the edited tree, which is what the renderer must be given. */
  const renderTarget = (node) => cloneByNode.get(node) ?? node;

  // ---- occurrence matching, PARENT BY PARENT --------------------------------------------
  //
  // ---- the splice -----------------------------------------------------------------------
  // is a measured property of the model: `walkLayout` yields 1812 nodes for this 542-element
  // file, because a parsed `.gui` block keeps its `background`, `position` and `size` as
  // sub-nodes. A single document-order cursor over all of them therefore cannot line up with
  // the source, and an off-by-one there turns an edit-free apply into a full rewrite.
  //
  // Matching inside a PARENT's own line range removes the whole class: the children of a
  // container are looked for only between that container's braces, in order, by keyword and
  // name. Nothing outside the parent can be consumed by mistake, and an element that moved
  // is still found where the FILE has it.
  const occurrencesIn = (parentRange, childDepth) => {
    const from = parentRange ? parentRange.start + 1 : 0;
    const to = parentRange ? parentRange.end : lines.length - 1;
    return occurrences.filter(
      (occurrence) =>
        occurrence.start >= from && occurrence.end <= to && (childDepth === null || occurrence.depth === childDepth),
    );
  };
  /**
   * Which occurrence, if any, belongs to each edited child.
   *
   * `parentHasBlock` is the rule that keeps a NEW element from absorbing the file's existing
   * blocks. The match is by keyword + name against the occurrences inside `parentRange`, and an
   * element with no block of its own has no interior to search - so the search falls back to the
   * WHOLE FILE, where a child that merely shares a NAME with an unrelated element (the fixture's
   * `NEW_text` against window A's `A_text` is the measured case, and the real file has one
   * `value_num`, one `portrait`, one `close` per window) is adopted as "already in the file". Its
   * block is then copied nowhere, because it lies outside this element's range, and the new window
   * is emitted EMPTY. So: a parent that is itself new adopts no blocks, and every descendant is
   * rendered from the model.
   */
  const matchChildrenToRanges = (parentRange, parentScanDepth, children, baselineChildren, parentHasBlock = true) => {
    // `parentScanDepth` is the SCAN depth of the element whose children these are, and the scanner
    // numbers a top-level window 1 - so its children are the occurrences at depth 2. The root is
    // handed 0 because the synthetic root is not in the file at all.
    const childDepth = parentScanDepth + 1;
    const candidates = parentHasBlock ? occurrencesIn(parentRange, childDepth) : [];
    const used = new Set();
    return children.map((node, index) => {
      const spec = kindSpec(node.kind ?? node.type);
      const keywords = new Set([node.keyword, ...(spec?.keywords ?? [])].filter(Boolean));
      const baselineNode = baselineChildren[index] ?? null;
      const sameName = (candidate) => node.name === null || candidate.name === null || candidate.name === node.name;
      const sameKeyword = (candidate) => keywords.has(candidate.keyword);
      // WHICH MATCH WINS. Name and keyword are not enough: this file has two sibling `portrait`
      // elements inside `portrait_background`, and pairing the wrong one makes `sameSubtree`
      // report a change that is really a mis-pairing - measured: one edited element produced 13
      // "changes" and a 140,405-byte rewrite instead of 146,310 + one block. So a candidate that
      // is the SAME SUBTREE as the baseline child wins over one that merely shares the name.
      const compatible = candidates.findIndex(
        (candidate, at) => !used.has(at) && sameKeyword(candidate) && sameName(candidate) && baselineNode && sameSubtree(baselineNode, node),
      );
      const byName = candidates.findIndex((candidate, at) => !used.has(at) && sameKeyword(candidate) && sameName(candidate));
      const byPosition = candidates.findIndex((candidate, at) => !used.has(at) && sameKeyword(candidate) && at === index);
      const renamed = baselineNode && rangesByNode.get(baselineNode)
        ? candidates.findIndex((candidate, at) => !used.has(at) && candidate.start === rangesByNode.get(baselineNode).start)
        : -1;
      const at = compatible !== -1 ? compatible : byName !== -1 ? byName : byPosition !== -1 ? byPosition : renamed;
      if (at === -1) return { node, baseline: baselineNode, range: null };
      used.add(at);
      return { node, baseline: baselineNode, range: candidates[at] };
    });
  };
  const rangesByNode = new Map();

  // ---- the splice -----------------------------------------------------------------------
  const added = [];
  const removed = [];
  const changed = [];
  // Every output line is either an ORIGINAL line (copied by index, comments included) or a
  // RENDERED one. The tagging is what makes "an edit-free apply rewrites 0 lines" a measured
  // property of the output rather than a claim about the code path.
  const copy = (line) => ({ rendered: false, line });
  const render = (line) => ({ rendered: true, line });

  /**
   * The block of one element: the ORIGINAL lines when the edit did not touch it, and otherwise a
   * re-emission whose untouched descendants are again taken from the original text.
   *
   * THE CHANGE TEST is `sameSubtree(baseline, node)` - the model against the model. A rendered-text
   * comparison cannot be the authority; see the note above `sameSubtree`.
   */
  const spliceElement = (node, baselineNode, indent, range, scanDepth, parentPath = '') => {
    const fullPath = parentPath ? `${parentPath}/${node.name ?? '(unnamed)'}` : node.name ?? '(root)';
    const baselineRange = baselineNode ? rangesByNode.get(baselineNode) ?? null : null;
    const outerIndent = range?.indent ?? baselineRange?.indent ?? indent;
    // The SCAN depth of this element (`walkLayout`'s depth and the scanner's agree): from its own
    // source block when it has one, from its parent's depth when the edit created it.
    const depth = range?.depth ?? baselineRange?.depth ?? scanDepth;
    const rendered = renderBlock(renderTarget(node), depth, context, '');
    const sourceLines = range ? lines.slice(range.start, range.end + 1) : null;
    if (range && baselineNode && sameSubtree(baselineNode, node)) {
      return { lines: sourceLines.map(copy), rewritten: false };
    }
    if (range && sameBlockText(rendered, sourceLines)) {
      return { lines: sourceLines.map(copy), rewritten: false };
    }
    const children = node.children ?? [];
    // This element's children are the occurrences at `depth + 1` (the scanner numbers a top-level
    // window 1, and `walkLayout` agrees), so the helper is handed THIS element's depth.
    const childrenRanges = matchChildrenToRanges(range, depth, children, baselineNode?.children ?? [], Boolean(range));
    for (const child of childrenRanges) if (child.range) rangesByNode.set(child.node, child.range);
    const gone = (baselineNode?.children ?? []).filter(
      (candidate) => !childrenRanges.some((child) => child.baseline === candidate) && rangesByNode.get(candidate),
    );
    // THE SPLIT between this element's own field lines and its child blocks, arithmetically: the
    // emitter writes the fields first and the children after, so the children's blocks are the
    // LAST `sum(renderElement(child))` lines of the body. See `splitRenderedBody` for the two
    // search-based attempts that were wrong, each in its own way.
    const split = splitRenderedBody(rendered.slice(1, -1), children, depth + 1, (child, childDepth) =>
      renderBlock(renderTarget(child), childDepth, context, ''),
    );
    if (!split.valid) {
      // The renderer's own output does not add up, so the split cannot be trusted. Rather than
      // write a half-split block, the element is replaced by a fresh render and the caller is told.
      warnings.push({
        rule: 'apply-body-split-mismatch',
        severity: 'warning',
        message:
          `the rendered body of \`${node.name ?? fullPath}\` could not be split into its own lines plus ${children.length} child ` +
          'block(s), so the element was re-emitted whole instead of spliced. Its meaning is unchanged; its comments may move.',
      });
      return { lines: rendered.map(render), rewritten: true };
    }
    /**
     * Write one child: the original lines when it is untouched, a fresh render when it is not.
     * @returns {boolean} whether the child's own block was re-emitted
     */
    const writeChild = (index, sink) => {
      const child = childrenRanges[index];
      const block = split.entries[index];
      const changedHere = child.range ? !(child.baseline && sameSubtree(child.baseline, child.node)) : true;
      if (!changedHere && child.range) {
        const spliced = spliceElement(child.node, child.baseline, block.indent, child.range, depth + 1, fullPath);
        sink.push(...spliced.lines);
        return false;
      }
      const renderedChild = renderBlock(renderTarget(child.node), depth + 1, context, '');
      for (const line of reindentBlock(renderedChild, block.indent)) sink.push(render(line));
      return true;
    };

    // THE ORIGINAL LINES INSIDE THIS ELEMENT, in the FILE's order.
    //
    // This is the whole subtlety of the splice, and the reason is that the FILE's order and the
    // MODEL's order differ in exactly one case: an edit can move a child. So:
    //
    //   * an element's own field lines are rendered (the emitter owns their order),
    //   * the ORIGINAL lines are walked in order - every one of them that no child's block claims
    //     is copied verbatim, comments and all, and a child's block is either copied verbatim (it
    //     is untouched) or replaced IN PLACE by its fresh render (it changed or moved),
    //   * a child with no source block - a new or renamed element - is rendered at the position
    //     the model put it in, after the last original line that precedes it.
    //
    // REPLACING IN PLACE is what an earlier revision got wrong in both directions: it wrote the
    // model's order directly, so everything after a changed child's original block was dropped -
    // the `# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE` block vanished - and it re-copied the
    // element's own field lines, so a window came out with `name =` twice.
    const out = [render(`${outerIndent}${rendered[0].trim()}`)];
    // THE ELEMENT'S OWN FIELD LINES, for an element that has no block in the file. When the element
    // DOES have one, the interior walk below copies its fields byte for byte - that is what keeps an
    // untouched `position` block's comment and its exact spelling - so writing them here as well would
    // emit every field twice. When it does not, there is nothing to copy, and these lines are the
    // ONLY source of `name`, `position`, `size` and the kind-specific fields: without them a new
    // window is emitted as a bare `containerWindowType = { ... }` with no `name` at all. Measured:
    // the added window of the GAP-4 fixture lost `name = "gap4_gamma"` entirely and the new element
    // was unaddressable, while its children rendered correctly.
    if (!range) for (const line of split.fields) out.push(render(line));
    const childIndent = split.entries.length > 0 ? split.entries[0].indent : deeper(outerIndent);
    {
      // The children that have an original block, by the line their block starts on.
      const claimed = new Map(childrenRanges.filter((child) => child.range).map((child) => [child.range.start, child]));
      // The children that do NOT, in the model's order: a new or renamed element.
      const fresh = childrenRanges.map((child, index) => ({ child, index })).filter((entry) => !entry.child.range);
      let freshCursor = 0;
      const inside = range
        ? {
            // The walk covers the element's whole interior, its own field lines included. Those
            // lines ARE the body's first lines - the emitter writes the fields first - so the walk
            // reproduces them byte for byte, and the only lines it must NOT emit as-is are the
            // children's own blocks, which the `claimed` map intercepts by their start line. This
            // is why nothing has to be marked as "a field line": copying the file's own interior
            // and replacing only the child blocks is correct by construction.
            from: range.start + 1,
            to: range.end - 1,
          }
        // NO SOURCE BLOCK, SO NO INTERIOR (GAP-4). An element the edit CREATED has no lines in the
        // file, so there is nothing to copy: its whole interior is the fresh render of its children
        // below. This branch used to be `{ from: 0, to: lines.length - 1 }`, i.e. "walk the entire
        // file" - so an added window's block absorbed EVERY original line, nested inside itself.
        // Measured on the real 146,310-byte file: one two-element window took it to 300,332 bytes
        // with two copies of every window, and on a two-window 637-byte fixture to 1,375 bytes with
        // each window emitted a second time inside the new one's body. It was invisible to
        // `checkGuiSyntax` (the result is still balanced) and to a "count the windows" check (the
        // extra copies are indented, so they are not top-level). The empty range is the fix: the
        // generic `while` below does not run, and the trailing loop emits every child as fresh.
        : { from: 0, to: -1 };
      let at = inside.from;
      while (at <= inside.to) {
        const claimedHere = claimed.get(at);
        if (claimedHere) {
          const index = childrenRanges.indexOf(claimedHere);
          if (writeChild(index, out)) {
            changed.push({
              name: claimedHere.node.name ?? null,
              kind: claimedHere.node.kind ?? null,
              path: `${fullPath}/${claimedHere.node.name ?? '(unnamed)'}`,
              startLine: claimedHere.range.start + 1,
              endLine: claimedHere.range.end + 1,
              container: false,
              summary: `rewrote ${describeChange(claimedHere.node)} (lines ${claimedHere.range.start + 1}-${claimedHere.range.end + 1})`,
            });
          }
          at = claimedHere.range.end + 1;
          continue;
        }
        // The next line the file claims for a child. A NEW child whose position in the model puts it
        // before that child has to be emitted first, which keeps the model's order among the
        // elements the file does not have.
        const nextClaimedChild = childrenRanges.find((child) => child.range && child.range.start > at) ?? null;
        const nextClaimedIndex = nextClaimedChild ? childrenRanges.indexOf(nextClaimedChild) : childrenRanges.length;
        while (freshCursor < fresh.length && fresh[freshCursor].index < nextClaimedIndex) {
          const entry = fresh[freshCursor];
          freshCursor += 1;
          writeChild(entry.index, out);
          added.push({
            name: entry.child.node.name ?? null,
            kind: entry.child.node.kind ?? null,
            parent: node.name ?? null,
            indent: childIndent,
            summary: `added ${describeChange(entry.child.node)} under \`${node.name ?? '(root)'}\``,
          });
        }
        out.push(copy(lines[at]));
        at += 1;
      }
      for (; freshCursor < fresh.length; freshCursor += 1) {
        const entry = fresh[freshCursor];
        writeChild(entry.index, out);
        added.push({
          name: entry.child.node.name ?? null,
          kind: entry.child.node.kind ?? null,
          parent: node.name ?? null,
          indent: childIndent,
          summary: `added ${describeChange(entry.child.node)} under \`${node.name ?? '(root)'}\``,
        });
      }
    }
    for (const orphan of gone) {
      const orphanRange = rangesByNode.get(orphan);
      if (!orphanRange) continue;
      removed.push({
        name: orphan.name ?? null,
        kind: orphan.kind ?? null,
        startLine: orphanRange.leading + 1,
        endLine: orphanRange.end + 1,
        summary: `removed ${describeChange(orphan)} (lines ${orphanRange.leading + 1}-${orphanRange.end + 1})`,
      });
    }
    out.push(render(`${outerIndent}}`));
    return { lines: out, rewritten: true };
  };

  // ---- the top level: the synthetic root's children, i.e. the file's windows --------------
  //
  // The same rule as any container, over the whole file: a window whose subtree still matches is
  // copied byte for byte - its header and comment block included - and a window that contains a
  // change is re-emitted around the elements that did not change.
  const synthetic = editedLayout?.root?.syntheticRoot === true;
  const rootChildren = synthetic ? editedLayout.root.children ?? [] : [editedLayout.root];
  const baselineRootChildren = !baselineLayout
    ? []
    : baselineLayout.root?.syntheticRoot
      ? baselineLayout.root.children ?? []
      : [baselineLayout.root];
  // The synthetic root's range is the whole `guiTypes` block, so the windows are matched against
  // the top-level elements and nothing inside a window. The scanner numbers a window 1 (the same
  // number `walkLayout` gives it), so its children are depth 1.
  const rootRange = { start: (scan.guiTypesLine ?? 0) - 1, end: lines.length - 1 };
  const pairs = matchChildrenToRanges(rootRange, 0, rootChildren, baselineRootChildren).map((pair) => {
    if (pair.range) rangesByNode.set(pair.node, pair.range);
    return pair;
  });
  const goneAtRoot = baselineRootChildren.filter(
    (candidate) => !pairs.some((pair) => pair.baseline === candidate) && rangesByNode.get(candidate),
  );
  const rootIndent = synthetic ? '\t' : '';
  const top = [];
  let topTail = 0;
  for (const pair of pairs) {
    const range = pair.range;
    if (range && range.leading > topTail) for (let at = topTail; at < range.leading; at += 1) top.push(copy(lines[at]));
    const spliced = spliceElement(pair.node, pair.baseline, rootIndent, range, synthetic ? 1 : 0, '');
    if (!range) {
      // A NEW window. `splices` lines are already indented for the root - the opener at
      // `rootIndent` and the closer at `outerIndent`, which for a synthetic root is the window's
      // own `\t` - so they are pushed as they are. Prefixing them with `rootIndent` a second time
      // (as this branch used to) puts the opener at two tabs and, with the old whole-file interior
      // walk, is what made every existing window appear a second time INSIDE the new one.
      for (const line of spliced.lines) top.push(line);
      added.push({
        name: pair.node.name ?? null,
        kind: pair.node.kind ?? null,
        summary: `added ${describeChange(pair.node)} at the end of guiTypes`,
      });
      continue;
    }
    if (!spliced.rewritten) {
      // Not one byte of this window changed: the original lines go out untouched.
      for (let at = range.leading; at <= range.end; at += 1) top.push(copy(lines[at]));
    } else {
      for (let at = range.leading; at < range.start; at += 1) top.push(copy(lines[at]));
      for (const line of spliced.lines) top.push(line);
      changed.push({
        name: pair.node.name ?? null,
        kind: pair.node.kind ?? null,
        path: `${pair.node.name ?? '(unnamed)'}`,
        startLine: range.start + 1,
        endLine: range.end + 1,
        // A window is reported whenever anything inside it was rewritten, because its own block is
        // rebuilt; `container: true` says "rebuilt around a change below it", which keeps "how many
        // elements did the edit actually touch" answerable.
        container: true,
        summary: `rebuilt ${describeChange(pair.node)} around a changed element (lines ${range.start + 1}-${range.end + 1})`,
      });
    }
    topTail = range.end + 1;
  }
  for (const orphan of goneAtRoot) {
    const range = rangesByNode.get(orphan);
    if (!range) continue;
    removed.push({
      name: orphan.name ?? null,
      kind: orphan.kind ?? null,
      startLine: range.leading + 1,
      endLine: range.end + 1,
      summary: `removed ${describeChange(orphan)} (lines ${range.leading + 1}-${range.end + 1})`,
    });
  }
  if (topTail < lines.length) for (let index = topTail; index < lines.length; index += 1) top.push(copy(lines[index]));

  const after = top.map((line) => line.line);
  const renderedOutput = top.filter((line) => line.rendered);
  const diff = countDiffLines(lines, after);
  return {
    ok: true,
    text: after.join(eol),
    eol,
    occurrences: occurrences.length,
    added,
    removed,
    changed,
    rewrittenLines: renderedOutput.length,
    rewrittenBytes: renderedOutput.reduce((total, line) => total + Buffer.byteLength(line.line, 'utf8') + eol.length, 0),
    warnings: [...warnings, ...context.warnings],
    diff,
  };
}

/**
 * Line-level diff size between the original and the patched text.
 *
 * An LCS over LINES is enough - the question is "how many lines did the patch change" - and
 * the common prefix/suffix are trimmed first so a one-element edit does not pay for the
 * whole file.
 */
export function countDiffLines(before, after) {
  const n = before.length;
  const m = after.length;
  if (n === 0 || m === 0) return { added: m, removed: n, common: 0, changed: Math.max(n, m) };
  let prefix = 0;
  while (prefix < n && prefix < m && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && before[n - 1 - suffix] === after[m - 1 - suffix]) suffix += 1;
  const a = before.slice(prefix, n - suffix);
  const b = after.slice(prefix, m - suffix);
  let previous = new Uint32Array(b.length + 1);
  let current = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    const swap = previous;
    previous = current;
    current = swap;
    current.fill(0);
  }
  const common = previous[b.length];
  const added = m - prefix - suffix - common;
  const removed = n - prefix - suffix - common;
  return { added, removed, common: common + prefix + suffix, changed: added + removed };
}

/** sha256 / size / comment-line metadata for a path, so a plan can prove what it built on. */
export function describeFile(path) {
  const buffer = readFileSync(path);
  const text = buffer.toString('utf8');
  return {
    path,
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    hasBom: buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf,
    crlf: text.includes('\r\n'),
    commentLines: text.split(/\r?\n/).filter((line) => line.trimStart().startsWith('#')).length,
  };
}

/**
 * The guard for the one write path that targets an existing file the caller names.
 *
 * It is NOT `assertOutputRoot`: that rule exists to stop an emit from landing in a mod or in
 * the install by accident, and this operation is the opposite - it must write into the file
 * the caller explicitly named, or it has no purpose at all. What it keeps from that rule is
 * the part that is about the GAME rather than about the caller's intent:
 *
 *   * refuse a path inside a Stellaris install;
 *   * refuse a path inside the user-data folder;
 *   * require the path to exist and to be a `.gui`.
 *
 * And it adds the one thing an output root does not need: the caller must NAME the file, so
 * an apply can never happen by omission.
 */
export function assertApplyTarget(target) {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error('apply_to requires the absolute path of the .gui file to patch; an apply is never implicit');
  }
  if (!isAbsolute(target)) throw new Error(`apply_to must be an absolute path, got \`${target}\``);
  const resolved = resolve(target);
  const lowered = resolved.toLowerCase().replace(/\\/g, '/');
  if (!lowered.endsWith('.gui')) {
    throw new Error(`apply_to must name a .gui file (this operation patches one file's own text), got \`${resolved}\``);
  }
  // Spelling first (cheap, catches Steam layouts and the developer's stale tree), then
  // CONTENT. The spellings alone do not cover an install at a plain path such as
  // E:\Stellaris, which is where the verified 4.4.6 build on this machine lives -- so
  // without the content check this guard did not fire and apply_to would patch a
  // vanilla game file.
  if (lowered.includes('/steamapps/common/stellaris') || lowered.includes('/st-new/')) {
    throw new Error(`refusing to patch a file inside a Stellaris install: ${resolved}`);
  }
  const install = insideGameInstall(resolved);
  if (install) {
    throw new Error(
      `refusing to patch a file inside a Stellaris install: ${resolved} is inside ${install}, which holds the `
      + 'game (stellaris.exe / launcher-settings.json). Overriding a vanilla file is gui_emit_override\'s job, '
      + 'which confirms the move explicitly.',
    );
  }
  if (/\/documents\/paradox interactive\/stellaris\//.test(lowered)) {
    throw new Error(`refusing to patch a file inside the Stellaris user-data folder: ${resolved}`);
  }
  if (!existsSync(resolved)) throw new Error(`apply_to names a file that does not exist: ${resolved}`);
  return resolved;
}

/**
 * Plan, and unless `dryRun` is false perform, an apply of `editedLayout` into `target`.
 *
 * The file-system effects are kept out of `applyLayoutToSource` so the whole operation can be
 * inspected without a write: a dry run returns the same counts plus the patched text.
 */
export function applyToFile(target, baselineLayout, editedLayout, options = {}) {
  const path = assertApplyTarget(target);
  const original = readFileSync(path);
  if (original.length >= 3 && original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf) {
    throw new Error(
      `${path} starts with a UTF-8 BOM. A .gui script file must not have one - the engine reads the BOM as part of the ` +
        'first token - so this file is not in a state this tool will patch. Fix the encoding first.',
    );
  }
  const result = applyLayoutToSource(original.toString('utf8'), baselineLayout, editedLayout, { ...options, fileKey: path });
  const syntax = checkGuiSyntax(result.text, `${path} (patched)`);
  const syntaxErrors = syntax.findings.filter((finding) => finding.severity === 'error');
  const before = describeFile(path);
  const afterBytes = Buffer.from(result.text, 'utf8');
  const report = {
    targetPath: path,
    before: { bytes: before.bytes, sha256: before.sha256, commentLines: before.commentLines, crlf: before.crlf },
    after: {
      bytes: afterBytes.length,
      sha256: createHash('sha256').update(afterBytes).digest('hex'),
      commentLines: result.text.split(result.eol).filter((line) => line.trimStart().startsWith('#')).length,
      crlf: result.text.includes('\r\n'),
    },
    identical: afterBytes.equals(original),
    occurrences: result.occurrences,
    added: result.added,
    removed: result.removed,
    changed: result.changed,
    rewrittenLines: result.rewrittenLines,
    rewrittenBytes: result.rewrittenBytes,
    diff: result.diff,
    syntaxCheck: { ok: syntax.ok, counts: syntax.counts },
    warnings: result.warnings,
  };
  if (syntaxErrors.length > 0) {
    throw new Error(
      `refusing to patch ${path}: the patched text does not pass the engine syntax check (${syntaxErrors
        .map((finding) => `${finding.rule} at line ${finding.line}`)
        .join(', ')}). Nothing was written; the file on disk is untouched.`,
    );
  }
  if (options.dryRun === false) {
    writeFileSync(path, afterBytes);
    report.written = true;
    report.dryRun = false;
  } else {
    report.written = false;
    report.dryRun = true;
    report.patched = result.text;
  }
  return report;
}

export default {
  applyLayoutToSource,
  applyToFile,
  assertApplyTarget,
  buildRenderContext,
  countDiffLines,
  describeFile,
  scanElementRanges,
  bindEmit,
};
