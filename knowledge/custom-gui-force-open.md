---
id: custom-gui-force-open
category: script
title: force_open + custom_gui is a smell, and the count is 113 / 36 / 0
title_zh: force_open 与 custom_gui 同时使用是个味道——113 / 36 / 0
summary: Over the install's own 5563 events, 113 carry force_open = yes, 36 carry custom_gui, and ZERO carry both. The plugin reports the combination as a warning, not an error, because the trial mod shipped it for weeks and could never prove it necessary or harmful - and the mod's own comment claiming the combination was required is not evidence.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.txt]
tags: [force_open, custom_gui, events, event-option, warning, smell, unproven, engine-capability-vs-usage]
related: [window-dismissal, engine-capability-vs-usage, window-name-contract]
sources: []
---

## What it is

`force_open = yes` and `custom_gui = "<window>"` on the same event appears **nowhere in vanilla**:
over the install's own `events/` (174 files, 5563 events), 113 events carry `force_open = yes`, 36
carry `custom_gui`, and the intersection is **0**.

The plugin reports the combination as a **warning** — a smell, not a proven bug — because the trial
mod shipped it for weeks and could never prove it necessary or harmful. The finding tells the reader to
try removing it rather than asserting a fault.

## Syntax

```
country_event = {
	id = geocentric_unga.1
	# force_open = yes          # <- with custom_gui below, this is the reported combination
	custom_gui = "geocentric_unga_main"

	option = {                  # an event that renders a custom_gui window still needs an option:
		name = geocentric_unga_ok  # the option is what CLOSES the window
	}
}
```

## Where the wrong belief came from

The working mod's own `.gui` header comment asserted that the combination was required. A comment in
the mod is NOT evidence about the engine — it records what its author believed — and this is the same
class of mistake as counting vanilla usage (see the `engine-capability-vs-usage` topic), with a source
that looks authoritative because it is written down.

## Evidence

- `events`, over the install's own `events/` (174 files): **5563** events, **113** carry `force_open = yes`, **36** carry `custom_gui`, **0** carry both. Reproduce with `node out/probe-event-patterns.mjs` / `node out/probe-custom-gui.mjs`. `docs/gui-pitfalls.md:195-198`.
- `vanilla`: the install's 156 `custom_gui` uses (10 distinct window names; `enclave_caravaneer_option` alone is 85 of them) never combine it either. `docs/gui-pitfalls.md:197-198`.
- `measured`: the trial mod shipped the combination for weeks, and a round was spent wondering whether `force_open` was the reason a window opened twice before anyone counted. `docs/gui-pitfalls.md:200-202`.
- `measured`: the finding is a warning and its text says to try removing it, deliberately — an error would assert a fault the project cannot demonstrate. `docs/gui-pitfalls.md:203-205`.
- `vanilla`: 154 of 156 `custom_gui` uses carry `diplomatic = yes`, which is likewise the overwhelming convention and NOT an engine requirement (`docs/sources.md:252-273`) — the same shape of claim, and as of **2026-10-06** the same *answer*: the field resolves without the flag (the engine builds a different event-window class), measured in a loaded game (`script-routes-to-a-window`, Evidence). The count was right; the "requires" reading was wrong.

## Rules

- Report `force_open` + `custom_gui` as `custom-gui-force-open` (**warning**), and read the finding as "try removing it", not "this is broken".
- Do not raise it to an error without a reproduction. The severity is the statement about how much this project knows.
- A comment inside a mod is not evidence about the engine. It records a belief, and it is exactly the kind of source that needs a count behind it.
- This is an `info`/`warning`-class question, not a contract question: the window renders either way; what is unproven is whether the flag does anything useful (see the `window-dismissal` topic for what actually controls when a window goes away).

## 待确认

- Whether `force_open` has ANY effect on a `custom_gui` window. The combination is never exercised in vanilla, and the trial mod could not distinguish its effect from the option-0 re-open cycle that was actually happening. An in-game A/B would settle it.
