//------------------------------------------------------------------------------------
// contract.mjs -- Part of RStellarisGui
//
// THE EVENT-WINDOW CONTRACT. A `custom_gui` window is not a blank canvas: the engine's
// `graphics/diplomatic_eventwindow.cpp` looks a fixed set of elements up BY NAME inside the
// container the event names, and dereferences each one it finds. An element it cannot find is a
// null dereference - the game crashes - and nothing in the .gui, the preview or the geometry
// validator can see that, because the file parses perfectly and lays out perfectly.
//
// WHERE THE LIST COMES FROM (measured, not remembered):
//   * `stellaris.exe` (4.4.6, 46,418,552 bytes) holds the source path
//     `...\source\graphics\diplomatic_eventwindow.cpp` and, immediately after it, one contiguous
//     ASCII table of the names that file asks for:
//       event_option_entry empire_info_bg EVENT_DIPLO option_button INCOMING_TRANSMISSION
//       leader_traits leader_traits_box leader_details leader_species option_list
//       PICK_EVENT_OPTION leader_traits_label empire_traits_label
//     Reproduce with `node out/probe-binary-strings.mjs`.
//   * The rest of the list is the standard event-window furniture every vanilla event window
//     declares, censused over the install's own 177 .gui files with
//     `node out/probe-contract-census2.mjs`. It is a USAGE measurement, so it is stated as one.
//
// WHAT IS AN ERROR AND WHAT IS A WARNING:
//   * error   - the name does not exist anywhere in the window's subtree. This is the crash class.
//   * error   - `option_list` is not a direct child of `EVENT_DIPLO`; `close` is not the window's
//               last direct child; a contract name is declared twice in one window.
//   * warning - the `portrait` icon is not nested inside the `portrait` container, where vanilla
//               always puts it (the container is what clips / masks the portrait).
//
// The check is deliberately NOT applied to every container. It fires for a window that declares
// `EVENT_DIPLO`, or when the caller names the window (an event's `custom_gui`), or when the caller
// asks for it outright. See `isEventWindow` for why: a container that has never been an event
// window - an option row, a chart panel, a vanilla non-event view - must not be told it is missing
// 26 elements it never needed.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

/**
 * A contract element. Four independent statements are attached to each one, because they are
 * different kinds of evidence and must not be blended:
 *
 *   `group: 'binary'`       the name is a literal in stellaris.exe beside the
 *                           `graphics/diplomatic_eventwindow.cpp` path - the engine asks for it.
 *   `windows`               how many of the install's 177 `.gui` files declare an element with that
 *                           name. A USAGE measurement (`out/probe-contract-census2.mjs`).
 *   `inWorkingWindow: true` a real custom_gui window uses it: one of the names the shipped trial
 *                           mod declares, which is the set verified live in game against
 *                           `logs/error.log` (`Could not find ... in window` = 0).
 *   `demand`                what a MISSING name costs:
 *                             'error'   the engine null-dereferences it and the crash was observed
 *                             'warning' the engine asks for it, or 11+ vanilla windows declare it,
 *                                       but no crash in this project was traced to it
 *                             'note'    the engine asks for it and NO working window (and 0-2
 *                                       vanilla files) declares it - a real risk that cannot be
 *                                       turned into a finding without calling the live-verified
 *                                       mod broken
 *
 * `REQUIRED_WINDOW_NAMES` is derived from `demand`, so this table is the single source of truth.
 */
