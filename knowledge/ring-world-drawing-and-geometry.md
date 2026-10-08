---
id: ring-world-drawing-and-geometry
category: drawing
title: A ring world is DRAWN per segment - twelve `ringworld = yes` planet classes, each one an arc mesh on a radius set by `change_orbit` - and NOT by any system-level ring object
title_zh: 环世界是逐段绘制的——十二个 `ringworld = yes` 行星类，每段是一段弧形网格，半径由 `change_orbit` 决定；脚本层没有任何"星系级环形物体"
summary: The ring a player sees is TWELVE ordinary planets, each whose planet class carries `ringworld = yes` and whose `entity` is one 30-degree ARC mesh at authoring radius 450 (`ringworld_habitable.mesh`, `ringworld_seam.mesh`, `ringworld_tech.mesh` and their `_damaged` forms). There is no system-level ring: `gfx/worldgfx/` has one ring-named file and it is a species-customisation camera pose, and the only FULL-ring meshes (`ringworld_01_damaged_full.mesh`, `ringworld_destroyed.mesh`) belong to the RUINED MEGASTRUCTURE sections, not to the intact ring. The radius is the `change_orbit = 45` before the segments (a 30-degree arc on a radius-450 circle is 235.6 units, and the segment meshes measure 235-248); the segment count is how many `planet = { class = pc_ringworld_* }` blocks the file writes (Sanctuary 12, Cybrex 12, the machine Fallen Empire 9, the Shattered Ring 6 of 12). Four complete vanilla rings all declare `orbit_angle = 30` and still render as four rings, so the declared angle is NOT what spreads the segments - and a mod can place them explicitly: the Shattered Ring's own repair effect writes `orbit_angle` -30/0/30. Both examples the user named are measured in full: `origin_shattered_ring` (破碎之环) with `shattered_ring_start`, and `sanctuary_system` (the identifier behind 保护地; 避难所 in the shipped Chinese).
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.txt, .asset, .gfx, .mesh, .yml]
tags: [ringworld, ring_world, pc_ringworld_habitable, pc_ringworld_seam, pc_ringworld_tech, pc_shattered_ring_habitable, pc_cybrex, shattered_ring_start, sanctuary_system, origin_shattered_ring, is_ringworld, ring_world_built, ring_world_ruined, orbit_angle, orbit_distance, change_orbit, orbit_angle_offset, spawn_planet, entity, pdxmesh, mesh, gfx, PdxMeshRingworldClouds, per-segment, census, mod-recipe, measured-negative]
related: [ring-worlds-habitats-and-what-is-colonizable, star-slots-in-multi-star-systems, asteroids-and-asteroid-belts, animated-portrait-route, portrait-formats-and-recipe, black-hole-primary-star-system]
sources: [<Stellaris>/common/governments/civics/00_origins.txt, <Stellaris>/common/solar_system_initializers/federations_initializers.txt, <Stellaris>/common/solar_system_initializers/pre_ftl_initializers.txt, <Stellaris>/common/solar_system_initializers/crisis_initializers.txt, <Stellaris>/common/solar_system_initializers/fallen_empire_initializers.txt, <Stellaris>/common/solar_system_initializers/distant_stars_initializers.txt, <Stellaris>/common/solar_system_initializers/prescripted_species_systems.txt, <Stellaris>/common/solar_system_initializers/utopia_initializers.txt, <Stellaris>/common/planet_classes/00_planet_classes.txt, <Stellaris>/common/planet_classes/01_planet_classes_apocalypse.txt, <Stellaris>/common/planet_classes/00_planet_classes_distant_stars.txt, <Stellaris>/common/megastructures/00_ring_world.txt, <Stellaris>/common/scripted_effects/federations_event_effects.txt, <Stellaris>/common/scripted_effects/00_scripted_effects.txt, <Stellaris>/common/scripted_triggers/00_scripted_triggers.txt, <Stellaris>/common/districts/04_ringworld_districts.txt, <Stellaris>/gfx/models/planets/_planetary_entities.asset, <Stellaris>/gfx/models/planets/_planetary_meshes.gfx, <Stellaris>/gfx/models/planets/ringworld_habitable.mesh, <Stellaris>/gfx/models/planets/ringworld_seam.mesh, <Stellaris>/gfx/models/planets/ringworld_tech.mesh, <Stellaris>/gfx/models/planets/ringworld_01_damaged_full.mesh, <Stellaris>/gfx/models/planets/ringworld_destroyed.mesh, <Stellaris>/gfx/worldgfx/customization_view_ringworld.txt, <Stellaris>/common/defines/00_defines.txt, <Stellaris>/localisation/english/name_lists/common_names_l_english.yml, <Stellaris>/localisation/english/name_lists/initializers_names_l_english.yml, <Stellaris>/stellaris.exe, "%USERPROFILE%/Documents/Paradox Interactive/Stellaris/logs/error.log"]
---

## The verdict in one paragraph

**环形世界没有"星系级的环"。** What the player sees as a ring is **twelve ordinary PLANET objects**,
and each one is drawn by its own planet class' `entity` - a **30-degree ARC mesh** authored on a
circle of radius **450**:

* a `planet = { class = pc_ringworld_habitable }` block in a
  `common/solar_system_initializers/**` file **is** a segment. The class carries `ringworld = yes`
  (`00_planet_classes.txt:1372`) and `entity = "ringworld_habitable_entity"` (`:1373`), which the
  asset file defines as `pdxmesh = "ringworld_habitable_01_mesh"` ->
  `gfx/models/planets/ringworld_habitable.mesh` (`_planetary_entities.asset:2991-2993`,
  `_planetary_meshes.gfx:149-153`);
* the ring's **radius** is the `change_orbit` written before the segments. All seven vanilla ring
  systems write `change_orbit = 45`, and every one of their 50 segment blocks is at
  `orbit_distance = 0` on that circle (48 of the 50; the other two are the Shattered Ring's
  intentionally damaged seam at 5);
* the ring's **segment count** is how many `planet = { class = pc_ringworld_* }` blocks the file
  writes: **12** for `sanctuary_system`, **12** for `cybrex_beta`, **9** for the machine Fallen
  Empire's `fallen_machine`, **6 of 12** for the Shattered Ring;
* **`orbit_angle` is not what spreads them.** Four complete vanilla rings - Sanctuary (12),
  Cybrex (12), the machine Fallen Empire (9) and the Shattered Ring's intact half - all declare
  `orbit_angle = 30` on their segments, and **41 of the install's 50 ring blocks** do. The one place
  vanilla spreads segments BY ANGLE is the Shattered Ring's own repair effect, which writes
  `orbit_angle` -30 / 0 / 30 next to each other
  (`federations_event_effects.txt:1793`, `:1799`, `:1806`);
* the **ruined** parts are a different object type, not a damaged planet: `ring_world_ruined` is a
  **megastructure** whose `entity = "ringworld_destroyed_entity"` ->
  `gfx/models/planets/ringworld_destroyed.mesh` (`00_ring_world.txt:388-394`) - and the Shattered
  Ring's dim arcs are two of those, spawned in the initializer's own `init_effect`
  (`federations_initializers.txt:1920-1932`).

A ring world is therefore a **picture assembled from planet objects**, and every knob a mod has -
radius, segment count, which arc each segment is, colonisability, districts - is a field on an
initializer block or on a planet class. **There is no field that draws a ring.**

## Syntax

