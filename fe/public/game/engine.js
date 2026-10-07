import {
  initV2World,
  initV2Player,
  v2BeforeStep,
  v2AfterStep,
  v2Elements,
  positionBranches,
} from "./v2.js";
import { SPECIES, UPGRADE_DEFS, SEGMENT_DEFS } from "./content.js";
import {
  RARITIES,
  rollRarity,
  resolveTraits,
  hasTrait,
  rarityLevel,
} from "./builds.js";
import { SpatialGrid } from "./spatial.js";

// The simulation is intentionally platform-independent: both the solo browser
// and authoritative room server call the same fixed-step implementation.
const TAU = Math.PI * 2;
const STEP = 1 / 30;
const SPACING = 18;
// Keep the original four spawn positions; extend the same centered grid for
// the opt-in ten-player networking proof. This is not a 30-player capacity.
const SPAWN_OFFSETS = [
  [-45, -50],
  [45, -50],
  [-45, 50],
  [45, 50],
  [-135, -50],
  [135, -50],
  [-135, 50],
  [135, 50],
  [-45, 150],
  [45, 150],
];
const LIMITS = {
  players: 10,
  segments: 70,
  enemies: 180,
  foods: 360,
  projectiles: 240,
  effects: 100,
};
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finite = (n, fallback = 0) =>
  typeof n === "number" && Number.isFinite(n) ? n : fallback;
const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const wrapAngle = (n) => Math.atan2(Math.sin(n), Math.cos(n));
const balance = (w, key, fallback) => w._catalog?.balance[key] ?? fallback;
const spawning = (w, key, fallback) => w._catalog?.spawning?.[key] ?? fallback;
const loot = (w, key, fallback) => w._catalog?.loot?.[key] ?? fallback;
function foodType(world, weights) {
  let roll = random(world) * Object.values(weights).reduce((n, v) => n + v, 0);
  for (const [type, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return Object.keys(weights).at(-1);
}
const speciesStat = (p, key, fallback) =>
  p._catalog?.speciesStats?.[p.species]?.[key] ?? fallback;
const upgradeLevel = (p, key) => p.upgradePower?.[key] ?? p.upgrades[key] ?? 0;

function random(world) {
  let seed = (world._rng += 0x6d2b79f5);
  seed = Math.imul(seed ^ (seed >>> 15), seed | 1);
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61);
  world._rng >>>= 0;
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}

function nextId(world, prefix) {
  return `${prefix}${++world._id}`;
}

export function createWorld({
  seed = 1,
  mode = "solo",
  duration = 600,
  maxPlayers = 4,
  catalog = null,
} = {}) {
  if(!catalog&&!SPECIES.length)throw new Error('A published catalog is required.');
  const world = {
    width: 2400,
    height: 1800,
    time: 0,
    duration: clamp(finite(duration, 600), 0.1, 3600),
    mode:
      catalog?.modes.some((m) => m.id === mode) ||
      ["coop", "arena"].includes(mode)
        ? mode
        : "solo",
    status: "playing",
    players: [],
    enemies: [],
    foods: [],
    projectiles: [],
    effects: [],
    bossSpawned: false,
    bossDefeated: false,
    _rng: finite(seed, 1) >>> 0,
    _maxPlayers: Math.floor(
      clamp(
        finite(maxPlayers, 4),
        1,
        catalog?.limits.players || LIMITS.players,
      ),
    ),
    _id: 0,
    _spawnTimer: catalog?.spawning?.enemyStartSeconds ?? 1.8,
    _foodTimer: 0,
    _zones: [],
    _bursts: [],
    _arenaBossAt: 180,
  };
  if (catalog) initV2World(world, catalog, random);
  for (let i = 0; i < ((catalog?.world.initialFood ?? 170)); i++) {
    const roll = random(world);
    spawnFood(
      world,
      catalog?.spawning
        ? foodType(world, catalog.spawning.initialFoodWeights)
        : roll < 0.72
          ? "growth"
          : roll < 0.91
            ? "xp"
            : roll < 0.97
              ? "heal"
              : "gold",
    );
  }
  return world;
}

function segmentHealth(p, type) {
  return Math.round(
    (type === "armor"
      ? (p._catalog?.balance.armorHp ?? 72)
      : (p._catalog?.balance.segmentHp ?? 34)) *
      speciesStat(p, "hp", p.species === "python" ? 1.2 : 1) *
      (1 +
        (p._catalog?.balance.vitalityPerLevel ?? 0.18) *
          upgradeLevel(p, "vitality")),
  );
}

function addSegment(world, p, type = "normal") {
  if (
    p.segments.length >=
    (p._modifiers?.maxSegments || world._limits?.segments || LIMITS.segments)
  )
    return false;
  const tail = p.segments.at(-1) || p;
  const hp = segmentHealth(p, type);
  p.segments.push({
    id: nextId(world, "s"),
    x: tail.x,
    y: tail.y,
    type,
    hp,
    maxHp: hp,
  });
  p.maxLength = Math.max(p.maxLength, p.segments.length + 1);
  return true;
}

function updateIntegrity(p) {
  p.hp =
    Math.max(0, p._headHp) +
    p.segments.reduce((n, segment) => n + segment.hp, 0);
  p.maxHp =
    ((p._modifiers?.headHp ?? p._catalog?.balance.headHp ?? 24)) +
    p.segments.reduce((n, segment) => n + segment.maxHp, 0);
}

export function addPlayer(
  world,
  { id, name = "Wanderer", species = "cobra" } = {},
) {
  if (
    typeof id !== "string" ||
    !id.length ||
    id.length > 100 ||
    world.players.some((p) => p.id === id) ||
    world.players.length >= world._maxPlayers
  )
    return null;
  const definitions = world._catalog?.species || SPECIES;
  const kind = definitions.find((s) => s.id === species) || definitions[0];
  const slot = world.players.length;
  const spawn =
    (world._pvp ?? world.mode === "arena")
      ? safeSpawn(world)
      : {
          x:
            world.width / 2 +
            (SPAWN_OFFSETS[slot]?.[0] || Math.cos(slot) * 180),
          y:
            world.height / 2 +
            (SPAWN_OFFSETS[slot]?.[1] || Math.sin(slot) * 180),
        };
  const { x, y } = spawn;
  const p = {
    id,
    name:
      String(name)
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 24) || "Wanderer",
    species: kind.id,
    x,
    y,
    angle: -Math.PI / 2,
    segments: [],
    hp: 0,
    maxHp: 0,
    level: 1,
    xp: 0,
    xpNext: balance(world, "xpBase", 24),
    growth: 0,
    kills: 0,
    score: 0,
    gold: 0,
    alive: true,
    maxLength: 1,
    choices: [],
    upgrades: {},
    dashCooldown: 0,
    pulseCooldown: 0,
    circleCooldown: 0,
    invulnerable: 1.3,
    speed: 0,
    pulseRadius: balance(world, "pulseRadius", 175),
    choiceTime: 0,
    choiceRarities: {},
    upgradeRolls: [],
    upgradePower: {},
    traits: [],
    traitDiscoveries: [],
    lifeStarted: world.time,
    lifeId: "",
    bot: false,
    pvpKills: 0,
    spawnProtection:
      (world._pvp ?? world.mode === "arena")
        ? (world._catalog?.world.spawnProtection ?? 3)
        : 0,
    respawnAt: 0,
    _growthEarned: 0,
    _damage: 0,
    _bossDamage: 0,
    _xpEarned: 0,
    _deathHandled: false,
    _pvpContacts: {},
    _headHp: balance(world, "headHp", 24),
    _path: [],
    _dashTime: 0,
    _biteTimer: 0,
    _elementTimer: 0.4,
    _score: 0,
    _regenTimer: 0,
  };
  if (world._catalog) initV2Player(world, p);
  for (let i = 0; i < ((world._catalog?.world.initialSegments ?? 6)); i++)
    addSegment(world, p, i === 2 ? kind.startingSegment : "normal");
  for (let i = 0; i < 160; i++) p._path.push({ x, y: y + i * 4 });
  followBody(p);
  positionBranches(world, p);
  updateIntegrity(p);
  world.players.push(p);
  resolveTraits(p);
  // A visible first trail teaches movement and gives each spawn a useful start.
  for (let i = 0; i < 12; i++) {
    const angle = -Math.PI / 2 + i * 0.18;
    const radius = 90 + i * 19;
    spawnFood(
      world,
      i % 3 === 2 ? "xp" : "growth",
      x + Math.cos(angle) * radius,
      y + Math.sin(angle) * radius,
    );
  }
  return p;
}

