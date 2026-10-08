//------------------------------------------------------------------------------------
// web.mjs -- Part of RStellarisGui
//
// The local web UI: a zero-dependency Node HTTP server that serves a single-page app which
// shares this project's core library with the MCP tools. Nothing is duplicated - the page
// calls the same layout, validator, preview and emitter code the agent does.
//
// Design constraints:
//   - Bind to 127.0.0.1 by default. This is a local authoring tool, not a service.
//   - Export requires an explicit output path typed into the page, and goes through the same
//     `assertOutputRoot` guard, so the page cannot write into a game install or a mod folder.
//   - No build step, no bundler, no npm dependency.
//   - THE SAME GUARDRAILS THE TOOLS HAVE. `/api/edit` goes through `guardedEdit`, so a browser
//     that skipped a check (or a hand-written POST) is refused by the server, not by the page.
//     A UI that hides a delete button is a convenience; the refusal is the guarantee.
//
// Routes:
//   GET  /                     the page
//   GET  /api/state            server identity, layouts, index summary, base resolution, locks
//   GET  /api/assets?q=&...    sprite search with real sizes
//   GET  /api/sprite?name=     one sprite's metadata
//   GET  /api/thumb?name=&size= PNG thumbnail of a sprite (real texture, or 404)
//   GET  /api/layout?id=       the layout tree + computed rects + the locked paths
//   POST /api/layout           replace a stored layout tree
//   POST /api/edit             apply edits (same op vocabulary as gui_layout_edit, SAME GUARDRAILS)
//   POST /api/validate         run the validator over a stored layout
//   POST /api/preview          render SVG (+ PNG) into the output directory
//   GET  /api/preview.svg      inline SVG for the live canvas, with change highlighting
//   POST /api/export           write the files (requires an explicit output_root)
//   POST /api/handoff/submit   SUBMIT THE CURRENT LAYOUT TO THE AGENT, with provenance
//   GET  /api/handoff/pending  how many submissions no agent has picked up yet
//   GET  /api/handoff          the submissions, with their diffs and verdicts
//   GET  /api/diff             what changed since the compared revision (the reverse path)
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultParts, getAssetIndex, searchSprites, spriteInfo } from './asset-index.mjs';
import { decodeTextureThumbnail } from './dds.mjs';
import { assertOutputRoot, emitFiles } from './emit.mjs';
import {
  GUARD_DESCRIPTIONS,
  GUARD_RULES,
  PROTECTED_NAMES,
  protectionIndex,
  guardedEdit,
  scanContractViolations,
} from './handoff-guard.mjs';
import { HANDOFF_ROOT, listHandoffs, pendingHandoffs, submitHandoff } from './handoff.mjs';
import { applyEdits, defaultLayout, walkLayout, makeSpriteLookup, BASE_RESOLUTION } from './layout.mjs';
import { diffLayouts, formatDiffMarkdown, summariseDiff } from './layout-diff.mjs';
import { cacheRoot, defaultOutputRoot, ensureDir } from './paths.mjs';
import { encodePng, resizeRgba } from './png.mjs';
import { renderPng, renderSvg, ThumbnailCache } from './preview.mjs';
import { validateLayout } from './validate.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(moduleDirectory, '..', 'web', 'index.html');

const MAX_BODY_BYTES = 24 * 1024 * 1024; // a big pasted layout is still far below this

