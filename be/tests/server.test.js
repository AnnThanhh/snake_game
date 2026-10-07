import './fixtures/configure.js';
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import http from "node:http";
import WebSocket from "ws";
import { createGameServer } from "../server/index.js";

async function fixture(t, options = {}) {
  const game = createGameServer({ port: 0, ...options });
  const address = await game.listen();
  const url = `http://127.0.0.1:${address.port}`;
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.ws.terminate();
    await game.close();
  });
  async function connect() {
    const ws = new WebSocket(url.replace("http:", "ws:") + "/ws");
    const queue = [];
    const waiters = [];
    ws.on("message", (raw) => {
      const data = JSON.parse(raw.toString());
      const at = waiters.findIndex((item) => item.predicate(data));
      if (at !== -1) {
        const [waiter] = waiters.splice(at, 1);
        clearTimeout(waiter.timeout);
        waiter.resolve(data);
      } else queue.push(data);
    });
    const client = {
      ws,
      send(data) {
        ws.send(JSON.stringify(data));
      },
      next(type, predicate = () => true) {
        const match = (data) => data.type === type && predicate(data);
        const at = queue.findIndex(match);
        if (at !== -1) return Promise.resolve(queue.splice(at, 1)[0]);
        return new Promise((resolve, reject) => {
          const waiter = { predicate: match, resolve };
          waiter.timeout = setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            reject(new Error(`Timed out waiting for ${type}`));
          }, 3000);
          waiters.push(waiter);
        });
      },
    };
    clients.push(client);
    await once(ws, "open");
    return client;
  }
  return { game, url, connect };
}

async function until(predicate, timeout = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("Condition timed out");
    await delay(10);
  }
}

test(
  "two clients share a ready lobby, authoritative simulation and validated controls",
  { timeout: 10_000 },
  async (t) => {
    const { game, url, connect } = await fixture(t);
    const first = await connect();
    first.send({
      type: "create",
      name: "Integration grove",
      playerName: "One",
      species: "cobra",
    });
    const welcome1 = await first.next("welcome");
    assert.equal(welcome1.room.maxPlayers, 4);
    assert.equal(welcome1.room.state, "lobby");
    assert.match(welcome1.token, /^[a-f0-9]{64}$/);
    const second = await connect();
    second.send({
      type: "join",
      code: welcome1.room.code.toLowerCase(),
      playerName: "Two",
      species: "viper",
    });
    const welcome2 = await second.next("welcome");
    assert.notEqual(welcome1.playerId, welcome2.playerId);
    await first.next("lobby", (data) => data.players.length === 2);
    const room = game.rooms.get(welcome1.room.id);
    assert.equal(room.world.time, 0, "lobby does not simulate");
    first.send({ type: "ready", ready: true });
    await first.next("lobby", (data) =>
      data.players.some(
        (player) => player.id === welcome1.playerId && player.ready,
      ),
    );
    assert.equal(
      room.state,
      "lobby",
      "one ready player cannot start past another unready player",
    );
    second.send({ type: "ready", ready: true });
    await Promise.all([first.next("started"), second.next("started")]);
    const snapshot = await second.next(
      "snapshot",
      (data) => data.snapshot.time > 0,
    );
    assert.equal(snapshot.snapshot.players.length, 2);
    assert.equal(room.state, "playing");
    first.send({
      type: "input",
      angle: null,
      throttle: 1,
      dash: false,
      pulse: false,
    });
    await first.next("error", (data) => data.message.includes("điều khiển"));
    assert.equal(room.inputs[welcome1.playerId], undefined);
    first.send({
      type: "input",
      angle: 1,
      throttle: 500,
      dash: false,
      pulse: false,
      score: 999_999,
      hp: 999_999,
    });
    await until(() => room.inputs[welcome1.playerId]?.angle === 1);
    assert.equal(
      room.inputs[welcome1.playerId].throttle,
      1,
      "throttle is clamped by the server",
    );
    const authoritative = await first.next(
      "snapshot",
      (data) => data.snapshot.time > snapshot.snapshot.time,
    );
    const player = authoritative.snapshot.players.find(
      (item) => item.id === welcome1.playerId,
    );
    assert.ok(player.score < 999_999, "a client cannot supply its own score");
    assert.ok(
      player.hp <= player.maxHp,
      "a client cannot supply its own health",
    );
    first.send({ type: "upgrade", id: "arbitrary-upgrade" });
    await first.next("error", (data) => data.message.includes("Nâng cấp"));
    const directory = await (await fetch(url + "/api/rooms")).json();
    assert.equal(directory.online, 2);
    assert.equal(directory.rooms[0].players, 2);
    assert.equal(directory.rooms[0].state, "playing");
    const outsider = await connect();
    outsider.send({
      type: "join",
      code: welcome1.room.code,
      playerName: "Late",
    });
    await outsider.next("error", (data) => data.message.includes("bắt đầu"));
  },
);

