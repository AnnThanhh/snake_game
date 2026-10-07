import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createFrontend} from '../scripts/serve.js';
import {createLogger,safeRecord} from '../scripts/observability.js';

async function fixture(t,handler,options={}){
 const upstream=http.createServer(handler),sockets=new Set();upstream.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const rows=[],logger=createLogger('frontend',{directory:null,output:line=>rows.push(JSON.parse(line))});
 const app=createFrontend({port:0,backend:`http://127.0.0.1:${upstream.address().port}`,logger,...options});const address=await app.listen();
 t.after(async()=>{await app.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();});});
 return {app,upstream,rows,url:`http://127.0.0.1:${address.port}`};
}

test('frontend assigns a correlation ID, strips identity and logs response metadata without secrets',async t=>{
 let received;
 const {url,rows}=await fixture(t,(req,res)=>{received=req.headers;res.writeHead(401,{'content-type':'application/json','x-request-id':'untrusted-upstream'}).end('{"error":"private-response"}');});
 const forged=randomUUID(),r=await fetch(url+'/api/account/login?token=private-query',{headers:{'x-request-id':forged,'x-game-secret':'private-secret',cookie:'private-cookie'}});
 assert.equal(r.status,401);await r.text();const id=r.headers.get('x-request-id');assert.notEqual(id,forged);assert.equal(received['x-request-id'],id);assert.equal(received['x-game-secret'],undefined);
 assert.equal(rows.length,1);assert.equal(rows[0].requestId,id);assert.equal(rows[0].route,'/api/account/login');assert.ok(!JSON.stringify(rows).includes('private'));
 const record=safeRecord('frontend','warn','http.response',{route:'/rt/process/room?reconnectionToken=private',cookie:'private',response:{secret:'private'}});assert.ok(!JSON.stringify(record).includes('private'));
});

test('frontend returns 504 for stalled backend and records truncated responses as aborted',async t=>{
 const {url,rows}=await fixture(t,(req,res)=>{if(req.url==='/api/partial'){res.writeHead(200);res.write('{');setTimeout(()=>res.destroy(),20);}},{proxyTimeoutMs:150});
 const r=await fetch(url+'/api/stall');assert.equal(r.status,504);assert.equal((await r.json()).requestId,r.headers.get('x-request-id'));
 await assert.rejects(async()=>{const partial=await fetch(url+'/api/partial');await partial.text();});
 assert.ok(rows.some(r=>r.status===504));
 await new Promise(resolve=>setTimeout(resolve,20));assert.ok(rows.some(r=>r.outcome==='aborted'));
});

test('frontend shutdown closes upgraded sockets within a bounded deadline',{timeout:5000},async t=>{
 const {app,upstream,url}=await fixture(t,(_req,res)=>res.end());
 upstream.on('upgrade',(_req,socket)=>{socket.on('error',()=>{});socket.resume();socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');});
 const socket=net.connect(Number(new URL(url).port),'127.0.0.1');socket.on('error',()=>{});await once(socket,'connect');
 const data=once(socket,'data');socket.write('GET /rt/test HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');assert.match(String((await data)[0]),/101/);
 const closed=once(socket,'close'),started=Date.now();await app.close();await closed;assert.ok(Date.now()-started<2500);
});
