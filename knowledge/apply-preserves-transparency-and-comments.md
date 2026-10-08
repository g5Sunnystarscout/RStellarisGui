---
id: apply-preserves-transparency-and-comments
category: tooling
title: apply_to splices a change into the ORIGINAL BYTES, so a no-edit round trip is byte-identical
title_zh: apply_to 把改动拼进原始字节，所以无改动的往返是逐字节相同的
summary: Import then emit rebuilds a .gui from the tree, and the tree does not model comments - measured on the real 146,310-byte file it dropped 132 comment-bearing lines to 6 and added ~524 lines of explicit orientation = upper_left. The fix is an APPLY mode that diffs the edited tree against the tree as imported and splices only the changed elements back into the original bytes, which makes a no-edit apply byte-identical and keeps every comment block in place.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui]
tags: [apply_to, apply_dry_run, comments, byte-identity, round-trip, sha256, sameSubtree, prepareEngineCoordinates, mutation, baseline, GAP-4]
related: [parking-elements, per-kind-size-and-field-forms, gui-layout-tool-surface]
sources: [<mods>/geocentric_origin/interface/zz_geocentric_unga.gui]
---

## What it is

`gui_layout_import` -> `gui_emit_files` rebuilds the file from the tree, and **the tree does not model
comments**. Measured on the real 146,310-byte mod file
(`interface/zz_geocentric_unga.gui`, sha256 `D6FBEE3C2BA87D65...`), the round trip:

