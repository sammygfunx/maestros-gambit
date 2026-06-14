#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const http = require("http");
const WebSocket = require("ws");

const ROOM_CODE_LENGTH = 5;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const FORWARDED_TYPES = new Set([
  "lobby-ready",
  "player-state",
  "start-match",
  "game-message",
  "ping",
  "pong",
]);
// Maestro's Gambit is turn-based, so the relay only forwards two channels:
//   move    — a single chess move {from,to,promo}
//   control — match control {action: resign|rematch|rematch-request|...}
const GAME_CHANNELS = new Set(["move", "control"]);
const LOG_LEVELS = Object.freeze({
  silent: -1,
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
});

function normalizeRoomCode(rawCode) {
  return String(rawCode || "")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]/g, "");
}

function isValidRoomCode(rawCode) {
  const code = normalizeRoomCode(rawCode);
  if (code.length !== ROOM_CODE_LENGTH) {
    return false;
  }
  for (const char of code) {
    if (!ROOM_CODE_ALPHABET.includes(char)) {
      return false;
    }
  }
  return true;
}

function generateRoomCode(existingRooms) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let code = "";
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
    }
    if (!existingRooms.has(code)) {
      return code;
    }
  }
  return "";
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sendJson(socket, message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch (_error) {
    return false;
  }
}

function safeLabel(value, fallback) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, 40) : fallback;
}

function parseInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, parsed));
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function normalizePath(value, fallback = "/") {
  const text = String(value || fallback).trim();
  if (!text || text === "/") {
    return "/";
  }
  return `/${text.replace(/^\/+|\/+$/g, "")}`;
}

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function parseAllowedOrigins(value) {
  if (value instanceof Set) {
    return new Set(value);
  }
  const entries = Array.isArray(value)
    ? value
    : String(value === undefined ? "*" : value).split(",");
  const origins = new Set(entries.map(normalizeOrigin).filter(Boolean));
  if (origins.size === 0) {
    origins.add("*");
  }
  return origins;
}

