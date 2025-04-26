import { api, APIError } from "encore.dev/api";
import { verifyToken } from "./auth";
import { db } from "./db";

interface Lead {
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
        const userId = await verifyToken();

        const lead = await db.queryRow<Lead>`
            INSERT INTO lead (name, workspace_id, user_id, email, phone)
            VALUES (${name}, current_setting('app.workspace_id', true), ${userId}, ${email}, ${phone})
            RETURNING *
        `;

        if (!lead) throw APIError.internal("Failed to create lead");
        return lead;
    }
);

// Get a lead by ID
export const getLead = api(
    { expose: true, method: "GET", path: "/lead/:id" },
    async ({ id }: { id: string }): Promise<Lead> => {
        await verifyAndSetUserContext();

        const lead = await db.queryRow<Lead>`
            SELECT l.*
            FROM lead l
            JOIN user_workspaces uw ON uw.workspace_id = l.workspace_id
            JOIN users u ON u.id = uw.user_id
            WHERE l.id = ${id}
            AND (uw.user_id = current_setting('app.user_id', true) OR u.is_superuser)
        `;

        if (!lead) throw APIError.notFound("Lead not found or access denied");
        return lead;
    }
);

// List all leads
export const listLeads = api(
    { expose: true, method: "GET", path: "/lead" },
    async (): Promise<{ leads: Lead[] }> => {
        await verifyAndSetUserContext();

        const leads: Lead[] = [];
        const rows = await db.query<Lead>`
            SELECT l.*
            FROM lead l
            JOIN user_workspaces uw ON uw.workspace_id = l.workspace_id
            JOIN users u ON u.id = uw.user_id
            WHERE l.workspace_id = current_setting('app.workspace_id', true)
            AND (uw.user_id = current_setting('app.user_id', true) OR u.is_superuser)
            ORDER BY l.created_at DESC
        `;

        for await (const row of rows) leads.push(row);
        return { leads };
    }
);

// Delete a lead
export const removeLead = api(
    { expose: true, method: "DELETE", path: "/lead/:id" },
    async ({ id }: { id: string }): Promise<void> => {
        await verifyAndSetUserContext();

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
    }
);
