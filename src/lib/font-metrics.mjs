//------------------------------------------------------------------------------------
// font-metrics.mjs -- Part of RStellarisGui
//
// REAL TEXT EXTENTS. This module answers the question the rect model cannot: how many
// PIXELS wide and tall does a resolved localisation string actually render?
//
// WHY THIS EXISTS. `instantTextBoxType` is sized by `maxWidth`/`maxHeight`, which is the box
// the engine lays text out IN, not the size of the text. So every "the text overflows" or
// "these two elements overlap" statement built on element rects is a statement about BOXES.
// The defects a human sees - a Chinese title running off its plate, a wrapped body growing
// down over the row below, two labels colliding - are invisible to the box model. An earlier
// revision estimated glyph width as `0.55em` from the number in the font's NAME (`cg_16b` ->
// 16px), which is a guess, not a measurement.
//
// WHAT THE INSTALL ACTUALLY SHIPS (verified against <Stellaris>, 4.4.6):
//
//   * `gfx/fonts/*.fnt` - AngleCode BMFont TEXT descriptors, one per bitmap font. They carry
//     per-glyph `xadvance`, `xoffset`, `yoffset`, `width`, `height`, `page`, plus
//     `lineHeight`, `base`, `scaleW`, `scaleH`, and - in `juralightmedium.fnt` (6744 pairs)
//     and `standard.fnt` (333 pairs) - real `kerning` pairs. Example:
//     `gfx/fonts/cg_16b.fnt:2` `common lineHeight=16 base=13 scaleW=256 scaleH=256 pages=1`,
//     `gfx/fonts/cg_16b.fnt:4` `char id=33 x=182 y=146 width=9 height=16 xoffset=-3
//     yoffset=0 xadvance=4 page=0`, `gfx/fonts/standard.fnt:... kerning first=.. second=..
//     amount=..`. THIS IS THE ENGINE'S OWN METRIC SOURCE, so widths read from it are EXACT.
//     The engine's parser is visible in the executable as the token list
//     `lineHeight` / `chars` / `base (%d) in '%s' does not match previous fontfiles in font
//     '%s'` / `lineHeight (%d) ... does not match` / `scaleH` / `scaleW` / `char` / `kerning`
//     inside `pdx_oldgui/graphics/bitmapfont.cpp` (strings at stellaris.exe).
//   * `gfx/fonts/*.ttf`, `*.otf` - real TrueType/OpenType files (`NotoSansCJKsc-Regular.otf`,
//     `NotoSansJP-Regular.otf`, `Arimo-Regular.ttf`, ...), referenced by `fonts.asset` and used
//     by the `bitmapfont_override { ttf_font = .. ttf_size = .. }` blocks that replace the
//     bitmap font for `l_simp_chinese`, `l_japanese`, `l_korean`, `l_russian`, `l_polish`.
//     These carry `hmtx` advances and a `cmap`, so the CJK path is measurable too, exactly.
//
// WHAT IT DOES NOT SHIP: any per-glyph metric outside those files, and any documented
// text-measure API (no `documentation/` folder, and no `GetTextSize`/`MeasureText`/
// `CalcTextSize`/`GetStringWidth` string in `stellaris.exe`). `GetTextExtentPoint32A` IS
// imported from GDI32.dll, but it is not the `.gui` text path - that path is
// `pdx_oldgui/graphics/bitmapfont.cpp` reading the `.fnt` files, which is why this module
// reads them too.
//
// UNITS. Layout is in base-resolution (1920x1080) pixels. The `.fnt` metrics are in the same
// pixels: `fonts.gfx:175` declares `cursor_offset = { -3 -5 }` for `cg_16b` and every glyph in
// `cg_16b.fnt` carries `xoffset=-3`, i.e. the engine's layout-space cursor offset is literally
// the `.fnt` glyph xoffset. `scaleW`/`scaleH` also match the shipped atlas exactly
// (`cg_16b.fnt` 256x256 vs `cg_16b.dds` = 128-byte header + 256*256*4), which ties the
// descriptor we parse to the texture the game draws.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { tokenize } from './paradox.mjs';
import { listFilesRecursive, readTextFile } from './paths.mjs';

/** Bumped when a metric rule changes, so a report can say which measurement produced it. */
export const FONT_METRICS_VERSION = 'font-metrics/1';

/**
 * The exactness claim this module makes, in one place, so the docs and the code cannot drift.
 *
 * `bitmap` is exact because the `.fnt` file IS the engine's metric table - the engine parses
 * the same `char`/`kerning`/`lineHeight` records (see the `bitmapfont.cpp` token list in
 * `stellaris.exe`). `sfnt` is exact for advances (`hmtx` is the advance table FreeType reads)
 * and for the glyph lookup; only its LINE HEIGHT is derived, because the engine's
 * `ttf_font`/`ttf_size` path computes it inside `pdx_font.cpp` and no formula is published.
 */
export const METRIC_EXACTNESS = {
  bitmap:
    'exact: per-glyph advances and kerning are read from the .fnt descriptor the engine itself parses',
  sfnt:
    'exact advances from the TrueType/OpenType `hmtx` table scaled by ttf_size/unitsPerEm; line height is derived (hhea ascender-descender+lineGap), not read from a shipped value',
  estimate: 'estimate: no font descriptor was found',
};

/** Average advance used ONLY when nothing at all can be measured, as a fraction of one em. */
const FALLBACK_ADVANCE_EM = 0.55;

/** The name-sized heuristic this module replaces, kept for calibration reports and error bars. */
export function nameSizedAdvance(name) {
  const match = /(\d{1,3})/.exec(String(name ?? ''));
  const value = match ? Number(match[1]) : 16;
  const em = Number.isFinite(value) && value > 0 ? value : 16;
  return { em, advance: em * FALLBACK_ADVANCE_EM };
}

//====================================================================================
// 1. AngleCode BMFont `.fnt`
//====================================================================================

/**
 * `key=value` pairs from one `.fnt` line, after its first token.
 *
 * The value may be quoted AND contain spaces - `face="Century Gothic"` is the common case, and
 * splitting on whitespace first turns it into `face="Century` plus a stray `Gothic"`, which is
 * how a font ends up being called `"Century`.
 */
function readPairs(line) {
  const fields = {};
  const source = String(line).trim();
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|[^\s"]+)/g;
  let match = pattern.exec(source);
  while (match) {
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    fields[match[1]] = value;
    match = pattern.exec(source);
  }
  return fields;
}

const asInt = (value, fallback = 0) => {
  const number = Number.parseInt(value ?? '', 10);
  return Number.isFinite(number) ? number : fallback;
};

/**
 * Parse one `.fnt` descriptor.
 *
 * The format is AngleCode's BMFont TEXT form: an `info` line (face, size, padding, spacing), a
 * `common` line (lineHeight, base, scaleW, scaleH), then `char` records and optionally
 * `kerning` records. A few vanilla files omit the `chars count` / `kernings count` banner
 * lines, so the records themselves are authoritative and the banners are only cross-checked.
 *
 * @returns {object} metrics in PIXELS, ready to measure with
 */
export function parseBitmapFont(text, fileKey = '') {
  const metrics = {
    format: 'bmfont',
    file: fileKey,
    face: null,
    size: null,
    bold: false,
    italic: false,
    padding: [0, 0, 0, 0],
    spacing: [0, 0],
    lineHeight: null,
    base: null,
    scaleW: null,
    scaleH: null,
    pages: null,
    declaredChars: null,
    declaredKernings: null,
    glyphs: new Map(),
    kerning: new Map(),
    kerningRecords: 0,
    exact: true,
    exactness: METRIC_EXACTNESS.bitmap,
    notes: [],
  };

  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const keyword = line.trim().split(/\s+/, 1)[0];
    if (keyword === '') continue;
    if (keyword === 'info') {
      const fields = readPairs(line);
      metrics.face = fields.face ?? null;
      metrics.size = fields.size !== undefined ? asInt(fields.size) : null;
      metrics.bold = fields.bold === '1';
      metrics.italic = fields.italic === '1';
      if (fields.padding) {
        const parts = fields.padding.split(',').map((value) => asInt(value));
        if (parts.length === 4) metrics.padding = parts;
      }
      if (fields.spacing) {
        const parts = fields.spacing.split(',').map((value) => asInt(value));
        if (parts.length === 2) metrics.spacing = parts;
      }
    } else if (keyword === 'common') {
      const fields = readPairs(line);
      metrics.lineHeight = fields.lineHeight !== undefined ? asInt(fields.lineHeight) : null;
      metrics.base = fields.base !== undefined ? asInt(fields.base) : null;
      metrics.scaleW = fields.scaleW !== undefined ? asInt(fields.scaleW) : null;
      metrics.scaleH = fields.scaleH !== undefined ? asInt(fields.scaleH) : null;
      metrics.pages = fields.pages !== undefined ? asInt(fields.pages) : null;
    } else if (keyword === 'chars') {
      metrics.declaredChars = asInt(readPairs(line).count, null);
    } else if (keyword === 'kernings') {
      metrics.declaredKernings = asInt(readPairs(line).count, null);
    } else if (keyword === 'char') {
      const fields = readPairs(line);
      const id = asInt(fields.id, -1);
      if (id < 0) continue;
      metrics.glyphs.set(id, {
        id,
        x: asInt(fields.x),
        y: asInt(fields.y),
        width: asInt(fields.width),
        height: asInt(fields.height),
        xoffset: asInt(fields.xoffset),
        yoffset: asInt(fields.yoffset),
        xadvance: asInt(fields.xadvance),
        page: asInt(fields.page),
      });
    } else if (keyword === 'kerning') {
      const fields = readPairs(line);
      metrics.kerningRecords += 1;
      metrics.kerning.set(`${asInt(fields.first, -1)},${asInt(fields.second, -1)}`, asInt(fields.amount));
    }
  }

  if (metrics.lineHeight === null) {
    // `lineHeight` is what the engine uses to advance a wrapped line; without it the tallest
    // glyph is the best available answer, and the caller is told the number is derived.
    let tallest = 0;
    for (const glyph of metrics.glyphs.values()) tallest = Math.max(tallest, glyph.height);
    metrics.lineHeight = Math.max(1, tallest);
    metrics.notes.push('lineHeight missing from the .fnt; used the tallest glyph as the line height');
  }
  if (metrics.base === null) {
    metrics.base = metrics.lineHeight;
    metrics.notes.push('base missing from the .fnt; used the line height as the baseline');
  }
  if (metrics.declaredChars !== null && metrics.declaredChars !== metrics.glyphs.size) {
    metrics.notes.push(
      `the .fnt banner declares chars count=${metrics.declaredChars} but ${metrics.glyphs.size} char records are present`,
    );
  }
  if (metrics.declaredKernings !== null && metrics.declaredKernings !== metrics.kerningRecords) {
    metrics.notes.push(
      `the .fnt banner declares kernings count=${metrics.declaredKernings} but ${metrics.kerningRecords} kerning records are present`,
    );
  } else if (metrics.declaredKernings !== null && metrics.kerning.size !== metrics.kerningRecords) {
    metrics.notes.push(
      `the .fnt carries ${metrics.kerningRecords} kerning records for ${metrics.kerning.size} distinct pairs ` +
        '(the duplicates are identical, so the last one wins)',
    );
  }
  metrics.hasKerning = metrics.kerning.size > 0;
  // The font's own ink band, from the glyph records rather than from an assumption: `yoffset` is
  // the distance from the line's top to the glyph's top (the baseline sits at `base`), so
  // `yoffset + height` is the deepest ink below the line's top. A single-line element whose
  // `maxHeight` is smaller than this is NORMAL in vanilla (see the height model in wrapText).
  let inkBottom = 0;
  let inkTop = Infinity;
  for (const glyph of metrics.glyphs.values()) {
    if (glyph.width === 0 && glyph.height === 0) continue;
    inkBottom = Math.max(inkBottom, glyph.yoffset + glyph.height);
    inkTop = Math.min(inkTop, glyph.yoffset);
  }
  metrics.inkTop = Number.isFinite(inkTop) ? inkTop : 0;
  metrics.inkBottom = inkBottom;
  return metrics;
}

