import { api, APIError } from "encore.dev/api";
import LogtoClient from '@logto/node';
import { LogtoConfig } from '@logto/node';
import { db } from "../db";

// Logto configuration
const logtoConfig: LogtoConfig = {
    endpoint: process.env.LOGTO_ENDPOINT || 'https://gtkmrh.logto.app/',
    appId: process.env.LOGTO_APP_ID || 'hcql8o16wg2gilpxaoek6',
    appSecret: process.env.LOGTO_APP_SECRET || 'z1IzhncJbEbZqquCkRZAMCFUad1z36r5',
    scopes: ['openid', 'profile', 'email', 'custom_data'],
    resources: ['http://localhost:4000']
};

// In-memory storage for session management
const sessionStorage = new Map<string, { codeVerifier: string; accessToken?: string }>();

const createLogtoClient = () => new LogtoClient(logtoConfig, {
    navigate: (url: string) => {
        console.log('Navigation requested to:', url);
    },
    storage: {
        getItem: async (key: string) => {
            const session = sessionStorage.get(key);
            if (key === 'access_token') return session?.accessToken || null;
            return session?.codeVerifier || null;
        },
        setItem: async (key: string, value: string) => {
            const existingSession = sessionStorage.get(key) || { codeVerifier: '' };
            if (key === 'access_token') {
                sessionStorage.set(key, { ...existingSession, accessToken: value });
            } else {
                sessionStorage.set(key, { ...existingSession, codeVerifier: value });
            }
        },
        removeItem: async (key: string) => {
            sessionStorage.delete(key);
        }
    }
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

interface LogtoUserInfo {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
    is_superuser?: boolean;
    custom_data?: {
        is_superuser?: boolean;
        [key: string]: unknown;
    };
}

interface ListUsersResponse {
    users: User[];
}

interface LogtoUser {
    id: string;
    username?: string;
    primaryEmail?: string;
    name?: string;
    avatar?: string;
    customData?: {
        is_superuser?: boolean;
        [key: string]: unknown;
    };
}

interface TokenResponse {
    access_token: string;
}

interface Workspace {
    id: string;
    name: string;
    created_by: string;
    created_at: Date;
    member_count: number;
}

// Login endpoint
export const login = api(
    { method: "GET", path: "/auth/login", expose: true },
    async (): Promise<void> => {
        try {
            const logtoClient = createLogtoClient();
            const callbackUrl = `${process.env.API_URL || 'http://localhost:4000'}/auth/callback`;

            // Initiate the sign-in flow
            await logtoClient.signIn(callbackUrl);
        } catch (error) {
            console.error('Login failed:', error);
            throw APIError.internal(`Login failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
);

// Callback endpoint
export const callback = api(
    { method: "GET", path: "/auth/callback", expose: true },
    async ({ code, state }: { code?: string, state?: string }): Promise<{ access_token: string; user_id: string }> => {
        try {
            if (!code) {
                throw APIError.invalidArgument("Authorization code is required");
            }

            const logtoClient = createLogtoClient();

            try {
                // Handle the callback and exchange code for tokens
                await logtoClient.handleSignInCallback(`${process.env.API_URL || 'http://localhost:4000'}/auth/callback?code=${code}&state=${state || ''}`);
            } catch (error) {
                // If session not found, redirect to login
                if (error instanceof Error && error.message.includes('Sign-in session not found')) {
                    await logtoClient.signIn(`${process.env.API_URL || 'http://localhost:4000'}/auth/callback`);
                    throw APIError.unauthenticated("Session expired, please login again");
                }
                throw error;
            }

            // Get both ID token claims and user info
            const claims = await logtoClient.getIdTokenClaims();
            const userInfo = await logtoClient.fetchUserInfo();

            if (!userInfo.sub) {
                throw APIError.internal("Failed to get user information");
            }

            // Check if user is superuser from either source
            const customData = (claims?.custom_data || userInfo.custom_data) as { is_superuser?: boolean } | undefined;
            const isSuperuser = customData?.is_superuser === true;

            console.log('Callback user info:', { claims, userInfo, customData, isSuperuser });

            // Create or update user in database
            await db.exec`
                INSERT INTO users (id, email, name, picture, is_superuser)
                VALUES (
                    ${userInfo.sub},
                    ${userInfo.email},
                    ${userInfo.name},
                    ${userInfo.picture},
                    ${isSuperuser}
                )
                ON CONFLICT (id) DO UPDATE SET
                    email = ${userInfo.email},
                    name = ${userInfo.name},
                    picture = ${userInfo.picture},
                    is_superuser = ${isSuperuser}
            `;

            // Get access token
            const accessToken = await logtoClient.getAccessToken();

            return {
                access_token: accessToken,
                user_id: userInfo.sub
            };
        } catch (error) {
            console.error("Callback error:", error);
            throw APIError.internal(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
);

// Get current user
export const getCurrentUser = api(
    { expose: true, method: "GET", path: "/auth/me" },
    async (): Promise<User> => {
        try {
            const logtoClient = createLogtoClient();
            const userInfo = await logtoClient.getIdTokenClaims() as LogtoUserInfo;
            if (!userInfo?.sub) throw APIError.unauthenticated("No active session");

            // Get full user info which might contain additional claims
            const fullUserInfo = await logtoClient.fetchUserInfo() as LogtoUserInfo;

            // Log raw data for debugging
            console.log('Raw token claims:', JSON.stringify(userInfo, null, 2));
            console.log('Raw user info:', JSON.stringify(fullUserInfo, null, 2));
            console.log('Custom data from token:', userInfo.custom_data);
            console.log('Custom data from user info:', fullUserInfo.custom_data);

            // Check for superuser in various possible locations
            const isSuperuser = Boolean(
                userInfo.is_superuser === true ||
                fullUserInfo.is_superuser === true ||
                (userInfo.custom_data && userInfo.custom_data.is_superuser === true) ||
                (fullUserInfo.custom_data && fullUserInfo.custom_data.is_superuser === true)
            );

            console.log('Final superuser status:', isSuperuser);

            const user = await db.queryRow<User>`
                SELECT * FROM users WHERE id = ${userInfo.sub}
            `;
            if (!user) throw APIError.notFound("User not found");

            // Update superuser status if it changed
            if (user.is_superuser !== isSuperuser) {
                console.log('Updating superuser status from', user.is_superuser, 'to', isSuperuser);
                await db.exec`
                    UPDATE users 
                    SET is_superuser = ${isSuperuser}
                    WHERE id = ${userInfo.sub}
                `;
                user.is_superuser = isSuperuser;
            }

            return user;
        } catch (error) {
            console.error('Get current user error:', error);
            throw error instanceof APIError ? error : APIError.unauthenticated("Authentication failed");
        }
    }
);

// Logout
export const logout = api(
    { method: "POST", path: "/auth/logout", expose: true },
    async (): Promise<void> => {
        try {
            const logtoClient = createLogtoClient();
            // Clear the session and sign out
            await logtoClient.signOut();
            // Redirect to Logto's logout page
        } catch (error) {
            console.error("Logout error:", error);
            throw APIError.internal("Logout failed");
        }
    }
);

// List all users (superuser only)
export const listUsers = api(
    { expose: true, method: "GET", path: "/auth/users" },
    async (): Promise<ListUsersResponse> => {
        try {
            // First verify the current user is a superuser
            const logtoClient = createLogtoClient();
            const userInfo = await logtoClient.getIdTokenClaims() as LogtoUserInfo;
            if (!userInfo?.sub) throw APIError.unauthenticated("No active session");

            const currentUser = await db.queryRow<User>`
                SELECT * FROM users WHERE id = ${userInfo.sub}
            `;
            if (!currentUser?.is_superuser) {
                throw APIError.permissionDenied("Only superusers can list all users");
            }

            // Get all users from local database
            const users: User[] = [];
            const rows = await db.query<User>`
                SELECT id, email, name, picture, is_superuser
                FROM users
                ORDER BY email
            `;

            for await (const row of rows) {
                users.push(row);
            }

            return { users };
        } catch (error) {
            console.error('List users error:', error);
            throw error instanceof APIError ? error : APIError.internal("Failed to list users");
        }
    }
);

// Verify token and set user context
export const verifyToken = async (): Promise<string> => {
    try {
        const logtoClient = createLogtoClient();
        const userInfo = await logtoClient.getIdTokenClaims();
        if (!userInfo?.sub) throw APIError.unauthenticated("No active session");

        await db.exec`SELECT set_config('app.user_id', ${userInfo.sub}, false)`;
        return userInfo.sub;
    } catch (error) {
        throw error instanceof APIError ? error : APIError.unauthenticated("Authentication failed");
    }
};

// Get current workspace
export const getCurrentWorkspace = api(
    { expose: true, method: "GET", path: "/auth/workspace" },
    async (): Promise<Workspace> => {
        try {
            const userId = await verifyToken();
            if (!userId) {
                throw APIError.unauthenticated("No active session. Please login first.");
            }

            const workspace = await db.queryRow<Workspace>`
                SELECT w.*, 
                       (SELECT COUNT(*) FROM user_workspaces WHERE workspace_id = w.id) as member_count
                FROM workspace w
                WHERE w.id = current_setting('app.workspace_id', true)
            `;

            if (!workspace) {
                throw APIError.notFound("Workspace not found");
            }

            return workspace;
        } catch (error) {
            console.error('Get current workspace error:', error);
            throw error instanceof APIError ? error : APIError.internal("Failed to get current workspace");
        }
    }
);

// Helper function to check current workspace context
export async function checkWorkspaceContext(): Promise<string> {
    const result = await db.queryRow<{ workspace_id: string }>`
    SELECT current_setting('app.workspace_id', false) as workspace_id
  `;

    if (!result || !result.workspace_id) {
        throw APIError.invalidArgument("No workspace context set. Please set workspace context first.");
    }

    return result.workspace_id;
}
