---
id: star-slots-in-multi-star-systems
category: script
title: A system's star slots are an ordered list of up to three, declared by the star class as one `planet = { key = ... }` per slot; only the PRIMARY has a scope, and only `is_star`/`is_primary_star` can tell them apart
title_zh: 多恒星星系的恒星槽位是有序列表（最多三个），由 star class 的 `planet = { key = ... }` 每槽一个声明；只有主星有专属 scope，脚本层只有 `is_star` / `is_primary_star` 能区分它们
summary: A star is not a special object type - it is an ordinary PLANET whose class carries `star = yes` (example.txt:58 says so outright). A star class declares the bodies that occupy the slots as an ordered list of `planet = { key = <planet class> }` blocks, one per slot, and an initializer's `planet = { class = star }` blocks take that list IN ORDER. So a system does NOT have "one primary star and nothing else": vanilla declares 36 star classes with 1/2/3 slots (13+15+8 = 67 slots) and 52 of its 360 initializers write more than one star body. There is no `star_2`/`star_3` scope or trigger anywhere in stellaris.exe (0 occurrences); the engine names the stars `STAR_NAME_<i>_OF_<n>` and vanilla's own localisation table stops at n=3 (A/B/C). `star`, `system_star` and `capital_star` all resolve to the PRIMARY star alone, `is_primary_star` is the one trigger that identifies it, and vanilla's own `destroy_star_system` therefore reaches the other stars by walking `every_system_planet = { limit = { is_star = yes } }`. Both of this project's mods put a COLONISABLE planet class in the primary star slot by naming it in the star class' `planet` block, and both had to add `star_gfx = no` or the body renders through the star-surface path and is invisible.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.txt, .asset, .yml]
tags: [star_classes, solar_system_initializers, star_slot, primary_star, is_star, is_primary_star, is_star_class, set_star_class, change_pc, star_gfx, STAR_NAME, pc_geocentric_earth, sc_geocentric, sc_dyson_habitat, pc_dyson_habitat_star, binary, trinary, great_wound_system, census, mod-recipe, measured-negative]
related: [asteroids-and-asteroid-belts, ring-worlds-habitats-and-what-is-colonizable, engine-capability-vs-usage]
sources: [<Stellaris>/common/star_classes/00_star_classes.txt, <Stellaris>/common/star_classes/randomizers/00_random_lists.txt, <Stellaris>/common/solar_system_initializers/example.txt, <Stellaris>/common/solar_system_initializers/sol_initializers.txt, <Stellaris>/common/solar_system_initializers/distant_stars_initializers.txt, <Stellaris>/common/solar_system_initializers/special_system_initializers.txt, <Stellaris>/common/solar_system_initializers/empire_initializers.txt, <Stellaris>/common/solar_system_initializers/custom_starting_initializers.txt, <Stellaris>/common/solar_system_initializers/grand_archive_initializers.txt, <Stellaris>/common/planet_classes/00_planet_classes.txt, <Stellaris>/common/planet_classes/00_planet_classes_astral_planes_dlc.txt, <Stellaris>/common/planet_classes/06_planet_classes_nomads.txt, <Stellaris>/common/inline_scripts/grand_archive/voidworms_system_planet_initializer.txt, <Stellaris>/common/ship_sizes/00_starbases.txt, <Stellaris>/common/deposits/00_null_deposit.txt, <Stellaris>/common/scripted_effects/00_scripted_effects.txt, <Stellaris>/common/scripted_effects/infernals_effects.txt, <Stellaris>/events/anomaly_events_4.txt, <Stellaris>/events/game_start.txt, <Stellaris>/gfx/worldgfx, <Stellaris>/gfx/map/star_classes, <Stellaris>/gfx/models/planets/distant_stars_planets/_distant_stars_star_entities.asset, <Stellaris>/localisation/english/distant_stars_l_english.yml, <Stellaris>/localisation/english/triggers_effects_l_english.yml, <Stellaris>/localisation/english/main_1_l_english.yml, <Stellaris>/launcher-settings.json, <Stellaris>/stellaris.exe, <mods>/geocentric_origin, <mods>/dyson_habitat_cluster, "%USERPROFILE%/Documents/Paradox Interactive/Stellaris/logs/script_documentation"]
---

## The verdict in one paragraph

**多星系统没有"只有一个主星"这回事。** A system's star slots are an **ordered list** - three slots at
most in any vanilla star class, and eleven star bodies in one vanilla initializer - and the list is
*declared by the star class*:

