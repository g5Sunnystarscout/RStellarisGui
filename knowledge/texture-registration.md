---
id: texture-registration
category: tooling
title: Texture registration - the formats the install ships, and the inline-icon name
title_zh: 贴图注册——安装目录里实际存在的格式，以及内联图标命名
summary: The install's 21305 texture files contain exactly BC1, BC2, BC3 and 16/24/32-bit uncompressed - zero BC7 and zero DX10 headers - which is why a ~120-line DDS decoder is sufficient and an unsupported FourCC can be refused by name. Four vanilla textures are PNG, not DDS, so a PNG reader is needed too.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.dds, .png, .tga, .gfx]
tags: [dds, png, tga, BC1, BC2, BC3, DXT1, DXT3, DXT5, dx10, fourCC, spriteType, corneredTileSpriteType, mip, alpha, texture]
related: [inline-icon-token-rule, transparency-white-plate]
sources: [<Stellaris>/interface/core.gfx]
---

## What it is

This plugin decodes real textures so the preview can show them, and refuses rather than guesses when a
format is outside what it implements. The scope of the decoder is a MEASUREMENT of the install, not a
guess about what DDS can contain.

## Syntax

```
# The .gfx block kinds that name a texture, and the fields each accepts:
spriteType = {                    # a fixed sprite. No `size`, no `borderSize`.
	name = "GFX_my_icon"
	textureFile = "gfx/interface/icons/my_icon.dds"      # `texturefile` also occurs in vanilla
}

corneredTileSpriteType = {        # a 9-slice. Takes `size` AND `borderSize`.
	name = "gfx_transparency_white"
	size = { x = 3 y = 3 }
	textureFile = "gfx/interface/transp_white.dds"
	borderSize = { x = 1 y = 1 }
}

frameAnimatedSpriteType = {       # the only kind that takes `noOfFrames`
	name = "GFX_animated"
	textureFile = "gfx/interface/sheet.dds"
	noOfFrames = 8
}

# The install's own two sprites this project's bar construction depends on:
#   GFX_tiles_dark_area_cut_8   corneredTileSpriteType, borderSize = { x=8 y=8 }, with an effectFile
#   gfx_transparency_white      corneredTileSpriteType, size 3x3, borderSize = { x=1 y=1 }
```

## What the install actually contains

* **0 BC7 and 0 DX10 headers** across **21305** texture files. The decoded formats are exactly BC1
  (DXT1), BC2 (DXT3), BC3 (DXT5) and 16/24/32-bit uncompressed. BC1/2/3 plus uncompressed is ~120
  lines of documented bit arithmetic (`src/lib/dds.mjs`).
* An unsupported FourCC is **refused by name** rather than decoded wrongly.
* **Four vanilla textures are PNG, not DDS.** That was a correction the install forced on the project,
  and it is why `src/lib/png.mjs` has a reader as well as a writer.
* A **4096×4096 BC3** file decodes its 128×128 mip from the chain, which is the thumbnail path: the
  preview decodes a small mip rather than 16M pixels.
* `.tga` files are also present and accepted.

## Alpha is not what the header says

Vanilla ships 32-bit BGRA files whose alpha bytes are **all zero** while the pixel format advertises
`DDPF_ALPHAPIXELS` — confirmed on `gfx/interface/removed.dds`, `gfx/interface/buttons/close_button.dds`
and `gfx/interface/tiles/tile_large_bg.dds`. A preview that trusted the flag would draw every one of
them fully transparent and the tool would look broken.

`src/lib/dds.mjs` therefore classifies alpha by SAMPLING (at most 512 pixels) into
`all-zero` / `all-opaque` / `varies`, and treats an unused alpha channel as opaque rather than
invisible. This is also how `gfx_transparency_white` was found to be a white wash rather than a hole —
see the `transparency-white-plate` topic.

## Evidence

- `measured`: **0 BC7, 0 DX10** across **21305** texture files; BC1/BC2/BC3 plus uncompressed is the whole set. `README.md:468-474`.
- `vanilla`: **four** vanilla textures are PNG rather than DDS — `docs/sources.md` §4 correction 4. `README.md:476-477`.
- `measured`: a 4096×4096 BC3 decodes its 128×128 mip from the chain, verified against the real file. `README.md:471-473`.
- `vanilla`: alpha bytes all zero while `DDPF_ALPHAPIXELS` is advertised, confirmed on `gfx/interface/removed.dds`, `gfx/interface/buttons/close_button.dds`, `gfx/interface/tiles/tile_large_bg.dds`. `src/lib/dds.mjs:462-469`.
- `measured`: `gfx/interface/transp_white.dds` is a 192-byte 8x8 BC3 file with ONE distinct pixel value, `RGBA(255,255,255,84)` — measured with this plugin's own decoder.
- `vanilla`: `interface/core.gfx` is where both bar sprites are declared, and `interface/fleet_view.gfx:2824-2830` is where the dark tile's `borderSize = { x=8 y=8 }` and its `effectFile` live.
- `measured`: the MCP surface exposes the measured facts rather than only the code — `gui_assets_sprite_info` returns a sprite's defining block kind, texture path, real pixel size, format, mip count and the `file:line` that defines it; `gui_assets_refresh` reports build time, per-stage timings, index size and the texture-format census.

## Rules

- Write a texture reference with the kind's own fields: a plain `spriteType` has NO `size` and NO `borderSize`; a `corneredTileSpriteType` has both; only a `frameAnimatedSpriteType` takes `noOfFrames`.
- `progressBarType` (and its two other accepted spellings) uses `textureFile1` / `textureFile2`, not `texturefile`.
- Both `texturefile` and `textureFile` spellings are accepted by the engine, and both occur in the same vanilla file. Do not "fix" one into the other.
- An inline text icon's sprite must be named `GFX_text_<token>` — see the `inline-icon-token-rule` topic; the two rules are separate and both are required.
- Do not trust a DDS header's alpha flag. Sample the pixels.
- Refuse an unsupported format by name. A preview that silently draws a placeholder for BC7 would hide the fact that the texture cannot be read.
- Check the sprite's real pixel size with `gui_assets_sprite_info` before sizing an element around it; a fixed `spriteType` resized away from its natural size is reported as `fixed-size-sprite-resized` (info).

## 待确认

- Whether the engine accepts a `.tga` for EVERY sprite kind or only some. `.tga` files are present in the install and accepted by the index; the per-kind question was not measured.
- The exact 9-slice behaviour for a `borderSize` larger than the sprite's own declared `size`. `gfx_transparency_white` declares 3x3 with `borderSize = { x=1 y=1 }` and its texture is 8x8, which is normal for a cornered tile but is not itself measured.