//====================================================================================
// 2. TrueType / OpenType (`hmtx` advances + `cmap`)
//====================================================================================

/** Read the sfnt table directory, following a TTC header to its first face. */
function readSfntTables(buffer) {
  const tag = buffer.toString('latin1', 0, 4);
  let base = 0;
  if (tag === 'ttcf') {
    const count = buffer.readUInt32BE(8);
    if (count < 1) throw new Error('ttcf with no faces');
    base = buffer.readUInt32BE(12);
  }
  const numTables = buffer.readUInt16BE(base + 4);
  const tables = new Map();
  for (let index = 0; index < numTables; index += 1) {
    const record = base + 12 + index * 16;
    tables.set(buffer.toString('latin1', record, record + 4), {
      offset: buffer.readUInt32BE(record + 8),
      length: buffer.readUInt32BE(record + 12),
    });
  }
  return tables;
}

/** A `cmap` subtable reduced to "code point -> glyph id". */
function readCmap(buffer, table) {
  const count = buffer.readUInt16BE(table.offset + 2);
  const encodings = [];
  for (let index = 0; index < count; index += 1) {
    const record = table.offset + 4 + index * 8;
    encodings.push({
      platform: buffer.readUInt16BE(record),
      encoding: buffer.readUInt16BE(record + 2),
      offset: table.offset + buffer.readUInt32BE(record + 4),
    });
  }
  const formatOf = (entry) => buffer.readUInt16BE(entry.offset);

  // Format 12 (segmented coverage) is the only one that reaches beyond the BMP, which is
  // exactly what Simplified Chinese needs, so it wins when present. Windows UCS-4 (3/10) and
  // Unicode full repertoire (0/4) both mean format 12 in practice.
  const best =
    encodings.find((entry) => formatOf(entry) === 12 && (entry.platform === 3 || entry.platform === 0)) ??
    encodings.find((entry) => formatOf(entry) === 12) ??
    encodings.find((entry) => formatOf(entry) === 4 && (entry.platform === 3 || entry.platform === 0)) ??
    encodings.find((entry) => formatOf(entry) === 4) ??
    encodings.find((entry) => formatOf(entry) === 6) ??
    encodings.find((entry) => formatOf(entry) === 0);
  if (!best) return null;
  const format = formatOf(best);
  const out = { format, at: best.offset };

  if (format === 12) {
    const groups = buffer.readUInt32BE(best.offset + 12);
    const start = best.offset + 16;
    out.groups = new Int32Array(groups * 3);
    for (let index = 0; index < groups; index += 1) {
      out.groups[index * 3] = buffer.readUInt32BE(start + index * 12);
      out.groups[index * 3 + 1] = buffer.readUInt32BE(start + index * 12 + 4);
      out.groups[index * 3 + 2] = buffer.readUInt32BE(start + index * 12 + 8);
    }
  } else if (format === 4) {
    const segments = buffer.readUInt16BE(best.offset + 6) / 2;
    const endAt = best.offset + 14;
    const startAt = endAt + segments * 2 + 2;
    const deltaAt = startAt + segments * 2;
    const rangeAt = deltaAt + segments * 2;
    out.segments = segments;
    out.end = new Uint16Array(segments);
    out.start = new Uint16Array(segments);
    out.delta = new Int16Array(segments);
    out.rangeOffset = new Uint16Array(segments);
    out.rangeBase = rangeAt;
    for (let index = 0; index < segments; index += 1) {
      out.end[index] = buffer.readUInt16BE(endAt + index * 2);
      out.start[index] = buffer.readUInt16BE(startAt + index * 2);
      out.delta[index] = buffer.readInt16BE(deltaAt + index * 2);
      out.rangeOffset[index] = buffer.readUInt16BE(rangeAt + index * 2);
    }
  } else if (format === 6) {
    const first = buffer.readUInt16BE(best.offset + 6);
    const entries = buffer.readUInt16BE(best.offset + 8);
    out.first = first;
    out.entries = entries;
    out.base = best.offset + 10;
  } else if (format === 0) {
    out.bytes = buffer.subarray(best.offset + 6, best.offset + 6 + 256);
  }
  return out;
}

/** Resolve one code point through a parsed `cmap`. */
export function cmapGlyph(buffer, cmap, codePoint) {
  if (!cmap) return null;
  if (cmap.format === 12) {
    const groups = cmap.groups;
    let low = 0;
    let high = groups.length / 3 - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const first = groups[mid * 3];
      const last = groups[mid * 3 + 1];
      if (codePoint < first) high = mid - 1;
      else if (codePoint > last) low = mid + 1;
      else return groups[mid * 3 + 2] + (codePoint - first);
    }
    return null;
  }
  if (cmap.format === 4) {
    if (codePoint > 0xffff) return null;
    let low = 0;
    let high = cmap.segments - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (codePoint > cmap.end[mid]) low = mid + 1;
      else if (codePoint < cmap.start[mid]) high = mid - 1;
      else {
        if (cmap.rangeOffset[mid] === 0) return (codePoint + cmap.delta[mid]) & 0xffff;
        const at = cmap.rangeBase + mid * 2 + cmap.rangeOffset[mid] + (codePoint - cmap.start[mid]) * 2;
        if (at + 1 >= buffer.length) return null;
        const glyph = buffer.readUInt16BE(at);
        return glyph === 0 ? null : (glyph + cmap.delta[mid]) & 0xffff;
      }
    }
    return null;
  }
  if (cmap.format === 6) {
    if (codePoint < cmap.first || codePoint >= cmap.first + cmap.entries) return null;
    const glyph = buffer.readUInt16BE(cmap.base + (codePoint - cmap.first) * 2);
    return glyph === 0 ? null : glyph;
  }
  if (cmap.format === 0) return codePoint < 256 ? cmap.bytes[codePoint] : null;
  return null;
}

/** The legacy `kern` table (format 0 subtables), which is the only kerning a tool can read simply. */
function readKernTable(buffer, table) {
  const pairs = new Map();
  if (!table) return pairs;
  const version = buffer.readUInt16BE(table.offset);
  if (version !== 0) return pairs; // Apple's extended `kern` is a different shape; not read here
  const subtableCount = buffer.readUInt16BE(table.offset + 2);
  let at = table.offset + 4;
  for (let index = 0; index < subtableCount; index += 1) {
    if (at + 6 > table.offset + table.length) break;
    const length = buffer.readUInt16BE(at + 2);
    const coverage = buffer.readUInt16BE(at + 4);
    const format = coverage >> 8;
    if (format === 0) {
      const pairCount = buffer.readUInt16BE(at + 6);
      for (let pair = 0; pair < pairCount; pair += 1) {
        const record = at + 14 + pair * 6;
        if (record + 6 > buffer.length) break;
        const left = buffer.readUInt16BE(record);
        const right = buffer.readUInt16BE(record + 2);
        pairs.set(`${left},${right}`, buffer.readInt16BE(record + 4));
      }
    }
    if (length < 6) break;
    at += length;
  }
  return pairs;
}

