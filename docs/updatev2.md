# SERPENT SURVIVOR — GDD V2 EXPANSION

> Continuation for the existing Serpent Survivor Game Design Document.  
> Focus: Framework Upgrade, Realtime Architecture, Performance Optimization, Gameplay Variety, New Game Modes, Advanced Build Systems, World Systems, and Long-Term Scalability.

---

# 223. V2 Development Direction

Serpent Survivor V2 should evolve from a single game mode with multiplayer support into a reusable multiplayer roguelite platform.

The core identity remains:

```text
Move
↓
Eat
↓
Grow
↓
Build
↓
Fight
↓
Adapt
↓
Survive
```

However, V2 introduces additional gameplay layers:

```text
World Objectives
Dynamic Events
Game Modes
Territory Control
Extraction
Boss Raids
Advanced Build Systems
Organs
Keystones
Cursed Upgrades
Dynamic Biomes
Seasonal Rules
```

The goal is not simply to add more enemies or more skills.

The goal is to create:

> Different reasons to move, fight, build, cooperate, compete, retreat, and take risks.

---

# 224. Recommended Technology Stack

Recommended V2 stack:

```text
SERPENT SURVIVOR

Frontend
└── Phaser + TypeScript
    ├── Vite
    ├── WebGL
    ├── Rendering
    ├── Input
    ├── Camera
    ├── UI
    ├── VFX
    ├── Client Prediction
    └── Interpolation

Realtime Game Server
└── Colyseus + TypeScript
    ├── Rooms
    ├── Matchmaking
    ├── Authoritative Simulation
    ├── Reconnect
    ├── Presence
    ├── AOI
    ├── Bot Director
    └── State Synchronization

API Backend
└── NestJS + Fastify
    ├── Authentication
    ├── Player Profile
    ├── Inventory
    ├── Progression
    ├── Match History
    ├── Leaderboard
    ├── Seasons
    └── Content APIs

Persistent Data
├── PostgreSQL
└── Prisma

Temporary / Distributed State
└── Redis

Async Processing
└── BullMQ

Observability
├── OpenTelemetry
├── Prometheus
└── Grafana
```

---

# 225. Framework Responsibility

Frameworks must have clearly separated responsibilities.

## Phaser

Responsible for:

```text
Rendering
Animation
Input
Camera
Sprites
Particles
Audio
UI integration
Client interpolation
Client prediction
Visual effects
```

Phaser must not determine authoritative combat results.

---

## Colyseus

Responsible for:

```text
Realtime rooms
Player connections
Authoritative simulation
Room lifecycle
Matchmaking
Reconnect
Realtime state
Bot simulation
Combat validation
World events
Game objectives
```

---

## NestJS

Responsible for:

```text
Authentication
Accounts
Player profiles
Inventory
Meta progression
Persistent currency
Snake unlocks
Achievements
Match history
Global leaderboard
Season progression
Administration APIs
```

NestJS should not execute the high-frequency combat simulation.

---

# 226. Recommended High-Level Architecture V2

```text
                    ┌──────────────────────────┐
                    │        WEB CLIENT        │
                    │                          │
                    │ Phaser + TypeScript      │
                    │ Rendering 60 FPS         │
                    │ Prediction               │
                    │ Interpolation            │
                    └────────────┬─────────────┘
                                 │
                 ┌───────────────┴────────────────┐
                 │                                │
               HTTPS                           WebSocket
                 │                                │
                 ▼                                ▼
       ┌────────────────────┐          ┌─────────────────────┐
       │ NESTJS + FASTIFY   │          │      COLYSEUS       │
       │                    │          │    GAME SERVER      │
       │ Auth               │          │                     │
       │ Profile            │          │ Room                │
       │ Inventory          │          │ Simulation          │
       │ Progression        │          │ Combat              │
       │ Leaderboard        │          │ Collision           │
       │ Seasons            │          │ AI / Bots           │
       │ Match History      │          │ AOI                 │
       └─────────┬──────────┘          │ World Director      │
                 │                     └──────────┬──────────┘
          ┌──────┴────────┐                       │
          │               │                       │
          ▼               ▼                       ▼
    PostgreSQL          Redis                 Match Result
          │               │                       │
          │               │                       ▼
          │               └──────────────────► BullMQ
          │                                       │
          └───────────────────────────────────────┘
```

---

# 227. Realtime Room Architecture

Each match or persistent arena should run inside an isolated room.

Example:

```text
GAME SERVER PROCESS

├── OpenArenaRoom #SEA-001
│   └── 27 Players
│
├── OpenArenaRoom #SEA-002
│   └── 24 Players
│
├── CoopSurvivorRoom #SEA-003
│   └── 8 Players
│
├── BossRaidRoom #SEA-004
│   └── 8 Players
│
└── KingOfCoilRoom #SEA-005
    └── 20 Players
```

Each room owns:

```text
World State
Players
Bots
Enemies
Food
Projectiles
Bosses
Objectives
Events
Score
Simulation Tick
```

One room must never directly manipulate the simulation state of another room.

---

# 228. Server Authority Rules

The server remains authoritative.

The client sends:

```text
turnDirection
boostPressed
skillPressed
upgradeSelected
interactPressed
```

The client never sends trusted final values such as:

```text
finalPosition
damageResult
killResult
expReward
lootResult
scoreResult
```

Example:

```text
Client:
"I want to turn toward 82 degrees."

Server:
Validates movement.

Server:
Calculates position.

Server:
Broadcasts authoritative state.
```

---

# 229. Fixed Simulation Tick

Recommended initial values:

```text
Server Simulation:
20 Hz

Network Snapshot:
10–15 Hz

Client Rendering:
60 FPS
```

Server frame budget at 20 Hz:

```text
50 ms maximum per simulation step
```

Recommended safe target:

```text
Average Tick:
< 20 ms

P95 Tick:
< 35 ms

Hard Warning:
> 45 ms
```

The server must avoid reaching the full 50 ms budget continuously.

---

# 230. Client Prediction

Local movement should feel immediate.

Flow:

```text
Player Input
↓
Local Prediction
↓
Render Immediately
↓
Send Input to Server
↓
Server Validation
↓
Authoritative State
↓
Reconciliation
```

Prediction should mainly apply to:

```text
Head movement
Turning
Boost
Local skill anticipation
```

Combat results should remain server authoritative.

---

# 231. Remote Player Interpolation

Remote players should not teleport between snapshots.

Flow:

```text
Snapshot A
↓
Interpolation Buffer
↓
Snapshot B
↓
Render Intermediate Position
```

Recommended interpolation delay:

```text
80–150 ms
```

The exact value should be configurable.

---

# 232. Snake Network Optimization

A snake may contain:

```text
20 segments
50 segments
100 segments
300 segments
```

Never synchronize every body segment independently every network tick.

Synchronize:

```text
Head Position
Head Direction
Speed
Movement History / Path
Important Segment State
Special Segment Events
```

Client reconstructs ordinary segment positions from the path.

Example:

```text
HEAD
↓
Movement Path
↓
Segment 1
↓
Segment 2
↓
Segment 3
↓
...
↓
TAIL
```

---

# 233. Spatial Grid

Divide the world into spatial cells.

Example:

```text
┌────┬────┬────┬────┬────┐
│ A1 │ A2 │ A3 │ A4 │ A5 │
├────┼────┼────┼────┼────┤
│ B1 │ B2 │ B3 │ B4 │ B5 │
├────┼────┼────┼────┼────┤
│ C1 │ C2 │ P  │ C4 │ C5 │
├────┼────┼────┼────┼────┤
│ D1 │ D2 │ D3 │ D4 │ D5 │
└────┴────┴────┴────┴────┘
```

The player in the center only needs high-detail information about nearby cells.

Spatial Grid should be used for:

```text
Collision candidate lookup
Enemy targeting
Food lookup
Projectile lookup
AOI
Spawn validation
Bot perception
Objective detection
```

---

# 234. Area of Interest V2

Recommended network tiers:

```text
NEAR
15 Hz updates

MID
5 Hz updates

FAR
1 Hz updates

OUTSIDE AOI
0 Hz updates
```

Example:

```text
Player
│
├── 0–800 units
│   └── NEAR
│
├── 800–1600 units
│   └── MID
│
├── 1600–2500 units
│   └── FAR
│
└── >2500 units
    └── No detailed update
```

Important global events remain visible regardless of AOI.

---

# 235. Object Pooling

Frequently created gameplay objects should use pooling.

Candidates:

