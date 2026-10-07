import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';

const base=new URL(process.env.SOAK_URL||'http://127.0.0.1:3000');
const seconds=Number(process.env.SOAK_SECONDS||3600),interval=Number(process.env.SOAK_INTERVAL_SECONDS||5);
if(!['http:','https:'].includes(base.protocol)||base.username||base.password||![seconds,interval].every(Number.isInteger)||seconds<30||seconds>86400||interval<1||interval>60)throw new Error('SOAK_SECONDS: 30..86400; interval: 1..60; HTTP(S) URL without credentials required');
const routes=['/api/live','/api/ready','/api/account/catalog','/api/rooms'];
const report={version:1,startedAt:new Date().toISOString(),seconds,interval,scope:'Read-only sequential HTTP availability probe. No gameplay, login, rewards, WAN or CCU certification.',cycles:0,requests:0,failures:0,routes:{},errors:[],stopped:false};
for(const route of routes)report.routes[route]={requests:0,failures:0,totalMs:0,maxMs:0};
const started=performance.now();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{report.stopped=true;});
await mkdir('artifacts',{recursive:true});
async function save(){await writeFile('artifacts/http-soak.json',JSON.stringify({...report,elapsedSeconds:(performance.now()-started)/1000,finishedAt:new Date().toISOString()},null,2));}
try{
 while(!report.stopped&&performance.now()-started<seconds*1000){
  const cycle=performance.now();
  for(const route of routes){
   const at=performance.now(),stats=report.routes[route];report.requests++;stats.requests++;
   try{
    const response=await fetch(new URL(route,base),{signal:AbortSignal.timeout(5000)});
    const data=await response.json();
    const valid=response.ok&&(route.endsWith('/live')||route.endsWith('/ready')?data.ok===true:route.endsWith('/catalog')?Boolean(data.catalog?.id):Array.isArray(data.rooms));
    if(!valid)throw Object.assign(new Error('invalid_response'),{status:response.status,requestId:response.headers.get('x-request-id')});
   }catch(error){report.failures++;stats.failures++;if(report.errors.length<100)report.errors.push({at:new Date().toISOString(),route,status:error.status||0,code:error.name,requestId:error.requestId||null});}
   const ms=performance.now()-at;stats.totalMs+=ms;stats.maxMs=Math.max(stats.maxMs,ms);
  }
  report.cycles++;await save();
  await delay(Math.max(0,Math.min(interval*1000-(performance.now()-cycle),seconds*1000-(performance.now()-started))));
 }
}finally{await save();}
console.log(JSON.stringify({cycles:report.cycles,requests:report.requests,failures:report.failures,stopped:report.stopped,report:'artifacts/http-soak.json'}));
if(report.failures||report.stopped)process.exitCode=1;
