//------------------------------------------------------------------------------------
// layout.mjs -- Part of RStellarisGui
//
// The component model and the layout engine. This is the centre of gravity of the project:
// an agent writing `.gui` by hand gets no feedback, so the tool must be able to say where a
// rectangle actually lands before the game ever runs.
//
// BASE RESOLUTION: every coordinate in a `.gui` file is in the game's scaled UI pixel space.
// This project assumes a 1920x1080 base for all geometry and states that assumption in every
// report, because "overlap" and "out of bounds" are only meaningful relative to a stated base.
// The game scales the whole UI, so at 3840x2160 with 0.5 UI scaling the same numbers describe
// the same layout.
//
// THE CANONICAL COORDINATE SYSTEM (see src/lib/coords.mjs, which owns the conversion):
//
//   origin at the WINDOW's top-left, +x RIGHT, +y DOWN, units are scaled UI pixels at the
//   1920x1080 base. A rect is `{x, y, width, height}` with `x`/`y` the TOP-LEFT corner, and a
//   node's `position` is the offset of its top-left corner from its PARENT's top-left corner -
//   for every element, whatever its `orientation` says.
//
// THE RECT RULE, in canonical coordinates:
//
//   absolute = f(position, size, orientation, origo, parentRect)
//
// `orientation` selects a nine-point anchor ON THE PARENT; `origo` selects a nine-point reference
// point ON THE ELEMENT ITSELF (default `upper_left`). The element is placed so that its `origo`
// point sits at the parent's `orientation` point, offset by `position`.
//
//   anchor  = anchorPoint(parentRect, orientation)             // default upper_left
//   pivot   = anchor + position * axisDirection(orientation)   // dir.y = -1 for lower_*
//   corner  = pivot - size * origoFraction                     // default origo upper_left
//
// THE `axisDirection` FACTOR IS THE WHOLE ENGINE QUIRK, and it is the reason this project had a
// bug that no amount of preview looking could catch. The engine resolves a `lower_*` anchor's
// offset in the anchor's OWN frame, so a positive y there moves AWAY from the parent (up the
// screen). Canonical y always counts downward. Both spaces are correct; they differ by a sign on
// one axis, for one family of anchors. `src/lib/coords.mjs` is the only place that knows the
// difference, and it states the evidence.
//
// So with both defaults (upper_left/upper_left) `position` is simply the element's top-left
// corner relative to the parent's top-left, which is the common case. With
// `orientation = center, origo = center` the element is centred on its parent's centre. With
// `orientation = lower_left, position = { x = 7, y = -11 }` the element's top-left is 7 px right
// of the parent's left edge and 11 px ABOVE the parent's bottom edge - i.e. canonical
// `{ x = 7, y = parentHeight - 11 }`.
// SIZE FORMS - all four are legal and all four appear in vanilla 4.4.6:
//
//   size = { width = 850 height = 890 }   static
//   size = { x = 60 y = 48 }              same thing, used with corneredTileSpriteType
//   width = 100%                          percent of the parent's width
//   width = 100%%                         percent of the parent minus this element's position
//   width = -16                           parent's width minus position minus 16
//
// The last two are NOT errors. Measured in the verified install: 64 negative size values and
// 24 `%%` values. An earlier revision of this project flagged them; see docs/sources.md.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

import { ANCHORS, kindSpec, kindSpecByKeyword, asFieldElementKind, isKnownField, isEngineRejectedField, isFieldRejectedForKind, kindAcceptsField, normaliseAnchor, ORIENTATION_VALUES, sizeFormFor, translateFieldForKind, SIZE_FORMS } from './kinds.mjs';
import { enginePositionToCanonical, yDirectionForAnchor, anchorFractions } from './coords.mjs';
// THE BAR PRIMITIVE. `computeLayout` is the one function the rect table, the preview, the
// validator, the contract analysis and the emitter all go through, so a component expands HERE:
// a bar then cannot mean one thing to the file and another to the report, and no caller has to
// remember to expand it. `components.mjs` is a leaf (it imports nothing from this module), which
// is what keeps this import acyclic.
import { expandBarsInTree, expandMatricesInTree } from './components.mjs';

/** The stated base resolution for every geometry report. */
export const BASE_RESOLUTION = { width: 1920, height: 1080 };

/** Default layout tree, so a caller can start from something that renders. */
export function defaultLayout(options = {}) {
  const name = options.name ?? 'mod_custom_window';
  const width = options.width ?? 620;
  const height = options.height ?? 320;
  return {
    schema: 'rstellarisgui/layout@1',
    name,
    baseResolution: { ...BASE_RESOLUTION },
    variables: {
      '@window_width': String(width),
      '@window_height': String(height),
    },
    root: {
      id: 'root',
      kind: 'container',
      name,
      orientation: 'center',
      origo: 'center',
      position: { x: 0, y: 0 },
      size: { width: '@window_width', height: '@window_height' },
      moveable: true,
      background: { sprite: options.background ?? 'GFX_tile_large_bg', name: 'background' },
      children: [
        {
          id: 'title',
          kind: 'text',
          name: 'window_title',
          position: { x: 20, y: 14 },
          // A text element has NO `size`: the engine's text parser rejects it ("Unexpected token:
          // size") and takes the box from `maxWidth`/`maxHeight` instead. 3138 of 3202 vanilla
          // text blocks declare maxWidth and 2890 declare maxHeight.
          maxWidth: width - 40,
          maxHeight: 28,
          font: options.headingFont ?? 'malgun_goth_24',
          text: `${name}_title`,
          format: 'left',
          alwaysTransparent: true,
        },
        {
          id: 'close',
          kind: 'button',
          name: 'close',
          // Sized from the sprite's natural size at validate/preview time: GFX_main_close_button
          // is a fixed-size SpriteType (114x38 in 4.4.6), so declaring a different size would
          // be the `fixed-size-sprite-resized` mistake this tool exists to catch.
          quadTextureSprite: 'GFX_main_close_button',
          position: { x: -10, y: 10 },
          orientation: 'upper_right',
          shortcut: 'ESCAPE',
          clicksound: 'back_click',
          alwaysTransparent: true,
        },
        {
          id: 'body',
          kind: 'text',
          name: 'body_text',
          position: { x: 20, y: 56 },
          maxWidth: width - 40,
          maxHeight: Math.max(40, height - 146),
          font: options.bodyFont ?? 'cg_16b',
          text: `${name}_desc`,
          fixedSize: true,
          format: 'left',
          alwaysTransparent: true,
        },
        {
          id: 'accept',
          kind: 'effectbutton',
          name: 'accept_button',
          quadTextureSprite: 'GFX_tiling_button_standard',
          size: { width: 180, height: 34 },
          position: { x: 0, y: -14 },
          orientation: 'center_down',
          buttonFont: options.bodyFont ?? 'cg_16b',
          text: `${name}_accept`,
          effect: `${name}_accept_effect`,
          clicksound: 'tab_click',
        },
      ],
    },
    localisation: [],
    // The default window's own effect, so the default tree is SELF-CONSISTENT: without it the
    // emitted `.gui` references an `effectbuttonType.effect` that nothing defines, and
    // `gui_emit_files` writes no button_effects file at all - a mod that silently does nothing
    // when the button is pressed. `gui_layout_new` used to add this after calling defaultLayout;
    // it belongs here, with the button that needs it.
    //
    // The SHAPE matters: 4.4.6 wants `add_resource = { <resource> = <amount> }` (1161 vanilla
    // uses). The older `add_resource = { resource = X amount = N }` is rejected with
    // "Unexpected token: resource" / "Unexpected token: amount" - 14 such blocks in one run of
    // this project's own output.
    effects: {
      [`${name}_accept_effect`]: {
        potential: { always: true },
        effect: { add_resource: { influence: 0 } },
      },
    },
    event: null,
  };
}

/**
 * Walk a layout tree, yielding `{node, parent, depth, path}` in document order.
 * `path` is a dot path of ids/names, used in findings.
 */
export function walkLayout(root, visit, parent = null, depth = 0, path = '') {
  if (!root) return;
  const label = root.name ?? root.id ?? `#${depth}`;
  const here = path ? `${path}/${label}` : label;
  visit(root, parent, depth, here);
  for (const child of root.children ?? []) walkLayout(child, visit, root, depth + 1, here);
}

/** Recursively collect `@variable` declarations found on nodes and in a variables map. */
export function collectVariables(layout) {
  const variables = { ...(layout.variables ?? {}) };
  walkLayout(layout.root, (node) => {
    for (const [key, value] of Object.entries(node.variables ?? {})) {
      if (!(key in variables)) variables[key] = value;
    }
  });
  return variables;
}

/**
 * Resolve `@variable` references, then interpret a size/position component.
 *
 * @param {string|number} raw
 * @param {number} parentValue the parent's width (for an x component) or height (for a y one)
 * @param {{position?: number, field?: string, variables?: object}} context
 *   `position` is the already-resolved position on the same axis, needed for the
 *   `%%` and negative forms.
 * @returns {{value: number|null, formula: string, literal: string}}
 */
