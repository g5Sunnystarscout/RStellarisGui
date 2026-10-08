//------------------------------------------------------------------------------------
// colonization.mjs -- Part of RStellarisGui
//
// WHAT CAN BE COLONIZED, AND WHAT ONLY LOOKS LIKE IT (Stellaris 4.4.6).
//
// The question this module answers, structurally: a claim about colonisation in Stellaris is a
// claim about a PLANET CLASS, and a claim about a ship that carries a colony is a claim about a
// SHIP SIZE. Neither lives in the `.gui`, and both are cheap to check against the install - so
// they are checked here rather than remembered by an agent.
//
// The facts this module rests on, all measured in the install (see the knowledge topic
// `ring-worlds-habitats-and-what-is-colonizable` for the full census):
//
//   1. `colonizable = yes` on a `common/planet_classes/**` block is the field that makes a BODY
//      colonisable, and the engine trigger `is_colonizable` reads it
//      (`logs/script_documentation/triggers.log:1148`). A star class that names such a class
//      (`planet = { key = pc_... }`) therefore puts a colonisable body in the STAR slot.
//   2. A `megastructure` has NO colonisability field at all. The census over all 164
//      `common/megastructures/**` blocks finds 75 distinct top-level keys and not one of them is
//      colonisability-related; a completed megastructure becomes a colony by SPAWNING a planet
//      (`spawn_planet = { class = ... }`) and removing itself.
//   3. `carries_colony = <planet_class>` on a ship size is the OTHER route: it turns the hull into
//      a mobile colony. The engine enforces two things about it and says so in its own error
//      strings: `"Arkship size %s does not have carries_colony"` and `"Arkship size %s does not
//      have class = shipclass_starbase"` (both literals in `stellaris.exe`), and the install
//      documents the second on the field itself (`common/ship_sizes/00_ship_sizes.txt:97-99`).
//   4. The class named by `carries_colony` must be a real, colonisable planet class, or the carrier
//      relation points at something the engine will not build a colony from - vanilla's ark ships
//      carry `pc_ark`, which is `colonizable = yes`
//      (`common/planet_classes/06_planet_classes_nomads.txt:94`).
//
// So two rules, both decided by comparing blocks rather than by a heuristic:
//
//   `carries-colony-without-starbase` (error)  - a ship size with `carries_colony` and no
//       `class = shipclass_starbase`. This is the engine's own refusal, quoted above; vanilla
//       writes both keys on all NINE starbase-class arkship hulls and on no other hull.
//   `carrier-colony-class-undefined` (error when the caller resolved the whole set, warning when
//       it supplied a fragment) - a `carries_colony` naming a class that is defined and
//       `colonizable = no`, or that is not defined at all. The second half is only an ERROR when
//       the caller passed every file that could define it; a single mod folder is not the whole
//       load order, and this project does not call a mod broken because it shipped half a pair.
//
// ASTEROIDS (the second half of the schema, added after measuring the install):
//
//   5. An `asteroid_belt = { ... }` block is a SCENERY DECLARATION, not a set of planets: it
//      carries exactly two fields in all 241 vanilla uses (`type`, `radius`), and its `type` names
//      a block in `common/asteroid_belts/**` which carries only `mesh`/`shader`/`width`/`density`.
//      The band is drawn by the renderer, so a `type` naming nothing is a band that renders as
//      whatever the fallback is rather than the one the author wrote - a real, silent defect.
//      `asteroid-belt-type-undefined` (error when `common/asteroid_belts/**` was among the
//      supplied files, warning otherwise, because a mod folder is not the whole load order).
//   6. A planet class carrying `asteroid = yes` is a MINOR PLANETARY BODY: vanilla's own
//      megastructures refuse to be placed on one (`fail_text = "requires_not_minor_planetary_body"`
//      is `NOR = { is_asteroid = yes is_moon = yes }`, 8 sites including habitats.txt:174-179), and
//      none of the six vanilla asteroid classes is colonisable. A mod may still mark one
//      colonisable on purpose, so `planet-asteroid-colonizable` is an INFO finding that names the
//      consequence rather than an error - but it must not be silent, because "asteroid = yes" and
//      "colonizable = yes" on one class is a claim about the same body twice.
//
// STAR SLOTS (the third half of the schema, added after measuring the install):
//
//   7. A system has as many star slots as its INITIALIZER writes star bodies for, and the star
//      class supplies the rest: `common/star_classes/**` declares the star slot bodies as a list of
//      `planet = { key = <planet class> }` blocks, one per slot (`00_star_classes.txt:230-261`
//      sc_binary_1 declares two, `:541-561` sc_trinary_1 declares three), and an initializer's own
//      `planet = { class = star }` blocks take the classes from that list in order. `example.txt:58`
//      states the model in the install's own words: "Stars are initialized as planets and then
//      classified as stars". Vanilla's 26 multi-star initializers write exactly as many star blocks
//      as their star class declares slots, and the two shapes that do NOT match are both vanilla and
//      both legal: `init_sol_geocentric` (`sol_initializers.txt:3659`) writes NO star block at all
//      and takes the single star from `sc_g`, and `great_wound_system`
//      (`distant_stars_initializers.txt:1260`) writes ELEVEN against `sc_black_hole`'s one.
//   8. The only thing that reaches a star slot from script is the SYSTEM: `star`, `system_star` and
//      `capital_star` all resolve to the PRIMARY star alone (`scopes.log:26/274/278`), there is no
//      `star_2`/`star_3` scope or trigger anywhere in `stellaris.exe`, and vanilla's own
//      `destroy_star_system` therefore walks the slots with
//      `every_system_planet = { limit = { is_star = yes } change_pc = pc_black_hole }`
//      (`00_scripted_effects.txt:4505-4520`). `is_primary_star` (`triggers.log:2621-2623`,
//      scopes `planet ship`) is the one trigger that tells the primary from the rest.
//   9. So a star slot is a NORMAL PLANET whose class carries `star = yes`, and the class named by
//      `planet = { key = ... }` may be anything - including a colonisable class, which is what both
//      of this project's own mods do. A slot naming a class no file defines is the defect this
//      module reports (`star-class-planet-undefined`), and an initializer naming a star class no
//      file defines is the other (`star-class-undefined`, the engine's own
//      `Failed to find star class or valid random_list by key: `).
//
// WHY THIS DOES NOT USE `parseParadox`: the game's own planet classes write a scalar block value -
// `atmosphere_color = hsv { 0.59 0.45 0.95 }` (`common/planet_classes/06_planet_classes_nomads.txt:81`)
// - and this repository's parser ends the ENCLOSING block at that value's closing brace, so every
// field after it (`colonizable = yes` at :94 among them) is reported at file scope. Measured with a
// minimal input: `pc_x = { atmosphere_color = hsv { 0.5 0.5 0.9 } colonizable = yes }` parses to
// `pc_x` holding only `atmosphere_color`, with `colonizable` a file-level root. A reader built on
// that parse silently sees `colonizable = null` for every vanilla planet class. This module
// therefore reads the two fields it needs with a brace-depth scan of its own, and states the bug
// rather than depending on it being fixed. It is a BUG in `parseParadox`, not a feature of the
// dialect: the engine reads `colonizable` as a child of the class block, and vanilla's own class
// definitions are laid out that way.
//
// This program is free software: you can redistribute it and/or modify it under the terms of
// the GNU Affero General Public License as published by the Free Software Foundation, either
// version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

// The RING WORLD reader (below) needs the body blocks an initializer places, and it needs them at
// any nesting depth - a ring segment is a depth-1 `planet`, but a `moon` and a nested `planet` are
// not. `scanScriptBlocks` is deliberately depth-1 only, and the repository's `parseParadoxTree` is
// the reader that survives a scalar block value such as `atmosphere_color = hsv { ... }` (the defect
// in `paradox.mjs` this project's readers exist to avoid), so the tree comes from there rather than
// from a second brace walk written here. `portraits.mjs` imports nothing from this module, so there
// is no cycle.
import { parseParadoxTree } from './portraits.mjs';

/**
 * Severity of the colonisation rules.
 *
 * `carries-colony-without-starbase` is an ERROR because the engine refuses the ship size by name -
 * a hard load-time refusal with a log line, not a style opinion.
 * `carrier-colony-class-undefined` is an ERROR only when the caller resolved the class from a
 * complete set; the finding says which case it is (see `resolution`).
 */
export const COLONIZATION_SEVERITY = {
  'carries-colony-without-starbase': 'error',
  'carrier-colony-class-undefined': 'error',
  'asteroid-belt-type-undefined': 'error',
  'planet-asteroid-colonizable': 'info',
  'star-class-planet-undefined': 'error',
  'ringworld-segment-orbit-inconsistent': 'warning',
  'ringworld-segment-class-undefined': 'error',
  // A colony with no population REVERTS to a colonisable planet, and the engine logs NOTHING when
  // it happens - so this is the one rule in this module whose defect has no engine message to quote.
  // It is a WARNING rather than an error because the check is BLOCK-SCOPED and therefore partial:
  // population created in a SIBLING block, or by a mechanism this reader does not model, is
  // invisible to it, and calling a working mod broken on an absence of evidence would be wrong.
  'create-colony-without-pops': 'warning',
};

