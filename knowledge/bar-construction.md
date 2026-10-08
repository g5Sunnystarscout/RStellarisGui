---
id: bar-construction
category: drawing
title: A bar is DRAWN, not declared - and the drawing is a transcription
title_zh: 进度条是画出来的，不是声明出来的——而且这张图是逐行抄录的
summary: There is no bar window element in Stellaris 4.4.6. Every bar in every .gui file is a dark 9-slice tile under a white 3x3 tile with a 2 px horizontal inset, and the only thing that makes it read as a bar is that construction. The plugin carries the transcription of the working mod's six power-projection ranking bars as data, including the reference's own defect (a 400 px fill in a 400 px track) which it refuses to clone.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui, .gfx]
tags: [bar, progressbarType, corneredTileSpriteType, borderSize, inset, fill, track, cloneOf, bar-clone-source-missing, bar-fill-overflows-track, bar-colour-not-exist, GFX_tiles_dark_area_cut_8, gfx_transparency_white]
related: [text-channels, transparency-white-plate, control-visibility-is-a-potential]
sources: [<mods>/geocentric_origin/interface/zz_geocentric_unga.gui, <Stellaris>/interface/fleet_view.gfx, <Stellaris>/interface/core.gfx]
---

## What it is

The complete set of block keywords that can appear inside a `.gui` file's `guiTypes` block,
measured over all **177** of the install's own `.gui` files, is **41 keywords** and none of them is a
bar:

```
background  borderSize  buttonType  checkboxType  containerWindowType  cursor
default_ime_text_color  dropDownBoxType  editBoxType  effectbuttonType  expandButton
expandedWindow  extendedScrollbarType  gridBoxType  guiButtonType  guiTypes  hide_position
iconType  if_resolution  if_scaled_resolution  instantTextBoxType  listBoxType  margin  offset
OverlappingElementsBoxType  overlay  padding  pdx_tooltip_anchor_offset  position  positionType
scrollbartype  show_position  size  slider  slotSize  smoothListBoxType  spinnerType  text_offset
textboxType  track  windowType
```

`progressbarType` / `progressbartype` / `progressBarType` — the three spellings the engine's `.gfx`
parser accepts — occur **195** times in the install, and every one is inside a `.gfx` file: a search of
`interface/**/*.gui` and `interface/**/*.txt` for all three spellings returns **0**. Vanilla's
`progress_bar` elements are `iconType`s drawing an engine-driven `progressBarType` SPRITE, named by
the engine and filled with engine state. A sprite kind is not a window element, so a mod cannot ask
for one for an arbitrary value.

So a bar is a **cloning** problem, not a design problem. The specification is a transcription of the
ranking bars that already work.

## The canonical construction

Six rows of power-projection ranking bars, each row five SIBLINGS under the band — nothing is nested:

| role | kind | position | size | sprite | `background.name` | offset from track | format / colour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| name | `instantTextBoxType` | {26, 64} | max 202x18 | — | — | -214, -2 | left |
| track | `containerWindowType` | {240, 66} | 400x20 | `GFX_tiles_dark_area_cut_8` | `bg` | 0, 0 | — |
| fill | `containerWindowType` | {242, 70} | 383x12 | `gfx_transparency_white` | `bg` | +2, +4 | — |
| value | `instantTextBoxType` | {646, 64} | max 70x18 | — | — | +406, -2 | right, `Y` |
| seats | `instantTextBoxType` | {728, 64} | max 118x18 | — | — | +488, -2 | right, `E` |

Every one of those text elements also carries `alwaysTransparent = yes` and `fixedSize = yes`. Row
spacing is 24 px.

## Syntax

```
containerWindowType = {                     # the BAND
	name = "unga_chart_main"
	position = { x = 228 y = 160 }
	size = { width = 868 height = 312 }
	background = { name = "bg" quadTextureSprite = "GFX_tiles_dark_area_cut_8" }

	containerWindowType = {                   # TRACK: the dark 9-slice tile
		name = "unga_power_track_1_main"
		position = { x = 240 y = 66 }
		size = { width = 400 height = 20 }
		background = { name = "bg" quadTextureSprite = "GFX_tiles_dark_area_cut_8" }
	}
	containerWindowType = {                   # FILL: the white tile, x = track.x + 2, static length
		name = "unga_power_fill_1_main"
		position = { x = 242 y = 70 }
		size = { width = 383 height = 12 }
		background = { name = "bg" quadTextureSprite = "gfx_transparency_white" }
	}
	instantTextBoxType = {                    # the columns are text, not part of the sprite
		name = "unga_power_value_1_main"
		position = { x = 646 y = 64 }
		maxWidth = 70
		maxHeight = 18
		font = "cg_16b"
		text = "unga_power_value_2"
		text_color_code = "Y"
		alwaysTransparent = yes
		fixedSize = yes
	}
}

# The two install sprites, with their measured definitions:
#   GFX_tiles_dark_area_cut_8  corneredTileSpriteType, borderSize = { x=8 y=8 }, with an effectFile
#                              shader   ->  interface/fleet_view.gfx:2824-2830
#   gfx_transparency_white     corneredTileSpriteType, size 3x3, borderSize = { x=1 y=1 }
#                              ->  interface/core.gfx:119-124  (see the transparency-plate topic)
```

