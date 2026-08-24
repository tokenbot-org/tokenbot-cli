#!/bin/sh
#
# sandbox-prove.sh — adversarial self-test, run INSIDE the sandbox container.
#
# THIS FILE IS SHARED VERBATIM ACROSS TOKENBOT REPOS.
#
# This is the deliverable. A Dockerfile that claims isolation proves nothing, so
# this script plays the malicious dependency: from inside the test container it
# tries to do every single thing the sandbox exists to prevent. Every attempt
# must fail. Any success is a hole and exits non-zero.
#
# Run it with:  scripts/sandbox.sh prove
#
# scripts/sandbox.sh prints the host-side contrast first — the same files, read
# successfully from the host — so that "blocked" means "this exists and is
# readable, and the container still cannot see it" rather than "nothing to see".
#
# POSIX sh, no dependencies, so it runs identically in a node: and a python:
# image. HOST_HOME and DEPS_DIR come from the environment; sandbox.sh sets them.

HOST_HOME="${SANDBOX_HOST_HOME:-/root}"
DEPS_DIR="${SANDBOX_DEPS_MOUNT:-}"

PASS=0
FAIL=0
blocked() { PASS=$((PASS+1)); printf '  \033[32m✓ blocked\033[0m   %s\n' "$1"; }
leaked()  { FAIL=$((FAIL+1)); printf '  \033[31m✗ LEAKED\033[0m    %s\n' "$1"
            [ -n "${2:-}" ] && printf '               %s\n' "$2"; return 0; }

# An attempt is "blocked" when the read yields nothing. A path that exists but
# is empty counts as blocked; a path with content, or a listable directory, is
# a leak.
try_read() {
  desc="$1"; path="$2"
  if [ -f "$path" ] && [ -r "$path" ] && [ -s "$path" ]; then
    leaked "$desc" "readable: $path ($(wc -c < "$path" 2>/dev/null | tr -d ' ') bytes)"
  elif [ -d "$path" ] && [ -n "$(ls -A "$path" 2>/dev/null)" ]; then
    leaked "$desc" "listable: $path"
  else
    blocked "$desc"
  fi
}

echo
echo "═══ 1. host credential stores ═══════════════════════════════════════════"
echo "    the files a malicious postinstall actually goes looking for"
try_read "AWS credentials       ~/.aws/credentials"      "$HOST_HOME/.aws/credentials"
try_read "AWS config            ~/.aws/config"           "$HOST_HOME/.aws/config"
try_read "SSH private key       ~/.ssh/id_ed25519"       "$HOST_HOME/.ssh/id_ed25519"
try_read "SSH private key       ~/.ssh/id_rsa"           "$HOST_HOME/.ssh/id_rsa"
try_read "SSH directory         ~/.ssh"                  "$HOST_HOME/.ssh"
try_read "npm registry token    ~/.npmrc"                "$HOST_HOME/.npmrc"
try_read "GitHub CLI token      ~/.config/gh/hosts.yml"  "$HOST_HOME/.config/gh/hosts.yml"
try_read "GPG keyring           ~/.gnupg"                "$HOST_HOME/.gnupg"
try_read "Claude Code state     ~/.claude"               "$HOST_HOME/.claude"
try_read "git identity          ~/.gitconfig"            "$HOST_HOME/.gitconfig"
try_read "TokenBot identity     ~/.tokenbot/config.json" "$HOST_HOME/.tokenbot/config.json"
try_read "TokenBot exch. keys   ~/.tokenbot/keys.json"   "$HOST_HOME/.tokenbot/keys.json"
try_read "macOS keychains       ~/Library/Keychains"     "$HOST_HOME/Library/Keychains"
try_read "the home directory    ~"                       "$HOST_HOME"
try_read "all user homes        /Users"                  "/Users"

echo
echo "═══ 2. sibling repositories ═════════════════════════════════════════════"
echo "    only the repo under test may be visible"
REPOS="$(dirname "$(dirname "$HOST_HOME")")"
try_read "sibling repo          repos/graphql-api"      "$HOST_HOME/Development/tokenbot/repos/graphql-api"
try_read "sibling repo          repos/market-maker-bot" "$HOST_HOME/Development/tokenbot/repos/market-maker-bot"
try_read "the repos directory   repos/"                 "$HOST_HOME/Development/tokenbot/repos"
try_read "the whole dev tree    ~/Development"          "$HOST_HOME/Development"
# /work/.. is the container's OWN root, not the host's parent directory, and the
# base image legitimately has /home and /root of its own. What matters is
# whether the host's home tree has been grafted onto it: on this host that is
# /Users, so the top-level component of HOST_HOME is what to look for.
HOST_TOP="$(echo "$HOST_HOME" | cut -d/ -f2)"
if [ -n "$HOST_TOP" ] && [ -d "/$HOST_TOP" ] && [ -n "$(ls -A "/$HOST_TOP" 2>/dev/null)" ]; then
  leaked "container root        /$HOST_TOP is present and populated" "$(ls -A "/$HOST_TOP" | tr '\n' ' ')"
else
  blocked "container root        no host home tree grafted onto / (/$HOST_TOP absent)"
fi

echo
echo "═══ 3. container escape surfaces ════════════════════════════════════════"
if [ -S /var/run/docker.sock ] || [ -S /run/docker.sock ]; then
  leaked "Docker socket         mounted" "a one-line full-host escape"
else
  blocked "Docker socket         absent from /var/run and /run"
fi
if [ "$(id -u)" = "0" ]; then
  leaked "process uid           running as root"
else
  blocked "process uid           non-root, matches the host user ($(id -u):$(id -g))"
