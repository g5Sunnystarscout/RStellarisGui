---
id: script-routes-to-a-window
category: script
title: There is no effect that opens or closes a window - the four that show one, and the route that needs no script
title_zh: 没有"打开窗口"的效果——能上屏的只有四个，以及一条完全不需要脚本的路
summary: The engine documents 1056 effects and exactly four of them can put something belonging to a window on screen. There is NO effect that opens a window a mod declares and NO effect that closes any window at all. So a custom window has exactly two routes - an event that names it via custom_gui, or a mod's elements living inside a vanilla .gui file the engine already shows. This topic establishes which is which, with the evidence, because the difference decides whether a window must hang off an event.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui, .txt]
tags: [custom_gui, force_show_diplomacy, force_show_espionage, open_shroud_tab, set_advisor_active, eventwindow, override, script-effects, window-routing]
related: [window-dismissal, window-name-contract, host-gui-surface, engine-capability-vs-usage]
sources: [<Stellaris>/logs/script_documentation/effects.log, <Stellaris>/logs/script_documentation/triggers.log]
---

## What it is

The question the whole surface depends on: **what can script do to get a window on screen?** Not "what
does vanilla do" - what the ENGIN**E** offers. The answer is small and it is a hard constraint on any
mod UI.

The engine's own generated documentation is the source of truth here. In this install,
`%USERPROFILE%\Documents\Paradox Interactive\Stellaris\logs\script_documentation\effects.log` lists
**1056 effects** and `triggers.log` lists **1087 triggers**, each with its supported scopes. Filtering
both on every GUI-ish word (`gui`, `window`, `view`, `open`, `close`, `show`, `hide`, `dismiss`,
`popup`, `focus`, `tab`, `display`) leaves exactly **four effects** that put something
window-shaped on screen:

| effect | what it shows | documented restriction |
| --- | --- | --- |
| `force_show_diplomacy = <target country>` | the diplomacy view, on the diplomacy tab, for the scoped country | **only inside `on_custom_diplomacy` events, relic activation effects, or events triggered from those**; does nothing if communications are missing or the target has `custom_diplomacy = yes` |
| `force_show_espionage = <target country>` | the same view on the espionage tab | the same restriction, plus "does nothing if espionage is not actionable against the target" |
| `open_shroud_tab = yes` | the Shroud tab | country scope only |
| `set_advisor_active = yes/no` | the VIR / advisor window pop-in | a TOGGLE for a window the engine owns |

Everything else that looked promising is a different kind of feedback: `create_message` posts a
message, `add_notification_modifier` adds a modifier, `add_claims ... show_notification = no` silences
one. None of them opens a window a mod declared.

**And there is no close.** Zero effects in the 1056 match `close`/`dismiss`/`hide` in the sense of
hiding a window. The word `window` occurs exactly **once** in the whole of `effects.log`, in
`set_advisor_active`'s own description. Dismissal is the event-option mechanism, which the
`window-dismissal` topic covers.

## Syntax

```
# THE ONLY SCRIPT ROUTE A MOD CONTROLS: an event that NAMES a containerWindowType.
# The engine instantiates that window instead of its own event window.
country_event = {
	id = my_mod.100
	diplomatic = yes                              # CONVENTION, not a requirement: 65 of 65 vanilla uses
	                                              # carry it, but custom_gui resolves without it - the
	                                              # engine then builds a different (event) window class.
	                                              # Measured in a loaded game 2026-10-06 (see Evidence).
	custom_gui = "my_mod_window"                  # a containerWindowType name, from any mod or vanilla .gui
	                                              # It MUST resolve: nothing validates the name, and on
	                                              # the diplomatic path an unresolvable one is a CRASH.
	option = { name = my_mod.100.a }              # at least one option is REQUIRED: it is the only way out
}

# THE FOUR WINDOW-SHOWING EFFECTS, verbatim from the engine's documentation
force_show_diplomacy = <target country>           # country scope; on_custom_diplomacy/relic only
force_show_espionage = <target country>           # country scope; on_custom_diplomacy/relic only
open_shroud_tab = yes                             # country scope
set_advisor_active = yes                          # country scope; the VIR pop-in

# THE ROUTE THAT NEEDS NO SCRIPT AT ALL: a mod's elements inside a file the engine already shows.
#   my_mod/interface/planet_view.gui   <- shadows the vanilla file; your elements are drawn
#                                         whenever the engine opens that view. No effect, no event.
#   my_mod/interface/zz_my_mod.gui     <- standalone; only reachable through custom_gui on an event.

# NOT SCRIPT: the binary carries debug console names, not script effects.
#   stellaris.exe strings: "##show_windows_rect_type", "DiplomaticEventWindow", "EventWindow",
#                          "CrisisConversationEventWindow", "LeaderConversationEventWindow",
#                          "LeaderRecruitmentEventWindow", "LeaderStoryEventWindow"
```

