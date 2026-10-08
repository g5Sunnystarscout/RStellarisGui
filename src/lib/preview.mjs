//------------------------------------------------------------------------------------
// preview.mjs -- Part of RStellarisGui
//
// The preview renderer: a layout in, a self-contained SVG (and optionally a PNG) out.
//
// This exists for one reason: an agent that cannot see the game needs *something* visual, and
// a human dragging components needs to see the result before launching Stellaris. So the SVG
// embeds real decoded textures where a DDS decoded successfully, and a labelled placeholder
// rectangle everywhere else - a placeholder is information, not a failure.
//
// Textures are embedded as base64 PNG data URIs, which keeps the SVG a single portable file
// with no external references. Thumbnails come from the DDS mip chain (a 4096x4096 texture
// decodes its 128x128 mip, not 16M pixels) and are cached on disk, because decoding the same
// button sprite hundreds of times is the only slow part of a preview.
//
// Everything is drawn in the 1920x1080 base resolution and the SVG says so in its header
// comment and in the footer, because "overlap" is meaningless without a stated base.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodeTextureThumbnail } from './dds.mjs';
import { measureElementText, rectIntersection, sharedFontLibrary } from './font-metrics.mjs';
import { computeLayout, makeSpriteLookup, BASE_RESOLUTION } from './layout.mjs';
import { cacheRoot, ensureDir, readTextFile, relativeKey, resolveGameRoot } from './paths.mjs';
import { encodePng, resizeRgba } from './png.mjs';

/** Palette per element kind, so the preview reads as a classified view, not just boxes. */
export const KIND_COLOURS = {
  container: { stroke: '#4a90d9', fill: 'rgba(74,144,217,0.10)' },
  window: { stroke: '#4a90d9', fill: 'rgba(74,144,217,0.10)' },
  text: { stroke: '#d9a441', fill: 'rgba(217,164,65,0.12)' },
  icon: { stroke: '#57b85c', fill: 'rgba(87,184,92,0.12)' },
  button: { stroke: '#c057b8', fill: 'rgba(192,87,184,0.12)' },
  effectbutton: { stroke: '#e05252', fill: 'rgba(224,82,82,0.16)' },
  // A component (src/lib/components.mjs) is expanded before the preview runs, so these are the
  // pieces a bar becomes. Giving the track and the fill their own colours makes a bar read as a
  // track + a proportional fill in the preview, which is the question a bar preview is asked.
  bar: { stroke: '#2f6f4f', fill: 'rgba(47,111,79,0.10)' },
  unknown: { stroke: '#888888', fill: 'rgba(128,128,128,0.10)' },
};

/** Palette per COMPONENT piece, keyed by the `component` marker the expansion leaves on a node. */
export const COMPONENT_COLOURS = {
  bar: { stroke: '#2f6f4f', fill: 'rgba(47,111,79,0.10)' },
  'bar-track': { stroke: '#2f6f4f', fill: 'rgba(47,111,79,0.14)' },
  'bar-fill': { stroke: '#57b85c', fill: 'rgba(87,184,92,0.55)' },
  'bar-label': { stroke: '#d9a441', fill: 'rgba(217,164,65,0.12)' },
};

const SEVERITY_COLOURS = {
  error: '#ff3b30',
  warning: '#ffb020',
  info: '#5ac8fa',
};

export function kindColour(kind) {
  return KIND_COLOURS[kind] ?? KIND_COLOURS.unknown;
}

/**
 * The colour for one box: a COMPONENT piece wins over its kind, so a bar's track and fill are
 * distinguishable in the preview even though both are `container`s by the time it runs.
 */
export function boxColour(box) {
  return COMPONENT_COLOURS[box?.node?.component] ?? kindColour(box?.kind ?? 'unknown');
}

/**
 * One font library per (install, language), reused across renders.
 *
 * Building it reads the install's `interface` folder for `.gfx` files to find the `bitmapfont`
 * blocks (~131 files, one pass) and then loads a `.fnt` or a `.otf` per font actually used. A 16 MB CJK `.otf`
 * must be read once for a whole server session, not once per preview, so the cache lives in
 * font-metrics.mjs and is shared with the validator - which keeps the preview's numbers and the
 * validator's findings from ever coming from two different metric loads.
 */
export function fontLibraryFor(gameRoot, language = 'english') {
  return sharedFontLibrary(gameRoot, language);
}

