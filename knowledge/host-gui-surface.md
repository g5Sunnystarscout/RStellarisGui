---
id: host-gui-surface
category: contract
title: Overriding a vanilla .gui is a proven technique - the job is the anti-drift workflow, not avoidance
title_zh: 覆写原版 .gui 是成熟技术——功课在防漂移流程，而不在回避
summary: The install ships 177 interface/**/*.gui files and a mod can shadow any of them. That is the ONLY route onto a screen the engine opens for its own reasons, and two mods on the reference machine do exactly that, both with the same pattern - copy the vanilla file byte for byte, inject a delimited block into a named container, and record which version the base was. The classic ascension-perk-slot mods go further and change NUMBERS in an engine-populated list, which is the same technique pointed at a different target. This topic states the pattern, the per-surface trade-offs of the two routes, and what a version patch costs.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui]
tags: [override, shadowing, interface, planet_view, fleet_view, ascension_perks_view, host-surface, anti-drift, sha256]
related: [script-routes-to-a-window, override-maintenance-workflow, window-name-contract, engine-populated-containers]
sources: ["https://stellaris.paradoxwikis.com/Tradition_modding"]
---

## What it is

A mod that ships `interface/<same name>.gui` **replaces** the base file for that load, so its elements
are drawn wherever the engine draws that view. This is not a workaround and it is not rare: it is the
second of the only two routes a mod UI has, and the only one that needs no script at all, because
there is no effect that opens a window (`script-routes-to-a-window`).

**Two mods on the reference machine prove it, and both use one pattern.** Measured directly:

* `<mods>\aerospace_carrier\interface\fleet_view.gui` — **2398 lines against the vanilla
  file's 2355**. A line-level comparison finds **0 vanilla lines removed or altered** and **43 lines
  added**: the vanilla file byte for byte, plus one delimited block. Its header says which file,
  which version, what was added and what to do next:

  ```
  # OVERRIDE of the vanilla fleet view (interface/fleet_view.gui, 4.4.6), by the aerospace
  # carrier mod. It is byte-identical to the vanilla file except for the hand-written
  # "aerospace_carrier_bridge_bar" container injected into the `bottom` container below.
  # Re-copy the vanilla file when the game version changes.
  ```

* `<mods>\geocentric_origin\interface\planet_view.gui` — **8502 lines against 8483**, a
  single added container, with the same "re-copy on version change" note in its head.

And the **ascension-perk-slot** mods are the same technique aimed at NUMBERS rather than additions.
This project cannot read those mods' files (none is installed), so the technique is derived from the
file they must edit, which the vanilla file and the wiki both name:

* the wiki states it from the outside: *"The Ascension Perk selection menu UI file is
  `ascension_perks_view.gui`"*, and of the tradition screen, *"Without modding this file, new
  Tradition Groups as well as new Traditions can't be made visible in the UI"*;
* the vanilla file states it from the inside — the screen's **capacity** is four numbers in it, and
  every container holding them is ENGINE-POPULATED (0 nested elements install-wide):

  ```
  :85   containerWindowType "perks_list_box"          size = { width = 500 height = 448 }
  :95   smoothListboxType   "ascension_perks_list"    size = { x = 480 y = 433 }
  :127  gridBoxType         "ascension_perks_grid"    max_slots_horizontal = 1
                                                      slotsize = { width = 470 height = 86 }
  :107  # Actual height is set in code depending on how many APs the category has
  ```

So more perk slots on screen = make those containers bigger or give the grid more columns. The ITEMS
come from `common/ascension_perks/`; how many are REACHABLE comes from those numbers. A mod that adds
perks without touching this file has perks the player cannot select.

## Syntax

