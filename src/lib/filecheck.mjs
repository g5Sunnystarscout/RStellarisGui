//------------------------------------------------------------------------------------
// filecheck.mjs -- Part of RStellarisGui
//
// The FILE INSPECTOR: encoding, root construct, engine syntax, localisation keys and event
// shape, for files this tool did not write.
//
// Every other check in this project runs on a layout TREE, which means it can only see files the
// tool produced or parsed. The two things that actually broke a real mod were invisible to that:
//
//   * the emitted `.gui` was syntactically invalid (see syntax.mjs), and
//   * the events file had three events with no `option` block, which the engine reports as
//     `Event geocentric_unga.4 has no options in events/zz_geocentric_unga_events.txt`, and
//     five localisation keys referenced but never defined.
//
// So this module reports on ARBITRARY paths: `.gui` (encoding, guiTypes root, per-kind syntax),
// `.yml` (BOM, `l_<language>:` header, key syntax, duplicates), event `.txt` (option blocks,
// resolvable title/desc/option keys, `diplomatic = yes` alongside `custom_gui`) and
// `common/button_effects/*.txt` (top-level key shape). Five DATA schemas are routed away from that
// last rule and checked together instead, because each one names something in another:
// `common/ship_sizes/**` (`carries_colony` -> a planet class), `common/planet_classes/**`,
// `common/asteroid_belts/**`, `common/star_classes/**` (`planet = { key = ... }` -> a planet class)
// and `common/solar_system_initializers/**` (`class` -> a star class, `asteroid_belt.type` -> a belt
// type).
//
// The `.gui` checks are re-run through the real validator, so a caller gets one report instead
// of two.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { inspectEncoding } from './emit.mjs';
import { analyseAsteroidBelts, analyseColonization, analyseRingWorlds, analyseStarClasses, isAsteroidBeltsPath, isPlanetClassesPath, isScriptedEffectsPath, isShipSizesPath, isStarClassesPath, isSystemInitializersPath } from './colonization.mjs';
import { analyseEventNamespaces, checkEventWindows, extractEvents, indexScriptDefinitions } from './events.mjs';
import { analyseSystemLights, isLightsAssetPath, isWorldgfxPath } from './worldgfx.mjs';
import { checkGuiSyntax } from './syntax.mjs';
import { buildLocalisationIndex } from './loc-index.mjs';
import { parseParadox } from './paradox.mjs';
import { hasBom, listFilesRecursive, readTextFile } from './paths.mjs';
import { validateGuiText } from './validate.mjs';

/** `[scope] path` for a finding, so a multi-file report stays readable. */
function at(file, line, scope) {
  return `${file}${line ? `:${line}` : ''}${scope ? ` [${scope}]` : ''}`;
}

/**
 * Check a list of files.
 *
 * @param {{paths: string[], languages?: string[], localisationRoots?: string[], roots?: string[],
 *          assets?: object, checkLocKeys?: boolean}} options
 * @returns {{ok: boolean, files: object[], findings: object[], counts: object, byRule: object}}
 */
