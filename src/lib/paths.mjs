//------------------------------------------------------------------------------------
// paths.mjs -- Part of RStellarisGui
//
// Where things live, and the one rule this project never breaks: emitted files go to an
// explicit output directory, never into a game install, never into a mod workspace.
//
// Verified install for this project: <Stellaris>, launcher-settings.json reports
// "Pegasus v4.4.6 (fdde)". A second, stale 4.1.7 install exists at
// D:\SteamLibrary\steamapps\common\Stellaris and is NEVER read - a 4.1.7 interface tree
// would silently produce wrong sprite/geometry answers.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Project root, derived from this file's location (src/lib/paths.mjs -> project root). */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The environment variable that names the install, for anyone whose game is not
 * in a detectable location.
 */
export const GAME_ROOT_ENV = 'STELLARIS_GAME_ROOT';

/**
 * The Stellaris major version this build was measured against.
 *
 * The version is the real guard. A filename in `launcher-settings.json` protects
 * everyone; refusing a hardcoded directory name protects only the machine that
 * directory happens to be on, and it cannot help anybody whose stale install is
 * somewhere else.
 */
export const TARGET_VERSION = '4.4';

/**
 * Known-bad path, kept from the original build: one specific stale 4.1.7 tree.
 *
 * Declared BEFORE `detectGameRoot` because that function reads it while the module
 * is still initialising (`DEFAULT_GAME_ROOT` below is computed at import time), and
 * a `const` read before its declaration is a temporal-dead-zone error.
 */
export const FORBIDDEN_GAME_ROOTS = ['D:\\SteamLibrary\\steamapps\\common\\Stellaris'];

/**
 * Where a Stellaris install is looked for when nothing was requested.
 *
 * GENERIC locations only. A published tool must not default to the author's disk
 * layout: the shipped default used to be one machine's install path, which meant
 * every other user got "path not found" instead of an answer.
 */
export const CANDIDATE_GAME_ROOTS = (() => {
  const out = [];
  for (const drive of ['C', 'D', 'E', 'F', 'G']) {
    out.push(`${drive}:\\Program Files (x86)\\Steam\\steamapps\\common\\Stellaris`);
    out.push(`${drive}:\\Program Files\\Steam\\steamapps\\common\\Stellaris`);
    out.push(`${drive}:\\SteamLibrary\\steamapps\\common\\Stellaris`);
    out.push(`${drive}:\\Steam\\steamapps\\common\\Stellaris`);
    out.push(`${drive}:\\Stellaris`);
    out.push(`${drive}:\\Games\\Stellaris`);
  }
  return out;
})();

/** The `rawVersion` from `launcher-settings.json`, or null when unreadable. */
export function readGameVersion(root) {
  try {
    const settings = JSON.parse(readFileSync(join(root, 'launcher-settings.json'), 'utf8'));
    const raw = settings.rawVersion ?? settings.version ?? null;
    return typeof raw === 'string' ? raw : null;
  } catch {
    return null;
  }
}

/** Does this directory hold a Stellaris install? */
export function looksLikeInstall(root) {
  try {
    return existsSync(join(root, 'interface')) && existsSync(join(root, 'common'));
  } catch {
    return false;
  }
}

/**
 * Does this directory hold a GAME INSTALL specifically, rather than a mod?
 *
 * `interface/` plus `common/` is NOT enough to answer that: a mod ships both. So the
 * test is for markers only an install has -- the executable, or a
 * `launcher-settings.json` carrying a version.
 *
 * This exists because the write guards recognised an install by PATH SPELLING (the
 * substrings `/steamapps/common/stellaris` and `/st-new`). Those two spellings covered
 * the developer's own machine and nobody else's: an install at `E:\Stellaris` -- where
 * the verified 4.4.6 build on this machine lives -- was not refused at all, so
 * "never write into a game install" was a guard that did not fire. Content answers the
 * question that the path cannot.
 */
