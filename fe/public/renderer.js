import { SEGMENT_DEFS, SPECIES } from "/game/content.js";

const TAU = Math.PI * 2;
const colors = {
  growth: "#d1eb83",
  xp: "#b998f0",
  heal: "#72d4ae",
  gold: "#ecc473",
};
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function disk(ctx, x, y, r, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, TAU);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
function hex(ctx, x, y, r, fill, stroke, sides = 6) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i * TAU) / sides;
    const px = x + Math.cos(a) * r,
      py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

export function snakeIcon(color = "#bcec78") {
  if(!/^#[a-fA-F0-9]{6}$/.test(color))color='#bcec78';
  return `<svg viewBox="0 0 80 50" aria-hidden="true"><path d="M12 35C0 13 34 3 43 15S37 38 53 36 72 24 62 20" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" opacity=".18"/><path d="M12 35C0 13 34 3 43 15S37 38 53 36 72 24 62 20" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"/><path d="m57 14 13 5-9 8Z" fill="${color}"/><circle cx="63" cy="19" r="1.1" fill="#152010"/></svg>`;
}

function drawSegment(ctx, x, y, type, radius, t, quality = true) {
  const fill =
    { normal: "#6c9953", fire: "#bf723e", poison: "#8066ae", armor: "#718e99" }[
      type
    ] || "#6c9953";
  const light = SEGMENT_DEFS[type]?.color || "#bcdf87";
  ctx.lineWidth = 1.2;
  if (type !== "normal" && quality) {
    const glow = ctx.createRadialGradient(x, y, 2, x, y, radius * 2.6);
    glow.addColorStop(0, light + "28");
    glow.addColorStop(1, light + "00");
    disk(ctx, x, y, radius * 2.6, glow);
  }
  disk(ctx, x + 2, y + 4, radius + 1, "#07100770");
  const gradient = ctx.createRadialGradient(
    x - radius * 0.3,
    y - radius * 0.4,
    1,
    x,
    y,
    radius * 1.15,
  );
  gradient.addColorStop(0, light);
  gradient.addColorStop(0.5, fill);
  gradient.addColorStop(1, "#283722");
  disk(ctx, x, y, radius, gradient, "#273824");
  ctx.globalAlpha *= 0.65;
  if (type === "armor") {
    hex(ctx, x, y, radius * 0.67, "#9cbac0", "#d6e9d780");
    hex(ctx, x, y, radius * 0.4, "#64828a");
  } else if (type === "fire") {
    ctx.fillStyle = "#fff0ad";
    ctx.beginPath();
    ctx.moveTo(x, y - radius * 0.55);
    ctx.lineTo(x + radius * 0.35, y + radius * 0.2);
    ctx.lineTo(x, y + radius * 0.52);
    ctx.lineTo(x - radius * 0.3, y + radius * 0.12);
    ctx.closePath();
    ctx.fill();
  } else if (type === "poison") {
    disk(ctx, x, y, radius * 0.32, "#eee0ff");
    disk(ctx, x, y, radius * 0.13, "#8161ad");
  } else {
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "#34552e";
    for (let i = -1; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x - radius * 0.44, y + i * radius * 0.4);
      ctx.lineTo(x, y + i * radius * 0.4 + radius * 0.21);
      ctx.lineTo(x + radius * 0.44, y + i * radius * 0.4);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawHead(ctx, x, y, angle, radius, color, invulnerable, time) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (invulnerable > 0) {
    ctx.lineWidth = 1.3;
    disk(ctx, 0, 0, radius * 1.55, null, "#d5ffb190");
  }
  ctx.shadowColor = "#070e05";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  const g = ctx.createLinearGradient(0, -radius, 0, radius);
  g.addColorStop(0, "#d1eaa3");
  g.addColorStop(0.35, "#aacb72");
  g.addColorStop(1, "#55763e");
  ctx.fillStyle = g;
  ctx.strokeStyle = "#d0e89b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(radius * 1.25, 0);
  ctx.bezierCurveTo(
    radius * 0.8,
    -radius * 0.9,
    -radius * 0.6,
    -radius * 1.15,
    -radius,
    -radius * 0.48,
  );
  ctx.quadraticCurveTo(-radius * 1.15, 0, -radius, radius * 0.48);
  ctx.bezierCurveTo(
    -radius * 0.6,
    radius * 1.15,
    radius * 0.8,
    radius * 0.9,
    radius * 1.25,
    0,
  );
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  for (const sign of [-1, 1]) {
    disk(ctx, radius * 0.34, sign * radius * 0.52, radius * 0.22, "#151e0b");
    disk(ctx, radius * 0.39, sign * radius * 0.54, radius * 0.11, "#ebffb0");
  }
  ctx.strokeStyle = "#60803f";
  ctx.beginPath();
  ctx.moveTo(-radius * 0.55, 0);
  ctx.lineTo(radius * 0.4, 0);
  ctx.stroke();
  if (Math.sin(time * 3) > 0.78) {
    ctx.strokeStyle = "#d88874";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(radius * 1.2, 0);
    ctx.lineTo(radius * 1.7, 0);
    ctx.lineTo(radius * 1.9, -2);
    ctx.moveTo(radius * 1.7, 0);
    ctx.lineTo(radius * 1.9, 2);
    ctx.stroke();
  }
  ctx.restore();
}

export class ArenaRenderer {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.minimap = minimap;
    this.camera = { x: 1200, y: 900 };
    this.positions = new Map();
    this.width = 0;
    this.height = 0;
    this.quality = true;
    this.terrain = document.createElement("canvas");
    this.terrain.width = this.terrain.height = 480;
    this.makeTerrain();
    this.pattern = this.ctx.createPattern(this.terrain, "repeat");
  }
  makeTerrain() {
    const c = this.terrain.getContext("2d");
    const random = rng(931);
    c.fillStyle = "#182419";
    c.fillRect(0, 0, 480, 480);
    for (let i = 0; i < 2100; i++) {
      const x = random() * 480,
        y = random() * 480;
      c.fillStyle = i % 2 ? "#75975a09" : "#060f1020";
      c.fillRect(x, y, 1 + random() * 2, 1 + random() * 2);
    }
    c.strokeStyle = "#7898660b";
    c.lineWidth = 1;
    for (let x = 0; x < 480; x += 60) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, 480);
      c.stroke();
      c.beginPath();
      c.moveTo(0, x);
      c.lineTo(480, x);
      c.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const x = random() * 480,
        y = random() * 480;
      const r = 7 + random() * 16;
      if (i % 3 === 0) {
        c.save();
        c.translate(x, y);
        c.rotate(random() * TAU);
        c.fillStyle = "#26352a";
        c.strokeStyle = "#354432";
        c.beginPath();
        c.ellipse(0, 0, r, r * 0.55, 0, 0, TAU);
        c.fill();
        c.stroke();
        c.strokeStyle = "#4b5b4222";
        c.beginPath();
        c.moveTo(-r * 0.6, -2);
        c.lineTo(r * 0.4, -r * 0.3);
        c.stroke();
        c.restore();
      } else {
        c.save();
        c.translate(x, y);
        c.rotate(random() * TAU);
        c.strokeStyle = "#56714636";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(0, -r);
        c.stroke();
        for (let k = 0; k < 4; k++) {
          c.fillStyle = k % 2 ? "#49603940" : "#64864b25";
          c.beginPath();
          c.ellipse(-3, (-k * r) / 4, 5, 2, 0.5, 0, TAU);
          c.ellipse(3, (-k * r) / 4, 5, 2, -0.5, 0, TAU);
          c.fill();
        }
        c.restore();
      }
    }
  }
  resize() {
    const box = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, this.quality ? 2 : 1);
    if (
      this.width !== box.width ||
      this.height !== box.height ||
      this.dpr !== dpr
    ) {
      this.width = box.width;
      this.height = box.height;
      this.dpr = dpr;
      this.canvas.width = Math.round(box.width * dpr);
      this.canvas.height = Math.round(box.height * dpr);
    }
    this.zoom = this.width < 600 ? 0.79 : 1;
  }
  reset(player) {
    this.positions.clear();
    if (player) this.camera = { x: player.x, y: player.y };
  }
  screenToWorld(x, y) {
    return {
      x: (x - this.width / 2) / this.zoom + this.camera.x,
      y: (y - this.height / 2) / this.zoom + this.camera.y,
    };
  }
  smooth(id, x, y, dt) {
    let p = this.positions.get(id);
    if (!p) {
      p = { x, y };
      this.positions.set(id, p);
    }
    const a = 1 - Math.exp(-24 * dt);
    if (Math.hypot(p.x - x, p.y - y) > 250) {
      p.x = x;
      p.y = y;
    } else {
      p.x += (x - p.x) * a;
      p.y += (y - p.y) * a;
    }
    return p;
  }
  render(world, playerId, dt, time) {
    this.resize();
    const ctx = this.ctx,
      w = this.width,
      h = this.height;
    const own = world.players.find((p) => p.id === playerId);
    const target = own?.alive ? own : world.players.find((p) => p.alive) || own;
    if (target) {
      const a = 1 - Math.exp(-6 * dt);
      this.camera.x += (target.x - this.camera.x) * a;
      this.camera.y += (target.y - this.camera.y) * a;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#0d160e";
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);
    ctx.fillStyle = this.pattern;
    ctx.fillRect(0, 0, world.width, world.height);
    ctx.strokeStyle = "#79955d60";
    ctx.lineWidth = 3;
    ctx.strokeRect(12, 12, world.width - 24, world.height - 24);
    ctx.strokeStyle = "#abc47f12";
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 13]);
    ctx.strokeRect(35, 35, world.width - 70, world.height - 70);
    ctx.setLineDash([]);
    const left = this.camera.x - w / 2 / this.zoom - 100,
      top = this.camera.y - h / 2 / this.zoom - 100,
      right = left + w / this.zoom + 200,
      bottom = top + h / this.zoom + 200;
    const visible = (o) =>
      o.x > left && o.x < right && o.y > top && o.y < bottom;
    // A quiet etched starting circle gives the forest a sense of place.
    ctx.strokeStyle = "#89ad6720";
    ctx.lineWidth = 1;
    disk(ctx, 1200, 900, 185, null, "#89ad6720");
    disk(ctx, 1200, 900, 195, null, "#89ad6710");
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12;
      hex(
        ctx,
        1200 + Math.cos(a) * 190,
        900 + Math.sin(a) * 190,
        3,
        "#97b57030",
      );
    }
    for (const f of world.foods) {
      if (!visible(f)) continue;
      const c = colors[f.type] || colors.growth;
      const r = f.type === "xp" ? 5 : 4;
      const float = Math.sin(time * 2 + f.x) * 1.2;
      if (this.quality) {
        const g = ctx.createRadialGradient(f.x, f.y, 1, f.x, f.y, 14);
        g.addColorStop(0, c + "39");
        g.addColorStop(1, c + "00");
        disk(ctx, f.x, f.y, 14, g);
      }
      if (f.type === "xp") {
        ctx.save();
        ctx.translate(f.x, f.y + float);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = c;
        ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();
      } else if (f.type === "heal") {
        ctx.fillStyle = c;
        ctx.fillRect(f.x - 4, f.y - 1.5 + float, 8, 3);
        ctx.fillRect(f.x - 1.5, f.y - 4 + float, 3, 8);
      } else {
        disk(ctx, f.x, f.y + float, r, c);
        disk(ctx, f.x - 1, f.y - 1 + float, 1.2, "#f5ffe8");
      }
    }
    for (const fx of world.effects) {
      if (!visible(fx) || (fx.type === "pickup" && !this.quality)) continue;
      const progress = 1 - fx.life / fx.maxLife;
      ctx.globalAlpha = Math.max(0, 1 - progress) * 0.65;
      ctx.lineWidth = fx.type === "pulse" ? 3 : 1.5;
      disk(
        ctx,
        fx.x,
        fx.y,
        fx.radius * (0.25 + progress * 0.75),
        fx.type === "poison" ? fx.color + "20" : null,
        fx.color,
      );
      if (fx.type === "circle")
        disk(ctx, fx.x, fx.y, fx.radius, fx.color + "12");
      ctx.globalAlpha = 1;
    }
    for (const e of world.enemies) {
      if (visible(e)) this.drawEnemy(e, this.smooth(e.id, e.x, e.y, dt), time);
    }
    for (const p of world.players) {
      if (!p.alive) continue;
      ctx.globalAlpha = p.id === playerId ? 1 : 0.85;
      for (let i = p.segments.length - 1; i >= 0; i--) {
        const s = p.segments[i];
        if (!visible(s)) continue;
        const xy = this.smooth(s.id, s.x, s.y, dt);
        const taper = Math.min(1, 0.48 + (p.segments.length - i) * 0.18);
        drawSegment(ctx, xy.x, xy.y, s.type, 10.5 * taper, time, this.quality);
        if (s.hp / s.maxHp < 0.4) disk(ctx, xy.x, xy.y, 4, "#edb18555");
      }
      const xy = this.smooth(p.id, p.x, p.y, dt);
      drawHead(
        ctx,
        xy.x,
        xy.y,
        p.angle,
        14,
        SPECIES.find((s) => s.id === p.species)?.color,
        p.invulnerable,
        time,
      );
      if (p.id !== playerId) {
        ctx.font = '10px "DM Sans",sans-serif';
        ctx.textAlign = "center";
        ctx.fillStyle = "#e1eccf";
        ctx.fillText(p.name, xy.x, xy.y - 31);
      }
      if (p.id === playerId) {
        ctx.strokeStyle = "#d7ffa970";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(xy.x, xy.y, 23, p.angle - 0.4, p.angle + 0.4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    for (const b of world.projectiles) {
      if (!visible(b)) continue;
      const xy = this.smooth(b.id, b.x, b.y, dt);
      ctx.strokeStyle = (b.color || "#edbd84") + "60";
      ctx.lineWidth = b.radius;
      ctx.beginPath();
      ctx.moveTo(xy.x - Math.cos(b.angle) * 17, xy.y - Math.sin(b.angle) * 17);
      ctx.lineTo(xy.x, xy.y);
      ctx.stroke();
      disk(ctx, xy.x, xy.y, b.radius, b.color || "#ecc780");
      disk(ctx, xy.x - 1, xy.y - 1, b.radius * 0.45, "#fff0c6");
    }
    ctx.restore();
    if (this.quality) {
      const v = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.2,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.65,
      );
      v.addColorStop(0, "#08120900");
      v.addColorStop(1, "#07100578");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
    }
    if (own && !own.alive) {
      ctx.fillStyle = "#07120870";
      ctx.fillRect(0, 0, w, h);
    }
    this.drawMinimap(world, playerId);
    if (this.positions.size > 2500) {
      const ids = new Set([
        ...world.players.flatMap((p) => [p.id, ...p.segments.map((s) => s.id)]),
        ...world.enemies.map((e) => e.id),
        ...world.projectiles.map((p) => p.id),
      ]);
      for (const id of this.positions.keys())
        if (!ids.has(id)) this.positions.delete(id);
    }
  }
  drawEnemy(e, xy, time) {
    const ctx = this.ctx;
    const r = e.radius;
    const angle = e.angle || 0;
    ctx.save();
    ctx.translate(xy.x, xy.y);
    ctx.rotate(angle);
    ctx.lineWidth = 1.2;
    const palette = {
      chaser: ["#724b49", "#b07667"],
      swarm: ["#7d7750", "#b6ad72"],
      brute: ["#735744", "#a37a56"],
      archer: ["#77627d", "#b494b6"],
      boss: ["#6c463c", "#db9362"],
    };
    const [fill, stroke] = palette[e.type] || palette.chaser;
    if (e.warning > 0) {
      ctx.strokeStyle = "#fa9b6750";
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(280, 0);
      ctx.stroke();
    }
    if (e.type === "boss") {
      disk(ctx, 0, 0, r + 15, "#e88e5810");
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8 + Math.sin(time) * 0.05;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        ctx.lineTo(Math.cos(a + 0.1) * r * 1.1, Math.sin(a + 0.1) * r * 1.1);
        ctx.lineTo(Math.cos(a + 0.2) * r * 1.35, Math.sin(a + 0.2) * r * 1.35);
        ctx.stroke();
      }
      hex(ctx, 0, 0, r, fill, stroke, 8);
      hex(ctx, 0, 0, r * 0.67, "#934e38", "#dd9a64");
    } else if (e.type === "brute") {
      hex(ctx, 0, 0, r, fill, stroke);
      hex(ctx, -3, 0, r * 0.66, "#9d7951", "#ba946650");
    } else if (e.type === "archer") {
      hex(ctx, 0, 0, r, fill, stroke, 4);
      ctx.strokeStyle = "#d5b4c3";
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.15, -1.2, 1.2);
      ctx.stroke();
    } else {
      for (let i = -1; i <= 1; i += 2) {
        ctx.strokeStyle = stroke;
        ctx.beginPath();
        ctx.moveTo(-r * 0.3, i * r * 0.5);
        ctx.lineTo(-r * 0.7, i * r * 1.3);
        ctx.lineTo(-r * 1.15, i * r * 1.5);
        ctx.moveTo(r * 0.25, i * r * 0.5);
        ctx.lineTo(r * 0.65, i * r * 1.3);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.78, 0, 0, TAU);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
    for (const sign of [-1, 1])
      disk(ctx, r * 0.5, sign * r * 0.3, e.type === "boss" ? 4 : 2, "#f6d29a");
    if (e.hitFlash > 0) {
      ctx.globalAlpha = 0.55;
      disk(ctx, 0, 0, r, "#ffedcc");
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (e.hp < e.maxHp) {
      ctx.fillStyle = "#151c11";
      ctx.fillRect(xy.x - r, xy.y - r - 10, r * 2, 3);
      ctx.fillStyle = e.type === "boss" ? "#eda270" : "#b7846d";
      ctx.fillRect(
        xy.x - r,
        xy.y - r - 10,
        r * 2 * Math.max(0, e.hp / e.maxHp),
        3,
      );
    }
  }
  drawMinimap(world, playerId) {
    if (!this.minimap) return;
    const ctx = this.minimap.getContext("2d"),
      w = 140,
      h = 105;
    ctx.fillStyle = "#192719";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#38502b";
    ctx.strokeRect(3, 3, w - 6, h - 6);
    const sx = w / world.width,
      sy = h / world.height;
    ctx.strokeStyle = "#647b4940";
    ctx.strokeRect(
      (this.camera.x - this.width / 2 / this.zoom) * sx,
      (this.camera.y - this.height / 2 / this.zoom) * sy,
      (this.width / this.zoom) * sx,
      (this.height / this.zoom) * sy,
    );
    for (const e of world.enemies)
      if (e.type === "boss") disk(ctx, e.x * sx, e.y * sy, 4, "#eea679");
    for (const p of world.players) {
      if (!p.alive) continue;
      ctx.strokeStyle = p.id === playerId ? "#abc97f" : "#ab98d1";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x * sx, p.y * sy);
      for (const s of p.segments) ctx.lineTo(s.x * sx, s.y * sy);
      ctx.stroke();
      disk(
        ctx,
        p.x * sx,
        p.y * sy,
        2.5,
        p.id === playerId ? "#d8ffa9" : "#d5c6fc",
      );
    }
  }
}