export function resolveComponent(raw, parentValue, context = {}) {
  const variables = context.variables ?? {};
  const original = raw;
  let text = raw;

  if (typeof text === 'string' && text.startsWith('@')) {
    const seen = new Set();
    while (typeof text === 'string' && text.startsWith('@')) {
      if (seen.has(text)) break;
      seen.add(text);
      const next = variables[text];
      if (next === undefined) {
        return { value: null, formula: `unresolved variable ${text}`, literal: String(original), unknownVariable: text };
      }
      text = next;
    }
  }

  if (typeof text === 'number') {
    if (!Number.isFinite(text)) {
      return { value: null, formula: `not a finite number: ${text}`, literal: String(original) };
    }
    if (text < 0) {
      const position = context.position ?? 0;
      return {
        value: parentValue + text - position,
        formula: `parent ${parentValue} ${text} - position ${position}`,
        literal: String(original),
        kind: 'negative',
      };
    }
    return { value: text, formula: String(text), literal: String(original), kind: 'absolute' };
  }

  // Absent size components arrive here as null/undefined (see declaredOrNull). Returning
  // `value: null` is what lets the caller treat the component as "not declared" and fall back to
  // the sprite's natural size; returning 0 instead made that fallback unreachable.
  if (text === null || text === undefined || text === '') {
    return { value: null, formula: 'not declared', literal: '', kind: 'absent' };
  }

  if (typeof text !== 'string') {
    return { value: null, formula: `not a number: ${JSON.stringify(text)}`, literal: String(original) };
  }

  const trimmed = text.trim();
  const percentMatch = /^(-?[0-9.]+)\s*(%{1,2})$/.exec(trimmed);
  if (percentMatch) {
    const fraction = Number(percentMatch[1]) / 100;
    const doubled = percentMatch[2] === '%%';
    if (doubled) {
      const position = context.position ?? 0;
      return {
        value: parentValue * fraction - position,
        formula: `parent ${parentValue} * ${percentMatch[1]}% - position ${position}`,
        literal: trimmed,
        kind: 'percent-minus-position',
      };
    }
    return {
      value: parentValue * fraction,
      formula: `parent ${parentValue} * ${percentMatch[1]}%`,
      literal: trimmed,
      kind: 'percent',
    };
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    if (numeric < 0) {
      const position = context.position ?? 0;
      return {
        value: parentValue + numeric - position,
        formula: `parent ${parentValue} ${numeric} - position ${position}`,
        literal: trimmed,
        kind: 'negative',
      };
    }
    return { value: numeric, formula: String(numeric), literal: trimmed, kind: 'absolute' };
  }

  return { value: null, formula: `not a number: ${trimmed}`, literal: trimmed, unknownVariable: undefined };
}

/**
 * Read a size component, treating "absent" as null rather than 0.
 *
 * This distinction is load-bearing: 0 is a real value (vanilla hides elements with
 * `size = { width = 0 height = 0 }`), whereas null means "not declared, ask the sprite". An
 * earlier revision used `?? 0` here, which turned every undeclared size into a declared zero and
 * made the sprite-natural-size fallback - and the `size-indeterminate` finding - unreachable.
 * The default window's 114x38 close button computed as 0x0 as a result.
 */
function declaredOrNull(...candidates) {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && candidate !== '') return candidate;
  }
  return null;
}

/**
 * Build the `spriteLookup` that `computeRect` uses to resolve an unsized sprite to the size the
 * engine actually draws.
 *
 * THE FRAME COUNT MATTERS. A `spriteType` with `noOfFrames = 3` is a HORIZONTAL STRIP of three
 * frames and the engine draws ONE of them, so the drawn width is the texture's width divided by the
 * frame count. `GFX_main_close_button` is the worked example: `close_button.dds` is 114x38 with
 * `noOfFrames = 3`, so the button is 38x38 - not 114x38. Reporting the strip's full width made every
 * hit region, overlap and visibility conclusion about a multi-frame sprite up to `noOfFrames` times
 * too wide, which is exactly the kind of wrong-but-plausible number a rect table exists to prevent.
 *
 * This lives here, and is exported, because it was previously written out three times - in
 * validate.mjs, preview.mjs and web.mjs - and the copies drifted: the web server's inline
 * version silently failed and made the default close button report as 0x0 in the element tree
 * and the rect table while the drawn SVG sized it correctly. One implementation, one behaviour.
 *
 * @param {object} assets an asset index (see asset-index.mjs)
 * @returns {((name: string) => {width: number, height: number, frameCount: number, textureWidth: number, textureHeight: number}|null)|null}
 */
export function makeSpriteLookup(assets) {
  if (!assets?.sprites || !assets?.textures) return null;
  return (name) => drawnSpriteSize(assets, name);
}

/**
 * How the engine draws one `spriteType`: the size of ONE frame, and where frame 0 lives in the
 * texture strip.
 *
 * `noOfFrames = N` means the texture is a horizontal strip of N frames (`close_button.dds` is
 * 114x38 with three 38x38 frames, `GFX_button_150_24` is a 522x48 strip of 174x48 frames) and the
 * engine draws one of them, stretched to the element's rect. Everything that needs a sprite's drawn
 * geometry - the layout engine's natural-size fallback, the SVG renderer, the PNG rasteriser - goes
 * through this function, so none of them can disagree about which rectangle of the texture is the
 * sprite.
 *
 * @returns {{width: number, height: number, frameCount: number, textureWidth: number, textureHeight: number,
 *            source: {x: number, y: number, width: number, height: number}}|null}
 */
export function drawnSpriteSize(assets, name) {
  if (typeof name !== 'string' || name === '') return null;
  const record = assets?.sprites?.[name];
  const texture = record?.textureFile ? assets?.textures?.[record.textureFile] : null;
  if (!texture?.ok || !texture.width || !texture.height) return null;
  const frameCount = Number.isFinite(record?.frameCount) && record.frameCount > 1 ? Math.floor(record.frameCount) : 1;
  const width = Math.max(1, Math.round(texture.width / frameCount));
  return {
    width,
    height: texture.height,
    frameCount,
    textureWidth: texture.width,
    textureHeight: texture.height,
    source: { x: 0, y: 0, width, height: texture.height },
  };
}