/**
 * Parse a TrueType/OpenType font into the metrics the `ttf_font`/`ttf_size` override needs.
 *
 * `hmtx` is authoritative for advances and is what a renderer uses, so advances are exact.
 * `lineHeight` is DERIVED: the engine computes it inside `pdx_font.cpp` and no formula is
 * published, so `(hhea.ascender - hhea.descender + hhea.lineGap)` - the same quantity FreeType
 * reports as `size->metrics.height` - is used and labelled as derived. The OS/2 typographic
 * and Windows metrics are kept next to it so a caller can see the spread.
 */
export function parseSfntFont(buffer, options = {}) {
  const file = options.file ?? '';
  const sizePx = Number.isFinite(options.size) ? options.size : 16;
  const tables = readSfntTables(buffer);
  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const hmtx = tables.get('hmtx');
  if (!head || !hhea || !hmtx) throw new Error(`${file}: missing head/hhea/hmtx`);

  const unitsPerEm = buffer.readUInt16BE(head.offset + 18);
  const ascender = buffer.readInt16BE(hhea.offset + 4);
  const descender = buffer.readInt16BE(hhea.offset + 6);
  const lineGap = buffer.readInt16BE(hhea.offset + 8);
  const numberOfHMetrics = buffer.readUInt16BE(hhea.offset + 34);
  const advanceCount = Math.floor(hmtx.length / 4);
  const advances = new Uint16Array(advanceCount);
  for (let index = 0; index < advanceCount; index += 1) {
    advances[index] = buffer.readUInt16BE(hmtx.offset + index * 4);
  }

  const os2 = tables.get('OS/2');
  const typo = os2
    ? {
        ascender: buffer.readInt16BE(os2.offset + 68),
        descender: buffer.readInt16BE(os2.offset + 70),
        lineGap: buffer.readInt16BE(os2.offset + 72),
        winAscent: buffer.readUInt16BE(os2.offset + 74),
        winDescent: buffer.readUInt16BE(os2.offset + 76),
      }
    : null;

  const scale = sizePx / unitsPerEm;
  const cmap = readCmap(buffer, tables.get('cmap') ?? { offset: 0, length: 0 });
  const kerning = readKernTable(buffer, tables.get('kern'));

  const metrics = {
    format: 'sfnt',
    file,
    face: null,
    size: sizePx,
    unitsPerEm,
    ascender,
    descender,
    lineGap,
    numberOfHMetrics,
    advances,
    cmap,
    kernPairs: kerning.size,
    hasKerning: kerning.size > 0,
    hasGpos: tables.has('GPOS'),
    exact: true,
    exactness: METRIC_EXACTNESS.sfnt,
    lineHeightDerived: true,
    notes: [],
  };
  metrics.lineHeight = Math.max(1, Math.ceil((ascender - descender + lineGap) * scale));
  metrics.base = Math.max(1, Math.ceil(ascender * scale));
  metrics.lineHeightAlternatives = {
    os2Typo: typo ? Math.max(1, Math.ceil((typo.ascender - typo.descender + typo.lineGap) * scale)) : null,
    os2Windows: typo ? Math.max(1, Math.ceil((typo.winAscent + typo.winDescent) * scale)) : null,
  };
  if (!cmap) metrics.notes.push('no usable cmap: no character can be mapped to a glyph');
  if (metrics.hasGpos && !metrics.hasKerning) {
    metrics.notes.push(
      'the font has a GPOS table and no legacy `kern` table, so kerning pairs are NOT applied; ' +
        'for CJK text this costs nothing (advances are uniform) and for Latin it is a sub-pixel-scale underestimate',
    );
  }
  metrics.glyphIdFor = (codePoint) => cmapGlyph(buffer, cmap, codePoint);
  metrics.advanceOfGlyph = (glyphId) =>
    glyphId === null || glyphId < 0
      ? null
      : (advances[Math.min(glyphId, numberOfHMetrics - 1)] ?? advances[advances.length - 1]) * scale;
  metrics.kerningOf = (left, right) => {
    if (kerning.size === 0) return 0;
    return (kerning.get(`${left},${right}`) ?? 0) * scale;
  };
  metrics.glyph = (codePoint) => {
    const glyphId = metrics.glyphIdFor(codePoint);
    if (glyphId === null) return null;
    const advance = metrics.advanceOfGlyph(glyphId);
    if (advance === null) return null;
    // No per-glyph ink box is read from a TrueType file (that would need `glyf`/CFF outlines), so
    // every glyph carries the font's own ascent/descent band from `hhea`, which is the right
    // answer for a wrapped block: the line box is what a renderer advances by.
    return {
      id: glyphId,
      advance,
      xoffset: 0,
      yoffset: 0,
      width: advance,
      height: metrics.lineHeight,
      inkTop: 0,
      inkBottom: metrics.lineHeight,
    };
  };
  return metrics;
}

//====================================================================================
// 3. Font definitions from `interface/**/*.gfx`
//====================================================================================

const FONT_BLOCK_KEYS = new Set([
  'bitmapfont',
  'bitmapfont_override',
  'bitmapfontoverride',
  'font',
  'bitmapfont_base',
]);

/**
 * A brace body, read with quoted strings and NUMERIC KEYS preserved.
 *
 * Two token shapes a naive `ident = value` reader gets wrong, both of them real in
 * `interface/fonts.gfx`:
 *   - `fontfiles = { "gfx/fonts/cg_16b" }` and `languages = { "l_russian" "l_polish" }` are
 *     QUOTED brace arrays. `parseTokens` in paradox.mjs skips every non-`ident` token, which is
 *     right for the `.gui` corpus (where a quoted string is always the right-hand side of `=`)
 *     but loses these arrays - and `languages` is load-bearing: without it every
 *     `bitmapfont_override` matches every language, so `cg_16b` under `l_english` resolves to
 *     the Korean TTF override (interface/fonts.gfx:218) instead of its bitmap font
 *     (interface/fonts.gfx:168).
 *   - `0 = { 31 224 202 }` is a NUMERIC key (`textcolors`, interface/fonts.gfx:42-45). A reader
 *     that assumes keys are idents swallows the digits as array elements and then the block's
 *     own `}` closes the ENCLOSING block, which silently truncated the whole font table to its
 *     first block.
 * So a token starts a key when the next token is `=` or `{`, whatever the token's kind.
 *
 * A node is `{ key, line, value, children, items }`: `value` for `k = v`, `children` for the
 * keyed entries of a brace body, `items` for its unkeyed scalars (an array).
 */
function readBraceBody(tokens, state) {
  const node = { children: [], items: [] };
  while (state.index < tokens.length) {
    const token = tokens[state.index];
    if (token.kind === 'close') {
      state.index += 1;
      return node;
    }
    if (token.kind !== 'ident' && token.kind !== 'string' && token.kind !== 'number') {
      state.index += 1;
      continue;
    }
    const next = tokens[state.index + 1];
    if (!next || (next.kind !== 'equals' && next.kind !== 'open')) {
      node.items.push(token.value);
      state.index += 1;
      continue;
    }
    const key = token.value;
    const line = token.line;
    state.index += 1;
    const separator = tokens[state.index];
    if (separator.kind === 'open') {
      state.index += 1;
      const body = readBraceBody(tokens, state);
      node.children.push({ key, line, value: null, children: body.children, items: body.items });
      continue;
    }
    state.index += 1; // the `=`
    const valueToken = tokens[state.index];
    if (!valueToken) {
      node.children.push({ key, line, value: null, children: [], items: [] });
      continue;
    }
    if (valueToken.kind === 'open') {
      state.index += 1;
      const body = readBraceBody(tokens, state);
      node.children.push({ key, line, value: null, children: body.children, items: body.items });
      continue;
    }
    state.index += 1;
    node.children.push({ key, line, value: valueToken.value, children: null, items: null });
  }
  return node;
}

/** Top-level entries of a Paradox file, with quoted brace arrays preserved. */
export function readBraceNodes(text) {
  const { tokens } = tokenize(text);
  const state = { index: 0 };
  return readBraceBody(tokens, state).children;
}

/** First keyed child of `node`, case-insensitively. */
function keyed(node, key) {
  const wanted = String(key).toLowerCase();
  return (node?.children ?? []).find((child) => child.key && child.key.toLowerCase() === wanted) ?? null;
}

/** A scalar value of a keyed child, or `undefined`. */
function scalarOf(node, key) {
  const child = keyed(node, key);
  if (!child) return undefined;
  if (child.value !== null && child.value !== undefined) return child.value;
  // `languages = { l_english }` written unquoted: the array items are the values.
  if (child.items && child.items.length === 1) return child.items[0];
  return undefined;
}

/**
 * The values of a brace array (`fontfiles`, `languages`, `line_break`, `forbidden_start`).
 *
 * Both spellings are covered: `{ "a" "b" }` (items) and `{ a b }` (items after the bare-ident
 * rule) and `{ a = 1 b = 2 }` (keyed children, used by a few mods).
 */
function arrayOf(node, key) {
  const child = keyed(node, key);
  if (!child) return [];
  const out = [...(child.items ?? [])];
  for (const entry of child.children ?? []) {
    if (entry.value !== null && entry.value !== undefined) out.push(entry.value);
    else if (entry.key) out.push(entry.key);
  }
  return out.map((value) => String(value));
}

