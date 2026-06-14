#!/usr/bin/env node
"use strict";

const WebSocket = require("ws");
const { isValidRoomCode } = require("./relay_server");

const RELAY_URL = String(process.env.MG_RELAY_SMOKE_URL || "").trim();
const RELAY_ORIGIN = String(process.env.MG_RELAY_SMOKE_ORIGIN || "").trim();

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, RELAY_ORIGIN ? { origin: RELAY_ORIGIN } : {});
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket, predicate, label, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    function onMessage(data) {
      const message = JSON.parse(data.toString("utf8"));
      if (!predicate || predicate(message)) {
        cleanup();
        resolve(message);
      }
    }
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

function send(socket, message) {
  socket.send(JSON.stringify(message));
}

async function run() {
  if (!RELAY_URL.startsWith("ws://") && !RELAY_URL.startsWith("wss://")) {
    throw new Error("Set MG_RELAY_SMOKE_URL to an explicit ws:// or wss:// relay URL.");
  }
  const host = await connect(RELAY_URL);
  const join = await connect(RELAY_URL);
  try {
    const createdPending = nextMessage(host, (m) => m.type === "room-created", "room-created");
    send(host, { type: "create-room", host_label: "Remote Smoke Host", metadata: { remote_smoke: true } });
    const created = await createdPending;
    if (!isValidRoomCode(created.code)) {
      throw new Error(`Relay created invalid room code ${created.code}`);
    }

    const joinedPending = nextMessage(join, (m) => m.type === "room-joined", "room-joined");
    const peerPending = nextMessage(host, (m) => m.type === "peer-joined", "peer-joined");
    send(join, { type: "join-room", code: created.code, join_label: "Remote Smoke Join" });
    await Promise.all([joinedPending, peerPending]);

    const readyPending = nextMessage(host, (m) => m.type === "lobby-ready", "lobby-ready");
    send(join, { type: "lobby-ready", payload: { player_id: 2, ready: true, fighter_index: 5 } });
    await readyPending;

    const movePending = nextMessage(join, (m) => m.type === "game-message" && m.channel === "move", "move");
    send(host, { type: "game-message", channel: "move", payload: { from: 12, to: 28, promo: null } });
    await movePending;

    const leftPending = nextMessage(host, (m) => m.type === "opponent-left", "opponent-left");
    join.close();
    await leftPending;
    console.log(`REMOTE RELAY SMOKE OK: ${RELAY_URL}`);
  } finally {
    join.close();
    host.close();
  }
}

run().catch((error) => {
  console.error(`REMOTE RELAY SMOKE FAILED: ${error.message}`);
  process.exit(1);
});
