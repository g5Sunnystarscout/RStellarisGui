//------------------------------------------------------------------------------------
// events.mjs -- Part of RStellarisGui
//
// CROSS-FILE checks: the event script and the .gui that draws it, read together.
//
// A `custom_gui` window is dismissed in exactly one way - an event option is chosen - so the
// navigation between panels IS the event graph, and the close button IS option 0. Both facts live
// in the gap between two files, which is why nothing that reads one file can see them:
//
//   `custom-gui-force-open`      `force_open = yes` combined with `custom_gui = "..."`.
//                                Measured over the install's own events/: 5563 events, 113 with
//                                `force_open`, 36 with `custom_gui`, and 0 with both. The
//                                combination is not known to be wrong; it is known to be unproven,
//                                and the trial mod spent a round on it. Warning, not error.
//
//   `custom-gui-option0-selfref` the FIRST option's effect fires the very event whose window was
//                                just dismissed. The engine's close control selects option 0
//                                (`selectedOption 0` in logs/game.log) and consumes the event BEFORE
//                                the option's effects run, so an option 0 that re-fires its own event
//                                closes the window and immediately re-opens it. If the effect chain
//                                guards on a flag, the pattern is the WORKING one (the close button's
//                                own button effect sets that flag, and it is the only code that runs
//                                earlier) - the finding then says so and stays at `info`.
//
//   `event-namespace-undeclared`  an event id written `<x>.<n>` in a file set that declares no
//                                `namespace = <x>`. Measured on 4.4.6, verbatim from error.log:
//
//                                  [event.cpp:1208]: Event zz_citystate.1 at  file: events/
//                                    zz_citystate_events.txt line: 42 has an invalid ID
//                                  [onaction.cpp:94]: OnAction "on_game_start_country" is
//                                    referencing an invalid ID: "zz_citystate.1"
//
//                                - the engine rejects the id AND the on_action that names it, so the
//                                hook never fires. The declaration is a top-level
//                                `namespace = <name>` root; the probe mod's own header records the
//                                defect it caught ("this line is REQUIRED and its absence was a real
//                                defect caught by run 1 of this probe, not a precaution") and the
//                                fixed file declares it above its first event.
//
// The custom-effect chain is followed, because that is how the fixed mod expresses it: option 0's
// `hidden_effect` calls `geocentric_unga_main_option_effect`, and that scripted effect is what
// either fires the event or consumes the close flag.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { parseParadox } from './paradox.mjs';

/** Event roots the engine understands. */
export const EVENT_KEYS = new Set([
  'country_event',
  'province_event',
  'planet_event',
  'fleet_event',
  'pop_event',
  'system_event',
  'observer_event',
  'event',
]);

const EVENT_CALL_KEYS = new Set([...EVENT_KEYS].map((key) => (key === 'event' ? 'event' : key)));
const FLAG_KEYS = new Set(['has_country_flag', 'has_global_flag', 'has_planet_flag', 'has_fleet_flag', 'set_country_flag', 'set_global_flag']);

/** Strip the quotes a Paradox value may carry. */
function unquote(value) {
  return typeof value === 'string' ? value.replace(/^"|"$/g, '') : value;
}

/** Children of an entry with the given key, case-insensitively. */
function childrenNamed(entry, key) {
  return (entry?.children ?? []).filter((child) => child.key && child.key.toLowerCase() === key);
}

/** The first child with the given key, or null. */
function childNamed(entry, key) {
  return childrenNamed(entry, key)[0] ?? null;
}

/**
 * Index every top-level scripted-effect / scripted-trigger definition in a file's text.
 *
 * @returns {Map<string, object>} lower-cased key -> the parsed entry
 */