```
# ---------------------------------------------------------------------------------------
# 1. THE CLASS CHAIN. A segment is a planet class; `entity` is what is DRAWN.
#    common/planet_classes/00_planet_classes.txt:1371
#    -> gfx/models/planets/_planetary_entities.asset:2991
#    -> gfx/models/planets/_planetary_meshes.gfx:149
# ---------------------------------------------------------------------------------------
pc_ringworld_habitable = {                      # :1371  THE habitable segment
	ringworld = yes                             # :1372  <-- what `is_ringworld` reads
	entity = "ringworld_habitable_entity"       # :1373  -> an ENTITY, not a mesh
	preview_entity = "ringworld_01_damaged_full_entity"   # :1374  the MEGASTRUCTURE preview art
	picture = pc_ringworld                       # :1375  the planet-view backdrop
	icon = GFX_planet_type_ringworld            # :1376
	icon_large = GFX_planet_type_ringworld_big  # :1377
	entity_scale = 1.0                          # :1378
	enable_tilt = no                            # :1379  a ring has no axial tilt to show
	fixed_entity_scale = yes                    # :1380  <-- the segment is NOT sized by `size`
	atmosphere_color = hsv { 0.0 0.0 1.0 }      # :1381  a SCALAR BLOCK VALUE (see `## Breaks`)
	show_city = yes                             # :1384
	extra_orbit_size = 0                        # :1386  <-- and NOTHING here adds ring geometry
	extra_planet_count = 0                      # :1387
	chance_of_ring = 0.0                        # :1388
	planet_size = 10                            # :1389  the COLONY size, not the drawn size
	moon_size = 1                               # :1390
	colonizable = yes                           # :1391  <-- the ONE ring class a player can colonise
	district_set = ring_world                    # :1392
	starting_district = district_rw_city         # :1393
	orbit_lines = no                             # :1396  <-- suppress the orbit line through the ring
	climate = "artificial"                       # :1399
	is_artificial_planet = yes                   # :1400
}
# The other SEVEN segment classes are the same block with three fields changed - which entity, which
# `colonizable`, which `district_set`:
#   pc_ringworld_habitable_damaged  :1415  entity = "ringworld_habitable_damaged_entity"  colonizable = no
#   pc_ringworld_tech               :1438  entity = "ringworld_tech_entity"               colonizable = no
#   pc_ringworld_tech_damaged       :1463  entity = "ringworld_tech_damaged_entity"       colonizable = no
#   pc_ringworld_seam               :1489  entity = "ringworld_seam_entity"               colonizable = no
#   pc_ringworld_seam_damaged       :1515  entity = "ringworld_seam_damaged_entity"       colonizable = no
#   pc_shattered_ring_habitable     :1541  entity = "ringworld_habitable_entity"  size 25, district_set shattered_ring_world
#   pc_cybrex                       :999   entity = "ringworld_habitable_entity"  colonizable = no, `show_city = no`
#   pc_ringworld_shielded            01_planet_classes_apocalypse.txt:5  entity = "ringworld_habitable_entity"
# ...and TWO more classes carry `ringworld = yes` without being a segment of this shape:
#   pc_egg_cracked                   00_planet_classes_distant_stars.txt:34  entity = "shattered_infected_planet"
#     (the Distant Stars "cracked egg", which has its own entity and is NOT drawn as a ring)
#
# TEN classes in the install carry `ringworld = yes`. `fixed_entity_scale = yes` also appears on
# pc_habitat, pc_cosmogenesis_world, pc_crystal_habitat, pc_warden_guardian, pc_habitat_shielded
# and pc_ringworld_shielded - fourteen classes in all - so it is the "an artificial object is not
# sized by its planet_size" switch, not a ring switch.

# ---------------------------------------------------------------------------------------
# 2. THE ENTITY AND THE MESH. `entity` -> a `.asset` entity -> a `pdxmesh` -> a `.mesh` file.
#    gfx/models/planets/_planetary_entities.asset:2991-3029
# ---------------------------------------------------------------------------------------
entity = {
	name = "ringworld_habitable_entity_01_entity"   # :2991
	cull_radius = 500.0                             # :2992
	pdxmesh = "ringworld_habitable_01_mesh"         # :2993  -> ringworld_habitable.mesh (180,301 bytes)

	default_state = "idle"                          # :2995 a segment has an IDLE state, unlike a planet
	state = { name = "idle" state_time = 100 time_offset = { 0 100 }
		start_event = { trigger_once = yes sound = { soundeffect = "ringworld_hum_idle_01" stop_on_state_change = yes } }
	}
	state = { name = "construction" start_event = { ... "ringworld_construction_ambient" } }

	meshsettings = {                                # :3005  THE STRUCTURE
		name = "pCube20Shape"
		texture_diffuse = "ringworld_habitable_diffuse.dds"
		texture_normal = "ringworld_habitable_normal.dds"
		texture_specular = "ringworld_habitable_specular.dds"
		shader = "PdxMeshTerra"
	}
	meshsettings = {                                # :3014  THE LAND on the inside of the arc
		name = "polySurface9Shape"
		texture_diffuse = "continental_01_diffuse.dds"
		shader = "PdxMeshTerra"
	}
	game_data = {
		size = @ringworld_segment_size               # :3024  the PLANET-VIEW size: @ringworld_segment_size = 50 (:2904)
		shader_type = ship
	}
	attach = { root = "ringworld_habitable_entity_01_clouds_entity" }   # :3028
}
entity = {                                          # :3032 the CLOUD layer, a separate entity
	name = "ringworld_habitable_entity_01_clouds_entity"
	pdxmesh = "ringworld_habitable_01_clouds_mesh"   # -> ringworld_habitable_clouds.mesh (21,914 bytes)
	meshsettings = { shader = "PdxMeshRingworldClouds" }   # :3045/:3054 TWO meshsettings, one shader
	game_data = { size = @ringworld_segment_size  uv_animation_speed = 0.004  uv_animation_direction = { 1.0 0.0 } }
}
# The arc meshes, all declared in ONE file (gfx/models/planets/_planetary_meshes.gfx):
#   :149  ringworld_habitable_01_mesh         file = "gfx/models/planets/ringworld_habitable.mesh"       cull_distance = 999999999.0f
#   :155  ringworld_habitable_01_clouds_mesh  file = ".../ringworld_habitable_clouds.mesh"
#   :161  ringworld_habitable_damaged_01_mesh file = ".../ringworld_habitable_damaged.mesh"
#   :167  ringworld_seam_01_mesh              file = ".../ringworld_seam.mesh"
#   :173  ringworld_seam_damaged_01_mesh      file = ".../ringworld_seam_damaged.mesh"
#   :179  ringworld_tech_01_mesh              file = ".../ringworld_tech.mesh"
#   :185  ringworld_tech_damaged_01_mesh      file = ".../ringworld_tech_damaged.mesh"
#   :217  ringworld_construction_mesh         shader = "PdxMeshShip"
#   :234  ringworld_destroyed_mesh            <- the RUINED MEGASTRUCTURE's full ring
#   :252  ringworld_01_damaged_full_mesh      <- the megastructure PREVIEW, two meshsettings on one shape
#
# THE AUTHORING RADIUS IS 450, MEASURED FROM THE MESH FILES THEMSELVES (the `aabb` min/max box of
# each binary's first mesh entry, read with a scratch reader - see `## Evidence`):
#   ringworld_habitable.mesh         box 246 x 58 x 88    ringworld_seam.mesh    box 239 x 61 x 33
#   ringworld_tech.mesh              box 248 x 56 x 84    ringworld_seam_construction.mesh box 239 x 61 x 33
#   ringworld_habitable_clouds.mesh  box 225 x 42 x 16
# An ORDINARY planet mesh is 10 units across: planet_clouded.mesh's boxes are 10.39 / 7.58 / 8.90 /
# 9.11 / 9.29. A 30-degree arc on a radius-450 circle is 2*450*sin(15) = 232.9 units of chord and
# 2*pi*450*(30/360) = 235.6 units of arc, and the segments measure 235-248 - i.e. the meshes are
# authored on the SAME 450-unit circle the game places them on at `orbit_distance = 45`.
```

```
# ---------------------------------------------------------------------------------------
# 3. EXAMPLE (a): THE SHATTERED RING. `origin_shattered_ring` -> `shattered_ring_start`.
#    common/governments/civics/00_origins.txt:1872 and
#    common/solar_system_initializers/federations_initializers.txt:1908
# ---------------------------------------------------------------------------------------
origin_shattered_ring = {                        # 00_origins.txt:1872  破碎之环 / "Shattered Ring"
	is_origin = yes                              # :1873
	icon = "gfx/interface/icons/origins/origins_shattered_ring.dds"   # :1874
	picture = GFX_origin_shattered_ring          # :1875
	starting_colony = pc_shattered_ring_habitable      # :1877  THE COLONY IS A RING SECTION
	habitability_preference = pc_shattered_ring_habitable  # :1878
	initializers = { shattered_ring_start }      # :1879
	max_once_global = yes                        # :1880
	non_colonizable_planet_class_neighbor = yes  # :1881
	playable = { host_has_dlc = Federations }    # :1884
	description = "origin_tooltip_shattered_ring_effects"   # :1901
}

