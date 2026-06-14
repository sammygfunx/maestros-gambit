#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const http = require("http");
const WebSocket = require("ws");
const { createRelayServer, isValidRoomCode, loadConfig } = require("./relay_server");

function connect(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function send(socket, message) {
  socket.send(typeof message === "string" ? message : JSON.stringify(message));
}

function nextMessage(socket, predicate, label, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    function onClose() {
      cleanup();
      reject(new Error(`Socket closed while waiting for ${label}`));
    }
    function onMessage(data) {
      let message;
      try {
        message = JSON.parse(data.toString("utf8"));
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (!predicate || predicate(message)) {
        cleanup();
        resolve(message);
      }
    }
    socket.on("message", onMessage);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

function sendAndWait(socket, message, predicate, label, timeoutMs) {
  const pending = nextMessage(socket, predicate, label, timeoutMs);
  send(socket, message);
  return pending;
}

function nextClose(socket, label, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      socket.off("close", onClose);
      socket.off("error", onError);
    }
    function onClose(code, reason) {
      cleanup();
      resolve({ code, reason: reason.toString("utf8") });
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    socket.on("close", onClose);
    socket.on("error", onError);
  });
}

function closeSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    socket.once("close", resolve);
    socket.close();
  });
}

async function waitFor(predicate, label, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

async function startRelay(options = {}) {
  return createRelayServer({
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    cleanupIntervalMs: 60 * 1000,
    heartbeatIntervalMs: 60 * 1000,
    idleTimeoutMs: 60 * 1000,
    ...options,
  });
}

function testEnvironmentConfig() {
  const config = loadConfig({}, {
    MG_RELAY_HOST: "0.0.0.0",
    MG_RELAY_PORT: "9000",
    MG_RELAY_ALLOWED_ORIGINS: "https://a.example, https://b.example/",
    MG_RELAY_MAX_ROOMS: "42",
    MG_RELAY_MAX_PLAYERS_PER_ROOM: "9",
    MG_RELAY_LOG_LEVEL: "debug",
  });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 9000);
  assert.deepEqual([...config.allowedOrigins], ["https://a.example", "https://b.example"]);
  assert.equal(config.maxRooms, 42);
  assert.equal(config.maxPlayersPerRoom, 2, "Current 1v1 relay must cap configured room players at two.");
  assert.equal(config.logLevel, "debug");
}

