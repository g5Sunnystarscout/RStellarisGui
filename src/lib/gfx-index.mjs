//------------------------------------------------------------------------------------
// gfx-index.mjs -- Part of RStellarisGui
//
// The `assets` deliverable: read `interface/**/*.gfx` and build sprite name ->
// { texture path, declared size, kind, defining file:line }.
//
// The single most important rule here comes from a hard-won bug in an earlier mod tool:
// sprite names are NOT only declared in `spriteType` blocks. Vanilla 4.4.6 also declares
// them in `corneredTileSpriteType`, `tileSpriteType`, `maskedShieldType`, `progressBarType`,
// `portraitType`, `flagSpriteType`, `frameAnimatedSpriteType`, `textSpriteType`,
// `PieChartType`, `progressbarType` and `SpriteType` (both spellings appear). Indexing only
// `spriteType` produced 68 false "unknown sprite" errors, so this module indexes every
// `name = "GFX_..."` it can find and records which block kind declared it.
//
// Measured on the verified 4.4.6 install: 131 `.gfx` files under interface/, 9233 distinct
// `GFX_` names by the strict `name = "GFX_..."` pattern (the brief's 9245 includes a few
// hundred unquoted or oddly-cased names). The per-kind census is in docs/sources.md.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { basename, join, relative, sep } from 'node:path';

import { parseParadox, resolveVariable } from './paradox.mjs';
import { listFilesRecursive, readTextFile } from './paths.mjs';

/**
 * Block keys that can introduce a named sprite. Ordered by observed frequency; the list is
 * deliberately generous because a missed key shows up as a false validation error, while an
 * extra key costs nothing.
 */
export const SPRITE_BLOCK_KINDS = [
  'spriteType',
  'corneredTileSpriteType',
  'progressBarType',
  'progressbarType',
  'SpriteType',
  'portraitType',
  'flagSpriteType',
  'frameAnimatedSpriteType',
  'textSpriteType',
  'maskedShieldType',
  'tileSpriteType',
  'PieChartType',
  'LineChartType',
  'pieChartType',
  'lineChartType',
  'shieldType',
  'animatedSpriteType',
  'maskedSpriteType',
];

const SPRITE_KIND_LOOKUP = new Map(SPRITE_BLOCK_KINDS.map((kind) => [kind.toLowerCase(), kind]));

/** Convert an absolute path to a forward-slashed path relative to `root`. */
function keyOf(root, absolute) {
  return relative(root, absolute).split(sep).join('/');
}

/** Read the scalar fields of a sprite block. */
function readFields(children, variables) {
  const fields = {};
  for (const child of children ?? []) {
    if (!child.key || child.children) continue;
    fields[child.key] = resolveVariable(child.value, variables);
    fields[`${child.key}@line`] = child.line;
  }
  return fields;
}

/** Pick the first present key, case-insensitively, from a field map. */
function pick(fields, names) {
  for (const name of names) {
    if (fields[name] !== undefined) return fields[name];
  }
  const lowered = new Map(Object.keys(fields).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const actual = lowered.get(name.toLowerCase());
    if (actual !== undefined) return fields[actual];
  }
  return undefined;
}

/** Parse a `size = { x = N y = N }` / `size = { width = .. height = .. }` block. */
function readDeclaredSize(children) {
  const sizeEntry = (children ?? []).find((child) => child.key && child.key.toLowerCase() === 'size' && child.children);
  if (!sizeEntry) return null;
  const fields = {};
  for (const child of sizeEntry.children) {
    if (child.key && !child.children) fields[child.key.toLowerCase()] = child.value;
  }
  const width = fields.width ?? fields.x;
  const height = fields.height ?? fields.y;
  if (width === undefined && height === undefined) return null;
  return {
    width: width !== undefined ? Number(width) : null,
    height: height !== undefined ? Number(height) : null,
  };
}

/**
 * Parse a `borderSize = { x = N y = N }` block.
 *
 * This is the 9-slice border of a `corneredTileSpriteType`: the four corners are drawn at their
 * natural size and the four edges plus the middle are stretched to fill the element. Without it
 * the preview could only squash the whole texture into the rect, which is what made window
 * chrome render as a flat colour block (see docs/sources.md, A4).
 */
