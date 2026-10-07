import {Worker} from 'node:worker_threads';
type Lane={worker:Worker,busy:boolean,critical:any[],latest:any};
export class SnapshotPipeline {
 lanes:Lane[]=[];closed=false;cursor=0;assignments=new Map<string,number>();
 constructor(config:any,deliver:(value:any)=>void,failed:(error:Error)=>void){
  for(let i=0;i<Math.max(1,Math.min(4,config.network.snapshotWorkers||2));i++){
   const worker=new Worker(new URL('./snapshot-worker.js',import.meta.url),{workerData:{network:config.network},execArgv:[]});
   const lane:Lane={worker,busy:false,critical:[],latest:null};this.lanes.push(lane);
   worker.on('message',value=>{if(this.closed)return;deliver(value);lane.busy=false;const next=lane.critical.shift()||lane.latest;if(next===lane.latest)lane.latest=null;if(next)this.dispatch(lane,next);});
   worker.on('error',failed);
  }
 }
 dispatch(lane:Lane,job:any){lane.busy=true;lane.worker.postMessage(job);}
 send(snapshot:any,viewers:any[],telemetry:any,critical=false){
  if(this.closed)return;const groups=this.lanes.map(()=>[] as any[]);
  for(const v of viewers){if(!this.assignments.has(v.id))this.assignments.set(v.id,this.cursor++%this.lanes.length);groups[this.assignments.get(v.id)!].push(v);}
  groups.forEach((list,i)=>{if(!list.length)return;const lane=this.lanes[i],job={snapshot,viewers:list,telemetry};if(!lane.busy)this.dispatch(lane,job);else if(critical)lane.critical.push(job);else lane.latest=job;});
 }
 remove(id:string){const lane=this.lanes[this.assignments.get(id)!];this.assignments.delete(id);lane?.worker.postMessage({remove:id});}
 async close(){this.closed=true;await Promise.all(this.lanes.map(l=>l.worker.terminate()));this.lanes=[];this.assignments.clear();}
}
