/* ============================================================
   Maestro's Gambit — main.js
   Game controller: state machine, move pipeline, AI turns,
   battle triggers, and the master render loop.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Default time control for the chess clocks: 10 minutes, no increment. The
  // base + increment are configurable in Options (a preset such as 3+2, or a
  // custom value); this is just the fallback when nothing is stored.
  const CLOCK_SECONDS = 10 * 60;

  const App = {
    state: 'menu',          // menu | board | battle
    game: null,
    board: null,
    battle: null,
    session: null,          // {mode, opponent, aiProfile, humanColor, battles, hostColor}
    puzzle: null,           // active puzzle state {def, index, side, idx, solved}
    lastPgn: '',            // PGN of the most recently finished game (for export)
    busy: false,            // an animation/battle/AI is in flight
    over: false,
    remoteQueue: [],        // online: opponent moves awaiting a free moment
    capturedByWhite: [],
    capturedByBlack: [],
    clock: null,            // {w, b, mode} seconds: remaining (countdown) or elapsed (countup)
    _clockStr: { w: '', b: '' },
    _clockActive: undefined,
    titleT: 0,
    titleFx: null,

    init() {
      this.resize();
      window.addEventListener('resize', () => this.resize());

      this.game = new MG.Chess();
      this.board = new MG.BoardView(canvas);
      this.battle = new MG.BattleScene(canvas);
      this.reel = new MG.Reel(canvas, this.battle);
      this.titleFx = new MG.FXLayer();

      MG.UI.init({
        startGame: (setup) => this.startGame(setup),
        undo: () => this.undo(),
        resign: () => this.resign(),
        quitToMenu: () => this.quitToMenu(),
        rematch: () => this.rematch(),
        toggleBattles: () => {
          if (!this.session) return;
          this.session.battles = !this.session.battles;
          MG.UI.setBattleBtn(this.session.battles);
        },
        cycleView: () => this.cycleView(),
        setOrient: (o) => this.setOrient(o),
        toggleClock: () => this.toggleClock(),
        setClockMode: (v) => this.setClockMode(v),
        setTimeControl: (base, inc, id) => this.setTimeControl(base, inc, id),
        setBoardTheme: (v) => this.board.setTheme(v),
        hostMatch: (side, allowUndos) => this.hostMatch(side, allowUndos),
        joinMatch: (code) => this.joinMatch(code),
        leaveLobby: () => this.leaveLobby(),
        startPuzzle: (id) => this.startPuzzle(id),
        nextPuzzle: () => this.nextPuzzle(),
        watchReel: () => this.startReel(),
        getLastPgn: () => this.lastPgn,
        loadPgn: (text) => this.loadPgnGame(text),
      });
      // reflect loaded prefs in the setup screen
      MG.UI.applyMode(MG.UI.setup.mode);
      this.board.setTheme(MG.UI.settings.boardTheme || 'classic');

      // online relay callbacks (see js/net.js)
      MG.Net.configure({
        onStatus: (state, message) => {
          const c = MG.UI.online.connect;
          MG.UI.online.setStatus(message, state === 'error' ? 'warn'
            : (state === 'connecting' || state === 'joining' || state === 'waiting') ? 'busy' : '');
          if (state === 'connecting') c.setLabel('Connecting');
          else if (state === 'joining') c.setLabel('Joining the room');
          else if (state === 'waiting') c.connected('Waiting for the host to begin');
          else if (state === 'error' || state === 'left') c.stop();
        },
        onRoomCreated: (code) => {
          MG.UI.online.showCode(code);
          MG.UI.online.setStatus('Room ' + code + ' is open — share it. Waiting for your opponent…', 'busy');
          MG.UI.online.connect.connected('Waiting for your opponent');
        },
        onStartMatch: (myColor, cfg) => { MG.UI.online.connect.stop(); this.startOnlineGame(myColor, cfg); },
        onMove: (p) => this.applyRemoteMove(p),
        onControl: (p) => this.onRemoteControl(p),
        onPeerLeft: (reason, message) => this.onPeerLeft(reason, message),
        onError: (code, message) => this.onNetError(code, message),
      });

      canvas.addEventListener('pointerdown', (e) => this.onPointer(e));
      canvas.addEventListener('pointermove', (e) => this.onHover(e));
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (this.state === 'reel') this.reel.skip();
        else if (this.state === 'battle') this.battle.skip();
      });

      window.addEventListener('error', (e) => {
        const el = document.getElementById('err-overlay');
        el.classList.remove('hidden');
        el.textContent = 'Error: ' + e.message + '\n' + (e.filename || '').split('/').pop() + ':' + e.lineno;
      });

      MG.UI.show('screen-title');
      this.last = performance.now();
      requestAnimationFrame((t) => this.loop(t));
      this.debugHook();
    },

    /* dev/testing: ?shot=board | ?shot=battle&att=Q&def=K&mate=1&ff=5&clean=1 | &warp=10
       ?reel=1 plays the trailer; ?reel=1&t=SECONDS freezes one frame for a still. */
    debugHook() {
      // Dev/testing URL hooks are stripped from release builds (window.__MG_DEV__
      // is set false by build/make_web_build.sh) so players can't reach them.
      if (!window.__MG_DEV__) return;
      const q = new URLSearchParams(location.search);
      const screen = q.get('screen');
      if (screen === 'online') { MG.UI.setup.mode = 'online'; MG.UI.openLobby(); return; }
      if (screen === 'profiles') { MG.UI.openProfiles(); return; }
      if (screen === 'career') {
        // dev-only: &demo=1 seeds a sample climb so the shot shows all states
        if (q.get('demo')) {
          const prof = MG.Profiles.create('Demo Maestro', 'elo');
          ['pim', 'tina', 'reed', 'vance'].forEach((id) => MG.Profiles.recordDefeat(prof, id));
          MG.Profiles.markCleared(prof, 'Novice');
          MG.UI.refreshProfileUI();
        }
        MG.UI.openCareer();
        return;
      }
      if (screen === 'setup') { MG.UI.show('screen-setup'); return; }
      if (screen === 'options') { MG.UI.refreshRatingOption(); MG.UI.show('screen-options'); return; }
      if (screen === 'puzzles') { MG.UI.openPuzzles(); return; }
      // ?puzzle=<id> loads a puzzle straight onto the board (handy for shots);
      // &solve=1 auto-plays the solution (used to verify the full pipeline)
      const puzzleId = q.get('puzzle');
      if (puzzleId && MG.Puzzles.has(puzzleId)) {
        MG.Audio.enabled = false;
        if (q.get('solve')) { MG.UI.setup.battles = 'off'; this.dtMult = parseFloat(q.get('warp')) || 12; }
        this.startPuzzle(puzzleId);
        if (q.get('solve')) this.autoSolvePuzzle();
        return;
      }
      // ?reel=1 runs the attract-mode trailer. &t=SECONDS seeks to one frame and
      // FREEZES it (synchronous step at load) for a clean headless still; &warp=N
      // fast-runs the live reel to confirm it plays start-to-finish without errors.
      if (q.get('reel') != null) {
        const at = q.get('t');
        if (at != null) {
          MG.Audio.enabled = false;
          MG.UI.hideAll();
          this.reel.start({ loop: false, audio: false, onExit: () => {} });
          this.reel.seek(parseFloat(at) || 0);
          this.reel.active = false;           // hold this frame for capture
          this.state = 'reel';
        } else {
          if (q.get('mute')) MG.Audio.enabled = false;
          this.dtMult = parseFloat(q.get('warp')) || 1;
          this.startReel();
        }
        return;
      }
      const shot = q.get('shot');
      if (!shot) return;
      MG.Audio.enabled = false;
      this.dtMult = parseFloat(q.get('warp')) || 1;
      if (shot === 'board') {
        this.startGame({ mode: '2p', diff: 1, battles: 'off', side: 'w' });
        const v = q.get('view');
        if (v) { this.board.setView(v); MG.UI.setViewBtn(this.board.view); }
        // &orient=N (0..7) spins the table/flat board to a fixed yaw for stills
        const ori = q.get('orient');
        if (ori != null) { this.setOrient(+ori); MG.UI.showOrientDial(this.board.orientable()); }
        if (q.get('dial')) MG.UI.toggleOrientDial();   // open the angle dial for a still
        const th = q.get('theme');
        if (th) this.board.setTheme(th);
        // &select=<sq> highlights a piece + its legal targets (to show move markers)
        const sel = q.get('select');
        if (sel != null) {
          this.board.selected = +sel;
          this.board.legalTargets = this.game.legalMovesFrom(+sel).map((m) => m.to);
        }
      } else if (shot === 'battle') {
        this.startGame({ mode: '2p', diff: 1, battles: 'on', side: 'w' });
        const att = { t: q.get('att') || 'P', c: q.get('ac') || 'w' };
        const def = { t: q.get('def') || 'P', c: q.get('dc') || 'b' };
        const alt = q.get('alt');
        this.enterBattle();
        this.battle.start(att, def, {
          checkmate: q.get('mate') === '1',
          altIndex: alt != null ? +alt : undefined,
          onDone: () => {},
        });
        this.ffBattle(q);
      } else if (shot === 'castle') {
        this.startGame({ mode: '2p', diff: 1, battles: 'on', side: 'w' });
        this.enterBattle();
        this.battle.startCastle(q.get('c') || 'w', q.get('side') || 'K',
          { altIndex: q.get('alt') != null ? +q.get('alt') : undefined, onDone: () => {} });
        this.ffBattle(q);
      } else if (shot === 'ep') {
        this.startGame({ mode: '2p', diff: 1, battles: 'on', side: 'w' });
        this.enterBattle();
        this.battle.start({ t: 'P', c: q.get('ac') || 'w' }, { t: 'P', c: q.get('dc') || 'b' },
          { enpassant: true, altIndex: q.get('alt') != null ? +q.get('alt') : undefined, onDone: () => {} });
        this.ffBattle(q);
      } else if (shot === 'star') {
        this.startGame({ mode: '2p', diff: 1, battles: 'on', side: 'w' });
        this.enterBattle();
        this.battle.startStar(q.get('c') || 'w', q.get('promo') || 'Q', { onDone: () => {} });
        this.ffBattle(q);
      } else if (shot === 'end') {
        this.startGame({ mode: '2p', diff: 1, battles: 'on', side: 'w' });
        this.enterBattle();
        this.battle.startEnd(q.get('kind') || 'draw',
          { altIndex: q.get('alt') != null ? +q.get('alt') : undefined, onDone: () => {} });
        this.ffBattle(q);
      } else if (shot === 'capture') {
        this.startGame({ mode: '2p', diff: 1, battles: 'on', side: 'w' });
        this.runScript(['e4', 'd5', 'exd5', 'Qxd5']);
      } else if (shot === 'mate') {
        this.startGame({ mode: '2p', diff: 1, battles: 'on', side: 'w' });
        this.runScript(['f3', 'e5', 'g4', 'Qh4']);
      } else if (shot === 'gameover') {
        this.startGame({ mode: '2p', diff: 1, battles: 'off', side: 'w' });
        this.endGame('Ivory Triumphs', 'Checkmate. The final bow is taken — bravo, bravissimo!', 'w');
      } else if (shot === 'promo') {
        this.startGame({ mode: '2p', diff: 1, battles: 'off', side: 'w' });
        MG.UI.askPromotion(q.get('c') || 'w');
      } else if (shot === 'flagfall') {
        // verify a timeout ends the game: a tiny flag-fall clock (default 2s) on
        // a fresh 2P board — the side to move runs out and loses on time. The
        // clock is ticked SYNCHRONOUSLY here (not left to real-time frames) so a
        // headless capture deterministically lands on the win-on-time card.
        MG.Audio.enabled = false;
        MG.UI.settings.clockMode = 'flag';
        MG.UI.settings.tcBase = parseFloat(q.get('sec')) || 2;
        MG.UI.settings.tcInc = parseFloat(q.get('inc')) || 0;
        this.startGame({ mode: '2p', diff: 1, battles: 'off', side: 'w' });
        for (let i = 0; i < 2000 && !this.over; i++) this.updateClock(0.1);
      } else if (shot === 'soak') {
        // run EVERY choreography variant AND every special scene to completion
        this.startGame({ mode: '2p', diff: 1, battles: 'on', side: 'w' });
        const types = ['P', 'N', 'B', 'R', 'Q', 'K'];
        let ok = 0, total = 0;
        const runSeq = (label, starter) => {
          total++;
          try {
            let done = false;
            starter(() => { done = true; });
            for (let i = 0; i < 60 * 30 && !done; i++) { this.battle.update(1 / 30); this.battle.draw(); }
            if (!done) { console.error('SOAK STALL ' + label); return; }
            ok++;
          } catch (err) { console.error('SOAK FAIL ' + label + ': ' + err.message); }
        };
        for (const a of types) for (const d of types) {
          const key = a + '>' + d, n = MG.battleVariantCount(key);
          for (let i = 0; i < n; i++) runSeq(key + '#' + i,
            (od) => this.battle.start({ t: a, c: 'w' }, { t: d, c: 'b' }, { altIndex: i, onDone: od }));
        }
        for (let i = 0; i < MG.EP_COUNT; i++) runSeq('EP#' + i,
          (od) => this.battle.start({ t: 'P', c: 'w' }, { t: 'P', c: 'b' }, { enpassant: true, altIndex: i, onDone: od }));
        for (let i = 0; i < MG.CASTLE_COUNT; i++) runSeq('CASTLE#' + i,
          (od) => this.battle.startCastle('w', 'K', { altIndex: i, onDone: od }));
        for (const p of ['Q', 'R', 'B', 'N']) runSeq('STAR#' + p,
          (od) => this.battle.startStar('w', p, { onDone: od }));
        for (let i = 0; i < MG.STALEMATE_COUNT; i++) runSeq('STALE#' + i,
          (od) => this.battle.startEnd('stalemate', { altIndex: i, onDone: od }));
        for (let i = 0; i < MG.DRAW_COUNT; i++) runSeq('DRAW#' + i,
          (od) => this.battle.startEnd('draw', { altIndex: i, onDone: od }));
        console.log('SOAK DONE ' + ok + '/' + total);
        this.state = 'menu';
      }
    },

    /* fast-forward the live battle for headless screenshots (&ff=SECONDS).
       &clean=1 hides the duel banner + skip hint for a framed storefront still. */
    ffBattle(q) {
      if (q.get('clean')) this.battle.suppressBanner = true;
      const ff = parseFloat(q.get('ff')) || 0;
      for (let i = 0; i < ff * 60; i++) this.battle.update(1 / 60);
    },

    runScript(sans) {
      let i = 0;
      const tick = setInterval(() => {
        if (this.over || i >= sans.length) { clearInterval(tick); return; }
        if (this.busy || this.state !== 'board') return;
        const m = this.game.legalMoves().find((x) => this.game.toSAN(x) === sans[i]);
        if (!m) { clearInterval(tick); console.error('script: no move ' + sans[i]); return; }
        i++;
        this.executeMove(m);
      }, 150);
    },

    resize() {
      // Render at the device's true pixel density (capped for fill-rate) so the
      // board and sprites stay crisp on retina/hi-DPI phones. The backing store
      // is innerWidth*dpr, but every draw routine re-applies a dpr transform so
      // all game coordinates remain in CSS pixels (see board/battle/title draw).
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      MG.dpr = dpr;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.board) this.board.layout();
      if (this.battle) this.battle.relayout();
    },

    cycleView() {
      const order = ['iso', 'rot', 'table', 'flat'];
      const next = order[(order.indexOf(MG.UI.settings.view || 'iso') + 1) % order.length];
      MG.UI.settings.view = next;
      MG.UI.savePrefs();
      this.board.setView(next);
      MG.UI.setViewBtn(next);
      // the orient dial only makes sense for the table/flat views
      MG.UI.showOrientDial(this.board.orientable());
    },

    // jump the table/flat board to one of the 8 fixed yaw angles (orient dial)
    setOrient(o) {
      MG.UI.settings.orient = ((Math.round(o) % 8) + 8) % 8;
      MG.UI.savePrefs();
      this.board.setOrient(MG.UI.settings.orient);
      MG.UI.setOrientDial(MG.UI.settings.orient);
    },

    /* ============== chess clocks ============== */
    // Standard chess-clock behaviour: only the side to move counts. Three modes:
    //   'countup'   — start at 0, accumulate each player's total thinking time.
    //   'countdown' — start at the time control, tick toward 0, freeze/flash at
    //                 0:00 (a casual clock — running out does NOT lose).
    //   'flag'      — sudden death: like countdown, but a fallen flag (0:00 on
    //                 your move) LOSES the game. Honours a Fischer increment.
    // Countdown/flag read the configured time control (base seconds + increment
    // per move); count-up ignores it. Online clocks run independently on each
    // client (cosmetic/honour system), so flag-fall is local-modes-only.
    timeControl() {
      const base = Math.max(1, Math.round(+MG.UI.settings.tcBase || CLOCK_SECONDS));
      const inc = Math.max(0, Math.round(+MG.UI.settings.tcInc || 0));
      return { base, inc };
    },
    clockModeNow() {
      const m = MG.UI.settings.clockMode;
      return (m === 'countup' || m === 'flag') ? m : 'countdown';
    },
    resetClock() {
      const mode = this.clockModeNow();
      const tc = this.timeControl();
      const base = mode === 'countup' ? 0 : tc.base;
      this.clock = { w: base, b: base, mode, inc: mode === 'countup' ? 0 : tc.inc };
      this._clockStr = { w: '', b: '' };
      this._clockActive = undefined;
      this.applyClockVisibility();
      this.renderClock('w', true);
      this.renderClock('b', true);
    },
    applyClockVisibility() {
      const show = !!MG.UI.settings.clockShown;
      document.getElementById('clock-w').classList.toggle('hidden', !show);
      document.getElementById('clock-b').classList.toggle('hidden', !show);
    },
    toggleClock() {
      MG.UI.settings.clockShown = !MG.UI.settings.clockShown;
      MG.UI.savePrefs();
      this.applyClockVisibility();
      MG.UI.setClockBtn(MG.UI.settings.clockShown);
    },
    setClockMode(v) {
      MG.UI.settings.clockMode = (v === 'countup' || v === 'flag') ? v : 'countdown';
      this.resetClock();
    },
    // Options picked a new time control (preset or custom): store + restart clocks.
    setTimeControl(base, inc, id) {
      MG.UI.settings.tcBase = Math.max(1, Math.round(+base || CLOCK_SECONDS));
      MG.UI.settings.tcInc = Math.max(0, Math.round(+inc || 0));
      if (id) MG.UI.settings.tcId = id;
      MG.UI.savePrefs();
      this.resetClock();
    },
    fmtClock(secs) {
      secs = Math.max(0, Math.floor(secs));
      const m = Math.floor(secs / 60), s = secs % 60;
      return m + ':' + (s < 10 ? '0' + s : s);
    },
    renderClock(color, force) {
      if (!this.clock) return;
      const str = this.fmtClock(this.clock[color]);
      if (!force && this._clockStr[color] === str) return;
      this._clockStr[color] = str;
      // both limited modes flash at 0:00 (flag = the flag is down)
      const flag = this.clock.mode !== 'countup' && this.clock[color] <= 0;
      MG.UI.setClock(color, str, flag);
    },
    // advance the active side's clock; frozen during animations/battle/game-over
    updateClock(dt) {
      if (!this.clock) return;
      // puzzles aren't timed — the clock would just tick distractingly
      const ticking = this.session && this.session.mode !== 'puzzle' &&
        !this.over && this.state === 'board' && !this.busy;
      const active = ticking ? this.game.turn : null;
      if (active !== this._clockActive) {
        this._clockActive = active;
        document.getElementById('clock-w').classList.toggle('active', active === 'w');
        document.getElementById('clock-b').classList.toggle('active', active === 'b');
      }
      if (!ticking) return;
      const c = this.clock, turn = this.game.turn;
      if (c.mode === 'countup') {
        c[turn] += dt; this.renderClock(turn);
      } else if (c[turn] > 0) {
        c[turn] = Math.max(0, c[turn] - dt);
        this.renderClock(turn);
        if (c[turn] <= 0 && c.mode === 'flag') this.flagFall(turn);
      }
    },

    // sudden-death flag-fall: the side on move ran out of time and loses. Online
    // clocks are an honour-system cosmetic (each client ticks independently), so
    // an auto-loss there would desync — skip it for online matches.
    flagFall(loser) {
      if (this.over || !this.session) return;
      if (this.session.mode === 'online') return;
      const winner = loser === 'w' ? 'b' : 'w';
      const loserName = loser === 'w' ? 'Ivory' : 'Ebony';
      const winnerName = winner === 'w' ? 'Ivory Sinfonia' : 'Ebony Philharmonic';
      this.endGame(`${winnerName} Wins on Time`,
        `${loserName}’s flag falls — the clock runs out. A win on time.`, winner);
    },

    /* ============== session lifecycle ============== */
    startGame(setup) {
      // the CPU opponent is one of the rated personas (js/opponents.js); other
      // modes don't use one. aiProfile is what MG.AI searches with.
      const persona = setup.mode === 'cpu' ? MG.Opponents.get(setup.opponent) : null;
      const puzzleDef = setup.mode === 'puzzle' ? MG.Puzzles.get(setup.puzzleId) : null;
      const session = {
        mode: setup.mode,
        opponent: persona,
        // puzzles let the engine answer with a strong defence (forced anyway);
        // other modes use the persona profile (or a fallback off-CPU)
        aiProfile: setup.mode === 'puzzle' ? MG.Opponents.get('magnus') : (persona || 1),
        // Reduce Motion forces Quick Captures: skip the battle cut-scenes entirely.
        battles: setup.battles === 'on' && !MG.UI.settings.reduceMotion,
        humanColor: setup.mode === '2p' ? null
          : setup.mode === 'online' ? setup.onlineColor
          : setup.mode === 'puzzle' ? (puzzleDef ? puzzleDef.sideToMove : 'w')
          : setup.side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : setup.side,
      };
      if (setup.mode === 'online') {
        // who holds the host slot matters for who drives rematches
        session.hostColor = MG.Net.role === 'host' ? session.humanColor
          : (session.humanColor === 'w' ? 'b' : 'w');
        // match rule: when on, undos are free (no per-request prompt)
        session.allowUndos = !!setup.allowUndos;
      }
      this.session = session;
      this.remoteQueue = [];
      this._undoPending = false;    // online: this client has an undo awaiting consent
      this._undoPrompting = false;  // online: an opponent undo prompt is on screen
      this._undoQueued = 0;         // online: consented takebacks waiting for a quiet board
      // puzzles load a fixed position from FEN; everything else starts fresh
      if (setup.mode === 'puzzle' && puzzleDef) {
        this.game.loadFEN(puzzleDef.fen);
        this.puzzle = { def: puzzleDef, index: MG.Puzzles.indexOf(puzzleDef.id),
          side: puzzleDef.sideToMove, idx: 0, solved: false };
      } else {
        this.game.reset();
        this.puzzle = null;
      }
      this.capturedByWhite = [];
      this.capturedByBlack = [];
      this.board.selected = -1;
      this.board.legalTargets = [];
      this.board.lastMove = null;
      this.board.checkSq = -1;
      this.board.fxl.clear();
      this.over = false;
      this.busy = false;
      this.ratedThisGame = false;   // guard so a game updates a rating only once
      this.state = 'board';

      const youTag = (c) => {
        if (session.mode === '2p') return '';
        if (session.mode === 'online') return session.humanColor === c ? ' (You)' : ' (Opponent)';
        if (session.mode === 'puzzle') return session.humanColor === c ? ' (You)' : ' (Defense)';
        if (session.humanColor === c) return ' (You)';
        return persona ? ` (${persona.name})` : ' (Maestro CPU)';
      };
      MG.UI.setNames('Ivory Sinfonia' + youTag('w'), 'Ebony Philharmonic' + youTag('b'));
      // Undo is available in every mode now — online takebacks go through the
      // opponent (consent prompt, or free if the match allows it).
      document.getElementById('btn-undo').style.display = '';
      MG.UI.setBattleBtn(session.battles);
      this.board.setView(MG.UI.settings.view || 'iso');
      MG.UI.setViewBtn(this.board.view);
      // Face the board to the human's side by default (table/flat honour this):
      // playing Black starts from Black's perspective. The orient dial overrides.
      this.setOrient(session.humanColor === 'b' ? 4 : 0);
      MG.UI.showOrientDial(this.board.orientable());
      this.resetClock();
      MG.UI.setClockBtn(MG.UI.settings.clockShown);
      MG.UI.updateMoveList([]);
      MG.UI.updateCaptured([], []);
      MG.UI.setTurn('w', false);
      MG.UI.hideBanter();
      MG.UI.showGame();
      MG.UI.setHudProfile();   // show the active profile's rating (hidden for Guest)
      MG.Audio.resume();
      MG.Audio.playMusic();
      MG.Audio.castle(); // opening flourish

      // announce the puzzle objective (reuses the speech-bubble toast)
      if (this.puzzle) MG.UI.showBanter(MG.Puzzles.objective(this.puzzle.def), this.puzzle.def.blurb);
      // tell both players the match's undo rule (the host set it)
      if (session.mode === 'online') {
        MG.UI.showBanter('Undos', session.allowUndos
          ? 'Free takebacks are on — either player may undo.'
          : 'Takebacks need your opponent’s OK (tap Undo to ask).');
      }

      if (this.isCpuTurn()) this.cpuMove();
    },

    /* ============== puzzles (mate-in-N / win material) ============== */
    startPuzzle(id) {
      const def = MG.Puzzles.get(id);
      if (!def) return;
      this.over = false;
      this.startGame({ mode: 'puzzle', puzzleId: id, side: def.sideToMove,
        battles: MG.UI.setup.battles });
    },

    // advance to the next puzzle in the list (or back to the list if it was the last)
    nextPuzzle() {
      const next = (this.puzzle ? this.puzzle.index : -1) + 1;
      if (next >= 0 && next < MG.Puzzles.LIST.length) {
        this.startPuzzle(MG.Puzzles.LIST[next].id);
      } else {
        this.over = false; this.session = null; this.puzzle = null;
        MG.Audio.stopBoardMusic();
        MG.UI.openPuzzles();
      }
    },

    /* dev: auto-play a puzzle's solution (the player's plies) to exercise the
       whole pipeline; the defence answers itself between moves. */
    autoSolvePuzzle() {
      const def = this.puzzle.def;
      const playerMoves = def.solutionSANs.filter((_, i) => i % 2 === 0);
      let i = 0;
      const tick = setInterval(() => {
        if (this.over || i >= playerMoves.length) { clearInterval(tick); return; }
        if (this.busy || this.state !== 'board' || !this.isHumanTurn()) return;
        const want = playerMoves[i].replace(/[+#]/g, '');
        const m = this.game.legalMoves().find((x) => this.game.toSAN(x) === want);
        if (!m) { clearInterval(tick); console.error('autosolve: no move ' + playerMoves[i]); return; }
        i++;
        this.commitLocalMove(m);
      }, 200);
    },

    // a move the solver attempted: accept only the solution move (or any
    // alternative immediate mate); reject anything else with a nudge.
    commitPuzzleMove(m) {
      const p = this.puzzle;
      const expected = (p.def.solutionSANs[p.idx] || '').replace(/[+#]/g, '');
      const san = this.game.toSAN(m).replace(/[+#]/g, '');
      let okMove = san === expected;
      if (!okMove && p.def.kind === 'mate') {
        this.game._apply(m);
        okMove = this.game.status() === 'checkmate';
        this.game._unapply();
      }
      if (!okMove) {
        MG.UI.puzzleNudge('Not the winning move — try again.');
        MG.Audio.uiBack();
        this.deselect();
        return;
      }
      this.executeMove(m); // resolution continues in afterMoveResolve → puzzleTail
    },

    // called once a non-terminal puzzle move resolves: either play the scripted
    // defence, or (when the solver's line is complete) declare the puzzle solved.
    puzzleTail() {
      const p = this.puzzle;
      if (!p) return;
      const justMoved = this.game.turn === 'w' ? 'b' : 'w';
      p.idx++;                                   // consume the ply that just resolved
      if (p.idx >= p.def.solutionSANs.length) { this.finishPuzzle(true); return; }
      if (justMoved === p.side) this.puzzleOpponentReply();  // solver moved → defence answers
      // else: the defence just moved → hand control back to the solver (wait for input)
    },

    // play the scripted defensive reply (forced in every mate line; one sound
    // defence in the win lines). Falls back to the engine if the script misses.
    puzzleOpponentReply() {
      const p = this.puzzle;
      const want = (p.def.solutionSANs[p.idx] || '').replace(/[+#]/g, '');
      const m = this.game.legalMoves().find((x) => this.game.toSAN(x) === want);
      this.busy = true;
      if (m) {
        setTimeout(() => { this.busy = false; this.executeMove(m); }, 380);
      } else {
        MG.AI.chooseMoveAsync(this.game, this.session.aiProfile, (em) => {
          this.busy = false;
          if (em && !this.over) this.executeMove(em);
        });
      }
    },

    finishPuzzle(success) {
      if (this.over) return;
      this.over = true;
      this.busy = false;
      const p = this.puzzle;
      if (success) {
        if (p) { p.solved = true; MG.UI.markPuzzleSolved(p.def.id); }
        if (p && p.def.kind === 'win') MG.Audio.fanfareWin(); // mates already cued the finale
      } else {
        MG.Audio.dirge();
      }
      const title = success ? 'Puzzle Solved!' : 'Not Quite';
      const sub = success
        ? (p && p.def.kind === 'mate' ? 'Checkmate, exactly as written — bravo!'
            : 'The material is yours. A clean strike.')
        : 'That line doesn’t force it. Take another look.';
      const hasNext = !!p && p.index < MG.Puzzles.LIST.length - 1;
      setTimeout(() => MG.UI.showPuzzleResult(title, sub, hasNext), success ? 700 : 250);
    },

    /* Load a pasted PGN into a viewable two-player game at its final position
       (reuses the board pipeline). Returns {ok} or {ok:false, error}. */
    loadPgnGame(text) {
      let res;
      try { res = MG.PGN.import(text); }
      catch (e) { return { ok: false, error: e.message || 'Could not parse PGN' }; }

      this.session = { mode: '2p', opponent: null, aiProfile: 1, battles: false, humanColor: null };
      this.puzzle = null;
      this.remoteQueue = [];
      this.game = res.game;
      // rebuild the capture trays from the replayed history
      this.capturedByWhite = []; this.capturedByBlack = [];
      for (const u of this.game.history) {
        const victim = u.taken || (u.epTaken && u.epTaken.piece);
        if (!victim) continue;
        if (u.moved.c === 'w') this.capturedByWhite.push(victim.t);
        else this.capturedByBlack.push(victim.t);
      }
      this.over = false;
      this.busy = false;
      this.ratedThisGame = true;          // a reviewed game never affects a rating
      this.state = 'board';
      this.board.selected = -1; this.board.legalTargets = []; this.board.lastMove = null;
      this.board.checkSq = this.game.inCheck() ? this.game.kingSq(this.game.turn) : -1;
      this.board.fxl.clear();

      const wn = (res.headers.White || 'Ivory Sinfonia');
      const bn = (res.headers.Black || 'Ebony Philharmonic');
      MG.UI.setNames(wn, bn);
      document.getElementById('btn-undo').style.display = '';
      this.session.battles = false;
      MG.UI.setBattleBtn(false);
      this.board.setView(MG.UI.settings.view || 'iso');
      MG.UI.setViewBtn(this.board.view);
      this.setOrient(0);
      MG.UI.showOrientDial(this.board.orientable());
      this.resetClock();
      MG.UI.setClockBtn(MG.UI.settings.clockShown);
      MG.UI.updateMoveList(this.game.sanHistory);
      MG.UI.updateCaptured(this.capturedByWhite, this.capturedByBlack);
      MG.UI.setTurn(this.game.turn, this.game.inCheck());
      MG.UI.hideBanter();
      MG.UI.showGame();
      MG.UI.setHudProfile();
      MG.Audio.resume();
      return { ok: true, moves: res.moves.length };
    },

    /* Player/opponent names for a PGN header, from the team + persona/profile. */
    buildPgnMeta() {
      const s = this.session;
      const prof = MG.Profiles.active();
      const profName = prof.guest ? 'Guest' : prof.name;
      const nameFor = (c) => {
        const team = c === 'w' ? 'Ivory Sinfonia' : 'Ebony Philharmonic';
        if (!s || s.mode === '2p') return team;
        if (s.mode === 'cpu') return s.humanColor === c
          ? `${team} (${profName})`
          : `${team} (${s.opponent ? s.opponent.name : 'Maestro CPU'})`;
        if (s.mode === 'online') return s.humanColor === c ? `${team} (${profName})` : `${team} (Opponent)`;
        return team;
      };
      return { white: nameFor('w'), black: nameFor('b'), date: MG.PGN.todayPGN() };
    },

    rematch() {
      if (!this.session) return;
      if (this.session.mode === 'puzzle') { this.nextPuzzle(); return; }
      if (this.session.mode === 'online') {
        if (!MG.Net.paired) { this.quitToMenu(); return; }
        if (MG.Net.role === 'host') this.startHostRematch();
        else { MG.Net.requestRematch(); document.getElementById('go-sub').textContent = 'Asking the host for an encore…'; }
        return;
      }
      this.startGame({
        mode: this.session.mode,
        opponent: this.session.opponent ? this.session.opponent.id : undefined,
        battles: this.session.battles ? 'on' : 'off',
        side: this.session.humanColor || 'w',
      });
    },

    quitToMenu() {
      const wasPuzzle = this.session && this.session.mode === 'puzzle';
      const doQuit = () => {
        this.state = 'menu';
        this.session = null;
        this.puzzle = null;
        this.busy = false;
        this.remoteQueue = [];
        MG.Net.leave(); // closing the socket lets the opponent know we left
        MG.Audio.stopBoardMusic();
        MG.UI.hideBanter();
        if (wasPuzzle) MG.UI.openPuzzles();   // puzzles return to their list
        else MG.UI.show('screen-title');
      };
      if (this.session && !this.over) {
        MG.UI.askConfirm('Leave the stage?', 'The performance in progress will be abandoned.', 'Quit', 'Keep Playing')
          .then((yes) => { if (yes) doQuit(); });
      } else {
        doQuit();
      }
    },

    resign() {
      if (this.over || !this.session || this.busy) return;
      let loser;
      if (this.session.mode === 'online') {
        loser = this.session.humanColor;
        MG.Net.sendControl('resign');
      } else {
        loser = this.session.mode === '2p' ? this.game.turn : this.session.humanColor;
      }
      const winner = loser === 'w' ? 'b' : 'w';
      this.endGame(winner === 'w' ? 'Ivory Wins' : 'Ebony Wins',
        `${loser === 'w' ? 'Ivory' : 'Ebony'} lays down the bow and resigns.`, winner);
    },

    isCpuTurn() {
      return this.session && this.session.mode === 'cpu' &&
        this.game.turn !== this.session.humanColor && !this.over;
    },
    isHumanTurn() {
      if (!this.session || this.over || this.busy) return false;
      if (this.session.mode === 'online') {
        return MG.Net.paired && this.game.turn === this.session.humanColor;
      }
      return this.session.mode === '2p' || this.game.turn === this.session.humanColor;
    },

    /* ============== online play ============== */
    hostMatch(side, allowUndos) { MG.Audio.resume(); MG.Net.host(side, allowUndos); },
    joinMatch(code) { MG.Audio.resume(); MG.Net.join(code); },
    leaveLobby() { MG.Net.leave(); },

    // both sides arrive here once the relay pairs them (host: on join; both: on start)
    startOnlineGame(myColor, cfg) {
      this.remoteQueue = [];
      this.startGame({
        mode: 'online',
        battles: MG.UI.setup.battles,        // each player keeps their own preference
        side: myColor,
        onlineColor: myColor,
        // the host's "allow free undos" choice governs the whole match
        allowUndos: !!(cfg && cfg.allowUndos),
      });
    },

    // host drives every rematch, swapping colours each time
    startHostRematch() {
      if (!this.session) return;
      const newHostColor = this.session.hostColor === 'w' ? 'b' : 'w';
      MG.Net.startMatchAsHost(newHostColor); // fires onStartMatch here and on the peer
    },

    applyRemoteMove(payload) {
      if (!this.session || this.session.mode !== 'online') return;
      this.remoteQueue.push(payload);
      this.drainRemote();
    },

    // play the next queued opponent move (and any consented undos) when nothing
    // is animating. The two clients can differ in battle-scene length (each
    // keeps their own preference), so an undo/move may land mid-animation here;
    // gating on !busy/board keeps the engines applying it in lockstep.
    drainRemote() {
      if (!this.session || this.session.mode !== 'online') return;
      if (this.over || this.busy || this.state !== 'board') return;
      // consented takebacks apply before the next move (single ply each, in sync)
      while (this._undoQueued > 0) {
        this._undoQueued--;
        if (this._undoOnePly()) { this._refreshAfterUndo(); MG.Audio.uiBack(); }
      }
      if (!this.remoteQueue.length) return;
      const p = this.remoteQueue.shift();
      const m = this.game.legalMoves().find((x) =>
        x.from === p.from && x.to === p.to && (!x.promo || x.promo === (p.promo || 'Q')));
      if (!m) { console.warn('MG.Net: ignored an illegal/unknown remote move', p); return; }
      this.executeMove(m);
    },

    onRemoteControl(p) {
      if (!this.session || this.session.mode !== 'online') return;
      switch (p && p.action) {
        case 'resign': {
          if (this.over) return;
          const winner = this.session.humanColor; // opponent resigned, so I win
          this.endGame(winner === 'w' ? 'Ivory Triumphs' : 'Ebony Triumphs',
            'Your opponent lays down the bow and resigns — bravo!', winner);
          break;
        }
        case 'rematch-request':
          // the joiner asked for an encore; the host restarts the match
          if (MG.Net.role === 'host') this.startHostRematch();
          break;

        // ---- undo handshake ----
        case 'undo-do':
          // free-undo match: the opponent took a move back; mirror it here
          this.applyOnlineUndo();
          break;
        case 'undo-request': {
          if (this.over) return;
          // a free-undo match shouldn't send a request, but honour it gracefully
          if (this.session.allowUndos) { this.applyOnlineUndo(); MG.Net.sendControl('undo-allow'); return; }
          if (this._undoPrompting) return;          // one prompt at a time
          this._undoPrompting = true;
          MG.UI.askConfirm('Opponent has requested an undo',
            'Take back the last move?', 'Allow', 'Decline').then((ok) => {
            this._undoPrompting = false;
            if (this.over || !this.session || this.session.mode !== 'online') return;
            if (ok) { this.applyOnlineUndo(); MG.Net.sendControl('undo-allow'); }
            else { MG.Net.sendControl('undo-decline'); }
          });
          break;
        }
        case 'undo-allow':
          if (this._undoPending) {
            this._undoPending = false;
            this.applyOnlineUndo();
            MG.UI.showBanter('Undo', 'Granted — taking the move back.');
          }
          break;
        case 'undo-decline':
          if (this._undoPending) {
            this._undoPending = false;
            MG.UI.showBanter('Undo', 'Your opponent declined the takeback.');
          }
          break;
        default: break;
      }
    },

    onPeerLeft(reason, message) {
      if (!this.session || this.session.mode !== 'online') {
        // still in the lobby — surface it there and let the player retry
        MG.UI.online.connect.stop();
        MG.UI.online.reenable();
        MG.UI.online.setStatus(message || 'Your opponent left.', 'warn');
        return;
      }
      if (this.over) return;
      this.over = true;
      this.busy = false;
      MG.Audio.drawCue();
      this.state = 'board';
      document.getElementById('hud').classList.remove('hidden');
      MG.UI.setTurn(this.game.turn, false, 'Opponent left');
      setTimeout(() => MG.UI.showGameOver('Opponent Left', message || 'Your opponent disconnected.'), 300);
    },

    onNetError(code, message) {
      // Errors that matter to the player happen in the lobby (bad code, room full…).
      if (!this.session || this.session.mode !== 'online' || this.over) {
        MG.UI.online.connect.stop();
        MG.UI.online.reenable();
        MG.UI.online.setStatus(message || ('Relay error: ' + code), 'warn');
      } else {
        console.warn('MG.Net error during match:', code, message);
      }
    },

    /* ============== input ============== */
    onHover(e) {
      if (this.state !== 'board') return;
      this.board.hover = this.isHumanTurn() ? this.board.squareAt(e.clientX, e.clientY) : -1;
    },

    onPointer(e) {
      MG.Audio.resume();
      if (this.state === 'reel') { this.reel.skip(); return; }
      if (this.state === 'battle') { this.battle.skip(); return; }
      if (this.state !== 'board' || !this.isHumanTurn()) return;
      const sq = this.board.squareAt(e.clientX, e.clientY);
      if (sq < 0) { this.deselect(); return; }
      const piece = this.game.board[sq];

      if (this.board.selected >= 0 && this.board.legalTargets.includes(sq)) {
        const moves = this.game.legalMovesFrom(this.board.selected).filter((m) => m.to === sq);
        if (!moves.length) { this.deselect(); return; }
        if (moves[0].flags === 'promo') {
          MG.UI.askPromotion(this.game.turn).then((p) => {
            const m = moves.find((x) => x.promo === p) || moves[0];
            this.commitLocalMove(m);
          });
        } else {
          this.commitLocalMove(moves[0]);
        }
        return;
      }

      if (piece && piece.c === this.game.turn) {
        this.board.selected = sq;
        this.board.legalTargets = this.game.legalMovesFrom(sq).map((m) => m.to);
        MG.Audio.select(piece.t);
      } else {
        this.deselect();
      }
    },

    deselect() {
      this.board.selected = -1;
      this.board.legalTargets = [];
    },

    /* ============== the move pipeline ============== */
    /* a move the local player committed: relay it, then play it locally */
    commitLocalMove(m) {
      if (this.session && this.session.mode === 'puzzle') { this.commitPuzzleMove(m); return; }
      if (this.session && this.session.mode === 'online') MG.Net.sendMove(m);
      this.executeMove(m);
    },

    executeMove(m) {
      if (this.busy || this.over) return;
      // any new move supersedes a not-yet-answered undo request
      this._undoPending = false;
      this.busy = true;
      this.deselect();
      this.board.hover = -1;
      this.board.checkSq = -1;

      const game = this.game;
      const mover = { ...game.board[m.from] };
      const victimSq = m.flags === 'ep' ? m.to + (mover.c === 'w' ? 8 : -8) : m.to;
      const victim = game.board[victimSq] ? { ...game.board[victimSq] } : null;
      const snapshot = game.board.map((p) => (p ? { ...p } : null));

      game.move(m);
      MG.UI.updateMoveList(game.sanHistory);
      // deterministic battle take for online (identical on both clients); the
      // ply count + squares are in sync since both ran the same move.
      const seed = this.battleSeed(m);

      const visual = { from: m.from, to: m.to, piece: mover, second: null };
      if (m.flags === 'castleK' || m.flags === 'castleQ') {
        const home = mover.c === 'w' ? 7 : 0;
        const rf = m.flags === 'castleK' ? home * 8 + 7 : home * 8;
        const rt = m.flags === 'castleK' ? home * 8 + 5 : home * 8 + 3;
        visual.second = { from: rf, to: rt, piece: { t: 'R', c: mover.c } };
      }
      if (!victim) MG.Audio.move();

      const speed = MG.UI.settings.speed;
      this.board.beginMoveAnim(snapshot, visual, () => {
        this.board.lastMove = { from: m.from, to: m.to };
        if (victim) {
          this.recordCapture(mover.c, victim.t);
          if (this.session.battles) {
            if (m.flags === 'ep') this.runEnPassant(mover, victim, () => this.afterMove(m, mover), seed);
            else this.runBattle(mover, victim, false, () => this.afterMove(m, mover), seed);
            return;
          }
          MG.Audio.thud(0, 0.5);
          const { x, y } = this.board.sq2xy(m.to);
          this.board.fxl.sparks(x, y - 30, 12);
          this.board.fxl.stars(x, y - 40, 8);
        } else if ((m.flags === 'castleK' || m.flags === 'castleQ') && this.session.battles) {
          // celebrate the maneuver: conductor & percussionist high-five mid-cross
          this.runCastle(mover.c, m.flags === 'castleK' ? 'K' : 'Q', () => this.afterMove(m, mover), seed);
          return;
        }
        this.afterMove(m, mover);
      }, speed);
    },

    recordCapture(byColor, type) {
      (byColor === 'w' ? this.capturedByWhite : this.capturedByBlack).push(type);
      MG.UI.updateCaptured(this.capturedByWhite, this.capturedByBlack);
      this.maybeBanterCapture(byColor, type);
    },

    /* persona trash talk when the CPU snatches your queen or rook (Banter on) */
    maybeBanterCapture(byColor, type) {
      if (!this.session || this.session.mode !== 'cpu' || !MG.UI.settings.banter) return;
      const persona = this.session.opponent;
      if (!persona) return;
      if (byColor === this.session.humanColor) return;   // only the CPU taunts
      if (type !== 'Q' && type !== 'R') return;           // only the big pieces
      MG.UI.showBanter(persona.name, persona.lines.bigCapture);
    },

    /* a one-line send-off from the persona on the game-over card (Banter on):
       its `win` line if the CPU won, its gracious `lose` line if you did. */
    cpuBanterForEnd(winner) {
      if (!this.session || this.session.mode !== 'cpu' || !MG.UI.settings.banter) return null;
      const persona = this.session.opponent;
      if (!persona || winner == null) return null;        // draws stay quiet
      const cpuWon = winner !== this.session.humanColor;
      const line = cpuWon ? persona.lines.win : persona.lines.lose;
      return line ? `“${line}” — ${persona.name}` : null;
    },

    /* ============== attract-mode trailer reel ============== */
    /* the music-synced "Watch the Overture" trailer; click/Esc to exit */
    startReel() {
      MG.Audio.resume();
      MG.UI.hideAll();
      this.state = 'reel';
      this.reel.start({ loop: true, onExit: () => this.exitReel() });
    },
    exitReel() {
      this.reel.stop();
      MG.Audio.stopBoardMusic();
      this.state = 'menu';
      MG.UI.show('screen-title');
    },

    /* enter the full-screen stage; sceneDone wraps onDone to restore the board */
    enterBattle() {
      this.state = 'battle';
      document.getElementById('hud').classList.add('hidden');
    },
    sceneDone(onDone) {
      return () => {
        this.state = 'board';
        if (this.session) document.getElementById('hud').classList.remove('hidden');
        onDone();
      };
    },

    /* A deterministic battle index for online play. Both clients run the same
       move through the same engine, so the ply count + squares match exactly —
       deriving the take/finale from them makes every duel identical on both
       ends (still varied move-to-move). Returns undefined off-line, which the
       pickers treat as "choose at random", so local play is unchanged. */
    battleSeed(m) {
      if (!this.session || this.session.mode !== 'online') return undefined;
      const ply = this.game.history.length;
      const from = m && m.from != null ? m.from : 0;
      const to = m && m.to != null ? m.to : 0;
      return (ply * 131 + from * 17 + to * 7) >>> 0;
    },

    // seed: a deterministic choreography index for online play (both clients
    // show the same take/finale); undefined off-line so the scene stays random.
    runBattle(attacker, defender, checkmate, onDone, seed) {
      this.enterBattle();
      MG.Audio.stinger(attacker.t); // the attacker's signature phrase opens the duel
      this.battle.start(attacker, defender, {
        checkmate, altIndex: seed, speed: MG.UI.settings.speed, onDone: this.sceneDone(onDone),
      });
    },
    runEnPassant(attacker, defender, onDone, seed) {
      this.enterBattle();
      this.battle.start(attacker, defender, {
        enpassant: true, altIndex: seed, speed: MG.UI.settings.speed, onDone: this.sceneDone(onDone),
      });
    },
    runCastle(color, side, onDone, seed) {
      this.enterBattle();
      this.battle.startCastle(color, side, { altIndex: seed, speed: MG.UI.settings.speed, onDone: this.sceneDone(onDone) });
    },
    runStar(color, promo, onDone) {
      this.enterBattle();
      this.battle.startStar(color, promo, { speed: MG.UI.settings.speed, onDone: this.sceneDone(onDone) });
    },
    runEndScene(kind, onDone) {
      this.enterBattle();
      this.battle.startEnd(kind, { speed: MG.UI.settings.speed, onDone: this.sceneDone(onDone) });
    },

    // Fischer increment: a completed move tops up the mover's clock (countdown
    // /flag only; puzzles aren't timed). Called once per move from afterMove.
    addIncrement(color) {
      const c = this.clock;
      if (!c || c.mode === 'countup' || !c.inc) return;
      if (this.session && this.session.mode === 'puzzle') return;
      c[color] += c.inc;
      this.renderClock(color, true);
    },

    afterMove(m, mover) {
      this.addIncrement(mover.c);
      if (m.flags === 'promo') {
        this.board.promoSparkle(m.to);
        // "A Star Is Born": a full cutscene for the new chair (battles on);
        // otherwise just the sparkle + fanfare, then resolve as usual
        if (this.session && this.session.battles) {
          this.runStar(mover.c, m.promo, () => this.afterMoveResolve(m, mover));
          return;
        }
        MG.Audio.promote();
      }
      this.afterMoveResolve(m, mover);
    },

    endWithScene(kind, title, sub, winner) {
      if (this.session && this.session.battles) {
        this.runEndScene(kind, () => this.endGame(title, sub, winner));
      } else {
        this.endGame(title, sub, winner);
      }
    },

    afterMoveResolve(m, mover) {
      const game = this.game;
      const status = game.status();
      const inCheck = game.inCheck();

      if (status === 'checkmate') {
        const winner = game.turn === 'w' ? 'b' : 'w';
        const kingSq = game.kingSq(game.turn);
        this.board.checkPulse(kingSq, 'Checkmate!');
        MG.Audio.check();
        const seed = this.battleSeed(m);
        const finale = () => {
          const loserKing = { t: 'K', c: game.turn };
          // the promoted piece delivers the finale in its new chair
          const finisher = m.flags === 'promo' ? { t: m.promo, c: mover.c } : mover;
          if (this.session && this.session.battles) {
            setTimeout(() => {
              this.runBattle(finisher, loserKing, true, () => {
                this.endGame(winner === 'w' ? 'Ivory Triumphs' : 'Ebony Triumphs',
                  'Checkmate. The final bow is taken — bravo, bravissimo!', winner);
              }, seed);
            }, 700);
          } else {
            this.endGame(winner === 'w' ? 'Ivory Triumphs' : 'Ebony Triumphs',
              'Checkmate. The final bow is taken — bravo, bravissimo!', winner);
          }
        };
        finale();
        return;
      }
      if (status === 'stalemate') { this.endWithScene('stalemate', 'Stalemate', 'The hall falls silent — nobody may move. A draw.', null); return; }
      if (status === 'draw50') { this.endWithScene('draw', 'Draw', 'Fifty bars with no theme — the critics call it a draw.', null); return; }
      if (status === 'draw3') { this.endWithScene('draw', 'Draw', 'The same passage three times? A da capo draw.', null); return; }
      if (status === 'drawMat') { this.endWithScene('draw', 'Draw', 'Not enough players left to finish the piece. A draw.', null); return; }

      if (inCheck) {
        const kingSq = game.kingSq(game.turn);
        this.board.checkPulse(kingSq, 'Check!');
        MG.Audio.check();
      } else {
        this.board.checkSq = -1;
      }

      MG.UI.setTurn(game.turn, inCheck);
      this.busy = false;

      if (this.session.mode === 'puzzle') { this.puzzleTail(); return; }
      if (this.isCpuTurn()) this.cpuMove();
      else this.drainRemote();
    },

    cpuMove() {
      this.busy = true;
      MG.UI.setThinking(true);
      MG.AI.chooseMoveAsync(this.game, this.session.aiProfile, (m) => {
        MG.UI.setThinking(false);
        if (!m || this.over || !this.session) { this.busy = false; return; }
        this.busy = false;
        this.executeMove(m);
      });
    },

    /* ============== undo / game end ============== */
    undo() {
      if (this.busy || this.over || !this.session) return;
      // Online takebacks need the opponent — route to the consent flow.
      if (this.session.mode === 'online') { this.requestOnlineUndo(); return; }
      const plies = this.session.mode === 'cpu' ? 2 : 1;
      for (let i = 0; i < plies; i++) { if (!this._undoOnePly()) break; }
      this._refreshAfterUndo();
      MG.Audio.uiBack();
      if (this.isCpuTurn()) this.cpuMove();
    },

    /* take back exactly one ply, restoring the captured-piece tray; returns
       false when there is nothing to undo. Shared by local + online undo. */
    _undoOnePly() {
      if (!this.game.history.length) return false;
      const u = this.game.history[this.game.history.length - 1];
      if (u.taken || u.epTaken) {
        const victim = u.taken || u.epTaken.piece;
        const arr = victim.c === 'b' ? this.capturedByWhite : this.capturedByBlack;
        const idx = arr.lastIndexOf(victim.t);
        if (idx >= 0) arr.splice(idx, 1);
      }
      this.game.undo();
      return true;
    },
    _refreshAfterUndo() {
      this.deselect();
      this.board.lastMove = null;
      this.board.checkSq = this.game.inCheck() ? this.game.kingSq(this.game.turn) : -1;
      MG.UI.updateMoveList(this.game.sanHistory);
      MG.UI.updateCaptured(this.capturedByWhite, this.capturedByBlack);
      MG.UI.setTurn(this.game.turn, this.game.inCheck());
    },

    /* ---- online undo (opponent consent) ----
       The two clients run identical engines, so a takeback only stays in sync
       if BOTH apply the same single-ply undo. The requester asks; the opponent
       Allows/Declines (or, in an "allow undos" match, it just happens on both).
       applyOnlineUndo() is the one authoritative step each side runs. */
    requestOnlineUndo() {
      if (this.over || this.busy || this.state !== 'board') return;
      if (!this.game.history.length) {
        MG.UI.showBanter('Undo', 'No move to take back yet.');
        return;
      }
      if (this._undoPending) { MG.UI.showBanter('Undo', 'Waiting for your opponent…'); return; }
      if (this.session.allowUndos) {
        // free takebacks: mirror it on the opponent, then take it back here
        MG.Net.sendControl('undo-do');
        this.applyOnlineUndo();
        return;
      }
      this._undoPending = true;
      MG.Net.sendControl('undo-request');
      MG.UI.showBanter('Undo', 'Requested — waiting for your opponent…');
    },
    // take back one ply on THIS client (the opponent runs the same step). The
    // undo is queued and applied via drainRemote when the board is quiescent,
    // so it can't fire mid-animation (the two clients' battle scenes may differ
    // in length) — both ends still apply exactly one ply, staying in sync.
    applyOnlineUndo() {
      if (this.over) return;
      this._undoQueued = (this._undoQueued || 0) + 1;
      this.drainRemote();
    },

    endGame(title, sub, winner) {
      // a puzzle reaching a terminal state (checkmate) is a solve, shown on its
      // own result card — never the rated game-over flow.
      if (this.session && this.session.mode === 'puzzle') { this.finishPuzzle(true); return; }
      this.over = true;
      this.busy = false;
      MG.UI.setTurn(this.game.turn, false, title);
      if (winner) {
        if (this.session && (this.session.mode === 'cpu' || this.session.mode === 'online')) {
          // a single human at this screen: cheer if they won, mourn if they lost
          if (winner === this.session.humanColor) MG.Audio.fanfareWin();
          else MG.Audio.dirge();
        } else {
          MG.Audio.fanfareWin();
        }
      } else {
        MG.Audio.drawCue();
      }
      const ratingHtml = this.applyRatingResult(winner);
      const progressHtml = this.applyProgression(winner);
      const banterText = this.cpuBanterForEnd(winner);
      // capture the finished game as PGN for export (Copy/Download on the card + Options)
      try {
        const meta = this.buildPgnMeta();
        meta.result = winner === 'w' ? '1-0' : winner === 'b' ? '0-1' : '1/2-1/2';
        this.lastPgn = MG.PGN.export(this.game, meta);
      } catch (e) { /* leave the previous lastPgn in place */ }
      setTimeout(() => MG.UI.showGameOver(title, sub, ratingHtml, banterText, progressHtml), 900);
    },

    /* Single-player ladder progression: when the HUMAN beats a CPU persona,
       record the defeat on the active profile and return the celebratory lines
       for the game-over card (newly-bested conductor, a freshly cleared class
       band, and the "you bested Maestro Magnus" finale). Returns null when there
       is nothing to celebrate — a loss/draw, Guest, 2P/online, or a rematch
       against an already-beaten persona. */
    applyProgression(winner) {
      if (!this.session || this.session.mode !== 'cpu') return null;
      const persona = this.session.opponent;
      if (!persona || winner == null || winner !== this.session.humanColor) return null;
      const prof = MG.Profiles.active();
      if (prof.guest) return null;

      const lines = [];
      if (MG.Profiles.recordDefeat(prof, persona.id)) lines.push(`You bested <b>${persona.name}</b>!`);
      // a band "clears" the first time all of its personas are down
      const cleared = MG.Opponents.clearedBands(prof.defeated);
      if (cleared[persona.klass] && MG.Profiles.markCleared(prof, persona.klass)) {
        lines.push(`★ <b>${persona.klass}</b> class cleared!`);
      }
      if (MG.Opponents.isComplete(prof.defeated) && MG.Profiles.setLadderComplete(prof)) {
        lines.push('♔ <b>Ladder Complete</b> — you bested Maestro Magnus!');
      }
      if (!lines.length) return null;
      return lines.map((l) => `<div class="gp-line">${l}</div>`).join('');
    },

    /* Update the active profile's rating for this finished game and return a
       little "1200 → 1212 (+12)" line for the game-over card (or null when the
       result isn't rated: Guest, local two-player, or already counted). */
    applyRatingResult(winner) {
      if (!this.session || this.ratedThisGame) return null;
      if (this.session.mode === '2p') return null;          // local 2P never rated
      const prof = MG.Profiles.active();
      if (prof.guest) return null;
      this.ratedThisGame = true;

      const human = this.session.humanColor;
      const score = winner == null ? 0.5 : (winner === human ? 1 : 0);
      let oppRating, label;
      if (this.session.mode === 'cpu') {
        // each persona is graded as a fixed-rating opponent (js/opponents.js)
        const persona = this.session.opponent;
        oppRating = persona ? persona.rating : 1500;
        label = persona ? persona.name : 'CPU';
      } else {
        // online is honour-system: the opponent's rating is unknown, so grade
        // the game against an equal — a win/loss nudges, a draw is neutral.
        oppRating = prof.rating;
        label = 'Online';
      }

      const r = MG.Profiles.recordGame(prof, score, oppRating, { label });
      if (!r) return null;
      MG.UI.setHudProfile();   // reflect the new number behind the card
      const sign = r.delta > 0 ? '+' : '';
      const cls = r.delta > 0 ? 'gr-up' : (r.delta < 0 ? 'gr-down' : '');
      return `${MG.Rating.label(r.system)} ${r.before} → <b>${r.after}</b> ` +
        `<span class="${cls}">(${sign}${r.delta})</span>`;
    },

    /* ============== title ambience ============== */
    drawTitle(dt) {
      this.titleT += dt;
      const d = MG.dpr || 1;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const W = canvas.width / d, H = canvas.height / d;
      let g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0c0712');
      g.addColorStop(0.6, '#1d1028');
      g.addColorStop(1, '#2c163a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // stage glow
      const rg = ctx.createRadialGradient(W / 2, H * 0.85, 40, W / 2, H * 0.85, W * 0.55);
      rg.addColorStop(0, 'rgba(232,181,74,0.12)');
      rg.addColorStop(1, 'rgba(232,181,74,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);

      // Reduce Motion calms the menu: still, evenly-spaced staff lines and no
      // rising particle stream (the conductors below still breathe gently).
      const calm = MG.UI.settings.reduceMotion;

      // drifting staff lines
      ctx.strokeStyle = 'rgba(232,181,74,0.07)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = H * 0.2 + i * 14 + (calm ? 0 : Math.sin(this.titleT * 0.4 + i) * 4);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // floating notes
      if (!calm && Math.random() < 0.06) {
        this.titleFx.add({
          kind: 'note', x: Math.random() * W, y: H + 24,
          vx: (Math.random() - 0.5) * 16, vy: -28 - Math.random() * 30, g: 0,
          life: 9, size: 10 + Math.random() * 14,
          col: `rgba(232,181,74,${0.25 + Math.random() * 0.4})`,
          variant: (Math.random() * 3) | 0, wob: 1 + Math.random() * 2,
        });
      }
      this.titleFx.update(dt);
      this.titleFx.draw(ctx);

      // Two rival conductors flank the title. Draw them ONLY on the title screen
      // itself — every menu screen shares this 'menu' background, and on the denser
      // screens (Options/Profiles/Career/Puzzles) the figures collide with the text
      // and buttons at various zooms/orientations. The title is the one screen laid
      // out around them, so gate on it being the visible screen.
      const titleScreen = document.getElementById('screen-title');
      if (titleScreen && !titleScreen.classList.contains('hidden')) {
        const s = Math.max(2.2, Math.min(3.4, W / 420));
        MG.Sprites.shadow(ctx, W * 0.16, H * 0.82, s / 2.2);
        MG.Sprites.render(ctx, 'K', 'w', 'idle', 0, this.titleT, W * 0.16, H * 0.82, s, false);
        MG.Sprites.shadow(ctx, W * 0.84, H * 0.82, s / 2.2);
        MG.Sprites.render(ctx, 'K', 'b', 'idle', 0, this.titleT + 1.7, W * 0.84, H * 0.82, s, true);
      }
    },

    /* ============== master loop ============== */
    loop(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000) * (this.dtMult || 1);
      this.last = now;

      if (this.state === 'menu') {
        this.drawTitle(dt);
      } else if (this.state === 'reel') {
        this.reel.update(dt);
        this.reel.draw();
      } else if (this.state === 'battle') {
        this.battle.update(dt);
        this.battle.draw();
      } else { // board
        this.updateClock(dt);
        this.board.update(dt);
        this.board.draw(this.game);
      }

      requestAnimationFrame((t) => this.loop(t));
    },
  };

  window.addEventListener('DOMContentLoaded', () => App.init());
  MG.App = App;
})();
