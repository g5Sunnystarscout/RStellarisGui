# GUI pitfalls: what a real custom_gui window cost, and what now checks it

Reference material, not prose. Every entry states the DEFECT, the EVIDENCE (a vanilla file:line, an
engine log line, or a byte in `stellaris.exe`), HOW IT WAS FOUND, and WHAT ENFORCES IT NOW.

Source project: `<mods>\geocentric_origin` - a working Stellaris **4.4.6 "Pegasus"** mod
whose "UN General Assembly" window set (six `custom_gui` windows in
`interface/zz_geocentric_unga.gui`) was built with this plugin over many rounds, each round driven
by the engine's own `logs/error.log` and `logs/game.log`. Write-ups:
`<clone>\unga-fix\RESULT.md`, `RESULT-SIXFIX.md`, `RESULT-ORIENT.md`,
`<clone>\un-ga\FINDINGS-RStellarisGui.md`.

Rule ids in `code font` are implemented; see `src/lib/validate.mjs` `RULE_SEVERITY` and
`RULE_DESCRIPTIONS` for the full list and the README table generated from them.

---

## 0. How to read the evidence

| shorthand | what it is | how to reproduce |
| --- | --- | --- |
| `binary` | a literal in `<Stellaris>\stellaris.exe` (46,418,552 bytes) | `node out/probe-binary-strings.mjs` |
| `vanilla` | a count over the install's own 177 `.gui` files | `node out/probe-contract-census2.mjs`, `node out/probe-contract-windows.mjs` |
| `events` | a count over the install's own `events/` (174 files) | `node out/probe-event-patterns.mjs`, `node out/probe-custom-gui.mjs` |
| `log` | the engine's runtime output | `node out/probe-reallog.mjs`, or the `gui_log_scan` tool |
| `measured` | this project's own experiment, stated with its numbers | the write-ups above |

**The method rule this document exists to enforce (see section 10): the engine is the source of
truth - its binary, its generated `script_documentation`, its logs. Vanilla content is a
cross-check, never the source.** Three separate wrong conclusions in this project came from
counting what vanilla *uses*.

---

## 1. A `custom_gui` window is not a blank canvas

**Defect.** The engine constructs a `custom_gui` window against a FIXED set of element names, looked
up BY NAME inside the container the event names. A missing one is a null dereference: the game
crashes.

**Evidence.**

* `binary`: `stellaris.exe` holds the source path
  `C:\mnt\gsg\stellaris\augustus\augustus\source\graphics\diplomatic_eventwindow.cpp` and,
  immediately after it, one contiguous ASCII table of the names that file asks for:

  ```
  event_option_entry  empire_info_bg  EVENT_DIPLO  option_button  INCOMING_TRANSMISSION
  leader_traits  leader_traits_box  leader_details  leader_species  option_list
  PICK_EVENT_OPTION  leader_traits_label  empire_traits_label
  ```

* `vanilla`: 123 of the 177 `.gui` files declare at least one of those names; the 10 real event
  windows (`enclave_caravaneer_window`, `DiplomaticEventWindow`, `formless_diplomacy_window`, ...)
  declare 26-31 of the 32 names this project carries. The rest of the set (`heading`, `action_title`,
  `action_desc`, `alien_message`, `alien_message_background`, `tts_button`, `close`,
  `portrait_background`, `portrait`, `empire_name`, `empire_government_type`,
  `empire_personality_type`, `empire_flag`, `empire_ethics_icons`, `focus_button`, `confirm_button`,
  `opinion_window`, `opinion_bg`, `their_opinion_icon`, `their_opinion`) is a USAGE measurement.
* `log`: the crash dumps `20261004_235121`, `20261005_000027`, `20261005_000450`, and the mod's own
  header at `interface/zz_geocentric_unga.gui:2726-2730`:
  `# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE`.
* `log`, **2026-10-06 — the same crash reached from the OTHER side: not a window that is missing a
  name, but the WRONG window.** On a `diplomatic = yes` event whose `custom_gui` value is defined
  nowhere, the engine logged `[gui.cpp:1057]: Tried to get gui_type [gui_probe_q2_zzz_no_such_window]
  which does not exist` and then did **not** abort: it substituted `interface/popup.gui`'s
  `ok_popup_window` and demanded the names above **inside that popup** - ten
  `[containerwindow.h:88]: interface/popup.gui: Could not find <Kind> "<name>" in window
  "ok_popup_window".` lines (`tts_button`, `heading`, `EVENT_DIPLO`, `empire_info_bg`, `empire_name`,
  `empire_government_type`, `empire_personality_type`, `empire_flag`, `portrait`,
  `portrait_background`) - then `Unhandled Exception C0000005 (EXCEPTION_ACCESS_VIOLATION)`. The stack
  body is **byte-identical** to the three dumps above; only the ASLR base address differs. The **same**
  unresolvable name on a non-`diplomatic` event logged nothing, did not crash, and still displayed a
  window. `PROBE-RESULTS.md` §4; GAP-17 in `PLUGIN-GAPS.md`.

**How it was found.** The window rendered, then the game died on open. The engine log's
`Could not find <name> in window <window>` line is the only signal, and it appears on the frame
before the crash.

**Enforced by** `custom-gui-contract-missing` (error when an event names the window, warning when the
checker merely inferred it), `custom-gui-contract-duplicate`, `custom-gui-contract-nesting`,
`custom-gui-portrait-nesting`, `custom-gui-close-not-last` - all in `src/lib/contract.mjs`, wired
into `gui_layout_validate`, `gui_check_files` and therefore the pre-write gate.

**The structural rules that cost the most, in order:**

| rule | why | reference |
| --- | --- | --- |
| `option_list` must be a **direct child of `EVENT_DIPLO`** | the engine instantiates one option row per event option into THAT list; a deeper list is never instantiated, so the window opens with no options and cannot be dismissed. Measured: an early revision nested it two containers deep and the sidebar stayed empty | `vanilla interface/diplomacy_caravaneer_event_view.gui:353-354` |
| the `portrait` **icon** must be nested inside the `portrait` **container** | the engine draws the character into the inner element; the container is what clips/masks it. Vanilla nests one of each name in every event window | `vanilla interface/diplomacy_caravaneer_event_view.gui:145-152` |
| `action_title` / `action_desc` must live **inside `EVENT_DIPLO`** | the engine resolves both inside that container, so a copy elsewhere is not the one it fills | `vanilla .../diplomacy_caravaneer_event_view.gui:328-352` |
| `close` must be the window's **last direct child** | draw order is the engine's only z-order. Historical: `close` was direct child #31 of 43 with `EVENT_DIPLO` (200x620) after it, so `EVENT_DIPLO` drew over the X | `measured, RESULT.md §1` |

**Reference window to copy:** `interface/diplomacy_caravaneer_event_view.gui`
(`containerWindowType enclave_caravaneer_window`, lines 34-364). It is the shape the working mod's
six windows were built from.

**Not every name is demanded, and the reason is stated.** Demanding all 32 would report the WORKING,
live-verified mod - and 8 of the install's own 10 event windows - as broken. The demanded set is
`26`: a name is demanded when it is not a note, AND either a real `custom_gui` window declares it or
at least `CONTRACT_MIN_WINDOWS` (10) vanilla `.gui` files do. The six carried as NOTES
(`event_option_entry`, `INCOMING_TRANSMISSION`, `leader_traits_box`, `PICK_EVENT_OPTION`,
`leader_traits_label`, `empire_traits_label`) are each explained per entry in
`src/lib/contract.mjs`. The 8 windows that are not real event windows cannot produce an error at all:
`explicit` is false for them.

**What is deliberately NOT an error:** `option_button` is not demanded at the window level. It is
resolved inside the OPTION ROW container an event names with `custom_gui_option`, and vanilla's
`enclave_caravaneer_option` is a separate top-level container for exactly that reason. Treating it as
a window-level requirement produced three false errors on the working mod before the shape gate
existed.

---

## 2. A window is dismissed ONLY by choosing an event option

**Defect.** There is no engine effect that closes a `custom_gui` window. Multi-panel navigation
implemented with effects leaves the window open, or stacks a second one.

**Evidence.** `log`/install: `logs/script_documentation/effects.log` lists 1056 effects. None matches
close/window/dismiss/gui (the nearest are `close_branch_office`, `set_closed_borders`,
`open_shroud_tab`, `force_show_diplomacy`, `force_show_espionage`). `measured`: an
`effectbuttonType` inside a live window runs its button effect and the window STAYS - that is what
produced two stacked NATO windows in the trial mod.

**How it was found.** Two windows on screen at once, then a window that would not go away.

**Therefore:** one event per panel, and navigation as event options:

```
option = {
    name = unga_sidebar_nato
    custom_gui = "geocentric_unga_nav_option"     # which row container draws this option
    custom_tooltip = unga_nav_tip_nato
    hidden_effect = { country_event = { id = geocentric_unga.2 } }
}
```

Vanilla switches sub-screens exactly this way: `equipped events/caravaneer_events.txt:498-532`
(a `cara.200` option whose `hidden_effect` fires `cara.210`). Kasako's framework does the same
(`events/FW_evts_CORE_panel.txt:276-380` -> `FW_efts_MODMENU.txt:141`).

**Enforced by** `event-without-option` (an event that renders a `custom_gui` window still needs an
`option`: the option is what closes the window) - `src/lib/filecheck.mjs`.

---

## 3. The close button selects OPTION 0 - and that option cannot unconditionally re-fire the window

**Defect.** The engine makes the window's close control select the FIRST event option, and it
CONSUMES the event BEFORE that option's effects run.

**Evidence.** `log`, verbatim, from
`%USERPROFILE%\Documents\Paradox Interactive\Stellaris\logs\game.log`:

```
[06:52:09][effect.cpp]: UNGA diag: CLOSE button pressed
[06:52:09][eventcommands.cpp:88]: Event geocentric_unga.1 added info about event selection. selectedOption 0, human 1, playerEventId 9
[06:52:09][scripted effect]: ... geocentric_unga.1 NOT active, firing it
[06:52:10][eventcommands.cpp:88]: Event geocentric_unga.1 added info about event selection. selectedOption 0, human 1, playerEventId 10
```

The fix has four consequences, all of them load-bearing:

* **(a)** option 0 must not unconditionally re-fire the window's own event, or the window closes and
  instantly re-opens - "关掉一帧，然后立马重新打开" (closed for one frame, then straight back).
* **(b)** `has_active_event` **cannot** detect "this window was open a moment ago". The log above
  shows why: the event is already consumed by the time the option's trigger is read.
* **(c)** the ONLY code that runs earlier is the close control's own BUTTON EFFECT (logged one step
  before the selection), so a flag set there is the reliable discriminator:

  ```
  geocentric_unga_main_option_effect = {            # option 0 of every window calls this
      if = {
          limit = { has_country_flag = geocentric_unga_close_pressed }
          remove_country_flag = geocentric_unga_close_pressed
      }
      else = { country_event = { id = geocentric_unga.1 } }
  }
  ```
* **(d)** `buttonType` cannot carry `effect`, so a close control that needs script must be an
  `effectbuttonType` with the same `name` / sprite / `position` / `orientation` / `clicksound`.

**How it was found.** The plugin's own dispatch pattern (section 2) sent the close click to option 0,
which was the "go to the main panel" row - so X re-opened the panel it had just closed. Screenshots
could not distinguish "nothing happened" from "closed and reopened"; the `selectedOption` line in
`game.log` could.

**Enforced by** `custom-gui-option0-selfref`. The rule follows custom `scripted_effects` to the event
they fire and reads the flag guard:
* guarded -> **info**, naming the flag (the working pattern);
* unguarded and nothing else opens the event -> **warning**, "the close control re-opens the window";
* unguarded but another event does open it -> **info**, a NAVIGATION cycle. Measured: the shipped
  mod's own `game.log` shows `geocentric_unga.2 ... selectedOption 0`, then `geocentric_unga.2` again
  3.5 s later, which is that wart and not the crash.

**Debugging surface.** `gui_log_scan` surfaces the `eventcommands.cpp:88 ... selectedOption N`
sequence in order and flags two option-0 selections of one event as a close-then-reopen cycle. Use it
before theorising: this single line would have short-circuited several rounds of this project.

---

## 4. `force_open` + `custom_gui` is unproven

**Defect (smell, not a proven bug).** The combination appears nowhere in vanilla.

**Evidence.** `events` over the install's own `events/`: 5563 events, **113** carry
`force_open = yes`, **36** carry `custom_gui`, and **0** carry both. `vanilla`: the install's 156
`custom_gui` uses (10 distinct window names; `enclave_caravaneer_option` alone is 85 of them) never
combine it either.

**How it was found.** By counting, after a round was spent wondering whether `force_open` was the
reason a window opened twice.

**Enforced by** `custom-gui-force-open` (**warning**). It is a smell, not a defect: the trial mod
shipped it for weeks and could never prove it necessary or harmful, so the finding tells the reader
to try removing it rather than asserting a fault.

---

## 5. Field-position traps: parse fine, break the engine

**Defect.** A field written one level too deep - inside a `position` block - makes the engine DROP
THE NEIGHBOURING FIELD.

**Evidence.** `measured`, from the installed file:

```
2952:    position = {
2953:      x = -10
2954:      y = 16
2955:    }
2956:    orientation = "UPPER_RIGHT"
2957:      alwaysTransparent = yes     <-- ONE TAB TOO DEEP: inside the position block
```

The engine then reads `position = { x = -10 y = 16 orientation = "UPPER_RIGHT" alwaysTransparent = yes }`,
**drops the orientation**, and places the 114x38 sprite at the raw offset - x 1634..1748, i.e. **108
px past the window's right edge (1640) with a 6 px sliver on screen**. That is a close button that
"cannot be closed", and the plugin's rect table could not see it.

**How it was found.** The rect model said the button was inside the window; the human said it was
not. `checkGuiSyntax` on the patched TEXT before writing is what caught the class.

**Enforced by** `field-not-accepted` (error), per kind. The measured per-kind size/field rules:

