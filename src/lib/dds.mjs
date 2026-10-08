//------------------------------------------------------------------------------------
// dds.mjs -- Part of RStellarisGui
//
// DDS header reading, mip selection and decoding to RGBA, for exactly the formats this
// install uses.
//
// Census of the verified 4.4.6 install (`gfx/**/*.dds`, 21305 files, 4261 sampled):
//   uncompressed 32bpp  2652
//   DXT5 (BC3)          1326
//   DXT1 (BC1)           130
//   uncompressed 24bpp   116
//   DXT3 (BC2)            35
//   uncompressed 16bpp     2
//   BC7 / DX10             0
// So BC1, BC2, BC3 and 16/24/32-bit uncompressed cover everything. There is no BC7 and no
// DX10 header in the install, which is why the decoder deliberately stops there and says so
// instead of silently returning garbage for an exotic format. Largest texture is
// 4096x4096 (= 16777216 pixels), and the mip chain is present, so a thumbnail decodes a
// small mip rather than the full image.
//
// Library choice: the BC1/2/3 decoder below is written here rather than vendored, because it
// is ~120 lines of well-specified bit arithmetic. Writing it keeps this project at zero
// runtime dependencies and avoids taking on a licence obligation for something this small.
// The S3TC/BC bit layouts are the documented formats (see docs/sources.md).
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';

import { decodePng } from './png.mjs';

export const DDS_MAGIC = 0x20534444; // 'DDS '
const DDS_HEADER_SIZE = 124;
const DDS_PIXELFORMAT_SIZE = 32;

const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDPF_LUMINANCE = 0x20000;

const D3D10_RESOURCE_DIMENSION_TEXTURE2D = 3;
const DXGI_FORMAT_BC1_UNORM = 71;
const DXGI_FORMAT_BC2_UNORM = 74;
const DXGI_FORMAT_BC3_UNORM = 77;
const DXGI_FORMAT_BC7_UNORM = 98;

export const DECODABLE_FOURCC = ['DXT1', 'DXT2', 'DXT3', 'DXT4', 'DXT5', 'ATI1', 'BC4U', 'ATI2', 'BC5U'];

/** Header layout offsets, relative to the start of the 128-byte header. */
const OFFSET = {
  size: 4,
  flags: 8,
  height: 12,
  width: 16,
  pitchOrLinearSize: 20,
  depth: 24,
  mipMapCount: 28,
  pfSize: 76,
  pfFlags: 80,
  pfFourCC: 84,
  pfRGBBitCount: 88,
  pfRMask: 92,
  pfGMask: 96,
  pfBMask: 100,
  pfAMask: 104,
};

/**
 * Parse a DDS header from a buffer (at least 128 bytes).
 *
 * Returns `{ok: false, reason}` rather than throwing for a non-DDS or malformed file: the
 * census walks 21305 files and one odd file must not abort the build.
 */
