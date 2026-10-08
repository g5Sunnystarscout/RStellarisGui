---
id: text-channels
category: text
title: What the engine renders as text, and what it prints literally
title_zh: 引擎把什么当文本渲染，什么会原样打印
summary: A bracket data function in a value a WINDOW PAINTS is printed literally - the player reads [Root.GetName] on screen - while the same construct in a tooltip resolves. The only measured live-text channel inside a custom_gui window is effectbuttonType.buttonText. Wrapping has two explicit break spellings ($NEW_LINE$ and a literal \n), both real.
verified_version: Stellaris 4.4.6 "Pegasus"
file_types: [.gui, .yml]
tags: [bracket, data-function, Root.GetName, buttonText, effectbuttonType, live-value, scripted_loc, defined_text, pdx_tooltip, NEW_LINE, wrapping, text-live-value]
related: [text-has-a-size, bar-construction, control-visibility-is-a-potential]
sources: [<mods>/geocentric_origin/interface/zz_geocentric_unga.gui]
---

## What it is

There are TWO channels and they behave in opposite ways, which is why this is a topic of its own:

| where the string lands | how a bracket call behaves |
| --- | --- |
| painted text — `instantTextBoxType.text`, and any value a WINDOW draws | **printed literally**: the player reads `[Root.GetName]` |
| a tooltip — `pdx_tooltip`, `custom_tooltip`, `tooltipText` | **resolved** by the engine |
| `effectbuttonType.buttonText` | **resolved** — this is the only measured live-text channel inside a `custom_gui` window |

A bracket whose whole content is one unexpanded `[$Token$]` is a THIRD case: the engine substitutes
the token before it reads the text, so it is live data, not a literal.

## Syntax

```
# --- WRONG: painted text with a bracket call. The player reads the raw call.
# localisation/english/zz_geocentric_unga_l_english.yml
unga_chart_center_value:0 "[Root.GetName]"
# interface/zz_geocentric_unga.gui:791
instantTextBoxType = { name = "unga_chart_center" text = "unga_chart_center_value" maxWidth = 74 maxHeight = 18 }

# --- RIGHT: a live NUMBER reaches the screen through the one channel that resolves it.
# common/scripted_loc/00_scripted_loc.txt :3227-3230 defines the value,
# localisation value is the token, and the CONTROL carries buttonText + effect.
effectbuttonType = {
	name = "unga_power_value_1_main"
	buttonText = "unga_power_value_2"        # a localisation KEY, like `text`
	effect = "unga_power_value_effect"       # a key in common/button_effects/
	quadTextureSprite = "gfx_transparency_white"
	size = { x = 70 y = 18 }
}

# The value the token expands from, consumed as [This.<Name>] in a TOOLTIP:
defined_text = { name = GetUngaAttUnNato value = value:unga_att_un_nato }

# --- Explicit line breaks. BOTH are real breaks the wrapper models.
NEW_LINE: "\n"                             # localisation/english/federations_l_english.yml:34
unga_news_wire:0 "line one\nline two"      # a literal \n escape, 34289 uses across 108 english files
unga_news_wire:0 "line one$NEW_LINE$two"   # the nested-key spelling of the same break
```

## Evidence

