import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { createBackend } from '../backend/index.js';

// Restart only the two services in this project's Compose file; never remove volumes.
const run=promisify(execFile);
const schema=`restart_${randomBytes(8).toString('hex')}`;
const admin=new Pool({connectionString:process.env.DATABASE_URL});
admin.on('error',()=>{});
await admin.query(`CREATE SCHEMA ${schema}`);
let app;
try {
  app=await createBackend({port:0,schema,namespace:schema});
  const base=`http://127.0.0.1:${(await app.listen()).port}`;
  const registered=await fetch(`${base}/api/account/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'restart_probe',password:randomBytes(24).toString('hex'),displayName:'Restart probe'})});
  assert.equal(registered.status,201);
  const id=(await registered.json()).profile.id,cookie=registered.headers.get('set-cookie').split(';')[0];
  await app.store.redis.set(app.store.key('volume-probe'),'retained',{EX:120});
  console.log('Restarting this project’s PostgreSQL and Redis containers without deleting volumes…');
  await run('docker',['compose','restart'],{windowsHide:true});
  await run('docker',['compose','up','-d','--wait'],{windowsHide:true});
  for(let n=0;n<60;n++){
    try{if((await fetch(`${base}/health`)).ok)break;}catch{}
    if(n===59)throw new Error('Backend did not reconnect after Docker restart');await delay(250);
  }
  const me=await fetch(`${base}/api/account/me`,{headers:{Cookie:cookie}});
  assert.equal((await me.json()).profile.id,id);
  assert.equal(await app.store.redis.get(app.store.key('volume-probe')),'retained');
  console.log('PASS actual Docker restart retains account/session and Redis AOF data; the running backend reconnects.');
} finally {
  if(app){for await(const keys of app.store.redis.scanIterator({MATCH:`${schema}:*`,COUNT:100}))if(keys.length)await app.store.redis.del(keys);await app.close();}
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
}
