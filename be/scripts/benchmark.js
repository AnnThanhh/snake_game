import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  addPlayer,
  chooseUpgrade,
  createWorld,
  getSnapshot,
  stepWorld,
} from "../game/engine.js";

// This is a synthetic CPU fixture for the four- or ten-player prototype.
// It does not run sockets, a browser, or a 30-player room. Fixture mutations
// below keep the workload alive and full; they are never used by production.
const DT = 1 / 30;
const WARMUP_SECONDS = 10;
const CAPS = {
  players: 4,
  segmentsPerPlayer: 70,
  enemies: 180,
  foods: 360,
  projectiles: 240,
  effects: 100,
};
const TARGET_PROJECTILES = 200;
const options = { seconds: 120, seed: 20260918, players: 4, json: false };
for (const argument of process.argv.slice(2)) {
  if (argument === "--json") options.json = true;
  else if (argument.startsWith("--seconds="))
    options.seconds = Number(argument.slice("--seconds=".length));
  else if (argument.startsWith("--seed="))
    options.seed = Number(argument.slice("--seed=".length));
  else if (argument.startsWith("--players="))
    options.players = Number(argument.slice("--players=".length));
  else throw new Error(`Unknown option: ${argument}. Use --players=4|10 --seconds=120 --seed=20260918 --json.`);
}
if (!Number.isInteger(options.seconds) || options.seconds < 1 || options.seconds > 600)
  throw new Error("--seconds must be an integer from 1 to 600.");
if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff)
  throw new Error("--seed must be an unsigned 32-bit integer.");
if (![4, 10].includes(options.players))
  throw new Error("--players must be 4 or 10.");
CAPS.players = options.players;

