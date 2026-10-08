---
id: dlc-panels-are-engine-views
category: contract
title: Every DLC panel is an ENGINE-OWNED view, and the modding door is always a data schema - never the panel
title_zh: 每一套 DLC 面板都是引擎自己的视图，模组能走的门永远是数据模式，而不是面板
summary: Six 4.4.6 DLC GUI systems were probed read-only in one wave (arkships, Grand Archive collection, Galactic Community, espionage, Overlord agreements, the Shroud), each against the same six questions. The result is one shape six times. The panel is a window the engine creates and fills (or a tab inside a vanilla view the engine switches), its visibility is decided by an engine-private mode or a scripted game rule the engine reads BY NAME, no script effect opens it, and the only extension point a mod has is a DATA SCHEMA whose width varies from one field (`carries_colony`) through one effect (`give_specimen`) and one directory (`common/patrons/`, `common/resolutions/`) to a directory family with four fixed `term_type` values. Writing `.gui` is a whole-file override of a vanilla view and buys layout only. One law ties the shut doors together and is stated as such here: **a mod can add INSTANCES, not CATEGORIES** - every closed enumeration this wave measured (`term_type`'s 4 values, the compiled specimen-type set behind the Grand Archive's exhibitions, `common/galactic_community_actions/`'s 2 keys, a patron's 3 `category` values) is compiled in, so raising a count define cannot widen one. The Grand Archive's runtime half is measured too: a save with a built Grand Archive shows exactly 3 exhibitions whose titles are the CONTENT-defined `EXHIBITION_TITLE_1..3`, one per specimen type, so `GRAND_ARCHIVE_EXHIBITIONS_COUNT = 4` has no fourth title to draw.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui, .txt]
tags: [dlc, engine-owned-view, data-door, schema, game_rules, tab, panel-host, override, hardcoded-ui, comparison, ark-ship, specimens, resolutions, patrons, agreements, espionage, closed-enumeration, instances-not-categories, count-define, runtime-verdict]
related: [ark-panel-is-the-colony-panel, espionage-operation-types-are-checked-at-load, agreement-panel-is-data-not-gui, host-gui-surface, script-routes-to-a-window, engine-populated-containers, window-name-contract, engine-capability-vs-usage]
sources: [<clone>/unga-fix/dlc-gui/BRIEF.md, <clone>/unga-fix/dlc-gui/espionage.md, <clone>/unga-fix/dlc-gui/galactic-community.md, <clone>/unga-fix/dlc-gui/grand-archive.md, <clone>/unga-fix/dlc-gui/overlord-contracts.md, <clone>/unga-fix/dlc-gui/shroud.md, <Stellaris>/interface, <Stellaris>/common, <Stellaris>/stellaris.exe]
---

## What it is

Six DLC GUI systems were researched read-only in one wave, each against the same six questions (panel
host, how the engine decides to show it, where the data comes from, exclusivity, fragility, what a mod
can copy). The six answers are the same answer six times:

> **The panel is an ENGINE-OWNED view. The modding door is a data schema.**

Concretely, every one of the six satisfies all four of these:

1. **The host is a window the engine creates**, either a dedicated `.gui` root with no `parent` field
   (the engine places it) or a tab/child container inside a vanilla view the engine switches to.
2. **Visibility is engine-private.** It is a `common/game_rules/*.txt` rule the engine reads *by name*
   (the `.gui` contains no `visible`, no `trigger`, no condition of any kind), or a mode switch that
   exists only in C++. No `.gui` field participates.
3. **No script effect opens it.** The whole engine has exactly **four** window-showing effects
   (`force_show_diplomacy`, `force_show_espionage`, `open_shroud_tab`, `set_advisor_active`), and they
   belong to two of these six systems only; the other four are reachable by the player's own clicks and
   by nothing a mod writes (`script-routes-to-a-window`).
4. **The door is data.** A mod adds content by writing a schema the engine loads and validates, and the
   engine then fills its own list, grid, seat row or term row. It never writes a control.

