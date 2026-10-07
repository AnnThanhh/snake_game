import Phaser from "phaser";
import { Client, Room } from "@colyseus/sdk";
import { AdaptiveQuality } from "./adaptive-quality";
export class ColyseusSocket extends EventTarget {
  readyState = 0;
  bufferedAmount = 0;
  room: Room | null = null;
  client: Client;
  connecting = false;
  closed = false;
  constructor() {
    super();
    this.client = new Client(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rt`,
    );
    setTimeout(() => {
      if (!this.closed) {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      }
    }, 0);
  }
  emit(data: any) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }
  send(raw: string) {
    const m = JSON.parse(raw);
    if (this.closed) return;
    if (this.room) {
      if (m.type === "leave") {
        void this.room.leave();
        return;
      }
      this.room.send("message", m);
      return;
    }
    if (this.connecting) return;
    this.connecting = true;
    void this.join(m);
  }
  async join(m: any) {
    try {
      const options = {
        mode: m.mode,
        playerName: m.playerName,
        species: m.species,
        ticket: m.ticket,
      };
      const room =
        m.type === "resume"
          ? await this.client.reconnect(m.token.slice(3))
          : m.type === "join"
            ? await this.client.joinById(m.code, options)
            : m.type === "create"
              ? await this.client.create("v2", options)
              : await this.client.joinOrCreate("v2", options);
      if (this.closed) {
        await room.leave();
        return;
      }
      this.room = room;
      // The SDK buffers messages received before handlers are attached.
      room.onMessage("message", (data: any) => {
        if (data.type === "welcome")
          data.token = "v2:" + room.reconnectionToken;
        this.emit(data);
      });
      room.onLeave((code: number) => {
        this.readyState = 3;
        this.dispatchEvent(
          new CloseEvent("close", { code: code === 4003 ? 4001 : code }),
        );
      });
      room.onError((_code: number, message: string) =>
        this.emit({ type: "error", message }),
      );
      room.onDrop(() =>
        this.emit({ type: "transport-state", connected: false }),
      );
      room.onReconnect(() =>
        this.emit({ type: "transport-state", connected: true }),
      );
      room.send("message", { type: "resync" });
    } catch (error: any) {
      this.emit({
        type: "error",
        message: error.message || "Không thể tham gia phòng.",
      });
      this.readyState = 3;
      this.dispatchEvent(new CloseEvent("close", { code: 1006 }));
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    if (this.room) void this.room.leave(false);
    else this.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  }
}
type Sample = { at: number; world: any };
export class MotionBuffer {
  samples: Sample[] = [];
  inputs: { seq: number; input: any; dt: number }[] = [];
  predicted: any = null;
  ownId = "";
  catalog: any;
  correction = { x: 0, y: 0, at: 0 };
  constructor(catalog: any) {
    this.catalog = catalog;
  }
  accept(world: any, id: string, ack: number) {
    this.ownId = id;
    this.samples.push({ at: performance.now(), world: structuredClone(world) });
    while (this.samples.length > 30) this.samples.shift();
    this.inputs = this.inputs.filter((i) => i.seq > ack);
    const own = world.players.find((p: any) => p.id === id);
    if (own) {
      const prior = this.predicted;
      this.predicted = { ...own };
      for (const command of this.inputs)
        this.advance(this.predicted, command.input, command.dt);
      if (
        prior &&
        Math.hypot(prior.x - this.predicted.x, prior.y - this.predicted.y) < 150
      ) {
        const remain = Math.exp(-(performance.now() - this.correction.at) / 80);
        this.correction = {
          x: prior.x - this.predicted.x + this.correction.x * remain,
          y: prior.y - this.predicted.y + this.correction.y * remain,
          at: performance.now(),
        };
      } else this.correction = { x: 0, y: 0, at: 0 };
    }
  }
  input(seq: number, input: any, dt: number) {
    if (!this.predicted) return;
    this.inputs.push({ seq, input: { ...input }, dt: Math.min(0.1, dt) });
    if (this.inputs.length > 120) this.inputs.shift();
    this.advance(this.predicted, input, Math.min(0.1, dt));
  }
  advance(p: any, input: any, dt: number) {
    if (!p.alive) return;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const turn =
      (this.catalog.balance.turn *
        (1 + this.catalog.balance.hasteTurnPerLevel * (p.upgradePower?.haste || p.upgrades?.haste || 0))) /
      (1 + Math.max(0, p.segments.length - 6) * this.catalog.balance.lengthTurnPenalty);
    const delta = Math.max(
      -turn * dt,
      Math.min(turn * dt, wrap(input.angle - p.angle)),
    );
    p.angle = wrap(p.angle + delta);
    const speed = p.speed ?? this.catalog.balance.speed;
    p.x += Math.cos(p.angle) * speed * dt;
    p.y += Math.sin(p.angle) * speed * dt;
  }
  draw(authority: any) {
    if (!this.samples.length) return authority;
    const at = performance.now() - this.catalog.network.interpolationMs;
    let a = this.samples[0],
      b = this.samples.at(-1)!;
    for (let i = 1; i < this.samples.length; i++)
      if (this.samples[i].at >= at) {
        a = this.samples[i - 1];
        b = this.samples[i];
        break;
      }
    const t = Math.max(0, Math.min(1, (at - a.at) / Math.max(1, b.at - a.at)));
    const result = {
      ...authority,
      players: authority.players.map((p: any) => ({
        ...p,
        segments: p.segments.map((s: any) => ({ ...s })),
      })),
      enemies: authority.enemies.map((e: any) => ({ ...e })),
    };
    for (const key of ["players", "enemies"])
      for (const p of result[key]) {
        if (
          key === "players" &&
          p.id === this.ownId &&
          this.predicted &&
          p.alive
        ) {
          const blend = Math.exp(
              -(performance.now() - this.correction.at) / 80,
            ),
            x = this.predicted.x + this.correction.x * blend,
            y = this.predicted.y + this.correction.y * blend,
            dx = x - p.x,
            dy = y - p.y;
          p.x = x;
          p.y = y;
          p.angle = this.predicted.angle;
          for (let i = 0; i < Math.min(3, p.segments.length); i++) {
            p.segments[i].x += dx * (1 - i / 3);
            p.segments[i].y += dy * (1 - i / 3);
          }
          continue;
        }
        const before = a.world[key].find((x: any) => x.id === p.id),
          after = b.world[key].find((x: any) => x.id === p.id);
        if (!before || !after) continue;
        p.x = before.x + (after.x - before.x) * t;
        p.y = before.y + (after.y - before.y) * t;
        p.angle =
          before.angle +
          Math.atan2(
            Math.sin(after.angle - before.angle),
            Math.cos(after.angle - before.angle),
          ) *
            t;
        if (p.segments)
          for (const s of p.segments) {
            const x = before.segments.find((v: any) => v.id === s.id),
              y = after.segments.find((v: any) => v.id === s.id);
            if (x && y) {
              s.x = x.x + (y.x - x.x) * t;
              s.y = x.y + (y.y - x.y) * t;
            }
          }
      }
    return result;
  }
  reset() {
    this.samples = [];
    this.inputs = [];
    this.predicted = null;
  }
}
const color = (hex: string) =>
  parseInt((hex || "#bcee82").replace("#", ""), 16);
function rendererType() {
  try {
    const probe = document.createElement("canvas").getContext("webgl");
    const supported = Boolean(probe);
    probe?.getExtension("WEBGL_lose_context")?.loseContext();
    return supported ? Phaser.WEBGL : Phaser.CANVAS;
  } catch {
    return Phaser.CANVAS;
  }
}
export class PhaserArenaRenderer {
  ground?: Phaser.GameObjects.Graphics;
  stable = 0;
  canvas: HTMLCanvasElement;
  minimap: HTMLCanvasElement;
  width = 1;
  height = 1;
  zoom = 1;
  quality = true;
  qualityLevel = "auto";
  camera = { x: 0, y: 0 };
  game: Phaser.Game;
  scene?: Phaser.Scene;
  graphics?: Phaser.GameObjects.Graphics;
  pool = new Map<string, Phaser.GameObjects.Image>();
  labels = new Map<string, Phaser.GameObjects.Text>();
  catalog: any;
  adaptive = new AdaptiveQuality();
  resolution = 1;
  appliedResolution = 0;
  frame = 0;
  constructor(
    canvas: HTMLCanvasElement,
    minimap: HTMLCanvasElement,
    catalog: any,
  ) {
    this.canvas = canvas;
    this.minimap = minimap;
    this.catalog = catalog;
    const owner = this;
    this.game = new Phaser.Game({
      type: rendererType(),
      canvas,
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
      backgroundColor: "#121b13",
      antialias: true,
      audio: { noAudio: true },
      scene: {
        create() {
          owner.scene = this;
          owner.graphics = this.add.graphics();
          const g = this.make.graphics({ x: 0, y: 0 });
          g.fillStyle(0xffffff);
          g.fillCircle(20, 20, 17);
          g.lineStyle(2, 0x17211a, 0.8);
          g.strokeCircle(20, 20, 17);
          g.fillStyle(0xffffff, 0.35);
          g.fillCircle(14, 13, 6);
          g.generateTexture("body", 40, 40);
          g.clear();
          g.fillStyle(0xffffff);
          g.fillCircle(12, 12, 9);
          g.generateTexture("food", 24, 24);
          g.destroy();
          owner.resize();
        },
      },
      render: { roundPixels: false, powerPreference: "high-performance" },
    });
    window.addEventListener("resize", () => this.resize());
  }
  reset(p: any) {
    if (p) this.camera = { x: p.x, y: p.y };
    for (const object of this.pool.values()) object.setVisible(false);
  }
  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect(),
      width = Math.max(1, Math.round(r.width || window.innerWidth)),
      height = Math.max(1, Math.round(r.height || window.innerHeight));
    if (
      width !== this.width ||
      height !== this.height ||
      this.resolution !== this.appliedResolution
    ) {
      this.width = width;
      this.height = height;
      this.zoom = width < 600 ? 0.79 : 1;
      this.appliedResolution = this.resolution;
      this.game.scale.resize(
        Math.round(width * this.resolution),
        Math.round(height * this.resolution),
      );
      this.canvas.style.width = width + "px";
      this.canvas.style.height = height + "px";
    }
  }
  screenToWorld(x: number, y: number) {
    return {
      x: (x - this.width / 2) / this.zoom + this.camera.x,
      y: (y - this.height / 2) / this.zoom + this.camera.y,
    };
  }
  render(world: any, id: string, dt: number, time: number) {
    if (!this.scene || !this.graphics) return;
    this.frame++;
    const automatic =
      this.qualityLevel === "auto"
        ? this.adaptive.update(
            dt,
            this.catalog.adaptiveGraphics,
            this.catalog.graphics.length,
          )
        : this.adaptive.level;
    const quality =
      this.catalog.graphics.find((q: any) => q.id === this.qualityLevel) ||
      this.catalog.graphics[this.quality ? automatic : 0];
    this.resolution = Math.max(0.5, Math.min(2, quality.resolution));
    this.resize();
    const own = world.players.find((p: any) => p.id === id),
      target = own?.alive
        ? own
        : world.players.find((p: any) => p.alive) || own;
    if (target) {
      const t = 1 - Math.exp(-10 * dt);
      this.camera.x += (target.x - this.camera.x) * t;
      this.camera.y += (target.y - this.camera.y) * t;
    }
    this.scene.cameras.main
      .setZoom(this.zoom * this.resolution)
      .centerOn(this.camera.x, this.camera.y);
    const g = this.graphics;
    g.clear();
    const seen = new Set<string>(),
      seenLabels = new Set<string>();
    const bg = (this.ground ??= this.scene.add.graphics().setDepth(0));
    bg.clear();
    for (const biome of world.director?.biomes || []) {
      bg.fillStyle(color(biome.color), 0.75);
      bg.fillRect(biome.x, biome.y, biome.width, biome.height);
    }
    bg.lineStyle(1, 0x42623a, 0.12);
    const left = Math.max(0, this.camera.x - this.width / 2 / this.zoom),
      right = Math.min(world.width, this.camera.x + this.width / 2 / this.zoom),
      top = Math.max(0, this.camera.y - this.height / 2 / this.zoom),
      bottom = Math.min(
        world.height,
        this.camera.y + this.height / 2 / this.zoom,
      );
    for (let x = Math.floor(left / 80) * 80; x < right; x += 80)
      bg.lineBetween(x, top, x, bottom);
    for (let y = Math.floor(top / 80) * 80; y < bottom; y += 80)
      bg.lineBetween(left, y, right, y);
    bg.lineStyle(5, 0x93b864, 0.5);
    bg.strokeRect(0, 0, world.width, world.height);
    // Deterministic ground details share one draw buffer and stay behind gameplay.
    for (let x = Math.floor(left / 140) * 140; x < right; x += 140)
      for (let y = Math.floor(top / 140) * 140; y < bottom; y += 140) {
        const n = Math.abs(Math.sin(x * 12.9898 + y * 78.233));
        bg.fillStyle(0x67875b, 0.1);
        bg.fillEllipse(x + 80 * n, y + 55 * n, 20 + 25 * n, 8 + 6 * n);
        bg.lineStyle(1, 0x89a477, 0.2);
        for (let k = 0; k < 3; k++)
          bg.lineBetween(
            x + 80 * n + k * 3,
            y + 55 * n,
            x + 80 * n + k * 4 - 3,
            y + 55 * n - 6 - k,
          );
      }
    const visible = (p: any, padding = 80) =>
      p.x > left - padding &&
      p.x < right + padding &&
      p.y > top - padding &&
      p.y < bottom + padding;
    const available = [...this.pool.entries()].filter(
      ([, image]) => !image.visible,
    );
    const sprite = (
      key: string,
      p: any,
      r: number,
      tint: number,
      depth: number,
      alpha = 1,
    ) => {
      if (!visible(p, r)) return;
      seen.add(key);
      let image = this.pool.get(key);
      if (!image) {
        let inactive = available.pop();
        while (inactive && seen.has(inactive[0])) inactive = available.pop();
        if (inactive) {
          this.pool.delete(inactive[0]);
          image = inactive[1];
        } else image = this.scene!.add.image(0, 0, "body");
        this.pool.set(key, image);
      }
      image
        .setVisible(true)
        .setPosition(p.x, p.y)
        .setDisplaySize(r * 2, r * 2)
        .setTint(tint)
        .setDepth(depth)
        .setAlpha(alpha);
    };
    const label = (
      key: string,
      x: number,
      y: number,
      value: string,
      tint = "#dceac4",
    ) => {
      seenLabels.add(key);
      let text = this.labels.get(key);
      if (!text) {
        text = this.scene!.add.text(x, y, value, {
          fontFamily: "DM Sans, sans-serif",
          fontSize: "12px",
          color: tint,
          stroke: "#101911",
          strokeThickness: 3,
        })
          .setOrigin(0.5)
          .setDepth(15);
        this.labels.set(key, text);
      }
      text.setVisible(true).setPosition(x, y).setText(value).setColor(tint);
    };
    const foodColors: any = {
      growth: 0xc7df81,
      xp: 0xb894e5,
      heal: 0x72d4ae,
      gold: 0xecc473,
    };
    for (const f of world.foods)
      sprite("f" + f.id, f, 4, foodColors[f.type], 1);
    for (const e of world.enemies) {
      sprite(
        "e" + e.id,
        e,
        e.radius,
        e.type === "boss"
          ? 0xc58a5c
          : e.type === "archer"
            ? 0x9f899c
            : 0x9ea564,
        3,
      );
      if (visible(e) && e.hp < e.maxHp) {
        g.fillStyle(0x162015);
        g.fillRect(e.x - e.radius, e.y - e.radius - 8, e.radius * 2, 3);
        g.fillStyle(0xe39378);
        g.fillRect(
          e.x - e.radius,
          e.y - e.radius - 8,
          (e.radius * 2 * e.hp) / e.maxHp,
          3,
        );
      }
      if (e.warning > 0) {
        g.lineStyle(3, 0xff967b, 0.9);
        g.strokeCircle(e.x, e.y, e.radius + 25);
      }
    }
    for (const p of world.players) {
      const species = this.catalog.species.find((s: any) => s.id === p.species),
        tint = color(species?.color);
      if (!p.alive) {
        if (visible(p)) {
          g.lineStyle(2, 0x94d8d0, 0.6);
          g.strokeCircle(p.x, p.y, 23);
          label(
            "ghost" + p.id,
            p.x,
            p.y - 35,
            p.extracted ? "Đã rút lui" : "Khép vòng để cứu",
          );
        }
        continue;
      }
      for (let i = p.segments.length - 1; i >= 0; i--) {
        const s = p.segments[i];
        if (p.id !== id && i % quality.bodyStride !== 0) continue;
        const previous = s.branchParent
          ? p.segments.find((a: any) => a.id === s.branchParent)
          : p.segments[i - 1] || p;
        if (previous && visible(s)) {
          g.lineStyle(14, color(this.catalog.segments[s.type]?.color), 0.3);
          g.lineBetween(previous.x, previous.y, s.x, s.y);
        }
        sprite(
          "s" + s.id,
          s,
          10.5,
          color(this.catalog.segments[s.type]?.color),
          4,
        );
      }
      sprite("p" + p.id, p, 16, tint, 6, p.spawnProtection > 0 ? 0.6 : 1);
      if (visible(p)) {
        for (const side of [-1, 1]) {
          const a = p.angle + side * 0.65;
          g.fillStyle(0xf0f5ce);
          g.fillCircle(p.x + Math.cos(a) * 10, p.y + Math.sin(a) * 10, 3);
          g.fillStyle(0x122015);
          g.fillCircle(p.x + Math.cos(a) * 12, p.y + Math.sin(a) * 12, 1.5);
        }
        label(
          "name" + p.id,
          p.x,
          p.y - 32,
          p.name +
            (world.director?.crown?.id === p.id ? " ♛" : "") +
            (world.director?.apex?.id === p.id ? " · APEX" : ""),
        );
        if (p.spawnProtection > 0) {
          g.lineStyle(2, 0xc3f3b5, 0.8);
          g.strokeCircle(p.x, p.y, 24);
        }
      }
      for (const o of p.organs || []) {
        const s = p.segments.find((s: any) => s.id === o.segmentId),
          def = this.catalog.organs.find((d: any) => d.id === o.id);
        if (s && visible(s)) {
          g.lineStyle(2, color(def?.color), 1);
          g.strokeCircle(s.x, s.y, 14);
        }
      }
    }
    for (const b of world.projectiles)
      sprite("b" + b.id, b, b.radius, color(b.color), 7);
    for (const fx of world.effects.slice(-quality.particles))
      if (visible(fx, fx.radius)) {
        g.lineStyle(
          2,
          color(fx.color),
          Math.max(0, fx.life / fx.maxLife) * 0.7,
        );
        g.strokeCircle(
          fx.x,
          fx.y,
          fx.radius * (1 - (fx.life / fx.maxLife) * 0.6),
        );
      }
    const director = world.director;
    if (director) {
      for (const e of director.events)
        if (e.damage && visible(e, e.radius)) {
          g.fillStyle(0xcb6553, 0.1);
          g.fillCircle(e.x, e.y, e.radius);
          g.lineStyle(2, 0xffa08a, 0.8);
          g.strokeCircle(e.x, e.y, e.radius);
          label("event" + e.key, e.x, e.y - e.radius, e.name, "#f1b6a0");
        }
      for (const o of director.objectives) {
        sprite(
          "objective" + o.id,
          o,
          o.type === "relic" ? 12 : 28,
          o.type === "nest" ? 0xb2786a : 0xd9c384,
          5,
        );
        if (visible(o))
          label(
            "objective" + o.id,
            o.x,
            o.y - 40,
            o.type === "relic"
              ? "Di vật"
              : o.type === "nest"
                ? "Tổ quái"
                : "Hộ tống",
          );
      }
      for (const [key, o] of [
        ["shrine", director.shrine],
        ["portal", director.portal],
      ] as any) {
        if (o) {
          g.lineStyle(3, key === "portal" ? 0x8fe9dc : 0xe2c581, 0.8);
          g.strokeCircle(o.x, o.y, o.radius);
          label(
            key,
            o.x,
            o.y - 25,
            key === "portal"
              ? "Giữ E để rút lui"
              : o.contested
                ? "Đền đang tranh chấp"
                : o.owner
                  ? "Đền đã chiếm"
                  : "Khép vòng quanh đền",
          );
        }
      }
      if (director.raid && !director.raid.defeated) {
        const r = director.raid;
        sprite("hydra", r, 65, 0xb98da2, 5);
        label(
          "hydra",
          r.x,
          r.y - 95,
          `HYDRA · ${r.name} · ${Math.ceil(r.hp)}/${Math.ceil(r.maxHp)}`,
        );
        if (r.phase === 0)
          for (const part of r.armor || [])
            if (part.hp > 0) sprite(part.id, part, 21, 0x879487, 5);
        if (r.phase === 2)
          for (const part of r.cores || [])
            if (part.hp > 0) sprite(part.id, part, 18, 0x86e4d1, 5);
        if (r.phase >= 3) {
          g.lineStyle(6, 0xd998bc, 0.8);
          g.strokeCircle(r.x, r.y, r.arenaRadius);
          label(
            "hydra-instruction",
            r.x,
            r.y + 110,
            r.phase === 3
              ? "Ở trong vòng của Hydra"
              : "Khép vòng quanh lõi · " +
                  Math.min(
                    100,
                    Math.round(
                      (r.progress / this.catalog.raid.circleSeconds) * 100,
                    ),
                  ) +
                  "%",
          );
        }
        for (const hazard of r.hazards || []) {
          g.fillStyle(0x85b84e, 0.25);
          g.fillCircle(hazard.x, hazard.y, hazard.radius);
        }
        for (const h of r.heads) {
          if (h.hp > 0)
            sprite(
              h.id,
              {
                x: h.x,
                y: h.y,
              },
              25,
              color(this.catalog.segments[h.element]?.color),
              5,
            );
        }
        if (r.warning > 0 && r.target) {
          g.lineStyle(4, 0xff907f, 1);
          g.strokeCircle(
            r.target.x,
            r.target.y,
            this.catalog.raid.counterRadius,
          );
        }
      }
    }
    for (const [key, image] of this.pool)
      if (!seen.has(key)) image.setVisible(false);
    for (const [key, text] of this.labels)
      if (!seenLabels.has(key)) {
        text.destroy();
        this.labels.delete(key);
      }
    if (this.pool.size > 3000)
      for (const [key, image] of this.pool)
        if (!image.visible) {
          image.destroy();
          this.pool.delete(key);
        }
    g.setDepth(8);
    this.drawMinimap(world, id);
  }
  drawMinimap(world: any, id: string) {
    const ctx = this.minimap.getContext("2d");
    if (!ctx) return;
    const width = this.minimap.width,
      height = this.minimap.height,
      sx = width / world.width,
      sy = height / world.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#142019";
    ctx.fillRect(0, 0, width, height);
    const dot = (p: any, c: string, r: number) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const p of world.players)
      if (p.alive)
        dot(p, p.id === id ? "#d9f39c" : "#889976", p.id === id ? 3 : 2);
    for (const e of world.director?.events || []) dot(e, "#edab7f", 3);
    if (world.director?.portal) dot(world.director.portal, "#87e5d0", 4);
    if (world.director?.crown) dot(world.director.crown, "#ffe194", 4);
    if (world.director?.apex) dot(world.director.apex, "#ff765f", 5);
    if (world.director?.raid) dot(world.director.raid, "#dd9aca", 4);
  }
}
