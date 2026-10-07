import { fork,spawn } from 'node:child_process';
import {readFile} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const children=[];
process.env.LOG_DIR ||= fileURLToPath(new URL('../.data/logs',import.meta.url));
let stopping=false;
async function stop(code=0) {
  if(stopping)return;
  stopping=true;
  // Let the game write and submit its last results before closing the backend.
  for(const child of [...children].reverse()) {
    if(child.exitCode!==null||child.signalCode!==null)continue;
    await new Promise(resolve=>{
      const timer=setTimeout(()=>{child.kill();resolve();},10000);
      child.once('exit',()=>{clearTimeout(timer);resolve();});
      if(child.connected)child.send({type:'shutdown'},()=>{});else child.kill();
    });
  }
  process.exitCode=code;
}
function launch(file,role) {
  const env={...process.env};
  env.SERVICE_NAME=role||'authority';
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','API_DATABASE_URL','WORKER_DATABASE_URL','POSTGRES_PASSWORD'])delete env[key];
  if(role==='api')env.API_DATABASE_URL=process.env.API_DATABASE_URL;
  if(role==='worker'){env.WORKER_DATABASE_URL=process.env.WORKER_DATABASE_URL;delete env.GAME_SERVER_SECRET;}
  const child=fork(fileURLToPath(new URL(file,import.meta.url)),[],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,execArgv:[],stdio:['inherit','inherit','inherit','ipc']});
  children.push(child);
  child.ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`Service did not become ready: ${file}`)),20000);
    child.once('exit',()=>{clearTimeout(timer);reject(new Error(`Service exited during startup: ${file}`));});
    child.on('message',message=>{if(message?.type==='ready'){clearTimeout(timer);resolve();}});
  });
  child.on('error',error=>{console.error(error.message);void stop(1);});
  child.on('exit',code=>{if(!stopping)void stop(code||1);});
  return child;
}
async function ready(url,child) {
  await child.ready;
  if(!(await fetch(url,{signal:AbortSignal.timeout(2000)})).ok)throw new Error(`Service health check failed: ${url}`);
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop());
process.on('message',message=>{if(message?.type==='shutdown')void stop();});
try {
  if(!process.env.DATABASE_URL||!process.env.REDIS_URL||!process.env.GAME_SERVER_SECRET)
    throw new Error('Run npm run setup, then npm run infra:up before npm start.');
  process.env.BACKEND_URL ||= `http://127.0.0.1:${process.env.BACKEND_PORT||3001}`;
  await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['scripts/migrate.js'],{env:process.env,stdio:'inherit'});p.once('error',reject);p.once('exit',code=>code?reject(new Error('Migration failed')):resolve());});
  const env=await readFile(new URL('../.env',import.meta.url),'utf8');for(const line of env.split(/\r?\n/)){const match=line.match(/^(API_DATABASE_URL|WORKER_DATABASE_URL)=(.+)$/);if(match)process.env[match[1]]=match[2];}
  const worker=launch('../dist/src/worker/main.js','worker');await worker.ready;
  const backend=launch('../dist/src/api/main.js','api');
  await ready(`${process.env.BACKEND_URL}/health`,backend);
  process.env.REALTIME_URL ||= `http://127.0.0.1:${process.env.REALTIME_PORT||3002}`;
  const realtime=launch('../dist/src/server/main.js');await ready(`${process.env.REALTIME_URL}/health`,realtime);
  const game=launch('../server/index.js','gateway');
  const url=`http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3000}`;
  await ready(`${url}/api/health`,game);
  console.log(`Backend ready: ${url} — Colyseus, Nest/Fastify, PostgreSQL and BullMQ. Ctrl+C to stop.`);
} catch(error) {console.error(`Startup failed: ${error.message}`);await stop(1);}
