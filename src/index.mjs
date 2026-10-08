#!/usr/bin/env node
//------------------------------------------------------------------------------------
// index.mjs -- Part of RStellarisGui
//
// Entry point. Four modes, matching the sibling RStellarisScribe's shape:
//
//   (default)                 run the MCP server over stdio
//   --web                     run only the local web UI and keep it up
//   --skill <subcommand> ...  run one command and return JSON
//   --print-client-config     print the MCP client configuration for this checkout
//
// RStellarisGui is the Stellaris GUI generator: a layout engine, geometry validator and
// preview renderer first, and a `.gui` emitter last, because an agent that writes pixel
// coordinates blind gets no feedback until a human runs the game.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELEMENT_KINDS } from './lib/kinds.mjs';
import { KNOWLEDGE_URI_SCHEME, KnowledgeCatalog, loadLatestUpdate, topicToMarkdown } from './lib/knowledge.mjs';
import { BASE_RESOLUTION } from './lib/layout.mjs';
import { createHandler, runStdio, ToolError } from './lib/mcp.mjs';
import { DEFAULT_GAME_ROOT, GAME_ROOT_ENV, TARGET_VERSION, defaultOutputRoot, resolveGameRoot } from './lib/paths.mjs';
import { createToolRegistry } from './tools/index.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));

