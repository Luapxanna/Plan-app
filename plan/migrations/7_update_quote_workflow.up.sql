-- Add status and updated_at to lead table
ALTER TABLE lead
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- Update application table
ALTER TABLE application
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS plan_details JSONB,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- Update offer table
ALTER TABLE offer
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS package_details JSONB,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- Create quote_analytics table in PostgreSQL (for reference and backup)
CREATE TABLE IF NOT EXISTS quote_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    quote_id UUID NOT NULL,
    lead_id UUID NOT NULL,
    application_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    event_type TEXT NOT NULL,
    metadata JSONB,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add RLS policy for quote_analytics
ALTER TABLE quote_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_member_quotes ON quote_analytics
    USING (
        EXISTS (
            SELECT 1 FROM user_workspaces uw
            WHERE uw.workspace_id = quote_analytics.workspace_id
            AND uw.user_id = current_setting('app.user_id', true)
        )
        OR
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_setting('app.user_id', true)
            AND u.is_superuser = true
        )
    );

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_lead_status ON lead(status);
CREATE INDEX IF NOT EXISTS idx_application_status ON application(status);
CREATE INDEX IF NOT EXISTS idx_offer_status ON offer(status);
CREATE INDEX IF NOT EXISTS idx_quote_analytics_lead_id ON quote_analytics(lead_id);
CREATE INDEX IF NOT EXISTS idx_quote_analytics_event_type ON quote_analytics(event_type); 