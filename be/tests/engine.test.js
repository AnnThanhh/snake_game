import './fixtures/configure.js';
import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  addPlayer,
  removePlayer,
  stepWorld,
  chooseUpgrade,
  getSnapshot,
} from "../game/engine.js";
import { UPGRADE_DEFS } from "../game/content.js";

function setup(options = {}, species = "cobra") {
  const world = createWorld(options);
  const player = addPlayer(world, { id: "p1", name: "Tester", species });
  return { world, player };
}

function tick(world, frames = 1, input = {}) {
  for (let i = 0; i < frames; i++) stepWorld(world, { p1: input }, 1 / 30);
}

function foodAt(world, player, type, value) {
  world.foods.push({
    id: "fixture-food",
    x: player.x,
    y: player.y,
    type,
    value,
  });
}

function shootAt(world, player, damage = 100, segment = null) {
  player.invulnerable = 0;
  const point = segment || player;
  world.projectiles.push({
    id: "fixture-shot",
    x: point.x,
    y: point.y,
    vx: 0,
    vy: 0,
    radius: 9,
    life: 1,
    damage,
    team: "enemy",
  });
  tick(world);
}

test("a seed and input sequence produce exactly the same public simulation", () => {
  const a = setup({ seed: 817, mode: "coop" });
  const b = setup({ seed: 817, mode: "coop" });
  for (let i = 0; i < 900; i++) {
    const input = {
      angle: i / 70,
      throttle: Math.sin(i / 40),
      dash: i % 180 === 0,
      pulse: i % 270 === 0,
    };
    tick(a.world, 1, input);
    tick(b.world, 1, input);
  }
  assert.deepEqual(getSnapshot(a.world), getSnapshot(b.world));
  assert.notDeepEqual(
    createWorld({ seed: 817 }).foods,
    createWorld({ seed: 818 }).foods,
  );
});

test("body follows the travelled curve and remains evenly spaced", () => {
  const { world, player } = setup();
  world.foods = [];
  tick(world, 25, { angle: 0 });
  const points = [player, ...player.segments];
  for (let i = 1; i < points.length; i++) {
    const distance = Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
    assert.ok(distance > 16 && distance < 18.01, `spacing ${distance}`);
  }
  assert.ok(player.segments[0].x < player.x);
  assert.ok(player.segments.at(-1).y > player.y);
});

test("growth creates real body segments and longer bodies turn more slowly", () => {
  const short = setup();
  const long = setup();
  foodAt(long.world, long.player, "growth", 2000);
  tick(long.world);
  tick(short.world);
  assert.equal(long.player.segments.length, short.player.segments.length + 20);
  assert.ok(long.player.hp > short.player.hp);
  short.player.angle = long.player.angle = 0;
  tick(short.world, 1, { angle: 1 });
  tick(long.world, 1, { angle: 1 });
  assert.ok(long.player.angle < short.player.angle);
});

test("client input cannot inject position, health, speed or nonfinite simulation values", () => {
  const a = setup();
  const b = setup();
  tick(a.world, 1, {
    angle: Infinity,
    throttle: NaN,
    dash: "yes",
    pulse: 1,
    hp: 999999,
    x: 0,
  });
  tick(b.world);
  assert.deepEqual(getSnapshot(a.world), getSnapshot(b.world));
  const x = a.player.x;
  const y = a.player.y;
  tick(a.world, 1, { throttle: 100000, angle: 0 });
  assert.ok(Math.hypot(a.player.x - x, a.player.y - y) < 8);
  assert.ok(Number.isFinite(a.player.hp));
});

test("upgrades require a living player and an offered ID, and cannot be replayed", () => {
  const { world, player } = setup();
  assert.equal(chooseUpgrade(world, player.id, "fire"), false);
  foodAt(world, player, "xp", 24);
  tick(world);
  assert.equal(player.level, 2);
  assert.equal(new Set(player.choices).size, 3);
  assert.ok(
    player.choices.every((id) => UPGRADE_DEFS.some((def) => def.id === id)),
  );
  const unoffered = UPGRADE_DEFS.find(
    (def) => !player.choices.includes(def.id),
  ).id;
  assert.equal(chooseUpgrade(world, player.id, unoffered), false);
  assert.equal(chooseUpgrade(world, player.id, "__proto__"), false);
  const selected = player.choices[0];
  assert.equal(chooseUpgrade(world, player.id, selected), true);
  assert.equal(player.upgrades[selected], 1);
  assert.equal(chooseUpgrade(world, player.id, selected), false);
});

test("co-op selection expires after 5 seconds without pausing the world", () => {
  const { world, player } = setup({ mode: "coop" });
  foodAt(world, player, "xp", 24);
  tick(world);
  const offered = [...player.choices];
  player.invulnerable = 100;
  tick(world, 152, { angle: 0 });
  assert.ok(world.time > 5);
  assert.equal(player.upgrades[offered[0]], 1);
  assert.equal(player.choices.length, 0);
});

