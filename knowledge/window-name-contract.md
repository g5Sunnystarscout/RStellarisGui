---
id: window-name-contract
category: contract
title: A custom_gui window is not a blank canvas - the element-name contract
title_zh: custom_gui 窗口不是空白画布——元素名字契约
summary: The engine looks a fixed set of element names up BY NAME inside the container a custom_gui names, and dereferences every one it finds; a missing demanded name is a null dereference and the game crashes. This project demands 26 names out of the engine's 32-name table, and states which of the six it deliberately does not demand and why.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui, .txt]
tags: [custom_gui, contract, EVENT_DIPLO, option_list, close, portrait, crash, null-dereference, containerWindowType]
related: [window-dismissal, parking-elements, custom-gui-force-open]
sources: [<Stellaris>/interface/diplomacy_caravaneer_event_view.gui, <Stellaris>/interface/diplomacy_event_view.gui]
---

## What it is

The engine constructs an event window from a `containerWindowType` named by an event's
`custom_gui = "<name>"`, then binds the controls it needs by looking their names up inside that
container. This is not a template and not a convention: the name table is a contiguous ASCII list in
`stellaris.exe` placed immediately after the source path
`...\graphics\diplomatic_eventwindow.cpp`, and the binding code dereferences what it finds.

So the window's element names are a fixed contract. A name the engine demands and the window does not
declare is a null dereference — the window may render for a frame and then the game dies.

## Syntax

```
containerWindowType = {
	name = "geocentric_unga_main"          # the name custom_gui = "..." must carry

	containerWindowType = {                 # EVENT_DIPLO holds three names the engine resolves INSIDE it
		name = "EVENT_DIPLO"
		containerWindowType = { name = "option_list" }   # DIRECT child: one row per event option
		instantTextBoxType = { name = "action_title" }   # resolved inside EVENT_DIPLO
		instantTextBoxType = { name = "action_desc" }    # resolved inside EVENT_DIPLO
	}

	containerWindowType = {                 # the portrait CONTAINER, with an ICON of the same name inside
		name = "portrait"
		iconType = { name = "portrait" }
	}

	effectbuttonType = { name = "close" }   # MUST be the window's LAST direct child

	# ... every other demanded name, or parked (see the parked-elements topic)
}

# The engine's own table, verbatim, from stellaris.exe beside diplomatic_eventwindow.cpp:
#   event_option_entry  empire_info_bg  EVENT_DIPLO  option_button  INCOMING_TRANSMISSION
#   leader_traits  leader_traits_box  leader_details  leader_species  option_list
#   PICK_EVENT_OPTION  leader_traits_label  empire_traits_label
```

## The demanded set, and why it is 26 and not 32

The complete table the checker carries, in the order `src/lib/contract.mjs:64-98` declares it. `group`
is what the claim rests on: `binary` means the name is a literal in `stellaris.exe` beside
`graphics/diplomatic_eventwindow.cpp`; `vanilla` means it is a usage count over the install's own 177
`.gui` files. `windows` is that count, and `demand` is what the checker does about it.

| name | group | windows | in the working window | demand |
| --- | --- | --- | --- | --- |
| `event_option_entry` | binary | 1 | - | note |
| `empire_info_bg` | binary | 11 | yes | error |
| `EVENT_DIPLO` | binary | 10 | yes | error |
| `option_button` | binary | - | - | resolved inside the OPTION ROW, not demanded here |
| `INCOMING_TRANSMISSION` | binary | 0 | - | note |
| `leader_traits` | binary | 13 | yes | warning |
| `leader_traits_box` | binary | 2 | - | note |
| `leader_details` | binary | 10 | yes | warning |
| `leader_species` | binary | 10 | yes | warning |
| `option_list` | binary | 14 | yes | error |
| `PICK_EVENT_OPTION` | binary | 0 | - | note |
| `leader_traits_label` | binary | 2 | - | note |
| `empire_traits_label` | binary | 10 | - | note |
| `heading` | vanilla | 16 | yes | warning |
| `action_title` | vanilla | 12 | yes | warning |
| `action_desc` | vanilla | 12 | yes | warning |
| `alien_message` | vanilla | 12 | yes | warning |
| `alien_message_background` | vanilla | 11 | yes | warning |
| `tts_button` | vanilla | 26 | yes | warning |
| `portrait_background` | vanilla | 13 | yes | warning |
| `portrait` | vanilla | 42 | yes | warning |
| `empire_name` | vanilla | 20 | yes | warning |
| `empire_government_type` | vanilla | 12 | yes | warning |
| `empire_personality_type` | vanilla | 12 | yes | warning |
| `empire_flag` | vanilla | 17 | yes | warning |
| `empire_ethics_icons` | vanilla | 12 | yes | warning |
| `focus_button` | vanilla | 12 | yes | warning |
| `confirm_button` | vanilla | 17 | yes | warning |
| `opinion_window` | vanilla | 11 | yes | warning |
| `opinion_bg` | vanilla | 11 | yes | warning |
| `their_opinion_icon` | vanilla | 12 | yes | warning |
| `their_opinion` | vanilla | 12 | yes | warning |

