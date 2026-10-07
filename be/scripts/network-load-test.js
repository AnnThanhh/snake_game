import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { createGameServer } from "../server/index.js";
import { chooseUpgrade } from "../game/engine.js";
import { applyFrame } from "../game/network.js";

const secondsArgument = process.argv.slice(2);
if (secondsArgument.some((arg) => !/^--seconds=\d+$/.test(arg)))
  throw new Error("Usage: node scripts/network-load-test.js [--seconds=20..30]");
const seconds = Number(secondsArgument.at(-1)?.split("=")[1] || 20);
if (!Number.isInteger(seconds) || seconds < 20 || seconds > 30)
  throw new Error("--seconds must be an integer between 20 and 30");

const PLAYER_COUNT = 10;
const SEGMENTS = 70;
const WARMUP_SECONDS = 2;
const game = createGameServer({ port: 0, maxPlayers: PLAYER_COUNT, worldOptions: { seed: 20260918 } });
const address = await game.listen();
const base = `http://127.0.0.1:${address.port}`;
const clients = [];
const failures = [];
const telemetrySamples = [];
const fixture = { enemiesAdded: 0, projectilesAdded: 0, maintenancePasses: 0 };
const peak = { players: 0, segments: 0, enemies: 0, projectiles: 0, foods: 0, effects: 0 };
let room, inputTimer, fixtureTimer, measuring = false, closing = false;
let fixtureSeed = 20260918;
const round = (value) => Math.round(value * 1000) / 1000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function random() {
  fixtureSeed ^= fixtureSeed << 13;
  fixtureSeed ^= fixtureSeed >>> 17;
  fixtureSeed ^= fixtureSeed << 5;
  return (fixtureSeed >>> 0) / 4294967296;
}
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { samples: 0, mean: 0, min: 0, p50: 0, p95: 0, max: 0 };
  const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { samples: sorted.length, mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    min: round(sorted[0]), p50: round(percentile(.5)), p95: round(percentile(.95)), max: round(sorted.at(-1)) };
}
async function until(predicate, description, timeout = 10_000) {
  const deadline = performance.now() + timeout;
  while (!predicate()) {
    if (failures.length) throw new Error(failures[0]);
    if (performance.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await delay(20);
  }
}
function fail(error) { failures.push(error.stack || String(error)); }
function assertFinite(value) {
  if (typeof value === "number") assert.ok(Number.isFinite(value));
  else if (value && typeof value === "object") for (const item of Object.values(value)) assertFinite(item);
}
function send(client, message) {
  const serialized = JSON.stringify(message);
  client.ws.send(serialized);
  if (measuring && message.type === "input") {
    client.inputBytes += Buffer.byteLength(serialized);
    client.measuredInputs++;
  }
}

async function connect(index, code) {
  const ws = new WebSocket(base.replace("http:", "ws:") + "/ws");
  const client = { index, ws, id: null, welcome: null, decoded: null, started: false,
    sentSeq: -1, ack: null, ackAdvances: 0, allDecodedFrames: 0, baselineChecks: 0,
    frameBytes: [], decodeMs: [], snapshotBytes: 0, inputBytes: 0, measuredInputs: 0,
    fullFrames: 0, deltaFrames: 0, peakBufferedBytes: 0 };
  clients.push(client);
  ws.on("error", fail);
  ws.on("close", (code) => { if (!closing) fail(new Error(`Client ${index} closed unexpectedly (${code})`)); });
  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === "error") throw new Error(`Client ${index}: ${message.message}`);
      if (message.type === "welcome") {
        client.id = message.playerId;
        client.welcome = message;
        assert.equal(message.protocol, 2);
        assert.equal(message.room.maxPlayers, PLAYER_COUNT);
      }
      if (message.type === "started") client.started = true;
      if (!message.frame) return;
      const previousSeq = client.decoded?.seq || 0;
      assert.equal(message.frame.seq, previousSeq + 1, "ordered frame sequence");
      const start = performance.now();
      client.decoded = applyFrame(client.decoded, message.frame);
      const decodeMs = performance.now() - start;
      client.allDecodedFrames++;
      if (measuring && message.type === "snapshot") {
        client.frameBytes.push(raw.byteLength);
        client.snapshotBytes += raw.byteLength;
        client.decodeMs.push(decodeMs);
        if (message.frame.k === "f") client.fullFrames++;
        else client.deltaFrames++;
      }
      if (message.ack !== null) {
        assert.ok(Number.isSafeInteger(message.ack));
        assert.ok(message.ack <= client.sentSeq, "server cannot acknowledge an unsent input");
        assert.ok(client.ack === null || message.ack >= client.ack, "input acknowledgements cannot move backwards");
        if (message.ack > (client.ack ?? -1)) client.ackAdvances++;
        client.ack = message.ack;
      }
      const own = client.decoded.snapshot.players.find((player) => player.id === client.id);
      assert.ok(own && Number.isFinite(own.x) && Number.isFinite(own.y), "own player decodes correctly");
      if (client.started) {
        assert.equal(client.decoded.snapshot.players.length, PLAYER_COUNT);
        assert.equal(own.segments.length, SEGMENTS, "interest filtering retains the complete local body");
      }
      // Check sparse reconstruction against the encoder's independent packed
      // baseline when it still refers to this exact frame. Entity order is not
      // significant after an entity leaves and re-enters an area of interest.
      const serverSocket = room?.members.get(client.id)?.ws;
      if (client.allDecodedFrames % 15 === 0 && serverSocket?.wireState.seq === message.frame.seq) {
        assert.deepEqual(client.decoded.packed.m, serverSocket.wireState.previous.m);
        for (const key of ["P", "S", "E", "F", "B", "X"]) {
          // Compare JSON representations: the transport normalizes -0 to 0.
          assert.deepEqual(new Map(client.decoded.packed.c[key].map((tuple) => [tuple[0], JSON.stringify(tuple)])),
            new Map(serverSocket.wireState.previous.c[key].map((tuple) => [tuple[0], JSON.stringify(tuple)])));
        }
        assertFinite(client.decoded.snapshot);
        assert.ok(message.ack === null || message.ack <= serverSocket.appliedSeq,
          "acknowledgements refer to inputs already applied by the simulation");
        client.baselineChecks++;
      }
      const choiceKey = own.choices.length ? `${own.level}:${own.choices.join("|")}` : "";
      if (choiceKey && choiceKey !== client.choiceKey) send(client, { type: "upgrade", id: own.choices[0] });
      client.choiceKey = choiceKey;
    } catch (error) { fail(error); }
  });
  await once(ws, "open");
  send(client, { type: index === 0 ? "create" : "join", code, protocol: 2,
    playerName: `Load ${index + 1}`, name: "10-client local load", viewRadius: 650 + index % 3 * 250 });
  await until(() => client.welcome, `welcome client ${index + 1}`);
  return client;
}

