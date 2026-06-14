/* ============================================================
   Maestro's Gambit — battle.js
   The on-stage duels. Every attacker/defender pairing has its
   own hand-written choreography (36 in all — including the six
   checkmate finales against the Conductor).

   Choreography step shape:
     st('A'|'D', action, dur, {
       gap:  walk so my front is `gap` units from the enemy
       dx:   slide this many units toward the enemy (- = retreat)
       arc:  hop arc height for the slide
       say / sayAt:    speech popup
       fx:  [{at, run(S)}]   sfx are triggered the same way
       with:[ substeps on the other actor, {delay} offsets ]
     })
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});
  const TAU = Math.PI * 2;
  const NAMES = { P: 'Violinist', N: 'Cellist', B: 'Clarinetist', R: 'Percussionist', Q: 'Pianist', K: 'Conductor' };
  const LOOPED = new Set(['idle', 'walk', 'ride', 'special', 'taunt', 'win', 'cheer', 'dead']);

  const st = (who, act, dur, o = {}) => Object.assign({ who, act, dur }, o);
  const fx = (at, run) => ({ at, run });

  /* ---------- entrances, per attacker type ---------- */
  function approach(T) {
    const gaps = { P: 27, N: 31, B: 35, R: 25, Q: 33, K: 29 };
    const g = gaps[T];
    switch (T) {
      case 'N': return [st('A', 'ride', 1.1, {
        gap: g, fx: [
          fx(0.0, (S) => S.au.whoosh(0, 0.4, 0.5)),
          fx(0.15, (S) => S.au.bow(98, 0, 0.35, 0.7, 147)),
          fx(0.3, (S) => S.fxl.dust(S.px('A', -4), S.gy, 6)),
          fx(0.7, (S) => S.fxl.dust(S.px('A', -4), S.gy, 6)),
        ],
      })];
      case 'R': return [st('A', 'walk', 1.6, {
        gap: g, heavy: true,
        fx: [fx(0.1, (S) => S.au.bow(65, 0, 0.3, 1.4))],
      })];
      case 'Q': return [st('A', 'walk', 1.3, {
        gap: g, fx: [fx(0.1, (S) => S.au.pianoChord([262, 330, 392], 0, 0.2, 0.9, 0.06))],
      })];
      case 'K': return [st('A', 'walk', 1.4, {
        gap: g, fx: [fx(0.1, (S) => S.au.bow(131, 0, 0.3, 1.1))],
      })];
      default: return [st('A', 'walk', 1.2, { gap: g })];
    }
  }

  /* ---------- attacker impact noise ---------- */
  const IMPACT = {
    P: (S) => { S.au.stringStab(523, 0, 0.5); S.au.whoosh(0, 0.3, 0.18); },
    N: (S) => { S.au.timpani(0, 0.8, 65); S.au.thud(0.02, 0.5); S.fxl.shake(7, 0.3); },
    B: (S) => { S.au.reed(880, 0, 0.45, 0.18); S.au.whoosh(0, 0.3, 0.15); },
    R: (S) => { S.au.timpani(0, 0.95, 55); S.fxl.shake(10, 0.4); },
    Q: (S) => { S.au.pianoChord([196, 247, 294, 392], 0, 0.5, 0.7, 0.01); },
    K: (S) => { S.au.zap(0, 0.55); S.au.brass(196, 0.02, 0.3, 0.3); },
  };

  /* ---------- defender death cries ---------- */
  const DEATH_SFX = {
    P: (S) => { S.au.pluck(440, 0, 0.4); S.au.pluck(349, 0.18, 0.4); S.au.pluck(262, 0.36, 0.45, 0.7); S.au.thud(0.8, 0.4); },
    N: (S) => { S.au.bow(82, 0, 0.45, 0.9, 55); S.au.thud(0.5, 0.6); S.au.snare(0.55, 0.3); },
    B: (S) => { S.au.squeak(0, 0.55); S.au.squeak(0.2, 0.4); S.au.thud(0.9, 0.45); },
    R: (S) => { S.au.thud(0.6, 0.8); S.au.timpani(0.62, 0.7, 50); S.au.cymbal(0.7, 0.4, 1.4); S.fxlShakeLate(S, 0.6, 9); },
    Q: (S) => { S.au.cluster(0.1, 0.5); S.au.thud(0.95, 0.45); },
    K: (S) => { S.au.dirge(); },
  };

  /* helper used above (shake scheduled later) */
  function fxlShakeLate(S, delay, amp) { S.later(delay, () => S.fxl.shake(amp, 0.4)); }

  /* ---------- common beats ---------- */
  const DIE = (T, extraDur = 0) => st('D', 'die', (T === 'K' ? 2.6 : 1.5) + extraDur, {
    fx: [fx(0.05, (S) => DEATH_SFX[T](S)),
         fx(T === 'R' ? 1.15 : 1.0, (S) => S.fxl.dust(S.px('D', 0), S.gy, 10))],
  });
  const WIN = (say) => st('A', 'win', 1.7, {
    say, sayAt: 0.5,
    fx: [fx(0.1, (S) => { S.au.fanfareWin(); S.fxl.confetti(S.px('A', 0), S.gy - 180); }),
         fx(0.2, (S) => S.fxl.notes(S.px('A', 0), S.gy - 120, 8, S.noteCol('A')))],
  });
  const HIT = (dur = 0.5, dx = -7, say = null) => st('D', 'hit', dur, { dx, say, sayAt: 0.05 });

  // attacker strike with synchronized defender hit
  function STRIKE(T, opts = {}) {
    const impactAt = opts.impactAt ?? 0.16;
    return st('A', 'strike', 0.42, {
      dx: opts.lunge ?? (T === 'P' ? 6 : 2),
      fx: [fx(impactAt, (S) => { IMPACT[T](S); S.strikeFX(T); })],
      with: [Object.assign(HIT(0.5, opts.kb ?? -7), { delay: impactAt })].concat(opts.with || []),
      ...('say' in opts ? { say: opts.say } : {}),
    });
  }

  /* ============================================================
     THE CHOREOGRAPHY BOOK — 36 unique duels
     ============================================================ */
  const CHOREO = {

    /* ================= VIOLINIST attacks ================= */
    'P>P': [ // a proper fencing duel between section rivals
      ...approach('P'),
      st('D', 'taunt', 0.8, { say: 'You’re flat.' }),
      st('A', 'windup', 0.45, { say: 'Second chair… forever.' }),
      st('A', 'strike', 0.4, { dx: 5, fx: [fx(0.16, (S) => S.clash())], with: [st('D', 'block', 0.45, { delay: 0.1 })] }),
      st('D', 'strike', 0.4, { dx: 4, fx: [fx(0.16, (S) => S.clash())], with: [st('A', 'block', 0.45, { delay: 0.1 })] }),
      st('A', 'dodge', 0.45, { dx: -3 }),
      st('A', 'special', 0.9, { fx: [fx(0.1, (S) => S.tremolo('A', 5)), fx(0.15, (S) => S.au.bow(660, 0, 0.4, 0.7, 880))] }),
      HIT(0.5, -6),
      STRIKE('P', { say: 'Cadenza!' }),
      DIE('P'),
      WIN('First chair is mine.'),
    ],

    'P>N': [
      ...approach('P'),
      st('A', 'windup', 0.45),
      st('A', 'strike', 0.4, { dx: 5, fx: [fx(0.16, (S) => { S.au.block(0, 0.5, 300); S.fxl.sparks(S.mid(), S.gy - 70, 8); })], with: [st('D', 'block', 0.5, { delay: 0.08, say: 'The cello shields me!' })] }),
      st('A', 'dodge', 0.4, { dx: -4 }),
      st('A', 'special', 1.1, { say: 'Tremolo!', fx: [fx(0.1, (S) => S.tremolo('A', 7)), fx(0.12, (S) => S.au.bow(587, 0, 0.45, 0.9, 784))] }),
      HIT(0.55, -8),
      STRIKE('P'),
      DIE('N'),
      WIN('Strings beat… bigger strings.'),
    ],

    'P>B': [
      ...approach('P'),
      st('D', 'windup', 0.4),
      st('D', 'strike', 0.4, { dx: 3, fx: [fx(0.16, (S) => S.au.whoosh(0, 0.3))], with: [st('A', 'dodge', 0.5, { delay: 0.06, dx: -4 })] }),
      st('A', 'taunt', 0.6, { say: 'Too slow, woodwind.' }),
      st('A', 'windup', 0.4),
      STRIKE('P', { kb: -6 }),
      st('A', 'special', 0.9, { fx: [fx(0.08, (S) => S.tremolo('A', 6))] }),
      HIT(0.5, -6),
      STRIKE('P'),
      DIE('B'),
      WIN('A cut above the reeds.'),
    ],

    'P>R': [
      ...approach('P'),
      st('A', 'windup', 0.45),
      st('A', 'strike', 0.4, { dx: 5, fx: [fx(0.16, (S) => { S.au.timpani(0, 0.4, 90); S.fxl.sparks(S.px('D', -6), S.gy - 60, 6); })], with: [st('D', 'taunt', 0.7, { delay: 0.2, say: 'Pianissimo?' })] }),
      st('A', 'dodge', 0.4, { dx: -5 }),
      st('A', 'special', 1.2, { say: 'FORTISSIMO!', fx: [fx(0.08, (S) => S.tremolo('A', 9)), fx(0.1, (S) => S.au.bow(523, 0, 0.5, 1.1, 1047))] }),
      st('D', 'hit', 0.6, { dx: -3 }),
      STRIKE('P', { impactAt: 0.18 }),
      DIE('R'),
      WIN('The bigger they boom…'),
    ],

    'P>Q': [
      ...approach('P'),
      st('D', 'taunt', 0.9, { say: 'A soloist? How quaint.' }),
      st('A', 'windup', 0.45, { say: 'Quaint THIS.' }),
      STRIKE('P', { lunge: 7, kb: -8 }),
      st('D', 'strike', 0.45, { fx: [fx(0.16, (S) => { S.au.pianoChord([330, 415, 494], 0, 0.4, 0.5); S.keyWave('D'); })], with: [st('A', 'dodge', 0.5, { delay: 0.05, dx: -5 })] }),
      st('A', 'special', 1.0, { fx: [fx(0.08, (S) => S.tremolo('A', 8))] }),
      HIT(0.5, -7),
      STRIKE('P'),
      DIE('Q'),
      WIN('Encore? No.'),
    ],

    'P>K': [ // a pawn delivers checkmate — David and Goliath
      ...approach('P'),
      st('D', 'taunt', 1.0, { say: 'You? A section player?' }),
      st('A', 'windup', 0.55, { say: 'Every note counts.' }),
      st('A', 'special', 1.1, { fx: [fx(0.08, (S) => S.tremolo('A', 8)), fx(0.1, (S) => S.au.bow(440, 0, 0.5, 1.0, 880))] }),
      HIT(0.6, -6),
      STRIKE('P', { lunge: 7 }),
      DIE('K'),
      st('A', 'win', 2.2, { say: 'The orchestra is mine.', sayAt: 0.6, fx: [fx(0.1, (S) => S.curtainCall())] }),
    ],

    /* ================= CELLIST attacks ================= */
    'N>P': [
      ...approach('N'),
      st('D', 'hit', 0.5, { dx: -5, say: 'Eek—!' }),
      st('A', 'taunt', 0.7, { say: 'Coming through!' }),
      st('A', 'windup', 0.5),
      STRIKE('N', { kb: -9 }),
      st('A', 'special', 0.9, { dx: 6, fx: [fx(0.1, (S) => { S.au.whoosh(0, 0.45, 0.4); S.fxl.dust(S.px('A', 0), S.gy, 8); })], with: [st('D', 'hit', 0.5, { delay: 0.25, dx: -8 })] }),
      st('A', 'windup', 0.45),
      STRIKE('N'),
      DIE('P'),
      WIN('Low notes hit harder.'),
    ],

    'N>N': [ // the cello joust
      ...approach('N'),
      st('D', 'taunt', 0.7, { say: 'A joust, then!' }),
      st('A', 'ride', 0.55, { dx: 14, fx: [fx(0.05, (S) => S.au.whoosh(0, 0.4)), fx(0.25, (S) => S.clash())], with: [st('D', 'ride', 0.55, { delay: 0, dx: -2 })] }),
      st('A', 'ride', 0.55, { dx: -14, fx: [fx(0.05, (S) => S.au.whoosh(0, 0.4)), fx(0.25, (S) => S.clash())], with: [st('D', 'dodge', 0.5, { delay: 0.1 })] }),
      st('A', 'windup', 0.5, { say: 'Third pass settles it.' }),
      st('A', 'special', 0.7, { dx: 10, fx: [fx(0.05, (S) => S.au.bow(98, 0, 0.4, 0.6, 196)), fx(0.3, (S) => IMPACT.N(S))], with: [st('D', 'hit', 0.55, { delay: 0.3, dx: -9 })] }),
      DIE('N'),
      WIN('Unseated!'),
    ],

    'N>B': [
      ...approach('N'),
      st('A', 'windup', 0.5),
      st('A', 'strike', 0.42, { dx: 3, fx: [fx(0.16, (S) => { S.au.block(0, 0.5, 400); S.fxl.sparks(S.mid(), S.gy - 80, 8); })], with: [st('D', 'block', 0.5, { delay: 0.08, say: 'The staff holds!' })] }),
      st('A', 'windup', 0.55, { say: 'Then I’ll swing HARDER.' }),
      STRIKE('N', { kb: -9 }),
      st('A', 'special', 0.8, { dx: 7, fx: [fx(0.25, (S) => IMPACT.N(S))], with: [st('D', 'hit', 0.5, { delay: 0.25, dx: -7 })] }),
      DIE('B'),
      WIN('Snapped like a reed.'),
    ],

    'N>R': [
      ...approach('N'),
      st('A', 'windup', 0.5),
      STRIKE('N', { kb: -3 }),
      st('D', 'windup', 0.45),
      st('D', 'strike', 0.42, { fx: [fx(0.16, (S) => { S.au.timpani(0, 0.7, 60); S.fxl.shake(6, 0.3); })], with: [st('A', 'dodge', 0.55, { delay: 0.05, dx: -6 })] }),
      st('A', 'taunt', 0.6, { say: 'Heavy. Slow.' }),
      st('A', 'special', 0.9, { dx: 9, fx: [fx(0.05, (S) => S.au.whoosh(0, 0.5, 0.45)), fx(0.35, (S) => IMPACT.N(S))], with: [st('D', 'hit', 0.6, { delay: 0.35, dx: -8 })] }),
      DIE('R'),
      WIN('Percussion? Repercussion.'),
    ],

    'N>Q': [
      ...approach('N'),
      st('D', 'strike', 0.45, { say: 'Shoo.', fx: [fx(0.16, (S) => { S.keyWave('D'); S.au.pianoChord([330, 392, 494], 0, 0.4, 0.5); })], with: [st('A', 'block', 0.5, { delay: 0.08 })] }),
      st('A', 'taunt', 0.6, { say: 'Cute. My turn.' }),
      st('A', 'windup', 0.55),
      STRIKE('N', { kb: -8 }),
      st('A', 'special', 0.8, { dx: 7, fx: [fx(0.28, (S) => IMPACT.N(S))], with: [st('D', 'hit', 0.5, { delay: 0.28, dx: -7 })] }),
      DIE('Q'),
      WIN('The bench is vacant.'),
    ],

    'N>K': [
      ...approach('N'),
      st('D', 'windup', 0.5),
      st('D', 'strike', 0.45, { fx: [fx(0.16, (S) => { S.au.zap(0, 0.45); S.boltAt('D', 'A'); })], with: [st('A', 'hit', 0.5, { delay: 0.16, dx: -4 })] }),
      st('A', 'taunt', 0.7, { say: 'You can’t conduct me.' }),
      st('A', 'windup', 0.55),
      st('A', 'special', 0.9, { dx: 9, fx: [fx(0.05, (S) => S.au.whoosh(0, 0.5)), fx(0.35, (S) => IMPACT.N(S))], with: [st('D', 'hit', 0.6, { delay: 0.35, dx: -7 })] }),
      STRIKE('N'),
      DIE('K'),
      st('A', 'win', 2.2, { say: 'The podium falls.', sayAt: 0.6, fx: [fx(0.1, (S) => S.curtainCall())] }),
    ],

    /* ================= CLARINETIST attacks ================= */
    'B>P': [ // sniped from long range
      st('A', 'walk', 1.0, { gap: 55 }),
      st('A', 'windup', 0.45),
      st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart())], with: [st('D', 'hit', 0.45, { delay: 0.3, dx: -4 })] }),
      st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart())], with: [st('D', 'hit', 0.45, { delay: 0.3, dx: -4 })] }),
      st('D', 'taunt', 0.6, { say: 'Stop that!' }),
      st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart())], with: [st('D', 'hit', 0.45, { delay: 0.3, dx: -4 })] }),
      st('A', 'walk', 0.7, { gap: 30 }),
      STRIKE('B', { lunge: 5 }),
      DIE('P'),
      WIN('Pinpoint phrasing.'),
    ],

    'B>N': [
      ...approach('B'),
      st('A', 'windup', 0.45),
      st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart())], with: [st('D', 'block', 0.5, { delay: 0.25, say: 'Blocked!' })] }),
      st('A', 'strike', 0.42, { dx: 4, fx: [fx(0.16, (S) => IMPACT.B(S))], with: [HIT(0.5, -6)] }),
      st('A', 'special', 0.9, { fx: [fx(0.08, (S) => S.dart()), fx(0.32, (S) => S.dart()), fx(0.56, (S) => S.dart())], with: [st('D', 'hit', 0.5, { delay: 0.4, dx: -5 })] }),
      STRIKE('B'),
      DIE('N'),
      WIN('Sixteenth notes, full tempo.'),
    ],

    'B>B': [ // duel of the staffs — won with a painful altissimo note
      ...approach('B'),
      st('D', 'taunt', 0.7, { say: 'My embouchure is better.' }),
      st('A', 'strike', 0.42, { dx: 3, fx: [fx(0.16, (S) => S.clash())], with: [st('D', 'block', 0.45, { delay: 0.08 })] }),
      st('D', 'strike', 0.42, { dx: 3, fx: [fx(0.16, (S) => S.clash())], with: [st('A', 'block', 0.45, { delay: 0.08 })] }),
      st('A', 'dodge', 0.45, { dx: -3, say: 'Try THIS register.' }),
      st('A', 'special', 1.0, { fx: [fx(0.1, (S) => { S.au.squeak(0, 0.6); S.au.reed(1976, 0.1, 0.4, 0.5); S.fxl.ring(S.px('A', 6), S.gy - 80, 'rgba(190,230,255,0.8)', 4, 160, 0.6); })], with: [st('D', 'hit', 0.7, { delay: 0.2, dx: -6, say: 'MY EARS—' })] }),
      STRIKE('B'),
      DIE('B'),
      WIN('Altissimo supremacy.'),
    ],

    'B>R': [ // darts plink off the drum; win it with footwork
      ...approach('B'),
      st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart()), fx(0.34, (S) => { S.au.block(0, 0.4, 1100); S.fxl.sparks(S.px('D', -7), S.gy - 60, 5); })], with: [st('D', 'taunt', 0.6, { delay: 0.3, say: 'Plink.' })] }),
      st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart()), fx(0.34, (S) => { S.au.block(0, 0.4, 1100); S.fxl.sparks(S.px('D', -7), S.gy - 60, 5); })] }),
      st('A', 'dodge', 0.5, { dx: 8, say: 'Then I’ll go around.' }),
      st('A', 'strike', 0.42, { dx: 3, fx: [fx(0.16, (S) => IMPACT.B(S))], with: [HIT(0.55, -3)] }),
      st('A', 'strike', 0.42, { dx: 2, fx: [fx(0.16, (S) => IMPACT.B(S))], with: [HIT(0.55, -3)] }),
      DIE('R'),
      WIN('Dynamics beat decibels.'),
    ],

    'B>Q': [
      ...approach('B'),
      st('D', 'strike', 0.45, { fx: [fx(0.16, (S) => { S.keyWave('D'); S.au.pianoChord([294, 370, 440], 0, 0.4, 0.5); })], with: [st('A', 'dodge', 0.55, { delay: 0.05, dx: -5 })] }),
      st('A', 'taunt', 0.6, { say: 'Missed a key change.' }),
      st('A', 'special', 0.9, { fx: [fx(0.08, (S) => S.dart()), fx(0.32, (S) => S.dart()), fx(0.56, (S) => S.dart())], with: [st('D', 'hit', 0.5, { delay: 0.35, dx: -5 })] }),
      st('A', 'walk', 0.5, { gap: 28 }),
      STRIKE('B'),
      DIE('Q'),
      WIN('Resolved. Authentic cadence.'),
    ],

    'B>K': [
      ...approach('B'),
      st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart()), fx(0.34, (S) => { S.au.block(0, 0.4, 900); S.fxl.sparks(S.px('D', -5), S.gy - 85, 6); })], with: [st('D', 'block', 0.6, { delay: 0.25, say: 'I’ve cut sharper soloists.' })] }),
      st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart())], with: [st('D', 'hit', 0.5, { delay: 0.3, dx: -4 })] }),
      st('A', 'walk', 0.6, { gap: 30 }),
      st('A', 'windup', 0.5, { say: 'Final movement.' }),
      STRIKE('B', { lunge: 5 }),
      DIE('K'),
      st('A', 'win', 2.2, { say: 'The reed section rises.', sayAt: 0.6, fx: [fx(0.1, (S) => S.curtainCall())] }),
    ],

    /* ================= PERCUSSIONIST attacks ================= */
    'R>P': [
      ...approach('R'),
      st('D', 'windup', 0.4, { say: 'I’m not afraid of you!' }),
      st('D', 'strike', 0.4, { dx: 4, fx: [fx(0.16, (S) => { S.au.block(0, 0.5, 250); S.fxl.sparks(S.px('A', 6), S.gy - 70, 6); })], with: [st('A', 'taunt', 0.6, { delay: 0.2 })] }),
      st('D', 'hit', 0.5, { dx: -6, say: 'It bounced off?!' }),
      st('A', 'windup', 0.6),
      st('A', 'strike', 0.45, { dx: 3, fx: [fx(0.18, (S) => { IMPACT.R(S); S.shockwave('A'); })], with: [st('D', 'hit', 0.6, { delay: 0.18, dx: -12 })] }),
      DIE('P'),
      WIN('One beat. One bar.'),
    ],

    'R>N': [
      ...approach('R'),
      st('D', 'ride', 0.5, { dx: 8, say: 'CHARGE!' }),
      st('A', 'special', 0.55, { fx: [fx(0.2, (S) => { S.au.cymbal(0, 0.7, 1.0); S.fxl.flash('rgba(255,240,180,0.4)'); S.fxl.ring(S.px('A', 8), S.gy - 70, 'rgba(255,220,120,0.9)', 8, 140, 0.5); })], with: [st('D', 'hit', 0.6, { delay: 0.22, dx: -9, say: 'The RINGING—' })] }),
      st('A', 'windup', 0.55),
      st('A', 'strike', 0.45, { dx: 3, fx: [fx(0.18, (S) => { IMPACT.R(S); S.shockwave('A'); })], with: [st('D', 'hit', 0.55, { delay: 0.18, dx: -9 })] }),
      DIE('N'),
      WIN('Crash. Cymbal. Done.'),
    ],

    'R>B': [
      ...approach('R'),
      st('D', 'strike', 0.42, { dx: 3, fx: [fx(0.16, (S) => { S.au.block(0, 0.5, 300); S.fxl.sparks(S.px('A', 5), S.gy - 75, 6); })], with: [st('A', 'block', 0.5, { delay: 0.05 })] }),
      st('A', 'taunt', 0.7, { say: 'My drum disagrees.' }),
      st('A', 'windup', 0.6),
      st('A', 'strike', 0.45, { dx: 2, fx: [fx(0.18, (S) => { IMPACT.R(S); S.shockwave('A'); })], with: [st('D', 'hit', 0.6, { delay: 0.18, dx: -11 })] }),
      DIE('B'),
      WIN('Woodwinds: 0. Battery: 1.'),
    ],

    'R>R': [ // the drum-off
      ...approach('R'),
      st('D', 'taunt', 0.8, { say: 'DRUM-OFF.' }),
      st('A', 'strike', 0.5, { fx: [fx(0.2, (S) => { S.au.timpani(0, 0.7, 70); S.fxl.shake(5, 0.25); })] }),
      st('D', 'strike', 0.5, { fx: [fx(0.2, (S) => { S.au.timpani(0, 0.8, 60); S.fxl.shake(7, 0.3); })] }),
      st('A', 'strike', 0.5, { fx: [fx(0.2, (S) => { S.au.timpani(0, 0.9, 50); S.fxl.shake(9, 0.35); })] }),
      st('D', 'taunt', 0.5, { say: 'Top THAT.' }),
      st('A', 'special', 0.6, { say: 'Gladly.', fx: [fx(0.22, (S) => { S.au.cymbal(0, 0.8, 1.4); S.au.timpani(0.02, 0.9, 45); S.fxl.flash('rgba(255,240,180,0.5)'); S.fxl.shake(12, 0.5); S.shockwave('A'); })], with: [st('D', 'hit', 0.6, { delay: 0.25, dx: -10 })] }),
      DIE('R'),
      WIN('The downbeat is MINE.'),
    ],

    'R>Q': [
      ...approach('R'),
      st('D', 'strike', 0.45, { say: 'Heathen.', fx: [fx(0.16, (S) => { S.keyWave('D'); S.au.pianoChord([262, 330, 415], 0, 0.4, 0.5); })], with: [st('A', 'hit', 0.5, { delay: 0.18, dx: -2 })] }),
      st('A', 'taunt', 0.6, { say: '88 keys. One mallet.' }),
      st('A', 'windup', 0.6),
      st('A', 'strike', 0.45, { dx: 3, fx: [fx(0.18, (S) => { IMPACT.R(S); S.shockwave('A'); })], with: [st('D', 'hit', 0.6, { delay: 0.18, dx: -10 })] }),
      st('A', 'special', 0.55, { fx: [fx(0.2, (S) => { S.au.cymbal(0, 0.7, 1.1); S.fxl.ring(S.px('A', 8), S.gy - 70, 'rgba(255,220,120,0.9)', 8, 150, 0.5); })], with: [st('D', 'hit', 0.5, { delay: 0.22, dx: -6 })] }),
      DIE('Q'),
      WIN('Forte means LOUD.'),
    ],

    'R>K': [ // dread: slow stomps, defiant king, one terrible boom
      st('A', 'walk', 2.0, { gap: 25, heavy: true, fx: [fx(0.1, (S) => S.au.bow(55, 0, 0.35, 1.8))] }),
      st('D', 'windup', 0.5, { say: 'You were ALWAYS rushing.' }),
      st('D', 'strike', 0.45, { fx: [fx(0.16, (S) => { S.au.zap(0, 0.5); S.boltAt('D', 'A'); })], with: [st('A', 'hit', 0.45, { delay: 0.16, dx: -2 })] }),
      st('A', 'taunt', 0.8, { say: 'And you dragged.' }),
      st('A', 'windup', 0.7),
      st('A', 'strike', 0.5, { dx: 3, fx: [fx(0.2, (S) => { IMPACT.R(S); S.shockwave('A'); S.fxl.flash('rgba(255,255,255,0.35)'); })], with: [st('D', 'hit', 0.6, { delay: 0.2, dx: -9 })] }),
      DIE('K'),
      st('A', 'win', 2.2, { say: 'Concert’s over.', sayAt: 0.6, fx: [fx(0.1, (S) => S.curtainCall())] }),
    ],

    /* ================= PIANIST attacks ================= */
    'Q>P': [
      ...approach('Q'),
      st('D', 'hit', 0.45, { dx: -3, say: 'Oh no.' }),
      st('A', 'taunt', 0.7, { say: 'A little étude.' }),
      st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.Q(S); S.keyWave('A'); })], with: [HIT(0.5, -7)] }),
      st('A', 'windup', 0.6, { say: 'Now — the finale.' }),
      st('A', 'special', 1.0, { fx: [fx(0.15, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.62, dx: -3 })] }),
      DIE('P', 0.2),
      WIN('Crushed it.'),
    ],

    'Q>N': [
      ...approach('Q'),
      st('D', 'ride', 0.5, { dx: 9, say: 'GANGWAY!' }),
      st('A', 'dodge', 0.5, { dx: -6, say: 'I think not.' }),
      st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.Q(S); S.keyWave('A'); })], with: [HIT(0.5, -8)] }),
      st('A', 'windup', 0.6),
      st('A', 'special', 1.0, { say: 'From the rafters!', fx: [fx(0.15, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.62, dx: -3 })] }),
      DIE('N', 0.2),
      WIN('Movers will handle the rest.'),
    ],

    'Q>B': [
      ...approach('Q'),
      st('D', 'special', 0.5, { fx: [fx(0.1, (S) => S.dartFrom('D'))], with: [st('A', 'block', 0.55, { delay: 0.25, fx: [fx(0.3, (S2) => { S2.au.block(0, 0.4, 1000); S2.fxl.sparks(S2.px('A', 5), S2.gy - 70, 5); })] })] }),
      st('A', 'taunt', 0.6, { say: 'Keys make fine shields.' }),
      st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.Q(S); S.keyWave('A'); })], with: [HIT(0.5, -7)] }),
      st('A', 'windup', 0.6),
      st('A', 'special', 1.0, { fx: [fx(0.15, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.62, dx: -3 })] }),
      DIE('B', 0.2),
      WIN('Flat. Properly flat.'),
    ],

    'Q>R': [ // shockwave meets chord wave
      ...approach('Q'),
      st('D', 'windup', 0.5),
      st('D', 'strike', 0.45, { fx: [fx(0.18, (S) => { S.au.timpani(0, 0.7, 60); S.shockwave('D'); })], with: [st('A', 'strike', 0.5, { delay: 0.05, fx: [fx(0.16, (S2) => { IMPACT.Q(S2); S2.keyWave('A'); S2.fxl.sparks(S2.mid(), S2.gy - 60, 14); S2.au.cymbal(0.05, 0.4, 0.8); })] })] }),
      st('D', 'hit', 0.55, { dx: -7, say: 'My wave LOST?!' }),
      st('A', 'taunt', 0.6, { say: 'Harmony wins.' }),
      st('A', 'windup', 0.6),
      st('A', 'special', 1.0, { fx: [fx(0.15, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.62, dx: -3 })] }),
      DIE('R', 0.2),
      WIN('Tuned percussion. Mine.'),
    ],

    'Q>Q': [ // the diva duel
      ...approach('Q'),
      st('D', 'taunt', 0.8, { say: 'I headlined Vienna.' }),
      st('A', 'taunt', 0.8, { say: 'I OWNED Vienna.' }),
      st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.Q(S); S.keyWave('A'); })], with: [st('D', 'block', 0.5, { delay: 0.1 })] }),
      st('D', 'strike', 0.45, { fx: [fx(0.16, (S) => { S.au.pianoChord([233, 294, 349], 0, 0.5, 0.6); S.keyWave('D'); })], with: [st('A', 'dodge', 0.5, { delay: 0.08, dx: -4 })] }),
      st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.Q(S); S.keyWave('A'); })], with: [HIT(0.5, -7)] }),
      st('A', 'windup', 0.7, { say: 'Lid. Closed.' }),
      st('A', 'special', 1.0, { fx: [fx(0.15, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.62, dx: -3 })] }),
      DIE('Q', 0.2),
      WIN('One piano town.'),
    ],

    'Q>K': [ // checkmate by piano — the grandest finale
      ...approach('Q'),
      st('D', 'taunt', 0.9, { say: 'You play when I SAY.' }),
      st('A', 'taunt', 0.8, { say: 'I play your requiem.' }),
      st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.Q(S); S.keyWave('A'); })], with: [HIT(0.55, -7)] }),
      st('A', 'windup', 0.8),
      st('A', 'special', 1.2, { fx: [fx(0.2, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.7, dx: -3 })] }),
      DIE('K', 0.2),
      st('A', 'win', 2.2, { say: 'Fin.', sayAt: 0.6, fx: [fx(0.1, (S) => S.curtainCall())] }),
    ],

    /* ================= CONDUCTOR attacks ================= */
    'K>P': [
      ...approach('K'),
      st('D', 'hit', 0.5, { dx: -3, say: 'M-maestro! I was just—' }),
      st('A', 'taunt', 0.8, { say: 'You’re cut from the program.' }),
      st('A', 'windup', 0.5),
      st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.K(S); S.boltAt('A', 'D'); })], with: [HIT(0.55, -8)] }),
      DIE('P'),
      WIN('Auditions Monday.'),
    ],

    'K>N': [
      ...approach('K'),
      st('D', 'ride', 0.5, { dx: 8 }),
      st('A', 'strike', 0.45, { say: 'SIT.', fx: [fx(0.14, (S) => { IMPACT.K(S); S.boltAt('A', 'D'); })], with: [st('D', 'hit', 0.55, { delay: 0.14, dx: -8 })] }),
      st('A', 'windup', 0.5),
      st('A', 'special', 0.8, { fx: [fx(0.2, (S) => { S.au.brass(165, 0, 0.5, 0.6); S.fxl.ring(S.px('A', 6), S.gy - 90, 'rgba(255,235,150,0.85)', 10, 170, 0.55); })], with: [st('D', 'hit', 0.5, { delay: 0.25, dx: -6 })] }),
      DIE('N'),
      WIN('Tempo restored.'),
    ],

    'K>B': [
      ...approach('K'),
      st('D', 'special', 0.5, { fx: [fx(0.1, (S) => S.dartFrom('D'))], with: [st('A', 'block', 0.5, { delay: 0.22, fx: [fx(0.28, (S2) => { S2.au.block(0, 0.4, 1000); S2.fxl.sparks(S2.px('A', 4), S2.gy - 80, 5); })] })] }),
      st('A', 'taunt', 0.7, { say: 'Off-beat. As always.' }),
      st('A', 'windup', 0.5),
      st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.K(S); S.boltAt('A', 'D'); })], with: [HIT(0.55, -7)] }),
      DIE('B'),
      WIN('Watch the baton next time.'),
    ],

    'K>R': [
      ...approach('K'),
      st('D', 'strike', 0.5, { fx: [fx(0.2, (S) => { S.au.timpani(0, 0.7, 60); S.shockwave('D'); })], with: [st('A', 'block', 0.55, { delay: 0.1 })] }),
      st('A', 'taunt', 0.7, { say: 'I’ve heard louder yawns.' }),
      st('A', 'windup', 0.6),
      st('A', 'special', 0.9, { say: 'TUTTI!', fx: [fx(0.2, (S) => { S.au.brass(131, 0, 0.55, 0.7); S.au.zap(0.1, 0.5); S.boltAt('A', 'D'); S.fxl.ring(S.px('A', 6), S.gy - 90, 'rgba(255,235,150,0.85)', 10, 190, 0.6); S.fxl.shake(7, 0.3); })], with: [st('D', 'hit', 0.6, { delay: 0.25, dx: -8 })] }),
      DIE('R'),
      WIN('Dynamics, dear fellow.'),
    ],

    'K>Q': [ // the maestro silences the diva
      ...approach('K'),
      st('D', 'strike', 0.45, { say: 'I take no direction.', fx: [fx(0.16, (S) => { S.au.pianoChord([247, 311, 370], 0, 0.5, 0.6); S.keyWave('D'); })], with: [st('A', 'dodge', 0.5, { delay: 0.06, dx: -4 })] }),
      st('A', 'taunt', 0.7, { say: 'Then take a rest.' }),
      st('A', 'windup', 0.55),
      st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.K(S); S.boltAt('A', 'D'); })], with: [HIT(0.55, -7)] }),
      st('A', 'special', 0.8, { fx: [fx(0.2, (S) => { S.au.brass(147, 0, 0.5, 0.6); S.fxl.ring(S.px('A', 6), S.gy - 90, 'rgba(255,235,150,0.85)', 10, 170, 0.55); })], with: [st('D', 'hit', 0.5, { delay: 0.25, dx: -5 })] }),
      DIE('Q'),
      WIN('A whole rest.'),
    ],

    'K>K': [ // duel of the maestros (only possible via promotion shenanigans — but ready!)
      ...approach('K'),
      st('D', 'taunt', 0.8, { say: 'MY orchestra.' }),
      st('A', 'taunt', 0.8, { say: 'Was. Past tense.' }),
      st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.K(S); S.boltAt('A', 'D'); })], with: [st('D', 'block', 0.5, { delay: 0.1 })] }),
      st('D', 'strike', 0.45, { fx: [fx(0.16, (S) => { S.au.zap(0, 0.5); S.boltAt('D', 'A'); })], with: [st('A', 'dodge', 0.5, { delay: 0.06, dx: -4 })] }),
      st('A', 'special', 0.9, { fx: [fx(0.2, (S) => { S.au.brass(131, 0, 0.55, 0.7); S.boltAt('A', 'D'); S.fxl.shake(8, 0.35); })], with: [st('D', 'hit', 0.6, { delay: 0.25, dx: -8 })] }),
      DIE('K'),
      st('A', 'win', 2.2, { say: 'One baton to rule them.', sayAt: 0.6, fx: [fx(0.1, (S) => S.curtainCall())] }),
    ],
  };

  /* ---------- finale beat: the grand checkmate bow ---------- */
  const FINALE = (say) => st('A', 'win', 2.2, {
    say, sayAt: 0.55,
    fx: [fx(0.1, (S) => S.grandFinale())],
  });

  /* ============================================================
     ALTERNATE CHOREOGRAPHIES — random variety per matchup.
     CHOREO[key] is the primary (verified) duel; ALT[key] holds
     additional takes. pickChoreo() chooses one at random so a
     repeated matchup rarely plays the same way twice.
       P>P, P>N, N>P, B>P  →  3 total takes each
       every other matchup →  2 total takes each
     ============================================================ */
  const ALT = {

    /* ===== VIOLINIST attacks ===== */
    'P>P': [
      [ // the understudy's revenge
        ...approach('P'),
        st('A', 'taunt', 0.7, { say: 'Tune up — it’s over.' }),
        st('D', 'windup', 0.4),
        st('D', 'strike', 0.4, { dx: 4, fx: [fx(0.16, (S) => S.clash())], with: [st('A', 'block', 0.45, { delay: 0.1 })] }),
        st('A', 'dodge', 0.4, { dx: -3 }),
        st('A', 'special', 0.9, { say: 'Spiccato!', fx: [fx(0.1, (S) => S.tremolo('A', 6)), fx(0.12, (S) => S.au.bow(620, 0, 0.4, 0.7, 820))] }),
        HIT(0.5, -6),
        STRIKE('P'),
        DIE('P'),
        WIN('Sit down, understudy.'),
      ],
      [ // the bow-snap riposte
        ...approach('P'),
        st('D', 'taunt', 0.7, { say: 'Your vibrato wobbles.' }),
        st('A', 'windup', 0.5, { say: 'Listen close.' }),
        STRIKE('P', { lunge: 6, kb: -7 }),
        st('D', 'strike', 0.4, { dx: 4, fx: [fx(0.16, (S) => S.clash())], with: [st('A', 'dodge', 0.45, { delay: 0.06, dx: -4 })] }),
        st('A', 'special', 0.9, { fx: [fx(0.1, (S) => S.tremolo('A', 7))] }),
        HIT(0.5, -6),
        STRIKE('P', { say: 'Coda.' }),
        DIE('P'),
        WIN('First chair, second movement.'),
      ],
    ],

    'P>N': [
      [ // thread the C-string
        ...approach('P'),
        st('D', 'taunt', 0.7, { say: 'Mind the C-string.' }),
        st('A', 'windup', 0.45, { say: 'I’ll thread it.' }),
        st('A', 'special', 1.0, { fx: [fx(0.1, (S) => S.tremolo('A', 7)), fx(0.12, (S) => S.au.bow(560, 0, 0.45, 0.9, 760))] }),
        st('D', 'block', 0.5, { say: 'Behind the bridge!' }),
        st('A', 'dodge', 0.4, { dx: 6 }),
        STRIKE('P', { lunge: 6 }),
        DIE('N'),
        WIN('Agile beats heavy.'),
      ],
      [ // dodge the big bow
        ...approach('P'),
        st('A', 'windup', 0.5),
        STRIKE('P', { kb: -5 }),
        st('D', 'windup', 0.45, { say: 'Big bow incoming!' }),
        st('D', 'strike', 0.42, { dx: 3, fx: [fx(0.16, (S) => { S.au.bow(82, 0, 0.3, 0.6); S.fxl.dust(S.mid(), S.gy, 8); })], with: [st('A', 'dodge', 0.5, { delay: 0.06, dx: -6 })] }),
        st('A', 'special', 0.9, { say: 'Too slow.', fx: [fx(0.08, (S) => S.tremolo('A', 7))] }),
        HIT(0.55, -7),
        STRIKE('P'),
        DIE('N'),
        WIN('The cello sings soprano now.'),
      ],
    ],

    'P>B': [
      [
        ...approach('P'),
        st('A', 'windup', 0.45, { say: 'En garde, reed.' }),
        st('D', 'special', 0.5, { fx: [fx(0.1, (S) => S.dartFrom('D'))], with: [st('A', 'dodge', 0.5, { delay: 0.25, dx: -4 })] }),
        st('A', 'special', 0.9, { fx: [fx(0.08, (S) => S.tremolo('A', 7))] }),
        HIT(0.5, -6),
        STRIKE('P', { lunge: 6 }),
        DIE('B'),
        WIN('Strings, then silence.'),
      ],
    ],

    'P>R': [
      [
        ...approach('P'),
        st('D', 'taunt', 0.7, { say: 'Tickle the timpani?' }),
        st('A', 'windup', 0.5, { say: 'Crescendo.' }),
        st('A', 'special', 1.1, { fx: [fx(0.08, (S) => S.tremolo('A', 9)), fx(0.1, (S) => S.au.bow(523, 0, 0.5, 1.0, 1047))] }),
        st('D', 'hit', 0.6, { dx: -3 }),
        STRIKE('P', { impactAt: 0.18 }),
        DIE('R'),
        WIN('Even thunder needs a melody.'),
      ],
    ],

    'P>Q': [
      [
        ...approach('P'),
        st('A', 'windup', 0.45, { say: 'A minor inconvenience.' }),
        STRIKE('P', { lunge: 7, kb: -7 }),
        st('D', 'taunt', 0.7, { say: 'Charming.' }),
        st('D', 'strike', 0.45, { fx: [fx(0.16, (S) => { S.keyWave('D'); S.au.pianoChord([294, 370, 440], 0, 0.4, 0.5); })], with: [st('A', 'dodge', 0.5, { delay: 0.05, dx: -5 })] }),
        st('A', 'special', 1.0, { fx: [fx(0.08, (S) => S.tremolo('A', 8))] }),
        HIT(0.5, -7),
        STRIKE('P'),
        DIE('Q'),
        WIN('The soloist outplays the star.'),
      ],
    ],

    'P>K': [
      [
        ...approach('P'),
        st('D', 'taunt', 1.0, { say: 'A pawn? Truly?' }),
        st('A', 'windup', 0.55, { say: 'The smallest voice, the final word.' }),
        STRIKE('P', { lunge: 6, kb: -6 }),
        st('A', 'special', 1.1, { fx: [fx(0.08, (S) => S.tremolo('A', 8)), fx(0.1, (S) => S.au.bow(440, 0, 0.5, 1.0, 880))] }),
        HIT(0.6, -6),
        STRIKE('P', { lunge: 7 }),
        DIE('K'),
        FINALE('From the back row — checkmate.'),
      ],
    ],

    /* ===== CELLIST attacks ===== */
    'N>P': [
      [ // make way for the bass line
        ...approach('N'),
        st('A', 'taunt', 0.7, { say: 'Make way for the bass line.' }),
        st('D', 'windup', 0.4, { say: 'N-not the cello—' }),
        st('A', 'windup', 0.5),
        STRIKE('N', { kb: -9 }),
        st('A', 'special', 0.9, { dx: 6, fx: [fx(0.1, (S) => { S.au.whoosh(0, 0.45, 0.4); S.fxl.dust(S.px('A', 0), S.gy, 8); })], with: [st('D', 'hit', 0.5, { delay: 0.25, dx: -8 })] }),
        DIE('P'),
        WIN('Pizzicato, meet fortississimo.'),
      ],
      [ // the feint
        ...approach('N'),
        st('D', 'dodge', 0.5, { dx: 6, say: 'Missed me!' }),
        st('A', 'taunt', 0.6, { say: 'Did I?' }),
        st('A', 'windup', 0.5),
        st('A', 'strike', 0.45, { dx: 3, fx: [fx(0.18, (S) => IMPACT.N(S))], with: [st('D', 'hit', 0.6, { delay: 0.18, dx: -10 })] }),
        STRIKE('N'),
        DIE('P'),
        WIN('Stay in your register.'),
      ],
    ],

    'N>N': [
      [ // no joust, just a slam
        ...approach('N'),
        st('A', 'windup', 0.5, { say: 'No jousting. Just this.' }),
        STRIKE('N', { kb: -6 }),
        st('D', 'windup', 0.45),
        st('D', 'strike', 0.42, { fx: [fx(0.16, (S) => { S.au.timpani(0, 0.5, 60); S.fxl.dust(S.mid(), S.gy, 8); })], with: [st('A', 'block', 0.5, { delay: 0.06 })] }),
        st('A', 'special', 0.8, { dx: 8, fx: [fx(0.3, (S) => IMPACT.N(S))], with: [st('D', 'hit', 0.55, { delay: 0.3, dx: -9 })] }),
        DIE('N'),
        WIN('Two cellos, one chair.'),
      ],
    ],

    'N>B': [
      [
        ...approach('N'),
        st('D', 'special', 0.5, { fx: [fx(0.1, (S) => S.dartFrom('D'))], with: [st('A', 'block', 0.5, { delay: 0.22 })] }),
        st('A', 'taunt', 0.6, { say: 'Splinters.' }),
        st('A', 'windup', 0.5),
        STRIKE('N', { kb: -9 }),
        st('A', 'special', 0.8, { dx: 7, fx: [fx(0.25, (S) => IMPACT.N(S))], with: [st('D', 'hit', 0.5, { delay: 0.25, dx: -7 })] }),
        DIE('B'),
        WIN('Reeds break. Strings hold.'),
      ],
    ],

    'N>R': [
      [
        ...approach('N'),
        st('D', 'taunt', 0.7, { say: 'Charge if you dare.' }),
        st('A', 'ride', 0.55, { dx: 12, fx: [fx(0.05, (S) => S.au.whoosh(0, 0.4)), fx(0.3, (S) => S.au.timpani(0, 0.6, 60))], with: [st('D', 'block', 0.55, { delay: 0.1 })] }),
        st('A', 'windup', 0.5),
        st('A', 'special', 0.9, { dx: 9, fx: [fx(0.35, (S) => IMPACT.N(S))], with: [st('D', 'hit', 0.6, { delay: 0.35, dx: -8 })] }),
        DIE('R'),
        WIN('Outmaneuvered, big drum.'),
      ],
    ],

    'N>Q': [
      [
        ...approach('N'),
        st('D', 'taunt', 0.7, { say: 'Mind the lacquer.' }),
        st('A', 'ride', 0.5, { dx: 10, fx: [fx(0.05, (S) => S.au.whoosh(0, 0.4))], with: [st('D', 'dodge', 0.5, { delay: 0.1, dx: -4 })] }),
        st('A', 'windup', 0.5),
        STRIKE('N', { kb: -8 }),
        st('A', 'special', 0.8, { dx: 7, fx: [fx(0.28, (S) => IMPACT.N(S))], with: [st('D', 'hit', 0.5, { delay: 0.28, dx: -7 })] }),
        DIE('Q'),
        WIN('Bench cleared.'),
      ],
    ],

    'N>K': [
      [
        ...approach('N'),
        st('D', 'windup', 0.5, { say: 'You ride at ME?' }),
        st('A', 'ride', 0.6, { dx: 14, fx: [fx(0.05, (S) => S.au.whoosh(0, 0.45)), fx(0.3, (S) => S.clash())], with: [st('D', 'dodge', 0.55, { delay: 0.1 })] }),
        st('A', 'windup', 0.55),
        st('A', 'special', 0.9, { dx: 9, fx: [fx(0.35, (S) => IMPACT.N(S))], with: [st('D', 'hit', 0.6, { delay: 0.35, dx: -8 })] }),
        STRIKE('N'),
        DIE('K'),
        FINALE('The cavalry takes the podium.'),
      ],
    ],

    /* ===== CLARINETIST attacks ===== */
    'B>P': [
      [ // up close and personal
        ...approach('B'),
        st('A', 'taunt', 0.6, { say: 'Hold still, please.' }),
        st('A', 'windup', 0.45),
        STRIKE('B', { lunge: 5 }),
        st('A', 'special', 0.9, { fx: [fx(0.08, (S) => S.dart()), fx(0.32, (S) => S.dart())], with: [st('D', 'hit', 0.5, { delay: 0.35, dx: -5 })] }),
        STRIKE('B'),
        DIE('P'),
        WIN('Articulation is everything.'),
      ],
      [ // a flurry from range
        st('A', 'walk', 0.9, { gap: 50 }),
        st('D', 'taunt', 0.6, { say: 'You won’t hit me!' }),
        st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart())], with: [st('D', 'hit', 0.45, { delay: 0.3, dx: -4 })] }),
        st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart())], with: [st('D', 'hit', 0.45, { delay: 0.3, dx: -4 })] }),
        st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart())], with: [st('D', 'hit', 0.45, { delay: 0.3, dx: -5 })] }),
        DIE('P'),
        WIN('Three darts. Three rests.'),
      ],
    ],

    'B>N': [
      [
        ...approach('B'),
        st('D', 'ride', 0.5, { dx: 8, say: 'Yah!' }),
        st('A', 'dodge', 0.5, { dx: 6, say: 'Off-key.' }),
        st('A', 'special', 0.9, { fx: [fx(0.08, (S) => S.dart()), fx(0.32, (S) => S.dart()), fx(0.56, (S) => S.dart())], with: [st('D', 'hit', 0.5, { delay: 0.4, dx: -6 })] }),
        STRIKE('B'),
        DIE('N'),
        WIN('Pinned at speed.'),
      ],
    ],

    'B>B': [
      [
        ...approach('B'),
        st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart())], with: [st('D', 'block', 0.5, { delay: 0.25 })] }),
        st('D', 'special', 0.5, { fx: [fx(0.1, (S) => S.dartFrom('D'))], with: [st('A', 'dodge', 0.5, { delay: 0.25, dx: -4 })] }),
        st('A', 'windup', 0.45, { say: 'Higher.' }),
        st('A', 'special', 1.0, { fx: [fx(0.1, (S) => { S.au.squeak(0, 0.6); S.au.reed(2093, 0.1, 0.4, 0.5); })], with: [st('D', 'hit', 0.7, { delay: 0.2, dx: -6, say: 'AGH—' })] }),
        STRIKE('B'),
        DIE('B'),
        WIN('Out-registered.'),
      ],
    ],

    'B>R': [
      [
        ...approach('B'),
        st('A', 'dodge', 0.5, { dx: 8, say: 'Around the kit.' }),
        st('A', 'strike', 0.42, { dx: 3, fx: [fx(0.16, (S) => IMPACT.B(S))], with: [HIT(0.55, -3)] }),
        st('A', 'special', 0.7, { fx: [fx(0.08, (S) => S.dart()), fx(0.3, (S) => S.dart())], with: [st('D', 'hit', 0.5, { delay: 0.35, dx: -4 })] }),
        STRIKE('B'),
        DIE('R'),
        WIN('Finesse over fortissimo.'),
      ],
    ],

    'B>Q': [
      [
        ...approach('B'),
        st('A', 'windup', 0.45, { say: 'A pointed critique.' }),
        st('A', 'special', 0.9, { fx: [fx(0.08, (S) => S.dart()), fx(0.32, (S) => S.dart()), fx(0.56, (S) => S.dart())], with: [st('D', 'hit', 0.5, { delay: 0.35, dx: -5 })] }),
        st('D', 'strike', 0.45, { fx: [fx(0.16, (S) => { S.keyWave('D'); S.au.pianoChord([262, 330, 392], 0, 0.4, 0.5); })], with: [st('A', 'dodge', 0.5, { delay: 0.05, dx: -5 })] }),
        STRIKE('B', { lunge: 5 }),
        DIE('Q'),
        WIN('A sharp resolution.'),
      ],
    ],

    'B>K': [
      [
        ...approach('B'),
        st('A', 'special', 0.5, { fx: [fx(0.1, (S) => S.dart())], with: [st('D', 'block', 0.55, { delay: 0.25, say: 'Insolent reed.' })] }),
        st('A', 'walk', 0.6, { gap: 30 }),
        st('A', 'windup', 0.5, { say: 'The last cadence.' }),
        STRIKE('B', { lunge: 5 }),
        DIE('K'),
        FINALE('The woodwinds claim the crown.'),
      ],
    ],

    /* ===== PERCUSSIONIST attacks ===== */
    'R>P': [
      [
        ...approach('R'),
        st('D', 'taunt', 0.6, { say: 'You’re all noise!' }),
        st('A', 'windup', 0.6),
        st('A', 'strike', 0.45, { dx: 3, fx: [fx(0.18, (S) => { IMPACT.R(S); S.shockwave('A'); })], with: [st('D', 'hit', 0.6, { delay: 0.18, dx: -12 })] }),
        DIE('P'),
        WIN('All noise. All over.'),
      ],
    ],

    'R>N': [
      [
        ...approach('R'),
        st('D', 'ride', 0.5, { dx: 8, say: 'Trample him!' }),
        st('A', 'block', 0.5, {}),
        st('A', 'windup', 0.55),
        st('A', 'strike', 0.45, { dx: 3, fx: [fx(0.18, (S) => { IMPACT.R(S); S.shockwave('A'); })], with: [st('D', 'hit', 0.55, { delay: 0.18, dx: -10 })] }),
        DIE('N'),
        WIN('Dismounted.'),
      ],
    ],

    'R>B': [
      [
        ...approach('R'),
        st('D', 'special', 0.5, { fx: [fx(0.1, (S) => S.dartFrom('D'))], with: [st('A', 'hit', 0.45, { delay: 0.3, dx: -1 })] }),
        st('A', 'taunt', 0.6, { say: 'Tickles.' }),
        st('A', 'special', 0.55, { fx: [fx(0.2, (S) => { S.au.cymbal(0, 0.7, 1.1); S.fxl.ring(S.px('A', 8), S.gy - 70, 'rgba(255,220,120,0.9)', 8, 150, 0.5); })], with: [st('D', 'hit', 0.5, { delay: 0.22, dx: -6 })] }),
        st('A', 'strike', 0.45, { dx: 2, fx: [fx(0.18, (S) => { IMPACT.R(S); S.shockwave('A'); })], with: [st('D', 'hit', 0.6, { delay: 0.18, dx: -11 })] }),
        DIE('B'),
        WIN('Decibels: undefeated.'),
      ],
    ],

    'R>R': [
      [ // a tighter drum-off
        ...approach('R'),
        st('A', 'strike', 0.5, { fx: [fx(0.2, (S) => { S.au.timpani(0, 0.8, 65); S.fxl.shake(6, 0.3); })] }),
        st('D', 'strike', 0.5, { fx: [fx(0.2, (S) => { S.au.timpani(0, 0.85, 55); S.fxl.shake(8, 0.3); })], with: [st('A', 'block', 0.5, { delay: 0.1 })] }),
        st('A', 'windup', 0.6, { say: 'My turn for the solo.' }),
        st('A', 'special', 0.6, { fx: [fx(0.22, (S) => { S.au.cymbal(0, 0.8, 1.4); S.au.timpani(0.02, 0.9, 45); S.fxl.flash('rgba(255,240,180,0.5)'); S.fxl.shake(12, 0.5); S.shockwave('A'); })], with: [st('D', 'hit', 0.6, { delay: 0.25, dx: -11 })] }),
        DIE('R'),
        WIN('Last one standing keeps time.'),
      ],
    ],

    'R>Q': [
      [
        ...approach('R'),
        st('D', 'taunt', 0.7, { say: 'Barbarian.' }),
        st('A', 'windup', 0.6),
        st('A', 'strike', 0.45, { dx: 3, fx: [fx(0.18, (S) => { IMPACT.R(S); S.shockwave('A'); })], with: [st('D', 'hit', 0.6, { delay: 0.18, dx: -10 })] }),
        st('A', 'special', 0.55, { fx: [fx(0.2, (S) => { S.au.cymbal(0, 0.7, 1.1); S.fxl.flash('rgba(255,240,180,0.4)'); })], with: [st('D', 'hit', 0.5, { delay: 0.22, dx: -6 })] }),
        DIE('Q'),
        WIN('Grand piano, meet grand finale.'),
      ],
    ],

    'R>K': [
      [
        ...approach('R'),
        st('D', 'windup', 0.5, { say: 'You DARE keep time for ME?' }),
        st('D', 'strike', 0.45, { fx: [fx(0.16, (S) => { S.au.zap(0, 0.5); S.boltAt('D', 'A'); })], with: [st('A', 'hit', 0.45, { delay: 0.16, dx: -2 })] }),
        st('A', 'taunt', 0.7, { say: 'Downbeat’s mine now.' }),
        st('A', 'windup', 0.7),
        st('A', 'strike', 0.5, { dx: 3, fx: [fx(0.2, (S) => { IMPACT.R(S); S.shockwave('A'); S.fxl.flash('rgba(255,255,255,0.35)'); })], with: [st('D', 'hit', 0.6, { delay: 0.2, dx: -10 })] }),
        DIE('K'),
        FINALE('The percussion section takes the podium.'),
      ],
    ],

    /* ===== PIANIST attacks ===== */
    'Q>P': [
      [
        ...approach('Q'),
        st('D', 'windup', 0.4, { say: 'I’ll strike first!' }),
        st('D', 'strike', 0.4, { dx: 4, fx: [fx(0.16, (S) => S.au.whoosh(0, 0.3))], with: [st('A', 'dodge', 0.5, { delay: 0.06, dx: -4 })] }),
        st('A', 'taunt', 0.6, { say: 'My turn at the keys.' }),
        st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.Q(S); S.keyWave('A'); })], with: [HIT(0.5, -7)] }),
        st('A', 'special', 1.0, { fx: [fx(0.15, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.62, dx: -3 })] }),
        DIE('P', 0.2),
        WIN('A flat for the violinist.'),
      ],
    ],

    'Q>N': [
      [
        ...approach('Q'),
        st('A', 'taunt', 0.7, { say: 'Sit. Stay.' }),
        st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.Q(S); S.keyWave('A'); })], with: [HIT(0.5, -8)] }),
        st('A', 'windup', 0.6, { say: 'And… fortissimo.' }),
        st('A', 'special', 1.0, { fx: [fx(0.15, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.62, dx: -3 })] }),
        DIE('N', 0.2),
        WIN('Cello? Kindling.'),
      ],
    ],

    'Q>B': [
      [
        ...approach('Q'),
        st('D', 'special', 0.5, { fx: [fx(0.1, (S) => S.dartFrom('D'))], with: [st('A', 'dodge', 0.5, { delay: 0.25, dx: -4 })] }),
        st('A', 'taunt', 0.6, { say: 'Out of tune.' }),
        st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.Q(S); S.keyWave('A'); })], with: [HIT(0.5, -7)] }),
        st('A', 'special', 1.0, { fx: [fx(0.15, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.62, dx: -3 })] }),
        DIE('B', 0.2),
        WIN('Properly flat.'),
      ],
    ],

    'Q>R': [
      [
        ...approach('Q'),
        st('D', 'strike', 0.45, { say: 'BOOM.', fx: [fx(0.18, (S) => { S.au.timpani(0, 0.7, 60); S.shockwave('D'); })], with: [st('A', 'block', 0.5, { delay: 0.1 })] }),
        st('A', 'taunt', 0.6, { say: 'Tuned, dear.' }),
        st('A', 'windup', 0.6),
        st('A', 'special', 1.0, { fx: [fx(0.15, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.62, dx: -3 })] }),
        DIE('R', 0.2),
        WIN('Percussion, retuned. Permanently.'),
      ],
    ],

    'Q>Q': [
      [
        ...approach('Q'),
        st('D', 'strike', 0.45, { say: 'My cadenza!', fx: [fx(0.16, (S) => { S.au.pianoChord([262, 330, 392], 0, 0.5, 0.6); S.keyWave('D'); })], with: [st('A', 'dodge', 0.5, { delay: 0.08, dx: -4 })] }),
        st('A', 'taunt', 0.7, { say: 'Mine’s longer.' }),
        st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.Q(S); S.keyWave('A'); })], with: [HIT(0.5, -7)] }),
        st('A', 'windup', 0.7, { say: 'Lid.' }),
        st('A', 'special', 1.0, { fx: [fx(0.15, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.62, dx: -3 })] }),
        DIE('Q', 0.2),
        WIN('Solo recital.'),
      ],
    ],

    'Q>K': [
      [
        ...approach('Q'),
        st('D', 'taunt', 0.9, { say: 'I conduct. You accompany.' }),
        st('A', 'taunt', 0.8, { say: 'Not anymore.' }),
        st('A', 'windup', 0.8),
        st('A', 'special', 1.2, { fx: [fx(0.2, (S) => S.summonPiano())], with: [st('D', 'hit', 0.6, { delay: 0.7, dx: -3 })] }),
        DIE('K', 0.2),
        FINALE('The grand piano has the last word.'),
      ],
    ],

    /* ===== CONDUCTOR attacks ===== */
    'K>P': [
      [
        ...approach('K'),
        st('D', 'taunt', 0.6, { say: 'You wouldn’t dare!' }),
        st('A', 'taunt', 0.8, { say: 'Off the roster.' }),
        st('A', 'windup', 0.5),
        st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.K(S); S.boltAt('A', 'D'); })], with: [HIT(0.55, -8)] }),
        DIE('P'),
        WIN('Next.'),
      ],
    ],

    'K>N': [
      [
        ...approach('K'),
        st('D', 'ride', 0.5, { dx: 8, say: 'Charge!' }),
        st('A', 'windup', 0.5),
        st('A', 'strike', 0.45, { say: 'HALT.', fx: [fx(0.14, (S) => { IMPACT.K(S); S.boltAt('A', 'D'); })], with: [st('D', 'hit', 0.55, { delay: 0.14, dx: -9 })] }),
        DIE('N'),
        WIN('Rein it in.'),
      ],
    ],

    'K>B': [
      [
        ...approach('K'),
        st('A', 'taunt', 0.7, { say: 'You missed your cue.' }),
        st('D', 'special', 0.5, { fx: [fx(0.1, (S) => S.dartFrom('D'))], with: [st('A', 'dodge', 0.5, { delay: 0.25, dx: -4 })] }),
        st('A', 'windup', 0.5),
        st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.K(S); S.boltAt('A', 'D'); })], with: [HIT(0.55, -7)] }),
        DIE('B'),
        WIN('Watch. The. Baton.'),
      ],
    ],

    'K>R': [
      [
        ...approach('K'),
        st('D', 'strike', 0.5, { fx: [fx(0.2, (S) => { S.au.timpani(0, 0.7, 60); S.shockwave('D'); })], with: [st('A', 'dodge', 0.55, { delay: 0.06, dx: -5 })] }),
        st('A', 'taunt', 0.7, { say: 'Forte is no substitute for talent.' }),
        st('A', 'windup', 0.6),
        st('A', 'special', 0.9, { say: 'TUTTI!', fx: [fx(0.2, (S) => { S.au.brass(131, 0, 0.55, 0.7); S.au.zap(0.1, 0.5); S.boltAt('A', 'D'); S.fxl.shake(7, 0.3); })], with: [st('D', 'hit', 0.6, { delay: 0.25, dx: -8 })] }),
        DIE('R'),
        WIN('Silence in the battery.'),
      ],
    ],

    'K>Q': [
      [
        ...approach('K'),
        st('D', 'taunt', 0.8, { say: 'I answer to no one.' }),
        st('A', 'taunt', 0.7, { say: 'You’ll answer to the downbeat.' }),
        st('A', 'windup', 0.55),
        st('A', 'strike', 0.45, { fx: [fx(0.16, (S) => { IMPACT.K(S); S.boltAt('A', 'D'); })], with: [HIT(0.55, -7)] }),
        st('A', 'special', 0.8, { fx: [fx(0.2, (S) => { S.au.brass(147, 0, 0.5, 0.6); S.fxl.ring(S.px('A', 6), S.gy - 90, 'rgba(255,235,150,0.85)', 10, 170, 0.55); })], with: [st('D', 'hit', 0.5, { delay: 0.25, dx: -5 })] }),
        DIE('Q'),
        WIN('Tacet. For good.'),
      ],
    ],

    'K>K': [
      [
        ...approach('K'),
        st('D', 'taunt', 0.8, { say: 'Two maestros. One baton.' }),
        st('A', 'taunt', 0.8, { say: 'And it’s mine.' }),
        st('D', 'strike', 0.45, { fx: [fx(0.16, (S) => { S.au.zap(0, 0.5); S.boltAt('D', 'A'); })], with: [st('A', 'block', 0.5, { delay: 0.1 })] }),
        st('A', 'windup', 0.6),
        st('A', 'special', 0.9, { fx: [fx(0.2, (S) => { S.au.brass(131, 0, 0.55, 0.7); S.boltAt('A', 'D'); S.fxl.shake(8, 0.35); })], with: [st('D', 'hit', 0.6, { delay: 0.25, dx: -8 })] }),
        DIE('K'),
        FINALE('One podium. One maestro.'),
      ],
    ],
  };

  /* ============================================================
     SPECIAL SCENES — non-duel set pieces.
     ============================================================ */

  /* ---- En passant: the victim caught marching past ---- */
  const EN_PASSANT = [
    [
      ...approach('P'),
      st('D', 'walk', 0.8, { dx: 16, say: 'Just passing through!' }),
      st('A', 'windup', 0.4, { say: 'Not so fast.' }),
      STRIKE('P', { lunge: 6, kb: -8 }),
      st('A', 'special', 0.8, { fx: [fx(0.08, (S) => S.tremolo('A', 6))] }),
      HIT(0.5, -6),
      STRIKE('P'),
      DIE('P'),
      WIN('Caught in passing.'),
    ],
    [
      ...approach('P'),
      st('D', 'taunt', 0.7, { say: 'Two squares — can’t touch me!' }),
      st('D', 'walk', 0.7, { dx: 14 }),
      st('A', 'dodge', 0.4, { dx: 6, say: 'En passant.' }),
      STRIKE('P', { lunge: 6, kb: -7 }),
      HIT(0.5, -6),
      STRIKE('P', { say: 'In passing.' }),
      DIE('P'),
      WIN('The rules favor the watchful.'),
    ],
  ];

  /* ---- Castling: conductor & percussionist high-five mid-cross ---- */
  const CASTLE = [
    [
      st('A', 'walk', 0.9, { dx: 40, with: [st('D', 'walk', 0.9, { dx: 40 })] }),
      st('A', 'cheer', 0.7, { say: 'Castle!', fx: [fx(0.1, (S) => { S.au.castle(); S.fxl.sparks(S.mid(), S.gy - 72, 12); S.fxl.notes(S.mid(), S.gy - 95, 8, S.noteCol('A')); })], with: [st('D', 'cheer', 0.7, {})] }),
      st('A', 'walk', 0.8, { dx: 22, with: [st('D', 'walk', 0.8, { dx: 22 })] }),
      st('A', 'win', 1.5, { say: 'Safe and sound.', sayAt: 0.4, fx: [fx(0.1, (S) => { S.au.fanfareWin(); S.fxl.confetti(S.mid(), S.gy - 180, 26); })], with: [st('D', 'taunt', 1.5, {})] }),
    ],
    [
      st('A', 'walk', 1.0, { dx: 38, with: [st('D', 'walk', 1.0, { dx: 38 })] }),
      st('A', 'taunt', 0.6, { say: 'Maestro!', with: [st('D', 'taunt', 0.6, { say: 'Section leader!' })] }),
      st('A', 'cheer', 0.8, { fx: [fx(0.1, (S) => { S.au.castle(); S.au.cymbal(0.1, 0.4, 0.9); S.fxl.sparks(S.mid(), S.gy - 74, 14); S.fxl.ring(S.mid(), S.gy - 60, 'rgba(255,235,150,0.85)', 8, 150, 0.5); })], with: [st('D', 'cheer', 0.8, {})] }),
      st('A', 'walk', 0.9, { dx: 26, with: [st('D', 'walk', 0.9, { dx: 26 })] }),
      st('A', 'win', 1.6, { say: 'The fortress holds.', sayAt: 0.4, fx: [fx(0.1, (S) => { S.au.fanfareWin(); S.fxl.confetti(S.mid(), S.gy - 190, 28); })], with: [st('D', 'win', 1.6, {})] }),
    ],
  ];

  /* ---- A Star Is Born: a violinist promoted into a new chair ---- */
  const STAR_LINE = { w: 'For Ivory — my moment!', b: 'For Obsidian — my moment!' };
  const STAR_FINISH = {
    Q: [
      st('A', 'special', 1.0, { say: 'A virtuoso takes the stage.', fx: [fx(0.1, (S) => { S.keyWave('A'); S.au.pianoChord([262, 330, 392, 523], 0, 0.5, 0.8, 0.04); }), fx(0.5, (S) => S.fxl.notes(S.A.x, S.gy - 100, 8, S.noteCol('A')))] }),
      st('A', 'win', 1.6, { fx: [fx(0.1, (S) => { S.au.fanfareWin(); S.fxl.confetti(S.A.x, S.gy - 190, 28); })] }),
    ],
    R: [
      st('A', 'special', 0.9, { say: 'The battery gains a soldier.', fx: [fx(0.2, (S) => { S.au.cymbal(0, 0.8, 1.3); S.shockwave('A'); S.fxl.flash('rgba(255,240,180,0.4)'); })] }),
      st('A', 'win', 1.6, { fx: [fx(0.1, (S) => { S.au.fanfareWin(); S.fxl.confetti(S.A.x, S.gy - 190, 28); })] }),
    ],
    B: [
      st('A', 'special', 0.9, { say: 'A new voice in the reeds.', fx: [fx(0.1, (S) => S.dart()), fx(0.34, (S) => S.dart()), fx(0.58, (S) => S.dart())] }),
      st('A', 'win', 1.6, { fx: [fx(0.1, (S) => { S.au.fanfareWin(); S.fxl.confetti(S.A.x, S.gy - 190, 28); })] }),
    ],
    N: [
      st('A', 'ride', 0.9, { say: 'Mount up — a knight is made.', fx: [fx(0.1, (S) => { S.au.whoosh(0, 0.45, 0.5); S.au.bow(98, 0.1, 0.4, 0.7, 196); }), fx(0.3, (S) => S.fxl.dust(S.A.x, S.gy, 8))] }),
      st('A', 'win', 1.6, { fx: [fx(0.1, (S) => { S.au.fanfareWin(); S.fxl.confetti(S.A.x, S.gy - 190, 28); })] }),
    ],
  };
  function starSteps(promo, color) {
    const morph = st('A', 'win', 0.6, {
      fx: [
        fx(0.0, (S) => S.au.whoosh(0, 0.4, 0.4)),
        fx(0.15, (S) => { S.fxl.flash('rgba(255,255,255,0.9)'); S.au.promote(); S.fxl.stars(S.A.x, S.gy - 50, 28, '#ffe9a8'); S.fxl.ring(S.A.x, S.gy - 40, 'rgba(255,217,138,0.9)', 8, 160, 0.6); }),
        fx(0.22, (S) => { S.A.type = promo; }),
      ],
    });
    return [
      st('A', 'walk', 0.9, { dx: 30 }),
      st('A', 'taunt', 0.7, { say: STAR_LINE[color] || 'My moment has come.' }),
      st('A', 'windup', 0.6),
      st('A', 'special', 1.0, { fx: [fx(0.08, (S) => S.tremolo('A', 7)), fx(0.1, (S) => S.au.bow(523, 0, 0.5, 1.0, 1047))] }),
      morph,
    ].concat(STAR_FINISH[promo] || STAR_FINISH.Q);
  }

  /* ---- Stalemate / Draw: the two maestros meet, honors even ---- */
  const STALEMATE = [
    [
      st('A', 'walk', 0.9, { dx: 28, with: [st('D', 'walk', 0.9, { dx: 28 })] }),
      st('A', 'windup', 0.5, { say: 'Your move.', with: [st('D', 'windup', 0.5, { say: 'No — yours.' })] }),
      st('A', 'idle', 1.4, { say: '…', sayAt: 0.5, fx: [fx(0.2, (S) => { S.au.reed(392, 0, 0.3, 0.6); S.au.reed(370, 0.4, 0.3, 0.8); })], with: [st('D', 'idle', 1.4, {})] }),
      st('A', 'taunt', 1.2, { say: 'A stalemate.', sayAt: 0.2, with: [st('D', 'taunt', 1.2, {})] }),
    ],
    [
      st('A', 'walk', 1.0, { dx: 30, with: [st('D', 'walk', 1.0, { dx: 30 })] }),
      st('A', 'windup', 0.6, { with: [st('D', 'windup', 0.6, {})] }),
      st('A', 'strike', 0.5, { fx: [fx(0.16, (S) => { S.clash(); S.fxl.flash('rgba(200,200,255,0.25)'); })], with: [st('D', 'strike', 0.5, {})] }),
      st('A', 'idle', 1.4, { say: 'Neither can move.', sayAt: 0.3, fx: [fx(0.2, (S) => S.au.drawCue())], with: [st('D', 'idle', 1.4, {})] }),
    ],
  ];
  const DRAW = [
    [
      st('A', 'walk', 0.9, { dx: 30, with: [st('D', 'walk', 0.9, { dx: 30 })] }),
      st('A', 'taunt', 0.8, { say: 'A truce, then.', with: [st('D', 'taunt', 0.8, { say: 'Honors even.' })] }),
      st('A', 'win', 1.6, { fx: [fx(0.2, (S) => { S.fxl.notes(S.mid(), S.gy - 80, 6, '#f3e7c9'); S.au.applause(0.2, 0.35, 2.6); })], with: [st('D', 'win', 1.6, {})] }),
    ],
    [
      st('A', 'walk', 1.0, { dx: 32, with: [st('D', 'walk', 1.0, { dx: 32 })] }),
      st('A', 'idle', 0.6, { say: 'Well played.', with: [st('D', 'idle', 0.6, { say: 'And you.' })] }),
      st('A', 'win', 1.8, { fx: [fx(0.1, (S) => { S.au.bow(196, 0, 0.3, 0.6); S.au.applause(0.3, 0.3, 2.8); S.fxl.flash('rgba(120,80,140,0.2)'); })], with: [st('D', 'win', 1.8, {})] }),
    ],
  ];

  /* ---------- variant pickers ---------- */
  function allSeqs(key) {
    const prim = CHOREO[key];
    if (!prim) return [];
    return [prim, ...(ALT[key] || [])];
  }
  function pickChoreo(key, idx) {
    const all = allSeqs(key);
    if (!all.length) return null;
    if (idx != null) return all[idx % all.length];
    return all[(Math.random() * all.length) | 0];
  }
  function pickFrom(pool, idx) {
    if (idx != null) return pool[idx % pool.length];
    return pool[(Math.random() * pool.length) | 0];
  }

  /* ============================================================
     BATTLE SCENE
     ============================================================ */
  class BattleScene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.fxl = new MG.FXLayer();
      this.au = MG.Audio;
      this.active = false;
    }

    /* shared bootstrap for every full-screen scene */
    _setupScene(opts) {
      const dpr = MG.dpr || 1;
      const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
      this.W = W; this.H = H;
      this.u = Math.min(W, H * 1.45) / 230;       // pixels per art unit
      this.gy = H * 0.78;
      this.opts = opts;
      this.onDone = opts.onDone || (() => {});
      this.baseSpeed = opts.speed || 1;
      this.skipMult = 1;
      this.tNow = 0;
      this.doneFired = false;
      this.fading = null;
      this.fadeIn = 0.35;
      this.fxl.clear();
    }

    /* attacker/defender: {t, c}; opts: {checkmate, enpassant, altIndex, onDone, speed} */
    start(attacker, defender, opts = {}) {
      this._setupScene(opts);
      this.dir = attacker.c === 'w' ? 1 : -1;     // ivory enters stage left
      const mid = this.W / 2;
      this.A = this.mkActor(attacker, mid - this.dir * (this.W / 2 + 60), this.dir);
      this.D = this.mkActor(defender, mid + this.dir * 25 * this.u, -this.dir);

      let steps;
      if (opts.enpassant) {
        steps = pickFrom(EN_PASSANT, opts.altIndex);
        this.banner = 'EN PASSANT — ' + `${NAMES[attacker.t]} vs ${NAMES[defender.t]}`;
      } else {
        const key = attacker.t + '>' + defender.t;
        steps = pickChoreo(key, opts.altIndex) ||
          [...approach(attacker.t), st('A', 'windup', 0.5), STRIKE(attacker.t), DIE(defender.t), WIN()];
        this.banner = (opts.checkmate ? 'CHECKMATE — ' : '') +
          `${NAMES[attacker.t]} vs ${NAMES[defender.t]}`;
      }
      this.compile(steps);
      this.active = true;
      this.au.capturePrelude();
    }

    /* castling celebration: the Conductor and Percussionist cross and high-five.
       side is 'K'/'Q' (kept for flavor); both actors share the mover's color. */
    startCastle(color, side, opts = {}) {
      this._setupScene(opts);
      this.opts.noVanish = true;
      this.dir = 1;
      const mid = this.W / 2;
      this.A = this.mkActor({ t: 'K', c: color }, mid - 60 * this.u, 1);
      this.D = this.mkActor({ t: 'R', c: color }, mid + 60 * this.u, -1);
      this.banner = (color === 'w' ? 'Ivory' : 'Obsidian') + ' Castles — A Grand Maneuver';
      this.compile(pickFrom(CASTLE, opts.altIndex));
      this.active = true;
      this.au.castle();
    }

    /* "A Star Is Born": a promoted Violinist transforms into its new chair. */
    startStar(color, promo, opts = {}) {
      this._setupScene(opts);
      this.opts.noVanish = true;
      this.dir = color === 'w' ? 1 : -1;
      const mid = this.W / 2;
      this.A = this.mkActor({ t: 'P', c: color }, mid - this.dir * 30 * this.u, this.dir);
      this.D = this.mkActor({ t: 'P', c: color }, -9999, -this.dir);
      this.D.hidden = true;
      this.banner = 'A Star Is Born — ' + NAMES.P + ' → ' + NAMES[promo];
      this.compile(starSteps(promo, color));
      this.active = true;
      this.au.capturePrelude();
    }

    /* stalemate / draw tableau: the two maestros, no victor. kind: 'stalemate'|'draw' */
    startEnd(kind, opts = {}) {
      this._setupScene(opts);
      this.opts.noVanish = true;
      this.opts.endPad = 1.6;
      this.dir = 1;
      const mid = this.W / 2;
      this.A = this.mkActor({ t: 'K', c: 'w' }, mid - 60 * this.u, 1);
      this.D = this.mkActor({ t: 'K', c: 'b' }, mid + 60 * this.u, -1);
      this.banner = kind === 'stalemate' ? 'Stalemate — A Frozen Score' : 'A Draw — Honors Even';
      this.compile(pickFrom(kind === 'stalemate' ? STALEMATE : DRAW, opts.altIndex));
      this.active = true;
      this.au.drawCue();
    }

    mkActor(piece, x, facing) {
      return {
        type: piece.t, color: piece.c, x, facing,
        action: 'idle', t0: 0, dur: 1, alpha: 1,
        tween: null, stepClock: 0,
      };
    }

    actor(who) { return who === 'A' ? this.A : this.D; }
    other(who) { return who === 'A' ? this.D : this.A; }
    mid() { return (this.A.x + this.D.x) / 2; }
    px(who, ux, uy = 0) { const a = this.actor(who); return a.x + ux * this.u * a.facing; }
    py(uy) { return this.gy + uy * this.u; }
    noteCol(who) { return this.actor(who).color === 'w' ? '#ffd98a' : '#cdb8ff'; }
    later(delay, fn) {
      // insert keeping order, never disturbing indices below evIdx (a full
      // re-sort mid-playback can shift already-fired events past the cursor)
      const ev = { t: this.tNow + delay, fn };
      let i = this.events.length;
      while (i > this.evIdx && this.events[i - 1].t > ev.t) i--;
      this.events.splice(i, 0, ev);
    }
    fxlShakeLate(S, d, amp) { fxlShakeLate(this, d, amp); }

    /* ---------- choreography compiler ---------- */
    compile(steps) {
      this.events = [];
      let t = 0.25; // small beat before the action starts
      const add = (time, fn) => this.events.push({ t: time, fn });

      const sched = (step, t0) => {
        add(t0, () => {
          const a = this.actor(step.who);
          a.action = step.act;
          a.t0 = this.tNow;
          a.dur = Math.max(0.05, step.dur);
          if (step.gap != null) {
            const enemy = this.other(step.who);
            const target = enemy.x - this.dirOf(step.who) * step.gap * this.u;
            a.tween = { x0: a.x, x1: target, t0: this.tNow, t1: this.tNow + step.dur, arc: 0, heavy: step.heavy };
          } else if (step.dx) {
            const target = a.x + this.dirOf(step.who) * step.dx * this.u;
            a.tween = { x0: a.x, x1: target, t0: this.tNow, t1: this.tNow + Math.min(step.dur, 0.45), arc: step.arc || 0 };
          }
        });
        if (step.say) add(t0 + (step.sayAt ?? 0.08), () => {
          const a = this.actor(step.who);
          this.fxl.popup(a.x, this.gy - 54 * this.u, step.say, '#f3e7c9', 21, 1.3);
        });
        (step.fx || []).forEach((f) => add(t0 + f.at, () => f.run(this)));
        (step.with || []).forEach((w) => sched(w, t0 + (w.delay || 0)));
        return step.dur;
      };

      for (const s of steps) t += sched(s, t);

      if (!this.opts.noVanish) {
        add(t + 0.3, () => { // fade the fallen out with stardust
          const d = this.D;
          this.fxl.stars(d.x, this.gy - 40, 14, '#fff3c2');
          this.au.pluck(880, 0, 0.2, 0.4);
          d.fadeOut = this.tNow;
        });
      }
      // checkmate finales hold the closed curtain + applause before fading;
      // tableaux (stalemate/draw) get a shorter hold via opts.endPad
      const pad = this.opts.checkmate ? 2.0 : (this.opts.endPad || 0);
      const fadeAt = t + 0.9 + pad;
      // anchor the fade to its scheduled time (not the drifted tNow) so the
      // screen is guaranteed fully black before onDone fires
      add(fadeAt, () => { this.fading = fadeAt; });
      add(fadeAt + 0.7, () => { if (!this.doneFired) { this.doneFired = true; this.active = false; this.onDone(); } });
      this.events.sort((a, b) => a.t - b.t);
      this.evIdx = 0;
    }

    dirOf(who) { return who === 'A' ? this.dir : -this.dir; }

    /* window resized mid-battle: rescale the stage and actor positions */
    relayout() {
      if (!this.active) return;
      const dpr = MG.dpr || 1;
      const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
      if (W === this.W && H === this.H) return;
      const fx = W / this.W;
      this.W = W; this.H = H;
      this.u = Math.min(W, H * 1.45) / 230;
      this.gy = H * 0.78;
      for (const a of [this.A, this.D]) {
        a.x *= fx;
        if (a.tween) { a.tween.x0 *= fx; a.tween.x1 *= fx; }
      }
    }

    skip() { this.skipMult = 7; }

    /* ---------- scene-level FX helpers used by choreography ---------- */
    clash() {
      this.au.stringStab(740, 0, 0.35);
      this.au.block(0, 0.4, 1500);
      this.fxl.sparks(this.mid(), this.gy - 75, 10);
    }
    tremolo(who, n) {
      const a = this.actor(who), e = this.other(who);
      for (let i = 0; i < n; i++) {
        this.later(i * 0.09, () => {
          this.fxl.noteShot(a.x + a.facing * 10 * this.u, this.gy - 95, e.x, this.gy - 70, this.noteCol(who), 520, 13);
          this.au.pluck(523 + Math.random() * 400, 0, 0.18, 0.12);
        });
      }
    }
    dart() { this.dartFrom('A'); }
    dartFrom(who) {
      const a = this.actor(who), e = this.other(who);
      this.fxl.noteShot(a.x + a.facing * 12 * this.u, this.gy - 90, e.x, this.gy - 65, this.noteCol(who), 600, 11);
      this.au.reed(988 + Math.random() * 300, 0, 0.3, 0.12);
    }
    keyWave(who) {
      const a = this.actor(who);
      this.fxl.ring(a.x + a.facing * 8 * this.u, this.gy - 60, 'rgba(244,239,226,0.9)', 6, 120, 0.4);
      this.fxl.notes(a.x + a.facing * 12 * this.u, this.gy - 70, 4, this.noteCol(who), { vx: a.facing * 120, vy: -40, g: 30 });
    }
    shockwave(who) {
      const a = this.actor(who);
      this.fxl.ring(a.x + a.facing * 6 * this.u, this.gy - 8, 'rgba(255,200,120,0.85)', 10, 200, 0.5, 6);
      this.fxl.dust(a.x + a.facing * 10 * this.u, this.gy, 12);
    }
    boltAt(who, targetWho) {
      const a = this.actor(who), e = this.actor(targetWho);
      this.fxl.lightning(a.x + a.facing * 9 * this.u, this.gy - 110, e.x, this.gy - 70);
      this.fxl.sparks(e.x, this.gy - 70, 8, '#fff8c8');
    }
    summonPiano() {
      const e = this.D;
      this.au.whoosh(0, 0.45, 0.55);
      this.fxl.pianoDrop(e.x, this.gy - 4, 0.55);
      this.later(0.55, () => {
        this.au.cluster(0, 0.7);
        this.au.thud(0.02, 0.9);
        this.au.timpani(0.04, 0.8, 45);
        this.fxl.shake(13, 0.5);
        this.fxl.flash('rgba(255,255,255,0.4)');
        this.fxl.dust(e.x, this.gy, 16);
      });
    }
    curtainCall() { this.grandFinale(); }

    /* the elaborate checkmate send-off — one of three takes at random */
    grandFinale() {
      const v = (Math.random() * 3) | 0;
      this.later(0.5, () => {
        this.fxl.confetti(this.A.x, this.gy - 200, 30);
        this.au.applause(0.3, 0.5, 4.4);
      });
      if (v === 0) {                         // classic curtain drop + crash
        this.later(0.7, () => { this.fxl.curtain(1.7, 9); this.au.cymbal(0, 0.4, 1.2); });
      } else if (v === 1) {                  // a rain of bouquet notes, late curtain
        for (let i = 0; i < 6; i++) this.later(0.4 + i * 0.16, () => {
          this.fxl.notes(this.A.x + (Math.random() * 2 - 1) * 70, this.gy - 220, 5, this.noteCol('A'));
        });
        this.au.brass(262, 0.1, 0.4, 0.6); this.au.brass(392, 0.3, 0.45, 0.7);
        this.later(1.5, () => this.fxl.curtain(1.6, 8));
      } else {                               // spotlight bow, slow curtain
        this.later(0.2, () => this.fxl.flash('rgba(255,236,180,0.3)'));
        this.later(0.5, () => this.fxl.ring(this.A.x, this.gy - 60, 'rgba(255,235,150,0.8)', 8, 200, 0.7));
        this.later(1.1, () => this.fxl.curtain(2.0, 8));
      }
    }
    strikeFX(T) { // default melee impact visual per attacker type
      const e = this.D;
      if (T === 'P') this.fxl.sparks(e.x - this.dir * 4 * this.u, this.gy - 70, 8);
      if (T === 'N') { this.fxl.dust(e.x, this.gy, 10); this.fxl.sparks(e.x, this.gy - 50, 6); }
      if (T === 'B') this.fxl.sparks(e.x - this.dir * 3 * this.u, this.gy - 75, 6, '#bfe6ff');
      if (T === 'R') this.shockwave('A');
      if (T === 'Q') this.keyWave('A');
      if (T === 'K') this.boltAt('A', 'D');
    }

    /* ---------- update / draw ---------- */
    update(dt) {
      if (!this.active) return;
      const step = dt * this.baseSpeed * this.skipMult;
      this.tNow += step;
      while (this.evIdx < this.events.length && this.events[this.evIdx].t <= this.tNow) {
        this.events[this.evIdx].fn();
        this.evIdx++;
      }
      // tweens + walking footsteps
      for (const a of [this.A, this.D]) {
        if (a.tween) {
          const tw = a.tween;
          const u = Math.min(1, (this.tNow - tw.t0) / Math.max(0.01, tw.t1 - tw.t0));
          a.x = tw.x0 + (tw.x1 - tw.x0) * u;
          if (a.action === 'walk' || a.action === 'ride') {
            a.stepClock += step;
            const period = tw.heavy ? 0.42 : 0.24;
            if (a.stepClock > period) {
              a.stepClock = 0;
              if (tw.heavy) { this.au.timpani(0, 0.25, 90); this.fxl.shake(2.5, 0.12); this.fxl.dust(a.x, this.gy, 3); }
              else if (a.action === 'walk') this.au.footstep((Math.random() * 2) | 0);
            }
          }
          if (u >= 1) a.tween = null;
        }
      }
      this.fxl.update(step);
      this.fadeIn = Math.max(0, this.fadeIn - dt);
    }

    actorPose(a) {
      const t = this.tNow - a.t0;
      const k = LOOPED.has(a.action) ? 0 : Math.min(1, t / a.dur);
      return { k, t };
    }

    draw() {
      const ctx = this.ctx, W = this.W, H = this.H;
      const dpr = MG.dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.doneFired || !this.active) { // hold full black until handoff
        ctx.fillStyle = '#050208';
        ctx.fillRect(0, 0, W, H);
        return;
      }
      const [sx, sy] = this.fxl.shakeOffset();
      ctx.save();
      ctx.translate(sx, sy);
      this.drawStage(ctx, W, H);

      // actors (dying one drawn first so victor overlaps)
      const order = this.D.fadeOut != null || this.D.action === 'die' || this.D.action === 'dead'
        ? [this.D, this.A] : [this.A, this.D];
      for (const a of order) {
        if (a.hidden) continue;
        const { k, t } = this.actorPose(a);
        let alpha = 1;
        if (a.fadeOut != null) alpha = Math.max(0, 1 - (this.tNow - a.fadeOut) / 0.8);
        if (alpha <= 0) continue;
        const airGuess = 0;
        MG.Sprites.shadow(ctx, a.x, this.gy + 4, this.u / 2.4, airGuess);
        MG.Sprites.render(ctx, a.type, a.color, a.action, k, t, a.x, this.gy, this.u, a.facing < 0, { alpha });
      }

      this.fxl.draw(ctx);
      ctx.restore();
      this.fxl.drawFlash(ctx);

      // banner — width is fluid: it hugs the text but never overflows a narrow
      // (mobile) viewport, shrinking the font a notch if the title is still too wide.
      ctx.save();
      ctx.textAlign = 'center';
      let fs = Math.max(13, Math.min(W * 0.026, 22));
      ctx.font = `bold ${fs}px Georgia, serif`;
      const maxBw = W - 24;
      let tw = ctx.measureText(this.banner).width;
      if (tw + 36 > maxBw) {
        fs = Math.max(11, fs * (maxBw - 36) / tw);
        ctx.font = `bold ${fs}px Georgia, serif`;
        tw = ctx.measureText(this.banner).width;
      }
      const bw = Math.min(maxBw, tw + 36);
      const bh = fs + 18, bx = W / 2 - bw / 2;
      ctx.fillStyle = 'rgba(10,5,14,0.55)';
      ctx.fillRect(bx, 12, bw, bh);
      ctx.strokeStyle = '#a87f33';
      ctx.strokeRect(bx, 12, bw, bh);
      ctx.fillStyle = '#e8b54a';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.banner, W / 2, 12 + bh / 2, maxBw - 16);
      ctx.textBaseline = 'alphabetic';
      ctx.font = `italic 12px Georgia, serif`;
      ctx.fillStyle = 'rgba(243,231,201,0.55)';
      ctx.fillText('tap or Esc to skip', W / 2, 12 + bh + 14);
      ctx.restore();

      // fades
      if (this.fadeIn > 0) {
        ctx.fillStyle = `rgba(5,2,8,${this.fadeIn / 0.35})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (this.fading != null) {
        const u = Math.min(1, Math.max(0, (this.tNow - this.fading) / 0.6));
        ctx.fillStyle = `rgba(5,2,8,${u})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    drawStage(ctx, W, H) {
      const gy = this.gy;
      // back wall
      let grad = ctx.createLinearGradient(0, 0, 0, gy);
      grad.addColorStop(0, '#120a1c');
      grad.addColorStop(1, '#2b1a3e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, gy);

      // distant orchestra silhouettes
      ctx.fillStyle = 'rgba(8,4,12,0.55)';
      for (let i = 0; i < 9; i++) {
        const x = W * 0.12 + i * W * 0.09, h = 26 + ((i * 37) % 18);
        ctx.fillRect(x, gy - 58 - h * 0.3, 16, h);
        ctx.beginPath(); ctx.arc(x + 8, gy - 62 - h * 0.3, 7, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = 'rgba(20,12,30,0.9)';
      ctx.fillRect(0, gy - 56, W, 56);

      // floor planks
      grad = ctx.createLinearGradient(0, gy, 0, H);
      grad.addColorStop(0, '#6e4a26');
      grad.addColorStop(1, '#3c2713');
      ctx.fillStyle = grad;
      ctx.fillRect(0, gy, W, H - gy);
      ctx.strokeStyle = 'rgba(30,18,8,0.5)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        const y = gy + ((H - gy) * i) / 6;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      const vanish = W / 2;
      for (let i = -8; i <= 8; i++) {
        ctx.beginPath();
        ctx.moveTo(vanish + i * 90, gy);
        ctx.lineTo(vanish + i * 150, H);
        ctx.stroke();
      }

      // spotlights following the duelists
      for (const a of [this.A, this.D]) {
        const g2 = ctx.createRadialGradient(a.x, gy - 60, 10, a.x, gy - 60, 200);
        g2.addColorStop(0, 'rgba(255,236,180,0.16)');
        g2.addColorStop(1, 'rgba(255,236,180,0)');
        ctx.fillStyle = g2;
        ctx.fillRect(a.x - 210, 0, 420, H);
        ctx.fillStyle = 'rgba(255,236,180,0.10)';
        ctx.beginPath();
        ctx.ellipse(a.x, gy + 6, 90, 18, 0, 0, TAU);
        ctx.fill();
      }

      // side curtains + valance
      ctx.fillStyle = '#581414';
      ctx.fillRect(0, 0, W * 0.055, gy + 20);
      ctx.fillRect(W - W * 0.055, 0, W * 0.055, gy + 20);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let x = 6; x < W * 0.055; x += 14) { ctx.fillRect(x, 0, 5, gy + 20); ctx.fillRect(W - x - 5, 0, 5, gy + 20); }
      ctx.fillStyle = '#581414';
      ctx.fillRect(0, 0, W, 34);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      for (let x = 0; x < W; x += 40) ctx.fillRect(x, 0, 14, 34);
      ctx.fillStyle = '#d9a93f';
      ctx.fillRect(0, 34, W, 4);

      // footlights
      for (let x = 30; x < W; x += 64) {
        const g3 = ctx.createRadialGradient(x, H - 8, 2, x, H - 8, 26);
        g3.addColorStop(0, 'rgba(255,220,140,0.5)');
        g3.addColorStop(1, 'rgba(255,220,140,0)');
        ctx.fillStyle = g3;
        ctx.beginPath(); ctx.arc(x, H - 8, 26, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffe9b0';
        ctx.fillRect(x - 3, H - 10, 6, 4);
      }
    }
  }

  MG.BattleScene = BattleScene;
  MG.BATTLE_NAMES = NAMES;
  // soak-harness introspection
  MG.battleVariantCount = (key) => allSeqs(key).length;
  MG.EP_COUNT = EN_PASSANT.length;
  MG.CASTLE_COUNT = CASTLE.length;
  MG.STALEMATE_COUNT = STALEMATE.length;
  MG.DRAW_COUNT = DRAW.length;
})();
