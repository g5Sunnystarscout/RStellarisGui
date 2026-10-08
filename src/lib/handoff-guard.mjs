//------------------------------------------------------------------------------------
// handoff-guard.mjs -- Part of RStellarisGui
//
// THE GUARDRAILS FOR A HUMAN-EDITED WINDOW.
//
// The handoff exists so a human can drag boxes in the browser and send the result back to the
// agent. The editing surface is not the risk - the risk is that a drag deletes a name the engine
// dereferences, and the mod then crashes on open. This project traced three real crash dumps to
// exactly that (docs/gui-pitfalls.md), so the protection is the deliverable and the editor is the
// decoration.
//
// Two kinds of guardrail, deliberately kept apart:
//
//   1. PROTECTION (`describeProtection`, `evaluateEdits`) - a small set of operations that are
//      REFUSED outright, in the core edit loop, so every caller of `applyEdits` gets them: the
//      `gui_layout_edit` tool, the web page's `/api/edit`, and anything else added later. A
//      browser that hides a delete button is a convenience; the refusal is the guarantee.
//
//   2. CONTRACT VIOLATIONS (`scanContractViolations`) - everything the validator already knows how
//      to catch, expressed as a delta: findings that the edit INTRODUCED. A flagged edit is not
//      blocked (the human is allowed to experiment), but it is carried, in full, into the handoff
//      record, and `gui_handoff_submit` marks the submission invalid rather than accepting it as a
//      new baseline.
//
// Why a delta and not "the layout validates": an imported real window already has warnings of its
// own (the trial mod ships 12 `parked-element-shortcut` warnings). Reporting them after every drag
// would be noise, and noise is how a real crash class gets ignored. "This drag ADDED one" is the
// sentence that must not be missed.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import {
  CONTRACT_ELEMENTS,
  REQUIRED_WINDOW_NAMES,
  SHORTCUT_FIELDS,
  analyseEventWindows,
  checkParkedElements,
  isEventWindow,
  windowBoxesOf,
} from './contract.mjs';
import { computeLayout, findNode, topLevelContainers, walkLayout } from './layout.mjs';
import { RULE_SEVERITY, validateLayout } from './validate.mjs';

/**
 * Contract names a live control must keep, with the reason each one is protected. The set is
 * `REQUIRED_WINDOW_NAMES` (derived from contract.mjs, the single source of truth) plus the two
 * `note`-severity names that a real window still declares: `tts_button` and `portrait` are in the
 * demanded set already; `INCOMING_TRANSMISSION` and friends are not, because no working window
 * declares them.
 */
export const PROTECTED_NAMES = new Set(REQUIRED_WINDOW_NAMES);

/** Names that must not be renamed AWAY, even though they are not in the demanded set. */
export const PINNED_NAME_PREFIXES = ['close', 'tts_button'];

/**
 * Rules that mean "this edit can ship a crash class". A new finding with one of these rule names
 * is a hard refusal; the rest are flagged. Names in `INFO_RULES` are never treated as defects.
 */
export const HARD_RULES = new Set([
  'custom-gui-contract-missing',
  'custom-gui-contract-duplicate',
  'custom-gui-contract-nesting',
  'custom-gui-close-not-last',
  'field-not-accepted',
  'effect-on-button',
]);

/** Rules that are warnings worth surfacing but must not block a human's experiment. */
export const SOFT_RULES = new Set([
  'parked-element-shortcut',
  'parked-element-hit-region',
  'parked-duplicate-of-live-control',
  'custom-gui-option0-selfref',
  'custom-gui-force-open',
  'custom-gui-portrait-nesting',
]);

/**
 * The GUARDRAIL set is a whitelist, not a blacklist: a finding counts only when its rule is one of
 * `HARD_RULES` or `SOFT_RULES` below. Everything else the validator reports is ordinary geometry
 * (`out-of-bounds`, `sibling-overlap`, `zero-size`, `size-indeterminate`, `fixed-size-sprite-resized`,
 * `unknown-field`, ...) which the human can see on the canvas - and on the real six-window mod that
 * "everything else" is 1900+ findings, which would bury the one that means "this can crash the game".
 */

