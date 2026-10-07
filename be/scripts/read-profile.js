import {readFile} from 'node:fs/promises';
const p=JSON.parse(await readFile('artifacts/v2-authority.cpuprofile')),nodes=new Map(p.nodes.map(n=>[n.id,n])),self=new Map(),inclusive=new Map(),parent=new Map();
for(const n of p.nodes)for(const c of n.children||[])parent.set(c,n.id);
for(let i=0;i<p.samples.length;i++){let id=p.samples[i],ms=(p.timeDeltas[i]||0)/1000;self.set(id,(self.get(id)||0)+ms);while(id){inclusive.set(id,(inclusive.get(id)||0)+ms);id=parent.get(id);}}
for(const [name,data] of [['self',self],['inclusive',inclusive]])console.log(name,[...data].sort((a,b)=>b[1]-a[1]).slice(0,24).map(([id,ms])=>({ms:Math.round(ms),function:nodes.get(id).callFrame.functionName,file:nodes.get(id).callFrame.url.split('/').slice(-2).join('/'),line:nodes.get(id).callFrame.lineNumber+1})));
