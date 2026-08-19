#!/usr/bin/env bash
#
# shai-hulud-marker-scan.sh — IoC "marker scan" for the Shai-Hulud / EtherHiding
# crypto-stealer family.
#
# v2 (2026-08-14). Rewritten after the 2026-08-13 reinfection, which the v1
# scanner would have MISSED in three separate ways. Each gap below is now a
# detector with a self-test case.
#
#   GAP 1 — v1 only scanned build roots (node_modules dist build ...). The
#     2026-08-13 loader was appended to COMMITTED SOURCE: eslint.config.js,
#     postcss.config.mjs, next.config.mjs, babel.config.cjs, jest.config.js.
#     None of those live under a build root. v2 defaults to scanning the tree.
#
#   GAP 2 — v1 passed `grep -I`, which SKIPS BINARY FILES. The loader was also
#     dropped into `public/fonts/fa-solid-400.woff2` disguised as a font. That
#     particular file happened to be plain text (padding spaces + JS) so v1
#     would have caught it by luck — but any variant carrying a real font header
#     or a single NUL byte becomes "binary" and v1 goes silent. v2 scans binary
#     content too (`-a`).
#
#   GAP 3 — v1 matched only a fixed marker list. `global.i=` was in TIER1 by
#     luck; `global.j=` would have sailed through. v2 adds structural detectors
#     that do not depend on knowing the marker: asset/extension masquerade,
#     whitespace-padding, and obfuscator-identifier density.
#
# Severity model:
#   HARD FAIL (always)  - TIER1/TIER2 exact markers; asset-extension masquerade.
#                         These have no plausible benign explanation.
#   TIER3 (warn)        - structural heuristics. Reported always, but only fail
#                         the run under --strict, because minified and generated
#                         code trips them legitimately. Tuned against the real
#                         tokenbot-org + CultureGen trees; see --self-test.
#
# Usage:
#   shai-hulud-marker-scan.sh [--strict] [--allow FILE] [--quiet] [PATH ...]
#   shai-hulud-marker-scan.sh --self-test
#
#   PATH ...     Directories/files to scan. Default: the current tree (`.`).
#   --strict     Escalate TIER3 heuristics and standalone createRequire to fail.
#                KNOWN LIMITATION: --strict currently FAILS on a clean tree in
#                any repo with vendored ESM tooling. vitest, vite, rolldown and
#                fdir all ship legitimate `createRequire(import.meta.url)` in
#                node_modules (measured: 14 hits, 0 of them first-party). To use
#                --strict today, pass an --allow file listing those paths. The
#                escalation is deliberately NOT scoped to first-party code: a
#                compromised dependency is exactly where a malicious
#                createRequire would hide.
#   --allow F    File of grep -E regexes; matching "path:line:content" hits are
#                ignored (default: .shai-hulud-allow, if present).
#   --quiet      Suppress the TIER3 advisory section when it is not failing.
#   --self-test  Prove every detector fires, and that clean/minified input does not.
#
# Exit codes: 0 = clean, 1 = marker(s) found (BLOCK), 2 = usage/error.
#
set -u

# --- marker sets -------------------------------------------------------------
TIER1=(
  '5-3-355'
  "global['_V']"
  'global.i='
  'eval(atob('
)
TIER2=(
  'trongrid'
  'aptoslabs'
  'bsc-dataseed'
)
CONTEXT='createRequire(import.meta.url)'

# v2: default to the working tree, not build output. Build roots remain valid
# explicit arguments for the pre-deploy image check.
DEFAULT_ROOTS=(.)

# Directories that are never worth scanning and only add noise/time.
PRUNE_DIRS=(.git node_modules/.cache .next/cache .turbo .gradle Pods DerivedData)

# Extensions whose contents must NOT be executable text, with expected leading
# magic bytes (hex). A file claiming one of these types that carries script
# instead is the 2026-08-13 `fa-solid-400.woff2` trick.
# Documentation formats, excluded from the PADDING heuristic ONLY. Wide
# markdown/rst tables pad columns well past 200 spaces: on a clean rest-api
# tree that produced 91 advisories, 91 of 91 of them .md, and made --strict
# unusable. Advisories nobody reads are worse than none, so the noise is cut
# at the source. These files are STILL covered by the marker, masquerade and
# obfuscation detectors — only the whitespace heuristic skips them, and no
# self-test case is a doc file.
DOC_EXTS='md markdown rst txt csv tsv'