function loadConfig(options = {}, env = process.env) {
  const maxRooms = options.maxRooms ?? parseInteger(env.MG_RELAY_MAX_ROOMS, 500, 1, 100000);
  const maxPlayersPerRoom = options.maxPlayersPerRoom
    ?? parseInteger(env.MG_RELAY_MAX_PLAYERS_PER_ROOM, 2, 1, 2);
  const roomTtlMs = options.roomTtlMs
    ?? parseInteger(env.MG_RELAY_ROOM_TTL_SECONDS, 3600, 5, 7 * 24 * 60 * 60) * 1000;
  const idleTimeoutMs = options.idleTimeoutMs
    ?? parseInteger(env.MG_RELAY_IDLE_TIMEOUT_SECONDS, 120, 5, 24 * 60 * 60) * 1000;
  const heartbeatIntervalMs = options.heartbeatIntervalMs
    ?? parseInteger(env.MG_RELAY_HEARTBEAT_INTERVAL_SECONDS, 25, 1, 60 * 60) * 1000;
  const cleanupIntervalMs = options.cleanupIntervalMs
    ?? parseInteger(env.MG_RELAY_CLEANUP_INTERVAL_SECONDS, 30, 1, 60 * 60) * 1000;
  const maxClientsDefault = Math.max(32, maxRooms * maxPlayersPerRoom + 16);
  const logLevelCandidate = String(options.logLevel ?? env.MG_RELAY_LOG_LEVEL ?? "info").trim().toLowerCase();
  return {
    host: String(options.host ?? env.MG_RELAY_HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    port: options.port === undefined
      ? parseInteger(env.MG_RELAY_PORT ?? env.PORT, 8911, 0, 65535)
      : Number(options.port),
    path: normalizePath(options.path ?? env.MG_RELAY_PATH ?? "/"),
    healthPath: normalizePath(options.healthPath ?? env.MG_RELAY_HEALTH_PATH ?? "/healthz", "/healthz"),
    allowedOrigins: parseAllowedOrigins(options.allowedOrigins ?? env.MG_RELAY_ALLOWED_ORIGINS),
    allowNoOrigin: options.allowNoOrigin
      ?? parseBoolean(env.MG_RELAY_ALLOW_NO_ORIGIN, true),
    roomTtlMs,
    idleTimeoutMs,
    heartbeatIntervalMs,
    cleanupIntervalMs,
    maxRooms,
    maxPlayersPerRoom,
    maxClients: options.maxClients
      ?? parseInteger(env.MG_RELAY_MAX_CLIENTS, maxClientsDefault, 1, 1000000),
    maxMessageBytes: options.maxMessageBytes
      ?? parseInteger(env.MG_RELAY_MAX_MESSAGE_BYTES, 256 * 1024, 1024, 16 * 1024 * 1024),
    logLevel: Object.hasOwn(LOG_LEVELS, logLevelCandidate) ? logLevelCandidate : "info",
  };
}

function createLogger(level) {
  const threshold = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  const write = (name, ...args) => {
    if ((LOG_LEVELS[name] ?? LOG_LEVELS.info) > threshold) {
      return;
    }
    const method = name === "debug" ? "log" : name;
    console[method](`[maestros-gambit-relay] ${name}:`, ...args);
  };
  return {
    error: (...args) => write("error", ...args),
    warn: (...args) => write("warn", ...args),
    info: (...args) => write("info", ...args),
    debug: (...args) => write("debug", ...args),
  };
}

function validateMessage(message) {
  if (!isPlainObject(message)) {
    return ["bad-message", "Relay messages must be JSON objects."];
  }
  if (typeof message.type !== "string" || !message.type.trim() || message.type.length > 40) {
    return ["bad-message", "Relay messages need a short type string."];
  }
  const type = message.type;
  if (!["create-room", "join-room", ...FORWARDED_TYPES].includes(type)) {
    return ["unknown-type", `Unknown relay message type: ${type}.`];
  }
  if (type === "create-room") {
    if (message.player !== undefined && !isPlainObject(message.player)) {
      return ["bad-message", "create-room player must be a JSON object."];
    }
    if (message.metadata !== undefined && !isPlainObject(message.metadata)) {
      return ["bad-message", "create-room metadata must be a JSON object."];
    }
  }
  if (type === "join-room" && message.player !== undefined && !isPlainObject(message.player)) {
    return ["bad-message", "join-room player must be a JSON object."];
  }
  if (["lobby-ready", "player-state"].includes(type) && !isPlainObject(message.payload)) {
    return ["bad-message", `${type} payload must be a JSON object.`];
  }
  if (type === "start-match" && !isPlainObject(message.config)) {
    return ["bad-message", "start-match config must be a JSON object."];
  }
  if (type === "game-message") {
    if (!GAME_CHANNELS.has(String(message.channel || ""))) {
      return ["unknown-channel", `Unknown game-message channel: ${message.channel || "(empty)"}.`];
    }
    if (!isPlainObject(message.payload)) {
      return ["bad-message", "game-message payload must be a JSON object."];
    }
  }
  if (["ping", "pong"].includes(type) && (typeof message.sent_msec !== "number" || !Number.isFinite(message.sent_msec))) {
    return ["bad-message", `${type} sent_msec must be numeric.`];
  }
  return null;
}

class KeySparRelay {
  constructor(options = {}) {
    this.config = loadConfig(options);
    this.log = createLogger(this.config.logLevel);
    this.rooms = new Map();
    this.clients = new Map();
    this.nextClientId = 1;
    this.cleanupTimer = null;
    this.heartbeatTimer = null;
  }

  attach(server) {
    server.on("connection", (socket, request) => this.handleConnection(socket, request));
    this.cleanupTimer = setInterval(() => this.purgeExpiredRooms(), this.config.cleanupIntervalMs);
    this.cleanupTimer.unref?.();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeats(), this.config.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  close() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  handleConnection(socket, request) {
    if (this.clients.size >= this.config.maxClients) {
      sendJson(socket, {
        type: "error",
        error: "relay-full",
        message: "Relay connection capacity is full. Try again later.",
      });
      socket.close(1013, "Relay capacity full.");
      return;
    }
    const now = Date.now();
    const clientId = this.nextClientId;
    this.clients.set(socket, {
      clientId,
      roomCode: "",
      role: "",
      playerId: 0,
      label: "Peer",
      lastSeenAt: now,
    });
    this.nextClientId += 1;
    this.log.debug(`client ${clientId} connected from ${request?.socket?.remoteAddress || "unknown"}`);

    socket.on("message", (data, isBinary) => this.handleMessage(socket, data, isBinary));
    socket.on("pong", () => this.markClientSeen(socket));
    socket.on("close", () => this.removeClient(socket, "closed"));
    socket.on("error", (error) => {
      this.log.debug(`client ${clientId} socket error: ${error.message}`);
      this.removeClient(socket, "socket-error");
    });
  }

  markClientSeen(socket, now = Date.now()) {
    const state = this.clients.get(socket);
    if (state) {
      state.lastSeenAt = now;
    }
  }

  handleMessage(socket, data, isBinary = false) {
    this.markClientSeen(socket);
    if (isBinary) {
      this.sendError(socket, "bad-message", "Relay messages must be UTF-8 JSON text.");
      socket.close(1003, "Text messages only.");
      return;
    }
    const byteLength = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data));
    if (byteLength > this.config.maxMessageBytes) {
      this.sendError(socket, "message-too-large", `Relay messages may not exceed ${this.config.maxMessageBytes} bytes.`);
      socket.close(1009, "Message too large.");
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString("utf8"));
    } catch (_error) {
      this.sendError(socket, "bad-json", "Relay messages must be valid JSON objects.");
      return;
    }
    const validationError = validateMessage(message);
    if (validationError) {
      this.sendError(socket, validationError[0], validationError[1]);
      return;
    }

    switch (message.type) {
      case "create-room":
        this.createRoom(socket, message);
        break;
      case "join-room":
        this.joinRoom(socket, message);
        break;
      default:
        this.forwardPairedMessage(socket, message);
        break;
    }
  }

  createRoom(socket, message) {
    const state = this.clients.get(socket);
    if (!state) {
      return;
    }
    if (state.roomCode) {
      this.sendError(socket, "already-in-room", `Leave room ${state.roomCode} before creating another room.`);
      return;
    }
    this.purgeExpiredRooms();
    if (this.rooms.size >= this.config.maxRooms) {
      this.sendError(socket, "relay-full", "Relay room capacity is full. Try again later.");
      return;
    }

    const hasRequestedCode = Object.hasOwn(message, "code") && String(message.code || "").trim() !== "";
    const requested = normalizeRoomCode(message.code);
    if (hasRequestedCode && !isValidRoomCode(requested)) {
      this.sendError(socket, "bad-room-code", `Room code must be ${ROOM_CODE_LENGTH} readable letters.`);
      return;
    }
    if (hasRequestedCode && this.rooms.has(requested)) {
      this.sendError(socket, "room-code-taken", `Room ${requested} already exists.`);
      return;
    }
    const code = hasRequestedCode ? requested : generateRoomCode(this.rooms);
    if (!code) {
      this.sendError(socket, "relay-full", "Relay could not allocate a room code. Try again later.");
      return;
    }

    state.roomCode = code;
    state.role = "host";
    state.playerId = 1;
    state.label = safeLabel(message.host_label || message.label, "Host P1");
    const now = Date.now();
    const room = {
      code,
      host: socket,
      guest: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.config.roomTtlMs,
      metadata: isPlainObject(message.metadata) ? message.metadata : {},
    };
    this.rooms.set(code, room);
    this.log.info(`room ${code} created`);
    sendJson(socket, {
      type: "room-created",
      code,
      role: "host",
      player_id: 1,
      room: this.roomSummary(room),
    });
  }

  joinRoom(socket, message) {
    const state = this.clients.get(socket);
    if (!state) {
      return;
    }
    const code = normalizeRoomCode(message.code);
    if (!isValidRoomCode(code)) {
      this.sendError(socket, "bad-room-code", `Room code must be ${ROOM_CODE_LENGTH} readable letters.`);
      return;
    }
    if (state.roomCode) {
      const error = state.roomCode === code ? "duplicate-join" : "already-in-room";
      this.sendError(socket, error, `This client is already in room ${state.roomCode}.`);
      return;
    }

    const room = this.rooms.get(code);
    if (!room || !this.socketOpen(room.host) || room.expiresAt <= Date.now()) {
      if (room) {
        this.expireRoom(room, "expired");
      }
      this.sendError(socket, "room-not-found", `Room ${code} was not found.`);
      return;
    }
    if (room.guest && !this.socketOpen(room.guest)) {
      this.clearClientRoomState(room.guest);
      room.guest = null;
    }
    if (this.roomPlayerCount(room) >= this.config.maxPlayersPerRoom || this.socketOpen(room.guest)) {
      this.sendError(socket, "room-full", `Room ${code} already has its maximum players.`);
      return;
    }

    state.roomCode = code;
    state.role = "join";
    state.playerId = 2;
    state.label = safeLabel(message.join_label || message.label, "Join P2");
    room.guest = socket;
    this.touchRoom(room);
    this.log.info(`room ${code} joined`);
    sendJson(socket, {
      type: "room-joined",
      code,
      role: "join",
      player_id: 2,
      room: this.roomSummary(room),
    });
    sendJson(room.host, {
      type: "peer-joined",
      code,
      role: "host",
      peer: this.clientSummary(socket),
      room: this.roomSummary(room),
    });
  }

  forwardPairedMessage(socket, message) {
    const room = this.roomFor(socket);
    if (!room) {
      if (message.type === "ping") {
        sendJson(socket, {
          type: "pong",
          code: normalizeRoomCode(message.code),
          sent_msec: Number(message.sent_msec) || 0,
          via: "relay",
        });
        return;
      }
      this.sendError(socket, "not-in-room", "Join or create a room before sending peer messages.");
      return;
    }
    const state = this.clients.get(socket);
    if (message.type === "start-match" && state?.role !== "host") {
      this.sendError(socket, "forbidden-message", "Only the room host may send start-match.");
      return;
    }
    this.touchRoom(room);
    const peer = room.host === socket ? room.guest : room.host;
    if (!this.socketOpen(peer)) {
      if (message.type === "ping") {
        sendJson(socket, {
          type: "pong",
          code: room.code,
          sent_msec: Number(message.sent_msec) || 0,
          via: "relay",
        });
        return;
      }
      this.sendError(socket, "opponent-missing", `Room ${room.code} does not have a paired opponent.`);
      return;
    }
    sendJson(peer, {
      ...message,
      code: room.code,
      from: this.clientSummary(socket),
    });
  }

  removeClient(socket, reason) {
    if (!this.clients.has(socket)) {
      return;
    }
    const state = this.clients.get(socket);
    this.leaveCurrentRoom(socket, reason);
    this.clients.delete(socket);
    this.log.debug(`client ${state.clientId} removed (${reason})`);
  }

  leaveCurrentRoom(socket, reason) {
    const state = this.clients.get(socket);
    if (!state || !state.roomCode) {
      return;
    }
    const room = this.rooms.get(state.roomCode);
    this.clearClientRoomState(socket);
    if (!room) {
      return;
    }

    if (room.host === socket) {
      const guest = room.guest;
      this.rooms.delete(room.code);
      this.clearClientRoomState(guest);
      if (this.socketOpen(guest)) {
        sendJson(guest, {
          type: "opponent-left",
          code: room.code,
          reason,
          message: this.opponentLeftMessage("Host", reason),
        });
      }
      this.log.info(`room ${room.code} removed (${reason})`);
      return;
    }

    if (room.guest === socket) {
      room.guest = null;
      this.touchRoom(room);
      if (this.socketOpen(room.host)) {
        sendJson(room.host, {
          type: "opponent-left",
          code: room.code,
          reason,
          message: this.opponentLeftMessage("Joiner", reason),
        });
      }
      this.log.info(`room ${room.code} joiner removed (${reason})`);
    }
  }

  opponentLeftMessage(role, reason) {
    if (reason === "heartbeat-timeout") {
      return `${role} timed out and disconnected.`;
    }
    if (reason === "room-expired" || reason === "expired") {
      return "Room expired.";
    }
    return `${role} disconnected from the room.`;
  }

  clearClientRoomState(socket) {
    const state = this.clients.get(socket);
    if (!state) {
      return;
    }
    state.roomCode = "";
    state.role = "";
    state.playerId = 0;
  }

  touchRoom(room, now = Date.now()) {
    room.updatedAt = now;
    room.expiresAt = now + this.config.roomTtlMs;
  }

  roomPlayerCount(room) {
    return Number(this.socketOpen(room.host)) + Number(this.socketOpen(room.guest));
  }

  purgeExpiredRooms(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (!this.socketOpen(room.host)) {
        this.expireRoom(room, "host-unavailable");
      } else if (room.expiresAt <= now) {
        this.expireRoom(room, "room-expired");
      }
    }
  }

  expireRoom(room, reason) {
    if (!room || !this.rooms.has(room.code)) {
      return;
    }
    this.rooms.delete(room.code);
    this.clearClientRoomState(room.host);
    this.clearClientRoomState(room.guest);
    if (this.socketOpen(room.host)) {
      sendJson(room.host, {
        type: "room-expired",
        code: room.code,
        reason,
        message: "Relay room expired. Create a new room.",
      });
    }
    if (this.socketOpen(room.guest)) {
      sendJson(room.guest, {
        type: "opponent-left",
        code: room.code,
        reason,
        message: reason === "host-unavailable" ? "Host disconnected from the room." : "Relay room expired.",
      });
    }
    this.log.info(`room ${room.code} expired (${reason})`);
  }

  sendHeartbeats(now = Date.now()) {
    this.sweepIdleClients(now);
    for (const socket of this.clients.keys()) {
      if (!this.socketOpen(socket)) {
        continue;
      }
      try {
        socket.ping();
      } catch (error) {
        this.log.debug(`heartbeat ping failed: ${error.message}`);
        this.removeClient(socket, "socket-error");
        socket.terminate();
      }
    }
  }

  sweepIdleClients(now = Date.now()) {
    for (const [socket, state] of this.clients.entries()) {
      if (now - state.lastSeenAt <= this.config.idleTimeoutMs) {
        continue;
      }
      sendJson(socket, {
        type: "error",
        error: "heartbeat-timeout",
        message: "Relay heartbeat timed out.",
      });
      this.removeClient(socket, "heartbeat-timeout");
      socket.terminate();
    }
  }

  roomFor(socket) {
    const state = this.clients.get(socket);
    if (!state || !state.roomCode) {
      return null;
    }
    return this.rooms.get(state.roomCode) || null;
  }

  clientSummary(socket) {
    const state = this.clients.get(socket) || {};
    return {
      client_id: Number(state.clientId) || 0,
      role: String(state.role || ""),
      player_id: Number(state.playerId) || 0,
      label: String(state.label || "Peer"),
    };
  }

  roomSummary(room) {
    return {
      code: room.code,
      players: {
        host: this.socketOpen(room.host) ? this.clientSummary(room.host) : null,
        join: this.socketOpen(room.guest) ? this.clientSummary(room.guest) : null,
      },
      created_unix: Math.floor(room.createdAt / 1000),
      updated_unix: Math.floor(room.updatedAt / 1000),
      expires_unix: Math.floor(room.expiresAt / 1000),
      metadata: room.metadata,
    };
  }

  socketOpen(socket) {
    return !!socket && socket.readyState === WebSocket.OPEN;
  }

  sendError(socket, error, message) {
    this.log.debug(`${error}: ${message}`);
    sendJson(socket, {
      type: "error",
      error,
      message,
    });
  }
}