test(
  "reconnect reserves an opaque identity while the disconnected snake remains in simulation",
  { timeout: 10_000 },
  async (t) => {
    const { game, connect } = await fixture(t);
    const client = await connect();
    client.send({ type: "quick", playerName: "Reconnect", species: "python" });
    const welcome = await client.next("welcome");
    client.send({ type: "ready", ready: true });
    await client.next("started");
    const room = game.rooms.get(welcome.room.id);
    client.ws.terminate();
    await until(() => !room.members.get(welcome.playerId).ws);
    const time = room.world.time;
    await until(() => room.world.time > time);
    assert.equal(
      room.world.players.length,
      1,
      "disconnected player is not removed from active world",
    );
    assert.equal(room.inputs[welcome.playerId].throttle, 0);
    assert.equal(room.members.size, 1, "slot stays reserved");
    const player = room.world.players[0];
    const hp = player.hp;
    room.world.foods = [];
    player.invulnerable = 0;
    room.world.projectiles.push({
      id: "disconnect-hit",
      x: player.x,
      y: player.y,
      vx: 0,
      vy: 0,
      radius: 30,
      damage: 20,
      life: 2,
      team: "enemy",
    });
    await until(() => player.hp < hp);
    const restored = await connect();
    restored.send({ type: "resume", token: welcome.token });
    const resumed = await restored.next("welcome");
    assert.equal(resumed.playerId, welcome.playerId);
    assert.equal(resumed.room.id, welcome.room.id);
    assert.equal(
      resumed.snapshot.players.length,
      1,
      "resume does not duplicate snake",
    );
    assert.ok(resumed.snapshot.time >= time);
    assert.ok(
      resumed.snapshot.players[0].hp < hp,
      "damage taken during disconnect persists",
    );
    assert.ok(
      resumed.snapshot.players[0].invulnerable <= 0.38,
      "resume never grants spawn invulnerability",
    );
    await restored.next("started");
    restored.send({ type: "leave" });
    await once(restored.ws, "close");
    assert.equal(game.rooms.size, 0, "explicit leave releases the last slot");
  },
);

test(
  "an unready player leaving starts the remaining ready lobby",
  { timeout: 10_000 },
  async (t) => {
    const { game, connect } = await fixture(t);
    const first = await connect();
    first.send({ type: "create", playerName: "Ready player" });
    const welcome = await first.next("welcome");
    const second = await connect();
    second.send({
      type: "join",
      code: welcome.room.code,
      playerName: "Leaving player",
    });
    await second.next("welcome");
    first.send({ type: "ready", ready: true });
    await first.next(
      "lobby",
      (data) =>
        data.players.length === 2 &&
        data.players.find((player) => player.id === welcome.playerId).ready,
    );
    const room = game.rooms.get(welcome.room.id);
    assert.equal(room.state, "lobby");
    second.send({ type: "leave" });
    await first.next("started");
    assert.equal(room.state, "playing");
    assert.equal(room.members.size, 1);
    assert.equal(room.world.players[0].id, welcome.playerId);
  },
);

