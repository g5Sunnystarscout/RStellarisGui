//------------------------------------------------------------------------------------
// png.mjs -- Part of RStellarisGui
//
// A minimal PNG writer, raw RGBA -> PNG, using only Node's built-in `zlib`.
//
// Why not vendor a library: PNG's container is three chunks and a CRC, and `zlib.deflateSync`
// is already a conforming DEFLATE stream, so this is ~60 lines and keeps the project at zero
// runtime dependencies. The format details (signature, IHDR/IDAT/IEND, per-scanline filter
// bytes, CRC-32 over chunk type+data) are the documented PNG specification; see
// docs/sources.md. Filter type 0 (None) is used for every scanline - the images here are UI
// rectangles and thumbnails, where filter choice is not worth the complexity.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Encode raw RGBA bytes as a PNG.
 *
 * @param {Uint8Array|Uint8ClampedArray|Buffer} rgba tightly packed RGBA, 4 bytes per pixel
 * @param {number} width
 * @param {number} height
 * @param {{level?: number}} [options] zlib level, 0-9
 * @returns {Buffer}
 */
export function encodePng(rgba, width, height, options = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid PNG dimensions ${width}x${height}`);
  }
  const expected = width * height * 4;
  if (rgba.length < expected) {
    throw new Error(`RGBA buffer holds ${rgba.length} bytes, expected ${expected} for ${width}x${height}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with its filter type byte (0 = None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let index = 0; index < stride; index += 1) {
      raw[y * (stride + 1) + 1 + index] = rgba[y * stride + index];
    }
  }

  const level = options.level ?? 9;
  const compressed = deflateSync(raw, { level });

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Resize RGBA with a box filter (nearest-sample averaging).
 *
 * Downscales and upscales; used to bring a decoded mip level to the requested thumbnail box.
 */
export function resizeRgba(rgba, width, height, targetWidth, targetHeight) {
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const y0 = Math.min(height - 1, Math.floor(y * scaleY));
    const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil((y + 1) * scaleY)));
    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = Math.min(width - 1, Math.floor(x * scaleX));
      const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil((x + 1) * scaleX)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const at = (sy * width + sx) * 4;
          r += rgba[at];
          g += rgba[at + 1];
          b += rgba[at + 2];
          a += rgba[at + 3];
          count += 1;
        }
      }
      const target = (y * targetWidth + x) * 4;
      if (count === 0) continue;
      out[target] = Math.round(r / count);
      out[target + 1] = Math.round(g / count);
      out[target + 2] = Math.round(b / count);
      out[target + 3] = Math.round(a / count);
    }
  }
  return out;
}

/** Parse the IHDR of a PNG buffer. Used by the selftest to prove the writer round-trips. */
export function readPngHeader(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ok: false, reason: 'not a PNG' };
  }
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') return { ok: false, reason: 'first chunk is not IHDR' };
  return {
    ok: true,
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colourType: buffer[25],
    compression: buffer[26],
    filter: buffer[27],
    interlace: buffer[28],
  };
}

/** The four channels each PNG colour type carries. */
const CHANNELS_BY_COLOUR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Iterate a PNG's chunks as `{type, data}`. */
function* pngChunks(buffer) {
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) return;
    yield { type, data: buffer.subarray(dataStart, dataEnd) };
    if (type === 'IEND') return;
    offset = dataEnd + 4; // skip the CRC
  }
}

/**
 * Decode a PNG to raw RGBA.
 *
 * Needed because vanilla `.gfx` files do reference PNG textures - four of them in the 4.4.6
 * interface tree (`gfx/interface/main/*.png`), declared through `spriteType` exactly like a
 * DDS. Without this those four textures could only ever render as a labelled placeholder.
 *
 * Supported: 8-bit greyscale, RGB, greyscale+alpha and RGBA, plus 8-bit palette with tRNS
 * (the four shipped files are all 8-bit RGBA, colour type 6, non-interlaced, which the header
 * dump in docs/sources.md records). Not supported: 1/2/4/16-bit depths, interlacing, and
 * palette entries below 8 bits - each is refused by name rather than decoded wrongly.
 *
 * @returns {{ok: true, width, height, rgba}|{ok: false, reason}}
 */
