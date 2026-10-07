import { randomUUID, createHash } from "node:crypto";
import {hasPermission,hasWhitelist} from './permissions.js';
import {validateConfiguration,loadCatalog,loadPolicy} from './configuration.js';
import { newTotpSecret, verifyTotp, mfaCrypto } from "./mfa.js";
import {matchingBans,permittedAdminIp,publicRestriction,matchesIp} from './request-security.js';
import {notifyPlayer} from './security-service.js';
const failure = (status, message) =>
  Object.assign(new Error(message), { status });
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function createAdminApi({ store, authz, secret, readBody, send }) {
  const crypto = mfaCrypto(secret);
  function sessionHash(req) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("serpent_account="))
      ?.slice(16);
    return token ? hash(token) : "";
  }
  async function requirePanel(id,policy,db=store,ip='') {
    const context=await authz.resolve(id,{fresh:true,db});
    if(!id||matchingBans(context,policy,{accountOnly:true}).length||!permittedAdminIp(context,policy,ip,authz.environment)||!hasWhitelist(context,policy.security.panelWhitelist,{environment:authz.environment})||!hasPermission(context,policy.security.panelPermission))throw failure(403,'Không có quyền vào trang quản trị.');
    return context;
  }
  async function elevated(req, id, db=store) {
    return Boolean(
      (
        await db.query(
          "SELECT 1 FROM admin_sessions WHERE session_hash=$1 AND user_id=$2 AND expires_at>now()",
          [sessionHash(req), id],
        )
      ).rowCount,
    );
  }
  async function player(db, id) {
    const row = (
      await db.query(
        "SELECT u.id,u.username,u.status,p.display_name,p.ranked_eligible,p.progression_level,w.gold,w.dna,w.evolution_points FROM users u JOIN player_profiles p ON p.player_id=u.id JOIN player_wallets w ON w.player_id=u.id WHERE u.id=$1",
        [id],
      )
    ).rows[0];
    if (!row) throw failure(404, "Không tìm thấy tài khoản.");
    row.snakes = (
      await db.query("SELECT snake_id FROM player_snakes WHERE player_id=$1", [
        id,
      ])
    ).rows.map((r) => r.snake_id);
    row.mastery = (
      await db.query(
        "SELECT snake_id,xp FROM player_snake_mastery WHERE player_id=$1",
        [id],
      )
    ).rows;
    row.meta = (
      await db.query(
        "SELECT upgrade_id,level FROM player_meta_upgrades WHERE player_id=$1",
        [id],
      )
    ).rows;
    row.inventory = (
      await db.query(
        "SELECT item_id,quantity FROM player_inventory WHERE player_id=$1",
        [id],
      )
    ).rows;
    row.roles = (
      await db.query(
        "SELECT role_code,expires_at FROM user_roles WHERE user_id=$1",
        [id],
      )
    ).rows;
    row.moderation=(await db.query('SELECT id,type,scope,scope_value,expires_at,revoked_at FROM moderation_actions WHERE target_user_id=$1',[id])).rows;
    row.overrides=(await db.query('SELECT permission_code,effect,expires_at FROM user_permission_overrides WHERE user_id=$1',[id])).rows;
    return row;
  }
  async function audit(
    db,
    {
      actor,
      context,
      action,
      target,
      before,
      after,
      reason,
      req,
      requestId,
      payloadHash,
    },
  ) {
    await db.query(
      "INSERT INTO admin_audit_logs(id,actor_user_id,actor_roles,action,target_type,target_id,before_data,after_data,reason,ip_address,user_agent,request_id,payload_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        randomUUID(),
        actor,
        JSON.stringify(context.roles),
        action,
        target ? 'player' : 'configuration',
        target,
        JSON.stringify(before),
        JSON.stringify(after),
        reason,
        req.securityIp || "",
        String(req.headers["user-agent"] || "").slice(0, 300),
        requestId,
        payloadHash,
      ],
    );
  }
  return async function admin(req, res, id, path, url) {
    let policy=await authz.policy();
    let context=await requirePanel(id,policy,store,req.securityIp);
    let ECONOMY_CAPS=policy.caps;
    const WHITELIST_TYPES=(await store.query('SELECT code FROM whitelist_types')).rows.map(r=>r.code);
    const SCOPES=(await store.query('SELECT code FROM whitelist_scopes')).rows.map(r=>r.code);
    const ENVIRONMENTS=(await store.query('SELECT code FROM environments')).rows.map(r=>r.code);
    if (path === "/admin/access" && req.method === "GET") {
      const mfa = (
        await store.query("SELECT enabled FROM admin_mfa WHERE user_id=$1", [
          id,
        ])
      ).rows[0];
      send(res, 200, {
        roles: context.roles,
        permissions: context.permissions,
        denied: context.denied,
        mfaEnrolled: mfa?.enabled || false,
        elevated: await elevated(req, id),
        environment: authz.environment,
        caps: ECONOMY_CAPS,
      });
      return;
    }
    if (path === "/admin/mfa/enroll" && req.method === "POST") {
      const setup = await store.transaction(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(7318403)');
        await requirePanel(id,await loadPolicy(db),db,req.securityIp);
        await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
        if (
          (
            await db.query("SELECT enabled FROM admin_mfa WHERE user_id=$1", [
              id,
            ])
          ).rows[0]?.enabled
        )
          throw failure(409, "MFA đã được bật.");
        const generated = newTotpSecret();
        await db.query(
          "INSERT INTO admin_mfa(user_id,encrypted_secret) VALUES ($1,$2) ON CONFLICT(user_id) DO UPDATE SET encrypted_secret=EXCLUDED.encrypted_secret,last_counter=-1",
          [id, crypto.encrypt(generated)],
        );
        return generated;
      });
      send(res, 200, {
        secret: setup,
        uri: `otpauth://totp/SerpentSurvivor:${id}?secret=${setup}&issuer=SerpentSurvivor&digits=6&period=30`,
      });
      return;
    }
    if (path === "/admin/mfa/verify" && req.method === "POST") {
      const { code } = await readBody(req);
      const limit = store.key(
        `mfa-attempt:${id}:${Math.floor(Date.now() / 60000)}`,
      );
      const count = await store.redis.incr(limit);
      if (count === 1) await store.redis.expire(limit, 65);
      if (count > policy.security.mfaAttempts) throw failure(429, "Quá nhiều lần thử MFA. Đợi một phút.");
      await store.transaction(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(7318403)');
        policy=await loadPolicy(db);await requirePanel(id,policy,db,req.securityIp);
        const row = (
          await db.query(
            "SELECT * FROM admin_mfa WHERE user_id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        const counter = row
          ? verifyTotp(
              crypto.decrypt(row.encrypted_secret),
              code,
              row.last_counter,
            )
          : null;
        if (counter === null)
          throw failure(401, "Mã MFA không đúng, đã dùng hoặc hết hạn.");
        await db.query(
          "UPDATE admin_mfa SET enabled=true,last_counter=$2 WHERE user_id=$1",
          [id, counter],
        );
        await db.query(
          "INSERT INTO admin_sessions(session_hash,user_id,expires_at) VALUES ($1,$2,now()+make_interval(mins=>$3)) ON CONFLICT(session_hash) DO UPDATE SET verified_at=now(),expires_at=EXCLUDED.expires_at",
          [sessionHash(req), id,policy.security.mfaMinutes],
        );
      });
      send(res, 200, { ok: true, expiresIn: policy.security.mfaMinutes*60 });
      return;
    }
    if (!(await elevated(req, id)))
      throw failure(401, "Xác minh MFA để tiếp tục thao tác quản trị.");
    const requirePermission = (permission, configured = false) => {
      if (!hasPermission(context, configured ? permission : policy.endpoints[permission]))
        throw failure(403, "Thiếu quyền: " + permission);
    };
    if (req.method === "GET") {
      if(path==='/admin/definitions'){
        requirePermission('player:read');
        const [snakes,inventory,roles,permissions]=await Promise.all(['snake_definitions','inventory_definitions','roles','permissions'].map(table=>store.query(`SELECT * FROM ${table}`)));
        send(res,200,{snakes:snakes.rows,inventory:inventory.rows,roles:roles.rows,permissions:permissions.rows,caps:policy.caps,moderation:policy.moderation,limits:policy.security});return;
      }
      if(path==='/admin/reports'){requirePermission('player:report:read');send(res,200,{rows:(await store.query('SELECT r.*,COALESCE(u.username,r.target_name) AS target_name FROM player_reports r LEFT JOIN users u ON u.id=r.target_id ORDER BY r.created_at DESC LIMIT $1',[policy.security.securityEventLimit])).rows});return;}
      if(path==='/admin/appeals'){requirePermission('player:report:read');send(res,200,{rows:(await store.query('SELECT a.*,u.username FROM moderation_appeals a JOIN users u ON u.id=a.player_id ORDER BY a.created_at DESC LIMIT $1',[policy.security.securityEventLimit])).rows});return;}
      if(path==='/admin/security-events'){requirePermission('security:events:read');send(res,200,{rows:(await store.query('SELECT * FROM security_events ORDER BY created_at DESC LIMIT $1',[policy.security.securityEventLimit])).rows});return;}
      if(path==='/admin/catalog'){requirePermission('content:read');send(res,200,{catalog:await loadCatalog(store),versions:(await store.query('SELECT id,published,created_at FROM game_catalogs ORDER BY created_at DESC')).rows});return;}
      if(path==='/admin/policy'){requirePermission('system:configure');send(res,200,{policy,schemas:(await store.query("SELECT key,schema FROM configuration_definitions WHERE key LIKE 'policy.%'")).rows});return;}
      if (path === "/admin/players") {
        requirePermission("player:read");
        const term = String(url.searchParams.get("q") || "").slice(0, 64);
        const rows = (
          await store.query(
            "SELECT u.id,u.username,p.display_name,p.ranked_eligible,w.gold,w.dna FROM users u JOIN player_profiles p ON p.player_id=u.id JOIN player_wallets w ON w.player_id=u.id WHERE u.username ILIKE $1 OR p.display_name ILIKE $1 ORDER BY u.created_at DESC LIMIT 50",
            ["%" + term + "%"],
          )
        ).rows;
        send(res, 200, { rows });
        return;
      }
      if (/^\/admin\/players\/[a-f0-9-]{36}$/.test(path)) {
        requirePermission("player:read");
        send(res, 200, { player: await player(store, path.split("/")[3]) });
        return;
      }
      if (path === "/admin/audit") {
        requirePermission("admin:audit:read");
        send(res, 200, {
          rows: (
            await store.query(
              "SELECT id,actor_user_id,actor_roles,action,target_id,before_data,after_data,reason,request_id,created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 100",
            )
          ).rows,
        });
        return;
      }
      if (path === "/admin/whitelist") {
        requirePermission("whitelist:read");
        send(res, 200, {
          rows: (
            await store.query(
              "SELECT w.*,u.username FROM whitelist_entries w JOIN users u ON u.id=w.user_id ORDER BY w.created_at DESC LIMIT 100",
            )
          ).rows,
          types: WHITELIST_TYPES,
          scopes: SCOPES,
          environments: ENVIRONMENTS,
        });
        return;
      }
      if (path === "/admin/roles") {
        requirePermission("authorization:roles:manage");
        send(res, 200, {
          roles: (await store.query("SELECT * FROM roles ORDER BY priority"))
            .rows,
          permissions: (
            await store.query("SELECT * FROM permissions ORDER BY code")
          ).rows,
          mappings: (await store.query("SELECT * FROM role_permissions")).rows,
        });
        return;
      }
      if (path === "/admin/settings") {
        requirePermission("system:configure");
        send(res, 200, { settings: await authz.settings() });
        return;
      }
      throw failure(404, "Không có API quản trị này.");
    }
    const body = await readBody(req);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < policy.security.adminReasonMin || reason.length > policy.security.adminReasonMax)
      throw failure(400, `Lý do phải từ ${policy.security.adminReasonMin}–${policy.security.adminReasonMax} ký tự.`);
    const requestId = body.requestId;
    if (typeof requestId !== "string" || !UUID.test(requestId))
      throw failure(400, "Yêu cầu requestId UUID để chống thao tác trùng.");
    const payloadHash = hash(
      JSON.stringify({ path, method: req.method, body }),
    );
    const operation = path.match(
      /^\/admin\/players\/([a-f0-9-]{36})\/(currency|max|unlock-all|unlock|inventory|progression|reset|ban|unban|mute|unmute|roles|overrides)$/,
    );
    let target = operation?.[1] || body.userId || null,
      permission,
      action;
    const op = operation?.[2];
    if (op) {
      if (!UUID.test(target)) throw failure(400, "ID không hợp lệ.");
      const permissions=policy.commands[op];
      permission=permissions?.[(op==='ban'?body.temporary:body.amount<0)?1:0]||permissions?.[0];
      action = op.toUpperCase().replaceAll("-", "_");
    } else if (path === "/admin/whitelist" && req.method === "POST") {
      permission = "whitelist:create";
      action = "WHITELIST_CREATED";
    } else if (
      /^\/admin\/whitelist\/[a-f0-9-]{36}$/.test(path) &&
      req.method === "DELETE"
    ) {
      permission = "whitelist:delete";
      action = "WHITELIST_REMOVED";
    } else if (path === "/admin/settings" && req.method === "POST") {
      permission = "system:configure";
      action = "SETTINGS_CHANGED";
    } else if (path === "/admin/role-permissions" && req.method === "POST") {
      permission = "authorization:permissions:manage";
      action = "ROLE_PERMISSIONS_CHANGED";
    } else if(path==='/admin/catalog'&&req.method==='POST'){permission='content:manage';action='CATALOG_PUBLISHED';}
    else if(path==='/admin/policy'&&req.method==='POST'){permission='system:configure';action='POLICY_CHANGED';}
    else if(path==='/admin/permissions'&&req.method==='POST'){permission='authorization:permissions:create';action='PERMISSION_CREATED';}
    else if(path==='/admin/roles'&&req.method==='POST'){permission='authorization:roles:manage';action='ROLE_CREATED';}
    else if(/^\/admin\/reports\/[a-f0-9-]{36}$/.test(path)&&req.method==='POST'){permission='player:report:resolve';action='REPORT_RESOLVED';target=path.split('/')[3];}
    else if(/^\/admin\/appeals\/[a-f0-9-]{36}$/.test(path)&&req.method==='POST'){permission='player:report:resolve';action='APPEAL_RESOLVED';target=path.split('/')[3];}
    else throw failure(404, "Lệnh quản trị không hỗ trợ.");
    requirePermission(permission, Boolean(op));
    if (op && req.method !== "POST") throw failure(405, "Lệnh này cần POST.");
    const result = await store.transaction(async (db) => {
      // Serializes privileged mutations and their idempotency record. Not on the game hot path.
      await db.query("SELECT pg_advisory_xact_lock(7318403)");
      policy=await loadPolicy(db);ECONOMY_CAPS=policy.caps;
      context=await requirePanel(id,policy,db,req.securityIp);
      if(!(await elevated(req,id,db)))throw failure(401,'Phiên đặc quyền đã hết hạn hoặc bị thu hồi.');
      if(op){const mapping=policy.commands[op];permission=mapping?.[(op==='ban'?body.temporary:body.amount<0)?1:0]||mapping?.[0];}
      requirePermission(permission, Boolean(op));
      const duplicate = (
        await db.query(
          "SELECT payload_hash,after_data FROM admin_audit_logs WHERE actor_user_id=$1 AND request_id=$2",
          [id, requestId],
        )
      ).rows[0];
      if (duplicate) {
        if (duplicate.payload_hash !== payloadHash)
          throw failure(409, "requestId đã dùng cho dữ liệu khác.");
        return { duplicate: true, data: duplicate.after_data };
      }
      let before = {},
        after = {};
      if(action==='REPORT_RESOLVED'){
        if(!policy.moderation.reportStatuses.some(s=>s.id===body.status))throw failure(400,'Trạng thái báo cáo không hợp lệ.');
        const resolution=typeof body.resolution==='string'?body.resolution.trim():'';if(resolution.length>policy.security.reportReasonMax)throw failure(400,'Kết quả quá dài.');
        before=(await db.query('SELECT * FROM player_reports WHERE id=$1 FOR UPDATE',[target])).rows[0];if(!before)throw failure(404,'Không tìm thấy báo cáo.');
        after=(await db.query('UPDATE player_reports SET status=$2,resolved_by=$3,resolution=$4,resolved_at=now() WHERE id=$1 RETURNING *',[target,body.status,id,resolution])).rows[0];
        await notifyPlayer(db,before.reporter_id,'REPORT_UPDATED',{reportId:target,status:body.status,resolution});
      }
      if(action==='APPEAL_RESOLVED'){
        if(!policy.moderation.appealStatuses.some(s=>s.id===body.status)||typeof body.resolution!=='string'||!body.resolution.trim()||body.resolution.length>policy.security.reportReasonMax)throw failure(400,'Kết quả xem xét không hợp lệ.');
        before=(await db.query('SELECT * FROM moderation_appeals WHERE id=$1 FOR UPDATE',[target])).rows[0];if(!before)throw failure(404,'Không tìm thấy yêu cầu.');
        after=(await db.query('UPDATE moderation_appeals SET status=$2,resolved_by=$3,resolution=$4,resolved_at=now() WHERE id=$1 RETURNING *',[target,body.status,id,body.resolution.trim()])).rows[0];
        await notifyPlayer(db,before.player_id,'APPEAL_UPDATED',{appealId:target,status:body.status,resolution:body.resolution.trim()});
      }
      if(action==='CATALOG_PUBLISHED'){
        const c=body.catalog;
        // Handler contracts and resource safety remain code; balance/content lives in DB.
        if(!c||!/^[-a-z0-9.]{3,80}$/.test(c.id)||!Array.isArray(c.modes)||!c.modes.length||!c.network||c.network.tickHz<10||c.network.tickHz>30||c.network.snapshotHz<1||c.network.snapshotHz>30||!c.limits||c.limits.players<1||c.limits.players>30||c.limits.segments<6||c.limits.segments>150||c.limits.enemies>1000||c.limits.foods>2000||c.limits.projectiles>1000)throw failure(400,'Cấu hình vượt hợp đồng engine hoặc giới hạn tài nguyên.');
        const prior=await loadCatalog(db);
        const safeData=value=>{
          if(Array.isArray(value))return value.every(safeData);
          if(value&&typeof value==='object')return Object.entries(value).every(([key,v])=>!['__proto__','constructor','prototype'].includes(key)&&(key==='id'?typeof v==='string'&&/^[-a-zA-Z0-9_.:]{1,100}$/.test(v):true)&&(key==='color'?typeof v==='string'&&/^#[a-fA-F0-9]{6}$/.test(v):true)&&safeData(v));
          return true;
        };
        if(!safeData(c))throw failure(400,'ID hoặc màu trong nội dung không hợp lệ.');
        // Validate each heterogeneous list against its matching persisted definition.
        const verify=(next,previous)=>{if(Array.isArray(previous))return Array.isArray(next)&&next.length<=1000&&next.every(v=>{const shape=previous.find(x=>x?.id===v?.id)||previous[0];return shape!==undefined&&verify(v,shape);});if(previous&&typeof previous==='object')return next&&typeof next==='object'&&!Array.isArray(next)&&Object.keys(previous).every(k=>Object.hasOwn(next,k)&&verify(next[k],previous[k]))&&Object.keys(next).every(k=>Object.hasOwn(previous,k));return typeof next===typeof previous&&(typeof next!=='number'||Number.isFinite(next)&&next>=0&&next<=1e7)&&(typeof next!=='string'||next.length<=2000);};
        if(!verify(c,prior)||c.id===prior.id||c.modes.some(m=>m.capacity<1||m.capacity>c.limits.players)||c.network.nearRadius>c.network.midRadius)throw failure(400,'Nội dung không đúng schema của phiên bản đã phát hành; phiên bản mới cần ID mới.');
        if(!Number.isInteger(c.network.invalidMessageLimit)||c.network.invalidMessageLimit<1||c.network.invalidMessageLimit>1000||c.network.invalidMessageWindowSeconds<1||c.network.invalidMessageWindowSeconds>300||c.network.maxMessagesPerSecond<40||c.network.maxMessagesPerSecond>1000)throw failure(400,'Giới hạn thông điệp không hợp lệ.');
        const positive=[c.world.directorHz,c.world.eventLoopSeconds,c.world.weatherSeconds,c.world.branchInterval,c.world.reviveSeconds,c.extraction.period,c.extraction.channelSeconds,c.network.midHz,c.network.farHz,c.network.reconnectSeconds,c.network.authRefreshSeconds,c.network.fullSnapshotSeconds,c.network.snapshotWorkers,c.progression.levelXp,c.progression.seasonXp,c.balance.elementInterval,c.balance.growthPerSegment,c.rewards.goldPerSeconds];
        if(positive.some(v=>!Number.isFinite(v)||v<=0)||c.extraction.openSeconds>=c.extraction.period||c.extraction.deathLoss>1||c.events.some((e,i)=>e.at>c.world.eventLoopSeconds||i>0&&e.at<c.events[i-1].at)||c.graphics.some(g=>!Number.isInteger(g.bodyStride)||g.bodyStride<1)||c.rarities.length!==prior.rarities.length||c.raritySchedule?.some(r=>r.weights.length!==c.rarities.length||r.weights.every(v=>v===0)))throw failure(400,'Chu kỳ, xác suất hoặc giới hạn nội dung không hợp lệ.');
        if(c.spawning){
          const periods=[c.spawning.enemyMinimumSeconds,c.spawning.enemyBaseSeconds,c.spawning.foodSeconds,c.balance.enemyScaleSeconds,c.balance.deathGrowthValue,c.balance.infernoEvery,c.world.evolutionEveryLevels,c.bots.populationSeconds,c.bots.perception];
          const probabilities=[c.loot.growthChance,c.loot.healChance,c.loot.goldChance,c.spawning.bruteFrom,c.spawning.bruteRoll,c.spawning.archerFrom,c.spawning.archerRoll,c.spawning.swarmRoll];
          const weightsValid=weights=>Object.keys(weights).length>0&&Object.keys(weights).every(k=>Object.hasOwn(c.foodValues,k))&&Object.values(weights).some(v=>v>0);
          if(periods.some(v=>v<=0)||probabilities.some(v=>v>1)||!weightsValid(c.spawning.initialFoodWeights)||!weightsValid(c.spawning.foodWeights)||c.spawning.enemyBaseCount>100||c.spawning.foodBaseCount>200||c.balance.bossProjectilesFinal>500||c.balance.bossProjectilesFirst>500||c.bots.personalities.some(p=>!c.bots.utilityWeights[p]||!c.bots.preferences[p])||c.bots.reactions.some(v=>v<=0))throw failure(400,'Lịch sinh, xác suất hoặc hành vi bot không hợp lệ.');
        }
        if(!Number.isInteger(c.network.snapshotWorkers)||c.network.snapshotWorkers>4||!Number.isInteger(c.raid.armorParts)||c.raid.armorParts<1||c.raid.armorParts>32||c.network.maxBufferedBytes<16384||c.network.maxBufferedBytes>4194304||c.modes.some(m=>!prior.modes.some(p=>p.id===m.id))||c.upgradesList.some(u=>!prior.upgradesList.some(p=>p.id===u.id)))throw failure(400,'Vượt hợp đồng xử lý của phiên bản engine.');
        if(c.adaptiveGraphics){const a=c.adaptiveGraphics;if(a.lowFps<10||a.highFps<=a.lowFps||a.highFps>240||a.downSeconds<=0||a.upSeconds<=0||a.cooldownSeconds<=0||!Number.isInteger(a.initialLevel)||a.initialLevel>=c.graphics.length||c.graphics.some(g=>g.resolution<.5||g.resolution>2))throw failure(400,'Ngưỡng đồ họa thích ứng không hợp lệ.');}
        if(c.biomeModifiers?.some(m=>!c.biomes.some(b=>b.id===m.biome)||['fire','lightning','vision','speed','growth'].some(k=>m[k]<=0||m[k]>4)))throw failure(400,'Biến thể biome không hợp lệ.');
        if(c.bots.evolutionPreferences&&c.bots.personalities.some(p=>!c.bots.evolutionPreferences[p]||c.bots.evolutionPreferences[p].some(e=>!['organs','keystones','curses','mutations'].includes(e.kind)||!c[e.kind]?.some(d=>d.id===e.choice))))throw failure(400,'Lựa chọn tiến hóa của bot chưa có trong nội dung.');
        for(const key of ['modes','species','upgradesList','organs','keystones','curses','hybrids','evolutions','mutations','weather'])if(!c[key].length||new Set(c[key].map(d=>d.id)).size!==c[key].length||c[key].some(d=>d.handler&&!prior[key].some(p=>p.handler===d.handler)))throw failure(400,'Danh mục rỗng, trùng ID hoặc handler chưa được hỗ trợ.');
        before={id:prior.id};
        const season=c.season,existing=(await db.query('SELECT * FROM seasons WHERE id=$1',[season.id])).rows[0];
        if(!season.id||!Number.isFinite(Date.parse(season.startsAt))||Date.parse(season.endsAt)<=Date.parse(season.startsAt)||!Number.isFinite(Date.parse(season.endsAt)))throw failure(400,'Thời gian mùa không hợp lệ.');
        if(existing&&(new Date(existing.starts_at).getTime()!==Date.parse(season.startsAt)||new Date(existing.ends_at).getTime()!==Date.parse(season.endsAt)))throw failure(409,'Mùa đã có phải giữ thời gian; hãy tạo ID mùa mới.');
        await db.query('INSERT INTO seasons(id,name,starts_at,ends_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[season.id,season.name,season.startsAt,season.endsAt]);
        await db.query('INSERT INTO content_versions(id,game_version,balance_version,upgrade_pool,manifest) VALUES ($1,$2,$3,$4,$5)',[c.id,c.game,c.id,c.upgrades,JSON.stringify(c.rewards)]);
        await db.query('INSERT INTO game_catalogs(id,data,published) VALUES ($1,$2,true)',[c.id,JSON.stringify(c)]);
        await db.query('UPDATE runtime_configuration SET catalog_id=$1',[c.id]);after=c;
      }
      if(action==='POLICY_CHANGED'){
        const schema=(await db.query('SELECT schema FROM configuration_definitions WHERE key=$1',['policy.'+body.key])).rows[0]?.schema;
        if(!schema||!validateConfiguration(body.value,schema))throw failure(400,'Chính sách không đúng schema trong DB.');
        if(body.key==='caps'&&(body.value.level>100||body.value.season>50))throw failure(400,'Cap vượt hợp đồng lưu trữ hiện tại.');
        if(body.key==='security'&&(['mfaMinutes','mfaAttempts','cacheSeconds','sessionDays','ticketSeconds','requestRate'].some(k=>body.value[k]<1)||body.value.cacheSeconds>300||body.value.mfaMinutes>30||body.value.rootRole!==policy.security.rootRole))throw failure(400,'Chính sách xác thực không hợp lệ.');
        if(body.key==='security'){
          const s=body.value,positive=['restrictedSessionMinutes','authenticatedRequestRate','usernameMin','usernameMax','passwordMin','passwordMax','displayNameMax','historyLimit','notificationLimit','reportDailyLimit','reportReasonMin','reportReasonMax','evidenceUrlMax','appealDailyLimit','securityEventLimit','adminReasonMin','adminReasonMax'];
          if(positive.some(k=>!Number.isInteger(s[k])||s[k]<1)||s.passwordMin<10||s.passwordMax>1024||s.passwordMin>s.passwordMax||s.usernameMin>s.usernameMax||s.usernameMax>64||s.displayNameMax>64||s.reportReasonMax>4000||s.reportReasonMin>s.reportReasonMax||s.adminReasonMax>4000||s.adminReasonMin>s.adminReasonMax||s.historyLimit>1000||s.notificationLimit>1000||s.securityEventLimit>1000||s.restrictedSessionMinutes>60||s.trustedProxyAddresses.some(rule=>!matchesIp(rule.split('/')[0],rule)))throw failure(400,'Giới hạn bảo mật không hợp lệ.');
          if(!permittedAdminIp(context,{security:s},req.securityIp,authz.environment))throw failure(400,'Cần whitelist IP hiện tại trước khi bắt buộc IP allowlist.');
        }
        if(body.key==='moderation'){
          const m=body.value;
          if(['reportCategories','reportStatuses','appealStatuses','scopes'].some(k=>!m[k].length||m[k].some(v=>!/^[-a-zA-Z0-9_]{1,64}$/.test(v.id))||new Set(m[k].map(v=>v.id)).size!==m[k].length)||!m.reportCategories.some(c=>c.id===m.defaultCategory)||!m.accountScopes.includes('ACCOUNT')||!m.matchScopes.includes('ACCOUNT')||policy.moderation.banTypes.some(t=>!m.banTypes.includes(t)))throw failure(400,'Chính sách kiểm duyệt làm mất hiệu lực quyết định hiện có.');
        }
        const allPerms=(await db.query('SELECT code FROM permissions')).rows.map(r=>r.code);
        const references=body.key==='commands'?Object.values(body.value).flat():body.key==='endpoints'?Object.values(body.value):[];
        if(references.some(p=>!allPerms.includes(p)))throw failure(400,'Quyền chưa được khai báo.');
        before={key:body.key,value:policy[body.key]};await db.query('UPDATE authorization_policy SET value=$2,updated_at=now() WHERE key=$1',[body.key,JSON.stringify(body.value)]);after={key:body.key,value:body.value};
      }
      if(action==='PERMISSION_CREATED'){
        if(typeof body.code!=='string'||!/^([a-z][a-z0-9_]*:)+[a-z][a-z0-9_]*$/.test(body.code)||body.code.length>100||typeof body.description!=='string'||body.description.length>500)throw failure(400,'Mã quyền không hợp lệ.');
        await db.query('INSERT INTO permissions VALUES ($1,$2)',[body.code,body.description]);after={code:body.code,description:body.description};
      }
      if(action==='ROLE_CREATED'){
        if(typeof body.code!=='string'||! /^[A-Z][A-Z0-9_]{1,39}$/.test(body.code)||typeof body.name!=='string'||body.name.length>80||!Number.isInteger(body.priority)||body.priority<0||body.priority>=context.priority)throw failure(400,'Vai trò không hợp lệ.');
        await db.query('INSERT INTO roles(code,name,priority,is_system) VALUES ($1,$2,$3,false)',[body.code,body.name,body.priority]);after={code:body.code,name:body.name,priority:body.priority};
      }
      if (op) {
        await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [target]);
        before = await player(db,target);
        if(['ban','unban','mute','unmute','reset'].includes(op)&&target!==id){
          const priority=Number((await db.query('SELECT COALESCE(max(r.priority),-1) AS priority FROM roles r JOIN user_roles u ON u.role_code=r.code WHERE u.user_id=$1 AND (u.expires_at IS NULL OR u.expires_at>now())',[target])).rows[0].priority);
          if(context.priority<=priority)throw failure(403,'Không được quản trị tài khoản có cấp quyền bằng hoặc cao hơn.');
        }
      }
      if (op === "currency") {
        const { currency, amount } = body;
        if (
          !["gold", "dna", "evolution_points"].includes(currency) ||
          !Number.isSafeInteger(amount) ||
          amount === 0 ||
          Math.abs(amount) > ECONOMY_CAPS[currency]
        )
          throw failure(400, "Loại tiền hoặc số lượng không hợp lệ.");
        const next = Number(before[currency]) + amount;
        if (next < 0 || next > ECONOMY_CAPS[currency])
          throw failure(409, "Số dư vượt giới hạn kinh tế.");
        await db.query(
          `UPDATE player_wallets SET ${currency}=$2 WHERE player_id=$1`,
          [target, next],
        );
        await db.query(
          `INSERT INTO wallet_ledger(id,player_id,event_key,${currency}) VALUES ($1,$2,$3,$4)`,
          [randomUUID(), target, `admin:${requestId}`, amount],
        );
      }
      if (op === "max" || op === "reset") {
        const max = op === "max";
        for (const currency of ["gold", "dna", "evolution_points"]) {
          const next = max ? ECONOMY_CAPS[currency] : 0;
          await db.query(
            `UPDATE player_wallets SET ${currency}=$2 WHERE player_id=$1`,
            [target, next],
          );
          await db.query(
            `INSERT INTO wallet_ledger(id,player_id,event_key,${currency}) VALUES ($1,$2,$3,$4)`,
            [
              randomUUID(),
              target,
              `admin:${requestId}:${currency}`,
              next - Number(before[currency]),
            ],
          );
        }
        await db.query(
          "UPDATE player_profiles SET progression_level=$2,ranked_eligible=false WHERE player_id=$1",
          [target, max ? ECONOMY_CAPS.level : 1],
        );
        await db.query("DELETE FROM player_meta_upgrades WHERE player_id=$1", [
          target,
        ]);
        await db.query("DELETE FROM player_snake_mastery WHERE player_id=$1", [
          target,
        ]);
        await db.query("DELETE FROM player_achievements WHERE player_id=$1", [
          target,
        ]);
        await db.query("DELETE FROM player_inventory WHERE player_id=$1", [
          target,
        ]);
        await db.query(
          "DELETE FROM player_season_progress WHERE player_id=$1",
          [target],
        );
        if (max) {
          await db.query(
            "INSERT INTO player_meta_upgrades SELECT $1,id,max_level FROM meta_upgrade_definitions",
            [target],
          );
          await db.query(
            "INSERT INTO player_snake_mastery SELECT $1,id,$2 FROM snake_definitions",
            [target, ECONOMY_CAPS.mastery],
          );
          await db.query(
            "INSERT INTO player_achievements SELECT $1,id,now() FROM achievement_definitions",
            [target],
          );
          await db.query(
            "INSERT INTO player_inventory SELECT $1,id,maximum FROM inventory_definitions",
            [target],
          );
          await db.query(
            "INSERT INTO player_season_progress SELECT $1,id,$2,0 FROM seasons WHERE starts_at<=now() AND ends_at>now()",
            [target, ECONOMY_CAPS.season],
          );
        } else {
          await db.query("DELETE FROM player_snakes WHERE player_id=$1", [
            target,
          ]);
          await db.query(
            "INSERT INTO player_snakes(player_id,snake_id) VALUES ($1,$2)",
            [target,policy.registration.species],
          );
        }
      }
      if (["max", "unlock-all", "unlock"].includes(op)) {
        if (op === "unlock") {
          if (
            !(
              await db.query("SELECT 1 FROM snake_definitions WHERE id=$1", [
                body.species,
              ])
            ).rowCount
          )
            throw failure(400, "Loài không tồn tại.");
          await db.query(
            "INSERT INTO player_snakes(player_id,snake_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [target, body.species],
          );
        } else
          await db.query(
            "INSERT INTO player_snakes(player_id,snake_id) SELECT $1,id FROM snake_definitions ON CONFLICT DO NOTHING",
            [target],
          );
      }
      if (op === "progression") {
        if (!Number.isInteger(body.level) || body.level < 1 || body.level > ECONOMY_CAPS.level)
          throw failure(400, "Cấp hồ sơ 1–100.");
        await db.query(
          "UPDATE player_profiles SET progression_level=$2,ranked_eligible=false WHERE player_id=$1",
          [target, body.level],
        );
      }
      if (op === "inventory") {
        const def = (
          await db.query("SELECT * FROM inventory_definitions WHERE id=$1", [
            body.itemId,
          ])
        ).rows[0];
        if (!def || !Number.isInteger(body.amount) || !body.amount)
          throw failure(400, "Vật phẩm không hợp lệ.");
        const value =
          (before.inventory.find((i) => i.item_id === body.itemId)?.quantity ||
            0) + body.amount;
        if (value < 0 || value > def.maximum)
          throw failure(409, "Số lượng vượt giới hạn vật phẩm.");
        await db.query(
          "INSERT INTO player_inventory VALUES ($1,$2,$3) ON CONFLICT(player_id,item_id) DO UPDATE SET quantity=EXCLUDED.quantity",
          [target, body.itemId, value],
        );
      }
      if (op === "ban" || op === "mute") {
        if (target === id)
          throw failure(409, "Không tự khóa tài khoản quản trị đang dùng.");
        const scope = op === "mute" ? "CHAT" : body.scope || "ACCOUNT";
        if (
          !policy.moderation.scopes.some(s=>s.id===scope)
        )
          throw failure(400, "Phạm vi cấm không hợp lệ.");
        let expires = body.expiresAt ? new Date(body.expiresAt) : null;
        if (
          expires &&
          (!Number.isFinite(expires.getTime()) || expires <= new Date())
        )
          throw failure(400, "Thời hạn phải ở tương lai.");
        if (
          body.temporary &&
          (!expires || expires.getTime() > Date.now() + policy.security.temporaryBanDays * 86400000)
        )
          throw failure(400, `Lệnh cấm tạm tối đa ${policy.security.temporaryBanDays} ngày.`);
        if(scope==='SPECIFIC_GAME_MODE'&&!(await loadCatalog(db)).modes.some(m=>m.id===body.mode))throw failure(400,'Chế độ không hợp lệ.');
        const publicReason=body.publicReason===undefined?policy.moderation.defaultPublicReason:body.publicReason;
        if(typeof publicReason!=='string'||!publicReason.trim()||publicReason.length>policy.security.reportReasonMax)throw failure(400,'Lý do công khai không hợp lệ.');
        const actionId=randomUUID();
        await db.query(
          "INSERT INTO moderation_actions(id,target_user_id,type,scope,scope_value,reason,created_by,expires_at,public_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            actionId,
            target,
            op === "mute" ? "MUTE" : expires ? "TEMP_BAN" : "PERMA_BAN",
            scope,
            String(body.mode || ""),
            reason,
            id,
            expires,
            publicReason.trim(),
          ],
        );
        await notifyPlayer(db,target,'RESTRICTION',publicRestriction({id:actionId,type:op==='mute'?'MUTE':expires?'TEMP_BAN':'PERMA_BAN',scope,scope_value:body.mode,expires_at:expires,public_reason:publicReason.trim()},policy));
        if (scope === "ACCOUNT")
          await db.query("DELETE FROM auth_sessions WHERE player_id=$1", [
            target,
          ]);
      }
      if (op === "unban" || op === "unmute"){
        await db.query(
          "UPDATE moderation_actions SET revoked_at=now(),revoked_by=$2 WHERE target_user_id=$1 AND revoked_at IS NULL AND type=ANY($3)",
          [
            target,
            id,
            op === "unmute"
              ? policy.moderation.muteTypes
              : policy.moderation.banTypes,
          ],
        );
        await notifyPlayer(db,target,'RESTRICTION_REVOKED',{operation:op});
        await db.query('DELETE FROM auth_sessions WHERE player_id=$1 AND restricted',[target]);
      }
      if (op === "roles") {
        if (
          !(await db.query("SELECT 1 FROM roles WHERE code=$1", [body.role]))
            .rowCount
        )
          throw failure(400, "Vai trò không tồn tại.");
        if (body.role === policy.security.rootRole && body.revoke) {
          const count = Number(
            (
              await db.query(
                "SELECT count(*) FROM user_roles WHERE role_code=$1 AND (expires_at IS NULL OR expires_at>now())",[policy.security.rootRole],
              )
            ).rows[0].count,
          );
          if (count <= 1)
            throw failure(409, "Không được gỡ SUPER_ADMIN cuối cùng.");
        }
        const expires = body.expiresAt ? new Date(body.expiresAt) : null;
        if (expires && (!Number.isFinite(+expires) || +expires <= Date.now()))
          throw failure(400, "Thời hạn không hợp lệ.");
        if (body.revoke)
          await db.query(
            "DELETE FROM user_roles WHERE user_id=$1 AND role_code=$2",
            [target, body.role],
          );
        else
          await db.query(
            "INSERT INTO user_roles(user_id,role_code,granted_by,expires_at) VALUES ($1,$2,$3,$4) ON CONFLICT(user_id,role_code) DO UPDATE SET granted_by=EXCLUDED.granted_by,granted_at=now(),expires_at=EXCLUDED.expires_at",
            [target, body.role, id, expires],
          );
      }
      if (op === "overrides") {
        if (
          !["ALLOW", "DENY", "REMOVE"].includes(body.effect) ||
          !(
            await db.query("SELECT 1 FROM permissions WHERE code=$1", [
              body.permission,
            ])
          ).rowCount
        )
          throw failure(400, "Quyền ngoại lệ không hợp lệ.");
        const expires = body.expiresAt ? new Date(body.expiresAt) : null;
        if (expires && (!Number.isFinite(+expires) || +expires <= Date.now()))
          throw failure(400, "Thời hạn không hợp lệ.");
        if (body.effect === "REMOVE")
          await db.query(
            "DELETE FROM user_permission_overrides WHERE user_id=$1 AND permission_code=$2",
            [target, body.permission],
          );
        else
          await db.query(
            "INSERT INTO user_permission_overrides VALUES ($1,$2,$3,$4,$5) ON CONFLICT(user_id,permission_code) DO UPDATE SET effect=EXCLUDED.effect,expires_at=EXCLUDED.expires_at,reason=EXCLUDED.reason",
            [target, body.permission, body.effect, expires, reason],
          );
      }
      if (action === "WHITELIST_CREATED") {
        if (
          !UUID.test(target) ||
          !WHITELIST_TYPES.includes(body.type) ||
          !SCOPES.includes(body.scope || "GLOBAL") ||
          !ENVIRONMENTS.includes(body.environment || authz.environment)
        )
          throw failure(400, "Whitelist không hợp lệ.");
        const starts = body.startsAt ? new Date(body.startsAt) : new Date(),
          expires = body.expiresAt ? new Date(body.expiresAt) : null;
        if (
          !Number.isFinite(+starts) ||
          (expires && (!Number.isFinite(+expires) || +expires <= +starts))
        )
          throw failure(400, "Thời gian whitelist không hợp lệ.");
        const wid = randomUUID();
        await db.query(
          "INSERT INTO whitelist_entries(id,user_id,type,scope,value,environment,reason,created_by,starts_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            wid,
            target,
            body.type,
            body.scope || "GLOBAL",
            String(body.value || "").slice(0, 128),
            body.environment || authz.environment,
            reason,
            id,
            starts,
            expires,
          ],
        );
        after = { id: wid, userId: target, type: body.type };
      }
      if (action === "WHITELIST_REMOVED") {
        const wid = path.split("/")[3];
        const w = (
          await db.query(
            "SELECT * FROM whitelist_entries WHERE id=$1 FOR UPDATE",
            [wid],
          )
        ).rows[0];
        if (!w) throw failure(404, "Whitelist không tồn tại.");
        before = w;
        target = w.user_id;
        await db.query(
          "UPDATE whitelist_entries SET is_active=false WHERE id=$1",
          [wid],
        );
        after = { ...w, is_active: false };
      }
      if (action === "SETTINGS_CHANGED") {
        const definition=(await db.query('SELECT schema FROM configuration_definitions WHERE key=$1',[body.key])).rows[0];
        if(!definition||!validateConfiguration(body.value,definition.schema))throw failure(400,'Thiết lập không đúng schema trong DB.');
        if(body.key==='operations'&&(!/^[-a-zA-Z0-9_]{1,64}$/.test(body.value.serverId)||['presenceMaxEntries','presenceTtlSeconds','presenceRequestsPerSecond','presenceBurst'].some(k=>!Number.isSafeInteger(body.value[k])||body.value[k]<1)||body.value.presenceMaxEntries>100000||body.value.presenceTtlSeconds>300))throw failure(400,'Cấu hình vận hành vượt giới hạn kỹ thuật.');
        if(body.key==='admin_tabs'&&(body.value.some(t=>!/^[-a-z]{1,40}$/.test(t.id))||new Set(body.value.map(t=>t.id)).size!==body.value.length))throw failure(400,'Danh mục quản trị không hợp lệ.');
        if(body.key==='site'){
          const site=body.value;let origin=null;try{if(site.origin)origin=new URL(site.origin);}catch{}
          if(site.origin&&(!origin||origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)||site.indexable&&!origin)throw failure(400,'SEO cần origin HTTPS hợp lệ trước khi bật index.');
          if(!site.title.trim()||!site.description.trim()||!site.heading.trim()||site.language!=='vi'||!/^\/[a-zA-Z0-9/_-]+\.(png|jpg|webp)$/.test(site.socialImage)||site.pages.length>30||new Set(site.pages.map(p=>p.slug)).size!==site.pages.length||site.pages.some(p=>!/^[-a-z0-9]{3,70}$/.test(p.slug)||['api','admin','rt','internal','metrics'].includes(p.slug)||!p.title.trim()||!p.heading.trim()||!p.sections.length))throw failure(400,'Nội dung SEO không hợp lệ.');
        }
        before =
          (
            await db.query(
              "SELECT key,value FROM system_settings WHERE key=$1",
              [body.key],
            )
          ).rows[0] || {};
        await db.query(
          "INSERT INTO system_settings(key,value,updated_by) VALUES ($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()",
          [body.key, JSON.stringify(body.value), id],
        );
        after = { key: body.key, value: body.value };
      }
      if (action === "ROLE_PERMISSIONS_CHANGED") {
        if (
          body.role === policy.security.rootRole ||
          !(await db.query("SELECT 1 FROM roles WHERE code=$1", [body.role]))
            .rowCount ||
          !Array.isArray(body.permissions) ||
          body.permissions.length > 100
        )
          throw failure(400, "Vai trò hoặc quyền không hợp lệ.");
        const available = (
          await db.query("SELECT code FROM permissions")
        ).rows.map((r) => r.code);
        if (body.permissions.some((p) => !available.includes(p)))
          throw failure(400, "Quyền chưa khai báo.");
        before = {
          role: body.role,
          permissions: (
            await db.query(
              "SELECT permission_code FROM role_permissions WHERE role_code=$1",
              [body.role],
            )
          ).rows.map((r) => r.permission_code),
        };
        await db.query("DELETE FROM role_permissions WHERE role_code=$1", [
          body.role,
        ]);
        for (const p of new Set(body.permissions))
          await db.query("INSERT INTO role_permissions VALUES ($1,$2)", [
            body.role,
            p,
          ]);
        after = { role: body.role, permissions: body.permissions };
      }
      if (op) {
        after = await player(db, target);
        if (["ban", "unban", "mute", "unmute"].includes(op))
          after.moderation = (
            await db.query(
              "SELECT id,type,scope,scope_value,expires_at,revoked_at FROM moderation_actions WHERE target_user_id=$1",
              [target],
            )
          ).rows;
        if (op === "overrides")
          after.overrides = (
            await db.query(
              "SELECT permission_code,effect,expires_at FROM user_permission_overrides WHERE user_id=$1",
              [target],
            )
          ).rows;
      }
      if(target&&(['roles','overrides','ban','unban','mute','unmute'].includes(op)||action.startsWith('WHITELIST_')))await db.query('DELETE FROM admin_sessions WHERE user_id=$1',[target]);
      if(action==='ROLE_PERMISSIONS_CHANGED')await db.query('DELETE FROM admin_sessions WHERE user_id IN (SELECT user_id FROM user_roles WHERE role_code=$1)',[body.role]);
      if(action==='POLICY_CHANGED')await db.query('DELETE FROM admin_sessions');
      await audit(db, {
        actor: id,
        context,
        action,
        target,
        before,
        after,
        reason,
        req,
        requestId,
        payloadHash,
      });
      return { duplicate: false, data: after };
    });
    if(target&&(['roles','overrides','ban','unban','mute','unmute'].includes(op)||action.startsWith('WHITELIST_')))await authz.invalidate(target);
    if (action === "ROLE_PERMISSIONS_CHANGED") {
      const users = (
        await store.query("SELECT user_id FROM user_roles WHERE role_code=$1", [
          body.role,
        ])
      ).rows;
      for (const u of users) await authz.invalidate(u.user_id);
    }
    if(action==='POLICY_CHANGED')for(const u of (await store.query('SELECT id FROM users')).rows)await authz.invalidate(u.id);
    send(res, 200, result);
  };
}
