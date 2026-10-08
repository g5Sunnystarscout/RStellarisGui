//------------------------------------------------------------------------------------
// toml.mjs -- Part of RStellarisGui
//
// Minimal TOML serialiser. This plugin has no runtime dependencies, so the canonical
// knowledge topic files and the catalogue index are written with this module instead of a
// TOML library - exactly as the sibling RStellarisScribe does. Only the subset the topic
// schema needs is implemented: basic strings, multi-line basic strings and arrays of
// strings.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

/** Serialise any string as a TOML basic string on a single line. */
export function tomlString(value) {
  return `"${escapeBasic(String(value))}"`;
}

/** Serialise a possibly long string as a TOML multi-line basic string (used for `body`). */
export function tomlMultiline(value) {
  const text = String(value).replace(/\r\n/g, '\n');
  return `"""\n${escapeBasic(text)}\n"""`;
}

/** Serialise an array of strings as a TOML array, one element per line. */
export function tomlStringArray(values, indent = '    ') {
  if (!values || values.length === 0) return '[]';
  const items = values.map((value) => `${indent}${tomlString(value)}`);
  return `[\n${items.join(',\n')}\n]`;
}

function escapeBasic(text) {
  let out = '';
  for (const character of text) {
    switch (character) {
      case '\\':
        out += '\\\\';
        break;
      case '"':
        out += '\\"';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\t':
        out += '\\t';
        break;
      case '\r':
        out += '\\r';
        break;
      default: {
        const code = character.codePointAt(0);
        if (code < 0x20 || code === 0x7f) {
          out += `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`;
        } else {
          out += character;
        }
      }
    }
  }
  return out;
}

export default { tomlString, tomlMultiline, tomlStringArray };
