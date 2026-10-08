//------------------------------------------------------------------------------------
// visibility.mjs -- Part of RStellarisGui
//
// A CONTROL'S VISIBILITY CAN LIVE OUTSIDE THE .gui (GAP-12).
//
// An `effectbuttonType` does not carry its own visibility. It carries `effect = "<key>"`, that key is
// a top-level block in `common/button_effects/*.txt`, and THAT block's `potential = { ... }` decides
// whether the button is drawn at all. A `potential` is a statement about the CURRENT SCOPE - and a
// `custom_gui` window's scope is decided by HOW THE PLAYER GOT THERE, not by the `.gui`. So a
// potential that only answers in one scope makes a control that is present, correctly laid out and
// clickable-in-principle simply not appear on one of the routes into the same window.
//
// The mod this project was built against hit it for real: `potential = { is_scope_type = planet ... }`
// on every panel button, reachable from the planet panel (planet scope, passed) and from the
// sidebar's own navigation rows (country scope, failed). 89 of 105 buttons hid. A grep was the only
// tool that found it, because the condition is not in the `.gui` at all and a `potential` with a
// wrong-scope trigger is VALID script: it parses, it is accepted, it simply answers `false`.
//
// What this module provides, in the order that helps most:
//
//   1. THE TABLE (`visibilityTableFor`) - every element carrying an `effect`, joined to its
//      `button_effects` entry, with that entry's `potential`, the scope it demands and whether the
//      window's entry points guarantee that scope - EVEN WHEN THERE IS NO FINDING. A findings-only
//      report cannot show a condition that evaluates TRUE half the time; a table can be read.
//   2. THE RULE (`visibility-scope-dependent`) - an element inside a window whose effect's potential
//      tests `is_scope_type`: the control VANISHES rather than misbehaving.
//   3. THE SIBLING RULE (`visibility-flag-scope-dependent`) - the same class one step out: a
//      `has_planet_flag` / `has_country_flag` potential, which the engine answers from the scope the
//      button is drawn in. The fix that worked on the mod was a GLOBAL flag, the only kind of flag
//      the engine answers identically in every scope.
//
// The scope guarantee is deliberately a caller input rather than a guess. Nothing in a `.gui` file
// states which scopes a window can be opened in, the plugin does not read event `trigger` blocks, and
// a wrong guess here would be exactly the kind of confident-but-false finding this project refuses.
// So `scopeGuarantees` is `{ "<window>": "<scope>" }` from the caller (or a derived hint), and a
// window with no guarantee is reported as `not-established` - which is the honest answer AND the
// risky case, because an event window's scope is whatever the event was fired with.
//
// This program is free software: you can redistribute it and/or modify it under the terms of
// the GNU Affero General Public License as published by the Free Software Foundation, either
// version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parseParadox } from './paradox.mjs';
import { readTextFile } from './paths.mjs';

/**
 * Severity of the visibility rules.
 *
 * `visibility-scope-dependent` is an ERROR for a window an event names with `custom_gui`, because on
 * that window the control is reachable from more than one scope by construction - it is the exact
 * defect that shipped and was reported by a player. For a window the checker merely inferred, it is a
 * WARNING: this project must not call a shipped vanilla file broken (the same discipline
 * `custom-gui-contract-missing` follows).
 */
export const VISIBILITY_SEVERITY = {
  'visibility-scope-dependent': 'error',
  'visibility-flag-scope-dependent': 'warning',
  'visibility-potential-scope-dependent': 'info',
};

export const VISIBILITY_DESCRIPTIONS = {
  'visibility-scope-dependent':
    'an `effect` this window draws names a `common/button_effects/` entry whose `potential` tests `is_scope_type`, ' +
    'so the control is DRAWN OR NOT by the scope the window was opened in - the sidebar is immune, your buttons are not (GAP-12)',
  'visibility-flag-scope-dependent':
    'the same mechanism one step out: a potential gated on a `has_planet_flag` / `has_country_flag` (and on no ' +
    '`is_scope_type`) is answered from the DRAWING scope, so the flag decides the route as well as the state (GAP-12)',
  'visibility-potential-scope-dependent':
    'the effect is harmless HERE because a caller guaranteed this window\'s scope; recorded so the guarantee stays visible',
};

/**
 * The `is_scope_type` values the engine accepts, and the scope each one DEMANDS.
 *
 * The full set is documented in the knowledge base (`is_scope_type` is used 289 times in vanilla).
 * Only the ones an event window can plausibly be opened in are classified; anything else gets
 * `other:<value>`, which is still reported (a demand this project cannot classify is not a demand it
 * may ignore).
 */