```
# THE PATTERN, as both shipped overrides use it.
# 1. the vanilla file, byte for byte, with its own lines untouched
guiTypes = {
	containerWindowType = {                       # a VANILLA container, unchanged
		name = "bottom"
		...
		# ------------------------------------------------------------------
		# Hand-written button bar (this mod). Real, persistent UI: these are
		# effectbuttonType elements inside a container the engine instantiates,
		# and each one runs an entry from common/button_effects/ directly - no
		# event window is involved.
		# ------------------------------------------------------------------
		containerWindowType = {
			name = "my_mod_bridge_bar"            # this mod's own container, spliced in
			position = { x = 210 y = 25 }
			effectbuttonType = { ... }
		}
	}
}

# 2. the header: which file, which version, what was added, what to do after a patch
# OVERRIDE of the vanilla fleet view (interface/fleet_view.gui, 4.4.6), by the <mod> mod.
# It is byte-identical to the vanilla file except for the hand-written "<name>" container
# injected into the `<container>` container below.
# Re-copy the vanilla file when the game version changes.

# 3. THE PLUGIN'S FORM OF THE SAME THING - and it records the base as a HASH, not as prose
#    gui_emit_override { vanilla_path, additions: [{ container: "bottom", element: {...} }],
#                        i_understand_this_overrides_vanilla_file: true }
#      -> header carries `# vanilla source sha256: <hash>`; a later run with
#         `expected_source_hash` REFUSES when the base moved
#    gui_override_drift { overridden_path, vanilla_path }
#      -> has the base moved, what vanilla content is the override dropping, which elements does it
#         CHANGE and in which direction, and is each addition still spliced into a container that exists

# 4. THE NUMBER-CHANGING FORM (ascension / tradition slots)
#    the same door; the "addition" is the container itself, re-declared with new numbers:
#    containerWindowType = { name = "perks_list_box"  size = { width = 700 height = 640 } }
#    A `gui_override_drift` run reports it as `override-modifies-vanilla-element`, with the direction:
#      "size vanilla 500x448 -> your copy 700x640".
```

## The two routes, per surface, with what each costs

| surface | route (a) insert without overriding | route (b) override | what a patch costs under (b) |
| --- | --- | --- | --- |
| an event window (`eventwindow.gui`, the 8 `diplomacy_*_event_view.gui`) | **YES** — `custom_gui = "<container>"` on an event, plus `custom_gui_option` for option rows. This is the cheap route and the working mod uses it (the element names such a window must declare are the subject of `window-name-contract`) | possible, but there is no reason to | — |
| a screen the engine opens (planet, fleet, galaxy, outliner, empire, technology, ship designer, situation log) | **NO** — no effect opens a view, and none of these windows is reachable by name from script | **YES, and it is the only way** | re-copy the new base and re-apply the edit; a renamed container moves the splice |
| a screen whose CAPACITY is in the file (ascension perks, traditions, `core.gui` templates) | **NO** — the capacity is a number in the `.gui`, and the items are engine-populated | **YES** — change the numbers | re-apply the numbers onto the new base; a size change in vanilla is easy to miss because nothing errors |
| the topbar / HUD (`main.gui`, `main_bottom.gui`, `topbar_*_view.gui`) | no hook; an overwriting UI framework is the normal answer (`core.gui` + `main.gui` are what the Kasako framework's 20 files build on) | **YES** | the largest blast radius: every other mod that overrides the same file conflicts |
| a whole-UI overhaul | **YES, as its own framework** — Kasako Core ships **20 `.gui` files, 0 of them shadowing a vanilla file**, and drives them from `custom_gui` + `custom_gui_option` hooks | only for `core.gui`/`main.gui` | — |

The concrete files, measured: `interface/planet_view.gui` **8483 lines / 276 windows** (the largest in
the install), `interface/customize_species_editors.gui` 4400 / 124, `interface/galaxy_view.gui` 3488 /
98, `interface/diplomacy_view.gui` 3291 / 98, `interface/ascension_perks_view.gui` **194 lines / 3
windows** (the cheapest override in the install, and the one the perk mods take),
`interface/fleet_view.gui` 2355 / 66, `interface/core.gui` 491.

## Evidence

- `measured` (read-only, on this machine): `aerospace_carrier/interface/fleet_view.gui` is 2398 lines
  and `Compare-Object` against `<Stellaris>\interface\fleet_view.gui` (2355 lines) reports
  **43 lines only in the mod file and 0 lines only in vanilla** — a strict superset. Its header
  (lines 1-4) names the file, the version (`4.4.6`), the added container
  (`aerospace_carrier_bridge_bar`) and the instruction `Re-copy the vanilla file when the game
  version changes.`
- `measured`: `geocentric_origin/interface/planet_view.gui` is 8502 lines against vanilla's 8483,
  with the same re-copy note. Both mods' `descriptor.mod` declare `supported_version="v4.4.*"`, which
  covers the installed `v4.4.6`.
- `measured`: `gui_override_drift` on both files reports `added` = the mod's own elements with the
  container each hangs off (`aerospace_carrier_bridge_bar` -> `bottom`, both buttons ->
  `aerospace_carrier_bridge_bar`), `missing` = **0**, and `override-base-unrecorded` — neither header
  records a hash, so whether the base has moved is undetectable from the file. That is the gap the
  plugin's own header (`# vanilla source sha256:`) closes.