test("solo selection has no timeout; the caller decides when to pause", () => {
  const { world, player } = setup();
  foodAt(world, player, "xp", 24);
  tick(world);
  const choices = [...player.choices];
  player.invulnerable = 100;
  world.foods = [];
  tick(world, 362, { angle: 0 });
  assert.deepEqual(player.choices, choices);
});

test("damage destroys body segments and a bare head can die", () => {
  const { world, player } = setup();
  const count = player.segments.length;
  shootAt(world, player, 100);
  assert.equal(player.segments.length, count - 1);
  assert.ok(player.alive);
  player.segments = [];
  shootAt(world, player, 100);
  assert.equal(player.alive, false);
  assert.equal(player.hp, 0);
  assert.equal(world.status, "defeat");
});

test("armor reduces incoming damage and healing restores missing segment integrity", () => {
  const normal = setup();
  const armored = setup({}, "python");
  normal.player.invulnerable = armored.player.invulnerable = 0;
  const normalSegment = normal.player.segments[2];
  const armorSegment = armored.player.segments[2];
  const beforeNormal = normalSegment.hp;
  const beforeArmor = armorSegment.hp;
  shootAt(normal.world, normal.player, 20, normalSegment);
  shootAt(armored.world, armored.player, 20, armorSegment);
  assert.ok(beforeArmor - armorSegment.hp < beforeNormal - normalSegment.hp);
  foodAt(normal.world, normal.player, "heal", 50);
  tick(normal.world);
  assert.equal(normalSegment.hp, normalSegment.maxHp);
});

test("dash and pulse activate once per cooldown and pulse kills enemies in range", () => {
  const { world, player } = setup();
  world.enemies.push({
    id: "target",
    type: "chaser",
    x: player.x + 60,
    y: player.y,
    hp: 30,
    maxHp: 30,
    radius: 10,
  });
  tick(world, 1, { dash: true, pulse: true });
  assert.ok(player.dashCooldown > 5);
  assert.ok(player.pulseCooldown > 8);
  assert.ok(player.speed > 300);
  assert.equal(player.kills, 1);
  assert.equal(world.enemies.length, 0);
  const cooldown = player.pulseCooldown;
  tick(world, 1, { pulse: true });
  assert.ok(player.pulseCooldown < cooldown);
});

test("the boss spawns at 80% and victory requires both surviving the duration and beating it", () => {
  const { world, player } = setup({ duration: 2 });
  player.invulnerable = 100;
  tick(world, 51);
  assert.equal(world.bossSpawned, true);
  const boss = world.enemies.find((enemy) => enemy.type === "boss");
  assert.ok(boss);
  tick(world, 12);
  assert.equal(world.status, "playing");
  boss.x = player.x + 40;
  boss.y = player.y;
  boss.hp = 1;
  tick(world, 1, { pulse: true });
  assert.equal(world.bossDefeated, true);
  assert.equal(world.status, "victory");
  assert.ok(player.score >= 1500, "final score includes the killing blow");
  const time = world.time;
  tick(world, 10);
  assert.equal(world.time, time);
});

test("fire hits nearby enemies and poison keeps dealing damage after leaving its aura", () => {
  for (const species of ["viper", "cobra"]) {
    const { world, player } = setup({}, species);
    const segment = player.segments.find((s) =>
      ["fire", "poison"].includes(s.type),
    );
    const target = {
      id: "element-target",
      type: "brute",
      x: segment.x + 70,
      y: segment.y,
      hp: 1000,
      maxHp: 1000,
      radius: 10,
      attackTimer: 100,
      slow: 0,
      hitFlash: 0,
      _contacts: Object.create(null),
      _poison: 0,
      _poisonDamage: 0,
      _poisonOwner: null,
    };
    world.enemies.push(target);
    player._elementTimer = 0;
    tick(world);
    assert.ok(target.hp < 1000, `${species} applies its elemental damage`);
    if (species === "cobra") {
      const before = target.hp;
      target.x = 100;
      target.y = 100;
      tick(world, 20);
      assert.ok(target.hp < before - 8, "poison persists outside aura range");
    }
  }
});