/** Escape text for XML content and attributes. */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Escape text for an SVG `<text>` node, keeping it one line. */
function shortLabel(value, max = 26) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}~` : text;
}

/**
 * Resolve a `.gfx` textureFile to an absolute path under the game root.
 * Mirrors asset-index.resolveTexturePath but kept local so the renderer has no build-order
 * dependency on the index.
 */
function textureAbsolutePath(gameRoot, textureFile) {
  if (!gameRoot || !textureFile) return null;
  const normalised = String(textureFile).replace(/\\/g, '/').replace(/^\/+/, '');
  const candidate = join(gameRoot, ...normalised.split('/'));
  return existsSync(candidate) ? candidate : null;
}

/**
 * A disk cache of decoded thumbnails.
 *
 * Layout: .cache/thumbs/<sha1>.json holding `{width, height, rgba: number[]}`. Raw RGBA is
 * stored rather than an encoded PNG because both consumers need different things - the SVG
 * wants base64 PNG and the PNG renderer wants pixels - and decoding a DDS twice for the same
 * preview would dominate the runtime. PNG encoding happens on demand in `dataUri`.
 */
export class ThumbnailCache {
  constructor({ directory = join(cacheRoot(), 'thumbs'), maxEntries = 3000 } = {}) {
    this.directory = directory;
    this.maxEntries = maxEntries;
    this.memory = new Map();
    this.stats = { hits: 0, misses: 0, decoded: 0, failed: 0 };
  }

  key(path, size) {
    return createHash('sha1').update(`${path}|${size}`).digest('hex').slice(0, 20);
  }

  /**
   * Get `{ok, width, height, rgba}` for a texture, or `{ok:false, reason}`.
   * `size` is the target thumbnail box (the longest side), not the source size.
   */
  get(path, size) {
    if (!path) return { ok: false, reason: 'no texture path' };
    const key = this.key(path, size);
    if (this.memory.has(key)) {
      this.stats.hits += 1;
      return this.memory.get(key);
    }
    const file = join(this.directory, `${key}.json`);
    if (existsSync(file)) {
      try {
        const cached = JSON.parse(readTextFile(file));
        const result = { ok: true, ...cached, rgba: Uint8ClampedArray.from(cached.rgba), source: 'cache' };
        this.memory.set(key, result);
        this.stats.hits += 1;
        return result;
      } catch {
        /* fall through to a fresh decode */
      }
    }

    this.stats.misses += 1;
    const decoded = decodeTextureThumbnail(path, size);
    if (!decoded.ok) {
      this.stats.failed += 1;
      const result = { ok: false, reason: decoded.reason };
      this.memory.set(key, result);
      return result;
    }

    // Scale to fit the requested box, preserving aspect ratio.
    const scale = Math.min(1, size / Math.max(decoded.width, decoded.height));
    const targetWidth = Math.max(1, Math.round(decoded.width * scale));
    const targetHeight = Math.max(1, Math.round(decoded.height * scale));
    const rgba =
      targetWidth === decoded.width && targetHeight === decoded.height
        ? decoded.rgba
        : resizeRgba(decoded.rgba, decoded.width, decoded.height, targetWidth, targetHeight);

    const result = {
      ok: true,
      width: targetWidth,
      height: targetHeight,
      sourceWidth: decoded.sourceWidth,
      sourceHeight: decoded.sourceHeight,
      format: decoded.format,
      mipLevel: decoded.mipLevel,
      rgba,
      source: 'decoded',
    };
    this.stats.decoded += 1;
    this.memory.set(key, result);
    if (this.memory.size <= this.maxEntries) {
      try {
        ensureDir(this.directory);
        writeFileSync(
          file,
          JSON.stringify({ ...result, rgba: Array.from(rgba) }),
          'utf8',
        );
      } catch {
        /* a cache write failure must never break a preview */
      }
    }
    return result;
  }

  /** Base64 PNG data URI for a cached thumbnail, encoded on demand and memoised. */
  dataUri(entry) {
    if (!entry?.ok) return null;
    if (!entry.dataUri) {
      entry.dataUri = `data:image/png;base64,${encodePng(entry.rgba, entry.width, entry.height, {
        level: 6,
      }).toString('base64')}`;
    }
    return entry.dataUri;
  }
}

/**
 * A `spriteLookup` for layout.mjs: unsized sprites draw at their texture's natural size.
 * Delegates to the single shared implementation in layout.mjs.
 */
function spriteLookupFor(assets) {
  return makeSpriteLookup(assets);
}

/**
 * The 9-slice geometry of a cornered-tile sprite drawn into a rect.
 *
 * `corneredTileSpriteType` chrome is a 9-slice: the four corners are drawn at their natural
 * size (or scaled down proportionally when the element is smaller than both borders), and the
 * four edges plus the middle are stretched to fill. Drawing the whole texture squashed into the
 * rect instead - what an earlier revision did - makes every window background a flat colour
 * block, which is why the preview could not be used to judge chrome (A4).
 *
 * `borderSize` is in SOURCE texture pixels; `frameCount` is a texture strip (`noOfFrames = 3`),
 * and frame 0 is the one drawn in the idle state. Both the strip (`frameWidth = image.width /
 * frames`) and the border are therefore frame-scoped: the slice source rectangles are inside frame
 * 0 only, so a three-frame button strip is not drawn as three buttons side by side.
 *
 * @returns {{slices: {source: object, target: object}[], cornerPx: object, scaled: boolean,
 *            tilePx: object, frame: object}|null}
 */
export function nineSliceFor(elementRect, spriteRecord, image, textureSize) {
  const border = spriteRecord?.borderSize;
  if (!border || !image?.width || !image?.height) return null;
  // `borderSize` is in SOURCE texture pixels; `image` is the decoded mip, so the border is
  // scaled by the mip's shrink factor. (A 680x612 texture with borderSize 330x296 decodes its
  // 170x153 mip for a thumbnail, where the border is 82.5x74.)
  const shrink = textureSize?.width ? image.width / textureSize.width : 1;
  const frames = Math.max(1, spriteRecord.frameCount ?? 1);
  const frameWidth = image.width / frames;
  const frameHeight = image.height;
  const borderX = Math.min(Math.max(0, (border.x ?? 0) * shrink), frameWidth - 1);
  const borderY = Math.min(Math.max(0, (border.y ?? 0) * shrink), frameHeight - 1);
  if (borderX <= 0 && borderY <= 0) return null;

  // The natural scale is 1 element px per source px. If the element is smaller than the two
  // borders, scale the whole slice set down proportionally - the engine's own behaviour here is
  // not observable from the install, so the preview documents the rule it uses (see `note`).
  const width = Math.max(1, elementRect.width);
  const height = Math.max(1, elementRect.height);
  const fit = Math.min(1, borderX > 0 ? width / (2 * borderX) : 1, borderY > 0 ? height / (2 * borderY) : 1);
  const cornerW = Math.max(0, borderX * fit);
  const cornerH = Math.max(0, borderY * fit);
  const middleSourceW = Math.max(0, frameWidth - 2 * borderX);
  const middleSourceH = Math.max(0, frameHeight - 2 * borderY);
  const middleW = Math.max(0, width - 2 * cornerW);
  const middleH = Math.max(0, height - 2 * cornerH);

  const slices = [];
  const add = (sx, sy, sw, sh, tx, ty, tw, th) => {
    if (sw <= 0 || sh <= 0 || tw <= 0 || th <= 0) return;
    slices.push({ source: { x: sx, y: sy, width: sw, height: sh }, target: { x: tx, y: ty, width: tw, height: th } });
  };
  // Corners: natural size (or the proportional fit), so the frame's corner radius survives.
  add(0, 0, borderX, borderY, 0, 0, cornerW, cornerH);
  add(frameWidth - borderX, 0, borderX, borderY, width - cornerW, 0, cornerW, cornerH);
  add(0, frameHeight - borderY, borderX, borderY, 0, height - cornerH, cornerW, cornerH);
  add(frameWidth - borderX, frameHeight - borderY, borderX, borderY, width - cornerW, height - cornerH, cornerW, cornerH);
  // Edges: stretched along one axis.
  add(borderX, 0, middleSourceW, borderY, cornerW, 0, middleW, cornerH);
  add(borderX, frameHeight - borderY, middleSourceW, borderY, cornerW, height - cornerH, middleW, cornerH);
  add(0, borderY, borderX, middleSourceH, 0, cornerH, cornerW, middleH);
  add(frameWidth - borderX, borderY, borderX, middleSourceH, width - cornerW, cornerH, cornerW, middleH);
  // Middle: stretched on both axes.
  add(borderX, borderY, middleSourceW, middleSourceH, cornerW, cornerH, middleW, middleH);

  return {
    slices,
    frame: { x: 0, y: 0, width: frameWidth, height: frameHeight, count: frames },
    border: { x: borderX, y: borderY },
    cornerPx: { width: cornerW, height: cornerH },
    tilePx: { width: middleW, height: middleH },
    scaled: fit < 1,
  };
}

/** How the preview draws chrome, stated in every SVG so the image is not silently misleading. */
export const CHROME_NOTE =
  'Cornered-tile chrome is drawn as a 9-slice: corners at their natural size, edges and middle stretched ' +
  '(scaled down proportionally when the element is smaller than both borders). The engine may scale the ' +
  'corners differently for an element smaller than twice the border, so treat chrome COLOUR and exact corner ' +
  'size as approximate; the geometry (rect positions and sizes) is exact.';

/** Shared default cache, so repeated previews in one process are cheap. */
let sharedCache = null;
export function defaultThumbnailCache() {
  if (!sharedCache) sharedCache = new ThumbnailCache();
  return sharedCache;
}

/**
 * Render a layout to SVG.
 *
 * @param {object} layout
 * @param {{assets?: object, gameRoot?: string, showGrid?: boolean, showRects?: boolean,
 *          showText?: boolean, thumbnailSize?: number, validationReport?: object,
 *          highlightRules?: string[], cache?: ThumbnailCache, background?: string}} options
 * @returns {{svg: string, stats: object, table: object[]}}
 */
export function renderSvg(layout, options = {}) {
  const assets = options.assets ?? null;
  const base = layout.baseResolution ?? BASE_RESOLUTION;
  const width = options.width ?? base.width ?? BASE_RESOLUTION.width;
  const height = options.height ?? base.height ?? BASE_RESOLUTION.height;
  const showGrid = options.showGrid !== false;
  const showRects = options.showRects !== false;
  const showText = options.showText !== false;
  const thumbnailSize = options.thumbnailSize ?? 128;
  const cache = options.cache ?? defaultThumbnailCache();
  const gameRoot = options.gameRoot ? resolveGameRoot(options.gameRoot) : assets?.root ?? null;

  const { boxes, issues } = computeLayout(layout, {
    baseWidth: width,
    baseHeight: height,
    // Callers may supply their own lookup (the web server does, so the tree and the rect table
    // agree with the drawn SVG); otherwise derive it from the asset index.
    spriteLookup: options.spriteLookup ?? spriteLookupFor(assets),
  });

  const highlighted = new Set();
  for (const finding of options.validationReport?.findings ?? []) {
    if (!options.highlightRules || options.highlightRules.includes(finding.rule)) {
      if (finding.path) highlighted.add(finding.path);
    }
  }

  // Changed-element highlighting: the REVERSE feedback path of the human/agent handoff. The page
  // asks for the paths the agent changed (or the paths the human changed) and they are outlined in
  // their own colour, so "what moved since the revision I was looking at" is visible at a glance
  // instead of having to be read out of a table. Kept separate from finding highlighting on
  // purpose: a changed element is not a defect, and a defect is not necessarily a change.
  const changed = new Set(options.highlightChanges ?? []);
  const CHANGE_COLOUR = options.changeColour ?? '#ffd166';

  const parts = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
      `font-family="Consolas,Menlo,monospace" font-size="11">`,
  );
  parts.push(
    `<!-- RStellarisGui preview. Base resolution ${width}x${height}. All geometry is in these ` +
      `pixels; the game scales the whole UI, so overlap/out-of-bounds are relative to this base. -->`,
  );
  parts.push(`<!-- CHROME IS APPROXIMATE: ${CHROME_NOTE} -->`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${options.background ?? '#12161c'}"/>`);

  if (showGrid) {
    parts.push('<g id="grid" opacity="0.35">');
    for (let x = 0; x <= width; x += 40) {
      const major = x % 200 === 0;
      parts.push(
        `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${major ? '#3a4756' : '#232c36'}" stroke-width="${major ? 1 : 0.5}"/>`,
      );
    }
    for (let y = 0; y <= height; y += 40) {
      const major = y % 200 === 0;
      parts.push(
        `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${major ? '#3a4756' : '#232c36'}" stroke-width="${major ? 1 : 0.5}"/>`,
      );
    }
    parts.push('</g>');
    // Ruler labels every 200 px.
    parts.push('<g id="ruler" fill="#5b6b7d" font-size="9">');
    for (let x = 0; x <= width; x += 200) parts.push(`<text x="${x + 2}" y="10">${x}</text>`);
    for (let y = 200; y <= height; y += 200) parts.push(`<text x="2" y="${y - 2}">${y}</text>`);
    parts.push('</g>');
  }

  if (changed.size > 0) {
    parts.push(
      `<!-- ${changed.size} element(s) were changed since the compared revision; they are outlined in ` +
        `${CHANGE_COLOUR} (dashed). The comparison revision is named in the page's diff panel. -->`,
    );
  }

  const table = [];
  const textureStats = { requested: 0, embedded: 0, placeholder: 0, failed: 0, sliced: 0 };
  // The measured text extents (src/lib/font-metrics.mjs). `measuredText` replaces an earlier
  // estimate that multiplied the character count by 0.55em taken from the number in the font's
  // NAME - a guess that was 40% high for `cg_16b` and 100% low for `jura`, whose name has no
  // number in it at all.
  const language = options.language ?? 'english';
  const library = options.measureText === false ? null : options.fontLibrary ?? fontLibraryFor(gameRoot, language);
  const measureOptions = {
    library,
    language,
    values: options.localisationValues ?? null,
    resolveLocalisation: options.resolveLocalisation,
    iconWidth: options.iconWidth,
  };
  const textMeasurements = [];
  const measuredByPath = new Map();

  for (const box of boxes) {
    const rect = box.rect;
    const isHighlighted = highlighted.has(box.path);
    if (rect.width <= 0 || rect.height <= 0) {
      // A zero-size element is invisible in game but must still be visible in the report: it is
      // how vanilla hides elements, and an element the author forgot to size is exactly the
      // mistake a preview exists to reveal. Draw a labelled 6px marker instead of skipping it,
      // so "one group per element" holds and nothing silently disappears from the preview.
      const markerSize = 6;
      const colour = boxColour(box);
      const omitted = box.trace?.sizeIndeterminate ? 'size unknown' : `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      parts.push(
        `<g id="${escapeXml(box.id)}" data-path="${escapeXml(box.path)}" data-kind="${escapeXml(box.kind)}" ` +
          `data-zero-size="true">`,
      );
      parts.push(
        `<rect x="${rect.x - markerSize / 2}" y="${rect.y - markerSize / 2}" width="${markerSize}" height="${markerSize}" ` +
          `fill="none" stroke="${isHighlighted ? '#ff3b30' : colour.stroke}" stroke-width="1.5" stroke-dasharray="2 2"/>`,
      );
      parts.push(
        `<text x="${rect.x + markerSize}" y="${rect.y + 3}" fill="${colour.stroke}" font-size="9">` +
          `${escapeXml(shortLabel(`${box.kind === 'container' ? '' : `${box.kind}:`}${box.name ?? ''} (${omitted})`, 40))}</text>`,
      );
      parts.push('</g>');
      table.push(tableRow(box, null, null));
      continue;
    }
    const colour = boxColour(box);
    const stroke = isHighlighted ? '#ff3b30' : colour.stroke;

    // Decorative background rect for a container, drawn first.
    const backgroundSprite = box.node?.background?.sprite;
    let backgroundEntry = null;
    let backgroundRecord = null;
    if (backgroundSprite && assets) {
      backgroundRecord = assets.sprites[backgroundSprite];
      const texturePath = textureAbsolutePath(gameRoot, backgroundRecord?.textureFile);
      textureStats.requested += 1;
      if (texturePath) {
        backgroundEntry = cache.get(texturePath, thumbnailSize);
        if (backgroundEntry.ok) textureStats.embedded += 1;
        else textureStats.failed += 1;
      } else {
        textureStats.placeholder += 1;
      }
    }

    parts.push(`<g id="${escapeXml(box.id)}" data-path="${escapeXml(box.path)}" data-kind="${escapeXml(box.kind)}">`);
    if (backgroundEntry?.ok) {
      const drawn = emitSlicedImage(parts, backgroundEntry, backgroundRecord, assets, rect, rect, cache);
      if (!drawn) textureStats.embedded -= 1;
      else if (drawn.sliced) textureStats.sliced = (textureStats.sliced ?? 0) + 1;
    } else {
      parts.push(
        `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" ` +
          `fill="${colour.fill}" stroke="${stroke}" stroke-width="${isHighlighted ? 2.5 : 1}"` +
          `${isHighlighted ? ' stroke-dasharray="6 3"' : ''}/>`,
      );
    }

    // A sprite element draws its own texture if we can decode one.
    const spriteName = box.node?.quadTextureSprite ?? box.node?.spriteType;
    let spriteEntry = null;
    let spriteRecord = null;
    if (spriteName && assets) {
      spriteRecord = assets.sprites[spriteName];
      const texturePath = textureAbsolutePath(gameRoot, spriteRecord?.textureFile);
      textureStats.requested += 1;
      if (texturePath) {
        spriteEntry = cache.get(texturePath, thumbnailSize);
        if (spriteEntry.ok) textureStats.embedded += 1;
        else textureStats.failed += 1;
      } else {
        textureStats.placeholder += 1;
      }
      if (spriteEntry?.ok) {
        const scale = box.node?.scale ?? 1;
        const target = { x: rect.x, y: rect.y, width: rect.width * scale, height: rect.height * scale };
        const drawn = emitSlicedImage(parts, spriteEntry, spriteRecord, assets, target, rect, cache);
        if (drawn?.sliced) textureStats.sliced = (textureStats.sliced ?? 0) + 1;
      } else {
        // Labelled placeholder: name of the sprite, and its real size when we know it.
        const natural = assets.textures[spriteRecord?.textureFile ?? ''];
        const sizeNote = natural?.ok ? `${natural.width}x${natural.height}` : 'no texture';
        parts.push(
          `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" ` +
            `fill="${colour.fill}" stroke="${stroke}" stroke-width="1" stroke-dasharray="3 2"/>`,
        );
        parts.push(
          `<text x="${rect.x + 3}" y="${rect.y + 12}" fill="${stroke}" font-size="10">` +
            `${escapeXml(shortLabel(spriteName, Math.max(8, Math.floor(rect.width / 6))))} ${escapeXml(sizeNote)}</text>`,
        );
      }
    } else if (spriteName) {
      textureStats.placeholder += 1;
    }

    if (showRects && !backgroundEntry?.ok) {
      parts.push(
        `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" ` +
          `fill="none" stroke="${stroke}" stroke-width="${isHighlighted ? 2.5 : 1}"` +
          `${isHighlighted ? ' stroke-dasharray="6 3"' : ''}/>`,
      );
    }

    if (showText) {
      // B9: when a localisation keyset is supplied, draw the RESOLVED text so a human (or an
      // agent) can see whether it fits. A Chinese-language mod's `maxWidth` overflow is invisible
      // while the preview says `unga_nam_body`, which is the whole point of the check.
      const rawLabel = box.node?.text ?? box.node?.buttonText ?? null;
      const resolved = rawLabel ? options.resolveLocalisation?.(rawLabel) ?? null : null;
      const measurement = rawLabel ? measureElementText(box, measureOptions) : null;
      if (measurement?.measured) {
        textMeasurements.push(measurement);
        measuredByPath.set(box.path, measurement);
      }
      // Where the text is REALLY drawn, in the engine's own metrics: the wrapped lines as boxes,
      // the extent as an outline. This is drawn whether or not the string resolved, because the
      // null result ("key did not resolve") is itself the finding.
      if (measurement && measurement.textRect) {
        const tone = measurement.overflows ? '#ff6b52' : measurement.exact ? '#7fd18a' : '#ffb020';
        parts.push(
          `<rect x="${measurement.textRect.x}" y="${measurement.textRect.y}" width="${measurement.textRect.width}" ` +
            `height="${measurement.textRect.height}" fill="none" stroke="${tone}" stroke-width="1" ` +
            `stroke-dasharray="3 2" data-measured-text="${escapeXml(box.path)}" ` +
            `data-text-method="${escapeXml(measurement.method)}" data-text-exact="${measurement.exact}" ` +
            `data-text-lines="${measurement.lineCount}" ` +
            `data-text-fits="${measurement.fitsWidth && measurement.fitsHeight}"/>`,
        );
        // One hairline per wrapped line at the measured baseline, so a wrap that grows the block
        // into the row below is visible as extra lines rather than as a taller-looking box.
        for (const [index, style] of measurement.lines.entries()) {
          const baseline = measurement.baselines?.[index];
          if (baseline === undefined) break;
          parts.push(
            `<line x1="${measurement.textRect.x}" y1="${baseline}" ` +
              `x2="${measurement.textRect.x + Math.max(1, style.width)}" y2="${baseline}" ` +
              `stroke="${tone}" stroke-width="0.75" opacity="0.75"/>`,
          );
        }
        // The measured size, and the overflow when there is one, spelled out.
        const note =
          measurement.overflows
            ? `${measurement.width}x${measurement.height} OVERFLOWS ${measurement.maxWidth}x${measurement.maxHeight}` +
              ` by ${Math.round(measurement.overflowX)}x${Math.round(measurement.overflowY)}`
            : `${measurement.width}x${measurement.height} / ${measurement.maxWidth}x${measurement.maxHeight}` +
              (measurement.lineCount > 1 ? ` (${measurement.lineCount} lines)` : '');
        parts.push(
          `<text x="${measurement.textRect.x}" y="${measurement.textRect.y - 2}" fill="${tone}" ` +
            `font-size="8" opacity="0.95">${escapeXml(note)}</text>`,
        );
      }
      const label = resolved ? `${rawLabel}: ${resolved}` : rawLabel ?? box.name ?? box.kind;
      const kindTag = box.kind === 'container' ? '' : `${box.kind}:`;
      const line = `${kindTag}${label}${box.node?.effect ? ` @${box.node.effect}` : ''}`;
      // Keep the label inside the rectangle when it is wide enough, above it otherwise.
      const labelY = rect.height >= 14 ? rect.y + 12 : Math.max(10, rect.y - 2);
      const labelFill = resolved ? '#d8f0d0' : '#e8eef5';
      parts.push(
        `<text x="${rect.x + 3}" y="${labelY}" fill="${labelFill}" opacity="0.92" font-size="10">` +
          `${escapeXml(shortLabel(line, Math.max(8, Math.floor(rect.width / 5.6))))}</text>`,
      );
      if (rect.height >= 30) {
        parts.push(
          `<text x="${rect.x + 3}" y="${labelY + 11}" fill="#8fa3b8" font-size="9">` +
            `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}</text>`,
        );
      }
    }
    parts.push('</g>');
    table.push(tableRow(box, spriteName, measuredByPath.get(box.path) ?? null));
  }

  // Changed-element overlay ("what the agent changed"), drawn over the elements and under the
  // findings, so a change and a defect can be read together without one hiding the other.
  if (changed.size > 0) {
    parts.push('<g id="changes">');
    for (const box of boxes) {
      if (!changed.has(box.path)) continue;
      const rect = box.rect;
      const markerSize = 6;
      const x = rect.width > 0 && rect.height > 0 ? rect.x - 2 : rect.x - markerSize / 2 - 2;
      const y = rect.width > 0 && rect.height > 0 ? rect.y - 2 : rect.y - markerSize / 2 - 2;
      const w = rect.width > 0 && rect.height > 0 ? rect.width + 4 : markerSize + 4;
      const h = rect.height > 0 && rect.height > 0 ? rect.height + 4 : markerSize + 4;
      parts.push(
        `<rect data-changed-path="${escapeXml(box.path)}" x="${x}" y="${y}" width="${w}" height="${h}" ` +
          `fill="none" stroke="${CHANGE_COLOUR}" stroke-width="2" stroke-dasharray="5 3"/>`,
      );
    }
    parts.push('</g>');
  }

  // Findings overlay: draw a marker for every finding that carries a rect.
  if (options.validationReport) {
    parts.push('<g id="findings">');
    for (const finding of options.validationReport.findings) {
      if (options.highlightRules && !options.highlightRules.includes(finding.rule)) continue;
      if (!finding.rect) continue;
      const colour = SEVERITY_COLOURS[finding.severity] ?? '#ffffff';
      parts.push(
        `<rect x="${finding.rect.x}" y="${finding.rect.y}" width="${finding.rect.width}" ` +
          `height="${finding.rect.height}" fill="none" stroke="${colour}" stroke-width="2.5" stroke-dasharray="2 3"/>`,
      );
      parts.push(
        `<circle cx="${finding.rect.x + 4}" cy="${finding.rect.y + 4}" r="4" fill="${colour}"/>`,
      );
    }
    parts.push('</g>');
  }

  // Footer: the rect table, so the SVG is self-describing even when opened alone.
  if (options.includeTable !== false && table.length > 0) {
    const rowHeight = 13;
    const tableHeight = Math.min(table.length, 60) * rowHeight + 24;
    parts.push(`<g id="rect-table" transform="translate(0,${height})">`);
    parts.push(`<rect x="0" y="0" width="${width}" height="${tableHeight}" fill="#0b0e12"/>`);
    parts.push(
      `<text x="6" y="14" fill="#8fa3b8" font-size="10">` +
        `rect table (base ${width}x${height}) - id | kind | x,y | w x h | sprite</text>`,
    );
    table.slice(0, 60).forEach((row, index) => {
      const y = 26 + index * rowHeight;
      parts.push(
        `<text x="6" y="${y}" fill="#cbd6e2" font-size="10">` +
          `${escapeXml(shortLabel(row.path, 46))} | ${escapeXml(row.kind)} | ${row.x},${row.y} | ` +
          `${row.width}x${row.height} | ${escapeXml(shortLabel(row.sprite ?? '-', 30))}</text>`,
      );
    });
    if (table.length > 60) {
      parts.push(
        `<text x="6" y="${26 + 60 * rowHeight}" fill="#8fa3b8" font-size="10">` +
          `... ${table.length - 60} more rows (see the JSON report)</text>`,
      );
    }
    parts.push('</g>');
  }

  parts.push('</svg>');

  // Measured text-vs-text collisions. Two elements whose RECTS overlap may have their glyphs
  // nowhere near each other; two elements whose rects do NOT overlap can still collide once a
  // wrapped block outgrows its `maxHeight` and reaches the row below. Only the measured extents
  // can tell those apart, which is why this is computed from `textMeasurements`.
  const collisions = [];
  for (let a = 0; a < textMeasurements.length; a += 1) {
    for (let b = a + 1; b < textMeasurements.length; b += 1) {
      const first = textMeasurements[a];
      const second = textMeasurements[b];
      if (first.path.split('.')[0] !== second.path.split('.')[0]) continue;
      const intersection = rectIntersection(first.textRect, second.textRect);
      if (intersection.area <= 0) continue;
      collisions.push({
        paths: [first.path, second.path],
        area: intersection.area,
        width: intersection.width,
        height: intersection.height,
        boxArtifactOnly: false,
      });
    }
  }

  return {
    svg: parts.join('\n'),
    stats: {
      elementCount: boxes.length,
      drawnCount: table.length,
      baseResolution: { width, height },
      textureStats,
      thumbnailCache: { ...cache.stats },
      layoutIssues: issues.length,
      highlightedFindings: highlighted.size,
      highlightedChanges: [...changed].filter((path) => boxes.some((box) => box.path === path)).length,
      changedPathsRequested: changed.size,
      chromeApproximate: true,
      chromeNote: CHROME_NOTE,
      localisationDrawn: textMeasurements.length,
      textFit: {
        checked: boxes.filter((box) => typeof (box.node?.text ?? box.node?.buttonText) === 'string').length,
        measured: textMeasurements.length,
        exact: textMeasurements.filter((entry) => entry.exact).length,
        estimated: textMeasurements.filter((entry) => !entry.exact).length,
        wrapped: textMeasurements.filter((entry) => entry.lineCount > 1).length,
        overflowing: textMeasurements
          .filter((entry) => entry.overflows)
          .map((entry) => ({
            path: entry.path,
            font: entry.font,
            method: entry.method,
            text: entry.text,
            width: entry.width,
            height: entry.height,
            lineCount: entry.lineCount,
            maxWidth: entry.maxWidth,
            maxHeight: entry.maxHeight,
            overflowX: entry.overflowX,
            overflowY: entry.overflowY,
            reason: !entry.fitsWidth ? 'wider than maxWidth' : 'taller than maxHeight',
          })),
        collisions,
        language,
        method: library
          ? `measured from the engine's own font data (${library.describes().bitmapFonts} bitmap + ` +
            `${library.describes().sfntFonts} TrueType descriptors loaded for l_${language}); advances are exact, ` +
            'line height is exact for bitmap fonts and derived for TTF'
          : 'NOT measured: no font library was available',
      },
      textMeasurements: textMeasurements.map((entry) => ({
        path: entry.path,
        font: entry.font,
        method: entry.method,
        exact: entry.exact,
        width: entry.width,
        height: entry.height,
        lineCount: entry.lineCount,
        maxWidth: entry.maxWidth,
        maxHeight: entry.maxHeight,
        fits: entry.fitsWidth && entry.fitsHeight,
        overflowX: entry.overflowX,
        overflowY: entry.overflowY,
        textRect: entry.textRect,
        notes: entry.notes,
      })),
    },
    table,
    measurements: textMeasurements,
  };
}