export function checkFiles(options = {}) {
  const paths = options.paths ?? [];
  const findings = [];
  const add = (finding) => findings.push({ suggestedFix: null, severity: 'error', ...finding });

  const guiPaths = paths.filter((path) => /\.gui$/i.test(path));
  let keyset = null;
  if (options.checkLocKeys !== false) {
    // The mod's own roots matter here as much as the install's: a key the mod defines is not
    // "missing", and a localisation file under an extra root still needs its BOM checked.
    keyset = buildLocalisationIndex({
      languages: options.languages ?? ['english'],
      roots: [...(options.roots ?? []), ...(options.assetRoots ?? [])],
      directories: options.localisationRoots ?? [],
      // `withValues` is what lets `window-text-data-function` read the value a window would paint:
      // a bracket data function in a painted text value renders literally (see validate.mjs).
      withValues: true,
    });
  }
  const knownContainers = new Set(Object.keys(options.assets?.containers ?? {}));
  const guiTexts = [];
  for (const path of guiPaths) {
    if (existsSync(path)) guiTexts.push(readTextFile(path));
  }

  // ---------------------------------------------------------------- the cross-file pass
  //
  // `custom_gui`, `custom_gui_option` and `force_open` are EVENT fields, and the close/option-0
  // defect lives in the gap between an event and the window it names. So the event files are read
  // ONCE, up front, and three things come out of them:
  //   * the window names the events actually name with `custom_gui` - the authoritative list of
  //     windows the contract check may call broken (src/lib/contract.mjs `explicit`);
  //   * the scripted-effect definitions, so an option that fires an event INDIRECTLY is followed;
  //   * every event, for the two cross-file rules.
  const eventPaths = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    if (/\.gui$/i.test(path) || /\.ya?ml$/i.test(path)) continue;
    let text;
    try {
      text = readTextFile(path);
    } catch {
      continue;
    }
    if (isEventFile(path, text)) eventPaths.push({ path, text });
  }
  const events = [];
  for (const entry of eventPaths) events.push(...extractEvents(entry.text));
  const customGuiWindows = new Set();
  // A caller may name them directly: the events that name a window are not always among the files
  // being checked (a mod's `events/` folder is often handed over separately, or not at all), and
  // without them the visibility rules cannot tell an event window from an inferred one and stay at
  // WARNING severity.
  for (const name of options.customGuiWindows ?? []) {
    if (typeof name === 'string' && name !== '') customGuiWindows.add(name);
  }
  for (const event of events) {
    // `custom_gui` on the EVENT names the window; `custom_gui_option` names the OPTION ROW template,
    // and an option's own `custom_gui` does the same job for that one row. Both are collected - the
    // analyser's shape gate (src/lib/contract.mjs `looksLikeEventWindow`) is what keeps a row from
    // being told it is a window missing 26 elements.
    if (event.customGui) customGuiWindows.add(event.customGui);
    if (event.customGuiOption) customGuiWindows.add(event.customGuiOption);
    for (const option of event.options ?? []) {
      const rowGui = (option.children ?? []).find((child) => child.key && child.key.toLowerCase() === 'custom_gui');
      if (rowGui?.value) customGuiWindows.add(String(rowGui.value).replace(/^"|"$/g, ''));
    }
  }
  // `common/espionage_operation_types/*.txt` names events by id and the engine validates them, so the
  // ids the caller's files declare are indexed here, once, from the same texts the event checks
  // already read (`checkEspionageOperationTypesFile`). `espionage_operation_event` is NOT in
  // EVENT_KEYS - the window/option checks below are not about it - so the index is filled from the
  // parsed texts directly, by key shape, and a stage event that lives in any `<something>_event`
  // block is resolvable.
  const eventIndex = new Map();
  for (const event of events) {
    if (event.id) eventIndex.set(String(event.id), event.key);
  }
  for (const entry of eventPaths) eventIdsIn(entry.text, eventIndex);
  const scriptedEffects = indexScriptDefinitions(
    eventPaths
      .map((entry) => dirname(entry.path))
      .filter((directory, index, all) => all.indexOf(directory) === index)
      .flatMap((directory) =>
        listFilesRecursive(directory, ['.txt'])
          .filter((file) => /scripted_effect|scripted_trigger|scripted_loc/i.test(file))
          .map((file) => {
            try {
              return readTextFile(file);
            } catch {
              return '';
            }
          }),
      ),
  );

  const report = [];
  // The three colonisation/asteroid schemas are collected here and analysed ONCE after the loop,
  // because a `carries_colony` in a ship-size file names a class in a planet-class file, and an
  // `asteroid_belt = { type = ... }` in an initializer names a type in a `common/asteroid_belts/` file.
  const colonisationFiles = [];
  // The create-colony pass reads a different schema from the four above: a `create_colony` lives in
  // a scripted effect or an inline script, and the population that must accompany it may be in
  // another such file, reached by name.
  const scriptedFiles = [];
  // The `gfx/` halves of the system-light rule: `gfx/lights/**` DEFINES a light, `gfx/worldgfx/*.txt`
  // NAMES one, and a name with no definition is what the engine reports at load.
  const lightsFiles = [];
  const worldgfxFiles = [];
  let colonisationReport = null;
  let asteroidReport = null;
  let starReport = null;
  let ringReport = null;
  let namespaceReport = null;
  let worldgfxReport = null;
  for (const path of paths) {
    const entry = { path, name: basename(path) };
    if (!existsSync(path)) {
      add({
        rule: 'file-not-found',
        severity: 'error',
        where: path,
        message: `no such file: ${path}`,
      });
      report.push({ ...entry, exists: false });
      continue;
    }
    const isLocalisation = /\.ya?ml$/i.test(path);
    const inspected = inspectEncoding(path, { expectsBom: isLocalisation });
    Object.assign(entry, {
      exists: true,
      bytes: inspected.bytes,
      hasBom: inspected.hasBom,
      expectsBom: inspected.expectsBom,
      crlf: inspected.crlf,
      rootKeyword: inspected.rootKeyword,
    });
    for (const issue of inspected.issues) add({ ...issue, where: at(path, null, 'encoding') });
    if (isShipSizesPath(path) || isPlanetClassesPath(path) || isAsteroidBeltsPath(path) || isSystemInitializersPath(path) || isStarClassesPath(path)) {
      colonisationFiles.push({ path, text: inspected.text });
    }
    // A scripted effect / inline script feeds ONLY the create-colony pass. The other colonisation
    // passes (ship sizes, planet classes, belts, star classes, initializers) read schemas these
    // files do not contain, so they are kept in a list of their own rather than added to
    // `colonisationFiles` where they would be inert for four passes and misleading in the report's
    // own file list.
    if (isScriptedEffectsPath(path)) scriptedFiles.push({ path, text: inspected.text });
    // The system-light pair. A `.dds` under `gfx/worldgfx/` names nothing, so only the `.txt`
    // files are collected; `isLightsAssetPath` is checked FIRST because `gfx/lights/*.asset` is
    // not a worldgfx file and vice versa.
    if (isLightsAssetPath(path)) lightsFiles.push({ path, text: inspected.text });
    else if (isWorldgfxPath(path)) worldgfxFiles.push({ path, text: inspected.text });

    if (isLocalisation) {
      checkLocalisationFile(path, inspected.text, add, entry);
    } else if (/\.gui$/i.test(path)) {
      checkGuiFile(path, inspected.text, add, {
        entry,
        keyset,
        knownContainers,
        assets: options.assets ?? null,
        // A caller-supplied keyset is passed straight through, EMPTY INCLUDED: an empty set means
        // "I looked and there are none", which is a different answer from "not checked".
        buttonEffects: options.buttonEffects ?? null,
        // GAP-12: the `common/button_effects/*.txt` FILES, so the visibility table can read each
        // entry's `potential` and not just its key. The asset index already carries their absolute
        // paths; caller-supplied roots are read here too, because they may not be in the index.
        buttonEffectFiles: options.buttonEffectFiles ?? null,
        buttonEffectRoots: options.buttonEffectRoots ?? null,
        visibilityScopeGuarantees: options.visibilityScopeGuarantees ?? null,
        parkMargin: options.parkMargin,
        checkVisibility: options.checkVisibility,
        languages: options.languages ?? ['english'],
        customGuiWindows: [...customGuiWindows],
        checkContract: options.checkCustomGuiContract !== false,
      });
    } else if (isEventFile(path, inspected.text)) {
      checkEventFile(path, inspected.text, add, {
        keyset,
        knownContainers,
        guiTexts,
        // GAP-17: "was there an index to resolve a `custom_gui` name against at all?" - an empty
        // container map from a real index and no index are different answers, and the name rule says
        // so rather than reporting a search it did not run.
        assetsIndexed: Boolean(options.assets?.containers),
        entry,
      });
    } else if (isEspionageOperationTypesFile(path)) {
      // FIRST, because `isButtonEffectsFile` claims every `/common/` path and this schema is not one.
      checkEspionageOperationTypesFile(path, inspected.text, add, entry, eventIndex);
    } else if (isScriptedEffectsPath(path)) {
      // ALSO before the generic `/common/` rule, and for the same reason: a scripted effect has no
      // `effect` block, so `checkButtonEffectsFile` reported `button-effect-without-effect` against
      // every one of them. Its own pass runs below over the collected files, because a
      // `create_colony` in one file may be completed by a `create_pop_group` in another.
      entry.checked = 'colonisation';
    } else if (isShipSizesPath(path) || isPlanetClassesPath(path) || isAsteroidBeltsPath(path) || isSystemInitializersPath(path) || isStarClassesPath(path)) {
      // ALSO before the generic `/common/` rule: `isButtonEffectsFile` claims every path under
      // `common/`, so a ship size, a planet class, an asteroid-belt type, a system initializer or a
      // star class was being checked for a missing `effect` block it was never supposed to have (a
      // `common/star_classes/*.txt` file is not a button effect and never had one to miss - measured
      // against `<mods>\dyson_habitat_cluster\common\star_classes\`, which reported
      // `button-effect-without-effect` as an ERROR before this route existed). None of the five
      // schemas is a button effect, and all five are checked in the colonisation/star pass below,
      // which needs the FILES rather than one file at a time.
      entry.checked = 'colonisation';
    } else if (isButtonEffectsFile(path)) {
      checkButtonEffectsFile(path, inspected.text, add, entry, keyset ? keyset.keys : null);
    } else {
      entry.checked = 'encoding only';
    }
    report.push(entry);
  }

  // The two rules that need the events AND the windows together.
  if (options.checkEventWindows !== false && events.length > 0) {
    const crossFile = checkEventWindows({ events, definitions: scriptedEffects });
    for (const finding of crossFile.findings) add(finding);
    findings.stats = crossFile.stats;
  }

  // ---------------------------------------------------------------- the event-namespace pass
  //
  // An event id is `<namespace>.<n>`, and the namespace has to be DECLARED by a top-level
  // `namespace = <name>` root somewhere in the loaded `events/` tree. When it is not, the engine
  // rejects the id (`event.cpp:1208 ... has an invalid ID`) AND every `on_action` that names it
  // (`onaction.cpp:94 OnAction ... is referencing an invalid ID`), so the hook silently never
  // fires. The pass takes the event files this inspector already found, because the declaration may
  // live in ANY of them - see `analyseEventNamespaces` for why the per-file reading is false.
  if (eventPaths.length > 0) {
    const namespaces = analyseEventNamespaces({ files: eventPaths });
    for (const finding of namespaces.findings) add(finding);
    namespaceReport = namespaces;
  }

  // ---------------------------------------------------------------- the system-light pass
  //
  // A `gfx/worldgfx/*.txt` NAMES the light for its system (`system_light = "black_hole_light"`)
  // and the engine BUILDS that light from the file at load, naming every one it cannot find
  // (`gamerendering.cpp:1174`). So the two halves are a `gfx/lights/**/*.asset` definition and a
  // `gfx/worldgfx/*.txt` reference, and neither is checkable without the other.
  if (worldgfxFiles.length > 0 || lightsFiles.length > 0) {
    const systemLights = analyseSystemLights({
      lightFiles: lightsFiles,
      worldgfxFiles,
      complete: true,
    });
    for (const finding of systemLights.findings) add(finding);
    worldgfxReport = systemLights;
  }

  // ---------------------------------------------------------------- the colonisation pass
  //
  // `common/ship_sizes/**`, `common/planet_classes/**` and `common/asteroid_belts/**` are the three
  // schemas that decide what a body IS and what can be colonised at all (src/lib/colonization.mjs);
  // the engine's own error strings name both halves of the ark-ship contract, and a belt type is the
  // mesh list an `asteroid_belt` block draws from. They are checked in ONE pass over the union of
  // the supplied files, because a `carries_colony` in one file names a class in another and a
  // `type =` in an initializer names a belt type in a third.
  if (colonisationFiles.length > 0 || scriptedFiles.length > 0) {
    const colonisation = analyseColonization({
      planetClassFiles: colonisationFiles.filter((file) => isPlanetClassesPath(file.path)),
      shipSizeFiles: colonisationFiles.filter((file) => isShipSizesPath(file.path)),
      // The create-colony pass reads these: a `create_colony` is written in a scripted effect or an
      // inline script, and the `create_pop_group` that must accompany it may be in another of them.
      scriptFiles: scriptedFiles,
      // Every file the caller handed over is in hand, so a `carries_colony` naming a class that is
      // in none of them is an error. A caller that shipped only part of a mod can say otherwise
      // per file; with only the files it gave, this is the honest reading.
      complete: true,
    });
    for (const finding of colonisation.findings) add(finding);
    colonisationReport = colonisation;

    // The belt side reads the SAME file list: a belt type definition is one file, the initializer
    // that names it is another, and neither is checkable alone. `complete` mirrors the colonisation
    // pass above - every file the caller handed over is in hand - and `analyseAsteroidBelts` still
    // downgrades an unknown type to a WARNING when no `common/asteroid_belts/` file was supplied at
    // all, so a fragment is not called broken.
    const asteroids = analyseAsteroidBelts({
      asteroidBeltFiles: colonisationFiles.filter((file) => isAsteroidBeltsPath(file.path)),
      scriptFiles: colonisationFiles.filter((file) => !isAsteroidBeltsPath(file.path)),
      complete: true,
    });
    for (const finding of asteroids.findings) add(finding);
    asteroidReport = asteroids;

    // THE STAR SLOTS (src/lib/colonization.mjs). A star class names the planet class that occupies
    // each star slot, and an initializer names the star class - so the rule needs a star-class file,
    // a planet-class file and an initializer TOGETHER, which is why it runs here and not per file.
    // `complete` mirrors the two passes above, and each half still downgrades to a warning when its
    // own definition directory was not supplied at all.
    const stars = analyseStarClasses({
      starClassFiles: colonisationFiles.filter((file) => isStarClassesPath(file.path)),
      planetClassFiles: colonisationFiles.filter((file) => isPlanetClassesPath(file.path)),
      initializerFiles: colonisationFiles.filter((file) => isSystemInitializersPath(file.path)),
      complete: true,
    });
    for (const finding of stars.findings) add(finding);
    starReport = stars;

    // THE RING WORLD (src/lib/colonization.mjs). A ring world is twelve ordinary `planet` blocks in
    // an initializer whose classes carry `ringworld = yes` - there is no system-level ring object in
    // the script language - so the ring's radius is the radius those bodies are placed on and its
    // segment count is how many of them the file writes. The pass needs the initializers AND the
    // planet classes together, the same pair the star-slot pass above takes.
    const rings = analyseRingWorlds({
      initializerFiles: colonisationFiles.filter((file) => isSystemInitializersPath(file.path)),
      planetClassFiles: colonisationFiles.filter((file) => isPlanetClassesPath(file.path)),
      complete: true,
    });
    for (const finding of rings.findings) add(finding);
    ringReport = rings;
  }

  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byRule = {};
  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
  }
  // GAP-11 / GAP-12, aggregated across the `.gui` files checked: the park/escape split and the
  // `effect` -> `potential` table. A caller reading only `byRule` cannot tell a clean file from one
  // whose whole `out-of-bounds` count is the `-3000,-3000` park idiom, and cannot see a visibility
  // condition that is not in the `.gui` at all - so both are carried on the RESULT, not only on the
  // per-file entries, with each row naming its file.
  const guiEntries = report.filter((entry) => entry.geometry || entry.visibility);
  const geometry = guiEntries.length
    ? {
        outOfBounds: guiEntries.reduce(
          (total, entry) => {
            const oob = entry.geometry?.outOfBounds ?? {};
            return {
              total: total.total + (oob.total ?? 0),
              escaped: total.escaped + (oob.escaped ?? 0),
              parked: total.parked + (oob.parked ?? 0),
              parkMargin: oob.parkMargin ?? total.parkMargin,
              parkedClassification: oob.parkedClassification ?? total.parkedClassification,
            };
          },
          { total: 0, escaped: 0, parked: 0, parkMargin: null, parkedClassification: 'off' },
        ),
        perFile: guiEntries.map((entry) => ({ file: entry.path, ...entry.geometry?.outOfBounds })),
        note:
          'summed over the `.gui` files checked; `perFile` says which file each part came from. An element more than ' +
          '`parkMargin` px outside the root is `out-of-bounds-parked` (info), not an escape, so it never inflates ' +
          '`out-of-bounds`.',
      }
    : null;
  const visibilityRows = report.flatMap((entry) => (entry.visibility?.table ?? []).map((row) => ({ file: entry.path, ...row })));
  const visibility = guiEntries.some((entry) => entry.visibility)
    ? {
        checked: guiEntries.some((entry) => entry.visibility?.checked === true),
        effectFiles: [...new Set(guiEntries.flatMap((entry) => entry.visibility?.effectFiles ?? []))].sort(),
        elementsWithEffect: visibilityRows.length,
        demandingScope: visibilityRows.filter((row) => row.demandedScope.length > 0).length,
        demandingScopeUnmet: visibilityRows.filter((row) => row.demandedScope.length > 0 && !row.scopeGuaranteed).length,
        flagScopeSpecific: visibilityRows.filter((row) => row.flagScopes.length > 0 && row.demandedScope.length === 0).length,
        effectsUndefined: visibilityRows.filter((row) => !row.effectDefined).length,
        windowsWithoutGuarantee: [
          ...new Set(visibilityRows.filter((row) => row.scopeGuarantee === null).map((row) => row.window).filter(Boolean)),
        ].sort(),
        table: visibilityRows,
        note:
          'every element carrying an `effect`, joined to the `common/button_effects/*.txt` entry it names, with that ' +
          "entry's `potential` and the scope it demands - reported whether or not a finding fired, because a condition " +
          'that is true on one route into a window and false on another cannot be shown by findings alone.',
      }
    : null;
  return {
    ok: bySeverity.error === 0,
    counts: { total: findings.length, ...bySeverity },
    byRule,
    ...(geometry ? { geometry } : {}),
    ...(visibility ? { visibility } : {}),
    // The colonisation side, reported whether or not a finding fired: the planet classes and the
    // carrier hulls are the answer to "what can be colonised here", and an empty list is a
    // different answer from "not checked".
    ...(colonisationReport
      ? {
          colonisation: {
            complete: true,
            starbaseClass: colonisationReport.starbaseClass,
            planetClasses: colonisationReport.planetClasses,
            carrierClasses: colonisationReport.carrierClasses,
            files: colonisationFiles.map((file) => file.path),
            note:
              '`colonizable = yes` on a planet class is the field that makes a body colonisable, and ' +
              '`carries_colony` on a ship size is the field that makes a hull a mobile colony; a megastructure ' +
              'has neither and becomes a colony by spawning a planet and removing itself.',
          },
        }
      : {}),
    // THE COLONY/POPULATION SIDE, a SIBLING of `colonisation` rather than a key inside it: it reads
    // scripted effects and inline scripts, which the colonisation block above does not read at all,
    // and it is reported whether or not a finding fired - the blocks that call `create_colony` and
    // the blocks that seed population are the two halves of the answer, so "found no colony call" is
    // a different answer from "read and clean".
    ...(colonisationReport?.colonies
      ? {
          colonies: {
            colonyBlocks: colonisationReport.colonies.colonyBlocks,
            popSeedingBlocks: colonisationReport.colonies.popSeedingBlocks,
            note:
              '`create_colony` builds the colony OBJECT and nothing else; a colony with zero population reverts ' +
              'to a colonisable planet with no log line, so every working scripted colony is paired with ' +
              '`create_pop_group` - the one pop-creating effect the engine documents. The rule is BLOCK-SCOPED, ' +
              'which is why it warns rather than errors.',
          },
        }
      : {}),
    // The asteroid side, on the same terms: the belt types the supplied files define and every
    // `asteroid_belt` block they place are the answer to "how is a belt represented here", and an
    // empty list is a different answer from "not checked".
    ...(asteroidReport
      ? {
          asteroids: {
            beltTypes: asteroidReport.beltTypes,
            belts: asteroidReport.belts,
            definitionsSupplied: asteroidReport.definitionsSupplied,
            note:
              'an `asteroid_belt = { type = <key> radius = <n> }` block is SCENERY: it names a mesh list in ' +
              '`common/asteroid_belts/*.txt` and places no planets. A single asteroid is a separate PLANET object ' +
              '(`planet = { class = pc_asteroid }`), which is why a system can have a belt and no asteroid, or an ' +
              'asteroid and no belt.',
          },
        }
      : {}),
    // The star-slot side, on the same terms: the star classes the supplied files define, every slot
    // each one declares and the planet class that slot names, and every initializer's own star
    // class. Reported whether or not a finding fired, so "no star class in hand" is a different
    // answer from "read and clean".
    ...(starReport
      ? {
          stars: {
            starClasses: starReport.starClasses.map((entry) => ({
              key: entry.key,
              file: entry.file,
              line: entry.line,
              randomizer: entry.randomizer,
              slots: entry.slots,
            })),
            slots: starReport.slots,
            initializers: starReport.initializers,
            definitionsSupplied: starReport.starClassesSupplied,
            note:
              'a star class declares one `planet = { key = <planet class> }` per STAR SLOT, and an initializer\'s ' +
              '`planet = { class = star }` blocks take those classes in order; the engine names the stars ' +
              '`STAR_NAME_<i>_OF_<n>` and only the primary has a scope (`star`) or a trigger (`is_primary_star`).',
          },
        }
      : {}),
    // The ring-world side, on the same terms: every ring-world system the supplied initializers
    // declare, with the number of segments it places and the radius each one sits on, plus the
    // `ringworld = yes` planet classes those segments are. Reported whether or not a finding fired,
    // so "no ring world in hand" is a different answer from "read and clean".
    ...(ringReport
      ? {
          rings: {
            systems: ringReport.systems,
            ringClasses: ringReport.ringClasses,
            definitionsSupplied: ringReport.planetClassesSupplied,
            note:
              'a ring world is a set of ordinary PLANET objects whose classes carry `ringworld = yes`; the ' +
              'radius is the `change_orbit` before the segments and the segment count is how many `planet = ' +
              '{ class = pc_ringworld_* }` blocks the initializer writes. The megastructure of the same name ' +
              'is only the construction site.',
          },
        }
      : {}),
    // The system-light side, on the same terms: the lights the supplied files define and every
    // `system_light` the supplied worldgfx files name. Reported whether or not a finding fired.
    ...(worldgfxReport
      ? {
          systemLights: {
            lights: worldgfxReport.lights,
            systemLights: worldgfxReport.systemLights,
            unmatched: worldgfxReport.unmatched,
            lightsSupplied: worldgfxReport.lightsSupplied,
            note:
              'a `gfx/worldgfx/*.txt` NAMES its system light and the engine BUILDS that light from the file at ' +
              'load, naming every one it cannot find (`[gamerendering.cpp:1174]: Failed to create system light ' +
              '<name>`). The check needs no star-class resolution: the failure fires at load, before any galaxy ' +
              'exists.',
          },
        }
      : {}),
    // The event-namespace side, on the same terms: the declarations found and every event id read.
    ...(namespaceReport
      ? {
          eventNamespaces: {
            declarations: namespaceReport.namespaces,
            events: namespaceReport.events,
            undeclared: namespaceReport.undeclared,
            note:
              'an event id is `<namespace>.<n>` and the namespace must be declared by a top-level ' +
              '`namespace = <name>` root in one of the loaded event files; when it is not, the engine rejects the ' +
              'id (`event.cpp:1208`) AND every on_action that names it (`onaction.cpp:94`), so the hook silently ' +
              'never fires. The declaration may live in ANY event file, which is why the check is scoped to the ' +
              'files supplied.',
          },
        }
      : {}),
    files: report,
    localisationKeys: keyset ? keyset.keys.size : null,
    customGuiWindows: [...customGuiWindows],
    eventCount: events.length,
    findings,
  };
}

