# Maestro's Gambit — itch.io launch checklist

Goal: get the finished game *for sale and playable in the browser* on itch.io.
Legend: **[AI]** = already done / producible in-repo · **[YOU]** = needs your
account, your click, or your money.

## 0. Build the release bundle  **[AI — done, re-run anytime]**
```sh
bash build/make_web_build.sh
```
Produces `build/maestros-gambit-web.zip` with `index.html` at the zip root and the
dev URL hooks stripped (`window.__MG_DEV__ = false`). Re-run after any code change.

## 1. Assets are ready  **[AI — done]**
- Screenshots + GIF: `promo/screenshots/` (regenerate with `bash promo/capture_assets.sh`)
- Trailer: `promo/trailer_reel.mp4`
- Page copy: `promo/itch_page.md`
- Key art / icon: produced in PASS A3 (see `next_steps_2.txt`) — optional for launch,
  but itch shows a cover image (recommended 630×500) and a thumbnail.

## 2. Create the project  **[YOU]**
1. Sign in at itch.io → **Dashboard → Create new project**.
2. **Title:** Maestro's Gambit · **Project URL:** maestros-gambit (or similar).
3. **Short description:** paste the tagline from `itch_page.md`.
4. **Classification:** Games · **Kind of project:** *HTML* (playable in browser).
5. **Pricing:** *Paid* or *Pay what you want* — suggested **$1.99** (set a $0 minimum
   if you want a free-to-try funnel; otherwise a fixed $1.99).

## 3. Upload the playable build  **[YOU]**
1. Under **Uploads**, drag `build/maestros-gambit-web.zip`.
2. Tick **"This file will be played in the browser."**
3. **Embed options:** Viewport **1280 × 720**, **Fullscreen button: ✔**,
   **Mobile friendly: ✔**, **Automatically start on page load: ✘** (so the first click
   unlocks WebAudio — itch shows a "click to play" frame, which is the gesture).
4. **SharedArrayBuffer support: not required** (the game uses none).

## 4. Page content  **[YOU — paste from `itch_page.md`]**
- Long description (the "About this game" section).
- **Genre:** Strategy · **Tags:** chess, board-game, strategy, pixel-art, music,
  singleplayer, two-player, procedural-generation, turn-based.
- **Cover image** (630×500) + at least 3–5 **screenshots** from `promo/screenshots/`.
- **Trailer:** upload `promo/trailer_reel.mp4` (or link a YouTube copy) as the video.
- **Community:** enable comments if you want feedback.

## 5. Pre-publish smoke test  **[YOU]**
- Set the project to **Draft/Restricted**, open the page, click **Run game**, and:
  - confirm the title loads, click to start (sound comes on),
  - play a few moves, trigger one capture (see a duel), open Options,
  - toggle fullscreen, refresh and confirm your profile persisted (localStorage),
  - confirm `?shot=`/`?reel=` in the iframe URL do **nothing** (dev hooks stripped).
- Online Duel needs the relay (separate, see below); single-player must work regardless.

## 6. Publish  **[YOU]**
- Set visibility to **Public**, save, and announce.

---

## Notes / gotchas
- **WebAudio:** unlocks on the first user gesture (the itch "click to run" frame
  provides it). That's why "auto-start" should be OFF.
- **localStorage / profiles:** persist per the `html.itch.zone` iframe origin. A few
  privacy configurations block third-party iframe storage; profiles still work for the
  vast majority, and *Guest* play needs no storage.
- **Online Duel** requires the WebSocket relay (`server/relay/`) deployed to a wss://
  host (e.g. Render — see `server/relay/README.md`). The relay URL is baked into
  `js/net.js`. Single-player, Duet, Puzzles, PGN, and the reel are 100% client-side and
  work with no relay. If the relay is down, only Online Duel is affected — the rest of
  the game is untouched (it never connects unless you Host/Join).
- **Downloadable copy (optional):** you may also offer the same zip as a downloadable
  "play offline in your browser" build — unzip and open `index.html`.
