#!/usr/bin/env bash
#
# shai-hulud-marker-scan.sh — IoC "marker scan" for the Shai-Hulud crypto-stealer.
#
# Greps built artifacts / node_modules for the indicator-of-compromise strings
# observed in the Jun-2026 Shai-Hulud wave and FAILS (non-zero exit) on a hit,
# so it can gate CI, a pre-merge check, and a pre-deploy image check.
#
# Design notes (read before changing the marker set):
#   * TIER1 / TIER2 markers are high-signal and hard-fail.
#   * `createRequire(import.meta.url)` is a LEGITIMATE ESM idiom and appears in
#     clean packages. It is therefore treated as CONTEXT: it only fails the scan
#     when it co-occurs *in the same file* with a TIER1/TIER2 marker (which is
#     how the loader actually bootstrapped), OR when --strict is passed. This
#     keeps the gate from false-positiving itself into being disabled.
#   * Endpoint markers (trongrid/aptoslabs/bsc-dataseed) are the drainer's
#     C2/RPC hosts. TokenBot trades via CCXT on centralized exchanges, so these
#     on-chain RPC hosts are anomalous in our tree; still, a legitimate hit can
#     be suppressed with a documented allowlist entry (see --allow).
#
# Usage:
#   shai-hulud-marker-scan.sh [--strict] [--allow FILE] [PATH ...]
#   shai-hulud-marker-scan.sh --self-test
#
#   PATH ...   Directories/files to scan. Default: node_modules dist build .output out lib
#   --strict   Also hard-fail on a standalone createRequire(import.meta.url) hit.
#   --allow F  File of grep -E regexes; matching "path:line:content" hits are ignored
#              (default: .shai-hulud-allow in the current dir, if present).
#   --self-test  Prove the scanner blocks a seeded marker and passes on clean input.
#
# Exit codes: 0 = clean, 1 = marker(s) found (BLOCK), 2 = usage/error.
#
set -u

# --- marker sets -------------------------------------------------------------
# High-signal loader/obfuscation markers (case-sensitive, fixed strings).
TIER1=(
  '5-3-355'
  "global['_V']"
  'global.i='
  'eval(atob('
)
# Drainer C2 / on-chain RPC endpoints (case-insensitive, fixed strings).
TIER2=(
  'trongrid'
  'aptoslabs'
  'bsc-dataseed'
)
# Context marker: legitimate on its own; damning next to a TIER hit.
CONTEXT='createRequire(import.meta.url)'

DEFAULT_ROOTS=(node_modules dist build .output out lib)

STRICT=0
ALLOW_FILE=".shai-hulud-allow"
ROOTS=()

