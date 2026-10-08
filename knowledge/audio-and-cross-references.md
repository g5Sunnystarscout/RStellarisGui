---
id: audio-and-cross-references
category: tooling
title: Audio and the scope boundary of this knowledge base
title_zh: 音频，以及本知识库的边界
summary: RStellarisGui generates .gui layouts; it does not register audio, and it should not duplicate the sibling project's audio measurements. This topic states the boundary, records the few GUI-adjacent facts that matter here (an element's clicksound, the reference's option_button/OPTION_TEXT convention), and points at the sibling's audio-assets topic for the rest instead of copying it.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.asset, .ogg, .wav, .txt, .gui]
tags: [audio, clicksound, sound, music, 44100, asset, option_button, OPTION_TEXT, scope, cross-reference, sibling]
related: [gui-layout-tool-surface, window-dismissal, per-kind-size-and-field-forms]
sources: [<clone>/RStellarScribe/knowledge/audio-assets.md]
---

## What it is

A knowledge base's value depends as much on what it refuses to cover as on what it covers. Two
boundaries:

1. **Audio registration is the sibling project's job, not this one's.** `RStellarScribe`
   (`<clone>/RStellarScribe`) owns `sound/`, `music/` and `.asset` registration, and it has
   measured those to a depth this plugin has no reason to repeat. Copying its numbers here would create
   two places that can drift, which is exactly the failure this project's generated-blocks discipline
   exists to prevent. **Read `RStellarScribe/knowledge/audio-assets.md` and its
   `register_audio_asset` / `validate_audio_asset` tools.**
2. **What DOES belong here is the audio a `.gui` element names.** That is a `.gui` field, and a
   `.gui`-shaped question is this plugin's.

## Syntax

```
# The only audio fields a .gui element carries. `clicksound` takes a sound NAME, not a path.
buttonType = {
	name = "confirm_button"
	size = { x = 180 y = 34 }
	clicksound = "ui_click"          # the engine's own defaults are usually what you want
}

# An option ROW's button, which is a GUI-side convention this plugin DOES enforce:
containerWindowType = {
	name = "geocentric_unga_nav_option"     # named by an event option's `custom_gui_option`
	buttonType = {
		name = "option_button"              # the name the engine binds inside the row
		text = "OPTION_TEXT"                # the engine fills this with the option's text
	}
}
```

## The sibling's audio facts, cross-referenced rather than restated

Stated here only so an agent knows they EXIST and where the authority is:

* `sound`/`music` `file` paths resolve **relative to the `.asset` file's own directory**, not to
  `sound/` (4569 of 5931 records can only be resolved that way).
* The sampling rate must be **44100 Hz**; the engine reports each offending track itself at
  `pdx_audiomusic_sdl.cpp:88` in `error.log`.
* `sound/` accepts only `.wav` and `music/` only `.ogg`; `soundtrack/`'s mp3/flac are the retail
  soundtrack and the engine does not load them.

The authority for all three is `RStellarScribe/knowledge/audio-assets.md` (and the compiled
`resources/knowledge/stellaris/media/audio-assets.toml`), which carries the counts. If one of them
changes, it changes THERE; this topic deliberately carries no count of its own that could go stale.

## The GUI-side rules this plugin does enforce

* An option ROW's button must be named `option_button` and carry `text = "OPTION_TEXT"`. A row container
  named `*_option` without that pair is `option-button-convention` (error) — the engine fills the button
  it finds under that name, and a row without one draws an option the player cannot read.
* `option_button` is resolved INSIDE the row container an event names with `custom_gui_option`, and is
  deliberately NOT a window-level contract requirement (see the `window-name-contract` topic).
* An event that names a `custom_gui` window still needs at least one `option`; the option is what
  closes the window (see the `window-dismissal` topic).

## Evidence

- `vanilla`: the `option_button` / `OPTION_TEXT` rule in full, with the install's own rows, is `docs/sources.md:73-116` §2.
- `vanilla`: `interface/diplomacy_caravaneer_event_view.gui:69-76` is the reference for a SCRIPTED control inside an event window (`tts_button`, an `effectbuttonType`). `docs/gui-pitfalls.md:253-254`.
- `sibling`: `RStellarScribe/knowledge/audio-assets.md` is the measured authority for `sound`/`music` path resolution, the 44100 Hz rule and the per-directory extension rules; `RStellarScribe/README.md:92-96` states the counts (5931 records, 4569, 44100 Hz).
- `sibling`: this plugin already depends on the sibling's shape elsewhere by design — `src/lib/mcp.mjs:5-7` states that its transport "matches the shape and observable behaviour of RStellarisScribe's lib/mcp.mjs", and `src/lib/knowledge.mjs` follows the sibling's catalogue contract (a TOML index, an id-addressed markdown resource, AND-semantics search).
- `measured`: the two projects' knowledge bases are separate on disk and are meant to be. `README.md:478-481` records why the `.gui` PARSE path was written here rather than reused from the sibling (the reader needs a line number on every node, because every finding reports `file:line`), which is the same boundary expressed in code.

## Rules

- Do not register audio with this plugin. Use the sibling's `register_audio_asset` / `validate_audio_asset`.
- Do not copy a sibling-measured count into this knowledge base. Cross-reference it, so there is one place that can be wrong.
- `clicksound` names a sound, not a path. Do not write a `.wav` or a `sound/`-relative path into a `.gui`.
- Any element whose name ends in `_option` and is meant to draw an event option needs `option_button` + `OPTION_TEXT` inside it.
- When a rule is about a file this plugin does not write (audio, `.asset`, `common/technology/`), say so and point at the project that owns it.

## 待确认

- Whether the engine resolves a `clicksound` name that no `.asset` registers silently or with a log line. Not measured here, and it is a sibling-shaped question rather than a `.gui` one.
