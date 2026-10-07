// Version 2 uses integer coordinates, compact entity tuples and sparse patches.
// Both sides keep a connection-local baseline. WebSocket ordering is required;
// a missing baseline is recovered with a full frame, never guessed client state.
const COLLECTIONS = ['P','S','E','F','B','X'];
const TUPLE_LENGTH = {P:27,S:6,E:14,F:5,B:12,X:8};
const q = (value, scale = 4) => Math.round((Number.isFinite(value) ? value : 0) * scale);
const n = (value, scale = 4) => value / scale;
const same = (a,b) => {if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;if(Array.isArray(a)){return Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));}const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>same(a[k],b[k]));};
const copy = value => structuredClone(value);

export function createWireState() { return {seq:0,previous:null}; }

function pack(snapshot, {playerId, viewRadius = 1000, pathMode = false, packingCache,tupleCache} = {}) {
  const memo=(entity,build)=>{if(!packingCache)return build();let row=packingCache.get(entity);if(!row){row={};packingCache.set(entity,row);}if(!row.tuple){const next=build(),prior=tupleCache?.get(entity.id);row.tuple=prior&&same(prior,next)?prior:next;tupleCache?.set(entity.id,row.tuple);}return row.tuple;};
  const own = snapshot.players.find(p => p.id === playerId);
  const anchor = own?.alive ? own : snapshot.players.find(p => p.alive) || own;
  const radius = Math.max(450, Math.min(1800, Number.isFinite(viewRadius) ? viewRadius : 1000)) + 120;
  const nearby = entity => !anchor || (entity.x-anchor.x)**2 + (entity.y-anchor.y)**2 <= (radius+(entity.radius||0))**2;
  const body = new Map(snapshot.players.map(p => [p.id,pathMode ? (p.id===playerId||nearby(p)||p.segments.some(nearby)?p.segments:[]) : p.segments.filter(s => p.id === playerId || nearby(s))]));
  const P = snapshot.players.map(p => {const tuple=memo(p,()=>[p.id,p.name,p.species,q(p.x),q(p.y),q(p.angle,1000),q(p.hp,10),q(p.maxHp,10),p.level,q(p.xp,10),p.xpNext,q(p.growth,10),p.kills,p.score,p.gold,p.alive?1:0,p.maxLength,[...p.choices],{...p.upgrades},q(p.dashCooldown,100),q(p.pulseCooldown,100),q(p.invulnerable,100),q(p.speed,10),q(p.pulseRadius),q(p.choiceTime,100),q(p.circleCooldown,100),p.segments.map(s=>s.id)]);return body.get(p.id).length===p.segments.length?tuple:[...tuple.slice(0,26),body.get(p.id).map(s=>s.id)];});
  const S = [];for(const segments of body.values())for(const s of segments)S.push(memo(s,()=>[s.id,pathMode?0:q(s.x),pathMode?0:q(s.y),s.type,q(s.hp,10),q(s.maxHp,10)]));
  const E = snapshot.enemies.filter(e => e.type === 'boss' || nearby(e)).map(e => memo(e,()=>[e.id,e.type,q(e.x),q(e.y),q(e.hp,10),q(e.maxHp,10),q(e.radius),q(e.angle,1000),q(e.slow,100),q(e.hitFlash,100),e.phase||1,q(e.warning,100),q(e.attackTimer,100),0]));
  const F = snapshot.foods.filter(nearby).map(f => memo(f,()=>[f.id,f.type,q(f.x),q(f.y),f.value]));
  const B = snapshot.projectiles.filter(nearby).map(b => memo(b,()=>[b.id,q(b.x),q(b.y),q(b.angle,1000),q(b.vx,10),q(b.vy,10),q(b.radius),b.damage||0,b.owner||'',b.team||'enemy',b.color||'#f4bc83',q(b.life,100)]));
  const X = snapshot.effects.filter(nearby).map(e => memo(e,()=>[e.id,e.type,q(e.x),q(e.y),q(e.radius),e.color,q(e.life,100),q(e.maxLife,100)]));
  return {m:{width:snapshot.width,height:snapshot.height,time:n(q(snapshot.time,1000),1000),duration:snapshot.duration,mode:snapshot.mode,status:snapshot.status,bossSpawned:snapshot.bossSpawned,bossDefeated:snapshot.bossDefeated},c:{P,S,E,F,B,X}};
}

export function encodeFrame(snapshot, state, options = {}) {
  const packed = pack(snapshot, options);
  const seq = state.seq + 1;
  let frame;
  if (!state.previous || options.forceFull) frame = {v:2,seq,k:'f',m:packed.m,c:packed.c};
  else {
    const changes = {};
    for (const key of COLLECTIONS) {
      const before = new Map(state.previous.c[key].map(tuple => [tuple[0],tuple]));
      const upserts = [], patches = [];
      for (const tuple of packed.c[key]) {
        const old = before.get(tuple[0]);
        if (!old) upserts.push(tuple);
        else if(old!==tuple) {
          let mask = 0; const values = [];
          for (let i=1;i<tuple.length;i++) if (!same(tuple[i],old[i])) {mask |= 1 << (i-1); values.push(tuple[i]);}
          if (mask) patches.push([tuple[0],mask,...values]);
        }
        before.delete(tuple[0]);
      }
      const removed = [...before.keys()];
      if (upserts.length || patches.length || removed.length) changes[key] = {u:upserts,p:patches,d:removed};
    }
    frame = {v:2,seq,base:state.seq,k:'d',m:packed.m,c:changes};
  }
  state.seq = seq;
  state.previous = packed;
  return frame;
}

