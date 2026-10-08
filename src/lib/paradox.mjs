//------------------------------------------------------------------------------------
// paradox.mjs -- Part of RStellarisGui
//
// A small Paradox script lexer/parser, enough for `.gui`, `.gfx` and
// `common/button_effects/*.txt`. These are all the same shape of language: `key = value`
// pairs, `key = { ... }` blocks, quoted strings, `#` comments and `@variable` lines.
//
// Written from scratch rather than ported from RStellarisScribe's paradox.mjs because the
// `.gui` reader needs line numbers on every node (the validator reports "file:line" for
// every finding) and needs to keep `@variable` declarations as data rather than folding
// them away.
//
// Syntax conventions (braces, `key = value`, `#` comments, quoting) are the documented
// Paradox script family rules; see docs/sources.md.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { stripBom } from './paths.mjs';

// Money-icon prefixes in localisation keys are written as \u00a3 escapes so every source
// file in this project stays pure ASCII on disk.
//
// These are plain character predicates, not RegExp objects. An earlier revision used
// `/[0-9.]/.test(source[index])` inside a scan loop; a stateful RegExp (the `g`/`y`
// `lastIndex` trap) makes `.test()` alternate true/false on identical input, which turned
// that loop into an infinite one. Predicates cannot carry state, so the class of bug is
// gone rather than merely fixed.
const isDigit = (char) => char !== undefined && char >= '0' && char <= '9';
const isIdentStart = (char) =>
  char !== undefined && (/[A-Za-z_]/.test(char) || char === '@' || char === '$' || char === '\u00a3');
const isIdentBody = (char) =>
  char !== undefined &&
  (/[A-Za-z0-9_]/.test(char) ||
    char === '.' ||
    char === '-' ||
    char === '$' ||
    char === ':' ||
    char === '/' ||
    char === '\u00a3');

/**
 * Tokenise Paradox script.
 *
 * The scanner is position-monotonic by construction: every iteration either appends a token
 * while moving `index` strictly forward, or moves `index` forward without a token. There is
 * no branch that can leave `index` unchanged, which is asserted at the end of the loop.
 *
 * @returns {{tokens: {kind: string, value: string, line: number}[]}} tokens; `kind` is one of
 *   `ident`, `string`, `number`, `open`, `close`, `equals`.
 */
export function tokenize(text, { startLine = 1 } = {}) {
  const source = stripBom(text);
  const tokens = [];
  const length = source.length;
  let index = 0;
  let line = startLine;

  const isSpace = (char) => char === ' ' || char === '\t' || char === '\r' || char === ',';

  while (index < length) {
    const guard = index;
    const char = source[index];

    if (char === '\n') {
      line += 1;
      index += 1;
    } else if (isSpace(char)) {
      index += 1;
    } else if (char === '#') {
      while (index < length && source[index] !== '\n') index += 1;
    } else if (char === '{' || char === '}' || char === '=') {
      const kind = char === '{' ? 'open' : char === '}' ? 'close' : 'equals';
      tokens.push({ kind, value: char, line });
      index += 1;
    } else if (char === '"') {
      const quoteLine = line;
      index += 1;
      let value = '';
      while (index < length && source[index] !== '"') {
        if (source[index] === '\n') line += 1;
        if (source[index] === '\\' && index + 1 < length) {
          index += 1;
          value += source[index];
        } else {
          value += source[index];
        }
        index += 1;
      }
      index += 1; // closing quote, or one past EOF for an unterminated string
      tokens.push({ kind: 'string', value, line: quoteLine });
    } else if (isDigit(char) || ((char === '-' || char === '.') && isDigit(source[index + 1]))) {
      const start = index;
      if (char === '-' || char === '.') index += 1;
      while (index < length && isDigit(source[index])) index += 1;
      if (source[index] === '.') {
        index += 1;
        while (index < length && isDigit(source[index])) index += 1;
      }
      // `50%` and `100%%` are single literals: the extra `%` is not fluff, it means
      // "percent of the parent, minus this element's position" (see layout.mjs).
      while (index < length && source[index] === '%') index += 1;
      tokens.push({ kind: 'number', value: source.slice(start, index), line });
    } else if (isIdentStart(char)) {
      // `@[ name ]` is a VARIABLE reference written with brackets (34 uses in vanilla 4.4.6, e.g.
      // galaxy_view.gui:1646 `position { x = @[ shroudPlaneRadius ] y = @[ shroudPlaneRadius ] }`).
      // Read it as the `@name` reference it means, so the value resolves instead of becoming the
      // literal `@`.
      if (char === '@' && source[index + 1] === '[') {
        let cursor = index + 2;
        let name = '';
        while (cursor < length && source[cursor] !== ']') {
          name += source[cursor];
          cursor += 1;
        }
        index = cursor < length ? cursor + 1 : cursor;
        tokens.push({ kind: 'ident', value: `@${name.trim()}`, line });
      } else {
        const start = index;
        index += 1;
        while (index < length && isIdentBody(source[index])) index += 1;
        tokens.push({ kind: 'ident', value: source.slice(start, index), line });
      }
    } else {
      // Unknown punctuation (a stray byte, a section banner remnant). Drop it rather than
      // fail the whole file: one bad character in a 3000-line vanilla .gui should not make
      // the file unreadable.
      index += 1;
    }

    /* c8 ignore next 3 -- defensive: proves the loop cannot stall, see the note above. */
    if (index === guard) {
      throw new Error(`lexer stalled at offset ${index} (line ${line}); this is a bug`);
    }
  }

  return { tokens };
}