| kind | legal size spelling | rejected |
| --- | --- | --- |
| `instantTextBoxType` | `maxWidth` / `maxHeight` only | `size` (`Not used, use maxWidth and maxHeight`) |
| `iconType` | none: it draws at its sprite texture's size | `size` (`Unexpected token: size`), `origo` |
| `buttonType` / `effectbuttonType` / `listBoxType` / `smoothListBoxType` / `OverlappingElementsBoxType` / `guiButtonType` / `scrollbarType` | `size = { x y }` (x is the width) | `width`/`height` in the size block |
| `containerWindowType` / `gridBoxType` / `dropDownBoxType` / `extendedScrollbarType` | `size = { width height }` | `x`/`y` in the size block |
| `containerWindowType` | - | `alwaysTransparent` (move it into the window's `background` block) |
| everything except `effectbuttonType` | - | `effect` |

---

## 6. `effect` is not a valid field on `buttonType` - and it is the trap that looks like a fix

**Defect.** `buttonType` and `effectbuttonType` differ by one word and share every other field, so
writing `effect` on a `buttonType` reads as correct. The engine answers `Unexpected token: effect`,
drops the block, and the button renders and **does nothing**.

**Evidence.** `binary`: `effect` is a real field, defined only by the `effectbuttonType` parser.
`vanilla`: `interface/diplomacy_caravaneer_event_view.gui:69-76` is the reference for a SCRIPTED
control in a window - `tts_button`, an `effectbuttonType`. `measured`: the trial mod's six close
buttons spent a round as `buttonType` + `effect`; they only carried their script once each became an
`effectbuttonType` with identical `name` / `quadTextureSprite` / `position` / `orientation` /
`clicksound` (the file's own comment at `interface/zz_geocentric_unga.gui:3083-3087` records the
conversion and why).

**How it was found.** The parent report of the round that closed the UNGA work: `checkGuiSyntax`
stayed green through the `buttonType` -> `effectbuttonType` conversion, i.e. the checker did not know
that `effect` is invalid on `buttonType`.

**Enforced by** `field-not-accepted` at **error**, with `effect` in `ENGINE_REJECTED_FIELDS` and a
kind-level replacement in `FIELD_EQUIVALENTS`: the finding says
`effectbuttonType (same name/sprite/position/orientation/clicksound, plus effect = <key>)`.
The MIRROR case - an `effectbuttonType` whose `effect` names no key - is `effect-unresolved` (error)
in `src/lib/validate.mjs`, driven by the `common/button_effects/*.txt` keyset that
`extra_roots` / `button_effects_roots` supplies.

---

## 7. Parked elements keep their bindings

**Defect.** The idiom for satisfying the name contract without showing chrome is to park an element
off-canvas at e.g. `-3000,-3000` (with `size` zeroed). Parking removes the PIXELS, not the BINDING.

**Evidence.** `measured`, `RESULT-SIXFIX.md §1`: each window carried two close buttons - the parked
duplicate `close_<suffix>` (abs -1360,-2850, 38x38) and the real `close`. The parked duplicate still
carried `shortcut = ESCAPE`, and it was the ONLY ESCAPE binding in the window: the file had exactly
six `shortcut = ESCAPE` lines, one per window, each inside a parked duplicate. ESC pressed a button
three kilometres off-screen and the visible X had no binding at all. Vanilla's own event windows
declare no ESCAPE shortcut anywhere (`interface/diplomacy_caravaneer_event_view.gui`,
`interface/diplomacy_event_view.gui`: only `shortcut = "q"`, `shortCut = "t"`).

**How it was found.** "The main window will not close" survived a round of geometry checks, because
the click region was fine and only the KEYBOARD region was wrong.

**Enforced by** `parked-element-shortcut` (warning), `parked-element-hit-region` (warning, CONTROLS
only - a parked text element is not clickable, and reporting 72 of them buried the signal),
`parked-duplicate-of-live-control` (info). "Parked" is judged against the WINDOW the element lives
in, not the screen: a panel 100 px outside its window is a layout question (`out-of-bounds`), not
parking. The shipped mod still produces 12 `parked-element-shortcut` warnings - the traps are real
in the working file, which is why they are warnings and not errors.

---

## 8. Never leave a backup inside a mod

**Defect.** Paradox loads EVERY file under `common/` regardless of extension. An in-tree `.bak`
shadows the real file.

**Evidence.** `log`: 21 lines of `Object with key ... already exists` in one run of the trial mod.

**How it was found.** The duplicate-key lines named a `.bak` file the agent had left beside the real
`common/scripted_effects/*.txt`.

**Enforced by** convention only, and stated here: keep backups OUTSIDE the mod tree
(`<clone>\unga-fix\backup\...` in this project). No rule exists because the plugin is not
supposed to write into a mod at all; `assertOutputRoot` refuses a folder containing `descriptor.mod`.

---

## 9. Scope: a button effect runs in the scope of the thing it is drawn on

**Defect.** An `effectbuttonType` on a PLANET panel runs its `effect` in the SELECTED OBJECT's scope
(the planet). Country-only effects then do nothing.

**Evidence.** `measured`: `country_event`, `add_resource` and `add_modifier` all silently applied
nothing from a planet-panel button; only `country_event` is even logged. The mod's
`interface/planet_view.gui` override wraps all 42 such effects in `owner = { }`.

**How it was found.** A button that fired a country event logged nothing; the same effect from an
event worked.

**Enforced by** the `owner = { }` idiom, and by `gui_log_scan`: the engine's `Wrong scope for effect`
line is classified as an error. (No static rule: the plugin does not model which scope an arbitrary
`effectbuttonType` runs in, and guessing would be worse than the log.)

---

## 10. Engine capability is NOT vanilla usage

**Defect (a method defect).** Three separate wrong conclusions in this project came from counting
what vanilla CONTENT uses and treating the count as a statement about the ENGINE:

| wrong conclusion | how counting produced it | what the engine actually says |
| --- | --- | --- |
| `pieChartType` cannot be a `.gui` element | 0 `.gui` uses install-wide | it is a `.gfx` SPRITE kind (`government_view.gfx:215`) and a live engine chart exists |
| `custom_gui` "requires" `diplomatic = yes` | 154/156 uses had it | the engine has no such requirement; it is the overwhelming convention. **Measured 2026-10-06**: without it the engine builds a different event-window class and `custom_gui` still resolves (section 18) |
| "localisation has no numeric accessor" | counting bracket uses in vanilla | `defined_text { value = value:<script_value> }` in `common/scripted_loc/` consumed as `[This.<Name>]` is a real, live mechanism |
| "a bracket data function works anywhere, vanilla uses it 9201 times" | counting bracket uses in vanilla | those uses are tooltips/descriptions; in a WINDOW's painted text the call renders literally - measured in game, section 11 |

**Rule for this project.** Derive a rule from the ENGINE - its binary string tables, its own
generated `script_documentation`, its runtime logs. Cross-check against content, and when they
disagree say which one the claim rests on. `src/lib/contract.mjs` states both for every name
(`group: 'binary'` versus `windows: N`), and no finding calls a live-verified mod broken.

---

## 11. Localisation: a bracket data function renders LITERALLY in a window's text (measured)

**Defect.** A bracket data function in a localisation value that a WINDOW PAINTS is printed
literally: the player reads the raw `[Root.GetName]` on screen. Painted text is not a tooltip, so
nothing resolves it - and nothing warns, because the key exists.

**Evidence.**

* `measured`, **2026-10-05**, Stellaris 4.4.6 `Pegasus`, the working mod's UN General Assembly
  window (a `custom_gui` event window), game running in Chinese, read off a screenshot at 1440x960:
  `interface/zz_geocentric_unga.gui:791` paints `text = "unga_chart_center_value"` on an
  `instantTextBoxType`, and the value was `unga_chart_center_value:0 "[Root.GetName]"`. The window
  showed `[Root.Ge ...` in the middle of the donut chart (the element's 74 px box clipped it). The
  same construct sat in `unga_news_wire`, painted at `:2327`.
* `vanilla`: bracket calls appear **9201** times in `localisation/english/*.yml`, and those uses are
  tooltips, descriptions and event text.
* `vanilla`, the single window-text counter-example: `interface/situation_log_timelines.gui:20-26`
  is an `instantTextBoxType` whose `text` is the key `TIMELINE_EVENT_YEAR`, defined at
  `localisation/english/main_2_l_english.yml:995` as `"[GetYear]"`. That call is **scope-free** - it
  needs no scope to resolve - so it is not evidence that `[Root.X]` / `[This.X]` resolve in painted
  text. The honest rule is therefore: painted text must not depend on a bracket call at all.

**What this replaces.** The earlier revision of this section recorded the in-window case as
"prepared but never run" - unproven. It has now been run in game and it FAILS. The measured
negative is what the plugin documents.

**Therefore.** Any value a window paints must be static text, or the live value must arrive through
a channel proven in that position: a tooltip on the same element (`pdx_tooltip`,
`custom_tooltip`, `custom_tooltip_with_params` binding `$PARAM|flag$`), where the engine does
resolve bracket calls.

**The route, for tooltips.** `defined_text { value = value:<script_value> }` in
`common/scripted_loc/`, consumed as `[This.<Name>]`.

* `vanilla`: `common/scripted_loc/00_scripted_loc.txt:3227-3230` -> `localisation/english/toxoids_l_english.yml:735`.
* `$VAR|flag$` formatting exists with the same flag vocabulary as HOI4.
* There is **NO** `[?variable]` form.

**Enforced by** `window-text-data-function` (**warning**) in `src/lib/validate.mjs`. It reads the
localisation VALUE, which is why `filecheck.mjs` now asks `buildLocalisationIndex` for
`withValues: true`, and reports a `text` / `buttonText` value containing a `[Scope.Func]`,
`[GetX]` or `[?var]` call, quoting the call it found. Tooltip fields (`pdx_tooltip`,
`tooltipText`, ...) are deliberately exempt, because that is where the engine does resolve them.
Without a values index the rule stays silent rather than guessing.

---

## 12. Accessibility: measure contrast, and never let hue alone carry meaning

**Defect.** A status panel whose meaning lived in colour, at a contrast the eye cannot resolve.

**Evidence (all measured, see `<clone>\unga-fix\contrast.mjs` and `ddsavg.mjs`).**

* Decode the shipped background DDS and average it; read the text colour's RGB from the engine's own
  table, `interface/fonts.gfx` (`textcolors`); compute the WCAG contrast ratio.
* The panel shipped `g` = (128,128,128) on its background: **3.55:1**. `t` = (198,198,198) gives
  **8.20:1**. Both are legal English text colours; only one is readable.
* The panel had blue/red/green/yellow status dots plus a "Blue: friendly, Red: opposed" legend. It
  was replaced by a neutral white square - partly because the user is colour-blind. Hue alone must
  never carry the meaning; a glyph, a label or a legend must.

**How it was found.** By decoding the DDS and computing the ratio, not by looking at a screenshot.

---

## 13. Verification loops that actually close

In the order that mattered for this project.

1. **`gui_log_scan` before theories.** `eventcommands.cpp:88 ... selectedOption N` is the engine's
   own ordered record of what the player clicked, and `error.log`'s `Could not find ... in window`,
   `Unexpected token:`, `Wrong scope for effect`, `Event <id> has no options` and
   `Missing localization key [x]` are its complaints. Read them before changing anything.
2. **`gui_check_files` on everything the mod ships** (`.gui`, `events/`, `common/button_effects/`,
   both localisation files) with `extra_roots` pointing at the mod, so its own sprites, containers
   and button effects resolve. Without `extra_roots` every mod-defined `effect` is a false
   `effect-unresolved` and every mod sprite a false `unknown-sprite`.
   **A STALE ASSET CACHE PRODUCES THE SAME FALSE POSITIVES WITH `extra_roots` SET.** Measured
   2026-10-05: `getAssetIndex({ root, extraRoots, refresh: false })` returned the cached index
   (9,198 sprites, without the mod's three) and the working mod's own `GFX_unga_neutral_marker`
   came back `unknown-sprite` 11 times and its `geocentric_unga_diag_close` `effect-unresolved`
   6 times. With `refresh: true` the same call indexed 9,201 sprites and both rule sets went to
   zero. When a mod sprite is reported unknown, re-run with the cache refreshed before believing it.
3. **`gui_layout_validate` + `gui_layout_preview`**, then emit, then re-validate the emitted file.
4. **Re-parse the installed file** and assert the invariants on the BYTES that are on disk - not on
   the model that produced it. That is the check that catches a patch script that silently did
   nothing.

---

## 14. Text has a size, and the box is not it

**Defect.** Every "visual overlap" and "text overflow" finding this project produced was computed
from ELEMENT RECTS. `instantTextBoxType` is sized by `maxWidth`/`maxHeight`, which is the budget the
engine lays text out *in*, not the size of the text. Two 1116px-wide label fields overlap by
definition and their 105px and 297px strings are nowhere near each other; a 184px-wide news wire
whose string wraps into 26 lines reaches 289px past the bottom of its 124px box and lands on the
panel below. The box model sees the first as a defect and cannot see the second at all.

**Evidence: the install ships the engine's own font metrics.** (All paths under
`<Stellaris>`, the verified 4.4.6 install.)

* `gfx/fonts/*.fnt` are AngleCode **BMFont text descriptors** with real per-glyph data:
  `gfx/fonts/cg_16b.fnt:2` is `common lineHeight=16 base=13 scaleW=256 scaleH=256 pages=1` and
  `:4` is `char id=33 x=182 y=146 width=9 height=16 xoffset=-3 yoffset=0 xadvance=4 page=0`.
  `gfx/fonts/juralightmedium.fnt` carries **6744 `kerning first= second= amount=` records**;
  `gfx/fonts/standard.fnt` carries 326; `malgun_goth_24.fnt` 222.
* `interface/fonts.gfx` binds a font NAME to those files (`:168-177`
  `bitmapfont { name = "cg_16b" fontfiles = { "gfx/fonts/cg_16b" } }`) and — the part that decides
  the whole approach — **replaces the bitmap font with a real TrueType font per language**:
  `:187-192` `bitmapfont_override { name = "cg_16b" ttf_font = "Easter_normal" ttf_size = "13"
  languages = { "l_russian" "l_polish" } }` and `:194-204` `ttf_font = "Chinese_normal"
  ttf_size = "14" languages = { "l_simp_chinese" }`. `fonts/fonts.asset:19-26` resolves
  `Chinese_normal` to `gfx/fonts/NotoSansCJKsc-Regular.otf`, a **16 MB OpenType file with a real
  `hmtx` advance table** (`head.unitsPerEm = 1000`, `hhea.ascender = 1160`, `numberOfHMetrics =
  65507`). So the same `font = "cg_16b"` is a 16px bitmap font in English and a 14px Noto Sans CJK
  in Simplified Chinese, and **no single advance table is correct for both**.
* The engine reads those same records. `stellaris.exe` carries the token list
  `lineHeight` / `chars` / `base (%d) in '%s' does not match previous fontfiles in font '%s'` /
  `lineHeight (%d) ... does not match` / `scaleH` / `scaleW` / `char` / `kerning` from
  `pdx_oldgui/graphics/bitmapfont.cpp`, and the sibling error `Not used, use maxWidth and
  maxHeight` from `instanttextboxtype.cpp`. There is **no** `documentation/` folder in the install
  and **no** `GetTextSize` / `MeasureText` / `CalcTextSize` / `GetStringWidth` string in the
  binary: the engine measures text, but it does not expose the measurement.
* The descriptor belongs to the shipped atlas: for all 12 `.fnt` files, `scaleW`/`scaleH` equals
  the dimensions of the `.dds`/`.tga` beside it, and decoding `gfx/fonts/cg_16b.dds` at the
  coordinates `cg_16b.fnt` gives `char id=72` (`H`) prints an unmistakable `H`. The units are
  layout pixels: `interface/fonts.gfx:175` declares `cursor_offset = { -3 -5 }` for `cg_16b`, and
  every glyph in `cg_16b.fnt` carries `xoffset=-3`.

**What was implemented** (`src/lib/font-metrics.mjs`, one code path shared by the validator, the
preview and the rect table).

* Advances: the `.fnt` `xadvance` per glyph **plus the `kerning` pair adjustment**; for a
  `ttf_font`/`ttf_size` override, the glyph's `hmtx` advance scaled by `ttf_size / unitsPerEm`,
  looked up through `cmap` (format 12, so it works past the BMP). CJK advances are uniform and
  exact; Latin-in-CJK-font advances come from `hmtx` and are exact, but a font whose kerning lives
  only in `GPOS` gets no pair adjustment (reported as a note).
* Wrapping: greedy chunk-based, **per script**. Latin breaks at spaces and after `-`/`/`; a word
  with no legal break inside it that is wider than the box gets its own line and overflows, and is
  reported as `wordOverflow` (the engine has no hyphenation dictionary). **CJK breaks between every
  character**, except before the characters the font's own `multiline.forbidden_start` names and
  always after those in `line_break` — both read from `interface/fonts.gfx` for the requested
  language (`:88` `forbidden_start = { "，" }`, `:87` `line_break = { "。" "）" "！" ... }`).
* Explicit breaks, both spellings: `$NEW_LINE$` (a nested localisation key whose value IS a newline,
  `localisation/english/federations_l_english.yml:34` `NEW_LINE: "\n"`) and a literal `\n` escape in
  the value, which vanilla uses **34,289 times across 108 english files** and the bilingual mod
  uses 37 times per language (`zz_geocentric_unga_l_english.yml:211`).
* Wrap width = the element's `maxWidth`, with **no extra inset**: the `.fnt`'s own `padding=3,3,3,3`
  is already baked into each glyph's `xoffset=-3`, so subtracting it again would double-count.
  `format` (left/center/right) moves the drawn block, it does not change the wrap width.
* Height, and this is the part that had to be calibrated: two numbers, because the engine uses two.
  `budgetHeight = (lines-1) * lineHeight + base` is what `maxHeight` is compared against, and
  `height` is the glyph INK taken per glyph from the descriptor's `yoffset`/`height`. Measured over
  **839 vanilla text elements** with both fields: the ascent-band model fits the declared
  `maxHeight` for **94.3%** of them, while the naive `lines * lineHeight` fits only **71.2%**. The
  gap is in the content — **20.2%** of vanilla's single-line text elements declare `maxHeight`
  exactly equal to the font's own `base` (`malgun_goth_24`: 20px, not 24px) and **29.1%** declare
  less than one `lineHeight`. So an element is reported as overflowing vertically only when the
  ascent band does not fit, while its DRAWN rect (what can collide with the row below) is the full
  ink. Reporting ink-vs-`maxHeight` instead would flag 259 of those 839 vanilla elements: a rule
  nobody would read.
* `dynamic_extra_height` / `dynamic_extra_height_max` exist precisely because a wrapped block's
  height is not fixed (the keywords are in `stellaris.exe`); the model treats the declared value as
  extra available height, which is the conservative reading and is stated in the finding text when
  it applies. Neither field is used by vanilla or by this mod, so the reading is untested against
  real content — see "what is not established" below.

**Exactness statement — what the preview promises.**

> **Text extent: EXACT for bitmap fonts, EXACT advances for TrueType overrides.**
> Width is the sum of the engine's own per-glyph advances (plus kerning) from the descriptor the
> engine loads for that font name *and language*; it is not fitted and not averaged.
> Line height is EXACT for bitmap fonts (`common lineHeight=`) and DERIVED for TrueType overrides
> (`hhea` ascender−descender+lineGap, the quantity FreeType reports as `metrics.height`; the OS/2
> typographic and Windows alternatives are reported alongside).
> **Wrapping: modelled per script; wrap width = the element's `maxWidth` (measured, no inset).**
> Residual uncertainty: (a) inline `£icon£` tokens and unresolved `$SCOPE$` tokens contribute no
> width and are listed per element, so those measurements are a LOWER BOUND; (b) a character the
> descriptor does not contain is charged the font's average advance and listed; (c) two shipped
> generations of the same face at the same size differ by at most **2px** on a single glyph
> advance (`cg_16b.fnt` vs the retired `stellaris_main.fnt`), which bounds any engine-side rounding;
> (d) `GPOS`-only kerning is not applied, which is a sub-pixel effect on Latin and zero on CJK.

**Why not just calibrate an average advance from the content?** Because it was measured and it is
not good enough. Fitting a per-font average advance on 80% of a sample of 835 vanilla text elements
and testing on the held-out 20% (`node scripts/text-metrics-audit.mjs`):

| predictor | mean error | median error | p95 error | false "overflows" | missed overflows | verdict agreement |
|---|---|---|---|---|---|---|
| `0.55em` from the number in the font name (the old heuristic) | 48.0px | 39.0px | 134.0px | 15 | 0 | 91.0% |
| per-font average advance, fitted on the fit set only | 10.1px | 6.7px | 24.0px | 2 | 0 | 98.8% |
| the engine's own `.fnt` advances (what is implemented) | 0 | 0 | 0 | 0 | 0 | 100% |

The old heuristic's error is not small and it is not random: it is `0.55 x the digits in the font
name`, so `cg_16b` gets 8.8px/char when the descriptor says 6.15, and `jura` — whose name contains
no digits at all — gets 8.8px/char when the descriptor's own `lineHeight` is 48 and `large_title_font`
is 17.95px/char. Over the whole vanilla sample it claims 121 overflows where the exact metrics find
30: **91 of its 121 overflow claims (75%) are false**, and it misses 0. On this mod, in English, it
claimed 81 overflowing text elements where the measurement finds 20 (61 false alarms); in Simplified
Chinese it claimed 41, of which 7 were false **and 6 real overflows were missed** — the Chinese
advance is 14px/char, so the heuristic underestimated while overestimating the 24px Latin font.
That is the honest answer to "can the plugin get the real size of text": it could not, and now it can.

**How to read the findings.**

* `text-overflow` — the rendered string does not fit. The message quotes the measured `WxH`, the
  wrapped line count, the box, the overflow in px on each axis, the font, and whether the
  measurement is exact. `textOverflow: 'horizontal'` means a run with no legal break is wider than
  `maxWidth`; `'vertical'` means the block needs more lines than `maxHeight` allows, which is the
  defect that puts text on top of the row below.
* `text-collision` — two elements' rendered text really intersects. `wrapInduced: true` means their
  BOXES do not intersect at all, i.e. no box rule could ever have found it.
* `sibling-overlap` — now compares measured ink wherever a string resolved, so a pair of boxes that
  overlap without the text reaching each other is no longer reported. It keeps its old meaning for
  elements with no text. The report carries `textMeasurement.overlapBreakdown`, so the number of
  box artefacts that were suppressed is visible rather than implied.
* `textMeasured: false` in a report means nothing was measured (no localisation values, or no font
  catalogue) and the box rules ran exactly as before. A green verdict with `textMeasured: false`
  is not evidence about text.

**Measured on the real mod** (`<mods>\geocentric_origin\interface\zz_geocentric_unga.gui`,
six `custom_gui` windows, `node scripts/text-overflow-report.mjs`):

| | l_english | l_simp_chinese |
|---|---|---|
| `sibling-overlap` (boxes) before → after | 6 → 6 | 6 → 6 |
| box overlaps suppressed as artefacts | 0 of 6 | 0 of 6 |
| `text-overflow` (new) | 20 (all vertical) | 40 (all vertical) |
| `text-collision` (new) | 37 | 53 |
| ... of which their BOXES never overlapped | **37 of 37** | **53 of 53** |
| text elements measured / exact | 229 / 229 | 217 / 217 |
| overflowing single-line (no wrap model) | 30 | 40 |
| overflowing with wrapping modelled | 20 | 40 |
| introduced by wrapping | 0 | 0 |

In this file **none** of the previous `sibling-overlap` findings was a text-vs-text box artefact
(0 of the 6 overlap candidates had a measured string on both sides), so the honest breakdown is not
"the old findings were wrong" but "the old findings were about other things, and 57 (English) / 93
(Chinese) real text defects were invisible". The dominant real defect is the wrapped block growing
out of its box: **100% of the collisions are wrap-induced**, and the news wire alone accounts for
14 of them in English and 11 in Chinese.

Per element, from the same run:

* **Six bloc headings** (`unga_bloc_heading_{nato,eadi,csto,au,nam}` and `unga_section_chart_main`):
  all fit. English 105–297px of measured text, Chinese 100–160px, in a 1116px box, one line each.
* **Title / subtitle / caption row** (18 elements: `unga_title_*`, `unga_subtitle_*`,
  `unga_window_caption_*`): all fit, all one line, in both languages. English: `unga_title_*` 258px
  in a 720px box, `unga_subtitle_*` 408px in 780px, `unga_window_caption_csto` 297px in 326px — the
  tightest in the file's header, and it fits with 29px to spare. Chinese: 100px, 151px and 160px
  respectively. **Nothing in that row overlaps anything**, in either language; earlier "visual
  overlap" reports there were box artefacts.
* **Vote-tally band** (75 elements: `unga_tally_*`, `unga_power_*`, `unga_bloc_track_*`,
  `unga_bloc_*_label/value/help_*`): English, 3 overflow — `unga_power_name_1_main`
  ("North Atlantic Treaty / Organization", 2 lines, 129x35) and `unga_power_name_3_main`
  ("Collective Security Treaty / Organization", 158x35) each +9px in a 198x20 box, and
  `unga_tally_caption_main` ("Recorded vote - session estimate. Not a live tally.", 157x35, 2 lines)
  +11px in a 190x18 box. Chinese, the two power names fit on ONE line (14px CJK advances make
  `北大西洋公约组织` 112px) but `unga_tally_caption_main` is worse: 179x42 over 2 lines, **+20px**.
  The only measured collisions in the band are Chinese and there are 4 of them, all between
  ADJACENT tally groups' text rather than between a label and its own value:
  `unga_tally_yes_label_main` x `unga_tally_abstain_label_main`, the matching `_value_` pair, and
  `unga_tally_abstain_*` x `unga_tally_no_*`. Each label measures 28x21 in a `maxHeight = 20` band,
  so one extra row of ink is enough to reach the neighbouring group. The tally labels, values and
  tracks are all inside their boxes, so this band's Chinese defect is spacing, not sizing.
  The same Chinese-only pattern appears twice more: `unga_bloc_actions_heading_{nato,eadi,csto,au,nam}`
  x `unga_bloc_actions_note_*` (5 pairs) and `unga_section_chart_main` x
  `unga_section_chart_note_main` — in each case a heading that fits its box in English whose Chinese
  ink is 30px tall against a 26–28px box (`外交行动` = 80x30 in a 500x26 box, `大国实力投射` = 120x30
  in a 1116x28 box), so the glyphs reach the note underneath even though the ascent band does not
  exceed the budget and no box rule fires.
* **News wire**: `unga_news_wire_main` is the worst defect in the file. English: 184x387 over
  **24 lines** in a 184x124 box, **+257px**, colliding with 14 elements of the standing panel.
  Chinese: 176x336 over 16 lines, **+208px**, colliding with 11. `unga_news_subheading_main`
  overflows too (+9px English, +18px Chinese) and in Chinese even `unga_news_heading_main`
  (`地球新闻快讯`, 120x30 in a 184x22 box, +2px). The 8 `\n` escapes are what make the block 8
  paragraphs; they are real breaks, and without modelling them the block measures as one run-on
  line.
* **Ranking caption vs its bars**: `unga_chart_rank_caption_main` ("Ranked power projection
  (0-120)", 258x25 in a 400x28 box in English; 211x30 in the same box in Chinese) fits and
  collides with nothing — not the tracks, not the tick labels. `unga_chart_tick_*` measure 7–23px
  wide in 40px boxes. The only measured text near a bar is `unga_power_name_1_main` /
  `_3_main` overflowing its 20px row, which is the tally-band finding above, not a caption-vs-bar
  collision.

**What is not established.**

* `dynamic_extra_height`'s arithmetic. Neither vanilla's 177 `.gui` files nor this mod uses it, so
  the "extra available height" reading is from the field name and from its coupling with
  `dynamic_extra_height_max`/`dynamic_extra_y`, not from a measurement. An in-game test would settle
  it.
* Whether the engine breaks inside a word wider than `maxWidth`. The model overflows the line, and
  vanilla contains no case that distinguishes the two (its over-wide strings all contain spaces).
* The engine's own rounding of accumulated float advances. It is bounded by the 2px disagreement
  between two shipped generations of the same face, and by sub-pixel in practice, but it is not
  directly observable.
* Inline `£icon£` widths: resolvable from the sprite index, not currently wired, so they are listed
  and charge zero width.

---

## 15. A hand-maintained `.gui` is a DOCUMENT, not just a tree - emit normalises it away

**Defect.** `gui_layout_import` -> `gui_emit_files` rebuilds the file from the tree, and the tree
does not model comments. Measured on the real 146,310-byte mod file
(`interface/zz_geocentric_unga.gui`, sha256 `D6FBEE3C2BA87D65...`): the round trip preserved all
**639** element `name = "..."` tokens - 0 dropped, 0 added, 0 renamed - and dropped **132
comment-bearing lines to 6** (the emitter's own generated header). It also gained ~524 lines of
explicit `orientation = upper_left` on elements whose file omitted it.

No ELEMENT was lost. What was lost is the file's own record of *which element names the engine
dereferences by name*: `# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE` above the crash-critical
contract names, and a `# DIAGNOSTIC (2026-10-05): was buttonType` note recording why the close
control is an `effectbuttonType`. Section 10's rule applies to comments too - the file is the record
of what the engine does, so a write path that discards it silently discards the reasoning.

**Fix: an APPLY mode, not a comment-carrying tree.** `gui_emit_files { apply_to: "<path>.gui" }`
diffs the edited tree against the tree as it was IMPORTED and splices only the changed elements back
into the ORIGINAL bytes (`src/lib/apply.mjs`). The alternative - carrying `precedingComments` through
`parseGuiText` -> node metadata -> `renderElement` - was rejected as the bigger change and the weaker
one: it preserves comments only for elements the parser attached them to, and it still re-emits every
line, so field order and spelling would still normalise.

**The gate, and the traps that had to be got right to pass it.**

* No-edit apply is **byte-identical**: 146,310 -> 146,310 bytes, same sha256, comments 132 -> 132,
  diff `{added:0, removed:0, changed:0}`, 0 lines rewritten. That is enforced by construction - an
  element whose subtree is unchanged contributes its ORIGINAL lines, never a render.
* A one-field edit changes **3 lines** (the value, plus the emitter's `orientation` default), rewrites
  exactly one leaf, and keeps all 132 comment lines including all four marker blocks.
* **Trap 1 - the write order.** The FILE's order and the MODEL's order differ when an edit moves a
  child. Writing the model's order directly DROPPED everything after a changed child's original block
  - measured: the `# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE` block, which follows a changed element,
  vanished. The splice walks the original lines in order and replaces a child's own block in place.
* **Trap 2 - what "unchanged" means.** A re-render of an UNTOUCHED element is not byte-equal to its
  source: `prepareEngineCoordinates` writes an explicit `orientation = upper_left`, the emitter uses
  its own field order, and the per-kind translation rewrites some fields (`spriteType` ->
  `quadTextureSprite`). Comparing rendered text against source text therefore reports ~500 of 542
  elements changed. The authority is the MODEL: `sameSubtree(baselineNode, editedNode)`.
* **Trap 3 - `prepareEngineCoordinates` mutates its argument.** Running it on the tree being compared,
  or comparing after `emitFiles` has already run on it, gives every node a `coordinateFields` the
  baseline does not have - measured: 12 "changes" and a 146,848-byte file on a submission with no
  edits at all. `apply.mjs` renders from its own clone, and `gui_handoff_submit` runs the apply BEFORE
  the emit.
* **Trap 4 - the mutation happens in `gui_layout_edit` too.** `applyEdits` deep-clones and assigns
  FRESH node ids, so comparing ids reports every element as changed. A node id never reaches the file
  and is not content. The same trap bit the baseline: `gui_layout_import` now keeps a DEEP COPY of the
  pristine tree, because the stored layout is rewritten in place by an edit.

**What apply does not carry.** A re-emitted element is written in the emitter's field order and gains
the explicit `orientation`; comments INSIDE a re-emitted element are not carried (the comment block
ABOVE it is). An element the edit did not touch is untouched byte-for-byte.

**Writes.** Apply is the one mode that patches an existing file, so it names its target explicitly and
still refuses a path inside the install or the user-data folder, refuses a non-`.gui`, refuses a
missing file, refuses a BOM-carrying file, and refuses to write when the patched text fails
`checkGuiSyntax`. `apply_dry_run` returns the patched text and the diff counts without writing.

**Covered by.** `scripts/selftest.mjs`, group "apply mode (the edited tree goes back into the file)" -
32 assertions, including the byte-identity of a no-edit apply, the kept comments at all four positions
(before the window, after its fields, between children, after the last child), the changed-line count
for a one-field edit, and the same splice through `submitHandoff`. Removing the `sameSubtree` change
test makes that group fail (`an apply with no edits rewrites NOTHING`).

---

## 16. A bar is DRAWN, not declared - and the drawing is a transcription

**Fact.** There is no bar window element in Stellaris 4.4.6. The complete set of block keywords that
can appear inside a `.gui` file's `guiTypes` block, measured over all **177** of the install's own
`.gui` files, is 41 keywords and none of them is a bar:

```
background  borderSize  buttonType  checkboxType  containerWindowType  cursor
default_ime_text_color  dropDownBoxType  editBoxType  effectbuttonType  expandButton
expandedWindow  extendedScrollbarType  gridBoxType  guiButtonType  guiTypes  hide_position
iconType  if_resolution  if_scaled_resolution  instantTextBoxType  listBoxType  margin  offset
OverlappingElementsBoxType  overlay  padding  pdx_tooltip_anchor_offset  position  positionType
scrollbartype  show_position  size  slider  slotSize  smoothListBoxType  spinnerType  text_offset
textboxType  track  windowType
```

`progressbarType` / `progressbartype` / `progressBarType` - the three spellings the engine's `.gfx`
parser accepts - occur **195** times in the install, and every one is inside a `.gfx` file: a search of
`interface/**/*.gui` and `interface/**/*.txt` for all three spellings returns **0**. Vanilla's
`progress_bar` elements are `iconType`s drawing an engine-driven `progressBarType` SPRITE, named by the
engine and filled with engine state (`interface/anomaly_view.gui:339-343`, `archaeology_view.gui:365`,
`astral_rift_view.gui:345`). A sprite kind is not a window element, so a mod cannot ask for one for an
arbitrary value.

So every bar in every `.gui` file is drawn, and the only thing that makes a drawn bar read as a bar is
the construction. That makes this a **cloning** problem, not a design problem: the specification is a
transcription of the ranking bars that already work, and this plugin carries that transcription as data
(`src/lib/components.mjs`, `REFERENCE_BAND_ELEMENTS` / `REFERENCE_RANKING_ROW`) rather than as prose.

**The reference.** `zz_geocentric_unga.gui`, the `unga_chart_main` subtree (`:190-384`): six rows of
power-projection ranking bars, each row five SIBLINGS under the band - nothing is nested.

| role | element | kind | position | size | sprite | `background.name` | offset from track | format | font | `text_color_code` | source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | `unga_power_name_1_main` | `instantTextBoxType` | {26, 64} | max 202x18 | — | — | -214, -2 | left | `cg_16b` | — | :311-324 |
| track | `unga_power_track_1_main` | `containerWindowType` | {240, 66} | 400x20 | `GFX_tiles_dark_area_cut_8` | `bg` | 0, 0 | — | — | — | :325-339 |
| fill | `unga_power_fill_1_main` | `containerWindowType` | {242, 70} | 383x12 | `gfx_transparency_white` | `bg` | +2, +4 | — | — | — | :340-354 |
| value | `unga_power_value_1_main` | `instantTextBoxType` | {646, 64} | max 70x18 | — | — | +406, -2 | right | `cg_16b` | Y | :355-369 |
| seats | `unga_power_seats_1_main` | `instantTextBoxType` | {728, 64} | max 118x18 | — | — | +488, -2 | right | `cg_16b` | E | :370-384 |

Every one of those text elements also carries `alwaysTransparent = yes` and `fixedSize = yes`, and the
two sprites are the install's own: `GFX_tiles_dark_area_cut_8` is a `corneredTileSpriteType` with
`borderSize = { x=8 y=8 }` (`interface/fleet_view.gfx:2824-2830`, with an `effectFile` shader), and
`gfx_transparency_white` is a 3x3 `corneredTileSpriteType` with `borderSize = { x=1 y=1 }`
(`interface/core.gfx:119-124`). The band itself is `unga_chart_main` at :190-203 (`{228,160}`,
868x312, same dark tile), the heading is `unga_chart_rank_caption_main` at :204-218 (`{22,8}`, max
420x24, `malgun_goth_24`, `text_color_code = W`), and each row has an `iconType` legend marker at
:219-227 in the name column (`GFX_unga_neutral_marker`). Row spacing is 24 px.

**What makes it read as a bar and not as a tinted box.** Two things, and both are load-bearing:

* the fill is INSET 2 px horizontally, so the track's own dark tile stays visible around it as a
  border;
* the two elements carry DIFFERENT sprites - a dark 9-slice tile under a white 3x3 tile.

The same construction appears six more times in the same file with the same two sprites and the same
2 px horizontal inset, which is what makes it the project's idiom rather than one author's accident:

| use | track | fill | vertical offset | source |
| --- | --- | --- | --- | --- |
| the six ranking rows | 400x20 | 383 / 350 / 233 / 183 / 150 x12 | +4 in a 20 px track (row 0: +4) | :242-384 |
| vote tally | `unga_tally_yes_track_main` 400x18 | `unga_tally_yes_fill_main` 248x14 | +2 | :853-867 / :868-882 |
| bloc standing (AU) | `unga_bloc_track_bg_au` 1116x18 | `unga_bloc_track_fill_au` 801x14 | +2 | :5802-5816 / :5817-5831 |
| bloc standing (NATO) | `unga_bloc_track_bg_nato` 1116x18 | `unga_bloc_track_fill_nato` 712x14 | +2 | :2853-2867 / :2868-2882 |

**The invariants that follow, all measured.**

* **The horizontal inset is 2 px everywhere.** In every one of the eight uses the fill's x is the
  track's x + 2. That is the axis the construction's invariant is about.
* **The fill's height is not a fixed margin.** A 20 px track carries a 12 px fill (margin 4) and an
  18 px track carries a 14 px fill (margin 2). No constant margin and no constant fraction explains
  both; the two points do lie on one line, and the primitive uses it
  (`fillSlope = -1`, `fillBase = 32`). The selftest asserts both pairs.
* **Row 0 is a DEFECT, and it is the one thing not to clone.** `unga_power_fill_0_main` at :257-271 is
  a **400 px** fill inside a **400 px** track at x = 242, so it paints **4 px over** the track's right
  border. Every other ranking fill caps at 396. The primitive reports this as
  `bar-fill-overflows-track` (error) and clamps rather than reproducing it.

**THE ONE RULE THIS SECTION EXISTS FOR: the fill's length is static, the number is live.** A fill's
length is `size.width` - a layout number the engine reads once, at load time. The only measured
live-TEXT channel inside a `custom_gui` window is `effectbuttonType.buttonText` (localisation ->
`common/scripted_loc` -> `common/script_values`), which is how every live figure in the working mod
reaches the screen. A bracket data function in PAINTED text renders literally (section 11). **Text
cannot move a rectangle.** So:

* a bar's fill length is derived from `value`/`max` and written as a pixel literal. A percentage or an
  `@variable` `width` is refused (`bar-track-width-not-static`) rather than resolved to something that
  would silently break the inset invariant;
* `value > max` is refused (`bar-fill-overflows-track`), not quietly clamped to a bar that looks full;
* a live number is asked for with `labelEffect`/`effect` and becomes an `effectbuttonType` carrying
  `buttonText`;
* `trackColour`/`fillColour` are refused (`bar-colour-not-exist`) because a `.gui` container has NO
  colour field - the engine tints TEXT through `text_color_code`, and a sprite may name an `effectFile`
  shader; a window element has neither. Two real options: a different tile sprite, or a shader.

**Where the panel metrics come from.** The reference's columns ARE the defaults, so a bar with no
column fields reproduces the reference's row: name `maxWidth = 202` at track x - 214 (gap 12), value
`maxWidth = 70` at track x + 406 (gap 6), seats `maxWidth = 118` at track x + 488 (gap 12), and the
three text boxes at `trackY - 2` with `maxHeight = 18` in a 20 px track. A bar's `position` is the
TRACK's top-left corner, so the name column is the only negative x in the construction and a bar
placed where the old code put its track stays where it was.

**The API** (`gui_bar_spec` returns the whole table; `BAR_FIELD_HELP` in `src/lib/components.mjs` is
the source of truth): `width`, `height`, `value`, `max`, `inset`, `fillHeight`, `label`, `labelSide`,
`labelWidth`, `labelGap`, `labelEffect`, `effect`, `track`, `fill`, `rowLabel`, `rowLabelWidth`,
`rowLabelGap`, `rowLabelColour`, `valueText`, `valueWidth`, `valueGap`, `valueColour`, `seats`,
`seatsWidth`, `seatsGap`, `seatsColour`, `headingName`, `cloneOf`, `font`, `text_color_code`.
`value` is the NUMBER and `valueText` is the value column's TEXT; they used to be the same field, which
made `value = "unga_power_value_2"` unreadable as a proportion. **Watch the asymmetry**: the value
column's width and gap are `valueWidth` / `valueGap` (the short role name, like `rowLabel`/`seats`),
NOT `valueTextWidth` / `valueTextGap` - those two spellings are accepted as deprecated aliases and
raise `bar-field-deprecated`, and reading neither was the GAP-6 defect described in section 17c.

**CLONING A ROW.** A band of six rows is one construction plus five clones. `cloneOf` names a bar
EARLIER in the tree; the clone inherits the track, the inset, both sprites, the fonts and the column
metrics, and overrides only its own `position`, proportion and text:

```js
{ kind: 'bar', name: 'unga_power_1_main', position: { x: 240, y: 66 }, width: 400, height: 20,
  value: 383, max: 400, rowLabel: 'unga_faction_nato', valueText: 'unga_power_value_2', valueColour: 'Y',
  seats: 'unga_power_seats_2', seatsColour: 'E' },
{ kind: 'bar', name: 'unga_power_2_main', position: { x: 240, y: 90 }, cloneOf: 'unga_power_1_main',
  value: 350, rowLabel: 'unga_faction_csto', valueText: 'unga_power_value_3', seats: 'unga_power_seats_3' },
```

A clone's elements are renamed onto its own row index by ROLE, not by string-replacing the source's name
(the derived names interpose the role, so `unga_power_track_1_main` does not contain `unga_power_1_main`
as a prefix). `gui_bar_spec`'s `api.offsets` prints where each of the five elements sits relative to the
track's top-left corner, which is the whole shape in five rows: name -214/-2, track 0/0, fill +2/+4,
value +406/-2, seats +488/-2.

**The `from` mechanism.** A construction this plugin did not invent can also be READ OUT of an imported
tree. `barFieldsFromElements({ track, fill, name, value, seats }, tree)` takes element nodes or their
names, resolves them in an imported layout, and returns the bar fields that reproduce them: the track's
size and tile, the fill's tile, height and horizontal inset, the columns' `maxWidth`s and the font.
Note what it does NOT recover - the fill's LENGTH - because that is the caller's proportion and the
import's own value may be the over-long one.

**Covered by.** `scripts/selftest.mjs`, groups "the bar component clones the reference construction
(C1)", "the bar component encodes the static-length / live-number constraint (C2)", "the bar component
validates fit, language and heading alignment (C3)" and "the bar clone / from mechanism reproduces a
construction (C4)". C1 re-reads the mod file and checks EVERY line range and EVERY literal of the
transcription against it, compares the expansion to the transcription field for field, and carries a
fail-if-removed guard over the module's own source text. That guard is not decoration: an earlier
revision of the transcription contained two elements that do not exist anywhere in the file
(`unga_att_un_value_nato`, `unga_att_stab_value_nato`, at line ranges holding something else), and the
name check is what keeps them gone. The four API gaps found by adopting this primitive for a real mod
are covered by the group "the bar API honours its own documented names, and a live value is not ink
(GAP-5/6/7/8)" - see section 17.

**The 100 px misalignment.** A ranking band reads as a table, so a track that does not start at the same
x as the heading over its column reads as broken - and NOTHING OVERLAPS when it happens, which is why no
geometric rule catches it. `bar-track-misaligned-with-heading` compares the track's own x against the x
of the heading named by `headingName` (or derived from the bar's name by the mod's own convention), and
reports the offset in pixels with the x to move to. The reference shows the shape that makes this
non-trivial: `unga_chart_rank_caption_main` sits at x = 22 over a name column at x = 26, in a DIFFERENT
container from the rows' tracks at x = 240 - so the rule compares against a sibling when there is one
and against a same-column heading one level up otherwise, and requires the heading to be within 40 px
above the track, so a caption for another column cannot be held against this one.

---

## 17. The API you document IS the API - five gaps found by using it for real

Every entry here was found by adopting the plugin for a real multi-window mod
(`geocentric_origin`, a 301,146-byte `.gui` with eleven event windows and 30 readout bars), and every
one of them was **silent**: no error, no warning, an output that looked plausible. That is the class of
defect a measurement tool is least allowed to have, because the whole point of the tool is to be the
thing that notices.

### 17a. An ADD is not a splice - `apply_to` and a new top-level window (GAP-4)

`gui_emit_files { apply_to }` copies the lines an edit did not touch and re-renders the ones it did.
For an element the edit **created** there is nothing to copy, and three separate mistakes all lived in
that branch. Each was invisible to `checkGuiSyntax` (the output stays balanced) and to a "count the
windows" check (the damage is indented):

1. **The new element's body was the WHOLE FILE.** The interior walk fell back to
   `{ from: 0, to: lines.length - 1 }` for an element with no source block, so the added window
   absorbed every original line and nested it inside itself. Measured: one two-element window took the
   146,310-byte file to **300,332 bytes with two copies of every window**; five clones took it to
   923,055 bytes with six copies of the first.
2. **A new element ADOPTED another element's block.** Child matching searched the whole file when the
   parent had no block, so a child that merely shared a NAME with an unrelated element (a `.gui` has
   several `close`, `portrait` and `*_value_num` names per file) was treated as already present, its
   block was never emitted - it lies outside the new element's range - and the new window came out
   **empty**.
3. **The new element's own field lines were dropped.** An element that has a block copies its interior
   byte for byte, which is what preserves a `position` block's comment and spelling; an element that
   does not has nothing to copy, so the rendered `split.fields` is the only source of `name`,
   `position`, `size` and the kind-specific fields. Dropping them emitted a bare
   `containerWindowType = { ... }` with no `name` at all - unaddressable by `custom_gui`.

Two rules follow, and both are now asserted on the OUTPUT (one occurrence of each window name, at one
tab): **an added element is rendered, not spliced**, and **an element with no block adopts no other
element's block**.

**The baseline guard had the same shape of mistake.** `apply_to` refuses when it cannot identify the
tree the file was imported as, and it required the baseline's window-name list to be **exactly** the
edited tree's. An edit that adds a window changes that list BY CONSTRUCTION, so the one edit a
multi-window `.gui` most needs was the one the guard refused - and it reported "no baseline was found"
while listing candidates that were all valid baselines. The property the exact-match rule is a proxy
for is **subsumption** (every baseline window survives in the edited tree), which is what it now
checks, with the relaxed choice announced in `baseline_note` naming the windows the edit added.

### 17b. A live value is not ink (GAP-5)

A readout's localisation value is `[$GetUngaAttUnNato$]`, where `GetUngaAttUnNato` is a
`common/scripted_loc` `defined_text` name - runtime data that does not expand at load time. Measuring
those 16 characters gives **146 px** (english, `cg_16b`) / **152 px** (simp_chinese) in the reference's
own **70 px** value column, and the plugin reported one `text-overflow` per readout: **30 false
findings** on this mod, every one quoting the token. There is no width that satisfies the rule -
widening the box to 160 px clears the overflow and puts the box on top of the action buttons, which
the same run then reports as a real `text-collision` between two clickable things.

The measurement now says what it can and cannot know. A string carrying a `[$...$]` whose inner token
did not resolve is marked **live**, and when the element is on the channel that actually resolves it
(`effectbuttonType` + `buttonText` + `effect`) its measurement is **not charged as ink**: no
`text-overflow`, and its collision extent falls back to its own box rather than to the unresolved
token's width. The measurement is not thrown away - it is exactly the number that shows the box is a
2-5 character budget - so it is reported once under **`text-live-value`** (info), and the report carries
`textMeasurement.liveExcluded` so a clean count cannot be mistaken for silence. The plain
`instantTextBoxType` case is **not** excluded: that is the section-11 trap and keeps its findings.

**The same token produced a SECOND set of 32 misleading findings, under `window-text-data-function`.**
That rule exists because `[Root.GetName]` is printed literally in a window's painted text (section 11,
measured in game). Its pattern matches a `GetX` inside brackets, and `[$GetUngaAttUnNato$]` contains
one - so all 32 readouts were reported as "the player reads this literally" about strings the player
reads as a NUMBER. The two channels differ in exactly this: `[Root.GetName]` IS painted, while
`[$Token$]` is substituted before the engine reads it. A bracket call whose whole content is one
unexpanded token is therefore no longer returned by the rule; a genuine call beside a token
(`[$GetUngaX$] and [Root.GetName]`) still is, which is why the matcher scans every bracket rather than
only the first. Whether a given token resolves cannot be *proved* here, so that judgement belongs to
the live-value rule, which knows the channel. Shipped file: `window-text-data-function` **32 → 0**.

### 17c. A column's TEXT and its WIDTH are named differently (GAP-6)

The value column's text is `valueText` (because `value` is the bar's own proportion), but its width and
gap are `valueWidth` / `valueGap`. `readColumn(node, 'valueText', …)` derived **both** names from the
one string it was given, so it read `valueTextWidth` / `valueTextGap` - neither of which any
documentation mentions - and a caller who passed `valueWidth: 170` got the 70 px default with **no
error**. `rowLabel` and `seats` hid it because for them the node key and the field prefix are the same
word. `barFieldsFromElements` wrote the same inert name, so a bar cloned out of an imported tree
silently reverted its value column to 70 px.

The node key and the field prefix are now separate parameters so they cannot drift, the documented
names are read, the old spellings still work, and using an old spelling raises
**`bar-field-deprecated`** rather than being silently accepted. A caller must never silently get
nothing.

### 17d. `buttonText` is a field, and a live value needs no dummy label (GAP-7, GAP-8)

**`buttonText` was in no kind's field set**, so the ONE measured live-text channel inside a
`custom_gui` window was reported as `unknown-field` **62 times** on this mod - every one of them a live
number - which makes the rule unusable: a genuine unknown field would be invisible among them.
`emit.mjs` already listed `buttonText` in its per-kind field order, so the emitter wrote a field the
validator called unknown. Measured over the install's 177 `.gui` files it appears 456 times on a
`buttonType`, 14 on a `guiButtonType` and 2 on an `effectbuttonType` (`fleet_view.gui:708-721`), and it
is a localisation KEY like `text`.

**The live channel required a `label`.** The switch was
`labelLive = label !== null && (labelEffect || effect)`, so with no `label` the VALUE column expanded to
a plain `instantTextBoxType` and the engine painted its `[$...$]` token literally. A caller had to pass
a label it did not want - `label: <the row label again>`, `labelSide: 'none'` - purely to reach the
value channel. The switch is now the two fields that describe it, so `effect` alone puts the value
column on the channel; the old spelling still works, and a **clone** of a live bar keeps the channel
instead of silently reverting to painted text. The live value button carries
`quadTextureSprite = "gfx_transparency_white"` - the palette's white 3x3 tile - which is what the
reference's own live value button carries (`zz_geocentric_unga.gui:3354`), so the button has a hit
region that paints nothing.

### 17e. A window is not a collision with itself (GAP-9)

`container-name-collision` exists because picking a window name the install already defines silently
merges into the vanilla window. Its self-test compared the node's `sourceFile` against the hit's
`file` with a **path-suffix test**, which is wrong in both directions:

* it fired on every window of any mod whose root was passed as an extra root - **9 false findings** on
  this mod, each naming the mod's own file as "the vanilla window" - because the index had picked up
  the mod's own roots;
* it **swallowed a real collision** when the mod file is named like the vanilla file it shadows.
  Measured: a mod's `interface/planet_view.gui` redefining the vanilla `planet_view` reported **0**
  collisions, because `...\gap9b\interface\planet_view.gui`.endsWith(`interface/planet_view.gui`) is
  true.

The asset index now records the **root** each container name was indexed under, so file identity is
decided by absolute path whenever both sides have one. A root-relative fallback still runs when a side
genuinely has no root, and only for a whole path-segment suffix. Both directions are asserted: the
mod's own declarations report nothing, and a shadowing file reports exactly one collision naming the
VANILLA file.

**Covered by.** `scripts/selftest.mjs`: "apply mode: adding a top-level window (GAP-4)", "the bar API
honours its own documented names, and a live value is not ink (GAP-5/6/7/8)", and the GAP-9 assertions
inside "container-name collisions and extra roots (B3/B8)". Each defect was re-introduced on its own
and each was caught by its own assertion - the counts are in those groups' notes.

## 18. Only TWO routes put a mod's UI on screen, and only one of them is script

The question this project's whole surface rests on, and the one it had never actually measured
because it only ever used one mechanism: **what can script do to show a window?** The engine answers
it in its own generated documentation, and the answer is small.

`%USERPROFILE%\Documents\Paradox Interactive\Stellaris\logs\script_documentation\effects.log` lists
**1056 effects**; `triggers.log` lists **1087 triggers**. Filtering both on every GUI-ish word (`gui`,
`window`, `view`, `open`, `close`, `show`, `hide`, `dismiss`, `popup`, `tab`, `display`, `focus`)
leaves **four effects that show a window** and **no trigger and no effect that closes one**:

| effect | line | what it shows |
| --- | --- | --- |
| `force_show_diplomacy = <target country>` | `effects.log:3108` | the diplomacy view, diplomacy tab; "Only works inside on_custom_diplomacy events, relic activation effects, or events triggered from those" |
| `force_show_espionage = <target country>` | `effects.log:3112` | the diplomacy view, espionage tab; the same restriction |
| `open_shroud_tab = yes` | `effects.log:2988` | the Shroud tab |
| `set_advisor_active = yes/no` | `effects.log:691` | the VIR / advisor pop-in |

The word `window` occurs **once** in the whole of `effects.log`, inside `set_advisor_active`'s own
description. There is no close effect at all, which is *why* section 2's event-option mechanism is the
only exit from a `custom_gui` window rather than a workaround.

**So there are exactly two routes.**

1. **`custom_gui` on an event.** The mod's window is a `containerWindowType` in its own `interface/`
   tree and an event names it. This is the only route by which a mod's OWN window - its own name, its
   own geometry, its own lifecycle - can reach the screen. Vanilla: **13889** event blocks in the
   install's 170 `events/*.txt`, of which **65** carry `custom_gui`, **all 65** carrying
   `diplomatic = yes`, naming **8 distinct** windows, all 8 defined in the install's
   `interface/diplomacy_*_event_view.gui` files. Of the install's **3321** `containerWindowType`
   blocks, those 8 are the only ones any script can name.
2. **The mod's elements inside a host `.gui` file it shadows.** No effect, no event, no question:
   the engine opens the view for its own reasons and the mod's elements are in it. Vanilla ships
   **177** `interface/**/*.gui` files / **122198** lines / **3321** windows, any of which a mod can
   replace by basename. This is the route that wants no script at all - and it is a FULL-FILE
   override, so the mod inherits the whole file (section 19).

There is no third route. A `windowType` is a real, emittable kind (24 vanilla blocks,
`interface/chat.gui:3`), but every one of the engine's own is instantiated by C++ (`chat_window`,
`chat_item`, `browser_entry`), and no documented effect names one.