export function indexScriptDefinitions(texts) {
  const out = new Map();
  for (const text of texts ?? []) {
    if (typeof text !== 'string' || text === '') continue;
    let parsed;
    try {
      parsed = parseParadox(text);
    } catch {
      continue;
    }
    for (const root of parsed.roots) {
      if (!root.key || !root.children) continue;
      const key = root.key.toLowerCase();
      // A scripted effect may be written as `name = { ... }` directly, or wrapped in
      // `scripted_effect = { name = ... }`-style containers, which the Paradox parser surfaces as
      // nested entries; both shapes are indexed by their own key.
      if (!out.has(key)) out.set(key, root);
      for (const child of root.children) {
        if (child.key && child.children && !out.has(child.key.toLowerCase())) out.set(child.key.toLowerCase(), child);
      }
    }
  }
  return out;
}

/**
 * Severity of the event-namespace rule.
 *
 * `event-namespace-undeclared` is a WARNING rather than an error, and the reason is the shape of
 * the check rather than the size of the consequence. The consequence is an ERROR-sized one - the
 * engine rejects the id and the on_action that names it, so the hook never fires - but a namespace
 * may be declared ANYWHERE in the loaded `events/` tree, not in the id's own file. Measured over
 * the install: 6,571 events, 200 `namespace =` declarations covering 118 distinct names, and ZERO
 * event ids whose namespace prefix is declared nowhere. The per-file reading is FALSE - 213 vanilla
 * events sit in a file that declares no namespace at all, e.g. all of `anomaly_events_4.txt`'s
 * `anomaly.5xxx` ids against `anomaly_events_1.txt:8` `namespace = anomaly`. So a caller who hands
 * over one mod's `events/` gets a warning that says exactly what was searched, and a caller who
 * hands over the whole load order gets a finding it should treat as the engine's own refusal.
 */
export const EVENT_NAMESPACE_SEVERITY = {
  'event-namespace-undeclared': 'warning',
};

export const EVENT_NAMESPACE_DESCRIPTIONS = {
  'event-namespace-undeclared':
    'an event id `<x>.<n>` whose namespace `<x>` is not declared by any supplied event file - the engine rejects the ' +
    'id (`event.cpp:1208 ... has an invalid ID`) and every `on_action` that names it ' +
    '(`onaction.cpp:94 OnAction ... is referencing an invalid ID`), so the hook silently never fires. The check is ' +
    'scoped to the files it was handed, because a namespace may be declared in ANY loaded `events/` file',
};

/**
 * The `namespace = <name>` declaration a set of event files makes.
 *
 * The declaration is a TOP-LEVEL root with no children - `namespace = astral_planes`
 * (`events/astral_planes_events.txt:5`) - and it may appear more than once in one file
 * (`anomaly_events_1.txt` declares `anomaly` at both :8 and :4875, which is why "declared before
 * the event" is not the rule either).
 *
 * @param {{path: string, text: string}[]} files
 * @returns {{name: string, file: string, line: number}[]}
 */
export function readNamespaceDeclarations(files = []) {
  const out = [];
  for (const file of files) {
    let parsed;
    try {
      parsed = parseParadox(String(file.text ?? ''));
    } catch {
      continue;
    }
    for (const root of parsed.roots ?? []) {
      if (!root.key || root.children) continue;
      if (root.key.toLowerCase() !== 'namespace') continue;
      const name = unquote(root.value);
      if (typeof name !== 'string' || name === '') continue;
      out.push({ name, file: file.path, line: root.line });
    }
  }
  return out;
}

/**
 * Every event id a set of event files declares, with the file and line it was written on.
 *
 * A file is read as an event file when its path is under `events/`, or when its top-level
 * constructs are events - the same test `filecheck.mjs` uses to decide what to hand to the event
 * pass. The id is the event root's OWN `id` child; a nested `id` inside a `create_point_of_interest`
 * block is a POI identifier, not an event id, and reading one as an event would be a false finding
 * (the install writes 8 `probe_search_poi.*` ids that way, all of them inside events).
 *
 * @param {{path: string, text: string}[]} files
 * @returns {{id: string, key: string, file: string, line: number, idLine: number}[]}
 */