What varies between the six systems - and what this topic exists to make reusable - is **how wide that
data door is**, from a single field to a directory family with a fixed value set. That width is the
real answer to "can a mod do this?", so it is the axis of the table below.

### The law the shut doors share: a mod can add INSTANCES, not CATEGORIES

Every "no" in the table below is the same "no", and it is worth stating once, as a law, because the
tempting move is always the same: find the enumeration, and raise its count.

> **The engine's enumerations are CLOSED. A mod can add instances of a category; it cannot add a
> category. Raising a count define cannot widen an enumeration.**

The four enumerations this wave measured, with where the closure lives:

| enumeration | the closed set | what a mod can add | what it cannot add |
| --- | --- | --- | --- |
| `term_type` in `common/agreement_terms/` | **4** - `discrete`, `discrete_number`, `specialist_type`, `resource`; there are exactly 4 matching `agreement_term_<type>_entry` templates, and the exe knows these literals | a new TERM (a new entry using one of the 4) | a 5th `term_type` - there is no template to instantiate and no literal in the exe |
| the specimen-type set behind the Grand Archive collection | **3** - `aesthetic_wonder`, `historical_item`, `xeno_geology`, compiled in; the exhibition titles are the content-defined `EXHIBITION_TITLE_1..3`, one per type | a specimen registered in `common/specimens/` whose `type` is one of the 3, handed over with `give_specimen` | a 4th specimen TYPE - and therefore a 4th exhibition: `SPECIMEN_TYPES` (defines `:1487`) is NOT the whitelist, so editing it or raising `GRAND_ARCHIVE_EXHIBITIONS_COUNT` changes nothing (measured four ways, see Evidence) |
| `common/galactic_community_actions/` | **2** keys, both literals in the exe | a resolution, a category, a group, a focus (other directories) | a new action key - the engine does not query a name it does not know |
| patron `category` in `common/patrons/` | **3** required values | a patron definition, callings, deeds, auras | a 4th `category` |

**Why this is the shape of the whole surface and not a Grand Archive quirk:** the engine decides what a
panel can show from a set compiled into `stellaris.exe`. Content can be enumerated INTO that set's rows;
it cannot extend the set. So "can I add a panel/term/exhibition/specimen kind?" is answered by asking
**whether the value set is a literal in the exe**, not by reading the array it sits in - a define array
next to the feature (`SPECIMEN_TYPES`) looks exactly like the whitelist and is not one.

### The three ways the engine connects content to a screen

Cutting across all six systems, there are exactly three mechanisms by which a `common/` or `events/`
file reaches a control on screen, and only the third is a door a mod can open for its OWN window:

1. **A DATA FIELD SWITCHES A WHOLE UI MODE.** `carries_colony = <planet_class>` on a `class = shipclass_starbase`
   ship size makes the engine draw the arkship name set inside the vanilla colony panel. One field turns a
   compiled-in alternative view on (`ark-panel-is-the-colony-panel`). The mod does not write UI at all.
2. **ENGINE-FILLED LISTS A MOD FEEDS BY REGISTRY.** `common/resolutions/`, `common/specimens/` (+ `give_specimen`),
   `common/espionage_operation_types/`, `common/patrons/`, `common/agreement_terms/` (+ values and presets):
   the engine walks the directory and instantiates its own entry templates. The mod writes data; the engine
   writes the controls (`engine-populated-containers`).
3. **AN EVENT TYPE AS THE UI PROTOCOL - the only one that gives a mod its OWN window.** `custom_gui` on an
   event names a `containerWindowType` and the engine builds the window from it, binding a fixed set of
   element names and dismissing it only through an event option (`window-name-contract`, `window-dismissal`,
   `script-routes-to-a-window`). Of the three, this is the only mechanism that puts a mod-authored window
   on screen, and it is the one this project's own UI uses.

The other two are doors INTO somebody else's panel. That distinction is the practical content of the
taxonomy: a mod that wants its own screen has exactly one route, and it comes with a name contract and a
dismissal rule; a mod that wants its content listed in an existing screen writes data and never a control.

