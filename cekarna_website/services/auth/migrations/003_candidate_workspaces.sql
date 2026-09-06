CREATE TABLE IF NOT EXISTS candidate_workspaces (
    user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    workspace jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