export function readEventIds(files = []) {
  const out = [];
  for (const file of files) {
    const path = String(file.path ?? '');
    const underEvents = /\/events\//i.test(path.replace(/\\/g, '/'));
    let parsed;
    try {
      parsed = parseParadox(String(file.text ?? ''));
    } catch {
      continue;
    }
    const looksLikeEvents =
      underEvents || parsed.roots.some((root) => root.key && EVENT_KEYS.has(root.key.toLowerCase()) && root.children);
    if (!looksLikeEvents) continue;
    for (const root of parsed.roots) {
      if (!root.key || !EVENT_KEYS.has(root.key.toLowerCase()) || !root.children) continue;
      const idNode = root.children.find((child) => child.key && child.key.toLowerCase() === 'id' && !child.children);
      const id = unquote(idNode?.value);
      if (typeof id !== 'string' || id === '') continue;
      out.push({ id, key: root.key, file: path, line: root.line, idLine: idNode.line });
    }
  }
  return out;
}

/**
 * The event-namespace rule.
 *
 * ONE FINDING PER UNDECLARED NAMESPACE, not one per event: a missing declaration makes EVERY id
 * under that namespace invalid, and a mod with 40 events would otherwise produce 40 copies of one
 * defect. The finding names the first affected id, counts the rest, and lists the files.
 *
 * @param {{files?: {path: string, text: string}[]}} input
 * @returns {{findings: object[], counts: object, namespaces: object[], events: object[],
 *           undeclared: string[]}}
 */