## Syntax

The six systems, in the order of the wave: host, the engine's visibility decision, and the width of the
data door a mod may write.

| system (DLC) | panel host | how the engine decides to show it | the data door, and how wide it is |
| --- | --- | --- | --- |
| **ark ship** (Nomads) | the **colony panel**: `interface/planet_view.gui`'s `planet_view` window (`:222`), in an arkship mode chosen from the colony's CARRIER | the view class picks between two name sets (`arkship_*` vs `planet_*`) already declared in that one window; **no `.gui` field decides it** and `pc_ark` occurs 0 times in the exe | **one field on one ship size**: `carries_colony = <planet_class>` alongside `class = shipclass_starbase` in `common/ship_sizes/*.txt`. The UI stays vanilla's; `common/arkships` is **not read at all** (measured, see Evidence) |
| **Grand Archive collection** (Ancient Relics) | `interface/discoveries_view.gui`'s `collection_window` (`:652-889`), a tab page of the shared `discoveries_view` multi-tab view (`:26-1279`) | view ID `discoveries` (`onclick = discoveries`, `resource_groups/topbar_other_resource_groups.txt:16-26`) plus the game rules `can_use_exhibits` / `can_access_vivarium` (`common/game_rules/00_rules.txt:4042-4053`, `:4055-4067`) - **0 hits in `interface/**`** | **one effect + one directory with a CLOSED type set**: register `common/specimens/*.txt` (`specimens.txt` holds 258) and hand one over with `give_specimen` (`effects.log:2651-2653`). The type set is the compiled 3 (`aesthetic_wonder` / `historical_item` / `xeno_geology`): `SPECIMEN_TYPES` (defines `:1487`) is **not** the engine's category table and adding a 4th entry adds nothing, so **3** exhibitions is the whole set - measured in a built-archive save, each exhibition's title being the content-defined `EXHIBITION_TITLE_1..3`. `GRAND_ARCHIVE_EXHIBITIONS_COUNT` is therefore **not a lever a mod can pull** |
| **Galactic Community / Council** (Federations) | `interface/galactic_community_view.gui`, dedicated file (2448 lines), window `galactic_community_view` (`:96-2059`); confirmation popup reuses `interface/popup.gui:376-502` | game rule `can_see_galactic_community` (`common/game_rules/00_rules.txt:2388-2394`), whose NAME is a literal in the exe; the topbar window is engine-placed and `:69` says it in the file's own words: `### The visibility needs to be set by this in Code` | **a directory that is a schema family**: `common/resolutions/` (9 files), `common/resolution_categories/`, `common/resolution_groups/`, `common/galactic_focuses/`, and `common/game_rules/` to change who sees the entrance. `common/galactic_community_actions/` has **2 keys, both literals in the exe** - that sub-door is closed |
| **espionage** (Nemesis) | TWO hosts, neither a new top window: the `espionage_tab` (`diplomacy_view.gui:1558`) inside `CDiplomacyView`, and the separate view `interface/espionage_operation_view.gui` (1278 lines, `CEspionageOperationView`) for ONE operation | engine-private: `CEspionageView` does **not** exist in the exe; the tab's usability is the engine's own "actionable" test, and the map icon's appearance is the content field `display_espionage_operations` in `common/map_modes/00_map_modes.txt` (`:12` field doc, `:543-548` used) | **three directories, one of them validated at load**: `common/espionage_operation_types/*.txt`, `common/espionage_operation_categories/`, `common/espionage_assets/`. The engine **checks the definitions at load** and names the file and key (see `espionage-operation-types-are-checked-at-load`) |
| **Overlord agreements** (Overlord) | `interface/agreement_negotiation_view.gui`, dedicated file (1399 lines, 12 top-level `containerWindowType`), window `agreement_negotiation_view` (`:56`); its tab lives in `galaxy_view.gui:945` (`agreements`) | engine-private: the trigger family `is_subject` / `is_overlord` / `has_overlord` / `is_subject_type` (registered adjacently in the exe) plus two entry points - the `terms_negotiation_button` (`galaxy_view.gui:1488`) and the diplomatic action `action_negotiate_existing_agreement` (`common/diplomatic_actions/00_actions.txt:4605-4616`). **No effect opens it** | **a directory family with four FIXED `term_type` values**: `common/agreement_terms/` (`term_type` + `hidden` only), `common/agreement_term_values/` (all the logic), `common/agreement_presets/`, `common/agreement_resources/`. A new TERM is free; a new term_type is not - the exe knows `discrete` / `discrete_number` / `specialist_type` / `resource` and there are exactly 4 matching `agreement_term_<type>_entry` templates |
| **the Shroud** (Shadows of the Shroud) | a tab of the contacts view: `shroud_window` (`galaxy_view.gui:1571-2879`) plus the global template library `interface/the_shroud.gui` (352 lines, **no `windowType` at all**) | game rule `can_open_shroud_tab` (`common/game_rules/00_rules.txt:4451-4457` = `has_shroud_dlc` AND (`can_access_shroud` OR `has_breached_shroud`)); the tab names `tab_shroud` / `tab_shroud_active` (`galaxy_view.gui:2855-2878`) are engine-only. `open_shroud_tab` is the ONE effect, and it needs the country to have `standard_shroud_module` | **a directory of definitions**: `common/patrons/patron_types.txt` (+ `callings/`, `deeds/`, `psionic_auras/`), whose file head `:1-99` is the engine's own field documentation. Required `category` values are 3; required `GFX_<patron>_*` names are a convention (`:14-37`) |

