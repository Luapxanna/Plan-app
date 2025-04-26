import { api, APIError } from "encore.dev/api";
import { verifyToken, checkWorkspaceContext } from "./auth";
import { db } from "./db";

interface Offer {
    id: string;
    workspace_id: string;
    user_id: string;
    application_id: string;
    created_at: Date;
}

// Helper function to verify token and set user context
async function verifyAndSetUserContext(): Promise<void> {
    const userId = await verifyToken();
    if (!userId) {
        throw APIError.unauthenticated("No active session. Please login first.");
    }
    await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;
}

// Create a new offer
export const createOffer = api(
    { expose: true, method: "POST", path: "/offer" },
    async ({ application_id }: { application_id: string }): Promise<Offer> => {
        await verifyAndSetUserContext();
        const userId = await verifyToken();

        const offer = await db.queryRow<Offer>`
            INSERT INTO offer (application_id, workspace_id, user_id)
            VALUES (${application_id}, current_setting('app.workspace_id', true), ${userId})
            RETURNING *
        `;

        if (!offer) throw APIError.internal("Failed to create offer");
        return offer;
    }
);

// Get an offer by ID
export const getOffer = api(
    { expose: true, method: "GET", path: "/offer/:id" },
    async ({ id }: { id: string }): Promise<Offer> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            // Set user context for RLS
            await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

            const offer = await db.queryRow<Offer>`
                SELECT o.*, u.name as user_name
                FROM offer o
                JOIN users u ON u.id = o.user_id
                JOIN user_workspaces uw ON uw.workspace_id = o.workspace_id
                WHERE o.id = ${id}
                AND o.workspace_id = ${workspace_id}
                AND (uw.user_id = ${userId} OR u.is_superuser)
            `;

            if (!offer) throw APIError.notFound("Offer not found or access denied");
            return offer;
        } catch (error) {
            console.error("Error in get function:", error);
            throw error;
        }
    }
);

// List all offers
export const listOffers = api(
    { expose: true, method: "GET", path: "/offer" },
    async (): Promise<{ offers: Offer[] }> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            // Set user context for RLS
            await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

            const offers: Offer[] = [];
            const rows = await db.query<Offer>`
                SELECT o.*, u.name as user_name
                FROM offer o
                JOIN users u ON u.id = o.user_id
                JOIN user_workspaces uw ON uw.workspace_id = o.workspace_id
                WHERE o.workspace_id = ${workspace_id}
                AND (uw.user_id = ${userId} OR u.is_superuser)
                ORDER BY o.created_at DESC
            `;

            for await (const row of rows) offers.push(row);
            return { offers };
        } catch (error) {
            console.error("Error in list function:", error);
            throw error;
        }
    }
);

// Delete an offer
export const removeOffer = api(
    { expose: true, method: "DELETE", path: "/offer/:id" },
    async ({ id }: { id: string }): Promise<void> => {
        await verifyAndSetUserContext();

        const result = await db.queryRow<{ exists: boolean }>`
            SELECT EXISTS (
                SELECT 1 FROM offer o
                JOIN user_workspaces uw ON uw.workspace_id = o.workspace_id
                JOIN users u ON u.id = uw.user_id
                WHERE o.id = ${id}
                AND (uw.user_id = current_setting('app.user_id', true) OR u.is_superuser)
            ) as exists
        `;

        if (!result?.exists) {
            throw APIError.notFound("Offer not found or access denied");
        }

        await db.exec`
            DELETE FROM offer o
            USING user_workspaces uw
            JOIN users u ON u.id = uw.user_id
            WHERE o.id = ${id}
            AND o.workspace_id = uw.workspace_id
            AND (uw.user_id = current_setting('app.user_id', true) OR u.is_superuser)
        `;
    }
); 