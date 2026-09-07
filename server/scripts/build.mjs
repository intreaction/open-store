#!/usr/bin/env node
// Bundles the server into one file and copies it into the Claude Code plugin.
import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '..');
const outfile = resolve(serverRoot, 'dist/openstore.mjs');
const pluginCopy = resolve(serverRoot, '../plugin/server/openstore.mjs');

await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(serverRoot, 'src/stdio.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  banner: {
    // Some dependencies still reach for CommonJS globals at runtime.
    js: [
      "import { createRequire as __openstoreCreateRequire } from 'node:module';",
      "import { fileURLToPath as __openstoreFileURLToPath } from 'node:url';",
      "import { dirname as __openstoreDirname } from 'node:path';",
      'const require = __openstoreCreateRequire(import.meta.url);',
      'const __filename = __openstoreFileURLToPath(import.meta.url);',
      'const __dirname = __openstoreDirname(__filename);'
    ].join('\n')
  }
});

await mkdir(dirname(pluginCopy), { recursive: true });
await copyFile(outfile, pluginCopy);

console.log(`built ${outfile}`);
console.log(`copied ${pluginCopy}`);
