//------------------------------------------------------------------------------------
// handoff.mjs -- Part of RStellarisGui
//
// THE HANDOFF CHANNEL: human edits -> submit -> agent lists -> agent picks -> validate -> emit.
//
// The user's request, verbatim: "把GUI插件做成人机协作的。Agent可以打开这个插件的UI，用户在插件
// 上依据视觉拖动摆放部件，然后点击提交新的界面布局给Agent." - the agent opens the page, the human
// drags parts around by eye, then clicks to send the new layout back.
//
// Where a submission goes:
//
//   <project>/out/handoff/<YYYYMMDD-HHMMSS>-<id4>/
//       meta.json      id, time, layout ids, provenance, the validation verdict, the diff counts
//       layout.json    the submitted tree, exactly as the canvas held it
//       diff.md        the human-readable diff against the layout as it was LOADED
//       emitted/       the .gui, and button_effects/events/localisation when the layout has them
//       picked.json    written by the AGENT, never by the page (see `markPicked`)
//
// Why the filesystem and not an in-memory queue: the page and the agent are usually different
// processes. `node src/index.mjs --web` serves the page from one process; the agent's MCP server is
// another, and it is often started after the human finished clicking. A directory the agent can
// read is the only channel that survives that, and it leaves an auditable record of who changed
// what. A submission written by the page is therefore readable by a process that did not exist
// when it was written - which is the whole point.
//
// The output-root rule still holds: `out/handoff` is this plugin's OWN output area, and the .gui
// written there goes through the same refusal set as a normal emit (`assertHandoffRoot`).
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { applyToFile, assertHandoffRoot, emitFiles } from './emit.mjs';
import { diffLayouts, formatDiffMarkdown, summariseDiff } from './layout-diff.mjs';
import { PROJECT_ROOT, ensureDir, timestampSlug } from './paths.mjs';

export const HANDOFF_ROOT = join(PROJECT_ROOT, 'out', 'handoff');

/** `<path>/out/handoff`, or an explicit root when the caller wants one. */
export function handoffRoot(options = {}) {
  return options.handoff_root ? ensureDir(assertHandoffRoot(options.handoff_root)) : ensureDir(HANDOFF_ROOT);
}

/** A short, filesystem-safe, collision-resistant id. */
function newId() {
  return randomUUID().replace(/-/g, '').slice(0, 6);
}

