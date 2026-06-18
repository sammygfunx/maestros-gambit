/* ============================================================
   Maestro's Gambit — board.js
   Concert-stage chessboard. Renders the position, selection
   highlights, and the walking/leaping move animations between
   squares (battles happen in battle.js).

   Four camera views, implemented as swappable projections:
     'iso'   — isometric, Ivory's corner (the classic)
     'rot'   — the same stage seen from Ebony's corner (180°)
     'table' — across the table: straight-on, slightly elevated,
               rows foreshortened, back rows smaller. This view can be
               spun to any of EIGHT fixed yaw angles (45° steps) via
               this.orient (0..7) — see _tableRC()/the orient dial.
     'flat'  — a clean, familiar top-down 2D diagram board with
               procedurally-drawn black & white Staunton pieces
               (drawFlat / drawPiece2D below; no isometric sprites). It
               honours this.orient too, snapped to 90° steps, so it can
               be read from either side (white or black at the bottom).
   this.orient is the board yaw in 45° steps (0 = the classic White-at-
   front view). It only affects 'table' and 'flat'; iso/rot keep their
   own two fixed corners. rc2xy() accepts fractional row/col so tile
   corners and board edges project correctly in every view.
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
      // 'flat' top-down 2D board: a classic warm-wood tournament look with
      // clean ivory/charcoal Staunton pieces (highlight cues reuse the fields
      // above so selection/check/move markers match the other views).
      flat: {
        light: '#ead7b0', dark: '#9a6a3c',           // cream vs walnut squares
        frame: '#2c1c0d', frameRim: '#c9a44f',       // walnut frame + gold rim
        label: 'rgba(245,232,205,0.9)',
        wPiece: '#f7f1e6', wEdge: '#3a2c1d',          // ivory piece, warm-dark outline
        bPiece: '#36302a', bEdge: '#100c08',          // charcoal piece, near-black outline
        wDetail: '#3a2c1d', bDetail: '#cdbfa6',       // eye/slit accent (dark on white, light on black)
      },
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
      // colour-blind-safe 2D board: the same cream/blue square pair, pure
      // black-vs-white pieces with thick outlines for maximum piece contrast.
      flat: {
        light: '#ece3cf', dark: '#2f5d8a',
        frame: '#152538', frameRim: '#d9b24a',
        label: 'rgba(235,243,255,0.92)',
        wPiece: '#ffffff', wEdge: '#10243a',
        bPiece: '#15171a', bEdge: '#000000',
        wDetail: '#10243a', bDetail: '#dfe7f2',
      },
    },
  };
  MG.BOARD_THEMES = THEMES;

  /* ============================================================
     PROCEDURAL 2D STAUNTON PIECES (for the 'flat' view)
     Each glyph is a single closed silhouette traced in a
     resolution-independent fraction space: x is a fraction of the
     piece height left/right of centre, y rises from 0 at the base
     to ~1 at the crown. We draw it filled (piece colour) + stroked
     (outline) once, so the outline is clean with no internal seams.
     Symmetric pieces give a LEFT half (base→top-left) + an explicit
     TOP profile (left→right); the right half is the mirror. The
     knight is one explicit asymmetric profile (a horse's head).
     These shapes are authored here from scratch — no copied artwork.
     ============================================================ */
  const DEG = Math.PI / 180;
  // sample a circular arc into points (fraction space; +y is up)
  function farc(cx, cy, r, a0, a1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  }

  // ball-tipped crown spike helper (returns the arc over a small finial)
  const ball = (cx, cy, r = 0.05) => farc(cx, cy, r, 210 * DEG, -30 * DEG, 12);

  // height of each piece as a fraction of the tile, and outline data.
  // Built lazily and cached (constant geometry).
  let GLYPHS = null;
  function glyphs() {
    if (GLYPHS) return GLYPHS;
    const cat = (...as) => [].concat(...as);

    // ---- Pawn ----
    const pawn = {
      h: 0.60,
      body: [
        [-0.34, 0.00], [-0.34, 0.05], [-0.205, 0.10], [-0.155, 0.155],
        [-0.235, 0.20], [-0.135, 0.245], [-0.105, 0.45], [-0.205, 0.52],
        [-0.118, 0.612],
      ],
      top: farc(0, 0.78, 0.205, 235 * DEG, -55 * DEG, 22),
    };

    // ---- Bishop ----
    const bishop = {
      h: 0.74,
      body: [
        [-0.32, 0.00], [-0.32, 0.05], [-0.19, 0.10], [-0.15, 0.15],
        [-0.225, 0.19], [-0.135, 0.235], [-0.10, 0.34], [-0.20, 0.46],
        [-0.125, 0.565], [-0.175, 0.585], [-0.115, 0.625], [-0.13, 0.66],
      ],
      top: cat(
        [[-0.13, 0.66], [-0.115, 0.74], [-0.075, 0.82], [-0.028, 0.87]],
        ball(0, 0.915, 0.052),
        [[0.028, 0.87], [0.075, 0.82], [0.115, 0.74], [0.13, 0.66]]
      ),
      detail: [[-0.055, 0.74], [0.07, 0.835]], // mitre slit
    };

    // ---- Rook ----
    const rook = {
      h: 0.64,
      body: [
        [-0.34, 0.00], [-0.34, 0.06], [-0.225, 0.115], [-0.185, 0.17],
        [-0.255, 0.205], [-0.175, 0.245], [-0.155, 0.50], [-0.235, 0.545],
        [-0.215, 0.62],
      ],
      top: [
        [-0.215, 0.62], [-0.215, 0.76], [-0.115, 0.76], [-0.115, 0.685],
        [-0.04, 0.685], [-0.04, 0.76], [0.04, 0.76], [0.04, 0.685],
        [0.115, 0.685], [0.115, 0.76], [0.215, 0.76], [0.215, 0.62],
      ],
    };

    // ---- Queen ----
    const queen = {
      h: 0.78,
      body: [
        [-0.30, 0.00], [-0.30, 0.06], [-0.18, 0.11], [-0.145, 0.16],
        [-0.225, 0.20], [-0.13, 0.245], [-0.085, 0.43], [-0.175, 0.53],
        [-0.115, 0.60], [-0.16, 0.625], [-0.105, 0.665], [-0.175, 0.69],
      ],
      top: cat(
        [[-0.175, 0.69], [-0.225, 0.80]], ball(-0.185, 0.86),
        [[-0.145, 0.80], [-0.135, 0.78], [-0.115, 0.85]], ball(-0.09, 0.915),
        [[-0.05, 0.84], [-0.045, 0.79], [-0.03, 0.86]], ball(0, 0.955),
        [[0.03, 0.86], [0.045, 0.79], [0.05, 0.84]], ball(0.09, 0.915),
        [[0.115, 0.85], [0.135, 0.78], [0.145, 0.80]], ball(0.185, 0.86),
        [[0.225, 0.80], [0.175, 0.69]]
      ),
    };

    // ---- King ----
    const king = {
      h: 0.80,
      body: [
        [-0.30, 0.00], [-0.30, 0.06], [-0.185, 0.11], [-0.15, 0.16],
        [-0.23, 0.20], [-0.135, 0.245], [-0.09, 0.43], [-0.185, 0.53],
        [-0.13, 0.60], [-0.175, 0.625], [-0.115, 0.665], [-0.185, 0.70],
      ],
      top: [
        [-0.185, 0.70], [-0.205, 0.79], [-0.12, 0.79], [-0.085, 0.74],
        [-0.06, 0.80], [-0.06, 0.875], [-0.135, 0.875], [-0.135, 0.94],
        [-0.06, 0.94], [-0.06, 1.01], [0.06, 1.01], [0.06, 0.94],
        [0.135, 0.94], [0.135, 0.875], [0.06, 0.875], [0.06, 0.80],
        [0.085, 0.74], [0.12, 0.79], [0.205, 0.79], [0.185, 0.70],
      ],
    };

    // ---- Knight (asymmetric: a horse's head facing left) ----
    const knight = {
      h: 0.70,
      full: [
        [-0.32, 0.00], [-0.32, 0.05], [-0.185, 0.10], [-0.15, 0.155],
        [-0.225, 0.195], [-0.12, 0.235], [-0.155, 0.34], [-0.235, 0.50],
        [-0.335, 0.585], [-0.43, 0.60], [-0.455, 0.655], [-0.41, 0.705],
        [-0.315, 0.70], [-0.285, 0.755], [-0.32, 0.84], [-0.275, 0.90],
        [-0.18, 0.915], [-0.155, 1.00], [-0.085, 0.92], [-0.02, 0.945],
        [0.075, 0.875], [0.14, 0.74], [0.165, 0.55], [0.13, 0.36],
        [0.145, 0.235], [0.225, 0.195], [0.15, 0.155], [0.185, 0.10],
        [0.32, 0.05], [0.32, 0.00],
      ],
      eye: [-0.235, 0.79],
    };

    GLYPHS = { P: pawn, B: bishop, R: rook, Q: queen, K: king, N: knight };
    return GLYPHS;
  }

  // trace a fraction-space point list onto the canvas at (cx, by, h)
  function traceFrac(ctx, pts, cx, by, h, mirror) {
    for (let i = 0; i < pts.length; i++) {
      const fx = mirror ? -pts[i][0] : pts[i][0];
      const x = cx + fx * h, y = by - pts[i][1] * h;
      if (i === 0 && !mirror) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }

  /* Draw a clean 2D Staunton piece centred on a square.
     (cx, cy) = square centre; tile = square edge length. */
  function drawPiece2D(ctx, type, color, pal, cx, cy, tile) {
    const G = glyphs()[type];
    if (!G) return;
    const h = G.h * tile;
    const by = cy + h * 0.5 - tile * 0.04; // base sits a touch below centre
    const fill = color === 'w' ? pal.wPiece : pal.bPiece;
    const edge = color === 'w' ? pal.wEdge : pal.bEdge;
    const detail = color === 'w' ? pal.wDetail : pal.bDetail;

    // soft contact shadow for a little weight
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(cx, by - h * 0.01, h * 0.32, h * 0.075, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.3, h * 0.05);
    ctx.strokeStyle = edge;
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (G.full) {
      traceFrac(ctx, G.full, cx, by, h, false);
    } else {
      traceFrac(ctx, G.body, cx, by, h, false);    // left side up
      traceFrac(ctx, G.top, cx, by, h, false);      // across the top
      for (let i = G.body.length - 1; i >= 0; i--) { // right side down (mirror)
        ctx.lineTo(cx - G.body[i][0] * h, by - G.body[i][1] * h);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // accents: knight eye, bishop slit
    if (G.eye) {
      ctx.fillStyle = detail;
      ctx.beginPath();
      ctx.arc(cx + G.eye[0] * h, by - G.eye[1] * h, h * 0.035, 0, TAU);
      ctx.fill();
    }
    if (G.detail) {
      ctx.strokeStyle = detail;
      ctx.lineWidth = Math.max(1, h * 0.035);
      ctx.beginPath();
      ctx.moveTo(cx + G.detail[0][0] * h, by - G.detail[0][1] * h);
      ctx.lineTo(cx + G.detail[1][0] * h, by - G.detail[1][1] * h);
      ctx.stroke();
    }
    ctx.restore();
  }
  MG.drawPiece2D = drawPiece2D;

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
      this.view = 'iso';          // 'iso' | 'rot' | 'table' | 'flat'
      this.orient = 0;            // board yaw in 45° steps (0..7); table/flat only
      this.theme = THEMES.classic; // board palette (see THEMES)
      this.layout();
    }

    setView(v) {
      this.view = (v === 'rot' || v === 'table' || v === 'flat') ? v : 'iso';
      this.layout();
    }

    // Spin the table/flat board to one of 8 fixed yaw angles (45° steps).
    // iso/rot ignore it (they are their own two isometric corners).
    setOrient(o) {
      this.orient = ((Math.round(o) % 8) + 8) % 8;
    }
    // does the current view respond to this.orient? (drives the dial's visibility)
    orientable() { return this.view === 'table' || this.view === 'flat'; }

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
      // portrait phones stack the name + a full-width "to move" line at the top,
      // so reserve a touch more headroom there.
      const topReserve = wide ? 70 : (portrait ? 72 : 56);
      // Portrait bottom dock can reach ~280px when the Angle button is visible (7 buttons
      // = 3 rows). Use a generous static floor; refine from the live element if visible.
      let bottomReserve = (!wide && portrait) ? Math.min(310, Math.max(260, H * 0.34)) : 40;
      if (!wide && portrait) {
        const dock = document.getElementById('hud-side');
        if (dock && dock.offsetHeight > 60) bottomReserve = Math.max(bottomReserve, dock.offsetHeight + 14);
      }
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
      // 'flat' top-down 2D: a square 8×8 grid centred in the playfield, leaving
      // room for a frame + coordinate labels around the edge. Unlike the iso/table
      // views, the flat board has no bottom dock to dodge in landscape/desktop, so
      // give it (almost) the full height below the top banner instead of the iso
      // bottomReserve — this fills the otherwise-dead space on a phone held sideways.
      const frame = 26;
      const flatBottom = portrait ? bottomReserve : 12;
      const fVert = H - topReserve - flatBottom;
      const fAvail = Math.max(120, Math.min(W - sidePanel - 24 - frame * 2, fVert - frame * 2));
      const fTile = Math.max(24, Math.floor(fAvail / 8));
      const fSize = fTile * 8;
      this.flat = {
        ts: fTile, size: fSize, frame,
        ox: Math.round((W - sidePanel) / 2 - fSize / 2),
        oy: Math.round(topReserve + (fVert - fSize) / 2),
      };
    }

    /* 'table' view yaw: rotate the (file,row) plane about the board centre by
       this.orient·45°, then foreshorten by depth. ru = lateral position, rr =
       row-like depth coordinate, s = perspective scale. At orient 0 this is
       exactly the original straight-on table (ru = c-3.5, rr = r-3.5, so
       s = D0/(D0+7.5-r)); other orients spin the stage in 45° steps. */
    _tableRC(r, c) {
      const D0 = this.tp.D0;
      const th = this.orient * Math.PI / 4;
      const cu = c - 3.5, cr = r - 3.5;
      const cs = Math.cos(th), sn = Math.sin(th);
      const ru = cu * cs - cr * sn;
      const rr = cu * sn + cr * cs;
      return { ru, rr, s: D0 / (D0 + 4 - rr) };
    }

    /* 'flat' view orientation, snapped to a 90° step (0/1/2/3 = 0/90/180/270°)
       so the diagram board stays axis-aligned. _flatDisp maps a logical (r,c)
       to its on-screen cell; _flatInvert is the reverse (for hit-testing). */
    _flatStep() { return ((Math.round(this.orient / 2) % 4) + 4) % 4; }
    _flatRot(r, c, n) { for (let i = 0; i < n; i++) { const nr = c, nc = 7 - r; r = nr; c = nc; } return [r, c]; }
    _flatDisp(r, c) { return this._flatRot(r, c, this._flatStep()); }
    _flatInvert(dr, dc) { return this._flatRot(dr, dc, (4 - this._flatStep()) % 4); }

    sq2xy(sq) {
      const r = Math.floor(sq / 8), c = sq % 8;
      return this.rc2xy(r, c);
    }
    rc2xy(r, c) { // fractional r/c welcome (tile corners, board edges)
      if (this.view === 'flat') {
        const f = this.flat;
        const [dr, dc] = this._flatDisp(r, c);
        return { x: f.ox + (dc + 0.5) * f.ts, y: f.oy + (dr + 0.5) * f.ts };
      }
      if (this.view === 'table') {
        const { U, V, cx, cy } = this.tp;
        const t = this._tableRC(r, c);
        return { x: cx + t.ru * U * t.s, y: cy + V * t.s };
      }
      if (this.view === 'rot') { r = 7 - r; c = 7 - c; }
      return {
        x: this.ox + ((c - r) * this.tw) / 2,
        y: this.oy + ((c + r) * this.th) / 2,
      };
    }
    squareAt(mx, my) {
      let r, c;
      if (this.view === 'flat') {
        const f = this.flat;
        const dc = Math.floor((mx - f.ox) / f.ts);
        const dr = Math.floor((my - f.oy) / f.ts);
        if (dr < 0 || dr > 7 || dc < 0 || dc > 7) return -1;
        [r, c] = this._flatInvert(dr, dc);
      } else if (this.view === 'table') {
        const { D0, U, V, cx, cy } = this.tp;
        const s = (my - cy) / V;
        if (s <= 0.02) return -1;
        const rr = D0 + 4 - D0 / s;          // invert the perspective…
        const ru = (mx - cx) / (U * s);
        const th = this.orient * Math.PI / 4;  // …then the yaw rotation
        const cs = Math.cos(th), sn = Math.sin(th);
        c = Math.round(ru * cs + rr * sn + 3.5);
        r = Math.round(-ru * sn + rr * cs + 3.5);
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
      if (this.view === 'flat') return this.flat.ts / 52;
      return this.view === 'table'
        ? (this.tp.U * this._tableRC(Math.floor(sq / 8), sq % 8).s) / 52 : this.scale;
    }
    footOff(sq) {
      if (this.view === 'flat') return 0;
      if (this.view !== 'table') return this.th * 0.18;
      const r = Math.floor(sq / 8), c = sq % 8;
      return (this.rc2xy(r + 0.5, c).y - this.rc2xy(r - 0.5, c).y) * 0.18;
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
      if (this.view === 'flat') return this.drawFlat(game, opts);
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
      const flat = this.view === 'flat';
      const sq = r * 8 + c;
      const { x, y } = this.rc2xy(r, c);
      const light = (r + c) % 2 === 0;
      const pal = flat ? T.flat : T;     // flat board uses its own square palette
      let col = light ? pal.light : pal.dark;
      this.tilePath(ctx, r, c);
      ctx.fillStyle = col;
      ctx.fill();
      if (!flat) {
        // wood sheen along the far edge (isometric stages only)
        ctx.fillStyle = light ? T.sheenLight : T.sheenDark;
        const e0 = this.rc2xy(r - 0.5, c - 0.5), e1 = this.rc2xy(r - 0.5, c + 0.5);
        ctx.beginPath();
        ctx.moveTo(e0.x, e0.y); ctx.lineTo(e1.x, e1.y); ctx.lineTo(e0.x, e0.y + 3);
        ctx.closePath(); ctx.fill();
      }

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

    /* ---------- 'flat' top-down 2D board ----------
       A clean, familiar chess-diagram view: a framed wood/contrast board,
       file/rank labels, and procedural black & white Staunton pieces. Reuses
       drawTile() for the squares + highlight markers; pieces are drawn by
       drawPiece2D() (no isometric sprites). The move animation slides the
       piece flat between squares (a small hop for knights). */
    drawFlat(game) {
      const ctx = this.ctx, T = this.theme, F = T.flat, f = this.flat;
      const d = MG.dpr || 1;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const [shx, shy] = this.fxl.shakeOffset();

      // backdrop
      this.drawFlatBackdrop(ctx, F);

      ctx.save();
      ctx.translate(shx, shy);

      // outer frame + gold rim
      const m = f.frame;
      ctx.fillStyle = F.frame;
      ctx.fillRect(f.ox - m, f.oy - m, f.size + 2 * m, f.size + 2 * m);
      ctx.strokeStyle = F.frameRim;
      ctx.lineWidth = 2;
      ctx.strokeRect(f.ox - m * 0.5, f.oy - m * 0.5, f.size + m, f.size + m);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(f.ox + 0.5, f.oy + 0.5, f.size - 1, f.size - 1);

      // squares + highlight overlays
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) this.drawTile(ctx, r, c, game);
      }

      // coordinate labels, oriented with the board: the left edge and bottom
      // edge each read off the logical square sitting there (so rotating to
      // black's side flips ranks 1↔8 / files a↔h, and the 90° spins swap axes).
      ctx.fillStyle = F.label;
      ctx.font = `${Math.max(9, Math.round(f.ts * 0.24))}px Georgia, serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const ranksVertical = this._flatStep() % 2 === 0;
      for (let i = 0; i < 8; i++) {
        const [lr, lc] = this._flatInvert(i, 0);       // left edge, display row i
        const lt = ranksVertical ? String(8 - lr) : String.fromCharCode(97 + lc);
        ctx.fillText(lt, f.ox - m * 0.5, f.oy + (i + 0.5) * f.ts);
        const [br, bc] = this._flatInvert(7, i);       // bottom edge, display col i
        const bt = ranksVertical ? String.fromCharCode(97 + bc) : String(8 - br);
        ctx.fillText(bt, f.ox + (i + 0.5) * f.ts, f.oy + f.size + m * 0.55);
      }

      // pieces — back rank (r=0) first so taller front pieces overlap upward
      const a = this.anim;
      const board = a ? a.snapshot : game.board;
      const hide = new Set();
      if (a) {
        hide.add(a.visual.from);
        if (a.visual.second) hide.add(a.visual.second.from);
      }
      for (let i = 0; i < 64; i++) {
        if (hide.has(i)) continue;
        const p = board[i];
        if (!p) continue;
        const { x, y } = this.sq2xy(i);
        drawPiece2D(ctx, p.t, p.c, F, x, y, f.ts);
      }

      // the walker(s)
      if (a) {
        const u = Math.min(1, a.t / a.dur);
        const slide = (vis, frac, hop) => {
          const from = this.sq2xy(vis.from), to = this.sq2xy(vis.to);
          const x = from.x + (to.x - from.x) * frac;
          let y = from.y + (to.y - from.y) * frac;
          if (hop) y -= Math.sin(frac * Math.PI) * f.ts * 0.32;
          drawPiece2D(ctx, vis.piece.t, vis.piece.c, F, x, y, f.ts);
        };
        if (!a.secondPhase) {
          if (a.visual.second) { // castling: rook waits idle at its origin
            const sp = a.visual.second, s = this.sq2xy(sp.from);
            drawPiece2D(ctx, sp.piece.t, sp.piece.c, F, s.x, s.y, f.ts);
          }
          slide(a.visual, u, a.visual.piece.t === 'N');
        } else {
          const k = this.sq2xy(a.visual.to);
          drawPiece2D(ctx, a.visual.piece.t, a.visual.piece.c, F, k.x, k.y, f.ts);
          slide(a.visual.second, u, false);
        }
      }

      this.fxl.draw(ctx);
      ctx.restore();
      this.fxl.drawFlash(ctx);
    }

    drawFlatBackdrop(ctx, F) {
      const W = this.W, H = this.H;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0e0716');
      g.addColorStop(1, '#1a1024');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // top valance to match the other views
      ctx.fillStyle = '#4a1010';
      ctx.fillRect(0, 0, W, 18);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let x = 0; x < W; x += 34) ctx.fillRect(x, 0, 12, 18);
      ctx.fillStyle = '#a87f33';
      ctx.fillRect(0, 18, W, 2);
    }
  }

  MG.BoardView = BoardView;
})();
