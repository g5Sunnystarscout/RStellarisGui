# Sources and corrections

Every web reference this project actually used, what was taken from it, and whether the
installed game (Stellaris **4.4.6 "Pegasus"**, `<Stellaris>`) confirmed or corrected it.

Method rule for this project, per the request: **research the web first, read the game files as
the fallback.** A guide is a hypothesis; only the install is evidence. Where the two disagree,
the install wins, and the disagreement is recorded below.

---

## 1. Sources used

### Stellaris Wiki - "Interface modding"
<https://stellaris.paradoxwikis.com/Interface_modding>

The single most useful reference. The page carries a version banner reading *"last verified for
version 3.7"*, so nothing from it was trusted without checking 4.4.6.

What was taken from it:

| Claim taken | Verified against 4.4.6? |
| --- | --- |
| A `.gui` file's elements must all be inside `guiTypes = {}` | **Confirmed** - 176 files spell it `guiTypes`, 1 spells it `guitypes` (`traits.gui`), so the comparison is case-insensitive |
| `orientation` = "anchor point of element, relative to parent element"; `origo` = "reference point for element's anchor point when using orientation" | **Confirmed by measurement** - see section 3. This is the two-anchor model `src/lib/layout.mjs` implements |
| `orientation` default `upper_left`, `origo` default `upper_left` | **Confirmed** - `upper_left` dominates the observed distribution and the naive model fits worst where it would |
| The four size value forms: `height = 100`, `100%` (of parent), `100%%` (of parent minus this element's position), `-10` (parent minus position minus 10) | **Confirmed** - 24 `%%` and 64 negative size values in vanilla. See correction 1 |
| `size = { x = N y = N }` is only usable when the sprite is a `corneredTileSpriteType` referenced with `quadTextureSprite` | **Confirmed** - `interface/diplomacy_caravaneer_event_view.gui:11-16` resizes a `GFX_event_button_*` cornered tile with the `x`/`y` form |
| The eight `orientation` values plus `center_up`/`center_down`/`center_left`/`center_right` | **Confirmed, but vanilla uses more spellings than documented** - see correction 2 |
| `@variable` lines "can be declared at any time in the .gui files, but it cannot ascend or traverse element nests"; may hold a string, number or percentage | **Confirmed** - 30 of 177 files declare them before `guiTypes`; `diplomacy_view.gui:50` uses `dynamic_extra_height = @dynamic_extra` |
| `moveable` requires a `background` | Not verified. Not enforced by any rule |
| A `custom_gui` window is defined by a `diplomatic = yes` event whose `custom_gui` names the `containerWindowType` | **Confirmed in practice, and now measured not to be a requirement** - the field resolves on a non-`diplomatic` event too (the engine builds a different event-window class). See correction 3 |
| You may not delete vanilla containers, only hide them by setting size to zero | **Confirmed as real practice** - `size = { width = 0 height = 0 }` appears in the custom-window sample and is why zero-size is a warning, never an error |
| `effectbuttonType` takes `effect`, naming a key in `/common/button_effects/`, and `pdx_tooltip` does not work on it (use `custom_tooltip`) | **Confirmed** - `src/lib/kinds.mjs` puts `custom_tooltip`/`fail_text` on the `effectbutton` kind and `pdx_tooltip` stays available but is not used in the emitted stubs |
| Fonts: `cg_16b` for normal text, `malgun_goth_24` for headers; the list is in `/interface/fonts.gfx` | **Confirmed** - `interface/fonts.gfx` declares 13 fonts, including both. Vanilla use counts: `cg_16b` 2833, `malgun_goth_24` 903 |
| `pdx_tooltip_delayed`, `pdx_tooltip_anchor_offset`, `pdx_tooltip_anchor_orientation`, `web_link`, `rotation`, `centerPosition`, `mirror`, `multiline`, `borderSize`, `dynamic_extra_height`, `text_color_code`, `vertical_alignment`, `appendText` exist as fields | **Confirmed present** - but `appendText` has **0** uses in the 177 vanilla `.gui` files, so it is modelled and emittable but never generated |
| `custom_gui_option` rows need a button named `option_button` with `text = "OPTION_TEXT"` | **Confirmed exactly** - see section 2 |

Also useful from the same page: the console commands `reload <file>.gui`, `reload texture all`
and `guibounds`/`debugtooltip` for in-game UI debugging, and the fact that some UI metrics live in
the `interface` category of `defines`. Neither is used by this project's code, but `guibounds` is
the manual equivalent of what this tool does statically, which is worth knowing when explaining
the tool to a modder.

### RStellarisScribe (sibling project, same workspace)
`<clone>\RStellarScribe` - not a web source, but the structural convention this project
follows: zero-dependency Node ESM MCP stdio server, `src/index.mjs` entry, `src/tools/index.mjs`
registry with full JSON schemas, `scripts/selftest.mjs` with named `check(name, condition, detail)`
assertions, `scripts/protocol-test.mjs` driving the real server over a pipe, AGPL headers.
`src/lib/mcp.mjs` here is a re-implementation of that project's transport, unchanged in observable
behaviour, plus an `image` content block.

### Paradox script syntax (braces, `key = value`, `#` comments, quoting)
Taken as a family-wide convention rather than from one page; implemented in
`src/lib/paradox.mjs`. The only non-obvious part is `.gui`-specific: `50%` and `100%%` are single
literals and the tokenizer keeps the `%` suffix attached to the number, because the suffix *is*
the size semantics rather than an operator.

### PNG specification (container, IHDR/IDAT/IEND, CRC-32, the five scanline filters, Paeth)
Implemented in `src/lib/png.mjs` for both writing and reading. Needed for reading because four
vanilla textures are PNG (see section 4).

### S3TC / BC1, BC2, BC3 bit layouts (DXT1/3/5)
Implemented from the documented block formats in `src/lib/dds.mjs`. **No library was vendored and
no dependency was added**: BC1/2/3 is ~120 lines of bit arithmetic, and writing it keeps this
project at zero runtime dependencies (see "Library choice" in the README). The decoder was
verified against real files, not just synthetic buffers: `gfx/models/ships/megastructures/
galactic_crucible/infernal_01_galactic_crucible_normal.dds` is a 4096x4096 BC3 with 13 mips and
decodes its 128x128 mip.

---

## 2. The `option_button` / `OPTION_TEXT` rule, in full

Verified in `interface/diplomacy_caravaneer_event_view.gui:5-16`:

```
containerWindowType = {
    name = "enclave_caravaneer_option"
    position = { x=0 y=0 }
    size = { width = 388 height = 30 }
    moveable = no

    buttonType = {
        name = "option_button"
        quadTextureSprite = "GFX_event_button_452_caravaneer"
        position = { x=0 y=8 }
        font = "cg_16b"
        text = "OPTION_TEXT"
    }
    ...
}
```

And `OPTION_TEXT` appears as a `text` value in 12 vanilla `.gui` files
(`crisis_conversation_event_window.gui:231`, `diplomacy_artist_event_view.gui:15`,
`diplomacy_caravaneer_event_view.gui:15`, ...). It is an **engine sentinel**, replaced at runtime
with the event option's own text. It is never defined in any localisation file, so the validator
exempts it explicitly (`LOC_SENTINELS` in `src/lib/validate.mjs`); before that exemption it was a
false "missing localisation" warning on every generated option row.

The event side is a **scalar string**, not a block - all 38 vanilla uses look like this
(`events/biogenesis_crisis_events.txt:1305`):

```
country_event = {
    id = biocrisis.155
    diplomatic = yes
    custom_gui = "enclave_curator_window"
    custom_gui_option = "enclave_curator_option"
    ...
}
```

---

## 3. The rect model, and how it was verified rather than assumed

`src/lib/layout.mjs` implements:

```
anchor = anchorPoint(parentRect, orientation)   # nine-point, on the PARENT
pivot  = anchor + position
corner = pivot - size * origoFraction           # nine-point, on the ELEMENT
```

This was checked against real input, not against the wiki's prose, because "which corner"
is exactly the sort of claim a version-lagged guide can get wrong in a way that still reads
plausibly.

**Test: every element whose parent is the fixed 1920x1080 root must land on screen.**

Parsed all 177 vanilla `.gui` files (`scripts/kind-census.mjs`; the per-kind totals it measures are
in `docs/kind-census.json`). That root holds 1197 depth-1 elements; 37 are slide-in panels and are
excluded, and 855 of the remaining 1160 have a positive computed size:

| Model | On screen |
| --- | --- |
| Two-anchor model (this project) | **807 / 855 = 94.4%** |
| Naive "`position` is always the top-left corner" | 765 / 855 = 89.5% |

Per orientation/origo for the two-anchor model: `upper_left/upper_left` 645/660,
**`center/center` 89/89 (100%)**, `center/upper_left` 60/61, `upper_right/upper_left` 6/36,
`lower_left/upper_left` 5/6, `lower_right/upper_left` 1/2, `lower_left/lower_left` 1/1.

The `upper_right` row looks bad until you look at what those elements are: every one is a
**slide-in panel**. `interface/advisor_window.gui:29-37` is the canonical case - `position =
{ x = 500 y = 145 }`, `show_position = { x = -370 y = 145 }`, `hide_position = { x = 500 y = 145 }`,
`animation_type = decelerated`. The recorded `position` is deliberately off-screen; the window
animates in. Those are excluded from the table above (37 elements) and exempted by the validator's
`allowOffscreenAnimated` option. This is also why that exemption exists at all.

**Corroborating evidence - the sign convention.** If the model is right, `position` must be
negative when the anchor is on the right or bottom edge. Measured over every element with a
`position` in the 177 files:

| orientation | n | x negative | y negative |
| --- | --- | --- | --- |
| `upper_left` | 10353 | 939 | 901 |
| `upper_right` | 552 | **458** | 16 |
| `lower_left` | 277 | 65 | **169** |
| `center` | 208 | 104 | 126 |
| `center_up` | 187 | 88 | 3 |
| `lower_right` | 124 | **116** | **110** |
| `center_down` | 58 | 48 | **55** |
| `center_left` | 24 | 1 | 4 |
| `center_right` | 9 | 6 | 5 |

Read it as a 2x2: right-anchored means negative x, bottom-anchored means negative y,
left/top-anchored means positive. `lower_right` at 114/122 negative-x *and* 108/122 negative-y is
only consistent with the two-anchor model. This is the measurement that settled the design.

### 3a. The y-sign question, re-measured over the whole corpus (nested elements included)

The original test above was run on **depth-1 elements only** - the 1197 top-level containers whose
parent is the fixed 1920x1080 root. That is the one place where the question cannot be answered:
at depth 1 the anchor is the screen's own bottom edge, so "outside the parent" and "below the screen"
are the same sentence. `scripts/calibrate-coords.mjs` re-runs it for every element at every depth and
reports the alternative model side by side:

```
node scripts/calibrate-coords.mjs --compare
```

| measurement (containment: fraction of a child rect inside its parent rect, higher is better) | shipped model | y negated for the bottom anchors |
| --- | --- | --- |
| whole corpus (11427 sized elements) | **0.7733** | 0.7472 |
| family `upper_*` (10481) | 0.7730 | 0.7730 (unchanged - the proposal only touches bottom anchors) |
| family `center*` (556) | **0.8019** | 0.7204 |
| family `lower_*` (390) | **0.7398** | 0.0938 |
| nested `lower_*`, all parents (376) | **0.7332** | 0.0815 |
| ... inside an `upper_*` parent (217) | **0.6548** | 0.1045 |
| ... inside a `center*` parent (126) | **0.9011** | 0.0287 |
| ... inside a `lower_*` parent (33) | **0.6079** | 0.1317 |
| all depth-1, parent = screen (924) | **0.9502** | 0.9428 |

The shipped model wins on every line. **Negating y for `lower_*` is a regression of roughly a factor
of seven on exactly the nested cases the original test could not see** - which is why the old 93.7%
figure never contradicted it.

The reason is visible in the vanilla authors' own idiom. `position` is added to the anchor's point
for every orientation, so the anchor's *location* is what changes:

| declaration | where the element goes |
| --- | --- |
| `combat_view.gui:41-45` `lower_left, origo = lower_left, position = { x = 35 y = -42 }`, 560x568 | bottom-left corner 42 px above the screen bottom -> the window's bottom edge 42 px above the screen bottom. Negated: 42 px BELOW the screen. |
| `combat_view.gui:159-164` `left_stats`, `lower_left, origo = lower_left`, 265x87 at `{ x = 7 y = -11 }` | bottom edge 11 px above its window's bottom edge -> a stats bar inside its window. Negated: hangs 22 px below the window. |
| `galactic_community_view.gui:1100-1107` `assign_button`, `lower_left`, `{ x = -10 y = -45 }` in an 800x50 row | 45 px above the row's bottom edge. |
| `megastructure_view.gui` `tabs`, `lower_left, origo = lower_left`, `{ x = -20 y = -15 }` | a tab strip just above the parent's bottom edge. |
| `galaxy_view.gui` `terms_buttons`, `lower_left`, `{ x = 0 y = 0 }`, `height = 42` | flush with the panel's bottom edge, extending 42 px past it - a button row that straddles the panel edge, which is how that row is built. |

The parent's `orientation` changes nothing: `left_stats` is `lower_left` inside a `lower_left`
parent, `assign_button` is `lower_left` inside a default `upper_left` parent, and both read from the
child's own anchor. Applying the parent's orientation as well breaks `combat_view`.

So the model recorded in section 3 stands, **including for nested elements**, and the calibration is
kept in the repository as the guard: `scripts/selftest.mjs` asserts that the canonical converter
reproduces these figures exactly and that no declared position is sign-flipped.

---

## 4. Corrections and disagreements (install vs web)

### Correction 1 - negative and `%%` sizes are legal, and the brief was wrong to imply otherwise

The brief listed "zero/negative sizes" as a validator rule. The wiki documents four legal forms
and the install uses them: **64 negative size values** and **24 `%%` values** across the 177
vanilla `.gui` files. Examples: `additional_content.gui:276 width = -16 height = -16`,
`additional_content.gui:219 size = { width = 100% height = 100%% }`.

So `src/lib/layout.mjs` treats them as first-class semantics - `100%%` resolves to
`parent * 100% - position`, and `-16` resolves to `parent + (-16) - position` - and the validator
only reports a **negative resolved** size (a warning), never the legal declared form. `50%` and
`100%%` are single tokens in the lexer.

### Correction 2 - `orientation` has more spellings than documented, including typos

The wiki lists nine values. Vanilla 4.4.6 uses at least 30 distinct spellings, including
`CENTERUP` (1x), `LOWER_LEfT` (2x), `TOP_LEFT` (2x), `UPPER_CENTER` (14x), `left_up`, `right_down`,
and bare `LEFT`/`RIGHT`/`TOP`/`BOTTOM` as synonyms. Mixed case is normal
(`UPPER_LEFT` 770 vs `upper_left` 388). `src/lib/kinds.mjs` therefore normalises by lower-casing
and stripping `_`/`-`/spaces, and maps every observed synonym onto one of nine canonical anchors.
It does **not** invent a mapping for `LOWER_LEfT` - that already normalises to `lower_left`, which
is presumably what the author meant.

Similarly `format` is overloaded: the wiki documents `left`/`right`/`center` for text alignment,
but vanilla also carries `UPPER_LEFT` (193x), `LEFT` (80x), `centre` (69x, British spelling),
`CENTER` (45x) and `CENTERED_UP`/`CENTERED_UP_BY_LINE` (12x) in the same field on
`overlappingElementsBoxType`/`gridBoxType`. This project does not validate `format` values, because
the legal set appears to depend on the element kind.

### Correction 3 - `custom_gui` and `diplomatic = yes`

The wiki says a custom window is shown by a `diplomatic = yes` event. The install agrees almost
perfectly, so this is a *confirmation* with a caveat rather than a correction:

* **156** `custom_gui` uses across all 5570 `.txt`/`.gui`/`.gfx`/`.yml` files in the install.
* **154** sit inside a block that also declares `diplomatic = yes`.
* The **2** exceptions are `common/districts/00_DOCUMENTATION.txt` (a commented-out example) and
  `events/test_events.txt`. There are **zero** real vanilla uses without it.
* By event type: `country_event` 146, `carrier_event` 4, `situation_event` 2, `fleet_event` 1.
* Nine distinct window names are referenced.

An earlier claim in this project's brief - 155 uses of which only 71 carried `diplomatic = yes` -
**does not reproduce and was withdrawn** by the requester. No grep producing it was ever found.

Decision encoded in `src/lib/emit.mjs`: the emitted event stub **includes `diplomatic = yes` by
default**, but `diplomatic: false` is accepted and produces a **warning, not a refusal**, because
the underlying in-game test that motivated the objection only ever proved the mod loaded, not that
the window appeared. Refusing would over-constrain the tool on the strength of evidence that does
not exist.

**Settled 2026-10-06, in a loaded game: the field is a convention, and it is NOT required.** The
non-diplomatic `custom_gui` window renders - `PROBE-RESULTS.md` §4 (run F). Firing the probe's six
events from the debug console, `.1` (`diplomatic = yes`, a name that resolves) showed a **diplomatic**
window and `.2` (no `diplomatic`, the same name) showed an **event** window: the engine chooses a
different event-window class and still resolves `custom_gui`. That matches the load-time
`eventmanager.cpp:458: Event gui_probe_q2.2/3 has no pictures`, which names exactly the non-diplomatic
pair. The same run settled the far more dangerous half: a `custom_gui` name that resolves to nothing is
**never validated**, and on a `diplomatic = yes` event the engine falls back to `interface/popup.gui`'s
`ok_popup_window`, demands the diplomatic window's ten hardcoded names inside it, and **crashes**
(`EXCEPTION_ACCESS_VIOLATION`). So the rule that matters is not "add `diplomatic = yes`" but **"the
name must exist"** - graded as an ERROR on the diplomatic path and a warning at most otherwise (GAP-17
in `PLUGIN-GAPS.md`). The emitter's default stays as it is: convention plus the diplomatic window
class, not a requirement. **The wording that still asserted the old requirement has since been
corrected** - `src/lib/filecheck.mjs` and `src/lib/emit.mjs` no longer say the window "may never be
constructed" without the flag - and the rule that was missing is now in place
(`custom-gui-unknown-window`, graded by path). GAP-17 in `PLUGIN-GAPS.md` records both; section 21 of
`gui-pitfalls.md` is the standing account.