/** A rect helper. */
export function rect(x, y, width, height) {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

/** Nine-point anchor coordinates inside a rect. */
export function anchorPoint(rectValue, anchorName) {
  const canonical = normaliseAnchor(anchorName) ?? 'upper_left';
  const entry =
    Object.values(ANCHORS).find((candidate) => candidate.label === canonical) ?? { x: 0, y: 0, label: 'upper_left' };
  return {
    x: rectValue.x + rectValue.width * entry.x,
    y: rectValue.y + rectValue.height * entry.y,
    canonical: entry.label,
  };
}

// Single source of truth for anchor spellings: kinds.mjs.
const ANCHOR_TABLE = ANCHORS;
const ANCHORS_LOOKUP = ANCHORS;

/** Read a node's position, tolerating `position = { x y }` and missing values. */
export function readPosition(node, variables) {
  const raw = node.position ?? {};
  const x = resolveComponent(raw.x ?? 0, 0, { variables });
  const y = resolveComponent(raw.y ?? 0, 0, { variables });
  return { x: x.value ?? 0, y: y.value ?? 0, rawX: x, rawY: y };
}

/**
 * Read a node's `position` as a canonical corner offset, resolving the positional literals the
 * engine accepts (`%`, `%%`, a plain number, an `@variable`).
 *
 * The parsed tree already stores canonical positions (`canonicaliseLayoutPositions`), so this is
 * the layout engine's normal read: no orientation arithmetic happens here, because there is none
 * left to do. `readCanonicalPosition` below is the ENGINE -> CANONICAL entry point, for callers
 * holding a node straight out of a `.gui` file.
 */
/**
 * Resolve one canonical position component.
 *
 * A canonical `position` is an offset from the parent's `orientation` anchor, so it is a plain
 * signed number and a negative one stays negative - `resolveComponent`'s `-N` form ("the parent
 * minus N") is an ENGINE size/position idiom, not a canonical one, and using it here is what once
 * turned a close button's `x = -10` into `x = parentWidth - 10`.
 *
 * The forms that do need the parent are the relative ones:
 *   `50%`  / `50%%`  a percentage of the parent's width (x) or height (y)
 *   `@var`           an `@variable` that holds any of the above
 */
function resolvePositionComponent(raw, parentValue, variables) {
  let text = raw;
  const seen = new Set();
  while (typeof text === 'string' && text.startsWith('@') && !text.startsWith('@[')) {
    if (seen.has(text)) break;
    seen.add(text);
    const next = variables?.[text];
    if (next === undefined) return 0;
    text = next;
  }
  if (typeof text === 'number') return Number.isFinite(text) ? text : 0;
  if (typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const percent = /^(-?[0-9.]+)\s*(%{1,2})$/.exec(trimmed);
  if (percent) return (parentValue * Number(percent[1])) / 100;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * Read a node's canonical `position`, resolving the literals it may carry. See
 * `resolvePositionComponent` for what "canonical" means for the sign of a negative value.
 */
export function readCornerPosition(node, parentWidth, parentHeight, variables = {}) {
  const raw = node.position ?? {};
  return {
    x: resolvePositionComponent(raw.x ?? 0, parentWidth, variables),
    y: resolvePositionComponent(raw.y ?? 0, parentHeight, variables),
  };
}
/**
 * Read a node's `position` in CANONICAL coordinates: the offset of the pivot from the parent's
 * `orientation` anchor, with +y DOWN, for every orientation.
 *
 * A `.gui` file stores the engine's own reading of that offset, and every anchor on the parent's
 * BOTTOM edge (`lower_left`, `center_down`, `lower_right`) resolves a positive y AWAY from the
 * parent - up the screen - so the sign of y is inverted for those. The conversion is
 * `src/lib/coords.mjs`'s job. The parsed tree does not need this function (see
 * `readCornerPosition`); it exists for callers that hold raw engine fields.
 *
 * @param {object} node
 * @param {number} parentWidth canonical parent width (for a `%`-form position component)
 * @param {number} parentHeight canonical parent height
 */
export function readCanonicalPosition(node, parentWidth, parentHeight) {
  const raw = node.position ?? {};
  const orientation = normaliseAnchor(node.orientation) ?? 'upper_left';
  const literal = (value, parentValue) => {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const text = String(value).trim();
    const percent = /^(-?[0-9.]+)\s*(%{1,2})$/.exec(text);
    if (percent) return (parentValue * Number(percent[1])) / 100;
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : 0;
  };
  const engineX = literal(raw.x, parentWidth);
  const engineY = literal(raw.y, parentHeight);
  const canonical = enginePositionToCanonical(
    { x: engineX, y: engineY },
    orientation,
    { x: 0, y: 0, width: parentWidth, height: parentHeight },
  );
  return { x: canonical.x, y: canonical.y, engineX, engineY, orientation };
}

/**
 * The `origo` a node is laid out with: `centerPosition = yes` behaves exactly like `origo = center`
 * on an icon (285 vanilla uses), so the layout engine and the converter both fold it in the same
 * way. One helper, because a converter that folded it differently from the layout engine would put
 * every centre-anchored icon half its own size away from the preview.
 */
export function displayedOrigo(node) {
  if (node?.origo) return normaliseAnchor(node.origo) ?? 'upper_left';
  if (node?.centerPosition) return 'center';
  return 'upper_left';
}

/**
 * Compute the absolute rectangle of a node inside a parent rectangle.
 *
 * Both rectangles are CANONICAL (origin top-left, +y down). The engine's anchor-relative reading
 * of `position` is folded in by `yDirectionForAnchor`.
 *
 * @returns {{rect: object, trace: object}}
 */
export function computeRect(node, parentRect, variables, options = {}) {
  // `enginePosition: true` reads `node.position` the way the ENGINE does: as an offset inside the
  // `orientation` anchor. The canonical model never wants that, but the import's first pass does -
  // it needs the engine's own rects before it can convert anything.
  const position = options.enginePosition
    ? {
        x: Number(node.enginePosition?.x ?? node.position?.x ?? 0) || 0,
        y: Number(node.enginePosition?.y ?? node.position?.y ?? 0) || 0,
      }
    : options.canonicalPosition ?? readCornerPosition(node, parentRect.width, parentRect.height, variables);
  const orientation = normaliseAnchor(node.orientation) ?? 'upper_left';
  const origo = normaliseAnchor(node.origo) ?? 'upper_left';

  const anchor = anchorPoint(parentRect, orientation);
  // THE PIVOT. Canonical `position` is the offset of the pivot from the parent's `orientation`
  // anchor, and the engine adds it to the anchor's point for EVERY orientation: `lower_left` means
  // "measured down from the parent's bottom edge", not "measured up from it". `src/lib/coords.mjs`
  // states the vanilla evidence for that; the practical consequence here is that there is no sign
  // to apply, and a version of this line that applied one would move every bottom-anchored element
  // by twice its own offset.
  //
  // `options.flipLowerAnchors` exists ONLY so `scripts/calibrate-coords.mjs` can measure that
  // alternative on the real corpus instead of arguing about it. It is off everywhere else, and the
  // calibration shows it makes the corpus substantially worse (see docs/sources.md, section 3).
  const dirY = options.flipLowerAnchors ? (anchorFractions(orientation).y === 1 ? -1 : 1) : 1;
  const pivotX = anchor.x + position.x;
  const pivotY = anchor.y + dirY * position.y;

  // The size source is per-kind. A text element has no `size` at all: the engine parses
  // `instantTextBoxType` with a dedicated text parser that rejects `size` outright
  // ("Unexpected token: size" / "Not used, use maxWidth and maxHeight") and takes its box from
  // `maxWidth`/`maxHeight`, which 3138 / 2890 of the 3212 vanilla text blocks declare. So for a
  // text element whose node carries no `size`, the max pair IS the geometry. `node.size` still
  // wins when present: a caller may have set it (the web UI and an older layout file both do),
  // and the validator reports that case as `size-not-accepted` rather than silently reinterpreting
  // it. `sizeFormFor` carries the measured form for every kind.
  const spec = kindSpec(node.kind ?? node.type);
  const sizeForm = sizeFormFor(spec, spec?.keywords?.[0]).form;
  let sizeSpec = node.size ?? {};
  if (node.size === undefined || node.size === null) {
    sizeSpec = sizeForm === SIZE_FORMS.maxWidthHeight ? { width: node.maxWidth, height: node.maxHeight } : {};
    // A size declared only inside `if_scaled_resolution` / `if_resolution` is still a size; used
    // only when the element declares none of its own. See `conditionalsToSize`.
    if (node.resolutionSize && sizeSpec.width === undefined && sizeSpec.height === undefined) {
      sizeSpec = node.resolutionSize;
    }
  }
  const rawWidth = declaredOrNull(sizeSpec.width, sizeSpec.x, options.defaultWidth);
  const rawHeight = declaredOrNull(sizeSpec.height, sizeSpec.y, options.defaultHeight);
  const widthResult = resolveComponent(rawWidth, parentRect.width, {
    variables,
    position: position.x,
    field: 'width',
  });
  const heightResult = resolveComponent(rawHeight, parentRect.height, {
    variables,
    position: position.y,
    field: 'height',
  });

  // Fall back to the sprite's natural size when no size is declared: a fixed-size
  // `spriteType` icon draws at its texture size, which is how most vanilla icons work.
  let width = widthResult.value;
  let height = heightResult.value;
  let sizeSource = 'declared';
  let spriteNatural = null;
  const sizeWasDeclared = width !== null || height !== null;
  if ((width === null || height === null) && options.spriteLookup) {
    const spriteName = node.quadTextureSprite ?? node.spriteType;
    const natural = spriteName ? options.spriteLookup(spriteName) : null;
    if (natural?.width && natural?.height) {
      spriteNatural = natural;
      if (width === null) width = natural.width;
      if (height === null) height = natural.height;
      sizeSource = 'sprite-natural';
    }
  }
  // Neither a usable declared size nor a known sprite size. Distinguishing this from a
  // declared `size = { width = 0 height = 0 }` matters because the two mean different things:
  // a declared zero is the documented way to hide an element, while an indeterminate size is
  // a hole in the model (usually a sprite whose texture is missing) and must be flagged so the
  // geometry report is not silently wrong.
  let sizeIndeterminate = false;
  if (!sizeWasDeclared && sizeSource !== 'sprite-natural') {
    sizeIndeterminate = true;
    width = 0;
    height = 0;
  }

  const origoEntry = Object.values(ANCHORS_LOOKUP).find((candidate) => candidate.label === origo) ?? { x: 0, y: 0 };
  const x = pivotX - (width ?? 0) * origoEntry.x;
  const y = pivotY - (height ?? 0) * origoEntry.y;

  return {
    rect: rect(x, y, width ?? 0, height ?? 0),
    trace: {
      parentRect: { x: parentRect.x, y: parentRect.y, width: parentRect.width, height: parentRect.height },
      orientation,
      origo,
      anchor: { x: anchor.x, y: anchor.y },
      // `position` is the CANONICAL offset; `enginePosition` is the value a `.gui` file carries
      // for this element, which differs in the sign of y for a `lower_*` anchor. Reporting both is
      // deliberate: a caller debugging an engine mismatch can see the conversion, not guess it.
      position: { x: position.x, y: position.y },
      enginePosition: {
        x: Number(position.engineX ?? node.enginePosition?.x ?? node.position?.x ?? 0),
        y: Number(position.engineY ?? node.enginePosition?.y ?? node.position?.y ?? 0),
      },
      yDirection: dirY,
      ySignFlipped: dirY < 0,
      pivot: { x: pivotX, y: pivotY },
      sizeFormula: { width: widthResult.formula, height: heightResult.formula },
      sizeKind: { width: widthResult.kind ?? null, height: heightResult.kind ?? null },
      sizeRaw: { width: String(rawWidth), height: String(rawHeight) },
      sizeSource,
      sizeIndeterminate,
      spriteNatural,
      unresolved: [widthResult, heightResult]
        // An absent component is not a failure: the sprite-natural-size fallback handles it, and
        // when that fails too the validator reports `size-indeterminate` once, which is more
        // useful than one message per axis.
        .filter((result) => result.value === null && result.kind !== 'absent')
        .map((result) => ({ literal: result.literal, formula: result.formula })),
      centerPosition: Boolean(node.centerPosition),
    },
  };
}

/**
 * Lay out a whole tree.
 *
 * `centerPosition = yes` behaves like `origo = center` on an icon (285 uses in vanilla), so it
 * is folded into the origo before the rect is computed.
 *
 * @returns {{boxes: object[], issues: object[], baseResolution: object}}
 */
export function computeLayout(layout, options = {}) {
  const variables = collectVariables(layout);
  const rootParent = {
    x: 0,
    y: 0,
    width: options.baseWidth ?? layout.baseResolution?.width ?? BASE_RESOLUTION.width,
    height: options.baseHeight ?? layout.baseResolution?.height ?? BASE_RESOLUTION.height,
  };
  const boxes = [];
  const issues = [];
  // THE COMPONENT EXPANSION, once, before anything is measured. A `kind: 'bar'` node is a
  // COMPONENT, not a kind the engine knows: there is no bar window keyword in the install (see
  // components.mjs for the full list of the 41 block keywords vanilla's `.gui` files use). It is
  // expanded into the containers and text the engine reads, in place, preserving node identity so
  // a reference the emitter took before this pass still points at the same object. The pass is
  // idempotent: an expanded bar carries `component: 'bar'` and is skipped on a second layout.
  issues.push(...expandBarsInTree(layout?.root, { resolvedRectsByPath: options.resolvedRectsByPath ?? null }));
  // THE SECOND COMPONENT PASS, and the order is load-bearing: a matrix cell may hold a bar, and the
  // bar pass above has already expanded every bar it can see. The matrix pass then moves the bar's
  // five pieces into a cell container, so the bar's own geometry is measured in the cell's frame.
  // Matrices expand into plain `containerWindowType` cells - never into a `gridBoxType`, because the
  // engine-populated kinds take no children (measured: 0 of 261 `gridBoxType` blocks in the install
  // contain a nested element). Like the bar pass, this one is idempotent: an expanded matrix carries
  // `component: 'matrix'` and is skipped on a second layout.
  issues.push(...expandMatricesInTree(layout?.root));
  // Box ids must be unique: the preview writes them into `<g id="...">`, and two boxes sharing
  // an id used to put two unrelated subtrees into one sibling group. A caller-supplied id is
  // kept as-is when it is unique; a duplicate gets a `#n` suffix. Scoped to this call, so two
  // computeLayout calls cannot leak ids into each other.
  const usedIds = new Set();
  const uniqueBoxId = (node, depth, path) => {
    const base = node.id ?? path ?? `${node.kind ?? 'node'}:${node.name ?? depth}`;
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    let suffix = 2;
    while (usedIds.has(`${base}#${suffix}`)) suffix += 1;
    usedIds.add(`${base}#${suffix}`);
    return `${base}#${suffix}`;
  };

  const visit = (node, parentRect, parent, depth, path, parentIndex) => {
    const kind = kindSpec(node.kind ?? node.type) ?? null;
    // `centerPosition = yes` behaves like `origo = center` on an icon (285 vanilla uses), so it is
    // folded into the origo for the rect maths. The flag says the `origo` on this COPY was derived,
    // not written: without it the validator reported the synthetic field as `field-not-accepted`,
    // because the engine does not accept `origo` on an iconType either.
    const effective = node.centerPosition && !node.origo ? { ...node, origo: 'center', centerPositionDerived: true } : node;
    const { rect: absolute, trace } = computeRect(effective, parentRect, variables, options);    const id = uniqueBoxId(node, depth, path);
    const box = {
      id,
      boxIndex: boxes.length,
      // Siblings are grouped by PARENT IDENTITY (`parentIndex`), never by name or id: an earlier
      // revision keyed the sibling groups on `parent.id`, and a parsed node has no id at all, so
      // every element at depth >= 2 landed in one group with the synthetic root. That made the
      // validator compare elements in different windows - 20 false `sibling-overlap` warnings on
      // a legal merged file - and pool every window's children together for `duplicate-name`.
      parentIndex,
      name: node.name ?? null,
      kind: kind?.kind ?? String(node.kind ?? 'unknown'),
      keyword: kind?.keywords?.[0] ?? null,
      depth,
      path,
      parentId: parent?.id ?? null,
      parentName: parent?.name ?? null,
      syntheticRoot: Boolean(node.syntheticRoot),
      declaredRect: { x: absolute.x, y: absolute.y, width: absolute.width, height: absolute.height },
      rect: { ...absolute },
      parentRect: { x: parentRect.x, y: parentRect.y, width: parentRect.width, height: parentRect.height },
      trace,
      node: effective,
    };
    boxes.push(box);

    // `unresolved-size` is reserved for a size that was actually written but could not be
    // evaluated (an unknown `@variable`, a non-numeric string). A missing size is normal - most
    // containers derive their size from a sprite or from their parent - so it is recorded per
    // node as `sizeIndeterminate` and the validator decides whether it is worth reporting. The
    // earlier revision emitted one `unresolved-size` per axis for every unsized node, which
    // produced 17352 findings across the vanilla corpus instead of a usable number.
    for (const unresolved of trace.unresolved) {
      issues.push({
        rule: 'unresolved-size',
        severity: 'error',
        path,
        message: `size component does not resolve: ${unresolved.literal} (${unresolved.formula})`,
      });
    }
    if (absolute.width < 0 || absolute.height < 0) {
      issues.push({
        rule: 'negative-resolved-size',
        severity: 'warning',
        path,
        message:
          `resolved size is negative (${absolute.width} x ${absolute.height}). A negative resolved size ` +
          `usually means a negative or %%-relative size whose position already exceeds the parent.`,
        rect: { x: absolute.x, y: absolute.y, width: absolute.width, height: absolute.height },
      });
    }

    for (const child of node.children ?? []) {
      visit(child, absolute, node, depth + 1, `${path}/${child.name ?? child.id ?? '?'}`, box.boxIndex);
    }
  };

  if (layout.root) {
    const rootNode = layout.root;
    // The root container is positioned in the base resolution rectangle itself.
    visit(rootNode, rootParent, null, 0, rootNode.name ?? 'root', null);
  }

  return { boxes, issues, baseResolution: { ...rootParent }, variables };
}

/** Find a node by id or by name. */
export function findNode(layout, idOrName) {
  let found = null;
  walkLayout(layout.root, (node) => {
    if (found) return;
    if (node.id === idOrName || node.name === idOrName) found = node;
  });
  return found;
}

/** Find a node's parent. */
export function findParent(layout, idOrName) {
  let found = null;
  walkLayout(layout.root, (node, parent) => {
    if (found) return;
    if (parent && (node.id === idOrName || node.name === idOrName)) found = parent;
  });
  return found;
}

/**
 * Apply a list of edits to a layout, returning a new layout.
 *
 * Edits are the agent/web-UI vocabulary:
 *   {op:'add', parent, node, index?}         insert a node (id assigned if absent)
 *   {op:'remove', target}                    delete a node and its subtree
 *   {op:'move', target, parent, index?}      reparent / reorder
 *   {op:'set', target, path:'size.width', value}
 *   {op:'unset', target, path}
 *   {op:'rename', target, name}
 *   {op:'set_variable', name:'@w', value:'600'}
 *   {op:'set_root', node}
 */
export function applyEdits(layout, edits) {
  const next = JSON.parse(JSON.stringify(layout));
  const applied = [];
  const failed = [];

  const assignIds = (node) => {
    if (!node.id) node.id = randomUUID().slice(0, 8);
    for (const child of node.children ?? []) assignIds(child);
    return node;
  };
  assignIds(next.root);

  for (const [index, edit] of (edits ?? []).entries()) {
    try {
      switch (edit.op) {
        case 'add': {
          const parent = edit.parent ? findNode(next, edit.parent) : next.root;
          if (!parent) throw new Error(`parent \`${edit.parent}\` not found`);
          const node = assignIds(JSON.parse(JSON.stringify(edit.node ?? {})));
          parent.children = parent.children ?? [];
          const at = edit.index ?? parent.children.length;
          parent.children.splice(Math.max(0, Math.min(at, parent.children.length)), 0, node);
          applied.push({ index, op: 'add', id: node.id, name: node.name, parent: parent.name ?? parent.id });
          break;
        }
        case 'remove': {
          if (findNode(next, edit.target) === next.root) throw new Error('cannot remove the root');
          const parent = findParent(next, edit.target);
          if (!parent) throw new Error(`\`${edit.target}\` not found`);
          const before = parent.children.length;
          parent.children = parent.children.filter((child) => child.id !== edit.target && child.name !== edit.target);
          if (parent.children.length === before) throw new Error(`\`${edit.target}\` not found among siblings`);
          applied.push({ index, op: 'remove', target: edit.target });
          break;
        }
        case 'move': {
          const node = findNode(next, edit.target);
          if (!node) throw new Error(`\`${edit.target}\` not found`);
          if (node === next.root) throw new Error('cannot move the root');
          const from = findParent(next, edit.target);
          from.children = from.children.filter((child) => child !== node);
          const to = edit.parent ? findNode(next, edit.parent) : next.root;
          if (!to) throw new Error(`parent \`${edit.parent}\` not found`);
          to.children = to.children ?? [];
          const at = edit.index ?? to.children.length;
          to.children.splice(Math.max(0, Math.min(at, to.children.length)), 0, node);
          applied.push({ index, op: 'move', target: edit.target, parent: to.name ?? to.id });
          break;
        }
        case 'set': {
          const node = edit.target ? findNode(next, edit.target) : next.root;
          if (!node) throw new Error(`\`${edit.target}\` not found`);
          setPath(node, edit.path, edit.value);
          applied.push({ index, op: 'set', target: edit.target ?? 'root', path: edit.path, value: edit.value });
          break;
        }
        case 'unset': {
          const node = edit.target ? findNode(next, edit.target) : next.root;
          if (!node) throw new Error(`\`${edit.target}\` not found`);
          unsetPath(node, edit.path);
          applied.push({ index, op: 'unset', target: edit.target ?? 'root', path: edit.path });
          break;
        }
        case 'rename': {
          const node = edit.target ? findNode(next, edit.target) : next.root;
          if (!node) throw new Error(`\`${edit.target}\` not found`);
          node.name = edit.name;
          applied.push({ index, op: 'rename', target: edit.target, name: edit.name });
          break;
        }
        case 'set_variable': {
          next.variables = next.variables ?? {};
          if (edit.value === null || edit.value === undefined) delete next.variables[edit.name];
          else next.variables[edit.name] = String(edit.value);
          applied.push({ index, op: 'set_variable', name: edit.name, value: edit.value });
          break;
        }
        case 'set_root': {
          next.root = assignIds(JSON.parse(JSON.stringify(edit.node)));
          applied.push({ index, op: 'set_root' });
          break;
        }
        case 'set_meta': {
          for (const [key, value] of Object.entries(edit.values ?? {})) next[key] = value;
          applied.push({ index, op: 'set_meta', keys: Object.keys(edit.values ?? {}) });
          break;
        }
        default:
          throw new Error(`unknown op \`${edit.op}\``);
      }
    } catch (thrown) {
      failed.push({ index, op: edit.op, error: thrown instanceof Error ? thrown.message : String(thrown) });
    }
  }

  return { layout: next, applied, failed };
}

function setPath(target, path, value) {
  if (!path) throw new Error('`path` is required for op set');
  // A text element's box is `maxWidth`/`maxHeight` - the engine rejects `size` on
  // instantTextBoxType - so the web UI and the tool surface set the pair by this name.
  if (path === 'maxWidth/maxHeight') {
    if (value === null || value === undefined) {
      delete target.maxWidth;
      delete target.maxHeight;
      return;
    }
    const width = value.width ?? value.maxWidth;
    const height = value.height ?? value.maxHeight;
    if (width === undefined || width === '' || width === null) delete target.maxWidth;
    else target.maxWidth = width;
    if (height === undefined || height === '' || height === null) delete target.maxHeight;
    else target.maxHeight = height;
    return;
  }
  const parts = String(path).split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (cursor[part] === undefined || cursor[part] === null) cursor[part] = {};
    cursor = cursor[part];
  }
  const last = parts[parts.length - 1];
  if (value === '' || value === null) delete cursor[last];
  else cursor[last] = value;
}

function unsetPath(target, path) {
  if (!path) throw new Error('`path` is required for op unset');
  const parts = String(path).split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor || typeof cursor !== 'object') return;
    cursor = cursor[part];
  }
  if (cursor && typeof cursor === 'object') delete cursor[parts[parts.length - 1]];
}

