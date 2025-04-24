CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_workspaces (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspace(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, workspace_id)
);

-- Add RLS policies for users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_isolation ON users
  USING (id::text = current_setting('app.user_id', true));

-- Add RLS policies for user_workspaces table
ALTER TABLE user_workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_workspaces_isolation ON user_workspaces
  USING (user_id::text = current_setting('app.user_id', true)); 