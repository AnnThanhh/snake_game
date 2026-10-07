import { randomUUID } from 'node:crypto';
import { addPlayer,removePlayer,respawnPlayer,chooseUpgrade } from '../game/engine.js';
import { RARITIES } from '../game/builds.js';
import { SpatialGrid } from '../game/spatial.js';
import { chooseEvolution } from '../game/v2.js';

const NAMES=['Raven','Nova','Moss','Ember','Fern','Echo','Ash','Orion','Cedar','Luna','Reed','Flint','Willow','Frost','Dune','Sage','Iris','Onyx'];
const PERSONALITIES=['farmer','hunter','survivor','aggressor','objective'];
const REACTION=[.4,.24,.15];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function createBotDirector(world,capacity) {
  const config=world._catalog?.bots,names=config?.names||NAMES,personalities=config?.personalities||PERSONALITIES,reactions=config?.reactions||REACTION;
  const brains=new Map();let serial=0,nextPopulation=0;
  function retireOne(humans) {
    const bots=world.players.filter(p=>p.bot);
    bots.sort((a,b)=>Math.min(...humans.map(h=>distance(b,h)),9999)-Math.min(...humans.map(h=>distance(a,h)),9999));
    const p=bots[0];if(!p)return false;
    p.botState='RETIRING';
    world.effects.push({id:`retire-${p.id}`,type:'retire',x:p.x,y:p.y,radius:60,color:'#b6d3c3',life:.7,maxLife:.7});
    if(world.effects.length>100)world.effects.shift();
    removePlayer(world,p.id);brains.delete(p.id);return true;
  }
  function update(inputs,humanSlots) {
    for(const id of Object.keys(inputs))if(!world.players.some(p=>p.id===id))delete inputs[id];
    if(world.time>=nextPopulation) {
      nextPopulation=world.time+(config?.populationSeconds??.5);
      const target=Math.min(config?.maxBots??18,Math.max(0,Math.max(1,capacity-(config?.targetOffset??2))-humanSlots),capacity-humanSlots);
      while(brains.size>target)retireOne(world.players.filter(p=>!p.bot));
      while(brains.size<target&&world.players.length<capacity) {
        const index=serial++,id=`bot-${randomUUID()}`;
        const species=world._catalog?.species.map(s=>s.id)||['cobra','python','viper'];
        const p=addPlayer(world,{id,name:`[BOT] ${names[index%names.length]}`,species:species[index%species.length]});
        if(!p)break;
        p.bot=true;p.lifeId=randomUUID();p.botState='SPAWNING';
        brains.set(id,{personality:personalities[index%personalities.length],skill:index%3,nextAt:world.time+reactions[index%3],input:{angle:p.angle,throttle:0},index});
      }
    }
    // AI gets a bounded view and never reads the human inputs map.
    const grid=new SpatialGrid(240);
    for(const p of world.players)if(p.alive)grid.add({kind:'player',entity:p,x:p.x,y:p.y});
    for(const e of world.enemies)grid.add({kind:'enemy',entity:e,x:e.x,y:e.y});
    for(const f of world.foods)grid.add({kind:'food',entity:f,x:f.x,y:f.y});
    if(config?.utilityWeights)for(const o of [...world.director.objectives,...(world.director.shrine?[world.director.shrine]:[])])grid.add({kind:'objective',entity:o,x:o.x,y:o.y});
    for(const [id,brain] of brains) {
      let p=world.players.find(p=>p.id===id);if(!p){brains.delete(id);continue;}
      if(!p.alive) {
        p.botState='DEAD';p=respawnPlayer(world,id);
        if(p){p.bot=true;p.lifeId=randomUUID();brain.nextAt=world.time+.4;}else continue;
      }
      if(world.time>=brain.nextAt) {
        brain.nextAt=world.time+Math.max(.1,reactions[brain.skill]);
        if(p.evolutionPoints>0)for(const choice of config?.evolutionPreferences?.[brain.personality]||[]){
          if(choice.kind==='organs'&&p.organs.some(o=>o.id===choice.choice))continue;
          const index=p.segments.findIndex(s=>!p.organs.some(o=>o.segmentId===s.id));
          if(chooseEvolution(world,id,{...choice,index}))break;
        }
        const view=grid.query(p.x,p.y,config?.perception??650).filter(v=>v.entity!==p&&distance(v,p)<(config?.perception??650));
        const enemies=view.filter(v=>v.kind==='enemy'||v.kind==='player');
        const nearest=list=>list.sort((a,b)=>distance(a,p)-distance(b,p))[0];
        const danger=nearest(enemies.filter(v=>distance(v,p)<(config?.dangerRadius??160)&&(v.kind==='enemy'||v.entity.hp>p.hp*(config?.strongerRatio??1.2))));
        let target;let escape=false;
        if(config?.utilityWeights){
          const weights=config.utilityWeights[brain.personality],radius=config.perception,choices=[];
          const consider=(entity,state,weight,factor=1,retreat=false)=>{if(entity)choices.push({entity,state,retreat,score:weight*factor/(1+distance(p,entity)/radius)});};
          consider(nearest(view.filter(v=>v.kind==='food')),'FARMING',weights.food);
          const prey=nearest(enemies.filter(v=>v.kind==='player'&&v.entity.spawnProtection<=0));
          consider(prey,'HUNTING',weights.pvp,prey?(prey.entity.hp<p.hp?weights.weakTarget:weights.risk)*p.hp/p.maxHp:0);
          consider(nearest(view.filter(v=>v.kind==='enemy'&&v.entity.type==='boss')),'BOSSING',weights.boss,weights.risk*p.hp/p.maxHp);
          consider(nearest(view.filter(v=>v.kind==='objective'&&v.entity.owner!==p.id)),'CAPTURING',weights.objective);
          consider(danger,'ESCAPING',weights.safety*weights.escape,1+(1-p.hp/p.maxHp)/(config.retreatHp||1),true);
          choices.sort((a,b)=>b.score-a.score);if(choices.length){target=choices[0].entity;escape=choices[0].retreat;p.botState=choices[0].state;}
          if(target&&p.botState==='CAPTURING'&&distance(p,target)<(config.dangerRadius??160)&&target.entity.captureSeconds){const angle=world.time+brain.index;target={x:target.x+Math.cos(angle)*world._catalog.balance.circleClosure,y:target.y+Math.sin(angle)*world._catalog.balance.circleClosure};}
        }
        else if(danger&&(p.hp/p.maxHp<(config?.retreatHp??.4)||['farmer','survivor'].includes(brain.personality))){target=danger;escape=true;p.botState='ESCAPING';}
        else if(brain.personality==='objective') {target=nearest(view.filter(v=>v.kind==='enemy'&&['boss','brute'].includes(v.entity.type)));p.botState='BOSSING';}
        else if(['hunter','aggressor'].includes(brain.personality)) {target=nearest(enemies.filter(v=>v.kind==='player'&&v.entity.spawnProtection<=0&&(brain.personality==='aggressor'||v.entity.hp<p.hp)));p.botState='HUNTING';}
        if(!target){target=nearest(view.filter(v=>v.kind==='food'));p.botState='FARMING';}
        if(!target){target={x:world.width/2,y:world.height/2};p.botState='RETREATING';}
        const error=Math.sin(world.time*(config?.aimFrequency??1.8)+brain.index)*(config?.aimErrors||[.18,.09,.03])[brain.skill];
        brain.input={angle:Math.atan2(target.y-p.y,target.x-p.x)+(escape?Math.PI:0)+error,throttle:escape?(config?.escapeThrottle??.5):0,dash:escape&&p.dashCooldown<=0,pulse:!escape&&enemies.some(e=>distance(e,p)<(config?.pulseRadius??130))&&p.pulseCooldown<=0};
        if(p.choices.length) {
          const preferences=config?.preferences[brain.personality]||{farmer:['growth','magnet','wisdom'],hunter:['fangs','haste','pulse'],survivor:['armor','vitality','agility'],aggressor:['fire','poison','fangs'],objective:['elements','pulse','fire']}[brain.personality];
          const score=id=>(world._catalog?.rarities||RARITIES).findIndex(r=>r.id===p.choiceRarities[id])*(config?.upgradeRarityWeight??2)+(preferences.includes(id)?(config?.upgradePreferenceWeight??3):0);
          chooseUpgrade(world,id,[...p.choices].sort((a,b)=>score(b)-score(a))[0]);
        }
      }
      inputs[id]={...brain.input};brain.input.dash=false;brain.input.pulse=false;
    }
  }
  return {update,retireOne,brains};
}
