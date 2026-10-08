#!/usr/bin/env node
/**
 * Test `gui_assets_inventory` against a realistic mod.
 *
 * The claim being tested is the one that matters: a texture file that no `.gfx`
 * registers is invisible to the engine, and the tool must SAY SO rather than
 * quietly reporting a count of files. So the fixture is built to contain both
 * halves -- two files that are registered and one that is not -- and the
 * assertions are about telling them apart, not about counting.
 *
 * Real DDS files are copied out of the install so the dimensions come from a
 * genuine texture header rather than a hand-written stub.
 *
 * Run: node scripts/selftest-asset-inventory.mjs
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const GAME = process.env.STELLARIS_GAME_ROOT ?? 'E:\\Stellaris';

let passed = 0;
let failed = 0;
const ok = (label, condition, detail = '') => {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail ? `  -- ${detail}` : ''}`); }
};

/** Call a tool through the CLI, which is the same registry the MCP server serves. */
function callTool(name, args) {
  const argFile = join(tmpdir(), `rh4g-args-${process.pid}-${name}.json`);
  writeFileSync(argFile, JSON.stringify(args), 'utf8');
  try {
    const out = execFileSync(process.execPath, [join(PROJECT, 'src', 'index.mjs'), '--skill', 'call-tool', name, '--json-file', argFile], {
      encoding: 'utf8', cwd: PROJECT, maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = JSON.parse(out);
    // A tool that returns MCP content blocks wraps its payload; unwrap the text.
    if (parsed.content) {
      const text = parsed.content.find((b) => b.type === 'text');
      return JSON.parse(text.text);
    }
    return parsed;
  } finally {
    rmSync(argFile, { force: true });
  }
}

if (!existsSync(join(GAME, 'interface'))) {
  console.error(`No Stellaris install at ${GAME}. Set STELLARIS_GAME_ROOT.`);
  process.exit(2);
}

// Pick a few small DDS files out of the install to copy in.
function pickSources(count) {
  const roots = [join(GAME, 'gfx', 'interface'), join(GAME, 'gfx', 'interface', 'tiles')];
  const picked = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.dds')) continue;
      const full = join(root, entry.name);
      const size = statSync(full).size;
      if (size < 1024 || size > 200_000) continue;
      picked.push(full);
      if (picked.length >= count) return picked;
    }
  }
  return picked;
}

const sources = pickSources(3);
if (sources.length < 3) {
  console.error(`Could not find 3 small .dds files under ${GAME}\\gfx\\interface`);
  process.exit(2);
}

const mod = mkdtempSync(join(tmpdir(), 'rh4g-asset-mod-'));
const imageDir = join(mod, 'gfx', 'interface', 'mymod');
const interfaceDir = join(mod, 'interface');
mkdirSync(imageDir, { recursive: true });
mkdirSync(interfaceDir, { recursive: true });

const names = ['registered_one', 'registered_two', 'orphan_three'];
sources.forEach((src, i) => copyFileSync(src, join(imageDir, `${names[i]}.dds`)));
writeFileSync(join(mod, 'descriptor.mod'), 'name="Asset Inventory Test"\nversion="0.1"\n', 'utf8');

// Register only the first two. The third is the case that fails silently in game.
const gfx = [
  'spriteTypes = {',
  ...names.slice(0, 2).flatMap((n) => [
    '\tspriteType = {',
    `\t\tname = "GFX_test_${n}"`,
    `\t\ttextureFile = "gfx/interface/mymod/${n}.dds"`,
    '\t}',
  ]),
  '}',
  '',
].join('\n');
writeFileSync(join(interfaceDir, 'mymod.gfx'), gfx, 'utf8');

console.log(`fixture: ${mod}`);
console.log(`  ${names.length} images, 2 registered in interface/mymod.gfx, 1 deliberately not\n`);

const base = { game_root: GAME, extra_roots: [mod], dirs: [mod] };

console.log('--- 1. the inventory separates registered from unregistered ---');
const all = callTool('gui_assets_inventory', { ...base, suggest: true });
ok('scanned 3 files', all.stats.filesScanned === 3, `got ${all.stats.filesScanned}`);
ok('2 registered', all.stats.registered === 2, `got ${all.stats.registered}`);
ok('1 unregistered', all.stats.unregistered === 1, `got ${all.stats.unregistered}`);
ok('nothing unreadable', all.stats.unreadable === 0, `got ${all.stats.unreadable}`);
ok('modRoot detected as the mod', String(all.modRoot).toLowerCase() === mod.toLowerCase(), all.modRoot);