The reusable rules that fall out of the table:

```
# THE SHAPE, once, for any DLC panel you are asked to extend:
#   1. FIND THE HOST. A dedicated .gui with no `parent`? A tab inside a vanilla view?
#      Either way the engine creates it; you cannot open it.
#   2. FIND THE VISIBILITY RULE. grep the .gui for `visible` / `trigger` / `if_` first.
#      If there are none, the decision is `common/game_rules/<name>.txt` (the engine reads
#      the rule by NAME) or pure C++. Either way, editing the .gui cannot change it.
#   3. FIND THE WIDEST DATA DOOR and write only that:
#        one field          -> common/ship_sizes/  carries_colony + class = shipclass_starbase
#        one effect + list  -> common/specimens/   + give_specimen
#        one directory      -> common/patrons/  or  common/resolutions/
#        directory family   -> common/agreement_terms/ + _term_values/ + _presets/  (4 term_types)
#   4. IF the schema has a FIXED value set (the compiled specimen-type set behind SPECIMEN_TYPES,
#      term_type, patron category, galactic_community_actions), a new VALUE is not a new feature:
#      THE ENGINE'S ENUMERATIONS ARE CLOSED - a mod can add INSTANCES, not CATEGORIES. Check the exe
#      for the literal before promising it, and never try to widen it by raising a count define
#      (GRAND_ARCHIVE_EXHIBITIONS_COUNT = 4 has no 4th title to draw - the titles are content keys
#      EXHIBITION_TITLE_1..3, one per compiled type).

# THE OVERRIDE IS THE SECOND DOOR, AND IT BUYS LAYOUT ONLY.
#   A mod's interface/<same relative path>.gui REPLACES the vanilla file for that load
#   (whole file, not merged). The engine's element names are the API: keep every one.
#   Cost: the whole view freezes at the version you copied (host-gui-surface).
```

## Evidence

- `measured`, the wave itself: six read-only reports under `<clone>/unga-fix/dlc-gui/`
  (`espionage.md`, `galactic-community.md`, `grand-archive.md`, `overlord-contracts.md`,
  `shroud.md`, plus the separately delivered ark ship report whose knowledge is
  `ark-panel-is-the-colony-panel`), each written against the shared brief `BRIEF.md`. Every claim in
  the table above is a `file:line`, an exe string or an engine log line inside one of them.
