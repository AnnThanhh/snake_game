import {parentPort,workerData} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {getMessageBytes,Protocol} from '@colyseus/core';
import {createPathState,encodePathFrame} from '../../game/path-network.js';
const config=workerData.network,members=new Map<string,any>(),packingCache=new WeakMap(),tupleCache=new Map();
parentPort!.on('message',(job:any)=>{
 if(job.remove){members.delete(job.remove);return;}
 const started=performance.now(),outputs:any[]=[];
 for(const viewer of job.viewers){
  let state=members.get(viewer.id);if(state&&viewer.epoch<state.epoch)continue;
  if(!state||state.epoch!==viewer.epoch){state={epoch:viewer.epoch,wire:createPathState(),far:new Map(),next:new Map(),lastFull:0,time:-Infinity};members.set(viewer.id,state);}
  if(job.snapshot.time<state.time)continue;state.time=job.snapshot.time;
  const now=performance.now(),snapshot={...job.snapshot,players:[...job.snapshot.players]},own=snapshot.players.find((p:any)=>p.id===viewer.id);
  if(own)for(let i=0;i<snapshot.players.length;i++){const p=snapshot.players[i];if(p.id===own.id)continue;const distance=Math.hypot(p.x-own.x,p.y-own.y),hz=distance<=config.nearRadius?config.snapshotHz:distance<=config.midRadius?config.midHz:config.farHz;
   if(!viewer.force&&now<(state.next.get(p.id)||0)&&state.far.has(p.id))snapshot.players[i]=state.far.get(p.id);else{state.far.set(p.id,p);state.next.set(p.id,now+1000/hz);}}
  const ids=new Set(snapshot.players.map((p:any)=>p.id));for(const id of state.far.keys())if(!ids.has(id)){state.far.delete(id);state.next.delete(id);}
  const full=viewer.force||now-state.lastFull>=(config.fullSnapshotSeconds||5)*1000;if(full)state.lastFull=now;
  const frame=encodePathFrame(snapshot,state.wire,{playerId:viewer.id,viewRadius:viewer.viewRadius,forceFull:full,packingCache,tupleCache});
  const value={type:viewer.type,frame,ack:viewer.ack,telemetry:job.telemetry,...viewer.extra};
  const bytes=getMessageBytes.raw(Protocol.ROOM_DATA,'message',value);
  const data=Uint8Array.from(bytes);outputs.push({id:viewer.id,epoch:viewer.epoch,data,ms:performance.now()-now});
 }
 const ids=new Set([...job.snapshot.players,...job.snapshot.enemies,...job.snapshot.foods,...job.snapshot.projectiles,...job.snapshot.effects,...job.snapshot.players.flatMap((p:any)=>p.segments)].map((e:any)=>e.id));
 for(const id of tupleCache.keys())if(!ids.has(id))tupleCache.delete(id);
 parentPort!.postMessage({outputs,ms:performance.now()-started},outputs.map(o=>o.data.buffer));
});
