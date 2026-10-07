import './fixtures/configure.js';
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { createGameServer } from "../server/index.js";
import { getSnapshot } from "../game/engine.js";
import { applyFrame } from "../game/network.js";

async function fixture(t, options = {}) {
  const game = createGameServer({ port: 0, ...options });
  const { port } = await game.listen();
  const url = `http://127.0.0.1:${port}`;
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.ws.terminate();
    await game.close();
  });
  async function connect() {
    const ws = new WebSocket(url.replace("http:", "ws:") + "/ws");
    const queue = [],
      waiters = [];
    const client = { ws, decoded: null, received: [], decodeErrors: [] };
    ws.on("message", (raw) => {
      const data = JSON.parse(raw.toString());
      data.bytes = raw.length;
      if (data.frame) {
        try {
          client.decoded = applyFrame(client.decoded, data.frame);
          data.decoded = client.decoded;
        } catch (error) {
          client.decodeErrors.push(error);
        }
      }
      client.received.push(data);
      const at = waiters.findIndex((waiter) => waiter.match(data));
      if (at >= 0) {
        const [waiter] = waiters.splice(at, 1);
        clearTimeout(waiter.timeout);
        waiter.resolve(data);
      } else queue.push(data);
    });
    client.send = (data) => ws.send(JSON.stringify(data));
    client.next = (type, predicate = () => true, timeoutMs = 3500) => {
      const match = (data) => data.type === type && predicate(data);
      const at = queue.findIndex(match);
      if (at >= 0) return Promise.resolve(queue.splice(at, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve };
        waiter.timeout = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for ${type}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    };
    clients.push(client);
    await once(ws, "open");
    return client;
  }
  return { game, url, connect };
}

async function until(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 3000) throw new Error("Condition timed out");
    await delay(10);
  }
}

function standaloneFrame(data) {
  if (!data.frame) return false;
  try {
    return Boolean(applyFrame(null, data.frame));
  } catch {
    return false;
  }
}

test(
  "room capacity configuration is validated and applies to room/world/health",
  { timeout: 10_000 },
  async (t) => {
    for (const maxPlayers of [0, -1, 11, 4.5, "10", NaN, Infinity]) {
      assert.throws(
        () => createGameServer({ maxPlayers }),
        /integer between 1 and 10/,
      );
    }
    const { game, url, connect } = await fixture(t, { maxPlayers: 1 });
    const first = await connect();
    first.send({ type: "create" });
    const welcome = await first.next("welcome");
    assert.equal(welcome.room.maxPlayers, 1);
    const other = await connect();
    other.send({ type: "join", code: welcome.room.code });
    await other.next("error", (data) => data.message.includes("đủ 1"));
    assert.equal(game.rooms.get(welcome.room.id).world.players.length, 1);
    assert.equal(
      (await (await fetch(url + "/api/health")).json()).roomCapacity,
      1,
    );
    const listing = await (await fetch(url + "/api/rooms")).json();
    assert.equal(listing.rooms[0].maxPlayers, 1);
    assert.equal(listing.rooms[0].joinable, false);
  },
);

test(
  "ten real protocol-2 clients reconstruct authoritative frames within the prototype payload budget",
  { timeout: 15_000 },
  async (t) => {
    const { game, url, connect } = await fixture(t, {
      maxPlayers: 10,
      worldOptions: { seed: 20260918 },
    });
    const participants = [];
    let code, roomId;
    for (let i = 0; i < 10; i += 1) {
      const client = await connect();
      client.send({
        type: i === 0 ? "create" : "join",
        code,
        protocol: 2,
        playerName: `Network ${i}`,
        viewRadius: i === 0 ? -10 : i === 9 ? 99_999 : 1000,
      });
      const welcome = await client.next("welcome");
      assert.equal(welcome.protocol, 2);
      assert.equal(welcome.snapshot, undefined);
      assert.equal(welcome.ack, null);
      assert.ok(
        standaloneFrame(welcome),
        "initial frame can be decoded without a baseline",
      );
      assert.ok(
        welcome.decoded.snapshot.players.some(
          (player) => player.id === welcome.playerId,
        ),
      );
      assert.equal(welcome.room.maxPlayers, 10);
      participants.push({ client, welcome });
      code = welcome.room.code;
      roomId = welcome.room.id;
    }
    const room = game.rooms.get(roomId);
    assert.equal(room.world.players.length, 10);
    assert.equal(
      room.members.get(participants[0].welcome.playerId).ws.viewRadius,
      450,
    );
    assert.equal(
      room.members.get(participants[9].welcome.playerId).ws.viewRadius,
      1800,
    );
    const eleventh = await connect();
    eleventh.send({ type: "join", code, protocol: 2 });
    await eleventh.next("error", (data) => data.message.includes("đủ 10"));
    for (const { client } of participants)
      client.send({ type: "ready", ready: true });
    await Promise.all(participants.map(({ client }) => client.next("started")));
    for (const [i, { client }] of participants.entries())
      client.send({
        type: "input",
        seq: i + 1,
        angle: i * 0.3,
        throttle: 0,
        dash: false,
        pulse: false,
      });
    const frames = await Promise.all(
      participants.map(({ client }, i) =>
        client.next("snapshot", (data) => data.ack === i + 1),
      ),
    );
    const legacyBytes = Buffer.byteLength(
      JSON.stringify(getSnapshot(room.world)),
    );
    for (const [i, message] of frames.entries()) {
      assert.equal(
        message.decoded.snapshot.players.length,
        10,
        "all player summaries remain available for scoreboard/minimap",
      );
      const own = message.decoded.snapshot.players.find(
        (player) => player.id === participants[i].welcome.playerId,
      );
      assert.equal(
        own.segments.length,
        room.world.players.find((player) => player.id === own.id).segments
          .length,
      );
      assert.ok(Number.isFinite(own.x) && Number.isFinite(own.y));
      assert.ok(
        message.bytes < 64 * 1024,
        "normal ten-player fixture stays under 64 KiB per frame",
      );
      assert.ok(
        message.bytes < legacyBytes,
        "compact incremental frame is smaller than a complete JSON world",
      );
      assert.deepEqual(participants[i].client.decodeErrors, []);
    }
    const health = await (await fetch(url + "/api/health")).json();
    assert.equal(health.roomCapacity, 10);
    assert.equal(health.inGame, 10);
    const listing = await (await fetch(url + "/api/rooms")).json();
    assert.equal(listing.rooms[0].connectedPlayers, 10);
    assert.equal(listing.rooms[0].joinable, false);
  },
);