export const COLONIZATION_DESCRIPTIONS = {
  'carries-colony-without-starbase':
    'a `common/ship_sizes/` block declares `carries_colony` without `class = shipclass_starbase`; the engine ' +
    'answers `"Arkship size %s does not have class = shipclass_starbase"` and the hull is not an ark ship',
  'carrier-colony-class-undefined':
    '`carries_colony` names a planet class that is `colonizable = no`, or that no supplied file defines - the ' +
    'carrier relation points at a class the engine cannot build a colony from (the field is documented at ' +
    '`common/ship_sizes/00_ship_sizes.txt:97-99`)',
  'asteroid-belt-type-undefined':
    'an `asteroid_belt = { type = <key> }` names a belt type no supplied `common/asteroid_belts/**` file defines - ' +
    'the belt is drawn from that type\'s `mesh` list, so the band is not the one the author wrote and nothing is logged',
  'planet-asteroid-colonizable':
    'a planet class carrying `asteroid = yes` also declares `colonizable = yes` - the engine will offer the colonise ' +
    'order, but a minor planetary body is excluded from every megastructure placement rule that says ' +
    '`requires_not_minor_planetary_body` (`NOR = { is_asteroid = yes is_moon = yes }`)',
  'star-class-planet-undefined':
    'a `common/star_classes/**` block\'s `planet = { key = <planet class> }` names a class no supplied ' +
    '`common/planet_classes/**` file defines - that block IS the body the engine puts in the star slot ' +
    '(`00_star_classes.txt:6`), so the slot has no class to resolve',
  'ringworld-segment-orbit-inconsistent':
    'a `common/solar_system_initializers/**` block places ring-world segments (`common/planet_classes/**` ' +
    'says `ringworld = yes`) at more than one `orbit_distance` - a ring is ONE circle at ONE radius, and ' +
    'every vanilla ring puts all its segments at the same one (`orbit_distance = 0` after a single ' +
    '`change_orbit = 45`), so an extra radius is a segment that cannot sit on the ring the rest describe',
  'ringworld-segment-class-undefined':
    'a `common/solar_system_initializers/**` `planet = { class = <x> }` names a class no supplied ' +
    '`common/planet_classes/**` file defines, and the initializer declares `ring_world_built` - the ' +
    '`has_star_flag` every vanilla ring-world system sets, which makes the block a ring-world system ' +
    'and the missing class a segment with no planet class at all',
  'create-colony-without-pops':
    'a scripted effect (or a file-level event) calls `create_colony` and neither that block nor anything it ' +
    'calls seeds population (`create_pop_group`) - a colony with zero population REVERTS to a colonisable ' +
    'planet once time runs, and the engine logs no line for it. BLOCK-SCOPED: population created in a sibling ' +
    'block, or by a mechanism this reader does not model, is invisible to the check, so the finding says what ' +
    'was searched rather than asserting the colony is doomed',
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

/** Net brace movement of a line, ignoring braces inside quoted strings. */
function braceDelta(line) {
  let quote = false;
  let delta = 0;
  for (const char of line) {
    if (char === '"') quote = !quote;
    else if (!quote && char === '{') delta += 1;
    else if (!quote && char === '}') delta -= 1;
  }
  return delta;
}

/** `key = value` on one line, or null. Value is unquoted; `@variable` reference values are skipped. */
function scalarOn(line) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\s{}]+)/.exec(line);
  if (!match) return null;
  const value = match[2].replace(/^"|"$/g, '');
  if (value.startsWith('@') || value.includes('$')) return null;
  return { key: match[1], value };
}

/**
 * The blocks of one Paradox script file at brace depth 1, as
 * `{key, line, closeLine, fields: Map<lowercased key, value>}`.
 *
 * Deliberately narrow: depth-1 blocks with their scalar fields. It is enough for the two schemas
 * this module reads and it does not have to guess at anything, which is why it is here rather than
 * shared with `paradox.mjs` (see the header: that parser mis-nests a scalar block value).
 */
export function scanScriptBlocks(text) {
  const blocks = [];
  let depth = 0;
  let current = null;
  const lines = String(text).replace(/^\uFEFF/, '').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = stripComment(lines[index]);
    const lineNumber = index + 1;
    const opener = depth === 0 ? /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/.exec(raw) : null;
    if (opener) {
      current = { key: opener[1], line: lineNumber, closeLine: null, fields: new Map() };
      blocks.push(current);
      depth = 1;
      // Everything after the opening brace on the same line still counts: a one-line block closes
      // immediately and has no fields to read.
      const rest = raw.slice(raw.indexOf('{'));
      depth += braceDelta(rest) - 1;
      if (depth <= 0) {
        current.closeLine = lineNumber;
        current = null;
        depth = 0;
      }
      continue;
    }
    if (depth === 1 && current) {
      const scalar = scalarOn(raw);
      if (scalar) current.fields.set(scalar.key.toLowerCase(), { value: scalar.value, line: lineNumber });
    }
    if (depth > 0) {
      depth += braceDelta(raw);
      if (depth <= 0) {
        if (current) current.closeLine = lineNumber;
        current = null;
        depth = 0;
      }
    }
  }
  return blocks;
}

/** The string value of a field, or null. */
function field(block, key) {
  return block.fields.get(key)?.value ?? null;
}

/** The line a field was written on, or the block's own line. */
function fieldLine(block, key) {
  return block.fields.get(key)?.line ?? block.line;
}

/**
 * The planet classes a set of `common/planet_classes/**` files defines.
 *
 * Only the fields that decide colonisation are read: `colonizable`, `colonizable_by_event`,
 * `star`, `habitat`, `ringworld`, `asteroid` and `district_set`. Everything else about a planet
 * class is art.
 */
export function readPlanetClasses(files) {
  const classes = new Map();
  for (const file of files) {
    for (const block of scanScriptBlocks(file.text)) {
      const colonizable = field(block, 'colonizable');
      const byEvent = field(block, 'colonizable_by_event');
      classes.set(block.key.toLowerCase(), {
        key: block.key,
        file: file.path,
        line: block.line,
        colonizableLine: fieldLine(block, 'colonizable'),
        colonizable: colonizable === null ? null : colonizable.toLowerCase() === 'yes',
        colonizableByEvent: byEvent !== null && byEvent.toLowerCase() === 'yes',
        star: (field(block, 'star') ?? 'no').toLowerCase() === 'yes',
        habitat: (field(block, 'habitat') ?? 'no').toLowerCase() === 'yes',
        ringworld: (field(block, 'ringworld') ?? 'no').toLowerCase() === 'yes',
        asteroid: (field(block, 'asteroid') ?? 'no').toLowerCase() === 'yes',
        asteroidLine: fieldLine(block, 'asteroid'),
        entity: field(block, 'entity'),
        entityLine: fieldLine(block, 'entity'),
        // A ring-world segment suppresses the orbit line through itself (`orbit_lines = no` on all
        // TEN vanilla `ringworld = yes` classes, 00_planet_classes.txt:1396 and nine relatives):
        // the segment's own mesh IS the ring, so the extra line would be drawn through it.
        orbitLines: field(block, 'orbit_lines'),
        orbitLinesLine: fieldLine(block, 'orbit_lines'),
        surveyTimeFactor: field(block, 'survey_time_factor'),
        districtSet: field(block, 'district_set'),
      });
    }
  }
  return classes;
}

/**
 * The belt types a set of `common/asteroid_belts/**` files defines.
 *
 * A belt type is pure scenery: measured over the install, its block carries only `mesh`
 * (repeated, one per rock variant), `shader`, `width` and `density`. There is no member list,
 * no planet class and no count anywhere in the schema - which is the fact this reader exists to
 * keep honest.
 */
export function readAsteroidBeltTypes(files) {
  const types = new Map();
  for (const file of files) {
    for (const block of scanScriptBlocks(file.text)) {
      types.set(block.key.toLowerCase(), {
        key: block.key,
        file: file.path,
        line: block.line,
        meshes: countRepeatedKey(file.text, block, 'mesh'),
        shader: field(block, 'shader'),
        width: field(block, 'width'),
        density: field(block, 'density'),
      });
    }
  }
  return types;
}

/**
 * How many times a repeated key (a Paradox list IS a repeated key: `mesh = "a"` `mesh = "b"`) is
 * written inside one block. `scanScriptBlocks` keeps the LAST scalar for a key, so a count of the
 * rock variants has to be taken from the source lines the block spans.
 */
