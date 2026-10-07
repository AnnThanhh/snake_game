import './fixtures/configure.js';
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import {
  createWorld,
  addPlayer,
  stepWorld,
  chooseUpgrade,
  getSnapshot,
  respawnPlayer,
} from "../game/engine.js";
import { rarityWeights, rollRarity, resolveTraits } from "../game/builds.js";
import {
  createPathState,
  encodePathFrame,
  applyPathFrame,
} from "../game/path-network.js";
import { createWireState, encodeFrame } from "../game/network.js";
import { createBotDirector } from "../server/bots.js";
import { createGameServer } from "../server/index.js";

test("arena survives empty/all-dead worlds; respawn waits four seconds and resets the build", () => {
  const w = createWorld({ mode: "arena" });
  stepWorld(w, {}, 0.05);
  assert.equal(w.status, "playing");
  const p = addPlayer(w, { id: "p" });
  p.choices = ["fire"];
  chooseUpgrade(w, "p", "fire");
  p.alive = false;
  stepWorld(w, {}, 0.05);
  assert.equal(w.status, "playing");
  assert.equal(respawnPlayer(w, "p"), null);
  w.time = p.respawnAt;
  const next = respawnPlayer(w, "p");
  assert.equal(next.segments.length, 6);
  assert.equal(next.level, 1);
  assert.deepEqual(next.upgrades, {});
  assert.equal(next.spawnProtection, 3);
});
test("arena death converts exactly 28 percent of earned growth once and not starter body", () => {
  const w = createWorld({ mode: "arena" });
  const p = addPlayer(w, { id: "p" });
  w.foods = [];
  p._growthEarned = 1000;
  p.alive = false;
  stepWorld(w, {}, 0.05);
  assert.equal(
    w.foods.reduce((n, f) => n + f.value, 0),
    280,
  );
  stepWorld(w, {}, 0.05);
  assert.equal(
    w.foods.reduce((n, f) => n + f.value, 0),
    280,
  );
});
test("online arena choices expire in five seconds; rarity is seeded and luck changes weights", () => {
  const w = createWorld({ mode: "arena" });
  const p = addPlayer(w, { id: "p" });
  p.invulnerable = 100;
  p.xp = 24;
  w.foods.push({ id: "xp", type: "xp", x: p.x, y: p.y, value: 1 });
  stepWorld(w, {}, 0.05);
  assert.equal(p.choiceTime, 5);
  assert.equal(Object.keys(p.choiceRarities).length, 3);
  for (let i = 0; i < 102; i++) stepWorld(w, {}, 0.05);
  assert.ok(p.upgradeRolls.length >= 1);
  assert.equal(rarityWeights(0, 3)[4], 0);
  assert.ok(rarityWeights(500, 3)[4] > rarityWeights(500, 0)[4]);
  assert.equal(rollRarity(0.999, 500), "MYTHIC");
});
test("synergies activate from body/rarity and discovery remains when body requirements disappear", () => {
  const w = createWorld();
  const p = addPlayer(w, { id: "p" });
  for (let i = 0; i < 2; i++) {
    p.choices = ["fire"];
    p.choiceRarities = { fire: "EPIC" };
    chooseUpgrade(w, "p", "fire");
  }
  assert.equal(p.traits.find((t) => t.id === "toxic_ignition").state, "ACTIVE");
  assert.equal(p.traits.find((t) => t.id === "ember_crown").state, "ACTIVE");
  p.segments = p.segments.filter((s) => s.type !== "poison");
  resolveTraits(p);
  assert.notEqual(
    p.traits.find((t) => t.id === "toxic_ignition").state,
    "ACTIVE",
  );
  assert.ok(p.traitDiscoveries.includes("toxic_ignition"));
});
test("bots obey capacity, use ordinary health/builds and yield a seat to a human", () => {
  const w = createWorld({ mode: "arena", maxPlayers: 10 });
  const director = createBotDirector(w, 10);
  const inputs = {};
  director.update(inputs, 0);
  assert.equal(w.players.length, 8);
  assert.ok(
    w.players.every(
      (p) =>
        p.bot &&
        p.segments.length === 6 &&
        p.level === 1 &&
        p.spawnProtection === 3,
    ),
  );
  assert.equal(director.retireOne([]), true);
  assert.equal(w.players.length, 7);
  addPlayer(w, { id: "human" });
  w.time += 1;
  director.update(inputs, 1);
  assert.equal(w.players.filter((p) => p.bot).length, 7);
  assert.equal(Object.hasOwn(inputs, "human"), false);
});
test("spawn protection blocks PvP; attacking cancels it and a lethal pulse credits one kill", () => {
  const w = createWorld({ mode: "arena" }),
    a = addPlayer(w, { id: "a" }),
    b = addPlayer(w, { id: "b" });
  w.foods = [];
  w._spawnTimer = w._foodTimer = 1000;
  a.x = 800;
  a.y = 800;
  b.x = 920;
  b.y = 800;
  for (const p of [a, b]) {
    p.segments = [];
    p._path = [{ x: p.x, y: p.y }];
    p._headHp = p.hp = p.maxHp = 24;
  }
  stepWorld(w, { a: { pulse: true } }, 0.05);
  assert.equal(a.spawnProtection, 0);
  assert.equal(b.hp, 24);
  assert.equal(b.alive, true);
  a.pulseCooldown = 0;
  b.spawnProtection = 0;
  b.invulnerable = 0;
  stepWorld(w, { a: { pulse: true } }, 0.05);
  assert.equal(b.alive, false);
  assert.equal(a.pvpKills, 1);
  assert.ok(b.respawnAt > w.time);
  stepWorld(w, {}, 0.05);
  assert.equal(a.pvpKills, 1);
  assert.equal(w.status, "playing");
});
test("toxic ignition deals actual burst damage outside the triggering pulse", () => {
  const w = createWorld(),
    p = addPlayer(w, { id: "p" });
  w.foods = [];
  w._spawnTimer = w._foodTimer = 1000;
  p.choices = ["fire"];
  chooseUpgrade(w, p.id, "fire");
  p.invulnerable = 100;
  p._elementTimer = 1000;
  const enemy = (id, offset, hp) => ({
    id,
    type: "chaser",
    x: p.x + offset,
    y: p.y,
    hp,
    maxHp: hp,
    radius: 13,
    angle: 0,
    slow: 0,
    hitFlash: 0,
    attackTimer: 1,
    phase: 1,
    warning: 0,
    _contacts: {},
    _poison: 0,
    _poisonDamage: 0,
    _lastHit: null,
  });
  const first = enemy("first", 140, 1),
    second = enemy("second", 225, 30);
  first._burn = first._poison = 2;
  first._burnOwner = first._poisonOwner = p.id;
  w.enemies = [first, second];
  stepWorld(w, { p: { pulse: true } }, 0.05);
  assert.equal(first.hp <= 0, true);
  assert.equal(second.hp <= 0, true);
  assert.equal(p.kills, 2);
});
test("a failed listen releases server resources cleanly", async () => {
  const first = createGameServer({ port: 0 });
  const { port } = await first.listen();
  const second = createGameServer({ port });
  try {
    await assert.rejects(second.listen(), { code: "EADDRINUSE" });
    await second.close();
  } finally {
    await first.close();
  }
});
test("protocol 3 reconstructs long bodies from path deltas with no moving segment XY fields", () => {
  const w = createWorld({ mode: "coop" });
  const p = addPlayer(w, { id: "p" });
  p.invulnerable = 1000;
  while (p.segments.length < 70) {
    p.choices = ["growth"];
    chooseUpgrade(w, "p", "growth");
  }
  const state = createPathState(),
    v2 = createWireState();
  let decoded = null,
    bytes3 = 0,
    bytes2 = 0,
    error = 0;
  for (let i = 0; i < 180; i++) {
    stepWorld(w, { p: { angle: i * 0.01 } }, 1 / 30);
    if (i % 2) continue;
    const snapshot = getSnapshot(w, { includePaths: true });
    const frame = JSON.parse(
      JSON.stringify(
        encodePathFrame(snapshot, state, { playerId: "p", viewRadius: 1000 }),
      ),
    );
    decoded = applyPathFrame(decoded, frame);
    const own = decoded.snapshot.players[0];
    assert.equal(own.segments.length, p.segments.length);
    for (let j = 0; j < own.segments.length; j++)
      error = Math.max(
        error,
        Math.hypot(
          own.segments[j].x - p.segments[j].x,
          own.segments[j].y - p.segments[j].y,
        ),
      );
    if (frame.k === "d")
      for (const patch of frame.c.S?.p || [])
        assert.equal(patch[1] & 3, 0, "segment coordinate bits never change");
    bytes3 += Buffer.byteLength(JSON.stringify(frame));
    bytes2 += Buffer.byteLength(
      JSON.stringify(
        encodeFrame(snapshot, v2, { playerId: "p", viewRadius: 1000 }),
      ),
    );
  }
  assert.ok(error < 1, `body path quantization error ${error}`);
  assert.ok(
    bytes3 < bytes2 * 0.7,
    `path bytes ${bytes3} vs segment delta ${bytes2}`,
  );
  encodePathFrame(getSnapshot(w, { includePaths: true }), state, {
    playerId: "p",
  });
  const gap = encodePathFrame(getSnapshot(w, { includePaths: true }), state, {
    playerId: "p",
  });
  assert.throws(() => applyPathFrame(decoded, gap), /baseline/);
  const full = encodePathFrame(getSnapshot(w, { includePaths: true }), state, {
    playerId: "p",
    forceFull: true,
  });
  assert.equal(applyPathFrame(decoded, full).seq, full.seq);
});
test("real arena sockets join without Ready, allow late join, reject early respawn and keep world running", async (t) => {
  const game = createGameServer({ port: 0, arenaCapacity: 4 });
  const { port } = await game.listen();
  const sockets = [];
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    await game.close();
  });
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(ws);
    const messages = [];
    let decoded = null;
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      messages.push(m);
      if (m.frame) decoded = applyPathFrame(decoded, m.frame);
    });
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "arena", protocol: 3 }));
    const until = async (fn) => {
      for (let i = 0; i < 150; i++) {
        if (fn()) return;
        await delay(20);
      }
      throw new Error("Arena timeout");
    };
    await until(() => messages.some((m) => m.type === "welcome"));
    return {
      ws,
      messages,
      get decoded() {
        return decoded;
      },
      until,
      welcome: messages.find((m) => m.type === "welcome"),
    };
  }
  const a = await connect();
  assert.equal(a.welcome.room.state, "playing");
  assert.equal(a.welcome.room.mode, "arena");
  const b = await connect();
  assert.equal(a.welcome.room.id, b.welcome.room.id);
  const room = game.rooms.get(a.welcome.room.id);
  const p = room.world.players.find((p) => p.id === a.welcome.playerId);
  p.alive = false;
  await a.until(
    () =>
      a.decoded?.snapshot.players.find((v) => v.id === p.id)?.alive === false,
  );
  a.ws.send(JSON.stringify({ type: "respawn" }));
  await a.until(() => a.messages.some((m) => m.type === "error"));
  p.respawnAt = room.world.time;
  const oldLife = p.lifeId;
  a.ws.send(JSON.stringify({ type: "respawn" }));
  await a.until(() => a.messages.some((m) => m.type === "respawned"));
  assert.notEqual(
    room.world.players.find((v) => v.id === p.id).lifeId,
    oldLife,
  );
  assert.equal(room.world.status, "playing");
});
