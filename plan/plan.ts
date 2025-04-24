import { api, APIError } from "encore.dev/api";
import { SQLDatabase } from "encore.dev/storage/sqldb";
import { verifyToken, getCurrentToken } from "./auth";

// 'url' database is used to store the plans
const db = new SQLDatabase("url", { migrations: "./migrations" });

interface Workspace {
  id: string;
  name: string;
}

interface Plan {
  id: string;
  name: string;
  workspace_id: string;
}

interface CreatePlanParams {
  name: string;
  workspace_id: string;
}

interface UpdatePlanParams {
  id: string;
  name: string;
}

interface ListPlansResponse {
  plans: Plan[];
}

interface ListWorkspacesResponse {
  workspaces: Workspace[];
}

// Helper function to verify token and set user context
async function verifyAndSetUserContext(): Promise<void> {
  const { token } = await getCurrentToken();
  if (!token) {
    throw APIError.unauthenticated("No active session. Please login first.");
  }
  const userId = await verifyToken(token);

  // Set user context
  await db.exec`SELECT set_config('app.user_id', ${userId}::text, false)`;

  // Get user's first workspace if not set
  const currentWorkspace = await db.queryRow<{ workspace_id: string }>`
      SELECT current_setting('app.workspace_id', true) as workspace_id
  `;

  if (!currentWorkspace?.workspace_id) {
    const workspace = await db.queryRow<{ id: string }>`
        SELECT workspace_id as id
        FROM user_workspaces
        WHERE user_id = ${userId}::uuid
        LIMIT 1
    `;

    if (workspace) {
      await db.exec`SELECT set_config('app.workspace_id', ${workspace.id}::text, false)`;
    }
  }
}

// GetCurrentWorkspace returns the current workspace based on the workspace_id setting
export const getCurrentWorkspace = api(
  { expose: true, method: "GET", path: "/workspace/current" },
  async (): Promise<Workspace> => {
    await verifyAndSetUserContext();

    const workspaceId = await db.queryRow<{ workspace_id: string }>`
            SELECT current_setting('app.workspace_id', true) as workspace_id
        `;

    if (!workspaceId?.workspace_id) {
      throw APIError.notFound("No workspace found");
    }

    const result = await db.queryRow<Workspace>`
            SELECT id, name FROM workspace WHERE id = ${workspaceId.workspace_id}
        `;

    if (!result) {
      throw APIError.notFound("Workspace not found");
    }

    return result;
  }
);

// Change the current workspace context
export const changeCurrentWorkspace = api(
  { expose: true, method: "POST", path: "/workspace/:workspace_id/change" },
  async ({ workspace_id }: { workspace_id: string }): Promise<void> => {
    await verifyAndSetUserContext();

    // Verify the workspace exists and user has access
    const workspace = await db.queryRow<{ id: string }>`
            SELECT w.id FROM workspace w
            JOIN user_workspaces uw ON uw.workspace_id = w.id
            WHERE w.id = ${workspace_id}::uuid AND uw.user_id = current_setting('app.user_id', true)::uuid
        `;

    if (!workspace) {
      throw APIError.notFound("Workspace not found or access denied");
    }

    // Set the workspace context
    await db.exec`SELECT set_config('app.workspace_id', ${workspace_id}::text, false)`;
  }
);

// Create a new plan
export const create = api(
  { expose: true, method: "POST", path: "/plan" },
  async ({ name }: { name: string }): Promise<Plan> => {
    await verifyAndSetUserContext();
    const workspace_id = await checkWorkspaceContext();

    const plan = await db.queryRow<Plan>`
            INSERT INTO plan (name, workspace_id)
            VALUES (${name}, ${workspace_id}::uuid)
            RETURNING id, name, workspace_id
        `;

    if (!plan) {
      throw APIError.internal("Failed to create plan");
    }

    return plan;
  }
);

// Get a plan by ID
export const get = api(
  { expose: true, method: "GET", path: "/plan/:id" },
  async ({ id }: { id: string }): Promise<Plan> => {
    await verifyAndSetUserContext();

    const plan = await db.queryRow<Plan>`
            SELECT p.id, p.name, p.workspace_id
            FROM plan p
            JOIN user_workspaces uw ON uw.workspace_id = p.workspace_id
            WHERE p.id = ${id}::uuid AND uw.user_id = current_setting('app.user_id', true)::uuid
        `;

    if (!plan) {
      throw APIError.notFound("Plan not found or access denied");
    }

    return plan;
  }
);

