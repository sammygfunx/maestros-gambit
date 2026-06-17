/* ============================================================
   Maestro's Gambit — net.js
   Thin client for the room-code WebSocket relay (server/relay).
   The relay never runs chess; both browsers run js/chess.js and
   this module just ships each move + a few control messages to
   the opponent in the same room.

   Public surface (MG.Net):
     configure(handlers)          register callbacks (see below)
     relayUrl()                   resolved relay URL (override or default)
     host(side)                   create a room; side = 'w'|'b'|'r'
     join(code)                   join a room by 5-letter code
     startMatchAsHost(hostColor)  (re)start the match; host only
     requestRematch()             joiner asks the host for a rematch
     sendMove({from,to,promo})    forward a chess move to the opponent
     sendControl(action, extra)   forward a control msg (resign/…)
     leave()                      close the connection / room

   Handlers (all optional):
     onStatus(state, message)     'connecting'|'waiting'|'error'|'left'|…
     onRoomCreated(code)          host got its room code
     onStartMatch(myColor, cfg)   both sides: begin playing as 'w'|'b'
                                  (cfg = {allowUndos} match options)
     onMove(payload)              opponent moved {from,to,promo}
     onControl(payload)           opponent control {action,…}
                                  (resign, rematch-request, undo-request/
                                   -allow/-decline/-do)
     onPeerLeft(reason, message)  opponent disconnected / room gone
     onError(code, message)       relay error
   ============================================================ */
