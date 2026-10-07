# 183. Persistent Backend & Database

Serpent Survivor requires a persistent backend layer separate from the realtime game simulation.

The backend is responsible for:

* Player accounts
* Authentication
* Player profiles
* Persistent currencies
* Snake unlocks
* Species mastery
* Permanent upgrades
* Achievements
* Match history
* Seasonal progression
* Leaderboards
* Room / server discovery
* Matchmaking
* Player statistics
* Content versioning

The backend must **not** calculate every realtime gameplay frame.

Realtime combat remains the responsibility of the authoritative Game Server.

---

# 184. Recommended High-Level Architecture

```text
                    ┌───────────────────────┐
                    │      WEB CLIENT       │
                    │                       │
                    │ Rendering / Input     │
                    │ Prediction / UI       │
                    └───────────┬───────────┘
                                │
                ┌───────────────┴────────────────┐
                │                                │
             HTTPS                           WebSocket
                │                                │
                ▼                                ▼
       ┌─────────────────┐             ┌─────────────────┐
       │   API BACKEND   │             │   GAME SERVER   │
       │                 │             │                 │
       │ Auth            │             │ Authoritative   │
       │ Profile         │             │ Simulation      │
       │ Inventory       │             │ Movement        │
       │ Progression     │             │ Collision       │
       │ Leaderboard     │             │ Combat          │
       │ Matchmaking     │             │ EXP             │
       └───────┬─────────┘             │ Upgrade RNG     │
               │                       │ Bots            │
       ┌───────┴────────┐              └────────┬────────┘
       │                │                       │
       ▼                ▼                       ▼
┌────────────┐    ┌────────────┐         Match Result
│ PostgreSQL │    │   Redis    │              │
│            │    │            │              ▼
│ Permanent  │    │ Temporary  │        API / Event Queue
│ Data       │    │ State      │
└────────────┘    └────────────┘
```

---

# 185. Persistent vs Realtime Data

The system must clearly separate **persistent data** and **temporary match data**.

## Persistent — PostgreSQL

Examples:

```text
Account
Player Profile
Currencies
Unlocked Snakes
Snake Mastery
Achievements
Permanent Upgrades
Match History
Season Ranking
Player Statistics
Cosmetics
```

This information survives between sessions.

---

## Temporary — Redis / Game Server Memory

Examples:

```text
Current Server
Room Population
Player Presence
Matchmaking Queue
Reconnect Token
Current Match
Player Position
Current Length
Current HP
Current EXP
Current Build
Active Buffs
Current Upgrade Choices
Bot State
Enemy State
Projectile State
```

This information usually disappears when the match ends.

The game must **never write snake position to PostgreSQL every game tick.**

---

# 186. Core Database Model

Recommended persistent entities:

```text
users
player_profiles

player_wallets

snake_definitions
player_snakes
player_snake_mastery

meta_upgrade_definitions
player_meta_upgrades

achievement_definitions
player_achievements

matches
match_players
match_results
match_builds

seasons
leaderboard_entries

content_versions
```

---

# 187. Player

Example:

```text
Player
-------------------------
id
username
display_name
created_at
last_login_at
status
```

Player authentication should use a permanent Player ID instead of trusting names sent by the client.

---

# 188. Player Progression

Persistent progression includes:

```text
Gold
DNA
Evolution Points

Unlocked Snakes
Snake Mastery
Achievements
Meta Upgrades
Cosmetics
Season Progress
```

Example:

```text
Player
 |
 ├── Wallet
 ├── Snake Unlocks
 ├── Snake Mastery
 ├── Meta Upgrades
 ├── Achievements
 ├── Match History
 └── Seasonal Rankings
```

---

# 189. Match Persistence

When a match starts:

```text
Game Server
↓
Creates Match ID
↓
Players Join
↓
Realtime gameplay remains in memory
```

During the match, the database should not be continuously updated with every combat event.

When the match finishes:

```text
Game Server
↓
Final Match Result
↓
Validate Result
↓
Store Match
↓
Store Player Results
↓
Award Currency
↓
Update Mastery
↓
Update Achievements
↓
Update Leaderboard
```

---

# 190. Match History

Recommended information:

```text
Match ID
Server ID
Game Mode
Map
Started At
Ended At
Duration
Game Version
Balance Version
```

Per player:

```text
Player ID
Snake
Kills
Deaths
Level
Maximum Length
Damage
Boss Damage
Final Score
EXP
Gold
Build
Evolutions
Hidden Synergies Activated
```

Saving the final build is useful for:

* Player match history
* Balance analysis
* Build statistics
* Anti-cheat investigation
* Future replay systems

---

# 191. Content Versioning

Upgrade balance must be versioned.

Example:

```text
Game Version:
1.2.0

Balance Version:
2026.09.01

Upgrade Pool:
upgrade-set-17
```

This prevents an old match from being evaluated using new balance values.

---

# 192. Realtime Multiplayer Mode — Open Arena

Add a new primary game mode:

# OPEN ARENA

This mode is inspired by the drop-in/drop-out structure of games such as slither.io.

Unlike normal Survivor matches:

```text
The Arena is already running.

Player joins.
↓
Spawns.
↓
Grows.
↓
Builds.
↓
Fights.
↓
Dies.
↓
Respawns or leaves.
```

There is no requirement for all players to press Ready simultaneously.

---

# 193. Open Arena Population

Recommended configuration:

```text
Maximum Players:
30

Soft Target Population:
24

Minimum Active Population:
20 including Bots
```

The server attempts to maintain approximately:

```text
20–30 active snakes
```

at all times.

---

# 194. Open Arena Lifecycle

Example:

```text
SERVER START
↓
WORLD CREATED
↓
Bots Spawn
↓
Players Join
↓
Players Leave
↓
Bots Dynamically Adjust
↓
World Events
↓
Boss Events
↓
Leaderboard Continues
```

The server can run continuously instead of terminating after every player's death.

---

# 195. Player Life Cycle

```text
JOINING
↓
SPAWNING
↓
ALIVE
↓
DEAD
↓
RESULT
↓
RESPAWN
```

A player does not necessarily leave the server after death.

---

# 196. Spawn Rules

Players should never spawn directly beside the strongest snake.

Recommended spawn validation:

```text
Distance from large players
Distance from active bosses
Enemy density
Food availability
Map danger
Other spawn locations
```

New players receive:

```text
2–3 second spawn protection
```

Protection immediately ends when the player attacks another player.

---

# 197. Death in Open Arena

When a player dies:

```text
Snake Body
↓
Partially converts into Food / Growth Orbs
```

Recommended:

```text
25–30% recoverable body value
```

is converted into loot.

This prevents a single kill from creating uncontrollable snowballing.

---

# 198. Respawning

After death:

```text
Death Screen
↓
3–5 second delay
↓
Respawn
```

The player starts again with:

```text
Base Length
Level 1
Starter Ability
Species Passive
```

The previous in-run build is lost.

Persistent progression remains.

---

# 199. Open Arena Leaderboard

Display continuously:

```text
RANK   PLAYER     SCORE     LENGTH    KILLS

1      Player A   18,430     87        14
2      Player B   16,920     73         9
3      Player C   15,450     92         6
4      BOT-RAVEN  12,210     61         7
...
```

Recommended ranking score:

```text
Score
=
Growth Score
+
PvE Score
+
PvP Score
+
Elite Score
+
Boss Score
+
Survival Score
```

Length should contribute to score but should not be the only ranking metric.

---

# 200. Online Level-Up Behaviour

Single-player currently allows the game to pause during level-up.

This cannot work the same way in realtime multiplayer because one player must not pause the server for everyone else.

Therefore:

## Solo

```text
Level Up
→ Game Pauses
→ Choose Upgrade
```

## Multiplayer

```text
Level Up
→ Upgrade Panel Appears
→ Game Continues
```

The player can continue steering while choosing.

Recommended competitive timer:

```text
5 seconds
```

If no upgrade is selected:

```text
Auto-select one option.
```

Alternatively:

```text
Level-up choices enter an Upgrade Queue.
```

The player can open the queue when safe.

---

# 201. Server Authoritative Multiplayer

The client must never determine:

```text
Player position truth
Damage
Kill
EXP
Growth
Loot
Upgrade rarity
Upgrade roll
Leaderboard score
```

The server is authoritative.

The client sends only gameplay intentions such as:

```text
turnDirection
boost
skillPressed
upgradeSelected
```

Example:

```text
Client:
"I am turning toward 82°."

Server:
Calculates legal movement.

Server:
Broadcasts resulting position.
```

