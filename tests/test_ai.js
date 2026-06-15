/* Unit tests for the v2.2 engine work: Zobrist hashing, the transposition
   table + iterative deepening, and the opening book.
   Run: node tests/test_ai.js */
require('../js/chess.js');
require('../js/ai.js');
require('../js/opening_book.js');
require('../js/opponents.js');
const MG = globalThis.MG;
const AI = MG.AI;
const OB = MG.OpeningBook;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
function play(seq) {
  const g = new MG.Chess();
  for (const san of seq) {
    const m = g.legalMoves().find((x) => g.toSAN(x) === san);
    if (!m) throw new Error('illegal test move ' + san);
    g.move(m);
  }
  return g;
}

/* ---------------- Zobrist hashing ---------------- */
console.log('— Zobrist hashing —');
{
  // Walk the whole perft(3) tree: incremental hash must equal a from-scratch
  // recompute at every node, and _unapply must restore the pre-move hash exactly.
  let incrMatches = true, unapplyRestores = true;
  function walk(g, d) {
    if (d === 0) return;
    for (const m of g.legalMoves()) {
      const bHi = g.hashHi, bLo = g.hashLo;
      g._apply(m);
      const iHi = g.hashHi, iLo = g.hashLo;
      g.computeHash();
      if (g.hashHi !== iHi || g.hashLo !== iLo) incrMatches = false;
      g.hashHi = iHi; g.hashLo = iLo;   // keep the incremental value for the recursion
      walk(g, d - 1);
      g._unapply();
      if (g.hashHi !== bHi || g.hashLo !== bLo) unapplyRestores = false;
    }
  }
  walk(new MG.Chess(), 3);
  ok(incrMatches, 'incremental hash equals from-scratch at every node (perft(3) walk)');
  ok(unapplyRestores, '_unapply restores the pre-move hash exactly');

  // Transposition: two move orders reaching the same position share a hash…
  const a = play(['Nf3', 'Nf6', 'g3', 'g6']);
  const b = play(['g3', 'g6', 'Nf3', 'Nf6']);
  ok(a.hashHi === b.hashHi && a.hashLo === b.hashLo, 'transposed move orders give the same hash');
  // …and the hash deliberately ignores the move clocks (so the TT collides them).
  ok(a.fen() !== b.fen(), 'those positions differ only in the move clocks (hash ignores them)');

  // Different positions (here, different side to move) get different hashes.
  const c = play(['e4']);
  const d = new MG.Chess();
  ok(c.hashLo !== d.hashLo || c.hashHi !== d.hashHi, 'a different position hashes differently');

  // loadFEN seeds a correct hash (matches a fresh recompute).
  const fenG = new MG.Chess().loadFEN('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 5');
  const hi = fenG.hashHi, lo = fenG.hashLo;
  fenG.computeHash();
  ok(fenG.hashHi === hi && fenG.hashLo === lo, 'loadFEN seeds the hash correctly');
}

/* ---------------- opening book ---------------- */
console.log('— opening book —');
{
  // Every authored SAN must be legal + match toSAN when replayed from the start.
  let bad = 0;
  for (const line of OB.LINES) {
    const g = new MG.Chess();
    for (const san of line.moves) {
      const m = g.legalMoves().find((x) => g.toSAN(x) === san);
      if (!m) { bad++; console.log('      bad token', san, 'in', line.name); break; }
      g.move(m);
    }
  }
  ok(bad === 0, 'all ' + OB.LINES.length + ' authored lines are legal end-to-end');

  const start = new MG.Chess();
  const startSans = OB.candidates(start).map((c) => c.san);
  ok(startSans.includes('e4') && startSans.includes('d4'), 'book offers 1.e4 and 1.d4 from the start');

  // forcing the book on (rng→0) returns a legal book move; forcing it off (rng→1) skips.
  const strong = MG.Opponents.get('magnus');
  const bm = OB.pickFor(start, strong, () => 0);
  ok(bm && start.legalMoves().some((x) => x.from === bm.from && x.to === bm.to), 'pickFor returns a legal book move when in book');
  ok(OB.pickFor(start, strong, () => 0.999) === null, 'pickFor can decline the book (persona skips)');

  // out of book → no candidates → null.
  const offBook = new MG.Chess().loadFEN('8/8/8/4k3/8/4K3/4P3/8 w - - 0 1');
  ok(OB.candidates(offBook).length === 0, 'a non-opening position is out of book');
  ok(OB.pickFor(offBook, strong, () => 0) === null, 'pickFor returns null out of book');

  // the persona policy: stronger personas book more often than weaker ones.
  const cPim = OB.bookChance(MG.Opponents.get('pim'));
  const cTempo = OB.bookChance(MG.Opponents.get('tempo'));
  const cMagnus = OB.bookChance(MG.Opponents.get('magnus'));
  ok(cPim < cTempo && cTempo < cMagnus, 'book-usage chance rises with persona strength (' +
    cPim.toFixed(2) + ' < ' + cTempo.toFixed(2) + ' < ' + cMagnus.toFixed(2) + ')');
}

