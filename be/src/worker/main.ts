import {createStore} from '../../backend/store.js';
import {createResultWorker} from '../../backend/result-queue.js';
import {operationalLog} from '../../backend/observability.js';
const store=await createStore({databaseUrl:process.env.WORKER_DATABASE_URL||process.env.DATABASE_URL,redisUrl:process.env.REDIS_URL,migrate:!process.env.WORKER_DATABASE_URL});
const worker=await createResultWorker({store,redisUrl:process.env.REDIS_URL!});
operationalLog.info('service.ready');process.send?.({type:'ready'});
let stopping=false;async function stop(){if(stopping)return;stopping=true;await worker.close();await store.close();await operationalLog.close();process.exitCode=0;process.disconnect?.();}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop());process.on('message',(m:any)=>{if(m?.type==='shutdown')void stop();});
