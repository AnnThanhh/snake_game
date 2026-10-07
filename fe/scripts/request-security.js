// Protocol validation and browser security boundaries are code, not editable content.
export function safeRequestTarget(value){return typeof value==='string'&&/^\/(?!\/)/.test(value)&&!/[\\\x00-\x20\x7f]/.test(value);}
export function proxyHeaders(req){
 const headers={...req.headers};
 for(const key of Object.keys(headers))if(key.startsWith('x-serpent-')||key==='x-game-secret'||key==='forwarded'||key.startsWith('x-forwarded-'))delete headers[key];
 headers['x-serpent-client-ip']=req.socket.remoteAddress;return headers;
}
export const securityHeaders={
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