function countRepeatedKey(text, block, key) {
  const lines = String(text).replace(/^\uFEFF/, '').split('\n');
  const last = block.closeLine ?? lines.length;
  const pattern = new RegExp(`^\\s*${key}\\s*=`, 'i');
  return lines
    .slice(block.line - 1, last)
    .filter((line) => pattern.test(stripComment(line))).length;
}

/**
 * Every `asteroid_belt = { ... }` block in one file, with the fields inside it.
 *
 * A belt is written INSIDE a `solar_system_initializer`, beside that initializer's `planet` entries
 * and usually first (all 241 vanilla uses), so a depth-1 reader never sees one. Rather than
 * generalise `scanScriptBlocks` - whose single-level rule the planet-class and ship-size schemas
 * depend on - this walks the file's braces once and takes every `asteroid_belt` opener it meets,
 * whatever its nesting depth. The keyword is a block name in exactly one schema, so "any depth" is
 * not a guess: a `.gui`, a localisation file or a scripted effect that passes through here has no
 * such opener and contributes nothing.
 */
function asteroidBeltBlocks(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split('\n');
  const belts = [];
  let depth = 0;
  let current = null;
  let currentDepth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = stripComment(lines[index]);
    if (!current) {
      const opener = /^\s*asteroid_belt\s*=\s*\{/.exec(raw);
      if (opener) {
        current = { line: index + 1, fields: new Map() };
        belts.push(current);
        currentDepth = depth;
        depth += 1;
        // Everything after the opening brace on the SAME line is body; a one-line belt closes here.
        depth += braceDelta(raw.slice(raw.indexOf('{'))) - 1;
        if (depth <= currentDepth) current = null;
        continue;
      }
      depth += braceDelta(raw);
      continue;
    }
    if (depth === currentDepth + 1) {
      const scalar = scalarOn(raw);
      if (scalar) current.fields.set(scalar.key.toLowerCase(), { value: scalar.value, line: index + 1 });
    }
    depth += braceDelta(raw);
    if (depth <= currentDepth) {
      current = null;
      currentDepth = depth;
    }
  }
  return belts;
}

/**
 * Every `asteroid_belt = { ... }` block in a set of script files, with the fields inside it.
 *
 * The keyword is a `solar_system_initializer` field, and it is also legal at the top level of a
 * file, so both shapes are read; see `asteroidBeltBlocks`.
 */
export function readAsteroidBelts(files) {
  const belts = [];
  for (const file of files) {
    for (const belt of asteroidBeltBlocks(file.text)) {
      belts.push({
        file: file.path,
        line: belt.line,
        type: belt.fields.get('type')?.value ?? null,
        typeLine: belt.fields.get('type')?.line ?? belt.line,
        radius: belt.fields.get('radius')?.value ?? null,
        fields: [...belt.fields.keys()],
      });
    }
  }
  return belts;
}

/**
 * The asteroid findings, over a set of belt-type definition files and the script files that place
 * belts.
 *
 * @param {{asteroidBeltFiles?: {path: string, text: string}[], scriptFiles?: {path: string, text: string}[],
 *          complete?: boolean}} input `complete` says whether `asteroidBeltFiles` is the WHOLE load
 *          order, which decides whether an unknown belt type is an error or a warning.
 */
export function analyseAsteroidBelts(input = {}) {
  const definitions = readAsteroidBeltTypes(input.asteroidBeltFiles ?? []);
  const belts = readAsteroidBelts(input.scriptFiles ?? []);
  const definitionsSupplied = (input.asteroidBeltFiles ?? []).length > 0;
  const findings = [];

  for (const belt of belts) {
    if (belt.type === null) continue; // no `type` at all: the engine's documented default applies
    const target = definitions.get(String(belt.type).toLowerCase());
    if (target) continue;
    findings.push({
      rule: 'asteroid-belt-type-undefined',
      severity: input.complete === true && definitionsSupplied ? 'error' : 'warning',
      where: `${belt.file}:${belt.typeLine ?? belt.line}`,
      message:
        `\`asteroid_belt = { type = ${belt.type} }\` names a belt type that no supplied ` +
        '`common/asteroid_belts/**` file defines. A belt type is a list of meshes ' +
        '(`common/asteroid_belts/00_asteroid_belts.txt:4-12`: seven `mesh = "..."` lines and nothing else), and ' +
        'the belt places no planets, so the only visible result is a band drawn from whatever type the engine ' +
        'falls back to - with no log line.',
      subject: { kind: 'asteroid_belt', key: belt.type },
      resolution: definitionsSupplied ? 'resolved' : 'unresolved',
      suggestedFix: definitionsSupplied
        ? `define \`${belt.type}\` in \`common/asteroid_belts/*.txt\` as \`${belt.type} = { mesh = "..." ... }\`, or use one of: ${[...definitions.keys()].join(', ')}.`
        : `pass the \`common/asteroid_belts/*.txt\` files (or the whole load order) so this can be resolved; the install defines: ${[...definitions.keys()].join(', ') || '(none supplied)'}.`,
    });
  }

  const counts = { total: findings.length, error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return {
    findings,
    counts,
    // Reported whether or not a finding fired, so an empty report is distinguishable from a pass
    // that read nothing.
    beltTypes: [...definitions.values()],
    belts,
    definitionsSupplied,
  };
}

/**
 * Every `planet = { ... }` slot block inside ONE `common/star_classes/**` block.
 *
 * This is the list of STAR SLOTS a star class declares: `planet = { key = pc_b_star }` is the body
 * the engine puts in slot 1, the next is slot 2, and so on (`00_star_classes.txt:6`, "ID for the
 * 'planet' class which defines the actual star"). A star class with no `planet` block is a
 * randomizer (`rl_* = { stars = { ... } }`), whose members are star CLASSES rather than bodies.
 *
 * `scanScriptBlocks` keeps the LAST scalar for a repeated key, so the slots cannot come from its
 * `fields` map - a repeated `planet = { ... }` is a LIST. The body is therefore walked with the
 * brace depth, relative to the class block, for two reasons:
 *
 *   1. a star class has other depth-1 children that must NOT be read as slots - the per-planet-class
 *      spawn-odds overrides (`pc_continental = { spawn_odds = 0.4 }`) and `modifier = { ... }`;
 *   2. vanilla writes the SINGLE-star classes on ONE line each - `planet = { key = pc_b_star }`
 *      (`00_star_classes.txt:25`) - thirteen of the install's sixty-seven slots. An opener pattern
 *      that required the `{` at end of line sees none of them, which is the shape that produced
 *      phantom findings in `src/lib/portraits.mjs`; both forms are read here.
 */
function starSlotBlocks(text, block) {
  const lines = String(text).replace(/^\uFEFF/, '').split('\n');
  const slots = [];
  let depth = 0;
  let current = null;
  let base = 0;
  const last = block.closeLine ?? lines.length;
  for (let index = block.line - 1; index < last; index += 1) {
    const raw = stripComment(lines[index]);
    const lineNumber = index + 1;
    if (depth === 1 && !current) {
      const oneLine = /^\s*planet\s*=\s*\{([^{}]*)\}\s*$/.exec(raw);
      if (oneLine) {
        const slot = { line: lineNumber, fields: new Map() };
        for (const pair of oneLine[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z0-9_.]+)/g)) {
          slot.fields.set(pair[1].toLowerCase(), { value: pair[2], line: lineNumber });
        }
        slots.push(slot);
      } else if (/^\s*planet\s*=\s*\{/.test(raw)) {
        current = { line: lineNumber, fields: new Map() };
        slots.push(current);
        base = depth;
      }
    } else if (current && depth === base + 1) {
      const scalar = scalarOn(raw);
      if (scalar) current.fields.set(scalar.key.toLowerCase(), { value: scalar.value, line: lineNumber });
    }
    depth += braceDelta(raw);
    if (current && depth <= base) {
      current = null;
      base = depth;
    }
  }
  return slots;
}

/**
 * The star classes and star-class random lists a set of `common/star_classes/**` files defines.
 *
 * Both live in the same namespace - an initializer's `class` names either - but only a star class
 * has slots, so the two are told apart by whether the block declares a `stars = { ... }` list.
 */
export function readStarClasses(files) {
  const classes = new Map();
  for (const file of files) {
    for (const block of scanScriptBlocks(file.text)) {
      if (block.closeLine === null) continue;
      const slots = starSlotBlocks(file.text, block);
      classes.set(block.key, {
        key: block.key,
        file: file.path,
        line: block.line,
        class: field(block, 'class'),
        classLine: fieldLine(block, 'class'),
        // A randomizer is `rl_x = { stars = { "sc_a" "sc_b" } }`: a list of star CLASSES, no slots.
        randomizer: countRepeatedKey(file.text, block, 'stars') > 0,
        slots: slots.map((slot) => ({
          line: slot.line,
          key: slot.fields.get('key')?.value ?? null,
          keyLine: slot.fields.get('key')?.line ?? slot.line,
          class: slot.fields.get('class')?.value ?? null,
          classLine: slot.fields.get('class')?.line ?? slot.line,
        })),
      });
    }
  }
  return classes;
}

