---
id: non-gui-presentation-surfaces
category: drawing
title: The feedback a mod can give without a .gui file - event pictures, alerts, modifier icons, flags
title_zh: 不写 .gui 也能做的反馈——事件配图、警报、修正图标、旗帜
summary: A window is not the only surface. The install ships 639 event pictures, 131 .gfx files with 8539 spriteType blocks, 12008 interface textures, 1032 flag textures, a common/alerts.txt, a common/message_types/ tree, common/static_modifiers (icon + icon_frame per block) and common/notification_modifiers. Each is moddable in a different way and each reaches the player WITHOUT any of the custom_gui contract, which makes them the cheap half of a mod's UI.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui, .gfx, .txt, .dds]
tags: [event-picture, alert, static-modifier, icon, flag, emblem, notification, spriteType, presentation]
related: [texture-registration, script-routes-to-a-window, host-gui-surface, inline-icon-token-rule]
sources: []
---

## What it is

Everything a player SEES that is not a window this project emits. Measured over the install:

| surface | where | count | how a mod uses it |
| --- | --- | --- | --- |
| event pictures | `gfx/event_pictures/*.dds` | **639** | `picture = <name>` in an event; the picture is the whole left panel of the window |
| sprite definitions | `interface/*.gfx` | **131 files, 8539 `spriteType`** | name a texture for `spriteType` / `quadTextureSprite` to draw |
| interface textures | `gfx/interface/**/*.dds` | **12008** | the atlas a `spriteType` points at |
| flags / emblems | `flags/**/*.dds` | **1032** | `flagSpriteType` in a `.gfx`; the emblem on a country's flag |
| border/9-slice tiles | `interface/core.gfx` (`corneredTileSpriteType`) | 335 blocks install-wide | `quadTextureSprite` for anything that must stretch |
| alerts | `common/alerts.txt` | 1 file | an alert's `icon`, its trigger and the view it opens |
| message types | `common/message_types/00_message_types.txt` | 1 file | the message entries `create_message` posts |
| notification modifiers | `common/notification_modifiers/00_notification_modifiers.txt` | 1 file | `add_notification_modifier` / `remove_notification_modifier` |
| static modifiers | `common/static_modifiers/*.txt` | 37 files | `icon = "<path>.dds"` + `icon_frame = N` per block |
| inline icons | `localisation/**/*.yml` `£token£` | - | a character-sized icon inside text, `GFX_text_<token>` |

**The structural difference that matters.** Every surface above reaches the player through a
mechanism the ENGINE already drives: an event window exists because an event fired, an alert exists
because its trigger passed, a message exists because `create_message` ran. A mod supplies content to
those mechanisms and inherits none of the `custom_gui` name contract - no 26-32 element names to
satisfy, no crash on a missing one, no dismissal problem. That makes them strictly cheaper than a
custom window, and the right default when the job is feedback rather than interaction.

They are also the only surfaces available when the answer to "how do I open a window" is "you cannot"
(`script-routes-to-a-window`).

## Syntax

```
# 1. EVENT PICTURE - the cheapest way to make an event look like a mod's own.
country_event = {
    id = my_mod.10
    picture = my_mod_assembly_hall          # -> gfx/event_pictures/my_mod_assembly_hall.dds
    title = my_mod.10.name
    desc = my_mod.10.desc
    option = { name = my_mod.10.a }
}
# 6710 vanilla event blocks name a picture, from 567 DISTINCT picture values - so a mod's own
# picture is a normal, first-class thing to add, not a hack.

# 2. REGISTERING A TEXTURE so a .gui can draw it. `interface/zz_my_mod.gfx`:
spriteType = {
    name = "GFX_my_mod_seal"
    texturefile = "gfx/interface/icons/my_mod_seal.dds"
}
corneredTileSpriteType = {                  # for anything that must STRETCH: 9-slice
    name = "GFX_my_mod_panel_tile"
    texturefile = "gfx/interface/my_mod_panel_tile.dds"
    borderSize = { x = 8 y = 8 }
}
# 0 of 8539 spriteType blocks use `size` or `borderSize`; a cornered tile is where borderSize belongs.

# 3. STATIC MODIFIER ICON - what the modifier looks like in a tooltip or the planet breakdown.
my_mod_prosperity = {
    icon = "gfx/interface/icons/planet_modifiers/pm_planet_from_space.dds"
    icon_frame = 3
    country_resource_influence_mult = 0.10
}

# 4. INLINE ICON inside localisation text: declare `GFX_text_<token>` and write £token£.
#    localisation/english/my_mod_l_english.yml  (UTF-8 WITH BOM)
#    my_mod.10.desc:0 "The assembly opened. £my_mod_seal£ Delegates were seated."
#    -> the sprite must be named GFX_my_mod_seal; there is no fallback to the plain name.

# 5. ALERT / MESSAGE - content for a mechanism the engine already routes.
#    common/alerts.txt and common/message_types/00_message_types.txt are where an alert's icon and
#    the message type's sprite are named; `create_message` posts one.
```

