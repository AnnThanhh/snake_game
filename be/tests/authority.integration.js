import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import http from 'node:http';
import WebSocket from 'ws';
import {setTimeout as delay} from 'node:timers/promises';
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {createBackend} from '../backend/index.js';
import {loadPolicy} from '../backend/configuration.js';
import {createResultQueue,createResultWorker} from '../backend/result-queue.js';
globalThis.WebSocket=WebSocket;
const {Client}=await import('@colyseus/sdk');
async function until(fn){const deadline=Date.now()+12000;while(Date.now()<deadline){if(await fn())return;await delay(40);}throw new Error('Authority integration timeout');}
test('authenticated Colyseus lifecycle, queue rewards and live permission revocation', {timeout:40000},async()=>{
 const schema='authority_'+randomBytes(6).toString('hex'),db=new Pool({connectionString:process.env.DATABASE_URL});
 await db.query(`CREATE SCHEMA ${schema}`);
 const directory=path.resolve('.data/tests',schema);process.env.RESULT_OUTBOX_DIR=directory;
 let api,queue,worker,server,game,runtime;const clients=[],rooms=[];
 try{
  queue=await createResultQueue({redisUrl:process.env.REDIS_URL,prefix:schema});
  api=await createBackend({schema,namespace:schema,port:0,resultProcessor:p=>queue.submit(p)});
  process.env.BACKEND_URL=`http://127.0.0.1:${(await api.listen()).port}`;
  worker=await createResultWorker({store:api.store,redisUrl:process.env.REDIS_URL,prefix:schema});
  const {ArenaRoom}=await import('../dist/src/server/arena-room.js');runtime=await import('../dist/src/server/runtime.js');await runtime.redis.connect();
  const {Server}=await import('@colyseus/core'),{WebSocketTransport}=await import('@colyseus/ws-transport');
  server=http.createServer();game=new Server({transport:new WebSocketTransport({server}),greet:false,gracefullyShutdown:false,express:()=>{}});
  class TestRoom extends ArenaRoom{async onCreate(options){await super.onCreate(options);rooms.push(this);}}
  game.define('session-test',TestRoom);await game.listen(0,'127.0.0.1');const sdk=new Client(`ws://127.0.0.1:${server.address().port}`);
  const user=async username=>{const r=await fetch(process.env.BACKEND_URL+'/api/account/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:randomBytes(20).toString('hex')})});assert.equal(r.status,201);return {id:(await r.json()).profile.id,cookie:r.headers.get('set-cookie').split(';')[0]};};
  const ticket=async(u,mode)=>{const r=await fetch(process.env.BACKEND_URL+'/api/account/ticket',{method:'POST',headers:{cookie:u.cookie,'content-type':'application/json'},body:JSON.stringify({mode,species:'cobra'})});assert.equal(r.status,200);return (await r.json()).ticket;};
  const first=await user('authority_first'),second=await user('authority_second');
  const host=await sdk.create('session-test',{mode:'coop',ticket:await ticket(first,'coop')});clients.push(host);host.onMessage('message',()=>{});
  const guest=await sdk.joinById(host.roomId,{ticket:await ticket(second,'coop')});clients.push(guest);guest.onMessage('message',()=>{});
  const reportId=randomUUID();host.send('message',{type:'report',requestId:reportId,targetSessionId:guest.sessionId,category:'cheating',reason:'Suspicious conduct observed in this room',evidenceUrl:''});
  await until(async()=>(await api.store.query('SELECT 1 FROM player_reports WHERE id=$1',[reportId])).rowCount===1);
  const report=(await api.store.query('SELECT * FROM player_reports WHERE id=$1',[reportId])).rows[0];assert.equal(report.reporter_id,first.id);assert.equal(report.target_id,second.id);assert.equal(report.room_id,host.roomId);assert.equal(report.match_id,rooms[0].matchId);
  assert.equal(rooms[0].world.players.length,2);host.send('message',{type:'ready',ready:true});guest.send('message',{type:'ready',ready:true});await until(()=>rooms[0].world.time>.2);
  await api.store.query('INSERT INTO user_permission_overrides(user_id,permission_code,effect,reason) VALUES ($1,$2,$3,$4)',[second.id,(await loadPolicy(api.store)).access.joinPermission,'DENY','Isolated lifecycle revocation']);
  await api.authz?.invalidate(second.id);
  await rooms[0].revalidate();await until(()=>!rooms[0].members.has(guest.sessionId));
  await host.leave();await until(async()=>(await api.store.query('SELECT 1 FROM match_results WHERE player_id=$1',[first.id])).rowCount===1);
  const extraction=await sdk.create('session-test',{mode:'extraction',ticket:await ticket(first,'extraction')});clients.push(extraction);extraction.onMessage('message',()=>{});
  const room=rooms.find(r=>r.roomId===extraction.roomId),p=room.world.players.find(p=>p.id===extraction.sessionId);room.world.time=room.config.extraction.period+.1;p.temporaryLoot=9;p.invulnerable=999;
  // Isolate channel rewards from random relics, enemy kills and event spawns.
  room.world._directorAt=Infinity;room.world._spawnTimer=Infinity;room.world._foodTimer=Infinity;room.world.enemies=[];room.world.foods=[];
  const pin=setInterval(()=>{p.x=room.world.width/2;p.y=room.world.height/2;},10);
  try{extraction.send('message',{type:'input',seq:1,angle:0,throttle:0,interact:true});await until(()=>p.extracted);await until(async()=>(await api.store.query("SELECT 1 FROM match_results WHERE player_id=$1 AND reason='extracted'",[first.id])).rowCount===1);}finally{clearInterval(pin);}
  const reward=(await api.store.query("SELECT earned_dna FROM match_results WHERE player_id=$1 AND reason='extracted'",[first.id])).rows[0];assert.equal(reward.earned_dna,18);
  assert.equal((await api.store.query("SELECT quantity FROM player_inventory WHERE player_id=$1 AND item_id='artifact'",[first.id])).rows[0].quantity,9);
  await extraction.leave();await runtime.persistence.flush();assert.equal((await api.store.query("SELECT count(*) FROM match_results WHERE player_id=$1 AND reason='extracted'",[first.id])).rows[0].count,'1');
  const malformed=await sdk.create('session-test',{mode:'coop',species:'cobra',playerName:'protocol-test'});clients.push(malformed);malformed.onMessage('message',()=>{});const invalidRoom=rooms.find(r=>r.roomId===malformed.roomId);
  malformed.send('message',{type:'input',seq:1,angle:0,throttle:0,x:999999,hp:999999});await delay(100);assert.equal(invalidRoom.members.get(malformed.sessionId).lastSeq,0);assert.ok(invalidRoom.world.players[0].x!==999999);
  for(let i=1;i<invalidRoom.config.network.invalidMessageLimit;i++)malformed.send('message',{type:'input',seq:i+1,angle:0,throttle:0,gold:99999});
  await until(async()=>(await api.store.query('SELECT 1 FROM security_events WHERE room_id=$1',[malformed.roomId])).rowCount===1);await until(()=>!invalidRoom.members.has(malformed.sessionId));
  assert.equal((await api.store.query('SELECT count(*)::int AS count FROM moderation_actions')).rows[0].count,0);
  const flood=await sdk.create('session-test',{mode:'coop',species:'cobra',playerName:'rate-test'});clients.push(flood);flood.onMessage('message',()=>{});const floodRoom=rooms.find(r=>r.roomId===flood.roomId);
  for(let i=0;i<floodRoom.config.network.maxMessagesPerSecond;i++)flood.send('message',{type:'ping',at:i});
  await until(async()=>(await api.store.query("SELECT 1 FROM security_events WHERE room_id=$1 AND event_code='MESSAGE_FLOOD'",[flood.roomId])).rowCount===1);await until(()=>!floodRoom.members.has(flood.sessionId));
 }finally{
  for(const client of clients)if(client.connection?.isOpen)try{await Promise.race([client.leave(),delay(2000)]);}catch{}
  await game?.gracefullyShutdown(false);await runtime?.persistence.close();if(runtime?.redis.isOpen)await runtime.redis.quit();
  await worker?.close();await queue?.queue.obliterate({force:true});await queue?.close();
  if(api){for await(const keys of api.store.redis.scanIterator({MATCH:schema+':*',COUNT:100}))if(keys.length)await api.store.redis.del(keys);await api.close();}
  await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();
  if(directory.startsWith(path.resolve('.data/tests')+path.sep))await rm(directory,{recursive:true,force:true});
 }
});
