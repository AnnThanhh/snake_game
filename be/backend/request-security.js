import {createHmac,timingSafeEqual} from 'node:crypto';
import {isIP,BlockList} from 'node:net';
export function safeRequestTarget(value){return typeof value==='string'&&/^\/(?!\/)/.test(value)&&!/[\\\x00-\x20\x7f]/.test(value);}

export function normalizeIp(value){
 if(typeof value!=='string'||value.length>64)return '';
 const ip=value.startsWith('::ffff:')&&isIP(value.slice(7))===4?value.slice(7):value;
 return isIP(ip)?ip:'';
}
export function matchesIp(ip,rule){
 try{const [address,prefix,...rest]=String(rule).split('/'),host=normalizeIp(address),family=isIP(host);if(!host||rest.length)return false;
  if(prefix===undefined)return normalizeIp(ip)===host;
  if(!/^\d+$/.test(prefix))return false;const bits=Number(prefix);if(bits<0||bits>(family===4?32:128))return false;
  const block=new BlockList();block.addSubnet(host,bits,family===4?'ipv4':'ipv6');return block.check(normalizeIp(ip),isIP(normalizeIp(ip))===4?'ipv4':'ipv6');
 }catch{return false;}
}
export function publicPeer(req,policy){
 const peer=normalizeIp(req.socket?.remoteAddress)||'unknown';
 if(policy.security.trustedProxyAddresses.some(rule=>matchesIp(peer,rule)))return normalizeIp(req.headers['x-serpent-client-ip'])||peer;
 return peer;
}
const signature=(secret,ip,at,method,url)=>createHmac('sha256',secret).update([ip,at,method,url].join('\n')).digest('hex');
export function signedPeerHeaders(secret,ip,method,url,now=Date.now()){
 const at=String(now);return {'x-serpent-proxy-ip':ip,'x-serpent-proxy-at':at,'x-serpent-proxy-signature':signature(secret,ip,at,method,url)};
}
export function authenticatedPeer(req,secret,now=Date.now()){
 const ip=normalizeIp(req.headers['x-serpent-proxy-ip']),at=req.headers['x-serpent-proxy-at'],given=req.headers['x-serpent-proxy-signature'];
 if(ip&&typeof at==='string'&&/^\d{13}$/.test(at)&&Math.abs(now-Number(at))<=30000&&typeof given==='string'&&/^[a-f0-9]{64}$/.test(given)){
  const expected=signature(secret,ip,at,req.method,req.url);if(timingSafeEqual(Buffer.from(given),Buffer.from(expected)))return ip;
 }
 return normalizeIp(req.socket?.remoteAddress)||'unknown';
}
export function stripProxyIdentity(headers){for(const key of Object.keys(headers))if(key.startsWith('x-serpent-')||key==='x-game-secret'||key==='forwarded'||key.startsWith('x-forwarded-'))delete headers[key];return headers;}
export function permittedAdminIp(context,policy,ip,environment){
 if(!policy.security.ipAllowlistRequired)return true;
 const now=Date.now();return context.whitelists.some(w=>w.type===policy.security.ipWhitelistType&&w.is_active&&w.environment===environment&&Date.parse(w.starts_at)<=now&&(!w.expires_at||Date.parse(w.expires_at)>now)&&matchesIp(ip,w.value));
}
export function matchingBans(context,policy,{mode,accountOnly=false}={}){
 const rules=policy.moderation;return context.bans.filter(b=>rules.banTypes.includes(b.type)&&(accountOnly?rules.accountScopes.includes(b.scope):rules.matchScopes.includes(b.scope)||b.scope==='SPECIFIC_GAME_MODE'&&b.scope_value===mode));
}
export function publicRestriction(ban,policy){
 return {id:ban.id,type:ban.type,scope:ban.scope,scopeName:policy.moderation.scopes.find(s=>s.id===ban.scope)?.name||ban.scope,mode:ban.scope_value||null,reason:ban.public_reason||policy.moderation.defaultPublicReason,expiresAt:ban.expires_at,permanent:!ban.expires_at,appealNotice:policy.moderation.appealNotice};
}