/**
 * Draw a decoded texture into a target rect, as a 9-slice when the sprite is a
 * `corneredTileSpriteType` with a `borderSize`.
 *
 * The nested `<svg viewBox>` does the cropping: the inner image is laid out in the decoded
 * texture's own pixel space and the viewport shows one slice of it scaled into the target rect.
 */
function emitSlicedImage(parts, entry, record, assets, target, clipRect, cache) {
  const imageWidth = entry.sourceWidth ?? entry.width;
  const imageHeight = entry.sourceHeight ?? entry.height;
  const texture = assets?.textures?.[record?.textureFile] ?? null;
  const href = cache.dataUri(entry);
  // FRAME 0 ONLY. A `noOfFrames = 3` sprite is a horizontal strip of three states and the engine
  // draws one; without this crop the preview drew the whole strip squeezed into the element (three
  // close buttons side by side, or a triple-wide background).
  const frames = Math.max(1, record?.frameCount ?? 1);
  const frameWidth = imageWidth / frames;
  const frame = { x: 0, y: 0, width: frameWidth, height: imageHeight };
  const nine = nineSliceFor({ x: 0, y: 0, width: target.width, height: target.height }, record, { width: frameWidth, height: imageHeight }, texture);
  if (!nine) {
    parts.push(
      `<svg x="${target.x}" y="${target.y}" width="${target.width}" height="${target.height}" ` +
        `viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}" preserveAspectRatio="none" overflow="hidden">`,
    );
    parts.push(
      `<image x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="none" xlink:href="${href}" opacity="0.95"/>`,
    );
    parts.push('</svg>');
    return { sliced: false, frames };
  }
  for (const slice of nine.slices) {
    const { source, target: local } = slice;
    parts.push(
      `<svg x="${target.x + local.x}" y="${target.y + local.y}" width="${local.width}" height="${local.height}" ` +
        `viewBox="${source.x} ${source.y} ${source.width} ${source.height}" preserveAspectRatio="none" overflow="hidden">`,
    );
    parts.push(
      `<image x="0" y="0" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none" xlink:href="${href}"/>`,
    );
    parts.push('</svg>');
  }
  void clipRect;
  return { sliced: true, slices: nine.slices.length, scaled: nine.scaled, corner: nine.cornerPx };
}