async function testProtocolValidationAndCleanup() {
  const relay = await startRelay();
  const url = `ws://127.0.0.1:${relay.port}`;
  const health = await getJson(`http://127.0.0.1:${relay.port}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  const host = await connect(url);
  const join = await connect(url);
  const extra = await connect(url);
  let replacement;
  let late;
  try {
    assert.equal((await sendAndWait(host, "{", (m) => m.error === "bad-json", "bad-json")).error, "bad-json");
    assert.equal((await sendAndWait(host, [], (m) => m.error === "bad-message", "bad-message")).error, "bad-message");
    assert.equal((await sendAndWait(host, { type: "mystery" }, (m) => m.error === "unknown-type", "unknown-type")).error, "unknown-type");
    assert.equal((await sendAndWait(host, { type: "join-room", code: "12" }, (m) => m.error === "bad-room-code", "bad room code")).error, "bad-room-code");
    assert.equal((await sendAndWait(host, { type: "create-room", code: "12345" }, (m) => m.error === "bad-room-code", "bad requested code")).error, "bad-room-code");

    const created = await sendAndWait(
      host,
      { type: "create-room", host_label: "Host P1", metadata: { smoke: true } },
      (m) => m.type === "room-created",
      "room-created",
    );
    assert.equal(isValidRoomCode(created.code), true, `Invalid room code ${created.code}`);

    const joinedPending = nextMessage(join, (m) => m.type === "room-joined" && m.code === created.code, "room-joined");
    const peerPending = nextMessage(host, (m) => m.type === "peer-joined" && m.code === created.code, "peer-joined");
    send(join, { type: "join-room", code: created.code, join_label: "Join P2" });
    await Promise.all([joinedPending, peerPending]);

    assert.equal((await sendAndWait(join, { type: "join-room", code: created.code }, (m) => m.error === "duplicate-join", "duplicate join")).error, "duplicate-join");
    assert.equal((await sendAndWait(extra, { type: "join-room", code: created.code }, (m) => m.error === "room-full", "room full")).error, "room-full");
    assert.equal((await sendAndWait(join, { type: "game-message", channel: "mystery", payload: {} }, (m) => m.error === "unknown-channel", "unknown channel")).error, "unknown-channel");
    assert.equal((await sendAndWait(join, { type: "start-match", config: {} }, (m) => m.error === "forbidden-message", "forbidden start")).error, "forbidden-message");

    const readyPending = nextMessage(host, (m) => m.type === "lobby-ready", "forwarded lobby-ready");
    send(join, { type: "lobby-ready", payload: { player_id: 2, fighter_index: 5, ready: true } });
    const forwardedReady = await readyPending;
    assert.equal(forwardedReady.payload.fighter_index, 5);

    const startPending = nextMessage(join, (m) => m.type === "start-match", "start-match");
    send(host, { type: "start-match", config: { online_room_code: created.code, start_delay_seconds: 0.1 } });
    assert.equal((await startPending).config.online_room_code, created.code);

    const movePending = nextMessage(host, (m) => m.type === "game-message" && m.channel === "move", "game-message move");
    send(join, { type: "game-message", channel: "move", payload: { from: 52, to: 36, promo: null } });
    assert.equal((await movePending).payload.to, 36);

    const controlPending = nextMessage(host, (m) => m.type === "game-message" && m.channel === "control", "game-message control");
    send(join, { type: "game-message", channel: "control", payload: { action: "resign" } });
    assert.equal((await controlPending).payload.action, "resign");

    const pingPending = nextMessage(join, (m) => m.type === "ping" && m.sent_msec === 123, "ping");
    send(host, { type: "ping", sent_msec: 123 });
    const ping = await pingPending;
    const pongPending = nextMessage(host, (m) => m.type === "pong" && m.sent_msec === 123, "pong");
    send(join, { type: "pong", sent_msec: ping.sent_msec });
    await pongPending;

    const firstLeft = nextMessage(host, (m) => m.type === "opponent-left", "first opponent-left");
    await closeSocket(join);
    await firstLeft;
    assert.equal(relay.relay.rooms.has(created.code), true, "Host room should remain available after joiner disconnect.");

    replacement = await connect(url);
    const replacementJoined = nextMessage(replacement, (m) => m.type === "room-joined", "replacement room-joined");
    const replacementPeer = nextMessage(host, (m) => m.type === "peer-joined", "replacement peer-joined");
    send(replacement, { type: "join-room", code: created.code, join_label: "Replacement P2" });
    await Promise.all([replacementJoined, replacementPeer]);

    const replacementLeft = nextMessage(host, (m) => m.type === "opponent-left", "replacement opponent-left");
    await closeSocket(replacement);
    replacement = null;
    await replacementLeft;
    await closeSocket(host);
    await waitFor(() => !relay.relay.rooms.has(created.code), "host disconnect cleanup");
    assert.equal(relay.relay.rooms.has(created.code), false, "Host disconnect should remove the room.");

    late = await connect(url);
    assert.equal((await sendAndWait(late, { type: "join-room", code: created.code }, (m) => m.error === "room-not-found", "room-not-found")).error, "room-not-found");
  } finally {
    await closeSocket(replacement);
    await closeSocket(late);
    await closeSocket(extra);
    await closeSocket(join);
    await closeSocket(host);
    await relay.close();
  }
}

async function testConfiguredCapacity() {
  const relay = await startRelay({ maxRooms: 1, maxPlayersPerRoom: 1 });
  const url = `ws://127.0.0.1:${relay.port}`;
  const host = await connect(url);
  const secondHost = await connect(url);
  const join = await connect(url);
  try {
    const created = await sendAndWait(host, { type: "create-room" }, (m) => m.type === "room-created", "capacity room-created");
    assert.equal((await sendAndWait(secondHost, { type: "create-room" }, (m) => m.error === "relay-full", "relay room capacity")).error, "relay-full");
    assert.equal((await sendAndWait(join, { type: "join-room", code: created.code }, (m) => m.error === "room-full", "configured room full")).error, "room-full");
  } finally {
    await closeSocket(join);
    await closeSocket(secondHost);
    await closeSocket(host);
    await relay.close();
  }
}

async function testHeartbeatTimeout() {
  const relay = await startRelay({ idleTimeoutMs: 25 });
  const url = `ws://127.0.0.1:${relay.port}`;
  const host = await connect(url);
  const join = await connect(url);
  try {
    const created = await sendAndWait(host, { type: "create-room" }, (m) => m.type === "room-created", "heartbeat room-created");
    const joinedPending = nextMessage(join, (m) => m.type === "room-joined", "heartbeat room-joined");
    const peerPending = nextMessage(host, (m) => m.type === "peer-joined", "heartbeat peer-joined");
    send(join, { type: "join-room", code: created.code });
    await Promise.all([joinedPending, peerPending]);

    const joinServerSocket = relay.relay.rooms.get(created.code).guest;
    relay.relay.clients.get(joinServerSocket).lastSeenAt = Date.now() - 1000;
    const opponentLeft = nextMessage(host, (m) => m.type === "opponent-left" && m.reason === "heartbeat-timeout", "heartbeat opponent-left");
    relay.relay.sweepIdleClients(Date.now());
    await opponentLeft;
    assert.equal(relay.relay.clients.has(joinServerSocket), false, "Timed-out client should be removed.");
    assert.equal(relay.relay.rooms.get(created.code).guest, null, "Timed-out joiner should be removed from the room.");
  } finally {
    await closeSocket(join);
    await closeSocket(host);
    await relay.close();
  }
}

async function testRoomTtl() {
  const relay = await startRelay({ roomTtlMs: 25 });
  const url = `ws://127.0.0.1:${relay.port}`;
  const host = await connect(url);
  try {
    const created = await sendAndWait(host, { type: "create-room" }, (m) => m.type === "room-created", "TTL room-created");
    const hostServerSocket = relay.relay.rooms.get(created.code).host;
    const expired = nextMessage(host, (m) => m.type === "room-expired", "room-expired");
    relay.relay.purgeExpiredRooms(Date.now() + 1000);
    await expired;
    assert.equal(relay.relay.rooms.size, 0, "Expired room should be deleted.");
    assert.equal(relay.relay.clients.get(hostServerSocket).roomCode, "", "Expired room should clear host state.");
    assert.equal(created.code.length, 5);
  } finally {
    await closeSocket(host);
    await relay.close();
  }
}

async function testOversizedMessageAndOrigins() {
  const relay = await startRelay({
    allowedOrigins: ["https://keyspar.example"],
    allowNoOrigin: false,
    maxMessageBytes: 256,
  });
  const url = `ws://127.0.0.1:${relay.port}`;
  await assert.rejects(connect(url), /403|Unexpected server response/, "Missing origin should be rejected.");
  const allowed = await connect(url, { origin: "https://keyspar.example" });
  try {
    const closed = nextClose(allowed, "oversized message close");
    send(allowed, { type: "create-room", metadata: { padding: "x".repeat(1000) } });
    assert.equal((await closed).code, 1009, "Oversized message should close with WebSocket code 1009.");
  } finally {
    await closeSocket(allowed);
    await relay.close();
  }
}

async function run() {
  testEnvironmentConfig();
  await testProtocolValidationAndCleanup();
  await testConfiguredCapacity();
  await testHeartbeatTimeout();
  await testRoomTtl();
  await testOversizedMessageAndOrigins();
  console.log("RELAY SMOKE OK");
}

run().catch((error) => {
  console.error(`RELAY SMOKE FAILED: ${error.stack || error.message}`);
  process.exit(1);
});
