import { api, APIError } from "encore.dev/api";
import { verifyToken, checkWorkspaceContext } from "./auth";
import { db } from "./db";
import { sendLeadToQueue } from "./Leadworker";

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';

export interface Lead {
    id: string;
    workspace_id: string;
    user_id: string;
    name: string;
    email: string;
    phone: string;
    status: LeadStatus;
    source?: string;
    notes?: string;
    created_at: Date;
    updated_at: Date;
}

export interface Customer {
    id: string;
    workspace_id: string;
    lead_id: string;
    user_id: string;
    name: string;
    email: string;
    phone: string;
    source?: string;
    conversion_date: Date;
    first_purchase_date?: Date;
    last_purchase_date?: Date;
    status: string;
    notes?: string;
    created_at: Date;
    updated_at: Date;
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
    async ({ name, email, phone, source }: { name: string; email: string; phone: string; source?: string }): Promise<Lead> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            console.log("Creating lead with:", { name, email, phone, workspace_id, userId });

            // First set the user context for RLS
            await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

            const result = await db.queryRow<Lead>`
                INSERT INTO lead (
                    name, workspace_id, user_id, email, phone, 
                    status, source, created_at, updated_at
                )
                VALUES (
                    ${name}, ${workspace_id}, ${userId}, ${email}, ${phone},
                    'new', ${source}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                RETURNING *
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

// Update lead status
export const updateLeadStatus = api(
    { expose: true, method: "PUT", path: "/lead/:id/status" },
    async ({ id, status, notes }: { id: string; status: LeadStatus; notes?: string }): Promise<Lead> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

            const result = await db.queryRow<Lead>`
                UPDATE lead
                SET 
                    status = ${status},
                    notes = COALESCE(${notes}, notes),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ${id}
                AND workspace_id = ${workspace_id}
                RETURNING *
            `;

            if (!result) throw APIError.notFound("Lead not found or access denied");
            return result;
        } catch (error) {
            console.error("Error updating lead status:", error);
            throw error;
        }
    }
);

// Convert a lead to a customer
export const convertLeadToCustomer = api(
    { expose: true, method: "POST", path: "/lead/:id/convert" },
    async ({ id, notes }: { id: string; notes?: string }): Promise<Customer> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            // Get the lead details
            const lead = await db.queryRow<Lead>`
                SELECT * FROM lead
                WHERE id = ${id}
                AND workspace_id = ${workspace_id}
                AND status = 'converted'
            `;

            if (!lead) {
                throw APIError.notFound("Lead not found or not ready for conversion");
            }

            // Create the customer record
            const customer = await db.queryRow<Customer>`
                INSERT INTO customer (
                    workspace_id,
                    lead_id,
                    user_id,
                    name,
                    email,
                    phone,
                    source,
                    conversion_date,
                    first_purchase_date,
                    notes,
                    created_at,
                    updated_at
                )
                VALUES (
                    ${workspace_id},
                    ${lead.id},
                    ${lead.user_id},
                    ${lead.name},
                    ${lead.email},
                    ${lead.phone},
                    ${lead.source},
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP,
                    ${notes},
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP
                )
                RETURNING *
            `;

            if (!customer) {
                throw APIError.internal("Failed to convert lead to customer");
            }

            // Update lead status to indicate it's been converted to customer
            await db.exec`
                UPDATE lead
                SET status = 'customer',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ${id}
            `;

            return customer;
        } catch (error) {
            console.error("Error converting lead to customer:", error);
            throw error;
        }
    }
);