shattered_ring_start = {                         # federations_initializers.txt:1908
	flags = { empire_home_system ring_world_built shattered_ring_system }   # :1909
	usage = origin                               # :1910

	init_effect = {                              # :1912  THE RUINED HALF IS DRAWN BY MEGASTRUCTURES
		every_neighbor_system = { set_star_flag = empire_cluster ... }       # :1913-1918
		generate_home_system_resources = yes     # :1919
		spawn_megastructure = {                  # :1920  RUINED arc 1 of 4
			type = "ring_world_ruined"           #        -> entity "ringworld_destroyed_entity"
			orbit_angle = 0                      # :1922
			orbit_distance = 45                  # :1923  <-- THE RING RADIUS
			init_effect = { set_megastructure_flag = guaranteed_1 }
		}
		spawn_megastructure = { type = "ring_world_ruined"  orbit_angle = 180  orbit_distance = 45 }   # :1928
	}

	class = "sc_g"                               # :1935
	planet = { class = star orbit_distance = 0 orbit_angle = 0 }             # :1936

	change_orbit = 45                            # :1942  <-- THE RING RADIUS for every segment below

	planet = { class = "pc_ringworld_tech"          name = "NAME_Ring_Section"  orbit_angle = 240  orbit_distance = 0 }   # :1944
	planet = { class = "pc_ringworld_seam"          name = "NAME_Ring_Section"  orbit_angle = 30   orbit_distance = 0 }   # :1951
	planet = {                                       # :1958  THE STARTING COLONY
		class = "pc_shattered_ring_habitable"        #        the ONLY colonisable class here
		orbit_angle = 30
		orbit_distance = 0
		deposit_blockers = none
		modifiers = none
		starting_planet = yes                        # :1964
		flags = { ignore_startup_effect megastructure }
		init_effect = { prevent_anomaly = yes }
	}
	planet = { class = "pc_ringworld_tech_damaged"  name = "NAME_Ring_Section"  orbit_angle = 120  orbit_distance = 0 }   # :1971
	planet = {                                       # :1978  the RESEARCH target
		class = "pc_ringworld_seam_damaged"
		name = "NAME_Irreparable_Damage"             # "Catastrophic Damage" (common_names_l_english.yml:56)
		orbit_angle = 30
		orbit_distance = 0
		flags = { ignore_startup_effect starting_mining_target starting_deposit catastrophic_damage }
		init_effect = {
			create_ambient_object = { type = "medium_debris_01_object" entity_offset_height = -15 location = this }
			last_created_ambient_object = { ... set_ambient_object_flag = interloper_damage }
			set_deposit = d_engineering_5              # :1999
			set_carrier_flag = starting_research_target
		}
	}
	planet = {                                       # :2005  THE INTERLOPER, a non-ring body
		class = "pc_shattered_2"
		name = "NAME_The_Interloper"
		orbit_distance = -5                          # RELATIVE to the previous body (the seam at 45) -> 40
		orbit_angle = 0
		size = 5
		has_ring = no
		init_effect = { set_deposit = d_minerals_10 }
	}
	planet = { class = "pc_ringworld_seam_damaged"  name = "NAME_Ring_Section"  orbit_angle = 30  orbit_distance = 5 }    # :2018
	neighbor_system = { trigger = { num_guaranteed_colonies >= 2 } initializer = "neighbor_t1" ... }   # :2024-2033
}
# SIX ring planet blocks and TWO ruined megastructure arcs: 8 of the ring's 12 slots have something
# in them, and the ring STARTS BROKEN - 3 intact sections (tech 240, seam 30, habitable 30) and 3
# damaged (tech_damaged 120, seam_damaged 30 "Irreparable Damage", seam_damaged 30 at +5).
# `pre_ftl_shattered_ring` (pre_ftl_initializers.txt:1352) is the SAME system, one line later, for
# the pre-FTL version of the origin: identical angles, identical radii, identical classes.
# The origin is `Federations`-gated (`:1884`) and `max_once_global` (`:1880`).
```

```
# ---------------------------------------------------------------------------------------
# 4. EXAMPLE (b): SANCTUARY. `sanctuary_system` - the identifier behind 保护地.
#    common/solar_system_initializers/pre_ftl_initializers.txt:644
# ---------------------------------------------------------------------------------------
sanctuary_system = {                             # :644   "### The Sanctuary" is the comment above it
	asteroid_belt = { type = rocky_asteroid_belt  radius = 150 }   # :645  the ring AND a belt
	usage = misc_system_init                         # :649
	usage_odds = { base = @spawn_system_common  inline_script = "solar_system_initializers/initializer_modifiers_habitable_world_systems" }   # :650
	max_instances = 1                                # :654
	primitive_system = yes                           # :655  "usage odds modified by primitives setup slider"
	flags = { sanctuary_system ring_world_built ancient_wonders_system }   # :657
	scaled_spawn_chance = 2                          # :658
	name = "NAME_Sanctuary"                          # :660
	class = "sc_g"                                   # :662

	planet = {                                       # :664  THE STAR - and the system's OWNER
		class = star
		orbit_distance = 0
		init_effect = {
			create_country = { name = "NAME_Sanctuary" type = faction }   # :669  a real COUNTRY
			last_created_country = {
				save_global_event_target_as = sanctuary                       # :674
				create_fleet = { ... create_ship = { design = "NAME_Sanctuary_Core" graphical_culture = "fallen_empire_03" } }   # :680
				add_modifier = { modifier = sanctuary_power  days = -1 }      # :690
				save_event_target_as = sanctuary_core
				set_fleet_flag = sanctuary_core
				# ...then FOUR defensive stations at distance 8, angles 90/180/270/0 (:698-761)
			}
		}
	}

	change_orbit = 45                                # :766  <-- THE RING RADIUS, same 45 as everywhere

	planet = { class = "pc_ringworld_habitable"  name = "NAME_Sanctuary_A"  orbit_angle = 30  orbit_distance = 0 ... }  # :768
	planet = { class = "pc_ringworld_tech"       name = "NAME_Sanctuary-B"  orbit_angle = 30  orbit_distance = 0 ... }  # :801
	planet = { class = "pc_ringworld_seam"       name = "NAME_Sanctuary-C"  orbit_angle = 30  orbit_distance = 0 ... }  # :824
	planet = { class = "pc_ringworld_habitable"  name = "NAME_Sanctuary-D"  orbit_angle = 30  orbit_distance = 0 ... }  # :847
	planet = { class = "pc_ringworld_tech"       name = "NAME_Sanctuary-E"  orbit_angle = 30  orbit_distance = 0 ... }  # :880
	planet = { class = "pc_ringworld_seam"       name = "NAME_Sanctuary-F"  orbit_angle = 30  orbit_distance = 0 ... }  # :903
	planet = { class = "pc_ringworld_habitable"  name = "NAME_Sanctuary-G"  orbit_angle = 30  orbit_distance = 0 ... }  # :926
	planet = { class = "pc_ringworld_tech"       name = "NAME_Sanctuary-H"  orbit_angle = 30  orbit_distance = 0 ... }  # :959
	planet = { class = "pc_ringworld_seam_damaged" name = "NAME_Sanctuary-I" orbit_angle = 30 orbit_distance = 0      # :982
		init_effect = { create_ambient_object = { type = "medium_debris_01_object" location = THIS } } }   # the ONE broken section
	planet = { class = "pc_ringworld_habitable"  name = "NAME_Sanctuary-J"  orbit_angle = 30  orbit_distance = 0 ... }  # :995
	planet = { class = "pc_ringworld_tech"       name = "NAME_Sanctuary-K"  orbit_angle = 30  orbit_distance = 0 ... }  # :1028
	planet = { class = "pc_ringworld_seam"       name = "NAME_Sanctuary-L"  orbit_angle = 30  orbit_distance = 0 ... }  # :1051

	change_orbit = 105                               # :1075  the rocks live OUTSIDE the ring
	planet = { count = { min = 1 max = 4 } class = pc_asteroid ... }   # :1077
}
# WHAT MAKES IT SPECIAL is in the four habitable blocks, and it is not the ring:
#   * each carries `deposit_blockers = none` / `modifiers = none` / `prevent_anomaly = yes` and
#     `generate_early_pre_ftls_on_planet = yes` (:798, :877, :956, :1025) - Sanctuary is the
#     primitives-preserve system, and the primitives are generated on the RING SECTIONS;
#   * each habitable block also spawns its own `NAME_Defensive_A_1` fleet at distance 1 from the
#     section (:780-795), while the tech and seam blocks spawn `NAME_Defensive_A_2` (:808-821);
#   * the star's block creates the guardian COUNTRY (`create_country = { type = faction }`, :669),
#     a named core ship (`NAME_Sanctuary_Core`, :682) with `modifier = sanctuary_power` (:691)
#     and four defensive stations (:698-761);
#   * `primitive_system = yes` (:655) is what ties its spawn odds to the primitives galaxy slider,
#     and `scaled_spawn_chance = 2` (:658) scales by galaxy size;
#   * the ring is INTACT except section I, which is `pc_ringworld_seam_damaged` and carries a
#     `medium_debris_01_object` ambient object (:989-992).
# The shipped Chinese calls it 避难所 ("refuge", initializers_names_l_simp_chinese.yml:400); the
# Russian calls it Заповедник ("nature reserve", :400 in the Russian file), which is the sense the
# user's 保护地 ("protected area") was reaching for. The identifier is `sanctuary_system`.
```

```
# ---------------------------------------------------------------------------------------
# 5. HOW A COMPLETE RING IS BUILT - the megastructure is the SCAFFOLD, and each of its four
#    sections spawns THREE planet segments when it completes. common/megastructures/00_ring_world.txt
# ---------------------------------------------------------------------------------------
ring_world_2_intermediate.on_build_complete = {  # :183   the stage that clears the system
	every_system_planet = { limit = { is_star = no } remove_planet = yes }   # :184-187  <-- WIPES THE SYSTEM
	set_asteroid_belt = { radius = 0 }           # :188-190  <-- the belt is zeroed, not removed
	remove_megastructure = fromfrom              # :192
	spawn_megastructure = { name = "NAME_Ring_Section_A"  type = "ring_world_2"  orbit_angle = 0    orbit_distance = 45  owner = from  planet = star }   # :193
	spawn_megastructure = { ... orbit_angle = 90  ... }    # :202
	spawn_megastructure = { ... orbit_angle = 180 ... }    # :211
	spawn_megastructure = { ... orbit_angle = 270 ... }    # :220   <- FOUR scaffold sections, 90 apart
}
ring_world_3_intermediate.on_build_complete = {  # :284   the stage that turns ONE of them into planets
	spawn_planet = { class = "pc_ringworld_tech"       location = fromfrom  orbit_angle_offset = 30   ... }  # :290
	spawn_planet = { class = "pc_ringworld_seam"       location = fromfrom                              ... }  # :308
	spawn_planet = { class = "pc_ringworld_habitable"  location = fromfrom  orbit_angle_offset = -30  ... }  # :325
	fromfrom.planet = { set_carrier_flag = has_megastructure }   # :346
	remove_megastructure = fromfrom              # :349  <-- the site is GONE, the planets remain
	# ...then A/B/C/D naming by the star flags ring_section_1..3                                          # :350-383
}
# 4 scaffold sections x 3 spawned planets = 12, and the offsets are -30 / 0 / +30 OF THE SCAFFOLD'S
# ANGLE - i.e. the three segments fill one 90-degree quadrant at 30-degree steps. The repair path is
# the same code twice: `ring_world_restored.on_build_complete` (:470-533) is a copy of stage 3, and
# `spawn_shattered_ring_guaranteed_1_effect` / `_2_effect`
# (common/scripted_effects/federations_event_effects.txt:1789 and :1822) is the same three-segment
# pattern as an effect, with `orbit_angle` -30 / 0 / 30 and `orbit_distance = 45` written out.
```

```
# ---------------------------------------------------------------------------------------
# 6. WHAT A MOD ACTUALLY WRITES. The segment count and the radius are initializer fields, and that
#    is the whole mod-facing surface for the SHAPE.
# ---------------------------------------------------------------------------------------
# (a) A RING AT GAME START: a complete ring is 12 segments at `orbit_distance = 0` on a `change_orbit`
#     radius. Sanctuary is the smallest complete vanilla example - copy its twelve `planet` blocks.
ring_system = {
	class = "sc_g"
	flags = { ring_world_built }
	planet = { class = star orbit_distance = 0 }
	change_orbit = 45                            # <-- THE RADIUS (45 in every vanilla ring)
	planet = { class = "pc_ringworld_habitable" orbit_angle = 30 orbit_distance = 0 }
	planet = { class = "pc_ringworld_tech"      orbit_angle = 30 orbit_distance = 0 }
	planet = { class = "pc_ringworld_seam"      orbit_angle = 30 orbit_distance = 0 }
	# ...nine more, any order
}

