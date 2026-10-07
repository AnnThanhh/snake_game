CREATE TABLE roles (code text PRIMARY KEY, name text NOT NULL, priority integer NOT NULL DEFAULT 0, is_system boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE permissions (code text PRIMARY KEY, description text NOT NULL DEFAULT '');
CREATE TABLE role_permissions (role_code text REFERENCES roles(code), permission_code text REFERENCES permissions(code), PRIMARY KEY(role_code,permission_code));
CREATE TABLE user_roles (user_id uuid REFERENCES users(id), role_code text REFERENCES roles(code), granted_by uuid REFERENCES users(id), granted_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, PRIMARY KEY(user_id,role_code));
CREATE TABLE user_permission_overrides (user_id uuid REFERENCES users(id), permission_code text REFERENCES permissions(code), effect text NOT NULL CHECK(effect IN ('ALLOW','DENY')), expires_at timestamptz, reason text NOT NULL, PRIMARY KEY(user_id,permission_code));
CREATE TABLE whitelist_entries (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), type text NOT NULL, scope text NOT NULL DEFAULT 'GLOBAL', value text NOT NULL DEFAULT '',
 environment text NOT NULL DEFAULT 'LOCAL', reason text NOT NULL, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, is_active boolean NOT NULL DEFAULT true,
 CHECK(expires_at IS NULL OR expires_at>starts_at)
);
CREATE INDEX whitelist_user_active ON whitelist_entries(user_id,type) WHERE is_active;
CREATE TABLE admin_audit_logs (
 id uuid PRIMARY KEY, actor_user_id uuid REFERENCES users(id), actor_roles jsonb NOT NULL, action text NOT NULL, target_type text NOT NULL, target_id text,
 before_data jsonb NOT NULL DEFAULT '{}', after_data jsonb NOT NULL DEFAULT '{}', reason text NOT NULL, ip_address text, user_agent text,
 request_id uuid NOT NULL, payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(actor_user_id,request_id)
);
CREATE INDEX audit_recent ON admin_audit_logs(created_at DESC);
CREATE TABLE moderation_actions (
 id uuid PRIMARY KEY, target_user_id uuid NOT NULL REFERENCES users(id), type text NOT NULL, scope text NOT NULL DEFAULT 'ACCOUNT', scope_value text NOT NULL DEFAULT '',
 reason text NOT NULL, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
 revoked_at timestamptz, revoked_by uuid REFERENCES users(id)
);
CREATE INDEX moderation_active ON moderation_actions(target_user_id,scope) WHERE revoked_at IS NULL;
CREATE TABLE admin_mfa (user_id uuid PRIMARY KEY REFERENCES users(id), encrypted_secret text NOT NULL, enabled boolean NOT NULL DEFAULT false, last_counter bigint NOT NULL DEFAULT -1);
CREATE TABLE admin_sessions (session_hash text PRIMARY KEY REFERENCES auth_sessions(token_hash) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id), verified_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
CREATE TABLE system_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE inventory_definitions (id text PRIMARY KEY, name text NOT NULL, category text NOT NULL, maximum integer NOT NULL CHECK(maximum>0));
CREATE TABLE player_inventory (player_id uuid REFERENCES users(id), item_id text REFERENCES inventory_definitions(id), quantity integer NOT NULL CHECK(quantity>=0), PRIMARY KEY(player_id,item_id));
CREATE TABLE player_season_progress (player_id uuid REFERENCES users(id), season_id text REFERENCES seasons(id), level integer NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 50), xp bigint NOT NULL DEFAULT 0 CHECK(xp>=0), PRIMARY KEY(player_id,season_id));
CREATE TABLE player_reports (id uuid PRIMARY KEY, reporter_id uuid REFERENCES users(id), target_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL, status text NOT NULL DEFAULT 'open', resolved_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE player_profiles ADD COLUMN ranked_eligible boolean NOT NULL DEFAULT true;
ALTER TABLE player_profiles ADD COLUMN progression_level integer NOT NULL DEFAULT 1 CHECK(progression_level BETWEEN 1 AND 100);
ALTER TABLE matches DROP CONSTRAINT matches_mode_check;
ALTER TABLE matches ADD CONSTRAINT matches_mode_check CHECK(mode IN ('arena','coop','raid','extraction','crown'));
ALTER TABLE match_results ADD COLUMN earned_dna integer NOT NULL DEFAULT 0 CHECK(earned_dna>=0);
ALTER TABLE match_results ADD COLUMN extracted boolean NOT NULL DEFAULT false;
ALTER TABLE match_results ADD COLUMN objectives integer NOT NULL DEFAULT 0 CHECK(objectives>=0);
ALTER TABLE match_builds ADD COLUMN keystones jsonb NOT NULL DEFAULT '[]';
ALTER TABLE match_builds ADD COLUMN curses jsonb NOT NULL DEFAULT '[]';
ALTER TABLE match_builds ADD COLUMN organs jsonb NOT NULL DEFAULT '[]';
ALTER TABLE matches ADD COLUMN rules jsonb NOT NULL DEFAULT '{}';
