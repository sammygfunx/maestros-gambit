/* ============================================================
   Maestro's Gambit — opponents.js  (MG.Opponents)
   The rated opponent ladder: ~10 named, orchestra-themed CPU
   personas spanning roughly 800–2000 Elo across the FIDE/USCF
   class bands (Novice, Class E…Class A, Expert).

   Each persona carries BOTH its search profile and its identity:
     { id, name, blurb, rating, depth, blunder, noise, nodeCap?,
       tint, lines:{ win, bigCapture, lose } }
   The search fields ({depth,blunder,noise,nodeCap}) are handed
   straight to MG.AI.chooseMove — strength is achieved by genuine
   weakening (shallow depth + blunder chance + eval noise), not by
   a strong engine throwing games. `rating` is the FIXED opponent
   rating fed to the rating system after a vs-CPU game.

   HONESTY NOTE: this engine tops out around ~2000 Elo. There are
   deliberately no 2400+/2700 personas that secretly play weak —
   the ladder stops at the Expert band (Maestro Magnus, ~2010),
   which is the engine's honest ceiling. True master strength would
   need an opening book + transposition table + a richer evaluation
   (see PROJECT_STATE.txt).

   Trash talk: `lines` are short, PG, orchestra-flavoured strings.
   They are shown only when the player has Banter enabled.

   Pure data + helpers — no DOM, safe to require() under Node.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});

  // Class-band lookup from a rating (standard FIDE/USCF-style bands).
  function classOf(rating) {
    if (rating < 1000) return 'Novice';
    if (rating < 1200) return 'Class E';
    if (rating < 1400) return 'Class D';
    if (rating < 1600) return 'Class C';
    if (rating < 1800) return 'Class B';
    if (rating < 2000) return 'Class A';
    if (rating < 2200) return 'Expert';
    return 'Master';
  }

  /* The ladder, weakest → strongest. depth/blunder/noise ramp smoothly so
     each rung is meaningfully tougher than the last. `tint` is a hue-rotate
     (degrees) used purely to give each conductor portrait its own colour. */
  const ROSTER = [
    {
      id: 'pim', name: 'Piccolo Pim', rating: 820, tint: 0,
      blurb: 'Just learned which way the violinists face.',
      depth: 1, blunder: 0.45, noise: 140,
      lines: {
        win: 'I won? I WON! Wait — what were we playing?',
        bigCapture: 'Ooh, is this one important? It looks important!',
        lose: 'That was fun! Can you show me that trick again?',
      },
    },
    {
      id: 'tina', name: 'Triangle Tina', rating: 1010, tint: 35,
      blurb: 'One note, perfectly timed. The rest is improvised.',
      depth: 1, blunder: 0.34, noise: 110,
      lines: {
        win: '*ting* And that, darling, is my cue to bow.',
        bigCapture: 'One clean strike — like my one clean note.',
        lose: 'Off by a beat. I’ll be ready for the encore.',
      },
    },
    {
      id: 'reed', name: 'Reed Wobble', rating: 1180, tint: 70,
      blurb: 'A nervous oboist who occasionally finds a tune.',
      depth: 2, blunder: 0.28, noise: 90,
      lines: {
        win: 'My reed held! And so, it seems, did my nerve.',
        bigCapture: 'A squeak, a strike — both surprised me.',
        lose: 'My reed cracked at the worst possible bar.',
      },
    },
    {
      id: 'vance', name: 'Viola Vance', rating: 1300, tint: 110,
      blurb: 'Steady inner voice. Underrated, and knows it.',
      depth: 2, blunder: 0.22, noise: 70,
      lines: {
        win: 'The middle voice carries the harmony. And the win.',
        bigCapture: 'Nobody watches the viola — until it strikes.',
        lose: 'Overlooked again. The story of my section.',
      },
    },
    {
      id: 'cleo', name: 'Cornet Cleo', rating: 1450, tint: 150,
      blurb: 'Bright, brassy, and a little too fond of fanfares.',
      depth: 2, blunder: 0.15, noise: 52,
      lines: {
        win: 'Cue the fanfare — this one’s mine!',
        bigCapture: 'A blast of brass, and your piece is gone.',
        lose: 'A flat note to end on. I’ll polish the valves.',
      },
    },
    {
      id: 'tempo', name: 'Tempo Tan', rating: 1560, tint: 190,
      blurb: 'Keeps strict time and rarely loses the thread.',
      depth: 3, blunder: 0.11, noise: 38,
      lines: {
        win: 'Right on the downbeat. The performance is mine.',
        bigCapture: 'You drifted off-tempo — and paid the price.',
        lose: 'You set a tempo I couldn’t follow. Well played.',
      },
    },
    {
      id: 'fugue', name: 'Fugue Fennimore', rating: 1680, tint: 230,
      blurb: 'Thinks in counterpoint; every move answers another.',
      depth: 3, blunder: 0.07, noise: 26,
      lines: {
        win: 'Subject, answer, checkmate. A tidy fugue.',
        bigCapture: 'Your line resolved straight into my trap.',
        lose: 'A voice I never heard coming. Bravo.',
      },
    },
    {
      id: 'cruz', name: 'Crescendo Cruz', rating: 1820, tint: 270,
      blurb: 'Builds pressure bar by bar until the board breaks.',
      depth: 3, blunder: 0.035, noise: 15,
      lines: {
        win: 'I told you the volume would only grow.',
        bigCapture: 'Feel that? The crescendo is just beginning.',
        lose: 'You held the line through my loudest passage. Respect.',
      },
    },
    {
      id: 'della', name: 'Diva Della', rating: 1930, tint: 310,
      blurb: 'A prima donna with the technique to back it up.',
      depth: 4, blunder: 0.015, noise: 7,
      lines: {
        win: 'Naturally. Did you expect the diva to falter?',
        bigCapture: 'A high note — and your queen takes her exit.',
        lose: 'You stole my spotlight. I shall remember this.',
      },
    },
    {
      id: 'magnus', name: 'Maestro Magnus', rating: 2010, tint: 340,
      blurb: 'The honest summit of this hall. Plays no charity.',
      depth: 4, blunder: 0, noise: 0,
      lines: {
        win: 'The baton falls. A flawless performance — mine.',
        bigCapture: 'Every piece has its place. Yours was off the board.',
        lose: 'Astonishing. You out-conducted the conductor.',
      },
    },
  ];

  const BY_ID = {};
  for (const o of ROSTER) { o.klass = classOf(o.rating); BY_ID[o.id] = o; }

  // A sensible mid-ladder default (≈ the old "Performer").
  const DEFAULT_ID = 'tempo';

  const Opponents = {
    ROSTER, DEFAULT_ID, classOf,
    get(id) { return BY_ID[id] || BY_ID[DEFAULT_ID]; },
    has(id) { return !!BY_ID[id]; },
    // ROSTER grouped into [{ klass, list:[…] }] in ladder order, for the picker.
    byClass() {
      const groups = [];
      let cur = null;
      for (const o of ROSTER) {
        if (!cur || cur.klass !== o.klass) { cur = { klass: o.klass, list: [] }; groups.push(cur); }
        cur.list.push(o);
      }
      return groups;
    },
  };

  MG.Opponents = Opponents;
  if (typeof module !== 'undefined' && module.exports) module.exports = Opponents;
})();