test(
  "sequenced inputs acknowledge actual ticks, stale input is ignored, and resync/reconnect reset wire baselines",
  { timeout: 15_000 },
  async (t) => {
    const { game, connect } = await fixture(t);
    const current = await connect();
    current.send({ type: "create", protocol: 2, viewRadius: 1000 });
    const welcome = await current.next("welcome");
    const legacy = await connect();
    legacy.send({ type: "join", code: welcome.room.code });
    const oldWelcome = await legacy.next("welcome");
    assert.ok(oldWelcome.snapshot);
    assert.equal(oldWelcome.frame, undefined);
    current.send({ type: "ready", ready: true });
    legacy.send({ type: "ready", ready: true });
    await current.next("started");
    current.send({
      type: "input",
      seq: 2,
      angle: 1,
      throttle: 0,
      viewRadius: 100_000,
    });
    current.send({ type: "input", seq: 1, angle: 2, throttle: 1 });
    const applied = await current.next("snapshot", (data) => data.ack === 2);
    assert.ok(applied.decoded.snapshot.time > 0);
    const room = game.rooms.get(welcome.room.id);
    assert.equal(room.inputs[welcome.playerId].angle, 1);
    assert.equal(room.members.get(welcome.playerId).ws.viewRadius, 1800);
    for (const seq of [-1, 2.5, Number.MAX_SAFE_INTEGER + 1, "3"]) {
      current.send({ type: "input", seq, angle: 2, throttle: 0 });
      await current.next("error", (data) =>
        data.message.includes("điều khiển"),
      );
    }
    current.send({
      type: "input",
      seq: 3,
      angle: 2,
      throttle: 0,
      viewRadius: null,
    });
    await current.next("error", (data) => data.message.includes("điều khiển"));
    assert.equal(room.inputs[welcome.playerId].angle, 1);
    legacy.send({ type: "input", angle: 0.5, throttle: 0 });
    await until(() => room.inputs[oldWelcome.playerId]?.angle === 0.5);
    const oldSnapshot = await legacy.next(
      "snapshot",
      (data) => data.snapshot.time > 0,
    );
    assert.equal(oldSnapshot.frame, undefined);
    assert.equal(oldSnapshot.ack, null);

    current.send({ type: "resync" });
    const resynced = await current.next(
      "snapshot",
      (data) => standaloneFrame(data) && data.frame.seq > applied.frame.seq,
    );
    assert.deepEqual(
      applyFrame(null, resynced.frame).snapshot,
      resynced.decoded.snapshot,
    );
    current.send({ type: "resync" });
    await current.next("error", (data) => data.message.includes("đồng bộ lại"));
    current.ws.terminate();
    await until(() => !room.members.get(welcome.playerId).ws);
    const restored = await connect();
    restored.send({ type: "resume", token: welcome.token, protocol: 2 });
    const resumed = await restored.next("welcome");
    assert.equal(resumed.playerId, welcome.playerId);
    assert.equal(resumed.ack, null);
    assert.ok(standaloneFrame(resumed));
    assert.equal(
      resumed.frame.seq,
      welcome.frame.seq,
      "a new connection starts a new wire sequence",
    );
    assert.equal(room.members.get(welcome.playerId).ws.viewRadius, 1000);
    restored.send({
      type: "input",
      seq: 0,
      angle: -1,
      throttle: 0,
      viewRadius: 10,
    });
    await restored.next("snapshot", (data) => data.ack === 0);
    assert.equal(room.inputs[welcome.playerId].angle, -1);
    assert.equal(room.members.get(welcome.playerId).ws.viewRadius, 450);
    assert.deepEqual(restored.decodeErrors, []);
  },
);

test(
  "protocol-2 connections receive a fresh full baseline at least every five seconds",
  { timeout: 10_000 },
  async (t) => {
    const { connect } = await fixture(t, { worldOptions: { seed: 58 } });
    const client = await connect();
    client.send({ type: "create", protocol: 2 });
    const welcome = await client.next("welcome");
    client.send({ type: "ready", ready: true });
    await client.next("started");
    const periodic = await client.next(
      "snapshot",
      (data) => standaloneFrame(data) && data.frame.seq > welcome.frame.seq,
      6500,
    );
    assert.ok(periodic.decoded.snapshot.time > 0);
    assert.deepEqual(
      applyFrame(null, periodic.frame).snapshot,
      periodic.decoded.snapshot,
    );
    assert.deepEqual(client.decodeErrors, []);
  },
);
