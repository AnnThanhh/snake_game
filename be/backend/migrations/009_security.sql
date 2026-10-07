ALTER TABLE moderation_actions ADD COLUMN public_reason text NOT NULL DEFAULT '';
ALTER TABLE auth_sessions ADD COLUMN restricted boolean NOT NULL DEFAULT false;
ALTER TABLE player_reports ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE player_reports ADD COLUMN category text NOT NULL DEFAULT 'other';
ALTER TABLE player_reports ADD COLUMN evidence_url text NOT NULL DEFAULT '';
ALTER TABLE player_reports ADD COLUMN room_id text NOT NULL DEFAULT '';
ALTER TABLE player_reports ADD COLUMN match_id uuid;
ALTER TABLE player_reports ADD COLUMN target_session_id text NOT NULL DEFAULT '';
ALTER TABLE player_reports ADD COLUMN target_name text NOT NULL DEFAULT '';
ALTER TABLE player_reports ADD COLUMN payload_hash text;
ALTER TABLE player_reports ADD COLUMN resolution text NOT NULL DEFAULT '';
ALTER TABLE player_reports ADD COLUMN resolved_at timestamptz;
ALTER TABLE player_reports ADD CONSTRAINT report_target_required CHECK(target_id IS NOT NULL OR (room_id<>'' AND target_session_id<>''));
CREATE INDEX reports_by_reporter ON player_reports(reporter_id,created_at DESC);
CREATE TABLE player_notifications (
 id uuid PRIMARY KEY, player_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz
);
CREATE INDEX notifications_by_player ON player_notifications(player_id,created_at DESC);
CREATE TABLE moderation_appeals (
 id uuid PRIMARY KEY, player_id uuid NOT NULL REFERENCES users(id), action_id uuid NOT NULL REFERENCES moderation_actions(id),
 reason text NOT NULL, status text NOT NULL DEFAULT 'open', resolution text NOT NULL DEFAULT '',
 payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolved_by uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX one_open_appeal ON moderation_appeals(player_id,action_id) WHERE status='open';
CREATE TABLE security_events (
 id uuid PRIMARY KEY, event_code text NOT NULL, source text NOT NULL,
 player_id uuid REFERENCES users(id), room_id text NOT NULL DEFAULT '',
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_recent ON security_events(created_at DESC);