/**
 * The star class each `common/solar_system_initializers/**` block names, in block order.
 *
 * Only a block's OWN depth-1 `class` field is read, so a `class = star` / `class = pc_x_star`
 * inside a `planet = { ... }` is not mistaken for the system's star class - those are the star
 * bodies, and they belong to the star class, not to the initializer. A block with no `class` at all
 * is skipped, not reported: vanilla's five `voidworms_spawn_system_*`
 * (`grand_archive_initializers.txt:2-45`) have none, because their `inline_script` supplies it.
 */
export function readInitializerStarClasses(files) {
  const initializers = [];
  for (const file of files) {
    for (const block of scanScriptBlocks(file.text)) {
      if (block.closeLine === null) continue;
      const starClass = field(block, 'class');
      if (starClass === null) continue;
      initializers.push({
        key: block.key,
        file: file.path,
        line: block.line,
        starClass,
        starClassLine: fieldLine(block, 'class'),
      });
    }
  }
  return initializers;
}

/**
 * The star-slot findings.
 *
 * `star-class-planet-undefined` is the one that matters for this project's own mods: both
 * `geocentric_origin` (`sc_geocentric -> pc_geocentric_earth`) and `dyson_habitat_cluster`
 * (`sc_dyson_habitat -> pc_dyson_habitat_star`) put a COLONISABLE body in the star slot by naming it
 * there, so a typo in that one field is the difference between a colonisable homeworld and a star
 * slot with no class to resolve. Vanilla resolves cleanly: all 67 slot keys of its 36 star classes
 * are defined in `common/planet_classes/**`, and the two shapes that do not match their star class
 * are both the install's own (`init_sol_geocentric` writes no star block, `great_wound_system`
 * writes eleven) - neither is an error and neither is reported.
 *
 * @param {{starClassFiles?: {path: string, text: string}[], planetClassFiles?: {path: string, text: string}[],
 *          initializerFiles?: {path: string, text: string}[], complete?: boolean}} input `complete`
 *          says whether the supplied file lists are the WHOLE load order, which decides whether an
 *          unresolvable slot class is an error; it additionally needs at least one
 *          `common/planet_classes/**` file to have been supplied at all, so a caller that handed
 *          over only a star class gets a warning rather than its mod called broken.
 * @returns {{findings: object[], counts: object, starClasses: object[], slots: object[],
 *           initializers: object[], starClassesSupplied: boolean, planetClassesSupplied: boolean}}
 */
