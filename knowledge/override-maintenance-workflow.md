---
id: override-maintenance-workflow
category: tooling
title: The override anti-drift workflow - base hash, drift report, re-splice
title_zh: 覆写的防漂移流程——基线哈希、漂移报告、重新拼接
summary: An override goes stale when the vanilla base moves, and the failure is silent (the file still parses, the game still loads, your edit is simply written over newer vanilla content). This topic is the three-step workflow that makes that mechanical instead of remembered - record the base as a sha256, ask gui_override_drift whether it moved and WHAT changed under you, then re-apply onto the new base with gui_emit_files apply_to so untouched lines stay byte-identical. Every step is a tool, every claim here is measured on the two shipped overrides on this machine and on a fixture whose base is deliberately moved.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui]
tags: [override, drift, sha256, apply_to, gui_emit_override, gui_override_drift, workflow, maintenance, container-path-override, container-name-collision, dlc_load]
related: [host-gui-surface, script-routes-to-a-window, apply-preserves-transparency-and-comments, engine-populated-containers]
sources: []
---

## What it is

The failure mode of a vanilla override is not that it is fragile. It is that **the base moves and
nothing says so.** A patch changes a container's name, a size, or adds an element; the mod's copy is
now the OLD file; the game loads it happily, and the mod is silently shipping stale vanilla content
over the new version. Every geometric check passes, because the file is still a legal `.gui`.

So the workflow is three steps, and each one exists because the previous one can only be trusted if
the next one is mechanical:

1. **RECORD THE BASE** — the vanilla file's `sha256`, in the override's own header. Prose ("4.4.6")
   tells a human; a hash tells the machine. `gui_emit_override` writes
   `# vanilla source sha256: <64 hex>` and refuses a later run whose `expected_source_hash` no longer
   matches — a refusal with a name instead of a silent regression.
2. **ASK WHAT MOVED** — `gui_override_drift` compares the mod's copy against the vanilla file on disk
   NOW and answers four questions: did the recorded hash change; which elements does the current
   vanilla file declare that your copy does NOT (vanilla content you are dropping); which elements
   does your copy declare that vanilla never did (your additions, and the container each hangs off);
   and which elements do you CHANGE, with the direction spelled out. The last one is the one that
   matters for a slot-expanding mod, because its whole edit is four numbers.
3. **RE-APPLY ONTO THE NEW BASE** — re-copy the current vanilla file and re-apply your edit. Use
   `gui_emit_files { apply_to }`, which diffs your edited tree against the imported baseline and
   performs targeted textual insertions into the ORIGINAL bytes, so every line you did not touch stays
   identical — the file's comments included, which in this project's case are the engine-contract
   notes.

**Neither shipped override on this machine has step 1.** Both say "re-copy when the version changes"
in prose and neither records a hash, so `gui_override_drift` reports
`override-base-unrecorded` about both and CANNOT tell whether they are stale. That is not a criticism
of those mods — it is the reason the step is worth a tool. Both were also confirmed a strict SUPERSET
of their base (`missing` = 0), which is what a good override looks like.

## Syntax

```
# 1. RECORD. The header gui_emit_override writes, and the refusal it enables.
# vanilla source sha256: 7c9b911a34b48d0338823be2798c7a432edaeefc52692714e0ad3d6dc97a44d7
#   gui_emit_override { vanilla_path, additions: [...],
#                       expected_source_hash: "<the hash from last time>",
#                       i_understand_this_overrides_vanilla_file: true, output_root }
#   -> refuses: "the vanilla file has changed since this override was built"

# 2. ASK. Read-only on both files.
#   gui_override_drift { overridden_path: "<mod>/interface/fleet_view.gui",
#                        vanilla_path:    "<install>/interface/fleet_view.gui" }
#   {
#     baseHash:  { recorded, current, moved: true|false|null },   // null = nothing was recorded
#     elements:  { added: [...], missing: [...], changed: [...], unchangedCount },
#     splicePoints: [ { element, container, containerExists, containerIsOwnAddition } ],
#     version:   { install: "v4.4.6", modSupported: "v4.4.*", covered: true },
#     verdict:   "current" | "base moved, nothing lost" |
#                "stale: re-copy the vanilla base and re-apply the edits" |
#                "undetectable: the override records no base hash",
#     findings:  [ ...one per rule below, with the numbers in the message... ]
#   }

# 3. RE-APPLY. The add path, which keeps untouched lines byte-identical by construction.
#   gui_layout_import { path: "<mod>/interface/fleet_view.gui", layout_id: "lv" }
#   gui_layout_edit   { layout_id: "lv", edits: [ ... ] }
#   gui_emit_files    { layout_id: "lv", apply_to: "<mod>/interface/fleet_view.gui",
#                       output_root, dry_run: false }
```

