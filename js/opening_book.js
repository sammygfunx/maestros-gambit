/* ============================================================
   Maestro's Gambit — opening_book.js  (MG.OpeningBook)
   A small, hand-authored tree of SOUND mainline openings, keyed
   by position so transpositions are handled automatically.

   COPYRIGHT NOTE: chess opening *theory* is not copyrightable, and
   these lines are authored here move-by-move — not copied from any
   specific published opening book / database file. The names are
   plain descriptive labels for the variations.

   HOW IT'S USED (the persona policy lives here so callers stay simple):
     • The book is the UNION of the LINES below. Replaying each line
       from the start records, at every position, which SAN was played
       and how many authored lines pass through it (its weight).
     • pickFor(game, profile) is consulted at the top of MG.AI.chooseMove.
       A STRONG persona almost always answers from book while in book
       (variety + perceived strength); a WEAK persona rarely does, so the
       ladder gradient is preserved — a novice can't lean on theory it
       hasn't "learned". Out of book → null → the engine searches.
     • The move is chosen weighted-randomly among the book candidates, so
       a strong persona varies its openings rather than railroading one.

   Pure data + helpers — no DOM, safe to require() under Node (it uses
   MG.Chess to build + key the tree, so load it AFTER js/chess.js).
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});

  /* Each line is a sequence of SAN moves from the standard start position.
     Lines stay a handful of plies deep — enough to leave both sides a sound,
     familiar middlegame — and cover both 1.e4 and 1.d4 plus a couple of flank
     openings, with the most common Black replies, so the book has real variety
     for whichever colour the persona has. */
  const LINES = [
    // ---- 1.e4 e5 (Open Games) ----
    { name: 'Ruy López, Closed', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O'] },
    { name: 'Ruy López, Berlin', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6', 'Bxc6', 'dxc6'] },
    { name: 'Italian, Giuoco Pianissimo', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'] },
    { name: 'Two Knights Defence', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Be7', 'O-O', 'O-O'] },
    { name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nc3', 'Bb4'] },
    { name: 'Petrov Defence', moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4', 'd4', 'd5'] },
    // ---- 1.e4, Black declines …e5 ----
    { name: 'Sicilian, Najdorf', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be2', 'e5'] },
    { name: 'Sicilian, Classical', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'd6'] },
    { name: 'French Defence', moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'Be7'] },
    { name: 'Caro-Kann, Classical', moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6'] },
    { name: 'Scandinavian Defence', moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6'] },
    // ---- 1.d4 (Queen's Pawn / Indian) ----
    { name: "Queen's Gambit Declined", moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O'] },
    { name: "Queen's Gambit Accepted", moves: ['d4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6', 'e3', 'e6', 'Bxc4', 'c5'] },
    { name: 'Slav Defence', moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5'] },
    { name: "King's Indian Defence", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O'] },
    { name: 'Nimzo-Indian Defence', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'O-O'] },
    { name: "Queen's Indian Defence", moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6', 'g3', 'Bb7', 'Bg2', 'Be7'] },
    { name: 'London System', moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'c5', 'c3', 'Nc6'] },
    // ---- flank openings ----
    { name: 'English, Reversed Sicilian', moves: ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'g3', 'd5', 'cxd5', 'Nxd5'] },
    { name: 'Réti Opening', moves: ['Nf3', 'd5', 'c4', 'e6', 'g3', 'Nf6', 'Bg2', 'Be7'] },
  ];

  // BOOK[posKey] = { san: weight }. Built lazily on first use (needs MG.Chess).
  let BOOK = null;

  function build() {
    BOOK = {};
    if (!MG.Chess) return BOOK;
    for (const line of LINES) {
      const g = new MG.Chess();
      for (const san of line.moves) {
        const key = g.posKey();
        const m = g.legalMoves().find((x) => g.toSAN(x) === san);
        if (!m) {
          // An authored SAN that the engine doesn't accept means the line and the
          // rules engine disagree — flag it loudly in dev and stop this line so a
          // bad token can never wedge the book or pick an illegal move.
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[OpeningBook] dropping unrecognized move "' + san + '" in ' + line.name);
          }
          break;
        }
        const slot = BOOK[key] || (BOOK[key] = {});
        slot[san] = (slot[san] || 0) + 1;
        g.move(m);
      }
    }
    return BOOK;
  }

  function book() { return BOOK || build(); }

  /* The book candidates legal in the current position: [{ move, san, weight }].
     Each authored SAN is re-matched against the live legal moves, so a candidate
     can never be illegal in the position it is offered for. */
  function candidates(game) {
    const slot = book()[game.posKey()];
    if (!slot) return [];
    const legal = game.legalMoves();
    const out = [];
    for (const san in slot) {
      const m = legal.find((x) => game.toSAN(x) === san);
      if (m) out.push({ move: m, san, weight: slot[san] });
    }
    return out;
  }

  /* How likely THIS persona is to play a book move while in book. Strong
     personas → high; weak → low, so the book doesn't flatten the ladder.
     Derived from the persona's rating when present (the ladder's own scale),
     else from search depth; legacy numeric levels map 0/1/2 → low/med/high. */
  function bookChance(profile) {
    if (profile == null) return 0.5;
    if (typeof profile === 'number') {
      return [0.12, 0.55, 0.9][Math.max(0, Math.min(2, profile | 0))];
    }
    let base;
    if (typeof profile.rating === 'number') {
      base = (profile.rating - 1100) / 900;          // ~1100 Elo → 0, ~2000 → 1
    } else {
      base = ((profile.depth || 2) - 1) / 3;         // depth 1 → 0, depth 4 → 1
    }
    base = Math.max(0, Math.min(1, base));
    return 0.08 + 0.88 * base;                        // weakest ≈ .08, strongest ≈ .96
  }

  /* Pick a book move for `profile` in the current position, or null to fall
     through to the engine. `rng` is injectable for tests. */
  function pickFor(game, profile, rng) {
    rng = rng || Math.random;
    const cands = candidates(game);
    if (!cands.length) return null;
    if (rng() >= bookChance(profile)) return null;   // this persona skips the book here
    let total = 0;
    for (const c of cands) total += c.weight;
    let r = rng() * total;
    for (const c of cands) { r -= c.weight; if (r <= 0) return c.move; }
    return cands[cands.length - 1].move;
  }

  MG.OpeningBook = {
    LINES, pickFor, candidates, bookChance,
    _build: build, _book: book,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MG.OpeningBook;
})();
