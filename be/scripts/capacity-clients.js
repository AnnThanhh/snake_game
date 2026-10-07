import WebSocket from 'ws';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {applyPathFrame} from '../game/path-network.js';
import os from 'node:os';
globalThis.WebSocket=WebSocket;
const {Client}=await import('@colyseus/sdk');
const lag=monitorEventLoopDelay({resolution:20});lag.enable();const clients=[],errors=[],acks=[];let active=false,timer,started=0,peakRss=0;
const error=e=>{if(errors.length<30)errors.push(String(e));};
process.on('message',async m=>{try{
 if(m.type==='connect'){
  const sdk=new Client('ws://127.0.0.1:'+m.port);
  for(let roomIndex=0;roomIndex<m.rooms;roomIndex++){
   let roomId;
   for(let i=0;i<m.size;i++){
    if(os.freemem()/2**20<768)throw new Error('memory_guard_during_ramp');
    const room=roomId?await sdk.joinById(roomId,{species:m.species,playerName:'Capacity'}):await sdk.create(m.name,{mode:'arena',species:m.species,playerName:'Capacity'});roomId=room.roomId;room.reconnection.enabled=false;
    const state={room,seq:0,frames:0,bytes:0,ack:0,decoded:null,sent:new Map()};clients.push(state);
    room.connection.transport.ws.addEventListener('message',e=>{if(active)state.bytes+=e.data.byteLength;});
    room.onMessage('message',data=>{try{
     if(data.type==='error'){error(data.message);return;}if(!data.frame)return;
     if(i===0)state.decoded=applyPathFrame(state.decoded,data.frame);
     if(active){state.frames++;if(state.sent.has(data.ack)&&data.ack>state.ack)acks.push(performance.now()-state.sent.get(data.ack));}
     state.ack=data.ack;for(const seq of state.sent.keys())if(seq<=data.ack)state.sent.delete(seq);
    }catch(e){error(e.message);}});
    room.onDrop(code=>{if(active)error('Dropped: '+code);});room.onLeave(code=>{if(active)error('Left: '+code);});room.onError((code,message)=>error(code+':'+message));
   }
  }
  timer=setInterval(()=>{const now=performance.now();peakRss=Math.max(peakRss,process.memoryUsage().rss);for(const [i,c] of clients.entries()){if(!c.room.connection.isOpen)continue;c.sent.set(++c.seq,now);if(c.sent.size>100)c.sent.delete(c.sent.keys().next().value);c.room.send('message',{type:'input',seq:c.seq,angle:now/8000+i,throttle:0});}},50);
  process.send({type:'connected',clients:clients.length});
 }
 if(m.type==='measure'){errors.length=0;acks.length=0;for(const c of clients){c.frames=0;c.bytes=0;}started=performance.now();lag.reset();peakRss=process.memoryUsage().rss;active=true;process.send({type:'measuring'});}
 if(m.type==='report'){active=false;const seconds=(performance.now()-started)/1000,sorted=acks.sort((a,b)=>a-b);process.send({type:'report',clients:clients.length,connected:clients.filter(c=>c.room.connection.isOpen).length,loopP95:lag.percentile(95)/1e6,ackP95:sorted[Math.floor(sorted.length*.95)]||null,rssMiB:peakRss/2**20,minSnapshotHz:Math.min(...clients.map(c=>c.frames/seconds)),maxSnapshotHz:Math.max(...clients.map(c=>c.frames/seconds)),wireMiBps:clients.reduce((n,c)=>n+c.bytes,0)/seconds/2**20,errors});}
 if(m.type==='shutdown'){active=false;clearInterval(timer);lag.disable();await Promise.allSettled(clients.filter(c=>c.room.connection.isOpen).map(c=>c.room.leave()));process.disconnect();}
}catch(e){error(e.stack);process.send({type:'failed',error:e.message});}});
