---
id: asteroids-and-asteroid-belts
category: script
title: An asteroid is a PLANET object; an asteroid belt is scenery - a mesh list in common/asteroid_belts, placed by a two-field block
title_zh: 小行星是行星对象；小行星带是布景——common/asteroid_belts 里的网格列表，由一个只有两个字段的块放置
summary: A single asteroid is an ordinary planet object with a `planet_class` that says `asteroid = yes` - it has deposits, can carry a mining or research station, can be surveyed, targeted by anomalies, destroyed by `remove_planet` and spawned by `spawn_planet`. An asteroid BELT is not a set of those: it is a scenery declaration. `asteroid_belt = { type = <key> radius = <n> }` names a block in `common/asteroid_belts/**` that carries only `mesh`/`shader`/`width`/`density`, and the renderer draws the rocks. Measured over all 360 vanilla system initializers: 134 carry BOTH a belt and asteroid planets, 32 carry a belt and NO asteroid planet at all, 17 carry asteroid planets and no belt - the two are independent. There are SIX `asteroid = yes` classes in the install and every one of them is `colonizable = no`; the belt block has room for a type and a radius and nothing else, so no mod can define an individual belt member.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.txt]
tags: [asteroid, asteroid_belt, asteroid_belts, planet_classes, solar_system_initializers, pc_asteroid, is_asteroid, has_asteroid_belt, num_asteroid_belts, add_asteroid_belt, set_asteroid_belt, random_asteroid, mesh, density, census, mod-recipe, measured-negative]
related: [ring-worlds-habitats-and-what-is-colonizable, engine-capability-vs-usage]
sources: [<Stellaris>/common/planet_classes/00_planet_classes.txt, <Stellaris>/common/planet_classes/00_planet_classes_leviathans.txt, <Stellaris>/common/planet_classes/04_planet_classes_grand_archive.txt, <Stellaris>/common/planet_classes/05_planet_classes_strange_worlds.txt, <Stellaris>/common/asteroid_belts/00_asteroid_belts.txt, <Stellaris>/common/solar_system_initializers/example.txt, <Stellaris>/common/solar_system_initializers/sol_initializers.txt, <Stellaris>/common/solar_system_initializers/pre_ftl_initializers.txt, <Stellaris>/common/solar_system_initializers/overlord_initializers.txt, <Stellaris>/common/defines/00_defines.txt, <Stellaris>/common/megastructures/habitats.txt, <Stellaris>/common/megastructures/00_ring_world.txt, <Stellaris>/common/deposits/01_orbital_deposits.txt, <Stellaris>/common/deposits/02_sr_deposits.txt, <Stellaris>/common/scripted_actions/03_arkships.txt, <Stellaris>/common/scripted_effects/01_start_of_game_effects.txt, <Stellaris>/common/scripted_effects/00_scripted_effects.txt, <Stellaris>/events/infernals_1_events.txt, <Stellaris>/events/cosmic_storms_events_1.txt, <Stellaris>/events/grand_archive_events.txt, <mods>/geocentric_origin, <mods>/system_size_probe, "%USERPROFILE%/Documents/Paradox Interactive/Stellaris/logs/script_documentation"]
---

## The verdict in one paragraph

**小行星是天体（行星对象）；小行星带是布景。** A single asteroid is an ordinary **planet** object whose
`planet_class` carries `asteroid = yes` (`pc_asteroid` and five relatives). It has a deposit, it can
carry a mining or research station, it is surveyed, it can be targeted by an anomaly, it is spawned
by `spawn_planet = { class = pc_asteroid ... }` and destroyed by `remove_planet = yes` - every
mechanism that works on a barren planet works on it, because it IS one.

An **asteroid belt** is not a set of those. It is a **scenery declaration**: the block
`asteroid_belt = { type = <key> radius = <n> }`, where `<key>` names a block in
`common/asteroid_belts/**` whose entire content is a list of `mesh` names (plus optional `shader`,
`width`, `density`). The renderer scatters those meshes along a ring at that radius. It places no
planets, has no member list, no class, no count and no spacing, and it is not saved as objects - the
engine's own triggers say so by asking the SYSTEM: `has_asteroid_belt` and `num_asteroid_belts` are
`galactic_object` triggers, while `is_asteroid` is a `planet ship` trigger.

Measured over the install's **360** system initializers: **134** carry both a belt and one or more
asteroid planets, **32** carry a belt and **no** asteroid planet at all, and **17** carry asteroid
planets and no belt. The two are independent, and vanilla's own Grand Archive event proves the
engine treats them as different things - it looks for a system with `has_asteroid_belt = yes`
**and** `any_system_planet = { is_planet_class = pc_asteroid }`, then spawns a cutholoid on one of
those planets.

## Syntax

