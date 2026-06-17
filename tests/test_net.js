#!/usr/bin/env node
"use strict";

/* End-to-end online test: two clients play a full game THROUGH the real relay,
   speaking the exact protocol js/net.js speaks, each running its own js/chess.js
   engine. Verifies room create/join, colour assignment, move payload shape, the
   legalMoves()-based move reconstruction (same logic as App.drainRemote), and
   that both engines stay in perfect sync to an identical checkmate. Also checks
   a `control` (resign) message forwards.

   Run:  node tests/test_net.js     (uses the vendored ws in server/relay)  */

const assert = require("assert/strict");
const path = require("path");

const { Chess } = require(path.join(__dirname, "..", "js", "chess.js"));
const relayDir = path.join(__dirname, "..", "server", "relay");
const WebSocket = require(path.join(relayDir, "node_modules", "ws"));
const { createRelayServer } = require(path.join(relayDir, "relay_server.js"));

const other = (c) => (c === "w" ? "b" : "w");
const send = (ws, msg) => ws.send(JSON.stringify(msg));

// Scholar's mate. Plain SAN (no +/# suffix, matching Chess.toSAN()).
const SCRIPT = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7"];

// The exact move-reconstruction App.drainRemote() uses on an inbound payload.
function findRemote(game, p) {
  return game.legalMoves().find((x) =>
    x.from === p.from && x.to === p.to && (!x.promo || x.promo === (p.promo || "Q")));
}

function makeClient(url, role) {
  const client = { role, color: null, game: new Chess(), ws: new WebSocket(url) };

  // Play our next scripted move if it's our turn; returns true if a move was sent.
  client.maybeMove = () => {
    if (client.game.status() !== "active") return false;
    const ply = client.game.history.length;
    if (ply >= SCRIPT.length || client.game.turn !== client.color) return false;
    const m = client.game.legalMoves().find((x) => client.game.toSAN(x) === SCRIPT[ply]);
    assert.ok(m, `client ${role}: no legal move for ${SCRIPT[ply]} at ply ${ply}`);
    client.game.move(m);
    send(client.ws, { type: "game-message", channel: "move",
      payload: { from: m.from, to: m.to, promo: m.promo || null } });
    return true;
  };

  return client;
}

async function run() {
  const instance = await createRelayServer({ host: "127.0.0.1", port: 0, logLevel: "silent" });
  const url = `ws://127.0.0.1:${instance.port}/`;

  const host = makeClient(url, "host");
  const join = makeClient(url, "join");
  let resolveDone, rejectDone;
  const done = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
  const timer = setTimeout(() => rejectDone(new Error("net test timed out")), 4000);

  // After the host moves, if that delivered mate, fire a control message too —
  // proves the `control` channel forwards (belt and suspenders).
  const hostMaybeControl = () => {
    if (host.game.status() === "checkmate" && !host.sentControl) {
      host.sentControl = true;
      send(host.ws, { type: "game-message", channel: "control", payload: { action: "resign" } });
    }
  };

  const onMove = (client) => (payload) => {
    const m = findRemote(client.game, payload);
    assert.ok(m, `client ${client.role}: could not reconstruct remote move ${JSON.stringify(payload)}`);
    client.game.move(m);
    client.maybeMove();
    if (client.role === "host") hostMaybeControl();
  };

  const wire = (client, onStart) => {
    client.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString("utf8"));
      switch (msg.type) {
        case "room-created":
          host.code = msg.code;
          send(join.ws, { type: "join-room", code: msg.code, join_label: "Ebony" });
          break;
        case "peer-joined":
          // host opens the match as Ivory (white), like Net.startMatchAsHost
          host.color = "w";
          send(host.ws, { type: "start-match", config: { hostColor: "w" } });
          host.maybeMove(); // white plays the first move
          break;
        case "start-match":
          onStart(msg);
          break;
        case "game-message":
          if (msg.channel === "move") onMove(client)(msg.payload);
          else if (msg.channel === "control") client.gotControl = msg.payload;
          break;
        default: break;
      }
    });
    client.ws.on("error", rejectDone);
  };

  wire(host, () => {});
  wire(join, (msg) => {
    join.color = other(msg.config.hostColor);
    join.maybeMove(); // no-op (white's turn), but mirrors client behaviour
  });

  host.ws.on("open", () => send(host.ws, { type: "create-room", host_label: "Ivory" }));

  // Poll for both engines reaching checkmate + the forwarded control message.
  const poll = setInterval(() => {
    if (host.game.status() === "checkmate" && join.game.status() === "checkmate" && join.gotControl) {
      clearInterval(poll);
      resolveDone();
    }
  }, 10);

  try {
    await done;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }

  // Assertions: colours, sync, identical mated position, control forwarded.
  assert.equal(host.color, "w");
  assert.equal(join.color, "b");
  assert.equal(host.game.status(), "checkmate");
  assert.equal(join.game.status(), "checkmate");
  assert.equal(host.game.posKey(), join.game.posKey(), "both engines must agree on the final position");
  assert.equal(host.game.sanHistory.join(" "), join.game.sanHistory.join(" "));
  assert.equal(host.game.sanHistory[host.game.sanHistory.length - 1], "Qxf7#");
  assert.equal(join.gotControl.action, "resign");

  host.ws.close();
  join.ws.close();
  await instance.close();
}

run().then(
  () => { console.log("NET TEST OK — both engines mated in sync via the relay"); process.exit(0); },
  (err) => { console.error("NET TEST FAILED:", err.message); process.exit(1); }
);