export const CONTRACT_ELEMENTS = [
  // ---- The four names whose absence was traced to a crash (see docs/gui-pitfalls.md L1).
  { name: 'empire_info_bg', group: 'binary', windows: 11, inWorkingWindow: true, demand: 'error', note: 'the empire info panel background' },
  { name: 'EVENT_DIPLO', group: 'binary', windows: 10, inWorkingWindow: true, demand: 'error', note: 'the container the engine resolves action_title/action_desc/option_list inside' },
  { name: 'option_list', group: 'binary', windows: 14, inWorkingWindow: true, demand: 'error', note: 'the list the engine instantiates one option row into PER OPTION' },
  { name: 'close', group: 'vanilla', windows: 104, inWorkingWindow: true, demand: 'error', note: 'the X. The engine wires it to OPTION 0 - see docs/gui-pitfalls.md L3' },
  // ---- Engine-table names a working window declares, with no crash traced to them here.
  { name: 'leader_traits', group: 'binary', windows: 13, inWorkingWindow: true, demand: 'warning', note: 'the leader trait icons' },
  { name: 'leader_details', group: 'binary', windows: 10, inWorkingWindow: true, demand: 'warning', note: 'the leader sub-block' },
  { name: 'leader_species', group: 'binary', windows: 10, inWorkingWindow: true, demand: 'warning', note: 'the leader species text' },
  // ---- Engine-table names no working window declares.
  { name: 'event_option_entry', group: 'binary', windows: 1, demand: 'note', note: 'the option row template; only interface/diplomacy_event_view.gui declares it, as its own top-level container' },
  { name: 'INCOMING_TRANSMISSION', group: 'binary', windows: 0, demand: 'note', note: 'letterspaced heading art; 0 vanilla .gui uses in 4.4.6' },
  { name: 'leader_traits_box', group: 'binary', windows: 2, demand: 'note', note: 'the leader trait panel (interface/diplomacy_event_view.gui:244); the working window has `empire_traits_box` instead' },
  { name: 'PICK_EVENT_OPTION', group: 'binary', windows: 0, demand: 'note', note: 'the option-picker prompt; 0 vanilla .gui uses in 4.4.6' },
  { name: 'leader_traits_label', group: 'binary', windows: 2, demand: 'note', note: 'the leader trait label (interface/diplomacy_event_view.gui:268); the working window omits it' },
  { name: 'empire_traits_label', group: 'binary', windows: 10, demand: 'note', note: 'the empire trait label (interface/diplomacy_event_view.gui:255); the working window omits it' },
  // ---- Declared by 11+ of the install's 177 .gui files.
  { name: 'heading', group: 'vanilla', windows: 16, inWorkingWindow: true, demand: 'warning', note: 'the window heading text' },
  { name: 'action_title', group: 'vanilla', windows: 12, inWorkingWindow: true, demand: 'warning', note: 'resolved inside EVENT_DIPLO' },
  { name: 'action_desc', group: 'vanilla', windows: 12, inWorkingWindow: true, demand: 'warning', note: 'resolved inside EVENT_DIPLO' },
  { name: 'alien_message', group: 'vanilla', windows: 12, inWorkingWindow: true, demand: 'warning', note: 'the event description text' },
  { name: 'alien_message_background', group: 'vanilla', windows: 11, inWorkingWindow: true, demand: 'warning', note: 'the description panel' },
  { name: 'tts_button', group: 'vanilla', windows: 26, inWorkingWindow: true, demand: 'warning', note: 'the text-to-speech control' },
  { name: 'portrait_background', group: 'vanilla', windows: 13, inWorkingWindow: true, demand: 'warning', note: 'the portrait frame' },
  { name: 'portrait', group: 'vanilla', windows: 42, inWorkingWindow: true, demand: 'warning', note: 'the portrait container, AND an icon of the same name INSIDE it' },
  { name: 'empire_name', group: 'vanilla', windows: 20, inWorkingWindow: true, demand: 'warning', note: 'the empire name text' },
  { name: 'empire_government_type', group: 'vanilla', windows: 12, inWorkingWindow: true, demand: 'warning', note: 'the government text' },
  { name: 'empire_personality_type', group: 'vanilla', windows: 12, inWorkingWindow: true, demand: 'warning', note: 'the personality text' },
  { name: 'empire_flag', group: 'vanilla', windows: 17, inWorkingWindow: true, demand: 'warning', note: 'the flag button' },
  { name: 'empire_ethics_icons', group: 'vanilla', windows: 12, inWorkingWindow: true, demand: 'warning', note: 'the ethics icon box' },
  { name: 'focus_button', group: 'vanilla', windows: 12, inWorkingWindow: true, demand: 'warning', note: 'the "focus on capital" button' },
  { name: 'confirm_button', group: 'vanilla', windows: 17, inWorkingWindow: true, demand: 'warning', note: 'the OK control' },
  { name: 'opinion_window', group: 'vanilla', windows: 11, inWorkingWindow: true, demand: 'warning', note: 'the opinion sub-panel' },
  { name: 'opinion_bg', group: 'vanilla', windows: 11, inWorkingWindow: true, demand: 'warning', note: 'inside opinion_window, written as its `background = { name = ... }`' },
  { name: 'their_opinion_icon', group: 'vanilla', windows: 12, inWorkingWindow: true, demand: 'warning', note: 'inside opinion_window' },
  { name: 'their_opinion', group: 'vanilla', windows: 12, inWorkingWindow: true, demand: 'warning', note: 'inside opinion_window' },
];

/**
 * A vanilla-usage name must appear in at least this many of the install's 177 `.gui` files to be
 * demanded.
 *
 * `empire_info_bg` (11) is in; `event_option_entry` (1), `leader_traits_box` (2) and
 * `leader_traits_label` (2) are out. The threshold is the calibration that reproduces the working
 * set: every name it keeps is declared by 11 or more vanilla files, and the three it drops are
 * declared by 1-2 - the same three the live-verified mod omits.
 */
export const CONTRACT_MIN_WINDOWS = 10;