const SCOPE_TYPE_DEMANDS = new Map([
  ['planet', 'planet'],
  ['country', 'country'],
  ['ship', 'ship'],
  ['fleet', 'fleet'],
  ['pop', 'pop'],
  ['leader', 'leader'],
  ['army', 'army'],
  ['species', 'species'],
  ['starbase', 'starbase'],
  ['megastructure', 'megastructure'],
  ['galactic_object', 'galactic_object'],
  ['sector', 'sector'],
  ['deposit', 'deposit'],
  ['ambient_object', 'ambient_object'],
  ['design', 'design'],
  ['pop_faction', 'pop_faction'],
  ['war', 'war'],
  ['alliance', 'alliance'],
  ['observer', 'observer'],
  ['none', 'none'],
]);

/** `has_<scope>_flag` -> the scope the engine answers the flag from. */
const FLAG_SCOPE_PREFIXES = new Map([
  ['has_planet_flag', 'planet'],
  ['has_country_flag', 'country'],
  ['has_star_flag', 'galactic_object'],
  ['has_system_flag', 'galactic_object'],
  ['has_fleet_flag', 'fleet'],
  ['has_ship_flag', 'ship'],
  ['has_pop_flag', 'pop'],
  ['has_leader_flag', 'leader'],
  ['has_army_flag', 'army'],
  ['has_species_flag', 'species'],
  ['has_starbase_flag', 'starbase'],
  ['has_megastructure_flag', 'megastructure'],
  ['has_sector_flag', 'sector'],
  ['has_deposit_flag', 'deposit'],
]);

/** Triggers that only answer in one scope, without naming it in the key. */
const SCOPE_BOUND_TRIGGERS = new Map([
  ['is_colony', 'planet'],
  ['is_planet', 'planet'],
  ['is_capital', 'planet'],
  ['is_owned_by', 'planet'],
  ['is_country_type', 'country'],
  ['is_ai', 'country'],
  ['is_human', 'country'],
  ['is_subject', 'country'],
]);

/**
 * Flatten a parsed block into `{key, value, path}[]`, one entry per leaf or nested-keyword edge.
 *
 * A `potential` block is a trigger list, so every identifier that STARTS a construct is a trigger
 * name and everything after the `=` is its value: `potential = { is_scope_type = planet }` is one
 * trigger (`is_scope_type` = `planet`), and `potential = { owner = { is_ai = no } }` is `owner`
 * (whose value is a block) with `is_ai` inside it. Both shapes matter and both are collected.
 */
export function flattenTriggers(children, base = '') {
  const out = [];
  for (const child of children ?? []) {
    if (!child.key) continue;
    const path = base ? `${base}.${child.key}` : child.key;
    const isBlock = Array.isArray(child.children);
    out.push({ key: child.key, value: child.value, block: isBlock, path, line: child.line });
    if (isBlock) out.push(...flattenTriggers(child.children, path));
  }
  return out;
}

/** The first `potential` block of a `button_effects` entry, parsed. Multiple are ANDed by the engine. */
export function potentialBlockOf(entry) {
  const blocks = (entry?.children ?? []).filter((child) => child.key && child.key.toLowerCase() === 'potential');
  if (blocks.length === 0) return null;
  return blocks[0];
}

/**
 * Classify one `button_effects` entry's `potential` into what it demands of the drawing scope.
 *
 * @returns {{present: boolean, empty: boolean, text: string|null, line: number|null,
 *            demands: string[], flags: {trigger: string, scope: string}[],
 *            scopeBound: {trigger: string, scope: string}[], unconditional: boolean}}
 */
export function classifyPotential(entry) {
  const block = potentialBlockOf(entry);
  if (!block) {
    return {
      present: false,
      empty: false,
      text: null,
      line: null,
      demands: [],
      flags: [],
      scopeBound: [],
      unconditional: true,
    };
  }
  const triggers = flattenTriggers(block.children);
  const demands = [];
  const flags = [];
  const scopeBound = [];
  for (const trigger of triggers) {
    const key = trigger.key.toLowerCase();
    if (key === 'is_scope_type' && typeof trigger.value === 'string') {
      const demand = SCOPE_TYPE_DEMANDS.get(trigger.value.toLowerCase()) ?? `other:${trigger.value}`;
      if (!demands.includes(demand)) demands.push(demand);
      continue;
    }
    const flagScope = FLAG_SCOPE_PREFIXES.get(key);
    if (flagScope) {
      flags.push({ trigger: trigger.key, scope: flagScope });
      continue;
    }
    const bound = SCOPE_BOUND_TRIGGERS.get(key);
    if (bound) scopeBound.push({ trigger: trigger.key, scope: bound });
  }
  const empty = triggers.length === 0;
  return {
    present: true,
    empty,
    text: textOfBlock(block),
    line: block.line ?? entry.line ?? null,
    demands,
    flags,
    scopeBound,
    unconditional: empty,
  };
}