**The event window is a FAMILY, not a mechanism.** `stellaris.exe` carries five distinct
event-window classes - `CEventWindow`, `CDiplomaticEventWindow`, `CAdvisorEventWindow`,
`CrisisConversationEventWindow`, `LeaderConversationEventWindow`, `LeaderRecruitmentEventWindow`,
`LeaderStoryEventWindow` - and the install corroborates each with its own `.gui`
(`interface/eventwindow.gui`, `interface/diplomacy_event_view.gui`, `interface/advisor_window.gui`,
`interface/crisis_conversation_event_window.gui`, `interface/leader_*_event_window.gui`). Whether
`custom_gui` is honoured by any class other than the diplomatic one is **settled, and the answer is
yes - measured in a loaded game on 2026-10-06**: with no `diplomatic = yes`, the probe's `.2` (a name
that resolves) built an **event** window where its `diplomatic = yes` twin `.1` built a **diplomatic**
one. The load-time half of the same measurement was already in this document:
`eventmanager.cpp:458: Event gui_probe_q2.2/3 has no pictures` names exactly the non-diplomatic pair,
so the class split is visible from both sides. All 65 vanilla uses still set `diplomatic = yes`, so the
emitter keeps it as its default - now as **convention and window-class choice**, not as a requirement.
That is the same distinction section 10 exists to enforce.

