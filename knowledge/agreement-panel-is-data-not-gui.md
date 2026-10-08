---
id: agreement-panel-is-data-not-gui
category: contract
title: The Overlord agreement panel is engine-owned, and its data door is a directory family with FOUR fixed `term_type` values
title_zh: 宗主契约面板由引擎拥有，它的数据门是一族目录，而 `term_type` 只有四个固定值
summary: interface/agreement_negotiation_view.gui is a dedicated 1399-line window the engine opens when a subject/overlord relation exists, and every row in it comes from common/agreement_terms/, common/agreement_term_values/ and common/agreement_presets/ - so a mod adds a whole new contract term with three data files and no .gui edit. The hard edge is the schema's closed value set: the engine knows exactly four term_type values (discrete, discrete_number, specialist_type, resource), each paired with one agreement_term_<type>_entry template, so a fifth CONTROL FORM cannot be added without forking the 1399-line file. The same file's negotiated numbers are also coupled to galaxy_view.gui and to three defines, and vanilla says so in its own comments.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.txt, .gui]
tags: [overlord, agreements, term_type, data-schema, closed-value-set, negotiation, panel, override, directory-family]
related: [dlc-panels-are-engine-views, host-gui-surface, engine-populated-containers, engine-capability-vs-usage, override-maintenance-workflow]
sources: [<clone>/unga-fix/dlc-gui/overlord-contracts.md, <Stellaris>/interface/agreement_negotiation_view.gui, <Stellaris>/common/agreement_terms, <Stellaris>/common/agreement_term_values, <Stellaris>/common/agreement_presets, <Stellaris>/stellaris.exe]
---

## What it is

The Overlord agreement (宗主/附庸契约) negotiation screen is one of the six engine-owned DLC panels
(`dlc-panels-are-engine-views`), and it is the widest DATA door of the six - a three-directory schema
in which a mod can add an entire new negotiable clause. It is also the one where the schema's **closed
value set** is easiest to trip over, because the thing that is closed is not a name or a path but a
**control form**: `term_type`.

The host is `interface/agreement_negotiation_view.gui`, 1399 lines, 12 top-level
`containerWindowType`s, root window `agreement_negotiation_view` (`:56`). The engine opens it when a
subject/overlord relation exists - the trigger family `is_subject` / `is_overlord` / `has_overlord` /
`is_subject_type` is registered adjacently in `stellaris.exe`, and the two entry points are the
player's `terms_negotiation_button` (`galaxy_view.gui:1488`) and the diplomatic action
`action_negotiate_existing_agreement` (`common/diplomatic_actions/00_actions.txt:4605-4616`). **No
effect opens it and no effect closes it** - it is not one of the four window-showing effects.

The panel's rows are filled from data, and the row a term gets is chosen by its `term_type`:

```
common/agreement_terms/<file>.txt          term_type + hidden. Nothing else. The ENGINE punts the row.
common/agreement_term_values/<file>.txt    the values, their loyalty/AI/modifier logic, possible/potential.
common/agreement_presets/<file>.txt        which terms a preset (Vassal, Bulwark, ...) starts with, and at
                                           which value - and a term NOT named in a preset's term_data does
                                           not appear in a negotiated agreement at all.
```

The four `term_type` values and their templates are a 1:1 table in the engine:

| `term_type` | term row template | value template |
| --- | --- | --- |
| `discrete` | `agreement_term_entry` (`agreement_negotiation_view.gui:512`) | `discrete_term_value_entry` (`:929`) |
| `discrete_number` | `agreement_term_number_entry` (`:636`) | `discrete_number_term_value_entry` (`:987`) |
| `specialist_type` | `agreement_term_specialist_entry` (`:756`) | `specialist_term_value_entry` (`:1141`) |
| `resource` | `agreement_term_resource_entry` (`:810`) | `resource_term_value_entry` (`:1023`) |

