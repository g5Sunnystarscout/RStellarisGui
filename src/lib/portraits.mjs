//------------------------------------------------------------------------------------
// portraits.mjs -- Part of RStellarisGui
//
// The PORTRAIT half of the asset model: what a species/leader portrait is made of, and the two
// failures that are silent in game.
//
// A portrait is DEFINED in `gfx/portraits/portraits/*.txt` (NOT in `common/portraits/`, which
// does not exist in 4.4.6 - the install ships `common/portrait_categories/` and
// `common/portrait_sets/` instead, and those only LIST portrait-group names for the empire
// editor). One definition is one block inside a top-level `portraits = { ... }`:
//
//     portraits = {
//         mam5 = { entity = "portrait_mammalian_05_entity" clothes_selector = "..." }
//         my_portrait = { texturefile = "gfx/models/portraits/my_portrait.dds" }
//     }
//
// Measured over the verified 4.4.6 install: `gfx/portraits/portraits/**/*.txt` is 41 files
// defining **105** portrait IDs, and **all 105 take the `entity` route** - the two-dimensional
// `spriteType` / `texturefile` alternatives are documented in `00_portraits_main.txt:236-243`
// but no vanilla portrait uses them. Mods do (see below).
//
// WHY THESE TWO RULES EXIST. Both failures produce a portrait that loads without an error line
// and then draws nothing, a placeholder, or the wrong texture, which is the failure mode this
// project's rules are for:
//
//   `portrait-entity-undefined`        the definition names an `entity` that no `.asset` under
//                                      `gfx/models/portraits/**` defines. The engine has no
//                                      error to give: the name is a lookup into a registry that
//                                      is simply missing the key, so the portrait slot stays
//                                      empty.
//   `portrait-mesh-missing`           the ENTITY is defined but its `pdxmesh` is not, or the
//                                      `pdxmesh`'s `file = "<x>.mesh"` is in no indexed root.
//                                      This is the second link of the same chain, and it is the
//                                      link that decides whether anything is drawn at all: the
//                                      entity resolves, the portrait registers, and the mesh
//                                      never loads. It is checked against `gfx/**/*.gfx`, because
//                                      a mesh is declared by an `objectTypes = { pdxmesh = { } }`
//                                      block and vanilla keeps 300 of those under `gfx/models/`
//                                      (an entity may also carry `attach = { root = <entity> }`
//                                      INSTEAD of a pdxmesh - vanilla's `swarm1small` does - so an
//                                      entity with no `pdxmesh` makes no claim and is not reported).
//   `portrait-character-texture-missing` a `character_textures` entry names a file that no
//                                      indexed root contains. The mesh keeps whatever UV it was
//                                      exported with, so the body is drawn with a neighbouring
//                                      portrait's skin or with nothing.
//
// All three are checked against what the caller INDEXED, so a rule must never fire because the
// caller supplied only the mod root: every finding carries `resolution`, and a caller that did
// not index the install gets `resolution: 'partial'`. `portrait-entity-undefined` and
// `portrait-mesh-missing` are still errors in that case (a mod author who names an entity or a
// mesh must define it themselves or know it is vanilla), but the message says which roots were
// searched.
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License as published by the Free Software Foundation, either version 3
// of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { listFilesRecursive, readTextFile, relativeKey } from './paths.mjs';

/** Severity of the portrait rules. See the module header for why each is graded as it is. */
export const PORTRAIT_SEVERITY = {
  'portrait-entity-undefined': 'error',
  'portrait-mesh-missing': 'error',
  'portrait-character-texture-missing': 'warning',
};

export const PORTRAIT_DESCRIPTIONS = {
  'portrait-entity-undefined':
    'a portrait definition names `entity = "<name>"` that no `gfx/models/portraits/**/*.asset` defines - the ' +
    'engine looks the name up in a registry and finds no key, so the portrait slot draws nothing and nothing is logged',
  'portrait-mesh-missing':
    'a portrait\'s `entity` resolves but the chain stops one link later: either the entity\'s `pdxmesh` is defined by no ' +
    '`gfx/**/*.gfx`, or the `pdxmesh`\'s `file = "<x>.mesh"` is in no indexed root - the portrait registers and the mesh ' +
    'never loads, so the slot stays empty',
  'portrait-character-texture-missing':
    'a `character_textures` entry names a texture that is in no indexed root - the mesh keeps its exported UVs, so ' +
    'a body part is drawn with a neighbouring portrait\'s skin or with nothing',
};

