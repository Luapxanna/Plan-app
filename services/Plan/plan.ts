import { api, APIError } from "encore.dev/api";
import { verifyToken, checkWorkspaceContext } from "../Auth/auth";
import { db } from "../db";


interface Workspace {
  id: string;
  name: string;
  created_by: string;
  created_at: Date;
  member_count: number;
}

interface Plan {
  id: string;
  name: string;
  workspace_id: string;
}

interface ListPlansResponse {
  plans: Plan[];
}

interface User {
  id: string;
  email: string;
  is_superuser: boolean;
}

interface ListWorkspacesResponse {
  workspaces: Workspace[];
}

interface ListUsersResponse {
  users: User[];
}

// Helper function to verify token and set user context
async function verifyAndSetUserContext(): Promise<void> {
  const userId = await verifyToken();
  if (!userId) {
    throw APIError.unauthenticated("No active session. Please login first.");
  }

  // Set user context
  await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

  // Get user's first workspace if not set
  const currentWorkspace = await db.queryRow<{ workspace_id: string }>`
      SELECT current_setting('app.workspace_id', true) as workspace_id
  `;

  if (!currentWorkspace?.workspace_id) {
    const workspace = await db.queryRow<{ id: string }>`
        SELECT workspace_id as id
        FROM user_workspaces
        WHERE user_id = ${userId}
        LIMIT 1
    `;

    if (workspace) {
      await db.exec`SELECT set_config('app.workspace_id', ${workspace.id}, false)`;
    }
  }
}

// GetCurrentWorkspace returns the current workspace based on the workspace_id setting
export async function getCurrentWorkspace(): Promise<Workspace> {
  const userId = await verifyToken();
  if (!userId) {
    throw APIError.unauthenticated("No active session. Please login first.");
  }
  await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

  const workspaceId = await checkWorkspaceContext();
  if (!workspaceId) {
    throw APIError.invalidArgument("No workspace selected. Please select a workspace first.");
  }

  const workspaces = await db.query<Workspace>`
    SELECT w.*, 
           (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) as member_count
    FROM workspaces w
    WHERE w.id = ${workspaceId}
  `;

  const workspace = await workspaces.next();
  if (workspace.done || !workspace.value) {
    throw APIError.notFound("Workspace not found");
  }

  return workspace.value;
}

// Change the current workspace context
export const changeCurrentWorkspace = api(
  { expose: true, method: "POST", path: "/workspace/:workspace_id/change" },
  async ({ workspace_id }: { workspace_id: string }): Promise<void> => {
    await verifyAndSetUserContext();

    // Verify the workspace exists and user has access or is superuser
    const workspace = await db.queryRow<{ id: string }>`
      WITH active_user AS (
        SELECT id, is_superuser 
        FROM users 
        WHERE id = current_setting('app.user_id', true)
      )
      SELECT w.id 
      FROM workspace w
      LEFT JOIN user_workspaces uw ON uw.workspace_id = w.id
      WHERE w.id = ${workspace_id}::uuid 
      AND (
        EXISTS (SELECT 1 FROM active_user WHERE is_superuser = true)
        OR uw.user_id = current_setting('app.user_id', true)
      )
    `;

    if (!workspace) {
      throw APIError.notFound("Workspace not found or access denied");
    }

    // Set the workspace context
    await db.exec`SELECT set_config('app.workspace_id', ${workspace_id}, false)`;
  }
);

// Create a new plan
export const createPlan = api(
  { expose: true, method: "POST", path: "/plan" },
  async ({ name }: { name: string }): Promise<Plan> => {
    await verifyAndSetUserContext();
    const workspace_id = await checkWorkspaceContext();

    const plan = await db.queryRow<Plan>`
            INSERT INTO plan (name, workspace_id)
            VALUES (${name}, ${workspace_id})
            RETURNING id, name, workspace_id
        `;

    if (!plan) {
      throw APIError.internal("Failed to create plan");
    }

    return plan;
  }
);

// Get a plan by ID
export const getPlan = api(
  { expose: true, method: "GET", path: "/plan/:id" },
  async ({ id }: { id: string }): Promise<Plan> => {
    await verifyAndSetUserContext();

    try {
      const workspace_id = await checkWorkspaceContext();
      const userId = await verifyToken();

      // Set user context for RLS
      await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

      const plan = await db.queryRow<Plan>`
        SELECT p.*, u.name as user_name
        FROM plan p
        JOIN users u ON u.id = p.user_id
        JOIN user_workspaces uw ON uw.workspace_id = p.workspace_id
        WHERE p.id = ${id}
        AND p.workspace_id = ${workspace_id}
        AND (uw.user_id = ${userId} OR u.is_superuser)
      `;

      if (!plan) throw APIError.notFound("Plan not found or access denied");
      return plan;
    } catch (error) {
      console.error("Error in get function:", error);
      throw error;
    }
  }
);

