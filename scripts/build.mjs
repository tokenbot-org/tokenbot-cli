#!/usr/bin/env node
// Bundle the tokenbot CLI into a single self-contained dist/cli.js.
//
// Why: the published `tokenbot` package goes to public npm, but its workspace
// deps (@tokenbot-org/cli-core, @tokenbot-org/sdk, @tokenbot-org/data-models)
// only live on GitHub Packages. Without bundling, `npm install -g tokenbot`
// from a fresh machine hits 404 trying to resolve those scoped deps.
//
// Approach: esbuild bundles `src/cli.ts` + the three `@tokenbot-org/*`
// workspace packages (cli-core, sdk, data-models) into one CJS file with a
// #!/usr/bin/env node shebang. Public-npm deps (ccxt, commander, chalk,
// graphql-ws, the @noble/* crypto stack, nacl, cli-table3, asciichart,
// @inquirer/prompts, date-fns, zod, tslib) are marked external — they
// resolve at npm install time from the published `dependencies` block. This
// avoids bundling ccxt (whose deep static dependencies trip esbuild's resolver)
// while still solving the "scoped GitHub Packages deps 404 on public npm" problem
// that motivated the bundling work.
//
// Run via `pnpm run build` (package.json wires this to `node scripts/build.mjs`).

import * as esbuild from 'esbuild';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const outFile = resolve(pkgRoot, 'dist', 'cli.js');

await rm(resolve(pkgRoot, 'dist'), { recursive: true, force: true });
await mkdir(resolve(pkgRoot, 'dist'), { recursive: true });

const result = await esbuild.build({
  entryPoints: [resolve(pkgRoot, 'src', 'cli.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: outFile,
  // The source `cli.ts` already has `#!/usr/bin/env node` on line 1. esbuild
  // preserves that as a top-of-bundle comment in `format: 'cjs'` mode, so we
  // do NOT add a `banner` — that would produce a duplicate shebang and break
  // node's `Invalid or unexpected token` parser.
  legalComments: 'none',
  // External: every public-npm runtime dep across cli-core/sdk/data-models/
  // tokenbot-cli source. The published `dependencies` block must list these
  // (kept in sync manually — if a new dep lands in any workspace package, add
  // it both here and in package.json `dependencies`). NOT external: the three
  // `@tokenbot-org/*` workspace packages — those get inlined because they
  // don't exist on public npm.
  external: [
    '@inquirer/prompts',
    '@noble/hashes',
    '@noble/secp256k1',
    'asciichart',
    'ccxt',
    'chalk',
    'cli-table3',
    'commander',
    'date-fns',
    'graphql',
    'graphql-ws',
    'tslib',
    'tweetnacl',
    'tweetnacl-util',
    'zod',
  ],
  // Minify produces ~30-40% smaller bundle and obscures internal stack traces
  // less than you'd think (paths still come from source files). Worth it.
  minify: true,
  // Keep names so error messages reference real class/function names instead
  // of `t.prototype.run` style minified gibberish.
  keepNames: true,
  // Sourcemap inlined so node --enable-source-maps shows real positions.
  // Disabled by default to keep tarball small — toggle via SOURCEMAP=1 env.
  sourcemap: process.env.SOURCEMAP === '1' ? 'inline' : false,
  logLevel: 'info',
  metafile: true,
});

await chmod(outFile, 0o755);

// Print bundle size + top contributors for sanity.
const size = result.metafile.outputs[`dist/cli.js`]?.bytes ?? 0;
const mb = (size / 1024 / 1024).toFixed(2);
console.log(`\n✓ Bundled dist/cli.js — ${mb} MB`);

// Top 10 biggest inputs by size (helps spot the next bloat culprit).
const inputs = Object.entries(result.metafile.outputs['dist/cli.js']?.inputs ?? {})
  .map(([path, info]) => ({ path, bytes: info.bytesInOutput }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 10);

console.log('\nTop 10 contributors:');
for (const { path, bytes } of inputs) {
  console.log(`  ${(bytes / 1024).toFixed(1).padStart(8)} KB  ${path}`);
}