ASSET_EXTS='woff2|woff|ttf|otf|eot|png|jpg|jpeg|gif|ico|webp|bmp|mp4|mov|pdf|zip'

STRICT=0
QUIET=0
ALLOW_FILE=".shai-hulud-allow"
ROOTS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --strict) STRICT=1; shift ;;
    --allow) ALLOW_FILE="${2:-}"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    --self-test) SELFTEST=1; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift; while [ $# -gt 0 ]; do ROOTS+=("$1"); shift; done ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) ROOTS+=("$1"); shift ;;
  esac
done

# --- helpers -----------------------------------------------------------------
_prune_args() {
  local d
  for d in "${PRUNE_DIRS[@]}"; do printf ' --exclude-dir=%s' "$d"; done
}

# v2: -a (treat binary as text) replaces v1's -I (skip binary). This is GAP 2.
_grep_hits() { # $1=case-flag ("" or "-i"); rest: patterns
  local caseflag="$1"; shift
  local args=(); local p
  for p in "$@"; do args+=(-e "$p"); done
  # shellcheck disable=SC2046
  grep -rnaF ${caseflag:+$caseflag} "${args[@]}" \
    $(_prune_args) --exclude="$(basename "$0")" --exclude='*marker-scan*.sh' --exclude='.shai-hulud-allow' \
    "${SCAN_ROOTS[@]}" 2>/dev/null \
    | cut -c1-240
}

_apply_allow() {
  if [ -n "${ALLOW_FILE:-}" ] && [ -f "$ALLOW_FILE" ]; then grep -vE -f "$ALLOW_FILE"; else cat; fi
}

# Only asset-extension files, so the masquerade check never walks a whole
# node_modules tree file-by-file. Iterating every file in bash costs minutes on
# a 20k+ file dependency tree; this keeps the candidate list in the dozens.
_find_assets() {
  local d prune=() names=() ext first=1
  for d in "${PRUNE_DIRS[@]}"; do prune+=(-name "$d" -prune -o); done
  for ext in $(printf '%s' "$ASSET_EXTS" | tr '|' ' '); do
    if [ $first -eq 1 ]; then names+=(-iname "*.$ext"); first=0
    else names+=(-o -iname "*.$ext"); fi
  done
  find "${SCAN_ROOTS[@]}" "${prune[@]}" -type f \( "${names[@]}" \) -print 2>/dev/null
}

# GAP 3a: a file with an asset extension whose magic bytes do not match, AND
# which contains script-ish tokens. Both conditions required, so a merely
# corrupt or unusual asset does not fail the build.
_asset_masquerade() {
  local f ext magic head
  while IFS= read -r f; do
    ext="${f##*.}"
    printf '%s' "$ext" | grep -qiE "^($ASSET_EXTS)$" || continue
    magic="$(od -An -tx1 -N4 "$f" 2>/dev/null | tr -d ' \n')"
    case "$(printf '%s' "$ext" | tr 'A-Z' 'a-z')" in
      woff2) [ "${magic:0:8}" = "774f4632" ] && continue ;;   # wOF2
      woff)  [ "${magic:0:8}" = "774f4646" ] && continue ;;   # wOFF
      ttf)   [ "${magic:0:8}" = "00010000" ] && continue ;;
      otf)   [ "${magic:0:8}" = "4f54544f" ] && continue ;;
      png)   [ "${magic:0:8}" = "89504e47" ] && continue ;;
      jpg|jpeg) [ "${magic:0:6}" = "ffd8ff" ] && continue ;;
      gif)   [ "${magic:0:6}" = "474946" ] && continue ;;
      webp)  [ "${magic:0:8}" = "52494646" ] && continue ;;
      bmp)   [ "${magic:0:4}" = "424d" ] && continue ;;
      ico)   [ "${magic:0:8}" = "00000100" ] && continue ;;
      pdf)   [ "${magic:0:8}" = "25504446" ] && continue ;;
      zip)   [ "${magic:0:4}" = "504b" ] && continue ;;
      eot|mp4|mov) continue ;;                                 # too variable to assert
      *) continue ;;
    esac
    # Magic mismatched. Only escalate if it also smells like code.
    if head -c 4000 "$f" 2>/dev/null \
         | grep -qaE 'function|require\(|=>|eval\(|global\.|const |var |import '; then
      echo "$f: declares .$ext but magic bytes are '${magic:0:8}' and content is script"
    fi
  done
}

