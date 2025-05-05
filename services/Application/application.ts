import { api, APIError } from "encore.dev/api";
import { verifyToken, checkWorkspaceContext } from "../Auth/auth";
import { db } from "../db";

export type ApplicationStatus = 'pending' | 'reviewing' | 'approved' | 'rejected';

export interface Application {
    id: string;
    workspace_id: string;
    user_id: string;
    lead_id: string;
    plan_id: string;
    status: ApplicationStatus;
    notes?: string;
    created_at: Date;
    updated_at: Date;
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
    async ({
        lead_id,
        plan_id
    }: {
        lead_id: string;
        plan_id: string;
    }): Promise<Application> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            // Verify lead exists and belongs to workspace
            const leadExists = await db.queryRow<{ exists: boolean }>`
                SELECT EXISTS (
                    SELECT 1 FROM lead
                    WHERE id = ${lead_id}
                    AND workspace_id = ${workspace_id}
                ) as exists
            `;

            if (!leadExists?.exists) {
                throw APIError.notFound("Lead not found");
            }

            // Verify plan exists and belongs to workspace
            const planExists = await db.queryRow<{ exists: boolean }>`
                SELECT EXISTS (
                    SELECT 1 FROM plan
                    WHERE id = ${plan_id}
                    AND workspace_id = ${workspace_id}
                ) as exists
            `;

            if (!planExists?.exists) {
                throw APIError.notFound("Plan not found");
            }

            const application = await db.queryRow<Application>`
                INSERT INTO application (
                    lead_id, workspace_id, user_id, plan_id,
                    status, created_at, updated_at
                )
                VALUES (
                    ${lead_id}, ${workspace_id}, ${userId}, ${plan_id},
                    'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                RETURNING *
            `;

            if (!application) throw APIError.internal("Failed to create application");

            // Update lead status to indicate application received
            await db.exec`
                UPDATE lead
                SET status = 'qualified',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ${lead_id}
            `;

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

        const application = await db.queryRow<Application>`
            WITH active_user AS (
                SELECT id, is_superuser 
                FROM users 
                WHERE id = current_setting('app.user_id', true)
            )
            SELECT a.*, u.name as user_name
            FROM application a
            JOIN users u ON u.id = a.user_id
            LEFT JOIN user_workspaces uw ON uw.workspace_id = a.workspace_id
            WHERE a.id = ${id}
            AND (
                EXISTS (SELECT 1 FROM active_user WHERE is_superuser = true)
                OR uw.user_id = (SELECT id FROM active_user)
            )
        `;

        if (!application) throw APIError.notFound("Application not found or access denied");
        return application;
    }
);

// List all applications
export const listApplications = api(
    { expose: true, method: "GET", path: "/application" },
    async (): Promise<{ applications: Application[] }> => {
        await verifyAndSetUserContext();

        const applications: Application[] = [];
        const rows = await db.query<Application>`
            WITH active_user AS (
                SELECT id, is_superuser 
                FROM users 
                WHERE id = current_setting('app.user_id', true)
            )
            SELECT DISTINCT a.*, u.name as user_name
            FROM application a
            JOIN users u ON u.id = a.user_id
            LEFT JOIN user_workspaces uw ON uw.workspace_id = a.workspace_id
            WHERE EXISTS (
                SELECT 1 FROM active_user
                WHERE is_superuser = true
            )
            OR uw.user_id = (SELECT id FROM active_user)
            ORDER BY a.created_at DESC
        `;

        for await (const row of rows) {
            applications.push(row);
        }

        return { applications };
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

// Update application status
export const updateApplicationStatus = api(
    { expose: true, method: "PUT", path: "/application/:id/status" },
    async ({ id, status, notes }: { id: string; status: ApplicationStatus; notes?: string }): Promise<Application> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

            const result = await db.queryRow<Application>`
                UPDATE application
                SET 
                    status = ${status},
                    notes = COALESCE(${notes}, notes),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ${id}
                AND workspace_id = ${workspace_id}
                RETURNING *
            `;

            if (!result) throw APIError.notFound("Application not found or access denied");
            return result;
        } catch (error) {
            console.error("Error updating application status:", error);
            throw error;
        }
    }
); 