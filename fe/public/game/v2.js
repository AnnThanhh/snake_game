import { SpatialGrid } from "./spatial.js";
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const has = (p, key, id) => p[key]?.includes(id);
const find = (w, key, id) => w._catalog[key].find((d) => d.id === id);
export function initV2World(world, catalog, random) {
  world._catalog = structuredClone(catalog);
  world._limits = world._catalog.limits;
  world.width = catalog.world.width;
  world.height = catalog.world.height;
  world._pvp = Boolean(catalog.modes.find((m) => m.id === world.mode)?.pvp);
  world._continuous = Boolean(
    catalog.modes.find((m) => m.id === world.mode)?.continuous,
  );
  world.director = {
    events: [],
    weather: catalog.weather[0],
    biomes: catalog.biomes,
    shrine: null,
    portal: null,
    raid: null,
    crown: null,
    objectives: [],
    announcements: [],
    season: catalog.season,
  };
  world.director.biomes = world._catalog.biomes.map((b) => {
    const choices =
      world._catalog.biomeModifiers?.filter((m) => m.biome === b.id) || [];
    return {
      ...b,
      ...(choices.length
        ? {
            modifier: structuredClone(
              choices[Math.floor(random(world) * choices.length)],
            ),
          }
        : {}),
    };
  });
  world._eventIndex = 0;
  world._cycle = 0;
  world._directorAt = 0;
  world._weatherIndex = 0;
}
export function initV2Player(world, p) {
  p._catalog = world._catalog;
  p.organs = [];
  p.keystones = [];
  p.curses = [];
  p.mutations = [];
  p.hybrids = [];
  p.evolutions = [];
  p.evolutionPoints = 0;
  p._lastV2Level = 1;
  p._modifiers = {};
  p.temporaryLoot = 0;
  p.extracted = false;
  p.extractionProgress = 0;
  p.objectives = 0;
  p.reviveProgress = 0;
  p.apexKills = 0;
}
export function chooseEvolution(world, id, { kind, choice, index }) {
  const p = world.players.find((p) => p.id === id),
    c = world._catalog;
  if (
    !c ||
    !p?.alive ||
    p.evolutionPoints < 1 ||
    !["organs", "keystones", "curses", "mutations"].includes(kind)
  )
    return false;
  const def = c[kind].find((d) => d.id === choice);
  if (!def) return false;
  if (c.features?.[kind] === false) return false;
  if (kind === "organs") {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= p.segments.length ||
      p.organs.some((o) => o.segmentId === p.segments[index].id)
    )
      return false;
    p.organs.push({ id: choice, segmentId: p.segments[index].id });
  } else {
    if (
      p[kind].includes(choice) ||
      (kind === "keystones" && p.keystones.length >= c.world.maxKeystones) ||
      (kind === "curses" && p.curses.length >= c.world.maxCurses) ||
      (kind === "mutations" && p.mutations.length >= c.mutations.length)
    )
      return false;
    p[kind].push(choice);
  }
  p.evolutionPoints--;
  return true;
}
export function v2BeforeStep(w, dt, h) {
  const c = w._catalog;
  if (!c) return;
  const weather = w.director.weather;
  for (const p of w.players) {
    p._scoreBefore = p._score;
    p._goldBefore = p.gold;
    p.organs = p.organs.filter((o) =>
      p.segments.some((s) => s.id === o.segmentId),
    );
    const m = (p._modifiers = {
      damage: 1,
      element: 1,
      growth: 1,
      xp: 1,
      speed: p.temporaryLoot ? (c.extraction.carrierSpeed ?? 0.9) : 1,
      turn: 1,
      cooldown: weather.cooldown,
      vision: weather.vision,
      pvp: 1,
      gold: 1,
      burn: 1,
      fire: weather.fire,
      poison: weather.poison,
      lightning: weather.lightning,
      damageTaken: 1,
      evolution: {},
    });
    for (const organ of p.organs) {
      const def = find(w, "organs", organ.id),
        at = p.segments.findIndex((s) => s.id === organ.segmentId);
      if (!def) continue;
      if (def.handler === "regen" && p.alive)
        for (const s of p.segments.slice(
          Math.max(0, at - def.reach),
          at + def.reach + 1,
        ))
          s.hp = Math.min(s.maxHp, s.hp + s.maxHp * def.amount * dt);
      if (def.handler === "cooldown") m.cooldown *= 1 - def.amount;
      if (def.handler === "vision") m.vision += def.amount;
      if (def.handler === "growth") m.growth += def.amount;
      if (def.handler === "adrenal" && p.hp < p.maxHp * def.threshold) {
        m.speed += def.speed;
        m.damage += def.damage;
      }
      if (def.handler === "reactor") {
        m.reactors ??= {};
        for (const s of p.segments.slice(
          Math.max(0, at - def.reach),
          at + def.reach + 1,
        ))
          m.reactors[s.id] = (m.reactors[s.id] || 1) + def.amount;
      }
    }
    for (const id of p.keystones) {
      const d = find(w, "keystones", id);
      if (d.handler === "pyromaniac") {
        m.noCrit = true;
        m.burn *= d.burn;
      }
      if (d.handler === "conductor") {
        m.lightningDirect = d.damage;
        m.extraChains = d.chains;
      }
      if (d.handler === "immortal") {
        m.headHp = d.headHp;
        m.damageTaken *= d.damageTaken;
      }
      if (d.handler === "predator") {
        m.growth = 0;
        m.killGrowth = d.killGrowth;
      }
      if (d.handler === "pacifist") {
        m.pvp *= d.pvp;
        m.growth *= d.growth;
        m.objective = d.objective;
      }
    }
    for (const id of p.curses) {
      const d = find(w, "curses", id);
      if (d.handler === "void_heart") {
        m.damage *= d.damage;
        m.maxSegments = Math.floor(c.limits.segments * d.length);
      }
      if (d.handler === "blood_engine") {
        m.cooldown *= d.cooldown;
        m.skillCost = d.segmentCost;
      }
      if (d.handler === "greed") {
        m.gold *= d.gold;
        m.noFoodHeal = true;
      }
      if (d.handler === "fragile") {
        m.xp *= d.xp;
        m.hp = d.hp;
      }
      if (d.handler === "unstable") {
        m.element *= d.element;
        if (w.time >= (p._unstableAt || 0)) {
          p._unstableAt = w.time + d.interval;
          const s = p.segments[Math.floor(h.random(w) * p.segments.length)];
          if (s) s.hp = Math.max(1, s.hp - d.damage);
        }
      }
    }
    const biome = w.director.biomes.find(
      (b) =>
        p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height,
    );
    if (biome) {
      m.fire *= biome.fire || 1;
      m.lightning *= biome.lightning || 1;
      const modifier = biome.modifier;
      if (modifier)
        for (const key of ["fire", "lightning", "vision", "speed", "growth"])
          m[key] *= modifier[key];
      const damage = (biome.damage || 0) + (modifier?.damage || 0);
      if (damage && p.alive) {
        p._biomeAt = (p._biomeAt || 0) + dt;
        if (p._biomeAt >= 1) {
          p._biomeAt = 0;
          h.damagePlayer(w, p, damage);
        }
      }
    }
    if (w.director.shrine?.owner === p.id && w.director.shrine.until > w.time) {
      m.xp *= w.director.shrine.buff;
      m.growth *= w.director.shrine.buff;
    }
    if (w.director.crown?.id === p.id) {
      m.growth *= c.crown.growth;
      m.xp *= c.crown.xp;
      p._score += c.crown.scorePerSecond * dt;
    }
    if (c.apex && p._apexBuffUntil > w.time) m.damage *= c.apex.buffDamage;
    if (has(p, "mutations", "twin_spine")) {
      m.speed *= 1 - c.world.branchSpeedPenalty;
      m.turn *= 1 - c.world.branchTurnPenalty;
    }
    for (const s of p.segments) {
      const normal = s._baseHp ?? s.maxHp;
      s._baseHp = normal;
      const d =
        has(p, "mutations", "armored_core") && s.type === "armor"
          ? find(w, "mutations", "armored_core").hp
          : 1;
      const max = normal * (m.hp || 1) * d;
      if (s.maxHp !== max) {
        s.hp = Math.max(1, (s.hp * max) / s.maxHp);
        s.maxHp = max;
      }
    }
    if (m.headHp) p._headHp = Math.min(p._headHp, m.headHp);
    if (p.level > p._lastV2Level) {
      for (let level = p._lastV2Level + 1; level <= p.level; level++)
        if (level % (c.world.evolutionEveryLevels ?? 2) === 0)
          p.evolutionPoints++;
      p._lastV2Level = p.level;
    }
    const types = new Set(p.segments.map((s) => s.type));
    p.hybrids = c.hybrids
      .filter((d) => d.requires.every((t) => types.has(t)))
      .map((d) => d.id);
    p.evolutions = c.evolutions
      .filter(
        (d) =>
          p.segments.filter((s) => s.type === d.element).length >= d.required,
      )
      .map((d) => d.id);
    for (const d of c.evolutions)
      if (p.evolutions.includes(d.id)) m.evolution[d.element] = d.damage;
    if (p.hybrids.includes("living_armor") && p.alive)
      h.heal(w, p, find(w, "hybrids", "living_armor").heal * dt);
  }
}
export function positionBranches(w, p) {
  if (!w._catalog || !has(p, "mutations", "twin_spine")) return;
  const c = w._catalog.world;
  p.segments.forEach((s, i) => {
    if (i > 0 && i % c.branchInterval === 0) {
      const parent = p.segments[i - 1],
        prior = p.segments[i - 2] || p;
      const angle = Math.atan2(parent.y - prior.y, parent.x - prior.x);
      s.x = parent.x + Math.cos(angle + Math.PI / 2) * c.branchOffset;
      s.y = parent.y + Math.sin(angle + Math.PI / 2) * c.branchOffset;
      s.branchParent = parent.id;
      s.branchOffset = c.branchOffset;
    } else delete s.branchParent;
  });
}
export function v2Elements(w, p, h) {
  if (!w._catalog) return;
  const c = w._catalog,
    grid = w._enemyGrid || new SpatialGrid(160);
  if (!w._enemyGrid) for (const e of w.enemies) grid.add(e);
  for (let i = 0; i < p.segments.length; i++) {
    const s = p.segments[i];
    if (s.type === "regen") {
      for (const x of p.segments.slice(Math.max(0, i - 2), i + 3))
        x.hp = Math.min(x.maxHp, x.hp + c.balance.regenAmount);
      continue;
    }
    if (!["ice", "lightning"].includes(s.type)) continue;
    const radius =
        c.balance.elementRadius *
        (s.type === "lightning" ? p._modifiers.lightning : 1),
      candidates = grid
        .query(s.x, s.y, radius)
        .filter((e) => e.hp > 0 && distance(e, s) < radius + e.radius);
    let count =
      s.type === "ice"
        ? candidates.length
        : c.balance.lightningChains + (p._modifiers.extraChains || 0);
    for (const e of candidates) {
      if (count-- <= 0) break;
      h.damageEnemy(
        w,
        e,
        c.balance[s.type + "Damage"] *
          (s.type === "lightning" ? p._modifiers.lightningDirect || 1 : 1) *
          p._modifiers.element *
          (p._modifiers.evolution[s.type] || 1) *
          (p._modifiers.reactors?.[s.id] || 1),
        p,
      );
      if (s.type === "ice" || p.hybrids.includes("storm_ice"))
        e.slow = Math.max(e.slow, find(w, "hybrids", "storm_ice").slow);
      h.effect(w, s.type, e.x, e.y, 25, c.segments[s.type].color, 0.3);
    }
  }
}
function award(w, p, amount, h) {
  p.objectives++;
  p.temporaryLoot = Math.min(
    w._catalog.extraction.maxArtifacts,
    p.temporaryLoot + Math.ceil(amount * (p._modifiers.objective || 1)),
  );
  h.gainXp(w, p, amount * (w._catalog.objectives?.xpMultiplier ?? 3));
}
function eventStart(w, def, h) {
  const point = {
    x: w.width * (0.2 + h.random(w) * 0.6),
    y: w.height * (0.2 + h.random(w) * 0.6),
  };
  const event = {
    ...def,
    ...point,
    key: `${w._cycle}:${def.id}`,
    started: w.time,
    until: w.time + def.duration,
  };
  w.director.events.push(event);
  w.director.announcements.push({ id: event.key, text: def.name, at: w.time });
  w.director.announcements = w.director.announcements.slice(-5);
  if (def.id === "shrine")
    w.director.shrine = {
      ...event,
      owner: null,
      contested: false,
      progress: 0,
    };
  if (def.id === "nest")
    w.director.objectives.push({
      ...event,
      type: "nest",
      hp: def.hp,
      maxHp: def.hp,
    });
  if (def.id === "boss" && w.mode !== "raid") {
    h.spawnEnemy(w, "boss", point);
  }
  if (def.id === "meteor")
    for (let i = 0; i < (w._catalog.objectives?.meteorFoodCount ?? 12); i++)
      h.spawnFood(
        w,
        "growth",
        point.x +
          (h.random(w) - 0.5) * (w._catalog.objectives?.meteorSpread ?? 300),
        point.y +
          (h.random(w) - 0.5) * (w._catalog.objectives?.meteorSpread ?? 300),
        def.reward,
      );
  if (def.id === "golden")
    for (let i = 0; i < (w._catalog.objectives?.goldenFoodCount ?? 60); i++)
      h.spawnFood(w, "gold");
}
export function v2AfterStep(w, inputs, dt, h) {
  const c = w._catalog;
  if (!c) return;
  const living = w.players.filter((p) => p.alive && !p.extracted);
  const king = living.find((p) => p.id === w.director.crown?.id);
  if (king) {
    const earned =
      Math.max(0, king._score - (king._scoreBefore ?? king._score)) +
      (king.gold - (king._goldBefore ?? king.gold)) *
        (c.balance.goldScore ?? 5) +
      (c.balance.survivalScore ?? 2) * dt;
    king._score += earned * ((c.crown.scoreGain ?? 1) - 1);
  }
  for (const p of w.players) {
    positionBranches(w, p);
    if (!p.alive && !p._v2Death) {
      p._v2Death = true;
      const keep = Math.floor(p.temporaryLoot * (1 - c.extraction.deathLoss));
      w.director.objectives.push({
        id: `loot:${p.lifeId || p.id}`,
        type: "relic",
        x: p.x,
        y: p.y,
        value: p.temporaryLoot - keep,
        until: w.time + (c.objectives?.lootLifetime ?? 60),
      });
      p.temporaryLoot = keep;
    }
  }
  // Slow systems are independent from combat frequency.
  if (w.time >= w._directorAt) {
    const elapsed = 1 / c.world.directorHz;
    w._directorAt = w.time + elapsed;
    const cycle = Math.floor((w.time - 0.00001) / c.world.eventLoopSeconds),
      local = w.time - cycle * c.world.eventLoopSeconds;
    if (cycle !== w._cycle) {
      w._cycle = cycle;
      w._eventIndex = 0;
    }
    while (
      w._eventIndex < c.events.length &&
      local >= c.events[w._eventIndex].at
    )
      eventStart(w, c.events[w._eventIndex++], h);
    w.director.weather =
      c.weather[Math.floor(w.time / c.world.weatherSeconds) % c.weather.length];
    w.director.events = w.director.events.filter((e) => e.until > w.time);
    for (const e of w.director.events)
      if (
        e.damage &&
        w.time - e.started > (c.objectives?.hazardWarningSeconds ?? 2)
      )
        for (const p of living)
          if (distance(p, e) < e.radius)
            h.damagePlayer(w, p, e.damage * elapsed);
    const shrine = w.director.shrine;
    if (shrine && shrine.until > w.time) {
      const contenders = living.filter((p) =>
        w._zones.some(
          (z) => z.playerId === p.id && h.pointInPolygon(shrine, z.vertices),
        ),
      );
      shrine.contested = contenders.length > 1;
      if (contenders.length === 1) {
        if (shrine.capturing !== contenders[0].id) {
          shrine.capturing = contenders[0].id;
          shrine.progress = 0;
        }
        shrine.progress += elapsed;
        if (
          shrine.progress >= shrine.captureSeconds &&
          shrine.owner !== contenders[0].id
        ) {
          shrine.owner = contenders[0].id;
          award(w, contenders[0], c.objectives?.shrineReward ?? 5, h);
        }
      } else shrine.progress = 0;
    } else w.director.shrine = null;
    for (const objective of w.director.objectives) {
      if (objective.type === "nest") {
        for (const p of living)
          if (
            distance(p, objective) < (c.objectives?.nestAttackRadius ?? 120)
          ) {
            objective.hp -= c.balance.biteDamage * elapsed;
            if (objective.hp <= 0) {
              award(w, p, c.objectives?.nestReward ?? 10, h);
              objective.until = 0;
              break;
            }
          }
        if (w.time >= (objective.nextSpawn || 0)) {
          objective.nextSpawn = w.time + (c.objectives?.nestSpawnSeconds ?? 3);
          h.spawnEnemy(w, "swarm", objective);
        }
      }
      if (objective.type === "relic") {
        const p = living.find(
          (p) => distance(p, objective) < (c.objectives?.pickupRadius ?? 40),
        );
        if (p) {
          p.temporaryLoot = Math.min(
            c.extraction.maxArtifacts,
            p.temporaryLoot + objective.value,
          );
          objective.until = 0;
        }
      }
      if (objective.type === "escort") {
        const allies = living.filter(
          (p) => distance(p, objective) < (c.objectives?.escortRadius ?? 160),
        );
        if (allies.length) {
          objective.x += (c.objectives?.escortSpeed ?? 25) * elapsed;
          if (objective.x > objective.targetX) {
            allies.forEach((p) =>
              award(w, p, c.objectives?.escortReward ?? 5, h),
            );
            objective.until = 0;
          }
        }
      }
    }
    w.director.objectives = w.director.objectives.filter(
      (o) => o.until > w.time,
    );
    if (w.mode === "extraction" && w.time >= (w._relicAt || 0)) {
      w._relicAt = w.time + (c.extraction.relicSeconds ?? 20);
      w.director.objectives.push({
        id: `relic:${w.time}`,
        type: "relic",
        x: w.width * (0.2 + h.random(w) * 0.6),
        y: w.height * (0.2 + h.random(w) * 0.6),
        value: c.extraction.relicValue ?? 5,
        until: w.time + (c.extraction.relicLifetime ?? 120),
      });
    }
    if (w.time >= (w._escortAt ?? c.objectives?.escortStart ?? 180)) {
      w._escortAt = w.time + (c.objectives?.escortPeriod ?? 240);
      w.director.objectives.push({
        id: `escort:${w.time}`,
        type: "escort",
        x: 300,
        y: w.height / 2,
        targetX: 300 + (c.objectives?.escortDistance ?? 350),
        until: w.time + (c.objectives?.escortLifetime ?? 90),
      });
    }
    if (w.mode === "crown") {
      const king = living
        .filter((p) => p.segments.length + 1 >= c.crown.minimumLength)
        .sort((a, b) => b.segments.length - a.segments.length)[0];
      w.director.crown = king
        ? {
            id: king.id,
            x: Math.round(king.x / 100) * 100,
            y: Math.round(king.y / 100) * 100,
            bounty: c.crown.bountyGold,
          }
        : null;
    }
    if (c.apex && w._pvp) {
      const apex = living
        .filter(
          (p) =>
            p.segments.length + 1 >= c.apex.minimumLength &&
            p.pvpKills >= c.apex.minimumKills &&
            p.score >= c.apex.minimumScore,
        )
        .sort((a, b) => b.score - a.score)[0];
      w.director.apex = apex
        ? {
            id: apex.id,
            x: Math.round(apex.x / 100) * 100,
            y: Math.round(apex.y / 100) * 100,
          }
        : null;
    }
    for (const p of living) {
      const supports = living.filter(
        (other) =>
          other !== p &&
          other.mutations.includes("symbiosis") &&
          distance(p, other) < find(w, "mutations", "symbiosis").radius,
      ).length;
      if (supports)
        h.heal(
          w,
          p,
          find(w, "mutations", "symbiosis").heal *
            Math.sqrt(supports) *
            elapsed,
        );
    }
  }
  if (w.mode === "extraction") {
    const cycle = Math.floor(w.time / c.extraction.period),
      open =
        cycle > 0 && w.time % c.extraction.period < c.extraction.openSeconds;
    w.director.portal = open
      ? {
          x: w.width / 2,
          y: w.height / 2,
          radius: c.extraction.radius,
          closesAt: cycle * c.extraction.period + c.extraction.openSeconds,
        }
      : null;
    for (const p of living) {
      const channel =
        open &&
        distance(p, w.director.portal) < c.extraction.radius &&
        inputs[p.id]?.interact === true &&
        w.time - (p._heavyHitAt ?? -Infinity) >
          (c.extraction.hitInterruptSeconds ?? 0.25);
      p.extractionProgress = channel ? p.extractionProgress + dt : 0;
      if (p.extractionProgress >= c.extraction.channelSeconds) {
        p.extracted = true;
        p.alive = false;
        p.choices = [];
        p._v2Death = true;
        p._deathHandled = true;
      }
    }
    if (w.players.length && w.players.every((p) => !p.alive))
      w.status = w.players.some((p) => p.extracted) ? "victory" : "defeat";
  }
  if (w.mode === "raid") raid(w, living, dt, h);
  if (!w._pvp)
    for (const p of w.players.filter((p) => !p.alive && !p.extracted)) {
      const helpers = living.filter((other) =>
        w._zones.some(
          (z) => z.playerId === other.id && h.pointInPolygon(p, z.vertices),
        ),
      );
      p.reviveProgress = helpers.length ? p.reviveProgress + dt : 0;
      if (p.reviveProgress >= c.world.reviveSeconds) {
        p.alive = true;
        p._headHp = c.balance.headHp;
        p.segments = [];
        for (let i = 0; i < c.world.reviveSegments; i++) h.addSegment(w, p);
        p.invulnerable = c.world.spawnProtection;
        p.reviveProgress = 0;
        p._v2Death = false;
        p._deathHandled = false;
        w.status = "playing";
      }
    }
}
function raid(w, living, dt, h) {
  const c = w._catalog.raid;
  if (!w.director.raid && w.time >= c.spawnAt) {
    const x = w.width / 2,
      y = w.height / 2,
      count = c.armorParts ?? 8;
    const parts = (total, hp, radius, prefix) =>
      Array.from({ length: total }, (_, i) => ({
        id: `${prefix}-${i}`,
        x: x + Math.cos((i * Math.PI * 2) / total) * radius,
        y: y + Math.sin((i * Math.PI * 2) / total) * radius,
        hp,
        maxHp: hp,
        angle: (i * Math.PI * 2) / total,
      }));
    w.director.raid = {
      x,
      y,
      phase: 0,
      name: c.phaseNames[0],
      hp: c.armorHp,
      maxHp: c.armorHp,
      armor: parts(count, c.armorHp / count, c.armorRadius ?? 155, "armor"),
      heads: parts(
        c.headElements.length,
        c.headHp,
        c.headRadius ?? 95,
        "hydra",
      ).map((p, i) => ({ ...p, element: c.headElements[i] })),
      cores: parts(
        c.headElements.length,
        c.coreHp / c.headElements.length,
        c.coreRadius ?? 70,
        "core",
      ),
      progress: 0,
      warning: 0,
      hazards: [],
      arenaRadius: c.arenaRadius ?? 300,
      attackIndex: 0,
    };
  }
  const r = w.director.raid;
  if (!r || r.defeated) return;
  r.name = c.phaseNames[r.phase];
  if (r.warning > 0) {
    r.warning = Math.max(0, r.warning - dt);
    if (r.warning === 0) {
      for (const p of living)
        if (distance(p, r.target) < c.counterRadius)
          h.damagePlayer(w, p, c.counterDamage);
      if (r.attackElement === "poison")
        r.hazards.push({
          ...r.target,
          until: w.time + (c.poisonSeconds ?? 5),
          radius: c.poisonRadius ?? 130,
        });
      if (r.attackElement === "lightning") {
        const hit = living.find((p) => distance(p, r.target) < c.counterRadius);
        if (hit)
          for (const p of living)
            if (p !== hit && distance(p, hit) < (c.chainRadius ?? 180))
              h.damagePlayer(w, p, c.chainDamage ?? 20);
      }
      if (r.attackElement === "fire")
        for (const p of living)
          if (distance(p, r.target) < c.counterRadius)
            for (const s of p.segments)
              s.hp = Math.max(1, s.hp - (c.fireBodyDamage ?? 8));
    }
  } else {
    r.nextAttack = (r.nextAttack || 0) - dt;
    if (r.nextAttack <= 0 && living.length) {
      r.nextAttack = c.attackSeconds ?? 3;
      r.warning = c.counterWarning;
      const targets = r.heads.filter((p) => p.hp > 0);
      r.attackElement = targets.length
        ? targets[r.attackIndex % targets.length].element
        : "fire";
      const target = living[r.attackIndex++ % living.length];
      r.target = { x: target.x, y: target.y };
    }
  }
  r.hazards = r.hazards.filter((p) => p.until > w.time);
  for (const zone of r.hazards)
    for (const p of living)
      if (distance(p, zone) < zone.radius)
        h.damagePlayer(w, p, (c.poisonDamage ?? 5) * dt);
  const circles = w._zones.filter((z) => h.pointInPolygon(r, z.vertices));
  const damagePart = (part, radius) => {
    for (const p of living) {
      if (part.hp <= 0 || distance(p, part) > radius) continue;
      const dealt = Math.min(
        part.hp,
        w._catalog.balance.biteDamage * (p._modifiers.damage || 1) * dt,
      );
      part.hp -= dealt;
      p._bossDamage += dealt;
      p._damage += dealt;
    }
  };
  if (r.phase < 3) {
    const parts = [r.armor, r.heads, r.cores][r.phase];
    for (const part of parts) damagePart(part, c.headHitRadius ?? 80);
    r.hp = parts.reduce((n, p) => n + p.hp, 0);
    r.maxHp = parts.reduce((n, p) => n + p.maxHp, 0);
    if (r.hp <= 0) {
      r.phase++;
      r.progress = 0;
      if (r.phase === 3) r.arenaUntil = w.time + (c.arenaSeconds ?? 10);
    }
  } else if (r.phase === 3) {
    r.progress = Math.max(0, (c.arenaSeconds ?? 10) - (r.arenaUntil - w.time));
    if (w.time >= r.arenaUntil) {
      r.phase = 4;
      r.progress = 0;
      r.hp = r.maxHp = c.hp * (c.finalHpFraction ?? 0.2);
    }
  } else {
    r.progress = circles.length ? r.progress + dt : 0;
    if (r.progress >= c.circleSeconds) damagePart(r, c.attackRadius ?? 220);
    if (r.hp <= 0) {
      r.defeated = true;
      w.bossDefeated = true;
      w.status = "victory";
      for (const p of living) {
        award(w, p, c.artifactReward ?? 15, h);
        p.raidDna = c.rewardDna;
      }
    }
  }
  if (r.phase >= 3 && !r.defeated)
    for (const p of living)
      if (distance(p, r) > r.arenaRadius)
        h.damagePlayer(w, p, (c.arenaDamage ?? 8) * dt);
  r.name = c.phaseNames[r.phase];
}
