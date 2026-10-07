import { createWireState, encodeFrame, applyFrame } from "./network.js";

export const createPathState = () => ({
  wire: createWireState(),
  paths: {},
  extras: {},
  extraHashes: {},
});
const equalPoint = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
function pathChange(before, next, full) {
  if (!full && before?.length) {
    for (let inserted = 0; inserted < Math.min(next.length, 16); inserted++) {
      if (!equalPoint(before[0], next[inserted])) continue;
      const kept = next.length - inserted;
      if (
        kept <= before.length &&
        next.slice(inserted).every((p, i) => equalPoint(p, before[i]))
      )
        return { a: next.slice(0, inserted), n: next.length };
    }
  }
  return { f: next };
}
export function encodePathFrame(snapshot, state, options = {}) {
  const frame = encodeFrame(snapshot, state.wire, {
    ...options,
    pathMode: true,
  });
  const full = frame.k === "f";
  const paths = {},
    extras = {},
    removed = [];
  const packedPlayers = new Map(state.wire.previous.c.P.map((p) => [p[0], p]));
  for (const p of snapshot.players) {
    const visible = packedPlayers.get(p.id)?.[26].length > 0;
    const cached = options.packingCache?.get(p);
    const trail = visible
      ? cached?.trail ||
        (p.bodyPath || []).map((point) => [
          Math.round(point.x * 16),
          Math.round(point.y * 16),
        ])
      : [];
    if (cached && visible) cached.trail = trail;
    const changed = pathChange(state.paths[p.id], trail, full);
    if (
      full ||
      changed.f ||
      changed.a.length ||
      changed.n !== state.paths[p.id]?.length
    )
      paths[p.id] = changed;
    state.paths[p.id] = trail;
    const extra = cached?.extra || {
      lifeId: p.lifeId,
      lifeStarted: p.lifeStarted,
      bot: p.bot,
      botState: p.botState || "",
      pvpKills: p.pvpKills,
      spawnProtection: Math.ceil(p.spawnProtection * 10) / 10,
      respawnAt: p.respawnAt,
      bodyLength: p.segments.length + 1,
      choiceRarities: p.choiceRarities,
      upgradeRolls: p.upgradeRolls,
      traits: p.traits,
      traitDiscoveries: p.traitDiscoveries,
    };
    if (p.organs && !cached?.extra)
      Object.assign(extra, {
        organs: p.organs,
        keystones: p.keystones,
        curses: p.curses,
        mutations: p.mutations,
        hybrids: p.hybrids,
        evolutions: p.evolutions,
        evolutionPoints: p.evolutionPoints,
        temporaryLoot: p.temporaryLoot,
        extracted: p.extracted,
        extractionProgress: p.extractionProgress,
        objectives: p.objectives,
        reviveProgress: p.reviveProgress,
        branches: p.segments
          .filter((s) => s.branchParent)
          .map((s) => ({
            id: s.id,
            parent: s.branchParent,
            offset: s.branchOffset,
          })),
      });
    if (cached) cached.extra = extra;
    const hash = cached?.extraHash || JSON.stringify(extra);
    if (cached) cached.extraHash = hash;
    if (full || hash !== state.extraHashes[p.id]) extras[p.id] = extra;
    state.extraHashes[p.id] = hash;
    state.extras[p.id] = extra;
  }
  const ids = new Set(snapshot.players.map((p) => p.id));
  for (const id of Object.keys(state.paths))
    if (!ids.has(id)) {
      removed.push(id);
      delete state.paths[id];
      delete state.extras[id];
      delete state.extraHashes[id];
    }
  return {
    ...frame,
    v: 3,
    t: paths,
    a: extras,
    z: removed,
    ...(snapshot.director
      ? { director: snapshot.director, contentVersion: snapshot.contentVersion }
      : {}),
  };
}
function reconstruct(segments, path) {
  let cursor = 0,
    travelled = 0;
  for (let i = 0; i < segments.length; i++) {
    const desired = (i + 1) * 18;
    while (cursor + 1 < path.length) {
      const edge =
        Math.hypot(
          path[cursor + 1][0] - path[cursor][0],
          path[cursor + 1][1] - path[cursor][1],
        ) / 16;
      if (travelled + edge >= desired) break;
      travelled += edge;
      cursor++;
    }
    const a = path[cursor],
      b = path[cursor + 1] || a;
    if (!a) throw new Error("Body path missing");
    const edge = Math.hypot(b[0] - a[0], b[1] - a[1]) / 16;
    const ratio = Math.max(
      0,
      Math.min(1, (desired - travelled) / Math.max(0.001, edge)),
    );
    segments[i].x = (a[0] + (b[0] - a[0]) * ratio) / 16;
    segments[i].y = (a[1] + (b[1] - a[1]) * ratio) / 16;
  }
}
export function applyPathFrame(previous, frame) {
  if (frame?.v !== 3 || !frame.t || !frame.a || !Array.isArray(frame.z))
    throw new Error("Invalid path frame");
  const wire = applyFrame(previous?.wire || null, { ...frame, v: 2 });
  const paths = frame.k === "f" ? {} : { ...previous.paths };
  const extras = frame.k === "f" ? {} : { ...previous.extras };
  for (const id of frame.z) {
    delete paths[id];
    delete extras[id];
  }
  for (const [id, change] of Object.entries(frame.t)) {
    if (change.f) paths[id] = change.f.map((point) => [...point]);
    else {
      if (
        !paths[id] ||
        !Array.isArray(change.a) ||
        !Number.isInteger(change.n) ||
        change.n < 0 ||
        change.n > 700
      )
        throw new Error("Invalid path delta");
      paths[id] = [...change.a, ...paths[id]].slice(0, change.n);
    }
    if (
      paths[id].length > 700 ||
      paths[id].some((p) => p.length !== 2 || !p.every(Number.isFinite))
    )
      throw new Error("Invalid path points");
  }
  Object.assign(extras, structuredClone(frame.a));
  for (const p of wire.snapshot.players) {
    Object.assign(p, structuredClone(extras[p.id]));
    if (p.segments.length) reconstruct(p.segments, paths[p.id] || []);
    for (const b of p.branches || []) {
      const s = p.segments.find((s) => s.id === b.id),
        index = p.segments.findIndex((s) => s.id === b.parent),
        parent = p.segments[index],
        prior = p.segments[index - 1] || p;
      if (s && parent) {
        const angle =
          Math.atan2(parent.y - prior.y, parent.x - prior.x) + Math.PI / 2;
        s.x = parent.x + Math.cos(angle) * b.offset;
        s.y = parent.y + Math.sin(angle) * b.offset;
        s.branchParent = b.parent;
      }
    }
  }
  if (frame.director) {
    wire.snapshot.director = structuredClone(frame.director);
    wire.snapshot.contentVersion = frame.contentVersion;
  }
  return { seq: wire.seq, wire, paths, extras, snapshot: wire.snapshot };
}