export function removePlayer(world, id) {
  const index = world.players.findIndex((p) => p.id === id);
  if (index !== -1) world.players.splice(index, 1);
}

function effect(world, type, x, y, radius, color, life = 0.45) {
  if (world.effects.length >= (world._limits?.effects || LIMITS.effects))
    world.effects.shift();
  world.effects.push({
    id: nextId(world, "v"),
    type,
    x,
    y,
    radius,
    color,
    life,
    maxLife: life,
  });
}

function safeSpawn(world) {
  let best = { x: world.width / 2, y: world.height / 2 },
    bestScore = -Infinity;
  for (let attempt = 0; attempt < 40; attempt++) {
    const point = {
      x: 160 + random(world) * (world.width - 320),
      y: 160 + random(world) * (world.height - 320),
    };
    let score = 900;
    for (const p of world.players)
      if (p.alive) {
        score = Math.min(
          score,
          length(point, p) - Math.min(200, p.segments.length * 4),
        );
        for (const s of p.segments)
          score = Math.min(score, length(point, s) - 80);
      }
    for (const e of world.enemies)
      score = Math.min(
        score,
        length(point, e) - (e.type === "boss" ? 450 : 90),
      );
    score += world.foods.filter((f) => length(point, f) < 220).length * 2;
    if (score > bestScore) {
      bestScore = score;
      best = point;
    }
  }
  return best;
}

export function respawnPlayer(world, id) {
  const previous = world.players.find((p) => p.id === id);
  if (
    !(world._continuous ?? world.mode === "arena") ||
    !previous ||
    previous.alive ||
    world.time < previous.respawnAt
  )
    return null;
  const at = world.players.indexOf(previous);
  removePlayer(world, id);
  const next = addPlayer(world, {
    id,
    name: previous.name,
    species: previous.species,
  });
  next.bot = previous.bot;
  next.traitDiscoveries = [...previous.traitDiscoveries];
  world.players.splice(world.players.indexOf(next), 1);
  world.players.splice(at, 0, next);
  return next;
}

function finishArenaDeath(world, p) {
  if (p.alive || p._deathHandled) return;
  p._deathHandled = true;
  p.respawnAt = world.time + (world._catalog?.world.respawnSeconds ?? 4);
  p.choices = [];
  let value = Math.floor(
    p._growthEarned * (world._catalog?.world.deathGrowthFraction ?? 0.28),
  );
  const count = Math.min(
    balance(world, "deathGrowthOrbs", 20),
    Math.ceil(value / balance(world, "deathGrowthValue", 25)),
  );
  for (let i = 0; i < count; i++) {
    const portion =
      i === count - 1
        ? value
        : Math.min(balance(world, "deathGrowthValue", 25), value);
    value -= portion;
    const angle = (i * Math.PI * 2) / count;
    spawnFood(
      world,
      "growth",
      p.x + Math.cos(angle) * (20 + i * 2),
      p.y + Math.sin(angle) * (20 + i * 2),
      portion,
    );
  }
  const killer = world.players.find(
    (other) => other.id === p._lastAttacker && other.alive,
  );
  if (
    killer &&
    world.time - (p._lastAttackAt || 0) <
      balance(world, "pvpAttributionSeconds", 8)
  ) {
    killer.pvpKills++;
    world._duels ??= {};
    const key = `${killer.id}:${p.id}`;
    if (world._catalog) {
      const config = world._catalog.world,
        prior = world._duels[key],
        count =
          prior && world.time - prior.at < config.repeatKillWindow
            ? prior.count + 1
            : 0;
      const multiplier =
        config.repeatKillRewards[
          Math.min(count, config.repeatKillRewards.length - 1)
        ];
      world._duels[key] = { at: world.time, count };
      killer._score += balance(world, "pvpScore", 250) * multiplier;
      gainXp(world, killer, balance(world, "pvpXp", 25) * multiplier);
      if (world.director.crown?.id === p.id)
        killer.gold += world._catalog.crown.bountyGold * multiplier;
      if (world.director.apex?.id === p.id && count === 0) {
        const reward = world._catalog.apex;
        killer.apexKills++;
        killer._score += reward.rewardScore;
        gainXp(world, killer, reward.rewardXp);
        killer.temporaryLoot = Math.min(
          world._catalog.extraction.maxArtifacts,
          killer.temporaryLoot + reward.rewardArtifacts,
        );
        killer._apexBuffUntil = world.time + reward.buffSeconds;
      }
      for (const [id, record] of Object.entries(world._duels))
        if (world.time - record.at > config.repeatKillWindow)
          delete world._duels[id];
    } else {
      const repeated = world.time - (world._duels[key] ?? -Infinity) < 90;
      killer._score += repeated ? 25 : 250;
      world._duels[key] = world.time;
      for (const [id, time] of Object.entries(world._duels))
        if (world.time - time > 120) delete world._duels[id];
      gainXp(world, killer, repeated ? 2 : 25);
    }
  }
}

function hitPlayer(world, attacker, target, damage, index = -1) {
  if (!attacker.alive || !target.alive) return;
  attacker.spawnProtection = 0;
  if (target.spawnProtection > 0 || target.invulnerable > 0) return;
  target._lastAttacker = attacker.id;
  target._lastAttackAt = world.time;
  const before = target.hp;
  damagePlayer(world, target, damage * (attacker._modifiers?.pvp || 1), index);
  attacker._damage += Math.max(0, before - target.hp);
}

