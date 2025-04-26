import { SQLDatabase } from "encore.dev/storage/sqldb";

// Create a single shared database instance
export const db = new SQLDatabase("plan", { migrations: "./migrations" }); 