test(
  "expired reservations are cleaned and cannot reconnect",
  { timeout: 10_000 },
  async (t) => {
    const { game, connect } = await fixture(t, {
      reconnectMs: 70,
      maintenanceIntervalMs: 20,
    });
    const first = await connect();
    first.send({ type: "create", playerName: "Expiring" });
    const welcome = await first.next("welcome");
    first.ws.terminate();
    await until(() => game.rooms.size === 0);
    const late = await connect();
    late.send({ type: "resume", token: welcome.token });
    await late.next("error", (data) => data.message.includes("hết hạn"));
  },
);

test(
  "room capacity, invalid JSON and message rate limits are enforced",
  { timeout: 10_000 },
  async (t) => {
    const { game, connect } = await fixture(t);
    let code;
    for (let i = 0; i < 4; i += 1) {
      const client = await connect();
      client.send({
        type: i ? "join" : "create",
        code,
        playerName: `Player ${i}`,
      });
      const welcome = await client.next("welcome");
      code = welcome.room.code;
    }
    const fifth = await connect();
    fifth.send({ type: "join", code, playerName: "Fifth" });
    await fifth.next("error", (data) => data.message.includes("đủ 4"));
    assert.equal([...game.rooms.values()][0].members.size, 4);
    fifth.ws.send("{broken json");
    await fifth.next("error", (data) => data.message.includes("JSON"));
    const closed = once(fifth.ws, "close");
    for (let i = 0; i < 45; i += 1) fifth.send({ type: "ping", at: i });
    const [codeClosed] = await closed;
    assert.equal(
      codeClosed,
      1008,
      "sustained protocol abuse disconnects client",
    );
  },
);

test(
  "backend exposes APIs only and rejects unrelated websocket origins",
  { timeout: 10_000 },
  async (t) => {
    const { url } = await fixture(t);
    const health = await fetch(url + "/api/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).roomCapacity, 4);
    const shared = await fetch(url + "/shared/engine.js");
    assert.equal(shared.status, 404);
    assert.equal((await fetch(url + '/')).status, 404);
    for (const filename of [
      "/instruction.md",
      "/package.json",
      "/server/index.js",
      "/.git/config",
      "/shared/%2e%2e%2finstruction.md",
      "/shared/%2e%2e%5cserver%5cindex.js",
    ]) {
      assert.equal(
        (await fetch(url + filename)).status,
        404,
        `${filename} must not be served`,
      );
    }
    assert.equal(
      (await fetch(url + "/api/rooms", { method: "POST" })).status,
      405,
    );
    const ws = new WebSocket(url.replace("http:", "ws:") + "/ws", {
      origin: "https://unrelated.example",
    });
    ws.on("error", () => {});
    const [, response] = await once(ws, "unexpected-response");
    assert.equal(response.statusCode, 403);
    response.resume();
    ws.terminate();
  },
);

async function presenceHeartbeat(url, clientId, state = "menu", headers = {}) {
  return fetch(url + "/api/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ clientId, state }),
  });
}