const INSTRUCTIONS = `RStellarisGui builds Stellaris 4.4.6 interface layouts and proves their geometry before a human ever runs the game.

Why: a hand-written .gui file gives no feedback. Coordinates are pixels and mistakes only appear in game, so this server is a layout engine, a geometry validator and a preview renderer first, and an emitter last.

Workflow for a new window:
1. gui_assets_defaults for the verified starting sprites and fonts, then gui_assets_search / gui_assets_sprite_info to pick real sprite names. Never invent a sprite or font name: unknown-sprite is an error the validator will report, and the game silently draws nothing.
2. gui_layout_new to get a complete, validating tree, then gui_layout_edit to shape it. Ask for template "option_list" to get a custom_gui_option row.
3. gui_layout_validate. Every finding has coordinates, a severity and a suggested fix. Read the full finding list, not just the verdict.
4. gui_layout_preview with inline_image true to actually look at the layout. The image is the only way to see it without the game.
5. gui_emit_files. It defaults to dry_run = true: inspect the plan, then repeat with dry_run = false and an explicit output_root.

Rules this server enforces for you:
- THERE IS A KNOWLEDGE BASE, AND IT IS THE PLACE TO LOOK FIRST. Every rule below, and every measurement behind it, is a queryable topic: call gui_knowledge_search with two or three specific terms, then gui_knowledge_topic for the one you need, or read a topic directly as the resource rstellarisgui://stellaris/knowledge/<topic_id> (the index is rstellarisgui://stellaris/knowledge/catalog). Each topic states its evidence (a vanilla file:line, an engine log line, or a measured count) and a "待确认" section listing what could NOT be established - so a topic tells you both what is known and where the edge is. Do not grep docs/gui-pitfalls.md for a rule: that file is the HISTORY of how each rule was found, the topics are the RULES.
- All geometry is in a 1920x1080 base resolution, and every report says so. The game scales the UI, so "overlap" and "out of bounds" are only meaningful relative to that base.
- Emitted files are standalone and go ONLY to the output_root you pass. A game install, the user-data folder, or any folder containing descriptor.mod is refused. To override a vanilla file on purpose (the only way to add a button to the planet panel), use gui_emit_override: it records the vanilla file's sha256, refuses without i_understand_this_overrides_vanilla_file, refuses when a recorded hash no longer matches, and still writes only inside your output_root.
- THE SIZE KEYWORD IS PER-KIND, because the engine's own parsers are. instantTextBoxType takes maxWidth/maxHeight and REJECTS size ("Unexpected token: size", "Not used, use maxWidth and maxHeight"); iconType has no size token either; button/listBox/smoothListBox/overlappingElementsBox/guiButton/scrollbar take size = { x = W y = H }; containerWindowType and gridBoxType take size = { width = W height = H }. The emitter writes the right one and resolves percentages into pixels; gui_check_files reports the wrong one, quoting the engine.
- Localisation .yml files are written UTF-8 WITH a BOM (without it the engine ignores the file); .gui and .txt files are UTF-8 with no BOM. gui_check_files checks both on files this tool did not write.
- A window only appears if an event names it: the emitted event stub carries custom_gui = "<containerWindowType name>" and, for option rows, custom_gui_option = "<row container name>". An option row's button must be named "option_button" with text = "OPTION_TEXT". Every emitted event carries at least one option, because the engine logs "Event <id> has no options" otherwise - and gui_check_files reports that on your own events too.
- An effectbuttonType.effect must exist as a top-level key in common/button_effects/*.txt; the emitter writes one for every effect your layout declares, and gui_layout_validate can be pointed at a mod's own button_effects root. "effect" is NOT a field of buttonType: the engine answers "Unexpected token: effect" and the button renders and does nothing, so a control that needs script must be an effectbuttonType (same name/sprite/position/orientation/clicksound). The reference for a scripted control in a window is interface/diplomacy_caravaneer_event_view.gui:69 (tts_button).
- A custom_gui WINDOW IS NOT A BLANK CANVAS. The engine (graphics/diplomatic_eventwindow.cpp) looks a fixed set of elements up BY NAME inside the container the event names, and dereferences them: a missing one is a null dereference. The check reports every missing, duplicated or mis-nested contract name - with option_list required as a direct child of EVENT_DIPLO, the portrait icon nested inside the portrait container, and close as the window's LAST direct child. Read docs/gui-pitfalls.md before writing one; it is cheap to satisfy and expensive to debug.
- THE CLOSE BUTTON SELECTS OPTION 0, and the engine consumes the event before that option's effects run. So option 0 must not unconditionally re-fire the window's own event, and has_active_event cannot detect "this window was open a moment ago". Set a flag from the close control's own button effect and consume it in option 0. The rule custom-gui-option0-selfref reports the pattern and says whether a guard was found.
- PARKED ELEMENTS KEEP THEIR BINDINGS. Parking an element at -3000,-3000 satisfies the name contract without showing chrome, but a parked control still claims its shortcut and its hit area (parked-element-shortcut / parked-element-hit-region). Park with a ZERO size and no shortcut, or it is still a live off-screen control.
- A CONTROL'S VISIBILITY CAN LIVE OUTSIDE THE .gui, AND THE VALIDATOR READS IT. An effectbuttonType does not carry its own visibility: its effect names a key in common/button_effects/, and THAT key's potential decides whether the button is drawn. A potential testing is_scope_type therefore makes the control vanish depending on how the player reached the window (the engine's own option sidebar is immune, because it is the engine's instantiation of the option blocks). gui_layout_validate reads every element's effect against the entries it indexed, reports visibility-scope-dependent (is_scope_type in a potential) and visibility-flag-scope-dependent (a has_planet_flag / has_country_flag potential, which the engine answers from the drawing scope), and returns the whole effect -> potential join as visibility.table EVEN WHEN NO FINDING FIRES - a condition that is true on one route into a window and false on another cannot be shown by findings alone. Declare visibility_scope_guarantees for a window you know is only ever entered in one scope, and the finding becomes visibility-potential-scope-dependent (info) rather than being silenced. The fix is a GLOBAL flag plus a run-time scope pick; query the knowledge base for "button_effects potential is_scope_type".
- AN OUT-OF-BOUNDS ELEMENT MAY BE A DELIBERATE PARK. The idiom for satisfying the name contract without showing chrome is position = { x = -3000 y = -3000 }, which is 3000 px of overflow and used to swamp the real escapes in the count. Past park_margin (default 512 px outside the root) an element is reported as out-of-bounds-parked (info) instead of out-of-bounds (error), and geometry.outOfBounds reports {total, escaped, parked, parkMargin} so the split is COUNTED rather than silent. Nothing is suppressed: each element keeps its own finding. A real escape stays an error; lower park_margin (or set 0 to switch the classification off) if a file's genuine overflows are hiding among the parks.
- gui_log_scan reads the engine's own logs. eventcommands.cpp:88 "... selectedOption N" is the only record of WHICH control was clicked, in order; the scanner turns it into a list and flags two option-0 selections of one event as a close-then-reopen cycle. error.log's "Could not find <name> in window", "Unexpected token: <field>", "Wrong scope for effect", "Event <id> has no options" and "Missing localization key [x]" are classified too. Read it before theorising about a symptom.
- A .gui file's top-level containerWindowTypes are SIBLINGS, not children (an imported file gets a flagged synthetic root). Only one custom_gui window is on screen at a time, so names and overlaps are compared WITHIN a window; gui_layout_import with several paths, or gui_layout_merge, produces one multi-window layout and gui_emit_files writes it as one file.

Element kinds: 16 kinds are emittable (container, text, icon, button, effectbutton, gridBox, listBox, smoothListBox, overlappingElementsBox, guiButton, scrollbar, window, checkbox, spinner, editBox, dropDownBox), each in the size form its own engine parser accepts. positionType is recognised, laid out and validated but reported as "kind-not-emittable" rather than silently dropped, and the reason is measured: its NAME is a literal in stellaris.exe, so a mod cannot author one the engine will look up. TWO COMPONENTS are NOT engine kinds and are expanded by computeLayout before anything is measured: bar (a stat readout) and matrix (rows x columns of positioned cells - use it for a grid, because gridBoxType and OverlappingElementsBoxType are filled by the ENGINE and hold 0 nested elements in the whole install). inspect_rstellarisgui_state lists the table with each kind's keyword, size form and measured vanilla use count.

THE TWO ROUTES ONTO A SCREEN. There is NO effect that opens a window a mod declares and none that closes one: the engine's 1056 documented effects contain exactly four that show a window, and all four target a window the engine owns. So a mod's OWN window is reachable only through custom_gui on an event, and a mod's elements reach an EXISTING view only by shipping interface/<same name>.gui as a full-file override. Overriding is a proven technique (two mods on the reference machine do it, both copying the vanilla file byte for byte and splicing one delimited block into a named container), and the job it creates is anti-drift: gui_emit_override records the vanilla base's sha256 and refuses when it moves, and gui_override_drift says whether it moved and exactly what changed under you.`;

