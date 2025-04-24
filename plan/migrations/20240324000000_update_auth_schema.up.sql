-- Drop old tables
DROP TABLE IF EXISTS user_sessions;

-- Update users table
ALTER TABLE users
  DROP COLUMN IF EXISTS password_hash,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS picture TEXT;

-- Update user_workspaces table if it exists
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_workspaces') THEN
    ALTER TABLE user_workspaces
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$; 