/** The directory name for a submission: `<timestamp>-<id>`, sorted by time under `readdirSync`. */
export function handoffDirectoryName(createdAt = new Date(), id = newId()) {
  return `${timestampSlug(createdAt)}-${id}`;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Write one submission.
 *
 * @param {object} options
 * @param {object} options.layout the submitted layout tree
 * @param {object} [options.baseline] the layout as it was LOADED, for the provenance diff. When it
 *        is absent the diff is empty and `meta.baseline` says so, rather than inventing one.
 * @param {string} [options.layoutId] the id this layout had in the submitting process
 * @param {string} [options.baselineLayoutId]
 * @param {string} [options.submittedBy] 'human (web UI)' or a caller-supplied string
 * @param {string} [options.note] a free-text note from the human
 * @param {object} [options.validation] a `validateLayout` report (the verdict is CARRIED, not recomputed)
 * @param {object} [options.guardrails] `{hard, soft, byRule}` from `scanContractViolations`
 * @param {string[]} [options.layoutIds] every layout id involved
 * @param {string} [options.fileStem]
 * @param {string} [options.language]
 * @param {string} [options.handoffRoot]
 * @param {boolean} [options.emit] write the .gui into `emitted/`. Defaults to true.
 * @param {object} [options.emitOptions] extra options for `emitFiles`
 * @param {string} [options.applyTo] absolute path of the .gui file this layout was IMPORTED from,
 *        to patch it in place (comments and untouched lines byte-identical). The report lands in
 *        `meta.apply`. Needs `options.applyBaseline` (defaults to `options.baseline`) - a patch
 *        without the tree the file was imported as would be a rewrite, so it is refused.
 * @param {object} [options.applyBaseline] the tree as IMPORTED, for the apply diff
 * @param {boolean} [options.applyDryRun] report the patch without writing it
 * @returns {object} the handoff record
 */
export function submitHandoff(options) {
  const layout = options.layout;
  if (!layout || typeof layout !== 'object' || !layout.root) {
    throw new Error('submitHandoff needs `layout` (a tree with a root)');
  }
  const root = handoffRoot(options);
  const createdAt = new Date();
  const id = newId();
  const name = handoffDirectoryName(createdAt, id);
  const directory = ensureDir(join(root, name));

  const baseline = options.baseline ?? null;
  const diff = diffLayouts(baseline, layout, {
    beforeId: options.baselineLayoutId ?? baseline?.layout_id ?? null,
    afterId: options.layoutId ?? null,
    beforeLabel: baseline ? 'as loaded' : 'nothing loaded',
    afterLabel: options.submittedBy ?? 'submitted',
  });

  const verdict = options.validation?.verdict ?? 'unvalidated';
  const counts = options.validation?.counts ?? null;
  const guardrails = options.guardrails ?? null;
  // WHAT "INVALID" MEANS, and why it is not simply `verdict === 'fail'`.
  //
  // The full validator's verdict is geometry-wide, and a real hand-edited window legitimately
  // fails it: this project's own live-verified six-window mod reports 84 `out-of-bounds` ERRORS
  // and 36 `zero-size` warnings, because decorative off-canvas panels and deliberate 0x0 parked
  // elements are exactly that. Marking every such submission invalid would make the flag useless,
  // and a flag that is always on is a flag nobody reads.
  //
  // A submission is INVALID when it carries a HARD guardrail finding - a contract name missing,
  // duplicated or mis-nested, `close` un-pinned, a parked element given a shortcut, a field the
  // engine's parser rejects - or when it was never validated at all. Those are the crash classes.
  // The full verdict and its counts are recorded beside it either way, so a reader can see both.
  const guardrailVerdict =
    options.validation?.guardrailVerdict ??
    (guardrails && (guardrails.hard ?? []).length > 0 ? 'fail' : guardrails && (guardrails.soft ?? []).length > 0 ? 'warn' : 'pass');
  const invalid = guardrailVerdict === 'fail';
  const flagged = !invalid && ((guardrails?.soft?.length ?? 0) > 0 || verdict === 'fail' || verdict === 'warn');

  // The diff is the provenance record, so it is written even when it is empty - "nothing changed"
  // is itself information the agent needs before it picks a submission up.
  writeJson(join(directory, 'layout.json'), layout);
  writeFileSync(
    join(directory, 'diff.md'),
    `${formatDiffMarkdown(diff, {
      title: `Submitted layout diff: \`${layout.name ?? options.layoutId ?? 'layout'}\``,
      reason: options.note,
    })}\n`,
    'utf8',
  );

  // THE APPLY PATH, ON THE HANDOFF TOO - and it runs BEFORE the emit below, which matters.
  //
  // `emitFiles` puts the tree through `prepareEngineCoordinates`, and that MUTATES it (it sets
  // `coordinateFields`, moves `position`, records `enginePosition`). An apply that ran afterwards
  // would compare an already-transformed tree against the untouched baseline and report every
  // element as changed - measured: 12 "changes" and a 146,848-byte file on a submission with no
  // edits at all, against a byte-identical 146,310 when the same apply ran first. `apply.mjs`
  // renders from its own clone, so the order is the only thing that has to be right.
  //
  // A submission that came from a real `.gui` file must be able to go back into that file, or the
  // handoff channel is a comments-stripping write path: the `emitted/` copy is a normalised
  // rebuild, and this project's own mod keeps its engine contract in the comments the rebuild
  // cannot carry. So a submission that names `applyTo` (the file the layout was imported from) is
  // spliced back into that file's ORIGINAL bytes, and the report travels in the meta beside the
  // diff. A no-edit submission must produce a byte-identical file - the same gate the agent's own
  // `gui_emit_files { apply_to }` call has to pass.
  //
  // A failure here is recorded, not thrown: the submission record is the deliverable, and the page
  // must never lose a human's work because the patch target was unreadable.
  let apply = null;
  let applyError = null;
  if (options.applyTo) {
    // `applyBaseline` is the tree as the SOURCE FILE was imported, which is the only correct base
    // for a patch. `baseline` is the diff base the submission carries, and on a page submission
    // that is the previous SUBMISSION rather than the file's own content - using it here would
    // report every element as changed and rewrite the whole file.
    const baseline = options.applyBaseline ?? options.baseline ?? null;
    if (!baseline) {
      applyError =
        'apply_to was given but no baseline tree was: a patch has to be diffed against the tree the file was IMPORTED as, ' +
        'or it is a full rewrite wearing a patch\'s name. Pass `baseline` / `applyBaseline`.';
    } else {
      try {
        apply = applyToFile(options.applyTo, baseline, layout, { dryRun: options.applyDryRun === true });
      } catch (thrown) {
        applyError = thrown instanceof Error ? thrown.message : String(thrown);
      }
    }
  }

  // The emitted file: the same emitter the agent uses, into this submission's own directory. A
  // failure here is recorded in the meta rather than thrown, because the SUBMISSION is the
  // deliverable and the emitted copy is a convenience.
  let emitted = null;
  let emitError = null;
  if (options.emit !== false) {
    try {
      const result = emitFiles(layout, {
        outputRoot: directory,
        emitSubdirectory: 'emitted',
        dryRun: false,
        fileStem: options.fileStem ?? layout.name,
        language: options.language ?? 'english',
        ...(options.emitOptions ?? {}),
      });
      emitted = {
        outputRoot: result.outputRoot,
        subdirectory: result.subdirectory ?? 'emitted',
        files: (result.files ?? []).map((file) => ({
          path: file.path,
          absolutePath: file.absolutePath ?? null,
          kind: file.kind ?? null,
          bytes: file.bytes ?? null,
          bom: Boolean(file.bom),
        })),
      };
    } catch (thrown) {
      emitError = thrown instanceof Error ? thrown.message : String(thrown);
    }
  }

  const meta = {
    schema: 'rstellarisgui/handoff@1',
    id,
    directory,
    name,
    createdAt: createdAt.toISOString(),
    kind: options.kind ?? 'human-submission',
    submittedBy: options.submittedBy ?? 'human (web UI)',
    note: options.note ?? null,
    layout: {
      id: options.layoutId ?? null,
      name: layout.name ?? null,
      elementCount: diff.after.elementCount,
      baseResolution: layout.baseResolution ?? null,
      windows: null,
    },
    baseline: baseline
      ? {
          id: options.baselineLayoutId ?? baseline.layout_id ?? null,
          name: baseline.name ?? null,
          elementCount: diff.before.elementCount,
        }
      : null,
    diff: {
      changeCount: diff.changeCount,
      counts: diff.counts,
      variableChanges: diff.variableChanges,
      summary: summariseDiff(diff),
      changedPaths: diff.changedPaths,
      file: join(directory, 'diff.md'),
    },
    validation: options.validation
      ? {
          verdict,
          counts,
          byRule: options.validation.byRule ?? null,
          guardrailVerdict,
          checked: {
            assets: options.validation.assetsChecked ?? null,
            localisation: options.validation.localisationChecked ?? null,
            buttonEffects: options.validation.buttonEffectsChecked ?? null,
          },
        }
      : { verdict: 'unvalidated', counts: null, guardrailVerdict: 'unvalidated', note: 'the submitter did not run the validator; treat the layout as unverified' },
    guardrails: guardrails
      ? { byRule: guardrails.byRule ?? {}, hard: guardrails.hard ?? [], soft: guardrails.soft ?? [] }
      : null,
    invalid,
    flagged,
    invalidReason: invalid
      ? `${(guardrails?.hard ?? []).length} hard guardrail finding(s): ${[...new Set((guardrails?.hard ?? []).map((finding) => finding.rule))].join(', ') || 'the layout was never validated'}`
      : null,
    status: 'pending',
    layoutIds: options.layoutIds ?? [options.layoutId, options.baselineLayoutId].filter(Boolean),
    files: {
      layout: join(directory, 'layout.json'),
      diff: join(directory, 'diff.md'),
      meta: join(directory, 'meta.json'),
      emitted: emitted?.files?.map((file) => file.absolutePath ?? join(directory, file.path)) ?? [],
    },
    emitted,
    emitError,
    apply: apply
      ? {
          targetPath: apply.targetPath,
          written: apply.written,
          dryRun: apply.dryRun,
          byteIdentical: apply.identical,
          before: apply.before,
          after: apply.after,
          commentLines: { before: apply.before.commentLines, after: apply.after.commentLines },
          changed: apply.changed,
          added: apply.added,
          removed: apply.removed,
          diff: apply.diff,
          syntaxCheck: apply.syntaxCheck,
          warnings: apply.warnings,
        }
      : null,
    applyError,
  };
  // `windows` needs the tree walk, which is cheap and keeps the meta readable.
  meta.layout.windows = (layout.root.syntheticRoot ? layout.root.children ?? [] : [layout.root])
    .map((node) => node?.name ?? null)
    .filter(Boolean);

  writeJson(join(directory, 'meta.json'), meta);
  return meta;
}

/** Read one submission's `meta.json`, or null when the directory is not a submission. */
export function readHandoff(directory) {
  const metaPath = join(directory, 'meta.json');
  if (!existsSync(metaPath)) return null;
  try {
    const meta = readJson(metaPath);
    meta.directory = directory;
    meta.picked = existsSync(join(directory, 'picked.json')) ? readJson(join(directory, 'picked.json')) : null;
    meta.status = meta.picked ? 'picked' : meta.status ?? 'pending';
    return meta;
  } catch {
    return null;
  }
}

/**
 * Every submission under the handoff root, newest first.
 *
 * @param {{handoff_root?: string, pending_only?: boolean, include_diff?: boolean, include_layout?: boolean,
 *          limit?: number, id?: string}} options
 */
export function listHandoffs(options = {}) {
  const root = options.handoff_root ? assertHandoffRoot(options.handoff_root) : HANDOFF_ROOT;
  if (!existsSync(root)) {
    return { root, count: 0, pendingCount: 0, invalidCount: 0, returned: 0, handoffs: [], note: 'no handoff root exists yet: nothing has been submitted from the page.' };
  }
  let entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((directory) => existsSync(join(directory, 'meta.json')))
    .map((directory) => readHandoff(directory))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const all = entries.length;
  const pendingCount = entries.filter((entry) => entry.status === 'pending').length;
  const invalidCount = entries.filter((entry) => entry.invalid).length;

  if (options.id) {
    const wanted = String(options.id);
    entries = entries.filter((entry) => entry.id === wanted || entry.name === wanted || entry.directory.endsWith(wanted));
  }
  if (options.pending_only) entries = entries.filter((entry) => entry.status === 'pending');
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 500);
  const total = entries.length;
  entries = entries.slice(0, limit);

  const handoffs = entries.map((entry) => {
    const record = {
      id: entry.id,
      directory: entry.directory,
      createdAt: entry.createdAt,
      status: entry.status,
      submittedBy: entry.submittedBy,
      note: entry.note ?? null,
      layout: entry.layout,
      baseline: entry.baseline,
      diffSummary: entry.diff?.summary ?? null,
      diffCounts: entry.diff?.counts ?? null,
      changedPaths: entry.diff?.changedPaths ?? [],
      validation: entry.validation
        ? {
            verdict: entry.validation.verdict,
            counts: entry.validation.counts,
            byRule: entry.validation.byRule,
            guardrailVerdict: entry.validation.guardrailVerdict ?? null,
          }
        : { verdict: 'unvalidated', guardrailVerdict: 'unvalidated' },
      invalid: Boolean(entry.invalid),
      invalidReason: entry.invalidReason ?? null,
      flagged: Boolean(entry.flagged),
      emitted: (entry.files?.emitted ?? []).map((path) => path),
      emitError: entry.emitError ?? null,
      picked: entry.picked ?? null,
      layoutFile: entry.files?.layout ?? join(entry.directory, 'layout.json'),
      diffFile: entry.files?.diff ?? join(entry.directory, 'diff.md'),
    };
    if (options.include_diff !== false) {
      record.diffMarkdown = existsSync(record.diffFile) ? readFileSync(record.diffFile, 'utf8') : null;
      record.guardrails = entry.guardrails ?? null;
    }
    if (options.include_layout) record.layout = readJson(record.layoutFile);
    return record;
  });

  return {
    root,
    count: all,
    pendingCount,
    invalidCount,
    returned: handoffs.length,
    handoffs,
    note:
      pendingCount === 0
        ? 'no PENDING submission: every one under this root has been picked up by an agent.'
        : `${pendingCount} pending submission(s). Call gui_handoff_pick to load one as the current layout.`,
  };
}

/**
 * The submitted LAYOUT for one handoff, by id / directory name / directory path.
 * @returns {object} the layout tree
 */
export function loadHandoffLayout(id, options = {}) {
  const directory = resolveHandoffDirectory(id, options);
  const layoutPath = join(directory, 'layout.json');
  if (!existsSync(layoutPath)) throw new Error(`handoff \`${id}\` has no layout.json (${layoutPath})`);
  return readJson(layoutPath);
}

