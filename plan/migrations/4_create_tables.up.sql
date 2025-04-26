create table lead (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    user_id text not null,
    name text not null,
    email text not null,
    phone text not null,
    created_at timestamp with time zone default CURRENT_TIMESTAMP
);

create table application (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    user_id text not null,
    lead_id uuid not null,
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

