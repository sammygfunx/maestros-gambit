/* ============================================================
   Maestro's Gambit — chess.js
   Complete chess rules engine. No rendering, no dependencies.
   Squares are indices 0..63; index = row*8 + col.
   Row 0 is rank 8 (Obsidian/black home row); white moves toward row 0.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});

  const PIECE_VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
  const FILES = 'abcdefgh';

  function sqName(i) { return FILES[i % 8] + (8 - Math.floor(i / 8)); }
  function rc(i) { return [Math.floor(i / 8), i % 8]; }
  function idx(r, c) { return r * 8 + c; }
  function onBoard(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  class Chess {
    constructor() { this.reset(); }

    reset() {
      this.board = new Array(64).fill(null);
      const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
      for (let c = 0; c < 8; c++) {
        this.board[idx(0, c)] = { t: back[c], c: 'b' };
        this.board[idx(1, c)] = { t: 'P', c: 'b' };
        this.board[idx(6, c)] = { t: 'P', c: 'w' };
        this.board[idx(7, c)] = { t: back[c], c: 'w' };
      }
      this.turn = 'w';
      this.castling = { wK: true, wQ: true, bK: true, bQ: true };
      this.ep = -1;               // en-passant target square or -1
      this.halfmove = 0;
      this.fullmove = 1;
      this.history = [];          // undo stack
      this.sanHistory = [];       // notation per ply
      this.repCount = {};
      this._bumpRep();
    }

    /* ---------- position keys / repetition ---------- */
    posKey() {
      let s = this.turn + '|' + this.ep + '|' +
        (this.castling.wK ? 'K' : '') + (this.castling.wQ ? 'Q' : '') +
        (this.castling.bK ? 'k' : '') + (this.castling.bQ ? 'q' : '') + '|';
      for (let i = 0; i < 64; i++) {
        const p = this.board[i];
        s += p ? (p.c === 'w' ? p.t : p.t.toLowerCase()) : '.';
      }
      return s;
    }
    _bumpRep(d = 1) {
      const k = this.posKey();
      this.repCount[k] = (this.repCount[k] || 0) + d;
      if (this.repCount[k] <= 0) delete this.repCount[k];
      return this.repCount[k] || 0;
    }

    /* ---------- attack detection ---------- */
    attacked(sq, byColor) {
      const [r, c] = rc(sq);
      // pawns
      const dr = byColor === 'w' ? 1 : -1; // a white pawn on (r+1) attacks (r)
      for (const dc of [-1, 1]) {
        if (onBoard(r + dr, c + dc)) {
          const p = this.board[idx(r + dr, c + dc)];
          if (p && p.c === byColor && p.t === 'P') return true;
        }
      }
      // knights
      for (const [a, b] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
        if (onBoard(r + a, c + b)) {
          const p = this.board[idx(r + a, c + b)];
          if (p && p.c === byColor && p.t === 'N') return true;
        }
      }
      // king
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        if (!a && !b) continue;
        if (onBoard(r + a, c + b)) {
          const p = this.board[idx(r + a, c + b)];
          if (p && p.c === byColor && p.t === 'K') return true;
        }
      }
      // sliders
      const lines = [
        [[-1, 0], [1, 0], [0, -1], [0, 1], 'RQ'],
        [[-1, -1], [-1, 1], [1, -1], [1, 1], 'BQ'],
      ];
      for (const line of lines) {
        const types = line[4];
        for (let d = 0; d < 4; d++) {
          const [a, b] = line[d];
          let rr = r + a, cc = c + b;
          while (onBoard(rr, cc)) {
            const p = this.board[idx(rr, cc)];
            if (p) {
              if (p.c === byColor && types.includes(p.t)) return true;
              break;
            }
            rr += a; cc += b;
          }
        }
      }
      return false;
    }

    kingSq(color) {
      for (let i = 0; i < 64; i++) {
        const p = this.board[i];
        if (p && p.t === 'K' && p.c === color) return i;
      }
      return -1;
    }

    inCheck(color = this.turn) {
      return this.attacked(this.kingSq(color), color === 'w' ? 'b' : 'w');
    }

    /* ---------- move generation ---------- */
    pseudoMoves(color = this.turn) {
      const moves = [];
      const fwd = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      const lastRow = color === 'w' ? 0 : 7;

      for (let i = 0; i < 64; i++) {
        const p = this.board[i];
        if (!p || p.c !== color) continue;
        const [r, c] = rc(i);

        if (p.t === 'P') {
          const addPawn = (to, capture, flags) => {
            const [tr] = rc(to);
            if (tr === lastRow) {
              for (const promo of ['Q', 'R', 'B', 'N']) {
                moves.push({ from: i, to, piece: 'P', capture, flags: 'promo', promo });
              }
            } else {
              moves.push({ from: i, to, piece: 'P', capture, flags });
            }
          };
          // pushes
          if (onBoard(r + fwd, c) && !this.board[idx(r + fwd, c)]) {
            addPawn(idx(r + fwd, c), null, null);
            if (r === startRow && !this.board[idx(r + 2 * fwd, c)]) {
              moves.push({ from: i, to: idx(r + 2 * fwd, c), piece: 'P', capture: null, flags: 'double' });
            }
          }
          // captures
          for (const dc of [-1, 1]) {
            if (!onBoard(r + fwd, c + dc)) continue;
            const to = idx(r + fwd, c + dc);
            const q = this.board[to];
            if (q && q.c !== color) addPawn(to, q.t, null);
            else if (to === this.ep) {
              moves.push({ from: i, to, piece: 'P', capture: 'P', flags: 'ep' });
            }
          }
        } else if (p.t === 'N') {
          for (const [a, b] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
            if (!onBoard(r + a, c + b)) continue;
            const to = idx(r + a, c + b);
            const q = this.board[to];
            if (!q || q.c !== color) moves.push({ from: i, to, piece: 'N', capture: q ? q.t : null, flags: null });
          }
        } else if (p.t === 'K') {
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
            if (!a && !b) continue;
            if (!onBoard(r + a, c + b)) continue;
            const to = idx(r + a, c + b);
            const q = this.board[to];
            if (!q || q.c !== color) moves.push({ from: i, to, piece: 'K', capture: q ? q.t : null, flags: null });
          }
          // castling
          const home = color === 'w' ? 7 : 0;
          const enemy = color === 'w' ? 'b' : 'w';
          if (r === home && c === 4 && !this.attacked(i, enemy)) {
            const rights = this.castling;
            const kSide = color === 'w' ? rights.wK : rights.bK;
            const qSide = color === 'w' ? rights.wQ : rights.bQ;
            if (kSide && !this.board[idx(home, 5)] && !this.board[idx(home, 6)] &&
                !this.attacked(idx(home, 5), enemy) && !this.attacked(idx(home, 6), enemy)) {
              const rook = this.board[idx(home, 7)];
              if (rook && rook.t === 'R' && rook.c === color) {
                moves.push({ from: i, to: idx(home, 6), piece: 'K', capture: null, flags: 'castleK' });
              }
            }
            if (qSide && !this.board[idx(home, 3)] && !this.board[idx(home, 2)] && !this.board[idx(home, 1)] &&
                !this.attacked(idx(home, 3), enemy) && !this.attacked(idx(home, 2), enemy)) {
              const rook = this.board[idx(home, 0)];
              if (rook && rook.t === 'R' && rook.c === color) {
                moves.push({ from: i, to: idx(home, 2), piece: 'K', capture: null, flags: 'castleQ' });
              }
            }
          }
        } else {
          const dirs = p.t === 'R' ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
            : p.t === 'B' ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
            : [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
          for (const [a, b] of dirs) {
            let rr = r + a, cc = c + b;
            while (onBoard(rr, cc)) {
              const to = idx(rr, cc);
              const q = this.board[to];
              if (!q) {
                moves.push({ from: i, to, piece: p.t, capture: null, flags: null });
              } else {
                if (q.c !== color) moves.push({ from: i, to, piece: p.t, capture: q.t, flags: null });
                break;
              }
              rr += a; cc += b;
            }
          }
        }
      }
      return moves;
    }

    legalMoves(color = this.turn) {
      const out = [];
      for (const m of this.pseudoMoves(color)) {
        this._apply(m);
        if (!this.inCheck(color)) out.push(m);
        this._unapply();
      }
      return out;
    }

    legalMovesFrom(sq) {
      return this.legalMoves().filter((m) => m.from === sq);
    }

    /* ---------- make / undo ---------- */
    _apply(m) {
      const undo = {
        m,
        moved: this.board[m.from],
        taken: this.board[m.to],
        ep: this.ep,
        castling: { ...this.castling },
        halfmove: this.halfmove,
        fullmove: this.fullmove,
        epTaken: null,
      };
      const p = this.board[m.from];
      this.board[m.from] = null;

      if (m.flags === 'ep') {
        const capSq = m.to + (p.c === 'w' ? 8 : -8);
        undo.epTaken = { sq: capSq, piece: this.board[capSq] };
        this.board[capSq] = null;
      }
      this.board[m.to] = m.flags === 'promo' ? { t: m.promo, c: p.c } : p;

      if (m.flags === 'castleK' || m.flags === 'castleQ') {
        const home = p.c === 'w' ? 7 : 0;
        const [rf, rt] = m.flags === 'castleK' ? [idx(home, 7), idx(home, 5)] : [idx(home, 0), idx(home, 3)];
        this.board[rt] = this.board[rf];
        this.board[rf] = null;
      }

      // castling rights
      const cz = this.castling;
      if (p.t === 'K') { if (p.c === 'w') { cz.wK = cz.wQ = false; } else { cz.bK = cz.bQ = false; } }
      if (m.from === 56 || m.to === 56) cz.wQ = false;
      if (m.from === 63 || m.to === 63) cz.wK = false;
      if (m.from === 0 || m.to === 0) cz.bQ = false;
      if (m.from === 7 || m.to === 7) cz.bK = false;

      this.ep = m.flags === 'double' ? (m.from + m.to) / 2 : -1;
      this.halfmove = (m.piece === 'P' || m.capture) ? 0 : this.halfmove + 1;
      if (this.turn === 'b') this.fullmove++;
      this.turn = this.turn === 'w' ? 'b' : 'w';
      this.history.push(undo);
    }

    _unapply() {
      const u = this.history.pop();
      const m = u.m;
      this.turn = this.turn === 'w' ? 'b' : 'w';
      this.board[m.from] = u.moved;
      this.board[m.to] = u.taken;
      if (u.epTaken) this.board[u.epTaken.sq] = u.epTaken.piece;
      if (m.flags === 'castleK' || m.flags === 'castleQ') {
        const home = u.moved.c === 'w' ? 7 : 0;
        const [rf, rt] = m.flags === 'castleK' ? [idx(home, 7), idx(home, 5)] : [idx(home, 0), idx(home, 3)];
        this.board[rf] = this.board[rt];
        this.board[rt] = null;
      }
      this.ep = u.ep;
      this.castling = u.castling;
      this.halfmove = u.halfmove;
      this.fullmove = u.fullmove;
    }

    /* Public move: applies, records SAN + repetition. */
    move(m) {
      const san = this.toSAN(m);
      this._apply(m);
      this._bumpRep();
      this.sanHistory.push(san + (this.status() === 'checkmate' ? '#' : this.inCheck() ? '+' : ''));
      return san;
    }

    undo() {
      if (!this.history.length) return null;
      this._bumpRep(-1);
      this.sanHistory.pop();
      const m = this.history[this.history.length - 1].m;
      this._unapply();
      return m;
    }

    /* ---------- status ---------- */
    status() {
      const moves = this.legalMoves();
      if (!moves.length) return this.inCheck() ? 'checkmate' : 'stalemate';
      if (this.halfmove >= 100) return 'draw50';
      if ((this.repCount[this.posKey()] || 0) >= 3) return 'draw3';
      if (this._insufficient()) return 'drawMat';
      return 'active';
    }

    _insufficient() {
      const minor = [];
      for (let i = 0; i < 64; i++) {
        const p = this.board[i];
        if (!p || p.t === 'K') continue;
        if (p.t === 'P' || p.t === 'R' || p.t === 'Q') return false;
        minor.push({ ...p, sq: i });
      }
      if (minor.length <= 1) return true;
      if (minor.length === 2 && minor[0].t === 'B' && minor[1].t === 'B' && minor[0].c !== minor[1].c) {
        const shade = (s) => (Math.floor(s / 8) + s % 8) % 2;
        return shade(minor[0].sq) === shade(minor[1].sq);
      }
      return false;
    }

    /* ---------- notation ---------- */
    toSAN(m) {
      if (m.flags === 'castleK') return 'O-O';
      if (m.flags === 'castleQ') return 'O-O-O';
      let s = '';
      if (m.piece !== 'P') {
        s += m.piece;
        // disambiguation
        const others = this.legalMoves().filter(
          (x) => x.piece === m.piece && x.to === m.to && x.from !== m.from
        );
        if (others.length) {
          const [fr, fc] = rc(m.from);
          const sameFile = others.some((x) => rc(x.from)[1] === fc);
          const sameRank = others.some((x) => rc(x.from)[0] === fr);
          if (!sameFile) s += FILES[fc];
          else if (!sameRank) s += (8 - fr);
          else s += sqName(m.from);
        }
      } else if (m.capture) {
        s += FILES[m.from % 8];
      }
      if (m.capture) s += 'x';
      s += sqName(m.to);
      if (m.flags === 'promo') s += '=' + m.promo;
      return s;
    }

    /* ---------- FEN (Forsyth–Edwards Notation) ----------
       Minimal but complete loader/exporter so positions (e.g. puzzles) can be
       defined by FEN. Parses piece placement, side to move, castling rights,
       the en-passant target, and the halfmove/fullmove clocks. */
    _algToIdx(s) {
      const file = FILES.indexOf(s[0]);
      const rank = parseInt(s[1], 10);
      if (file < 0 || !(rank >= 1 && rank <= 8)) return -1;
      return (8 - rank) * 8 + file;
    }

    loadFEN(fen) {
      const parts = String(fen).trim().split(/\s+/);
      const placement = parts[0];
      const rows = placement.split('/');
      if (rows.length !== 8) throw new Error('Bad FEN: expected 8 ranks');
      const board = new Array(64).fill(null);
      for (let r = 0; r < 8; r++) {
        let c = 0;
        for (const ch of rows[r]) {
          if (ch >= '1' && ch <= '8') { c += +ch; continue; }
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          const t = ch.toUpperCase();
          if (!'PNBRQK'.includes(t)) throw new Error('Bad FEN: piece "' + ch + '"');
          if (c > 7) throw new Error('Bad FEN: rank overflow');
          board[idx(r, c)] = { t, c: color };
          c++;
        }
      }
      this.board = board;
      this.turn = parts[1] === 'b' ? 'b' : 'w';
      const cr = parts[2] || '-';
      this.castling = {
        wK: cr.includes('K'), wQ: cr.includes('Q'),
        bK: cr.includes('k'), bQ: cr.includes('q'),
      };
      this.ep = (parts[3] && parts[3] !== '-') ? this._algToIdx(parts[3]) : -1;
      this.halfmove = parts[4] != null ? (parseInt(parts[4], 10) || 0) : 0;
      this.fullmove = parts[5] != null ? (parseInt(parts[5], 10) || 1) : 1;
      this.history = [];
      this.sanHistory = [];
      this.repCount = {};
      this._bumpRep();
      return this;
    }

    fen() {
      let placement = '';
      for (let r = 0; r < 8; r++) {
        let empty = 0, row = '';
        for (let c = 0; c < 8; c++) {
          const p = this.board[idx(r, c)];
          if (!p) { empty++; continue; }
          if (empty) { row += empty; empty = 0; }
          row += p.c === 'w' ? p.t : p.t.toLowerCase();
        }
        if (empty) row += empty;
        placement += row + (r < 7 ? '/' : '');
      }
      let cr = (this.castling.wK ? 'K' : '') + (this.castling.wQ ? 'Q' : '') +
        (this.castling.bK ? 'k' : '') + (this.castling.bQ ? 'q' : '');
      if (!cr) cr = '-';
      const ep = this.ep >= 0 ? sqName(this.ep) : '-';
      return [placement, this.turn, cr, ep, this.halfmove, this.fullmove].join(' ');
    }

    /* ---------- helpers for UI / AI ---------- */
    pieceAt(sq) { return this.board[sq]; }
    materialOf(color) {
      let v = 0;
      for (let i = 0; i < 64; i++) {
        const p = this.board[i];
        if (p && p.c === color && p.t !== 'K') v += PIECE_VALUE[p.t];
      }
      return v;
    }
  }

  MG.Chess = Chess;
  MG.ChessUtil = { sqName, rc, idx, onBoard, PIECE_VALUE, FILES };

  if (typeof module !== 'undefined' && module.exports) module.exports = { Chess, sqName, rc, idx };
})();