## The one rule this topic exists for

> **The fill's length is static; the number is live.** A fill's length is `size.width` — a layout
> number the engine reads once, at load time. **Text cannot move a rectangle.**

So:

* a bar's fill length is derived from `value` / `max` and written as a pixel literal. A percentage or
  an `@variable` width is REFUSED (`bar-track-width-not-static`) rather than resolved to something
  that would silently break the inset invariant;
* `value > max` is REFUSED (`bar-fill-overflows-track`), not quietly clamped to a bar that looks full;
* a live number is asked for with `labelEffect` / `effect` and becomes an `effectbuttonType` carrying
  `buttonText` (see the `text-channels` topic);
* `trackColour` / `fillColour` are REFUSED (`bar-colour-not-exist`), because a `.gui` container has NO
  colour field. The engine tints TEXT through `text_color_code`, and a sprite may name an `effectFile`
  shader; a window element has neither. Two real options: a different tile sprite, or a shader.

## The invariants that follow, all measured

* **The horizontal inset is 2 px everywhere.** In every one of the construction's eight uses the
  fill's x is the track's x + 2. That is the axis the invariant is about.
* **The fill's height is not a fixed margin.** A 20 px track carries a 12 px fill (margin 4) and an
  18 px track carries a 14 px fill (margin 2). No constant margin and no constant fraction explains
  both; the two points do lie on one line, and the primitive uses it (`fillSlope = -1`,
  `fillBase = 32`).
* **Row 0 is a DEFECT, and it is the one thing not to clone.** `unga_power_fill_0_main` is a **400 px**
  fill inside a **400 px** track at x = 242, so it paints **4 px over** the track's right border. Every
  other ranking fill caps at 396. The primitive reports `bar-fill-overflows-track` (error) and clamps.
* **Two DIFFERENT sprites are load-bearing.** A dark 9-slice tile under a white 3x3 tile. With one
  sprite the construction is a tinted box.

## Cloning a row

```js
{ kind: 'bar', name: 'unga_power_1_main', position: { x: 240, y: 66 }, width: 400, height: 20,
  value: 383, max: 400, rowLabel: 'unga_faction_nato', valueText: 'unga_power_value_2',
  valueColour: 'Y', seats: 'unga_power_seats_2', seatsColour: 'E' },
{ kind: 'bar', name: 'unga_power_2_main', position: { x: 240, y: 90 }, cloneOf: 'unga_power_1_main',
  value: 350, rowLabel: 'unga_faction_csto', valueText: 'unga_power_value_3',
  seats: 'unga_power_seats_3' },
```

`cloneOf` names a bar EARLIER in the tree. The clone inherits the track, the inset, both sprites, the
fonts and the column metrics, and overrides only its own `position`, proportion and text. Its elements
are renamed onto its own row index by ROLE, not by string-replacing the source's name — the derived
names interpose the role, so `unga_power_track_1_main` does not contain `unga_power_1_main` as a
prefix. A `cloneOf` naming a bar that is not there (or is not above this one) is
`bar-clone-source-missing` (error).

## The `from` mechanism

A construction this plugin did not invent can also be READ OUT of an imported tree.
`barFieldsFromElements({ track, fill, name, value, seats }, tree)` takes element nodes or their names,
resolves them in an imported layout, and returns the bar fields that reproduce them: the track's size
and tile, the fill's tile, height and horizontal inset, the columns' `maxWidth`s and the font. Note
what it does NOT recover — the fill's LENGTH — because that is the caller's proportion and the import's
own value may be the over-long one.

## Evidence

