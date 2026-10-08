//------------------------------------------------------------------------------------
// knowledge-source.mjs -- Part of RStellarisGui
//
// Parses the hand-written `knowledge/**/*.md` topics into the catalogue shape the rest of
// the plugin reads. This mirrors the sibling RStellarisScribe's `knowledge-source.mjs`, so
// the two knowledge bases are authored and compiled the same way:
//
//   * one topic per file, front matter then `## ` sections;
//   * a fixed category scheme validated here, not by convention;
//   * `## Syntax` code fences, `## Evidence` / `## Rules` bullet items and `## Sources`
//     links become structured arrays, so a search can hit them and a tool can return them
//     as fields rather than as prose to be re-read;
//   * the id must be a slug, and a duplicate id is a hard error - a catalogue that silently
//     shadows one topic with another is worse than a build failure.
//
// The prose that is left after the structured sections are lifted is kept verbatim in
// `body`, so nothing an author wrote is lost by being classified.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The canonical knowledge categories.
 *
 * They follow the plugin's own order of concerns rather than the sibling's: a `.gui` problem
 * is a CONTRACT problem (the engine looks names up by name), a LAYOUT problem (where the
 * rectangle lands), a DRAWING problem (what is painted - and a bar is painted, not declared),
 * a TEXT problem (what the engine measures and what it renders literally), a SCRIPT problem
 * (what lives outside the `.gui` file but decides how it behaves), or a TOOL problem (how
 * this plugin reads and rewrites the file without destroying it).
 */
export const KNOWLEDGE_CATEGORIES = ['contract', 'layout', 'drawing', 'text', 'script', 'tooling'];

/** Front-matter keys kept as scalars. */
const SCALAR_KEYS = ['id', 'category', 'title', 'title_zh', 'verified_version', 'summary'];

/** Front-matter keys parsed as inline arrays. */
const ARRAY_KEYS = ['file_types', 'tags', 'related', 'sources', 'aliases'];

/** Section titles that map onto a structured field. Matched case-insensitively. */
const SYNTAX_TITLES = ['syntax', '语法', 'fields', 'shape'];
const EVIDENCE_TITLES = ['evidence', '依据', 'measurement', 'measured'];
const RULES_TITLES = ['rules', 'rule', '规则', 'what enforces'];

/**
 * `## Breaks` is the counter-examples: the idioms and mechanisms this project MEASURED TO BE
 * WRONG, each with the failure it caused. It is a section kind of its own rather than more
 * `## Rules` precisely because its items are negative - a reader who merges them into the rules
 * list would be reading "do this" and "this is what happened when we did" as one list.
 */
const BREAK_TITLES = ['breaks', 'break', 'traps', 'what breaks'];
const SOURCE_TITLES = ['sources', 'source', 'references', '参考', '来源'];

export class KnowledgeSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KnowledgeSourceError';
  }
}

/**
 * Parse one authored `knowledge/**\/*.md` topic.
 *
 * @param {string} text file contents
 * @param {string} sourcePath path relative to `knowledge/`, for error messages
 * @returns {object} `{id,title,category,file_types,tags,body,syntax_blocks,evidence,rules,
 *          relationships,source_refs,...}`
 */