test(
  "anonymous presence deduplicates joined players while room counts remain authoritative",
  { timeout: 10_000 },
  async (t) => {
    const { game, url, connect } = await fixture(t);
    const menuId = "11111111-1111-4111-8111-111111111111";
    const playerPresenceId = "22222222-2222-4222-8222-222222222222";
    const directory = async () => (await fetch(url + "/api/rooms")).json();
    assert.equal((await presenceHeartbeat(url, menuId)).status, 200);
    assert.equal(
      (await presenceHeartbeat(url, playerPresenceId, "game")).status,
      200,
    );
    let listing = await directory();
    assert.equal(listing.online, 2);
    assert.equal(
      listing.inGame,
      0,
      "a browser cannot report itself into an authoritative match",
    );
    assert.equal(listing.waiting, 0);
    const first = await connect();
    first.send({
      type: "create",
      playerName: "With presence",
      presenceId: playerPresenceId,
    });
    const welcome = await first.next("welcome");
    listing = await directory();
    assert.equal(
      listing.online,
      2,
      "same browser heartbeat and joined member count once",
    );
    assert.equal(listing.waiting, 1);
    assert.equal(listing.rooms[0].connectedPlayers, 1);
    assert.equal(listing.rooms[0].reservedSlots, 0);
    assert.equal(listing.rooms[0].joinable, true);
    assert.equal(listing.rooms[0].map, "The Overgrowth");
    assert.equal(listing.rooms[0].elapsed, 0);
    assert.ok(["HEALTHY", "DEGRADED"].includes(listing.rooms[0].health));
    assert.ok(!JSON.stringify(listing).includes(menuId));
    assert.ok(
      !JSON.stringify(listing).includes(playerPresenceId),
      "directory never exposes anonymous IDs",
    );
    const legacy = await connect();
    legacy.send({
      type: "join",
      code: welcome.room.code,
      playerName: "Legacy client",
    });
    const legacyWelcome = await legacy.next("welcome");
    listing = await directory();
    assert.equal(
      listing.online,
      3,
      "clients without presence IDs retain the member-ID fallback",
    );
    assert.equal(listing.waiting, 2);
    first.send({ type: "ready", ready: true });
    legacy.send({ type: "ready", ready: true });
    await first.next("started");
    await first.next("snapshot", (data) => data.snapshot.time > 0);
    listing = await directory();
    assert.equal(listing.inGame, 2);
    assert.equal(listing.waiting, 0);
    assert.equal(listing.rooms[0].joinable, false);
    assert.ok(listing.rooms[0].elapsed > 0);
    legacy.ws.terminate();
    const room = game.rooms.get(welcome.room.id);
    await until(() => !room.members.get(legacyWelcome.playerId).ws);
    listing = await directory();
    assert.equal(
      listing.online,
      2,
      "an offline reservation alone never counts as online",
    );
    assert.equal(listing.inGame, 1);
    assert.equal(listing.reserved, 1);
    assert.equal(listing.rooms[0].players, 2);
    assert.equal(listing.rooms[0].connectedPlayers, 1);
    assert.equal(listing.rooms[0].reservedSlots, 1);
    const health = await (await fetch(url + "/api/health")).json();
    assert.equal(health.online, listing.online);
    assert.equal(health.inGame, listing.inGame);
    assert.equal(health.reserved, listing.reserved);
  },
);