## The rules, and what each one is for

| rule | severity | fires when |
| --- | --- | --- |
| `override-base-moved` | warning | the recorded `sha256` is not the vanilla file's hash now — the base moved |
| `override-base-unrecorded` | warning | the header carries no `# vanilla source sha256:` line, so drift is undetectable |
| `override-vanilla-content-missing` | **error** | the current vanilla file declares elements your copy does not — you are DROPPING them for the whole load order. An override replaces; it does not merge |
| `override-modifies-vanilla-element` | info | you change fields on vanilla elements. Reported with the direction (`vanilla 500x448 -> your copy 700x520`) because it is a DECISION — the ascension-slot technique — and the part a base move invalidates first |
| `override-splice-container-missing` | error | an addition hangs off a container that neither the vanilla file nor your override declares — an integrity failure of a non-full-copy override |
| `override-unsupported-version` | warning | `descriptor.mod`'s `supported_version` does not cover the install's version |

The reason `override-vanilla-content-missing` is an ERROR and not a warning: its consequence is
invisible. The file parses, the engine loads it, and the vanilla elements the patch added are simply
absent from the game while that mod is installed — which is the whole failure the workflow exists to
prevent.

## Evidence

- `measured`: `gui_override_drift` on `aerospace_carrier/interface/fleet_view.gui` against
  `<Stellaris>\interface\fleet_view.gui` reports `added` = 3
  (`aerospace_carrier_bridge_bar` -> `bottom`, `aerospace_carrier_muster_button` and
  `aerospace_carrier_bombard_button` -> `aerospace_carrier_bridge_bar`), `missing` = **0**,
  `changed` = **0**, `unchangedCount` = 132, `baseHash.moved` = **null**, and
  `override-base-unrecorded`. Verdict: `undetectable`.
- `measured`: the same call on `geocentric_origin/interface/planet_view.gui` reports `added` = 1
  (`unga_open_button` -> `header_actions`), `missing` = 0, `changed` = 0, `unchangedCount` = 627, and
  the same `override-base-unrecorded`.
- `measured`: a line-level comparison of the Aerospace Carrier file against vanilla finds **43 lines
  present only in the mod file and 0 present only in vanilla** — a strict superset, which is why
  `missing` is 0 and why an override that follows the pattern goes stale only when vanilla ADDS.
- `measured`, on a fixture whose base is deliberately moved
  (`scripts/fixtures/host_override/vanilla_host_v2.gui` changes the container's size and adds an
  element): `baseHash.moved` = true, `override-vanilla-content-missing` (error) names
  `zz_surface_host_patch_badge`, `override-modifies-vanilla-element` reports
  `zz_surface_host (size vanilla 560x320 -> your copy 520x300)`, and the verdict is
  `stale: re-copy the vanilla base and re-apply the edits`. `scripts/selftest.mjs` asserts each of
  those, so the drift report is never shipped unexercised.
- `measured`: an override whose ONLY edit is a number
  (`scripts/fixtures/host_override/number_change_only.gui`, the ascension-slot shape) reports
  `added` = 0 and `changed` = 1. Without the `changed` half of the report this file would read as
  "no changes" — which is exactly the case the ascension-perk mods live in.
