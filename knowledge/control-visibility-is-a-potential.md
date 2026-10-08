---
id: control-visibility-is-a-potential
category: script
title: A control's visibility can live in common/button_effects/, not in the .gui
title_zh: 控件的可见性可能住在 common/button_effects/ 里，而不是 .gui 里
summary: An effectbuttonType does not carry its own visibility. Its effect names a key in common/button_effects/, and THAT key's potential decides whether the button is drawn. A potential testing is_scope_type therefore makes the control vanish depending on where the window was opened from - and the sidebar is immune because it is the engine's own instantiation of the event's option blocks, which no button_effects entry can reach.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui, .txt]
tags: [button_effects, potential, is_scope_type, scope, visibility, effectbuttonType, custom_gui, global_flag, GAP-12, silent-failure]
related: [window-name-contract, window-dismissal, bar-construction, engine-capability-vs-usage]
sources: [<mods>/geocentric_origin/common/button_effects/zz_geocentric_unga_button_effects.txt]
---

## What it is

There are **ZERO** `visible` / `trigger` / `enabled` blocks in the working mod's eleven-window
`.gui` — **0 of 1037 elements**, measured. So the `.gui` file states nothing about when a control
shows. The visibility is elsewhere:

* an `effectbuttonType` carries an `effect = "<key>"`;
* that key is a top-level block in `common/button_effects/*.txt`;
* and THAT block's `potential = { ... }` decides whether the button is drawn.

A `potential` is a statement about the **CURRENT SCOPE**. A window's scope is decided by HOW THE
PLAYER GOT THERE, not by the `.gui`. So a `potential` that only answers in one scope makes a control
that is present, correctly laid out, and clickable-in-principle simply not appear on one of the routes
into the same window.

## The reported defect

Every button in the eleven windows except the engine-drawn sidebar was visible only while the Earth
colony's planet window was open. Every panel button's potential was:

```
potential = { is_scope_type = planet  has_planet_flag = geocentric_earth  owner = { is_ai = no } }
```

The window is reachable from the planet panel (planet scope — passed) and from the sidebar's own
navigation rows (country scope — failed). So the buttons disappeared on one route and not the other.
`<clone>/unga-fix/PLUGIN-GAPS.md` GAP-12 records it as **the class of defect every geometric rule
is blind to**: it shipped, was played, and was reported by the user before any check in this project
noticed.

## Syntax

```
# common/button_effects/zz_geocentric_unga_button_effects.txt

# --- WRONG for an event window: the gate is about the CURRENT SCOPE.
geocentric_unga_mech_button = {
	potential = { is_scope_type = planet  has_planet_flag = geocentric_earth  owner = { is_ai = no } }
	effect = { ... }
}

# --- RIGHT: a GLOBAL flag, the only flag the engine answers identically in every scope,
#     and the effect picks the wrapper that matches the scope it found itself in.
geocentric_unga_mech_button = {
	potential = { has_global_flag = unga_mech_ready }
	effect = {
		if = {
			limit = { is_scope_type = planet }
			owner = { <BODY> }
		}
		else = { <BODY> }
	}
}

# The global flag must be seeded in the init AND in every opener, because
# on_game_start_country does NOT re-run on a LOADED save.
```

## Why the sidebar is immune, and what that teaches

The sidebar stayed visible throughout. It is the engine's **instantiation of the event's `option`
blocks** — one row per option, drawn by the engine into `option_list`. No `button_effects` entry can
reach it, so no `potential` can hide it.

That is the diagnostic signature of this defect: *the engine-drawn controls work and your
`effectbuttonType`s do not*. If a whole panel's buttons vanish together while the option sidebar
survives, look at `common/button_effects/`, not at the `.gui`.

## Evidence

