/* ============================================================
   Maestro's Gambit — sprites.js
   Procedural pixel-art orchestra. Every character, frame and
   costume is generated at runtime from code — no image assets.

   Characters (piece → musician):
     P Violinist · N Cellist · B Clarinetist
     R Percussionist · Q Pianist · K Conductor

   Public API:
     Sprites.render(ctx, type, color, action, k, t, x, y, scale, flip, extra)
     Sprites.drawIcon(canvas, type, color)
     Sprites.CHARS, Sprites.TEAM
   `k` = 0..1 progress for one-shot actions, `t` = raw seconds
   (used by looping actions). (x, y) is the feet/ground point.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});
  const TAU = Math.PI * 2;

  const TEAM = {
    w: {
      name: 'Ivory', coat: '#efe2c0', coatD: '#cdbb92', trim: '#d9a93f',
      pants: '#b4a378', shoe: '#6e5a3a', cuff: '#fff6df', glowA: 'rgba(255,224,150,',
    },
    b: {
      name: 'Ebony', coat: '#462b60', coatD: '#331d49', trim: '#c3c8e6',
      pants: '#2c1c3e', shoe: '#150d20', cuff: '#6b4a8d', glowA: 'rgba(190,170,255,',
    },
  };

  const CHARS = {
    P: { name: 'Violinist', skin: '#e7b98c', hair: '#7a4a21', legLen: 13, torsoLen: 12, headR: 5, shW: 4, limbW: 2.5 },
    N: { name: 'Cellist', skin: '#b07b4e', hair: '#2e1f12', legLen: 14, torsoLen: 13, headR: 5.5, shW: 5, limbW: 3 },
    B: { name: 'Clarinetist', skin: '#d9a06b', hair: '#444a52', legLen: 17, torsoLen: 14, headR: 5, shW: 3.5, limbW: 2.2 },
    R: { name: 'Percussionist', skin: '#8a5a33', hair: '#1c1208', legLen: 13, torsoLen: 16, headR: 6.5, shW: 8, limbW: 4 },
    Q: { name: 'Pianist', skin: '#f0cfae', hair: '#1f1a2e', legLen: 16, torsoLen: 14, headR: 5, shW: 4.5, limbW: 2.4 },
    K: { name: 'Conductor', skin: '#cf9d72', hair: '#e8e4da', legLen: 15, torsoLen: 15, headR: 5.5, shW: 5, limbW: 2.8 },
  };

  /* ---------------- math helpers ---------------- */
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const osc = (t, f, ph = 0) => Math.sin(t * f * TAU + ph);
  const eo = (u) => 1 - (1 - u) * (1 - u);            // ease-out
  const ei = (u) => u * u;                            // ease-in
  const bell = (u) => Math.sin(clamp01(u) * Math.PI); // 0→1→0
  const lerp = (a, b, u) => a + (b - a) * u;
  // ramp: 0 until u0, then eases to 1 at u1
  const ramp = (u, u0, u1) => eo(clamp01((u - u0) / (u1 - u0)));

  /* ---------------- pixel primitives ---------------- */
  function prims(g) {
    return {
      r(x, y, w, h, c) {
        g.fillStyle = c;
        g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
      },
      d(cx, cy, r, c) {
        g.fillStyle = c;
        const R = Math.max(0.6, r);
        for (let yy = -Math.ceil(R); yy <= Math.ceil(R); yy++) {
          const w2 = Math.sqrt(Math.max(0, R * R - yy * yy));
          g.fillRect(Math.round(cx - w2), Math.round(cy + yy), Math.max(1, Math.round(w2 * 2)), 1);
        }
      },
      l(x1, y1, x2, y2, w, c) {
        g.fillStyle = c;
        const dx = x2 - x1, dy = y2 - y1;
        const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
        const hw = w / 2;
        for (let i = 0; i <= n; i++) {
          const x = x1 + (dx * i) / n, y = y1 + (dy * i) / n;
          g.fillRect(Math.round(x - hw), Math.round(y - hw), Math.max(1, Math.round(w)), Math.max(1, Math.round(w)));
        }
      },
      ringd(cx, cy, r, w, c) { // crude ring
        this.d(cx, cy, r, c);
        g.save();
        g.globalCompositeOperation = 'destination-out';
        this.d(cx, cy, r - w, '#000');
        g.restore();
      },
    };
  }

  /* arm: shoulder→elbow→hand. a1 absolute from straight-down (+ = forward),
     a2 relative bend. Returns hand pos+angle. */
  function drawArm(h, sx, sy, a1, a2, uLen, fLen, w, pal, skin) {
    const ex = sx + Math.sin(a1) * uLen, ey = sy + Math.cos(a1) * uLen;
    const ha = a1 + a2;
    const hx = ex + Math.sin(ha) * fLen, hy = ey + Math.cos(ha) * fLen;
    h.l(sx, sy, ex, ey, w, pal.coat);
    h.l(ex, ey, hx, hy, w, pal.coat);
    h.d(hx - Math.sin(ha), hy - Math.cos(ha), w * 0.55, pal.cuff);
    h.d(hx, hy, Math.max(1.4, w * 0.55), skin);
    return { x: hx, y: hy, ang: ha };
  }

  function drawLeg(h, hipX, hipY, footX, footY, w, pal) {
    const kx = (hipX + footX) / 2 + 1.5, ky = (hipY + footY) / 2;
    h.l(hipX, hipY, kx, ky, w, pal.pants);
    h.l(kx, ky, footX, footY - 1, w, pal.pants);
    h.r(footX - w / 2 - 0.5, footY - 2, w + 2.5, 2, pal.shoe);
  }

  /* ---------------- default pose ---------------- */
  function basePose() {
    return {
      bob: 0, lean: 0, crouch: 0, phase: null, stance: 4, stride: 5,
      armF: { a1: 0.32, a2: 0.45 }, armB: { a1: -0.22, a2: 0.4 },
      headTilt: 0, flash: 0, lie: 0, spin: 0, air: 0, alpha: 1,
      expr: 'calm', custom: {},
    };
  }

  /* ============================================================
     POSE GENERATORS — per character, per action.
     Each fn mutates pose P given (k = progress 0..1, t = seconds).
     ============================================================ */

  const SHARED = {
    idle(k, t, P) {
      P.bob = osc(t, 0.8) * 0.7;
      P.armF.a1 += osc(t, 0.8, 1) * 0.05;
      P.headTilt = osc(t, 0.4) * 0.06;
    },
    walk(k, t, P) {
      P.phase = (t * 2.0) % 1;
      P.bob = Math.abs(osc(t, 4)) * 1.4;
      P.armF = { a1: 0.3 + osc(t, 2) * 0.5, a2: 0.4 };
      P.armB = { a1: -0.3 - osc(t, 2) * 0.5, a2: 0.4 };
      P.lean = 0.08;
    },
    hit(k, t, P) {
      P.lean = -0.5 * bell(k);
      P.headTilt = -0.4 * bell(k);
      P.armF = { a1: 1.2 * bell(k) + 0.3, a2: 0.2 };
      P.armB = { a1: -1.0 * bell(k), a2: 0.2 };
      P.flash = Math.max(0, 1 - k * 3);
      P.expr = 'ouch';
      P.air = bell(clamp01(k * 2)) * 2;
    },
    dodge(k, t, P) {
      P.air = bell(k) * 9;
      P.crouch = k > 0.8 ? (k - 0.8) * 3 : 0;
      P.lean = -0.25 * bell(k);
      P.expr = 'calm';
    },
    block(k, t, P) {
      P.crouch = 0.35 * eo(clamp01(k * 3));
      P.armF = { a1: 1.5, a2: 1.2 };
      P.armB = { a1: 1.2, a2: 1.5 };
      P.lean = 0.12;
      P.expr = 'mad';
    },
    taunt(k, t, P) {
      P.lean = 0.18;
      P.armF = { a1: 1.5 + osc(t, 3) * 0.35, a2: 0.6 };
      P.expr = 'happy';
      P.headTilt = 0.15;
    },
    cheer(k, t, P) {
      P.air = Math.abs(osc(t, 3)) * 4;
      P.armF = { a1: 2.8, a2: 0.1 };
      P.armB = { a1: -2.8, a2: -0.1 };
      P.expr = 'happy';
    },
    dead(k, t, P) { P.lie = 1; P.expr = 'ko'; },
  };

  const POSES = {
    /* ---------- VIOLINIST (Pawn) ---------- */
    P: {
      idle(k, t, P) {
        SHARED.idle(k, t, P);
        P.custom.vUp = 0;
        P.custom.bowAng = 2.6 + osc(t, 0.8) * 0.06;
      },
      walk(k, t, P) { SHARED.walk(k, t, P); P.custom.vUp = 0; P.custom.bowAng = 2.4; },
      windup(k, t, P) {
        P.custom.vUp = eo(k);
        P.armB = { a1: lerp(-0.2, 1.9, eo(k)), a2: lerp(0.4, 1.1, eo(k)) };
        P.armF = { a1: lerp(0.3, -0.9, eo(k)), a2: 0.3 };
        P.custom.bowAng = lerp(2.6, 1.0, eo(k));
        P.lean = -0.12 * eo(k);
        P.expr = 'mad';
      },
      strike(k, t, P) {
        const u = eo(clamp01(k * 1.6));
        P.custom.vUp = 1;
        P.lean = 0.38 * u;
        P.crouch = 0.3 * u;
        P.stance = 9;
        P.armB = { a1: 1.9, a2: 1.1 };
        P.armF = { a1: lerp(-0.9, 1.62, u), a2: lerp(0.3, -0.05, u) };
        P.custom.bowAng = lerp(1.0, 1.6, u);
        P.custom.bowThrust = u;
        P.expr = 'mad';
      },
      special(k, t, P) { // furious tremolo — note barrage
        P.custom.vUp = 1;
        P.armB = { a1: 1.9, a2: 1.1 };
        P.armF = { a1: 1.25 + osc(t, 11) * 0.3, a2: 0.25 };
        P.custom.bowAng = 1.35 + osc(t, 11) * 0.3;
        P.lean = 0.14;
        P.expr = 'mad';
        P.bob = Math.abs(osc(t, 11)) * 0.6;
      },
      hit: SHARED.hit, dodge: SHARED.dodge, block: SHARED.block,
      taunt(k, t, P) { SHARED.taunt(k, t, P); P.custom.vUp = 0; P.custom.bowAng = 1.5 + osc(t, 3) * 0.4; },
      die(k, t, P) {
        P.expr = 'ouch';
        if (k < 0.35) {
          const u = k / 0.35;
          P.lean = -0.3 * u; P.air = bell(u) * 3;
          P.armF = { a1: 2.5 * u, a2: 0.2 }; P.armB = { a1: -2.2 * u, a2: 0.2 };
        } else {
          const u = (k - 0.35) / 0.65;
          P.lie = ei(u);
          P.armF = { a1: 2.5, a2: 0.2 }; P.armB = { a1: -2.2, a2: 0.2 };
          if (u > 0.7) P.expr = 'ko';
        }
        P.custom.vUp = 0; P.custom.bowAng = 2.9;
      },
      dead: SHARED.dead, cheer: SHARED.cheer,
      win(k, t, P) {
        P.armF = { a1: 2.75, a2: 0.15 };
        P.armB = { a1: -2.75, a2: -0.15 };
        P.custom.vUp = 0; P.custom.vHeld = 'up';
        P.custom.bowAng = 0.3;
        P.air = Math.abs(osc(t, 2.4)) * 4;
        P.expr = 'happy';
      },
    },

    /* ---------- CELLIST (Knight) ---------- */
    N: {
      idle(k, t, P) {
        SHARED.idle(k, t, P);
        P.custom.cello = { x: 7, lift: 0, ang: 0.12 + osc(t, 0.8) * 0.015 };
        P.armF = { a1: 0.85, a2: 0.7 }; // hand resting on cello
      },
      walk(k, t, P) { // drags the cello along
        SHARED.walk(k, t, P);
        P.custom.cello = { x: 8, lift: Math.abs(osc(t, 4)) * 1.2, ang: 0.3 };
        P.armF = { a1: 0.9, a2: 0.55 };
      },
      ride(k, t, P) { // gallops astride the cello — the knight's leap
        P.custom.cello = { x: 0, lift: 9, ang: 1.45 };
        P.air = 8 + osc(t, 5) * 2;
        P.crouch = 0.55;
        P.stance = 11;
        P.lean = 0.3;
        P.armF = { a1: 1.3, a2: 0.4 };
        P.armB = { a1: 2.5, a2: 0.1 }; // arm waving like a rodeo rider
        P.expr = 'happy';
      },
      windup(k, t, P) {
        const u = eo(k);
        P.custom.cello = { x: 4, lift: 16 * u, ang: lerp(0.12, -0.5, u) };
        P.armF = { a1: lerp(0.85, 2.9, u), a2: 0.1 };
        P.armB = { a1: lerp(-0.2, 2.6, u), a2: 0.1 };
        P.lean = -0.18 * u;
        P.crouch = 0.1 * u;
        P.expr = 'mad';
      },
      strike(k, t, P) { // overhead cello slam
        const u = ei(clamp01(k * 1.4));
        P.custom.cello = { x: lerp(4, 11, u), lift: lerp(16, 0, u), ang: lerp(-0.5, 1.1, u) };
        P.armF = { a1: lerp(2.9, 0.9, u), a2: 0.2 };
        P.armB = { a1: lerp(2.6, 0.7, u), a2: 0.2 };
        P.lean = 0.35 * u;
        P.crouch = 0.4 * u;
        P.stance = 9;
        P.expr = 'mad';
      },
      special(k, t, P) { // cello cavalry charge
        POSES.N.ride(k, t, P);
        P.lean = 0.45;
        P.expr = 'mad';
      },
      hit(k, t, P) { SHARED.hit(k, t, P); P.custom.cello = { x: 9, lift: 0, ang: 0.5 + bell(k) * 0.4 }; },
      dodge(k, t, P) { SHARED.dodge(k, t, P); P.custom.cello = { x: 7, lift: bell(k) * 8, ang: 0.2 }; },
      block(k, t, P) { // hides behind the cello
        SHARED.block(k, t, P);
        P.custom.cello = { x: 6, lift: 2, ang: -0.05 };
        P.armF = { a1: 1.0, a2: 0.8 };
      },
      taunt(k, t, P) { SHARED.taunt(k, t, P); P.custom.cello = { x: 7, lift: 0, ang: 0.12 }; },
      die(k, t, P) {
        P.expr = 'ouch';
        const ca = ramp(k, 0, 0.4); // cello topples first
        P.custom.cello = { x: 7 + ca * 6, lift: 0, ang: 0.12 + ca * 1.35 };
        if (k > 0.3) {
          const u = (k - 0.3) / 0.7;
          P.lie = ei(u);
          P.armF = { a1: 2.0, a2: 0.3 }; P.armB = { a1: -1.5, a2: 0.3 };
          if (u > 0.7) P.expr = 'ko';
        } else {
          P.lean = -0.25 * (k / 0.3);
        }
      },
      dead(k, t, P) { SHARED.dead(k, t, P); P.custom.cello = { x: 13, lift: 0, ang: 1.47 }; },
      cheer: SHARED.cheer,
      win(k, t, P) {
        P.custom.cello = { x: 5, lift: 3 + Math.abs(osc(t, 4)) * 3, ang: osc(t, 1.2) * 0.4 };
        P.armF = { a1: 1.2, a2: 0.5 };
        P.armB = { a1: -2.7, a2: -0.1 };
        P.expr = 'happy';
        P.bob = Math.abs(osc(t, 4)) * 1.5;
      },
    },

    /* ---------- CLARINETIST (Bishop) ---------- */
    B: {
      idle(k, t, P) {
        SHARED.idle(k, t, P);
        P.custom.clAng = 0.06 + osc(t, 0.8) * 0.02; // staff held nearly vertical
        P.custom.clPlant = 1;
        // occasionally pushes up the glasses
        const g = osc(t, 0.21) > 0.93 ? 1 : 0;
        if (g) P.armB = { a1: 2.2, a2: 1.4 };
      },
      walk(k, t, P) { SHARED.walk(k, t, P); P.custom.clAng = 0.35; P.custom.clPlant = 0; P.armF = { a1: 0.7, a2: 0.5 }; },
      windup(k, t, P) {
        const u = eo(k);
        P.custom.clAng = lerp(0.06, 1.35, u);
        P.custom.clPlant = 0;
        P.armF = { a1: lerp(0.7, 1.8, u), a2: lerp(0.5, 0.7, u) };
        P.armB = { a1: lerp(-0.2, 1.5, u), a2: lerp(0.4, 0.9, u) };
        P.lean = -0.1 * u;
        P.headTilt = 0.18 * u;
        P.expr = 'mad';
      },
      strike(k, t, P) { // piercing spear thrust
        const u = eo(clamp01(k * 1.5));
        P.custom.clAng = 1.55;
        P.custom.clPlant = 0;
        P.custom.clThrust = u;
        P.lean = 0.32 * u;
        P.stance = 9;
        P.crouch = 0.22 * u;
        P.armF = { a1: lerp(1.8, 1.6, u), a2: lerp(0.7, -0.05, u) };
        P.armB = { a1: 1.4, a2: 0.8 };
        P.expr = 'mad';
      },
      special(k, t, P) { // note darts — rapid-fire toots
        P.custom.clAng = 1.3 + osc(t, 9) * 0.07;
        P.custom.clPlant = 0;
        P.armF = { a1: 1.7, a2: 0.45 };
        P.armB = { a1: 1.45, a2: 0.75 };
        P.lean = 0.1 - Math.max(0, osc(t, 9)) * 0.06;
        P.expr = 'puff';
      },
      hit: SHARED.hit, dodge: SHARED.dodge, block: SHARED.block,
      taunt(k, t, P) { SHARED.taunt(k, t, P); P.custom.clAng = 0.06; P.custom.clPlant = 1; P.armB = { a1: 2.2, a2: 1.4 }; },
      die(k, t, P) { // flung into a pirouette, lands flat
        P.expr = 'ouch';
        if (k < 0.55) {
          const u = k / 0.55;
          P.air = bell(u) * 13;
          P.spin = u * TAU * 1.5;
          P.armF = { a1: 2.4, a2: 0.2 }; P.armB = { a1: -2.4, a2: 0.2 };
        } else {
          const u = (k - 0.55) / 0.45;
          P.spin = TAU * 1.5;
          P.lie = eo(u);
          P.expr = u > 0.5 ? 'ko' : 'ouch';
        }
        P.custom.clAng = 1.0; P.custom.clPlant = 0;
      },
      dead: SHARED.dead, cheer: SHARED.cheer,
      win(k, t, P) { // baton-twirls the clarinet
        P.custom.clAng = t * 7;
        P.custom.clPlant = 0;
        P.custom.clTwirl = 1;
        P.armF = { a1: 1.9, a2: 0.1 };
        P.armB = { a1: -0.6, a2: 0.9 };
        P.expr = 'happy';
        P.bob = Math.abs(osc(t, 3)) * 1.2;
      },
    },

    /* ---------- PERCUSSIONIST (Rook) ---------- */
    R: {
      idle(k, t, P) {
        P.bob = osc(t, 0.7) * 0.5;
        // taps the bass drum now and then
        const tapping = osc(t, 0.45) > 0.4;
        P.armF = tapping ? { a1: 1.0 + Math.max(0, osc(t, 5)) * 0.4, a2: 0.8 } : { a1: 0.5, a2: 0.6 };
        P.armB = { a1: -0.3, a2: 0.5 };
      },
      walk(k, t, P) { // heavy stomps
        P.phase = (t * 1.5) % 1;
        P.bob = Math.abs(osc(t, 3)) * 2;
        P.armF = { a1: 0.4 + osc(t, 1.5) * 0.3, a2: 0.4 };
        P.armB = { a1: -0.4 - osc(t, 1.5) * 0.3, a2: 0.4 };
        P.lean = 0.1;
        P.stance = 6;
      },
      windup(k, t, P) {
        const u = eo(k);
        P.armF = { a1: lerp(0.5, 2.95, u), a2: 0.1 };
        P.armB = { a1: lerp(-0.3, 2.75, u), a2: 0.1 };
        P.bob = -2.5 * u; // rises onto toes
        P.lean = -0.1 * u;
        P.expr = 'mad';
      },
      strike(k, t, P) { // thunderous double-mallet slam
        const u = ei(clamp01(k * 1.5));
        P.armF = { a1: lerp(2.95, 0.7, u), a2: 0.15 };
        P.armB = { a1: lerp(2.75, 0.5, u), a2: 0.15 };
        P.crouch = 0.45 * u;
        P.lean = 0.3 * u;
        P.stance = 8;
        P.expr = 'mad';
      },
      special(k, t, P) { // cymbal clash
        const u = eo(clamp01(k * 1.4));
        P.custom.cym = 1;
        P.armF = { a1: lerp(0.2, 1.55, u), a2: 0.1 };
        P.armB = { a1: lerp(-0.2, 1.45, u), a2: 0.2 };
        P.lean = 0.18 * u;
        P.expr = 'mad';
      },
      hit(k, t, P) { // barely flinches — he's a wall
        P.lean = -0.18 * bell(k);
        P.flash = Math.max(0, 1 - k * 3);
        P.expr = 'mad';
      },
      dodge: SHARED.dodge,
      block(k, t, P) { SHARED.block(k, t, P); P.crouch = 0.2; },
      taunt(k, t, P) { // drum-roll taunt
        P.armF = { a1: 1.1 + osc(t, 8) * 0.25, a2: 0.7 };
        P.armB = { a1: 1.0 - osc(t, 8) * 0.25, a2: 0.7 };
        P.expr = 'happy';
      },
      die(k, t, P) { // timber! falls flat forward over his drum
        P.expr = 'ouch';
        if (k < 0.45) {
          const u = k / 0.45;
          P.lean = 0.12 * Math.sin(u * Math.PI * 4); // wobbles
        } else {
          const u = (k - 0.45) / 0.55;
          P.lie = -ei(u); // forward
          P.custom.broken = u > 0.8 ? 1 : 0;
          if (u > 0.8) P.expr = 'ko';
        }
        P.armF = { a1: 0.4, a2: 0.3 }; P.armB = { a1: -0.4, a2: 0.3 };
      },
      dead(k, t, P) { P.lie = -1; P.expr = 'ko'; P.custom.broken = 1; },
      cheer: SHARED.cheer,
      win(k, t, P) { // victory drum roll into cymbal pose
        if ((t % 2) < 1.4) {
          P.armF = { a1: 1.1 + osc(t, 10) * 0.3, a2: 0.7 };
          P.armB = { a1: 1.0 - osc(t, 10) * 0.3, a2: 0.7 };
        } else {
          P.custom.cym = 1;
          P.armF = { a1: 2.9, a2: 0.1 };
          P.armB = { a1: -2.9, a2: -0.1 };
        }
        P.expr = 'happy';
      },
    },

    /* ---------- PIANIST (Queen) ---------- */
    Q: {
      idle(k, t, P) {
        SHARED.idle(k, t, P);
        P.headTilt = 0.08;
        P.armF = { a1: 1.05 + osc(t, 1.6) * 0.06, a2: 1.0 }; // fingers poised on the keys
        P.armB = { a1: 0.95 - osc(t, 1.6) * 0.06, a2: 1.05 };
      },
      walk(k, t, P) { SHARED.walk(k, t, P); P.bob *= 0.6; P.armF = { a1: 0.9, a2: 1.0 }; },
      windup(k, t, P) { // arms thrown high before the great chord
        const u = eo(k);
        P.armF = { a1: lerp(1.05, 3.05, u), a2: 0.05 };
        P.armB = { a1: lerp(0.95, 2.9, u), a2: 0.05 };
        P.lean = -0.22 * u;
        P.headTilt = -0.25 * u;
        P.bob = -2 * u;
        P.expr = 'mad';
      },
      strike(k, t, P) { // fortissimo chord slam
        const u = ei(clamp01(k * 1.6));
        P.armF = { a1: lerp(3.05, 1.0, u), a2: lerp(0.05, 1.0, u) };
        P.armB = { a1: lerp(2.9, 0.9, u), a2: lerp(0.05, 1.05, u) };
        P.crouch = 0.3 * u;
        P.lean = 0.2 * u;
        P.expr = 'mad';
        P.custom.keysFlash = u;
      },
      special(k, t, P) { // summons the grand piano from the rafters
        P.armF = { a1: 2.9, a2: 0.15 };
        P.armB = { a1: 1.7, a2: 0.4 };
        P.headTilt = -0.3;
        P.lean = -0.12;
        P.expr = 'mad';
        P.bob = osc(t, 1.5) * 0.8;
      },
      hit: SHARED.hit, dodge: SHARED.dodge, block: SHARED.block,
      taunt(k, t, P) { // dismissive glissando flick
        P.armF = { a1: 1.2 + ((t * 2) % 1) * 0.9, a2: 0.6 };
        P.headTilt = 0.2;
        P.expr = 'happy';
      },
      die(k, t, P) { // the grand swoon
        P.expr = 'ouch';
        if (k < 0.45) {
          const u = k / 0.45;
          P.armF = { a1: lerp(1.0, 2.75, eo(u)), a2: lerp(1.0, -1.9, eo(u)) }; // hand to brow
          P.armB = { a1: -0.6 * u, a2: 0.3 };
          P.lean = -0.25 * u;
          P.headTilt = -0.3 * u;
        } else {
          const u = (k - 0.45) / 0.55;
          P.armF = { a1: 2.75, a2: -1.9 };
          P.lie = ei(u) * 0.999;
          P.expr = u > 0.6 ? 'ko' : 'ouch';
        }
      },
      dead: SHARED.dead, cheer: SHARED.cheer,
      win(k, t, P) { // deep elegant bow, then rises
        const c = (t % 2.4) / 2.4;
        const b = c < 0.5 ? eo(c * 2) : eo((1 - c) * 2);
        P.lean = 0.75 * b;
        P.headTilt = 0.3 * b;
        P.armF = { a1: -0.9 * b + 0.4, a2: 0.3 };
        P.armB = { a1: -1.1 * b - 0.2, a2: 0.2 };
        P.expr = 'happy';
      },
    },

    /* ---------- CONDUCTOR (King) ---------- */
    K: {
      idle(k, t, P) { // conducts a gentle andante
        P.bob = osc(t, 0.8) * 0.6;
        const beat = t * 1.6;
        P.armF = { a1: 1.6 + Math.sin(beat * TAU) * 0.45, a2: 0.35 + Math.cos(beat * TAU) * 0.2 };
        P.armB = { a1: 0.9, a2: 2.1 }; // hand on lapel
        P.custom.batAng = 1.2 + Math.sin(beat * TAU) * 0.5;
        P.headTilt = Math.sin(beat * TAU * 0.5) * 0.08;
      },
      walk(k, t, P) { SHARED.walk(k, t, P); P.custom.batAng = 1.0; P.lean = 0.12; },
      windup(k, t, P) { // baton raised — silence before the downbeat
        const u = eo(k);
        P.armF = { a1: lerp(1.6, 3.0, u), a2: 0.05 };
        P.armB = { a1: 0.9, a2: 2.1 };
        P.custom.batAng = lerp(1.2, 0.1, u);
        P.custom.batGlow = u;
        P.lean = -0.1 * u;
        P.bob = -1.5 * u;
        P.expr = 'mad';
      },
      strike(k, t, P) { // the downbeat — lightning crack
        const u = ei(clamp01(k * 1.7));
        P.armF = { a1: lerp(3.0, 1.35, u), a2: 0.1 };
        P.custom.batAng = lerp(0.1, 1.8, u);
        P.custom.batGlow = 1 - u * 0.5;
        P.armB = { a1: -0.5 * u, a2: 0.3 };
        P.lean = 0.22 * u;
        P.crouch = 0.15 * u;
        P.expr = 'mad';
      },
      special(k, t, P) { // tutti fortissimo — both arms command the orchestra
        P.armF = { a1: 2.9 + osc(t, 2) * 0.12, a2: 0.1 };
        P.armB = { a1: -2.9 - osc(t, 2, 1) * 0.12, a2: -0.1 };
        P.custom.batAng = 0.15;
        P.custom.batGlow = 1;
        P.lean = -0.15;
        P.expr = 'mad';
        P.bob = -1;
      },
      hit: SHARED.hit, dodge: SHARED.dodge, block: SHARED.block,
      taunt(k, t, P) { // taps the podium impatiently
        P.armF = { a1: 1.1 + Math.max(0, osc(t, 6)) * 0.25, a2: 0.9 };
        P.custom.batAng = 1.6;
        P.headTilt = 0.18;
        P.expr = 'mad';
      },
      die(k, t, P) { // the final bow — checkmate
        P.expr = 'ouch';
        if (k < 0.25) { // baton drops
          const u = k / 0.25;
          P.armF = { a1: lerp(1.6, 0.5, u), a2: 0.3 };
          P.custom.batDrop = u;
        } else if (k < 0.6) { // clutches chest, staggers
          const u = (k - 0.25) / 0.35;
          P.custom.batDrop = 1;
          P.armF = { a1: 1.5, a2: 1.9 };
          P.armB = { a1: 1.3, a2: 2.0 };
          P.lean = -0.15 * u;
          P.crouch = 0.3 * u;
          P.headTilt = -0.2 * u;
        } else { // sinks to knees, then down
          const u = (k - 0.6) / 0.4;
          P.custom.batDrop = 1;
          P.armF = { a1: 1.5, a2: 1.9 };
          P.crouch = 0.3 + 0.5 * eo(Math.min(1, u * 2));
          P.lie = u > 0.5 ? ei((u - 0.5) * 2) : 0;
          P.headTilt = -0.2 - 0.3 * u;
          if (u > 0.8) P.expr = 'ko';
        }
      },
      dead(k, t, P) { SHARED.dead(k, t, P); P.custom.batDrop = 1; },
      cheer: SHARED.cheer,
      win(k, t, P) { // bows graciously to the hall
        const c = (t % 2.8) / 2.8;
        const b = c < 0.4 ? eo(c / 0.4) : c < 0.7 ? 1 : eo((1 - c) / 0.3);
        P.lean = 0.65 * b;
        P.headTilt = 0.25 * b;
        P.armF = { a1: 0.9 - 0.5 * b, a2: 0.4 };
        P.armB = { a1: -1.3 * b - 0.2, a2: 0.2 };
        P.custom.batAng = 2.2;
        P.expr = 'happy';
      },
    },
  };

  /* ============================================================
     PAINTERS
     ============================================================ */

  function anchors(type, P) {
    const C = CHARS[type];
    const crouchDrop = P.crouch * C.legLen * 0.45;
    const hipY = -(C.legLen - crouchDrop) - P.bob;
    const neckX = Math.sin(P.lean) * C.torsoLen;
    const neckY = hipY - Math.cos(P.lean) * C.torsoLen;
    const headX = neckX + Math.sin(P.headTilt + P.lean * 0.5) * 2.5;
    const headY = neckY - C.headR - 1 + Math.abs(P.headTilt) * 1;
    return { hipY, neckX, neckY, headX, headY, C };
  }

  function drawLegs(h, type, pal, P, A) {
    const C = A.C;
    if (P.phase !== null) {
      const p1 = P.phase * TAU, p2 = p1 + Math.PI;
      const f1x = Math.sin(p1) * P.stride, f1l = Math.max(0, Math.sin(p1 + Math.PI / 2)) * 3.5;
      const f2x = Math.sin(p2) * P.stride, f2l = Math.max(0, Math.sin(p2 + Math.PI / 2)) * 3.5;
      drawLeg(h, -1, A.hipY, f2x, -f2l, C.limbW, pal);
      drawLeg(h, 1, A.hipY, f1x, -f1l, C.limbW, pal);
    } else {
      drawLeg(h, -1, A.hipY, -P.stance / 2, 0, C.limbW, pal);
      drawLeg(h, 1, A.hipY, P.stance / 2, 0, C.limbW, pal);
    }
  }

  function drawTorso(h, type, pal, P, A) {
    const C = A.C;
    // tailcoat tails
    h.l(-1, A.hipY, -C.shW - 3 + Math.sin(P.lean) * 3, A.hipY + 7, 4, pal.coatD);
    // torso capsule
    h.l(0, A.hipY + 1, A.neckX, A.neckY, C.shW * 1.9, pal.coat);
    // waistcoat / shirt front
    h.l(2, A.hipY, A.neckX + 2, A.neckY + 1, 2.5, pal.cuff);
    // trim sash
    h.l(-1, A.hipY - 1, A.neckX - 1, A.neckY + 2, 1.5, pal.trim);
    // buttons
    h.r(A.neckX + 2.5, (A.hipY + A.neckY) / 2, 1, 1, pal.trim);
  }

  function drawHead(h, type, pal, P, A, g) {
    const C = A.C, x = A.headX, y = A.headY, r = C.headR;
    h.d(x, y, r, C.skin);
    // hair / hats per character
    if (type === 'P') { // ponytail
      h.d(x - 1, y - r * 0.55, r * 0.85, C.hair);
      h.d(x - r - 1, y + 0.5, 2, C.hair);
      h.l(x - r - 1, y + 1, x - r - 2.5, y + 5, 2, C.hair);
    } else if (type === 'N') { // shaggy mop
      h.d(x - 0.5, y - r * 0.5, r * 0.95, C.hair);
      h.d(x - r * 0.7, y - 1, r * 0.45, C.hair);
      h.d(x + r * 0.5, y - r * 0.7, r * 0.5, C.hair);
    } else if (type === 'B') { // beret + round glasses
      h.d(x - 0.5, y - r * 0.75, r * 0.95, pal.trim);
      h.r(x - r, y - r * 0.85, r * 2, 1.5, pal.coatD);
      h.r(x - 1, y - r - 2.5, 2, 2, pal.coatD);
      g.strokeStyle = '#dfe6ee'; g.lineWidth = 1;
      g.strokeRect(Math.round(x + r * 0.25), Math.round(y - 2), 3, 3);
      g.strokeRect(Math.round(x - r * 0.55), Math.round(y - 2), 3, 3);
    } else if (type === 'R') { // bald, headband, beard
      h.r(x - r, y - 1, r * 2, 2, pal.trim);
      h.d(x + r * 0.35, y + r * 0.7, r * 0.5, C.hair);
    } else if (type === 'Q') { // high bun + earring
      h.d(x - 1, y - r * 0.6, r * 0.9, C.hair);
      h.d(x - 1.5, y - r - 2, r * 0.55, C.hair);
      h.r(x - r - 0.5, y + 2, 1, 2, pal.trim);
    } else if (type === 'K') { // wild maestro hair
      h.d(x - r * 0.8, y - r * 0.5, r * 0.55, C.hair);
      h.d(x + r * 0.2, y - r * 0.8, r * 0.6, C.hair);
      h.d(x - r * 1.05, y + 0.5, r * 0.4, C.hair);
      h.d(x - 0.4, y - r * 1.02, r * 0.45, C.hair);
      // bow tie at the neck
      h.r(A.neckX - 1, A.neckY - 0.5, 3, 2, type === 'K' ? '#222' : pal.trim);
    }
    // face — drawn on the leading side
    const fx = x + r * 0.45, fy = y - 0.5;
    const ink = '#2a1c10';
    if (P.expr === 'ko') {
      g.fillStyle = ink;
      g.fillRect(Math.round(fx - 1), Math.round(fy - 1), 1, 1);
      g.fillRect(Math.round(fx + 1), Math.round(fy + 1), 1, 1);
      g.fillRect(Math.round(fx + 1), Math.round(fy - 1), 1, 1);
      g.fillRect(Math.round(fx - 1), Math.round(fy + 1), 1, 1);
    } else if (P.expr === 'mad') {
      h.r(fx - 1, fy - 1.5, 3, 1, ink);   // brow
      h.r(fx, fy, 2, 2, ink);             // eye
      h.r(fx, fy + 3, 2, 1, ink);         // grim mouth
    } else if (P.expr === 'ouch') {
      h.r(fx, fy, 2, 1, ink);
      h.d(fx + 0.5, fy + 3.5, 1.2, ink);  // open mouth
    } else if (P.expr === 'happy') {
      h.r(fx, fy, 2, 2, ink);
      h.r(fx - 0.5, fy + 3, 3, 1, ink);
    } else if (P.expr === 'puff') {
      h.r(fx, fy, 2, 1, ink);
      h.d(x + r * 0.7, y + 2, 2, C.skin); // puffed cheek
    } else {
      h.r(fx, fy, 2, 2, ink);
    }
  }

  /* ---------- instruments ---------- */
  const WOOD = '#9c5a23', WOOD_D = '#6e3c14', WOOD_L = '#c97f3a';

  function drawViolin(h, x, y, ang, scale = 1) {
    // body: two lobes, neck along ang
    const s = scale;
    h.d(x, y, 3.2 * s, WOOD);
    h.d(x + Math.sin(ang) * 4 * s, y + Math.cos(ang) * 4 * s, 2.6 * s, WOOD);
    h.l(x, y, x + Math.sin(ang) * 9.5 * s, y + Math.cos(ang) * 9.5 * s, 1.4, WOOD_D);
    h.r(x + Math.sin(ang) * 9.5 * s - 1, y + Math.cos(ang) * 9.5 * s - 1, 2, 2, '#2a1708');
    h.r(x - 1, y, 2, 1, WOOD_D); // bridge
  }
  function drawBow(h, hand, ang, len = 12) {
    const tx = hand.x + Math.sin(ang) * len, ty = hand.y - Math.cos(ang) * len;
    h.l(hand.x, hand.y, tx, ty, 1.2, '#e8dcc0');
    h.r(hand.x - 1, hand.y - 1, 2, 2, '#3a2410');
  }
  function drawCello(h, baseX, baseY, lift, ang, pal) {
    // pivots at the endpin on the ground
    const px = baseX, py = baseY - lift;
    const dir = (d) => ({ x: px + Math.sin(ang) * d, y: py - Math.cos(ang) * d });
    const spike = dir(-2.5), low = dir(7), mid = dir(13), neckEnd = dir(26), scrollP = dir(28);
    h.l(px, py, spike.x, spike.y, 1.5, '#888');         // endpin
    h.d(low.x, low.y, 6.2, WOOD);                        // lower bout
    h.d(mid.x, mid.y, 4.8, WOOD);                        // upper bout
    h.d(low.x, low.y, 6.2 - 1.4, WOOD_L);
    h.d(mid.x, mid.y, 4.8 - 1.4, WOOD_L);
    h.l(dir(4).x, dir(4).y, dir(16).x, dir(16).y, 1, WOOD_D); // strings/fingerboard
    h.l(mid.x, mid.y, neckEnd.x, neckEnd.y, 2, WOOD_D);  // neck
    h.d(scrollP.x, scrollP.y, 1.8, '#2a1708');           // scroll
    h.r(low.x - 2, low.y - 1, 4, 1.4, WOOD_D);           // bridge
  }
  function drawClarinet(h, hand, ang, thrust = 0, plant = 0, baseY = 0) {
    let x0 = hand.x, y0 = hand.y;
    if (plant) { x0 = hand.x; y0 = baseY; } // staff planted on the ground
    const len = 16 + thrust * 4;
    const dx = Math.sin(ang), dy = -Math.cos(ang);
    const tx = x0 + dx * len, ty = y0 + dy * len;
    h.l(x0, y0, tx, ty, 2.2, '#181820');
    for (let i = 4; i < len - 3; i += 3) h.r(x0 + dx * i, y0 + dy * i, 1, 1, '#c9ced8'); // keys
    h.d(tx, ty, 2.4, '#181820'); // bell
    h.d(tx, ty, 1.2, '#0a0a10');
  }
  function drawDrum(h, g, cx, cy, broken, pal) {
    h.d(cx, cy, 8, '#7a3b16');                 // shell rim
    if (!broken) {
      h.d(cx, cy, 6.4, '#e8dcc4');             // head
      h.d(cx, cy, 6.4 - 1.2, '#f4ecd9');
    } else {
      h.d(cx, cy, 6.4, '#1c1208');             // burst-through hole
    }
    // tension lugs
    for (let a = 0; a < TAU; a += TAU / 6) {
      h.r(cx + Math.cos(a) * 7 - 0.5, cy + Math.sin(a) * 7 - 0.5, 1.4, 1.4, pal.trim);
    }
  }
  function drawMallet(h, hand, ang) {
    const tx = hand.x + Math.sin(ang) * 8, ty = hand.y - Math.cos(ang) * 8;
    h.l(hand.x, hand.y, tx, ty, 1.4, '#caa46a');
    h.d(tx, ty, 2.4, '#b03a30');
  }
  function drawCymbal(h, g, hand) {
    h.d(hand.x + 1, hand.y - 1, 4.5, '#e3b341');
    h.d(hand.x + 1, hand.y - 1, 2.5, '#f4d27a');
    h.r(hand.x + 0.5, hand.y - 1.5, 1.4, 1.4, '#8a6420');
  }
  function drawKeytray(h, g, A, P, pal) {
    // a strap-on key harness — the pianist's travelling keyboard
    const y = A.hipY - 2.5, x0 = 2, w = 13;
    h.l(x0 + 1, y - 1, A.neckX - 1, A.neckY + 1, 1, pal.coatD); // strap
    h.r(x0, y, w, 4, '#1a1a22');
    h.r(x0 + 0.5, y + 0.5, w - 1, 2.4, '#f4efe2');
    for (let i = 2; i < w - 1; i += 2.5) h.r(x0 + i, y + 0.5, 1, 1.4, '#1a1a22');
    if (P.custom.keysFlash) {
      g.fillStyle = `rgba(255,240,160,${0.7 * P.custom.keysFlash})`;
      g.fillRect(Math.round(x0), Math.round(y - 1), Math.round(w), 6);
    }
  }
  function drawBaton(h, g, hand, ang, glow) {
    const tx = hand.x + Math.sin(ang) * 9, ty = hand.y - Math.cos(ang) * 9;
    if (glow) {
      g.fillStyle = `rgba(255,235,150,${0.35 * glow})`;
      h.d(tx, ty, 3.5, g.fillStyle);
    }
    h.l(hand.x, hand.y, tx, ty, 1, '#f4ecd9');
    h.r(hand.x - 1, hand.y - 1, 2, 2, '#26160a');
  }

  /* ---------- per-character full paint ---------- */
  function paintChar(g, type, color, P) {
    const pal = TEAM[color];
    const C = CHARS[type];
    const h = prims(g);
    const A = anchors(type, P);
    A.C = C;
    const cu = P.custom;

    const shB = { x: A.neckX - 2, y: A.neckY + 1.5 };
    const shF = { x: A.neckX + 2, y: A.neckY + 1.5 };
    const uL = C.torsoLen * 0.5 + 2, fL = C.torsoLen * 0.5 + 1.5;

    let handB = null, handF = null;

    // ---- behind-body layers ----
    if (type === 'N' && cu.cello && cu.cello.ang > 1.2) {
      drawCello(h, cu.cello.x, -cu.cello.lift, 0, cu.cello.ang, pal); // fallen cello behind
    }
    handB = drawArm(h, shB.x, shB.y, P.armB.a1, P.armB.a2, uL, fL, C.limbW, pal, C.skin);
    if (type === 'P' && !cu.vUp && cu.vHeld !== 'up') drawViolin(h, handB.x, handB.y + 1, 2.8, 0.9);
    if (type === 'R') drawMallet(h, handB, P.armB.a1 + P.armB.a2);
    if (type === 'R' && cu.cym) drawCymbal(h, g, handB);

    // ---- body ----
    drawLegs(h, type, pal, P, A);
    drawTorso(h, type, pal, P, A);
    if (type === 'Q') drawKeytray(h, g, A, P, pal);
    if (type === 'R') drawDrum(h, g, 5, A.hipY - C.torsoLen * 0.45, cu.broken, pal);
    drawHead(h, type, pal, P, A, g);

    // ---- cello (in front of body, behind front arm) ----
    if (type === 'N' && cu.cello && cu.cello.ang <= 1.2) {
      drawCello(h, cu.cello.x, -cu.cello.lift, 0, cu.cello.ang, pal);
    }
    // violin under the chin
    if (type === 'P' && cu.vUp) {
      const vx = A.headX + 2, vy = A.neckY + 2;
      drawViolin(h, vx, vy, 1.9, 0.85 * cu.vUp + 0.15);
    }
    if (type === 'P' && cu.vHeld === 'up') drawViolin(h, shB.x - 3, shB.y - C.torsoLen - 4, 2.9, 0.9);

    // ---- front arm + handheld instruments ----
    handF = drawArm(h, shF.x, shF.y, P.armF.a1, P.armF.a2, uL, fL, C.limbW, pal, C.skin);
    if (type === 'P') {
      const bowLen = 12 + (cu.bowThrust || 0) * 4;
      drawBow(h, handF, cu.bowAng ?? 2.6, bowLen);
    } else if (type === 'B') {
      if (cu.clTwirl) drawClarinet(h, handF, cu.clAng, 0, 0, 0);
      else drawClarinet(h, handF, cu.clAng ?? 0.06, cu.clThrust || 0, cu.clPlant || 0, -0.5);
    } else if (type === 'R') {
      drawMallet(h, handF, P.armF.a1 + P.armF.a2);
      if (cu.cym) drawCymbal(h, g, handF);
    } else if (type === 'K') {
      if (!cu.batDrop) drawBaton(h, g, handF, cu.batAng ?? 1.2, cu.batGlow || 0);
      else if (cu.batDrop < 1) {
        const u = cu.batDrop;
        h.l(handF.x + u * 6, handF.y + u * 14, handF.x + u * 6 + 4, handF.y + u * 14 + 3, 1, '#f4ecd9');
      } else {
        h.l(6, -1, 10, 0, 1, '#f4ecd9'); // baton on the floor
      }
    }
  }

  /* ============================================================
     RENDER PIPELINE — paint to a low-res buffer, upscale crisp.
     ============================================================ */
  let buf = null, bufG = null;
  const BUF_W = 110, BUF_H = 110, FOOT_X = 55, FOOT_Y = 96;

  function ensureBuf() {
    if (buf) return;
    buf = document.createElement('canvas');
    buf.width = BUF_W; buf.height = BUF_H;
    bufG = buf.getContext('2d');
  }

  function computePose(type, action, k, t, extra) {
    const P = basePose();
    const fn = (POSES[type] && POSES[type][action]) || SHARED[action] || SHARED.idle;
    fn(clamp01(k), t, P);
    if (extra) {
      if (extra.flash != null) P.flash = Math.max(P.flash, extra.flash);
      if (extra.expr) P.expr = extra.expr;
      if (extra.alpha != null) P.alpha = extra.alpha;
    }
    return P;
  }

  const Sprites = {
    TEAM, CHARS, POSES,

    render(ctx, type, color, action, k, t, x, y, scale, flip, extra) {
      ensureBuf();
      const P = computePose(type, action, k, t, extra);
      bufG.clearRect(0, 0, BUF_W, BUF_H);
      bufG.save();
      bufG.translate(FOOT_X, FOOT_Y);
      if (P.lie) {
        bufG.rotate(P.lie * -1.5);
      }
      if (P.spin) {
        const cy = -CHARS[type].legLen - 6;
        bufG.translate(0, cy); bufG.rotate(P.spin); bufG.translate(0, -cy);
      }
      paintChar(bufG, type, color, P);
      bufG.restore();
      // hit flash
      if (P.flash > 0) {
        bufG.save();
        bufG.globalCompositeOperation = 'source-atop';
        bufG.fillStyle = `rgba(255,255,255,${0.85 * P.flash})`;
        bufG.fillRect(0, 0, BUF_W, BUF_H);
        bufG.restore();
      }
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = P.alpha;
      ctx.translate(x, y - P.air * scale);
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(buf, -FOOT_X * scale, -FOOT_Y * scale, BUF_W * scale, BUF_H * scale);
      ctx.restore();
      return P;
    },

    // shadow ellipse helper (draw before character)
    shadow(ctx, x, y, scale, air = 0) {
      ctx.save();
      const sq = 1 / (1 + air * 0.08);
      ctx.fillStyle = `rgba(0,0,0,${0.30 * sq})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 14 * scale * sq, 4.5 * scale * sq, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    },

    drawIcon(canvas, type, color) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = canvas.height / 64;
      this.render(ctx, type, color, 'idle', 0, 0.4, canvas.width / 2, canvas.height - 4 * scale, scale, false);
    },

    charName(type) { return CHARS[type].name; },
  };

  MG.Sprites = Sprites;
})();