# (b) A RUINED / PARTIAL RING - TWO different objects, and vanilla uses both:
#     * the RUINED arcs are MEGASTRUCTURE sections (`ring_world_ruined`, `00_ring_world.txt:388`),
#       spawned from the initializer's own `init_effect` (`federations_initializers.txt:1920`);
#     * the REST of a partial ring is DAMAGED PLANET CLASSES (`pc_ringworld_tech_damaged`,
#       `pc_ringworld_seam_damaged`, `pc_ringworld_habitable_damaged`) - the classes a
#       planet-killer swaps in when it cracks a segment
#       (`00_scripted_effects.txt:4572`, `:4593`, `:4598`, `:4603`).
#     A GAP is expressed by writing FEWER blocks. Nothing requires 12: the install ships rings of
#     12, 12, 9, 6, 6, 3 and 2 segments and two rings of ZERO (all megastructure ruins:
#     `cybrex_system`, prescripted_species_systems.txt:1928, and `ring_world_init_01`,
#     utopia_initializers.txt:819).
probe_partial_ring = {
	flags = { ring_world_built }
	class = "sc_g"
	planet = { class = star orbit_distance = 0 }
	change_orbit = 45
	planet = { class = "pc_ringworld_habitable" orbit_angle = 30  orbit_distance = 0 }
	planet = { class = "pc_ringworld_tech_damaged" orbit_angle = 120 orbit_distance = 0 }
	planet = { class = "pc_ringworld_seam_damaged" orbit_angle = 240 orbit_distance = 0 }
	# THREE of twelve: the rest of the circle is simply not there.
}

# (c) MAKE A SEGMENT COLONISABLE - it is `colonizable` on the CLASS, and nothing else:
#     `pc_ringworld_habitable` yes (:1391), `pc_shattered_ring_habitable` yes (:1561),
#     every other ring class no. A mod's own ring class is the same block with its own `entity`,
#     `district_set` and `colonizable`. `district_set` is a free-form tag (`00_planet_classes.txt:35`)
#     and the install ships `ring_world` (`04_ringworld_districts.txt:24`) and `shattered_ring_world`
#     (`00_urban_districts.txt:26`).

# (d) CHANGE THE RADIUS - move the `change_orbit`, and keep every segment at `orbit_distance = 0`:
change_orbit = 80                                 # a radius-80 ring: the segments follow
planet = { class = "pc_ringworld_habitable" orbit_distance = 0 ... }
#     Changing ONE segment's `orbit_distance` instead is what the
#     `ringworld-segment-orbit-inconsistent` rule reports (src/lib/colonization.mjs): a segment that
#     is not on the circle the others describe. The install's own exception is the Shattered
#     Ring's `NAME_Irreparable_Damage` seam at `orbit_distance = 5`.

# (e) CHANGE THE SEGMENT COUNT - write more or fewer `planet` blocks. There is no counter to set.
#     (The visual consequence of a count that is not 12 is not measured; see `## 待确认`.)
```

```
# ---------------------------------------------------------------------------------------
# 7. WHAT A MOD CAN ASK AT RUNTIME. A segment is an ORDINARY PLANET, so it answers planet triggers.
# ---------------------------------------------------------------------------------------
is_ringworld = yes                   # the engine trigger, `planet ship` scope - `ringworld = yes` on the class
PLANET_IS_RINGWORLD                  # localisation, "Is a Ringworld" (triggers_effects_l_english.yml:138)
has_ringworld_output_boost = { is_ringworld = yes }   # common/scripted_triggers/00_scripted_triggers.txt:605-607
has_star_flag = ring_world_built     # the SYSTEM-level marker: vanilla's habitat, orbital ring and
                                     # cosmogenesis world all refuse a system that has it
                                     # (habitats.txt:157, 15_orbital_ring.txt:107, 16_cosmogenesis_world.txt:102)