```text
Food
Projectiles
Damage Numbers
Particles
Temporary Effects
Enemy Units
Trail Objects
Explosion Objects
Loot Orbs
```

Avoid:

```text
new Projectile()
destroy Projectile()
new Projectile()
destroy Projectile()
```

Prefer:

```text
Projectile Pool
↓
Acquire
↓
Use
↓
Reset
↓
Release
```

---

# 236. Data-Oriented Simulation

High-frequency game entities should gradually move toward data-oriented storage.

Instead of:

```text
Enemy {
    position
    velocity
    hp
    type
}
```

thousands of times, prefer structures such as:

```text
positionX[]
positionY[]
velocityX[]
velocityY[]
hp[]
type[]
state[]
targetId[]
```

Possible storage:

```text
Float32Array
Int32Array
Uint16Array
Uint8Array
```

Benefits:

```text
Less garbage collection
Less allocation
Better memory locality
Faster iteration
More predictable simulation
```

---

# 237. Entity Update Frequencies

Not every system needs to update at 20 Hz.

Recommended:

```text
Movement:
20 Hz

Collision:
20 Hz

Projectile:
20 Hz

Boss Combat:
20 Hz

Enemy Steering:
10–20 Hz

Bot Decision:
5–10 Hz

Objective Evaluation:
5 Hz

Loot Magnet:
5–10 Hz

Distant AI:
2–5 Hz

Leaderboard Calculation:
1–2 Hz
```

---

# 238. Bot AI V2 — Utility AI

Bots should use Utility AI.

Each possible action receives a score.

Example:

```text
Eat Food          0.72
Escape            0.91
Attack Player     0.35
Attack Boss       0.51
Collect Chest     0.83
Capture Shrine    0.61
```

Highest score becomes the current objective.

---

# 239. Bot Personality Weights

Existing personalities can become Utility AI profiles.

## Farmer

```text
Food Utility       ×1.5
PvP Utility        ×0.5
Safety Utility     ×1.2
```

## Hunter

```text
PvP Utility        ×1.8
Weak Target        ×1.5
Food Utility       ×0.7
```

## Survivor

```text
Safety Utility     ×2.0
Escape Utility     ×1.7
Risk Utility       ×0.4
```

## Aggressor

```text
PvP Utility        ×1.6
Boss Utility       ×1.2
Risk Tolerance     ×1.7
```

## Objective Bot

```text
Objective Utility  ×2.0
Boss Utility       ×1.5
PvP Utility        ×0.8
```

---

# 240. World Director

Introduce a new server system:

```text
WORLD DIRECTOR
```

The World Director controls dynamic events.

Responsibilities:

```text
Event Scheduling
Objective Spawning
Boss Timing
Resource Events
Danger Zones
Weather
Biome Modifiers
Player Pressure
Population Balance
```

---

# 241. World Event Timeline Example

Example Open Arena sequence:

```text
00:00
Arena Active

01:30
Meteor Crash

03:00
Ancient Shrine

05:00
Nest Invasion

08:00
World Boss

11:00
Void Storm

15:00
Golden Mutation Event

20:00
Cataclysm Event
```

Open Arena does not need to restart after this timeline.

The timeline may loop or enter a higher difficulty cycle.

---

# 242. Meteor Crash

A meteor lands in a random valid location.

Effects:

```text
Rare Food
DNA Fragment
Elite Enemies
Temporary Hazard
High Player Competition
```

The meteor location becomes visible on the minimap.

---

# 243. Ancient Shrine

A shrine appears on the map.

Players can capture it using the Serpent Circle mechanic.

Requirement:

```text
Create closed circle around Shrine
↓
Maintain circle
↓
Capture progress
```

Possible rewards:

```text
Evolution Reroll
Upgrade Reroll
Temporary Buff
Rare Chest
Team Regeneration
Elemental Bonus
```

---

# 244. Territory Capture

Special map locations can become capturable territory.

Examples:

```text
Ancient Core
Volcanic Node
Void Altar
Crystal Shrine
Mechanical Relay
```

Capture rules:

```text
Player circles objective
↓
Capture begins
↓
Enemy players can interrupt
↓
Capture completes
↓
Buff activated
```

---

# 245. Territory Buff Examples

## Volcanic Node

```text
+15% Fire Damage
+10% Burn Duration
```

## Crystal Shrine

```text
+15% Segment Defense
+10% Reflection
```

## Void Altar

```text
+10% Mutation Chance
+15% Enemy Difficulty
```

## Growth Spring

```text
+20% Growth Gain
```

---

# 246. New Game Mode — Extraction Arena

Players enter an arena to collect valuable persistent resources.

Flow:

```text
Enter Arena
↓
Farm
↓
Grow
↓
Build
↓
Collect DNA / Artifacts
↓
Risk Increases
↓
Choose
├── Extract
└── Continue
    ↓
    Better Rewards
    ↓
    Greater Risk
```

---

# 247. Extraction Risk

If the player extracts:

```text
Collected resources are secured.
```

If the player dies:

```text
Part of temporary loot is lost.
```

Persistent progression remains.

Recommended loss:

```text
Temporary Loot:
30–60% lost

Permanent Unlocks:
Never lost
```

Exact percentages require balance testing.

---

# 248. Extraction Zones

Extraction zones appear periodically.

Example:

```text
EXTRACTION PORTAL
Opens for:
30 seconds

Next portal:
3 minutes
```

Player must enter the extraction zone and remain inside.

Recommended extraction channel:

```text
3–5 seconds
```

Taking heavy damage may interrupt extraction.

---

# 249. New Game Mode — Boss Raid

Recommended player count:

```text
4–8 Players
```

Players cooperate against a large multi-phase boss.

Boss Raid focuses on:

```text
Positioning
Build Synergy
Segment Roles
Circle Mechanics
Reviving
Phase Mechanics
Team Coordination
```

---

# 250. Hydra Serpent Raid

Example Raid Boss:

```text
HYDRA SERPENT
```

Three primary heads:

```text
Fire Head
Poison Head
Lightning Head
```

Each head has different mechanics.

---

# 251. Hydra Raid Phases

## Phase 1

Destroy external armor segments.

## Phase 2

Elemental heads become active.

## Phase 3

Players must destroy elemental cores.

## Phase 4

Hydra body forms a giant arena circle.

## Phase 5

Players must counter-circle the core.

---

# 252. New Game Mode — King of the Coil

Recommended:

```text
20 Players
1 Crown
```

One player holds:

```text
SERPENT CROWN
```

Crown Holder receives:

```text
+25% Growth
+20% EXP
+10% Score Gain
```

But:

```text
Approximate position visible to all players.
```

---

# 253. King of the Coil Scoring

Score sources:

```text
Crown Hold Time
Kills
Objectives
Boss Contribution
Survival
```

Example:

```text
Crown Time      1200
Kills            500
Objectives       300
Boss Damage      250
Survival         200
```

---

# 254. Apex Serpent Bounty

If one player becomes extremely dominant:

```text
High Rank
High Length
High Kill Streak
High Score
```

the server may mark that player:

```text
APEX SERPENT
```

Effects:

```text
Approximate position revealed
Bounty reward activated
Special visual marker
```

Killing the Apex Serpent rewards:

```text
EXP
DNA
Rare Chest
Score
Temporary Buff
```

The Apex player should not receive hidden stat nerfs.

---

# 255. Branching Body System

Late-game mutations can allow the snake body to branch.

Normal:

```text
HEAD
 │
 ●
 │
 ●
 │
 ●
 │
TAIL
```

Branching:

```text
       HEAD
        │
        ●
       / \
      ●   ●
      │   │
     🔥   ⚡
      │   │
      ●   ●
```

---

# 256. Twin Spine Mutation

Example:

```text
TWIN SPINE
```

Effect:

```text
Every 10 body segments
creates a secondary branch.
```

Advantages:

```text
More weapon locations
More adjacency combinations
More area control
Higher contact damage potential
```

Disadvantages:

```text
Larger collision profile
Lower mobility
Harder body management
More vulnerable branches
```

---

# 257. Organ Segment System

Add a new category:

```text
ORGANS
```

Organs are rare body segments with powerful functional effects.

Possible organs:

```text
Heart
Brain
Eye
Stomach
Adrenal Gland
Reactor
Bone Core
Mutation Gland
```

---

# 258. Heart Organ

Effect:

```text
+Regeneration
+Repair speed
```

Example:

```text
Heart Lv.1
+5 HP/s to nearby segments
```

If destroyed:

```text
Regeneration disabled until repaired or replaced.
```

---

# 259. Brain Organ

