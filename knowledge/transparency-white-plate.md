---
id: transparency-white-plate
category: drawing
title: gfx_transparency_white is an opaque white PLATE, not a hole - do not put it behind light text
title_zh: gfx_transparency_white 是一块白板，不是透明洞——别把它垫在浅色文字下面
summary: The canonical bar gives its live value element quadTextureSprite = "gfx_transparency_white" so the button has a hit region that paints nothing - but the sprite is not transparent. Its texture is uniform white, and behind the engine's light default button text it produces the report "text-less, effect-less buttons" when in fact the numbers are there and unreadable.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gfx, .dds, .gui]
tags: [gfx_transparency_white, transp_white, sprite, texture, alpha, contrast, readability, effectbuttonType, quadTextureSprite, live-value, accessibility, bar]
related: [bar-construction, text-channels, texture-registration]
sources: [<Stellaris>/interface/core.gfx, <Stellaris>/gfx/interface/transp_white.dds, <Stellaris>/interface/fonts.gfx]
---

## What it is

The bar primitive gives its live value element `quadTextureSprite = "gfx_transparency_white"`, copied
from the working mod's own live value button (`zz_geocentric_unga.gui:3354`). The intent — and the
documented reason — is that the control should have a hit region that paints nothing.

It does not paint nothing. The name is misleading, and the consequence shipped and was reported by the
user before any geometric rule noticed: "a few progress bars still have text-less, effect-less buttons
behind them, just remove them".

There was no such button. What made it LOOK dead is the plate: the numbers were on an opaque white
rectangle, drawn in the engine's light default button colour, i.e. white on white.

## Syntax

```
containerWindowType = {                     # the sprite, as the install defines it
	name = "gfx_transparency_white"           # interface/core.gfx:119-124
	size = { x = 3 y = 3 }
	textureFile = "gfx/interface/transp_white.dds"
	borderSize = { x = 1 y = 1 }
}

# What the texture actually is (8x8 BC3/DXT5, 192 bytes, ONE distinct pixel value):
#   RGBA = (255, 255, 255, 84)   - uniform white at alpha 84/255 (about 33% opaque)

# The bar primitive's live value button asks for it (src/lib/components.mjs:292):
effectbuttonType = {
	name = "unga_power_value_1_main"
	quadTextureSprite = "gfx_transparency_white"     # <- this plate
	buttonText = "unga_power_value_2"
	effect = "unga_power_value_effect"
	size = { x = 70 y = 18 }
}

# The engine's text colours, from interface/fonts.gfx:9-27, are the only way to change text colour:
T = { 255 255 255 }   # standard text
W = { 255 255 255 }   # white
t = { 198 198 198 }   # light gray, "concept tooltip texts"
g = { 128 128 128 }   # grey
```

## Why it reads as white-on-white

* the plate is uniform white at 33% opacity, i.e. a white WASH over whatever is behind it. Over a dark
  panel that already raises the local background toward white;
* the default button text colour is the engine's light text colour (`T` / `W` = 255,255,255, or `t` =
  198,198,198);
* so the glyphs and their immediate background are within a few percent of each other. The report was
  not "the text is invisible" but "there is a button with no text on it" — which is what a very
  low-contrast white-on-white number looks like.

## The fix that was applied, and the one that was not

The mod's fix was to **drop the plate from the 30 value buttons** (a line-drop rule in
`fixup-geometry.mjs`, which first asserts each button is a live one). The numbers now sit on the panel
like the reference's ranking values, and `unknown-field` fell 62 -> 0 as a side effect.

The fix that was NOT applied is changing the sprite. There is no transparent-for-real sprite in the
palette to switch to without inventing one, and a `containerWindowType` has no colour field, so a
transparent hit region has to come from a sprite whose texture is genuinely empty.

## Evidence

- `measured`, this checkout: `gfx/interface/transp_white.dds` is 192 bytes, an 8x8 BC3/DXT5 file whose decoded level carries exactly ONE distinct pixel value, `RGBA(255,255,255,84)`. Reproduce with the plugin's own decoder (`src/lib/dds.mjs`, `parseDdsHeader` + `decodeDdsLevel`).
- `vanilla`: `interface/core.gfx:119-124` declares `corneredTileSpriteType { name = "gfx_transparency_white" size = { x=3 y=3 } textureFile = "gfx/interface/transp_white.dds" borderSize = { x=1 y=1 } }`.
- `vanilla`: `interface/fonts.gfx:9-27` is the engine's whole text-colour table: `T = { 255 255 255 }`, `W = { 255 255 255 }`, `t = { 198 198 198 }`, `g = { 128 128 128 }`. There is no other mechanism for a `.gui` element's text colour than `text_color_code` against this table.
- `measured`, in game: the user's report was "a few progress bars still have text-less, effect-less buttons, just remove them". `sweep-strings.mjs --dead` reported **0 of 88** effectbuttons as text-less and effect-less; the six buttons behind the six bars are the LIVE VALUES, each with a `buttonText` and an effect, and removing them would remove the numbers. `<clone>/unga-fix/STATUS-mechanics.md:20`.
- `measured`: the plate is what sat behind the number — an opaque white rectangle with the number drawn on it in the engine's light default button colour. `<clone>/unga-fix/STATUS-mechanics.md:20`.
- `vanilla`: the reference's own live value button carries the same sprite (`zz_geocentric_unga.gui:3354`), which is why the primitive inherited it.
- `measured`, the sibling project's independent measurement of the same class: a status panel shipped `g` = (128,128,128) on its own background, a WCAG contrast ratio of **3.55:1**, where `t` = (198,198,198) gives **8.20:1**. Both are legal English text colours; only one is readable. `docs/gui-pitfalls.md:404-410`.

## Rules

- Never put `gfx_transparency_white` behind text you want read. It is a 33%-white wash, and against the engine's own light text colours the number disappears.
- If a control needs a hit region that paints nothing, check what the sprite's texture actually contains. The name is not evidence.
- A `.gui` container has no colour field. To tint, change the sprite or give the sprite an `effectFile` shader; text colour is `text_color_code` against the `fonts.gfx` table and nothing else.
- Do not let hue alone carry meaning, and measure contrast rather than eyeballing it: decode the background texture, average it, and compute the WCAG ratio against the text colour. The status-dot legend in the working mod was replaced by a neutral white square partly because the user is colour-blind.
- When a report says "there is a dead button here", count the dead buttons before deleting them. `sweep-strings.mjs --dead` said 0 of 88; the report was about contrast, not about a button.

## 待确认

- Whether the engine composites the 3x3 `borderSize = { x=1 y=1 }` tile at all on a small button, and whether that changes the effective opacity over the panel behind it. The decoded texture is uniform, so the 9-slice cannot change the colour, but the exact alpha blend over the panel is not measured.
- Whether `gfx/interface/transp_white.dds` at 8x8 is the texture the engine actually samples for a 3x3 sprite — sprite `size` and texture dimensions disagree here (3x3 declared, 8x8 file), which is normal for a cornered tile but is not itself measured.
