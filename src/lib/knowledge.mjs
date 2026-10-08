//------------------------------------------------------------------------------------
// knowledge.mjs -- Part of RStellarisGui
//
// The knowledge catalogue: the queryable form of everything this plugin has MEASURED
// about Stellaris 4.4.6 interface files. The authored sources are `knowledge/**/*.md`
// (see knowledge-source.mjs); `scripts/build-knowledge.mjs` compiles them into
// `resources/knowledge/**` (portable TOML) and `src/generated/knowledge.mjs` (the snapshot
// the server embeds), and this module loads the snapshot when it is present and the
// authored sources otherwise - so a checkout that has never run the build still works.
//
// WHICH FILE IS CANONICAL FOR WHAT. The knowledge topics are canonical for the RULES the
// engine enforces: what a name contract demands, what a size keyword each kind accepts,
// where an inline icon's sprite name comes from, how a control's visibility is decided.
// `docs/gui-pitfalls.md` is canonical for the HISTORY of how each rule was found - the
// defect, the crash dump, the round trips, the before/after counts on the real mod - and
// every topic that has a counterpart there cites the section and line, so the two cannot
// drift into telling an agent two different things. Where a topic and `docs/` overlap, the
// topic states the rule and the citation; the long-form argument stays in `docs/`.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { KNOWLEDGE_CATEGORIES, KnowledgeSourceError, parseTopicSource, readKnowledgeSources } from './knowledge-source.mjs';
import { tomlMultiline, tomlString, tomlStringArray } from './toml.mjs';

export const SOURCE_FORMAT = 'toml';
export const DATABASE_BACKEND = 'in-memory topic index (RStellarisGui)';
export const KNOWLEDGE_URI_SCHEME = 'rstellarisgui://stellaris/knowledge';

export class KnowledgeCatalog {
  constructor(topics, sourcePaths = []) {
    this.topics = topics;
    this.sourcePaths = sourcePaths;
    this.topicIndex = new Map();
    this.fileTypeIndex = new Map();
    this.searchDocuments = [];

    topics.forEach((topic, position) => {
      this.topicIndex.set(topic.id, position);
      for (const fileType of topic.file_types) {
        const key = fileType.toLowerCase();
        if (!this.fileTypeIndex.has(key)) this.fileTypeIndex.set(key, []);
        this.fileTypeIndex.get(key).push(position);
      }
      this.searchDocuments.push(`${haystack(topic)} ${(sourcePaths[position] ?? '').toLowerCase()}`);
    });
  }

  /**
   * Load the bundled catalogue.
   *
   * The generated snapshot wins because it is what shipped; the authored sources are the
   * fallback so `git clone && node src/index.mjs` is a server WITH a knowledge base even
   * before anyone runs the compiler. There is no third path and no empty catalogue: a
   * missing snapshot and an unreadable `knowledge/` is a hard error, because a knowledge
   * tool that silently answers "nothing found" is worse than one that refuses to start.
   */
  static async load({ projectRoot }) {
    const generatedPath = join(projectRoot, 'src', 'generated', 'knowledge.mjs');
    if (existsSync(generatedPath)) {
      const module = await import(pathToFileURL(generatedPath).href);
      const topics = module.topics ?? [];
      const sourcePaths = module.sourcePaths ?? topics.map((topic) => topic.source_path ?? '');
      if (topics.length === 0) {
        throw new KnowledgeSourceError(
          `${generatedPath} carries no topics; run \`node scripts/build-knowledge.mjs\``,
        );
      }
      return new KnowledgeCatalog(topics, sourcePaths);
    }

    const knowledgeRoot = join(projectRoot, 'knowledge');
    if (!existsSync(knowledgeRoot)) {
      throw new KnowledgeSourceError(
        `no knowledge base: neither ${generatedPath} nor ${knowledgeRoot} exists`,
      );
    }
    const topics = readKnowledgeSources(knowledgeRoot);
    return new KnowledgeCatalog(
      topics,
      topics.map((topic) => topic.source_path),
    );
  }

  get sourceFormat() {
    return SOURCE_FORMAT;
  }

  get databaseBackend() {
    return DATABASE_BACKEND;
  }

  get runtimeTopicCount() {
    return this.topics.length;
  }

  /** The categories actually present, sorted, with their topic counts. */
  categoryCounts() {
    const counts = new Map();
    for (const topic of this.topics) {
      counts.set(topic.category, (counts.get(topic.category) ?? 0) + 1);
    }
    return Object.fromEntries([...counts.entries()].sort());
  }

