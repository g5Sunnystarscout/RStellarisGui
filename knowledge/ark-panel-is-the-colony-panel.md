---
id: ark-panel-is-the-colony-panel
category: contract
title: The ark ship panel IS the colony panel - one window, two name sets, picked by the ENGINE from the colony's carrier
title_zh: 方舟舰面板就是殖民地面板——同一个窗口、两套元素名，由引擎按殖民地的「载体」类型挑选
summary: The Nomads DLC's ark ship panel is not a new .gui and not an engine rewrite of a panel. The engine's planet view class (CPlanetView, whose bound callbacks take a CFleet AND a CPlanet) opens the SAME `planet_view` window in interface/planet_view.gui in an arkship mode, because 4.4.6 introduced the colony CARRIER: a colony's carrier is a planet normally and a SHIP for an arkship. The arkship's element names (arkship_elements, arkship_tab, ...) sit inside the planet view's own contiguous name table in stellaris.exe, next to planet_pops_amount and summary_tab, and are shown/hidden by name. The ONLY switch a mod can flip is data - `carries_colony = <planet_class>` plus `class = shipclass_starbase` on a ship size - and vanilla's own comment says what it does: "Enables Arkship custom UI".
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui, .txt]
tags: [arkship, colony_carrier, carries_colony, planet_view, name-table, binary, CPlanetView, nomads, variant-panel, hardcoded-ui, override, common-arkships, measured-negative, load-time-probe]
related: [window-name-contract, host-gui-surface, engine-populated-containers, control-visibility-is-a-potential, engine-capability-vs-usage, dlc-panels-are-engine-views]
sources: [<Stellaris>/interface/planet_view.gui, <Stellaris>/common/ship_sizes/29_nomads_dlc_ships.txt, <Stellaris>/common/planet_classes/06_planet_classes_nomads.txt, <Stellaris>/common/ship_sizes/00_ship_sizes.txt, <Stellaris>/common/planet_classes/00_planet_classes.txt, <Stellaris>/stellaris.exe, <clone>/unga-fix/DOORS-RESULTS.md, <mods>/gui_probe_doors_a, <mods>/gui_probe_scratch/logs]
---

## What it is

The 方舟舰 (ark ship) panel is **the colony panel**, and the engine chooses between two sets of
elements inside it at runtime. There is no `arkship.gui`, no `arkship_view.gui` and no
`CArkshipView`: the panel is the `planet_view` window of `interface/planet_view.gui:222`, and the
DLC's additions are ~37 declarations inside it whose names begin with `arkship_`.

The engine-side half is a new object relation introduced with 4.4.6, the **colony carrier**:

* `C:\mnt\gsg\stellaris\augustus\augustus\source\spatial_objects\colony_carrier.cpp` and
  `CColonyCarrier::RandomizeDeposits_1` are literals in `stellaris.exe` - a source file and a class
  that did not exist before;
* the engine's own script documentation states the relation twice
  (`logs/script_documentation/scopes.log:398`): `carrier - Scopes from a colony to its carrier.`
  with supported scopes `planet ship colony` and **output scope `planet`**, and `scopes.log:94`:
  `ship - Scopes from a starbase to its station ship or from a colony to its carrier ship.`
  with output scope `ship`. The two links are different objects, which is exactly the arkship's
  shape: a colony that sits on a planet-like object, carried by a ship;
* `triggers.log:3643` documents the discriminator: `carrier_is_type - Checks if the carrier is of a
  specific type`, whose value is `planet/ship`.

So a colony always has a carrier, and the carrier is normally the planet the colony sits on. An
**ark ship is a colony whose carrier is a ship** - specifically a ship of `class = shipclass_starbase`
that declares `carries_colony = <planet_class>`. Vanilla's own comment on the field says the whole
thing out loud (`common/ship_sizes/29_nomads_dlc_ships.txt:113-114`):

```
class = shipclass_starbase			# Needs to be a Starbase to have starbase modules and buildings.
carries_colony = pc_ark				# Enables Arkship custom UI.
```

