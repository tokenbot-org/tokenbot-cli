#!/usr/bin/env bash
# Proves the bundled tokenbot tarball is consumable by a fresh-machine
# `npm install` — no GitHub Packages auth, no workspace context, no .npmrc tricks.
# This is the test that justifies the bundling work in scripts/build.mjs.
#
# Run from the repo root:
#   pnpm --filter tokenbot smoke-test
#
# Exits 0 on success, non-zero on any failure.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d -t tokenbot-smoke.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> Packing tokenbot in $PKG_DIR"
cd "$PKG_DIR"
TARBALL="$(pnpm pack --pack-destination "$TMP_DIR" 2>&1 | tail -1)"
echo "    tarball: $TARBALL"

echo "==> Initializing fresh consumer at $TMP_DIR/consumer"
mkdir -p "$TMP_DIR/consumer"
cd "$TMP_DIR/consumer"
# Empty .npmrc to make sure no inherited @tokenbot-org auth bleeds in. If the
# bundle still tries to resolve a scoped GitHub Packages dep, this will fail
# with a clear E404.
: > .npmrc
npm init -y > /dev/null

echo "==> Installing $TARBALL into the fresh consumer"
npm install "$TARBALL" 2>&1 | tail -5

echo "==> Verifying installed binary"
TOKENBOT_BIN="$TMP_DIR/consumer/node_modules/.bin/tokenbot"
if [ ! -x "$TOKENBOT_BIN" ]; then
  echo "FAIL: $TOKENBOT_BIN missing or not executable"
  exit 1
fi

echo "==> tokenbot --version"
"$TOKENBOT_BIN" --version

echo "==> tokenbot --help (first 20 lines)"
"$TOKENBOT_BIN" --help 2>&1 | head -20

echo
echo "✓ Smoke test PASS — tokenbot tarball installs and runs from a clean dir."