/**
 * The names a `custom_gui` window is checked against: 26 of the 32.
 *
 * The rule, stated so it can be argued with: a name is demanded when it is not a `note`, AND
 * (a working window declares it OR at least CONTRACT_MIN_WINDOWS vanilla files do).
 */
export function demandedContractNames(elements = CONTRACT_ELEMENTS) {
  return elements
    .filter((entry) => entry.demand !== 'note')
    .filter((entry) => entry.inWorkingWindow === true || entry.windows >= CONTRACT_MIN_WINDOWS)
    .map((entry) => entry.name);
}

/** The names a `custom_gui` window is expected to declare. */
export const REQUIRED_WINDOW_NAMES = demandedContractNames();

/** Names carried as a NOTE: the engine's table mentions them, no working window declares them. */
export const NOTE_WINDOW_NAMES = CONTRACT_ELEMENTS.filter((entry) => entry.demand === 'note').map((entry) => entry.name);

/** A name that is a CONTROL, not decoration: the engine picks the first one it finds by name. */
const CONTROL_KINDS = new Set(['button', 'effectbutton', 'guiButton', 'checkbox', 'editBox']);

/** Controls whose name says "close this window". */
const CLOSE_LIKE = /^(close|exit|dismiss|cancel|back|abort)/i;
void CLOSE_LIKE;

/**
 * The contract names where a SECOND copy inside one window is a defect.
 *
 * Not every duplicate is: vanilla nests an `iconType` named `portrait` inside a
 * `containerWindowType` named `portrait` in every one of its event windows, and an `option_button`
 * is a copy inside each option-row template by construction. These are the names the engine binds
 * or fills directly - and therefore the ones where "whichever copy the engine reaches first"
 * decides what the player can click or read.
 */
const DUPLICATE_MATTERS = new Set([
  'close',
  'option_list',
  'EVENT_DIPLO',
  'action_title',
  'action_desc',
  'alien_message',
  'heading',
  'confirm_button',
  'focus_button',
  'empire_flag',
]);

/** Fields that claim a keyboard binding. */
export const SHORTCUT_FIELDS = ['shortcut', 'shortCut', 'actionShortcut'];

/**
 * Rule severities for everything this module reports. Wired into validate.mjs RULE_SEVERITY.
 *
 * `custom-gui-contract-missing` and `custom-gui-contract-duplicate` are listed with the severity
 * they carry when the caller CONFIRMED the window (an event's `custom_gui` names it) or the source
 * file is not part of the install; both downgrade to `warning` for a window the analyser merely
 * inferred. A shipped vanilla .gui must never be reported as an error.
 */
export const CONTRACT_SEVERITY = {
  'custom-gui-contract-missing': 'error',
  'custom-gui-contract-duplicate': 'error',
  'custom-gui-contract-nesting': 'error',
  'custom-gui-portrait-nesting': 'warning',
  'custom-gui-close-not-last': 'error',
  'parked-element-shortcut': 'warning',
  'parked-element-hit-region': 'warning',
  'parked-duplicate-of-live-control': 'info',
  'custom-gui-option0-selfref': 'warning',
  'custom-gui-force-open': 'warning',
  'install-file-custom-gui': 'info',
};

export const CONTRACT_DESCRIPTIONS = {
  'custom-gui-contract-missing':
    'an element name `diplomatic_eventwindow.cpp` looks up by name is missing from the window (null dereference / crash)',
  'custom-gui-contract-duplicate': 'a contract name is declared twice inside one window',
  'custom-gui-contract-nesting': '`option_list` is not a direct child of `EVENT_DIPLO`, or `EVENT_DIPLO`/`action_title`/`action_desc` is missing',
  'custom-gui-portrait-nesting': 'the `portrait` icon is not nested inside the `portrait` container',
  'custom-gui-close-not-last': '`close` is not the window\'s last direct child, so later siblings draw over it',
  'parked-element-shortcut': 'an element parked off-canvas still claims a keyboard `shortcut`',
  'parked-element-hit-region': 'an element parked off-canvas still has a non-zero hit area',
  'parked-duplicate-of-live-control': 'a parked element duplicates the name of a live control in the same window',
  'custom-gui-option0-selfref': 'the window\'s FIRST event option unconditionally fires the event that opened the window',
  'custom-gui-force-open': '`force_open` is combined with `custom_gui` (vanilla never does)',
  'install-file-custom-gui': 'an install .gui file was checked as if it were a mod\'s custom_gui window (informational)',
};

/** How many contract names must be direct children before an unnamed container is treated as one. */
const EVENT_WINDOW_NAME_THRESHOLD = 3;