/**
 * Parse a token stream into a node tree.
 *
 * A node is `{key, value, line, children, variables}` where `value` is set for scalar
 * assignments, `children` for block assignments, and `variables` carries the preceding
 * `@name = value` declarations. Repeated keys are kept as sibling nodes (Paradox allows
 * e.g. several `background = { ... }` blocks in one element).
 */
export function parseTokens(tokens) {
  let position = 0;
  /**
   * The line of the most recently consumed `}`.
   *
   * A block's SPAN is what the engine's own reader quotes when it rejects something inside it
   * (`Unexpected token: instantTextBoxType, near line: 31` ... `near line: 38`, where 38 is the
   * child's closing brace), and a finding that cannot state the span cannot be checked against that
   * log. The parser is depth-first, so the value read immediately after `parseEntries(true)` returns
   * is that block's own close: the inner call has already consumed it.
   */
  let lastCloseLine = null;

  function parseEntries(stopAtClose) {
    const entries = [];
    while (position < tokens.length) {
      const token = tokens[position];
      if (token.kind === 'close') {
        if (stopAtClose) {
          lastCloseLine = token.line;
          position += 1;
          return entries;
        }
        position += 1; // stray close: ignore
        continue;
      }
      if (token.kind !== 'ident') {
        position += 1;
        continue;
      }
      const key = token.value;
      const line = token.line;
      position += 1;
      const separator = tokens[position];
      // `key { ... }` WITHOUT an `=` is legal script too: vanilla writes it (galaxy_view.gui:1646
      // is `position { x = ... y = ... }`). Treating that `{` as a stray token ended the
      // ENCLOSING element at the first `}`, which made the rest of the element's fields look like
      // they belonged to its parent.
      if (separator && separator.kind === 'open') {
        position += 1;
        const children = parseEntries(true);
        // `closeLine` is the block's own closing brace line: the reader's depth-first order means
        // the inner call has just consumed it. It is set on EVERY block entry, so a finding can
        // quote the same span the engine quotes (`near line: <open>` ... `near line: <close>`).
        entries.push({ key, value: null, line, closeLine: lastCloseLine, children, variables: {} });
        continue;
      }
      if (!separator || separator.kind !== 'equals') {
        // A bare ident with no `=` - `listBoxType = { 1 2 3 }` style arrays land here as
        // value nodes without a key.
        entries.push({ key: null, value: key, line, children: null, variables: {} });
        continue;
      }
      position += 1;
      const next = tokens[position];
      if (!next) {
        // An unterminated block: there is no closing brace to record, and `closeLine: null` says so
        // rather than pretending the block ends where its last token was.
        entries.push({ key, value: null, line, closeLine: null, children: [], variables: {} });
        break;
      }
      if (next.kind === 'open') {
        position += 1;
        const children = parseEntries(true);
        entries.push({ key, value: null, line, closeLine: lastCloseLine, children, variables: {} });
        continue;
      }
      position += 1;
      entries.push({ key, value: next.value, line, children: null, variables: {} });
    }
    return entries;
  }

  const roots = parseEntries(false);

  // Hoist `@name = value` declarations into a scope. They may appear anywhere in the file
  // and apply to the whole file (verified: 30 of the 177 vanilla 4.4.6 .gui files put them
  // before `guiTypes`, and the rest put them inline, including inside nested blocks).
  const variables = {};
  for (const entry of roots) {
    if (entry.key && entry.key.startsWith('@')) variables[entry.key] = entry.value;
  }
  for (const variable of Object.keys(variables)) {
    if (/^@[0-9]/.test(variable)) delete variables[variable];
  }

  return { roots, variables };
}