/** `.gui`: engine syntax, the `guiTypes` root, the contract, and the full layout validator on top. */
function checkGuiFile(path, text, add, options) {
  const syntax = checkGuiSyntax(text, path);
  for (const finding of syntax.findings) add(finding);
  options.entry.elementBlocks = syntax.elementBlocks;

  const validated = validateGuiText(text, path, {
    assets: options.assets,
    localisation: options.keyset,
    ...(options.buttonEffects ? { buttonEffects: options.buttonEffects } : {}),
    // GAP-12: without the effect FILES the visibility table has nothing to join against, and the
    // report would say nothing about a condition that is not in the `.gui` at all.
    ...(options.buttonEffectFiles ? { buttonEffectFiles: options.buttonEffectFiles } : {}),
    ...(options.buttonEffectRoots ? { buttonEffectRoots: options.buttonEffectRoots } : {}),
    ...(options.visibilityScopeGuarantees ? { visibilityScopeGuarantees: options.visibilityScopeGuarantees } : {}),
    sourceFiles: [path],
    options: {
      checkCustomGuiContract: options.checkContract !== false,
      customGuiWindows: options.customGuiWindows ?? [],
      ...(options.checkVisibility !== undefined ? { checkVisibility: options.checkVisibility } : {}),
      ...(options.parkMargin !== undefined ? { parkMargin: options.parkMargin } : {}),
    },
  });
  options.entry.verdict = validated.verdict;
  options.entry.findingCount = validated.counts?.total ?? null;
  // GAP-11 / GAP-12: what the geometry rules found, split into parks and escapes, and the
  // per-element `effect` -> `potential` join. Carried on the FILE'S OWN entry as well as the
  // aggregate, because a table is only readable next to the file it describes.
  if (validated.geometry) options.entry.geometry = validated.geometry;
  if (validated.visibility) options.entry.visibility = validated.visibility;
  // `validateGuiText` already merged its own syntax pass into `validated.findings`, so only the
  // findings that are NOT syntax findings are added - and a syntax finding that is already here
  // (added above, with the same rule and element) is not duplicated. `token` joins the key for the
  // same reason as in `validate.mjs`'s `mergeFindings`: `unexpected-token` is one finding per
  // unknown scalar, and one element may carry several.
  const keyOf = (item) =>
    item.token
      ? `${item.rule}|${item.token}|${item.where}`
      : item.element
        ? `${item.rule}|${item.element}`
        : `${item.rule}|${item.where}`;
  const seen = new Set(syntax.findings.map(keyOf));
  for (const finding of validated.findings ?? []) {
    if (seen.has(keyOf(finding))) continue;
    add({ ...finding, where: finding.where ?? path });
  }
}

