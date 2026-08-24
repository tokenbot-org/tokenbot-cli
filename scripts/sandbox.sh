#!/usr/bin/env bash
#
# sandbox.sh — run this repo's tests and builds inside a Docker container that
# cannot see the host filesystem.
#
# THIS FILE IS SHARED VERBATIM ACROSS TOKENBOT REPOS. Everything repo-specific
# belongs in scripts/sandbox.conf. docs/SANDBOX.md records the checksum so drift
# between copies is caught rather than discovered.
#
# The threat model is a malicious dependency — a postinstall hook, or a
# transitive package that runs at import time — reading ~/.aws/credentials,
# ~/.ssh, ~/.npmrc or ~/.claude and posting them somewhere. Two properties block
# that, and `sandbox.sh prove` demonstrates both rather than asserting them:
#
#   1. Only this repo is mounted. No home directory, no sibling repos, no
#      /var/run/docker.sock. There is no path from inside to $HOME.
#   2. Network access and third-party execution never overlap:
#        deps phase  network ON,  --ignore-scripts — no third-party code runs.
#        test phase  network OFF (--network none)  — third-party code runs.
#      A dependency gets to be fetched, or it gets to run. Never both.
#
# THIS IS A CONVENTION, NOT AN ENFORCED GUARANTEE. Nothing stops anyone from
# typing `npm test` and running the same code on the host. Closing that would
# take a PreToolUse hook, which is deliberately out of scope. See docs/SANDBOX.md.
#
# Usage:
#   scripts/sandbox.sh test [args...]   install deps if stale, then run the suite offline
#   scripts/sandbox.sh run  <cmd...>    run an arbitrary command offline
#   scripts/sandbox.sh deps             (re)install dependencies — the one online phase
#   scripts/sandbox.sh prove            adversarial proof that the host is unreachable
#   scripts/sandbox.sh shell            interactive shell, offline
#   scripts/sandbox.sh clean            remove this repo's sandbox image and volume
#   scripts/sandbox.sh doctor           check prerequisites, print the escape hatch

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="${REPO_ROOT}/scripts/sandbox.conf"

[ -f "$CONF" ] || { echo "sandbox: missing $CONF" >&2; exit 2; }
# shellcheck disable=SC1090
. "$CONF"

: "${SANDBOX_NAME:?sandbox.conf must set SANDBOX_NAME}"
: "${SANDBOX_DEFAULT_CMD:?sandbox.conf must set SANDBOX_DEFAULT_CMD}"
: "${SANDBOX_DEPS_DIR:?sandbox.conf must set SANDBOX_DEPS_DIR}"
: "${SANDBOX_MOUNT_DEPS_AT:?sandbox.conf must set SANDBOX_MOUNT_DEPS_AT}"
: "${SANDBOX_LOCKFILES:?sandbox.conf must set SANDBOX_LOCKFILES}"

IMAGE="tokenbot-sandbox/${SANDBOX_NAME}:latest"
DEPS_VOL="tokenbot-sandbox-${SANDBOX_NAME}-deps"
DOCKERFILE="${SANDBOX_DOCKERFILE:-Dockerfile.sandbox}"
OUT_DIR="${REPO_ROOT}/.sandbox-out"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

say()  { printf '\033[36m▸ %s\033[0m\n' "$*" >&2; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null 2>&1 \
    || die "docker not installed. Escape hatch: ${SANDBOX_HOST_CMD:?}"
  docker info >/dev/null 2>&1 \
    || die "docker daemon not running. Escape hatch: ${SANDBOX_HOST_CMD:?}"
}

# Fingerprint of everything that decides what gets installed. A file missing
# from SANDBOX_LOCKFILES means a stale dependency tree is reused in silence,
# which is worse than a slow rebuild.
lock_hash() {
  local f
  for f in $SANDBOX_LOCKFILES; do
    [ -f "${REPO_ROOT}/${f}" ] && cat "${REPO_ROOT}/${f}"
  done | shasum -a 256 | cut -d' ' -f1
}

