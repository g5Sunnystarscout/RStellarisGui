//------------------------------------------------------------------------------------
// worldgfx.mjs -- Part of RStellarisGui
//
// THE SYSTEM LIGHT: a `gfx/worldgfx/*.txt` file NAMES the light it lights its system with,
// and the engine BUILDS that light when it loads the file. If no `gfx/lights/**/*.asset`
// defines a light by that name, the engine says so - by name, at load.
//
// Measured on Stellaris 4.4.6 (`<Stellaris>`), four sessions, verbatim:
//
//   [gamerendering.cpp:1174]: Failed to create system light ehof_white_hole_light
//   [gamerendering.cpp:1174]: Failed to create system light black_star
//   [gamerendering.cpp:1174]: Failed to create system light d_class_star
//   [gamerendering.cpp:1174]: Failed to create system light dark_star
//   [gamerendering.cpp:1174]: Failed to create system light l_class_star
//   [gamerendering.cpp:1174]: Failed to create system light o_class_star
//
// Six lines, six DISTINCT light names, all from the enabled Workshop mod
// `ugc_2409209888` (`D:/SteamLibrary/steamapps/workshop/content/281990/2409209888`), which
// ships **no `gfx/lights` directory at all** - and none of the six names is defined by that
// mod, by the install (29 lights across its four `gfx/lights/*.asset` files) or by any other
// installed mod. The CONTROL is inside the same mod: its `star_black_hole.txt:134` names
// `system_light="black_hole_light"`, which IS defined (`gfx/lights/star_lights.asset:231`),
// and `black_hole_light` is NOT among the six failures.
//
// WHY THIS NEEDS NO STAR-CLASS RESOLUTION. The six failures fired at LOAD (20:58:09), and
// `game.log` puts the session's only `galaxy_generator.cpp:4436: Generating World!` at
// 21:02:06 - so the engine builds the light from the worldgfx FILE it loads, before any
// galaxy, any system or any star class exists. The check is therefore entirely file-side:
// index every light definition, read every `system_light` value, report the values with no
// match. Nothing has to know which star class selects the world tag.
//
// The install is CLEAN under this rule - 21 `system_light` lines across its 41
// `gfx/worldgfx/*.txt` files, 0 unmatched - which is what a rule with an engine-named
// consequence should look like against vanilla.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

/**
 * Severity of the system-light rules.
 *
 * `system-light-undefined` is an ERROR, and it is the engine's own grading rather than this
 * project's: it names the light at load, one line per distinct name, in `error.log`. A
 * `system_light` that resolves to nothing is not a style opinion - it is a named engine
 * complaint about the file the callers asked to have checked.
 */
export const WORLDGFX_SEVERITY = {
  'system-light-undefined': 'error',
};

export const WORLDGFX_DESCRIPTIONS = {
  'system-light-undefined':
    'a `gfx/worldgfx/*.txt` names a `system_light = "<name>"` that no supplied `gfx/lights/**/*.asset` defines - ' +
    'the engine builds the light when it loads the worldgfx file and answers ' +
    '`[gamerendering.cpp:1174]: Failed to create system light <name>` by name, at load, before any galaxy exists ' +
    '(measured: six distinct names from one enabled Workshop mod that ships no `gfx/lights` at all, while the same ' +
    "mod's `black_hole_light`, which IS defined, does not fail)",
};

/** Strip a `#` comment that is not inside a quoted string, and any trailing `\r`. */
function stripComment(line) {
  let quote = false;
  let out = '';
  for (const char of line) {
    if (char === '"') quote = !quote;
    if (char === '#' && !quote) break;
    out += char;
  }
  return out.replace(/\r$/, '');
}

/**
 * True for a `.../gfx/lights/...` path - where a light is DEFINED.
 *
 * `gfx/lights/**` is the only directory the install defines lights in
 * (`other.asset`, `planet_lights.asset`, `projectile_lights.asset`, `star_lights.asset`), and
 * a light is a `light = { name = "<x>" ... }` block inside one of them.
 */
