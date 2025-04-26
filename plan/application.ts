import { api, APIError } from "encore.dev/api";
import { verifyToken, checkWorkspaceContext } from "./auth";
import { db } from "./db";

interface Application {
    id: string;
    workspace_id: string;
    user_id: string;
    lead_id: string;
    created_at: Date;
}

interface ListResponse<T> {
    items: T[];
}

// Helper function to verify token and set user context
async function verifyAndSetUserContext(): Promise<void> {
    const userId = await verifyToken();
    if (!userId) {
        throw APIError.unauthenticated("No active session. Please login first.");
    }
    await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;
}

// Create a new application
export const createApplication = api(
    { expose: true, method: "POST", path: "/application" },
    async ({ lead_id }: { lead_id: string }): Promise<Application> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            const application = await db.queryRow<Application>`
                INSERT INTO application (lead_id, workspace_id, user_id)
                VALUES (${lead_id}, ${workspace_id}, ${userId})
                RETURNING *
            `;

            if (!application) throw APIError.internal("Failed to create application");
            return application;
        } catch (error) {
            console.error("Error in create function:", error);
            throw error;
        }
    }
);

// Get an application by ID
export const getApplication = api(
    { expose: true, method: "GET", path: "/application/:id" },
    async ({ id }: { id: string }): Promise<Application> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            // Set user context for RLS
            await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

            const application = await db.queryRow<Application>`
                SELECT a.*, u.name as user_name
                FROM application a
                JOIN users u ON u.id = a.user_id
                JOIN user_workspaces uw ON uw.workspace_id = a.workspace_id
                WHERE a.id = ${id}
                AND a.workspace_id = ${workspace_id}
                AND (uw.user_id = ${userId} OR u.is_superuser)
            `;

            if (!application) throw APIError.notFound("Application not found or access denied");
            return application;
        } catch (error) {
            console.error("Error in get function:", error);
            throw error;
        }
    }
);

// List all applications
export const listApplications = api(
    { expose: true, method: "GET", path: "/application" },
    async (): Promise<{ applications: Application[] }> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            // Set user context for RLS
            await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

            const applications: Application[] = [];
            const rows = await db.query<Application>`
                SELECT a.*, u.name as user_name
                FROM application a
                JOIN users u ON u.id = a.user_id
                JOIN user_workspaces uw ON uw.workspace_id = a.workspace_id
                WHERE a.workspace_id = ${workspace_id}
                AND (uw.user_id = ${userId} OR u.is_superuser)
                ORDER BY a.created_at DESC
            `;

            for await (const row of rows) applications.push(row);
            return { applications };
        } catch (error) {
            console.error("Error in list function:", error);
            throw error;
        }
    }
);

// Delete an application
export const removeApplication = api(
    { expose: true, method: "DELETE", path: "/application/:id" },
    async ({ id }: { id: string }): Promise<void> => {
        await verifyAndSetUserContext();

        try {
            const result = await db.queryRow<{ exists: boolean }>`
                SELECT EXISTS (
                    SELECT 1 FROM application a
                    JOIN user_workspaces uw ON uw.workspace_id = a.workspace_id
                    JOIN users u ON u.id = uw.user_id
                    WHERE a.id = ${id}
                    AND (uw.user_id = current_setting('app.user_id', true) OR u.is_superuser)
                ) as exists
            `;

            if (!result?.exists) {
                throw APIError.notFound("Application not found or access denied");
            }

            await db.exec`
                DELETE FROM application a
                USING user_workspaces uw
                JOIN users u ON u.id = uw.user_id
                WHERE a.id = ${id}
                AND a.workspace_id = uw.workspace_id
                AND (uw.user_id = current_setting('app.user_id', true) OR u.is_superuser)
            `;
        } catch (error) {
            console.error("Error in delete function:", error);
            throw error;
        }
    }
); 