The content-side half is that the planet view's element names were extended with a parallel arkship
set in the SAME window, and the engine resolves whichever name matches the carrier. That is the same
technique `window-name-contract` documents for event windows, one view over: **the names are a
contract - the engine looks them up by name and uses the set that answers.** Two observations fix it:

1. The arkship names are in the planet view's own name table in the binary, interleaved with the
   planet's. At exe offset ~39545888 the strings run
   `... planet_pops_amount, planet_stability_amount, districts_grid_box, ... summary_tab,
   summary_tab_active, management_tab, management_tab_active, population_tab, population_tab_active,
   arkship_tab, arkship_tab_active, armies_tab, armies_tab_active, corporate_tab, arkship_elements,
   arkship_portrait_window, arkship_planet_top_bar, arkship_header_background, arkship_build_armies,
   arkship_build_ships, arkship_level, arkship_focus_on, arkship_inspect_ship,
   arkship_cloaking_values, ... arkship_pops_amount ...`. 126 distinct `arkship`-bearing strings are
   in the binary; a lowercase-identifier pass over them finds **39** that are declared as a quoted
   name somewhere under `interface/**`, and **32** of those are declared in `planet_view.gui`. The
   other 24 are values and keys, not elements (`arkship_picture`, `is_starting_arkship`,
   `arkship_ship`, `arkship_settle`, `arkship_nebula`, `arkship_star`, `arkship_tents`,
   `on_arkship_encamped`, `automation_group_arkship`, ...).
2. A single engine class opens it, and its callbacks take both a fleet and a planet. The mangled
   names in the exe are
   `.?AV?$bind_t@XV?$mf3@XVCPlanetView@@PEBVCFleet@@PEBVCPlanet@@_N@...` and
   `.?AV?$bind_t@XV?$mf4@XVCPlanetView@@V?$TPdxRef@VCFleet@@@@V?$TPdxRef@VCPlanet@@@@_NAEBVCPersistentName@@@...`
   - i.e. `CPlanetView::something(const CFleet*, const CPlanet*, bool)` and a
   `(PdxRef<CFleet>, PdxRef<CPlanet>, bool, const CPersistentName&)` overload. `CArkship` and
   `arkshipview` occur **0** times in the binary.

The mechanism, stated for a modder: **you cannot write an ark ship panel, and you cannot choose which
of the two sets is drawn. You can only make a hull that the engine decides is an ark ship, and it
then draws the vanilla one.** Nothing in the `.gui` participates in the decision: measured, the whole
8483-line file contains **0** `visible` / `trigger` / `enabled` blocks and **0** references to
`pc_ark`.

## Syntax

