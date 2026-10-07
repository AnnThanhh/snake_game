CREATE TABLE configuration_definitions (key text PRIMARY KEY, schema jsonb NOT NULL, public boolean NOT NULL DEFAULT false);
CREATE TABLE authorization_policy (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE game_catalogs (id text PRIMARY KEY REFERENCES content_versions(id), data jsonb NOT NULL, published boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE runtime_configuration (id boolean PRIMARY KEY DEFAULT true CHECK(id), catalog_id text NOT NULL REFERENCES game_catalogs(id));
CREATE TABLE whitelist_types (code text PRIMARY KEY);
CREATE TABLE whitelist_scopes (code text PRIMARY KEY);
CREATE TABLE environments (code text PRIMARY KEY);
-- Preserve audit evidence even for a migration-owner connection.
CREATE FUNCTION deny_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit records are append-only'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();
