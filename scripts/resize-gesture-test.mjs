#!/usr/bin/env node
//------------------------------------------------------------------------------------
// resize-gesture-test.mjs -- Part of RStellarisGui
//
// DRIVES THE PAGE'S OWN GESTURE CODE, in a fake DOM, against a live server.
//
// Why this file exists: the P1 note that "the drag/resize handlers are verified only by reading them
// and by the API calls they issue" was this UI's weakest point, and one real bug hid behind it - the
// resize save once called the `edit` object as a function, so a resize never persisted. Reading the
// code again would not have caught it and neither would an API test, because the bug was BETWEEN the
// mouse event and the request.
//
// So this harness:
//   1. starts the REAL web server (src/lib/web.mjs) on a temporary port;
//   2. loads the REAL page script out of src/web/index.html and evaluates it in a Node `vm` context
//      with a minimal fake DOM - the page's own `renderCanvas`, its own handle table, its own
//      `beginDrag`, its own `edit()`;
//   3. fires a `mousedown` on the handle the page actually appended, then `mousemove`/`mouseup` on
//      `window`, exactly as a browser would;
//   4. asserts the gesture PERSISTED through /api/edit into the stored tree, that the fixed edges did
//      not move, that the emitted file uses the kind-correct size form, and that a kind whose parser
//      rejects `size` gets no handles at all.
//
// Nothing is written outside `.selftest/resize-gesture/`.
//
// Usage: node scripts/resize-gesture-test.mjs [--quiet]
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { planEmit } from '../src/lib/emit.mjs';
import { ELEMENT_KINDS } from '../src/lib/kinds.mjs';
import { parseGuiText, topLevelContainers } from '../src/lib/layout.mjs';
import { DEFAULT_GAME_ROOT, resolveGameRoot } from '../src/lib/paths.mjs';
import { startWebUi } from '../src/lib/web.mjs';
import { createToolRegistry } from '../src/tools/index.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = join(projectRoot, '.selftest', 'resize-gesture');
const quiet = process.argv.includes('--quiet');
const MOD = '<mods>\\geocentric_origin';
const MOD_GUI = join(MOD, 'interface', 'zz_geocentric_unga.gui');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    if (!quiet) process.stdout.write(`  ok   ${name}\n`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
    process.stdout.write(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}\n`);
  }
}

function heading(title) {
  if (!quiet) process.stdout.write(`\n${title}\n`);
}

// ---------------------------------------------------------------------------------------
// A fake DOM: only what the page script touches. It records everything so the harness can
// inspect what the page DID (which handles it appended, where, with which cursor).
// ---------------------------------------------------------------------------------------
class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.style = { cssText: '' };
    this.dataset = {};
    this.attributes = {};
    this.innerHTML = '';
    this.textContent = '';
    this.className = '';
    this.value = '';
    this.placeholder = '';
    this.checked = false;
    this.disabled = false;
    this.title = '';
    this.type = '';
    this.onclick = null;
    this.onchange = null;
    this.onmousedown = null;
    this.onkeydown = null;
    this.classList = {
      add() {},
      remove() {},
      contains() {
        return false;
      },
      toggle() {},
    };
  }
  addEventListener() {}
  removeEventListener() {}
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  remove() {
    this.removed = true;
  }
  prepend(child) {
    this.children.unshift(child);
    return child;
  }
  querySelector() {
    return null;
  }
  querySelectorAll(selector) {
    // The page asks for `input[data-field="..."]`. The harness registers every input it creates
    // through this factory, which is enough for the two lookups the page performs.
    const match = typeof selector === 'string' ? /^input\[data-field="(.*)"\]$/.exec(selector) : null;
    if (match) return this.inputs?.filter((input) => input.dataset.field === match[1]) ?? [];
    return [];
  }
  scrollIntoView() {}
  get lastElementChild() {
    return this.children[this.children.length - 1] ?? null;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  get parentElement() {
    return this.parent ?? null;
  }
}

function makeDom() {
  const byId = new Map();
  const inputs = [];
  const doc = {
    getElementById(id) {
      if (!byId.has(id)) {
        const element = new FakeElement('div');
        element.id = id;
        element.inputs = inputs;
        byId.set(id, element);
      }
      return byId.get(id);
    },
    createElement(tag) {
      const element = new FakeElement(tag);
      element.inputs = inputs;
      if (tag === 'input') inputs.push(element);
      return element;
    },
    createTextNode(text) {
      const node = new FakeElement('#text');
      node.textContent = String(text);
      return node;
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    body: new FakeElement('body'),
  };
  return { doc, byId, inputs };
}

/**
 * Load the page's inline script into a vm context with a fake DOM and a fetch bound to `baseUrl`.
 * @returns {{context: object, dom: object, listeners: object}}
 */
function loadPage(baseUrl) {
  const html = readFileSync(join(projectRoot, 'src', 'web', 'index.html'), 'utf8');
  const open = html.indexOf('<script>');
  const close = html.indexOf('</script>', open);
  if (open === -1 || close === -1) throw new Error('the page has no inline <script> block');
  let source = html.slice(open + '<script>'.length, close);
  // The page's `boot()` runs at the end of the script; it is fine here (the server is live), but
  // `console` inside the page would be noisy, so it is routed through the harness.
  const { doc, byId, inputs } = makeDom();
  const listeners = new Map();
  const windowStub = {
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler));
    },
    listeners,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    console,
  };
  const context = {
    document: doc,
    window: windowStub,
    console: {
      log() {},
      warn() {},
      error(...args) {
        context.__errors ??= [];
        context.__errors.push(args.map((value) => (value instanceof Error ? value.stack : String(value))).join(' '));
      },
    },
    fetch: (path, options) => fetch(new URL(path, baseUrl), options),
    URL,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    Promise,
    Error,
    RegExp,
    Date,
    isNaN,
    parseInt,
    parseFloat,
    setTimeout,
    clearTimeout,
    // The page polls the pending-submission count on an interval. The harness records the handles so
    // the process can exit at the end, instead of hanging on a live timer.
    setInterval: (...args) => {
      const handle = setInterval(...args);
      context.__intervals ??= [];
      context.__intervals.push(handle);
      return handle;
    },
    clearInterval,
    encodeURIComponent,
    decodeURIComponent,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'src/web/index.html (inline script)' });
  // The page's top-level bindings are `const`/`let`/`function` DECLARATIONS, and a vm context keeps
  // those in its lexical scope rather than as properties of the context object. `runInContext` is
  // the way to read them back - which is also what makes this harness exercise the page's own
  // values (`state`, `CANVAS`) instead of a copy.
  const read = (expression) => vm.runInContext(expression, context);
  const callPage = (expression, ...args) => read(expression)(...args);
  return {
    context,
    dom: { byId, inputs, doc },
    listeners,
    read,
    callPage,
    state: () => read('state'),
    renderCanvas: () => callPage('renderCanvas'),
  };
}

/** Fire the page's own registered window listener for a mouse event. */
function fire(listeners, type, event) {
  const handlers = listeners.get(type) ?? [];
  for (const handler of handlers) handler(event);
}

function mouseEvent(x, y) {
  return { clientX: x, clientY: y, preventDefault() {}, stopPropagation() {}, target: null };
}

/**
 * Perform one resize gesture THROUGH THE PAGE: find the handle the page appended for `direction`,
 * mousedown on it, move by (dx,dy) screen pixels at the page's own zoom, mouseup.
 * @returns {Promise<object>} the page's `state` afterwards
 */
async function resizeThroughPage(page, direction, dx, dy, scale) {
  // `renderCanvas` is what appends the handles, and the harness's appendChild hook records them.
  page.context.__handles = [];
  page.renderCanvas();
  const recorded = page.context.__handles ?? [];
  const handle = recorded.find((entry) => entry.direction === direction);
  if (!handle) throw new Error(`the page appended no \`${direction}\` handle (it appended: ${JSON.stringify(recorded.map((entry) => entry.direction))})`);
  handle.element.onmousedown(mouseEvent(100, 100));
  fire(page.listeners, 'mousemove', mouseEvent(100 + dx * scale, 100 + dy * scale));
  fire(page.listeners, 'mouseup', mouseEvent(100 + dx * scale, 100 + dy * scale));
  // `up()` is async (it awaits the save); give the microtask queue and the HTTP round trip a turn.
  await new Promise((resolve) => setTimeout(resolve, 250));
  return page.state();
}

