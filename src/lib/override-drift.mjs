//------------------------------------------------------------------------------------
// override-drift.mjs -- Part of RStellarisGui
//
// THE ANTI-DRIFT WORKFLOW FOR A VANILLA OVERRIDE.
//
// Overriding a vanilla `.gui` is a legitimate, proven technique - it is the ONLY way a mod's
// elements reach a screen the engine opens for its own reasons, because there is no script effect
// that opens a window (see the `script-routes-to-a-window` knowledge topic). Two overrides ship on
// the reference machine and both use one pattern:
//
//   * `<mods>\aerospace_carrier\interface\fleet_view.gui` - 2398 lines against the
//     vanilla file's 2355. A line-level comparison finds **0 vanilla lines removed** and 43 lines
//     added: the vanilla file, byte for byte, plus one delimited block spliced into the vanilla
//     `bottom` container. Its header says which file, which version (`interface/fleet_view.gui,
//     4.4.6`), what was added (`aerospace_carrier_bridge_bar`) and what to do about a version
//     change (`Re-copy the vanilla file when the game version changes.`).
//   * `<mods>\geocentric_origin\interface\planet_view.gui` - 8502 lines against 8483,
//     the largest file in the install, with the same "re-copy on version change" note in its head.
//
// So the pattern is: COPY the base, ADD inside a named container, RECORD the base. The risk is not
// that an override is fragile by nature - it is that the base MOVES and nobody notices. That is a
// mechanical problem, and this module answers it mechanically:
//
//   * did the base move? (the recorded `sha256` against the vanilla file on disk now)
//   * WHAT moved - which elements the current vanilla file declares that the override does not,
//     and which elements the override declares that vanilla never did (its own additions)
//   * is each addition still spliced into a container that EXISTS in the current vanilla file
//   * did the override MODIFY vanilla elements rather than only adding (a supportable but
//     different thing, and the case an ascension-perk slot mod needs: see below)
//
// WHY `changed` MATTERS AS MUCH AS `added`. The classic "more ascension perk slots" mods do not add
// elements to `interface/ascension_perks_view.gui` - they CHANGE NUMBERS in it. The screen's
// capacity lives in that file and nowhere else:
//
//   :85   containerWindowType "perks_list_box"    size = { width = 500 height = 448 }
//   :95   smoothListboxType   "ascension_perks_list"  size = { x = 480 y = 433 }
//   :127  gridBoxType         "ascension_perks_grid"  max_slots_horizontal = 1
//                                                     slotsize = { width = 470 height = 86 }
//
// and every one of those containers is ENGINE-POPULATED (0 nested elements in the whole install -
// see the `engine-populated-containers` topic), with the file saying so itself at `:107`:
// "Actual height is set in code depending on how many APs the category has". The ITEMS come from
// `common/ascension_perks/`; how many of them are REACHABLE comes from those four numbers. The
// Stellaris wiki states the same thing from the other side, of the tradition screen:
// "Without modding this file, new Tradition Groups as well as new Traditions can't be made visible
// in the UI." (Ascension Perk selection menu UI file is `ascension_perks_view.gui`.)
//
// So a drift report that only counted ADDED elements would report "no changes" about an override
// whose entire purpose is the four numbers above. `changed` is not a nicety here; it is the case.
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License as published by the Free Software Foundation, either version 3
// of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { hashFile } from './emit.mjs';
import { parseGuiText } from './layout.mjs';
import { kindSpec } from './kinds.mjs';

/** Rules this module reports, folded into `validate.mjs`'s tables like the component rules. */
export const DRIFT_RULE_SEVERITY = {
  'override-base-moved': 'warning',
  'override-base-unrecorded': 'warning',
  'override-vanilla-content-missing': 'error',
  'override-splice-container-missing': 'error',
  'override-modifies-vanilla-element': 'info',
  'override-unsupported-version': 'warning',
};

export const DRIFT_RULE_DESCRIPTIONS = {
  'override-base-moved':
    'the `sha256` the override records for its vanilla base is not the hash of the vanilla file on disk now, so the base moved (a game patch) and the copy is stale',
  'override-base-unrecorded':
    'the override carries no `vanilla source sha256` line, so drift cannot be detected mechanically - re-emit it through `gui_emit_override`, which writes one',
  'override-vanilla-content-missing':
    'the current vanilla file declares elements the override does not, so those elements are GONE from the game for every mod in the load order while this override is installed',
  'override-splice-container-missing':
    "an element the override added is nested in a container the current vanilla file no longer declares, so the addition is no longer where the mod put it",
  'override-modifies-vanilla-element':
    'the override changes fields on an element the vanilla file also declares, rather than only adding. This is a normal and often necessary technique (an ascension-slot mod does exactly this to the perk list\'s sizes), and it is reported so it is a DECISION and not a surprise',
  'override-unsupported-version':
    "the mod's `descriptor.mod` `supported_version` does not cover the install's version",
};