fi
RO_BIND=/work; [ "${SANDBOX_SOURCE_MODE:-ro}" = "copy" ] && RO_BIND=/src
if mount -o remount,rw "$RO_BIND" 2>/dev/null; then
  leaked "read-only source      $RO_BIND remounted read-write"
else
  blocked "capabilities          cannot remount $RO_BIND (CAP_SYS_ADMIN dropped)"
fi
# Any writable setuid binary, or the ability to gain one, defeats no-new-privileges.
SUID="$(find / -xdev -perm -4000 -type f 2>/dev/null | head -3 | tr '\n' ' ')"
if [ -n "$SUID" ] && [ "$(id -u)" = "0" ]; then
  leaked "setuid binaries       reachable as root" "$SUID"
else
  blocked "privilege escalation  no-new-privileges set, uid is unprivileged"
fi

echo
echo "═══ 4. network egress ═══════════════════════════════════════════════════"
echo "    the exfiltration path for anything that did get read"
if getent hosts registry.npmjs.org >/dev/null 2>&1; then
  leaked "DNS resolution        registry.npmjs.org resolved"
else
  blocked "DNS                   cannot resolve registry.npmjs.org"
fi
if (exec 3<>/dev/tcp/1.1.1.1/443) 2>/dev/null; then
  leaked "outbound TCP          connected to 1.1.1.1:443"
else
  blocked "outbound TCP          cannot connect to 1.1.1.1:443"
fi
if ping -c1 -W1 8.8.8.8 >/dev/null 2>&1; then
  leaked "ICMP egress           8.8.8.8 reachable"
else
  blocked "ICMP                  8.8.8.8 unreachable"
fi
if (exec 3<>/dev/tcp/host.docker.internal/22) 2>/dev/null; then
  leaked "host loopback         reached host.docker.internal:22"
else
  blocked "host services         host.docker.internal unreachable"
fi
# --network none still leaves inert stubs (lo, and on some kernels ip6tnl0 /
# tunl0 / sit0). Their presence is not egress; a routable address would be.
ROUTABLE="$(ip -4 -o addr show 2>/dev/null | grep -v ' lo ' | grep -v '127\.0\.0\.1' | awk '{print $2":"$4}' | tr '\n' ' ')"
if [ -n "$ROUTABLE" ]; then
  leaked "network interfaces    routable IPv4 address present" "$ROUTABLE"
else
  blocked "network interfaces    no routable address on any interface"
fi
if [ -n "$(ip route show 2>/dev/null)" ]; then
  leaked "routing table         a route exists" "$(ip route show 2>/dev/null | tr '\n' ' ')"
else
  blocked "routing table         empty — nowhere to send anything"
fi

echo
echo "═══ 5. write containment ════════════════════════════════════════════════"
echo "    a compromised test must not persist anything for the next run"
# What "contained" means depends on the source mode. Under `ro` the source is a
# read-only bind and must reject writes. Under `copy` /work is a per-run tmpfs
# and is SUPPOSED to be writable — there the property is that the writes go
# nowhere: /work must be tmpfs, and the host bind at /src must still be
# read-only. Asserting read-only in copy mode would report a leak for the one
# thing that mode exists to do.
if [ "${SANDBOX_SOURCE_MODE:-ro}" = "copy" ]; then
  if grep -qE ' /work tmpfs ' /proc/mounts 2>/dev/null; then
    blocked "source tree           /work is a per-run tmpfs copy — writes are discarded at exit"
  else
    leaked "source tree           /work is writable and NOT tmpfs — writes would persist"
  fi
  if ( echo tampered > /src/.sandbox-tamper ) 2>/dev/null; then
    rm -f /src/.sandbox-tamper 2>/dev/null
    leaked "host source bind      /src is writable — the real repo can be rewritten"
  else
    blocked "host source bind      /src is read-only — the real repo is untouchable"
  fi
elif ( echo tampered > /work/.sandbox-tamper ) 2>/dev/null; then
  rm -f /work/.sandbox-tamper 2>/dev/null
  leaked "source tree           /work is writable — a test could rewrite the repo"
else
  blocked "source tree           /work is read-only"
fi
if [ -n "$DEPS_DIR" ] && [ -d "$DEPS_DIR" ]; then
  if ( echo tampered > "$DEPS_DIR/.sandbox-tamper" ) 2>/dev/null; then
    rm -f "$DEPS_DIR/.sandbox-tamper" 2>/dev/null
    leaked "dependency tree       $DEPS_DIR is writable — a payload could survive to the next run"
  else
    blocked "dependency tree       $DEPS_DIR is read-only"
  fi
  # The scratch dirs are meant to be writable, and meant to be tmpfs so that
  # what gets written there does not survive the container.
  for s in .vite-temp .vite .cache; do
    [ -d "$DEPS_DIR/$s" ] || continue
    if ( echo x > "$DEPS_DIR/$s/.probe" ) 2>/dev/null; then
      rm -f "$DEPS_DIR/$s/.probe"
      if grep -qE " $DEPS_DIR/$s tmpfs" /proc/mounts 2>/dev/null; then
        blocked "scratch dir           $s is tmpfs — writable, discarded at exit"
      else
        leaked "scratch dir           $s is writable and NOT tmpfs — writes persist"
      fi
    fi
  done
fi

echo
echo "═════════════════════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m  ISOLATION HOLDS — %d/%d attacks blocked, 0 leaks\033[0m\n\n' "$PASS" "$((PASS+FAIL))"
  exit 0
fi
printf '\033[31m  ISOLATION BROKEN — %d leak(s) in %d attempts\033[0m\n\n' "$FAIL" "$((PASS+FAIL))"
exit 1
