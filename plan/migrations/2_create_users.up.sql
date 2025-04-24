CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_superuser BOOLEAN DEFAULT FALSE
);

CREATE TABLE user_workspaces (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspace(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, workspace_id)
);

-- Add RLS policies for users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Allow users to be looked up by email during login
CREATE POLICY users_login ON users
  FOR SELECT
  USING (true);

-- Allow users to access their own data
CREATE POLICY users_isolation ON users
  USING (id::text = current_setting('app.user_id', true));

-- Add RLS policies for user_workspaces table
ALTER TABLE user_workspaces ENABLE ROW LEVEL SECURITY;

-- Allow access to user_workspaces during login
CREATE POLICY user_workspaces_login ON user_workspaces
  FOR SELECT
  USING (true);

-- Allow users to access their own workspace associations
CREATE POLICY user_workspaces_isolation ON user_workspaces
  USING (user_id::text = current_setting('app.user_id', true));

-- Add RLS policies for workspace and plan
ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan ENABLE ROW LEVEL SECURITY;

-- Allow access to workspace through user_workspaces or if user is superuser
CREATE POLICY workspace_member_access ON workspace
  USING (
    EXISTS (
      SELECT 1 FROM user_workspaces 
      WHERE workspace_id = workspace.id 
      AND user_id::text = current_setting('app.user_id', true)
    )
    OR 
    EXISTS (
      SELECT 1 FROM users
      WHERE id::text = current_setting('app.user_id', true)
      AND is_superuser = true
    )
  );

-- Allow access to plans in accessible workspaces or if user is superuser
CREATE POLICY plan_workspace_access ON plan
  USING (
    EXISTS (
      SELECT 1 FROM user_workspaces 
      WHERE workspace_id = plan.workspace_id 
      AND user_id::text = current_setting('app.user_id', true)
    )
    OR
    EXISTS (
      SELECT 1 FROM users
      WHERE id::text = current_setting('app.user_id', true)
      AND is_superuser = true
    )
  ); 