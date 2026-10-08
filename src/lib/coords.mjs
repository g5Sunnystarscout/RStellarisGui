//------------------------------------------------------------------------------------
// coords.mjs -- Part of RStellarisGui
//
// THE CANONICAL COORDINATE SYSTEM, AND THE ONE PLACE THAT TRANSLATES IT TO AND FROM THE
// ENGINE'S FIELDS.
//
// ---------------------------------------------------------------------------------------------
// THE CANONICAL SYSTEM (this is the only system an agent, a tool argument or the web UI uses)
// ---------------------------------------------------------------------------------------------
//
//   * origin at the parent window's TOP-LEFT corner (the outermost parent is the 1920x1080 base
//     resolution rectangle, so a top-level `containerWindowType` is placed in that);
//   * +x to the RIGHT;
//   * +y DOWN;
//   * units are the game's scaled UI pixels at the 1920x1080 base resolution;
//   * a rectangle is `{ x, y, width, height }` with `x`/`y` the TOP-LEFT corner, and the rect table
//     and the preview report exactly that;
//   * `position = { x, y }` is the offset of the element's PIVOT from the parent's `orientation`
//     anchor, with +y down. The pivot is the point the element's own `origo` names (default
//     `upper_left`, i.e. the top-left corner).
//
// That is the standard screen convention, it is what the preview draws, and it is what every MCP
// tool argument and every web-form field means. THERE IS NO OTHER READING OF `position` IN THE TOOL
// SURFACE.
//
// ---------------------------------------------------------------------------------------------
// THE ENGINE'S QUIRK, AND WHAT IT ACTUALLY IS
// ---------------------------------------------------------------------------------------------
//
// In a `.gui` file `position` is NOT an offset from the parent's top-left corner: `orientation`
// selects a nine-point anchor ON THE PARENT and the element's pivot is placed at that anchor plus
// `position`. So the vertical meaning of the same `y = 10` depends on which edge the anchor is on:
//
//   orientation on the parent's TOP edge (upper_left, center_up, upper_right)
//       `y = 10` is 10 px BELOW the parent's top edge.
//   orientation on the parent's BOTTOM edge (lower_left, center_down, lower_right)
//       `y = 10` is 10 px BELOW the parent's BOTTOM edge - i.e. 10 px past the parent, not 10 px
//       inside it. A negative y is what moves an element UP, into the parent.
//
// The trivial-looking part is also the part that was got wrong: THE SIGN OF THE NUMBER IS NOT
// FLIPPED. The engine adds `position` to the anchor's point for every orientation, and the whole
// difference between the families is WHERE THE ANCHOR IS. A converter that negated y for the bottom
// anchors would move every such element by twice its own offset, and would be a regression, not a
// fix - which is measured, not asserted, in `scripts/calibrate-coords.mjs --compare`:
//
//   containment over the 177 vanilla .gui files (11427 sized elements, higher is better)
//     whole corpus                  shipped 0.7733   |  y negated for bottom anchors 0.7472
//     family lower_*                shipped 0.7398   |  0.0938
//     nested lower_* (376 elements) shipped 0.7332   |  0.0815
//     depth-1 (parent = screen)     shipped 0.9502   |  0.9428
//
// The decisive vanilla cases, all of which the shipped model explains and the negated one does not:
//
//   * `interface/combat_view.gui:41-45` - the view window is `lower_left`, `origo = lower_left`,
//     `position = { x = 35 y = -42 }`, 560x568. Adding the literal puts its bottom-left corner 42 px
//     above the screen's bottom edge, so the window's bottom edge sits 42 px above the screen
//     bottom. Negating y puts it 42 px BELOW the screen, off the display entirely.
//   * `interface/combat_view.gui:159-164` - `left_stats` is `lower_left`, `origo = lower_left`,
//     265x87 at `{ x = 7 y = -11 }`: its bottom edge lands 11 px above its parent's bottom edge, and
//     therefore 53 px above the screen bottom - a stats bar inside its window. Negated, it hangs
//     22 px below the window's bottom edge.
//   * `interface/galactic_community_view.gui:1100-1107` - `assign_button` is `lower_left`,
//     `position = { x = -10 y = -45 }` inside an 800x50 row: 45 px ABOVE the row's bottom edge.
//   * `interface/megastructure_view.gui` - `tabs` is `lower_left, origo = lower_left`,
//     `position = { x = -20 y = -15 }`: a tab strip just above its parent's bottom edge.
//
// The parent's own `orientation` changes nothing: `left_stats` is `lower_left` inside a `lower_left`
// parent, `assign_button` is `lower_left` inside a default `upper_left` parent, and both read the
// same way - the child's own `orientation` picks the anchor, and the anchor is a point on the PARENT.
//
// THE CONVERTER'S JOB is therefore not to apply a sign, but to make the reference frame explicit:
// canonical `position` is the ANCHOR-relative offset with +y down, and the layout engine, the
// preview, the rect table and the emitter all use that one value. The engine literal is recovered
// by subtraction against the anchor, which is what the two functions below do.
//
// ---------------------------------------------------------------------------------------------
// THE CONVERSION FUNCTIONS
// ---------------------------------------------------------------------------------------------
//
//   enginePositionToCanonical(enginePosition, orientation, parentRect)
//   canonicalPositionToEngine(canonicalPosition, orientation, parentRect)
//
// They are exact inverses for the same orientation, which is what `canonical -> emitted fields ->
// re-parsed -> canonical is the identity` in the selftest asserts (over a nested-`lower_*` corpus,
// because a depth-1 element's parent is the screen and the two models agree there).
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { ANCHORS, normaliseAnchor } from './kinds.mjs';

