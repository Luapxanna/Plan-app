import { api } from "encore.dev/api";
import { ClickHouse } from "clickhouse";

// ClickHouse client setup
const clickhouse = new ClickHouse({
    url: 'http://localhost:8123',
    user: 'myuser',
    password: 'mypassword',
    database: 'default',
    format: "json"
});

// Types for quote analytics
export interface QuoteAnalytic {
    workspace_id: string;
    quote_id: string;
    lead_id: string;
    application_id: string;
    user_id: string;
    status: string;
    event_type: 'created' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired';
    metadata: {
        price?: number;
        currency?: string;
        validity_period?: number;
        viewed_at?: string;
        response_time?: number; // in seconds
        conversion_path?: string[];
    };
    sent_at: Date;
}

// Types for analytics queries
export interface QuoteStats {
    total_quotes: number;
    quotes_by_status: Record<string, number>;
    quotes_by_user: Record<string, number>;
    quotes_by_lead: Record<string, number>;
    conversion_rate: number;
    average_response_time: number;
    first_quote_at: string;
    last_quote_at: string;
}

// Types for ClickHouse query results
interface ClickHouseStats {
    total_quotes: string;
    status_counts: [string, string][];
    user_counts: [string, string][];
    lead_counts: [string, string][];
    accepted_count: string;
    total_count: string;
    avg_response_time: string;
    first_quote: string;
    last_quote: string;
}

interface ClickHouseQuoteRow {
    workspace_id: string;
    quote_id: string;
    lead_id: string;
    application_id: string;
    user_id: string;
    status: string;
    event_type: string;
    metadata: string;
    sent_at: string;
}

type ClickHouseQueryResult = ClickHouseQuoteRow[];

// Helper function to format date for ClickHouse
function formatDateForClickHouse(date: Date): string {
    return date.toISOString().replace('T', ' ').substring(0, 19);
}

// Log a quote event
export async function logQuoteEvent(params: {
    workspace_id: string;
    quote_id: string;
    lead_id: string;
    application_id: string;
    user_id: string;
    status: string;
    event_type: QuoteAnalytic['event_type'];
    metadata?: QuoteAnalytic['metadata'];
}): Promise<void> {
    const query = `
        INSERT INTO quote_analytics (
            workspace_id,
            quote_id,
            lead_id,
            application_id,
            user_id,
            status,
            event_type,
            metadata,
            sent_at
        ) VALUES (
            '${params.workspace_id}',
            '${params.quote_id}',
            '${params.lead_id}',
            '${params.application_id}',
            '${params.user_id}',
            '${params.status}',
            '${params.event_type}',
            ${params.metadata ? `'${JSON.stringify(params.metadata)}'` : 'NULL'},
            '${formatDateForClickHouse(new Date())}'
        )
    `;

    await clickhouse.query(query).toPromise();
}

// Get quote statistics for a workspace
export const getQuoteStats = api(
    { method: "GET", path: "/stats/quotes", expose: true },
    async (params: { workspace_id: string }): Promise<QuoteStats> => {
        const query = `
            WITH quote_counts AS (
                SELECT 
                    status,
                    user_id,
                    lead_id,
                    count() as count
                FROM quote_analytics
                WHERE workspace_id = '${params.workspace_id}'
                GROUP BY status, user_id, lead_id
            ),
            conversion_stats AS (
                SELECT 
                    countIf(event_type = 'accepted') as accepted_count,
                    count() as total_count,
                    avg(JSONExtractFloat(metadata, 'response_time')) as avg_response_time
                FROM quote_analytics
                WHERE workspace_id = '${params.workspace_id}'
            ),
            time_stats AS (
                SELECT 
                    min(sent_at) as first_quote,
                    max(sent_at) as last_quote
                FROM quote_analytics
                WHERE workspace_id = '${params.workspace_id}'
            )
            SELECT 
                sum(count) as total_quotes,
                groupArray((status, count)) as status_counts,
                groupArray((user_id, count)) as user_counts,
                groupArray((lead_id, count)) as lead_counts,
                any(conversion_stats.accepted_count) as accepted_count,
                any(conversion_stats.total_count) as total_count,
                any(conversion_stats.avg_response_time) as avg_response_time,
                any(time_stats.first_quote) as first_quote,
                any(time_stats.last_quote) as last_quote
            FROM quote_counts
            CROSS JOIN conversion_stats
            CROSS JOIN time_stats
            GROUP BY status, user_id, lead_id
            FORMAT JSON
        `;

        const result = await clickhouse.query(query).toPromise();
        const stats = result[0] as ClickHouseStats;

        // Convert ClickHouse arrays to objects
        const quotes_by_status: Record<string, number> = {};
        const quotes_by_user: Record<string, number> = {};
        const quotes_by_lead: Record<string, number> = {};

        stats.status_counts.forEach(([status, count]) => {
            quotes_by_status[status] = Number(count);
        });

        stats.user_counts.forEach(([user_id, count]) => {
            quotes_by_user[user_id] = Number(count);
        });

        stats.lead_counts.forEach(([lead_id, count]) => {
            quotes_by_lead[lead_id] = Number(count);
        });

        const conversion_rate = Number(stats.total_count) > 0
            ? (Number(stats.accepted_count) / Number(stats.total_count)) * 100
            : 0;

        return {
            total_quotes: Number(stats.total_quotes) || 0,
            quotes_by_status,
            quotes_by_user,
            quotes_by_lead,
            conversion_rate,
            average_response_time: Number(stats.avg_response_time) || 0,
            first_quote_at: stats.first_quote,
            last_quote_at: stats.last_quote
        };
    }
);

// Get quote history for a lead
export const getLeadQuoteHistory = api(
    { method: "GET", path: "/stats/lead-quotes", expose: true },
    async (params: { lead_id: string }) => {
        try {
            const query = `
                SELECT 
                    workspace_id,
                    quote_id,
                    lead_id,
                    application_id,
                    user_id,
                    status,
                    event_type,
                    metadata,
                    sent_at
                FROM quote_analytics
                WHERE lead_id = '${params.lead_id}'
                ORDER BY sent_at DESC
                FORMAT JSON
            `;

            const result = await clickhouse.query(query).toPromise() as ClickHouseQuoteRow[];
            console.log("ClickHouse response:", result); // Debug log

            if (!result || !Array.isArray(result)) {
                console.warn("No data returned from ClickHouse");
                return { quotes: [] };
            }

            const quotes = result.map(row => ({
                workspace_id: row.workspace_id,
                quote_id: row.quote_id,
                lead_id: row.lead_id,
                application_id: row.application_id,
                user_id: row.user_id,
                status: row.status,
                event_type: row.event_type as QuoteAnalytic['event_type'],
                metadata: row.metadata ? JSON.parse(row.metadata) : {},
                sent_at: new Date(row.sent_at)
            }));

            return { quotes };
        } catch (error) {
            console.error("Error fetching lead quote history:", error);
            throw error;
        }
    }
);
