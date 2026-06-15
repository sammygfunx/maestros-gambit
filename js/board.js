/* ============================================================
   Maestro's Gambit — board.js
   Concert-stage chessboard. Renders the position, selection
   highlights, and the walking/leaping move animations between
   squares (battles happen in battle.js).

   Three camera views, implemented as swappable projections:
     'iso'   — isometric, Ivory's corner (the classic)
     'rot'   — the same stage seen from Obsidian's corner (180°)
     'table' — across the table: straight-on, slightly elevated,
               rows foreshortened, back rows smaller
   rc2xy() accepts fractional row/col so tile corners and board
   edges project correctly in every view.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});
  const TAU = Math.PI * 2;

  /* ---------- board palettes ----------
     'classic'  — the original ivory-&-ebony concert stage (gold accents).
     'contrast' — a high-contrast, colour-blind-safe scheme. The classic board
       leans on a warm-hue pair (tan vs brown) plus red/gold cues that are hard
       to tell apart with red–green colour vision; this one uses the deutan/
       protan-safe blue-vs-amber pairing and pairs every colour cue with a SHAPE
       cue (capture = ring, quiet move = note glyph) so nothing relies on hue.
     Highlight markers keep their shapes across themes; only the colours change. */
  const THEMES = {
    classic: {
      light: '#c8a368', dark: '#6b4226',
      sheenLight: 'rgba(255,240,210,0.13)', sheenDark: 'rgba(255,220,170,0.06)',
      last: 'rgba(180,140,255,0.16)',
      selFill: 'rgba(232,181,74,0.40)', selStroke: '#ffd98a',
      check: (p) => `rgba(220,60,40,${p})`,
      capRing: 'rgba(235,90,60,0.95)', capWidth: 2.5,
      note: 'rgba(232,181,74,0.8)', noteHover: '#ffd98a',
      hover: 'rgba(255,255,255,0.08)',
      rim: '#a87f33',
    },
    contrast: {
      // cream vs strong blue: a luminance- AND hue-distinct pair for red–green CVD
      light: '#ece3cf', dark: '#2f5d8a',
      sheenLight: 'rgba(255,255,255,0.16)', sheenDark: 'rgba(200,225,255,0.10)',
      last: 'rgba(150,200,255,0.26)',                       // cool blue wash
      selFill: 'rgba(255,176,0,0.50)', selStroke: '#fff1b0', // amber (CB-safe vs blue)
      check: (p) => `rgba(230,40,40,${0.45 + p * 0.55})`,    // bright, high-luminance
      capRing: '#ff7a00', capWidth: 3.5,                     // thick orange ring (+shape)
      note: 'rgba(120,220,255,0.95)', noteHover: '#ffffff',  // cyan quiet-move note
      hover: 'rgba(255,255,255,0.16)',
      rim: '#d9b24a',
    },
  };
  MG.BOARD_THEMES = THEMES;

  class BoardView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.fxl = new MG.FXLayer();
      this.t = 0;
      this.hover = -1;
      this.selected = -1;
      this.legalTargets = [];
      this.lastMove = null;       // {from, to}
      this.checkSq = -1;
      this.anim = null;           // active move animation
      this.view = 'iso';          // 'iso' | 'rot' | 'table'
      this.theme = THEMES.classic; // board palette (see THEMES)
      this.layout();
    }

    setView(v) {
      this.view = v === 'rot' || v === 'table' ? v : 'iso';
      this.layout();
    }

    setTheme(name) {
      this.theme = THEMES[name] || THEMES.classic;
    }

    layout() {
      // Game coords are CSS pixels; the canvas backing store is larger by MG.dpr.
      const dpr = MG.dpr || 1;
      const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
      this.W = W; this.H = H;
      // Where the DOM HUD docks decides what the board must leave clear (these
      // breakpoints mirror the @media rules in style.css):
      //   wide       → fixed 230px side panel on the right (desktop/tablet)
      //   landscape  → thin side panel on the right (phone on its side)
      //   portrait   → panel collapses to a bottom strip; reserve vertical room
      const portrait = H >= W;
      const wide = W > 900 && H > 560;
      const sidePanel = wide ? 230 : (portrait ? 10 : 168);
      const topReserve = wide ? 70 : 56;
      const bottomReserve = (!wide && portrait) ? Math.min(210, Math.max(150, H * 0.24)) : 40;
      this.bottomReserve = bottomReserve;
      const availH = H - topReserve - bottomReserve;
      this.tw = Math.max(40, Math.min((W - sidePanel - 60) / 8.2, availH / 4.4));
      this.th = this.tw / 2;
      this.ox = (W - sidePanel) / 2;
      this.oy = topReserve + availH / 2 - (7 * this.th) / 2 + 14;
      this.scale = this.tw / 52;
      // 'table' perspective: rows at distance D0+(7.5-r) from the eye,
      // projected scale s(r)=D0/dist. U = near-row tile width, V = vertical gain.
      const D0 = 9;
      const U = Math.max(34, Math.min((W - sidePanel - 70) / 8.4, (availH - 80) / 3.2));
      const V = U * 5;
      this.tp = { D0, U, V, cx: (W - sidePanel) / 2, cy: (H - bottomReserve - 30) - V };
    }

    ts(r) { const { D0 } = this.tp; return D0 / (D0 + 7.5 - r); } // table row scale

    sq2xy(sq) {
      const r = Math.floor(sq / 8), c = sq % 8;
      return this.rc2xy(r, c);
    }
    rc2xy(r, c) { // fractional r/c welcome (tile corners, board edges)
      if (this.view === 'table') {
        const { U, V, cx, cy } = this.tp;
        const s = this.ts(r);
        return { x: cx + (c - 3.5) * U * s, y: cy + V * s };
      }
      if (this.view === 'rot') { r = 7 - r; c = 7 - c; }
      return {
        x: this.ox + ((c - r) * this.tw) / 2,
        y: this.oy + ((c + r) * this.th) / 2,
      };
    }
    squareAt(mx, my) {
      let r, c;
      if (this.view === 'table') {
        const { D0, U, V, cx, cy } = this.tp;
        const s = (my - cy) / V;
        if (s <= 0.02) return -1;
        r = Math.round(7.5 + D0 - D0 / s);
        c = Math.round((mx - cx) / (U * s) + 3.5);
      } else {
        const A = ((mx - this.ox) * 2) / this.tw;   // c - r
        const B = ((my - this.oy) * 2) / this.th;   // c + r
        c = Math.round((A + B) / 2); r = Math.round((B - A) / 2);
        if (this.view === 'rot') { r = 7 - r; c = 7 - c; }
      }
      if (r < 0 || r > 7 || c < 0 || c > 7) return -1;
      return r * 8 + c;
    }

    /* per-square sprite scale / ground offset / mirror */
    sqScale(sq) {
      return this.view === 'table' ? (this.tp.U * this.ts(Math.floor(sq / 8))) / 52 : this.scale;
    }
    footOff(sq) {
      if (this.view !== 'table') return this.th * 0.18;
      const r = Math.floor(sq / 8);
      return (this.rc2xy(r + 0.5, 3.5).y - this.rc2xy(r - 0.5, 3.5).y) * 0.18;
    }
    flip(piece) { return (piece.c === 'b') !== (this.view === 'rot'); }

    /* ---------- move animation ----------
       snapshot: array(64) of {t,c} BEFORE the move
       visual: {from, to, piece, second:{from,to,piece}|null (castling rook)}
       onArrive() fires when the walker reaches the target square. */
    beginMoveAnim(snapshot, visual, onArrive, speed = 1) {
      const from = this.sq2xy(visual.from), to = this.sq2xy(visual.to);
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const isKnight = visual.piece.t === 'N';
      const dur = (isKnight ? 0.85 : Math.max(0.55, dist / (this.tw * 2.6))) / speed;
      this.anim = {
        snapshot, visual, onArrive,
        t: 0, dur,
        stepClock: 0,
        secondPhase: false,
      };
      if (isKnight) MG.Audio.whoosh(0, 0.3, 0.4);
    }

    finishAnim() {
      const a = this.anim;
      this.anim = null;
      if (a && a.onArrive) a.onArrive();
    }

    update(dt) {
      this.t += dt;
      this.fxl.update(dt);
      const a = this.anim;
      if (a) {
        a.t += dt;
        const u = Math.min(1, a.t / a.dur);
        // footsteps
        a.stepClock += dt;
        const heavy = a.visual.piece.t === 'R';
        if (a.stepClock > (heavy ? 0.34 : 0.22) && u < 1 && a.visual.piece.t !== 'N') {
          a.stepClock = 0;
          if (heavy) { MG.Audio.timpani(0, 0.18, 95); }
          else MG.Audio.footstep((Math.random() * 2) | 0);
        }
        if (u >= 1) {
          if (a.visual.second && !a.secondPhase) {
            // castling: now the rook trundles over
            a.secondPhase = true;
            a.t = 0;
            a.dur = 0.8;
            MG.Audio.castle();
          } else {
            this.finishAnim();
          }
        }
      }
    }

    /* ---------- drawing ---------- */
    draw(game, opts = {}) {
      const ctx = this.ctx;
      const d = MG.dpr || 1;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const [shx, shy] = this.fxl.shakeOffset();
      ctx.save();
      ctx.translate(shx, shy);
      this.drawBackdrop(ctx);
      this.drawBoardBase(ctx);

      // tiles
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) this.drawTile(ctx, r, c, game);
      }

      // pieces — depth-sorted
      const drawables = [];
      const a = this.anim;
      const board = a ? a.snapshot : game.board;
      const hideSquares = new Set();
      if (a) {
        hideSquares.add(a.visual.from);
        if (a.visual.second) hideSquares.add(a.visual.second.from);
        // en-passant victim stays visible until arrival
      }

      for (let i = 0; i < 64; i++) {
        if (hideSquares.has(i)) continue;
        const p = board[i];
        if (!p) continue;
        const { x, y } = this.sq2xy(i);
        const sc = this.sqScale(i), fo = this.footOff(i);
        const phase = (i * 0.61803) % 1;
        drawables.push({
          y,
          fn: () => {
            MG.Sprites.shadow(ctx, x, y + 2, sc / 2.2);
            MG.Sprites.render(ctx, p.t, p.c, 'idle', 0, this.t + phase * 7, x, y + fo, sc, this.flip(p));
          },
        });
      }

      // the walker(s)
      if (a) {
        const addWalker = (vis, u, action) => {
          const from = this.sq2xy(vis.from), to = this.sq2xy(vis.to);
          const s0 = this.sqScale(vis.from), s1 = this.sqScale(vis.to);
          const f0 = this.footOff(vis.from), f1 = this.footOff(vis.to);
          const x = from.x + (to.x - from.x) * u;
          let y = from.y + (to.y - from.y) * u;
          const sc = s0 + (s1 - s0) * u, fo = f0 + (f1 - f0) * u;
          let air = 0;
          if (action === 'ride') air = Math.sin(u * Math.PI) * 26 * sc;
          drawables.push({
            y,
            fn: () => {
              MG.Sprites.shadow(ctx, x, y + 2, sc / 2.2, air / sc);
              MG.Sprites.render(
                ctx, vis.piece.t, vis.piece.c, action, 0, this.t,
                x, y + fo - air, sc, this.flip(vis.piece)
              );
            },
          });
        };
        const u = Math.min(1, a.t / a.dur);
        if (!a.secondPhase) {
          const act = a.visual.piece.t === 'N' ? 'ride' : 'walk';
          addWalker(a.visual, u, act);
          if (a.visual.second) {
            const sp = a.visual.second;
            const s = this.sq2xy(sp.from);
            const ssc = this.sqScale(sp.from), sfo = this.footOff(sp.from);
            drawables.push({
              y: s.y,
              fn: () => {
                MG.Sprites.shadow(ctx, s.x, s.y + 2, ssc / 2.2);
                MG.Sprites.render(ctx, sp.piece.t, sp.piece.c, 'idle', 0, this.t, s.x, s.y + sfo, ssc, this.flip(sp.piece));
              },
            });
          }
        } else {
          // king already arrived; draw him idle at destination, rook walks
          const k = this.sq2xy(a.visual.to);
          const ksc = this.sqScale(a.visual.to), kfo = this.footOff(a.visual.to);
          drawables.push({
            y: k.y,
            fn: () => {
              MG.Sprites.shadow(ctx, k.x, k.y + 2, ksc / 2.2);
              MG.Sprites.render(ctx, a.visual.piece.t, a.visual.piece.c, 'idle', 0, this.t, k.x, k.y + kfo, ksc, this.flip(a.visual.piece));
            },
          });
          addWalker(a.visual.second, u, 'walk');
        }
      }

      drawables.sort((p, q) => p.y - q.y);
      for (const d of drawables) d.fn();

      this.fxl.draw(ctx);
      ctx.restore();
      this.fxl.drawFlash(ctx);
    }

    drawBackdrop(ctx) {
      const W = this.W, H = this.H;
      let g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0e0716');
      g.addColorStop(0.55, '#1c1026');
      g.addColorStop(1, '#241430');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // proscenium glow behind the board
      const cen = this.rc2xy(3.5, 3.5);
      const gw = (this.view === 'table' ? this.tp.U : this.tw);
      const rg = ctx.createRadialGradient(cen.x, cen.y, gw, cen.x, cen.y, gw * 7);
      rg.addColorStop(0, 'rgba(120,80,140,0.20)');
      rg.addColorStop(1, 'rgba(120,80,140,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
      // top valance
      ctx.fillStyle = '#4a1010';
      ctx.fillRect(0, 0, W, 18);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let x = 0; x < W; x += 34) ctx.fillRect(x, 0, 12, 18);
      ctx.fillStyle = '#a87f33';
      ctx.fillRect(0, 18, W, 2);
    }

    drawBoardBase(ctx) {
      // extruded plinth under the playing surface (any projection)
      const lift = 16;
      const cs = [this.rc2xy(-0.5, -0.5), this.rc2xy(-0.5, 7.5), this.rc2xy(7.5, 7.5), this.rc2xy(7.5, -0.5)];
      const poly = (dy) => {
        ctx.beginPath();
        ctx.moveTo(cs[0].x, cs[0].y + dy);
        for (let i = 1; i < 4; i++) ctx.lineTo(cs[i].x, cs[i].y + dy);
        ctx.closePath();
      };
      ctx.fillStyle = '#1a0f08'; poly(lift); ctx.fill();
      ctx.fillStyle = '#2b1a0d'; poly(lift * 0.55); ctx.fill();
      // gold rim
      ctx.strokeStyle = this.theme.rim;
      ctx.lineWidth = 2;
      poly(0); ctx.stroke();
    }

    tilePath(ctx, r, c) {
      const p0 = this.rc2xy(r - 0.5, c - 0.5), p1 = this.rc2xy(r - 0.5, c + 0.5),
        p2 = this.rc2xy(r + 0.5, c + 0.5), p3 = this.rc2xy(r + 0.5, c - 0.5);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
    }

    drawTile(ctx, r, c, game) {
      const T = this.theme;
      const sq = r * 8 + c;
      const { x, y } = this.rc2xy(r, c);
      const light = (r + c) % 2 === 0;
      let col = light ? T.light : T.dark;
      this.tilePath(ctx, r, c);
      ctx.fillStyle = col;
      ctx.fill();
      // wood sheen along the far edge
      ctx.fillStyle = light ? T.sheenLight : T.sheenDark;
      const e0 = this.rc2xy(r - 0.5, c - 0.5), e1 = this.rc2xy(r - 0.5, c + 0.5);
      ctx.beginPath();
      ctx.moveTo(e0.x, e0.y); ctx.lineTo(e1.x, e1.y); ctx.lineTo(e0.x, e0.y + 3);
      ctx.closePath(); ctx.fill();

      // overlays
      const isSel = sq === this.selected;
      const isTarget = this.legalTargets.includes(sq);
      const isLast = this.lastMove && (this.lastMove.from === sq || this.lastMove.to === sq);
      const isHover = sq === this.hover;
      const isCheck = sq === this.checkSq;

      if (isLast) {
        this.tilePath(ctx, r, c);
        ctx.fillStyle = T.last;
        ctx.fill();
      }
      if (isSel) {
        this.tilePath(ctx, r, c);
        ctx.fillStyle = T.selFill;
        ctx.fill();
        ctx.strokeStyle = T.selStroke;
        ctx.lineWidth = 2;
        this.tilePath(ctx, r, c);
        ctx.stroke();
      }
      if (isCheck) {
        const pulse = 0.3 + 0.2 * Math.sin(this.t * 6);
        this.tilePath(ctx, r, c);
        ctx.fillStyle = T.check(pulse);
        ctx.fill();
      }
      if (isTarget) {
        const cap = game && game.board[sq];
        if (cap) { // capture target: a ring (shape cue, not just colour)
          ctx.strokeStyle = T.capRing;
          ctx.lineWidth = T.capWidth;
          this.tilePath(ctx, r, c);
          ctx.stroke();
        } else { // quiet move: a little note glyph (shape cue, not just colour)
          MG.drawNote(ctx, x, y + 2, 9, isHover ? T.noteHover : T.note, 0);
        }
      }
      if (isHover && !isSel) {
        this.tilePath(ctx, r, c);
        ctx.fillStyle = T.hover;
        ctx.fill();
      }
    }

    promoSparkle(sq) {
      const { x, y } = this.sq2xy(sq);
      this.fxl.stars(x, y - 40, 22, '#ffe9a8');
      this.fxl.notes(x, y - 30, 8, '#ffd98a');
      this.fxl.ring(x, y, 'rgba(255,217,138,0.9)', 8, 80, 0.6);
    }
    checkPulse(sq, text) {
      this.checkSq = sq;
      if (text) {
        const { x, y } = this.sq2xy(sq);
        this.fxl.popup(x, y - 90, text, '#ff8d6b', 30, 1.4);
      }
    }
  }

  MG.BoardView = BoardView;
})();