## The two routes, and what each costs

**Route A - `custom_gui` on an event.** The mod's window is a `containerWindowType` anywhere in its
own `interface/` tree, and an event names it. This is what the working mod does, and it is the ONLY
route by which a mod's OWN window - one with its own name, its own geometry and its own lifecycle -
can reach the screen at all. Its cost is the contract: the engine looks 26-32 element names up BY NAME
in that window and null-dereferences on a missing one (`window-name-contract`), and the window cannot
be closed by script (`window-dismissal`).

**Route B - the mod's elements inside a host file.** The mod ships
`interface/<vanilla name>.gui` and the engine loads it instead of the base file, so the mod's
elements are drawn every time the engine shows that view. **No effect, no event, no route question** -
the mod is decorating a window the engine already has a reason to open. The cost is the opposite one:
it is a FULL-FILE override, so any patch that touches the vanilla file is silently dropped, and the
mod inherits the obligation to keep the whole file current. See `host-gui-surface`.

There is no third route. In particular a mod cannot declare a window and ask the engine to show it:
the `windowType` kind is emittable and real (24 vanilla blocks, `interface/chat.gui:3`), but every one
of the engine's own `windowType`s is instantiated by C++ (`chat_window`, `chat_item`,
`browser_entry`), and no documented effect names one.

## Evidence

- `log`: `logs/script_documentation/effects.log` holds **1056** effect entries and `triggers.log`
  **1087**. Names are at column 0 in `name - description` form, so the census is exact.
- `log`: `effects.log:3108` `force_show_diplomacy - Forces the diplomacy view to open for the scoped
  country targeted at the given country, on the diplomacy tab. Only works inside on_custom_diplomacy
  events, relic activation effects, or events triggered from those.` and `:3112`
  `force_show_espionage` with the same restriction. `:2988` `open_shroud_tab - Opens the Shroud tab`.
  `:691` `set_advisor_active - Enables or disables the VIR window pop-in`.
- `log`: **exactly one** of the 303276 bytes of `effects.log` mentions `window` - line 691, inside
  `set_advisor_active`'s description. Zero effects match `close`/`dismiss`/`minimi` in a
  hide-a-window sense.
- `log`: `triggers.log` has **no** GUI trigger either. Filtering its 1087 names on the same words
  returns only compound names (`has_closed_borders`, `is_galactic_council_established`) - nothing that
  asks "is this window open".
- `binary`: `stellaris.exe` contains five distinct event-window classes, so the event window is not
  one mechanism but a family: `CEventWindow`, `CDiplomaticEventWindow`, `CAdvisorEventWindow`, and the
  leader conversation windows (`CrisisConversationEventWindow`, `LeaderConversationEventWindow`,
  `LeaderRecruitmentEventWindow`, `LeaderStoryEventWindow`). The install corroborates each with its own
  `.gui`: `interface/eventwindow.gui`, `interface/diplomacy_event_view.gui`,
  `interface/advisor_window.gui`, `interface/crisis_conversation_event_window.gui`,
  `interface/leader_conversation_event_window.gui`, `interface/leader_recruitment_event_window.gui`,
  `interface/leader_story_event_window.gui`.
- `binary`: the strings `custom_gui` and `custom_gui_option`, and the debug-only
  `##show_windows_rect_type`.
- `events`: measured with this project's own parser over the install's 170 `events/*.txt` -
  **13889** event blocks, of which **65** carry `custom_gui` and **all 65 of those** carry
  `diplomatic = yes` (0 do not). **124** carry `force_open`, and **0** carry both. The 65 name
  **8 distinct** window targets, and all 8 are defined in the install's
  `interface/diplomacy_*_event_view.gui` files. That 65/65 is a **convention**, not an engine
  requirement - the field resolves without it (see the `measured` bullets below).
- `vanilla`: a mod's own window is reachable ONLY through `custom_gui`. Of the install's 3321
  `containerWindowType` blocks, the ones any script can name are those 8 - every other window is
  opened by C++ code with no script-visible trigger.
- `measured`: an `effectbuttonType` inside a live `custom_gui` window runs its button effect and the
  window STAYS (`window-dismissal`); that is the measured statement that no effect closes one.
- `measured`: **`custom_gui` IS honoured without `diplomatic = yes`.** In a loaded 4.4.6 game the probe
  mod fired `event gui_probe_q2.1` … `.6` from the debug console. `.1` (`diplomatic = yes`, a name that
  exists) showed a **diplomatic** window; `.2` (no `diplomatic`, the same name) showed an **event**
  window - a different class, with the field still resolved. Load-time corroboration for the class
  split: `[eventmanager.cpp:458]: Event gui_probe_q2.2/3 has no pictures`, naming exactly the
  non-diplomatic pair. `PROBE-RESULTS.md` §4, run F, 2026-10-06.