Vanilla's own comment lists only three (`common/agreement_terms/00_agreement_terms.txt:8`:
`# Supported values: discrete, discrete_number, specialist_type`); `resource` is the fourth, proven by
the `resource_subsidies` term declaring `term_type = resource` (`:31-33`), by the exe carrying the
literal, and by the pair of `resource*` templates. A fifth value has no template to instantiate, so a
new CONTROL FORM is a fork of the whole 1399-line file.

The strongest evidence that the term NAMES are free is the install's own new content: the Astral Planes
term `formless_conditions` (`common/agreement_terms/00_agreement_terms.txt:89-92`) and its value
`modifiers_eternal_throne` (`00_agreement_term_values.txt:1704-1718`) **do not occur in
`stellaris.exe` at all**, while `term_type`, `hidden`, `discrete`, `discrete_number` and `resource` do.
The engine hardcodes the schema and the templates; the content supplies every key.

## Syntax

```
# 1. COMMON/AGREEMENT_TERMS/<yours>.txt - declare the term. Two fields, both engine-known.
my_custom_term = {
	term_type = discrete      # discrete | discrete_number | specialist_type | resource - ONLY these.
	                          # A 5th value has no agreement_term_<type>_entry template: the row
	                          # cannot be built, and there is no message - the term just does not appear.
	hidden = no               # hidden = yes keeps it out of the panel (vanilla uses this for
	                          # formless_conditions, which Astral Planes drives from its own preset)
}

# 2. COMMON/AGREEMENT_TERM_VALUES/<yours>.txt - the values the row offers, and all its logic.
my_value = {
	term = my_custom_term
	loyalty_change = -50
	target_modifier = { monthly_loyalty = -4 }
	ai_acceptance = { overlord = 300 subject = -250 }
	possible = { has_overlord_dlc = yes }        # when the value is offered at all
	potential = { }                              # whether it counts as existing
	activate_effect = { } deactivate_effect = { }
}

# 3. COMMON/AGREEMENT_PRESETS/<yours>.txt - WITHOUT this the term never shows in a negotiation.
my_preset = {
	icon = "GFX_..."
	term_data = {
		discrete_terms = { { key = my_custom_term value = my_value } }
		resource_terms = { { key = my_resource_term value = 0.25 } }   # value is a fraction
	}
	potential = { }
}
# A new term must also be added to an EXISTING preset's term_data if it is meant to show up there -
# the panel renders the terms OF the current/proposed agreement, and that set comes from a preset.

# 4. THE FOUR COUPLED NUMBERS. Vanilla states the coupling in its own comment, at
#    common/agreement_term_values/00_agreement_term_values.txt:181-188:
#      # When changing the maximum and minimum values here the following should also be updated:
#      # In agreement_negotiation_view.gui   maxValue = / minValue = / stepSize =
#      # In 00_defines.txt                    AGREEMENT_RESOURCE_SUBSIDIES_MIN / _MAX
#    Measured current values: .gui:1090-1092 maxValue = 0.75 / minValue = -0.75 / stepSize = 0.15;
#    term values :189-190 @subsidy_minimum = -0.75 / @subsidy_maximum = 0.75;
#    00_defines.txt:1183-1185 MIN = -0.75 / MAX = -0.75 / INCREMENT = 0.05.

# 5. TWO .gui FILES ARE COUPLED BY VANILLA'S OWN ADMISSION (so a fork must maintain BOTH):
#    agreement_negotiation_view.gui:1189-1190 <-> galaxy_view.gui:1508-1509  (specialist leveling GUI)
#    agreement_negotiation_view.gui:1325-1326 <-> galaxy_view.gui:3228-3229  (specialist tier)
```

## Evidence

- `vanilla`, the two coupled files say so themselves: `agreement_negotiation_view.gui:1189-1190`
  `# specialist_leveling GUI / # Note: If you change things here, # then you might need to change it in
  the galaxy view too.`, `:1325-1326` the same note for the tier GUI, answered from the other side by
  `galaxy_view.gui:1508-1509`. A fork of one without the other is a documented breakage, stated by
  Paradox in the file.
