---
id: inline-icon-token-rule
category: script
title: An inline £token£ icon is looked up as GFX_text_ + token, with no plain GFX_ fallback
title_zh: 内联 £token£ 图标的查找名是 GFX_text_ + token，没有普通 GFX_ 回退
summary: A £token£ inline icon in localisation resolves to the sprite named GFX_text_<token> - the prefix is EXTENDED, not stripped. Declaring only GFX_<token> draws the missing-image glyph. The hardest evidence is that vanilla declares an alias for a texture that already has a plain name, which would be pointless if a fallback existed.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gfx, .yml]
tags: [text_icons, GFX_text_, inline icon, spriteType, localisation, missing-image glyph, alias, £token£]
related: [texture-registration, text-channels]
sources: [<Stellaris>/interface/texticons.gfx, <Stellaris>/interface/astral_planes_resources.gfx]
---

## What it is

Localisation substitutes an inline icon for a `£token£` sequence by looking up a sprite named
**`GFX_text_` + token**. The `GFX_text_` prefix is *extended*, not stripped: `£unga_un_emblem£`
resolves to a sprite named `GFX_text_unga_un_emblem`, and declaring only `GFX_unga_un_emblem` renders
the engine's "missing image" glyph.

There is **no plain `GFX_<token>` fallback** for text icons.

This was a live defect in the working mod: the title emblem drew a `?` glyph, the sprite was declared
only as `GFX_unga_un_emblem`, and the fix was to add `spriteType GFX_text_unga_un_emblem` pointing at
the same 28×28 texture. The art was never the problem.

## Syntax

```
# interface/<prefix>_gfx.gfx -- the declaration the token needs
spriteType = {
	name = "GFX_text_unga_un_emblem"
	textureFile = "gfx/interface/unga_un_emblem.dds"
}

# The vanilla shape to copy (no textSpriteType, no size, no noOfFrames - and both
# `texturefile` and `textureFile` spellings occur in the SAME file):
#   interface/texticons.gfx:834-837
#     spriteType = { name = "GFX_text_science_ship_map" textureFile = "gfx/interface/icons/text_icons/text_science_ship_map.dds" }
#   interface/texticons.gfx:839-842
#     spriteType = { name = "GFX_text_pause_button"    textureFile = "gfx/interface/icons/text_icons/pause_glow.dds" }

# The localisation strips the prefix and writes the token between pound signs:
unga_title:0 "£unga_un_emblem£ UN General Assembly"
#                       ^^^^^^^^^^^^^^^ token -> GFX_text_unga_un_emblem
```

## Evidence

- `measured`, A/B in game, same window, same element, same run: with `GFX_unga_un_emblem` only (the shipped state) the title drew a **`?` missing-image glyph**; with `+ GFX_text_unga_un_emblem` the gold UN emblem draws before 联合国大会. `<clone>/unga-fix/RESULT-ICONS-LOC.md:42-51`.
- `measured`, the two controls in the same frame: `£unity£` (resolved by vanilla's `GFX_text_unity`) draws, and `£job_miner£` (resolved by the runtime-registered `GFX_text_job_miner`) draws. The two controls and the mod's own sprite are rendered by the *same element in the same frame*, and only the plain-name declaration failed. `RESULT-ICONS-LOC.md:50-55`.
- `binary`: the engine registers the same shape at runtime for other databases — `"GFX_text_job_"`, `"GFX_text_resource_"`, `"GFX_text_pop_cat_"` are literal strings in `stellaris.exe`. `RESULT-ICONS-LOC.md:38-40`.
- `vanilla`, the decisive alias: `interface/astral_planes_resources.gfx:3` declares `GFX_resource_astral_threads` and `:13` declares `GFX_text_resource_astral_threads`, and **both point at the same `astral_threads.dds`**. If a plain `GFX_` fallback existed, that alias would be pointless. `RESULT-ICONS-LOC.md:40`.
- `vanilla`: all 200+ sprites in `interface/texticons.gfx` are named `GFX_text_<token>`. `RESULT-ICONS-LOC.md:38`.
- `corrected belief`: an earlier round of the same project asserted that `£sprite_name£` "is the `.gfx` `spriteType`'s name minus the `GFX_` prefix". That is the wrong direction — the prefix is extended to `GFX_text_`. `RESULT-ICONS-LOC.md:57-61`.
- `measured`, the DDS was never the cause: the mod's icon is 28×28, 32-bit BGRA, `dwFlags 0x100F`, `pfFlags 0x41`, masks `00FF0000/0000FF00/000000FF/FF000000`, `pitch = 112`, file length `128 + 28*28*4 = 3264` B — the same header shape as vanilla's own uncompressed text icons. The engine confirms it loads: no `Error initialising texture ... for spritetype GFX_...unga...` line appears in any run. `RESULT-ICONS-LOC.md:63-71`.
- `measured`, a separate class of the same trap: inline `£icon£` widths are resolvable from the sprite index but are NOT currently wired into the text measurer, so a measurement containing one lists the token and charges zero width (a lower bound) rather than guessing. `docs/gui-pitfalls.md:648-649`.

## Rules

- Declare an inline-icon sprite as `GFX_text_<token>` and reference it in localisation as `£<token>£`. Both halves, every time.
- Do not write `GFX_text_` in the localisation and do not omit it in the `.gfx`. The prefix lives on the sprite name only.
- The sprite is an ordinary `spriteType`: no `textSpriteType`, no `size`, no `noOfFrames` (that is for multi-frame sheets only). Both `texturefile` and `textureFile` spellings are accepted, and both occur in the same vanilla file.
- Vanilla's own text icons are 16×16 and live in `gfx/interface/icons/text_icons/`; the size is not enforced by the lookup, only by the layout.
- When an inline icon renders as a `?`, check the `.gfx` NAME before the texture. The missing-image glyph is produced by a failed name lookup, not by a failed texture load, and a bad texture logs `Error initialising texture`.
- The engine also auto-registers `GFX_text_<key>` for some content databases (jobs, resources, pop categories, and `ship_size` icons). A token that resolves without your own declaration is one of those, not evidence of a fallback.

## 待确认

- Whether the engine falls back to a plain `GFX_<token>` for ANY of the 46 English `£token£` uses that have only a plain name, or for the 388 that have neither (their sprites are auto-generated from `gfx/interface/icons/<category>/`). The alias evidence above argues no, but the fallback itself could not be observed directly, so the plugin always generates the `GFX_text_` form — conservative and correct.
- Whether the lookup is case-sensitive. Every observed token is lowercase and every sprite name is lowercase after the prefix, so the question never arises in practice.