/** The `<stem>.gui` / `interface/x.gui` path a mod file occupies in its own tree. */
function modRelativePath(overriddenPath, vanillaPath) {
  const overriddenName = basename(overriddenPath);
  const vanillaName = basename(vanillaPath);
  return { overriddenName, vanillaName, sameName: overriddenName.toLowerCase() === vanillaName.toLowerCase() };
}

/** The `sha256` an override records in its own header, or null. */
export function readRecordedBaseHash(text) {
  const match = /^#\s*vanilla source sha256:\s*([0-9a-fA-F]{64})\s*$/m.exec(text);
  return match ? match[1].toLowerCase() : null;
}

/** The `supported_version` of the mod that owns this file, or null. */
export function readModSupportedVersion(filePath) {
  let directory = dirname(filePath);
  for (let depth = 0; depth < 6 && directory; depth += 1) {
    const descriptor = join(directory, 'descriptor.mod');
    if (existsSync(descriptor)) {
      const text = readFileSync(descriptor, 'utf8');
      const match = /^\s*supported_version\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(text);
      return { path: descriptor, supportedVersion: match ? match[1].trim() : null };
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

/** The install's own version, from `launcher-settings.json`. */
export function readInstallVersion(gameRoot) {
  try {
    const settings = JSON.parse(readFileSync(join(gameRoot, 'launcher-settings.json'), 'utf8'));
    return String(settings.rawVersion ?? 'unknown');
  } catch {
    return null;
  }
}

/** Does a `supported_version` glob (`v4.4.*`) cover a version (`v4.4.6`)? */
export function versionCovers(supported, actual) {
  if (!supported || !actual) return null;
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = `^${escape(String(supported)).split('\\*').join('.*')}$`;
  try {
    return new RegExp(pattern).test(String(actual));
  } catch {
    return null;
  }
}

/**
 * Every element in a parsed `.gui`, keyed by name, with a signature of the fields that define it.
 *
 * The signature is deliberately built from the fields an override is FOR - position, size, the
 * grid/slot/scroll fields - rather than from the whole node, so the report says "you changed
 * `perks_list_box`'s size from 500x448 to 700x520" instead of a blob diff nobody reads.
 */
export function elementIndex(text, fileKey) {
  const parsed = parseGuiText(text, fileKey);
  const index = new Map();
  const walk = (node, parent, depth) => {
    if (!node || typeof node !== 'object') return;
    if (node.name) {
      index.set(String(node.name), {
        name: String(node.name),
        kind: kindSpec(node.kind ?? node.type)?.kind ?? String(node.kind ?? node.type ?? 'unknown'),
        parent: parent ? String(parent) : null,
        depth,
        size: node.size ? { width: node.size.width ?? null, height: node.size.height ?? null } : null,
        position: node.position ? { x: node.position.x ?? null, y: node.position.y ?? null } : null,
        // The fields an override typically changes on an engine-populated container.
        shape: {
          slotSize: node.slotSize ?? node.slotsize ?? null,
          max_slots_horizontal: node.max_slots_horizontal ?? null,
          max_slots_vertical: node.max_slots_vertical ?? null,
          spacing: node.spacing ?? null,
          format: node.format ?? null,
          scrollbartype: node.scrollbartype ?? null,
        },
        fieldCount: Object.keys(node).length,
        children: (node.children ?? []).map((child) => String(child.name ?? '')).filter(Boolean),
      });
    }
    for (const child of node.children ?? []) walk(child, node.name ?? parent, parent ? depth + 1 : depth + 1);
  };
  for (const root of parsed.containers ?? []) walk(root, null, 0);
  return { parsed, index };
}

/** `{ width, height }` from either spelling, as a comparable string. */
function sizeOf(entry) {
  if (!entry?.size) return null;
  const width = entry.size.width ?? entry.size.x ?? null;
  const height = entry.size.height ?? entry.size.y ?? null;
  if (width === null && height === null) return null;
  return `${width ?? '?'}x${height ?? '?'}`;
}

function shapeOf(entry) {
  if (!entry?.shape) return '';
  return Object.entries(entry.shape)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${typeof value === 'object' ? `${value.width ?? '?'}x${value.height ?? '?'}` : value}`)
    .join(' ');
}

/**
 * Analyse one override against the vanilla file it replaces.
 *
 * @param {string} overriddenPath the mod's copy (read-only; never written)
 * @param {string} vanillaPath the install's file (read-only; never written)
 * @param {{gameRoot?: string}} [options]
 */
export function analyseOverrideDrift(overriddenPath, vanillaPath, options = {}) {
  if (!existsSync(overriddenPath)) throw new Error(`no such override file: ${overriddenPath}`);
  if (!existsSync(vanillaPath)) throw new Error(`no such vanilla file: ${vanillaPath}`);

  const findings = [];
  const push = (rule, message, suggestedFix, extra = {}) => findings.push({
    rule,
    severity: DRIFT_RULE_SEVERITY[rule] ?? 'warning',
    element: extra.element ?? basename(overriddenPath),
    path: overriddenPath,
    message,
    suggestedFix,
    ...extra,
  });

  const overridden = hashFile(overriddenPath);
  const vanilla = hashFile(vanillaPath);
  const overriddenText = readFileSync(overriddenPath, 'utf8');
  const vanillaText = readFileSync(vanillaPath, 'utf8');
  const recorded = readRecordedBaseHash(overriddenText);
  const names = modRelativePath(overriddenPath, vanillaPath);

  // ---------------------------------------------------------------- did the base move
  const baseMoved = recorded === null ? null : recorded !== vanilla.sha256;
  if (recorded === null) {
    push(
      'override-base-unrecorded',
      `${overriddenPath} records no \`# vanilla source sha256:\` line, so whether its base still matches cannot be decided by reading it. ` +
        `The vanilla file on disk now is ${vanilla.lines} lines, sha256 ${vanilla.sha256.slice(0, 16)}...`,
      're-emit this override through `gui_emit_override` (which writes the header) or add the line by hand; then re-run.',
      { vanillaSha256: vanilla.sha256 },
    );
  } else if (baseMoved) {
    push(
      'override-base-moved',
      `The base MOVED. This override records vanilla sha256 ${recorded.slice(0, 16)}... but ${vanillaPath} is now ` +
        `${vanilla.lines} lines, sha256 ${vanilla.sha256.slice(0, 16)}... (recorded base ${overridden.lines} lines, this copy). ` +
        'Anything the vanilla file changed since is either missing from this copy or present in it in the old form.',
      'diff the two files, re-copy the current vanilla file, and re-apply the additions - or use `gui_emit_files { apply_to }` ' +
        'to re-splice the edits into the new base, which keeps every untouched line byte-identical.',
      { recordedSha256: recorded, vanillaSha256: vanilla.sha256 },
    );
  }

  // ---------------------------------------------------------------- what the override adds and loses
  const theirs = elementIndex(overriddenText, overriddenPath);
  const ours = elementIndex(vanillaText, vanillaPath);
  const added = [...theirs.index.keys()].filter((name) => !ours.index.has(name));
  const missing = [...ours.index.keys()].filter((name) => !theirs.index.has(name));
  const changed = [];
  for (const [name, entry] of theirs.index) {
    const base = ours.index.get(name);
    if (!base) continue;
    const sizeWas = sizeOf(base);
    const sizeNow = sizeOf(entry);
    const shapeWas = shapeOf(base);
    const shapeNow = shapeOf(entry);
    const kindWas = base.kind;
    const kindNow = entry.kind;
    if (sizeWas !== sizeNow || shapeWas !== shapeNow || kindWas !== kindNow) {
      changed.push({ name, kind: entry.kind, size: { from: sizeWas, to: sizeNow }, shape: { from: shapeWas, to: shapeNow }, kindChange: kindWas === kindNow ? null : { from: kindWas, to: kindNow } });
    }
  }

  if (missing.length > 0) {
    push(
      'override-vanilla-content-missing',
      `${missing.length} element(s) the CURRENT vanilla file declares are not in this override, so they are gone from the ` +
        `game for every mod in the load order: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? `, ... (${missing.length - 12} more)` : ''}. ` +
        'An override replaces the file; it does not merge.',
      're-copy the current vanilla file and re-apply this mod\'s edits to it.',
      { missingElements: missing },
    );
  }
  if (changed.length > 0) {
    // DIRECTION IS STATED, not implied: `vanilla -> your copy`. An earlier revision printed
    // "your copy changes X from A to B" with the two the other way round, which reads as "the mod
    // changed it" when the finding is about the VANILLA file having moved under the mod.
    const shown = changed
      .slice(0, 8)
      .map((entry) => {
        const parts = [];
        if (entry.size.from !== entry.size.to) parts.push(`size vanilla ${entry.size.from} -> your copy ${entry.size.to}`);
        if (entry.shape.from !== entry.shape.to) parts.push(`shape vanilla ${entry.shape.from || '(none)'} -> your copy ${entry.shape.to || '(none)'}`);
        if (entry.kindChange) parts.push(`kind vanilla ${entry.kindChange.from} -> your copy ${entry.kindChange.to}`);
        return `${entry.name} (${parts.join('; ')})`;
      })
      .join(', ');
    push(
      'override-modifies-vanilla-element',
      `${changed.length} element(s) this override declares differ from the CURRENT vanilla file: ${shown}${changed.length > 8 ? `, ... (${changed.length - 8} more)` : ''}. ` +
        'This is the DECISION this override encodes, not a defect - for a screen whose capacity lives in the `.gui` it is the whole point ' +
        "(an ascension-perk slot mod enlarges the perk list's sizes) - and it is also the part a base move invalidates first, because the " +
        'old numbers are now written over the new ones.',
      'after a base move, re-apply these numbers onto the new base instead of keeping your old ones; the direction above says which side is which.',
      { changedElements: changed },
    );
  }

  // ---------------------------------------------------------------- are the splices still anchored
  //
  // A mod's addition may be nested inside ANOTHER of the mod's additions - that is normal (the
  // reference mods splice a bar container into the vanilla `bottom` and the buttons into that bar).
  // Only a parent that is in NEITHER the vanilla file NOR this override's own additions is a lost
  // splice point: it means the vanilla container the addition hangs off was renamed or removed.
  const addedSet = new Set(added);
  const splicePoints = [];
  for (const name of added) {
    const entry = theirs.index.get(name);
    const parent = entry?.parent ?? null;
    const parentInVanilla = parent === null ? true : ours.index.has(parent);
    const parentIsOwnAddition = parent !== null && addedSet.has(parent);
    const parentExists = parentInVanilla || parentIsOwnAddition;
    splicePoints.push({
      element: name,
      container: parent,
      containerExists: parentExists,
      containerIsOwnAddition: parentIsOwnAddition,
      depth: entry?.depth ?? null,
    });
    if (!parentExists) {
      push(
        'override-splice-container-missing',
        `\`${name}\` is nested in \`${parent}\`, which neither the CURRENT vanilla file nor this override declares anywhere else. ` +
          'The addition is no longer where this mod put it - the engine reads a container by name, so a renamed or removed parent moves or drops it.',
        `re-splice \`${name}\` into a container that exists (see \`splicePoints[].container\`), or restore the parent in this override.`,
        { element: name, container: parent },
      );
    }
  }

  // ---------------------------------------------------------------- version signals
  const modVersion = readModSupportedVersion(overriddenPath);
  const installVersion = options.gameRoot ? readInstallVersion(options.gameRoot) : null;
  const versionOk = versionCovers(modVersion?.supportedVersion, installVersion);

  return {
    overridden: { path: overriddenPath, ...overridden },
    vanilla: { path: vanillaPath, ...vanilla },
    sameFileName: names.sameName,
    baseHash: { recorded, current: vanilla.sha256, moved: baseMoved },
    elements: {
      added,
      missing,
      changed,
      unchangedCount: theirs.index.size - added.length - changed.length,
    },
    splicePoints,
    version: {
      install: installVersion,
      modSupported: modVersion?.supportedVersion ?? null,
      modDescriptor: modVersion?.path ?? null,
      covered: versionOk,
    },
    findings,
    byRule: findings.reduce((counts, finding) => ({ ...counts, [finding.rule]: (counts[finding.rule] ?? 0) + 1 }), {}),
    /** The single line a caller should act on. */
    verdict:
      findings.some((finding) => finding.severity === 'error')
        ? 'stale: re-copy the vanilla base and re-apply the edits'
        : baseMoved === false
          ? 'current: the recorded base hash matches the vanilla file on disk'
          : baseMoved === null
            ? 'undetectable: the override records no base hash'
            : 'base moved, nothing lost: the current vanilla content is all present, so re-copy when convenient',
  };
}

export default {
  DRIFT_RULE_SEVERITY,
  DRIFT_RULE_DESCRIPTIONS,
  analyseOverrideDrift,
  elementIndex,
  readRecordedBaseHash,
  readModSupportedVersion,
  readInstallVersion,
  versionCovers,
};
