import {fork} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
const seconds=Number(process.env.CAPACITY_SECONDS||45),roomSize=Number(process.env.CAPACITY_ROOM_SIZE||10),maxRooms=Number(process.env.CAPACITY_MAX_ROOMS||16),maxNodes=Number(process.env.CAPACITY_MAX_NODES||4),density=process.env.CAPACITY_DENSITY||'normal';
if(![10,30].includes(roomSize)||![seconds,maxNodes,maxRooms].every(Number.isInteger)||!['normal','late'].includes(density)||seconds<15||seconds>600||maxNodes<1||maxNodes>8||maxRooms<1||maxRooms>64)throw new Error('Invalid bounded capacity test configuration');
const report={date:new Date().toISOString(),machine:{cpu:os.cpus()[0].model,logical:os.cpus().length,memoryGiB:os.totalmem()/2**30,initialFreeGiB:os.freemem()/2**30,node:process.version},scope:'Local Redis/Colyseus plus actual PostgreSQL catalog/admission API. Guests, no wallet/results load; no browser rendering, WAN, frontend proxy or distributed production router. Load generators share this machine. Room catalog cloned in RAM only; production DB capacity unchanged.',density,roomSize,seconds,gates:{minimumHz:19,p95TickMs:35,minimumSnapshotHz:10,p95AckMs:300,generatorLagMs:80,reserveMiB:768},stages:[]};
await mkdir('artifacts',{recursive:true});const output=`artifacts/capacity-${density}-${roomSize}.json`;
const save=()=>writeFile(output,JSON.stringify(report,null,2));
function launch(file,env={}){const child=fork(new URL(file,import.meta.url),[],{env:{...process.env,...env},execArgv:[],stdio:['ignore','pipe','pipe','ipc']});child.stdout.resume();child.stderr.on('data',b=>process.stderr.write(b));return child;}
function wait(child,type,timeout=60000){return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);};const onMessage=m=>{if(m.type===type||m.type==='failed'){cleanup();m.type==='failed'?reject(new Error(m.error)):resolve(m);}};const onExit=code=>{cleanup();reject(new Error('Child exited '+code));};const timer=setTimeout(()=>{cleanup();reject(new Error('Timed out: '+type));},timeout);child.on('message',onMessage);child.once('exit',onExit);});}
async function ask(child,type,result=type){const pending=wait(child,result);child.send({type});return pending;}
async function stop(child){if(child.exitCode!==null)return;const exited=new Promise(r=>child.once('exit',r));if(child.connected)child.send({type:'shutdown'});await Promise.race([exited,delay(8000).then(()=>{if(child.exitCode===null)child.kill();})]);}
async function stage(nodes,rooms,duration=seconds){
 const children=[],servers=[],clients=[];let lowMemory=false;const result={nodes,roomsPerNode:rooms,users:nodes*rooms*roomSize,seconds:duration,freeBeforeMiB:os.freemem()/2**20};
 if(os.freemem()/2**20<768+nodes*(120+rooms*60)){result.passed=false;result.reason='memory_preflight';report.stages.push(result);await save();return result;}
 console.log(`Capacity: ${result.users} clients, ${nodes} authorities × ${rooms} rooms × ${roomSize}; ${density}, ${duration}s.`);
 try{
  for(let i=0;i<nodes;i++){
   const server=launch('./capacity-authority.js',{CAPACITY_ROOM_SIZE:String(roomSize),CAPACITY_DENSITY:density});children.push(server);servers.push(server);const ready=await wait(server,'ready');
   report.catalog=ready.catalog;const client=launch('./capacity-clients.js');children.push(client);clients.push(client);const connected=wait(client,'connected',120000);client.send({type:'connect',port:ready.port,name:ready.name,rooms,size:roomSize,species:'cobra'});await connected;
  }
  await delay(5000);await Promise.all([...servers,...clients].map(c=>ask(c,'measure','measuring')));
  for(let elapsed=0;elapsed<duration;elapsed++){await delay(1000);if(os.freemem()/2**20<768){lowMemory=true;break;}}
  result.authorities=await Promise.all(servers.map(c=>ask(c,'report')));result.generators=await Promise.all(clients.map(c=>ask(c,'report')));
  const allRooms=result.authorities.flatMap(a=>a.rooms);result.minimumHz=Math.min(...allRooms.map(r=>r.hz));result.worstTickP95=Math.max(...allRooms.map(r=>r.p95));result.minimumSnapshotHz=Math.min(...result.generators.map(c=>c.minSnapshotHz));result.worstAckP95=Math.max(...result.generators.map(c=>c.ackP95??Infinity));result.generatorLimited=result.generators.some(c=>c.loopP95>80);result.authorityRssMiB=result.authorities.reduce((n,a)=>n+a.rssMiB,0);result.generatorRssMiB=result.generators.reduce((n,a)=>n+a.rssMiB,0);result.wireMiBps=result.generators.reduce((n,a)=>n+a.wireMiBps,0);
  result.passed=!lowMemory&&!result.generatorLimited&&result.minimumHz>=19&&result.worstTickP95<35&&result.minimumSnapshotHz>=10&&result.worstAckP95<300&&result.generators.every(c=>c.connected===c.clients&&!c.errors.length);
  result.reason=lowMemory?'memory_guard':result.generatorLimited?'load_generator_limited':result.passed?'passed':'latency_or_tick_gate';
  console.log(`${result.passed?'PASS':'LIMIT'} ${result.users}: min ${result.minimumHz.toFixed(2)} Hz, worst p95 ${result.worstTickP95.toFixed(2)}ms, ACK ${result.worstAckP95.toFixed(1)}ms, snapshots ${result.minimumSnapshotHz.toFixed(1)}Hz; ${result.reason}.`);
 }catch(e){result.passed=false;result.reason=e.message;console.error('Stage failed:',e.message);}
 finally{for(const child of [...clients,...servers].reverse())await stop(child);for(const child of children)if(child.exitCode===null)child.kill();}
 result.freeAfterMiB=os.freemem()/2**20;report.stages.push(result);report.maximumVerifiedUsers=Math.max(0,...report.stages.filter(s=>s.passed).map(s=>s.users));await save();return result;
}
let bestRooms=0,failedRooms=0;
for(let rooms=1;rooms<=maxRooms;rooms*=2){const r=await stage(1,rooms);if(!r.passed){failedRooms=rooms;break;}bestRooms=rooms;}
if(failedRooms&&bestRooms)for(let rooms=bestRooms+1;rooms<failedRooms;rooms++){const r=await stage(1,rooms);if(!r.passed)break;bestRooms=rooms;}
if(bestRooms)for(let nodes=2;nodes<=maxNodes;nodes++){const r=await stage(nodes,bestRooms);if(!r.passed)break;}
const best=report.stages.filter(s=>s.passed).sort((a,b)=>b.users-a.users)[0];
if(best){report.confirmation=await stage(best.nodes,best.roomsPerNode,Math.max(120,seconds));report.confirmedUsers=report.confirmation.passed?best.users:0;}
await save();console.log(`Report: ${output}; verified ${report.maximumVerifiedUsers||0}, sustained confirmation ${report.confirmedUsers||0}.`);
