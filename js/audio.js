/* ============================================================
   Maestro's Gambit — audio.js
   All sound effects are synthesized with WebAudio at runtime.
   No samples, no third-party assets.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});

  /* note-name -> frequency (e.g. 'A4' -> 440, 'Bb2', 'F#5'); numbers pass through */
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function noteFreq(n) {
    if (typeof n === 'number') return n;
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
    if (!m) return 440;
    const semi = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    const midi = semi + (parseInt(m[3], 10) + 1) * 12; // C4 = 60
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /* a sparse step row: row(len, [[step, value], ...]) -> Array(len) */
  function row(len, pairs) {
    const a = new Array(len).fill(null);
    for (const [s, v] of pairs) a[s] = v;
    return a;
  }

  /* ---------- bundled original soundtrack (note-data only) ----------
     Each track is a step sequencer: div = steps per beat. Parts schedule
     notes through the same instrument voices used for SFX. All diatonic,
     all original — no samples, no external files. */
  const TRACKS = [
    {
      name: 'Overture in Amber', bpm: 84, div: 2, steps: 32,
      parts: [
        // pianist: chord on each bar's downbeat + a light mid-bar tone (Am F C G)
        { voice: 'piano', vol: 0.16, durBeats: 1.7, seq: row(32, [
          [0, ['A3', 'C4', 'E4']], [4, 'E4'], [8, ['F3', 'A3', 'C4']], [12, 'C4'],
          [16, ['C4', 'E4', 'G4']], [20, 'G4'], [24, ['G3', 'B3', 'D4']], [28, 'D4'],
        ]) },
        // violinist: pizzicato walking bass
        { voice: 'pluck', vol: 0.15, durBeats: 0.5, seq: row(32, [
          [0, 'A2'], [4, 'E3'], [8, 'F2'], [12, 'C3'],
          [16, 'C3'], [20, 'G2'], [24, 'G2'], [28, 'D3'],
        ]) },
        // clarinetist: lyrical lead phrase
        { voice: 'reed', vol: 0.13, durBeats: 1.1, seq: row(32, [
          [2, 'E4'], [6, 'A4'], [8, 'C5'], [12, 'A4'],
          [16, 'B4'], [20, 'G4'], [24, 'D5'], [26, 'B4'], [28, 'G4'],
        ]) },
      ],
    },
    {
      name: 'Clarinet Nocturne', bpm: 72, div: 2, steps: 32,
      parts: [
        // cellist: bowed chord pads (Dm Bb F C)
        { voice: 'bow', vol: 0.12, durBeats: 3.6, seq: row(32, [
          [0, ['D3', 'F3', 'A3']], [8, ['Bb2', 'D3', 'F3']],
          [16, ['F2', 'A2', 'C3']], [24, ['C3', 'E3', 'G3']],
        ]) },
        // clarinetist: nocturne melody
        { voice: 'reed', vol: 0.15, durBeats: 1.5, seq: row(32, [
          [2, 'A4'], [6, 'D5'], [10, 'F5'], [12, 'D5'],
          [16, 'C5'], [20, 'A4'], [24, 'G4'], [28, 'E5'], [30, 'C5'],
        ]) },
        // violinist: soft pizz colour
        { voice: 'pluck', vol: 0.08, durBeats: 0.5, seq: row(32, [
          [4, 'A3'], [12, 'F3'], [20, 'C4'], [28, 'G3'],
        ]) },
      ],
    },
    {
      name: 'Pizzicato Pavane', bpm: 96, div: 2, steps: 32,
      parts: [
        // violinist: pizz bass (C G Am F)
        { voice: 'pluck', vol: 0.16, durBeats: 0.45, seq: row(32, [
          [0, 'C3'], [4, 'G2'], [8, 'G2'], [12, 'D3'],
          [16, 'A2'], [20, 'E3'], [24, 'F2'], [28, 'C3'],
        ]) },
        // violinist: pizz counter-melody
        { voice: 'pluck', vol: 0.12, durBeats: 0.4, seq: row(32, [
          [2, 'E4'], [6, 'G4'], [10, 'D4'], [14, 'B4'],
          [18, 'C5'], [22, 'E4'], [26, 'A4'], [30, 'C5'],
        ]) },
        // pianist: light chord on each bar
        { voice: 'piano', vol: 0.1, durBeats: 1, seq: row(32, [
          [0, ['C4', 'E4', 'G4']], [8, ['G3', 'B3', 'D4']],
          [16, ['A3', 'C4', 'E4']], [24, ['F3', 'A3', 'C4']],
        ]) },
        // percussionist: woodblock pulse (cell value = pitch)
        { voice: 'block', vol: 0.11, seq: row(32, [
          [0, 820], [4, 620], [8, 820], [12, 620],
          [16, 820], [20, 620], [24, 820], [28, 620],
        ]) },
      ],
    },
  ];

  const Audio_ = {
    ctx: null,
    sfxGain: null,
    musicGain: null,
    musicEl: null,
    sfxVol: 0.8,
    musicVol: 0.6,
    enabled: true,
    _route: null,           // when set, output primitives route here (music bus)
    music: { on: true, trackId: 0 },
    _musicUrl: null,
    _seqTimer: null,
    _seqTrack: null,
    _seqStep: 0,
    _seqNext: 0,
    _synthPlaying: false,

    init() {
      if (this.ctx) return;
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.sfxVol;
        this.sfxGain.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = this.musicVol;
        this.musicGain.connect(this.ctx.destination);
      } catch (e) {
        this.enabled = false;
      }
    },

    resume() {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    setSfxVol(v) {
      this.sfxVol = v;
      if (this.sfxGain) this.sfxGain.gain.value = v;
    },
    setMusicVol(v) {
      this.musicVol = v;
      if (this.musicEl) this.musicEl.volume = v;
      if (this.musicGain) this.musicGain.gain.value = v;
    },

    /* ---------- soundtrack: bundled synth tracks + bring-your-own ---------- */
    setMusicOn(on) {
      this.music.on = !!on;
      if (on) this.startBoardMusic(); else this.stopBoardMusic();
    },
    setMusicTrack(id) {
      this.music.trackId = id | 0;
      // live-preview / switch: if synth is the active source, restart it
      if (this.music.on && !this.musicEl) { this.resume(); this._startSynth(); }
    },

    // user-supplied file overrides the synth track while loaded
    loadMusicFile(file) {
      this.clearMusicFile();
      this._stopSynth();
      this._musicUrl = URL.createObjectURL(file);
      const el = new window.Audio(this._musicUrl);
      el.loop = true;
      el.volume = this.musicVol;
      this.musicEl = el;
    },
    clearMusicFile() {
      if (this.musicEl) { this.musicEl.pause(); this.musicEl = null; }
      if (this._musicUrl) { try { URL.revokeObjectURL(this._musicUrl); } catch (e) {} this._musicUrl = null; }
    },

    startBoardMusic() {
      this.resume();
      if (!this.ctx || !this.enabled || !this.music.on) return;
      if (this.musicEl) { this._stopSynth(); this.musicEl.play().catch(() => {}); return; }
      this._startSynth();
    },
    stopBoardMusic() {
      this._stopSynth();
      if (this.musicEl) this.musicEl.pause();
    },
    // legacy aliases (callers may still use these)
    playMusic() { this.startBoardMusic(); },
    stopMusic() { this.stopBoardMusic(); },

    _startSynth() {
      if (!this.ctx || !this.enabled || !this.music.on) return;
      this._stopSynth();
      this._seqTrack = TRACKS[this.music.trackId] || TRACKS[0];
      this._seqStep = 0;
      this._seqNext = this.now() + 0.12;
      this._synthPlaying = true;
      this._seqTimer = setInterval(() => this._scheduler(), 25);
    },
    _stopSynth() {
      this._synthPlaying = false;
      if (this._seqTimer) { clearInterval(this._seqTimer); this._seqTimer = null; }
    },
    _scheduler() {
      const tr = this._seqTrack;
      if (!tr || !this.ctx) return;
      const stepDur = (60 / tr.bpm) / tr.div;
      while (this._seqNext < this.now() + 0.25) {
        for (const part of tr.parts) {
          const cell = part.seq[this._seqStep];
          if (cell != null) this._playNote(part, cell, this._seqNext - this.now());
        }
        this._seqStep = (this._seqStep + 1) % tr.steps;
        this._seqNext += stepDur;
      }
    },
    _playNote(part, cell, when) {
      const tr = this._seqTrack;
      const dur = (part.durBeats || 0.5) * (60 / tr.bpm);
      const vol = part.vol == null ? 0.14 : part.vol;
      const pitches = Array.isArray(cell) ? cell : [cell];
      this._route = this.musicGain;          // route this voice to the music bus
      switch (part.voice) {
        case 'pluck': pitches.forEach((p) => this.pluck(noteFreq(p), when, vol, dur)); break;
        case 'bow': pitches.forEach((p) => this.bow(noteFreq(p), when, vol, dur)); break;
        case 'reed': pitches.forEach((p) => this.reed(noteFreq(p), when, vol, dur)); break;
        case 'piano':
          if (pitches.length > 1) this.pianoChord(pitches.map(noteFreq), when, vol, dur, 0.02);
          else this.piano(noteFreq(pitches[0]), when, vol, dur);
          break;
        case 'block': this.block(when, vol, typeof cell === 'number' ? cell : 820); break;
        case 'snare': this.snare(when, vol); break;
        case 'timpani': this.timpani(when, vol, 90); break;
      }
      this._route = null;
    },

    /* ---------- low-level helpers ---------- */
    now() { return this.ctx ? this.ctx.currentTime : 0; },

    env(gainNode, t0, attack, peak, decay, sustain, release) {
      const g = gainNode.gain;
      g.setValueAtTime(0.0001, t0);
      g.linearRampToValueAtTime(peak, t0 + attack);
      g.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t0 + attack + decay);
      g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay + release);
    },

    osc(type, freq, t0, dur, peak, opts = {}) {
      if (!this.ctx) return null;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (opts.glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(opts.glideTo, 1), t0 + dur);
      this.env(g, t0, opts.a ?? 0.005, peak, opts.d ?? dur * 0.4, opts.s ?? peak * 0.2, opts.r ?? dur * 0.6);
      o.connect(g);
      g.connect(opts.dest || this._route || this.sfxGain);
      o.start(t0);
      o.stop(t0 + dur + 0.3);
      return { o, g };
    },

    noise(t0, dur, peak, opts = {}) {
      if (!this.ctx) return;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = opts.type || 'lowpass';
      filt.frequency.setValueAtTime(opts.f0 || 2000, t0);
      if (opts.f1) filt.frequency.exponentialRampToValueAtTime(opts.f1, t0 + dur);
      filt.Q.value = opts.q || 0.8;
      const g = this.ctx.createGain();
      this.env(g, t0, opts.a ?? 0.002, peak, opts.d ?? dur * 0.3, opts.s ?? peak * 0.15, opts.r ?? dur * 0.7);
      src.connect(filt); filt.connect(g); g.connect(opts.dest || this._route || this.sfxGain);
      src.start(t0);
    },

    /* ---------- instrument voices ---------- */

    // Plucked string (pizzicato) — violin/cello pluck
    pluck(freq, when = 0, vol = 0.5, dur = 0.35) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.osc('triangle', freq, t0, dur, vol, { a: 0.002, d: dur * 0.25, s: 0.001, r: dur * 0.6 });
      this.osc('sine', freq * 2, t0, dur * 0.6, vol * 0.3, { a: 0.002, d: dur * 0.2, s: 0.001, r: dur * 0.4 });
    },

    // Bowed string swell
    bow(freq, when = 0, vol = 0.4, dur = 0.6, glideTo = null) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.osc('sawtooth', freq, t0, dur, vol * 0.7, {
        a: dur * 0.3, d: dur * 0.3, s: vol * 0.3, r: dur * 0.4, glideTo: glideTo || undefined,
      });
      this.osc('sawtooth', freq * 1.005, t0, dur, vol * 0.5, {
        a: dur * 0.32, d: dur * 0.3, s: vol * 0.2, r: dur * 0.4, glideTo: glideTo ? glideTo * 1.005 : undefined,
      });
    },

    // Aggressive string stab (sforzando)
    stringStab(freq, when = 0, vol = 0.55) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.osc('sawtooth', freq, t0, 0.22, vol, { a: 0.004, d: 0.1, s: 0.01, r: 0.15 });
      this.osc('sawtooth', freq * 0.5, t0, 0.22, vol * 0.6, { a: 0.004, d: 0.1, s: 0.01, r: 0.15 });
      this.noise(t0, 0.08, vol * 0.25, { type: 'highpass', f0: 3000 });
    },

    // Clarinet-ish reed tone (odd harmonics ≈ square-ish)
    reed(freq, when = 0, vol = 0.4, dur = 0.3, glideTo = null) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.osc('square', freq, t0, dur, vol * 0.5, {
        a: 0.02, d: dur * 0.4, s: vol * 0.25, r: dur * 0.4, glideTo: glideTo || undefined,
      });
      this.osc('sine', freq, t0, dur, vol * 0.4, { a: 0.02, d: dur * 0.4, s: vol * 0.2, r: dur * 0.4 });
    },

    // Comedy squeak (reed overblow)
    squeak(when = 0, vol = 0.5) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.osc('square', 1800, t0, 0.18, vol * 0.5, { a: 0.005, d: 0.05, s: 0.05, r: 0.1, glideTo: 2600 });
    },

    // Timpani boom
    timpani(when = 0, vol = 0.8, freq = 82) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.osc('sine', freq * 1.6, t0, 0.5, vol, { a: 0.003, d: 0.18, s: 0.05, r: 0.4, glideTo: freq });
      this.noise(t0, 0.1, vol * 0.4, { type: 'lowpass', f0: 400 });
    },

    // Snare hit
    snare(when = 0, vol = 0.5) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.noise(t0, 0.16, vol, { type: 'highpass', f0: 1200, a: 0.001, d: 0.06, s: 0.02, r: 0.1 });
      this.osc('triangle', 220, t0, 0.1, vol * 0.5, { a: 0.001, d: 0.05, s: 0.01, r: 0.06 });
    },

    // Cymbal crash
    cymbal(when = 0, vol = 0.6, dur = 1.2) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.noise(t0, dur, vol, { type: 'highpass', f0: 5000, q: 0.5, a: 0.002, d: dur * 0.25, s: vol * 0.12, r: dur * 0.75 });
      this.noise(t0, dur * 0.6, vol * 0.5, { type: 'bandpass', f0: 9000, q: 2, a: 0.002, d: dur * 0.2, s: vol * 0.06, r: dur * 0.5 });
    },

    // Woodblock / footstep tick
    block(when = 0, vol = 0.3, f = 900) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.osc('sine', f, t0, 0.07, vol, { a: 0.001, d: 0.03, s: 0.001, r: 0.04 });
    },

    // Simple FM "piano" note
    piano(freq, when = 0, vol = 0.45, dur = 0.7) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      const car = this.ctx.createOscillator();
      const mod = this.ctx.createOscillator();
      const mg = this.ctx.createGain();
      const g = this.ctx.createGain();
      car.type = 'sine'; mod.type = 'sine';
      car.frequency.value = freq;
      mod.frequency.value = freq * 2;
      mg.gain.setValueAtTime(freq * 1.6, t0);
      mg.gain.exponentialRampToValueAtTime(freq * 0.05, t0 + dur);
      mod.connect(mg); mg.connect(car.frequency);
      this.env(g, t0, 0.003, vol, dur * 0.35, vol * 0.12, dur * 0.65);
      car.connect(g); g.connect(this._route || this.sfxGain);
      car.start(t0); mod.start(t0);
      car.stop(t0 + dur + 0.3); mod.stop(t0 + dur + 0.3);
    },

    pianoChord(freqs, when = 0, vol = 0.4, dur = 0.8, strum = 0.02) {
      freqs.forEach((f, i) => this.piano(f, when + i * strum, vol / Math.sqrt(freqs.length) * 1.5, dur));
    },

    // Dissonant cluster — pianist's demise / check warning
    cluster(when = 0, vol = 0.4) {
      this.pianoChord([220, 233.1, 246.9, 261.6, 277.2], when, vol, 1.1, 0.01);
    },

    // Brass-y blast for big moments
    brass(freq, when = 0, vol = 0.5, dur = 0.5) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.osc('sawtooth', freq, t0, dur, vol * 0.6, { a: 0.04, d: dur * 0.3, s: vol * 0.3, r: dur * 0.5 });
      this.osc('sawtooth', freq * 1.5, t0, dur, vol * 0.3, { a: 0.05, d: dur * 0.3, s: vol * 0.15, r: dur * 0.5 });
      this.osc('square', freq * 0.5, t0, dur, vol * 0.25, { a: 0.04, d: dur * 0.3, s: vol * 0.1, r: dur * 0.5 });
    },

    // Magic zap (conductor's baton)
    zap(when = 0, vol = 0.5) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.osc('sawtooth', 1600, t0, 0.25, vol * 0.5, { a: 0.002, d: 0.1, s: 0.02, r: 0.12, glideTo: 180 });
      this.noise(t0, 0.18, vol * 0.4, { type: 'highpass', f0: 2500, a: 0.002, d: 0.08, s: 0.02, r: 0.1 });
    },

    whoosh(when = 0, vol = 0.35, dur = 0.3) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.noise(t0, dur, vol, { type: 'bandpass', f0: 400, f1: 2400, q: 1.4, a: dur * 0.3, d: dur * 0.3, s: vol * 0.2, r: dur * 0.4 });
    },

    thud(when = 0, vol = 0.6) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      this.osc('sine', 120, t0, 0.25, vol, { a: 0.002, d: 0.1, s: 0.02, r: 0.15, glideTo: 50 });
      this.noise(t0, 0.08, vol * 0.3, { type: 'lowpass', f0: 600 });
    },

    // Applause: filtered noise bursts
    applause(when = 0, vol = 0.35, dur = 2.4) {
      if (!this.ctx || !this.enabled) return;
      const t0 = this.now() + when;
      for (let i = 0; i < 46; i++) {
        const tt = t0 + Math.random() * dur;
        this.noise(tt - this.now(), 0.05, vol * (0.4 + Math.random() * 0.6) * 0.35, {
          type: 'bandpass', f0: 1500 + Math.random() * 3000, q: 1.5,
        });
      }
    },

    /* ---------- composed cues ---------- */

    uiClick() { this.resume(); this.block(0, 0.25, 1300); this.pluck(660, 0.01, 0.18, 0.15); },
    uiBack() { this.resume(); this.block(0, 0.2, 800); this.pluck(440, 0.01, 0.15, 0.15); },

    // Per-character signature phrase, each on its own instrument voice.
    // Used on piece selection and as the battle prelude.
    stinger(pieceType) {
      this.resume();
      if (!this.ctx || !this.enabled) return;
      const nf = noteFreq;
      switch (pieceType) {
        case 'P': // Violinist — pizzicato triad
          [['A4', 0], ['C5', 0.06], ['E5', 0.12]].forEach(([n, w]) => this.pluck(nf(n), w, 0.3, 0.26));
          break;
        case 'N': // Cellist — bowed rising fifth
          [['C3', 0], ['G3', 0.13]].forEach(([n, w]) => this.bow(nf(n), w, 0.32, 0.34));
          break;
        case 'B': // Clarinetist — reed turn
          [['D5', 0], ['F5', 0.09], ['E5', 0.18]].forEach(([n, w]) => this.reed(nf(n), w, 0.3, 0.22));
          break;
        case 'R': // Percussionist — timpani + snare flam + cymbal
          this.timpani(0, 0.45, 92); this.snare(0.1, 0.4); this.snare(0.2, 0.4); this.cymbal(0.3, 0.22, 0.7);
          break;
        case 'Q': // Pianist — rolled arpeggio
          this.pianoChord(['C4', 'E4', 'G4', 'C5'].map(nf), 0, 0.3, 0.6, 0.05);
          break;
        case 'K': // Conductor — brass call
          [['C4', 0], ['G4', 0.13]].forEach(([n, w]) => this.brass(nf(n), w, 0.32, 0.4));
          break;
        default:
          this.pluck(440, 0, 0.3, 0.3);
      }
    },

    select(pieceType) { this.stinger(pieceType); },

    move() { this.resume(); this.block(0, 0.22, 700); },
    footstep(i) { this.block(0, 0.16, i % 2 ? 620 : 540); },

    capturePrelude() { this.resume(); this.bow(196, 0, 0.3, 0.5, 233); this.timpani(0.05, 0.4, 60); },

    check() {
      this.resume();
      this.stringStab(466, 0, 0.45);
      this.stringStab(494, 0.12, 0.45);
      this.timpani(0.02, 0.5, 70);
    },

    castle() {
      this.resume();
      this.brass(262, 0, 0.35, 0.35);
      this.brass(330, 0.12, 0.35, 0.35);
      this.brass(392, 0.24, 0.4, 0.5);
    },

    promote() {
      this.resume();
      [523, 659, 784, 1047].forEach((f, i) => this.pluck(f, i * 0.09, 0.4, 0.5));
      this.cymbal(0.3, 0.3, 0.9);
    },

    fanfareWin() {
      this.resume();
      const seq = [[262, 0], [330, 0.14], [392, 0.28], [523, 0.42], [392, 0.62], [523, 0.76]];
      seq.forEach(([f, t]) => this.brass(f, t, 0.45, 0.35));
      this.timpani(0.42, 0.7, 90);
      this.cymbal(0.76, 0.5, 1.6);
      this.applause(1.0, 0.4, 3.0);
    },

    dirge() {
      this.resume();
      const seq = [[220, 0], [208, 0.5], [196, 1.0], [185, 1.5]];
      seq.forEach(([f, t]) => this.bow(f, t, 0.35, 0.6));
      this.timpani(1.5, 0.5, 55);
    },

    drawCue() {
      this.resume();
      this.reed(392, 0, 0.3, 0.5);
      this.reed(370, 0.4, 0.3, 0.7);
    },
  };

  MG.Audio = Audio_;
})();
