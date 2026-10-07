import http from "node:http";
import { scrypt, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { createStore, digest, saveResult } from "./store.js";
import { CONTENT_VERSION } from "../game/version.js";
import { createAuthorization, hasWhitelist, hasPermission } from "./permissions.js";
import { createAdminApi } from "./admin.js";
import { loadCatalog } from './configuration.js';
import {authenticatedPeer,matchingBans,publicRestriction} from './request-security.js';
import {createSecurityService,UUID} from './security-service.js';
import {observeResponse,operationalLog} from './observability.js';
import {createReadiness} from './readiness.js';

const derive = promisify(scrypt);
const sessionCookie = "serpent_account";
const fail = (status, message) => Object.assign(new Error(message), { status });
async function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${(await derive(password, salt, 64)).toString("hex")}`;
}
async function readBody(request) {
  if (request.parsedBody !== undefined) {
    if (
      !request.parsedBody ||
      Array.isArray(request.parsedBody) ||
      typeof request.parsedBody !== "object"
    )
      throw fail(400, "JSON không hợp lệ.");
    return request.parsedBody;
  }
  if (!(request.headers["content-type"] || "").startsWith("application/json"))
    throw fail(415, "Yêu cầu JSON.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) throw fail(413, "Dữ liệu quá lớn.");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || Array.isArray(body) || typeof body !== "object") throw 0;
    return body;
  } catch {
    throw fail(400, "JSON không hợp lệ.");
  }
}
function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

export async function createBackend({
  port = 3001,
  host = "127.0.0.1",
  databaseUrl = process.env.DATABASE_URL,
  redisUrl = process.env.REDIS_URL,
  secret = process.env.GAME_SERVER_SECRET,
  namespace = "serpent",
  schema = "public",
  secureCookies = false,
  environment = process.env.APP_ENV || "LOCAL",
  resultProcessor = null,
  migrate = true,
  logger = operationalLog,
} = {}) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("GAME_SERVER_SECRET must have at least 32 characters");
  const store = await createStore({ databaseUrl, redisUrl, namespace, schema, migrate });
  const authz = createAuthorization(store, { environment });
  const security=createSecurityService(store,authz);
  if(!(await store.query('SELECT 1 FROM environments WHERE code=$1',[environment])).rowCount){await store.close();throw new Error('APP_ENV is not registered in the database');}
  const adminApi = createAdminApi({ store, authz, secret, readBody, send });
  const cookie = (value, age) =>
    `${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies ? "; Secure" : ""}`;
  async function account(request) {
    if(Object.hasOwn(request,'accountId'))return request.accountId;
    const token = (request.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(sessionCookie + "="))
      ?.slice(sessionCookie.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session=(await store.query("SELECT s.player_id,s.restricted FROM auth_sessions s JOIN users u ON u.id=s.player_id WHERE token_hash=$1 AND expires_at>now() AND u.status='active'",[digest(token)])).rows[0];
    request.restrictedSession=Boolean(session?.restricted);return request.accountId=session?.player_id||null;
  }
  async function newSession(id,restricted=false) {
    const policy=await authz.policy();
    const token = randomBytes(32).toString("hex");
    await store.query("DELETE FROM auth_sessions WHERE expires_at<now()");
    await store.query(
      "INSERT INTO auth_sessions(token_hash,player_id,expires_at,restricted) VALUES ($1,$2,now()+make_interval(secs=>$3),$4)",
      [digest(token), id,restricted?policy.security.restrictedSessionMinutes*60:policy.security.sessionDays*86400,restricted],
    );
    await store.query("UPDATE users SET last_login_at=now() WHERE id=$1", [id]);
    return cookie(token, restricted?policy.security.restrictedSessionMinutes*60:policy.security.sessionDays*86400);
  }
  const readiness = createReadiness(async()=>{await store.query('SELECT 1');await store.redis.ping();return true;});
  const server = http.createServer(async (request, response) => {
    const requestId=observeResponse(request,response,logger);
    try {
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname;
      if(['/livez','/readyz'].includes(path)&&['GET','HEAD'].includes(request.method)){
        const state=path==='/livez'?{version:1,ok:true}:await readiness();
        response.writeHead(state.ok?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(request.method==='HEAD'?undefined:JSON.stringify(state));return;
      }
      request.securityIp=authenticatedPeer(request,secret);
      if(path==='/api/configuration'&&request.method==='GET'){send(response,200,await security.publicConfiguration(),{'Cache-Control':'public, max-age=30'});return;}
      if(path==='/api/site'&&request.method==='GET'){
        const row=(await store.query("SELECT value,updated_at FROM system_settings WHERE key='site'")).rows[0];
        if(!row)throw fail(503,'Nội dung website chưa sẵn sàng.');
        send(response,200,{version:1,site:row.value,updatedAt:row.updated_at},{'Cache-Control':'public, max-age=60'});return;
      }
      const internal = path.startsWith("/internal/");
      const policy=await authz.policy();
      if (internal) {
        const supplied = request.headers["x-game-secret"];
        if (
          typeof supplied !== "string" ||
          !timingSafeEqual(
            Buffer.from(digest(supplied)),
            Buffer.from(digest(secret)),
          )
        )
          throw fail(403, "Server authentication required.");
      } else if (!["GET", "HEAD"].includes(request.method)) {
        if (request.headers.origin) {
          let origin;
          try {
            origin = new URL(request.headers.origin);
          } catch {
            throw fail(403, "Origin không hợp lệ.");
          }
          if (origin.host !== request.headers.host)
            throw fail(403, "Origin không hợp lệ.");
        }
        if(request.headers['sec-fetch-site']==='cross-site')throw fail(403,'Origin không hợp lệ.');
        const actor=await account(request),rate=actor?policy.security.authenticatedRequestRate:policy.security.requestRate;
        const rateKey = store.key(`rate:${actor?'user:'+actor:'ip:'+request.securityIp}:${Math.floor(Date.now() / 60000)}`);
        const count = await store.redis.incr(rateKey);
        if (count === 1) await store.redis.expire(rateKey, 65);
        if (count > rate) throw fail(429, "Thử lại sau một phút.");
      }
      if(!internal&&(path.startsWith('/api/account/')||path.startsWith('/admin/'))){
        const id=await account(request);
        if(id&&!['/api/account/catalog','/api/account/content','/api/account/login','/api/account/logout','/api/account/me','/api/account/security','/api/account/appeals'].includes(path)&&!/^\/api\/account\/notifications\/[a-f0-9-]{36}\/read$/.test(path)){
          const context=await authz.resolve(id,{fresh:true}),ban=matchingBans(context,policy,{accountOnly:true})[0];
          if(ban||request.restrictedSession)throw Object.assign(fail(403,ban?policy.moderation.defaultPublicReason:'Hãy đăng nhập lại để tiếp tục.'),{publicCode:ban?'ACCOUNT_BANNED':'REAUTHENTICATE',restriction:ban?publicRestriction(ban,policy):undefined});
        }
      }
      if(path==='/internal/configuration'&&request.method==='GET'){const operations=(await store.query("SELECT value FROM system_settings WHERE key='operations'")).rows[0]?.value;send(response,200,{version:1,policy,operations});return;}
      if(path==='/internal/security/events'&&request.method==='POST'){send(response,200,await security.recordEvent(await readBody(request)));return;}
      if(path==='/internal/reports'&&request.method==='POST'){const body=await readBody(request);await authz.admission(body.reporterId,body.mode);send(response,200,await security.report(body.reporterId,body,body.room));return;}
      if(path==='/api/account/security'&&request.method==='GET'){const id=await account(request);if(!id)throw fail(401,'Hãy đăng nhập trước.');send(response,200,await security.status(id));return;}
      if(path==='/api/account/appeals'&&request.method==='POST'){const id=await account(request);if(!id)throw fail(401,'Hãy đăng nhập trước.');send(response,200,await security.appeal(id,await readBody(request)));return;}
      if(/^\/api\/account\/notifications\/[a-f0-9-]{36}\/read$/.test(path)&&request.method==='POST'){const id=await account(request),notification=path.split('/')[4];if(!id)throw fail(401,'Hãy đăng nhập trước.');if(!UUID.test(notification))throw fail(400,'ID không hợp lệ.');const changed=await store.query('UPDATE player_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND player_id=$2 RETURNING id',[notification,id]);if(!changed.rowCount)throw fail(404,'Không tìm thấy thông báo.');send(response,200,{ok:true});return;}
      if (path === "/health" && request.method === "GET") {
        await store.query("SELECT 1");
        await store.redis.ping();
        send(response, 200, {
          ok: true,
          database: "postgresql",
          cache: "redis",
          contentVersion: (await loadCatalog(store)).id,
        });
        return;
      }
      if (path.startsWith("/admin/")) {
        const id = await account(request);
        if (!id) throw fail(401, "Hãy đăng nhập trước.");
        await adminApi(request, response, id, path, url);
        return;
      }
      if (path === "/internal/admission" && request.method === "POST") {
        const { accountId, mode, serverId } = await readBody(request);
        if (!(await loadCatalog(store)).modes.some(m=>m.id===mode))
          throw fail(400, "Chế độ không hợp lệ.");
        if (accountId && !(await store.profile(accountId)))
          throw fail(403, "Tài khoản không khả dụng.");
        send(response, 200, await authz.admission(accountId, mode, serverId));
        return;
      }
      if (path === "/internal/revalidate" && request.method === "POST") {
        const { players } = await readBody(request);
        if (!Array.isArray(players) || players.length > 100)
          throw fail(400, "Danh sách không hợp lệ.");
        const rows = [];
        for (const p of players) {
          try {
            await authz.admission(p.accountId, p.mode);
            rows.push({
              accountId: p.accountId,
              allowed: !p.accountId||Boolean(await store.profile(p.accountId)),
            });
          } catch(error) {
            rows.push({ accountId: p.accountId, allowed: false,code:error.publicCode||'ACCESS_REVOKED',restriction:error.restriction });
          }
        }
        send(response, 200, { rows });
        return;
      }
      if (path === "/api/account/content" && request.method === "GET") {
        const c=await loadCatalog(store);send(response,200,{version:{id:c.id,game:c.game,balance:c.balance,upgrades:c.upgrades}});
        return;
      }
      if ((path === '/api/account/catalog'||path==='/internal/catalog')&&request.method==='GET') {
        send(response,200,{catalog:await loadCatalog(store,url.searchParams.get('version')||undefined)});
        return;
      }
      if(path==='/api/account/reports'&&request.method==='POST'){
        const id=await account(request);if(!id)throw fail(401,'Hãy đăng nhập trước.');
        send(response,200,await security.report(id,await readBody(request)));return;
      }
      if (path === "/api/account/register" && request.method === "POST") {
        const body = await readBody(request);
        const username = String(body.username || "")
          .toLowerCase()
          .trim();
        const display = String(body.displayName || username).trim();
        if (
          !/^[a-z0-9_]+$/.test(username) || username.length<policy.security.usernameMin || username.length>policy.security.usernameMax ||
          typeof body.password !== "string" ||
          body.password.length < policy.security.passwordMin ||
          body.password.length > policy.security.passwordMax ||
          !display ||
          display.length > policy.security.displayNameMax
        )
          throw fail(
            400,
            `Tên tài khoản ${policy.security.usernameMin}–${policy.security.usernameMax} ký tự a-z, số hoặc _. Mật khẩu ${policy.security.passwordMin}–${policy.security.passwordMax} ký tự.`,
          );
        const hash = await passwordHash(body.password);
        const id = randomUUID();
        await store.transaction(async (db) => {
          await db.query(
            "INSERT INTO users(id,username,password_hash) VALUES ($1,$2,$3)",
            [id, username, hash],
          );
          await db.query(
            "INSERT INTO user_roles(user_id,role_code) VALUES ($1,$2)",
            [id,policy.registration.role],
          );
          await db.query(
            "INSERT INTO player_profiles(player_id,display_name) VALUES ($1,$2)",
            [id, display],
          );
          await db.query("INSERT INTO player_wallets(player_id) VALUES ($1)", [
            id,
          ]);
          await db.query(
            "INSERT INTO player_snakes(player_id,snake_id) VALUES ($1,$2)",
            [id,policy.registration.species],
          );
        });
        send(
          response,
          201,
          { profile: await store.profile(id) },
          { "Set-Cookie": await newSession(id) },
        );
        return;
      }
      if (path === "/api/account/login" && request.method === "POST") {
        const body = await readBody(request);
        if (typeof body.password !== "string" || body.password.length > policy.security.passwordMax || typeof body.username!=='string' || body.username.length>policy.security.usernameMax)
          throw fail(400, "Thông tin đăng nhập không hợp lệ.");
        const user = (
          await store.query(
            "SELECT id,password_hash FROM users WHERE username=$1 AND status='active'",
            [
              String(body.username || "")
                .trim()
                .toLowerCase(),
            ],
          )
        ).rows[0];
        const expected =
          user?.password_hash || `${"0".repeat(32)}:${"0".repeat(128)}`;
        const actual = await passwordHash(
          body.password,
          expected.split(":")[0],
        );
        if (
          !user ||
          !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
        )
          throw fail(401, "Tên tài khoản hoặc mật khẩu không đúng.");
        const access=await authz.resolve(user.id,{fresh:true});
        const ban=matchingBans(access,policy,{accountOnly:true})[0];
        if(ban){send(response,403,{error:'Tài khoản đang bị khóa.',code:'ACCOUNT_BANNED',restriction:publicRestriction(ban,policy)},{'Set-Cookie':await newSession(user.id,true)});return;}
        send(
          response,
          200,
          { profile: await store.profile(user.id) },
          { "Set-Cookie": await newSession(user.id) },
        );
        return;
      }
      if (path === "/api/account/logout" && request.method === "POST") {
        const value = (request.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith(sessionCookie + "="))
          ?.slice(sessionCookie.length + 1);
        if (value)
          await store.query("DELETE FROM auth_sessions WHERE token_hash=$1", [
            digest(value),
          ]);
        send(response, 200, { ok: true }, { "Set-Cookie": cookie("", 0) });
        return;
      }
      if (path === "/api/account/leaderboard" && request.method === "GET") {
        const operations=(await store.query("SELECT value FROM system_settings WHERE key='operations'")).rows[0].value;
        const season = url.searchParams.get("season") || (await loadCatalog(store)).season?.id || (await store.query('SELECT id FROM seasons WHERE starts_at<=now() AND ends_at>now() ORDER BY starts_at DESC LIMIT 1')).rows[0]?.id;
        const rows = (
          await store.query(
            `SELECT p.display_name,l.best_score,l.total_score,l.lives FROM leaderboard_entries l JOIN player_profiles p ON p.player_id=l.player_id WHERE l.season_id=$1 AND l.mode=$2 AND p.ranked_eligible AND NOT EXISTS (SELECT 1 FROM moderation_actions a WHERE a.target_user_id=l.player_id AND a.scope='RANKED' AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>now())) ORDER BY l.best_score DESC,l.updated_at ASC LIMIT $3`,
            [season,operations.leaderboardMode,policy.security.leaderboardLimit],
          )
        ).rows;
        send(response, 200, { season, seasonName:(await store.query('SELECT name FROM seasons WHERE id=$1',[season])).rows[0]?.name||season, rows });
        return;
      }
      if (path === "/internal/tickets/consume" && request.method === "POST") {
        const { ticket, mode } = await readBody(request);
        if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/.test(ticket))
          throw fail(401, "Ticket không hợp lệ.");
        const value = await store.redis.getDel(
          store.key(`ticket:${digest(ticket)}`),
        );
        if (!value) throw fail(401, "Ticket đã dùng hoặc hết hạn.");
        const identity = JSON.parse(value);
        if (mode && identity.allowedMode && mode !== identity.allowedMode)
          throw fail(403, "Ticket không dành cho chế độ này.");
        await authz.admission(
          identity.accountId,
          mode || identity.allowedMode,
        );
        const profile = await store.profile(identity.accountId);
        if (!profile) throw fail(401, "Tài khoản không khả dụng.");
        send(response, 200, { ...identity, displayName: profile.display_name });
        return;
      }
      if (path === "/internal/results" && request.method === "POST") {
        const payload = await readBody(request);
        const result = resultProcessor
          ? await resultProcessor(payload)
          : await saveResult(store, payload);
        send(response, 200, result);
        return;
      }
      const id = await account(request);
      if (path === "/api/account/access" && request.method === "GET") {
        const c = await authz.resolve(id),
          s = await authz.settings();
        send(response, 200, {
          roles: c.roles,
          adminPanel: hasWhitelist(c, policy.security.panelWhitelist, { environment }),
          features: s.features,
          maintenance: s.maintenance,
          environment,
        });
        return;
      }
      if (path === "/api/account/me" && request.method === "GET") {
        const ban=id?matchingBans(await authz.resolve(id,{fresh:true}),policy,{accountOnly:true})[0]:null;
        if(ban||request.restrictedSession){send(response,200,{profile:null,restricted:true,restriction:ban?publicRestriction(ban,policy):null});return;}
        send(response, 200, { profile: id ? await store.profile(id) : null });
        return;
      }
      if (!id) throw fail(401, "Hãy đăng nhập để lưu tiến trình.");
      if (path === "/api/account/ticket" && request.method === "POST") {
        const { species, mode } = await readBody(request);
        if (
          mode &&
          !(await loadCatalog(store)).modes.some(m=>m.id===mode)
        )
          throw fail(400, "Chế độ không hợp lệ.");
        await authz.admission(id, mode);
        const profile = await store.profile(id);
        if (!profile.snakes.includes(species))
          throw fail(403, "Loài rắn này chưa được mở khóa.");
        const ticket = randomBytes(32).toString("hex");
        await store.redis.set(
          store.key(`ticket:${digest(ticket)}`),
          JSON.stringify({
            accountId: id,
            species,
            ...(mode ? { allowedMode: mode } : {}),
          }),
          { EX: policy.security.ticketSeconds },
        );
        send(response, 200, { ticket, expiresIn: policy.security.ticketSeconds });
        return;
      }
      if (path === "/api/account/history" && request.method === "GET") {
        const rows = (
          await store.query(
            `SELECT r.*,m.mode,m.content_version,b.upgrades,b.segments,b.traits,b.keystones,b.curses,b.organs,b.evolutions,b.mutations,b.hybrids FROM match_results r JOIN matches m ON m.id=r.match_id JOIN match_builds b ON b.life_id=r.life_id WHERE r.player_id=$1 ORDER BY r.created_at DESC LIMIT $2`,
            [id,policy.security.historyLimit],
          )
        ).rows;
        send(response, 200, { rows });
        return;
      }
      if (path === "/api/account/unlock" && request.method === "POST") {
        const { species } = await readBody(request);
        await store.transaction(async (db) => {
          await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
          if (
            (
              await db.query(
                "SELECT 1 FROM player_snakes WHERE player_id=$1 AND snake_id=$2",
                [id, species],
              )
            ).rowCount
          )
            return;
          const def = (
            await db.query("SELECT * FROM snake_definitions WHERE id=$1", [
              species,
            ])
          ).rows[0];
          if (!def) throw fail(400, "Loài rắn không hợp lệ.");
          if (
            !(
              await db.query(
                "UPDATE player_wallets SET gold=gold-$2 WHERE player_id=$1 AND gold >= $2 RETURNING gold",
                [id, def.unlock_gold],
              )
            ).rowCount
          )
            throw fail(409, "Chưa đủ vàng.");
          await db.query(
            "INSERT INTO player_snakes(player_id,snake_id) VALUES ($1,$2)",
            [id, species],
          );
          await db.query(
            "INSERT INTO wallet_ledger(id,player_id,event_key,gold) VALUES ($1,$2,$3,$4)",
            [randomUUID(), id, `unlock:${species}`, -def.unlock_gold],
          );
        });
        send(response, 200, { profile: await store.profile(id) });
        return;
      }
      if (path === "/api/account/meta" && request.method === "POST") {
        const { upgrade, expectedLevel } = await readBody(request);
        if (!Number.isInteger(expectedLevel) || expectedLevel < 0)
          throw fail(400, "Cấp nâng cấp không hợp lệ.");
        await store.transaction(async (db) => {
          await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
          const def = (
            await db.query(
              "SELECT * FROM meta_upgrade_definitions WHERE id=$1",
              [upgrade],
            )
          ).rows[0];
          const level =
            (
              await db.query(
                "SELECT level FROM player_meta_upgrades WHERE player_id=$1 AND upgrade_id=$2",
                [id, upgrade],
              )
            ).rows[0]?.level || 0;
          if (!def || level !== expectedLevel || level >= def.max_level)
            throw fail(409, "Cấp nâng cấp đã thay đổi hoặc đạt tối đa.");
          const cost = def.base_cost * (level + 1);
          if (
            !(
              await db.query(
                "UPDATE player_wallets SET gold=gold-$2 WHERE player_id=$1 AND gold >= $2 RETURNING gold",
                [id, cost],
              )
            ).rowCount
          )
            throw fail(409, "Chưa đủ vàng.");
          await db.query(
            "INSERT INTO player_meta_upgrades VALUES ($1,$2,$3) ON CONFLICT(player_id,upgrade_id) DO UPDATE SET level=EXCLUDED.level",
            [id, upgrade, level + 1],
          );
          await db.query(
            "INSERT INTO wallet_ledger(id,player_id,event_key,gold) VALUES ($1,$2,$3,$4)",
            [randomUUID(), id, `meta:${upgrade}:${level + 1}`, -cost],
          );
        });
        send(response, 200, { profile: await store.profile(id) });
        return;
      }
      throw fail(404, "Không tìm thấy API.");
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const status = error.status || (error.code === "23505" ? 409 : 500);
      send(response, status, {
        requestId,
        ...(status<500&&error.publicCode?{code:error.publicCode,restriction:error.restriction}:{}),
        error:
          status === 500
            ? "Dịch vụ đang bận. Hãy thử lại."
            : error.code === "23505"
              ? "Tên tài khoản đã tồn tại."
              : error.message,
      });
      if (status >= 500) logger.error('http.handler_failed',{requestId,code:error.code||error.name});
    }
  });
  server.requestTimeout = 15000;
  return {
    server,
    store,
    authz,
    handle: server.listeners("request")[0],
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const app = await createBackend({
    port: Number(process.env.BACKEND_PORT || 3001),
    secureCookies: process.env.COOKIE_SECURE === "true",
  });
  const address = await app.listen();
  console.log(`Account backend: http://127.0.0.1:${address.port}`);
  process.send?.({ type: "ready" });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => app.close().then(() => process.exit(0)));
  process.on("message", (message) => {
    if (message?.type === "shutdown")
      void app.close().then(() => process.exit(0));
  });
}