async function buildContext() {
  // No hardcoded install: the environment variable, then detection. A null here is
  // a normal state on a machine without the game, and every tool that needs the
  // install reports it instead of reading a directory that does not exist.
  const gameRoot = (() => {
    try {
      return resolveGameRoot(null);
    } catch {
      return null;
    }
  })();
  const context = {
    projectRoot,
    serverInfo: { name: 'rstellarisgui', version: packageJson.version },
    gameRoot,
    assetIndex: null,
    localisation: null,
    layouts: new Map(),
    lastLayoutId: null,
    /**
     * The knowledge catalogue, as a LAZY promise. The generated snapshot is an ES module and
     * `import` is async, so it is loaded once and resolved by whichever tool or resource asks first.
     * It is deliberately NOT optional: a server without its knowledge base would answer "nothing
     * found" to every question, which is worse than refusing. Loading is deferred rather than started
     * here so that a missing knowledge base surfaces as a clean tool error on the call that needs it,
     * instead of an unhandled rejection while the server is starting up.
     */
    knowledge: null,
    loadKnowledge() {
      this.knowledge ??= KnowledgeCatalog.load({ projectRoot });
      return this.knowledge;
    },
    /**
     * `layout_id -> {id, source, layout}`, the revision each layout was created or last replaced
     * from. It exists for the reverse feedback path: after an agent (or a human) edits a layout,
     * the previous revision is what the diff - and therefore the page's "what changed"
     * highlighting - is measured against.
     */
    previousRevisions: new Map(),
    /** `layout_id -> {id, directory, createdAt}` for a layout loaded from a handoff submission. */
    handoffs: new Map(),
    thumbnailCache: null,
    webUi: null,
    elementKinds: ELEMENT_KINDS.map((spec) => ({
      kind: spec.kind,
      keyword: spec.keywords[0],
      emittable: spec.emitter,
      sizeForm: spec.sizeForm,
      acceptsChildren: spec.acceptsChildren,
      vanillaUses: spec.vanillaUses,
    })),
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
  const registry = {
    serverInfo: context.serverInfo,
    instructions: INSTRUCTIONS,
    tools: createToolRegistry(context),
    resources: createResourceRegistry(context),
  };
  return { context, registry };
}

/**
 * The MCP resource surface: the knowledge catalogue as URIs, matching the sibling
 * RStellarisScribe's shape (`<scheme>/knowledge/catalog` and `<scheme>/knowledge/<topic_id>`).
 *
 * A resource is how an agent reads a topic WITHOUT spending a tool call on it, and the catalogue
 * resource is how it discovers what exists. The tools (`gui_knowledge_search` /
 * `gui_knowledge_topic`) return the same content; a client that supports resources gets the same
 * knowledge base through the door its protocol provides.
 */
function createResourceRegistry(context) {
  const catalogUri = `${KNOWLEDGE_URI_SCHEME}/catalog`;
  const latestUpdateUri = 'rstellarisgui://stellaris/latest-update';

  return {
    list() {
      return [
        {
          uri: catalogUri,
          name: 'knowledge/catalog',
          title: 'The GUI knowledge base index (TOML)',
          description:
            'Every knowledge topic this server carries: id, title, category, summary, tags and the markdown source path, as TOML.',
          mimeType: 'application/toml',
        },
        {
          uri: latestUpdateUri,
          name: 'latest-update',
          title: 'The Stellaris version this knowledge was verified against',
          description: 'The evidence vocabulary and the version the measurements were taken on.',
          mimeType: 'text/markdown',
        },
      ];
    },
    templates() {
      return [
        {
          uriTemplate: `${KNOWLEDGE_URI_SCHEME}/{topic_id}`,
          name: 'knowledge-topic',
          title: 'One knowledge topic (markdown)',
          description:
            'Read one topic in full: the rule, its syntax, the evidence, what enforces it, the measured counter-examples, and what could not be established.',
          mimeType: 'text/markdown',
        },
      ];
    },
    async read(uri) {
      const catalogue = await knowledgeOf(context);
      if (uri === catalogUri) {
        return { uri, mimeType: 'application/toml', text: catalogue.catalogIndexToml() };
      }
      if (uri === latestUpdateUri) {
        const update = loadLatestUpdate(projectRoot);
        return { uri, mimeType: 'text/markdown', text: `# ${update.title}\n\n${update.body}\n` };
      }
      const prefix = `${KNOWLEDGE_URI_SCHEME}/`;
      if (uri.startsWith(prefix)) {
        const id = uri.slice(prefix.length);
        const topic = catalogue.topic(id);
        if (!topic) {
          throw new ToolError(
            `unknown knowledge topic \`${id}\`; read ${catalogUri} for the ${catalogue.topics.length} ids`,
          );
        }
        return { uri, mimeType: 'text/markdown', text: topicToMarkdown(topic, uri) };
      }
      throw new ToolError(
        `unknown resource uri \`${uri}\`; this server serves ${catalogUri}, ${latestUpdateUri} and ` +
          `${KNOWLEDGE_URI_SCHEME}/<topic_id>`,
      );
    },
  };
}

/** Resolve the knowledge catalogue, reporting a missing one as a caller error rather than a crash. */
async function knowledgeOf(context) {
  try {
    return await context.loadKnowledge();
  } catch (thrown) {
    throw new ToolError(
      `the knowledge base could not be loaded: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    );
  }
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(usage());
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${packageJson.name} ${packageJson.version}\n`);
    return;
  }

  const { context, registry } = await buildContext();

  if (argv.includes('--print-client-config')) {
    process.stdout.write(
      JSON.stringify(
        {
          mcpServers: {
            rstellarisgui: { command: process.execPath, args: [join(projectRoot, 'src', 'index.mjs')], env: {} },
          },
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  if (argv.includes('--web')) {
    const portIndex = argv.indexOf('--port');
    const port = portIndex !== -1 ? Number(argv[portIndex + 1]) : 8791;
    const result = await registry.tools.call('gui_web_ui_start', { port });
    process.stdout.write(`${result.url}\n`);
    process.stdout.write(`Serving ${join(projectRoot, 'src', 'web', 'index.html')}\n`);
    process.stdout.write('Press Ctrl+C to stop.\n');
    // Keep the process alive; the HTTP server holds the event loop open on purpose.
    return;
  }

  const skillIndex = argv.indexOf('--skill');
  if (skillIndex !== -1) {
    process.exitCode = await runSkill(argv.slice(skillIndex + 1), registry);
    return;
  }

  await runStdio(createHandler(registry));
}

async function runSkill(rest, registry) {
  const [subcommand, ...operands] = rest;
  try {
    switch (subcommand) {
      case 'list-tools':
        write(registry.tools.list());
        return 0;
      case 'list-resources':
        write(registry.resources.list());
        return 0;
      case 'read-resource': {
        requireOperand(operands[0], 'read-resource requires a URI');
        const resource = await registry.resources.read(operands[0]);
        // Markdown resources print as text; anything else (the TOML catalogue) prints as-is too,
        // because a caller that asked for a URI wants the bytes, not a JSON envelope around them.
        process.stdout.write(resource.text);
        if (!resource.text.endsWith('\n')) process.stdout.write('\n');
        return 0;
      }
      case 'knowledge': {
        write(await registry.tools.call('gui_knowledge_topic', parseArgs(operands)));
        return 0;
      }
      case 'call-tool': {
        requireOperand(operands[0], 'call-tool requires a tool name');
        write(await registry.tools.call(operands[0], parseArgs(operands.slice(1))));
        return 0;
      }
      case 'web-ui-start': {
        const args = parseArgs(operands);
        const result = await registry.tools.call('gui_web_ui_start', args);
        write(result);
        process.stdout.write(`\nOpen ${result.url} in a browser. Press Ctrl+C to stop.\n`);
        return 0;
      }
      case 'defaults': {
        write(await registry.tools.call('gui_assets_defaults', parseArgs(operands)));
        return 0;
      }
      default:
        process.stderr.write(`unknown --skill subcommand \`${subcommand ?? ''}\`\n\n${usage()}`);
        return 2;
    }
  } catch (thrown) {
    process.stderr.write(`${thrown instanceof Error ? thrown.message : String(thrown)}\n`);
    return 1;
  }
}

/**
 * Parse JSON arguments. PowerShell 5.1 rewrites double quotes in a native-command argument, so
 * an inline JSON blob is fragile there: `--json-file <path>` and `-` (stdin) exist for that.
 */
function parseArgs(operands) {
  const fileIndex = operands.indexOf('--json-file');
  if (fileIndex !== -1) {
    const path = operands[fileIndex + 1];
    requireOperand(path, '--json-file requires a path');
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  if (operands[0] === '-') return JSON.parse(readFileSync(0, 'utf8'));
  if (operands[0] && operands[0].trim().startsWith('{')) return JSON.parse(operands[0]);
  return {};
}

function requireOperand(value, message) {
  if (typeof value !== 'string' || value === '') throw new Error(message);
}

function write(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function usage() {
  return `${packageJson.name} ${packageJson.version} - Stellaris GUI generator: layout engine, geometry validator, preview renderer and .gui emitter

Usage
  node src/index.mjs                        Run the MCP server over stdio.
  node src/index.mjs --web [--port 8791]     Run the local web UI and keep it up.
  node src/index.mjs --skill <command> ...   Run one command and print JSON.
  node src/index.mjs --print-client-config   Print MCP client configuration for this checkout.
  node src/index.mjs --help | --version

Skill commands
  list-tools
  list-resources
  call-tool <name> [json-arguments|--json-file <path>|-]
  knowledge [json-arguments|--json-file <path>|-]    gui_knowledge_topic, for convenience
  read-resource <uri>                                e.g. rstellarisgui://stellaris/knowledge/text-has-a-size
  web-ui-start [json-arguments|--json-file <path>|-]
  defaults

Examples
  node src/index.mjs --skill list-tools
  node src/index.mjs --skill call-tool gui_assets_search --json-file args.json
  echo {"query":"close"} | node src/index.mjs --skill call-tool gui_assets_search -
  node src/index.mjs --skill read-resource rstellarisgui://stellaris/knowledge/catalog
  node src/index.mjs --skill call-tool gui_knowledge_search --json-file args.json
  node src/index.mjs --web --port 8791

Notes
  Base resolution for all geometry: ${BASE_RESOLUTION.width}x${BASE_RESOLUTION.height}.
  Stellaris install: pass \`game_root\` per call, or set ${GAME_ROOT_ENV}. Detection found: ${DEFAULT_GAME_ROOT ?? '(nothing - install not found, or not a ${TARGET_VERSION}.x build)'}.
  Only ${TARGET_VERSION}.x is supported: the version in launcher-settings.json is checked, because every constant here was measured against it.
  Default output root: ${defaultOutputRoot()} - emitted files never go anywhere else.
`;
}

main().catch((thrown) => {
  process.stderr.write(`rstellarisgui failed: ${thrown instanceof Error ? thrown.stack : thrown}\n`);
  process.exitCode = 1;
});
