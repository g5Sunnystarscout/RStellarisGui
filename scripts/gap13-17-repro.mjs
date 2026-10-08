#!/usr/bin/env node
//------------------------------------------------------------------------------------
// gap13-17-repro.mjs -- Part of RStellarisGui
//
// THE IN-GAME PROBE, RUN AGAINST THE PLUGIN, FILE BY FILE. The five gaps of 2026-10-06
// (`<clone>\unga-fix\PLUGIN-GAPS.md`, GAP-13 ... GAP-17) were each produced by feeding a probe mod
// to Stellaris 4.4.6 and reading `error.log`; the plugin's OWN answer to the same file is what this
// script prints, with the engine's measured answer beside it. Nothing here writes to a mod or to the
// game: the probe files are READ, and the one fixture that does not exist on disk (GAP-15's
// `visible = no` on a container) is injected into the file's TEXT in memory.
//
//   node scripts/gap13-17-repro.mjs
//   node scripts/gap13-17-repro.mjs --probe-root <mods> --install <Stellaris>
//
// Exit code 0 when every reproduction ends in the answer the engine's log recorded, 1 otherwise.
// A probe file that is no longer on disk is reported as SKIP, not as a failure: these are another
// workspace's artifacts.
//
// THE BEFORE COLUMN IS RECORDED, NOT RE-MEASURED. It is what the plugin answered at commit 355d08a
// (the commit the gaps were filed against), produced by running each reproduction against that
// checkout - GAP-13/15/16: `checkGuiSyntax` over `zz_gui_probe_grid.gui` reported 0 findings and
// `gui_layout_validate` reported `engine-populated-container-children` as a WARNING; GAP-14: a
// same-relative-path override was reported as a `container-name-collision` ERROR; GAP-17: nothing
// checked the name at all, and the emitter/event messages asserted a requirement the engine does not
// have. The AFTER column is measured live, on every run.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkFiles } from './../src/lib/filecheck.mjs';
import { checkGuiSyntax } from './../src/lib/syntax.mjs';
import { validateGuiText } from './../src/lib/validate.mjs';

const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const PROBE_ROOT = arg('--probe-root', '<mods>');
const INSTALL = arg('--install', '<Stellaris>');

const GRID = join(PROBE_ROOT, 'gui_probe_grid', 'interface', 'zz_gui_probe_grid.gui');
const Q2_EVENTS = join(PROBE_ROOT, 'gui_probe_q2', 'events', 'zz_gui_probe_q2_events.txt');
const Q2_GUI = join(PROBE_ROOT, 'gui_probe_q2', 'interface', 'zz_gui_probe_q2.gui');
const OVR_ALPHA = join(PROBE_ROOT, 'gui_probe_ovr_alpha', 'interface', 'input_blocker.gui');
const OVR_BETA = join(PROBE_ROOT, 'gui_probe_ovr_beta', 'interface', 'input_blocker.gui');

const results = [];
const record = (gap, what, engineSaid, before, after, ok) => {
  results.push({ gap, what, engineSaid, before, after, ok });
  process.stdout.write(
    `${ok ? 'ok  ' : 'FAIL'} ${gap.padEnd(7)} ${what}\n` +
      `       engine : ${engineSaid}\n` +
      `       before : ${before}\n` +
      `       after  : ${after}\n`,
  );
};
const skip = (gap, what, why) => process.stdout.write(`skip ${gap.padEnd(7)} ${what} (${why})\n`);