A name is DEMANDED when it is not a note AND one of:

* a real `custom_gui` window the install ships declares it (`inWorkingWindow: true`), OR
* at least `CONTRACT_MIN_WINDOWS` (10) of the install's 177 `.gui` files declare it.

`demandedContractNames()` derives the set at `src/lib/contract.mjs:121`, and `REQUIRED_WINDOW_NAMES` /
`NOTE_WINDOW_NAMES` at `:126` / `:129`. Demanding all 32 would report the WORKING, live-verified trial
mod — and 8 of the install's own 10 event windows — as broken. The six carried as notes
(`event_option_entry`, `INCOMING_TRANSMISSION`, `leader_traits_box`, `PICK_EVENT_OPTION`,
`leader_traits_label`, `empire_traits_label`) each carry their reason beside them in that table;
`INCOMING_TRANSMISSION` and `PICK_EVENT_OPTION` are letterspaced heading art and the option-picker
prompt with **0** vanilla `.gui` uses in 4.4.6. Declaring them anyway is recommended; the safe idiom is
to declare and park (see the `parking-elements` topic).

`opinion_bg` is the one name written as a `background = { name = ... }` rather than an element, which
is why `has()` consults `backgroundNames` as well as element occurrences.

## Three structural rules that cost the most

`option_button` is deliberately NOT a window-level requirement. It is resolved inside the OPTION ROW
container an event names with `custom_gui_option`; vanilla's `enclave_caravaneer_option` is a
separate top-level container for exactly that reason. Treating it as window-level produced three
false errors on the working mod before the shape gate existed.

| rule | why | enforcement |
| --- | --- | --- |
| `option_list` must be a DIRECT child of `EVENT_DIPLO` | the engine instantiates one option row per event option into THAT list; a deeper list is never instantiated, so the window opens with no options and cannot be dismissed | `custom-gui-contract-nesting`, `src/lib/contract.mjs:378-393` |
| `action_title` / `action_desc` must live INSIDE `EVENT_DIPLO` | the engine resolves both inside that container, so a copy elsewhere is not the one it fills and the title/description stay empty | `custom-gui-contract-nesting`, `src/lib/contract.mjs:394-407` |
| the `portrait` ICON must be nested inside the `portrait` CONTAINER | the engine draws the character into the inner element; the container is what clips and masks it | `custom-gui-portrait-nesting`, `src/lib/contract.mjs:410-425` |
| `close` must be the window's LAST direct child | draw order is the engine's only z-order | `custom-gui-close-not-last`, `src/lib/contract.mjs:446-465` |

## Error versus warning

`explicit` decides it (`src/lib/contract.mjs:506`): a name missing from a window an EVENT actually
names with `custom_gui` is an ERROR, because the mod can cause the crash. A window the analyser merely
INFERRED is an event window (it has an `EVENT_DIPLO` child) gets a WARNING, because the install's own
event windows carry only 26–31 of the 32 names and this tool must not call a shipped vanilla file
broken.

## Evidence