/**
 * The field that names a portrait's texture. Vanilla writes both `texturefile` and
 * `textureFile` in the same install, and `childValue` compares case-insensitively, so one
 * spelling covers both.
 */
const TEXTURE_KEYS = ['texturefile'];

//----------------------------------------------------------------------------------------
// A TOKEN-LEVEL PARADOX READER, written here rather than borrowed from paradox.mjs.
//
// WHY NOT paradox.mjs: this repository's parser ends the ENCLOSING block at a scalar block
// value (`atmosphere_color = hsv { ... }`), which `colonization.mjs` documents at length. That
// defect is asserted in the self-test and deliberately unfixed, so a module that must not
// inherit it reads braces itself.
//
// WHY NOT the line scanner this file started with: vanilla writes a portrait definition's
// fields on the SAME line as its opening brace -
//
//     mam5 = {	entity = "portrait_mammalian_05_entity" clothes_selector = "..." }
//
// - so a scanner whose opener pattern requires `{` at end of line sees no ID block at all,
// and a field pattern that takes the rest of the line as the value produces
// `portrait_robot_01_entity"\tclothes_selector = "no_texture"...` as an "entity name". Both
// happened, and the first version of this module reported 15 phantom findings against a clean
// vanilla install because of them. A token-level reader cannot make either mistake.
//----------------------------------------------------------------------------------------

/**
 * Split Paradox script into tokens, tracking line numbers.
 *
 * `open`/`close` are the braces, `value` is a quoted string, `eq` is `=`, and `word` is
 * everything else (bare identifiers, numbers, `@variables`, boolean operands like `yes`, `OR`,
 * `no`).
 *
 * `eq` is kept as a token RATHER THAN DROPPED, and that is the difference between a reader that
 * works and one that does not. Without it, `key value` and `key = value` are the same token
 * sequence, and a bare operand at the start of a trigger (`OR = { a = 1 b = 2 }`) leaves the
 * operand sitting where a key belongs. Keeping `=` makes every assignment unambiguous and makes
 * a bare operand simply a word that no `=` ever follows.
 */
export function tokenizeParadox(text) {
  const tokens = [];
  const source = String(text).replace(/^\uFEFF/, '');
  let index = 0;
  let line = 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if (character === ' ' || character === '\t' || character === '\r') {
      index += 1;
      continue;
    }
    if (character === '#') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '{') {
      tokens.push({ type: 'open', line });
      index += 1;
      continue;
    }
    if (character === '}') {
      tokens.push({ type: 'close', line });
      index += 1;
      continue;
    }
    if (character === '=') {
      tokens.push({ type: 'eq', line });
      index += 1;
      continue;
    }
    if (character === '"') {
      const start = index + 1;
      let end = start;
      while (end < source.length && source[end] !== '"' && source[end] !== '\n') end += 1;
      tokens.push({ type: 'value', value: source.slice(start, end), line });
      index = end + 1;
      continue;
    }
    let end = index;
    while (end < source.length && !' \t\r\n{}="#'.includes(source[end])) end += 1;
    tokens.push({ type: 'word', value: source.slice(index, end), line });
    index = end;
  }
  return tokens;
}

/**
 * Build a tree from the token stream.
 *
 * A node is `{ key, value, children, line }`. `key` is null for a bare token (the `holo` in
 * `alternate_configurations = { holo }`, the `OR` in a trigger). A node has either `value` or
 * `children`, never both.
 *
 * A bare block - one with no `key =` before it, as in the game's own
 * `atmosphere_color = hsv { 0.59 0.45 0.95 }` - becomes a node with `key: null`. It does NOT
 * end its parent, which is the failure this repository's `paradox.mjs` has and this reader
 * exists to avoid.
 */
export function parseParadoxTree(text) {
  const tokens = tokenizeParadox(text);
  const root = { key: null, children: [], line: 0 };
  const stack = [root];
  let pending = null;
  let sawEquals = false;

  const reset = () => {
    pending = null;
    sawEquals = false;
  };

  for (const token of tokens) {
    const top = stack[stack.length - 1];
    if (token.type === 'eq') {
      sawEquals = true;
      continue;
    }
    if (token.type === 'open') {
      const node = { key: sawEquals ? pending : null, value: null, children: [], line: token.line };
      top.children.push(node);
      stack.push(node);
      reset();
      continue;
    }
    if (token.type === 'close') {
      if (stack.length > 1) stack.pop();
      reset();
      continue;
    }
    if (token.type === 'value') {
      top.children.push({
        key: sawEquals ? pending : null,
        value: token.value,
        children: null,
        line: token.line,
      });
      reset();
      continue;
    }
    // A word.
    if (sawEquals) {
      top.children.push({ key: pending, value: token.value, children: null, line: token.line });
      reset();
    } else {
      // Either the key of the next assignment or a bare operand. If the next token is not `=`
      // it was an operand, and overwriting `pending` drops it - which is correct, because a
      // bare operand carries nothing this module reads.
      pending = token.value;
    }
  }
  return root;
}