function arenaCombat(world) {
  const grid = new SpatialGrid(150);
  for (const p of world.players)
    if (p.alive) {
      grid.add({ x: p.x, y: p.y, owner: p, index: -1 });
      p.segments.forEach((s, i) =>
        grid.add({ x: s.x, y: s.y, owner: p, index: i }),
      );
    }
  for (const p of world.players)
    if (p.alive) {
      for (const hit of grid.query(
        p.x,
        p.y,
        balance(world, "pvpContactRadius", 35) + 13,
      )) {
        if (
          hit.owner === p ||
          !hit.owner.alive ||
          length(p, hit) > balance(world, "pvpContactRadius", 35)
        )
          continue;
        if ((p._pvpContacts[hit.owner.id] || 0) > world.time) continue;
        p._pvpContacts[hit.owner.id] =
          world.time + balance(world, "pvpContactSeconds", 0.55);
        hitPlayer(
          world,
          p,
          hit.owner,
          balance(world, "pvpDamage", 10) *
            (1 +
              balance(world, "fangsPerLevel", 0.22) * upgradeLevel(p, "fangs")),
          hit.index,
        );
        hitPlayer(
          world,
          hit.owner,
          p,
          balance(world, "pvpRetaliation", 6) *
            speciesStat(
              hit.owner,
              "bodyDamage",
              hit.owner.species === "python" ? 1.4 : 1,
            ),
        );
      }
    }
}

function spawnFood(world, type, x, y, value) {
  if (world.foods.length >= (world._limits?.foods || LIMITS.foods)) return;
  world.foods.push({
    id: nextId(world, "f"),
    type,
    x: clamp(
      finite(x, 45 + random(world) * (world.width - 90)),
      20,
      world.width - 20,
    ),
    y: clamp(
      finite(y, 45 + random(world) * (world.height - 90)),
      20,
      world.height - 20,
    ),
    value:
      value ??
      (((world._catalog?.foodValues ?? { growth: 25, xp: 8, heal: 32, gold: 3 })[
        type
      ] ??
        1)),
  });
}

function offerUpgrade(world, p) {
  if (!p.alive || p.choices.length || p.xp < p.xpNext) return;
  p.xp -= p.xpNext;
  p.level++;
  p.xpNext = Math.round(
    balance(world, "xpBase", 24) +
      (p.level - 1) * balance(world, "xpPerLevel", 12) +
      (p.level - 1) ** balance(world, "xpExponent", 1.45) *
        balance(world, "xpScale", 2),
  );
  const pool = (world._catalog?.upgradesList || UPGRADE_DEFS)
    .filter(
      (upgrade) =>
        upgradeLevel(p, upgrade.id) < balance(world, "upgradeStackCap", 8),
    )
    .map((upgrade) => upgrade.id);
  // A long run still receives choices after all ordinary stack caps are reached.
  if (pool.length < balance(world, "choiceCount", 3))
    for (const id of spawning(world, "upgradeFallback", [
      "fire",
      "poison",
      "armor",
      "growth",
    ]))
      if (!pool.includes(id)) pool.push(id);
  p.choices = [];
  while (p.choices.length < balance(world, "choiceCount", 3) && pool.length)
    p.choices.push(pool.splice(Math.floor(random(world) * pool.length), 1)[0]);
  p.choiceRarities = Object.fromEntries(
    p.choices.map((id) => [
      id,
      rollRarity(
        random(world),
        world.time - p.lifeStarted,
        upgradeLevel(p, "wisdom") * balance(world, "luckPerWisdom", 0.25),
        world._catalog,
      ),
    ]),
  );
  p.choiceTime = balance(world, "choiceSeconds", 5);
  effect(world, "level", p.x, p.y, 90, "#c4a1ff", 0.9);
}

function heal(world, p, amount) {
  let remaining = amount;
  const headHeal = Math.min(
    (p._modifiers?.headHp || balance(world, "headHp", 24)) - p._headHp,
    remaining,
  );
  p._headHp += headHeal;
  remaining -= headHeal;
  for (const segment of p.segments) {
    const healed = Math.min(segment.maxHp - segment.hp, remaining);
    segment.hp += healed;
    remaining -= healed;
  }
  if (
    remaining >= balance(world, "healRegrow", 20) &&
    p.segments.length + 1 < p.maxLength
  )
    addSegment(world, p);
  updateIntegrity(p);
  resolveTraits(p);
}

export function chooseUpgrade(world, id, upgradeId) {
  const p = world.players.find((player) => player.id === id);
  if (
    world.status !== "playing" ||
    !p?.alive ||
    typeof upgradeId !== "string" ||
    !p.choices.includes(upgradeId)
  )
    return false;
  // Stack counts stay integral; effectiveness is tracked separately by rarity.
  p.upgrades[upgradeId] = (p.upgrades[upgradeId] || 0) + 1;
  const rarity = p.choiceRarities?.[upgradeId] || "COMMON";
  const rarities = world._catalog?.rarities || RARITIES;
  const tier = rarities.find((t) => t.id === rarity) || rarities[0];
  p.upgradeRolls.push({ id: upgradeId, rarity: tier.id });
  p.upgradePower[upgradeId] = (p.upgradePower[upgradeId] || 0) + tier.power;
  p.choices = [];
  p.choiceRarities = {};
  p.choiceTime = 0;
  if (
    world._catalog
      ? Object.hasOwn(world._catalog.segments, upgradeId)
      : ["fire", "poison", "armor"].includes(upgradeId)
  ) {
    if (!addSegment(world, p, upgradeId)) {
      const target =
        p.segments.find((s) => s.type === "normal") || p.segments.at(-1);
      if (target) {
        target.type = upgradeId;
        target.maxHp = target.hp = segmentHealth(p, upgradeId);
      }
    }
  }
  if (upgradeId === "growth") {
    for (let i = 0; i < balance(world, "growthUpgradeSegments", 2); i++)
      addSegment(world, p);
  }
  if (upgradeId === "vitality") {
    for (const segment of p.segments)
      segment._baseHp =
        segment.hp =
        segment.maxHp =
          segmentHealth(p, segment.type);
    p._headHp = balance(world, "headHp", 24);
  }
  if (upgradeId === "wisdom") heal(world, p, balance(world, "wisdomHeal", 50));
  if (upgradeId === "pulse" || upgradeId === "agility") p.pulseCooldown = 0;
  if (upgradeId === "agility") p.dashCooldown = 0;
  p.pulseRadius =
    balance(world, "pulseRadius", 175) *
    (1 +
      balance(world, "pulseRadiusPerLevel", 0.12) * upgradeLevel(p, "pulse"));
  updateIntegrity(p);
  resolveTraits(p);
  offerUpgrade(world, p);
  return true;
}

function gainXp(world, p, amount) {
  p._xpEarned += amount;
  p.xp +=
    amount *
    (1 + balance(world, "wisdomPerLevel", 0.2) * upgradeLevel(p, "wisdom")) *
    (p._modifiers?.xp || 1);
  offerUpgrade(world, p);
}

function followBody(p) {
  let cursor = 0;
  let travelled = 0;
  for (let i = 0; i < p.segments.length; i++) {
    const desired = (i + 1) * SPACING;
    while (cursor + 1 < p._path.length) {
      const edge = length(p._path[cursor], p._path[cursor + 1]);
      if (travelled + edge >= desired) break;
      travelled += edge;
      cursor++;
    }
    const start = p._path[cursor];
    const end = p._path[cursor + 1] || start;
    const ratio = clamp(
      (desired - travelled) / Math.max(0.001, length(start, end)),
      0,
      1,
    );
    p.segments[i].x = start.x + (end.x - start.x) * ratio;
    p.segments[i].y = start.y + (end.y - start.y) * ratio;
  }
  // Keep enough historical path to grow, even while braking.
  let total = 0;
  const keep = Math.max(500, (p.segments.length + 5) * SPACING);
  for (let i = 1; i < p._path.length; i++) {
    total += length(p._path[i - 1], p._path[i]);
    if (total > keep) {
      p._path.length = i + 1;
      break;
    }
  }
  if (p._path.length > 700) p._path.length = 700;
}

