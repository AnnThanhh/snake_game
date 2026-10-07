import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { WebSocket, WebSocketServer } from "ws";
import {
  createWorld,
  addPlayer,
  removePlayer,
  stepWorld,
  chooseUpgrade,
  getSnapshot,
  respawnPlayer,
} from "../game/engine.js";
import { SPECIES } from "../game/content.js";
import { createWireState, encodeFrame } from "../game/network.js";
import { createPathState,encodePathFrame } from '../game/path-network.js';
import { createBotDirector } from './bots.js';
import { createPersistence } from './persistence.js';
import {publicPeer,signedPeerHeaders,stripProxyIdentity,safeRequestTarget} from '../backend/request-security.js';
import {observeResponse,operationalLog} from '../backend/observability.js';
import {proxyHttp} from '../backend/http-proxy.js';
import {createReadiness} from '../backend/readiness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STEP = 1 / 30;
const PRESENCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/;
const PRESENCE_STATES = new Set(["menu", "lobby", "game"]);

function validPresenceId(value) {
  return typeof value === "string" && PRESENCE_ID.test(value);
}

function readPresenceBody(request) {
  if (Number(request.headers["content-length"]) > 1024) {
    request.resume();
    return Promise.resolve({ status: 413 });
  }
  return new Promise((resolve) => {
    let chunks = [], bytes = 0, done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      chunks = [];
      resolve(result);
    };
    request.on("data", (chunk) => {
      if (done) return;
      bytes += chunk.length;
      if (bytes > 1024) finish({ status: 413 });
      else chunks.push(chunk);
    });
    request.on("end", () => {
      if (done) return;
      try { finish({ body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
      catch { finish({ status: 400 }); }
    });
    request.on("aborted", () => finish({ status: 400 }));
    request.on("error", () => finish({ status: 400 }));
  });
}

function inside(root, filename) {
  const relative = path.relative(root, filename);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function label(value, fallback, length) {
  if (typeof value !== "string") return fallback;
  return (
    value
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, length) || fallback
  );
}

function bucket(capacity, rate) {
  return { tokens: capacity, capacity, rate, at: performance.now() };
}

function consume(limit) {
  const now = performance.now();
  limit.tokens = Math.min(
    limit.capacity,
    limit.tokens + ((now - limit.at) * limit.rate) / 1000,
  );
  limit.at = now;
  if (limit.tokens < 1) return false;
  limit.tokens -= 1;
  return true;
}

/** Single-process prototype; capacities above four are experimental. */
export function createGameServer({
  port = 3000,
  host = "127.0.0.1",
  reconnectMs = 60_000,
  idleRoomMs = 15 * 60_000,
  finishedRoomMs = 120_000,
  heartbeatMs = 20_000,
  maintenanceIntervalMs = 1_000,
  maxRooms = 10,
  maxPlayers = 4,
  arenaCapacity = 10,
  backendUrl = process.env.BACKEND_URL,
  backendSecret = process.env.GAME_SERVER_SECRET,
  realtimeUrl = process.env.REALTIME_URL,
  outboxDir = path.join(ROOT,'.data','outbox'),
  presenceTtlMs = 30_000,
  maxPresence = 1000,
  configuration = null,
  worldOptions = {},
  logger = operationalLog,
  proxyTimeoutMs = 10000,
} = {}) {
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 10) {
    throw new RangeError("maxPlayers must be an integer between 1 and 10");
  }
  if(!Number.isInteger(arenaCapacity)||arenaCapacity<1||arenaCapacity>10)throw new RangeError('arenaCapacity must be 1–10 until the next capacity validation');
  const persistence=backendUrl&&backendSecret?createPersistence({backendUrl,secret:backendSecret,outboxDir}):null;
  const rooms = new Map();
  const sessions = new Map();
  const sockets = new Set();
  const presence = new Map();
  let presenceCapacity = configuration?.operations.presenceMaxEntries ?? maxPresence;
  presenceTtlMs=configuration?configuration.operations.presenceTtlSeconds*1000:presenceTtlMs;
  const presenceLimit = bucket(configuration?.operations.presenceBurst??200, configuration?.operations.presenceRequestsPerSecond??150);
  let refreshingConfiguration=false;
  const configTimer=configuration?setInterval(async()=>{
    if(refreshingConfiguration)return;refreshingConfiguration=true;
    try{const response=await fetch(new URL('/internal/configuration',backendUrl),{headers:{'x-game-secret':backendSecret},signal:AbortSignal.timeout(5000)});if(!response.ok)return;configuration=await response.json();presenceCapacity=configuration.operations.presenceMaxEntries;presenceTtlMs=configuration.operations.presenceTtlSeconds*1000;presenceLimit.capacity=configuration.operations.presenceBurst;presenceLimit.rate=configuration.operations.presenceRequestsPerSecond;}catch{}finally{refreshingConfiguration=false;}
  },30000):null;configTimer?.unref();
  const startedAt = Date.now();
  let telemetry = { tickRate: 0, tickMs: 0, overloadCount: 0, state: "HEALTHY" };
  let closing = false;
  const ready = createReadiness(async () => {
    if (closing || !backendUrl || !realtimeUrl) return false;
    const responses = await Promise.all([backendUrl, realtimeUrl].map(base => fetch(new URL('/readyz', base), { signal: AbortSignal.timeout(1800) })));
    const states = await Promise.all(responses.map(async r => r.ok && (await r.json()).ok === true));
    return states.every(Boolean);
  });
  const proxySockets = new Set();

  function prunePresence(now = Date.now()) {
    for (const [id, entry] of presence) {
      if (now - entry.lastSeen >= presenceTtlMs) presence.delete(id);
    }
  }

  // Anonymous browser IDs are informational only. Co-op counts use server state.
  function population() {
    prunePresence();
    const online = new Set([...presence.keys()].map((id) => `presence:${id}`));
    let inGame = 0, waiting = 0, reserved = 0;
    for (const member of sessions.values()) {
      if (!member.ws) { reserved += 1; continue; }
      online.add(member.presenceId ? `presence:${member.presenceId}` : `member:${member.id}`);
      if (member.room.state === "playing") inGame += 1;
      else if (member.room.state === "lobby") waiting += 1;
    }
    return { online: online.size, inGame, waiting, reserved };
  }

  function directoryRoom(room) {
    const connectedPlayers = [...room.members.values()].filter((member) => member.ws).length;
    return {
      ...roomInfo(room),
      players: room.members.size,
      connectedPlayers,
      reservedSlots: room.members.size - connectedPlayers,
      joinable: (room.state === "lobby" || room.world.mode==='arena') && room.members.size < room.maxPlayers,
      bots: room.world.players.filter(p=>p.bot).length,
      map: "The Overgrowth",
      elapsed: room.world.time,
      health: telemetry.state,
    };
  }

  function send(ws, value) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 512 * 1024) {
      ws.terminate();
      return;
    }
    ws.send(JSON.stringify(value));
  }

  function error(ws, message) {
    send(ws, { type: "error", message });
  }
  function roomInfo(room) {
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      maxPlayers: room.maxPlayers,
      state: room.state,
      mode: room.world.mode,
    };
  }
  function broadcast(room, value) {
    for (const member of room.members.values()) send(member.ws, value);
  }
  function snapshot(room) {
    const state = getSnapshot(room.world,{includePaths:[...room.members.values()].some(m=>m.ws?.wireProtocol===3)});
    for (const member of room.members.values()) {
      if (member.ws) sendWorld(member.ws, "snapshot", state);
    }
  }
  function sendWorld(ws, type, state, extra = {}, forceFull = false) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const message = { type, ...extra, telemetry: { ...(ws.member.room.world.mode==='arena'?ws.member.room.telemetry:telemetry) }, ack: ws.appliedSeq };
    if (ws.wireProtocol >= 2) {
      const now = performance.now();
      const full = forceFull || now - ws.lastFullAt >= 5000;
      message.frame = (ws.wireProtocol===3?encodePathFrame:encodeFrame)(state, ws.wireState, {
        playerId: ws.member.id,
        viewRadius: ws.viewRadius,
        forceFull: full,
      });
      if (full) ws.lastFullAt = now;
    } else message.snapshot = {...state,players:state.players.map(({bodyPath,...p})=>p)};
    send(ws, message);
  }
  function lobby(room) {
    broadcast(room, {
      type: "lobby",
      room: roomInfo(room),
      players: [...room.members.values()].map((member) => ({
        id: member.id,
        name: member.name,
        species: member.species,
        ready: member.ready,
        connected: Boolean(member.ws),
      })),
    });
  }

  const server = http.createServer(async (request, response) => {
    observeResponse(request,response,logger);
    if(!safeRequestTarget(request.url)){response.writeHead(400).end();return;}
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "same-origin");
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      response.writeHead(400).end();
      return;
    }
    if ((pathname === '/api/live' || pathname === '/api/ready') && ['GET','HEAD'].includes(request.method)) {
      const state = pathname === '/api/live' ? {version:1,ok:!closing} : closing ? {version:1,ok:false} : await ready();
      response.writeHead(state.ok ? 200 : 503, {'Content-Type':'application/json','Cache-Control':'no-store'}).end(request.method === 'HEAD' ? undefined : JSON.stringify(state));
      return;
    }
    if(pathname==='/api/site'||pathname==='/api/configuration'||pathname.startsWith('/api/account/')||pathname.startsWith('/admin/')) {
      if(!backendUrl){response.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Backend tài khoản chưa được khởi động.'}));return;}
      const headers=stripProxyIdentity({...request.headers});delete headers.connection;
      if(configuration)Object.assign(headers,signedPeerHeaders(backendSecret,publicPeer(request,configuration.policy),request.method,request.url));
      proxyHttp(request,response,new URL(pathname+new URL(request.url,'http://localhost').search,backendUrl),headers,{timeoutMs:proxyTimeoutMs});return;
    }
    if(pathname==='/api/v2'){response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({enabled:Boolean(realtimeUrl)}));return;}
    if(pathname.startsWith('/rt/')&&realtimeUrl){
      const target=new URL(pathname.slice(3)+new URL(request.url,'http://localhost').search,realtimeUrl);
      if(target.origin!==new URL(realtimeUrl).origin||!safeRequestTarget(pathname.slice(3))){response.writeHead(400).end();return;}
      if(target.pathname.startsWith('/internal/')||['/metrics','/livez','/readyz'].includes(target.pathname)){response.writeHead(404).end();return;}
      const headers=stripProxyIdentity({...request.headers});delete headers.connection;
      proxyHttp(request,response,target,headers,{timeoutMs:proxyTimeoutMs});return;
    }
    if (pathname === "/api/presence") {
      if (request.method !== "POST") {
        response.writeHead(405, { Allow: "POST" }).end();
        return;
      }
      if (request.headers.origin) {
        let sameOrigin = false;
        try {
          sameOrigin = new URL(request.headers.origin).origin === new URL(`http://${request.headers.host}`).origin;
        } catch {}
        if (!sameOrigin) { request.resume(); response.writeHead(403).end(); return; }
      }
      if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
        request.resume(); response.writeHead(415).end(); return;
      }
      if (!consume(presenceLimit)) { request.resume(); response.writeHead(429).end(); return; }
      const parsed = await readPresenceBody(request);
      if (response.destroyed) return;
      if (parsed.status) { response.writeHead(parsed.status).end(); return; }
      const data = parsed.body;
      if (!data || typeof data !== "object" || Array.isArray(data) || !validPresenceId(data.clientId) || !PRESENCE_STATES.has(data.state) || Object.keys(data).some((key) => key !== "clientId" && key !== "state")) {
        response.writeHead(400).end();
        return;
      }
      if(realtimeUrl){try{const upstream=await fetch(new URL('/internal/presence?id='+encodeURIComponent(data.clientId),realtimeUrl),{method:'POST',headers:{'x-game-secret':process.env.GAME_SERVER_SECRET},signal:AbortSignal.timeout(3000)});response.writeHead(upstream.status,{'Content-Type':'application/json'}).end(JSON.stringify({ok:upstream.ok,ttlMs:presenceTtlMs}));}catch{response.writeHead(503).end();}return;}
      prunePresence();
      if (!presence.has(data.clientId) && presence.size >= presenceCapacity) {
        response.writeHead(503).end();
        return;
      }
      presence.set(data.clientId, { state: data.state, lastSeen: Date.now() });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, ttlMs: presenceTtlMs }));
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let body;
    if(pathname==='/api/health'&&realtimeUrl){try{const upstream=await fetch(new URL('/health',realtimeUrl),{signal:AbortSignal.timeout(3000)});body=await upstream.json();if(!upstream.ok){response.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify(body));return;}}catch{response.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false}));return;}}
    else if (pathname === "/api/health") {
      body = {
        ok: true,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        rooms: rooms.size,
        ...population(),
        ...telemetry,
        targetTickRate: 30,
        snapshotRate: 15,
        roomCapacity: maxPlayers,
        arenaCapacity,
        prototype: true,
      };
    } else if (pathname === "/api/rooms" && realtimeUrl) {
      try{
        const upstream=await fetch(new URL('/rooms',realtimeUrl),{signal:AbortSignal.timeout(4000)});if(!upstream.ok)throw new Error();
        const data=await upstream.json();const active=data.rooms.map(r=>({...r,players:r.clients,joinable:!r.locked&&r.clients<r.maxPlayers,map:'The Overgrowth'}));
        body={rooms:active,online:Math.max(data.online||0,active.reduce((n,r)=>n+r.players,0)),inGame:active.filter(r=>r.state==='playing').reduce((n,r)=>n+r.players,0)};
      }catch{response.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Danh sách phòng chưa sẵn sàng.'}));return;}
    } else if (pathname === "/api/rooms") {
      body = {
        rooms: [...rooms.values()].map(directoryRoom),
        roomCapacity: maxPlayers,
        arenaCapacity,
        ...population(),
      };
    }
    if (body) {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(
        request.method === "HEAD" ? undefined : JSON.stringify(body),
      );
      return;
    }
    response.writeHead(404, {"Content-Type":"application/json"}).end(JSON.stringify({error:"Route not found"}));
  });

  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2048,
    perMessageDeflate: false,
  });
  server.on("upgrade", (request, socket, head) => {
    if(closing){socket.destroy();return;}
    proxySockets.add(socket);socket.once('close',()=>proxySockets.delete(socket));
    if(!safeRequestTarget(request.url)){socket.destroy();return;}
    if(realtimeUrl&&request.url?.startsWith('/rt/')){
      try{if(request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host)throw new Error();}catch{socket.destroy();return;}
      const target=new URL(request.url.slice(3),realtimeUrl),headers=stripProxyIdentity({...request.headers});
      if(target.origin!==new URL(realtimeUrl).origin||!safeRequestTarget(request.url.slice(3))){socket.destroy();return;}
      const upstream=http.request(target,{headers,timeout:10000});upstream.on('upgrade',(response,peer,upstreamHead)=>{socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);if(upstreamHead.length)socket.write(upstreamHead);if(head.length)peer.write(head);peer.pipe(socket);socket.pipe(peer);peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());socket.on('close',()=>peer.destroy());});upstream.on('error',()=>socket.destroy());upstream.on('response',()=>socket.destroy());upstream.on('timeout',()=>upstream.destroy());upstream.end();return;
    }
    if(realtimeUrl){socket.end('HTTP/1.1 404 Not Found\r\n\r\n');return;}
    let valid = false;
    try {
      const url = new URL(request.url, "http://localhost");
      valid = url.pathname === "/ws" && !closing && !realtimeUrl;
      if (request.headers.origin)
        valid &&= new URL(request.headers.origin).host === request.headers.host;
    } catch {
      valid = false;
    }
    if (!valid || sockets.size >= Math.max(100, maxRooms * maxPlayers * 3)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) =>
      wss.emit("connection", ws, request),
    );
  });

  function newRoom(name,mode='coop') {
    let code;
    do {
      code = randomBytes(3).toString("hex").toUpperCase();
    } while ([...rooms.values()].some((room) => room.code === code));
    const room = {
      id: randomUUID(),
      code,
      name: label(name, "Khu rừng mới", 36),
      state: mode==='arena'?'playing':'lobby',
      maxPlayers: mode==='arena'?arenaCapacity:maxPlayers,
      members: new Map(),
      inputs: {},
      world: createWorld({
        seed: randomInt(1, 2 ** 30),
        ...worldOptions,
        mode,
        maxPlayers: mode==='arena'?arenaCapacity:maxPlayers,
      }),
      lastActivity: Date.now(),
      finishedAt: null,
      arenaAccumulator:0,
      arenaTicks:0,
      sampleTicks:0,
      sampleMs:0,
      sampleStarted:performance.now(),
      telemetry:{tickRate:0,tickMs:0,state:'HEALTHY',overloadCount:0},
    };
    rooms.set(room.id, room);
    if(mode==='arena') {room.director=createBotDirector(room.world,room.maxPlayers);room.director.update(room.inputs,0);}
    return room;
  }

  function attach(ws, member, data) {
    const previous = member.ws;
    member.ws = ws;
    member.disconnectedAt = null;
    ws.member = member;
    ws.wireProtocol = data.protocol === 3 ? 3 : data.protocol === 2 ? 2 : 1;
    ws.wireState = ws.wireProtocol===3?createPathState():ws.wireProtocol === 2 ? createWireState() : null;
    ws.viewRadius = data.viewRadius === undefined ? 1000 : Math.max(450, Math.min(1800, data.viewRadius));
    ws.lastFullAt = -Infinity;
    ws.lastInputSeq = null;
    ws.pendingSeq = null;
    ws.appliedSeq = null;
    ws.resyncLimit = bucket(1, 1);
    if (previous && previous !== ws) {
      previous.member = null;
      previous.close(4001, "Session resumed elsewhere");
    }
    sendWorld(ws, "welcome", getSnapshot(member.room.world,{includePaths:ws.wireProtocol===3}), {
      playerId: member.id,
      token: member.token,
      room: roomInfo(member.room),
      protocol: ws.wireProtocol,
    }, true);
    lobby(member.room);
    if (member.room.state === "playing") send(ws, { type: "started" });
  }

  function join(ws, room, data) {
    if (room.state !== "lobby"&&room.world.mode!=='arena') {
      error(ws, "Trận đã bắt đầu. Hãy chọn phòng khác.");
      return;
    }
    if (room.members.size >= room.maxPlayers) {
      error(ws, `Phòng đã đủ ${room.maxPlayers} người (kể cả chỗ đang chờ kết nối lại).`);
      return;
    }
    const species = data.species ?? "cobra";
    if (!SPECIES.some((item) => item.id === species)) {
      error(ws, "Loài rắn không hợp lệ.");
      return;
    }
    const member = {
      id: randomUUID(),
      token: randomBytes(32).toString("hex"),
      name: label(data.playerName, "Lữ khách", 20),
      species,
      ready: false,
      ws: null,
      room,
      disconnectedAt: null,
      presenceId: data.presenceId ?? null,
      accountId: data.accountId || null,
    };
    if(room.world.mode==='arena'&&room.world.players.length>=room.maxPlayers)room.director.retireOne(room.world.players.filter(p=>!p.bot));
    const player=addPlayer(room.world, { id: member.id, name: member.name, species });
    if (!player) {
      error(ws, "Không thể thêm người chơi vào phòng.");
      return;
    }
    if(persistence)persistence.newLife(player);else {player.lifeId=randomUUID();player._lifeStartedAt=new Date().toISOString();}
    room.members.set(member.id, member);
    sessions.set(member.token, member);
    room.lastActivity = Date.now();
    attach(ws, member, data);
  }

  function drop(member, reevaluateReady = true) {
    const { room } = member;
    const player=room.world.players.find(p=>p.id===member.id);
    if(player&&persistence)void persistence.finish(room,member,player,player.alive?'leave':'death');
    room.members.delete(member.id);
    sessions.delete(member.token);
    delete room.inputs[member.id];
    removePlayer(room.world, member.id);
    if (member.ws) member.ws.member = null;
    member.ws = null;
    if (room.members.size === 0&&room.world.mode!=='arena') rooms.delete(room.id);
    else {
      lobby(room);
      if (reevaluateReady) startIfReady(room);
    }
  }

  function closeRoom(room, reason) {
    for (const member of [...room.members.values()]) {
      const ws = member.ws;
      error(ws, reason);
      drop(member, false);
      ws?.close(1000, "Room closed");
    }
    rooms.delete(room.id);
  }

  function startIfReady(room) {
    if (closing || room.state !== "lobby") return;
    const connected = [...room.members.values()].filter((member) => member.ws);
    if (connected.length && connected.every((member) => member.ready)) {
      room.state = "playing";
      room.lastActivity = Date.now();
      broadcast(room, { type: "started" });
      lobby(room);
      snapshot(room);
    }
  }

  async function message(ws, raw, binary) {
    if (!consume(ws.messageLimit)) {
      ws.close(1008, "Rate limit");
      return;
    }
    if (binary) {
      error(ws, "Chỉ chấp nhận thông điệp JSON.");
      return;
    }
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      error(ws, "JSON không hợp lệ.");
      return;
    }
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data.type !== "string"
    ) {
      error(ws, "Thông điệp không hợp lệ.");
      return;
    }
    if (!consume(data.type === "input" ? ws.inputLimit : ws.controlLimit)) {
      ws.violations += 1;
      if (ws.violations > 10) ws.close(1008, "Rate limit");
      else error(ws, "Gửi thao tác quá nhanh.");
      return;
    }
    if (data.type === "ping") {
      if (typeof data.at === "number" && Number.isFinite(data.at))
        send(ws, { type: "pong", at: data.at });
      return;
    }
    if (["create", "join", "quick", "resume","arena"].includes(data.type)) {
      if (ws.member) {
        error(ws, "Bạn đã ở trong phòng.");
        return;
      }
      if(ws.joining){error(ws,'Đang xác thực phiên.');return;}
      data.accountId=null;
      if(data.ticket!==undefined&&data.type!=='resume') {
        if(!persistence){error(ws,'Backend chưa sẵn sàng.');return;}
        ws.joining=true;
        try {
          const identity=await persistence.consume(data.ticket);
          data.accountId=identity.accountId;data.playerName=identity.displayName;data.species=identity.species;
          if([...sessions.values()].some(m=>m.accountId===identity.accountId)){error(ws,'Tài khoản đã có phiên chơi. Hãy tiếp tục tab cũ hoặc rời phiên đó trước.');return;}
        }catch(e){error(ws,e.message);return;}finally{ws.joining=false;}
        if(ws.readyState!==WebSocket.OPEN)return;
      }
      if (data.presenceId !== undefined && !validPresenceId(data.presenceId)) {
        error(ws, "Mã hiện diện không hợp lệ.");
        return;
      }
      if (data.viewRadius !== undefined && (typeof data.viewRadius !== "number" || !Number.isFinite(data.viewRadius))) {
        error(ws, "Phạm vi quan sát không hợp lệ.");
        return;
      }
      if (data.type === "resume") {
        const member =
          typeof data.token === "string" && sessions.get(data.token);
        if (
          !member ||
          (member.disconnectedAt !== null &&
            Date.now() - member.disconnectedAt > reconnectMs)
        ) {
          error(ws, "Phiên đã hết hạn. Hãy tham gia phòng mới.");
          return;
        }
        if (data.presenceId !== undefined) member.presenceId = data.presenceId;
        attach(ws, member, data);
        return;
      }
      if (
        data.species !== undefined &&
        !SPECIES.some((item) => item.id === data.species)
      ) {
        error(ws, "Loài rắn không hợp lệ.");
        return;
      }
      if (data.type === "join") {
        const code =
          typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
        const room = [...rooms.values()].find((item) => item.code === code);
        if (!room) error(ws, "Không tìm thấy mã phòng.");
        else join(ws, room, data);
        return;
      }
      if(data.type==='arena') {
        let arena=[...rooms.values()].find(r=>r.world.mode==='arena'&&r.members.size<r.maxPlayers);
        if(!arena&&rooms.size<maxRooms)arena=newRoom('Open Arena · The Overgrowth','arena');
        if(!arena){error(ws,'Đấu trường đã đủ người. Hãy thử lại sau.');return;}
        join(ws,arena,data);return;
      }
      let room =
        data.type === "quick"
          ? [...rooms.values()].find(
              (item) =>
                item.state === "lobby" && item.members.size < item.maxPlayers,
            )
          : null;
      if (!room) {
        if (rooms.size >= maxRooms) {
          error(ws, "Các phòng thử nghiệm đều đang bận. Hãy thử lại sau.");
          return;
        }
        room = newRoom(data.name);
      }
      join(ws, room, data);
      return;
    }
    const member = ws.member;
    if (!member) {
      error(ws, "Hãy tham gia một phòng trước.");
      return;
    }
    const { room } = member;
    if(data.type==='respawn') {
      const old=room.world.players.find(p=>p.id===member.id);
      if(!old||old.alive||room.world.mode!=='arena'||room.world.time<old.respawnAt){error(ws,'Chưa đến thời gian hồi sinh.');return;}
      if(old&&persistence)void persistence.finish(room,member,old,'death');
      const p=respawnPlayer(room.world,member.id);
      if(!p){error(ws,'Chưa đến thời gian hồi sinh.');return;}
      if(persistence)persistence.newLife(p);else {p.lifeId=randomUUID();p._lifeStartedAt=new Date().toISOString();}
      delete room.inputs[member.id];
      ws.pendingSeq=null;
      sendWorld(ws,'snapshot',getSnapshot(room.world,{includePaths:ws.wireProtocol===3}),{},true);
      send(ws,{type:'respawned'});return;
    }
    if (data.type === "resync") {
      if (ws.wireProtocol < 2) { error(ws, "Phiên hiện tại không hỗ trợ resync."); return; }
      if (!consume(ws.resyncLimit)) { error(ws, "Vui lòng chờ trước khi đồng bộ lại."); return; }
      sendWorld(ws, "snapshot", getSnapshot(room.world,{includePaths:ws.wireProtocol===3}), {}, true);
      return;
    }
    if (data.type === "leave") {
      drop(member);
      ws.close(1000, "Left room");
      return;
    }
    if (data.type === "ready") {
      if (room.state !== "lobby" || typeof data.ready !== "boolean") {
        error(ws, "Trạng thái sẵn sàng không hợp lệ.");
        return;
      }
      member.ready = data.ready;
      room.lastActivity = Date.now();
      lobby(room);
      startIfReady(room);
      return;
    }
    if (data.type === "input") {
      if (room.state !== "playing") return;
      if (
        typeof data.angle !== "number" ||
        !Number.isFinite(data.angle) ||
        typeof data.throttle !== "number" ||
        !Number.isFinite(data.throttle) ||
        (data.dash !== undefined && typeof data.dash !== "boolean") ||
        (data.pulse !== undefined && typeof data.pulse !== "boolean") ||
        (data.seq !== undefined && (!Number.isSafeInteger(data.seq) || data.seq < 0)) ||
        (data.viewRadius !== undefined && (typeof data.viewRadius !== "number" || !Number.isFinite(data.viewRadius)))
      ) {
        error(ws, "Dữ liệu điều khiển không hợp lệ.");
        return;
      }
      if (data.seq !== undefined && ws.lastInputSeq !== null && data.seq <= ws.lastInputSeq) return;
      if (data.seq !== undefined) ws.lastInputSeq = data.seq;
      ws.pendingSeq = data.seq ?? null;
      if (data.viewRadius !== undefined) ws.viewRadius = Math.max(450, Math.min(1800, data.viewRadius));
      const prior = room.inputs[member.id];
      room.inputs[member.id] = {
        angle: Math.atan2(Math.sin(data.angle), Math.cos(data.angle)),
        throttle: Math.max(-1, Math.min(1, data.throttle)),
        dash: Boolean(data.dash || prior?.dash),
        pulse: Boolean(data.pulse || prior?.pulse),
      };
      return;
    }
    if (data.type === "upgrade") {
      const player = room.world.players.find((item) => item.id === member.id);
      if (
        room.state !== "playing" ||
        typeof data.id !== "string" ||
        !player?.choices.includes(data.id)
      ) {
        error(ws, "Nâng cấp không nằm trong lựa chọn hiện tại.");
        return;
      }
      chooseUpgrade(room.world, member.id, data.id);
      return;
    }
    error(ws, "Thao tác không được hỗ trợ.");
  }

  wss.on("connection", (ws) => {
    sockets.add(ws);
    ws.member = null;
    ws.alive = true;
    ws.connectedAt = Date.now();
    ws.messageLimit = bucket(100, 60);
    ws.inputLimit = bucket(60, 45);
    ws.controlLimit = bucket(24, 8);
    ws.violations = 0;
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("error", () => {});
    ws.on("message", (raw, binary) => {void message(ws,raw,binary).catch(()=>error(ws,'Không thể xử lý thao tác.'));});
    ws.on("close", () => {
      sockets.delete(ws);
      const member = ws.member;
      if (!member || member.ws !== ws) return;
      member.ws = null;
      member.ready = false;
      member.disconnectedAt = Date.now();
      const player = member.room.world.players.find(
        (item) => item.id === member.id,
      );
      member.room.inputs[member.id] = {
        angle: player?.angle ?? 0,
        throttle: 0,
        dash: false,
        pulse: false,
      };
      lobby(member.room);
      startIfReady(member.room);
    });
  });

  let previous = performance.now();
  let accumulator = 0;
  let tick = 0;
  let sampleStarted = previous;
  let sampleTicks = 0;
  let sampleTickMs = 0;
  let sampleOverloads = 0;
  let overloadCount = 0;
  const simulation = setInterval(() => {
    const now = performance.now();
    const debt = accumulator + (now - previous) / 1000;
    if (debt > 5 * STEP) { overloadCount += 1; sampleOverloads += 1; }
    accumulator = Math.min(5 * STEP, debt);
    previous = now;
    while (accumulator >= STEP) {
      accumulator -= STEP;
      tick += 1;
      const tickStarted = performance.now();
      for (const room of rooms.values()) {
        if (room.state !== "playing") continue;
        const arena=room.world.mode==='arena';
        if(arena) {
          room.arenaAccumulator+=STEP;
          if(room.arenaAccumulator+.000001<.05)continue;
          room.arenaAccumulator-=.05;
          room.director.update(room.inputs,room.members.size);
          room.arenaTicks++;
        }
        const roomStarted=performance.now();
        stepWorld(room.world, room.inputs, arena?.05:STEP);
        for (const member of room.members.values()) {
          const p=room.world.players.find(p=>p.id===member.id);
          if(persistence&&p&&(!p.alive||room.world.status!=='playing'))void persistence.finish(room,member,p,!p.alive?'death':room.world.status);
          if (member.ws?.pendingSeq !== null && member.ws?.pendingSeq !== undefined) {
            member.ws.appliedSeq = member.ws.pendingSeq;
            member.ws.pendingSeq = null;
          }
        }
        for (const input of Object.values(room.inputs)) {
          input.dash = false;
          input.pulse = false;
        }
        if (room.world.status !== "playing") {
          room.state = "finished";
          room.finishedAt = Date.now();
          snapshot(room);
          lobby(room);
        } else if ((arena?room.arenaTicks:tick) % 2 === 0)
          snapshot(room);
        room.sampleTicks++;
        room.sampleMs+=performance.now()-roomStarted;
      }
      sampleTicks += 1;
      sampleTickMs += performance.now() - tickStarted;
    }
    const sampleEnded = performance.now();
    const sampleDuration = sampleEnded - sampleStarted;
    if (sampleDuration >= 1000) {
      const tickRate = sampleTicks * 1000 / sampleDuration;
      const tickMs = sampleTicks ? sampleTickMs / sampleTicks : 0;
      telemetry = {
        tickRate: Number(tickRate.toFixed(2)),
        tickMs: Number(tickMs.toFixed(3)),
        overloadCount,
        state: tickRate < 27 || tickMs > 1000 / 30 || sampleOverloads > 0 ? "DEGRADED" : "HEALTHY",
      };
      for(const room of rooms.values()) {
        const elapsed=sampleEnded-room.sampleStarted;
        if(elapsed<900)continue;
        const rate=room.sampleTicks*1000/elapsed;
        const cost=room.sampleTicks?room.sampleMs/room.sampleTicks:0;
        room.telemetry={tickRate:Number(rate.toFixed(2)),tickMs:Number(cost.toFixed(3)),overloadCount,state:rate<(room.world.mode==='arena'?18:27)||sampleOverloads>0?'DEGRADED':'HEALTHY'};
        room.sampleTicks=0;room.sampleMs=0;room.sampleStarted=sampleEnded;
      }
      sampleStarted = sampleEnded;
      sampleTicks = 0;
      sampleTickMs = 0;
      sampleOverloads = 0;
    }
  }, 1000 / 30);
  simulation.unref();

  const maintenance = setInterval(() => {
    const now = Date.now();
    prunePresence(now);
    for (const ws of sockets) {
      if (!ws.member && now - ws.connectedAt >= 30_000)
        ws.close(1008, "Join timeout");
    }
    for (const member of [...sessions.values()]) {
      if (
        member.disconnectedAt !== null &&
        now - member.disconnectedAt >= reconnectMs
      )
        drop(member);
    }
    for (const room of [...rooms.values()]) {
      if (room.state === "lobby" && now - room.lastActivity >= idleRoomMs)
        closeRoom(room, "Phòng chờ đã hết thời gian hoạt động.");
      else if (room.finishedAt && now - room.finishedAt >= finishedRoomMs)
        closeRoom(room, "Trận đã kết thúc. Hãy tạo lượt chơi mới.");
    }
  }, maintenanceIntervalMs);
  maintenance.unref();

  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  return {
    server,
    wss,
    rooms,
    async listen() {
      if (server.listening) return server.address();
      await new Promise((resolve, reject) => {
        function onError(err) {
          server.off("listening", onListening);
          reject(err);
        }
        function onListening() {
          server.off("error", onError);
          resolve();
        }
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
      return server.address();
    },
    async close() {
      closing = true;
      clearInterval(simulation);
      clearInterval(maintenance);
      clearInterval(heartbeat);
      if(configTimer)clearInterval(configTimer);
      if(persistence) {
        await Promise.all([...rooms.values()].flatMap(room=>[...room.members.values()].map(member=>{
          const player=room.world.players.find(p=>p.id===member.id);
          return player?persistence.finish(room,member,player,player.alive?'leave':'death'):undefined;
        })));
        await persistence.close();
      }
      for (const ws of sockets) ws.terminate();
      for (const socket of proxySockets) socket.destroy();
      await Promise.all([
        new Promise((resolve) => wss.close(() => resolve())),
        new Promise((resolve) => server.close(() => resolve())),
      ]);
      rooms.clear();
      sessions.clear();
      presence.clear();
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  let game;
  try {
    const configuration=process.env.BACKEND_URL?await fetch(new URL('/internal/configuration',process.env.BACKEND_URL),{headers:{'x-game-secret':process.env.GAME_SERVER_SECRET},signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw new Error('Operational configuration unavailable');return r.json();}):null;
    const capacity = process.env.ROOM_CAPACITY === undefined ? 4 : Number(process.env.ROOM_CAPACITY);
    game = createGameServer({
      configuration,
      port: Number(process.env.PORT) || 3000,
      host: process.env.HOST || "127.0.0.1",
      maxPlayers: capacity,
      arenaCapacity:Number(process.env.ARENA_CAPACITY||10),
    });
    const address = await game.listen();
    process.send?.({type:'ready'});
    operationalLog.info('service.ready');
  } catch (err) {
    console.error(`Không thể khởi động server: ${err.message}`);
    await game?.close();
    process.exitCode = 1;
  }
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await game?.close();
      await operationalLog.close();
      process.exit(0);
    });
  process.on('message',message=>{if(message?.type==='shutdown')void game?.close().then(()=>operationalLog.close()).then(()=>process.exit(0));});
}
