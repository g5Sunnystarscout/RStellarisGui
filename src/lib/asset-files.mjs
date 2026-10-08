/**
 * Inventory the IMAGE FILES under a path, and say whether any `.gfx` registers each one.
 *
 * The asset index answers "what sprites exist" -- it is built from `interface/**\/*.gfx`,
 * so it only ever knows about textures somebody already declared. That leaves the
 * other half of the job, which is the one that fails silently:
 *
 *   A texture file that no `.gfx` registers is invisible to the engine. Nothing
 *   errors, nothing logs, the sprite simply is not there.
 *
 * So this module walks the actual files, reads each one's real dimensions from its
 * header, and cross-references it against the index's resolved texture paths to
 * answer "is this file registered, by which sprites, and at what size". A file the
 * index has never heard of is reported as unregistered with a ready-to-paste
 * `spriteType` block, because that is the fix.
 *
 * Only `.gfx` registration is modelled. Stellaris also mounts textures through
 * `gfx/portraits/**` definition files, `gfx/models/**` entity files and
 * `interface/**\/*.gui` sprite references; a file used ONLY by those will be
 * reported unregistered here. The tool says so in `note` rather than implying the
 * file is dead.
 *
 * @module lib/asset-files
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readTextureHeader } from './dds.mjs';

/** Extensions the engine can read as a texture. */
export const IMAGE_EXTENSIONS = ['.dds', '.png', '.tga', '.jpg', '.jpeg'];

const SKIP_DIRS = new Set(['.git', '.cache', 'node_modules', 'out']);

/** Normalise a path for comparison: absolute, forward slashes, lower case. */
export function normalisePath(p) {
  return resolve(p).replace(/\\/g, '/').toLowerCase();
}

/**
 * Every file under the given roots whose extension is in the list.
 *
 * @param {string[]} roots directories (a mod root, or any subtree of one)
 * @param {string[]} extensions lower-case, with the dot
 * @param {{maxDepth?:number, limit?:number}} [options]
 */
export function findFilesWithExtensions(roots, extensions, options = {}) {
  const maxDepth = options.maxDepth ?? 16;
  const limit = options.limit ?? 200_000;
  const wanted = extensions.map((e) => e.toLowerCase());
  const found = [];
  const missing = [];

  for (const rawRoot of roots) {
    const root = resolve(String(rawRoot));
    if (!existsSync(root)) {
      missing.push(root);
      continue;
    }
    const stack = [{ dir: root, depth: 0 }];
    while (stack.length) {
      const { dir, depth } = stack.pop();
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < maxDepth && !SKIP_DIRS.has(entry.name)) stack.push({ dir: full, depth: depth + 1 });
          continue;
        }
        if (!entry.isFile()) continue;
        const dot = entry.name.lastIndexOf('.');
        if (dot < 0) continue;
        if (!wanted.includes(entry.name.slice(dot).toLowerCase())) continue;
        let size = 0;
        try {
          size = statSync(full).size;
        } catch {
          continue;
        }
        found.push({ absolute: full, size });
        if (found.length >= limit) return { files: found, missing, truncated: true };
      }
    }
  }
  return { files: found, missing, truncated: false };
}

/** Every image file under the given roots. */
export function findImageFiles(roots, options = {}) {
  return findFilesWithExtensions(roots, IMAGE_EXTENSIONS, options);
}

/**
 * Registration lookup built from an asset index.
 *
 * The index stores one `textures` record per referenced `textureFile`, keyed by the
 * path exactly as the `.gfx` spells it, with the resolved absolute path when one was
 * found. Two maps come out of it: absolute path -> sprite names, and absolute path ->
 * that texture's header record.
 */
export function buildRegistrationMap(index) {
  const byPath = new Map();
  const headers = new Map();

  for (const [name, sprite] of Object.entries(index?.sprites ?? {})) {
    if (!sprite?.textureFile) continue;
    const record = index.textures?.[sprite.textureFile];
    if (!record?.absolutePath) continue;
    const key = normalisePath(record.absolutePath);
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key).push({ name, kind: sprite.kind, declaredSize: sprite.declaredSize ?? null, file: sprite.file ?? null, line: sprite.line ?? null });
    if (record.ok && !headers.has(key)) headers.set(key, record);
  }
  return { byPath, headers };
}

/** The sprite name a texture file should get: the install's own convention. */
export function suggestSpriteName(relativePath) {
  const stem = String(relativePath).replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
  const cleaned = stem.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '');
  return `GFX_${cleaned}`;
}