- `binary`/`vanilla`, **the visibility field is absent by measurement, not by convention**: the
  arkship's own panel file `<Stellaris>/interface/planet_view.gui` (8483 lines) contains
  **0** `visible =`, **0** `trigger =` and **0** `enabled =`; `interface/galactic_community_view.gui`
  contains none either, and `can_use_exhibits` / `can_access_vivarium` return **0** hits across all
  `interface/**/*.gui`. The engine's decision is therefore not expressible in the file a mod edits.
- `binary`, **the names are the contract, and they are literals**: `galactic_community_view`,
  `espionage_tab`, `espionage_operation_view`, `agreement_negotiation_view`, `collection_window`,
  `discoveries_view`, `tab_shroud`, `shroud_window`, `patron_deed_entry` and the four
  `agreement_term_*_entry` templates all occur verbatim in `<Stellaris>/stellaris.exe`, while
  the CLASSES a reader would expect do not: `CEspionageView` and `CArkshipView` occur **0** times.
  What exists is `CDiplomacyView`, `CEspionageOperationView`, `CPlanetView`, and three
  `CEspionage*Database` classes - i.e. the engine owns the view and the database, and the mod owns the
  data (see `window-name-contract` for the same rule one layer down).
- `log`, the game rules the engine evaluates are the script's only lever:
  `common/game_rules/00_rules.txt:2388-2394` (`can_see_galactic_community`),
  `:4042-4067` (`can_use_exhibits` / `can_access_vivarium`), `:4451-4457` (`can_open_shroud_tab`), with
  the rule NAMES as literals in the exe - the shape `common/scripted_triggers/00_scripted_triggers.txt`
  cannot express, because a game rule is looked up by the engine and a trigger is called by script.
  `01_gui_rules.txt` is the install's own list of GUI-gating rules (`doom_clock_is_shown`,
  `crisis_name_is_shown`), i.e. the mechanism is vanilla's, not this project's reading of it.
- `measured`, **the doors' widths, one by one**: `common/ship_sizes/29_nomads_dlc_ships.txt:113-114`
  (`carries_colony = pc_ark` with the comment `# Enables Arkship custom UI`); `give_specimen` in
  `logs/script_documentation/effects.log:2651-2653` against `common/specimens/specimens.txt`'s 258
  definitions; `common/resolutions/99_README_RESOLUTIONS.txt:3-23` as the engine-facing field
  documentation of the resolution schema; `common/agreement_terms/00_agreement_terms.txt:8`'s own
  comment `# Supported values: discrete, discrete_number, specialist_type` plus the measured 4th,
  `resource`; `common/patrons/patron_types.txt:1-99` documenting `category`, `position`, `callings`,
  `deeds`, `covenant`, `passive_accord`, `active_accord`.
- `measured`, **where the door is SHUT, the exe says so**: `SPECIMEN_TYPES` is not the engine's
  category whitelist (four probe runs: a specimen whose type IS in the array is still rejected, an
  array containing only a fake type still rejects under the ORIGINAL name, and removing two real types
  produces 0 complaints across 258 vanilla specimens - `DOORS-RESULTS.md` section 4); a 5th
  `term_type` has no template to instantiate and no literal in the exe; a mod-authored
  `common/galactic_community_actions/` key is not a name the engine queries.
- `measured` + `eyes`, **the Grand Archive's runtime half, which is what makes the count define useless
  rather than merely suspect** (`DOORS-RESULTS.md` section 12.1): a human loaded a save with a built
  Grand Archive and **counted 3 exhibition entries**, whose titles are **美学大观 / 星海往事 / 异星奇景**,
  i.e. the localisation keys `EXHIBITION_TITLE_1` / `_2` / `_3`. Those keys are **content-defined and one
  per specimen type** - `EXHIBITION_TITLE_` occurs in `stellaris.exe` as a PREFIX only
  (`localisation/english/grand_archive_l_english.yml:1264-1272` supplies the `_1/_2/_3`) - so
  `GRAND_ARCHIVE_EXHIBITIONS_COUNT = 4` would have a fourth slot and no fourth title. The observation is
  a report from the user's eyes, not a screenshot or a log line, which is why it is labelled separately
  here; the log half (the three rejection directions, all measured) is above.
