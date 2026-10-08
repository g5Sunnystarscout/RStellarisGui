---
id: coordinate-calibration
category: layout
title: The calibration numbers behind the coordinate model
title_zh: 坐标模型背后的标定数字
summary: The coordinate system is trustworthy because it was measured over the whole vanilla corpus rather than assumed. scripts/calibrate-coords.mjs parses all 177 vanilla .gui files, computes every rect at every nesting depth under both candidate models, and reports containment per orientation family - the shipped model wins on aggregate containment and by a factor of eight on the lower_* family.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui]
tags: [calibration, containment, lower_left, coordinate-system, measurement, corpus, provenance]
related: [coordinate-semantics, engine-capability-vs-usage]
sources: []
---

## What it is

Two models of `.gui` geometry are both self-consistent and both produce plausible output:

* **Model A (shipped)** — `position` is added to the parent's `orientation` anchor, and the sign of
  `y` is never negated. `dirY = 1` everywhere.
* **Model B (rejected)** — `position.y` is negated for the bottom anchors (`lower_*`), on the theory
  that a lower anchor means "measured upwards".

`docs/sources.md` §3a records the measurement that settled it. It is re-runnable on any machine with
the install:

```
node scripts/calibrate-coords.mjs            # the shipped model's figures
node scripts/calibrate-coords.mjs --compare  # the side-by-side, which is the point
node scripts/calibrate-coords.mjs --examples # the worked vanilla cases
node scripts/calibrate-coords.mjs --json     # the raw numbers
```

## The measured result

| family | Model A (shipped) | Model B (negate y for `lower_*`) |
| --- | --- | --- |
| aggregate containment | **0.7733** | 0.7472 |
| the `lower_*` family | **0.7398** | 0.0938 |

The aggregate difference is small enough that either model could be argued for from a handful of
examples. The `lower_*` family is not: 0.7398 versus 0.0938 means Model B loses containment for
essentially every element anchored to a bottom edge. That is the number the decision rests on.

## Why "containment" is the right metric

It needs no ground truth beyond the files. An element is normally placed INSIDE its parent — that is
what a layout is for — so a model under which children routinely fall outside their parents is
describing a different coordinate system from the one the author wrote against. The `lower_*` family
is where the two models disagree, so it is where the metric has power; the aggregate is reported
because reporting only the winning family would look like cherry-picking.

## Syntax

```
# The two models, as arithmetic. Only dirY differs.
# Model A (shipped, src/lib/coords.mjs yDirectionForAnchor -> 1):
pivot = anchorPoint(parentRect, orientation) + (position.x, position.y)

# Model B (rejected):
pivot = anchorPoint(parentRect, orientation) + (position.x, -position.y)
```

## Evidence

- `measured`: aggregate containment 0.7733 (shipped) versus 0.7472 (negated); `lower_*` family 0.7398 versus 0.0938. Regenerate with `node scripts/calibrate-coords.mjs --compare`. `README.md:284-286`, `docs/sources.md:173-221`.
- `vanilla`: the corpus is all 177 `.gui` files of the verified install, with 0 parse failures, so the comparison is not a sample. `docs/kind-census.json`.
- `vanilla`: `combat_view.gui:41-45` is the worked example — `orientation = lower_left, origo = lower_left, position = { x = 35 y = -42 }` places a window's bottom-left corner 42 px above the screen's bottom edge, which only reads correctly under Model A. `README.md:280-283`.
- `measured`: `scripts/selftest.mjs` asserts all 81 `orientation` x `origo` combinations against an INDEPENDENTLY written expectation, and asserts an import -> emit -> re-import round trip reproduces every rect, so the calibration is not the only guard.

## Rules

- Do not "fix" the y sign. If a rect looks wrong, suspect the anchor or the `origo`, not the sign convention.
- Re-run `--compare` before changing anything in `src/lib/coords.mjs`. It is the measurement, and it is cheap.
- Report a claim about coordinates with the model it assumes. The difference between these two models is invisible on most individual examples; that is exactly why it was settled corpus-wide (see the `engine-capability-vs-usage` topic).
- Containment is the metric. Do not substitute "does this one window look right".

## 待确认

- Why Model B's `lower_*` containment is as high as 0.0938 rather than 0. Elements whose position is near zero, or whose parent is small relative to the offset, land inside under either model; the residual was not broken down.
