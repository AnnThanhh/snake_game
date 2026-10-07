import './fixtures/configure.js';
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createWorld,
  addPlayer,
  chooseUpgrade,
  stepWorld,
  getSnapshot,
} from "../game/engine.js";
import { chooseEvolution } from "../game/v2.js";
import {createBotDirector} from '../server/bots.js';
import {
  createPathState,
  encodePathFrame,
  applyPathFrame,
} from "../game/path-network.js";
const seed = JSON.parse(
  await readFile(
    new URL("../backend/seeds/003_catalog.json", import.meta.url),
    "utf8",
  ),
);
for(const file of ['005_tuning','006_runtime','007_world']){const extra=JSON.parse(await readFile(new URL(`../backend/seeds/${file}.json`,import.meta.url),'utf8'));for(const [key,value] of Object.entries(extra))seed[key]=Array.isArray(value)?value:{...seed[key],...value};}
function setup(mode = "arena") {
  const c = {...structuredClone(seed),biomeModifiers:[]},
    w = createWorld({ mode, catalog: c, seed: 31, maxPlayers: 30 });
  const p = addPlayer(w, { id: "p" });
  p.x = 500;
  p.y = 500;
  w._spawnTimer = 999999;
  return { w, p, c };
}
test("V2 rooms freeze database catalog, enforce capacity and use configured movement", () => {
  const { w, p, c } = setup();
  c.balance.speed = 9999;
  assert.equal(w._catalog.balance.speed, 143);
  stepWorld(w, {}, 0.05);
  assert.ok(p.speed < 200);
  for (let i = 1; i < 30; i++) assert.ok(addPlayer(w, { id: "p" + i }));
  assert.equal(addPlayer(w, { id: "full" }), null);
  assert.ok(!JSON.stringify(getSnapshot(w)).includes("_catalog"));
});
test('explicit zero in the DB catalog is retained instead of legacy fallback',()=>{
 const c=structuredClone(seed);c.world.initialFood=0;c.balance.speed=0;
 const w=createWorld({catalog:c,mode:'coop'});assert.equal(w.foods.length,0);const p=addPlayer(w,{id:'zero'});stepWorld(w,{},.05);assert.equal(p.speed,0);
});
test("evolution choices require points, enforce caps and bind organs to live body slots", () => {
  const { w, p } = setup();
  assert.equal(
    chooseEvolution(w, p.id, { kind: "organs", choice: "heart", index: 2 }),
    false,
  );
  p.evolutionPoints = 10;
  assert.equal(
    chooseEvolution(w, p.id, { kind: "organs", choice: "heart", index: 2 }),
    true,
  );
  assert.equal(
    chooseEvolution(w, p.id, { kind: "organs", choice: "brain", index: 2 }),
    false,
  );
  p.segments[2].hp = 1;
  stepWorld(w, {}, 0.05);
  assert.ok(p.segments[2].hp > 1);
  p.segments.splice(2, 1);
  stepWorld(w, {}, 0.05);
  assert.equal(p.organs.length, 0);
  for (const id of ["pyromaniac", "conductor"])
    assert.equal(
      chooseEvolution(w, p.id, { kind: "keystones", choice: id }),
      true,
    );
  assert.equal(
    chooseEvolution(w, p.id, { kind: "keystones", choice: "predator" }),
    false,
  );
});
test("curses apply both benefit and cost, keystones change growth rules", () => {
  const { w, p } = setup();
  p.evolutionPoints = 5;
  chooseEvolution(w, p.id, { kind: "curses", choice: "blood_engine" });
  const length = p.segments.length;
  stepWorld(w, { p: { pulse: true } }, 0.05);
  assert.equal(p.segments.length, length - 1);
  assert.ok(p.pulseCooldown < 5);
  chooseEvolution(w, p.id, { kind: "keystones", choice: "predator" });
  w.foods = [{ id: "test", x: p.x, y: p.y, type: "growth", value: 99 }];
  const growth = p.growth;
  stepWorld(w, {}, 0.05);
  assert.equal(p.growth, growth);
});
test("director creates real events and weather changes actual modifiers", () => {
  const { w, p } = setup();
  w.time = 90;
  stepWorld(w, {}, 0.05);
  assert.ok(w.director.events.some((e) => e.id === "meteor"));
  assert.ok(w.foods.some((f) => f.value === 60));
  w.time = 121;
  stepWorld(w, {}, 0.05);
  stepWorld(w, {}, 0.05);
  assert.equal(w.director.weather.id, "rain");
  assert.equal(p._modifiers.fire, 0.8);
  w.time = 181;
  stepWorld(w, {}, 0.05);
  assert.ok(w.director.shrine);
});
test("Crown requires length; Extraction requires server channel and does not extract on mere arrival", () => {
  const { w, p } = setup("extraction");
  w.time = 180;
  p.x = w.width / 2;
  p.y = w.height / 2;
  w.foods = [];
  stepWorld(w, {}, 0.05);
  assert.ok(w.director.portal);
  assert.equal(p.extracted, false);
  p.temporaryLoot = 10;
  for (let i = 0; i < 90; i++) {
    p.x = w.width / 2;
    p.y = w.height / 2;
    stepWorld(w, { p: { interact: true } }, 0.05);
  }
  assert.equal(p.extracted, true);
  assert.equal(w.status, "victory");
  assert.equal(p.temporaryLoot, 10);
  const { w: crown, p: king } = setup("crown");
  stepWorld(crown, {}, 0.05);
  assert.equal(crown.director.crown, null);
  for (let i = 0; i < 7; i++) {
    king.choices = ["growth"];
    chooseUpgrade(crown, king.id, "growth");
  }
  crown.time = 1;
  stepWorld(crown, {}, 0.05);
  assert.equal(crown.director.crown.id, king.id);
});
test("branch body metadata roundtrips path protocol and remains outside main spine", () => {
  const { w, p } = setup();
  for (let i = 0; i < 3; i++) {
    p.choices = ["growth"];
    chooseUpgrade(w, p.id, "growth");
  }
  p.evolutionPoints = 1;
  chooseEvolution(w, p.id, { kind: "mutations", choice: "twin_spine" });
  stepWorld(w, {}, 0.05);
  const s = p.segments[10];
  assert.equal(s.branchParent, p.segments[9].id);
  const frame = encodePathFrame(
    getSnapshot(w, { includePaths: true }),
    createPathState(),
    { playerId: p.id },
  );
  const decoded = applyPathFrame(null, frame).snapshot;
  assert.equal(decoded.director.season.id, seed.season.id);
  assert.ok(
    Math.hypot(
      s.x - decoded.players[0].segments[10].x,
      s.y - decoded.players[0].segments[10].y,
    ) < 0.2,
  );
});
test("Hydra Raid requires armor, separate heads and cores, survival and a counter circle", () => {
  const { w,p } = setup("raid");
  p.invulnerable=9999;w._catalog.balance.biteDamage=100000;
  w.time = 15;
  stepWorld(w, {}, 0.05);
  assert.equal(w.director.raid.name, seed.raid.phaseNames[0]);
  const r = w.director.raid;
  const breakParts=parts=>{for(const part of parts){p.x=part.x;p.y=part.y;stepWorld(w,{},.05);}};
  breakParts(r.armor);
  assert.equal(r.phase, 1);
  p.x=0;p.y=0;stepWorld(w,{},.05);assert.ok(r.heads.every(h=>h.hp===h.maxHp));
  breakParts(r.heads);
  assert.equal(r.phase, 2);
  breakParts(r.cores);
  assert.equal(r.phase, 3);
  w.time=r.arenaUntil;stepWorld(w,{},.05);assert.equal(r.phase,4);
  p.x=r.x;p.y=r.y;const sealedHp=r.hp;stepWorld(w,{},.05);assert.equal(r.hp,sealedHp);
  w._zones=[{playerId:p.id,life:10,vertices:[{x:r.x-100,y:r.y-100},{x:r.x+100,y:r.y-100},{x:r.x+100,y:r.y+100},{x:r.x-100,y:r.y+100}]}];
  for(let i=0;i<65&&w.status==='playing';i++){p.x=r.x;p.y=r.y;stepWorld(w,{},.05);}
  assert.equal(r.defeated,true);assert.equal(w.status,'victory');assert.ok(p._bossDamage>0);
});

