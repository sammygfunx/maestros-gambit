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
  From the repo root:
    rm -rf build/maestros-gambit-web build/maestros-gambit-web.zip
    mkdir -p build/maestros-gambit-web
    rsync -a index.html css js fonts build/maestros-gambit-web/
    find build/maestros-gambit-web -name '._*' -delete
    (cd build/maestros-gambit-web && zip -r -X ../maestros-gambit-web.zip . -x '*/._*')