build_image() {
  require_docker
  say "building sandbox image ${IMAGE}"
  local secret_args=()
  if [ "${SANDBOX_SECRET_NPMRC:-0}" = "1" ]; then
    # The registry token reaches the build as a BuildKit secret: a tmpfs file
    # mounted for a single RUN, never written to a layer. It is NEVER a
    # --build-arg and NEVER an ENV — both of those are recoverable from the
    # finished image with `docker history` / `docker inspect`.
    #
    # This script never reads the token value into a variable. It hands BuildKit
    # a path and lets BuildKit do the reading.
    if [ -n "${NODE_AUTH_TOKEN:-}" ]; then
      secret_args=(--secret "id=npmrc,env=NODE_AUTH_TOKEN")
    elif [ -f "${HOME}/.npmrc" ]; then
      secret_args=(--secret "id=npmrc,src=${HOME}/.npmrc")
    else
      die "need a GitHub Packages token: set NODE_AUTH_TOKEN, or keep ~/.npmrc"
    fi
  fi
  DOCKER_BUILDKIT=1 docker build \
    -f "${REPO_ROOT}/${DOCKERFILE}" \
    -t "${IMAGE}" \
    --build-arg "HOST_UID=${HOST_UID}" \
    --build-arg "HOST_GID=${HOST_GID}" \
    ${secret_args[@]+"${secret_args[@]}"} \
    "${REPO_ROOT}"
}

# Copy the dependency tree out of the image into a named volume, offline.
# Explicit rather than relying on Docker's volume auto-seeding, which only fires
# when the volume is empty and fails quietly the rest of the time.
seed_deps() {
  say "seeding dependency volume ${DEPS_VOL}"
  docker volume create "${DEPS_VOL}" >/dev/null
  docker run --rm --network none --user 0:0 \
    -v "${DEPS_VOL}:/vol" \
    --entrypoint sh "${IMAGE}" -c \
    "find /vol -mindepth 1 -maxdepth 1 -exec rm -rf {} + \
     && cp -a ${SANDBOX_DEPS_DIR}/. /vol/ \
     && printf '%s' '$(lock_hash)' > /vol/.sandbox-lockhash \
     && chown -R ${HOST_UID}:${HOST_GID} /vol"
}

deps_stale() {
  local have
  have="$(docker run --rm --network none -v "${DEPS_VOL}:/vol:ro" \
            --entrypoint sh "${IMAGE}" -c \
            'cat /vol/.sandbox-lockhash 2>/dev/null || true' 2>/dev/null || true)"
  [ "$have" != "$(lock_hash)" ]
}

ensure_deps() {
  require_docker
  if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
    build_image; seed_deps; return
  fi
  if ! docker volume inspect "${DEPS_VOL}" >/dev/null 2>&1; then
    build_image; seed_deps; return
  fi
  if deps_stale; then
    say "dependency inputs changed — reinstalling"
    build_image; seed_deps
  fi
}

