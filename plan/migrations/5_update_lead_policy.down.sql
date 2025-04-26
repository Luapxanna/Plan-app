-- Drop the new policy
DROP POLICY IF EXISTS workspace_member_leads ON lead;

-- Recreate the old policy
CREATE POLICY user_only_leads ON lead
    USING (user_id = current_setting('app.user_id', true)); 