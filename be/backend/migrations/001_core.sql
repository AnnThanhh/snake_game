CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
  id uuid PRIMARY KEY, username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  password_hash text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz
);
CREATE TABLE player_profiles (
  player_id uuid PRIMARY KEY REFERENCES users(id), display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 24),
  cosmetics jsonb NOT NULL DEFAULT '{}', discovered_traits jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY, player_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE player_wallets (
  player_id uuid PRIMARY KEY REFERENCES users(id), gold bigint NOT NULL DEFAULT 0 CHECK (gold >= 0),
  dna bigint NOT NULL DEFAULT 0 CHECK (dna >= 0), evolution_points bigint NOT NULL DEFAULT 0 CHECK (evolution_points >= 0)
);
CREATE TABLE wallet_ledger (
  id uuid PRIMARY KEY, player_id uuid NOT NULL REFERENCES users(id), event_key text NOT NULL,
  gold bigint NOT NULL DEFAULT 0, dna bigint NOT NULL DEFAULT 0, evolution_points bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(player_id,event_key)
);
CREATE TABLE snake_definitions (id text PRIMARY KEY, name text NOT NULL, unlock_gold integer NOT NULL CHECK (unlock_gold >= 0));
CREATE TABLE player_snakes (player_id uuid REFERENCES users(id), snake_id text REFERENCES snake_definitions(id), unlocked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(player_id,snake_id));
CREATE TABLE player_snake_mastery (player_id uuid REFERENCES users(id), snake_id text REFERENCES snake_definitions(id), xp bigint NOT NULL DEFAULT 0 CHECK(xp >= 0), PRIMARY KEY(player_id,snake_id));
CREATE TABLE meta_upgrade_definitions (id text PRIMARY KEY, name text NOT NULL, description text NOT NULL, max_level integer NOT NULL, base_cost integer NOT NULL, effect jsonb NOT NULL);
CREATE TABLE player_meta_upgrades (player_id uuid REFERENCES users(id), upgrade_id text REFERENCES meta_upgrade_definitions(id), level integer NOT NULL CHECK(level > 0), PRIMARY KEY(player_id,upgrade_id));
CREATE TABLE achievement_definitions (id text PRIMARY KEY, name text NOT NULL, description text NOT NULL, reward_dna integer NOT NULL DEFAULT 0);
CREATE TABLE player_achievements (player_id uuid REFERENCES users(id), achievement_id text REFERENCES achievement_definitions(id), unlocked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(player_id,achievement_id));
CREATE TABLE content_versions (id text PRIMARY KEY, game_version text NOT NULL, balance_version text NOT NULL, upgrade_pool text NOT NULL, manifest jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE seasons (id text PRIMARY KEY, name text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, CHECK(ends_at > starts_at));
CREATE TABLE matches (
  id uuid PRIMARY KEY, server_id text NOT NULL, mode text NOT NULL CHECK(mode IN ('arena','coop')),
  map text NOT NULL, content_version text NOT NULL REFERENCES content_versions(id),
  started_at timestamptz NOT NULL, ended_at timestamptz, CHECK(ended_at IS NULL OR ended_at >= started_at)
);
CREATE TABLE match_players (match_id uuid REFERENCES matches(id), player_id uuid REFERENCES users(id), PRIMARY KEY(match_id,player_id));
CREATE TABLE match_results (
  life_id uuid PRIMARY KEY, match_id uuid NOT NULL REFERENCES matches(id), player_id uuid NOT NULL REFERENCES users(id),
  snake_id text NOT NULL REFERENCES snake_definitions(id), payload_hash text NOT NULL, reason text NOT NULL,
  duration_seconds real NOT NULL CHECK(duration_seconds >= 0), score bigint NOT NULL CHECK(score >= 0),
  kills integer NOT NULL CHECK(kills >= 0), pvp_kills integer NOT NULL CHECK(pvp_kills >= 0), deaths integer NOT NULL CHECK(deaths >= 0),
  level integer NOT NULL CHECK(level > 0), max_length integer NOT NULL CHECK(max_length > 0),
  damage double precision NOT NULL CHECK(damage >= 0), boss_damage double precision NOT NULL CHECK(boss_damage >= 0),
  xp bigint NOT NULL CHECK(xp >= 0), earned_gold integer NOT NULL CHECK(earned_gold >= 0),
  season_id text NOT NULL REFERENCES seasons(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(match_id,player_id) REFERENCES match_players(match_id,player_id)
);
CREATE INDEX match_results_history ON match_results(player_id,created_at DESC);
CREATE TABLE match_builds (life_id uuid PRIMARY KEY REFERENCES match_results(life_id), upgrades jsonb NOT NULL, segments jsonb NOT NULL, evolutions jsonb NOT NULL DEFAULT '[]', traits jsonb NOT NULL DEFAULT '[]');
CREATE TABLE leaderboard_entries (
  season_id text REFERENCES seasons(id), player_id uuid REFERENCES users(id), mode text NOT NULL,
  best_score bigint NOT NULL DEFAULT 0, total_score bigint NOT NULL DEFAULT 0, lives integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(season_id,player_id,mode)
);
CREATE INDEX leaderboard_top ON leaderboard_entries(season_id,mode,best_score DESC);
CREATE TABLE player_statistics (player_id uuid PRIMARY KEY REFERENCES users(id), lives integer NOT NULL DEFAULT 0, kills bigint NOT NULL DEFAULT 0, pvp_kills bigint NOT NULL DEFAULT 0, seconds double precision NOT NULL DEFAULT 0, best_score bigint NOT NULL DEFAULT 0);