**And the run's expensive half: an unresolvable `custom_gui` name is a CRASH, not a message.** The
probe's `.4` (`diplomatic = yes` + a name defined nowhere) produced one informational line
(`[gui.cpp:1057]: Tried to get gui_type [gui_probe_q2_zzz_no_such_window] which does not exist`), then
the engine substituted `interface/popup.gui`'s `ok_popup_window` and demanded the diplomatic window's
ten hardcoded names inside it (ten `containerwindow.h:88` lines, section 1), then
`EXCEPTION_ACCESS_VIOLATION` - the same crash class, reached by naming the wrong window instead of
leaving a name out of the right one. The **same** name without `diplomatic = yes` (`.3`) logged
nothing, did not crash, and drew the ordinary default event window. So the rule to write is graded: a
`custom_gui` name that exists nowhere is an **ERROR** on a `diplomatic = yes` event and a **warning at
most** otherwise. See `PROBE-RESULTS.md` §4 and GAP-17 in `PLUGIN-GAPS.md`.

**Covered by.** `scripts/selftest.mjs`, "the script routes to a window are the two the engine
documents": the four effects are asserted present, the absence of a close effect is asserted as a
property of the documentation census, and the two knowledge topics that state it
(`script-routes-to-a-window`, `host-gui-surface`) are asserted readable as resources.