function damagePlayer(world, p, amount, segmentIndex = -1) {
  if (!p.alive || p.invulnerable > 0 || p.spawnProtection > 0) return;
  const armor = p.segments.filter((s) => s.type === "armor").length;
  amount *=
    (1 -
      Math.min(
        balance(world, "armorMaxReduction", 0.4),
        armor * balance(world, "armorReduction", 0.055),
      )) *
    (p._modifiers?.damageTaken || 1);
  if (amount >= ((world._catalog?.extraction.heavyHit ?? 12)))
    p._heavyHitAt = world.time;
  const target = p.segments[segmentIndex] || p.segments.at(-1);
  if (target) {
    target.hp -=
      amount *
      (target.type === "armor" ? balance(world, "armorDamageTaken", 0.65) : 1);
    if (target.hp <= 0) {
      p.segments.splice(p.segments.indexOf(target), 1);
      resolveTraits(p);
      effect(
        world,
        "break",
        target.x,
        target.y,
        35,
        (world._catalog?.segments || SEGMENT_DEFS)[target.type]?.color ||
          "#a4c985",
      );
    }
  } else p._headHp -= amount;
  p.invulnerable = balance(world, "hitInvulnerability", 0.38);
  effect(world, "hit", p.x, p.y, 21, "#ff7b84", 0.2);
  if (p._headHp <= 0) {
    p.alive = false;
    p._headHp = 0;
    p.choices = [];
    effect(world, "death", p.x, p.y, 110, "#ff8ca0", 1.4);
  }
  updateIntegrity(p);
}

function damageEnemy(world, enemy, amount, p) {
  if (enemy.hp <= 0) return;
  const critical =
    !p._modifiers?.noCrit &&
    random(world) <
      speciesStat(p, "critChance", p.species === "viper" ? 0.18 : 0);
  amount *= p._modifiers?.damage || 1;
  const dealt = Math.min(
    enemy.hp,
    amount * (critical ? speciesStat(p, "critDamage", 1.8) : 1),
  );
  p._damage += dealt;
  if (enemy.type === "boss") p._bossDamage += dealt;
  enemy.hp -= amount * (critical ? speciesStat(p, "critDamage", 1.8) : 1);
  enemy.hitFlash = 0.13;
  enemy._lastHit = p.id;
  if (enemy.hp > 0) return;
  if (
    (enemy._burn > 0 &&
      enemy._poison > 0 &&
      (hasTrait(p, "toxic_ignition") || p.hybrids?.includes("toxic_flame"))) ||
    (enemy._burn > 0 && rarityLevel(p, "fire") >= 3)
  ) {
    if (world._bursts.length < 24)
      world._bursts.push({ x: enemy.x, y: enemy.y, owner: p.id });
  }
  p.kills++;
  if (p._modifiers?.killGrowth) {
    p.growth += balance(world, "foodGrowth", 25) * p._modifiers.killGrowth;
    while (p.growth >= balance(world, "growthPerSegment", 100)) {
      p.growth -= balance(world, "growthPerSegment", 100);
      addSegment(world, p);
    }
  }
  p._score += loot(world, "killScore", {
    boss: 1500,
    brute: 35,
    chaser: 15,
    swarm: 15,
    archer: 15,
  })[enemy.type];
  gainXp(
    world,
    p,
    loot(world, "killXp", {
      boss: 160,
      brute: 5,
      chaser: 2,
      swarm: 2,
      archer: 2,
    })[enemy.type],
  );
  spawnFood(
    world,
    "xp",
    enemy.x,
    enemy.y,
    loot(world, "dropXp", {
      boss: 90,
      brute: 14,
      chaser: 6,
      swarm: 6,
      archer: 6,
    })[enemy.type],
  );
  if (
    random(world) < loot(world, "growthChance", 0.36) ||
    enemy.type === "boss"
  )
    spawnFood(
      world,
      "growth",
      enemy.x + 12,
      enemy.y + 8,
      enemy.type === "boss"
        ? loot(world, "bossGrowthValue", 100)
        : loot(world, "growthValue", 25),
    );
  if (random(world) < loot(world, "healChance", 0.13) || enemy.type === "boss")
    spawnFood(
      world,
      "heal",
      enemy.x - 14,
      enemy.y - 8,
      loot(world, "healValue", 40),
    );
  if (random(world) < loot(world, "goldChance", 0.12))
    spawnFood(world, "gold", enemy.x - 8, enemy.y + 14);
  effect(
    world,
    "kill",
    enemy.x,
    enemy.y,
    enemy.radius * 1.8,
    enemy.type === "boss" ? "#fbd18d" : "#d3ea9a",
    enemy.type === "boss" ? 1.6 : 0.35,
  );
  if (enemy.type === "boss") {
    world.bossDefeated = true;
    for (const player of world.players.filter((player) => player.alive)) {
      heal(world, player, balance(world, "bossDeathHeal", 150));
      player.gold += balance(world, "bossDeathGold", 30);
    }
  }
}

function pulse(world, p) {
  const radius = p.pulseRadius;
  effect(world, "pulse", p.x, p.y, radius, "#94f4d7", 0.65);
  for (const enemy of world.enemies) {
    const distance = length(enemy, p);
    if (distance > radius + enemy.radius) continue;
    damageEnemy(
      world,
      enemy,
      balance(world, "pulseDamage", 65) *
        (1 + balance(world, "pulsePerLevel", 0.25) * upgradeLevel(p, "pulse")) *
        (hasTrait(p, "critical_wave")
          ? balance(world, "criticalWave", 1.2)
          : 1),
      p,
    );
    enemy.slow = balance(world, "pulseSlow", 1.4);
    const push = enemy.type === "boss" ? 18 : 75;
    enemy.x = clamp(
      enemy.x + ((enemy.x - p.x) / Math.max(1, distance)) * push,
      24,
      world.width - 24,
    );
    enemy.y = clamp(
      enemy.y + ((enemy.y - p.y) / Math.max(1, distance)) * push,
      24,
      world.height - 24,
    );
  }
  if (world._pvp ?? world.mode === "arena")
    for (const other of world.players) {
      if (other !== p && other.alive && length(other, p) < radius)
        hitPlayer(
          world,
          p,
          other,
          28 *
            (1 +
              balance(world, "pulsePerLevel", 0.25) * upgradeLevel(p, "pulse")),
        );
    }
}

function pointInPolygon(point, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function circle(world, p) {
  if (
    p.circleCooldown > 0 ||
    p.segments.length < balance(world, "circleMinSegments", 11) ||
    length(p, p.segments.at(-1)) > balance(world, "circleClosure", 45)
  )
    return;
  const vertices = [p, ...p.segments].map(({ x, y }) => ({ x, y }));
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area) < balance(world, "circleMinArea", 5000)) return;
  const x = vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length;
  const y = vertices.reduce((sum, v) => sum + v.y, 0) / vertices.length;
  const radius = Math.max(...vertices.map((v) => Math.hypot(v.x - x, v.y - y)));
  p.circleCooldown = balance(world, "circleCooldown", 8);
  world._zones.push({
    playerId: p.id,
    vertices,
    life: balance(world, "circleSeconds", 3),
  });
  effect(world, "circle", x, y, radius, "#e8d592", 3);
}