  topic(id) {
    const position = this.topicIndex.get(String(id));
    return position === undefined ? undefined : this.topics[position];
  }

  byFileType(fileType) {
    const positions = this.fileTypeIndex.get(String(fileType).toLowerCase()) ?? [];
    return positions.map((position) => this.topics[position]);
  }

  byCategory(category) {
    return this.topics.filter((topic) => topic.category === category);
  }

  /**
   * Search the catalogue. EVERY whitespace-separated term must appear in the topic
   * haystack, which is the sibling project's rule and is the right one for this material:
   * a query like `option_list EVENT_DIPLO` means "the topic that is about BOTH", and OR
   * semantics would return the whole catalogue for a two-word query.
   */
  search(query) {
    const terms = String(query ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => term.toLowerCase());
    if (terms.length === 0) return [];
    // Enumerate BEFORE filtering. Filtering first and then reading `topics[index]` would
    // renumber the matches and return unrelated topics.
    return this.searchDocuments
      .map((document, index) => ({ document, index }))
      .filter(({ document }) => terms.every((term) => document.includes(term)))
      .map(({ index }) => this.topics[index])
      .filter(Boolean);
  }

  /** The catalogue index, as TOML, in the shape the sibling server exposes. */
  catalogIndexToml() {
    const lines = [
      `source_format = ${tomlString(this.sourceFormat)}`,
      `database_backend = ${tomlString(this.databaseBackend)}`,
      '',
      `topic_count = ${this.topics.length}`,
      '',
      `categories = ${tomlStringArray(KNOWLEDGE_CATEGORIES)}`,
      '',
      `source_paths = ${tomlStringArray(this.sourcePaths)}`,
      '',
    ];
    this.topics.forEach((topic, position) => {
      lines.push('[[topics]]');
      lines.push(`id = ${tomlString(topic.id)}`);
      lines.push(`title = ${tomlString(topic.title)}`);
      lines.push(`category = ${tomlString(topic.category)}`);
      lines.push(`summary = ${tomlString(topic.summary ?? '')}`);
      lines.push(`source_path = ${tomlString(this.sourcePaths[position] ?? '')}`);
      lines.push(`tags = ${tomlStringArray(topic.tags)}`);
      lines.push('');
    });
    return lines.join('\n');
  }
}