function seedBodies() {
  const world = room.world;
  world.time = 480;
  for (const [index, player] of world.players.entries()) {
    while (player.segments.length < SEGMENTS) {
      player.choices = ["growth"];
      chooseUpgrade(world, player.id, "growth");
    }
    for (const id of ["fire", "poison", "armor"]) for (let i = 0; i < 4; i++) {
      player.choices = [id];
      chooseUpgrade(world, player.id, id);
    }
    const angle = index * Math.PI * 2 / PLAYER_COUNT;
    player.x = 1200 + Math.cos(angle) * 320;
    player.y = 900 + Math.sin(angle) * 320;
    player.angle = angle + Math.PI / 2;
    player._path = Array.from({ length: 360 }, (_, i) => ({
      x: 1200 + Math.cos(angle - i * 4 / 320) * 320,
      y: 900 + Math.sin(angle - i * 4 / 320) * 320,
    }));
    // Keep all ten sockets attached to living, long snakes for this load test.
    // This is a networking fixture, not a survival or combat-balance result.
    player.invulnerable = 1000;
  }
}
function pointNearPlayer() {
  const player = room.world.players[Math.floor(random() * PLAYER_COUNT)];
  const angle = random() * Math.PI * 2, distance = 180 + random() * 500;
  return { player, x: clamp(player.x + Math.cos(angle) * distance, 70, 2330),
    y: clamp(player.y + Math.sin(angle) * distance, 70, 1730) };
}
function maintainFixture() {
  const world = room.world;
  fixture.maintenancePasses++;
  const types = ["chaser", "swarm", "brute", "archer"];
  const stats = { chaser: [68, 13], swarm: [30, 8], brute: [310, 24], archer: [94, 14] };
  while (world.enemies.length < 180) {
    const point = pointNearPlayer(), type = types[Math.floor(random() * types.length)];
    const [hp, radius] = stats[type];
    world.enemies.push({ id: `load-enemy-${++fixture.enemiesAdded}`, type, x: point.x, y: point.y,
      hp, maxHp: hp, radius, angle: 0, slow: 0, hitFlash: 0, attackTimer: .6 + random(),
      phase: 1, warning: 0, _contacts: Object.create(null), _poison: 0, _poisonDamage: 0,
      _poisonOwner: null, _lastHit: null, _charge: 0, _chargeAngle: 0, _ability: 5 });
  }
  while (world.projectiles.length < 200) {
    const point = pointNearPlayer(), angle = Math.atan2(point.player.y - point.y, point.player.x - point.x);
    world.projectiles.push({ id: `load-shot-${++fixture.projectilesAdded}`, x: point.x, y: point.y,
      angle, vx: Math.cos(angle) * 185, vy: Math.sin(angle) * 185, radius: 5, damage: 10,
      owner: "load-fixture", team: "enemy", color: "#f4bc83", life: 5 });
  }
  const counts = { players: world.players.length, segments: world.players.reduce((sum, p) => sum + p.segments.length, 0),
    enemies: world.enemies.length, projectiles: world.projectiles.length, foods: world.foods.length, effects: world.effects.length };
  for (const [key, value] of Object.entries(counts)) peak[key] = Math.max(peak[key], value);
}