// =====================================================================================
// GAP-13 / GAP-16 - a child element and an unknown scalar inside/among grid boxes
//
// The engine's four lines, verbatim (PROBE-RESULTS.md section 2, run B), on this exact file:
//   Unexpected token: instantTextBoxType, near line: 31   (a child ELEMENT of a gridBoxType)
//   Unexpected token: probeZZtokenInGrid,  near line: 49   (an unknown scalar in a grid box)
//   Unexpected token: containerWindowType, near line: 60   (a nested container in a grid box)
//   Unexpected token: probeZZtokenInHost,  near line: 83   (an unknown scalar in a host container)
// =====================================================================================
const ENGINE_TOKENS = [
  'Unexpected token: instantTextBoxType, near line: 31',
  'Unexpected token: probeZZtokenInGrid, near line: 49',
  'Unexpected token: containerWindowType, near line: 60',
  'Unexpected token: probeZZtokenInHost, near line: 83',
];
if (!existsSync(GRID)) {
  skip('GAP-13', 'the grid probe file', GRID);
  skip('GAP-16', 'the grid probe file', GRID);
} else {
  const text = readFileSync(GRID, 'utf8');
  const syntax = checkGuiSyntax(text, GRID);
  const named = syntax.findings.map((finding) => finding.engineMessage);
  const missing = ENGINE_TOKENS.filter((engineMessage) => !named.includes(engineMessage));
  record(
    'GAP-16',
    'unknown-token rule over the probe file the engine answered with 4 token lines',
    `${ENGINE_TOKENS.length} persistent.cpp:41 lines`,
    'checkGuiSyntax: 0 findings (the file passed the syntax gate)',
    `checkGuiSyntax: ${syntax.counts.total} findings, ${syntax.counts.error} errors, ${missing.length} of the engine's tokens missing`,
    missing.length === 0 && syntax.counts.error === 4,
  );

  const populated = syntax.findings.filter((finding) => finding.rule === 'engine-populated-container-children');
  const validated = validateGuiText(text, GRID, { checkAssets: false, checkLocalisation: false });
  record(
    'GAP-13',
    'a child ELEMENT inside an engine-populated container',
    `${populated.length} "Unexpected token: <child keyword>" lines, at FILE LOAD, whole child block skipped`,
    'engine-populated-container-children: warning ("is not laid out by it"); validate: warning',
    `syntax: ${populated.length} x error, spans ${populated.map((finding) => `${finding.blockSpan?.open}-${finding.blockSpan?.close}`).join(', ')}; validate: ${validated.byRule['engine-populated-container-children'] ?? 0} x error`,
    populated.length === 2 &&
      populated.every((finding) => finding.severity === 'error') &&
      (validated.byRule['engine-populated-container-children'] ?? 0) === 2,
  );
  // The engine never descends into the child it rejected, so its own bogus token (line 64, inside the
  // nested container) is absent from the log. The plugin says the same thing, and that is a claim
  // worth reproducing rather than a silence worth hiding.
  record(
    'GAP-13',
    'the client token INSIDE the rejected child is not reported (the engine never read it)',
    'no line for probeZZtokenInGridChild (line 64): the reader skipped the subtree',
    'not reported either (no rule saw a scalar there)',
    `reported by neither: ${!named.some((engineMessage) => /probeZZtokenInGridChild/.test(engineMessage ?? ''))}`,
    !named.some((engineMessage) => /probeZZtokenInGridChild/.test(engineMessage ?? '')),
  );
}

// =====================================================================================
// GAP-15 - `visible` on a containerWindowType
//
// The gap's own smallest reproduction: the probe's FIRST cut carried `visible = no` on the host
// container at line 17 and the engine answered
//   [persistent.cpp:41]: Error: "Unexpected token: visible, near line: 17" in file: "interface/input_blocker.gui"
// and derailed the rest of the enclosing block. That line is injected into the file's text here - the
// mod on disk was fixed for runs B/C and is not written to.
// =====================================================================================
if (!existsSync(GRID)) {
  skip('GAP-15', 'the grid probe file', GRID);
} else {
  const lines = readFileSync(GRID, 'utf8').split('\n');
  const hostName = lines.findIndex((line) => line.includes('name = "gui_probe_grid_host"'));
  lines.splice(hostName + 1, 0, '\t\tvisible = no');
  const injected = lines.join('\n');
  const syntax = checkGuiSyntax(injected, `${GRID} (+ visible on the host container)`);
  const finding = syntax.findings.find((item) => /visible/.test(item.message ?? ''));
  record(
    'GAP-15',
    '`visible` on a containerWindowType',
    'Unexpected token: visible, near line: <the injected line>, and the rest of the block is derailed',
    'no finding at all: the field was not modelled, so the file validated clean',
    `field-not-accepted ${finding?.severity ?? '(none)'} at line ${finding?.line ?? '-'}: ${finding?.engineMessage ?? '(none)'}`,
    finding?.severity === 'error' &&
      finding?.rule === 'field-not-accepted' &&
      /derails the REST of the container block/.test(finding?.message ?? ''),
  );
}

