const shapes={input:['angle','throttle','seq','viewRadius','dash','pulse','interact'],ping:['at'],resync:[],leave:[],ready:['ready'],upgrade:['id'],evolution:['kind','choice','index'],respawn:[],report:['requestId','targetSessionId','category','reason','evidenceUrl']};
const short=value=>typeof value==='string'&&value.length>0&&value.length<=100;
export function validMessage(data){
 if(!data||Array.isArray(data)||typeof data!=='object'||!Object.hasOwn(shapes,data.type)||Object.keys(data).some(k=>k!=='type'&&!shapes[data.type].includes(k)))return false;
 if(data.type==='input')return Number.isFinite(data.angle)&&Math.abs(data.angle)<=Math.PI*4&&Number.isFinite(data.throttle)&&Math.abs(data.throttle)<=1&&Number.isSafeInteger(data.seq)&&data.seq>0&&(data.viewRadius===undefined||Number.isFinite(data.viewRadius))&&['dash','pulse','interact'].every(k=>data[k]===undefined||typeof data[k]==='boolean');
 if(data.type==='ping')return Number.isFinite(data.at);
 if(data.type==='ready')return typeof data.ready==='boolean';
 if(data.type==='upgrade')return short(data.id);
 if(data.type==='evolution')return short(data.kind)&&short(data.choice)&&Number.isSafeInteger(data.index)&&data.index>=0;
 if(data.type==='report')return short(data.requestId)&&short(data.targetSessionId)&&short(data.category)&&typeof data.reason==='string'&&data.reason.length<=4000&&(data.evidenceUrl===undefined||typeof data.evidenceUrl==='string'&&data.evidenceUrl.length<=4000);
 return true;
}
