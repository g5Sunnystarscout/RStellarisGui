//------------------------------------------------------------------------------------
// logscan.mjs -- Part of RStellarisGui
//
// THE ENGINE'S OWN ACCOUNT OF WHAT WAS CLICKED. An agent cannot see the screen, so the only
// instrument that answers "what did that button actually do" is the game's log. Two lines carry
// almost all of it:
//
//   game.log
//     `eventcommands.cpp:88 Event <id> added info about event selection. selectedOption N, human H,
//      playerEventId P`
//     - one line per option the player selected, in order. This is the line that proved the close
//     button selects OPTION 0: an `effectbuttonType` log entry ("CLOSE button pressed") is followed
//     immediately by `selectedOption 0`, and then by a SECOND selection of the same event one
//     second later - i.e. the window closed and re-opened. Several rounds of this project were
//     spent inferring that from screenshots; the line was there the whole time.
//
//   error.log
//     `Could not find <name> in window <window>`   a MISSING CONTRACT ELEMENT. If this ever
//     appears, src/lib/contract.mjs should have reported it before the game ran.
//     `Unexpected token: <field>`                  a field the engine's kind parser rejected.
//     `Wrong scope for effect`                     script run in the wrong scope (a planet-panel
//     button effect runs in the SELECTED OBJECT's scope, so a `country_event`/`add_resource`/
//     `add_modifier` needs `owner = { }`).
//     `Event <id> has no options`
//     `Missing localization key [key]`
//
// The scanner orders the whole log by timestamp, so "the window re-opened" is a fact you can read
// rather than a hypothesis. Timestamps in Stellaris logs are `[HH:MM:SS]` or a bare `HH:MM:SS`.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync } from 'node:fs';

import { listFilesRecursive, readTextFile } from './paths.mjs';

/** `[02:11:38]` or `02:11:38` at the start of a line. */
const TIMESTAMP = /^\s*\[?(\d{2}:\d{2}:\d{2})\]?/;

const PATTERNS = [
  {
    kind: 'event-selection',
    rule: 'log-event-selection',
    severity: 'info',
    source: /Event\s+([A-Za-z0-9_.]+)\s+added info about event selection\.\s*selectedOption\s+(\d+),\s*human\s+(\d+),\s*playerEventId\s+(\d+)/,
    fields: (match) => ({ eventId: match[1], option: Number(match[2]), human: Number(match[3]), playerEventId: Number(match[4]) }),
  },
  {
    kind: 'missing-contract-element',
    rule: 'log-contract-missing',
    severity: 'error',
    source: /Could not find\s+(.+?)\s+in window\s+(\S+)/,
    fields: (match) => ({ element: match[1].trim(), window: match[2] }),
  },
  {
    kind: 'unexpected-token',
    rule: 'log-unexpected-token',
    severity: 'error',
    source: /Unexpected token:\s*([A-Za-z0-9_]+)/,
    fields: (match) => ({ field: match[1] }),
  },
  {
    kind: 'wrong-scope',
    rule: 'log-wrong-scope',
    severity: 'error',
    source: /Wrong scope for effect/i,
    fields: () => ({}),
  },
  {
    kind: 'event-without-option',
    rule: 'log-event-without-option',
    severity: 'error',
    source: /Event\s+([A-Za-z0-9_.]+)\s+has no options/,
    fields: (match) => ({ eventId: match[1] }),
  },
  {
    kind: 'missing-localisation',
    rule: 'log-missing-localisation',
    severity: 'warning',
    source: /Missing localization key \[([^\]]+)\]/i,
    fields: (match) => ({ key: match[1] }),
  },
  {
    kind: 'orphan-close',
    rule: 'log-orphan-close',
    severity: 'warning',
    // A close/back button whose effect fired while no event window was open: the flag was set and
    // never consumed, which is what a close button that does nothing looks like from the log side.
    source: /(?:close|back)_(?:button|click)|CLOSE button|close button/i,
    fields: () => ({}),
  },
];

/** The `.gui` / `.txt` / `.yml` path an engine line names, when it names one. */
function fileOf(line) {
  const quoted = /file:\s*"([^"]+)"/.exec(line);
  if (quoted) return quoted[1];
  const named = /in file:\s*"([^"]+)"/.exec(line);
  return named ? named[1] : null;
}

/**
 * Scan one log's text.
 *
 * @param {string} text
 * @param {{file?: string}} options
 * @returns {{entries: object[], counts: object, byKind: object}}
 */
export function scanLogText(text, options = {}) {
  const entries = [];
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/^\uFEFF/, '');
    if (line.trim() === '') continue;
    const time = TIMESTAMP.exec(line)?.[1] ?? null;
    for (const pattern of PATTERNS) {
      const match = pattern.source.exec(line);
      if (!match) continue;
      entries.push({
        kind: pattern.kind,
        rule: pattern.rule,
        severity: pattern.severity,
        line: index + 1,
        time,
        file: fileOf(line),
        message: line.trim().slice(0, 400),
        ...pattern.fields(match),
      });
      break; // one classification per line: the first pattern that matches is the most specific
    }
  }
  const byKind = {};
  for (const entry of entries) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  const counts = { total: entries.length, error: 0, warning: 0, info: 0 };
  for (const entry of entries) counts[entry.severity] += 1;
  return { entries, counts, byKind, file: options.file ?? null };
}