/** `.yml`: BOM is mandatory, `l_<language>:` header, `key:0 "value"` lines, no duplicate keys. */
function checkLocalisationFile(path, text, add, entry) {
  const lines = text.split(/\r?\n/);
  let language = null;
  const seen = new Map();
  let keyLines = 0;
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/^\uFEFF/, '');
    const header = /^\s*l_([a-z_]+)\s*:/.exec(line);
    if (header) {
      language = header[1];
      continue;
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const key = /^\s*([A-Za-z0-9_.\-]+)\s*:\s*[0-9]+\s+"/.exec(line);
    if (!key) {
      add({
        rule: 'localisation-key-syntax',
        severity: 'error',
        where: at(path, index + 1, 'localisation'),
        message:
          `line ${index + 1} is neither a \`l_<language>:\` header nor a \`key:0 "value"\` entry. The engine skips ` +
          `lines it cannot read, so the key silently never exists. Got: \`${line.trim().slice(0, 80)}\``,
        suggestedFix: 'write ` key:0 "Value"` (the version number and the quotes are both required).',
      });
      continue;
    }
    if (!language) {
      add({
        rule: 'localisation-no-language-header',
        severity: 'error',
        where: at(path, index + 1, 'localisation'),
        message: 'a key appears before any `l_<language>:` header, so it belongs to no language and is ignored.',
        suggestedFix: 'start the file with `l_english:` (or your language) as the first non-comment line.',
      });
      continue;
    }
    keyLines += 1;
    if (seen.has(key[1])) {
      add({
        rule: 'localisation-duplicate-key',
        severity: 'warning',
        where: at(path, index + 1, 'localisation'),
        element: key[1],
        message: `\`${key[1]}\` is defined again at line ${index + 1} (first at line ${seen.get(key[1])}); the last one wins and the other is dead text.`,
        suggestedFix: 'delete the duplicate, or rename it if the two are meant to be different keys.',
      });
    } else {
      seen.set(key[1], index + 1);
    }
  }
  if (entry.hasBom && !/^\uFEFF?\s*l_/.test(lines[0] ?? '')) {
    add({
      rule: 'localisation-header-missing',
      severity: 'error',
      where: at(path, 1, 'localisation'),
      message: 'the first line is not an `l_<language>:` header.',
      suggestedFix: 'write `l_english:` on line 1.',
    });
  }
  if (keyLines === 0) {
    add({
      rule: 'localisation-empty',
      severity: 'error',
      where: at(path, null, 'localisation'),
      message: 'no `key:0 "value"` entry was found, so this localisation file defines nothing.',
      suggestedFix: 'add entries, or delete the file if it was a placeholder.',
    });
  }
  entry.language = language;
  entry.keys = keyLines;
}

