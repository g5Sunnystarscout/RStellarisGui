//------------------------------------------------------------------------------------
// loc-index.mjs -- Part of RStellarisGui
//
// Localisation keys. GUI elements reference keys, not literal text, in `text`, `buttonText`,
// `pdx_tooltip`, `pdx_tooltip_delayed` and `custom_tooltip`. A window whose text uses a key
// that does not exist renders as the raw key in game, which is the single most common
// cosmetic bug in hand-written custom UI - so the validator wants to know the real keyset.
//
// Sources, in precedence order:
//   1. the emitted layout's own localisation stubs (so a fresh project validates clean)
//   2. the mod / output localisation folder, if one was supplied
//   3. the install's localisation/**/*.yml
//   4. %USERPROFILE%\Documents\Paradox Interactive\Stellaris\localisation
//
// A `.yml` key line looks like `key:0 "value"` (optionally `key:1`), inside an
// `l_<language>:` header. This module indexes keys in the requested language(s) only, because
// a key that exists only in another language renders as the key in the selected one.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { listFilesRecursive, readTextFile, relativeKey } from './paths.mjs';

const KEY_PATTERN = /^\s*([A-Za-z0-9_.\-]+)\s*:\s*[0-9]+\s+"/;
const KEY_VALUE_PATTERN = /^\s*([A-Za-z0-9_.\-]+)\s*:\s*[0-9]+\s+"(.*)"\s*$/;
const HEADER_PATTERN = /^\s*l_([a-z_]+)\s*:/;

/**
 * Parse one localisation file and collect keys per language.
 *
 * @param {string} text
 * @param {{withValues?: boolean}} [options] `withValues` also keeps the resolved strings, which
 *   is what lets the preview draw REAL text instead of the key (a Chinese-language mod's
 *   `maxWidth` overflow is invisible while the preview says `unga_nam_body`). It costs memory
 *   (~200k strings for a full install), so it is opt-in.
 * @returns {Map<string, Set<string>>} language -> keys
 */
export function parseLocalisationFile(text) {
  return parseLocalisationDetailed(text).keys;
}

/** As `parseLocalisationFile`, but with the values kept under `values` as well. */
export function parseLocalisationDetailed(text) {
  const keys = new Map();
  const values = new Map();
  let language = null;
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const header = HEADER_PATTERN.exec(raw);
    if (header) {
      language = header[1];
      if (!keys.has(language)) keys.set(language, new Set());
      if (!values.has(language)) values.set(language, new Map());
      continue;
    }
    if (raw.trimStart().startsWith('#')) continue;
    const key = KEY_PATTERN.exec(raw);
    if (!key || !language) continue;
    keys.get(language).add(key[1]);
    const pair = KEY_VALUE_PATTERN.exec(raw);
    if (pair && !values.get(language).has(pair[1])) values.get(language).set(pair[1], pair[2]);
  }
  return { keys, values };
}

/**
 * Build a localisation keyset.
 *
 * @param {{languages?: string[], roots?: string[], directories?: string[], withValues?: boolean}} options
 *   `directories` are absolute localisation folders; `roots` are install/mod roots whose
 *   `localisation/` subfolder is indexed. `withValues` also returns `values` (key -> string),
 *   first language wins, for the preview and for any caller that wants to show real text.
 * @returns {{keys: Set<string>, values?: Map<string, string>, byLanguage: object, files: number, ms: number}}
 */
export function buildLocalisationIndex(options = {}) {
  const started = Date.now();
  const languages = options.languages ?? ['english'];
  const directories = [...(options.directories ?? [])];
  for (const root of options.roots ?? []) directories.push(join(root, 'localisation'));

  const byLanguage = new Map();
  const valuesByLanguage = new Map();
  let files = 0;
  for (const directory of directories) {
    if (!existsSync(directory)) continue;
    for (const file of listFilesRecursive(directory, ['.yml'])) {
      files += 1;
      const parsed = parseLocalisationDetailed(readTextFile(file));
      for (const [language, keys] of parsed.keys) {
        if (!byLanguage.has(language)) byLanguage.set(language, new Set());
        const target = byLanguage.get(language);
        for (const key of keys) target.add(key);
      }
      for (const [language, values] of parsed.values) {
        if (!valuesByLanguage.has(language)) valuesByLanguage.set(language, new Map());
        const target = valuesByLanguage.get(language);
        for (const [key, value] of values) if (!target.has(key)) target.set(key, value);
      }
    }
  }

  const keys = new Set();
  for (const language of languages) {
    for (const key of byLanguage.get(language) ?? []) keys.add(key);
  }
  // First requested language wins, so a key defined in both english and simp_chinese resolves to
  // the one the caller asked for first.
  const values = new Map();
  if (options.withValues) {
    for (const language of languages) {
      for (const [key, value] of valuesByLanguage.get(language) ?? []) if (!values.has(key)) values.set(key, value);
    }
  }

  return {
    keys,
    ...(options.withValues ? { values } : {}),
    byLanguage: Object.fromEntries([...byLanguage.entries()].map(([language, set]) => [language, set.size])),
    languages,
    directories,
    files,
    ms: Date.now() - started,
  };
}

/**
 * Is a `.gui` text field a localisation *key* rather than a literal?
 *
 * Vanilla writes `text = "OPTION_TEXT"` and `buttonText = "DIPLOMACY"` where the engine looks
 * the string up and falls back to displaying it literally when the lookup fails. So: treat a
 * value as a key when it looks like one (upper-case, underscores, no spaces) and skip values
 * that are obviously literal prose.
 */
export function looksLikeLocKey(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (/\s/.test(value)) return false;
  if (value.startsWith('$')) return false;
  if (/^[A-Za-z0-9_.\-]+$/.test(value) === false) return false;
  // An all-lowercase single word is more likely literal prose than a key in this codebase,
  // but vanilla does use lowercase keys (`ui_some_header`), so only require "no spaces".
  return true;
}

/** Describe the index for a report. */
export function describeLocalisationIndex(index) {
  return `${index.keys.size} keys in [${index.languages.join(', ')}] from ${index.files} files (${index.ms} ms)`;
}

export { basename, relativeKey };

export default {
  parseLocalisationFile,
  parseLocalisationDetailed,
  buildLocalisationIndex,
  looksLikeLocKey,
  describeLocalisationIndex,
};
