/* ============================================================
   Maestro's Gambit — pgn.js  (MG.PGN)
   PGN (Portable Game Notation) export + import.

   EXPORT: build a valid PGN string from a game — a Seven-Tag-Roster
   header (Event/Site/Date/Round/White/Black/Result) followed by numbered
   SAN movetext drawn from game.sanHistory and a closing result token.

   IMPORT: take pasted PGN, strip the tag pairs, comments, variations and
   NAGs, tokenize the SAN movetext, and replay it from the start position
   by matching each token against game.legalMoves()/game.toSAN(). Returns a
   freshly-replayed MG.Chess game plus the parsed headers.

   Pure + DOM-free, so it can be require()'d under Node (it expects
   MG.Chess to already be loaded — e.g. require('./chess.js') first).
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});

  // Seven Tag Roster, in the canonical order.
  const SEVEN_TAG = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function todayPGN(d) {
    d = d || new Date();
    return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
  }

  // The result token implied by a game's current status ('*' if still going).
  function resultOf(game) {
    const st = game.status();
    if (st === 'checkmate') return game.turn === 'w' ? '0-1' : '1-0'; // side to move is mated
    if (st === 'stalemate' || st === 'draw50' || st === 'draw3' || st === 'drawMat') return '1/2-1/2';
    return '*';
  }

  function escTag(v) {
    return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // Numbered SAN movetext, wrapped to ~80 columns, ending in the result token.
  function movetext(sans, result) {
    const tokens = [];
    for (let i = 0; i < sans.length; i++) {
      if (i % 2 === 0) tokens.push((i / 2 + 1) + '.');
      tokens.push(sans[i]);
    }
    tokens.push(result || '*');
    let line = '', body = '';
    for (const t of tokens) {
      if (line && line.length + 1 + t.length > 80) { body += line + '\n'; line = t; }
      else line = line ? line + ' ' + t : t;
    }
    if (line) body += line;
    return body;
  }

  /* Build a PGN string. `meta` may override any of the seven tags
     (event/site/date/round/white/black/result) and supply an `extra`
     map of additional tag pairs. Movetext comes from game.sanHistory. */
  function exportPGN(game, meta) {
    meta = meta || {};
    const result = meta.result || resultOf(game);
    const tags = {
      Event: meta.event || "Maestro's Gambit",
      Site: meta.site || 'Maestro’s Gambit',
      Date: meta.date || todayPGN(),
      Round: meta.round || '-',
      White: meta.white || 'Ivory Sinfonia',
      Black: meta.black || 'Ebony Philharmonic',
      Result: result,
    };
    let out = '';
    for (const k of SEVEN_TAG) out += '[' + k + ' "' + escTag(tags[k]) + '"]\n';
    if (meta.extra) {
      for (const k in meta.extra) out += '[' + k + ' "' + escTag(meta.extra[k]) + '"]\n';
    }
    out += '\n' + movetext(game.sanHistory, result) + '\n';
    return out;
  }

  /* Parse + replay a PGN string. Returns { game, headers, moves } where
     `game` is a replayed MG.Chess at the final position and `moves` is the
     list of SAN tokens applied. Throws on an unrecognized/illegal move. */
  function importPGN(text) {
    if (!text || !String(text).trim()) throw new Error('Empty PGN');
    text = String(text);

    const headers = {};
    const tagRe = /\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/g;
    let m;
    while ((m = tagRe.exec(text))) {
      headers[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    // Reduce to bare movetext: drop tag pairs, comments, variations, NAGs.
    let mt = text.replace(tagRe, ' ');
    mt = mt.replace(/;[^\n]*/g, ' ');        // rest-of-line comments
    mt = mt.replace(/\{[^}]*\}/g, ' ');      // brace comments
    let prev;                                 // recursive ( ... ) variations
    do { prev = mt; mt = mt.replace(/\([^()]*\)/g, ' '); } while (mt !== prev);
    mt = mt.replace(/\$\d+/g, ' ');          // numeric annotation glyphs

    if (!MG.Chess) throw new Error('MG.Chess is required to replay a PGN');
    const game = new MG.Chess();
    // a game that started from a non-standard position carries a [FEN] tag
    if (headers.FEN) game.loadFEN(headers.FEN);
    const moves = [];
    for (let tok of mt.split(/\s+/)) {
      if (!tok) continue;
      tok = tok.replace(/^\d+\.(\.\.)?/, ''); // strip a glued/standalone move number
      tok = tok.replace(/^\.+/, '');          // strip a lone "..." continuation
      if (!tok) continue;
      if (tok === '1-0' || tok === '0-1' || tok === '1/2-1/2' || tok === '*') continue;
      const want = tok.replace(/[+#!?]+$/, ''); // ignore check/mate/annotation suffixes
      const mv = game.legalMoves().find((x) => game.toSAN(x) === want);
      if (!mv) throw new Error('Unrecognized move in PGN: "' + tok + '"');
      game.move(mv);
      moves.push(want);
    }
    return { game, headers, moves };
  }

  MG.PGN = {
    SEVEN_TAG, todayPGN, resultOf,
    export: exportPGN, exportPGN,
    import: importPGN, importPGN,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MG.PGN;
})();
