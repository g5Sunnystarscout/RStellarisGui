---
title: Stellaris 4.4.6 "Pegasus"
---

Every fact in this knowledge base was measured against the installed **Stellaris 4.4.6 "Pegasus"**
at `<Stellaris>`, and most of them against a working mod that ships six to eleven
`custom_gui` event windows (`<mods>\geocentric_origin`).

The evidence vocabulary, and what each kind of claim rests on:

| tag | what it is | how to reproduce |
| --- | --- | --- |
| `binary` | a literal in `<Stellaris>\stellaris.exe` | `node out/probe-binary-strings.mjs` |
| `vanilla` | a count over the install's own 177 `.gui` files | `node scripts/gui-census.mjs`, `node scripts/kind-census.mjs` |
| `events` | a count over the install's own `events/` (174 files) | the `out/probe-*.mjs` measurement scripts |
| `log` | the engine's runtime output (`error.log`, `game.log`, `script_documentation/`) | the `gui_log_scan` tool |
| `measured` | this project's own experiment, stated with its numbers | the script named in the item |
| `sibling` | a measurement that belongs to `RStellarisScribe` | that project's `knowledge/` |

**The engine is the source of truth** — its binary, its generated `script_documentation`, its logs.
Vanilla content is a cross-check, never the source. Four wrong conclusions in this project came from
counting what vanilla *uses*; see the `engine-capability-vs-usage` topic.

**What is deliberately NOT in here.** Anything a topic could not establish is recorded in that
topic's `## 待确认` section rather than asserted. A topic with no `## Evidence` item fails the build.

The canonical place for a RULE is the topic. The canonical place for the HISTORY — the defect, the
crash dump, the before/after counts on the real mod — is `docs/gui-pitfalls.md`, and every topic that
has a counterpart there cites the section and line.