/**
 * An event file: a path under `events/`, or a file whose TOP-LEVEL constructs are events.
 *
 * The content test must be on top-level keys only: a button_effects file that fires an event
 * writes `effect = { country_event = { ... } }`, and a line-based regex called that an events
 * file and then reported `event-file-empty` on a perfectly good button effect.
 */
function isEventFile(path, text) {
  const normalised = path.replace(/\\/g, '/').toLowerCase();
  if (normalised.includes('/events/')) return true;
  try {
    return parseParadox(text).roots.some((entry) => entry.key && EVENT_KEYS.has(entry.key.toLowerCase()) && entry.children);
  } catch {
    return false;
  }
}

const EVENT_KEYS = new Set([
  'country_event',
  'province_event',
  'planet_event',
  'fleet_event',
  'pop_event',
  'system_event',
  'observer_event',
  'event',
  // NOT `espionage_operation_event`: the OTHER event checks are about windows and options, and this
  // type is validated by `checkEspionageOperationTypesFile`'s own pass instead. See `eventIdsIn`.
]);

/**
 * Event files.
 *
 * The engine's own complaint here was
 * `Event geocentric_unga.4 has no options in events/zz_geocentric_unga_events.txt`: an event that
 * renders a `custom_gui` window still needs an `option` block, because the engine has no other
 * way to close it. The same pass checks that every key the event names exists in the localisation
 * keyset, which is how five referenced-but-undefined keys survived a 231-key localisation file.
 */