/** Read a request body as JSON, with a size cap. */
function readJsonBody(request) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return resolvePromise({});
      try {
        resolvePromise(JSON.parse(text));
      } catch (thrown) {
        reject(new Error(`invalid JSON body: ${thrown.message}`));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendText(response, status, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  response.end(text);
}

/** Find a free port by trying successive ones. */
function listen(server, host, port) {
  return new Promise((resolvePromise, reject) => {
    const onError = (thrown) => {
      server.removeListener('listening', onListening);
      reject(thrown);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolvePromise(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Start the web UI.
 *
 * @param {{context: object, host?: string, port?: number, initialLayout?: {id: string, layout: object}}} options
 */
export async function startWebUi(options) {
  const { context } = options;
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 8791;
  /**
   * The handoff area this PAGE session uses. It defaults to the plugin's own `out/handoff`, which is
   * what both the human and the agent normally share; a caller may point the whole session elsewhere
   * (`gui_web_ui_start({handoff_root})`, or `?handoff_root=` on a route), which is how the end-to-end
   * check drives the flow without writing into the real handoff area.
   */
  const pageHandoffRoot = options.handoffRoot ?? HANDOFF_ROOT;
  const cache = context.thumbnailCache ?? (context.thumbnailCache = new ThumbnailCache());
  const startedAt = new Date().toISOString();
  let pageHits = 0;
  const requests = [];

  context.previousRevisions ??= new Map();
  context.handoffs ??= new Map();

  // Make sure the initial layout is addressable.
  if (options.initialLayout?.layout) {
    const id = options.initialLayout.id ?? context.nextLayoutId(options.initialLayout.layout.name);
    if (!context.layouts.has(id)) {
      context.layouts.set(id, {
        layout: options.initialLayout.layout,
        createdAt: startedAt,
        source: 'gui_web_ui_start',
      });
    }
    if (!context.previousRevisions.has(id)) {
      // The page's FIRST revision is the baseline a human's edits are diffed against: "the layout
      // as it was loaded" is exactly this snapshot.
      context.previousRevisions.set(id, {
        id: `${id} (as loaded)`,
        source: 'the revision the page opened with',
        layout: options.initialLayout.layout,
        recordedAt: startedAt,
        baseline: true,
      });
    }
    context.lastLayoutId = id;
  }

  const currentLayoutId = () => context.lastLayoutId ?? [...context.layouts.keys()][0] ?? null;

  const resolveLayoutById = (id) => {
    const key = id ?? currentLayoutId();
    if (!key) {
      const fresh = defaultLayout({ name: 'web_window' });
      const newId = context.nextLayoutId('web_window');
      context.layouts.set(newId, { layout: fresh, createdAt: new Date().toISOString(), source: 'web-default' });
      context.lastLayoutId = newId;
      return { id: newId, layout: fresh };
    }
    const entry = context.layouts.get(key);
    if (!entry) throw new Error(`unknown layout id \`${key}\``);
    context.lastLayoutId = key;
    return { id: key, layout: entry.layout };
  };

  const assetIndex = () => {
    const index = getAssetIndex({ root: context.gameRoot });
    context.assetIndex = index;
    return index;
  };

  /**
   * Layout.mjs resolves an unsized sprite to its texture's natural size through this hook.
   * Without it every unsized icon/button computes as 0x0 - which is what made the default
   * close button render as "0x0" in the tree and the rect table. Shared with the validator and
   * the preview so all three agree.
   */
  const spriteLookupFor = (index) => makeSpriteLookup(index);

  /**
   * Which `custom_gui` windows does this layout hold?
   *
   * The guards need the names an event actually points at, because that is what decides whether a
   * top-level container is an event window and therefore whether its element names are protected.
   * The page has no events to read, so the shapes the layout itself presents are used: a container
   * whose direct children include `EVENT_DIPLO`, or several contract names, IS an event window -
   * and the real mod's six windows all qualify. A caller can widen the set with
   * `custom_gui_windows` on the submit call.
   */
  const customGuiWindowsFor = (layout, extra = []) => {
    const names = new Set(extra);
    for (const window of layout?.root?.syntheticRoot ? layout.root.children ?? [] : layout?.root ? [layout.root] : []) {
      const direct = (window?.children ?? []).map((child) => child.name).filter(Boolean);
      if (direct.includes('EVENT_DIPLO')) names.add(window.name);
      else if (direct.filter((name) => PROTECTED_NAMES.has(name)).length >= 3) names.add(window.name);
    }
    return [...names].filter(Boolean);
  };

  /** What the page needs to draw the locks, for one layout. */
  const locksFor = (layout) => {
    const customGuiWindows = customGuiWindowsFor(layout);
    const index = protectionIndex(layout, { customGuiWindows });
    return {
      customGuiWindows,
      locks: [...index.protections.values()]
        .map((entry) => ({
          path: entry.path,
          name: entry.name,
          kind: entry.kind,
          window: entry.window,
          close: Boolean(entry.close),
          windowContainer: Boolean(entry.windowContainer),
          reason: entry.reason,
        }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    };
  };

  /**
   * Remember the revision a layout is ABOUT to be replaced from, so the reverse feedback path has
   * something to diff against. Called immediately before every store.
   */
  const rememberPrevious = (id, entry, source) => {
    if (!id || !entry?.layout) return;
    context.previousRevisions.set(id, {
      id: `${id} @ ${entry.createdAt ?? '(unknown time)'}`,
      source: source ?? entry.source ?? 'the previous revision',
      layout: entry.layout,
      recordedAt: new Date().toISOString(),
    });
  };

  /** The diff between a layout and the revision it replaced, plus the changed paths to highlight. */
  const changeReport = (id, layout) => {
    const previous = context.previousRevisions.get(id);
    if (!previous?.layout) {
      return {
        comparedWith: null,
        changeCount: 0,
        counts: {},
        changedPaths: [],
        changes: [],
        markdown: null,
        unchanged: true,
        note:
          'no earlier revision of this layout is held in this process, so there is nothing to compare against. ' +
          'The page records one when a layout is loaded, when a handoff is picked, and before every store.',
      };
    }
    const diff = diffLayouts(previous.layout, layout, {
      beforeId: previous.id,
      afterId: id,
      beforeLabel: previous.source,
      afterLabel: 'current',
    });
    return {
      comparedWith: { id: previous.id, source: previous.source, recordedAt: previous.recordedAt ?? null },
      changeCount: diff.changeCount,
      counts: diff.counts,
      changedPaths: diff.changedPaths,
      changes: diff.changes,
      variableChanges: diff.variableChanges,
      unchanged: diff.unchanged,
      summary: summariseDiff(diff),
      markdown: formatDiffMarkdown(diff, { title: `Changes to \`${layout.name ?? id}\`` }),
    };
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? host}`);
    const route = url.pathname;
    requests.push({ at: new Date().toISOString(), method: request.method, route });
    if (requests.length > 200) requests.shift();

    try {
      // -------------------------------------------------------------------- page
      if (request.method === 'GET' && (route === '/' || route === '/index.html')) {
        pageHits += 1;
        const html = readFileSync(PAGE_PATH, 'utf8');
        return sendText(response, 200, html, 'text/html; charset=utf-8');
      }

      // -------------------------------------------------------------------- state
      if (request.method === 'GET' && route === '/api/state') {
        // Build the index on first use rather than only when another route happened to need it:
        // the page asks for /api/state first, and reporting `assetIndex: null` there left the
        // header count and the default-parts palette empty on load.
        const index = assetIndex();
        const pending = pendingHandoffs({ handoff_root: pageHandoffRoot, limit: 50 });
        return sendJson(response, 200, {
          server: context.serverInfo,
          startedAt,
          pageHits,
          baseResolution: BASE_RESOLUTION,
          gameRoot: context.gameRoot,
          assetIndex: index
            ? {
                root: index.root,
                version: index.version,
                spriteCount: index.stats.spriteCount,
                fontCount: index.stats.fontCount,
                containerCount: index.stats.containerCount,
                builtMs: index.stats.buildMs,
                indexBytes: index.stats.indexBytes,
              }
            : null,
          currentLayoutId: currentLayoutId(),
          layouts: [...context.layouts.entries()].map(([id, entry]) => ({
            id,
            name: entry.layout.name,
            source: entry.source,
            handoffId: context.handoffs.get(id)?.id ?? null,
          })),
          defaults: index ? defaultParts(index) : null,
          elementKinds: context.elementKinds ?? null,
          encodingRules: {
            gui: 'UTF-8, no BOM',
            script: 'UTF-8, no BOM',
            localisation: 'UTF-8 WITH BOM',
          },
          // The guardrails, described to the page so its locks and its refusal messages are the
          // same rules the server enforces (one table, src/lib/handoff-guard.mjs).
          guardrails: {
            protectedNames: [...PROTECTED_NAMES].sort(),
            rules: GUARD_RULES,
            descriptions: GUARD_DESCRIPTIONS,
            note:
              'These operations are refused by the SERVER as well as hidden here: deleting or renaming a contract ' +
              'element, un-pinning `close`, adding a `shortcut` to a parked element, `effect` on a `buttonType`.',
          },
          handoff: {
            root: pageHandoffRoot,
            pendingCount: pending.pendingCount,
            totalCount: pending.totalCount,
            invalidCount: pending.invalidCount,
            submissions: pending.handoffs.slice(0, 20),
          },
        });
      }

      // -------------------------------------------------------------------- assets
      if (request.method === 'GET' && route === '/api/assets') {
        const index = assetIndex();
        const results = searchSprites(index, {
          query: url.searchParams.get('q') ?? '',
          kind: url.searchParams.get('kind') ?? undefined,
          minWidth: numberOrUndefined(url.searchParams.get('min_width')),
          maxWidth: numberOrUndefined(url.searchParams.get('max_width')),
          minHeight: numberOrUndefined(url.searchParams.get('min_height')),
          maxHeight: numberOrUndefined(url.searchParams.get('max_height')),
          limit: numberOrUndefined(url.searchParams.get('limit')) ?? 40,
        });
        return sendJson(response, 200, { query: url.searchParams.get('q') ?? '', count: results.length, results });
      }

      if (request.method === 'GET' && route === '/api/sprite') {
        const name = url.searchParams.get('name');
        if (!name) return sendJson(response, 400, { error: '`name` is required' });
        const index = assetIndex();
        return sendJson(response, 200, spriteInfo(index, name));
      }

      // A real decoded texture thumbnail, straight from the mip chain.
      if (request.method === 'GET' && route === '/api/thumb') {
        const name = url.searchParams.get('name');
        const size = Math.min(Math.max(numberOrUndefined(url.searchParams.get('size')) ?? 64, 8), 512);
        const index = assetIndex();
        const sprite = index.sprites[name];
        if (!sprite?.textureFile) return sendJson(response, 404, { error: `no texture for sprite \`${name}\`` });
        const absolute = resolveTexturePath(index.root, sprite.textureFile);
        if (!absolute) return sendJson(response, 404, { error: `texture file not found: ${sprite.textureFile}` });
        const decoded = decodeTextureThumbnail(absolute, size);
        if (!decoded.ok) return sendJson(response, 404, { error: decoded.reason });
        const scale = Math.min(1, size / Math.max(decoded.width, decoded.height));
        const width = Math.max(1, Math.round(decoded.width * scale));
        const height = Math.max(1, Math.round(decoded.height * scale));
        const rgba = width === decoded.width ? decoded.rgba : resizeRgba(decoded.rgba, decoded.width, decoded.height, width, height);
        const png = encodePng(rgba, width, height, { level: 6 });
        response.writeHead(200, {
          'content-type': 'image/png',
          'content-length': png.length,
          'cache-control': 'public, max-age=3600',
        });
        return response.end(png);
      }

      // -------------------------------------------------------------------- layout
      if (request.method === 'GET' && route === '/api/layout') {
        const { id, layout } = resolveLayoutById(url.searchParams.get('id'));
        return sendJson(response, 200, describeLayout(id, layout, context, assetIndex(), locksFor(layout), changeReport(id, layout)));
      }

      if (request.method === 'POST' && route === '/api/layout') {
        const body = await readJsonBody(request);
        if (!body.layout || typeof body.layout !== 'object') {
          return sendJson(response, 400, { error: '`layout` (an object) is required' });
        }
        const id = body.id ?? context.nextLayoutId(body.layout.name ?? 'edited');
        const existing = context.layouts.get(id);
        if (existing) rememberPrevious(id, existing, 'the revision before /api/layout replaced it');
        context.layouts.set(id, {
          layout: body.layout,
          createdAt: new Date().toISOString(),
          source: 'web-ui',
        });
        context.lastLayoutId = id;
        return sendJson(response, 200, describeLayout(id, body.layout, context, null, locksFor(body.layout), changeReport(id, body.layout)));
      }

      if (request.method === 'POST' && route === '/api/edit') {
        const body = await readJsonBody(request);
        const { id, layout } = resolveLayoutById(body.id);
        const edits = Array.isArray(body.edits) ? body.edits : [];
        if (edits.length === 0) return sendJson(response, 400, { error: '`edits` must be a non-empty array' });
        const customGuiWindows = customGuiWindowsFor(layout, body.custom_gui_windows ?? []);
        const result =
          body.guard === false
            ? { ...applyEdits(layout, edits), refused: [], guardrails: { disabled: true, allowed: true, refusedCount: 0 }, violations: null }
            : guardedEdit(layout, edits, {
                applyEdits,
                customGuiWindows,
                validationContext: { customGuiWindows, checkAssets: false, checkLocalisation: false },
              });
        // A refused batch is NOT a server error: the request was well-formed and the refusal is the
        // answer. 200 with `refused[]` lets the page paint the reason next to the element, which a
        // 4xx would not.
        if ((result.refused ?? []).length === 0 && body.store !== false) {
          const existing = context.layouts.get(id);
          if (existing && existing.layout !== result.layout) rememberPrevious(id, existing, 'the revision before the page edited it');
          context.layouts.set(id, { layout: result.layout, createdAt: new Date().toISOString(), source: 'web-ui' });
          context.lastLayoutId = id;
        }
        return sendJson(response, 200, {
          id,
          applied: result.applied,
          failed: result.failed,
          refused: result.refused ?? [],
          guardrails: result.guardrails,
          guardrailViolations: result.violations
            ? {
                verdict: result.violations.verdict,
                clear: result.violations.clear,
                summary: result.violations.summary ?? null,
                introduced: result.violations.introduced,
                introducedHard: result.violations.introducedHard,
                introducedSoft: result.violations.introducedSoft,
                resolved: result.violations.resolved,
              }
            : null,
          ...(body.guard === false ? { guardDisabled: true } : {}),
          ...describeLayout(id, result.layout, context, null, locksFor(result.layout), changeReport(id, result.layout)),
        });
      }

      // -------------------------------------------------------------------- validate
      if (request.method === 'POST' && route === '/api/validate') {
        const body = await readJsonBody(request);
        const { id, layout } = resolveLayoutById(body.id);
        const index = body.check_assets === false ? null : assetIndex();
        const customGuiWindows = customGuiWindowsFor(layout, body.custom_gui_windows ?? []);
        const report = validateLayout(layout, {
          assets: index,
          localisation: body.check_localisation === false ? null : context.localisation ?? null,
          // The install root, so the validator can measure the RENDERED text extent from the
          // engine's own font descriptors rather than reasoning about boxes alone.
          gameRoot: context.gameRoot,
          options: {
            ...(body.overlap_tolerance !== undefined ? { overlapTolerance: body.overlap_tolerance } : {}),
            ...(body.overlap_area_ratio !== undefined ? { overlapAreaRatio: body.overlap_area_ratio } : {}),
            ...(body.flag_transparent_overlaps !== undefined ? { flagTransparentOverlaps: body.flag_transparent_overlaps } : {}),
            ...(body.measure_text !== undefined ? { measureText: body.measure_text } : {}),
            ...(body.language !== undefined ? { language: body.language } : {}),
            customGuiWindows,
          },
        });
        const guardrails = scanContractViolations(layout, { customGuiWindows, assets: assetIndex(), checkLocalisation: false });
        return sendJson(response, 200, {
          id,
          ...report,
          customGuiWindows,
          guardrails: { byRule: guardrails.byRule, hard: guardrails.hard, soft: guardrails.soft },
        });
      }

      // -------------------------------------------------------------------- diff (reverse path)
      if (request.method === 'GET' && route === '/api/diff') {
        const { id, layout } = resolveLayoutById(url.searchParams.get('id'));
        const againstId = url.searchParams.get('against');
        if (againstId) {
          const other = context.layouts.get(againstId);
          if (!other) return sendJson(response, 404, { error: `unknown layout id \`${againstId}\`` });
          const diff = diffLayouts(other.layout, layout, { beforeId: againstId, afterId: id, beforeLabel: 'compared revision' });
          return sendJson(response, 200, {
            id,
            against: { id: againstId, name: other.layout.name, elementCount: diff.before.elementCount },
            changeCount: diff.changeCount,
            counts: diff.counts,
            changedPaths: diff.changedPaths,
            changes: diff.changes,
            variableChanges: diff.variableChanges,
            unchanged: diff.unchanged,
            summary: summariseDiff(diff),
            markdown: formatDiffMarkdown(diff, { title: `Changes to \`${layout.name ?? id}\`` }),
          });
        }
        return sendJson(response, 200, { id, ...changeReport(id, layout) });
      }

      // -------------------------------------------------------------------- preview
      if (request.method === 'GET' && route === '/api/preview.svg') {
        const { id, layout } = resolveLayoutById(url.searchParams.get('id'));
        const index = assetIndex();
        // `changes=true` outlines the elements that differ from the compared revision - the agent's
        // changes, shown to the human. `changes=paths` does the same with an explicit list.
        const changesParam = url.searchParams.get('changes');
        const explicit = changesParam && changesParam !== 'true' && changesParam !== 'false' ? changesParam.split(',').filter(Boolean) : null;
        const changedPaths = explicit ?? (changesParam === 'true' ? changeReport(id, layout).changedPaths : []);
        const result = renderSvg(layout, {
          assets: index,
          cache,
          gameRoot: context.gameRoot,
          showGrid: url.searchParams.get('grid') !== 'false',
          validationReport: url.searchParams.get('findings') === 'true' ? validateLayout(layout, { assets: index, gameRoot: context.gameRoot, localisation: context.localisation ?? null, options: { customGuiWindows: customGuiWindowsFor(layout) } }) : null,
          highlightChanges: changedPaths,
          ...(context.localisation?.values
            ? { resolveLocalisation: (key) => context.localisation.values.get(key) ?? null, localisationValues: context.localisation.values }
            : {}),
        });
        return sendText(response, 200, result.svg, 'image/svg+xml; charset=utf-8');
      }

      if (request.method === 'POST' && route === '/api/preview') {
        const body = await readJsonBody(request);
        const { id, layout } = resolveLayoutById(body.id);
        const index = assetIndex();
        const report = body.with_validation === false ? null : validateLayout(layout, { assets: index, gameRoot: context.gameRoot, localisation: context.localisation ?? null });
        const change = changeReport(id, layout);
        const locValues = context.localisation?.values ?? null;
        const options = {
          assets: index,
          cache,
          gameRoot: context.gameRoot,
          validationReport: report,
          highlightRules: body.highlight_rules ?? null,
          highlightChanges: body.highlight_changes === true ? change.changedPaths : body.highlight_changes ?? [],
          showGrid: body.show_grid !== false,
          ...(body.language !== undefined ? { language: body.language } : {}),
          // When the localisation values are loaded, the preview measures and draws the rendered
          // text extent as well; without them there is no string to measure, and the SVG says so.
          ...(locValues
            ? { resolveLocalisation: (key) => locValues.get(key) ?? null, localisationValues: locValues }
            : {}),
        };
        const svg = renderSvg(layout, options);
        const outputDir = ensureDir(body.output_dir ? resolve(body.output_dir) : join(defaultOutputRoot(), 'web-preview'));
        const svgPath = join(outputDir, 'preview.svg');
        const png = renderPng(layout, { ...options, scale: body.png_scale ?? 0.5 });
        const pngPath = join(outputDir, 'preview.png');
        writeFileSync(svgPath, svg.svg, 'utf8');
        writeFileSync(pngPath, png.png);
        return sendJson(response, 200, {
          id,
          outputDir,
          svgPath,
          pngPath,
          svgBytes: Buffer.byteLength(svg.svg, 'utf8'),
          pngBytes: png.png.length,
          pngDimensions: { width: png.width, height: png.height },
          stats: svg.stats,
          validation: report ? { verdict: report.verdict, counts: report.counts, byRule: report.byRule } : null,
          changes: { comparedWith: change.comparedWith, changeCount: change.changeCount, counts: change.counts, changedPaths: change.changedPaths },
        });
      }

      // -------------------------------------------------------------------- export
      if (request.method === 'POST' && route === '/api/export') {
        const body = await readJsonBody(request);
        const { id, layout } = resolveLayoutById(body.id);
        // The page must supply a path. Defaulting silently here would risk writing somewhere the
        // user did not choose, which the standalone-output rule forbids.
        if (!body.output_root) {
          return sendJson(response, 400, {
            error: 'output_root is required',
            note:
              'All emitted files go to an explicit output directory. Pass the absolute path you want them under; ' +
              'a game install, the user-data folder, or any folder containing descriptor.mod is refused.',
            suggested: join(defaultOutputRoot(), layout.name ?? 'custom_gui'),
          });
        }
        let root;
        try {
          root = assertOutputRoot(body.output_root);
        } catch (thrown) {
          return sendJson(response, 400, { error: thrown.message });
        }
        const result = emitFiles(layout, {
          outputRoot: root,
          dryRun: false,
          fileStem: body.file_stem ?? layout.name,
          language: body.language ?? 'english',
          ...(body.diplomatic !== undefined ? { diplomatic: body.diplomatic } : {}),
        });
        return sendJson(response, 200, { id, ...result });
      }

      // -------------------------------------------------------------------- handoff
      if (request.method === 'POST' && route === '/api/handoff/submit') {
        const body = await readJsonBody(request);
        const { id, layout } = resolveLayoutById(body.id);
        const customGuiWindows = customGuiWindowsFor(layout, body.custom_gui_windows ?? []);
        // VALIDATE ON SUBMIT. The verdict travels with the submission, so an invalid layout can
        // never be mistaken for a new baseline - and the page shows the human the verdict before
        // they walk away from the screen.
        const report = validateLayout(layout, {
          assets: assetIndex(),
          localisation: context.localisation ?? null,
          gameRoot: context.gameRoot,
          options: { customGuiWindows },
        });
        const guardrails = scanContractViolations(layout, { customGuiWindows, assets: assetIndex(), checkLocalisation: false });
        const previous = context.previousRevisions.get(id);
        const record = submitHandoff({
          layout,
          baseline: previous?.layout ?? null,
          baselineLayoutId: previous?.id ?? null,
          layoutId: id,
          submittedBy: body.submitted_by ?? 'human (web UI)',
          note: body.note,
          validation: {
            verdict: report.verdict,
            counts: report.counts,
            byRule: report.byRule,
            guardrailVerdict: (guardrails.hard ?? []).length > 0 ? 'fail' : (guardrails.soft ?? []).length > 0 ? 'warn' : 'pass',
            assetsChecked: report.assetsChecked,
            localisationChecked: report.localisationChecked,
            buttonEffectsChecked: report.buttonEffectsChecked,
          },
          guardrails: { byRule: guardrails.byRule, hard: guardrails.hard, soft: guardrails.soft },
          layoutIds: [id, previous?.id].filter(Boolean),
          fileStem: body.file_stem ?? layout.name,
          language: body.language ?? 'english',
          emit: body.emit !== false,
          handoff_root: body.handoff_root ?? pageHandoffRoot,
        });
        // The submitted revision becomes the baseline again: a second submit diffs from THIS one,
        // which is what "the layout as it was loaded" means for a session that keeps going.
        context.previousRevisions.set(id, {
          id: `${record.id} (submitted)`,
          source: `handoff ${record.id}, submitted from the page`,
          layout,
          recordedAt: new Date().toISOString(),
          submitted: true,
        });
        const pending = pendingHandoffs({ handoff_root: body.handoff_root ?? pageHandoffRoot, limit: 50 });
        return sendJson(response, 200, {
          id,
          handoff: record,
          verdict: report.verdict,
          validation: { verdict: report.verdict, counts: report.counts, byRule: report.byRule },
          guardrails: { byRule: guardrails.byRule, hard: guardrails.hard, soft: guardrails.soft },
          invalid: record.invalid,
          flagged: record.flagged,
          handoffRoot: record.directory,
          pendingCount: pending.pendingCount,
          message: record.invalid
            ? `Submitted to the agent, MARKED INVALID (${report.counts.error} errors). The agent will see the verdict before using it.`
            : `Submitted to the agent: ${record.diff?.summary ?? 'no changes'} -> ${record.directory}`,
        });
      }

      if (request.method === 'GET' && route === '/api/handoff/pending') {
        const handoffRoot = url.searchParams.get('handoff_root') ?? pageHandoffRoot;
        const pending = pendingHandoffs({ handoff_root: handoffRoot, limit: numberOrUndefined(url.searchParams.get('limit')) ?? 50 });
        return sendJson(response, 200, { ...pending, root: pending.root });
      }

      if (request.method === 'GET' && route === '/api/handoff') {
        const listed = listHandoffs({
          handoff_root: url.searchParams.get('handoff_root') ?? pageHandoffRoot,
          pending_only: url.searchParams.get('pending_only') === 'true',
          include_diff: url.searchParams.get('include_diff') !== 'false',
          limit: numberOrUndefined(url.searchParams.get('limit')) ?? 20,
          id: url.searchParams.get('id') ?? undefined,
        });
        return sendJson(response, 200, listed);
      }

      return sendJson(response, 404, { error: `no route for ${request.method} ${route}` });
    } catch (thrown) {
      return sendJson(response, 500, { error: thrown instanceof Error ? thrown.message : String(thrown) });
    }
  });

  // Try the requested port and then the next few, so a busy port is not a hard failure.
  let address = null;
  let lastError = null;
  for (let offset = 0; offset < 20 && !address; offset += 1) {
    try {
      address = await listen(server, host, requestedPort + offset);
    } catch (thrown) {
      lastError = thrown;
      if (thrown.code !== 'EADDRINUSE') throw thrown;
    }
  }
  if (!address) {
    throw new Error(`could not bind ${host}:${requestedPort}..${requestedPort + 19}: ${lastError?.message ?? 'unknown'}`);
  }

  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}/`;
  return {
    server,
    host,
    port: address.port,
    url,
    pagePath: PAGE_PATH,
    startedAt,
    describe() {
      const pending = pendingHandoffs({ handoff_root: pageHandoffRoot, limit: 50 });
      return {
        running: true,
        url,
        host,
        port: address.port,
        startedAt,
        pageHits,
        currentLayoutId: currentLayoutId(),
        layouts: [...context.layouts.entries()].map(([id, entry]) => ({ id, name: entry.layout.name })),
        cacheRoot,
        handoff: { root: pageHandoffRoot, pendingCount: pending.pendingCount, totalCount: pending.totalCount, invalidCount: pending.invalidCount },
        note:
          'Local authoring page. It shares the running server\'s layout state, so edits here are visible to the MCP tools. ' +
          'The "Submit to agent" button writes the current layout, its provenance diff and its validation verdict to ' +
          `${pageHandoffRoot}, where gui_handoff_list / gui_handoff_pick find it.`,
      };
    },
    close() {
      return new Promise((resolvePromise) => server.close(() => resolvePromise()));
    },
  };
}

function numberOrUndefined(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function resolveTexturePath(root, textureFile) {
  const normalised = String(textureFile).replace(/\\/g, '/').replace(/^\/+/, '');
  const candidate = join(root, ...normalised.split('/'));
  try {
    readFileSync(candidate, { flag: 'r' });
    return candidate;
  } catch {
    return null;
  }
}

/** The layout plus its computed rects, which the page draws and lists. */
function describeLayout(id, layout, context, index = null, locks = null, change = null) {
  const preview = renderSvg(layout, {
    assets: index,
    spriteLookup: makeSpriteLookup(index),
    showGrid: false,
    includeTable: false,
    showText: false,
    highlightChanges: change?.changedPaths ?? [],
  });
  const changedPaths = new Set(change?.changedPaths ?? []);
  const lockByPath = new Map((locks?.locks ?? []).map((entry) => [entry.path, entry]));
  const elements = [];
  walkLayout(layout.root, (node, parent, depth, path) => {
    const lock = lockByPath.get(path) ?? null;
    elements.push({
      path,
      id: node.id ?? null,
      name: node.name ?? null,
      kind: node.kind ?? null,
      depth,
      parent: parent?.id ?? null,
      childCount: (node.children ?? []).length,
      sprite: node.quadTextureSprite ?? node.spriteType ?? node.background?.sprite ?? null,
      text: node.text ?? node.buttonText ?? null,
      font: node.font ?? node.buttonFont ?? null,
      effect: node.effect ?? null,
      orientation: node.orientation ?? null,
      origo: node.origo ?? null,
      position: node.position ?? null,
      size: node.size ?? null,
      // The guardrails, per element, so the page never has to re-derive the policy.
      locked: Boolean(lock),
      lockReason: lock?.reason ?? null,
      windowContainer: Boolean(lock?.windowContainer),
      close: Boolean(lock?.close),
      changed: changedPaths.has(path),
    });
  });
  const rectByPath = new Map(preview.table.map((row) => [row.path, row]));
  const rects = preview.table.map((row) => ({
    ...row,
    ...(lockByPath.has(row.path) ? { locked: true } : {}),
    ...(changedPaths.has(row.path) ? { changed: true } : {}),
  }));
  return {
    id,
    layout,
    name: layout.name,
    baseResolution: layout.baseResolution ?? BASE_RESOLUTION,
    variables: layout.variables ?? {},
    elements,
    rects,
    elementCount: elements.length,
    assetIndexRoot: context.assetIndex?.root ?? null,
    customGuiWindows: locks?.customGuiWindows ?? [],
    locks: locks?.locks ?? [],
    protectedCount: (locks?.locks ?? []).length,
    change: change
      ? {
          comparedWith: change.comparedWith ?? null,
          changeCount: change.changeCount ?? 0,
          counts: change.counts ?? {},
          changedPaths: change.changedPaths ?? [],
          summary: change.summary ?? null,
          unchanged: change.unchanged ?? true,
        }
      : null,
    rectCount: preview.table.length,
  };
}

export default { startWebUi };
