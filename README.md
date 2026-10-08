# RStellarisGui

A Stellaris **GUI generator**: layout engine, geometry validator and preview renderer first, and a
`.gui` emitter last -- plus a local drag-and-drop page for a human and an MCP tool surface for an
agent, both driven by the same core library.

Target: **Stellaris 4.4.6 "Pegasus"** only. Zero runtime dependencies. No build step.

**This repository is under version control (git).** The baseline commit contains the layout engine,
the validator, the preview, the emitter, the MCP tool surface, the local web UI and the
human/agent handoff channel. Use `git log --oneline` to see the history and `git diff` to review a
change before it lands; `.cache/`, `out/` and the two test scratch directories are ignored, since
they are regenerated output rather than sources.

---

## Why this exists

AI agents are bad at authoring Paradox GUI for one specific reason: **they get no feedback.** An
agent writes pixel coordinates into a `.gui` file blind, so overlaps, out-of-bounds elements and
mis-sized sprites are only discovered by a human who runs the game and looks at it. Emitting the
code is the easy part. The hard parts -- and the centre of gravity of this project -- are:

1. **A layout engine** that computes where a rectangle actually lands, honouring
   `orientation`/`origo` anchors, `%` / `%%` / negative sizes, `@variables` and sprite-natural
   sizes.
2. **A geometry validator** that reports every problem with coordinates, a severity and a
   suggested fix -- with enough tolerance for decorative overlaps that the report is usable.
3. **A preview renderer** that turns a layout into a self-contained SVG (and PNG) with real
   decoded textures, so a human can see it and an agent can be handed an image.

Everything else follows from those three.

## Quick start

```powershell
# Run the MCP server (stdio)
node src/index.mjs

# Run the local web UI and keep it up
node src/index.mjs --web --port 8791
#   -> http://127.0.0.1:8791/

# Print the MCP client configuration for this checkout
node src/index.mjs --print-client-config

# Run one tool and print JSON (no quotes to escape, works in PowerShell 5.1)
node src/index.mjs --skill call-tool gui_assets_defaults
node src/index.mjs --skill call-tool gui_assets_search --json-file args.json
'{ "query": "close" }' | node src/index.mjs --skill call-tool gui_assets_search -

# Ask the knowledge base, and read a topic as a resource
node src/index.mjs --skill call-tool gui_knowledge_search '{"query":"option_list EVENT_DIPLO"}'
node src/index.mjs --skill read-resource rstellarisgui://stellaris/knowledge/catalog
node src/index.mjs --skill read-resource rstellarisgui://stellaris/knowledge/window-name-contract

# Rebuild the knowledge base (the artefacts are tracked; see .gitignore)
node scripts/build-knowledge.mjs
node scripts/build-knowledge.mjs --check   # exit 1 if a topic changed and the build was not re-run

# Tests
node scripts/selftest.mjs        # in-process assertions + real-input censuses (prints its own count)
node scripts/protocol-test.mjs   # assertions over the real stdio JSON-RPC transport
node scripts/calibrate-coords.mjs --compare   # the y-sign question, measured over the whole corpus
node scripts/kind-census.mjs     # measure the install -> docs/kind-census.json
node scripts/generate-docs.mjs   # regenerate the number tables in this file and docs/sources.md
node scripts/gui-census.mjs      # standalone vanilla .gui parse census
node scripts/text-metrics-audit.mjs     # the font metrics, the atlas check and the held-out error table
node scripts/text-overflow-report.mjs   # measure one .gui: overflow, wrapping and text collisions
node src/index.mjs --skill list-tools
node src/index.mjs --skill list-resources
```

`scripts/calibrate-coords.mjs` is the reason the coordinate system is trustworthy rather than
merely documented: it parses all 177 vanilla `.gui` files, computes every element's rect at every
nesting depth under both candidate models, and reports containment per orientation family and per
parent family. Run it with no arguments for the shipped model's figures, `--compare` for the
side-by-side, `--examples` for the worked vanilla cases, and `--json` for the raw numbers.

`docs/engine-feedback.md` records what the game's own `error.log` forced this project to change
(the per-kind `size` keyword above all) and the before/after counts on the real file that exposed
it.

`docs/gui-pitfalls.md` is the reference for the `custom_gui` EVENT-WINDOW contract and the traps
around it: the engine looks a fixed set of element names up by name and crashes on a missing one, a
window is dismissed only by choosing an option, the close button selects option 0, `effect` is
invalid on a `buttonType`, and parked elements keep their keyboard bindings. Each entry states its
evidence (a vanilla `file:line`, an engine log line, or a byte in `stellaris.exe`) and the rule that
enforces it. `gui_log_scan` reads the engine's own logs - including the
`eventcommands.cpp:88 ... selectedOption N` line that is the only record of which control was
clicked.

## The knowledge base (36 topics)

`docs/gui-pitfalls.md` is excellent and it is 1000 lines long, which is the wrong shape for an agent
that needs one rule. So the measured knowledge is also compiled into a **queryable catalogue**:
**36 topics**, each hand-written in `knowledge/*.md`, compiled by `scripts/build-knowledge.mjs` into
`resources/knowledge/stellaris/<category>/<id>.toml` and the embedded snapshot
`src/generated/knowledge.mjs`, and served through two tools and an MCP resource surface.

| URI | content |
| --- | --- |
| `rstellarisgui://stellaris/knowledge/catalog` | every topic's id, title, category, summary and tags, as TOML |
| `rstellarisgui://stellaris/knowledge/<topic_id>` | one topic as markdown |
| `rstellarisgui://stellaris/latest-update` | the version this knowledge was verified against, and the evidence vocabulary |

| tool | what it does |
| --- | --- |
| `gui_knowledge_search` | free-text search over the whole catalogue, filterable by category and file type. **Every whitespace-separated term must match**, so `option_list EVENT_DIPLO` returns the one topic about both rather than the whole catalogue |
| `gui_knowledge_topic` | read one topic in full (rule + syntax + evidence + rules + the measured counter-examples + what could NOT be established), or list every topic |

Categories: `contract` (7) · `layout` (4) · `drawing` (6) · `text` (2) · `script` (11) · `tooling` (6).

The heading and the line above state the same number on purpose: `scripts/selftest.mjs` asserts it
against the catalogue the build actually produces, so the two cannot drift apart (and
`node scripts/build-knowledge.mjs --check` exits 1 when a topic changed without the artefacts being
rebuilt). An earlier revision of this section carried the count in the heading and the per-category
distribution in the line below it, with nothing asserting that the two added up to the same number -
which is the failure mode these checks exist for.

**What is canonical where - and why that matters.** The topics are canonical for the **rules**: what
the name contract demands, which size keyword each kind's parser accepts, where the engine's text
metrics live, what an inline `£token£` resolves to, how a control's visibility is decided. This file
and `docs/` are canonical for the **history**: the defect, the crash dump, the before/after counts on
the real mod, the argument. Every topic that has a counterpart in `docs/gui-pitfalls.md` cites its
section and line, and `scripts/selftest.mjs` asserts the load-bearing figures still appear in that
prose - so the two cannot drift into telling an agent two different things.