/** Seconds since midnight for an `HH:MM:SS`, or null. */
function secondsOf(time) {
  if (!time) return null;
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Find the "the window closed and immediately re-opened" signature.
 *
 * TWO option-0 selections of the SAME event, within `withinSeconds`. Both halves are required, and
 * the second one is what makes this specific:
 *
 *   * option 0 is the engine's close control, so the first selection is a close (or the first row of
 *     the side panel, which for the window's own event is the same thing);
 *   * an option-0 selection AFTER that means the event was re-created and closed again - or, if the
 *     window is still up, that it never went away. Either way the close did not take.
 *
 * Measured on the trial mod, both ways round:
 *   * BEFORE the fix - `selectedOption 0, playerEventId 9` then `selectedOption 0, playerEventId 10`
 *     one second later: the window came straight back.
 *   * AFTER the fix - a close (`selectedOption 0`) is followed by a NAVIGATION row
 *     (`selectedOption 1`, 3 s later) and never by another option 0, so this returns nothing. A rule
 *     that fired on "same event twice" alone reported that healthy sequence as a re-open.
 *
 * @param {object[]} selections entries of kind `event-selection`, in log order
 */
export function findReopenCycles(selections, options = {}) {
  const withinSeconds = options.withinSeconds ?? 3;
  const cycles = [];
  for (let index = 0; index < selections.length - 1; index += 1) {
    const first = selections[index];
    const second = selections[index + 1];
    if (first.eventId !== second.eventId) continue;
    if (first.option !== 0 || second.option !== 0) continue;
    const a = secondsOf(first.time);
    const b = secondsOf(second.time);
    if (a === null || b === null || b - a > withinSeconds || b < a) continue;
    cycles.push({
      eventId: first.eventId,
      first,
      second,
      seconds: b - a,
      message:
        `event \`${first.eventId}\` was selected as OPTION 0 twice, ${b - a}s apart. The engine's close control selects ` +
        'option 0, so this is the "closed for one frame, then straight back" signature: option 0 (or the scripted effect ' +
        'it calls) re-fired the event whose window had just been closed. The fix is the close flag discriminator ' +
        '(docs/gui-pitfalls.md, "close selects option 0") - `has_active_event` cannot see it because the event is ' +
        'already consumed by the time the option runs.',
    });
  }
  return cycles;
}

/**
 * Read and scan the engine's logs for a user-data folder.
 *
 * @param {{documentsRoot?: string|null, logs?: string[], gameLog?: string, errorLog?: string,
 *          withinSeconds?: number}} options
 */
export function scanEngineLogs(options = {}) {
  const games = options.gameLog ? [options.gameLog] : [];
  const errors = options.errorLog ? [options.errorLog] : [];
  if (options.logs?.length) games.push(...options.logs);
  if (games.length === 0 && options.documentsRoot) {
    games.push(`${options.documentsRoot}\\logs\\game.log`);
    errors.push(`${options.documentsRoot}\\logs\\error.log`);
  }
  // `logs/` may hold rotated files: take every file whose NAME contains `.log`, which covers
  // `game.log`, `error.log` and the rotated `game.log.1` / `game.log.2` a launcher leaves behind.
  // Filtering on the extension alone would silently miss every rotated file.
  const expand = (paths) =>
    paths.flatMap((path) => {
      if (/\.log(\.|$)/i.test(path)) return existsSync(path) ? [path] : [];
      if (!existsSync(path)) return [];
      return listFilesRecursive(path, ['.log', '.1', '.2', '.old', '.txt']).filter((file) => /\.log(\.|$)/i.test(file));
    });

  const reports = [];
  const selections = [];
  const findings = [];
  for (const file of expand([...games, ...errors])) {
    let text;
    try {
      text = readTextFile(file);
    } catch {
      continue;
    }
    const scanned = scanLogText(text, { file });
    reports.push({
      file,
      counts: scanned.counts,
      byKind: scanned.byKind,
      bytes: text.length,
    });
    for (const entry of scanned.entries) {
      if (entry.kind === 'event-selection') selections.push({ ...entry, file });
      else findings.push({ ...entry, where: `${file}:${entry.line}` });
    }
  }
  // Selection order is the log's own order, and rotated files are in directory order; sorting by
  // (file, line) keeps each file's own sequence intact, which is what the cycles are read from.
  const cycles = findReopenCycles(selections, { withinSeconds: options.withinSeconds ?? 3 });
  const byKind = {};
  for (const entry of [...findings, ...selections]) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  return {
    logs: reports,
    isEmpty: reports.length === 0,
    selections: selections.map((entry) => ({
      file: entry.file,
      line: entry.line,
      time: entry.time,
      eventId: entry.eventId,
      option: entry.option,
      human: entry.human,
      playerEventId: entry.playerEventId,
    })),
    reopenCycles: cycles,
    findings,
    byKind,
    note:
      reports.length === 0
        ? 'No log file was found. Stellaris writes them to <user data>/logs/game.log and error.log; a run is needed ' +
          'before there is anything to read.'
        : '`selections` is the engine\'s own ordered record of which event option was chosen ' +
          '(eventcommands.cpp:88). `reopenCycles` is the close-then-reopen signature, read from it. ' +
          '`findings` are the engine\'s own complaints, with file:line where the line named one.',
  };
}

export default { scanEngineLogs, scanLogText, findReopenCycles, PATTERNS };
