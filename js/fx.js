/* ============================================================
   Maestro's Gambit — fx.js
   Particle & special-effect toolkit shared by the board view
   and the battle stage: music notes, shockwaves, sparks,
   lightning, the falling grand piano, the final curtain…
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);

  /* Draw a chunky pixel eighth-note at (x, y), size s, color c. */
  function drawNote(ctx, x, y, s, c, variant = 0) {
    ctx.fillStyle = c;
    const u = s / 4;
    // note head
    ctx.fillRect(Math.round(x - 2 * u), Math.round(y), Math.round(3 * u), Math.round(2 * u));
    // stem
    ctx.fillRect(Math.round(x + u * 0.6), Math.round(y - 5 * u), Math.round(u), Math.round(6 * u));
    // flag
    if (variant % 2 === 0) {
      ctx.fillRect(Math.round(x + u * 1.4), Math.round(y - 5 * u), Math.round(2 * u), Math.round(u));
      ctx.fillRect(Math.round(x + u * 2.2), Math.round(y - 4.4 * u), Math.round(u), Math.round(1.6 * u));
    }
    if (variant === 2) { // double note (beamed pair)
      ctx.fillRect(Math.round(x + 3 * u), Math.round(y + u), Math.round(3 * u), Math.round(2 * u));
      ctx.fillRect(Math.round(x + 5.6 * u), Math.round(y - 4 * u), Math.round(u), Math.round(6 * u));
      ctx.fillRect(Math.round(x + u * 1.4), Math.round(y - 5 * u), Math.round(5 * u), Math.round(u));
    }
  }

  class FXLayer {
    constructor() {
      this.parts = [];
      this.shakeT = 0;
      this.shakeAmp = 0;
      this.flashT = 0;
      this.flashCol = '#fff';
      this.popups = [];
    }

    clear() { this.parts.length = 0; this.popups.length = 0; this.shakeT = 0; this.flashT = 0; }

    shake(amp = 6, dur = 0.3) { this.shakeAmp = Math.max(this.shakeAmp, amp); this.shakeT = Math.max(this.shakeT, dur); }
    flash(col = 'rgba(255,255,255,0.5)', dur = 0.12) { this.flashCol = col; this.flashT = dur; }

    popup(x, y, text, col = '#ffd98a', size = 26, dur = 1.1) {
      this.popups.push({ x, y, text, col, size, t: 0, dur });
    }

    add(p) { this.parts.push(Object.assign({ t: 0, vx: 0, vy: 0, g: 0, fade: 1, rot: 0, vrot: 0 }, p)); }

    /* ---------- emitters ---------- */
    notes(x, y, n, col, opts = {}) {
      for (let i = 0; i < n; i++) {
        this.add({
          kind: 'note', x: x + rand(-8, 8), y: y + rand(-8, 8),
          vx: opts.vx ?? rand(-40, 40), vy: opts.vy ?? rand(-90, -30),
          g: opts.g ?? 60, life: opts.life ?? rand(0.7, 1.3),
          size: opts.size ?? rand(8, 15), col, variant: (Math.random() * 3) | 0,
          wob: rand(2, 5),
        });
      }
    }
    noteShot(x, y, tx, ty, col, speed = 420, size = 13) {
      const d = Math.hypot(tx - x, ty - y) || 1;
      this.add({
        kind: 'note', x, y, vx: ((tx - x) / d) * speed, vy: ((ty - y) / d) * speed,
        g: 0, life: d / speed, size, col, variant: (Math.random() * 3) | 0, wob: 6,
      });
    }
    sparks(x, y, n, col = '#ffd98a') {
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), v = rand(60, 240);
        this.add({
          kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50,
          g: 320, life: rand(0.3, 0.7), size: rand(1.5, 3.5), col,
        });
      }
    }
    stars(x, y, n, col = '#fff3c2') {
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), v = rand(20, 120);
        this.add({
          kind: 'star', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
          g: 60, life: rand(0.6, 1.2), size: rand(3, 6), col, vrot: rand(-4, 4),
        });
      }
    }
    ring(x, y, col = 'rgba(255,217,138,0.8)', r0 = 6, r1 = 90, dur = 0.45, w = 4) {
      this.add({ kind: 'ring', x, y, r0, r1, life: dur, col, w });
    }
    dust(x, y, n = 8, col = 'rgba(180,160,130,0.5)') {
      for (let i = 0; i < n; i++) {
        this.add({
          kind: 'dust', x: x + rand(-10, 10), y: y + rand(-2, 2),
          vx: rand(-50, 50), vy: rand(-36, -6), g: -16,
          life: rand(0.4, 0.9), size: rand(3, 7), col,
        });
      }
    }
    lightning(x0, y0, x1, y1, col = '#fff8c8', dur = 0.22) {
      const segs = [];
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        segs.push({
          x: x0 + (x1 - x0) * u + (i && i < n ? rand(-14, 14) : 0),
          y: y0 + (y1 - y0) * u + (i && i < n ? rand(-10, 10) : 0),
        });
      }
      this.add({ kind: 'bolt', segs, life: dur, col, x: x0, y: y0 });
    }
    pianoDrop(x, groundY, dur = 0.55) {
      this.add({ kind: 'piano', x, y: groundY - 560, ty: groundY, life: dur + 1.4, fallDur: dur, size: 1 });
    }
    curtain(closeDur = 2.2, hold = 0) {
      this.add({ kind: 'curtain', x: 0, y: 0, fallDur: closeDur, life: closeDur + hold });
    }
    confetti(x, y, n = 26) {
      const cols = ['#e8b54a', '#c0392b', '#7ec4cf', '#e3e3e3', '#9b59b6'];
      for (let i = 0; i < n; i++) {
        this.add({
          kind: 'confetti', x: x + rand(-30, 30), y,
          vx: rand(-90, 90), vy: rand(-260, -120), g: 300,
          life: rand(1.0, 2.0), size: rand(2.5, 5),
          col: cols[(Math.random() * cols.length) | 0], vrot: rand(-8, 8),
        });
      }
    }

    /* ---------- sim + draw ---------- */
    update(dt) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      if (this.shakeT === 0) this.shakeAmp = 0;
      this.flashT = Math.max(0, this.flashT - dt);
      for (const p of this.parts) {
        p.t += dt;
        if (p.kind === 'piano') {
          const u = Math.min(1, p.t / p.fallDur);
          p.y = p.ty - (1 - u * u) * 560;
        } else if (p.kind !== 'ring' && p.kind !== 'bolt' && p.kind !== 'curtain') {
          p.vy += (p.g || 0) * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.wob) p.x += Math.sin(p.t * p.wob) * 18 * dt;
          p.rot += (p.vrot || 0) * dt;
        }
      }
      this.parts = this.parts.filter((p) => p.t < p.life);
      for (const p of this.popups) p.t += dt;
      this.popups = this.popups.filter((p) => p.t < p.dur);
    }

    shakeOffset() {
      if (this.shakeT <= 0) return [0, 0];
      const a = this.shakeAmp * (this.shakeT / 0.3);
      return [rand(-a, a), rand(-a, a)];
    }

    draw(ctx) {
      for (const p of this.parts) {
        const u = p.t / p.life;
        const alpha = p.kind === 'bolt' ? (u < 0.5 ? 1 : 2 - u * 2) : 1 - u * u;
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        switch (p.kind) {
          case 'note':
            drawNote(ctx, p.x, p.y, p.size, p.col, p.variant);
            break;
          case 'spark':
            ctx.fillStyle = p.col;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            break;
          case 'star': {
            ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.fillStyle = p.col;
            const s = p.size;
            ctx.fillRect(-s / 2, -s / 6, s, s / 3);
            ctx.fillRect(-s / 6, -s / 2, s / 3, s);
            break;
          }
          case 'ring': {
            const r = p.r0 + (p.r1 - p.r0) * (1 - (1 - u) * (1 - u));
            ctx.strokeStyle = p.col;
            ctx.lineWidth = p.w * (1 - u) + 1;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, r, r * 0.45, 0, 0, TAU);
            ctx.stroke();
            break;
          }
          case 'dust':
          case 'confetti': {
            ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
            ctx.fillStyle = p.col;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * (p.kind === 'confetti' ? 0.6 : 1));
            break;
          }
          case 'bolt': {
            ctx.strokeStyle = p.col;
            ctx.lineWidth = 3;
            ctx.beginPath();
            p.segs.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 1;
            ctx.stroke();
            break;
          }
          case 'piano':
            this.drawPiano(ctx, p.x, p.y, u);
            break;
          case 'curtain': {
            // red velvet curtain descends over the whole view, then holds.
            // Use logical (CSS-px) canvas size; the ctx carries a dpr transform.
            const dpr = MG.dpr || 1;
            const cw = ctx.canvas.width / dpr, ch = ctx.canvas.height / dpr;
            const h = ch * Math.min(1, p.t / p.fallDur);
            ctx.globalAlpha = 1;
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, '#5d1212');
            grad.addColorStop(1, '#8c1f1f');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, cw, h);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            for (let x = 0; x < cw; x += 46) ctx.fillRect(x, 0, 12, h);
            ctx.fillStyle = '#d9a93f';
            ctx.fillRect(0, Math.max(0, h - 8), cw, 8);
            break;
          }
        }
        ctx.restore();
      }
      // text popups
      for (const p of this.popups) {
        const u = p.t / p.dur;
        ctx.save();
        ctx.globalAlpha = u < 0.15 ? u / 0.15 : 1 - Math.max(0, (u - 0.6) / 0.4);
        ctx.font = `italic bold ${p.size}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#120a16';
        ctx.fillText(p.text, p.x + 2, p.y - u * 30 + 2);
        ctx.fillStyle = p.col;
        ctx.fillText(p.text, p.x, p.y - u * 30);
        ctx.restore();
      }
    }

    drawFlash(ctx) {
      if (this.flashT > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, this.flashT / 0.12);
        ctx.fillStyle = this.flashCol;
        const dpr = MG.dpr || 1;
        ctx.fillRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);
        ctx.restore();
      }
    }

    /* the queen's signature: a grand piano, delivered express */
    drawPiano(ctx, x, y, u) {
      ctx.save();
      ctx.translate(x, y);
      const s = 1.5;
      ctx.scale(s, s);
      // body
      ctx.fillStyle = '#15151c';
      ctx.beginPath();
      ctx.moveTo(-44, 0); ctx.lineTo(44, 0); ctx.lineTo(44, -26);
      ctx.lineTo(10, -30); ctx.lineTo(-30, -26); ctx.lineTo(-44, -18);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#26262f';
      ctx.fillRect(-44, -19, 88, 5);
      // keys
      ctx.fillStyle = '#f4efe2';
      ctx.fillRect(-42, -14, 84, 6);
      ctx.fillStyle = '#15151c';
      for (let k = -40; k < 42; k += 5) ctx.fillRect(k, -14, 2, 3.6);
      // legs
      ctx.fillStyle = '#15151c';
      ctx.fillRect(-38, 0, 5, 10); ctx.fillRect(33, 0, 5, 10); ctx.fillRect(-2, 0, 5, 10);
      // lid prop
      ctx.fillStyle = '#1d1d26';
      ctx.beginPath();
      ctx.moveTo(-30, -26); ctx.lineTo(30, -56); ctx.lineTo(44, -26);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  MG.FXLayer = FXLayer;
  MG.drawNote = drawNote;
})();