function originAllowed(origin, config) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return config.allowNoOrigin;
  }
  return config.allowedOrigins.has("*") || config.allowedOrigins.has(normalized);
}

function createRelayServer(options = {}) {
  const config = loadConfig(options);
  const relay = new KeySparRelay(config);
  const httpServer = http.createServer((request, response) => {
    const requestPath = String(request.url || "/").split("?", 1)[0];
    if (requestPath === config.healthPath) {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        ok: true,
        service: "maestros-gambit-relay",
        rooms: relay.rooms.size,
        clients: relay.clients.size,
      }));
      return;
    }
    response.writeHead(426, { "content-type": "text/plain; charset=utf-8" });
    response.end("Maestro's Gambit relay expects a WebSocket upgrade.\n");
  });
  const wsServer = new WebSocket.Server({
    server: httpServer,
    path: config.path,
    maxPayload: config.maxMessageBytes,
    perMessageDeflate: false,
    verifyClient: (info, done) => {
      if (originAllowed(info.origin, config)) {
        done(true);
      } else {
        relay.log.warn(`rejected WebSocket origin ${info.origin || "(none)"}`);
        done(false, 403, "Origin not allowed.");
      }
    },
  });
  relay.attach(wsServer);

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      relay.close();
      reject(error);
    };
    httpServer.once("error", fail);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off("error", fail);
      const address = httpServer.address();
      resolve({
        server: wsServer,
        httpServer,
        relay,
        config,
        host: config.host,
        port: address.port,
        close: () => new Promise((done) => {
          relay.close();
          for (const socket of wsServer.clients) {
            socket.terminate();
          }
          wsServer.close(() => httpServer.close(done));
        }),
      });
    });
  });
}

if (require.main === module) {
  let activeServer;
  createRelayServer()
    .then((instance) => {
      activeServer = instance;
      const publicHost = instance.host === "0.0.0.0" ? "localhost" : instance.host;
      console.log(`Maestro's Gambit relay listening on ws://${publicHost}:${instance.port}${instance.config.path}`);
      console.log(`Health check: http://${publicHost}:${instance.port}${instance.config.healthPath}`);
    })
    .catch((error) => {
      console.error(`Maestro's Gambit relay failed: ${error.message}`);
      process.exit(1);
    });

  const shutdown = async (signal) => {
    console.log(`Maestro's Gambit relay received ${signal}; shutting down.`);
    if (activeServer) {
      await activeServer.close();
    }
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

module.exports = {
  KeySparRelay,
  createRelayServer,
  generateRoomCode,
  isValidRoomCode,
  loadConfig,
  normalizeRoomCode,
  originAllowed,
  validateMessage,
};