function checkEventFile(path, text, add, options) {
  let parsed;
  try {
    parsed = parseParadox(text);
  } catch (thrown) {
    add({
      rule: 'event-parse-error',
      severity: 'error',
      where: path,
      message: `the event file could not be read: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    });
    return;
  }
  const eventKeys = EVENT_KEYS;
  const locKeys = options.keyset?.keys ?? null;
  let events = 0;
  let optionCount = 0;

  /**
   * Walk an event (or button effect) for tooltip targets: `custom_tooltip = KEY`,
   * `fail_text = KEY`, and the block form `custom_tooltip = { fail_text = KEY <trigger> }`.
   * Their keys must resolve, or the engine draws nothing in the tooltip.
   */
  const scanTooltipTargets = (block, eventId) => {
    for (const child of block.children ?? []) {
      if (!child.key) continue;
      const lowered = child.key.toLowerCase();
      if (lowered === 'custom_tooltip' || lowered === 'fail_text') {
        if (child.children) {
          const failText = (child.children ?? []).find((inner) => inner.key && inner.key.toLowerCase() === 'fail_text');
          if (failText) requireKey(failText.value, 'custom_tooltip fail_text', at(path, failText.line, `event ${eventId}`), 'tooltip-key-missing-loc');
        } else if (typeof child.value === 'string' && child.value !== '') {
          requireKey(child.value, 'custom_tooltip', at(path, child.line, `event ${eventId}`), 'tooltip-key-missing-loc');
        }
      }
      if (child.children) scanTooltipTargets(child, eventId);
    }
  };
  const requireKey = (value, field, where, rule) => {
    if (typeof value !== 'string' || value === '') return;
    if (!locKeys) return;
    if (locKeys.has(value)) return;
    if (/[$\]]/.test(value)) return; // a composed/bracket expression, not a plain key
    add({
      rule,
      severity: 'warning',
      where,
      element: value,
      message:
        `\`${field} = ${value}\` is not a key in any indexed localisation file, so the engine will draw the raw ` +
        'string. The trial mod shipped 231 keys and still missed five that were referenced.',
      suggestedFix: `add \` ${value}:0 "..."\` to localisation/<language>/<file>_l_<language>.yml (UTF-8 WITH BOM).`,
    });
  };

  for (const root of parsed.roots) {
    if (!root.key || !eventKeys.has(root.key.toLowerCase()) || !root.children) continue;
    events += 1;
    const children = root.children;
    const idEntry = children.find((child) => child.key && child.key.toLowerCase() === 'id');
    const id = idEntry?.value ?? '(no id)';
    for (const field of ['title', 'desc']) {
      const entry = children.find((child) => child.key && child.key.toLowerCase() === field);
      if (entry) requireKey(entry.value, field, at(path, entry.line, `event ${id}`), 'event-missing-loc');
    }
    const optionBlocks = children.filter((child) => child.key && child.key.toLowerCase() === 'option' && child.children);
    if (optionBlocks.length === 0) {
      add({
        rule: 'event-without-option',
        severity: 'error',
        where: at(path, root.line, `event ${id}`),
        engineMessage: `Event ${id} has no options in ${path.replace(/\\/g, '/')}`,
        message:
          `\`${root.key}\` (id = ${id}) has no \`option\` block. The engine logs "Event ${id} has no options" and the ` +
          'event cannot be resolved: an event that only exists to show a `custom_gui` window still needs one, because ' +
          'the option is what closes the window.',
        suggestedFix: 'add: `option = { name = <loc key> trigger = { always = yes } }`.',
      });
    }
    for (const option of optionBlocks) {
      optionCount += 1;
      const nameEntry = (option.children ?? []).find((child) => child.key && child.key.toLowerCase() === 'name');
      if (!nameEntry) {
        add({
          rule: 'option-without-name',
          severity: 'error',
          where: at(path, option.line, `event ${id}`),
          message: `an \`option\` block in event ${id} has no \`name\`, so the button has no label.`,
          suggestedFix: 'add `name = <loc key>` to the option block.',
        });
        continue;
      }
      requireKey(nameEntry.value, 'option name', at(path, nameEntry.line, `event ${id}`), 'option-name-missing-loc');
    }

    // TOOLTIP TARGETS ANYWHERE INSIDE THE EVENT. `custom_tooltip` and `fail_text` ARE script
    // fields and are perfectly legal here (unlike on a .gui element, where the engine rejects
    // them as "Unexpected token"). Every key they name must exist, or the engine logs
    //   Missing localization key [unga_requires_influence] for custom tooltip fail_text at ...
    // - which is how five undefined keys survived a 231-key localisation file.
    scanTooltipTargets(root, id);
    // `custom_gui` shows a containerWindowType. `diplomatic = yes` is a CONVENTION and a WINDOW-CLASS
    // choice, not a requirement: measured in a loaded game on 2026-10-06, the field resolves without
    // it and the engine builds a different event-window class (PROBE-RESULTS.md section 4). What is a
    // requirement is that the NAME exists - an unresolvable one is a crash on the diplomatic path
    // (GAP-17), which is why the name is checked against the index below.
    const customGui = children.find((child) => child.key && child.key.toLowerCase() === 'custom_gui');
    if (customGui) {
      const diplomatic = children.find((child) => child.key && child.key.toLowerCase() === 'diplomatic');
      const diplomaticYes = Boolean(diplomatic) && !/^(no|false)$/i.test(String(diplomatic.value ?? '').trim());
      if (!diplomatic) {
        add({
          rule: 'custom-gui-without-diplomatic',
          severity: 'warning',
          where: at(path, customGui.line, `event ${id}`),
          message:
            `\`custom_gui = "${customGui.value}"\` is set without \`diplomatic = yes\`. Over the install's ` +
            '`events/*.txt`, no event that names a `custom_gui` omits it, so this departs from the convention - and ' +
            'from the window CLASS the engine picks: measured in a loaded game on 2026-10-06, the field is accepted ' +
            'without it and a NON-diplomatic event window is built instead. Keep it unless that is what you want.',
          suggestedFix: 'add `diplomatic = yes` to the event (vanilla never omits it).',
        });
      }
      const windowName = String(customGui.value ?? '').replace(/^"|"$/g, '');
      const definedInGui = options.guiTexts.some((gui) => new RegExp(`name\\s*=\\s*"${windowName}"`).test(gui));
      // THE CHECK ONLY REPORTS WHAT IT COULD LOOK AT. With no indexed roots and no `.gui` file passed
      // alongside, there is nothing to resolve the name against and "names no container" would be a
      // claim about a search that never ran. An INDEX that was consulted counts even when its own
      // container map is empty, which is the same distinction `checkFiles` draws for a caller's keyset.
      const lookedSomewhere = options.assetsIndexed === true || options.guiTexts.length > 0;
      if (windowName && lookedSomewhere && !definedInGui && !options.knownContainers.has(windowName)) {
        // GAP-17, GRADED BY PATH, because the measurement is path-dependent. On a `diplomatic = yes`
        // event the engine logs ONE informational line (`gui.cpp:1057: Tried to get gui_type [...] which
        // does not exist`), substitutes interface/popup.gui's `ok_popup_window`, then demands the
        // diplomatic window's ten hardcoded element names INSIDE that popup (ten containerwindow.h:88
        // lines) and null-dereferences: EXCEPTION_ACCESS_VIOLATION, the project's original crash class,
        // same fault address and a byte-identical stack body (run F and the v2 run).
        //
        // Without `diplomatic` the same name writes NOTHING AT ALL - not even the lookup line - and the
        // engine draws the ORDINARY DEFAULT EVENT WINDOW, which is not the `ok_popup_window` substitute
        // the diplomatic path uses (v2 run; PROBE-RESULTS.md section 10.1). So the error/warning split is
        // a measurement, not a preference. Either way the name cannot be resolved by watching the log:
        // the engine does not resolve it at load time, and on the diplomatic path the process is dead by
        // the time it does.
        add({
          rule: 'custom-gui-unknown-window',
          severity: diplomaticYes ? 'error' : 'warning',
          where: at(path, customGui.line, `event ${id}`),
          ...(diplomaticYes ? { engineMessage: `Tried to get gui_type [${windowName}] which does not exist` } : {}),
          message:
            `\`custom_gui = "${windowName}"\` names no \`containerWindowType\` in the indexed roots and none in the .gui ` +
            'files passed alongside it. Nothing validates the name, on either path, at load time or at build time: ' +
            (diplomaticYes
              ? 'on a `diplomatic = yes` event the engine substitutes interface/popup.gui\'s `ok_popup_window`, demands ' +
                'the diplomatic window\'s ten hardcoded element names inside that popup, and CRASHES with ' +
                'EXCEPTION_ACCESS_VIOLATION (measured in game 2026-10-06, twice: same fault address, byte-identical ' +
                'stack body, and the same stack as this project\'s original contract crash). This is an ERROR for ' +
                'that reason.'
              : 'without `diplomatic = yes` the engine writes nothing about it - NOT EVEN the lookup line - and draws ' +
                'the ordinary default event window instead of the one the event named (measured in game 2026-10-06), ' +
                'so this is a warning: what appears is not what the event asked for, and nothing says so.'),
          suggestedFix:
            `check the name with gui_interface_inventory { kind: "containers" }, or add the containerWindowType to the ` +
            'mod\'s own interface/*.gui.',
        });
      }
    }
  }
  if (events === 0) {
    add({
      rule: 'event-file-empty',
      severity: 'warning',
      where: path,
      message:
        'no `country_event` / `province_event` / `planet_event` block was found in this file. (An `espionage_operation_event` ' +
        'is a valid event type of its own and is not one of those: a file holding only operation events is reported here, and ' +
        'its stage events are resolved by the espionage-operation checks instead.)',
    });
  }
  void optionCount;
}

/** `common/button_effects/*.txt`, or any `.txt` under `common/` that is not an events file. */
function isButtonEffectsFile(path) {
  const normalised = path.replace(/\\/g, '/').toLowerCase();
  return normalised.includes('button_effects') || normalised.includes('/common/');
}