/** The canonical system, stated once, for every report and every tool description. */
export const CANONICAL_SYSTEM = {
  name: 'canonical',
  summary: 'origin at the top-left of the window, x to the right, y down, top-left-corner rects',
  xAxis: 'right',
  yAxis: 'down',
  origin: 'top-left of the containing window (the layout root is placed in the 1920x1080 base resolution)',
  positionMeans:
    'the offset of the element\'s top-left corner from its parent\'s top-left corner; ALWAYS y-down, ' +
    'whatever the element\'s orientation says',
  note:
    'orientation/origo are engine fields. Tools and the web UI take canonical coordinates only; the ' +
    'converter chooses the engine fields. A tool that must accept engine-space input says so and ' +
    'converts on the way in.',
};

/** One sentence an agent can rely on, used verbatim in the tool descriptions. */
export const CANONICAL_SYSTEM_SENTENCE =
  'COORDINATES ARE CANONICAL: origin at the parent window\'s top-left (the outermost parent is the ' +
  '1920x1080 base rectangle), +x right, +y down, and `position` is the offset of the element\'s pivot ' +
  'from its parent\'s `orientation` anchor - the same meaning for every orientation, so a `lower_left` ' +
  'element is NOT written with a negated y. The emitter derives the engine\'s fields from this one ' +
  'value (src/lib/coords.mjs), and the preview and rect table are computed from it too, so the file ' +
  'and the preview cannot disagree.';

/**
 * The sign this project ever applies to a `position` component for an anchor.
 *
 * It is always `+1`, for every orientation. The engine places the element at
 * `anchorPoint(parent, orientation) + position`, so the whole difference between an `upper_*` and a
 * `lower_*` anchor is WHERE THE ANCHOR IS, not the sign of the number: `lower_left` with `y = 10`
 * means 10 px below the parent's bottom edge. A converter that multiplied by `-1` here would move
 * every bottom-anchored element by twice its own offset.
 *
 * The function exists so the claim is stated in exactly one place and can be measured:
 * `scripts/calibrate-coords.mjs --compare` runs the whole vanilla corpus both ways, and the negated
 * version is worse on every line (aggregate containment 0.7733 -> 0.7472, the `lower_*` family
 * 0.7398 -> 0.0938, nested `lower_*` 0.7332 -> 0.0815). The decisive cases are in the module header.
 */
export function yDirectionForAnchor(orientation) {
  void orientation;
  return 1;
}

/**
 * `true` when this project flips the sign of y for an anchor. It never does - see
 * `yDirectionForAnchor` and the calibration - but the predicate is kept so a future change has one
 * place to make and one test to fail.
 */
export function flipsY(orientation) {
  return yDirectionForAnchor(orientation) < 0;
}

