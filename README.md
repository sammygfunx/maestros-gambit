# Maestro's Gambit
*A Symphonic Battle of Wits*

A Battle Chess–style game in which two rival orchestras — the **Ivory Philharmonic**
and the **Obsidian Philharmonic** — play classical chess on a concert stage, and every
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

## Features
- Full chess rules: castling, en passant, promotion, check/checkmate, stalemate,
  fifty-move rule, threefold repetition, insufficient material.
- **Solo Recital** vs computer at three levels (Student / Performer / Virtuoso),
  playing either ensemble; **Duet** — two players at one computer; or
  **Online Duel** — two players on different machines, paired by a short room
  code (see *Play online* below).
- Animated walk/leap moves on an isometric stage-board; full-screen battle scenes
  for every capture and a checkmate finale (skippable — click or press Esc;
  or switch to "Quick Captures" entirely).
- Three camera views (HUD "View" button, preference persists): Ivory's corner,
  Obsidian's corner (180°), and "across the table" — a straight-on, slightly
  elevated perspective with foreshortened rows.
- Promotion ceremony, captured-musician trays, algebraic move list, undo, resign.
- **Chess clocks** — per-player LED seven-segment timers (Ivory in gold, Obsidian
  in violet) that only run for the side to move and freeze during battle scenes.
  Two modes in Options: *Count Down* (a 10-minute time control — it flashes at
  0:00, no flag-fall) or *Count Up* (tracks each player's total thinking time).
  A HUD **Clock** button shows or hides them; the choice persists.
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
- Settings persist between sessions (localStorage).

## Play online
Choose **Online Duel** on the setup screen, then either **Host a Match** (you get a
5-letter room code to send to a friend) or **Join** with a code they sent you. A
relay URL is built in, so there's nothing to type — just click. The game begins the
instant your opponent connects — no accounts, no installs. Both browsers run the
same chess engine; a tiny relay server only passes moves between the two players.
While you wait for the relay (a free host can take a moment to wake) the lobby shows
an animated progress bar and a rotating "did you know?" orchestral fact. Battle
scenes stay a personal preference, so each player can toggle them independently.
Undo is disabled online (no free takebacks); Resign and Encore (rematch) work as
expected, and a disconnect ends the match cleanly.

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
  project and generated from code — there are no third-party assets, fonts
  (system serif stack only), samples, or trademarked references.
- Chess itself is public domain; "Battle Chess" the trademark/asset set is **not**
  used or referenced in any shipped text.
- User-supplied music is loaded locally at runtime and never bundled.

## Project layout
```
index.html        page shell + all DOM screens
css/style.css     menus/HUD styling
js/audio.js       WebAudio synth engine: SFX, stingers & bundled soundtrack
js/facts.js       100 "did you know?" orchestral facts for the connecting screen
js/chess.js       rules engine (no rendering; unit-tested)
js/ai.js          negamax + quiescence AI, 3 difficulty levels
js/sprites.js     procedural pixel-art characters, rigs & poses
js/fx.js          particles: notes, rings, lightning, piano-drop, curtain
js/battle.js      battle stage + the 36-duel choreography book
js/board.js       board view (3 camera projections), move animation, input
js/ui.js          DOM glue: screens, options, HUD, dialogs, online lobby
js/net.js         online client: room-code WebSocket relay glue
js/main.js        game controller / state machine / render loop
server/relay/     standalone Node WebSocket relay for Online Duel + its README
tests/            node tests/test_chess.js (26 assertions incl. perft)
                  node tests/test_net.js   (two clients play through the relay)
shots/            reference screenshots taken during development (not in repo; regenerate with ?shot=)
```

## Dev/test hooks (URL params)
`?shot=board` (add `&view=rot|table` for the other cameras) ·
`?shot=battle&att=Q&def=K&mate=1&ff=5` (ff = fast-forward seconds; `&alt=N` picks a take)
`?shot=castle&c=w` · `?shot=ep` · `?shot=star&promo=Q|R|B|N` · `?shot=end&kind=draw|stalemate`
`?shot=capture` / `?shot=mate` (scripted games) · `?shot=promo` · `?shot=gameover`
`?shot=soak` runs every choreography take and set-piece scene to completion (logs
`SOAK DONE 88/88`). `?screen=online` opens the online lobby directly. `&warp=N`
multiplies game speed. Remove `debugHook()` in `main.js` to strip these from a
release build.