- `measured`: **0** `visible` / `trigger` / `enabled` blocks across all **1037** elements of the `.gui` — so the cause cannot be in the file. `<clone>/unga-fix/STATUS-mechanics.md:22`, `PLUGIN-GAPS.md:738-741`.
- `measured`: `node <clone>\unga-fix\sweep-visibility.mjs` joins the two files (every element's `effect =` against every `button_effects` key's `potential`) and prints one row per button with the scope its potential requires. Before the fix: **89 of 105 buttons** hide when the window's scope is not a planet. After: **0 of 105**. `PLUGIN-GAPS.md:758-761`.
- `measured`: the sidebar is immune because it is the engine's instantiation of the event's `option` blocks, which no `button_effects` entry can reach. `PLUGIN-GAPS.md:750-751`.
- `measured`: the property is enforced on the mod by `mech-gate.mjs` rule 14 — it fails if any button effect used by an element in a window tests `is_scope_type`; the planet-panel entry buttons are exempt BY NAME, because for them the planet is not ambient, it is guaranteed. `PLUGIN-GAPS.md:775-777`.
- `measured`, in the plugin (GAP-12 closed): `src/lib/visibility.mjs` reads the `common/button_effects/*.txt` files the caller indexed, joins every element carrying an `effect` to its entry, and returns `visibility.table` plus the `visibility-scope-dependent` / `visibility-flag-scope-dependent` / `visibility-potential-scope-dependent` rules (`src/lib/validate.mjs`, `report.visibility`). On the fixed mod: 88 elements with an effect, 88 resolved, 0 demanding a scope. On the reconstructed PRE-FIX shape: 77 errors, `summary.demandingScopeUnmet` 77. `src/lib/visibility.mjs:1-40,330-470`.
- `measured`, fail-if-removed: `scripts/selftest.mjs` group "a park is not an escape, and visibility can live outside the .gui (GAP-11/GAP-12)" asserts the ERROR on the pre-fix shape, the INFO under a declared guarantee, that a GLOBAL flag is not reported, and that a both-scope-and-flag potential is reported once.
- `binary`/`vanilla`: `is_scope_type` is a real trigger with a documented value set (`none`, `megastructure`, `planet`, `country`, `ship`, `pop`, `fleet`, `galactic_object`, `leader`, `army`, `ambient_object`, `species`, `design`, `pop_faction`, `war`, `alliance`, `starbase`, `deposit`, `observer`, `sector`, `astral_rift`, plus `archaeological_site`, `first_contact`, `espionage_operation`, `spy_network`, `situation`, `agreement`); vanilla uses it **289** times. See the sibling's `scopes` topic for the full list — it is not duplicated here.
- `measured`: the planet-view override in the same mod wraps 42 effects in `owner = { }` for the SCOPE-1 reason (a button effect runs in the scope of the thing it is drawn on), which is the same mechanism seen one step out. `docs/gui-pitfalls.md:314-328`.
- `measured`: the same class one step further out — `has_country_flag` in a potential that is also read in planet scope. The fix that worked was a global flag. `PLUGIN-GAPS.md:771-773`.

## Rules

- **An `effectbuttonType`'s visibility is its `button_effects` key's `potential`.** When a control appears or disappears by ROUTE rather than by geometry, read that file before the `.gui`.
- Do not gate an event-window control on `is_scope_type` (or on any trigger that only answers in one scope). An event window's scope is decided by how the player arrived; the `.gui` cannot guarantee it.
- Use a GLOBAL flag for a gate that must answer identically in every scope, and seed it in the init AND in every opener (a loaded save does not re-run `on_game_start_country`).
- When an effect must run in a particular scope on one route and not another, pick the wrapper at runtime (`if = { limit = { is_scope_type = planet } owner = { ... } } else = { ... }`) rather than gating the control on the scope. `is_scope_type` inside an `effect` is the FIX and is never reported; the rule keys on the `potential`.
- The exemption is real but must be explicit: a button whose scope is GUARANTEED (the planet-panel entry buttons) may legitimately test `is_scope_type`, because for those the planet is not ambient. Declare it with `visibility_scope_guarantees` and the finding becomes `visibility-potential-scope-dependent` (info), which records the guarantee instead of dropping the finding.
- The plugin now reports this. The validator reads `common/button_effects/*.txt`, joins every element's `effect` to its entry, and returns the table plus two rules. Read the `## What the plugin reports today` section below - if a rule is ever removed, the suite that pins it is `scripts/selftest.mjs`, group "a park is not an escape, and visibility can live outside the .gui (GAP-11/GAP-12)".

## What the plugin reports today

The tooling half of GAP-12 is CLOSED by `src/lib/visibility.mjs`. `gui_layout_validate` (and the same
validator behind `gui_layout_import` -> validate, `gui_check_files` and the web UI) now does all three
things this topic used to ask for:

1. **The per-element table** - `report.visibility.table`, one row per element carrying an `effect`, with
   `element`, `kind`, `window`, `effect`, `effectAt`, `potential`, `potentialAt`, `demandedScope`,
   `flagTriggers`, `flagScopes`, `unconditional`, `scopeGuarantee`, `scopeGuaranteed`,
   `scopeDemandedMet` and `unmetScopes`. It is built from the `common/button_effects/*.txt` files the
   caller indexed (`button_effects_root` / `button_effects_roots` / `extra_roots`), EVEN WHEN NO FINDING
   FIRES - which is the point: a condition that evaluates TRUE on one route into a window and FALSE on
   another cannot be shown by a findings-only report. `report.visibility.windows` carries the per-window
   answer (`scopeGuarantee`, `customGuiWindow`), and `summary.windowsWithoutGuarantee` names every window
   whose entry scope was not established, because that is the risky case rather than the quiet one.
2. **`visibility-scope-dependent`** - an element inside a window whose effect's `potential` tests
   `is_scope_type`. ERROR when an event names the window with `custom_gui` (that window is reachable from
   more than one scope by construction), WARNING otherwise, so a shipped vanilla file is never called
   broken. The finding names the demanded scope, quotes the `potential` and its `file:line`, and its
   suggested fix is the one that worked on this mod: a GLOBAL flag plus a run-time scope pick.
3. **`visibility-flag-scope-dependent`** - the sibling pattern: a potential gated on a
   `has_planet_flag` / `has_country_flag` and on no `is_scope_type`. A scope-specific flag is answered
   from the DRAWING scope, so it decides the route as well as the state. A potential carrying BOTH a
   scope test and a scope flag is reported ONCE, by the scope rule (`summary.scopeSpecificFlags` counts
   those rows separately from `flagScopeSpecific`).

The scope guarantee is a CALLER input (`visibility_scope_guarantees`), not a guess: nothing in a `.gui`
states which scopes a window can be opened in, this plugin does not read event `trigger` blocks, and a
wrong guess would be exactly the confident-but-false finding the project refuses. A window with no
guarantee is reported as `not-established` - which is the honest answer AND the risky one. When a
guarantee IS supplied and the scope test matches it, the finding becomes
**`visibility-potential-scope-dependent`** (info): recorded, not dropped, so the reason the scope test is
safe stays visible in the report and a later second entry point re-opens the question.

**Measured on the working mod** (the fixed shape): 88 elements carry an `effect`, all 88 join to a
`button_effects` entry, 0 demand a scope, 0 are flag-only - the pre-fix statement is gone.
Reconstructing the pre-fix shape (every panel button's gate back to
`potential = { is_scope_type = planet has_planet_flag = geocentric_earth owner = { is_ai = no } }`)
into a temp `button_effects` root and validating the SAME `.gui` against it: **77
`visibility-scope-dependent` findings, all errors**, `summary.demandingScopeUnmet` 77, and the table
classifies all 77 as `planet`. With `visibility_scope_guarantees: { geocentric_unga_main: 'planet' }` the
same run reports 75 errors and **2 info** findings on that window - the guarantee is what changes the
severity, not a silenced rule.

The rules are pinned by `scripts/selftest.mjs`, group "a park is not an escape, and visibility can live
outside the .gui (GAP-11/GAP-12)". Removing `visibilityFindings` from `validateLayout` fails
"a `potential` testing `is_scope_type` on a control in a custom_gui window is an ERROR"; reporting the
flag rule before the scope rule fails "a potential carrying BOTH a scope test and a scope flag is
reported ONCE, by the scope rule"; and treating any `has_*_flag` as risky fails "a GLOBAL flag potential
and a missing potential are NOT reported".

## 待确认

- Whether the plugin can DERIVE a window's entry scope instead of asking the caller. It does not read
  event `trigger` blocks today, so `visibility_scope_guarantees` is the caller's statement; deriving it
  from `is_triggered_only` events and their `trigger` blocks is the one change that would remove the
  last manual input. Until then an unestablished scope is reported, not assumed.
- Whether an `effectbuttonType` can be given a visibility independent of its potential (a `visible`
  field on some other kind, or a scope-free trigger). No mechanism was found in the install.
- Whether a `potential` is evaluated once at open or every frame in 4.4.6. The working mod's own
  comment says a scope error in a button potential "would flood error.log", so it is treated as
  per-frame; the engine was not probed for it.