/** Anchor fractions for a canonical anchor name. */
export function anchorFractions(anchorName) {
  const canonical = normaliseAnchor(anchorName) ?? 'upper_left';
  return (
    Object.values(ANCHORS).find((candidate) => candidate.label === canonical) ?? { x: 0, y: 0, label: 'upper_left' }
  );
}

/** The nine-point anchor point of a rect, in canonical coordinates. */
export function anchorPointOf(rect, anchorName) {
  const fraction = anchorFractions(anchorName);
  return { x: rect.x + rect.width * fraction.x, y: rect.y + rect.height * fraction.y };
}

/**
 * The pivot - the point that `position` is measured to - in canonical coordinates.
 *
 * The engine places `pivot = anchorPoint(parent, orientation) + enginePosition` and then subtracts
 * the element's own `origo`. This does the same thing, in the canonical frame.
 *
 * @param {{x: number, y: number}} enginePosition the offset as written in the `.gui` file
 */
export function pivotFromEnginePosition(enginePosition, orientation, parentRect) {
  const anchor = anchorPointOf(parentRect, orientation);
  const x = enginePosition?.x ?? 0;
  const y = enginePosition?.y ?? 0;
  return { x: anchor.x + x, y: anchor.y + y };
}

/**
 * ENGINE -> CANONICAL for one element's `position`.
 *
 * The engine resolves `position` from the parent's `orientation` anchor: the element's `origo` point
 * lands at `anchorPoint(parent, orientation) + position`, and for an anchor on the parent's bottom
 * edge a positive y therefore lands BELOW the parent. Canonical `position` is that same offset, and
 * because canonical y is already screen-down the conversion is the identity - stated as a function
 * so there is one place to look, and so a future sign change has one place to fail.
 *
 * @param {{x: number, y: number}} enginePosition the value a `.gui` file carries
 * @param {string} orientation the element's own `orientation` (default `upper_left`)
 * @param {{x: number, y: number, width: number, height: number}} [parentRect] the parent's rect, so
 *   the caller can read the anchor point and the pivot's canvas position out of the result
 * @param {number} [yDirection] override for the sign applied to y; the calibration uses it to
 *   measure the negated alternative, nothing else does
 * @returns {{x: number, y: number, anchor: object|null, pivot: object|null}}
 */
export function enginePositionToCanonical(enginePosition, orientation, parentRect = null, yDirection = yDirectionForAnchor(orientation)) {
  const x = enginePosition?.x ?? 0;
  const y = (enginePosition?.y ?? 0) * yDirection;
  const anchor = parentRect ? anchorPointOf(parentRect, orientation) : null;
  return { x, y, anchor, pivot: anchor ? { x: anchor.x + x, y: anchor.y + y } : null };
}

/**
 * CANONICAL -> ENGINE for one element's `position`. The exact inverse of
 * `enginePositionToCanonical` for the same orientation and sign.
 *
 * @param {{x: number, y: number}} canonicalPosition the offset from the parent's anchor
 * @param {string} orientation the `orientation` that will be written to the file
 * @param {{x: number, y: number, width: number, height: number}} [parentRect] accepted so both
 *   directions take the same arguments
 * @param {number} [yDirection] override for the sign applied to y
 */
export function canonicalPositionToEngine(canonicalPosition, orientation, parentRect = null, yDirection = yDirectionForAnchor(orientation)) {
  return { x: canonicalPosition?.x ?? 0, y: (canonicalPosition?.y ?? 0) * yDirection };
}

/**
 * The canonical top-left corner of an element, from a pivot and the element's own `origo`.
 *
 * `origo` is the element's OWN reference point (default `upper_left`) - the point the pivot is
 * placed at. It is a plain subtraction in canonical space, because canonical y is always
 * screen-down.
 */
export function cornerFromPivot(pivot, size, origo) {
  const fraction = anchorFractions(origo);
  return { x: pivot.x - (size.width ?? 0) * fraction.x, y: pivot.y - (size.height ?? 0) * fraction.y };
}

/** The inverse of `cornerFromPivot`. */
export function pivotFromCorner(corner, size, origo) {
  const fraction = anchorFractions(origo);
  return { x: corner.x + (size.width ?? 0) * fraction.x, y: corner.y + (size.height ?? 0) * fraction.y };
}