function checkTuple(tuple,key) {
  if (!Array.isArray(tuple) || tuple.length !== TUPLE_LENGTH[key] || typeof tuple[0] !== 'string') throw new Error('Invalid entity tuple');
  return copy(tuple);
}
function decode(packed) {
  const segments = new Map(packed.c.S.map(s => [s[0],{id:s[0],x:n(s[1]),y:n(s[2]),type:s[3],hp:n(s[4],10),maxHp:n(s[5],10)}]));
  const players = packed.c.P.map(p => ({id:p[0],name:p[1],species:p[2],x:n(p[3]),y:n(p[4]),angle:n(p[5],1000),hp:n(p[6],10),maxHp:n(p[7],10),level:p[8],xp:n(p[9],10),xpNext:p[10],growth:n(p[11],10),kills:p[12],score:p[13],gold:p[14],alive:!!p[15],maxLength:p[16],choices:[...p[17]],upgrades:{...p[18]},dashCooldown:n(p[19],100),pulseCooldown:n(p[20],100),invulnerable:n(p[21],100),speed:n(p[22],10),pulseRadius:n(p[23]),choiceTime:n(p[24],100),circleCooldown:n(p[25],100),segments:p[26].map(id=>segments.get(id)).filter(Boolean)}));
  return {...packed.m,players,
    enemies:packed.c.E.map(e=>({id:e[0],type:e[1],x:n(e[2]),y:n(e[3]),hp:n(e[4],10),maxHp:n(e[5],10),radius:n(e[6]),angle:n(e[7],1000),slow:n(e[8],100),hitFlash:n(e[9],100),phase:e[10],warning:n(e[11],100),attackTimer:n(e[12],100)})),
    foods:packed.c.F.map(f=>({id:f[0],type:f[1],x:n(f[2]),y:n(f[3]),value:f[4]})),
    projectiles:packed.c.B.map(b=>({id:b[0],x:n(b[1]),y:n(b[2]),angle:n(b[3],1000),vx:n(b[4],10),vy:n(b[5],10),radius:n(b[6]),damage:b[7],owner:b[8],team:b[9],color:b[10],life:n(b[11],100)})),
    effects:packed.c.X.map(e=>({id:e[0],type:e[1],x:n(e[2]),y:n(e[3]),radius:n(e[4]),color:e[5],life:n(e[6],100),maxLife:n(e[7],100)})),
  };
}

export function applyFrame(previous, frame) {
  if (!frame || frame.v !== 2 || !Number.isSafeInteger(frame.seq) || frame.seq < 1 || !['f','d'].includes(frame.k) || !frame.m || !frame.c) throw new Error('Invalid snapshot frame');
  if (previous && frame.seq <= previous.seq) throw new Error('Stale snapshot frame');
  if (frame.k === 'd' && (!previous || frame.base !== previous.seq || frame.seq !== previous.seq+1)) throw new Error('Snapshot baseline missing');
  const packed = {m:copy(frame.m),c:{}};
  for (const key of COLLECTIONS) {
    if (frame.k === 'f') {
      if (!Array.isArray(frame.c[key])) throw new Error('Incomplete full snapshot');
      packed.c[key] = frame.c[key].map(tuple => checkTuple(tuple,key));
      continue;
    }
    const entries = new Map(previous.packed.c[key].map(tuple=>[tuple[0],tuple]));
    const change = frame.c[key];
    if (change) {
      if (!Array.isArray(change.d)||!Array.isArray(change.u)||!Array.isArray(change.p)) throw new Error('Invalid delta collection');
      for (const id of change.d) entries.delete(id);
      for (const tuple of change.u) {const t=checkTuple(tuple,key);entries.set(t[0],t);}
      for (const patch of change.p) {
        if (!Array.isArray(patch)||!entries.has(patch[0])||!Number.isInteger(patch[1])||patch[1]<=0||patch[1]>=(1<<(TUPLE_LENGTH[key]-1))) throw new Error('Invalid entity patch');
        const tuple=[...entries.get(patch[0])];let at=2;
        for(let i=1;i<tuple.length;i++)if(patch[1]&(1<<(i-1))){if(at>=patch.length)throw new Error('Incomplete entity patch');tuple[i]=copy(patch[at++]);}
        if(at!==patch.length)throw new Error('Excess entity patch fields');
        entries.set(tuple[0],tuple);
      }
    }
    packed.c[key]=[...entries.values()];
  }
  return {seq:frame.seq,packed,snapshot:decode(packed)};
}