# GAP 3b: long whitespace run then code on the same line — the padding trick
# used to push the loader off-screen in diffs and editors.
_padding_hits() {
  grep -rnaE '[[:space:]]{200,}[^[:space:]]' \
    $(_prune_args) --exclude="$(basename "$0")" --exclude='*marker-scan*.sh' --exclude='.shai-hulud-allow' \
    $(for e in $DOC_EXTS; do printf ' --exclude=*.%s' "$e"; done) \
    "${SCAN_ROOTS[@]}" 2>/dev/null | cut -c1-160
}

# GAP 3c: javascript-obfuscator hex-identifier density (_0xabc123).
# Single recursive pass + tally, rather than one grep per file — the per-file
# form took >3 minutes on a 20k-file node_modules.
_obfuscation_hits() {
  # shellcheck disable=SC2046
  grep -roaE '_0x[0-9a-f]{4,}' \
    $(_prune_args) --exclude="$(basename "$0")" --exclude='*marker-scan*.sh' \
    "${SCAN_ROOTS[@]}" 2>/dev/null \
    | sed 's/:[^:]*$//' | sort | uniq -c \
    | awk '$1>=25 {c=$1; $1=""; sub(/^[[:space:]]+/,""); print $0": "c" obfuscator-style hex identifiers (_0x…)"}'
}

