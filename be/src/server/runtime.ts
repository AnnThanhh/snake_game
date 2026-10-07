import {createClient} from 'redis';
import {createPersistence} from '../../server/persistence.js';
import path from 'node:path';
export const backendUrl=process.env.BACKEND_URL||'http://127.0.0.1:3001';
export const secret=process.env.GAME_SERVER_SECRET!;
export const redis=createClient({url:process.env.REDIS_URL,disableOfflineQueue:true});redis.on('error',()=>{});
export async function configuration(){const r=await fetch(backendUrl+'/internal/configuration',{headers:{'x-game-secret':secret},signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('Operational configuration unavailable');return r.json();}
export let runtimeConfiguration=await configuration();
const configurationTimer=setInterval(()=>void configuration().then(c=>{runtimeConfiguration=c;}).catch(()=>{}),30000);configurationTimer.unref();
export const persistence=createPersistence({backendUrl,secret,outboxDir:path.resolve(process.env.RESULT_OUTBOX_DIR||'.data/outbox-v2'),serverId:()=>runtimeConfiguration.operations.serverId});
export async function catalog(){const r=await fetch(backendUrl+'/internal/catalog',{headers:{'x-game-secret':secret},signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('Content backend unavailable');return (await r.json()).catalog;}
export const accountKey=(id:string)=>`serpent:v2-active:${id}`;
export async function releaseAccount(accountId:string,owner:string){if(!accountId)return;await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",{keys:[accountKey(accountId)],arguments:[owner]});}