// =====================================================================================
// GAP-14 - two providers of ONE relative `.gui` path
//
// Measured in game (PROBE-RESULTS.md section 3): with `... ovr_alpha -> ovr_beta` in `dlc_load.json`
// only beta's file is read; with the entries swapped only alpha's is. So one relative path is an
// OVERRIDE - the loser is never parsed - and only two DIFFERENT relative paths make a collision. The
// index below is the two-provider situation as data, built from the two real probe files' own paths.
// =====================================================================================
if (!existsSync(OVR_ALPHA) || !existsSync(OVR_BETA)) {
  skip('GAP-14', 'the two override probe files', `${OVR_ALPHA} / ${OVR_BETA}`);
} else {
  // `checkAssets` must stay ON: it is the flag the container-name check hangs off, and turning it off
  // is exactly how a caller gets silence instead of a report.
  const samePathAssets = {
    root: INSTALL,
    roots: [INSTALL, join(PROBE_ROOT, 'gui_probe_ovr_alpha'), join(PROBE_ROOT, 'gui_probe_ovr_beta')],
    containers: {
      input_blocker: { file: 'interface/input_blocker.gui', line: 3, root: join(PROBE_ROOT, 'gui_probe_ovr_beta') },
    },
  };
  const overrideReport = validateGuiText(readFileSync(OVR_ALPHA, 'utf8'), OVR_ALPHA, {
    assets: samePathAssets,
    sourceFiles: [OVR_ALPHA],
  });
  const overrideFinding = overrideReport.findings.find((item) => item.rule === 'container-path-override');
  record(
    'GAP-14',
    'two providers of the SAME relative path (interface/input_blocker.gui)',
    'one file is loaded (the LAST dlc_load.json entry); the loser is never parsed',
    'container-name-collision: 1 ERROR ("would resolve to the vanilla window ... not to yours")',
    `container-path-override: ${overrideFinding ? 1 : 0} ${overrideFinding?.severity ?? ''}, collision ${overrideReport.byRule['container-name-collision'] ?? 0}`,
    Boolean(overrideFinding) &&
      overrideFinding.severity === 'info' &&
      (overrideReport.byRule['container-name-collision'] ?? 0) === 0 &&
      /LAST `dlc_load\.json` entry/.test(overrideFinding.message ?? ''),
  );
  // The same name, declared by a file at a DIFFERENT relative path: both load, so it is a collision.
  const minePath = join(PROBE_ROOT, 'gui_probe_ovr_alpha', 'interface', 'zz_mine.gui');
  const collisionReport = validateGuiText(readFileSync(OVR_ALPHA, 'utf8'), minePath, {
    assets: samePathAssets,
    sourceFiles: [minePath],
  });
  const collision = collisionReport.findings.find((item) => item.rule === 'container-name-collision');
  record(
    'GAP-14',
    'two providers at DIFFERENT relative paths (the genuine-collision half)',
    'both files load and both declare the name - the engine reports a duplicate',
    'container-name-collision: 1 ERROR (the same answer, but for the wrong reason)',
    `container-name-collision: ${collision ? 1 : 0} ${collision?.severity ?? ''}, both relative paths named: ${/DIFFERENT relative paths/.test(collision?.message ?? '')}`,
    collision?.severity === 'error' && /DIFFERENT relative paths/.test(collision?.message ?? ''),
  );
}

