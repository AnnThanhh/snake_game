import './fixtures/configure.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {signedPeerHeaders,authenticatedPeer,publicPeer,matchesIp,safeRequestTarget,stripProxyIdentity} from '../backend/request-security.js';
import {validateConfiguration} from '../backend/configuration.js';
import {validMessage} from '../server/message-validation.js';
test('proxy identity requires a fresh signature bound to method, path and IP',()=>{
 const secret='test-secret',req={method:'POST',url:'/api/account/reports',socket:{remoteAddress:'127.0.0.1'},headers:signedPeerHeaders(secret,'203.0.113.4','POST','/api/account/reports')};
 assert.equal(authenticatedPeer(req,secret),'203.0.113.4');assert.equal(authenticatedPeer({...req,url:'/admin/settings'},secret),'127.0.0.1');assert.equal(authenticatedPeer(req,'wrong'),'127.0.0.1');assert.equal(authenticatedPeer(req,secret,Date.now()+31000),'127.0.0.1');
 assert.equal(publicPeer({socket:{remoteAddress:'203.0.113.9'},headers:{'x-serpent-client-ip':'1.2.3.4'}},{security:{trustedProxyAddresses:['127.0.0.1']}}),'203.0.113.9');
 assert.deepEqual(stripProxyIdentity({'x-game-secret':'secret','x-serpent-client-ip':'spoof','x-forwarded-for':'spoof',cookie:'session'}),{cookie:'session'});
});
test('IP allowlists support bounded CIDR; request targets cannot switch proxy authority',()=>{
 assert.ok(matchesIp('192.168.1.12','192.168.1.0/24'));assert.ok(matchesIp('::1','::1/128'));assert.ok(!matchesIp('192.168.2.1','192.168.1.0/24'));assert.ok(!matchesIp('1.2.3.4','0.0.0.0/99'));
 for(const target of ['http://evil/api/x','//evil/rt','/\\evil','/api/ x'])assert.equal(safeRequestTarget(target),false);assert.ok(safeRequestTarget('/api/site?x=1'));
});
test('messages reject authority fields, unexpected keys and malformed values; stale sequences remain valid protocol',()=>{
 const input={type:'input',seq:1,angle:0,throttle:0,dash:false};assert.ok(validMessage(input));for(const body of [{...input,x:999},{...input,hp:999},{...input,angle:NaN},{...input,seq:Infinity},{...input,dash:'true'},{type:'__proto__'},[],{type:'report',reason:'x'}])assert.ok(!validMessage(body));assert.ok(validMessage({...input,seq:1}));
 assert.ok(!validateConfiguration(JSON.parse('{"__proto__":{"polluted":true}}'),{type:'object',additionalProperties:true}));assert.equal({}.polluted,undefined);
});
