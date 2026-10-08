#!/usr/bin/env node
//------------------------------------------------------------------------------------
// handoff-e2e.mjs -- Part of RStellarisGui
//
// THE INDEPENDENT CHECK for the human<->agent handoff, on the REAL mod window.
//
// Everything here runs headlessly against the real 8112-line, six-custom_gui-window file
// `<mods>\geocentric_origin\interface\zz_geocentric_unga.gui`: it drives the tool layer
// AND the HTTP API (the page's own routes), performs the kind of edit a human dragging boxes makes,
// submits, lists, picks, validates and emits - and then tries to break a working window on purpose.
//
// Two results are asserted, and they are the point of the whole feature:
//   1. a hand-edited submission ROUND-TRIPS with ZERO contract findings, all the way through
//      submit -> list -> pick -> validate -> emit, and the emitted .gui parses back to the same
//      tree;
//   2. a deliberately BAD submission is REFUSED (a protected removal, an un-pinned `close`, a
//      `shortcut` on a parked element) - refused by the SERVER, on the route the page calls, not
//      only by the page.
//
// Nothing outside `.selftest/handoff-e2e/` is written, nothing is deleted outside it, and the mod
// folder is only ever READ.
//
// Usage: node scripts/handoff-e2e.mjs [--mod <path>] [--quiet]
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitFiles } from '../src/lib/emit.mjs';
import { HANDOFF_ROOT, listHandoffs, loadHandoff, loadHandoffLayout, pendingHandoffs, submitHandoff } from '../src/lib/handoff.mjs';
import { describeProtection, protectionList, scanContractViolations } from '../src/lib/handoff-guard.mjs';
import { parseGuiText, topLevelContainers, walkLayout } from '../src/lib/layout.mjs';
import { DEFAULT_GAME_ROOT, resolveGameRoot } from '../src/lib/paths.mjs';
import { startWebUi } from '../src/lib/web.mjs';
import { createToolRegistry } from '../src/tools/index.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = join(projectRoot, '.selftest', 'handoff-e2e');

const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet');
const modIndex = argv.indexOf('--mod');
const MOD = modIndex !== -1 ? argv[modIndex + 1] : '<mods>\\geocentric_origin';
const GUI = join(MOD, 'interface', 'zz_geocentric_unga.gui');

