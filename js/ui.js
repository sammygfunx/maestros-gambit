/* ============================================================
   Maestro's Gambit — ui.js
   DOM glue: screens, segmented controls, options, HUD,
   promotion dialog, game-over card.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});
  const $ = (id) => document.getElementById(id);

  const SCREENS = ['screen-title', 'screen-setup', 'screen-options', 'screen-howto', 'screen-credits', 'screen-online'];

  const UI = {
    handlers: {},
    settings: { sfx: 0.8, music: 0.6, speed: 1, view: 'iso', musicOn: true, track: 0, relayUrl: '' },
    setup: { mode: 'cpu', diff: 1, side: 'w', battles: 'on' },

    init(handlers) {
      this.handlers = handlers;
      this.loadPrefs();

      /* ---- navigation ---- */
      const nav = (btn, fn) => $(btn).addEventListener('click', () => { MG.Audio.uiClick(); fn(); });
      nav('btn-play', () => this.show('screen-setup'));
      nav('btn-howto', () => this.show('screen-howto'));
      nav('btn-options', () => this.show('screen-options'));
      nav('btn-credits', () => this.show('screen-credits'));
      nav('btn-setup-back', () => this.show('screen-title'));
      nav('btn-options-back', () => this.show('screen-title'));
      nav('btn-howto-back', () => this.show('screen-title'));
      nav('btn-credits-back', () => this.show('screen-title'));
      nav('btn-start', () => {
        if (this.setup.mode === 'online') this.openLobby();
        else handlers.startGame(this.setup);
      });

      /* ---- segmented controls ---- */
      this.segInit('seg-mode', (v) => {
        this.setup.mode = v;
        this.applyMode(v);
        this.savePrefs();
      }, this.setup.mode);
      this.segInit('seg-diff', (v) => { this.setup.diff = +v; this.savePrefs(); }, String(this.setup.diff));
      this.segInit('seg-side', (v) => { this.setup.side = v; this.savePrefs(); }, this.setup.side);
      this.segInit('seg-battles', (v) => { this.setup.battles = v; this.savePrefs(); }, this.setup.battles);
      this.segInit('seg-speed', (v) => { this.settings.speed = +v; this.savePrefs(); }, String(this.settings.speed));

      /* ---- options ---- */
      const sfx = $('opt-sfx'), mus = $('opt-music');
      sfx.value = Math.round(this.settings.sfx * 100);
      mus.value = Math.round(this.settings.music * 100);
      $('opt-sfx-val').textContent = sfx.value;
      $('opt-music-val').textContent = mus.value;
      MG.Audio.setSfxVol(this.settings.sfx);
      MG.Audio.setMusicVol(this.settings.music);
      // reflect persisted soundtrack prefs into the audio engine (no playback yet)
      MG.Audio.music.on = this.settings.musicOn;
      MG.Audio.music.trackId = this.settings.track;
      this.segInit('seg-music', (v) => {
        this.settings.musicOn = v === 'on';
        MG.Audio.setMusicOn(this.settings.musicOn);
        this.savePrefs();
      }, this.settings.musicOn ? 'on' : 'off');
      this.segInit('seg-track', (v) => {
        this.settings.track = +v;
        MG.Audio.setMusicTrack(+v);
        this.savePrefs();
      }, String(this.settings.track));
      $('btn-clear-music').addEventListener('click', () => {
        MG.Audio.uiClick();
        MG.Audio.clearMusicFile();
        $('music-name').textContent = 'none';
        if (this.settings.musicOn) MG.Audio.startBoardMusic(); // revert to the bundled track
      });
      sfx.addEventListener('input', () => {
        this.settings.sfx = sfx.value / 100;
        $('opt-sfx-val').textContent = sfx.value;
        MG.Audio.setSfxVol(this.settings.sfx);
        this.savePrefs();
      });
      sfx.addEventListener('change', () => MG.Audio.uiClick());
      mus.addEventListener('input', () => {
        this.settings.music = mus.value / 100;
        $('opt-music-val').textContent = mus.value;
        MG.Audio.setMusicVol(this.settings.music);
        this.savePrefs();
      });
      $('btn-load-music').addEventListener('click', () => { MG.Audio.uiClick(); $('music-file').click(); });
      $('music-file').addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (f) {
          MG.Audio.loadMusicFile(f);
          MG.Audio.startBoardMusic();
          $('music-name').textContent = f.name;
        }
      });

      /* ---- in-game buttons ---- */
      nav('btn-undo', () => handlers.undo());
      nav('btn-resign', () => handlers.resign());
      nav('btn-quit', () => handlers.quitToMenu());
      nav('btn-toggle-battles', () => handlers.toggleBattles());
      nav('btn-view', () => handlers.cycleView());
      nav('btn-go-menu', () => handlers.quitToMenu());
      nav('btn-go-rematch', () => handlers.rematch());

      /* ---- confirm dialog ---- */
      const cfClose = (val) => {
        $('confirm-dialog').classList.add('hidden');
        const r = this._confirmResolve;
        this._confirmResolve = null;
        if (r) r(val);
      };
      nav('btn-cf-yes', () => cfClose(true));
      nav('btn-cf-no', () => cfClose(false));

      /* ---- promotion dialog ---- */
      document.querySelectorAll('.promo-btn').forEach((btn) => {
        MG.Sprites.drawIcon(btn.querySelector('canvas'), btn.dataset.p, 'w');
        btn.addEventListener('click', () => {
          MG.Audio.uiClick();
          if (this._promoResolve) {
            const r = this._promoResolve;
            this._promoResolve = null;
            $('promo-dialog').classList.add('hidden');
            r(btn.dataset.p);
          }
        });
      });

      /* ---- online lobby ---- */
      $('relay-url').value = this.settings.relayUrl || '';
      // If no relay is built in and none saved, open the Server section so the
      // first-time host knows a URL is required.
      if (!MG.Net.DEFAULT_RELAY_URL && !this.settings.relayUrl) $('server-settings').open = true;
      $('relay-url').addEventListener('input', () => {
        this.settings.relayUrl = $('relay-url').value.trim();
        this.savePrefs();
      });
      nav('btn-host', () => { this.lobbyBusy('Creating a room…'); handlers.hostMatch(this.setup.side); });
      const doJoin = () => {
        const code = $('join-code').value.toUpperCase().replace(/[^A-Z]/g, '');
        if (code.length !== 5) { this.online.setStatus('Enter the 5-letter room code to join.', 'warn'); return; }
        this.lobbyBusy('Joining room ' + code + '…');
        handlers.joinMatch(code);
      };
      nav('btn-join', doJoin);
      $('join-code').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
      });
      $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
      $('btn-copy-code').addEventListener('click', () => {
        MG.Audio.uiClick();
        const code = $('room-code').textContent;
        if (navigator.clipboard) navigator.clipboard.writeText(code).then(
          () => this.online.setStatus('Code copied — send it to your opponent.', ''),
          () => {});
      });
      nav('btn-online-back', () => { handlers.leaveLobby(); this.show('screen-setup'); });

      // first interaction unlocks WebAudio
      const unlock = () => { MG.Audio.resume(); };
      document.addEventListener('pointerdown', unlock, { once: false });
      document.addEventListener('keydown', unlock, { once: false });
    },

    segInit(id, onChange, initial) {
      const seg = $(id);
      if (!seg) return;
      const btns = [...seg.querySelectorAll('.seg-btn')];
      const apply = (v) => btns.forEach((b) => b.classList.toggle('sel', b.dataset.v === v));
      if (initial != null) apply(initial);
      btns.forEach((b) => b.addEventListener('click', () => {
        MG.Audio.uiClick();
        apply(b.dataset.v);
        onChange(b.dataset.v);
      }));
    },

    /* reflect the chosen mode in the setup screen: difficulty is CPU-only;
       side acts as the host's preferred colour online; relabel the start button */
    applyMode(v) {
      $('grp-difficulty').style.display = v === 'cpu' ? '' : 'none';
      $('grp-side').style.display = v === '2p' ? 'none' : '';
      $('btn-start').textContent = v === 'online' ? 'Go Online →' : 'Begin the Overture';
    },

    /* ---- online lobby helpers ---- */
    openLobby() {
      this.show('screen-online');
      $('room-code-box').classList.add('hidden');
      $('btn-host').disabled = false;
      $('join-code').disabled = false;
      $('btn-join').disabled = false;
      $('relay-url').value = this.settings.relayUrl || '';
      this.online.setStatus('Host a match and share the code, or join with a code your opponent sent.', '');
    },
    lobbyBusy(msg) {
      $('btn-host').disabled = true;
      $('btn-join').disabled = true;
      this.online.setStatus(msg, 'busy');
    },
    online: {
      setStatus(text, cls) {
        const el = $('online-status');
        el.textContent = text;
        el.className = 'online-status' + (cls ? ' ' + cls : '');
      },
      showCode(code) {
        $('room-code').textContent = code;
        $('room-code-box').classList.remove('hidden');
      },
      // re-enable the lobby buttons after a failure so the player can retry
      reenable() {
        $('btn-host').disabled = false;
        $('join-code').disabled = false;
        $('btn-join').disabled = false;
      },
    },

    show(id) {
      SCREENS.forEach((s) => $(s).classList.toggle('hidden', s !== id));
      $('hud').classList.add('hidden');
      $('screen-gameover').classList.add('hidden');
    },
    showGame() {
      SCREENS.forEach((s) => $(s).classList.add('hidden'));
      $('screen-gameover').classList.add('hidden');
      $('hud').classList.remove('hidden');
    },
    hideAll() {
      SCREENS.forEach((s) => $(s).classList.add('hidden'));
      $('hud').classList.add('hidden');
    },

    askPromotion(color) {
      document.querySelectorAll('.promo-btn').forEach((btn) => {
        MG.Sprites.drawIcon(btn.querySelector('canvas'), btn.dataset.p, color);
      });
      $('promo-dialog').classList.remove('hidden');
      MG.Audio.promote();
      return new Promise((res) => { this._promoResolve = res; });
    },

    setThinking(on) { $('thinking').classList.toggle('hidden', !on); },

    setNames(whiteName, blackName) {
      $('hud-white-name').textContent = whiteName;
      $('hud-black-name').textContent = blackName;
    },

    setTurn(turn, inCheck, gameOver) {
      const banner = $('hud-turn-banner');
      if (gameOver) {
        banner.textContent = gameOver;
        banner.classList.remove('check');
      } else {
        const name = turn === 'w' ? 'Ivory' : 'Obsidian';
        banner.textContent = inCheck ? `${name} — CHECK!` : `${name} to move`;
        banner.classList.toggle('check', !!inCheck);
      }
      $('hud-white-name').classList.toggle('active', turn === 'w' && !gameOver);
      $('hud-black-name').classList.toggle('active', turn === 'b' && !gameOver);
    },

    setBattleBtn(on) { $('btn-toggle-battles').textContent = `Battles: ${on ? 'On' : 'Off'}`; },

    setViewBtn(v) {
      const names = { iso: 'Ivory', rot: 'Obsidian', table: 'Table' };
      $('btn-view').textContent = `View: ${names[v] || 'Ivory'}`;
    },

    askConfirm(title, sub, yesLabel = 'Yes', noLabel = 'No') {
      $('cf-title').textContent = title;
      $('cf-sub').textContent = sub;
      $('btn-cf-yes').textContent = yesLabel;
      $('btn-cf-no').textContent = noLabel;
      $('confirm-dialog').classList.remove('hidden');
      return new Promise((res) => { this._confirmResolve = res; });
    },

    updateMoveList(sans) {
      const el = $('move-list');
      let html = '';
      for (let i = 0; i < sans.length; i += 2) {
        const n = i / 2 + 1;
        const w = sans[i] || '';
        const b = sans[i + 1] || '';
        const wCls = i === sans.length - 1 ? 'mv-last' : '';
        const bCls = i + 1 === sans.length - 1 ? 'mv-last' : '';
        html += `<span class="mv-num">${n}.</span> <span class="${wCls}">${w}</span> <span class="${bCls}">${b}</span><br>`;
      }
      el.innerHTML = html;
      el.scrollTop = el.scrollHeight;
    },

    updateCaptured(capturedByWhite, capturedByBlack) {
      const fill = (rowId, list, color) => {
        const row = $(rowId);
        row.innerHTML = '';
        for (const t of list) {
          const cv = document.createElement('canvas');
          cv.width = 40; cv.height = 50;
          MG.Sprites.drawIcon(cv, t, color);
          row.appendChild(cv);
        }
      };
      // pieces white has taken are black musicians, displayed in white's tray
      fill('cap-white', capturedByWhite, 'b');
      fill('cap-black', capturedByBlack, 'w');
    },

    showGameOver(title, sub) {
      $('go-title').textContent = title;
      $('go-sub').textContent = sub;
      $('screen-gameover').classList.remove('hidden');
    },

    savePrefs() {
      try {
        localStorage.setItem('mg_prefs', JSON.stringify({ settings: this.settings, setup: this.setup }));
      } catch (e) { /* private mode etc. */ }
    },
    loadPrefs() {
      try {
        const raw = localStorage.getItem('mg_prefs');
        if (!raw) return;
        const p = JSON.parse(raw);
        if (p.settings) Object.assign(this.settings, p.settings);
        if (p.setup) Object.assign(this.setup, p.setup);
      } catch (e) { /* ignore */ }
    },
  };

  MG.UI = UI;
})();