/** The full record (meta + picked marker) for one handoff. */
export function loadHandoff(id, options = {}) {
  const directory = resolveHandoffDirectory(id, options);
  const meta = readHandoff(directory);
  if (!meta) throw new Error(`handoff \`${id}\` has no meta.json (${directory})`);
  return meta;
}

/** Resolve an id, a directory name or a directory path to a submission directory. */
export function resolveHandoffDirectory(id, options = {}) {
  if (typeof id !== 'string' || id.trim() === '') throw new Error('a handoff `id` is required');
  const wanted = id.trim();
  if (existsSync(join(wanted, 'meta.json'))) return wanted;
  const root = options.handoff_root ? assertHandoffRoot(options.handoff_root) : HANDOFF_ROOT;
  if (!existsSync(root)) throw new Error(`no handoff root exists yet (${root}); nothing has been submitted.`);
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === wanted || name.endsWith(wanted))
    .map((name) => join(root, name))
    .filter((directory) => existsSync(join(directory, 'meta.json')));
  if (candidates.length === 0) {
    const known = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .join(', ');
    throw new Error(`unknown handoff \`${id}\` under ${root}; known: ${known || '(none)'}`);
  }
  if (candidates.length > 1) throw new Error(`\`${id}\` matches ${candidates.length} handoffs (${candidates.join(', ')}); pass the full directory name`);
  return candidates[0];
}

