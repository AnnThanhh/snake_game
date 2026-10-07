import { Pool } from "pg";
import { createClient } from "redis";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { CONTENT_VERSION } from "../game/version.js";

import { seedAuthorization } from "./permissions.js";
import {migrateSecurity} from './security-migration.js';
import { seedConfiguration,loadCatalog,loadPolicy,migrateTuning,schemaFromData } from './configuration.js';

export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function createStore({
  databaseUrl,
  redisUrl,
  namespace = "serpent",
  schema = "public",
  migrate = true,
}) {
  if (!databaseUrl || !redisUrl)
    throw new Error(
      "DATABASE_URL and REDIS_URL are required. Run Docker Compose first.",
    );
  if (!/^[a-z_][a-z0-9_]*$/.test(schema))
    throw new Error("Invalid database schema");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 6,
    connectionTimeoutMillis: 5000,
    options: `-c search_path=${schema}`,
  });
  pool.on("error", (error) =>
    console.error("PostgreSQL idle connection:", error.code || error.message),
  );
  let redisConnected = false;
  const redis = createClient({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) =>
        redisConnected
          ? Math.min(3000, 500 + retries * 250)
          : retries < 10
            ? 500
            : false,
    },
  });
  redis.on("error", () => {});
  redis.on("ready", () => {
    redisConnected = true;
  });
  try {
    await redis.connect();
    await pool.query("SELECT 1");
  } catch (error) {
    if(redis.isOpen)redis.destroy();
    await pool.end();
    throw error;
  }
  const query = (sql, args = []) => pool.query(sql, args);
  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  try{if(migrate)await transaction(async (db) => {
    let freshCore=false;
    // Serialize migrations across simultaneous backend starts.
    await db.query("SELECT pg_advisory_xact_lock(7318402)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    if (
      !(await db.query("SELECT 1 FROM schema_migrations WHERE version='001'"))
        .rowCount
    ) {
      await db.query(
        await readFile(
          new URL("./migrations/001_core.sql", import.meta.url),
          "utf8",
        ),
      );
      await db.query("INSERT INTO schema_migrations(version) VALUES ('001')");
      freshCore=true;
    }
    if (
      !(await db.query("SELECT 1 FROM schema_migrations WHERE version='002'"))
        .rowCount
    ) {
      await db.query(
        await readFile(
          new URL("./migrations/002_v2.sql", import.meta.url),
          "utf8",
        ),
      );
      await seedAuthorization(db);
      await db.query("INSERT INTO schema_migrations(version) VALUES ('002')");
    }
    if(!(await db.query("SELECT 1 FROM schema_migrations WHERE version='003'")).rowCount){
      await db.query(await readFile(new URL('./migrations/003_configuration.sql',import.meta.url),'utf8'));
      await seedConfiguration(db);
      await db.query("INSERT INTO schema_migrations(version) VALUES ('003')");
    }
    if(!(await db.query("SELECT 1 FROM schema_migrations WHERE version='004_core_seed_once'")).rowCount){
    if(freshCore){
    for (const [id, name, cost] of [
      ["cobra", "Cobra", 0],
      ["python", "Python", 200],
      ["viper", "Viper", 300],
    ])
      await db.query(
        "INSERT INTO snake_definitions VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, name, cost],
      );
    await db.query(
      `INSERT INTO meta_upgrade_definitions VALUES ('field_notes','Ghi chép thực địa','Mỗi cấp tăng 5% mastery nhận cuối lượt; không tăng chỉ số PvP.',5,100,'{"masteryMultiplier":0.05}') ON CONFLICT DO NOTHING`,
    );
    for (const row of [
      [
        "first_hunt",
        "Cuộc săn đầu tiên",
        "Hạ một quái trong lượt được server xác nhận.",
        5,
      ],
      [
        "survivor",
        "Bản năng sinh tồn",
        "Sống ít nhất 60 giây trong một lượt.",
        10,
      ],
      ["synergy", "Nhà khám phá", "Kích hoạt một cộng hưởng.", 15],
    ])
      await db.query(
        "INSERT INTO achievement_definitions VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        row,
      );
    await db.query(
      "INSERT INTO content_versions(id,game_version,balance_version,upgrade_pool,manifest) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [
        CONTENT_VERSION.id,
        CONTENT_VERSION.game,
        CONTENT_VERSION.balance,
        CONTENT_VERSION.upgrades,
        JSON.stringify({
          goldPer15Seconds: 1,
          goldPerKill: 2,
          goldPerPvpKill: 20,
          maxGoldPerLife: 2000,
        }),
      ],
    );
    await db.query(
      `INSERT INTO seasons VALUES ('season-1','Mùa Khai Nguyên','2026-01-01','2027-01-01') ON CONFLICT DO NOTHING`,
    );
    }
    await db.query("INSERT INTO schema_migrations(version) VALUES ('004_core_seed_once')");
    }
    if(!(await db.query("SELECT 1 FROM schema_migrations WHERE version='005_tuning'")).rowCount){await migrateTuning(db);await db.query("INSERT INTO schema_migrations(version) VALUES ('005_tuning')");}
    if(!(await db.query("SELECT 1 FROM schema_migrations WHERE version='006_runtime'")).rowCount){await db.query(await readFile(new URL('./migrations/006_runtime.sql',import.meta.url),'utf8'));await migrateTuning(db,'006_runtime','r2');await db.query("INSERT INTO schema_migrations(version) VALUES ('006_runtime')");}
    if(!(await db.query("SELECT 1 FROM schema_migrations WHERE version='007_world'")).rowCount){await migrateTuning(db,'007_world','r3');await db.query("INSERT INTO schema_migrations(version) VALUES ('007_world')");}
    if(!(await db.query("SELECT 1 FROM schema_migrations WHERE version='008_site'")).rowCount){const site=JSON.parse(await readFile(new URL('./seeds/008_site.json',import.meta.url),'utf8'));await db.query("INSERT INTO system_settings(key,value) VALUES ('site',$1) ON CONFLICT DO NOTHING",[JSON.stringify(site)]);await db.query("INSERT INTO configuration_definitions(key,schema) VALUES ('site',$1) ON CONFLICT DO NOTHING",[JSON.stringify(schemaFromData(site))]);await db.query("INSERT INTO schema_migrations(version) VALUES ('008_site')");}
    if(!(await db.query("SELECT 1 FROM schema_migrations WHERE version='009_security'")).rowCount){await migrateSecurity(db);await db.query("INSERT INTO schema_migrations(version) VALUES ('009_security')");}
  });
  }catch(error){if(redis.isOpen)redis.destroy();await pool.end();throw error;}
  async function profile(playerId) {
    const p = (
      await query(
        `SELECT u.id,u.username,p.display_name,p.discovered_traits,p.ranked_eligible,p.progression_level,w.gold,w.dna,w.evolution_points,
      COALESCE(s.lives,0) AS lives,COALESCE(s.kills,0) AS kills,COALESCE(s.best_score,0) AS best_score
      FROM users u JOIN player_profiles p ON p.player_id=u.id JOIN player_wallets w ON w.player_id=u.id
      LEFT JOIN player_statistics s ON s.player_id=u.id WHERE u.id=$1 AND u.status='active'`,
        [playerId],
      )
    ).rows[0];
    if (!p) return null;
    p.snakes = (
      await query("SELECT snake_id FROM player_snakes WHERE player_id=$1", [
        playerId,
      ])
    ).rows.map((r) => r.snake_id);
    p.mastery = (
      await query(
        "SELECT snake_id,xp FROM player_snake_mastery WHERE player_id=$1",
        [playerId],
      )
    ).rows;
    p.meta = (
      await query(
        "SELECT d.*,COALESCE(p.level,0) AS level FROM meta_upgrade_definitions d LEFT JOIN player_meta_upgrades p ON p.upgrade_id=d.id AND p.player_id=$1",
        [playerId],
      )
    ).rows;
    p.achievements = (
      await query(
        "SELECT d.* FROM player_achievements p JOIN achievement_definitions d ON d.id=p.achievement_id WHERE p.player_id=$1",
        [playerId],
      )
    ).rows;
    p.catalog = (
      await query("SELECT * FROM snake_definitions ORDER BY unlock_gold")
    ).rows;
    p.inventory = (
      await query(
        "SELECT i.item_id,i.quantity,d.name,d.category FROM player_inventory i JOIN inventory_definitions d ON d.id=i.item_id WHERE i.player_id=$1",
        [playerId],
      )
    ).rows;
    p.seasonProgress = (
      await query(
        "SELECT season_id,level,xp FROM player_season_progress WHERE player_id=$1",
        [playerId],
      )
    ).rows;
    return p;
  }
  return {
    pool,
    redis,
    query,
    transaction,
    profile,
    key: (name) => `${namespace}:${name}`,
    async close() {
      if (redis.isReady) await redis.quit();
      else if (redis.isOpen) redis.destroy();
      await pool.end();
    },
  };
}