// =====================================================================================
// GAP-17 - an unresolvable custom_gui name
//
// The engine, in a loaded game (run F and the v2 run the same night): one `gui.cpp:1057` line, then the
// ten-name `ok_popup_window` cascade, then EXCEPTION_ACCESS_VIOLATION - on the `diplomatic = yes` event
// ONLY. The same kind of name without `diplomatic` wrote NOTHING at all (not even the lookup line, 0
// occurrences in the whole log) and the engine drew the ordinary default event window instead. The six
// probe events are still on disk, so the plugin is asked about exactly the events the engine was fed;
// the mod's own `.gui` is passed alongside so a name that DOES exist is resolvable.
// =====================================================================================
if (!existsSync(Q2_EVENTS)) {
  skip('GAP-17', 'the q2 probe events file', Q2_EVENTS);
} else {
  const paths = [Q2_EVENTS];
  if (existsSync(Q2_GUI)) paths.push(Q2_GUI);
  const report = checkFiles({ paths, languages: ['english'], roots: [], assets: null, checkLocKeys: false });
  const byEvent = (id) =>
    report.findings.filter((finding) => finding.rule === 'custom-gui-unknown-window' && new RegExp(`event ${id.replace('.', '\\.')}\\]`).test(finding.where ?? ''));
  const crashCase = byEvent('gui_probe_q2.4')[0];
  const fallbackCase = byEvent('gui_probe_q2.3')[0];
  const resolved = [...byEvent('gui_probe_q2.1'), ...byEvent('gui_probe_q2.2')];
  // The probe gave `.3` and `.4` DIFFERENT bogus names after the run that could not tell them apart,
  // so the name is read out of the finding rather than typed: what is asserted is the statement, not
  // the spelling.
  const quotedEngineLine = /Tried to get gui_type \[gui_probe_q2_zzz_no_such_window[A-Za-z_]*\] which does not exist/.test(
    crashCase?.engineMessage ?? '',
  );
  record(
    'GAP-17',
    'unresolvable name on a `diplomatic = yes` event (.4)',
    'one gui.cpp:1057 line, ten containerwindow.h:88 lines, then EXCEPTION_ACCESS_VIOLATION',
    'no rule at all: the name was never validated anywhere',
    `${crashCase?.rule ?? '(none)'}: ${crashCase?.severity ?? '(none)'}, engine line quoted: ${quotedEngineLine} (${crashCase?.engineMessage ?? '-'})`,
    crashCase?.severity === 'error' && quotedEngineLine,
  );
  record(
    'GAP-17',
    'the SAME kind of name without `diplomatic` (.3)',
    'no line at all, not even the lookup line; no crash; the ordinary default event window is drawn',
    'no rule at all',
    `${fallbackCase?.rule ?? '(none)'}: ${fallbackCase?.severity ?? '(none)'}`,
    fallbackCase?.severity === 'warning',
  );
  record(
    'GAP-17',
    'the control: names that DO resolve (.1 diplomatic, .2 not)',
    'a diplomatic window (.1) and an event window (.2) appear',
    'no rule at all',
    `${resolved.length} findings`,
    resolved.length === 0,
  );
}

// =====================================================================================
process.stdout.write(`\n${'='.repeat(72)}\n`);
const failed = results.filter((entry) => !entry.ok);
const skipped = 5 - new Set(results.map((entry) => entry.gap)).size;
process.stdout.write(
  `${results.length} reproductions run, ${results.length - failed.length} match the engine, ${failed.length} do not` +
    (skipped > 0 ? `, ${skipped} gap(s) skipped for missing probe files` : '') +
    '\n',
);
for (const entry of failed) process.stdout.write(`  FAIL ${entry.gap}: ${entry.what}\n`);
process.exitCode = failed.length === 0 ? 0 : 1;

export default { ENGINE_TOKENS };