Every topic states its evidence as a tagged item - `binary` (a literal in `stellaris.exe`), `vanilla`
(a count over the install's 177 `.gui` files), `events`, `log` (the engine's own output), `measured`
(this project's experiment, with its numbers) or `sibling` (a measurement owned by `RStellarScribe`) -
and each one ends with a `## 待确认` section listing what could **not** be established. A topic with no
evidence item fails the **build**, not just a review.

**Both build products are tracked, not ignored**, and the reason is in `.gitignore`: this project has
no build step, `node src/index.mjs` runs the sources directly, and `package.json` ships `src` and
`resources`. An ignored `src/generated/knowledge.mjs` would make a fresh clone a server with no
knowledge base until someone ran the build, and a clone that does not work is worse than a generated
file in the repository. The sibling `RStellarScribe` cites this project's reasoning in turn, so the
two agree.

**`is_scope_type` in a `common/button_effects` potential** used to be the one recorded open gap the
knowledge base covered and the code did not: `gui_layout_validate` read the `.gui`, the condition is not
in the `.gui`, and a wrong-scope `potential` is valid script that simply answers `false`. Both halves are
now in the code: `src/lib/visibility.mjs` reads the `common/button_effects/*.txt` the caller indexed,
joins every element carrying an `effect` to its entry, returns that join as `visibility.table` (findings
or not) and raises `visibility-scope-dependent` / `visibility-flag-scope-dependent` /
`visibility-potential-scope-dependent`. The rule it enforces is the one
`control-visibility-is-a-potential` documents, and GAP-12 in
`<clone>\unga-fix\PLUGIN-GAPS.md` is closed against it. They are two halves of one rule: the
knowledge base says WHY, the validator says WHICH element.

Every count in this README is generated or asserted by a check, not typed: `scripts/kind-census.mjs`
measures the install into `docs/kind-census.json`, `scripts/generate-docs.mjs` rewrites the blocks
between `<!-- GENERATED:... -->` markers from it, `scripts/selftest.mjs` fails if a block is stale or
if `src/lib/kinds.mjs` disagrees with the measurement, and it asserts the knowledge topic count
against the compiled catalogue. An earlier revision carried the same number in three places and all
three differed.

<!-- GENERATED:census-summary -->
Measured on 177 vanilla `.gui` files of Stellaris v4.4.6 (`<Stellaris>`, 0 parse failures):

- **12801 element uses** at any nesting depth, of which 1197 are top-level `containerWindowType`s across the files;
- 30 of the 177 files declare `@variables`;
- the asset index sees **9197 sprites**, 13 bitmap fonts, 6883 distinct textures and 2436 `containerWindowType` names.

Regenerate with `node scripts/kind-census.mjs && node scripts/generate-docs.mjs`.
<!-- /GENERATED -->

## The web UI

`node src/index.mjs --web` serves a single-page app at **http://127.0.0.1:8791/** (it tries the
next free port if 8791 is busy, and prints the URL it settled on).

It shares the running server's layout state, so edits made in the page are visible to the MCP
tools and vice versa. The canvas is *the same SVG* that `gui_layout_preview` returns, so the human
and the agent cannot drift apart.

What it does:

- **Drag** an element to move it; drag the corner handle to resize. Both work in the canonical
  system (origin top-left, +y down): the drag converts the cursor's canvas position into a `position`
  relative to the parent's `orientation` anchor, and applies the element's own `origo` to reach the
  corner. The engine's field spelling is the server's business, not the page's.
- **Edit properties**: name, position, size, orientation, origo, sprite, background sprite,
  text/buttonText, font, effect key, tooltips, `maxWidth`/`maxHeight`/`dynamic_extra_height`, and
  the boolean flags (`alwaysTransparent`, `clipping`, `moveable`, `fixedSize`, `multiline`).
- **Add / delete** containers, text and buttons; pick a parent by selecting it first.
- **Edit `@variables`** and see the layout re-resolve.
- **Search assets** by name with **real decoded thumbnails** (`/api/thumb`), or load the verified
  "default parts" palette; click a sprite to assign it -- the field is chosen by sprite kind, so a
  cornered tile goes to `quadTextureSprite` and a fixed sprite goes to `spriteType`.
- **Validate** and click any finding to jump to the element it refers to; findings outline the
  canvas.
- **Export**, which requires you to type an output path and rejects a game install, the user-data
  folder, or any folder containing `descriptor.mod`.
- Live rect table and element tree.

## MCP tools

<!-- GENERATED:tool-surface -->
34 tools. Names follow the sibling project's `verb_subject` convention; every one declares a full
JSON schema because an agent that cannot see a parameter guesses it.

