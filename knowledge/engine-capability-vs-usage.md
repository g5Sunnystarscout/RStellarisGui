---
id: engine-capability-vs-usage
category: script
title: Engine capability is NOT vanilla usage - four wrong conclusions from counting content
title_zh: 引擎能力不等于 vanilla 用法——四次因统计内容而得出的错误结论
summary: Four separate wrong conclusions in this project came from counting what vanilla CONTENT uses and treating the count as a statement about the ENGINE. The rule the project follows instead is - derive a rule from the engine's binary, its generated script_documentation, its own error log; cross-check against content, and say which one the claim rests on.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui, .txt]
tags: [method, evidence, vanilla-usage, engine-capability, force_open, custom_gui, pieChartType, diplomatic, bracket, provenance]
related: [window-name-contract, custom-gui-force-open, coordinate-calibration, per-kind-size-and-field-forms]
sources: []
---

## What it is

A method rule, and the one this knowledge base is built to respect. Counting what the install's own
content USES answers "what do shipped files do", not "what will the engine accept". The two differ,
and three of this project's wrong turns were exactly that substitution. A fourth produced a shipped
user-visible defect.

## The four, with what counting said and what the engine says

| wrong conclusion | how counting produced it | what the engine actually says |
| --- | --- | --- |
| `pieChartType` cannot be a `.gui` element | 0 `.gui` uses install-wide | it is a `.gfx` SPRITE kind (`interface/government_view.gfx:215`) and a live engine chart exists |
| `custom_gui` "requires" `diplomatic = yes` | 154 of 156 uses had it | the engine has no such requirement; it is the overwhelming convention. **Confirmed in a loaded game 2026-10-06**: the field resolves without it, and the engine simply builds a different event-window class (`script-routes-to-a-window` Evidence) |
| "localisation has no numeric accessor" | counting bracket uses in vanilla | `defined_text { value = value:<script_value> }` in `common/scripted_loc/`, consumed as `[This.<Name>]`, is a real, live mechanism |
| "a bracket data function works anywhere, vanilla uses it 9201 times" | counting bracket uses in vanilla | those 9201 uses are tooltips, descriptions and event text; in a WINDOW's painted text the call **renders literally** — measured in game |

The fourth is the expensive one: the count was correct, the generalisation from it was not, and the
result was a raw `[Root.GetName]` on screen in a shipped mod (see the `text-channels` topic).

## Syntax

