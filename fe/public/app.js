import {t as uiText,htmlCopy} from './configuration.js';
import {
  createWorld,
  addPlayer,
  stepWorld,
  chooseUpgrade,
} from "/game/engine.js";
import { SPECIES, UPGRADE_DEFS, SEGMENT_DEFS } from "/game/content.js";
import { applyFrame } from "/game/network.js";
import { applyPathFrame } from "/game/path-network.js";
import { RARITIES, UPGRADE_TAGS, TRAITS } from "/game/builds.js";
import { createAccountUI } from "./account.js";
import { ArenaRenderer, drawHero, snakeIcon } from "./renderer.js";
import { configureContent } from "/game/content.js";
import { configureBuilds } from "/game/builds.js";
import { chooseEvolution } from "/game/v2.js";
import { bootstrapV2, createV2UI } from "./v2-ui.js";
import {configuration} from './configuration.js';
const v2 = await bootstrapV2();
if (v2) {
  configureContent(v2.catalog);
  configureBuilds(v2.catalog);
}

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const safeColor=value=>/^#[a-fA-F0-9]{6}$/.test(value)?value:'inherit';
const clock = (seconds) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;
const number = (n) => Math.floor(n || 0).toLocaleString("vi-VN");
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
const settings = {
  ...{
    sound: true,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    contrast: false,
    stats: false,
  },
  ...read("serpent.settings", {}),
};
let records = read("serpent.records", {
  runs: 0,
  time: 0,
  kills: 0,
  score: 0,
  length: 0,
  wins: 0,
});
let selectedSpecies = SPECIES.some(
  (s) => s.id === read("serpent.species", configuration.defaults.species),
)
  ? read("serpent.species", configuration.defaults.species)
  : configuration.defaults.species;
let selectedMode = v2.catalog.client.defaultMode,
  view = "home",
  gameMode = "solo",
  world = null,
  ownId = "local",
  paused = false,
  resultShown = false,
  modalKind = "";
let soloRunId = "";
const presenceId = (() => {
  try {
    let id = sessionStorage.getItem("serpent.presence");
    if (!id) {
      id =
        globalThis.crypto?.randomUUID?.() ||
        `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("serpent.presence", id);
    }
    return id;
  } catch {
    return `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
})();
let directoryBusy = false;
let directoryCache = null;
let roomCapacity = v2.catalog.modes.find(m=>m.id==='coop').capacity;
let arenaCapacity = v2.catalog.modes.find(m=>m.id==='arena').capacity;
let inputSequence = 0;
const net = {
  tickRate: null,
  tickMs: null,
  state: "HEALTHY",
  arrivals: [],
  rtts: [],
  jitter: 0,
  snapshotHz: 0,
  traffic: [],
  kibPerSecond: 0,
  protocol: 1,
  ack: null,
};
const wireEncoder = new TextEncoder();
let slowFramesSince = 0;
let interactHeld = false;
let socket = null,
  room = null,
  lobbyPlayers = [],
  token = null,
  networkGeneration = 0,
  reconnectDeadline = 0,
  reconnectTimer = null,
  connected = false,
  ping = 0;
let accumulator = 0,
  lastFrame = performance.now(),
  lastHud = 0,
  lastHero = 0,
  lastInput = 0,
  lastPing = 0,
  lastLevel = 1,
  lastKills = 0,
  lastLength = 7,
  lastChoiceKey = "",
  gameNoticeUntil = 0,
  toastTimer = 0;
let soundContext = null,
  frameSamples = [],
  fps = 60,
  currentFrameMs = 16.7;
const keys = new Set();
const pointer = { x: 0, y: 0, active: false };
const commands = { dash: false, pulse: false };
const renderer = v2
  ? new v2.runtime.PhaserArenaRenderer($("#arena"), $("#minimap"), v2.catalog)
  : new ArenaRenderer($("#arena"), $("#minimap"));
const motion = v2 ? new v2.runtime.MotionBuffer(v2.catalog) : null;
const v2ui = v2
  ? createV2UI({
      catalog: v2.catalog,
      send,
      openModal,
      escapeHtml,
      getPlayer: () => world?.players.find((p) => p.id === ownId),
      renderer,
    })
  : null;
if (v2) {
  for (const mode of v2.catalog.modes)
    if (!$(`#mode-${mode.id}`)) {
      const button = document.createElement("button");
      button.id = `mode-${mode.id}`;
      button.textContent = mode.name;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => setMode(mode.id));
      $(".mode-switch").append(button);
    }
  const admin = document.createElement("a");
  admin.href = "/admin.html";
  admin.className = "nav-item";
  admin.textContent = uiText("text_79a6945a541c0f");
  admin.hidden = true;
  $(".sidebar nav").append(admin);
  fetch("/api/account/access")
    .then((r) => r.json())
    .then((a) => {
      admin.hidden = !a.adminPanel;
    })
    .catch(() => {});
}
const accounts = createAccountUI({
  openModal,
  escapeHtml,
  toast,
  onChange(profile) {
    $("#account-button").textContent = profile
      ? `${profile.display_name} · ${profile.gold} vàng`
      : uiText("text_47e7aeb3d0c0cd");
    if (profile) {
      $("#player-name").value = profile.display_name;
      if (selectedMode !== "solo" && !profile.snakes.includes(selectedSpecies))
        selectedSpecies = configuration.defaults.species;
    }
    renderSpecies();
  },
});
$("#player-name").value = read("serpent.name", configuration.defaults.playerName);
document.body.classList.toggle("high-contrast", settings.contrast);

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), v2.catalog.client.toastMilliseconds);
}
function notice(message, duration = v2.catalog.client.noticeMilliseconds) {
  $("#game-notice").textContent = message;
  $("#game-notice").classList.add("visible");
  gameNoticeUntil = performance.now() + duration;
}
function sound(kind) {
  if (!settings.sound) return;
  try {
    soundContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (soundContext.state === "suspended") soundContext.resume();
    const o = soundContext.createOscillator(),
      g = soundContext.createGain();
    o.connect(g);
    g.connect(soundContext.destination);
    const now = soundContext.currentTime;
    const freq =
      { pickup: 570, kill: 150, level: 480, dash: 240, pulse: 110, start: 330 }[
        kind
      ] || 330;
    o.type = kind === "pulse" ? "sine" : "triangle";
    o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(
      kind === "level" ? 960 : Math.max(50, freq * 0.5),
      now + 0.16,
    );
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.045, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    o.start(now);
    o.stop(now + 0.22);
  } catch {}
}
function speciesCards() {
  return SPECIES.map(
    (s) =>
      `<button class="species-card ${s.id === selectedSpecies ? "selected" : ""}" data-species="${escapeHtml(s.id)}" aria-pressed="${s.id === selectedSpecies}" ${selectedMode !== "solo" && accounts.profile && !accounts.profile.snakes.includes(s.id) ? `disabled title="${uiText("text_f09168052f9c4a")}"` : ""}><span class="selection-dot">${s.id === selectedSpecies ? "✓" : ""}</span>${snakeIcon(s.color)}<strong>${escapeHtml(s.name)}</strong><small>${selectedMode !== "solo" && accounts.profile && !accounts.profile.snakes.includes(s.id) ? uiText("text_d2c1dbfa6b4892") : escapeHtml(s.title)}</small></button>`,
  ).join("");
}
function renderSpecies() {
  $("#species-grid").innerHTML = speciesCards();
  $("#selected-species-name").textContent = SPECIES.find(
    (s) => s.id === selectedSpecies,
  ).name;
}
function setMode(mode) {
  selectedMode = mode;
  if (
    mode !== "solo" &&
    accounts.profile &&
    !accounts.profile.snakes.includes(selectedSpecies)
  )
    selectedSpecies = configuration.defaults.species;
  renderSpecies();
  for (const id of v2
    ? [...v2.catalog.modes.map((m) => m.id), "solo"]
    : ["arena", "solo", "coop"]) {
    $(`#mode-${id}`).classList.toggle("selected", id === mode);
    $(`#mode-${id}`).setAttribute("aria-pressed", String(id === mode));
  }
  $("#play-button").innerHTML =
    `<span>${mode === "arena" ? uiText("text_57bbfb7ebe98b9") : mode === "solo" ? uiText("text_eba03ad4826177") : uiText("text_5d137859d5120c")}</span><span>↗</span>`;
  $("#mode-capacity").textContent =
    mode === "solo"
      ? "1 / Solo"
      : `Tối đa ${mode === "arena" ? arenaCapacity : roomCapacity}`;
  $("#arena-intro").hidden = mode !== "arena";
  $("#mode-duration").textContent = mode === "arena" ? uiText("text_ee6455636d4579") : uiText("text_ed33fe6a261bc3");
  $("#mode-note").innerHTML =
    mode === "arena"
      ? "<span>◎</span> Đấu trường đang chạy. Sống sót, săn đối thủ và hồi sinh với một build mới."
      : mode === "solo"
        ? "<span>◇</span> Di chuyển liên tục. Ăn để lớn. Sống để tiến hóa."
        : "<span>♧</span> Cùng đấu trường, mỗi người một build. Chia sẻ mã để mời bạn bè.";
  if (v2 && mode !== "solo") {
    const definition = v2.catalog.modes.find((m) => m.id === mode);
    $("#play-button").innerHTML =
      `<span>${escapeHtml(definition.name)} · Vào chơi</span><span>↗</span>`;
    $("#mode-capacity").textContent = `Tối đa ${definition.capacity}`;
    $("#mode-duration").textContent = definition.continuous
      ? uiText("text_ee6455636d4579")
      : Math.floor(definition.duration / 60) + uiText("text_cf728a6aa3dd60");
    $("#mode-note").textContent = definition.description;
  }
}
function bestRecord() {
  $("#best-record").textContent = records.runs
    ? `${clock(records.time)} sống sót · ${number(records.kills)} hạ gục`
    : uiText("text_25bb10a3635c65");
}
function playerName() {
  const n = $("#player-name").value.trim().slice(0, configuration.limits.displayNameMax) || configuration.defaults.playerName;
  write("serpent.name", n);
  return n;
}