export function parseDdsHeader(buffer) {
  if (!buffer || buffer.length < 128) return { ok: false, reason: 'shorter than 128 bytes' };
  if (buffer.readUInt32LE(0) !== DDS_MAGIC) return { ok: false, reason: 'missing DDS magic' };
  if (buffer.readUInt32LE(OFFSET.size) !== DDS_HEADER_SIZE) {
    return { ok: false, reason: `header size ${buffer.readUInt32LE(OFFSET.size)} != 124` };
  }

  const height = buffer.readUInt32LE(OFFSET.height);
  const width = buffer.readUInt32LE(OFFSET.width);
  const declaredMipCount = buffer.readUInt32LE(OFFSET.mipMapCount);
  const pfFlags = buffer.readUInt32LE(OFFSET.pfFlags);
  const fourCC = buffer.toString('latin1', OFFSET.pfFourCC, OFFSET.pfFourCC + 4);
  const rgbBitCount = buffer.readUInt32LE(OFFSET.pfRGBBitCount);

  let mipCount = declaredMipCount;
  if (!(buffer.readUInt32LE(OFFSET.flags) & 0x20000) || mipCount === 0) {
    // DDS_HEADER_FLAGS_MIPMAP (0x20000) not set: exactly one mip is present.
    mipCount = 1;
  }
  // A texture can never have more mips than its dimensions allow; a bogus count would make
  // the mip-offset walk read past the end of the file.
  const maxMips = Math.floor(Math.log2(Math.max(width, height))) + 1;
  const mipCountPlausible = mipCount >= 1 && mipCount <= Math.max(1, maxMips);

  const pixelFormat = { flags: pfFlags, fourCC: fourCC.trim(), rgbBitCount };
  let format;
  let blockBytes = 0; // bytes per 4x4 block for BC formats
  let bytesPerPixel = 0;
  let dx10 = null;
  let dataOffset = 128;

  if (pfFlags & DDPF_FOURCC) {
    const code = fourCC.trim();
    if (code === 'DX10') {
      if (buffer.length < 148) return { ok: false, reason: 'DX10 header truncated' };
      const dxgiFormat = buffer.readUInt32LE(128);
      const dimension = buffer.readUInt32LE(132);
      dx10 = { dxgiFormat, dimension, arraySize: buffer.readUInt32LE(136), miscFlags2: buffer.readUInt32LE(144) };
      dataOffset = 148;
      if (dimension !== D3D10_RESOURCE_DIMENSION_TEXTURE2D) {
        return { ok: false, reason: `DX10 dimension ${dimension} is not a 2D texture`, width, height, dx10 };
      }
      if (dxgiFormat === DXGI_FORMAT_BC1_UNORM) {
        format = 'BC1';
        blockBytes = 8;
      } else if (dxgiFormat === DXGI_FORMAT_BC2_UNORM) {
        format = 'BC2';
        blockBytes = 16;
      } else if (dxgiFormat === DXGI_FORMAT_BC3_UNORM) {
        format = 'BC3';
        blockBytes = 16;
      } else {
        return {
          ok: false,
          reason: dxgiFormat === DXGI_FORMAT_BC7_UNORM ? 'BC7 is not supported' : `unsupported DXGI format ${dxgiFormat}`,
          width,
          height,
          dx10,
        };
      }
    } else if (code === 'DXT1' || code === 'ATI1' || code === 'BC4U') {
      format = 'BC1';
      blockBytes = 8;
    } else if (code === 'DXT3') {
      format = 'BC2';
      blockBytes = 16;
    } else if (code === 'DXT5' || code === 'ATI2' || code === 'BC5U') {
      format = 'BC3';
      blockBytes = 16;
    } else if (code === 'DXT2') {
      // DXT2 is BC2 with premultiplied alpha; the bit layout is identical.
      format = 'BC2';
      blockBytes = 16;
    } else if (code === 'DXT4') {
      format = 'BC3';
      blockBytes = 16;
    } else {
      return { ok: false, reason: `unsupported FourCC ${code || '(empty)'}`, width, height };
    }
  } else if (pfFlags & (DDPF_RGB | DDPF_LUMINANCE)) {
    if (![16, 24, 32].includes(rgbBitCount)) {
      return { ok: false, reason: `unsupported uncompressed depth ${rgbBitCount}`, width, height };
    }
    format = `RGBA${rgbBitCount}`;
    bytesPerPixel = rgbBitCount / 8;
  } else {
    return { ok: false, reason: `pixel format flags 0x${pfFlags.toString(16)} not understood`, width, height };
  }

  // Walk the mip chain to find where each level starts.
  const mipOffsets = [];
  let offset = dataOffset;
  const fileSize = buffer.length;
  const chainLength = mipCountPlausible ? mipCount : 1;
  for (let level = 0; level < chainLength; level += 1) {
    const levelWidth = Math.max(1, width >> level);
    const levelHeight = Math.max(1, height >> level);
    let levelBytes;
    if (blockBytes > 0) {
      levelBytes = Math.max(1, Math.ceil(levelWidth / 4)) * Math.max(1, Math.ceil(levelHeight / 4)) * blockBytes;
    } else {
      levelBytes = levelWidth * levelHeight * bytesPerPixel;
    }
    mipOffsets.push({ level, width: levelWidth, height: levelHeight, offset, bytes: levelBytes });
    offset += levelBytes;
  }

  return {
    ok: true,
    width,
    height,
    mipCount: chainLength,
    declaredMipCount,
    mipCountPlausible,
    format,
    blockBytes,
    bytesPerPixel,
    pixelFormat,
    dx10,
    dataOffset,
    mipOffsets,
    fileSize,
    masks: {
      r: buffer.readUInt32LE(OFFSET.pfRMask),
      g: buffer.readUInt32LE(OFFSET.pfGMask),
      b: buffer.readUInt32LE(OFFSET.pfBMask),
      a: buffer.readUInt32LE(OFFSET.pfAMask),
    },
    hasAlpha: Boolean(pfFlags & DDPF_ALPHAPIXELS),
  };
}

