import { api } from "encore.dev/api";
import { ClickHouse } from "clickhouse";

// ClickHouse client setup
const clickhouse = new ClickHouse({
    url: 'http://localhost:8123',
    user: 'myuser',
    password: 'mypassword',
    database: 'default'
});

export type QuoteEvent = {
    tenant_id: string;
    quote_id: string;
    lead_id: string;
};

// Define a named interface for the summary result
export interface QuoteRateSummary {
    tenant_id: string;
    quote_count: number;
}

// Wrapper interface for Encore
export interface QuoteRateSummaryList {
    items: QuoteRateSummary[];
}

// Define a named interface for tenant stats
export interface TenantStats {
    tenant_id: string;
    total_quotes: number;
    first_quote_at: string;
    last_quote_at: string;
}

// Wrapper interface for Encore
export interface TenantStatsList {
    items: TenantStats[];
}

function formatDateForClickHouse(date: Date): string {
    return date.toISOString().replace('T', ' ').substring(0, 19);
}

// Log a quote event
export async function logQuoteEvent(event: QuoteEvent): Promise<void> {
    await clickhouse.query(
        `INSERT INTO quote_analytics (tenant_id, quote_id, lead_id, sent_at) VALUES ('${event.tenant_id}', '${event.quote_id}', '${event.lead_id}', '${formatDateForClickHouse(new Date())}')`
    ).toPromise();
}

// API endpoint to simulate sending a quote
export const sendQuote = api(
    { method: "POST", path: "/dev/sendQuote", expose: true },
    async (event: QuoteEvent): Promise<{ status: string }> => {
        if (!event.tenant_id || !event.quote_id || !event.lead_id) {
            throw new Error("Missing fields");
        }
        await logQuoteEvent(event);
        return { status: "logged" };
    }
);

// API endpoint to get per-tenant quote summary
export const getQuoteRate = api(
    { method: "GET", path: "/stats/quote-rate", expose: true },
    async (): Promise<QuoteRateSummaryList> => {
        const result = await clickhouse.query(
            `SELECT tenant_id, count() as quote_count FROM quote_analytics GROUP BY tenant_id`
        ).toPromise();
        return { items: result as QuoteRateSummary[] };
    }
);

// API endpoint to get tenant stats
export const getTenantStats = api(
    { method: "GET", path: "/stats/tenant", expose: true },
    async (): Promise<TenantStatsList> => {
        const result = await clickhouse.query(
            `SELECT 
                tenant_id,
                count() as total_quotes,
                min(sent_at) as first_quote_at,
                max(sent_at) as last_quote_at
            FROM quote_analytics 
            GROUP BY tenant_id`
        ).toPromise();
        return { items: result as TenantStats[] };
    }
);