# The offline execution phase. Everything third-party runs here, and here there
# is no network and no host filesystem beyond this one repo.
#
#   --network none         no egress, no DNS, no host.docker.internal
#   /work  :ro             the source cannot be rewritten from inside
#   deps   :ro             package contents cannot be modified, so a compromised
#                          test cannot plant a payload for the next run to run
#   scratch dirs           tmpfs mounted over the toolchain's cache directories
#                          inside the read-only dependency tree — writable, and
#                          discarded when the container exits
#   SANDBOX_SOURCE_WRITABLE same, for build output inside the source tree
#                          (dist/, coverage/) that a suite needs to produce
#   SANDBOX_SETUP_CMD      runs inside the container before the suite, for a
#                          suite that needs a service on loopback. --network
#                          none still provides lo, so a database started here is
#                          reachable while the outside world is not.
#   safe.directory         git refuses to operate on a bind mount it considers
#                          foreign-owned ("dubious ownership"). Set through
#                          GIT_CONFIG_* env vars rather than a config file, so
#                          nothing has to be written into the read-only tree.
#                          NOTE: this makes git work in a normal clone. In a
#                          linked worktree, .git is a FILE pointing at a gitdir
#                          outside the mount, which by design is not reachable —
#                          git-dependent tests fail there. See docs/SANDBOX.md.
#   --cap-drop ALL         no ptrace, no mount, no raw sockets
#   no-new-privileges      setuid binaries cannot escalate
#   --pids-limit           a fork bomb in a test cannot take the host down
#   (no docker.sock)       mounting it is a one-line full-host escape
run_offline() {  # $1 = command string, run through sh -c
  mkdir -p "${OUT_DIR}"
  # Docker will not create a mountpoint underneath a read-only mount, so each of
  # these must already exist inside the dependency volume. build_image creates
  # them; SANDBOX_SCRATCH_DIRS and the Dockerfile have to agree.
  local scratch_args=() d
  for d in ${SANDBOX_SCRATCH_DIRS:-}; do
    scratch_args+=(--tmpfs "${SANDBOX_MOUNT_DEPS_AT}/${d}:rw,exec,nosuid,size=512m,uid=${HOST_UID},gid=${HOST_GID}")
  done
  # SANDBOX_ENV is a bash ARRAY in sandbox.conf, not a space-separated string:
  # values like "-p no:cacheprovider" contain spaces, and word-splitting a
  # string turns that into a plugin literally named "_no:cacheprovider".
  # Build output and coverage land INSIDE the source tree, which is mounted
  # read-only. Each path here gets a per-run tmpfs instead. Docker will not
  # create a mountpoint under a read-only mount, so the directory has to exist
  # on the host first — these are gitignored build outputs, so creating an empty
  # one is harmless, and it stays empty because the tmpfs hides it. Nothing the
  # build writes ever reaches the host.
  local srcw_args=() w
  for w in ${SANDBOX_SOURCE_WRITABLE:-}; do
    mkdir -p "${REPO_ROOT}/${w}"
    srcw_args+=(--tmpfs "/work/${w}:rw,exec,nosuid,size=512m,uid=${HOST_UID},gid=${HOST_GID}")
  done

  local env_args=() e
  for e in ${SANDBOX_ENV[@]+"${SANDBOX_ENV[@]}"}; do env_args+=(-e "$e"); done

  # Two source modes.
  #
  #   ro    (default) the repo is bind-mounted read-only at /work. Strongest,
  #         and correct for any suite that only reads its own source.
  #
  #   copy  the repo is bind-mounted read-only at /src and copied into a tmpfs
  #         /work at start. For toolchains that write into the source ROOT,
  #         where no directory-level tmpfs can help — tsup, for one, drops a
  #         `tsup.config.bundled_*.mjs` next to the config file. The copy is
  #         per-run and discarded at exit, so it is if anything STRONGER than
  #         `ro`: the container gets full write freedom and the host tree still
  #         receives nothing. It costs a copy of the working tree on every run,
  #         so it is opt-in rather than the default.
  local src_args=() prelude=""
  case "${SANDBOX_SOURCE_MODE:-ro}" in
    ro)
      src_args=(-v "${REPO_ROOT}:/work:ro") ;;
    copy)
      src_args=(
        -v "${REPO_ROOT}:/src:ro"
        --tmpfs "/work:rw,exec,nosuid,size=${SANDBOX_COPY_SIZE:-2g},uid=${HOST_UID},gid=${HOST_GID}"
      )
      # node_modules is EXCLUDED from the copy: a real developer checkout has a
      # macOS node_modules of a few hundred MB that would be both slow to copy
      # and wrong inside a Linux image. Instead /work/node_modules becomes a
      # symlink to the read-only dependency mount.
      #
      # That symlink is not cosmetic. TypeScript's `typeRoots` does NOT walk up
      # the tree the way Node's module resolution does, so a tsconfig saying
      # `"typeRoots": ["./node_modules/@types"]` resolves that literally against
      # /work and finds nothing — which surfaces as a wall of
      # `TS2304: Cannot find name 'jest'` rather than as a missing-dependency
      # error. One symlink, one realpath, so nothing sees a package twice.
      prelude='find /src -mindepth 1 -maxdepth 1 ! -name node_modules -exec cp -a {} /work/ \; '
      prelude+="&& ln -sfn ${SANDBOX_MOUNT_DEPS_AT} /work/node_modules && " ;;
    *) die "SANDBOX_SOURCE_MODE must be 'ro' or 'copy', got '${SANDBOX_SOURCE_MODE}'" ;;
  esac

  exec docker run --rm -i ${SANDBOX_TTY:+-t} \
    --network none \
    --user "${HOST_UID}:${HOST_GID}" \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit "${SANDBOX_PIDS:-512}" \
    --memory "${SANDBOX_MEMORY:-4g}" \
    ${src_args[@]+"${src_args[@]}"} \
    -v "${DEPS_VOL}:${SANDBOX_MOUNT_DEPS_AT}:ro" \
    -v "${OUT_DIR}:/out:rw" \
    --tmpfs "/tmp:rw,exec,nosuid,size=2g,uid=${HOST_UID},gid=${HOST_GID}" \
    ${scratch_args[@]+"${scratch_args[@]}"} \
    ${srcw_args[@]+"${srcw_args[@]}"} \
    ${env_args[@]+"${env_args[@]}"} \
    -w /work \
    -e HOME=/tmp \
    -e CI=1 \
    -e GIT_CONFIG_COUNT=1 \
    -e GIT_CONFIG_KEY_0=safe.directory \
    -e GIT_CONFIG_VALUE_0=/work \
    -e "SANDBOX_HOST_HOME=${HOME}" \
    -e "SANDBOX_DEPS_MOUNT=${SANDBOX_MOUNT_DEPS_AT}" \
    -e "SANDBOX_SOURCE_MODE=${SANDBOX_SOURCE_MODE:-ro}" \
    "${IMAGE}" \
    sh -c "${prelude}${SANDBOX_SETUP_CMD:+${SANDBOX_SETUP_CMD} && }${1}"
}

