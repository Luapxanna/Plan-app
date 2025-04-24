import { api, APIError } from "encore.dev/api";
import { SQLDatabase } from "encore.dev/storage/sqldb";

// 'url' database is used to store the plans
const db = new SQLDatabase("url", { migrations: "./migrations" });

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

// Change the current workspace context
export const changeCurrentWorkspace = api(
  { expose: true, auth: false, method: "POST", path: "/workspace/:workspace_id/change" },
  async ({ workspace_id }: { workspace_id: string }): Promise<void> => {
    // Verify the workspace exists
    const workspace = await db.queryRow<{ id: string }>`
      SELECT id FROM workspace WHERE id = ${workspace_id}
    `;

    if (!workspace) {
      throw APIError.notFound("Workspace not found");
    }

    // Set the workspace context for RLS
    await db.exec`SELECT set_config('app.workspace_id', ${workspace_id}, false)`;
  }
);

// Create a new plan
export const create = api(
  { expose: true, auth: false, method: "POST", path: "/plan" },
  async (req: CreatePlanParams): Promise<Plan> => {
    const workspace_id = await checkWorkspaceContext();

    const plan = await db.queryRow<Plan>`
      INSERT INTO plan (name, workspace_id)
      VALUES (${req.name}, ${workspace_id})
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
  { expose: true, auth: false, method: "GET", path: "/plan/:id" },
  async (params: { id: string }): Promise<Plan> => {
    const { id } = params;
    const plans = await db.query<Plan>`
      SELECT id, name, workspace_id
      FROM plan
      WHERE id = ${id}
    `;

    const plan = await plans.next();
    if (!plan.value) {
      throw APIError.notFound("Plan not found");
    }

    return plan.value;
  }
);

// Update a plan
export const update = api(
  { expose: true, auth: false, method: "PUT", path: "/plan/:id" },
  async ({ id, name }: UpdatePlanParams): Promise<Plan> => {
    const updatedPlan = await db.queryRow<Plan>`
      UPDATE plan
      SET name = ${name}
      WHERE id = ${id}
      RETURNING id, name, workspace_id
    `;

    if (!updatedPlan) {
      throw APIError.notFound("Plan not found");
    }

    return updatedPlan;
  }
);

// Delete a plan
export const remove = api(
  { expose: true, auth: false, method: "DELETE", path: "/plan/:id" },
  async ({ id }: { id: string }): Promise<void> => {
    await db.exec`
      DELETE FROM plan
      WHERE id = ${id}
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
  { expose: true, auth: false, method: "GET", path: "/plan" },
  async (): Promise<ListPlansResponse> => {
    try {
      const workspace_id = await checkWorkspaceContext();

      const plans: Plan[] = [];
      const rows = db.query<Plan>`
        SELECT id, name, workspace_id
        FROM plan
        WHERE workspace_id = ${workspace_id}
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
  { expose: true, auth: false, method: "POST", path: "/test-data" },
  async (): Promise<void> => {
    // Insert test workspaces
    await db.exec`
      INSERT INTO workspace (id, name) VALUES
        ('11111111-1111-1111-1111-111111111111', 'Development Team'),
        ('22222222-2222-2222-2222-222222222222', 'Marketing Team'),
        ('33333333-3333-3333-3333-333333333333', 'Sales Team')
      ON CONFLICT (id) DO NOTHING;
    `;

    // Insert test plans for Development Team
    await db.exec`
      INSERT INTO plan (id, name, workspace_id) VALUES
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Q1 Development Goals', '11111111-1111-1111-1111-111111111111'),
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Product Launch Plan', '11111111-1111-1111-1111-111111111111')
      ON CONFLICT (id) DO NOTHING;
    `;

    // Insert test plans for Marketing Team
    await db.exec`
      INSERT INTO plan (id, name, workspace_id) VALUES
        ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Social Media Strategy', '22222222-2222-2222-2222-222222222222'),
        ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Content Calendar', '22222222-2222-2222-2222-222222222222')
      ON CONFLICT (id) DO NOTHING;
    `;

    // Insert test plans for Sales Team
    await db.exec`
      INSERT INTO plan (id, name, workspace_id) VALUES
        ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Sales Pipeline', '33333333-3333-3333-3333-333333333333'),
        ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Customer Success Plan', '33333333-3333-3333-3333-333333333333')
      ON CONFLICT (id) DO NOTHING;
    `;
  }
);