/** The block's own text, whitespace-collapsed, for quoting in a table or a message. */
function textOfBlock(block) {
  const parts = [];
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (child.key && Array.isArray(child.children)) {
        parts.push(`${child.key} = {`);
        walk(child);
        parts.push('}');
      } else if (child.key) {
        parts.push(`${child.key} = ${child.value}`);
      }
    }
  };
  walk(block);
  return parts.join(' ');
}

/**
 * The `common/button_effects` catalogue: every top-level key, with its file, line and classified
 * `potential`.
 *
 * @param {{effectFiles?: string[], effectRoots?: string[]}} sources
 * @returns {{effects: Map<string, object>, files: string[]}}
 */
export function buildButtonEffectAnalysis(sources = {}) {
  const files = new Set();
  for (const file of sources.effectFiles ?? []) {
    if (typeof file === 'string' && existsSync(file)) files.add(file);
  }
  for (const root of sources.effectRoots ?? []) {
    if (typeof root !== 'string' || root === '') continue;
    if (/\.txt$/i.test(root)) {
      if (existsSync(root)) files.add(root);
      continue;
    }
    // Accept the `common/button_effects` folder itself, or a root containing it.
    for (const directory of [root, join(root, 'common', 'button_effects')]) {
      if (!existsSync(directory)) continue;
      for (const name of readdirSync(directory)) {
        const candidate = join(directory, name);
        try {
          if (statSync(candidate).isFile() && name.toLowerCase().endsWith('.txt')) files.add(candidate);
        } catch {
          /* unreadable entry: skip rather than fail the whole analysis */
        }
      }
    }
  }

  const effects = new Map();
  for (const file of [...files].sort()) {
    let parsed;
    try {
      parsed = parseParadox(readTextFile(file));
    } catch {
      continue;
    }
    for (const entry of parsed.roots) {
      if (!entry.key || entry.key.startsWith('@')) continue;
      const classified = classifyPotential(entry);
      const record = {
        name: entry.key,
        file,
        line: entry.line ?? null,
        isBlock: Array.isArray(entry.children),
        potential: classified,
      };
      if (!effects.has(entry.key)) effects.set(entry.key, record);
    }
  }
  return { effects, files: [...files].sort(), directories: dirnameOf(files) };
}

function dirnameOf(files) {
  const directories = new Set();
  for (const file of files) directories.add(dirname(file));
  return [...directories].sort();
}

/**
 * The per-element `effect` -> `potential` table.
 *
 * @param {object[]} boxes `computeLayout(layout).boxes`
 * @param {object} options
 *   `effects` from `buildButtonEffectAnalysis`, `customGuiWindows` (windows an event names with
 *   `custom_gui`), `windows` (window name by box, defaulting to the nearest top-level container),
 *   `scopeGuarantees` (`{ "<window>": "planet" }`).
 * @returns {{rows: object[], summary: object}}
 */