test("a real closed body loop damages enclosed enemies while preserving enemies outside", () => {
  const { world, player } = setup();
  player.segments = [];
  const center = { x: 1100, y: 900 };
  const radius = 56;
  player.x = center.x + radius;
  player.y = center.y;
  player.angle = Math.PI / 2;
  player._path = [];
  for (let i = 0; i <= 400; i++) {
    const angle = (-i * 2) / radius;
    player._path.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }
  for (let i = 0; i < 18; i++)
    player.segments.push({
      id: `loop-${i}`,
      type: "normal",
      x: 0,
      y: 0,
      hp: 34,
      maxHp: 34,
    });
  const makeEnemy = (id, x, y) => ({
    id,
    type: "brute",
    x,
    y,
    hp: 1000,
    maxHp: 1000,
    radius: 3,
    attackTimer: 100,
    slow: 0,
    hitFlash: 0,
    _contacts: Object.create(null),
    _poison: 0,
    _poisonDamage: 0,
  });
  const inside = makeEnemy("inside", center.x, center.y);
  const outside = makeEnemy("outside", center.x - 230, center.y);
  world.enemies = [inside, outside];
  tick(world, 1, { angle: Math.PI / 2 });
  assert.ok(world.effects.some((fx) => fx.type === "circle"));
  assert.ok(inside.hp < 1000);
  assert.equal(outside.hp, 1000);
});

test("snapshots are detached public data and do not expose the RNG or path history", () => {
  const { world, player } = setup();
  const snapshot = getSnapshot(world);
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  assert.equal(snapshot._rng, undefined);
  assert.equal(snapshot.players[0]._path, undefined);
  snapshot.players[0].segments[0].hp = 0;
  snapshot.players[0].upgrades.fire = 100;
  snapshot.foods[0].x = -999;
  assert.ok(player.segments[0].hp > 0);
  assert.equal(player.upgrades.fire, undefined);
  assert.ok(world.foods[0].x > 0);
});

test("player identities are unique, input names are bounded and player capacity is enforced", () => {
  const { world, player } = setup();
  assert.equal(addPlayer(world, { id: player.id }), null);
  assert.equal(addPlayer(world, { id: 5 }), null);
  const next = addPlayer(world, {
    id: "p2",
    name: "\u0000" + "A".repeat(100),
    species: "bad",
  });
  assert.equal(next.name.length, 24);
  assert.equal(next.species, "cobra");
  addPlayer(world, { id: "p3" });
  addPlayer(world, { id: "p4" });
  assert.equal(addPlayer(world, { id: "p5" }), null);
  removePlayer(world, "p2");
  assert.equal(world.players.length, 3);
  assert.ok(addPlayer(world, { id: "p5" }));
});

test("the opt-in ten-player world admits ten centered spawns and rejects an eleventh", () => {
  const world = createWorld({ mode: "coop", maxPlayers: 10 });
  for (let index = 0; index < 10; index++) {
    const player = addPlayer(world, { id: `p${index}` });
    assert.ok(player);
    assert.ok(Math.abs(player.x - world.width / 2) <= 135);
    assert.ok(Math.abs(player.y - world.height / 2) <= 150);
  }
  assert.equal(new Set(world.players.map((p) => `${p.x},${p.y}`)).size, 10);
  assert.deepEqual(
    world.players.slice(0, 4).map(({ x, y }) => [x, y]),
    [
      [1155, 850],
      [1245, 850],
      [1155, 950],
      [1245, 950],
    ],
  );
  assert.equal(addPlayer(world, { id: "eleventh" }), null);
  assert.equal(getSnapshot(world)._maxPlayers, undefined);
});

test("configured capacity handles invalid values and never exceeds the ten-player proof limit", () => {
  for (const [requested, expected] of [
    [0, 1],
    [2.9, 2],
    [30, 10],
    [Infinity, 4],
    [NaN, 4],
    ["10", 4],
  ]) {
    const world = createWorld({ maxPlayers: requested });
    for (let index = 0; index < expected; index++)
      assert.ok(addPlayer(world, { id: `player-${index}` }));
    assert.equal(addPlayer(world, { id: "over-capacity" }), null);
  }
});

test("ten independently steered players remain deterministic across every synchronized snapshot", () => {
  const worlds = [0, 1].map(() =>
    createWorld({ seed: 7421, mode: "coop", maxPlayers: 10 }),
  );
  for (const world of worlds) {
    for (let index = 0; index < 10; index++) {
      addPlayer(world, {
        id: `player-${index}`,
        species: ["cobra", "python", "viper"][index % 3],
      });
    }
  }
  const initial = getSnapshot(worlds[0]);
  for (let frame = 0; frame < 600; frame++) {
    const inputs = Object.fromEntries(
      worlds[0].players.map((player, index) => [
        player.id,
        {
          angle: frame / 90 + index * 0.65,
          throttle: Math.sin(frame / 50 + index),
          dash: frame % 180 === index * 12,
          pulse: frame % 270 === index * 20,
        },
      ]),
    );
    for (const world of worlds) {
      for (let index = 0; index < world.players.length; index++) {
        const player = world.players[index];
        if (player.choices.length)
          assert.equal(
            chooseUpgrade(
              world,
              player.id,
              player.choices[index % player.choices.length],
            ),
            true,
          );
      }
      stepWorld(world, inputs, 1 / 30);
    }
    if (frame % 30 === 0)
      assert.deepEqual(getSnapshot(worlds[0]), getSnapshot(worlds[1]));
  }
  const snapshot = getSnapshot(worlds[0]);
  assert.deepEqual(snapshot, getSnapshot(worlds[1]));
  assert.equal(snapshot.players.length, 10);
  assert.equal(snapshot.status, "playing");
  for (let index = 0; index < 10; index++) {
    assert.ok(Number.isFinite(snapshot.players[index].hp));
    assert.ok(
      Math.hypot(
        snapshot.players[index].x - initial.players[index].x,
        snapshot.players[index].y - initial.players[index].y,
      ) > 10,
    );
  }
});

