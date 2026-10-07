# SERPENT SURVIVOR — GAME DESIGN DOCUMENT

## Bổ sung bảo mật và dữ liệu — 06/10/2026

- Phạm vi quét bảo mật là ứng dụng BE/FE, không quét Windows. Không tuyên bố phát hiện mọi phần mềm hack hoặc bảo đảm không có mã độc chỉ từ npm audit.
- Copy giao diện, danh mục report/kiểm duyệt, các giới hạn tài khoản, presence và chính sách proxy phải đọc từ PostgreSQL qua API có version. Không thêm bảng mặc định runtime khi API lỗi; fixture kiểm thử nằm riêng từng dự án. Cấu hình bằng 0 hợp lệ phải được giữ nguyên, không bị `||` thay bằng số hardcode.
- Report cần danh mục DB, quota/cooldown, chống lặp, xác minh target và bảo vệ dữ liệu người báo cáo. Thông tin room/match/account lấy từ authority. Không tự ban từ report hoặc packet lỗi; cần kiểm chứng và thao tác quản trị được cấp quyền.
- Lý do ban công khai tách ghi chú nội bộ. Phiên tài khoản bị ban chỉ xem dữ liệu bảo mật của chính mình và gửi yêu cầu xem xét; không vào trận hoặc quản trị. Report/appeal resolution cũng cần MFA, permission, whitelist, reason, audit và idempotency.
- Không render chuỗi DB thành HTML/script; escape theo ngữ cảnh và kiểm tra màu/ID. Proxy chỉ nhận request target hợp lệ, không tin forwarded headers từ client; danh tính proxy phải được xác minh. Secrets không nằm trong frontend.
- Trạng thái đã kiểm thử, dữ liệu đã chuyển và những giới hạn còn lại ghi tại `docs/SECURITY.md`; không tuyên bố toàn bộ text/fallback lịch sử đã được chuyển nếu chưa rà hết.

## Quy tắc triển khai bổ sung — 24/09/2026

Yêu cầu này áp dụng cho toàn bộ dự án và updatev2.md:

- PostgreSQL là nguồn dữ liệu chính cho roles, permissions, ánh xạ quyền, chính sách truy cập, whitelist, giới hạn kinh tế, cấu hình hệ thống, danh mục và thông số gameplay. Không quyết định quyền bằng tên role hoặc danh sách quyền hardcode trong runtime.
- Giá trị mặc định chỉ được ghi bằng migration/seed có phiên bản, không ghi đè cấu hình đã chỉnh khi khởi động lại. Dữ liệu seed không phải nguồn cấu hình vận hành.
- Backend đọc và kiểm tra dữ liệu từ DB; Redis chỉ cache/queue/presence. Trận đấu dùng bản chụp nội dung có version tải từ DB khi tạo phòng, không truy vấn DB trong simulation tick. Client nhận danh mục công khai từ API, không nhận bí mật hoặc quyền quản trị để tự quyết định truy cập.
- Thay đổi cấu hình/quyền qua lệnh quản trị có permission, MFA, kiểm tra schema, lý do, audit trước/sau và chống lặp; vô hiệu cache/phiên liên quan. Thay đổi quyền phải có hiệu lực với các phiên đang chạy.
- Thuật toán, bộ xử lý hành vi, hợp đồng giao thức, kiểm tra kiểu và giới hạn an toàn kỹ thuật nằm trong mã nguồn. Mật khẩu, khóa mã hóa và thông tin kết nối nằm trong môi trường/bộ quản lý bí mật; không đưa vào danh mục công khai.
- Migration cộng thêm và sao lưu trước khi áp dụng dữ liệu thật. Giữ PostgreSQL/Redis trên Docker và giữ volume. Không reset dữ liệu của người dùng để triển khai tính năng.
- Chỉ công bố tính năng hoặc năng lực tải đã được kiểm thử. Ghi rõ phần chưa hoàn tất trong tài liệu trạng thái.
- Từ 25/09/2026, `be/` và `fe/` phải hoạt động độc lập: mỗi bên sở hữu dependencies/node_modules, package-lock, scripts, tests, build và cấu hình. Không dùng workspace, shared folder, symlink hoặc import xuyên dự án. Backend giữ Docker, DB/Redis, migration, worker, monitoring và dữ liệu vận hành. Frontend có máy chủ giao diện riêng và chỉ gọi backend qua HTTP/WebSocket với protocol có version; không chứa secret hoặc truy cập DB. Root chỉ giữ tài liệu. Engine/codec cần cho mỗi phía được duy trì riêng, kiểm thử tương thích qua mạng khi thay đổi.


## Mục tiêu bổ sung — 05/10/2026

- Mục tiêu mới của người dùng: hơn 1.500 users trong daily hours và 5.000 trong peak hours. Tạm hiểu là CCU để kiểm tra theo trường hợp nặng hơn, cần xác nhận nếu là DAU; các mục tiêu 200–300 CCU ở phần thiết kế ban đầu bên dưới là lịch sử, không phải chứng nhận tải.
- Đo tăng dần nhiều phòng/process, tick, snapshot, ACK, mất kết nối, CPU/RAM và băng thông. Phân biệt số đã đo, giới hạn máy thử và ước lượng; không công bố mức tải chỉ vì mở được WebSocket. Xem kết quả và phần chưa kiểm chứng tại `docs/CAPACITY.md`.
- Nội dung SEO, metadata, FAQ, trang hướng dẫn, domain canonical và trạng thái index do PostgreSQL quản lý. FE render HTML công khai qua API versioned, không chứa DB/secret. Local chưa có domain giữ noindex; không hứa vị trí đầu Google. Cấu hình SEO vẫn theo permission, whitelist, MFA, reason, audit và idempotency. Xem `docs/SEO.md`.

## 1. Document Information

**Working Title:** Serpent Survivor  
**Genre:** Action Roguelite / Survivor / Snake / Arena Survival  
**Platform:** Web Browser (Desktop first, Mobile adaptable)  
**Camera:** Top-down 2D  
**Session Length:** 10–20 minutes per run  
**Primary Modes:** Solo PvE, Multiplayer Co-op PvE, Multiplayer PvPvE  
**Session Model:** Room-based / Lobby-based  
**Target Game Server Capacity:** 20–30 concurrent players per game server / room  
**Initial Game Server Pool:** Approximately 10 concurrent game servers  
**Initial Target Concurrency:** Approximately 200–300 simultaneous in-game players (CCU)  
**Core USP:** **Build Your Body** — the snake's body is not only length or health; each body segment can become a skill, weapon, defense module, elemental node, support unit, or combo component.

---

# 2. High-Level Concept

Serpent Survivor combines the familiar “snake eats and grows” mechanic with the progression structure of modern Survivor-like games.

The player controls a snake that moves continuously through an arena, eating food, collecting experience, fighting enemies, growing longer, and constructing a build during each run.

The main difference from a normal Snake game is that the body itself becomes the player's build.

A longer snake is not simply stronger. Length creates:

- More health
- More body slots
- More elemental modules
- More passive effects
- More attack points
- More combo opportunities
- More surface area that can be hit
- Lower maneuverability
- Higher risk

The player constantly balances growth, mobility, damage, survivability, and body composition.

---

# 3. Design Pillars

## 3.1 Easy to Understand, Hard to Master

The base mechanic should remain immediately understandable:

> Move → Eat → Grow → Avoid danger.

The strategic depth comes later through:

- Segment arrangement
- Build synergies
- Evolutions
- Mutations
- Positioning
- Risk management
- Boss mechanics

---

## 3.2 Body = Build

The player's body must always matter.

A player's build should be visible directly on the snake.

Example:

```text
HEAD
 |
🔥 Fire Segment
🔥 Fire Segment
⭐ Fire Core
⚡ Lightning Segment
⚡ Lightning Segment
🛡 Armor Segment
☠ Poison Segment
☠ Poison Segment
 |
TAIL
```

The player should be able to look at the snake and understand what kind of build they are playing.

---

## 3.3 Growth Must Have a Cost

Growing longer gives power but also increases vulnerability.

Advantages:

- More health
- More module slots
- More passive attacks
- Larger area control
- More segment combos

Disadvantages:

- Harder turning
- More body exposed
- Easier for ranged enemies to hit
- Harder to escape dangerous areas
- More difficult to protect the tail
- Certain bosses punish excessive length

---

## 3.4 Every Run Should Create a Different Story

Runs should feel different through:

- Random upgrade choices
- Different food drops
- Segment rarity
- Mutations
- Evolutions
- Events
- Elite modifiers
- Boss order
- Map modifiers

---

# 4. Target Player Experience

The player should experience the following emotional progression:

## Early Run

- Small
- Fast
- Vulnerable
- Simple
- Focused on eating and positioning

## Mid Run

- Build identity becomes visible
- Elemental effects begin chaining
- Enemy density increases
- Player starts deciding how to arrange segments

## Late Run

- Snake becomes visually impressive
- Build produces screen-wide effects
- Player manages large-scale positioning
- Enemies attack from multiple angles
- Boss fights challenge specific weaknesses

## End Game

The player should feel that they created a unique “monster” rather than simply leveled up a character.

---

# 5. Core Gameplay Loop

```text
Move
↓
Eat Food / Kill Enemies
↓
Gain EXP / Length / Resources
↓
Level Up
↓
Choose 1 of 3 Upgrades
↓
Add or Improve Segment
↓
Create Synergy
↓
Fight Stronger Enemies
↓
Defeat Elite / Boss
↓
Receive Chest / Evolution / Mutation
↓
Survive Until Final Boss
↓
Receive Meta Progression Rewards
```

---

# 6. Controls

## Desktop

### Movement Option A — Mouse Steering

The snake continuously moves forward and turns toward the mouse cursor.

Recommended for browser-first gameplay.

### Movement Option B — Keyboard

- W / Up Arrow: accelerate
- A / Left Arrow: turn left
- D / Right Arrow: turn right
- S / Down Arrow: brake

### Active Skills

- Space: Skill 1
- Q: Skill 2
- E: Skill 3

---

# 7. Snake Anatomy

Each snake consists of:

```text
HEAD
↓
BODY SEGMENTS
↓
TAIL
```

## 7.1 Head

The most important part.

Properties may include:

- Head damage
- Bite damage
- Collision damage
- Turning control
- Active skill origin
- Certain special abilities

If the head reaches zero HP or receives lethal damage under certain game rules, the run ends.

---

## 7.2 Body Segments

Body segments are the foundation of the build system.

Possible types:

- Normal
- Fire
- Ice
- Poison
- Lightning
- Armor
- Spike
- Regeneration
- Summoner
- Core
- Explosive
- Magnetic
- Void
- Crystal
- Mechanical

---

## 7.3 Tail

Tail may have unique mechanics.

Possible future systems:

- Tail teleport
- Tail bomb
- Tail decoy
- Tail whip
- Tail regeneration point

---

# 8. Length System

Length represents the number of body segments.

Example:

```text
Length = 15
```

The snake contains:

- 1 Head
- 13 Body Segments
- 1 Tail

Length increases through:

- Food
- Level rewards
- Skills
- Boss rewards
- Mutations
- Meta upgrades

---

# 9. Length as Health

Recommended core mechanic:

> Body length functions as the primary health system.

When the snake takes significant damage, body segments can be destroyed.

Example:

```text
Before hit:

HEAD
●
●
●
●
●
TAIL

After hit:

HEAD
●
●
●
TAIL
```

This creates visible damage.

---

## 9.1 Advantages of Length-as-HP

- Damage is immediately visible
- Snake fantasy becomes stronger
- Healing can visually restore segments
- Defensive builds become meaningful
- Sacrifice mechanics become possible
- Boss attacks can target specific sections

---

# 10. Segment Damage

A segment may have:

```text
Segment HP
Armor
Resistance
Special effect
Rarity
Element
```

Example:

### Normal Segment

HP: 100

### Armor Segment

HP: 250

### Explosive Segment

HP: 80

When destroyed:

> Deals 300 area damage.

---

# 11. Growth System

Food increases growth points.

Example:

```text
100 Growth Points = +1 Body Segment
```

Different foods provide different values.

---

# 12. Food Types

## Red Food

Effect:

```text
+20 Growth
```

---

## Purple Food

Effect:

```text
+25 EXP
```

---

## Green Food

Effect:

```text
Restore damaged segment HP
```

---

## Blue Food

Effect:

```text
Reduce skill cooldown
```

---

## Gold Food

Effect:

```text
+Gold
```

---

## Rainbow Food

Rare.

Effect:

```text
Random premium reward
```

Possible outcomes:

- High EXP
- Extra segment
- Temporary buff
- Rare upgrade
- Chest

---

## Black Food

Risk-reward item.

Example:

```text
+50 Growth
-10% current health
```

---

# 13. Experience & Leveling

Players gain EXP through:

- Enemy kills
- Purple food
- Quests
- Events
- Elite kills
- Boss rewards

On level up, gameplay pauses and the player receives three upgrade choices.

Example:

```text
LEVEL UP

[ Fire Body II ]

[ +15% Movement Speed ]

[ Poison Fang I ]
```

The player chooses one.

---

# 14. Upgrade Categories

Upgrades are divided into:

## Offensive

- Damage
- Attack speed
- Critical
- Elemental damage
- Area damage

## Defensive

- Armor
- Regeneration
- Segment HP
- Damage reduction

## Utility

- Movement
- Pickup range
- Growth
- EXP gain
- Luck

## Segment

- Add special body segments
- Upgrade existing segment types

## Skill

- Active abilities
- Passive abilities

## Evolution

High-tier transformations.

---

# 15. Core Attributes

## Movement Speed

Controls forward speed.

## Turn Speed

Controls rotational responsiveness.

Long snakes may receive a turning penalty.

---

## Growth Rate

Increases growth gained from food.

---

## EXP Gain

Multiplies EXP obtained.

---

## Pickup Range

Allows the snake to attract nearby drops.

---

## Luck

Affects:

- Upgrade rarity
- Chest quality
- Rare food rate
- Mutation quality
- Elite drops

---

## Critical Chance

Probability of critical damage.

---

## Critical Damage

Multiplier applied when critical occurs.

---

## Body Damage

Damage enemies receive when touching the body.

---

## Head Damage

Damage caused by the head.

---

## Armor

Reduces incoming damage.

---

## Regeneration

Repairs damaged segments over time.

---

# 16. Segment System

Segments are the defining mechanic of the game.

---

## 16.1 Normal Segment

Basic body segment.

Possible benefits:

- Maximum HP
- Upgrade foundation

---

## 16.2 Fire Segment

Deals fire contact damage.

Possible upgrade path:

```text
Fire I
↓
Fire II
↓
Burn
↓
Explosion
↓
Inferno
```

---

## 16.3 Ice Segment

Applies slow.

Higher upgrades may:

- Freeze enemies
- Create ice trails
- Reduce enemy attack speed

---

## 16.4 Poison Segment

Applies poison stacks.

Possible advanced effect:

```text
Poisoned enemy death
→ Poison cloud
```

---

## 16.5 Lightning Segment

Automatically attacks nearby enemies.

Possible upgrades:

- Chain count
- Range
- Attack speed
- Shock effect

---

## 16.6 Armor Segment

Higher durability.

Possible effects:

- Damage reduction
- Reflect damage
- Protect neighboring segments

---

## 16.7 Spike Segment

Deals high contact damage.

Best for aggressive positioning.

---

## 16.8 Regeneration Segment

Repairs nearby damaged segments.

---

## 16.9 Explosive Segment

Detonates when destroyed.

---

## 16.10 Summoner Segment

Periodically spawns smaller snakes.

Mini snakes automatically hunt enemies.

---

## 16.11 Core Segment

Buffs neighboring segments.

Example:

```text
🔥 🔥 ⭐ 🔥 🔥
```

Fire Core:

```text
Nearby Fire Segments:
+50% damage
+20% attack speed
```

---

# 17. Segment Arrangement

Players can periodically rearrange segments.

Recommended timing:

- During level-up
- At special shrines
- During pause menu
- After boss fights

Not recommended during real-time combat unless the game is intentionally highly tactical.

---

# 18. Segment Combo System

Adjacent segments create combinations.

---

## Fire Resonance

Requirement:

```text
🔥 🔥 🔥
```

Effect:

```text
+25% Fire Damage
```

---

## Lightning Resonance

Requirement:

```text
⚡ ⚡ ⚡
```

Effect:

```text
+1 Chain Target
```

---

## Poison Cluster

Requirement:

```text
☠ ☠ ☠
```

Effect:

Poison spreads when enemies die.

---

## Fortress

Requirement:

```text
🛡 🛡 🛡
```

Effect:

```text
+15% global damage reduction
```

---

# 19. Hybrid Segment Combos

Different elements create special reactions.

---

## Fire + Poison

```text
Toxic Flame
```

Poisoned enemies burn.

Burning poisoned enemies explode on death.

---

## Ice + Lightning

```text
Frozen Lightning
```

Shocked enemies have a chance to freeze.

---

## Fire + Lightning

```text
Plasma
```

Creates high-damage chain explosions.

---

## Ice + Armor

```text
Frozen Scale
```

Enemies hitting the snake are slowed.

---

# 20. Evolution System

Evolution occurs when specific upgrade conditions are met.

Example:

```text
Fire Body Lv.5
+
Growth Lv.3
+
Fire Core
=
INFERNO SERPENT
```

---

# 21. Evolution List

## 21.1 Inferno Serpent

Requirement:

- Fire Body Lv.5
- Growth Lv.3
- Fire Core

Effect:

Every third Fire Segment emits a fire explosion.

---

## 21.2 Thunder Serpent

Requirement:

- Lightning Lv.5
- Attack Speed Lv.3

Effect:

All Lightning Segments attack simultaneously every few seconds.

---

## 21.3 Venom Burst

Requirement:

- Poison Lv.5
- Critical Lv.3

Effect:

Poison can critically strike.

Poison kills trigger explosions.

---

## 21.4 Frozen Fortress

Requirement:

- Ice Lv.5
- Armor Lv.3

Effect:

Nearby enemies become progressively frozen.

---

## 21.5 Living Fortress

Requirement:

- Armor Lv.5
- Regeneration Lv.5

Effect:

Destroyed body segments regenerate automatically.

---

## 21.6 Plague Serpent

Requirement:

- Poison Lv.5
- Summoner Lv.3

Effect:

Mini snakes spread poison.

---

## 21.7 Plasma Coil

Requirement:

- Fire Lv.4
- Lightning Lv.4

Effect:

Body creates high-energy plasma arcs.

---

## 21.8 Frost Thunder

Requirement:

- Ice Lv.4
- Lightning Lv.4

Effect:

Lightning attacks freeze multiple enemies.

---

## 21.9 Blood Serpent

Requirement:

- Regeneration Lv.4
- Critical Lv.4

Effect:

Critical kills restore segment HP.

---

## 21.10 Endless Serpent

Requirement:

- Growth Lv.5
- Regeneration Lv.4

Effect:

Growth has no soft cap.

---

# 22. Mutation System

Mutations are powerful run-changing modifiers.

They should usually have meaningful trade-offs.

---

## Giant Snake

```text
+100% body size
+50% body damage
-25% movement speed
```

---

## Tiny Predator

```text
-50% body size
+30% movement speed
+100% critical damage
```

---

## Glass Serpent

```text
+150% damage
-60% segment HP
```

---

## Infinite Growth

```text
No length soft cap
Turn speed decreases with length
```

---

## Cannibal

Allows the snake to consume weakened enemies directly.

Effect:

```text
Heal + Growth
```

---

## Berserk Head

```text
+200% head damage
-30% body defense
```

---

## Living Bomb

Destroyed segments explode.

---

## Parasite Skin

Enemies touching the body receive a stacking debuff.

---

## Golden Blood

Gold drops restore HP.

---

## Evolution Instability

Higher chance to receive evolution upgrades.

But:

```text
+20% enemy damage
```

---

# 23. Active Skills

Players can equip up to three active abilities.

---

## Dash

Short burst of speed.

Uses:

- Escape
- Attack
- Reposition

---

## Coil

The snake automatically curls into a circle.

Enemies trapped inside receive damage.

---

## Shed Skin

The snake sacrifices several segments.

Creates a decoy snake body.

Enemies attack the decoy.

---

## Devour

The head rapidly consumes nearby low-health enemies.

---

## Time Slow

Slows all enemies.

---

## Tail Warp

Teleports the head to the tail position.

Creates high-skill movement opportunities.

---

## Frenzy

Temporary:

```text
+Attack speed
+Movement speed
+Body damage
```

---

# 24. Signature Mechanic — Serpent Circle

The player can intentionally connect head and tail.

When a closed loop is created:

```text
     HEAD─────
     │       │
     │ Enemy │
     │       │
     └──TAIL─┘
```

A Serpent Circle activates.

---

## Basic Effect

Enemies inside receive continuous damage.

---

## Scaling

Smaller circles deal more damage.

Example:

```text
Large circle:
x1 damage

Medium circle:
x1.5 damage

Small circle:
x2.5 damage
```

---

## Possible Upgrades

### Burning Circle

Creates fire inside.

### Poison Prison

Enemies rapidly accumulate poison.

### Electric Cage

Lightning chains between body segments.

### Frozen Ring

Enemies cannot escape for several seconds.

---

# 25. Enemy Design Philosophy

Enemies should attack different weaknesses.

A good enemy roster should prevent one build from solving every situation.

---

# 26. Standard Enemies

## Chaser

Basic melee enemy.

Moves directly toward head.

---

## Swarm

Very low HP.

Appears in large groups.

---

## Brute

Slow.

High HP.

High collision damage.

---

## Archer

Attacks from range.

---

## Bomber

Explodes on death.

---

## Tail Biter

Attempts to reach the tail.

---

## Parasite

Attaches to a body segment.

Reduces that segment's effectiveness.

---

## Leech

Steals EXP pickups.

---

## Splitter

Divides into smaller enemies after death.

---

## Shield Enemy

Must be attacked from certain angles.

---

# 27. Elite Enemies

Elite enemies receive randomized modifiers.

Possible modifiers:

- Giant
- Fast
- Explosive
- Vampiric
- Shielded
- Poisonous
- Frozen
- Teleporter
- Regenerating
- Berserk

Example:

```text
Elite Spider
Modifiers:
Giant
Explosive
```

---

# 28. Boss Philosophy

Bosses should test specific player behaviors.

Each boss should challenge at least one of:

- Head positioning
- Tail protection
- Long-body management
- Mobility
- Circle usage
- Segment durability
- Elemental specialization

---

# 29. Boss Concepts

## 29.1 The Eagle

Theme:

Predator from above.

Mechanics:

- Targets head
- Dive attacks
- Shadow warning
- Carries away body segments temporarily

---

## 29.2 Spider Queen

Mechanics:

- Web zones
- Immobilizes segments
- Spawns spiders
- Webs can split the arena

---

## 29.3 Centipede King

Enemy composed of multiple destructible body segments.

Players must destroy sections gradually.

---

## 29.4 Snake Hunter

Specialized anti-serpent enemy.

Mechanics:

- Tail attacks
- Traps
- Segment cutting

---

## 29.5 Black Hole

Environmental boss.

Mechanics:

- Constant gravitational pull
- Projectiles orbit center
- Long snakes are heavily affected

---

## 29.6 Mirror Serpent

Creates a copy of the player's build.

Forces the player to fight their own strategy.

---

## 29.7 Final Boss — World Devourer

Large arena-scale serpent.

Battle phases:

### Phase 1

Normal combat.

### Phase 2

Arena becomes smaller.

### Phase 3

Boss begins consuming food and growing.

### Phase 4

Both snakes attempt to encircle each other.

---

# 30. Run Timeline

Recommended 20-minute run.

---

## 0–3 Minutes

- Learn movement
- Basic enemies
- First segment upgrades

---

## 3–5 Minutes

- Enemy density increases
- First Elite

---

## 5 Minutes

Boss 1

---

## 5–10 Minutes

Build specialization begins.

---

## 10 Minutes

Boss 2

---

## 10–15 Minutes

Hybrid enemies appear.

Mutations become available.

---

## 15 Minutes

Boss 3

---

## 15–20 Minutes

High-density survival phase.

---

## 20 Minutes

Final Boss

---

# 31. Chest System

Elites and Bosses can drop chests.

Possible chest rewards:

- Upgrade existing skill
- Add special segment
- Mutation
- Evolution
- Gold
- Rare food
- Temporary buff

---

# 32. Chest Rarity

```text
Wood
Silver
Gold
Diamond
Mythic
```

Higher rarity increases number and quality of rewards.

---

# 33. Combo Kill System

Kills within a short period increase combo.

Example:

```text
10 Kill Combo
50 Kill Combo
100 Kill Combo
500 Kill Combo
```

Rewards:

- EXP multiplier
- Gold bonus
- Temporary attack bonus

Combo resets if the player goes too long without killing.

---

# 34. In-Run Quests

Examples:

- Kill 100 Spiders
- Eat 30 Red Foods
- Reach Length 50
- Kill 20 enemies using Body Damage
- Create 3 Serpent Circles
- Survive 60 seconds without damage
- Kill an Elite without losing a segment

Rewards:

- EXP
- Chest
- Mutation choice
- Temporary buff

---

# 35. Random Events

## Golden Rain

Gold food falls across the map.

---

## Blood Moon

```text
Enemy Count ×3
EXP ×2
```

---

## Hunter Arrival

A powerful Elite hunts the player.

---

## Mutation Zone

A special map area appears.

Entering grants mutation selection.

---

## Food Frenzy

Food spawn rate increases.

---

## Darkness

Visibility is limited.

---

# 36. Snake Species

Snake species function as playable characters.

---

## 36.1 Common Snake

Balanced beginner snake.

---

## 36.2 Cobra

Focus:

Poison.

Starting Ability:

Poison Fang.

Passive:

```text
+30% poison damage
```

---

## 36.3 Python

Focus:

Body Damage / Tank.

Passive:

```text
+40% Body Damage
+20% Segment HP
-15% Movement Speed
```

---

## 36.4 Viper

Focus:

Critical damage.

---

## 36.5 Electric Serpent

Focus:

Lightning.

---

## 36.6 Dragon Serpent

Focus:

Fire.

---

## 36.7 Ghost Snake

Focus:

Mobility.

Passive ability periodically allows the snake to pass through enemies.

---

## 36.8 Crystal Snake

Focus:

Defense / reflection.

---

# 37. Species Progression Tree

Example:

```text
Common Snake
      |
  -----------
  |         |
Cobra     Python
  |         |
Viper    Anaconda
  |
Venom King
```

Unlock requirements may include:

- Run completion
- Boss kills
- Achievements
- Meta currency

---

# 38. Meta Progression

After every run, the player receives persistent currencies.

---

# 39. Meta Currencies

## Gold

Used for:

- Small stat upgrades
- Starter upgrades

---

## DNA

Used for:

- Snake unlocks
- Mutations
- Evolution trees

---

## Evolution Points

Rare currency.

Used for:

- High-level permanent systems
- Species mastery
- Advanced talents

---

# 40. Permanent Upgrade Examples

- +1% Movement Speed
- +1% Growth Rate
- +1 Starting Segment
- +1% EXP Gain
- +1% Luck
- +1% Body Damage

Permanent upgrades must remain small enough that skill still matters.

---

# 41. Species Mastery

Playing a snake increases mastery.

Example:

```text
Cobra Mastery Lv.1
+2% Poison Damage

Lv.10
Start with Poison Segment

Lv.25
Unlock Venom Mutation

Lv.50
Unlock Venom King Skin
```

---

# 42. Map Design

Maps should influence gameplay mechanically.

---

## Forest

Features:

- Trees
- Bushes
- Hidden enemies

---

## Desert

Features:

- Sandstorms
- Reduced visibility
- Heat zones

---

## Ice Cavern

Features:

- Sliding
- Frozen areas
- Lower turning control

---

## Volcano

Features:

- Lava
- Eruptions
- Fire enemies

---

## Swamp

Features:

- Poison pools
- Slow zones

---

## Cyber City

Features:

- Laser grids
- Mechanical enemies

---

## Space

Features:

- Low gravity
- Movement distortion

---

# 43. Environmental Hazards

Possible hazards:

- Spikes
- Lava
- Lightning zones
- Poison pools
- Moving walls
- Traps
- Falling rocks
- Laser sweeps

---

# 44. Difficulty Scaling

Difficulty increases based on:

```text
Time
Player Level
Player Length
Boss Count
Map Difficulty
```

Enemy scaling should prioritize:

- Density
- Mechanics
- Attack patterns

instead of only increasing HP.

---

# 45. Dynamic Difficulty

Optional advanced system.

If a player becomes extremely powerful:

- More ranged enemies
- More elite modifiers
- Increased enemy speed
- Special counter-enemies

The game should challenge strong builds without completely invalidating them.

---

# 46. Damage Types

Recommended damage categories:

- Physical
- Fire
- Ice
- Poison
- Lightning
- Void

---

# 47. Status Effects

## Burn

Damage over time.

## Freeze

Reduces movement.

## Poison

Stacking damage.

## Shock

Increases chance of chain attacks.

## Bleed

Damage based on movement.

## Corruption

Reduces defense.

---

# 48. Item Rarity

```text
Common
Rare
Epic
Legendary
Mythic
```

Rarity can affect:

- Segment stats
- Skill values
- Mutation quality
- Chest rewards

---

# 49. Suggested Upgrade Pool

At launch, target approximately 30 standard upgrades.

---

## Offensive Upgrades

1. Head Damage
2. Body Damage
3. Critical Chance
4. Critical Damage
5. Attack Speed
6. Fire Damage
7. Poison Damage
8. Lightning Damage
9. Ice Effect
10. Explosion Radius

---

## Defensive Upgrades

11. Segment HP
12. Armor
13. Regeneration
14. Damage Reduction
15. Reflect Damage

---

## Utility Upgrades

16. Movement Speed
17. Turn Speed
18. Growth Rate
19. EXP Gain
20. Pickup Range
21. Luck

---

## Segment Upgrades

22. Fire Segment
23. Ice Segment
24. Poison Segment
25. Lightning Segment
26. Armor Segment
27. Spike Segment
28. Regeneration Segment
29. Explosive Segment
30. Core Segment

---

# 50. Suggested Launch Evolutions

Launch with approximately 15–20 evolutions.

Core examples:

1. Inferno Serpent
2. Thunder Serpent
3. Venom Burst
4. Frozen Fortress
5. Living Fortress
6. Plague Serpent
7. Plasma Coil
8. Frost Thunder
9. Blood Serpent
10. Endless Serpent
11. Toxic Inferno
12. Crystal Storm
13. Electric Fortress
14. Living Plague
15. World Coil

---

# 51. Suggested Launch Mutations

Target around 10–15 mutations.

Examples:

1. Giant Snake
2. Tiny Predator
3. Glass Serpent
4. Infinite Growth
5. Cannibal
6. Berserk Head
7. Living Bomb
8. Parasite Skin
9. Golden Blood
10. Evolution Instability
11. Double Tail
12. Hollow Body
13. Blood Hunger
14. Elemental Instability
15. Immortal Scale

---

# 52. UI Structure

## Main Menu

```text
PLAY
SNAKES
UPGRADES
COLLECTION
ACHIEVEMENTS
SETTINGS
```

---

# 53. Character Selection Screen

Displays:

- Snake model
- Passive
- Starting skill
- Difficulty
- Mastery
- Unlock condition

---

# 54. Gameplay HUD

Recommended elements:

### Top Left

- Player HP / Length
- Level
- EXP

### Top Center

- Timer
- Boss timer

### Top Right

- Gold
- Kill count
- Combo

### Bottom

- Active skills
- Cooldowns

### Side Panel

Optional:

- Current segment combo
- Evolution progress

---

# 55. Level-Up Screen

Example:

```text
LEVEL 12

Choose Upgrade

[ Fire Segment II ]
+15 Fire Damage

[ Growth II ]
+20% Growth

[ Armor Segment ]
Adds one Armor Segment
```

---

# 56. Segment Management Screen

Possible display:

```text
HEAD

[🔥]
[🔥]
[⭐]
[⚡]
[⚡]
[🛡]
[☠]

TAIL
```

Player can drag segments to rearrange.

---

# 57. Evolution Indicator

When conditions approach completion:

```text
Inferno Serpent

Fire Body 5/5
Growth 2/3
Fire Core ✓
```

This encourages targeted build planning.

---

# 58. Death Screen

Displays:

- Survival Time
- Maximum Length
- Kills
- Elites
- Bosses
- Damage Dealt
- Favorite Element
- Evolutions
- Gold Earned
- DNA Earned

---

# 59. Achievement System

Examples:

## Long Boi

Reach Length 100.

## Ring of Death

Kill 100 enemies using Serpent Circle.

## Pyromaniac

Deal 1,000,000 Fire Damage.

## Untouchable

Survive 5 minutes without losing a segment.

## World Eater

Defeat Final Boss.

---

# 60. Collection / Codex

Players can view:

- Enemies
- Bosses
- Snakes
- Segments
- Evolutions
- Mutations
- Maps

Unknown content should appear hidden until discovered.

---

# 61. Economy Design

The game should avoid requiring excessive grind.

Recommended loop:

```text
Run
↓
Earn Gold + DNA
↓
Unlock small upgrades
↓
Unlock new snake
↓
Try new build
↓
Discover evolution
↓
Complete harder map
```

---

# 62. Optional Monetization

For a web game, if monetization is desired:

Recommended:

- Cosmetic skins
- Visual effects
- Snake trails
- Alternative head models
- Optional premium content packs