```
# ---------------------------------------------------------------------------------------
# 1. WHAT A SINGLE ASTEROID IS: a PLANET CLASS, exactly like a barren planet.
#    common/planet_classes/00_planet_classes.txt:495
# ---------------------------------------------------------------------------------------
pc_asteroid = {                                # :495
	entity = "asteroid"                        # :496  the 3D asset
	entity_scale = 1.5                         # :497
	icon = GFX_planet_type_asteroid            # :498
	icon_large = GFX_planet_type_asteroid_big  # :499

	asteroid = yes                             # :501  <-- what `is_asteroid` reads

	spawn_odds = 10                            # :503  random draw weight
	extra_orbit_size = 0                       # :505
	extra_planet_count = 0                     # :506
	chance_of_ring = 0                         # :508
	planet_size = 5                            # :510  a fixed size, not a { min max } range
	colonizable = no                           # :512  NO asteroid class in the install says yes
	survey_time_factor = 0.5                   # :513  asteroids survey TWICE as fast
}
# pc_ice_asteroid           00_planet_classes.txt:516   entity = "asteroid_ice_large",  spawn_odds = 10
# pc_rare_crystal_asteroid  00_planet_classes.txt:537   entity = "asteroid_crystal_large", spawn_odds = 10
# pc_crystal_asteroid       00_planet_classes_leviathans.txt:37  entity = "hive_asteroid_planet" (the Hive asteroid), spawn_odds = 0
# pc_cutholoid              04_planet_classes_grand_archive.txt:1 entity = "asteroid", spawn_odds = 0
# pc_junk                   05_planet_classes_strange_worlds.txt:1 entity = "asteroid", spawn_odds = 0
# ...and that is ALL SIX. Every one carries `asteroid = yes`, `planet_size = 5`,
# `chance_of_ring = 0`, `survey_time_factor = 0.5` and `colonizable = no`.

# THE NON-COLONIZABILITY IS A FIELD, NOT AN ABSENCE. Measured over the install's planet-class
# files: 69 class blocks (plus 9 `random_list` definition blocks beside them), 24 `colonizable = yes`,
# 45 `colonizable = no`, and all SIX `asteroid = yes` classes are among the 45.
# `pc_asteroid` is in the install's own random list of planet classes:
#   random_list = { name = "rl_all_planets"  planets = { ... "pc_asteroid" ... } }   # :1820-1832
# ...and so is `pc_asteroid` in "rl_all_normal_planets" (00_planet_classes_distant_stars.txt:87-99).

# ---------------------------------------------------------------------------------------
# 2. WHAT A BELT IS: TWO FIELDS, ONE OF WHICH NAMES A MESH LIST.
#    common/solar_system_initializers/example.txt:15-18 - the install's own documentation
# ---------------------------------------------------------------------------------------
example_initializer = {                        # example.txt:12
	class = "rl_standard_stars"
	asteroid_belt = {                          # :15
		type = rocky_asteroid_belt             # :16
		radius = 60		# Distance from the solar system's center   # :17
	}
	...
}

# THE FULL FIELD VOCABULARY OF THE BLOCK. Census over every `common/solar_system_initializers/**`
# file: 241 `asteroid_belt` blocks, and they use exactly TWO keys between them -
#   type    241 / 241   a key in common/asteroid_belts/**  (never absent in vanilla)
#   radius  239 / 241   an absolute distance from the system centre; 2 blocks omit it
# There is NO member list, NO planet class, NO count, NO spacing, NO randomness and NO per-member
# field. `radius` takes the ordinary numeric forms, including a range:
#   asteroid_belt = { type = rocky_asteroid_belt  radius = { min = 35 max = 55 } }  # overlord_initializers.txt:3287-3290

# THE TYPE IS A MESH LIST AND NOTHING ELSE. common/asteroid_belts/00_asteroid_belts.txt - the
# whole directory is this ONE file, and it defines SIX types:
rocky_asteroid_belt = {                        # :4    the FIRST block, and therefore the default
	mesh="asteroid_01_mesh"                    # :5-11  seven `mesh =` lines, one per rock variant
	...
}                                              #      no density, no width -> the documented default 1
icy_asteroid_belt = {                          # :14   four meshes
	mesh="asteroid_ice_small_01_mesh"
	...
	shader = "AsteroidEmissive"                # :20
}
crystal_asteroid_belt = { ... }                # :23   three meshes
debris_asteroid_belt = {                       # :29   ten meshes, incl. cargo containers and a billboard
	...
	width = 1.3                                # :40
	density = 0.8                              # :41
}
empty_asteroid_belt = {  mesh="asteroid_shatter_mesh"  width = 2  density = 0.3 }   # :44-48
space_fauna_belt = {                           # :50  41 meshes: whales, amoebas, a voidworm, a Prethoryn
	...
	width = 5                                  # :93
	density = 0.2                              # :94
}
# The header comment states the vocabulary and the defaults IN THE INSTALL'S OWN WORDS:
#   "Asteroid Belts support having variable density and width values, if none are declared the
#    default is 1."                                              # 00_asteroid_belts.txt:3
# ...and the first line of the file states the other default:
#   "#first one is considered as default for save game compatability"     # :1

# Field census of the six type blocks: `mesh` 6/6 (66 mesh lines in total), `density` 3/6,
# `width` 3/6, `shader` 1/6. Those four keys are the entire schema.

# ---------------------------------------------------------------------------------------
# 3. THE BELT IS DRAWN, NOT SIMULATED. common/defines/00_defines.txt:128-134 - the engine's own
#    constants for it are all geometry, and they name the plane it is drawn in.
# ---------------------------------------------------------------------------------------
		ASTEROID_PLANE						= -100.0
		ASTEROID_POSITION_OFFSET			= 8.0
		ASTEROID_HEIGHT_OFFSET				= 4.0
		ASTEROID_DIST_POW					= 3
		ASTEROID_AMOUNT_RADIUS_SCALER		= 0.1
		ASTEROID_MAX_SCALE					= 4.0
		ASTEROID_ROTATION_SPEED				= 0.3035

# ---------------------------------------------------------------------------------------
# 4. HOW A MOD PUTS AN ASTEROID WHERE IT WANTS ONE: `spawn_planet` with an asteroid class.
#    events/infernals_1_events.txt:931-940 - the Red Giant origin's asteroid field (25 calls)
# ---------------------------------------------------------------------------------------
				spawn_planet = {
					class = pc_asteroid                    # :932
					location = target                      # :933  the planet to orbit
					orbit_distance_offset = 63             # :934
					orbit_angle_offset = 30                # :935
					init_effect = {
						add_deposit = d_minerals_3         # :937  an asteroid CAN carry a deposit
						set_name = red_giant_asteroid      # :938
					}
				}
# ...25 times in that one file, with orbit_distance_offset/angle and a deposit each.
# A second, minimal shape (events/cosmic_storms_events_1.txt:178):
#   spawn_planet = { generate_random_name = yes class = pc_ice_asteroid
#                    orbit_distance = { min = 90 max = 210 } orbit_angle = { min = 0 max = 360 }
#                    flags = { asteroid_triplet } }

# ...AND THE SAME OBJECT IS DESTROYED BY THE SAME EFFECT EVERY OTHER PLANET USES:
#   every_system_planet = { limit = { is_asteroid = yes }  remove_planet = yes }
#   common/scripted_effects/01_start_of_game_effects.txt:2511-2516
# and the Ring World megastructure wipes the belt by zeroing its radius (megastructures/00_ring_world.txt:188):
#   set_asteroid_belt = { radius = 0 }

# ---------------------------------------------------------------------------------------
# 5. THE ENGINE'S OWN SCRIPT DOCUMENTATION (the belt is a property OF A SYSTEM).
#    %USERPROFILE%/Documents/Paradox Interactive/Stellaris/logs/script_documentation/...
# ---------------------------------------------------------------------------------------
# effects.log:1975-1980   add_asteroid_belt - Adds an asteroid belt at the distance in the scope.
#                         add_asteroid_belt = { radius=<desired radius>  type=<asteroid belt type key> }
#                         Supported Scopes: galactic_object
# effects.log:1982-1987   set_asteroid_belt - Sets an asteroid belt at the distance in the scope.
#                         set_asteroid_belt = { radius=<desired radius>  type=<asteroid belt type key> }
#                         Supported Scopes: galactic_object
# triggers.log:3281-3283  has_asteroid_belt - Returns true if the scoped galactic object has an asteroid belt.
# triggers.log:3304-3306  num_asteroid_belts - Checks the system's number of asteroid belts
# triggers.log:560-562    is_asteroid - Checks if the planet is an asteroid      Supported Scopes: planet ship
# `galactic_object` is the SYSTEM scope, which is why the same effect takes a `radius` there and not
# a planet: it is a property of the system's scenery, not of a body.
```

## Evidence

- `vanilla`, the asteroid class, quoted in full: `common/planet_classes/00_planet_classes.txt:495-514` `pc_asteroid` - `entity = "asteroid"` (`:496`), `asteroid = yes` (`:501`), `spawn_odds = 10` (`:503`), `planet_size = 5` (`:510`, a SCALAR, not a range), `colonizable = no` (`:512`), `survey_time_factor = 0.5` (`:513`). The five relatives are `pc_ice_asteroid` (`:516`, `entity = "asteroid_ice_large"`, `spawn_odds = 10`), `pc_rare_crystal_asteroid` (`:537`, `entity = "asteroid_crystal_large"`, `picture = pc_crystal_asteroid`, `spawn_odds = 10`), `pc_crystal_asteroid` (`common/planet_classes/00_planet_classes_leviathans.txt:37`, `entity = "hive_asteroid_planet"`, `spawn_odds = 0`), `pc_cutholoid` (`common/planet_classes/04_planet_classes_grand_archive.txt:1`, `spawn_odds = 0`) and `pc_junk` (`common/planet_classes/05_planet_classes_strange_worlds.txt:1`, `spawn_odds = 0`, `entity_scale = 1`). **Every one of the six carries the same eleven-key shape**, differing in `entity`, `spawn_odds` and (for the crystal asteroid) `picture`. None carries `district_set`, `starting_district`, `star_gfx`, `habitat` or `ringworld`.
- `measured`, the class census, and it is what makes "an asteroid is not colonisable" a fact rather than an impression: over the install's `common/planet_classes/**` (12 files) there are **69 class blocks** and **9 `random_list` blocks**; the classes split **24 `colonizable = yes` / 45 `colonizable = no` / 0 without the key**; **6 class blocks carry `asteroid = yes`** and all 6 are in the 45. `pc_asteroid` is itself listed in the install's own random class lists - `common/planet_classes/00_planet_classes.txt:1820-1847` `random_list = { name = "rl_all_planets" planets = { ... "pc_asteroid" ... } }` (`:1832`) and `common/planet_classes/00_planet_classes_distant_stars.txt:87-107` `rl_all_normal_planets` (`:99`). A flag census over those 69 classes finds 59 distinct field names, `asteroid` among them with exactly 6 uses.
- `vanilla`, the belt block, from the install's own example file: `common/solar_system_initializers/example.txt:15-18` - `asteroid_belt = { type = rocky_asteroid_belt radius = 60 }` with the comment `# Distance from the solar system's center` (`:17`) - under a header that names belts as one of the three things an initializer decides: *"It will set up everything based on the scripted info (i.e. names/asteroid belts/scripted planets) which will then run their individual 'init_effect' scripts"* (`:10`). The real Sol system writes two of them: `sol_initializers.txt:11-14` `type = rocky_asteroid_belt radius = 145` and `:15-18` `type = icy_asteroid_belt radius = 290` - both ABSOLUTE radii, computed from the system centre and NOT part of the planet orbit chain of `orbit_distance` values that follows (`:44` onwards).
- `measured`, the belt-block census - the field vocabulary is exactly two keys, over every vanilla use: a brace-depth pass over all 40 `common/solar_system_initializers/**` files finds **241 `asteroid_belt` blocks** (all 241 name a `type`; 239 name a `radius`; the ONLY distinct fields in any of them are `type` and `radius`, and both `type = { ... }` and `radius = { ... }` forms occur - `radius = { min = 35 max = 55 }` at `overlord_initializers.txt:3289`, `radius = { min = 65 max = 85 }` at `:3294`). Per file the counts run from 1 (`example.txt:15`, `grand_archive_initializers.txt`, `mindwarden_initializers.txt`, `aquatics_initializers.txt`) to 23 (`overlord_initializers.txt`). **The block has no room to describe a member**: there is no `class`, `count`, `spacing`, `distance`, `random` or nested element inside one, in any of the 241.
- `measured`, the belt TYPE census - `common/asteroid_belts/` contains exactly ONE file, `00_asteroid_belts.txt`, and it defines **six** types with **four** distinct keys between them: `mesh` in 6/6 (7, 4, 3, 10, 1 and 41 lines respectively - **66 mesh lines total**), `density` in 3/6, `width` in 3/6, `shader` in 1/6 (`icy_asteroid_belt`, `shader = "AsteroidEmissive"`, `:20`). The defaults are the file's own words: `:3` *"Asteroid Belts support having variable density and width values, if none are declared the default is 1."*, and `:1` *"#first one is considered as default for save game compatability"* (`rocky_asteroid_belt`, `:4`). Names are not decoration: `space_fauna_belt` (`:50`) is 41 meshes of whales, space amoebas, a voidworm, a cutholoid hatchling and one Prethoryn warship, with `width = 5` and `density = 0.2` - the type is what the belt LOOKS like, and nothing else.
- `measured`, the belt/asteroid independence - this is the measurement that settles (a) vs (c) vs (d): over the **360** top-level initializer blocks in the 38 files, **134** declare at least one `asteroid_belt` AND at least one `planet = { class = pc_*asteroid }`, **32** declare a belt and **no** asteroid planet (`fallen_empire_initializers.txt:3266` `fallen_hive_last_thought` has two belts and not one asteroid; `example.txt:12` has a belt and a `random` planet), **17** declare asteroid planets and **no** belt (`special_system_initializers.txt:3300` `the_star_mall_initializer` places six asteroids, no belt; `fallen_empire_initializers.txt:4876` three, no belt), and 177 have neither. **376** top-level `planet` entries across those files name an asteroid class (`pc_asteroid` 292, `pc_ice_asteroid` 65, `pc_crystal_asteroid` 13, `pc_rare_crystal_asteroid` 6). If a belt WERE a set of asteroid planets the 32 belt-only initializers would be impossible, and the belt-only initializer count is the honest answer to "does the belt create planets?": no.
- `vanilla`, the engine treating the two as different objects in one trigger block: `events/grand_archive_events.txt:2955-2963` picks a system with `has_owner = no`, `has_asteroid_belt = yes` **and** `any_system_planet = { is_planet_class = pc_asteroid  has_any_flag = no }` before spawning cutholoids, and weights that choice up when the system has *more than three* `pc_asteroid` planets (`:2970-2973`). The precursor storm event does the same pair: `num_asteroid_belts > 0` weights the SYSTEM (`events/precursor_events_cosmic_storms.txt:2781-2785`) while `is_asteroid = yes` weights the PLANET (`:2800-2804`). The scopes in the engine's own documentation agree: `has_asteroid_belt` / `num_asteroid_belts` / `add_asteroid_belt` / `set_asteroid_belt` are all `galactic_object`, `is_asteroid` is `planet ship` (see the Syntax section for the exact lines).
- `binary` / `log`, the distinctions the engine implements, quoted from its own script documentation: `triggers.log:560-562` `is_asteroid - Checks if the planet is an asteroid`; `triggers.log:3281-3283` `has_asteroid_belt - Returns true if the scoped galactic object has an asteroid belt.`; `triggers.log:3304-3306` `num_asteroid_belts - Checks the system's number of asteroid belts`; `effects.log:1975-1980` `add_asteroid_belt` and `:1982-1987` `set_asteroid_belt`, both documented with the two-field body `{ radius=<desired radius> type=<asteroid belt type key> }` and both scoped `galactic_object`. **`is_asteroid` is on `planet ship` and the belt triggers are on `galactic_object`: the engine's own scope list says these are different kinds of thing.**
- `binary`, the engine's belt rendering constants, and why they are the strongest single piece of evidence that a belt is drawn: `common/defines/00_defines.txt:128-134` gives `ASTEROID_PLANE = -100.0`, `ASTEROID_POSITION_OFFSET = 8.0`, `ASTEROID_HEIGHT_OFFSET = 4.0`, `ASTEROID_DIST_POW = 3`, `ASTEROID_AMOUNT_RADIUS_SCALER = 0.1`, `ASTEROID_MAX_SCALE = 4.0`, `ASTEROID_ROTATION_SPEED = 0.3035`. Every one is geometry, position or scale - there is no engine constant that gives a belt a planet class, and none that gives it a count of BODIES. `ASTEROID_AMOUNT_RADIUS_SCALER` is the renderer's rock-density knob, which is why `density` and `width` live on the TYPE and not on the placement block.
- `vanilla`, what an asteroid CAN hold and CAN be: it takes a normal orbital deposit and a mining station - `common/deposits/01_orbital_deposits.txt:47-62` weights `d_minerals_2` by `factor = 2.0` when `is_asteroid = yes` (`:59`), and the same shape repeats for `d_minerals_3` (`:95`, `factor = 3.0`) and `d_minerals_4` (`:131`, `factor = 4.0`); `common/deposits/02_sr_deposits.txt:150-157` and `:185-192` give a strategic resource a nonzero weight from `pc_ice_asteroid`. The Nomad arkship's own mining script names asteroids as valid mining targets in as many words: `common/scripted_actions/03_arkships.txt:452-455` `OR = { is_planet_class = pc_ice_asteroid  # primary energy, secondary exotic gases` / `is_planet_class = pc_asteroid  # primary minerals, secondary volatile motes` / ... }`. Anomalies target them the same way: `common/anomalies/00_anomaly_categories.txt:8-18` (`crashed_ship_asteroid_category`, `add = 3` when `is_asteroid = yes`) and `:33-43` (`origin_asteroid_category`). And a planet-killer clears orbital stations off them exactly as it does off any planet: `common/scripted_effects/00_scripted_effects.txt:4613-4627` dismantles every `orbital_station` and then `every_system_planet = { limit = { is_asteroid = yes } clear_deposits = yes }` (`:4624-4627`).
- `vanilla`, an asteroid being CREATED, DESTROYED and CHANGED - the three effect routes, each quoted: `spawn_planet = { class = pc_asteroid location = target orbit_distance_offset = 63 orbit_angle_offset = 30 init_effect = { add_deposit = d_minerals_3 set_name = red_giant_asteroid } }` at `events/infernals_1_events.txt:931-940`, **25 times in that file** (the Red Giant origin's asteroid field); `spawn_planet = { class = pc_crystal_asteroid location = from orbit_location = yes orbit_distance_offset = 10 orbit_angle_offset = 5 size = 2 ... }` at `events/anomaly_events_4.txt:3132`; `every_system_planet = { limit = { is_asteroid = yes } remove_planet = yes }` at `common/scripted_effects/01_start_of_game_effects.txt:2511-2516`; and `change_pc` converting a body INTO an asteroid (or a renamed relative) at `events/anomaly_events_4.txt:4900` (`change_pc = pc_asteroid`), `events/aquatics_events.txt:1818` and `:1836` (`change_pc = pc_ice_asteroid`), and `common/scripted_effects/grand_archive_effects.txt:382` (`change_pc = pc_cutholoid`).
- `measured`, the identifier census, over `common/` + `events/` (all `.txt`): **92** `spawn_planet` calls in **31** files, **91** `spawn_megastructure`, **46** `remove_planet`, **32** `create_colony`; of the 92 `spawn_planet` calls, **30 name an asteroid class, in FOUR files** - 25 in `events/infernals_1_events.txt`, 2 in `events/cosmic_storms_events_1.txt` (`:178`, `:189`), 2 in `events/situation_events.txt` (`:4685`, `:4799`) and 1 in `events/anomaly_events_4.txt` (`:3132`, `pc_crystal_asteroid`). That is the smallest vanilla recipe for "put an asteroid here", and it is the same effect a mod uses. Elsewhere the asteroid classes are named by **46** `class` / `change_pc` / `is_planet_class` sites outside the initializers (the largest clusters: 25 in `events/infernals_1_events.txt`, 16 across the `common/scripted_triggers/**` files, 7 across `common/scripted_effects/**`, and 16 more across `common/deposits/**`, `common/scripted_actions/**` and the rest of `events/**`). **0** vanilla `spawn_planet` calls site a belt, because a belt is not a planet.
- `vanilla`, the belt being EDITED at run time - the whole vocabulary a mod gets: `add_asteroid_belt` (documented, `effects.log:1975`) and `set_asteroid_belt` (`:1982`), of which the install uses `set_asteroid_belt` **exactly once**: `common/megastructures/00_ring_world.txt:183-192` - the ring world's second stage removes every non-star planet (`:184-187`) and then `set_asteroid_belt = { radius = 0 }` (`:188-190`), i.e. it *zeroes the radius* to get rid of the band rather than removing objects. `add_asteroid_belt` is used **zero** times in the whole install (it is engine-documented but has no vanilla caller), and `has_asteroid_belt` has **2** callers, `num_asteroid_belts` **2**.
- `measured` / `binary`, `random_asteroid` - the one documented asteroid keyword that vanilla never uses, recorded honestly rather than assumed: `common/solar_system_initializers/example.txt:79` documents `#class = random_asteroid		# Picks a random asteroid class` among the special `class` values, and the string IS present in the binary (`"random_asteroid"` at byte offset 38468120 of `stellaris.exe`, immediately beside `"rl_all_planets"`-style random-list handling and next to `"random_non_ideal"` / `"random_colonizable"` / `"random_non_colonizable"` / `"ideal_planet_class"` at 38468752 / 38468776 / 38468808 / 38446232), so the engine's initializer parser knows the token. **No file in the install writes it**: the string `random_asteroid` occurs in exactly one place, that comment.
- `measured`, what CANNOT hold an asteroid - the negative side, and it is stated by the install in its own fail text: **8** `common/megastructures/**` blocks carry `custom_tooltip = { fail_text = "requires_not_minor_planetary_body" ... }` whose body is `NOR = { is_asteroid = yes  is_moon = yes }` - `habitats.txt:173-179`, `02_spy_orb.txt:108`, `03_think_tank.txt:109`, `07_strategic_coordination_center.txt:105`, `08_mega_art_installation.txt:105`, `09_interstellar_assembly.txt:112`, `16_cosmogenesis_world.txt:124`, `20_grand_archive.txt:119`. So a habitat, an orbital ring, a spy orb, a think tank, a strategic coordination centre, a mega-art installation, a cosmogenesis world or a grand archive **cannot** be placed on an asteroid. There is no `requires_not_minor_planetary_body` scripted trigger in the install - the phrase is a localisation key, the test is the inlined `NOR`.
- `vanilla`/`measured`, the orbital ring, which is the one megastructure whose placement is a COLONY and not a body: `common/megastructures/15_orbital_ring.txt:58-124` requires `is_colony = yes` with a matching `controller`. Since no asteroid class is colonisable and an asteroid can never BE a colony, an orbital ring is excluded from asteroids a second time over, by a different test. Measured: `15_orbital_ring.txt` contains **0** occurrences of `is_asteroid`.
- `sibling`, the project's own mods, which had already measured half of this and are the reason the topic exists: `<mods>/system_size_probe/common/solar_system_initializers/zz_size_probe3_initializers.txt:14-17` - *"Asteroid belts contribute NOTHING. probe2_r0400_b800 (chain 400, rocky belt at 800) and probe2_r0100_b500 (chain 100, icy belt at 500) both passed, so belts are neither added to nor max()-merged with the chain. They are pure decoration for this check. **THAT QUESTION IS CLOSED.**"* - and `<mods>/geocentric_origin/common/solar_system_initializers/zz_geocentric_initializers.txt:49-51` states the same law independently: *"Asteroid belts are pure decoration and do NOT count (a 469 chain with a belt at 2000 passes), and neither star nor planet sizes count."* The geocentric mod pairs a real top-level asteroid PLANET with its belts (`:170-185` belts at 200/480; `:623-627` `class = "pc_asteroid"` at `@geo_of_outer_asteroid = 700`), which is the same independent pairing the vanilla census found.
- `sibling`, this project's own analyser, which is where the two rules below live: `src/lib/colonization.mjs` `readAsteroidBelts` / `readAsteroidBeltTypes` / `analyseAsteroidBelts`, and `src/lib/colonization.mjs`'s `readPlanetClasses` now reporting an `asteroid` flag per class. Measured through it: the install's 241 belts all resolve against its six types (**0 findings**), and the install's six asteroid classes are all `colonizable = false` (**0 findings**) - a rule that fired on real content would be a false positive on the engine's own game.

## Rules

- **A single asteroid is a PLANET object with a planet class, not a special scenery entity.** `pc_asteroid` is a `common/planet_classes/**` block (`00_planet_classes.txt:495-514`) with `asteroid = yes`, `planet_size = 5` and `colonizable = no`. Everything that works on a barren planet works on it: `add_deposit`, a mining station, `spawn_planet`, `remove_planet`, `change_pc`, anomalies, `is_planet_class`, `has_deposit_for`, planet-killer cleanup. Use the ordinary planet APIs; there is no asteroid-specific one.
- **Six `asteroid = yes` classes exist and every one is `colonizable = no`.** `pc_asteroid`, `pc_ice_asteroid`, `pc_rare_crystal_asteroid` (`common/planet_classes/00_planet_classes.txt:495`, `:516`, `:537`), `pc_crystal_asteroid` (`00_planet_classes_leviathans.txt:37`), `pc_cutholoid` (`04_planet_classes_grand_archive.txt:1`), `pc_junk` (`05_planet_classes_strange_worlds.txt:1`). Measured over the install: 69 class blocks, 24 colonisable, 45 not, and the six asteroid classes are all in the 45. `survey_time_factor = 0.5` on all six is the asteroid *feature*: half survey time.
- **An asteroid belt is SCENERY, declared in the system initializer, and it places no planets.** `asteroid_belt = { type = <key> radius = <n> }` (`common/solar_system_initializers/example.txt:15-18`). The `type` names a `common/asteroid_belts/**` block whose whole content is a `mesh` list; the engine draws those meshes along a ring at `radius`. A mod that wants a belt draws a belt; a mod that wants asteroids the player can mine places `planet = { class = pc_asteroid }` or calls `spawn_planet`.
- **The belt block has exactly TWO fields in all 241 vanilla uses: `type` and `radius`.** No member list, no class, no count, no spacing, no randomness, no nested element. You cannot define an individual member of a belt, and you cannot make a belt's rocks into planets; `radius` is absolute (from the system centre) and is NOT part of the orbit chain (`sol_initializers.txt:11-18` against the `orbit_distance` chain at `:44` onwards). The mod `system_size_probe` and the mod `geocentric_origin` both measured that the radius does not count toward the system size cap either.
- **The belt TYPE is the composition and the density knob.** `mesh` (repeated, one per rock variant), `shader`, `width`, `density` - that is the entire schema, documented in the file's own header comment (`00_asteroid_belts.txt:3`). To change a belt's composition or density, define a NEW type (or edit an existing one) and name it from the placement block. `width` and `density` default to 1; the FIRST type in the first file is the default.
- **The belt is a property of the SYSTEM and the asteroid is a property of a PLANET, and the engine says so in scopes.** `has_asteroid_belt` / `num_asteroid_belts` / `add_asteroid_belt` / `set_asteroid_belt` are `galactic_object`; `is_asteroid` is `planet ship`. Vanilla's own events use both in one condition when it means both (`grand_archive_events.txt:2955-2963`). Reaching for `has_asteroid_belt` to answer "are there asteroids here?" is a category error - it answers "is there a BAND here?".
- **An asteroid cannot be colonised, cannot be terraformed into something habitable, and cannot carry a planet-slot megastructure.** The colonisable flag is absent (no asteroid class says `colonizable = yes`) and eight megastructures refuse it by name via `fail_text = "requires_not_minor_planetary_body"` = `NOR = { is_asteroid = yes  is_moon = yes }`; the orbital ring is excluded twice over because it needs `is_colony = yes`. A habitat on an asteroid is not a design the engine will accept - it is not a design it has.
- **How a mod CAN get a colonisable rock, if that is the goal:** define a planet class with `colonizable = yes`, `district_set = <your tag>` and **WITHOUT** `asteroid = yes`, and place or spawn it where you want (`spawn_planet`, an initializer `planet` entry, or a star class' `planet = { key = ... }` - see `ring-worlds-habitats-and-what-is-colonizable`). That is exactly what this machine's two mods do. Keeping `asteroid = yes` on it as well gets the engine to offer the colonise order while every minor-planetary-body megastructure rule still refuses the body: `planet-asteroid-colonizable` reports that combination rather than silently accepting it.
- **`add_asteroid_belt` and `set_asteroid_belt` are the only run-time belt knobs, and vanilla only ever zeroes the radius.** `set_asteroid_belt = { radius = 0 }` (`megastructures/00_ring_world.txt:188-190`) removes the band. `add_asteroid_belt` is documented by the engine and used by no vanilla file, so "it works" rests on the engine's own documentation and on the two effects sharing a body and a scope.
- **A `mesh` that does not exist is a silent failure.** The belt schema has no class to resolve and no error surface this project could find in the logs - the band either draws or does not. That asymmetry, plus the fact that a `type =` is a plain reference, is why `asteroid-belt-type-undefined` is a rule and why the reference is checked against `common/asteroid_belts/**` rather than assumed.

## Breaks

- **Reading a belt as "a group of asteroid planets placed along an orbit".** It is the single most natural misreading of the game and the census refutes it directly: 32 vanilla initializers declare a belt and place no asteroid planet at all, 17 place asteroid planets and declare no belt, and `ASTEROID_AMOUNT_RADIUS_SCALER` / `ASTEROID_MAX_SCALE` / `ASTEROID_ROTATION_SPEED` (`common/defines/00_defines.txt:132-134`) are renderer constants with no planet class anywhere near them.
- **Expecting a belt to be described by its members or to have a per-member field.** 241 blocks, two keys. There is no `class =`, `count =`, `spacing =`, `distance =` or nested element in any of them, and no vanilla file has ever needed one.
- **Using `has_asteroid_belt` as "has asteroids".** It answers "is there a band at some radius", which is a different question from "is there a `pc_asteroid` body here". Vanilla's cutholoid spawn asks BOTH (`events/grand_archive_events.txt:2955-2963`); ask only the first and your event will pick systems whose belt is pure scenery, and ask only the second and it will pick systems with no band.
- **Treating the belt `radius` as part of the orbit chain.** It is an absolute distance from the system centre and no vanilla initializer adds it to the running `orbit_distance` total; both of this machine's mods measured that it does not count toward the system's outer-radius limit either. Insert it into the chain and every body after it moves.
- **Giving `pc_asteroid` (or a copy of it) `colonizable = yes` and expecting a normal colony.** The engine will offer the colonise order, but `asteroid = yes` is the flag eight megastructure placement rules read as "minor planetary body", so the colony can never carry a habitat, an orbital ring, a spy orb, a think tank, a coordination centre, a mega-art installation, a cosmogenesis world or a grand archive. If the goal is a colonisable rock, drop `asteroid = yes`; the rule `planet-asteroid-colonizable` exists to say this out loud.
- **Assuming a custom belt type needs more than a `mesh` list.** `space_fauna_belt` (`00_asteroid_belts.txt:50-95`) is a belt of whales and amoebas with `width = 5` and `density = 0.2` - six keys' worth of difference from the first block, and no engine definition anywhere. A new type is a new block in `common/asteroid_belts/`.
- **Assuming a missing `type` is an error.** It is not: the file's first line makes the FIRST block the default for save compatibility (`00_asteroid_belts.txt:1`). The analyser stays silent on a typeless belt for that reason, and only the *reference* is checked.
- **Trusting `class = random_asteroid` because the install's own example documents it.** The token IS in the binary, but no file in the install uses it and this round did not run the game, so what it draws was not observed. `planet = { class = random }` and an explicit class are both used and both visibly work.

## 待确认

- **What `random_asteroid` actually draws.** The string is in `stellaris.exe` (offset 38468120, beside `ideal_planet_class` / `random_non_ideal` / `random_colonizable` / `random_non_colonizable`) and `example.txt:79` documents it as "Picks a random asteroid class", but it appears in no script file, so whether it draws from the six `asteroid = yes` classes, from a hardcoded subset, or is dead is not established. The same comment documents `random_non_colonizable` and `random_colonizable`, which ARE used (`fallen_empire_initializers.txt`, `custom_starting_initializers.txt`), so the comment is not uniformly stale.
- **Whether a belt creates any persistent engine object at all.** Nothing in the install or in either mod's measurements ever names one - no scope link walks from a belt, `has_asteroid_belt` is a boolean and `num_asteroid_belts` an integer, and belts are not counted toward the system size cap. "A belt is a rendering of the system plus the type's mesh list" is the reading the evidence supports, but the engine's own object model was not opened, and a save file was not inspected.
- **Whether `add_asteroid_belt` adds a SECOND belt or replaces one.** `set_asteroid_belt` is documented as "Sets" and `add_asteroid_belt` as "Adds", `num_asteroid_belts` exists as a trigger (so more than one at a time is contemplated), and vanilla only ever calls the SETTING one - with `radius = 0`. Whether `add` appends, and whether `radius = 0` deletes or merely renders nothing, were not observed; the ring world's use is consistent with either.
- **What happens to a belt when the system's planets are removed, moved or regenerated.** `00_ring_world.txt` clears the belt explicitly BEFORE spawning its segments, which says the belt does not clear itself with the planets - but whether that is a necessity or a tidiness is not stated by anything, and no counter-example was found.
- **Whether a `common/asteroid_belts/**` type can carry any key this project did not see.** The census is over the install's six blocks (`mesh`/`shader`/`width`/`density`). The file-header comment mentions only density and width, so a hidden key would have to be undocumented, unused AND accepted - unfalsifiable from a read-only pass.
- **Whether an asteroid can be terraformed.** `change_pc` on asteroid classes is used by vanilla (`anomaly_events_4.txt:4900`, `aquatics_events.txt:1818`) but always in the direction of BECOMING an asteroid; no vanilla effect was found that terraforms an asteroid into a non-asteroid class, and the ordinary terraforming machinery keys off habitability, which an asteroid has none of. Not established either way, and this round ran no game.
- **The exact visual consequence of `density` and `width`.** Their defaults come from the file's own comment and their values are range-checked against nothing. Whether `width` is a radial spread in the same units as `radius`, and how `ASTEROID_AMOUNT_RADIUS_SCALER` interacts with `density`, were not measured and cannot be without rendering a frame.
