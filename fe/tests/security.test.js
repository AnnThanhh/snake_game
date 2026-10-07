import './fixtures/configure.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createFrontend} from '../scripts/serve.js';
import {safeRequestTarget,proxyHeaders,securityHeaders} from '../scripts/request-security.js';
test('frontend rejects absolute-form SSRF and overwrites spoofed proxy identity',async t=>{
 let reached=0;const backend=http.createServer((req,res)=>{reached++;res.end(JSON.stringify(req.headers));});await new Promise(r=>backend.listen(0,'127.0.0.1',r));
 const app=createFrontend({port:0,backend:`http://127.0.0.1:${backend.address().port}`});const address=await app.listen();t.after(async()=>{await app.close();await new Promise(r=>backend.close(r));});
 const request=path=>new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port:address.port,path,headers:{'x-serpent-client-ip':'203.0.113.99','x-game-secret':'spoof','x-forwarded-for':'spoof'}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));});r.on('error',reject);r.end();});
 for(const path of ['http://example.invalid/api/site','//example.invalid/api/site','/\\example.invalid/api/site'])assert.equal((await request(path)).status,400);assert.equal(reached,0);
 const result=await request('/api/site'),headers=JSON.parse(result.body);assert.equal(headers['x-serpent-client-ip'],'127.0.0.1');assert.equal(headers['x-game-secret'],undefined);assert.equal(headers['x-forwarded-for'],undefined);assert.match(result.headers['content-security-policy'],/object-src 'none'/);
 assert.ok(!safeRequestTarget('/rt/\\evil'));assert.equal(proxyHeaders({headers:{forwarded:'fake'},socket:{remoteAddress:'::1'}}).forwarded,undefined);assert.match(securityHeaders['Content-Security-Policy'],/script-src 'self'/);
});
