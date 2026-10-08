# Engine feedback: what the game's own error log forced this project to change

This file exists because the validator, the preview and the emitter all agreed with each other and
were all wrong about one thing: **the `size` keyword is per element kind**. Nothing inside the
project could have caught it, because the layout tree is internally consistent and the geometry is
correct. The engine caught it, in one run, with 415 parse-error tails and 204 warnings.

The verbatim lines, from
`%USERPROFILE%\Documents\Paradox Interactive\Stellaris\logs\error.log`, for a run of
`interface/zz_geocentric_unga.gui` (the trial mod's merged file):

```
[persistent.cpp:41]: Error: "Unexpected token: size, near line: 56
" in file: "interface/zz_geocentric_unga.gui" near line: 59
[persistent.cpp:41]: Error: "Malformed token: width, near line: 96
Malformed token: height, near line: 97
" in file: "interface/zz_geocentric_unga.gui" near line: 98
[instanttextboxtype.cpp:138]: Not used, use maxWidth and maxHeight  file: interface/zz_geocentric_unga.gui line: 95
```

Line 56 is `size = {` inside an `iconType`; line 95 is the same inside an
`instantTextBoxType`. Both parsers reject the keyword outright, and the rejected block's contents
then surface as `Malformed token` errors.

## What the install says, kind by kind

Measured over all 177 vanilla `.gui` files (`scripts/kind-census.mjs`, `docs/kind-census.json`):

| kind | `size = { width height }` | `size = { x y }` | `maxWidth`/`maxHeight` | no size |
| --- | --- | --- | --- | --- |
| `containerWindowType` | 2903 | 0 | 0 | 0 |
| `gridBoxType` | 156 | 0 | 0 | 0 |
| `extendedScrollbarType`, `dropDownBoxType` | 18 | 0 | 0 | 0 |
| `instantTextBoxType` | 0 | 0 | 3138 / 2890 | 0 |
| `iconType` | 0 | 0 | 0 | 2779 |
| `checkboxType` | 0 | 0 | 0 | 77 |
| `buttonType` | 0 | 450 | 0 | 1617 |
| `effectbuttonType`, `guiButtonType`, `scrollbarType`, `listBoxType`, `smoothListBoxType`, `OverlappingElementsBoxType`, `spinnerType`, `editBoxType`, `windowType` | 0 | 0 | 0 | 0 |

So `x`/`y` is the button/list/scrollbar spelling (x is the width), `width`/`height` is the
container/grid-box spelling, text is sized by `maxWidth`/`maxHeight`, and an icon or checkbox
draws at its sprite texture's size.

## What changed, and where the regression guard lives

| engine line | rule | where it is enforced |
| --- | --- | --- |
| `Unexpected token: size` on an `iconType` / `instantTextBoxType` | `size-not-accepted` | `src/lib/syntax.mjs` (file text, `file:line`), `src/lib/validate.mjs` (tree), and the emitter, which writes the legal form instead |
| `Malformed token: width` / `height` inside a `size` block | `size-form-wrong` | `src/lib/syntax.mjs` |
| `Not used, use maxWidth and maxHeight` | `size-not-accepted` (the message quotes the engine) | as above |
| `Event <id> has no options` | `event-without-option` | `src/lib/filecheck.mjs` |
| a referenced key that exists nowhere | `missing-localisation`, `event-missing-loc`, `option-name-missing-loc` | `src/lib/validate.mjs`, `src/lib/filecheck.mjs` |
| a localisation `.yml` the engine ignores | `encoding-bom-missing` | `src/lib/filecheck.mjs` |

The engine lines are checked in as `scripts/fixtures/engine-error-baseline.log`, with the first 110
lines of the offending file beside it as `scripts/fixtures/engine-error-baseline.gui` (line numbers
preserved). `scripts/selftest.mjs` replays them: every error line in the log must produce a finding
at that line, the broken emission must FAIL validation, and the fixed emitter's output of the same
tree must PASS the same check.

## Round 2: three more per-kind fields, and one effect shape

A second run, after the `size` fixes had landed, went from 636 mentions of the file down to 119. Of
those 119, 98 were two fields and one was a third:

```
[persistent.cpp:41]: Error: "Unexpected token: custom_tooltip, near line: 171
" in file: "interface/zz_geocentric_unga.gui" near line: 171                       (x51)
[persistent.cpp:41]: Error: "Unexpected token: alwaysTransparent, near line: 201
" in file: "interface/zz_geocentric_unga.gui" near line: 201                       (x47)
[persistent.cpp:41]: Error: "Unexpected token: origo, near line: 985
" in file: "interface/zz_geocentric_unga.gui" near line: 985                       (x1)
```

Line 171 is an `effectbuttonType` carrying `custom_tooltip`, which is a **script** field: 3777 uses
inside the install's `events/`, and **0 uses on any element** of its 177 `.gui` files. Line 201 is a
`containerWindowType` carrying `alwaysTransparent`, which vanilla uses on text (1234), icon (1473),
button (166), guiButton (1), smoothListBox (21) and listBox (10) - and inside a `background = { ... }`
block (412 uses, e.g. `interface/planet_view.gui:255`) - but **never on a container**. Line 985 is an
`iconType` carrying `origo`, a `containerWindowType` field (175 uses, 0 anywhere else); the
equivalent on an icon is `centerPosition = yes` (285 vanilla uses).

Measured tooltip fields, per kind:

| kind | `pdx_tooltip` | `tooltip` | `tooltipText` / `delayedTooltipText` | `pdx_tooltip_delayed` | anchor offset/orientation |
| --- | --- | --- | --- | --- | --- |
| `buttonType` | 412 | 9 | 9 / 9 | 2 | 9 / 9 |
| `instantTextBoxType` | 74 | 48 | - | 2 | - |
| `iconType` | 50 | 11 | - | 2 | - |
| `guiButtonType` | 5 | 23 | 23 / 23 | - | - |
| `checkboxType` | 18 | - | - | - | - |
| `containerWindowType` | 1 | - | - | - | - |
| `effectbuttonType` | - | - | 2 / 2 | - | - |

The same run showed that **the `resource`/`amount` errors were ours too** (their `file:` names this
mod's own `common/button_effects/zz_geocentric_unga_button_effects.txt` and `events/`): 4.4.6 wants
the resource name as the key - `add_resource = { influence = -30 }`, 1161 vanilla uses - not
`add_resource = { resource = influence amount = -30 }`. Fourteen blocks were rewritten, and
`gui_check_files` reports the old shape as `effect-add-resource-shape` with the engine's own token.

### What changed

| engine line | rule | fix |
| --- | --- | --- |
| `Unexpected token: custom_tooltip` | `field-not-accepted` (error) | the emitter writes the kind's own tooltip field (`pdx_tooltip`, `tooltipText`, `tooltip`); `custom_tooltip`/`fail_text` are no longer GUI fields at all |
| `Unexpected token: alwaysTransparent` | `field-not-accepted` (error) | legal kinds only; a container's value moves into its `background` block |
| `Unexpected token: origo` | `field-not-accepted` (error) | containerWindowType only; an icon's `origo = center` becomes `centerPosition = yes` |
| `Unexpected token: resource` / `amount` | `effect-add-resource-shape` (error) | `add_resource = { <resource> = <amount> }` |
| `Missing localization key [x] for custom tooltip` / `fail_text` | `tooltip-key-missing-loc` (warning) | event and button-effect tooltip targets are checked against the keyset |

The field model is verified by measurement in both directions: `scripts/selftest.mjs` reports
**zero** `field-not-accepted` findings across all 177 vanilla `.gui` files (a gap in a kind's field
list shows up there as a finding - this is how twelve such gaps were found and closed), and the
fixture of the file that produced this log must produce a finding at every line the engine named.

Two parser bugs surfaced while closing the field lists, both of which had made elements look like
their parents:

* `key { ... }` without an `=` (`interface/galaxy_view.gui:1646`:
  `position { x = @[ shroudPlaneRadius ] y = @[ shroudPlaneRadius ] }`) ended the enclosing element
  at the first `}`, spilling its remaining fields - and any nested elements - into the parent. It
  had inflated the depth-1 container count from 1197 to 1267.
* `@[ name ]` is a variable reference in 4.4.6 (34 uses); it used to tokenise as the literal `@`.

### Before / after, round 2

| measurement | before | after |
| --- | --- | --- |
| `checkGuiSyntax` on the file text | **99 errors** (51 `custom_tooltip` + 47 `alwaysTransparent` + 1 `origo`) - exactly the engine's own set | **0** |
| `gui_layout_validate` on the imported tree | 99 errors | **0** (verdict pass) |
| `gui_check_files` on the .gui | 99 errors | **0** |
| `gui_check_files` on .gui + events + button_effects + both localisation files | 176 findings, 109 of them errors | **0** |
| engine-log mentions of the file | 119 | expected 0 |

`gui_layout_normalise` (a tool) and `normaliseLayoutForKinds` (the library call behind it) apply
every one of these translations to an already-built tree and report each change, so a caller can
fix a layout rather than only be told about it.

---

## Before / after on the trial's own file

`interface/zz_geocentric_unga.gui`, 7 top-level windows, 479 elements, with the mod's own
`common/button_effects` root supplied. Round 1 (the `size` keyword):

| measurement | before | after |
| --- | --- | --- |
| engine syntax errors (`checkGuiSyntax`) | **347** | **0** |
| `duplicate-name` | 0 (this revision had already renamed the per-window nav bars; on a file that keeps them the old code reported one per collision) | 0 |
| `sibling-overlap` | **20** (all cross-window) | **0** |
| `effect-unresolved` | **51** | **0** |
| `size-not-accepted` on the TREE | 296 (92 icons + 204 text elements) | 0 |
| `gui_check_files` on the file + events + button_effects + both localisation files | 158 errors, 296 warnings | **0** |

The same run over vanilla `interface/galactic_community_view.gui` (16 top-level windows) went from
25 `duplicate-name` + 428 `sibling-overlap` to **0** `duplicate-name` and 77 `sibling-overlap`; the
remaining 77 are genuine same-window overlaps (a button and its own label text), which is a
tolerance question, not a scoping one.

Two content defects the same run exposed were repaired in the mod as well: five `country_event`
blocks that opened a `custom_gui` window with no `option` (the engine logs
`Event geocentric_unga.4 has no options`), and seven localisation keys that were referenced and
never defined.

Round 2 then repaired five more localisation keys (`unga_agenda_effect_1/2/4/5`,
`unga_requires_influence` - the last one a `fail_text` inside an option's `custom_tooltip` block),
the fourteen legacy `add_resource` blocks, and the three field classes above.
