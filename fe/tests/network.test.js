import './fixtures/configure.js';
import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  addPlayer,
  stepWorld,
  chooseUpgrade,
  getSnapshot,
} from "../public/game/engine.js";
import {
  createWireState,
  encodeFrame,
  applyFrame,
} from "../public/game/network.js";

function setup() {
  const world = createWorld({ seed: 4242, mode: "coop" });
  addPlayer(world, { id: "a", name: "A" });
  addPlayer(world, { id: "b", name: "B" });
  return world;
}
function canonical(snapshot) {
  return {
    ...snapshot,
    players: [...snapshot.players].sort((a, b) => a.id.localeCompare(b.id)),
    enemies: [...snapshot.enemies].sort((a, b) => a.id.localeCompare(b.id)),
    foods: [...snapshot.foods].sort((a, b) => a.id.localeCompare(b.id)),
    projectiles: [...snapshot.projectiles].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    effects: [...snapshot.effects].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

test("compact full frame preserves identity, body order and bounded quantization error", () => {
  const w = setup();
  stepWorld(w, { a: { angle: 0.72341 } }, 1 / 30);
  const snapshot = getSnapshot(w);
  const unchanged = structuredClone(snapshot);
  const decoded = applyFrame(
    null,
    JSON.parse(
      JSON.stringify(
        encodeFrame(snapshot, createWireState(), {
          playerId: "a",
          viewRadius: 1800,
        }),
      ),
    ),
  ).snapshot;
  assert.equal(decoded.players[0].id, "a");
  assert.deepEqual(
    decoded.players[0].segments.map((s) => s.id),
    w.players[0].segments.map((s) => s.id),
  );
  assert.ok(Math.abs(decoded.players[0].x - w.players[0].x) <= 0.125);
  assert.ok(Math.abs(decoded.players[0].angle - w.players[0].angle) <= 0.0005);
  assert.deepEqual(snapshot, unchanged);
  assert.equal(decoded.players[0]._path, undefined);
});

test("delta roundtrip matches fresh full frames through motion, upgrades, births and removals", () => {
  const w = setup(),
    state = createWireState();
  let decoded = null;
  for (let i = 0; i < 180; i++) {
    if (i === 25) {
      w.players[0].choices = ["fire"];
      chooseUpgrade(w, "a", "fire");
    }
    if (i === 75) w.foods.splice(0, 30);
    stepWorld(
      w,
      { a: { angle: i * 0.021, pulse: i % 35 === 0 }, b: { angle: -i * 0.03 } },
      1 / 30,
    );
    const snapshot = getSnapshot(w),
      options = { playerId: "a", viewRadius: 1000 };
    const frame = JSON.parse(
      JSON.stringify(encodeFrame(snapshot, state, options)),
    );
    decoded = applyFrame(decoded, frame);
    const full = applyFrame(
      null,
      encodeFrame(snapshot, createWireState(), options),
    );
    assert.deepEqual(canonical(decoded.snapshot), canonical(full.snapshot));
  }
});

test("interest view retains own tail and boss, culls distant entities and restores entrants", () => {
  const w = setup(),
    p = w.players[0];
  p.x = 100;
  p.y = 100;
  p.segments[0].x = 2200;
  p.segments[0].y = 1700;
  w.foods = [
    { id: "near", type: "growth", x: 120, y: 120, value: 25 },
    { id: "far", type: "xp", x: 2200, y: 1700, value: 8 },
  ];
  w.enemies = [
    {
      id: "boss",
      type: "boss",
      x: 2200,
      y: 1600,
      hp: 100,
      maxHp: 100,
      radius: 63,
    },
  ];
  const state = createWireState();
  let decoded = applyFrame(
    null,
    encodeFrame(getSnapshot(w), state, { playerId: "a", viewRadius: 450 }),
  );
  assert.deepEqual(
    decoded.snapshot.foods.map((f) => f.id),
    ["near"],
  );
  assert.equal(decoded.snapshot.players[0].segments.length, 6);
  assert.equal(decoded.snapshot.enemies[0].id, "boss");
  w.foods[1].x = 150;
  w.foods[1].y = 150;
  decoded = applyFrame(
    decoded,
    encodeFrame(getSnapshot(w), state, { playerId: "a", viewRadius: 450 }),
  );
  assert.equal(decoded.snapshot.foods.length, 2);
});

test("missing or stale baselines reject safely and a full frame restores the stream", () => {
  const w = setup(),
    state = createWireState(),
    first = encodeFrame(getSnapshot(w), state);
  const decoded = applyFrame(null, first);
  encodeFrame(getSnapshot(w), state);
  const skipped = encodeFrame(getSnapshot(w), state);
  assert.throws(() => applyFrame(decoded, skipped), /baseline/);
  assert.throws(() => applyFrame(null, skipped), /baseline/);
  assert.throws(() => applyFrame(decoded, first), /Stale/);
  const full = encodeFrame(getSnapshot(w), state, { forceFull: true });
  assert.equal(applyFrame(decoded, full).seq, 4);
  assert.throws(
    () => applyFrame(null, { v: 2, seq: 1, k: "f", m: {}, c: {} }),
    /Incomplete/,
  );
});

test("each viewer owns an independent baseline and decoded frames cannot mutate earlier ones", () => {
  const w = setup(),
    a = createWireState(),
    b = createWireState();
  const da = applyFrame(
    null,
    encodeFrame(getSnapshot(w), a, { playerId: "a", viewRadius: 450 }),
  );
  const copy = structuredClone(da);
  stepWorld(w, { a: { angle: 1 } }, 1 / 30);
  const db = applyFrame(
    null,
    encodeFrame(getSnapshot(w), b, { playerId: "b", viewRadius: 1800 }),
  );
  const next = applyFrame(
    da,
    encodeFrame(getSnapshot(w), a, { playerId: "a", viewRadius: 450 }),
  );
  next.snapshot.players[0].upgrades.fire = 99;
  assert.deepEqual(da, copy);
  assert.equal(db.seq, 1);
  assert.equal(next.seq, 2);
});

test("a moving long-body delta is materially smaller than the original JSON snapshot", () => {
  const w = setup();
  for (const p of w.players)
    while (p.segments.length < 70) {
      p.choices = ["growth"];
      chooseUpgrade(w, p.id, "growth");
    }
  const state = createWireState();
  encodeFrame(getSnapshot(w), state, { playerId: "a", viewRadius: 1800 });
  stepWorld(w, { a: { angle: 0.4 }, b: { angle: -0.6 } }, 1 / 30);
  const snapshot = getSnapshot(w);
  const frame = encodeFrame(snapshot, state, {
    playerId: "a",
    viewRadius: 1800,
  });
  assert.ok(
    Buffer.byteLength(JSON.stringify(frame)) <
      Buffer.byteLength(JSON.stringify(snapshot)) * 0.5,
  );
});
