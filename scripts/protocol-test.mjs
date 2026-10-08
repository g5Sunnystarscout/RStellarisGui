#!/usr/bin/env node
//------------------------------------------------------------------------------------
// protocol-test.mjs -- Part of RStellarisGui
//
// Drives the real MCP server as a child process over the stdio transport, which is the only
// path an MCP client ever uses. The selftest exercises the registry in-process; this script
// proves the newline-delimited JSON-RPC framing, the handshake, the error mapping and a tool
// chain that touches the filesystem, including the encoding rules and the output-root guard.
//
// This mirrors RStellarisScribe's scripts/protocol-test.mjs.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = join(projectRoot, '.protocol-test');
const outputRoot = join(scratch, 'out');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ok   ${name}\n`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
    process.stdout.write(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}\n`);
  }
}

function main() {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const child = spawn(process.execPath, [join(projectRoot, 'src', 'index.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  let stderr = '';
  const pending = new Map();
  let nextId = 1;

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === '') continue;
      const message = JSON.parse(line);
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    }
  });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timed out waiting for ${method}`));
      }, 120000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });

  const notify = (method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  };

  /** Call a tool and parse its single text content block as JSON. */
  const callTool = async (name, args) => {
    const response = await request('tools/call', { name, arguments: args });
    if (response.error) return { __error: response.error };
    const content = response.result.content;
    const textBlock = content.find((block) => block.type === 'text');
    let parsed = null;
    try {
      parsed = textBlock ? JSON.parse(textBlock.text) : null;
    } catch {
      parsed = { __raw: textBlock?.text };
    }
    return { ...parsed, __content: content, __isError: response.result.isError };
  };

  return (async () => {
    process.stdout.write('stdio MCP transport\n');

    // ---------------------------------------------------------------- handshake
    const init = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'protocol-test', version: '1' },
    });
    check('initialize answers over the pipe', init.result?.serverInfo?.name === 'rstellarisgui', JSON.stringify(init.result?.serverInfo));
    check('server reports a version', typeof init.result.serverInfo.version === 'string');
    check('capabilities include tools', 'tools' in init.result.capabilities);
    check(
      'instructions state the base resolution',
      typeof init.result.instructions === 'string' && /1920x1080/.test(init.result.instructions),
      'no base resolution in instructions',
    );
    check(
      'instructions warn against writing into a mod workspace',
      /descriptor\.mod/.test(init.result.instructions ?? ''),
      'no output-root rule in instructions',
    );

    notify('notifications/initialized');

    const ping = await request('ping', {});
    check('ping answers', ping.result !== undefined);

    // ---------------------------------------------------------------- tools/list
    const toolList = await request('tools/list', {});
    const tools = toolList.result.tools;
    check('tools/list arrives over the pipe', tools.length >= 13, `count=${tools.length}`);
    check('every tool carries an input schema', tools.every((tool) => tool.inputSchema?.type === 'object'));
    const names = tools.map((tool) => tool.name);
    for (const required of [
      'gui_assets_search',
      'gui_assets_sprite_info',
      'gui_layout_new',
      'gui_layout_edit',
      'gui_layout_validate',
      'gui_layout_preview',
      'gui_emit_files',
      'gui_web_ui_start',
      'gui_web_ui_stop',
    ]) {
      check(`the ${required} tool is registered`, names.includes(required), names.join(','));
    }
    check(
      'every tool has a substantial description',
      tools.every((tool) => typeof tool.description === 'string' && tool.description.length > 40),
      tools.filter((tool) => (tool.description ?? '').length <= 40).map((tool) => tool.name).join(','),
    );

    // ---------------------------------------------------------------- assets
    const defaults = await callTool('gui_assets_defaults', {});
    check('gui_assets_defaults returns the part box', defaults.sprites?.length === 5, JSON.stringify(defaults.sprites?.length));
    check('every default sprite is present in the install', defaults.sprites.every((sprite) => sprite.present === true), JSON.stringify(defaults.sprites?.filter((s) => !s.present)));
    check('the default fonts resolve', defaults.fonts?.every((font) => font.file), JSON.stringify(defaults.fonts));

    const search = await callTool('gui_assets_search', { query: 'close_button', limit: 5 });
    check('gui_assets_search returns results over the pipe', search.resultCount >= 1, JSON.stringify(search));
    check('search results carry real texture sizes', search.results.every((sprite) => sprite.width === null || sprite.width > 0));

    const spriteInfo = await callTool('gui_assets_sprite_info', { name: 'GFX_tile_large_bg' });
    check('gui_assets_sprite_info finds a known sprite', spriteInfo.found === true, JSON.stringify(spriteInfo).slice(0, 200));
    check('sprite info carries the defining file:line', typeof spriteInfo.definedAt?.file === 'string' && spriteInfo.definedAt.line > 0);
    check('sprite info carries the texture format', typeof spriteInfo.texture?.format === 'string', JSON.stringify(spriteInfo.texture));

    const missing = await callTool('gui_assets_sprite_info', { name: 'GFX_this_does_not_exist' });
    check('a wrong sprite name returns found:false with suggestions', missing.found === false && Array.isArray(missing.suggestions));
    check('the missing-sprite hint tells the agent not to emit it', /do not emit/i.test(missing.hint ?? ''), missing.hint);

    // ---------------------------------------------------------------- layout chain
    const created = await callTool('gui_layout_new', { name: 'pipetest_window', template: 'option_list' });
    check('gui_layout_new returns a layout_id', typeof created.layout_id === 'string', created.layout_id);
    check('the new layout has elements', created.elementCount >= 6, String(created.elementCount));
    check('the new layout declares an effect', created.effects.length === 1, JSON.stringify(created.effects));
    const layoutId = created.layout_id;

    const edited = await callTool('gui_layout_edit', {
      layout_id: layoutId,
      edits: [
        { op: 'add', parent: 'pipetest_window', node: { kind: 'icon', name: 'pipe_icon', spriteType: 'GFX_vote_balance_supporting_dot', position: { x: 30, y: 300 }, size: { width: 9, height: 10 } } },
        { op: 'set', target: 'pipe_icon', path: 'position.y', value: 320 },
        { op: 'set_variable', name: '@pipe_pad', value: '12' },
      ],
    });
    check('gui_layout_edit applies a batch', edited.applied?.length === 3 && edited.failed?.length === 0, JSON.stringify({ applied: edited.applied?.length, failed: edited.failed }));
    check('the edited node is in the tree', edited.elements.some((element) => element.name === 'pipe_icon'));

    const badEdit = await callTool('gui_layout_edit', { layout_id: layoutId, edits: [{ op: 'remove', target: 'no_such_element' }] });
    check('a bad edit is reported, not fatal', badEdit.failed?.length === 1 && badEdit.applied?.length === 0, JSON.stringify(badEdit.failed));

    const validate = await callTool('gui_layout_validate', { layout_id: layoutId });
    check('gui_layout_validate returns a verdict', validate.verdict === 'pass' || validate.verdict === 'fail', validate.verdict);
    check('the report states the base resolution', validate.baseResolution?.width === 1920, JSON.stringify(validate.baseResolution));
    check('the report states the geometry assumption', /base resolution/.test(validate.geometryAssumption ?? ''), String(validate.geometryAssumption).slice(0, 60));
    check('the report counts findings by severity', typeof validate.counts?.error === 'number');
    check('a validating layout reports no errors', validate.counts.error === 0, JSON.stringify(validate.findings?.filter((f) => f.severity === 'error').slice(0, 3)));
    check(
      'OPTION_TEXT is not reported as a missing key',
      !(validate.findings ?? []).some((finding) => finding.rule === 'missing-localisation' && finding.key === 'OPTION_TEXT'),
      JSON.stringify(validate.findings?.filter((f) => f.rule === 'missing-localisation').map((f) => f.key)),
    );

    // ---------------------------------------------------------------- the BAR, over the pipe
    //
    // The whole point of the primitive is that an agent asks for a bar and gets the reference's
    // construction, so this chain is what proves the component survives the MCP boundary: add one,
    // then a CLONE of it, and check the emitted file carries the five elements for each with the
    // reference's own sprites.
    const barSpec = await callTool('gui_bar_spec', {});
    check('gui_bar_spec returns the construction', barSpec.construction?.elements?.length === 5, JSON.stringify(barSpec.construction?.elements?.length));
    check('gui_bar_spec returns the band transcription', barSpec.bandElements?.length === 8, String(barSpec.bandElements?.length));
    check('gui_bar_spec returns the field help', Object.keys(barSpec.api?.fields ?? {}).length >= 25, String(Object.keys(barSpec.api?.fields ?? {}).length));
    check('gui_bar_spec returns the offsets relative to the track', barSpec.api?.offsets?.length === 5, JSON.stringify(barSpec.api?.offsets));
    check(
      'the track and fill offsets are the reference\'s own (0,0 and +2,+4)',
      barSpec.api.offsets.find((o) => o.role === 'track')?.dx === 0 &&
        barSpec.api.offsets.find((o) => o.role === 'fill')?.dx === 2 &&
        barSpec.api.offsets.find((o) => o.role === 'fill')?.dy === 4,
      JSON.stringify(barSpec.api.offsets),
    );
    check('every bar rule and its severity is returned', Array.isArray(barSpec.rules) && barSpec.rules.length >= 10 && barSpec.rules.every((rule) => typeof rule.rule === 'string' && typeof rule.severity === 'string'), String(barSpec.rules?.length));
    check(
      'the constraint says the fill length is static and text cannot move a rectangle',
      /STATIC|static/.test(barSpec.constraint?.fill ?? '') && /TEXT CANNOT MOVE A RECTANGLE/.test(barSpec.constraint?.label ?? ''),
      JSON.stringify(barSpec.constraint),
    );

    const added = await callTool('gui_layout_add', {
      layout_id: layoutId,
      parent: 'pipetest_window',
      elements: [
        {
          kind: 'bar',
          name: 'pipe_bar_1_main',
          position: { x: 240, y: 400 },
          width: 400,
          height: 20,
          value: 383,
          max: 400,
          rowLabel: 'PIPE_BAR_NAME',
          valueText: 'PIPE_BAR_VALUE',
          valueColour: 'Y',
          seats: 'PIPE_BAR_SEATS',
          seatsColour: 'E',
        },
        { kind: 'bar', name: 'pipe_bar_2_main', cloneOf: 'pipe_bar_1_main', position: { x: 240, y: 424 }, value: 350, rowLabel: 'PIPE_BAR_NAME' },
      ],
    });
    check('gui_layout_add reports both additions and refuses nothing', added.applied?.length === 2 && added.failed?.length === 0 && !added.refused, JSON.stringify({ applied: added.applied?.length, refused: added.refused, failed: added.failed }));
    check('gui_layout_add returns the rect each addition landed on', Array.isArray(added.added) && added.added.length === 10, String(added.added?.length));
    check(
      "the rect table names the bar's pieces by the component's own convention (unga_power_track_1_main, not _1_track)",
      added.added.some((row) => row.name === 'pipe_bar_track_1_main') && added.added.some((row) => row.name === 'pipe_bar_fill_1_main'),
      JSON.stringify(added.added.map((row) => row.name)),
    );
    check(
      'and each row says which piece of the component it is',
      added.added.filter((row) => row.component === 'bar-track').length === 2 && added.added.filter((row) => row.component === 'bar-fill').length === 2,
      JSON.stringify(added.added.map((row) => `${row.name}:${row.component ?? '-'}`)),
    );
    check('gui_layout_add reports the bar geometry without a second call', added.bars?.length === 2, String(added.bars?.length));
    check(
      'the clone inherited the track width from its source rather than its own default',
      added.bars.every((bar) => bar.track.width === 400 && bar.track.sprite === 'GFX_tiles_dark_area_cut_8' && bar.fill.sprite === 'gfx_transparency_white'),
      JSON.stringify(added.bars),
    );
    check(
      "and the clone's fill is the proportion of the INSET CAP, not of the track",
      added.bars.find((bar) => bar.name === 'pipe_bar_2_main')?.fill.width === Math.round(396 * (350 / 400)),
      JSON.stringify(added.bars.find((bar) => bar.name === 'pipe_bar_2_main')),
    );

    const barValidated = await callTool('gui_layout_validate', { layout_id: added.layout_id, check_assets: false });
    check(
      'the added bars validate without a bar error',
      !(barValidated.findings ?? []).some((finding) => String(finding.rule).startsWith('bar-') && finding.severity === 'error'),
      JSON.stringify((barValidated.findings ?? []).filter((finding) => String(finding.rule).startsWith('bar-') && finding.severity === 'error')),
    );

    // A dry run reports a PLAN, not the file bodies, so the emitted text is read back from a real
    // write into this test's own scratch output root. Reading the file rather than the plan is the
    // point: the plan can name the right elements while the TEXT carries a `bar = {` block.
    const barOut = join(outputRoot, 'BarProbeMod');
    const barEmitted = await callTool('gui_emit_files', { layout_id: added.layout_id, output_root: barOut, dry_run: false, language: 'english' });
    check('the bar batch emits without an error', barEmitted.dryRun === false && barEmitted.fileCount >= 1, JSON.stringify({ dryRun: barEmitted.dryRun, fileCount: barEmitted.fileCount }));
    const emittedGuiFiles = existsSync(barOut)
      ? (function walk(dir) {
          const found = [];
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) found.push(...walk(full));
            else if (entry.name.endsWith('.gui')) found.push(full);
          }
          return found;
        })(barOut)
      : [];
    check('the emit wrote a .gui file to read back', emittedGuiFiles.length >= 1, JSON.stringify({ barOut, emittedGuiFiles }));
    const barText = emittedGuiFiles.length > 0 ? readFileSync(emittedGuiFiles[0], 'utf8') : '';
    check('the emitted file carries both tracks', barText.includes('pipe_bar_track_1_main') && barText.includes('pipe_bar_track_2_main'), barText.slice(0, 200));
    check(
      "the emitted file carries the reference's two sprites and the inset arithmetic",
      barText.includes('quadTextureSprite = "GFX_tiles_dark_area_cut_8"') && barText.includes('quadTextureSprite = "gfx_transparency_white"'),
      barText.slice(barText.indexOf('pipe_bar_track_1_main'), barText.indexOf('pipe_bar_track_1_main') + 240),
    );
    check(
      'the emitted file carries no `bar = {` block, because a bar is not an engine keyword',
      !/^\s*bar\s*=\s*\{/m.test(barText),
    );
    check(
      'the emitted file carries no component plumbing',
      !/component\s*=|barGeometry\s*=|cloneOf\s*=|valueText\s*=/.test(barText),
      barText.slice(barText.indexOf('pipe_bar_track_1_main'), barText.indexOf('pipe_bar_track_1_main') + 300),
    );

    // A bar that asks for a live fill: the tool adds it (the guardrails block STRUCTURAL damage, not
    // findings), and the bar rule then reports it as an ERROR, which is what stops it being emitted
    // unexamined. Asserting the finding rather than a refusal is the honest shape - a width the
    // engine cannot read as a literal is a finding about the FILE, and `gui_layout_validate` is where
    // it lives. The width is a percentage rather than an `@variable`: this template DECLARES
    // `@window_width`, so that variable resolves to a number and is perfectly legal.
    //
    // A bar whose width cannot be read still emits the pieces whose positions do not depend on it -
    // its row label, the track and the fill - and drops the value/seats columns, whose x is derived
    // from the track width. So this emits three pieces where a well-formed bar emits five; the point
    // of the check is that the file stays LEGAL and the error is reported, not that it is complete.
    const liveFill = await callTool('gui_layout_add', {
      layout_id: added.layout_id,
      parent: 'pipetest_window',
      elements: [{ kind: 'bar', name: 'pipe_bar_live_main', position: { x: 0, y: 500 }, width: '100%%', height: 20, value: 10, max: 100, rowLabel: 'PIPE_BAR_NAME' }],
    });
    check('a bar with a non-literal width is added, and the tool reports where it landed', liveFill.applied?.length === 1 && liveFill.added?.length === 3, JSON.stringify({ applied: liveFill.applied?.length, added: liveFill.added?.length }));
    check(
      'and the pieces it emitted are the row label, the track and the fill - no column whose x depends on the unreadable width',
      liveFill.added?.length === 3 && liveFill.added.every((row) => ['bar-track', 'bar-fill', 'bar-label'].includes(row.component)) && !liveFill.added.some((row) => row.name.endsWith('_value')),
      JSON.stringify(liveFill.added.map((row) => `${row.name}:${row.component}`)),
    );
    // The bar is EXPANDED in place the moment it is added, so re-validating the stored layout sees
    // the pieces rather than the `bar` node and cannot re-report what the expansion already judged.
    // The rule is therefore checked by validating a fresh tree over the pipe, which is also the shape
    // a caller uses to check one before adding it.
    const liveReport = await callTool('gui_layout_validate', {
      layout: {
        schema: 'rstellarisgui/layout@1',
        name: 'bar_live_probe',
        baseResolution: { width: 1920, height: 1080 },
        root: { id: 'root', kind: 'container', name: 'bar_live_probe', position: { x: 0, y: 0 }, size: { width: 900, height: 400 }, children: [{ id: 'live', kind: 'bar', name: 'live_bar_main', position: { x: 0, y: 0 }, width: '100%%', height: 20, value: 10, max: 100 }] },
      },
      check_assets: false,
      check_localisation: false,
    });
    const liveFinding = (liveReport.findings ?? []).find((finding) => finding.rule === 'bar-track-width-not-static');
    check(
      'validating a bar with a non-literal width reports an ERROR with the rule id, so the misuse is not silent',
      liveFinding?.severity === 'error',
      JSON.stringify((liveReport.findings ?? []).filter((finding) => String(finding.rule).startsWith('bar-'))),
    );
    check(
      'the finding says the width must be a plain pixel number and suggests one',
      /pixel number/.test(liveFinding?.message ?? '') && /width = 400/.test(liveFinding?.suggestedFix ?? ''),
      `${liveFinding?.message} // ${liveFinding?.suggestedFix}`,
    );

    // A deliberately broken layout must produce errors with coordinates and fixes.
    const broken = await callTool('gui_layout_edit', {
      layout_id: layoutId,
      edits: [
        // RELATIVE to `pipetest_window`, which is centered: the default template's root lands at
        // (650,380) 620x320, so (1250,600) is absolute (1900,980) and this 200x200 icon overhangs the
        // 1920x1080 base by 180 px on the right - INSIDE the 512 px park margin, so it is an escape.
        { op: 'add', parent: 'pipetest_window', node: { kind: 'icon', name: 'broken_sprite', spriteType: 'GFX_nope_nope', position: { x: 1250, y: 600 }, size: { width: 200, height: 200 } } },
        { op: 'add', parent: 'pipetest_window', node: { kind: 'effectbutton', name: 'broken_button', effect: 'no_such_effect', position: { x: 0, y: 0 }, size: { width: 40, height: 20 } } },
      ],
    });
    check('the broken layout still edits cleanly', broken.failed?.length === 0, JSON.stringify(broken.failed));
    const brokenReport = await callTool('gui_layout_validate', { layout_id: layoutId });
    check('an unknown sprite is an error over the pipe', brokenReport.findings.some((finding) => finding.rule === 'unknown-sprite' && finding.severity === 'error'));
    check('an unresolvable effect is an error over the pipe', brokenReport.findings.some((finding) => finding.rule === 'effect-unresolved' && finding.severity === 'error'));
    // GAP-11: this element is 180 px outside the base, which is INSIDE the 512 px park margin, so it
    // is a real escape at error severity - the classification must not swallow it. The park case is
    // asserted on the same report below, so a `parkMargin` that grew to hide a small overflow fails
    // here rather than passing quietly.
    const oob = brokenReport.findings.find((finding) => finding.rule === 'out-of-bounds');
    check('an off-window element is reported', Boolean(oob), JSON.stringify(brokenReport.byRule));
    check('the out-of-bounds finding carries a rect', oob?.rect?.width === 200, JSON.stringify(oob?.rect));
    check('the out-of-bounds finding carries a suggested fix', typeof oob?.suggestedFix === 'string' && oob.suggestedFix.length > 0, oob?.suggestedFix);
    check(
      'the 180 px overflow is counted as an ESCAPE, not as a park',
      oob?.severity === 'error' &&
        oob?.parked === false &&
        brokenReport.geometry?.outOfBounds?.escaped === 1 &&
        brokenReport.geometry?.outOfBounds?.parked === 0 &&
        brokenReport.geometry?.outOfBounds?.parkMargin === 512,
      JSON.stringify(brokenReport.geometry?.outOfBounds),
    );
    // ... and the deliberate `-3000,-3000` park idiom, in the SAME report, is counted separately and
    // still reported - one finding per element, never silence.
    const parkReport = await callTool('gui_layout_validate', {
      layout: {
        name: 'park_probe',
        baseResolution: { width: 1920, height: 1080 },
        root: {
          id: 'r',
          kind: 'container',
          name: 'park_window',
          size: { width: 1920, height: 1080 },
          children: [
            {
              id: 'p',
              kind: 'container',
              name: 'tts_button',
              position: { x: -3000, y: -3000 },
              size: { width: 38, height: 38 },
            },
            {
              id: 'esc',
              kind: 'icon',
              name: 'escaped_icon',
              spriteType: 'GFX_tiles_dark_area_cut_8',
              position: { x: 1900, y: 1000 },
              size: { width: 200, height: 200 },
            },
          ],
        },
      },
    });
    check(
      'the `-3000,-3000` park idiom is reported, counted separately, and not an error',
      parkReport.findings.some((finding) => finding.rule === 'out-of-bounds-parked' && finding.element === 'tts_button') &&
        parkReport.geometry?.outOfBounds?.parked === 1 &&
        parkReport.geometry?.outOfBounds?.escaped === 1 &&
        parkReport.geometry?.outOfBounds?.total === 2,
      JSON.stringify(parkReport.geometry?.outOfBounds),
    );
    check('the report is a failure', brokenReport.verdict === 'fail');

    // ---------------------------------------------------------------- preview
    const preview = await callTool('gui_layout_preview', { layout_id: layoutId, output_dir: join(scratch, 'preview'), with_validation: false });
    check('gui_layout_preview returns an MCP image block', preview.__content.some((block) => block.type === 'image'), preview.__content.map((block) => block.type).join(','));
    const imageBlock = preview.__content.find((block) => block.type === 'image');
    check('the image block is a base64 PNG', imageBlock.mimeType === 'image/png' && imageBlock.data.length > 500, String(imageBlock?.data?.length));
    check('the SVG was written to disk', existsSync(preview.svgPath), preview.svgPath);
    check('the PNG was written to disk', existsSync(preview.pngPath), preview.pngPath);
    check('the preview stats count the elements', preview.stats.elementCount >= 8, JSON.stringify(preview.stats.elementCount));
    check('the preview reports its base resolution', preview.baseResolution?.width === 1920);
    const svgText = readFileSync(preview.svgPath, 'utf8');
    check('the written SVG is self-contained', svgText.startsWith('<?xml') && svgText.includes('data:image/png;base64'), 'no embedded image');
    check('the written SVG states the base resolution', /Base resolution 1920x1080/.test(svgText));

    // ---------------------------------------------------------------- emit
    const dryRun = await callTool('gui_emit_files', { layout_id: layoutId, output_root: join(outputRoot, 'dry') });
    check('gui_emit_files defaults to a dry run', dryRun.dryRun === true, JSON.stringify(dryRun.dryRun));
    check('the dry run plans four files', dryRun.plan?.length === 4, JSON.stringify(dryRun.plan?.map((file) => file.path)));
    check('the dry run wrote nothing', !existsSync(join(outputRoot, 'dry')), 'dry-run directory exists');
    check('the dry run states the encoding rules', /WITH BOM/.test(JSON.stringify(dryRun.encodingRules)), JSON.stringify(dryRun.encodingRules));

    const emitted = await callTool('gui_emit_files', { layout_id: layoutId, output_root: outputRoot, dry_run: false, language: 'english' });
    check('gui_emit_files writes on a real run', emitted.fileCount === 4, String(emitted.fileCount));
    check('the result states the output root', emitted.output_root === outputRoot, emitted.output_root);
    check('the result says nothing was written outside the root', /Nothing was written outside it/.test(emitted.note ?? ''), emitted.note);
    const guiPath = emitted.files.find((file) => file.kind === 'gui').absolutePath;
    const locPath = emitted.files.find((file) => file.kind === 'localisation').absolutePath;
    const eventPath = emitted.files.find((file) => file.kind === 'event').absolutePath;
    check('the .gui file exists', existsSync(guiPath), guiPath);
    check('the .gui has no BOM', readFileSync(guiPath)[0] !== 0xef, String(readFileSync(guiPath).slice(0, 4)));
    check('the .yml has a BOM', readFileSync(locPath).slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), String(readFileSync(locPath).slice(0, 4)));
    const eventText = readFileSync(eventPath, 'utf8');
    check('the event declares custom_gui', /custom_gui = "pipetest_window"/.test(eventText));
    check('the event declares custom_gui_option for the option row', /custom_gui_option = "pipetest_window_option"/.test(eventText), eventText.split('\n').filter((line) => line.includes('custom_gui')).join(' | '));
    check('the event declares diplomatic by default', /\tdiplomatic = yes/.test(eventText));
    const guiText = readFileSync(guiPath, 'utf8');
    check('the emitted .gui has a guiTypes root', /^guiTypes = \{/m.test(guiText));
    check('the emitted .gui carries the option_button/OPTION_TEXT rule', /name = "option_button"/.test(guiText) && /text = "OPTION_TEXT"/.test(guiText));
    check('the emitted .gui hoists @variables before the root', guiText.indexOf('@') === -1 || guiText.indexOf('@') < guiText.indexOf('guiTypes'));

    // ---------------------------------------------------------------- guards
    // A folder that does not exist yet is fine, so this is the guard that matters: an output
    // root that IS a mod workspace must be refused before anything is written.
    mkdirSync(join(scratch, 'FakeMod'), { recursive: true });
    writeFileSync(join(scratch, 'FakeMod', 'descriptor.mod'), 'name="x"\n', 'utf8');
    const refused = await callTool('gui_emit_files', { layout_id: layoutId, output_root: join(scratch, 'FakeMod'), dry_run: false });
    check(
      'an output root containing descriptor.mod is refused',
      /refus/i.test(JSON.stringify(refused)),
      JSON.stringify(refused).slice(0, 240),
    );
    check(
      'the refusal names descriptor.mod as the reason',
      /descriptor\.mod/.test(JSON.stringify(refused)),
      JSON.stringify(refused).slice(0, 240),
    );
    check(
      'nothing was written into the refused mod workspace',
      !existsSync(join(scratch, 'FakeMod', 'interface')),
      'interface folder appeared in the mod workspace',
    );

    const badArgs = await callTool('gui_layout_new', {});
    check('a missing required argument is invalid_params', badArgs.__error?.code === -32602, JSON.stringify(badArgs).slice(0, 160));

    const unknownTool = await request('tools/call', { name: 'no_such_tool', arguments: {} });
    check('an unknown tool is reported in-band', /unknown tool/.test(JSON.stringify(unknownTool.result ?? unknownTool.error)), JSON.stringify(unknownTool).slice(0, 200));

    const badMethod = await request('no/such/method', {});
    check('an unknown method is -32601', badMethod.error?.code === -32601, JSON.stringify(badMethod));

    const badJson = await new Promise((resolve) => {
      const id = 99999;
      const listener = (message) => resolve(message);
      pending.set(id, listener);
      child.stdin.write('{not json at all\n');
      setTimeout(() => resolve({ timedOut: true }), 5000);
    });
    void badJson;

    const inventory = await callTool('gui_interface_inventory', { kind: 'button_effects' });
    check('gui_interface_inventory lists button effects', inventory.total >= 2, JSON.stringify(inventory.entries));
    const containers = await callTool('gui_interface_inventory', { kind: 'containers', query: 'close', limit: 5 });
    check('gui_interface_inventory lists container names', containers.returned >= 1, JSON.stringify(containers.entries?.slice(0, 3)));

    const serverState = await callTool('inspect_rstellarisgui_state', {});
    check('inspect_rstellarisgui_state reports the layouts', serverState.layouts?.length >= 1, JSON.stringify(serverState.layouts));
    check('state reports the base resolution', serverState.baseResolution?.width === 1920, JSON.stringify(serverState.baseResolution));

    // ---------------------------------------------------------------- new surface over the pipe
    // A2: the validator can be told where a mod's own button effects live.
    mkdirSync(join(scratch, 'effects', 'button_effects'), { recursive: true });
    writeFileSync(
      join(scratch, 'effects', 'button_effects', 'mod_effects.txt'),
      'my_mod_effect = { potential = { always = yes } effect = { add_resource = { resource = influence amount = 1 } } }\n',
      'utf8',
    );
    const effectEdit = await callTool('gui_layout_edit', {
      layout_id: layoutId,
      edits: [{ op: 'add', parent: 'pipetest_window', node: { kind: 'effectbutton', name: 'mod_effect_button', effect: 'my_mod_effect', quadTextureSprite: 'GFX_tiling_button_standard', position: { x: 5, y: 5 }, size: { width: 40, height: 20 } } }],
    });
    check('a mod effect button can be added', effectEdit.failed?.length === 0, JSON.stringify(effectEdit.failed));
    const withoutRoot = await callTool('gui_layout_validate', { layout_id: layoutId });
    check('without a button_effects root the mod key is unresolved', withoutRoot.findings.some((finding) => finding.rule === 'effect-unresolved' && finding.element === 'mod_effect_button'), JSON.stringify(withoutRoot.byRule));
    const withRoot = await callTool('gui_layout_validate', { layout_id: layoutId, button_effects_root: join(scratch, 'effects', 'button_effects') });
    check('button_effects_root resolves the mod key', !withRoot.findings.some((finding) => finding.rule === 'effect-unresolved' && finding.element === 'mod_effect_button'), JSON.stringify(withRoot.byRule));
    check('the report names the extra button_effects roots', Array.isArray(withRoot.extraButtonEffectRoots) && withRoot.extraButtonEffectRoots.length === 1, JSON.stringify(withRoot.extraButtonEffectRoots));
    const pluralRoots = await callTool('gui_layout_validate', { layout_id: layoutId, button_effects_roots: [join(scratch, 'effects', 'button_effects')] });
    check('button_effects_roots (plural) works too', !pluralRoots.findings.some((finding) => finding.rule === 'effect-unresolved' && finding.element === 'mod_effect_button'));

    // B10: the rect table in a machine-readable form.
    const csvRects = await callTool('gui_layout_get', { layout_id: layoutId, rect_format: 'csv' });
    check('the rect table can be exported as CSV', typeof csvRects.rectsCsv === 'string' && csvRects.rectsCsv.startsWith('path,name,kind'), String(csvRects.rectsCsv ?? '').slice(0, 40));
    check('the CSV export has one row per element', csvRects.rectsCsv.trim().split('\n').length === csvRects.rectCount + 1, `${csvRects.rectsCsv.trim().split('\n').length} vs ${csvRects.rectCount}`);
    const mdRects = await callTool('gui_layout_get', { layout_id: layoutId, rect_format: 'markdown' });
    check('the rect table can be exported as markdown', /\| element \| kind \|/.test(mdRects.rectsMarkdown ?? ''), String(mdRects.rectsMarkdown ?? '').slice(0, 60));
    check('the markdown export does not also send the JSON table', mdRects.rects === undefined);

    // B9: the preview draws resolved localisation text when asked, so text overflow can be judged.
    mkdirSync(join(scratch, 'locsub', 'english'), { recursive: true });
    writeFileSync(
      join(scratch, 'locsub', 'english', 'zz_pipe_l_english.yml'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('l_english:\n pipetest_window_title:0 "A Resolved Pipe Title"\n', 'utf8')]),
    );
    const locPreview = await callTool('gui_layout_preview', {
      layout_id: layoutId,
      write_files: false,
      png: false,
      inline_image: false,
      inline_svg: true,
      render_localisation: true,
      localisation_roots: [join(scratch, 'locsub')],
      languages: ['english'],
    });
    check('the preview draws the resolved localisation text', /A Resolved Pipe Title/.test(locPreview.svg ?? ''), String(locPreview.svg ?? '').slice(0, 120));
    check('the preview reports how many strings it resolved', (locPreview.stats?.localisationDrawn ?? 0) > 0, JSON.stringify(locPreview.stats?.localisationDrawn));
    check('the preview states that chrome is approximate', locPreview.chromeIsApproximate === true && /9-slice/.test(locPreview.note ?? ''), String(locPreview.note).slice(0, 140));
    const plainPreview = await callTool('gui_layout_preview', { layout_id: layoutId, write_files: false, png: false, inline_image: false, inline_svg: true });
    check('without render_localisation the raw key is drawn', !/A Resolved Pipe Title/.test(plainPreview.svg ?? ''));

    // The engine-syntax check, end to end over the pipe, on a file this tool did not write.
    const fixtureValidate = await callTool('gui_layout_validate', {
      path: join(projectRoot, 'scripts', 'fixtures', 'engine-error-baseline.gui'),
      check_localisation: false,
    });
    check('validating a broken file over the pipe reports the engine errors', fixtureValidate.findings.some((finding) => finding.rule === 'size-not-accepted' && finding.severity === 'error'), JSON.stringify(fixtureValidate.byRule));
    check('the pipe report carries the engine message', /Unexpected token: size/.test(JSON.stringify(fixtureValidate.findings)), JSON.stringify(fixtureValidate.findings[0] ?? {}).slice(0, 160));
    check('the pipe report includes the file-syntax summary', fixtureValidate.syntax?.ok === false, JSON.stringify(fixtureValidate.syntax));
    check('the pipe report counts the syntax findings by rule', (fixtureValidate.byRule['size-not-accepted'] ?? 0) === 4, JSON.stringify(fixtureValidate.byRule));

    // The round-2 engine errors: per-kind FIELDS, over the pipe, on a file we did not write.
    const fieldsValidate = await callTool('gui_layout_validate', {
      path: join(projectRoot, 'scripts', 'fixtures', 'engine-error-fields-baseline.gui'),
      check_localisation: false,
    });
    check('the field fixture is reported as engine-invalid over the pipe', (fieldsValidate.byRule['field-not-accepted'] ?? 0) === 13, JSON.stringify(fieldsValidate.byRule));
    check('the pipe report quotes the rejected field', /Unexpected token: custom_tooltip/.test(JSON.stringify(fieldsValidate.findings)), JSON.stringify(fieldsValidate.findings[0] ?? {}).slice(0, 140));

    // gui_layout_normalise: import a tree with the rejected fields, normalise it, emit, and check
    // that the emitted file is engine-clean.
    const shapeSource = join(scratch, 'fields_before.gui');
    writeFileSync(
      shapeSource,
      [
        'guiTypes = {',
        '\tcontainerWindowType = {',
        '\t\tname = "pipe_fields_window"',
        '\t\tsize = { width = 200 height = 100 }',
        '\t\tcontainerWindowType = { name = "sep" size = { width = 180 height = 1 } alwaysTransparent = yes background = { name = "b" quadTextureSprite = "GFX_subwindow_tile_plain_solid_separator" } }',
        '\t\ticonType = { name = "donut" orientation = center origo = center alwaysTransparent = yes spriteType = "GFX_message_circle" }',
        '\t\teffectbuttonType = { name = "nav" quadTextureSprite = "GFX_tiling_button_standard" effect = pipe_effect custom_tooltip = "TIP" position = { x = 0 y = 0 } size = { x = 180 y = 80 } }',
        '\t}',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    const importedFields = await callTool('gui_layout_import', { path: shapeSource });
    const beforeFields = await callTool('gui_layout_validate', { layout_id: importedFields.layout_id, check_assets: false, check_localisation: false });
    check('the imported field-broken tree is reported', (beforeFields.byRule['field-not-accepted'] ?? 0) === 3, JSON.stringify(beforeFields.byRule));
    const normalised = await callTool('gui_layout_normalise', { layout_id: importedFields.layout_id, check_assets: false });
    check('gui_layout_normalise reports every change', normalised.changeCount === 3, JSON.stringify(normalised.byChange));
    check('gui_layout_normalise names the translation it made', JSON.stringify(normalised.changes).includes('tooltipText'), JSON.stringify(normalised.changes).slice(0, 200));
    const afterFields = await callTool('gui_layout_validate', { layout_id: normalised.layout_id, check_assets: false, check_localisation: false });
    check('the normalised tree validates clean', afterFields.verdict === 'pass' && afterFields.counts.error === 0, JSON.stringify(afterFields.byRule));
    const normalisedEmit = await callTool('gui_emit_files', { layout_id: normalised.layout_id, file_stem: 'pipe_fields', dry_run: true, check_assets: false, include_event: false, include_localisation: false });
    check('the normalised tree emits without field warnings', !normalisedEmit.warnings.some((warning) => warning.rule === 'field-dropped'), JSON.stringify(normalisedEmit.warnings.map((w) => w.rule)));

    // B4/B5: one merged layout for several windows.
    const second = await callTool('gui_layout_new', { name: 'pipetest_second' });
    const merged = await callTool('gui_layout_merge', { layout_ids: [layoutId, second.layout_id], name: 'pipetest_merged' });
    check('gui_layout_merge returns a new layout_id', typeof merged.layout_id === 'string', merged.layout_id);
    check('the merged layout reports both windows', Array.isArray(merged.windows) && merged.windows.length === 2, JSON.stringify(merged.windows));
    const mergedEmit = await callTool('gui_emit_files', { layout_ids: [layoutId, second.layout_id], file_stem: 'pipetest_merged', dry_run: true });
    check('emitting several layouts plans ONE .gui file', mergedEmit.plan.filter((file) => file.kind === 'gui').length === 1, JSON.stringify(mergedEmit.plan.map((file) => file.path)));
    check('the planned .gui holds every window', (mergedEmit.plan.find((file) => file.kind === 'gui').windows ?? []).length === 2, JSON.stringify(mergedEmit.plan.find((file) => file.kind === 'gui').windows));
    check('the dry run documents the per-kind size rules', /maxWidth/.test(JSON.stringify(mergedEmit.sizeRules)), JSON.stringify(mergedEmit.sizeRules).slice(0, 120));

    // B7: the file inspector, on a file the tool did NOT write.
    const badYml = join(scratch, 'bad_loc_l_english.yml');
    writeFileSync(badYml, 'l_english:\n some_key:0 "x"\n', 'utf8');
    const checked = await callTool('gui_check_files', { paths: [badYml], languages: ['english'] });
    check('gui_check_files reports a missing localisation BOM', checked.findings.some((finding) => finding.rule === 'encoding-bom-missing'), JSON.stringify(checked.byRule));
    const checkedGui = await callTool('gui_check_files', { paths: [guiPath], check_loc_keys: false });
    check('gui_check_files finds no engine-syntax fault in a file the emitter wrote', !Object.keys(checkedGui.byRule).some((rule) => ['size-not-accepted', 'size-form-wrong', 'text-without-max-size', 'encoding-bom-unexpected', 'root-invalid'].includes(rule)), JSON.stringify(checkedGui.byRule));
    check('gui_check_files labels every finding with a file and scope', checked.findings.every((finding) => typeof finding.where === 'string' && finding.where.includes('[encoding]')), JSON.stringify(checked.findings.map((f) => f.where)));

    // The custom_gui contract, through the tool surface rather than the library: the fixture is the
    // shipped window, so a contract finding here would be a false positive on a file verified in game.
    const contractFixture = join(projectRoot, 'scripts', 'fixtures', 'contract', 'legal_window.gui');
    const contractBroken = join(projectRoot, 'scripts', 'fixtures', 'contract', 'broken_missing_contract.gui');
    const contractEvents = join(projectRoot, 'scripts', 'fixtures', 'contract', 'events_guarded.txt');
    const contractChecked = await callTool('gui_check_files', {
      paths: [contractFixture, contractEvents],
      localisation_roots: [join(projectRoot, 'scripts', 'fixtures', 'contract', 'localisation')],
      check_loc_keys: false,
    });
    check(
      'gui_check_files runs the contract check and reports the window names it read from the events',
      contractChecked.customGuiWindows?.includes('geocentric_unga_main'),
      JSON.stringify(contractChecked.customGuiWindows),
    );
    check(
      'the LEGAL mod window gets no contract finding through the tool',
      !contractChecked.findings.some((finding) => /^custom-gui-contract/.test(finding.rule)),
      JSON.stringify(contractChecked.findings.filter((finding) => /^custom-gui-contract/.test(finding.rule)).map((finding) => finding.rule)),
    );
    const contractBrokenReport = await callTool('gui_check_files', {
      paths: [contractBroken, contractEvents],
      localisation_roots: [join(projectRoot, 'scripts', 'fixtures', 'contract', 'localisation')],
      check_loc_keys: false,
    });
    check(
      'the broken fixture reports `custom-gui-contract-missing` as an error listing the deleted names',
      (() => {
        const finding = contractBrokenReport.findings.find((entry) => entry.rule === 'custom-gui-contract-missing');
        return finding?.severity === 'error' && finding.missing?.includes('EVENT_DIPLO');
      })(),
      JSON.stringify(contractBrokenReport.findings.filter((finding) => finding.rule === 'custom-gui-contract-missing').map((finding) => finding.missing)),
    );
    check(
      'the cross-file rule runs through the tool as well',
      contractChecked.findings.some((finding) => finding.rule === 'custom-gui-force-open'),
      JSON.stringify(contractChecked.byRule),
    );

    // B2: overriding a vanilla file, deliberately and hash-guarded.
    const vanillaFixture = join(scratch, 'fake_vanilla.gui');
    writeFileSync(vanillaFixture, 'guiTypes = {\n\tcontainerWindowType = {\n\t\tname = "header_actions"\n\t\tsize = { width = 283 height = 40 }\n\t}\n}\n', 'utf8');
    const overrideDry = await callTool('gui_emit_override', {
      vanilla_path: vanillaFixture,
      additions: [{ container: 'header_actions', element: { kind: 'effectbutton', name: 'pipe_override_button', effect: 'pipe_effect', quadTextureSprite: 'GFX_fleetview_focus_solid', position: { x: 10, y: 10 } } }],
      output_root: join(outputRoot, 'override'),
      dry_run: true,
    });
    check('gui_emit_override plans an override', /^[0-9a-f]{64}$/.test(overrideDry.vanilla?.sha256 ?? ''), JSON.stringify(overrideDry.vanilla));
    check('gui_emit_override writes nothing on a dry run', !existsSync(join(outputRoot, 'override')));
    const overrideRefused = await callTool('gui_emit_override', {
      vanilla_path: vanillaFixture,
      additions: [{ container: 'header_actions', element: { kind: 'effectbutton', name: 'x', effect: 'y' } }],
      output_root: join(outputRoot, 'override'),
      dry_run: false,
    });
    check('gui_emit_override refuses without the explicit confirmation', /i_understand_this_overrides_vanilla_file/.test(JSON.stringify(overrideRefused)), JSON.stringify(overrideRefused).slice(0, 200));
    const overrideWritten = await callTool('gui_emit_override', {
      vanilla_path: vanillaFixture,
      additions: [{ container: 'header_actions', element: { kind: 'effectbutton', name: 'pipe_override_button', effect: 'pipe_effect', quadTextureSprite: 'GFX_fleetview_focus_solid', position: { x: 10, y: 10 } } }],
      output_root: join(outputRoot, 'override'),
      dry_run: false,
      i_understand_this_overrides_vanilla_file: true,
      expected_source_hash: overrideDry.vanilla.sha256,
    });
    check('a confirmed override is written', existsSync(overrideWritten.absolutePath), String(overrideWritten.absolutePath));
    check('the override records the vanilla hash it was built from', readFileSync(overrideWritten.absolutePath, 'utf8').includes(overrideDry.vanilla.sha256));
    check('the override result says the vanilla file was untouched', /never modified/.test(overrideWritten.vanillaNote ?? ''), String(overrideWritten.vanillaNote).slice(0, 120));
    const overrideStale = await callTool('gui_emit_override', {
      vanilla_path: vanillaFixture,
      additions: [{ container: 'header_actions', element: { kind: 'effectbutton', name: 'x', effect: 'y' } }],
      output_root: join(outputRoot, 'override'),
      dry_run: false,
      i_understand_this_overrides_vanilla_file: true,
      expected_source_hash: '0'.repeat(64),
    });
    check('a changed vanilla hash is refused', /has changed/.test(JSON.stringify(overrideStale)), JSON.stringify(overrideStale).slice(0, 200));

    // B8: a mod root as an extra asset root.
    const modGfxRoot = join(scratch, 'GfxMod');
    mkdirSync(join(modGfxRoot, 'interface'), { recursive: true });
    writeFileSync(
      join(modGfxRoot, 'interface', 'zz_pipe.gfx'),
      'spriteTypes = {\n\tspriteType = {\n\t\tname = "GFX_pipe_mod_sprite"\n\t\ttextureFile = "gfx/interface/zz_pipe.dds"\n\t}\n}\n',
      'utf8',
    );
    const modSearch = await callTool('gui_assets_search', { query: 'pipe_mod_sprite', extra_roots: [modGfxRoot] });
    check('extra_roots are indexed for sprite search', modSearch.resultCount === 1, JSON.stringify(modSearch.results));
    check('the index reports every root', (modSearch.index?.roots ?? []).length >= 2 || modSearch.index?.rootCount >= 2, JSON.stringify(modSearch.index));
    const noExtra = await callTool('gui_assets_search', { query: 'pipe_mod_sprite' });
    check('without extra_roots the mod sprite is absent', noExtra.resultCount === 0, JSON.stringify(noExtra.results));

    // ---------------------------------------------------------------- web UI over the pipe
    const webStart = await callTool('gui_web_ui_start', { port: 8931 + (process.pid % 40), layout_id: layoutId });
    check('gui_web_ui_start returns a URL', /^http:\/\/127\.0\.0\.1:\d+\/$/.test(webStart.url ?? ''), webStart.url);
    if (webStart.url) {
      const page = await fetch(webStart.url).then((response) => response.text());
      check('the web page is served', page.includes('<title>RStellarisGui'), page.slice(0, 80));
      check('the page states the base resolution assumption', /base resolution/i.test(page), 'no base resolution note');
      const apiState = await fetch(new URL('/api/state', webStart.url)).then((response) => response.json());
      check('the web API reports the layout', apiState.currentLayoutId === layoutId, JSON.stringify(apiState.currentLayoutId));
      const assetResponse = await fetch(new URL('/api/assets?q=close&limit=5', webStart.url)).then((response) => response.json());
      check('the web API can search assets', assetResponse.count >= 1, JSON.stringify(assetResponse.count));
      const exportNoPath = await fetch(new URL('/api/export', webStart.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: layoutId }),
      });
      const exportBody = await exportNoPath.json();
      check('the web export refuses a missing output path', exportNoPath.status === 400 && /output_root is required/.test(exportBody.error ?? ''), JSON.stringify(exportBody).slice(0, 200));
      check('the web export suggests a path', typeof exportBody.suggested === 'string' && exportBody.suggested.length > 0, exportBody.suggested);
    }
    const webStatus = await callTool('gui_web_ui_status', {});
    check('gui_web_ui_status reports it running', webStatus.running === true, JSON.stringify(webStatus));
    const webStop = await callTool('gui_web_ui_stop', {});
    check('gui_web_ui_stop stops it', webStop.stopped === true, JSON.stringify(webStop));
    const webStatusAfter = await callTool('gui_web_ui_status', {});
    check('the web UI is really stopped', webStatusAfter.running === false, JSON.stringify(webStatusAfter));

    // ---------------------------------------------------------------- the handoff, over the pipe
    //
    // The guardrails and the handoff channel are the human-in-the-loop feature; this drives them
    // through the REAL MCP server, so a tool that stopped being registered, or a guard that stopped
    // refusing, fails here as well as in selftest.
    {
      const handoffRoot = join(scratch, 'handoff-protocol');
      if (existsSync(handoffRoot)) rmSync(handoffRoot, { recursive: true, force: true });
      mkdirSync(handoffRoot, { recursive: true });

      // A custom_gui window with the crash-class names, so the guard has something to protect.
      const window = await callTool('gui_layout_import', {
        text: [
          'guiTypes = {',
          '\tcontainerWindowType = {',
          '\t\tname = "protocol_event_window"',
          '\t\tposition = { x = 0 y = 0 }',
          '\t\tsize = { width = 900 height = 600 }',
          '\t\torientation = center',
          '\t\torigo = center',
          '\t\ticonType = { name = "empire_info_bg" position = { x = 10 y = 10 } spriteType = "GFX_diplomacy_dark_fade_bg" }',
          '\t\tcontainerWindowType = {',
          '\t\t\tname = "EVENT_DIPLO"',
          '\t\t\tposition = { x = 0 y = 60 }',
          '\t\t\tsize = { width = 380 height = 180 }',
          '\t\t\tinstantTextBoxType = { name = "action_title" position = { x = 8 y = 8 } maxWidth = 300 maxHeight = 20 font = "cg_16b" text = "k1" }',
          '\t\t\tinstantTextBoxType = { name = "action_desc" position = { x = 8 y = 32 } maxWidth = 300 maxHeight = 60 font = "cg_16b" text = "k2" }',
          '\t\t\tlistboxType = { name = "option_list" position = { x = 8 y = 100 } size = { x = 300 y = 70 } }',
          '\t\t}',
          '\t\tbuttonType = { name = "tts_button" position = { x = -3000 y = -3000 } size = { x = 0 y = 0 } spriteType = "GFX_button_tts_start" shortCut = "t" }',
          '\t\teffectbuttonType = { name = "close" position = { x = -45 y = 16 } orientation = upper_right quadTextureSprite = "GFX_main_close_button" }',
          '\t}',
          '}',
        ].join('\n'),
        name: 'protocol_event_window',
      });
      const handoffLayoutId = window.layout_id;
      check('a custom_gui window imports over the pipe for the handoff test', typeof handoffLayoutId === 'string', JSON.stringify(window).slice(0, 200));

      const refusedRemove = await callTool('gui_layout_edit', {
        layout_id: handoffLayoutId,
        edits: [{ op: 'remove', target: 'close' }],
        custom_gui_windows: ['protocol_event_window'],
      });
      check('gui_layout_edit REFUSES deleting a contract name over the pipe', (refusedRemove.refused ?? []).length === 1 && refusedRemove.refused[0].rule === 'handoff-protected-remove', JSON.stringify(refusedRemove.refused?.map((entry) => entry.rule)));
      check('the refusal is also returned as an error string', typeof refusedRemove.error === 'string' && /REFUSED/.test(refusedRemove.error), refusedRemove.error);
      check('the refused batch was not applied', (refusedRemove.applied ?? []).length === 0);

      const refusedRename = await callTool('gui_layout_edit', {
        layout_id: handoffLayoutId,
        edits: [{ op: 'rename', target: 'option_list', name: 'options' }],
        custom_gui_windows: ['protocol_event_window'],
      });
      check('gui_layout_edit REFUSES renaming a contract name over the pipe', (refusedRename.refused ?? [])[0]?.rule === 'handoff-protected-rename', JSON.stringify(refusedRename.refused?.map((entry) => entry.rule)));

      const refusedUnpin = await callTool('gui_layout_edit', {
        layout_id: handoffLayoutId,
        edits: [{ op: 'set', target: 'close', path: 'position', value: { x: 400, y: 400 } }],
        custom_gui_windows: ['protocol_event_window'],
      });
      check('gui_layout_edit REFUSES un-pinning `close` over the pipe', (refusedUnpin.refused ?? [])[0]?.rule === 'handoff-close-unpinned', JSON.stringify(refusedUnpin.refused?.map((entry) => entry.rule)));

      const refusedShortcut = await callTool('gui_layout_edit', {
        layout_id: handoffLayoutId,
        edits: [{ op: 'set', target: 'tts_button', path: 'shortCut', value: 'F9' }],
        custom_gui_windows: ['protocol_event_window'],
      });
      check('gui_layout_edit REFUSES a shortcut on a parked element over the pipe', (refusedShortcut.refused ?? [])[0]?.rule === 'handoff-parked-shortcut-added', JSON.stringify(refusedShortcut.refused?.map((entry) => entry.rule)));

      const appliedMove = await callTool('gui_layout_edit', {
        layout_id: handoffLayoutId,
        edits: [{ op: 'set', target: 'action_title', path: 'position', value: { x: 30, y: 12 } }],
        custom_gui_windows: ['protocol_event_window'],
      });
      check('an ordinary move still applies over the pipe', (appliedMove.applied ?? []).length === 1 && (appliedMove.refused ?? []).length === 0, JSON.stringify(appliedMove.failed));

      const submitted = await callTool('gui_handoff_submit', {
        layout_id: handoffLayoutId,
        custom_gui_windows: ['protocol_event_window'],
        note: 'protocol-test submission',
        handoff_root: handoffRoot,
      });
      check('gui_handoff_submit writes a submission', typeof submitted.id === 'string' && existsSync(join(submitted.directory, 'meta.json')), submitted.directory);
      check('the submission carries its provenance diff', submitted.diff?.changeCount >= 1, JSON.stringify(submitted.diff?.summary));
      // This fixture declares only SOME of the contract names, so `custom-gui-contract-missing` is
      // expected - and it is a HARD finding, so the submission is marked invalid. That is the point:
      // the structural contract (close last, option_list under EVENT_DIPLO, no duplicates) must be
      // clean, and the missing-name finding must be carried into the submission rather than swallowed.
      const structural = (submitted.guardrails?.hard ?? []).filter((finding) =>
        ['custom-gui-contract-nesting', 'custom-gui-contract-duplicate', 'custom-gui-close-not-last', 'handoff-protected-remove'].includes(finding.rule),
      );
      check('the submission has no STRUCTURAL contract finding (close is last, option_list is nested)', structural.length === 0, JSON.stringify(structural.map((finding) => finding.rule)));
      check('a hard finding marks the submission invalid, and the reason is recorded', submitted.invalid === true && /custom-gui-contract-missing/.test(submitted.invalidReason ?? ''), String(submitted.invalidReason));

      const listed = await callTool('gui_handoff_list', { handoff_root: handoffRoot });
      check('gui_handoff_list shows the submission as pending', listed.pendingCount === 1 && listed.handoffs[0].id === submitted.id, JSON.stringify({ pending: listed.pendingCount }));
      check('the listing includes the diff text', /action_title/.test(listed.handoffs[0].diffMarkdown ?? ''), (listed.handoffs[0].diffMarkdown ?? '').slice(0, 120));

      const picked = await callTool('gui_handoff_pick', { id: submitted.id, handoff_root: handoffRoot });
      check('gui_handoff_pick loads the submission as the current layout', typeof picked.layout_id === 'string' && picked.handoff?.id === submitted.id, JSON.stringify({ layout_id: picked.layout_id }));
      check('picking clears the pending count', (await callTool('gui_handoff_status', { handoff_root: handoffRoot })).pendingCount === 0);

      const pickedValidation = await callTool('gui_layout_validate', { layout_id: picked.layout_id, custom_gui_windows: ['protocol_event_window'], check_assets: false, check_localisation: false });
      check(
        'the picked layout validates with no STRUCTURAL contract finding (the names survived the round trip)',
        pickedValidation.findings.filter((finding) => ['custom-gui-contract-nesting', 'custom-gui-contract-duplicate', 'custom-gui-close-not-last'].includes(finding.rule)).length === 0,
        JSON.stringify(pickedValidation.byRule),
      );

      const pickedDiff = await callTool('gui_layout_diff', { layout_id: picked.layout_id });
      check('gui_layout_diff describes what the agent changed since the human submitted', pickedDiff.unchanged === true || Array.isArray(pickedDiff.changes), JSON.stringify(pickedDiff.counts));
    }

    // ---------------------------------------------------------------- the engine's own log
    {
      const scanned = await callTool('gui_log_scan', { limit: 5 });
      check('gui_log_scan runs and says whether it found logs', typeof scanned.isEmpty === 'boolean', JSON.stringify(scanned.byKind ?? {}));
      check('gui_log_scan returns the engine\'s own selection record', Array.isArray(scanned.selections), JSON.stringify(Object.keys(scanned)));
      check(
        'gui_log_scan reports the file, byte count and per-kind counts of every log it read',
        Array.isArray(scanned.logs) && scanned.logs.every((entry) => typeof entry.file === 'string' && typeof entry.counts?.total === 'number'),
        JSON.stringify(scanned.logs?.slice(0, 2)),
      );
      check(
        'gui_log_scan labels every engine complaint with file:line',
        scanned.findings.every((finding) => /:\d+$/.test(String(finding.where))),
        JSON.stringify(scanned.findings?.[0]?.where),
      );
      check(
        'gui_log_scan caps the selection list it returns and says how many it dropped',
        scanned.selections.length <= 5 && Number.isInteger(scanned.droppedSelections),
        `${scanned.selections.length} returned, ${scanned.droppedSelections} dropped, ${scanned.selectionCount} total`,
      );
      check(
        'gui_log_scan reads the real game.log when there is one',
        scanned.isEmpty || scanned.selections.every((entry) => Number.isInteger(entry.option) && typeof entry.eventId === 'string'),
        JSON.stringify(scanned.selections?.[0]),
      );
    }

    // ---------------------------------------------------------------- the knowledge base over the wire
    // The query tools and the resource surface are the reason the measured knowledge is
    // discoverable rather than buried in a 1000-line markdown file, so they are driven here over
    // the REAL transport, not only in-process.
    {
      const search = await callTool('gui_knowledge_search', { query: 'option_list EVENT_DIPLO' });
      check(
        'gui_knowledge_search answers over the pipe and returns the contract topic',
        search.matchCount === 1 && search.topics[0].id === 'window-name-contract',
        JSON.stringify({ matchCount: search.matchCount, ids: search.topics?.map((topic) => topic.id) }),
      );
      check(
        'every search hit carries its evidence/rules counts and a resource uri',
        search.topics.every((topic) => typeof topic.counts?.evidence === 'number' && /^rstellarisgui:\/\/stellaris\/knowledge\//.test(topic.uri)),
        JSON.stringify(search.topics?.[0]),
      );
      check('the search result states the catalogue size and its categories', search.topicCount >= 18 && Object.keys(search.categoryCounts).length === 6, JSON.stringify(search.categoryCounts));

      const scoped = await callTool('gui_knowledge_search', { query: 'button_effects potential is_scope_type' });
      check(
        'the open GAP-12 visibility rule is discoverable by its own terms',
        scoped.topics.some((topic) => topic.id === 'control-visibility-is-a-potential'),
        JSON.stringify(scoped.topics?.map((topic) => topic.id)),
      );

      const topic = await callTool('gui_knowledge_topic', { id: 'bar-construction' });
      check(
        'gui_knowledge_topic returns one topic in full, with its markdown',
        topic.id === 'bar-construction' && /unga_chart_main/.test(topic.markdown) && topic.evidenceItems >= 8,
        JSON.stringify({ evidence: topic.evidenceItems, md: topic.markdown?.length }),
      );
      const listing = await callTool('gui_knowledge_topic', {});
      check('listing every topic over the pipe works', listing.topicCount === search.topicCount && listing.topics.length === search.topicCount);
      const missingTopic = await callTool('gui_knowledge_topic', { id: 'definitely-not-a-topic' });
      check(
        'an unknown topic id comes back with the ids that do exist',
        /no knowledge topic with id/.test(missingTopic.error) && missingTopic.ids.length === search.topicCount,
        JSON.stringify(missingTopic.error),
      );
      const badSearch = await callTool('gui_knowledge_search', {});
      check('gui_knowledge_search without a query is invalid_params', badSearch.__error?.code === -32602, JSON.stringify(badSearch).slice(0, 160));

      const resourceList = await request('resources/list', {});
      check(
        'resources/list is advertised and lists the catalogue',
        Array.isArray(resourceList.result?.resources) &&
          resourceList.result.resources.some((resource) => resource.uri === 'rstellarisgui://stellaris/knowledge/catalog'),
        JSON.stringify(resourceList.result?.resources?.map((resource) => resource.uri)),
      );
      const templates = await request('resources/templates/list', {});
      check(
        'resources/templates/list offers the per-topic template',
        templates.result?.resourceTemplates?.some((template) => template.uriTemplate === 'rstellarisgui://stellaris/knowledge/{topic_id}'),
        JSON.stringify(templates.result?.resourceTemplates),
      );
      const catalog = await request('resources/read', { uri: 'rstellarisgui://stellaris/knowledge/catalog' });
      check(
        'resources/read returns the TOML catalogue with every topic id in it',
        catalog.result?.contents?.[0]?.mimeType === 'application/toml' &&
          listing.topics.every((entry) => catalog.result.contents[0].text.includes(`id = "${entry.id}"`)),
        catalog.result?.contents?.[0]?.text?.slice(0, 100),
      );
      // EVERY topic must be readable, not just the one a test happens to name: a catalogue whose
      // ids do not all resolve is a query surface with holes in it.
      let unreadable = [];
      for (const entry of listing.topics) {
        const read = await request('resources/read', { uri: `rstellarisgui://stellaris/knowledge/${entry.id}` });
        const text = read.result?.contents?.[0]?.text ?? '';
        if (read.error || !text.includes(`- ID: ${entry.id}`)) unreadable.push(entry.id);
      }
      check('EVERY advertised topic id resolves through resources/read', unreadable.length === 0, JSON.stringify(unreadable));
      const update = await request('resources/read', { uri: 'rstellarisgui://stellaris/latest-update' });
      check('the version snapshot is readable as a resource', /4\.4\.6/.test(update.result?.contents?.[0]?.text ?? ''), update.result?.contents?.[0]?.text?.slice(0, 80));
      const badResource = await request('resources/read', { uri: 'rstellarisgui://nope' });
      check('an unknown resource uri is -32602, not an internal error', badResource.error?.code === -32602, JSON.stringify(badResource.error));
      check('the handshake advertised resources', init.result.capabilities.resources !== undefined, JSON.stringify(init.result.capabilities));
    }

    // ---------------------------------------------------------------- shutdown
    child.stdin.end();
    await new Promise((resolve) => child.on('exit', resolve));
    check('the server exits cleanly on stdin close', child.exitCode === 0, `exit=${child.exitCode} stderr=${stderr.slice(0, 300)}`);
    check('nothing was written to stderr', stderr.trim() === '', stderr.slice(0, 300));

    process.stdout.write(`\n${'='.repeat(72)}\npassed ${passed}, failed ${failed}\n`);
    if (failures.length > 0) {
      process.stdout.write(`\nfailures:\n`);
      for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
    }
    process.exitCode = failed === 0 ? 0 : 1;
  })();
}

main().catch((thrown) => {
  process.stderr.write(`protocol-test crashed: ${thrown instanceof Error ? thrown.stack : thrown}\n`);
  process.exitCode = 1;
});