Avoid pay-to-win mechanics that directly increase run power.

---

# 63. Skin Ideas

- Skeleton Snake
- Neon Snake
- Dragon Snake
- Robot Snake
- Candy Snake
- Galaxy Snake
- Lava Snake
- Ice Snake
- Golden Snake

---

# 64. Audio Direction

Music should intensify as the run progresses.

Example layers:

```text
0–5 min:
Light

5–10 min:
Additional percussion

10–15 min:
Higher tempo

15–20 min:
Full combat track
```

---

# 65. Sound Feedback

Important SFX:

- Food pickup
- Level up
- Segment add
- Segment destroyed
- Evolution
- Mutation
- Elite spawn
- Boss spawn
- Circle activation

---

# 66. Visual Feedback

Every mechanic should be readable.

Examples:

Burn:

Orange-red flame particles.

Poison:

Green/purple cloud.

Freeze:

Blue crystalline effect.

Lightning:

Bright electric chain.

Armor:

Metallic / shield icon.

---

# 67. Accessibility

Recommended settings:

- Reduced particles
- Screen shake toggle
- High contrast mode
- Colorblind-friendly elemental icons
- Adjustable UI scale
- Keyboard-only mode
- Mouse-only mode

---

# 68. Web Performance Strategy

Because this is a browser game, the design should avoid uncontrolled object counts.

Important constraints:

- Enemy pooling
- Projectile pooling
- Simplified collision groups
- Limited persistent particles
- Optimized segment rendering
- LOD for distant enemies

Visual spectacle should come from efficient effects rather than thousands of persistent objects.

---

# 69. Data-Driven Content Design

Most content should be configurable.

Recommended entity definitions:

```text
Snake
Enemy
Boss
Segment
Upgrade
Evolution
Mutation
Food
Map
Event
Quest
```

Each content object should be data-driven so balancing does not require major code changes.

---

# 70. Suggested Game States

```text
BOOT
MAIN_MENU
CHARACTER_SELECT
MAP_SELECT
RUN
LEVEL_UP
PAUSE
BOSS_REWARD
DEATH
RESULT
META_UPGRADE
```

---

# 71. MVP Scope

The first playable version should focus only on proving the core loop.

---

## MVP Features

### Player

- Snake movement
- Growth
- Length system

### Combat

- Head collision damage
- Body collision damage

### Segments

- Normal
- Fire
- Poison
- Armor

### Enemies

- Chaser
- Swarm
- Brute
- Archer

### Boss

- 1 Boss

### Progression

- EXP
- Level up
- 3 choices

### Upgrades

Approximately 10–12.

### Run

10-minute survival.

---

# 72. MVP Success Criteria

The MVP is successful if:

1. Movement feels satisfying.
2. Growth creates meaningful gameplay.
3. Longer snakes feel stronger but harder to control.
4. Segment upgrades visibly change gameplay.
5. Players naturally want to try another build.
6. A run remains interesting for at least 10 minutes.

---

# 73. Vertical Slice

After MVP, create a polished vertical slice.

Target content:

- 2 maps
- 4 snake species
- 20 upgrades
- 8 segment types
- 8 evolutions
- 5 mutations
- 10 enemy types
- 3 bosses
- Meta progression
- Achievements

---

# 74. Version 1.0 Scope

Suggested target:

## Snakes

8

## Maps

5–7

## Enemies

20+

## Bosses

8–10

## Segments

12–15

## Standard Upgrades

30+

## Evolutions

20+

## Mutations

15+

## Random Events

10+

---

# 75. Development Roadmap

## Phase 1 — Prototype

Focus:

- Movement
- Snake body
- Eating
- Growth

---

## Phase 2 — Combat

Add:

- Enemies
- Damage
- Death
- Drops

---

## Phase 3 — Survivor Loop

Add:

- EXP
- Leveling
- Upgrade selection
- Difficulty scaling

---

## Phase 4 — Segment System

Add:

- Elemental segments
- Segment damage
- Arrangement

---

## Phase 5 — Build System

Add:

- Combos
- Evolution
- Mutation

---

## Phase 6 — Content

Add:

- Maps
- Bosses
- Enemy variety
- Events

---

## Phase 7 — Meta

Add:

- Unlocks
- Mastery
- Achievements
- Persistent upgrades

---

## Phase 8 — Polish

Focus:

- Audio
- VFX
- UI
- Performance
- Balance

---

# 76. Multiplayer-First Direction

Multiplayer is a core game mode rather than only a future expansion.

The game supports three primary ways to play:

1. **Solo PvE**
2. **Co-op Survivor**
3. **PvPvE Arena**

All multiplayer sessions use a room/lobby model.

---

# 77. Multiplayer Game Modes

## 77.1 Solo PvE

Traditional Survivor-style run.

Recommended players:

```text
1
```

Uses the same progression, bosses, evolutions, and mutations as multiplayer.

---

## 77.2 Co-op Survivor

Multiple players share the same arena and cooperate against increasingly difficult enemy waves.

Target room size:

```text
20 players: Recommended normal load
30 players: Hard room cap
```

Co-op can still organize players into smaller squads inside the same 20–30 player world.

Core cooperative mechanics:

- Shared boss encounters
- Team revives
- Element reactions between players
- Team quests
- Shared world events
- Individual builds
- Individual snake bodies
- Optional shared loot rules
- Team score
- Team survival timer

Example cooperative reaction:

```text
Player A: Fire Snake
+
Player B: Poison Snake
=
Toxic Flame Reaction
```

Possible team effects:

- Fire + Poison → Toxic Flame
- Ice + Lightning → Frozen Storm
- Armor + Regeneration → Team Fortress
- Lightning + Fire → Plasma Field

---

## 77.3 PvPvE Arena

Players compete against one another while monsters, elites, bosses, hazards, and events continue to exist.

Target room size:

```text
20 players: Recommended normal load
30 players: Maximum competitive room size
```

Players:

- Fight monsters
- Gain EXP
- Grow
- Build their snake
- Contest Elite enemies
- Contest bosses
- Attack rivals
- Trap rivals using body positioning
- Steal dropped food
- Compete for score and objectives

When a player dies:

```text
Destroyed Body
↓
Drops a percentage of stored Growth / EXP / Gold
↓
Other players can consume the drops
```

The whole corpse should not necessarily convert to loot because this may create extreme snowballing.

Recommended anti-snowball rule:

```text
Only 20–35% of recoverable run resources become loot.
```

---

## 77.4 Team PvPvE

Optional mode.

Example:

```text
2 Teams × 4 Players
4 Teams × 3 Players
```

Objectives may include:

- Boss damage
- Total kills
- Territory control
- Survival score
- Resource collection
- Last team alive

---

# 78. Room & Lobby System

Every multiplayer session begins in a room.

Room states:

```text
CREATED
↓
WAITING
↓
READY_CHECK
↓
STARTING
↓
IN_GAME
↓
RESULT
↓
CLOSED
```

---

## 78.1 Create Room

The creator becomes Room Host.

Host can configure:

- Room name
- Public / Private
- Password
- Game mode
- Map
- Difficulty
- Maximum players
- Friendly fire
- Run duration
- Region
- Spectator permission
- Join-in-progress rule
- Loot rule

Example:

```text
Room: Giang's Arena
Mode: Co-op Survivor
Map: Cyber City
Players: 4/8
Region: SEA
Difficulty: Hard
Visibility: Public
```

---

## 78.2 Join Room

Players can join through:

- Public room browser
- Room code
- Invite link
- Friend invite
- Quick Match
- Matchmaking

Example room code:

```text
X7KD92
```

---

## 78.3 Room Browser

Display:

- Room name
- Mode
- Current players
- Maximum players
- Map
- Difficulty
- Region
- Estimated ping
- Password status
- Run status

Filters:

- Mode
- Region
- Available slots
- Difficulty
- Public only
- Ping
- Map

---

## 78.4 Quick Match

Quick Match automatically selects a suitable room using:

1. Region
2. Ping
3. Available slot
4. Game mode
5. Difficulty preference

For competitive modes, matchmaking can later include hidden MMR.

---

## 78.5 Ready Check

Players must select:

- Snake
- Starting loadout
- Cosmetic
- Ready status

Example:

```text
Player                 Snake        Ping      Status
Giang                   Cobra        24 ms     READY
Player02                Python       41 ms     READY
Player03                Viper        37 ms     NOT READY
Player04                Ghost        67 ms     READY
```

The host can start only when the minimum player requirement is met.

---

# 79. Multiplayer Player States

A connected player can be in:

```text
LOBBY
READY
LOADING
ALIVE
DOWNED
DEAD
SPECTATING
DISCONNECTED
RECONNECTING
LEFT
```

---

# 80. Join-In-Progress

Recommended rules differ by mode.

## Co-op

Allow players to join during the run until a cutoff.

Example:

```text
Join allowed before Minute 10.
```

Late players receive catch-up EXP based on the team's average level.

---

## Competitive PvPvE

Recommended:

```text
No normal join after match start.
```

This avoids unfair late spawning.

Disconnected players may reconnect.

---

# 81. Reconnect System

Web players may lose connection due to:

- Wi-Fi change
- Mobile network instability
- Browser background state
- Temporary server disconnect

Recommended reconnect window:

```text
60–120 seconds
```

During disconnect:

### Co-op

The snake may:

- Become invulnerable and stationary for a short grace period, then
- Become AI-controlled, or
- Be temporarily removed from combat.

### PvPvE

To prevent abuse:

- Short grace period only
- Server keeps authoritative player state
- Reconnected player returns to the same state when possible

---

# 82. Spectator Mode

Dead players can spectate:

- Teammates
- Remaining players
- Boss fight
- Leaderboard

Controls:

```text
Previous Player
Next Player
Free Camera — optional
```

Spectators must not reveal hidden information to active players in competitive modes.

---

# 83. Co-op Revive System

When a player loses all effective body health:

```text
ALIVE
↓
DOWNED
↓
REVIVED or DEAD
```

Recommended downed timer:

```text
20 seconds
```

Teammates revive by staying near the player's head/core.

Possible revive cost:

- Time
- Growth
- Team energy
- Revive charge

To prevent infinite revives:

```text
Each player starts with 1–2 revive opportunities.
```

---

# 84. Multiplayer Loot Rules

Possible room settings:

## Personal Loot

Only the owner can collect selected drops for a short time.

Best for:

- Co-op
- Casual play

## Shared Loot

Any player can collect everything.

Best for:

- Chaos modes
- Competitive modes

## Hybrid

Boss chest is personal.

Normal food is shared.

Recommended default for Co-op.

---

# 85. Multiplayer Scaling

Enemy scaling should account for active players.

Example design:

```text
Base Enemy HP
× Player Count Modifier
× Difficulty Modifier
```

Do not scale enemy HP linearly with every additional player.

Recommended philosophy:

Additional players should primarily increase:

- Enemy count
- Attack directions
- Elite frequency
- Boss mechanics

rather than creating damage-sponge enemies.

---

# 86. Multiplayer Boss Mechanics

Bosses can react to multiple snakes.

Examples:

### Eagle

Marks one player's head while another player can attack safely.

### Spider Queen

Webs one snake and forces teammates to destroy web anchors.

### Black Hole

Separates the party into different orbit zones.

### Mirror Serpent