- `vanilla`: the 41-keyword element list above, over 177 `.gui` files; `progressbarType` and its two other spellings occur 195 times, all inside `.gfx`, and 0 times in `interface/**/*.gui` or `interface/**/*.txt`. `docs/gui-pitfalls.md:720-740`.
- `vanilla`: vanilla's own `progress_bar` elements are `iconType`s drawing an engine-driven sprite — `interface/anomaly_view.gui:339-343`, `archaeology_view.gui:365`, `astral_rift_view.gui:345`. `docs/gui-pitfalls.md:737-740`.
- `measured`: the transcription table above, read field by field out of `zz_geocentric_unga.gui`'s `unga_chart_main` subtree (`:190-384`, rows at `:311-324`, `:325-339`, `:340-354`, `:355-369`, `:370-384`; band `:190-203`; heading `:204-218`; legend `:219-227`). `docs/gui-pitfalls.md:750-765`.
- `vanilla`: `GFX_tiles_dark_area_cut_8` is a `corneredTileSpriteType` with `borderSize = { x=8 y=8 }` and an `effectFile` shader at `interface/fleet_view.gfx:2824-2830`; `gfx_transparency_white` is a 3x3 `corneredTileSpriteType` with `borderSize = { x=1 y=1 }` at `interface/core.gfx:119-124`. `docs/gui-pitfalls.md:758-762`.
- `measured`: the same construction appears six more times in the same file with the same two sprites and the same 2 px inset — vote tally 400x18 track with a 248x14 fill at +2, and three 1116x18 bloc-standing tracks with 801 / 712 / 456 x14 fills at +2 — which is what makes it the project's idiom rather than one author's accident. `docs/gui-pitfalls.md:773-781`.
- `measured`: `unga_power_fill_0_main` at `:257-271` is a 400 px fill in a 400 px track at x = 242, painting 4 px over the track's right border; every other ranking fill caps at 396. `docs/gui-pitfalls.md:791-794`.
- `measured`: the transcription is checked in the suite — the "C1" group re-reads the mod file and checks EVERY line range and EVERY literal of the transcription against it, compares the expansion to the transcription field for field, and carries a fail-if-removed guard over the module's own source text. That guard is not decoration: an earlier revision contained two elements that do not exist anywhere in the file (`unga_att_un_value_nato`, `unga_att_stab_value_nato`), and the name check is what keeps them gone. `docs/gui-pitfalls.md:856-866`.
- `measured`: the value column's width and gap are `valueWidth` / `valueGap` (the short role name, like `rowLabel` / `seats`), NOT `valueTextWidth` / `valueTextGap`. `readColumn(node, 'valueText', ...)` used to derive both names from the one string it was given and a caller who passed `valueWidth: 170` got the 70 px default with **no error** (GAP-6). The node key and the field prefix are now separate parameters so they cannot drift, and using an old spelling raises `bar-field-deprecated`. `docs/gui-pitfalls.md:953-966`.
- `measured`: `bar-track-misaligned-with-heading` exists because a ranking band reads as a table, and NOTHING OVERLAPS when a track does not start at the same x as its heading — which is why no geometric rule catches it. The reference shows the shape that makes it non-trivial: the caption sits at x = 22 over a name column at x = 26, in a DIFFERENT container from the rows' tracks at x = 240. `docs/gui-pitfalls.md:868-876`.

## Rules

- Build a bar from `gui_bar_spec` / the `bar` component; do not hand-place a track and a fill. The component is the transcription, and `gui_bar_spec` returns the whole API table.
- A bar's `position` is the TRACK's top-left corner. The name column is the only negative x in the construction, so a bar placed where the old code put its track stays where it was.
- Fill length comes from `value` / `max` — never from a percentage and never from the import's own value.
- Refuse `value > max`; do not clamp silently.
- There is no colour field. Use a different tile sprite or a sprite with an `effectFile` shader.
- Ask for a live number with `effect` (+ `labelEffect`), not by putting a bracket call in painted text.
- Watch the asymmetry in the field names: `value` is the NUMBER, `valueText` is the value column's TEXT; `valueWidth` / `valueGap` are the column's width and gap.
- Do not clone row 0 of the reference. It is the one measured defect in the construction, and the primitive reports it rather than reproducing it.

## 待确认

- Whether the engine has any other live-TEXT channel inside a `custom_gui` window. `effectbuttonType.buttonText` is the only one MEASURED; the claim is "the only measured channel", not "the only channel".
- Whether a `progressBarType` sprite can be driven with a value a mod controls. The install's uses are all engine state, and no mod in this project's evidence has tried.
