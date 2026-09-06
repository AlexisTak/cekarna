ALTER TABLE candidate_workspaces
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;