function openModal(kind, html) {
  modalKind = kind;
  $("#modal-content").innerHTML = html;
  if (!$("#modal").open) $("#modal").showModal();
}
function closeModal() {
  $("#modal").close();
  if (modalKind === "pause" || (modalKind === "settings" && view === "playing"))
    paused = false;
  modalKind = "";
  keys.clear();
}
function guide() {
  openModal(
    "guide",
    htmlCopy("<div class=\"eyebrow\">{{copy:text_6a5a582fecbf92}}</div><h2>{{copy:text_cf2c4126ead8ea}}</h2><p>{{copy:text_dd7e1e74260c8a}}</p><div class=\"guide-list\"><div class=\"guide-row\"><span>⌁</span><div><strong>{{copy:text_ee59cc5cc3c749}}</strong><small>{{copy:text_813d6defe6200b}}</small></div></div><div class=\"guide-row\"><span>✧</span><div><strong>{{copy:text_5cc1df56c8a57a}}</strong><small>{{copy:text_9d85292572ccd1}}</small></div></div><div class=\"guide-row\"><span>↯</span><div><strong>{{copy:text_5d762422562fbc}}</strong><small>{{copy:text_e46631d761d348}}</small></div></div><div class=\"guide-row\"><span>◎</span><div><strong>{{copy:text_df046d82dda5c3}}</strong><small>{{copy:text_3a1bcbca6c168e}}</small></div></div><div class=\"guide-row\"><span>♧</span><div><strong>{{copy:text_fdb4c9854c4482}}</strong><small>{{copy:text_ccb6da3a9a505f}}</small></div></div></div>"),
  );
}
function showSpecies() {
  openModal(
    "species",
    htmlCopy(`<div class="eyebrow">{{copy:text_9c4f126f1576ed}}</div><h2>{{copy:text_0221ce3acf644f}}</h2><div class="species-grid">${speciesCards()}</div><div class="guide-list">${SPECIES.map((s) => `<div class="guide-row"><span style="color:${/^#[a-fA-F0-9]{6}$/.test(s.color)?s.color:"inherit"}">⌁</span><div><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.description)}</small></div></div>`).join("")}</div>`),
  );
}
function showSettings() {
  if (view === "playing" && gameMode === "solo") paused = true;
  openModal(
    "settings",
    htmlCopy(`<div class="eyebrow">{{copy:text_61051702e782a6}}</div><h2>{{copy:text_202e0e9b0b8556}}</h2><p>{{copy:text_b05ebc995ee9f3}}</p>${[
      ["sound", uiText("text_c1303271503dac"), uiText("text_c63cdc57d7dda8")],
      ["reduced", uiText("text_4cc215f2149768"), uiText("text_fcd029fce344d2")],
      [
        "contrast",
        uiText("text_c45bb50ff67b2e"),
        uiText("text_25ef78195a7480"),
      ],
      [
        "stats",
        uiText("text_4a680be29eaf57"),
        uiText("text_ca51a6d94f9f1e"),
      ],
    ]
      .map(
        ([key, title, desc]) =>
          `<label class="settings-row"><span><strong>${title}</strong><small>${desc}</small></span><input type="checkbox" data-setting="${key}" ${settings[key] ? "checked" : ""}></label>`,
      )
      .join(
        "",
      )}<button class="primary-button" data-action="close-modal"><span>{{copy:text_0136c2cf591217}}</span><span>↗</span></button>`),
  );
  if (v2) {
    const label = document.createElement("label");
    label.className = "settings-row";
    label.innerHTML = htmlCopy(`<span><strong>{{copy:text_d981586e43e669}}</strong><small>{{copy:text_a54b0e24326aa9}}</small></span><select id="graphics-quality"><option value="auto">{{copy:text_a25c80286728c8}}</option>${v2.catalog.graphics.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join("")}</select>`);
    $("#modal-content").insertBefore(
      label,
      $("#modal-content .primary-button"),
    );
    label.querySelector("select").value = settings.graphics || "auto";
    label.querySelector("select").addEventListener("change", (e) => {
      settings.graphics = e.target.value;
      renderer.qualityLevel = settings.graphics;
      write("serpent.settings", settings);
    });
  }
}
function showRecords() {
  openModal(
    "records",
    htmlCopy(`<div class="eyebrow">{{copy:text_97beb8b74b9153}}</div><h2>{{copy:text_72bf5f995bd6b6}}</h2><p>${records.runs ? uiText("text_4504268a668ca9") : uiText("text_506dc8ebbb2874")}</p><div class="result-stats">${[
      [uiText("text_62bb04eae9e55d"), records.runs],
      [uiText("text_d5f5abbe27a366"), clock(records.time)],
      [uiText("text_457e8b14eadc73"), number(records.score)],
      [uiText("text_1a1af3968574d9"), number(records.kills)],
      [uiText("text_6ac23641df17de"), records.length],
      [uiText("text_1f0a6c4e0f3b82"), records.wins],
    ]
      .map(
        ([l, v]) =>
          `<div class="result-stat"><strong>${v}</strong><span>${l}</span></div>`,
      )
      .join("")}</div>`),
  );
}
function pauseGame() {
  if (
    view !== "playing" ||
    resultShown ||
    (gameMode === "solo" && $("#upgrade-modal").open)
  )
    return;
  if ($("#modal").open) {
    closeModal();
    return;
  }
  paused = gameMode === "solo";
  openModal(
    "pause",
    htmlCopy(`<div class="eyebrow">${gameMode === "solo" ? uiText("text_cba343be570cbc") : uiText("text_1c148274b05e93")}</div><h2>${gameMode === "solo" ? uiText("text_8ed898ff623878") : uiText("text_07c8875bb174e7")}</h2><p>${gameMode === "solo" ? uiText("text_fc5024b654605e") : uiText("text_ede3525ce9af47")}</p><button class="primary-button" data-action="close-modal"><span>{{copy:text_87a7ae881fae63}}</span><span>↗</span></button><button class="secondary-button" data-action="settings">{{copy:text_202e0e9b0b8556}}</button><button class="secondary-button" data-action="leave-game">{{copy:text_25365478a1092d}}</button>`),
  );
}