/** The first scalar child with one of `keys`, case-insensitively. */
function childValue(node, keys) {
  const wanted = keys.map((key) => key.toLowerCase());
  for (const child of node.children ?? []) {
    if (child.key && !child.children && wanted.includes(child.key.toLowerCase())) return child.value;
  }
  return null;
}

/** The first block child with one of `keys`, case-insensitively. */
function childBlock(node, keys) {
  const wanted = keys.map((key) => key.toLowerCase());
  for (const child of node.children ?? []) {
    if (child.key && child.children && wanted.includes(child.key.toLowerCase())) return child;
  }
  return null;
}

/**
 * Read every portrait definition out of one `gfx/portraits/portraits/*.txt` file.
 *
 * @returns {Array<{id: string, file: string, line: number, entity: string|null,
 *                  textures: string[], clothesSelector: string|null,
 *                  attachmentSelector: string|null}>}
 */
export function readPortraitDefinitions(text, fileKey) {
  const definitions = [];
  const root = parseParadoxTree(text);
  for (const block of root.children) {
    if (!block.key || !block.children || block.key.toLowerCase() !== 'portraits') continue;
    for (const node of block.children) {
      if (!node.key || !node.children) continue;
      const textures = [];
      const direct = childValue(node, TEXTURE_KEYS);
      if (direct) textures.push(direct);
      const texturesBlock = childBlock(node, ['character_textures']);
      for (const entry of texturesBlock?.children ?? []) {
        if (entry.value) textures.push(entry.value);
      }
      definitions.push({
        id: node.key,
        file: fileKey,
        line: node.line,
        entity: childValue(node, ['entity']),
        textures,
        clothesSelector: childValue(node, ['clothes_selector']),
        attachmentSelector: childValue(node, ['attachment_selector']),
        hairSelector: childValue(node, ['hair_selector']),
      });
    }
  }
  return definitions;
}

/**
 * Every `entity = { ... }` an `.asset` file defines, at any nesting depth.
 *
 * `pdxmesh` is carried alongside the name because it is the SECOND link of the chain a portrait
 * walks - see `portrait-mesh-missing`. `attachRoot` is recorded for the entities that name no
 * `pdxmesh` at all and attach another entity instead (vanilla's `portrait_swarm_01_small_entity`
 * is `attach = { root = portrait_swarm_01_entity }`, with no mesh of its own).
 */