/** The rule a guardrail finding carries when it is the protection itself, not the validator. */
export const GUARD_RULES = {
  remove: 'handoff-protected-remove',
  rename: 'handoff-protected-rename',
  shortcut: 'handoff-parked-shortcut-added',
  effect: 'handoff-effect-on-button',
  closeOrder: 'handoff-close-unpinned',
};

export const GUARD_DESCRIPTIONS = {
  'handoff-protected-remove': 'a contract element name the engine dereferences would be deleted',
  'handoff-protected-rename': 'a contract element name the engine dereferences would be renamed',
  'handoff-parked-shortcut-added': 'a keyboard `shortcut` would be added to an element parked off-canvas',
  'handoff-effect-on-button': '`effect` would be set on a `buttonType`, which has no such field',
  'handoff-close-unpinned': '`close` would be moved out of the window\'s top-right corner',
};

export const GUARD_SEVERITY = {
  'handoff-protected-remove': 'error',
  'handoff-protected-rename': 'error',
  'handoff-parked-shortcut-added': 'error',
  'handoff-effect-on-button': 'error',
  'handoff-close-unpinned': 'error',
};

/** Is this node kind a control the engine binds by name? */
const CONTROL_KINDS = new Set(['button', 'effectbutton', 'guiButton', 'checkbox', 'editBox']);

/** An effect field on these kinds is a parse error, not a binding. */
const EFFECT_KINDS = new Set(['effectbutton']);