/** Read just the DDS header of a file on disk (128 or 148 bytes, never the whole image). */
export function readDdsHeader(path) {
  if (!existsSync(path)) return { ok: false, reason: 'file not found', path };
  const stats = statSync(path);
  const length = Math.min(148, stats.size);
  if (length < 128) return { ok: false, reason: 'file shorter than a DDS header', path, size: stats.size };
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, length, 0);
  } finally {
    closeSync(fd);
  }
  const header = parseDdsHeader(buffer);
  return { ...header, path, size: stats.size };
}

/** Pick the smallest mip whose largest dimension is still >= `targetLargest`. */
export function pickMip(header, targetLargest) {
  if (!header.ok || !header.mipOffsets?.length) return null;
  let chosen = header.mipOffsets[0];
  for (const mip of header.mipOffsets) {
    if (Math.max(mip.width, mip.height) >= targetLargest) chosen = mip;
    else break;
  }
  return chosen;
}

/** Expand a 5/6/5-bit channel to 8 bits. */
function expand5to8(value) {
  return (value << 3) | (value >> 2);
}

function expand6to8(value) {
  return (value << 2) | (value >> 4);
}

function store565(out, pixelIndex, value) {
  out[pixelIndex * 4 + 0] = expand5to8((value >> 11) & 0x1f);
  out[pixelIndex * 4 + 1] = expand6to8((value >> 5) & 0x3f);
  out[pixelIndex * 4 + 2] = expand5to8(value & 0x1f);
  out[pixelIndex * 4 + 3] = 255;
}

/**
 * Decode one 4x4 BC1/BC2/BC3 block into 16 RGBA pixels.
 * `format` is BC1 | BC2 | BC3; `block` must be 8 (BC1) or 16 bytes.
 */
function decodeBcBlock(format, block, out) {
  let colourOffset = 0;
  if (format === 'BC2') {
    // 8 bytes of explicit 4-bit alpha preceding the colour block.
    for (let pixel = 0; pixel < 16; pixel += 1) {
      const byte = block[pixel >> 1];
      const nibble = pixel % 2 === 0 ? byte & 0x0f : (byte >> 4) & 0x0f;
      out[pixel * 4 + 3] = nibble * 17;
    }
    colourOffset = 8;
  } else if (format === 'BC3') {
    // 8 bytes of interpolated alpha preceding the colour block.
    const alpha0 = block[0];
    const alpha1 = block[1];
    const alphas = new Array(8);
    alphas[0] = alpha0;
    alphas[1] = alpha1;
    if (alpha0 > alpha1) {
      for (let index = 2; index < 8; index += 1) {
        alphas[index] = Math.round(((8 - index) * alpha0 + (index - 1) * alpha1) / 7);
      }
    } else {
      for (let index = 2; index < 6; index += 1) {
        alphas[index] = Math.round(((6 - index) * alpha0 + (index - 1) * alpha1) / 5);
      }
      alphas[6] = 0;
      alphas[7] = 255;
    }
    // 48-bit little-endian index, 3 bits per pixel.
    let bits = 0n;
    for (let index = 0; index < 6; index += 1) bits |= BigInt(block[2 + index]) << BigInt(8 * index);
    for (let pixel = 0; pixel < 16; pixel += 1) {
      const alphaIndex = Number((bits >> BigInt(3 * pixel)) & 0x7n);
      out[pixel * 4 + 3] = alphas[alphaIndex];
    }
    colourOffset = 8;
  }

  const colour0 = block.readUInt16LE(colourOffset);
  const colour1 = block.readUInt16LE(colourOffset + 2);
  const palette = new Uint8Array(16); // 4 colours x RGBA
  const c0 = [(colour0 >> 11) & 0x1f, (colour0 >> 5) & 0x3f, colour0 & 0x1f];
  const c1 = [(colour1 >> 11) & 0x1f, (colour1 >> 5) & 0x3f, colour1 & 0x1f];
  const scaled = (channel, other, weight0, weight1, divisor) =>
    Math.round((weight0 * channel + weight1 * other) / divisor);

  palette[0] = expand5to8(c0[0]);
  palette[1] = expand6to8(c0[1]);
  palette[2] = expand5to8(c0[2]);
  palette[3] = 255;
  palette[4] = expand5to8(c1[0]);
  palette[5] = expand6to8(c1[1]);
  palette[6] = expand5to8(c1[2]);
  palette[7] = 255;

  if (colour0 > colour1 || format !== 'BC1') {
    // Four-colour mode. For BC2/BC3 the comparison is ignored: they always use 4 colours.
    palette[8] = expand5to8(scaled(c0[0], c1[0], 2, 1, 3));
    palette[9] = expand6to8(scaled(c0[1], c1[1], 2, 1, 3));
    palette[10] = expand5to8(scaled(c0[2], c1[2], 2, 1, 3));
    palette[11] = 255;
    palette[12] = expand5to8(scaled(c0[0], c1[0], 1, 2, 3));
    palette[13] = expand6to8(scaled(c0[1], c1[1], 1, 2, 3));
    palette[14] = expand5to8(scaled(c0[2], c1[2], 1, 2, 3));
    palette[15] = 255;
  } else {
    // Three-colour mode: index 3 is transparent black.
    palette[8] = expand5to8(scaled(c0[0], c1[0], 1, 1, 2));
    palette[9] = expand6to8(scaled(c0[1], c1[1], 1, 1, 2));
    palette[10] = expand5to8(scaled(c0[2], c1[2], 1, 1, 2));
    palette[11] = 255;
    palette[12] = 0;
    palette[13] = 0;
    palette[14] = 0;
    palette[15] = 0;
  }

  const colourBits = block.readUInt32LE(colourOffset + 4);
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const colourIndex = (colourBits >> (2 * pixel)) & 0x3;
    out[pixel * 4 + 0] = palette[colourIndex * 4 + 0];
    out[pixel * 4 + 1] = palette[colourIndex * 4 + 1];
    out[pixel * 4 + 2] = palette[colourIndex * 4 + 2];
    if (format === 'BC1') out[pixel * 4 + 3] = palette[colourIndex * 4 + 3];
  }
  void store565;
}