- `vanilla`, the numeric coupling is stated too: `common/agreement_term_values/00_agreement_term_values.txt:181-188`
  names the three places to update together (`.gui` `maxValue`/`minValue`/`stepSize`, and
  `AGREEMENT_RESOURCE_SUBSIDIES_MIN`/`_MAX` in `00_defines.txt`). The measured values disagree in one
  place - `00_defines.txt:1184` `AGREEMENT_RESOURCE_SUBSIDIES_MAX = -0.75` against the `.gui`'s
  `maxValue = 0.75` and `@subsidy_maximum = 0.75` - which is recorded as a discrepancy, not resolved.
- `binary`, **the value set is closed and the term names are not**: an exact-token pass over the exe's
  string table finds `term_type`, `hidden`, `discrete`, `discrete_number`, `resource`,
  `specialist_type`, `has_access`, `subject_integration` and `joins_overlord_wars`; it does NOT find
  `subject_diplomacy`, `subject_expand`, `resource_subsidies`, `joins_subject_wars`,
  `subject_holdings_limit`, `subject_sensors`, `subject_loyalty`, `protectorate`, `naval_capacity`,
  `formless_conditions` or `subject_dna`. The engine therefore knows the SCHEMA, the four type values
  and four templates, and none of the content's own keys.
- `binary`, the panel's class is not a special window class: `custom_gui` / `custom_gui_option` are
  script key literals in the exe and belong to EVENTS; there is no `CAgreementNegotiationWindow`, and
  `force_open` does not occur in the agreement system at all (`common/**` + `events/**` scan). The view
  is opened by the engine's own button/action callbacks - the same shape as every other system in
  `dlc-panels-are-engine-views`.
- `vanilla`, **the schema is the engine's, documented in place**: `common/agreement_terms/00_agreement_terms.txt`
  (92 lines; `:6-12` is the install's own example comment block, `:8` the supported `term_type`
  values), `common/agreement_term_values/00_agreement_term_values.txt` (1718 lines - all the logic),
  nine `common/agreement_presets/*.txt` files (Vassal / Subsidiary / Tributary / Bulwark / Scholarium /
  Prospectorium / Protectorate / Scion / ...), and `common/agreement_resources/00_agreement_resources.txt`
  (8 lines, one key).
- `binary`, the databases are named and the directory names are literals:
  `CAgreementTermDatabase`, `CAgreementTermValueDatabase`, `CAgreementPresetDatabase`,
  `CAgreementResourceTemplateDatabase`, the load paths `common/agreement_terms`,
  `common/agreement_term_values`, `common/agreement_presets`, `common/agreement_resources`, and the
  source files `...\source\agreement_manager.cpp`, `agreement_terms.cpp`, `agreements.cpp`,
  `effect_impl\effect_impl_agreements.cpp`.
- `measured`, **the door's width in practice**: the report's own worked example adds
  `my_custom_term` with `term_type = discrete`, a value with `term = my_custom_term`, and a preset
  entry, and states the result - `agreement_term_list` gains a row, `term_value_grid` gains its option
  buttons, and the loyalty/AI numbers are computed by the engine from the data. No `.gui` is touched.
- `measured`, the plugin's own model: `RStellarisGui/src/` contains no `agreement_term` string, so
  this schema was outside the tool surface before this wave - the rule that comes out of it is the one
  in `dlc-panels-are-engine-views` (data first, and check the exe for a closed value set).

## Rules

- A new agreement term is three files, not one: the term in `common/agreement_terms/` (with
  `term_type` from the four), its values in `common/agreement_term_values/` (with `term = <the term>`),
  and an entry in some preset's `term_data`. A term missing from every preset never reaches the panel.
- `term_type` is a CLOSED set of four (`discrete`, `discrete_number`, `specialist_type`, `resource`),
  each paired with exactly one `agreement_term_<type>_entry` template and one `<type>_term_value_entry`
  template. A fifth value is not a data change; it is a fork of `agreement_negotiation_view.gui`.
