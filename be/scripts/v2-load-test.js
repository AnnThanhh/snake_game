import {fork} from 'node:child_process';
import WebSocket from 'ws';
import {setTimeout as delay} from 'node:timers/promises';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {applyPathFrame} from '../game/path-network.js';
globalThis.WebSocket=WebSocket;
const {Client}=await import('@colyseus/sdk');
const reports=[],seconds=Number(process.env.V2_LOAD_SECONDS||30);
for(const humans of (process.env.V2_LOAD_CLIENTS?process.env.V2_LOAD_CLIENTS.split(',').map(Number):[12,30])){
 const child=fork(new URL('./v2-load-fixture.js',import.meta.url),[],{execArgv:process.env.V2_PROFILE?['--cpu-prof','--cpu-prof-dir=artifacts']:[],stdio:['ignore','pipe','pipe','ipc'],env:process.env});
 child.stderr.on('data',data=>process.stderr.write(data));
 const wait=type=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture timeout: '+type)),30000);const listener=m=>{if(m.type===type){clearTimeout(timer);child.off('message',listener);resolve(m);}};child.on('message',listener);});
 const clients=[],errors=[];let inputTimer,active=false;
 try{
  const {port}=await wait('ready');console.log(`Starting ${humans}-client load fixture on port ${port}.`);const sdk=new Client(`ws://127.0.0.1:${port}`);
  for(let i=0;i<humans;i++){
   const room=i===0?await sdk.create('v2-load',{mode:'arena',species:'cobra',playerName:'Load 0'}):await sdk.joinById(clients[0].room.roomId,{species:'cobra',playerName:'Load '+i});
   room.reconnection.enabled=false;const state={room,world:null,seq:0,bytes:0,frames:0,ack:0};clients.push(state);
   room.connection.transport.ws.addEventListener('message',event=>{if(active)state.bytes+=event.data.byteLength;});
   room.onMessage('message',data=>{try{if(data.type==='error')throw new Error(data.message);if(!data.frame)return;assert.equal(data.frame.v,3);if(i%10===0){state.world=applyPathFrame(state.world,data.frame);const p=state.world.snapshot.players.find(p=>p.id===room.sessionId);assert.ok(p&&p.segments.every(s=>Number.isFinite(s.x)&&Number.isFinite(s.y)));}state.ack=data.ack;if(active)state.frames++;}catch(e){errors.push(e.message);}});
   room.onDrop((code,reason)=>{if(active)errors.push(`drop ${i}: ${code} ${reason}`);});
   room.onError((code,message)=>errors.push(code+':'+message));
  }
  inputTimer=setInterval(()=>clients.forEach((c,i)=>c.room.send('message',{type:'input',seq:++c.seq,angle:performance.now()/8000+i,throttle:0})),50);
  const measuring=wait('measuring');child.send({type:'measure'});await measuring;await delay(4000);active=true;const start=performance.now();
  await delay(seconds*1000);active=false;const elapsed=(performance.now()-start)/1000,pending=wait('report');child.send({type:'report'});const report=await pending;
  Object.assign(report,{seconds:elapsed,wireKiBps:clients.map(c=>+(c.bytes/elapsed/1024).toFixed(2)),snapshotHz:clients.map(c=>+(c.frames/elapsed).toFixed(2)),errors});delete report.type;reports.push(report);
  console.log(`Colyseus ${humans} humans + ${report.entities.bots} bots: total tick mean ${report.mean.toFixed(2)} ms / p95 ${report.p95.toFixed(2)} ms, simulation ${JSON.stringify(report.simulation)}.`);
  await writeFile('artifacts/v2-load.json',JSON.stringify({scope:'Local dedicated process, real SDK clients; main tick includes bot AI, simulation and worker submission; worker encoding measured separately. Short load, excludes WAN/browser rendering.',reports},null,2));
  assert.deepEqual(errors,[]);assert.equal(report.entities.humans,humans);assert.equal(report.entities.humans+report.entities.bots,30);assert.ok(clients.every(c=>c.ack>0&&c.frames>elapsed*10));
 }finally{clearInterval(inputTimer);await Promise.race([Promise.allSettled(clients.map(c=>c.room.leave())),delay(3000)]);if(child.connected){const closed=new Promise(r=>child.once('exit',r));child.send({type:'shutdown'});await Promise.race([closed,delay(10000).then(()=>child.kill())]);}}
}
await writeFile('artifacts/v2-load.json',JSON.stringify({scope:'Local dedicated authority process plus snapshot worker threads; Redis matchmaking; 12 or 30 real SDK/WebSocket connections, totaling 30 humans and bots; full delta decode sampled every tenth client. 500 enemies + 800 food + 500 projectiles + 100–120 segments per snake. Main tick includes AI, simulation and worker submission; encoding occurs in workers. Excludes browser rendering/WAN. Short load, not a multi-hour soak.',reports},null,2));
assert.ok(reports.every(r=>r.mean<20&&r.p95<35&&r.averageHz>=19.5),'Load target not met; keep conservative room capacity.');