/** Rebuild positional/origo default strings for a tree (used by the web UI form). */
export function normaliseLayout(layout) {
  const next = JSON.parse(JSON.stringify(layout));
  walkLayout(next.root, (node) => {
    if (node.orientation) node.orientation = normaliseAnchor(node.orientation) ?? node.orientation;
    if (node.origo) node.origo = normaliseAnchor(node.origo) ?? node.origo;
  });
  return next;
}

/** Validate that a string is one of the canonical orientation/origo anchors. */
export function isCanonicalAnchor(value) {
  return ORIENTATION_VALUES.includes(value);
}

export { ANCHOR_TABLE, kindSpec };

// ---------------------------------------------------------------------------------------
// `.gui` -> layout tree
// ---------------------------------------------------------------------------------------

/** Scalar field names lifted verbatim off a `.gui` element onto a layout node. */
const SCALAR_COPY_FIELDS = [
  'name',
  'orientation',
  'origo',
  'moveable',
  'clipping',
  'format',
  'scale',
  'alwaysTransparent',
  'fixedSize',
  'maxWidth',
  'maxHeight',
  'font',
  'buttonFont',
  'text',
  'buttonText',
  'appendText',
  'spriteType',
  'quadTextureSprite',
  'pdx_tooltip',
  'pdx_tooltip_delayed',
  'clicksound',
  'oversound',
  'show_sound',
  'shortcut',
  'actionShortcut',
  'effect',
  'tooltipText',
  'frame',
  'rotation',
  'centerPosition',
  'multiline',
  'text_color_code',
  'vertical_alignment',
  'dynamic_extra_height',
  'scrollbartype',
  'borderSize',
  'spacing',
  'slotSize',
  'slotsize',
  'priority',
  // The scrollbar/slider family: vanilla spells these in camel case (`maxValue`, `stepSize`,
  // `startValue` - 58 / 19 / 63 uses). The comparison is case-insensitive and the canonical
  // spelling is what gets stored, so a file written either way round-trips to the vanilla form.
  'maxValue',
  'minValue',
  'stepSize',
  'startValue',
  'maxvalue',
  'minvalue',
  'stepsize',
  'startvalue',
  'snappoint',
  'snappoint_center',
  'defaultSelection',
  'defaultselection',
  'first_on_top',
  'horizontal',
  'autohide_scrollbar',
  'resizeparent',
  'is_dynamic',
  'padding',
  'max_slots_horizontal',
  'max_slots_vertical',
  'add_horizontal',
  'truncate',
  'tooltipText',
  'delayedTooltipText',
  'tooltip',
  // Script-only fields, carried on the model so the validator can REJECT them on an element and
  // the emitter can translate them into the kind's own tooltip field instead of writing them
  // verbatim (`custom_tooltip` is a script field: 0 uses on any .gui element, 3777 in events).
  'custom_tooltip',
  'fail_text',
  'tooltip_mode_enabled',
  'parent',
  'id',
  'texturefile',
  'no_clicksound',
  'direction',
  'fade_type',
  'fade_time',
  'animation_type',
  'animation_time',
  'show_animation_type',
  'hide_animation_type',
  'show_sound',
  'wraparound',
];

