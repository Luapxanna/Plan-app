import { api, APIError } from "encore.dev/api";
import { SQLDatabase } from "encore.dev/storage/sqldb";
import LogtoClient from '@logto/node';
import { LogtoConfig } from '@logto/node';
import { createHash } from 'crypto';

const db = new SQLDatabase("plan", { migrations: "./migrations" });

// Logto configuration
const logtoConfig: LogtoConfig = {
    endpoint: process.env.LOGTO_ENDPOINT || 'https://gtkmrh.logto.app/',
    appId: process.env.LOGTO_APP_ID || 'hcql8o16wg2gilpxaoek6',
    appSecret: process.env.LOGTO_APP_SECRET || 'z1IzhncJbEbZqquCkRZAMCFUad1z36r5',
    scopes: ['openid', 'profile', 'email'],
    resources: ['https://api.example.com']
};

const logtoClient = new LogtoClient(logtoConfig, {
    navigate: (url: string) => {
        // Handle navigation if needed
    },
    storage: {
        getItem: async (key: string) => {
            // Implement storage get
            return null;
        },
        setItem: async (key: string, value: string) => {
            // Implement storage set
        },
        removeItem: async (key: string) => {
            // Implement storage remove
        },
    },
});

interface User {
    id: string;
    email: string;
    name?: string;
    picture?: string;
    is_superuser: boolean;
}

interface AuthResponse {
    user: User;
    workspace_id: string;
}

interface RedirectResponse {
    redirect_url: string;
}

// Helper function to create a personal workspace for a user
async function createPersonalWorkspace(userId: string, email: string): Promise<string> {
    const workspace = await db.queryRow<{ id: string }>`
    WITH new_workspace AS (
      INSERT INTO workspaces (name)
      VALUES (${`${email}'s Workspace`})
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

// Get user info from Logto and create/update user in our database
export const handleLogtoCallback = api(
    { expose: true, auth: false, method: "POST", path: "/auth/callback" },
    async ({ code }: { code: string }): Promise<AuthResponse> => {
        try {
            // Exchange code for tokens
            await logtoClient.handleSignInCallback(code);

            // Get user info from Logto
            const userInfo = await logtoClient.getIdTokenClaims();

            if (!userInfo.sub || !userInfo.email) {
                throw APIError.internal("Invalid user info from Logto");
            }

            // Check if user exists in our database
            let user = await db.queryRow<User>`
        SELECT * FROM users WHERE id = ${userInfo.sub}
      `;

            if (!user) {
                // Create new user
                user = await db.queryRow<User>`
          INSERT INTO users (id, email, name, picture, is_superuser)
          VALUES (
            ${userInfo.sub},
            ${userInfo.email},
            ${userInfo.name || null},
            ${userInfo.picture || null},
            false
          )
          RETURNING id, email, name, picture, is_superuser
        `;

                if (!user) {
                    throw APIError.internal("Failed to create user");
                }

                // Create personal workspace
                const workspaceId = await createPersonalWorkspace(user.id, user.email);

                // Set the workspace context
                await db.exec`SELECT set_config('app.workspace_id', ${workspaceId}, false)`;

                return {
                    user,
                    workspace_id: workspaceId,
                };
            }

            // Update existing user info
            user = await db.queryRow<User>`
        UPDATE users
        SET 
          email = ${userInfo.email},
          name = ${userInfo.name || null},
          picture = ${userInfo.picture || null}
        WHERE id = ${userInfo.sub}
        RETURNING id, email, name, picture, is_superuser
      `;

            if (!user) {
                throw APIError.internal("Failed to update user");
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
                workspaceId = await createPersonalWorkspace(user.id, user.email);
            } else {
                workspaceId = workspace.id;
            }

            // Set the user and workspace context
            await db.exec`SELECT set_config('app.user_id', ${user.id}::text, false)`;
            await db.exec`SELECT set_config('app.workspace_id', ${workspaceId}::text, false)`;

            return {
                user,
                workspace_id: workspaceId,
            };
        } catch (error) {
            console.error("Logto callback error:", error);
            throw APIError.internal("Authentication failed");
        }
    }
);

// Get current user info
export const getCurrentUser = api(
    { expose: true, method: "GET", path: "/auth/me" },
    async (): Promise<User> => {
        const userId = await db.queryRow<{ id: string }>`
      SELECT current_setting('app.user_id', true) as id
    `;

        if (!userId?.id) {
            throw APIError.unauthenticated("No active session");
        }

        const user = await db.queryRow<User>`
      SELECT id, email, name, picture, is_superuser
      FROM users
      WHERE id = ${userId.id}::uuid
    `;

        if (!user) {
            throw APIError.notFound("User not found");
        }

        return user;
    }
);

// Logout user
export const logout = api(
    { expose: true, method: "POST", path: "/auth/logout" },
    async (): Promise<{ success: boolean }> => {
        try {
            await logtoClient.signOut();

            // Clear the user and workspace context
            await db.exec`SELECT set_config('app.user_id', '', false)`;
            await db.exec`SELECT set_config('app.workspace_id', '', false)`;

            return { success: true };
        } catch (error) {
            console.error("Logout error:", error);
            throw APIError.internal("Logout failed");
        }
    }
);

// Middleware to verify user context
export const verifyToken = async (token?: string): Promise<string> => {
    try {
        if (!token) {
            throw APIError.unauthenticated("No token provided");
        }

        // Remove 'Bearer ' prefix if present
        const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

        // Get user info
        const userInfo = await logtoClient.fetchUserInfo();

        if (!userInfo.sub) {
            throw APIError.unauthenticated("Invalid token");
        }

        // Set the user context
        await db.exec`SELECT set_config('app.user_id', ${userInfo.sub}::text, false)`;

        return userInfo.sub;
    } catch (error) {
        console.error("Token verification failed:", error);
        throw APIError.unauthenticated("Invalid token");
    }
};

// Login endpoint that redirects to Logto
export const login = api(
    { expose: true, auth: false, method: "GET", path: "/auth/login" },
    async (): Promise<RedirectResponse> => {
        try {
            console.log("Logto config:", {
                endpoint: logtoConfig.endpoint,
                appId: logtoConfig.appId ? "set" : "not set",
                appSecret: logtoConfig.appSecret ? "set" : "not set"
            });

            if (!logtoConfig.endpoint) {
                throw new Error("LOGTO_ENDPOINT is not set");
            }
            if (!logtoConfig.appId) {
                throw new Error("LOGTO_APP_ID is not set");
            }

            const scopes = logtoConfig.scopes || ['openid', 'profile', 'email'];
            const callbackUrl = "http://localhost:4000/auth/callback";

            // Generate PKCE challenge
            const codeVerifier = generateRandomString(64);
            const codeChallenge = await generateCodeChallenge(codeVerifier);

            const url = `https://gtkmrh.logto.app/oidc/auth?` +
                `client_id=${logtoConfig.appId}&` +
                `redirect_uri=${encodeURIComponent(callbackUrl)}&` +
                `response_type=code&` +
                `scope=${encodeURIComponent(scopes.join(' '))}&` +
                `code_challenge=${codeChallenge}&` +
                `code_challenge_method=S256`;

            return { redirect_url: url };
        } catch (error: any) {
            console.error("Login error:", error);
            throw APIError.internal("Failed to initiate login: " + (error?.message || "Unknown error"));
        }
    }
);

// Helper function to generate random string for PKCE
function generateRandomString(length: number): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// Helper function to generate code challenge for PKCE
async function generateCodeChallenge(verifier: string): Promise<string> {
    const hash = createHash('sha256').update(verifier).digest('base64');
    return hash
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
} 