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

   SEARCH EFFICIENCY (v2.2): the search is now ITERATIVE-DEEPENING
   with a Zobrist-keyed TRANSPOSITION TABLE in negamax, so the
   deeper personas prune far more and convert their fixed node
   budget into stronger play WITHOUT changing their nominal depth
   (a depth-N persona still searches N plies — it just gets there
   more cheaply). The QUIESCENCE search keeps its historic fail-soft
   behaviour and is deliberately left TT-free, so the fail-hard
   mate-score bug noted in PROJECT_STATE cannot resurface.

   OPENING BOOK (v2.2): when js/opening_book.js is loaded, strong
   personas play a weighted-random book move while in book (variety
   + perceived strength); weak personas rarely do, so the ladder
   gradient is preserved. The book is consulted inside chooseMove.

   chooseMove / chooseMoveAsync accept either a profile object or
   a legacy numeric level (0 Student / 1 Performer / 2 Virtuoso),
   so older call-sites keep working. chooseMove takes an optional
   `opts` ({ tt, id, book }) used by the strength A/B harness to
   toggle each feature off; all default on.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});
  const V = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

  // Mate scoring + TT entry flags. The eval can never reach MATE_GUARD from
  // material/PST alone, so |score| >= MATE_GUARD reliably means "a mate score":
  // such scores are depth-sensitive, so they are never trusted from the TT.
  const MATE = 100000;
  const MATE_GUARD = 90000;
  const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

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
    tt: null,   // Map<hashLo, { hi, depth, score, flag, fromTo }> for the active search

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

    // Bring the TT's stored best move (packed from<<8|to) to the front of the
    // move list for a much sharper alpha-beta cutoff rate.
    _bringFront(moves, fromTo) {
      for (let i = 0; i < moves.length; i++) {
        if ((moves[i].from << 8 | moves[i].to) === fromTo) {
          if (i > 0) { const m = moves[i]; moves.splice(i, 1); moves.unshift(m); }
          return;
        }
      }
    },

    negamax(game, depth, alpha, beta, cfg) {
      this.nodes++;
      if (this.nodes > cfg.nodeCap) return this.evaluate(game);
      const alphaOrig = alpha;

      // --- transposition table probe ---
      let ttMove = 0;
      if (this.tt) {
        const e = this.tt.get(game.hashLo);
        if (e && e.hi === game.hashHi) {
          ttMove = e.fromTo;
          // Trust a stored bound only for non-mate scores at >= the needed depth.
          if (e.depth >= depth && Math.abs(e.score) < MATE_GUARD) {
            if (e.flag === TT_EXACT) return e.score;
            if (e.flag === TT_LOWER) { if (e.score > alpha) alpha = e.score; }
            else if (e.flag === TT_UPPER) { if (e.score < beta) beta = e.score; }
            if (alpha >= beta) return e.score;
          }
        }
      }

      const moves = game.legalMoves();
      if (!moves.length) {
        return game.inCheck() ? -MATE + (cfg.depth - depth) : 0;
      }
      if (game.halfmove >= 100) return 0;
      if (depth <= 0) {
        // Quiescence stays TT-free and fail-soft (see the header note).
        return cfg.quiesce ? this.quiescence(game, alpha, beta, cfg, 6) : this.evaluate(game);
      }
      this.orderMoves(moves);
      if (ttMove) this._bringFront(moves, ttMove);

      let best = -Infinity, bestMove = null;
      for (const m of moves) {
        game._apply(m);
        const score = -this.negamax(game, depth - 1, -beta, -alpha, cfg);
        game._unapply();
        if (score > best) { best = score; bestMove = m; }
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }

      // --- transposition table store (skip mate scores + over-budget nodes) ---
      if (this.tt && this.nodes <= cfg.nodeCap && Math.abs(best) < MATE_GUARD) {
        const flag = best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
        this.tt.set(game.hashLo, {
          hi: game.hashHi, depth, score: best, flag,
          fromTo: bestMove ? (bestMove.from << 8 | bestMove.to) : 0,
        });
      }
      return best;
    },

    /* One root sweep at a fixed depth. Mirrors the historic root window
       (full window for the side to move, narrowed per move) so the persona's
       blunder/noise character is unchanged; only the inner search got faster.
       `prevScored` (the previous iteration's result) seeds best-move-first
       ordering, which is most of iterative deepening's pruning win. */
    _searchRoot(game, depth, cfg, prevScored) {
      const ordered = prevScored.map((s) => s.m);
      const out = [];
      let alpha = -Infinity;
      for (const m of ordered) {
        game._apply(m);
        let score;
        if ((game.repCount[game.posKey()] || 0) >= 2) {
          score = 0;   // avoid walking into a threefold when we're choosing
        } else {
          score = -this.negamax(game, depth - 1, -Infinity, -alpha, cfg);
        }
        game._unapply();
        out.push({ m, score });
        if (score > alpha) alpha = score;
      }
      out.sort((a, b) => b.score - a.score);
      return out;
    },

    /* Returns the chosen move synchronously. `profile` is a persona profile
       object ({depth,blunder,noise,nodeCap?}) or a legacy numeric level.
       `opts` ({ tt, id, book }, all default true) lets the strength A/B harness
       disable a feature to measure its contribution. */
    chooseMove(game, profile, opts) {
      opts = opts || {};
      const cfg = normProfile(profile);

      // OPENING BOOK: a strong persona usually answers from book while in book;
      // a weak one rarely does (so it can't lean on theory it hasn't "learned").
      if (opts.book !== false && MG.OpeningBook) {
        const bm = MG.OpeningBook.pickFor(game, profile);
        if (bm) return bm;
      }

      game.computeHash();   // authoritative base hash, however the position was reached
      this.tt = opts.tt === false ? null : new Map();
      this.nodes = 0;
      const moves = game.legalMoves();
      if (!moves.length) return null;
      if (moves.length === 1) return moves[0];

      this.orderMoves(moves);
      // ITERATIVE DEEPENING: each pass reuses the TT + the previous ordering, so
      // the deepest (target) pass prunes hardest and the persona spends its node
      // budget where it counts. A persona still searches exactly cfg.depth plies
      // — nominal depth, and thus rated strength, is unchanged.
      let scored = moves.map((m) => ({ m, score: 0 }));
      const idOn = opts.id !== false && cfg.depth > 1;
      const dStart = idOn ? 1 : cfg.depth;
      for (let d = dStart; d <= cfg.depth; d++) {
        if (d > dStart && this.nodes > cfg.nodeCap) break;       // no budget for another pass
        const next = this._searchRoot(game, d, cfg, scored);
        if (d > dStart && this.nodes > cfg.nodeCap) break;       // pass truncated → keep the last clean one
        scored = next;
      }

      // Deliberate weakening (low ratings). Never throw away a forced mate:
      // mate-in-1 (99999) and mate-in-2 (99997) differ by single points, far
      // inside the noise band, so a winning persona still finishes the job.
      const mateOnBoard = scored[0].score > MATE_GUARD;
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
