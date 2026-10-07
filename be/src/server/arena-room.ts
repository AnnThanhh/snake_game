import {Room,Client,ServerError} from '@colyseus/core';
import {randomBytes,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createWorld,addPlayer,removePlayer,stepWorld,getSnapshot,chooseUpgrade,respawnPlayer} from '../../game/engine.js';
import {chooseEvolution} from '../../game/v2.js';
import {SnapshotPipeline} from './snapshot-pipeline.js';
import {createBotDirector} from '../../server/bots.js';
import {catalog,persistence,redis,accountKey,releaseAccount,runtimeConfiguration} from './runtime.js';
import {validMessage} from '../../server/message-validation.js';
import {tickDuration,totalTickDuration,snapshotDuration,traffic,entities,resultCount,tracer} from './metrics.js';
import {operationalLog} from '../../backend/observability.js';
type Member={id:string,accountId:string|null,name:string,species:string,ready:boolean,connected:boolean,revoked?:boolean,epoch:number,ack:number,lastSeq:number,lastFull:number,viewRadius:number,far:Map<string,any>,next:Map<string,number>};
export class ArenaRoom extends Room {
 world:any;config:any;mode:any;inputs:Record<string,any>={};members=new Map<string,Member>();matchId=randomUUID();roomState='lobby';director:any;
 ticks:number[]=[];lastMeasure=performance.now();measuredTicks=0;sample:any={tickRate:20,tickMs:0,tickP95:0,state:'HEALTHY'};lastSnapshot=0;revalidating=false;
 pipeline!:SnapshotPipeline;
 violations=new Map<string,{at:number,count:number}>();
 messageRates=new Map<string,{at:number,count:number}>();
 reporting=new Set<string>();
 async onCreate(options:any){
  this.config=await catalog();this.mode=this.config.modes.find((m:any)=>m.id===options.mode);if(!this.mode)throw new ServerError(400,'Chế độ không hợp lệ.');
  this.roomId=randomBytes(3).toString('hex').toUpperCase();this.maxClients=this.mode.capacity;this.maxMessagesPerSecond=this.config.network.maxMessagesPerSecond||70;this.patchRate=null;
  this.world=createWorld({mode:this.mode.id,catalog:this.config,seed:randomBytes(4).readUInt32LE(),maxPlayers:this.maxClients,duration:this.mode.duration});
  this.roomState=this.mode.continuous||this.mode.id==='extraction'?'playing':'lobby';
  this.director=this.mode.continuous?createBotDirector(this.world,this.maxClients):null;
  await this.setMatchmaking({metadata:{mode:this.mode.id,name:this.mode.name,contentVersion:this.config.id,state:this.roomState}});
  this.pipeline=new SnapshotPipeline(this.config,value=>{
   for(const result of value.outputs){const m=this.members.get(result.id),client=this.clients.find(c=>c.sessionId===result.id);if(!m?.connected||m.epoch!==result.epoch||!client)continue;
    if((client as any).ref.bufferedAmount>this.config.network.maxBufferedBytes){(client as any).ref.terminate();continue;}
    (client as any).enqueueRaw(Buffer.from(result.data));traffic.inc({direction:'out',mode:this.mode.id},result.data.byteLength);snapshotDuration.observe({mode:this.mode.id},result.ms/1000);
   }
  },error=>{operationalLog.error('realtime.snapshot_failed',{roomId:this.roomId,mode:this.mode.id,code:error.name});void this.disconnect();});
  this.onMessage('message',(client,data)=>this.message(client,data));
  // Windows timers may round 50 ms up to ~62 ms. Accumulate elapsed time so
  // scheduling jitter cannot silently slow the fixed 20 Hz simulation.
  let accumulator=0,last=performance.now();const stepMs=1000/this.config.network.tickHz;
  this.setSimulationInterval(()=>{const now=performance.now();accumulator+=Math.min(now-last,stepMs*4);last=now;let steps=0;while(accumulator>=stepMs&&steps++<4){accumulator-=stepMs;this.simulate();}},10);
  // Clear the fallback patch clock installed before the simulation interval.
  this.patchRate=null;
  this.clock.setInterval(()=>void this.revalidate(),this.config.network.authRefreshSeconds*1000);
 }
 async onAuth(client:Client,options:any,context:any){
  const origin=context?.headers?.origin,host=context?.headers?.host;
  if(origin){try{if(new URL(origin).host!==host)throw 0;}catch{throw new ServerError(403,'Origin không hợp lệ.');}}
  let identity:any={accountId:null,displayName:typeof options.playerName==='string'?options.playerName.slice(0,runtimeConfiguration.policy.security.displayNameMax):runtimeConfiguration.operations.defaultPlayerName,species:options.species};
  try{if(options.ticket)identity=await persistence.consume(options.ticket,this.mode.id);else await persistence.access(null,this.mode.id);}catch(error:any){throw new ServerError(403,error.message);}
  if(!this.config.species.some((s:any)=>s.id===identity.species))throw new ServerError(400,'Loài không hợp lệ.');
  return identity;
 }
 async onJoin(client:Client,options:any,identity:any){
  const owner=`${this.roomId}:${client.sessionId}`;
  if(identity.accountId&&!(await redis.set(accountKey(identity.accountId),owner,{NX:true,EX:60})))throw new ServerError(409,'Tài khoản đã ở trong trận khác.');
  try{
   if(this.director)this.director.retireOne(this.world.players.filter((p:any)=>!p.bot));
   const p=addPlayer(this.world,{id:client.sessionId,name:identity.displayName,species:identity.species} as any);if(!p)throw new ServerError(409,'Phòng đã đầy.');persistence.newLife(p);
   const m:Member={id:client.sessionId,accountId:identity.accountId,name:p.name,species:p.species,ready:false,connected:true,epoch:0,ack:0,lastSeq:0,lastFull:0,viewRadius:this.config.network.nearRadius,far:new Map(),next:new Map()};this.members.set(m.id,m);
   this.sendWorld(client,'welcome',true,{playerId:m.id,room:this.info()});this.lobby();
   operationalLog.info('realtime.join',{roomId:this.roomId,mode:this.mode.id});
  }catch(e){if(identity.accountId)await releaseAccount(identity.accountId,owner);throw e;}
 }
 info(){return {id:this.roomId,code:this.roomId,name:this.mode.name,maxPlayers:this.maxClients,state:this.roomState,mode:this.mode.id,transport:'colyseus',contentVersion:this.config.id};}
 lobby(){this.broadcast('message',{type:'lobby',room:this.info(),players:[...this.members.values()].map(({id,name,species,ready,connected})=>({id,name,species,ready,connected}))});}
 message(client:Client,data:any){
  const m=this.members.get(client.sessionId);if(!m)return;
  if(m.revoked)return;
  const now=Date.now();let rate=this.messageRates.get(m.id);if(!rate||now-rate.at>=1000){rate={at:now,count:0};this.messageRates.set(m.id,rate);}
  if(++rate.count>=this.config.network.maxMessagesPerSecond){m.revoked=true;client.send('message',{type:'security',code:'MESSAGE_FLOOD'});void persistence.recordEvent({id:randomUUID(),code:'MESSAGE_FLOOD',accountId:m.accountId,roomId:this.roomId,count:rate.count,rule:'messages-per-second'}).catch(()=>console.error('Security event persistence unavailable'));void client.leave(4003);return;}
  if(!validMessage(data)){this.invalid(client,m);return;}
  if(m.revoked)return;
  traffic.inc({direction:'in',mode:this.mode.id},Buffer.byteLength(JSON.stringify(data)));
  const error=(message:string)=>client.send('message',{type:'error',message});
  if(data.type==='report'){void this.report(client,m,data);return;}
  if(data.type==='ping'){if(Number.isFinite(data.at))client.send('message',{type:'pong',at:data.at});return;}
  if(data.type==='resync'){if(performance.now()-m.lastFull>900)this.sendWorld(client,'snapshot',true);return;}
  if(data.type==='leave'){void client.leave(1000);return;}
  if(data.type==='ready'&&this.roomState==='lobby'){
   m.ready=Boolean(data.ready);this.lobby();if([...this.members.values()].every(x=>x.connected&&x.ready)){this.roomState='playing';void this.lock();void this.setMatchmaking({metadata:{...this.metadata,state:'playing'}});for(const peer of this.clients)this.sendWorld(peer,'started',true,{room:this.info()});}return;
  }
  if(data.type==='input'){
   if(!Number.isFinite(data.angle)||!Number.isFinite(data.throttle)||!Number.isSafeInteger(data.seq)||data.seq<=m.lastSeq)return;
   m.lastSeq=data.seq;m.viewRadius=Math.max(450,Math.min(this.config.network.nearRadius,Number(data.viewRadius)||this.config.network.nearRadius));
   const prior=this.inputs[m.id];this.inputs[m.id]={angle:data.angle,throttle:Math.max(-1,Math.min(1,data.throttle)),dash:data.dash===true||prior?.dash===true,pulse:data.pulse===true||prior?.pulse===true,interact:data.interact===true};return;
  }
  if(data.type==='upgrade'){if(!chooseUpgrade(this.world,m.id,data.id))error('Nâng cấp không hợp lệ.');return;}
  if(data.type==='evolution'){if(!chooseEvolution(this.world,m.id,data))error('Lựa chọn tiến hóa không hợp lệ.');return;}
  if(data.type==='respawn'){
   const old=this.world.players.find((p:any)=>p.id===m.id);if(old)void this.finish(m,old,'death');const p=respawnPlayer(this.world,m.id);if(!p){error('Chưa thể hồi sinh.');return;}persistence.newLife(p);delete this.inputs[m.id];this.sendWorld(client,'respawned',true);
  }
 }
 invalid(client:Client,m:Member){
  if(m.revoked)return;const now=Date.now();let state=this.violations.get(m.id);
  if(!state||now-state.at>this.config.network.invalidMessageWindowSeconds*1000){state={at:now,count:0};this.violations.set(m.id,state);}state.count++;
  if(state.count>=this.config.network.invalidMessageLimit){m.revoked=true;client.send('message',{type:'security',code:'PROTOCOL_VIOLATION'});void persistence.recordEvent({id:randomUUID(),code:'PROTOCOL_VIOLATION',accountId:m.accountId,roomId:this.roomId,count:state.count,rule:'message-schema'}).catch(()=>console.error('Security event persistence unavailable'));void client.leave(4003);}
 }
 async report(client:Client,m:Member,data:any){
  if(this.reporting.has(m.id))return;this.reporting.add(m.id);
  try{const target=this.members.get(data.targetSessionId);if(!target||target.id===m.id||!m.accountId)throw new Error('Cần đăng nhập và chọn người chơi trong phòng.');
   const result=await persistence.report({...data,reporterId:m.accountId,mode:this.mode.id,room:{roomId:this.roomId,matchId:this.matchId,targetId:target.accountId,targetSessionId:target.id,targetName:target.name}});
   client.send('message',{type:'report_saved',id:result.id});
  }catch(e:any){client.send('message',{type:'error',message:e.message});}finally{this.reporting.delete(m.id);}
 }
 simulate(){
  if(this.roomState!=='playing')return;
  const started=performance.now(),dt=1/this.config.network.tickHz;
  this.director?.update(this.inputs,this.members.size);stepWorld(this.world,this.inputs,dt);
  for(const m of this.members.values()){
   m.ack=m.lastSeq;const p=this.world.players.find((p:any)=>p.id===m.id);
   if(p&&((!p.alive&&(this.world._pvp||p.extracted))||this.world.status!=='playing'))void this.finish(m,p,p.extracted?'extracted':!p.alive?'death':this.world.status);
  }
  for(const input of Object.values(this.inputs)){input.dash=false;input.pulse=false;}
  const elapsed=performance.now()-started;tickDuration.observe({mode:this.mode.id},elapsed/1000);this.ticks.push(elapsed);if(this.ticks.length>600)this.ticks.shift();this.measuredTicks++;
  const now=performance.now();if(now-this.lastMeasure>=1000){const sorted=[...this.ticks].sort((a,b)=>a-b);this.sample={tickRate:this.measuredTicks*1000/(now-this.lastMeasure),tickMs:this.ticks.reduce((n,v)=>n+v,0)/this.ticks.length,tickP95:sorted[Math.floor((sorted.length-1)*.95)]||0,state:sorted[Math.floor((sorted.length-1)*.95)]>this.config.network.tickWarnMs||this.measuredTicks*1000/(now-this.lastMeasure)<this.config.network.tickHz*.9?'DEGRADED':'HEALTHY'};this.lastMeasure=now;this.measuredTicks=0;for(const kind of ['players','enemies','foods','projectiles'])entities.set({mode:this.mode.id,kind,room:this.roomId},this.world[kind].length);}
  if(now-this.lastSnapshot>=1000/this.config.network.snapshotHz){this.pipeline.send(getSnapshot(this.world,{includePaths:true}),this.clients.map(c=>this.viewer(c,'snapshot')).filter(Boolean),this.sample);this.lastSnapshot=Math.max(now-1000/this.config.network.snapshotHz,this.lastSnapshot+1000/this.config.network.snapshotHz);}
  if(this.world.status!=='playing'){this.roomState='finished';for(const client of this.clients)this.sendWorld(client,'snapshot',true);void this.lock();this.clock.setTimeout(()=>void this.disconnect(),this.config.network.roomIdleSeconds*1000);}
  totalTickDuration.observe({mode:this.mode.id},(performance.now()-started)/1000);
 }
 viewer(client:Client,type:string,force=false,extra:any={}){const m=this.members.get(client.sessionId);if(!m?.connected)return null;if(force)m.lastFull=performance.now();return {id:m.id,epoch:m.epoch,type,force,extra,ack:m.ack,viewRadius:m.viewRadius*(this.world.players.find((p:any)=>p.id===m.id)?._modifiers?.vision||1)};}
 sendWorld(client:Client,type:string,force=false,extra:any={}){const viewer=this.viewer(client,type,force,extra);if(viewer)this.pipeline.send(getSnapshot(this.world,{includePaths:true}),[viewer],this.sample,true);}
 async finish(m:Member,p:any,reason:string){if(p.alive&&reason==='death'||p._saved)return;const span=tracer.startSpan('life.finish');try{await persistence.finish({id:this.matchId,state:this.roomState,world:this.world},m,p,reason);if(m.accountId)resultCount.inc({mode:this.mode.id,reason});}finally{span.end();}}
 async revalidate(){
  if(this.revalidating)return;this.revalidating=true;
  try{
   await this.setMatchmaking({metadata:{...this.metadata,state:this.roomState,elapsed:Math.floor(this.world.time),bots:this.world.players.filter((p:any)=>p.bot).length,tickRate:this.sample.tickRate,tickP95:this.sample.tickP95}});
   for(const m of this.members.values())if(m.accountId){const key=accountKey(m.accountId),owner=`${this.roomId}:${m.id}`;const held=await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('EXPIRE',KEYS[1],60) elseif redis.call('EXISTS',KEYS[1])==0 then redis.call('SET',KEYS[1],ARGV[1],'EX',60); return 1 else return 0 end",{keys:[key],arguments:[owner]});if(!held){m.revoked=true;const client=this.clients.find(c=>c.sessionId===m.id);if(client)void client.leave(4003);}}
   const rows=await persistence.revalidate([...this.members.values()].map(m=>({accountId:m.accountId,mode:this.mode.id})));
   for(const m of this.members.values())if(rows.rows.some((r:any)=>r.accountId===m.accountId&&!r.allowed)){m.revoked=true;const client=this.clients.find(c=>c.sessionId===m.id);if(client){const restriction=rows.rows.find((r:any)=>r.accountId===m.accountId&&!r.allowed);client.send('message',{type:'security',code:restriction.code,restriction:restriction.restriction});void client.leave(4003);}else await this.removeMember(m);}
  }catch{}finally{this.revalidating=false;}
 }
 async onDrop(client:Client){const m=this.members.get(client.sessionId);if(m?.revoked)return;if(m){m.connected=false;delete this.inputs[m.id];this.lobby();operationalLog.warn('realtime.disconnected',{roomId:this.roomId,mode:this.mode.id});}try{await this.allowReconnection(client,this.config.network.reconnectSeconds);}catch{}}
 async onReconnect(client:Client){const m=this.members.get(client.sessionId);if(!m)return;try{await persistence.access(m.accountId,this.mode.id);}catch{m.revoked=true;void client.leave(4003);return;}m.connected=true;m.epoch++;m.lastSeq=0;m.ack=0;this.sendWorld(client,'welcome',true,{playerId:m.id,room:this.info()});this.lobby();operationalLog.info('realtime.reconnected',{roomId:this.roomId,mode:this.mode.id});}
 async removeMember(m:Member){const p=this.world.players.find((p:any)=>p.id===m.id);if(p)await this.finish(m,p,p.extracted?'extracted':p.alive?'leave':'death');this.members.delete(m.id);this.violations.delete(m.id);this.messageRates.delete(m.id);this.reporting.delete(m.id);this.pipeline.remove(m.id);removePlayer(this.world,m.id);delete this.inputs[m.id];if(m.accountId)await releaseAccount(m.accountId,`${this.roomId}:${m.id}`);this.lobby();}
 async onLeave(client:Client){const m=this.members.get(client.sessionId);if(m)await this.removeMember(m);}
 async onDispose(){await this.pipeline?.close();for(const m of [...this.members.values()])await this.removeMember(m);for(const kind of ['players','enemies','foods','projectiles'])entities.remove({mode:this.mode.id,kind,room:this.roomId});}
}