function startSolo() {
  disconnect(true);
  soloRunId = `solo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  gameMode = "solo";
  world = createWorld({
    seed: Math.floor(Math.random() * 2 ** 31),
    mode: "solo",
    duration: v2.catalog.client.soloDurationSeconds,
    ...(v2 ? { catalog: v2.catalog } : {}),
  });
  ownId = "local";
  addPlayer(world, { id: ownId, name: playerName(), species: selectedSpecies });
  beginPlay();
  sound("start");
}
function beginPlay(resuming = false) {
  view = "playing";
  heartbeatPresence();
  paused = false;
  $("#home").hidden = true;
  $("#game").hidden = false;
  if ($("#modal").open) closeModal();
  $("#upgrade-modal").close();
  modalKind = "";
  keys.clear();
  if (!resuming) {
    resultShown = false;
    lastLevel = 1;
    lastKills = 0;
    lastLength = 7;
    lastChoiceKey = "";
    accumulator = 0;
    pointer.active = false;
  }
  renderer.reset(world.players.find((p) => p.id === ownId));
  renderer.resize();
  $("#arena").focus();
  notice(
    resuming
      ? uiText("text_5f91753db5f5b4")
      : uiText("text_ce50d099163c03"),
    4000,
  );
  updateHUD();
}
function returnHome() {
  disconnect(true);
  view = "home";
  heartbeatPresence();
  world = null;
  paused = false;
  resultShown = false;
  keys.clear();
  commands.dash = commands.pulse = false;
  $("#upgrade-modal").close();
  closeModal();
  $("#game").hidden = true;
  $("#home").hidden = false;
  $("#play-button").disabled = false;
  $("#join-button").disabled = false;
  bestRecord();
  refreshDirectory();
}
function finishRun(restore = false) {
  if ((resultShown && !restore) || !world) return;
  resultShown = true;
  paused = gameMode === "solo";
  $("#upgrade-modal").close();
  const p = world.players.find((p) => p.id === ownId);
  if (!p) return;
  const victory =
    gameMode === "extraction" ? p.extracted : world.status === "victory";
  const resultText =
    gameMode === "extraction"
      ? p.extracted
        ? `Đã rút lui với ${number(p.temporaryLoot)} cổ vật. Phần thưởng được máy chủ ghi vào hồ sơ.`
        : uiText("text_a4ec2001ef2148")
      : gameMode === "raid"
        ? victory
          ? uiText("text_36586c7eeece13")
          : uiText("text_5bb66b0901a958")
        : victory
          ? uiText("text_44c4a5e2ba6a26")
          : uiText("text_d79b3a86bf858b");
  const resultKey = gameMode !== "solo" ? `${room?.id}:${ownId}` : soloRunId;
  // Reopening a finished session must not award another completed run.
  const savedRecords = read("serpent.records", records);
  if (!(savedRecords.recent || []).includes(resultKey)) {
    records = {
      runs: savedRecords.runs + 1,
      time: Math.max(savedRecords.time, world.time),
      kills: Math.max(savedRecords.kills, p.kills),
      score: Math.max(savedRecords.score, p.score),
      length: Math.max(savedRecords.length, p.maxLength),
      wins: savedRecords.wins + (victory ? 1 : 0),
      recent: [...(savedRecords.recent || []), resultKey].slice(-30),
    };
    write("serpent.records", records);
  } else records = savedRecords;
  bestRecord();
  openModal(
    "result",
    `<div class="eyebrow">${victory ? uiText("text_848d891f4db52c") : uiText("text_272a8f7a4fe852")}</div><h2>${victory ? uiText("text_4fa67261340e4e") : uiText("text_554b0c7e1708f0")}</h2><p>${resultText}</p><div class="result-stats">${[
      [uiText("text_fc8aeada7a21f1"), clock(world.time)],
      [uiText("text_923a12b64d3f30"), number(p.kills)],
      [uiText("text_3f661e650e6af5"), number(p.score)],
      [uiText("text_6ac23641df17de"), p.maxLength],
      [uiText("text_aff31954854d12"), p.level],
      [uiText("text_bf11e06b299a67"), number(p.gold)],
    ]
      .map(
        ([l, v]) =>
          `<div class="result-stat"><strong>${v}</strong><span>${l}</span></div>`,
      )
      .join(
        "",
      )}</div><button class="primary-button" data-action="${gameMode === "solo" ? "retry" : "leave-game"}"><span>${gameMode === "solo" ? uiText("text_13de81861623f0") : uiText("text_2132b3ae1467e8")}</span><span>↗</span></button>${gameMode === "solo" ? htmlCopy("<button class=\"secondary-button\" data-action=\"leave-game\">{{copy:text_0f135a9c2f3b9d}}</button>") : ""}`,
  );
}

function showArenaResult() {
  if (resultShown) return;
  resultShown = true;
  $("#upgrade-modal").close();
  const p = world.players.find((p) => p.id === ownId);
  openModal(
    "arena-result",
    htmlCopy(`<div class="eyebrow">{{copy:text_6299e01a6949ad}}</div><h2>{{copy:text_d23584ad799b83}}</h2><p>{{copy:text_a34d116f1df7ce}}</p><div class="result-stats"><div class="result-stat"><strong>${clock(world.time - p.lifeStarted)}</strong><span>{{copy:text_fc8aeada7a21f1}}</span></div><div class="result-stat"><strong>${number(p.score)}</strong><span>{{copy:text_3f661e650e6af5}}</span></div><div class="result-stat"><strong>${p.pvpKills || 0}</strong><span>{{copy:text_6484d9620a4aaf}}</span></div></div><p class="account-note">${accounts.profile ? uiText("text_165805a3a787fc") : uiText("text_f90333d4851a1f")}</p><button class="primary-button" data-action="arena-respawn" disabled>{{copy:text_452c6d5d720845}}</button><button class="secondary-button" data-action="leave-game">{{copy:text_a6f6501f96dab9}}</button>`),
  );
  const saveLabel = $("#modal-content .account-note");
  if (saveLabel) saveLabel.id = "life-save-status";
  if (accounts.profile) {
    const lifeId = p.lifeId;
    const check = async (attempt = 0) => {
      if (
        modalKind !== "arena-result" ||
        world?.players.find((p) => p.id === ownId)?.lifeId !== lifeId
      )
        return;
      try {
        const saved = await accounts.savedLife(lifeId);
        if (saved) {
          if ($("#life-save-status"))
            $("#life-save-status").textContent =
              `Đã lưu vào hồ sơ · +${saved.earned_gold} vàng`;
          await accounts.refresh();
          return;
        }
      } catch {}
      if (attempt < 20) setTimeout(() => void check(attempt + 1), 1500);
      else if ($("#life-save-status"))
        $("#life-save-status").textContent =
          uiText("text_d812de85266a7f");
    };
    setTimeout(() => void check(), 700);
  }
}

function storeSession() {
  try {
    if (token)
      sessionStorage.setItem("serpent.session", JSON.stringify({ token }));
    else sessionStorage.removeItem("serpent.session");
  } catch {}
}
function send(message) {
  if (message.type === "evolution" && gameMode === "solo") {
    chooseEvolution(world, ownId, message);
    return;
  }
  if (message.type === "input" && motion)
    motion.input(
      message.seq,
      message,
      Math.min(0.1, (performance.now() - lastInput) / 1000),
    );
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message));
}
function viewRadius() {
  // The arena is hidden before joining, so no renderer size exists yet.
  const width = renderer.width || window.innerWidth;
  const height = renderer.height || window.innerHeight;
  const zoom = renderer.zoom || (width < 600 ? 0.79 : 1);
  return Math.max(
    450,
    Math.min(1800, Math.hypot(width, height) / (2 * zoom) + 200),
  );
}
function disconnect(leave = false) {
  networkGeneration++;
  clearTimeout(reconnectTimer);
  if (socket) {
    if (leave && socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: "leave" }));
    socket.close();
  }
  socket = null;
  connected = false;
  token = null;
  storeSession();
  room = null;
  lobbyPlayers = [];
  reconnectDeadline = 0;
}
function connection(message, resuming = false) {
  return new Promise((resolve, reject) => {
    const generation = ++networkGeneration;
    socket?.close();
    connected = false;
    inputSequence = 0;
    const ws =
      v2 && (!resuming || message.token?.startsWith("v2:"))
        ? new v2.runtime.ColyseusSocket()
        : new WebSocket(
            `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
          );
    socket = ws;
    let welcomed = false,
      settled = false;
    let decoded = null;
    let lastResync = -Infinity;
    let loadingVersion = "";
    let pendingSecurity=null;
    function receiveWorld(data) {
      try {
        if (data.frame) {
          decoded = (data.frame.v === 3 ? applyPathFrame : applyFrame)(
            decoded,
            data.frame,
          );
          world = decoded.snapshot;
        } else if (data.snapshot) world = data.snapshot;
        else throw new Error("Missing snapshot");
        if (
          v2 &&
          world.contentVersion &&
          world.contentVersion !== v2.catalog.id &&
          loadingVersion !== world.contentVersion
        ) {
          const version = world.contentVersion;
          loadingVersion = version;
          void fetch(
            "/api/account/catalog?version=" + encodeURIComponent(version),
          )
            .then((r) => {
              if (!r.ok) throw new Error(uiText("text_6635f7c25bdef8"));
              return r.json();
            })
            .then(({ catalog }) => {
              if (world?.contentVersion !== version) return;
              Object.assign(v2.catalog, catalog);
              configureContent(catalog);
              configureBuilds(catalog);
            })
            .catch((error) => {
              loadingVersion = "";
              toast(error.message);
            });
        }
        net.ack = data.ack ?? null;
        if (motion) motion.accept(world, data.playerId || ownId, data.ack || 0);
        return true;
      } catch {
        // Keep the last valid world until a complete baseline arrives.
        const now = performance.now();
        if (now - lastResync >= 1000 && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resync" }));
          lastResync = now;
        }
        return false;
      }
    }
    const timeout = setTimeout(() => {
      if (!welcomed) {
        settled = true;
        reject(new Error(uiText("text_6abe16cdc9f338")));
        ws.close();
      }
    }, 10000);
    ws.addEventListener("open", () => {
      if (generation === networkGeneration)
        ws.send(
          JSON.stringify({
            ...message,
            presenceId,
            protocol: 3,
            viewRadius: viewRadius(),
          }),
        );
    });
    ws.addEventListener("message", (event) => {
      if (generation !== networkGeneration) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if(data.type==='security'){pendingSecurity=data;accounts.security.showRestriction(data.restriction);return;}
      if(data.type==='report_saved'){toast(uiText("text_e5ad3bf164b826"));closeModal();return;}
      if (data.type === "transport-state") {
        connected = data.connected;
        if (!data.connected) notice(uiText("text_72eb836483d5a9"), 4000);
        return;
      }
      if (data.type === "welcome") {
        decoded = null;
        motion?.reset();
        if (!receiveWorld(data)) return;
        welcomed = true;
        settled = true;
        clearTimeout(timeout);
        connected = true;
        reconnectDeadline = 0;
        token = data.token;
        ownId = data.playerId;
        room = data.room;
        if (room.mode === "arena") arenaCapacity = room.maxPlayers;
        else roomCapacity = room.maxPlayers;
        gameMode = room.mode;
        net.arrivals = [];
        net.rtts = [];
        net.jitter = 0;
        net.snapshotHz = 0;
        net.traffic = [];
        net.kibPerSecond = 0;
        net.protocol = data.frame?.v || 1;
        if (data.telemetry) Object.assign(net, data.telemetry);
        storeSession();
        if (room.state === "playing" || room.state === "finished") {
          beginPlay(resuming);
          if (world.status !== "playing") finishRun(true);
        } else {
          view = "lobby";
          renderLobby();
        }
        resolve(data);
      } else if (data.type === "lobby") {
        room = data.room;
        lobbyPlayers = data.players;
        if (room.state === "lobby" && view !== "playing") {
          view = "lobby";
          renderLobby();
        }
      } else if (data.type === "started") {
        if (data.frame && !receiveWorld(data)) return;
        if (!world || !welcomed) return;
        if (data.room) room = data.room;
        beginPlay();
        sound("start");
      } else if (data.type === "respawned") {
        if (data.frame && !receiveWorld(data)) return;
        if (!world || !welcomed) return;
        beginPlay();
        notice(uiText("text_e4e7dd193a2799"), 3000);
      } else if (data.type === "snapshot") {
        if (!receiveWorld(data)) return;
        const at = performance.now();
        net.arrivals.push(at);
        while (net.arrivals.length && net.arrivals[0] < at - 2000)
          net.arrivals.shift();
        if (net.arrivals.length > 1)
          net.snapshotHz =
            ((net.arrivals.length - 1) * 1000) / (at - net.arrivals[0]);
        net.traffic.push({ at, bytes: wireEncoder.encode(event.data).length });
        while (net.traffic.length && net.traffic[0].at < at - 2000)
          net.traffic.shift();
        if (net.traffic.length > 1)
          net.kibPerSecond =
            ((net.traffic
              .slice(1)
              .reduce((total, sample) => total + sample.bytes, 0) /
              (at - net.traffic[0].at)) *
              1000) /
            1024;
        if (data.telemetry) Object.assign(net, data.telemetry);
        if (
          view === "playing" &&
          (world.status !== "playing" ||
            (gameMode === "extraction" &&
              !world.players.find((p) => p.id === ownId)?.alive))
        )
          finishRun();
      } else if (data.type === "pong") {
        ping = Math.max(0, performance.now() - data.at);
        net.rtts.push(ping);
        if (net.rtts.length > 20) net.rtts.shift();
        const average = net.rtts.reduce((a, b) => a + b, 0) / net.rtts.length;
        net.jitter = Math.sqrt(
          net.rtts.reduce((n, rtt) => n + (rtt - average) ** 2, 0) /
            net.rtts.length,
        );
      } else if (data.type === "error") {
        if (!welcomed) {
          clearTimeout(timeout);
          settled = true;
          reject(new Error(data.message));
          if (resuming) {
            token = null;
            storeSession();
          }
          ws.close();
        } else toast(data.message);
      }
    });
    ws.addEventListener("close", (event) => {
      clearTimeout(timeout);
      if (generation !== networkGeneration) return;
      connected = false;
      if (!settled) {
        settled = true;
        reject(new Error(uiText("text_ccd9e52bc12489")));
      }
      if (event.code === 4001) {
        returnHome();
        if(pendingSecurity){accounts.security.showRestriction(pendingSecurity.restriction);return;}
        toast(uiText("text_8b3525a436aad8"));
        return;
      }
      if (token && (view === "playing" || view === "lobby"))
        scheduleReconnect();
    });
    ws.addEventListener("error", () => {});
  });
}
function scheduleReconnect() {
  if (!reconnectDeadline) reconnectDeadline = Date.now() + v2.catalog.network.reconnectSeconds*1000;
  if (Date.now() >= reconnectDeadline) {
    toast(uiText("text_30b90d654540f0"));
    returnHome();
    return;
  }
  if (view === "playing") notice(uiText("text_12ba5db987ba97"), 65000);
  else toast(uiText("text_05bad7b4265717"));
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!token) return;
    connection({ type: "resume", token }, true).catch((error) => {
      if (token) scheduleReconnect();
      else {
        toast(error.message);
        returnHome();
      }
    });
  }, 1500);
}
async function createRoom() {
  const button = $("#play-button");
  button.disabled = true;
  try {
    await connection({
      type: "create",
      mode: selectedMode,
      name: `${playerName()}'s camp`,
      playerName: playerName(),
      species: selectedSpecies,
      ticket: await accounts.ticket(
        selectedSpecies,
        v2 ? selectedMode : undefined,
      ),
    });
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}
async function enterArena() {
  const button = $("#play-button");
  button.disabled = true;
  try {
    await connection({
      type: "arena",
      mode: selectedMode,
      playerName: playerName(),
      species: selectedSpecies,
      ticket: await accounts.ticket(selectedSpecies, selectedMode),
    });
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}
function renderLobby() {
  if (!room || room.state !== "lobby") return;
  heartbeatPresence();
  const own = lobbyPlayers.find((p) => p.id === ownId);
  openModal(
    "lobby",
    htmlCopy(`<div class="eyebrow">${escapeHtml(v2?.catalog.modes.find((m) => m.id === room.mode)?.name || "CO-OP")} · PHÒNG CHỜ</div><h2>{{copy:text_a208e1b2f86d41}}</h2><p>{{copy:text_30ebc3102e8892}}</p><div class="room-code"><div><span class="tiny-label">{{copy:text_e186126f6ba36f}}</span><br><strong>${escapeHtml(room.code)}</strong></div><button data-action="copy-code">{{copy:text_68b42cafd63b46}}</button></div><div id="lobby-players">${lobbyPlayers.map((p) => `<div class="lobby-player"><span>⌁</span><div><strong>${escapeHtml(p.name)} ${p.id === ownId ? uiText("text_1de8c7c5b1b811") : ""}</strong><small>${escapeHtml(SPECIES.find((s) => s.id === p.species)?.name || p.species)}</small></div><span class="${p.ready ? "ready" : ""}">${!p.connected ? uiText("text_c1cc66a343248a") : p.ready ? uiText("text_e8b93ccb983626") : uiText("text_a03b7970e7a456")}</span></div>`).join("")}</div><p style="margin-top:15px">${lobbyPlayers.length} / ${room.maxPlayers} người · ${Math.floor((v2?.catalog.modes.find((m) => m.id === room.mode)?.duration || v2.catalog.client.soloDurationSeconds) / 60)} phút</p><button class="primary-button" data-action="ready" ${!connected || !own ? "disabled" : ""}><span>${own?.ready ? uiText("text_debfc6e57dc8e1") : uiText("text_9791d065bf8cb3")}</span><span>↗</span></button><button class="secondary-button" data-action="leave-game">{{copy:text_fb10deefb622fc}}</button>`),
  );
}
function showJoin() {
  openModal(
    "join",
    htmlCopy("<div class=\"eyebrow\">{{copy:text_cbafd36f561f21}}</div><h2>{{copy:text_ef698f542b4796}}</h2><p>{{copy:text_c3fa66a51657a3}}</p><div class=\"directory-summary\" id=\"directory-summary\">{{copy:text_d6fe2303a71f8c}}</div><div class=\"directory-toolbar\"><label><input type=\"checkbox\" id=\"joinable-only\"> {{copy:text_2323d5be15235f}}</label><button class=\"text-button\" data-action=\"refresh-rooms\">{{copy:text_2e223e2c9d30a7}}</button></div><div id=\"room-directory\" class=\"room-directory\" aria-live=\"polite\"></div><p id=\"directory-status\" class=\"directory-status\"></p><form id=\"join-form\" class=\"join-code-form\"><label class=\"input-label\" for=\"room-code-input\">{{copy:text_06fb2e223e514d}}</label><div><input id=\"room-code-input\" maxlength=\"8\" placeholder=\"{{copy:text_e12eb24e1448ea}}\" autocomplete=\"off\" spellcheck=\"false\" required><button type=\"submit\" class=\"primary-button\"><span>{{copy:text_c775afb4d91612}}</span><span>↗</span></button></div></form><button class=\"secondary-button\" data-action=\"quick-match\">{{copy:text_a17025588e8b69}}</button><p id=\"join-error\" class=\"error-text\" role=\"alert\" style=\"margin-top:12px\"></p>"),
  );
  refreshDirectory();
}
async function joinRoom(code, quick = false) {
  const form = $("#join-form");
  const buttons = $("#modal-content").querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  try {
    let mode = selectedMode === "solo" ? "coop" : selectedMode;
    if (v2 && !quick) {
      const response = await fetch("/api/rooms");
      if (!response.ok) throw new Error(uiText("text_f90443077be671"));
      const target = (await response.json()).rooms.find(
        (r) => r.code === code?.trim().toUpperCase(),
      );
      if (!target) throw new Error(uiText("text_4b3ff2ec65bba5"));
      mode = target.mode;
    }
    await connection({
      type: quick ? "quick" : "join",
      mode,
      code: code?.trim().toUpperCase(),
      playerName: playerName(),
      species: selectedSpecies,
      ticket: await accounts.ticket(selectedSpecies, v2 ? mode : undefined),
    });
  } catch (error) {
    if ($("#join-error")) $("#join-error").textContent = error.message;
    else toast(error.message);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}
async function refreshDirectory() {
  if (directoryBusy) return;
  directoryBusy = true;
  try {
    const started = performance.now();
    const response = await fetch("/api/rooms", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    directoryCache = data;
    if (Number.isInteger(data.arenaCapacity))
      arenaCapacity = data.arenaCapacity;
    if (Number.isInteger(data.roomCapacity)) {
      roomCapacity = data.roomCapacity;
      $("#mode-capacity").textContent =
        selectedMode === "solo"
          ? "1 / Solo"
          : `Tối đa ${v2?.catalog.modes.find((m) => m.id === selectedMode)?.capacity ?? (selectedMode === "arena" ? arenaCapacity : roomCapacity)}`;
    }
    $("#server-status").textContent =
      `${data.online} PHIÊN ONLINE · ${data.inGame || 0} ĐANG CHƠI`;
    renderDirectory();
    if ($("#directory-status"))
      $("#directory-status").textContent =
        `Cập nhật ${new Date().toLocaleTimeString("vi-VN")} · Độ trễ trạm ${Math.round(performance.now() - started)} ms · Tự làm mới mỗi 5 giây`;
  } catch {
    $("#server-status").textContent = uiText("text_1b4077576a245c");
    if ($("#directory-status")) {
      $("#directory-status").textContent =
        uiText("text_d505d7bba7f70e");
      $("#room-directory")
        .querySelectorAll("button")
        .forEach((button) => (button.disabled = true));
    }
  } finally {
    directoryBusy = false;
  }
}
function renderDirectory() {
  if (!$("#room-directory") || !directoryCache) return;
  const data = directoryCache;
  $("#directory-summary").innerHTML =
    htmlCopy(`<span><strong>${data.online}</strong> {{copy:text_5f73e98a21fbdd}}</span><span><strong>${data.inGame || 0}</strong> {{copy:text_2e03cbdcfa96c9}}</span><span><strong>${data.rooms.length}</strong> {{copy:text_926382e46ac7d4}}</span>`);
  const rooms = data.rooms.filter(
    (r) =>
      !$("#joinable-only").checked ||
      (r.joinable ?? (r.state === "lobby" && r.players < r.maxPlayers)),
  );
  rooms.sort(
    (a, b) =>
      Number(b.joinable ?? b.state === "lobby") -
      Number(a.joinable ?? a.state === "lobby"),
  );
  $("#room-directory").innerHTML = rooms.length
    ? rooms
        .map((r) => {
          const joinable =
            r.joinable ?? (r.state === "lobby" && r.players < r.maxPlayers);
          const label =
            r.mode === "arena"
              ? `OPEN ARENA · ${r.bots || 0} BOT`
              : r.state === "playing"
                ? `ĐANG CHƠI · ${clock(r.elapsed || 0)}`
                : r.state === "finished"
                  ? uiText("text_dcd150484b20ff")
                  : r.players >= r.maxPlayers
                    ? uiText("text_b4efb74ce81a58")
                    : uiText("text_a03b7970e7a456");
          return `<article class="room-row" data-room-code="${escapeHtml(r.code)}"><span class="room-symbol">♧</span><div class="room-details"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.map || "The Overgrowth")} · ${escapeHtml(r.code)}</small><span class="room-state ${joinable ? "joinable" : ""}">${label}${r.reservedSlots ? ` · ${r.reservedSlots} CHỖ RECONNECT` : ""}</span></div><div class="room-capacity"><strong>${r.players}<small> / ${r.maxPlayers}</small></strong><button data-join-room="${escapeHtml(r.code)}" ${joinable ? "" : "disabled"}>${joinable ? "Tham gia ↗" : uiText("text_871f88cb44d4ed")}</button></div></article>`;
        })
        .join("")
    : `<div class="empty-rooms"><span>⌁</span><strong>${data.rooms.length ? uiText("text_e80abde3eede5c") : uiText("text_ca9f3381a0ba48")}</strong><small>${data.rooms.length ? uiText("text_7b65fa31f821dc") : uiText("text_a16c09f7de9dbb")}</small></div>`;
}
async function heartbeatPresence() {
  try {
    await fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: presenceId,
        state:
          view === "playing" && gameMode !== "solo"
            ? "game"
            : view === "lobby"
              ? "lobby"
              : "menu",
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Presence is informational; a failed heartbeat must not interrupt gameplay.
  }
}

function choose(id) {
  const p = world?.players.find((p) => p.id === ownId);
  if (!p?.choices.includes(id)) return;
  if (gameMode === "solo") {
    chooseUpgrade(world, ownId, id);
    lastChoiceKey = "";
  } else send({ type: "upgrade", id });
  $("#upgrade-modal").close();
  keys.clear();
  sound("level");
}
function renderChoices(p) {
  const key = `${p.level}|${p.choices.join("|")}|${JSON.stringify(p.choiceRarities || {})}`;
  if (!p.choices.length || !p.alive || resultShown) {
    $("#upgrade-modal").close();
    lastChoiceKey = "";
    return;
  }
  if (key !== lastChoiceKey) {
    lastChoiceKey = key;
    $("#upgrade-choices").innerHTML = p.choices
      .map((id, i) => {
        const d = UPGRADE_DEFS.find((u) => u.id === id);
        if (!d) return "";
        const rarity =
          RARITIES.find((r) => r.id === p.choiceRarities?.[id]) || RARITIES[0];
        const mechanic =
          id === "fire" && rarity.id === "MYTHIC"
            ? uiText("text_a87309177fe9bc")
            : id === "fire" && rarity.id === "LEGENDARY"
              ? uiText("text_86dc680983519c")
              : id === "fire" && rarity.id === "EPIC"
                ? uiText("text_bc8a11bf90e8cd")
                : `Hiệu lực chỉ số ×${rarity.power}.`;
        return `<button class="upgrade-card" style="--rarity:${safeColor(rarity.color)}" data-upgrade="${escapeHtml(id)}"><kbd>${i + 1}</kbd><span class="rarity-label">${escapeHtml(rarity.name)}</span><span class="upgrade-icon" style="color:${safeColor(d.color)}">${escapeHtml(SEGMENT_DEFS[id]?.icon || "✦")}</span><strong>${escapeHtml(d.name)}</strong><small>${escapeHtml(d.description)} ${mechanic}</small><span class="upgrade-tags">${(UPGRADE_TAGS[id] || []).slice(0, 3).map(escapeHtml).join(" · ")}</span></button>`;
      })
      .join("");
    $("#upgrade-modal").classList.toggle("coop-upgrade", gameMode !== "solo");
    if (!$("#upgrade-modal").open) {
      if (gameMode !== "solo") $("#upgrade-modal").show();
      else $("#upgrade-modal").showModal();
    }
    if (gameMode === "solo") keys.clear();
    sound("level");
  }
  $("#upgrade-subtitle").textContent =
    gameMode === "solo"
      ? `CẤP ${p.level} · Chọn một nâng cấp. Trận đang tạm dừng.`
      : `CẤP ${p.level} · Trận tiếp tục · Tự chọn sau ${Math.ceil(p.choiceTime)} giây`;
}
function leaderboard(full = false) {
  const rows = [...world.players]
    .sort((a, b) => b.score - a.score)
    .slice(0, full ? 30 : 6);
  return `<span class="tiny-label">${full ? uiText("text_b236f551938fda") : uiText("text_db741ddc52e3fe")}</span>${rows.map((p, i) => `<div class="rank-row ${p.id === ownId ? "own" : ""}"><span>${i + 1}</span><span>${escapeHtml(p.name)}${!p.alive ? " †" : ""}<small>${p.bodyLength || p.segments.length + 1} đốt · ${p.pvpKills || 0} PvP</small></span><span>${number(p.score)}</span></div>`).join("")}`;
}
function updateHUD() {
  if (!world) return;
  const p = world.players.find((p) => p.id === ownId);
  if (!p) return;
  $("#hud-name").textContent = p.name;
  $("#hud-species").textContent = p.species.toUpperCase();
  $("#hud-level").textContent = p.level;
  $("#hud-integrity").textContent = `${Math.ceil((p.hp / p.maxHp) * 100)}%`;
  $("#health-fill").style.width = `${(p.hp / p.maxHp) * 100}%`;
  $("#hud-length").textContent = `${p.segments.length + 1} đốt`;
  $("#hud-xp").textContent = `${Math.floor(p.xp)} / ${p.xpNext} EXP`;
  $("#xp-fill").style.width = `${Math.min(100, (p.xp / p.xpNext) * 100)}%`;
  $("#hud-timer").textContent = clock(
    gameMode === "arena" ? world.time - p.lifeStarted : world.time,
  );
  $("#hud-kills").textContent = number(p.kills);
  $("#hud-score").textContent = number(p.score);
  $("#hud-gold").textContent = number(p.gold);
  $("#hud-stage").textContent =
    gameMode === "arena"
      ? p.spawnProtection > 0
        ? `BẢO VỆ XUẤT HIỆN · ${Math.ceil(p.spawnProtection)}s`
        : `OPEN ARENA · ${world.players.filter((p) => !p.bot).length} NGƯỜI · ${world.players.filter((p) => p.bot).length} BOT`
      : world.bossDefeated
        ? uiText("text_964ebf43dcf118")
        : world.bossSpawned
          ? uiText("text_148691a0b5631f")
          : uiText("text_cd649a0a50a960");
  const boss = world.enemies.find((e) => e.type === "boss");
  $("#boss-hud").hidden = !boss;
  if (boss) $("#boss-fill").style.width = `${(boss.hp / boss.maxHp) * 100}%`;
  for (const skill of ["dash", "pulse"]) {
    const cooldown = p[`${skill}Cooldown`];
    $(`#${skill}-cooldown`).textContent =
      cooldown > 0.1 ? `${cooldown.toFixed(1)}s` : uiText("text_57b86e372db32c");
    $(`#${skill}-button`).classList.toggle("cooling", cooldown > 0.1);
  }
  const counts = {};
  for (const s of p.segments) counts[s.type] = (counts[s.type] || 0) + 1;
  $("#body-build").innerHTML = Object.entries(counts)
    .map(
      ([type, n]) =>
        `<span class="body-counter" title="${escapeHtml(SEGMENT_DEFS[type]?.name)}"><i style="color:${safeColor(SEGMENT_DEFS[type]?.color)}">${escapeHtml(SEGMENT_DEFS[type]?.icon || "●")}</i>${n}</span>`,
    )
    .join("");
  $("#trait-hud").innerHTML = (p.traits || [])
    .filter((t) => t.state !== "LOCKED")
    .map((t) => {
      const d = TRAITS.find((d) => d.id === t.id);
      return `<span class="trait ${t.state === "ACTIVE" ? "active" : ""}" title="${escapeHtml(t.state === "ACTIVE" ? d.description : uiText("text_1fec1fdb781d11"))}" >${t.state === "ACTIVE" ? "✧ " + escapeHtml(d.name) : uiText("text_1513b5d7cd0d92") + t.progress + "/" + t.required}</span>`;
    })
    .join("");
  $("#connection-tag").innerHTML =
    gameMode === "solo"
      ? '<span class="status-dot"></span> SOLO'
      : `<span class="status-dot" style="background:${connected ? "#bcec78" : "#efa376"}"></span> ${escapeHtml(room?.code || "CO-OP")} · ${connected ? `${Math.round(ping)} ms` : uiText("text_c1cc66a343248a")}`;
  $("#leaderboard").hidden = gameMode === "solo";
  if (gameMode !== "solo") $("#leaderboard").innerHTML = leaderboard();
  if (!$("#scoreboard").hidden) $("#scoreboard").innerHTML = leaderboard(true);
  $("#telemetry").hidden = !settings.stats;
  if (settings.stats) {
    const sorted = [...frameSamples].sort((a, b) => b - a);
    const lows = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.01)));
    const low = 1000 / (lows.reduce((a, b) => a + b, 0) / lows.length || 16.7);
    $("#telemetry").textContent =
      `PERFORMANCE\nFPS          ${Math.round(fps)}\n1% LOW       ${Math.round(low)}\nFRAME        ${currentFrameMs.toFixed(1)} ms\n${gameMode !== "solo" ? `PING         ${Math.round(ping)} ms\nJITTER       ${net.jitter.toFixed(1)} ms\nSERVER TICK  ${net.tickRate === null ? "…" : net.tickRate.toFixed(1)} Hz\nTICK COST    ${net.tickMs === null ? "…" : net.tickMs.toFixed(2)} ms\nSNAPSHOTS    ${net.snapshotHz.toFixed(1)} Hz\nDOWNLOAD     ${net.kibPerSecond.toFixed(1)} KiB/s\nPROTOCOL     ${net.protocol} · ACK ${net.ack ?? "…"}\n` : "SIM TARGET   30 Hz\n"}PLAYERS      ${world.players.length}\nENEMIES      ${world.enemies.length}\nSEGMENTS     ${world.players.reduce((n, p) => n + p.segments.length, 0)}\nPROJECTILES  ${world.projectiles.length}\n[F3] ẨN THỐNG KÊ`;
  }
  const now = performance.now();
  if (fps < 30 && !document.hidden) slowFramesSince ||= now;
  else slowFramesSince = 0;
  const warning =
    gameMode !== "solo" && !connected
      ? uiText("text_a81ab6a4cf0745")
      : gameMode !== "solo" && net.state === "DEGRADED"
        ? uiText("text_549b47e825507f")
        : gameMode !== "solo" && ping > 180
          ? `MẠNG · Độ trễ cao ${Math.round(ping)} ms`
          : slowFramesSince && now - slowFramesSince > 4000
            ? uiText("text_fee8046173f6cc")
            : "";
  $("#connection-warning").hidden = !warning;
  $("#connection-warning").textContent = warning;
  if (p.kills > lastKills) sound("kill");
  if (p.segments.length + 1 > lastLength) {
    notice(uiText("text_7007b5f6fbd456"), 2000);
    sound("pickup");
  }
  lastLevel = p.level;
  lastKills = p.kills;
  lastLength = p.segments.length + 1;
  if (!p.alive) {
    if (gameMode === "arena" || gameMode === "crown") {
      showArenaResult();
      const button = $('[data-action="arena-respawn"]');
      if (button) {
        const remaining = Math.max(0, Math.ceil(p.respawnAt - world.time));
        button.disabled = remaining > 0 || !connected;
        button.textContent = remaining
          ? `Hồi sinh sau ${remaining} giây`
          : uiText("text_86ca1424a21941");
      }
    } else if (gameMode === "solo" || !world.players.some((q) => q.alive))
      finishRun();
    else notice(uiText("text_7d106fb018829d"), 2000);
  }
  if (world.status !== "playing") finishRun();
  else renderChoices(p);
}
function getInput(dt) {
  const p = world?.players.find((p) => p.id === ownId);
  if (!p) return {};
  let angle = p.angle;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) angle -= 4 * dt;
  if (keys.has("KeyD") || keys.has("ArrowRight")) angle += 4 * dt;
  if (
    !keys.has("KeyA") &&
    !keys.has("ArrowLeft") &&
    !keys.has("KeyD") &&
    !keys.has("ArrowRight") &&
    pointer.active
  ) {
    const target = renderer.screenToWorld(pointer.x, pointer.y);
    if (Math.hypot(target.x - p.x, target.y - p.y) > 15)
      angle = Math.atan2(target.y - p.y, target.x - p.x);
  }
  const input = {
    angle,
    throttle:
      (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) -
      (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
    dash: commands.dash,
    pulse: commands.pulse,
    interact: keys.has("KeyE") || interactHeld,
  };
  commands.dash = commands.pulse = false;
  return input;
}
function frame(now) {
  const raw = now - lastFrame,
    dt = Math.min(raw / 1000, 0.1);
  lastFrame = now;
  currentFrameMs = raw;
  fps = fps * 0.95 + (1000 / Math.max(raw, 1)) * 0.05;
  frameSamples.push(raw);
  if (frameSamples.length > 600) frameSamples.shift();
  if (view === "home" || view === "lobby") {
    if (now - lastHero > (settings.reduced ? 1000 : 50)) {
      drawHero($("#hero-art"), now / 1000, settings.reduced);
      lastHero = now;
    }
  } else if (view === "playing" && world) {
    renderer.quality = !settings.reduced;
    if (v2) renderer.qualityLevel = settings.graphics || "auto";
    if (gameMode === "solo") {
      const p = world.players.find((p) => p.id === ownId);
      if (!paused && !p?.choices.length && world.status === "playing") {
        accumulator += dt;
        let steps = 0;
        while (accumulator >= 1 / 30 && steps < 4) {
          stepWorld(world, { [ownId]: getInput(1 / 30) }, 1 / 30);
          accumulator -= 1 / 30;
          steps++;
          if (p.choices.length || world.status !== "playing") {
            accumulator = 0;
            break;
          }
        }
      } else accumulator = 0;
    } else if (connected) {
      if (now - lastInput >= 1000 / 30) {
        send({
          type: "input",
          ...getInput(Math.min((now - lastInput) / 1000, 0.1)),
          seq: ++inputSequence,
          viewRadius: viewRadius(),
        });
        lastInput = now;
      }
      if (now - lastPing >= 2000) {
        send({ type: "ping", at: now });
        lastPing = now;
      }
    }
    renderer.render(
      motion && gameMode !== "solo" ? motion.draw(world) : world,
      ownId,
      dt,
      now / 1000,
    );
    v2ui?.render(world, ownId);
    if (now - lastHud > 100) {
      updateHUD();
      lastHud = now;
    }
    if (now > gameNoticeUntil) $("#game-notice").classList.remove("visible");
  }
  requestAnimationFrame(frame);
}

document.addEventListener("click", (event) => {
  const join = event.target.closest("[data-join-room]");
  if (join && !join.disabled) {
    joinRoom(join.dataset.joinRoom);
    return;
  }
  const species = event.target.closest("[data-species]");
  if (species) {
    selectedSpecies = species.dataset.species;
    write("serpent.species", selectedSpecies);
    renderSpecies();
    if (modalKind === "species") showSpecies();
    return;
  }
  const upgrade = event.target.closest("[data-upgrade]");
  if (upgrade) {
    choose(upgrade.dataset.upgrade);
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "guide") guide();
  else if (action === "rooms") showJoin();
  else if (action === "refresh-rooms") refreshDirectory();
  else if (action === "species") showSpecies();
  else if (action === "settings") showSettings();
  else if (action === "records") showRecords();
  else if (action === "close-modal") closeModal();
  else if (action === "home") {
    closeModal();
    window.scrollTo({
      top: 0,
      behavior: settings.reduced ? "instant" : "smooth",
    });
  } else if (action === "leave-game") returnHome();
  else if (action === "retry") startSolo();
  else if (action === "arena-respawn") {
    send({ type: "respawn" });
  } else if (action === "ready") {
    const own = lobbyPlayers.find((p) => p.id === ownId);
    send({ type: "ready", ready: !own?.ready });
  } else if (action === "copy-code") {
    navigator.clipboard
      ?.writeText(room.code)
      .then(() => toast(uiText("text_a2ad7c7fda7290")))
      .catch(() => toast(`Mã phòng: ${room.code}`));
  } else if (action === "quick-match") joinRoom("", true);
});
document.addEventListener("change", (event) => {
  if (event.target.id === "joinable-only") {
    renderDirectory();
    return;
  }
  const key = event.target.dataset.setting;
  if (!key) return;
  settings[key] = event.target.checked;
  write("serpent.settings", settings);
  document.body.classList.toggle("high-contrast", settings.contrast);
});
document.addEventListener("submit", (event) => {
  if (event.target.id === "join-form") {
    event.preventDefault();
    joinRoom($("#room-code-input").value);
  }
});
$("#mode-solo").addEventListener("click", () => setMode("solo"));
$("#mode-arena").addEventListener("click", () => setMode("arena"));
$("#mode-coop").addEventListener("click", () => setMode("coop"));
$("#play-button").addEventListener("click", () =>
  (
    v2
      ? v2.catalog.modes.find((m) => m.id === selectedMode)?.continuous ||
        selectedMode === "extraction"
      : selectedMode === "arena"
  )
    ? enterArena()
    : selectedMode === "solo"
      ? startSolo()
      : createRoom(),
);
$("#join-button").addEventListener("click", showJoin);
$("#modal-close").addEventListener("click", () => {
  if (modalKind === "lobby") returnHome();
  else if (modalKind === "result" || modalKind === "arena-result") returnHome();
  else closeModal();
});
$("#modal").addEventListener("cancel", (event) => {
  event.preventDefault();
  if (
    modalKind === "lobby" ||
    modalKind === "result" ||
    modalKind === "arena-result"
  )
    returnHome();
  else closeModal();
});
$("#upgrade-modal").addEventListener("cancel", (event) =>
  event.preventDefault(),
);
$("#pause-button").addEventListener("click", pauseGame);
$("#dash-button").addEventListener("click", () => {
  commands.dash = true;
  sound("dash");
});
$("#pulse-button").addEventListener("click", () => {
  commands.pulse = true;
  sound("pulse");
});
$("#interact-button").addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  interactHeld = true;
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  $("#interact-button").addEventListener(type, () => {
    interactHeld = false;
  });
window.addEventListener("blur", () => {
  interactHeld = false;
  keys.clear();
});
$("#arena").addEventListener("pointermove", (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.active = true;
});
$("#arena").addEventListener("pointerdown", (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.active = true;
  $("#arena").focus();
});
window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "F3") {
    event.preventDefault();
    settings.stats = !settings.stats;
    write("serpent.settings", settings);
    return;
  }
  if (view !== "playing") return;
  if (
    [
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Tab",
    ].includes(event.code)
  )
    event.preventDefault();
  if ($("#upgrade-modal").open) {
    const index = ["Digit1", "Digit2", "Digit3"].indexOf(event.code);
    const p = world.players.find((p) => p.id === ownId);
    if (index >= 0 && p?.choices[index]) {
      choose(p.choices[index]);
      return;
    }
    if (gameMode === "solo") return;
  }
  if (event.code === "Escape") {
    event.preventDefault();
    if ($("#modal").open) {
      if (modalKind === "result" || modalKind === "arena-result") returnHome();
      else closeModal();
    } else pauseGame();
    return;
  }
  if ($("#modal").open) return;
  if (event.code === "Tab") {
    $("#scoreboard").hidden = false;
    $("#scoreboard").innerHTML = leaderboard(true);
    return;
  }
  keys.add(event.code);
  if (["KeyA", "KeyD", "ArrowLeft", "ArrowRight"].includes(event.code))
    pointer.active = false;
  if (event.code === "Space" && !event.repeat) {
    commands.dash = true;
    sound("dash");
  }
  if (event.code === "KeyQ" && !event.repeat) {
    commands.pulse = true;
    sound("pulse");
  }
});
window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
  if (event.code === "Tab") $("#scoreboard").hidden = true;
});
window.addEventListener("blur", () => {
  keys.clear();
  commands.dash = commands.pulse = false;
  if (
    view === "playing" &&
    gameMode === "solo" &&
    !paused &&
    !$("#upgrade-modal").open &&
    !resultShown
  )
    pauseGame();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    keys.clear();
    if (
      view === "playing" &&
      gameMode === "solo" &&
      !paused &&
      !$("#upgrade-modal").open &&
      !resultShown
    )
      pauseGame();
  }
});
window.addEventListener("beforeunload", () => {
  socket?.close();
});