Copies the build of the strongest or randomly selected player.

### World Devourer

Targets different team members during each phase.

---

# 87. Multiplayer Serpent Circle

Multiple players can create cooperative circles.

Example:

```text
Player A forms half-circle
Player B closes the area
```

Result:

```text
TEAM SERPENT CIRCLE
```

Possible effects:

- Increased trapped area
- Elemental combination
- Boss crowd control
- Team damage multiplier

---

# 88. Player Identity

Every player needs clear visual identification.

Display:

- Player name
- Player color indicator
- Snake icon
- Team icon
- Health/length state
- Downed state
- Ping warning when necessary

Do not rely on color alone.

Use:

- Name
- Symbol
- Outline
- Team marker

for accessibility.

---

# 89. Multiplayer Scoreboard

Accessible using:

```text
TAB
```

Suggested columns:

```text
Player
Snake
Level
Length
Kills
Damage
Boss Damage
Revives
Gold
Ping
Status
```

PvPvE may additionally show:

```text
Rank
Player Kills
Deaths
Objective Score
```

---

# 90. Multiplayer Result Screen

After the match, display:

```text
Team Rank
Survival Time
Total Team Kills
Bosses Defeated
Team Damage
Longest Snake
Most Revives
Most Damage
Best Combo
```

Per-player statistics:

- Damage dealt
- Damage taken
- Healing
- Revives
- Kills
- Elite kills
- Boss damage
- Maximum length
- Evolutions
- Gold
- EXP
- Deaths
- PvP kills when relevant

---

# 78. Daily Challenge

Examples:

```text
Only Poison Upgrades

Double Enemy Speed

No Healing

Start Length 50

Boss Rush
```

Daily challenges increase replayability.

---

# 79. Endless Mode

After defeating the Final Boss, players may continue.

Difficulty increases indefinitely.

Leaderboard categories:

- Survival Time
- Maximum Length
- Highest Level
- Highest Kill Count

---

# 80. Build Archetypes

The design should intentionally support recognizable archetypes.

---

## Tank Snake

Focus:

```text
Armor
Regeneration
Length
```

---

## Fire Snake

Focus:

```text
Fire
Explosion
Growth
```

---

## Poison Snake

Focus:

```text
Poison
Spread
Damage over time
```

---

## Lightning Snake

Focus:

```text
Attack Speed
Chain Lightning
Critical
```

---

## Speed Snake

Focus:

```text
Movement
Head Damage
Critical
```

---

## Summoner Snake

Focus:

```text
Mini Snakes
Support
Area Control
```

---

## Glass Cannon

Focus:

```text
Damage
Critical
Attack Speed
```

Low survivability.

---

# 81. Risk / Reward Decisions

The player should frequently face decisions such as:

```text
More length
VS
More speed
```

```text
High damage segment
VS
Armor segment
```

```text
Evolution requirement
VS
Immediate power
```

```text
Black Food
VS
Safety
```

```text
Fight Elite
VS
Escape
```

---

# 82. Soft Caps

To prevent infinite stat abuse:

Recommended soft caps:

- Movement speed
- Attack speed
- Pickup range
- Armor
- Critical chance

Length should have diminishing mobility returns.

---

# 83. Example Run

Player begins as Cobra.

Starting build:

```text
HEAD
☠
Normal
Normal
TAIL
```

At Level 2:

Chooses Poison Damage.

Level 3:

Chooses Growth.

Level 4:

Chooses Poison Segment.

Current body:

```text
HEAD
☠
☠
Normal
Normal
TAIL
```

At Minute 5:

Kills Elite.

Receives Poison Core.

Current build:

```text
HEAD
☠
☠
⭐
☠
Normal
TAIL
```

At Minute 8:

Unlocks Poison Spread.

Minute 10 boss dies.

Chest upgrades Poison to Level 5.

Evolution unlocked:

```text
PLAGUE SERPENT
```

Now poisoned enemies explode and infect nearby enemies.

By Minute 18:

The snake has 80 segments and covers a major portion of the arena.

The run has transformed from survival into controlled chaos.

---

# 84. Core Balance Philosophy

A strong build should feel powerful.

The game should not immediately counter strong builds simply because they are successful.

Instead, difficulty should increase through:

- Enemy density
- Multiple attack directions
- Faster decision-making
- Arena hazards
- Boss mechanics

---

# 85. Anti-Frustration Rules

Avoid:

- Invisible damage
- Unavoidable instant kills
- Overly random deaths
- Excessive enemy HP scaling
- Upgrade choices that are always useless
- Mutations with hidden penalties

---

# 86. Player Agency

Whenever possible, the player should make understandable decisions.

Upgrade descriptions should clearly explain:

```text
What changes
How much it changes
What it synergizes with
```

---

# 87. Recommended Core USP Statement

Marketing sentence:

> **Build the snake. Become the weapon.**

Alternative:

> **Every segment is a skill. Every meter of growth changes your build.**

---

# 88. Final Game Identity

Serpent Survivor should not feel like:

> Snake with monsters.

It should feel like:

> A roguelite build-crafting game where the player's body is the inventory, health bar, weapon platform, and strategy.

The strongest identity comes from combining:

1. Snake movement
2. Length as health
3. Segment-based builds
4. Survivor level-up choices
5. Segment arrangement
6. Evolutions
7. Mutations
8. Serpent Circle
9. Bosses that target different body sections
10. Persistent species progression

---

# 89. Recommended Priority Order

If development resources are limited, prioritize in this order:

1. Snake movement feel
2. Growth and length
3. Length-as-health
4. Enemy collision
5. EXP and level-up
6. Segment system
7. Elemental upgrades
8. Segment combos
9. Boss
10. Evolution
11. Mutation
12. Meta progression
13. Content expansion
14. Multiplayer

---

# 90. Conclusion

Serpent Survivor's strongest opportunity is not simply combining Snake and Vampire Survivors.

The game should treat the snake's body as a modular build system.

A player's snake is simultaneously:

- Their HP
- Their inventory
- Their weapon
- Their defense
- Their skill tree
- Their visual identity

The primary design rule for future features should therefore be:

> **If a mechanic can interact with the snake's body, it should.**

This principle ensures that every system reinforces the game's core identity rather than becoming a disconnected Survivor-style feature.
---

# 91. Player HUD — Gameplay Information

The gameplay HUD should provide useful information without covering too much of the arena.

The HUD has three information layers:

1. **Always visible**
2. **Contextual**
3. **Optional advanced telemetry**

---

## 91.1 Always-Visible Player Information

### Player Core

Display:

```text
Player Name
Snake Species
Level
Current Length
Maximum Length reached this run
EXP Bar
Current HP / Effective Segment Health
```

If Length = HP is the primary system, show both an intuitive bar and the numerical length.

Example:

```text
Lv. 17
Length: 43
Body Integrity: 72%
EXP: 640 / 820
```

---

## 91.2 Combat Information

Display compactly:

- Current kill count
- Kill combo
- Boss timer
- Boss HP
- Elite alert
- Active buffs
- Active debuffs
- Mutation icons
- Evolution progress
- Active skill cooldowns

---

## 91.3 Build Information

Recommended expandable panel:

```text
Fire Lv.4
Poison Lv.2
Armor Lv.3
Growth Lv.2

Inferno Serpent:
Fire 4/5
Growth 2/3
Fire Core ✓
```

Players should not need to remember evolution requirements.

---

## 91.4 Segment Information

Optional compact body panel:

```text
🔥 × 8
☠ × 4
⚡ × 3
🛡 × 5
Normal × 12
```

When a segment is destroyed, the corresponding counter briefly animates.

---

# 92. Multiplayer HUD

In multiplayer, the player also needs team information.

Recommended team panel:

```text
Giang       Lv.17   Length 43   72%
Minh        Lv.15   Length 39   88%
Alex        Lv.18   Length 51   DOWNED
```

Display:

- Name
- Level
- Length
- Body integrity
- Downed/dead state
- Distance from player
- Active revive request
- Network warning only when necessary

---

# 93. Minimap

Recommended for larger multiplayer maps.

The minimap can display:

- Player
- Teammates
- Boss
- Elite enemies
- Quest locations
- Shrines
- Event zones
- Team objectives

Do not show all normal enemies.

Competitive modes may hide enemy players outside vision range.

---

# 94. Direction Indicators

Off-screen indicators should appear for:

- Teammates
- Bosses
- Downed allies
- Important events
- Exit/portal
- Objectives

Example:

```text
← Alex 120m
↑ BOSS 85m
→ Mutation Zone 210m
```

---

# 95. Player Experience Telemetry Overlay

The game should include an optional diagnostics overlay.

Default shortcut recommendation:

```text
F3
```

or a Settings toggle:

```text
Show Performance Stats
```

This overlay is valuable for:

- Players
- QA
- Beta testers
- Developers
- Support

---

# 96. FPS Information

Display:

```text
FPS Current
FPS Average
FPS 1% Low
Frame Time
```

Example:

```text
FPS: 117
AVG: 112
1% LOW: 78
Frame: 8.5 ms
```

---

## 96.1 Why Frame Time Matters

FPS alone can hide unstable performance.

Examples:

```text
60 FPS ≈ 16.67 ms/frame
120 FPS ≈ 8.33 ms/frame
144 FPS ≈ 6.94 ms/frame
```

A stable frame time produces smoother gameplay than a fluctuating FPS number.

---

# 97. FPS Experience Targets

Recommended experience tiers:

## Excellent

```text
≥ 120 FPS
Stable frame time
```

Ideal for high-refresh displays.

---

## Good

```text
60–119 FPS
```

Target baseline for desktop.

---

## Acceptable

```text
45–59 FPS
```

Still playable, but quality reduction may be suggested.

---

## Poor

```text
30–44 FPS
```

The game should automatically reduce expensive visual effects when dynamic quality is enabled.

---

## Critical

```text
< 30 FPS
```

Display a subtle performance warning and recommend lowering quality.

---

# 98. Dynamic Quality System

Optional setting:

```text
Dynamic Quality: ON / OFF
```

When enabled, the client can gradually reduce:

1. Particle count
2. Shadow quality
3. Glow effects
4. Damage number density
5. Environmental decoration
6. Nonessential animation
7. Distant enemy detail

Gameplay information must never be removed.

---

# 99. Network Experience Metrics

For multiplayer, the telemetry overlay should also show:

```text
Ping
Jitter
Packet Loss
Server Tick Rate
Interpolation Delay
Connection Quality
Region
```

Example:

```text
Ping: 34 ms
Jitter: 4 ms
Packet Loss: 0.2%
Server: SEA-01
Tick: 30 Hz
Connection: GOOD
```

---

# 100. Ping Experience Targets

Recommended user-facing categories:

## Excellent

```text
0–40 ms
```

## Good

```text
41–80 ms
```

## Playable

```text
81–120 ms
```

## Noticeable Delay

```text
121–180 ms
```

## Poor

```text
>180 ms
```

These thresholds are UX guidance rather than strict simulation rules.

---

# 101. Jitter

Jitter represents variation in network latency.

Example:

```text
Ping:
30 ms
31 ms
29 ms
80 ms
32 ms
```

The average ping may look acceptable while the experience still feels unstable.

Recommended display:

```text
Jitter: 3 ms
```

Warning thresholds can be approximately:

```text
<10 ms: Good
10–30 ms: Noticeable
>30 ms: Poor
```