console.log('\n--- 2. dimensions come from the file header, not the .gfx ---');
const withSize = all.assets.filter((a) => a.registered);
ok('both registered files have real width/height', withSize.length === 2 && withSize.every((a) => a.width > 0 && a.height > 0));
ok('format reported', withSize.every((a) => typeof a.format === 'string' && a.format.length > 0), JSON.stringify(withSize.map((a) => a.format)));
const srcSize = statSync(sources[0]).size;
ok('byte size matches the source file', all.assets.some((a) => a.bytes === srcSize), `expected one at ${srcSize}`);

console.log('\n--- 3. the registered files name the sprites that use them ---');
const reg = all.assets.find((a) => a.rel.endsWith('registered_one.dds'));
ok('registered_one is registered', reg?.registered === true);
ok('registered_one names GFX_test_registered_one', (reg?.sprites ?? []).some((s) => s.name === 'GFX_test_registered_one'), JSON.stringify(reg?.sprites));
ok('relative path is mod-relative', reg?.rel === 'gfx/interface/mymod/registered_one.dds', reg?.rel);

console.log('\n--- 4. the ORPHAN is named, with a fix ---');
const orphan = all.assets.find((a) => a.rel.endsWith('orphan_three.dds'));
ok('orphan_three is NOT registered', orphan?.registered === false);
ok('orphan has no sprites', (orphan?.sprites ?? []).length === 0);
ok('one suggestion emitted', (all.suggestions ?? []).length === 1, `got ${(all.suggestions ?? []).length}`);
const suggestion = (all.suggestions ?? [])[0];
ok('suggestion targets the orphan', suggestion?.relativePath === 'gfx/interface/mymod/orphan_three.dds', suggestion?.relativePath);
ok('suggestion name follows the convention', suggestion?.spriteName === 'GFX_orphan_three', suggestion?.spriteName);
ok('suggestion block carries the textureFile', (suggestion?.block ?? '').includes('gfx/interface/mymod/orphan_three.dds'));
ok('a new-file wrapper is provided', (suggestion?.forNewFile ?? '').startsWith('spriteTypes = {'));

console.log('\n--- 5. the filter narrows without changing the stats ---');
const onlyOrphans = callTool('gui_assets_inventory', { ...base, filter: 'unregistered' });
ok('filter returns 1 asset', onlyOrphans.assets.length === 1, `got ${onlyOrphans.assets.length}`);
ok('filter keeps the full stats', onlyOrphans.stats.filesScanned === 3 && onlyOrphans.stats.registered === 2);
const onlyReg = callTool('gui_assets_inventory', { ...base, filter: 'registered' });
ok('registered filter returns 2', onlyReg.assets.length === 2, `got ${onlyReg.assets.length}`);

console.log('\n--- 6. without the mod root the same files read as unregistered ---');
// This is the failure the tool exists to expose, so it must be reproducible: with
// no extra_roots the mod's .gfx is not indexed at all.
const noRoot = callTool('gui_assets_inventory', { game_root: GAME, dirs: [mod] });
ok('all 3 read as unregistered', noRoot.stats.unregistered === 3, `got ${noRoot.stats.unregistered}`);
ok('a warning explains why', typeof noRoot.warning === 'string' && noRoot.warning.length > 0, String(noRoot.warning));
ok('the note scopes the claim to .gfx', typeof noRoot.note === 'string' && noRoot.note.includes('.gfx'));

console.log('\n--- 7. a directory that is not a mod is refused, not guessed ---');
const unrelated = mkdtempSync(join(tmpdir(), 'rh4g-not-a-mod-'));
mkdirSync(join(unrelated, 'pictures'), { recursive: true });
writeFileSync(join(unrelated, 'pictures', 'x.dds'), Buffer.from('not really a dds'), 'utf8');
const notMod = callTool('gui_assets_inventory', { game_root: GAME, dirs: [unrelated] });
ok('unreadable file is reported, not skipped', notMod.stats.unreadable === 1, `got ${notMod.stats.unreadable}`);
ok('unreadable file is not offered a suggestion', (notMod.suggestions ?? []).length === 0, JSON.stringify(notMod.suggestions ?? []));
ok('the reason is given', typeof notMod.assets[0]?.unreadableReason === 'string' && notMod.assets[0].unreadableReason.length > 0, String(notMod.assets[0]?.unreadableReason));

rmSync(mod, { recursive: true, force: true });
rmSync(unrelated, { recursive: true, force: true });

console.log(`\n${'='.repeat(72)}`);
console.log(`passed ${passed}, failed ${failed}`);
process.exit(failed === 0 ? 0 : 1);
