/* ============================================================
   Maestro's Gambit — reel.js
   The "attract mode" TRAILER REEL: a scripted, music-synced
   timeline that drives the existing battle pipeline so a single
   screen-recording is a finished ~30-second trailer.

   Reuses MG.BattleScene for the choreography clips and draws its
   own wordmark sting + gold title cards in between. Every cut is
   placed on a beat of the Overture (84 bpm) so the edit feels
   synced even when audio is muted (headless capture) — the
   timeline is its own deterministic clock; the music is just the
   spine. Skippable (click / Esc) and loopable.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});

  // Tuned to TRACKS[0] "Overture in Amber" (84 bpm). One beat ≈ 0.714s; the
  // synth loop is 16 beats, so the music repeats cleanly under the reel.
  const BPM = 84;
  const BEAT = 60 / BPM;
  const TRACK_ID = 0;

  const GOLD = '#e8b54a';
  const GOLD_BRIGHT = '#ffd98a';
  const PARCHMENT = '#f3e7c9';

  /* The script. Each segment is sized in BEATS and cut at its dramatic peak
     (clips are deliberately shorter than the choreography's own curtain), so
     the reel stays punchy. Battle clips get a `speed` so the money shot
     (piano drop / drum-off crash / grand curtain / star morph) lands inside
     the window — verified with headless stills. */
  function buildScript() {
    return [
      { kind: 'sting', beats: 5 },
      { kind: 'card', beats: 4, lines: ['Two orchestras.', 'One board.'] },
      { kind: 'battle', beats: 7, speed: 1.25,
        start: (B) => B.start({ t: 'Q', c: 'w' }, { t: 'K', c: 'b' }, { altIndex: 0 }) },
      { kind: 'battle', beats: 6, speed: 1.3,
        start: (B) => B.start({ t: 'R', c: 'b' }, { t: 'R', c: 'w' }, { altIndex: 0 }) },
      { kind: 'card', beats: 4, lines: ['Every capture,', 'a performance.'] },
      { kind: 'battle', beats: 8, speed: 1.7,
        start: (B) => B.start({ t: 'K', c: 'w' }, { t: 'K', c: 'b' }, { checkmate: true, altIndex: 0 }) },
      { kind: 'battle', beats: 6, speed: 1.2,
        start: (B) => B.startStar('w', 'Q', {}) },
      { kind: 'card', beats: 6, finale: true,
        lines: ["Maestro's Gambit", 'Wishlist on Steam'] },
    ];
  }

  class Reel {
    constructor(canvas, battle) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.battle = battle;
      this.au = MG.Audio;
      this.fxl = new MG.FXLayer();
      this.active = false;
      this.loop = true;
      this.onExit = () => {};
      this.t = 0;
      this.cur = null;
      this.segments = [];
      this.total = 0;
    }

    dims() {
      const dpr = MG.dpr || 1;
      return { W: this.canvas.width / dpr, H: this.canvas.height / dpr, dpr };
    }

    /* (re)build the timeline with absolute start times and begin playback */
    start(opts = {}) {
      this.loop = opts.loop !== false;
      this.onExit = opts.onExit || (() => {});
      const segs = buildScript();
      let t = 0;
      for (const s of segs) { s.t0 = t; s.dur = s.beats * BEAT; t += s.dur; }
      this.segments = segs;
      this.total = t;
      this.t = 0;
      this.cur = null;
      this.active = true;
      this.fxl.clear();
      // start the spine: the bundled Overture, from the top
      if (opts.audio !== false && this.au) {
        try {
          this.au.setMusicTrack(TRACK_ID);
          this.au.startBoardMusic();
        } catch (e) { /* audio is best-effort; the reel runs silent without it */ }
      }
    }

    stop() {
      this.active = false;
      if (this.battle) this.battle.active = false;
    }

    /* skip / exit (click or Esc) */
    skip() {
      if (!this.active) return;
      this.stop();
      this.onExit();
    }

    restart() {
      this.t = 0;
      this.cur = null;
      this.fxl.clear();
    }

    segAt(t) {
      for (const s of this.segments) if (t >= s.t0 && t < s.t0 + s.dur) return s;
      return this.segments[this.segments.length - 1] || null;
    }

    enter(seg) {
      // a gold beat-accent flash punctuates every cut
      this.fxl.flash('rgba(255,236,180,0.32)', 0.2);
      if (seg.kind === 'battle') {
        seg.start(this.battle);
        this.battle.suppressBanner = true;     // no per-duel banner in the trailer
        this.battle.baseSpeed = seg.speed || 1;
        this.battle.onDone = () => {};          // the reel owns the cut, not the scene
      } else if (this.battle) {
        this.battle.active = false;            // card / sting: the reel draws itself
      }
    }

    update(dt) {
      if (!this.active) return;
      this.t += dt;
      if (this.t >= this.total) {
        if (this.loop) { this.restart(); }
        else { this.skip(); return; }
      }
      const seg = this.segAt(this.t);
      if (seg !== this.cur) { this.enter(seg); this.cur = seg; }
      if (this.cur && this.cur.kind === 'battle' && this.battle.active) {
        this.battle.update(dt);
      }
      this.fxl.update(dt);
    }

    /* advance to an absolute time by stepping in fixed ticks — used by the
       headless still/GIF capture hooks so a frame is reproducible. */
    seek(target, step = 1 / 60) {
      this.t = 0; this.cur = null; this.fxl.clear();
      for (let elapsed = 0; elapsed < target; elapsed += step) {
        this.update(Math.min(step, target - elapsed));
      }
    }

    /* ---------------- drawing ---------------- */
    draw() {
      const seg = this.cur || this.segments[0];
      if (seg && seg.kind === 'battle' && this.battle.active) {
        this.battle.draw();
      } else if (seg && seg.kind === 'card') {
        this.drawCard(seg, this.t - seg.t0);
      } else {
        this.drawSting(seg ? this.t - seg.t0 : 0);
      }
      // beat-accent flash + the persistent skip hint sit on top of everything
      const { W, H, dpr } = this.dims();
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.fxl.drawFlash(this.ctx);
      this.drawSkipHint(W, H);
    }

    /* shared velvet backdrop + vignette to match the title screen */
    drawBackdrop(ctx, W, H, glowPulse = 0) {
      let g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0c0712');
      g.addColorStop(0.6, '#1d1028');
      g.addColorStop(1, '#2c163a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      const rg = ctx.createRadialGradient(W / 2, H * 0.5, 40, W / 2, H * 0.5, W * 0.6);
      rg.addColorStop(0, `rgba(232,181,74,${0.12 + glowPulse})`);
      rg.addColorStop(1, 'rgba(232,181,74,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);

      // staff lines, faint
      ctx.strokeStyle = 'rgba(232,181,74,0.06)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = H * 0.42 + i * 13;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
    }

    drawSting(st) {
      const { W, H, dpr } = this.dims();
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pulse = 0.08 + 0.05 * Math.sin(st * 3);
      this.drawBackdrop(ctx, W, H, pulse);

      // the wordmark scales up and settles, with a gold glow
      const grow = Math.min(1, st / 0.9);
      const scale = 0.7 + 0.3 * (1 - (1 - grow) * (1 - grow));   // ease-out
      const alpha = Math.min(1, st / 0.5);
      const cx = W / 2, cy = H * 0.46;
      const big = Math.max(40, Math.min(W * 0.13, 96)) * scale;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // clef flourish above
      ctx.font = `${big * 0.9}px 'Maestro Heading', Georgia, serif`;
      ctx.fillStyle = GOLD;
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillText('𝄞', cx, cy - big * 1.25);
      ctx.globalAlpha = alpha;

      ctx.font = `bold ${big}px 'Maestro Display', Georgia, serif`;
      ctx.shadowColor = 'rgba(232,181,74,0.7)';
      ctx.shadowBlur = 26 + 18 * Math.sin(st * 3);
      ctx.fillStyle = GOLD_BRIGHT;
      ctx.fillText("MAESTRO'S", cx, cy - big * 0.05);
      ctx.fillText('GAMBIT', cx, cy + big * 0.95);
      ctx.shadowBlur = 0;

      // tagline fades in a beat later
      const tA = Math.max(0, Math.min(1, (st - 0.8) / 0.7));
      ctx.globalAlpha = tA;
      ctx.fillStyle = PARCHMENT;
      ctx.font = `italic ${Math.max(13, W * 0.022)}px 'Maestro Heading', Georgia, serif`;
      ctx.fillText('A Symphonic Battle of Wits', cx, cy + big * 1.9);
      ctx.restore();
    }

    drawCard(seg, st) {
      const { W, H, dpr } = this.dims();
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawBackdrop(ctx, W, H, seg.finale ? 0.1 : 0.04);

      // fade in, hold, fade out within the segment
      const dur = seg.dur;
      const fade = Math.min(0.5, dur * 0.25);
      let alpha = 1;
      if (st < fade) alpha = st / fade;
      else if (st > dur - fade) alpha = Math.max(0, (dur - st) / fade);

      const cx = W / 2, cy = H * 0.46;
      const fs = Math.max(24, Math.min(W * 0.058, 64));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // gold rule above
      const rw = Math.min(W * 0.5, 320);
      ctx.strokeStyle = `rgba(168,127,51,${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - rw / 2, cy - fs * 1.6); ctx.lineTo(cx + rw / 2, cy - fs * 1.6); ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.font = `${fs * 0.5}px 'Maestro Heading', Georgia, serif`;
      ctx.fillText('♪', cx, cy - fs * 1.6);

      ctx.fillStyle = seg.finale ? GOLD_BRIGHT : PARCHMENT;
      ctx.font = `${seg.finale ? 'bold ' : ''}${fs}px '${seg.finale ? 'Maestro Display' : 'Maestro Heading'}', Georgia, serif`;
      if (seg.finale) { ctx.shadowColor = 'rgba(232,181,74,0.6)'; ctx.shadowBlur = 22; }
      const lines = seg.lines;
      const lh = fs * 1.18;
      const y0 = cy - ((lines.length - 1) * lh) / 2;
      lines.forEach((ln, i) => ctx.fillText(ln, cx, y0 + i * lh));
      ctx.shadowBlur = 0;

      if (seg.finale) {
        ctx.strokeStyle = `rgba(168,127,51,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(cx - rw / 2, cy + fs * 1.6); ctx.lineTo(cx + rw / 2, cy + fs * 1.6); ctx.stroke();
      }
      ctx.restore();
    }

    drawSkipHint(W, H) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.textAlign = 'right';
      ctx.fillStyle = PARCHMENT;
      ctx.font = `italic 12px 'Maestro Heading', Georgia, serif`;
      ctx.fillText('click or Esc to skip', W - 14, H - 14);
      ctx.restore();
    }
  }

  MG.Reel = Reel;
  MG.REEL_BEAT = BEAT;
})();