/**
 * Record that an agent consumed a submission. Written by the AGENT side only.
 *
 * This is what turns "pending" off, so the page's pending counter is a real
 * "the agent has not picked this up yet" indicator rather than a guess.
 */
export function markPicked(id, details = {}, options = {}) {
  const directory = resolveHandoffDirectory(id, options);
  const at = new Date().toISOString();
  const record = {
    pickedAt: at,
    pickedBy: details.pickedBy ?? 'agent',
    layoutId: details.layoutId ?? null,
    tool: details.tool ?? 'gui_handoff_pick',
    note: details.note ?? null,
  };
  writeJson(join(directory, 'picked.json'), record);
  const meta = readHandoff(directory);
  if (meta && meta.status !== 'picked') {
    meta.status = 'picked';
    meta.picked = record;
    writeJson(join(directory, 'meta.json'), meta);
  }
  return { directory, ...record };
}

/** Pending submissions only - the count the page's indicator shows. */
export function pendingHandoffs(options = {}) {
  const listed = listHandoffs({ ...options, pending_only: true, include_diff: false, limit: options.limit ?? 100 });
  return {
    root: listed.root,
    pendingCount: listed.pendingCount,
    invalidCount: listed.invalidCount,
    totalCount: listed.count,
    handoffs: listed.handoffs.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      submittedBy: entry.submittedBy,
      layoutName: entry.layout?.name ?? null,
      elementCount: entry.layout?.elementCount ?? null,
      diffSummary: entry.diffSummary,
      verdict: entry.validation?.verdict ?? 'unvalidated',
      invalid: entry.invalid,
      invalidReason: entry.invalidReason ?? null,
      flagged: entry.flagged,
    })),
  };
}

