/* ============================================================
   Maestro's Gambit — ai.js
   Negamax + alpha-beta + quiescence chess AI driven by a
   STRENGTH PROFILE rather than a fixed handful of levels.

   A profile = { depth, blunder, noise, nodeCap? } (the persona
   fields in js/opponents.js):
     depth    plies of full-width search (1 = barely tactical).
     blunder  per-move chance of playing a non-best legal move.
     noise    points of random eval jitter (humanises play).
     nodeCap  optional search-node ceiling (defaults by depth).
   Quiescence is enabled automatically at depth >= 3, so weak
   personas genuinely hang pieces (they never see the recapture)
   while strong ones do not.

   chooseMove / chooseMoveAsync accept either a profile object or
   a legacy numeric level (0 Student / 1 Performer / 2 Virtuoso),
   so older call-sites keep working.
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

  // Legacy three-level table, kept so a bare numeric level still works
  // (the roster's personas now carry their own profiles instead).
  const LEGACY = [
    { depth: 2, blunder: 0.18, noise: 70, nodeCap: 40000 },    // 0 Student
    { depth: 3, blunder: 0.0, noise: 14, nodeCap: 250000 },    // 1 Performer
    { depth: 4, blunder: 0.0, noise: 0, nodeCap: 1600000 },    // 2 Virtuoso
  ];

  // Normalise a persona profile (or a legacy numeric level) into the internal
  // search config. Maps the public `noise` field onto the engine's `jitter`,
  // derives quiescence from depth, and fills a sensible node cap.
  function normProfile(p) {
    if (p == null) p = 1;
    if (typeof p === 'number') p = LEGACY[Math.max(0, Math.min(2, p | 0))];
    const depth = Math.max(1, p.depth || 2);
    return {
      depth,
      quiesce: p.quiesce != null ? p.quiesce : depth >= 3,
      jitter: p.noise != null ? p.noise : (p.jitter || 0),
      blunder: p.blunder || 0,
      nodeCap: p.nodeCap || (depth >= 4 ? 1600000 : depth >= 3 ? 400000 : 80000),
    };
  }

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

    /* Returns the chosen move synchronously. `profile` is a persona profile
       object ({depth,blunder,noise,nodeCap?}) or a legacy numeric level. */
    chooseMove(game, profile) {
      const cfg = normProfile(profile);
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

      // Deliberate weakening (low ratings). Never throw away a forced mate:
      // mate-in-1 (99999) and mate-in-2 (99997) differ by single points, far
      // inside the noise band, so a winning persona still finishes the job.
      const mateOnBoard = scored[0].score > 90000;
      if (mateOnBoard) return scored[0].m;

      // (1) BLUNDER: a flat chance to abandon the best move and play a random
      //     *other* legal move — this is what makes weak personas hang pieces.
      if (cfg.blunder > 0 && scored.length > 1 && Math.random() < cfg.blunder) {
        return scored[1 + Math.floor(Math.random() * (scored.length - 1))].m;
      }
      // (2) NOISE: eval jitter so even non-blundering play feels human, and the
      //     persona doesn't always find the single objectively-best reply.
      if (cfg.jitter > 0) {
        for (const s of scored) s.score += (Math.random() * 2 - 1) * cfg.jitter;
        scored.sort((a, b) => b.score - a.score);
      }
      return scored[0].m;
    },

    /* Async wrapper so the UI can paint a "thinking" indicator first. */
    chooseMoveAsync(game, profile, cb) {
      const minDelay = 450 + Math.random() * 500;
      const t0 = Date.now();
      setTimeout(() => {
        const m = this.chooseMove(game, profile);
        const elapsed = Date.now() - t0;
        const wait = Math.max(0, minDelay - elapsed);
        setTimeout(() => cb(m), wait);
      }, 30);
    },
  };

  MG.AI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})();
