import { api, APIError } from "encore.dev/api";
import { verifyToken, checkWorkspaceContext } from "./auth";
import { db } from "./db";
import { sendLeadToQueue } from "./Leadworker";

export interface Lead {
    id: string;
    workspace_id: string;
    user_id: string;
    name: string;
    email: string;
    phone: string;
    created_at: Date;
}

interface ListResponse<T> {
    [key: string]: T[];
}

// Helper function to verify token and set user context
async function verifyAndSetUserContext(): Promise<void> {
    const userId = await verifyToken();
    if (!userId) {
        throw APIError.unauthenticated("No active session. Please login first.");
    }
    await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;
}

// Create a new lead
export const createLead = api(
    { expose: true, method: "POST", path: "/lead" },
    async ({ name, email, phone }: { name: string; email: string; phone: string }): Promise<Lead> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            console.log("Creating lead with:", { name, email, phone, workspace_id, userId });

            // First set the user context for RLS
            await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

            const result = await db.queryRow<Lead>`
                INSERT INTO lead (name, workspace_id, user_id, email, phone)
                VALUES (${name}, ${workspace_id}, ${userId}, ${email}, ${phone})
                RETURNING id, name, workspace_id, user_id, email, phone, created_at
            `;

            console.log("Lead creation result:", result);

            if (!result) throw APIError.internal("Failed to create lead");

            // Send the new lead to the queue for processing
            try {
                await sendLeadToQueue(result);
            } catch (error) {
                console.error("Error sending lead to queue:", error);
                // Don't throw the error - we want the lead creation to succeed even if queue processing fails
            }

            return result;
        } catch (error) {
            console.error("Error in create function:", error);
            throw error;
        }
    }
);

// Get a lead by ID
export const getLead = api(
    { expose: true, method: "GET", path: "/lead/:id" },
    async ({ id }: { id: string }): Promise<Lead> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            // Set user context for RLS
            await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

            const lead = await db.queryRow<Lead>`
                SELECT l.*
                FROM lead l
                JOIN user_workspaces uw ON uw.workspace_id = l.workspace_id
                JOIN users u ON u.id = uw.user_id
                WHERE l.id = ${id}
                AND l.workspace_id = ${workspace_id}
                AND (uw.user_id = ${userId} OR u.is_superuser)
            `;

            if (!lead) throw APIError.notFound("Lead not found or access denied");
            return lead;
        } catch (error) {
            console.error("Error in get function:", error);
            throw error;
        }
    }
);

// List all leads
export const listLeads = api(
    { expose: true, method: "GET", path: "/lead" },
    async (): Promise<{ leads: Lead[] }> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            // Set user context for RLS
            await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

            const leads: Lead[] = [];
            const rows = await db.query<Lead>`
                SELECT l.*
                FROM lead l
                JOIN user_workspaces uw ON uw.workspace_id = l.workspace_id
                JOIN users u ON u.id = uw.user_id
                WHERE l.workspace_id = ${workspace_id}
                AND (uw.user_id = ${userId} OR u.is_superuser)
                ORDER BY l.created_at DESC
            `;

            for await (const row of rows) leads.push(row);
            return { leads };
        } catch (error) {
            console.error("Error in list function:", error);
            throw error;
        }
    }
);

// Delete a lead
export const removeLead = api(
    { expose: true, method: "DELETE", path: "/lead/:id" },
    async ({ id }: { id: string }): Promise<void> => {
        await verifyAndSetUserContext();

        try {
            const result = await db.queryRow<{ exists: boolean }>`
                SELECT EXISTS (
                    SELECT 1 FROM lead l
                    JOIN user_workspaces uw ON uw.workspace_id = l.workspace_id
                    JOIN users u ON u.id = uw.user_id
                    WHERE l.id = ${id}
                    AND (uw.user_id = current_setting('app.user_id', true) OR u.is_superuser)
                ) as exists
            `;

            if (!result?.exists) {
                throw APIError.notFound("Lead not found or access denied");
            }

            await db.exec`
                DELETE FROM lead l
                USING user_workspaces uw
                JOIN users u ON u.id = uw.user_id
                WHERE l.id = ${id}
                AND l.workspace_id = uw.workspace_id
                AND (uw.user_id = current_setting('app.user_id', true) OR u.is_superuser)
            `;
        } catch (error) {
            console.error("Error in delete function:", error);
            throw error;
        }
    }
);