- `measured`: the whole-UI framework on this machine takes route (a), not (b): `! Core Framework of
  Kasako` (`ugc_2466607238`) ships **20 `.gui` files and none of them has a vanilla counterpart**
  (`FW_ui_*.gui`, `RTS_ui_FW.gui`, `伞MUI_*.gui`); `! Immersive Stellaris Collection !` ships one
  (`伞IBS_mapicons.gui`), likewise new.
- `vanilla`: `interface/ascension_perks_view.gui` is **194 lines** with three windows, and holds the
  four capacity numbers above (`:85`, `:95`, `:127`, `:131`), with `:107` stating in the file itself
  that the height is `set in code depending on how many APs the category has`.
- `vanilla`: all four of those containers are engine-populated — measured over the install, 0 of 261
  `gridBoxType`, 189 `OverlappingElementsBoxType`, 242 `smoothListBoxType` and 43 `listBoxType`
  blocks contain a nested element. See `engine-populated-containers`.
- `log`: the wiki records the file that must be changed for each screen: "The Ascension Perk
  selection menu UI file is `ascension_perks_view.gui`", and of the tradition screen "Without modding
  this file, new Tradition Groups as well as new Traditions can't be made visible in the UI". Cited
  as a cross-check on the vanilla file's own structure, which is the primary evidence.
- `log`: the mods that extend perk slots, named by their Workshop/Nexus listings and confirmed by
  search - *Magnum's Mods - Ascension Perks Slots*, *Ascension Perk Increase (20 or 25 Slots)*,
  *All Ascension Perk Slots - FGRaptor*, *72 Ascension Perk Slots*, *UI Overhaul Dynamic - Ascension
  Slots*, *28 Ascension Perk Slots and 11 Traditions Slots*. **None is installed on this machine**, so
  their file contents were NOT read: what they must change is derived from the vanilla file's
  structure and the wiki's statement, not from their source.

## Rules

- Overriding is a first-class option, not a last resort. Choose it when the elements must appear on a
  screen the engine opens for its own reasons - there is no script route to such a screen.
- Follow the pattern the shipped overrides use, because it is the one that survives a patch: copy the
  vanilla file, change as little as possible, put your block inside a NAMED vanilla container, and
  delimit and comment it so a human can see what is yours.
- RECORD THE BASE. Prose ("4.4.6") tells a human; a hash tells the machine. `gui_emit_override` writes
  `# vanilla source sha256:` and honours `expected_source_hash`; run `gui_override_drift` when you want
  to know what moved.
- Prefer the smallest file that will do. `ascension_perks_view.gui` is 194 lines;
  `planet_view.gui` is 8483. The perk mods chose well.
- Keep the vanilla lines byte-identical. Do not regenerate an override from a parsed model: the file's
  comments are documentation (`gui-pitfalls.md` §15), and a reflow loses them. Use `gui_emit_override`
  (source + additions) or `gui_emit_files { apply_to }`.
- When the base moves, re-apply your edit onto the NEW base rather than keeping your old copy. For a
  number change that means re-writing the number; for an addition it means re-splicing. `apply_to`
  keeps every untouched line byte-identical while doing it.
- Reach for the insert-without-overriding route first wherever a hook exists: `custom_gui` on an event,
  and `custom_gui_option` for option rows. Both are measured, and the Kasako framework runs an entire
  UI off them with zero overrides.

## 待确认

- Whether the engine merges sibling `.gui` files at all, or strictly replaces by basename. Every
  observation is consistent with strict replacement (both shipped overrides are full copies), but a
  targeted experiment was not possible without writing to a mod tree or `dlc_load.json`.
- What the ascension-perk mods' files actually contain. None is installed and their Workshop sources
  are not available offline, so their technique is derived from the vanilla file and the wiki, not
  read. The one thing that IS established is which file must change and which four numbers carry the
  capacity.
- Which of the 177 files a patch is likely to touch. No source states it. `planet_view.gui` is the
  only file this project has a recorded failure about (a full override invalidated by a 4.4.x patch to
  it), and `fleet_view.gui` is the only one with a shipping example of the pattern.
- Whether two mods overriding the same file both load, and in what order. Paradox load order decides,
  and neither this project nor the two shipped overrides records a measurement of it.
