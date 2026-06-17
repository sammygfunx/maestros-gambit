# Maestro's Gambit — Online Relay

A tiny, hardened WebSocket **relay** that lets two players find each other with a
short room code and pass chess moves back and forth over the internet. It is the
only server piece the game needs; the game itself stays pure HTML/JS/Canvas with
no build step.

The relay does **not** run any chess logic. Both browsers run the same
deterministic engine (`js/chess.js`); the relay just forwards each move and a few
control messages (resign / rematch) to the other player in the same room.

## Run it locally

```sh
cd server/relay
npm install        # ws is already vendored, but this refreshes it
npm run smoke      # self-test: prints "RELAY SMOKE OK"
npm start          # ws://127.0.0.1:8911/  (health: http://127.0.0.1:8911/healthz)
```

Then, in the game's **Online Duel → Server** field, enter `ws://127.0.0.1:8911/`
on both machines (same LAN), Host on one, Join on the other.

## Deploy it free (Render)

This is the easiest way to play with a friend on a different network.

1. The repo is already on GitHub at <https://github.com/sammygfunx/maestros-gambit>.
2. On <https://render.com>, create a **Web Service** from the repo.
3. **Root Directory:** `server/relay`
4. **Runtime:** Node · **Build:** `npm ci --omit=dev` · **Start:** `node relay_server.js`
5. Add env var `MG_RELAY_HOST=0.0.0.0` (do **not** set `MG_RELAY_PORT`; Render injects `PORT`).
6. **Health Check Path:** `/healthz`
7. Keep it at **one** instance (rooms live in memory; a second instance can't see them).
8. Deploy. Your relay URL is `wss://YOUR-SERVICE.onrender.com/`.

Verify it:

```sh
curl https://YOUR-SERVICE.onrender.com/healthz
MG_RELAY_SMOKE_URL=wss://YOUR-SERVICE.onrender.com/ npm run smoke:remote
```

Render's free tier sleeps after ~15 min idle and takes ~30–60 s to wake, so open
the `/healthz` URL once before a session. For zero-config play, paste your
`wss://…` URL into `DEFAULT_RELAY_URL` at the top of `js/net.js` — then players
just click **Host** / **Join** with nothing to type.

A `Dockerfile` is included if you prefer a container host (Railway, Fly, etc.).

## Configuration (env vars)

All optional; sensible defaults shown.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MG_RELAY_HOST` | `127.0.0.1` | Bind host. Use `0.0.0.0` on a public host. |
| `MG_RELAY_PORT` | `PORT` or `8911` | Listen port. Managed hosts inject `PORT`. |
| `MG_RELAY_PATH` | `/` | WebSocket path. |
| `MG_RELAY_HEALTH_PATH` | `/healthz` | HTTP health-check path. |
| `MG_RELAY_ALLOWED_ORIGINS` | `*` | Comma-separated exact browser origins. Set to your game's HTTPS origin for a public deploy. |
| `MG_RELAY_ALLOW_NO_ORIGIN` | `true` | Allow non-browser clients (curl/smoke). |
| `MG_RELAY_ROOM_TTL_SECONDS` | `3600` | Inactivity TTL, refreshed by activity. |
| `MG_RELAY_IDLE_TIMEOUT_SECONDS` | `120` | Drop a client that stops responding to heartbeats. |
| `MG_RELAY_MAX_ROOMS` | `500` | Max simultaneous rooms. |
| `MG_RELAY_MAX_MESSAGE_BYTES` | `262144` | Max message size. |
| `MG_RELAY_LOG_LEVEL` | `info` | `silent`/`error`/`warn`/`info`/`debug`. |

## Protocol (summary)

JSON text messages, two players per room. Client → relay:

- `create-room` → relay replies `room-created` with a 5-letter `code`.
- `join-room {code}` → relay replies `room-joined`; host gets `peer-joined`.
- `start-match {config}` → host → joiner (carries who plays Ivory + match options).
- `game-message {channel, payload}` → forwarded to the other player.
  - channel `move`: `{from, to, promo}` (square indices 0–63).
  - channel `control`: `{action}` — `resign`, `rematch`, `rematch-request`.
- `ping` / `pong` for latency.

Relay → client also includes `opponent-left`, `room-expired`, and `error`.

## Limits (this is a test relay, not a service)

In-memory rooms (cleared on restart), no accounts, no matchmaking, no
reconnect/resume, no anti-cheat. One process only. Good enough for friends to
play; not a production multiplayer backend.