/** Read the fields of one `bitmapfont` / `bitmapfont_override` / `font` block. */
function readFontBlock(block, fileKey, kind) {
  const record = {
    name: null,
    kind,
    file: fileKey,
    line: block.line,
    path: null,
    fontfiles: [],
    ttfFont: null,
    ttfSize: null,
    languages: [],
    multiline: null,
    verticalOffset: 0,
    lineHeightOverride: null,
  };
  record.name = scalarOf(block, 'name') ?? null;
  if (record.name === null) return null;
  record.path = scalarOf(block, 'path') ?? null;
  record.fontfiles = arrayOf(block, 'fontfiles');
  record.ttfFont = scalarOf(block, 'ttf_font') ?? null;
  record.ttfSize = scalarOf(block, 'ttf_size') ?? null;
  record.languages = arrayOf(block, 'languages');
  record.verticalOffset = Number(scalarOf(block, 'vertical_offset') ?? 0) || 0;
  record.lineHeightOverride = scalarOf(block, 'lineheight_override') ?? null;

  const multilineEntry = keyed(block, 'multiline');
  if (multilineEntry) {
    record.multiline = {
      lineBreak: arrayOf(multilineEntry, 'line_break'),
      forbiddenStart: arrayOf(multilineEntry, 'forbidden_start'),
    };
  }
  return record;
}

