import {createReadStream} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--request-id' || !/^[a-f0-9-]{36}$/i.test(args[1])))throw new Error('Usage: npm run ops:logs [-- --request-id UUID]');
const directory=path.resolve(process.env.LOG_DIR||fileURLToPath(new URL('../.data/logs',import.meta.url)));
const files=(await readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(name=>/^[a-zA-Z0-9_.:-]+\.jsonl(?:\.\d+)?$/.test(name));
const summary={files:files.length,records:0,malformed:0,services:{},events:{},http:{responses:0,statuses:{},meanMs:0,maxMs:0},first:null,last:null};
let totalMs=0;const matches=[];
for(const name of files){
 const lines=createInterface({input:createReadStream(path.join(directory,name)),crlfDelay:Infinity});
 for await(const line of lines){
  let row;try{row=JSON.parse(line);if(row.version!==1)throw new Error();}catch{summary.malformed++;continue;}
  if(args.length){if(row.requestId===args[1]){matches.push(row);if(matches.length>1000)matches.shift();}continue;}
  summary.records++;summary.services[row.service]=(summary.services[row.service]||0)+1;summary.events[row.event]=(summary.events[row.event]||0)+1;
  if(!summary.first||row.time<summary.first)summary.first=row.time;if(!summary.last||row.time>summary.last)summary.last=row.time;
  if(row.event==='http.response'){summary.http.responses++;summary.http.statuses[row.status]=(summary.http.statuses[row.status]||0)+1;totalMs+=row.durationMs||0;summary.http.maxMs=Math.max(summary.http.maxMs,row.durationMs||0);}
 }
}
summary.http.meanMs=summary.http.responses?Math.round(totalMs/summary.http.responses*100)/100:0;
console.log(JSON.stringify(args.length?matches.sort((a,b)=>a.time.localeCompare(b.time)):summary,null,2));
