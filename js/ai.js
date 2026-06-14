/* ============================================================
   Maestro's Gambit — ai.js
   Negamax + alpha-beta + quiescence chess AI with three
   difficulty levels:
     0 Student   — shallow, picks loosely among decent moves
     1 Performer — solid club-player tactics
     2 Virtuoso  — deeper search, quiescence, best move always
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});
  const V = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

  // Piece-square tables, from white's perspective (row 0 = rank 8).
  const PST = {
    P: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0,
    ],
    N: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    B: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    R: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0,
    ],
    Q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20,
    ],
    K: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20,
    ],
    Kend: [
      -50, -40, -30, -20, -20, -30, -40, -50,
      -30, -20, -10, 0, 0, -10, -20, -30,
      -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -30, 0, 0, 0, 0, -30, -30,
      -50, -30, -30, -30, -30, -30, -30, -50,
    ],
  };

  const DIFFS = [
    { depth: 2, quiesce: false, jitter: 70, blunder: 0.18, nodeCap: 40000 },
    { depth: 3, quiesce: true, jitter: 14, blunder: 0.0, nodeCap: 250000 },
    { depth: 4, quiesce: true, jitter: 0, blunder: 0.0, nodeCap: 1600000 },
  ];

  const AI = {
    nodes: 0,

    evaluate(game) {
      // From the perspective of side to move.
      let score = 0;
      let totalMat = 0;
      for (let i = 0; i < 64; i++) {
        const p = game.board[i];
        if (!p) continue;
        if (p.t !== 'K') totalMat += V[p.t];
      }
      const endgame = totalMat < 2600;
      for (let i = 0; i < 64; i++) {
        const p = game.board[i];
        if (!p) continue;
        const table = p.t === 'K' && endgame ? PST.Kend : PST[p.t];
        const pstIdx = p.c === 'w' ? i : 63 - i;
        const v = V[p.t] + table[pstIdx];
        score += p.c === game.turn ? v : -v;
      }
      // small mobility bonus
      return score;
    },

    orderMoves(moves) {
      return moves.sort((a, b) => {
        const sa = (a.capture ? 10 * V[a.capture] - V[a.piece] : 0) + (a.flags === 'promo' ? 800 : 0);
        const sb = (b.capture ? 10 * V[b.capture] - V[b.piece] : 0) + (b.flags === 'promo' ? 800 : 0);
        return sb - sa;
      });
    },

    quiescence(game, alpha, beta, cfg, depth) {
      this.nodes++;
      // fail-soft: always return real evaluations, never the bound itself,
      // so narrowed windows at the root can't masquerade as exact scores.
      const stand = this.evaluate(game);
      let best = stand;
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      if (depth <= 0 || this.nodes > cfg.nodeCap) return best;

      const caps = this.orderMoves(game.legalMoves().filter((m) => m.capture || m.flags === 'promo'));
      for (const m of caps) {
        game._apply(m);
        const score = -this.quiescence(game, -beta, -alpha, cfg, depth - 1);
        game._unapply();
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }
      return best;
    },

    negamax(game, depth, alpha, beta, cfg) {
      this.nodes++;
      if (this.nodes > cfg.nodeCap) return this.evaluate(game);
      const moves = game.legalMoves();
      if (!moves.length) {
        return game.inCheck() ? -100000 + (cfg.depth - depth) : 0;
      }
      if (game.halfmove >= 100) return 0;
      if (depth <= 0) {
        return cfg.quiesce ? this.quiescence(game, alpha, beta, cfg, 6) : this.evaluate(game);
      }
      this.orderMoves(moves);
      let best = -Infinity;
      for (const m of moves) {
        game._apply(m);
        const score = -this.negamax(game, depth - 1, -beta, -alpha, cfg);
        game._unapply();
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    },

    /* Returns the chosen move synchronously. */
    chooseMove(game, level) {
      const cfg = DIFFS[Math.max(0, Math.min(2, level))];
      this.nodes = 0;
      const moves = game.legalMoves();
      if (!moves.length) return null;
      if (moves.length === 1) return moves[0];

      this.orderMoves(moves);
      const scored = [];
      let alpha = -Infinity;
      for (const m of moves) {
        game._apply(m);
        // avoid simple threefold draws when winning
        let score;
        if ((game.repCount[game.posKey()] || 0) >= 2) {
          score = 0;
        } else {
          score = -this.negamax(game, cfg.depth - 1, -Infinity, -alpha, cfg);
        }
        game._unapply();
        scored.push({ m, score });
        if (score > alpha) alpha = score;
      }
      scored.sort((a, b) => b.score - a.score);

      // Student level: sometimes pick a clearly weaker move, and add jitter
      // so play feels human and beatable. Never randomize away a forced mate:
      // mate-in-1 (99999) and mate-in-2 (99997) differ by single points, well
      // inside the jitter band.
      const mateOnBoard = scored[0].score > 90000;
      if (cfg.jitter > 0 && !mateOnBoard) {
        for (const s of scored) s.score += (Math.random() * 2 - 1) * cfg.jitter;
        scored.sort((a, b) => b.score - a.score);
        if (Math.random() < cfg.blunder && scored.length > 2) {
          const pick = 1 + Math.floor(Math.random() * Math.min(3, scored.length - 1));
          return scored[pick].m;
        }
      }
      return scored[0].m;
    },

    /* Async wrapper so the UI can paint a "thinking" indicator first. */
    chooseMoveAsync(game, level, cb) {
      const minDelay = 450 + Math.random() * 500;
      const t0 = Date.now();
      setTimeout(() => {
        const m = this.chooseMove(game, level);
        const elapsed = Date.now() - t0;
        const wait = Math.max(0, minDelay - elapsed);
        setTimeout(() => cb(m), wait);
      }, 30);
    },
  };

  MG.AI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})();
