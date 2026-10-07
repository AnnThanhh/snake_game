import { mkdir,open,rename,readdir,readFile,unlink,stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { CONTENT_VERSION } from '../game/version.js';
import {operationalLog} from '../backend/observability.js';

export function createPersistence({backendUrl,secret,outboxDir,serverId,logger=operationalLog}) {
  let flushing=null;
  let status={pending:0,failed:0,saved:0,oldestSeconds:0};
  const writes=new Set();
  const directory=path.resolve(outboxDir);
  const ready=(async()=>{
    await mkdir(directory,{recursive:true});
    // Recover a complete, synced file if the process stopped before its rename.
    for(const file of await readdir(directory)) {
      if(!/^[a-f0-9-]{36}\.json\.pending$/.test(file))continue;
      const filename=path.join(directory,file);
      try {const data=JSON.parse(await readFile(filename,'utf8'));if(`${data.lifeId}.json.pending`===file)await rename(filename,filename.slice(0,-8));}catch{}
    }
  })();
  async function internal(route,body) {
    const response=await fetch(`${backendUrl}/internal/${route}`,{method:'POST',headers:{'Content-Type':'application/json','x-game-secret':secret},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error||'Backend unavailable'),{status:response.status,code:data.code,restriction:data.restriction});
    return data;
  }
  function flush() {
    if(flushing)return flushing;
    flushing=(async()=>{
      await ready;
      const next={pending:0,failed:0,saved:0,oldestSeconds:0};
      for(const file of await readdir(directory)) {
        if(!/^[a-f0-9-]{36}\.json$/.test(file))continue;
        next.pending++;
        let data;
        const filename=path.join(directory,file);
        try {
          data=JSON.parse(await readFile(filename,'utf8'));
          await internal('results',data);
          await unlink(filename);
          next.pending--;next.saved++;
          logger.info('result.saved',{lifeId:data.lifeId});
        } catch(error) {
          next.failed++;
          const age=await stat(filename).then(s=>(Date.now()-s.mtimeMs)/1000,()=>0);
          if(Number.isFinite(age))next.oldestSeconds=Math.max(next.oldestSeconds,age,0);
          logger.warn('result.retry_pending',{lifeId:data?.lifeId,status:error.status,code:error.code||error.name});
        }
      }
      status=next;
      if(next.failed)logger.warn('outbox.backlog',next);
    })().catch(error=>{logger.error('outbox.scan_failed',{code:error.code||error.name});}).finally(()=>{flushing=null;});
    return flushing;
  }
  function newLife(player) {player.lifeId=randomUUID();player._lifeStartedAt=new Date().toISOString();player._saved=false;}
  async function finish(room,member,player,reason) {
    if(!member.accountId||player.bot||player._saved||room.state==='lobby')return;
    player._saved=true;
    const result={lifeId:player.lifeId,matchId:room.id,accountId:member.accountId,serverId:serverId?.(),mode:room.world.mode,bot:false,contentVersion:CONTENT_VERSION.id,species:player.species,reason,duration:Math.max(0,room.world.time-player.lifeStarted),score:player.score,kills:player.kills,pvpKills:player.pvpKills,level:player.level,maxLength:player.maxLength,damage:player._damage,bossDamage:player._bossDamage,xp:player._xpEarned,startedAt:player._lifeStartedAt,build:player.upgradeRolls.map(r=>({...r})),segments:player.segments.map(s=>s.type),traits:[...player.traitDiscoveries]};
    if(room.world._catalog){result.contentVersion=room.world._catalog.id;Object.assign(result,{keystones:player.keystones,curses:player.curses,organs:player.organs,evolutions:player.evolutions,mutations:player.mutations,hybrids:player.hybrids,temporaryLoot:player.temporaryLoot,extracted:player.extracted,objectives:player.objectives,apexKills:player.apexKills||0});if(player.extracted)result.reason='extracted';}
    const writing=(async()=>{try {
      await ready;
      const filename=path.join(directory,`${player.lifeId}.json`);
      const temporary=`${filename}.pending`;
      const file=await open(temporary,'w');
      try {await file.writeFile(JSON.stringify(result));await file.sync();}finally{await file.close();}
      await rename(temporary,filename);
      void flush();
    } catch(error) {
      if(error.code!=='EEXIST'){player._saved=false;logger.error('outbox.write_failed',{lifeId:player.lifeId,code:error.code||error.name});}
    }})();
    writes.add(writing);
    try {await writing;}finally{writes.delete(writing);}
  }
  const timer=setInterval(flush,3000);timer.unref();void flush();
  return {newLife,finish,status:()=>({...status}),report:body=>internal('reports',body),recordEvent:body=>internal('security/events',body),consume:(ticket,mode)=>internal('tickets/consume',{ticket,mode}),access:(accountId,mode)=>internal('admission',{accountId,mode}),revalidate:players=>internal('revalidate',{players}),flush,async close(){clearInterval(timer);await Promise.all(writes);await flush();}};
}
