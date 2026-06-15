/* ============================================================
   Maestro's Gambit — profiles.js  (MG.Profiles)
   Player-profile persistence. Profiles live in their own
   localStorage key ('mg_profiles') so a player's rating survives
   between sessions (lost only if the user clears site data).

   A profile = { id, name, system, rating, rd, vol,
                 games, wins, draws, losses, history[],
                 defeated{id:true}, cleared{klass:true}, ladderComplete }.
   "Guest" is a synthetic, never-saved profile that tracks no rating.

   The progression fields (defeated/cleared/ladderComplete) record the single-
   player ladder climb (which personas the human has beaten, which class bands
   are fully cleared, whether the whole roster is done). They are
   Steam-achievement-ready flags; the ladder logic itself lives in
   MG.Opponents.

   Rating math lives in MG.Rating; this module only stores results and
   calls into it. No DOM here.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});
  const Rating = MG.Rating;

  const KEY = 'mg_profiles';
  const GUEST_ID = 'guest';
  const HISTORY_CAP = 50; // keep recent games; older ones drop off

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  const Profiles = {
    data: { profiles: {}, activeId: GUEST_ID },

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const p = JSON.parse(raw);
          if (p && typeof p === 'object') {
            this.data.profiles = p.profiles || {};
            this.data.activeId = p.activeId || GUEST_ID;
          }
        }
      } catch (e) { /* private mode / corrupt — start fresh */ }
      // an activeId pointing at a deleted profile falls back to Guest
      if (this.data.activeId !== GUEST_ID && !this.data.profiles[this.data.activeId]) {
        this.data.activeId = GUEST_ID;
      }
      // back-fill progression fields onto profiles saved before this layer existed
      for (const id in this.data.profiles) this.ensureProgress(this.data.profiles[id]);
      return this;
    },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); }
      catch (e) { /* ignore (private mode etc.) */ }
    },

    /* ---- the synthetic Guest ---- */
    guest() {
      return { id: GUEST_ID, name: 'Guest', guest: true, system: 'elo',
        rating: null, games: 0, wins: 0, draws: 0, losses: 0 };
    },
    isGuestId(id) { return !id || id === GUEST_ID; },

    /* ---- queries ---- */
    all() { return Object.values(this.data.profiles); },
    get(id) { return this.data.profiles[id] || null; },
    active() {
      if (this.isGuestId(this.data.activeId)) return this.guest();
      return this.data.profiles[this.data.activeId] || this.guest();
    },
    isGuest() { return this.isGuestId(this.data.activeId); },

    /* ---- mutations ---- */
    setActive(id) {
      this.data.activeId = this.isGuestId(id) ? GUEST_ID : id;
      this.save();
      return this.active();
    },
    playAsGuest() { return this.setActive(GUEST_ID); },

    // create a named profile in the given system, seeded at the Elo start,
    // and make it active. Returns the new profile.
    create(name, system) {
      system = system === 'glicko' ? 'glicko' : 'elo';
      const seed = Rating.seedFor(system, Rating.START_RATING);
      const prof = {
        id: uid(),
        name: (name || 'Maestro').toString().slice(0, 24).trim() || 'Maestro',
        system,
        rating: seed.rating,
        rd: seed.rd, vol: seed.vol,
        games: 0, wins: 0, draws: 0, losses: 0,
        history: [],
        defeated: {}, cleared: {}, ladderComplete: false,
      };
      this.data.profiles[prof.id] = prof;
      this.data.activeId = prof.id;
      this.save();
      return prof;
    },

    remove(id) {
      if (this.isGuestId(id)) return;
      delete this.data.profiles[id];
      if (this.data.activeId === id) this.data.activeId = GUEST_ID;
      this.save();
    },

    // switch which system computes a profile's rating, seeding the new
    // system from the current number (an estimate — see MG.Rating).
    setSystem(prof, system) {
      if (!prof || prof.guest) return prof;
      system = system === 'glicko' ? 'glicko' : 'elo';
      if (prof.system === system) return prof;
      const seed = Rating.seedFor(system, prof.rating);
      prof.system = system;
      prof.rating = seed.rating;
      prof.rd = seed.rd;
      prof.vol = seed.vol;
      this.save();
      return prof;
    },

    /* ---- record a finished game ----
       score: 1 win / 0.5 draw / 0 loss (from the profile player's view).
       oppRating: the opponent's rating to grade against.
       Returns { before, after, delta, system } or null when not tracked
       (Guest, or a malformed profile). */
    recordGame(prof, score, oppRating, opts) {
      if (!prof || prof.guest) return null;
      const before = prof.rating;
      if (prof.system === 'glicko') {
        const oppRd = (opts && opts.oppRd != null) ? opts.oppRd : Rating.GLICKO.RD;
        const out = Rating.updateGlicko(prof.rating, prof.rd, prof.vol,
          [{ rating: oppRating, rd: oppRd, score }]);
        prof.rating = out.rating;
        prof.rd = out.rd;
        prof.vol = out.vol;
      } else {
        prof.rating = Rating.updateElo(prof.rating, oppRating, score, prof.games);
      }
      prof.games += 1;
      if (score >= 1) prof.wins += 1;
      else if (score <= 0) prof.losses += 1;
      else prof.draws += 1;

      const entry = { t: Date.now(), opp: oppRating, s: score,
        before, after: prof.rating, sys: prof.system };
      if (opts && opts.label) entry.vs = opts.label;
      prof.history.push(entry);
      if (prof.history.length > HISTORY_CAP) prof.history.shift();

      this.save();
      return { before, after: prof.rating, delta: prof.rating - before, system: prof.system };
    },

    /* convenience for the HUD/cards: "Elo 1212" or "Guest" */
    ratingLabel(prof) {
      prof = prof || this.active();
      if (prof.guest || prof.rating == null) return 'Guest';
      return Rating.label(prof.system) + ' ' + prof.rating;
    },

    /* ---- single-player ladder progression ----
       Guest tracks nothing, so all of these no-op (return false / empty) for it.
       The ladder *rules* (unlock order, band membership) live in MG.Opponents;
       here we only persist flags. */
    ensureProgress(prof) {
      if (prof && !prof.guest) {
        if (!prof.defeated || typeof prof.defeated !== 'object') prof.defeated = {};
        if (!prof.cleared || typeof prof.cleared !== 'object') prof.cleared = {};
        if (typeof prof.ladderComplete !== 'boolean') prof.ladderComplete = false;
      }
      return prof;
    },
    hasDefeated(prof, id) { return !!(prof && !prof.guest && prof.defeated && prof.defeated[id]); },
    // mark a persona beaten; returns true only the FIRST time (so callers can
    // fire a one-shot flourish).
    recordDefeat(prof, id) {
      if (!prof || prof.guest || !id) return false;
      this.ensureProgress(prof);
      if (prof.defeated[id]) return false;
      prof.defeated[id] = true;
      this.save();
      return true;
    },
    // record a band-completion flag; returns true only the first time.
    markCleared(prof, klass) {
      if (!prof || prof.guest || !klass) return false;
      this.ensureProgress(prof);
      if (prof.cleared[klass]) return false;
      prof.cleared[klass] = true;
      this.save();
      return true;
    },
    // record the whole-ladder finale; returns true only the first time.
    setLadderComplete(prof) {
      if (!prof || prof.guest) return false;
      this.ensureProgress(prof);
      if (prof.ladderComplete) return false;
      prof.ladderComplete = true;
      this.save();
      return true;
    },
  };

  MG.Profiles = Profiles;
  if (typeof module !== 'undefined' && module.exports) module.exports = Profiles;
})();