## 19. Overriding a vanilla `.gui` is a PROVEN technique - the job is anti-drift, not avoidance

The second route is a first-class option and it is widely used. Two mods on the reference machine
override a vanilla file, and both use the SAME pattern:

* `<mods>\aerospace_carrier\interface\fleet_view.gui` - **2398 lines** against the vanilla
  file's **2355**. A line-level comparison: **43 lines present only in the mod's file, 0 lines present
  only in vanilla**. It is the vanilla file byte for byte plus one delimited block spliced into the
  vanilla `bottom` container, and its header says exactly what it is:

  ```
  # OVERRIDE of the vanilla fleet view (interface/fleet_view.gui, 4.4.6), by the aerospace
  # carrier mod. It is byte-identical to the vanilla file except for the hand-written
  # "aerospace_carrier_bridge_bar" container injected into the `bottom` container below.
  # Re-copy the vanilla file when the game version changes.
  ```

* `<mods>\geocentric_origin\interface\planet_view.gui` - **8502 lines** against 8483, one
  added container, the same "re-copy on version change" note. The file it shadows is the largest in
  the install (8483 lines / 276 `containerWindowType` blocks), which is a reminder to pick the
  smallest file that will do.

And a well-known class of mod - the **ascension-perk-slot** mods - uses the same door aimed at
NUMBERS rather than additions. The screen's capacity is four numbers in
`interface/ascension_perks_view.gui`, all inside engine-populated containers (section 20), with the
file stating at `:107` that the height is "set in code depending on how many APs the category has":