/**
 * A pasteable registration block.
 *
 * The wrapper is included because a `.gfx` defines sprites inside `spriteTypes = { }`;
 * a bare block pasted at file scope is a syntax error, which is a needless way to
 * lose an hour.
 */
export function suggestSpriteType({ relativePath, name, header, asNewFile = false }) {
  const spriteName = name ?? suggestSpriteName(relativePath);
  const lines = [
    '\tspriteType = {',
    `\t\tname = "${spriteName}"`,
    `\t\ttextureFile = "${relativePath}"`,
    '\t}',
  ];
  const block = lines.join('\n');
  return {
    relativePath,
    spriteName,
    block,
    forNewFile: `spriteTypes = {\n${block}\n}\n`,
    size: header?.ok ? { width: header.width, height: header.height } : null,
    note: asNewFile
      ? 'Paste this into a new interface/<name>.gfx. The spriteTypes = { } wrapper is required.'
      : 'Paste inside an existing spriteTypes = { } block.',
  };
}

/**
 * Inventory image files and cross-reference them against the sprite index.
 *
 * @param {{dirs:string[], index:object, modRoot?:string|null, filter?:string,
 *          suggest?:boolean, limit?:number}} options
 */
export function inventoryImageFiles(options) {
  const dirs = (options.dirs ?? []).map(String);
  const { files, missing, truncated } = findImageFiles(dirs, { limit: options.limit });
  const { byPath, headers } = buildRegistrationMap(options.index);

  const assets = files.map((file) => {
    const rel = options.modRoot ? relative(options.modRoot, file.absolute).replace(/\\/g, '/') : file.absolute;
    const key = normalisePath(file.absolute);
    const sprites = byPath.get(key) ?? [];
    const header = headers.get(key) ?? readTextureHeader(file.absolute);
    return {
      rel,
      absolute: file.absolute,
      bytes: file.size,
      format: header?.ok ? (header.container ?? 'unknown') : null,
      width: header?.ok ? header.width : null,
      height: header?.ok ? header.height : null,
      readable: Boolean(header?.ok),
      unreadableReason: header?.ok ? null : (header?.reason ?? 'unrecognised image format'),
      registered: sprites.length > 0,
      sprites,
    };
  });

  const mode = options.filter ?? 'all';
  const filtered = mode === 'registered' ? assets.filter((a) => a.registered)
    : mode === 'unregistered' ? assets.filter((a) => !a.registered)
      : mode === 'unreadable' ? assets.filter((a) => !a.readable)
        : assets;

  const stats = {
    filesScanned: assets.length,
    registered: assets.filter((a) => a.registered).length,
    unregistered: assets.filter((a) => !a.registered).length,
    unreadable: assets.filter((a) => !a.readable).length,
    totalBytes: assets.reduce((sum, a) => sum + a.bytes, 0),
    byFormat: assets.reduce((acc, a) => {
      const key = a.format ?? 'unreadable';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };

  const suggestions = options.suggest
    ? assets.filter((a) => !a.registered && a.readable)
      .map((a) => suggestSpriteType({ relativePath: a.rel, header: { ok: true, width: a.width, height: a.height } }))
    : [];

  const result = {
    dirs,
    missingDirs: missing,
    truncated,
    indexSprites: Object.keys(options.index?.sprites ?? {}).length,
    indexTextureFiles: Object.keys(options.index?.textures ?? {}).length,
    filter: mode,
    stats,
    assets: filtered,
  };

  if (suggestions.length) result.suggestions = suggestions;

  // A file reading as unregistered has two very different causes, and they need
  // different actions: either nothing registers it (fix: add a spriteType), or its
  // .gfx was never indexed (fix: pass the mod root). Distinguishing them by asking
  // whether the scanned tree HOLDS .gfx files is provable, unlike inspecting the
  // index size -- the install alone contributes thousands of texture paths, so an
  // empty index is not the signal.
  if (stats.unregistered > 0 && stats.registered === 0) {
    const gfx = findFilesWithExtensions(dirs, ['.gfx'], { limit: 5000 });
    if (gfx.files.length > 0) {
      result.warning =
        `${gfx.files.length} .gfx file(s) exist under the scanned directories but none of them was part of the index, `
        + 'so every texture here reads as unregistered. Pass the mod root as extra_roots (or game_root for an install) '
        + 'and re-run: without that the engine cannot see these textures either.';
      result.gfxFilesNotIndexed = gfx.files.length;
    } else if (result.indexTextureFiles === 0) {
      result.warning =
        'no .gfx file was found here and the index holds no texture paths at all, so there is nothing to register these '
        + 'against. Check the directory, then add an interface/<name>.gfx.';
    }
  }
  return result;
}
