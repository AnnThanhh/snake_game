import {Queue,QueueEvents,Worker} from 'bullmq';
import {randomUUID} from 'node:crypto';
import {saveResult} from './store.js';
import {operationalLog} from './observability.js';
export function redisConnection(url){const u=new URL(url);return {host:u.hostname,port:Number(u.port||6379),username:u.username?decodeURIComponent(u.username):undefined,password:u.password?decodeURIComponent(u.password):undefined,db:Number(u.pathname.slice(1)||0),...(u.protocol==='rediss:'?{tls:{}}:{}),maxRetriesPerRequest:null};}
export async function createResultQueue({redisUrl,prefix='serpent-v2'}){
 const connection=redisConnection(redisUrl),queue=new Queue('match-results',{connection:{...connection,maxRetriesPerRequest:1},prefix});
 const events=new QueueEvents('match-results',{connection,prefix});queue.on('error',error=>operationalLog.error('queue.error',{code:error.code||error.name}));events.on('error',error=>operationalLog.error('queue.events_error',{code:error.code||error.name}));
 await Promise.all([queue.waitUntilReady(),events.waitUntilReady()]);
 return {queue,async submit(payload){
  // SQL life_id and payload_hash are the durable idempotency boundary, including after Redis cleanup.
  const job=await queue.add('save',payload,{jobId:randomUUID(),attempts:12,backoff:{type:'exponential',delay:1000},removeOnComplete:{age:3600,count:10000},removeOnFail:{age:604800,count:10000}});
  const result=await job.waitUntilFinished(events,4000);
  if(result?.error)throw Object.assign(new Error(result.error),{status:result.status});return result;
 },async close(){await events.close();await queue.close();}};
}
export async function createResultWorker({store,redisUrl,prefix='serpent-v2'}){
 const worker=new Worker('match-results',async job=>{try{return await saveResult(store,job.data);}catch(error){if(error.status&&error.status<500)return {error:error.message,status:error.status};throw error;}},{connection:redisConnection(redisUrl),prefix,concurrency:4});
 worker.on('error',error=>operationalLog.error('worker.error',{code:error.code||error.name}));
 worker.on('failed',(job,error)=>operationalLog.error('worker.job_failed',{lifeId:job?.data?.lifeId,attempt:job?.attemptsMade,code:error.code||error.name}));
 worker.on('completed',(job,result)=>operationalLog[result?.error?'warn':'info'](result?.error?'worker.result_rejected':'worker.result_saved',{lifeId:job.data?.lifeId,status:result?.status}));
 await worker.waitUntilReady();return worker;
}