- `measured`, **the law stated as a law, and the four enumerations it covers**: `term_type`'s 4 values
  plus the 4 matching `agreement_term_*_entry` templates, the compiled specimen-type set (3) behind the
  Grand Archive's exhibitions, `common/galactic_community_actions/`'s **2** keys (both exe literals) and
  a patron's 3 required `category` values. Each was measured by the wave's own report under
  `<clone>/unga-fix/dlc-gui/`, and each answers the same way: a new ENTRY is content, a new VALUE
  is engine code. The reusable form is in the "law the shut doors share" section above.
- `measured`, **the override is whole-file and the names inside it are load-bearing**: the same
  relative path from two mods means the later one wins and the loser is not parsed
  (`PROBE-RESULTS.md` section 3, re-measured as Door C of `DOORS-RESULTS.md`), which is why every
  report's "fragility" section ends at the same place - a fork of `galaxy_view.gui` (3487 lines),
  `diplomacy_view.gui` (3290), `discoveries_view.gui` (1846) or
  `agreement_negotiation_view.gui` (1399) freezes the whole view at the version copied. The
  espionage report adds the failure mode with no log line at all: the engine fetches that window's
  controls **by name**, so a fork that renames or deletes a layer kills the page silently.
- `measured`, the plugin's own reach: `arkship` occurs **0** times under `RStellarisGui/src/`, and
  no topic in this knowledge base modelled an engine-owned DLC view before this wave - the taxonomy
  is new, and the per-system detail topics are listed in `related`.

## Rules

- Before extending any DLC panel, answer "what is the HOST" and "what is the VISIBILITY RULE" from
  the files: a dedicated `.gui` root with no `parent` field, or a tab inside a vanilla view; and for
  visibility, `0` `visible`/`trigger` fields in the `.gui` means a `common/game_rules/*.txt` rule the
  engine reads by name, or pure C++. Never spend a round trying to express the switch in the `.gui`.
- The data door comes first, always, and the law is: **a mod can add INSTANCES, not CATEGORIES.** If a
  system has a `common/<something>/` directory whose keys the exe does not contain, a mod can add
  ENTRIES; if the exe contains the value set (`term_type`'s 4, the compiled specimen-type set behind
  `SPECIMEN_TYPES`, a patron's 3 `category` values, `galactic_community_actions`' 2 keys), a mod cannot
  add a VALUE. Check the exe literal before promising a new kind of thing.
- **Never try to widen an enumeration by raising a count define.** `GRAND_ARCHIVE_EXHIBITIONS_COUNT`
  looks like the lever for "one more exhibition" and is not one: the exhibitions are the compiled
  specimen TYPES, and their titles are the content keys `EXHIBITION_TITLE_1..3`, one per type - so a
  raised count has no title to draw. The same test applies to any `<THING>_COUNT` define sitting next to
  a feature: ask whether the THING's set is compiled in before treating the count as content.
- Do not reach for the four window-showing effects as a general "open my panel" route: two of them
  target the diplomacy view (espionage tab / diplomacy tab) and are restricted to
  `on_custom_diplomacy` events, relic activation effects, or events triggered from those;
  `open_shroud_tab` needs the country to have the shroud module. There is no effect that closes a
  window (`script-routes-to-a-window`, `window-dismissal`).
- Overriding the host `.gui` is a legitimate second door and it buys **layout**: geometry, sprites,
  static text, and the interior of the engine's entry TEMPLATES. It never buys content - the lists are
  filled from the data schema - and it must keep every element name the engine looks up, because a
  renamed or deleted name is a silently dead page, not a script error.
- When a system's data door is a **directory family**, the family is the schema: terms without values
  do not appear, values without a preset entry do not appear in a negotiated agreement, and a specimen
  without `give_specimen` never reaches the collection. Write the whole chain, not one file of it.