test('runtime catalog controls food distribution, combat rewards and feature availability',()=>{
 const c=structuredClone(seed);c.spawning.initialFoodWeights={growth:0,xp:1,heal:0,gold:0};c.loot.killScore.chaser=123;c.features.organs=false;
 const w=createWorld({catalog:c,mode:'arena',seed:9}),p=addPlayer(w,{id:'db-player'});w._spawnTimer=999;w._foodTimer=999;w.foods=[];p.x=500;p.y=500;p.evolutionPoints=1;
 assert.equal(chooseEvolution(w,p.id,{kind:'organs',choice:'brain',index:0}),false);assert.equal(p.evolutionPoints,1);
 const initial=createWorld({catalog:c,mode:'arena',seed:9});assert.ok(initial.foods.every(f=>f.type==='xp'));
 w.enemies.push({id:'reward-probe',type:'chaser',x:p.x,y:p.y-30,hp:1,maxHp:1,radius:10,angle:0,slow:0,hitFlash:0,attackTimer:99,_contacts:{},_poison:0,_charge:0,_ability:99});
 stepWorld(w,{},.05);assert.equal(p.kills,1);assert.equal(p._score,123);
});
test('bot action selection follows database utility weights',()=>{
 const {w,p}=setup();w._catalog.bots.maxBots=1;w._catalog.bots.targetOffset=0;w._maxPlayers=2;
 const director=createBotDirector(w,2),inputs={};director.update(inputs,1);const bot=w.players.find(p=>p.bot),brain=director.brains.get(bot.id);p.spawnProtection=0;bot.x=p.x+90;bot.y=p.y;
 w.foods=[{id:'utility-food',type:'growth',x:bot.x,y:bot.y+15,value:25}];
 const weights=w._catalog.bots.utilityWeights[brain.personality];Object.assign(weights,{pvp:10,food:0,safety:0,boss:0,objective:0});w.time=1;brain.nextAt=0;director.update(inputs,1);assert.equal(bot.botState,'HUNTING');
 Object.assign(weights,{pvp:0,food:10});brain.nextAt=0;director.update(inputs,1);assert.equal(bot.botState,'FARMING');
});
test('co-op circle revives a teammate with configured body and protection',()=>{
 const {w,p}=setup('coop'),helper=addPlayer(w,{id:'helper'});p.alive=false;p._headHp=0;p.segments=[];
 w._zones=[{playerId:helper.id,life:10,vertices:[{x:p.x-100,y:p.y-100},{x:p.x+100,y:p.y-100},{x:p.x+100,y:p.y+100},{x:p.x-100,y:p.y+100}]}];
 for(let i=0;i<65&&!p.alive;i++)stepWorld(w,{},.05);
 assert.equal(p.alive,true);assert.equal(p.segments.length,w._catalog.world.reviveSegments);assert.ok(p.invulnerable>0);
});
test('a heavy hit resets extraction channel progress',()=>{
 const {w,p}=setup('extraction');w.time=180.1;p.x=w.width/2;p.y=w.height/2;p.extractionProgress=2;p._heavyHitAt=w.time;
 stepWorld(w,{p:{interact:true}},.05);assert.equal(p.extractionProgress,0);assert.equal(p.extracted,false);
});

