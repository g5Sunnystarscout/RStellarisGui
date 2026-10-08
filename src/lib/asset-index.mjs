//------------------------------------------------------------------------------------
// asset-index.mjs -- Part of RStellarisGui
//
// The `assets` deliverable and its cache.
//
// Builds one JSON document from a Stellaris install (or mod) root:
//   sprites       name -> { kind, textureFile, declaredSize, file, line }
//   textures      texture path -> real DDS width/height/format/mipCount (from the header)
//   fonts         name -> { file, line }   (from `bitmapfonts` blocks in .gfx)
//   buttonEffects top-level keys from common/button_effects/*.txt
//   containers    `containerWindowType` / `windowType` names defined by interface/**/*.gui
//   gfxFiles/guiFiles inventories
//
// Cached at <project>/.cache/assets-<hash>.json, keyed by root path + game version + a
// schema version, so a rebuild is skipped unless something actually changed.
//
// Cost note: reading DDS *headers* for every sprite-referenced texture is cheap (128 bytes
// per file). Reading headers for all 21305 .dds files in gfx/ is a separate, opt-in deep
// census (`deepTextureCensus`) because it is ~20x the file opens for information the layout
// engine does not need.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';

import { readTextureHeader } from './dds.mjs';
import { findGfxFiles, parseGfxFiles } from './gfx-index.mjs';
import { parseParadox, topLevelKeys } from './paradox.mjs';
import { cacheRoot, listFilesRecursive, readTextFile, relativeKey, resolveGameRoot } from './paths.mjs';

export const ASSET_INDEX_SCHEMA = 4;