- Report a DLC panel as DLC-PRIVATE only where it is: the entry point, the tab, the fill logic and the
  container names are engine-owned. The DATA is usually not DLC-gated at all - the vanilla content is
  (every Galactic Community resolution carries `has_federations_dlc = yes` in its own `potential`),
  which is a different statement with a different consequence for a mod.

## Breaks

- Assuming a DLC panel is a `.gui` a mod can author. All six hosts are pre-existing windows or tabs
  the engine opens; a mod's own `containerWindowType` is never filled by any of these systems.
- Reading "the `.gui` declares the element" as "the `.gui` controls the element". The containers in
  every one of these panels are engine-populated (`gridBoxType`, `smoothListBoxType`,
  `OverlappingElementsBoxType`); a child written inside one is an engine error and the block is
  skipped (`engine-populated-containers`).
- Believing a define array is a content switch, or that a count define beside a feature can widen it.
  `SPECIMEN_TYPES` (defines `:1487`) looks exactly like the category whitelist and is not one - measured
  in four runs - and `GRAND_ARCHIVE_EXHIBITIONS_COUNT` (`:1483`) looks exactly like "how many
  exhibitions" and cannot add one, because the three titles are content keys tied one-per-compiled-type.
- Believing a directory's presence in the engine's content list means it has a parser.
  `common/arkships` is FIRST in that list and is not read at all (measured: 7 probe files, including
  a malformed one, produced zero log lines while the same mod's `interface/` file was named in the
  same run).
- Forking a host `.gui` to "add one button" without a baseline hash and a re-copy plan. The engine's
  next patch is not a conflict, it is a silent rollback of your whole file
  (`host-gui-surface`, `override-maintenance-workflow`).
- Treating a tab's visibility rule as a personal switch. `can_see_galactic_community`,
  `can_use_exhibits`, `can_open_shroud_tab` are vanilla rules the whole game reads; overriding one
  changes the vanilla panel's behaviour for everyone, not just for your mod's content.

## 待确认

- **Whether `GRAND_ARCHIVE_EXHIBITIONS_COUNT` is a constant or derived from the array's length.** That
  implementation detail was NOT measured - settling it needs a define edit loaded and an exhibition
  count read back. The PRACTICE question is answered without it: raising the count cannot create a 4th
  exhibition, because the 4th title key does not exist in content (Evidence, the eyes bullet). A reader
  should not quote "it is a constant" from this topic; quote "it is not a lever".
- **Whether the engine's tab/mode switches can be *reached* differently than the four effects and the
  vanilla buttons.** Each report confirms the absence of a generic "open tab" effect from its own
  angle; none reverse-engineered a call site, so "no route exists" is a measured absence over
  `effects.log`'s 1056 effects, not a proof about the binary.
- **The exact predicate for two of the six visibility rules.** `can_see_galactic_community` is
  confirmed to exist and to be a literal in the exe, but "does it gate the topbar button, the view, or
  both" is not observable without launching the game; the same holds for the Agreements tab's
  `is_subject`/`is_overlord` judgement - no script or `.gui` hook can read it.
- **What happens when a fork of one of these `.gui` files drops an engine-demanded name.** For the
  event window a missing demanded name is a null dereference (GAP-17, `window-name-contract`); for
  these views no measurement exists - the reports' reasoning is that the engine would find nothing and
  draw nothing, and in the espionage case silently, but nobody has watched it happen.
- **Whether the engine's DLC checks add anything on top of the content-level `host_has_dlc` gates.**
  The DLC zips for these systems carry no `.gui` at all (Nemesis's tree has 0 `.gui`/`.gfx`; the Grand
  Archive panel is in the base install), so the panels are not DLC-gated as FILES - but whether the
  engine hides an entry for a missing DLC by another route was not established for any of the six.
- **Whether a mod's `custom_gui = "<a real engine view name>"` instantiates that view.** The name
  resolves (so it is not the GAP-17 crash), and none of the six systems uses `custom_gui` in vanilla;
  what the engine does with a RESOLVABLE engine-view name on an event is untested, and every report
  says the same thing: it needs a loaded game.