- `hidden = yes` is the way to keep a term out of the negotiation panel while still driving it from
  somewhere else - vanilla's `formless_conditions` does exactly that and is referenced only by its own
  preset.
- An override of `agreement_negotiation_view.gui` must keep every element name the engine looks up -
  the 12 top-level templates, the `agreement_term_*_entry` family, `agreement_term_list`,
  `term_value_grid`, `specialist_levels_grid`, `specialist_perk_grid_box` and the slider names - and it
  must be maintained together with `galaxy_view.gui` (two documented couplings) and with the three
  `AGREEMENT_RESOURCE_SUBSIDIES_*` defines. That is the whole cost of the second door.
- Do not write children into the panel's engine-populated containers: `agreement_term_list`
  (`smoothListBoxType`, `:138`), `term_value_grid` (`gridBoxType`, `:623`), `specialist_levels_grid`
  (`:1216`) and `specialist_perk_grid_box` (`:1369`) are filled by the engine, and a nested element is
  an engine error and the block is skipped (`engine-populated-containers`).
- Put the DLC gate where vanilla puts it - in the term value's `potential`
  (`has_overlord_dlc = yes`, e.g. `00_agreement_term_values.txt:1300`, `:1337`, `:1377`). The
  MECHANISM is not DLC-private: without the DLC the same `common/` schema works and only the vanilla
  content is filtered out.

## Breaks

- Inventing a fifth `term_type` (a new slider, a multi-column row). The engine has four templates; the
  term silently has no row to occupy.
- Adding a term and its values but not touching any preset. The negotiation screen renders the terms of
  the current/proposed agreement, and that set comes from a preset's `term_data` - so the new term is
  invisible and nothing reports it.
- Changing the subsidy range in one place. Vanilla lists three places in a comment
  (`00_agreement_term_values.txt:181-188`) and the install already disagrees with itself about `MAX`
  (`00_defines.txt:1184` is `-0.75`, the `.gui` is `+0.75`), so a mod that changes only one of them
  cannot reason about the result from the files.
- Forking `agreement_negotiation_view.gui` without `galaxy_view.gui`. The specialist leveling/tier
  markup exists in both files and vanilla marks the pair with "if you change things here, then you
  might need to change it in the galaxy view too".
- Treating the panel as openable from script. There is no `open_agreement`-style effect; the only ways
  in are the player's own button and one diplomatic action.

## 待确认

- **That a fifth `term_type` produces no row rather than a log line.** The reasoning is (a) the `.gui`
  defines four `agreement_term_*_entry` templates, (b) the exe's `term_type` candidate literals are
  those four, (c) the templates and the values correspond one to one. The strict test - declare
  `term_type = my_slider`, launch, read `error.log` - was not run, because the wave was read-only.
- **Whether the engine fetches the templates by a literal name or by concatenating `<term_type>` with
  a fixed prefix/suffix.** Both readings fit the evidence (four names, four type values, one-to-one),
  and the difference matters only for predicting what a renamed template does.
- **How rows are ordered** in `agreement_term_list`. No `order`/`weight`/`sort` field exists in
  `common/agreement_terms/` (only `term_type` and `hidden`), so the order is either the load order of
  the definitions or hardcoded, and neither is established.
- **Which of the two conflicting subsidy maxima the engine actually uses** (`00_defines.txt:1184`
  `-0.75` versus the `.gui`'s `maxValue = 0.75`). The report records the inconsistency and recommends
  aligning all three on `+0.75` - an untested recommendation.
- **Whether the Agreements tab is hidden or merely unusable without a subject/overlord relation.** The
  four triggers are registered in the exe and the localisation keys
  (`IS_SUBJECT_OR_OVERLORD`, `AGREEMENTS_HAS_OVERLORD` / `AGREEMENTS_NO_OVERLORD`) exist, but the
  visibility judgement is in C++ with no script or `.gui` hook, and watching it requires a loaded game.