export function readEntityDefinitions(text) {
  const definitions = [];
  const walk = (node) => {
    if (node.key && node.children && node.key.toLowerCase() === 'entity') {
      const name = childValue(node, ['name']);
      if (name) {
        const attach = childBlock(node, ['attach']);
        definitions.push({
          name,
          pdxmesh: childValue(node, ['pdxmesh']),
          attachRoot: attach ? childValue(attach, ['root']) : null,
        });
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(parseParadoxTree(text));
  return definitions;
}

/** Every `entity = { name = "<x>" ... }` name a `.asset` file defines, at any nesting depth. */
export function readEntityNames(text) {
  return readEntityDefinitions(text).map((definition) => definition.name);
}

/**
 * Every `pdxmesh = { name = "<x>" file = "<y>.mesh" }` an `.gfx` (or `.asset`) file declares.
 *
 * Measured over the verified install: 3257 `pdxmesh` blocks, ALL of them in a `.gfx` file - 300
 * files under `gfx/`, every one of them under `gfx/models/`. `file` is a path relative to the ROOT
 * that declares the mesh, exactly like a portrait's `character_textures` entry.
 */
export function readMeshDefinitions(text) {
  const definitions = [];
  const walk = (node) => {
    if (node.key && node.children && node.key.toLowerCase() === 'pdxmesh') {
      const name = childValue(node, ['name']);
      if (name) definitions.push({ name, file: childValue(node, ['file']) });
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(parseParadoxTree(text));
  return definitions;
}

/** Index every entity name, every `pdxmesh` and every portrait definition a root provides. */
export function readPortraitIndex(roots) {
  const entities = new Map();
  const meshDefinitions = new Map();
  const definitions = [];
  const files = { portraitDefinitions: [], animationAssets: [], meshDefinitions: [] };
  for (const root of roots) {
    if (!root) continue;
    for (const file of listFilesRecursive(join(root, 'gfx', 'portraits', 'portraits'), ['.txt'])) {
      const fileKey = relativeKey(root, file);
      files.portraitDefinitions.push(fileKey);
      for (const definition of readPortraitDefinitions(readTextFile(file), fileKey)) {
        definitions.push({ ...definition, root });
      }
    }
    for (const file of listFilesRecursive(join(root, 'gfx', 'models', 'portraits'), ['.asset'])) {
      const fileKey = relativeKey(root, file);
      files.animationAssets.push(fileKey);
      for (const definition of readEntityDefinitions(readTextFile(file))) {
        if (!entities.has(definition.name)) entities.set(definition.name, { ...definition, file: fileKey, root });
      }
    }
    // The mesh declarations. Every `.gfx` under `gfx/`, not just `gfx/models/portraits`: a
    // `pdxmesh` is a GLOBAL name, and vanilla proves it by declaring the `locator_mesh` a vanilla
    // swarm portrait walks to at `gfx/models/_planetary_meshes.gfx` - three directories away from
    // any portrait. A rule restricted to the portraits subtree reports `mol5` as broken on a clean
    // install, which is exactly the class of phantom finding this module's header warns about.
    for (const file of listFilesRecursive(join(root, 'gfx'), ['.gfx'])) {
      const fileKey = relativeKey(root, file);
      const declared = readMeshDefinitions(readTextFile(file));
      if (declared.length === 0) continue;
      files.meshDefinitions.push(fileKey);
      for (const definition of declared) {
        if (!meshDefinitions.has(definition.name)) {
          // `meshFile` - NOT `file`, which is this module's name for the FILE the declaration was
          // read from (the `.gfx`), exactly as `entities` uses it.
          meshDefinitions.set(definition.name, { name: definition.name, meshFile: definition.file, file: fileKey, root });
        }
      }
    }
  }
  return { entities, meshDefinitions, definitions, files };
}

/** Does any indexed root contain this relative texture path? */
function textureExists(roots, candidates, relativePath) {
  const normalised = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalised.split('/');
  for (const root of candidates) {
    if (!root) continue;
    if (existsSync(join(root, ...segments))) return root;
  }
  return null;
}

/**
 * Analyse a portrait index against the rules.
 *
 * @param {{roots: string[], entities: Map, meshDefinitions: Map, definitions: object[], complete?: boolean}} input
 * @returns {{findings: object[], byRule: object, counts: object}}
 */
export function analysePortraits(input = {}) {
  const roots = (input.roots ?? []).filter(Boolean);
  const entities = input.entities ?? new Map();
  const meshDefinitions = input.meshDefinitions ?? new Map();
  const definitions = input.definitions ?? [];
  const complete = input.complete !== false;
  const findings = [];

  for (const definition of definitions) {
    if (definition.entity && !entities.has(definition.entity)) {
      const known = entities.get(definition.entity);
      findings.push({
        rule: 'portrait-entity-undefined',
        severity: 'error',
        where: `${definition.file}:${definition.line}`,
        path: definition.id,
        element: definition.id,
        entity: definition.entity,
        resolution: complete ? 'complete' : 'partial',
        message:
          `portrait \`${definition.id}\` names \`entity = "${definition.entity}"\`, which ${
            complete ? 'no' : 'none of the indexed'
          } \`gfx/models/portraits/**/*.asset\` defines${known ? ` (last seen at ${known.file})` : ''}. ` +
          'The engine resolves that name against its entity registry, and a missing key is not an error it reports: ' +
          'the portrait slot simply draws nothing. Define the entity, or point `entity` at one that exists.',
        suggestedFix:
          'either add `entity = { name = "' +
          definition.entity +
          '" pdxmesh = "<mesh>" default_state = "idle" state = { name = "idle" animation = "idle" } }` to a ' +
          '`gfx/models/portraits/<culture>/*_entities.asset`, or reuse a vanilla entity name.',
      });
    } else if (definition.entity) {
      // The SECOND link. An entity that names no `pdxmesh` attaches another entity instead
      // (`attach = { root = <entity> }`) and makes no claim about a mesh, so it is skipped rather
      // than reported - vanilla's `portrait_swarm_01_small_entity` is exactly that shape.
      const holder = entities.get(definition.entity);
      if (holder?.pdxmesh) {
        const mesh = meshDefinitions.get(holder.pdxmesh);
        if (!mesh) {
          findings.push({
            rule: 'portrait-mesh-missing',
            severity: 'error',
            where: `${definition.file}:${definition.line}`,
            path: definition.id,
            element: definition.id,
            entity: definition.entity,
            pdxmesh: holder.pdxmesh,
            resolution: complete ? 'complete' : 'partial',
            message:
              `portrait \`${definition.id}\` names \`entity = "${definition.entity}"\`, which this index has (in ` +
              `\`${holder.file}\`), but that entity declares \`pdxmesh = "${holder.pdxmesh}"\` and ${
                complete ? 'no' : 'none of the indexed'
              } \`gfx/**/*.gfx\` declares a mesh by that name. The portrait registers and the mesh never loads, so the ` +
              'slot stays empty. `pdxmesh` is a GLOBAL name, so the mesh may be declared in any `.gfx` under `gfx/`.',
            suggestedFix:
              'add `objectTypes = { pdxmesh = { name = "' +
              holder.pdxmesh +
              '" file = "<path>.mesh" animation = { id = "idle" type = "<animation name>" } scale = 1.0 } }` to a ' +
              '`gfx/**/*.gfx` the mod ships, or point the entity\'s `pdxmesh` at a name that is declared.',
          });
        } else if (mesh.meshFile && !textureExists(roots, roots, mesh.meshFile)) {
          findings.push({
            rule: 'portrait-mesh-missing',
            severity: 'error',
            where: `${definition.file}:${definition.line}`,
            path: definition.id,
            element: definition.id,
            entity: definition.entity,
            pdxmesh: holder.pdxmesh,
            meshFile: mesh.meshFile,
            resolution: complete ? 'complete' : 'partial',
            message:
              `portrait \`${definition.id}\` walks \`entity = "${definition.entity}"\` -> \`pdxmesh = "${holder.pdxmesh}"\` ` +
              `(declared in \`${mesh.file}\`) -> \`file = "${mesh.meshFile}"\`, and that file is in no indexed root. ` +
              'The path is relative to the ROOT that declares the mesh, so a mesh the mod ships belongs under the MOD ' +
              'folder and a mesh reused from vanilla must carry vanilla\'s exact relative path.',
            suggestedFix: `place the file at \`${String(mesh.meshFile).replace(/\\/g, '/')}\` under the root that declares the mesh, or point \`file\` at one that exists.`,
          });
        }
      }
    }

    for (const texture of definition.textures) {
      if (textureExists(roots, roots, texture)) continue;
      findings.push({
        rule: 'portrait-character-texture-missing',
        severity: 'warning',
        where: `${definition.file}:${definition.line}`,
        path: definition.id,
        element: definition.id,
        texture,
        resolution: complete ? 'complete' : 'partial',
        message:
          `portrait \`${definition.id}\` points at \`${texture}\`, which is in no indexed root. The path is ` +
          'relative to the ROOT that declares it, so a texture the mod ships belongs under the MOD folder, and a ' +
          'portrait that reuses vanilla art must carry vanilla\'s exact relative path. A missing file is drawn as ' +
          'whatever the mesh\'s UVs already sample, so the body can come out with a neighbouring portrait\'s skin.',
        suggestedFix: `place the file at \`${texture.replace(/\\/g, '/')}\` under the root that declares this portrait.`,
      });
    }
  }

  const byRule = {};
  for (const finding of findings) byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
  return {
    findings,
    byRule,
    counts: {
      roots: roots.length,
      portraitDefinitions: definitions.length,
      entities: entities.size,
      meshDefinitions: meshDefinitions.size,
      definitionsWithEntity: definitions.filter((definition) => definition.entity).length,
      definitionsWithTexture: definitions.filter((definition) => definition.textures.length > 0).length,
      complete,
    },
  };
}

/** Convenience: index the supplied roots and analyse them in one call. */
export function analysePortraitRoots(roots, { complete = true } = {}) {
  const index = readPortraitIndex(roots);
  return { ...analysePortraits({ ...index, roots, complete }), index };
}

export default {
  PORTRAIT_SEVERITY,
  PORTRAIT_DESCRIPTIONS,
  readPortraitDefinitions,
  readEntityDefinitions,
  readEntityNames,
  readMeshDefinitions,
  readPortraitIndex,
  analysePortraits,
  analysePortraitRoots,
};