```
:85   containerWindowType "perks_list_box"         size = { width = 500 height = 448 }
:95   smoothListboxType   "ascension_perks_list"   size = { x = 480 y = 433 }
:127  gridBoxType         "ascension_perks_grid"   max_slots_horizontal = 1
                                                   slotsize = { width = 470 height = 86 }
```

The wiki states the same thing from outside - "The Ascension Perk selection menu UI file is
`ascension_perks_view.gui`", and of the tradition screen "Without modding this file, new Tradition
Groups as well as new Traditions can't be made visible in the UI". A mod that adds perks without
touching this file adds perks the player cannot reach. (The mods themselves -
*Magnum's Mods - Ascension Perks Slots*, *Ascension Perk Slots*, *All Ascension Perk Slots -
FGRaptor*, *72 Ascension Perk Slots*, *UI Overhaul Dynamic - Ascension Slots* - are **not installed
here**, so their technique is derived from the vanilla file and the wiki, not read from their source.)

**Where the hook exists, do not override.** The cheap route is `custom_gui` on an event: the mod's
window is its OWN file and the engine instantiates it, so there is nothing to keep in sync. The
install has exactly 8 windows any script can name - all in the 8
`interface/diplomacy_*_event_view.gui` files - which is why the framework route works at all: Kasako
drives 20 of its own files from those hooks. For everything else the override is the only route, and
the file's size is the cost you are choosing: `ascension_perks_view.gui` **194 lines / 3 windows** is
the cheapest override in the install, `fleet_view.gui` 2355 / 66 is next, and `planet_view.gui`
**8483 / 276** is the most expensive. The grouped surface, for picking: planet/colony 7 files /
12637 lines · species & empire design 12 / 12662 · galaxy & map 6 / 8647 · situation, log & outliner
8 / 11598 · diplomacy 16 / 10876 · topbar 7 / 7841 · fleet, ship & combat 9 / 8440 · country,
government & council 12 / 9247 · technology & traditions 6 / 4200 · starbase, megastructure & trade
12 / 6049 · first contact, espionage & archaeology 8 / 5116 · popups, dialogs & messages 16 / 6249 ·
game setup & multiplayer 12 / 10743 · hud, tutorial & helpers 12 / 4803 · event windows 10 / 3289 ·
front end 24 / 5239. Directory split: `interface/` 169, `interface/game_setup/` 4,
`interface/additional_content/` 3, `interface/pdx_online/` 1.

**So the cost is not the override. It is the drift.** A patch changes a container name, a size, or
adds an element; the mod's copy is now the OLD file; the game loads it happily and the mod silently
ships stale vanilla content. Nothing errors. That is a mechanical problem with a mechanical answer,
and the plugin now carries all three parts:

1. **`gui_emit_override` records the base as a `sha256`** in the output header
   (`# vanilla source sha256: ...`) and refuses a later run whose `expected_source_hash` no longer
   matches. Prose ("4.4.6") tells a human; a hash tells the machine. **Neither of the two shipped
   overrides records one**, so `gui_override_drift` reports `override-base-unrecorded` about both and
   cannot tell whether they are stale - which is precisely why the step is worth a tool.
2. **`gui_override_drift` says what moved** - read-only on both files: `baseHash.moved`, the vanilla
   elements the copy is now DROPPING (`override-vanilla-content-missing`, **error**: the override
   replaces, it does not merge), the copy's own additions with the container each hangs off, and every
   element it CHANGES with the direction stated (`size vanilla 560x320 -> your copy 520x300`). The
   `changed` half is not decoration: an override whose entire edit is one number would otherwise read
   as "no changes".
3. **`gui_emit_files { apply_to }` re-applies onto the new base**, splicing the delta into the
   original bytes so every untouched line - comments included - stays identical (section 15). That is
   the step that makes a re-copy cheap, and it is why the answer to "a patch moved the base" is a
   command rather than a rewrite.

On this machine both shipped overrides come back `missing = 0` (neither is currently dropping vanilla
content) and `undetectable` for drift. Measured with the moved-base fixture
(`scripts/fixtures/host_override/vanilla_host_v2.gui`) the report is
`stale: re-copy the vanilla base and re-apply the edits`, names the added vanilla element the copy is
dropping, and prints the number change in both directions. Every one of those is asserted in
`scripts/selftest.mjs`, so the report is never shipped unexercised.

The whole-UI alternative is worth knowing: **`! Core Framework of Kasako`** ships **20 `.gui` files
and none of them shadows a vanilla file** - it takes route 1 (its own files, driven from `custom_gui`
hooks) rather than route 2. That is the cheap route at scale, and it works precisely because a
`custom_gui` hook exists for the windows it needs.

**And the loader's own rule: one file per relative path, last mount wins.** An override is not a merge
and not a shadow at lookup - it is the only copy of that relative path the engine parses. Measured in
game on 2026-10-06 by shipping `interface/input_blocker.gui` from two mods and flipping their order in
`dlc_load.json`: the winning copy's unique markers appear, the loser's do not appear anywhere, and the
winner is the LAST entry. So the plugin reports the two shapes differently - the same relative path is
`container-path-override` (info, with the load-order fact), different relative paths are
`container-name-collision` (error, because then both files really do load and both declare the name).
Section 21 has the measurement and the table.

**Covered by.** `scripts/selftest.mjs`: the group "the override anti-drift report says whether the
base moved and what changed" (the fixture's unchanged base, the moved base's error, the direction of
the number change, the number-only case, and both real shipped overrides), plus the override door's
confirm flag, base hash and `expected_source_hash` refusal in the encoding/output-root group. The
knowledge topics `host-gui-surface` and `override-maintenance-workflow` are asserted readable.

## 20. A matrix is LAID OUT, because the engine will not fill a grid for you

The user has wanted a matrix view since the beginning, and the obvious way to express one is
`gridBoxType`. It does not work, and the reason is measured rather than argued. Counting the vanilla
blocks that contain at least one nested ELEMENT keyword inside their braces, over all 177 `.gui`
files:

| keyword | blocks | with a nested element |
| --- | --- | --- |
| `gridBoxType` | 261 | **0** |
| `OverlappingElementsBoxType` | 189 | **0** |
| `smoothListBoxType` | 242 | **0** |
| `listBoxType` | 43 | **0** |
| `containerWindowType` | 3305 | 2710 |
| `windowType` | 24 | 24 |
| `dropDownBoxType` | 13 | 13 |

Those four are ENGINE-POPULATED. The install says so itself at the only place it declares grid boxes:
`interface/additional_content/additional_content.gui:331-345` writes two EMPTY boxes and annotates
`slotSize` / `max_slots_horizontal` with *"Use the positionTypes at the top of the file to change the
slot size"* / *"...the max slots"* - and those `positionType` names
(`additional_content_grid_spacing`, `additional_content_window_small_size`) are literals in
`stellaris.exe`. The cell size is chosen by compiled code reading a named constant. A `.gui` cannot
put anything in a cell. (There is also no `flowContainer`/`hbox`/`vbox` keyword anywhere in the
corpus - 0 matches - so `OverlappingElementsBoxType` is the only flow-like construct, and it is
engine-populated too.)

**Correction, from the probe round of 2026-10-06.** This section used to say the `positionType` names
are referenced nowhere. That is **false**, and the install says the mechanism out loud one file over:
`interface/customize_species_shipsets.gui:21` reads *"Size is overriden by code with the value of the
positionType \"ship_browser_3d_view_size\""* - written in a file that does not declare the anchor. The
re-measurement, with the probe's own scripts (`<mods>\gui_probe_scratch\positiontype-census.mjs`,
`positiontype-vs-exe.mjs`):

* **224** `positionType` blocks by the probe's LINE rule (the declaration opens its own line), which is
  the number that pairs with the next two; this project's PARSE-based count of the same corpus is
  **233**, and the nine-block difference is one-line declarations
  (`topbar_traditions_view.gui:22-29` - eight `positionType = { name = "ap_N" position = { ... } }`) and
  `ship_designer.gui:43` (brace on the next line). Both are reproducible; only the stated rule
  separates them;
* **14** of the names also occur in another file under `interface/**` - by the wave's plain substring
  rule, so part of that 14 is collision (`background_bar_size` matches inside
  `rune_background_bar_size` and `rift_progress_background_bar_size_controller`; `event_option_offset`
  is named only in a comment). An exact-word pass over the 220 distinct line-rule names returns **6**,
  **five of them comments**;
* **163 of 224** names occur as CONTIGUOUS literals in `stellaris.exe` (`pause_bg_animation_speed` at
  offset 39417440, `situation_log_size_default` / `_focus` adjacent at 39375056,
  `event_option_offset` at 39441904 next to `...\source\graphics\eventwindow.cpp`). A parse-based pass
  over all 233 finds 161, because two of the nine one-line names are unrelated exe strings;
* and 5 of the parse-based 233 blocks carry a THIRD field (`dynamic_extra_height` x4,
  `if_scaled_resolution` x1), so "every one declares exactly `name` + `position`" was a reading of one
  file's shape rather than a measurement.

Why it matters beyond the number: a `positionType` name is a **global** anchor (it can even collide
with an element name - `ship_designer` is both), it is read by C++ rather than by another line of
`.gui`, and there is **no reference syntax to hook** anywhere in the corpus. So "change one number in
the engine's layout table" means **replacing the whole `.gui` that declares it** - a fork of
`main.gui` (1521 lines) or `additional_content.gui` (1485) with a recorded base hash
(`gui_emit_override`), which is the anti-drift cost section 19 states. The probe did exactly that and
the engine read ITS copy of `main.gui` (the engine printed `interface/main.gui` on a `gridbox.cpp:51`
bad-format line vanilla cannot produce, and printed the mod's own line numbers from
`persistent.cpp:41`) - but **0** lines in four runs mention `positionType` or the anchor it re-pointed,
so "the engine used the new number" is NOT established. The figures are pinned in
`scripts/selftest.mjs` and stated in the `positiontype-is-a-global-named-anchor` topic.

**What follows.** A matrix of a mod's own cells is positioned `containerWindowType`s, which is exactly
what the working mod's chart is - hand-computed. Hence the `matrix` component: `rows` x `columns` of
`cellWidth` x `cellHeight` cells, `gapX`/`gapY` apart, inset by `padding`, with optional column and row
labels, expanding to one frame plus one container per OCCUPIED slot. An empty slot emits nothing at
all, because a zero-size element still has a hit region (section 7).

**The defect the shape exposes, and the rule that catches it.** A hand-built matrix fails invisibly. A
cell whose content is too big for its slot does not overlap a sibling - the slot containers are the
siblings and they are all exactly `cellWidth` x `cellHeight` - and does not leave the window, because
the frame is sized to hold the grid. It simply draws over the next column, and both `sibling-overlap`
and `out-of-bounds` are silent. `matrix-cell-overflow` (error) names it, reports the overshoot in px,
and suggests the `cellWidth`/`cellHeight` that would fit. Six more rules guard the placing:
`matrix-dimension-invalid`, `matrix-cell-size-not-static` (every cell coordinate is written into the
file as a literal, so a percentage cell cannot be laid out), `matrix-cell-slot-out-of-range`,
`matrix-cell-slot-collision`, `matrix-children-overflow`, `matrix-header-count-mismatch`. And
`engine-populated-container-children` (**error**) reports a child placed in one of the four
engine-filled kinds: since the in-game probe of 2026-10-06 the rule quotes the engine's own answer
(`Unexpected token: <the child's keyword>` at FILE LOAD, the whole child block skipped) rather than
calling it a layout nuance - see section 21.

Two round-trip losses were found while wiring the five parsed-only kinds for this (`window`,
`checkbox`, `spinner`, `editBox`, `dropDownBox`): `verticalScrollBar` / `horizontalScrollBar` were
typed boolean, so a container carrying one emitted `verticalScrollBar = no` instead of the scrollbar
NAME (`interface/additional_content/additional_content.gui:277`); and `formatScalar` mapped
`horizontal = 1` to `no`, which for the 40 vanilla spinners writes `horizontal = 1` means every
spinner's axis was silently INVERTED. Both are fixed and asserted. `background = { ... }` had the same
class of loss - it kept only name/position/sprite/alwaysTransparent and dropped `pdx_tooltip`,
`no_clicksound`, `size`, `alpha` and `frame`, and re-emitted a fixed `spriteType` as a 9-slice
`quadTextureSprite`; all 13 `dropDownBox` backgrounds were wrong because of it.

**Covered by.** `scripts/selftest.mjs`: "the matrix component lays cells out and refuses one that does
not fit" (geometry, the empty-slot rule, the nesting, every rule's own fixture, and the emitted
`containerWindowType`/`size` literals), "the five parsed-only kinds are emittable in their own engine
form" (each kind's size spelling and its own fields, field for field against the vanilla block), and
"a 1/0 boolean and a scrollbar name survive the round trip". `scripts/fixtures/matrix_window.gui` is
the worked file, and `gui_matrix_spec` returns the arithmetic and the rules as data.

## 21. The in-game probe of 2026-10-06: five rules, one of which catches a CRASH