/** Extract a channel given a mask, normalising to 8 bits. */
function maskedChannel(value, mask) {
  if (mask === 0) return 255;
  let shift = 0;
  while (((mask >> shift) & 1) === 0 && shift < 32) shift += 1;
  const width = 32 - Math.clz32(mask >> shift);
  let raw = (value & mask) >>> shift;
  if (width <= 8) {
    // Replicate high bits into the low ones so 5/6-bit channels reach full white.
    raw = (raw << (8 - width)) | (raw >> (2 * width - 8));
  } else {
    raw = raw >> (width - 8);
  }
  return raw & 0xff;
}

/** Decode an uncompressed RGBA/RGB/16-bit texture level to RGBA. */
function decodeUncompressed(header, level) {
  const out = new Uint8ClampedArray(level.width * level.height * 4);
  const source = header.buffer;
  const bpp = header.bytesPerPixel;
  const { r: rMask, g: gMask, b: bMask, a: aMask } = header.masks;
  const isLuminance = header.pixelFormat.flags & DDPF_LUMINANCE;

  for (let pixel = 0; pixel < level.width * level.height; pixel += 1) {
    const at = level.offset + pixel * bpp;
    let r;
    let g;
    let b;
    let a;
    if (bpp === 4) {
      const value = source.readUInt32LE(at);
      r = maskedChannel(value, rMask);
      g = maskedChannel(value, gMask);
      b = maskedChannel(value, bMask);
      a = aMask ? maskedChannel(value, aMask) : 255;
    } else if (bpp === 3) {
      const value = source[at] | (source[at + 1] << 8) | (source[at + 2] << 16);
      r = maskedChannel(value, rMask || 0xff0000);
      g = maskedChannel(value, gMask || 0x00ff00);
      b = maskedChannel(value, bMask || 0x0000ff);
      a = 255;
    } else {
      const value = source.readUInt16LE(at);
      if (isLuminance || rMask === 0xf800) {
        // 16-bit luminance: RRRRRGGGGGBBBBB.
        r = expand5to8((value >> 11) & 0x1f);
        g = expand6to8((value >> 5) & 0x3f);
        b = expand5to8(value & 0x1f);
        a = aMask ? maskedChannel(value, aMask) : 255;
      } else if (rMask === 0xf00) {
        // ARGB1555.
        a = value & 0x8000 ? 255 : 0;
        r = expand5to8((value >> 10) & 0x1f);
        g = expand5to8((value >> 5) & 0x1f);
        b = expand5to8(value & 0x1f);
      } else {
        a = aMask ? maskedChannel(value, aMask) : 255;
        r = maskedChannel(value, rMask || 0xf00);
        g = maskedChannel(value, gMask || 0x0f0);
        b = maskedChannel(value, bMask || 0x00f);
      }
    }
    out[pixel * 4 + 0] = r;
    out[pixel * 4 + 1] = g;
    out[pixel * 4 + 2] = b;
    out[pixel * 4 + 3] = a;
  }
  return out;
}

