create table lead (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    user_id text not null,
    name text not null,
    email text not null,
    phone text not null,
    source text,
    created_at timestamp with time zone default CURRENT_TIMESTAMP
);

create table quote_audit_log (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    quote_id uuid not null,
    lead_id uuid not null,
    user_id text not null,
    event_type text not null,
    event_data jsonb,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone default CURRENT_TIMESTAMP
);

create table customer (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    lead_id uuid not null references lead(id),
    user_id text not null,
    name text not null,
    email text not null,
    phone text not null,
    source text,
    status text not null default 'active',
    conversion_date timestamp with time zone default CURRENT_TIMESTAMP,
    first_purchase_date timestamp with time zone,
    last_purchase_date timestamp with time zone,
    total_purchases integer default 0,
    notes text,
    created_at timestamp with time zone default CURRENT_TIMESTAMP,
    updated_at timestamp with time zone default CURRENT_TIMESTAMP
);

create table application (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    user_id text not null,
    lead_id uuid not null,
    plan_id uuid not null references plan(id),
    created_at timestamp with time zone default CURRENT_TIMESTAMP
);

create table offer (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    user_id text not null,
    application_id uuid not null,
    created_at timestamp with time zone default CURRENT_TIMESTAMP
);

-- For lead
ALTER TABLE lead ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_only_leads
ON lead
USING (user_id = current_setting('app.user_id', true));

-- For application
ALTER TABLE application ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_only_applications
ON application
USING (user_id = current_setting('app.user_id', true));

-- For offer
ALTER TABLE offer ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_only_offers
ON offer
USING (user_id = current_setting('app.user_id', true));

-- For customer
ALTER TABLE customer ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_only_customers
ON customer
USING (user_id = current_setting('app.user_id', true));

-- For quote_audit_log
ALTER TABLE quote_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_only_quote_audit_logs
ON quote_audit_log
USING (user_id = current_setting('app.user_id', true));

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_customer_workspace_id ON customer(workspace_id);
CREATE INDEX IF NOT EXISTS idx_customer_lead_id ON customer(lead_id);
CREATE INDEX IF NOT EXISTS idx_customer_email ON customer(email);
CREATE INDEX IF NOT EXISTS idx_customer_status ON customer(status);
CREATE INDEX IF NOT EXISTS idx_customer_conversion_date ON customer(conversion_date);

