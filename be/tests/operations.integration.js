import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createGameServer} from '../server/index.js';
import {createLogger} from '../backend/observability.js';

// Uses the existing restricted API credential and GET/parser-error requests only.
// Does not run migration, register accounts, join rooms or consume result jobs.
test('built Nest API and authority expose correlated logs, bounded readiness and metrics',{timeout:30000},async()=>{
 assert.ok(process.env.API_DATABASE_URL,'Run setup/migration before this read-only smoke test');
 const dir=await mkdtemp(path.join(tmpdir(),'serpent-operations-')),children=[];
 const logger=createLogger('gateway',{directory:dir,output:null});let gateway;
 async function launch(file,role,extra={}){
  const env={...process.env,...extra,LOG_DIR:dir,SERVICE_NAME:role,RESULT_OUTBOX_DIR:path.join(dir,'outbox')};
  delete env.DATABASE_URL;delete env.MIGRATION_DATABASE_URL;delete env.WORKER_DATABASE_URL;delete env.POSTGRES_PASSWORD;
  if(role!=='api')delete env.API_DATABASE_URL;
  const child=fork(new URL(file,import.meta.url),[],{env,execArgv:[],stdio:['ignore','ignore','pipe','ipc']});children.push(child);
  let diagnostic='';child.stderr.on('data',b=>{diagnostic=(diagnostic+b.toString()).slice(-2000);});
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Service readiness timed out: '+role+' '+diagnostic)),15000);child.once('exit',code=>{clearTimeout(timer);reject(new Error(role+' exited '+code+' '+diagnostic));});child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve(m.port);}});});
  return {child,url:`http://127.0.0.1:${port}`};
 }
 async function stop(child){
  if(child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolve=>{const timer=setTimeout(()=>child.kill(),5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.send({type:'shutdown'},()=>{});});
 }
 try{
  const api=await launch('../dist/src/api/main.js','api',{BACKEND_PORT:'0'});
  const authority=await launch('../dist/src/server/main.js','authority',{REALTIME_PORT:'0',BACKEND_URL:api.url});
  gateway=createGameServer({port:0,backendUrl:api.url,realtimeUrl:authority.url,backendSecret:process.env.GAME_SERVER_SECRET,outboxDir:path.join(dir,'gateway-outbox'),logger});
  const url=`http://127.0.0.1:${(await gateway.listen()).port}`;
  const ready=await fetch(url+'/api/ready');assert.equal(ready.status,200);assert.deepEqual(await ready.json(),{version:1,ok:true});
  const requestId=randomUUID();const response=await fetch(url+'/api/account/catalog?secret=do-not-record',{headers:{'x-request-id':requestId}});assert.equal(response.status,200);assert.equal(response.headers.get('x-request-id'),requestId);assert.ok((await response.json()).catalog.id);
  const bad=await fetch(url+'/api/account/login',{method:'POST',headers:{'content-type':'application/json'},body:'{'});assert.equal(bad.status,400);assert.match(bad.headers.get('x-request-id'),/^[a-f0-9-]{36}$/);await bad.text();
  const metrics=await (await fetch(api.url+'/metrics')).text();assert.match(metrics,/serpent_http_responses_total.*status="400"/);assert.match(metrics,/serpent_http_response_seconds/);
  assert.match(metrics,/serpent_log_dropped_records 0/);assert.match(metrics,/serpent_log_storage_failures 0/);
  for(const route of ['/metrics','/rt/metrics','/rt/readyz'])assert.equal((await fetch(url+route)).status,404);
  const authorityMetrics=await (await fetch(authority.url+'/metrics')).text();assert.match(authorityMetrics,/serpent_result_outbox_pending 0/);
  await stop(api.child);await delay(1100);
  assert.equal((await fetch(url+'/api/live')).status,200);
  const at=Date.now();assert.equal((await fetch(url+'/api/ready')).status,503);assert.ok(Date.now()-at<3500);
  await stop(authority.child);await gateway.close();gateway=null;await logger.close();
  const lines=(await Promise.all((await readdir(dir)).filter(f=>f.endsWith('.jsonl')).map(f=>readFile(path.join(dir,f),'utf8')))).join('');
  assert.ok(!lines.includes('do-not-record'));const records=lines.trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.filter(r=>r.requestId===requestId).map(r=>r.service).sort(),['api','gateway']);
  await mkdir('artifacts',{recursive:true});await import('node:fs/promises').then(fs=>fs.writeFile('artifacts/operations-smoke.json',JSON.stringify({date:new Date().toISOString(),passed:true,checks:['catalog','parser-400','request-correlation','metrics','private-metrics','readiness-outage','log-privacy'],requestId,records:records.length},null,2)));
 }finally{
  await gateway?.close();for(const child of children.reverse())await stop(child);await logger.close();await rm(dir,{recursive:true,force:true});
 }
});
