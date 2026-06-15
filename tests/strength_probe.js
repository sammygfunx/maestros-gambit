/* ============================================================
   Maestro's Gambit — strength_probe.js  (informational, not a gate)
   Two sanity probes for the v2.2 engine work:

   (1) POISONED-CAPTURE GRADIENT — a position where grabbing a pawn with
       the queen hangs the queen to a recapture. A shallow (depth-1)
       persona can't see the recapture and grabs it; a deep one never does.
       This is the same idea as the v1.8 probe and confirms the strength
       ladder still has a real gradient after the TT/ID/book changes.

   (2) BUDGET A/B (does the TT+ID actually make a persona stronger within
       its node budget?) — the SAME deterministic profile plays itself with
       the new search (TT + iterative deepening) vs the old one (single
       fixed-depth pass), both capped at the SAME node budget, over many
       games seeded with random openings for variety. If the new search is
       a genuine efficiency win, it should score above 50%.

   Run: node tests/strength_probe.js
   ============================================================ */
require('../js/chess.js');
require('../js/ai.js');
require('../js/opponents.js');
const MG = globalThis.MG;
const AI = MG.AI;
const V = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

/* ---------------- (1) poisoned-capture gradient ---------------- */
// White to move. Qd2xd5 wins a pawn but hangs the queen to …cxd5 / …exd5.
// Extra knights give both sides plenty of quiet alternatives, so a deep
// persona's rare blunder rarely lands on this one losing capture.
const POISON_FEN = '4k1n1/1n6/2p1p3/3p4/8/5N2/3Q1N2/4K3 w - - 0 1';
const POISON_SAN = 'Qxd5';
const TRIES = 400;

console.log('— (1) poisoned-capture gradient (' + TRIES + ' tries/persona) —');
console.log('     position:', POISON_FEN);
console.log('     a persona that plays ' + POISON_SAN + ' has hung its queen.\n');
console.log('     persona            rating  depth  blunder   hangs-queen');
let gradientOk = true;
for (const o of MG.Opponents.ROSTER) {
  let hung = 0;
  for (let i = 0; i < TRIES; i++) {
    const g = new MG.Chess().loadFEN(POISON_FEN);
    const m = AI.chooseMove(g, o, { book: false });
    if (m && g.toSAN(m) === POISON_SAN) hung++;
  }
  const pct = (100 * hung / TRIES);
  // honesty invariant: the no-blunder top personas (depth 4) must NEVER hang.
  if (o.blunder === 0 && hung > 0) gradientOk = false;
  console.log('     ' + o.name.padEnd(18) + String(o.rating).padStart(4) + '    ' +
    o.depth + '      ' + o.blunder.toFixed(3) + '      ' + pct.toFixed(1).padStart(5) + '%');
}
console.log('\n     gradient verdict: ' + (gradientOk
  ? 'OK — weak personas hang the queen, the no-blunder summit never does.'
  : 'BROKEN — a no-blunder persona hung its queen!'));

/* ---------------- (2) budget A/B: TT+ID vs single-pass ---------------- */
function material(g) {
  let s = 0;
  for (let i = 0; i < 64; i++) { const p = g.board[i]; if (p) s += (p.c === 'w' ? 1 : -1) * V[p.t]; }
  return s; // + favours white
}
function randomOpening(plies, rng) {
  const g = new MG.Chess();
  for (let i = 0; i < plies; i++) {
    const ms = g.legalMoves();
    if (!ms.length) break;
    g.move(ms[(rng() * ms.length) | 0]);
  }
  return g;
}
// A small seeded RNG so the A/B is reproducible run-to-run.
function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// One game: white & black each use the given opts; returns +1/0/-1 from white's view.
function playGame(g, whiteOpts, blackOpts, profile) {
  const MAX = 140;
  for (let ply = 0; ply < MAX; ply++) {
    const st = g.status();
    if (st === 'checkmate') return g.turn === 'w' ? -1 : 1;   // side to move is mated
    if (st !== 'active') return 0;                            // stalemate / draw
    const opts = (g.turn === 'w' ? whiteOpts : blackOpts);
    const m = AI.chooseMove(g, profile, opts);
    if (!m) return 0;
    g.move(m);
  }
  const mat = material(g);
  return Math.abs(mat) < 150 ? 0 : (mat > 0 ? 1 : -1);        // adjudicate ≈ ±1.5 pawns
}

const GAMES = 30;
const profile = { depth: 4, blunder: 0, noise: 0, nodeCap: 12000 };  // tight budget → efficiency matters
const NEW = { tt: true, id: true, book: false };
const OLD = { tt: false, id: false, book: false };
const rng = mulberry32(0x9e3779b9);

console.log('\n— (2) budget A/B: new search (TT+ID) vs old (single fixed-depth pass) —');
console.log('     ' + GAMES + ' games, depth ' + profile.depth + ', node cap ' + profile.nodeCap +
  ' (same for both), random 4-ply openings, colours swapped each game.\n');
let nWin = 0, draw = 0, oWin = 0;
for (let i = 0; i < GAMES; i++) {
  const open = randomOpening(4, rng);
  // clone the opened position for a fair, identical start
  const g = new MG.Chess().loadFEN(open.fen());
  const newIsWhite = (i % 2 === 0);
  const r = playGame(g, newIsWhite ? NEW : OLD, newIsWhite ? OLD : NEW, profile);
  const newResult = newIsWhite ? r : -r;   // +1 new won, 0 draw, -1 old won
  if (newResult > 0) nWin++; else if (newResult < 0) oWin++; else draw++;
}
const score = (nWin + 0.5 * draw) / GAMES;
console.log('     NEW(TT+ID) wins: ' + nWin + '   draws: ' + draw + '   OLD wins: ' + oWin);
console.log('     NEW score: ' + (100 * score).toFixed(1) + '%  (>50% ⇒ the TT+ID converts the same budget into stronger play)');
console.log('\n     A/B verdict: ' + (score > 0.5
  ? 'NEW search is stronger within the same node budget.'
  : (score === 0.5 ? 'even (try a tighter budget / more games).' : 'NEW not stronger here — investigate.')));