export function parseTopicSource(text, sourcePath = '<memory>') {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const { frontMatter, body } = splitFrontMatter(normalized, sourcePath);
  const meta = parseFrontMatter(frontMatter, sourcePath);

  const sections = splitSections(body);
  const hasSyntaxSection = sections.some((section) => matchesAny(section.title, SYNTAX_TITLES));

  const syntaxBlocks = [];
  const evidence = [];
  const rules = [];
  const breaks = [];
  const sourceRefs = [...(meta.arrays.sources ?? [])];
  const proseSections = [];

  for (const section of sections) {
    if (matchesAny(section.title, EVIDENCE_TITLES)) {
      evidence.push(...bulletItems(section.content));
      continue;
    }
    if (matchesAny(section.title, RULES_TITLES)) {
      rules.push(...bulletItems(section.content));
      continue;
    }
    if (matchesAny(section.title, BREAK_TITLES)) {
      breaks.push(...bulletItems(section.content));
      continue;
    }
    if (matchesAny(section.title, SOURCE_TITLES)) {
      sourceRefs.push(...linkItems(section.content), ...bulletItems(section.content));
      continue;
    }
    if (matchesAny(section.title, SYNTAX_TITLES)) {
      syntaxBlocks.push(...codeFences(section.content));
      const leftover = stripCodeFences(section.content).trim();
      if (leftover) proseSections.push({ title: section.title, content: leftover });
      continue;
    }
    if (!hasSyntaxSection) syntaxBlocks.push(...codeFences(section.content));
    proseSections.push(section);
  }

  const bodyText = proseSections
    .map((section) => (section.title ? `## ${section.title}\n\n${section.content.trim()}` : section.content.trim()))
    .filter(Boolean)
    .join('\n\n');

  const topic = {
    id: requireString(meta.scalars.id, 'id', sourcePath),
    title: requireString(meta.scalars.title, 'title', sourcePath),
    category: requireString(meta.scalars.category, 'category', sourcePath),
    summary: meta.scalars.summary ?? '',
    file_types: meta.arrays.file_types ?? [],
    tags: meta.arrays.tags ?? [],
    body: bodyText,
    syntax_blocks: dedupe(syntaxBlocks),
    evidence: dedupe(evidence),
    rules: dedupe(rules),
    breaks: dedupe(breaks),
    relationships: dedupe([...(meta.arrays.related ?? []), ...(meta.arrays.aliases ?? [])]),
    source_refs: dedupe(sourceRefs),
    title_zh: meta.scalars.title_zh ?? '',
    verified_version: meta.scalars.verified_version ?? '',
    source_path: sourcePath.split(sep).join('/'),
  };

  validateTopic(topic, sourcePath);
  return topic;
}

/** Read every authored topic below `knowledgeRoot`, sorted by id. */
export function readKnowledgeSources(knowledgeRoot) {
  const paths = [];
  walk(knowledgeRoot, paths);
  const topics = paths.map((path) =>
    parseTopicSource(readFileSync(path, 'utf8'), relative(knowledgeRoot, path)),
  );
  topics.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const seen = new Map();
  for (const topic of topics) {
    const previous = seen.get(topic.id);
    if (previous) {
      throw new KnowledgeSourceError(
        `duplicate knowledge topic id \`${topic.id}\` in ${previous} and ${topic.source_path}`,
      );
    }
    seen.set(topic.id, topic.source_path);
  }

  return topics;
}

/** Recursively collect `*.md` topic files, skipping dot/underscore files and `updates/`. */
function walk(directory, out) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'updates') continue;
      walk(full, out);
      continue;
    }
    if (!entry.name.endsWith('.md')) continue;
    if (entry.name.startsWith('_')) continue;
    if (!statSync(full).isFile()) continue;
    out.push(full);
  }
}

function splitFrontMatter(text, sourcePath) {
  if (!text.startsWith('---')) {
    throw new KnowledgeSourceError(`${sourcePath}: missing front matter block`);
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    throw new KnowledgeSourceError(`${sourcePath}: unterminated front matter block`);
  }
  const afterMarker = text.indexOf('\n', end + 1);
  return {
    frontMatter: text.slice(text.indexOf('\n', 3) + 1, end + 1),
    body: afterMarker === -1 ? '' : text.slice(afterMarker + 1),
  };
}

function parseFrontMatter(block, sourcePath) {
  const scalars = {};
  const arrays = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) {
      throw new KnowledgeSourceError(`${sourcePath}: invalid front matter line \`${line}\``);
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (ARRAY_KEYS.includes(key)) {
      arrays[key] = parseInlineArray(value, sourcePath);
    } else if (SCALAR_KEYS.includes(key)) {
      scalars[key] = unquote(value);
    } else {
      throw new KnowledgeSourceError(`${sourcePath}: unknown front matter key \`${key}\``);
    }
  }
  return { scalars, arrays };
}