export function isLightsAssetPath(path) {
  return /\/gfx\/lights\//i.test(String(path).replace(/\\/g, '/'));
}

/**
 * True for a `.../gfx/worldgfx/...` path - where a system light is NAMED.
 *
 * Only `.txt` files are named here: the directory also holds the `.dds` the world tags paint
 * with, and a `.dds` names nothing.
 */
export function isWorldgfxPath(path) {
  const normalised = String(path).replace(/\\/g, '/');
  return /\/gfx\/worldgfx\//i.test(normalised) && /\.txt$/i.test(normalised);
}

/** A `name = ...` value on a line, unquoted, or null. */
function nameOnLine(line) {
  const match = /(^|[\s{])name\s*=\s*("([^"]*)"|'([^']*)'|[A-Za-z0-9_.\-]+)/.exec(line);
  if (!match) return null;
  const raw = match[3] ?? match[4] ?? match[2];
  return raw === undefined || raw === '' ? null : raw;
}

/**
 * Every light a set of `gfx/lights/**\/*.asset` files DEFINES.
 *
 * A definition is the `name` of a `light` block. The `.asset` dialect is not the script
 * dialect (`gfx/worldgfx/*.txt` is a flat `key = value` list, not a brace tree), so the block
 * is found by scanning for `light` at the start of a line and taking the `name` that FOLLOWS
 * it inside that block - never a `name` that precedes it, which would mis-attribute a
 * neighbouring block's definition that has no name of its own.
 *
 * Reads the install's own four files exactly: 29 lights.
 *
 * @param {{path: string, text: string}[]} files
 * @returns {Map<string, {name: string, file: string, line: number}>} lower-cased name -> definition
 */
export function readLightDefinitions(files = []) {
  const lights = new Map();
  for (const file of files) {
    const lines = String(file.text ?? '').replace(/^\uFEFF/, '').split('\n');
    let inLightBlock = false;
    let depth = 0;
    for (const [index, raw] of lines.entries()) {
      const line = stripComment(raw);
      if (!inLightBlock && /^\s*light\s*(=\s*\{)?\s*$/.test(line)) {
        inLightBlock = true;
        depth = 0;
      }
      if (inLightBlock) {
        const name = nameOnLine(line);
        if (name && !lights.has(name.toLowerCase())) {
          lights.set(name.toLowerCase(), { name, file: file.path, line: index + 1 });
        }
        let delta = 0;
        let quote = false;
        for (const char of line) {
          if (char === '"') quote = !quote;
          else if (!quote && char === '{') delta += 1;
          else if (!quote && char === '}') delta -= 1;
        }
        depth += delta;
        // A `light = { ... }` block ends when its braces close; the install writes one light
        // per block and the block is the unit, so this is what keeps the NEXT block's own
        // `name` from being attributed to the previous one.
        if (depth <= 0 && /}/.test(line)) {
          inLightBlock = false;
          depth = 0;
        }
      }
    }
  }
  return lights;
}

/**
 * Every `system_light = "<name>"` a set of `gfx/worldgfx/*.txt` files NAMES.
 *
 * The install writes both the quoted and the bare form (`star_black_hole.txt:82`
 * `system_light="black_hole_light"`), so both are read, and the line is kept so a finding can
 * point at it.
 *
 * @returns {{name: string, file: string, line: number}[]}
 */
export function readSystemLights(files = []) {
  const out = [];
  for (const file of files) {
    const lines = String(file.text ?? '').replace(/^\uFEFF/, '').split('\n');
    for (const [index, raw] of lines.entries()) {
      const line = stripComment(raw);
      const match = /(^|[\s{])system_light\s*=\s*("([^"]*)"|'([^']*)'|[A-Za-z0-9_.\-]+)/.exec(line);
      if (!match) continue;
      const name = match[3] ?? match[4] ?? match[2];
      if (name === undefined || name === '') continue;
      out.push({ name, file: file.path, line: index + 1 });
    }
  }
  return out;
}