// Update a plan
export const updatePlan = api(
  { expose: true, method: "PUT", path: "/plan/:id" },
  async ({ id, name }: { id: string; name: string }): Promise<Plan> => {
    await verifyAndSetUserContext();

    const updatedPlan = await db.queryRow<Plan>`
            UPDATE plan p
            SET name = ${name}
            FROM user_workspaces uw
            WHERE p.id = ${id}
                AND p.workspace_id = uw.workspace_id 
                AND uw.user_id = current_setting('app.user_id', true)
            RETURNING p.id, p.name, p.workspace_id
        `;

    if (!updatedPlan) {
      throw APIError.notFound("Plan not found or access denied");
    }

    return updatedPlan;
  }
);

// Delete a plan
export const removePlan = api(
  { expose: true, method: "DELETE", path: "/plan/:id" },
  async ({ id }: { id: string }): Promise<void> => {
    await verifyAndSetUserContext();

    const result = await db.queryRow<{ exists: boolean }>`
            SELECT EXISTS (
                SELECT 1 FROM plan p
                JOIN user_workspaces uw ON uw.workspace_id = p.workspace_id
                WHERE p.id = ${id} AND uw.user_id = current_setting('app.user_id', true)
            ) as exists
        `;

    if (!result?.exists) {
      throw APIError.notFound("Plan not found or access denied");
    }

    await db.exec`
            DELETE FROM plan p
            USING user_workspaces uw
            WHERE p.id = ${id}
                AND p.workspace_id = uw.workspace_id 
                AND uw.user_id = current_setting('app.user_id', true)
        `;
  }
);

// List all plans
export const listPlans = api(
  { expose: true, method: "GET", path: "/plan" },
  async (): Promise<ListPlansResponse> => {
    await verifyAndSetUserContext();

    const plans: Plan[] = [];
    const rows = await db.query<Plan>`
      WITH active_user AS (
        SELECT id, is_superuser 
        FROM users 
        WHERE id = current_setting('app.user_id', true)
      )
      SELECT DISTINCT p.id, p.name, p.workspace_id
      FROM plan p
      LEFT JOIN user_workspaces uw ON p.workspace_id = uw.workspace_id
      WHERE EXISTS (
        SELECT 1 FROM active_user
        WHERE is_superuser = true
      )
      OR uw.user_id = (SELECT id FROM active_user)
      ORDER BY p.name
    `;

    for await (const row of rows) {
      plans.push(row);
    }

    return { plans };
  }
);

// Get all workspaces for the current user
export const listWorkspaces = api(
  { expose: true, method: "GET", path: "/workspace" },
  async (): Promise<ListWorkspacesResponse> => {
    await verifyAndSetUserContext();

    const workspaces: Workspace[] = [];
    const rows = db.query<Workspace>`
      WITH active_user AS (
        SELECT id, is_superuser 
        FROM users 
        WHERE id = current_setting('app.user_id', true)
      )
      SELECT DISTINCT w.id, w.name, w.created_at,
             (SELECT COUNT(*) FROM user_workspaces WHERE workspace_id = w.id) as member_count
      FROM workspace w
      LEFT JOIN user_workspaces uw ON w.id = uw.workspace_id
      WHERE EXISTS (
        SELECT 1 FROM active_user
        WHERE is_superuser = true
      )
      OR uw.user_id = (SELECT id FROM active_user)
      ORDER BY w.name
    `;

    for await (const row of rows) {
      workspaces.push(row);
    }

    return { workspaces };
  }
);

// Grant workspace access to a user
export const grantWorkspaceAccess = api(
  { expose: true, method: "POST", path: "/workspace/:workspace_id/grant/:user_id" },
  async ({ workspace_id, user_id }: { workspace_id: string; user_id: string }): Promise<void> => {
    await verifyAndSetUserContext();
    const currentUserId = await db.queryRow<{ user_id: string }>`
      SELECT current_setting('app.user_id', true) as user_id
    `;

    if (!currentUserId?.user_id) {
      throw APIError.notFound("User not found");
    }

    const isSuperuser = await db.queryRow<{ is_superuser: boolean }>`
      SELECT is_superuser
      FROM users
      WHERE id = ${currentUserId.user_id}
    `;

    if (!isSuperuser?.is_superuser) {
      throw APIError.permissionDenied("Only superusers can grant workspace access");
    }

    await db.exec`
      INSERT INTO user_workspaces (user_id, workspace_id)
      VALUES (${user_id}, ${workspace_id}::uuid)
      ON CONFLICT DO NOTHING
    `;
  }
);