/**
 * The rect table row, including the MEASURED text extent when the string resolved.
 *
 * A rect table that only carries `x,y,w,h` is a table of boxes; the columns a reviewer needs to
 * judge text are the measured width/height, the wrapped line count and the fit. They come from
 * the same measurement the SVG drew from, so the table and the picture cannot disagree.
 */
function tableRow(box, spriteName, measurement = null) {
  return {
    path: box.path,
    name: box.name,
    kind: box.kind,
    x: Math.round(box.rect.x),
    y: Math.round(box.rect.y),
    width: Math.round(box.rect.width),
    height: Math.round(box.rect.height),
    orientation: box.trace.orientation,
    origo: box.trace.origo,
    // Both readings of the position, so a rect table can be checked against a `.gui` file without
    // guessing which frame a column is in: `canonicalPosition` is what the model uses,
    // `enginePosition` is what the emitted file carries (they differ in the sign of y for a
    // `lower_*` anchor - see src/lib/coords.mjs).
    canonicalPosition: { x: box.trace.position.x, y: box.trace.position.y },
    enginePosition: { x: box.trace.enginePosition?.x ?? 0, y: box.trace.enginePosition?.y ?? 0 },
    ySignFlipped: Boolean(box.trace.ySignFlipped),
    sizeFormula: box.trace.sizeFormula,
    sprite: spriteName ?? box.node?.background?.sprite ?? null,
    // Which piece of a COMPONENT this element is (`bar`, `bar-track`, `bar-fill`, `bar-label`), when
    // it came from one. A bar is expanded by `computeLayout` into ordinary containers and text
    // (src/lib/components.mjs), so without this the rect table shows three unexplained elements
    // where the caller declared one bar.
    ...(box.node?.component ? { component: box.node.component } : {}),
    // Measured text extent (`null` when the element carries no text or its key did not resolve).
    text: measurement
      ? {
          key: measurement.key,
          font: measurement.font,
          method: measurement.method,
          exact: measurement.exact,
          width: measurement.width,
          height: measurement.height,
          lineCount: measurement.lineCount,
          maxWidth: measurement.maxWidth,
          maxHeight: measurement.maxHeight,
          fits: measurement.fitsWidth && measurement.fitsHeight,
          overflowX: measurement.overflowX,
          overflowY: measurement.overflowY,
        }
      : null,
  };
}