---

# 102. Packet Loss

Display:

```text
Packet Loss: 0.0%
```

Experience guidance:

```text
0–1%      Good
1–3%      Noticeable
3–5%      Poor
>5%       Serious connection problem
```

---

# 103. Connection Quality Indicator

Normal players should not need to interpret technical metrics.

Provide a simplified indicator:

```text
● GOOD
● FAIR
● POOR
```

The advanced overlay provides exact values.

The standard HUD only shows a warning when quality degrades.

---

# 104. Server Simulation Targets

Recommended starting targets for this type of browser game:

```text
Server Tick Rate:
20–30 Hz
```

Reasoning:

- The game contains many enemies and snake segments.
- Movement needs to feel responsive.
- It is not a precision tactical shooter.
- Higher tick rates significantly increase multiplayer bandwidth and server cost.

Competitive testing may justify increasing this later.

---

# 105. Client Rendering vs Server Simulation

Recommended conceptual separation:

```text
Client Rendering:
60–144+ FPS

Server Simulation:
20–30 ticks/sec
```

The player can therefore see very smooth movement even though the authoritative game simulation runs at a lower frequency.

---

# 106. Multiplayer Responsiveness Goals

Movement should feel immediate.

Recommended systems for implementation planning:

- Client-side prediction
- Server reconciliation
- Snapshot interpolation
- Entity interpolation
- Lag compensation where appropriate
- Authoritative server for competitive state

These are technical requirements, not player-visible skills.

---

# 107. Server Authority

For multiplayer modes, important state should be server-authoritative.

Examples:

- Player position validation
- Damage
- Food ownership
- Enemy state
- Boss state
- EXP
- Growth
- Player death
- PvP collision
- Match result

This reduces cheating and desynchronization.

---

# 108. Network Traffic Priorities

Not every object needs equal update frequency.

High priority:

- Nearby players
- Player head
- Nearby snake segments
- Boss attacks
- Dangerous projectiles

Medium priority:

- Nearby enemies
- Food
- Active effects

Low priority:

- Distant enemies
- Decorative objects
- Cosmetic particles

---

# 109. Interest Management

The server should avoid sending all world entities to every player.

Concept:

```text
Player
↓
Area of Interest
↓
Only relevant nearby entities are synchronized frequently
```

This is especially important when:

- Rooms contain many players
- Snakes become very long
- Hundreds of monsters exist simultaneously

---

# 110. Long Snake Networking

Synchronizing every body segment independently can become expensive.

The technical design should treat the body efficiently.

Possible conceptual strategy:

- High-frequency head position
- Server-authoritative movement path
- Body segments reconstructed from the path where possible
- Important special segments synchronized explicitly
- Reduced update rate for distant snake bodies

This should be validated during prototyping.

---

# 111. Performance HUD — Recommended Layout

Example optional overlay:

```text
PERFORMANCE
FPS            118
AVG FPS        113
1% LOW          79
FRAME TIME     8.4 ms

NETWORK
PING            31 ms
JITTER           3 ms
PACKET LOSS    0.1%
SERVER TICK      30 Hz
REGION          SEA

GAME
PLAYERS         8/8
ENEMIES         186
PROJECTILES      73
SEGMENTS        342
```

---

# 112. Developer / QA Debug Overlay

A separate debug mode may additionally show:

- Client entity count
- Server entity count
- Active enemies
- Active projectiles
- Particle count
- Snake segment count
- Draw calls where measurable
- Memory usage where available
- JS heap where supported
- WebSocket traffic
- Incoming packets/sec
- Outgoing packets/sec
- Snapshot delay
- Simulation tick
- Desync corrections

This debug overlay should not be exposed by default to normal players.

---

# 113. Player-Facing Settings

## Graphics

```text
Quality Preset
Resolution Scale
Particles
Effects
Damage Numbers
Screen Shake
Dynamic Quality
FPS Limit
VSync — where applicable
```

---

## Gameplay

```text
Show Minimap
Show Team Names
Show Damage Numbers
Show Evolution Tracker
Show Off-screen Indicators
```

---

## Network

```text
Region: Auto / SEA / Asia / ...
Show Ping
Show Connection Warning
```

---

## Performance

```text
Show FPS
Show Advanced Stats
FPS Limit:
30
60
90
120
144
Unlimited
```

---

# 114. Recommended Performance Presets

## Low

Designed for integrated graphics and older laptops.

- Reduced particles
- Reduced effects
- Reduced environment detail
- Limited damage numbers

---

## Medium

Balanced default.

---

## High

Higher particle and environmental density.

---

## Ultra

Primarily cosmetic improvement.

Gameplay readability must remain identical across quality levels.

---

# 115. Performance Budget Philosophy

The most dangerous performance scenario is:

```text
8+ Players
+
Very Long Snakes
+
Hundreds of Enemies
+
Large Number of Projectiles
+
Particles
+
Status Effects
```

The game should be designed around the worst plausible late-game multiplayer state rather than only the first five minutes.

---

# 116. Recommended Multiplayer Performance Test Scene

Create an internal stress scenario:

```text
8 players
100 segments/player
500 enemies
200 projectiles
Multiple elemental effects
Boss active
```

Goal:

```text
Desktop target:
Stable ≥60 FPS on target minimum hardware
```

If this fails, optimize before increasing normal match entity limits.

---

# 117. UX During Performance Problems

Avoid repeatedly showing intrusive warnings.

Recommended behavior:

### FPS drops temporarily

No message.

### FPS remains below target for several seconds

Show:

```text
Performance is low.
Dynamic Quality can improve frame rate.
```

### Network becomes unstable

Show compact network icon.

Hover/click details:

```text
High latency
Packet loss detected
```

---

# 118. Multiplayer UX Principles

The player must always understand:

1. Who is on their team?
2. Where are teammates?
3. Who is down?
4. Who is disconnected?
5. What is the team objective?
6. What is the player's own build?
7. Is lag caused by network or frame rate?

The UI should provide these answers without requiring the player to open menus.

---

# 119. Multiplayer MVP

The first multiplayer prototype should not immediately target 20 players.

Recommended first milestone:

```text
2–4 Player Co-op
```

Include:

- Create Room
- Join by Code
- Ready Check
- Shared map
- Player synchronization
- Enemy synchronization
- Individual upgrades
- Team HUD
- Ping display
- Disconnect/reconnect
- Result screen

---

# 120. Multiplayer Phase 2

After the small multiplayer prototype is stable:

Add:

```text
10-player stress test
20-player standard server
30-player maximum-capacity stress test
Room Browser
Quick Match
Spectator Mode
Team Revive
Team Combo
```

---

# 121. Multiplayer Phase 3

Then implement:

```text
PvPvE
20-player standard rooms
30-player maximum rooms
Server-authoritative PvP
Live Server Leaderboard
Global Leaderboard
Matchmaking
Anti-cheat validation
```

Thirty players is the hard initial design cap. If future tests show sufficient CPU, bandwidth, and client performance headroom, larger experimental modes can be considered separately.

---

# 122. Revised Product Identity

With multiplayer included, the product becomes:

> **A room-based multiplayer roguelite where every player builds a living weapon out of their snake's own body.**

The most important systems are now:

1. Snake movement
2. Body growth
3. Length-as-health
4. Segment build crafting
5. Survivor upgrades
6. Multiplayer rooms
7. Team interactions
8. Evolutions and mutations
9. Server-authoritative shared arena
10. Performance and network transparency

---

# 123. Revised Development Priority

Recommended implementation order:

```text
1. Single-player movement prototype
2. Snake body simulation
3. Growth
4. Combat
5. Survivor leveling
6. Segment builds
7. 2-player networking prototype
8. 4-player networking validation
9. Multiplayer enemy synchronization
10. Presence / online system
11. Team HUD
12. Reconnect
13. Performance telemetry
14. 10-player stress test
15. 20-player standard server
16. 30-player hard-cap stress test
17. Room browser / Quick Match
18. Live per-server leaderboard
19. Global leaderboard
20. PvPvE validation
21. Competitive server validation
22. Matchmaking
23. Advanced meta progression
```

The key rule is:

> **Do not design the networking after finishing the game.**

Because snake bodies, hundreds of enemies, projectiles, and Survivor-style effects create large synchronization costs, multiplayer constraints must influence gameplay architecture from the prototype stage.
---

# 124. Target Online Architecture

The multiplayer architecture is designed around approximately ten active game servers.

Initial target:

```text
10 Game Servers
×
20–30 Players / Server
=
200–300 Concurrent In-Game Players
```

This number describes players actively inside matches.

The total number of online users may be larger because some users can be:

- On the main menu
- Browsing servers
- In a lobby
- Spectating
- Viewing rankings
- Reconnecting

Therefore, the platform must distinguish:

```text
ONLINE USERS
≠
IN-GAME USERS
```

---

# 125. Logical Server Model

For the first production architecture:

> **One logical game server instance represents one large room / match.**

Example:

```text
Server 01 → 24 / 30 Players
Server 02 → 30 / 30 Players
Server 03 → 18 / 30 Players
Server 04 → 27 / 30 Players
...
Server 10 → 21 / 30 Players
```

This model makes:

- Capacity easier to understand
- Match ownership explicit
- Failure isolation easier
- Realtime simulation easier to profile
- Leaderboards easier to scope

Later, one physical machine or container host may run multiple logical game-server processes if profiling shows sufficient headroom.

---

# 126. Shared Backend Services

Game servers should not directly own permanent account data.

Recommended service separation:

```text
                    ┌───────────────────────┐
                    │   Web Game Client     │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Gateway / API Layer   │
                    └──────┬───────┬────────┘
                           │       │
             ┌─────────────┘       └─────────────┐
             ▼                                   ▼
┌────────────────────────┐          ┌────────────────────────┐
│ Auth / Account Service │          │ Presence / Lobby       │
└────────────────────────┘          └────────────┬───────────┘
                                                │
                                                ▼
                                  ┌─────────────────────────┐
                                  │ Matchmaking / Router    │
                                  └─────────────┬───────────┘
                                                │
                 ┌──────────────────────────────┼─────────────────────────┐
                 ▼                              ▼                         ▼
          ┌────────────┐                 ┌────────────┐            ┌────────────┐
          │ Game S01   │      ...        │ Game S05   │    ...     │ Game S10   │
          │ 20–30      │                 │ 20–30      │            │ 20–30      │
          └─────┬──────┘                 └─────┬──────┘            └─────┬──────┘
                │                              │                         │
                └──────────────────────────────┼─────────────────────────┘
                                               ▼
                               ┌─────────────────────────────┐
                               │ Ranking / Persistence       │
                               │ Stats / Match History       │
                               └─────────────────────────────┘
```

Shared services include:

- Authentication
- User profile
- Online presence
- Server directory
- Matchmaking
- Friend / party data
- Permanent inventory
- Match history
- Server ranking
- Global ranking
- Season data
- Analytics

---

# 127. Server Directory

The game client should receive a realtime or near-realtime list of all available servers.

Example:

```text
SERVER      PLAYERS      PING      MODE       STATUS
SEA-01      24 / 30      22 ms     PvPvE      OPEN
SEA-02      30 / 30      28 ms     PvPvE      FULL
SEA-03      17 / 30      31 ms     Co-op      OPEN
SEA-04      26 / 30      25 ms     PvPvE      OPEN
SEA-05      11 / 30      37 ms     Co-op      OPEN
...
SEA-10      20 / 30      42 ms     PvPvE      OPEN
```