/** Does this container have the SHAPE of a window: `EVENT_DIPLO`, or several contract children? */
export function looksLikeEventWindow(node) {
  const direct = (node?.children ?? []).map((child) => child.name).filter(Boolean);
  if (direct.includes('EVENT_DIPLO')) return true;
  const contractNames = new Set(REQUIRED_WINDOW_NAMES);
  return direct.filter((name) => contractNames.has(name)).length >= EVENT_WINDOW_NAME_THRESHOLD;
}

/**
 * Is this container an event window - i.e. is the contract check worth running on it?
 *
 * Four signals decide it, and the SHAPE check is a gate on the first two:
 *   1. it has the shape of a window (a direct `EVENT_DIPLO` child, or
 *      `EVENT_WINDOW_NAME_THRESHOLD` contract children) - see `looksLikeEventWindow`;
 *   2. the caller named it (`customGuiWindows`: an event's `custom_gui` points at it);
 *   3. `checkAllWindows` was asked for;
 *   4. otherwise it is skipped.
 *
 * Why the shape gate matters, measured on the trial mod: an event's `custom_gui_option` names the
 * OPTION ROW container (`geocentric_unga_nav_option`, 66 uses), and `custom_gui` on a single option
 * often does the same - see `interface/diplomacy_caravaneer_event_view.gui:5`, whose top-level
 * `enclave_caravaneer_option` holds `option_button` + `OPTION_TEXT` and nothing else. A row has none
 * of the 26 contract names, so without the gate the checker told a correct mod that its option row
 * was "missing 26 element names" - three false errors before this gate existed.
 */
export function isEventWindow(node, options = {}) {
  const name = node?.name ?? null;
  const named = new Set(options.customGuiWindows ?? []);
  if (name && named.has(name)) return looksLikeEventWindow(node);
  if (options.checkAllWindows === true) return true;
  return looksLikeEventWindow(node);
}

/** Absolute rect of a box, rounded, for messages. */
function rectOf(box) {
  return {
    x: Math.round(box.rect.x),
    y: Math.round(box.rect.y),
    width: Math.round(box.rect.width),
    height: Math.round(box.rect.height),
  };
}

/** `file:line` for a node, or its path. */
function whereOf(node, fallback) {
  return node?.sourceFile ? `${node.sourceFile}:${node.sourceLine ?? '?'}` : fallback;
}

/** Every direct child of `node` with a name, in document order. */
function directChildren(node) {
  return (node?.children ?? []).filter((child) => child.name);
}

/** Every descendant of `node` (excluding `node`) carrying `name`, with its parent node. */
function findAll(root, name, out = [], parent = null) {
  for (const child of root?.children ?? []) {
    if (child.name === name) out.push({ node: child, parent: root });
    findAll(child, name, out, child);
  }
  return out;
}

/**
 * Every element name declared inside a window's subtree, at what depth, plus the names that are a
 * `background = { name = ... }` block rather than an element.
 *
 * Background names matter for one contract entry: `opinion_bg` is always written as the
 * `background` block of `opinion_window` (11 vanilla files, e.g.
 * interface/diplomacy_caravaneer_event_view.gui:303), and the parser stores a `background` block on
 * `node.background`, NOT as a child. Without this, a window that declares `opinion_bg` exactly the
 * way vanilla does was reported as not declaring it at all.
 */
function collectNames(window) {
  const occurrences = new Map();
  const backgroundNames = new Set();
  const collect = (node, depth) => {
    const background = node?.background?.name;
    if (typeof background === 'string' && background !== '') backgroundNames.add(background);
    for (const child of node?.children ?? []) {
      if (child.name) {
        const list = occurrences.get(child.name) ?? [];
        list.push({ node: child, depth });
        occurrences.set(child.name, list);
      }
      collect(child, depth + 1);
    }
  };
  collect(window, 1);
  return { occurrences, backgroundNames };
}

/**
 * Analyse one event window against the contract.
 *
 * @param {object} window the window container node
 * @param {Map<object, object>} boxByNode node -> layout box
 * @param {{explicit?: boolean}} options `explicit` means the caller named this window as an event's
 *        `custom_gui`; only then is a missing contract name an ERROR. For a window the analyser
 *        merely INFERRED is an event window (it has an `EVENT_DIPLO` child), the same finding is a
 *        WARNING - a real vanilla window does not declare every name either (measured: the
 *        install's event windows carry 26-31 of the 32), and the plugin must not call a shipped
 *        vanilla file broken.
 * @returns {object[]} findings (rule/severity/message/suggestedFix/where/path)
 */