function movePlayer(world, p, raw, dt) {
  const input = raw && typeof raw === "object" ? raw : {};
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  p.pulseCooldown = Math.max(0, p.pulseCooldown - dt);
  p.circleCooldown = Math.max(0, p.circleCooldown - dt);
  p.invulnerable = Math.max(0, p.invulnerable - dt);
  p.spawnProtection = Math.max(0, p.spawnProtection - dt);
  p._dashTime = Math.max(0, p._dashTime - dt);
  if (input.dash === true && p.dashCooldown <= 0) {
    p.dashCooldown =
      balance(world, "dashCooldown", 6) *
      Math.max(
        balance(world, "skillMinimumCooldown", 0.3),
        1 -
          balance(world, "agilityPerLevel", 0.15) * upgradeLevel(p, "agility"),
      ) *
      (p._modifiers?.cooldown || 1);
    if (p._modifiers?.skillCost) p.segments.splice(-p._modifiers.skillCost);
    p._dashTime = balance(world, "dashSeconds", 0.42);
    p.invulnerable = balance(world, "dashInvulnerability", 0.46);
    effect(world, "dash", p.x, p.y, 40, "#c8ffe2", 0.45);
  }
  if (input.pulse === true && p.pulseCooldown <= 0) {
    p.pulseCooldown =
      balance(world, "pulseCooldown", 9) *
      Math.max(
        balance(world, "skillMinimumCooldown", 0.3),
        1 -
          balance(world, "agilityPerLevel", 0.15) * upgradeLevel(p, "agility"),
      ) *
      (p._modifiers?.cooldown || 1);
    p.spawnProtection = 0;
    if (p._modifiers?.skillCost) p.segments.splice(-p._modifiers.skillCost);
    pulse(world, p);
  }
  const throttle = clamp(finite(input.throttle), -1, 1);
  let desired = wrapAngle(finite(input.angle, p.angle));
  // Soft steering keeps a continuously moving snake from getting stuck at walls.
  const margin = 42;
  if (
    (p.x < margin && Math.cos(desired) < 0) ||
    (p.x > world.width - margin && Math.cos(desired) > 0) ||
    (p.y < margin && Math.sin(desired) < 0) ||
    (p.y > world.height - margin && Math.sin(desired) > 0)
  ) {
    desired = Math.atan2(world.height / 2 - p.y, world.width / 2 - p.x);
  }
  const turn =
    (((world._catalog?.balance.turn ?? 4.5)) *
      (1 +
        balance(world, "hasteTurnPerLevel", 0.14) * upgradeLevel(p, "haste")) *
      (p._modifiers?.turn || 1)) /
    (1 +
      Math.max(0, p.segments.length - 6) *
        balance(world, "lengthTurnPenalty", 0.025));
  p.angle = wrapAngle(
    p.angle + clamp(wrapAngle(desired - p.angle), -turn * dt, turn * dt),
  );
  const speciesSpeed = speciesStat(
    p,
    "speed",
    p.species === "python" ? 0.85 : p.species === "viper" ? 1.12 : 1,
  );
  p.speed =
    ((world._catalog?.balance.speed ?? 143)) *
    (p._modifiers?.speed || 1) *
    speciesSpeed *
    (1 +
      balance(world, "hasteSpeedPerLevel", 0.09) * upgradeLevel(p, "haste")) *
    (1 + throttle * balance(world, "throttleSpeed", 0.24)) *
    (p._dashTime > 0 ? balance(world, "dashSpeed", 2.75) : 1);
  p.x = clamp(p.x + Math.cos(p.angle) * p.speed * dt, 16, world.width - 16);
  p.y = clamp(p.y + Math.sin(p.angle) * p.speed * dt, 16, world.height - 16);
  if (length(p, p._path[0]) > 0.2) p._path.unshift({ x: p.x, y: p.y });
  followBody(p);
  positionBranches(world, p);
  circle(world, p);
  if (p.choices.length && world.mode !== "solo") {
    p.choiceTime = Math.max(0, p.choiceTime - dt);
    if (p.choiceTime <= 0) chooseUpgrade(world, p.id, p.choices[0]);
  }
}

function collectFood(world, p, dt) {
  const attraction =
    balance(world, "magnetRadius", 58) +
    balance(world, "magnetPerLevel", 36) * upgradeLevel(p, "magnet");
  for (let i = world.foods.length - 1; i >= 0; i--) {
    const food = world.foods[i];
    const distance = length(food, p);
    if (distance < attraction && distance > 22) {
      const move = Math.min(distance, (155 + (attraction - distance) * 3) * dt);
      food.x += ((p.x - food.x) / distance) * move;
      food.y += ((p.y - food.y) / distance) * move;
    }
    if (distance > 29) continue;
    world.foods.splice(i, 1);
    p._score += balance(world, "foodScore", 2);
    if (food.type === "growth") {
      p._growthEarned += food.value;
      p.growth +=
        food.value *
        (1 +
          balance(world, "growthPerLevel", 0.2) * upgradeLevel(p, "growth")) *
        (p._modifiers?.growth ?? 1);
      while (p.growth >= balance(world, "growthPerSegment", 100)) {
        p.growth -= balance(world, "growthPerSegment", 100);
        addSegment(world, p);
        resolveTraits(p);
      }
      gainXp(world, p, 1);
    } else if (food.type === "xp") gainXp(world, p, food.value);
    else if (food.type === "heal" && !p._modifiers?.noFoodHeal)
      heal(world, p, food.value);
    else if (food.type === "gold")
      p.gold += food.value * (p._modifiers?.gold || 1);
    effect(
      world,
      "pickup",
      food.x,
      food.y,
      14,
      food.type === "xp" ? "#c1a1ff" : "#abe9a1",
      0.2,
    );
  }
  updateIntegrity(p);
}

const ENEMY_STATS = {
  chaser: { hp: 34, radius: 13, speed: 69, damage: 8 },
  swarm: { hp: 15, radius: 8, speed: 105, damage: 5 },
  brute: { hp: 155, radius: 24, speed: 43, damage: 19 },
  archer: { hp: 47, radius: 14, speed: 58, damage: 10 },
  boss: { hp: 1900, radius: 63, speed: 55, damage: 24 },
};