- `measured`: **an unresolvable `custom_gui` name is a CRASH on the `diplomatic = yes` path, not a
  message.** Verbatim from that run: `[gui.cpp:1057]: Tried to get gui_type
  [gui_probe_q2_zzz_no_such_window_diplo] which does not exist`, then the engine substitutes
  `interface/popup.gui`'s `ok_popup_window` and demands the diplomatic window's ten hardcoded element
  names inside it (ten `[containerwindow.h:88]: interface/popup.gui: Could not find … in window
  "ok_popup_window".` lines), then `Unhandled Exception C0000005 (EXCEPTION_ACCESS_VIOLATION)` - the
  same fault address and a byte-identical stack body in run F and the v2 run of the same night. On the
  **non-diplomatic** path the same kind of name (`.3`) wrote **nothing at all** - not even its lookup
  line, 0 occurrences in the whole log - did not crash, and the engine drew the **ordinary default
  event window** rather than the window the event named. `PROBE-RESULTS.md` §4 and §10.1; filed as
  **GAP-17** and closed by `custom-gui-unknown-window`, which grades exactly this split.

## Rules

- A mod that wants its OWN window uses `custom_gui` on an event. There is no other door, and no
  amount of script will create one.
- A mod that wants its elements to appear on an EXISTING view overrides that view's `.gui` file, which
  needs no script at all - and pays for it with a full-file override (`host-gui-surface`).
- Do not reach for `force_show_diplomacy`/`force_show_espionage` as a general "open my panel" route:
  both are documented as working only inside `on_custom_diplomacy` events, relic activation effects, or
  events triggered from those, and both target the DIPLOMACY view, not a mod's window.
- Do not look for a close effect. `window-dismissal` is the mechanism; an event option is the only exit.
- **Always make `custom_gui` name a window that exists**, and check it yourself: `custom-gui-unknown-window`
  resolves the name against the plugin's own index, because the engine validates it nowhere - not at
  load time and not at build time. On a `diplomatic = yes` event a name that resolves to nothing does
  not produce an error, it produces a crash (Evidence above), and that is why the rule is an ERROR
  there; without the flag the engine writes nothing and draws the ordinary default event window, so it
  is a warning. `diplomatic = yes` is still the right default to emit (65/65 vanilla uses carry it, and
  it selects the diplomatic window class), but the reason is convention and class choice, **not** "the
  field needs it".
- When a claim here is "the engine cannot", it is settled from `script_documentation` or a literal in
  the binary - never from "vanilla does not do it" (`engine-capability-vs-usage`).
- `gui_log_scan` is the offline check for what actually happened: `selectedOption N` in order is the
  only record of which control was clicked.

## 待确认

- ~~Whether `custom_gui` has any effect on a NON-event window class. The binary has five event-window
  classes and `custom_gui` is consumed by `diplomatic_eventwindow.cpp`; whether `CEventWindow`
  (non-`diplomatic`) also honours it was NOT established here.~~ **Established for the non-diplomatic
  EVENT class on 2026-10-06: it does** (see Evidence; vanilla still offers no case - all 65
  `custom_gui` events in this install set `diplomatic = yes`). What is **not** established now is
  narrower: whether the window the engine drew for that non-diplomatic probe event was the mod's own
  `containerWindowType` or something else (a successful resolve writes **no** log line), and what the
  non-diplomatic path does for a name that does not resolve. The v2 run measured that half from the
  negative side - the name occurs **0** times in the whole log, so the engine wrote nothing at all, not
  even its lookup line - and the window the user saw is the ordinary default event window, the same
  thing an event with no `custom_gui` shows; no line names the container, so that identification is a
  report rather than a measurement. The emitter's `diplomatic = yes` default therefore stays - for the
  convention and the window class, not as a requirement.
- The recorded event counts in `docs/gui-pitfalls.md` §4 (5563 events / 113 `force_open` /
  36 `custom_gui`) do NOT match this topic's fresh measurement (13889 / 124 / 65) on the same install.
  Both cannot be right and WHICH ONE IS WRONG was not established: the older figures may have been
  taken over a narrower key set or a different install state. The claims in this topic use only the
  fresh, reproducible counts; the discrepancy is recorded rather than papered over.
- Whether `open_shroud_tab` and `set_advisor_active` can be pointed at anything other than the two
  windows the engine owns. They are described as opening a specific tab and toggling a specific
  pop-in, both with country scope; nothing in the documentation offers a name parameter.
- No in-game verification was possible when this topic was written: loading a probe mod needs
  `dlc_load.json`, which is out of bounds for the plugin's own checks. **That changed on 2026-10-06**,
  when a human ran the probe in a loaded game and the run's logs were read back (Evidence above): the
  effect census in this topic still rests on the engine's own generated documentation, its binary and
  its content, and the two window-class/dismissal facts now rest on that run.
