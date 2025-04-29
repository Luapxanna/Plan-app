import { api, APIError } from "encore.dev/api";
import { verifyToken, checkWorkspaceContext } from "./auth";
import { db } from "./db";
import { logQuoteEvent } from "./quote_analytic";
import { convertLeadToCustomer } from "./lead";
import { sendQuote } from "./quote";

export type OfferStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface Offer {
    id: string;
    workspace_id: string;
    user_id: string;
    application_id: string;
    status: OfferStatus;
    package_details: {
        name: string;
        description: string;
        price: number;
        currency: string;
        validity_period: number; // in days
        included_features: string[];
        terms_and_conditions: string;
    };
    notes?: string;
    created_at: Date;
    updated_at: Date;
    expires_at: Date;
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
    async ({
        application_id,
        package_details
    }: {
        application_id: string;
        package_details: Offer['package_details'];
    }): Promise<Offer> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            // Verify application exists and is approved
            const application = await db.queryRow<{ status: string }>`
                SELECT status FROM application
                WHERE id = ${application_id}
                AND workspace_id = ${workspace_id}
            `;

            if (!application) {
                throw APIError.notFound("Application not found");
            }

            if (application.status !== 'approved') {
                throw APIError.invalidArgument("Can only create offers for approved applications");
            }

            const validityPeriod = package_details.validity_period || 30; // default 30 days
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + validityPeriod);

            const offer = await db.queryRow<Offer>`
                INSERT INTO offer (
                    application_id, workspace_id, user_id,
                    status, package_details, created_at, updated_at, expires_at
                )
                VALUES (
                    ${application_id}, ${workspace_id}, ${userId},
                    'draft', ${JSON.stringify(package_details)},
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${expiresAt}
                )
                RETURNING *
            `;

            if (!offer) throw APIError.internal("Failed to create offer");
            return offer;
        } catch (error) {
            console.error("Error in create function:", error);
            throw error;
        }
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

// Update offer status
export const updateOfferStatus = api(
    { expose: true, method: "PUT", path: "/offer/:id/status" },
    async ({ id, status, notes }: { id: string; status: OfferStatus; notes?: string }): Promise<Offer> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            await db.exec`SELECT set_config('app.user_id', ${userId}, false)`;

            // Get the offer details before updating
            const offer = await db.queryRow<Offer & { lead_id: string }>`
                SELECT o.*, a.lead_id
                FROM offer o
                JOIN application a ON a.id = o.application_id
                WHERE o.id = ${id}
                AND o.workspace_id = ${workspace_id}
            `;

            if (!offer) throw APIError.notFound("Offer not found or access denied");

            const result = await db.queryRow<Offer>`
                UPDATE offer
                SET 
                    status = ${status},
                    notes = COALESCE(${notes}, notes),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ${id}
                AND workspace_id = ${workspace_id}
                RETURNING *
            `;

            if (!result) throw APIError.notFound("Offer not found or access denied");

            // If offer is accepted, update related application and lead status
            if (status === 'accepted') {
                // Update lead status to converted
                await db.exec`
                    WITH app_id AS (
                        SELECT application_id FROM offer WHERE id = ${id}
                    )
                    UPDATE lead l
                    SET status = 'converted',
                        updated_at = CURRENT_TIMESTAMP
                    FROM application a
                    WHERE a.id = (SELECT application_id FROM app_id)
                    AND l.id = a.lead_id;
                `;

                // Log the quote acceptance event
                await logQuoteEvent({
                    workspace_id,
                    quote_id: id,
                    lead_id: offer.lead_id,
                    application_id: offer.application_id,
                    user_id: userId,
                    status: 'accepted',
                    event_type: 'accepted',
                    metadata: {
                        price: offer.package_details.price,
                        currency: offer.package_details.currency,
                        validity_period: offer.package_details.validity_period
                    }
                });

                // Convert the lead to a customer
                await convertLeadToCustomer({ id: offer.lead_id, notes: "Converted from accepted offer" });

                // Automatically send the quote
                await sendQuote({
                    quote_id: id,
                    ip_address: 'system', // Mark as system-generated
                    user_agent: 'system'  // Mark as system-generated
                });
            }

            return result;
        } catch (error) {
            console.error("Error updating offer status:", error);
            throw error;
        }
    }
); 