# Contributing

## Read this first: pull requests from forks cannot pass CI

This repository is public, but the CLI builds against three **private** packages published to GitHub Packages:

- `@tokenbot-org/cli-core`
- `@tokenbot-org/sdk`
- `@tokenbot-org/data-models`

GitHub deliberately withholds secrets from workflows triggered by fork pull requests. Without a credential for `npm.pkg.github.com`, `npm ci` fails — so **every** required check (`lint`, `typecheck`, `test`, `build`, `Supply-chain marker scan`) goes red on a fork PR. It is not one optional check you can ignore; nothing installs, so nothing runs.

This is a known consequence of publishing the CLI source while its build dependencies stay private. We are telling you up front rather than letting you discover it from five red checks.

**What this means in practice:**

- Issues and discussions are genuinely welcome — bug reports, reproductions, and feature requests are useful without any build.
- Small, self-evident patches (typos, docs, an obviously-correct fix) are welcome too; a maintainer will re-run them from a branch in this repo so CI can actually execute.
- If you want to work on something substantial, open an issue first so we can sort out the build access question before you spend time on it.

Do not try to route around this with `pull_request_target`. That trigger runs fork-authored code with a privileged token and access to secrets, which is a well-known way to hand repository write access to a stranger.

## Building locally (maintainers, or anyone with package read access)

You need a GitHub token with the `read:packages` scope, because of the private dependencies above.

Put the credential in your **user-level** `~/.npmrc`, not in the repo:

```
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
```

The repository's committed `.npmrc` maps only the `@tokenbot-org` scope to GitHub Packages. It deliberately contains **no** auth line — a committed `_authToken=${SOME_VAR}` would override your working global credential with an empty string whenever that variable is unset, turning a working install into a confusing 401.

Then:

```bash
npm ci
npm run build      # esbuild bundle -> dist/cli.js
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

Run the built CLI directly with `node dist/cli.js --help`.

## How the bundle works, and the one trap in it

`scripts/build.mjs` bundles with esbuild. The three `@tokenbot-org/*` packages are **inlined** into `dist/cli.js` — they are not on public npm, so a published tarball that required them would 404 for every user. Everything else (`ccxt`, `commander`, `zod`, …) is marked **external** and resolves from the published `dependencies` at install time.

That `external:` list is maintained by hand. If you add an import that should not be bundled, add it to **both** the list in `scripts/build.mjs` and `dependencies` in `package.json`. CI enforces the second half: the `build` job fails if the bundle requires a package that is not a declared dependency, because the alternative is an end user hitting `MODULE_NOT_FOUND` after `npm install -g tokenbot`.

## Conventions

- **Commits**: Conventional Commits — `<type>(<scope>): <description>`, subject under 72 chars. Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`, `ci`.
- **Branches**: `<type>/<short-description>`, branched from `develop`.
- **Files**: `kebab-case.ts`. **Variables/functions**: `camelCase`. **Types**: `PascalCase`, no `I` prefix.
- **TypeScript**: strict mode. No `any` unless genuinely unavoidable, and comment why.
- **Logging**: never `console.log` in command code — use the helpers in `src/util/output.ts` so `--json` output stays machine-readable.

## Security

Do not open a public issue for a security problem. See [SECURITY.md](SECURITY.md).