Effect:

```text
Skill Cooldown Reduction
Improved Active Skill Efficiency
```

Example:

```text
-10% Active Skill Cooldown
```

---

# 260. Eye Organ

Effect:

```text
Vision Radius
Enemy Detection
Objective Detection
```

Possible advanced effect:

```text
Reveal nearby invisible enemies.
```

---

# 261. Stomach Organ

Effect:

```text
Food value
Growth efficiency
Rare food conversion
```

Example:

```text
+20% Food Growth Value
```

---

# 262. Adrenal Gland

Activates under dangerous conditions.

Example:

```text
When body HP < 30%

+25% Movement Speed
+20% Attack Speed
```

---

# 263. Reactor Organ

Enhances nearby elemental segments.

Example:

```text
🔥 🔥 [REACTOR] 🔥 ⚡
```

Effect:

```text
Adjacent elemental segments:
+20% Effect Power
```

---

# 264. Organ Placement Strategy

Organs should create positional decisions.

Example:

```text
HEAD
 │
 👁 Eye
 │
 🔥 Fire
 │
 ❤️ Heart
 │
 🛡 Armor
 │
 🔥 Fire
 │
TAIL
```

Front placement:

```text
High effectiveness
High risk
```

Inner placement:

```text
Safer
Harder to access certain adjacency combinations
```

---

# 265. Keystone Upgrade System

Keystones are build-defining upgrades.

A Keystone should significantly change gameplay rules.

Keystones should not simply provide:

```text
+10% Damage
```

They should modify mechanics.

---

# 266. Keystone — Pyromaniac

```text
Fire damage cannot critically strike.

BUT

Burn Damage ×3.
```

This creates a dedicated damage-over-time build.

---

# 267. Keystone — Perfect Conductor

```text
Lightning attacks deal reduced direct damage.

BUT

+2 additional chain targets.
```

Advanced version:

```text
Every chain jump increases damage.
```

---

# 268. Keystone — Immortal Body

```text
Head HP becomes extremely low.

Body segments absorb incoming damage before the head.
```

This creates a body-management tank archetype.

---

# 269. Keystone — Predator

```text
Normal food provides no Growth.

Enemy kills provide ×3 Growth.
```

This converts the build into an aggressive hunting playstyle.

---

# 270. Keystone — Pacifist Growth

Opposite to Predator.

```text
PvP damage -50%

Food Growth ×2
Objective Rewards ×1.5
```

This creates a farming / objective archetype.

---

# 271. Cursed Upgrade System

Cursed upgrades provide extreme benefits with serious drawbacks.

The player must intentionally accept the risk.

---

# 272. Curse — Void Heart

```text
+70% Damage

-30% Maximum Length
```

---

# 273. Curse — Blood Engine

```text
Skill Cooldown:
-50%

Every Active Skill:
Lose 1 Body Segment
```

---

# 274. Curse — Greed

```text
Gold Gain:
×3

Healing from Food:
Disabled
```

---

# 275. Curse — Fragile Evolution

```text
Evolution Chance:
Greatly Increased

Segment HP:
-40%
```

---

# 276. Curse — Unstable Core

```text
Elemental Damage:
+80%

Every 10 seconds:
Random nearby segment takes damage.
```

---

# 277. Keystone and Curse Rules

Recommended limits:

```text
Keystone:
1–2 per run

Curse:
0–3 per run
```

Some mutations may increase these limits.

Keystone choices should be rare.

Curse choices should always display the disadvantage clearly.

---

# 278. Dynamic Biome System

Maps should no longer be fully static.

Each map receives random world modifiers when created.

Example:

```text
CYBER CITY

Modifiers:
Electromagnetic Storm
Security Protocol
Overcharge
```

---

# 279. Cyber City Modifier Examples

## Electromagnetic Storm

```text
Lightning Damage +20%
Projectile Accuracy -10%
```

## Security Protocol

```text
Laser traps ×2
Mechanical Elites +20%
```

## Blackout

```text
Vision Radius -30%
Rare resource visibility reduced
```

---

# 280. Volcano Modifier Examples

## Lava Surge

```text
Lava zones expand periodically.
```

## Ash Storm

```text
Vision reduced
Movement slightly reduced
```

## Inferno Core

```text
Fire enemies stronger
Fire rewards stronger
```

---

# 281. Weather System

Weather may temporarily modify the arena.

Weather events should affect actual gameplay.

---

# 282. Rain

```text
Fire Damage -20%
Burn Duration -20%

Lightning Chain Range +20%
```

Optional:

```text
Wet enemies conduct electricity.
```

---

# 283. Heat Wave

```text
Fire Damage +25%
Ice Duration -30%
```

---

# 284. Toxic Fog

```text
Vision Radius -25%
Poison Enemies +20%
Poison Duration +15%
```

---

# 285. Solar Storm

```text
Energy Skill Cooldown -20%
Lightning Frequency +20%
```

---

# 286. Darkness Event

```text
World visibility heavily reduced.
```

Possible counters:

```text
Eye Organ
Light Segment
Fire Segment
Detection Mutation
```

---

# 287. Objective Variety

World objectives should include multiple gameplay categories.

## Combat

```text
Kill Elite
Defeat Boss
Destroy Nest
Defend Area
```

## Capture

```text
Capture Shrine
Hold Territory
Escort Core
```

## Collection

```text
Collect DNA
Gather Food
Recover Artifacts
```

## Survival

```text
Survive Storm
Avoid Damage
Protect NPC
```

## PvP

```text
Kill Apex Serpent
Hold Crown
Steal Relic
```

---

# 288. Escort Objective

A moving objective appears.

Example:

```text
ANCIENT CORE
```

Players must protect it while it moves.

Possible reward:

```text
Evolution Chest
Rare Organ
DNA
Global Buff
```

---

# 289. Nest Invasion

Enemy nests appear across the arena.

Example:

```text
4 Nests
```

Each nest:

```text
Spawns enemies
Buffs nearby enemies
Generates hazards
```

Destroy all nests:

```text
Spawn Elite Boss
↓
Receive Global Reward
```

---

# 290. Relic Theft Event

A valuable relic appears.

Player carrying the relic receives:

```text
Reduced Movement Speed
Visible Map Marker
```

If delivered to a shrine:

```text
Rare Reward
```

Other players may kill the carrier and steal the relic.

---

# 291. Build Archetype Expansion

V2 should support recognizable archetypes.

Examples:

```text
Fire DoT
Lightning Chain
Poison Spread
Ice Control
Armor Tank
Regeneration Tank
Critical Burst
Body Collision
Summoner
Explosive
Growth
Objective Support
Mobility Assassin
Organ Build
Curse Build
Hybrid Element
```

---

# 292. Support Build

Multiplayer introduces support-oriented builds.

Possible support segments:

```text
Healing Aura
Shield Pulse
Movement Aura
EXP Aura
Revive Core
Cleanse Segment
```

Support effects should have reduced effectiveness when stacking multiple identical sources.

---

# 293. Team Combo System

Co-op modes may unlock team interactions.

Example:

```text
Player A:
Ice

Player B:
Lightning
```

Combined effect:

```text
Frozen Thunder Field
```

Another:

```text
Player A:
Poison

Player B:
Fire

Result:
Toxic Ignition
```

Team combos should remain optional.

A player must still be functional alone.

---

# 294. Revive Mechanic

Recommended for PvE co-op and raids.

When a player dies:

```text
Ghost Core remains
```

Teammates can circle it.

Example:

```text
Create Serpent Circle
around Ghost Core

Hold:
3 seconds
```

Result:

```text
Player revived with reduced length.
```

---

# 295. Open Arena PvP Protection Rules

Newly spawned players receive:

```text
2–3 seconds Spawn Protection
```

Protection ends when:

```text
Player attacks another player
Player activates offensive skill
```

Players should not spawn near:

```text
Apex Serpent
Boss
Active PvP cluster
Danger Zone
Large enemy swarm
```

---

# 296. Anti-Snowball Systems

Avoid direct hidden nerfs.

Recommended systems:

```text
Apex Bounty
Objective incentives
Limited loot conversion on death
Diminishing kill rewards
Map-wide events
Territory conflict
Boss objectives
```

---

# 297. Diminishing Repeated Kill Reward

Repeatedly killing the same player should provide lower reward.

Example:

```text
First Kill:
100%

Second Kill:
70%

Third Kill:
40%

Fourth+:
20%
```

This discourages spawn farming.

---

# 298. Death Loot Conversion

When a player dies:

```text
25–30% recoverable body value
```