| Tool | Purpose |
| --- | --- |
| `gui_assets_search` | Search the Stellaris sprite index (built from interface/**/*.gfx) by name substring, kind and size range. |
| `gui_assets_sprite_info` | Full metadata for one sprite: defining block kind, texture path, real pixel size, format, mip count and the file:line that defines it. |
| `gui_assets_inventory` | Inventory the IMAGE FILES under a path and say whether any .gfx registers each one. |
| `gui_assets_defaults` | The verified "part box" for new Stellaris 4.4.6 UI: five default sprites and two default fonts, with their real sizes. |
| `gui_assets_refresh` | Rebuild the asset index from the install and report build time, per-stage timings, index size and the texture-format census. |
| `gui_layout_new` | Create a new layout tree and store it under a layout_id for later tools. |
| `gui_layout_edit` | Apply edits to a stored layout and return the new tree. |
| `gui_layout_import` | Parse an existing .gui file (or inline text) into a layout tree and store it. |
| `gui_layout_merge` | Merge several stored layouts (or inline trees) into ONE multi-window layout and store it. |
| `gui_layout_normalise` | Rewrite a stored layout into the form each element kind's ENGINE PARSER accepts, and report every change. |
| `gui_layout_get` | Read a stored layout tree back, with its computed absolute rectangle table. |
| `gui_layout_add` | Add elements to a stored layout, by name, in one call. |
| `gui_bar_spec` | THE canonical bar / stat-readout construction, as data: the exact elements a bar expands to, the API (`value`, `max`, `width`, `height`, `label`, `labelSide`, `labelEffect`, `effect`, `track`, `fill`, `inset`), the measured reference it comes from (the working mod's six power-projection ranking bars, with file:line), the install lines for the two sprites, and the rules that refuse a wrong bar. |
| `gui_matrix_spec` | The MATRIX component, as data: `rows` x `columns` of `cellWidth` x `cellHeight` cells, separated by `gapX`/`gapY` and inset by `padding`, with optional column and row labels. |
| `gui_layout_parent_paths` | Report every element's PARENT PATH, in document order, for one or more layouts. |
| `gui_layout_validate` | Run the geometry validator over a layout (or over a .gui file/text). |
| `gui_layout_preview` | Render a layout to a self-contained SVG (grid, per-kind colours, real decoded textures, labelled placeholders, finding overlays and a rect table) and optionally a PNG. |
| `gui_emit_files` | Write standalone mod files for a layout: interface/<stem>.gui, common/button_effects/<stem>_button_effects.txt (when effects are declared), events/<stem>_events.txt with custom_gui/custom_gui_option (one event per window, each with at least one option), and localisation/<language>/<stem>_l_<language>.yml (UTF-8 WITH BOM; script files are UTF-8 without). |
| `gui_emit_override` | DELIBERATELY OVERRIDE a vanilla .gui file: the vanilla source plus the elements you add to it. |
| `gui_override_drift` | THE ANTI-DRIFT REPORT for a vanilla `.gui` override: "has my base moved, and what changed under me?". |
| `gui_check_files` | Inspect files the tool did NOT write: encoding (a localisation .yml without a BOM is ignored by the engine; a .gui with one is a parse error), the `guiTypes` root, per-kind engine syntax (a `size` block on an instantTextBoxType or iconType is a hard parse error), localisation key syntax and duplicates, event shape (an event needs at least one `option`, and every title/desc/option name must resolve to a real key) and `common/button_effects` key shape. |
| `gui_log_scan` | Read the engine's own logs and report what the game did, in order: every event option the player selected (`eventcommands.cpp:88 ... |
| `gui_web_ui_start` | Start the local drag-and-drop web UI (zero-dependency Node HTTP server) that shares this same core library. |
| `gui_web_ui_stop` | Stop the local web UI started by gui_web_ui_start. |
| `gui_web_ui_status` | Report whether the local web UI is running, and at which URL. |
| `gui_handoff_list` | List layout submissions a HUMAN made in the local web UI ("鎻愪氦缁?Agent"), newest first, with the provenance diff against the layout as it was LOADED, the validation verdict, and the guardrail findings. |
| `gui_handoff_pick` | Load a submission listed by gui_handoff_list as the CURRENT layout, so the agent continues editing the human's version rather than its own. |
| `gui_layout_diff` | Diff two revisions of a layout, in the model's own vocabulary ("moved `unga_title_main` (30,22) -> (48,22)", "resized `unga_chart_main` 1116x300 -> 1116x320", "changed sprite of X", "added element Y"), and return the same markdown the handoff channel records as provenance. |
| `gui_handoff_submit` | Write a submission into the handoff channel WITHOUT the page: the agent-side entry point for a layout an agent or a script wants the human to review, and the tool that makes the whole flow testable headlessly. |
| `gui_handoff_status` | Report the handoff channel's state: the directory, how many submissions exist, how many are still pending (no agent has picked them up), how many are marked invalid, and when the newest one arrived. |
| `inspect_rstellarisgui_state` | Report server identity, game root, whether an asset index is loaded, the stored layouts, the localisation index and the web UI state. |
| `gui_interface_inventory` | List what the install defines in its interface layer: the .gui and .gfx file inventories, the containerWindowType names a `custom_gui` can name, and the button_effects keys an `effectbuttonType` can use. |
| `gui_knowledge_search` | Search the bundled Stellaris 4.4.6 GUI knowledge base: the measured rules behind this plugin - the custom_gui name contract, the size keyword per kind, where text metrics live, how a bar is drawn, what renders a bracket call literally, how a control's visibility is decided, and what apply_to does to a file. |
| `gui_knowledge_topic` | Read one knowledge topic in full: the rule, the syntax, the evidence (vanilla file:line, engine log line, or a measured count), what enforces it, the measured counter-examples, and a `## 寰呯‘璁 section listing what could NOT be established. |
<!-- /GENERATED -->

A full agent workflow:

```
gui_assets_defaults                                  -> the starting sprites and fonts
gui_assets_search { query: "close" }                 -> real sprite names with real sizes
gui_layout_new { name: "my_window" }                 -> layout_id
gui_layout_edit { layout_id, edits: [...] }
gui_layout_validate { layout_id }                    -> findings with coordinates and fixes
gui_layout_preview { layout_id, inline_image: true } -> look at it
gui_emit_files { layout_id, output_root: "D:\\out" } -> dry run first, then dry_run: false
```

## Hard constraints this project enforces

- **Standalone output files, plus one deliberate override door.** Emitted files go to the explicit
  `output_root` you pass and nowhere else. `assertOutputRoot` refuses a game install, the Stellaris
  user-data folder, or any folder containing `descriptor.mod` (i.e. a mod workspace), because a
  half-written file there breaks the user's mod. Overriding a vanilla file IS a real job -- there
  is no other way to add a button to the planet panel -- so it has exactly one door:
  `gui_emit_override`, which takes the vanilla source path, records its **sha256** so a version
  change is detectable (`expected_source_hash` makes a later run refuse when the base moved),
  refuses to write without `i_understand_this_overrides_vanilla_file: true`, validates the result,
  never modifies the vanilla file itself, and still writes only inside your `output_root`.
- **Encoding rules are enforced, not documented.** `.gui`, `.txt` -> UTF-8 **without** BOM.
  Localisation `.yml` -> UTF-8 **with** BOM (without it the engine silently ignores the file). The
  tests assert both, and `gui_check_files` checks both on files this tool did not write.
- **The engine's own syntax is the acceptance test, not our opinion of it.** `src/lib/syntax.mjs`
  replays the per-kind rules the engine enforces (the `size` keyword above all), and
  `scripts/fixtures/engine-error-baseline.log` holds the engine's verbatim error lines so the
  regression cannot come back quietly.
- **The game install is read-only**, and the stale 4.1.7 install at
  `D:\SteamLibrary\steamapps\common\Stellaris` is refused by absolute path, because answers read
  from the wrong version would look plausible and be wrong.
- **Every geometry report states its base resolution.** All coordinates are pixels in a
  **1920x1080** base. The game scales the whole UI, so "overlap" and "out of bounds" are only
  meaningful relative to a stated base.
- **The preview says what it cannot show.** Rect geometry is exact; cornered-tile chrome is drawn
  as a 9-slice and is stated as approximate in the SVG header, the tool result and the stats,
  rather than silently rendering a flat colour block.

## Layout tree schema (`rstellarisgui/layout@1`)

```jsonc
{
  "schema": "rstellarisgui/layout@1",
  "name": "my_window",                       // used as the containerWindowType name and file stem
  "baseResolution": { "width": 1920, "height": 1080 },
  "variables": { "@w": "620", "@h": "320" }, // @ lines, hoisted before guiTypes on emit
  "root": {
    "id": "root",                            // stable id for edits
    "kind": "container",                     // any emittable kind: see the table above
    "name": "my_window",
    "position": { "x": 0, "y": 0 },
    "size": { "width": "@w", "height": "@h" },   // containers: width/height
    "orientation": "center",                 // nine-point anchor on the PARENT
    "origo": "center",                       // nine-point reference point on the ELEMENT
    "moveable": true,
    "alwaysTransparent": true,
    "clipping": false,
    "background": { "name": "background", "sprite": "GFX_tile_large_bg" },
    "children": [
      { "id": "title", "kind": "text", "name": "window_title",
        // A text element has NO size: the engine's text parser rejects it. maxWidth/maxHeight
        // are the text element's size, which is what the layout engine uses for its rect too.
        "position": { "x": 20, "y": 14 },
        "font": "malgun_goth_24", "text": "my_window_title", "format": "left",
        "maxWidth": 580, "maxHeight": 28, "fixedSize": true },
      { "id": "accept", "kind": "effectbutton", "name": "accept_button",
        "quadTextureSprite": "GFX_tiling_button_standard",
        "size": { "width": 180, "height": 34 },   // buttons: emitted as `size = { x y }`
        "position": { "x": 0, "y": -14 }, "orientation": "center_down",
        "buttonFont": "cg_16b", "text": "my_window_accept",
        "effect": "my_window_accept_effect" }
    ]
  },
  "effects": {
    "my_window_accept_effect": {
      "potential": { "always": true },
      "effect": { "add_resource": { "resource": "influence", "amount": 50 } }
    }
  },
  "localisation": [],
  "event": null
}
```

The model always carries `size: { width, height }` whatever the file's spelling (`x`/`y` is
normalised onto it), and the emitter translates it into the field the element's own engine parser
accepts. A multi-window layout has a `root` with `"syntheticRoot": true` and one child per
`containerWindowType`; that is what `gui_layout_import` produces for a real `.gui` file and what
`gui_layout_merge` builds, and the emitter writes the children as siblings under one `guiTypes`.

### The canonical coordinate system (read this before writing any coordinate)

Every coordinate this tool accepts, reports or draws is in ONE system, and there is no other reading
of `position` anywhere in the tool surface:

| | |
| --- | --- |
| origin | the parent window's **top-left** corner; the outermost parent is the 1920x1080 base rectangle, so a top-level `containerWindowType` is placed in that |
| +x | to the **right** |
| +y | **down** (the screen convention) |
| units | scaled UI pixels at the 1920x1080 base resolution |
| a rect | `{ x, y, width, height }` with `x`/`y` the **top-left** corner - this is what the rect table and the preview report |
| `position` | the offset of the element's **pivot** from its parent's `orientation` anchor, with +y down. The pivot is the point the element's own `origo` names (default `upper_left`, i.e. its top-left corner) |

So an agent never has to know that `.gui` has anchors. "Put this 20 px below the parent's bottom
edge" is `position.y = 20`; "10 px above it" is `position.y = -10`.

**The `.gui`-file rule the system absorbs.** In a file, `orientation` selects a nine-point anchor ON
THE PARENT and `position` is measured from it, so the vertical meaning of `y = 10` depends on which
edge the anchor is on: with `upper_left` it is 10 px below the parent's top edge, with `lower_left`
it is 10 px below the parent's **bottom** edge - i.e. past the parent, not inside it. That is a
*different reference point*, not a negated sign: `combat_view.gui:41-45` writes
`orientation = lower_left, origo = lower_left, position = { x = 35 y = -42 }` and that puts the
window's bottom-left corner 42 px **above** the screen's bottom edge, which is a negative number
moving the element up the screen, exactly as the canonical system would. `src/lib/coords.mjs` owns
this translation; `scripts/calibrate-coords.mjs --compare` measures it over the whole corpus
(negating y for the bottom anchors drops aggregate containment from 0.7733 to 0.7472 and the
`lower_*` family from 0.7398 to 0.0938 - a regression, not a fix).

**One code path.** `gui_layout_import` converts every parsed `position` into the canonical frame and
keeps the literal the file carried as `enginePosition`; `computeLayout` turns canonical positions
into rects for the preview, the rect table and the validator; and `gui_emit_files` runs
`prepareEngineCoordinates` (`src/lib/emit.mjs`) which derives the fields the engine reads from the
same canonical value. The emitted file, the SVG and the rect table are therefore three renderings of
one model, and an import -> emit -> re-import round trip reproduces every rect exactly (asserted in
`scripts/selftest.mjs` over nested `lower_*` containers).

### The rect rule

```
dirY   = 1                                       # for every orientation: the sign is never negated
anchor = anchorPoint(parentRect, orientation)    # nine-point, on the PARENT
pivot  = anchor + (position.x, dirY * position.y)
corner = pivot - size * origoFraction            # nine-point, on the ELEMENT
```

With both defaults (`upper_left`/`upper_left`) `position` is simply the top-left corner relative
to the parent's top-left. With `orientation = center, origo = center` the element is centred on
its parent's centre. With `orientation = lower_left` the anchor is the parent's bottom-left, so a
negative `position.y` moves the element **up** from that corner - the vanilla idiom for anything
that sits in a footer. Anchor names are matched case-insensitively and every vanilla spelling maps
onto one of nine canonical anchors, including the misspellings vanilla actually contains
(`CENTERUP`, `LOWER_LEfT`).

### The four legal size forms

All four appear in vanilla 4.4.6 and all four are first-class here (measured, not typed -- see
`docs/kind-census.json`):

<!-- GENERATED:size-forms -->
| form | meaning | value slots in vanilla `containerWindowType` |
| --- | --- | --- |
| `width = 850` | static pixels | 4929 |
| `width = 100%` | percent of the **parent** | 366 |
| `width = 100%%` | percent of the parent **minus this element's position** | 20 |
| `width = -16` | parent **minus position minus 16** | 50 |
| `width = @var` | an `@variable` declaration | 449 |

An earlier revision flagged the last two as errors. It was wrong; the wiki documents all four,
the install uses them, and only a *negative resolved* size is reported (as a warning). The x/y
spelling used by buttons and lists accepts only an integer or an `@variable` - the emitter
resolves anything else into pixels and says so.
<!-- /GENERATED -->

## Validation rules

<!-- GENERATED:validation-rules -->
| rule | severity | notes |
| --- | --- | --- |
| `asteroid-belt-type-undefined` | error | an `asteroid_belt = { type = <key> }` names a belt type no supplied `common/asteroid_belts/**` file defines - the belt is drawn from that type's `mesh` list, so the band is not the one the author wrote and nothing is logged |
| `bar-clone-source-missing` | error | `cloneOf` names a bar that is not in the tree (or not above this one), so there is nothing to clone. The source must be a `kind: "bar"` node that appears EARLIER in document order |
| `bar-colour-not-exist` | error | `trackColour` / `fillColour`: a `.gui` container has NO colour field. The two things that do work are a different tile sprite (`track`/`fill`) or the sprite's own `effectFile` shader - a hex colour cannot be written and is refused rather than dropped |
| `bar-fill-overflows-track` | error | the bar's `value` exceeds its `max`, so the fill would be longer than the track less its inset. REFUSED and clamped, never reproduced: the reference itself has one such row (a 400 px fill in a 400 px track, :257-271), and copying it is not cloning |
| `bar-frame-too-small` | error | the declared bar `width`/`height` leaves no room for the track plus the value column and the label, so no legal construction exists inside it |
| `bar-label-effect-missing` | error | the scripted label channel was asked for (`labelEffect`/`effect`) but the other half of the pair is missing, so the button would carry no script or no text |
| `bar-proportion-invalid` | error | `value` / `max` is not a finite pair with `max > 0`, so the fill length is undefined |
| `bar-track-height-not-static` | error | a bar's track height is not a plain pixel number, so the fill inset cannot be subtracted from it |
| `bar-track-width-not-static` | error | a bar's track width is not a plain pixel number. The fill's length is derived from it and written into the file as a literal, so the track has to be a size this plugin can resolve statically |
| `carrier-colony-class-undefined` | error | `carries_colony` names a planet class that is `colonizable = no`, or that no supplied file defines - the carrier relation points at a class the engine cannot build a colony from (the field is documented at `common/ship_sizes/00_ship_sizes.txt:97-99`) |
| `carries-colony-without-starbase` | error | a `common/ship_sizes/` block declares `carries_colony` without `class = shipclass_starbase`; the engine answers `"Arkship size %s does not have class = shipclass_starbase"` and the hull is not an ark ship |
| `container-name-collision` | error | a root `containerWindowType` name the install already defines |
| `custom-gui-close-not-last` | error | `close` is not the window's last direct child, so later siblings draw over it |
| `custom-gui-contract-duplicate` | error | a contract name is declared twice inside one window |
| `custom-gui-contract-missing` | error | an element name `diplomatic_eventwindow.cpp` looks up by name is missing from the window (null dereference / crash) |
| `custom-gui-contract-nesting` | error | `option_list` is not a direct child of `EVENT_DIPLO`, or `EVENT_DIPLO`/`action_title`/`action_desc` is missing |
| `custom-gui-unknown-window` | error | `custom_gui` names a `containerWindowType` no indexed root defines. ERROR on a `diplomatic = yes` event (the engine substitutes `ok_popup_window`, demands the diplomatic contract inside it and null-dereferences - measured), warning otherwise (the engine writes nothing at all, not even the lookup line, and draws the ordinary default event window instead) (GAP-17) |
| `duplicate-name` | error | the same `name` twice among siblings **within one window** |
| `effect-missing` | error | `effectbuttonType` with no `effect` at all |
| `effect-unresolved` | error | `effectbuttonType.effect` is not a key in any indexed `common/button_effects/*.txt` |
| `engine-populated-container-children` | error | a child element inside `gridBoxType` / `OverlappingElementsBoxType` / `listBoxType` / `smoothListBoxType`. Measured: 0 of 261 / 189 / 43 / 242 vanilla blocks of those kinds contain a nested element - the ENGINE fills them - and the engine answers a child element with `Unexpected token: <keyword>` at FILE LOAD and skips the whole child block, so the file is rejected (probed in game on `gridBoxType`, 2026-10-06) |
| `field-not-accepted` | error | a field that belongs to another element kind: the engine answers `Unexpected token: <field>` |
| `gui-parse-error` | error | the lexer could not read the file at all |
| `matrix-cell-overflow` | error | a cell's content is larger than the slot it was placed in. It does not overlap a sibling or leave the window, so no other rule sees it - it simply draws over the next column |
| `matrix-cell-size-not-static` | error | `cellWidth` / `cellHeight` is not a positive static pixel number. Every cell coordinate is derived from it and written into the file as a literal, so a `%`/`@var` cell size cannot be laid out |
| `matrix-cell-slot-collision` | error | two cells claim the same slot, so whichever the engine instantiates last wins and the other silently never appears |
| `matrix-cell-slot-out-of-range` | error | a cell's `row`/`column` is outside the declared `rows` x `columns` grid |
| `matrix-children-overflow` | error | more `children` were given than there are free slots, so the surplus has nowhere to go |
| `matrix-dimension-invalid` | error | `rows` / `columns` are not positive integers, so there is no grid to place cells in |
| `option-button-convention` | error | an `*_option` row without `option_button` / `OPTION_TEXT` |
| `out-of-bounds` | error | leaves the root window rect; reports each side's overflow in px |
| `override-splice-container-missing` | error | an element the override added is nested in a container the current vanilla file no longer declares, so the addition is no longer where the mod put it |
| `override-vanilla-content-missing` | error | the current vanilla file declares elements the override does not, so those elements are GONE from the game for every mod in the load order while this override is installed |
| `portrait-entity-undefined` | error | a portrait definition names `entity = "<name>"` that no `gfx/models/portraits/**/*.asset` defines - the engine looks the name up in a registry and finds no key, so the portrait slot draws nothing and nothing is logged |
| `portrait-mesh-missing` | error | a portrait's `entity` resolves but the chain stops one link later: either the entity's `pdxmesh` is defined by no `gfx/**/*.gfx`, or the `pdxmesh`'s `file = "<x>.mesh"` is in no indexed root - the portrait registers and the mesh never loads, so the slot stays empty |
| `ringworld-segment-class-undefined` | error | a `common/solar_system_initializers/**` `planet = { class = <x> }` names a class no supplied `common/planet_classes/**` file defines, and the initializer declares `ring_world_built` - the `has_star_flag` every vanilla ring-world system sets, which makes the block a ring-world system and the missing class a segment with no planet class at all |
| `root-invalid` | error | the file's root construct is not `guiTypes` (case-insensitive) |
| `size-form-wrong` | error | `size = { width height }` on a kind that takes `size = { x y }`, or the reverse |
| `size-not-accepted` | error | a `size` block on a kind whose engine parser has no `size` token (text, icon) |
| `star-class-planet-undefined` | error | a `common/star_classes/**` block's `planet = { key = <planet class> }` names a class no supplied `common/planet_classes/**` file defines - that block IS the body the engine puts in the star slot (`00_star_classes.txt:6`), so the slot has no class to resolve |
| `system-light-undefined` | error | a `gfx/worldgfx/*.txt` names a `system_light = "<name>"` that no supplied `gfx/lights/**/*.asset` defines - the engine builds the light when it loads the worldgfx file and answers `[gamerendering.cpp:1174]: Failed to create system light <name>` by name, at load, before any galaxy exists (measured: six distinct names from one enabled Workshop mod that ships no `gfx/lights` at all, while the same mod's `black_hole_light`, which IS defined, does not fail) |
| `undeclared-variable` | error | `@var` used but never declared |
| `unexpected-token` | error | a scalar token NO kind declares and the install's 177 `.gui` files never write on that kind: the engine answers `Unexpected token: <token>` at file load and drops the enclosing block (GAP-16) |
| `unknown-font` | error | not a `bitmapfont` |
| `unknown-sprite` | error | not defined by any `.gfx`; suggests near misses |
| `unresolved-size` | error | a size component that was written but cannot be evaluated |
| `visibility-scope-dependent` | error | an `effect` this window draws names a `common/button_effects/` entry whose `potential` tests `is_scope_type`, so the control is DRAWN OR NOT by the scope the window was opened in - the sidebar is immune, your buttons are not (GAP-12) |
| `bar-label-overflows-track` | warning | the bar's label needs more room than the bar gives it (vertically for an inside label, or than the column a left/right label was allotted) |
| `bar-label-too-wide` | warning | the label's measured text is wider than the box the bar gave it, so the engine would wrap or clip it inside a bar |
| `bar-track-misaligned-with-heading` | warning | the bar's track does not start at the same x as the heading that labels its column, so the column reads as broken |
| `create-colony-without-pops` | warning | a scripted effect (or a file-level event) calls `create_colony` and neither that block nor anything it calls seeds population (`create_pop_group`) - a colony with zero population REVERTS to a colonisable planet once time runs, and the engine logs no line for it. BLOCK-SCOPED: population created in a sibling block, or by a mechanism this reader does not model, is invisible to the check, so the finding says what was searched rather than asserting the colony is doomed |
| `custom-gui-force-open` | warning | `force_open` is combined with `custom_gui` (vanilla never does) |
| `custom-gui-option0-selfref` | warning | the window's FIRST event option unconditionally fires the event that opened the window |
| `custom-gui-portrait-nesting` | warning | the `portrait` icon is not nested inside the `portrait` container |
| `event-namespace-undeclared` | warning | an event id `<x>.<n>` whose namespace `<x>` is not declared by any supplied event file - the engine rejects the id (`event.cpp:1208 ... has an invalid ID`) and every `on_action` that names it (`onaction.cpp:94 OnAction ... is referencing an invalid ID`), so the hook silently never fires. The check is scoped to the files it was handed, because a namespace may be declared in ANY loaded `events/` file |
| `field-dropped` | warning | a field the emitter could not write on this kind at all |
| `matrix-header-count-mismatch` | warning | `columnHeaders` / `rowHeaders` is a different length from `columns` / `rows`, so some labels belong to no row or column |
| `matrix-header-font-unknown` | warning | a header font is not a `bitmapfont` the install defines |
| `missing-localisation` | warning | a text/tooltip key that does not exist |
| `negative-resolved-size` | warning | the declared form was legal but resolves negative |
| `orientation-unknown` | warning | a spelling the engine would not recognise |
| `override-base-moved` | warning | the `sha256` the override records for its vanilla base is not the hash of the vanilla file on disk now, so the base moved (a game patch) and the copy is stale |
| `override-base-unrecorded` | warning | the override carries no `vanilla source sha256` line, so drift cannot be detected mechanically - re-emit it through `gui_emit_override`, which writes one |
| `override-unsupported-version` | warning | the mod's `descriptor.mod` `supported_version` does not cover the install's version |
| `parked-element-hit-region` | warning | an element parked off-canvas still has a non-zero hit area |
| `parked-element-shortcut` | warning | an element parked off-canvas still claims a keyboard `shortcut` |
| `portrait-character-texture-missing` | warning | a `character_textures` entry names a texture that is in no indexed root - the mesh keeps its exported UVs, so a body part is drawn with a neighbouring portrait's skin or with nothing |
| `ringworld-segment-orbit-inconsistent` | warning | a `common/solar_system_initializers/**` block places ring-world segments (`common/planet_classes/**` says `ringworld = yes`) at more than one `orbit_distance` - a ring is ONE circle at ONE radius, and every vanilla ring puts all its segments at the same one (`orbit_distance = 0` after a single `change_orbit = 45`), so an extra radius is a segment that cannot sit on the ring the rest describe |
| `sibling-overlap` | warning | two sibling rects intersect, above the decorative tolerance, **within one window** |
| `size-indeterminate` | warning | no size and the sprite has no known natural size |
| `size-unresolved` | warning | a size that is neither an integer nor an `@variable` and did not resolve |
| `text-collision` | warning | two elements' RENDERED text extents intersect, even though their boxes may not (this is what a wrapped block growing into the row below looks like) |
| `text-overflow` | warning | the RENDERED string does not fit the element's `maxWidth`/`maxHeight` (measured from the engine's own font metrics, with wrapping modelled) |
| `text-without-max-size` | warning | a text element with neither `maxWidth` nor `maxHeight` |
| `visibility-flag-scope-dependent` | warning | the same mechanism one step out: a potential gated on a `has_planet_flag` / `has_country_flag` (and on no `is_scope_type`) is answered from the DRAWING scope, so the flag decides the route as well as the state (GAP-12) |
| `window-text-data-function` | warning | a `[Scope.Func]` / `[GetX]` bracket call inside a value a WINDOW paints as text: measured to render literally |
| `zero-size` | warning | legal (it is how modders hide vanilla elements), but worth a look |
| `bar-label-not-offered-as-button` | info | this bar shows a static label while the only measured live-text channel inside a custom_gui window is `effectbuttonType.buttonText`; pass `effect` (and `labelEffect`) if the number should be live |
| `container-path-override` | info | two providers of the SAME relative `.gui` path: an override, not a collision - the engine reads only the LAST entry in `dlc_load.json` and never parses the loser's file (GAP-14) |
| `field-translated` | info | a field the emitter wrote in the form this kind actually accepts |
| `fixed-size-sprite-resized` | info | a fixed `spriteType` given a different `size` |
| `install-file-custom-gui` | info | an install .gui file was checked as if it were a mod's custom_gui window (informational) |
| `kind-not-emittable` | info | recognised and laid out, but the emitter does not write this kind |
| `out-of-bounds-parked` | info | a deliberately parked element: this far outside the root it cannot be part of the window, so it is counted separately from a real escape (`out-of-bounds`) instead of inflating it |
| `override-modifies-vanilla-element` | info | the override changes fields on an element the vanilla file also declares, rather than only adding. This is a normal and often necessary technique (an ascension-slot mod does exactly this to the perk list's sizes), and it is reported so it is a DECISION and not a surprise |
| `parked-duplicate-of-live-control` | info | a parked element duplicates the name of a live control in the same window |
| `planet-asteroid-colonizable` | info | a planet class carrying `asteroid = yes` also declares `colonizable = yes` - the engine will offer the colonise order, but a minor planetary body is excluded from every megastructure placement rule that says `requires_not_minor_planetary_body` (`NOR = { is_asteroid = yes is_moon = yes }`) |
| `size-source-converted` | info | a size the emitter had to translate into the kind's own field |
| `size-value-resolved` | info | a percentage/negative size in an integer-only slot, resolved to pixels on emit |
| `sprite-without-texture` | info | normal for generated sprites |
| `text-live-value` | info | a text element paints an UNRESOLVED `[$...$]` live value, so its measured width is what the token would need and not what the engine draws: reported ONCE instead of a false `text-overflow`, with the measurement attached (GAP-5) |
| `unknown-field` | info | a field this project does not model on that kind |
| `unused-variable` | info | declared but never referenced, so not emitted |
| `visibility-potential-scope-dependent` | info | the effect is harmless HERE because a caller guaranteed this window's scope; recorded so the guarantee stays visible |
<!-- /GENERATED -->

### Decorative tolerance (why the report is usable)

Overlapping rectangles are normal and intentional in Paradox UI: backgrounds sit under their own
container's content, transparent overlays cover panels, and `alwaysTransparent` elements are
explicitly mouse-transparent decoration. A naive "any overlap is an error" report is pure noise,
so an overlap is reported **only** when all of these hold:

- the two elements are siblings (never a container and its own descendant)
- the overlap exceeds `overlapTolerance` (default 4 px^2)
- the overlap exceeds `overlapAreaRatio` of the smaller element (default 0.10)
- the overlap is not full containment of one box by the other
- neither element is `alwaysTransparent` or carries a `background`, unless
  `flagTransparentOverlaps` is set

Slide-in elements (`show_position` / `hide_position` / `animation_type`) are exempt from
out-of-bounds unless `allowOffscreenAnimated: false`, because vanilla records their `position`
deliberately off-screen -- `interface/advisor_window.gui:29-37` is the canonical case.

### Deliberate parks are counted, not counted as escapes

A `custom_gui` window must declare element names the engine dereferences by name, and the idiom for
satisfying that without showing chrome is `position = { x = -3000 y = -3000 }`. That is 3000 px of
out-of-bounds overflow, so a real mod's escape count is dominated by elements that are parked on
purpose -- measured on the working mod: **154** out-of-bounds elements, **0** of them less than 1112 px
outside. One number cannot answer "is this element escaping, or is it parked?", so the validator
reports both:

| question | how it is decided | where the answer is |
| --- | --- | --- |
| can this element be PART of the window? | distance outside the ROOT rect vs `parkMargin` (default **512** px) | `out-of-bounds` (error, a real escape) / `out-of-bounds-parked` (info, a park) |
| does a parked element still hold a binding? | `isParked`, a **256 px** slack around the element's own WINDOW | `parked-element-shortcut` / `parked-element-hit-region` / `parked-duplicate-of-live-control` |

Nothing is suppressed: every element keeps its own finding, and `geometry.outOfBounds` reports
`{total, classified, escaped, parked, parkMargin, parkedClassification, note}`. `park_margin` sets the
margin and `0` switches the classification off. The honest response to "my real escapes are hidden among
the parks" is to LOWER the margin -- never to raise a gate's baseline, which is the one move this
project refuses.

### Text extents: measured, not guessed

`maxWidth`/`maxHeight` are the box the engine lays text out **in**, not the size of the text, so
every "text overflows" or "these two elements overlap" statement built on element rects is a
statement about boxes. The plugin now measures the rendered string from **the engine's own font
data** and uses that everywhere (`src/lib/font-metrics.mjs`, one code path for the validator, the
preview and the rect table):

* `gfx/fonts/*.fnt` are AngleCode BMFont descriptors carrying per-glyph `xadvance`, `xoffset`,
  `yoffset`, `width`, `height` plus `lineHeight`/`base`, and real `kerning` pairs
  (`juralightmedium.fnt` has 6744). The engine parses exactly those records -- the token list
  (`lineHeight`, `chars`, `base`, `scaleH`, `scaleW`, `char`, `kerning`) is visible in
  `stellaris.exe` from `pdx_oldgui/graphics/bitmapfont.cpp`.
* `interface/fonts.gfx` swaps the bitmap font for a real TrueType one **per language**
  (`bitmapfont_override { ttf_font = "Chinese_normal" ttf_size = "14" languages = {
  "l_simp_chinese" } }`), so `font = "cg_16b"` is a 16px Century Gothic bitmap in English and a
  14px Noto Sans CJK in Simplified Chinese. For those, the advances come from the font's `hmtx`
  table scaled by `ttf_size / unitsPerEm`, so **CJK is measured exactly too** -- pass
  `languages: ["simp_chinese"]` to measure a Chinese mod.

> **Exactness.** Text extent is **exact** for bitmap fonts and **exact in advance width** for
> TrueType overrides (line height is derived there from `hhea`); wrapping is **modelled per script**
> (Latin at spaces, CJK per character using the font's own `forbidden_start`/`line_break` lists) and
> the wrap width is the element's `maxWidth`, measured with no extra inset. Residual uncertainty is
> reported per element: inline `£icon£` and unresolved `$SCOPE$` tokens charge zero width, so a
> measurement containing them is a lower bound. The heuristic this replaces (`0.55 x the digits in
> the font's name`) had a **39px median error** on a held-out sample of vanilla text and produced
> **75% false overflow claims**; the full error table, the atlas-verification evidence and the
> before/after counts on the real six-window mod are in
> [`docs/gui-pitfalls.md`](docs/gui-pitfalls.md#14-text-has-a-size-and-the-box-is-not-it), and
> `node scripts/text-metrics-audit.mjs` reproduces them.

## Emitted files

| file | encoding | notes |
| --- | --- | --- |
| `interface/<stem>.gui` | UTF-8, **no BOM** | `guiTypes` root, `@variables` hoisted before it, tab indentation, vanilla field order |
| `common/button_effects/<stem>_button_effects.txt` | UTF-8, no BOM | one top-level key per `effect` your layout declares |
| `events/<stem>_events.txt` | UTF-8, no BOM | `custom_gui` + `custom_gui_option` stub, `diplomatic = yes` by default. The flag is **convention and window class, not a requirement** - the field resolves without it (measured in game 2026-10-06). What is a requirement is that the name **exists**: an unresolvable `custom_gui` name is a crash on the diplomatic path (see GAP-17 in `PLUGIN-GAPS.md`) |
| `localisation/<lang>/<stem>_l_<lang>.yml` | UTF-8, **WITH BOM** | `l_<lang>:` header, `key:0 "value"` lines |

`gui_emit_files` defaults to `dry_run: true`, which returns the whole file plan and writes
nothing.

## Library choice, and what was deliberately not vendored

**Zero runtime dependencies. Nothing vendored. No build step.**

The brief allowed vendoring a small permissively-licensed BCn decoder or a pinned npm dependency.
Neither was needed:

- **DDS/BCn decoder** -- the measured census (`docs/sources.md` section 5) shows only BC1 (DXT1), BC2
  (DXT3), BC3 (DXT5) and 16/24/32-bit uncompressed, with **zero BC7 or DX10** headers in 21305
  files. BC1/2/3 plus uncompressed is ~120 lines of documented bit arithmetic in
  `src/lib/dds.mjs`, verified against real files (including a 4096x4096 BC3 that decodes its
  128x128 mip from the chain). Writing it avoids a licence obligation for something this small and
  keeps the project dependency-free. An unsupported FourCC is **refused by name** rather than
  decoded wrongly.
- **PNG** -- writing is three chunks and a CRC-32 over Node's built-in `zlib`; reading is the five
  documented scanline filters plus Paeth. Both in `src/lib/png.mjs`. Reading turned out to be
  necessary: four vanilla textures are PNG, not DDS (`docs/sources.md` section 4 correction 4).
- **Paradox script lexer/parser** -- written here rather than reused from RStellarisScribe, because
  the `.gui` reader needs a line number on every node (every finding reports `file:line`) and needs
  `@variable` declarations kept as data.

Consequence: `npm install` is not required, there is no build step, and the only runtime
requirement is Node >= 20 (developed on Node 24).

## Element kinds and what the engine accepts

**Implemented and emittable** (`emitter: true` in `src/lib/kinds.mjs`):

<!-- GENERATED:emittable-kinds -->
| kind | keyword | size the engine accepts | vanilla uses |
| --- | --- | --- | --- |
| `container` | `containerWindowType` | `size = { width height }` | 3305 |
| `text` | `instantTextBoxType` | `maxWidth` / `maxHeight` | 3220 |
| `icon` | `iconType` | no size at all | 2779 |
| `button` | `buttonType` | `size = { x y }` | 2067 |
| `effectbutton` | `effectbuttonType` | `size = { x y }` | 2 |
| `gridBox` | `gridBoxType` | `size = { width height }` | 260 |
| `smoothListBox` | `smoothListBoxType` | `size = { x y }` | 243 |
| `listBox` | `listBoxType` | `size = { x y }` | 43 |
| `overlappingElementsBox` | `OverlappingElementsBoxType` | `size = { x y }` | 188 |
| `guiButton` | `guiButtonType` | `size = { x y }` | 198 |
| `scrollbar` | `scrollbarType` | `size = { x y }` | 24 |
| `editBox` | `editBoxType` | `size = { x y }` | 85 |
| `checkbox` | `checkboxType` | no size at all | 77 |
| `spinner` | `spinnerType` | `size = { x y }` | 40 |
| `window` | `windowType` | `size = { x y }` | 24 |
| `dropDownBox` | `dropDownBoxType` | `size = { width height }` | 13 |
| `matrix` | `matrix` | `size = { width height }` | 0 |
| `bar` | `bar` | `size = { width height }` | 0 |

That is 12568 of the install's 12801 element uses (98.2%).
<!-- /GENERATED -->

**Recognised, laid out and validated, but reported as `kind-not-emittable` rather than silently
dropped** -- adding one means flipping `emitter: true` in `src/lib/kinds.mjs` and filling in a field
list, because the kind table drives the parser, the layout engine, the validator and the emitter:

<!-- GENERATED:parsed-only-kinds -->
`position` (233) - `positionType`
<!-- /GENERATED -->

Other element-looking keywords the 177 vanilla `.gui` files contain but the kind table does not
model yet (they are parsed as opaque blocks and left alone):

<!-- GENERATED:unknown-keywords -->
(none)
<!-- /GENERATED -->

**Deliberately out of scope** -- `if_resolution` / `if_scaled_resolution` conditional blocks are
parsed and preserved (6 and 41 uses) but not resolved to a specific resolution.

### The `size` keyword is per-kind, and the wrong one is a parse error

An earlier revision wrote `size = { width = ... height = ... }` for every kind. Running its output
in Stellaris 4.4.6 produced, in `logs/error.log`:

```
[persistent.cpp:41]: Error: "Unexpected token: size, near line: 56" in file: "interface/zz_geocentric_unga.gui" near line: 59
[persistent.cpp:41]: Error: "Malformed token: width, near line: 96 / Malformed token: height, near line: 97" ... near line: 98
[instanttextboxtype.cpp:138]: Not used, use maxWidth and maxHeight  file: interface/zz_geocentric_unga.gui line: 95
```

Line 56 is a `size` block inside an `iconType`; line 95 is one inside an `instantTextBoxType`.
Neither kind has a `size` token: across the install, 0 of 2779 `iconType` and 0 of 3220 text
blocks declare one. The form each kind does accept is measured, per kind, and enforced on both
sides:

- **emit** -- `gui_emit_files` writes the kind's own form, resolving a `%`/`%%`/negative
  declaration into the pixel value the layout engine computed and reporting `size-value-resolved`.
- **check** -- `gui_check_files` and `gui_layout_validate { path }` report `size-not-accepted` /
  `size-form-wrong` on a file that gets it wrong, quoting the engine's own message, and
  `scripts/selftest.mjs` replays `scripts/fixtures/engine-error-baseline.log` verbatim: every
  error line in it must produce a finding at the same line.

## Tests

**`scripts/selftest.mjs`** and **`scripts/protocol-test.mjs`** each print their own assertion
count; both must exit 0. `selftest.mjs` covers the lexer (including a regression guard for the
stateful-`RegExp`-in-a-scan-loop bug that once hung it), all 81 `orientation` x `origo` combinations
against an independently written expectation, `%` / `%%` / negative / `@variable` resolution,
overlap detection with both true *and* false cases (disjoint, exactly touching, containment,
`alwaysTransparent`, sub-threshold slivers), every validator rule, the engine-syntax checker against
the real engine's error log, the asset index, DDS header parsing on synthetic buffers plus real
BC1/BC2/BC3 block decoding, the PNG writer *and* decoder with a byte-exact round-trip, SVG/PNG
preview including the 9-slice chrome path, emitter text shape, and the encoding and output-root
rules.

Then **real-input census** blocks (the same generated census as at the top of this file):
`scripts/selftest.mjs` parses every vanilla `.gui` file and builds the asset index against the real
install, and asserts that a fresh default layout validates clean against it and previews with real
embedded textures.

`scripts/protocol-test.mjs` drives the real stdio JSON-RPC transport: handshake and instructions,
`tools/list`, the full `layout_new -> edit -> validate -> preview -> emit` chain, the encoding/BOM
rules, the output-root guard (including that nothing is written into a refused mod workspace),
`invalid_params` mapping for a bad argument, `-32601` for an unknown method, an MCP `image` content
block, and starting/stopping the web UI over JSON-RPC.

**`scripts/gap13-17-repro.mjs`** is the in-game probe read back onto the plugin: it runs the five
reproductions of the 2026-10-06 probe round (GAP-13 … GAP-17) against the probe files themselves -
read-only, and skipped when those files are absent - and prints the engine's measured answer beside
what the plugin says now and what it said before. It exits 1 when the two disagree, so the round's
evidence is a runnable claim rather than a paragraph.

## Layout

```
src/index.mjs              entry: MCP stdio | --web | --skill | --print-client-config
src/tools/index.mjs        the tool registry with full JSON schemas
src/lib/
  paths.mjs                install discovery, the forbidden-install guard, safeJoin, out/<timestamp>/
  paradox.mjs              lexer + parser, @variables, topLevelKeys, firstConstruct
  kinds.mjs                the table-driven element-kind registry (add a kind here)
  layout.mjs               component model, rect maths, .gui -> tree, edit ops, layout merge
  validate.mjs             the rule table (severity + description) and the validator
  syntax.mjs               the ENGINE SYNTAX CHECKER: what the engine's own parsers reject
  filecheck.mjs            encoding / root / loc / event inspection for files we did not write
  gfx-index.mjs            .gfx -> sprite names from EVERY block kind, plus fonts and borderSize
  dds.mjs                  DDS headers, BC1/2/3 + uncompressed decode, mip selection, PNG dispatch
  png.mjs                  PNG writer and reader (zlib only)
  asset-index.mjs          the cached asset index and its queries (several roots)
  loc-index.mjs            localisation keysets (and values, for the preview)
  preview.mjs              SVG/PNG rendering, 9-slice chrome, rect-table export, thumbnail cache
  emit.mjs                 .gui / button_effects / event / localisation emitters + vanilla overrides
  mcp.mjs                  dependency-free MCP stdio transport
  web.mjs                  the local HTTP server
src/web/index.html         the single-page app
scripts/selftest.mjs       in-process assertions + real-input censuses
scripts/protocol-test.mjs  end-to-end JSON-RPC over a pipe
scripts/calibrate-coords.mjs  the coordinate calibration over the whole vanilla corpus
scripts/gui-census.mjs     standalone vanilla .gui parse census
scripts/kind-census.mjs    the measured per-kind census -> docs/kind-census.json
scripts/generate-docs.mjs  regenerates every number table in README/sources.md
scripts/text-metrics-audit.mjs  the font descriptors, the atlas ink check, the held-out advance error
scripts/text-overflow-report.mjs  per-element measured text extents and overflow/collision counts
scripts/make-contract-fixtures.mjs  builds the contract fixtures from the real mod
scripts/fixtures/          the engine's own error.log lines, replayed by the selftest
scripts/fixtures/contract/ a LEGAL custom_gui window from a shipped mod, and six broken variants
docs/kind-census.json      the generated count every advertised number comes from
docs/engine-feedback.md    what the game's error log forced, and the before/after counts
docs/gui-pitfalls.md       the custom_gui window contract, the parking traps, the option-0 rule
docs/sources.md            every web source used, and every correction the install forced
```

## Licence

AGPL-3.0-or-later, matching the sibling project this one is modelled on. Every source file carries
the header.
