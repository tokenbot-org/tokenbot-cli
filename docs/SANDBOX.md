# Sandboxed test runner

`npm test` runs this repo's suite on your Mac, as you, with your home directory
attached. A malicious dependency — a postinstall hook, or a transitive package
that runs code at import time — can read `~/.aws/credentials`,
`~/.ssh/id_ed25519`, `~/.npmrc` and `~/.claude/`, and post them anywhere.

`npm run test:sandbox` runs the same suite inside a container that has this repo
and nothing else.

```bash
npm run test:sandbox     # the suite, isolated
scripts/sandbox.sh prove    # prove the isolation rather than trust this document
```

## What actually protects you

Two properties, and `scripts/sandbox.sh prove` demonstrates both instead of
asserting them.

**1. The host filesystem is not mounted.** Only this repo. No home directory, no
sibling repos, no `/var/run/docker.sock` — mounting the Docker socket is a
one-line full-host escape, and is why "it runs in Docker" is not by itself
isolation. Non-root as your own UID, `--cap-drop ALL`, `no-new-privileges`, pids
and memory limits.

**2. Network access and third-party execution never overlap.**

| phase | network | third-party code runs? |
|---|---|---|
| `deps` | **on** | no — `npm ci --ignore-scripts`, so not one install hook executes |
| `test` | **off** (`--network none`) | yes |

A dependency gets to be downloaded, or it gets to run. Never both. Installing
and executing under one network grant is the shape of a supply-chain compromise.

## This is a convention, not an enforced guarantee

**Nothing stops anyone — including an agent session — from typing `npm test`
and running the same code on the host.** This repo makes the isolated path easy
and documented; it does not make the unisolated path impossible.

Closing that gap needs a `PreToolUse` hook that intercepts test commands before
they execute. That was deliberately left out of scope. Until such a hook exists,
treat this as a tool you have to choose, and assume the host path will sometimes
get used.

## Commands

| command | what it does |
|---|---|
| `npm run test:sandbox` | install deps if stale, then run the suite offline |
| `scripts/sandbox.sh prove` | attempt every read the sandbox prevents; non-zero on any leak |
| `scripts/sandbox.sh run <cmd>` | run any command offline in the same jail |
| `scripts/sandbox.sh deps` | force a dependency reinstall — the one online phase |
| `scripts/sandbox.sh shell` | interactive shell, offline |
| `scripts/sandbox.sh doctor` | prerequisites, staleness, and the escape hatch |
| `scripts/sandbox.sh clean` | drop the image and the dependency volume |

## The escape hatch

`npm test` is unchanged and still works. If Docker is down, or the sandbox is in
your way, use it — a developer who cannot run tests is worse off than one
running them unisolated. `scripts/sandbox.sh doctor` prints the host command on
every failure path for exactly this reason.

## Speed

Measured on this machine (Apple Silicon, Docker Desktop 24.0.2, 5 CPU / 8 GB VM),
an otherwise idle host, warm caches:

| | wall | result |
|---|---|---|
| `npm test` on the host | **11s** | 161 passed |
| `npm run test:sandbox`, warm | **10s** | 161 passed |

At parity, and marginally faster — the Linux container's filesystem beats macOS
for the many small reads a Node suite does.

Dependencies live in a named Docker volume keyed by a hash of `package.json`,
`package-lock.json`, `.npmrc` and the two Dockerfile files. They are reinstalled
only when one of those changes, so the common case never touches the network.

## How it is put together

- `Dockerfile.sandbox` — the runner image. Carries dependencies and **no
  application source**; source is bind-mounted read-only at run time, so editing
  a file never invalidates a layer.
- `scripts/sandbox.sh` — the driver. **Byte-identical across TokenBot repos.**
- `scripts/sandbox-prove.sh` — the adversarial proof. **Byte-identical across
  TokenBot repos.**
- `scripts/sandbox.conf` — the only file that differs between repos.

Shared-file checksums, so drift between repos is caught rather than discovered:

```
146f7ddb528826dc54bbd8c9f0b748923b98f470bcbb215b45669670ad02827e  scripts/sandbox.sh
4e7c5c2a03970608a6d813a06fc36a05b84f4e2a65945b0b01701d62b18ab2ad  scripts/sandbox-prove.sh
```

### The GitHub Packages token

`@tokenbot-org/cli-core`, `@tokenbot-org/data-models` and `@tokenbot-org/sdk` come from GitHub Packages, so the dependency install needs a token. It
reaches the build as a **BuildKit secret** — a tmpfs file mounted for a single
`RUN`, never written to a layer. It is never a `--build-arg` and never an `ENV`;
both of those survive in the finished image and come back out of
`docker history` / `docker inspect`. A token passed that way is a token you have
published.

`Dockerfile.sandbox` asserts this after the install and **fails the build** if a
token reached a layer or the image environment, so a future edit cannot quietly
reintroduce it.

The host `~/.npmrc` is **not** mounted into the test container. The container
carries its own `@tokenbot-org` scope pin, so packages resolve to GitHub
Packages exactly as they do on your machine, without the credential coming
along. That pin is load-bearing: `~/.npmrc` sets it globally and beats
`--registry` on the command line.

## Troubleshooting

**`ENOENT: no such file or directory, mkdir '/node_modules/.something'`**
A tool wants a cache directory inside the read-only dependency tree. Docker
cannot create a mountpoint under a read-only mount, so the directory has to
exist in the image first. Add it to *both* `SANDBOX_SCRATCH_DIRS` in
`scripts/sandbox.conf` and the `mkdir -p` in `Dockerfile.sandbox`, then
`scripts/sandbox.sh deps`.

**A test that passes on the host fails in the sandbox.**
Usually it reached something real — the network, a local database, a file in
your home directory. That is the sandbox working. Decide whether the test should
be marked as an integration test rather than whether to weaken the sandbox.

**Git-dependent tests fail, and you are in a `git worktree`.**
In a linked worktree `.git` is a *file* pointing at a gitdir outside the mount,
which is deliberately unreachable. Git works normally in an ordinary clone (the
runner sets `safe.directory=/work`). Run from a normal checkout, or run those
tests on the host.

**`docker daemon not running`**
Start Docker Desktop, or use `npm test`.

## What is deliberately not covered

- Agent tooling. `gh`, `aws`, `git` and `grep` keep running on the host. Jailing
  those is a different job with different trade-offs.
- GitHub Actions. CI already runs on ephemeral isolated runners; that problem is
  solved and `.github/workflows/` is untouched.