* preserved all **639** element `name = "..."` tokens — 0 dropped, 0 added, 0 renamed;
* dropped **132 comment-bearing lines to 6** (the emitter's own generated header);
* gained **~524 lines** of explicit `orientation = upper_left` on elements whose file omitted it.

No ELEMENT was lost. What was lost is the file's own record of *which element names the engine
dereferences by name* — `# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE` above the crash-critical contract
names, and a `# DIAGNOSTIC (2026-10-05): was buttonType` note recording why the close control is an
`effectbuttonType`. The file is the record of what the engine does; a write path that discards it
silently discards the reasoning.

## The fix: an APPLY mode, not a comment-carrying tree

`gui_emit_files { apply_to: "<path>.gui" }` diffs the edited tree against the tree as it was IMPORTED
and splices only the changed elements back into the ORIGINAL bytes (`src/lib/apply.mjs`).

The alternative — carrying `precedingComments` through `parseGuiText` -> node metadata ->
`renderElement` — was rejected as the bigger change and the weaker one: it preserves comments only for
elements the parser attached them to, and it still re-emits every line, so field order and spelling
would still normalise.

## Syntax

```jsonc
// The call, and the gate it has to pass.
{
  "tool": "gui_emit_files",
  "layout_id": "geocentric_unga_main",
  "apply_to": "<mods>\\mod\\interface\\zz_something.gui",
  "apply_dry_run": true
}
// -> { changed: [...], added: [...], removed: [...], diffLineCount, syntaxCheck,
//      identical: <boolean>, rewrittenBytes, patched: "<text>" }
```

```
# The measured gates on the real file:
#
#   no-edit apply     146,310 -> 146,310 bytes, same sha256, comments 132 -> 132,
#                     diff {added:0, removed:0, changed:0}, 0 lines rewritten
#   one-field edit    changes 3 lines (the value + the emitter's orientation default),
#                     rewrites exactly ONE leaf, keeps all 132 comment lines
#                     including all four marker blocks
```

## The four traps, each measured

Itemised under `## Breaks`. What they have in common is the point of the section: every one of them
compares or renders the WRONG THING — the model's order against the file's, rendered text against
source text, a mutated tree against a pristine one, a fresh node id against an old one — and every one
of them therefore either rewrites the whole file or declares it entirely changed.

## Trap 5 (GAP-4): an ADD is not a splice

For an element the edit **created** there is nothing to copy, and three separate mistakes lived in that
branch (itemised under `## Breaks`). Each was invisible to `checkGuiSyntax` (the output stays balanced)
and to a "count the windows" check (the damage is indented).

Two rules follow, and both are now asserted on the OUTPUT (one occurrence of each window name, at one
tab): **an added element is rendered, not spliced**, and **an element with no block adopts no other
element's block**.

The **baseline guard** had the same shape of mistake. `apply_to` refuses when it cannot identify the
tree the file was imported as, and it required the baseline's window-name list to be **exactly** the
edited tree's. An edit that adds a window changes that list BY CONSTRUCTION, so the one edit a
multi-window `.gui` most needs was the one the guard refused — and it reported "no baseline was found"
while listing candidates that were all valid baselines. The property the exact-match rule was a proxy
for is **subsumption** (every baseline window survives in the edited tree), which is what it now
checks, with the relaxed choice announced in `baseline_note` naming the windows the edit added.

## What apply does NOT carry

A re-emitted element is written in the emitter's field order and gains the explicit `orientation`.
Comments INSIDE a re-emitted element are not carried (the comment block ABOVE it is). An element the
edit did not touch is untouched byte-for-byte.

## Writes

Apply is the one mode that patches an existing file, so it names its target explicitly and still:

* refuses a path inside the install or the user-data folder;
* refuses a non-`.gui`;
* refuses a missing file;
* refuses a BOM-carrying file;
* refuses to write when the patched text fails `checkGuiSyntax`.

## Breaks

- **The write order.** The FILE's order and the MODEL's order differ when an edit moves a child. Writing the model's order directly DROPPED everything after a changed child's original block: the `# ENGINE-REQUIRED ELEMENTS - DO NOT REMOVE` block, which follows a changed element, vanished. The splice walks the original lines in order and replaces a child's own block in place.
- **"Unchanged" decided from rendered text.** A re-render of an UNTOUCHED element is not byte-equal to its source, so comparing rendered text against source text reports ~500 of 542 elements changed. The authority is the MODEL.
- **Running `prepareEngineCoordinates` on the tree being compared.** It mutates its argument, giving every node a `coordinateFields` the baseline does not have: measured, 12 "changes" and a 146,848-byte file on a submission with NO edits.
- **Comparing node ids across an edit.** `applyEdits` deep-clones and assigns FRESH ids, so every element reports as changed. A node id never reaches the file and is not content.
- **GAP-4, the new element's body was the WHOLE FILE.** The interior walk fell back to `{ from: 0, to: lines.length - 1 }` for an element with no source block, so the added window absorbed every original line and nested it inside itself. Measured: one two-element window took the 146,310-byte file to 300,332 bytes with two copies of every window; five clones took it to 923,055 bytes with six copies of the first.
- **GAP-4, a new element ADOPTED another element's block.** Child matching searched the whole file when the parent had no block, so a child that merely shared a NAME with an unrelated element (a `.gui` has several `close`, `portrait` and `*_value_num` names per file) was treated as already present, its block was never emitted — it lies outside the new element's range — and the new window came out EMPTY.
- **GAP-4, the new element's own field lines were dropped.** An element that has a block copies its interior byte for byte; an element that does not has nothing to copy, so the rendered `split.fields` is the only source of `name`, `position`, `size` and the kind-specific fields. Dropping them emitted a bare `containerWindowType = { ... }` with no `name` at all, unaddressable by `custom_gui`.

## Evidence

- `measured`: the round-trip counts on the real file — 639 name tokens preserved, 132 comment lines to 6, ~524 added `orientation` lines. `docs/gui-pitfalls.md:656-666`.
- `measured`: no-edit apply is byte-identical at 146,310 -> 146,310 bytes with the same sha256, comments 132 -> 132, and diff `{added:0, removed:0, changed:0}`. Enforced by construction: an element whose subtree is unchanged contributes its ORIGINAL lines, never a render. `docs/gui-pitfalls.md:677-679`.
- `measured`: a one-field edit changes 3 lines, rewrites exactly one leaf, and keeps all 132 comment lines including all four marker blocks. `docs/gui-pitfalls.md:680-681`.
- `measured`: each trap above is stated with its own number in `docs/gui-pitfalls.md:683-699`.
- `measured` (GAP-4): the 300,332-byte / 923,055-byte failures and the emptied new window, with the fix landed in commit `801f0a3`. `docs/gui-pitfalls.md:888-921`, `<clone>/unga-fix/PLUGIN-GAPS.md:248-370`.
- `measured`: the suite covers it in `scripts/selftest.mjs`, group "apply mode (the edited tree goes back into the file)" — **32 assertions**, including the byte-identity of a no-edit apply, the kept comments at all four positions (before the window, after its fields, between children, after the last child), the changed-line count for a one-field edit, and the same splice through `submitHandoff`. Removing the `sameSubtree` change test makes that group fail (`an apply with no edits rewrites NOTHING`). `docs/gui-pitfalls.md:710-714`; GAP-4 has its own group, "apply mode: adding a top-level window (GAP-4)".
- `measured`: `gui_layout_import` -> `gui_emit_files` loses NO element — 639 name tokens in, 639 out, 0 added, 0 dropped, 0 renamed. `<clone>/unga-fix/PLUGIN-GAPS.md:783-784`.

## Rules

- Patch an existing `.gui` with `apply_to`, never by re-emitting it. Re-emitting is for standalone output files only.
- A no-edit apply MUST be byte-identical. Treat any byte difference as a defect in the apply, not as normalisation.
- Decide "unchanged" from the MODEL (`sameSubtree`), never from rendered text.
- Never run `prepareEngineCoordinates` on a tree you are about to compare; render from a clone.
- Never compare node `id`s across an edit; `applyEdits` assigns fresh ones.
- An added element is RENDERED; an element with no source block adopts no other element's block.
- Keep the baseline guard a SUBSUMPTION test, not an equality test, and announce the relaxed choice.
- Apply is a write path: keep every refusal (install, user-data folder, non-`.gui`, missing file, BOM, failing syntax check) and keep the dry run.

## 待确认

- Whether a comment INSIDE a re-emitted element can be carried without a comment model in the tree. It is currently not carried, and the comment block above the element is; whether the engine's own readability would benefit from more is a judgement this project has not measured.
