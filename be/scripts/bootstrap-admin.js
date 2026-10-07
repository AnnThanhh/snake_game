import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createStore,digest} from '../backend/store.js';
import {loadPolicy} from '../backend/configuration.js';
const {values}=parseArgs({options:{username:{type:'string'},reason:{type:'string'}}});
if(!values.username||!values.reason||values.reason.trim().length<8)throw new Error('Usage: npm run admin:bootstrap -- --username existing_account --reason "Reason for local bootstrap"');
const store=await createStore({databaseUrl:process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL,redisUrl:process.env.REDIS_URL,migrate:false});
try{
 const policy=await loadPolicy(store),environment=process.env.APP_ENV||'LOCAL';
 await store.transaction(async db=>{
  const user=(await db.query("SELECT id FROM users WHERE username=$1 AND status='active' FOR UPDATE",[values.username.toLowerCase()])).rows[0];if(!user)throw new Error('Existing active account required.');
  const before=(await db.query('SELECT role_code FROM user_roles WHERE user_id=$1',[user.id])).rows;
  await db.query('INSERT INTO user_roles(user_id,role_code) VALUES ($1,$2) ON CONFLICT DO NOTHING',[user.id,policy.security.rootRole]);
  await db.query('INSERT INTO whitelist_entries(id,user_id,type,environment,reason,created_by) VALUES ($1,$2,$3,$4,$5,$2)',[randomUUID(),user.id,policy.security.panelWhitelist,environment,values.reason]);
  const requestId=randomUUID();await db.query("INSERT INTO admin_audit_logs(id,actor_user_id,actor_roles,action,target_type,target_id,before_data,after_data,reason,request_id,payload_hash) VALUES ($1,NULL,'[]','LOCAL_BOOTSTRAP','player',$2,$3,$4,$5,$6,$7)",[randomUUID(),user.id,JSON.stringify(before),JSON.stringify({role:policy.security.rootRole,environment}),values.reason,requestId,digest(requestId)]);
  await db.query('DELETE FROM admin_sessions WHERE user_id=$1',[user.id]);await store.redis.del(store.key(`authz:${user.id}`));
 });console.log('Bootstrap recorded. Sign in at /admin.html and enroll MFA.');
}finally{await store.close();}