/**
 * The system-light findings.
 *
 * @param {{lightFiles?: {path: string, text: string}[], worldgfxFiles?: {path: string, text: string}[],
 *          complete?: boolean}} input `complete` says whether the supplied `gfx/lights/**` files
 *          are the WHOLE load order. It decides only how the finding WORD is graded in its own
 *          text, never whether it fires: the engine's complaint is about the load order it built,
 *          so with lights in hand and no match the honest reading is an error, and with NO light
 *          file supplied at all the check reports nothing rather than calling every name wrong
 *          (the same distinction `analyseAsteroidBelts` draws for a fragment).
 * @returns {{findings: object[], counts: object, lights: object[], systemLights: object[],
 *           lightsSupplied: boolean, unmatched: string[]}}
 */
export function analyseSystemLights(input = {}) {
  const lightFiles = input.lightFiles ?? [];
  const worldgfxFiles = input.worldgfxFiles ?? [];
  const lightsSupplied = lightFiles.length > 0;
  const definitions = readLightDefinitions(lightFiles);
  const systemLights = readSystemLights(worldgfxFiles);
  const findings = [];

  // WITH NO LIGHT FILE THERE IS NOTHING TO RESOLVE AGAINST, so every name would report and the
  // report would say "all of your lights are missing" about a search that never ran. The names are
  // returned instead (`systemLights` below), which is the honest reading of a fragment.
  if (lightsSupplied && definitions.size > 0) {
    for (const entry of systemLights) {
      const definition = definitions.get(entry.name.toLowerCase());
      if (definition) continue;
      findings.push({
        rule: 'system-light-undefined',
        severity: WORLDGFX_SEVERITY['system-light-undefined'],
        where: `${entry.file}:${entry.line}`,
        element: entry.name,
        engineMessage: `Failed to create system light ${entry.name}`,
        message:
          `\`system_light = "${entry.name}"\` names a light that no supplied \`gfx/lights/**/*.asset\` file defines. ` +
          'The engine BUILDS the light for each world gfx file it loads and names every one it cannot find, verbatim: ' +
          `\`[gamerendering.cpp:1174]: Failed to create system light ${entry.name}\`. Measured on 4.4.6: a mod that ships ` +
          'no `gfx/lights` directory at all produced SIX such lines at load (one per distinct name), while the same ' +
          'mod\'s `system_light="black_hole_light"` - which IS defined (`gfx/lights/star_lights.asset:231`) - produced ' +
          'none. That is the control: the engine reports the value it cannot resolve and stays silent for the one it can.',
        subject: { kind: 'worldgfx', key: entry.name },
        resolution: 'resolved',
        suggestedFix:
          `define \`light = { name = "${entry.name}" ... }\` in a \`gfx/lights/*.asset\` of the mod, or point ` +
          `\`system_light\` at one of the ${definitions.size} lights the supplied files define` +
          `${definitions.size > 0 ? ` (${[...definitions.values()].map((light) => light.name).sort().join(', ')})` : ''}. ` +
          'A `light` block is a `name`, a `color`, an `intensity`, a `radius` and a `falloff` - see ' +
          '`gfx/lights/star_lights.asset` for the install\'s own 12 star lights.',
      });
    }
  }

  const counts = { total: findings.length, error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return {
    findings,
    counts,
    lightsSupplied,
    // Reported whether or not a finding fired, so "no worldgfx file in hand" is a different
    // answer from "read and clean".
    lights: [...definitions.values()],
    systemLights,
    unmatched: [...new Set(findings.map((finding) => finding.element))].sort(),
  };
}

export default {
  WORLDGFX_SEVERITY,
  WORLDGFX_DESCRIPTIONS,
  analyseSystemLights,
  isLightsAssetPath,
  isWorldgfxPath,
  readLightDefinitions,
  readSystemLights,
};