export function decodePng(buffer) {
  const header = readPngHeader(buffer);
  if (!header.ok) return header;
  if (header.interlace !== 0) return { ok: false, reason: 'interlaced PNG is not supported' };
  if (header.bitDepth !== 8) return { ok: false, reason: `unsupported bit depth ${header.bitDepth}` };
  const channels = CHANNELS_BY_COLOUR_TYPE[header.colourType];
  if (!channels) return { ok: false, reason: `unsupported colour type ${header.colourType}` };

  let palette = null;
  let transparency = null;
  const idatParts = [];
  for (const chunk of pngChunks(buffer)) {
    if (chunk.type === 'IDAT') idatParts.push(chunk.data);
    else if (chunk.type === 'PLTE') palette = Buffer.from(chunk.data);
    else if (chunk.type === 'tRNS') transparency = Buffer.from(chunk.data);
  }
  if (idatParts.length === 0) return { ok: false, reason: 'no IDAT chunk' };
  if (header.colourType === 3 && !palette) return { ok: false, reason: 'palette image with no PLTE chunk' };

  let raw;
  try {
    raw = inflateSync(Buffer.concat(idatParts));
  } catch (thrown) {
    return { ok: false, reason: `inflate failed: ${thrown.message}` };
  }

  const { width, height } = header;
  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (raw.length < expected) {
    return { ok: false, reason: `IDAT holds ${raw.length} bytes, expected ${expected}` };
  }

  // Undo the per-scanline filters. Each scanline is prefixed with its filter type byte and is
  // reconstructed against the previous reconstructed scanline and the current one.
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const rowStart = y * stride;
    const priorStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[from + x];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const above = y > 0 ? pixels[priorStart + x] : 0;
      const aboveLeft = y > 0 && x >= channels ? pixels[priorStart + x - channels] : 0;
      let result;
      switch (filterType) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + above;
          break;
        case 3:
          result = value + ((left + above) >> 1);
          break;
        case 4:
          result = value + paeth(left, above, aboveLeft);
          break;
        default:
          return { ok: false, reason: `unknown scanline filter ${filterType} on row ${y}` };
      }
      pixels[rowStart + x] = result & 0xff;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const at = index * channels;
    const out = index * 4;
    switch (header.colourType) {
      case 0:
        rgba[out] = rgba[out + 1] = rgba[out + 2] = pixels[at];
        rgba[out + 3] = 255;
        break;
      case 4:
        rgba[out] = rgba[out + 1] = rgba[out + 2] = pixels[at];
        rgba[out + 3] = pixels[at + 1];
        break;
      case 2:
        rgba[out] = pixels[at];
        rgba[out + 1] = pixels[at + 1];
        rgba[out + 2] = pixels[at + 2];
        rgba[out + 3] = 255;
        break;
      case 6:
        rgba[out] = pixels[at];
        rgba[out + 1] = pixels[at + 1];
        rgba[out + 2] = pixels[at + 2];
        rgba[out + 3] = pixels[at + 3];
        break;
      case 3: {
        const entry = pixels[at] * 3;
        rgba[out] = palette[entry];
        rgba[out + 1] = palette[entry + 1];
        rgba[out + 2] = palette[entry + 2];
        rgba[out + 3] = transparency && pixels[at] < transparency.length ? transparency[pixels[at]] : 255;
        break;
      }
      default:
        break;
    }
  }

  return { ok: true, width, height, rgba, source: 'png' };
}

/** The Paeth predictor from the PNG specification. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export default { encodePng, decodePng, resizeRgba, readPngHeader, crc32 };