Status values:

```text
OPEN
NEAR_FULL
FULL
IN_MATCH
RESTARTING
MAINTENANCE
OFFLINE
```

---

# 128. Server Browser UI

The Multiplayer screen should display:

- Server ID
- Server name
- Region
- Mode
- Map
- Players online
- Maximum players
- Current phase
- Ping
- Server status
- Password status
- Estimated match progress

Example:

```text
SEA-03
Cyber City
PvPvE
23 / 30
Ping 31 ms
Match 04:18 / 20:00
[ JOIN ]
```

Filters:

- Region
- Game mode
- Available slot
- Ping
- Map
- New match only
- Friends inside
- Password / public

---

# 129. Auto Server Selection

A player who presses:

```text
PLAY NOW
```

does not need to manually select a server.

The routing service should prioritize:

```text
1. Correct region
2. Lowest acceptable ping
3. Server not full
4. Match joinability
5. Balanced population
6. Party compatibility
```

Example:

```text
SEA-01 = 29 / 30
SEA-02 = 14 / 30
SEA-03 = 22 / 30
```

The router should generally avoid placing every new player into SEA-01 simply because it is first in the list.

---

# 130. Online Presence System

The platform should track player presence separately from match state.

Possible presence values:

```text
ONLINE
IN_MENU
IN_LOBBY
MATCHMAKING
IN_GAME
SPECTATING
RECONNECTING
AFK
OFFLINE
```

Player-facing examples:

```text
Giang
IN GAME — SEA-04

Minh
ONLINE — MAIN MENU

Alex
SPECTATING — SEA-02
```

---

# 131. Online Counts

The main interface can display:

```text
Online: 347
In Game: 268
Servers: 10 / 10 Online
```

The server browser can display:

```text
Total Capacity:
268 / 300
```

Do not count disconnected users inside the visible online count indefinitely.

---

# 132. Presence Heartbeat

The backend should detect stale sessions.

Recommended conceptual behavior:

```text
Client sends / receives heartbeat
↓
Presence service tracks last activity
↓
Connection is considered unstable
↓
Player enters RECONNECTING
↓
Timeout expires
↓
Player becomes OFFLINE
```

Suggested starting values for testing:

```text
Heartbeat: every 5–10 seconds
Connection warning: after ~10 seconds without confirmation
Reconnect window: 60–120 seconds
```

Exact values should be tuned after real network testing.

---

# 133. Realtime Communication

Because the client is a browser game, the initial realtime transport should use persistent bidirectional connections.

Recommended MVP transport:

```text
WebSocket
```

WebSocket is used for:

- Player input
- Server snapshots
- Match events
- Enemy events
- Damage events
- Boss events
- Chat / emotes if implemented
- Live leaderboard
- Presence changes
- Ready state
- Match countdown

A future technical experiment may evaluate WebTransport where browser/platform support and deployment requirements justify it.

---

# 134. Realtime Authority Model

All competitive gameplay should use:

> **Server-authoritative simulation.**

The client may predict movement for responsiveness, but the server determines the truth.

Server authority includes:

- Player location validation
- Player alive/dead state
- Growth
- EXP
- Level
- Damage
- Segment destruction
- Food pickup
- Enemy death
- Boss state
- PvP hit validation
- Score
- Ranking events

The client must not be allowed to submit:

```text
"I have 100,000 score."
```

Instead, the client submits gameplay inputs and the server calculates score.

---

# 135. Suggested Realtime Frequencies

Initial technical targets:

```text
Client Rendering:
60–144+ FPS

Client Input Sampling:
30–60 Hz

Server Simulation:
30 Hz target

State Snapshot Broadcast:
15–30 Hz depending on entity priority

Leaderboard UI Refresh:
2–4 updates / second

Presence / Server Population:
Event-driven + periodic refresh
```

The leaderboard does not need 30 updates per second.

---

# 136. Realtime Snapshot Strategy

A server containing 30 players, long snakes, and hundreds of monsters cannot blindly broadcast the full world every tick.

Use:

- Delta snapshots
- Interest management
- Entity priority
- Quantized values where appropriate
- Reduced update rate for distant entities
- Reconstructable snake paths

Concept:

```text
FULL WORLD
    ↓
SERVER FILTER
    ↓
PLAYER AREA OF INTEREST
    ↓
RELEVANT DELTA SNAPSHOT
    ↓
CLIENT
```

---

# 137. Server Capacity Budget

The hard room target is:

```text
30 Players
```

Design and QA should consider 20 players the normal operating target and 30 players the capacity ceiling.

Recommended capacity zones:

```text
0–19 Players
LOW LOAD

20–24 Players
NORMAL LOAD

25–29 Players
HIGH LOAD

30 Players
FULL
```

A server should stop accepting new normal joins at 30.

Reconnect reservations may require keeping a temporary slot reserved for disconnected players.

---

# 138. Capacity Reservation for Reconnect

Example:

```text
Visible Players: 29
Disconnected Reserved Slot: 1
Effective Capacity: 30 / 30
```

The room browser should therefore avoid advertising an unavailable slot.

Possible UI:

```text
29 / 30
FULL — reconnect slot reserved
```

---

# 139. Initial Ten-Server Pool

Initial logical server pool:

```text
SEA-01
SEA-02
SEA-03
SEA-04
SEA-05
SEA-06
SEA-07
SEA-08
SEA-09
SEA-10
```

Maximum theoretical in-match population:

```text
10 × 30 = 300 Players
```

Recommended normal load:

```text
10 × 20–24
=
200–240 Players
```

This leaves room for spikes, reconnects, and late-match entity growth.

---

# 140. Server Health State

Every game server should publish health telemetry.

Example:

```text
Server: SEA-04
Players: 26 / 30
Tick Rate: 30 Hz
Tick Time: 17 ms
CPU Load: 63%
Memory: 1.8 GB
Network Out: 14 Mbps
State: HEALTHY
```

Possible internal states:

```text
HEALTHY
DEGRADED
OVERLOADED
DRAINING
RESTARTING
OFFLINE
```

A degraded server should stop receiving new players before it completely fails.

---

# 141. Graceful Server Draining

When maintenance or restart is required:

```text
OPEN
↓
DRAINING
↓
NO NEW JOINS
↓
CURRENT MATCH FINISHES
↓
SERVER RESTARTS
↓
OPEN
```

This is preferable to terminating an active 30-player match whenever possible.

---

# 142. Match Server Failure

If a game server crashes:

1. Mark the server unavailable.
2. Stop routing new users to it.
3. Preserve account/session identity.
4. Record the match as interrupted.
5. Restore safe persistent rewards only if they were already committed.
6. Return players to lobby.
7. Optionally offer a replacement match.

Avoid trusting client-submitted final rewards after a server crash.

---

# 143. Live Server Leaderboard

Each active server has its own **live match leaderboard** visible during gameplay.

This leaderboard ranks players currently inside that server.

Recommended display:

```text
SEA-04 — LIVE RANKING

#   PLAYER      SCORE       KILLS     LENGTH
1   Kaito       42,850      381       87
2   Giang       39,420      344       92
3   Luna        35,110      318       74
4   Ryu         33,980      301       68
5   Minh        31,700      294       81
```

---

# 144. In-Game Leaderboard HUD

The normal HUD should not permanently show all 30 players.

Recommended compact display:

```text
TOP PLAYERS

1  Kaito       42,850
2  Giang       39,420
3  Luna        35,110
4  Ryu         33,980
5  Minh        31,700

YOU
#2 Giang       39,420
```

If the player is outside the top five:

```text
1  Kaito       42,850
2  Luna        39,420
3  Ryu         35,110
4  Minh        33,980
5  Alex        31,700
...
17 YOU          18,240
```

This lets the player understand their position without filling the screen.

---

# 145. Full Server Scoreboard

Recommended key:

```text
TAB
```

The full scoreboard displays all players in the current server.

Possible fields:

```text
Rank
Player
Snake
Level
Score
Length
Kills
PvP Kills
Boss Damage
Deaths
Ping
Status
```

The exact fields depend on game mode.

---

# 146. Live Ranking Update Rate

Ranking changes do not need to be sent every simulation tick.

Recommended approach:

```text
Gameplay simulation: 30 Hz
Ranking calculation: event-driven / batched
Leaderboard broadcast: approximately 2–4 Hz
```

Important ranking events include:

- Kill
- Elite kill
- Boss damage milestone
- Player kill
- Quest completion
- Survival milestone
- Objective completion
- Death

This greatly reduces unnecessary network traffic.

---

# 147. Match Score Model

Score should be calculated by the authoritative server.

Possible base model:

```text
Score =
Enemy Kill Score
+ Elite Score
+ Boss Score
+ PvP Score
+ Objective Score
+ Survival Score
+ Growth Score
+ Combo Bonus
```

Different game modes can change the weights.

---

## 147.1 Example PvE Score

```text
Normal Enemy Kill        +10
Elite Kill              +250
Boss Participation     +1000
Revive                  +150
Quest Complete          +300
Survival Milestone      +500
```

---

## 147.2 Example PvPvE Score

```text
Normal Enemy Kill         +5
Elite Kill              +150
Boss Contribution       variable
Player Kill             +500
Assist                  +200
Objective               +300
Survival placement      variable
```

These values are placeholders for balancing, not final economy values.

---

# 148. Anti-Farming Rules

Leaderboard score must not encourage exploitable loops.

Possible safeguards:

- Reduced score for repeatedly killing the same opponent
- No score for disconnected-player abuse
- Diminishing rewards for farmable summoned enemies
- Score cap for trivial monsters
- Server validation of all score events
- Detect impossible score growth

---

# 149. Persistent Per-Server Leaderboard

In addition to the live match leaderboard, each logical server can maintain a persistent seasonal ranking.

Example:

```text
SEA-04 — SEASON 1

1  Kaito      184,220 Rating
2  Giang      179,840 Rating
3  Luna       171,090 Rating
...
```

Possible categories:

- Rating
- Best Match Score
- Wins
- Boss Kills
- PvP Kills
- Longest Snake
- Highest Survival Time

---

# 150. Global Leaderboard

The Global Leaderboard combines eligible results from all ten servers.

Example:

```text
GLOBAL — SEASON 1

#   PLAYER      SERVER      RATING
1   Aki         SEA-07      201,880
2   Giang       SEA-04      198,430
3   Ryu         SEA-01      195,990
4   Luna        SEA-09      194,610
5   Kai         SEA-03      190,240
```

The player's own position should always be easy to find:

```text
YOUR GLOBAL RANK

#382
Giang
18,420 Rating
Top 7.4%
```

---

# 151. Global Ranking Categories

Recommended tabs:

```text
RATING
MATCH SCORE
WINS
KILLS
BOSS DAMAGE
MAX LENGTH
SURVIVAL
```

Optional filters:

```text
Today
This Week
Season
All Time
```

Not every category needs an all-time board if data volume becomes excessive.

---

# 152. Global Leaderboard Architecture

Game servers should not directly modify visible global ranking rows.

Recommended flow:

```text
GAME SERVER
↓
VALIDATED MATCH RESULT
↓
RANKING SERVICE
↓
PERSISTENT DATABASE
↓
CACHE
↓
GLOBAL LEADERBOARD API / REALTIME FEED
↓
CLIENT
```