/** Read a game version string out of launcher-settings.json, for cache keying. */
export function readGameVersion(root) {
  const settingsPath = join(root, 'launcher-settings.json');
  if (!existsSync(settingsPath)) return 'unknown';
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return String(parsed.rawVersion ?? parsed.version ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

/** Every `.gui` file under `interface/` (177 on the verified 4.4.6 install). */
export function findGuiFiles(root) {
  return listFilesRecursive(join(root, 'interface'), ['.gui']);
}

/** Every `common/button_effects/*.txt` file (2 on the verified 4.4.6 install). */
export function findButtonEffectFiles(root) {
  return listFilesRecursive(join(root, 'common', 'button_effects'), ['.txt']);
}

/**
 * `containerWindowType` / `windowType` names defined anywhere in the install. Used to warn
 * when a layout reuses a name that vanilla already defines.
 */
export function indexContainerNames(root, guiFiles) {
  const containers = new Map();
  for (const file of guiFiles) {
    const fileKey = relativeKey(root, file);
    const { roots } = parseParadox(readTextFile(file));
    const visit = (block) => {
      if (block.key && block.children) {
        const lowered = block.key.toLowerCase();
        if (lowered === 'containerwindowtype' || lowered === 'windowtype') {
          const nameEntry = block.children.find(
            (child) => child.key && child.key.toLowerCase() === 'name' && !child.children,
          );
          if (nameEntry?.value && !containers.has(nameEntry.value)) {
            containers.set(nameEntry.value, { file: fileKey, line: block.line });
          }
        }
      }
      for (const child of block.children ?? []) visit(child);
    };
    for (const entry of roots) visit(entry);
  }
  return containers;
}

/**
 * Resolve a `.gfx` `textureFile` value to an absolute path on disk.
 *
 * `roots` may be several directories: a mod's `interface/zz_x.gfx` points at
 * `gfx/interface/zz_x.dds` inside the MOD, not the install, so the mod root has to be searched
 * as well. The root the sprite was declared in is tried first (see `buildAssetIndex`), then the
 * rest in order, which is the same precedence the engine uses for a load order.
 */
export function resolveTexturePath(rootOrRoots, textureFile) {
  if (!textureFile) return null;
  const roots = Array.isArray(rootOrRoots) ? rootOrRoots : [rootOrRoots];
  const normalised = String(textureFile).replace(/\\/g, '/').replace(/^\/+/, '');
  for (const root of roots) {
    if (!root) continue;
    const candidate = join(root, ...normalised.split('/'));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Build the full asset index. Returns the index object plus build statistics.
 *
 * @param {{root?: string, extraRoots?: string[], deepTextureCensus?: boolean, thumbnailPixels?: number}} options
 */
export function buildAssetIndex(options = {}) {
  const started = Date.now();
  const root = resolveGameRoot(options.root);
  // B8: a mod ships its own `interface/*.gfx` with its own sprites, and without its root in the
  // index every one of those sprites is reported `unknown-sprite` and drawn as a placeholder.
  // Extra roots are searched after the install and only need to look like a mod or install root.
  const roots = [root, ...(options.extraRoots ?? []).map((extra) => resolveExtraRoot(extra)).filter(Boolean)];
  const version = readGameVersion(root);

  const gfxFiles = roots.flatMap((entry) => findGfxFiles(entry));
  const guiFiles = roots.flatMap((entry) => findGuiFiles(entry));
  const effectFiles = roots.flatMap((entry) => findButtonEffectFiles(entry));

  const gfxStarted = Date.now();
  const spriteLists = [];
  const fontLists = [];
  const perFile = [];
  for (const entry of roots) {
    const parsed = parseGfxFiles(entry, findGfxFiles(entry));
    for (const sprite of parsed.sprites) spriteLists.push({ ...sprite, root: entry });
    for (const font of parsed.fonts) fontLists.push({ ...font, root: entry });
    perFile.push(...parsed.perFile.map((file) => ({ ...file, root: entry })));
  }
  const sprites = spriteLists;
  const fonts = fontLists;
  const gfxMs = Date.now() - gfxStarted;

  // Deduplicate sprites by name, keeping the first declaration and recording collisions.
  const spriteMap = new Map();
  const duplicateSprites = [];
  for (const sprite of sprites) {
    if (spriteMap.has(sprite.name)) {
      duplicateSprites.push({ name: sprite.name, first: spriteMap.get(sprite.name), duplicate: sprite });
      continue;
    }
    spriteMap.set(sprite.name, sprite);
  }

  const fontMap = new Map();
  for (const font of fonts) if (!fontMap.has(font.name)) fontMap.set(font.name, font);

  // Headers for every distinct texture a sprite points at. The root the sprite came from is
  // tried first, so a mod's own texture wins over a same-named install file.
  const textureStarted = Date.now();
  const textures = {};
  let headerReads = 0;
  let headerFailures = 0;
  const textureCache = new Map();
  for (const sprite of spriteMap.values()) {
    if (!sprite.textureFile) continue;
    const cacheKey = `${sprite.root}|${sprite.textureFile}`;
    if (textureCache.has(cacheKey)) continue;
    textureCache.set(cacheKey, null);
    const ordered = [sprite.root, ...roots.filter((entry) => entry !== sprite.root)];
    const absolute = resolveTexturePath(ordered, sprite.textureFile);
    if (!absolute) {
      textureCache.set(cacheKey, { ok: false, reason: 'file not found' });
      if (!textures[sprite.textureFile]) textures[sprite.textureFile] = { ok: false, reason: 'file not found' };
      continue;
    }
    headerReads += 1;
    const header = readTextureHeader(absolute);
    if (!header.ok) headerFailures += 1;
    const record = header.ok
      ? {
          ok: true,
          container: header.container ?? 'dds',
          width: header.width,
          height: header.height,
          format: header.format,
          mipCount: header.mipCount,
          hasAlpha: header.hasAlpha,
          decodable: header.decodable !== false,
          bytes: header.size,
          dx10: header.dx10 ?? null,
          absolutePath: absolute,
        }
      : { ok: false, reason: header.reason };
    textureCache.set(cacheKey, record);
    if (!textures[sprite.textureFile]?.ok) textures[sprite.textureFile] = record;
  }
  const textureMs = Date.now() - textureStarted;

  const effectStarted = Date.now();
  const buttonEffects = new Map();
  for (const entry of roots) {
    for (const file of findButtonEffectFiles(entry)) {
      const fileKey = relativeKey(entry, file);
      for (const key of topLevelKeys(readTextFile(file))) {
        if (!buttonEffects.has(key.key)) buttonEffects.set(key.key, { file: fileKey, line: key.line, root: entry });
      }
    }
  }
  const effectMs = Date.now() - effectStarted;

  const containerStarted = Date.now();
  const containers = new Map();
  for (const entry of roots) {
    // THE ROOT IS KEPT, not just the root-relative key (GAP-9). A consumer that needs to know
    // whether a hit is the file it is validating - the `container-name-collision` rule - otherwise
    // has only `interface/<name>.gui` to compare against an absolute path, and a mod file literally
    // named like the vanilla file it shadows compares EQUAL to the vanilla hit. Measured: a mod's
    // `interface/planet_view.gui` redefining `planet_view` reported 0 collisions when the true
    // answer is 1, because the self-test swallowed it. With the root recorded, identity is exact.
    for (const [name, at] of indexContainerNames(entry, findGuiFiles(entry))) {
      if (!containers.has(name)) containers.set(name, { ...at, root: entry });
    }
  }
  const containerMs = Date.now() - containerStarted;

  const index = {
    schema: ASSET_INDEX_SCHEMA,
    root,
    roots,
    version,
    builtAt: new Date().toISOString(),
    stats: {
      buildMs: Date.now() - started,
      gfxMs,
      textureMs,
      effectMs,
      containerMs,
      rootCount: roots.length,
      gfxFileCount: gfxFiles.length,
      guiFileCount: guiFiles.length,
      buttonEffectFileCount: effectFiles.length,
      spriteRecordCount: sprites.length,
      spriteCount: spriteMap.size,
      duplicateSpriteCount: duplicateSprites.length,
      fontCount: fontMap.size,
      containerCount: containers.size,
      buttonEffectCount: buttonEffects.size,
      textureHeaderReads: headerReads,
      textureHeaderFailures: headerFailures,
      distinctTextureCount: Object.keys(textures).length,
    },
    sprites: Object.fromEntries(spriteMap),
    fonts: Object.fromEntries(fontMap),
    textures,
    buttonEffects: Object.fromEntries(buttonEffects),
    // The ABSOLUTE paths of the indexed `common/button_effects/*.txt` files, beside the root-relative
    // list below. The visibility analysis (GAP-12) has to READ each file to see its entries'
    // `potential` blocks, and a root-relative key cannot be resolved without knowing which root it
    // came from - the install's own two files and a mod's are merged into one list here.
    buttonEffectPaths: effectFiles.map((file) => resolvePath(file)),
    containers: Object.fromEntries(containers),
    files: {
      gfx: gfxFiles.map((file) => relativeToAnyRoot(roots, file)),
      gui: guiFiles.map((file) => relativeToAnyRoot(roots, file)),
      buttonEffects: effectFiles.map((file) => relativeToAnyRoot(roots, file)),
    },
    perGfxFile: perFile,
  };

  if (options.deepTextureCensus) {
    index.deepCensus = deepTextureCensus(root);
  }

  index.stats.indexBytes = Buffer.byteLength(JSON.stringify(index), 'utf8');
  return index;
}

/** The first root a file lives under, as a relative key. */
function relativeToAnyRoot(roots, file) {
  for (const root of roots) {
    if (file.toLowerCase().startsWith(root.toLowerCase())) return relativeKey(root, file);
  }
  return relativeKey(roots[0], file);
}

/**
 * Accept an extra root (a mod's folder, or a loose `interface/` tree) without the install
 * checks: a mod has `interface/`, `common/` and `gfx/` but no launcher-settings.json.
 */
export function resolveExtraRoot(requested) {
  if (typeof requested !== 'string' || requested.trim() === '') return null;
  const root = resolvePath(requested);
  if (!existsSync(join(root, 'interface')) && !existsSync(join(root, 'gfx')) && !existsSync(join(root, 'common'))) {
    throw new Error(`${root} does not look like a Stellaris mod or install root (no interface/, gfx/ or common/)`);
  }
  return root;
}

/**
 * Read the DDS header of every `.dds` under `gfx/`. Expensive; report only.
 * The measured distribution for the verified install is in the dds.mjs header comment.
 */
export function deepTextureCensus(root) {
  const started = Date.now();
  const files = listFilesRecursive(join(root, 'gfx'), ['.dds']);
  const formats = {};
  const depths = {};
  let failures = 0;
  let largest = 0;
  let largestPath = null;
  let mipHistogram = {};
  for (const file of files) {
    const header = readDdsHeader(file);
    if (!header.ok) {
      failures += 1;
      continue;
    }
    formats[header.format] = (formats[header.format] ?? 0) + 1;
    if (header.format.startsWith('RGBA')) {
      const depth = `${header.pixelFormat.rgbBitCount}bpp`;
      depths[depth] = (depths[depth] ?? 0) + 1;
    }
    mipHistogram[header.mipCount] = (mipHistogram[header.mipCount] ?? 0) + 1;
    const pixels = header.width * header.height;
    if (pixels > largest) {
      largest = pixels;
      largestPath = relativeKey(root, file);
    }
  }
  return {
    fileCount: files.length,
    failures,
    formats,
    uncompressedDepths: depths,
    mipHistogram,
    largestPixels: largest,
    largestPath,
    ms: Date.now() - started,
  };
}

/** Stable cache path for a root set. */
export function assetCachePath(root, extraRoots = []) {
  const key = [root, ...extraRoots.map((entry) => resolvePath(entry))].join('|');
  const hash = createHash('sha1').update(`${key}|${ASSET_INDEX_SCHEMA}`).digest('hex').slice(0, 12);
  return join(cacheRoot(), `assets-${hash}.json`);
}

/** Load a cached index if it exists and matches the root set and version. */
export function loadCachedAssetIndex(root, extraRoots = []) {
  const path = assetCachePath(root, extraRoots);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed.schema !== ASSET_INDEX_SCHEMA || parsed.root !== root) return null;
    if (parsed.version !== readGameVersion(root)) return null;
    parsed.cachePath = path;
    parsed.fromCache = true;
    return parsed;
  } catch {
    return null;
  }
}

/** Write the index to the cache directory, creating it if needed. */
export function saveAssetIndex(index) {
  const path = assetCachePath(index.root, (index.roots ?? []).slice(1));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(index), 'utf8');
  return path;
}

/**
 * Get the index for a root set: cached when possible, rebuilt otherwise.
 * @param {{root?: string, extraRoots?: string[], refresh?: boolean, deepTextureCensus?: boolean}} options
 */
export function getAssetIndex(options = {}) {
  const root = resolveGameRoot(options.root);
  const extraRoots = (options.extraRoots ?? []).map((extra) => resolveExtraRoot(extra)).filter(Boolean);
  if (!options.refresh) {
    const cached = loadCachedAssetIndex(root, extraRoots);
    if (cached) return cached;
  }
  const index = buildAssetIndex({ ...options, root, extraRoots });
  index.cachePath = saveAssetIndex(index);
  index.fromCache = false;
  return index;
}

/**
 * Search sprites by name substring, with optional size and kind filters.
 *
 * @param {object} index
 * @param {{query?: string, kind?: string, minWidth?: number, maxWidth?: number,
 *          minHeight?: number, maxHeight?: number, hasTexture?: boolean, limit?: number}} filters
 */
export function searchSprites(index, filters = {}) {
  const query = (filters.query ?? '').toLowerCase();
  const kind = filters.kind ? filters.kind.toLowerCase() : null;
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const results = [];

  for (const [name, sprite] of Object.entries(index.sprites)) {
    if (query && !name.toLowerCase().includes(query)) continue;
    if (kind && sprite.kind.toLowerCase() !== kind) continue;
    if (filters.hasTexture === true && !sprite.textureFile) continue;
    if (filters.hasTexture === false && sprite.textureFile) continue;

    const texture = sprite.textureFile ? index.textures[sprite.textureFile] : null;
    const width = texture?.ok ? texture.width : sprite.declaredSize?.width ?? null;
    const height = texture?.ok ? texture.height : sprite.declaredSize?.height ?? null;

    if (filters.minWidth !== undefined && (width === null || width < filters.minWidth)) continue;
    if (filters.maxWidth !== undefined && (width === null || width > filters.maxWidth)) continue;
    if (filters.minHeight !== undefined && (height === null || height < filters.minHeight)) continue;
    if (filters.maxHeight !== undefined && (height === null || height > filters.maxHeight)) continue;

    results.push({
      name,
      kind: sprite.kind,
      textureFile: sprite.textureFile,
      width,
      height,
      sizeSource: texture?.ok ? 'dds-header' : sprite.declaredSize ? 'gfx-declared' : 'unknown',
      format: texture?.ok ? texture.format : null,
      mipCount: texture?.ok ? texture.mipCount : null,
      file: sprite.file,
      line: sprite.line,
    });
    if (results.length >= limit) break;
  }

  results.sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0));
  return results;
}

