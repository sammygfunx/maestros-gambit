/* Unit tests for the rating math (MG.Rating). Run: node tests/test_rating.js */
require('../js/rating.js');
const MG = globalThis.MG;
const R = MG.Rating;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);

console.log('— Elo expected score —');
{
  ok(near(R.expected(1200, 1200), 0.5), 'equal ratings expect 0.5');
  // 400 points higher → ~0.909 (the textbook 10:1 figure)
  ok(near(R.expected(1600, 1200), 0.9090909, 1e-6), '+400 expects ~0.909');
  ok(near(R.expected(1200, 1600), 0.0909091, 1e-6), '−400 expects ~0.091');
  ok(near(R.expected(1200, 1200) + R.expected(1200, 1200), 1, 1e-9), 'symmetric pair sums to 1');
}

console.log('— Elo K-factor schedule —');
{
  ok(R.kFactor(1200, 0) === 40, 'provisional K=40 (<30 games)');
  ok(R.kFactor(1200, 30) === 20, 'established K=20');
  ok(R.kFactor(2450, 80) === 10, 'master K=10 (≥2400)');
}

console.log('— Elo update —');
{
  // equal opponent, a win: R' = 1200 + 40*(1 − 0.5) = 1220
  ok(R.updateElo(1200, 1200, 1, 0) === 1220, 'provisional win vs equal → 1220');
  // equal opponent, a loss after established: 1500 + 20*(0 − 0.5) = 1490
  ok(R.updateElo(1500, 1500, 0, 50) === 1490, 'established loss vs equal → 1490');
  // a draw against an equal opponent never moves the number
  ok(R.updateElo(1500, 1500, 0.5, 50) === 1500, 'draw vs equal → unchanged');
}

console.log('— Glicko-2 (Glickman 2013 worked example) —');
{
  // Player r=1500, RD=200, σ=0.06, τ=0.5 vs three opponents.
  const res = R.updateGlicko(1500, 200, 0.06, [
    { rating: 1400, rd: 30,  score: 1 },
    { rating: 1550, rd: 100, score: 0 },
    { rating: 1700, rd: 300, score: 0 },
  ], 0.5);
  // Published results: r' ≈ 1464.06, RD' ≈ 151.52, σ' ≈ 0.05999.
  ok(near(res._ratingExact, 1464.06, 0.1), 'new rating ≈ 1464.06 (got ' + res._ratingExact.toFixed(2) + ')');
  ok(near(res._rdExact, 151.52, 0.1), 'new RD ≈ 151.52 (got ' + res._rdExact.toFixed(2) + ')');
  ok(near(res.vol, 0.05999, 1e-4), "new σ ≈ 0.05999 (got " + res.vol.toFixed(6) + ')');
}

console.log('— Glicko-2 inactivity —');
{
  // No games: rating unchanged, RD grows by √(φ²+σ²).
  const res = R.updateGlicko(1500, 200, 0.06, [], 0.5);
  ok(res.rating === 1500, 'idle period leaves rating unchanged');
  ok(res.rd >= 200, 'idle period widens RD');
}

console.log('— display equivalents (estimates) —');
{
  ok(R.eloToUSCF(1200) === 1275, 'USCF ≈ Elo+75');
  ok(R.eloToECF(1500) === 107, 'ECF = (Elo−700)/7.5');
  ok(R.ecfToElo(R.eloToECF(1500)) >= 1490 && R.ecfToElo(R.eloToECF(1500)) <= 1510, 'ECF round-trips near source');
}

console.log('— system seeding —');
{
  const gk = R.seedFor('glicko', 1640);
  ok(gk.rating === 1640 && gk.rd === 350 && gk.vol === 0.06, 'seed Glicko from Elo keeps number, resets RD/σ');
  const el = R.seedFor('elo', 1640.7);
  ok(el.rating === 1641, 'seed Elo rounds the carried number');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
