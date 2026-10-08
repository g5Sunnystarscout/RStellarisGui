---
id: per-kind-size-and-field-forms
category: layout
title: The size keyword and the field set are PER KIND, and the wrong one is a parse error
title_zh: size 关键字与字段集是按 kind 区分的，写错就是解析错误
summary: instantTextBoxType takes maxWidth/maxHeight and rejects size; iconType has no size token at all; button/list/scrollbar kinds take size = { x y }; containerWindowType and gridBoxType take size = { width height }. `visible` is not a container field either, and a scalar token NO kind declares is an error (`unexpected-token`). A field written one level too deep parses but makes the engine DROP the neighbouring field, which is how a close button ended up 108 px outside its window.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui]
tags: [size, maxWidth, maxHeight, iconType, instantTextBoxType, buttonType, containerWindowType, field-not-accepted, size-not-accepted, unexpected-token, visible, parse-error, field-depth]
related: [coordinate-semantics, texture-registration, engine-capability-vs-usage]
sources: []
---

## What it is

The engine has a separate hand-written parser per element kind, and they do not agree about the
`size` keyword. An earlier revision of this plugin wrote `size = { width = ... height = ... }` for
every kind, which is internally consistent, geometrically correct, and rejected by the engine.

This is the class of defect a measurement tool is least allowed to have: the layout tree, the
validator and the preview all agreed with each other and were all wrong together.

## Syntax

```
containerWindowType = {          # width/height, or a percentage, or an @variable
	size = { width = 620 height = 320 }
}

instantTextBoxType = {           # NO size block. maxWidth/maxHeight ARE the size.
	maxWidth = 580
	maxHeight = 28
}

iconType = {                     # no size token at all: it draws at its sprite texture's size
	spriteType = "GFX_my_icon"
}

buttonType = {                   # x/y spelling, where x is the WIDTH
	size = { x = 180 y = 34 }
}

gridBoxType = {                  # width/height, like a container
	size = { width = 400 height = 200 }
}

# The four legal size VALUE forms, all present in vanilla 4.4.6 as a containerWindowType:
#   width = 850      static pixels                                     (4929 value slots)
#   width = 100%     percent of the PARENT                                 (366)
#   width = 100%%    percent of the parent MINUS this element's position    (20)
#   width = -16      parent minus position minus 16                         (50)
#   width = @var     an @variable declaration                              (449)
```

## The per-kind table

| kind | legal size spelling | rejected |
| --- | --- | --- |
| `instantTextBoxType` | `maxWidth` / `maxHeight` only | `size` (`Not used, use maxWidth and maxHeight`) |
| `iconType` | none: it draws at its sprite texture's size | `size` (`Unexpected token: size`), `origo` |
| `buttonType` / `effectbuttonType` / `listBoxType` / `smoothListBoxType` / `OverlappingElementsBoxType` / `guiButtonType` / `scrollbarType` | `size = { x y }` (x is the width) | `width` / `height` in the size block |
| `containerWindowType` / `gridBoxType` / `dropDownBoxType` / `extendedScrollbarType` | `size = { width height }` | `x` / `y` in the size block |
| `containerWindowType` | — | `alwaysTransparent` (move it into the window's `background` block) |
| `containerWindowType` | — | `visible`: **not a field of this kind in 4.4.6** (`Unexpected token: visible`), and the rejected token derails the REST of the block, so the fields after it are lost (`field-not-accepted`, error) |
| everything except `effectbuttonType` | — | `effect` |
| any kind | — | a scalar token NO kind declares and the corpus never writes on any kind: `unexpected-token` (error), because the engine answers `Unexpected token: <token>` at file load and drops the enclosing block |

`src/lib/kinds.mjs` holds `ENGINE_REJECTED_FIELDS` (global: proven on a kind where vanilla writes the
field nowhere) and `KIND_REJECTED_FIELDS` (per kind: the `visible` entry, because only
`containerWindowType` was probed); the per-kind field lists and their size forms are the
`ELEMENT_KINDS` table, and `sizeFormFor` / `kindAcceptsField` are the queries the validator, the
emitter and `gui_check_files` all share. Two exemptions keep `unexpected-token` from firing on
vanilla's own files, and both are measurements: `name`/`id` (an element's identity) and an
`@variable = value` DECLARATION that sits inside a block.

## The field-DEPTH trap

A field written one level too deep — inside a `position` block — parses fine. What it does is make the
engine read the deeper block as the position block and DROP THE NEIGHBOURING FIELD that follows it.

```
position = {
  x = -10
  y = 16
}
orientation = "UPPER_RIGHT"
  alwaysTransparent = yes     <-- ONE TAB TOO DEEP: inside the position block
```

The engine then reads `position = { x = -10 y = 16 orientation = "UPPER_RIGHT" alwaysTransparent = yes }`,
drops the orientation, and places the 114x38 sprite at the raw offset: x 1634..1748, which is **108 px
past the window's right edge (1640)** with a 6 px sliver on screen. The user's report was "the close
button cannot be closed", and the plugin's rect table — which read the tree, not the text — could not
see it. `checkGuiSyntax` on the patched TEXT before writing is what caught the class.

## Evidence

- `log`: verbatim from `logs/error.log`, a run of `interface/zz_geocentric_unga.gui`:
  `[persistent.cpp:41]: Error: "Unexpected token: size, near line: 56" ... near line: 59` (line 56 is a `size` block inside an `iconType`),
  `[persistent.cpp:41]: Error: "Malformed token: width, near line: 96 / Malformed token: height, near line: 97" ... near line: 98`,
  `[instanttextboxtype.cpp:138]: Not used, use maxWidth and maxHeight  file: interface/zz_geocentric_unga.gui line: 95` (line 95 is a `size` block inside an `instantTextBoxType`). `docs/engine-feedback.md:12-23`.