renderSpecies();
setMode("arena");
$("#play-button").disabled = false;
$("#join-button").disabled = false;
bestRecord();
drawHero($("#hero-art"), 0, settings.reduced);
heartbeatPresence().then(refreshDirectory);
refreshDirectory();
setInterval(() => {
  if (view === "home") refreshDirectory();
}, v2.catalog.client.presenceIntervalSeconds*1000);
setInterval(() => {
  if (modalKind === "join" && $("#modal").open) refreshDirectory();
}, v2.catalog.client.directoryIntervalSeconds*1000);
setInterval(heartbeatPresence, 10000);
requestAnimationFrame(frame);
try {
  const previous = JSON.parse(sessionStorage.getItem("serpent.session"));
  if (previous?.token) {
    token = previous.token;
    connection({ type: "resume", token }, true).catch(() => {
      token = null;
      storeSession();
    });
  }
} catch {}

const reportButton=document.createElement('button');reportButton.className='v2-report-button secondary-button';reportButton.textContent=uiText("text_4313a744536a68");document.querySelector('#game').append(reportButton);reportButton.addEventListener('click',()=>{if(!accounts.profile){toast(uiText("text_04facd8bb85622"));return;}const players=world?.players.filter(p=>p.id!==ownId&&!p.bot)||[];if(!players.length){toast(uiText("text_f11d7394704149"));return;}accounts.security.report(players,send);});
