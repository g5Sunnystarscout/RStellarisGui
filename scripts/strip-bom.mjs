// Strip a UTF-8 BOM from a file, in place. The project rule is BOM-less .mjs / .html.
import { readFileSync, writeFileSync } from 'node:fs';

for (const path of process.argv.slice(2)) {
  const text = readFileSync(path, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    writeFileSync(path, text.slice(1), 'utf8');
    process.stdout.write(`stripped BOM: ${path}\n`);
  } else {
    process.stdout.write(`no BOM: ${path}\n`);
  }
}