// Revoke workspace access from a user
export const revokeWorkspaceAccess = api(
  { expose: true, method: "POST", path: "/workspace/:workspace_id/revoke/:user_id" },
  async ({ workspace_id, user_id }: { workspace_id: string; user_id: string }): Promise<void> => {
    await verifyAndSetUserContext();
    const currentUserId = await db.queryRow<{ user_id: string }>`
      SELECT current_setting('app.user_id', true) as user_id
    `;

    if (!currentUserId?.user_id) {
      throw APIError.notFound("User not found");
    }

    const isSuperuser = await db.queryRow<{ is_superuser: boolean }>`
      SELECT is_superuser
      FROM users
      WHERE id = ${currentUserId.user_id}
    `;

    if (!isSuperuser?.is_superuser) {
      throw APIError.permissionDenied("Only superusers can revoke workspace access");
    }

    await db.exec`
      DELETE FROM user_workspaces
      WHERE user_id = ${user_id} AND workspace_id = ${workspace_id}::uuid
    `;
  }
);

// Get users with access to a workspace
export const getWorkspaceUsers = api(
  { expose: true, method: "GET", path: "/workspace/:workspace_id/users" },
  async ({ workspace_id }: { workspace_id: string }): Promise<ListUsersResponse> => {
    await verifyAndSetUserContext();
    const currentUserId = await db.queryRow<{ user_id: string }>`
      SELECT current_setting('app.user_id', true) as user_id
    `;

    if (!currentUserId?.user_id) {
      throw APIError.notFound("User not found");
    }

    const isSuperuser = await db.queryRow<{ is_superuser: boolean }>`
      SELECT is_superuser
      FROM users
      WHERE id = ${currentUserId.user_id}
    `;

    if (!isSuperuser?.is_superuser) {
      throw APIError.permissionDenied("Only superusers can view workspace users");
    }

    const users: User[] = [];
    const rows = await db.query<User>`
      SELECT u.id, u.email, u.is_superuser
      FROM users u
      JOIN user_workspaces uw ON uw.user_id = u.id
      WHERE uw.workspace_id = ${workspace_id}::uuid
    `;
    for await (const row of rows) {
      users.push(row);
    }
    return { users };
  }
);

export async function createWorkspace(name: string): Promise<Workspace> {
  const userId = await verifyToken();
  if (!userId) {
    throw APIError.unauthenticated("No active session. Please login first.");
  }
  await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

  const result = await db.queryRow<{ id: string }>`
    WITH new_workspace AS (
      INSERT INTO workspace (name, created_by)
      VALUES (${name}, ${userId})
      RETURNING id
    )
    INSERT INTO user_workspaces (user_id, workspace_id)
    SELECT ${userId}, id
    FROM new_workspace
    RETURNING workspace_id as id
  `;

  if (!result) {
    throw APIError.internal("Failed to create workspace");
  }

  // Set the new workspace as current
  await db.exec`SELECT set_config('app.workspace_id', ${result.id}, false)`;

  return getCurrentWorkspace();
}

export async function updateWorkspace(workspaceId: string, name: string): Promise<Workspace> {
  const userId = await verifyToken();
  if (!userId) {
    throw APIError.unauthenticated("No active session. Please login first.");
  }
  await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

  const workspace = await db.queryRow<Workspace>`
    UPDATE workspaces
    SET name = ${name}
    WHERE id = ${workspaceId}
    AND created_by = ${userId}
    RETURNING *
  `;

  if (!workspace) {
    throw APIError.notFound("Workspace not found or you don't have permission to update it");
  }

  return workspace;
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const userId = await verifyToken();
  if (!userId) {
    throw APIError.unauthenticated("No active session. Please login first.");
  }
  await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

  const result = await db.queryRow<{ deleted: boolean }>`
    WITH deleted AS (
      DELETE FROM workspaces
      WHERE id = ${workspaceId}
      AND created_by = ${userId}
      RETURNING id
    )
    SELECT EXISTS(SELECT 1 FROM deleted) as deleted
  `;

  if (!result?.deleted) {
    throw APIError.notFound("Workspace not found or you don't have permission to delete it");
  }
}

export async function switchWorkspace(workspaceId: string): Promise<Workspace> {
  const userId = await verifyToken();
  if (!userId) {
    throw APIError.unauthenticated("No active session. Please login first.");
  }
  await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

  const workspace = await db.queryRow<Workspace>`
    WITH active_user AS (
      SELECT id, is_superuser 
      FROM users 
      WHERE id = ${userId}::uuid
    )
    SELECT w.*, 
           (SELECT COUNT(*) FROM user_workspaces WHERE workspace_id = w.id) as member_count
    FROM workspace w
    LEFT JOIN user_workspaces uw ON w.id = uw.workspace_id
    WHERE w.id = ${workspaceId}
    AND (
      EXISTS (SELECT 1 FROM active_user WHERE is_superuser = true)
      OR uw.user_id = (SELECT id FROM active_user)
    )
  `;

  if (!workspace) {
    throw APIError.notFound("Workspace not found or you don't have access to it");
  }

  // Set the new workspace as current
  await db.exec`SELECT set_config('app.workspace_id', ${workspaceId}, false)`;

  return workspace;
}