let fixtureSeed = options.seed || 1;
function random() {
  fixtureSeed ^= fixtureSeed << 13;
  fixtureSeed ^= fixtureSeed >>> 17;
  fixtureSeed ^= fixtureSeed << 5;
  return (fixtureSeed >>> 0) / 4294967296;
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const duration = Math.max(600, options.seconds + WARMUP_SECONDS);
const world = createWorld({ seed: options.seed, mode: "coop", duration, maxPlayers: options.players });
world.time = duration - options.seconds - WARMUP_SECONDS;
const species = ["cobra", "python", "viper", "cobra"];
const fixtureStats = { enemiesAdded: 0, projectilesAdded: 0, healingTicks: 0 };

for (let i = 0; i < options.players; i++) {
  const player = addPlayer(world, {
    id: `benchmark-${i}`,
    name: `Benchmark ${i + 1}`,
    species: species[i % species.length],
  });
  // Grant explicit fixture offers through the normal upgrade implementation.
  // This prepares maximum-length bodies without copying segment internals.
  while (player.segments.length < CAPS.segmentsPerPlayer) {
    player.choices = ["growth"];
    chooseUpgrade(world, player.id, "growth");
  }
  for (const id of ["fire", "poison", "armor"]) {
    for (let j = 0; j < 4; j++) {
      player.choices = [id];
      chooseUpgrade(world, player.id, id);
    }
  }
}

// Enemy schemas mirror the engine's existing prototype types. Replenishment
// happens outside measured stepWorld calls and is disclosed in the report.
const enemyStats = {
  chaser: { hp: 34, radius: 13 },
  swarm: { hp: 15, radius: 8 },
  brute: { hp: 155, radius: 24 },
  archer: { hp: 47, radius: 14 },
};
const enemyTypes = Object.keys(enemyStats);

function spawnPoint() {
  const player = world.players[Math.floor(random() * world.players.length)];
  const angle = random() * Math.PI * 2;
  const distance = 250 + random() * 450;
  return {
    x: clamp(player.x + Math.cos(angle) * distance, 80, world.width - 80),
    y: clamp(player.y + Math.sin(angle) * distance, 80, world.height - 80),
    player,
  };
}

function prepareFixture(tick) {
  for (const player of world.players) {
    // Restore damage before the next tick, preserving ordinary collision and
    // skill code during measurement. This measures load, not survival balance.
    player._headHp = 24;
    for (const segment of player.segments) segment.hp = segment.maxHp;
    if (player.choices.length) {
      const preference = ["elements", "fangs", "pulse", "haste", "magnet", "vitality"];
      const choice = preference.find((id) => player.choices.includes(id)) || player.choices[0];
      chooseUpgrade(world, player.id, choice);
    }
  }
  fixtureStats.healingTicks++;
  while (world.enemies.length < CAPS.enemies) {
    const point = spawnPoint();
    const type = enemyTypes[Math.floor(random() * enemyTypes.length)];
    const stats = enemyStats[type];
    const hp = Math.round(stats.hp * (1 + world.time / 650));
    world.enemies.push({
      id: `fixture-enemy-${++fixtureStats.enemiesAdded}`,
      type,
      x: point.x,
      y: point.y,
      hp,
      maxHp: hp,
      radius: stats.radius,
      angle: 0,
      slow: 0,
      hitFlash: 0,
      attackTimer: 0.6 + random(),
      phase: 1,
      warning: 0,
      _contacts: Object.create(null),
      _poison: 0,
      _poisonDamage: 0,
      _poisonOwner: null,
      _lastHit: null,
      _charge: 0,
      _chargeAngle: 0,
      _ability: 5,
    });
  }
  while (world.projectiles.length < TARGET_PROJECTILES) {
    const point = spawnPoint();
    const angle = Math.atan2(point.player.y - point.y, point.player.x - point.x);
    world.projectiles.push({
      id: `fixture-shot-${++fixtureStats.projectilesAdded}`,
      x: point.x,
      y: point.y,
      angle,
      vx: Math.cos(angle) * 185,
      vy: Math.sin(angle) * 185,
      radius: 5,
      damage: 10,
      owner: "fixture",
      team: "enemy",
      color: "#f4bc83",
      life: 5,
    });
  }
  return Object.fromEntries(world.players.map((player, index) => {
    const orbit = tick * DT / 7 + index * Math.PI * 2 / options.players;
    const targetX = world.width / 2 + Math.cos(orbit) * 430;
    const targetY = world.height / 2 + Math.sin(orbit) * 330;
    return [player.id, {
      angle: Math.atan2(targetY - player.y, targetX - player.x),
      throttle: index % 2 ? -0.1 : 0.15,
      dash: tick % 180 === (index * 30) % 180,
      pulse: tick % 270 === (index * 40) % 270,
    }];
  }));
}

const peak = {
  players: 0,
  segmentsPerPlayer: 0,
  totalSegments: 0,
  enemies: 0,
  foods: 0,
  projectiles: 0,
  effects: 0,
};
function countEntities() {
  return {
    players: world.players.length,
    segmentsPerPlayer: Math.max(0, ...world.players.map((p) => p.segments.length)),
    totalSegments: world.players.reduce((sum, p) => sum + p.segments.length, 0),
    enemies: world.enemies.length,
    foods: world.foods.length,
    projectiles: world.projectiles.length,
    effects: world.effects.length,
  };
}
function checkCaps() {
  const counts = countEntities();
  for (const [key, value] of Object.entries(counts)) {
    peak[key] = Math.max(peak[key], value);
    const limit = key === "totalSegments" ? CAPS.players * CAPS.segmentsPerPlayer : CAPS[key];
    if (value > limit) throw new Error(`Entity cap breached: ${key}=${value} > ${limit}`);
  }
}
function checkFinite(value, path = "snapshot") {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error(`Nonfinite simulation state: ${path}`);
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) checkFinite(child, `${path}.${key}`);
  }
}

const warmupTicks = WARMUP_SECONDS / DT;
for (let tick = 0; tick < warmupTicks; tick++) {
  stepWorld(world, prepareFixture(tick), DT);
  checkCaps();
}
const measurementStart = world.time;
const tickTimes = [];
const snapshotTimes = [];
const snapshotBytes = [];
const wallStart = performance.now();
const measuredTicks = options.seconds / DT;
for (let tick = 0; tick < measuredTicks; tick++) {
  const inputs = prepareFixture(tick + warmupTicks);
  checkCaps();
  const start = performance.now();
  stepWorld(world, inputs, DT);
  tickTimes.push(performance.now() - start);
  checkCaps();
  // The server publishes 15 snapshots/second for its 30 Hz simulation.
  if (tick % 2 === 0) {
    const snapshotStart = performance.now();
    const snapshot = getSnapshot(world);
    const bytes = Buffer.byteLength(JSON.stringify(snapshot));
    snapshotTimes.push(performance.now() - snapshotStart);
    snapshotBytes.push(bytes);
    checkFinite(snapshot);
  }
}
const measuredWallMs = performance.now() - wallStart;
const finalSnapshot = getSnapshot(world);
checkFinite(finalSnapshot);
checkCaps();

