// Isolated load authority. Only reads catalog/admission from the running API;
// all players are guests, so no user results or production catalogs are written.
import http from 'node:http';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
const upstream=process.env.BACKEND_URL||'http://127.0.0.1:3001';
const response=await fetch(upstream+'/internal/catalog',{headers:{'x-game-secret':process.env.GAME_SERVER_SECRET}});
if(!response.ok)throw new Error('Real catalog API is unavailable');
const {catalog}=await response.json(),capacity=Number(process.env.CAPACITY_ROOM_SIZE||10),density=process.env.CAPACITY_DENSITY||'normal';
catalog.modes.find(m=>m.id==='arena').capacity=capacity;catalog.bots.maxBots=0;
const bridge=http.createServer(async(req,res)=>{
 if(req.url==='/internal/catalog'){res.setHeader('content-type','application/json');res.end(JSON.stringify({catalog}));return;}
 const target=new URL(req.url,upstream);const proxy=http.request(target,{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});proxy.on('error',()=>res.writeHead(503).end());req.pipe(proxy);
});
await new Promise(r=>bridge.listen(0,'127.0.0.1',r));process.env.BACKEND_URL=`http://127.0.0.1:${bridge.address().port}`;
const {Server}=await import('@colyseus/core'),{WebSocketTransport}=await import('@colyseus/ws-transport');
const {RedisPresence}=await import('@colyseus/redis-presence'),{RedisDriver}=await import('@colyseus/redis-driver');
const {ArenaRoom}=await import('../dist/src/server/arena-room.js'),{redis,persistence}=await import('../dist/src/server/runtime.js');
const {chooseUpgrade}=await import('../dist/game/engine.js');
await redis.connect();const rooms=[];let measuring=false,cpuAt=process.cpuUsage(),at=performance.now(),peakRss=0;
const lag=monitorEventLoopDelay({resolution:20});lag.enable();
class LoadRoom extends ArenaRoom{
 capacityTicks=[];
 async onCreate(options){await super.onCreate(options);rooms.push(this);}
 simulate(){const start=performance.now();super.simulate();if(measuring&&this.roomState==='playing')this.capacityTicks.push(performance.now()-start);}
}
const redisUrl=new URL(process.env.REDIS_URL),namespace='capacity:'+randomUUID()+':';
const redisOptions={host:redisUrl.hostname,port:Number(redisUrl.port||6379),username:redisUrl.username?decodeURIComponent(redisUrl.username):undefined,password:decodeURIComponent(redisUrl.password),db:Number(redisUrl.pathname.slice(1)||0),keyPrefix:namespace};
const server=http.createServer(),game=new Server({transport:new WebSocketTransport({server}),presence:new RedisPresence(redisOptions),driver:new RedisDriver(redisOptions),greet:false,gracefullyShutdown:false,express:()=>{}});
const name='capacity-'+randomUUID();game.define(name,LoadRoom);await game.listen(0,'127.0.0.1');
let serial=0;
const fixture=setInterval(()=>{
 peakRss=Math.max(peakRss,process.memoryUsage().rss);
 for(const room of rooms){const w=room.world;if(!w.players.length)continue;
  for(const p of w.players){p.invulnerable=10000;const length=density==='late'?100:30;while(p.segments.length<length){p.choices=['growth'];chooseUpgrade(w,p.id,'growth');}if(!p._capacityFixture){for(let i=0;i<Math.floor(length/10);i++)p.segments[i*10].type=['fire','poison','lightning'][i%3];p._capacityFixture=true;}}
  const targets=density==='late'?{enemies:500,foods:800,projectiles:500}:{enemies:200,foods:400,projectiles:150};
  while(w.enemies.length<targets.enemies){const p=w.players[serial%w.players.length],a=serial++*2.4;w.enemies.push({id:'ce'+serial,type:'chaser',x:p.x+Math.cos(a)*300,y:p.y+Math.sin(a)*300,hp:900,maxHp:900,radius:13,angle:0,slow:0,hitFlash:0,attackTimer:1,phase:1,warning:0,_contacts:{},_poison:0,_poisonDamage:0,_ability:5});}
  while(w.foods.length<targets.foods){serial++;w.foods.push({id:'cf'+serial,type:'xp',x:50+(serial*79)%3000,y:50+(serial*51)%2200,value:0});}
  while(w.projectiles.length<targets.projectiles){const p=w.players[serial%w.players.length],a=serial++*2.4;w.projectiles.push({id:'cb'+serial,x:p.x+Math.cos(a)*200,y:p.y+Math.sin(a)*200,vx:-Math.cos(a)*185,vy:-Math.sin(a)*185,radius:5,damage:10,color:'#f4bc83',life:4});}
 }
},100);
process.send({type:'ready',port:server.address().port,name,catalog:catalog.id});
const percentile=(v,p)=>[...v].sort((a,b)=>a-b)[Math.min(v.length-1,Math.floor(v.length*p))]||0;
process.on('message',async m=>{
 if(m.type==='measure'){for(const r of rooms)r.capacityTicks=[];at=performance.now();cpuAt=process.cpuUsage();lag.reset();peakRss=process.memoryUsage().rss;measuring=true;process.send({type:'measuring'});}
 if(m.type==='report'){measuring=false;const elapsed=(performance.now()-at)/1000,cpu=process.cpuUsage(cpuAt);process.send({type:'report',seconds:elapsed,cpuCores:(cpu.user+cpu.system)/1e6/elapsed,rssMiB:peakRss/2**20,loopP95:lag.percentile(95)/1e6,rooms:rooms.map(r=>({players:r.members.size,hz:r.capacityTicks.length/elapsed,mean:r.capacityTicks.reduce((a,b)=>a+b,0)/r.capacityTicks.length,p95:percentile(r.capacityTicks,.95),p99:percentile(r.capacityTicks,.99),entities:{enemies:r.world.enemies.length,foods:r.world.foods.length,projectiles:r.world.projectiles.length,segments:r.world.players.reduce((n,p)=>n+p.segments.length,0)}}))});}
 if(m.type==='shutdown'){clearInterval(fixture);lag.disable();await game.gracefullyShutdown(false);await persistence.close();for await(const keys of redis.scanIterator({MATCH:namespace+'*',COUNT:100}))if(keys.length)await redis.del(keys);await redis.quit();await new Promise(r=>bridge.close(r));process.disconnect();}
});