/** Parse Paradox script text into `{roots, variables}`. */
export function parseParadox(text, options = {}) {
  return parseTokens(tokenize(text, options).tokens);
}

/** Find the first top-level block whose key matches `name` case-insensitively. */
export function findRoot(node, name) {
  const wanted = name.toLowerCase();
  return node.roots.find((entry) => entry.key && entry.key.toLowerCase() === wanted) ?? null;
}

/** First child of `entry` with the given key, case-insensitively. */
export function firstChild(entry, key) {
  const wanted = key.toLowerCase();
  return (entry.children ?? []).find((child) => child.key && child.key.toLowerCase() === wanted) ?? null;
}

/** All children of `entry` with the given key, case-insensitively. */
export function allChildren(entry, key) {
  const wanted = key.toLowerCase();
  return (entry.children ?? []).filter((child) => child.key && child.key.toLowerCase() === wanted);
}

/** Every top-level key in a `.txt` file, for keyset validation (button effects, sprites). */
export function topLevelKeys(text) {
  const keys = [];
  const seen = new Set();
  for (const entry of parseParadox(text).roots) {
    if (entry.key && !seen.has(entry.key)) {
      seen.add(entry.key);
      keys.push({ key: entry.key, line: entry.line, isBlock: entry.children !== null });
    }
  }
  return keys;
}

/** Strip a `#` comment, honouring quotes. */
export function stripComment(line) {
  let out = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    if (char === '#' && !quoted) break;
    out += char;
  }
  return out;
}

/**
 * The first `key = ...` construct of a file, skipping comments, blank lines and `@` lines.
 *
 * Lives here (rather than in layout.mjs, where it started) because the syntax checker needs it
 * and must not import the layout engine just to name a file's root construct.
 */
export function firstConstruct(text) {
  for (const raw of stripBom(text).split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (line === '' || line.startsWith('@')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    return match ? match[1] : `(unparsed: ${line.slice(0, 40)})`;
  }
  return '(empty)';
}

/**
 * Resolve `@variable` references. Vanilla uses them for positions, sizes, sprite names and
 * whole sub-blocks (`dynamic_extra_height = @dynamic_extra`). A variable may itself be a
 * percentage (`@myvar_width = 50%`).
 *
 * Returns the raw string when the variable is unknown, so the caller can report the name
 * rather than silently substituting nothing.
 */
export function resolveVariable(value, variables) {
  if (typeof value !== 'string' || !value.startsWith('@')) return value;
  const seen = new Set();
  let current = value;
  while (typeof current === 'string' && current.startsWith('@')) {
    if (seen.has(current)) return value; // self-referential; bail out
    seen.add(current);
    const next = variables[current];
    if (next === undefined || next === null) return value;
    current = next;
  }
  return current;
}

/** Recursively substitute every `@variable` in a node tree. Unknown names are left alone. */
export function substituteVariables(entry, variables) {
  if (entry.value !== null && entry.value !== undefined) {
    entry.value = resolveVariable(entry.value, variables);
    return entry;
  }
  for (const child of entry.children ?? []) substituteVariables(child, variables);
  return entry;
}

/** Collect every `@variable` referenced anywhere in the text (excluding declarations). */
export function referencedVariables(text) {
  const names = new Set();
  for (const match of stripBom(text).matchAll(/=\s*(@[A-Za-z0-9_]+)/g)) names.add(match[1]);
  return names;
}

/** Collect every `@variable = value` declaration in the text. */
export function declaredVariables(text) {
  const declared = new Map();
  for (const entry of parseParadox(text).roots) {
    if (entry.key && entry.key.startsWith('@')) {
      declared.set(entry.key, { value: entry.value, line: entry.line });
    }
  }
  return declared;
}

export default {
  tokenize,
  parseTokens,
  parseParadox,
  findRoot,
  firstChild,
  allChildren,
  topLevelKeys,
  stripComment,
  firstConstruct,
  resolveVariable,
  substituteVariables,
  referencedVariables,
  declaredVariables,
};