# A segment is in the system's PLANET LIST (`every_system_planet`), so vanilla's own ring-aware
# scripts find it with planet triggers - `change_pc = pc_ringworld_habitable_damaged` when a
# planet-killer cracks one (00_scripted_effects.txt:4572), `limit = { is_ringworld = yes }` in the
# machine-age ring effects (02_machine_age_effects.txt:1420).
```

## Evidence

- `vanilla`, **the two examples, fully read**. Shattered Ring: `origin_shattered_ring`
  (`common/governments/civics/00_origins.txt:1872-1914`) is `starting_colony =
  pc_shattered_ring_habitable` (`:1877`), `initializers = { shattered_ring_start }` (`:1879`),
  `playable = { host_has_dlc = Federations }` (`:1884`), `max_once_global = yes` (`:1880`); its
  initializer `shattered_ring_start` (`common/solar_system_initializers/federations_initializers.txt:1908-2034`)
  declares `flags = { empire_home_system ring_world_built shattered_ring_system }` (`:1909`),
  `change_orbit = 45` (`:1942`) and SIX ring-class planet blocks - `pc_ringworld_tech` at
  `orbit_angle = 240` (`:1944`), `pc_ringworld_seam` at 30 (`:1951`), `pc_shattered_ring_habitable`
  at 30 as the `starting_planet` (`:1958-1969`), `pc_ringworld_tech_damaged` at 120 (`:1971`),
  `pc_ringworld_seam_damaged` named `NAME_Irreparable_Damage` at 30 (`:1978-2003`, with
  `set_deposit = d_engineering_5` at `:1999`) and a second `pc_ringworld_seam_damaged` at 30 with
  `orbit_distance = 5` (`:2018`) - plus the non-ring `pc_shattered_2` "Interloper" at
  `orbit_distance = -5` (`:2005-2016`) and TWO `spawn_megastructure = { type = "ring_world_ruined" }`
  at angles 0 and 180 with `orbit_distance = 45` (`:1920-1932`). Sanctuary:
  `sanctuary_system` (`common/solar_system_initializers/pre_ftl_initializers.txt:644-1090`) is
  `flags = { sanctuary_system ring_world_built ancient_wonders_system }` (`:657`), `class = "sc_g"`
  (`:662`), `primitive_system = yes` (`:655`), `scaled_spawn_chance = 2` (`:658`),
  `max_instances = 1` (`:654`), `change_orbit = 45` (`:766`) and TWELVE ring-class blocks at
  `orbit_angle = 30` / `orbit_distance = 0` - four `pc_ringworld_habitable` (`:768`, `:847`, `:926`,
  `:995`), four `pc_ringworld_tech` (`:801`, `:880`, `:959`, `:1028`), three `pc_ringworld_seam`
  (`:824`, `:903`, `:1051`) and ONE `pc_ringworld_seam_damaged` (`:982`, with a
  `medium_debris_01_object` at `:989-992`) - over a star block (`:664-764`) that creates the
  guardian country (`create_country = { name = "NAME_Sanctuary" type = faction }`, `:669`), the
  `NAME_Sanctuary_Core` ship with `modifier = sanctuary_power` (`:680-694`) and FOUR defensive
  stations at distance 8 (`:698-761`), and under an `asteroid_belt = { type = rocky_asteroid_belt
  radius = 150 }` (`:645`). Each of the four habitable blocks carries
  `generate_early_pre_ftls_on_planet = yes` (`:798`, `:877`, `:956`, `:1025`) - the primitives are
  generated ON THE RING SECTIONS - and spawns its own `NAME_Defensive_A_1` fleet (`:780-795`).
- `measured`, **the ring-body census, over all 360 vanilla initializers in 40 files**: **50**
  `planet` blocks name a `ringworld = yes` class, and they belong to exactly **7 initializers** -
  `cybrex_beta` 12 (`crisis_initializers.txt:312`), `sanctuary_system` 12, `fallen_machine` 9
  (`fallen_empire_initializers.txt:2404`), `shattered_ring_start` 6, `pre_ftl_shattered_ring` 6
  (`pre_ftl_initializers.txt:1352`), `fallen_machine_2` 3 (`fallen_empire_initializers.txt:2727`),
  `hostile_init_void_cloud` 2 (`distant_stars_initializers.txt:782`). Their declared
  `orbit_angle` histogram is **`30` x41**, `240` x3, `-30` x2, `120` x2, `130` x1, `60` x1; their
  `orbit_distance` histogram is **`0` x48** and `5` x2 (the Shattered Ring's `NAME_Irreparable_Damage`
  seam in both the origin and its pre-FTL twin). **41 of 50 write the SAME angle.**
- `vanilla` + `measured`, **the radius is 45 in every vanilla ring, and it is a `change_orbit`**:
  `shattered_ring_start` (`:1942`), `sanctuary_system` (`:766`), `fallen_machine` (`:2427`),
  `pre_ftl_shattered_ring` (`pre_ftl_initializers.txt:1390`) and `fallen_machine_2`
  (`fallen_empire_initializers.txt:2796`) all write `change_orbit = 45` after the star block; the
  repair path writes it as `orbit_distance = 45` on each spawned segment instead
  (`federations_event_effects.txt:1794`, `:1800`, `:1807`); and the megastructure's own scaffold is
  placed at `orbit_distance = 45` (`00_ring_world.txt:197`, `:206`, `:215`, `:224`), as are both
  ruined arcs of the Shattered Ring (`federations_initializers.txt:1923`, `:1931`). `cybrex_beta`
  writes `change_orbit = 45` at `crisis_initializers.txt:375` and `hostile_init_void_cloud` at
  `distant_stars_initializers.txt:874` (there at radius 100, for two damaged segments).
- `measured` / `mesh`, **the meshes are 30-degree arcs authored on a radius-450 circle** - the
  measurement that ties the geometry to the asset. Read with a scratch `aabb` reader over the
  binaries, each `ringworld_*` mesh's first mesh entry has a bounding box of
  `ringworld_habitable.mesh` 246 x 58 x 88, `ringworld_seam.mesh` 239 x 61 x 33,
  `ringworld_tech.mesh` 248 x 56 x 84, `ringworld_habitable_damaged.mesh` 246 x 57 x 88,
  `ringworld_seam_damaged.mesh` 239 x 63 x 85, `ringworld_tech_damaged.mesh` 248 x 54 x 75, and
  `ringworld_seam_construction.mesh` 239 x 61 x 33. For comparison the SAME reader on ordinary
  planet meshes returns `planet_clouded.mesh` 10.39 x 10.38 x 10.39, `planet_non_clouded.mesh`
  10.39 and `planet_no_pole_no_clouds.mesh` 10.39 - an ORDER OF MAGNITUDE smaller. A 30-degree arc on
  a radius-450 circle is 2 x 450 x sin(15 deg) = **232.9** units of chord and 235.6 of arc, and the
  measured segment widths are 235-248; at radius 45 the same arc would be 23 units and at radius 4500
  it would be 2329. The `polySurface34Shape` / `polySurface35Shape` cloud mesh measures 225 x 42 x 16.
  The full-ring meshes are in the same file and are unmistakably FULL circles:
  `ringworld_01_damaged_full.mesh`'s box is 963.68 x 61.09 x 963.68 (centred on +/-481.84) and
  `ringworld_destroyed.mesh`'s are up to 668 x 98 x 194 - i.e. **a full ring asset exists, and it
  belongs to the megastructure, not to the intact ring.**
- `vanilla`, **the entity chain, per class**, quoted: `_planetary_entities.asset:2991-3029`
  `ringworld_habitable_entity_01_entity` (`pdxmesh = "ringworld_habitable_01_mesh"`, two
  `meshsettings` - `pCube20Shape` with `ringworld_habitable_*` textures and `polySurface9Shape` with
  `continental_01_diffuse.dds` - `game_data = { size = @ringworld_segment_size  shader_type = ship }`,
  `attach = { root = "ringworld_habitable_entity_01_clouds_entity" }`, and `idle` /
  `construction` states whose `idle` state plays `ringworld_hum_idle_01` / `_02` and whose
  `construction` state plays `ringworld_construction_ambient`); `:3032-3062` the clouds entity
  (`pdxmesh = "ringworld_habitable_01_clouds_mesh"`, **two** `meshsettings` both
  `shader = "PdxMeshRingworldClouds"`, `game_data = { size = @ringworld_segment_size
  uv_animation_speed = 0.004 uv_animation_direction = { 1.0 0.0 } }`);
  `:3065-3091` `ringworld_tech_entity_01_entity` (`pdxmesh = "ringworld_tech_01_mesh"`,
  `shader = "PdxMeshTerra"`, and an `idle` state that fires `particle = "ringworld_tech_particle"`
  at nodes `tech_1` and `tech_3` every 5 seconds - the tech section is the ANIMATED one);
  `:3096-3125` `ringworld_seam_entity_01_entity` (`pdxmesh = "ringworld_seam_01_mesh"`, two
  `meshsettings` - `ringworld_seam_*` and `ringworld_construction_*` - so a seam shows the bare
  frame); `:3128-3150` `ringworld_phase_3_construction_entity`
  (`pdxmesh = "ringworld_seam_01_mesh"` with `locator = { name = "locator1" position = { -225 0 -60.289 } rotation = { -30 0 0 } }` and `locator2` mirrored, and `attach = { locator1 =
  "ringworld_habitable_entity_01_entity"  locator2 = "ringworld_tech_entity_01_entity" }` - the
  BUILDING site composes a habitable and a tech section);
  `:7747-7766` the three `_damaged` entities (each a bare `pdxmesh` with **no** `meshsettings`, no
  states and no textures - they render the mesh's own materials);
  `:3372-3414` `ringworld_destroyed_entity` (`pdxmesh = "ringworld_destroyed_mesh"`, five
  `meshsettings` on `ringworld_habitable_damagedShape` / `ringworld_tech_damagedShape`, including
  `texture_diffuse = "barren_01_diffuse.dds"` on index 0);
  `:7768-7772` `ringworld_01_damaged_full_entity` (`pdxmesh = "ringworld_01_damaged_full_mesh"`,
  **`scale = 0.01`**); `:2904` `@ringworld_segment_size = 50`; `:2931-2967`
  `ringworld_3x_seams_entity` (`pdxmesh = "ringworld_construction_mesh"`, two `attach` slots on
  locators `locator1`/`locator2` at `position = { -225 0 -60.289 }`).
- `vanilla`, **the mesh declarations** (`gfx/models/planets/_planetary_meshes.gfx`): the
  `ringworld_habitable_01_mesh` / `_clouds_mesh` / `_damaged` / `ringworld_seam_01_mesh` /
  `ringworld_seam_damaged_01_mesh` / `ringworld_tech_01_mesh` / `ringworld_tech_damaged_01_mesh`
  blocks are `:149-189`, every one `cull_distance = 999999999.0f`; `ringworld_construction_mesh`
  (`:217-225`) is the one with a `meshsettings = { shader = "PdxMeshShip" }` override;
  `ringworld_destroyed_mesh` (`:234-238`) and `ringworld_01_damaged_full_mesh` (`:252-273`, two
  `meshsettings` on `g_body2Shape` index 0 and 1) are the megastructure assets. The mesh FILES:
  `ringworld_habitable.mesh` 180,301 bytes, `ringworld_habitable_clouds.mesh` 21,914,
  `ringworld_habitable_damaged.mesh` 349,216, `ringworld_seam.mesh` 235,563,
  `ringworld_seam_damaged.mesh` 281,500, `ringworld_tech.mesh` 103,118, `ringworld_tech_damaged.mesh`
  290,262, `ringworld_construction.mesh` 120,481, `ringworld_seam_construction.mesh` 115,426,
  `ringworld_part.mesh` 1,636 (**referenced by NOTHING in the install** - 0 hits for the string in
  every `.asset` and `.gfx`), `ringworld_01_damaged_full.mesh` 2,304,470 and
  `ringworld_destroyed.mesh` 921,747.
- `measured`, **every entity name is a `<graphical_culture>_<base>_entity` variant, and the install
  writes 17 cultures' worth**: `_planetary_entities.asset` defines the base
  `ringworld_habitable_entity_01_entity` (`:2991`), `ringworld_tech_entity_01_entity` (`:3065`),
  `ringworld_seam_entity_01_entity` (`:3096`), `ringworld_seam_entity_01_full_entity` (`:2971`,
  `cull_radius = 10000.0` with four locators at `+/-450`), `ringworld_construction_entity` (`:2907`),
  `ringworld_3x_seams_entity` (`:2931`), `ringworld_phase_3_construction_entity` (`:3128`),
  `ringworld_destroyed_entity` (`:3372`) and the three `_damaged` entities - and then repeats the
  whole set per culture prefixed with the culture id: `arthropoid_01_` (`:3162`-`:3445`), `avian_01_`
  (`:3445`-`:3689`), `fungoid_01_` (`:3752`-), `mammalian_01_` (`:4154`-), `molluscoid_01_`,
  `plantoid_01_`, `reptilian_01_`, `lithoid_01_`, `necroid_01_`, `nemesis_01_`, `aquatic_01_`,
  `toxoid_01_`, `cybernetics_01_`, `synthetics_01_`, `mindwarden_01_`, `biogenesis_01_`/`_02_`,
  `psionic_01_` and `infernal_01_` - which is why `set_planet_entity = { entity =
  "ringworld_tech_entity_01_entity"  graphical_culture = fromfrom }` (`00_ring_world.txt:296-299`)
  takes a culture WITH the entity name. This is the same culture-prefix convention the portrait
  route documents, and it is why the planet class' BARE `entity = "ringworld_habitable_entity"` name
  - which no `.asset` defines verbatim - still resolves.
- `vanilla`, **the structure the whole ring is a copy of**, and it is the megastructure's, not a
  planet's: `00_ring_world.txt:143-229` `ring_world_2_intermediate` (the stage whose
  `construction_entity = "ringworld_seam_entity_01_full_entity"` at `:145`) removes
  `every_system_planet = { limit = { is_star = no } remove_planet = yes }` (`:184-187`), zeroes the
  belt (`set_asteroid_belt = { radius = 0 }`, `:188-190`), removes itself (`:192`) and spawns FOUR
  `ring_world_2` sections at `orbit_angle` 0/90/180/270 and `orbit_distance = 45` (`:193-228`); it
  ends (`ring_world_1`, `:3-140`) with `set_star_flag = ring_world_built` (`:138`). Stage 3
  (`:245-385`) spawns the three planets with `orbit_angle_offset` 30 / (none) / -30 (`:293`, `:308`,
  `:328`), sets each one's entity with `set_planet_entity = { entity =
  "ringworld_*_entity_01_entity"  graphical_culture = fromfrom }` (`:296`, `:313`, `:331`), sets
  `set_carrier_flag = megastructure` on each, marks the system with
  `set_carrier_flag = has_megastructure` (`:346-348`), then `remove_megastructure = fromfrom`
  (`:349`) and names the habitable section A-D by star flag (`:350-383`). `orbit_angle_offset`
  occurs in **exactly one vanilla file, four times** - all in `00_ring_world.txt` (`:293`, `:328`,
  `:479`, `:515`) - measured with a brace-depth pass over all 30 `common/megastructures/**` files,
  alongside **8** `spawn_planet` calls (6 of them here, one in `16_cosmogenesis_world.txt:181`, one
  in `habitats.txt:361`).
- `vanilla`, **the ruined ring is a megastructure TYPE, and the two systems that are a ring world
  entirely of ruins prove it**: `00_ring_world.txt:388-395` `ring_world_ruined = { entity =
  "ringworld_destroyed_entity"  portrait = "GFX_megastructure_construction_background"  potential =
  { always = no } }` (script-spawned only), and it is spawned by `cybrex_system`
  (`prescripted_species_systems.txt:1928`, four at 0/90/180/270, `orbit_distance = 45`, `:2053-2070`),
  `ring_world_init_01` (`utopia_initializers.txt:819`, four at 0/90/180/270, `:965-982`),
  `fallen_machine_2` (`:2803`, `:2808`, `:2813`), `fallen_machine_3` (`:2988-3003`) and
  `pre_ftl_shattered_ring` (`pre_ftl_initializers.txt:1380`, `:1388`). Reading the AST of every
  initializer: those two ruin-only systems place **ZERO** `ringworld = yes` planets, so a reader that
  looks only for ring planet classes reports them as having no ring at all.
- `vanilla`, **the damaged classes are what a planet-killer leaves behind**, so "ruined vs intact" is
  a `change_pc` and not a mesh switch: `common/scripted_effects/00_scripted_effects.txt:4570-4573`
  `else_if = { limit = { is_ringworld = yes } spawn_ringworld_cracker_effect = yes  change_pc =
  pc_ringworld_habitable_damaged }`, `:4596-4599` `pc_ringworld_tech -> pc_ringworld_tech_damaged`
  and `:4600-4604` `pc_ringworld_seam -> pc_ringworld_seam_damaged`. `hostile_init_void_cloud`
  (`distant_stars_initializers.txt:876-896`) is the pristine example of a two-segment ruined arc:
  `pc_ringworld_tech_damaged` at `orbit_angle = 30` and `pc_ringworld_seam_damaged` at
  `orbit_angle = 130`, both `orbit_distance = 0`, each with `create_ambient_object = { type =
  "medium_debris_01_object" }`.
- `measured`, **the ring is planets and the log says nothing about it**. A brace-depth pass over all
  30 `common/megastructures/**` files finds **19** loops over a system's planets
  (`every_system_planet` / `random_system_planet`), and the ring world's is the only one that
  REMOVES every non-star body: `00_ring_world.txt:184-187`. The others read or move bodies
  (`01_dyson_sphere.txt:828`, `:847`, `:989`, `:1008`; `17_orbital_arc_furnace.txt:90`, `:397`,
  `:528`, `:659`; `22_galactic_crucible.txt:102`, whose `:113`/`:115` are the other two
  `remove_planet` sites). A ring world therefore wipes: **every non-star planet in the system**
  (`:184-187`), the **asteroid belt** (zeroed, `:188-190`), and with them whatever colonies,
  deposits, orbital stations, anomalies and primitive enclaves those bodies carried - the star, the
  starbase and the system's ownership are untouched, and the ring's own twelve colonies are created
  by the player afterwards. The ONLY record any of it leaves is the engine's own error log, and it
  records no ring event at all: measured on the 2026-10-06 launch, `logs/error.log` contains **0**
  lines matching `ringworld` / `ring_world` / `ring world`, while it contains six
  `[gamerendering.cpp:1174]: Failed to create system light <name>` lines - the failed-light
  distinction the `black-hole-primary-star-system` topic records. **There is no "ring world
  completed" line to search for.**
- `binary`, **the engine's own vocabulary**: `ringworld` (offset 38477120, beside `trigger_scope`,
  `attraction`, `can_create`, `is_potential`, `support_effects`), `is_ringworld` (38593424, in a
  trigger-name run beside `has_access_construction` / `has_access_civilian` / `can_access_system`),
  and the documentation string at 40679266-40679306 - *"Checks if the planet is a ringworld.
  is_ringworld = yes  PLANET_IS_RINGWORLD ... PLANET_IS_NOT_RINGWORLD"* - which is the trigger's own
  help text with its two localisation keys inline. `customization_view_ringworld` (39743819) is the
  other real occurrence, and it is a **species-customisation camera pose**, not system geometry:
  `gfx/worldgfx/customization_view_ringworld.txt` is `world = customization_view_ringworld` on
  line 5, and `common/defines/00_defines.txt:26-29` gives it
  `ENTITY_SPRITE_CUSTOMIZE_RINGWORLD_CAM_DIR = { -1.0 -0.75 0.3 }`,
  `..._CAM_LOOK_AT = { 0 0 0 }` and `..._ZOOM_SCALE = 1.9`. **`gfx/worldgfx/` contains exactly one
  ring-named file and it is that one**; the other 19 are `star_*_class.txt`, `default.txt`,
  `system_view.txt` and the other customization/ship-designer poses. There is no ring worldgfx.
- `measured`, **the trigger and the flag a mod reads**, from files rather than from a log (the
  engine's script documentation dump was regenerated empty by the 21:26 launch, so nothing here is
  quoted from `triggers.log`): `common/scripted_triggers/00_scripted_triggers.txt:605-607`
  `has_ringworld_output_boost = { is_ringworld = yes }`;
  `localisation/english/triggers_effects_l_english.yml:138-139` `PLANET_IS_RINGWORLD:0 "Is a
  Ringworld"` / `PLANET_IS_NOT_RINGWORLD` (and the shipped Chinese at
  `simp_chinese/triggers_effects_l_simp_chinese.yml:138-139`: 是环形世界 / 不是环形世界);
  `is_ringworld` is used as a `planet` limit at `00_scripted_effects.txt:4570`/`:4591`,
  `02_machine_age_effects.txt:1364`/`:1387`/`:1407`/`:1420`/`:2209`/`:2236`,
  `shroud_shadows_scripted_effects.txt:273` and `crisis_events_1.txt:2986`/`:3068` (15 uses in
  `common/scripted_effects/**` + `common/scripted_triggers/**` + `events/**`, measured);
  `has_star_flag = ring_world_built` is the SYSTEM test, used to refuse a second ring in
  `habitats.txt:157`, `15_orbital_ring.txt:107`, `16_cosmogenesis_world.txt:102` and
  `21_behemoth_egg.txt:67`/`:283` (17 occurrences install-wide, measured).
- `measured`, **the district sets, which is what a colonised segment actually gives a player**:
  `common/districts/04_ringworld_districts.txt` is `district_rw_city` (`:9`) and its siblings on
  `uses_district_set = ring_world` (`:24`, `:30`), while `shattered_ring_world` is used by
  `common/districts/00_urban_districts.txt:26`, `:55`, `:1049`, ... and
  `02_rural_districts.txt:24`, `:34`, `:146`, `:274` - so `pc_ringworld_habitable`
  (`district_set = ring_world`, `starting_district = district_rw_city`) and
  `pc_shattered_ring_habitable` (`district_set = shattered_ring_world`, no `starting_district`) are
  the same kind of object with a different district table.
- `measured`, **this round's own analyser, which is where the two rules below live**:
  `src/lib/colonization.mjs`'s `readRingWorldSystems` / `analyseRingWorlds`, and the selftest group
  "a ring world is a set of planet objects, and its radius and segment count are in the initializer
  (RING)" in `scripts/selftest.mjs`. Run over the install: **10** `ringworld = yes` classes, **9**
  of them with `orbit_lines = no`, **7** ring systems with segments plus **2** that are all ruins,
  **2** findings - both the Shattered Ring's deliberate `NAME_Irreparable_Damage` seam - and **0**
  errors. The reader is asserted to find the Cybrex ring's **12** segments (four of which are nested
  inside its STAR body, `crisis_initializers.txt:377`) rather than **8**, which is what a
  depth-1-only walk returns.
- `log`, **the honest negative, and a warning for the next reader**: the engine's script
  documentation dump under `%USERPROFILE%/Documents/Paradox Interactive/Stellaris/logs/script_documentation/`
  was **regenerated EMPTY at 21:26:19 on 2026-10-06** by a game launch that was not this round's (all
  five files are 0 bytes), and the install's own `<Stellaris>/logs/` is empty as before. So
  no line in this topic is quoted from `triggers.log`/`effects.log`/`scopes.log`; the engine-side
  evidence here is the BINARY strings and `logs/error.log`, which the same launch did write.

## Rules

- **A ring world is drawn PER SEGMENT, and there is no system-level ring object to find.** Each
  segment is an ordinary planet whose class carries `ringworld = yes` and an `entity`; that entity's
  `pdxmesh` is one 30-degree arc. A mod that looks for "the ring mesh" as one object will find
  `ringworld_01_damaged_full_mesh` and `ringworld_destroyed_mesh` - and those are the RUINED
  MEGASTRUCTURE's art and its preview, not the intact ring.
- **The radius is the `change_orbit` before the segments, and it is 45 in every vanilla ring.** The
  segments then sit on that circle with `orbit_distance = 0`. To resize a ring, move the
  `change_orbit` (or write `orbit_distance = 45` explicitly on each spawned segment, which is what
  the repair path does); do NOT give one segment a different `orbit_distance`, because a ring is one
  circle at one radius - that is what `ringworld-segment-orbit-inconsistent` reports.
- **The segment count is how many `planet = { class = pc_ringworld_* }` blocks the file writes.**
  Twelve is the designed number (4 scaffold sections x 3 spawned segments = 12, and the arc meshes
  are 30 degrees), but nothing enforces it: the install ships rings of 12, 12, 9, 6, 6, 3, 2 and two
  of 0. A GAP is simply a slot no block fills - vanilla never writes a "missing segment" marker.
- **`orbit_angle` is NOT what spreads the segments, and this is the point a mod is most likely to get
  wrong.** 41 of the install's 50 ring blocks declare the SAME `orbit_angle = 30` and four complete
  vanilla rings still render as four rings, so the engine positions a `ringworld` body by its place
  in the ring rather than by the declared angle. The one place vanilla DOES write angles for segments
  is the Shattered Ring's repair effects, which place three segments at -30 / 0 / +30 of the section
  they repair. Writing a nice 0/30/60/... sequence is harmless but is not what makes the ring; see
  `## 待确认` for the part of this that is inference.
- **`orbit_angle_offset` is the ring world's own field, and it exists in exactly one vanilla file.**
  Four uses, all in `common/megastructures/00_ring_world.txt` (`:293`, `:328`, `:479`, `:515`), where
  it places a spawned segment +/-30 degrees off the section that spawned it. It is the field that
  distributes a 90-degree scaffold quadrant's three segments evenly.
- **The ring is planets, so a mod counts it with planet triggers.** `is_ringworld = yes` on
  `planet ship` scope is the engine's own predicate and `has_ringworld_output_boost`
  (`00_scripted_triggers.txt:605`) is vanilla's wrapper; a segment is in the system's planet list, so
  `every_system_planet = { limit = { is_ringworld = yes } }` finds exactly the segments. The SYSTEM
  answer is the star flag `ring_world_built` - and vanilla's own habitat, orbital ring and
  cosmogenesis world all refuse a system that has it, so a mod that adds a ring world to a system
  should set it.
- **To make a segment colonisable, change the CLASS - that is the only field involved.**
  `pc_ringworld_habitable` has `colonizable = yes` + `district_set = ring_world` +
  `starting_district = district_rw_city`; every other ring class is the same object with
  `colonizable = no`. `pc_shattered_ring_habitable` is the Shattered Ring's variant
  (`colonizable = yes`, `district_set = shattered_ring_world`, `planet_size = 25`), which is what its
  origin uses as `starting_colony`. A mod's own ring class needs `ringworld = yes`, a segment
  `entity`, `fixed_entity_scale = yes`, `orbit_lines = no` and its own `district_set`.
- **A RUINED ring is two different objects, and a mod should choose deliberately.**
  `ring_world_ruined` is a megastructure (drawn as a full broken ring mesh,
  `entity = "ringworld_destroyed_entity"`), spawned from an initializer's `init_effect`; a damaged
  SEGMENT is a planet class (`pc_ringworld_*_damaged`) that a planet-killer swaps in with `change_pc`.
  The Shattered Ring uses both at once: two ruined megastructure arcs plus three damaged planet
  segments.
- **`ringworld = yes` is the class flag, `ring_world_built` is the system flag, and they are read by
  different scopes.** `is_ringworld` is a planet trigger; `has_star_flag = ring_world_built` is what
  a megastructure's `possible` block tests. A mod that sets only one of them has a ring that either
  does not answer planet triggers or does not stop a second ring being built.

## Breaks

- **"The ring is a megastructure, so I edit the megastructure to change the ring."** The
  megastructure is deleted by its own completion effect (`00_ring_world.txt:349`
  `remove_megastructure = fromfrom`) and the segments are planets that did not exist while it did.
  Every visual decision a mod wants - the radius, the count, which arc, colonisability - is on the
  INITIALIZER or the PLANET CLASS.
- **"The ring world uses one big mesh I can override."** The intact ring has no single mesh: 12
  planet objects each draw a 30-degree arc, and the two full-ring meshes in the install belong to
  `ring_world_ruined` / the megastructure preview. There is no `gfx/worldgfx/ring_world.txt` - the one
  ring-named file in `gfx/worldgfx/` is the species-customisation camera pose
  (`customization_view_ringworld`). To change how an intact ring looks, re-skin or replace the
  PER-SEGMENT meshes / entities - which is the same `.mesh`-is-`pdxasset`, override-the-`pdxmesh`
  recipe the `animated-portrait-route` topic records, applied twelve times.
- **Reading the ring's `orbit_angle` values as meaningful geometry.** They are not: 41 of 50 vanilla
  ring blocks write 30, and a mod that writes 0/30/60/... has not changed anything about where the
  segments land. If a mod needs a specific segment at a specific place, the field that is USED for
  that is `orbit_angle_offset` on a `spawn_planet` from the ring's own quadrant - not the
  initializer's `orbit_angle`.
- **A reader that stops at the first non-ring class, or that reads only depth-1 `planet` blocks.**
  The Cybrex ring's first FOUR segments are inside its STAR body (`crisis_initializers.txt:377`) and
  the other eight are top-level; the machine Fallen Empire's ring is 9 segments plus one ruined
  megastructure section, not 12 planets. A naive walk reports 8 of 12, or calls a 9-segment ring
  complete, and neither number is a defect in the content.
- **A reader that requires `class = pc_ringworld_*` to see a ring at all.** `cybrex_system`
  (`prescripted_species_systems.txt:1928`) and `ring_world_init_01` (`utopia_initializers.txt:819`)
  are ring-world systems with ZERO ring planets - four `ring_world_ruined` megastructure sections and
  nothing else. The reliable system-level marker across all nine cases is the
  `ring_world_ruined` megastructure spawn; `ring_world_built` covers seven of the nine.
- **`class = star` treated as a planet class name.** It is an initializer KEYWORD
  (`example.txt:73`, *"Picks a star class which matches the system's class"*), and there is no `star`
  class in `common/planet_classes/**`. A ring-world reader that reports it produces a phantom finding
  on every ring system in the game; the same holds for `random_planet` / `random_asteroid`.
- **Trusting `parseParadox` on a planet class.** Every ring class carries
  `atmosphere_color = hsv { ... }` (`00_planet_classes.txt:1381` and twelve relatives), a scalar
  block value that ends the enclosing block early in that parser, so fields after it - `colonizable`,
  `orbit_lines`, `district_set` - read as file-level roots. The ring reader in
  `src/lib/colonization.mjs` walks braces itself / uses `parseParadoxTree` for exactly this reason.
- **Expecting the transition to be logged.** The engine logs no successful render and, measured, no
  ring-world event either: the 2026-10-06 `error.log` has **0** ring matches and six
  `Failed to create system light` lines. A mod author debugging "my ring did not appear" has no log
  line to grep for - which is why the radius and the segment classes are worth checking in the FILE,
  which is what the two rules do.
- **Assuming the ring's segments are at the radius you wrote on them.** The radius is the chain's
  `change_orbit`; a segment's own `orbit_distance` is RELATIVE to the previous body (the star-slots
  topic measures the rule) and most vanilla segments write 0. A mod that writes a positive
  `orbit_distance` on every segment thinking it is "the ring's radius" gets 12 segments at 12
  different radii, each one a ring of one arc.

## 待确认

- **What the engine actually does with a `ringworld` body's declared `orbit_angle`.** The measurement
  is strong - 41 of the install's 50 ring blocks write the same 30 and four complete vanilla rings
  still render as four rings, which is impossible if the value were obeyed - but the MECHANISM (does
  the engine assign the angle by index among the system's ring bodies? by the order of the blocks? by
  a ring-specific layout?) was NOT established. No engine string names it: `ringworld` occurs 6 times
  in `stellaris.exe` and every one is a trigger name, a localisation key or a class name. Settling it
  needs a probe system with 12 segments at a deliberately wrong angle plus a screenshot, and this
  round was read-only and launched nothing.
- **What a ring with a segment count that is not 12 LOOKS like.** Twelve 30-degree arcs tile a circle
  exactly, and the install ships 9, 6, 3 and 2 segment rings - but whether a 9-segment ring leaves a
  90-degree GAP, overlaps, or is redistributed evenly (10-degree larger arcs that no longer meet) is
  a rendering question no file answers. The arc meshes are fixed geometry, so a redistributed ring
  would show gaps between arcs; that is inference, not measurement.
- **Whether `ring_world_ruined`'s `entity = "ringworld_destroyed_entity"` is drawn at the ring's
  radius or at its own mesh scale.** `ringworld_01_damaged_full_entity` carries `scale = 0.01`
  (`_planetary_entities.asset:7771`) while `ringworld_destroyed_entity` (`:3372-3374`) carries none,
  and the four ruined arcs are spawned at `orbit_distance = 45` (`federations_initializers.txt:1923`)
  - but a megastructure section's drawn scale is the megastructure system's business, and this round
  did not establish how the engine sizes one. The `ringworld_01_damaged_full_entity` scale of 0.01 is
  recorded and unexplained.
- **Whether the `pc_ringworld_habitable` clouds entity is attached and drawn in the SYSTEM view.**
  `attach = { root = "ringworld_habitable_entity_01_clouds_entity" }`
  (`_planetary_entities.asset:3028`) is unconditional in the asset file, and both cloud meshsettings
  use `PdxMeshRingworldClouds`, but no entity state or `game_data` flag disables them for the system
  view - the claim that they are drawn is the asset file's own structure, not an observation.
- **The `+/-450` locators' role.** `ringworld_seam_entity_01_full_entity` (`:2971-2987`) places four
  `ringworld_3x_seams_entity` at `+/-450` on the X and Z axes, and `ringworld_3x_seams_entity`
  (`:2931-2967`) places two `ringworld_construction_entity` at `+/-225` - numbers that fit a radius-450
  circle (the arc chord at 30 degrees is 232.9) but do not pin it, since the entity is the
  megastructure's construction visual. The 450 reading in this topic comes from the SEGMENT MESH
  bounding boxes, which are independent of these locators.
- **Whether `ringworld_part.mesh` (1,636 bytes, unreferenced) is the renderer's own arc tile.** The
  name and its size invite the reading that the engine composes a ring from one part mesh, and 0
  files in the install name it. It is recorded as an unexplained asset.
- **Whether the declared `orbit_angle` matters for a ring world's TRAVEL or targeting geometry**
  (where a fleet enters the system, what a station orbits). `orbit_lines = no` on all nine ring-arc
  classes says the orbit line is suppressed, and no vanilla script reads a ring segment's
  `orbit_angle`, but the spatial answer was not measured.