function readBorderSize(children) {
  const entry = (children ?? []).find((child) => child.key && child.key.toLowerCase() === 'bordersize' && child.children);
  if (!entry) return null;
  const fields = {};
  for (const child of entry.children) {
    if (child.key && !child.children) fields[child.key.toLowerCase()] = child.value;
  }
  const x = Number(fields.x ?? fields.width);
  const y = Number(fields.y ?? fields.height);
  if (!Number.isFinite(x) && !Number.isFinite(y)) return null;
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

/** `noOfFrames = 3` means the texture is a strip of three frames; frame 0 is the drawn one. */
function readFrameCount(children) {
  const entry = (children ?? []).find((child) => child.key && /^noofframes$/i.test(child.key) && !child.children);
  const value = Number(entry?.value);
  return Number.isFinite(value) && value > 1 ? Math.floor(value) : 1;
}

/** Font block kinds: `fonts.gfx` declares these, and `.gui` `font =` fields resolve to them. */
export const FONT_BLOCK_KINDS = ['bitmapfont', 'bitmapfont_override', 'bitmapFont', 'font'];

const FONT_KIND_LOOKUP = new Map(FONT_BLOCK_KINDS.map((kind) => [kind.toLowerCase(), kind]));

const TEXTURE_EXTENSIONS = ['.dds', '.tga', '.png', '.jpg', '.jpeg'];

/**
 * Find a texture path in a sprite block. `texturefile` is the documented key, but a few
 * vanilla blocks use `textureFile` or nest the path, so fall back to any scalar value that
 * looks like an image path. 943 of 9194 vanilla sprite records have no `texturefile` at all
 * (generated/procedural sprites), so a null here is normal and must not become a validation
 * error on its own.
 */
function readTexturePath(children) {
  const direct = (children ?? []).find((child) => child.key && /^texturef/i.test(child.key) && !child.children);
  if (direct && direct.value) return String(direct.value);
  for (const child of children ?? []) {
    if (child.key && !child.children && typeof child.value === 'string') {
      const lowered = child.value.toLowerCase();
      if (TEXTURE_EXTENSIONS.some((extension) => lowered.endsWith(extension))) return child.value;
    }
  }
  return null;
}

/**
 * Parse one `.gfx` file into sprite and font records.
 *
 * Structure note: `spriteTypes = { spriteType = { ... } ... }` and
 * `bitmapfonts = { bitmapfont = { ... } ... }`, so a definition block sits one level below
 * its wrapper. Descending is therefore iterative rather than a single hop: `bitmapfonts`
 * also nests a `textcolors` block, and an earlier revision that descended exactly one level
 * from each root indexed no fonts at all.
 *
 * @returns {{sprites: object[], fonts: object[]}}
 */
export function parseGfxFile(text, fileKey) {
  const { roots, variables } = parseParadox(text);
  const sprites = [];
  const fonts = [];
  const lines = text.split(/\r?\n/);
  const seenSprites = new Set();
  const seenFonts = new Set();

  const visit = (block, depth) => {
    if (block.key && block.children) {
      const spriteKind = SPRITE_KIND_LOOKUP.get(block.key.toLowerCase());
      const fontKind = FONT_KIND_LOOKUP.get(block.key.toLowerCase());
      if (spriteKind || fontKind) {
        const fields = readFields(block.children, variables);
        const name = pick(fields, ['name']);
        if (typeof name === 'string' && name !== '') {
          if (spriteKind && !seenSprites.has(name)) {
            seenSprites.add(name);
            sprites.push({
              name,
              kind: spriteKind,
              textureFile: readTexturePath(block.children),
              declaredSize: readDeclaredSize(block.children),
              borderSize: readBorderSize(block.children),
              frameCount: readFrameCount(block.children),
              file: fileKey,
              line: block.line,
              lineText: (lines[block.line - 1] ?? '').trim().slice(0, 120),
            });
          } else if (fontKind && !seenFonts.has(name)) {
            seenFonts.add(name);
            fonts.push({ name, kind: fontKind, file: fileKey, line: block.line });
          }
        }
        return; // do not descend into a definition block looking for more definitions
      }
    }
    if (depth >= 4) return;
    for (const child of block.children ?? []) visit(child, depth + 1);
  };

  for (const root of roots) visit(root, 0);

  return { sprites, fonts };
}

/** Parse every `.gfx` in a list of absolute paths. */
export function parseGfxFiles(root, files) {
  const sprites = [];
  const fonts = [];
  const perFile = [];
  for (const file of files) {
    const fileKey = keyOf(root, file);
    const parsed = parseGfxFile(readTextFile(file), fileKey);
    perFile.push({ file: fileKey, sprites: parsed.sprites.length, fonts: parsed.fonts.length });
    sprites.push(...parsed.sprites);
    fonts.push(...parsed.fonts);
  }
  return { sprites, fonts, perFile };
}

/** Find the `.gfx` files under `interface/` of an install or mod root. */
export function findGfxFiles(root) {
  return listFilesRecursive(join(root, 'interface'), ['.gfx']);
}

/** Line text helper used by reports. */
export function describeSprite(sprite) {
  const size = sprite.declaredSize;
  const sizeText = size ? `${size.width ?? '?'}x${size.height ?? '?'}` : 'unsized';
  return `${sprite.kind} ${sprite.name} (${sizeText}) at ${sprite.file}:${sprite.line}${
    sprite.textureFile ? ` -> ${sprite.textureFile}` : ''
  }`;
}

export { basename };
