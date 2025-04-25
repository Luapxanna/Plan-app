import { api, APIError } from "encore.dev/api";
import { SQLDatabase } from "encore.dev/storage/sqldb";
import LogtoClient from '@logto/node';
import { LogtoConfig } from '@logto/node';

const db = new SQLDatabase("plan", { migrations: "./migrations" });

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
    navigate: (url: string) => console.log('Navigation requested to:', url),
    storage: {
        getItem: async (key: string) => {
            const session = sessionStorage.get(key);
            return key === 'access_token' ? session?.accessToken || null : session?.codeVerifier || null;
        },
        setItem: async (key: string, value: string) => {
            const existingSession = sessionStorage.get(key) || { codeVerifier: '' };
            sessionStorage.set(key, key === 'access_token'
                ? { ...existingSession, accessToken: value }
                : { ...existingSession, codeVerifier: value });
            return Promise.resolve();
        },
        removeItem: async (key: string) => {
            sessionStorage.delete(key);
            return Promise.resolve();
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

interface LogtoUserInfo {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
    custom_data?: {
        is_superuser?: boolean;
        [key: string]: unknown;
    };
}

interface ListUsersResponse {
    users: User[];
}

// Login endpoint
export const login = api(
    { method: "GET", path: "/auth/login", expose: true },
    async () => {
        try {
            const logtoClient = createLogtoClient();
            await logtoClient.signIn(`${process.env.API_URL || 'http://localhost:4000'}/auth/callback`);
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
        if (!code) throw APIError.invalidArgument("Authorization code is required");
        const logtoClient = createLogtoClient();

        try {
            await logtoClient.handleSignInCallback(`${process.env.API_URL || 'http://localhost:4000'}/auth/callback?code=${code}&state=${state || ''}`);
        } catch (error) {
            if (error instanceof Error && error.message.includes('Sign-in session not found')) {
                await logtoClient.signIn(`${process.env.API_URL || 'http://localhost:4000'}/auth/callback`);
                throw APIError.unauthenticated("Session expired, please login again");
            }
            throw error;
        }

        const [claims, userInfo] = await Promise.all([
            logtoClient.getIdTokenClaims(),
            logtoClient.fetchUserInfo()
        ]);

        if (!userInfo.sub) throw APIError.internal("Failed to get user information");

        const customData = (claims?.custom_data || userInfo.custom_data) as { is_superuser?: boolean } | undefined;
        const isSuperuser = customData?.is_superuser === true;

        await db.exec`
            INSERT INTO users (id, email, name, picture, is_superuser)
            VALUES (${userInfo.sub}, ${userInfo.email}, ${userInfo.name}, ${userInfo.picture}, ${isSuperuser})
            ON CONFLICT (id) DO UPDATE SET
                email = ${userInfo.email},
                name = ${userInfo.name},
                picture = ${userInfo.picture},
                is_superuser = ${isSuperuser}
        `;

        return {
            access_token: await logtoClient.getAccessToken(),
            user_id: userInfo.sub
        };
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

            const fullUserInfo = await logtoClient.fetchUserInfo() as LogtoUserInfo;
            const isSuperuser = Boolean(
                userInfo.custom_data?.is_superuser === true ||
                fullUserInfo.custom_data?.is_superuser === true
            );

            const user = await db.queryRow<User>`SELECT * FROM users WHERE id = ${userInfo.sub}`;
            if (!user) throw APIError.notFound("User not found");

            if (user.is_superuser !== isSuperuser) {
                await db.exec`UPDATE users SET is_superuser = ${isSuperuser} WHERE id = ${userInfo.sub}`;
                user.is_superuser = isSuperuser;
            }

            return user;
        } catch (error) {
            throw error instanceof APIError ? error : APIError.unauthenticated("Authentication failed");
        }
    }
);

// Logout
export const logout = api(
    { method: "POST", path: "/auth/logout", expose: true },
    async () => {
        try {
            await createLogtoClient().signOut();
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
            const logtoClient = createLogtoClient();
            const userInfo = await logtoClient.getIdTokenClaims() as LogtoUserInfo;
            if (!userInfo?.sub) throw APIError.unauthenticated("No active session");

            const currentUser = await db.queryRow<User>`SELECT * FROM users WHERE id = ${userInfo.sub}`;
            if (!currentUser?.is_superuser) throw APIError.permissionDenied("Only superusers can list all users");

            const users: User[] = [];
            const rows = await db.query<User>`SELECT id, email, name, picture, is_superuser FROM users ORDER BY email`;
            for await (const row of rows) users.push(row);

            return { users };
        } catch (error) {
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
