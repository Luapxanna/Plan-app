-- Drop indexes
DROP INDEX IF EXISTS idx_quote_analytics_event_type;
DROP INDEX IF EXISTS idx_quote_analytics_lead_id;
DROP INDEX IF EXISTS idx_offer_status;
DROP INDEX IF EXISTS idx_application_status;
DROP INDEX IF EXISTS idx_lead_status;

-- Drop RLS policy for quote_analytics
DROP POLICY IF EXISTS workspace_member_quotes ON quote_analytics;

-- Drop quote_analytics table
DROP TABLE IF EXISTS quote_analytics;

-- Revert offer table changes
ALTER TABLE offer
    DROP COLUMN IF EXISTS notes,
    DROP COLUMN IF EXISTS expires_at,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS package_details,
    DROP COLUMN IF EXISTS status;

-- Revert application table changes
ALTER TABLE application
    DROP COLUMN IF EXISTS notes,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS plan_details,
    DROP COLUMN IF EXISTS status;

-- Revert lead table changes
ALTER TABLE lead
    DROP COLUMN IF EXISTS notes,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS status; 