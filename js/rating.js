/* ============================================================
   Maestro's Gambit — rating.js  (MG.Rating)
   Chess-rating math. Two real computing systems are supported —
   Elo (the default) and Glicko-2 — plus USCF/ECF *display*
   equivalents (estimates, not separate engines).

   IMPORTANT (honesty note): Elo, Glicko-2, USCF and ECF are
   DIFFERENT statistical models, not unit conversions. There is no
   exact two-way mapping. When a player switches the system that
   COMPUTES their rating we SEED the new system from their current
   number with the standard published approximations, then let it
   evolve on its own. USCF/ECF figures are shown as estimates only.

   No DOM, no globals beyond MG.Rating — unit-tested in
   tests/test_rating.js and safe to require() under Node.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});

  // New profiles start here; the classic Elo seed.
  const START_RATING = 1200;
  // Legacy fixed "opponent rating" per old AI level. SUPERSEDED in v1.8 by each
  // persona's own `rating` field (js/opponents.js), which main.js now grades
  // against. Kept only for back-compat; not used by the live game.
  const AI_RATINGS = [1000, 1500, 2000];

  // Glicko-2 defaults (Glickman 2013): RD 350 for a brand-new rating,
  // volatility σ 0.06, system constant τ 0.5. 173.7178 = 400/ln(10),
  // the scale factor between the Elo and Glicko-2 internal scales.
  const GLICKO = { RD: 350, VOL: 0.06, TAU: 0.5, SCALE: 173.7178 };

  /* ---------------- Elo ---------------- */

  // Expected score of a player rated R against an opponent rated Ropp.
  function expected(R, Ropp) {
    return 1 / (1 + Math.pow(10, (Ropp - R) / 400));
  }

  // K-factor: generous while provisional, then standard, then tight at
  // master level — the usual FIDE/USCF-style schedule.
  function kFactor(rating, games) {
    if (games < 30) return 40;   // provisional
    if (rating >= 2400) return 10;
    return 20;
  }

  // One Elo update. score: 1 win / 0.5 draw / 0 loss. Returns the new
  // rating (rounded to the nearest point, as ratings are reported).
  function updateElo(rating, oppRating, score, games) {
    const k = kFactor(rating, games);
    return Math.round(rating + k * (score - expected(rating, oppRating)));
  }

  /* ---------------- Glicko-2 ----------------
     Full implementation of Glickman's 2013 algorithm. A "period" is an
     array of results [{rating, rd, score}]. In live play we call it with
     a single result per game (a one-game period), which is valid; the
     unit test drives the canonical three-opponent worked example. */

  const g = (phi) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
  const expG = (mu, muJ, phiJ) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

  // Solve the volatility equation (Step 5) via the Illinois algorithm.
  function newVolatility(sigma, delta, phi, v, tau) {
    const a = Math.log(sigma * sigma);
    const f = (x) => {
      const ex = Math.exp(x);
      const num = ex * (delta * delta - phi * phi - v - ex);
      const den = 2 * Math.pow(phi * phi + v + ex, 2);
      return num / den - (x - a) / (tau * tau);
    };
    let A = a;
    let B;
    if (delta * delta > phi * phi + v) {
      B = Math.log(delta * delta - phi * phi - v);
    } else {
      let k = 1;
      while (f(a - k * tau) < 0) k++;
      B = a - k * tau;
    }
    let fA = f(A), fB = f(B);
    let iter = 0;
    while (Math.abs(B - A) > 1e-6 && iter++ < 100) {
      const C = A + ((A - B) * fA) / (fB - fA);
      const fC = f(C);
      if (fC * fB <= 0) { A = B; fA = fB; }
      else { fA = fA / 2; }
      B = C; fB = fC;
    }
    return Math.exp(A / 2);
  }

  // Update {rating, rd, vol} after a rating period of `results`.
  // Returns a fresh {rating, rd, vol} (rating/rd rounded for storage).
  function updateGlicko(rating, rd, vol, results, tau) {
    tau = tau == null ? GLICKO.TAU : tau;
    const S = GLICKO.SCALE;
    const mu = (rating - 1500) / S;
    const phi = rd / S;

    if (!results || !results.length) {
      // Did not play: only the deviation grows.
      const phiStar = Math.sqrt(phi * phi + vol * vol);
      return { rating: Math.round(rating), rd: Math.round(phiStar * S), vol };
    }

    let vInv = 0;        // 1/v
    let deltaSum = 0;    // Σ g(phi_j)(s_j − E)
    for (const r of results) {
      const muJ = (r.rating - 1500) / S;
      const phiJ = r.rd / S;
      const gj = g(phiJ);
      const E = expG(mu, muJ, phiJ);
      vInv += gj * gj * E * (1 - E);
      deltaSum += gj * (r.score - E);
    }
    const v = 1 / vInv;
    const delta = v * deltaSum;

    const sigmaP = newVolatility(vol, delta, phi, v, tau);
    const phiStar = Math.sqrt(phi * phi + sigmaP * sigmaP);
    const phiP = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const muP = mu + phiP * phiP * deltaSum;

    return {
      rating: Math.round(muP * S + 1500),
      rd: Math.round(phiP * S),
      vol: sigmaP,
      // unrounded values kept for tests that check the raw scale
      _ratingExact: muP * S + 1500,
      _rdExact: phiP * S,
    };
  }

  /* ---------------- Display equivalents ----------------
     These are ESTIMATES from the standard published linear
     approximations — never claim an exact conversion. */

  // USCF ≈ FIDE/Elo + 50..100 over the club range; report the midpoint.
  function eloToUSCF(elo) { return Math.round(elo + 75); }
  // ECF (current "new" scale) ≈ (Elo − 700) / 7.5.
  function eloToECF(elo) { return Math.round((elo - 700) / 7.5); }
  // Inverse, used only when seeding from an ECF figure.
  function ecfToElo(ecf) { return Math.round(7.5 * ecf + 700); }

  // A compact "≈ USCF / ECF" estimate string for the options/HUD.
  function estimateLine(elo) {
    return 'USCF ≈ ' + eloToUSCF(elo) + ' · ECF ≈ ' + eloToECF(elo);
  }

  /* ---------------- System seeding ----------------
     When a player switches which system computes their rating, carry the
     current number across (Glicko-2 shares Elo's ~1500-centred scale) and
     reset the Glicko deviation/volatility so the new model can settle. */
  function seedFor(system, currentRating) {
    if (system === 'glicko') {
      return { rating: Math.round(currentRating), rd: GLICKO.RD, vol: GLICKO.VOL };
    }
    // elo
    return { rating: Math.round(currentRating), rd: null, vol: null };
  }

  const Rating = {
    START_RATING, AI_RATINGS, GLICKO,
    expected, kFactor, updateElo,
    updateGlicko, newVolatility, g,
    eloToUSCF, eloToECF, ecfToElo, estimateLine,
    seedFor,
    SYSTEMS: { elo: 'Elo', glicko: 'Glicko-2' },
    label(system) { return this.SYSTEMS[system] || 'Elo'; },
  };

  MG.Rating = Rating;
  if (typeof module !== 'undefined' && module.exports) module.exports = Rating;
})();
