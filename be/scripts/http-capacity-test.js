// Read-only public HTTP burst through the deployed gateway or frontend proxy.
// This measures request bursts, not concurrent gameplay users.
import {performance} from 'node:perf_hooks';
import {writeFile,mkdir} from 'node:fs/promises';
const base=process.env.CAPACITY_HTTP_URL||'http://127.0.0.1:3000',requests=80,concurrency=10;
const probeMutations=process.env.CAPACITY_PROBE_MUTATIONS==='1';
const report={date:new Date().toISOString(),base,requests,concurrency,scope:'Anonymous HTTP burst; optional invalid-login validation probe consumes rate-limit quota but creates no account/session. No reward queue or WAN throughput proof.',results:[]};
for(const route of ['/api/site','/api/account/catalog',...(probeMutations?['/api/account/login']:[])]){
 const mutation=route.endsWith('/login'),expected=mutation?400:200;
 const statuses={},times=[];let next=0,bytes=0;const started=performance.now();
 await Promise.all(Array.from({length:concurrency},async()=>{while(next++<requests){const at=performance.now();try{const r=await fetch(new URL(route,base),{signal:AbortSignal.timeout(10000),...(mutation?{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}:{})});bytes+=(await r.arrayBuffer()).byteLength;statuses[r.status]=(statuses[r.status]||0)+1;}catch{statuses.networkError=(statuses.networkError||0)+1;}times.push(performance.now()-at);}}));
 times.sort((a,b)=>a-b);const seconds=(performance.now()-started)/1000;report.results.push({route,expected,statuses,seconds,p95Ms:times[Math.floor(times.length*.95)],decodedBytes:bytes,allPassed:statuses[expected]===requests});
}
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/capacity-http.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