/** Every font definition in one `.gfx` file, in file order. */
export function parseFontDefinitions(gfxText, fileKey = '') {
  const roots = readBraceNodes(gfxText);
  const definitions = [];
  const visit = (block, depth) => {
    if (block.key && block.children) {
      const lowered = block.key.toLowerCase();
      if (FONT_BLOCK_KEYS.has(lowered)) {
        const record = readFontBlock(block, fileKey, lowered);
        if (record) definitions.push(record);
        return;
      }
    }
    if (depth >= 4) return;
    for (const child of block.children ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return definitions;
}

/**
 * Build the catalogue of font definitions an install (and any extra roots) declares.
 *
 * The engine's own rule is applied on lookup: a `bitmapfont` block is the DEFAULT for a name
 * and a `bitmapfont_override` whose `languages` contains `l_<language>` replaces it for that
 * language only. That is exactly how `cg_16b` becomes a 14px `NotoSansCJKsc-Regular` under
 * `l_simp_chinese` while staying a 16px bitmap font under `l_english`
 * (interface/fonts.gfx:187-224).
 */
export function buildFontCatalogue(options = {}) {
  const roots = [options.installRoot, ...(options.roots ?? [])].filter(Boolean);
  const files = [];
  const definitions = [];
  for (const root of roots) {
    for (const file of listFilesRecursive(join(root, 'interface'), ['.gfx'])) {
      let text;
      try {
        text = readTextFile(file);
      } catch {
        continue;
      }
      if (!/bitmapfont/i.test(text)) continue;
      const key = file.slice(root.length + 1).split('\\').join('/');
      const found = parseFontDefinitions(text, key);
      if (found.length === 0) continue;
      files.push({ root, key, definitions: found.length, textColors: [...parseTextColors(text)] });
      for (const record of found) definitions.push({ ...record, root });
    }
  }
  const byName = new Map();
  for (const record of definitions) {
    if (!byName.has(record.name)) byName.set(record.name, { name: record.name, base: null, overrides: [] });
    const entry = byName.get(record.name);
    if (record.kind === 'bitmapfont_override' || record.kind === 'bitmapfontoverride') entry.overrides.push(record);
    else if (!entry.base) entry.base = record;
    else entry.overrides.push(record); // a repeated plain block acts as a later definition
  }
  return { roots, files, definitions, byName, textColors: readTextColors(files) };
}

/**
 * The install's own textcolour codes, from every `textcolors = { .. }` block.
 *
 * `interface/fonts.gfx:9-46` declares `M`, `L`, `G`, ..., `W`, `t`, `_` and the numeric
 * `0`-`3`. A localisation value quoting a single-letter token (`"$t$"`, which vanilla's
 * `TABBED_NEW_LINE: "\n$t$"` does at `federations_l_english.yml:33`) is a colour change, not a
 * key: it must measure as zero pixels. Read out of the install rather than hard-coded, so a mod
 * that introduces a colour gets the same treatment.
 */
export function parseTextColors(gfxText) {
  const codes = new Set();
  const visit = (block, depth) => {
    if (block.key && block.key.toLowerCase() === 'textcolors' && block.children) {
      for (const child of block.children) {
        if (!child.key) {
          // `textcolors = { M L G }` written without values: the bare idents are the codes.
          for (const item of child.items ?? []) codes.add(String(item));
          continue;
        }
        codes.add(String(child.key));
      }
      if (block.items) for (const item of block.items) codes.add(String(item));
      return;
    }
    if (depth >= 4) return;
    for (const child of block.children ?? []) visit(child, depth + 1);
  };
  for (const root of readBraceNodes(gfxText)) visit(root, 0);
  return codes;
}

/** Collect the colour codes of every font `.gfx` a catalogue was built from. */
function readTextColors(files) {
  const codes = new Set();
  for (const file of files) {
    for (const code of file.textColors ?? []) codes.add(code);
  }
  return codes;
}

/**
 * Which descriptor a `font = "<name>"` resolves to for one language.
 *
 * Returns `{ kind: 'bitmap', files: [...] }`, `{ kind: 'ttf', ttfFont, ttfSize }` or
 * `{ kind: 'none' }`. A `bitmapfont_override` with no `languages` applies to every language.
 */
export function resolveFontSource(catalogue, name, language = 'english') {
  const entry = catalogue?.byName?.get(name) ?? null;
  const tag = `l_${language}`;
  if (!entry) return { name, language, kind: 'none', reason: `no bitmapfont declares the name "${name}"` };
  const matching = entry.overrides.filter(
    (override) => override.languages.length === 0 || override.languages.includes(tag),
  );
  // Later definitions win, which is how a DLC or a mod overrides the base font.
  const override = matching.length > 0 ? matching[matching.length - 1] : null;
  const source = override ?? entry.base;
  if (!source) {
    return { name, language, kind: 'none', reason: `"${name}" has overrides but no default block` };
  }
  const files = source.fontfiles.length > 0 ? source.fontfiles : source.path ? [source.path] : [];
  const multiline = override?.multiline ?? entry.base?.multiline ?? null;
  const verticalOffset = override?.verticalOffset ?? entry.base?.verticalOffset ?? 0;
  if (source.ttfFont) {
    return {
      name,
      language,
      kind: 'ttf',
      ttfFont: source.ttfFont,
      ttfSize: Number(source.ttfSize) || 16,
      definition: source,
      override,
      base: entry.base,
      multiline,
      verticalOffset,
      reason: null,
    };
  }
  if (files.length > 0) {
    return {
      name,
      language,
      kind: 'bitmap',
      files,
      definition: source,
      override,
      base: entry.base,
      multiline,
      verticalOffset,
      reason: null,
    };
  }
  return {
    name,
    language,
    kind: 'none',
    definition: source,
    override,
    base: entry.base,
    multiline,
    verticalOffset,
    reason: `"${name}" declares neither fontfiles/path nor ttf_font`,
  };
}

//====================================================================================
// 4. The loaded font library
//====================================================================================

/** Candidate on-disk paths for one `fontfiles`/`path` entry, which vanilla writes without `.fnt`. */
function candidateFntPaths(root, entry) {
  const cleaned = String(entry).replace(/\\/g, '/').replace(/^\/+/, '');
  const bases = [cleaned];
  if (!/\.fnt$/i.test(cleaned)) bases.push(`${cleaned}.fnt`);
  const out = [];
  for (const base of bases) out.push(join(root, ...base.split('/')));
  return out;
}

/**
 * `ttf_font = "Chinese_normal"` names a `font = { name = .. fontstyle = { file = .. } }` block in
 * `fonts/fonts.asset` (which has no wrapper: every `font = { ... }` is a top-level entry).
 */
function readFontAsset(root) {
  const path = join(root, 'fonts', 'fonts.asset');
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const block of readBraceNodes(readTextFile(path))) {
    if (!block.key || block.key.toLowerCase() !== 'font') continue;
    const name = scalarOf(block, 'name');
    if (!name) continue;
    const style = keyed(block, 'fontstyle') ?? block;
    const file = scalarOf(style, 'file');
    if (file) map.set(String(name), String(file));
  }
  return map;
}

/**
 * Load fonts on demand and cache them.
 *
 * A 16 MB CJK `.otf` is read once per process, never per element, and the metrics come back
 * as callables so a per-glyph lookup does not walk a table again.
 */
export function createFontLibrary(options = {}) {
  const installRoot = options.installRoot ?? null;
  const language = options.language ?? 'english';
  const catalogue = options.catalogue ?? buildFontCatalogue({ installRoot, roots: options.roots ?? [] });
  const fontAssets = installRoot ? readFontAsset(installRoot) : new Map();
  const cache = new Map();
  const stats = { loaded: 0, bitmap: 0, sfnt: 0, failed: 0, missingFiles: [] };

  const loadBitmap = (source) => {
    const list = [];
    const kerning = new Map();
    let first = null;
    for (const entry of source.files) {
      let found = null;
      for (const candidate of candidateFntPaths(source.root ?? installRoot ?? '', entry)) {
        if (existsSync(candidate)) {
          found = candidate;
          break;
        }
      }
      if (!found && source.root) {
        for (const candidate of candidateFntPaths(installRoot ?? '', entry)) {
          if (existsSync(candidate)) {
            found = candidate;
            break;
          }
        }
      }
      if (!found) {
        stats.missingFiles.push(entry);
        continue;
      }
      const key = found.replace(/\\/g, '/');
      const metrics = parseBitmapFont(readTextFile(found), key);
      list.push(metrics);
      for (const [pair, amount] of metrics.kerning) kerning.set(pair, amount);
      if (!first) first = metrics;
    }
    if (!first) return null;
    // A bitmapfont may list several files whose glyphs are combined. The engine refuses to mix
    // files with different `base`/`lineHeight` ("base (%d) in '%s' does not match previous
    // fontfiles in font '%s'", stellaris.exe), so the first file's values are the font's.
    const combined = {
      format: 'bitmap',
      file: list.map((entry) => entry.file).join(' + '),
      files: list.map((entry) => entry.file),
      face: first.face,
      size: first.size,
      lineHeight: first.lineHeight,
      base: first.base,
      scaleW: first.scaleW,
      scaleH: first.scaleH,
      padding: first.padding,
      spacing: first.spacing,
      exact: true,
      exactness: METRIC_EXACTNESS.bitmap,
      lineHeightDerived: false,
      hasKerning: kerning.size > 0,
      kernPairs: kerning.size,
      notes: list.flatMap((entry) => entry.notes),
      glyph: (codePoint) => {
        for (const metrics of list) {
          const glyph = metrics.glyphs.get(codePoint);
          if (!glyph) continue;
          // Normalised shape shared with the sfnt path: `advance` is the number every caller
          // wants, `id` is the KEY the kerning table uses (a code point here - BMFont keys
          // `kerning first=/second=` by character, not by glyph index - and a glyph id there),
          // and `inkTop`/`inkBottom` are the glyph's vertical ink relative to the line's top.
          return {
            id: codePoint,
            advance: glyph.xadvance,
            xoffset: glyph.xoffset,
            yoffset: glyph.yoffset,
            width: glyph.width,
            height: glyph.height,
            inkTop: glyph.yoffset,
            inkBottom: glyph.yoffset + glyph.height,
          };
        }
        return null;
      },
      kerningOf: (left, right) => kerning.get(`${left},${right}`) ?? 0,
    };
    if (list.length > 1) {
      combined.notes.push(`this bitmapfont combines ${list.length} .fnt files`);
    }
    return combined;
  };

  const loadSfnt = (source) => {
    const file = fontAssets.get(source.ttfFont);
    if (!file) {
      stats.missingFiles.push(`fonts.asset: ${source.ttfFont}`);
      return null;
    }
    const absolute = join(source.root ?? installRoot ?? '', ...String(file).replace(/\\/g, '/').split('/'));
    if (!existsSync(absolute)) {
      stats.missingFiles.push(file);
      return null;
    }
    const metrics = parseSfntFont(readFileSync(absolute), {
      size: source.ttfSize,
      file: file,
    });
    metrics.face = source.ttfFont;
    return metrics;
  };

  /** The loaded metrics for `name` in this library's language, or null. */
  const font = (name) => {
    const key = `${name}|${language}`;
    if (cache.has(key)) return cache.get(key);
    const source = resolveFontSource(catalogue, name, language);
    let metrics = null;
    try {
      if (source.kind === 'bitmap') metrics = loadBitmap(source);
      else if (source.kind === 'ttf') metrics = loadSfnt(source);
    } catch (error) {
      metrics = null;
      stats.failed += 1;
      source.error = error.message;
    }
    const resolved = { ...source, metrics };
    if (metrics) {
      stats.loaded += 1;
      if (metrics.format === 'bitmap') stats.bitmap += 1;
      else stats.sfnt += 1;
      resolved.exact = metrics.exact;
    }
    cache.set(key, resolved);
    return resolved;
  };

  return {
    language,
    catalogue,
    font,
    fontAssets,
    stats,
    textColors: catalogue.textColors ?? new Set(),
    describes: () => ({
      version: FONT_METRICS_VERSION,
      language,
      catalogueFiles: catalogue.files.length,
      definitions: catalogue.definitions.length,
      loaded: stats.loaded,
      bitmapFonts: stats.bitmap,
      sfntFonts: stats.sfnt,
      failed: stats.failed,
      missingFiles: [...new Set(stats.missingFiles)].slice(0, 20),
    }),
  };
}

//====================================================================================
// 5. Text: markup, nested localisation tokens, wrap units
//====================================================================================

/**
 * Vanilla localisation keys whose VALUE is a break or an indent, measured from the install
 * rather than assumed: `localisation/english/federations_l_english.yml:33` is
 * `TABBED_NEW_LINE: "\n$t$"` and `:34` is `NEW_LINE: "\n"` (`$t$` is the light-grey textcolor
 * declared at `interface/fonts.gfx:21`, so it contributes no width). They are used as a
 * fallback when the caller has not indexed localisation values.
 */
export const KNOWN_BREAK_KEYS = new Map([
  ['NEW_LINE', '\n'],
  ['TABBED_NEW_LINE', '\n$t$'],
]);

/**
 * Unescape the sequences a `.yml` value may carry.
 *
 * `\n` is a REAL newline by the time the engine sees the string, and this is not a guess:
 * `localisation/english/federations_l_english.yml:34` DEFINES `NEW_LINE: "\n"`, i.e. the key
 * whose whole purpose is to produce a break has the two characters `\` `n` as its source text,
 * so the parser must be turning them into one. Vanilla relies on it directly in 34,289 places
 * across 108 english files, and this mod relies on it 37 times in each language
 * (`zz_geocentric_unga_l_english.yml:211` is one `unga_news_wire` value with EIGHT of them).
 * Modelling them as literal glyphs would have measured `\` and `n` as ink and merged eight
 * paragraphs into one run-on line.
 */
/**
 * Escape a literal for use inside a `RegExp` source string.
 *
 * Used to ask "does this exact token appear wrapped in a bracket call" (GAP-5). A token name is a
 * `defined_text` name from a hand-written `.txt` file, so it may carry `.` or `-`
 * (`GetUngaAttUnNato`, `unga.d_un`) and must not be read as a pattern.
 */
function escapeForRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function unescapeLocalisation(value) {
  return String(value ?? '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

/**
 * Expand `$KEY$` nested localisation references and `$c$` colour codes.
 *
 * `$NEW_LINE$` is not a special engine token - it is an ordinary nested key that expands to a
 * literal newline (see `KNOWN_BREAK_KEYS`), which is why the mod's 30 uses of it have to force
 * a break in the model rather than be measured as eleven glyphs of `NEW_LINE`.
 *
 * A SINGLE-character token that is one of the install's own `textcolors` (`$t$`, `$W$`, `$R$` -
 * read out of `interface/fonts.gfx:9-46`) is a colour code: it changes the colour of what
 * follows and advances no pixels, so it must not be charged as three glyphs.
 *
 * Anything else that cannot be expanded (`$HOMEWORLD$`, `$pc_geocentric_earth$` - runtime
 * scopes) is left in place and REPORTED, because its rendered width is genuinely unknown.
 */
export function expandLocalisation(value, options = {}) {
  const values = options.values ?? null;
  const colorCodes = options.colorCodes ?? null;
  const depth = options.depth ?? 0;
  const maxDepth = options.maxDepth ?? 4;
  const unresolved = new Set();
  if (depth > maxDepth) return { text: String(value ?? ''), unresolved, substituted: false };
  let substituted = false;
  const text = String(value ?? '').replace(/\$([A-Za-z0-9_.\-]+)\$/g, (whole, key) => {
    if (values?.has?.(key)) {
      const inner = expandLocalisation(values.get(key), { values, colorCodes, depth: depth + 1, maxDepth });
      for (const name of inner.unresolved) unresolved.add(name);
      substituted = true;
      return inner.text;
    }
    if (KNOWN_BREAK_KEYS.has(key)) {
      substituted = true;
      return KNOWN_BREAK_KEYS.get(key);
    }
    if (key.length === 1 && colorCodes?.has?.(key)) {
      substituted = true;
      return '';
    }
    unresolved.add(key);
    return whole;
  });
  // Unescaping happens after substitution so a nested value's escapes are handled too, and on
  // every level so `$NEW_LINE$` inside a nested key still yields one break.
  return { text: unescapeLocalisation(text), unresolved, substituted };
}

/**
 * Split a localisation string into zero-width markup and visible text.
 *
 * `§X` is a one-glyph colour code (any character may follow, including another `§`), `£name£`
 * is an inline icon sprite whose width only the asset index knows, and a literal `\n` (which is
 * what `$NEW_LINE$` expands to inside the `.yml` value) is a forced break.
 */
export function splitMarkup(value, options = {}) {
  const iconWidth = options.iconWidth ?? null;
  const source = String(value ?? '');
  const clean = [];
  const icons = [];
  const colourCodes = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '§') {
      colourCodes.push(source[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (char === '£') {
      const end = source.indexOf('£', index + 1);
      if (end > index) {
        const name = source.slice(index + 1, end);
        icons.push(name);
        const width = iconWidth ? iconWidth(name) : null;
        if (width !== null && width !== undefined) clean.push({ kind: 'icon', name, width: Number(width) });
        index = end;
        continue;
      }
    }
    clean.push({ kind: 'char', char });
  }
  return { parts: clean, icons, colourCodes, iconWidthsKnown: icons.every((name) => Boolean(iconWidth?.(name))) };
}

// ------------------------------------------------------------------ character classes

const CJK_RANGES = [
  [0x1100, 0x11ff], [0x2e80, 0x2eff], [0x2f00, 0x2fdf], [0x3000, 0x303f], [0x3040, 0x309f],
  [0x30a0, 0x30ff], [0x3100, 0x312f], [0x3130, 0x318f], [0x31a0, 0x31bf], [0x3200, 0x32ff],
  [0x3300, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa960, 0xa97f], [0xac00, 0xd7af],
  [0xf900, 0xfaff], [0xfe10, 0xfe1f], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f200, 0x1f2ff], [0x20000, 0x2fa1f],
];

/**
 * Is this code point written without spaces?
 *
 * Chinese and Japanese text has no inter-word spaces, so the engine wraps it per character;
 * a wrap model that only knows spaces misjudges every Chinese block in this mod.
 */
export function isCjk(codePoint) {
  for (const [low, high] of CJK_RANGES) {
    if (codePoint >= low && codePoint <= high) return true;
  }
  return false;
}

/** Characters after which a break is always allowed even inside a run of non-space text. */
const BREAK_AFTER = new Set(['-', '\u2010', '\u2013', '\u2014', '/', '\u3001', '\u3002', '\uff0c', '\uff01', '\uff1f', '\uff09']);

/**
 * Build the wrap units for one paragraph.
 *
 * Each unit is one rendered char (or one inline icon) and records whether a line may break
 * AFTER it. Break opportunities, in the engine's terms:
 *   - after a space (the space itself never counts toward the line width, and is dropped at a break)
 *   - between two CJK characters
 *   - NOT before a character the font's own `multiline.forbidden_start` list names
 *     (`fonts.gfx:88` `forbidden_start = { "，" }` for Chinese, `:92` `line_break = { "。" "）" ... }`)
 *   - after a hyphen or solidus, and after the characters in the font's `line_break` list
 * One word (a maximal run of Latin non-space characters with no break inside) wider than the
 * available width is modelled as OVERFLOWING the line rather than being broken mid-word, which
 * is an assumption: the engine has no hyphenation dictionary, and the alternative would invent
 * break points inside identifiers and file names. It is reported as `wordOverflow`.
 */
export function wrapUnits(metrics, parts, options = {}) {
  const forbiddenStart = new Set((options.forbiddenStart ?? []).map((value) => String(value)));
  const lineBreakAfter = new Set((options.lineBreakAfter ?? []).map((value) => String(value)));
  const units = [];
  for (const part of parts) {
    if (part.kind === 'icon') {
      units.push({ text: `£${part.name}£`, width: part.width, space: false, breakAfter: true, cjk: false, icon: true });
      continue;
    }
    const char = part.char;
    if (char === '\n') {
      units.push({ text: '\n', width: 0, space: false, breakAfter: true, cjk: false, forcedBreak: true });
      continue;
    }
    const codePoint = char.codePointAt(0);
    const glyph = metrics.glyph(codePoint);
    const cjk = isCjk(codePoint);
    const space = char === ' ' || char === '\t';
    units.push({
      text: char,
      width: glyph ? glyph.advance : null,
      glyph,
      space,
      cjk,
      breakAfter: space || cjk || BREAK_AFTER.has(char) || lineBreakAfter.has(char),
      noBreakBefore: forbiddenStart.has(char),
    });
  }
  // Kerning: the pair adjustment between consecutive drawn chars, as an extra unit.
  for (let index = 1; index < units.length; index += 1) {
    const left = units[index - 1];
    const right = units[index];
    if (!left.glyph || !right.glyph || left.space || right.space) continue;
    const kern = metrics.kerningOf
      ? metrics.kerningOf(left.glyph.id ?? left.glyph.glyphId, right.glyph.id ?? right.glyph.glyphId)
      : 0;
    if (kern) right.kern = kern;
  }
  return units;
}

/** Width of one unit including the kerning that lands on it. */
const unitWidth = (unit) => (unit.width ?? 0) + (unit.kern ?? 0);

//====================================================================================
// 6. Measuring and wrapping
//====================================================================================

/**
 * Measure one already-markup-free line.
 *
 * Leading and trailing SPACES are collapsed: they are break opportunities in the engine's
 * terms, not ink, so charging for them would report overflow for a line that ends in a space.
 * Interior spaces do advance the cursor and are counted.
 *
 * A code point the font has no glyph for makes the result inexact rather than silently wrong:
 * the missing characters are listed and the font's own average advance is charged for them, so
 * the caller can see both the number and the fact that it is an estimate for those chars.
 */
function measureParagraph(metrics, units, options) {
  let start = 0;
  let end = units.length;
  while (start < end && units[start].space) start += 1;
  while (end > start && units[end - 1].space) end -= 1;
  const kept = units.slice(start, end);
  const missing = [];
  let width = 0;
  let estimatedFallback = 0;
  const averageAdvance = options.averageAdvance ?? metrics.size ?? metrics.lineHeight ?? 16;
  for (const unit of kept) {
    if (unit.forcedBreak) continue;
    if (unit.width === null || unit.width === undefined) {
      missing.push(unit.text);
      width += averageAdvance * FALLBACK_ADVANCE_EM;
      estimatedFallback += 1;
      continue;
    }
    width += unitWidth(unit);
  }
  return { width, missing, estimatedFallback, kept };
}

/** Split units into paragraphs at forced breaks. */
function paragraphsOf(units) {
  const paragraphs = [[]];
  for (const unit of units) {
    if (unit.forcedBreak) paragraphs.push([]);
    else paragraphs[paragraphs.length - 1].push(unit);
  }
  return paragraphs;
}

/**
 * Wrap a string and report the drawn extent.
 *
 * Greedy line breaking, which is what a game UI does: extend the line while it fits, then break
 * at the last legal opportunity. Heights are `lineCount * lineHeight`; `lineHeight` comes from
 * the `.fnt`'s own `common lineHeight=` for bitmap fonts (exact) and from the derived hhea
 * metric for TTF fonts.
 *
 * @param {object} metrics a loaded font
 * @param {string} text the resolved, markup-free string
 * @param {{maxWidth?: number, multiline?: boolean, wrap?: boolean, forbiddenStart?: string[],
 *          lineBreakAfter?: string[], iconWidth?: Function, averageAdvance?: number}} options
 */
export function wrapText(metrics, text, options = {}) {
  const markup = splitMarkup(text, { iconWidth: options.iconWidth });
  const units = wrapUnits(metrics, markup.parts, options);
  const maxWidth = Number.isFinite(options.maxWidth) && options.maxWidth > 0 ? options.maxWidth : null;
  const wrapping = maxWidth !== null && options.wrap !== false;

  const lines = [];
  const missing = [];
  const wordOverflow = [];
  let estimatedFallback = 0;

  for (const paragraph of paragraphsOf(units)) {
    if (paragraph.length === 0) {
      lines.push({ text: '', width: 0, units: [] });
      continue;
    }
    if (!wrapping) {
      const measured = measureParagraph(metrics, paragraph, options);
      missing.push(...measured.missing);
      estimatedFallback += measured.estimatedFallback;
      lines.push({ text: measured.kept.map((unit) => unit.text).join(''), width: measured.width, units: measured.kept });
      continue;
    }

    // Split the paragraph into CHUNKS: maximal runs of units with no legal break inside them.
    // A Latin word is one chunk, each CJK character is its own chunk, a space is its own chunk.
    // Wrapping whole chunks is what keeps a word from being split mid-word: an earlier revision
    // flushed the line as soon as it overflowed, which cut
    // `Supercalifragilisticexpialidocious` into `Super` / `califra` / `gilistic` - break points
    // the engine does not have.
    const chunks = [];
    let run = [];
    for (const unit of paragraph) {
      if (unit.space) {
        if (run.length > 0) chunks.push(run);
        run = [];
        chunks.push([unit]);
        continue;
      }
      if (run.length > 0) {
        const previous = run[run.length - 1];
        if (previous.breakAfter && !unit.noBreakBefore) {
          chunks.push(run);
          run = [unit];
          continue;
        }
      }
      run.push(unit);
    }
    if (run.length > 0) chunks.push(run);

    const chunkWidth = (chunk) => chunk.reduce((total, unit) => total + unitWidth(unit), 0);
    let line = [];
    let lineWidth = 0;
    let trailingSpaces = 0;
    const flush = () => {
      const measured = measureParagraph(metrics, line, options);
      missing.push(...measured.missing);
      estimatedFallback += measured.estimatedFallback;
      if (measured.kept.length > 0 || lines.length === 0) {
        lines.push({ text: measured.kept.map((unit) => unit.text).join(''), width: measured.width, units: measured.kept });
      }
      line = [];
      lineWidth = 0;
      trailingSpaces = 0;
    };
    for (const chunk of chunks) {
      const width = chunkWidth(chunk);
      const isSpace = chunk.every((unit) => unit.space);
      const trimmed = lineWidth - trailingSpaces;
      // The prospective width of the line if this chunk joins it. When the line already holds ink
      // its trailing spaces become INTERIOR - they are part of the gap before this chunk - so the
      // full `lineWidth` counts. When the line holds only spaces (or nothing) they would be
      // trimmed, so the chunk's own width is the whole answer. Getting this wrong let a line run
      // past `maxWidth` by exactly the width of the space before the last word.
      const prospective = (trimmed > 0 ? lineWidth : 0) + width;
      if (!isSpace && prospective > maxWidth && trimmed > 0) {
        flush();
        if (width > maxWidth) wordOverflow.push(chunk.map((unit) => unit.text).join(''));
      } else if (!isSpace && prospective > maxWidth && width > maxWidth) {
        // Nowhere better to put it: the line is empty and the chunk alone does not fit, so it
        // stays and overflows. This is the only case where a line may exceed `maxWidth`.
        wordOverflow.push(chunk.map((unit) => unit.text).join(''));
      }
      line.push(...chunk);
      lineWidth += width;
      trailingSpaces = isSpace ? trailingSpaces + width : 0;
    }
    if (line.length > 0) flush();
    if (lines.length === 0) lines.push({ text: '', width: 0, units: [] });
  }

  if (lines.length === 0) lines.push({ text: '', width: 0, units: [] });
  const width = lines.reduce((max, line) => Math.max(max, line.width), 0);
  const lineHeight = metrics.lineHeight ?? 16;
  const base = metrics.base ?? lineHeight;

  // ------------------------------------------------------------------ the height model
  //
  // Two heights, because the engine uses two:
  //
  //  * `budgetHeight` is what `maxHeight` is compared against. Measured, not assumed: over 839
  //    vanilla text elements that have both `maxWidth` and `maxHeight` and a resolvable string,
  //    `(n-1) * lineHeight + base` fits the declared budget for 94.2% of them, while the naive
  //    `n * lineHeight` fits only 71.0%. The gap is real and visible in the content: 20.2% of
  //    vanilla's single-line text elements declare `maxHeight` exactly equal to the font's own
  //    `base` (for `malgun_goth_24` that is 20px, not 24px) and 28.7% declare less than one
  //    `lineHeight`. The engine's budget is the ASCENT band of each line, and the descent of the
  //    last line overhangs it - which is why Paradox UI text so often looks cramped.
  //
  //  * `height` is the INK the glyphs actually cover, taken per glyph from the descriptor's own
  //    `yoffset`/`height` (`inkTop`/`inkBottom`). This is what can land on the row below and
  //    therefore what a collision test must use; a 16px `cg_16b` line is 16px of ink even when
  //    the element's `maxHeight` is 13.
  //
  // So an element is reported as overflowing vertically only when the ASCENT BAND does not fit,
  // and its drawn rect is the full ink. Reporting ink-vs-maxHeight instead would flag 806 of the
  // 839 vanilla elements, i.e. essentially all of them, which is a rule nobody would read.
  let inkTop = Infinity;
  let inkBottom = 0;
  let sawInk = false;
  for (const unit of units) {
    if (!unit.glyph) continue;
    inkTop = Math.min(inkTop, unit.glyph.inkTop ?? 0);
    inkBottom = Math.max(inkBottom, unit.glyph.inkBottom ?? metrics.inkBottom ?? lineHeight);
    sawInk = true;
  }
  if (!sawInk) {
    inkTop = metrics.inkTop ?? 0;
    inkBottom = metrics.inkBottom ?? lineHeight;
  }
  const inkSpan = Math.max(1, inkBottom - inkTop);
  const inkHeight = (lines.length - 1) * lineHeight + inkSpan;
  const budgetHeight = (lines.length - 1) * lineHeight + base;

  return {
    lines: lines.map((line) => ({ text: line.text, width: Math.round(line.width) })),
    lineCount: lines.length,
    width: Math.round(width),
    height: Math.round(inkHeight),
    budgetHeight: Math.round(budgetHeight),
    inkTop: Math.round(inkTop),
    inkBottom: Math.round(inkBottom),
    lineHeight,
    base,
    wrapped: lines.length > 1,
    wordOverflow,
    missing: [...new Set(missing)],
    icons: markup.icons,
    colourCodes: markup.colourCodes.length,
    estimatedFallback,
    units,
    parsed: markup,
  };
}

//====================================================================================
// 7. The per-element measurement the preview and the validator share
//====================================================================================

/** Font size in px, for the legacy heuristic report and for a missing-glyph average. */
function fallbackMetrics(name) {
  const { em } = nameSizedAdvance(name);
  return {
    format: 'estimate',
    file: null,
    size: em,
    lineHeight: em + 2,
    base: em,
    exact: false,
    exactness: METRIC_EXACTNESS.estimate,
    lineHeightDerived: true,
    hasKerning: false,
    kernPairs: 0,
    notes: ['no font descriptor was found; widths fall back to the 0.55em-per-character guess'],
    glyph: () => ({ advance: em * FALLBACK_ADVANCE_EM, xoffset: 0, yoffset: 0, width: em * FALLBACK_ADVANCE_EM, height: em }),
    kerningOf: () => 0,
  };
}

/**
 * Everything one text element needs, measured once.
 *
 * @param {{node: object, rect: object, path: string, kind: string}} box a laid-out element
 * @param {{library: object, values?: Map<string,string>, iconWidth?: Function, language?: string,
 *          measure?: boolean}} context
 */
export function measureElementText(box, context = {}) {
  const node = box.node ?? {};
  const rect = box.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  const key = node.text ?? node.buttonText ?? null;
  const fontName = node.font ?? node.buttonFont ?? 'cg_16b';
  const maxWidth = Number(node.maxWidth) || Math.round(rect.width);
  const maxHeight = Number(node.maxHeight) || Math.round(rect.height);
  const verticalOffset = Number(node.vertical_offset) || 0;
  const format = String(node.format ?? 'left').toLowerCase();

  const result = {
    path: box.path,
    name: node.name ?? null,
    kind: box.kind ?? node.kind ?? null,
    key,
    font: fontName,
    language: context.language ?? context.library?.language ?? 'english',
    maxWidth,
    maxHeight,
    format,
    text: null,
    resolved: false,
    measured: false,
    exact: false,
    exactness: 'not measured',
    method: 'none',
    lines: [],
    lineCount: 0,
    width: null,
    height: null,
    lineHeight: null,
    fitsWidth: null,
    fitsHeight: null,
    overflowX: null,
    overflowY: null,
    overflows: false,
    wordOverflow: [],
    unresolvedTokens: [],
    live: false,
    liveTokens: [],
    liveOnResolvingChannel: false,
    icons: [],
    missingGlyphs: [],
    notes: [],
    // The box the text is actually DRAWN in, in layout pixels. `x` depends on `format`, and
    // the height is the wrapped height, which is what decides whether the block lands on the
    // row below.
    textRect: null,
    dynamicExtraHeight: 0,
  };

  if (typeof key !== 'string' || key === '') {
    result.method = 'no-text';
    return result;
  }

  // The caller may hand us a resolver, or just the localisation values map the index already
  // built (`context.values`); both are normal, so both work.
  const resolvedValue = context.resolveLocalisation
    ? context.resolveLocalisation(key)
    : (context.values?.get?.(key) ?? null);
  if (resolvedValue === null || resolvedValue === undefined) {
    result.method = 'unresolved';
    result.notes.push('the localisation key did not resolve, so there is no string to measure');
    return result;
  }
  const expansion = expandLocalisation(resolvedValue, {
    values: context.values ?? null,
    colorCodes: context.colorCodes ?? context.library?.textColors ?? null,
  });
  result.text = expansion.text;
  result.resolved = true;
  result.unresolvedTokens = [...expansion.unresolved];

  const source = context.library?.font ? context.library.font(fontName) : null;
  let metrics = source?.metrics ?? null;
  if (!metrics) {
    metrics = fallbackMetrics(fontName);
    result.method = 'estimate';
    result.notes.push(source?.reason ?? 'no font catalogue was supplied');
  } else {
    result.method = metrics.format;
    result.fontFile = metrics.file;
    result.exact = metrics.exact === true && expansion.unresolved.size === 0;
  }
  result.exactness = metrics.exactness;
  result.notes.push(...(metrics.notes ?? []));

  // `dynamic_extra_height` exists precisely because a wrapped block's height is not fixed: the
  // element grows by the extra lines and `dynamic_extra_height_max` caps the growth. Measured
  // from the keyword list in stellaris.exe (`dynamic_extra_height`, `dynamic_extra_height_max`)
  // - the exact arithmetic is not published, so the cap is read as "this much more height is
  // available", which is the reading the field name supports and the conservative one.
  const dynamicExtra = Number(node.dynamic_extra_height_max ?? node.dynamic_extra_height) || 0;
  result.dynamicExtraHeight = dynamicExtra;

  // Wrapping is the engine's default: across 960 vanilla text elements that carry a resolvable
  // string, exactly ONE declares `multiline = yes` and 955 leave it out, while 37 of those 955
  // hold a string wider than their own `maxWidth`. A model that only wrapped on `multiline`
  // would call all 37 a horizontal overflow. `context.wrap: false` forces the single-line
  // reading, which is what the before/after report compares against.
  const wrapAllowed = context.wrap === undefined ? node.multiline !== false : context.wrap === true;
  const wrap = wrapText(metrics, expansion.text, {
    maxWidth: wrapAllowed ? maxWidth : undefined,
    wrap: wrapAllowed,
    forbiddenStart: source?.multiline?.forbiddenStart ?? [],
    lineBreakAfter: source?.multiline?.lineBreak ?? [],
    iconWidth: context.iconWidth,
    averageAdvance: metrics.size ?? undefined,
  });

  result.lines = wrap.lines;
  result.lineCount = wrap.lineCount;
  result.width = wrap.width;
  result.height = wrap.height;
  result.budgetHeight = wrap.budgetHeight;
  result.lineHeight = wrap.lineHeight;
  result.base = wrap.base;
  result.wordOverflow = wrap.wordOverflow;
  result.icons = wrap.icons;
  result.missingGlyphs = wrap.missing;
  result.colourCodes = wrap.colourCodes;
  result.measured = true;
  result.wrapped = wrap.wrapped;
  result.missingKerning = metrics.hasKerning !== true && metrics.format === 'sfnt';

  const availableHeight = maxHeight + dynamicExtra;
  result.fitsWidth = wrap.width <= maxWidth;
  // The `maxHeight` budget is compared against the ASCENT BAND, not the ink - see the height
  // model in wrapText. This is calibrated against 839 vanilla elements (94.2% agreement).
  result.fitsHeight = wrap.budgetHeight <= availableHeight;
  result.overflowX = Math.max(0, wrap.width - maxWidth);
  result.overflowY = Math.max(0, wrap.budgetHeight - availableHeight);
  result.inkOverflowY = Math.max(0, wrap.height - availableHeight);

  // A line that could not be broken is a horizontal overflow even when the box is wide,
  // because the engine will not split the word.
  if (wrap.wordOverflow.length > 0) result.overflowX = Math.max(result.overflowX, result.width - maxWidth);
  result.overflows = !result.fitsWidth || !result.fitsHeight;

  const drawnWidth = Math.min(wrap.width, maxWidth > 0 ? Math.max(wrap.width, maxWidth) : wrap.width);
  const left =
    format === 'right'
      ? rect.x + Math.max(0, maxWidth - wrap.width)
      : format === 'center' || format === 'centre'
        ? rect.x + Math.max(0, (maxWidth - wrap.width) / 2)
        : rect.x;
  // The unwrapped overflow is drawn past the right edge; formatting cannot pull it back in.
  result.textRect = {
    x: Math.round(left),
    y: Math.round(rect.y + verticalOffset),
    width: Math.round(wrap.width),
    height: Math.round(wrap.height),
    drawnWidth: Math.round(drawnWidth),
  };
  // Where the engine's baselines are, so the preview can draw at the measured size.
  result.baselines = wrap.lines.map(
    (line, index) => Math.round(rect.y + verticalOffset + (metrics.base ?? metrics.lineHeight) + index * wrap.lineHeight),
  );
  if (expansion.unresolved.size > 0) {
    result.notes.push(
      `unresolved localisation token(s) ${[...expansion.unresolved].join(', ')}: the rendered width of ` +
        'these is runtime data, so the measured width is a LOWER BOUND',
    );
  }
  // ---- GAP-5: A LIVE VALUE IS NOT INK ------------------------------------------------------
  //
  // A readout's localisation value is `[$GetUngaAttUnNato$]`. `$GetUngaAttUnNato$` is a
  // `common/scripted_loc/*.txt` `defined_text` name, i.e. runtime data, so it does NOT expand here
  // and the 16 characters of `[$GetUngaAttUnNato$]` are left in the string - where they measure
  // 146 px (cg_16b, english) / 152 px (simp_chinese) in the reference's own 70 px value column, and
  // the plugin then reported one `text-overflow` per readout. 30 of them on this mod, every one of
  // them a false positive on the one channel the project documents as the only measured way to
  // paint a live number inside a `custom_gui` window (`effectbuttonType.buttonText` +
  // `effect = <common/button_effects key>`, docs/gui-pitfalls.md section 11 and
  // `interface/fleet_view.gui:708-721`). There is no width that satisfies the rule: the token needs
  // 146 px and the panel gives the column 70 px, and widening it to 160 px clears the overflow but
  // puts the box on the action buttons, which the same run then reports as a real `text-collision`
  // between two clickable things.
  //
  // So the measurement says what it can and cannot know. `live` is true when the string carries a
  // `[$...$]` whose inner token did not resolve, i.e. a value the ENGINE will replace at draw time
  // with 2-5 characters; `liveMeasureable` is true when the element is on the channel that actually
  // resolves it. The generic ink rules must then NOT charge the token as text - `result.overflows`
  // is cleared and the caller is told why - and `liveNote` is carried into the finding that replaces
  // the 30 false overflows, so the exclusion is a reported fact rather than silence.
  //
  // The channel test is `effectbuttonType` + `buttonText` + an `effect`: that is the shape measured
  // to resolve (docs/gui-pitfalls.md section 11), and it is what the mod's 30 readouts are. A plain
  // `instantTextBoxType` with a bracket call is the section-11 trap, and it is genuinely painted
  // literally - those keep their findings.
  const liveTokens = [...expansion.unresolved].filter((token) => new RegExp(`\\[\\s*\\$${escapeForRegExp(token)}\\$\\s*\\]`).test(expansion.text));
  if (liveTokens.length > 0) {
    result.live = true;
    result.liveTokens = liveTokens;
    result.liveOnResolvingChannel = node.kind === 'effectbutton' && typeof node.buttonText === 'string' && typeof node.effect === 'string' && node.effect !== '';
    if (result.liveOnResolvingChannel) {
      result.overflows = false;
      result.fitsWidth = true;
      result.fitsHeight = true;
      result.overflowX = 0;
      result.overflowY = 0;
      result.wordOverflow = [];
    }
    result.notes.push(
      `LIVE VALUE: this string carries ${liveTokens.map((token) => `\`[$...$]\``).join(', ')} - runtime data, so the ` +
        `measured ${wrap.width} px is what the UNRESOLVED token would need, not what will be painted. The engine replaces ` +
        `it with 2-5 characters at draw time` +
        (result.liveOnResolvingChannel
          ? ', and this element is on the channel that resolves it (`effectbuttonType.buttonText` with an `effect`), so the measurement is not charged as ink.'
          : ', but this element does NOT resolve it: a bracket call in painted window text is printed literally (docs/gui-pitfalls.md section 11).'),
    );
  }
  if (wrap.missing.length > 0) {
    result.notes.push(
      `the font has no glyph for ${wrap.missing.length} character(s) (${wrap.missing.slice(0, 8).join('')}); ` +
        'their advance is the font average and marked as estimated',
    );
  }
  if (wrap.wordOverflow.length > 0) {
    result.notes.push(
      `${wrap.wordOverflow.length} run(s) are wider than the box and have no legal break inside them; ` +
        'they are drawn overflowing (the engine has no hyphenation)',
    );
  }
  return result;
}

/** Intersection area of two rects, in px^2. */
export function rectIntersection(first, second) {
  const x = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const y = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  return { width: x, height: y, area: x * y };
}

/**
 * Do two elements' DRAWN TEXT actually intersect?
 *
 * This is the question the box model cannot answer: two elements whose rects overlap may still
 * have their glyphs far apart (a box artifact), and a wrapped block that outgrows its
 * `maxHeight` may reach a sibling whose rect never overlapped it.
 */
export function textOverlap(first, second) {
  if (!first?.measured || !second?.measured || !first.textRect || !second.textRect) return null;
  const intersection = rectIntersection(first.textRect, second.textRect);
  return {
    area: intersection.area,
    width: intersection.width,
    height: intersection.height,
    overlaps: intersection.area > 0,
    boxOverlapArea: rectIntersection(
      { x: first.textRect.x, y: 0, width: 0, height: 0 },
      { x: second.textRect.x, y: 0, width: 0, height: 0 },
    ).area,
  };
}

/** A one-line summary of the measurement, for reports and tool output. */
export function describeMeasurement(measurement) {
  if (!measurement.measured) return `${measurement.path}: ${measurement.method}`;
  return (
    `${measurement.path}: "${measurement.text?.slice(0, 60) ?? ''}" in ${measurement.font} ` +
    `(${measurement.method}) measures ${measurement.width}x${measurement.height}px over ` +
    `${measurement.lineCount} line(s) in a ${measurement.maxWidth}x${measurement.maxHeight} box`
  );
}

/**
 * Process-wide cache of font libraries, keyed by (install, language).
 *
 * Building one reads the install's `interface` folder for `.gfx` files to find the `bitmapfont`
 * blocks and then loads a `.fnt` or a `.otf` per font actually used; a 16 MB CJK `.otf` must be
 * read once for a server session, not once per preview or once per validation. The language is
 * part of the key because the SAME font name is a bitmap font in English and a TrueType font in
 * Simplified Chinese (`interface/fonts.gfx:168` vs `:194`).
 */
const SHARED_LIBRARIES = new Map();

export function sharedFontLibrary(installRoot, language = 'english') {
  if (!installRoot) return null;
  const key = `${installRoot}|${language}`;
  if (!SHARED_LIBRARIES.has(key)) {
    try {
      SHARED_LIBRARIES.set(key, createFontLibrary({ installRoot, language }));
    } catch {
      SHARED_LIBRARIES.set(key, null);
    }
  }
  return SHARED_LIBRARIES.get(key);
}

/** Forget the cached libraries; used by tests that point at different installs. */
export function resetFontLibraryCache() {
  SHARED_LIBRARIES.clear();
}

/** The average advance per character of a font, for calibration reports. */
export function sampleAdvances(metrics, alphabet) {
  const out = [];
  for (const char of alphabet) {
    const glyph = metrics.glyph(char.codePointAt(0));
    if (glyph) out.push({ char, advance: glyph.advance });
  }
  return out;
}

export default {
  FONT_METRICS_VERSION,
  METRIC_EXACTNESS,
  buildFontCatalogue,
  createFontLibrary,
  describeMeasurement,
  expandLocalisation,
  isCjk,
  measureElementText,
  nameSizedAdvance,
  parseBitmapFont,
  parseFontDefinitions,
  parseSfntFont,
  rectIntersection,
  resolveFontSource,
  sampleAdvances,
  splitMarkup,
  textOverlap,
  wrapText,
  wrapUnits,
};