### CONFIRMED 2026-10-06 - "the game crashes if the container name does not match"

The wiki says the event's `custom_gui` value and the `containerWindowType` name "have to be
absolutely similar, in other cases game crashes". **This sat as UNVERIFIED for two rounds**, because
confirming it needs a deliberately mismatched name in a running game, which the headless rounds could
not do. **The probe run of 2026-10-06 did it, and the wiki is right - with one qualifier the wiki does
not carry: the crash requires `diplomatic = yes` in the same block.**

* `diplomatic = yes` + `custom_gui = "gui_probe_q2_zzz_no_such_window"` (defined nowhere):
  `[gui.cpp:1057]: Tried to get gui_type [gui_probe_q2_zzz_no_such_window] which does not exist`, then
  the engine substitutes `interface/popup.gui`'s `ok_popup_window` and demands the diplomatic event
  window's ten hardcoded names inside it - ten `[containerwindow.h:88]: interface/popup.gui: Could not
  find <Kind> "<name>" in window "ok_popup_window".` lines - then `Unhandled Exception C0000005
  (EXCEPTION_ACCESS_VIOLATION)` (`crashes\stellaris_20261006_002451`, exception dated `00:24:52`).
* The **same** name with no `diplomatic = yes`: **zero** error lines - not even the lookup line - no
  crash, and the engine drew the **ordinary default event window** instead of the one the event named
  (this is the v2 run's correction to "a fallback window", `PROBE-RESULTS.md` §10.1); `game.log`
  records its option being selected twice, at `00:24:42` and `00:24:47`.

Full evidence, the other five events and the per-event proven/reported split: `PROBE-RESULTS.md` §4.
Filed as **GAP-17** in `PLUGIN-GAPS.md` and now CLOSED: `custom-gui-unknown-window` resolves the name
against the plugin's own index (the install's `containerWindowType` names plus every extra root, plus
any `.gui` passed alongside) and grades it by path - ERROR with `diplomatic = yes`, warning at most
without it - because the engine refuses to resolve the name at load time and no log check can catch
what it does instead. The emitter already makes the two match by construction (`windowName` defaults to
`layout.root.name`), and the validator checks the name against the layout; the case where the name
exists in **no** root at all is now the rule above.

### Correction 4 - texture containers are not only DDS

The brief and the DDS census both assume `gfx/**/*.dds`, and the sample of 4261 files confirms
only BC1/BC2/BC3 + uncompressed are present. **But four textures referenced from `.gfx` via
`spriteType` are PNG, not DDS:**

| file | size | PNG header |
| --- | --- | --- |
| `gfx/interface/main/avoid_system_bg.png` | 440x49 | 8-bit, colour type 6 (RGBA), non-interlaced |
| `gfx/interface/main/starsystem_panel_left.png` | 80x48 | same |
| `gfx/interface/main/starsystem_panel_right.png` | 34x34 | same |
| `gfx/interface/main/striped_bg.png` | 440x49 | same |

An earlier revision of the texture reader reported these as four header failures and could only
render them as placeholders. Both are fixed: `readTextureHeader` dispatches on the file signature
rather than the extension, and `src/lib/png.mjs` now decodes PNG as well. The index went from
*4 failures out of 6866* to **0**, split 6862 DDS + 4 PNG. The same lesson as the sprite-name
gotcha in `src/lib/gfx-index.mjs`: index the signature, not the extension.

### Disagreement resolved in the install's favour - `quadTextureSprite` quoting

The brief states `quadTextureSprite` is "bare name, no quotes, in vanilla". Measured over all 177
`.gui` files: **2678 quoted vs 2 bare**. The two bare uses are
`interface/fleet_view.gui:712` and `:1789`, both `quadTextureSprite = GFX_tiling_button_standard`.
So the brief described the exception, not the rule. The emitter **always quotes** sprite
references, matching the 99.9% case.

### Where the brief's counts and the install's counts differ, and why

The brief quotes `containerWindowType 3304`. Measured three different ways, all correct, all
different:

| measurement | count |
| --- | --- |
| `containerWindowType` keyword, blocks at **any** depth, whole install | 3305 |
| `containerWindowType` **names** the asset index holds (de-duplicated; the index is what a `custom_gui` resolves against, and the engine keeps the last definition of a repeated name) | 2436 |
| direct children of `guiTypes` (`containerWindowType` + `positionType` + `windowType` + ...) | 1317 |
| every element use at any depth, all kinds | 12801 |

3304 is within one of the first figure (the brief measured a slightly different snapshot), and the
three numbers are not interchangeable. `scripts/gui-census.mjs` asserts the figures it can stand
behind, and `scripts/kind-census.mjs` writes the per-kind table to `docs/kind-census.json`, which is
what every number in this project's documentation is generated from.

The brief also quotes 9245 sprite names; the strict `name = "GFX_..."` pattern yields **9197
distinct** names in 4.4.6, with 9233 raw occurrences of `name = "GFX_..."` before de-duplication
and 9197 after. The `gfx-index.mjs` comment states the measured figure.

---

## 5. Measured facts this project relies on (all from `<Stellaris>`, 4.4.6)

<!-- GENERATED:census-summary -->
Measured on 177 vanilla `.gui` files of Stellaris v4.4.6 (`<Stellaris>`, 0 parse failures):

- **12801 element uses** at any nesting depth, of which 1197 are top-level `containerWindowType`s across the files;
- 30 of the 177 files declare `@variables`;
- the asset index sees **9197 sprites**, 13 bitmap fonts, 6883 distinct textures and 2436 `containerWindowType` names.

Regenerate with `node scripts/kind-census.mjs && node scripts/generate-docs.mjs`.
<!-- /GENERATED -->

<!-- GENERATED:emittable-kinds -->
| kind | keyword | size the engine accepts | vanilla uses |
| --- | --- | --- | --- |
| `container` | `containerWindowType` | `size = { width height }` | 3305 |
| `text` | `instantTextBoxType` | `maxWidth` / `maxHeight` | 3220 |
| `icon` | `iconType` | no size at all | 2779 |
| `button` | `buttonType` | `size = { x y }` | 2067 |
| `effectbutton` | `effectbuttonType` | `size = { x y }` | 2 |
| `gridBox` | `gridBoxType` | `size = { width height }` | 260 |
| `smoothListBox` | `smoothListBoxType` | `size = { x y }` | 243 |
| `listBox` | `listBoxType` | `size = { x y }` | 43 |
| `overlappingElementsBox` | `OverlappingElementsBoxType` | `size = { x y }` | 188 |
| `guiButton` | `guiButtonType` | `size = { x y }` | 198 |
| `scrollbar` | `scrollbarType` | `size = { x y }` | 24 |
| `editBox` | `editBoxType` | `size = { x y }` | 85 |
| `checkbox` | `checkboxType` | no size at all | 77 |
| `spinner` | `spinnerType` | `size = { x y }` | 40 |
| `window` | `windowType` | `size = { x y }` | 24 |
| `dropDownBox` | `dropDownBoxType` | `size = { width height }` | 13 |
| `matrix` | `matrix` | `size = { width height }` | 0 |
| `bar` | `bar` | `size = { width height }` | 0 |

That is 12568 of the install's 12801 element uses (98.2%).
<!-- /GENERATED -->

<!-- GENERATED:parsed-only-kinds -->
`position` (233) - `positionType`
<!-- /GENERATED -->

---

## 6. `custom_gui`: the engine's own contract, measured

`docs/gui-pitfalls.md` is the reference; this section records only the NUMBERS and where each came
from, because every one of them is a claim the plugin's rules rest on.

| measurement | value | how |
| --- | --- | --- |
| `custom_gui` uses in the install | **156**, in 16 files, naming **10 distinct** containers | `node out/probe-custom-gui.mjs` - scans every `.txt`/`.gui` under the install, not only `events/` |
| the one container named most | `enclave_caravaneer_option` (85) - an OPTION ROW, not a window | same |
| events carrying `force_open = yes` | 113 of 5563 (174 event files) | `node out/probe-event-patterns.mjs` |
| events carrying `custom_gui` | 36 | same (the event-level key; the 156 above counts every use, option rows included) |
| events carrying BOTH | **0** | same |
| names in the engine's contract string table | 13, contiguous in `stellaris.exe` right after the `diplomatic_eventwindow.cpp` path | `node out/probe-binary-strings.mjs` |
| names a real event window declares | 26-31 of the 32 this project carries, for 9 of the install's 10 event windows | `node out/probe-contract-windows.mjs` |
| `.gui` files declaring each name | `close` 104, `portrait` 42, `tts_button` 26, `empire_name` 20, `empire_flag`/`confirm_button` 17, `heading` 16, `option_list` 14, `portrait_background`/`leader_traits` 13, 10-12 for the rest; `event_option_entry` 1, `leader_traits_box` 2, `leader_traits_label` 2, `INCOMING_TRANSMISSION` 0, `PICK_EVENT_OPTION` 0 | `node out/probe-contract-census2.mjs` |
| the demanded set derived from those two columns | **26** of 32 (rule: not a note, AND a working window declares it OR >= 10 vanilla files do) | `src/lib/contract.mjs`, asserted in `scripts/selftest.mjs` |
| the container the 10 vanilla `custom_gui` windows are | `enclave_artist_window`, `enclave_caravaneer_window` (+`_edit`), `enclave_champions_forge_window`, `enclave_curator_window`, `enclave_mercenary_window`, `enclave_salvager_window`, `enclave_trader_window`, `formless_diplomacy_window`, `DiplomaticEventWindow` | `node out/probe-detection.mjs` |

The log lines the cross-file rules rest on, verbatim from
`%USERPROFILE%\Documents\Paradox Interactive\Stellaris\logs\`:

```
game.log   [06:55:21][eventcommands.cpp:88]: Event geocentric_unga.1 added info about event selection. selectedOption 0, human 1, playerEventId 9
game.log   [06:55:24][eventcommands.cpp:88]: Event geocentric_unga.1 added info about event selection. selectedOption 1, human 1, playerEventId 10
error.log  [diplomatic_eventwindow.cpp]: Could not find <name> in window <window>
error.log  [effect.cpp:471]: Error: "Unexpected token: resource, ..."
error.log  [localisation.cpp]: Missing localization key [unga_*]
```

`gui_log_scan` reads all of them, in order, and flags two option-0 selections of one event as a
close-then-reopen cycle. The shipped mod's log (above) shows the FIXED behaviour: a close
(`selectedOption 0`) followed by a navigation row (`selectedOption 1`), never by another option 0.

---

## 7. Deliberate non-sources

* The stale **Stellaris 4.1.7** install at `D:\SteamLibrary\steamapps\common\Stellaris` was never
  read. `src/lib/paths.mjs` refuses it by absolute path (`FORBIDDEN_GAME_ROOTS`), because a 4.1.7
  interface tree would produce plausible-looking wrong sprite sizes and element counts.
* `cwtools` (<https://github.com/cwtools/cwtools>) was noted as a reference for Paradox script
  grammar but not used: this project needs line numbers on every node and needs `@variable`
  declarations preserved as data, which the sibling project's parser already handles for `.gfx`.
* No `.dds` decoder library was vendored or depended on. See "Library choice" in the README for
  the reasoning: BC1/2/3 plus uncompressed is small enough to implement and verify directly, and
  that keeps the project at zero runtime dependencies with no build step.
* The game was never launched. Nothing here was validated by running Stellaris, which is why the
  name-mismatch-crash claim above stays unverified.