# --- arg parsing -------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --strict) STRICT=1; shift ;;
    --allow) ALLOW_FILE="${2:-}"; shift 2 ;;
    --self-test) SELFTEST=1; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift; while [ $# -gt 0 ]; do ROOTS+=("$1"); shift; done ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) ROOTS+=("$1"); shift ;;
  esac
done

# --- helpers -----------------------------------------------------------------
# Build a "-e pat -e pat" argv from an array (fixed-string grep).
_grep_hits() { # $1=case-flag ("" or "-i"); rest: patterns; reads roots from $SCAN_ROOTS
  local caseflag="$1"; shift
  local args=(); local p
  for p in "$@"; do args+=(-e "$p"); done
  # -r recurse, -n line numbers, -I skip binary, -F fixed strings
  grep -rnIF ${caseflag:+$caseflag} "${args[@]}" \
    --exclude-dir=.git --exclude="$(basename "$0")" \
    "${SCAN_ROOTS[@]}" 2>/dev/null
}

_apply_allow() { # filter stdin through the allowlist, if any
  if [ -n "${ALLOW_FILE:-}" ] && [ -f "$ALLOW_FILE" ]; then
    grep -vE -f "$ALLOW_FILE"
  else
    cat
  fi
}

run_scan() { # returns 0 clean / 1 blocked; prints a report
  # Resolve roots -> only those that exist.
  local existing=()
  local r
  for r in "${SCAN_ROOTS[@]}"; do [ -e "$r" ] && existing+=("$r"); done
  if [ ${#existing[@]} -eq 0 ]; then
    echo "shai-hulud-marker-scan: no scan targets present (${SCAN_ROOTS[*]}) — nothing to scan." >&2
    return 0
  fi
  SCAN_ROOTS=("${existing[@]}")

  local tier1 tier2 ctx tier_files ctx_bad
  tier1="$(_grep_hits ''   "${TIER1[@]}" | _apply_allow)"
  tier2="$(_grep_hits '-i' "${TIER2[@]}" | _apply_allow)"
  ctx="$(  _grep_hits ''   "$CONTEXT"    | _apply_allow)"

  local hits=0
  if [ -n "$tier1" ]; then echo ">>> TIER1 loader/obfuscation markers:"; echo "$tier1"; echo; hits=1; fi
  if [ -n "$tier2" ]; then echo ">>> TIER2 drainer C2/RPC endpoints:";  echo "$tier2"; echo; hits=1; fi

  # Files that already tripped a TIER marker.
  tier_files="$(printf '%s\n%s\n' "$tier1" "$tier2" | sed -n 's/^\([^:]*\):.*/\1/p' | sort -u)"

  if [ -n "$ctx" ]; then
    if [ "$STRICT" -eq 1 ]; then
      echo ">>> CONTEXT marker (createRequire) — --strict, hard-failing:"; echo "$ctx"; echo; hits=1
    else
      # Only fail context hits whose file also has a TIER hit.
      ctx_bad=""
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        local f; f="$(printf '%s' "$line" | sed -n 's/^\([^:]*\):.*/\1/p')"
        if printf '%s\n' "$tier_files" | grep -qxF "$f"; then
          ctx_bad="${ctx_bad}${line}"$'\n'
        fi
      done <<< "$ctx"
      if [ -n "${ctx_bad//$'\n'/}" ]; then
        echo ">>> CONTEXT marker (createRequire) co-located with a TIER hit:"; printf '%s' "$ctx_bad"; echo; hits=1
      else
        echo "note: createRequire(import.meta.url) seen but not co-located with any TIER marker (benign ESM); pass --strict to escalate." >&2
      fi
    fi
  fi

  if [ "$hits" -ne 0 ]; then
    echo "shai-hulud-marker-scan: FAIL — IoC markers found. Quarantine + investigate before build/deploy." >&2
    return 1
  fi
  echo "shai-hulud-marker-scan: OK — no IoC markers in ${SCAN_ROOTS[*]}"
  return 0
}

# --- self-test ---------------------------------------------------------------
if [ "${SELFTEST:-0}" -eq 1 ]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/clean/node_modules/pkg" "$tmp/dirty/node_modules/evil"
  # clean tree: includes a benign standalone createRequire (must NOT fail)
  printf 'export const x = 1;\nimport { createRequire } from "module";\nconst require = createRequire(import.meta.url);\n' \
    > "$tmp/clean/node_modules/pkg/index.js"
  # dirty tree: seed a TIER1 marker + co-located context marker
  printf 'const require=createRequire(import.meta.url);\nglobal.i=1; /* seeded marker 5-3-355 */\neval(atob("Zm9v"));\n' \
    > "$tmp/dirty/node_modules/evil/loader.js"

  fail=0
  echo "== self-test: clean tree (expect OK / exit 0) =="
  ( cd "$tmp/clean" && SCAN_ROOTS=(node_modules); run_scan ); rc=$?
  if [ $rc -ne 0 ]; then echo "SELF-TEST FAIL: clean tree returned $rc (expected 0)"; fail=1; fi
  echo
  echo "== self-test: seeded marker (expect FAIL / exit 1) =="
  ( cd "$tmp/dirty" && SCAN_ROOTS=(node_modules); run_scan ); rc=$?
  if [ $rc -ne 1 ]; then echo "SELF-TEST FAIL: dirty tree returned $rc (expected 1)"; fail=1; fi
  echo
  if [ $fail -eq 0 ]; then echo "SELF-TEST PASSED ✅ (clean=0, seeded=1)"; exit 0; else echo "SELF-TEST FAILED ❌"; exit 2; fi
fi

# --- normal invocation -------------------------------------------------------
if [ ${#ROOTS[@]} -eq 0 ]; then ROOTS=("${DEFAULT_ROOTS[@]}"); fi
SCAN_ROOTS=("${ROOTS[@]}")
run_scan