- `binary`: `stellaris.exe` holds `...\source\graphics\diplomatic_eventwindow.cpp` followed by one contiguous ASCII table of the names that file asks for (`event_option_entry`, `empire_info_bg`, `EVENT_DIPLO`, `option_button`, `INCOMING_TRANSMISSION`, `leader_traits`, `leader_traits_box`, `leader_details`, `leader_species`, `option_list`, `PICK_EVENT_OPTION`, `leader_traits_label`, `empire_traits_label`). Reproduce with `node out/probe-binary-strings.mjs`.
- `vanilla`: 123 of the install's 177 `.gui` files declare at least one of those names; the 10 real event windows declare 26–31 of the 32 this project carries. `docs/gui-pitfalls.md:53-59`.
- `log`: the crash dumps `20261004_235121`, `20261005_000027`, `20261005_000450`, and the trial mod's own header comment `# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE` at `interface/zz_geocentric_unga.gui:2726-2730`.
- `log`: `Could not find <name> in window <window>` is the only signal the engine gives, and it appears on the frame before the crash.
- `log`, **2026-10-06 — the same crash from the other direction: the demanded names are missing because the engine substituted the WRONG container.** A `diplomatic = yes` event whose `custom_gui` names a window defined nowhere produced `[gui.cpp:1057]: Tried to get gui_type [gui_probe_q2_zzz_no_such_window_diplo] which does not exist`, then the engine substituted `interface/popup.gui`'s `ok_popup_window` and demanded ten of the names above **inside that popup** (ten `containerwindow.h:88` lines ending `in window "ok_popup_window".`), then `Unhandled Exception C0000005 (EXCEPTION_ACCESS_VIOLATION)` — the same fault address and a byte-identical 15-frame stack body as the three dumps listed above, measured twice (run F and the v2 run). The **same** kind of unresolvable name on a non-`diplomatic` event wrote **nothing at all** — not even the lookup line, 0 occurrences of the name in any log on the machine — and the engine drew the **ordinary default event window** instead (v2 run; the `ok_popup_window` substitute belongs to the diplomatic path). `PROBE-RESULTS.md` §4 and §10.1; GAP-17 in `PLUGIN-GAPS.md`.
- `measured`: an early revision nested `option_list` two containers deep and the sidebar stayed empty. `docs/gui-pitfalls.md:77`.
- `vanilla`, **the same by-name lookup rule is what an OVERRIDE has to respect in the DLC panels, and there it fails with no log line at all.** The espionage view is a `CDiplomacyView` tab whose controls the engine fetches **by name** - `espionage_tab`, `espionage_tab_button` / `_active`, `operations_grid`, `assets_grid`, `target_gridbox`, `spy_power_bar`, `spynetwork_level` and the four `espionage_*_entry` templates are all literals in `stellaris.exe`. A mod that overrides `interface/diplomacy_view.gui` (3290 lines - the only way to touch that page, since overriding is whole-file) and renames or deletes a layer therefore **kills the page or the control silently**: no `Could not find ... in window` line, no `Unexpected token`, no script error, because nothing in the `.gui` names the layer - C++ does. The same shape holds for every DLC view in `dlc-panels-are-engine-views` (collection `exhibitions_grid` -> `exhibition_grid_entry`, agreements `agreement_term_entry`, the Shroud's `shroud_plane_patrons`). This is the GAP-17 family one panel out: the ENGINE's expectations are an unstated contract, and the file that breaks it is the file the mod shipped.
- `measured`: `close` was direct child #31 of 43 with `EVENT_DIPLO` (200x620) after it, so `EVENT_DIPLO` drew over the X. `docs/gui-pitfalls.md:80`.
- `vanilla`, the reference window to copy: `interface/diplomacy_caravaneer_event_view.gui` (`containerWindowType enclave_caravaneer_window`, lines 34-364). It is the shape the working mod's six windows were built from.

## Rules

- Never add a `custom_gui` window without checking `REQUIRED_WINDOW_NAMES` against it. `gui_layout_validate` and `gui_check_files` both report `custom-gui-contract-missing`.
- Put `option_list`, `action_title` and `action_desc` as DIRECT children of `EVENT_DIPLO`. A deeper copy is inert.
- Put an `iconType` named `portrait` INSIDE the `containerWindowType` named `portrait`.
- Put `close` last. Draw order is z-order; there is no z field.
- Declare each name once. `custom-gui-contract-duplicate` exists because the engine resolves a name to whichever occurrence it reaches first — a duplicate `close` in a parked position is what broke the trial mod's window.
- `custom_gui` names an existing `containerWindowType`; `gui_interface_inventory { kind: "containers" }` lists the install's own so a mod does not silently merge into a vanilla window (`container-name-collision`). **"Existing" is now CHECKED, and the check is graded by path** (`custom-gui-unknown-window`, GAP-17): the name is resolved against the plugin's own index, and a name that exists in NO root is an **ERROR** when the same block declares `diplomatic = yes` - measured in a loaded game twice, that combination substitutes `ok_popup_window`, demands the ten names inside it and null-dereferences into `EXCEPTION_ACCESS_VIOLATION` - and a **warning at most** without it, where the engine writes nothing at all (not even its lookup line) and draws the ordinary default event window instead. `diplomatic = yes` is NOT a requirement for the field: it selects the event-window class, and vanilla's 65/65 is the convention the emitter follows.
- The lesson generalises (see the `engine-capability-vs-usage` topic): this contract came from the ENGINE'S BINARY, and counting what vanilla content uses would have produced a different, weaker set.
- An override of a vanilla view that the engine fills **keeps every control name the engine fetches**, even the ones that look decorative. Overriding a DLC panel's host file and renaming or deleting a layer does not produce a script error or a log line - the page or that one control simply stops working, because the lookup is in C++ and the `.gui` never names it (`dlc-panels-are-engine-views`; the espionage page's literals are listed in Evidence).

## 待确认

- Whether the engine dereferences a demanded name it finds at any depth, or only within a bounded search. The demanded set is stated as "somewhere in the window's subtree" (`collectNames`), which matches every window that has been verified live; the exact traversal is not observable from the files.
- The eight install `.gui` files that declare one of these names but are not event windows are excluded by `isEventWindow` rather than by a positive identification, so the "10 real event windows" figure is this project's classification, not a number the engine states.
- ~~Which of the probe's two unresolvable-name events the single `gui.cpp:1057` line belongs to.~~ **Closed by the v2 run of the same night**: `.3` and `.4` now carry DIFFERENT bogus names (`…_nondiplo` / `…_diplo`), the one lookup line in the log names `…_diplo`, and `…_nondiplo` occurs **0** times in that log and in all eight `crashes\*\error.log` on the machine - so the line identifies its own event, with no timestamp inference.
- Which container the non-diplomatic path draws. The v2 run measured the negative half exactly - the bogus name occurs **0** times in the whole log, so the engine wrote nothing, not even its lookup line - and the user reports the window it drew as the ordinary default event window, the same thing an event with no `custom_gui` at all shows. No log line names the container, so that identification is a report rather than a measurement.
- Whether the non-diplomatic path has a contract set of its own that it can fail against. It demanded nothing and reported nothing, which is consistent with no contract at all but does not prove one is absent.
