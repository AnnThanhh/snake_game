import {readFile} from 'node:fs/promises';
import {schemaFromData,migrateTuning} from './configuration.js';
export async function migrateSecurity(db){
 const defaults=JSON.parse(await readFile(new URL('./seeds/009_security.json',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('./migrations/009_security.sql',import.meta.url),'utf8'));
 const security=(await db.query("SELECT value FROM authorization_policy WHERE key='security'")).rows[0].value;
 for(const [key,value] of Object.entries(defaults.security))if(security[key]===undefined)security[key]=value;
 await db.query("UPDATE authorization_policy SET value=$1 WHERE key='security'",[JSON.stringify(security)]);
 await db.query("UPDATE configuration_definitions SET schema=$1 WHERE key='policy.security'",[JSON.stringify(schemaFromData(security))]);
 await db.query("INSERT INTO authorization_policy(key,value) VALUES ('moderation',$1) ON CONFLICT DO NOTHING",[JSON.stringify(defaults.moderation)]);
 await db.query("INSERT INTO configuration_definitions(key,schema) VALUES ('policy.moderation',$1) ON CONFLICT DO NOTHING",[JSON.stringify(schemaFromData(defaults.moderation))]);
 await db.query("INSERT INTO system_settings(key,value) VALUES ('operations',$1) ON CONFLICT DO NOTHING",[JSON.stringify(defaults.operations)]);
 await db.query("INSERT INTO configuration_definitions(key,schema) VALUES ('operations',$1) ON CONFLICT DO NOTHING",[JSON.stringify(schemaFromData(defaults.operations))]);
 const endpoints=(await db.query("SELECT value FROM authorization_policy WHERE key='endpoints'")).rows[0].value;
 if(!endpoints['security:events:read'])endpoints['security:events:read']='player:report:read';
 await db.query("UPDATE authorization_policy SET value=$1 WHERE key='endpoints'",[JSON.stringify(endpoints)]);
 await db.query("UPDATE configuration_definitions SET schema=$1 WHERE key='policy.endpoints'",[JSON.stringify(schemaFromData(endpoints))]);
 await migrateTuning(db,'009_security','r4','catalog');
 const copy=JSON.parse(await readFile(new URL('./seeds/009_ui.json',import.meta.url),'utf8'));
 await db.query("INSERT INTO system_settings(key,value) VALUES ('ui',$1) ON CONFLICT DO NOTHING",[JSON.stringify(copy)]);
 await db.query("INSERT INTO configuration_definitions(key,schema) VALUES ('ui',$1) ON CONFLICT DO NOTHING",[JSON.stringify({type:'object',required:Object.keys(copy),additionalProperties:{type:'string',maxLength:4000}})]);
 await db.query("INSERT INTO system_settings(key,value) VALUES ('admin_tabs',$1) ON CONFLICT DO NOTHING",[JSON.stringify(defaults.adminTabs)]);
 await db.query("INSERT INTO configuration_definitions(key,schema) VALUES ('admin_tabs',$1) ON CONFLICT DO NOTHING",[JSON.stringify(schemaFromData(defaults.adminTabs))]);
}
