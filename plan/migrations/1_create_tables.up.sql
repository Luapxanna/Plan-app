CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE workspace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  member_count INT DEFAULT 0
);

CREATE TABLE plan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE
);

-- Insert test workspaces
