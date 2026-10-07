ALTER TABLE match_builds ADD COLUMN mutations jsonb NOT NULL DEFAULT '[]';
ALTER TABLE match_builds ADD COLUMN hybrids jsonb NOT NULL DEFAULT '[]';
