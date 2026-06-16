#!/usr/bin/env bash
# Maestro's Gambit — web build generator (itch.io HTML5 + Netlify static site).
# Produces build/maestros-gambit-web/ and build/maestros-gambit-web.zip with
# index.html at the ZIP ROOT (css/, js/, fonts/ beside it).
#
# What it does beyond a plain copy:
#   - DEV-HOOK STRIP: flips window.__MG_DEV__ to false in the SHIPPED index.html
#     so the ?shot=/?reel=/?screen= dev URL params are not exposed to players.
#     (The repo copy stays true, so dev hooks keep working in development.)
#   - removes macOS ._* AppleDouble files so they don't ride along in the zip.
#
# Usage:  bash build/make_web_build.sh        (run from the repo root)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/maestros-gambit-web"
ZIP="$ROOT/build/maestros-gambit-web.zip"

cd "$ROOT"
rm -rf "$OUT" "$ZIP"
mkdir -p "$OUT"

# Copy the runtime files only (no tests/, server/, promo/, build/, docs).
rsync -a index.html css js fonts "$OUT/"

# Strip dev hooks from the shipped index.html (repo copy is untouched).
# Matches the inline flag added in index.html: <script>window.__MG_DEV__ = true;</script>
if grep -q "__MG_DEV__ = true" "$OUT/index.html"; then
  # portable in-place sed (BSD/macOS + GNU)
  sed -i.bak 's/__MG_DEV__ = true/__MG_DEV__ = false/' "$OUT/index.html"
  rm -f "$OUT/index.html.bak"
  echo "  dev hooks: STRIPPED (window.__MG_DEV__ = false)"
else
  echo "  WARNING: dev flag not found in index.html — release may expose dev hooks!" >&2
fi

# Drop macOS metadata sidecars.
find "$OUT" -name '._*' -delete
find "$OUT" -name '.DS_Store' -delete

# Zip with index.html at the root.
( cd "$OUT" && zip -r -q -X "$ZIP" . -x '*/._*' )

echo "  built: $OUT"
echo "  zip:   $ZIP"
echo "Done. Upload the zip to itch.io as 'HTML5 / playable in browser' (see"
echo "promo/itch_launch_checklist.md), or drag it onto Netlify (see build/README.txt)."