const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export function validateResult(r,catalog) {
  const invalid = (message) =>
    Object.assign(new Error(message), { status: 400 });
  if (
    !r ||
    !uuid(r.lifeId) ||
    !uuid(r.matchId) ||
    !uuid(r.accountId) ||
    !catalog?.modes.some(m=>m.id===r.mode) ||
    r.bot !== false ||
    r.contentVersion !== catalog.id ||
    !catalog.species.some(s=>s.id===r.species) ||
    !catalog.resultReasons.includes(r.reason)
  )
    throw invalid("Invalid result identity or content version");
  for (const key of [
    "duration",
    "score",
    "kills",
    "pvpKills",
    "level",
    "maxLength",
    "damage",
    "bossDamage",
    "xp",
  ]) {
    if (!Number.isFinite(r[key]) || r[key] < 0 || r[key] > 1e9)
      throw invalid(`Invalid result ${key}`);
  }
  if (r.duration > 86400 || r.level < 1 || r.maxLength < 1 || r.maxLength > catalog.limits.segments+1)
    throw invalid("Invalid result bounds");
  if (
    !Array.isArray(r.build) ||
    r.build.length > 500 ||
    !Array.isArray(r.segments) ||
    r.segments.length > catalog.limits.segments ||
    !Array.isArray(r.traits) ||
    r.traits.length > 50
  )
    throw invalid("Invalid build");
  if (!Number.isFinite(Date.parse(r.startedAt)))
    throw invalid("Invalid timestamp");
  if (
    r.build.some(
      (u) =>
        !u ||
        !catalog.upgradesList.some(d=>d.id===u.id) ||
        !catalog.rarities.some((t) => t.id === u.rarity),
    ) ||
    r.segments.some(
      (s) => !Object.hasOwn(catalog.segments,s),
    ) ||
    r.traits.some((id) => !catalog.traits.some((t) => t.id === id))
  )
    throw invalid("Unknown build content");
}