Sections 1-20 were written from the install's files, the engine's binary and this project's own
experiments. This section is the round that finally put probe mods into a **loaded game**
(`<mods>\gui_probe_grid\`, `gui_probe_q2\`, `gui_probe_ovr_alpha` / `_beta`; the logs, the
verbatim lines, the three controls per claim and the runs themselves are in
`<clone>\unga-fix\PROBE-RESULTS.md`, and the five defects as filed are GAP-13 … GAP-17 in
`PLUGIN-GAPS.md`). Every one is now a rule.

**GAP-13 - a child element inside an engine-populated container is a REJECTED FILE, not a layout
nuance.** `engine-populated-container-children` was a warning whose wording said a child "is not laid
out by it". The engine says worse. A real `instantTextBoxType` inside a `gridBoxType` produced, at FILE
LOAD (not per window open):

```
[persistent.cpp:41]: Error: "Unexpected token: instantTextBoxType, near line: 31
" in file: "interface/zz_gui_probe_grid.gui" near line: 38
```

one line per child element, naming the child's keyword and the span it skipped. And the bogus scalar
written INSIDE that child (line 64 of the same file) is **absent** from a log that reports the grid
box's own bogus scalar (line 49) and a host container's (line 83) - so the child's subtree is skipped
whole. The rule is an **error**, its message says the file is rejected and the child block skipped, and
the syntax checker stops its descent at the same point: the plugin now reports exactly the four tokens
the engine reported and nothing from inside the abandoned block. **Only `gridBoxType` was probed** - the
other three engine-populated kinds measure 0 nested elements too, and both the rule's message and the
`engine-populated-containers` topic say that the engine's answer for them was NOT measured.

**GAP-14 - two providers of the same relative `.gui` path are an OVERRIDE, not a collision.** Two probe
mods each shipped `interface/input_blocker.gui`; flipping their order in `dlc_load.json` flipped which
one the engine read, and in each run exactly one copy's unique markers appear - in a log that
demonstrably prints both kinds of marker. The winner is the **last** `dlc_load.json` entry (not
alphabetical, not first-wins). The loser is not merged, not shadowed at lookup, and never parsed at
all: the engine's own `Found duplicate containerWindowType` reporter never fires. So
`container-name-collision` now reads the RELATIVE path on both sides:

| the two providers' relative paths | what it is | rule |
| --- | --- | --- |
| EQUAL | an override: one file is loaded, the later `dlc_load.json` entry wins the whole file | `container-path-override` (info) |
| DIFFERENT | a genuine collision: both files load and both declare the name | `container-name-collision` (error) |

That re-grades the case GAP-9's fix was built around - a mod file NAMED like the vanilla file it
shadows - from "collision" to "override", which is what the measurement says it is; the genuine half is
asserted with its own fixture and did not move. The override finding also hands over the measured
diagnostic for "which copy did the engine actually read": plant a deliberately invalid `format` in a
`gridBoxType`, because `gridbox.cpp:51` is the one reporter that prints the FILE NAME
(`interface/input_blocker.gui: Invalid format "..." in gridBoxType "..."`) where `persistent.cpp:41`
prints a line number and no file.

**GAP-15 - `visible` is not a field of `containerWindowType` in 4.4.6.** The engine answered a
container carrying it with `[persistent.cpp:41]: Error: "Unexpected token: visible, near line: 17"`, and
the rejected token **derailed the rest of the enclosing block** - the fields written after it were
lost. The plugin drew no finding at all. Now `field-not-accepted` is an **error** for it, quoting the
engine's own token, driven by a table of per-KIND rejections (`src/lib/kinds.mjs`
`KIND_REJECTED_FIELDS`); the emitter refuses to write it too, rather than producing a file the engine
drops. The table is per kind on purpose: the probe covered the CONTAINER and nothing else, so `visible`
on an `instantTextBoxType` / `iconType` / `buttonType` is deliberately NOT reported, and the install's
corpus writes `visible` on no kind at all (**0** uses in 177 `.gui` files). Where it IS legal was not
measured, and the rule does not pretend otherwise.

**GAP-16 - an unknown scalar token is an engine parse error, and the syntax check had no rule for it.**
`checkGuiSyntax` reported **0** findings on the 86-line probe file the engine answered with **4**
`Unexpected token` lines - a file the plugin's own gate therefore passed as clean. It now has
`unexpected-token` (error), which reports exactly those four: the two rejected child ELEMENTS and the
two unknown SCALARS inside a block's body (`probeZZtokenInGrid`, `probeZZtokenInHost`), each with the
token, its line and the block span in the engine's own shape. Four exemptions keep the rule from
calling vanilla's own files broken, and each is a measurement: `name` / `id` (the element's identity),
an `@variable` DECLARATION that sits inside a block, a field the engine named as a token while
rejecting it on some kind (that is `field-not-accepted`'s job), and the field names the corpus writes
that this model does not declare (`movable`, `navLeft`, `navRight`, `alpha`,
`concepts_show_missing_dlc` - **39** uses between them, and the engine loaded the files that carry
them). Over the install's 177 `.gui` files the rule fires **0** times, which `scripts/selftest.mjs`
asserts as a control.

**GAP-17 - an unresolvable `custom_gui` name is not a message on the diplomatic path, it is a DEAD
PROCESS.** This is the one that matters most, and it generalises section 1's crash class to a new
route. `diplomatic = yes` plus a name defined nowhere gave, in a loaded game:

```
[gui.cpp:1057]: Tried to get gui_type [gui_probe_q2_zzz_no_such_window] which does not exist
[containerwindow.h:88]: interface/popup.gui: Could not find buttonType "tts_button" in window "ok_popup_window".
... ten of them, one per demanded name ...
Unhandled Exception C0000005 (EXCEPTION_ACCESS_VIOLATION)
```

One informational line, then the engine substitutes `interface/popup.gui`'s generic `ok_popup_window`,
keeps demanding the DIPLOMATIC event window's ten hardcoded names inside that popup, and dereferences
what it did not find. The stack body is byte-identical to the three dumps of section 1: the same crash,
reached by naming the wrong window instead of leaving a name out of the right one. The **same**
unresolvable name without `diplomatic` writes NOTHING at all - not even the lookup line - and draws the
ORDINARY DEFAULT EVENT WINDOW, which is not the `ok_popup_window` substitute the diplomatic path uses
(the v2 run of the same night, `PROBE-RESULTS.md` section 10.1). So the rule is graded by path:
**ERROR** with `diplomatic = yes`, **warning at most** without it, and `custom-gui-unknown-window` says
which case it is reporting and why. It resolves the name against the
plugin's OWN index (the install's containers plus every extra root, plus any `.gui` passed alongside),
because the engine resolves it nowhere at load time and the process is dead by the time it does - **no
log check can ever catch this**. Two adjacent claims had to be corrected in the same round, because the
run disproved them: `custom_gui` does **not** require `diplomatic = yes` (the flag selects the
event-window class and is vanilla's convention - 65/65 vanilla uses carry it - and the emitter keeps it
as its default for exactly that reason), and "the window may never be constructed without it" was
false. Both sentences lived in code (`filecheck.mjs`, `emit.mjs`) and both are fixed.

**Covered by.** `scripts/selftest.mjs`, "the in-game probe as rules (GAP-13/GAP-15/GAP-16/GAP-17)": a
fixture of the probe file's five cases asserted token-for-token and line-for-line against the engine's
four log lines; the same fixture through `gui_layout_validate` (the finding keeps the engine's line);
the exemption controls for the token rule (including two bogus tokens in one element); the `visible`
scoping asserted BOTH ways (reported on the container, silent on text/icon/button) and the emitter's
refusal to write it; the three `custom_gui` grades plus the resolvable and "no index consulted"
controls; a corpus control over the install's 177 `.gui` files; and - when the probe file is still on
disk - the probe file itself. The override/collision split is asserted in "container-name collisions
and extra roots (B3/B8)", both halves.

## 22. The ark ship panel IS the colony panel - one window, two name sets, the ENGINE picks

**The question this answers.** The Nomads DLC's 方舟舰 (ark ship) panel looks like the colony
(planet) panel, and the honest first guess is either "the engine grew a new panel" or "content cloned
the colony panel". It is neither, and the difference matters to a modder because only one of the two
halves is reachable from content.

**The answer.** The engine's planet view class - `CPlanetView`, whose bound member functions in the
binary take **a fleet AND a planet** - opens the SAME window in an arkship MODE, because 4.4.6
introduced the **colony carrier**: a colony always has a carrier, the carrier is a planet normally,
and for an ark ship the carrier is a SHIP. The panel is
`interface/planet_view.gui`'s `containerWindowType "planet_view"` itself (that window spans lines
**222-4699** of the file's **8483**), extended with a parallel set of ~**37** declarations whose
names begin with `arkship_`; the engine shows the set that matches the carrier. Which elements exist
is a CONTENT fact; which of them is drawn is an ENGINE fact, and the `.gui` cannot state it - the
whole file contains **0** `visible =`, **0** `trigger =` and **0** `enabled =` fields.

**Evidence - binary.** The arkship element names are not a table of their own; they sit inside the
planet view's own contiguous name table in `stellaris.exe`. At offset ~39545888 it reads
`... planet_pops_amount, planet_stability_amount, districts_grid_box, available_districts_window,
..., summary_tab, summary_tab_active, management_tab, management_tab_active, population_tab,
population_tab_active, arkship_tab, arkship_tab_active, armies_tab, armies_tab_active, corporate_tab,
arkship_elements, arkship_portrait_window, arkship_planet_top_bar, arkship_header_background,
arkship_build_armies, arkship_build_ships, arkship_level, arkship_focus_on, arkship_inspect_ship,
arkship_cloaking_values, ... arkship_buildings_grid, arkship_lower_buildings_grid,
arkship_modules_grid, arkship_spinal_mount_grid, arkship_stage_icon, arkship_pops,
arkship_governor_window, arkship_pops_amount ...`. **126** distinct `arkship`-bearing strings are in
the binary; **39** are declared as a quoted name under `interface/**` and **32** of those are in
`planet_view.gui`. There is **no** `CArkshipView` and no `arkshipview` (0 matches), while
`CPlanetView`'s mangled bindings name `const CFleet*` beside `const CPlanet*`
(`.?AV?$bind_t@XV?$mf3@XVCPlanetView@@PEBVCFleet@@PEBVCPlanet@@_N@...`). The new engine object is a
class of its own: `...\source\spatial_objects\colony_carrier.cpp`, `CColonyCarrier::RandomizeDeposits_1`,
plus the C++ loc keys `COLONY_CARRIER`, `OPEN_COLONY_CARRIER`, `GOTO_CARRIER`, `CARRIER_IS_TYPE`,
`CANNOT_ENCAMP_CARRIER_TYPE`.

**Evidence - the engine's own script documentation** (in the USER data directory, not the install:
`<Stellaris>\logs\` is EMPTY, and the dump is
`%USERPROFILE%\Documents\Paradox Interactive\Stellaris\logs\script_documentation\`, dated 2026-10-06):
`scopes.log:398` `carrier - Scopes from a colony to its carrier.` (supported scopes `planet ship
colony`, output `planet`); `scopes.log:94` `ship - Scopes from a starbase to its station ship or from
a colony to its carrier ship.` (output `ship`); `triggers.log:3643` `carrier_is_type - Checks if the
carrier is of a specific type` / `carrier_is_type = planet/ship`; `triggers.log:976` `has_carrier_flag`;
`effects.log:3080` `transfer_carrier = { source = <source colony/carrier>  target = <target carrier> }`;
`effects.log:356` `create_colony = yes/no (default: yes; if yes, will also create the carrier colony,
only when ship_size is marked to carry a colony. WARNING: carrier ships with no colony are killed on a
daily basis)`; `effects.log:189` "(Note: Colony doesn't store flags. Using any of the `carrier_flag`
effects/triggers in colony scope will access flags in the colony carrier instead.)". That last line is
the one that bites existing script: `has_planet_flag` still exists and still answers in planet scope,
so in colony scope the two flag families address two different objects.

**Evidence - content, and the switch a mod can flip.** Two keys on one ship size
(`common/ship_sizes/29_nomads_dlc_ships.txt:113-118`), and the file's own comment states the effect:

```
class = shipclass_starbase			# Needs to be a Starbase to have starbase modules and buildings.
carries_colony = pc_ark				# Enables Arkship custom UI.
arkship_picture = "arkship_civilian"
planet_view_header = "GFX_arkship_planetview_header_civilian"
```

`carries_colony` is documented by the install itself (`common/ship_sizes/00_ship_sizes.txt:97-99`,
including "The ship size must also have `class = shipclass_starbase`"), and the engine enforces both
with its own error strings in the binary: `"Arkship size %s does not have carries_colony"`,
`"Arkship size %s does not have class = shipclass_starbase"`, and - for the two art keys -
`"Ship size %s specifies planet_view_header but does not have a valid carries_colony"`. **`planet_view_header`
is not documented in `00_ship_sizes.txt`**: its 9 uses are all vanilla arkship hulls. The planet class
is `pc_ark` (`common/planet_classes/06_planet_classes_nomads.txt:1`), `colonizable = yes` (`:94`),
`district_set = nomad` (`:95`), `default_planet_selection = yes` (`:99`), `single_build_queue = yes`
(`:107`), with ten `conditional_icon` blocks whose trigger scopes to a ship (`:6-68`) - the install's
own doc block for those keys is `common/planet_classes/00_planet_classes.txt:47-62`, which states the
scope in words: `# scope: colony_carrier (planet or ship depending on carrier type)`.

Two things about that content are worth knowing because they look like contradictions:

* the arkship is a colony AND a starbase, so the script that reads it must say which half it means:
  `is_arkship_starbase` is `has_starbase_size = civilian_arkship_tier_1`
  (`09_scripted_triggers_nomads.txt:172`) while `is_capital_arkship_starbase` is that plus
  `colony? = { is_capital = yes }` (`:291`). Modules and buildings are the starbase half
  (`common/starbase_modules/00_arkship_*.txt`, `common/starbase_buildings/00_arkship_*.txt`); pops,
  districts and zones are the colony half. The megastructure file
  (`common/megastructures/29_nomad_arkships.txt`) is only the CONSTRUCTION SITE - its
  `on_build_complete` runs `create_arkship_effect` and then `remove_megastructure`
  (`common/inline_scripts/megastructures/arkship.txt:48-54`);
* `carries_colony` and the word "arkship" are not the same predicate. Nine of the file's ten
  starbase-class arkship hulls carry a colony (`:114, :235, :364, :496, :620, :751, :885, :1008,
  :1138`); the tenth, `military_arkship_champions_forge` (`:1261`, `class = shipclass_starbase` at
  `:1269`), has no `carries_colony`, no `arkship_picture` and no `planet_view_header`, yet vanilla's
  own `is_arkship_ship` / `is_arkship_starbase` / `is_military_arkship` list it
  (`09_scripted_triggers_nomads.txt:168,183,208,319`). **The engine's UI switch is `carries_colony`;
  the content's `is_arkship_*` family is a scripted convention that includes one more hull.**

**Evidence - the panel's shape, and the two mistakes it invites.** Measured on the shipped file:
**276** `containerWindowType` blocks, **50** top level, **1005** `name = "..."` declarations; the
`arkship_elements` container spans lines **604-1051** (**448** lines) and holds **53** named elements.
It declares **no size**, and its `arkship_buildings_grid` / `arkship_lower_buildings_grid` resolve to
0x0 in this plugin's model, because those grids are populated by the engine from the starbase's
module slots. And the one container that LOOKS like the panel is not:
`planet_view.gui:2580-2584` declares `containerWindowType "arkship_window"` with
`size = { width = 500 height = 400 }`, `position = { x = 0 y = 200 }` and **no children at all**.

The mode switch is visible in the `.gui` as **same-slot pairs**, which is the clearest single piece of
evidence that the engine chooses by name:

| slot | planet | arkship |
| --- | --- | --- |
| header art | `planet_top_bar` `:314`, `{x = -14 y = -47}` | `arkship_planet_top_bar` `:325`, same position, `GFX_arkship_banner` |
| portrait | `planet_portrait_window` `:260` | `arkship_portrait_window` `:347` |
| tab 2 | `armies_tab` `:3552`, `{x = 381}`, `shortcut = "v"`, `GROUND_COMBAT_TAB` | `arkship_tab` `:3525`, same position, same shortcut, `ARKSHIP_CONTROLS` |
| body | the colony summary/management panels | `arkship_elements` `:604-1051` |

**What a mod can and cannot do.** Reachable: the whole vanilla arkship panel, from data only, by
putting `carries_colony = <planet_class>` and `class = shipclass_starbase` on a hull - the engine then
treats it as a mobile colony and draws the vanilla UI. Not reachable: a new element name (the engine
resolves a fixed table - section 1's contract, one view over), the variant SWITCH itself (no field in
the `.gui`, and GAP-15 measured that `visible` is not a legal field in 4.4.6), and
`common/arkships` - a directory the engine's load table lists FIRST among `common/*` (exe offset
~38379912) that 4.4.6 does not ship at all (no directory, and no DLC zip contains a `common/`,
`interface/` or `events/` entry; all 40 carry art, audio and localisation only). Third-party
confirmation from this machine, written by the aerospace carrier mod after trying it
(`<mods>\aerospace_carrier\common\ship_sizes\zz_aerospace_carrier_ship_sizes.txt:7-17`):
"An earlier version copied the vanilla arkship (`class = shipclass_starbase` + `carries_colony` +
starbase module/building capacity), and that combination produces an *arkship*: a mobile colony that
exists on its own and CANNOT be added to a fleet. ... `carries_colony` is the field that causes it: it
turns the hull into a mobile colony and hands it the hardcoded arkship UI."

**Why this is a plugin problem and not only a game fact.** Running `gui_layout_validate` over the
shipped `interface/planet_view.gui` returns `verdict: fail` with **350** findings (32 error / 279
warning / 39 info), including **145** `sibling-overlap` and **46** `text-collision`. Four of those
`text-collision` findings are `X_tab` vs `X_tab_active` (`summary_tab`, `population_tab`,
`armies_tab`, `corporate_tab`) - the SAME button in two draw states - and four `sibling-overlap`
findings name `arkship_tab(_active)` vs `corporate_tab(_active)`. The plugin models a window as "the
elements declared in it, all drawn", so it cannot distinguish an engine-selected alternative from a
real collision, and it has no idea that ~53 elements of that window exist for one carrier type and
~1000 do not. `arkship` occurs **0** times under `src/`. This is **GAP-18** in
`<clone>\unga-fix\PLUGIN-GAPS.md`, filed with the reproduction.

**Covered by.** `scripts/selftest.mjs`, since the probe round that followed: the corrected
`positionType` figures (224 line-rule blocks / 14 names referenced elsewhere / 163 contiguous exe
literals), the **233** parse-based block count, the five blocks that carry a third field, the
`common/arkships` verdict (as the "not read" rule it now is) and the three
`espionage-operation-*` rule ids with the engine's two verbatim messages are pinned in the
cross-check with this file and in the knowledge-base assertions. The geometry figures this section
rests on - 350 findings on the shipped file, 145 `sibling-overlap`, the four `X_tab` /
`X_tab_active` `text-collision` findings, the 32 declared arkship names in `planet_view.gui` and the
448-line `arkship_elements` span - are still measured but not asserted, because GAP-18 was filed
instead of implementing an alternates rule; the smallest change that would pin them is one fixture of
two same-slot buttons for that rule when it exists.

**Update, from the probe round that followed (`DOORS-RESULTS.md`, in-game probe 2026-10-06).**
`common/arkships` is no longer an open question and no longer a "treat as unusable" caution - it is a
measured rule: **the engine does not read it.** A probe mod shipped **7** files there in **6 shapes**
(a keyed block, a bare token list, a named block using only plausible arkship field names, a scalar
list, a fully clean file, and one with a MISSING closing brace), each carrying at least one impossible
token, and `probeZzships*` / `common/arkships` have **0** hits in `error.log`, `setup.log`, `debug.log`
and `system.log` of that run. The mount is excluded in the same run: the SAME mod's
`interface/zz_gui_probe_doors_a_mountcontrol.gui` was named
(`Unexpected token: probeZZmount_control_token, near line: 9 ... in file:
"interface/zz_gui_probe_doors_a_mountcontrol.gui" near line: 9`), and that log was demonstrably
talkative (169 `Unexpected token` lines, 259 missing-localisation lines, a `gridbox.cpp:51` line naming
`interface/main.gui`). The malformed file is the cleanest single shot, because ANY parser that opens it
leaves a trace and the engine is otherwise silent about a directory it does not know. The engine's
content-directory list (`stellaris.exe` offset 38379912, `common/arkships` FIRST) is therefore **not a
list of directories the engine reads**, and the same table proves it: `common/specimens` is absent from
it while `common/specimens/specimens.txt` demonstrably loads (258 definitions, and the engine names a
specimen it dislikes). What the table is remains unestablished; what it is not is a capability list.
The corrected rule is now in the `ark-panel-is-the-colony-panel` topic and asserted in
`scripts/selftest.mjs`.

## 23. Every DLC panel is an engine-owned view, and the modding door is a data schema

**The question this answers.** Six DLC GUI systems were researched read-only in one wave, each against
the same six questions (host, how the engine decides to show it, where the data comes from,
exclusivity, fragility, what a mod can copy). The reusable finding is that the six answers have the
same shape, and the variable that actually decides "can a mod do this?" is **how wide the data door
is** - not which file draws the panel.

**The shape, six times.** The panel is a window the ENGINE creates: either a dedicated `.gui` root
with no `parent` field (the engine places it) or a tab/child container inside a vanilla view the engine
switches to. Its visibility is engine-private - a `common/game_rules/*.txt` rule the engine reads *by
name*, or a mode switch that exists only in C++. The `.gui` contains **no** `visible`, `trigger` or
condition field at all: `planet_view.gui` (8483 lines) has 0 of each, `galactic_community_view.gui` has
none, and `can_use_exhibits` / `can_access_vivarium` return 0 hits across all of `interface/**/*.gui`.
No script effect opens any of the six except the two the four window-showing effects belong to
(section 18), and `CEspionageView` / `CArkshipView` occur **0** times in the binary while
`CDiplomacyView`, `CEspionageOperationView` and `CPlanetView` do - the engine owns the view, the mod
owns the data.

| system (DLC) | panel host | engine's visibility decision | the data door, and how wide |
| --- | --- | --- | --- |
| ark ship (Nomads) | `interface/planet_view.gui` `planet_view` window (`:222`), arkship mode | the view class picks the `arkship_*` or `planet_*` name set from the colony's CARRIER; 0 `.gui` fields decide | **one field**: `carries_colony = <planet_class>` + `class = shipclass_starbase` in `common/ship_sizes/`. `common/arkships` is not read (section 22) |
| Grand Archive | `interface/discoveries_view.gui` `collection_window` (`:652-889`), a tab of the `discoveries_view` view | view ID `discoveries` + game rules `can_use_exhibits` / `can_access_vivarium` (`00_rules.txt:4042-4067`), 0 hits in `interface/**` | **one effect + one directory with a closed type set**: `common/specimens/` (258 in the install) + `give_specimen`. `SPECIMEN_TYPES` is not the engine's category table |
| Galactic Community | `interface/galactic_community_view.gui` (2448 lines), window `galactic_community_view` | game rule `can_see_galactic_community` (`00_rules.txt:2388-2394`), name literal in the exe; `:69` says it in the file's own words - "The visibility needs to be set by this in Code" | **a schema family**: `common/resolutions/`, `resolution_categories/`, `resolution_groups/`, `galactic_focuses/`, `game_rules/`. `galactic_community_actions/` has 2 keys, both exe literals - closed |
| espionage (Nemesis) | the `espionage_tab` (`diplomacy_view.gui:1558`) inside `CDiplomacyView`, PLUS `interface/espionage_operation_view.gui` (1278) for one operation | engine-private; the map icon comes from `display_espionage_operations` (`common/map_modes/00_map_modes.txt:12`, used `:543-548`) | **three directories, one validated at load**: `common/espionage_operation_types/`, `_categories/`, `_assets/` (the load-time rules are section 24) |
| Overlord agreements | `interface/agreement_negotiation_view.gui` (1399 lines, root `:56`); its tab is `galaxy_view.gui:945` | the `is_subject` / `is_overlord` / `has_overlord` / `is_subject_type` trigger family plus two entry points (`terms_negotiation_button` `galaxy_view.gui:1488`, `action_negotiate_existing_agreement` `00_actions.txt:4605-4616`) | **a directory family with FOUR fixed `term_type` values**: `agreement_terms/` + `_term_values/` + `_presets/` + `_resources/`. A new term is free; a new term_type is not |
| the Shroud | a tab of the contacts view: `shroud_window` (`galaxy_view.gui:1571-2879`) + the template library `interface/the_shroud.gui` (352, no `windowType`) | game rule `can_open_shroud_tab` (`00_rules.txt:4451-4457`); tab names engine-only; `open_shroud_tab` needs the country's `standard_shroud_module` | **a directory of definitions**: `common/patrons/patron_types.txt` + `callings/` + `deeds/` + `psionic_auras/`; 3 closed `category` values, `GFX_<patron>_*` naming convention documented `:14-37` |

**The rule that falls out, and how to apply it.** Answer "which file is the host" and "who decides
visibility" from the files first (`grep` the `.gui` for `visible`/`trigger`/`if_`: zero means the
decision is a game rule or C++). Then find the WIDEST data door and write only that. Where the schema's
value set is closed - `SPECIMEN_TYPES`, `term_type`, a patron `category`, the 2
`galactic_community_actions` keys - a new VALUE is not a new feature: check for the literal in
`stellaris.exe` before promising it. The override door is the second route and it buys **layout only**;
it must keep every element name the engine fetches by name, because a renamed or deleted name is a
silently dead page rather than a script error (see section 19 and the `window-name-contract` topic's
espionage evidence: the engine fetches that window's controls by name, and `espionage_tab` /
`operations_grid` / `spy_power_bar` / the four `espionage_*_entry` templates are all exe literals, so a
fork of `diplomacy_view.gui` that drops a layer kills the page with no message anywhere).

**Where the detail lives.** `dlc-panels-are-engine-views` (the taxonomy - the canonical place),
`ark-panel-is-the-colony-panel` (the ark ship, section 22), `agreement-panel-is-data-not-gui` (the
agreement schema's four term types and the three coupled numbers),
`espionage-operation-types-are-checked-at-load` (section 24), and `host-gui-surface` /
`window-name-contract` for the override contract. Per-system topics exist only where a system has
detail worth its own file; the taxonomy carries the rest.

## 24. The engine validates `common/espionage_operation_types/` at load - and names your key

**The measurement.** Most `common/` schemas accept anything and fill a panel quietly. This one talks
back. The wave's probe mod shipped one deliberately under-defined operation next to a good one
(`stages = 2`, no `stage` block, no `on_roll_failed`) and the engine answered in the same second, at
FILE LOAD, on the main menu:

```
[08:47:42][espionage_operation_type.cpp:407]: Espionage operation 'probe_doors_e_bad_operation' does not have the expected number of stages.
[08:47:42][espionage_operation_type.cpp:529]: Espionage operation 'probe_doors_e_bad_operation' has no on_roll_failed, operation will never progress
```

The same run's positive control - `Unexpected token: custom_gui_probeZZ_doors_e_unknown_field, near
line: 28 ... in file: "events/zz_gui_probe_doors_e_events.txt" near line: 28` - proves the engine was
reading and validating that mod's files, so the silence elsewhere in that round is meaningful. Two more
messages exist in the binary and the probe never reached them (a valid operation does not):
`%s espionage operation stage #%i: Invalid event '%s'` and `%s espionage operation stage #%i: Invalid
event type for event '%s'. Expected: %s, actual: %s`.

**What the checker does with it.** `gui_check_files` routed any `common/<anything>/*.txt` that was not
an events file to the `common/button_effects` schema, whose rule ids are `button-effect-key-shape`,
`button-effect-not-a-block` and `button-effect-without-effect` - so an operation file was graded against
the wrong shape and the engine's own two errors were invisible to the tool. Three rules replace that,
in `src/lib/filecheck.mjs`:

| rule id | check | severity | stands for |
| --- | --- | --- | --- |
| `espionage-operation-stage-count` | the `stage` block count equals the declared `stages` (a missing or non-numeric `stages` is reported too) | error | `Espionage operation '<key>' does not have the expected number of stages.` |
| `espionage-operation-no-on-roll-failed` | the operation declares `on_roll_failed` | error | `Espionage operation '<key>' has no on_roll_failed, operation will never progress` |
| `espionage-operation-stage-event-unresolved` | every stage's `event` is among the events READ; fires only when at least one event file was actually passed | warning | `... Invalid event '<id>'` |

The fourth message - the event TYPE - is deliberately **not** checked: grading a stage event's type
needs the event's own definition, and an id that resolves to nothing cannot be told from an id defined
in a file the caller never passed. Guessing there would report a working mod as broken. The install
agrees with the rules' reading: **27** top-level operations across the three shipped files, and all 27
have `stages` equal to their `stage` count, an `on_roll_failed`, and an `event` on every stage - so the
rules fire on a broken file and stay quiet on vanilla's own. `common/espionage_operation_types/example.txt`
is entirely commented out, and is reported as an INFO ("registers nothing") rather than a warning.
`scripts/selftest.mjs` pins all three rule ids, their severities and the engine's verbatim messages
against a fixture, so removing a rule fails the suite by name.

**Also settled in that round, and worth not re-litigating: `if_resolution`.** The keyword is ACCEPTED
and its contents SKIPPED at file load: no line ever says `if_resolution` / `if_scaled_resolution` is an
`Unexpected token`, an unknown token INSIDE a block IS reported (including the condition KEYWORD name
itself - there is no condition-name whitelist), and a legal `position`/`size` payload inside a block
produces no line at all, so "read and accepted" and "never read" are distinguishable and the second is
the answer. The same keyword in `common/script_values/` is registered as an ordinary script OBJECT
(`Object with key: if_resolution already exists, using the one at file:
common/script_values/zz_probe_doors_b_ifres_values.txt line: 22`), i.e. the script loader does not know
it either, and "no error" there means "no use". **Runtime branching was NOT measured** - all four runs
stopped at the main menu - so `if_resolution` is not usable as a `visible`-style condition, and the
install's best test bed for the remaining half is `starbase_view.gui:874` (`max_height = 800`) versus
`:880` (`min_height = 801`), mutually exclusive at 960 height.



