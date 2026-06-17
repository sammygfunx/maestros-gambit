/* ============================================================
   Maestro's Gambit — puzzles.js  (MG.Puzzles)
   A small curated set of training positions, each defined by a FEN
   (loaded via MG.Chess.loadFEN). Two kinds:
     kind 'mate' — force checkmate in `mateIn` moves.
     kind 'win'  — win material with a short forcing tactic.

   Each puzzle:
     { id, title, kind, mateIn?, fen, sideToMove, solutionSANs[], blurb }
   solutionSANs is the canonical line: the solver's moves at even indices,
   the (representative) opponent replies at odd indices. For 'mate' puzzles
   every opponent reply in the line is forced; for 'win' puzzles the live
   opponent is engine-driven and *every* legal reply still loses the
   material (the line just shows one defence).

   Every position here is verified: legal (the side not to move is not in
   check), its FEN round-trips, and the solution forces the stated result.
   Pure data — no DOM — so it can be require()'d under Node.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});

  const PUZZLES = [
    {
      id: 'backrank', title: 'The Closed Curtain', kind: 'mate', mateIn: 1,
      fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', sideToMove: 'w',
      solutionSANs: ['Re8#'],
      blurb: 'The conductor is boxed in by his own pawns. One percussionist ends the show.',
    },
    {
      id: 'guarded-queen', title: 'Pianist, Protected', kind: 'mate', mateIn: 1,
      fen: '7k/8/8/5N2/8/8/6Q1/K7 w - - 0 1', sideToMove: 'w',
      solutionSANs: ['Qg7#'],
      blurb: 'Step the pianist beside the king — the cellist guards her landing.',
    },
    {
      id: 'two-rooks', title: 'Twin Percussion', kind: 'mate', mateIn: 1,
      fen: '7k/R7/8/8/8/8/8/1R4K1 w - - 0 1', sideToMove: 'w',
      solutionSANs: ['Rb8#'],
      blurb: 'One percussionist seals the seventh rank. The other delivers the downbeat.',
    },
    {
      id: 'black-backrank', title: 'Ebony Answers', kind: 'mate', mateIn: 1,
      fen: '4r1k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', sideToMove: 'b',
      solutionSANs: ['Re1#'],
      blurb: 'Now Ebony holds the baton — mate the Ivory conductor on the back rank.',
    },
    {
      id: 'royal-escort', title: 'The Maestro Escorts', kind: 'mate', mateIn: 2,
      fen: '7k/8/5K2/8/8/8/8/3Q4 w - - 0 1', sideToMove: 'w',
      solutionSANs: ['Kf7', 'Kh7', 'Qh1#'],
      blurb: 'A quiet step by the conductor, and the pianist strikes the final chord.',
    },
    {
      id: 'rook-roller', title: 'Rolling Timpani', kind: 'mate', mateIn: 3,
      fen: '7k/8/8/8/8/8/5R2/4R1K1 w - - 0 1', sideToMove: 'w',
      solutionSANs: ['Rf7', 'Kg8', 'Ree7', 'Kh8', 'Re8#'],
      blurb: 'Two percussionists walk the king to the edge of the stage, rank by rank.',
    },
    {
      id: 'knight-fork', title: 'A Forking Cadence', kind: 'win',
      fen: 'q3k3/7p/8/3N4/8/8/8/4K3 w - - 0 1', sideToMove: 'w',
      solutionSANs: ['Nc7+', 'Kd8', 'Nxa8'],
      blurb: 'The cellist leaps with check and a second target — win the rival pianist.',
    },
    {
      id: 'bishop-skewer', title: 'Clarinet Skewer', kind: 'win',
      fen: 'r7/7p/2k5/8/8/3B4/8/6K1 w - - 0 1', sideToMove: 'w',
      solutionSANs: ['Be4+', 'Kc7', 'Bxa8'],
      blurb: 'Check the conductor along the diagonal; the percussionist behind him falls.',
    },
  ];

  const BY_ID = {};
  for (const p of PUZZLES) BY_ID[p.id] = p;

  function objective(p) {
    if (p.kind === 'mate') return p.mateIn === 1 ? 'Mate in 1' : 'Mate in ' + p.mateIn;
    return 'Win material';
  }

  MG.Puzzles = {
    LIST: PUZZLES,
    get(id) { return BY_ID[id] || null; },
    has(id) { return !!BY_ID[id]; },
    indexOf(id) { return PUZZLES.findIndex((p) => p.id === id); },
    objective,
    sideName(p) { return p.sideToMove === 'w' ? 'Ivory' : 'Ebony'; },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MG.Puzzles;
})();