may become:

```text
Growth Orbs
EXP
Food
Temporary Loot
```

The full player value should never drop.

This prevents extreme snowballing.

---

# 299. World Difficulty Director

Difficulty should react primarily through content.

Possible adjustments:

```text
Enemy Density
Enemy Composition
Elite Frequency
Hazard Frequency
Objective Complexity
Boss Mechanics
```

Avoid excessive direct HP scaling.

---

# 300. Performance Budget — Client

Target:

```text
60 FPS
```

Frame budget:

```text
16.67 ms
```

Suggested budget:

```text
Movement / Prediction      2 ms
Snake Rendering            3 ms
Enemies                    3 ms
VFX                        3 ms
UI                         1 ms
Other / Safety             4 ms
```

These are initial development targets, not guaranteed final values.

---

# 301. Adaptive Graphics

Provide:

```text
Low
Medium
High
Ultra
Auto
```

Auto mode should monitor:

```text
FPS
Frame Time
GPU Load Proxy
Entity Count
Particle Count
```

If performance drops:

```text
Reduce Particles
↓
Reduce Trail Quality
↓
Reduce Distant Animation
↓
Reduce Shadows
↓
Reduce Cosmetic Effects
```

Gameplay information must remain visible.

---

# 302. Snake Rendering LOD

Nearby snake:

```text
Full detail
Full effects
Full trail
Animated segments
```

Medium distance:

```text
Reduced particles
Reduced trail detail
Simplified segment animation
```

Far distance:

```text
Simplified body
Minimal particles
No cosmetic trail
```

---

# 303. Enemy Rendering LOD

Far enemies may use:

```text
Lower animation rate
Simpler effects
Reduced shadow
Simplified health UI
```

Server simulation remains unchanged.

LOD affects only rendering.

---

# 304. Performance Debug HUD

Development HUD should display:

```text
FPS
Frame Time
Ping
Jitter
Packet Loss

Server Tick Rate
Server Tick Time
Snapshot Rate

Incoming KB/s
Outgoing KB/s

Players
Bots
Enemies
Projectiles
Food

AOI Entities
Rendered Entities
Active Particles
```

---

# 305. Example Debug HUD

```text
FPS                 60
Frame Time          13.2 ms

Ping                28 ms
Jitter               4 ms
Packet Loss          0.3%

Server Tick         20 Hz
Tick Time            12 ms

Snapshot Rate       12 Hz

Incoming            14 KB/s
Outgoing             2 KB/s

Players             26
Bots                 4
Enemies             213
Projectiles         148
Food                380

AOI Entities         91
Rendered Entities   143
Particles           220
```

---

# 306. Server Metrics

Recommended metrics:

```text
room_tick_ms
room_tick_p95_ms
room_players
room_bots
room_entities
room_enemies
room_projectiles

room_in_bytes
room_out_bytes

room_cpu
room_memory

matchmaking_wait_ms

ws_rtt
ws_disconnect_rate
reconnect_success_rate

match_duration
player_death_rate
upgrade_pick_rate
build_win_rate
```

---

# 307. Telemetry for Balance

Record anonymous gameplay statistics such as:

```text
Upgrade pick rate
Upgrade win rate
Evolution activation rate
Mutation frequency
Keystone pick rate
Curse pick rate
Average length
Average survival time
Boss success rate
PvP kill rate
Objective participation
Extraction success
```

Do not balance only from player complaints or intuition.

Use telemetry together with qualitative feedback.

---

# 308. Match Result Processing

At match end:

```text
Game Server
↓
Final Result
↓
Validate
↓
Queue Result
↓
BullMQ Worker
↓
Update PostgreSQL
```

Workers may process:

```text
Achievements
Currencies
Mastery
Match History
Leaderboard
Season Progress
Statistics
```

Game Server should not block simulation waiting for these updates.

---

# 309. Redis Responsibilities

Redis should store temporary or distributed information.

Examples:

```text
Server Presence
Room Directory
Player Presence
Matchmaking Queue
Reconnect Token
Rate Limit
Distributed Lock
Cache
```

Redis should not store every realtime entity position every simulation tick.

---

# 310. PostgreSQL Responsibilities

PostgreSQL stores persistent data.

Examples:

```text
User
Player Profile
Wallet
Snake Unlock
Snake Mastery
Achievement
Meta Upgrade
Match
Match Result
Season
Leaderboard
Cosmetic
Content Version
```

---

# 311. Game Server Memory

Realtime simulation stays primarily in process memory.

Examples:

```text
Player Position
Snake Path
Body State
Enemy State
Projectile State
Food
Boss State
Objective State
Event State
Temporary Buff
Current Build
Current EXP
Current Score
```

---

# 312. Horizontal Scaling

Initial:

```text
1 Game Server Process
├── Room 1
├── Room 2
├── Room 3
└── Room 4
```

Later:

```text
                 Matchmaker
                      │
       ┌──────────────┼──────────────┐
       ▼              ▼              ▼
 Game Server A   Game Server B   Game Server C
      │               │               │
   Room 1           Room 4          Room 7
   Room 2           Room 5          Room 8
   Room 3           Room 6          Room 9
```

---

# 313. Room Capacity Management

A server process should stop accepting new rooms when:

```text
CPU too high
Memory too high
Tick time too high
Room count too high
```

Example thresholds for testing:

```text
CPU:
> 75%

Tick P95:
> 35 ms

Memory:
> 75%
```

These are starting thresholds and must be tuned using load tests.

---

# 314. No Mid-Match Migration Initially

Do not implement room migration between game server processes in the first production version.

If a room starts on:

```text
Game Server B
```

it should normally remain there until:

```text
Room Ends
or
Arena Shuts Down
```

Mid-match migration significantly increases complexity.

---

# 315. Reconnect System

When disconnected:

```text
Player Connection Lost
↓
Grace Period
↓
Reconnect Token
↓
Player Rejoins Same Room
```

Recommended grace period:

```text
10–30 seconds
```

During disconnect:

```text
Snake may continue moving safely
or
Temporary AI takes control
```

Exact behavior depends on game mode.

---

# 316. Disconnect AI

Optional system:

```text
DISCONNECT AI
```

Temporary bot priorities:

```text
Avoid Combat
Move to Safe Area
Do Not Use Rare Consumables
Do Not Start PvP
Stay Alive
```

When player reconnects:

```text
Control returns immediately.
```

---

# 317. Seasonal Game Rules

Seasons should alter actual gameplay.

Example:

```text
Season 1
Mutation Outbreak

Season 2
Mechanical Invasion

Season 3
Void Serpents
```

A season can change:

```text
Enemy Pool
Boss Pool
World Events
Hidden Traits
Keystones
Curses
Biome Modifiers
Objectives
```

---

# 318. Season 1 — Mutation Outbreak

Possible rules:

```text
Mutation Chance +30%
Mutated Enemies appear
New Organ types
Mutation Boss
Mutation-themed Objectives
```

---

# 319. Season 2 — Mechanical Invasion

Possible rules:

```text
Mechanical Enemies
Laser Events
Cyber Biome Bonus
Reactor Organs
Mechanical Evolutions
```

---

# 320. Season 3 — Void Serpents

Possible rules:

```text
Void Weather
Void Bosses
Void Curses
Teleport Hazards
Corrupted Food
```

---

# 321. Content Versioning V2

Every gameplay definition should support versioning.

Examples:

```text
Game Version:
2.0.0

Balance Version:
2026.09.23

Upgrade Set:
upgrade-set-21

Enemy Set:
enemy-set-12

World Event Set:
event-set-04
```

Match history stores the versions used.

---

# 322. Data-Driven Gameplay Content

Gameplay definitions should preferably be stored as data rather than hardcoded logic where practical.

Example:

```json
{
  "id": "fire_segment",
  "type": "segment",
  "tags": ["FIRE", "BODY", "DAMAGE"],
  "baseDamage": 10,
  "rarity": "COMMON"
}
```

Another:

```json
{
  "id": "void_heart",
  "type": "curse",
  "effects": {
    "damageMultiplier": 1.7,
    "maxLengthMultiplier": 0.7
  }
}
```

This allows faster balance iteration.

---

# 323. Content Registry

Game Server should load content from a versioned registry.

Example:

```text
ContentRegistry

├── Segments
├── Upgrades
├── Mutations
├── Evolutions
├── Keystones
├── Curses
├── Organs
├── Enemies
├── Bosses
├── Events
├── Maps
└── Objectives
```

---

# 324. Hot Path Rule