test(
  "presence expires, stays bounded and rejects invalid, oversized or cross-origin requests",
  { timeout: 10_000 },
  async (t) => {
    const { url, connect } = await fixture(t, {
      presenceTtlMs: 250,
      maintenanceIntervalMs: 10_000,
      maxPresence: 2,
    });
    const one = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const two = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const three = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    assert.equal(
      (await presenceHeartbeat(url, one, "menu", { Origin: url })).status,
      200,
    );
    assert.equal((await presenceHeartbeat(url, two, "lobby")).status, 200);
    assert.equal(
      (await presenceHeartbeat(url, three)).status,
      503,
      "map capacity is enforced",
    );
    assert.equal(
      (await presenceHeartbeat(url, one, "game")).status,
      200,
      "existing IDs can refresh at capacity",
    );
    for (const body of [
      { clientId: "short", state: "menu" },
      { clientId: one, state: "spectator" },
      { clientId: one, state: "menu", score: 99 },
      null,
    ]) {
      assert.equal(
        (
          await fetch(url + "/api/presence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await presenceHeartbeat(url, one, "menu", {
          Origin: "https://unrelated.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(url + "/api/presence", { method: "POST", body: "{}" }))
        .status,
      415,
    );
    assert.equal((await fetch(url + "/api/presence")).status, 405);
    assert.equal(
      (
        await fetch(url + "/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "x".repeat(1025),
        })
      ).status,
      413,
    );
    const streamedStatus = await new Promise((resolve, reject) => {
      const request = http.request(
        url + "/api/presence",
        { method: "POST", headers: { "Content-Type": "application/json" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.write("x".repeat(600));
      request.end("x".repeat(600));
    });
    assert.equal(
      streamedStatus,
      413,
      "streamed payloads cannot bypass the body bound",
    );
    const invalid = await connect();
    invalid.send({ type: "create", presenceId: "invalid" });
    await invalid.next("error", (data) => data.message.includes("hiện diện"));
    assert.equal(
      (await (await fetch(url + "/api/rooms")).json()).rooms.length,
      0,
    );
    await delay(280);
    assert.equal(
      (await (await fetch(url + "/api/rooms")).json()).online,
      0,
      "reads exclude expired IDs even before maintenance",
    );
    assert.equal(
      (await presenceHeartbeat(url, three)).status,
      200,
      "expired entries free capacity",
    );
  },
);

test(
  "connected members survive heartbeat expiry and reconnect can update their presence mapping",
  { timeout: 10_000 },
  async (t) => {
    const { game, url, connect } = await fixture(t, { presenceTtlMs: 80 });
    const oldId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const newId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await presenceHeartbeat(url, oldId);
    const first = await connect();
    first.send({ type: "quick", presenceId: oldId });
    const welcome = await first.next("welcome");
    await delay(100);
    let listing = await (await fetch(url + "/api/rooms")).json();
    assert.equal(
      listing.online,
      1,
      "live socket remains online after browser heartbeat expiry",
    );
    first.ws.terminate();
    const room = game.rooms.get(welcome.room.id);
    await until(() => !room.members.get(welcome.playerId).ws);
    listing = await (await fetch(url + "/api/rooms")).json();
    assert.equal(listing.online, 0);
    assert.equal(listing.reserved, 1);
    await presenceHeartbeat(url, newId);
    const resumed = await connect();
    resumed.send({ type: "resume", token: welcome.token, presenceId: newId });
    assert.equal((await resumed.next("welcome")).playerId, welcome.playerId);
    listing = await (await fetch(url + "/api/rooms")).json();
    assert.equal(
      listing.online,
      1,
      "resumed socket deduplicates against its new browser presence",
    );
    assert.equal(listing.reserved, 0);
    assert.equal(listing.waiting, 1);
  },
);

test(
  "health and snapshots report measured tick windows and actual overload events",
  { timeout: 10_000 },
  async (t) => {
    const { url, connect } = await fixture(t);
    const client = await connect();
    client.send({ type: "create" });
    const welcome = await client.next("welcome");
    assert.equal(
      welcome.telemetry.tickRate,
      0,
      "startup does not invent a measured tick rate",
    );
    client.send({ type: "ready", ready: true });
    await client.next("started");
    const measured = await client.next(
      "snapshot",
      (data) => data.telemetry?.tickRate > 0,
    );
    for (const key of ["tickRate", "tickMs", "overloadCount"])
      assert.ok(Number.isFinite(measured.telemetry[key]), `${key} is finite`);
    assert.ok(
      measured.telemetry.tickRate > 10 && measured.telemetry.tickRate < 50,
    );
    assert.ok(measured.telemetry.tickMs >= 0);
    const health = await (await fetch(url + "/api/health")).json();
    assert.equal(health.targetTickRate, 30);
    assert.equal(health.tickRate, measured.telemetry.tickRate);
    assert.equal(health.tickMs, measured.telemetry.tickMs);
    // A short controlled event-loop stall verifies that overload is measured,
    // rather than a constant badge or synthetic counter.
    const blockedUntil = performance.now() + 220;
    while (performance.now() < blockedUntil) {}
    const overloaded = await client.next(
      "snapshot",
      (data) =>
        data.telemetry?.overloadCount > measured.telemetry.overloadCount,
    );
    assert.equal(overloaded.telemetry.state, "DEGRADED");
    assert.ok(overloaded.telemetry.tickRate < 30);
    const listing = await (await fetch(url + "/api/rooms")).json();
    assert.equal(listing.rooms[0].health, "DEGRADED");
  },
);