function analyseWindow(window, boxByNode, options = {}) {
  const findings = [];
  const windowName = window.name ?? '(unnamed window)';
  const windowWhere = whereOf(window, windowName);
  const explicit = options.explicit === true;
  const push = (finding) => findings.push({ suggestedFix: null, element: windowName, ...finding });

  const { occurrences, backgroundNames } = collectNames(window);
  const has = (name) => occurrences.has(name) || backgroundNames.has(name);

  for (const [name, list] of occurrences) {
    if (DUPLICATE_MATTERS.has(name) && list.length > 1) {
      push({
        rule: 'custom-gui-contract-duplicate',
        severity: explicit ? 'error' : 'warning',
        where: whereOf(list[0].node, windowWhere),
        path: `${windowName}/${name}`,
        kind: list[0].node.kind ?? null,
        message:
          `\`${name}\` is declared ${list.length} times inside \`${windowName}\` (depths ${list.map((entry) => entry.depth).join(', ')}). ` +
          'The engine resolves this contract name to whichever occurrence it reaches first, so a name the engine binds ' +
          '(the close control, the option list) can silently become the copy you did not mean to expose. Vanilla proves ' +
          'the risk is real: a duplicate `close` in a parked position is what broke the trial mod\'s window.',
        suggestedFix: `keep one \`${name}\`; park the other under a different name (e.g. \`${name}_parked\`), or delete it.`,
      });
    }
  }

  // ---- every demanded name exists somewhere in the window's subtree.
  const missing = REQUIRED_WINDOW_NAMES.filter((name) => !has(name));
  const errorMissing = missing.filter((name) => CONTRACT_ELEMENTS.find((entry) => entry.name === name)?.demand === 'error');
  if (missing.length > 0) {
    push({
      rule: 'custom-gui-contract-missing',
      severity: explicit && errorMissing.length > 0 ? 'error' : 'warning',
      where: windowWhere,
      path: windowName,
      message:
        `\`${windowName}\` declares ${REQUIRED_WINDOW_NAMES.length - missing.length} of the ${REQUIRED_WINDOW_NAMES.length} ` +
        `element names this project's evidence says a \`custom_gui\` window needs` +
        (explicit
          ? ', and an event names THIS window with `custom_gui`'
          : ' (this window was inferred to be an event window: it declares `EVENT_DIPLO`)') +
        `: missing ${missing.join(', ')}. ` +
        (errorMissing.length > 0
          ? `${errorMissing.length} of them (${errorMissing.join(', ')}) are the CRASH class: the engine dereferences ` +
            'every one with that name it can find (its own string table beside ' +
            '`graphics/diplomatic_eventwindow.cpp`), and this project traced real crashes to a missing one. '
          : '') +
        'A demanded name is one the engine\'s table uses AND a real `custom_gui` window declares, or one declared by ' +
        `at least ${CONTRACT_MIN_WINDOWS} of the install's 177 .gui files. The engine-table names no working window ` +
        `declares (${NOTE_WINDOW_NAMES.join(', ')}) are deliberately NOT demanded - demanding them would ` +
        'report the live-verified trial mod as broken. They are still worth declaring, and the reason each one is a ' +
        'note is in src/lib/contract.mjs. ' +
        'The safe idiom is to declare each one and park the ones you do not want to show off-canvas at -3000,-3000 ' +
        'with a zero size (see docs/gui-pitfalls.md, "parking").',
      suggestedFix:
        'declare the missing names; copy the shape from interface/diplomacy_caravaneer_event_view.gui:34-364 ' +
        '(containerWindowType enclave_caravaneer_window).',
      missing,
      errorMissing,
      noteOnly: NOTE_WINDOW_NAMES,
    });
  }

  // ---- EVENT_DIPLO is the container the engine resolves three names INSIDE.
  const diplo = findAll(window, 'EVENT_DIPLO')[0]?.node ?? null;
  if (diplo) {
    const insideDiplo = new Set((diplo.children ?? []).map((child) => child.name).filter(Boolean));
    const optionList = findAll(window, 'option_list');
    const optionListInDiplo = (diplo.children ?? []).some((child) => child.name === 'option_list');
    if (optionList.length > 0 && !optionListInDiplo) {
      push({
        rule: 'custom-gui-contract-nesting',
        severity: explicit ? 'error' : 'warning',
        where: whereOf(optionList[0].node, windowWhere),
        path: `${windowName}/EVENT_DIPLO/option_list`,
        message:
          `\`option_list\` exists but is NOT a direct child of \`EVENT_DIPLO\` (it is at depth ` +
          `${(occurrences.get('option_list') ?? [])[0]?.depth ?? '?'} from the window). The engine fills the option ` +
          'list it finds under EVENT_DIPLO; a deeper list is never instantiated, so the window opens with no options ' +
          'and cannot be dismissed. This is measured: an early revision of the trial mod had `option_list` two ' +
          'containers deep and the sidebar stayed empty. Vanilla nests it exactly one level down, in ' +
          'interface/diplomacy_caravaneer_event_view.gui:353-354.',
        suggestedFix: 'move the `option_list` element so that it is a direct child of the `EVENT_DIPLO` container.',
      });
    }
    for (const name of ['action_title', 'action_desc']) {
      if (!insideDiplo.has(name) && occurrences.has(name)) {
        push({
          rule: 'custom-gui-contract-nesting',
          severity: explicit ? 'error' : 'warning',
          where: whereOf((occurrences.get(name) ?? [])[0]?.node, windowWhere),
          path: `${windowName}/${name}`,
          message:
            `\`${name}\` is declared outside \`EVENT_DIPLO\`. The engine resolves \`action_title\` and \`action_desc\` ` +
            'INSIDE that container, so a copy elsewhere is not the one it fills and the title/description stay empty.',
          suggestedFix: `move the \`${name}\` element inside the \`EVENT_DIPLO\` container.`,
        });
      }
    }
  }

  // ---- portrait: the container and the icon inside it.
  const portraits = occurrences.get('portrait') ?? [];
  if (portraits.length > 0) {
    const container = portraits.find((entry) => entry.node.kind === 'container' || entry.node.kind === 'window');
    if (container) {
      const nested = findAll(container.node, 'portrait').length;
      if (nested === 0) {
        push({
          rule: 'custom-gui-portrait-nesting',
          severity: 'warning',
          where: whereOf(container.node, windowWhere),
          path: `${windowName}/portrait`,
          kind: container.node.kind,
          message:
            'the `portrait` CONTAINER holds no icon named `portrait`. Vanilla always nests one ' +
            '(interface/diplomacy_caravaneer_event_view.gui:145-152: containerWindowType portrait > iconType portrait); ' +
            'the engine draws the character into that inner element, and the container is what clips and masks it.',
          suggestedFix: 'add `iconType = { name = "portrait" spriteType = "GFX_portrait_character" }` inside the container.',
        });
      }
    } else {
      push({
        rule: 'custom-gui-portrait-nesting',
        severity: 'warning',
        where: whereOf(portraits[0].node, windowWhere),
        path: `${windowName}/portrait`,
        kind: portraits[0].node.kind,
        message:
          `\`portrait\` is declared as \`${portraits[0].node.kind}\`, not as a container holding an icon named ` +
          '`portrait`. Vanilla declares BOTH: a containerWindowType named portrait with an iconType named portrait ' +
          'inside it (interface/diplomacy_caravaneer_event_view.gui:145-152).',
        suggestedFix: 'make `portrait` a containerWindowType with an `iconType { name = "portrait" }` inside it.',
      });
    }
  }

  // ---- close is the LAST direct child.
  const children = directChildren(window);
  const closeIndex = children.findIndex((child) => child.name === 'close');
  if (closeIndex >= 0 && closeIndex !== children.length - 1) {
    const above = children.slice(closeIndex + 1).map((child) => child.name);
    const closeBox = boxByNode.get(children[closeIndex]);
    const overlay = children
      .slice(closeIndex + 1)
      .map((child) => ({ child, box: boxByNode.get(child) }))
      .filter((entry) => entry.box && closeBox && intersects(entry.box.rect, closeBox.rect));
    push({
      rule: 'custom-gui-close-not-last',
      severity: 'error',
      where: whereOf(children[closeIndex], windowWhere),
      path: `${windowName}/close`,
      kind: children[closeIndex].kind ?? null,
      rect: closeBox ? rectOf(closeBox) : undefined,
      message:
        `\`close\` is direct child #${closeIndex + 1} of ${children.length}, so ${children.length - closeIndex - 1} ` +
        `later sibling(s) draw over it: ${above.join(', ')}. ` +
        (overlay.length > 0
          ? `${overlay.map((entry) => entry.child.name).join(', ')} overlap(s) the close rect, which is how a close ` +
            'button becomes invisible or unclickable.'
          : 'None of them overlaps the close rect right now, but draw order is the engine\'s only z-order.'),
      suggestedFix: 'move the `close` element to the END of the window\'s direct children.',
      rects: overlay.map((entry) => ({ name: entry.child.name, rect: rectOf(entry.box) })),
      coveredBy: overlay.map((entry) => entry.child.name),
    });
  }

  return findings;
}

