---
id: parking-elements
category: tooling
title: Parked elements keep their bindings - the -3000,-3000 idiom and its two traps
title_zh: 停放的元件仍然保留它的绑定——-3000,-3000 惯例与两个陷阱
summary: The idiom for satisfying the name contract without showing chrome is to park an element off-canvas at -3000,-3000 with a zero size. Parking removes the PIXELS, not the BINDING: a parked control still claims its shortcut and its hit region. Measured - a parked duplicate close button carrying shortcut = ESCAPE was the ONLY ESCAPE binding in its window, so ESC pressed a button three thousand pixels off-screen while the visible X had no binding at all.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui]
tags: [parking, -3000, shortcut, ESCAPE, hit-region, name-contract, out-of-bounds, parked-element-shortcut, parked-element-hit-region, GAP-11]
related: [window-name-contract, window-dismissal, apply-preserves-transparency-and-comments]
sources: [<Stellaris>/interface/diplomacy_caravaneer_event_view.gui]
---

## What it is

A `custom_gui` window must declare every demanded contract name. Some of them are names the engine
binds but the mod has no use for — a `tts_button`, a second `close`, an `event_option_entry` — and the
idiom is to declare the element and then park it where it can never be seen:

```
position = { x = -3000 y = -3000 }
size = { x = 0 y = 0 }
```

**Parking removes the pixels. It does not remove the binding.** An element that still carries a
`shortcut` still owns that key, and a parked CONTROL whose size is not zero still owns a live, invisible
hit region.

## The measured failure

Each window of the trial mod carried two close buttons: the parked duplicate `close_<suffix>` (abs
−1360,−2850, 38×38) and the real `close`. The parked duplicate still carried `shortcut = ESCAPE`, and
it was the ONLY ESCAPE binding in the window: the file had exactly **six** `shortcut = ESCAPE` lines,
one per window, each inside a parked duplicate.

So ESC pressed a button three kilometres off-screen, and the visible X had no binding at all. The
user's report was "the main window will not close", and it survived a round of geometry checks — the
click region was fine and only the KEYBOARD region was wrong.

Vanilla's own event windows declare no ESCAPE shortcut anywhere
(`interface/diplomacy_caravaneer_event_view.gui`, `interface/diplomacy_event_view.gui`: only
`shortcut = "q"`, `shortCut = "t"`).

## Syntax

```
# The safe park: no size, so no hit region, and no shortcut, so no binding.
containerWindowType = {
	name = "tts_button_parked"
	position = { x = -3000 y = -3000 }
	size = { x = 0 y = 0 }
}

# The two traps. Both of these are still LIVE.
effectbuttonType = {
	name = "close_parked"
	position = { x = -3000 y = -3000 }
	size = { x = 38 y = 38 }        # <- still a 38x38 hit region, off-canvas but real
	shortcut = "ESCAPE"             # <- still the window's ESCAPE binding
}
```

## What counts as "parked"

The test is relative to the WINDOW the element lives in, not to the screen: a window parked at the
screen edge, or one of its panels hanging a few pixels over the edge, is a layout question the geometry
validator already reports as `out-of-bounds`. "Parked" means "cannot be part of the window that
contains it".

`isParked` (`src/lib/contract.mjs:539`) uses a `slack` of **256 px** around the window rect, so a panel
that legitimately overhangs its window is not called parked. An element with **no area at all** counts
as parked too: `0x0` can neither be seen nor clicked, and that is what an unsized icon reports.

## Only CONTROLS are reported

A parked `heading` or `alien_message` is a text element: it is not clickable and it holds no binding,
so reporting it would bury the findings that matter. Measured: 72 `parked-element-hit-region`
warnings, of which **60** were text/icons that cannot be clicked.

## Evidence