test("entity counts stay bounded throughout a full-length simulation", () => {
  const { world, player } = setup({ seed: 9, mode: "coop" });
  player.invulnerable = 1000;
  for (let i = 0; i < 18000 && world.status === "playing"; i++) {
    const angle = Math.atan2(900 - player.y, 1200 - player.x) + Math.PI / 2;
    tick(world, 1, { angle, pulse: true, dash: i % 180 === 0 });
  }
  assert.ok(world.time >= 599);
  assert.ok(world.enemies.length <= 180);
  assert.ok(world.foods.length <= 360);
  assert.ok(world.projectiles.length <= 240);
  assert.ok(world.effects.length <= 100);
  assert.ok(player._path.length <= 700);
  assert.ok(player.segments.length <= 70);
  assert.ok(Number.isFinite(player.hp));
});

test("co-op contact attacks and retaliation have independent cooldowns for each player", () => {
  const { world, player } = setup({ mode: "coop" });
  const teammate = addPlayer(world, { id: "p2", species: "cobra" });
  teammate.x = player.x;
  teammate.y = player.y;
  teammate.angle = player.angle;
  teammate._path = player._path.map((point) => ({ ...point }));
  for (const p of world.players) {
    p._biteTimer = p._elementTimer = 100;
    p.invulnerable = 0;
  }
  const before = world.players.map((p) => p.hp);
  const enemy = {
    id: "contact-target",
    type: "brute",
    x: player.x,
    y: player.y - 12,
    hp: 1000,
    maxHp: 1000,
    radius: 24,
    attackTimer: 100,
    slow: 0,
    hitFlash: 0,
    _contacts: Object.create(null),
    _poison: 0,
    _poisonDamage: 0,
  };
  world.enemies.push(enemy);
  tick(world);
  assert.equal(
    enemy.hp,
    1000 - 19 * 2,
    "both snakes land their own contact hit",
  );
  assert.ok(player.hp < before[0], "first snake receives retaliation");
  assert.ok(teammate.hp < before[1], "second snake receives retaliation");
  assert.equal(
    enemy._lastHit,
    teammate.id,
    "the second attacker can receive hit credit",
  );
  tick(world);
  assert.equal(
    enemy.hp,
    1000 - 19 * 2,
    "neither player can bypass their contact cooldown",
  );
  enemy.x = 100;
  enemy.y = 100;
  tick(world, 20);
  assert.equal(
    Object.keys(enemy._contacts).length,
    0,
    "expired contact entries are discarded",
  );
});

test("expired strong poison cannot increase a later weaker poison application", () => {
  const { world, player } = setup({ mode: "coop" });
  player.upgrades.elements = 4;
  player._elementTimer = 0;
  const segment = player.segments.find((s) => s.type === "poison");
  const enemy = {
    id: "poison-target",
    type: "brute",
    x: segment.x + 70,
    y: segment.y,
    hp: 1000,
    maxHp: 1000,
    radius: 10,
    attackTimer: 100,
    slow: 0,
    hitFlash: 0,
    _contacts: Object.create(null),
    _poison: 0,
    _poisonDamage: 0,
    _poisonOwner: null,
  };
  world.enemies.push(enemy);
  tick(world);
  const strongDamage = enemy._poisonDamage;
  assert.ok(strongDamage > 30);
  enemy.x = 100;
  enemy.y = 100;
  player._elementTimer = 100;
  tick(world, 95);
  assert.equal(enemy._poison, 0);
  assert.equal(enemy._poisonDamage, 0);
  assert.equal(enemy._poisonOwner, null);
  player.upgrades.elements = 0;
  player._elementTimer = 0;
  const currentSegment = player.segments.find((s) => s.type === "poison");
  enemy.x = currentSegment.x + 70;
  enemy.y = currentSegment.y;
  const before = enemy.hp;
  tick(world);
  assert.ok(Math.abs(enemy._poisonDamage - 16.9) < 1e-8);
  assert.ok(
    Math.abs(before - enemy.hp - 16.9 / 30) < 1e-8,
    "new DOT uses only the weaker application",
  );
});