Do not perform expensive dynamic operations inside the server hot path unless necessary.

Avoid per-tick:

```text
Database query
Redis query
JSON stringify large world
Filesystem access
Large object allocation
Complex pathfinding for every enemy
```

Prefer:

```text
Preloaded definitions
In-memory state
Spatial lookup
Object pools
Fixed arrays
Cached values
Batch operations
```

---

# 325. Pathfinding Strategy

Most enemies should not use expensive full pathfinding.

Use:

```text
Direct Steering
Separation
Obstacle Avoidance
Flow Fields
Simple Local Navigation
```

Reserve expensive navigation for:

```text
Bosses
Special Elites
Objective NPCs
```

---

# 326. Projectile Optimization

Projectiles can become one of the highest entity counts.

Possible optimizations:

```text
Object Pool
Spatial Grid
Lifetime Limit
Max Projectile Count
Batch Update
Simple Collision Shape
AOI Filtering
Client-side Cosmetic Projectiles
```

Purely visual projectiles do not need server entities.

---

# 327. Cosmetic vs Gameplay Effects

Separate:

```text
GAMEPLAY EFFECT
```

from:

```text
COSMETIC EFFECT
```

Example:

```text
Lightning Damage Hit
```

Server needs:

```text
target
damage
status effect
```

Client may independently render:

```text
lightning arc
spark particles
screen flash
sound
```

This reduces network bandwidth.

---

# 328. Gameplay Entity Budget

Initial stress-test target per room:

```text
Players:
30

Bots:
0–18

Enemies:
200–500

Food:
300–800

Gameplay Projectiles:
100–500

Cosmetic Particles:
Client controlled

Snake Segments:
Potentially thousands total
```

These values are test targets, not guaranteed production limits.

---

# 329. Load Test Scenarios

## Scenario A

```text
30 Players
No Bots
200 Enemies
300 Food
```

## Scenario B

```text
10 Players
14 Bots
400 Enemies
500 Food
```

## Scenario C

```text
30 Players
500 Enemies
300 Projectiles
Boss Active
World Event Active
```

## Scenario D

```text
30 Players
Each Snake Length 100+
Heavy Element Effects
Boss Active
```

---

# 330. Minimum MVP Performance Gate

Before adding excessive content, the core multiplayer build should prove:

```text
30 Players
+
Bots
+
200–500 Enemies
+
Long Snakes
+
AOI
+
20 Hz Authoritative Simulation
```

with acceptable tick stability.

Recommended gate:

```text
P95 Tick < 35 ms
No major memory leak
Stable reconnect
No severe desync
Acceptable bandwidth
```

---

# 331. Development Roadmap V2

## V0.1 — Core

```text
Phaser
Snake Movement
Food
Growth
Basic Camera
```

## V0.2 — Combat

```text
Enemies
Damage
Segments
Boss Prototype
```

## V0.3 — Roguelite

```text
Upgrade
Rarity
Synergy
Evolution
Mutation
```

## V0.4 — Multiplayer

```text
Colyseus
Room
Authoritative Movement
20–30 Players
```

## V0.5 — Netcode

```text
Prediction
Interpolation
Reconciliation
AOI
Spatial Grid
```

## V0.6 — Open Arena

```text
Persistent Arena
Bots
Respawn
Leaderboard
```

## V0.7 — World Systems

```text
World Director
World Events
Objectives
Shrines
Territory
```

## V0.8 — Build 2.0

```text
Organs
Keystones
Curses
Branching Body
```

## V0.9 — Game Modes

```text
Boss Raid
King of Coil
Advanced Co-op
PvPvE
```

## V0.10 — Persistence

```text
NestJS
PostgreSQL
Prisma
Redis
BullMQ
```

## V0.11 — Extraction

```text
Extraction Arena
Loot Risk
Artifacts
Persistent Rewards
```

## V0.12 — Performance

```text
Load Testing
Telemetry
Optimization
LOD
Adaptive Graphics
```

## V1.0

```text
Season System
Content Rotation
Polish
Ranked Systems
Production Monitoring
```

---

# 332. Priority Order

Recommended development priority:

```text
1. Core Movement
2. Multiplayer Authority
3. Snake Network Optimization
4. AOI
5. Combat
6. Build System
7. Bots
8. World Director
9. Objectives
10. Persistence
11. New Modes
12. Seasonal Systems
```

Do not prioritize large content libraries before multiplayer performance is proven.

---

# 333. Recommended First Playable Multiplayer Milestone

Target:

```text
1 Arena
20–30 Players
Basic Food
Basic Growth
3 Segment Types
3 Enemy Types
1 Boss
1 World Event
1 Leaderboard
Respawn
Bots
```

No persistent progression is required for the first networking milestone.

Goal:

> Prove that the realtime architecture is fun and stable.

---

# 334. Recommended First Build Variety Milestone

Add:

```text
Fire
Ice
Poison
Lightning
Armor
Regeneration
```

Then:

```text
3 Hybrid Synergies
3 Evolutions
3 Mutations
2 Keystones
2 Curses
2 Organs
```

Do not add dozens of upgrades until the synergy resolver is stable.

---

# 335. Recommended First World System Milestone

Add:

```text
Meteor Crash
Ancient Shrine
World Boss
```

These three events test:

```text
Resource competition
Territory capture
Cooperative / competitive boss behavior
```

---

# 336. Recommended First Advanced Mode

After Open Arena is stable, implement:

```text
BOSS RAID
```

Reason:

```text
Uses existing combat
Uses existing bosses
Uses existing rooms
Uses existing builds
Requires limited new persistence
```

Extraction should come later because it requires stronger economy and anti-exploit systems.

---

# 337. Design Principle — Systems Before Content

Prefer:

```text
1 strong system
+
20 data definitions
```

over:

```text
20 unique hardcoded systems
```

Example:

```text
World Director
```

can support:

```text
Meteor
Storm
Shrine
Boss
Nest
Relic
Golden Rain
Mutation Zone
```

through data-driven event definitions.

---

# 338. Design Principle — Build Decisions Must Matter

A player should regularly choose between:

```text
Damage
Defense
Mobility
Growth
Utility
Objective Power
Risk
Synergy
```

Avoid upgrades where one option is mathematically always superior.

---

# 339. Design Principle — More Power, More Exposure

The original philosophy remains:

> Growth must have a cost.

Examples:

```text
Longer Snake
→ More Power
→ Larger Target

More Branches
→ More Weapons
→ More Vulnerability

Cursed Upgrade
→ Huge Bonus
→ Serious Penalty

Territory Capture
→ Strong Buff
→ Forces Position Commitment

Apex Status
→ High Reward
→ Everyone Can Hunt You
```

---

# 340. Design Principle — Body Remains the Identity

Even after all V2 systems are added:

```text
Body = Build
```

must remain the main visual and mechanical identity.

New systems should preferably interact with the body.

Examples:

```text
Organs live in body segments
Keystones alter segment behavior
Curses alter body rules
Territory uses Serpent Circle
Boss mechanics target body sections
Branching modifies body topology
Team support comes from body aura segments
```

---

# 341. Design Principle — Multiplayer Must Not Destroy Roguelite Depth

Multiplayer should not reduce the game into only:

```text
PvP Snake Game
```

The player must still care about:

```text
Build
Synergy
Evolution
Mutation
Bosses
Objectives
Map Events
Risk Management
```

PvP is one system among many.

---

# 342. Design Principle — Avoid Pay-to-Win

Monetization should not provide competitive stat advantages.

Recommended monetization:

```text
Snake Skins
Segment Skins
Head Skins
Trail Effects
Death Effects
Emotes
Profile Decorations
Season Cosmetics
Arena Cosmetics
```

Avoid selling:

```text
Damage
HP
Luck
Growth
Movement Speed
Higher Rarity Chance
Competitive Respawn Advantage
```

---

# 343. Long-Term Game Identity

Serpent Survivor should aim to become:

> A multiplayer action roguelite where every snake physically displays its build, and where players continuously adapt to other players, world events, objectives, bosses, and changing arena conditions.

Core differentiation:

```text
Snake Body
+
Roguelite Build
+
Realtime Multiplayer
+
World Objectives
+
Dynamic Arena
+
Visible Build Identity
```

---

# 344. Final V2 Gameplay Loop