- `measured`: the parked duplicate `close_<suffix>` (abs −1360,−2850, 38×38) carried `shortcut = ESCAPE`; the file had exactly six `shortcut = ESCAPE` lines, one per window, each inside a parked duplicate. `docs/gui-pitfalls.md:274-284`.
- `vanilla`: the install's own event windows declare no ESCAPE shortcut anywhere — `interface/diplomacy_caravaneer_event_view.gui` and `interface/diplomacy_event_view.gui` carry only `shortcut = "q"` and `shortCut = "t"`. `docs/gui-pitfalls.md:282-284`.
- `measured`: the defect survived a round of geometry checks, because the click region was fine and only the KEYBOARD region was wrong. `docs/gui-pitfalls.md:286-287`.
- `measured`: the shipped mod STILL produces 12 `parked-element-shortcut` warnings — the traps are real in the working file, which is why they are warnings and not errors. `docs/gui-pitfalls.md:292-294`.
- `measured`: 72 `parked-element-hit-region` warnings of which 60 were text/icons that cannot be clicked, which is why the rule is controls-only. `src/lib/contract.mjs:556-559`.
- `measured`: the safe idiom is stated in the contract finding itself — "declare each one and park the ones you do not want to show off-canvas at -3000,-3000 with a zero size". `src/lib/contract.mjs:361-362`.
- `measured`, a related pre-existing disagreement, NOW RESOLVED IN THE PLUGIN (GAP-11): parked elements at `-3000,-3000` used to be counted as `out-of-bounds`, and 42 of the working mod's 105 were deliberate, so `mech-gate.mjs` rule 12f read FAIL on `out-of-bounds 154` against its own `--oob-baseline 84` with the counts IDENTICAL on the fixed plugin and an unmodified checkout of it. The validator now CLASSIFIES by distance and reports the split: `report.geometry.outOfBounds` is `{total, classified, escaped, parked, parkMargin, parkedClassification, note}`, an element past `parkMargin` (default **512** px outside the root) becomes the info rule `out-of-bounds-parked` instead of the error `out-of-bounds`, and every element keeps its own finding. Measured on the working mod: **154 out-of-bounds elements, escaped 0, parked 154**, and the closest of them is **1112 px** outside - more than 2x the margin, so the split is unambiguous there. The baseline was NOT raised and no rule was switched off: the gate now reads `out-of-bounds 0` because there are no real escapes, with 154 counted separately and visibly. `PLUGIN-GAPS.md:715-728`.

## What counts as "parked" for the `out-of-bounds` rule (GAP-11)

Two different questions were being answered by one number, and separating them is what made rule 12f
readable again:

| question | rules | how it is decided |
| --- | --- | --- |
| can this element be PART of the window that contains it? | `out-of-bounds` (error) / `out-of-bounds-parked` (info) | distance outside the ROOT rect: at `parkMargin` or beyond, it is a park |
| does this parked element still hold a binding nobody can see? | `parked-element-shortcut`, `parked-element-hit-region`, `parked-duplicate-of-live-control` | `isParked` (`src/lib/contract.mjs:539`), a **256 px** slack around the WINDOW rect, and `0x0` counts as parked |

They are deliberately different numbers. The contract rules judge a park against the WINDOW, because a
panel 100 px outside its window is a layout question. The geometry rule judges it against the ROOT,
because that is the rect it reports on - and a vanilla-shaped event window's own interior lives about
670 px above the top edge, so a 256 px margin would leave no headroom between "a panel legitimately
overhanging" and "parked". 512 px is the smallest margin that clears every panel of such a window while
still catching a real escape: this mod's closest out-of-bounds element is 1112 px out, and every one of
the 154 is at least that far.

`parkMargin` is an option (`park_margin` on `gui_layout_validate`) and `0` turns the classification off
entirely, which restores the old single-rule behaviour for a caller who wants it. The count is never
hidden either way: `geometry.outOfBounds.parked` plus one `out-of-bounds-parked` finding per element, so
"154 excluded" reads as 154 reported and not as silence. `geometry.outOfBounds.total` is what the rule
CLASSIFIED, which is smaller than the finding count when a `show_position` animation was exempted.

## Rules

- A park must zero the size AND drop the `shortcut`. `position = { x = -3000 y = -3000 }` alone is not a park; it is an off-screen live control.
- Never leave a `shortcut` on a control you do not want reachable. The keyboard binding does not move with the pixels.
- Judge parking against the WINDOW, not the screen. A panel 100 px outside its window is an `out-of-bounds` layout question, not a park.
- Only controls can hold a hit region or a binding; text and icons are exempt from the two parked-control warnings by design.
- Expect `out-of-bounds` findings for deliberately parked elements, and expect that count to be large in a real mod. Do not "fix" them by moving parked elements inside the window — that defeats the park. Past `parkMargin` they are reported as `out-of-bounds-parked` (info) and counted in `geometry.outOfBounds.parked`, so they do not inflate the escape count; the honest fix for a file whose REAL escapes are hidden among them is to lower `parkMargin`, never to raise a gate's baseline.
- A parked element that duplicates the name of a live control is `parked-duplicate-of-live-control` (info). The engine resolves a contract name to whichever occurrence it reaches first, so a parked duplicate of `close` is a real hazard (see the `window-name-contract` topic).

## 待确认

- Whether a zero-size control truly has no hit region in the engine, or merely a region of zero area that a click at the exact parked coordinate could still hit. The plugin's reading ("cannot be clicked") is from the geometry; the engine was not probed for it.
- Whether the engine CLIPS a partially off-canvas element or draws it. The `parkMargin` follows the untested-but-conservative reading (it is drawn); an element wholly inside the margin is reported as an escape either way, and the 512 px default is far outside any panel a real window places.
- How a caller should set `parkMargin` for a mod that parks at a coordinate other than `-3000,-3000` (a `+3000` park to the right of the screen, or a `-10000` park). The option exists and the split is printed; no census of alternative park coordinates was made.
