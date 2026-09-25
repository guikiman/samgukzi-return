import { describe, expect, it } from 'vitest';
import {
    AUTH_ERROR_CODES,
    DEFAULT_AUTH_CLIENT_CONFIG,
    normalizeAuthError,
    OAUTH_PROVIDERS,
} from '../src/auth/index.js';
import type {
    AuthChangeEvent,
    AuthClient,
    AuthConfig,
    AuthSession,
    AuthState,
    AuthStateListener,
    AuthUser,
} from '../src/auth/index.js';

const user: AuthUser = {
    id: 'user-1',
    email: 'player@example.test',
    emailVerified: true,
    provider: 'email',
};

const session: AuthSession = {
    user,
    expiresAt: 1_900_000_000,
    provider: 'email',
    sessionId: 'session-1',
};

type TestAuthClient = AuthClient & {
    readonly emit: (event: AuthChangeEvent, session: AuthSession | null) => void;
    readonly getUnsubscribeCount: () => number;
};

function createContractClient(): TestAuthClient {
    let listener: AuthStateListener | undefined;
    let isSubscribed = true;
    let unsubscribeCount = 0;

    return {
        signUp: async () => ({
            data: { user, session: null },
            error: null,
        }),
        signIn: async () => ({
            data: { user, session },
            error: null,
        }),
        signInWithOAuth: async ({ provider }) => ({
            data: {
                provider,
                url: `https://auth.example.test/${provider}`,
                flowId: null,
            },
            error: null,
        }),
        getSession: async () => ({
            data: { session },
            error: null,
        }),
        onAuthStateChange: (nextListener) => {
            listener = nextListener;
            return () => {
                if (!isSubscribed) return;
                isSubscribed = false;
                unsubscribeCount += 1;
                listener = undefined;
            };
        },
        emit: (event, currentSession) => {
            if (isSubscribed && listener) listener(event, currentSession);
        },
        getUnsubscribeCount: () => unsubscribeCount,
        signOut: async () => ({ data: null, error: null }),
        refreshSession: async () => ({
            data: { session },
            error: null,
        }),
    };
}

describe('provider-neutral authentication contract', () => {
    it('models the four auth states and Supabase-compatible createClient configuration', () => {
        const config = {
            url: 'https://project.example.test',
            anonKey: 'public-anon-key',
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true,
                flowType: 'pkce',
            },
        } satisfies AuthConfig;

        const states: readonly AuthState[] = [
            { status: 'loading' },
            { status: 'authenticated', session },
            { status: 'anonymous' },
            { status: 'error', error: normalizeAuthError(new Error('failed')) },
        ];

        expect(config.auth?.flowType).toBe('pkce');
        expect(DEFAULT_AUTH_CLIENT_CONFIG).toEqual({
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
        });
        expect(states.map((state) => state.status)).toEqual([
            'loading',
            'authenticated',
            'anonymous',
            'error',
        ]);
    });

    it('supports the approved email/password and OAuth request shapes', () => {
        const emailRequest = {
            email: 'player@example.test',
            password: 'placeholder-password',
            options: { emailRedirectTo: 'https://game.example.test/welcome' },
        };
        const oauthRequest = {
            provider: 'github',
            options: {
                redirectTo: 'https://game.example.test/callback',
                scopes: 'read:user',
                queryParams: { prompt: 'consent' },
                skipBrowserRedirect: true,
            },
        } satisfies Parameters<AuthClient['signInWithOAuth']>[0];

        expect(OAUTH_PROVIDERS).toContain('google');
        expect(emailRequest.options.emailRedirectTo).toBe('https://game.example.test/welcome');
        expect(oauthRequest.provider).toBe('github');
    });

    it('restores a session asynchronously without exposing token fields', async () => {
        const client = createContractClient();

        const result = client.getSession();
        expect(result).toBeInstanceOf(Promise);
        const restored = await result;

        if (restored.error !== null) throw new Error(restored.error.message);
        expect(restored.data.session).toEqual(session);
        expect(Object.keys(session)).not.toContain('accessToken');
        expect(Object.keys(session)).not.toContain('refreshToken');
    });

    it('emits an initial session event and unsubscribes idempotently', () => {
        const client = createContractClient();
        const events: AuthChangeEvent[] = [];

        const unsubscribe = client.onAuthStateChange((event) => {
            events.push(event);
        });
        client.emit('INITIAL_SESSION', session);
        unsubscribe();
        client.emit('SIGNED_OUT', null);
        unsubscribe();

        expect(events).toEqual(['INITIAL_SESSION']);
        expect(client.getUnsubscribeCount()).toBe(1);
    });

    it('normalizes provider failures into stable codes and preserves safe metadata', () => {
        const invalidCredentials = normalizeAuthError({
            code: 'invalid_credentials',
            message: 'Invalid login credentials',
            status: 401,
        });
        const rateLimited = normalizeAuthError({
            code: 'over_request_rate_limit',
            message: 'Too many requests',
            status: 429,
        });
        const network = normalizeAuthError(new Error('Failed to fetch'));
        const provider = normalizeAuthError(
            { code: 'oauth_error', message: 'The OAuth provider rejected the request' },
            'github',
        );

        expect(invalidCredentials).toMatchObject({
            code: 'invalid_credentials',
            status: 401,
            retryable: false,
        });
        expect(rateLimited).toMatchObject({ code: 'rate_limited', retryable: true });
        expect(network.code).toBe('network_error');
        expect(provider).toMatchObject({ code: 'provider_error', provider: 'github' });
        expect(AUTH_ERROR_CODES).toContain('unknown');
    });
});
