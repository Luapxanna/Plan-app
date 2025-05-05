import { api, APIError } from "encore.dev/api";
import { verifyToken, checkWorkspaceContext } from "../Auth/auth";
import { db } from "../db";
import { Topic } from "encore.dev/pubsub";

// Define the event topic for new insights
const NewInsight = new Topic<Insight>("insight-new", {
    deliveryGuarantee: "at-least-once",
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

        const insight = await db.queryRow<Insight>`
            INSERT INTO insight (title, content, workspace_id, user_id)
            VALUES (
                ${title},
                ${content},
                ${workspaceId}::uuid,
                ${userId}::uuid
            )
            RETURNING id, workspace_id, user_id, title, content, created_at, updated_at
        `;

        if (!insight) {
            throw APIError.internal("Failed to create insight");
        }

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

        const insights: Insight[] = [];
        const rows = await db.query<Insight>`
            WITH active_user AS (
                SELECT id, is_superuser 
                FROM users 
                WHERE id = ${userId}::uuid
            )
            SELECT DISTINCT i.*
            FROM insight i
            LEFT JOIN user_workspaces uw ON uw.workspace_id = i.workspace_id
            WHERE i.workspace_id = ${workspaceId}::uuid
            AND (
                EXISTS (SELECT 1 FROM active_user WHERE is_superuser = true)
                OR uw.user_id = ${userId}::uuid
            )
            ORDER BY i.created_at DESC
        `;

        for await (const row of rows) {
            insights.push(row);
        }

        return { insights };
    }
);

export const handleNewInsight = api(
    { expose: true, method: "POST", path: "/insight/new" },
    async (event: Insight): Promise<void> => {
        console.log("New insight created:", {
            id: event.id,
            title: event.title,
            workspace_id: event.workspace_id,
            user_id: event.user_id
        });

    }
); 