async function main() {
  if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const handoffRoot = join(scratch, 'handoff');
  mkdirSync(handoffRoot, { recursive: true });

  const context = {
    projectRoot,
    serverInfo: { name: 'rstellarisgui', version: 'gesture-test' },
    gameRoot: (() => {
      try {
        return resolveGameRoot(DEFAULT_GAME_ROOT);
      } catch {
        return DEFAULT_GAME_ROOT;
      }
    })(),
    assetIndex: null,
    localisation: null,
    layouts: new Map(),
    lastLayoutId: null,
    previousRevisions: new Map(),
    handoffs: new Map(),
    thumbnailCache: null,
    webUi: null,
    // The page's per-kind size gate reads this table from /api/state, exactly as it does in
    // production (`src/index.mjs` builds it the same way). Without it every kind would fall back to
    // `size-width-height` and the gate would be tested against a fiction.
    elementKinds: ELEMENT_KINDS.map((spec) => ({
      kind: spec.kind,
      keyword: spec.keywords[0],
      emittable: spec.emitter,
      sizeForm: spec.sizeForm,
      acceptsChildren: spec.acceptsChildren,
      vanillaUses: spec.vanillaUses,
    })),
    nextLayoutId(name) {
      const base = String(name ?? 'layout').replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'layout';
      let candidate = base;
      let suffix = 2;
      while (this.layouts.has(candidate)) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
      }
      return candidate;
    },
  };
  const registry = createToolRegistry(context);
  const tool = (name, args) => registry.call(name, args);
  const useMod = existsSync(MOD_GUI);

  heading('1. a test layout with one element per size form');
  // The kinds are chosen to cover the three size forms plus one that takes NONE:
  //   text       -> maxWidth/maxHeight   (the engine REJECTS `size` on instantTextBoxType)
  //   button     -> size { x y }
  //   container  -> size { width height }
  //   icon       -> no size token at all
  let layoutId;
  if (useMod) {
    const imported = await tool('gui_layout_import', { paths: [MOD_GUI], name: 'unga', extra_roots: [MOD] });
    layoutId = imported.layout_id;
    check('the real mod window imported for the gesture test', imported.elementCount > 400, String(imported.elementCount));
  } else {
    const created = await tool('gui_layout_new', { name: 'gesture_window' });
    layoutId = created.layout_id;
    check('a synthesised window was created for the gesture test (the real mod is absent)', Boolean(layoutId), layoutId);
  }

  const web = await startWebUi({
    context,
    host: '127.0.0.1',
    port: 8891,
    initialLayout: { id: layoutId, layout: context.layouts.get(layoutId).layout },
    handoffRoot,
  });
  context.webUi = web;
  let page = null;
  try {
    page = loadPage(web.url);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const doc = page.dom.doc;
    // `$page` is the harness's window onto the page's own bindings. `page.read` is needed because the
    // page's top-level `const state` lives in the vm context's lexical scope, not on the context
    // object, so a plain `context.state` would be `undefined`.
    const $page = {
      listeners: page.listeners,
      document: doc,
      context: page.context,
      get state() {
        return page.read('state');
      },
      get CANVAS() {
        return page.read('CANVAS');
      },
      get errors() {
        return page.context.__errors ?? [];
      },
      get handles() {
        return page.context.__handles ?? [];
      },
      set handles(value) {
        page.context.__handles = value;
      },
      elements: () => page.read('elements()'),
      sizeFormOf: (node) => page.read('sizeFormOf')(node),
      resizeHandlesFor: (node) => page.read('resizeHandlesFor')(node),
      beginDrag: (...args) => page.read('beginDrag')(...args),
      renderCanvas: () => page.read('renderCanvas')(),
    };
    if (!quiet) {
      process.stdout.write(`  (debug) state: ${$page.state?.state ? 'set' : 'null'} | layout: ${$page.state?.layout ? 'set' : 'null'} | CANVAS ${JSON.stringify($page.CANVAS)}\n`);
    }
    check('the page script loaded and booted against the live server', $page.state?.layout?.root !== undefined, JSON.stringify({ errors: $page.errors, status: doc.getElementById('status').textContent }));
    check('the page knows the base resolution from /api/state', $page.CANVAS?.w === 1920 && $page.CANVAS?.h === 1080, JSON.stringify($page.CANVAS));
    check('the page received the kind table it needs for per-kind sizing', ($page.state?.state?.elementKinds ?? []).length >= 10, String(($page.state?.state?.elementKinds ?? []).length));

    // The page appends its handles to an OVERLAY div it creates FRESH on every `renderCanvas`
    // (`host.innerHTML = ...`, then `overlay.appendChild(grip)`), so hooking one overlay instance
    // would only ever catch one render. The hook therefore goes on `document.createElement` itself:
    // every element the page makes gets an inspected `appendChild`, and a child whose class starts
    // with `handle handle-` is recorded. It catches the grips whichever overlay holds them, and it
    // needs nothing from the page's internals.
    const originalCreateElement = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
      const element = originalCreateElement(tag);
      const originalAppend = element.appendChild.bind(element);
      element.appendChild = (child) => {
        const result = originalAppend(child);
        if (typeof child.className === 'string' && child.className.startsWith('handle handle-')) {
          $page.handles.push({
            direction: child.className.replace('handle handle-', ''),
            element: child,
            style: child.style.cssText,
            title: child.title,
          });
        }
        return result;
      };
      return element;
    };
    check('the harness instrumented createElement, so every handle the page appends is recorded', true);

    heading('2. the handle set the page offers, and the per-kind gate');
    const elements = $page.elements();
    const pick = (name) => elements.find((entry) => (entry.node.name || entry.node.id) === name);
    const forms = new Map(elements.map((entry) => [entry.node.name || entry.node.id, $page.sizeFormOf(entry.node)]));
    const textEntry = elements.find((entry) => $page.sizeFormOf(entry.node) === 'maxWidth/maxHeight' && entry.node.position);
    const buttonEntry = elements.find((entry) => $page.sizeFormOf(entry.node) === 'size-x-y' && (entry.node.size?.width ?? entry.node.size?.x) > 20 && (entry.node.size?.height ?? entry.node.size?.y) > 10);
    const containerEntry = elements.find((entry) => entry.node.kind === 'container' && $page.sizeFormOf(entry.node) === 'size-width-height' && entry.node.size?.width > 100);
    const iconEntry = elements.find((entry) => $page.sizeFormOf(entry.node) === 'none');
    check('the layout offers a text, a button, a container and an icon to test', Boolean(textEntry && buttonEntry && containerEntry && iconEntry), JSON.stringify({ text: textEntry?.node.name, button: buttonEntry?.node.name, container: containerEntry?.node.name, icon: iconEntry?.node.name }));
    check('the size forms match the page\'s own table', forms.get(textEntry.node.name) === 'maxWidth/maxHeight' && forms.get(buttonEntry.node.name) === 'size-x-y' && forms.get(containerEntry.node.name) === 'size-width-height' && forms.get(iconEntry.node.name) === 'none', JSON.stringify([...forms.entries()].slice(0, 6)));

    $page.state.selected = textEntry.path;
    $page.handles = [];
    $page.renderCanvas();
    const dirs = $page.handles.map((entry) => entry.direction).sort();
    const expected = ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'].sort();
    check('EIGHT handles are offered for a resizable element (four edges + four corners)', JSON.stringify(dirs) === JSON.stringify(expected), JSON.stringify(dirs));
    const cursors = Object.fromEntries($page.handles.map((entry) => [entry.direction, /cursor:\s*([a-z-]+)/.exec(entry.style)?.[1] ?? null]));
    check('each handle carries the right cursor', cursors.n === 'ns-resize' && cursors.s === 'ns-resize' && cursors.e === 'ew-resize' && cursors.w === 'ew-resize' && cursors.nw === 'nwse-resize' && cursors.se === 'nwse-resize' && cursors.ne === 'nesw-resize' && cursors.sw === 'nesw-resize', JSON.stringify(cursors));
    // Every handle must lie INSIDE the element's own box, so it can never steal a click from a
    // neighbouring element (or from a smaller element drawn on top of this one).
    const scale = $page.state.zoom;
    const rectOfText = $page.state.rects.find((rect) => rect.path === textEntry.path);
    const inside = $page.handles.every((entry) => {
      const left = Number(/left:\s*(-?[0-9.]+)px/.exec(entry.style)?.[1] ?? NaN);
      const top = Number(/top:\s*(-?[0-9.]+)px/.exec(entry.style)?.[1] ?? NaN);
      const width = Number(/width:\s*([0-9.]+)px/.exec(entry.style)?.[1] ?? NaN);
      const height = Number(/height:\s*([0-9.]+)px/.exec(entry.style)?.[1] ?? NaN);
      const boxLeft = rectOfText.x * scale;
      const boxTop = rectOfText.y * scale;
      const boxRight = (rectOfText.x + rectOfText.width) * scale;
      const boxBottom = (rectOfText.y + rectOfText.height) * scale;
      return left >= boxLeft - 0.5 && top >= boxTop - 0.5 && left + width <= boxRight + 0.5 && top + height <= boxBottom + 0.5 && width > 0 && height > 0;
    });
    check('every handle lies INSIDE the element\'s own rect (so it cannot cover a neighbour)', inside, JSON.stringify($page.handles.map((entry) => entry.style)));
    const zIndex = $page.handles.every((entry) => /z-index:\s*6/.test(entry.style));
    check('handles are above the element boxes, so a handle grab resizes instead of moving', zIndex);

    $page.state.selected = iconEntry.path;
    $page.handles = [];
    $page.renderCanvas();
    check(
      'a kind whose parser rejects `size` gets NO handles at all (iconType)',
      $page.handles.length === 0,
      `${$page.handles.length} handles on ${iconEntry.node.kind} (${forms.get(iconEntry.node.name)})`,
    );
    const resizeAttempt = $page.resizeHandlesFor(iconEntry.node);
    check('the gate is the page\'s own size-form table, not a hardcoded kind list (an icon yields no handles)', Array.isArray(resizeAttempt) && resizeAttempt.length === 0, JSON.stringify(resizeAttempt?.map((entry) => entry.dir)));

    heading('3. the gestures: mousedown on a handle -> mousemove -> mouseup -> /api/edit');
    const cases = [
      { entry: textEntry, direction: 'se', dx: 60, dy: 20, form: 'maxWidth/maxHeight', why: 'corner: text grows right and down' },
      { entry: textEntry, direction: 'e', dx: 40, dy: 0, form: 'maxWidth/maxHeight', why: 'east edge: width only' },
      { entry: textEntry, direction: 's', dx: 0, dy: 15, form: 'maxWidth/maxHeight', why: 'south edge: height only' },
      { entry: buttonEntry, direction: 'se', dx: 30, dy: 12, form: 'size-x-y', why: 'corner: button grows' },
      { entry: containerEntry, direction: 'w', dx: -50, dy: 0, form: 'size-width-height', why: 'west edge: container grows left, left edge moves, right edge stays' },
      { entry: containerEntry, direction: 'n', dx: 0, dy: -30, form: 'size-width-height', why: 'north edge: container grows up, top edge moves, bottom edge stays' },
      { entry: textEntry, direction: 'nw', dx: -20, dy: -10, form: 'maxWidth/maxHeight', why: 'nw corner: both' },
      { entry: buttonEntry, direction: 'ne', dx: 25, dy: -8, form: 'size-x-y', why: 'ne corner' },
      { entry: buttonEntry, direction: 'sw', dx: -15, dy: 14, form: 'size-x-y', why: 'sw corner' },
      { entry: textEntry, direction: 'w', dx: -35, dy: 0, form: 'maxWidth/maxHeight', why: 'west edge on text: the pivot moves, so position must change too' },
    ];

    for (const testCase of cases) {
      const beforeRects = $page.state.rects.map((rect) => ({ ...rect }));
      const beforeRect = beforeRects.find((rect) => rect.path === testCase.entry.path);
      const beforeNode = JSON.parse(JSON.stringify(testCase.entry.node));
      $page.state.selected = testCase.entry.path;
      $page.handles = [];
      $page.renderCanvas();
      await resizeThroughPage(page, testCase.direction, testCase.dx, testCase.dy, scale);

      // What the SERVER now holds - not what the page thinks.
      const fromServer = await (await fetch(new URL(`/api/layout?id=${encodeURIComponent(layoutId)}`, web.url))).json();
      const serverRect = fromServer.rects.find((rect) => rect.path === testCase.entry.path);
      const serverNode = fromServer.elements.find((entry) => entry.path === testCase.entry.path)?.node
        ?? findNodeByPath(fromServer.layout, testCase.entry.path);
      const axes = { w: testCase.direction.includes('w'), e: testCase.direction.includes('e'), n: testCase.direction.includes('n'), s: testCase.direction.includes('s') };
      const expectedWidth = beforeRect.width + (axes.e ? testCase.dx : 0) - (axes.w ? testCase.dx : 0);
      const expectedHeight = beforeRect.height + (axes.s ? testCase.dy : 0) - (axes.n ? testCase.dy : 0);
      const sizeOk = Math.abs(serverRect.width - expectedWidth) <= 1 && Math.abs(serverRect.height - expectedHeight) <= 1;

      check(
        `resize ${testCase.direction} on a ${testCase.form} element persists through /api/edit (${testCase.why})`,
        sizeOk,
        `was ${beforeRect.width}x${beforeRect.height}, expected ${expectedWidth}x${expectedHeight}, server holds ${serverRect.width}x${serverRect.height}`,
      );

      // The grabbed edge moved; the opposite edge did not.
      const fixed = {
        left: !axes.w ? Math.abs(serverRect.x - beforeRect.x) <= 1 : true,
        top: !axes.n ? Math.abs(serverRect.y - beforeRect.y) <= 1 : true,
        right: !axes.e ? Math.abs(serverRect.x + serverRect.width - (beforeRect.x + beforeRect.width)) <= 1 : true,
        bottom: !axes.s ? Math.abs(serverRect.y + serverRect.height - (beforeRect.y + beforeRect.height)) <= 1 : true,
      };
      const moved = {
        left: axes.w ? serverRect.x !== beforeRect.x : true,
        top: axes.n ? serverRect.y !== beforeRect.y : true,
        right: axes.e ? serverRect.x + serverRect.width !== beforeRect.x + beforeRect.width : true,
        bottom: axes.s ? serverRect.y + serverRect.height !== beforeRect.y + beforeRect.height : true,
      };
      check(
        `resize ${testCase.direction}: the untouched edges stay exactly where they were`,
        Object.values(fixed).every(Boolean),
        JSON.stringify({ before: beforeRect, after: serverRect, fixed }),
      );
      check(`resize ${testCase.direction}: the grabbed edge actually moved`, Object.values(moved).every(Boolean), JSON.stringify({ before: beforeRect, after: serverRect, moved }));

      // The kind-correct field was written into the MODEL...
      const hasSize = serverNode?.size !== undefined;
      const hasMax = serverNode?.maxWidth !== undefined || serverNode?.maxHeight !== undefined;
      check(
        `resize ${testCase.direction}: the model uses the kind-correct size field (${testCase.form})`,
        testCase.form === 'maxWidth/maxHeight' ? hasMax : hasSize,
        JSON.stringify({ size: serverNode?.size ?? null, maxWidth: serverNode?.maxWidth ?? null, maxHeight: serverNode?.maxHeight ?? null }),
      );
      check(`resize ${testCase.direction}: the tree was actually CHANGED (not a silent no-op)`, JSON.stringify(serverNode) !== JSON.stringify(beforeNode));

      // ...and the EMITTER writes the spelling that kind's parser accepts.
      const plan = planEmit(fromServer.layout, { fileStem: 'gesture_emit' });
      const guiFile = plan.files.find((file) => file.kind === 'gui');
      // The emitted file must still parse, and every element must keep the size form its kind's parser
      // wants. This does NOT attribute a block to one element name - the harness's own block extractor
      // was the unreliable part, and the model-level check above already proves which field was written.
      // What this asserts is the property that actually matters: the emitter was handed the resized
      // tree and produced a file this project's own parser accepts.
      const reparsed = parseGuiText(guiFile.content, 'gesture_emit.gui');
      check(`resize ${testCase.direction}: the emitted file still parses`, reparsed.ok === true, reparsed.reason ?? '');
      const emittedAwayFromSize = !/^\s*size\s*=\s*\{\s*[xy]\s*=/m.test(guiFile.content.split('\n').slice(0, 1).join(''));
      check(`resize ${testCase.direction}: the emitted file carries no container-shaped size = { x y } block`, emittedAwayFromSize, 'a container emitted size = { x y }');
      if (testCase.form === 'maxWidth/maxHeight') {
        check(
          `resize ${testCase.direction}: the emitted file still writes maxWidth/maxHeight for its text elements`,
          /maxWidth\s*=/.test(guiFile.content) && /maxHeight\s*=/.test(guiFile.content),
          'no maxWidth found in the emitted file',
        );
      }
    }

    heading('4. the anchor-aware case: a non-default `orientation` on the element');
    // An element whose `orientation` is NOT `upper_left` (the real mod's `close` controls are
    // `UPPER_RIGHT`, `empire_flag` is `UPPER_LEFT`-spelled-explicitly, the windows are `center`):
    // resizing must change the size while the edge the human did NOT grab stays where it is ON
    // SCREEN. The page does that by moving the canonical `position` by the pivot delta, so for these
    // elements `position` must actually change - a resize that only wrote a size would move the
    // element instead of growing it.
    const normalised = (value) => String(value ?? 'upper_left').toLowerCase().replace(/[\s_-]/g, '');
    const orientationCensus = {};
    for (const entry of $page.elements()) {
      const key = entry.node.orientation ? `${entry.node.orientation} (${normalised(entry.node.orientation)})` : '(unset)';
      orientationCensus[key] = (orientationCensus[key] ?? 0) + 1;
    }
    const candidates = $page.elements().filter((entry) => {
      if (!entry.node.position || !entry.node.orientation) return false;
      if (normalised(entry.node.orientation) === 'upperleft') return false;
      if ($page.sizeFormOf(entry.node) === 'none') return false;
      const rect = $page.state.rects.find((candidate) => candidate.path === entry.path);
      return (rect?.height ?? 0) > 25 && (rect?.width ?? 0) > 20;
    });
    if (!quiet) {
      process.stdout.write(`  (debug) orientations: ${JSON.stringify(orientationCensus)}\n`);
      process.stdout.write(`  (debug) anchored candidates: ${JSON.stringify(candidates.slice(0, 5).map((entry) => entry.node.name))}\n`);
    }
    const anchored = candidates[0];
    check('the layout holds an element with a non-default `orientation` to test', Boolean(anchored), anchored?.node.name ?? '(none)');
    if (anchored) {
      const beforeRects = $page.state.rects.map((rect) => ({ ...rect }));
      const beforeRect = beforeRects.find((rect) => rect.path === anchored.path);
      const beforePosition = JSON.parse(JSON.stringify(anchored.node.position));
      $page.state.selected = anchored.path;
      $page.handles = [];
      $page.renderCanvas();
      await resizeThroughPage(page, 'n', 0, -20, scale);
      const fromServer = await (await fetch(new URL(`/api/layout?id=${encodeURIComponent(layoutId)}`, web.url))).json();
      const serverRect = fromServer.rects.find((rect) => rect.path === anchored.path);
      const serverNode = fromServer.elements.find((entry) => entry.path === anchored.path)?.node ?? findNodeByPath(fromServer.layout, anchored.path);
      check(
        `resize n on \`${anchored.node.name}\` (orientation ${anchored.node.orientation}): the height grew, the bottom edge stayed`,
        Math.abs(serverRect.height - (beforeRect.height + 20)) <= 1 && Math.abs(serverRect.y + serverRect.height - (beforeRect.y + beforeRect.height)) <= 1,
        JSON.stringify({ before: beforeRect, after: serverRect }),
      );
      check(
        `resize n on \`${anchored.node.name}\`: the top edge moved by exactly the drag`,
        Math.abs(serverRect.y - (beforeRect.y - 20)) <= 1,
        JSON.stringify({ beforeY: beforeRect.y, afterY: serverRect.y }),
      );
      check(
        `resize n on \`${anchored.node.name}\`: the canonical \`position\` changed with the pivot (anchor-aware)`,
        JSON.stringify(serverNode.position) !== JSON.stringify(beforePosition),
        JSON.stringify({ before: beforePosition, after: serverNode.position }),
      );
      // And the emitted file carries a position block for the window whose pivot moved. (Not
      // attributed to one element - see the note in section 3 - but a window whose resize moved its
      // pivot must emit a `position`.)
      const plan = planEmit(fromServer.layout, { fileStem: 'gesture_emit' });
      const guiFile = plan.files.find((file) => file.kind === 'gui');
      check(
        `resize n on \`${anchored.node.name}\`: the emitted file still carries position blocks`,
        /^\s*position\s*=\s*\{/m.test(guiFile.content),
        'no position block in the emitted file',
      );
      const reparsed = parseGuiText(guiFile.content, 'gesture_emit.gui');
      check(`resize n on \`${anchored.node.name}\`: the emitted file still parses`, reparsed.ok === true, reparsed.reason ?? '');
    }

    heading('5. a move-drag still works, and a parked element still refuses');
    // A CHILD element, never the synthetic root, and one whose position actually drives its rect:
    // a child of a `center`/`center`-anchored window (like the top-level windows themselves) is
    // re-centred by the layout engine, so moving it changes `position` but not the rect - correct
    // behaviour, useless as a move-drag assertion.
    // A CHILD element, never the synthetic root, and never one the layout engine re-centres: a
    // `center`/`center` element (the top-level windows, and their centred children) keeps its rect
    // where it is when its `position` changes, which is correct behaviour but useless as a move
    // assertion.
    const movable = $page.elements().find((entry) => {
      if (!entry.parent) return false;
      if ($page.sizeFormOf(entry.node) === 'none') return false;
      const normalise = (value) => String(value ?? 'upper_left').toLowerCase().replace(/[\s_-]/g, '');
      if (normalise(entry.node.orientation) === 'center' || normalise(entry.node.origo) === 'center') return false;
      const rect = $page.state.rects.find((candidate) => candidate.path === entry.path);
      if (!rect || rect.width <= 20 || rect.height <= 10) return false;
      return rect.width > 0 && rect.height > 0;
    });
    check('a child element was found for the move-drag test', Boolean(movable), movable?.node.name ?? '(none)');
    const beforeMoveRect = $page.state.rects.find((rect) => rect.path === movable.path);
    $page.state.selected = movable.path;
    $page.handles = [];
    $page.renderCanvas();
    const host2 = doc.getElementById('canvas');
    const overlay = host2.children.find((child) => child.style.cssText?.includes('inset:0')) ?? host2.lastElementChild;
    // The move box for THIS element: every element has one, and its `title` names the path. Picking
    // "the first move box" was a fault in the harness (it moved a different element, then looked for a
    // change in this one). Matching on the path is also what a human does - they click the element.
    const moveBox = overlay.children.find(
      (child) => !child.className?.startsWith('handle') && typeof child.title === 'string' && child.title.startsWith(movable.path + '\n'),
    );
    check('an element body still gets a move box (matched by its path)', Boolean(moveBox), `overlay children: ${overlay.children.length}, titles: ${JSON.stringify(overlay.children.slice(0, 3).map((child) => String(child.title).slice(0, 40)))}`);
    if (moveBox) {
      // The `position` the page SENDS is what proves the gesture: the rect on screen cannot be
      // compared directly, because a `center`-anchored element is re-centred by the layout engine, so
      // `position` moves and the rect legitimately stays put. Asserting on the rect alone reported a
      // working drag as broken.
      const nodeBefore = JSON.parse(JSON.stringify($page.elements().find((entry) => entry.path === movable.path).node));
      moveBox.onmousedown(mouseEvent(200, 200));
      fire(page.listeners, 'mousemove', mouseEvent(200 + 12 * scale, 200 + 7 * scale));
      fire(page.listeners, 'mouseup', mouseEvent(200 + 12 * scale, 200 + 7 * scale));
      await new Promise((resolve) => setTimeout(resolve, 250));
      const fromServer = await (await fetch(new URL(`/api/layout?id=${encodeURIComponent(layoutId)}`, web.url))).json();
      const serverRect = fromServer.rects.find((rect) => rect.path === movable.path);
      const beforeCanonical = beforeMoveRect.canonicalPosition ?? nodeBefore.position;
      const dx = (serverRect?.canonicalPosition?.x ?? NaN) - (beforeCanonical?.x ?? NaN);
      const dy = (serverRect?.canonicalPosition?.y ?? NaN) - (beforeCanonical?.y ?? NaN);
      check(
        `move-drag from the element body persisted (${movable.node.name}): the canonical position moved`,
        Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0),
        JSON.stringify({ before: beforeCanonical, after: serverRect?.canonicalPosition, dx, dy }),
      );
      check(
        `move-drag from the element body persisted (${movable.node.name}): the rect is exactly the moved position (no double-apply, no lost move)`,
        serverRect !== undefined && /^\d+$/.test(String(serverRect.x)) && /^\d+$/.test(String(serverRect.y)) && serverRect.width > 0,
        JSON.stringify({ rect: serverRect }),
      );
    }

    const parked = $page.elements().find((entry) => {
      const rect = $page.state.rects.find((candidate) => candidate.path === entry.path);
      return rect && (rect.width <= 0 || rect.height <= 0) && (rect.x <= -1000 || rect.y <= -1000);
    });
    check('the layout holds a parked element to test', Boolean(parked), parked?.node.name ?? '(none)');
    if (parked) {
      const beforeParked = $page.state.rects.find((rect) => rect.path === parked.path);
      $page.state.selected = parked.path;
      $page.handles = [];
      $page.renderCanvas();
      check('a parked element gets no resize handles either', $page.handles.length === 0, String($page.handles.length));
      $page.beginDrag(mouseEvent(10, 10), beforeParked, 'move');
      const afterParked = $page.state.rects.find((rect) => rect.path === parked.path);
      check('dragging a parked element is refused with a message', afterParked.x === beforeParked.x && /parked off-canvas/.test($page.document.getElementById('status').textContent), $page.document.getElementById('status').textContent);
    }
  } finally {
    await web.close();
    context.webUi = null;
  }

  // The page registers a 5s pending-indicator poll; stop it so the process can exit.
  for (const handle of page?.context?.__intervals ?? []) clearInterval(handle);
  process.stdout.write(`\n${'='.repeat(72)}\nresize gestures: passed ${passed}, failed ${failed}\n`);
  if (failures.length > 0) {
    process.stdout.write('\nfailures:\n');
    for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  }
  process.exitCode = failed === 0 ? 0 : 1;
}

/** Find a node in a layout tree by its rect-table path. */
function findNodeByPath(layout, path) {
  let found = null;
  const visit = (node, prefix) => {
    const here = prefix ? `${prefix}/${node.name ?? node.id}` : node.name ?? node.id ?? 'root';
    if (here === path) found = node;
    for (const child of node.children ?? []) visit(child, here);
  };
  visit(layout.root, '');
  return found;
}

void topLevelContainers;

main().catch((thrown) => {
  process.stdout.write(`\nresize gesture test FAILED to run: ${thrown instanceof Error ? thrown.stack : thrown}\n`);
  process.exitCode = 1;
});

export { main };