export function visibilityTableFor(boxes, options = {}) {
  const effects = options.effects ?? new Map();
  const customGui = new Set(options.customGuiWindows ?? []);
  const guarantees = options.scopeGuarantees ?? {};
  const windowOf = options.windowOf ?? (() => null);

  const rows = [];
  for (const box of boxes ?? []) {
    const effect = box.node?.effect;
    if (typeof effect !== 'string' || effect === '') continue;
    const windowName = windowOf(box) ?? null;
    const record = effects.get(effect) ?? null;
    const potential = record?.potential ?? null;
    const guaranteesWindow = windowName ? guarantees[windowName] : null;
    const guaranteed = typeof guaranteesWindow === 'string' && guaranteesWindow !== '' ? guaranteesWindow : null;
    const demanded = potential ? [...potential.demands] : [];
    // A demand the caller's guarantee satisfies is not a risk for THIS window; anything else is,
    // including "no guarantee was established", which is the event-window case by construction.
    const unmet = demanded.filter((scope) => guaranteed === null || guaranteed !== scope);
    const guaranteedHere = demanded.length > 0 && unmet.length === 0;
    rows.push({
      window: windowName,
      isCustomGuiWindow: windowName ? customGui.has(windowName) : false,
      path: box.path,
      element: box.name ?? null,
      kind: box.kind ?? null,
      effect,
      effectDefined: record !== null,
      effectAt: record ? { file: record.file, line: record.line } : null,
      potential: potential ? potential.text : null,
      potentialAt: potential?.present ? { file: record.file, line: potential.line } : null,
      potentialPresent: potential ? potential.present : false,
      demandedScope: demanded,
      flagTriggers: potential ? potential.flags.map((entry) => entry.trigger) : [],
      flagScopes: potential ? [...new Set(potential.flags.map((entry) => entry.scope))] : [],
      unconditional: potential ? potential.unconditional : false,
      scopeGuarantee: guaranteed,
      scopeGuaranteed: guaranteedHere,
      scopeDemandMet: unmet.length === 0,
      unmetScopes: unmet,
    });
  }

  const demandCounts = {};
  for (const row of rows) {
    const key = row.demandedScope.length > 0 ? row.demandedScope.join('+') : row.flagScopes.length > 0 ? `flag:${row.flagScopes.join('+')}` : 'none';
    demandCounts[key] = (demandCounts[key] ?? 0) + 1;
  }
  const summary = {
    elementsWithEffect: rows.length,
    effectsWithPotential: rows.filter((row) => row.potentialPresent).length,
    effectsUnconditional: rows.filter((row) => row.unconditional).length,
    effectsUndefined: rows.filter((row) => !row.effectDefined).length,
    demandingScope: rows.filter((row) => row.demandedScope.length > 0).length,
    demandingScopeUnmet: rows.filter((row) => row.unmetScopes.length > 0 && row.demandedScope.length > 0).length,
    // The sibling rule is for a flag-gated potential with NO scope test. A potential carrying both is
    // reported ONCE, under the scope rule, because that demand is the one that cannot be satisfied by
    // any route: a `has_planet_flag` cannot pass in country scope either, but a global-flag fix
    // removes the scope test and the flag together. Two findings for one line would be noise.
    flagScopeSpecific: rows.filter((row) => row.flagScopes.length > 0 && row.demandedScope.length === 0).length,
    scopeSpecificFlags: rows.filter((row) => row.flagScopes.length > 0).length,
    windowsWithoutGuarantee: [
      ...new Set(rows.filter((row) => row.scopeGuarantee === null).map((row) => row.window).filter(Boolean)),
    ].sort(),
    byDemand: demandCounts,
    note:
      '`flagScopeSpecific` counts the flag-only potentials; a potential carrying BOTH `is_scope_type` and a ' +
      'scope-specific flag is counted under `demandingScope` and reported once, by the scope rule.',
  };
  return { rows, summary };
}

/**
 * The findings for the risky patterns, derived from a table `visibilityTableFor` produced.
 *
 * Severity follows the contract checker's discipline: an ERROR when an event names the window
 * (`custom_gui`), because on that window the control is reachable from more than one scope by
 * construction; a WARNING otherwise.
 */
