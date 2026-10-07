import {readFile,appendFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {createStore} from '../backend/store.js';
const databaseUrl=process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL;
const store=await createStore({databaseUrl,redisUrl:process.env.REDIS_URL});
await store.close();
const db=new Pool({connectionString:databaseUrl});
const quote=value=>"'"+value.replaceAll("'","''")+"'";
try{
 await db.query('BEGIN');
 for(const [name,key] of [['serpent_api','API_DATABASE_URL'],['serpent_worker','WORKER_DATABASE_URL']]){
  const password=process.env[key]?decodeURIComponent(new URL(process.env[key]).password):randomBytes(24).toString('hex');
  const exists=(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rowCount;
  await db.query(`${exists?'ALTER':'CREATE'} ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${quote(password)}`);
  await db.query(`GRANT CONNECT ON DATABASE serpent TO ${name}`);await db.query(`GRANT USAGE ON SCHEMA public TO ${name}`);
  await db.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${name}`);
  if(name==='serpent_api'){
   await db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${name}`);
   const writable=['users','player_profiles','auth_sessions','user_roles','player_wallets','player_snakes','player_meta_upgrades','player_snake_mastery','player_achievements','player_inventory','player_season_progress','role_permissions','user_permission_overrides','whitelist_entries','moderation_actions','admin_mfa','admin_sessions','system_settings','authorization_policy','runtime_configuration','player_reports','player_notifications','moderation_appeals'];
   await db.query(`GRANT INSERT,UPDATE,DELETE ON ${writable.join(',')} TO ${name}`);
   await db.query(`GRANT INSERT ON security_events,wallet_ledger,admin_audit_logs,permissions,roles,content_versions,game_catalogs,seasons TO ${name}`);
  }else{
   await db.query(`GRANT SELECT(id,status) ON users TO ${name}`);
   const read=['schema_migrations','player_wallets','player_profiles','player_snakes','player_meta_upgrades','player_snake_mastery','player_achievements','player_inventory','player_season_progress','content_versions','game_catalogs','runtime_configuration','authorization_policy','seasons','meta_upgrade_definitions','achievement_definitions','inventory_definitions','matches','match_players','match_results','match_builds','player_statistics','leaderboard_entries','wallet_ledger'];
   await db.query(`GRANT SELECT ON ${read.join(',')} TO ${name}`);
   await db.query(`GRANT INSERT ON matches,match_players,match_results,match_builds,wallet_ledger,player_snake_mastery,player_achievements,player_statistics,leaderboard_entries,player_inventory,player_season_progress TO ${name}`);
   await db.query(`GRANT UPDATE(id) ON users TO ${name}`);
   await db.query(`GRANT UPDATE ON player_wallets,player_profiles,match_results,match_builds,player_snake_mastery,player_statistics,leaderboard_entries,player_inventory,player_season_progress TO ${name}`);
  }
  if(!process.env[key]){const url=new URL(databaseUrl);url.username=name;url.password=password;await appendFile(new URL('../.env',import.meta.url),`\n${key}=${url.href}\n`);process.env[key]=url.href;}
 }
 await db.query('COMMIT');console.log('Migrations applied; API and worker credentials use restricted PostgreSQL roles. Existing data retained.');
}catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
