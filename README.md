# Maestro's Gambit
*A Symphonic Battle of Wits*

A Battle Chess–style game in which two rival orchestras — the **Ivory Sinfonia**
and the **Ebony Philharmonic** — play classical chess on a concert stage, and every
capture is fought out in a fully animated on-stage duel.

| Piece  | Musician      | Signature move |
|--------|---------------|----------------|
| Pawn   | Violinist     | Bow-rapier lunge & furious tremolo barrage |
| Knight | Cellist       | Rides the cello like a steed; overhead cello slam |
| Bishop | Clarinetist   | Note-dart sniping & spear thrusts |
| Rook   | Percussionist | Mallet slam shockwaves & cymbal clash |
| Queen  | Pianist       | Fortissimo chord waves; drops a grand piano on you |
| King   | Conductor     | Baton lightning on the downbeat |

Every one of the 36 attacker/defender matchups has its own hand-written choreography —
most with two or three alternate takes chosen at random, so a repeated matchup rarely
plays out the same way twice. Each musician also has a unique death animation (the
percussionist falls through his own drum; the pianist swoons; the conductor takes a
final bow as the curtain falls).

Special moves get their own staged set-pieces too: **castling** sends the conductor and
percussionist across the stage for a mid-cross high-five; **en passant** catches the
victim marching past; **promotion** is "A Star Is Born", a cutscene in which the
violinist transforms into whichever chair you choose; and **checkmate**, **stalemate**,
and a **draw** each have their own elaborate finale (the checkmate send-off picks one of
three curtain-calls at random).

**Repository:** https://github.com/sammygfunx/maestros-gambit

## Run it
Open **`index.html`** in any modern browser (Chrome, Edge, Firefox, Safari).
No build step, no server, no dependencies — everything (art, animation, sound)
is generated procedurally at runtime.

## Build a release / publish
Run `bash build/make_web_build.sh` to produce `build/maestros-gambit-web.zip`
(`index.html` at the zip root) — the same bundle for **itch.io** (HTML5, playable in
browser; embed at 1280×720 with the fullscreen button on) or **Netlify** (drag-and-drop
static site). The build strips the dev URL hooks: the repo's `index.html` sets
`window.__MG_DEV__ = true` so the `?shot=`/`?reel=`/`?screen=` testing params work in
development, and the script flips it to `false` in the shipped copy so players can't
reach them. Storefront copy, a launch checklist, and a screenshot/GIF capture script
live in `promo/` (`itch_page.md`, `itch_launch_checklist.md`, `capture_assets.sh`).
The roadmap for getting it sold is `next_steps_2.txt`.

## Features
- Full chess rules: castling, en passant, promotion, check/checkmate, stalemate,
  fifty-move rule, threefold repetition, insufficient material.
- **Solo Recital** vs a roster of ten named, orchestra-themed CPU personas on a
  **rated ladder** from ~820 to ~2010 Elo, grouped by class band (Novice, Class
  E…Class A, Expert) in a card picker. Weaker conductors play genuinely weakly —
  shallow search plus a chance to blunder and noisy evaluation, so a novice really
  does hang pieces — and each carries a fixed rating that feeds your own. The
  stronger conductors open from a hand-authored **opening book** of sound mainlines
  (weaker ones rarely do, so the gradient holds) and search with an iterative-
  deepening engine backed by a transposition table, so they use their thinking
  budget efficiently. (The ladder honestly tops out near 2000, the engine's
  ceiling.) Plus **Duet** — two
  players at one computer — or **Online Duel** — two players on different machines,
  paired by a short room code (see *Play online* below).
- **Career Ladder** — a single-player climb over that roster. Beat a conductor to
  unlock the next rung; clear every conductor in a class band for a "Class cleared!"
  flourish, and best Maestro Magnus at the top for the *Ladder Complete* finale.
  Progress is saved per profile (Guest tracks nothing). A **Free Play / All
  Unlocked** toggle is always available, so casual players are never hard-gated, and
  the classic setup-screen opponent picker stays fully open too.
- **Puzzles** — a curated set of training positions: mate-in-1, -2 and -3 plus a
  couple of win-the-material tactics. Find the winning move and the stage performs
  your finishing blow (the defence is played for you); wrong tries are waved off so
  you can try again. Reached from the title menu.
- **Watch the Overture** — a built-in, music-synced **trailer reel**. From the title
  menu, sit back for a ~30-second attract-mode montage: the wordmark sting, the best
  battle choreographies (the piano-drop checkmate, the percussion drum-off, the grand
  curtain finale, an "A Star Is Born" promotion) cut on the beat of the bundled
  *Overture in Amber*, with gold title cards between them. It loops; click or press Esc
  to return. (One screen-recording makes a finished trailer.)
- **PGN export & import** — copy or download any finished game as a standard
  **`.pgn`** file (game-over card or Options), or paste a PGN to replay it on the
  board. Useful for sharing games or studying them in another tool.
- **Banter** — each persona has a few short, PG, orchestra-flavoured lines: a taunt
  pops up when the CPU snatches your queen or rook, and a send-off appears on the
  game-over card. Toggle it in Options (*Banter: On/Off*).
