-- Drop the old policy
DROP POLICY IF EXISTS user_only_leads ON lead;

-- Create a new policy that allows workspace members to see leads
CREATE POLICY workspace_member_leads ON lead
    USING (
        EXISTS (
            SELECT 1 FROM user_workspaces uw
            WHERE uw.workspace_id = lead.workspace_id
            AND uw.user_id = current_setting('app.user_id', true)
        )
        OR
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_setting('app.user_id', true)
            AND u.is_superuser = true
        )
    ); 