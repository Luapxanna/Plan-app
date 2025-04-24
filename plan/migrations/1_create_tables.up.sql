CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE workspace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
);

CREATE TABLE plan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE
);

ALTER TABLE plan DISABLE ROW LEVEL SECURITY;

CREATE POLICY rls_plan_isolation ON plan
  USING (workspace_id::text = current_setting('app.workspace_id', true));
-- Insert test workspaces


ALTER TABLE plan ENABLE ROW LEVEL SECURITY;