function spawnEnemy(world, type, anchor) {
  if (
    world.enemies.length >= (world._limits?.enemies || LIMITS.enemies) &&
    type !== "boss"
  )
    return;
  if (world.enemies.length >= (world._limits?.enemies || LIMITS.enemies))
    world.enemies.shift();
  const stats = (world._catalog?.enemies || ENEMY_STATS)[type];
  const angle = random(world) * TAU;
  const distance =
    type === "boss"
      ? balance(world, "bossSpawnDistance", 470)
      : balance(world, "enemySpawnDistance", 500) +
        random(world) * balance(world, "enemySpawnSpread", 180);
  const scale =
    type === "boss"
      ? 1 +
        Math.max(0, world.players.length - 1) *
          balance(world, "bossPartyScale", 0.65)
      : 1 + world.time / balance(world, "enemyScaleSeconds", 650);
  const hp = Math.round(stats.hp * scale);
  world.enemies.push({
    id: nextId(world, "e"),
    type,
    x: clamp(
      anchor.x + Math.cos(angle) * distance,
      stats.radius + 12,
      world.width - stats.radius - 12,
    ),
    y: clamp(
      anchor.y + Math.sin(angle) * distance,
      stats.radius + 12,
      world.height - stats.radius - 12,
    ),
    hp,
    maxHp: hp,
    radius: stats.radius,
    angle: angle + Math.PI,
    slow: 0,
    hitFlash: 0,
    attackTimer: 0.6 + random(world),
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

function projectile(
  world,
  enemy,
  angle,
  speed = balance(world, "projectileSpeed", 185),
) {
  if (
    world.projectiles.length >=
    (world._limits?.projectiles || LIMITS.projectiles)
  )
    return;
  world.projectiles.push({
    id: nextId(world, "b"),
    x: enemy.x,
    y: enemy.y,
    angle,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: enemy.type === "boss" ? 7 : 5,
    damage:
      enemy.type === "boss"
        ? balance(world, "bossProjectileDamage", 16)
        : balance(world, "projectileDamage", 10),
    owner: enemy.id,
    team: "enemy",
    color: enemy.type === "boss" ? "#faac7f" : "#f4bc83",
    life: balance(world, "projectileSeconds", 5),
  });
}

function updateEnemies(world, dt) {
  const living = world.players.filter((p) => p.alive);
  if (!living.length) return;
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0) continue;
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    enemy.slow = Math.max(0, enemy.slow - dt);
    enemy._contacts ??= Object.create(null);
    for (const playerId of Object.keys(enemy._contacts)) {
      enemy._contacts[playerId] -= dt;
      if (enemy._contacts[playerId] <= 0) delete enemy._contacts[playerId];
    }
    enemy.attackTimer -= dt;
    if (enemy._burn > 0) {
      enemy._burn = Math.max(0, enemy._burn - dt);
      const owner = world.players.find((p) => p.id === enemy._burnOwner);
      if (owner?.alive)
        damageEnemy(
          world,
          enemy,
          ((world._catalog?.balance.burnDamage ?? 4)) *
            dt *
            (owner._modifiers?.burn || 1),
          owner,
        );
      if (enemy.hp <= 0) continue;
    }
    if (enemy._poison > 0) {
      const poisonTime = Math.min(dt, enemy._poison);
      enemy._poison = Math.max(0, enemy._poison - dt);
      const owner = world.players.find((p) => p.id === enemy._poisonOwner);
      if (owner?.alive)
        damageEnemy(world, enemy, enemy._poisonDamage * poisonTime, owner);
      if (enemy._poison <= 0) {
        enemy._poisonDamage = 0;
        enemy._poisonOwner = null;
      }
      if (enemy.hp <= 0) continue;
    }
    let target = living[0];
    for (const p of living)
      if (length(enemy, p) < length(enemy, target)) target = p;
    const distance = length(enemy, target);
    enemy.angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
    let speed =
      (world._catalog?.enemies || ENEMY_STATS)[enemy.type].speed *
      (enemy.slow > 0 ? balance(world, "enemySlowSpeed", 0.5) : 1);
    if (enemy.type === "archer") {
      if (distance < balance(world, "archerRetreatRadius", 220))
        speed *= -balance(world, "archerRetreatSpeed", 0.55);
      else if (distance < balance(world, "archerHoldRadius", 320)) speed = 0;
      if (
        enemy.attackTimer <= 0 &&
        distance < balance(world, "archerRange", 640)
      ) {
        projectile(world, enemy, enemy.angle);
        enemy.attackTimer = balance(world, "archerAttackSeconds", 2.2);
      }
    }
    if (enemy.type === "boss") {
      enemy.phase =
        enemy.hp < enemy.maxHp * balance(world, "bossPhaseFraction", 0.5)
          ? 2
          : 1;
      enemy._ability -= dt;
      if (enemy._ability <= 0 && enemy.warning <= 0 && enemy._charge <= 0) {
        enemy.warning = balance(world, "bossWarningSeconds", 1);
        enemy._chargeAngle = enemy.angle;
        effect(world, "warning", target.x, target.y, 80, "#ff7e72", 1);
      }
      if (enemy.warning > 0) {
        enemy.warning -= dt;
        speed = 0;
        if (enemy.warning <= 0) {
          enemy._charge = balance(world, "bossChargeSeconds", 0.85);
          enemy._ability =
            balance(world, "bossAbilitySeconds", 6) / enemy.phase;
        }
      }
      if (enemy._charge > 0) {
        enemy._charge -= dt;
        enemy.angle = enemy._chargeAngle;
        speed = balance(world, "bossChargeSpeed", 310);
      }
      if (enemy.attackTimer <= 0) {
        const count =
          enemy.phase === 2
            ? balance(world, "bossProjectilesFinal", 14)
            : balance(world, "bossProjectilesFirst", 10);
        for (let i = 0; i < count; i++)
          projectile(
            world,
            enemy,
            world.time * 0.2 + (i * TAU) / count,
            balance(world, "bossProjectileSpeed", 135),
          );
        enemy.attackTimer =
          enemy.phase === 2
            ? balance(world, "bossAttackFinal", 2.3)
            : balance(world, "bossAttackFirst", 3.2);
        effect(world, "boss", enemy.x, enemy.y, 88, "#f7b27a", 0.6);
      }
    }
    enemy.x = clamp(
      enemy.x + Math.cos(enemy.angle) * speed * dt,
      enemy.radius,
      world.width - enemy.radius,
    );
    enemy.y = clamp(
      enemy.y + Math.sin(enemy.angle) * speed * dt,
      enemy.radius,
      world.height - enemy.radius,
    );
    const contacts = world._bodyGrid
      ? nearBodies(world, enemy, enemy.radius + 15)
      : living.map((p) => ({
          p,
          index: p.segments.findIndex(
            (s) => length(enemy, s) < enemy.radius + 10,
          ),
        }));
    for (const { p, index } of contacts) {
      const damageBoost =
        1 + balance(world, "fangsPerLevel", 0.22) * upgradeLevel(p, "fangs");
      if (length(enemy, p) < enemy.radius + 15) {
        if (!enemy._contacts[p.id]) {
          damageEnemy(
            world,
            enemy,
            balance(world, "headContactDamage", 19) *
              damageBoost *
              (p._dashTime > 0 ? 2 : 1),
            p,
          );
          enemy._contacts[p.id] = 0.32;
          if (enemy.hp > 0)
            damagePlayer(
              world,
              p,
              (world._catalog?.enemies || ENEMY_STATS)[enemy.type].damage,
            );
        }
      } else {
        if (index >= 0 && !enemy._contacts[p.id]) {
          const segment = p.segments[index];
          const multiplier =
            speciesStat(p, "bodyDamage", p.species === "python" ? 1.4 : 1) *
            (segment.type === "armor"
              ? balance(world, "armorBodyDamage", 1.25)
              : 1);
          damageEnemy(
            world,
            enemy,
            balance(world, "bodyContactDamage", 12) * damageBoost * multiplier,
            p,
          );
          enemy._contacts[p.id] = balance(world, "enemyContactSeconds", 0.4);
          if (enemy.hp > 0)
            damagePlayer(
              world,
              p,
              (world._catalog?.enemies || ENEMY_STATS)[enemy.type].damage,
              index,
            );
        }
      }
    }
  }
}

function attacks(world, p, dt) {
  p._biteTimer -= dt;
  if (p._biteTimer <= 0) {
    let closest = null;
    for (const enemy of world._enemyGrid?.query(
      p.x,
      p.y,
      balance(world, "biteRadius", 67) + 83,
    ) || world.enemies) {
      if (
        enemy.hp <= 0 ||
        length(enemy, p) > enemy.radius + balance(world, "biteRadius", 67)
      )
        continue;
      const angle = Math.atan2(enemy.y - p.y, enemy.x - p.x);
      if (
        Math.abs(wrapAngle(angle - p.angle)) > balance(world, "biteAngle", 1.8)
      )
        continue;
      if (!closest || length(enemy, p) < length(closest, p)) closest = enemy;
    }
    if (closest) {
      damageEnemy(
        world,
        closest,
        balance(world, "biteDamage", 22) *
          (1 +
            balance(world, "fangsPerLevel", 0.22) * upgradeLevel(p, "fangs")),
        p,
      );
      effect(world, "bite", closest.x, closest.y, 22, "#e8f6ca", 0.18);
      p._biteTimer = balance(world, "biteSeconds", 0.48);
    }
  }
  p._elementTimer -= dt;
  if (p._elementTimer > 0) return;
  p._elementTimer = world._catalog?.balance.elementInterval ?? 0.85;
  inferno(world, p);
  v2Elements(world, p, V2_HELPERS);
  const boost =
    (1 +
      balance(world, "elementsPerLevel", 0.25) * upgradeLevel(p, "elements")) *
    (hasTrait(p, "volatile_chain")
      ? balance(world, "volatileChain", 1.15)
      : 1) *
    (p._modifiers?.element || 1);
  for (const segment of p.segments) {
    if (segment.type !== "fire" && segment.type !== "poison") continue;
    let hit = false;
    const radius =
      segment.type === "fire"
        ? balance(world, "fireRadius", 84) *
          (hasTrait(p, "fire_dominion")
            ? balance(world, "fireDominion", 1.25)
            : 1)
        : balance(world, "poisonRadius", 95);
    for (const enemy of world._enemyGrid?.query(
      segment.x,
      segment.y,
      radius + 80,
    ) || world.enemies) {
      if (enemy.hp <= 0 || length(enemy, segment) > radius + enemy.radius)
        continue;
      hit = true;
      if (segment.type === "fire") {
        enemy._burn =
          (world._catalog?.balance.burnSeconds ?? 2) *
          (hasTrait(p, "ember_crown")
            ? balance(world, "emberDuration", 2)
            : 1) *
          (world.director?.weather.burn ?? 1);
        enemy._burnOwner = p.id;
        damageEnemy(
          world,
          enemy,
          ((world._catalog?.balance.fireDamage ?? 17)) *
            boost *
            (1 +
              balance(world, "firePerLevel", 0.1) * upgradeLevel(p, "fire")) *
            (p._modifiers?.reactors?.[segment.id] || 1) *
            (p._modifiers?.fire || 1) *
            (p._modifiers?.evolution?.fire || 1),
          p,
        );
        if (rarityLevel(p, "fire") >= 2) {
          const spread = world.enemies.find(
            (e) =>
              e !== enemy &&
              e.hp > 0 &&
              length(e, enemy) < balance(world, "fireSpreadRadius", 100) &&
              !(e._burn > 0),
          );
          if (spread) {
            spread._burn = balance(world, "fireSpreadSeconds", 2);
            spread._burnOwner = p.id;
          }
        }
      } else {
        const poisonDamage =
          ((world._catalog?.balance.poisonDamage ?? 13)) *
          boost *
          speciesStat(p, "poison", p.species === "cobra" ? 1.3 : 1) *
          (p._modifiers?.reactors?.[segment.id] || 1) *
          (p._modifiers?.poison || 1);
        if (enemy._poison <= 0 || poisonDamage >= enemy._poisonDamage) {
          enemy._poisonDamage = poisonDamage;
          enemy._poisonOwner = p.id;
        }
        enemy._poison = world._catalog?.balance.poisonSeconds ?? 3;
        enemy.slow = Math.max(enemy.slow, balance(world, "poisonSlow", 0.6));
      }
    }
    if (hit)
      effect(
        world,
        segment.type,
        segment.x,
        segment.y,
        radius,
        (p._catalog?.segments||SEGMENT_DEFS)[segment.type].color,
        0.55,
      );
  }
}

function inferno(world, p) {
  p._burnTicks = (p._burnTicks || 0) + 1;
  if (
    rarityLevel(p, "fire") >= 4 &&
    p._burnTicks % balance(world, "infernoEvery", 5) === 0
  ) {
    effect(world, "pulse", p.x, p.y, 140, "#ff9565", 0.6);
    for (const e of world.enemies)
      if (length(e, p) < balance(world, "infernoRadius", 140))
        damageEnemy(world, e, balance(world, "infernoDamage", 38), p);
  }
}

function updateProjectiles(world, dt) {
  for (const shot of world.projectiles) {
    shot.life -= dt;
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    if (
      shot.x < 0 ||
      shot.y < 0 ||
      shot.x > world.width ||
      shot.y > world.height
    )
      shot.life = 0;
    if (shot.life <= 0) continue;
    const contacts = world._bodyGrid
      ? nearBodies(world, shot, shot.radius + 15)
      : world.players
          .filter((p) => p.alive)
          .map((p) => ({
            p,
            index: p.segments.findIndex(
              (s) => length(shot, s) < 10 + shot.radius,
            ),
          }));
    for (const { p, index } of contacts) {
      if (length(shot, p) < 15 + shot.radius || index >= 0) {
        damagePlayer(world, p, shot.damage, index);
        shot.life = 0;
        break;
      }
    }
  }
  world.projectiles = world.projectiles.filter((shot) => shot.life > 0);
}

function nearBodies(world, point, radius) {
  const hits = new Map();
  for (const hit of world._bodyGrid.query(point.x, point.y, radius)) {
    const p = hit.owner;
    if (!p.alive || length(point, hit) > radius - (hit.segment ? 5 : 0))
      continue;
    const index = hit.segment ? p.segments.indexOf(hit.segment) : -1;
    if (hit.segment && index < 0) continue;
    const old = hits.get(p.id);
    if (!old || index < old.index) hits.set(p.id, { p, index });
  }
  return hits.values();
}

export function stepWorld(world, inputs = {}, dt = STEP) {
  if (
    world.status !== "playing" ||
    (!world.players.length && !(world._continuous ?? world.mode === "arena"))
  )
    return;
  dt = clamp(finite(dt, STEP), 0, 0.1);
  if (dt <= 0) return;
  world.time += dt;
  v2BeforeStep(world, dt, V2_HELPERS);
  if (world._catalog) {
    world._enemyGrid = new SpatialGrid(160);
    for (const e of world.enemies) world._enemyGrid.add(e);
  }
  for (const fx of world.effects) fx.life -= dt;
  world.effects = world.effects.filter((fx) => fx.life > 0);
  for (const p of world.players)
    if (p.alive) {
      movePlayer(
        world,
        p,
        inputs && typeof inputs === "object" ? inputs[p.id] : null,
        dt,
      );
      collectFood(world, p, dt);
      attacks(world, p, dt);
    }
  const living = world.players.filter((p) => p.alive);
  if (!living.length) {
    if (world._continuous ?? world.mode === "arena")
      for (const p of world.players) finishArenaDeath(world, p);
    else world.status = "defeat";
    v2AfterStep(world, inputs, dt, V2_HELPERS);
    return;
  }
  world._spawnTimer -= dt;
  world._foodTimer -= dt;
  if (world._spawnTimer <= 0) {
    const progress = Math.min(1, world.time / world.duration);
    const count =
      spawning(world, "enemyBaseCount", 1) +
      Math.floor(progress * spawning(world, "enemyProgressCount", 2.5)) +
      Math.floor(
        (living.length - 1) * spawning(world, "enemyPlayerCount", 0.6),
      );
    for (let i = 0; i < count; i++) {
      const roll = random(world);
      const type =
        progress > spawning(world, "bruteFrom", 0.13) &&
        roll > spawning(world, "bruteRoll", 0.85)
          ? "brute"
          : progress > spawning(world, "archerFrom", 0.08) &&
              roll > spawning(world, "archerRoll", 0.64)
            ? "archer"
            : roll > spawning(world, "swarmRoll", 0.4)
              ? "swarm"
              : "chaser";
      spawnEnemy(
        world,
        type,
        living[Math.floor(random(world) * living.length)],
      );
    }
    world._spawnTimer = Math.max(
      spawning(world, "enemyMinimumSeconds", 0.42),
      spawning(world, "enemyBaseSeconds", 1.35) -
        progress * spawning(world, "enemyProgressSeconds", 0.85),
    );
  }
  if (world._foodTimer <= 0) {
    for (
      let i = 0;
      i < spawning(world, "foodBaseCount", 4) + living.length;
      i++
    ) {
      const type = world._catalog?.spawning
        ? foodType(world, world._catalog.spawning.foodWeights)
        : random(world) < 0.72
          ? "growth"
          : random(world) < 0.8
            ? "xp"
            : "heal";
      spawnFood(world, type);
    }
    world._foodTimer = spawning(world, "foodSeconds", 1.4);
  }
  if (
    !world._catalog &&
    (world._continuous ?? world.mode === "arena") &&
    world.time >= world._arenaBossAt &&
    !world.enemies.some((e) => e.type === "boss" && e.hp > 0)
  ) {
    world.bossSpawned = true;
    world.bossDefeated = false;
    world._arenaBossAt = world.time + 240;
    spawnEnemy(world, "boss", living[0]);
  } else if (
    (!world._catalog || ["solo", "coop"].includes(world.mode)) &&
    !(world._continuous ?? world.mode === "arena") &&
    !world.bossSpawned &&
    world.time >= world.duration * balance(world, "bossAtFraction", 0.8)
  ) {
    world.bossSpawned = true;
    spawnEnemy(world, "boss", living[0]);
  }
  if (world._catalog) {
    world._bodyGrid = new SpatialGrid(150);
    for (const p of living) {
      world._bodyGrid.add({ x: p.x, y: p.y, owner: p });
      for (const segment of p.segments)
        world._bodyGrid.add({ x: segment.x, y: segment.y, owner: p, segment });
    }
  }
  updateEnemies(world, dt);
  for (const zone of world._zones) {
    zone.life -= dt;
    const owner = world.players.find((p) => p.id === zone.playerId);
    if (!owner?.alive) continue;
    for (const enemy of world.enemies)
      if (enemy.hp > 0 && pointInPolygon(enemy, zone.vertices)) {
        damageEnemy(
          world,
          enemy,
          balance(world, "circleDamage", 42) * dt,
          owner,
        );
        enemy.slow = 0.5;
      }
  }
  world._zones = world._zones.filter((zone) => zone.life > 0);
  updateProjectiles(world, dt);
  const bursts = world._bursts.splice(0, 8);
  for (const burst of bursts) {
    const owner = world.players.find((p) => p.id === burst.owner && p.alive);
    if (!owner) continue;
    effect(world, "pulse", burst.x, burst.y, 110, "#e8a4f7", 0.5);
    for (const e of world.enemies)
      if (e.hp > 0 && length(e, burst) < balance(world, "burstRadius", 110))
        damageEnemy(world, e, balance(world, "burstDamage", 35), owner);
  }
  if (world._continuous ?? world.mode === "arena") {
    arenaCombat(world);
    for (const p of world.players) finishArenaDeath(world, p);
  }
  if (world._pvp && !world._continuous) arenaCombat(world);
  world.enemies = world.enemies.filter((enemy) => enemy.hp > 0);
  for (const p of world.players)
    if (p.alive)
      p.score = Math.floor(
        p._score +
          (world.time - p.lifeStarted) * balance(world, "survivalScore", 2) +
          p.gold * balance(world, "goldScore", 5),
      );
  if (
    !(world._continuous ?? world.mode === "arena") &&
    world.players.every((p) => !p.alive)
  )
    world.status = "defeat";
  else if (
    !(world._continuous ?? world.mode === "arena") &&
    world.time >= world.duration &&
    world.bossDefeated
  )
    world.status = "victory";
  v2AfterStep(world, inputs, dt, V2_HELPERS);
}

function publicFields(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => !key.startsWith("_")),
  );
}