/** Full metadata for one sprite. */
export function spriteInfo(index, name) {
  const sprite = index.sprites[name];
  if (!sprite) {
    // Offer near misses so an agent can self-correct instead of guessing again.
    const lower = name.toLowerCase();
    const suggestions = Object.keys(index.sprites)
      .filter((candidate) => candidate.toLowerCase().includes(lower.replace(/^gfx_/, '')))
      .slice(0, 10);
    return { found: false, name, suggestions };
  }
  const texture = sprite.textureFile ? index.textures[sprite.textureFile] : null;
  return {
    found: true,
    name,
    kind: sprite.kind,
    textureFile: sprite.textureFile,
    declaredSize: sprite.declaredSize,
    texture: texture ?? null,
    definedAt: { file: sprite.file, line: sprite.line },
    lineText: sprite.lineText,
    readable: Boolean(texture?.ok),
  };
}

/** A small curated "part box" of verified default sprites and fonts, for a new layout. */
export function defaultParts(index) {
  const sprites = [
    'GFX_tile_large_bg',
    'GFX_tile_large_bg_plain',
    'GFX_tiling_button_standard',
    'GFX_button_close',
    'GFX_main_close_button',
  ];
  const fonts = ['malgun_goth_24', 'cg_16b'];
  return {
    sprites: sprites.map((name) => ({
      name,
      ...(index.sprites[name]
        ? {
            kind: index.sprites[name].kind,
            textureFile: index.sprites[name].textureFile,
            width: index.textures[index.sprites[name].textureFile]?.width ?? null,
            height: index.textures[index.sprites[name].textureFile]?.height ?? null,
            present: true,
          }
        : { present: false }),
    })),
    fonts: fonts.map((name) => ({ name, ...(index.fonts[name] ?? { present: false }) })),
    note:
      'Verified against Stellaris 4.4.6. Sprites are corneredTileSpriteType where noted, which is ' +
      'what makes `size = { x = N y = N }` meaningful on a buttonType (see docs/sources.md).',
  };
}

/** Best available raster size for a texture, using its mip chain. */
export function textureMipPlan(index, textureFile, target) {
  const record = index.textures[textureFile];
  if (!record?.ok) return null;
  const levels = [];
  for (let level = 0; level < record.mipCount; level += 1) {
    levels.push({ level, width: Math.max(1, record.width >> level), height: Math.max(1, record.height >> level) });
  }
  const placeholder = { width: record.width, height: record.height, mipCount: record.mipCount };
  const chosen = pickMip({ ok: true, mipOffsets: levels }, target);
  return { ...placeholder, chosen };
}

export { basename, statSync };