const round = (value) => Math.round(value * 1000) / 1000;
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {
    samples: values.length,
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    median: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    p99: round(percentile(0.99)),
    max: round(sorted.at(-1)),
  };
}
let rollingSum = 0;
let worstWindowMean = 0;
let worstWindowStartTick = 0;
for (let i = 0; i < tickTimes.length; i++) {
  rollingSum += tickTimes[i];
  if (i >= 30) rollingSum -= tickTimes[i - 30];
  if (i >= 29 && rollingSum / 30 > worstWindowMean) {
    worstWindowMean = rollingSum / 30;
    worstWindowStartTick = i - 29;
  }
}
const report = {
  benchmark: `${options.players}-player prototype synthetic CPU benchmark`,
  scope: "stepWorld and JSON snapshot creation; excludes WebSocket transport, network latency, browser rendering and 30-player capacity",
  fixture: {
    seed: options.seed,
    players: options.players,
    initialSegmentsPerPlayer: 70,
    targetEnemiesBeforeEachTick: 180,
    targetProjectilesBeforeEachTick: TARGET_PROJECTILES,
    healing: "Head and segment health restored before every tick; no production changes",
    initialBuild: "Normal growth upgrades to 70 segments, then four fire, four poison and four armor upgrades per player",
    ...fixtureStats,
  },
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  simulation: {
    hz: 30,
    snapshotHz: 15,
    warmupSeconds: WARMUP_SECONDS,
    measuredSeconds: options.seconds,
    startWorldTime: round(measurementStart),
    endWorldTime: round(world.time),
    finalStatus: world.status,
    measuredWallMs: round(measuredWallMs),
  },
  tickMs: summarize(tickTimes),
  worstOneSecondWindow: {
    startWorldTime: round(measurementStart + worstWindowStartTick * DT),
    meanTickMs: round(worstWindowMean),
  },
  snapshotSerializationMs: summarize(snapshotTimes),
  snapshotBytes: summarize(snapshotBytes),
  peakEntities: peak,
  finalEntities: countEntities(),
  caps: CAPS,
  validation: "All sampled numeric snapshot fields finite; entity caps checked before and after every measured tick. No machine-specific timing pass/fail threshold.",
};

console.log(`Synthetic CPU benchmark: ${options.players} players × 70 segments; 180 enemies; ≥200 projectiles before each tick.`);
console.log(`Simulated ${options.seconds}s at 30 Hz after ${WARMUP_SECONDS}s warmup in ${(measuredWallMs / 1000).toFixed(2)}s wall time.`);
console.log(`Tick ms: median ${report.tickMs.median} | p95 ${report.tickMs.p95} | p99 ${report.tickMs.p99} | max ${report.tickMs.max} | worst 1s mean ${report.worstOneSecondWindow.meanTickMs}`);
console.log(`Snapshot: median ${(report.snapshotBytes.median / 1024).toFixed(1)} KiB | max ${(report.snapshotBytes.max / 1024).toFixed(1)} KiB | serialization p95 ${report.snapshotSerializationMs.p95}ms`);
console.log(`Peak entities: ${JSON.stringify(peak)}. Finite state and caps passed.`);
console.log("Scope: simulation + JSON only; not evidence of network/browser or 30-player performance.");
if (options.json) {
  const artifactDirectory = new URL("../artifacts/", import.meta.url);
  const artifactPath = new URL(options.players === 4 ? "benchmark.json" : "benchmark-10.json", artifactDirectory);
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Report: ${fileURLToPath(artifactPath)}`);
}
