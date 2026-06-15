/* ============================================================
   Maestro's Gambit — ui.js
   DOM glue: screens, segmented controls, options, HUD,
   promotion dialog, game-over card.
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});
  const $ = (id) => document.getElementById(id);

  const SCREENS = ['screen-title', 'screen-setup', 'screen-options', 'screen-howto', 'screen-credits', 'screen-online', 'screen-profiles', 'screen-career', 'screen-puzzles'];

  const UI = {
    handlers: {},
    settings: { sfx: 0.8, music: 0.6, speed: 1, view: 'iso', musicOn: true, track: 0, relayUrl: '',
      clockMode: 'countdown', clockShown: true, banter: true, freePlay: false, boardTheme: 'classic' },
      // reduceMotion is intentionally absent from the defaults: on first run it is
      // seeded from the OS prefers-reduced-motion setting (see init); thereafter the
      // player's explicit Options choice persists.
    setup: { mode: 'cpu', opponent: MG.Opponents.DEFAULT_ID, side: 'w', battles: 'on' },

    init(handlers) {
      this.handlers = handlers;
      this.loadPrefs();
      // Seed Reduce Motion from the OS preference the first time (no saved value yet),
      // honouring window.matchMedia('(prefers-reduced-motion: reduce)').
      if (this.settings.reduceMotion === undefined) {
        this.settings.reduceMotion = !!(window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      }
      MG.Profiles.load();

      /* ---- navigation ---- */
      const nav = (btn, fn) => $(btn).addEventListener('click', () => { MG.Audio.uiClick(); fn(); });
      nav('btn-play', () => this.show('screen-setup'));
      nav('btn-reel', () => handlers.watchReel());
      nav('btn-howto', () => this.show('screen-howto'));
      nav('btn-options', () => { this.refreshRatingOption(); this.show('screen-options'); });
      nav('btn-credits', () => this.show('screen-credits'));
      nav('btn-career', () => this.openCareer());
      nav('btn-career-back', () => this.show('screen-title'));
      nav('btn-puzzles', () => this.openPuzzles());
      nav('btn-puzzles-back', () => this.show('screen-title'));
      nav('btn-profiles', () => this.openProfiles());
      nav('title-profile', () => this.openProfiles());
      nav('setup-profile', () => this.openProfiles('screen-setup'));
      nav('btn-profiles-back', () => this.show(this._profilesReturn || 'screen-title'));
      nav('btn-play-guest', () => { MG.Profiles.playAsGuest(); this.refreshProfileUI(); this.renderProfiles(); });
      nav('btn-create-profile', () => this.createProfileFromInput());
      $('new-profile-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.createProfileFromInput(); });
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
      this.buildOpponentPicker();
      this.segInit('seg-side', (v) => { this.setup.side = v; this.savePrefs(); }, this.setup.side);
      this.segInit('seg-battles', (v) => { this.setup.battles = v; this.savePrefs(); }, this.setup.battles);
      this.segInit('seg-speed', (v) => { this.settings.speed = +v; this.savePrefs(); }, String(this.settings.speed));
      this.segInit('seg-clock', (v) => { this.settings.clockMode = v; this.savePrefs(); handlers.setClockMode(v); }, this.settings.clockMode);
      this.segInit('seg-banter', (v) => { this.settings.banter = v === 'on'; this.savePrefs(); }, this.settings.banter ? 'on' : 'off');
      // Accessibility: Reduce Motion (calms menus + forces instant captures) and a
      // colour-blind-safe Board Theme. Both persist in mg_prefs.
      this.segInit('seg-motion', (v) => { this.settings.reduceMotion = v === 'on'; this.savePrefs(); },
        this.settings.reduceMotion ? 'on' : 'off');
      this.segInit('seg-theme', (v) => {
        this.settings.boardTheme = v;
        this.savePrefs();
        if (handlers.setBoardTheme) handlers.setBoardTheme(v);
      }, this.settings.boardTheme || 'classic');
      // Career: "Free Play" opens every rung so casual players are never hard-gated.
      this.segInit('seg-freeplay', (v) => {
        this.settings.freePlay = v === 'on';
        this.savePrefs();
        this.buildCareer();
      }, this.settings.freePlay ? 'on' : 'off');
      // Rating system applies to the ACTIVE profile (seeds the new model from
      // the current number). Guests have nothing to track, so it no-ops.
      this.segInit('seg-rating', (v) => {
        const prof = MG.Profiles.active();
        if (prof.guest) { this.refreshRatingOption(); return; }
        MG.Profiles.setSystem(prof, v);
        this.refreshRatingOption();
        this.refreshProfileUI();
      }, MG.Profiles.active().system || 'elo');

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
      nav('btn-clock', () => handlers.toggleClock());
      nav('btn-go-menu', () => handlers.quitToMenu());
      nav('btn-go-rematch', () => handlers.rematch());

      /* ---- PGN export / import ---- */
      nav('btn-go-copy-pgn', () => this.copyPgn());
      nav('btn-go-download-pgn', () => this.downloadPgn());
      nav('btn-opt-copy-pgn', () => this.copyPgn());
      nav('btn-opt-download-pgn', () => this.downloadPgn());
      nav('btn-opt-load-pgn', () => this.loadPgnFromInput());

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
      nav('btn-host', () => {
        this.lobbyBusy('Creating a room…');
        this.online.connect.start('Connecting');
        handlers.hostMatch(this.setup.side);
      });
      const doJoin = () => {
        const code = $('join-code').value.toUpperCase().replace(/[^A-Z]/g, '');
        if (code.length !== 5) { this.online.setStatus('Enter the 5-letter room code to join.', 'warn'); return; }
        this.lobbyBusy('Joining room ' + code + '…');
        this.online.connect.start('Joining the room');
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
      nav('btn-online-back', () => { this.online.connect.stop(); handlers.leaveLobby(); this.show('screen-setup'); });

      // first interaction unlocks WebAudio
      const unlock = () => { MG.Audio.resume(); };
      document.addEventListener('pointerdown', unlock, { once: false });
      document.addEventListener('keydown', unlock, { once: false });

      this.refreshProfileUI();
    },

    /* ---- player profiles ---- */
    openProfiles(returnTo) {
      this._profilesReturn = returnTo || 'screen-title';
      $('new-profile-name').value = '';
      this.renderProfiles();
      this.show('screen-profiles');
    },
    createProfileFromInput() {
      const input = $('new-profile-name');
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      MG.Audio.uiClick();
      // a brand-new profile adopts whichever system is currently selected in Options
      MG.Profiles.create(name, MG.Profiles.active().system || 'elo');
      input.value = '';
      this.renderProfiles();
      this.refreshProfileUI();
    },
    renderProfiles() {
      const list = $('profile-list');
      const all = MG.Profiles.all();
      const activeId = MG.Profiles.data.activeId;
      let html = '';
      // Guest is always offered first
      html += this._profileRow({ id: 'guest', name: 'Guest', guest: true },
        MG.Profiles.isGuestId(activeId));
      if (!all.length) {
        html += '<div class="profile-empty">No saved profiles yet — create one below to track a rating.</div>';
      }
      for (const p of all) html += this._profileRow(p, p.id === activeId);
      list.innerHTML = html;
      list.querySelectorAll('.profile-item').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.pi-del')) return;
          MG.Audio.uiClick();
          MG.Profiles.setActive(el.dataset.id);
          this.renderProfiles();
          this.refreshProfileUI();
        });
      });
      list.querySelectorAll('.pi-del').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const prof = MG.Profiles.get(id);
          this.askConfirm('Delete profile?', `“${prof ? prof.name : ''}” and its rating history will be removed from this device.`, 'Delete', 'Keep')
            .then((yes) => { if (yes) { MG.Profiles.remove(id); this.renderProfiles(); this.refreshProfileUI(); } });
        });
      });
    },
    _profileRow(p, active) {
      if (p.guest) {
        return `<button class="profile-item${active ? ' active' : ''}" data-id="guest">
          <div class="pi-main"><div class="pi-name">Guest</div>
          <div class="pi-stats">No rating tracked — just play.</div></div>
          <div class="pi-rating">—</div></button>`;
      }
      const sys = MG.Rating.label(p.system);
      const rec = `${p.wins}W · ${p.draws}D · ${p.losses}L · ${p.games} games`;
      return `<button class="profile-item${active ? ' active' : ''}" data-id="${p.id}">
        <div class="pi-main"><div class="pi-name">${this._esc(p.name)}</div>
        <div class="pi-stats">${sys} · ${rec}</div></div>
        <div class="pi-rating">${p.rating}</div>
        <button class="pi-del" data-id="${p.id}" title="Delete this profile">✕</button></button>`;
    },
    _esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },

    // refresh every place the active profile is shown (chips + options + HUD)
    refreshProfileUI() {
      const prof = MG.Profiles.active();
      const chip = prof.guest ? 'Guest' : `${this._esc(prof.name)} · ${prof.rating}`;
      $('title-profile-text').textContent = prof.guest ? 'Guest' : `${prof.name} · ${prof.rating}`;
      $('setup-profile-text').textContent = prof.guest ? 'Guest' : `${prof.name} · ${prof.rating}`;
      this.refreshRatingOption();
      this.setHudProfile();
    },
    // reflect the active profile's system + an estimate line in Options
    refreshRatingOption() {
      const prof = MG.Profiles.active();
      const seg = $('seg-rating');
      if (seg) {
        const sys = prof.guest ? 'elo' : (prof.system || 'elo');
        seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('sel', b.dataset.v === sys));
      }
      const est = $('rating-estimate');
      if (est) {
        est.textContent = prof.guest ? 'Guest — no rating tracked'
          : MG.Rating.estimateLine(prof.rating);
      }
    },
    // small HUD chip (shown only when a real profile is active)
    setHudProfile() {
      const prof = MG.Profiles.active();
      const box = $('hud-profile');
      if (prof.guest) { box.classList.add('hidden'); return; }
      $('hud-profile-text').textContent = MG.Rating.label(prof.system) + ' ' + prof.rating;
      box.classList.remove('hidden');
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

    /* Build the opponent picker: a scrollable list of conductor cards grouped
       by class band (Novice … Expert), each a tinted procedural portrait with
       a name + rating. The chosen id is persisted in setup.opponent. */
    buildOpponentPicker() {
      const host = $('opp-picker');
      if (!host) return;
      if (!MG.Opponents.has(this.setup.opponent)) this.setup.opponent = MG.Opponents.DEFAULT_ID;
      host.innerHTML = '';
      for (const group of MG.Opponents.byClass()) {
        const head = document.createElement('div');
        head.className = 'opp-class-head';
        head.textContent = group.klass;
        host.appendChild(head);
        const grid = document.createElement('div');
        grid.className = 'opp-grid';
        for (const o of group.list) {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'opp-card' + (o.id === this.setup.opponent ? ' sel' : '');
          card.dataset.id = o.id;
          card.title = o.blurb;
          const cv = document.createElement('canvas');
          cv.width = 48; cv.height = 60; cv.className = 'opp-portrait';
          cv.style.filter = `hue-rotate(${o.tint}deg) saturate(1.15)`;
          MG.Sprites.drawIcon(cv, 'K', 'b');
          card.appendChild(cv);
          const name = document.createElement('div');
          name.className = 'opp-name'; name.textContent = o.name;
          const rating = document.createElement('div');
          rating.className = 'opp-rating'; rating.textContent = o.rating;
          card.appendChild(name); card.appendChild(rating);
          card.addEventListener('click', () => {
            MG.Audio.uiClick();
            this.setup.opponent = o.id;
            this.savePrefs();
            host.querySelectorAll('.opp-card').forEach((c) => c.classList.toggle('sel', c.dataset.id === o.id));
          });
          grid.appendChild(card);
        }
        host.appendChild(grid);
      }
    },

    /* ---- career ladder (single-player progression) ---- */
    openCareer() {
      this.buildCareer();
      this.show('screen-career');
    },
    /* Render the climb: bands top-to-bottom, each persona marked
       defeated / unlocked / locked. Unlocked & defeated rungs launch a vs-CPU
       game straight away; locked rungs stay disabled until you beat the rung
       below (Free Play opens them all). Reads the ACTIVE profile's defeated map
       (Guest sees an empty climb and is nudged toward Free Play). */
    buildCareer() {
      const host = $('career-list');
      if (!host) return;
      const prof = MG.Profiles.active();
      const defeated = prof.guest ? {} : (prof.defeated || {});
      const freePlay = !!this.settings.freePlay;
      const total = MG.Opponents.ROSTER.length;
      const beaten = MG.Opponents.defeatedCount(defeated);
      $('career-progress').textContent = `${beaten} / ${total} conductors bested`;
      const intro = $('career-intro');
      if (intro) {
        intro.textContent = prof.guest
          ? 'Playing as Guest — your climb is not saved. Create a profile to track progress, or switch on All Unlocked to roam.'
          : MG.Opponents.isComplete(defeated)
            ? 'You have bested the entire hall. Maestro Magnus salutes you — replay any rung for the encore.'
            : 'Beat each conductor to unlock the next rung. Switch on All Unlocked to play anyone.';
      }

      host.innerHTML = '';
      for (const band of MG.Opponents.ladder(defeated, freePlay)) {
        const sec = document.createElement('div');
        sec.className = 'career-band';
        const head = document.createElement('div');
        head.className = 'career-band-head';
        head.innerHTML = `<span class="cb-klass">${this._esc(band.klass)}</span>` +
          (band.cleared ? '<span class="cb-cleared">✓ Cleared</span>' : '');
        sec.appendChild(head);

        const rungs = document.createElement('div');
        rungs.className = 'career-rungs';
        for (const it of band.list) {
          const o = it.o, locked = it.status === 'locked';
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'career-rung ' + it.status;
          card.dataset.id = o.id;
          card.disabled = locked;

          const cv = document.createElement('canvas');
          cv.width = 48; cv.height = 60; cv.className = 'opp-portrait';
          cv.style.filter = `hue-rotate(${o.tint}deg) saturate(1.15)` + (locked ? ' grayscale(1) brightness(.45)' : '');
          MG.Sprites.drawIcon(cv, 'K', 'b');
          card.appendChild(cv);

          const info = document.createElement('div');
          info.className = 'cr-info';
          info.innerHTML = `<div class="cr-name">${locked ? '???' : this._esc(o.name)}</div>` +
            `<div class="cr-blurb">${locked ? 'Beat the conductor below to reveal this challenger.' : this._esc(o.blurb)}</div>`;
          card.appendChild(info);

          const side = document.createElement('div');
          side.className = 'cr-side';
          const statusLabel = it.status === 'defeated' ? '✓ Bested'
            : it.status === 'unlocked' ? '▶ Play' : '🔒 Locked';
          side.innerHTML = `<div class="cr-rating">${locked ? '—' : o.rating}</div>` +
            `<div class="cr-status">${statusLabel}</div>`;
          card.appendChild(side);

          if (!locked) {
            card.addEventListener('click', () => {
              MG.Audio.uiClick();
              this.setup.mode = 'cpu';
              this.setup.opponent = o.id;
              this.savePrefs();
              this.handlers.startGame({
                mode: 'cpu', opponent: o.id,
                side: this.setup.side, battles: this.setup.battles,
              });
            });
          }
          rungs.appendChild(card);
        }
        sec.appendChild(rungs);
        host.appendChild(sec);
      }
    },

    /* ---- puzzles (mate-in-N / win material) ---- */
    openPuzzles() {
      this.buildPuzzles();
      this.show('screen-puzzles');
    },
    buildPuzzles() {
      const host = $('puzzle-list');
      if (!host) return;
      this.solvedPuzzles = this.solvedPuzzles || {};
      host.innerHTML = '';
      for (const p of MG.Puzzles.LIST) {
        const solved = !!this.solvedPuzzles[p.id];
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'puzzle-card' + (solved ? ' solved' : '');
        card.dataset.id = p.id;

        const badge = document.createElement('div');
        badge.className = 'pz-badge' + (p.kind === 'win' ? ' win' : '');
        badge.textContent = MG.Puzzles.objective(p);
        card.appendChild(badge);

        const main = document.createElement('div');
        main.className = 'pz-main';
        main.innerHTML = `<div class="pz-title">${this._esc(p.title)}</div>` +
          `<div class="pz-blurb">${this._esc(p.blurb)}</div>`;
        card.appendChild(main);

        const side = document.createElement('div');
        side.className = 'pz-side';
        side.innerHTML = (solved ? '<span class="pz-check">✓ Solved</span><br>' : '') +
          `${MG.Puzzles.sideName(p)} to move`;
        card.appendChild(side);

        card.addEventListener('click', () => {
          MG.Audio.uiClick();
          this.handlers.startPuzzle(p.id);
        });
        host.appendChild(card);
      }
    },
    markPuzzleSolved(id) {
      this.solvedPuzzles = this.solvedPuzzles || {};
      this.solvedPuzzles[id] = true;
    },
    // a brief "try again" prompt for a wrong puzzle move (reuses the toast)
    puzzleNudge(text) { this.showBanter('Puzzle', text); },
    // the solve/fail card — reuses the game-over modal with puzzle-specific labels
    showPuzzleResult(title, sub, hasNext) {
      $('go-title').textContent = title;
      $('go-sub').textContent = sub;
      ['go-banter', 'go-progress', 'go-rating', 'go-pgn'].forEach((id) => $(id).classList.add('hidden'));
      $('btn-go-menu').textContent = 'Puzzle List';
      $('btn-go-rematch').textContent = hasNext ? 'Next Puzzle →' : 'Back to List';
      this.hideBanter();
      $('screen-gameover').classList.remove('hidden');
    },

    /* ---- PGN export / import ---- */
    copyPgn() {
      const pgn = this.handlers.getLastPgn ? this.handlers.getLastPgn() : '';
      if (!pgn) { this.setPgnStatus('No finished game to export yet.', 'warn'); return; }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(pgn).then(
          () => this.setPgnStatus('PGN copied to the clipboard.', 'ok'),
          () => this.setPgnStatus('Copy failed — your browser blocked it.', 'warn'));
      } else {
        this.setPgnStatus('Clipboard unavailable — use Download instead.', 'warn');
      }
    },
    downloadPgn() {
      const pgn = this.handlers.getLastPgn ? this.handlers.getLastPgn() : '';
      if (!pgn) { this.setPgnStatus('No finished game to export yet.', 'warn'); return; }
      try {
        const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'maestros-gambit-' + MG.PGN.todayPGN().replace(/\./g, '') + '.pgn';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.setPgnStatus('Saved a .pgn file.', 'ok');
      } catch (e) { this.setPgnStatus('Download failed.', 'warn'); }
    },
    loadPgnFromInput() {
      const text = ($('pgn-paste').value || '').trim();
      if (!text) { this.setPgnStatus('Paste a PGN first.', 'warn'); return; }
      const res = this.handlers.loadPgn ? this.handlers.loadPgn(text) : { ok: false, error: 'unavailable' };
      if (res && res.ok) {
        MG.Audio.uiClick();
        this.setPgnStatus('', '');
      } else {
        this.setPgnStatus((res && res.error) || 'Could not load that PGN.', 'warn');
      }
    },
    setPgnStatus(text, cls) {
      const el = $('pgn-status');
      if (!el) return;
      el.textContent = text;
      el.className = 'opt-val' + (cls ? ' ' + cls : '');
    },

    /* a CPU persona's trash-talk speech bubble; auto-fades. Honours the
       Banter toggle (callers pass already-resolved text, so this just shows it) */
    showBanter(who, line) {
      const box = $('banter-toast');
      if (!box || !line) return;
      $('banter-who').textContent = who || '';
      $('banter-line').textContent = line;
      box.classList.remove('hidden', 'show');
      void box.offsetWidth;            // reflow so the fade-in re-triggers
      box.classList.add('show');
      clearTimeout(this._banterT);
      this._banterT = setTimeout(() => {
        box.classList.remove('show');
        setTimeout(() => box.classList.add('hidden'), 300);
      }, 3600);
    },
    hideBanter() {
      const box = $('banter-toast');
      if (!box) return;
      clearTimeout(this._banterT);
      box.classList.remove('show');
      box.classList.add('hidden');
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
      this.online.connect.stop();
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

      /* The "connecting" flourish: an animated label, a predictable progress
         bar, and a rotating orchestral fact to entertain the wait (Render's
         free tier can cold-start). Cosmetic only — no bearing on the relay. */
      connect: {
        shown: false,
        _tick: 0, _p: 0, _start: 0, _connected: false,
        _progTimer: null, _factTimer: null, _lastFact: -1,

        start(label) {
          const panel = $('online-connecting');
          this._connected = false;
          panel.classList.remove('waiting');
          $('conn-fill').style.width = '0%';
          if (label) this.setLabel(label);
          if (this.shown) return;              // idempotent: already running
          this.shown = true;
          this._tick = 0; this._p = 0; this._start = performance.now();
          panel.classList.remove('hidden');
          this.nextFact();
          this._progTimer = setInterval(() => this._step(), 90);
          this._factTimer = setInterval(() => this.nextFact(), 7000);
        },
        setLabel(text) { $('conn-label').textContent = text || 'Connecting'; },
        // socket is up; hold the bar full and switch to a gentle waiting pulse
        connected(label) {
          this._connected = true;
          $('online-connecting').classList.add('waiting');
          if (label) this.setLabel(label);
        },
        _step() {
          this._tick++;
          // animated ellipsis so the player can see it is still working
          $('conn-dots').textContent = '.'.repeat(this._tick % 4);
          const t = (performance.now() - this._start) / 1000;
          // predictable, monotonic ease toward a cap; snaps to full once connected
          const target = this._connected ? 1 : 0.92 * (1 - Math.exp(-t / 16));
          this._p += (target - this._p) * 0.16;
          $('conn-fill').style.width = (this._p * 100).toFixed(1) + '%';
        },
        nextFact() {
          const facts = MG.ORCH_FACTS || [];
          if (!facts.length) return;
          let i = Math.floor(Math.random() * facts.length);
          if (facts.length > 1 && i === this._lastFact) i = (i + 1) % facts.length;
          this._lastFact = i;
          const el = $('conn-fact-text');
          el.style.opacity = '0';
          setTimeout(() => { el.textContent = facts[i]; el.style.opacity = '1'; }, 200);
        },
        stop() {
          if (this._progTimer) { clearInterval(this._progTimer); this._progTimer = null; }
          if (this._factTimer) { clearInterval(this._factTimer); this._factTimer = null; }
          this.shown = false;
          const panel = $('online-connecting');
          panel.classList.add('hidden');
          panel.classList.remove('waiting');
        },
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

    setClockBtn(on) { $('btn-clock').textContent = `Clock: ${on ? 'On' : 'Off'}`; },

    /* render an "M:SS" string as DOM seven-segment digits (sharp at any DPI) */
    SEG7: {
      '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
      '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
    },
    renderSevenSeg(el, str) {
      let html = '';
      for (const ch of String(str)) {
        if (ch === ':') { html += '<span class="seg7-colon"><i></i><i></i></span>'; continue; }
        const on = this.SEG7[ch] || '';
        html += '<span class="seg7">' +
          'abcdefg'.split('').map((s) => `<i class="s s-${s}${on.includes(s) ? ' on' : ''}"></i>`).join('') +
          '</span>';
      }
      el.innerHTML = html;
    },
    setClock(color, str, flag) {
      this.renderSevenSeg($(color === 'w' ? 'clock-w-seg' : 'clock-b-seg'), str);
      $(color === 'w' ? 'clock-w' : 'clock-b').classList.toggle('flag', !!flag);
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

    showGameOver(title, sub, ratingHtml, banterText, progressHtml) {
      $('go-title').textContent = title;
      $('go-sub').textContent = sub;
      // restore the standard labels + PGN actions (the puzzle card repurposes them)
      $('btn-go-menu').textContent = 'Main Menu';
      $('btn-go-rematch').textContent = 'Encore (Rematch)';
      $('go-pgn').classList.remove('hidden');
      const gb = $('go-banter');
      if (banterText) { gb.textContent = banterText; gb.classList.remove('hidden'); }
      else gb.classList.add('hidden');
      const gp = $('go-progress');
      if (progressHtml) { gp.innerHTML = progressHtml; gp.classList.remove('hidden'); }
      else gp.classList.add('hidden');
      const gr = $('go-rating');
      if (ratingHtml) { gr.innerHTML = ratingHtml; gr.classList.remove('hidden'); }
      else gr.classList.add('hidden');
      this.hideBanter();   // clear any lingering in-game toast
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
        // migrate older prefs (numeric setup.diff) to the persona ladder
        delete this.setup.diff;
        if (!MG.Opponents.has(this.setup.opponent)) this.setup.opponent = MG.Opponents.DEFAULT_ID;
      } catch (e) { /* ignore */ }
    },
  };

  MG.UI = UI;
})();
