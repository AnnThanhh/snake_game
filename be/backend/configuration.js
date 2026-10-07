import { readFile } from 'node:fs/promises';
export async function seedConfiguration(db) {
 const policy=JSON.parse(await readFile(new URL('./seeds/003_policy.json',import.meta.url),'utf8'));
 const catalog=JSON.parse(await readFile(new URL('./seeds/003_catalog.json',import.meta.url),'utf8'));
 const legacy=JSON.parse(await readFile(new URL('./seeds/003_legacy_catalog.json',import.meta.url),'utf8'));
 await db.query('INSERT INTO content_versions(id,game_version,balance_version,upgrade_pool,manifest) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[legacy.id,legacy.game,legacy.balance,legacy.upgrades,JSON.stringify(legacy.rewards)]);
 await db.query('INSERT INTO game_catalogs(id,data,published) VALUES ($1,$2,true)',[legacy.id,JSON.stringify(legacy)]);
 for(const p of policy.permissions)await db.query('INSERT INTO permissions(code) VALUES ($1) ON CONFLICT DO NOTHING',[p]);
 // Only add panel access; preserve mappings previously changed by an operator.
 for(const [role,perms] of Object.entries(policy.roles))if(perms.includes('admin:panel:access'))await db.query("INSERT INTO role_permissions VALUES ($1,'admin:panel:access') ON CONFLICT DO NOTHING",[role]);
 for(const [key,value] of Object.entries(policy).filter(([key])=>!['roles','permissions','settings','environments','whitelistTypes','scopes'].includes(key)))await db.query('INSERT INTO authorization_policy VALUES ($1,$2)',[key,JSON.stringify(value)]);
 for(const [key,schema] of Object.entries(policy.settings))await db.query('INSERT INTO configuration_definitions(key,schema) VALUES ($1,$2)',[key,JSON.stringify(schema)]);
 for(const key of ['caps','security','registration','commands','access','endpoints'])await db.query('INSERT INTO configuration_definitions(key,schema) VALUES ($1,$2)',['policy.'+key,JSON.stringify(schemaFromData(policy[key]))]);
 await db.query('INSERT INTO configuration_definitions(key,schema) VALUES ($1,$2)',['catalog',JSON.stringify(schemaFromData(catalog))]);
 for(const [table,values] of [['whitelist_types',policy.whitelistTypes],['whitelist_scopes',policy.scopes],['environments',policy.environments]])for(const value of values)await db.query(`INSERT INTO ${table} VALUES ($1)`,[value]);
 await db.query('INSERT INTO content_versions(id,game_version,balance_version,upgrade_pool,manifest) VALUES ($1,$2,$3,$4,$5)',[catalog.id,catalog.game,catalog.id,catalog.upgrades,JSON.stringify(catalog.rewards)]);
 await db.query('INSERT INTO game_catalogs VALUES ($1,$2,true)',[catalog.id,JSON.stringify(catalog)]);
 await db.query('INSERT INTO runtime_configuration(catalog_id) VALUES ($1)',[catalog.id]);
 const season=catalog.season;await db.query('INSERT INTO seasons VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[season.id,season.name,season.startsAt,season.endsAt]);
}
export function schemaFromData(value){
 if(Array.isArray(value))return {type:'array',maxItems:1000,items:value.length?schemaFromData(value[0]):{type:'string'}};
 if(value&&typeof value==='object')return {type:'object',additionalProperties:false,required:Object.keys(value),properties:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,schemaFromData(v)]))};
 if(typeof value==='number')return {type:Number.isInteger(value)?'integer':'number',minimum:0,maximum:10000000};
 return {type:typeof value,maxLength:2000};
}
export async function migrateTuning(db,file='005_tuning',suffix='r1',section){
 const source=JSON.parse(await readFile(new URL(`./seeds/${file}.json`,import.meta.url),'utf8')),defaults=section?source[section]:source;
 const prior=await loadCatalog(db);
 // Publish a new immutable revision. Preserve operator edits and every existing version.
 const merge=(base,extra)=>{for(const [k,v] of Object.entries(extra)){if(base[k]===undefined)base[k]=structuredClone(v);else if(v&&typeof v==='object'&&!Array.isArray(v))merge(base[k],v);}return base;};
 const catalog=merge(structuredClone(prior),defaults);catalog.id=prior.id+'-'+suffix;
 await db.query('INSERT INTO content_versions(id,game_version,balance_version,upgrade_pool,manifest) VALUES ($1,$2,$3,$4,$5)',[catalog.id,catalog.game,catalog.id,catalog.upgrades,JSON.stringify(catalog.rewards)]);
 await db.query('INSERT INTO game_catalogs(id,data,published) VALUES ($1,$2,true)',[catalog.id,JSON.stringify(catalog)]);
 await db.query('UPDATE runtime_configuration SET catalog_id=$1',[catalog.id]);
 await db.query("UPDATE configuration_definitions SET schema=$1 WHERE key='catalog'",[JSON.stringify(schemaFromData(catalog))]);
}
export function validateConfiguration(value,schema) {
 if(!schema||typeof schema!=='object')return false;
 if(schema.enum&&!schema.enum.includes(value))return false;
 if(schema.type==='boolean')return typeof value==='boolean';
 if(schema.type==='number'||schema.type==='integer')return Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&(schema.minimum===undefined||value>=schema.minimum)&&(schema.maximum===undefined||value<=schema.maximum);
 if(schema.type==='string')return typeof value==='string'&&value.length<=(schema.maxLength??1000);
 if(schema.type==='array')return Array.isArray(value)&&value.length<=(schema.maxItems??100)&&value.every(v=>validateConfiguration(v,schema.items));
 if(schema.type==='object')return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(schema.required||[]).every(k=>Object.hasOwn(value,k))&&Object.entries(value).every(([k,v])=>!['__proto__','constructor','prototype'].includes(k)&&(schema.properties&&Object.hasOwn(schema.properties,k)?validateConfiguration(v,schema.properties[k]):typeof schema.additionalProperties==='object'?validateConfiguration(v,schema.additionalProperties):schema.additionalProperties===true));
 return false;
}
export async function loadPolicy(db){return Object.fromEntries((await db.query('SELECT key,value FROM authorization_policy')).rows.map(r=>[r.key,r.value]));}
export async function loadCatalog(db,id) {
 const result=id?await db.query('SELECT data FROM game_catalogs WHERE id=$1 AND published',[id]):await db.query('SELECT c.data FROM game_catalogs c JOIN runtime_configuration r ON r.catalog_id=c.id WHERE c.published');
 if(!result.rowCount)throw Object.assign(new Error('Chưa có phiên bản nội dung được phát hành.'),{status:503});
 return result.rows[0].data;
}