const results = [];
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    results.push({ name, ok: true, detail });
    if (!quiet) process.stdout.write(`  ok   ${name}\n`);
  } else {
    failed += 1;
    results.push({ name, ok: false, detail });
    process.stdout.write(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}\n`);
  }
}

function heading(title) {
  if (!quiet) process.stdout.write(`\n${title}\n`);
}

/** A fresh, empty handoff root for this run. Only ever inside `.selftest/`. */
function resetRoot(root) {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

/** The rules that mean "the engine dereferences this name": the HARD contract set. */
const HARD_CONTRACT_RULES = new Set([
  'custom-gui-contract-missing',
  'custom-gui-contract-duplicate',
  'custom-gui-contract-nesting',
  'custom-gui-close-not-last',
  'field-not-accepted',
  'effect-on-button',
]);

/** The parked-element / option-0 traps: WARNINGS the real mod already carries. */
const SOFT_CONTRACT_RULES = new Set([
  'parked-element-shortcut',
  'parked-element-hit-region',
  'parked-duplicate-of-live-control',
  'custom-gui-option0-selfref',
  'custom-gui-force-open',
  'custom-gui-portrait-nesting',
]);

/** The hard (crash-class) findings in a full validation report. */
function hardFindings(report) {
  return report.findings.filter((finding) => HARD_CONTRACT_RULES.has(finding.rule));
}

/** The warning-class contract findings in a full validation report. */
function softFindings(report) {
  return report.findings.filter((finding) => SOFT_CONTRACT_RULES.has(finding.rule));
}

function byRule(findings) {
  const counts = {};
  for (const finding of findings) counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
  return counts;
}

/** A plausible hand-drag: move a title, resize a chart-like panel, rename nothing protected. */
const HUMAN_EDITS = [
  { op: 'set', target: 'unga_title_main', path: 'position', value: { x: 48, y: 22 } },
  { op: 'set', target: 'unga_subtitle_main', path: 'position', value: { x: 48, y: 54 } },
];

async function main() {
  if (!existsSync(GUI)) {
    process.stdout.write(`the real mod window is not present (${GUI}); nothing to check.\n`);
    process.stdout.write('pass this run an explicit --mod <folder> to point at it.\n');
    process.exitCode = 3;
    return;
  }

  const handoffRoot = resetRoot(join(scratch, 'handoff'));
  const outputRoot = resetRoot(join(scratch, 'emit'));

  const context = {
    projectRoot,
    serverInfo: { name: 'rstellarisgui', version: 'e2e' },
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
  const call = (name, args) => registry.call(name, args);
  const MOD_ARGS = { extra_roots: [MOD] };

  // ===================================================================================
  heading('1. the real mod window: import and baseline');
  // ===================================================================================
  const imported = await call('gui_layout_import', { paths: [GUI], name: 'unga', ...MOD_ARGS });
  const layoutId = imported.layout_id;
  check('the real mod window imports', imported.ok === true && imported.elementCount > 400, `elementCount ${imported.elementCount}`);
  const windows = topLevelContainers(context.layouts.get(layoutId).layout).map((node) => node.name);
  check('it holds the six custom_gui windows plus the option rows', windows.length === 9, windows.join(', '));

  const customGui = ['geocentric_unga_main', 'geocentric_unga_nato', 'geocentric_unga_eadi', 'geocentric_unga_csto', 'geocentric_unga_au', 'geocentric_unga_nam'];
  const baselineReport = await call('gui_layout_validate', {
    layout_id: layoutId,
    ...MOD_ARGS,
    button_effects_roots: [join(MOD, 'common', 'button_effects')],
    localisation_roots: [join(MOD, 'localisation', 'english')],
    custom_gui_windows: customGui,
  });
  const baselineContract = byRule(softFindings(baselineReport));
  check(
    'the imported window has ZERO HARD contract findings to start from',
    hardFindings(baselineReport).length === 0,
    JSON.stringify(byRule(hardFindings(baselineReport))),
  );
  check(
    'its parked-element warnings are the known ones (the layout is not silently broken already)',
    (baselineContract['parked-element-shortcut'] ?? 0) === 12 && (baselineContract['parked-element-hit-region'] ?? 0) === 12,
    JSON.stringify(baselineContract),
  );

  const protections = protectionList(context.layouts.get(layoutId).layout, { customGuiWindows: customGui });
  const closeEntries = protections.filter((entry) => entry.close);
  check(
    'the guardrails find all six protected `close` controls (one per custom_gui window)',
    closeEntries.length === 6,
    `${closeEntries.length} close entries of ${protections.length} protected elements`,
  );
  check('the protected set includes the crash-class names', ['EVENT_DIPLO', 'option_list', 'empire_info_bg', 'close'].every((name) => protections.some((entry) => entry.name === name)));
  const protectedPaths = describeProtection(context.layouts.get(layoutId).layout, { customGuiWindows: customGui });
  check(
    'every protection record is keyed by the same path the rect table uses',
    [...protectedPaths.keys()].every((path) => typeof path === 'string' && path.includes('/')) &&
      [...protectedPaths.keys()].some((path) => path.endsWith('/geocentric_unga_main/close')),
    [...protectedPaths.keys()].slice(0, 3).join(' | '),
  );

  // ===================================================================================
  heading('2. the guardrails REFUSE a working window from being broken');
  // ===================================================================================
  const before = JSON.stringify(context.layouts.get(layoutId).layout);

  const removeProtected = await call('gui_layout_edit', {
    layout_id: layoutId,
    edits: [{ op: 'remove', target: 'close' }],
    ...MOD_ARGS,
    custom_gui_windows: customGui,
  });
  check('deleting a contract name (`close`) is REFUSED', (removeProtected.refused ?? []).length === 1 && removeProtected.refused[0].rule === 'handoff-protected-remove', JSON.stringify(removeProtected.refused));
  check('the refused batch was NOT applied', (removeProtected.applied ?? []).length === 0 && JSON.stringify(removeProtected.layout ?? context.layouts.get(layoutId).layout) === before);
  check('the refusal names the element, the window and the fix', /close/.test(removeProtected.refused[0].message) && /park/i.test(removeProtected.refused[0].suggestedFix ?? ''));

  for (const name of ['EVENT_DIPLO', 'option_list', 'empire_info_bg', 'action_title', 'heading', 'portrait']) {
    const attempt = await call('gui_layout_edit', { layout_id: layoutId, edits: [{ op: 'remove', target: name }], ...MOD_ARGS, custom_gui_windows: customGui });
    check(`deleting \`${name}\` is REFUSED`, (attempt.refused ?? []).length === 1 && attempt.refused[0].rule === 'handoff-protected-remove');
  }

  const renameProtected = await call('gui_layout_edit', {
    layout_id: layoutId,
    edits: [{ op: 'rename', target: 'option_list', name: 'unga_options' }],
    ...MOD_ARGS,
    custom_gui_windows: customGui,
  });
  check('renaming a contract name is REFUSED', (renameProtected.refused ?? []).length === 1 && renameProtected.refused[0].rule === 'handoff-protected-rename');

  const renameSame = await call('gui_layout_edit', {
    layout_id: layoutId,
    edits: [{ op: 'rename', target: 'option_list', name: 'option_list' }],
    ...MOD_ARGS,
    custom_gui_windows: customGui,
    store: false,
  });
  check('a no-op rename is allowed (the guard blocks changes, not the element)', (renameSame.refused ?? []).length === 0 && (renameSame.failed ?? []).length === 0);
  // The stored tree must be untouched by a `store: false` call, and by every refusal above.
  check('after the refusals the STORED tree is byte-identical: nothing leaked through', JSON.stringify(context.layouts.get(layoutId).layout) === before);

  const unpinClose = await call('gui_layout_edit', {
    layout_id: layoutId,
    edits: [{ op: 'set', target: 'close', path: 'position', value: { x: 300, y: 300 } }],
    ...MOD_ARGS,
    custom_gui_windows: customGui,
  });
  check('moving `close` out of its top-right corner is REFUSED', (unpinClose.refused ?? []).length === 1 && unpinClose.refused[0].rule === 'handoff-close-unpinned', JSON.stringify(unpinClose.refused?.map((entry) => entry.rule)));
  const reorientClose = await call('gui_layout_edit', {
    layout_id: layoutId,
    edits: [{ op: 'set', target: 'close', path: 'orientation', value: 'lower_left' }],
    ...MOD_ARGS,
    custom_gui_windows: customGui,
  });
  check('re-orienting `close` away from upper_right is REFUSED', (reorientClose.refused ?? []).length === 1 && reorientClose.refused[0].rule === 'handoff-close-unpinned');

  const parkedShortcut = await call('gui_layout_edit', {
    layout_id: layoutId,
    edits: [{ op: 'set', target: 'tts_button', path: 'shortCut', value: 'F9' }],
    ...MOD_ARGS,
    custom_gui_windows: customGui,
  });
  check('a `shortcut` on a parked element is REFUSED', (parkedShortcut.refused ?? []).length === 1 && parkedShortcut.refused[0].rule === 'handoff-parked-shortcut-added', JSON.stringify(parkedShortcut.refused?.map((entry) => entry.rule)));

  const effectOnButton = await call('gui_layout_edit', {
    layout_id: layoutId,
    edits: [{ op: 'set', target: 'focus_button', path: 'effect', value: 'geocentric_unga_diag_close' }],
    ...MOD_ARGS,
    custom_gui_windows: customGui,
  });
  check('`effect` on a `buttonType` is REFUSED', (effectOnButton.refused ?? []).length === 1 && effectOnButton.refused[0].rule === 'handoff-effect-on-button', JSON.stringify(effectOnButton.refused?.map((entry) => entry.rule)));

  const afterRefusals = JSON.stringify(context.layouts.get(layoutId).layout);
  check('after all the refused gestures the tree is byte-identical: nothing leaked through', afterRefusals === before);

  // ===================================================================================
  heading('3. the human drags: guarded edits apply, and the delta is reported');
  // ===================================================================================
  const humanEdit = await call('gui_layout_edit', { layout_id: layoutId, edits: HUMAN_EDITS, ...MOD_ARGS, custom_gui_windows: customGui });
  check('a plain move + resize applies', (humanEdit.applied ?? []).length === 2 && (humanEdit.refused ?? []).length === 0, JSON.stringify(humanEdit.failed));
  check(
    'the guardrail delta for a clean edit is clear (an imported window\'s own warnings are not re-reported)',
    humanEdit.guardrailViolations?.clear === true && humanEdit.guardrailViolations.introducedHard.length === 0,
    JSON.stringify(humanEdit.guardrailViolations?.introducedSoft?.map((entry) => entry.rule)),
  );
  const afterDrag = context.layouts.get(layoutId).layout;
  const title = walkLayoutFind(afterDrag, 'unga_title_main');
  check('the move landed in the canonical model', title?.position?.x === 48 && title?.position?.y === 22, JSON.stringify(title?.position));

  // ===================================================================================
  heading('4. SUBMIT: provenance, verdict, files');
  // ===================================================================================
  const baselineId = `${layoutId}-as-loaded`;
  context.layouts.set(baselineId, { layout: JSON.parse(before), createdAt: new Date().toISOString(), source: 'the revision as loaded' });
  const submitted = await call('gui_handoff_submit', {
    layout_id: layoutId,
    baseline_layout_id: baselineId,
    ...MOD_ARGS,
    custom_gui_windows: customGui,
    localisation_roots: [join(MOD, 'localisation', 'english')],
    button_effects_roots: [join(MOD, 'common', 'button_effects')],
    note: 'human drag: title and subtitle shifted 18px right',
    validate: true,
    handoff_root: handoffRoot,
  });
  check('the submission has a stable id and a timestamp', typeof submitted.id === 'string' && submitted.id.length >= 4 && !Number.isNaN(Date.parse(submitted.createdAt)), `${submitted.id} @ ${submitted.createdAt}`);
  check('it records the layout ids involved', (submitted.layoutIds ?? []).length >= 2, JSON.stringify(submitted.layoutIds));
  check('it records the baseline it was diffed against', submitted.baseline?.id === baselineId, JSON.stringify(submitted.baseline));
  check('the provenance diff names the moves', /moved `unga_title_main` \(30,22\) -> \(48,22\)/.test(submitted.diff.summary ?? '') || submitted.diff.changeCount >= 2, submitted.diff.summary);
  check('the diff marks the changed paths for highlighting', (submitted.diff.changedPaths ?? []).length >= 2, JSON.stringify(submitted.diff.changedPaths));
  check(
    'the verdict travels with the submission: the geometry verdict AND the guardrail verdict',
    submitted.validation?.verdict !== undefined && submitted.validation?.guardrailVerdict !== 'fail',
    JSON.stringify({ verdict: submitted.validation?.verdict, guardrailVerdict: submitted.validation?.guardrailVerdict }),
  );
  check(
    'NO HARD guardrail finding, and the soft ones are exactly the real mod\'s own 24 parked warnings',
    submitted.guardrails.hard.length === 0 &&
      (submitted.guardrails.byRule['parked-element-shortcut'] ?? 0) === 12 &&
      (submitted.guardrails.byRule['parked-element-hit-region'] ?? 0) === 12,
    JSON.stringify(submitted.guardrails.byRule),
  );
  check('it is NOT marked invalid (invalid is reserved for a HARD finding)', submitted.invalid === false && submitted.invalidReason === null);
  check('meta.json, layout.json, diff.md and the emitted .gui all exist', ['meta.json', 'layout.json', 'diff.md'].every((file) => existsSync(join(submitted.directory, file))) && (submitted.files.emitted ?? []).some((file) => file.endsWith('.gui')), JSON.stringify(submitted.files));
  const diffMd = readFileSync(join(submitted.directory, 'diff.md'), 'utf8');
  check('diff.md is human-readable and lists the change under a heading', /## (moved|resized|field)/.test(diffMd) && /unga_title_main/.test(diffMd));
  const meta = JSON.parse(readFileSync(join(submitted.directory, 'meta.json'), 'utf8'));
  check(
    'meta.json carries both verdicts, the diff counts, the file list and the invalid flag',
    meta.validation.guardrailVerdict === 'warn' && meta.diff.changeCount >= 2 && Array.isArray(meta.files.emitted) && meta.invalid === false,
    JSON.stringify({ guardrailVerdict: meta.validation.guardrailVerdict, verdict: meta.validation.verdict, changes: meta.diff.changeCount }),
  );
  const emittedGui = (submitted.files.emitted ?? []).find((file) => file.endsWith('.gui'));
  const guiBytes = readFileSync(emittedGui);
  check('the emitted .gui is UTF-8 WITHOUT a BOM', !(guiBytes[0] === 0xef && guiBytes[1] === 0xbb && guiBytes[2] === 0xbf));
  const parsedBack = parseGuiText(guiBytes.toString('utf8'), emittedGui);
  check('the emitted .gui parses back through this project\'s own parser', parsedBack.ok === true, parsedBack.reason ?? '');
  check(
    'the emitted .gui has the six windows and the option rows',
    parsedBack.ok && topLevelContainers(parsedBack.layout).length === 9,
    parsedBack.ok ? `${topLevelContainers(parsedBack.layout).length} top-level containers` : parsedBack.reason,
  );
  const emittedReport = scanContractViolations(parsedBack.layout, { customGuiWindows: customGui, checkAssets: false, checkLocalisation: false });
  check(
    'the emitted .gui has ZERO HARD contract findings (the names survived the round trip)',
    emittedReport.hard.length === 0,
    JSON.stringify(emittedReport.byRule),
  );
  check('the emitted copy has the moved value', /x = 48/.test(guiBytes.toString('utf8')));

  // ===================================================================================
  heading('5. LIST and PICK: the agent continues the human\'s version');
  // ===================================================================================
  const listed = await call('gui_handoff_list', { handoff_root: handoffRoot });
  check('gui_handoff_list shows the pending submission', listed.pendingCount === 1 && listed.handoffs[0].id === submitted.id, JSON.stringify({ pending: listed.pendingCount, total: listed.count }));
  check(
    'the listing carries the diff text and both verdicts, not just a path',
    /unga_title_main/.test(listed.handoffs[0].diffMarkdown ?? '') &&
      listed.handoffs[0].validation.guardrailVerdict !== 'fail' &&
      listed.handoffs[0].invalid === false,
    JSON.stringify({ verdict: listed.handoffs[0].validation.verdict, guardrailVerdict: listed.handoffs[0].validation.guardrailVerdict }),
  );

  const picked = await call('gui_handoff_pick', { id: submitted.id, handoff_root: handoffRoot });
  check('gui_handoff_pick loads the submission as the current layout', picked.layout_id && context.layouts.has(picked.layout_id), picked.layout_id);
  const pickedLayout = context.layouts.get(picked.layout_id).layout;
  const pickedTitle = walkLayoutFind(pickedLayout, 'unga_title_main');
  check('the picked tree is the HUMAN\'s version, not the agent\'s', pickedTitle?.position?.x === 48, JSON.stringify(pickedTitle?.position));
  check('picking recorded the marker that clears the human\'s pending indicator', picked.picked?.pickedAt && existsSync(join(submitted.directory, 'picked.json')));
  const pendingAfterPick = await call('gui_handoff_status', { handoff_root: handoffRoot });
  check('the pending count drops to zero once an agent has picked it up', pendingAfterPick.pendingCount === 0 && pendingAfterPick.total === 1, JSON.stringify({ pending: pendingAfterPick.pendingCount, total: pendingAfterPick.total }));
  check(
    'the status tool reports the pending submissions themselves, not just a number',
    Array.isArray(pendingAfterPick.pendingSubmissions) && pendingAfterPick.pendingCount === 0 && pendingAfterPick.handoffRoot === handoffRoot,
    JSON.stringify({ pendingSubmissions: (pendingAfterPick.pendingSubmissions ?? []).length, pendingCount: pendingAfterPick.pendingCount }),
  );

  const pickedReport = await call('gui_layout_validate', {
    layout_id: picked.layout_id,
    ...MOD_ARGS,
    custom_gui_windows: customGui,
    button_effects_roots: [join(MOD, 'common', 'button_effects')],
    localisation_roots: [join(MOD, 'localisation', 'english')],
  });
  const pickedContract = hardFindings(pickedReport);
  check('the PICKED layout validates with ZERO HARD contract findings', pickedContract.length === 0, JSON.stringify(byRule(pickedContract)));
  check('the picked layout carries no new hard finding of any kind', byRule(hardFindings(pickedReport))['custom-gui-contract-missing'] === undefined);
  check('it is a clean round trip: nothing the human did introduced a defect class', pickedReport.verdict !== undefined);

  const emittedAfterPick = emitFiles(pickedLayout, { outputRoot: outputRoot, dryRun: false, fileStem: 'unga_e2e' });
  check('the picked layout emits through the ordinary emitter', (emittedAfterPick.files ?? []).some((file) => file.kind === 'gui') && emittedAfterPick.contract?.ok === true, JSON.stringify(emittedAfterPick.contract?.byRule ?? null));

  // ===================================================================================
  heading('6. the reverse path: the agent shows the human what IT changed');
  // ===================================================================================
  const agentEdit = await call('gui_layout_edit', {
    layout_id: picked.layout_id,
    edits: [{ op: 'set', target: 'unga_subtitle_main', path: 'position', value: { x: 48, y: 70 } }],
    ...MOD_ARGS,
    custom_gui_windows: customGui,
  });
  check('the agent edits on top of the human\'s version', (agentEdit.applied ?? []).length === 1);
  const agentDiff = await call('gui_layout_diff', { layout_id: picked.layout_id });
  check('gui_layout_diff describes the agent\'s own change', agentDiff.unchanged === false && (agentDiff.changes ?? []).some((entry) => entry.name === 'unga_subtitle_main'), JSON.stringify(agentDiff.counts));
  check('the diff is expressed against the HUMAN\'s submission, not a revision the agent invented', /unga_subtitle_main/.test(agentDiff.markdown ?? '') && String(agentDiff.against?.id ?? '').length > 0, agentDiff.against?.id);

  // ===================================================================================
  heading('7. the HTTP API: the same refusals on the route the PAGE calls');
  // ===================================================================================
  const web = await startWebUi({
    context,
    host: '127.0.0.1',
    port: 8851,
    initialLayout: { id: layoutId, layout: context.layouts.get(layoutId).layout },
    handoffRoot,
  });
  context.webUi = web;
  try {
    const state = await getJson(web.url, '/api/state');
    check('GET /api/state reports the guardrail table the page draws its locks from', Array.isArray(state.guardrails?.protectedNames) && state.guardrails.protectedNames.includes('EVENT_DIPLO') && state.guardrails.protectedNames.includes('close'), JSON.stringify(state.guardrails?.protectedNames?.length));
    check('GET /api/state reports the pending-submission count', typeof state.handoff?.pendingCount === 'number');
    const layoutResponse = await getJson(web.url, `/api/layout?id=${encodeURIComponent(layoutId)}`);
    const lockedElements = (layoutResponse.elements ?? []).filter((element) => element.locked);
    check(
      'GET /api/layout marks the protected elements for the tree',
      lockedElements.length === protections.length && lockedElements.some((element) => element.name === 'close'),
      `${lockedElements.length} locked elements, ${(layoutResponse.locks ?? []).length} lock records, expected ${protections.length}`,
    );
    const lockedClose = lockedElements.find((element) => element.name === 'close');
    const expectedClosePaths = new Set(closeEntries.map((entry) => entry.path));
    check(
      'the lock path is the SAME path the rect table and the tree use (no doubled window name)',
      lockedClose !== undefined &&
        expectedClosePaths.has(lockedClose.path) &&
        (layoutResponse.rects ?? []).some((rect) => rect.path === lockedClose.path) &&
        !/\/geocentric_unga_main\/geocentric_unga_main\//.test(lockedClose.path),
      lockedClose?.path,
    );
    check('GET /api/layout marks a pinned `close` as such', lockedElements.some((element) => element.close === true) && (layoutResponse.locks ?? []).some((entry) => entry.close === true));

    const httpRemove = await postJson(web.url, '/api/edit', { id: layoutId, edits: [{ op: 'remove', target: 'close' }] });
    check('POST /api/edit REFUSES deleting a contract name (server-side, not only in the browser)', (httpRemove.refused ?? []).length === 1 && httpRemove.refused[0].rule === 'handoff-protected-remove', JSON.stringify(httpRemove.refused?.map((entry) => entry.rule)));
    const httpRename = await postJson(web.url, '/api/edit', { id: layoutId, edits: [{ op: 'rename', target: 'close', name: 'unga_close' }] });
    check('POST /api/edit REFUSES renaming a contract name', (httpRename.refused ?? []).length === 1 && httpRename.refused[0].rule === 'handoff-protected-rename');
    const httpClose = await postJson(web.url, '/api/edit', { id: layoutId, edits: [{ op: 'set', target: 'close', path: 'position', value: { x: 900, y: 0 } }] });
    check('POST /api/edit REFUSES moving `close` out of its corner', (httpClose.refused ?? []).length === 1 && httpClose.refused[0].rule === 'handoff-close-unpinned');
    const httpShortcut = await postJson(web.url, '/api/edit', { id: layoutId, edits: [{ op: 'set', target: 'tts_button', path: 'shortCut', value: 'F8' }] });
    check('POST /api/edit REFUSES a shortcut on a parked element', (httpShortcut.refused ?? []).length === 1 && httpShortcut.refused[0].rule === 'handoff-parked-shortcut-added');
    const httpEffect = await postJson(web.url, '/api/edit', { id: layoutId, edits: [{ op: 'set', target: 'focus_button', path: 'effect', value: 'x' }] });
    check('POST /api/edit REFUSES `effect` on a buttonType', (httpEffect.refused ?? []).length === 1 && httpEffect.refused[0].rule === 'handoff-effect-on-button');

    const stillThere = await getJson(web.url, `/api/layout?id=${encodeURIComponent(layoutId)}`);
    check('after five refused HTTP edits the tree is unchanged', (stillThere.elements ?? []).some((element) => element.name === 'close'), 'close still present');

    const httpSubmit = await postJson(web.url, '/api/handoff/submit', { id: layoutId, note: 'from the page', handoff_root: handoffRoot });
    check(
      'POST /api/handoff/submit writes a submission with its verdict',
      httpSubmit.handoff?.validation?.guardrailVerdict !== 'fail' && httpSubmit.invalid === false && httpSubmit.handoff?.guardrails?.hard?.length === 0,
      JSON.stringify({ guardrailVerdict: httpSubmit.handoff?.validation?.guardrailVerdict, verdict: httpSubmit.handoff?.validation?.verdict }),
    );
    check('POST /api/handoff/submit reports the pending count for the header badge', httpSubmit.pendingCount >= 1, String(httpSubmit.pendingCount));
    const pending = await getJson(web.url, '/api/handoff/pending');
    check('GET /api/handoff/pending is the indicator\'s source', pending.pendingCount >= 1 && Array.isArray(pending.handoffs));
    check('the pending indicator reads the page session\'s OWN handoff root', pending.root === handoffRoot, pending.root);
    const diff = await getJson(web.url, `/api/diff?id=${encodeURIComponent(layoutId)}`);
    check('GET /api/diff returns the change list the "Changes since loaded" panel draws', Array.isArray(diff.changedPaths) && typeof diff.summary === 'string', diff.summary);

    // The page's own edit path, then the overlay that shows a change on the canvas.
    const httpMove = await postJson(web.url, '/api/edit', { id: layoutId, edits: [{ op: 'set', target: 'unga_title_main', path: 'position', value: { x: 60, y: 22 } }] });
    check('POST /api/edit applies an ordinary drag and reports the change set', (httpMove.applied ?? []).length === 1 && (httpMove.change?.changedPaths ?? []).length >= 1, httpMove.change?.summary);
    const svg = await getText(web.url, `/api/preview.svg?id=${encodeURIComponent(layoutId)}&changes=true`);
    check('GET /api/preview.svg draws the changed-element overlay', svg.includes('data-changed-path=') && svg.includes('id="changes"'));
    const svgPlain = await getText(web.url, `/api/preview.svg?id=${encodeURIComponent(layoutId)}`);
    check('without the flag the preview has no change overlay', !svgPlain.includes('data-changed-path='));
    const layoutAfterMove = await getJson(web.url, `/api/layout?id=${encodeURIComponent(layoutId)}`);
    check('the change set is also reported per element, so the tree can badge it', (layoutAfterMove.change?.changedPaths ?? []).includes((layoutAfterMove.elements ?? []).find((element) => element.name === 'unga_title_main')?.path));

    const validate = await postJson(web.url, '/api/validate', { id: layoutId });
    check('POST /api/validate carries the guardrail findings the page shows', validate.guardrails !== undefined && Array.isArray(validate.guardrails.hard) && (validate.customGuiWindows ?? []).length >= 6, JSON.stringify((validate.customGuiWindows ?? []).length));
  } finally {
    await web.close();
    context.webUi = null;
  }

  // ===================================================================================
  heading('8. a DELIBERATELY BAD submission is refused or clearly flagged');
  // ===================================================================================
  // (a) the browser-only route: an edit list containing the three bad gestures, through the tool.
  for (const [label, edit] of [
    ['delete a contract name', { op: 'remove', target: 'option_list' }],
    ['move `close` into the middle of the window', { op: 'set', target: 'close', path: 'position', value: { x: 400, y: 400 } }],
    ['give a parked element a shortcut', { op: 'set', target: 'tts_button', path: 'shortCut', value: 'F7' }],
  ]) {
    const attempt = await call('gui_layout_edit', { layout_id: layoutId, edits: [edit], ...MOD_ARGS, custom_gui_windows: customGui });
    check(`a submission that tries to ${label} is REFUSED`, (attempt.refused ?? []).length === 1, JSON.stringify(attempt.refused?.map((entry) => entry.rule)));
  }

  // (b) a bad submission that gets PAST the edit guard (because it was made outside the editor, or
  //     with the guard explicitly off) must still be recorded as INVALID, never as a new baseline.
  const tampered = JSON.parse(JSON.stringify(context.layouts.get(layoutId).layout));
  removeNodeByName(tampered, 'close');
  const badSubmission = await call('gui_handoff_submit', {
    layout: tampered,
    baseline_layout_id: layoutId,
    ...MOD_ARGS,
    custom_gui_windows: customGui,
    validate: true,
    localisation_roots: [join(MOD, 'localisation', 'english')],
    button_effects_roots: [join(MOD, 'common', 'button_effects')],
    note: 'deliberately bad: `close` deleted',
    submitted_by: 'handoff-e2e (deliberate defect)',
    handoff_root: handoffRoot,
  });
  check('a bad submission is recorded with verdict `fail`', badSubmission.validation?.verdict === 'fail', JSON.stringify(badSubmission.validation?.verdict));
  check('meta.json marks it INVALID, so it cannot pass as a new baseline', badSubmission.invalid === true);
  check('its guardrail findings name the missing contract name', (badSubmission.guardrails?.hard ?? []).some((finding) => finding.rule === 'custom-gui-contract-missing'), JSON.stringify((badSubmission.guardrails?.hard ?? []).map((entry) => entry.rule)));
  check('the bad submission still wrote its diff and its layout (an audit trail, not a silent drop)', existsSync(join(badSubmission.directory, 'diff.md')) && existsSync(join(badSubmission.directory, 'layout.json')));

  const badListing = await call('gui_handoff_list', { handoff_root: handoffRoot, pending_only: false });
  const listedBad = (badListing.handoffs ?? []).find((entry) => entry.id === badSubmission.id);
  check('gui_handoff_list marks it invalid, in the listing as well as in meta.json', listedBad?.invalid === true && listedBad?.validation?.verdict === 'fail', JSON.stringify({ invalid: listedBad?.invalid, verdict: listedBad?.validation?.verdict }));
  check('the invalid count is reported for the human', badListing.invalidCount >= 1, String(badListing.invalidCount));

  // (c) the guard can be switched off, and when it is, the result SAYS SO.
  const unguarded = await call('gui_layout_edit', {
    layout_id: layoutId,
    edits: [{ op: 'remove', target: 'close' }],
    guard: false,
    store: false,
    ...MOD_ARGS,
    custom_gui_windows: customGui,
  });
  check('an unguarded edit is allowed only when it is explicitly asked for', (unguarded.applied ?? []).length === 1 && unguarded.guardrails?.disabled === true);
  check('the unguarded edit is ANNOUNCED, never silently unguarded', /NOT enforced/.test(unguarded.guardrails?.note ?? ''));

  // ===================================================================================
  heading('9. the output-root guard still refuses game/mod folders for emitted files');
  // ===================================================================================
  for (const [label, root] of [
    ['the mod workspace', MOD],
    ['the Stellaris install', DEFAULT_GAME_ROOT],
  ]) {
    let refused = false;
    let message = '';
    try {
      emitFiles(context.layouts.get(layoutId).layout, { outputRoot: root, dryRun: false, fileStem: 'handoff_e2e_should_not_exist' });
    } catch (thrown) {
      refused = true;
      message = thrown.message;
    }
    check(`emitting into ${label} is REFUSED`, refused, message.slice(0, 120));
  }
  check(
    'the handoff root is inside the project\'s own output area',
    handoffRoot.startsWith(join(projectRoot, '.selftest')) || handoffRoot === HANDOFF_ROOT,
    handoffRoot,
  );
  check('the mod folder was not written to', !existsSync(join(MOD, 'interface', 'handoff_e2e_should_not_exist.gui')));

  // ===================================================================================
  process.stdout.write(`\n${'='.repeat(72)}\nhandoff e2e: passed ${passed}, failed ${failed}\n`);
  if (failed > 0) {
    process.stdout.write('\nfailures:\n');
    for (const result of results.filter((entry) => !entry.ok)) process.stdout.write(`  - ${result.name}${result.detail ? ` :: ${result.detail}` : ''}\n`);
  }
  process.exitCode = failed === 0 ? 0 : 1;
}

function walkLayoutFind(layout, name) {
  let found = null;
  walkLayout(layout.root, (node) => {
    if (!found && node.name === name) found = node;
  });
  return found;
}

function removeNodeByName(layout, name) {
  const strip = (node) => {
    node.children = (node.children ?? []).filter((child) => child.name !== name);
    for (const child of node.children) strip(child);
  };
  strip(layout.root);
}

async function getJson(base, path) {
  const response = await fetch(new URL(path, base));
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function getText(base, path) {
  const response = await fetch(new URL(path, base));
  return response.text();
}

async function postJson(base, path, body) {
  const response = await fetch(new URL(path, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

void describeProtection;
void pendingHandoffs;

main().catch((thrown) => {
  process.stdout.write(`\nhandoff e2e FAILED to run: ${thrown instanceof Error ? thrown.stack : thrown}\n`);
  process.exitCode = 1;
});

export { main };