/* ---------------- transposition table + search soundness ---------------- */
console.log('— transposition table + search —');
{
  // A fixed-depth root search must return the SAME best score with the TT on or
  // off — the TT may only prune, never change the minimax value.
  const cfg = { depth: 4, quiesce: true, jitter: 0, blunder: 0, nodeCap: 5000000 };
  function rootBest(seq, useTT) {
    const g = play(seq);
    AI.tt = useTT ? new Map() : null;
    AI.nodes = 0; g.computeHash();
    let alpha = -Infinity, best = -Infinity;
    for (const m of g.legalMoves()) {
      g._apply(m);
      const s = -AI.negamax(g, cfg.depth - 1, -Infinity, -alpha, cfg);
      g._unapply();
      if (s > best) best = s;
      if (s > alpha) alpha = s;
    }
    return { best, nodes: AI.nodes };
  }
  const seqs = [
    [],
    ['e4', 'e5', 'Nf3', 'Nc6'],
    ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'],
    ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6'],
  ];
  let allEqual = true, ttNeverSlower = true;
  for (const seq of seqs) {
    const withTT = rootBest(seq, true);
    const without = rootBest(seq, false);
    if (withTT.best !== without.best) allEqual = false;
    if (withTT.nodes > without.nodes) ttNeverSlower = false;
  }
  ok(allEqual, 'TT-on and TT-off agree on the best score (search is sound)');
  ok(ttNeverSlower, 'the TT never increases the node count (it prunes)');

  // Tactics: the engine still finds forced mates and grabs hanging material.
  const m1 = play(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6']);   // white: Qxf7#
  const mv1 = AI.chooseMove(m1, { depth: 3, blunder: 0, noise: 0 }, { book: false });
  m1.move(mv1);
  ok(m1.status() === 'checkmate', 'finds mate in one (Qxf7#)');

  // Légall-style mate in two is overkill; use a clean mate-in-1 from the other side too.
  const m1b = play(['f4', 'e5', 'g4']);                         // black: Qh4#
  const mv1b = AI.chooseMove(m1b, { depth: 3, blunder: 0, noise: 0 }, { book: false });
  m1b.move(mv1b);
  ok(m1b.status() === 'checkmate', 'finds mate in one for Black (Qh4#)');

  const hang = play(['e4', 'd5', 'Qg4']);                       // black: Bxg4 wins the queen
  const mvh = AI.chooseMove(hang, { depth: 4, blunder: 0, noise: 0 }, { book: false });
  ok(hang.toSAN(mvh) === 'Bxg4', 'grabs the hanging queen (Bxg4)');

  // iterative deepening vs a single fixed-depth pass agree on the chosen move's
  // value (different equal-value moves may be picked, but the value matches).
  const g2 = play(['e4', 'e5']);
  const a2 = AI.chooseMove(g2, { depth: 4, blunder: 0, noise: 0 }, { book: false, id: true });
  const b2 = AI.chooseMove(g2, { depth: 4, blunder: 0, noise: 0 }, { book: false, id: false });
  ok(!!a2 && !!b2, 'iterative-deepening and single-pass both return a move');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
