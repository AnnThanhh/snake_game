import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir,writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.js';
import { chooseUpgrade } from '../game/engine.js';
import { applyPathFrame } from '../game/path-network.js';

const reports=[];
const seconds=12;
for(const humans of [5,10]) {
  const app=createGameServer({port:0,arenaCapacity:10});
  const {port}=await app.listen();
  const clients=[],errors=[];let room,inputTimer,fixtureTimer,measuring=false,serial=0;
  const samples=[];
  try {
    for(let i=0;i<humans;i++) {
      const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const c={ws,id:null,decoded:null,bytes:0,frames:0,full:0,delta:0,seq:0,ack:null};clients.push(c);
      ws.on('error',e=>errors.push(e.message));
      ws.on('message',raw=>{
        try {
          const m=JSON.parse(raw);if(m.type==='error')throw new Error(m.message);
          if(m.type==='welcome')c.id=m.playerId;
          if(!m.frame)return;
          c.decoded=applyPathFrame(c.decoded,m.frame);c.ack=m.ack;
          const p=c.decoded.snapshot.players.find(p=>p.id===c.id);
          assert.ok(p&&Number.isFinite(p.hp)&&p.segments.every(s=>Number.isFinite(s.x)&&Number.isFinite(s.y)));
          if(measuring){c.bytes+=raw.byteLength;c.frames++;m.frame.k==='f'?c.full++:c.delta++;}
          if(p.choices.length)ws.send(JSON.stringify({type:'upgrade',id:p.choices[0]}));
        }catch(e){errors.push(e.message);}
      });
      await once(ws,'open');ws.send(JSON.stringify({type:'arena',protocol:3,playerName:`Arena load ${i}`,viewRadius:1000}));
      for(let n=0;!c.id;n++){assert.ok(n<100,'join timeout');await delay(20);}
    }
    room=[...app.rooms.values()][0];await delay(600);
    const expected=humans===5?8:10;
    assert.equal(room.world.players.length,expected);
    room.world.time=450;
    for(const p of room.world.players) {
      while(p.segments.length<70){p.choices=['growth'];chooseUpgrade(room.world,p.id,'growth');}
      for(const id of ['fire','poison','armor']){p.choices=[id];chooseUpgrade(room.world,p.id,id);}
      p.invulnerable=1000;
    }
    function fixture() {
      const w=room.world;
      // The fixture holds body size and combat density; it is not a survival/balance test.
      for(const p of w.players)p.invulnerable=1000;
      while(w.enemies.length<180) {
        const p=w.players[serial%w.players.length],angle=serial++*2.4;
        w.enemies.push({id:`load-e-${serial}`,type:'chaser',x:Math.max(30,Math.min(2370,p.x+Math.cos(angle)*300)),y:Math.max(30,Math.min(1770,p.y+Math.sin(angle)*300)),hp:90,maxHp:90,radius:13,angle:0,slow:0,hitFlash:0,attackTimer:1,phase:1,warning:0,_contacts:Object.create(null),_poison:0,_poisonDamage:0,_poisonOwner:null,_lastHit:null,_charge:0,_chargeAngle:0,_ability:5});
      }
      while(w.projectiles.length<200) {
        const p=w.players[serial%w.players.length],angle=serial++*2.4;
        w.projectiles.push({id:`load-b-${serial}`,x:p.x+Math.cos(angle)*200,y:p.y+Math.sin(angle)*200,angle,vx:-Math.cos(angle)*185,vy:-Math.sin(angle)*185,radius:5,damage:10,owner:'fixture',team:'enemy',color:'#f4bc83',life:4});
      }
    }
    fixture();fixtureTimer=setInterval(fixture,100);
    inputTimer=setInterval(()=>{
      for(const [i,c] of clients.entries())c.ws.send(JSON.stringify({type:'input',seq:++c.seq,angle:Math.atan2(Math.sin(room.world.time*.12+i),Math.cos(room.world.time*.12+i)),throttle:0,dash:false,pulse:c.seq%250===0}));
    },50);
    await delay(2000);measuring=true;
    const start=performance.now(),worldStart=room.world.time;
    for(let i=0;i<seconds;i++){await delay(1000);samples.push({...room.telemetry});assert.deepEqual(errors,[]);}
    measuring=false;
    const elapsed=(performance.now()-start)/1000;
    for(const c of clients){assert.ok(c.full>=2&&c.delta>0&&c.ack>0);assert.equal(c.decoded.snapshot.players.find(p=>p.id===c.id).segments.length,70);}
    const payload=clients.map(c=>Number((c.bytes/elapsed/1024).toFixed(2)));
    const report={humans,bots:room.world.players.filter(p=>p.bot).length,segments:room.world.players.reduce((n,p)=>n+p.segments.length,0),enemyTarget:180,projectileTarget:200,seconds:elapsed,simulatedSeconds:room.world.time-worldStart,tickRateMean:samples.reduce((n,s)=>n+s.tickRate,0)/samples.length,tickCostWindowP95:samples.map(s=>s.tickMs).sort((a,b)=>a-b)[Math.ceil(samples.length*.95)-1],payloadKiBps:payload,snapshotHz:clients.map(c=>c.frames/elapsed),errors};
    reports.push(report);
    console.log(`PASS Arena ${report.humans} humans + ${report.bots} bots, ${report.segments} segments: ${report.tickRateMean.toFixed(2)} Hz, window p95 ${report.tickCostWindowP95} ms, ${Math.min(...payload)}–${Math.max(...payload)} KiB/s/client`);
  } finally {clearInterval(inputTimer);clearInterval(fixtureTimer);for(const c of clients)c.ws.terminate();await app.close();}
}
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/arena-load.json',import.meta.url),JSON.stringify({scope:'Protocol 3, one game process and loopback clients, 12 seconds per scenario after 2-second warmup. Includes bot AI/PvP queries, excludes browser rendering/WAN and is not a 30-player capacity claim.',reports},null,2));
