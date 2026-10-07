import 'reflect-metadata';
import {All,Controller,Get,Inject,Module,Query,Req,Res} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {FastifyAdapter,NestFastifyApplication} from '@nestjs/platform-fastify';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {createBackend} from '../../backend/index.js';
import {createResultQueue} from '../../backend/result-queue.js';
import {CatalogService} from './catalog.service.js';
import {observeResponse,operationalLog,routeName} from '../../backend/observability.js';
import {Registry,Counter,Histogram,Gauge,collectDefaultMetrics} from 'prom-client';
const registry=new Registry();
collectDefaultMetrics({register:registry,prefix:'serpent_api_'});
new Gauge({name:'serpent_log_dropped_records',help:'Operational log records dropped by the bounded writer',registers:[registry],collect(){this.set(operationalLog.stats().dropped);}});
new Gauge({name:'serpent_log_storage_failures',help:'Consecutive log storage failures',registers:[registry],collect(){this.set(operationalLog.stats().failures);}});
const requests=new Counter({name:'serpent_http_responses_total',help:'HTTP responses including parser and handler errors',labelNames:['method','route','status'],registers:[registry]});
const latency=new Histogram({name:'serpent_http_response_seconds',help:'HTTP response duration',labelNames:['method','route'],buckets:[.01,.05,.1,.3,1,3,10],registers:[registry]});
operationalLog.info('service.starting');
const queue=await createResultQueue({redisUrl:process.env.REDIS_URL!});
operationalLog.info('service.queue_ready');
const domain=await createBackend({databaseUrl:process.env.API_DATABASE_URL||process.env.DATABASE_URL,migrate:!process.env.API_DATABASE_URL,resultProcessor:payload=>queue.submit(payload),secureCookies:process.env.COOKIE_SECURE==='true'});
operationalLog.info('service.database_ready');
@Controller()
class AccountController {
 constructor(@Inject(CatalogService) private readonly catalogs:CatalogService){}
 @Get('api/account/catalog') catalog(@Query('version') version?:string){return this.catalogs.read(version);}
 @Get('metrics') async metrics(@Res() reply:FastifyReply){reply.header('Content-Type',registry.contentType).send(await registry.metrics());}
 @All(['health','livez','readyz','api/site','api/configuration','api/account/*','admin/*','internal/*'])
 async bridge(@Req() request:FastifyRequest,@Res() reply:FastifyReply){
  (request.raw as any).parsedBody=request.body;
  reply.hijack();await domain.handle(request.raw,reply.raw);
 }
}
@Module({controllers:[AccountController],providers:[CatalogService]})
class ApiModule{}
const adapter=new FastifyAdapter({bodyLimit:128*1024,trustProxy:false,requestTimeout:15000});
adapter.getInstance().addHook('onRequest',async(request,reply)=>{
 observeResponse(request.raw,reply.raw,operationalLog,{onComplete:fields=>{
  const method=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(fields.method)?fields.method:'OTHER';
  const route=routeName(fields.route);
  requests.inc({method,route,status:String(fields.status)});latency.observe({method,route},fields.durationMs/1000);
 }});
});
const app=await NestFactory.create<NestFastifyApplication>(ApiModule,adapter,{logger:['error','warn']});
await app.listen(Number(process.env.BACKEND_PORT||3001),'127.0.0.1');
const address=app.getHttpServer().address();
operationalLog.info('service.ready');process.send?.({type:'ready',port:typeof address==='object'?address?.port:undefined});
let stopping=false;async function stop(){if(stopping)return;stopping=true;await app.close();await queue.close();await domain.close();await operationalLog.close();process.exitCode=0;process.disconnect?.();}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop());process.on('message',(m:any)=>{if(m?.type==='shutdown')void stop();});