- `measured`: the install version and the mod's declared support agree —
  `launcher-settings.json rawVersion` = `v4.4.6`, `aerospace_carrier/descriptor.mod`
  `supported_version="v4.4.*"`, and `versionCovers` returns true.
- `measured`: the compile-time door is the same hash. `gui_emit_override` writes the base's sha256 in
  the output header, and its own `expected_source_hash` refuses a moved base; the fixture
  `planet_view_mini.gui` therefore reports `baseHash.moved = false` and verdict `current`.
- `measured`: the apply path (`gui_emit_files { apply_to }`) is the re-apply step and is asserted
  separately - a round trip with no edit reproduces the file byte for byte, and an edit that ADDS a
  top-level window keeps every untouched line identical (`gui-pitfalls.md` §15, GAP-4).
- `log`, **2026-10-06 - one file per relative path, and the LAST mount wins** (probed in a loaded
  game; `PROBE-RESULTS.md` section 3). Two mods each shipped `interface/input_blocker.gui`; with
  `… ovr_alpha -> ovr_beta` in `dlc_load.json` only **beta**'s markers appear in `error.log`, and with
  the entries swapped only **alpha**'s do - a log that reports both kinds of marker the probe planted
  (`Unexpected token: <its own token>` and `gridbox.cpp:51 Invalid format "<its own format>"`). The
  losing file is not merged and not shadowed at lookup: **it is never parsed**. The engine's own
  `Found duplicate containerWindowType` reporter never fires, because the loser's container never
  reaches the loaded set. Nothing about a mod's own UNIQUELY named files is affected.

## Rules

- Always record the base. If a `.gui` override in your mod has no `# vanilla source sha256:` line, the
  first thing to do is re-emit it through `gui_emit_override` (or add the line), because until then
  nobody — human or tool — can tell whether it is stale.
- Ask `gui_override_drift` after every game update, and read `missing` first: a non-empty `missing` is
  vanilla content you are dropping right now.
- Re-apply, do not re-copy your old numbers. On a base move, the current vanilla file is the truth and
  your edit is the delta.
- Use `apply_to` for the re-apply, not a regenerate: a regenerate reflows the file and loses the
  comments, and the comments are the engine-contract record (`gui-pitfalls.md` §15).
- Read `changed` even when you added nothing. A slot-expansion mod's entire edit is numbers, and a
  report that only counted additions would call its file current.
- Treat `override-vanilla-content-missing` as blocking. It is the one finding whose consequence the
  player sees and no other check catches.
- An override is the ONLY copy of that relative path the engine parses. Measured in a loaded game on
  2026-10-06 by shipping `interface/input_blocker.gui` from two mods and flipping their order in
  `dlc_load.json`: the winner is the LAST entry and the loser's file is never read at all (its unique
  markers are absent from a log that reports the winner's). So two providers of one relative path are
  `container-path-override` (**info**, reported with the load-order fact), and only two providers at
  DIFFERENT relative paths are `container-name-collision` (**error**) — then both files load and both
  declare the name. `PROBE-RESULTS.md` section 3; GAP-14.
- To find out WHICH copy the engine actually read, plant a deliberately invalid `format` in a
  `gridBoxType` of your file: `gridbox.cpp:51` prints the file name
  (`interface/input_blocker.gui: Invalid format "..." in gridBoxType "..."`), where
  `persistent.cpp:41` ("Unexpected token") prints a line number and no file.

## 待确认

- Whether a `sha256` recorded against one game version stays meaningful across a DLC-only update that
  does not touch the file. The hash answers "did THIS file change", which is the right question, but
  whether a Paradox patch rewrites untouched files wholesale was not measured.
- Whether the engine reports anything at all about a stale override. No log line was observed for
  either shipped override, and the mods' own headers are prose rather than a check, so the failure is
  believed to be entirely silent — believed, not proven.
- Whether `descriptor.mod`'s `supported_version` is enforced by the launcher as anything more than a
  warning. This project only compares the strings; nothing observed the launcher's behaviour.