This prevents one match server from becoming the source of truth for global ranking.

---

# 153. Ranking Event Pipeline

At the end of a match:

```text
1. Game server finalizes results
2. Result receives Match ID
3. Results are validated
4. Ranking event is created
5. Ranking service updates player stats
6. Server leaderboard updates
7. Global leaderboard updates
8. Client receives final rank changes
```

Every update should be idempotent by Match ID so the same match result cannot be applied twice.

---

# 154. Leaderboard Storage Strategy

Conceptual storage split:

```text
Persistent Database
→ Player profiles
→ Match history
→ Season results
→ Durable ranking data

Fast Cache / Sorted Ranking Structure
→ Top rankings
→ Frequently requested leaderboard pages
→ Player current rank
```

The implementation technology can be selected later.

The GDD requirement is that ranking reads must remain fast even when many players open the leaderboard at once.

---

# 155. Global Leaderboard Refresh

The global board does not require frame-level realtime.

Recommended behavior:

```text
Live Match Board:
2–4 updates/sec

Server Seasonal Board:
Event-driven + near-realtime

Global Board:
Near-realtime, typically refreshed every few seconds
```

At match end, a player should see their new rank shortly after the validated result is committed.

---

# 156. Ranking UI Navigation

Main menu:

```text
LEADERBOARDS
```

Inside:

```text
[ LIVE SERVERS ]
[ SERVER RANKING ]
[ GLOBAL ]
[ FRIENDS ]
```

---

# 157. Live Servers Ranking Screen

Example:

```text
LIVE SERVERS

SEA-01    28/30    Leader: Kaito    51,220
SEA-02    30/30    Leader: Luna     48,910
SEA-03    17/30    Leader: Minh     31,480
SEA-04    26/30    Leader: Giang    46,110
...
```

Selecting a server opens:

- Current top players
- Match timer
- Server state
- Map
- Mode

Sensitive competitive information such as exact hidden player positions must not be exposed.

---

# 158. Player Profile Ranking Summary

Player profile can display:

```text
SERVER RANK
#18 SEA-04

GLOBAL RANK
#382

BEST MATCH
72,440

WINS
31

MAX LENGTH
184
```

---

# 159. Season System

Recommended ranking structure:

```text
Season 1
Season 2
Season 3
...
```

At season end:

- Freeze final rank
- Grant cosmetic rewards
- Archive season history
- Reset or partially reset rating
- Start new leaderboard

Seasonal reset prevents permanent early-player dominance.

---

# 160. Ranking Reward Philosophy

Prefer rewards such as:

- Titles
- Badges
- Skins
- Trails
- Profile frames
- Seasonal effects

Avoid large permanent combat advantages tied to rank.

Competitive ranking should primarily provide prestige rather than pay-to-win style power.

---

# 161. Online Friends / Party Integration

If social systems are added, the server browser can show:

```text
SEA-06
21 / 30

2 Friends Playing
Minh
Alex
```

Party rules:

- Party leader selects mode
- Matchmaking attempts to keep party together
- Server router reserves enough slots
- Party is not split unless explicitly allowed

---

# 162. Party Capacity

A 30-player server can contain several squads.

Example:

```text
Server Capacity: 30

Squad A: 5
Squad B: 4
Squad C: 5
Solo Players: 16
```

For pure co-op, all 30 players may belong to the same alliance while smaller squads are used for UI and spawn organization.

---

# 163. Chat / Communication

Optional text communication channels:

```text
GLOBAL
SERVER
TEAM
PARTY
```

For the first version, avoid a fully unrestricted global chat unless moderation systems are ready.

Safer initial communication:

- Party chat
- Server chat
- Emotes
- Ping wheel
- Quick messages

Example quick messages:

```text
Boss here!
Need help!
Mutation zone!
Revive me!
Follow me!
```

---

# 164. Realtime Ping System

Players should be able to mark locations or targets.

Possible pings:

- Move
- Danger
- Boss
- Elite
- Food
- Mutation
- Help
- Revive

Pings are synchronized only to relevant team or party members.

---

# 165. Match Start Policy

Recommended server lifecycle:

```text
0 players
WAITING

Minimum players reached
COUNTDOWN

20–30 players
ACTIVE MATCH

Match completed
RESULT

Short reset
WAITING
```

A server does not need to reach 30 players to begin.

Example configuration:

```text
Minimum Start: 10
Preferred Start: 20
Maximum: 30
```

For private rooms, host rules may differ.

---

# 166. Join-In-Progress for 30-Player Servers

Join-in-progress must prevent unfair power gaps.

PvE / Co-op:

```text
Late join allowed
↓
Catch-up level
↓
Starter build package
↓
Temporary protection
```

PvPvE:

Recommended default:

```text
Late join only during early match phase
```

Example:

```text
Join allowed until 03:00
```

After cutoff:

```text
Server status = MATCH IN PROGRESS
Spectate only
```

---

# 167. Server Selection and Queue

If all ten servers are full:

```text
300 / 300
```

The game should provide:

```text
QUEUE
```

Example:

```text
All SEA servers are full.

Queue Position: 7
Estimated server slot: waiting for player departure / next match

[ LEAVE QUEUE ]
```

Do not spin players indefinitely without showing queue state.

---

# 168. Future Horizontal Scaling

Although the initial design targets ten servers, the architecture should not hardcode ten as the permanent limit.

Concept:

```text
10 Servers
↓
Demand increases
↓
20 Servers
↓
50 Servers
```

Server IDs should therefore be discovered dynamically through the directory service rather than stored as a fixed client-side list.

---

# 169. Server Region Expansion

Initial deployment may focus on one primary region.

Future regions:

```text
SEA
East Asia
EU
NA
```

Global leaderboard can combine all regions while server browsers prefer nearby servers.

Regional leaderboards may also be added later.

---

# 170. Capacity and Performance Acceptance Test

A server is considered ready for the 30-player cap only when a stress test demonstrates stable performance in a worst-case match.

Suggested scenario:

```text
30 Players
×
100 Body Segments Average
=
3,000 Player Segments

+

500 Active Enemies
200 Projectiles
Boss Active
Status Effects
Food Drops
Live Leaderboard
Realtime Score Events
```

Measure:

- Server tick stability
- Client FPS
- Network bandwidth
- Packet loss behavior
- Snapshot size
- CPU
- Memory
- Reconnect success
- Ranking update delay

---

# 171. 30-Player Performance Goal

Recommended server target:

```text
Simulation Tick:
30 Hz target

Critical requirement:
No prolonged tick backlog
```

Recommended client baseline:

```text
60 FPS target
```

Even in a 30-player late-game fight.

If the stress test cannot meet this:

1. Reduce synchronized entity density.
2. Improve interest management.
3. Reduce distant snake detail.
4. Reduce nonessential projectiles.
5. Optimize collision.
6. Optimize snapshot size.

Do not simply reduce server tick rate until the game feels unresponsive.

---

# 172. Online Operations Dashboard

Operations should be able to see:

```text
Total Online Users
Total In-Game Players
Players by Server
Server Capacity
Average Ping
Server Tick Health
Disconnect Rate
Reconnect Rate
Match Count
Match Failure Rate
Leaderboard Processing Delay
```

Example:

```text
ONLINE            347
IN GAME           271
GAME SERVERS      10 / 10
CAPACITY          271 / 300
AVG PING          36 ms
RECONNECT SUCCESS 94%
```

---

# 173. Per-Server Operations View

Example:

```text
SEA-04

Players              27 / 30
Spectators             3
Reserved Reconnect     1
Tick Rate             30 Hz
Average Ping          32 ms
Packet Loss           0.4%
Match Time            14:21
Entities              827
Snake Segments       2,412
Leaderboard Delay     180 ms
State                 HEALTHY
```

---

# 174. Revised HUD for Large Servers

With 20–30 players, the HUD should avoid displaying every player's status simultaneously.

Recommended default:

### Left / Team Area

Only:

- Party members
- Downed allies
- Important nearby teammates

### Right

Live leaderboard:

```text
TOP 5
+
YOUR RANK
```

### TAB

Full 20–30 player scoreboard.

### Minimap

Show teammates according to game mode.

This prevents UI overload.

---

# 175. Server Identity in Gameplay HUD

The gameplay screen should always make the current server identifiable.

Small UI example:

```text
SEA-04
24 / 30
Ping 31 ms
```

This helps when:

- Reporting bugs
- Inviting friends
- Comparing leaderboard
- Diagnosing lag

---

# 176. Network Problem Attribution

The player-facing diagnostics should distinguish:

```text
LOW FPS
HIGH LATENCY
PACKET LOSS
SERVER DEGRADED
```

Example:

```text
⚠ NETWORK
Ping 214 ms
```

versus:

```text
⚠ PERFORMANCE
FPS 27
```

versus:

```text
⚠ SERVER
Simulation delay detected
```

This is important because players often describe all three problems simply as "lag."

---

# 177. Ranking Integrity

Every leaderboard-worthy statistic must be generated or validated by authoritative services.

Never trust the browser client for:

- Score
- Kills
- Wins
- Match duration
- Boss damage
- Maximum length
- Rating gain

Client data may be used for telemetry but not as authoritative competitive ranking data.

---

# 178. Match History

Each completed match should produce a match record.

Example:

```text
Match ID: SEA04-20260917-004281
Server: SEA-04
Mode: PvPvE
Players: 28
Duration: 20:48
Winner: Kaito
Your Rank: #4
Your Score: 41,280
Max Length: 93
Kills: 347
```

Players can inspect recent matches from their profile.

---

# 179. Ranking Dispute / Audit Support

Because rankings are competitive, keep enough server-side match information to investigate impossible results.

At minimum:

- Match ID
- Server ID
- Player IDs
- Final stats
- Important score events
- Match start/end time
- Disconnect events
- Version / ruleset

Full replay storage can be considered later if cost allows.

---

# 180. Versioned Ranking Rules

Every match should record a ruleset version.

Example:

```text
Ruleset:
PVP_SCORE_V3
```

If scoring weights change after a balance patch, historical matches remain understandable.

---

# 181. New Multiplayer Product Baseline

The new baseline is:

```text
10 Logical Game Servers

20–30 Players Each

200–300 Concurrent In-Game Players

Realtime WebSocket Gameplay

Server-Authoritative Simulation

Online Presence

Reconnect

Server Browser

Quick Match

Live Per-Server Leaderboard

Persistent Per-Server Ranking

Global Leaderboard

Performance + Network Telemetry
```

These are now **core requirements**, not optional future features.

---

# 182. Updated Multiplayer Delivery Order

Recommended implementation order:

```text
PHASE A
Single-player gameplay proof

PHASE B
2–4 player authoritative networking proof

PHASE C
Presence + lobby + server directory

PHASE D
10-player synchronization test

PHASE E
20-player normal-load server

PHASE F
Live server leaderboard

PHASE G
30-player stress test

PHASE H
Ten-server routing layer

PHASE I
Persistent server ranking

PHASE J
Global leaderboard

PHASE K
Queue / reconnect / failover hardening

PHASE L
PvPvE competitive validation

PHASE M
Production monitoring + anti-cheat
```

The game should not launch with a claimed 30-player capacity until Phase G demonstrates that late-game entity density remains stable.