export function analyseEventNamespaces(input = {}) {
  const files = input.files ?? [];
  const namespaces = readNamespaceDeclarations(files);
  const events = readEventIds(files);
  const declarations = new Set(namespaces.map((namespace) => namespace.name.toLowerCase()));
  const byNamespace = new Map();
  for (const event of events) {
    const dot = event.id.indexOf('.');
    if (dot <= 0) continue; // no namespace at all: not this rule's business
    const prefix = event.id.slice(0, dot);
    if (declarations.has(prefix.toLowerCase())) continue;
    const bucket = byNamespace.get(prefix) ?? [];
    bucket.push(event);
    byNamespace.set(prefix, bucket);
  }

  const findings = [];
  for (const [prefix, affected] of [...byNamespace.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const first = affected[0];
    const filesTouched = [...new Set(affected.map((event) => event.file))].sort();
    findings.push({
      rule: 'event-namespace-undeclared',
      severity: EVENT_NAMESPACE_SEVERITY['event-namespace-undeclared'],
      where: `${first.file}:${first.idLine}`,
      element: prefix,
      engineMessage: `Event ${first.id} at  file: ${first.file.replace(/\\/g, '/')} line: ${first.idLine} has an invalid ID`,
      message:
        `event id \`${first.id}\` names the namespace \`${prefix}\`, and NO supplied event file declares ` +
        `\`namespace = ${prefix}\`. The engine rejects the id and everything that names it, verbatim: ` +
        `\`[event.cpp:1208]: Event ${first.id} ... has an invalid ID\` and ` +
        `\`[onaction.cpp:94]: OnAction "..." is referencing an invalid ID: "${first.id}"\` - so an on_action hook ` +
        'pointing at it silently never fires. ' +
        (affected.length > 1
          ? `${affected.length} event ids share this namespace, across ${filesTouched.length} file(s): ${filesTouched.join(', ')}. `
          : '') +
        'A namespace declaration is a TOP-LEVEL `namespace = <name>` root, and it may live in ANY loaded `events/` ' +
        'file, which is why this is scoped to the files supplied: the install has 6,571 events over 170 files and 200 ' +
        'namespace declarations covering 118 distinct names, with ZERO ids whose namespace is declared nowhere ' +
        "(measured), while all of `anomaly_events_4.txt`'s " +
        '`anomaly.*` ids resolve against `anomaly_events_1.txt:8`. So if the missing declaration is in a file that was ' +
        'not passed, this finding is a fragment rather than a defect.',
      subject: { kind: 'event_namespace', key: prefix },
      resolution: 'scoped-to-supplied-files',
      suggestedFix:
        `add \`namespace = ${prefix}\` as a top-level line of the file that declares these events (a namespace is ` +
        "declared once for the whole tree, and the probe mod's own header records exactly this defect: an undeclared " +
        'namespace makes every id under it invalid).',
      affectedCount: affected.length,
      files: filesTouched,
    });
  }

  const counts = { total: findings.length, error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return {
    findings,
    counts,
    // Reported whether or not a finding fired, so an empty declaration list is a different answer
    // from "read and clean".
    namespaces,
    events,
    undeclared: [...byNamespace.keys()].sort(),
  };
}

/**
 * Every event id an effect tree fires, following custom `scripted_effects` to a bounded depth.
 *
 * @param {object} entry a parsed block (an `option`, a `hidden_effect`, a whole event)
 * @param {{definitions?: Map<string, object>, depth?: number, seen?: Set<string>, effectCalls?: string[]}} options
 */
export function collectFiredEventIds(entry, options = {}) {
  const definitions = options.definitions ?? new Map();
  const depth = options.depth ?? 0;
  const seen = options.seen ?? new Set();
  const effectCalls = options.effectCalls ?? [];
  const ids = [];
  if (!entry || depth > 6) return ids;
  for (const child of entry.children ?? []) {
    if (!child.key) continue;
    const lowered = child.key.toLowerCase();
    if (lowered === 'id') continue;
    if (EVENT_CALL_KEYS.has(lowered)) {
      const id = unquote(child.value) ?? unquote(childNamed(child, 'id')?.value);
      if (id) ids.push({ id, line: child.line });
      continue;
    }
    // A bare identifier that names a scripted effect: `my_effect = yes`.
    if (definitions.has(lowered) && !seen.has(lowered)) {
      seen.add(lowered);
      effectCalls.push(lowered);
      ids.push(...collectFiredEventIds(definitions.get(lowered), { definitions, depth: depth + 1, seen, effectCalls }));
      continue;
    }
    // Scripted triggers/effects can also nest under `if`/`else`/`limit`/`hidden_effect`/`immediate`.
    if (child.children) {
      const nested = collectFiredEventIds(child, { definitions, depth: depth + 1, seen, effectCalls });
      ids.push(...nested.map((entry2) => ({ ...entry2, via: entry2.via ?? child.key })));
    }
  }
  return ids;
}

/** Does this effect tree read or write a flag? That is the discriminator the close pattern needs. */
export function collectFlagNames(entry, options = {}) {
  const definitions = options.definitions ?? new Map();
  const depth = options.depth ?? 0;
  const seen = options.seen ?? new Set();
  const names = [];
  if (!entry || depth > 6) return names;
  for (const child of entry.children ?? []) {
    if (!child.key) continue;
    const lowered = child.key.toLowerCase();
    if (FLAG_KEYS.has(lowered)) {
      const name = unquote(child.value) ?? unquote(childrenNamed(child, 'flag')[0]?.value);
      if (name) names.push({ field: child.key, name, line: child.line });
      continue;
    }
    if (definitions.has(lowered) && !seen.has(lowered)) {
      seen.add(lowered);
      names.push(...collectFlagNames(definitions.get(lowered), { definitions, depth: depth + 1, seen }));
      continue;
    }
    if (child.children) names.push(...collectFlagNames(child, { definitions, depth: depth + 1, seen }));
  }
  return names;
}

/**
 * Extract the events of a file, with the fields the cross-file rules need.
 *
 * @param {string} text
 * @returns {object[]} {key, id, customGui, customGuiOption, forceOpen, options, line}
 */
export function extractEvents(text) {
  let parsed;
  try {
    parsed = parseParadox(text);
  } catch {
    return [];
  }
  const events = [];
  for (const root of parsed.roots) {
    if (!root.key || !EVENT_KEYS.has(root.key.toLowerCase()) || !root.children) continue;
    const id = unquote(childNamed(root, 'id')?.value) ?? null;
    events.push({
      key: root.key,
      id,
      line: root.line,
      customGui: unquote(childNamed(root, 'custom_gui')?.value) ?? null,
      customGuiOption: unquote(childNamed(root, 'custom_gui_option')?.value) ?? null,
      forceOpen: /^yes$/i.test(String(childNamed(root, 'force_open')?.value ?? '')),
      hasDiplomatic: Boolean(childNamed(root, 'diplomatic')),
      options: childrenNamed(root, 'option'),
      node: root,
    });
  }
  return events;
}

/**
 * The cross-file rules.
 *
 * TWO PASSES, because the severity depends on a fact that is only visible across events: which
 * event OPENS a given window. For a window whose event's option 0 is the window opener, an
 * unguarded self-reference is the close-then-reopen crash, and it is a warning. For a window whose
 * event some OTHER event opens - the trial mod's panel walls, where every one of the six events can
 * be reached from every other - the same pattern is a navigation cycle and no worse than a warning
 * about a user-visible wart. This distinction is measured: the shipped mod's real `game.log` shows
 * `geocentric_unga.2 ... selectedOption 0` followed 3.5 s later by `geocentric_unga.2` again, which
 * is option 0 (the "NATO" row, the first option of the NATO window) re-firing itself - a real,
 * observed wart that the naive one-pass rule could not tell from the crash.
 *
 * @param {{events?: object[], definitions?: Map<string, object>, guiFileCount?: number}} input
 * @returns {{findings: object[], stats: object}}
 */
export function checkEventWindows(input = {}) {
  const events = input.events ?? [];
  const definitions = input.definitions ?? new Map();
  const findings = [];
  const add = (finding) => findings.push({ suggestedFix: null, severity: 'warning', ...finding });
  const stats = {
    events: events.length,
    withCustomGui: 0,
    forceOpenWithCustomGui: 0,
    option0SelfRef: 0,
    option0Guarded: 0,
    option0WindowOpener: 0,
    option0NavigationCycle: 0,
  };

  /**
   * A `country_event = { id = X }` call with no `days`/`random` is the SAME TICK, so an event that
   * fires X from any of its options is X's opener. That is what this map records.
   */
  const openedBy = new Map();
  for (const event of events) {
    for (const option of event.options) {
      for (const fired of collectFiredEventIds({ children: option.children ?? [] }, { definitions })) {
        const list = openedBy.get(fired.id) ?? [];
        if (!list.includes(event.id)) list.push(event.id);
        openedBy.set(fired.id, list);
      }
    }
  }

  for (const event of events) {
    const where = event.id ? `event ${event.id}` : `event at line ${event.line}`;
    if (event.customGui && event.forceOpen) {
      stats.forceOpenWithCustomGui += 1;
      add({
        rule: 'custom-gui-force-open',
        severity: 'warning',
        where,
        element: event.id,
        engineMessage: 'force_open',
        message:
          `\`force_open = yes\` is set on an event that also names a \`custom_gui\` window. Over the install's own ` +
          'events/ (5563 events): 113 carry `force_open` and 36 carry `custom_gui`, and NOT ONE carries both. Vanilla ' +
          'uses `force_open` to force a plain diplomatic event to open, and it never needs it when `custom_gui` ' +
          'constructs the window. The combination is unproven rather than proven-broken, so this is a warning: if the ' +
          'window opens without it, delete it.',
        suggestedFix: 'try removing `force_open = yes`; the trial mod kept it as a precaution and never proved it necessary.',
      });
    }
    if (!event.customGui) continue;
    stats.withCustomGui += 1;

    const first = event.options[0] ?? null;
    if (!first) continue;
    const effectBlocks = [
      ...childrenNamed(first, 'hidden_effect'),
      ...childrenNamed(first, 'effect'),
      ...childrenNamed(first, 'immediate'),
    ];
    const effectCalls = [];
    const fired = effectBlocks.flatMap((block, index) =>
      collectFiredEventIds(block, { definitions, effectCalls, seen: new Set(index === 0 ? [] : [`__${index}`]) }),
    );
    const selfRef = event.id ? fired.find((entry) => entry.id === event.id) : null;
    if (!selfRef) continue;
    stats.option0SelfRef += 1;
    const flags = effectBlocks.flatMap((block) => collectFlagNames(block, { definitions }));
    const guarded = flags.length > 0;
    if (guarded) stats.option0Guarded += 1;

    // WHICH ROLE does option 0 play in this window? Two measurements decide it, and the difference
    // is between a crash and a wart:
    //
    //   `openedByAnotherEvent` - some OTHER event fires this one, so the panel is reachable from the
    //     panel wall and option 0 is the first navigation row. Measured wart: the trial mod's own
    //     game.log shows `geocentric_unga.2 ... selectedOption 0`, then `geocentric_unga.2` again
    //     3.5 s later, because the "NATO" row of the NATO window re-fires the window it is drawn in.
    //   the event that OPENS its window: `event.id === event.customGui` in the trial mod, or nothing
    //     else fires it. Here option 0 is what the engine's close control selects, and an unguarded
    //     self-reference is the close-then-reopen crash the whole flag discriminator exists for.
    //
    // A guarded chain settles it either way, and stays `info`.
    const openedByOthers = (openedBy.get(event.id) ?? []).filter((id) => id !== event.id);
    const opensItsWindow = event.id === event.customGui;
    const role = guarded ? 'guarded' : openedByOthers.length > 0 ? 'navigation-row' : 'window-opener';
    if (role === 'window-opener') stats.option0WindowOpener += 1;
    if (role === 'navigation-row') stats.option0NavigationCycle += 1;
    const severity = guarded || role === 'navigation-row' ? 'info' : 'warning';

    add({
      rule: 'custom-gui-option0-selfref',
      severity,
      where,
      element: event.id,
      engineMessage: `Event ${event.id} ... selectedOption 0`,
      message:
        `the FIRST option of \`${event.customGui}\`'s event (${where}) fires \`${event.id}\` again` +
        (effectCalls.length > 0 ? ` via \`${[...new Set(effectCalls)].join('`, `')}\`` : '') +
        `. The engine's close control SELECTS OPTION 0 (logs/game.log: \`selectedOption 0\`) and consumes the event ` +
        'before the option\'s effects run, so an unguarded option 0 closes the window and re-opens it in the same ' +
        'frame. ' +
        (role === 'guarded'
          ? `This one IS guarded: the chain reads/writes ${[...new Set(flags.map((flag) => flag.name))].map((name) => `\`${name}\``).join(', ')}. ` +
            'That is the working pattern - the close button\'s own button effect sets the flag, and it is the only code ' +
            'that runs before the selection - so this is reported for review, not as a defect.'
          : role === 'window-opener'
            ? 'No flag guard was found anywhere in the option\'s effect chain, and nothing else in the checked files ' +
              'fires this event, so option 0 here is the engine\'s close control: a close click re-opens the window. ' +
              'Set a flag from the close control\'s own BUTTON EFFECT (`common/button_effects/`) and consume it here: ' +
              '`if = { limit = { has_country_flag = <flag> } remove_country_flag = <flag> } else = { ... }`. ' +
              '`has_active_event` cannot do this job: the event is already consumed by the time the option runs.'
            : `No flag guard was found, but ${openedByOthers.map((id) => `\`${id}\``).join(', ')} also fires this event, so ` +
              'option 0 is a NAVIGATION row rather than the close control: selecting it consumes the event and ' +
              'immediately re-creates it, which is a repeatable, visible wart rather than a crash. Measured in the ' +
              'trial mod\'s own game.log: `geocentric_unga.2 ... selectedOption 0`, then `geocentric_unga.2` again ' +
              '3.5 s later. Make that row a no-op, or give it its own guard.'),
      suggestedFix:
        role === 'guarded'
          ? 'none: the flag guard is the documented fix.'
          : role === 'window-opener'
            ? 'add the close-button flag discriminator (see docs/gui-pitfalls.md, "close selects option 0").'
            : 'make the row that re-selects this event do nothing (`hidden_effect = { }`), or point it at another panel.',
      guarded,
      option0Role: role,
    });
  }

  return { findings, stats };
}

export default {
  checkEventWindows,
  extractEvents,
  indexScriptDefinitions,
  collectFiredEventIds,
  collectFlagNames,
  readNamespaceDeclarations,
  readEventIds,
  analyseEventNamespaces,
  EVENT_KEYS,
  EVENT_NAMESPACE_SEVERITY,
  EVENT_NAMESPACE_DESCRIPTIONS,
};