```
# 1. THE SWITCH - data only, in common/ship_sizes/<yours>.txt. Both keys are engine-enforced:
#    a ship size with carries_colony but NOT class = shipclass_starbase is refused, and a ship
#    that is supposed to carry a colony and does not is killed on a daily basis.
my_arkship = {
	class = shipclass_starbase              # required - the exe logs
	                                        #   "Arkship size %s does not have class = shipclass_starbase"
	carries_colony = my_ark_planet_class    # required - the exe logs
	                                        #   "Arkship size %s does not have carries_colony"
	arkship_picture = "arkship_civilian"    # optional; exe: "Ship size %s specifies arkship_picture
	                                        #   but does not have a valid carries_colony"
	planet_view_header = "GFX_arkship_planetview_header_civilian"
	                                        # optional; exe: same requirement, same message shape.
	                                        # NOT documented in common/ship_sizes/00_ship_sizes.txt
	is_starting_arkship = yes               # optional; only for a random nomadic start
	base_ship_size = "civilian_arkship_tier_1"
}

# 2. THE PLANET CLASS the colony is made of (common/planet_classes/<yours>.txt).
#    `conditional_icon`'s trigger runs in the CARRIER's scope, so this is where a planet class
#    can vary its own art by which ship carries it. Vanilla says so in the same file
#    (00_planet_classes.txt:49): "# scope: colony_carrier (planet or ship depending on carrier type)"
pc_ark = {
	colonizable = yes
	district_set = nomad
	is_artificial_planet = yes
	default_planet_selection = yes
	single_build_queue = yes                # merges the colony's, the carrier's and the carrier
	                                        # starbase's build queues into ONE (00_planet_classes.txt:59)
	conditional_icon = {
		trigger = { ship = { is_ship_size = civilian_arkship_tier_1 } }
		icon = GFX_planet_type_civilian_arkship_1
		icon_large = GFX_planet_type_civilian_arkship_1_big
	}
}

# 3. WHAT THE ENGINE DRAWS - one window, two sets, both declared at the SAME coordinates.
#    interface/planet_view.gui, inside containerWindowType "planet_view" (:222-:4699):
#      :260  planet_portrait_window        :347  arkship_portrait_window
#      :314  planet_top_bar  {x = -14 y = -47}
#      :325  arkship_planet_top_bar {x = -14 y = -47}      same slot, GFX_arkship_banner
#      :3444 summary_tab / management_tab / population_tab (x = 245)
#      :3525 arkship_tab   {x = 381 y = @tab_height}  shortcut = "v"  buttonText = "ARKSHIP_CONTROLS"
#      :3552 armies_tab    {x = 381 y = @tab_height}  shortcut = "v"  buttonText = "GROUND_COMBAT_TAB"
#      :604-:1051 arkship_elements - 448 lines, 53 named elements, NO size of its own
#
# 4. Detecting one in script - the class name is NOT how the engine knows:
#    carrier_is_type = ship        # engine trigger, triggers.log:3643
#    is_arkship_ship = yes         # scripted trigger, 09_scripted_triggers_nomads.txt:157
#    is_arkship_starbase = yes     # scripted trigger, :172  (has_starbase_size = civilian_arkship_tier_1)
```

## Evidence

