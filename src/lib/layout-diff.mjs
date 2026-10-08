//------------------------------------------------------------------------------------
// layout-diff.mjs -- Part of RStellarisGui
//
// The provenance engine behind the human<->agent handoff.
//
// Two revisions of one layout are compared ELEMENT BY ELEMENT, in the model's own vocabulary
// (`position`, size, sprite, kind, text-field), never by looking at the emitted text. That
// matters for two reasons:
//
//   * A human dragging a box in the page changes `position` and nothing else. A text diff of the
//     .gui file would show a moved line; the element diff says "moved `unga_title_main`
//     (30,22) -> (48,22)", which is the sentence the brief asks for and the sentence a reviewer
//     can act on.
//   * The agent's changes and the human's changes go through THE SAME function, so the diff the
//     human reads back ("the agent moved this") is produced by the same code that produced the
//     diff the agent read ("the human moved this"). One implementation, no drift.
//
// Element matching is deliberately conservative and ordered:
//   1. by full path (no rename, no reparent),
//   2. by name among the SAME siblings (a rename),
//   3. by name anywhere (a reparent).
// Anything a pass does not claim becomes an addition or a removal, so nothing can silently
// vanish from the report.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { walkLayout } from './layout.mjs';

/** Fields compared verbatim on every matched element, in report order. (`kind` has its own entry.) */
const SCALAR_FIELDS = ['orientation', 'origo', 'font', 'buttonFont', 'effect', 'text', 'buttonText', 'shortcut', 'shortCut', 'actionShortcut'];

/** Sprite-bearing fields, flattened to `background.sprite` so the report names the real thing. */
const SPRITE_FIELDS = ['spriteType', 'quadTextureSprite'];

/** Build the comparison index of a layout: one row per element, in document order. */
export function indexLayout(layout) {
  const rows = [];
  if (!layout?.root) return rows;
  walkLayout(layout.root, (node, parent, depth, path) => {
    rows.push({
      node,
      parent,
      depth,
      path,
      parentPath: parent ? path.slice(0, Math.max(0, path.lastIndexOf('/'))) || null : null,
      name: node.name ?? null,
      kind: node.kind ?? null,
    });
  });
  return rows;
}

function round(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : String(value);
}

/** `{x, y}` for a position block that may be a number, a `{x,y}` object or absent. */
export function positionOf(node) {
  const position = node?.position;
  if (!position || typeof position !== 'object') return null;
  const x = round(position.x);
  const y = round(position.y);
  if (x === null && y === null) return null;
  return { x: x ?? 0, y: y ?? 0 };
}

/**
 * The size of an element in the model, whichever of the two spellings the kind uses.
 *
 * `maxWidth`/`maxHeight` is not a cosmetic alternative: `instantTextBoxType` REJECTS `size`
 * ("Unexpected token: size"), so a text element's box only ever lives in those two fields and a
 * diff that compared `size` alone would miss every text resize.
 */
export function sizeOf(node) {
  const size = node?.size;
  if (size && typeof size === 'object') {
    const width = round(size.width ?? size.x);
    const height = round(size.height ?? size.y);
    if (width !== null || height !== null) return { width: width ?? 0, height: height ?? 0 };
  }
  const maxWidth = round(node?.maxWidth);
  const maxHeight = round(node?.maxHeight);
  if (maxWidth !== null || maxHeight !== null) return { width: maxWidth ?? 0, height: maxHeight ?? 0 };
  return null;
}

/** `background.sprite` / `background.name` as one comparison value. */
export function spriteOf(node) {
  const background = node?.background;
  if (!background || typeof background !== 'object') return null;
  return background.sprite ?? background.quadTextureSprite ?? null;
}

function same(target, other) {
  return JSON.stringify(target ?? null) === JSON.stringify(other ?? null);
}

function label(row) {
  return row.name ?? row.node?.id ?? row.path.split('/').pop() ?? '(unnamed)';
}