* a star is an ordinary **PLANET** whose planet class carries `star = yes` - the install says so
  outright (`common/solar_system_initializers/example.txt:58`: *"Stars are initialized as planets and
  then classified as stars"*);
* a `common/star_classes/**` block declares ONE `planet = { key = <planet class> }` block per slot,
  and that `key` is what decides which body sits in that slot (`00_star_classes.txt:6`: *"ID for the
  'planet' class which defines the actual star"*). `sc_binary_1` declares two such blocks, `sc_trinary_1`
  declares three;
* an initializer's own `planet = { class = star }` blocks take that list **in order** - one block per
  star, in the order it writes them. `Alpha Centauri` (`sol_initializers.txt:386`) is `sc_trinary_1`
  and writes three; `Sirius` (`:657`) is `sc_binary_9` and writes two.

There is no `star_2`/`star_3` **scope, trigger or slot name anywhere in `stellaris.exe`** (0
occurrences of `star_1`/`star_2`/`star_3`/`star_slot`/`secondary_star`, measured). What the engine has
is an **index and a count**: the format string `STAR_NAME_%i_OF_%i` (binary offset 38905664), whose
localisation table in all eleven shipped languages carries exactly the pairs for n = 1, 2 and 3 with
the suffixes A/B/C (`distant_stars_l_english.yml:1996-2001`). `star`, `system_star` and `capital_star`
all resolve to the **primary** star alone (`scopes.log:26/274/278`), `is_primary_star`
(`triggers.log:2621-2623`) is the one trigger that identifies it, and the effect that changes a star's
class, `set_star_class`, the install's own description says *"Also changes the planet class of the
system's primary star"* - singular (`effects.log:403`). That is why vanilla's `destroy_star_system`
has to walk the slots by hand:

```
every_system_planet = { limit = { is_star = yes } change_pc = pc_black_hole }
```

## What slot 1 decides - what the ORDER actually buys you

The order is not cosmetic, and being first is not merely a position in a list. Because slot 1 is the
**primary**, and every primary-only mechanism in the script language resolves to the primary,
**slot 1 decides four separate things at once** - and the accretion-disk probe (the
`black-hole-primary-star-system` topic) measured all four ON SCREEN, with a black hole in slot 1 and
a yellow star in slot 2:

| what slot 1 decides | the mechanism (file-side) | the observation (the user's eyes) |
| --- | --- | --- |
| the starbase anchor | `is_primary_star = yes` in every outpost's `potential_construction` (`common/ship_sizes/00_starbases.txt:86-92`, 10 sites) | the home starbase sat on the **black hole** |
| the galaxy-map icon | the class declared **no** `icon`, so the engine falls back (`gfx/map/star_classes/%s.dds` is the format string) | the galaxy map showed a **black-hole system** |
| the lighting source | `class = <x>` selects `gfx/worldgfx/star_<...>.txt`, hence its `system_light` | the system was **lit** and the colonisable world was **bright** |
| every body's orbit centre | `orbit_distance` is a radius from the system centre, and the centre is the primary | a world **between** the two stars still **orbited the black hole** |

Two consequences a mod author acts on:

* **A body's orbit is the PRIMARY's.** There is no barycentric two-star orbit for bodies: "between
  the stars" is a RADIUS, never a shared orbit. A world placed in the gap by a negative relative
  `orbit_distance` is between them on screen and still visibly orbits the primary.
* **If the world should LOOK like it orbits the yellow star, the YELLOW STAR must be slot 1.** None
  of the four decisions has a per-body override, so a black hole in slot 1 is the starbase's anchor,
  the galaxy icon, the light and the orbit centre no matter which slot the yellow star holds.

The working recipe - both star bodies declared FIRST (they consume the slots in order), the planet
declared THIRD with a negative relative orbit, and the band check that avoids silently deleting the
starting colony - is in the `black-hole-primary-star-system` topic. In one line: black hole `0`, yellow star
`150`, planet `150 + (-75) = 75`, with 75 kept inside `pc_continental`'s own `min_distance_from_sun`
60 / `max_distance_from_sun` 100 band (`00_scripted_variables.txt:183-184`).

## Syntax

```
# ---------------------------------------------------------------------------------------
# 1. WHAT A STAR IS: a PLANET CLASS with `star = yes`. There is no separate object type.
#    common/solar_system_initializers/example.txt:57
# ---------------------------------------------------------------------------------------
### STARS & PLANETS
# Stars are initialized as planets and then classified as stars:      # example.txt:58
planet = {
	class = star                    # picks the class the SYSTEM's star class assigns to this slot
	orbit_distance = 0
}

# ...and an ordinary planet block in the same file, whose `class` may also be `star`:
planet = {
	class = star                    # example.txt:73 "Picks a star class which matches the system's class (defined above)"
	orbit_distance = { min = 40 max = 50 }
}

# The system's star class is a SEPARATE field on the initializer:
example_initializer = {
	class = "rl_standard_stars"     # example.txt:14 "may be a specific class (e.g. 'sc_binary_10') or a random class from a list"
}

# ---------------------------------------------------------------------------------------
# 2. THE SLOT TABLE IS THE STAR CLASS. One `planet = { key = ... }` block per slot, IN ORDER.
#    common/star_classes/00_star_classes.txt:230  (sc_binary_1)  and  :541  (sc_trinary_1)
# ---------------------------------------------------------------------------------------
sc_binary_1 = {                     # :230   TWO slots
	class = a_star                  # :231   the lighting/appearance id, resolved by code and GFX
	icon = e_binary_star            # :232   -> gfx/map/star_classes/e_binary_star.dds
	planet = {                      # :233   slot 1
		key = pc_a_star             # :234   <-- the BODY in slot 1
		class = a_star              # :235   the per-slot lighting class
	}
	planet = {                      # :237   slot 2
		key = pc_pulsar             # :238   <-- the BODY in slot 2
		class = pulsar
	}
	spawn_odds = 5
	num_planets = { min = 4 max = 10 }
}

sc_trinary_1 = {                    # :541   THREE slots
	class = g_star
	icon = a_trinary_star
	planet = { key = pc_g_star  class = g_star }   # :544-547
	planet = { key = pc_m_star  class = m_star }   # :548-551
	planet = { key = pc_k_star  class = k_star }   # :552-555
	crisis_star_class = sc_crisis_trinary_1
	spawn_odds = 30
}

# A SINGLE-slot class is the same shape with one block, and vanilla writes it on ONE LINE:
sc_b = {
	class = b_star
	planet = { key = pc_b_star }    # :25   <-- 13 of the install's 67 slots are written this way
	spawn_odds = 10
	num_planets = { min = 4 max = 10 }
	arkship_picture = "arkship_class_b"
}
# A `planet = { }` slot block carries exactly two fields in all 67 vanilla slots: `key` (67x)
# and, on the 54 written multi-line, `class` (54x). Nothing else - no orbit, no size, no count.

# ---------------------------------------------------------------------------------------
# 3. HOW A MULTI-STAR SYSTEM IS ACTUALLY WRITTEN. One top-level `planet` block per star, and the
#    star blocks DO take `orbit_distance` / `orbit_angle` like any other body.
#    common/solar_system_initializers/sol_initializers.txt:386
# ---------------------------------------------------------------------------------------
# Neighbor Tier 1 First Colony     <- Alpha Centauri, a TRINARY
sol_neighbor_t1_first_colony = {
	name = "NAME_Alpha_Centauri"
	class = sc_trinary_1            # :388   three slots -> three star blocks below
	flags = { neighbor_t1_first_colony }
	planet = {                      # :395   STAR 1 (the primary)
		name = "NAME_Alpha_Centauri_A"
		count = 1
		class = pc_g_star           # :398   an EXPLICIT star planet class overrides the slot's key
		orbit_distance = 15
		orbit_angle = 350
		size = 32
		has_ring = no
	}
	planet = {                      # :405   STAR 2
		name = "NAME_Alpha_Centauri_B"
		class = pc_k_star
		orbit_distance = -35        # :409   relative to the previous body's orbit, so a NEGATIVE value places it
		orbit_angle = 10
		size = 27
	}
	planet = {                      # :415   STAR 3 - and a star can carry planets of its own
		name = "NAME_Proxima_Centauri"
		class = pc_m_star
		orbit_distance = 260
		orbit_angle = 130
		size = 15
		planet = { class = pc_barren_cold ... }   # :424   nested: a planet orbiting STAR 3
		planet = { class = pc_gas_giant   ... }   # :441
	}
	change_orbit = -220             # :449   shorthand for `planet = { class = none orbit_distance = -220 }`
	planet = { count = 2 orbit_distance = 25 ... }
	planet = { class = ideal_design_class ... }
}

# The SAME system written with `class = star`, which takes the class from the star class' list
# IN ORDER instead of naming it. common/solar_system_initializers/special_system_initializers.txt:1243
polaris_civilization = {
	class = sc_trinary_3            # slots are pc_k_star, pc_f_star, pc_g_star
	planet = { name = "NAME_PolarisAa"  class = star  orbit_distance = 0  size = { min = 25 max = 30 } }   # :1265
	planet = { name = "NAME_PolarisAb"  class = star  orbit_distance = 0  size = { min = 15 max = 20 } }   # :1277
	planet = { name = "NAME_PolarisB"   class = star  orbit_distance = 60 size = { min = 10 max = 15 } }   # :1289
	planet = { class = pc_ice_asteroid ... }        # :1301 - an ORDINARY body, slot count already filled
}

# A BINARY, with the second star at the SAME orbit distance and a different angle:
sol_neighbor_t2 = {                 # Procyon, sol_initializers.txt:597
	name = "NAME_Procyon"
	class = sc_binary_8             # :599
	planet = { name = "NAME_Procyon_A" class = pc_f_star  orbit_distance = 30 orbit_angle = 1   size = 35 }  # :609
	planet = { name = "NAME_Procyon_B" class = pc_f_star  orbit_distance = 0  orbit_angle = 125 size = 20 }  # :619
	planet = { count = 1 orbit_distance = 65 }        # :629 - a normal planet
	planet = { count = { min = 1 max 3 } class = pc_asteroid ... }
}

# ---------------------------------------------------------------------------------------
# 4. THE STAR CLASS' LIST IS A DEFAULT, NOT A CAP. Two vanilla counter-examples, both legal.
#    common/solar_system_initializers/sol_initializers.txt:3659 (ZERO star blocks)
# ---------------------------------------------------------------------------------------
init_sol_geocentric = {             # the install's own geocentric easter egg
	name = "NAME_Helios"
	class = "sc_g"                  # ONE slot, and NO `class = star` block anywhere in the file
	planet = {                      # :3673 - the FIRST body is an ordinary planet at orbit 0.01
		name = "NAME_Orrery_Site"
		class = "pc_nuked"          # ...so pc_g_star, sc_g's own slot key, is still placed by the class
		orbit_distance = 0.01
		...
		moon = { class = "pc_barren_cold" orbit_distance = 12 ... }   # :3694 the Moon, at 12
	}
	planet = { class = "pc_gas_giant" orbit_distance = 40 ... }       # :3709
}
# Measured over all 360 vanilla initializers: SEVEN write no star body at all, and the star still
# appears because the STAR CLASS placed it - `init_sol_geocentric` and `example_neighbor` name a
# class, and the five `voidworms_spawn_system_*` get theirs from an `inline_script`.

# common/solar_system_initializers/distant_stars_initializers.txt:1260 (ELEVEN star bodies)
great_wound_system = {              # the Distant Stars "Great Wound" - eleven black holes
	class = sc_black_hole           # ONE declared slot
	planet = { class = star orbit_distance = 0 size = 40 ... }        # :1282  slot 1, from the class
	change_orbit = 60
	planet = { class = "pc_black_hole" name = "NAME_Subspace_Rupture_1"  orbit_distance = 0 orbit_angle = 1   size = 20 }  # :1308
	change_orbit = 60
	planet = { class = "pc_black_hole" name = "NAME_Subspace_Rupture_2"  ... orbit_angle = 210 size = 20 }  # :1323
	# ... :1340, :1355, :1369, :1384, :1398, :1414, :1429, :1445 - TEN more, ending at
	planet = { class = "pc_black_hole" name = "NAME_Subspace_Rupture_10" ... orbit_angle = 170 size = 10 }  # :1445
}

# ---------------------------------------------------------------------------------------
# 5. THE ONLY WAY A MOD REACHES THE STAR SLOTS: the star class' `planet` block, plus
#    `planet = { class = star }` per star in the initializer. Both of this project's mods do it.
#    <mods>/geocentric_origin/common/star_classes/zz_geocentric_star_classes.txt:11
# ---------------------------------------------------------------------------------------
sc_geocentric = {
	class = g_star                             # lighting/appearance id
	planet = { key = pc_geocentric_earth }     # :13  <-- Earth ITSELF is the star slot body
	spawn_odds = 0                             # never drawn at random; only the origin's initializer uses it
	num_planets = { min = 1 max = 1 }
	arkship_picture = "arkship_class_g"
}

# <mods>/dyson_habitat_cluster/common/star_classes/zz_dysonhab_star_classes.txt:8
sc_dyson_habitat = {
	class = g_star
	planet = { key = pc_dyson_habitat_star }   # :10  a COLONISABLE body in the star slot
	spawn_odds = 0
	num_planets = { min = 3 max = 6 }
}

# ...and the initializer asks for it by name and writes ONE `class = star`:
geocentric_home_system = {                     # zz_geocentric_initializers.txt:157
	class = "sc_geocentric"                    # :159
	usage = origin
	planet = {                                 # :228  the ONLY star slot
		class = star                           # :229  -> resolves to pc_geocentric_earth
		orbit_distance = 0
		orbit_angle = 0
		size = 100
		starting_planet = yes
		flags = { ignore_startup_effect planet_earth geocentric_earth }
		moon = { name = "NAME_Sol" class = "pc_geocentric_sun" orbit_distance = @geo_sun ... }   # :245
		moon = { name = "NAME_Luna" class = "pc_barren_cold" orbit_distance = @geo_luna ... }    # :259
		moon = { ... Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune ... }                # :274-373
	}
}

# THE CLASS THAT MAKES THE BODY VISIBLE. planet_classes/zz_geocentric_planet_classes.txt:30
pc_geocentric_earth = {
	entity = "zz_geocentric_earth_star_entity"  # :31
	entity_scale = 20.0
	icon = GFX_planet_type_continental
	atmosphere_color = hsv { 0.58 0.5 0.9 }     # :36  a SCALAR BLOCK VALUE - see `## Breaks` below
	climate = "luminosity_2"
	star = yes                                  # :41  <-- what puts this body in the star slot at all
	star_gfx = no                               # :42  <-- WITHOUT THIS THE BODY IS INVISIBLE
	spawn_odds = 0
	planet_size = 100
	colonizable = yes                           # :56  a colonisable STAR
	district_set = standard
	starting_district = district_city
}

# ---------------------------------------------------------------------------------------
# 6. WHAT A MOD CAN ASK AT RUNTIME. The star slots are planets, so they answer planet triggers.
#    logs/script_documentation/triggers.log:556, :876, :2621  and  scopes.log:26, :274, :278
# ---------------------------------------------------------------------------------------
is_star = yes                  # triggers.log:556-558   "Checks if the planet is a star"      scopes: planet ship
is_primary_star = yes          # triggers.log:2621-2623 "Checks if the planet is the system's primary star"  scopes: planet ship
is_star_class = sc_black_hole  # triggers.log:876-878   "Checks if the system/planet(star) is of a certain class"  scopes: planet ship galactic_object
is_planet_class = pc_geocentric_earth    # triggers.log:868-870 - the star-slot body IS a planet object

star            = { }          # scopes.log:26   "Scopes from an object to the primary star (planet scope) of the system it is in."
system_star     = { }          # scopes.log:278  same wording
capital_star    = { }          # scopes.log:274  "Scopes from an empire to the primary star (planet scope) of its capital's system."
# All three are the PRIMARY. There is no `star_2`.

set_star_class = sc_m          # effects.log:403-405  scope `galactic_object`
change_pc = pc_m_star          # effects.log:393-395  "Changes the class of the scoped planet"
```

```
# ---------------------------------------------------------------------------------------
# 7. THE FIVE THINGS A MOD ACTUALLY ASKS, EACH WITH ITS SMALLEST VANILLA EXAMPLE.
# ---------------------------------------------------------------------------------------

# (a) CHANGE THE PRIMARY STAR'S CLASS, at load time: pick a different star class for the SYSTEM,
#     or name the slot key directly in the initializer.
probe_system = { class = "sc_black_hole" }          # sol_initializers.txt:599 style - the class IS the slot table
planet = { class = "pc_pulsar" }                    # special_system_initializers.txt:650 - or name the body outright

# (b) CHANGE EVERY STAR'S CLASS AT RUNTIME. The smallest vanilla example is TWO lines, and it is two
#     lines because one effect cannot do it: `solar_system = { set_star_class = ... }` is the extra.
#     common/scripted_effects/infernals_effects.txt:159 (hyperthermia_galaxy_effect)
every_system_planet = {                             # :161
	limit = {
		is_star = yes                               # :163  <-- a star answers a PLANET trigger
		NOR = {
			is_planet_class = pc_black_hole         # :165  <-- and it answers `is_planet_class` too
			is_planet_class = pc_m_star
			is_planet_class = pc_m_giant_star
		}
	}
	change_pc = pc_m_giant_star                     # :182  the BODY in every star slot
	solar_system = { set_star_class = sc_m_giant }  # :183  the SYSTEM's class (and the primary's body)
}

# (c) ADD A STAR: write one more star body. `great_wound_system` is the extreme case - ten extra
#     black holes beyond `sc_black_hole`'s single declared slot (distant_stars_initializers.txt:1308-1445),
#     each with its own explicit `class =` and its own NAME_* key.
# (d) REMOVE A STAR: write FEWER star bodies than the class declares. No vanilla initializer does this
#     against a multi-slot star class or randomizer - all 50 of them write exactly the declared slot
#     count - so the only measured case of "fewer" is the ZERO case below, and writing 1 against a
#     two-slot class is untested. See `## 待确认`.
init_sol_geocentric = { class = "sc_g" }            # sol_initializers.txt:3659 - ZERO star blocks, one star from the class

# (e) A COLONISABLE BODY IN A STAR SLOT: name it in the star class' slot block, give the class
#     `star = yes` AND `star_gfx = no`. Both of this project's mods are the worked example.
sc_probe = {
	class = g_star
	planet = { key = pc_probe_home }                # the body in slot 1 (the primary)
	planet = { key = pc_probe_home }                # ...the SAME class again would be slot 2 - legal, unmeasured
	spawn_odds = 0
}
```

```
# THE IDIOM THE INSTALL ITSELF USES TO REACH *EVERY* STAR SLOT, because no scope names star 2 or 3:
# common/scripted_effects/00_scripted_effects.txt:4482 (destroy_star_system)
	set_star_flag = star_cracked                              # :4493
	set_star_class = sc_black_hole                            # :4494  the system + the PRIMARY only
	every_system_planet = {                                   # :4505
		limit = { is_star = yes }                             # :4506  <-- every star, primary included
		create_ambient_object = { type = "star_explosion" play_animation_once = yes location = this }
		change_pc = pc_black_hole                             # :4519
	}

# ...and the install does BOTH halves in one scripted event, which is the proof that
# set_star_class alone is not enough:
# events/anomaly_events_4.txt:4987 (the GEOCENTRIC EXPERIMENT anomaly, the easter egg above)
			from.solar_system = {
				destroy_star_system = yes                     # :4988
				set_star_class = sc_m                         # :4989
				every_system_planet = {                       # :4990
					limit = { is_star = yes }
					change_pc = pc_m_star                     # :4992
				}
				every_system_planet = {
					limit = { has_carrier_flag = gravity_stabilizer }
					change_pc = pc_shattered                  # :4998
				}
			}
```

## Evidence

- `vanilla`, the slot table, counted with a brace-depth reader over `common/star_classes/**` (the slot
  blocks are the star class' own children; the initializers are only users of the table):
  **45 star-class records = 36 star classes + 9 randomizers**, and the 36 star classes declare
  **67 `planet` slot blocks**: **13 classes with exactly ONE slot, 15 with TWO, 8 with THREE**. The
  maximum any vanilla star class declares is **three**. Every one of the 67 slots names a `key`, and
  every one of those keys is a planet class defined in `common/planet_classes/**` (0 unresolved).
  Slot blocks carry exactly two field names across the whole tree: `key` (67x) and `class` (54x - the
  13 single-slot classes write it without `class`).
- `vanilla`, `common/star_classes/00_star_classes.txt:1` states the schema in the install's own words -
  *"Star classes add further definition to solar system initializers, in that they apply certain
  conditions to the whole star system. A given system initializer may either make an explicit choice of
  star class (e.g. "class = sc_f") or else choose one from a random list (e.g. "rl_binary_stars")"* -
  and `:6` is the slot comment: `planet = { key = pc_b_star }  # ID for the 'planet' class which
  defines the actual star: its 3D asset, size, colonization setting, etc.` The two-slot
  `sc_binary_1` block is `:230-261` and the three-slot `sc_trinary_1` is `:541-561`.
- `vanilla`, the randomizers are `common/star_classes/randomizers/00_random_lists.txt`: nine `rl_*`
  blocks, each `stars = { "sc_x" ... }` - a list of star CLASSES, not of bodies. `rl_binary_stars`
  (`:1-14`) names the ten `sc_binary_*`; `rl_trinary_stars` (`:16-23`) the four `sc_trinary_*`;
  `rl_binary_starting_stars` (`:48-57`) five usable binaries; `rl_standard_stars` (`:25-35`) seven
  single-star classes. An initializer's `class` field names either a star class or one of these, which
  is why the reader keeps them in one namespace and tells them apart by the `stars` child.
- `measured`, the initializer side, over the install's **360 initializers in 40 files**: **355** name a
  top-level `class`, **5** name none (`grand_archive_initializers.txt:2-45`, the
  `voidworms_spawn_system_*` family, whose `class = sc_black_hole` arrives through
  `inline_script = { script = grand_archive/voidworms_system_planet_initializer }` -
  `common/inline_scripts/grand_archive/voidworms_system_planet_initializer.txt:1`). **52 initializers
  write MORE THAN ONE star body**: 26 name a `sc_binary_*`/`sc_trinary_*` class directly (17 write 2,
  9 write 3) and 24 name a binary/trinary randomizer (7 `rl_binary_stars` + 5
  `rl_binary_starting_stars` write 2, 12 `rl_trinary_stars` write 3), 1 is the documentation file's
  own `example_initializer` (`example.txt:12`, `rl_standard_stars`, 2), and **1 writes ELEVEN**
  (`great_wound_system`). Every one of the 26 that names a binary/trinary class writes EXACTLY that
  class' slot count - **0 mismatches**. **7 initializers write ZERO star bodies** and still get a star
  from their class: `init_sol_geocentric` (`sc_g`), `example_neighbor` (`rl_standard_stars`) and the
  five voidworms systems. The whole corpus writes **435 star bodies**.
- `binary`, the engine's star slots are an INDEX, not names: `STAR_NAME_%i_OF_%i` at offset **38905664**,
  immediately after the source path `...\source\prescripted_systems.cpp` (38905520) and among
  `invalid planet class or random_list [%s]` (38905616, note the brackets around `[%s]`),
  `_random_asteroid_` (38905592) and `System initializer: %s. Star class is not specified.` (38905688).
  The localisation table for that format is
  `localisation/english/distant_stars_l_english.yml:1996-2001`: `STAR_NAME_1_OF_1` `$NAME$`,
  `STAR_NAME_1_OF_2`/`_2_OF_2` `$NAME$ A`/`$NAME$ B`, and `STAR_NAME_1_OF_3`/`_2_OF_3`/`_3_OF_3`
  `$NAME$ A`/`B`/`C` - **six keys for n = 1, 2, 3, and no `_OF_4` in any of the eleven languages**
  (checked in `english`, `simp_chinese`, `japanese`, `korean`, `french`, `german`, `spanish`,
  `russian`, `polish`, `braz_por`).
- `binary`, there is NO named slot to reach: `star_1`, `star_2`, `star_3`, `star_slot`,
  `secondary_star`, `star_index` and `star_count` occur **0 times** in `stellaris.exe`. The
  star-related identifiers that DO exist are `is_star` (38551904), `is_primary_star` (38600528),
  `capital_star` (38519936), `system_star` (38520016), `is_star_class` (38589120), `is_orbiting_star`
  (38423728), `star_gfx` (38439624), `arkship_picture` (38465680), `is_environmental_hazard`
  (38520176), `crisis_star_class` (38582048), `can_be_crisis_terraformed` (38582128) and `stars`
  (38468700, the randomizer's list key). `num_stars` (38469208) is NOT a per-system trigger: it sits in
  the binary's galaxy-setup template block, beside `TEMPLATE_NUM_STARS` (38909272), `stars_min_dist`
  (38504616), `num_stars_core_perc` (38504576), `setup_scenario` (38469480), `core_radius` (38469464)
  and `spiral_2`/`spiral_4` (38469392/38469448), and it appears in neither `triggers.log` nor
  `effects.log`.
- `log`, the engine's own script documentation, verbatim:
  `scopes.log:26` `star - Scopes from an object to the primary star (planet scope) of the system it is
  in.` (scopes `megastructure planet ship fleet galactic_object ambient_object bypass starbase
  archaeological_site first_contact debris astral_rift colony`, output `planet`); `scopes.log:274`
  `capital_star - Scopes from an empire to the primary star (planet scope) of its capital's system.`;
  `scopes.log:278` `system_star - Scopes from an object to the primary star (planet scope) of the
  system it is in.`; `triggers.log:556-558` `is_star - Checks if the planet is a star` / `is_star = yes`
  / `Supported Scopes: planet ship`; `triggers.log:876-878` `is_star_class - Checks if the
  system/planet(star) is of a certain class` / `is_star_class = sc_black_hole/<system scope>` /
  `Supported Scopes: planet ship galactic_object`; `triggers.log:2621-2623` `is_primary_star - Checks if
  the planet is the system's primary star` / `is_primary_star = yes` / `Supported Scopes: planet ship`;
  `effects.log:403-405` `set_star_class - Sets the star's star class, affecting system and galactic map
  graphics and potentially modifiers. Also changes the planet class of the system's primary star.` /
  `set_star_class = <star class>` / `Supported Scopes: galactic_object`; `effects.log:393-395`
  `change_pc - Changes the class of the scoped planet` / `change_pc = <class/random list>` /
  `change_pc = { class = <class/random list> inherit_entity = yes }`. The dump is dated 2026-10-06 and
  lives in the USER data directory; the install's own `<Stellaris>/logs/` is EMPTY.
- `vanilla`, the PRIMARY is a real, used distinction and the whole starbase system hangs off it:
  `common/ship_sizes/00_starbases.txt:86-92` gates every outpost on
  `potential_construction = { is_scope_type = planet  is_primary_star = yes  NOT = { exists =
  orbital_defence } }` (10 sites: lines 88, 543, 593, 644, 697, 748, 799, 856, 911, 996), and
  `common/deposits/00_null_deposit.txt:5-6` excludes the primary from the null deposit. The install's
  own localisation says it twice: `triggers_effects_l_english.yml:132` `PLANET_IS_PRIMARY_STAR:0 "Is the
  system's primary Star"` beside `:134` `PLANET_IS_STAR:0 "Is a Star"`, `main_1_l_english.yml:1958`
  `CAN_BUILD_STATION_STARBASE_NOT_PRIMARY_STAR:0 "Starbases can only be built around the primary
  star."` and `infernals_crisis_l_english.yml:151` `CAN_NOT_TERRAFORM_STAR: "$TRIGGER_FAIL$Must be a
  primary star."`.
- `vanilla` + `binary`, the two-sided proof that `set_star_class` touches ONLY the primary, at THREE
  sites:
  `common/scripted_effects/00_scripted_effects.txt:4493-4494` sets the flag and the class, then
  `:4505-4520` walks `every_system_planet = { limit = { is_star = yes } change_pc = pc_black_hole }` to
  convert the rest; `events/anomaly_events_4.txt:4987-4999` (the vanilla geocentric-experiment anomaly)
  does the SAME pair - `set_star_class = sc_m` **and** an `is_star = yes` sweep; and
  `common/scripted_effects/infernals_effects.txt:161-183` (`hyperthermia_galaxy_effect`) is the
  smallest of the three - `every_system_planet = { limit = { is_star = yes  NOR = { is_planet_class =
  pc_black_hole ... } } change_pc = pc_m_giant_star  solar_system = { set_star_class = sc_m_giant } }`,
  where the loop and the system-level effect are BOTH needed to turn every star red-giant. That loop
  also proves a star is a planet in the engine's own hands: it tests `is_planet_class` on star bodies.
  The documentation's singular "the system's primary star" (`effects.log:403`) and the redundant loop
  agree. `is_star = no` is used as the complementary filter at `00_scripted_effects.txt:4540`.
- `vanilla`, the geocentric easter egg is DYNAMIC, which is why it is not the precedent this project's
  mods followed: it is spawned by an event (`events/game_start.txt:134-137`, `random_system = {
  limit = { has_owner = no }  spawn_system = { initializer = "init_sol_geocentric" } }`, inside a
  `random_list` entry whose comment at `:125` reads `50 = { # Geocentric Experiment`) and its payoff
  event is the one at `anomaly_events_4.txt:4955` (`ship_event = { id = anomaly.8000 ... }`), whose
  option B destroys and re-classes the system. The system the player sees is a normal `sc_g` system
  with a normal `pc_g_star` star.
- `binary`, the star class has its own source file and its own two error strings:
  `...\source\star_class.cpp` (38890768) with `arkship_picture %s not found for star class %s`
  (38890832) - resolved from `gfx/portraits/arkships/stars/` (38890736) - and
  `...\source\star_class_randomizer.cpp` (38891072) with `random_list does not contain any star
  classes! %s, Line%i-%i` (38891144), beside `Failed to find star class or valid random_list by key: `
  (38907016) and `System Initializer: unknown settings value %s` (38907200). The galaxy map icon is a
  FILE, not a sprite: `gfx/map/star_classes/%s.dds` (39679856), and the folder holds 20 of them -
  among them `e_binary_star.dds`, `a_trinary_star.dds` and `x_star.dds`, i.e. the exact values the
  binary/trinary classes and `sc_toxoid_star` put in their `icon` field. The 24 `icon`-carrying star
  classes use **six distinct values** - `a_trinary_star` (8x), `d_binary_star` (6x), `e_binary_star`
  (3x), `c_binary_star` (3x), `a_binary_star` (3x), `x_star` (1x) - and all six exist as `.dds`. Those
  names occur in NO other file of the install: nothing in `interface/**/*.gfx` declares them, which is
  why the engine's `gfx/map/star_classes/%s.dds` format string is what resolves them.
- `vanilla`, the per-slot `class` field is the LIGHTING/appearance tag, and it resolves to a worldgfx
  file: `gfx/worldgfx/` holds 13 `star_*.txt` files whose `world = <tag>` is on line 5 of each -
  `star_a_class.txt` `world = a_star`, `star_b_class.txt` `b_star`, `star_f_class.txt` `f_star`,
  `star_g_class.txt` `g_star`, `star_k_class.txt` `k_star`, `star_m_class.txt` `m_star`,
  `star_t_class.txt` `t_star`, `star_black_hole.txt` `black_hole`, `star_neutron.txt` `neutron_star`,
  `star_pulsar.txt` `pulsar`, `star_rift_class.txt` `rift_star`, `star_tox_class.txt` `toxoid_star` -
  twelve tags that appear as a star class' `class` value, plus `star_ed_class.txt` `world = ed_star`,
  which no star class in 4.4.6 names. The FILES are what give the star its glow and its light: a
  body in the star slot is drawn from here, not from its planet class' `entity` - see `## Breaks`.
- `vanilla` + `measured`, `star_gfx` is a real engine field (literal at 38439624) and it has exactly
  THREE users in the whole install, all `star = yes`:
  `common/planet_classes/00_planet_classes.txt:1260-1273` `pc_t_star` (`entity =
  t_star_class_star_entity`), `common/planet_classes/06_planet_classes_nomads.txt:110-123`
  `pc_protostar` (same entity) and `common/planet_classes/00_planet_classes_astral_planes_dlc.txt:1-10`
  `pc_rift_star` (`entity = crystal_rift_entity`). Every one of them carries `star_gfx = no`. The
  install defines **14** planet classes with `star = yes` (`pc_a_star`, `pc_b_star`, `pc_f_star`,
  `pc_g_star`, `pc_k_star`, `pc_m_star`, `pc_m_giant_star`, `pc_black_hole`, `pc_neutron_star`,
  `pc_pulsar`, `pc_t_star`, `pc_protostar`, `pc_rift_star`, `pc_toxoid_star`), and the other eleven
  render through the star path because they use a star entity - so `star_gfx = no` is exactly the
  switch that says "this body is a planet-style mesh, draw its own entity".
- `vanilla`, the reason an emissive shader is needed at all:
  `gfx/models/planets/distant_stars_planets/_distant_stars_star_entities.asset:14-59` defines
  `t_star_class_star_entity` as `pdxmesh = "planet_clouded_mesh"` with
  `shader = "PdxMeshPlanetEmissive"` on its geosphere (`:24`) - the same mesh a planet uses, forced
  emissive because *"a body sitting at the system's star position has no external light source aimed at
  it"* (the project's own mod states why, `zz_geocentric_entities.asset:13-15`).
- `measured`, this project's two mods, read from disk, and they are the ONLY colonisable star slots
  the reader finds anywhere: `<mods>/geocentric_origin/common/star_classes/
  zz_geocentric_star_classes.txt:11-17` `sc_geocentric = { class = g_star  planet = { key =
  pc_geocentric_earth }  spawn_odds = 0  num_planets = { min = 1 max = 1 }
  arkship_picture = "arkship_class_g" }` against `common/planet_classes/
  zz_geocentric_planet_classes.txt:30-62` (`star = yes`, `star_gfx = no`, `planet_size = 100`,
  `colonizable = yes`, `district_set = standard`, `starting_district = district_city`), driven by
  `common/solar_system_initializers/zz_geocentric_initializers.txt:157` whose star block is ONE
  `planet = { class = star ... }` at `:228` with the Sun, the Moon and the seven other planets as
  nested `moon` blocks; and `<mods>/dyson_habitat_cluster/common/star_classes/
  zz_dysonhab_star_classes.txt:8-13` `sc_dyson_habitat -> pc_dyson_habitat_star`
  (`dysonhab_planet_classes.txt:4-44`: `star = yes`, `star_gfx = no`, `planet_size = { min = 80 max =
  80 }`, `colonizable = yes`, `district_set = habitat`), driven by
  `dysonhab_initializers.txt:13-17`. Run through this project's own reader, the install's own
  star-class tree yields **0 findings** under `star-class-planet-undefined` and vanilla's 67 slots are
  **not one of them colonisable** - the two that are, are those two mods.
- `measured` / `log`, the version this was measured on: `launcher-settings.json` reads
  `"version": "Pegasus v4.4.6 (fdde)"`, `"rawVersion": "v4.4.6"`, and `stellaris.exe` is 46,418,552
  bytes at `<Stellaris>/stellaris.exe`.
- `measured` / the USER'S EYES (2026-10-06), the POSITIONAL ASSIGNMENT is now observed, not inferred:
  the accretion-disk probe's `sc_accretion` declares two slots (`pc_black_hole` then `pc_g_star`) and
  its initializer writes two `planet = { class = star }` blocks in that order, and the user saw **one
  black hole and one yellow star**, with the starbase on the black hole. A "both blocks always take
  slot 1" reading would have produced two black holes and a yellow star nowhere; the second block
  therefore consumed slot 2. Vanilla content never made this observable - a star's planet class is
  not in any script output - which is why it took a probe with two VISUALLY DIFFERENT classes in the
  two slots to settle it.
- `measured` / the USER'S EYES, and `vanilla` for the mechanism, the four consequences of slot 1:
  the starbase sat on the black hole (predicted from `00_starbases.txt:86-92`), the galaxy map showed
  a black-hole system although `sc_accretion` declares no `icon`, the system was LIT and the
  colonisable world bright (predicted from `gfx/lights/star_lights.asset:231/239`, intensity 2.5, the
  same as `g_class_star` at `:129`), and the world placed BETWEEN the two stars still orbited the
  black hole - i.e. the orbit centre is the primary, and there is no barycentric two-star orbit for
  bodies. The full record, with provenance for each item, is the
  `black-hole-primary-star-system` topic.

## Rules

- **A system's star slots are exactly what the initializer writes, and the star class fills the rest.**
  Write one top-level `planet = { class = star }` (or `class = pc_x_star`) per star you want; the Nth
  such block takes the Nth `key` of the star class' `planet` list. Write none and the class' whole list
  is placed (`init_sol_geocentric`). Write more than the list has and the extras are stars too, each
  needing its own explicit `class =` (`great_wound_system`, 11 against 1). What you must NOT do is
  assume a cap of three: three is the limit of vanilla's NAMING table, not of the engine's slot list.
- **Never assume a system has one star.** 23 of the install's 36 star classes declare more than one
  slot (15 binary, 8 trinary) and 52 of its 360 initializers write more than one star body. Code that
  means "the star" must say which one: `star`, `system_star`, `capital_star` and `is_primary_star` all
  mean the PRIMARY, and nothing in the script language names slot 2 or 3.
- **To touch every star, iterate the system's planets and filter - that is what the engine's own
  scripted effects do.** `every_system_planet = { limit = { is_star = yes } ... }`
  (`00_scripted_effects.txt:4505`). `set_star_class` alone changes the system's star class, the
  galactic-map graphics and the PRIMARY star's planet class, and nothing else.
- **A star is a planet.** Anything that works on a planet works in a star slot: `change_pc`,
  `remove_planet`, `spawn_planet`, deposits, anomalies, flags, `is_planet_class`, moons, `size`,
  `orbit_distance`, `orbit_angle`, `has_ring`, `init_effect`, and a colony. There is no separate star
  object type to check for - only `star = yes` on the class it happens to carry.
- **Putting a colonisable class in a star slot is legal and works - but the class must say
  `star = yes` and `star_gfx = no`.** `star = yes` is what makes the engine treat the slot as a star
  at all; `star_gfx = no` is what makes it draw from the class' own `entity` instead of the
  star-surface path. Both of this project's mods needed both, and `star_gfx = no` is the one that is
  easy to miss because it is undocumented in the field list.
- **The star-slot starbase is the PRIMARY star's.** `potential_construction` on every outpost demands
  `is_primary_star = yes` (10 sites in `00_starbases.txt`), so a starbase cannot be built at star 2 at
  all - that part is measured. The consequence for a colonisable SECONDARY star - that its colony waits
  until the system is claimed through the primary - follows from that gate and from a star-slot body
  being an ordinary planet, and it is **not** separately observed; see `## 待确认`.
- **Slot 1 is not "the first body" - it is the four-way decision, and the ORDER you write the slot
  table in is the assignment.** The primary is the starbase anchor, the galaxy-map icon, the lighting
  source and every body's orbit centre (all four observed; see the table above), so a mod that wants
  a habitable world to appear to orbit a particular star must put THAT star in slot 1. There is no
  per-body override and no second star to hang any of the four on.
- **`is_star_class` asks the SYSTEM, not the planet.** Its scopes are `planet ship galactic_object`,
  and the engine's own complaint says what it does with the scope:
  `is_star_class: Event target %s at %s failed to evaluate to a solar system, got %s` (binary
  40668752). So `is_star_class = sc_geocentric` on a planet means "this planet is in a system whose
  star class is sc_geocentric" - the test for *which system*, not *which body*. To test the BODY use
  `is_planet_class = pc_geocentric_earth`, and for the slot's role use `is_primary_star`.
- **A star class' `planet` block names a planet class, and a typo there is silent in-game.** That is
  what `star-class-planet-undefined` (src/lib/colonization.mjs) reports, and it is why
  `common/star_classes/**` is routed away from the button_effects schema in `src/lib/filecheck.mjs`
  (see `## Breaks`).
- **`star_gfx` is a property of the CLASS, so it generalises to every slot that class occupies.** The
  renderer chooses between the star-surface path and the class' own `entity` by reading the PLANET
  CLASS of the body in the slot, and a class is not slot-specific: vanilla puts `pc_t_star`
  (`star_gfx = no`) in the SECOND slot of `sc_binary_10` (`00_star_classes.txt:515-518`) and the THIRD
  of `sc_trinary_4` (`:675-678`), and `great_wound_system` puts `pc_black_hole` in ten secondary slots
  and they render. So `star = yes` + `star_gfx = no` is not a primary-only trick - it is what any
  non-star-mesh class in ANY star slot needs.
- **A star-slot colony is an ordinary colony; districts, habitability, size and the colony panel come
  from the planet class, exactly as on any planet.** The evidence is the two mods: `pc_geocentric_earth`
  sets `planet_size = 100`, `district_set = standard`, `starting_district = district_city`,
  `moon_size = 1` and is the empire's `starting_planet` (`zz_geocentric_initializers.txt:234`), and the
  origin plays as a normal homeworld; `pc_dyson_habitat_star` sets `planet_size = { min = 80 max = 80 }`,
  `district_set = habitat`, `starting_district = district_hab_housing`. Nothing in either class is a
  star-specific workaround except `star_gfx = no`. What DOES differ for a star-slot body is: it is the
  body the starbase orbits (only when it is the primary), it is what `star` / `system_star` /
  `capital_star` resolve to (only when it is the primary), and it has no external light source, so a
  planet-style mesh needs an emissive shader to be seen at all.
- **What a star class may carry** (measured over the 36): `class` 36/36 (the lighting tag, resolved to
  `gfx/worldgfx/star_<x>_class.txt`), `arkship_picture` 36/36, `spawn_odds` 27, `icon` 24 (exactly the
  15 binaries + 8 trinaries + `sc_toxoid_star`), `crisis_star_class` 11, `is_environmental_hazard` 9,
  `icon_scale` 3, `can_be_crisis_terraformed` 2 - plus, per slot, `key` and `class`. The other keys a
  star class accepts are the per-planet-class spawn-odds overrides (`pc_continental = { spawn_odds =
  0.4 }`) and a `modifier = { ... }` block, neither of which is a slot.

## Breaks

- **`star_gfx` is not mentioned anywhere in the install's planet-class field documentation.** It is a
  real engine field (literal at binary 38439624) with three users, and a body in the star slot
  normally ignores its class' `entity` and draws the star surface instead. A mod that names a
  planet-style class in a `planet = { key = ... }` slot WITHOUT `star_gfx = no` therefore gets a body
  that is present, targetable and colonisable but **invisible**. Both of this project's mods shipped
  this defect and both recorded the fix; `pc_dyson_habitat_star`'s own comment
  (`dysonhab_planet_classes.txt:6-16`) names it *"REQUIRED, and the reason the model was invisible"*,
  and cites the user-verified fix on `pc_geocentric_earth`.
- **The engine names stars `1..n` and vanilla's naming table stops at 3.** `STAR_NAME_%i_OF_%i` is
  generic, so a fourth star in a system has no localisation key in any shipped language: whatever the
  engine does with an unresolved key, it is not a name. `great_wound_system` avoids this by naming all
  eleven of its black holes explicitly (`name = "NAME_Subspace_Rupture_N"`), which is what a mod
  with more than three stars has to do too. This is a NAMING limit and **not** a slot limit - the
  engine happily created eleven.
- **`common/star_classes/**` was checked as a `common/button_effects` file.** `isButtonEffectsFile` in
  `src/lib/filecheck.mjs` claims every path under `common/`, so before `isStarClassesPath` existed a
  star class was asked for an `effect` block it was never supposed to have. Measured:
  `<mods>\dyson_habitat_cluster\common\star_classes\zz_dysonhab_star_classes.txt:8`
  reported `button-effect-without-effect` at **ERROR** severity, and in this project's own
  `geocentric_origin` the same rule counted **201** false errors over the mod's `common/` tree before
  the route existed and **200** after - the star class was one of them. The route is now the same one
  ship sizes, planet classes, asteroid belts and system initializers take, and `scripts/selftest.mjs`
  asserts the finding is gone.
- **"The install's own geocentric easter egg uses this route" is FALSE, and this project's mod
  documentation said it.** `init_sol_geocentric` (`sol_initializers.txt:3659`) is `class = "sc_g"` and
  writes **no star block at all** - its `pc_nuked` "Earth" sits at `orbit_distance = 0.01` around the
  real `pc_g_star` star the class placed, so that system is a normal system with a normal star and an
  unusual innermost planet. What the easter egg supplied is the ORBIT ARITHMETIC (the Moon at 12,
  Earth at 0.01) and the anomaly that re-classes the system later
  (`events/anomaly_events_4.txt:4987`). The star-slot route this project uses has **no vanilla
  precedent**: no vanilla star class names a colonisable class, and none of the install's 67 slots is
  colonisable.
- **A reader that requires the per-slot `class` - or the opening `{` at end of line - silently reads
  only part of the slot table.** All 54 multi-line vanilla slots write `class`; all 13 one-line slots
  omit it. Requiring `class` loses the 13 single-slot classes; requiring the brace at end of line
  loses the SAME 13, so a reader that does either reports 54 of the install's 67 slots. Both errors are
  silent - they lose rows, not add them - which is why the selftest pins **67** and the distribution
  **13/15/8** rather than a total, and why `src/lib/colonization.mjs`'s `starSlotBlocks` reads both
  forms.
- **An initializer with no `class` at all is legal.** Five vanilla initializers have none
  (`grand_archive_initializers.txt:2-45`) because an `inline_script` injects
  `class = sc_black_hole`. So "the initializer must name a star class" is not a checkable rule from a
  file, and the engine's own `System initializer: %s. Star class is not specified.` (binary 38905688)
  fires on the MERGED block, not on the file text.

## 待确认

- **Whether writing ONE star body against a TWO-slot star class gives two stars or one.** The two
  measured ends of this are `init_sol_geocentric` (ZERO bodies, `sc_g`'s one slot still placed - the
  class supplies the star) and `great_wound_system` (ELEVEN bodies against one slot - all eleven
  exist). Both are consistent with "the initializer's star bodies override the class' slots
  positionally and any surplus is additional", which predicts two stars for one body against a
  two-slot class - but no vanilla file, and neither of this project's mods, writes that shape, so it
  is untested. It is also the shape a mod would use to convert a binary class into a single-star
  system, which is why it is recorded rather than guessed.
- **ANSWERED 2026-10-06 - whether a `class = star` block past the first consumes the next slot's
  `key`, or always slot 1. It consumes the next slot: the assignment is POSITIONAL.** This was an
  open item because the design says positional (the class declares an ORDERED list and every trinary
  initializer writes three `class = star` blocks whose names differ) but no FILE proves it - a star's
  planet class is not visible in any script output. The accretion-disk probe settled it with two
  visually different classes: `sc_accretion` declares slot 1 `pc_black_hole` and slot 2 `pc_g_star`,
  the initializer writes its two `class = star` blocks in that order, and the user saw **one black
  hole and one yellow star** with the starbase on the black hole - a "both take slot 1" engine would
  have drawn two black holes. What is still NOT proven is the neighbouring case (one body against a
  two-slot class) below.
- **The hard maximum number of star slots.** Vanilla reaches 3 in its star classes and 11 in one
  initializer (`great_wound_system`), so there is no evidence of a cap at 3 - but there is no evidence
  of NO cap either. I found no "too many stars" error string in `stellaris.exe` (searched for
  `star_[0-9]`, `star_slot`, `star_count`, `star_index`, `secondary_star`: 0 hits), and no
  `num_stars`-style per-system trigger, so 11 is a measured lower bound and nothing more. Vanilla's
  naming table (`STAR_NAME_%i_OF_%i` with only n = 1, 2, 3 localised in all eleven languages) is the
  only number in the install that stops at three, and it is a naming limit.
- **Whether a fourth star with no `STAR_NAME_4_OF_n` key renders a name or an empty label** is not
  established: it needs a run with a 4-slot star class, and this round did not launch the game.
- **Whether a colonisable SECONDARY star slot behaves exactly like a colonisable primary.** The
  mechanism is per-slot and identical (the same `planet = { key = ... }` block, the same
  `class = star` in the initializer), and a star-slot body is an ordinary planet once created - but
  **no vanilla initializer and neither of this project's mods puts a colonisable class in a secondary
  slot**, so the specific interaction (colonise order timing, whether the outpost's
  `is_primary_star = yes` gate delays ownership, the colony panel) is inferred from those two facts
  rather than observed. The two mods are the natural experiment and both use exactly one star slot.
  The accretion-disk probe did NOT answer it either: its colonisable world is an ordinary planet
  between the two stars, deliberately outside the star slots, so a colonisable class in a SECONDARY
  slot remains untested.
- **What `star_gfx` defaults to and what it does when there is no `gfx/worldgfx/star_<class>.txt` for
  the class.** Vanilla's three users all set `no`, and eleven of the fourteen `star = yes` classes
  leave it unset and use a star entity - so "unset means the star-surface path" is the reading the
  mods' user-verified fix supports, but the field is absent from the install's field documentation and
  I did not find it in `logs/script_documentation/`.
- **What the star class' `icon` field does at runtime.** The 24 uses (six distinct names) resolve to
  `gfx/map/star_classes/<name>.dds` by the engine's own format string (binary 39679856) and all six
  files exist, but those names occur in no `.gfx` - only as `.dds` filenames - so which UI reads them
  (galaxy map, system view, a tooltip) is not established.
- **Why `star_ed_class.txt` (`world = ed_star`) exists.** No star class in 4.4.6 names `ed_star`, and
  `ed_star` occurs in no other file: it is an orphan in this install, and whether a DLC or an older
  revision used it is not established.
- **Where a star-slot body's size comes from when the class and the initializer disagree.** Alpha
  Centauri's stars set `size = 32 / 27 / 15` while `pc_g_star`'s class says `planet_size = { min = 20
  max = 35 }`; both are written and the initializer's value is the one in the file, but which one the
  engine keeps is not measured.