export function drawHero(canvas, time = 0, reduced = false) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width) return;
  const dpr = Math.min(devicePixelRatio || 1, 2),
    w = bounds.width,
    h = bounds.height;
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createRadialGradient(
    w * 0.73,
    h * 0.47,
    10,
    w * 0.6,
    h * 0.5,
    w * 0.75,
  );
  bg.addColorStop(0, "#465a2d");
  bg.addColorStop(0.5, "#25391d");
  bg.addColorStop(1, "#132110");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const random = rng(812);
  ctx.strokeStyle = "#b6d58108";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 35) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 35) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let i = 0; i < 65; i++) {
    const x = random() * w,
      y = random() * h;
    disk(ctx, x, y, random() * 2 + 0.3, "#bfda8530");
    if (i % 7 === 0) {
      ctx.strokeStyle = "#a9c67718";
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
      ctx.stroke();
    }
  }
  ctx.lineWidth = 1;
  disk(ctx, w * 0.74, h * 0.48, h * 0.32, null, "#a6c47717");
  disk(ctx, w * 0.74, h * 0.48, h * 0.4, null, "#a6c4770d");
  const points = [];
  const phase = reduced ? 0 : Math.sin(time * 0.3) * 0.05;
  const scale = Math.min(w / 680, 1.1);
  for (let i = 0; i < 46; i++) {
    const t = i / 45;
    const angle = t * Math.PI * 2.05 + 0.8 + phase;
    const radius = (0.16 + 0.1 * t) * h;
    points.push({
      x: w * 0.78 + Math.cos(angle) * radius * 1.06,
      y: h * 0.46 + Math.sin(angle) * radius,
    });
  }
  // A sweeping tail leaves the coil and extends into the dark edge of the card.
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    points.unshift({
      x: w * 0.78 + Math.cos(0.8) * h * 0.16 - (14 - i) * 8 * scale,
      y: h * 0.46 + Math.sin(0.8) * h * 0.16 + Math.sin(t * 3) * 26,
    });
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      r = (5 + Math.min(i, 12) * 1.2) * Math.max(0.8, scale);
    drawSegment(
      ctx,
      p.x,
      p.y,
      i === 22 || i === 23
        ? "poison"
        : i === 39
          ? "fire"
          : i === 47
            ? "armor"
            : "normal",
      r,
      time,
      true,
    );
  }
  const head = points.at(-1),
    before = points.at(-2);
  drawHead(
    ctx,
    head.x,
    head.y,
    Math.atan2(head.y - before.y, head.x - before.x),
    24 * Math.max(0.8, scale),
    "#c3e997",
    0,
    time,
  );
  for (let i = 0; i < 8; i++) {
    const a = i * 2.4;
    const x = w * 0.74 + Math.cos(a) * h * 0.38,
      y = h * 0.47 + Math.sin(a) * h * 0.35;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
    g.addColorStop(0, "#dcf39470");
    g.addColorStop(1, "#bfdb7700");
    disk(ctx, x, y, 10, g);
    disk(ctx, x, y, 1.5, "#dff3a2");
  }
}