/** Coerce a Paradox scalar to a JS value: `yes`/`no` to boolean, numerics to numbers. */
export function coerceScalar(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === 'yes') return true;
  if (trimmed === 'no') return false;
  if (/^-?[0-9]+$/.test(trimmed)) return Number(trimmed);
  if (/^-?[0-9]*\.[0-9]+$/.test(trimmed)) return Number(trimmed);
  return value;
}

/**
 * Recognise a plain axis block (`{ x = .. y = .. }`, or the `{ width = .. height = .. }` form
 * used by `borderSize`/`slotSize`) and return it as `{ position: { x, y } }` or
 * `{ size: { width, height } }`. Returns null for a block holding anything else, so the caller
 * falls back to modelling it as a normal nested node.
 */
function axisBlockToPosition(block) {
  const fields = {};
  for (const child of block.children ?? []) {
    if (!child.key || child.children) return null;
    fields[child.key.toLowerCase()] = coerceScalar(child.value);
  }
  const keys = Object.keys(fields);
  if (keys.length === 0 || keys.length > 2) return null;
  const isAxis = keys.every((key) => key === 'x' || key === 'y');
  if (isAxis) {
    const position = {};
    if (fields.x !== undefined) position.x = fields.x;
    if (fields.y !== undefined) position.y = fields.y;
    return { kind: 'position-block', position };
  }
  const isExtent = keys.every((key) => key === 'width' || key === 'height');
  if (isExtent) {
    const size = {};
    if (fields.width !== undefined) size.width = fields.width;
    if (fields.height !== undefined) size.height = fields.height;
    return { kind: 'size-block', size };
  }
  return null;
}