- `binary`: `stellaris.exe` holds the arkship element names **inside the planet view's contiguous name table**, not in a table of their own - at offset ~39545888 the run reads `... planet_pops_amount, planet_stability_amount, districts_grid_box, available_districts_window, ..., summary_tab, summary_tab_active, management_tab, management_tab_active, population_tab, population_tab_active, arkship_tab, arkship_tab_active, armies_tab, armies_tab_active, corporate_tab, arkship_elements, arkship_portrait_window, arkship_planet_top_bar, arkship_header_background, arkship_build_armies, arkship_build_ships, arkship_level, arkship_focus_on, arkship_inspect_ship, arkship_cloaking_values, ... arkship_buildings_grid, arkship_lower_buildings_grid, arkship_modules_grid, arkship_spinal_mount_grid, arkship_stage_icon, arkship_pops, arkship_governor_window, arkship_pops_amount ...`. Reproduce with `node exestr-context.mjs <exe> arkship_elements 30 30` (the probe scripts live in `<clone>/.dsh-scratch/`).
- `binary`: the view class is `CPlanetView` and its bound callbacks take a fleet AND a planet: `.?AV?$bind_t@XV?$mf3@XVCPlanetView@@PEBVCFleet@@PEBVCPlanet@@_N@_mfi@boost@@...` (i.e. `(const CFleet*, const CPlanet*, bool)`) and `.?AV?$bind_t@XV?$mf4@XVCPlanetView@@V?$TPdxRef@VCFleet@@@@V?$TPdxRef@VCPlanet@@@@_NAEBVCPersistentName@@@...`. There is **no** `CArkship` / `CArkshipView` / `arkshipview` string in the binary - the arkship panel is not a view of its own.
- `binary`: the new engine class and its source file are literals - `C:\mnt\gsg\stellaris\augustus\augustus\source\spatial_objects\colony_carrier.cpp`, `CColonyCarrier::RandomizeDeposits_1`, `CColonyCarrier::RandomizeDeposits_2`; plus the loc keys the C++ asks for: `COLONY_CARRIER`, `OPEN_COLONY_CARRIER`, `GOTO_CARRIER`, `CARRIER_IS_TYPE`, `CARRIER_IS_NOT_TYPE`, `CANNOT_ENCAMP_CARRIER_TYPE`, `CANNOT_TERRAFORM_CARRIER_TYPE`, `GO_TO_COLONY_IN_CARRIER_tt`.
- `binary`: the ship-size keys are literals and the engine states its own requirements in error strings - `carries_colony`, `planet_view_header`, `arkship_picture`, `encampment_required_progress`, `base_ship_size`, `is_starting_arkship`; and `"Arkship size %s does not have carries_colony"`, `"Arkship size %s does not have class = shipclass_starbase"`, `"Ship size %s specifies arkship_picture but does not have a valid carries_colony"`, `"Ship size %s specifies planet_view_header but does not have a valid carries_colony"`.
- `binary`: `pc_ark` occurs **0** times in `stellaris.exe`, while `carries_colony` does - so the arkship UI is not selected by the planet class's NAME, it is selected by the carrier relation those fields create.
- `binary`: the engine also declares a content directory it does not ship: the ordered load table at offset ~38379912 begins `common/arkships, common/armies, common/buildings, common/districts, common/zones, ...`. `<Stellaris>/common/arkships` does **not** exist in 4.4.6, and no DLC zip in `dlc/**` contains a `common/`, `interface/` or `events/` entry (all 40 zips contain only art/audio/localisation overrides - measured), so "declared but empty" is the state of that directory. **That list is NOT a list of directories the engine reads**, and the proof is in the same table: `common/specimens` is absent from it while `common/specimens/specimens.txt` demonstrably loads (258 definitions, and the engine names a specimen it does not like - `Invalid specimen type: probe_door_d for specimen probe_door_d_specimen`). What the table actually is - "the batch mounted early", most likely - is not established; what it is not is a capability list. The engine never prints the table at all: `common/arkships` has **0** hits across four runs' worth of `error.log` / `setup.log` / `debug.log` / `system.log`.
- `log`, **the in-game probe that turns the arkship directory from "declared but unusable" into a measured negative** (`DOORS-RESULTS.md` section 1, probe mod `<mods>/gui_probe_doors_a`, run1 08:42:41-08:43:40 and run3 08:47:05-08:48:00, Stellaris 4.4.6, logs preserved under `<mods>/gui_probe_scratch/logs/doors-run{1,3}-*`): seven files under `common/arkships/` - `zz_probe_doors_a1_keyed.txt` (8 lines, top-level `key = { }`), `a2_barelist` (8, a bare token list), `a3_named` (12, a named block using the PLAUSIBLE arkship field names), `a4_scalar` (5, plain `key = value`), `a5_malformed` (5, **one closing brace missing**), `a6_valid_unknownfield` (5), `a0_clean` (6) - each carrying at least one impossible token (`probeZzships*`), produced **0** lines: `probeZzships*` / `probeZz_arkship_*` / `common/arkships` are 0 hits in `error.log`, `setup.log`, `debug.log` and `system.log`. The cleanest single shot is the malformed file: **any** parser that opens it leaves a trace, and the engine is otherwise totally silent about directories it does not know. The mount control in the same mod's `interface/` folder was named in run3 (`[08:47:12][persistent.cpp:41]: Error: "Unexpected token: probeZZmount_control_token, near line: 9" in file: "interface/zz_gui_probe_doors_a_mountcontrol.gui" near line: 9`), and run1's log was demonstrably talkative (4 `persistent.cpp:41` lines plus one `gridbox.cpp:51` line naming `interface/main.gui`, and 169 `Unexpected token` lines in total). Verdict in the report: **high confidence that the engine does not read a mod's `common/arkships/`**; the inferred reason is that this build ships no PARSER for it - the directory name in the table is a declaration, and a declaration is not a capability.
- `log`, the Ark ship's own writer confirms the split from the other side: the ark ship's hull fields DO work (`carries_colony` turns a hull into a mobile colony and hands it the hardcoded UI - `common/ship_sizes/00_ship_sizes.txt:97-99` documents the field and its kill condition), while `common/arkships` does nothing. The arkship feature exists; it does not go through that directory.
- `log`: the engine's own script documentation dump agrees with the file reading - `%USERPROFILE%/Documents/Paradox Interactive/Stellaris/logs/script_documentation/scopes.log:398` `carrier - Scopes from a colony to its carrier.` (supported scopes `planet ship colony`, output `planet`), `scopes.log:94` `ship - Scopes from a starbase to its station ship or from a colony to its carrier ship.`; `triggers.log:3643-3644` `carrier_is_type - Checks if the carrier is of a specific type` / `carrier_is_type = planet/ship`; `triggers.log:976` `has_carrier_flag - Checks if the colony carrier has a specific flag`; `effects.log:3080` `transfer_carrier = { source = <source colony/carrier>  target = <target carrier> }`; `effects.log:356` `create_colony = yes/no (default: yes; if yes, will also create the carrier colony, only when ship_size is marked to carry a colony. WARNING: carrier ships with no colony are killed on a daily basis)`; `effects.log:189` `(Note: Colony doesn't store flags. Using any of the carrier_flag effects/triggers in colony scope will access flags in the colony carrier instead.)`. Note **where** they are: the install's own `<Stellaris>/logs/` is EMPTY (0 entries); the dump is in the user data directory and is dated 2026-10-06.
- `vanilla`: `common/ship_sizes/29_nomads_dlc_ships.txt:113-118` is the switch and the two art keys, with the comment `# Enables Arkship custom UI` on `carries_colony`. It is repeated for **nine** of the file's ten starbase-class arkship hulls - `:114`, `:235`, `:364`, `:496`, `:620`, `:751`, `:885`, `:1008`, `:1138` - and the tenth is the exception that proves the engine's predicate is `carries_colony` and not the word "arkship": `military_arkship_champions_forge` (`:1261`, `class = shipclass_starbase` at `:1269`) has **no** `carries_colony`, no `arkship_picture` and no `planet_view_header`, yet the content's own `is_arkship_ship` / `is_arkship_starbase` / `is_military_arkship` / `is_arkship_tier_3` list it (`09_scripted_triggers_nomads.txt:168,183,208,319`). The scripted trigger family and the engine's UI switch are therefore not the same set.
- `vanilla`: `common/ship_sizes/00_ship_sizes.txt:97-99` documents the field in the install's own words - `# carries_colony = <planet_class>  # default: empty. If filled, ship is able to carry a colony of that class and a colony is created by default when the ship is created (see create_ship effect for special case). Ships that are not carrying a colony when supposed to are killed on a daily basis. The ship size must also have "class = shipclass_starbase".` `:102` documents `arkship_picture`, `:107` `base_ship_size` ("used for ark ships so higher tier ark ships can be downgraded to the base version in empire creation"), `:104` `encampment_required_progress`. **`planet_view_header` is NOT documented there** - it occurs 9 times in the install, all in `29_nomads_dlc_ships.txt`.
- `vanilla`: `common/planet_classes/06_planet_classes_nomads.txt:1` is `pc_ark`, `:70` `climate = "artificial"`, `:94` `colonizable = yes`, `:95` `district_set = nomad`, `:99` `default_planet_selection = yes`, `:107` `single_build_queue = yes`, and `:6-68` ten `conditional_icon` blocks whose trigger scopes to a ship (`ship = { is_ship_size = ... }`). The install's own documentation of those keys is `common/planet_classes/00_planet_classes.txt:47-62`, including `# scope: colony_carrier (planet or ship depending on carrier type)` and `single_build_queue = yes # ... merges all build queues from the colony and carrier into a single one. If the carrier is also a starbase, this includes build queues in the starbase as well`.
- `vanilla`: the arkship is a colony **and** a starbase. `common/megastructures/29_nomad_arkships.txt:1` + `common/inline_scripts/megastructures/arkship.txt:48-54`: the megastructure is only the construction site - its `on_build_complete` runs `create_arkship_effect` and then `remove_megastructure`. The hull's parts come from `common/starbase_types/06_arkship_starbase_types.txt`, `common/starbase_modules/00_arkship_*.txt`, `common/starbase_buildings/00_arkship_*.txt`, `common/starbase_levels/06_arkship_levels.txt`. The scripted triggers confirm both halves: `09_scripted_triggers_nomads.txt:172` `is_arkship_starbase` is `has_starbase_size = civilian_arkship_tier_1` (a STARBASE size) while `:291` `is_capital_arkship_starbase` is `is_arkship_starbase = yes` plus `colony? = { is_capital = yes }` (a COLONY on it).
- `vanilla`: the panel is one window and a lot of it. Measured on `<Stellaris>/interface/planet_view.gui`: 8483 lines, **276** `containerWindowType` blocks, **50** of them top level, 1005 `name = "..."` declarations; the `planet_view` window spans lines **222-4699**; **37** declarations have a name beginning with `arkship`; `arkship_elements` spans **604-1051** (448 lines) and holds **53** named elements; the file contains **0** `visible =`, **0** `trigger =` and **0** `enabled =` fields, and **0** occurrences of `pc_ark` (the same measurement `control-visibility-is-a-potential` makes about the mod's own file).
- `vanilla`: there is no dedicated file. `interface/` holds 169 `.gui` files and **none** of them has `ark` in its name; the arkship appears in five others - `colonize_planet_view.gui:308-381` (the embark picker: `expansion_source_arkship_fleet_entry`, `arkship_render_target`, `arkship_container`), `outliner.gui:413,2189,2413,2534,3298`, `fleet_view.gui:513` (the `go_to_planet_view` button carrying `GFX_button_open_arkship`), `new_game_setup.gui:467`, `customize_species_editors.gui:2601`. `starbase_view.gui` has **no** arkship element, although the arkship is a starbase.
- `vanilla`: the arkship mode is selected by NAME, and the two candidates for one slot are both declared. `planet_view.gui:3525` `arkship_tab` and `:3552` `armies_tab` carry the SAME `position = { x = 381 y = @tab_height }` and the SAME `shortcut = "v"` with different `buttonText` (`ARKSHIP_CONTROLS` / `GROUND_COMBAT_TAB`); `:314` `planet_top_bar` and `:325` `arkship_planet_top_bar` both sit at `{ x = -14 y = -47 }` with different sprites; `:326`/`:330` reuse the name `arkship_planet_top_bar` for a container and its background.
- `vanilla`, the counter-example that a reader will otherwise chase: `planet_view.gui:2580-2584` declares a container named `arkship_window` that is **empty** - `size = { width = 500 height = 400 }`, `position = { x = 0 y = 200 }`, no children. It is a stub, not the panel.
- `measured`, the cold start: `gui_layout_validate` over the SHIPPED `interface/planet_view.gui` returns `verdict: fail`, **350** findings (32 error / 279 warning / 39 info), `sibling-overlap` **145**, `text-collision` **46**, `size-indeterminate` 33, `zero-size` 3. Four of the `text-collision` findings are `X_tab` vs `X_tab_active` (`summary_tab`, `population_tab`, `armies_tab`, `corporate_tab`) - the same button in two states, which the engine draws one at a time - and four `sibling-overlap` findings name `arkship_tab(_active)` vs `corporate_tab(_active)`; `arkship_elements` itself is reported `size-indeterminate` and `arkship_buildings_grid` / `arkship_lower_buildings_grid` `zero-size`, because the block declares no size and those grids are populated by the engine.
- `measured`: the plugin has no model of any of this - `arkship` occurs **0** times under `RStellarisGui/src/`.
- `measured`, an independent mod on this machine reached the same conclusion from the other side and wrote it down: `<mods>/aerospace_carrier/common/ship_sizes/zz_aerospace_carrier_ship_sizes.txt:7-17` - "An earlier version copied the vanilla arkship (`class = shipclass_starbase` + `carries_colony` + starbase module/building capacity), and that combination produces an *arkship*: a mobile colony that exists on its own and CANNOT be added to a fleet. ... `carries_colony` is the field that causes it: it turns the hull into a mobile colony and hands it the hardcoded arkship UI." The same mod redefines the scripted trigger `is_arkship_ship` to add its own hull (`zz_aerospace_carrier_triggers.txt:128`), which the preserved `error.log` records once: `[00:54:23][game_singleobjectdatabase.h:170]: Object with key: is_arkship_ship already exists, using the one at file: common/scripted_triggers/zz_aerospace_carrier_triggers.txt line: 128`.

## Rules

- The ark ship panel is `interface/planet_view.gui`'s `planet_view` window. Do not look for an arkship window: `arkship_window` (:2580) is an empty stub, and `CArkshipView` does not exist in the binary.
- The switch is **data**, and it is two keys on one ship size: `class = shipclass_starbase` and `carries_colony = <planet_class>`. Vanilla's comment on them is the whole recipe: `# Enables Arkship custom UI`.
- You cannot invent an element name for that panel. The engine resolves a fixed table by name (`window-name-contract`); a mod's own `my_ark_hull_box` is never populated and never toggled. Only the override route (`host-gui-surface`) puts anything new on this screen.
- You cannot express the variant switch in the `.gui` either. There is no `visible`/`trigger` field in 4.4.6 (GAP-15), the file has 0 of them, and the choice is made in the view class from the carrier type.
- Keep the arkship declarations when you override `planet_view.gui`. The project's own override is a full-file fork and it keeps all of them (8502 lines vs 8483, 56 `arkship` line mentions on both sides); a fork taken from a pre-4.4.6 base silently removes the whole arkship panel's element set.
- An arkship is BOTH a starbase and a colony, and the script that reads it must say which. `is_arkship_starbase` is `has_starbase_size`, `is_capital_arkship_starbase` is that plus `colony? = { is_capital = yes }`; modules and buildings are the STARBASE half (`has_starbase_module`), pops, districts and zones are the COLONY half (`colony = { has_zone = ... }`).
- In colony scope, flags and variables now address the CARRIER: use `has_carrier_flag` / `set_carrier_flag` / `set_timed_carrier_flag` / `remove_carrier_flag`, or `carrier = { ... }` to address the object explicitly. The `has_planet_flag` family still exists and answers in planet scope, so on an arkship the two are different objects.
- Detect an arkship by the carrier relation, not by the planet class: `carrier_is_type = ship`, or vanilla's scripted triggers `is_arkship_ship` / `is_arkship_starbase` / `is_civilian_arkship` / `is_science_arkship` / `is_military_arkship` (`09_scripted_triggers_nomads.txt:147-321`). `pc_ark` is a content-side fact the engine never looks at by name.
- `conditional_icon` on a planet class is the one content-side hook that varies art by carrier, and its trigger runs in the CARRIER's scope - so `ship = { is_ship_size = ... }` is legal there and meaningless elsewhere.
- `common/arkships` is **not read at all, and that is a measured rule** - not a "treat as unusable"
  caution. A probe mod shipped **7** files there in **6 shapes** (a keyed block, a bare token list, a
  named block using only plausible field names, a scalar list, a clean file, and one with a MISSING
  closing brace) each carrying at least one impossible token, and the engine wrote **0** lines about
  any of them in `error.log`, `setup.log`, `debug.log` or `system.log`. The same mod's
  `interface/zz_gui_probe_doors_a_mountcontrol.gui` was named in the SAME run
  (`Unexpected token: probeZZmount_control_token, near line: 9 ... in file:
  "interface/zz_gui_probe_doors_a_mountcontrol.gui" near line: 9`), so "the mod was not mounted" is
  excluded. See Evidence for the full citation and for why the engine's content-directory list does
  not contradict this.

## Breaks

- Editing `arkship_window` (`planet_view.gui:2580-2584`) because it is the only container named like a panel. It is a 500x400 EMPTY container with no children; the panel's content is `arkship_elements` (:604-1051) and the ~37 `ark*` declarations scattered through the window.
- Reporting `arkship_elements`' declared geometry as the panel's geometry. The container declares **no size**, its `arkship_buildings_grid` / `arkship_lower_buildings_grid` resolve to 0x0 in the plugin's model, and the module/spinal grids are engine-populated - the numbers come from the starbase's module slots, not from the `.gui`.
- Assuming a missing planet-view name crashes the game the way the event-window contract does (`window-name-contract`). No measurement supports that here: the planet view's names are resolved by a view class, not by the crashing event-window path, and the preserved `error.log` (`%USERPROFILE%/Documents/Paradox Interactive/Stellaris/logs/error.log`, 2026-10-06) contains **no** window-lookup line naming `planet_view`: of its 75 `Could not find` lines, 58 are missing sound files (`pdx_audio_util.cpp`), 6 are `effect_impl.cpp`, 1 is `guigraphics.cpp` and 10 are `containerwindow.h` lines that all name `ok_popup_window` - the project's own GAP-17 probe. What an absent planet-view name does is **not established**.
- Treating the arkship UI as reachable by naming: `carries_colony` gives you vanilla's hardcoded UI and nothing else. The aerospace carrier mod measured exactly that and backed the hull out of `shipclass_starbase` to get out of it (`zz_aerospace_carrier_ship_sizes.txt:7-17`).
- Counting `arkship` occurrences as a proxy for "how much of the panel is arkship-specific". 56 lines mention the string; **37** are `name = "ark*"` element declarations and the rest are sprite/text values inside them.

## 待确认

- **Whether the switch requires `pc_ark` specifically, or any `carries_colony` planet class.** The binary never mentions `pc_ark` and the doc comment (`# Enables Arkship custom UI`) sits on the vanilla pairing, so the reading above is "the carrier relation decides"; but a mod-only experiment (a hull with `carries_colony = pc_tundra`) is the only thing that would settle it, and this round was read-only and launched no game. The aerospace carrier mod's earlier version had a starbase/`carries_colony` hull and reports the arkship UI - one data point for "any", not proof.
- **Whether a mod's own `pc_ark`-like planet class can be given the arkship mode at all**, which is the same question from the content side.
- **Which of the same-slot tab buttons the engine hides.** `arkship_tab` and `armies_tab` occupy one slot (`x = 381`, `shortcut = "v"`) and both names are in the binary, so at most one is drawn per object; which one, and whether the arkship shows its own tab INSTEAD of ground combat or alongside it, was not observable without launching the game.
- **What the engine does when a planet-view name is absent.** For the event window a missing demanded name is a null dereference (`window-name-contract`, GAP-17); the planet view may only log `Could not find ... in window`. No log on this machine records either case, and no session log here records the planet view being opened on an ark ship at all - the preserved `error.log`'s single `arkship` line is a scripted-trigger override by another mod, not a lookup.
- **What `common/arkships` was FOR.** This round settled the part a mod can act on - **this build does not read it** (probe, §Evidence) - and settled that the engine's content-directory table is not a list of directories the engine reads (`common/specimens` is missing from it and demonstrably loads). What remains open is only its provenance: whether it is a removed type, an unreleased one, or a path for a DLC that is not installed here. **Nothing a mod can write into it has any effect, so the open question does not gate any decision.** The report also notes the one clean follow-up that was not run: a "positive directory control" (a probe directory the engine DOES read, e.g. `common/armies`, which is adjacent in the same table and exists in the install) to test the directory-name route at the directory level rather than through `interface/`.
- **Whether `planet_view_header` is a supported public key.** It is engine-enforced (the exe has a dedicated error string for it) but undocumented in `00_ship_sizes.txt`, and its 9 uses are all vanilla arkship hulls - so a mod using it is relying on an unstated contract.
- **Whether the arkship's `planet_view` is reachable from script.** No effect that opens a view was found (`script-routes-to-a-window`), and the only button that leads there is a hardcoded element name (`go_to_planet_view` in `fleet_view.gui:513`), so the routes in are the engine's own: select the fleet, or the colony.