/** `common/espionage_operation_types/*.txt` - a schema of its own, checked before the generic rule. */
function isEspionageOperationTypesFile(path) {
  return path.replace(/\\/g, '/').toLowerCase().includes('/espionage_operation_types/');
}

/**
 * Every event id declared by an event-file text, keyed to the block KEY that declares it.
 *
 * A block is an event when its key ends in `_event` (or is `event`) and it has an `id` child - which
 * covers `espionage_operation_event`, the type the operation schema names, without adding it to
 * `EVENT_KEYS` and changing what the window/option checks consider an event.
 *
 * @param {string} text
 * @param {Map<string, string>} into id -> the declaring key, e.g. `my_op.1` -> `espionage_operation_event`
 */
function eventIdsIn(text, into) {
  let parsed;
  try {
    parsed = parseParadox(text);
  } catch {
    return into;
  }
  for (const root of parsed.roots) {
    if (!root.key || !root.children) continue;
    const lowered = root.key.toLowerCase();
    if (lowered !== 'event' && !lowered.endsWith('_event')) continue;
    const id = (root.children ?? []).find((child) => child.key && child.key.toLowerCase() === 'id');
    const value = id ? String(id.value ?? '').replace(/^"|"$/g, '') : '';
    if (value) into.set(value, root.key);
  }
  return into;
}

/**
 * `common/espionage_operation_types/*.txt`: the engine validates these AT LOAD and says so.
 *
 * Measured in a loaded game on 2026-10-06 (DOORS-RESULTS.md section 6.2, probe mod
 * `<mods>/gui_probe_doors_e`), verbatim from `error.log`:
 *
 *   [08:47:42][espionage_operation_type.cpp:407]: Espionage operation 'probe_doors_e_bad_operation'
 *     does not have the expected number of stages.
 *   [08:47:42][espionage_operation_type.cpp:529]: Espionage operation 'probe_doors_e_bad_operation'
 *     has no on_roll_failed, operation will never progress
 *
 * and two more exist in the binary that the probe never reached:
 *
 *   %s espionage operation stage #%i: Invalid event '%s'
 *   %s espionage operation stage #%i: Invalid event type for event '%s'. Expected: %s, actual: %s
 *
 * The first two become ERRORS here - the engine names the key and the fault at file load. The third
 * becomes a WARNING with a stated limit: an id the caller's files do not define is "unresolved", not
 * "wrong", because the engine resolves ids after the whole `events/` tree is loaded. The fourth is NOT
 * checked: grading a stage event's TYPE needs the event's own definition, and an id that resolves to
 * nothing cannot be told from an id defined in a file the caller did not pass - guessing there would
 * report a working mod as broken. See `espionage-operation-types-are-checked-at-load`.
 *
 * The install agrees with the reading: 27 top-level operations across the three shipped files, all 27
 * with `stages` equal to their `stage` block count, an `on_roll_failed`, and an `event` on every stage.
 */
function checkEspionageOperationTypesFile(path, text, add, entry, eventIndex) {
  let parsed;
  try {
    parsed = parseParadox(text);
  } catch (thrown) {
    add({
      rule: 'event-parse-error',
      severity: 'error',
      where: path,
      message: `the operation-type file could not be read: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    });
    return;
  }
  const operations = [];
  const seen = new Map();
  for (const root of parsed.roots) {
    // Top-level `key = { }` blocks only, and never an `@variable` line: the engine's database is the
    // set of named blocks, and a scalar root is not one of them.
    if (!root.key || !root.children || root.key.startsWith('@')) continue;
    operations.push(root);
    if (seen.has(root.key)) {
      add({
        rule: 'espionage-operation-duplicate-key',
        severity: 'warning',
        where: at(path, root.line, `operation ${root.key}`),
        element: root.key,
        message:
          `\`${root.key}\` is defined twice in this file (first at line ${seen.get(root.key)}). The engine's object database keeps ` +
          'one, and the one that loses is dead content.',
        suggestedFix: 'delete the duplicate, or rename one of the two operations.',
      });
    } else {
      seen.set(root.key, root.line);
    }
  }
  entry.espionageOperations = operations.map((operation) => operation.key);
  // The events index is EMPTY when the caller passed no event file - and an empty index must not be
  // read as "the event does not exist" (the same distinction `custom-gui-unknown-window` draws
  // between "I searched and found nothing" and "I could not search").
  const eventsIndexed = eventIndex instanceof Map && eventIndex.size > 0;
  for (const operation of operations) {
    const children = operation.children ?? [];
    const stageBlocks = children.filter((child) => child.key && child.key.toLowerCase() === 'stage' && child.children);
    const declared = children.find((child) => child.key && child.key.toLowerCase() === 'stages');
    const declaredCount = declared ? Number(String(declared.value ?? '').trim()) : null;
    const where = at(path, operation.line, `operation ${operation.key}`);
    if (!declared || !Number.isFinite(declaredCount)) {
      add({
        rule: 'espionage-operation-stage-count',
        severity: 'error',
        where,
        element: operation.key,
        message:
          `\`${operation.key}\` declares no numeric \`stages\`, and defines ${stageBlocks.length} \`stage\` block(s). The install's own ` +
          'field table says `stages = <int> # Should match number of defined stages below.`, and the engine checks it at load: ' +
          `"Espionage operation '${operation.key}' does not have the expected number of stages." ` +
          '(espionage_operation_type.cpp:407, measured in game 2026-10-06).',
        suggestedFix: `add \`stages = ${stageBlocks.length}\` to the operation, matching its ${stageBlocks.length} \`stage\` block(s).`,
      });
    } else if (declaredCount !== stageBlocks.length) {
      add({
        rule: 'espionage-operation-stage-count',
        severity: 'error',
        where: at(path, declared.line, `operation ${operation.key}`),
        element: operation.key,
        engineMessage: `Espionage operation '${operation.key}' does not have the expected number of stages.`,
        message:
          `\`${operation.key}\` declares \`stages = ${declaredCount}\` but defines ${stageBlocks.length} \`stage\` block(s). The engine ` +
          'validates this at file load and names the key, verbatim: ' +
          `"Espionage operation '${operation.key}' does not have the expected number of stages." ` +
          '(espionage_operation_type.cpp:407, measured in game 2026-10-06).',
        suggestedFix: `make them agree: \`stages = ${stageBlocks.length}\`, or add ${Math.abs(declaredCount - stageBlocks.length)} more \`stage\` block(s).`,
      });
    }
    const hasRollFailed = children.some((child) => child.key && child.key.toLowerCase() === 'on_roll_failed');
    if (!hasRollFailed) {
      add({
        rule: 'espionage-operation-no-on-roll-failed',
        severity: 'error',
        where,
        element: operation.key,
        engineMessage: `Espionage operation '${operation.key}' has no on_roll_failed, operation will never progress`,
        message:
          `\`${operation.key}\` has no \`on_roll_failed\` block. The engine validates this at file load, verbatim: ` +
          `"Espionage operation '${operation.key}' has no on_roll_failed, operation will never progress" ` +
          '(espionage_operation_type.cpp:529, measured in game 2026-10-06). A failed roll has nothing to run, so the operation stalls.',
        suggestedFix: 'add `on_roll_failed = { ... }` (scope: this = spy operation).',
      });
    }
    for (const stage of stageBlocks) {
      const event = (stage.children ?? []).find((child) => child.key && child.key.toLowerCase() === 'event');
      const eventId = event ? String(event.value ?? '').replace(/^"|"$/g, '') : '';
      if (!eventId) {
        add({
          rule: 'espionage-operation-stage-event-unresolved',
          severity: 'warning',
          where: at(path, stage.line, `operation ${operation.key}`),
          element: operation.key,
          message:
            `a \`stage\` block in \`${operation.key}\` has no \`event\`. The stage fires the event named there when it finishes, so this ` +
            'stage cannot report anything back into the operation view.',
          suggestedFix: 'add `event = <an espionage_operation_event id>` to the stage block.',
        });
        continue;
      }
      if (eventsIndexed && !eventIndex.has(eventId)) {
        add({
          rule: 'espionage-operation-stage-event-unresolved',
          severity: 'warning',
          where: at(path, event.line, `operation ${operation.key}`),
          element: eventId,
          message:
            `\`event = ${eventId}\` in \`${operation.key}\` is not among the ${eventIndex.size} events read from the files passed alongside ` +
            'this one. The engine reports an unresolvable stage event as `... espionage operation stage #%i: Invalid event \'%s\'` ' +
            '(a literal in stellaris.exe, not triggered by this project\'s probe). This is a warning because the event may simply live in a ' +
            'file the caller did not pass - only ids the checker could see are graded.',
          suggestedFix: 'check the id against the mod\'s events/, or pass that events file to gui_check_files as well.',
        });
      }
    }
  }
  if (operations.length === 0) {
    // `common/espionage_operation_types/example.txt` in the install is 100% COMMENTED-OUT
    // documentation - a template file the engine never registers anything from - so an empty file is
    // an INFO for the author to read, not a warning about content the engine was expecting.
    add({
      rule: 'espionage-operation-file-empty',
      severity: 'info',
      where: path,
      message:
        'no top-level operation definition (`key = { ... }`) was found - every line is a comment, or the file defines none. The ' +
        "install's own `common/espionage_operation_types/example.txt` is exactly that: the field table as comments, registering " +
        'nothing. Fine as documentation; a mod file with no operation in it adds nothing to the panel.',
      suggestedFix: 'write `my_operation = { stages = <n> stage = { } on_roll_failed = { } ... }`, or delete the file.',
    });
  }
}

