export let RARITIES=[];
export let UPGRADE_TAGS={};
export function rarityWeights(age, luck=0,catalog=null) {
  const base=catalog?.raritySchedule?.filter(row=>age>=row.age).at(-1)?.weights||(age<180?[70,24,5,1,0]:age<420?[55,30,12,2.8,.2]:[40,32,20,7,1]);
  const bounded=Math.max(0,Math.min(catalog?.balance.luckCap??3,Number.isFinite(luck)?luck:0));
  const weighted=base.map((value,i)=>value*(1+bounded*i*(catalog?.balance.luckWeight??.15)));
  const total=weighted.reduce((a,b)=>a+b,0);
  return weighted.map(value=>value/total);
}
export function rollRarity(randomValue,age,luck=0,catalog=null) {
  let value=Math.max(0,Math.min(.999999999,randomValue));
  const weights=rarityWeights(age,luck,catalog);
  const rarities=catalog?.rarities||RARITIES;
  for(let i=0;i<weights.length;i++) {value-=weights[i];if(value<0)return rarities[i].id;}
  return rarities.at(-1).id;
}
export let TRAITS=[];
export function resolveTraits(player) {
  const fire=player.segments.filter(s=>s.type==='fire').length;
  const poison=player.segments.some(s=>s.type==='poison');
  const adjacent=player.segments.some((s,i)=>i>0&&new Set([s.type,player.segments[i-1].type]).size===2&&[s.type,player.segments[i-1].type].every(t=>['fire','poison'].includes(t)));
  const epicFire=(player.upgradeRolls||[]).filter(r=>r.id==='fire'&&['EPIC','LEGENDARY','MYTHIC'].includes(r.rarity)).length;
  const progress={toxic_ignition:Number(fire>0)+Number(poison),critical_wave:Number((player.upgrades.fangs||0)>0)+Number((player.upgrades.pulse||0)>0),volatile_chain:adjacent?2:Number(fire>0||poison),fire_dominion:fire,ember_crown:epicFire};
  const discovered=new Set(player.traitDiscoveries||[]);
  player.traits=(player._catalog?.traits||TRAITS).map(trait=>{
    const value=progress[trait.id]||0;
    const state=value>=trait.required?'ACTIVE':value>0?'HINTED':'LOCKED';
    if(state==='ACTIVE')discovered.add(trait.id);
    return {id:trait.id,state,progress:Math.min(value,trait.required),required:trait.required};
  });
  player.traitDiscoveries=[...discovered];
  return player.traits;
}
export const hasTrait = (player,id) => player.traits?.some(t=>t.id===id&&t.state==='ACTIVE')||false;
export const rarityLevel = (player,id) => Math.max(0,...(player.upgradeRolls||[]).filter(r=>r.id===id).map(r=>(player._catalog?.rarities||RARITIES).findIndex(t=>t.id===r.rarity)));
export function configureBuilds(catalog){RARITIES=structuredClone(catalog.rarities);UPGRADE_TAGS=structuredClone(catalog.upgradeTags);TRAITS=structuredClone(catalog.traits);}
