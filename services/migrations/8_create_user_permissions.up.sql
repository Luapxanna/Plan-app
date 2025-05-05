-- Create audit_log table if it doesn't exist
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create insights table
CREATE TABLE insight (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add RLS policy for insights
ALTER TABLE insight ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_member_insights ON insight
    USING (
        EXISTS (
            SELECT 1 FROM user_workspaces uw
            WHERE uw.workspace_id = insight.workspace_id
            AND uw.user_id = current_setting('app.user_id', true)::text
        )
        OR
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_setting('app.user_id', true)::text
            AND u.is_superuser = true
        )
    );

-- Add indexes for better query performance
CREATE INDEX idx_insight_workspace_id ON insight(workspace_id);
CREATE INDEX idx_insight_user_id ON insight(user_id);
CREATE INDEX idx_insight_created_at ON insight(created_at);

-- Create indexes for audit_log
CREATE INDEX idx_audit_log_workspace_id ON audit_log(workspace_id);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at); 