cmd_test()  { ensure_deps; say "running suite offline (--network none)"
              run_offline "${SANDBOX_DEFAULT_CMD} $*"; }
cmd_run()   { [ "$#" -gt 0 ] || die "usage: sandbox.sh run <command...>"
              ensure_deps; run_offline "$*"; }
cmd_shell() { ensure_deps; SANDBOX_TTY=1 run_offline "exec sh"; }
# "Blocked" is only meaningful if the thing being blocked actually exists and is
# readable from the host. Print that contrast first, so the proof cannot pass
# merely because there was nothing there to find.
cmd_prove() {
  ensure_deps
  echo
  printf '\033[1m═══ 0. the same reads, ON THE HOST ═══════════════════════════════════════\033[0m\n'
  echo "    establishing that these targets exist and are readable, so that"
  echo "    'blocked' below means blocked and not merely absent"
  local f
  for f in "${HOME}/.aws/credentials" "${HOME}/.ssh/id_ed25519" "${HOME}/.npmrc" \
           "${HOME}/.config/gh/hosts.yml" "${HOME}/.gitconfig" \
           "${HOME}/.tokenbot/config.json"; do
    if [ -r "$f" ] && [ -s "$f" ]; then
      printf '  \033[33m● readable\033[0m  %-38s %s bytes\n' "~${f#"$HOME"}" "$(wc -c < "$f" | tr -d ' ')"
    else
      printf '  \033[90m○ absent\033[0m    %s\n' "~${f#"$HOME"}"
    fi
  done
  for f in "${HOME}/.claude" "${HOME}/Development/tokenbot/repos/graphql-api"; do
    if [ -d "$f" ]; then
      printf '  \033[33m● listable\033[0m  %-38s %s entries\n' "~${f#"$HOME"}" "$(ls -A "$f" | wc -l | tr -d ' ')"
    else
      printf '  \033[90m○ absent\033[0m    %s\n' "~${f#"$HOME"}"
    fi
  done
  say "now attempting the identical reads from inside the sandbox"
  run_offline "sh /work/scripts/sandbox-prove.sh"
}

cmd_clean() {
  require_docker
  docker rmi -f "${IMAGE}" >/dev/null 2>&1 || true
  docker volume rm -f "${DEPS_VOL}" >/dev/null 2>&1 || true
  say "removed ${IMAGE} and ${DEPS_VOL}"
}

cmd_doctor() {
  echo "repo:         ${SANDBOX_NAME}  (${REPO_ROOT})"
  echo "image:        ${IMAGE}"
  echo "deps volume:  ${DEPS_VOL}"
  echo "lock inputs:  ${SANDBOX_LOCKFILES}"
  echo "lock hash:    $(lock_hash)"
  echo "runs as:      ${HOST_UID}:${HOST_GID} (matches host user)"
  echo "escape hatch: ${SANDBOX_HOST_CMD:?}"
  echo
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "docker:       $(docker --version)"
    if docker image inspect "${IMAGE}" >/dev/null 2>&1; then
      echo "image:        built"
      if docker volume inspect "${DEPS_VOL}" >/dev/null 2>&1; then
        deps_stale && echo "deps:         STALE — next run reinstalls" \
                   || echo "deps:         current"
      else
        echo "deps:         not installed (run: scripts/sandbox.sh deps)"
      fi
    else
      echo "image:        not built (run: scripts/sandbox.sh deps)"
    fi
  else
    warn "docker unavailable — use the escape hatch: ${SANDBOX_HOST_CMD:?}"
    exit 1
  fi
}

case "${1:-test}" in
  test)   shift || true; cmd_test "$@" ;;
  run)    shift; cmd_run "$@" ;;
  deps)   require_docker; build_image; seed_deps ;;
  prove)  cmd_prove ;;
  shell)  cmd_shell ;;
  clean)  cmd_clean ;;
  doctor) cmd_doctor ;;
  *)      sed -n '3,36p' "${BASH_SOURCE[0]}" | sed 's/^#\{1,\} \{0,1\}//'; exit 2 ;;
esac