Not:

```text
Client:
"My new position is X=904 Y=287."
```

---

# 202. Recommended Simulation Frequencies

Initial target:

```text
Server Simulation:
20 Hz

Network Snapshots:
10–15 Hz

Client Rendering:
60 FPS
```

The client interpolates remote players between network snapshots.

This allows smooth visuals without requiring the server to transmit the whole world 60 times per second.

---

# 203. Snake Network Optimization

A long snake may contain dozens or hundreds of body segments.

Do not network every segment independently.

Instead synchronize:

```text
Head Position
Head Direction
Speed
Body Path
Important Segment State
```

The client reconstructs segment positions from the path.

Conceptually:

```text
HEAD
↓
movement history
↓
segment 1
↓
segment 2
↓
segment 3
...
```

This significantly reduces bandwidth.

---

# 204. Area of Interest

Players should receive detailed updates only about nearby entities.

Example:

```text
World

┌─────────────────────────────┐
│                             │
│           distant           │
│                             │
│       ┌─────────────┐       │
│       │ Player AOI  │       │
│       │             │       │
│       │      P      │       │
│       │             │       │
│       └─────────────┘       │
│                             │
└─────────────────────────────┘
```

Inside AOI:

```text
High update frequency
```

Far away:

```text
Low update frequency
or
No update
```

Spatial Hash / Grid partitioning is recommended.

---

# 205. Automatic Bot Population

Bots are used to keep servers populated when there are too few human players.

The Bot Director belongs to the Game Server.

---

# 206. Bot Population Algorithm

Recommended constants:

```text
MAX_PLAYERS = 30

SOFT_TARGET = 24

MIN_ACTIVE_POPULATION = 20

MAX_BOTS = 18
```

Bot requirement:

```text
desiredBots =
min(
    MAX_BOTS,
    max(0, SOFT_TARGET - humanPlayers)
)
```

Examples:

```text
2 Humans
18 Bots
20 Total
```

```text
8 Humans
16 Bots
24 Total
```

```text
15 Humans
9 Bots
24 Total
```

```text
20 Humans
4 Bots
24 Total
```

```text
24 Humans
0 Bots
```

```text
30 Humans
0 Bots
```

This ensures low-population servers still feel alive.

---

# 207. Human Player Priority

Bots must never block real players from joining.

When:

```text
Current Population = 30
Humans = 22
Bots = 8
```

and a human player wants to enter:

```text
Human joins
↓
One Bot becomes RETIRING
↓
Bot disappears after death
or leaves through arena boundary
```

Recommended:

Do not instantly delete a bot in front of players.

---

# 208. Bot States

```text
SPAWNING
FARMING
HUNTING
ESCAPING
FIGHTING
BOSSING
LOOTING
RETREATING
RETIRING
DEAD
```

---

# 209. Bot Personalities

Bots should not all behave identically.

## Farmer

Prioritizes:

```text
Food
EXP
Growth
Avoiding players
```

## Hunter

Prioritizes:

```text
Weak players
PvP
Head interception
```

## Survivor

Prioritizes:

```text
Safety
Mobility
Avoiding danger
```

## Aggressor

Prioritizes:

```text
Close combat
Body traps
High-risk kills
```

## Objective Bot

Prioritizes:

```text
Elite
Boss
World Event
Objectives
```

---

# 210. Bot Skill Levels

Bots can use multiple skill profiles.

```text
Beginner
Intermediate
Advanced
```

The difference should come from:

```text
Reaction time
Prediction distance
Risk tolerance
Aim accuracy
Decision quality
Build quality
```

Never from hidden stat bonuses.

Bots use exactly the same:

```text
Movement
Damage
HP
Cooldown
Collision
Upgrade Rules
```

as humans.

---

# 211. Bot Fairness

Bots must not possess information unavailable to humans.

Bots should have:

```text
Limited perception radius
Reaction delay
Imperfect prediction
Limited target switching
```

Example reaction times:

```text
Beginner:
300–500 ms

Intermediate:
180–300 ms

Advanced:
100–200 ms
```

Bots should not:

```text
Know hidden enemies outside vision
Instantly dodge attacks
Read player inputs
Ignore collision
Teleport
Receive free upgrades
```

---

# 212. Bot Performance Optimization

AI does not need to think at server simulation frequency.