/**
 * The `size = { ... }` a resolution conditional declares, as `{width, height}`, or null.
 *
 * The minimum/maximum resolution bounds are ignored on purpose: this project states one base
 * resolution (1920x1080) and reports geometry against it, so all this needs to answer is "what
 * size does the element have when its conditional applies".
 */
function conditionalsToSize(block) {
  const size = {};
  for (const child of block.children ?? []) {
    if (!child.key || child.key.toLowerCase() !== 'size' || !child.children) continue;
    for (const part of child.children) {
      const key = part.key?.toLowerCase();
      if (key === 'width' || key === 'x') size.width = coerceScalar(part.value);
      if (key === 'height' || key === 'y') size.height = coerceScalar(part.value);
    }
  }
  return Object.keys(size).length > 0 ? size : null;
}

/** Convert one parsed Paradox block into a layout node. */
function blockToNode(block) {
  // AN ELEMENT BLOCK WHOSE KEY IS A FIELD NAME. A `dropDownBoxType` writes its two structural
  // parts as `expandedWindow = { ... }` / `expandButton = { ... }` - the key is the field, and the
  // BODY is a `containerWindowType` / `guiButtonType` body. Resolving the alias here means the rest
  // of this function (fields, children, sub-blocks) treats it as the kind it really is, and the
  // emitter writes `asField` where the keyword would go (see kinds.mjs `AS_FIELD_ELEMENT_KINDS`).
  // Before this, both were filed as opaque `subBlocks` and the emitter wrote `expandedWindow = { }`,
  // so every dropdown's list vanished on a round trip.
  const asField = asFieldElementKind(block.key);
  const spec = kindSpecByKeyword(block.key) ?? (asField ? kindSpec(asField.kind) : null);
  const node = { kind: spec?.kind ?? String(block.key), children: [] };
  if (asField) node.asField = asField.canonical;
  // Keep the keyword the file actually used (`listboxType` vs `listBoxType`,
  // `extendedScrollbarType` vs `scrollbarType`): the emitter prefers it when it is one of the
  // kind's own keywords, so a round trip of a vanilla file does not silently re-spell it.
  if (spec && !asField) node.keyword = block.key;
  const variables = {};

  for (const child of block.children ?? []) {
    if (!child.key) continue;
    if (child.key.startsWith('@')) {
      variables[child.key] = child.value;
      continue;
    }
    const loweredKey = child.key.toLowerCase();
    if (loweredKey === 'position' && child.children) {
      node.position = {};
      for (const part of child.children) {
        if (!part.key) continue;
        if (part.key.toLowerCase() === 'x') node.position.x = coerceScalar(part.value);
        if (part.key.toLowerCase() === 'y') node.position.y = coerceScalar(part.value);
      }
      continue;
    }
    if (loweredKey === 'size' && child.children) {
      node.size = {};
      for (const part of child.children) {
        if (!part.key) continue;
        const key = part.key.toLowerCase();
        if (key === 'width' || key === 'x') node.size.width = coerceScalar(part.value);
        if (key === 'height' || key === 'y') node.size.height = coerceScalar(part.value);
      }
      continue;
    }
    if (loweredKey === 'background' && child.children) {
      const background = { name: null, sprite: null, spriteField: null, alwaysTransparent: null };
      // EVERY OTHER FIELD IN THE BLOCK IS KEPT. The first revision read name/sprite/alwaysTransparent
      // and dropped the rest without a word, so `pdx_tooltip`, `no_clicksound`, `size`, `alpha` and
      // `frame` never came back from a round trip. `kinds.mjs`'s `BACKGROUND_FIELDS` is the measured
      // list of what can appear here (1696 `name`, 1210 `spriteType`, 412 `alwaysTransparent`, ...).
      for (const part of child.children) {
        if (!part.key) continue;
        const key = part.key.toLowerCase();
        if (key === 'name') background.name = part.value;
        else if (key === 'spritetype' || key === 'quadtexturesprite') {
          background.sprite = part.value;
          // WHICH spelling, so a fixed `spriteType` is not re-emitted as a 9-slice
          // `quadTextureSprite` (they are not interchangeable - see emit.mjs `renderBackground`).
          background.spriteField = key === 'spritetype' ? 'spriteType' : 'quadTextureSprite';
        } else if (key === 'alwaystransparent') background.alwaysTransparent = coerceScalar(part.value);
        else if (key === 'position' && part.children) {
          background.position = {};
          for (const axis of part.children) {
            if (axis.key?.toLowerCase() === 'x') background.position.x = coerceScalar(axis.value);
            if (axis.key?.toLowerCase() === 'y') background.position.y = coerceScalar(axis.value);
          }
        } else if (key === 'size' && part.children) {
          background.size = {};
          for (const axis of part.children) {
            const axisKey = axis.key?.toLowerCase();
            if (axisKey === 'width' || axisKey === 'x') background.size.width = coerceScalar(axis.value);
            if (axisKey === 'height' || axisKey === 'y') background.size.height = coerceScalar(axis.value);
          }
        } else if (part.children) {
          background.extra = background.extra ?? {};
          background.extra[part.key] = axisBlockToPosition(part) ?? null;
          if (background.extra[part.key] === null) delete background.extra[part.key];
        } else {
          background.extra = background.extra ?? {};
          background.extra[part.key] = coerceScalar(part.value);
        }
      }
      node.background = background;
      continue;
    }
    if (child.children) {
      // A nested element block only if its key is a known element kind. Anything else is a
      // non-element sub-block (borderSize, slotSize, margin, padding, show_position,
      // hide_position, offset, overlay, ...) and must NOT become a child node: an earlier
      // revision pushed every block child into `children`, which invented ~1000 phantom
      // elements and made the layout report meaningless.
      if (loweredKey === 'if_resolution' || loweredKey === 'if_scaled_resolution') {
        node.conditionals = node.conditionals ?? [];
        node.conditionals.push({ kind: child.key, children: child.children.map(blockToNode) });
        // The `size` inside a resolution conditional is still this element's size at some
        // resolutions, and it is the ONLY size 20-odd vanilla top-level windows declare (see
        // `interface/starbase_view.gui:17-25`). Ignoring it left those windows 0x0, which made
        // every child's canonical position wrong - a lower_* child needs the parent's HEIGHT to
        // be converted at all. The first declared pair is recorded as a fallback; it is used only
        // when the element declares no size of its own, so it can never override a real one.
        const conditional = conditionalsToSize(child);
        if (conditional && !node.resolutionSize) node.resolutionSize = conditional;
        continue;
      }
      if (kindSpecByKeyword(child.key) || asFieldElementKind(child.key)) {
        node.children.push(blockToNode(child));
        continue;
      }
      // A non-element sub-block. Two shapes exist in vanilla and they must not be confused,
      // because an earlier revision parsed every one of them as a list of child nodes and so
      // turned `show_position = { x = -370 y = 145 }` into two phantom elements named `x`
      // and `y` - which also broke the slide-in detection the validator relies on.
      node.subBlocks = node.subBlocks ?? {};
      if (!(child.key in node.subBlocks)) {
        node.subBlocks[child.key] = [axisBlockToPosition(child) ?? blockToNode(child)];
      }
      continue;
    }
    if (SCALAR_COPY_FIELDS.some((field) => field.toLowerCase() === loweredKey)) {
      const canonical = SCALAR_COPY_FIELDS.find((field) => field.toLowerCase() === loweredKey);
      node[canonical] = coerceScalar(child.value);
      // THE ENGINE'S `id`, WHICH IS NOT THE MODEL'S. Several kinds carry a real engine field
      // `id = "spinner"` (measured: spinner 37 of 40, button 25, scrollbar 12, smoothListBox 10,
      // icon 7, container 1), and `node.id` is ALSO this model's node identity - `applyEdits`
      // invents a random hex one whenever it is missing. Writing `node.id` therefore wrote random
      // hex strings into files; not writing it lost the engine field. A parsed `id` is recorded
      // under BOTH: `node.id` keeps model identity stable across a round trip, and `engineId` is
      // what the emitter writes (see emit.mjs `EMIT_FIELD_ALIAS`).
      if (loweredKey === 'id') node.engineId = coerceScalar(child.value);
    } else {
      node.extra = node.extra ?? {};
      node.extra[child.key] = coerceScalar(child.value);
    }
  }

  if (Object.keys(variables).length > 0) node.variables = variables;
  if (node.children.length === 0) delete node.children;
  return node;
}