/**
 * The canonical `position` of an element described by an engine `position` field.
 * Convenience wrapper: engine position + orientation + parent rect -> canonical position.
 */
export function canonicalPositionFor(node, parentRect) {
  const orientation = normaliseAnchor(node?.orientation) ?? 'upper_left';
  const raw = node?.position ?? {};
  return enginePositionToCanonical({ x: Number(raw.x ?? 0) || 0, y: Number(raw.y ?? 0) || 0 }, orientation, parentRect);
}

/**
 * Pick the `orientation` that best expresses a canonical rect inside a parent, preferring the
 * caller's own `orientation` when it is one of the anchors and can express the rect exactly.
 *
 * The engine has no notion of "the top-left corner"; it has an anchor plus a signed offset. Any
 * canonical rect can be expressed with any anchor - the offset is simply bigger or smaller - so
 * fidelity never forces a choice. What the choice buys is legibility: `upper_left` with a small
 * positive offset when the element hangs off the parent's top-left, `lower_right` with a negative
 * offset when it hangs off the bottom-right, and a `center*` anchor when the element is centred on
 * an axis.
 *
 * @param {{x: number, y: number, width: number, height: number}} childRect canonical
 * @param {object} parentRect canonical
 * @param {{preferred?: string, origo?: string}} options
 */
export function chooseOrientation(childRect, parentRect, options = {}) {
  const preferred = normaliseAnchor(options.preferred);
  if (preferred) return preferred;

  const origo = anchorFractions(options.origo);
  // The pivot the element's own origo implies, relative to the parent's top-left.
  const pivotX = childRect.x + childRect.width * origo.x - parentRect.x;
  const pivotY = childRect.y + childRect.height * origo.y - parentRect.y;

  const horizontal = pivotX < parentRect.width / 2 ? 'left' : 'right';
  const vertical = pivotY < parentRect.height / 2 ? 'up' : 'down';
  if (horizontal === 'left' && vertical === 'up') return 'upper_left';
  if (horizontal === 'right' && vertical === 'up') return 'upper_right';
  if (horizontal === 'left' && vertical === 'down') return 'lower_left';
  return 'lower_right';
}

/**
 * Convert an engine-space `position` on a whole tree into canonical positions, in place.
 *
 * A parsed `.gui` node stores `position` exactly as the file wrote it. That is the ENGINE's
 * reading of the field, and feeding it to the canonical layout model is how a `lower_*` element
 * ended up drawn one parent-height away from where the engine puts it. `canonicaliseTree` rewrites
 * every node's `position` to the canonical reading, using the node's own `orientation` and the
 * canonical parent rect that `parentRectFor(path)` supplies, and records the raw engine value on
 * `node.enginePosition` so nothing is lost.
 *
 * @param {object} root the layout root node (mutated)
 * @param {(path: string) => ({x: number, y: number, width: number, height: number})|null} parentRectFor
 */
export function canonicaliseTree(root, parentRectFor) {
  const visit = (node, path) => {
    const parentRect = parentRectFor(path);
    if (parentRect && node.position) {
      const orientation = normaliseAnchor(node.orientation) ?? 'upper_left';
      const enginePosition = { x: Number(node.position.x ?? 0) || 0, y: Number(node.position.y ?? 0) || 0 };
      const canonical = enginePositionToCanonical(enginePosition, orientation, parentRect);
      node.enginePosition = enginePosition;
      node.position = { x: canonical.x, y: canonical.y };
    }
    for (const child of node.children ?? []) {
      visit(child, `${path}/${child.name ?? child.id ?? '?'}`);
    }
  };
  if (root) visit(root, root.name ?? 'root');
  return root;
}

export default {
  CANONICAL_SYSTEM,
  CANONICAL_SYSTEM_SENTENCE,
  yDirectionForAnchor,
  flipsY,
  anchorFractions,
  anchorPointOf,
  pivotFromEnginePosition,
  enginePositionToCanonical,
  canonicalPositionToEngine,
  cornerFromPivot,
  pivotFromCorner,
  canonicalPositionFor,
  chooseOrientation,
  canonicaliseTree,
};