Example:

```text
Server Simulation:
20 Hz

Bot Decision:
5–10 Hz
```

Movement continues between decisions.

This greatly reduces CPU usage when a room contains many bots.

---

# 213. Bot Ranking Rules

Bots should be clearly marked:

```text
[BOT] Raven
[BOT] Nova
```

Bots can appear in the live arena leaderboard for gameplay purposes.

However:

```text
Bots do not enter:
Global Player Leaderboard
Season Ranking
Achievement Ranking
```

---

# 214. Upgrade Rarity System

The existing upgrade system is extended so that every upgrade roll has a rarity.

Rarity tiers:

```text
COMMON
RARE
EPIC
LEGENDARY
MYTHIC
```

Example visual structure:

```text
COMMON
Basic numerical improvement.

RARE
Stronger stat + small secondary effect.

EPIC
Strong effect or mechanic modification.

LEGENDARY
Build-defining behaviour.

MYTHIC
Run-changing mechanic.
```

---

# 215. Example Rarity Scaling

Example:

## Fire Segment

### Common

```text
+10 Fire Damage
```

### Rare

```text
+18 Fire Damage
+5% Burn Duration
```

### Epic

```text
+28 Fire Damage
Burn spreads to one nearby enemy
```

### Legendary

```text
Burning enemies explode on death
```

### Mythic

```text
Every fifth Burn tick triggers Inferno Pulse
```

Rarity should not only mean:

```text
larger number
```

Higher rarities should increasingly change behaviour.

---

# 216. Suggested Rarity Weights

Initial tuning:

```text
Early Run

Common       70%
Rare         24%
Epic          5%
Legendary     1%
Mythic        0%
```

Mid Run:

```text
Common       55%
Rare         30%
Epic         12%
Legendary   2.8%
Mythic      0.2%
```

Late Run:

```text
Common       40%
Rare         32%
Epic         20%
Legendary     7%
Mythic        1%
```

These values are starting balance targets and should be tuned using telemetry.

---

# 217. Luck & Rarity

Luck does not directly add a flat chance to Mythic.

Instead it increases the weight of higher rarity groups.

Conceptually:

```text
FinalWeight
=
BaseWeight
× LuckModifier
× LevelModifier
× EventModifier
× ChestModifier
```

This makes Luck valuable without allowing Mythic probability to become uncontrollable.

---

# 218. Upgrade Tags

Every upgrade should contain gameplay tags.

Example:

```text
Fire Segment

Tags:
[
  FIRE,
  ELEMENT,
  BODY,
  DAMAGE,
  BURN
]
```

Another:

```text
Critical Growth

Tags:
[
  CRITICAL,
  GROWTH,
  UTILITY
]
```

Tags become the foundation of the advanced synergy system.

---

# 219. Upgrade Interaction System

Upgrades should not exist independently.

The player's build is continuously evaluated by a:

# SYNERGY RESOLVER

Whenever the player:

```text
Receives Upgrade
Levels Upgrade
Adds Segment
Moves Segment
Receives Mutation
Receives Evolution
```

the game re-evaluates synergy rules.

---

# 220. Synergy Types

Five primary synergy types are recommended.

## Element Synergy

```text
Fire + Poison
```

## Mechanical Synergy

```text
Critical + Explosion
```

## Segment Adjacency

```text
Fire Segment
next to
Lightning Segment
```

## Threshold Synergy

```text
3+ Lightning upgrades
```

## Rarity Synergy

```text
2 Epic Fire upgrades
```

---

# 221. Hidden Attributes

Some upgrade combinations activate an additional hidden property.

This system is called:

# HIDDEN TRAITS

Example:

```text
Fire Segment
+
Poison Fang
```

activates:

```text
Toxic Ignition
```

Effect:

```text
Burning poisoned enemies explode on death.
```

The hidden trait is not one of the player's normal level-up selections.

It is automatically activated when its conditions become true.

---

# 222. Hidden Trait States

```text
LOCKED
↓
HINTED
↓
ACTIVE
↓
DISCOVERED
```

## LOCKED

Player has insufficient related components.

UI:

```text
Nothing shown.
```

## HINTED

Player is close to satisfying the requirement.

UI:

```text
??? Synergy Detected
Requirement: 2 / 3
```

## ACTIVE

The hidden attribute activa