try {
  for (let i = 0; i < PLAYER_COUNT; i++) {
    await connect(i, clients[0]?.welcome.room.code);
  }
  room = game.rooms.get(clients[0].welcome.room.id);
  seedBodies();
  maintainFixture();
  for (const client of clients) send(client, { type: "ready", ready: true });
  await until(() => clients.every((client) => client.started), "all ten ready clients start");
  inputTimer = setInterval(() => {
    try {
      for (const client of clients) {
        const player = client.decoded?.snapshot.players.find((p) => p.id === client.id);
        if (!player) continue;
        const angle = room.world.time / 7 + client.index * Math.PI * 2 / PLAYER_COUNT;
        const target = { x: 1200 + Math.cos(angle) * 430, y: 900 + Math.sin(angle) * 330 };
        client.sentSeq++;
        send(client, { type: "input", seq: client.sentSeq,
          angle: Math.atan2(target.y - player.y, target.x - player.x), throttle: client.index % 2 ? -.1 : .15,
          // Dash replaces the fixture's long invulnerability timer, so keep it
          // disabled while testing constant 70-segment network load.
          dash: false,
          pulse: client.sentSeq % 270 === client.index * 19 % 270,
          viewRadius: 650 + (client.index + Math.floor(client.sentSeq / 150)) % 3 * 250 });
        client.peakBufferedBytes = Math.max(client.peakBufferedBytes, client.ws.bufferedAmount);
      }
    } catch (error) { fail(error); }
  }, 1000 / 30);
  fixtureTimer = setInterval(maintainFixture, 250);
  console.log(`10 protocol-2 clients connected; warming ${WARMUP_SECONDS}s with 700 segments, 180 enemies and 200 projectiles.`);
  await delay(WARMUP_SECONDS * 1000);
  assert.deepEqual(failures, []);
  const startWorldTime = room.world.time;
  const wallStart = performance.now();
  measuring = true;
  while (performance.now() - wallStart < seconds * 1000) {
    await delay(Math.min(1000, Math.max(1, seconds * 1000 - (performance.now() - wallStart))));
    const response = await fetch(base + "/api/health");
    const health = await response.json();
    assert.equal(health.inGame, PLAYER_COUNT);
    assert.equal(health.roomCapacity, PLAYER_COUNT);
    telemetrySamples.push({ atSeconds: round((performance.now() - wallStart) / 1000),
      tickRate: health.tickRate, tickMs: health.tickMs, overloadCount: health.overloadCount, state: health.state });
    assert.deepEqual(failures, []);
  }
  const measuredWallSeconds = (performance.now() - wallStart) / 1000;
  const endWorldTime = room.world.time;
  measuring = false;
  clearInterval(inputTimer);
  inputTimer = null;
  await until(() => clients.every((client) => client.ack === client.sentSeq), "final sequenced inputs acknowledged");
  assert.equal(room.world.status, "playing");
  for (const client of clients) {
    assert.ok(client.deltaFrames > 0 && client.fullFrames > 0);
    assert.ok(client.baselineChecks > 0 && client.ackAdvances > 0);
    assert.equal(client.ack, client.sentSeq);
  }
  assert.deepEqual(failures, []);
  const report = {
    test: "Ten real local WebSocket clients, protocol 2",
    scope: "One Node process hosts the server, ten clients, decoding and validation. Local loopback only; excludes browser rendering and real WAN conditions. Not a 30-player capacity proof.",
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    fixture: { players: PLAYER_COUNT, segmentsPerPlayer: SEGMENTS, enemyTargetEvery250ms: 180,
      projectileTargetEvery250ms: 200, viewRadiusRange: [650, 1150], seed: 20260918,
      invulnerability: "1000 seconds on fixture players to keep all ten long bodies alive",
      skills: "Pulse enabled; dash disabled because it replaces fixture invulnerability",
      bodyInitialization: "Normal growth/element upgrades; circular history seeded before the first tick",
      ...fixture, peakEntities: peak },
    timing: { warmupSeconds: WARMUP_SECONDS, requestedSeconds: seconds, measuredWallSeconds: round(measuredWallSeconds),
      startWorldTime: round(startWorldTime), endWorldTime: round(endWorldTime), simulatedSeconds: round(endWorldTime - startWorldTime) },
    server: { tickRate: summarize(telemetrySamples.map((s) => s.tickRate)),
      tickMs: summarize(telemetrySamples.map((s) => s.tickMs)), samples: telemetrySamples },
    clients: clients.map((client) => ({ index: client.index + 1, playerId: client.id,
      snapshots: client.frameBytes.length, fullFrames: client.fullFrames, deltaFrames: client.deltaFrames,
      snapshotBytes: client.snapshotBytes, snapshotBytesPerSecond: round(client.snapshotBytes / measuredWallSeconds),
      snapshotHz: round(client.frameBytes.length / measuredWallSeconds), frameBytes: summarize(client.frameBytes),
      decodeMs: summarize(client.decodeMs), inputBytes: client.inputBytes, measuredInputs: client.measuredInputs,
      lastSentInputSeq: client.sentSeq, lastAppliedAck: client.ack, ackAdvances: client.ackAdvances,
      allDecodedFrames: client.allDecodedFrames, baselineComparisons: client.baselineChecks,
      peakClientBufferedBytes: client.peakBufferedBytes })),
    validation: { passed: true, failures,
      checks: "Every received frame reconstructed; sequence continuity and monotonic applied-input acks checked; complete own body retained; sampled packed tuples match independent server encoder baseline; sampled decoded numbers finite; final input ack drained.",
      measurement: "Snapshot bytes are actual received UTF-8 WebSocket message payloads including frame, ack and telemetry; excludes WebSocket/TCP/TLS headers. Timing has no machine-specific pass/fail threshold. Client decoding, periodic deep comparisons and fixture maintenance share the server event loop." },
  };
  const artifact = new URL("../artifacts/network-load-10.json", import.meta.url);
  await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
  await writeFile(artifact, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`PASS 10 clients for ${measuredWallSeconds.toFixed(2)}s: every sequence/ack/decode check passed.`);
  console.log(`Measured tick rate mean ${report.server.tickRate.mean}Hz; tick cost p95 ${report.server.tickMs.p95}ms.`);
  console.log(`Per-client payload ${(Math.min(...report.clients.map((c) => c.snapshotBytesPerSecond)) / 1024).toFixed(1)}–${(Math.max(...report.clients.map((c) => c.snapshotBytesPerSecond)) / 1024).toFixed(1)}KiB/s; includes periodic full baselines.`);
  console.log("Local ten-client evidence only; no browser, WAN or 30-player capacity claim.");
  console.log(`Report: ${fileURLToPath(artifact)}`);
} finally {
  closing = true;
  clearInterval(inputTimer);
  clearInterval(fixtureTimer);
  for (const client of clients) client.ws.terminate();
  await game.close();
}