- Animated walk/leap moves on an isometric stage-board; full-screen battle scenes
  for every capture and a checkmate finale (skippable — click or press Esc;
  or switch to "Quick Captures" entirely).
- Four camera views (HUD "View" button, preference persists): Ivory's corner,
  Ebony's corner (180°), "across the table" — a straight-on, slightly
  elevated perspective with foreshortened rows — and **Classic 2D**, a clean,
  familiar top-down diagram board with procedurally-drawn black & white Staunton
  pieces for when you just want to read the position clearly (it honours the
  colour-blind-safe Board Theme too). The board faces **your** side by default,
  so playing Black puts Black at the bottom in the table and Classic 2D views.
  In the table view a small **angle dial** (HUD "Angle" button) spins the stage
  to any of **eight fixed viewpoints** (45° steps) — read the position from
  whichever corner you like.
- Promotion ceremony, captured-musician trays, algebraic move list, undo, resign.
- **Chess clocks** — per-player LED seven-segment timers (Ivory in gold, Ebony
  in violet) that only run for the side to move and freeze during battle scenes.
  Three modes in Options: *Count Up* (tracks each player's total thinking time),
  *Count Down* (a casual time limit — it flashes at 0:00 but running out doesn't
  lose), and *Flag-Fall* — proper sudden death, where letting your flag fall
  **loses the game**. A standard **time control** picker offers 1+0 bullet, 3+0
  / 3+2 / 5+0 blitz and 10+0 rapid, or a custom base + Fischer increment (the
  increment tops up your clock after each move). A HUD **Clock** button shows or
  hides them; all choices persist. (Online clocks stay an honour-system display
  — each client ticks independently — so flag-fall is for local games.)
- All sound effects synthesized live with WebAudio (pizzicato, timpani, cymbals,
  reed squeaks, FM piano, applause…).
- **Bundled original soundtrack** — three looping synth-chamber tracks (*Overture
  in Amber*, *Clarinet Nocturne*, *Pizzicato Pavane*), all generated from note
  data through the same instrument voices (no samples, no files). Each musician
  also has a signature **stinger** played when you select the piece and as the
  battle prelude. Pick a track or toggle music in Options; the choice persists.
- **Bring your own soundtrack:** Options → *Your Music* loads any local audio
  file and loops it during play (overriding the bundled track); a **Clear**
  button removes it and returns to the bundled set.
- **Player profiles & chess ratings** — create a named profile (saved on your
  device) and your rating updates after every game against the computer. Each AI
  persona is a fixed-rating opponent (≈820 up to ≈2010, see the ladder above), so
  your number converges sensibly; online games count on the honour system, and
  local two-player games never affect a rating. Pick the rating model in Options —
  **Elo** (the classic, default) or **Glicko-2** (the chess.com/Lichess style) —
  with USCF/ECF figures shown as estimates. Or choose **Guest** to play untracked.
  Your rating appears in the HUD and on the game-over card (e.g. *Elo 1200 → 1212*).
- **Accessibility & presentation** — a **Reduce Motion** option (seeded from your
  OS `prefers-reduced-motion` setting) calms the menu animations and resolves every
  capture instantly; a **Board Theme** option adds a high-contrast, colour-blind-safe
  blue-and-amber board alongside the classic ivory-and-ebony stage, with move markers
  that are shape-coded (a ring for captures, a note for quiet moves) so nothing relies
  on hue alone. Both choices persist. The wordmark and screen headings are set in the
  **Cinzel** display family (bundled locally, SIL Open Font License — see *Credits*).
  Every menu screen scrolls when it is taller than the window — on phones, tablets, and
  desktop at any zoom — with safe-area padding, so the Back button is always reachable.
- Settings persist between sessions (localStorage).

## Play online
Choose **Online Duel** on the setup screen, then either **Host a Match** (you get a
5-letter room code to send to a friend) or **Join** with a code they sent you. A
relay URL is built in, so there's nothing to type — just click. The game begins the
instant your opponent connects — no accounts, no installs. Both browsers run the
same chess engine; a tiny relay server only passes moves between the two players.
While you wait for the relay (a free host can take a moment to wake) the lobby shows
an animated progress bar and a rotating "did you know?" orchestral fact. Battle
scenes stay a personal preference, so each player can toggle them independently, and
the same duel choreography is shown to **both** players (it's seeded from the move,
so the on-stage banter matches end to end). **Undo** works online by consent: tap
Undo to ask, and your opponent gets an *Allow / Decline* prompt; on Allow the move is
taken back on both boards. The host can also set **Undos: Allow freely** before
hosting, so either player may take a move back with no prompt. Resign and Encore
(rematch) work as expected, and a disconnect ends the match cleanly.

You need one small relay running for players to find each other. It is free to host:

```sh
cd server/relay
npm install
npm start            # local play on one LAN (ws://127.0.0.1:8911/)
```

For two different networks, deploy `server/relay` to a free host (Render works well)
and use its `wss://…` URL. Full steps — including how to bake the URL in so players
have nothing to type — are in **`server/relay/README.md`**. The relay is a standalone
Node process; the game itself stays dependency-free.

## Commercial-safety notes
- The name, characters, story, and all visual/audio assets are original to this
  project and generated from code — there are no third-party samples or trademarked
  references. Body/HUD text uses the system serif stack. The Classic 2D view's
  black & white Staunton pieces are drawn procedurally from hand-authored vector
  silhouettes (no chess-piece font or imported artwork — nothing to license).
- The only bundled third-party assets are the **Cinzel** and **Cinzel Decorative**
  display fonts (used for the wordmark and screen headings), by Natanael Gama / The
  Cinzel Project Authors, under the **SIL Open Font License 1.1**. The OFL explicitly
  permits embedding and bundling in commercial products; the licenses travel with the
  fonts in `fonts/` and attribution appears on the Credits screen. They are loaded
  locally (no CDN), so the build stays file://-safe and offline.
- Chess itself is public domain; "Battle Chess" the trademark/asset set is **not**
  used or referenced in any shipped text.
- User-supplied music is loaded locally at runtime and never bundled.

## Project layout
```
index.html        page shell + all DOM screens
css/style.css     menus/HUD styling (+ @font-face for the bundled display fonts)
fonts/            bundled Cinzel display fonts + their SIL OFL license files
js/audio.js       WebAudio synth engine: SFX, stingers & bundled soundtrack
js/facts.js       100 "did you know?" orchestral facts for the connecting screen
js/chess.js       rules engine + FEN loader/exporter + Zobrist hash (no rendering; unit-tested)
js/ai.js          iterative-deepening negamax + transposition table + quiescence, driven by a strength profile
js/opening_book.js hand-authored opening book (MG.OpeningBook; DOM-free, unit-tested)
js/pgn.js         PGN export/import (MG.PGN; DOM-free, unit-tested)
js/puzzles.js     curated mate-in-N / win-material puzzle set (MG.Puzzles)
js/opponents.js   the rated CPU persona ladder (MG.Opponents) + banter + progression rules
js/sprites.js     procedural pixel-art characters, rigs & poses
js/fx.js          particles: notes, rings, lightning, piano-drop, curtain
js/battle.js      battle stage + the 36-duel choreography book
js/reel.js        attract-mode trailer reel (MG.Reel): beat-synced montage over the battle scene
js/board.js       board view (4 camera projections incl. flat 2D + Staunton pieces), move animation, input
js/rating.js      rating math: Elo + full Glicko-2, USCF/ECF estimates (unit-tested)
js/profiles.js    player-profile persistence (localStorage 'mg_profiles')
js/ui.js          DOM glue: screens, options, HUD, dialogs, online lobby, profiles
js/net.js         online client: room-code WebSocket relay glue
js/main.js        game controller / state machine / render loop
server/relay/     standalone Node WebSocket relay for Online Duel + its README
tests/            node tests/test_chess.js  (34 assertions incl. perft + FEN)
                  node tests/test_ai.js     (Zobrist hash, transposition table, opening book)
                  node tests/test_rating.js (Elo + the Glickman Glicko-2 example)
                  node tests/test_pgn.js    (PGN export/import round-trips)
                  node tests/test_net.js    (two clients play through the relay)
                  node tests/strength_probe.js (informational: ladder gradient + search A/B)
shots/            reference screenshots taken during development (not in repo; regenerate with ?shot=)
```

## Dev/test hooks (URL params)
`?shot=board` (add `&view=rot|table|flat` for the other cameras — `flat` is the
classic top-down 2D board — `&orient=0..7` to spin the table/flat board to a
fixed yaw angle, `&dial=1` to open the angle dial, `&theme=contrast` for the
colour-blind-safe palette, `&select=<square>` to show move markers) ·
`?shot=flagfall&sec=N` ends a game on a flag-fall after an N-second clock
(verifies a timeout loses) ·
`?shot=battle&att=Q&def=K&mate=1&ff=5` (ff = fast-forward seconds; `&alt=N` picks a take)
`?shot=castle&c=w` · `?shot=ep` · `?shot=star&promo=Q|R|B|N` · `?shot=end&kind=draw|stalemate`
`?shot=capture` / `?shot=mate` (scripted games) · `?shot=promo` · `?shot=gameover`
(add `&clean=1` to any `?shot=` scene to hide the duel banner for a framed still).
`?reel=1` plays the trailer reel; `?reel=1&t=SECONDS` freezes one reel frame for a
headless still/GIF. `?shot=soak` runs every choreography take and set-piece scene to
completion (logs `SOAK DONE 88/88`). `?screen=online` opens the online lobby directly;
`?screen=profiles` opens the player-profiles screen; `?screen=setup` opens the
setup screen (handy for the opponent picker); `?screen=options` opens Options;
`?screen=career` opens the Career
Ladder (`&demo=1` seeds a sample climb so the shot shows all rung states);
`?screen=puzzles` opens the Puzzles list and `?puzzle=<id>` loads a puzzle straight
onto the board (`&solve=1` auto-plays its solution). `&warp=N` multiplies game speed.
Remove `debugHook()` in `main.js` to strip these from a release build.
