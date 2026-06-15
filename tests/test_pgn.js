/* Unit tests for PGN export/import (MG.PGN). Run: node tests/test_pgn.js */
require('../js/chess.js');
require('../js/pgn.js');
const MG = globalThis.MG;
const PGN = MG.PGN;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

function playSAN(game, sanList) {
  for (const want of sanList) {
    const m = game.legalMoves().find((x) => game.toSAN(x) === want);
    if (!m) throw new Error('No such move: ' + want);
    game.move(m);
  }
}

// Replay two games in lockstep and confirm the position matches at every ply.
function positionsMatch(a, sansA, b) {
  const ga = new MG.Chess(), gb = new MG.Chess();
  if (ga.posKey() !== gb.posKey()) return false;
  for (let i = 0; i < sansA.length; i++) {
    playSAN(ga, [sansA[i]]);
    playSAN(gb, [b.moves[i]]);
    if (ga.posKey() !== gb.posKey()) return false;
  }
  return true;
}

console.log('— round-trip: a decisive game (Scholar\'s Mate) —');
{
  const scripted = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7'];
  const g = new MG.Chess();
  playSAN(g, scripted);
  ok(g.status() === 'checkmate', 'scripted game ends in checkmate');

  const pgn = PGN.export(g, { round: '1' });
  ok(/\[White "Ivory Philharmonic"\]/.test(pgn), 'header carries the White tag');
  ok(/\[Black "Obsidian Philharmonic"\]/.test(pgn), 'header carries the Black tag');
  ok(/\[Event "Maestro's Gambit"\]/.test(pgn), 'header carries the Event tag');
  ok(/\[Result "1-0"\]/.test(pgn), 'checkmate by White is scored 1-0');
  ok(/\b1\. e4 e5\b/.test(pgn), 'numbered movetext begins 1. e4 e5');
  ok(/Qxf7#\s+1-0\s*$/.test(pgn.trim()), 'movetext ends with the mate move + result token');

  const back = PGN.import(pgn);
  ok(back.moves.length === g.sanHistory.length, 're-import yields the same move count');
  ok(back.game.fen() === g.fen(), 'final position matches after round-trip (FEN)');
  ok(back.game.status() === 'checkmate', 're-imported game is still checkmate');
  ok(positionsMatch(g, g.sanHistory.map((s) => s.replace(/[+#]/g, '')), back),
    'every intermediate position matches');
  ok(back.headers.Result === '1-0', 'parsed headers include Result 1-0');
}

console.log('— round-trip: an ongoing game (no result) —');
{
  const scripted = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
  const g = new MG.Chess();
  playSAN(g, scripted);
  const pgn = PGN.export(g);
  ok(/\[Result "\*"\]/.test(pgn), 'an unfinished game is scored *');
  ok(/O-O/.test(pgn), 'castling is written O-O');
  const back = PGN.import(pgn);
  ok(back.game.fen() === g.fen(), 'ongoing game round-trips to the same position');
  ok(back.moves.length === scripted.length, 'all moves replay');
}

console.log('— import tolerates comments, variations, NAGs, glued numbers —');
{
  const messy = [
    '[Event "Casual"]',
    '[Site "?"]',
    '',
    '1. e4 {a strong center} e5 2.Nf3 (2. f4 exf4) Nc6 $1',
    '3. Bb5 a6 ; trailing comment',
    '*',
  ].join('\n');
  const back = PGN.import(messy);
  ok(back.moves.join(' ') === 'e4 e5 Nf3 Nc6 Bb5 a6', 'movetext parses past noise');
  ok(back.headers.Event === 'Casual', 'tag value parsed');

  const ref = new MG.Chess();
  playSAN(ref, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
  ok(ref.fen() === back.game.fen(), 'noisy PGN reaches the expected position');
}

console.log('— import rejects an illegal move —');
{
  let threw = false;
  try { PGN.import('1. e4 e5 2. Ke2 Qh4 3. Kxh4'); } catch (e) { threw = true; }
  ok(threw, 'an impossible move throws');
}

console.log('— promotion notation + [FEN] setup replay —');
{
  const fen = '8/P6k/8/8/8/8/6Kp/8 w - - 0 1';
  const g = new MG.Chess().loadFEN(fen);
  playSAN(g, ['a8=Q']);
  ok(/a8=Q/.test(PGN.export(g)), 'promotion written with =Q');
  // a game from a non-standard start round-trips when the [FEN] tag is present
  const pgn = PGN.export(g, { extra: { FEN: fen, SetUp: '1' } });
  ok(/\[FEN "/.test(pgn) && /\[SetUp "1"\]/.test(pgn), 'export emits the FEN/SetUp tags');
  const back = PGN.import(pgn);
  ok(back.game.fen() === g.fen(), 'promotion from a FEN setup round-trips');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