run_scan() {
  local existing=() r
  for r in "${SCAN_ROOTS[@]}"; do [ -e "$r" ] && existing+=("$r"); done
  if [ ${#existing[@]} -eq 0 ]; then
    echo "shai-hulud-marker-scan: no scan targets present (${SCAN_ROOTS[*]}) — nothing to scan." >&2
    return 0
  fi
  SCAN_ROOTS=("${existing[@]}")

  local tier1 tier2 ctx masq pad obf tier_files ctx_bad hits=0 warn=0
  tier1="$(_grep_hits ''   "${TIER1[@]}" | _apply_allow)"
  tier2="$(_grep_hits '-i' "${TIER2[@]}" | _apply_allow)"
  ctx="$(  _grep_hits ''   "$CONTEXT"    | _apply_allow)"
  masq="$(_find_assets | _asset_masquerade | _apply_allow)"
  pad="$( _padding_hits | _apply_allow)"
  obf="$( _obfuscation_hits | _apply_allow)"

  if [ -n "$tier1" ]; then echo ">>> TIER1 loader/obfuscation markers:"; echo "$tier1"; echo; hits=1; fi
  if [ -n "$tier2" ]; then echo ">>> TIER2 drainer C2/RPC endpoints:";  echo "$tier2"; echo; hits=1; fi
  if [ -n "$masq" ]; then
    echo ">>> ASSET MASQUERADE — file extension does not match its content:"
    echo "$masq"; echo
    echo "    (this is how the 2026-08-13 loader shipped: public/fonts/fa-solid-400.woff2)"; echo
    hits=1
  fi

  tier_files="$(printf '%s\n%s\n' "$tier1" "$tier2" | sed -n 's/^\([^:]*\):.*/\1/p' | sort -u)"

  if [ -n "$ctx" ]; then
    if [ "$STRICT" -eq 1 ]; then
      echo ">>> CONTEXT marker (createRequire) — --strict, hard-failing:"; echo "$ctx"; echo; hits=1
    else
      ctx_bad=""
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        local f; f="$(printf '%s' "$line" | sed -n 's/^\([^:]*\):.*/\1/p')"
        if printf '%s\n' "$tier_files" | grep -qxF "$f"; then ctx_bad="${ctx_bad}${line}"$'\n'; fi
      done <<< "$ctx"
      if [ -n "${ctx_bad//$'\n'/}" ]; then
        echo ">>> CONTEXT marker (createRequire) co-located with a TIER hit:"; printf '%s' "$ctx_bad"; echo; hits=1
      fi
    fi
  fi

  # TIER3: advisory unless --strict.
  if [ -n "$pad" ] || [ -n "$obf" ]; then
    warn=1
    if [ "$STRICT" -eq 1 ] || [ "$QUIET" -eq 0 ]; then
      echo ">>> TIER3 structural heuristics$([ "$STRICT" -eq 1 ] && echo ' (--strict: FAILING)' || echo ' (advisory)'):"
      [ -n "$pad" ] && { echo "  -- long whitespace padding then code (loader hiding trick):"; echo "$pad"; }
      [ -n "$obf" ] && { echo "  -- obfuscator-style identifier density:"; echo "$obf"; }
      echo
    fi
    [ "$STRICT" -eq 1 ] && hits=1
  fi

  if [ "$hits" -ne 0 ]; then
    echo "shai-hulud-marker-scan: FAIL — IoC markers found. Quarantine + investigate before build/deploy." >&2
    return 1
  fi
  if [ "$warn" -eq 1 ]; then
    echo "shai-hulud-marker-scan: OK with TIER3 advisories in ${SCAN_ROOTS[*]} (re-run --strict to enforce)"
  else
    echo "shai-hulud-marker-scan: OK — no IoC markers in ${SCAN_ROOTS[*]}"
  fi
  return 0
}

# --- self-test ---------------------------------------------------------------
if [ "${SELFTEST:-0}" -eq 1 ]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  fail=0
  _case() { # name expected_rc dir
    local name="$1" want="$2" dir="$3" rc
    # NOTE: array assignment cannot be used as a command prefix in bash —
    # `SCAN_ROOTS=(.) run_scan` silently does nothing. Assign, then call.
    ( cd "$dir" && SCAN_ROOTS=(.); ALLOW_FILE=""; run_scan >/dev/null 2>&1 ); rc=$?
    if [ "$rc" -eq "$want" ]; then echo "  ok    $name (exit $rc)"
    else echo "  FAIL  $name (exit $rc, wanted $want)"; fail=1; fi
  }

  # 1. clean tree, including a benign standalone createRequire and minified JS
  mkdir -p "$tmp/clean/src"
  printf 'import { createRequire } from "module";\nconst require = createRequire(import.meta.url);\n' > "$tmp/clean/src/a.mjs"
  # a realistically long minified line: must NOT trip TIER3 padding
  { printf 'var a=1;'; for i in $(seq 1 400); do printf 'function f%d(){return %d;}' "$i" "$i"; done; printf '\n'; } > "$tmp/clean/src/vendor.min.js"
  _case "clean tree (incl. minified + benign createRequire)" 0 "$tmp/clean"

  # 2. GAP 1: marker in committed SOURCE, not a build root
  mkdir -p "$tmp/src-marker"
  printf 'module.exports={};\nglobal.i="A10-x";\n' > "$tmp/src-marker/eslint.config.js"
  _case "GAP1 marker appended to committed source config" 1 "$tmp/src-marker"

  # 3. GAP 2: marker inside a genuinely BINARY file (NUL bytes present)
  mkdir -p "$tmp/bin-marker"
  printf 'wOF2\000\000\000\000binaryjunk\000global.i="A10-x";\000\000' > "$tmp/bin-marker/real.woff2"
  _case "GAP2 marker hidden inside binary content" 1 "$tmp/bin-marker"

  # 4. GAP 3a: asset masquerade — .woff2 that is actually script, no known marker
  mkdir -p "$tmp/masq/public/fonts"
  printf 'const x=require("http");function boot(){eval(x);}\n' > "$tmp/masq/public/fonts/fa-solid-400.woff2"
  _case "GAP3a .woff2 containing script, unknown marker" 1 "$tmp/masq"

  # 5. a REAL woff2 must not be flagged
  mkdir -p "$tmp/realfont"
  printf 'wOF2\000\001\000\000\000\000\000\000actual font payload here\n' > "$tmp/realfont/ok.woff2"
  _case "genuine woff2 not flagged" 0 "$tmp/realfont"

  echo
  if [ $fail -eq 0 ]; then echo "SELF-TEST PASSED ✅ (all detectors fire; clean/minified/genuine-asset do not)"; exit 0
  else echo "SELF-TEST FAILED ❌"; exit 2; fi
fi

# --- normal invocation -------------------------------------------------------
if [ ${#ROOTS[@]} -eq 0 ]; then ROOTS=("${DEFAULT_ROOTS[@]}"); fi
SCAN_ROOTS=("${ROOTS[@]}")
run_scan