- `measured`, 2026-10-05, Stellaris 4.4.6, the working mod's UN General Assembly window, game running in Chinese, read off a screenshot at 1440x960: `interface/zz_geocentric_unga.gui:791` paints `text = "unga_chart_center_value"` on an `instantTextBoxType`, and the value was `unga_chart_center_value:0 "[Root.GetName]"`. The window showed `[Root.Ge ...` in the middle of the donut chart (the element's 74 px box clipped it). The same construct sat in `unga_news_wire`, painted at `:2327`. `docs/gui-pitfalls.md:359-364`.
- `measured`: the fix was to make those values static text in both languages; the `.gui` was unchanged (157,596 B, re-asserted byte-identical). `<clone>/unga-fix/RESULT-ICONS-LOC.md:8,17`.
- `vanilla`: bracket calls appear **9201** times in `localisation/english/*.yml`, and those uses are tooltips, descriptions and event text. `docs/gui-pitfalls.md:365-366`.
- `vanilla`, the single window-text counter-example: `interface/situation_log_timelines.gui:20-26` is an `instantTextBoxType` whose `text` is the key `TIMELINE_EVENT_YEAR`, defined at `localisation/english/main_2_l_english.yml:995` as `"[GetYear]"`. That call is **scope-free** — it needs no scope to resolve — so it is NOT evidence that `[Root.X]` / `[This.X]` resolve in painted text. The honest rule is therefore: painted text must not depend on a bracket call at all. `docs/gui-pitfalls.md:367-371`.
- `vanilla`: the `defined_text` -> `[This.<Name>]` route is real — `common/scripted_loc/00_scripted_loc.txt:3227-3230` -> `localisation/english/toxoids_l_english.yml:735`. `$VAR|flag$` formatting exists with the same flag vocabulary as HOI4. There is **NO** `[?variable]` form. `docs/gui-pitfalls.md:382-387`.
- `vanilla`: `buttonText` appears 456 times on a `buttonType`, 14 on a `guiButtonType` and 2 on an `effectbuttonType` (`interface/fleet_view.gui:708-721`), and it is a localisation KEY like `text`. It was in no kind's field set, so the ONE measured live-text channel was reported as `unknown-field` **62 times** on the working mod before GAP-7 closed that. `docs/gui-pitfalls.md:970-976`.
- `measured` (GAP-5): a readout's value `[$GetUngaAttUnNato$]` measures **146 px** (english, `cg_16b`) / **152 px** (simp_chinese) — the unresolved token's own width — inside a **70 px** column, producing **30 false `text-overflow` findings**. A string carrying a `[$...$]` whose inner token did not resolve is now marked **live**, and on the resolving channel it is NOT charged as ink: no `text-overflow`, collision extent falls back to its own box, and the measurement is reported once under `text-live-value` (info). The plain `instantTextBoxType` case is NOT excluded — that is the trap above and keeps its findings. `docs/gui-pitfalls.md:923-940`.
- `measured` (GAP-10): `[$GetUngaAttUnNato$]` also contains a `GetX`, so `window-text-data-function` reported all 32 readouts as "the player reads this literally" about strings the player reads as a NUMBER. Shipped file: `window-text-data-function` **32 -> 0**. `docs/gui-pitfalls.md:942-951`.
- `vanilla`: a literal `\n` escape in a localisation value is used **34289 times across 108 english files**, and the bilingual mod uses it 37 times per language (`zz_geocentric_unga_l_english.yml:211`). `$NEW_LINE$` is a nested localisation key whose value IS a newline (`localisation/english/federations_l_english.yml:34`). `docs/gui-pitfalls.md:495-498`.

## Rules

- A value a window PAINTS must be static text, or it must arrive through a channel proven in that position. Do not put `[Root.X]` / `[This.X]` in `instantTextBoxType.text`.
- Tooltip fields (`pdx_tooltip`, `tooltip`, `tooltipText`, `custom_tooltip`, `delayedTooltipText`) are deliberately EXEMPT from the `window-text-data-function` rule, because that is where the engine does resolve bracket calls.
- Ask for a live number with `effect` (and `labelEffect` when you want the label button too) — that puts the value on `effectbuttonType.buttonText`. A caller must not have to pass a label it does not want purely to reach the channel (GAP-8).
- A live value is measured but not charged as ink, and it is reported once under `text-live-value`; `textMeasurement.liveExcluded` in the report says so, so a clean count cannot be mistaken for silence.
- `window-text-data-function` fires on a `[Scope.Func]` / `[GetX]` / `[?var]` inside a value a window paints, but NOT when a bracket's whole content is one unexpanded `[$Token$]`. A genuine call beside a token (`[$GetUngaX$] and [Root.GetName]`) still fires, which is why the matcher scans every bracket rather than only the first.
- The live value button carries `quadTextureSprite = "gfx_transparency_white"` in the reference (`zz_geocentric_unga.gui:3354`) so the control has a hit region that paints nothing — see the `transparency-white-plate` topic for what that sprite actually is.
- Model both explicit break spellings. Without them a 8-paragraph news block measures as one run-on line.

## 待确认

- Whether a bracket data function EVER resolves in painted text in 4.4.6. The one vanilla counter-example found (`[GetYear]`) is scope-free, so the question is open for scoped calls; the measured failure is what the plugin documents.
- Whether a `[$Token$]` whose `defined_text` does not exist resolves to empty or to the literal token. The plugin cannot prove resolution, which is why the judgement belongs to the channel-aware rule rather than to a static check.
