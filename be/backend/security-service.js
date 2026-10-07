import {createHash,randomUUID} from 'node:crypto';
import {hasPermission} from './permissions.js';
import {publicRestriction} from './request-security.js';
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=(status,message)=>Object.assign(new Error(message),{status});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function notifyPlayer(db,id,kind,payload){
 if(id)await db.query('INSERT INTO player_notifications(id,player_id,kind,payload) VALUES ($1,$2,$3,$4)',[randomUUID(),id,kind,JSON.stringify(payload)]);
}
export function createSecurityService(store,authz){
 async function publicConfiguration(){
  const policy=await authz.policy(),settings=await store.query("SELECT key,value FROM system_settings WHERE key IN ('ui','operations','admin_tabs')");
  const values=Object.fromEntries(settings.rows.map(r=>[r.key,r.value])),s=policy.security;
  return {version:1,copy:values.ui,adminTabs:values.admin_tabs,moderation:policy.moderation,limits:{usernameMin:s.usernameMin,usernameMax:s.usernameMax,passwordMin:s.passwordMin,passwordMax:s.passwordMax,displayNameMax:s.displayNameMax,historyLimit:s.historyLimit,reportReasonMin:s.reportReasonMin,reportReasonMax:s.reportReasonMax,reportDailyLimit:s.reportDailyLimit,evidenceUrlMax:s.evidenceUrlMax,adminReasonMin:s.adminReasonMin,adminReasonMax:s.adminReasonMax},defaults:{species:policy.registration.species,playerName:values.operations.defaultPlayerName}};
 }
 async function report(reporter,body,verifiedRoom=null){
  if(!UUID.test(reporter||''))throw fail(401,'Hãy đăng nhập để gửi báo cáo.');
  const policy=await authz.policy(),context=await authz.resolve(reporter,{fresh:true}),s=policy.security;
  if(!hasPermission(context,policy.endpoints['report:create']))throw fail(403,'Không có quyền gửi báo cáo.');
  const reason=typeof body.reason==='string'?body.reason.trim():'',category=body.category||policy.moderation.defaultCategory;
  if(!UUID.test(body.requestId||'')||reason.length<s.reportReasonMin||reason.length>s.reportReasonMax||!policy.moderation.reportCategories.some(c=>c.id===category))throw fail(400,'Thông tin báo cáo không hợp lệ.');
  let evidenceUrl=typeof body.evidenceUrl==='string'?body.evidenceUrl.trim():'';
  if(evidenceUrl){let u;try{u=new URL(evidenceUrl);}catch{}if(!u||u.protocol!=='https:'||u.username||u.password||evidenceUrl.length>s.evidenceUrlMax)throw fail(400,'Bằng chứng cần là đường dẫn HTTPS hợp lệ.');evidenceUrl=u.href;}
  let target,roomId='',matchId=null,targetSession='',targetName='';
  if(verifiedRoom){target=verifiedRoom.targetId||null;roomId=verifiedRoom.roomId;matchId=verifiedRoom.matchId;targetSession=verifiedRoom.targetSessionId;targetName=String(verifiedRoom.targetName||'').slice(0,s.displayNameMax);if(target&&!UUID.test(target)||!UUID.test(matchId)||!/^[A-Za-z0-9_-]{1,64}$/.test(roomId)||!/^[A-Za-z0-9_-]{1,64}$/.test(targetSession))throw fail(400,'Phòng báo cáo không hợp lệ.');}
  else{if(typeof body.username!=='string'||body.username.length>s.usernameMax)throw fail(400,'Tên tài khoản không hợp lệ.');target=(await store.query('SELECT id FROM users WHERE username=$1',[body.username.trim().toLowerCase()])).rows[0]?.id;if(!target)throw fail(400,'Tài khoản bị báo cáo không hợp lệ.');}
  if(target===reporter)throw fail(400,'Không thể tự báo cáo.');
  const payloadHash=hash({reporter,target,reason,category,evidenceUrl,roomId,matchId,targetSession});
  return store.transaction(async db=>{
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['report:'+reporter]);
   const prior=(await db.query('SELECT * FROM player_reports WHERE id=$1',[body.requestId])).rows[0];
   if(prior){if(prior.reporter_id!==reporter||prior.payload_hash!==payloadHash)throw fail(409,'requestId đã dùng cho báo cáo khác.');return {id:prior.id,duplicate:true};}
   const count=(await db.query("SELECT count(*)::int AS count,max(created_at) AS latest FROM player_reports WHERE reporter_id=$1 AND created_at>now()-interval '1 day'",[reporter])).rows[0];
   if(count.count>=s.reportDailyLimit||count.latest&&Date.now()-new Date(count.latest).getTime()<s.reportCooldownSeconds*1000)throw fail(429,'Bạn đã gửi báo cáo gần đây; hãy đợi trước khi gửi tiếp.');
   await db.query('INSERT INTO player_reports(id,reporter_id,target_id,reason,category,evidence_url,room_id,match_id,target_session_id,target_name,payload_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[body.requestId,reporter,target,reason,category,evidenceUrl,roomId,matchId,targetSession,targetName,payloadHash]);
   return {id:body.requestId,duplicate:false};
  });
 }
 async function status(id){
  const policy=await authz.policy(),context=await authz.resolve(id,{fresh:true});
  const [notifications,reports,appeals]=await Promise.all([
   store.query('SELECT id,kind,payload,created_at,read_at FROM player_notifications WHERE player_id=$1 ORDER BY created_at DESC LIMIT $2',[id,policy.security.notificationLimit]),
   store.query('SELECT id,category,status,created_at,resolution FROM player_reports WHERE reporter_id=$1 ORDER BY created_at DESC LIMIT $2',[id,policy.security.historyLimit]),
   store.query('SELECT id,action_id,status,created_at,resolution FROM moderation_appeals WHERE player_id=$1 ORDER BY created_at DESC LIMIT $2',[id,policy.security.historyLimit])]);
  return {version:1,restrictions:context.bans.map(b=>publicRestriction(b,policy)),notifications:notifications.rows,reports:reports.rows,appeals:appeals.rows};
 }
 async function appeal(id,body){
  const policy=await authz.policy(),reason=typeof body.reason==='string'?body.reason.trim():'';
  if(!UUID.test(body.requestId||'')||!UUID.test(body.actionId||'')||reason.length<policy.security.reportReasonMin||reason.length>policy.security.reportReasonMax)throw fail(400,'Yêu cầu xem xét không hợp lệ.');
  const payloadHash=hash({id,actionId:body.actionId,reason});
  return store.transaction(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['appeal:'+id]);
   const prior=(await db.query('SELECT * FROM moderation_appeals WHERE id=$1',[body.requestId])).rows[0];
   if(prior){if(prior.player_id!==id||prior.payload_hash!==payloadHash)throw fail(409,'requestId đã dùng cho dữ liệu khác.');return {id:prior.id,duplicate:true};}
   const action=(await db.query('SELECT id FROM moderation_actions WHERE id=$1 AND target_user_id=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())',[body.actionId,id])).rows[0];
   if(!action)throw fail(404,'Không tìm thấy quyết định đang có hiệu lực của tài khoản.');
   const counts=(await db.query("SELECT count(*) FILTER(WHERE created_at>now()-interval '1 day')::int AS total,count(*) FILTER(WHERE action_id=$2 AND status='open')::int AS pending FROM moderation_appeals WHERE player_id=$1 AND (created_at>now()-interval '1 day' OR status='open')",[id,body.actionId])).rows[0];
   if(counts.pending)throw fail(409,'Yêu cầu này đang chờ xem xét.');if(counts.total>=policy.security.appealDailyLimit)throw fail(429,'Đã đạt giới hạn yêu cầu xem xét trong ngày.');
   await db.query('INSERT INTO moderation_appeals(id,player_id,action_id,reason,payload_hash) VALUES ($1,$2,$3,$4,$5)',[body.requestId,id,body.actionId,reason,payloadHash]);return {id:body.requestId,duplicate:false};
  });
 }
 async function recordEvent(body){
  if(!UUID.test(body.id||'')||!['PROTOCOL_VIOLATION','MESSAGE_FLOOD'].includes(body.code)||body.accountId&&!UUID.test(body.accountId)||typeof body.roomId!=='string'||body.roomId.length>64||!Number.isSafeInteger(body.count)||body.count<1||body.count>100000)throw fail(400,'Sự kiện bảo mật không hợp lệ.');
  await store.query('INSERT INTO security_events(id,event_code,source,player_id,room_id,details) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[body.id,body.code,'authority',body.accountId||null,body.roomId,JSON.stringify({count:body.count,rule:String(body.rule||'').slice(0,80)})]);
  return {ok:true};
 }
 return {publicConfiguration,report,status,appeal,recordEvent};
}
