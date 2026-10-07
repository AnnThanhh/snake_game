import { readFile } from 'node:fs/promises';
import { loadPolicy,loadCatalog } from './configuration.js';
import {matchingBans,publicRestriction} from './request-security.js';
export const matchesPermission=(pattern,permission)=>pattern==='*'||pattern===permission||(pattern.endsWith(':*')&&permission.startsWith(pattern.slice(0,-1)));
export function hasPermission(context,permission){return typeof permission==='string'&&!context.denied?.some(p=>matchesPermission(p,permission))&&context.permissions?.some(p=>matchesPermission(p,permission))||false;}
export function hasWhitelist(context,type,{scope='GLOBAL',value='',environment='LOCAL',now=Date.now()}={}){return context.whitelists?.some(w=>w.type===type&&w.is_active&&w.environment===environment&&Date.parse(w.starts_at)<=now&&(!w.expires_at||Date.parse(w.expires_at)>now)&&(w.scope==='GLOBAL'||w.scope===scope&&w.value===value))||false;}
// Only called by migration 002. Seeds never authorize runtime requests.
export async function seedAuthorization(db){
 const seed=JSON.parse(await readFile(new URL('./seeds/003_policy.json',import.meta.url),'utf8'));
 for(const [i,code] of Object.keys(seed.roles).entries())await db.query('INSERT INTO roles(code,name,priority) VALUES ($1,$1,$2) ON CONFLICT DO NOTHING',[code,i]);
 for(const code of seed.permissions)await db.query('INSERT INTO permissions(code) VALUES ($1) ON CONFLICT DO NOTHING',[code]);
 for(const [role,perms] of Object.entries(seed.roles))for(const code of perms)await db.query('INSERT INTO role_permissions VALUES ($1,$2) ON CONFLICT DO NOTHING',[role,code]);
 await db.query('INSERT INTO user_roles(user_id,role_code) SELECT id,$1 FROM users ON CONFLICT DO NOTHING',[seed.registration.role]);
 const catalog=JSON.parse(await readFile(new URL('./seeds/003_catalog.json',import.meta.url),'utf8'));
 for(const [key,value] of Object.entries({maintenance:false,features:Object.fromEntries([...catalog.modes.map(m=>m.id),'organ_system_v2','branching_body_v2'].map(k=>[k,true])),production_debug:false}))await db.query('INSERT INTO system_settings(key,value) VALUES ($1,$2) ON CONFLICT DO NOTHING',[key,JSON.stringify(value)]);
 for(const row of seed.inventory)await db.query('INSERT INTO inventory_definitions VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',row);
}
export function createAuthorization(store,{environment=process.env.APP_ENV||'LOCAL'}={}){
 const policy=()=>loadPolicy(store);
 async function resolve(id,{fresh=false,db=store}={}){
  if(!id)return {roles:[],permissions:[],denied:[],whitelists:[],bans:[],priority:-1};
  const key=store.key(`authz:${id}`);
  if(!fresh&&db===store){try{const cached=await store.redis.get(key);if(cached){const c=JSON.parse(cached);if(c.validUntil>Date.now())return c;}}catch{}}
  const config=await loadPolicy(db);
  const roles=(await db.query('SELECT ur.role_code,ur.expires_at,r.priority FROM user_roles ur JOIN roles r ON r.code=ur.role_code WHERE ur.user_id=$1 AND (ur.expires_at IS NULL OR ur.expires_at>now())',[id])).rows;
  const perms=(await db.query('SELECT DISTINCT rp.permission_code FROM role_permissions rp JOIN user_roles ur ON ur.role_code=rp.role_code WHERE ur.user_id=$1 AND (ur.expires_at IS NULL OR ur.expires_at>now())',[id])).rows;
  const overrides=(await db.query('SELECT permission_code,effect,expires_at FROM user_permission_overrides WHERE user_id=$1 AND (expires_at IS NULL OR expires_at>now())',[id])).rows;
  const whitelists=(await db.query('SELECT * FROM whitelist_entries WHERE user_id=$1 AND is_active AND starts_at<=now() AND (expires_at IS NULL OR expires_at>now())',[id])).rows;
  const bans=(await db.query('SELECT id,type,scope,scope_value,public_reason,expires_at FROM moderation_actions WHERE target_user_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())',[id])).rows;
  const expiries=[...roles,...overrides,...whitelists,...bans].filter(r=>r.expires_at).map(r=>new Date(r.expires_at).getTime());
  const seconds=config.security.cacheSeconds;
  const context={roles:roles.map(r=>r.role_code),priority:Math.max(-1,...roles.map(r=>r.priority)),permissions:[...new Set([...perms.map(p=>p.permission_code),...overrides.filter(p=>p.effect==='ALLOW').map(p=>p.permission_code)])],denied:overrides.filter(p=>p.effect==='DENY').map(p=>p.permission_code),whitelists,bans,validUntil:Math.min(Date.now()+seconds*1000,...expiries)};
  if(db===store)try{await store.redis.set(key,JSON.stringify(context),{EX:seconds});}catch{}
  return context;
 }
 async function invalidate(id){await store.query('DELETE FROM admin_sessions WHERE user_id=$1',[id]);await store.redis.del(store.key(`authz:${id}`));await store.redis.publish(store.key('authz:changed'),JSON.stringify({accountId:id}));}
 async function settings(){return Object.fromEntries((await store.query('SELECT key,value FROM system_settings')).rows.map(r=>[r.key,r.value]));}
 async function admission(id,mode,serverId){
  const c=await resolve(id,{fresh:true}),s=Object.fromEntries((await store.query("SELECT key,value FROM system_settings WHERE key IN ('maintenance','features','private_server','operations')")).rows.map(r=>[r.key,r.value])),p=await policy(),a=p.access,catalog=await loadCatalog(store);
  mode??=catalog.client.defaultMode;serverId??=s.operations.serverId;
  const fail=message=>{throw Object.assign(new Error(message),{status:403});};
  if(!catalog.modes.some(m=>m.id===mode))fail('Chế độ không hợp lệ.');
  if(id&&!hasPermission(c,a.joinPermission))fail('Tài khoản chưa có quyền tham gia trận.');
  const ban=matchingBans(c,p,{mode})[0];if(ban)throw Object.assign(new Error('Tài khoản đang bị hạn chế tham gia.'),{status:403,publicCode:'MATCH_RESTRICTED',restriction:publicRestriction(ban,p)});
  if(s.maintenance&&!hasWhitelist(c,a.maintenanceWhitelist,{environment}))fail('Máy chủ đang bảo trì.');
  if(s.features?.[mode]!==true&&!hasWhitelist(c,a.featureWhitelist,{scope:'FEATURE',value:mode,environment}))fail('Chế độ này chưa mở cho tài khoản của bạn.');
  if(s.private_server&&!hasWhitelist(c,a.privateWhitelist,{scope:'SERVER',value:serverId,environment}))fail('Máy chủ riêng yêu cầu whitelist.');
  return {allowed:true,mode,environment};
 }
 return {resolve,invalidate,settings,admission,environment,policy};
}
