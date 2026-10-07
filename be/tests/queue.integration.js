import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createBackend} from '../backend/index.js';
import {createStore} from '../backend/store.js';
import {createResultQueue,createResultWorker} from '../backend/result-queue.js';
import {loadCatalog} from '../backend/configuration.js';
test('BullMQ rewards, restart/idempotency, extraction and restricted worker',async t=>{
 const schema='test_'+randomBytes(8).toString('hex'),db=new Pool({connectionString:process.env.DATABASE_URL});
 await db.query(`CREATE SCHEMA ${schema}`);let api,store,queue,worker;
 try{
  api=await createBackend({port:0,schema,namespace:schema,secret:randomBytes(32).toString('hex')});const address=await api.listen();
  const response=await fetch(`http://127.0.0.1:${address.port}/api/account/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'queue_test',password:'Local integration strong 123',displayName:'Queue test'})});assert.equal(response.status,201);const id=(await response.json()).profile.id;
  // Mirror the public worker role privileges onto the disposable test schema.
  await db.query(`GRANT USAGE ON SCHEMA ${schema} TO serpent_worker`);
  await db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO serpent_worker`);
  await db.query(`GRANT UPDATE(id) ON ${schema}.users TO serpent_worker`);
  for(const table of ['matches','match_players','match_results','match_builds','wallet_ledger','player_snake_mastery','player_achievements','player_statistics','leaderboard_entries','player_inventory','player_season_progress'])await db.query(`GRANT INSERT ON ${schema}.${table} TO serpent_worker`);
  for(const table of ['player_wallets','player_profiles','match_results','match_builds','player_snake_mastery','player_statistics','leaderboard_entries','player_inventory','player_season_progress'])await db.query(`GRANT UPDATE ON ${schema}.${table} TO serpent_worker`);
  store=await createStore({databaseUrl:process.env.WORKER_DATABASE_URL,redisUrl:process.env.REDIS_URL,schema,namespace:schema,migrate:false});
  queue=await createResultQueue({redisUrl:process.env.REDIS_URL,prefix:schema});worker=await createResultWorker({store,redisUrl:process.env.REDIS_URL,prefix:schema});
  const catalog=await loadCatalog(store),result={lifeId:randomUUID(),matchId:randomUUID(),accountId:id,mode:'extraction',bot:false,contentVersion:catalog.id,species:'cobra',reason:'extracted',duration:40,score:100,kills:0,pvpKills:0,level:2,maxLength:8,damage:20,bossDamage:0,xp:10,startedAt:new Date().toISOString(),build:[],segments:['poison'],traits:[],keystones:['pacifist'],curses:[],organs:[],evolutions:[],temporaryLoot:9,extracted:true,objectives:2};
  await t.test('extraction persists artifacts and DNA exactly once through concurrent queue submissions',async()=>{const values=await Promise.all(Array.from({length:4},()=>queue.submit(result)));assert.equal(values.filter(v=>!v.duplicate).length,1);assert.equal(Number((await store.query('SELECT dna FROM player_wallets WHERE player_id=$1',[id])).rows[0].dna),18);assert.equal((await store.query("SELECT quantity FROM player_inventory WHERE player_id=$1 AND item_id='artifact'",[id])).rows[0].quantity,9);});
  await t.test('worker restart retains durable idempotency and rejects conflicting payload',async()=>{await worker.close();worker=await createResultWorker({store,redisUrl:process.env.REDIS_URL,prefix:schema});assert.equal((await queue.submit(result)).duplicate,true);await assert.rejects(queue.submit({...result,score:999}),{status:409});});
  await t.test('death never converts temporary loot; raid victory pays configured DNA',async()=>{await queue.submit({...result,lifeId:randomUUID(),matchId:randomUUID(),reason:'death',extracted:false});assert.equal(Number((await store.query('SELECT dna FROM player_wallets WHERE player_id=$1',[id])).rows[0].dna),18);await queue.submit({...result,lifeId:randomUUID(),matchId:randomUUID(),mode:'raid',reason:'victory',extracted:false,temporaryLoot:0});assert.equal(Number((await store.query('SELECT dna FROM player_wallets WHERE player_id=$1',[id])).rows[0].dna),18+catalog.raid.rewardDna);});
  await t.test('worker cannot grant roles, change status or remove audit entries',async()=>{for(const sql of ["INSERT INTO user_roles(user_id,role_code) VALUES ($1,'SUPER_ADMIN')","UPDATE users SET status='banned' WHERE id=$1",'DELETE FROM admin_audit_logs WHERE actor_user_id=$1'])await assert.rejects(store.query(sql,[id]),{code:'42501'});});
  await t.test('DB caps also apply to mastery and achievement rewards',async()=>{await api.store.query("UPDATE authorization_policy SET value=jsonb_set(jsonb_set(value,'{mastery}','10'),'{dna}','50') WHERE key='caps'");await queue.submit({...result,lifeId:randomUUID(),matchId:randomUUID(),mode:'raid',reason:'victory',extracted:false,temporaryLoot:0,kills:5,duration:60});const wallet=(await store.query('SELECT dna FROM player_wallets WHERE player_id=$1',[id])).rows[0];assert.equal(Number(wallet.dna),50);assert.equal(Number((await store.query('SELECT xp FROM player_snake_mastery WHERE player_id=$1',[id])).rows[0].xp),10);});
 }finally{await worker?.close();await queue?.queue.obliterate({force:true});await queue?.close();await store?.close();if(api){const keys=await api.store.redis.keys(schema+':*');if(keys.length)await api.store.redis.del(keys);await api.close();}await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();}
});
