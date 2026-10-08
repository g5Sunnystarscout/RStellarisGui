---
id: coordinate-semantics
category: layout
title: position is added to the parent's orientation anchor, for all nine anchors
title_zh: position 加到父元素的 orientation 锚点上，九个锚点都一样
summary: orientation names a nine-point anchor ON THE PARENT and position is an offset from it, so lower_* moves the reference point rather than negating the sign - a negative y from lower_left moves the element UP. The plugin keeps one canonical system (parent top-left, +y down) and converts at the file boundary; negating y for the bottom anchors was measured over the whole vanilla corpus and it is a regression, not a fix.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui]
tags: [orientation, origo, position, anchor, lower_left, coordinate-system, calibration, containerWindowType]
related: [coordinate-calibration, per-kind-size-and-field-forms, parking-elements]
sources: []
---

## What it is

Every coordinate this plugin accepts, reports or draws is in ONE system: origin at the parent
window's top-left, `+x` right, `+y` **down**, units are scaled UI pixels at the 1920x1080 base
resolution. There is no other reading of `position` anywhere in the tool surface.

The `.gui` file's own rule, which the canonical system absorbs:

```
dirY   = 1                                       # for every orientation: the sign is never negated
anchor = anchorPoint(parentRect, orientation)    # nine-point, on the PARENT
pivot  = anchor + (position.x, dirY * position.y)
corner = pivot - size * origoFraction            # nine-point, on the ELEMENT
```

With both defaults (`upper_left` / `upper_left`) `position` is simply the corner relative to the
parent's corner. With `orientation = center, origo = center` the element is centred on its parent's
centre.

## Syntax

```
# Same number, two different places on screen - because the ANCHOR moved, not the sign.
containerWindowType = {
	name = "a"
	orientation = "upper_left"        # anchor is the parent's top-left
	origo = "upper_left"              # pivot is the element's top-left
	position = { x = 35 y = -42 }     # 42 px ABOVE the parent's top edge: OUTSIDE the parent
}

containerWindowType = {
	name = "b"
	orientation = "lower_left"        # anchor is the parent's BOTTOM-left
	origo = "lower_left"              # pivot is the element's bottom-left
	position = { x = 35 y = -42 }     # 42 px ABOVE the parent's bottom edge: INSIDE the parent
}

# The twelve canonical anchor names, and the vanilla spellings that map onto them. Anchor names
# are matched case-insensitively, including the misspellings vanilla actually contains.
#   upper_left  upper_center  upper_right
#   center_left center        center_right
#   lower_left  lower_center  lower_right
# vanilla misspellings seen in the install: CENTERUP, LOWER_LEfT
```

## How the canonical frame is kept single

`gui_layout_import` converts every parsed `position` into the canonical frame and keeps the literal
the file carried as `enginePosition`; `computeLayout` turns canonical positions into rects for the
preview, the rect table and the validator; and `gui_emit_files` runs `prepareEngineCoordinates`
(`src/lib/emit.mjs`) which derives the fields the engine reads from the same canonical value. The
emitted file, the SVG and the rect table are therefore three renderings of one model, and an
import -> emit -> re-import round trip reproduces every rect exactly (asserted in
`scripts/selftest.mjs` over nested `lower_*` containers).

The converter is `src/lib/coords.mjs`: `yDirectionForAnchor` at `:133` (the function the calibration
exists to pin down), `anchorFractions` at `:148`, `anchorPointOf` at `:156`,
`pivotFromEnginePosition` at `:169`, `enginePositionToCanonical` at `:193`,
`canonicalPositionToEngine` at `:210`, `cornerFromPivot` at `:221`, `pivotFromCorner` at `:227`.

## Syntax gotchas the converter handles

* `orientation` selects an anchor on the PARENT; `origo` selects the reference point on the ELEMENT.
  They are independent, and all 81 combinations are asserted against an independently written
  expectation in `scripts/selftest.mjs`.
* `origo` exists on `containerWindowType` ONLY (175 vanilla uses, 0 anywhere else). On an `iconType`
  the equivalent is `centerPosition = yes` (285 vanilla uses), and `origo` on an icon is refused by
  the engine: `Unexpected token: origo`. `src/lib/kinds.mjs:299` lists it in
  `ENGINE_REJECTED_FIELDS`; the field lists at `:173` / `:283` are where the two per-kind spellings
  live.
* `position { x = ... }` without an `=` is ALSO valid (`interface/galaxy_view.gui:1646`) and used to
  break the parser, spilling an element's fields and nested elements into its parent.

## Evidence

- `vanilla`: `combat_view.gui:41-45` writes `orientation = lower_left, origo = lower_left, position = { x = 35 y = -42 }`, which puts the window's bottom-left corner 42 px ABOVE the screen's bottom edge — a NEGATIVE number moving the element UP the screen, exactly as the canonical system would. `README.md:280-283`.
- `measured`: `scripts/calibrate-coords.mjs --compare` parses all 177 vanilla `.gui` files, computes every element's rect at every nesting depth under both candidate models, and reports containment per orientation family. Negating y for the bottom anchors drops aggregate containment from **0.7733 to 0.7472**, and the `lower_*` family from **0.7398 to 0.0938**. That is a regression, not a fix. `README.md:284-286`.
- `vanilla`: the misspellings `CENTERUP` and `LOWER_LEfT` occur in the install and are normalised, so the converter cannot be a strict enum. `docs/sources.md:236-251` (Correction 2).
- `vanilla`: `interface/galaxy_view.gui:1646` uses `position { x = @[ shroudPlaneRadius ] y = @[ shroudPlaneRadius ] }` — both the brace-without-equals form and the `@[ name ]` variable form are 4.4.6 syntax (34 uses of `@[ ]`). `docs/engine-feedback.md:119-123`.
- `measured`: the round trip is asserted on nested `lower_*` containers in `scripts/selftest.mjs` ("canonical coordinates and the engine converter"), so the claim is a test, not a comment.

## Rules

- State the base resolution in every geometry report. All coordinates are pixels at **1920x1080**; the game scales the whole UI, so "overlap" and "out of bounds" are only meaningful relative to a stated base.
- Never negate `position.y` because the anchor is a `lower_*` one. Change the anchor and keep the sign; `dirY` is 1 for every orientation.
- Move an element up by making `position.y` negative, whichever anchor is in play.
- `origo` on anything but a `containerWindowType` is an error; use `centerPosition = yes` on an icon.
- Anchor names are case-insensitive, including vanilla's own misspellings.

## 待确认

- The engine's own rounding of accumulated float advances and offsets. It is bounded by the 2 px disagreement between two shipped generations of the same font face (`docs/gui-pitfalls.md:530-533`), and sub-pixel in practice, but it is not directly observable.