export function analyseStarClasses(input = {}) {
  const definitions = readStarClasses(input.starClassFiles ?? []);
  const classes = readPlanetClasses(input.planetClassFiles ?? []);
  const initializers = readInitializerStarClasses(input.initializerFiles ?? []);
  const starClassesSupplied = (input.starClassFiles ?? []).length > 0;
  const planetClassesSupplied = (input.planetClassFiles ?? []).length > 0;
  // Every star-slot body in the supplied files, for the finding's own suggestion: it is the list a
  // mod author actually wants when a slot names a class that does not exist.
  const starBodies = [...classes.values()].filter((entry) => entry.star).map((entry) => entry.key).sort();
  const findings = [];

  for (const starClass of definitions.values()) {
    if (starClass.randomizer) continue;
    for (const slot of starClass.slots) {
      if (slot.key === null) continue; // no `key` at all: nothing to resolve, and the engine's own default applies
      if (classes.has(String(slot.key).toLowerCase())) continue;
      findings.push({
        rule: 'star-class-planet-undefined',
        severity: input.complete === true && planetClassesSupplied ? 'error' : 'warning',
        where: `${starClass.file}:${slot.keyLine}`,
        message:
          `star class \`${starClass.key}\` declares \`planet = { key = ${slot.key} }\`, and no supplied ` +
          '`common/planet_classes/**` file defines that class. That block is the body the engine puts in the star ' +
          'slot - `common/star_classes/00_star_classes.txt:6` documents it as "ID for the \'planet\' class which ' +
          'defines the actual star" - so the slot has no planet class to resolve, and the engine\'s own resolver ' +
          'answers `invalid planet class or random_list [%s]`.',
        subject: { kind: 'star_class', key: starClass.key },
        resolution: planetClassesSupplied ? 'resolved' : 'unresolved',
        suggestedFix: planetClassesSupplied
          ? `define \`${slot.key}\` in \`common/planet_classes/*.txt\`, or correct the name in the slot. A star-slot body is a planet class carrying \`star = yes\`; the supplied files define ${starBodies.length} of them${starBodies.length > 0 ? ` (${starBodies.join(', ')})` : ''}.`
          : 'pass the `common/planet_classes/*.txt` files (or the whole load order) so the slot class can be resolved.',
      });
    }
  }

  // DELIBERATELY NO RULE FOR THE OTHER DIRECTION. An initializer names its star class with
  // `class = <name>`, and a mod legitimately names a VANILLA one (`class = "sc_g"`, which is what
  // this project's own `geocentric_core_anchor` does) - so with only a mod's files in hand an
  // unresolved name is the NORMAL case, not a defect, and an error here would fire on nearly every
  // mod. The names are reported instead (`initializers` below), so an agent can see which star class
  // a system takes its slots from without being told it is broken.

  const counts = { total: findings.length, error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return {
    findings,
    counts,
    starClassesSupplied,
    planetClassesSupplied,
    // Reported whether or not a finding fired: a clean report over a set with no star class at all
    // is a different answer from a clean report over a set that was read.
    starClasses: [...definitions.values()],
    slots: [...definitions.values()].flatMap((starClass) =>
      starClass.slots.map((slot) => ({ starClass: starClass.key, file: starClass.file, ...slot })),
    ),
    initializers,
  };
}

// =====================================================================================
// THE RING WORLD (src/lib/colonization.mjs, RING WORLD)
//
// A ring world is TWELVE ordinary planet objects, each of them one `planet = { ... }` block in a
// `common/solar_system_initializers/**` file whose class carries `ringworld = yes`. There is no
// system-level ring object in the script language at all, which is why every fact about the ring's
// SHAPE lives in this one place: the radius is the radius of the circle the segments are placed on,
// and the segment count is how many such blocks the file writes.
//
// Measured over the install (all 360 initializers in 40 files): FIFTY `planet` blocks name a
// `ringworld = yes` class, and **41 of the 50 declare `orbit_angle = 30`** with `orbit_distance = 0`
// (48 of 50 at distance 0; the two exceptions are the Shattered Ring's deliberately-damaged seam at
// distance 5, `federations_initializers.txt:2018` and `pre_ftl_initializers.txt:1484`). Four
// complete vanilla rings - `sanctuary_system` (12 segments), `cybrex_beta` (12), `fallen_machine`
// (12) and `shattered_ring_start`'s intact parts - all write the SAME angle and the SAME distance
// and still render as four different rings, so the declared angle is not what spreads the segments
// around the circle; the index is. The radius comes from the chain `change_orbit = 45`, and every
// vanilla ring system uses 45.
//
// What is CHECKABLE from a file, and what the two rules below check, is the two ways a mod's ring
// stops being the shape vanilla describes:
//
//   `ringworld-segment-orbit-inconsistent` (warning) - one initializer places ring segments at more
//       than one `orbit_distance`. The Shattered Ring's two `pc_ringworld_seam_damaged` blocks at
//       distance 5 are the install's own exception and are named, not inferred.
//   `ringworld-segment-class-undefined` (error) - an initializer that declares the ring-world star
//       flag `ring_world_built` names a planet class that no supplied file defines, so a segment has
//       no class at all. The flag is what makes the block a RING-WORLD system rather than a system
//       that happens to have one odd planet, and every vanilla ring sets it.
// =====================================================================================

/**
 * The class names a `planet = { class = <x> }` may carry that are NOT planet classes.
 *
 * `example.txt:73` documents `class = star` in as many words - *"Picks a star class which matches the
 * system's class (defined above)"* - so it is a KEYWORD the initializer resolves against the system's
 * star class, not a `common/planet_classes/**` block (the install has no `star` class, measured over
 * all 70 class blocks). `random_asteroid` is the same kind of keyword (`example.txt:79`), and
 * `example.txt:77` names `random_planet` alongside them.
 */
const INITIALIZER_CLASS_KEYWORDS = new Set(['star', 'random_asteroid', 'random_planet', 'random_non_ideal', 'random_colonizable', 'ideal_design_class']);

/** The bodies ONE `common/solar_system_initializers/**` block places, in the order it writes them. */
function initializerBodies(text) {
  const bodies = [];
  const scalar = (node, key) => {
    const child = (node.children ?? []).find((entry) => entry.key && !entry.children && entry.key.toLowerCase() === key);
    return child ? child.value : null;
  };
  const block = (node, key) => (node.children ?? []).find((entry) => entry.key && entry.children && entry.key.toLowerCase() === key) ?? null;
  const flags = (node) => (block(node, 'flags')?.children ?? []).filter((child) => child.value).map((child) => child.value);
  const visit = (node) => {
    for (const child of node.children ?? []) {
      if (!child.key || !child.children) continue;
      const kind = child.key.toLowerCase();
      if (kind === 'planet' || kind === 'moon') {
        // `orbit_distance` is a scalar in 48 of the 50 vanilla ring blocks and a `{ min max }` range
        // in the general schema; a range places the body on a radius this reader cannot name, so it
        // is reported as `null` rather than guessed at.
        const range = block(child, 'orbit_distance');
        const distance = scalar(child, 'orbit_distance');
        bodies.push({
          kind,
          line: child.line,
          closeLine: null,
          class: scalar(child, 'class'),
          name: scalar(child, 'name'),
          orbitAngle: scalar(child, 'orbit_angle'),
          orbitDistance: distance !== null ? distance : range ? { min: scalar(range, 'min'), max: scalar(range, 'max') } : null,
          flags: flags(child),
        });
        // A body may carry bodies of its own - a nested `planet`, a `moon`, and (measured in
        // `crisis_initializers.txt:377`) a planet inside a STAR body, which is where the Cybrex
        // ring's FIRST FOUR segments live. Recursing here is what makes the segment count 12
        // rather than 8.
        visit(child);
        continue;
      }
      visit(child);
    }
  };
  visit(parseParadoxTree(text));
  return bodies;
}

/**
 * Every ring-world system the supplied `common/solar_system_initializers/**` files declare.
 *
 * A block is a ring-world system on any of THREE tests, each with vanilla behind it:
 *
 *   1. it places a `ringworld = yes` planet - the ring itself;
 *   2. it declares the `ring_world_built` star flag - what vanilla's own `habitats.txt:157`,
 *      `15_orbital_ring.txt:107` and `16_cosmogenesis_world.txt:102` test to say "this system already
 *      has a ring world", and what every vanilla ring system sets;
 *   3. its `init_effect` spawns the `ring_world_ruined` megastructure - the RUINED ring, which is a
 *      megastructure section and not a planet at all. `cybrex_system`
 *      (`prescripted_species_systems.txt:1928`) and `ring_world_init_01` (`utopia_initializers.txt:819`)
 *      are the two vanilla systems that are a ring world ENTIRELY of ruins: four ruined sections at
 *      angles 0/90/180/270 and `orbit_distance = 45`, and no ring planet of any class.
 */
export function readRingWorldSystems(files, classes = new Map()) {
  const systems = [];
  for (const file of files) {
    const blocks = scanScriptBlocks(file.text);
    const bodies = initializerBodies(file.text);
    // `scanScriptBlocks` reads depth-1 blocks only and reports each block's first and last line, so
    // line numbers are what join the two reads: both walks see the same `planet` openers.
    const byLine = new Map(bodies.map((body) => [body.line, body]));
    const text = String(file.text).replace(/^\uFEFF/, '').split('\n');
    for (const block of blocks) {
      if (block.closeLine === null) continue;
      const reasons = [];
      for (let line = block.line; line <= block.closeLine; line += 1) {
        const body = byLine.get(line);
        if (!body) continue;
        if (classes.get(String(body.class ?? '').toLowerCase())?.ringworld) {
          reasons.push(`planet = { class = ${body.class} }`);
        }
      }
      // A FLAG LIST IS ONE LINE in most of vanilla - `flags = { sanctuary_system ring_world_built
      // ancient_wonders_system }` (pre_ftl_initializers.txt:657) - so this is a word match inside
      // the block's own lines, not a line-leading match.
      const source = text.slice(block.line - 1, block.closeLine).join('\n');
      const flagged = /(^|[\s{])ring_world_built([\s}]|$)/.test(source);
      if (flagged) reasons.push('flags = { ring_world_built }');
      const ruined = /type\s*=\s*"?ring_world_ruined"?/.test(source);
      if (ruined) reasons.push('spawn_megastructure = { type = ring_world_ruined }');
      if (reasons.length === 0) continue;
      const own = bodies.filter((body) => body.line >= block.line && body.line <= block.closeLine);
      systems.push({
        key: block.key,
        file: file.path,
        line: block.line,
        closeLine: block.closeLine,
        starClass: field(block, 'class'),
        ringWorldBuilt: flagged,
        ruinedRingSections: ruined,
        reasons,
        bodies: own,
        segments: own.filter((body) => classes.get(String(body.class ?? '').toLowerCase())?.ringworld),
      });
    }
  }
  return systems;
}

/**
 * The ring-world findings.
 *
 * @param {{initializerFiles?: {path: string, text: string}[], planetClassFiles?: {path: string, text: string}[],
 *          complete?: boolean}} input `complete` says whether the supplied file lists are the whole
 *          load order; the class rule additionally needs at least one `common/planet_classes/**` file
 *          to have been supplied, so a caller that handed over only an initializer gets a warning.
 */
export function analyseRingWorlds(input = {}) {
  const initializerFiles = input.initializerFiles ?? [];
  const classes = readPlanetClasses(input.planetClassFiles ?? []);
  const planetClassesSupplied = (input.planetClassFiles ?? []).length > 0;
  const systems = readRingWorldSystems(initializerFiles, classes);
  const findings = [];

  // The Shattered Ring's damaged seam, placed 5 further out than the rest of its ring on purpose.
  // Named rather than deduced: it is the ONLY deviation from `orbit_distance = 0` in the install,
  // and it carries `NAME_Irreparable_Damage` (`federations_initializers.txt:1980`).
  const isIntentionalShatteredSeam = (segment) =>
    String(segment.class ?? '').toLowerCase() === 'pc_ringworld_seam_damaged' &&
    String(segment.name ?? '').toLowerCase() === 'name_irreparable_damage';
  for (const system of systems) {
    const segments = system.segments
      .filter((body) => body.kind === 'planet')
      .filter((segment) => !isIntentionalShatteredSeam(segment));
    if (segments.length > 1) {
      const distances = new Map();
      for (const segment of segments) {
        if (typeof segment.orbitDistance !== 'string') continue;
        const bucket = distances.get(segment.orbitDistance) ?? [];
        bucket.push(segment);
        distances.set(segment.orbitDistance, bucket);
      }
      if (distances.size > 1) {
        const order = [...distances.keys()].sort((a, b) => Number(a) - Number(b));
        const offenders = distances.get(order[order.length - 1]) ?? [];
        const anchor = distances.get(order[0])?.[0] ?? segments[0];
        for (const offender of offenders) {
          findings.push({
            rule: 'ringworld-segment-orbit-inconsistent',
            severity: COLONIZATION_SEVERITY['ringworld-segment-orbit-inconsistent'],
            where: `${system.file}:${offender.line}`,
            message:
              `\`${system.key}\` places the ring-world segment \`${offender.class}\` at ` +
              `\`orbit_distance = ${offender.orbitDistance}\`, while \`${anchor.class}\` ` +
              `(${system.file}:${anchor.line}) and the rest of the ring use ` +
              `\`${anchor.orbitDistance}\`. A ring world is ONE circle at ONE radius - the radius is set ` +
              'by the `change_orbit` before the segments and `orbit_distance = 0` keeps a segment on it - ' +
              'so a second distance is a segment that cannot lie on the ring the others describe. Every ' +
              'one of the install\'s 50 ring-world planet blocks is at distance 0 except the Shattered ' +
              'Ring\'s deliberately damaged seam at 5 (federations_initializers.txt:2018).',
            subject: { kind: 'solar_system_initializer', key: system.key },
            resolution: 'resolved',
            suggestedFix:
              `set \`orbit_distance = 0\` on the \`${offender.class}\` block if it should sit on the ring, ` +
              'or move the whole ring by changing the `change_orbit` before the segments instead.',
          });
        }
      }
    }
    // DELIBERATELY NO `continue` when no planet-class file was supplied. The finding is still
    // worth making - "this ring system names a class none of the files in hand defines" is true
    // either way - and it is a WARNING rather than an ERROR in that case, exactly as
    // `star-class-planet-undefined` is, so a caller who handed over one initializer is not told its
    // mod is broken. With nothing to resolve against, EVERY non-keyword class reports, which is the
    // honest reading of a fragment.
    for (const body of system.bodies) {
      if (!body.class) continue;
      if (INITIALIZER_CLASS_KEYWORDS.has(String(body.class).toLowerCase())) continue;
      if (classes.has(String(body.class).toLowerCase())) continue;
      findings.push({
        rule: 'ringworld-segment-class-undefined',
        severity: input.complete === true && planetClassesSupplied ? COLONIZATION_SEVERITY['ringworld-segment-class-undefined'] : 'warning',
        where: `${system.file}:${body.line}`,
        message:
          `\`${system.key}\` is a ring-world system (${system.reasons.join(', ')}) and its ` +
          `\`${body.kind} = { class = ${body.class} }\` names a class no supplied \`common/planet_classes/**\` ` +
          'file defines. A ring-world segment IS a planet class carrying `ringworld = yes` ' +
          '(`00_planet_classes.txt:1372` for `pc_ringworld_habitable`), so the body has no class to resolve. ' +
          '(`example.txt:73` documents the initializer KEYWORDS - a star body, a random asteroid - ' +
          'which are not planet classes and are not reported.)',
        subject: { kind: 'solar_system_initializer', key: system.key },
        resolution: 'resolved',
        suggestedFix:
          'define the class with `ringworld = yes` and an `entity` that is one of the segment meshes ' +
          '(`ringworld_habitable_entity`, `ringworld_seam_entity`, `ringworld_tech_entity` and their ' +
          '`_damaged` forms), or correct the name.',
      });
    }
  }

  const counts = { total: findings.length, error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return {
    findings,
    counts,
    planetClassesSupplied,
    // Reported whether or not a finding fired: the systems a reader FOUND are the other half of the
    // answer, and a run that found none is not the same as a run that found ten clean ones.
    systems: systems.map((system) => ({
      key: system.key,
      file: system.file,
      line: system.line,
      starClass: system.starClass,
      ringWorldBuilt: system.ringWorldBuilt,
      ruinedRingSections: system.ruinedRingSections,
      reasons: system.reasons,
      segments: system.segments.length,
      radii: [...new Set(system.segments.map((segment) => (typeof segment.orbitDistance === 'string' ? segment.orbitDistance : 'range')))],
    })),
    ringClasses: [...classes.values()]
      .filter((entry) => entry.ringworld)
      .map((entry) => ({ key: entry.key, file: entry.file, line: entry.line, entity: entry.entity, colonizable: entry.colonizable, orbitLines: entry.orbitLines })),
  };
}

/**
 * The ship sizes a set of `common/ship_sizes/**` files defines, with the two keys that decide
 * whether the hull can be an ark ship - a mobile colony.
 */
export function readShipSizes(files) {
  const sizes = [];
  for (const file of files) {
    for (const block of scanScriptBlocks(file.text)) {
      sizes.push({
        key: block.key,
        file: file.path,
        line: block.line,
        closeLine: block.closeLine,
        class: field(block, 'class'),
        classLine: fieldLine(block, 'class'),
        carriesColony: field(block, 'carries_colony'),
        carriesColonyLine: fieldLine(block, 'carries_colony'),
        arkPicture: field(block, 'arkship_picture'),
        isStartingArkship: (field(block, 'is_starting_arkship') ?? 'no').toLowerCase() === 'yes',
      });
    }
  }
  return sizes;
}

/**
 * The colonisation findings over a set of planet-class and ship-size files.
 *
 * @param {{planetClassFiles?: {path: string, text: string}[], shipSizeFiles?: {path: string, text: string}[],
 *          complete?: boolean}} input `complete` says whether the supplied planet-class files are the
 *          WHOLE load order; it decides whether an unresolvable `carries_colony` class is an error.
 * @returns {{findings: object[], planetClasses: object[], carrierClasses: object[], shipSizes: object[],
 *           counts: object, starbaseClass: string}}
 */
export function analyseColonization(input = {}) {
  const ships = readShipSizes(input.shipSizeFiles ?? []);
  const classes = readPlanetClasses(input.planetClassFiles ?? []);
  const complete = input.complete === true;
  const starbaseClass = 'shipclass_starbase';
  const findings = [];

  for (const ship of ships) {
    if (ship.carriesColony === null) continue;
    const klass = String(ship.class ?? '').toLowerCase();
    if (klass !== starbaseClass) {
      findings.push({
        rule: 'carries-colony-without-starbase',
        severity: COLONIZATION_SEVERITY['carries-colony-without-starbase'],
        where: `${ship.file}:${ship.line}`,
        message:
          `ship size \`${ship.key}\` declares \`carries_colony = ${ship.carriesColony}\` but ` +
          (ship.class ? `\`class = ${ship.class}\`` : 'no `class`') +
          '. The engine refuses this by name: "Arkship size %s does not have class = shipclass_starbase", and ' +
          'the install documents the requirement on the field itself (common/ship_sizes/00_ship_sizes.txt:99).',
        subject: { kind: 'ship_size', key: ship.key },
        suggestedFix: `add \`class = shipclass_starbase\` to \`${ship.key}\`, or remove \`carries_colony\` - a hull that is not a starbase cannot carry a colony.`,
      });
    }
    const wanted = String(ship.carriesColony).toLowerCase();
    const target = classes.get(wanted);
    if (target && target.colonizable === false && !target.colonizableByEvent) {
      findings.push({
        rule: 'carrier-colony-class-undefined',
        severity: COLONIZATION_SEVERITY['carrier-colony-class-undefined'],
        where: `${ship.file}:${ship.line}`,
        message:
          `ship size \`${ship.key}\` carries a colony of \`${target.key}\`, which is \`colonizable = no\` ` +
          `(${target.file}:${target.colonizableLine}). The carrier relation would point at a class the engine ` +
          'does not treat as colonisable, and `is_colonizable` answers no for it.',
        subject: { kind: 'ship_size', key: ship.key },
        resolution: 'resolved',
        suggestedFix: `either give \`${target.key}\` \`colonizable = yes\`, or carry a colonisable class instead (vanilla's ark ships carry \`pc_ark\`, 06_planet_classes_nomads.txt:94).`,
      });
      continue;
    }
    if (!target) {
      findings.push({
        rule: 'carrier-colony-class-undefined',
        severity: complete ? 'error' : 'warning',
        where: `${ship.file}:${ship.line}`,
        message:
          `ship size \`${ship.key}\` carries a colony of \`${ship.carriesColony}\`, and no supplied ` +
          '`common/planet_classes/**` file defines that class.',
        subject: { kind: 'ship_size', key: ship.key },
        resolution: complete ? 'resolved' : 'unresolved',
        suggestedFix: complete
          ? `define \`${ship.carriesColony}\` as a planet class with \`colonizable = yes\`, or correct the name.`
          : `pass the file that defines \`${ship.carriesColony}\` (or the whole load order) so this can be resolved.`,
      });
    }
  }

  // ---------------------------------------------------------------- asteroid classes
  //
  // `asteroid = yes` and `colonizable = yes` on ONE class is a claim about the same body twice, and
  // the engine reads both: `is_colonizable` says yes, so the colonise order appears, while every
  // megastructure whose placement says `requires_not_minor_planetary_body` refuses the body (the
  // trigger is the inline `NOR = { is_asteroid = yes is_moon = yes }`, 8 sites in
  // `common/megastructures/**`, e.g. `habitats.txt:174-179`). Zero of the six vanilla asteroid
  // classes is colonisable, so this is never vanilla's own shape - but a mod may want a colonisable
  // rock on purpose, which is why it is INFO and not an error.
  for (const entry of classes.values()) {
    if (!entry.asteroid || entry.colonizable !== true) continue;
    findings.push({
      rule: 'planet-asteroid-colonizable',
      severity: COLONIZATION_SEVERITY['planet-asteroid-colonizable'],
      where: `${entry.file}:${entry.colonizableLine ?? entry.line}`,
      message:
        `planet class \`${entry.key}\` is \`asteroid = yes\` (${entry.file}:${entry.asteroidLine}) and ` +
        '`colonizable = yes`. The engine will treat it as colonisable, but it is also a MINOR PLANETARY BODY: ' +
        'the megastructure placement rules that carry `fail_text = "requires_not_minor_planetary_body"` test ' +
        '`NOR = { is_asteroid = yes is_moon = yes }` (8 sites, e.g. common/megastructures/habitats.txt:173-179), so ' +
        'no habitat, orbital ring, spy orb, think tank, coordination centre, mega-art installation, cosmogenesis ' +
        'world or grand archive can be built on it. No vanilla asteroid class is colonisable.',
      subject: { kind: 'planet_class', key: entry.key },
      suggestedFix:
        'intended? then expect a planet that can be colonised but cannot carry a planet-slot megastructure. ' +
        'Otherwise drop `colonizable = yes`, or drop `asteroid = yes` and use an ordinary small planet class.',
    });
  }

  // THE COLONY/POPULATION SIDE, computed BEFORE the counts so its findings are folded into the
  // same list rather than being reachable only through `colonies`. It reads the supplied script
  // files: a `create_colony` is written in a `common/scripted_effects/**` definition, an
  // `events/**` handler or a `common/inline_scripts/**` fragment, and the three reach each other by
  // name. It is folded in HERE rather than into `analyseColonizationFiles` alone, because the file
  // inspector calls THIS function - and a pass a caller only gets from one of two entry points is a
  // pass half the callers never run.
  const colonies = analyseCreateColonyPops({ scriptFiles: input.scriptFiles ?? [], complete });
  for (const finding of colonies.findings) findings.push(finding);

  const counts = { total: findings.length, error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return {
    findings,
    counts,
    starbaseClass,
    // The two sides, reported whether or not a finding fired: a clean report on a set with no
    // carriers at all is a DIFFERENT answer from a clean report on a set that was checked, and a
    // findings-only report cannot tell them apart.
    planetClasses: [...classes.values()].map((entry) => ({
      key: entry.key,
      file: entry.file,
      line: entry.line,
      colonizable: entry.colonizable,
      colonizableByEvent: entry.colonizableByEvent,
      star: entry.star,
      habitat: entry.habitat,
      ringworld: entry.ringworld,
      asteroid: entry.asteroid,
      districtSet: entry.districtSet,
    })),
    carrierClasses: ships
      .filter((ship) => ship.carriesColony !== null)
      .map((ship) => ({
        key: ship.key,
        file: ship.file,
        line: ship.line,
        class: ship.class,
        carriesColony: ship.carriesColony,
        isStartingArkship: ship.isStartingArkship,
        hasArkshipPicture: ship.arkPicture !== null,
        isStarbase: String(ship.class ?? '').toLowerCase() === starbaseClass,
      })),
    shipSizes: ships.map((ship) => ({ key: ship.key, file: ship.file, line: ship.line })),
    // The colony/population side in full, including the two halves a reader wants whether or not a
    // finding fired: the blocks that call `create_colony` and the blocks that seed population. Its
    // findings are already merged into `findings` above, so a caller that reads only `findings`
    // still gets them.
    colonies,
  };
}

// =====================================================================================
// A COLONY WITH NO POPULATION (src/lib/colonization.mjs, CREATE COLONY)
//
// `create_colony = { owner = <target> species = <target> }` (`effects.log`, scopes `planet ship`)
// builds the colony object - and NOTHING ELSE. A colony with no population does not survive: it
// reverts to a colonisable planet once time runs. Measured by this project in two earlier rounds
// (the citystate habitat probe and the Long Road Home origin probe), and the reason every vanilla
// use is paired with population is that vanilla's field table does not create any.
//
// THE ENGINE LOGS NOTHING WHEN IT REVERTS. That is what makes this a rule rather than a habit: the
// defect is silent, there is no `error.log` line to quote, and the player sees only a planet that
// quietly stopped being theirs. The one pop-creating effect the engine documents is
// `create_pop_group` ("Creates a new pop group based on an existing one with overrides. If no
// existing pop group is passed, species is mandatory."), which is why vanilla's shape is
//
//     create_colony = { owner = ... species = ... }
//     change_colony_foundation_date = -360
//     while = { count = 8 create_pop_group = { size = 100 species = ... } }
//
// (`common/inline_scripts/game_start/origin_toxic_knights.txt:64-78`, the Knights of the Toxic God
// habitat colony - and the shape the Long Road Home origin probe copied to make its second colony
// stick).
//
// WHAT THIS CAN AND CANNOT SEE, stated because it decides the severity. The rule is BLOCK-SCOPED:
// it reports a block that calls `create_colony` when neither that block nor anything it reaches by
// name (`scripted_effect = yes`, `inline_script = { script = ... }`, a `country_event = { id = X }`
// whose definition is in hand, or textually inside an event's own `immediate`/`option`) seeds
// population. Population created in a SIBLING block of the same scripted effect, by a mechanism
// this reader does not model, or in a file the caller did not pass is INVISIBLE to it. Measured
// over vanilla: 11 top-level blocks call `create_colony`, 7 of them also call `create_pop_group`
// in the same block, and the other 4 are NOT defects (an arkship embarkation, two `country_event`
// definitions that seed in a nested `immediate`, and the MSI effect). That is exactly why this is
// a WARNING whose text names the search it ran, and not an error: the rule implements the certain
// half - "this colony call site is not visibly paired with population" - and says so.
// =====================================================================================

/** Effects that CREATE population. `create_pop_group` is the only one the engine documents. */
const POP_SEEDING_EFFECTS = new Set(['create_pop_group']);

/** Fields that CALL another named script block: `foo = yes`, `inline_script = { script = foo }`. */
function callTargets(body) {
  const targets = new Set();
  for (const match of body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(?:yes|no)\s*$/gm)) {
    targets.add(match[1].toLowerCase());
  }
  for (const match of body.matchAll(/^\s*inline_script\s*=\s*\{\s*script\s*=\s*"?([A-Za-z0-9_./-]+)"?/gm)) {
    targets.add(match[1].toLowerCase());
  }
  return targets;
}

/** Every event id a body fires: `country_event = { id = X }` / `country_event = X`. */
function firedEventIds(body) {
  const ids = [];
  for (const match of body.matchAll(/^\s*[A-Za-z_]*event\s*=\s*\{\s*id\s*=\s*"?([A-Za-z0-9_.]+)"?/gm)) ids.push(match[1]);
  for (const match of body.matchAll(/^\s*[A-Za-z_]*event\s*=\s*"?([A-Za-z0-9_]+\.[A-Za-z0-9_]+)"?\s*$/gm)) ids.push(match[1]);
  return ids;
}

/**
 * Index the script blocks a set of files defines, and the `create_colony` / pop-seeding / call
 * sites inside each.
 *
 * A block is a depth-1 `name = { ... }` - the shape of a `common/scripted_effects/**` definition,
 * an `events/**` `country_event`, and the named effects inside them. Depth-1 is deliberate: it is
 * what makes the check BLOCK-SCOPED, so a colony in one effect and population in another are told
 * apart instead of being merged into one reassuring bucket.
 *
 * @param {{path: string, text: string}[]} files
 * @returns {{definitions: Map<string, object>, events: Map<string, object>, blocks: object[]}}
 */
export function indexCreateColonyBlocks(files = []) {
  const definitions = new Map();
  const events = new Map();
  const blocks = [];
  for (const file of files) {
    const lines = String(file.text ?? '').replace(/^\uFEFF/, '').split('\n');
    for (const block of scanScriptBlocks(file.text ?? '')) {
      if (block.closeLine === null) continue;
      const body = lines.slice(block.line - 1, block.closeLine).map(stripComment).join('\n');
      // `create_colony = { ... }` is the EFFECT. `create_colony = no` is a FIELD of a different
      // effect (`set_colony`, `effects.log`: "create_colony = yes/no (default: yes; if yes, will
      // also create the carrier colony ...)"), and it creates nothing - so the count requires the
      // brace. Vanilla writes the scalar form once (`nomads_effects.txt:5172`) and counting it
      // would report `create_embarking_arkship` as a colony with no population.
      const colonies = (body.match(/^\s*create_colony\s*=\s*\{/gm) ?? []).length;
      const pops = [...POP_SEEDING_EFFECTS].reduce((total, key) => total + (body.match(new RegExp(`^\\s*${key}\\s*=`, 'gm')) ?? []).length, 0);
      const entry = {
        key: block.key,
        file: file.path,
        line: block.line,
        closeLine: block.closeLine,
        colonies,
        pops,
        calls: [...callTargets(body)],
        eventIds: firedEventIds(body),
        body,
      };
      blocks.push(entry);
      const lowered = block.key.toLowerCase();
      // An event is keyed by its own id; a scripted effect/inline script by its block name. Both
      // are indexed, because `country_event = { id = X }` reaches the first and `x = yes` the
      // second, and a `create_colony` reached either way must be able to find its population.
      const isEvent = /event$/.test(lowered) || lowered === 'event';
      const idMatch = /^\s*id\s*=\s*"?([A-Za-z0-9_.]+)"?\s*$/m.exec(body);
      if (isEvent && idMatch) events.set(idMatch[1], entry);
      else if (!definitions.has(lowered)) definitions.set(lowered, entry);
    }
  }
  return { definitions, events, blocks };
}

/**
 * Does this block, or anything it reaches BY NAME, create population?
 *
 * Bounded to a depth of 6 and a seen-set, because a scripted-effect graph is a graph and a cycle in
 * it must not hang the check.
 */
export function blockSeedsPops(entry, index, options = {}) {
  const depth = options.depth ?? 0;
  const seen = options.seen ?? new Set();
  if (!entry || depth > 6) return false;
  if (entry.pops > 0) return true;
  const key = `${entry.file}:${entry.line}`;
  if (seen.has(key)) return false;
  seen.add(key);
  for (const call of entry.calls) {
    const target = index.definitions.get(call);
    if (target && blockSeedsPops(target, index, { depth: depth + 1, seen })) return true;
  }
  for (const id of entry.eventIds) {
    const target = index.events.get(id);
    if (target && blockSeedsPops(target, index, { depth: depth + 1, seen })) return true;
  }
  return false;
}

/**
 * The create-colony findings.
 *
 * @param {{scriptFiles?: {path: string, text: string}[], complete?: boolean}} input `complete` says
 *          whether the supplied files are the WHOLE load order. It does not change whether the rule
 *          fires - a block that does not seed population does not seed it either way - it changes
 *          whether the finding's `resolution` says the search was exhaustive.
 * @returns {{findings: object[], counts: object, blocks: object[], colonyBlocks: object[],
 *           popSeedingBlocks: object[]}}
 */
export function analyseCreateColonyPops(input = {}) {
  const files = input.scriptFiles ?? [];
  const index = indexCreateColonyBlocks(files);
  const findings = [];

  for (const block of index.blocks) {
    if (block.colonies === 0) continue;
    if (blockSeedsPops(block, index)) continue;
    const reachable = [...block.calls, ...block.eventIds];
    findings.push({
      rule: 'create-colony-without-pops',
      severity: COLONIZATION_SEVERITY['create-colony-without-pops'],
      where: `${block.file}:${block.line}`,
      element: block.key,
      message:
        `\`${block.key}\` calls \`create_colony\` and neither this block nor anything it reaches by name seeds ` +
        'population. A colony with ZERO population REVERTS to a colonisable planet once time runs, and the engine ' +
        'logs NO LINE for it - which is what makes this a rule rather than a habit. The only pop-creating effect the ' +
        'engine documents is `create_pop_group` ("Creates a new pop group based on an existing one with overrides. ' +
        'If no existing pop group is passed, species is mandatory."), and it is what every working scripted colony is ' +
        'paired with: `create_colony = { owner = ... species = ... }` + `change_colony_foundation_date = -360` + ' +
        '`while = { count = 8 create_pop_group = { size = 100 species = ... } }` ' +
        '(`common/inline_scripts/game_start/origin_toxic_knights.txt:64-78`). ' +
        (reachable.length > 0
          ? `This block DOES call ${reachable.map((name) => `\`${name}\``).join(', ')}, and none of those blocks creates a pop group (traced to a depth of 6). `
          : 'The block calls nothing at all that this reader could follow. ') +
        'SCOPE OF THE SEARCH, because it bounds the claim: this is BLOCK-SCOPED. Population created in a SIBLING ' +
        'block of the same scripted effect, by a mechanism this reader does not model, or in a file that was not ' +
        'passed is invisible here. Measured over vanilla: 11 blocks call `create_colony`, 7 also call ' +
        '`create_pop_group` in the same block, and the other 4 are not defects for exactly that reason.',
      subject: { kind: 'script_block', key: block.key },
      resolution: input.complete === true ? 'searched-supplied-files' : 'partial',
      suggestedFix:
        'seed the colony in the same block, in the shape vanilla uses: after `create_colony`, add ' +
        '`change_colony_foundation_date = -360` and `while = { count = 8 create_pop_group = { size = 100 species = ' +
        '<owner\'s main species> } }` (see `common/inline_scripts/game_start/origin_toxic_knights.txt:64-78` and ' +
        '`common/scripted_effects/01_start_of_game_effects.txt:1657`). If the population is created somewhere this ' +
        'check cannot see, ignore this finding - it names the search it ran.',
      colonies: block.colonies,
    });
  }

  const counts = { total: findings.length, error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return {
    findings,
    counts,
    // Reported whether or not a finding fired: the colony call sites and the pop-seeding blocks are
    // the other half of the answer, so "found no colony call" is a different answer from "clean".
    blocks: index.blocks.map((block) => ({ key: block.key, file: block.file, line: block.line, colonies: block.colonies, pops: block.pops })),
    colonyBlocks: index.blocks.filter((block) => block.colonies > 0).map((block) => ({ key: block.key, file: block.file, line: block.line, colonies: block.colonies, pops: block.pops })),
    popSeedingBlocks: index.blocks.filter((block) => block.pops > 0).map((block) => ({ key: block.key, file: block.file, line: block.line, pops: block.pops })),
  };
}

/**
 * True for a `.../scripted_effects/...` or `.../inline_scripts/...` script path.
 *
 * These are the files a `create_colony` is usually WRITTEN in (vanilla's Toxic Knights colony lives
 * in `common/inline_scripts/game_start/origin_toxic_knights.txt`, reached from
 * `common/scripted_effects/01_start_of_game_effects.txt:1657`), so the create-colony pass needs them
 * rather than only the event files that fire them. They are also NOT button effects, so the file
 * inspector must route them here instead of to `checkButtonEffectsFile` - which it did until this
 * predicate existed, reporting `button-effect-without-effect` against 201 vanilla scripted effects
 * that never had an `effect` block to miss.
 */
export function isScriptedEffectsPath(path) {
  return /\/scripted_effects\//i.test(String(path).replace(/\\/g, '/')) || /\/inline_scripts\//i.test(String(path).replace(/\\/g, '/'));
}

/** True for a `.../ship_sizes/...` script path. */
export function isShipSizesPath(path) {
  return /\/ship_sizes\//i.test(String(path).replace(/\\/g, '/'));
}

/** True for a `.../planet_classes/...` script path. */
export function isPlanetClassesPath(path) {
  return /\/planet_classes\//i.test(String(path).replace(/\\/g, '/'));
}

/** True for a `.../asteroid_belts/...` script path (the belt TYPE definitions). */
export function isAsteroidBeltsPath(path) {
  return /\/asteroid_belts\//i.test(String(path).replace(/\\/g, '/'));
}

/**
 * True for a `.../solar_system_initializers/...` script path.
 *
 * This is the schema that PLACES belts (`asteroid_belt = { type = ... radius = ... }`) and the
 * asteroid planets (`planet = { class = pc_asteroid }`), so it belongs in the same pass as the
 * schemas it names. It is also why that pass is not gated on a ship-size or planet-class file being
 * present: an initializer alone is a checkable input.
 */
export function isSystemInitializersPath(path) {
  return /\/solar_system_initializers\//i.test(String(path).replace(/\\/g, '/'));
}

/**
 * True for a `.../star_classes/...` script path, including `star_classes/randomizers/`.
 *
 * This is the schema that DECLARES the star slots (`planet = { key = ... }` per slot) and the
 * randomizer lists an initializer's `class` may name instead of a star class. Like
 * `common/ship_sizes/**` and `common/planet_classes/**` it is not a button effect, so the file
 * inspector must route it here rather than to `checkButtonEffectsFile` - which it did until this
 * reader existed, reporting `button-effect-without-effect` against a star class that never had an
 * `effect` block to miss.
 */
export function isStarClassesPath(path) {
  return /\/star_classes\//i.test(String(path).replace(/\\/g, '/'));
}

/**
 * Split a list of `{path, text}` into the schemas this module reads, and run each analysis.
 *
 * A file that places an `asteroid_belt` is any SCRIPT file - an initializer, an event, a scripted
 * effect - so the belt side is given every supplied file that is not itself a belt-type definition;
 * `readAsteroidBelts` only recognises a real `asteroid_belt = { ... }` block, so a `.gui` or a
 * localisation file passing through it is inert. The star-slot side takes the same file list and
 * sorts it itself: a star class names a planet class, and an initializer names a star class, so all
 * three directories have to be in hand at once.
 */
export function analyseColonizationFiles(files, { complete = false } = {}) {
  const planetClassFiles = files.filter((file) => isPlanetClassesPath(file.path));
  const shipSizeFiles = files.filter((file) => isShipSizesPath(file.path));
  const asteroidBeltFiles = files.filter((file) => isAsteroidBeltsPath(file.path));
  const initializerFiles = files.filter((file) => isSystemInitializersPath(file.path));
  const scriptFiles = files.filter((file) => !isAsteroidBeltsPath(file.path));
  return {
    ...analyseColonization({
      planetClassFiles,
      shipSizeFiles,
      // The whole supplied set, so the colony/population pass can follow a `create_colony` in one
      // file to the `create_pop_group` in another.
      scriptFiles: files,
      complete,
    }),
    asteroids: analyseAsteroidBelts({ asteroidBeltFiles, scriptFiles, complete }),
    stars: analyseStarClasses({
      starClassFiles: files.filter((file) => isStarClassesPath(file.path)),
      planetClassFiles,
      initializerFiles,
      complete,
    }),
    // A ring world is twelve `planet` blocks in an initializer whose classes carry
    // `ringworld = yes`, so this pass needs the initializers AND the planet classes together -
    // exactly the pair the star-slot pass above takes.
    rings: analyseRingWorlds({ initializerFiles, planetClassFiles, complete }),
  };
}

export default {
  analyseAsteroidBelts,
  analyseColonization,
  analyseColonizationFiles,
  analyseCreateColonyPops,
  analyseRingWorlds,
  analyseStarClasses,
  blockSeedsPops,
  indexCreateColonyBlocks,
  isAsteroidBeltsPath,
  isPlanetClassesPath,
  isShipSizesPath,
  isStarClassesPath,
  isSystemInitializersPath,
  isScriptedEffectsPath,
  readRingWorldSystems,
  readAsteroidBelts,
  readAsteroidBeltTypes,
  readInitializerStarClasses,
  readPlanetClasses,
  readShipSizes,
  readStarClasses,
  scanScriptBlocks,
};