```text
Join Arena
↓
Spawn
↓
Eat / Explore
↓
Fight PvE
↓
Grow
↓
Choose Upgrade
↓
Build Body
↓
Discover Synergy
↓
Fight Players
↓
World Event Appears
↓
Choose Objective
↓
Capture / Fight / Escape
↓
Receive Mutation / Organ / Keystone
↓
Boss Appears
↓
Cooperate or Compete
↓
Become Stronger
↓
Risk Increases
↓
Extract / Survive / Hold Crown / Continue
↓
Receive Match Rewards
↓
Progress Meta Systems
↓
Enter Next Run
```

---

# 345. V2 Core Feature Summary

```text
FRAMEWORK

Phaser
Colyseus
NestJS + Fastify
PostgreSQL
Prisma
Redis
BullMQ

PERFORMANCE

20 Hz Simulation
Client Prediction
Interpolation
AOI
Spatial Grid
Object Pool
Data-Oriented Simulation
LOD
Adaptive Graphics
Telemetry

GAMEPLAY

World Director
World Objectives
Territory Capture
Extraction
Boss Raid
King of Coil
Apex Bounty
Branching Body
Organs
Keystones
Curses
Dynamic Biomes
Weather
Season Rules

MULTIPLAYER

20–30 Players
Bots
Reconnect
Server Authority
Room Scaling
Leaderboard
PvPvE
Co-op
PvP
```

---

# 346. Implementation Philosophy

Development should proceed in this order:

```text
Correctness
↓
Playability
↓
Multiplayer Stability
↓
Performance
↓
Systems
↓
Content
↓
Polish
↓
Scale
```

Do not reverse the order into:

```text
Massive Content
↓
Then Networking
↓
Then Performance
```

because the game may require large rewrites.

---

# 347. Final Recommendation

The recommended V2 foundation is:

```text
Phaser
+
Colyseus
+
NestJS
+
PostgreSQL
+
Redis
```

with the following gameplay systems prioritized first:

```text
1. World Objectives
2. Organ Segments
3. Keystone / Cursed Builds
4. Territory Capture
5. Boss Raid
6. Dynamic Biomes
7. Extraction
```

The most important technical milestone is:

```text
30 Players
+
Bots
+
Hundreds of Entities
+
Long Snakes
+
20 Hz Server
+
Stable Network
```

before expanding the game into a large live-service content library.

---

# END OF SERPENT SURVIVOR GDD V2 EXPANSION


---

# 348. User Authorization & Database Permission System

Serpent Survivor should use a server-side authorization system.

The client must never be trusted to determine:

```text
Role
Permission
Admin Status
Whitelist Status
Currency Grant
Unlock Status
Ban Status
Progression Override
```

All authorization decisions must be validated by the API Backend.

Recommended model:

```text
RBAC
Role-Based Access Control

+

Fine-Grained Permissions

+

Whitelist / Access Flags
```

---

# 349. Core User Roles

Recommended default roles:

```text
USER
MODERATOR
ADMIN
SUPER_ADMIN
```

Optional internal roles:

```text
QA
DEVELOPER
GAME_MASTER
SUPPORT
```

Roles should describe responsibility.

Permissions should describe actual allowed actions.

---

# 350. USER Role

Default account role.

Permissions:

```text
player:profile:read_own
player:profile:update_own

player:inventory:read_own
player:progression:read_own

match:join
match:leave

leaderboard:read

shop:read
shop:purchase

season:read

report:create
```

USER must never be able to:

```text
Modify currency directly
Modify EXP directly
Unlock snakes directly
Grant items
Modify another player
Create admin commands
Change role
Bypass matchmaking
Access hidden admin endpoints
```

---

# 351. MODERATOR Role

Moderator focuses on community and player management.

Example permissions:

```text
player:profile:read

player:mute
player:unmute

player:kick

player:report:read
player:report:resolve

player:chat:moderate

match:spectate

moderation:note:create
```

Optional:

```text
player:temporary_ban
```

Moderator should not normally have permission to:

```text
Grant currency
Set player level
Unlock all content
Change economy data
Edit game balance
Manage admin roles
```

---

# 352. ADMIN Role

ADMIN has full game-operation permissions.

Recommended permission namespace:

```text
player:*
game:*
economy:*
inventory:*
progression:*
match:*
leaderboard:*
moderation:*
whitelist:*
content:read
```

ADMIN can:

```text
View any player
Edit player progression
Grant currency
Remove currency
Grant items
Remove items
Unlock snakes
Unlock cosmetics
Unlock achievements
Change mastery
Change season progress
Reset player progression
Ban / Unban
Mute / Unmute
Kick
Move player between supported environments
Manage whitelist entries
Force match result review
Invalidate suspicious match results
```

ADMIN may also use controlled development operations such as:

```text
MAX PLAYER
MAX ACCOUNT
UNLOCK ALL
GRANT ALL
```

These operations must be executed through protected backend commands.

They must not be implemented as direct client-side DB writes.

---

# 353. ADMIN — Max Everything

For development, QA, support, or authorized operations, ADMIN can execute:

```text
MAX_PLAYER
```

Conceptual result:

```text
Player Level
→ Maximum

Gold
→ Configured Maximum

DNA
→ Configured Maximum

Evolution Points
→ Configured Maximum

Snake Unlocks
→ All

Species Mastery
→ Maximum

Meta Upgrades
→ Maximum

Achievements
→ All / Allowed Set

Cosmetics
→ All / Allowed Set

Season Progress
→ Maximum

Battle Pass
→ Maximum if enabled

Starter Loadouts
→ All

Organs
→ All

Keystones
→ All Known Unlocks

Permanent Upgrade Tree
→ Maximum
```

This should be a server-side operation.

Example logical command:

```text
POST /admin/players/:playerId/max
```

Required permission:

```text
player:progression:max
```

---

# 354. MAX_PLAYER Safety Rules

`MAX_PLAYER` should not blindly write arbitrary numeric maximum database values.

Use game-defined caps.

Example:

```text
MAX_GOLD = configured economy cap
MAX_DNA = configured economy cap
MAX_MASTERY = current content maximum
MAX_SEASON_LEVEL = current season maximum
```

Do not use:

```text
INT_MAX
BIGINT_MAX
999999999999999999
```

unless that value is intentionally part of game design.

This prevents:

```text
Overflow
UI Bugs
Economy Bugs
Leaderboard Bugs
Serialization Problems
Unexpected Balance Logic
```

---

# 355. SUPER_ADMIN Role

SUPER_ADMIN controls the authorization system itself.

Permission:

```text
*
```

SUPER_ADMIN can perform everything ADMIN can perform.

Additionally:

```text
Create Admin
Remove Admin
Assign Roles
Revoke Roles
Create Permissions
Change Role-Permission Mapping
Manage Critical System Configuration
Manage Internal Whitelist Types
View Full Admin Audit Logs
Invalidate Admin Sessions
```

Recommended rule:

> ADMIN can control game data. SUPER_ADMIN can control who is an ADMIN.

This prevents ordinary game administrators from promoting arbitrary accounts.

---

# 356. Optional Internal Roles

## QA

Used by testers.

Possible permissions:

```text
qa:debug_menu
qa:spawn_enemy
qa:spawn_boss
qa:grant_test_currency
qa:unlock_test_content
qa:teleport
qa:change_map
qa:force_event
```

QA operations should be restricted to:

```text
Development
Staging
Private QA Server
```

unless explicitly allowed in production.

---

## DEVELOPER

Possible permissions:

```text
dev:debug
dev:server_metrics
dev:room_inspect
dev:force_event
dev:content_reload
dev:test_match
```

Developer permission should not automatically imply:

```text
Production player moderation
Production economy modification
```

unless separately granted.

---

## GAME_MASTER

Possible live-event role:

```text
gm:start_event
gm:spawn_boss
gm:announce
gm:spectate
gm:event_reward
```

Useful for:

```text
Live Events
Community Events
Tournament Operations
Season Launches
```

---

# 357. Roles vs Permissions

Do not hardcode authorization like:

```text
if role == ADMIN
```

throughout the application.

Prefer:

```text
Permission Check
```

Example:

```text
player:currency:grant
```

A role simply receives a collection of permissions.

Conceptually:

```text
ADMIN
  │
  ├── player:read
  ├── player:update
  ├── player:currency:grant
  ├── player:progression:max
  ├── whitelist:create
  └── ...
```

This makes the authorization system easier to extend.

---

# 358. Permission Naming Convention

Recommended format:

```text
resource:action
```

or:

```text
resource:subresource:action
```

Examples:

```text
player:read
player:update

player:currency:grant
player:currency:remove

player:progression:set
player:progression:max
player:progression:reset

player:inventory:grant
player:inventory:remove

player:snake:unlock
player:snake:lock

player:ban
player:unban

match:spectate
match:terminate

whitelist:read
whitelist:create
whitelist:update
whitelist:delete

admin:audit:read
```