/** Exact rect intersection (shared edges do not count). */
function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Analyse every event window in a layout.
 *
 * @param {object} layout
 * @param {object[]} boxes `computeLayout(layout).boxes`
 * @param {{customGuiWindows?: string[], checkAllWindows?: boolean, baseResolution?: object,
 *          sourceIsInstall?: boolean}} options
 * @returns {object[]} one entry per event window: {name, explicit, sourceLine, findings, box, base}
 */
export function analyseEventWindows(layout, boxes, options = {}) {
  const base = options.baseResolution ?? layout?.baseResolution ?? { width: 1920, height: 1080 };
  const boxByNode = new Map();
  for (const box of boxes ?? []) if (box.node) boxByNode.set(box.node, box);
  const windows = layout?.root?.syntheticRoot ? layout.root.children ?? [] : layout?.root ? [layout.root] : [];
  const named = new Set(options.customGuiWindows ?? []);
  const out = [];
  for (const window of windows) {
    // `containerWindowType` and `windowType` are the two kinds that can be a custom_gui window.
    if (!window || !['container', 'window'].includes(window.kind ?? 'container')) continue;
    if (!isEventWindow(window, options)) continue;
    // `explicit` is what decides error vs warning: an event names this window, so a missing name is
    // a crash the mod can cause - as opposed to a shipped vanilla file this tool merely inspected.
    const explicit = Boolean(window.name && named.has(window.name)) && options.sourceIsInstall !== true;
    const findings = analyseWindow(window, boxByNode, { explicit });
    out.push({
      node: window,
      name: window.name ?? '(unnamed)',
      explicit,
      sourceLine: window.sourceLine ?? null,
      where: whereOf(window, window.name ?? '(unnamed)'),
      findings,
      box: boxByNode.get(window) ?? null,
      base,
    });
  }
  return out;
}