/** `common/button_effects/*.txt`: every top-level key is a bare identifier an element can name. */
function checkButtonEffectsFile(path, text, add, entry, locKeyset) {
  const parsed = parseParadox(text);
  const keys = [];
  for (const root of parsed.roots) {
    if (!root.key) continue;
    if (!/^[a-z][a-z0-9_]*$/.test(root.key)) {
      add({
        rule: 'button-effect-key-shape',
        severity: 'error',
        where: at(path, root.line, 'button_effects'),
        element: root.key,
        message: `\`${root.key}\` is not a valid button-effect key: it must be lower-case letters, digits and underscores.`,
        suggestedFix: 'rename the key; `effectbuttonType.effect` names it verbatim.',
      });
      continue;
    }
    if (!root.children) {
      add({
        rule: 'button-effect-not-a-block',
        severity: 'error',
        where: at(path, root.line, 'button_effects'),
        element: root.key,
        message: `\`${root.key}\` is a scalar, not a block. An effect key needs \`potential\` and \`effect\` blocks.`,
        suggestedFix: 'write `key = { potential = { always = yes } effect = { ... } }`.',
      });
      continue;
    }
    const hasEffect = (root.children ?? []).some((child) => child.key && child.key.toLowerCase() === 'effect');
    if (!hasEffect) {
      add({
        rule: 'button-effect-without-effect',
        severity: 'error',
        where: at(path, root.line, 'button_effects'),
        element: root.key,
        message: `\`${root.key}\` has no \`effect\` block, so the button does nothing when clicked.`,
        suggestedFix: 'add `effect = { ... }` (and `potential = { always = yes }` if it should always show).',
      });
    }
    keys.push(root.key);

    // The effect body is real script, and the engine parses it: a shape it does not know is
    // "Unexpected token: <key>" at load time, which no .gui check can see.
    checkScriptShapes(root, path, root.key, add);

    // Tooltip targets, which live in the effect/potential blocks of a button effect.
    for (const field of ['custom_tooltip', 'fail_text', 'tooltip', 'tooltipText', 'pdx_tooltip', 'pdx_tooltip_delayed']) {
      walkValues(root, field, (value, line) => {
        requireLocKey(value, field, at(path, line, 'button_effects'), add, locKeyset);
      });
    }
  }
  entry.buttonEffectKeys = keys;
}

/** Call `visit(value, line)` for every scalar assigned to `field` anywhere under `block`. */
function walkValues(block, field, visit) {
  for (const child of block.children ?? []) {
    if (!child.key) continue;
    if (child.key.toLowerCase() === field && !child.children && typeof child.value === 'string' && child.value !== '') {
      visit(child.value, child.line);
    }
    if (child.children) walkValues(child, field, visit);
  }
}

/** A script-level loc key check, for button effects (the engine reports these as missing keys). */
function requireLocKey(value, field, where, add, keyset) {
  if (!keyset) return;
  if (keyset.has(value)) return;
  if (/[$\]]/.test(value)) return;
  add({
    rule: 'tooltip-key-missing-loc',
    severity: 'warning',
    where,
    element: value,
    message:
      `\`${field} = ${value}\` is not a key in any indexed localisation file. The engine logs ` +
      `"Missing localization key [${value}] for custom tooltip" and the tooltip is empty in game.`,
    suggestedFix: `add \` ${value}:0 "..."\` to localisation/<language>/<file>_l_<language>.yml (UTF-8 WITH BOM).`,
  });
}

/**
 * Effect shapes the engine's script parser rejects.
 *
 * Measured: `add_resource` takes the resource NAME as the key -
 * `add_resource = { influence = 30 }`, 1161 uses in the 4.4.6 install - and the older
 * `add_resource = { resource = influence amount = 30 }` form is an error:
 *   [effect.cpp:471]: Error: "Unexpected token: resource, near line: 130
 *   Unexpected token: amount, near line: 131" in common/button_effects/zz_....txt
 */
function checkScriptShapes(block, path, key, add) {
  for (const child of block.children ?? []) {
    if (!child.key || !child.children) continue;
    const lowered = child.key.toLowerCase();
    if (lowered === 'add_resource') {
      const inner = child.children.filter((entry) => entry.key);
      const legacy = inner.filter((entry) => ['resource', 'amount'].includes(entry.key.toLowerCase()));
      if (legacy.length > 0) {
        add({
          rule: 'effect-add-resource-shape',
          severity: 'error',
          where: at(path, inner[0].line, `button_effects ${key}`),
          element: key,
          engineMessage: `Unexpected token: ${inner[0].key}`,
          message:
            `\`add_resource\` in \`${key}\` uses \`${inner.map((entry) => entry.key).join('` / `')}\`. In 4.4.6 the resource ` +
            'NAME is the key: `add_resource = { influence = 30 }` (1161 uses in the install). The `resource =` / ' +
            '`amount =` pair is the older form and the engine reports "Unexpected token: resource" / ' +
            '"Unexpected token: amount" and applies nothing.',
          suggestedFix: `write \`add_resource = { <resource> = <amount> }\`, e.g. \`add_resource = { influence = ${legacy.find((entry) => entry.key.toLowerCase() === 'amount')?.value ?? 0} }\`.`,
        });
      }
    }
    checkScriptShapes(child, path, key, add);
  }
}

export { hasBom, readFileSync };
export default { checkFiles };