export async function saveResult(store, r) {
  if(!r||typeof r.contentVersion!=='string')throw Object.assign(new Error('Invalid content version'),{status:400});
  let catalog;try{catalog=await loadCatalog(store,r.contentVersion);}catch{throw Object.assign(new Error('Unknown result content'),{status:400});}
  validateResult(r,catalog);
  for(const key of ['keystones','curses','organs','evolutions','mutations','hybrids'])if(r[key]!==undefined&&(!Array.isArray(r[key])||r[key].length>150||r[key].some(v=>!catalog[key].some(d=>d.id===(typeof v==='string'?v:v?.id)))))throw Object.assign(new Error('Invalid V2 build'),{status:400});
  if(r.temporaryLoot!==undefined&&(!Number.isInteger(r.temporaryLoot)||r.temporaryLoot<0||r.temporaryLoot>catalog.extraction.maxArtifacts))throw Object.assign(new Error('Invalid loot'),{status:400});
  if(r.apexKills!==undefined&&(!Number.isInteger(r.apexKills)||r.apexKills<0||r.apexKills>r.pvpKills))throw Object.assign(new Error('Invalid apex rewards'),{status:400});
  if(r.extracted&&(r.mode!=='extraction'||r.reason!=='extracted')||r.reason==='extracted'&&!r.extracted)throw Object.assign(new Error('Invalid extraction'),{status:400});
  const policy=await loadPolicy(store);
  const hash = digest(JSON.stringify(r));
  return store.transaction(async (db) => {
    // Account row also serializes wallet, mastery and reward changes for this user.
    const user = (
      await db.query(
        "SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE",
        [r.accountId],
      )
    ).rows[0];
    if (!user) throw new Error("Account unavailable");
    const duplicate = (
      await db.query(
        "SELECT payload_hash,earned_gold FROM match_results WHERE life_id=$1",
        [r.lifeId],
      )
    ).rows[0];
    if (duplicate) {
      if (duplicate.payload_hash !== hash) {
        const e = new Error("Conflicting result for the same life");
        e.status = 409;
        throw e;
      }
      return { duplicate: true, gold: duplicate.earned_gold };
    }
    if (
      !(
        await db.query(
          "SELECT 1 FROM player_snakes WHERE player_id=$1 AND snake_id=$2",
          [r.accountId, r.species],
        )
      ).rowCount
    )
      throw new Error("Snake not unlocked");
    const at = new Date(r.startedAt);
    const season = (
      await db.query(
        "SELECT id FROM seasons WHERE starts_at <= $1 AND ends_at > $1 AND ($2::text IS NULL OR id=$2) ORDER BY starts_at DESC LIMIT 1",
        [at,catalog.season?.id||null],
      )
    ).rows[0];
    if (!season) throw new Error("No season for this life");
    const end = new Date(at.getTime() + r.duration * 1000);
    const rewards=catalog.rewards;
    const wallet=(await db.query('SELECT gold,dna FROM player_wallets WHERE player_id=$1',[r.accountId])).rows[0];
    const gold = Math.max(0,Math.min(rewards.maxGold,policy.caps.gold-Number(wallet.gold),Math.floor(r.duration/rewards.goldPerSeconds)+Math.floor(r.kills)*rewards.goldPerKill+Math.floor(r.pvpKills)*rewards.goldPerPvpKill));
    const dna=Math.max(0,Math.min(rewards.maxDna,policy.caps.dna-Number(wallet.dna),(r.mode==='extraction'&&r.extracted?Math.floor(r.temporaryLoot||0)*catalog.extraction.artifactDna:0)+(r.mode==='raid'&&r.reason==='victory'?catalog.raid.rewardDna:0)+(r.mode!=='extraction'?(r.apexKills||0)*(catalog.apex?.rewardDna||0):0)));
    await db.query(
      "INSERT INTO matches(id,server_id,mode,map,content_version,started_at,ended_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
      [
        r.matchId,
        r.serverId || "local",
        r.mode,
        catalog.rewards.map,
        r.contentVersion,
        at,
        end,
      ],
    );
    await db.query(
      "INSERT INTO match_players VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [r.matchId, r.accountId],
    );
    await db.query(
      `INSERT INTO match_results(life_id,match_id,player_id,snake_id,payload_hash,reason,duration_seconds,score,kills,pvp_kills,deaths,level,max_length,damage,boss_damage,xp,earned_gold,season_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        r.lifeId,
        r.matchId,
        r.accountId,
        r.species,
        hash,
        r.reason,
        r.duration,
        Math.floor(r.score),
        Math.floor(r.kills),
        Math.floor(r.pvpKills),
        r.reason === "death" ? 1 : 0,
        Math.floor(r.level),
        Math.floor(r.maxLength),
        r.damage,
        r.bossDamage,
        Math.floor(r.xp),
        gold,
        season.id,
      ],
    );
    await db.query(
      "INSERT INTO match_builds(life_id,upgrades,segments,traits) VALUES ($1,$2,$3,$4)",
      [
        r.lifeId,
        JSON.stringify(r.build),
        JSON.stringify(r.segments),
        JSON.stringify(r.traits),
      ],
    );
    await db.query(
      "INSERT INTO wallet_ledger(id,player_id,event_key,gold) VALUES ($1,$2,$3,$4)",
      [randomUUID(), r.accountId, `life:${r.lifeId}`, gold],
    );
    await db.query(
      "UPDATE player_wallets SET gold=gold+$2 WHERE player_id=$1",
      [r.accountId, gold],
    );
    await db.query('UPDATE match_results SET earned_dna=$2,extracted=$3,objectives=$4 WHERE life_id=$1',[r.lifeId,dna,Boolean(r.extracted),Math.max(0,Math.floor(Number(r.objectives)||0))]);
    await db.query('UPDATE match_builds SET keystones=$2,curses=$3,organs=$4,evolutions=$5,mutations=$6,hybrids=$7 WHERE life_id=$1',[r.lifeId,JSON.stringify(r.keystones||[]),JSON.stringify(r.curses||[]),JSON.stringify(r.organs||[]),JSON.stringify(r.evolutions||[]),JSON.stringify(r.mutations||[]),JSON.stringify(r.hybrids||[])]);
    if(dna){await db.query('INSERT INTO wallet_ledger(id,player_id,event_key,dna) VALUES ($1,$2,$3,$4)',[randomUUID(),r.accountId,'v2:'+r.lifeId,dna]);await db.query('UPDATE player_wallets SET dna=dna+$2 WHERE player_id=$1',[r.accountId,dna]);}
    if(r.mode==='extraction'&&r.extracted)await db.query("INSERT INTO player_inventory(player_id,item_id,quantity) SELECT $1,'artifact',LEAST($2,maximum) FROM inventory_definitions WHERE id='artifact' ON CONFLICT(player_id,item_id) DO UPDATE SET quantity=LEAST(player_inventory.quantity+EXCLUDED.quantity,(SELECT maximum FROM inventory_definitions WHERE id='artifact'))",[r.accountId,r.temporaryLoot||0]);
    const meta =
      (
        await db.query(
          "SELECT level FROM player_meta_upgrades WHERE player_id=$1 AND upgrade_id=$2",
          [r.accountId,catalog.rewards.mastery.metaUpgrade],
        )
      ).rows[0]?.level || 0;
    const mastery = Math.floor(
      (r.duration*rewards.mastery.seconds + rewards.mastery.kills * r.kills + rewards.mastery.pvpKills * r.pvpKills) * (1 + meta * rewards.mastery.metaMultiplier),
    );
    await db.query(
      "INSERT INTO player_snake_mastery VALUES ($1,$2,LEAST($3::bigint,$4::bigint)) ON CONFLICT(player_id,snake_id) DO UPDATE SET xp=LEAST(player_snake_mastery.xp+EXCLUDED.xp,$4::bigint)",
      [r.accountId, r.species, mastery,policy.caps.mastery],
    );
    for (const definition of catalog.achievements) {
      const id=definition.id,value=r[definition.field];const earned=(Array.isArray(value)?value.length:value)>=definition.minimum;
      if (!earned) continue;
      const added = await db.query(
        "INSERT INTO player_achievements VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING achievement_id",
        [r.accountId, id],
      );
      if (added.rowCount) {
        const rewardDna = (
          await db.query(
            "SELECT reward_dna FROM achievement_definitions WHERE id=$1",
            [id],
          )
        ).rows[0].reward_dna;
        const currentDna=Number((await db.query('SELECT dna FROM player_wallets WHERE player_id=$1',[r.accountId])).rows[0].dna);
        const dna=Math.max(0,Math.min(rewardDna,policy.caps.dna-currentDna));
        await db.query(
          "INSERT INTO wallet_ledger(id,player_id,event_key,dna) VALUES ($1,$2,$3,$4)",
          [randomUUID(), r.accountId, `achievement:${id}`, dna],
        );
        await db.query(
          "UPDATE player_wallets SET dna=dna+$2 WHERE player_id=$1",
          [r.accountId, dna],
        );
      }
    }
    const previous = (
      await db.query(
        "SELECT discovered_traits FROM player_profiles WHERE player_id=$1",
        [r.accountId],
      )
    ).rows[0].discovered_traits;
    await db.query(
      "UPDATE player_profiles SET discovered_traits=$2 WHERE player_id=$1",
      [r.accountId, JSON.stringify([...new Set([...previous, ...r.traits])])],
    );
    await db.query(
      `INSERT INTO player_statistics VALUES ($1,1,$2,$3,$4,$5) ON CONFLICT(player_id) DO UPDATE SET lives=player_statistics.lives+1,kills=player_statistics.kills+EXCLUDED.kills,pvp_kills=player_statistics.pvp_kills+EXCLUDED.pvp_kills,seconds=player_statistics.seconds+EXCLUDED.seconds,best_score=GREATEST(player_statistics.best_score,EXCLUDED.best_score)`,
      [
        r.accountId,
        Math.floor(r.kills),
        Math.floor(r.pvpKills),
        r.duration,
        Math.floor(r.score),
      ],
    );
    await db.query(
      `INSERT INTO leaderboard_entries(season_id,player_id,mode,best_score,total_score,lives) VALUES ($1,$2,$3,$4,$4,1) ON CONFLICT(season_id,player_id,mode) DO UPDATE SET best_score=GREATEST(leaderboard_entries.best_score,EXCLUDED.best_score),total_score=leaderboard_entries.total_score+EXCLUDED.total_score,lives=leaderboard_entries.lives+1,updated_at=now()`,
      [season.id, r.accountId, r.mode, Math.floor(r.score)],
    );
    if(catalog.progression){
      const unit=catalog.progression.seasonXp,limit=policy.caps.season;
      await db.query('INSERT INTO player_season_progress(player_id,season_id,level,xp) VALUES ($1,$2,LEAST($4::integer,1+$3::bigint/$5::bigint),LEAST($3::bigint,$4::bigint*$5::bigint)) ON CONFLICT(player_id,season_id) DO UPDATE SET xp=LEAST(player_season_progress.xp+EXCLUDED.xp,$4::bigint*$5::bigint),level=LEAST($4::integer,1+(player_season_progress.xp+EXCLUDED.xp)/$5::bigint)',[r.accountId,season.id,mastery,limit,unit]);
      await db.query('UPDATE player_profiles SET progression_level=GREATEST(progression_level,LEAST($2::integer,1+(SELECT COALESCE(sum(xp),0) FROM player_snake_mastery WHERE player_id=$1)/$3::bigint)) WHERE player_id=$1',[r.accountId,policy.caps.level,catalog.progression.levelXp]);
    }
    return { duplicate: false, gold, dna, mastery };
  });
}