export function visibilityFindings(rows, options = {}) {
  const customGui = new Set(options.customGuiWindows ?? []);
  const findings = [];
  for (const row of rows ?? []) {
    const explicit = row.window ? customGui.has(row.window) || row.isCustomGuiWindow : false;
    const where = row.path;
    const base = {
      where,
      path: row.path,
      element: row.element ?? undefined,
      kind: row.kind ?? undefined,
      window: row.window,
      effect: row.effect,
      potential: row.potential,
      potentialAt: row.potentialAt,
      demandedScope: row.demandedScope,
      scopeGuarantee: row.scopeGuarantee,
    };
    if (row.demandedScope.length > 0) {
      const scopeList = row.demandedScope.join(' / ');
      if (row.scopeGuaranteed) {
        findings.push({
          ...base,
          rule: 'visibility-potential-scope-dependent',
          severity: 'info',
          message:
            `\`${row.element ?? row.path}\` is drawn by the \`${row.effect}\` button effect, whose \`potential\` ` +
            `demands a \`${scopeList}\` scope, and the caller guaranteed \`${row.window}\` is only ever entered in ` +
            `\`${row.scopeGuarantee}\` scope, so the control is not at risk HERE. It is recorded because the guarantee ` +
            'is the whole reason the scope test is safe: if the window gains another entry point, this becomes an error.',
          suggestedFix:
            'when this window gains a second route in (a navigation option, another event), move the test into the ' +
            '`effect` with `if = { limit = { is_scope_type = ... } }` and gate the `potential` on a GLOBAL flag.',
        });
        continue;
      }
      findings.push({
        ...base,
        rule: 'visibility-scope-dependent',
        severity: explicit ? 'error' : 'warning',
        message:
          `\`${row.element ?? row.path}\` is an \`${row.kind ?? 'effect'}Type\` inside \`${row.window ?? 'a window'}\`, ` +
          `and its visibility is not in this .gui at all: \`effect = "${row.effect}"\` names a ` +
          `common/button_effects/ entry whose \`potential\` demands a \`${scopeList}\` scope` +
          (row.scopeGuarantee
            ? `, while this window is entered in \`${row.scopeGuarantee}\` scope`
            : ', and no entry-point scope was established for this window') +
          `. A \`potential\` is a statement about the CURRENT SCOPE, and a custom_gui window's scope is decided by HOW ` +
          'THE PLAYER GOT THERE - so this control is DRAWN OR NOT BY ROUTE and no geometric rule can see it. Measured ' +
          'on the mod this rule came from: 89 of 105 buttons hid outside a planet scope, while the engine-drawn option ' +
          'sidebar stayed (no button_effects entry can reach it).',
        suggestedFix:
          `gate the \`potential\` on a GLOBAL flag (the only flag the engine answers identically in every scope) and ` +
          `pick the scope at run time: \`potential = { has_global_flag = <flag> } effect = { if = { limit = { is_scope_type = ` +
          `${row.demandedScope[0]} } <scope body> } else = { <other body> } }\`. Seed the flag in the init AND in every opener - ` +
          'on_game_start_country does not re-run on a loaded save.',
      });
      continue;
    }
    if (row.flagScopes.length > 0 && !row.unconditional && row.demandedScope.length === 0) {
      const scopeList = row.flagScopes.join(' / ');
      findings.push({
        ...base,
        rule: 'visibility-flag-scope-dependent',
        severity: explicit ? 'warning' : 'info',
        message:
          `\`${row.element ?? row.path}\` is drawn by the \`${row.effect}\` button effect, whose \`potential\` tests ` +
          `${row.flagTriggers.map((name) => `\`${name}\``).join(' / ')} - a flag the engine answers from the scope the ` +
          `button is drawn in (a \`${scopeList}\` flag). The flag therefore decides the ROUTE as well as the state: the ` +
          'control disappears wherever the window is entered in another scope, which is the same failure as an ' +
          '`is_scope_type` potential one step out. The fix that worked on the mod this rule came from was a GLOBAL flag.',
        suggestedFix:
          'replace the scope-specific flag in the `potential` with a GLOBAL flag (set it wherever the state really ' +
          'changes), or move the scope-specific test into the `effect`.',
      });
    }
  }
  return findings;
}

/**
 * Parse a caller's `scopeGuarantees` input.
 *
 * Accepted shapes: `{ "<window>": "<scope>" }`, or an array of
 * `{ window, scope }` / `{ name, scope }` entries. Anything malformed is dropped rather than
 * guessed at, because a wrong guarantee is worse than no guarantee: it would silence the rule.
 */
export function normaliseScopeGuarantees(input) {
  const out = {};
  if (!input) return out;
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (!entry || typeof entry !== 'object') continue;
      const window = entry.window ?? entry.name ?? entry.container;
      const scope = entry.scope ?? entry.scope_type ?? entry.entered_in;
      if (typeof window === 'string' && window !== '' && typeof scope === 'string' && scope !== '') out[window] = scope;
    }
    return out;
  }
  if (typeof input === 'object') {
    for (const [window, scope] of Object.entries(input)) {
      if (typeof window === 'string' && window !== '' && typeof scope === 'string' && scope !== '') out[window] = scope;
    }
  }
  return out;
}

export default {
  VISIBILITY_SEVERITY,
  VISIBILITY_DESCRIPTIONS,
  buildButtonEffectAnalysis,
  classifyPotential,
  flattenTriggers,
  normaliseScopeGuarantees,
  potentialBlockOf,
  visibilityFindings,
  visibilityTableFor,
};