function shortPath(path) {
  return String(path ?? '').replace(/^\(.*\)\//, '');
}

/**
 * Compare two layout revisions.
 *
 * @param {object} before the layout as it was loaded
 * @param {object} after the layout as it stands now
 * @param {{beforeLabel?: string, afterLabel?: string, beforeId?: string, afterId?: string,
 *          includeUnchanged?: boolean}} options
 * @returns {{before, after, beforeLabel, afterLabel, counts, changedPaths, changes, unchanged}}
 */
export function diffLayouts(before, after, options = {}) {
  const beforeRows = indexLayout(before);
  const afterRows = indexLayout(after);
  const beforeByPath = new Map(beforeRows.map((row) => [row.path, row]));
  const afterByPath = new Map(afterRows.map((row) => [row.path, row]));
  const claimedBefore = new Set();
  const claimedAfter = new Set();
  const pairs = [];

  // Pass 1: exact path.
  for (const row of afterRows) {
    const previous = beforeByPath.get(row.path);
    if (!previous || claimedBefore.has(previous)) continue;
    claimedBefore.add(previous);
    claimedAfter.add(row);
    pairs.push({ before: previous, after: row });
  }
  // Pass 2: same parent, same name - a rename.
  for (const row of afterRows) {
    if (claimedAfter.has(row)) continue;
    const previous = beforeRows.find(
      (candidate) =>
        !claimedBefore.has(candidate) &&
        candidate.name !== null &&
        candidate.name === row.name &&
        candidate.parentPath === row.parentPath,
    );
    if (!previous) continue;
    claimedBefore.add(previous);
    claimedAfter.add(row);
    pairs.push({ before: previous, after: row });
  }
  // Pass 3: same name anywhere - a reparent.
  for (const row of afterRows) {
    if (claimedAfter.has(row)) continue;
    const previous = beforeRows.find((candidate) => !claimedBefore.has(candidate) && candidate.name !== null && candidate.name === row.name);
    if (!previous) continue;
    claimedBefore.add(previous);
    claimedAfter.add(row);
    pairs.push({ before: previous, after: row });
  }

  const changes = [];
  for (const pair of pairs) {
    const { before: source, after: target } = pair;
    const name = label(target);
    const targetId = target.node?.id ?? source.node?.id ?? null;

    if (source.path !== target.path) {
      changes.push({
        change: 'reparented',
        path: target.path,
        beforePath: source.path,
        id: targetId,
        name,
        from: shortPath(source.parentPath),
        to: shortPath(target.parentPath),
        summary: `moved \`${name}\` out of \`${shortPath(source.parentPath) ?? '(root)'}\` into \`${shortPath(target.parentPath) ?? '(root)'}\``,
      });
    }
    if (source.name !== target.name) {
      changes.push({
        change: 'renamed',
        path: target.path,
        beforePath: source.path,
        id: targetId,
        name,
        from: source.name,
        to: target.name,
        summary: `renamed \`${source.name ?? '(unnamed)'}\` -> \`${target.name ?? '(unnamed)'}\``,
      });
    }
    if (source.kind !== target.kind) {
      changes.push({
        change: 'kind',
        path: target.path,
        id: targetId,
        name,
        from: source.kind,
        to: target.kind,
        summary: `changed kind of \`${name}\` ${source.kind} -> ${target.kind}`,
      });
    }

    const beforePosition = positionOf(source.node);
    const afterPosition = positionOf(target.node);
    if (!same(beforePosition, afterPosition)) {
      const from = beforePosition ? `(${beforePosition.x},${beforePosition.y})` : '(unset)';
      const to = afterPosition ? `(${afterPosition.x},${afterPosition.y})` : '(unset)';
      changes.push({
        change: 'moved',
        path: target.path,
        id: targetId,
        name,
        from: beforePosition,
        to: afterPosition,
        summary: `moved \`${name}\` ${from} -> ${to}`,
      });
    }

    const beforeSize = sizeOf(source.node);
    const afterSize = sizeOf(target.node);
    if (!same(beforeSize, afterSize)) {
      const from = beforeSize ? `${beforeSize.width}x${beforeSize.height}` : '(unset)';
      const to = afterSize ? `${afterSize.width}x${afterSize.height}` : '(unset)';
      changes.push({
        change: 'resized',
        path: target.path,
        id: targetId,
        name,
        from: beforeSize,
        to: afterSize,
        summary: `resized \`${name}\` ${from} -> ${to}`,
      });
    }

    for (const field of SPRITE_FIELDS) {
      if ((source.node?.[field] ?? null) === (target.node?.[field] ?? null)) continue;
      changes.push({
        change: 'sprite',
        path: target.path,
        id: targetId,
        name,
        field,
        from: source.node?.[field] ?? null,
        to: target.node?.[field] ?? null,
        summary: `changed sprite of \`${name}\` (${field}) ${source.node?.[field] ?? '(none)'} -> ${target.node?.[field] ?? '(none)'}`,
      });
    }
    if (!same(spriteOf(source.node), spriteOf(target.node))) {
      changes.push({
        change: 'sprite',
        path: target.path,
        id: targetId,
        name,
        field: 'background.sprite',
        from: spriteOf(source.node),
        to: spriteOf(target.node),
        summary: `changed background sprite of \`${name}\` ${spriteOf(source.node) ?? '(none)'} -> ${spriteOf(target.node) ?? '(none)'}`,
      });
    }

    for (const field of SCALAR_FIELDS) {
      const from = source.node?.[field] ?? null;
      const to = target.node?.[field] ?? null;
      if (from === to) continue;
      changes.push({
        change: 'field',
        path: target.path,
        id: targetId,
        name,
        field,
        from,
        to,
        summary: `changed \`${field}\` of \`${name}\` ${from === null ? '(unset)' : `"${from}"`} -> ${to === null ? '(unset)' : `"${to}"`}`,
      });
    }
  }

  for (const row of afterRows) {
    if (claimedAfter.has(row)) continue;
    changes.push({
      change: 'added',
      path: row.path,
      id: row.node?.id ?? null,
      name: label(row),
      kind: row.kind,
      parent: shortPath(row.parentPath),
      summary: `added element \`${label(row)}\` (${row.kind ?? 'unknown kind'}) under \`${shortPath(row.parentPath) ?? '(root)'}\``,
    });
  }
  for (const row of beforeRows) {
    if (claimedBefore.has(row)) continue;
    changes.push({
      change: 'removed',
      path: row.path,
      what: 'removed',
      id: row.node?.id ?? null,
      name: label(row),
      kind: row.kind,
      parent: shortPath(row.parentPath),
      message: `deleted element \`${label(row)}\` (${row.kind ?? 'unknown kind'}) from \`${shortPath(row.parentPath) ?? '(root)'}\``,
      summary: `deleted element \`${label(row)}\` (${row.kind ?? 'unknown kind'}) from \`${shortPath(row.parentPath) ?? '(root)'}\``,
    });
  }

  const counts = {};
  for (const change of changes) counts[change.change] = (counts[change.change] ?? 0) + 1;
  const changedPaths = [...new Set(changes.map((change) => change.path).filter(Boolean))];

  // Variables are part of the model too: `@unga_w` moving is a layout change with no element to
  // attach it to, so it gets its own entry rather than being dropped.
  const beforeVariables = before?.variables ?? {};
  const afterVariables = after?.variables ?? {};
  const variableChanges = [];
  for (const key of [...new Set([...Object.keys(beforeVariables), ...Object.keys(afterVariables)])].sort()) {
    const from = beforeVariables[key] === undefined ? null : String(beforeVariables[key]);
    const to = afterVariables[key] === undefined ? null : String(afterVariables[key]);
    if (from === to) continue;
    variableChanges.push({ variable: key, from, to, summary: `changed variable \`${key}\` ${from ?? '(unset)'} -> ${to ?? '(unset)'}` });
  }

  return {
    before: {
      id: options.beforeId ?? before?.id ?? before?.layout_id ?? null,
      name: before?.name ?? null,
      label: options.beforeLabel ?? before?.name ?? null,
      elementCount: beforeRows.length,
    },
    after: {
      id: options.afterId ?? after?.id ?? after?.layout_id ?? null,
      name: after?.name ?? null,
      label: options.afterLabel ?? after?.name ?? null,
      elementCount: afterRows.length,
    },
    counts,
    changeCount: changes.length + variableChanges.length,
    changedPaths,
    changes,
    variableChanges,
    unchanged: changes.length === 0 && variableChanges.length === 0,
  };
}

/**
 * A human-readable diff. This is what lands in `diff.md` next to the submitted layout, and what
 * `gui_handoff_list` returns to the agent, so both read the same sentences.
 */
export function formatDiffMarkdown(diff, options = {}) {
  const lines = [];
  const title = options.title ?? 'Layout diff';
  lines.push(`# ${title}`);
  lines.push('');
  const before = diff.before ?? {};
  const after = diff.after ?? {};
  lines.push(`- before: \`${before.id ?? '(none)'}\`${before.label ? ` (${before.label})` : ''}, ${before.elementCount ?? '?'} elements`);
  lines.push(`- after:  \`${after.id ?? '(none)'}\`${after.label ? ` (${after.label})` : ''}, ${after.elementCount ?? '?'} elements`);
  if (options.reason) lines.push(`- reason: ${options.reason}`);
  lines.push('');
  if (diff.unchanged) {
    lines.push('No element, geometry, sprite or variable changed between the two revisions.');
    lines.push('');
    return lines.join('\n');
  }
  const order = ['added', 'removed', 'moved', 'resized', 'reparented', 'renamed', 'kind', 'sprite', 'field'];
  const byChange = new Map();
  for (const change of diff.changes ?? []) {
    byChange.set(change.change, [...(byChange.get(change.change) ?? []), change]);
  }
  for (const key of order) {
    const entries = byChange.get(key);
    if (!entries || entries.length === 0) continue;
    lines.push(`## ${key} (${entries.length})`);
    lines.push('');
    for (const entry of entries) lines.push(`- ${entry.summary}${entry.path ? `   \`${shortPath(entry.path)}\`` : ''}`);
    lines.push('');
  }
  for (const [key, entries] of byChange) {
    if (order.includes(key)) continue;
    lines.push(`## ${key} (${entries.length})`);
    lines.push('');
    for (const entry of entries) lines.push(`- ${entry.summary}`);
    lines.push('');
  }
  if ((diff.variableChanges ?? []).length > 0) {
    lines.push(`## variables (${diff.variableChanges.length})`);
    lines.push('');
    for (const entry of diff.variableChanges) lines.push(`- ${entry.summary}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** One line: the counts, for a header or a log. */
export function summariseDiff(diff) {
  if (diff.unchanged) return 'no changes';
  const parts = Object.entries(diff.counts ?? {}).map(([key, count]) => `${count} ${key}`);
  if ((diff.variableChanges ?? []).length > 0) parts.push(`${diff.variableChanges.length} variable`);
  return `${diff.changeCount} change(s): ${parts.join(', ')}`;
}

export default { diffLayouts, formatDiffMarkdown, summariseDiff, indexLayout, positionOf, sizeOf, spriteOf };
