#!/usr/bin/env bash
# Maestro's Gambit — storefront asset capture (headless Chrome).
# Grabs the framed screenshot set for the itch/Steam/App Store pages, plus the
# frames for one example looping GIF. Run from the repo root:  bash promo/capture_assets.sh
#
# Requires Google Chrome (for --screenshot) and, for the GIF, ffmpeg.
# It captures from the REPO index.html (dev hooks on); the shipped build has them off.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
URL="file://$ROOT/index.html"
OUT="$ROOT/promo/screenshots"
GIFTMP="$ROOT/promo/.gifframes"
W=1280; H=720          # 16:9 — good for itch embed + Steam screenshots

mkdir -p "$OUT" "$GIFTMP"

shot() { # shot <outfile> <query> [budget_ms]
  local out="$OUT/$1"; local q="$2"; local budget="${3:-9000}"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-sandbox \
    --force-device-scale-factor=1 --window-size=$W,$H \
    --virtual-time-budget=$budget --screenshot="$out" "$URL$q" >/dev/null 2>&1
  echo "  $1"
}

echo "Screenshots -> $OUT"
shot 01_title.png            "?reel=1&t=0.4"                                  # wordmark sting (clean title card)
shot 02_battle_pianodrop.png "?shot=battle&att=Q&def=K&ff=4&clean=1"          # the signature piano-drop duel
shot 03_classic2d.png        "?shot=board&view=flat&select=62"                # Classic 2D board + move markers
shot 04_career.png           "?screen=career&demo=1"                          # Career ladder (seeded climb)
shot 05_puzzle.png           "?puzzle=royal-escort"                           # a training puzzle on the board
shot 06_board_contrast.png   "?shot=board&theme=contrast&select=62"           # colourblind-safe theme + markers
shot 07_checkmate.png        "?shot=battle&att=K&def=K&mate=1&ff=5&clean=1"   # the checkmate grand finale
shot 08_promotion.png        "?shot=star&promo=Q&ff=3&clean=1"               # "A Star Is Born" promotion

# ---- One example looping GIF: the piano-drop duel, ff stepped frame-by-frame ----
if command -v ffmpeg >/dev/null 2>&1; then
  echo "GIF frames (piano-drop duel)…"
  i=0
  for ff in 0.6 0.9 1.2 1.5 1.8 2.1 2.4 2.7 3.0 3.3 3.6 3.9; do
    printf -v n "%03d" "$i"
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-sandbox \
      --force-device-scale-factor=1 --window-size=$W,$H --virtual-time-budget=6000 \
      --screenshot="$GIFTMP/f$n.png" "$URL?shot=battle&att=Q&def=K&ff=$ff&clean=1" >/dev/null 2>&1
    i=$((i+1))
  done
  ffmpeg -y -framerate 8 -i "$GIFTMP/f%03d.png" \
    -vf "scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" \
    -loop 0 "$OUT/loop_pianodrop.gif" >/dev/null 2>&1
  rm -rf "$GIFTMP"
  echo "  loop_pianodrop.gif"
  echo "More GIFs: re-run the loop above with other scenes, e.g."
  echo "  ?shot=star&promo=Q&ff=<t>&clean=1  (promotion)   ?shot=battle&att=K&def=K&mate=1&ff=<t>&clean=1  (mate)"
  echo "  or seek the reel:  ?reel=1&t=<seconds>  for a montage frame."
else
  echo "ffmpeg not found — skipped GIF. (brew install ffmpeg, then re-run.)"
fi

echo "Done."