/**
 * Parse a `.gui` file into a layout tree.
 *
 * The root rule: a `.gui` file's root MUST be `guiTypes = { ... }`, compared
 * case-insensitively (vanilla 4.4.6 has 176 `guiTypes` and one `guitypes`, in traits.gui), and
 * 30 of the 177 files put `@variable = value` lines BEFORE it. So comments and `@` lines are
 * skipped when locating the root, and a file whose first construct is anything else is
 * reported rather than silently accepted.
 *
 * The tree that comes back is CANONICAL: every `position` is the pivot offset in the canonical
 * frame, `enginePosition` holds the literal the file carried, and `computeLayout` reproduces the
 * engine's own rects. Pass `{ canonicalise: false }` to keep the raw engine fields instead - only
 * `scripts/calibrate-coords.mjs` does, to reconstruct the pre-fix model for a before/after
 * comparison.
 *
 * @returns {{ok: boolean, reason?: string, layout: object|null, rootKeyword: string|null,
 *            containers: object[], variables: object, files: string[]}}
 */
export function parseGuiText(text, fileKey = '(inline)', options = {}) {
  const { roots, variables } = parseParadoxFile(text);
  const rootKeyword = firstConstruct(text);
  // FILE-LEVEL `@variable` declarations. The Paradox parser collects declarations found INSIDE a
  // construct, and 30 of the 177 vanilla files put theirs at the top of the file instead
  // (`interface/discoveries_view.gui` declares `@view_w`/`@view_h`/`@view_pos_x` before `guiTypes`
  // and uses them for the window's own size). Without this the layout resolved `@view_w` to null and
  // the emitter wrote `x = @view_pos_x` with no declaration anywhere in the file - a file the engine
  // cannot read. The scan is deliberately narrow: `@name = value` at the start of a line, outside
  // any construct, with the value a single token.
  for (const match of text.matchAll(/^[ \t]*(@[A-Za-z0-9_]+)[ \t]*=[ \t]*([^\s#{}]+)/gm)) {
    if (!(match[1] in variables)) variables[match[1]] = match[2];
  }

  const containerRoots = roots.filter(
    (entry) => entry.key && (entry.key.toLowerCase() === 'guitypes' || entry.key.toLowerCase() === 'guitypes'),
  );

  const containers = [];
  for (const entry of roots) {
    if (!entry.children) continue;
    for (const child of entry.children) {
      if (!child.key || !child.children) continue;
      const spec = kindSpecByKeyword(child.key);
      if (!spec) continue;
      const node = blockToNode(child);
      node.sourceFile = fileKey;
      node.sourceLine = child.line;
      containers.push(node);
    }
  }

  if (containerRoots.length === 0) {
    return {
      ok: false,
      reason:
        `root construct is \`${rootKeyword}\`, not \`guiTypes\`. A .gui file's root must be ` +
        `'guiTypes = { ... }' (compared case-insensitively); a bare element at the top level is a parse error.`,
      layout: null,
      rootKeyword,
      containers,
      variables,
      files: [fileKey],
    };
  }

  const layout = {
    schema: 'rstellarisgui/layout@1',
    name: containers[0]?.name ?? fileKey.replace(/[\\/]/g, '_').replace(/\.gui$/i, ''),
    baseResolution: { ...BASE_RESOLUTION },
    variables,
    // The SYNTHETIC ROOT. A `.gui` file's `guiTypes` block holds sibling
    // `containerWindowType`s, not children of a window - vanilla
    // galactic_community_view.gui declares 16 of them, and interface/core.gui declares a dozen
    // more. The layout schema needs one root, so the file gets this stand-in, flagged so that
    // nothing downstream treats it as a real window: the emitter writes its children as
    // top-level containers, and the validator skips comparisons that cross between windows,
    // because only one custom_gui window is on screen at a time.
    root: {
      id: 'root',
      kind: 'container',
      syntheticRoot: true,
      name: `(${fileKey})`,
      size: { width: BASE_RESOLUTION.width, height: BASE_RESOLUTION.height },
      children: containers,
    },
    localisation: [],
    effects: {},
    event: null,
  };

  return {
    ok: true,
    layout: options.canonicalise === false ? layout : canonicaliseLayoutPositions(layout, { spriteLookup: options.spriteLookup, fileKey }),
    rootKeyword,
    containers,
    variables,
    files: [fileKey],
  };
}

/**
 * Rewrite a freshly parsed tree's `position` fields from the ENGINE's reading to the CANONICAL
 * one, and return it.
 *
 * Why this is a whole extra layout pass: the engine reading of a `lower_*` element's `position`
 * cannot be converted without the parent's HEIGHT, and the parent's height is only known once the
 * parent's own size and position have been resolved - which is what `computeLayout` does. So:
 *
 *   1. lay the raw tree out once, with each node's `position` still in engine space, to learn every
 *      parent's canonical rect (the parent rects are correct either way, because a parent's rect
 *      does not depend on its children);
 *   2. convert every child's `position` with `enginePositionToCanonical` against that parent rect;
 *   3. keep the raw value on `node.enginePosition`, so the emitter can reproduce a vanilla file
 *      byte for byte.
 *
 * A malformed tree that cannot be laid out is returned unchanged: the import must never fail here.
 *
 * @param {object} layout
 * @param {{spriteLookup?: Function|null, baseWidth?: number, baseHeight?: number, fileKey?: string}} options
 */
export function canonicaliseLayoutPositions(layout, options = {}) {
  if (!layout?.root) return layout;
  const base = layout.baseResolution ?? BASE_RESOLUTION;
  let boxes;
  try {
    ({ boxes } = computeLayout(layout, {
      baseWidth: options.baseWidth ?? base.width,
      baseHeight: options.baseHeight ?? base.height,
      spriteLookup: options.spriteLookup ?? null,
      // The FIRST pass reads `position` the way the engine does, because that is the state the tree
      // is in before this function has run.
      enginePosition: true,
    }));
  } catch {
    return layout;
  }
  // `walkLayout` and `computeLayout` visit in the same document order, so the index lines up, and
  // `box.parentRect` IS the parent's rect as the first pass computed it. That is exactly what the
  // conversion needs: the engine pivot is `anchorPoint(parentRect, orientation) + offset`, and the
  // anchor point of a `lower_*` anchor depends on the parent's bottom edge, so the parent's own
  // rectangle (not merely its size) has to be the one the layout pass produced.
  let index = 0;
  const canonicalise = (node) => {
    const box = boxes[index];
    index += 1;
    if (!box) return;
    const orientation = normaliseAnchor(node.orientation) ?? 'upper_left';
    const enginePosition = {
      x: Number(node.position?.x ?? 0) || 0,
      y: Number(node.position?.y ?? 0) || 0,
    };
    const canonical = enginePositionToCanonical(enginePosition, orientation, box.parentRect);
    // A position component that is not a number - `@var`, `@[ var ]`, `50%` - cannot be converted,
    // and converting it to `0` or `NaN` would DESTROY the declaration (the emitter would then write
    // a literal the caller never asked for). Such a node is left exactly as the file wrote it, with
    // no `enginePosition` recorded, so the emitter writes the declaration back verbatim.
    const rawX = node.position?.x;
    const rawY = node.position?.y;
    const resolvable = (value) => value === undefined || value === null || value === '' || (Number.isFinite(Number(value)) && String(value).trim() !== '');
    if (node.position && (!resolvable(rawX) || !resolvable(rawY))) {
      for (const child of node.children ?? []) canonicalise(child);
      return;
    }
    // `positionDeclared` records whether the FILE wrote a `position` block at all. An element that
    // did not is at the engine default `{0, 0}`, whose canonical reading is NOT `{0, 0}` for a
    // `lower_*` anchor, and the emitter must not invent a `position` line for an element whose file
    // had none beyond what the conversion requires.
    if (node.position || canonical.x !== 0 || canonical.y !== 0) {
      node.positionDeclared = Boolean(node.position);
      node.enginePosition = enginePosition;
      // The canonical value as PARSED. The emitter compares against it to tell "still where the
      // file put it" from "an edit moved it", which is how a stale engine literal is detected.
      node.parsedCanonicalPosition = { x: canonical.x, y: canonical.y };
      node.position = { x: canonical.x, y: canonical.y };
    }
    for (const child of node.children ?? []) canonicalise(child);
  };
  if (layout.root) canonicalise(layout.root);
  if (options.fileKey) layout.canonicalisedFrom = options.fileKey;
  return layout;
}

/**
 * Merge several layouts into one multi-window layout.
 *
 * A `.gui` file may hold as many top-level `containerWindowType`s as you like - that is how
 * vanilla's biggest views are built - and a real mod window set is several windows in one file.
 * The emitter used to write `interface/<stem>.gui` per layout, so a multi-window mod had to
 * concatenate bodies and de-duplicate `@variable` declarations by hand. This is that merge,
 * expressed once, with the windows as siblings under one synthetic root.
 *
 * @param {object[]} layouts
 * @param {{name?: string, baseResolution?: object}} options
 */
export function mergeLayouts(layouts, options = {}) {
  const list = (layouts ?? []).filter(Boolean);
  if (list.length === 0) throw new Error('mergeLayouts needs at least one layout');
  const windows = list.flatMap((layout) => {
    if (!layout.root) return [];
    if (layout.root.syntheticRoot) return layout.root.children ?? [];
    return [{ ...layout.root, kind: layout.root.kind ?? 'container' }];
  });
  const variables = {};
  for (const layout of list) for (const [key, value] of Object.entries(layout.variables ?? {})) variables[key] = value;
  const effects = {};
  for (const layout of list) for (const [key, value] of Object.entries(layout.effects ?? {})) effects[key] = value;
  const base = options.baseResolution ?? list[0].baseResolution ?? { ...BASE_RESOLUTION };
  return {
    schema: 'rstellarisgui/layout@1',
    name: options.name ?? list.map((layout) => layout.name).filter(Boolean).join('_') ?? 'merged',
    baseResolution: { ...base },
    variables,
    root: {
      id: 'root',
      kind: 'container',
      syntheticRoot: true,
      name: `(merged:${list.length})`,
      size: { width: base.width, height: base.height },
      children: windows,
    },
    localisation: [],
    effects,
    event: null,
    mergedFrom: list.map((layout) => layout.name ?? null),
  };
}

/** The `containerWindowType` names a layout defines (its windows). */
export function layoutWindowNames(layout) {
  if (!layout?.root) return [];
  const nodes = layout.root.syntheticRoot ? layout.root.children ?? [] : [layout.root];
  return nodes.map((node) => node.name).filter(Boolean);
}

/**
 * Rewrite a tree into the form each kind's engine parser accepts, and say what changed.
 *
 * Two classes of fix, both of them engine errors that a real run produced:
 *
 *  * SIZE. `size` on an `instantTextBoxType` or an `iconType` is "Unexpected token: size"; text
 *    wants `maxWidth`/`maxHeight` (percent/`%%`/negative declarations are resolved to pixels
 *    through the layout engine) and an icon wants no size at all.
 *  * FIELDS. `custom_tooltip` is a script field, `alwaysTransparent` is not a container field,
 *    and `origo` belongs to containerWindowType - each becomes the kind's own equivalent
 *    (`pdx_tooltip`/`tooltipText`, `alwaysTransparent` inside the background block,
 *    `centerPosition = yes`). See kinds.mjs `translateFieldForKind`.
 *
 * The input tree is not mutated; the caller gets a new one plus a change list.
 *
 * @param {object} layout
 * @param {{spriteLookup?: object, resolveSizes?: boolean}} options
 * @returns {{layout: object, changes: object[]}}
 */
export function normaliseLayoutForKinds(layout, options = {}) {
  const next = JSON.parse(JSON.stringify(layout));
  const changes = [];
  const rectByPath = new Map();
  if (options.resolveSizes !== false) {
    try {
      const base = next.baseResolution ?? BASE_RESOLUTION;
      const { boxes } = computeLayout(next, { baseWidth: base.width, baseHeight: base.height, spriteLookup: options.spriteLookup ?? null });
      for (const box of boxes) rectByPath.set(box.path, box.rect);
    } catch {
      /* a tree that cannot be laid out simply yields no resolved sizes */
    }
  }

  walkLayout(next.root, (node, _parent, _depth, path) => {
    const spec = kindSpec(node.kind ?? node.type);
    if (!spec) return;
    const keyword = spec.keywords.includes(node.keyword) ? node.keyword : spec.keywords[0];
    const { form } = sizeFormFor(spec, keyword);

    // ---------------------------------------------------------------- size
    if (node.size) {
      if (form === SIZE_FORMS.maxWidthHeight) {
        const rect = rectByPath.get(path);
        const literal = (value) =>
          typeof value === 'number' ? String(value) : /^-?[0-9]+$/.test(String(value ?? '').trim()) ? String(value).trim() : null;
        const width = literal(node.size.width);
        const height = literal(node.size.height);
        if (node.maxWidth === undefined) {
          if (width !== null) node.maxWidth = Number(width);
          else if (rect) node.maxWidth = Math.round(rect.width);
        }
        if (node.maxHeight === undefined) {
          if (height !== null) node.maxHeight = Number(height);
          else if (rect) node.maxHeight = Math.round(rect.height);
        }
        changes.push({ path, kind: spec.kind, change: 'size-to-maxWidth/maxHeight', from: node.size, to: { maxWidth: node.maxWidth, maxHeight: node.maxHeight } });
        delete node.size;
      } else if (form === SIZE_FORMS.none) {
        const spriteName = node.quadTextureSprite ?? node.spriteType;
        const record = options.assets?.sprites?.[spriteName];
        const texture = record?.textureFile ? options.assets?.textures?.[record.textureFile] : null;
        const natural = texture?.ok ? { width: texture.width, height: texture.height } : null;
        const declared = { width: node.size.width ?? node.size.x, height: node.size.height ?? node.size.y };
        const isTile = /^corneredtilespritetype$/i.test(String(record?.kind ?? ''));
        if (isTile && spriteName) {
          // A cornered tile IS resizable - through a container's `background`, which is where
          // vanilla puts one (interface/planet_view.gui:252-257). Geometry is unchanged.
          node.kind = 'container';
          delete node.spriteType;
          delete node.quadTextureSprite;
          node.background = { ...(typeof node.background === 'object' ? node.background : {}), name: `${node.name ?? 'bg'}_bg`, sprite: spriteName };
          changes.push({ path, kind: 'icon', change: 'cornered-tile-icon-to-container', from: declared, to: { kind: 'container', background: spriteName } });
        } else {
          changes.push({
            path,
            kind: spec.kind,
            change: 'size-dropped',
            from: declared,
            to: natural ? { natural } : null,
            note: natural
              ? natural.width === declared.width && natural.height === declared.height
                ? 'the sprite is already that size, so nothing changes in game'
                : `the sprite is ${natural.width}x${natural.height}; the engine draws that, not the declared size`
              : 'the sprite has no readable texture; the declared size cannot be honoured',
          });
        }
        delete node.size;
      }
    }

    // ---------------------------------------------------------------- fields
    for (const field of [...Object.keys(node), ...Object.keys(node.extra ?? {})]) {
      if (['id', 'kind', 'type', 'name', 'children', 'variables', 'subBlocks', 'conditionals', 'extra', 'background', 'keywords', 'keyword', 'sourceFile', 'sourceLine', 'syntheticRoot', 'size', 'maxWidth', 'maxHeight'].includes(field)) continue;
      if (kindAcceptsField(spec, field)) continue;
      if (!isKnownField(field) && !isEngineRejectedField(field) && !isFieldRejectedForKind(spec, field)) continue;
      if (!isEngineRejectedField(field) && !isFieldRejectedForKind(spec, field)) continue; // unproven per-kind mismatch: left alone
      const value = node.extra?.[field] ?? node[field];
      if (node.extra) delete node.extra[field];
      delete node[field];
      const result = translateFieldForKind(spec, field, value);
      if (result.moveToBackground) {
        if (typeof node.background === 'object' && node.background) {
          node.background.alwaysTransparent = value === true || value === 'yes' || value === 'true';
          changes.push({ path, kind: spec.kind, change: 'field-to-background', from: { [field]: value }, to: { backgroundAlwaysTransparent: node.background.alwaysTransparent } });
        } else {
          changes.push({ path, kind: spec.kind, change: 'field-dropped', from: { [field]: value }, to: null, note: result.reason });
        }
        continue;
      }
      if (result.field) {
        node[result.field] = result.value;
        changes.push({ path, kind: spec.kind, change: 'field-translated', from: { [field]: value }, to: { [result.field]: result.value }, note: result.reason });
      } else {
        changes.push({ path, kind: spec.kind, change: 'field-dropped', from: { [field]: value }, to: null, note: result.reason });
      }
    }
    if (node.extra && Object.keys(node.extra).length === 0) delete node.extra;
  });

  return { layout: next, changes };
}

/**
 * The top-level containerWindowTypes of a layout, in document order.
 *
 * A layout imported from a real `.gui` file has a SYNTHETIC root whose children are the file's
 * top-level containers. Writing that root as a container would invent a window the file does not
 * have, so consumers (the emitter, the validator's name-collision check) work from this list.
 */
export function topLevelContainers(layout) {
  if (!layout?.root) return [];
  if (layout.root.syntheticRoot) {
    return (layout.root.children ?? []).map((node) => (node.kind ? node : { ...node, kind: 'container' }));
  }
  return [{ ...layout.root, kind: layout.root.kind ?? 'container' }];
}

// `firstConstruct` / `stripComment` live in paradox.mjs (the syntax checker needs them and must
// not import the layout engine). Imported here for `parseGuiText` and re-exported because
// callers and tests already reach for them on this module.
export { firstConstruct, stripComment };

// Imported at the bottom to keep the module's import list readable at the top.
import { parseParadox as parseParadoxFile, firstConstruct, stripComment } from './paradox.mjs';
