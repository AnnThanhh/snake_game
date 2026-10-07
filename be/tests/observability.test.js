import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readdir,readFile,rm,stat,writeFile,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createLogger,observeResponse,safeRecord} from '../backend/observability.js';
import {proxyHttp} from '../backend/http-proxy.js';
import {createReadiness} from '../backend/readiness.js';
import {createPersistence} from '../server/persistence.js';

async function directory(t){const dir=await mkdtemp(path.join(tmpdir(),'serpent-logs-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function listen(t,server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));return `http://127.0.0.1:${server.address().port}`;}
const capture=()=>{const rows=[];return {rows,logger:createLogger('test',{directory:null,output:line=>rows.push(JSON.parse(line))})};};

test('logs omit credentials, private paths and query strings, including arbitrary error text',()=>{
 const secret='never-log-this';
 const row=safeRecord('test','error','request.failed',{password:secret,cookie:secret,error:new Error(secret),code:secret+' ',route:'/rt/room?reconnectionToken='+secret,requestId:secret});
 assert.ok(!JSON.stringify(row).includes(secret));assert.equal(row.route,'/rt/:route');
 assert.equal(safeRecord('test','info','http.response',{route:'/admin/players/'+secret}).route,'/admin/players/:id/:action');
});

test('log files rotate with a bounded queue and survive reopening',async t=>{
 const dir=await directory(t);
 const logger=createLogger('test',{directory:dir,maxBytes:600,maxFiles:3,output:null});
 for(let i=0;i<20;i++)logger.info('test.event',{count:i});
 await logger.close();
 const files=await readdir(dir);assert.equal(files.length,3);
 for(const file of files){assert.ok((await stat(path.join(dir,file))).size<=600);for(const line of (await readFile(path.join(dir,file),'utf8')).trim().split('\n'))assert.equal(JSON.parse(line).version,1);}
 const restarted=createLogger('test',{directory:dir,maxBytes:600,maxFiles:3,output:null});restarted.info('test.restart');await restarted.close();
 assert.match(await readFile(path.join(dir,'test.jsonl'),'utf8'),/test.restart/);
 const bounded=createLogger('burst',{directory:dir,maxQueueBytes:512,output:null});
 for(let i=0;i<200;i++)bounded.info('test.burst');
 assert.ok(bounded.stats().queuedBytes<=512);assert.ok(bounded.stats().dropped>0);await bounded.close();
});

test('response logging correlates IDs, includes 4xx and observes each response once',async t=>{
 const {rows,logger}=capture();
 const base=await listen(t,http.createServer((req,res)=>{observeResponse(req,res,logger);observeResponse(req,res,logger);res.writeHead(403).end('{}');}));
 const requestId=randomUUID();const response=await fetch(base+'/api/account/login?password=private',{headers:{'x-request-id':requestId}});await response.text();
 assert.equal(response.headers.get('x-request-id'),requestId);assert.equal(rows.length,1);assert.equal(rows[0].status,403);assert.equal(rows[0].route,'/api/account/login');assert.ok(rows[0].durationMs>=0);
 const invalid=await fetch(base,{headers:{'x-request-id':'bad-id'}});await invalid.text();assert.match(invalid.headers.get('x-request-id'),/^[a-f0-9-]{36}$/);
});

test('log storage and output failures do not break requests and are counted',async t=>{
 const dir=await directory(t),blocked=path.join(dir,'not-a-directory');await writeFile(blocked,'fixture');
 const logger=createLogger('test',{directory:blocked,output:()=>{throw new Error('broken sink');}});
 logger.info('service.ready');await logger.flush();assert.ok(logger.stats().dropped>=1);assert.equal(logger.stats().failures,1);await logger.close();
});

test('HTTP proxy times out, cancels abandoned work and does not return partial JSON as success',async t=>{
 let closed=0;
 const upstream=await listen(t,http.createServer((req,res)=>{
  res.on('close',()=>closed++);
  if(req.url==='/partial'){res.writeHead(200,{'content-type':'application/json'});res.write('{');setTimeout(()=>res.destroy(),20);}
 }));
 const {logger,rows}=capture();
 const base=await listen(t,http.createServer((req,res)=>{observeResponse(req,res,logger);proxyHttp(req,res,new URL(req.url,upstream),req.headers,{timeoutMs:80});}));
 const timeout=await fetch(base+'/hang');assert.equal(timeout.status,504);await timeout.text();
 await assert.rejects(async()=>{const r=await fetch(base+'/partial');await r.text();});
 await new Promise(resolve=>{const req=http.get(base+'/cancel',res=>res.resume());req.on('error',()=>resolve());setTimeout(()=>req.destroy(),20);});
 await delay(60);assert.equal(closed,3);assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.outcome==='aborted').length,2);
});

test('readiness coalesces hung probes, returns 503 state promptly and recovers',async()=>{
 let calls=0,release;const ready=createReadiness(()=>{calls++;return new Promise(resolve=>{release=resolve;});},{timeoutMs:25,cacheMs:0});
 const states=await Promise.all(Array.from({length:30},()=>ready()));assert.ok(states.every(s=>!s.ok));assert.equal(calls,1);
 assert.equal((await ready()).ok,false);assert.equal(calls,1,'timeout must not leak additional probes');
 release(true);await delay(5);const retry=ready();await delay(1);release(true);assert.equal((await retry).ok,true);assert.equal(calls,2);
});

test('outbox failures are observable and a recovered upstream removes only acknowledged results',async t=>{
 const dir=await directory(t),lifeId=randomUUID();let healthy=false;
 await writeFile(path.join(dir,lifeId+'.json'),JSON.stringify({lifeId,startedAt:new Date(Date.now()-10000).toISOString()}));
 await utimes(path.join(dir,lifeId+'.json'),new Date(),new Date(Date.now()-10000));
 const backendUrl=await listen(t,http.createServer((req,res)=>{req.resume();res.writeHead(healthy?200:503,{'content-type':'application/json'}).end(JSON.stringify(healthy?{ok:true}:{error:'private-error-text'}));}));
 const {rows,logger}=capture(),outbox=createPersistence({backendUrl,secret:'private-token',outboxDir:dir,logger});t.after(()=>outbox.close());
 await outbox.flush();assert.equal(outbox.status().pending,1);assert.equal(outbox.status().failed,1);assert.ok(outbox.status().oldestSeconds>=10);assert.equal((await readdir(dir)).length,1);
 healthy=true;await outbox.flush();assert.equal(outbox.status().pending,0);assert.equal((await readdir(dir)).length,0);
 assert.ok(rows.some(r=>r.event==='result.retry_pending'&&r.lifeId===lifeId));assert.ok(rows.some(r=>r.event==='result.saved'));assert.ok(!JSON.stringify(rows).includes('private'));
});