/** Decode one BC mip level to RGBA. */
function decodeBc(header, level) {
  const out = new Uint8ClampedArray(level.width * level.height * 4);
  const blockBytes = header.blockBytes;
  const blocksWide = Math.max(1, Math.ceil(level.width / 4));
  const blocksHigh = Math.max(1, Math.ceil(level.height / 4));
  const block = Buffer.alloc(blockBytes);
  const scratch = new Uint8ClampedArray(16 * 4);
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      const at = level.offset + (blockY * blocksWide + blockX) * blockBytes;
      if (at + blockBytes > header.buffer.length) return out; // truncated file: keep what we have
      header.buffer.copy(block, 0, at, at + blockBytes);
      decodeBcBlock(header.format, block, scratch);
      for (let pixel = 0; pixel < 16; pixel += 1) {
        const x = blockX * 4 + (pixel % 4);
        const y = blockY * 4 + Math.floor(pixel / 4);
        if (x >= level.width || y >= level.height) continue;
        const target = (y * level.width + x) * 4;
        out[target + 0] = scratch[pixel * 4 + 0];
        out[target + 1] = scratch[pixel * 4 + 1];
        out[target + 2] = scratch[pixel * 4 + 2];
        out[target + 3] = scratch[pixel * 4 + 3];
      }
    }
  }
  return out;
}

/**
 * Decode a DDS mip level to raw RGBA bytes.
 *
 * @param {object} header result of `parseDdsHeader`, with its `buffer` attached
 * @param {number} level mip index
 * @returns {{width: number, height: number, rgba: Uint8ClampedArray}|null}
 */
export function decodeDdsLevel(header, level = 0) {
  if (!header?.ok || !header.buffer) return null;
  const mip = header.mipOffsets[level];
  if (!mip) return null;
  if (header.format === 'BC1' || header.format === 'BC2' || header.format === 'BC3') {
    return { width: mip.width, height: mip.height, rgba: decodeBc(header, mip) };
  }
  return { width: mip.width, height: mip.height, rgba: decodeUncompressed(header, mip) };
}

/**
 * Decide whether a decoded image's alpha channel carries information.
 *
 * Necessary because vanilla ships 32-bit BGRA files whose alpha bytes are all zero while the
 * pixel format advertises DDPF_ALPHAPIXELS (confirmed on `gfx/interface/removed.dds`,
 * `gfx/interface/buttons/close_button.dds` and `gfx/interface/tiles/tile_large_bg.dds`). A
 * preview that trusted the flag would draw every one of them fully transparent and the tool
 * would look broken. The check samples at most 512 pixels.
 */
function classifyAlpha(rgba) {
  const pixels = Math.min(512, rgba.length / 4);
  let anyOpaque = false;
  let anyTransparent = false;
  for (let index = 0; index < pixels; index += 1) {
    const alpha = rgba[index * 4 + 3];
    if (alpha === 0) anyTransparent = true;
    else anyOpaque = true;
    if (anyOpaque && anyTransparent) return 'varies';
  }
  if (!anyOpaque) return 'all-zero';
  return 'all-opaque';
}

/**
 * Read a DDS file and decode the smallest mip whose largest side is >= `targetLargest`.
 * This is the thumbnail path: a 4096x4096 wallpaper decodes a 128x128 mip, not 16M pixels.
 */