/**
 * Is this element parked - positioned where it can never be seen or clicked?
 *
 * The idiom is `position = { x = -3000 y = -3000 }` (often with `size = { x = 0 y = 0 }`): the
 * element exists so the engine's name lookup finds it, and nothing is drawn. The test is relative to
 * the WINDOW the element lives in, not to the screen: a window parked at the screen edge, or one of
 * its panels hanging a few pixels over the edge, is a layout question the geometry validator already
 * reports as `out-of-bounds`. "Parked" means "cannot be part of the window that contains it".
 *
 * An element with no area at all counts as parked too: `0x0` can neither be seen nor clicked, and
 * that is what an unsized icon reports.
 *
 * @param {object} box
 * @param {{x:number,y:number,width:number,height:number}} frame the window's own rect
 * @param {{slack?: number}} options `slack` (default 256 px) keeps a panel that legitimately
 *        overhangs its window from being called parked.
 */
export function isParked(box, frame, options = {}) {
  if (!box) return false;
  const rect = box.rect;
  if (!(rect.width > 0) || !(rect.height > 0)) return true;
  const slack = options.slack ?? 256;
  const area = { x: frame.x - slack, y: frame.y - slack, width: frame.width + 2 * slack, height: frame.height + 2 * slack };
  return !intersects(rect, area);
}

/**
 * The PARKED-ELEMENT checks.
 *
 * A parked element keeps its bindings. Measured on the trial mod: an element parked off-canvas that
 * still carried `shortcut = ESCAPE` was the only ESCAPE binding in its window, so ESC pressed a
 * button three thousand pixels off-screen and the visible close had no binding at all. The same
 * parking on a CONTROL with a non-zero size keeps a live, invisible hit region.
 *
 * Only CONTROLS can hold a hit region or a binding, so only controls are reported for those two:
 * a parked `heading` or `alien_message` is a text element, it is not clickable, and saying otherwise
 * would bury the findings that matter (measured: 72 `parked-element-hit-region` warnings, of which
 * 60 were text/icons that cannot be clicked).
 *
 * @param {object} layout
 * @param {object[]} boxes `computeLayout(layout).boxes`
 * @param {{baseResolution?: object, slack?: number, windowBoxes?: object[], sourceIsInstall?: boolean}} options
 * @returns {object[]} findings
 */