/** Load the generated `updates/latest-update` document, falling back to the authored source. */
export function loadLatestUpdate(projectRoot) {
  const generatedPath = join(projectRoot, 'src', 'generated', 'knowledge.mjs');
  if (existsSync(generatedPath)) {
    const text = readFileSync(generatedPath, 'utf8');
    const match = /export const latestUpdate = (\{[\s\S]*?\n\});/.exec(text);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed?.title && parsed?.body) return parsed;
      } catch {
        // fall through to the authored source
      }
    }
  }
  const sourcePath = join(projectRoot, 'knowledge', 'updates', 'latest-update.md');
  if (!existsSync(sourcePath)) {
    return {
      title: 'Stellaris 4.4.6 Pegasus',
      body: 'No bundled update snapshot is present in this checkout.',
    };
  }
  const text = readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const end = text.indexOf('\n---', 3);
  const frontMatter = end === -1 ? '' : text.slice(text.indexOf('\n', 3) + 1, end);
  const titleLine = /^title:\s*(.*)$/m.exec(frontMatter);
  const body = end === -1 ? text.trim() : text.slice(text.indexOf('\n', end + 1) + 1).trim();
  return { title: titleLine ? titleLine[1].trim().replace(/^["']|["']$/g, '') : 'Stellaris 4.4.6 Pegasus', body };
}

/**
 * Render a topic as the markdown resource an MCP client reads.
 *
 * The point of the resource is that an agent gets the RULE, the CITATION and the structured
 * fields in one document, and does not have to be handed a 1000-line pitfalls file and hope
 * it finds the right paragraph.
 */
export function topicToMarkdown(topic, uri = null) {
  const parts = [
    `# ${topic.title}`,
    '',
    `- ID: ${topic.id}`,
    `- Category: ${topic.category}`,
    `- File types: ${topic.file_types.join(', ')}`,
    `- Tags: ${topic.tags.join(', ')}`,
    `- Verified against: ${topic.verified_version || '(unstated)'}`,
  ];
  if (uri) parts.push(`- URI: ${uri}`);
  if (topic.title_zh) parts.push(`- 中文标题: ${topic.title_zh}`);
  if (topic.summary) parts.push('', topic.summary);
  parts.push('', topic.body);
  const sections = [
    markdownCodeList('Syntax', topic.syntax_blocks, 'pdx'),
    markdownList('Evidence', topic.evidence),
    markdownList('Rules', topic.rules),
    markdownList('Breaks', topic.breaks),
    markdownList('Related', topic.relationships),
    markdownList('Source references', topic.source_refs),
  ].filter(Boolean);
  if (sections.length > 0) parts.push('', sections.join('\n'));
  return parts.join('\n');
}

/** Serialise a topic into its canonical TOML file. */
export function topicToToml(topic) {
  return [
    `id = ${tomlString(topic.id)}`,
    '',
    `title = ${tomlString(topic.title)}`,
    '',
    `category = ${tomlString(topic.category)}`,
    '',
    `summary = ${tomlString(topic.summary ?? '')}`,
    '',
    `file_types = ${tomlStringArray(topic.file_types)}`,
    '',
    `tags = ${tomlStringArray(topic.tags)}`,
    '',
    `body = ${tomlMultiline(topic.body)}`,
    '',
    `syntax_blocks = ${tomlStringArray(topic.syntax_blocks)}`,
    '',
    `evidence = ${tomlStringArray(topic.evidence)}`,
    '',
    `rules = ${tomlStringArray(topic.rules)}`,
    '',
    `breaks = ${tomlStringArray(topic.breaks ?? [])}`,
    '',
    `relationships = ${tomlStringArray(topic.relationships)}`,
    '',
    `source_refs = ${tomlStringArray(topic.source_refs)}`,
    '',
    `title_zh = ${tomlString(topic.title_zh ?? '')}`,
    '',
    `verified_version = ${tomlString(topic.verified_version ?? '')}`,
    '',
  ].join('\n');
}

/** Parse a canonical TOML topic file back into a topic. Enough for a round-trip assertion. */
export function topicFromToml(text) {
  const readString = (key) => {
    const match = new RegExp(`^${key} = "(.*)"$`, 'm').exec(text);
    return match ? match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '';
  };
  const readArray = (key) => {
    const match = new RegExp(`^${key} = \\[\\n([\\s\\S]*?)\\n\\]`, 'm').exec(text) ?? new RegExp(`^${key} = \\[\\]$`, 'm').exec(text);
    if (!match) return [];
    if (match[1] === undefined) return [];
    return [...match[1].matchAll(/^\s*"(.*)",?$/gm)].map((entry) => entry[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  };
  const bodyMatch = /^body = """\n([\s\S]*?)\n"""$/m.exec(text);
  return {
    id: readString('id'),
    title: readString('title'),
    category: readString('category'),
    summary: readString('summary'),
    file_types: readArray('file_types'),
    tags: readArray('tags'),
    body: bodyMatch ? bodyMatch[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '',
    syntax_blocks: readArray('syntax_blocks'),
    evidence: readArray('evidence'),
    rules: readArray('rules'),
    breaks: readArray('breaks'),
    relationships: readArray('relationships'),
    source_refs: readArray('source_refs'),
    title_zh: readString('title_zh'),
    verified_version: readString('verified_version'),
  };
}

function markdownList(title, items) {
  if (!items || items.length === 0) return '';
  return `## ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}\n`;
}

function markdownCodeList(title, items, language) {
  if (!items || items.length === 0) return '';
  const blocks = items.map((item) => `\`\`\`${language}\n${item.replace(/\s+$/, '')}\n\`\`\``).join('\n\n');
  return `## ${title}\n\n${blocks}\n`;
}

/** Everything a search term can match, lowercased. */
function haystack(topic) {
  return [
    topic.id,
    topic.title,
    topic.title_zh ?? '',
    topic.category,
    topic.summary ?? '',
    topic.file_types.join(' '),
    topic.tags.join(' '),
    topic.relationships.join(' '),
    topic.body,
    topic.syntax_blocks.join(' '),
    topic.evidence.join(' '),
    topic.rules.join(' '),
    (topic.breaks ?? []).join(' '),
    topic.source_refs.join(' '),
  ]
    .join(' ')
    .toLowerCase();
}

export { KNOWLEDGE_CATEGORIES, KnowledgeSourceError, parseTopicSource, readKnowledgeSources };

export default {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_URI_SCHEME,
  KnowledgeCatalog,
  loadLatestUpdate,
  topicFromToml,
  topicToMarkdown,
  topicToToml,
};