## Evidence

- `vanilla`: `gfx/event_pictures/*.dds` = **639** files. `events/**/*.txt` contains **6710** `picture`
  assignments across **567** distinct values (measured with a recursive `^\s*picture\s*=` scan over
  the 170 files under `events/`).
- `vanilla`: `interface/*.gfx` = **131** files defining **8539** `spriteType` blocks, **335**
  `corneredTileSpriteType`, **101 + 93** `progressbarType`/`progressbartype`, **21** `portraitType`,
  **18** `flagSpriteType`, **33** `bitmapfont_override` (the per-language TrueType swap).
- `vanilla`: `gfx/interface/**/*.dds` = **12008** textures; `flags/**/*.dds` = **1032**.
- `vanilla`: `common/static_modifiers/` = **37** files, and the icon fields are paths, not sprite
  names: `common/static_modifiers/00_static_modifiers.txt:284`
  `icon = "gfx/interface/icons/planet_modifiers/pm_planet_from_space.dds"`, `:290` `icon_frame = 3`.
- `vanilla`: `common/alerts.txt`, `common/message_types/00_message_types.txt`,
  `common/notification_modifiers/00_notification_modifiers.txt` and
  `common/start_screen_messages/00_start_screen_messages.txt` each exist as a single file, and the
  binary carries the corresponding `advisor_notification_*` key family
  (`advisor_notification_enemy_declared_war`, `advisor_notification_federation_formed`, ...).
- `binary`: `add_notification_modifier = <key>` and `remove_notification_modifier` are documented
  effects (`script_documentation/effects.log:1757`, `:1761`), and `create_message` at `:1589`.
- `log`: `logs/script_documentation/effects.log:691` `set_advisor_active - Enables or disables the VIR
  window pop-in` - the advisor family is a window the ENGINE owns, fed by content.
- `sibling`: the `£token£` rule (the sprite must be declared as `GFX_text_<token>`; there is no
  fallback to a plain `GFX_<token>` name) was established by `RStellarScribe` and is recorded here
  because a mod's inline icon is a presentation surface like any other. The working mod uses it for
  the UN emblem in its window title (`£unga_un_emblem£`).

## Rules

- Reach for an event picture, an alert, a message or a static-modifier icon BEFORE building a window:
  each is content for a mechanism the engine already drives, so none of them carries the `custom_gui`
  name contract or the dismissal problem.
- A texture a `.gui` draws must be registered in a `.gfx` file. `spriteType` rejects `size` and
  `borderSize`; a sprite that must stretch is a `corneredTileSpriteType` with `borderSize`
  (`texture-registration`).
- Populate a texture whose dimensions you know: a `spriteType` draws at its texture's natural size and
  the element cannot override it (`iconType` takes no `size`).
- A static modifier's icon is a PATH string, not a sprite name - the two are different field
  conventions in the same install.
- Inline icons are `GFX_text_`-prefixed and there is no fallback (`inline-icon-token-rule`).
- Localisation `.yml` is UTF-8 **with** BOM; a `.gui`, `.gfx` or `.txt` is UTF-8 **without** one.
- The engine read is not the game's read. These surfaces are verified as LOADED (0 error lines naming
  them); on-screen appearance is a separate claim.

## 待确认

- Which of these surfaces have been verified IN GAME. The sibling project's probe mod was accepted by
  a running 4.4.6 with zero error lines naming its image/sound resources, and a deliberately broken
  control produced the engine's own named errors - so "loaded" is proven and "looks right" is not.
- Whether `common/alerts.txt` and `common/message_types/00_message_types.txt` are safely extensible by
  a mod, or whether a mod must override the whole file. Neither was exercised, and the project has no
  measurement of how the engine merges those two files.
- Whether an event picture can come from a mod path outside `gfx/event_pictures/`. Every vanilla use
  is a bare name resolved against that directory; a path was not tested.
- Whether `icon_frame` on a static modifier selects a frame within the icon atlas or an index into a
  separate sprite sheet. Both readings fit the observed values (2 and 3 next to different `icon`
  paths) and the two were not distinguished.