(function () {
  const MG = (globalThis.MG = globalThis.MG || {});

  const other = (c) => (c === 'w' ? 'b' : 'w');

  const Net = {
    // The bundled relay: gives players one-click Host/Join with nothing to type.
    // A player can still override it via the lobby's (collapsed) Server settings;
    // set this back to '' to force the Server field to be filled in instead.
    DEFAULT_RELAY_URL: 'wss://maestros-gambit.onrender.com',

    ws: null,
    handlers: {},
    role: '',            // 'host' | 'join'
    code: '',            // current room code
    paired: false,       // opponent present in the room
    matchActive: false,  // a match has been started (start-match seen)
    hostSide: 'w',       // host's requested side until the coin toss resolves
    allowUndos: false,   // host's "allow free undos" choice (sent in start-match)
    _intentionalClose: false,

    configure(handlers) { this.handlers = handlers || {}; return this; },

    /* ---- URL resolution ---- */
    relayUrl() {
      const override = (MG.UI && MG.UI.settings && MG.UI.settings.relayUrl) || '';
      return String(override || this.DEFAULT_RELAY_URL || '').trim();
    },
    _urlProblem(url) {
      if (!url) return 'No relay server set. Add one in Server settings below.';
      if (!/^wss?:\/\//i.test(url)) return 'Relay URL must start with ws:// or wss://';
      // A page served over https cannot open an insecure ws:// socket.
      if (location.protocol === 'https:' && /^ws:\/\//i.test(url)) {
        return 'This page is HTTPS, so the relay must be wss:// (secure).';
      }
      return '';
    },

    /* ---- connection ---- */
    _connect() {
      // Resolve once already-open; otherwise open a fresh socket.
      return new Promise((resolve, reject) => {
        const url = this.relayUrl();
        const problem = this._urlProblem(url);
        if (problem) { reject(new Error(problem)); return; }
        if (this.ws && this.ws.readyState === WebSocket.OPEN) { resolve(); return; }
        this._intentionalClose = false;
        let ws;
        try { ws = new WebSocket(url); }
        catch (e) { reject(new Error('Could not reach the relay. Check the URL.')); return; }
        this.ws = ws;
        this._status('connecting', 'Contacting the relay…');
        const onOpen = () => { ws.removeEventListener('error', onErr); resolve(); };
        const onErr = () => {
          ws.removeEventListener('open', onOpen);
          reject(new Error('Could not connect to the relay. Is it awake?'));
        };
        ws.addEventListener('open', onOpen, { once: true });
        ws.addEventListener('error', onErr, { once: true });
        ws.addEventListener('message', (ev) => this._onMessage(ev));
        ws.addEventListener('close', () => this._onClose());
      });
    },

    _send(obj) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
      try { this.ws.send(JSON.stringify(obj)); return true; }
      catch (e) { return false; }
    },

    /* ---- room lifecycle ---- */
    host(side, allowUndos) {
      this.role = 'host';
      this.hostSide = side === 'b' || side === 'w' ? side : 'r';
      this.allowUndos = !!allowUndos;
      this._connect()
        .then(() => { this._send({ type: 'create-room', host_label: 'Ivory Maestro' }); })
        .catch((e) => this._fail(e.message));
    },

    join(code) {
      this.role = 'join';
      const clean = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
      this._connect()
        .then(() => {
          this._status('joining', 'Joining the room…');
          this._send({ type: 'join-room', code: clean, join_label: 'Ebony Maestro' });
        })
        .catch((e) => this._fail(e.message));
    },

    // Host decides who plays Ivory and tells the joiner. Used for the first
    // match (after the opponent joins) and for every rematch.
    startMatchAsHost(hostColor) {
      if (this.role !== 'host') return;
      const col = hostColor === 'b' ? 'b' : hostColor === 'w' ? 'w'
        : (Math.random() < 0.5 ? 'w' : 'b');
      this._send({ type: 'start-match', config: { hostColor: col, allowUndos: this.allowUndos } });
      this.matchActive = true;
      this.handlers.onStartMatch && this.handlers.onStartMatch(col, { allowUndos: this.allowUndos });
    },

    requestRematch() { this.sendControl('rematch-request'); },

    /* ---- gameplay messages ---- */
    sendMove(m) {
      this._send({ type: 'game-message', channel: 'move',
        payload: { from: m.from, to: m.to, promo: m.promo || null } });
    },
    sendControl(action, extra) {
      this._send({ type: 'game-message', channel: 'control',
        payload: Object.assign({ action }, extra || {}) });
    },

    /* ---- teardown ---- */
    leave() {
      this._intentionalClose = true;
      this.matchActive = false;
      this.paired = false;
      this.code = '';
      this.role = '';
      if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }
    },

    /* ---- inbound ---- */
    _onMessage(ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      switch (msg.type) {
        case 'room-created':
          this.code = msg.code;
          this.handlers.onRoomCreated && this.handlers.onRoomCreated(msg.code);
          break;
        case 'room-joined':
          this.code = msg.code;
          this.paired = true;
          this._status('waiting', 'Joined! Waiting for the host to begin…');
          break;
        case 'peer-joined':
          // The opponent arrived; the host opens the match immediately.
          this.paired = true;
          this.startMatchAsHost(this.hostSide);
          break;
        case 'start-match': {
          this.paired = true;
          this.matchActive = true;
          const cfg = msg.config || {};
          const hostColor = cfg.hostColor === 'b' ? 'b' : 'w';
          const myColor = this.role === 'host' ? hostColor : other(hostColor);
          this.allowUndos = !!cfg.allowUndos;
          this.handlers.onStartMatch && this.handlers.onStartMatch(myColor, { allowUndos: this.allowUndos });
          break;
        }
        case 'game-message':
          if (msg.channel === 'move') this.handlers.onMove && this.handlers.onMove(msg.payload || {});
          else if (msg.channel === 'control') this.handlers.onControl && this.handlers.onControl(msg.payload || {});
          break;
        case 'opponent-left':
          this.paired = false;
          this.handlers.onPeerLeft && this.handlers.onPeerLeft(msg.reason || 'left', msg.message || 'Your opponent left the match.');
          break;
        case 'room-expired':
          this.paired = false;
          this.handlers.onPeerLeft && this.handlers.onPeerLeft('expired', msg.message || 'The room expired.');
          break;
        case 'error':
          this.handlers.onError && this.handlers.onError(msg.error || 'error', msg.message || 'Relay error.');
          break;
        default: break;
      }
    },

    _onClose() {
      if (this._intentionalClose) return;
      // Unexpected drop while we thought we were live.
      if (this.matchActive || this.paired) {
        this.paired = false;
        this.handlers.onPeerLeft && this.handlers.onPeerLeft('disconnected', 'Lost connection to the relay.');
      } else {
        this._status('error', 'Disconnected from the relay.');
      }
    },

    _status(state, message) { this.handlers.onStatus && this.handlers.onStatus(state, message); },
    _fail(message) { this._status('error', message); },
  };

  MG.Net = Net;
})();