function shortPath(path) {
  return String(path ?? '').replace(/^\(.*\)\//, '');
}

function nameOf(node) {
  return node?.name ?? null;
}

/**
 * One protection record per protected element, keyed by the SAME path the rect table, the
 * validator and the page's tree all use (`(file)/window/element` for an imported file,
 * `window/element` for a single-window layout).
 *
 * @param {object} layout
 * @param {{customGuiWindows?: string[], checkAllWindows?: boolean}} options
 * @returns {Map<string, {path: string, name: string, kind: string|null, window: string|null,
 *          depth: number, protected: true, windowContainer: boolean, close: boolean, reason: string}>}
 */
export function describeProtection(layout, options = {}) {
  const protections = new Map();
  if (!layout?.root) return protections;
  const synthetic = layout.root.syntheticRoot === true;
  // `walkLayout` numbers each walk from its own start, so the root prefix is carried separately.
  // Without it the guard would key on `window/element` while the tree, the rect table and the page
  // all use `(file)/window/element` - and the locks would silently attach to nothing.
  const prefix = synthetic ? `${layout.root.name ?? 'root'}/` : '';
  const windows = topLevelContainers(layout);
  for (const window of windows) {
    if (!window) continue;
    const windowName = nameOf(window) ?? '(unnamed)';
    if (!['container', 'window'].includes(window.kind ?? 'container')) continue;
    if (!isEventWindow(window, options)) continue;
    const windowPath = `${prefix}${windowName}`;
    // The window container itself is pinned: renaming it breaks `custom_gui = "<name>"` in the
    // event, and top-level container names are the engine's lookup key for the window.
    protections.set(windowPath, {
      path: windowPath,
      name: windowName,
      kind: window.kind ?? 'container',
      window: windowName,
      depth: prefix ? 1 : 0,
      protected: true,
      windowContainer: true,
      close: false,
      reason: 'a top-level window name: an event\'s `custom_gui` resolves the window by this name',
      contractNames: [...new Set((window.children ?? []).map((child) => child.name).filter((name) => PROTECTED_NAMES.has(name)))],
    });
    walkLayout(
      window,
      (node, parent, depth, path) => {
        if (node === window) return;
        const name = nameOf(node);
        if (!name || !PROTECTED_NAMES.has(name)) return;
        const kind = node.kind ?? null;
        const entry = CONTRACT_ELEMENTS.find((candidate) => candidate.name === name);
        const fullPath = `${prefix}${path}`;
        protections.set(fullPath, {
          path: fullPath,
          name,
          kind,
          window: windowName,
          depth,
          protected: true,
          windowContainer: false,
          close: name === 'close',
          demand: entry?.demand ?? null,
          isControl: kind ? CONTROL_KINDS.has(kind) : false,
          reason:
            name === 'close'
              ? '`close` is the control the engine wires to OPTION 0 and the window\'s last direct child'
              : entry?.demand === 'error'
                ? `\`${name}\` is in the CRASH class: the engine dereferences it by name (${entry.note ?? 'contract element'})`
                : `\`${name}\` is a name the engine looks up by name in a \`custom_gui\` window (${entry?.note ?? 'contract element'})`,
        });
      },
      // The empty starting path is what makes `walkLayout` build `window/child` itself rather than
      // repeating the window name; the window node it visits first is skipped above.
      null,
      0,
      '',
    );
  }
  return protections;
}

/** The protection entries, as an array sorted by path, for a JSON response to the page. */
export function protectionList(layout, options = {}) {
  return [...describeProtection(layout, options).values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The paths the page needs to draw the locks: which elements cannot be deleted or renamed, and
 * which one is the pinned `close`.
 */
export function protectionIndex(layout, options = {}) {
  const protections = describeProtection(layout, options);
  return {
    protectedPaths: new Set(protections.keys()),
    renameablePaths: new Set([...protections.values()].filter((entry) => entry.windowContainer).map((entry) => entry.path)),
    closePaths: new Set([...protections.values()].filter((entry) => entry.close).map((entry) => entry.path)),
    protections,
  };
}

function guardFinding(rule, extra) {
  return {
    rule,
    severity: GUARD_SEVERITY[rule] ?? 'error',
    description: GUARD_DESCRIPTIONS[rule],
    source: 'handoff-guard',
    ...extra,
  };
}

/**
 * Which window does this node live in? Used for the close-order rule and for messages.
 * @returns {{window: object|null, index: number, siblings: object[]}|null}
 */
function windowPlacement(layout, node) {
  for (const window of topLevelContainers(layout)) {
    const children = window?.children ?? [];
    const index = children.indexOf(node);
    if (index !== -1) return { window, index, siblings: children };
    let found = null;
    walkLayout(window, (candidate, parent) => {
      if (found || candidate !== node) return;
      found = { window, index: -1, siblings: parent?.children ?? [] };
    });
    if (found) return found;
  }
  return null;
}

/** How far from the top-right corner a `close` control may sit before it counts as un-pinned. */
export const CLOSE_INSET_LIMIT = 200;

/** The canonical position a `set` edit would leave on the node. */
function nextClosePosition(node, path, value) {
  const current = node.position && typeof node.position === 'object' ? node.position : {};
  const x = Number(current.x ?? 0) || 0;
  const y = Number(current.y ?? 0) || 0;
  if (path === 'position') {
    return { x: Number(value?.x ?? 0) || 0, y: Number(value?.y ?? 0) || 0 };
  }
  if (path === 'position.x') return { x: Number(value) || 0, y };
  if (path === 'position.y') return { x, y: Number(value) || 0 };
  return { x, y };
}

/**
 * Is this close position still the window's top-right corner?
 *
 * Canonical `position` for an `upper_right` element is the offset from the top-right anchor, so
 * the corner itself is `(0, 0)`, moving left is a NEGATIVE x, and moving down is a POSITIVE y.
 * The bounds are deliberately generous (200px, and the working window uses (-45, 16)): this
 * refuses "somewhere else in the window", not "two pixels off".
 */
export function closeInsetOk(position) {
  if (!position) return true;
  const { x, y } = position;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true; // a percentage/variable: not ours to judge
  return x <= 0 && x >= -CLOSE_INSET_LIMIT && y >= 0 && y <= CLOSE_INSET_LIMIT;
}

/**
 * Evaluate a list of edits against the protection policy, WITHOUT applying them.
 *
 * Each edit is checked against the CURRENT tree, which is enough for the protection rules: they
 * are all about a single named element, and the edit vocabulary addresses elements by id/name
 * rather than by path. The returned record is what both the tool and the HTTP route report.
 *
 * @returns {{allowed: boolean, refused: object[], evaluated: number}}
 */
export function evaluateEdits(layout, edits, options = {}) {
  const protections = describeProtection(layout, options);
  const refused = [];
  const byNode = new Map();
  for (const [key, value] of protections) {
    const node = findNode(layout, key) ?? findNode(layout, value.name);
    if (node && !byNode.has(node)) byNode.set(node, value);
  }
  // A name-keyed fallback for a layout whose path convention differs (e.g. a synthetic root that
  // was never named). Protection is by NAME inside a window, so this is the same rule.
  const byName = new Map();
  for (const value of protections.values()) {
    if (!value.windowContainer && !byName.has(value.name)) byName.set(value.name, value);
  }

  const lookup = (target) => {
    if (typeof target !== 'string' || target === '') return null;
    if (protections.has(target)) return protections.get(target);
    const node = findNode(layout, target);
    if (node) {
      if (byNode.has(node)) return byNode.get(node);
      const name = node.name ?? null;
      if (name && byName.has(name)) {
        const candidate = byName.get(name);
        // Only when that name is protected exactly once, so a lookup can never silently protect
        // the wrong window's element.
        const count = [...protections.values()].filter((entry) => entry.name === name).length;
        if (count === 1) return candidate;
      }
      return null;
    }
    // A path the caller built with a different root prefix.
    const suffix = `/${target}`;
    for (const [key, value] of protections) if (key.endsWith(suffix)) return value;
    return null;
  };

  for (const [index, edit] of (edits ?? []).entries()) {
    if (!edit || typeof edit !== 'object') continue;
    const target = edit.target ?? edit.node?.name ?? edit.node?.id ?? null;

    if (edit.op === 'remove') {
      const protection = lookup(edit.target);
      if (protection) {
        refused.push(
          guardFinding(GUARD_RULES.remove, {
            index,
            op: 'remove',
            target: protection.path,
            name: protection.name,
            window: protection.window,
            message:
              `refused: \`${protection.name}\` cannot be deleted from \`${protection.window}\`. ` +
              `${protection.reason}. Deleting it is the mod-crash class this project traced to three ` +
              'crash dumps; park it instead (`position = { x = -3000 y = -3000 }` with a zero size), which ' +
              'keeps the name the engine looks up while showing nothing.',
            suggestedFix: 'park the element rather than deleting it, or edit a copy of the layout under a different window name.',
          }),
        );
        continue;
      }
    }

    if (edit.op === 'rename') {
      const protection = lookup(edit.target);
      if (protection && protection.name !== edit.name) {
        const keepsName = edit.name === protection.name;
        if (!keepsName) {
          refused.push(
            guardFinding(GUARD_RULES.rename, {
              index,
              op: 'rename',
              target: protection.path,
              name: protection.name,
              window: protection.window,
              requested: edit.name ?? null,
              message:
                `refused: \`${protection.name}\` cannot be renamed to \`${edit.name ?? ''}\`. ${protection.reason}. ` +
                'The engine resolves these names with its own string table, so a rename silently turns the element ' +
                'into a missing one.',
              suggestedFix: protection.windowContainer
                ? 'keep the window name: an event\'s `custom_gui = "<name>"` resolves it.'
                : `keep the name \`${protection.name}\`, or add a SECOND, differently-named element.`,
            }),
          );
          continue;
        }
      }
    }

    if (edit.op === 'add') {
      const node = edit.node ?? null;
      const name = nameOf(node);
      const parent = edit.parent ? findNode(layout, edit.parent) : null;
      // (a) an `effect` on a plain buttonType: the engine answers "Unexpected token: effect" and
      //     the button renders but does nothing.
      if (name && /Type$/.test(String(node?.keyword ?? '')) === false && node?.effect !== undefined && node?.effect !== null) {
        const kind = node?.kind ?? null;
        if (kind && !EFFECT_KINDS.has(kind) && CONTROL_KINDS.has(kind)) {
          refused.push(
            guardFinding(GUARD_RULES.effect, {
              index,
              op: 'add',
              target: name,
              name,
              kind,
              message:
                `refused: \`effect\` is not a field of \`${kind}\` (the engine answers "Unexpected token: effect"), ` +
                'so the button would render and do nothing. A control that needs script must be an `effectbuttonType` ' +
                '(same name, sprite, position, orientation and clicksound).',
              suggestedFix: 'make this element an `effectbuttonType`, or drop the `effect`.',
            }),
          );
          continue;
        }
      }
      void parent;
    }

    if (edit.op === 'set') {
      const protection = lookup(edit.target);
      const path = String(edit.path ?? '');

      // (b) `effect` on a buttonType - the same defect as above, through the property form.
      if (path === 'effect' || path.endsWith('.effect')) {
        const node = edit.target ? findNode(layout, edit.target) : null;
        const kind = node?.kind ?? null;
        if (kind && !EFFECT_KINDS.has(kind) && CONTROL_KINDS.has(kind) && edit.value !== '' && edit.value !== null && edit.value !== undefined) {
          refused.push(
            guardFinding(GUARD_RULES.effect, {
              index,
              op: 'set',
              target: edit.target,
              path,
              name: nameOf(node),
              kind,
              message:
                `refused: \`effect = ${edit.value}\` on a \`${kind}\`: \`effect\` is not a field of \`${kind}\`, ` +
                'so the engine answers "Unexpected token: effect" and the control renders and does nothing. Use an ' +
                '`effectbuttonType`.',
              suggestedFix: 'change the element kind to `effectbuttonType` first, or leave `effect` unset.',
            }),
          );
          continue;
        }
      }

      // (c) a keyboard shortcut on a parked element: parking removes the pixels, not the binding.
      if (SHORTCUT_FIELDS.includes(path)) {
        const node = edit.target ? findNode(layout, edit.target) : null;
        if (node && edit.value !== '' && edit.value !== null && edit.value !== undefined) {
          const parked = isParkedNode(layout, node);
          if (parked?.parked) {
            refused.push(
              guardFinding(GUARD_RULES.shortcut, {
                index,
                op: 'set',
                target: edit.target,
                path,
                name: nameOf(node),
                message:
                  `refused: \`${path} = ${edit.value}\` on \`${nameOf(node)}\`, which is parked off-canvas ` +
                  `(${parked.rect.x},${parked.rect.y} ${parked.rect.width}x${parked.rect.height}). Parking removes the ` +
                  'pixels, not the binding: the engine still binds the key, so an off-screen control keeps responding ' +
                  'and a duplicate of a live control steals the shortcut from it.',
                suggestedFix: `do not give a parked element a shortcut (delete the \`${path}\` line), or un-park it first.`,
              }),
            );
            continue;
          }
        }
      }

      // (d) `close` pinned into the window's top-right corner.
      //
      // The rule is the ORIENTATION plus a bounded inset from the anchor, not an exact pixel: the
      // engine's `position` for an `upper_right` element is an offset from the top-RIGHT corner
      // (negative x moves left, into the window), and this project's canonical model keeps that
      // same meaning. A human is free to slide the close button a little; what must not happen is
      // that it ends up somewhere a player cannot find or reach it.
      if (path === 'orientation' || path === 'position' || path.startsWith('position.') || path === 'position.x' || path === 'position.y') {
        const node = edit.target ? findNode(layout, edit.target) : null;
        if (node && nameOf(node) === 'close' && protection?.close) {
          const placement = windowPlacement(layout, node);
          const last = placement ? placement.index === -1 || placement.index === placement.siblings.length - 1 : true;
          const orientation = path === 'orientation' ? String(edit.value ?? '') : String(node.orientation ?? 'upper_left');
          const upperRight = orientation.toLowerCase().replace(/[\s_-]/g, '') === 'upperright';
          if (!upperRight) {
            refused.push(
              guardFinding(GUARD_RULES.closeOrder, {
                index,
                op: 'set',
                target: edit.target,
                path,
                name: 'close',
                message:
                  'refused: `close` must keep the `upper_right` orientation, which is what anchors it to the window\'s ' +
                  'top-right corner where a player looks for it. Its canonical `position` is an OFFSET FROM THAT CORNER, ' +
                  'so the button is still draggable - changing the orientation is what would move it out of the corner.',
                suggestedFix: 'keep `orientation = upper_right` and move `close` with `position` instead.',
              }),
            );
            continue;
          }
          if (!last) {
            refused.push(
              guardFinding(GUARD_RULES.closeOrder, {
                index,
                op: 'set',
                target: edit.target,
                path,
                name: 'close',
                message:
                  'refused: `close` is no longer the window\'s last direct child, so later siblings draw over it and the ' +
                  'engine\'s draw order can bury the one control that dismisses the window.',
                suggestedFix: 'move `close` back to the end of the window\'s children before moving it.',
              }),
            );
            continue;
          }
          const next = nextClosePosition(node, path, edit.value);
          if (!closeInsetOk(next)) {
            refused.push(
              guardFinding(GUARD_RULES.closeOrder, {
                index,
                op: 'set',
                target: edit.target,
                path,
                name: 'close',
                position: next,
                message:
                  `refused: \`close\` would be at canonical (${next.x},${next.y}), which is not the window's top-right ` +
                  'corner. For an `upper_right` element the canonical `position` is the offset from that corner: a ' +
                  'negative x moves left INTO the window and a positive y moves down. A close button more than 200px ' +
                  'from its corner, or beyond the corner, is one a player cannot find or click.',
                suggestedFix: 'use a small negative x and a small non-negative y (the working window uses (-45, 16)).',
              }),
            );
            continue;
          }
        }
      }
    }

    if (edit.op === 'move') {
      const protection = lookup(edit.target);
      if (protection) {
        const node = findNode(layout, edit.target);
        const destination = edit.parent ? findNode(layout, edit.parent) : null;
        const stillInsideSameWindow = destination ? windowNameOf(layout, destination) === protection.window : true;
        if (!stillInsideSameWindow) {
          refused.push(
            guardFinding(GUARD_RULES.remove, {
              index,
              op: 'move',
              target: protection.path,
              name: protection.name,
              window: protection.window,
              message:
                `refused: \`${protection.name}\` cannot be moved out of \`${protection.window}\`. ${protection.reason}. ` +
                'A contract name is only satisfied INSIDE the window the event names.',
              suggestedFix: `move it to a different place inside \`${protection.window}\` instead.`,
            }),
          );
          continue;
        }
        if (protection.close && node) {
          const placement = windowPlacement(layout, node);
          if (placement && placement.window && destination === placement.window) {
            // Moving close to the end is fine; anywhere else loses the last-child guarantee.
            const siblings = (placement.window.children ?? []).filter((child) => child !== node);
            const targetIndex = edit.index ?? siblings.length;
            if (targetIndex !== siblings.length) {
              refused.push(
                guardFinding(GUARD_RULES.closeOrder, {
                  index,
                  op: 'move',
                  target: edit.target,
                  name: 'close',
                  message:
                    'refused: `close` must stay the window\'s LAST direct child. Draw order is the engine\'s only ' +
                    'z-order, so a later sibling draws over the close button - the measured way it becomes invisible ' +
                    'or unclickable.',
                  suggestedFix: 'move `close` to the end of its window\'s children (or omit `index`).',
                }),
              );
              continue;
            }
          }
        }
      }
    }
  }

  return { allowed: refused.length === 0, refused, evaluated: (edits ?? []).length };
}

/** Walk up from a node to the top-level window that contains it. */
export function windowNameOf(layout, node) {
  let found = null;
  for (const window of topLevelContainers(layout)) {
    walkLayout(window, (candidate) => {
      if (candidate === node) found = window;
    });
    if (found) return nameOf(found);
  }
  return null;
}

/** Is this node parked, using the SAME rule and the same code path the validator uses. */
export function isParkedNode(layout, node, options = {}) {
  const computed = computeLayout(layout, { spriteLookup: options.spriteLookup ?? null });
  const box = computed.boxes.find((candidate) => candidate.node === node);
  if (!box) return { parked: false, rect: null, findings: [] };
  const findings = checkParkedElements(layout, computed.boxes, options);
  const mine = findings.filter((finding) => finding.path === box.path);
  return { parked: mine.length > 0, rect: roundRect(box.rect), findings: mine, path: box.path };
}

function roundRect(rect) {
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
}

/**
 * Contract findings, by rule, for one validation report.
 *
 * ONLY the guardrail rules are kept. Everything else the validator reports - `out-of-bounds`,
 * `sibling-overlap`, `zero-size`, `size-indeterminate`, `fixed-size-sprite-resized` and the rest -
 * is ordinary geometry the human can see on the canvas and judge for themselves. Mixing it in
 * produced a 195-entry "flagged" list on the real mod, which is the same as no list at all: the
 * one finding that means "this can crash the game" has to be the one that stands out.
 *
 * @param {object[]} findings a full `validateLayout` finding list
 * @returns {{hard: object[], soft: object[], byRule: object, all: object[], ignored: object}}
 */
export function classifyFindings(findings = []) {
  const hard = [];
  const soft = [];
  const byRule = {};
  const ignored = {};
  const all = [];
  for (const finding of findings) {
    const rule = finding.rule;
    const isHard = HARD_RULES.has(rule);
    const isSoft = SOFT_RULES.has(rule);
    if (!isHard && !isSoft) {
      ignored[rule] = (ignored[rule] ?? 0) + 1;
      continue;
    }
    const entry = {
      rule,
      severity: finding.severity ?? RULE_SEVERITY[rule] ?? (isHard ? 'error' : 'warning'),
      path: finding.path ?? null,
      element: finding.element ?? null,
      message: finding.message,
      suggestedFix: finding.suggestedFix ?? null,
      guardrail: isHard ? 'hard' : 'soft',
    };
    byRule[rule] = (byRule[rule] ?? 0) + 1;
    all.push(entry);
    if (isHard) hard.push(entry);
    else soft.push(entry);
  }
  return { hard, soft, byRule, all, ignored };
}

/**
 * The guardrail findings a layout carries: the contract rules, the parked-element traps and the
 * per-kind field rejections.
 *
 * Accuracy matters more than cost here, because a FINDING decides whether a submission is marked
 * invalid. In particular the parked-element checks need the sprite lookup: without it an unsized
 * icon resolves to 0x0 and is then "parked" by definition, which manufactures findings on a
 * perfectly good window. So when an asset index is supplied it is USED, and only an explicit
 * `checkAssets: false` skips it.
 *
 * @param {object} layout
 * @param {{assets?: object, localisation?: object, extraButtonEffects?: Set<string>|string[],
 *          customGuiWindows?: string[], checkAssets?: boolean, checkLocalisation?: boolean,
 *          includeParked?: boolean, options?: object}} validationContext
 */
export function scanContractViolations(layout, validationContext = {}) {
  const report = validateLayout(layout, {
    assets: validationContext.assets ?? null,
    localisation: validationContext.localisation ?? null,
    extraButtonEffects: validationContext.extraButtonEffects ?? null,
    options: {
      checkAssets: validationContext.checkAssets !== false,
      checkLocalisation: validationContext.checkLocalisation === true,
      checkContainerNames: false,
      checkCustomGuiContract: true,
      ...(validationContext.customGuiWindows ? { customGuiWindows: validationContext.customGuiWindows } : {}),
      ...(validationContext.options ?? {}),
    },
  });
  let findings = report.findings;
  if (validationContext.includeParked === false) {
    findings = findings.filter((finding) => !String(finding.rule).startsWith('parked-'));
  }
  const classified = classifyFindings(findings);
  return { ...classified, verdict: report.verdict, counts: report.counts, report };
}

/**
 * The guardrail DELTA: findings the edit introduced, by `rule|path`, with the ones it removed.
 *
 * @param {{before?: object, after?: object}} reports two `scanContractViolations` results
 */
export function diffViolations(before, after) {
  const key = (finding) => `${finding.rule}|${finding.path ?? ''}|${finding.element ?? ''}`;
  const beforeKeys = new Set((before?.all ?? []).map(key));
  const afterKeys = new Set((after?.all ?? []).map(key));
  const introduced = (after?.all ?? []).filter((finding) => !beforeKeys.has(key(finding)));
  const resolved = (before?.all ?? []).filter((finding) => !afterKeys.has(key(finding)));
  const introducedHard = introduced.filter((finding) => finding.guardrail === 'hard');
  const introducedSoft = introduced.filter((finding) => finding.guardrail === 'soft');
  return {
    introduced,
    introducedHard,
    introducedSoft,
    resolved,
    clear: introduced.length === 0,
    verdict: introducedHard.length > 0 ? 'fail' : introducedSoft.length > 0 ? 'warn' : 'pass',
  };
}

/** A one-sentence summary of a violation delta, for a tool result or a page banner. */
export function describeViolationDelta(delta) {
  if (delta.clear) return 'no new contract, parked-element or field finding: this edit did not introduce a known defect class.';
  const parts = [];
  if (delta.introducedHard.length > 0) parts.push(`${delta.introducedHard.length} HARD: ${[...new Set(delta.introducedHard.map((f) => f.rule))].join(', ')}`);
  if (delta.introducedSoft.length > 0) parts.push(`${delta.introducedSoft.length} flagged: ${[...new Set(delta.introducedSoft.map((f) => f.rule))].join(', ')}`);
  return `this edit introduced ${parts.join('; ')}`;
}

/**
 * The ONE entry point both the `gui_layout_edit` tool and the page's `/api/edit` route call.
 *
 * A batch containing a refused edit is applied ATOMICALLY-or-not-at-all: the tree the caller gets
 * back is either the fully applied batch or the unchanged layout. That is deliberate. The page
 * paints an optimistic overlay while the human drags, so a half-applied batch would leave the
 * canvas showing something the model does not hold - the exact drift the shared-renderer design
 * exists to prevent. The refusal list says which edit was refused and what to do instead.
 *
 * The two call sites are the whole editing surface of the product, and both are asserted by
 * scripts/selftest.mjs to route through here - a future caller that reached `applyEdits` directly
 * would silently lose the protection, so the selftest includes a check that the guard is WIRED IN
 * (see the "handoff guardrails" block).
 *
 * @param {object} layout the current tree
 * @param {object[]} edits the caller's edits
 * @param {{applyEdits: Function, customGuiWindows?: string[], scanContractViolations?: boolean,
 *          validationContext?: object}} options
 * @returns {{layout: object, applied: object[], failed: object[], refused: object[],
 *           guardrails: object, violations: object|null}}
 */
export function guardedEdit(layout, edits, options = {}) {
  if (typeof options.applyEdits !== 'function') throw new Error('guardedEdit needs `options.applyEdits`');
  const list = Array.isArray(edits) ? edits : [];
  const check = evaluateEdits(layout, list, options);

  if (!check.allowed) {
    return {
      layout,
      applied: [],
      failed: [],
      refused: check.refused,
      guardrails: {
        evaluated: check.evaluated,
        refusedCount: check.refused.length,
        appliedCount: 0,
        allowed: false,
        blocked: true,
        rules: [...new Set(check.refused.map((entry) => entry.rule))],
        note: 'the batch was not applied at all: a refused edit is never applied partially.',
      },
      // Nothing was applied, so nothing can have been introduced. The refusal itself is the finding.
      violations: { introduced: [], introducedHard: [], introducedSoft: [], resolved: [], clear: true, verdict: 'pass' },
    };
  }

  const result = options.applyEdits(layout, list);

  // The guardrail DELTA, on the applied path only. An imported real window already carries
  // warnings of its own, so the question is never "does this layout validate" but "did this edit
  // ADD a defect class". Only a refusal or a hard finding is an error; the rest are flags.
  let violations = null;
  if (options.scanContractViolations === false) {
    violations = null;
  } else {
    try {
      const before = scanContractViolations(layout, options.validationContext ?? {});
      const after = scanContractViolations(result.layout, options.validationContext ?? {});
      violations = { ...diffViolations(before, after), summary: describeViolationDelta(diffViolations(before, after)) };
    } catch (thrown) {
      violations = {
        introduced: [],
        introducedHard: [],
        introducedSoft: [],
        resolved: [],
        clear: true,
        verdict: 'pass',
        error: `the guardrail scan could not run (${thrown instanceof Error ? thrown.message : String(thrown)}); treat this edit as unscanned`,
      };
    }
  }

  return {
    ...result,
    refused: [],
    guardrails: {
      evaluated: check.evaluated,
      refusedCount: 0,
      appliedCount: (result.applied ?? []).length,
      allowed: true,
      blocked: false,
      rules: [],
      introducedHard: violations?.introducedHard?.length ?? 0,
      introducedSoft: violations?.introducedSoft?.length ?? 0,
      verdict: violations?.verdict ?? 'unscanned',
    },
    violations,
  };
}

export default {
  describeProtection,
  protectionList,
  protectionIndex,
  evaluateEdits,
  scanContractViolations,
  diffViolations,
  describeViolationDelta,
  classifyFindings,
  PROTECTED_NAMES,
  GUARD_RULES,
  GUARD_DESCRIPTIONS,
  HARD_RULES,
  SOFT_RULES,
};