// Update a plan
export const update = api(
  { expose: true, method: "PUT", path: "/plan/:id" },
  async ({ id, name }: { id: string; name: string }): Promise<Plan> => {
    await verifyAndSetUserContext();

    const updatedPlan = await db.queryRow<Plan>`
            UPDATE plan p
            SET name = ${name}
            FROM user_workspaces uw
            WHERE p.id = ${id}::uuid 
                AND p.workspace_id = uw.workspace_id 
                AND uw.user_id = current_setting('app.user_id', true)::uuid
            RETURNING p.id, p.name, p.workspace_id
        `;

    if (!updatedPlan) {
      throw APIError.notFound("Plan not found or access denied");
    }

    return updatedPlan;
  }
);

// Delete a plan
export const remove = api(
  { expose: true, method: "DELETE", path: "/plan/:id" },
  async ({ id }: { id: string }): Promise<void> => {
    await verifyAndSetUserContext();

    const result = await db.queryRow<{ exists: boolean }>`
            SELECT EXISTS (
                SELECT 1 FROM plan p
                JOIN user_workspaces uw ON uw.workspace_id = p.workspace_id
                WHERE p.id = ${id}::uuid AND uw.user_id = current_setting('app.user_id', true)::uuid
            ) as exists
        `;

    if (!result?.exists) {
      throw APIError.notFound("Plan not found or access denied");
    }

    await db.exec`
            DELETE FROM plan p
            USING user_workspaces uw
            WHERE p.id = ${id}::uuid 
                AND p.workspace_id = uw.workspace_id 
                AND uw.user_id = current_setting('app.user_id', true)::uuid
        `;
  }
);

// Helper function to check current workspace context
async function checkWorkspaceContext(): Promise<string> {
  const result = await db.queryRow<{ workspace_id: string }>`
    SELECT current_setting('app.workspace_id', false) as workspace_id
  `;

  if (!result || !result.workspace_id) {
    throw APIError.invalidArgument("No workspace context set. Please set workspace context first.");
  }

  return result.workspace_id;
}

// List all plans in a workspace
export const list = api(
  { expose: true, method: "GET", path: "/plan" },
  async (): Promise<ListPlansResponse> => {
    await verifyAndSetUserContext();

    try {
      const workspace_id = await checkWorkspaceContext();

      const plans: Plan[] = [];
      const rows = db.query<Plan>`
                SELECT p.id, p.name, p.workspace_id
                FROM plan p
                JOIN user_workspaces uw ON uw.workspace_id = p.workspace_id
                WHERE p.workspace_id = ${workspace_id}::uuid 
                    AND uw.user_id = current_setting('app.user_id', true)::uuid
            `;

      for await (const row of rows) {
        plans.push(row);
      }

      return { plans };
    } catch (error) {
      console.error("Error in list function:", error);
      throw error;
    }
  }
);

// Insert test data
export const insertTestData = api(
  { expose: true, method: "POST", path: "/test-data" },
  async (): Promise<void> => {
    await verifyAndSetUserContext();

    // Insert test workspaces
    await db.exec`
            INSERT INTO workspace (id, name) VALUES
                ('11111111-1111-1111-1111-111111111111'::uuid, 'Development Team'),
                ('22222222-2222-2222-2222-222222222222'::uuid, 'Marketing Team'),
                ('33333333-3333-3333-3333-333333333333'::uuid, 'Sales Team')
            ON CONFLICT (id) DO NOTHING;
        `;

    // Insert test plans for Development Team
    await db.exec`
            INSERT INTO plan (id, name, workspace_id) VALUES
                ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Q1 Development Goals', '11111111-1111-1111-1111-111111111111'::uuid),
                ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Product Launch Plan', '11111111-1111-1111-1111-111111111111'::uuid)
            ON CONFLICT (id) DO NOTHING;
        `;

    // Insert test plans for Marketing Team
    await db.exec`
            INSERT INTO plan (id, name, workspace_id) VALUES
                ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'Social Media Strategy', '22222222-2222-2222-2222-222222222222'::uuid),
                ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'Content Calendar', '22222222-2222-2222-2222-222222222222'::uuid)
            ON CONFLICT (id) DO NOTHING;
        `;

    // Insert test plans for Sales Team
    await db.exec`
            INSERT INTO plan (id, name, workspace_id) VALUES
                ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'Sales Pipeline', '33333333-3333-3333-3333-333333333333'::uuid),
                ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'Customer Success Plan', '33333333-3333-3333-3333-333333333333'::uuid)
            ON CONFLICT (id) DO NOTHING;
        `;
  }
);

// Get all workspaces for the current user
export const listWorkspaces = api(
  { expose: true, method: "GET", path: "/workspace", auth: false },
  async (): Promise<ListWorkspacesResponse> => {
    await verifyAndSetUserContext();

    const workspaces: Workspace[] = [];
    const rows = db.query<Workspace>`
            SELECT w.id, w.name
            FROM workspace w
            ORDER BY w.name
        `;

    for await (const row of rows) {
      workspaces.push(row);
    }

    return { workspaces };
  }
);