/** Statistics for a status line: how many submissions exist, how old the oldest pending one is. */
export function handoffStats(options = {}) {
  const root = options.handoff_root ? assertHandoffRoot(options.handoff_root) : HANDOFF_ROOT;
  if (!existsSync(root)) return { root, exists: false, total: 0, pending: 0, picked: 0, invalid: 0, newest: null };
  const metas = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .map((directory) => readHandoff(directory))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    root,
    exists: true,
    total: metas.length,
    pending: metas.filter((meta) => meta.status === 'pending').length,
    picked: metas.filter((meta) => meta.status === 'picked').length,
    invalid: metas.filter((meta) => meta.invalid).length,
    newest: metas[0]?.createdAt ?? null,
    newestPending: metas.find((meta) => meta.status === 'pending')?.createdAt ?? null,
  };
}

/** Guard: is this path inside the plugin's own handoff area? */
export function isInsideHandoffRoot(path, options = {}) {
  const root = options.handoff_root ? assertHandoffRoot(options.handoff_root) : HANDOFF_ROOT;
  const normalise = (value) => String(value).replace(/\\/g, '/').toLowerCase();
  return normalise(path).startsWith(normalise(root));
}

export default {
  HANDOFF_ROOT,
  handoffRoot,
  handoffDirectoryName,
  submitHandoff,
  listHandoffs,
  loadHandoff,
  loadHandoffLayout,
  resolveHandoffDirectory,
  markPicked,
  pendingHandoffs,
  handoffStats,
  isInsideHandoffRoot,
};