function parseInlineArray(value, sourcePath) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new KnowledgeSourceError(`${sourcePath}: expected an inline array, received \`${value}\``);
  }
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((item) => unquote(item.trim()))
    .filter((item) => item.length > 0);
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function splitSections(body) {
  const sections = [];
  let title = '';
  let buffer = [];
  for (const line of body.split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      sections.push({ title, content: buffer.join('\n') });
      title = heading[1].trim();
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  sections.push({ title, content: buffer.join('\n') });
  return sections.filter((section) => section.title || section.content.trim());
}

function matchesAny(title, candidates) {
  const lower = String(title).toLowerCase();
  return candidates.some((candidate) => lower.includes(candidate.toLowerCase()));
}

function bulletItems(content) {
  const items = [];
  let current = null;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    const bullet = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      if (current) items.push(current);
      current = bullet[1].trim();
      continue;
    }
    // A lazy continuation belongs to the bullet above it, so a wrapped evidence line is one
    // item rather than an orphan paragraph.
    if (current && /^\s{2,}\S/.test(line)) {
      current += ' ' + line.trim();
      continue;
    }
    if (current) {
      items.push(current);
      current = null;
    }
  }
  if (current) items.push(current);
  return items.map(stripInlineMarkdown).filter((item) => item.length > 0);
}

function codeFences(content) {
  const blocks = [];
  const pattern = /```[^\n]*\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const block = match[1].replace(/\s+$/, '');
    if (block.trim()) blocks.push(block);
  }
  return blocks;
}

function stripCodeFences(content) {
  return content.replace(/```[^\n]*\n[\s\S]*?```/g, '');
}

function stripInlineMarkdown(text) {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    .trim();
}

function linkItems(content) {
  const links = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) links.push(match[2]);
  if (links.length === 0) {
    for (const bare of content.matchAll(/https?:\/\/[^\s<>)\]]+/g)) links.push(bare[0]);
  }
  return links;
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function requireString(value, key, sourcePath) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KnowledgeSourceError(`${sourcePath}: front matter \`${key}\` is required`);
  }
  return value.trim();
}

/**
 * Reject a topic that would be useless in the catalogue.
 *
 * The rule that matters: a topic must CITE something. This project's whole method is that a
 * claim about the engine rests on the engine - its binary, its own logs, or a vanilla
 * `file:line` - so a topic with no evidence item is refused at build time rather than
 * published as another plausible-sounding guess. `## 待确认` sections are where an author
 * records what could NOT be established, and they are prose on purpose.
 */
function validateTopic(topic, sourcePath) {
  if (!KNOWLEDGE_CATEGORIES.includes(topic.category)) {
    throw new KnowledgeSourceError(
      `${sourcePath}: category \`${topic.category}\` must be one of ${KNOWLEDGE_CATEGORIES.join(', ')}`,
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(topic.id)) {
    throw new KnowledgeSourceError(
      `${sourcePath}: id \`${topic.id}\` must use lowercase letters, digits, dot, dash or underscore`,
    );
  }
  if (!topic.summary.trim()) {
    throw new KnowledgeSourceError(`${sourcePath}: front matter \`summary\` is required`);
  }
  if (!topic.body.trim()) {
    throw new KnowledgeSourceError(`${sourcePath}: topic body is empty after parsing sections`);
  }
  if (topic.syntax_blocks.length === 0) {
    throw new KnowledgeSourceError(`${sourcePath}: at least one \`## Syntax\` code block is required`);
  }
  if (topic.evidence.length === 0) {
    throw new KnowledgeSourceError(
      `${sourcePath}: at least one \`## Evidence\` item is required - a topic that cites nothing is refused`,
    );
  }
  if (topic.rules.length === 0) {
    throw new KnowledgeSourceError(`${sourcePath}: at least one \`## Rules\` item is required`);
  }
}

export default { KNOWLEDGE_CATEGORIES, KnowledgeSourceError, parseTopicSource, readKnowledgeSources };