---

# 359. Permission Wildcards

Internal permission resolution may support wildcards.

Example:

```text
player:*
```

means:

```text
player:read
player:update
player:ban
player:inventory:grant
player:progression:max
...
```

Example:

```text
*
```

means all permissions.

Recommended:

```text
ADMIN
→ game-oriented wildcards

SUPER_ADMIN
→ *
```

Wildcard resolution must happen only on the trusted backend.

---

# 360. Recommended Authorization Tables

Recommended persistent tables:

```text
users

roles

permissions

user_roles

role_permissions

whitelist_entries

admin_audit_logs

moderation_actions
```

Optional:

```text
user_permission_overrides

role_inheritance

admin_sessions
```

---

# 361. Roles Table

Example:

```text
roles
--------------------------------
id
code
name
description
priority
is_system
created_at
updated_at
```

Example rows:

```text
1 | USER        | User
2 | MODERATOR   | Moderator
3 | ADMIN       | Administrator
4 | SUPER_ADMIN | Super Administrator
5 | QA          | Quality Assurance
6 | DEVELOPER   | Developer
```

`code` should be unique.

---

# 362. Permissions Table

Example:

```text
permissions
--------------------------------
id
code
description
created_at
```

Example:

```text
player:read

player:currency:grant

player:progression:max

whitelist:create

admin:audit:read
```

`code` must be unique.

---

# 363. User Roles Table

Many-to-many relation:

```text
user_roles
--------------------------------
user_id
role_id
granted_by
granted_at
expires_at
```

Composite uniqueness:

```text
UNIQUE(user_id, role_id)
```

A user may have:

```text
USER
+
QA
```

or:

```text
USER
+
GAME_MASTER
```

at the same time.

---

# 364. Role Permissions Table

```text
role_permissions
--------------------------------
role_id
permission_id
granted_at
```

Composite uniqueness:

```text
UNIQUE(role_id, permission_id)
```

This allows permissions to be changed without modifying application code.

---

# 365. User Permission Overrides

Optional advanced table:

```text
user_permission_overrides
--------------------------------
user_id
permission_id
effect
granted_by
expires_at
reason
```

`effect`:

```text
ALLOW
DENY
```

Example:

```text
User:
QA

Temporary Permission:
gm:start_event

Expires:
2026-10-01
```

Useful for temporary operational access.

---

# 366. Whitelist System

Whitelist should not be implemented as a single boolean:

```text
isWhitelisted = true
```

Instead use typed whitelist entries.

Recommended types:

```text
BETA_ACCESS

QA_ACCESS

DEV_ACCESS

ADMIN_PANEL

PRIVATE_SERVER

TEST_SERVER

EARLY_ACCESS

TOURNAMENT

CONTENT_CREATOR

INTERNAL_STAFF

FEATURE_ACCESS

IP_ALLOWLIST

MAINTENANCE_BYPASS
```

Optional future types:

```text
REGION_OVERRIDE
MATCHMAKING_OVERRIDE
SPECIAL_EVENT
PARTNER_ACCESS
```

---

# 367. Whitelist Entry Model

Recommended:

```text
whitelist_entries
--------------------------------
id

user_id

type

scope

value

environment

reason

created_by

created_at

expires_at

is_active
```

Example:

```text
user_id:
4821

type:
QA_ACCESS

scope:
GLOBAL

environment:
STAGING

reason:
Combat testing

expires_at:
2026-10-10
```

---

# 368. Whitelist Scope

Whitelist should support scopes.

Examples:

```text
GLOBAL

FEATURE

SERVER

ROOM

REGION

SEASON

EVENT

ENVIRONMENT
```

Example:

```text
type:
FEATURE_ACCESS

scope:
FEATURE

value:
branching_body_v2
```

Result:

```text
Only this user can access Branching Body V2.
```

---

# 369. Feature Whitelist

Feature whitelist is useful for unfinished systems.

Example:

```text
Feature:
extraction_mode

Allowed:
QA
DEVELOPER
Selected Players
```

Server check:

```text
Is feature globally enabled?
    │
    ├── YES
    │   └── Allow
    │
    └── NO
        │
        └── Check FEATURE_ACCESS whitelist
```

Examples:

```text
organ_system_v2

branching_body_v2

new_matchmaker

new_netcode

raid_hydra

season_preview
```

---

# 370. Private Server Whitelist

Private servers may restrict entry.

Example:

```text
Server:
QA-ARENA-01

Whitelist:
QA_ACCESS
```

Only approved accounts may join.

Alternative:

```text
Server:
TOURNAMENT-SEA-01

Whitelist:
TOURNAMENT
```

---

# 371. Test Environment Whitelist

Recommended environments:

```text
LOCAL

DEVELOPMENT

STAGING

PRODUCTION
```

Example rules:

```text
DEVELOPMENT
→ Developers allowed

STAGING
→ QA + Developers allowed

PRODUCTION
→ Normal Users
```

Maintenance periods may require:

```text
MAINTENANCE_BYPASS
```

---

# 372. Maintenance Mode

System configuration:

```text
maintenance_mode = true
```

Normal users receive:

```text
Server Maintenance
```

Accounts with:

```text
MAINTENANCE_BYPASS
```

may continue to access the game.

Recommended allowed roles:

```text
SUPER_ADMIN
ADMIN
DEVELOPER
QA
```

depending on environment policy.

---

# 373. IP Allowlist

Admin systems may optionally use IP allowlisting.

Example:

```text
ADMIN_PANEL
+
Valid Admin Role
+
Allowed IP
```

This is an additional security layer.

It should not replace:

```text
Authentication
Authorization
MFA
Session Security
```

IP allowlist is optional because administrators may work from dynamic networks.

---

# 374. Admin Panel Access

Admin role alone does not necessarily need to imply UI access.

Recommended requirement:

```text
Authenticated Account
+
Required Permission
+
ADMIN_PANEL whitelist
```

Example:

```text
Role:
ADMIN

Permission:
player:progression:max

Whitelist:
ADMIN_PANEL
```

Then allow the admin dashboard.

This makes it possible to temporarily disable panel access without removing the account's role.

---

# 375. Admin Authentication

Admin accounts should have stronger authentication requirements.

Recommended:

```text
Password / SSO
+
MFA
```

Optional:

```text
Shorter Session Lifetime
IP Risk Check
Device Confirmation
Security Notification
```

Never store:

```text
Plaintext Password
Plaintext MFA Secret in logs
Session Token in audit logs
```

---

# 376. Admin API Separation

Recommended route groups:

```text
/api/*
```

for normal players.

And:

```text
/admin/*
```

for administrative actions.

Examples:

```text
GET  /admin/players/:id

POST /admin/players/:id/currency

POST /admin/players/:id/max

POST /admin/players/:id/ban

POST /admin/players/:id/unban

POST /admin/players/:id/unlock-all

POST /admin/whitelist

DELETE /admin/whitelist/:id
```

Every endpoint must still perform permission checks.

Route naming alone is not security.

---

# 377. Admin MAX Commands

Recommended explicit commands:

```text
MAX_PLAYER

MAX_MASTERY

MAX_META_UPGRADES

MAX_SEASON

UNLOCK_ALL_SNAKES

UNLOCK_ALL_COSMETICS

UNLOCK_ALL_ACHIEVEMENTS

GRANT_MAX_CURRENCY

RESET_PLAYER

RESET_SEASON_PROGRESS
```

Avoid one generic endpoint such as:

```text
POST /admin/sql
```

or:

```text
POST /admin/raw-db-write
```

Production administration should use controlled domain commands.

---

# 378. Admin Currency Grant

Example operation:

```text
Player:
4821

Currency:
DNA

Amount:
5000

Reason:
Customer support compensation
```

Stored audit entry:

```text
Admin
Target Player
Action
Before Value
After Value
Delta
Reason
Timestamp
Request ID
```

---

# 379. Admin Audit Log

Every sensitive admin action must be logged.

Recommended:

```text
admin_audit_logs
--------------------------------
id

actor_user_id
actor_role

action

target_type
target_id

before_data
after_data

reason

ip_address
user_agent

request_id

created_at
```

Sensitive credentials must never be stored in `before_data` or `after_data`.

---

# 380. Audit Actions

Examples:

