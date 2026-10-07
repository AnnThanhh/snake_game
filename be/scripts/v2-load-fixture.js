// Test-only process. Never imported by the application launcher.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {Session} from 'node:inspector/promises';
import {writeFile} from 'node:fs/promises';
const profiler=process.env.V2_PROFILE?new Session():null;
if(profiler){profiler.connect();await profiler.post('Profiler.enable');await profiler.post('Profiler.start');}
const catalog=JSON.parse(await readFile(new URL('../backend/seeds/003_catalog.json',import.meta.url)));
for(const file of ['005_tuning','006_runtime','007_world']){const tuning=JSON.parse(await readFile(new URL(`../backend/seeds/${file}.json`,import.meta.url)));for(const [key,value] of Object.entries(tuning))catalog[key]=Array.isArray(value)?value:{...catalog[key],...value};}
catalog.modes.find(m=>m.id==='arena').capacity=30;catalog.bots.targetOffset=0;
const api=http.createServer(async(req,res)=>{for await(const _ of req){}res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/internal/catalog'?{catalog}:req.url==='/internal/revalidate'?{rows:[]}:{allowed:true}));});
await new Promise(r=>api.listen(0,'127.0.0.1',r));process.env.BACKEND_URL=`http://127.0.0.1:${api.address().port}`;
const {Server}=await import('@colyseus/core'),{WebSocketTransport}=await import('@colyseus/ws-transport');
const {RedisPresence}=await import('@colyseus/redis-presence'),{RedisDriver}=await import('@colyseus/redis-driver');
const {ArenaRoom}=await import('../dist/src/server/arena-room.js');
const {redis,persistence}=await import('../dist/src/server/runtime.js');
const {chooseUpgrade}=await import('../dist/game/engine.js');
await redis.connect();let room,serial=0,measuring=false,ticks=[],memory=[],entities,measureAt=0;
class FixtureRoom extends ArenaRoom{
 async onCreate(options){await super.onCreate(options);room=this;}
 simulate(){const at=performance.now();super.simulate();if(measuring)ticks.push(performance.now()-at);}
}
const server=http.createServer(),game=new Server({transport:new WebSocketTransport({server}),presence:new RedisPresence(process.env.REDIS_URL),driver:new RedisDriver(process.env.REDIS_URL),greet:false,gracefullyShutdown:false,express:()=>{}});
game.define('v2-load',FixtureRoom);await game.listen(0,'127.0.0.1');
const fixture=setInterval(()=>{if(!room?.world?.players.length||!measuring)return;const w=room.world;
 for(const p of w.players){p.invulnerable=10000;while(p.segments.length<100){p.choices=['growth'];chooseUpgrade(w,p.id,'growth');}if(!p._load){for(let i=0;i<9;i++)p.segments[i*10].type=['fire','poison','lightning'][i%3];p._load=true;}}
 while(w.enemies.length<500){const p=w.players[serial%w.players.length],a=serial++*2.4;w.enemies.push({id:`load-e-${serial}`,type:'chaser',x:p.x+Math.cos(a)*300,y:p.y+Math.sin(a)*300,hp:900,maxHp:900,radius:13,angle:0,slow:0,hitFlash:0,attackTimer:1,phase:1,warning:0,_contacts:{},_poison:0,_poisonDamage:0,_ability:5});}
 while(w.foods.length<800){serial++;w.foods.push({id:`load-f-${serial}`,type:'xp',x:50+(serial*79)%3000,y:50+(serial*51)%2200,value:0});}
 while(w.projectiles.length<500){const p=w.players[serial%w.players.length],a=serial++*2.4;w.projectiles.push({id:`load-b-${serial}`,x:p.x+Math.cos(a)*200,y:p.y+Math.sin(a)*200,vx:-Math.cos(a)*185,vy:-Math.sin(a)*185,radius:5,damage:10,color:'#f4bc83',life:4});}
 entities={humans:room.members.size,bots:w.players.filter(p=>p.bot).length,segments:w.players.reduce((n,p)=>n+p.segments.length,0),enemies:w.enemies.length,foods:w.foods.length,projectiles:w.projectiles.length};
},100);
const sampler=setInterval(()=>{if(measuring)memory.push(process.memoryUsage().heapUsed/1048576);},1000);
process.send({type:'ready',port:server.address().port});
process.on('message',async m=>{
 if(m.type==='measure'){measuring=true;ticks=[];memory=[];measureAt=performance.now();process.send({type:'measuring'});}
 if(m.type==='report'){measuring=false;const elapsed=(performance.now()-measureAt)/1000;if(profiler){const {profile}=await profiler.post('Profiler.stop');await writeFile('artifacts/v2-authority.cpuprofile',JSON.stringify(profile));profiler.disconnect();}const sorted=[...ticks].sort((a,b)=>a-b);process.send({type:'report',entities,ticks:ticks.length,averageHz:ticks.length/elapsed,mean:ticks.reduce((a,b)=>a+b,0)/ticks.length,p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],memory,simulation:room.sample});}
 if(m.type==='shutdown'){clearInterval(fixture);clearInterval(sampler);await game.gracefullyShutdown(false);await persistence.close();await redis.quit();await new Promise(r=>api.close(r));process.disconnect();}
});
