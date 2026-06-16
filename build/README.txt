MAESTRO'S GAMBIT — WEB BUILD (for Netlify)
Generated: 2026-06-16 (v2.4 — adds the Classic 2D board view)

WHAT'S HERE
  maestros-gambit-web.zip   The deployable static site, with index.html at the ZIP
                            ROOT (css/, js/, fonts/ beside it). This is the file to
                            ship to Netlify.
  maestros-gambit-web/      The same files unzipped (handy for a quick local check;
                            git-ignored, so it is NOT committed — only the zip is).

HOW TO DEPLOY TO NETLIFY
  Easiest (drag-and-drop):
    1. Go to https://app.netlify.com → your site → "Deploys".
    2. Drag maestros-gambit-web.zip onto the "Drag and drop your site output
       folder here" drop zone. Netlify unzips it and publishes index.html at the
       site root. Done.
  Or via the Netlify CLI:
    cd build && unzip -o maestros-gambit-web.zip -d maestros-gambit-web \
      && netlify deploy --prod --dir=maestros-gambit-web

NOTES
  - Pure static site: no build command, no environment, no dependencies. Netlify's
    "Build command" can be left blank and "Publish directory" is the site root.
  - The ONLINE DUEL feature needs the separate WebSocket relay (see server/relay/);
    the relay URL is baked into js/net.js. Everything else (single-player, puzzles,
    PGN, the trailer reel, all four board views) runs fully client-side and offline.
  - This bundle mirrors the repo's runtime files at the moment it was generated;
    regenerate it after future changes (see the build steps in the commit that added
    this file).

REGENERATING THIS BUILD
  From the repo root, just run:
    bash build/make_web_build.sh
  That copies the runtime files, STRIPS the dev URL hooks (sets
  window.__MG_DEV__ = false so players can't reach ?shot=/?reel=/?screen=), removes
  macOS ._* sidecars, and writes maestros-gambit-web/ + maestros-gambit-web.zip.

ITCH.IO (HTML5, playable in browser)
  The same zip is the itch upload. Tick "This file will be played in the browser",
  set the embed viewport to 1280x720, enable the Fullscreen button, and leave
  "auto-start on page load" OFF (so the first click unlocks WebAudio). Full steps +
  page copy: promo/itch_launch_checklist.md and promo/itch_page.md.

DEV HOOKS
  The repo's index.html has <script>window.__MG_DEV__ = true;</script>, which enables
  the ?shot=/?reel=/?screen= dev/testing URL params (js/main.js debugHook). The build
  script flips it to false in the SHIPPED copy only, so the hooks work in development
  but are not exposed to players.