/**
 * B10: the rect table in a machine-readable form.
 *
 * `gui_layout_get` returns the table as JSON, and the SVG can carry it, but a reviewer wants a
 * CSV to diff or paste into a spreadsheet, and a markdown table to drop into a report. Both come
 * from the same rows, so neither can drift from what the preview drew.
 */
export function rectTableCsv(table) {
  const header = [
    'path', 'name', 'kind', 'x', 'y', 'width', 'height', 'orientation', 'origo', 'sprite',
    'width_formula', 'height_formula',
    // The measured text extent, so a spreadsheet can sort by "which text overflows".
    'text_key', 'text_font', 'text_method', 'text_exact', 'text_width', 'text_height', 'text_lines',
    'text_max_width', 'text_max_height', 'text_fits', 'text_overflow_x', 'text_overflow_y',
  ];
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = table.map((row) =>
    [
      row.path,
      row.name,
      row.kind,
      row.x,
      row.y,
      row.width,
      row.height,
      row.orientation,
      row.origo,
      row.sprite,
      row.sizeFormula?.width,
      row.sizeFormula?.height,
      row.text?.key,
      row.text?.font,
      row.text?.method,
      row.text?.exact,
      row.text?.width,
      row.text?.height,
      row.text?.lineCount,
      row.text?.maxWidth,
      row.text?.maxHeight,
      row.text?.fits,
      row.text?.overflowX,
      row.text?.overflowY,
    ]
      .map(escape)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n') + '\n';
}

/** The same rows as a markdown table, for a report or a PR description. */
export function rectTableMarkdown(table, options = {}) {
  const title = options.title ?? 'Rect table';
  const base = options.baseResolution ?? BASE_RESOLUTION;
  // `text` is the MEASURED extent (src/lib/font-metrics.mjs), or `-` when the element carries no
  // text or its localisation key did not resolve. Keeping it in the same table as the box is the
  // point: the two numbers side by side are what shows an element whose box is huge and whose
  // text is three characters.
  const lines = [
    `### ${title} (base ${base.width}x${base.height})`,
    '',
    '| element | kind | x | y | box w | box h | text measured w x h | lines | text font | fits box | sprite |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const limit = options.limit ?? table.length;
  for (const row of table.slice(0, limit)) {
    const measured = row.text ? `${row.text.width} x ${row.text.height}` : '-';
    const fits = row.text ? (row.text.fits ? 'yes' : `NO (+${row.text.overflowX}x+${row.text.overflowY})`) : '-';
    lines.push(
      `| \`${row.path}\` | ${row.kind} | ${row.x} | ${row.y} | ${row.width} | ${row.height} | ${measured} | ` +
        `${row.text?.lineCount ?? '-'} | ${row.text ? `\`${row.text.font}\`` : '-'} | ${fits} | ` +
        `${row.sprite ? `\`${row.sprite}\`` : ''} |`,
    );
  }
  if (table.length > limit) lines.push(`| _${table.length - limit} more_ | | | | | | | | | | |`);
  return lines.join('\n') + '\n';
}

/**
 * Render a layout to PNG by rasterising the rects ourselves.
 *
 * Deliberately simple: filled rectangles, 1px borders and a coarse colour per kind. No text
 * rasterisation - a full font engine is not worth a dependency, and the SVG carries the
 * labels. The PNG exists so a caller that can only consume raster images (or an agent that
 * wants a quick thumbnail) gets something.
 */
export function renderPng(layout, options = {}) {
  const assets = options.assets ?? null;
  const base = layout.baseResolution ?? BASE_RESOLUTION;
  const width = Math.max(1, Math.round(options.width ?? base.width ?? BASE_RESOLUTION.width));
  const height = Math.max(1, Math.round(options.height ?? base.height ?? BASE_RESOLUTION.height));
  const scale = options.scale ?? 1;
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const cache = options.cache ?? defaultThumbnailCache();
  const gameRoot = options.gameRoot ? resolveGameRoot(options.gameRoot) : assets?.root ?? null;
  const thumbnails = options.thumbnails !== false;

  const { boxes } = computeLayout(layout, {
    baseWidth: width,
    baseHeight: height,
    spriteLookup: options.spriteLookup ?? spriteLookupFor(assets),
  });
  const buffer = new Uint8ClampedArray(outWidth * outHeight * 4);
  // Dark background.
  for (let index = 0; index < buffer.length; index += 4) {
    buffer[index] = 0x12;
    buffer[index + 1] = 0x16;
    buffer[index + 2] = 0x1c;
    buffer[index + 3] = 255;
  }

  const textureStats = { requested: 0, blitted: 0, placeholder: 0, sliced: 0 };

  /**
   * Blit a sub-rectangle of a decoded thumbnail into an output rectangle, nearest-neighbour.
   * `source` is in the thumbnail's own pixels; the target is in OUTPUT pixels.
   */
  const blitSlice = (entry, source, x, y, w, h) => {
    if (!entry?.ok) return false;
    const sourceWidth = entry.width;
    const sourceHeight = entry.height;
    for (let ty = 0; ty < h; ty += 1) {
      const sy = Math.min(sourceHeight - 1, Math.floor(source.y + (ty / h) * source.height));
      const py = Math.round(y + ty);
      if (py < 0 || py >= outHeight) continue;
      for (let tx = 0; tx < w; tx += 1) {
        const sx = Math.min(sourceWidth - 1, Math.floor(source.x + (tx / w) * source.width));
        const px = Math.round(x + tx);
        if (px < 0 || px >= outWidth) continue;
        const from = (sy * sourceWidth + sx) * 4;
        const to = (py * outWidth + px) * 4;
        const alpha = entry.rgba ? entry.rgba[from + 3] / 255 : 1;
        if (entry.rgba) {
          buffer[to] = entry.rgba[from] * alpha + buffer[to] * (1 - alpha);
          buffer[to + 1] = entry.rgba[from + 1] * alpha + buffer[to + 1] * (1 - alpha);
          buffer[to + 2] = entry.rgba[from + 2] * alpha + buffer[to + 2] * (1 - alpha);
          buffer[to + 3] = 255;
        }
      }
    }
    return true;
  };

  const fillRect = (x, y, w, h, rgb, alpha = 1) => {
    for (let py = Math.max(0, Math.round(y)); py < Math.min(outHeight, Math.round(y + h)); py += 1) {
      for (let px = Math.max(0, Math.round(x)); px < Math.min(outWidth, Math.round(x + w)); px += 1) {
        const to = (py * outWidth + px) * 4;
        buffer[to] = buffer[to] * (1 - alpha) + rgb[0] * alpha;
        buffer[to + 1] = buffer[to + 1] * (1 - alpha) + rgb[1] * alpha;
        buffer[to + 2] = buffer[to + 2] * (1 - alpha) + rgb[2] * alpha;
      }
    }
  };

  for (const box of boxes) {
    const rect = box.rect;
    if (rect.width <= 0 || rect.height <= 0) continue;
    const colour = boxColour(box);
    const rgb = hexToRgb(colour.stroke);
    fillRect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale, rgb, 0.14);
    // 1px border.
    fillRect(rect.x * scale, rect.y * scale, rect.width * scale, Math.max(1, scale), rgb, 0.9);
    fillRect(rect.x * scale, (rect.y + rect.height) * scale - Math.max(1, scale), rect.width * scale, Math.max(1, scale), rgb, 0.9);
    fillRect(rect.x * scale, rect.y * scale, Math.max(1, scale), rect.height * scale, rgb, 0.9);
    fillRect((rect.x + rect.width) * scale - Math.max(1, scale), rect.y * scale, Math.max(1, scale), rect.height * scale, rgb, 0.9);

    if (!thumbnails || !assets) continue;
    const spriteName = box.node?.background?.sprite ?? box.node?.quadTextureSprite ?? box.node?.spriteType;
    if (!spriteName) continue;
    textureStats.requested += 1;
    const record = assets.sprites[spriteName];
    const texturePath = textureAbsolutePath(gameRoot, record?.textureFile);
    if (!texturePath) {
      textureStats.placeholder += 1;
      continue;
    }
    // The PNG renderer needs raw pixels, which is exactly what the shared cache holds.
    const entry = cache.get(texturePath, Math.max(32, Math.min(256, Math.round(Math.max(rect.width, rect.height) * scale))));
    if (!entry.ok) {
      textureStats.placeholder += 1;
      continue;
    }
    // The same 9-slice the SVG gets, so the raster and the vector preview agree about chrome.
    const imageWidth = entry.sourceWidth ?? entry.width;
    const imageHeight = entry.sourceHeight ?? entry.height;
    // FRAME 0 ONLY, exactly as in the SVG path: a `noOfFrames = 3` strip is three button states,
    // and the engine draws one of them.
    const frames = Math.max(1, record?.frameCount ?? 1);
    const frameWidth = imageWidth / frames;
    const nine = nineSliceFor(
      { x: 0, y: 0, width: rect.width, height: rect.height },
      record,
      { width: frameWidth, height: imageHeight },
      assets.textures[record?.textureFile ?? ''] ?? null,
    );
    if (nine) {
      const factorX = entry.width / imageWidth;
      const factorY = entry.height / imageHeight;
      let drawn = 0;
      for (const slice of nine.slices) {
        const ok = blitSlice(
          entry,
          {
            x: slice.source.x * factorX,
            y: slice.source.y * factorY,
            width: slice.source.width * factorX,
            height: slice.source.height * factorY,
          },
          (rect.x + slice.target.x) * scale,
          (rect.y + slice.target.y) * scale,
          slice.target.width * scale,
          slice.target.height * scale,
        );
        if (ok) drawn += 1;
      }
      if (drawn > 0) textureStats.sliced += 1;
      else textureStats.placeholder += 1;
      continue;
    }
    if (
      blitSlice(
        entry,
        { x: 0, y: 0, width: frameWidth * (entry.width / imageWidth), height: entry.height },
        rect.x * scale,
        rect.y * scale,
        rect.width * scale,
        rect.height * scale,
      )
    ) {
      textureStats.blitted += 1;
    } else {
      textureStats.placeholder += 1;
    }
  }

  return {
    png: encodePng(buffer, outWidth, outHeight, { level: options.level ?? 9 }),
    width: outWidth,
    height: outHeight,
    stats: { elementCount: boxes.length, baseResolution: { width, height }, textureStats, chromeApproximate: true, chromeNote: CHROME_NOTE },
  };
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/** Write a preview to disk. Returns the paths and stats. */
export function writePreview(layout, outputDirectory, options = {}) {
  ensureDir(outputDirectory);
  const svgResult = renderSvg(layout, options);
  const svgPath = join(outputDirectory, options.svgName ?? 'preview.svg');
  writeFileSync(svgPath, svgResult.svg, 'utf8');
  const written = { svg: svgPath, stats: svgResult.stats };

  if (options.png !== false) {
    const pngResult = renderPng(layout, options);
    const pngPath = join(outputDirectory, options.pngName ?? 'preview.png');
    writeFileSync(pngPath, pngResult.png);
    written.png = pngPath;
    written.pngSize = pngResult.png.length;
    written.pngDimensions = { width: pngResult.width, height: pngResult.height };
  }
  return written;
}

export { mkdirSync, readFileSync, relativeKey, BASE_RESOLUTION };
