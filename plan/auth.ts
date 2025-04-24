import { api, APIError } from "encore.dev/api";
import { SQLDatabase } from "encore.dev/storage/sqldb";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const db = new SQLDatabase("url", { migrations: "./migrations" });

// Use a secure default secret in development
const JWT_SECRET = process.env.JWT_SECRET || "development-secret-key-change-in-production";
const SALT_ROUNDS = 10;

// Store the current token in memory (in production, use a secure storage)
let currentToken: string | null = null;

interface User {
    id: string;
    email: string;
    password_hash: string;
}

interface LoginRequest {
    email: string;
    password: string;
}

interface RegisterRequest {
    email: string;
    password: string;
}

interface AuthResponse {
    token: string;
    user: {
        id: string;
        email: string;
    };
    workspace_id: string;
}

// Helper function to create a personal workspace for a user
async function createPersonalWorkspace(userId: string, email: string): Promise<string> {
    const workspace = await db.queryRow<{ id: string }>`
        WITH new_workspace AS (
            INSERT INTO workspace (id, name)
            VALUES (gen_random_uuid(), ${`${email}'s Workspace`})
            RETURNING id
        )
        INSERT INTO user_workspaces (user_id, workspace_id)
        SELECT ${userId}::uuid, id FROM new_workspace
        RETURNING workspace_id
    `;

    if (!workspace) {
        throw APIError.internal("Failed to create workspace");
    }

    return workspace.id;
}

// Register a new user
export const register = api(
    { expose: true, auth: false, method: "POST", path: "/auth/register" },
    async (req: RegisterRequest): Promise<AuthResponse> => {
        const { email, password } = req;

        // Check if user already exists
        const existingUser = await db.queryRow<User>`
      SELECT * FROM users WHERE email = ${email}
    `;

        if (existingUser) {
            throw APIError.alreadyExists("User already exists");
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Create user
        const user = await db.queryRow<User>`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, ${passwordHash})
      RETURNING id, email, password_hash
    `;

        if (!user) {
            throw APIError.internal("Failed to create user");
        }

        // Create personal workspace and grant access
        const workspaceId = await createPersonalWorkspace(user.id, email);

        // Generate JWT
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "24h" });

        // Set the workspace context
        await db.exec`SELECT set_config('app.workspace_id', ${workspaceId}, false)`;

        return {
            token,
            user: {
                id: user.id,
                email: user.email,
            },
            workspace_id: workspaceId,
        };
    }
);

// Login user
export const login = api(
    { expose: true, auth: false, method: "POST", path: "/auth/login" },
    async (req: LoginRequest): Promise<AuthResponse> => {
        const { email, password } = req;

        // Find user
        const user = await db.queryRow<User>`
            SELECT * FROM users WHERE email = ${email}
        `;

        if (!user) {
            throw APIError.unauthenticated("Invalid credentials");
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            throw APIError.unauthenticated("Invalid credentials");
        }

        // Get user's first workspace
        const workspace = await db.queryRow<{ id: string }>`
            SELECT workspace_id as id
            FROM user_workspaces
            WHERE user_id = ${user.id}::uuid
            LIMIT 1
        `;

        let workspaceId: string;
        if (!workspace) {
            // If no workspace exists, create one
            workspaceId = await createPersonalWorkspace(user.id, email);
        } else {
            workspaceId = workspace.id;
        }

        // Set the workspace context
        await db.exec`SELECT set_config('app.workspace_id', ${workspaceId}::text, false)`;
        await db.exec`SELECT set_config('app.user_id', ${user.id}::text, false)`;

        // Generate JWT
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "24h" });

        // Store the current token
        currentToken = token;

        return {
            token,
            user: {
                id: user.id,
                email: user.email,
            },
            workspace_id: workspaceId,
        };
    }
);

// Get current token
export const getCurrentToken = api(
    { expose: true, auth: false, method: "GET", path: "/auth/token" },
    async (): Promise<{ token: string | null }> => {
        return { token: currentToken };
    }
);

// Logout user
export const logout = api(
    { expose: true, auth: false, method: "POST", path: "/auth/logout" },
    async (): Promise<{ success: boolean }> => {
        // Clear the current token
        currentToken = null;

        // Clear the user and workspace context
        await db.exec`SELECT set_config('app.user_id', '', false)`;
        await db.exec`SELECT set_config('app.workspace_id', '', false)`;

        return { success: true };
    }
);

// Middleware to verify JWT and set user context
export const verifyToken = async (token: string): Promise<string> => {
    try {
        // Remove 'Bearer ' prefix if present
        const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
        const decoded = jwt.verify(cleanToken, JWT_SECRET) as { userId: string };
        return decoded.userId;
    } catch (error) {
        console.error("Token verification failed:", error);
        throw APIError.unauthenticated("Invalid token");
    }
}; 