- `log`, round 2, the same file after the `size` fixes: `Unexpected token: custom_tooltip` (x51), `Unexpected token: alwaysTransparent` (x47, on a `containerWindowType` — vanilla uses it only on text/icon/button/list kinds and inside a `background` block), `Unexpected token: origo` (x1, on an `iconType`). `docs/engine-feedback.md:66-81`.
- `vanilla`: 0 of 2779 `iconType` and 0 of 3220 `instantTextBoxType` blocks declare a `size`. 3138 of 3202 text blocks carry `maxWidth` and 2890 carry `maxHeight`. `docs/engine-feedback.md:29-42`, `src/lib/kinds.mjs:29`.
- `vanilla`: `buttonType` uses `size = { x y }` 450 times and `maxWidth`-style never. `docs/engine-feedback.md:37`.
- `measured`: the emitted file's engine errors went **347 -> 0** (`checkGuiSyntax`) and **296 -> 0** `size-not-accepted` findings on the tree, once the emitter wrote the kind's own form. `docs/engine-feedback.md:146-153`.
- `measured`: the one-level-too-deep `alwaysTransparent` moved the close button 108 px past the window edge; the rect table said it was inside. `docs/gui-pitfalls.md:211-231`.
- `measured`: field-position bugs are protected against from both sides — the engine's verbatim error lines are checked in as `scripts/fixtures/engine-error-baseline.log` beside the first 110 lines of the offending file, and `scripts/selftest.mjs` replays them: every error line must produce a finding at that line, the broken emission must FAIL validation, and the fixed emitter's output of the same tree must PASS the same check.
- `log`, **2026-10-06 - `visible` on a container, probed in a loaded game**: `[persistent.cpp:41]: Error: "Unexpected token: visible, near line: 17" in file: "interface/input_blocker.gui"`, and the rejection **derailed the rest of the enclosing block**, which made the probe's other two cases unreadable in that run. The install agrees from the other side: **0** of the 177 `.gui` files write `visible` on any element kind at all. The four kinds the probe's reference calls text/icon/button fields were NOT probed, so the rule is scoped to containers. `PROBE-RESULTS.md` section 2; GAP-15.
- `log`, **2026-10-06 - an unknown scalar in a BLOCK'S OWN BODY is an error**: the same probe wrote `probeZZtokenInGrid` inside a `gridBoxType` and `probeZZtokenInHost` inside a `containerWindowType`; each produced exactly one `persistent.cpp:41` `Unexpected token:` line at file load. A scalar that no kind declares is therefore `unexpected-token` (error), not silence - the syntax check reported **0** findings on the file the engine answered with **4** token lines before this rule existed. `PROBE-RESULTS.md` section 2/7; GAP-16.

## Rules

- Write the size form the KIND accepts. The emitter does this for you and reports `size-value-resolved` / `size-source-converted` when it had to translate a percentage or a negative size into pixels.
- Never write a `size` block on a text or icon element.
- `maxWidth`/`maxHeight` accept a plain integer or an `@variable`; `0` of 3138 vanilla `maxWidth` values is a percentage. The x/y slot accepts only an integer or an `@variable`.
- Indentation is semantics here. A field one level too deep silently steals the block's meaning from its neighbour. Run `checkGuiSyntax` on the TEXT you are about to write, not only on the tree you built.
- `alwaysTransparent` on a `containerWindowType` is an error; move it into the window's `background = { ... }` block (412 vanilla uses, e.g. `interface/planet_view.gui:255`).
- `visible` is NOT a field of `containerWindowType` in 4.4.6. `field-not-accepted` (error) reports it, and the emitter refuses to write it. It is deliberately NOT reported on text/icon/button: that was never measured, and vanilla writes it on no kind at all.
- A scalar field no kind declares, and that none of the install's 177 `.gui` files writes on that kind, is `unexpected-token` (error): the engine's reader answers `Unexpected token: <token>` and drops the enclosing block at load. `name`, `id` and `@variable` declarations are exempt.
- `effect` is not a field of `buttonType`. The engine answers `Unexpected token: effect`, drops the block, and the button renders and does nothing — which looks exactly like a working button whose script is broken.
- `custom_tooltip` is a SCRIPT field (3777 uses inside the install's `events/`, 0 on any element of its 177 `.gui` files). The GUI spelling is `pdx_tooltip` / `tooltip` / `tooltipText`, per kind.
- A percentage or negative size in an integer-only slot is resolved into pixels on emit and reported, not refused.

## 待确认

- Whether the engine's "drop the neighbouring field" behaviour is a generic block-termination rule or specific to `position`. It is reproduced on `position`; no other block was tested the same way.
- Whether `visible` is legal on an `instantTextBoxType` / `iconType` / `buttonType`. The game probe tested it on a `containerWindowType` only (where it is rejected), the install writes it on no kind at all, and the plugin's rule is scoped to the container for that reason rather than generalised.
- Whether the engine rejects an unknown BLOCK (`foo = { ... }`) the same way it rejects an unknown scalar. `unexpected-token` covers scalars only: the corpus's non-element blocks include the resolution conditionals, which are legal, so the block vocabulary is not a closed set the way the scalar field lists are.
- `dynamic_extra_height` / `dynamic_extra_height_max` exist as keywords in `stellaris.exe`, but neither vanilla nor the working mod uses them, so the plugin's "extra available height" reading is from the field name, not from a measurement.