export function getSnapshot(world, { includePaths = false } = {}) {
  return {
    width: world.width,
    height: world.height,
    time: world.time,
    duration: world.duration,
    mode: world.mode,
    status: world.status,
    ...(world._catalog
      ? {
          contentVersion: world._catalog.id,
          director: structuredClone(world.director),
        }
      : {}),
    bossSpawned: world.bossSpawned,
    bossDefeated: world.bossDefeated,
    players: world.players.map((p) => ({
      ...publicFields(p),
      ...(includePaths
        ? { bodyPath: p._path.map((point) => ({ x: point.x, y: point.y })) }
        : {}),
      upgradeRolls: p.upgradeRolls.map((roll) => ({ ...roll })),
      choiceRarities: { ...p.choiceRarities },
      upgradePower: { ...p.upgradePower },
      traits: p.traits.map((t) => ({ ...t })),
      traitDiscoveries: [...p.traitDiscoveries],
      segments: p.segments.map((segment) => ({ ...segment })),
      choices: [...p.choices],
      upgrades: { ...p.upgrades },
    })),
    enemies: world.enemies.map(publicFields),
    foods: world.foods.map((food) => ({ ...food })),
    projectiles: world.projectiles.map((shot) => ({ ...shot })),
    effects: world.effects.map((fx) => ({ ...fx })),
  };
}

const V2_HELPERS = {
  random,
  addSegment,
  heal,
  damagePlayer,
  damageEnemy,
  effect,
  spawnEnemy,
  spawnFood,
  gainXp,
  pointInPolygon,
};
