/* ============================================================
   Maestro's Gambit — main.js
   Game controller: state machine, move pipeline, AI turns,
   battle triggers, and the master render loop.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Default time control for the chess clocks (countdown mode): 10 minutes per
  // player. Change this one constant to adjust the default game length.
  const CLOCK_SECONDS = 10 * 60;

  const App = {
    state: 'menu',          // menu | board | battle
    game: null,
    board: null,
    battle: null,
    session: null,          // {mode, level, humanColor, battles, hostColor}
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
        toggleClock: () => this.toggleClock(),
        setClockMode: (v) => this.setClockMode(v),
        hostMatch: (side) => this.hostMatch(side),
        joinMatch: (code) => this.joinMatch(code),
        leaveLobby: () => this.leaveLobby(),
      });
      // reflect loaded prefs in the setup screen
      MG.UI.applyMode(MG.UI.setup.mode);

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
        onStartMatch: (myColor) => { MG.UI.online.connect.stop(); this.startOnlineGame(myColor); },
        onMove: (p) => this.applyRemoteMove(p),
        onControl: (p) => this.onRemoteControl(p),
        onPeerLeft: (reason, message) => this.onPeerLeft(reason, message),
        onError: (code, message) => this.onNetError(code, message),
      });

      canvas.addEventListener('pointerdown', (e) => this.onPointer(e));
      canvas.addEventListener('pointermove', (e) => this.onHover(e));
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.state === 'battle') this.battle.skip();
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

    /* dev/testing: ?shot=board | ?shot=battle&att=Q&def=K&mate=1&ff=5 | &warp=10 */
    debugHook() {
      const q = new URLSearchParams(location.search);
      const screen = q.get('screen');
      if (screen === 'online') { MG.UI.setup.mode = 'online'; MG.UI.openLobby(); return; }
      const shot = q.get('shot');
      if (!shot) return;
      MG.Audio.enabled = false;
      this.dtMult = parseFloat(q.get('warp')) || 1;
      if (shot === 'board') {
        this.startGame({ mode: '2p', diff: 1, battles: 'off', side: 'w' });
        const v = q.get('view');
        if (v) { this.board.setView(v); MG.UI.setViewBtn(this.board.view); }
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

    /* fast-forward the live battle for headless screenshots (&ff=SECONDS) */
    ffBattle(q) {
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
      const order = ['iso', 'rot', 'table'];
      const next = order[(order.indexOf(MG.UI.settings.view || 'iso') + 1) % order.length];
      MG.UI.settings.view = next;
      MG.UI.savePrefs();
      this.board.setView(next);
      MG.UI.setViewBtn(next);
    },

    /* ============== chess clocks ============== */
    // Standard chess-clock behaviour: only the side to move counts. In
    // 'countdown' mode each side starts at CLOCK_SECONDS and ticks toward 0
    // (freezes/flashes at 0:00 — no flag-fall at this scope). In 'countup'
    // mode each side starts at 0 and accumulates its total thinking time.
    // Online clocks run independently on each client (cosmetic/honour system).
    resetClock() {
      const mode = MG.UI.settings.clockMode === 'countup' ? 'countup' : 'countdown';
      const base = mode === 'countdown' ? CLOCK_SECONDS : 0;
      this.clock = { w: base, b: base, mode };
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
      MG.UI.settings.clockMode = v === 'countup' ? 'countup' : 'countdown';
      if (!this.clock) return;
      this.clock.mode = MG.UI.settings.clockMode;
      const base = this.clock.mode === 'countdown' ? CLOCK_SECONDS : 0;
      this.clock.w = base; this.clock.b = base;
      this.renderClock('w', true);
      this.renderClock('b', true);
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
      const flag = this.clock.mode === 'countdown' && this.clock[color] <= 0;
      MG.UI.setClock(color, str, flag);
    },
    // advance the active side's clock; frozen during animations/battle/game-over
    updateClock(dt) {
      if (!this.clock) return;
      const ticking = this.session && !this.over && this.state === 'board' && !this.busy;
      const active = ticking ? this.game.turn : null;
      if (active !== this._clockActive) {
        this._clockActive = active;
        document.getElementById('clock-w').classList.toggle('active', active === 'w');
        document.getElementById('clock-b').classList.toggle('active', active === 'b');
      }
      if (!ticking) return;
      const c = this.clock, turn = this.game.turn;
      if (c.mode === 'countdown') {
        if (c[turn] > 0) { c[turn] = Math.max(0, c[turn] - dt); this.renderClock(turn); }
      } else {
        c[turn] += dt; this.renderClock(turn);
      }
    },

    /* ============== session lifecycle ============== */
    startGame(setup) {
      const session = {
        mode: setup.mode,
        level: setup.diff,
        battles: setup.battles === 'on',
        humanColor: setup.mode === '2p' ? null
          : setup.mode === 'online' ? setup.onlineColor
          : setup.side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : setup.side,
      };
      if (setup.mode === 'online') {
        // who holds the host slot matters for who drives rematches
        session.hostColor = MG.Net.role === 'host' ? session.humanColor
          : (session.humanColor === 'w' ? 'b' : 'w');
      }
      this.session = session;
      this.remoteQueue = [];
      this.game.reset();
      this.capturedByWhite = [];
      this.capturedByBlack = [];
      this.board.selected = -1;
      this.board.legalTargets = [];
      this.board.lastMove = null;
      this.board.checkSq = -1;
      this.board.fxl.clear();
      this.over = false;
      this.busy = false;
      this.state = 'board';

      const youTag = (c) => {
        if (session.mode === '2p') return '';
        if (session.mode === 'online') return session.humanColor === c ? ' (You)' : ' (Opponent)';
        return session.humanColor === c ? ' (You)' : ' (Maestro CPU)';
      };
      MG.UI.setNames('Ivory Philharmonic' + youTag('w'), 'Obsidian Philharmonic' + youTag('b'));
      // takebacks need both players' consent, so Undo is hidden in online play
      document.getElementById('btn-undo').style.display = session.mode === 'online' ? 'none' : '';
      MG.UI.setBattleBtn(session.battles);
      this.board.setView(MG.UI.settings.view || 'iso');
      MG.UI.setViewBtn(this.board.view);
      this.resetClock();
      MG.UI.setClockBtn(MG.UI.settings.clockShown);
      MG.UI.updateMoveList([]);
      MG.UI.updateCaptured([], []);
      MG.UI.setTurn('w', false);
      MG.UI.showGame();
      MG.Audio.resume();
      MG.Audio.playMusic();
      MG.Audio.castle(); // opening flourish

      if (this.isCpuTurn()) this.cpuMove();
    },

    rematch() {
      if (!this.session) return;
      if (this.session.mode === 'online') {
        if (!MG.Net.paired) { this.quitToMenu(); return; }
        if (MG.Net.role === 'host') this.startHostRematch();
        else { MG.Net.requestRematch(); document.getElementById('go-sub').textContent = 'Asking the host for an encore…'; }
        return;
      }
      this.startGame({
        mode: this.session.mode,
        diff: this.session.level,
        battles: this.session.battles ? 'on' : 'off',
        side: this.session.humanColor || 'w',
      });
    },

    quitToMenu() {
      const doQuit = () => {
        this.state = 'menu';
        this.session = null;
        this.busy = false;
        this.remoteQueue = [];
        MG.Net.leave(); // closing the socket lets the opponent know we left
        MG.Audio.stopBoardMusic();
        MG.UI.show('screen-title');
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
      this.endGame(winner === 'w' ? 'Ivory Wins' : 'Obsidian Wins',
        `${loser === 'w' ? 'Ivory' : 'Obsidian'} lays down the bow and resigns.`, winner);
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
    hostMatch(side) { MG.Audio.resume(); MG.Net.host(side); },
    joinMatch(code) { MG.Audio.resume(); MG.Net.join(code); },
    leaveLobby() { MG.Net.leave(); },

    // both sides arrive here once the relay pairs them (host: on join; both: on start)
    startOnlineGame(myColor) {
      this.remoteQueue = [];
      this.startGame({
        mode: 'online',
        diff: 1,
        battles: MG.UI.setup.battles,        // each player keeps their own preference
        side: myColor,
        onlineColor: myColor,
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

    // play the next queued opponent move when nothing else is animating
    drainRemote() {
      if (!this.session || this.session.mode !== 'online') return;
      if (this.over || this.busy || this.state === 'battle' || !this.remoteQueue.length) return;
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
          this.endGame(winner === 'w' ? 'Ivory Triumphs' : 'Obsidian Triumphs',
            'Your opponent lays down the bow and resigns — bravo!', winner);
          break;
        }
        case 'rematch-request':
          // the joiner asked for an encore; the host restarts the match
          if (MG.Net.role === 'host') this.startHostRematch();
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
      if (this.session && this.session.mode === 'online') MG.Net.sendMove(m);
      this.executeMove(m);
    },

    executeMove(m) {
      if (this.busy || this.over) return;
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
            if (m.flags === 'ep') this.runEnPassant(mover, victim, () => this.afterMove(m, mover));
            else this.runBattle(mover, victim, false, () => this.afterMove(m, mover));
            return;
          }
          MG.Audio.thud(0, 0.5);
          const { x, y } = this.board.sq2xy(m.to);
          this.board.fxl.sparks(x, y - 30, 12);
          this.board.fxl.stars(x, y - 40, 8);
        } else if ((m.flags === 'castleK' || m.flags === 'castleQ') && this.session.battles) {
          // celebrate the maneuver: conductor & percussionist high-five mid-cross
          this.runCastle(mover.c, m.flags === 'castleK' ? 'K' : 'Q', () => this.afterMove(m, mover));
          return;
        }
        this.afterMove(m, mover);
      }, speed);
    },

    recordCapture(byColor, type) {
      (byColor === 'w' ? this.capturedByWhite : this.capturedByBlack).push(type);
      MG.UI.updateCaptured(this.capturedByWhite, this.capturedByBlack);
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

    runBattle(attacker, defender, checkmate, onDone) {
      this.enterBattle();
      MG.Audio.stinger(attacker.t); // the attacker's signature phrase opens the duel
      this.battle.start(attacker, defender, {
        checkmate, speed: MG.UI.settings.speed, onDone: this.sceneDone(onDone),
      });
    },
    runEnPassant(attacker, defender, onDone) {
      this.enterBattle();
      this.battle.start(attacker, defender, {
        enpassant: true, speed: MG.UI.settings.speed, onDone: this.sceneDone(onDone),
      });
    },
    runCastle(color, side, onDone) {
      this.enterBattle();
      this.battle.startCastle(color, side, { speed: MG.UI.settings.speed, onDone: this.sceneDone(onDone) });
    },
    runStar(color, promo, onDone) {
      this.enterBattle();
      this.battle.startStar(color, promo, { speed: MG.UI.settings.speed, onDone: this.sceneDone(onDone) });
    },
    runEndScene(kind, onDone) {
      this.enterBattle();
      this.battle.startEnd(kind, { speed: MG.UI.settings.speed, onDone: this.sceneDone(onDone) });
    },

    afterMove(m, mover) {
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
        const finale = () => {
          const loserKing = { t: 'K', c: game.turn };
          // the promoted piece delivers the finale in its new chair
          const finisher = m.flags === 'promo' ? { t: m.promo, c: mover.c } : mover;
          if (this.session && this.session.battles) {
            setTimeout(() => {
              this.runBattle(finisher, loserKing, true, () => {
                this.endGame(winner === 'w' ? 'Ivory Triumphs' : 'Obsidian Triumphs',
                  'Checkmate. The final bow is taken — bravo, bravissimo!', winner);
              });
            }, 700);
          } else {
            this.endGame(winner === 'w' ? 'Ivory Triumphs' : 'Obsidian Triumphs',
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

      if (this.isCpuTurn()) this.cpuMove();
      else this.drainRemote();
    },

    cpuMove() {
      this.busy = true;
      MG.UI.setThinking(true);
      MG.AI.chooseMoveAsync(this.game, this.session.level, (m) => {
        MG.UI.setThinking(false);
        if (!m || this.over || !this.session) { this.busy = false; return; }
        this.busy = false;
        this.executeMove(m);
      });
    },

    /* ============== undo / game end ============== */
    undo() {
      if (this.busy || this.over || !this.session) return;
      if (this.session.mode === 'online') return; // no free takebacks online
      const plies = this.session.mode === 'cpu' ? 2 : 1;
      for (let i = 0; i < plies; i++) {
        if (!this.game.history.length) break;
        const u = this.game.history[this.game.history.length - 1];
        if (u.taken || u.epTaken) {
          const victim = u.taken || u.epTaken.piece;
          const arr = victim.c === 'b' ? this.capturedByWhite : this.capturedByBlack;
          const idx = arr.lastIndexOf(victim.t);
          if (idx >= 0) arr.splice(idx, 1);
        }
        this.game.undo();
      }
      this.deselect();
      this.board.lastMove = null;
      this.board.checkSq = this.game.inCheck() ? this.game.kingSq(this.game.turn) : -1;
      MG.UI.updateMoveList(this.game.sanHistory);
      MG.UI.updateCaptured(this.capturedByWhite, this.capturedByBlack);
      MG.UI.setTurn(this.game.turn, this.game.inCheck());
      MG.Audio.uiBack();
      if (this.isCpuTurn()) this.cpuMove();
    },

    endGame(title, sub, winner) {
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
      setTimeout(() => MG.UI.showGameOver(title, sub), 900);
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

      // drifting staff lines
      ctx.strokeStyle = 'rgba(232,181,74,0.07)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = H * 0.2 + i * 14 + Math.sin(this.titleT * 0.4 + i) * 4;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // floating notes
      if (Math.random() < 0.06) {
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

      // two rival conductors flank the title
      const s = Math.max(2.2, Math.min(3.4, W / 420));
      MG.Sprites.shadow(ctx, W * 0.16, H * 0.82, s / 2.2);
      MG.Sprites.render(ctx, 'K', 'w', 'idle', 0, this.titleT, W * 0.16, H * 0.82, s, false);
      MG.Sprites.shadow(ctx, W * 0.84, H * 0.82, s / 2.2);
      MG.Sprites.render(ctx, 'K', 'b', 'idle', 0, this.titleT + 1.7, W * 0.84, H * 0.82, s, true);
    },

    /* ============== master loop ============== */
    loop(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000) * (this.dtMult || 1);
      this.last = now;

      if (this.state === 'menu') {
        this.drawTitle(dt);
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
