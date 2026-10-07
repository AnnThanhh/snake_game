import {Injectable,OnModuleDestroy,ServiceUnavailableException} from '@nestjs/common';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../../generated/prisma/client.js';
@Injectable()
export class CatalogService implements OnModuleDestroy {
 private readonly db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.API_DATABASE_URL||process.env.DATABASE_URL})});
 async read(version?:string){
  const active=version||((await this.db.runtimeConfiguration.findUnique({where:{id:true}}))?.catalogId);
  if(!active)throw new ServiceUnavailableException('Chưa phát hành nội dung.');
  const row=await this.db.gameCatalog.findUnique({where:{id:active}});
  if(!row?.published)throw new ServiceUnavailableException('Phiên bản chưa phát hành.');
  return {catalog:row.data};
 }
 async onModuleDestroy(){await this.db.$disconnect();}
}