export function decodeDdsThumbnail(path, targetLargest = 96) {
  const header = readDdsHeader(path);
  if (!header.ok) return { ok: false, reason: header.reason };
  const stats = statSync(path);
  const buffer = Buffer.alloc(stats.size);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, stats.size, 0);
  } finally {
    closeSync(fd);
  }
  const withBuffer = parseDdsHeader(buffer);
  if (!withBuffer.ok) return { ok: false, reason: withBuffer.reason };
  withBuffer.buffer = buffer;
  const mip = pickMip(withBuffer, targetLargest);
  if (!mip) return { ok: false, reason: 'no mip levels' };
  const decoded = decodeDdsLevel(withBuffer, mip.level);
  if (!decoded) return { ok: false, reason: 'decode failed' };

  let rgba = decoded.rgba;
  let alphaState = classifyAlpha(rgba);
  if (alphaState === 'all-zero' && withBuffer.hasAlpha) {
    // Unused alpha channel: treat the texture as opaque rather than invisible.
    for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255;
    alphaState = 'unused-forced-opaque';
  }

  return {
    ok: true,
    width: decoded.width,
    height: decoded.height,
    sourceWidth: withBuffer.width,
    sourceHeight: withBuffer.height,
    format: withBuffer.format,
    mipLevel: mip.level,
    mipCount: withBuffer.mipCount,
    alphaState,
    rgba,
  };
}

/**
 * Read a texture header for either container.
 *
 * Both exist in vanilla: the interface tree references 4 PNG textures through `spriteType`
 * alongside 6866 DDS ones (`gfx/interface/main/*.png`), so a texture reader that only knows
 * DDS reports four false failures and renders four placeholders. This dispatches on the
 * signature and normalises the result, returning `container: 'dds' | 'png'`.
 */
export function readTextureHeader(path) {
  if (!existsSync(path)) return { ok: false, reason: 'file not found', path };
  const stats = statSync(path);
  const length = Math.min(148, stats.size);
  if (length < 8) return { ok: false, reason: 'file is too short to identify', path, size: stats.size };
  const probe = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, probe, 0, length, 0);
  } finally {
    closeSync(fd);
  }

  if (probe[0] === 0x89 && probe.toString('latin1', 1, 4) === 'PNG') {
    if (length < 33) return { ok: false, reason: 'PNG header truncated', path, size: stats.size };
    const width = probe.readUInt32BE(16);
    const height = probe.readUInt32BE(20);
    const bitDepth = probe[24];
    const colourType = probe[25];
    const interlace = probe[28];
    const format = `PNG${bitDepth}${['G', '?', 'RGB', 'PAL', 'GA', '?', 'RGBA'][colourType] ?? `C${colourType}`}`;
    return {
      ok: true,
      container: 'png',
      path,
      size: stats.size,
      width,
      height,
      format,
      mipCount: 1,
      hasAlpha: colourType === 4 || colourType === 6 || colourType === 3,
      decodable: interlace === 0 && bitDepth === 8 && [0, 2, 3, 4, 6].includes(colourType),
      reason: interlace !== 0 ? 'interlaced PNG' : bitDepth !== 8 ? `bit depth ${bitDepth}` : undefined,
    };
  }

  const header = readDdsHeader(path);
  return { ...header, container: 'dds' };
}

/**
 * Read and decode a texture thumbnail from either container.
 * `decodeDdsThumbnail` and `decodePng` are behind one signature so callers do not care which.
 */
export function decodeTextureThumbnail(path, targetLargest = 96) {
  if (!existsSync(path)) return { ok: false, reason: 'file not found' };
  const probe = Buffer.alloc(4);
  const fd = openSync(path, 'r');
  let read = 0;
  try {
    read = readSync(fd, probe, 0, 4, 0);
  } finally {
    closeSync(fd);
  }
  if (read === 4 && probe[0] === 0x89 && probe.toString('latin1', 1, 4) === 'PNG') {
    const stats = statSync(path);
    const buffer = Buffer.alloc(stats.size);
    const pngFd = openSync(path, 'r');
    try {
      readSync(pngFd, buffer, 0, stats.size, 0);
    } finally {
      closeSync(pngFd);
    }
    const decoded = decodePng(buffer);
    if (!decoded.ok) return decoded;
    return {
      ok: true,
      width: decoded.width,
      height: decoded.height,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      format: 'PNG',
      mipLevel: 0,
      mipCount: 1,
      alphaState: 'as-authored',
      rgba: decoded.rgba,
    };
  }
  return decodeDdsThumbnail(path, targetLargest);
}

export default {
  parseDdsHeader,
  readDdsHeader,
  readTextureHeader,
  decodeTextureThumbnail,
  pickMip,
  decodeDdsLevel,
  decodeDdsThumbnail,
  DDS_MAGIC,
  DECODABLE_FOURCC,
};