```
# The evidence tags this project uses in docs/gui-pitfalls.md §0, and the same vocabulary the
# `## Evidence` sections of these topics use:
#
#   binary    a literal in <Stellaris>\stellaris.exe
#   vanilla   a count over the install's own 177 .gui files  <- CONTENT, never the source of truth
#   events    a count over the install's own events/ (174 files)
#   log       the engine's runtime output (error.log, game.log, script_documentation/)
#   measured  this project's own experiment, stated with its numbers
#
# src/lib/contract.mjs states BOTH for every contract name:
contract_name { group: 'binary', windows: 11 }   # the engine asks for it AND 11 vanilla files declare it
```

## Why the distinction is load-bearing, concretely

`REQUIRED_WINDOW_NAMES` is derived from a table that records, per name, whether the engine's binary
table contains it (`group: 'binary'`) and how many of the install's 177 `.gui` files declare it
(`windows: N`). A name is demanded only when BOTH signals agree, or when a working window declares it.
That is why the checker does not report the live-verified trial mod — and 8 of the install's own 10
event windows — as broken: demanding all 32 names would have been the "capability = usage" mistake
run in the safe-looking direction.

The `force_open` + `custom_gui` case is the same mistake in the opposite direction: see the
`custom-gui-force-open` topic, where the mod's own comment claimed the combination was required and
the count says the engine has no such relationship.

## Evidence

- `vanilla`: `pieChartType` has 0 `.gui` uses install-wide, but `interface/government_view.gfx:215` is a `.gfx` SPRITE kind and a live engine chart exists. `docs/gui-pitfalls.md:339`.
- `vanilla`: 154 of 156 `custom_gui` uses carry `diplomatic = yes`, but the engine has no such requirement. `docs/gui-pitfalls.md:340`, `docs/sources.md:252-273`. **`measured`, 2026-10-06**: in a loaded game the non-diplomatic probe event `.2` built an event window from its `custom_gui` where the diplomatic `.1` built a diplomatic one - so the field resolves without the flag and the flag is what selects the class. The same run showed the price of getting the *name* wrong: with `diplomatic = yes` an unresolvable `custom_gui` name crashes the game (`PROBE-RESULTS.md` §4, GAP-17).
- `vanilla`/`binary`: `defined_text { value = value:<script_value> }` in `common/scripted_loc/` consumed as `[This.<Name>]` is a real, live mechanism — `common/scripted_loc/00_scripted_loc.txt:3227-3230` -> `localisation/english/toxoids_l_english.yml:735`. `docs/gui-pitfalls.md:341,385-386`.
- `vanilla`/`measured`: bracket calls appear 9201 times in `localisation/english/*.yml` and those uses are tooltips, descriptions and event text; in a window's painted text the call renders literally, measured in game. `docs/gui-pitfalls.md:342,359-371`.
- `measured`: this document's method rule is stated as the rule the pitfalls file exists to enforce — "the engine is the source of truth: its binary, its generated `script_documentation`, its logs. Vanilla content is a cross-check, never the source." `docs/gui-pitfalls.md:28-31`.
- `measured`: the coordinate model was decided by a CORPUS measurement of containment rather than by argument from examples — the same discipline, applied where the engine exposes no direct answer. See the `coordinate-calibration` topic.
- `measured`, a related negative: `common/custom_tooltips/` does not exist, `is_repeatable` occurs 0 times in technology, `major` 0 times in events, and `common/name_lists/*.txt` **does** carry a BOM in vanilla. Each of these is a claim a count can settle, and each is recorded with its count.
- `log`: the sibling project reached the same conclusion independently for modifier keys, where an unknown key is silently inert; its `docs/porting-notes.zh-CN.md:71` records the same "写错不报错、只是不生效" (wrong means no error, just no effect) class.

## Rules

- Before writing a rule, say which side it rests on: the engine (binary string table, generated `script_documentation`, runtime log) or content (a count over vanilla). If it rests on content, say so and do not present it as a capability statement.
- When the two disagree, say which one the claim rests on and prefer the engine. `src/lib/contract.mjs` does this per name.
- A count of 0 uses means "vanilla does not do this", never "the engine cannot". A count of N uses means "vanilla does this", never "the engine requires this".
- Never let a check call a live-verified mod broken. That is the signal that the demanded set was derived from the wrong side.
- Mark the unproven. A `## 待确认` section in a knowledge topic, or a `warning` rather than an `error` in the validator, is how this project records "we could not establish this".
- Prefer a corpus measurement to an argument from examples when the engine gives no direct answer — the coordinate model is the worked case.

## 待确认

- ~~Whether `diplomatic = yes` has ANY engine effect on a `custom_gui` window, or is purely
  conventional.~~ **Answered 2026-10-06: it has an effect, and it is not the one the count implied.**
  It selects the **event-window class** - with it the engine builds a diplomatic window, without it an
  ordinary event window, and `custom_gui` resolves in both cases (`script-routes-to-a-window`,
  Evidence). It is also the difference between a mistake being fatal and merely silent: an unresolvable
  `custom_gui` name **crashes** on the diplomatic path (the engine substitutes `ok_popup_window`,
  demands the diplomatic contract inside it and null-dereferences), while without the flag the engine
  writes nothing at all - not even its lookup line - and draws the ordinary default event window. That
  is why the plugin grades the same defect ERROR on one path and a warning on the other
  (`custom-gui-unknown-window`, GAP-17). Vanilla's 154/156 is still why the emitter writes the flag by
  default - convention plus the class, not a requirement.
