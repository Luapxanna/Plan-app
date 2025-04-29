import { api, APIError } from "encore.dev/api";
import { verifyToken, checkWorkspaceContext } from "./auth";
import { db } from "./db";
import { logQuoteEvent } from "./quote_analytic";

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired';

export interface Quote {
    id: string;
    workspace_id: string;
    user_id: string;
    lead_id: string;
    application_id: string;
    status: QuoteStatus;
    package_details: {
        name: string;
        description: string;
        price: number;
        currency: string;
        validity_period: number;
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

// Helper function to log quote audit events
async function logQuoteAudit(params: {
    workspace_id: string;
    quote_id: string;
    lead_id: string;
    user_id: string;
    event_type: string;
    event_data?: any;
    ip_address?: string;
    user_agent?: string;
}): Promise<void> {
    // Ensure UUIDs are properly formatted
    const workspace_id = params.workspace_id.replace(/-/g, '');
    const quote_id = params.quote_id.replace(/-/g, '');
    const lead_id = params.lead_id.replace(/-/g, '');

    await db.exec`
        INSERT INTO quote_audit_log (
            workspace_id,
            quote_id,
            lead_id,
            user_id,
            event_type,
            event_data,
            ip_address,
            user_agent
        )
        VALUES (
            ${workspace_id}::uuid,
            ${quote_id}::uuid,
            ${lead_id}::uuid,
            ${params.user_id},
            ${params.event_type},
            ${params.event_data ? JSON.stringify(params.event_data) : null},
            ${params.ip_address},
            ${params.user_agent}
        )
    `;
}

// Send a quote
export const sendQuote = api(
    { expose: true, method: "POST", path: "/quote/send" },
    async ({ quote_id, ip_address, user_agent }: { quote_id: string; ip_address?: string; user_agent?: string }): Promise<void> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            // Get the quote details from the offer and application
            const offer = await db.queryRow<{ lead_id: string; application_id: string; package_details: any }>`
                SELECT o.application_id, o.package_details, a.lead_id
                FROM offer o
                JOIN application a ON a.id = o.application_id
                WHERE o.id = ${quote_id}
                AND o.workspace_id = ${workspace_id}
            `;

            if (!offer) {
                throw APIError.notFound("Offer not found");
            }

            // Log the quote sent event
            await logQuoteEvent({
                workspace_id,
                quote_id,
                lead_id: offer.lead_id,
                application_id: offer.application_id,
                user_id: userId,
                status: 'sent',
                event_type: 'sent',
                metadata: {
                    price: offer.package_details.price,
                    currency: offer.package_details.currency,
                    validity_period: offer.package_details.validity_period
                }
            });

            // Log audit event
            await logQuoteAudit({
                workspace_id,
                quote_id,
                lead_id: offer.lead_id,
                user_id: userId,
                event_type: 'quote_sent',
                event_data: {
                    price: offer.package_details.price,
                    currency: offer.package_details.currency
                },
                ip_address,
                user_agent
            });

            // Simulate sending to conversion dashboard
            await simulateConversionDashboardEvent({
                event_type: 'quote_sent',
                quote_id,
                lead_id: offer.lead_id,
                workspace_id,
                user_id: userId,
                data: {
                    price: offer.package_details.price,
                    currency: offer.package_details.currency
                }
            });
        } catch (error) {
            console.error("Error sending quote:", error);
            throw error;
        }
    }
);

// Track quote view
export const trackQuoteView = api(
    { expose: true, method: "POST", path: "/quote/view" },
    async ({ quote_id, ip_address, user_agent }: { quote_id: string; ip_address?: string; user_agent?: string }): Promise<void> => {
        await verifyAndSetUserContext();

        try {
            const workspace_id = await checkWorkspaceContext();
            const userId = await verifyToken();

            // Get the quote details from the offer and application
            const offer = await db.queryRow<{ lead_id: string; application_id: string }>`
                SELECT o.application_id, a.lead_id
                FROM offer o
                JOIN application a ON a.id = o.application_id
                WHERE o.id = ${quote_id}
                AND o.workspace_id = ${workspace_id}
            `;

            if (!offer) {
                throw APIError.notFound("Offer not found");
            }

            // Log the quote viewed event
            await logQuoteEvent({
                workspace_id,
                quote_id,
                lead_id: offer.lead_id,
                application_id: offer.application_id,
                user_id: userId,
                status: 'viewed',
                event_type: 'viewed',
                metadata: {
                    viewed_at: new Date().toISOString()
                }
            });

            // Log audit event
            await logQuoteAudit({
                workspace_id,
                quote_id,
                lead_id: offer.lead_id,
                user_id: userId,
                event_type: 'quote_viewed',
                ip_address,
                user_agent
            });

            // Simulate sending to conversion dashboard
            await simulateConversionDashboardEvent({
                event_type: 'quote_viewed',
                quote_id,
                lead_id: offer.lead_id,
                workspace_id,
                user_id: userId
            });
        } catch (error) {
            console.error("Error tracking quote view:", error);
            throw error;
        }
    }
);

// Simulate conversion dashboard event
async function simulateConversionDashboardEvent(params: {
    event_type: string;
    quote_id: string;
    lead_id: string;
    workspace_id: string;
    user_id: string;
    data?: any;
}): Promise<void> {
    // In a real implementation, this would send data to your conversion dashboard
    // For now, we'll just log it
    console.log("Conversion Dashboard Event:", {
        ...params,
        timestamp: new Date().toISOString()
    });
} 