```text
PLAYER_MAXED

CURRENCY_GRANTED

CURRENCY_REMOVED

ITEM_GRANTED

ITEM_REMOVED

PLAYER_BANNED

PLAYER_UNBANNED

ROLE_GRANTED

ROLE_REVOKED

WHITELIST_CREATED

WHITELIST_REMOVED

PROGRESSION_RESET

MATCH_INVALIDATED

SEASON_PROGRESS_SET
```

---

# 381. Admin Reason Requirement

High-impact operations should require a reason.

Examples:

```text
MAX_PLAYER

BAN_PLAYER

GRANT_LARGE_CURRENCY

RESET_ACCOUNT

ROLE_CHANGE
```

Example:

```text
Reason:
QA production verification ticket QA-382
```

This improves traceability.

---

# 382. Moderation Actions

Recommended table:

```text
moderation_actions
--------------------------------
id

target_user_id

type

reason

created_by

created_at

expires_at

revoked_at
revoked_by
```

Types:

```text
WARNING

MUTE

TEMP_BAN

PERMA_BAN

MATCH_BAN

CHAT_BAN
```

---

# 383. Ban Scopes

Ban does not need to be all-or-nothing.

Possible scopes:

```text
ACCOUNT

CHAT

MATCHMAKING

RANKED

TRADING

TOURNAMENT

SPECIFIC_GAME_MODE
```

Example:

```text
RANKED BAN:
7 days

Normal Open Arena:
Allowed
```

---

# 384. Permission Cache

Permissions may be cached in Redis.

Example:

```text
authz:user:4821
```

Cached result:

```text
roles
permissions
whitelist flags
```

Recommended short TTL:

```text
30–300 seconds
```

When roles or permissions change:

```text
Invalidate Cache
```

Authorization must still have a persistent database source of truth.

---

# 385. Role Change Propagation

When an administrator changes a role:

```text
Update PostgreSQL
↓
Invalidate Redis Permission Cache
↓
Invalidate / Refresh Admin Session if required
↓
New Permissions Become Effective
```

For critical revocation:

```text
Force Session Revalidation
```

---

# 386. Game Server Authorization Token

The Game Server should not query PostgreSQL for permissions every tick.

When joining:

```text
Client
↓
API Authentication
↓
Short-lived Join Token
↓
Game Server
↓
Validate Token
```

Join token may contain trusted claims such as:

```text
playerId
sessionId
allowedMode
serverId
expiration
```

Do not include unnecessary admin permissions in normal gameplay tokens.

---

# 387. Debug Permissions in Game Server

If internal users need debug commands, use explicit permissions.

Examples:

```text
qa:spawn_enemy
qa:spawn_boss
qa:kill_all_enemies
qa:grant_upgrade
qa:set_length
qa:set_level
qa:teleport
qa:force_event
```

Server verifies the debug permission before executing.

The client merely requests the command.

---

# 388. Production Debug Restrictions

Recommended:

```text
LOCAL:
All developer debug tools

DEVELOPMENT:
Developer + QA debug tools

STAGING:
Controlled QA debug tools

PRODUCTION:
Disabled by default
```

Production debug operations require:

```text
Explicit Permission
+
Whitelist
+
Audit Log
```

---

# 389. Example Access Matrix

| Capability | USER | MODERATOR | QA | ADMIN | SUPER_ADMIN |
|---|---:|---:|---:|---:|---:|
| Play Game | Yes | Yes | Yes | Yes | Yes |
| Read Own Profile | Yes | Yes | Yes | Yes | Yes |
| Read Any Player | No | Yes | Optional | Yes | Yes |
| Spectate Match | No | Yes | Yes | Yes | Yes |
| Mute Player | No | Yes | Optional | Yes | Yes |
| Ban Player | No | Limited | No | Yes | Yes |
| Grant Currency | No | No | Test Only | Yes | Yes |
| Max Player | No | No | Test Only | Yes | Yes |
| Unlock All | No | No | Test Only | Yes | Yes |
| Manage Whitelist | No | No | No | Yes | Yes |
| Assign ADMIN | No | No | No | No | Yes |
| Manage Permissions | No | No | No | No | Yes |
| View Full Audit Log | No | Limited | No | Optional | Yes |

---

# 390. Database Account Security

Application authorization roles are different from PostgreSQL database users.

Do not connect the game application using:

```text
postgres superuser
```

Recommended database identities:

```text
serpent_api

serpent_worker

serpent_migration

serpent_readonly
```

Example:

```text
serpent_api
→ normal application CRUD

serpent_worker
→ job-related tables

serpent_migration
→ schema migration only

serpent_readonly
→ analytics / support read access
```

This follows least-privilege principles.

---

# 391. No Direct Database Access for Game Admins

A game ADMIN should normally not receive PostgreSQL credentials.

Admin flow:

```text
Admin Panel
↓
NestJS Admin API
↓
Authorization Guard
↓
Domain Service
↓
Database
↓
Audit Log
```

Not:

```text
Admin
↓
Connect pgAdmin
↓
UPDATE users ...
```

Direct database access should be limited to authorized infrastructure/database operators.

---

# 392. NestJS Authorization Layer

Recommended backend flow:

```text
Authentication Guard
↓
Role / Permission Resolver
↓
Permission Guard
↓
Controller
↓
Service
↓
Database
```

Conceptually:

```text
@RequirePermission("player:progression:max")
POST /admin/players/:id/max
```

The authorization guard checks the authenticated user.

---

# 393. Whitelist Guard

Feature endpoints may use:

```text
@RequireWhitelist("FEATURE_ACCESS", "extraction_mode")
```

Conceptual flow:

```text
Feature Globally Enabled?
│
├── Yes
│   └── Allow
│
└── No
    │
    └── Has Whitelist?
        │
        ├── Yes → Allow
        └── No  → Deny
```

---

# 394. Temporary Permissions

Operational permissions should support expiration.

Example:

```text
User:
QA-102

Permission:
qa:force_event

Expires:
2026-09-30 23:59
```

After expiry:

```text
Permission automatically becomes invalid.
```

Useful for:

```text
Temporary contractors
Tournament staff
QA sessions
Live events
Emergency support
```

---

# 395. Temporary Whitelist

Whitelist entries should also support expiration.

Example:

```text
CONTENT_CREATOR

Starts:
2026-10-01

Expires:
2026-10-07
```

This avoids manual cleanup.

---

# 396. Emergency Access

Optional:

```text
BREAK_GLASS_ADMIN
```

Use only for emergency operations.

Requirements:

```text
MFA
Explicit reason
Short expiration
Immediate audit alert
Restricted user list
```

This role should never be a normal day-to-day account.

---

# 397. Authorization Design Principle

The final rule:

```text
CLIENT REQUESTS

SERVER DECIDES

DATABASE RECORDS

AUDIT EXPLAINS
```

No privileged operation should depend only on:

```text
Hidden UI Button
Client Role Variable
Local Storage
Frontend Route Protection
```

Those are UX controls, not security boundaries.

---

# 398. Recommended Authorization Summary

```text
NORMAL ACCESS

USER
↓
Play Game
↓
Own Profile
↓
Normal Progression


MODERATION

MODERATOR
↓
Reports
↓
Mute
↓
Kick
↓
Limited Ban


TESTING

QA / DEVELOPER
↓
Whitelisted Environment
↓
Debug Commands
↓
Test Content


GAME ADMINISTRATION

ADMIN
↓
player:*
game:*
economy:*
inventory:*
progression:*
whitelist:*
↓
MAX PLAYER
UNLOCK ALL
GRANT / REMOVE
BAN / UNBAN
MANAGE WHITELIST


AUTHORIZATION ADMINISTRATION

SUPER_ADMIN
↓
*
↓
Manage Admins
Manage Roles
Manage Permissions
Critical Configuration
```

---

# 399. Authorization MVP

Minimum implementation before an Admin Panel:

```text
roles
permissions
user_roles
role_permissions
whitelist_entries
admin_audit_logs
```

Initial roles:

```text
USER
MODERATOR
ADMIN
SUPER_ADMIN
QA
```

Initial whitelist types:

```text
QA_ACCESS
ADMIN_PANEL
FEATURE_ACCESS
PRIVATE_SERVER
MAINTENANCE_BYPASS
```

Initial high-value admin permissions:

```text
player:read
player:ban
player:unban

player:currency:grant
player:currency:remove

player:inventory:grant

player:progression:set
player:progression:max
player:progression:reset

player:snake:unlock

whitelist:read
whitelist:create
whitelist:delete

admin:audit:read
```

This is sufficient for the first operational administration system.

---

# END OF AUTHORIZATION / RBAC / WHITELIST EXPANSION