export function looksLikeGameInstall(root) {
  try {
    if (existsSync(join(root, 'stellaris.exe'))) return true;
    if (existsSync(join(root, 'launcher-settings.json'))) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * The nearest ancestor of `p` (inclusive) that is a game install, or null.
 *
 * Ancestors matter because the dangerous path is a file or folder INSIDE the install
 * (`<install>/interface/x.gui`), not the install root itself.
 */
export function insideGameInstall(p) {
  let current = resolve(String(p));
  for (let guard = 0; guard < 64; guard += 1) {
    if (looksLikeGameInstall(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/** Installs that were found but rejected, with the reason. For a useful message. */
export function unsuitableInstalls() {
  const out = [];
  for (const candidate of CANDIDATE_GAME_ROOTS) {
    if (!looksLikeInstall(candidate)) continue;
    const norm = resolve(candidate).toLowerCase();
    if (FORBIDDEN_GAME_ROOTS.some((f) => f.toLowerCase() === norm)) {
      out.push({ root: resolve(candidate), reason: 'on the known-stale list' });
      continue;
    }
    const version = readGameVersion(candidate);
    if (version && !version.includes(TARGET_VERSION)) {
      out.push({ root: resolve(candidate), reason: `reports ${version}` });
    }
  }
  return out;
}

/**
 * The install to use when the caller did not name one.
 *
 * Order: the environment variable, then the generic candidate paths. A candidate
 * is SKIPPED when it is on the stale list or reports a different version, so
 * detection cannot silently hand back the wrong install -- it reports nothing
 * found and `resolveGameRoot` explains what it rejected and why.
 */
export function detectGameRoot() {
  const fromEnv = process.env[GAME_ROOT_ENV];
  if (fromEnv && looksLikeInstall(fromEnv)) return resolve(fromEnv);
  for (const candidate of CANDIDATE_GAME_ROOTS) {
    if (!looksLikeInstall(candidate)) continue;
    const norm = resolve(candidate).toLowerCase();
    if (FORBIDDEN_GAME_ROOTS.some((f) => f.toLowerCase() === norm)) continue;
    const version = readGameVersion(candidate);
    if (version && !version.includes(TARGET_VERSION)) continue;
    return resolve(candidate);
  }
  return null;
}

/**
 * The detected install, or null.
 *
 * Kept under its historical name because the scripts and the tool surface import
 * it, but it is no longer a constant: it is whatever detection found. A null here
 * is a normal state on a machine without the game, and every consumer reports it
 * rather than silently reading a directory that does not exist.
 */
export const DEFAULT_GAME_ROOT = detectGameRoot();

/** `%USERPROFILE%\Documents\Paradox Interactive\Stellaris` - read-only, for localisation keys. */
export function defaultDocumentsRoot() {
  const home = homedir();
  const candidates = [
    join(home, 'Documents', 'Paradox Interactive', 'Stellaris'),
    join(home, 'OneDrive', 'Documents', 'Paradox Interactive', 'Stellaris'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

/** Stellaris reads these localisation language folders. */
export const LOCALISATION_LANGUAGES = [
  'english',
  'braz_por',
  'french',
  'german',
  'japanese',
  'korean',
  'polish',
  'russian',
  'simp_chinese',
  'spanish',
  'turkish',
];

/** Strip a UTF-8 BOM if one is present. */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Read a text file as UTF-8 with any BOM removed. */
export function readTextFile(path) {
  return stripBom(readFileSync(path, 'utf8'));
}

/** Detect a UTF-8 BOM on disk (the localisation .yml requirement). */
export function hasBom(path) {
  const buffer = readFileSync(path);
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

/** Resolve the game root: what was asked for, else what was detected, else explain. */
export function resolveGameRoot(requested) {
  const candidate = requested || process.env[GAME_ROOT_ENV] || detectGameRoot();
  if (!candidate) {
    const rejected = unsuitableInstalls();
    throw new Error(
      `could not find a Stellaris ${TARGET_VERSION}.x install. Point at one with the \`game_root\` argument, `
      + `or set ${GAME_ROOT_ENV} to the folder that contains \`interface/\` and \`common/\`.`
      + (rejected.length
        ? ` Rejected ${rejected.length} install(s): ${rejected.map((r) => `${r.root} (${r.reason})`).join('; ')}.`
        : ` Looked in ${CANDIDATE_GAME_ROOTS.length} common locations.`),
    );
  }
  const root = resolve(candidate);
  for (const forbidden of FORBIDDEN_GAME_ROOTS) {
    if (root.toLowerCase() === forbidden.toLowerCase()) {
      throw new Error(
        `refusing to read ${root}: that path is a known stale Stellaris 4.1.7 install on the machine `
        + 'this project was developed on. Point `game_root` at a 4.4.x install instead.',
      );
    }
  }
  if (!looksLikeInstall(root)) {
    throw new Error(`${root} does not look like a Stellaris install (needs both interface/ and common/)`);
  }
  // The version is the real guard. A path name only protects the machine that path
  // is on; reading launcher-settings.json protects everyone.
  const version = readGameVersion(root);
  if (version && !version.includes(TARGET_VERSION)) {
    throw new Error(
      `refusing to read ${root}: it reports Stellaris ${version}, and every constant in this build was `
      + `measured against ${TARGET_VERSION}. Field names and file layouts differ between versions, so `
      + 'answering from the wrong one produces plausible-looking wrong answers.',
    );
  }
  return root;
}

/** Recursively list files under `dir` with one of `extensions`. Never throws on a missing dir. */
export function listFilesRecursive(dir, extensions) {
  const wanted = extensions.map((extension) => extension.toLowerCase());
  const found = [];
  if (!existsSync(dir)) return found;
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(full);
      else if (wanted.some((extension) => entry.toLowerCase().endsWith(extension))) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/** Turn an absolute path into a forward-slashed path relative to `root`. */
export function relativeKey(root, absolute) {
  return relative(root, absolute).split(sep).join('/');
}

/**
 * Confine a caller-supplied relative path under `root`. This is what stops an emitter call
 * from writing outside its output directory. Throws on absolute paths, drive letters and
 * any `..` segment.
 */
export function safeJoin(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new Error('a relative path is required');
  }
  if (isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error(`expected a relative path, got an absolute one: ${relativePath}`);
  }
  const normalised = relativePath.replace(/\\/g, '/');
  const segments = normalised.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) {
    throw new Error(`refusing a path that escapes the output root: ${relativePath}`);
  }
  if (segments.some((segment) => /[<>:"|?*\u0000-\u001f]/.test(segment))) {
    throw new Error(`path segment contains characters Stellaris cannot read: ${relativePath}`);
  }
  const target = resolve(root, ...segments);
  const base = resolve(root);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`refusing a path that escapes the output root: ${relativePath}`);
  }
  return target;
}

/** Create a directory tree, returning the path. */
export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

/** A filesystem-safe timestamp, for `out/<timestamp>/` default output roots. */
export function timestampSlug(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Default output root: <project>/out/<timestamp>/. Deliberately outside any mod folder. */
export function defaultOutputRoot(now = new Date()) {
  return join(PROJECT_ROOT, 'out', timestampSlug(now));
}

/** Cache directory for the asset index and decoded thumbnails. */
export function cacheRoot() {
  return join(PROJECT_ROOT, '.cache');
}

export default {
  PROJECT_ROOT,
  GAME_ROOT_ENV,
  TARGET_VERSION,
  CANDIDATE_GAME_ROOTS,
  DEFAULT_GAME_ROOT,
  FORBIDDEN_GAME_ROOTS,
  LOCALISATION_LANGUAGES,
  detectGameRoot,
  readGameVersion,
  looksLikeInstall,
  defaultDocumentsRoot,
  stripBom,
  readTextFile,
  hasBom,
  resolveGameRoot,
  listFilesRecursive,
  relativeKey,
  safeJoin,
  ensureDir,
  timestampSlug,
  defaultOutputRoot,
  cacheRoot,
};