export function checkParkedElements(layout, boxes, options = {}) {
  const base = options.baseResolution ?? layout?.baseResolution ?? { width: 1920, height: 1080 };
  const parkedOptions = { slack: options.slack ?? 256 };
  const windows = options.windowBoxes ?? windowBoxesOf(layout, boxes);
  // Which frame each element is judged against: the window it belongs to. A layout with a single
  // container as its root has one window, which is the same rectangle the geometry validator uses.
  const baseFrame = { x: 0, y: 0, width: base.width, height: base.height };
  const frameFor = (box) => {
    for (const entry of windows) {
      if (box.boxIndex >= entry.fromIndex && box.boxIndex <= entry.toIndex) return entry.box;
    }
    return baseFrame;
  };

  // The names of controls that are LIVE (on-screen, in the same frame), for the duplicate check.
  const liveControlsByName = new Map();
  for (const box of boxes ?? []) {
    if (!CONTROL_KINDS.has(box.kind) || !box.name) continue;
    if (isParked(box, frameFor(box), parkedOptions)) continue;
    const list = liveControlsByName.get(box.name) ?? [];
    list.push(box);
    liveControlsByName.set(box.name, list);
  }

  const findings = [];
  for (const box of boxes ?? []) {
    if (!box.node || box.syntheticRoot) continue;
    const frame = frameFor(box);
    if (!isParked(box, frame, parkedOptions)) continue;
    const rect = rectOf(box);
    const where = whereOf(box.node, box.path);
    const shortcutField = SHORTCUT_FIELDS.find((field) => box.node[field] !== undefined && box.node[field] !== null);
    if (shortcutField) {
      findings.push({
        rule: 'parked-element-shortcut',
        severity: 'warning',
        where,
        path: box.path,
        element: box.name,
        kind: box.kind,
        rect,
        message:
          `\`${box.name}\` is parked outside its window (${rect.x},${rect.y} ${rect.width}x${rect.height}, window ` +
          `${Math.round(frame.x)},${Math.round(frame.y)} ${Math.round(frame.width)}x${Math.round(frame.height)}) ` +
          `but still claims \`${shortcutField} = ${box.node[shortcutField]}\`. Parking removes the pixels, not the ` +
          'binding: the engine still binds the key to this element, so a parked duplicate of a control that also ' +
          'carries the window\'s only shortcut means the key presses the invisible copy and the visible control has no ' +
          'binding. This is measured, not theoretical - it is exactly what shipped in the trial mod.',
        suggestedFix: `delete the \`${shortcutField}\` line from the parked element, or delete the parked element.`,
        field: shortcutField,
      });
    }
    if (CONTROL_KINDS.has(box.kind) && rect.width > 0 && rect.height > 0) {
      findings.push({
        rule: 'parked-element-hit-region',
        severity: 'warning',
        where,
        path: box.path,
        element: box.name,
        kind: box.kind,
        rect,
        message:
          `\`${box.name}\` is parked outside its window but keeps a ${rect.width}x${rect.height} hit area, so it is a ` +
          'click target that nothing on screen shows. Off-screen is not the same as inert: any part of it that comes ' +
          'back on screen - a window that moves or scales, a panel that grows - is an invisible button. The idiom the ' +
          'working file uses is `size = { x = 0 y = 0 }`.',
        suggestedFix: 'set `size = { x = 0 y = 0 }` (button/list) or `size = { width = 0 height = 0 }` (container) on the parked control.',
      });
    }
    if (box.name && liveControlsByName.has(box.name)) {
      const live = liveControlsByName.get(box.name)[0];
      findings.push({
        rule: 'parked-duplicate-of-live-control',
        severity: 'info',
        where,
        path: box.path,
        element: box.name,
        kind: box.kind,
        rect,
        message:
          `\`${box.name}\` is parked, and a LIVE \`${live.kind}\` with the SAME name is on screen elsewhere in this ` +
          `file (${live.path}). The engine resolves an element name inside a window to whichever it reaches first, so a ` +
          'duplicated control name is ambiguous even when one copy is invisible - and a duplicate `close` is exactly ' +
          'the defect that made the trial mod\'s main window impossible to close.',
        suggestedFix: 'rename the parked copy (e.g. `close_parked`) so only one live control owns the name.',
      });
    }
  }
  return findings;
}

/**
 * The top-level windows of a layout, with the box-index range each one covers.
 *
 * `computeLayout` walks the tree depth-first, in document order, so a window's subtree is a
 * CONTIGUOUS range of box indices. That is what makes "which window does this element belong to" a
 * range test rather than a walk.
 */
export function windowBoxesOf(layout, boxes) {
  const roots = layout?.root?.syntheticRoot ? layout.root.children ?? [] : layout?.root ? [layout.root] : [];
  const windows = [];
  for (const node of roots) {
    const first = (boxes ?? []).find((box) => box.node === node);
    if (!first) continue;
    let last = first;
    for (const box of boxes ?? []) {
      if (box.boxIndex < first.boxIndex) continue;
      // The subtree ends at the next node at the same depth or shallower.
      if (box.depth <= first.depth && box !== first) break;
      last = box;
    }
    windows.push({ node, name: node.name ?? null, fromIndex: first.boxIndex, toIndex: last.boxIndex, box: first.rect });
  }
  return windows;
}

export default {
  CONTRACT_ELEMENTS,
  REQUIRED_WINDOW_NAMES,
  NOTE_WINDOW_NAMES,
  CONTRACT_MIN_WINDOWS,
  CONTRACT_SEVERITY,
  CONTRACT_DESCRIPTIONS,
  SHORTCUT_FIELDS,
  analyseEventWindows,
  checkParkedElements,
  demandedContractNames,
  isEventWindow,
  isParked,
  windowBoxesOf,
};