test('biome modifiers are seeded once, preserved in snapshots and affect movement and vision',()=>{
 const c=structuredClone(seed);c.biomeModifiers=c.biomeModifiers.filter(m=>m.id==='blackout');
 c.biomeModifiers[0].speed=.5;
 const w=createWorld({catalog:c,seed:42}),other=createWorld({catalog:c,seed:42}),p=addPlayer(w,{id:'p'});
 assert.deepEqual(w.director.biomes,other.director.biomes);
 p.x=2000;p.y=500;w._spawnTimer=99999;stepWorld(w,{},.05);
 assert.equal(p._modifiers.vision,.7);assert.ok(p.speed<100);
 c.biomeModifiers[0].speed=3;assert.equal(w.director.biomes.find(b=>b.id==='cyber').modifier.speed,.5);
 const snapshot=getSnapshot(w,{includePaths:true}),decoded=applyPathFrame(null,encodePathFrame(snapshot,createPathState(),{viewerId:p.id,forceFull:true}));
 assert.deepEqual(decoded.snapshot.director.biomes,snapshot.director.biomes);
 assert.ok(new Set(Array.from({length:12},(_,i)=>JSON.stringify(createWorld({catalog:seed,seed:i}).director.biomes))).size>1);
});

test('bots spend earned evolution points through the same validated choices as humans',()=>{
 const {w}=setup();w._catalog.bots.maxBots=1;w._catalog.bots.targetOffset=0;w._maxPlayers=2;
 const director=createBotDirector(w,2),inputs={};director.update(inputs,1);const bot=w.players.find(p=>p.bot),brain=director.brains.get(bot.id);
 w.time=1;brain.nextAt=0;director.update(inputs,1);assert.equal(bot.keystones.length,0);
 bot.evolutionPoints=2;brain.nextAt=0;director.update(inputs,1);assert.deepEqual(bot.keystones,['pacifist']);assert.equal(bot.evolutionPoints,1);
 brain.nextAt=0;director.update(inputs,1);assert.equal(bot.organs[0].id,'stomach');assert.equal(bot.evolutionPoints,0);
});
