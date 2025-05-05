import { api, APIError } from "encore.dev/api";
import { verifyToken, checkWorkspaceContext } from "../Auth/auth";
import { db } from "../db";
import { Topic, Subscription } from "encore.dev/pubsub";
import { requirePermission } from "../Auth/auth";

// Define the event topic for new insights
const NewInsight = new Topic<Insight>("insight-new", {
    deliveryGuarantee: "at-least-once",
});

// Subscribe to new insights
export const NewInsightSubscription = new Subscription(NewInsight, "new-insight-handler", {
    handler: async (event: Insight) => {
        // Log the new insight event
        console.log("New insight created:", {
            id: event.id,
            title: event.title,
            workspace_id: event.workspace_id,
            user_id: event.user_id
        });

        // Log the event in the audit log
        await db.exec`
            INSERT INTO audit_log (workspace_id, user_id, action, resource_type, resource_id, details)
            VALUES (
                ${event.workspace_id}::uuid,
                ${event.user_id}::text,
                'create'::text,
                'insight'::text,
                ${event.id}::uuid,
                jsonb_build_object('title', ${event.title}::text)
            )
        `;
    }
});

export interface Insight {
    id: string;
    workspace_id: string;
    user_id: string;
    title: string;
    content: string;
    created_at: Date;
    updated_at: Date;
}

interface CreateInsightRequest {
    title: string;
    content: string;
}

interface ListInsightsResponse {
    insights: Insight[];
}

// Create a new insight
export const createInsight = api(
    { expose: true, method: "POST", path: "/insight" },
    async ({ title, content }: CreateInsightRequest): Promise<Insight> => {
        const userId = await verifyToken();
        const workspaceId = await checkWorkspaceContext();
        await requirePermission("write:insight");

        const insight = await db.queryRow<Insight>`
            WITH active_user AS (
                SELECT id, is_superuser 
                FROM users 
                WHERE id = current_setting('app.user_id', true)
            )
            INSERT INTO insight (title, content, workspace_id, user_id)
            SELECT 
                ${title}::text,
                ${content}::text,
                ${workspaceId}::uuid,
                (SELECT id FROM active_user)
            RETURNING id, workspace_id, user_id, title, content, created_at, updated_at
        `;

        if (!insight) {
            throw APIError.internal("Failed to create insight");
        }

        // Log audit
        await db.exec`
            INSERT INTO audit_log (workspace_id, user_id, action, resource_type, resource_id, details)
            VALUES (
                ${workspaceId}::uuid,
                ${userId}::text,
                'create',
                'insight',
                ${insight.id}::uuid,
                jsonb_build_object('title', ${title}::text)
            )
        `;

        // Publish the new insight event
        await NewInsight.publish(insight);

        return insight;
    }
);

// List all insights for the current workspace
export const listInsights = api(
    { expose: true, method: "GET", path: "/insight" },
    async (): Promise<ListInsightsResponse> => {
        const userId = await verifyToken();
        const workspaceId = await checkWorkspaceContext();
        await requirePermission("read:insight");

        const insights: Insight[] = [];
        const rows = await db.query<Insight>`
            WITH active_user AS (
                SELECT id, is_superuser 
                FROM users 
                WHERE id = current_setting('app.user_id', true)
            )
            SELECT DISTINCT i.*
            FROM insight i
            LEFT JOIN user_workspaces uw ON uw.workspace_id = i.workspace_id
            WHERE i.workspace_id = ${workspaceId}::uuid
            AND (
                EXISTS (SELECT 1 FROM active_user WHERE is_superuser = true)
                OR uw.user_id = (SELECT id FROM active_user)
            )
            ORDER BY i.created_at DESC
        `;

        for await (const row of rows) {
            insights.push(row);
        }

        // Log audit
        await db.exec`
            INSERT INTO audit_log (workspace_id, user_id, action, resource_type, details)
            VALUES (
                ${workspaceId}::uuid,
                ${userId}::text,
                'list',
                'insight',
                jsonb_build_object('count', ${insights.length}::integer)
            )
        `;

        return { insights };
    }
); 