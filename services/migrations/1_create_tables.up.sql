CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE workspace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_workspaces (
  user_id TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspace(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE plan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace(id),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


INSERT INTO workspace (id, name) VALUES
                ('11111111-1111-1111-1111-111111111111'::uuid, 'Development Team'),
                ('22222222-2222-2222-2222-222222222222'::uuid, 'Marketing Team'),
                ('33333333-3333-3333-3333-333333333333'::uuid, 'Sales Team')
            ON CONFLICT (id) DO NOTHING;
INSERT INTO plan (id, name, workspace_id) VALUES
                ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Q1 Development Goals', '11111111-1111-1111-1111-111111111111'::uuid),
                ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Product Launch Plan', '11111111-1111-1111-1111-111111111111'::uuid)
            ON CONFLICT (id) DO NOTHING;
INSERT INTO plan (id, name, workspace_id) VALUES
                ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'Social Media Strategy', '22222222-2222-2222-2222-222222222222'::uuid),
                ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'Content Calendar', '22222222-2222-2222-2222-222222222222'::uuid)
            ON CONFLICT (id) DO NOTHING;
INSERT INTO plan (id, name, workspace_id) VALUES
                ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'Sales Pipeline', '33333333-3333-3333-3333-333333333333'::uuid),
                ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'Customer Success Plan', '33333333-3333-3333-3333-333333333333'::uuid)
            ON CONFLICT (id) DO NOTHING;